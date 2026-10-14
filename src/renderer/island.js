// The island: a black notch at the top centre of the screen.
//
//   notch ──hover──▶ open ──leave──▶ notch
//     │                ▲
//     └──alert──▶ peek ┘ (hover or click opens the alert's module)
//
// Everything a feature shows lives in its module view (src/modules/<id>/view.js);
// this file only owns the shell, Gany's mood, alerts and mouse capture.

import { Gany } from './gany.js';
import { Sound } from './sound.js';
import { h, mount, ago, clip, markdown } from './ui.js';
import { Launch, launchKind, reducedMotion } from './launch.js';

const api = window.ambrosia;
const $ = (s) => document.querySelector(s);
const island = $('#island');
const canvas = $('#gany');

const S = {
  mode: 'notch', // notch | peek | open | line
  modules: [], // manifest from main
  views: {}, // id → view module
  states: {}, // id → state
  settings: {},
  alerts: [],
  alert: null, // alert shown in peek
  selected: null, // module shown when open
  hovered: false,
  pinned: false,
  localMood: null, // { name, until }
  lastActivity: Date.now(),
  clicks: [],
  call: null, // « en appel » from the main process: { active, title, kinds, queued, threshold }
  system: {}, // Windows, from the main process: { locked, fullscreen, dnd }
  update: {}, // src/main/updater.js: { status, ready, running, mode… }
};

const gany = new Gany(canvas);
gany.start();
let launcher = null; // Gany's entrance while it plays (launch.js)
let lastSize = { w: 168, h: 30, r: 14 };

// ── Sizes ─────────────────────────────────────────────────────────────────

const OPEN_W = 600;
const PEEK_W = 470;
const PEEK_H = 72;

function setSize(w, h, r) {
  // Gany's entrance: while it plays, it owns the island's shape (see launch.js).
  lastSize = { w, h, r };
  if (launcher?.active && !launcher.handed) {
    api.send('island-rect', { x: (window.innerWidth - w) / 2, y: 0, w, h });
    return;
  }
  island.style.setProperty('--w', `${w}px`);
  island.style.setProperty('--h', `${h}px`);
  island.style.setProperty('--r', `${r}px`);
  // The main process uses this shape for hover detection and click-through.
  api.send('island-rect', { x: (window.innerWidth - w) / 2, y: 0, w, h });
}

const DROP_W = 380;
const DROP_H = 70;

function layout() {
  island.classList.remove('mode-notch', 'mode-peek', 'mode-open', 'mode-line');
  island.classList.add(`mode-${S.mode}`);
  stepAside();
  if (feeding && S.mode !== 'open') {
    // A file on its way: the notch opens into a drop zone (Gany holds out his cup).
    setSize(DROP_W, DROP_H, 24);
    gany.setFps(60);
  } else if (S.mode === 'open') {
    const inner = $('#open-inner');
    setSize(OPEN_W, Math.min(560, inner.scrollHeight), 28);
    gany.setFps(60);
  } else if (S.mode === 'peek') {
    setSize(PEEK_W, PEEK_H, 24);
    gany.setFps(60);
  } else if (S.mode === 'line') {
    setSize(120, 5, 4);
    gany.setFps(4);
  } else {
    // Fit the chips (logos + badges), within reason.
    const row = $('#notch-row');
    const chipsWidth = [...row.children].reduce((w, c) => w + c.getBoundingClientRect().width + 7, 0);
    // A ticker line passing by gets a little more room than the chips.
    const max = row.querySelector('.ticker') ? 470 : 340;
    setSize(Math.round(Math.min(max, Math.max(132, 52 + chipsWidth + 12))), 30, 14);
    gany.setFps(20);
  }
}

new ResizeObserver(() => S.mode === 'open' && layout()).observe($('#open-inner'));

// Full screen on this display (src/main/system.js): the island steps aside — the
// window hides — unless something must show (an alert that passed, an approval,
// the island opened for you). What waits comes back as one recap.
let asideNow = false;
function stepAside() {
  const on = !!S.system.fullscreen && (S.mode === 'notch' || S.mode === 'line') && !feeding && !(launcher?.active && !launcher.handed);
  island.classList.toggle('aside', on);
  if (on === asideNow) return;
  asideNow = on;
  api.send('aside', on);
}

function setMode(mode) {
  if (mode === 'notch' && S.settings.island?.idleStyle === 'line' && !attention()) mode = 'line';
  if (mode === S.mode) {
    if (mode === 'peek') renderPeek(); // another alert took the peek's place
    return layout();
  }
  const was = S.mode;
  S.mode = mode;
  if (mode === 'open') {
    currentPhrase = phrase();
    renderOpen(); // silent: unfolding on hover is not news
  } else if (was === 'open') {
    api.send('blur-island');
  }
  if (mode === 'peek') renderPeek();
  layout();
  updateMood();
  takeKeys();
}

// ── Opening and closing ──────────────────────────────────────────────────

let hoverTimer = null;
let leaveTimer = null;

function open(moduleId) {
  clearTimeout(leaveTimer);
  if (moduleId) S.selected = moduleId;
  if (!S.selected || !viewable(S.selected)) S.selected = firstViewable();
  // A pinned alert (a meeting you are missing) stays until answered.
  if (S.alert && !S.alert.pin) dismiss(S.alert);
  setMode('open');
}

/** The « ⋮ » list of rarely visited sections is unfolded (see renderTabs). */
let moreOpen = false;

function close(force = false) {
  if (!force && (S.pinned || S.hovered || typing())) return;
  S.pinned = false;
  moreOpen = false;
  const next = currentAlert();
  S.alert = next;
  setMode(next ? 'peek' : 'notch');
}

const typing = () => document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName) && S.mode === 'open';

// Hover comes from the main process, which watches the cursor against the island shape.
api.on('hover', (inside) => (inside ? onEnter() : onLeave()));

let lastPresencePing = 0;
function onEnter() {
  S.hovered = true;
  S.lastActivity = Date.now();
  // Tell the gany module you are here (morning briefing), at most once a minute.
  if (Date.now() - lastPresencePing > 60000) {
    lastPresencePing = Date.now();
    api.action('gany', 'presence').catch(() => {});
  }
  clearTimeout(leaveTimer);
  lastRest = null;
  launcher?.interrupt(); // the pointer is there: the entrance folds at once
  armRest();
  takeKeys();
}

// The island unfolds once the pointer has rested on it for restDelay ms: passing
// over the top of the screen on the way to a tab or a title bar never opens it.
// Every move of more than a couple of pixels restarts the count.
let lastRest = null;
function armRest() {
  clearTimeout(hoverTimer);
  if (S.mode === 'open' || press || feeding) return; // a file on its way is not a rest
  if (launcher?.active && !launcher.handed) {
    hoverTimer = setTimeout(armRest, 150);
    return;
  }
  hoverTimer = setTimeout(() => {
    if (S.hovered && !press) open(S.alert?.module);
  }, S.settings.island?.restDelay ?? 450);
}

function onLeave() {
  S.hovered = false;
  // Pressed then left before the hold counted: that was not a drag.
  if (press && !press.dragging) {
    clearTimeout(holdTimer);
    press = null;
  }
  clearTimeout(hoverTimer);
  clearTimeout(leaveTimer);
  leaveTimer = setTimeout(() => close(), S.settings.island?.leaveDelay ?? 650);
}

// Clicking outside (another window gets focus) folds the island unless pinned.
window.addEventListener('blur', () => {
  if (!S.hovered) {
    api.send('mouse', false);
    setTimeout(() => close(), 200);
  }
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.activeElement?.blur();
    close(true);
    return;
  }
  // The open view's own shortcuts (Claude: A / R / T, 1–9 on a waiting request), never while typing.
  if (S.mode !== 'open' || e.ctrlKey || e.altKey || e.metaKey || e.repeat) return;
  const t = document.activeElement;
  if (t && (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable)) return;
  const view = S.views[S.selected];
  try {
    if (view?.onKey?.(e, S.states[S.selected] || {}, uiFor(S.selected))) e.preventDefault();
  } catch (err) {
    console.error(S.selected, 'onKey', err);
  }
});

/**
 * A view with something to answer by keyboard (a Claude request) gets the keys
 * while the pointer is on the open island: the window takes the focus then, and
 * gives it back when it folds. An alert that merely appears never takes it.
 */
function takeKeys() {
  if (S.mode !== 'open' || !S.hovered || document.hasFocus()) return;
  const view = S.views[S.selected];
  try {
    if (view?.wantsKeys?.(S.states[S.selected] || {}, uiFor(S.selected))) api.send('focus-island');
  } catch (err) {
    console.error(S.selected, 'wantsKeys', err);
  }
}

$('#peek').addEventListener('click', () => open(S.alert?.module));

// A click on the folded notch (not on Gany, who has his own games) unfolds it at once,
// without waiting for the hover delay. The peek, the ticker and buttons keep their own click.
island.addEventListener('click', (e) => {
  if (swallowClick || (S.mode !== 'notch' && S.mode !== 'line')) return;
  if (e.target.closest('#gany, #peek, .ticker, button, input, a')) return;
  clearTimeout(hoverTimer);
  open();
});

// ── Gany interactions ────────────────────────────────────────────────────

let loveTimer = null;

// Folded: a click startles him, a double click unfolds the island.
// Unfolded: a click annoys him, three quick clicks make him dizzy.
canvas.addEventListener('click', (e) => {
  e.stopPropagation();
  gany.poke();
  if (S.mode !== 'open') {
    flash('surprised', 900);
    Sound.play('hover');
    return;
  }
  const now = Date.now();
  S.clicks = S.clicks.filter((t) => now - t < 1300).concat(now);
  if (S.clicks.length >= 3) {
    S.clicks = [];
    flash('dizzy', 3200);
    Sound.play('dizzy');
  } else {
    flash('annoyed', 1300);
    Sound.play('annoyed');
  }
});
canvas.addEventListener('dblclick', (e) => {
  e.stopPropagation();
  if (S.mode !== 'open') open();
});
canvas.addEventListener('mouseenter', () => {
  clearTimeout(loveTimer);
  loveTimer = setTimeout(() => {
    flash('love', 2600); // silent: resting the pointer on him is not a call
  }, 2000);
});
canvas.addEventListener('mouseleave', () => clearTimeout(loveTimer));

// Right click: the quick menu (native, built by the main process).
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  api.send('gany-menu');
});

// Petting: stroke him left and right. Gentle strokes make him blush, then purr;
// shaking him fast annoys him.
const pet = { lastX: null, dir: 0, flips: [], level: 0, lastAt: 0 };
canvas.addEventListener('mousemove', (e) => {
  const now = performance.now();
  if (pet.lastX == null || now - pet.lastAt > 600) {
    Object.assign(pet, { lastX: e.clientX, dir: 0, flips: [], level: 0, lastAt: now });
    return;
  }
  const dx = e.clientX - pet.lastX;
  pet.lastAt = now;
  if (Math.abs(dx) < 3) return;
  const dir = Math.sign(dx);
  if (pet.dir && dir !== pet.dir) pet.flips.push(now);
  pet.dir = dir;
  pet.lastX = e.clientX;
  pet.flips = pet.flips.filter((t) => now - t < 1500);
  const fast = pet.flips.length >= 6 && now - pet.flips[pet.flips.length - 6] < 700;
  if (fast) {
    pet.flips = [];
    pet.level = 0;
    gany.poke();
    flash('annoyed', 1300);
    Sound.play('annoyed');
  } else if (pet.flips.length >= 4 && pet.level < 2) {
    pet.level = 2;
    clearTimeout(loveTimer);
    flash('purr', 3000);
    Sound.play('purr');
  } else if (pet.flips.length >= 2 && pet.level < 1) {
    pet.level = 1;
    clearTimeout(loveTimer);
    flash('shy', 1800);
  }
});

// Feed him a file: drag it onto the island, Gany drinks it and offers a summary.
// When a drag from elsewhere comes near, the main process lets the window take the
// mouse over a zone around the notch (main.js, « file drags »): the notch opens
// into a drop zone as soon as a real drag with files enters, not before.
let feeding = 0;
const dropHint = h('div#drop-hint', h('div.drop-title', 'Dépose ici, Gany le boit'), h('div.drop-sub', 'et te propose un résumé'));
island.append(dropHint);
document.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types?.includes('Files')) {
    // A link, some text: not for Gany, let it reach the window below.
    if (!feeding) api.send('drop-reject');
    return;
  }
  e.preventDefault();
  if (feeding++ === 0) {
    clearTimeout(hoverTimer);
    island.classList.add('feeding');
    flash('hungry', 60000);
    layout();
  }
});
// The drag went away or ended elsewhere (main process: button released, zone left).
api.on('drop-armed', (on) => {
  if (!on && feeding) endFeeding();
});
document.addEventListener('dragover', (e) => {
  if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
});
document.addEventListener('dragleave', () => {
  if (--feeding <= 0) endFeeding();
});
function endFeeding() {
  feeding = 0;
  island.classList.remove('feeding');
  if (S.localMood?.name === 'hungry') S.localMood = null;
  layout();
  updateMood();
}
document.addEventListener('drop', (e) => {
  e.preventDefault();
  const files = [...(e.dataTransfer?.files || [])].map((file) => api.pathForFile?.(file)).filter(Boolean);
  endFeeding();
  if (!files.length) return;
  flash('drink', 2600);
  Sound.play('send');
  api.action('chat', 'fileDropped', { paths: files }).catch(() => {});
});

// ── Little life when nothing happens ──────────────────────────────────────
// Every 2 to 5 minutes, if Gany is idle and visible: a yawn, a crown to fix,
// a fly to watch, his cup to twirl, a short doze. Never while something matters,
// and never with a sound.
const IDLE_ACTS = ['yawn', 'crown', 'fly', 'cup', 'doze'];
let nextIdleAt = Date.now() + 120000;
setInterval(() => {
  if (S.settings.gany?.idleAnimations === false || S.mode === 'line') return;
  if (gany.mood !== 'idle' || Date.now() < nextIdleAt) return;
  nextIdleAt = Date.now() + (2 + Math.random() * 3) * 60000;
  const act = IDLE_ACTS[Math.floor(Math.random() * IDLE_ACTS.length)];
  // Silent on purpose: a sound with nothing to say pulls the user out of their work.
  gany.playIdle(act, act === 'doze' ? 4500 : act === 'fly' ? 5000 : 3200);
}, 15000);

// Gany glances at the window you switch to (main process: foreground watcher).
api.on('glance', ({ x, y }) => {
  if (S.mode === 'line' || S.hovered) return;
  const r = canvas.getBoundingClientRect();
  gany.glance(x - (r.left + r.width / 2), y - (r.top + r.height / 2), 1800);
});

// A reaction pushed by a module: ctx.react('wink', 2500, { sound, confetti }).
api.on('react', ({ mood, ms, sound, confetti: party }) => {
  if (S.settings.general?.paused) return;
  flash(mood, ms || 2500);
  if (sound) Sound.play(sound);
  if (party) confetti();
});

// ── Outfit and energy ─────────────────────────────────────────────────────
function dressGany() {
  const now = new Date();
  const day = now.getDay();
  const weekend = (day === 5 && now.getHours() >= 14) || day === 6 || day === 0;
  // A holiday's hat wins over the weekend flowers (src/modules/gany/logic.js → occasion).
  const occasion = S.settings.gany?.occasions !== false && S.states.gany?.occasion?.outfit;
  gany.setOutfit(occasion || (S.settings.gany?.weekendOutfit !== false && weekend ? 'weekend' : null));
  const meetings = S.states.agenda?.today?.count ?? null;
  const energy = S.settings.gany?.energy === false || meetings == null ? 'normal' : meetings >= 5 ? 'tired' : meetings <= 1 ? 'cheerful' : 'normal';
  gany.setEnergy(energy);
}
setInterval(dressGany, 5 * 60000);

// ── Confetti ──────────────────────────────────────────────────────────────
// Gold and nectar flakes falling from the island over the (click-through) window.
const confettiCanvas = document.createElement('canvas');
confettiCanvas.id = 'confetti';
document.body.append(confettiCanvas);
let confettiRun = null;
function confetti() {
  const c = confettiCanvas;
  const dpr = window.devicePixelRatio || 1;
  c.width = innerWidth * dpr;
  c.height = innerHeight * dpr;
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const r = island.getBoundingClientRect();
  const colors = ['#F8DC6C', '#E8B923', '#F2A65A', '#FFFFFF', '#FF8FB1', '#B79CFF'];
  const bits = Array.from({ length: 90 }, () => ({
    x: r.left + Math.random() * r.width,
    y: r.bottom - 4,
    vx: (Math.random() - 0.5) * 4,
    vy: 1 + Math.random() * 3.5,
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    w: 4 + Math.random() * 5,
    h: 2 + Math.random() * 3,
    c: colors[Math.floor(Math.random() * colors.length)],
  }));
  const started = performance.now();
  cancelAnimationFrame(confettiRun);
  const frame = (t) => {
    const k = (t - started) / 2600;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    if (k >= 1) return;
    ctx.globalAlpha = Math.min(1, (1 - k) * 2);
    for (const b of bits) {
      b.vy += 0.06;
      b.vx *= 0.99;
      b.x += b.vx;
      b.y += b.vy;
      b.rot += b.vr;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.rot);
      ctx.fillStyle = b.c;
      ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      ctx.restore();
    }
    confettiRun = requestAnimationFrame(frame);
  };
  confettiRun = requestAnimationFrame(frame);
}

function flash(mood, ms) {
  S.localMood = { name: mood, until: Date.now() + ms };
  updateMood();
  setTimeout(updateMood, ms + 20);
}

api.on('cursor', ({ x, y, sx, sy }) => {
  const r = canvas.getBoundingClientRect();
  gany.look(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
  // Screen coordinates: they do not jump when the window itself moves.
  if (S.hovered && S.mode !== 'open' && (!lastRest || Math.hypot(sx - lastRest.x, sy - lastRest.y) > 2)) {
    lastRest = { x: sx, y: sy };
    armRest();
  }
});

// ── Moving the island ────────────────────────────────────────────────────
// Press and hold (or press and slide sideways) on the notch, or on the header
// when open, then slide: the island moves along the top edge. The main process
// moves the window and brings it back to the centre a minute later.

let press = null;
let holdTimer = null;
let swallowClick = false;
const NOT_A_HANDLE = 'button, input, textarea, select, a, .tab, .choice, #panel, .ticker';

island.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.target.closest(NOT_A_HANDLE)) return;
  press = { x: e.screenX, id: e.pointerId, dragging: false };
  clearTimeout(hoverTimer); // holding the button never unfolds the island
  holdTimer = setTimeout(startDrag, 220);
});

island.addEventListener('pointermove', (e) => {
  if (!press) return;
  if (e.buttons === 0) return endPress(); // released somewhere we did not hear about
  if (!press.dragging && Math.abs(e.screenX - press.x) > 5) startDrag();
});

function startDrag() {
  clearTimeout(holdTimer);
  if (!press || press.dragging) return;
  press.dragging = true;
  // Capture only now: a plain click must keep reaching Gany or the alert.
  try {
    island.setPointerCapture(press.id);
  } catch {
    /* pointer already released */
  }
  island.classList.add('dragging');
  api.send('drag', 'start');
}

function endPress() {
  clearTimeout(holdTimer);
  if (!press) return;
  if (press.dragging) {
    api.send('drag', 'end');
    island.classList.remove('dragging');
    swallowClick = true; // the click that ends a drag is not a click
    setTimeout(() => (swallowClick = false), 80);
  }
  press = null;
  lastRest = null;
  if (S.hovered) armRest();
}
island.addEventListener('pointerup', endPress);
island.addEventListener('pointercancel', endPress);
island.addEventListener('lostpointercapture', endPress);
island.addEventListener('click', (e) => {
  if (swallowClick) {
    e.stopPropagation();
    e.preventDefault();
  }
}, true);

// ── Mood ─────────────────────────────────────────────────────────────────

function attention() {
  return Object.values(S.states).some((st) => (st?.mood?.priority ?? 0) >= 60);
}

/** In a call, Gany keeps quiet about everything below the threshold. */
const hushed = () => !!S.call?.active;

function updateMood() {
  let best = { name: 'idle', priority: 0 };
  for (const st of Object.values(S.states)) {
    const m = st?.mood;
    if (m && m.name && (m.priority ?? 1) > best.priority) best = { name: m.name, priority: m.priority ?? 1 };
  }
  // The alert being shown (it passed the filter) still speaks for itself.
  if (hushed() && best.priority < (S.call.threshold ?? 100)) best = { name: 'meeting-call', priority: 1 };
  if (best.name === 'meeting-call' && focusing()) best = { name: 'focus', priority: 1 }; // Gany's focus mode
  applyFocus();
  if (S.alert?.mood && (S.alert.priority ?? 50) > best.priority && !(hushed() && S.mode !== 'peek')) best = { name: S.alert.mood, priority: S.alert.priority ?? 50 };
  if (S.localMood && S.localMood.until > Date.now()) best = S.localMood;
  else if (best.priority === 0) {
    const idleFor = Date.now() - S.lastActivity;
    const hour = new Date().getHours();
    if (S.settings.general?.paused || idleFor > 15 * 60 * 1000 || hour >= 22 || hour < 7) best = { name: 'sleeping' };
  }
  // Windows session locked: Gany sleeps until you are back (src/main/modules.js → setSystem).
  if (S.system.locked) best = { name: 'sleeping' };
  gany.setMood(best.name);
  island.classList.toggle('attention', attention() && S.mode !== 'open' && !hushed());
  // Red glow for a meeting that starts or runs without you.
  island.classList.toggle('alarm', /^meeting-(now|late)$/.test(best.name));
}
setInterval(updateMood, 30000);

// ── Alerts ───────────────────────────────────────────────────────────────

function currentAlert() {
  const now = Date.now();
  const live = S.alerts.filter((a) => a.pin || now - a.at < (a.ttl ?? 9) * 1000);
  return live[live.length - 1] || null;
}

function dismiss(a) {
  S.alerts = S.alerts.filter((x) => x.key !== a.key);
  api.core('dismissAlert', a.key);
}

let alertTimer = null;
function onAlerts(list) {
  const known = new Set(S.alerts.map((a) => a.key + a.at));
  const fresh = list.filter((a) => !known.has(a.key + a.at));
  S.alerts = list;
  if (fresh.length) launcher?.interrupt();
  for (const a of fresh) if (a.sound) Sound.play(a.sound);
  if (fresh.some((a) => a.confetti)) confetti();
  if (fresh.length) S.lastActivity = Date.now();
  const top = currentAlert();
  S.alert = top;
  if (S.mode !== 'open') setMode(top ? 'peek' : 'notch');
  else if (top && !top.pin) dismiss(top); // already looking at the island
  clearTimeout(alertTimer);
  if (top && !top.pin) {
    const left = (top.ttl ?? 9) * 1000 - (Date.now() - top.at);
    alertTimer = setTimeout(() => {
      dismiss(top);
      if (S.mode === 'peek' && !S.hovered) close();
    }, Math.max(500, left));
  }
  updateMood();
}

function renderPeek() {
  const a = S.alert;
  if (!a) return;
  mount($('.peek-title'), a.from ? [h('span.from', a.from), ' · '] : null, a.title || '');
  mount($('.peek-text'), a.text || '');
  // One line each in the notch: the full wording on hover.
  $('.peek-title').parentElement.title = [a.from ? `${a.from} · ${a.title || ''}` : a.title, a.text].filter(Boolean).join('\n');
  // Alerts may carry their own buttons: { label, action, payload, primary }.
  mount(
    $('.peek-actions'),
    (a.actions || []).map((act) =>
      h('button.btn.sm' + (act.primary ? '.primary' : ''), {
        onclick: (e) => {
          e.stopPropagation();
          Sound.play(act.primary ? 'send' : 'tick');
          api.action(a.module, act.action, act.payload);
          if (act.dismiss !== false) {
            dismiss(a);
            S.alert = currentAlert();
            if (S.mode === 'peek') S.alert ? renderPeek() : close(true);
          }
        },
      }, act.label),
    ),
  );
  island.classList.toggle('peek-has-actions', !!a.actions?.length);
}

// ── Notch chips & header ────────────────────────────────────────────────

function summaries() {
  const out = [];
  for (const m of S.modules) {
    const view = S.views[m.id];
    const st = S.states[m.id];
    if (!m.enabled || !view?.summary || !st) continue;
    try {
      const s = view.summary(st);
      if (s) out.push({ module: m, ...s });
    } catch (err) {
      console.error(m.id, 'summary', err);
    }
  }
  return out;
}

// ── Ticker: a line that passes in the notch (« ambrosia · view.js +12 −3 · main.js +4 ») ──
// A module's summary may carry `ticker: { key, at, seq, ttl, foldedOnly, lead, parts:
// [{ name, add, del }], more, action: { name, payload }, title }`. Not an alert: no
// sound, no peek, no mood. Never in a call, in focus mode, paused, or in the thin line.

const TICKER_TTL = 5000;
let tickerTimer = null;
let tickerSeen = '';

function activeTicker(where) {
  if (S.settings.general?.paused || hushed() || focusing()) return null;
  const now = Date.now();
  let best = null;
  for (const s of summaries()) {
    const t = s.ticker;
    if (!t?.parts?.length || now - t.at > (t.ttl ?? TICKER_TTL) || (where === 'header' && t.foldedOnly)) continue;
    if (!best || t.at > best.at) best = { ...t, module: s.module.id };
  }
  return best;
}

function tickerEl(t) {
  const id = `${t.key}#${t.seq ?? t.at}`;
  const fresh = id !== tickerSeen; // slide in only when the line changes, not on every re-render
  tickerSeen = id;
  const sep = () => h('span.tk-sep', '·');
  return h('span.ticker' + (fresh ? '.tk-in' : ''), {
    title: t.title || '',
    onclick: (e) => {
      e.stopPropagation();
      if (t.action) api.action(t.module, t.action.name, t.action.payload);
    },
  },
    t.lead ? [h('span.tk-lead', t.lead), sep()] : null,
    t.parts.map((p, i) => [
      i ? sep() : null,
      h('span.tk-file', p.name),
      p.add ? h('span.tk-add', `+${p.add}`) : null,
      p.del ? h('span.tk-del', `−${p.del}`) : null,
      p.text ? h('span.tk-more', p.text) : null, // free text instead of counts (Scripts: « 30 % »)
      !p.add && !p.del && !('text' in p) ? h('span.tk-more', '±0') : null,
    ]),
    t.more ? [sep(), h('span.tk-more', `+${t.more}`)] : null,
  );
}

/** Wakes up when the freshest ticker expires, to fold it away. */
function armTicker() {
  clearTimeout(tickerTimer);
  const t = activeTicker('notch') || activeTicker('header');
  if (!t) return;
  tickerTimer = setTimeout(() => {
    renderNotch();
    if (S.mode === 'open') renderHeader();
  }, Math.max(100, (t.ttl ?? TICKER_TTL) - (Date.now() - t.at) + 30));
}

function renderNotch() {
  const ticker = S.mode === 'notch' ? activeTicker('notch') : null;
  armTicker();
  if (ticker) {
    mount($('#notch-row'), tickerEl(ticker));
    return setMode('notch');
  }
  const chips = [];
  for (const s of summaries()) {
    // `progress` (0..1): the dot becomes a ring that fills up (Scripts).
    for (const d of s.dots || []) {
      const ring = typeof d.progress === 'number';
      chips.push(h('span.chip', h('span.dot' + (d.pulse ? '.pulse' : '') + (ring ? '.ring' : ''), { style: { '--c': d.color, '--p': ring ? `${Math.round(d.progress * 360)}deg` : null } })));
    }
    if (s.badge) {
      // The logo says which source; the glyph in front of the text is then redundant.
      const text = s.module.logo ? String(s.badge.text).replace(/^[^\p{L}\p{N}!]\s+/u, '') : s.badge.text;
      chips.push(h('span.chip', s.module.logo ? moduleIcon(s.module, 'chip-logo') : null, h('span.chip.badge', { style: { '--c': s.badge.color || s.module.color } }, text)));
    }
  }
  // Laurels for an on-time meeting streak (Agenda).
  const trophy = summaries().find((x) => x.trophy);
  if (trophy) chips.unshift(h('span.chip.trophy', { title: `${trophy.trophy} réunions à l’heure d’affilée` }, '🏆', String(trophy.trophy)));
  // In a call: a quiet mark, and how many things wait for the recap.
  if (hushed()) {
    const q = S.call.queued || 0;
    chips.unshift(h('span.chip.call', { title: q ? `${hushName()} : ${q} en attente pour après` : `${hushName()} : Gany ne dérange pas` }, '◐', q ? String(q) : null));
  }
  mount($('#notch-row'), chips);
  if (S.mode === 'notch' || S.mode === 'line') setMode('notch');
}

const ICONS = {
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 5v14M15 5v14"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M7 5l12 7-12 7z"/></svg>',
  sound: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>',
  update: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/></svg>',
  mute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="m22 9-6 6M16 9l6 6"/></svg>',
};

function iconBtn(name, title, onclick, on) {
  const b = h('button.icon-btn' + (on ? '.on' : ''), { title, onclick });
  b.innerHTML = ICONS[name]; // static, trusted SVG only
  return b;
}

function greetingLine() {
  const parts = summaries().map((s) => s.text).filter(Boolean);
  if (parts.length) return parts.join(' · ');
  const hour = new Date().getHours();
  return hour < 12 ? 'Bonjour ! L’Olympe est calme.' : hour < 18 ? 'Tout est calme sur l’Olympe.' : 'Bonsoir. Rien à signaler.';
}

const IDLE_PHRASES = [
  'L’Olympe est calme. Une coupe d’ambroisie ?',
  'Rien à signaler, je polis ma couronne.',
  'Hermès est jaloux de mon efficacité.',
  'Je veille. Zeus aussi, mais moins bien.',
  'Tout est rangé sur l’Olympe.',
];
let phraseIndex = Math.floor(Math.random() * IDLE_PHRASES.length);

/** One short sentence about what matters now, picked fresh at each unfolding. */
function phrase() {
  if (S.settings.gany?.phrases === false) return greetingLine();
  const ag = S.states.agenda || {};
  const now = Date.now();
  const next = (ag.meetings || []).find((m) => m.startMs > now && !m.acked);
  const inMeeting = (ag.meetings || []).find((m) => m.joined && m.startMs <= now && now < m.endMs);
  const working = (S.states.claude?.sessions || []).find((x) => ['working', 'thinking'].includes(x.state));
  const options = [];
  options.push(...ganyLines()); // Gany's character block, below
  if (hushed()) {
    const q = S.call.queued || 0;
    const what = hushName();
    options.push(q ? `${what} : je garde ${q} chose${q > 1 ? 's' : ''} pour après.` : `${what}${what === 'En appel' && S.call.title ? ` (${S.call.title})` : ''}. Je ne dérange pas.`);
  }
  if (inMeeting) options.push(`Tu es en réunion (${inMeeting.title}). Je fais le guet.`);
  if (next) {
    const m = Math.round((next.startMs - now) / 60000);
    if (m <= 60) options.push(m <= 10 ? `${next.title} dans ${m} min, prépare-toi !` : `Encore ${m} min avant « ${next.title} », fonce !`);
  }
  if (working) options.push(`Claude bosse pour toi sur ${working.project}.`);
  const mail = S.states.mail?.unread || 0;
  const cu = S.states.clickup?.unread || 0;
  if (mail) options.push(mail > 1 ? `${mail} mails importants t’attendent.` : 'Un mail important t’attend.');
  if (cu) options.push(cu > 1 ? `${cu} interactions ClickUp te réclament.` : 'Quelqu’un te réclame sur ClickUp.');
  if (ag.trophy) options.push(`${ag.trophy} réunions à l’heure d’affilée. Couronne méritée !`);
  if (!options.length) {
    if (S.settings.gany?.occasions !== false && S.states.gany?.occasion?.phrase) options.push(S.states.gany.occasion.phrase);
    const hour = new Date().getHours();
    if (hour < 10) options.push('Le café d’abord, l’Olympe ensuite.');
    else if (hour >= 18) options.push('Il se fait tard, même les dieux rentrent.');
    phraseIndex = (phraseIndex + 1) % IDLE_PHRASES.length;
    options.push(IDLE_PHRASES[phraseIndex]);
  }
  return options[0];
}
let currentPhrase = null;

function renderHeader() {
  const g = S.settings.general || {};
  mount($('.hello-title'), 'Gany ', h('span.faint.small', '· '), h('span.amb', 'Ambrosia'));
  // A fresh phrase at each unfolding; the full summary stays in the tooltip.
  if (!currentPhrase || S.mode !== 'open') currentPhrase = phrase();
  // Unfolded, the edits still pass by in the header (unless « seulement replié »).
  const ticker = S.mode === 'open' ? activeTicker('header') : null;
  if (ticker) armTicker();
  mount($('.hello-sub'), ticker ? tickerEl(ticker) : currentPhrase);
  $('.hello-sub').title = greetingLine();
  mount(
    $('.tools'),
    updateBtn(),
    iconBtn(g.sounds === false ? 'mute' : 'sound', g.sounds === false ? 'Réactiver les sons' : 'Couper les sons', () =>
      api.core('setSettings', { section: 'general', patch: { sounds: g.sounds === false } }),
    ),
    iconBtn(
      g.paused ? 'play' : 'pause',
      g.paused ? 'Reprendre' : 'Pause : Gany ne dérange plus',
      () => api.core('setSettings', { section: 'general', patch: { paused: !g.paused } }),
      g.paused,
    ),
    iconBtn('gear', 'Réglages', () => api.core('openSettings')),
  );
}

/**
 * A newer Ambrosia is downloaded (src/main/updater.js): « Mettre à jour », next to the
 * icons. Nothing installs during the day without this click.
 */
function updateBtn() {
  const u = S.update || {};
  if (u.mode !== 'packaged' || !['ready', 'installing'].includes(u.status)) return null;
  const busy = u.status === 'installing';
  const b = h(
    'button.upd-btn' + (busy ? '.busy' : ''),
    {
      title: busy ? 'Installation…' : `Installer la version ${u.ready} (en place : ${u.running}). Ambrosia redémarre aussitôt.`,
      disabled: busy,
      onclick: () => {
        Sound.play('tick');
        S.update = { ...u, status: 'installing' };
        renderHeader();
        api.core('updateInstall').catch((err) => {
          S.update = { ...u, status: 'error', error: err.message };
          renderHeader();
        });
      },
    },
    busy ? 'Mise à jour…' : 'Mettre à jour',
  );
  b.insertAdjacentHTML('afterbegin', ICONS.update); // static, trusted SVG only
  return b;
}

const viewable = (id) => S.modules.some((m) => m.id === id && m.enabled && S.views[id]);
const firstViewable = () => S.modules.find((m) => m.enabled && S.views[m.id])?.id || null;

// Sections rarely visited (`secondary` in the module) wait behind « ⋮ », in a
// vertical list under the tabs: the button carries their count, and only the one
// open comes into the row (`moreOpen` is declared with close()).

function renderTabs() {
  const sums = Object.fromEntries(summaries().map((s) => [s.module.id, s]));
  const shown = [];
  const tucked = [];
  for (const m of S.modules.filter((m) => m.enabled && S.views[m.id])) {
    (m.secondary && S.selected !== m.id ? tucked : shown).push(m);
  }
  if (!tucked.length) moreOpen = false;
  const tab = (m) => {
    // Quiet sections are just their logo; a section that needs you shows
    // logo + name + count, so the eye goes straight to it.
    const count = sums[m.id]?.count;
    return h(
      'button.tab' + (S.selected === m.id ? '.sel' : '') + (count ? '.loud' : '.quiet'),
      { style: { '--c': m.color }, title: sums[m.id]?.text ? `${m.name} — ${sums[m.id].text}` : m.name, onclick: () => select(m.id) },
      moduleIcon(m),
      count ? [h('span.tab-name', m.name), h('span.count', String(count))] : null,
    );
  };
  const waiting = tucked.reduce((n, m) => n + (Number(sums[m.id]?.count) || 0), 0);
  const toggle = () => {
    moreOpen = !moreOpen;
    renderTabs();
  };
  mount(
    $('#tabs'),
    shown.map(tab),
    tucked.length
      ? h(
          'button.tab.more' + (moreOpen ? '.sel' : '') + (waiting ? '.loud' : '.quiet'),
          { title: `Autres sections : ${tucked.map((m) => m.name).join(', ')}`, onclick: toggle },
          h('span.ico', '⋮'),
          waiting ? h('span.count', String(waiting)) : null,
        )
      : null,
  );
  mount(
    moreList(),
    moreOpen
      ? tucked.map((m) =>
          h(
            'button.more-item',
            {
              style: { '--c': m.color },
              onclick: () => {
                moreOpen = false;
                if (S.selected === m.id) renderTabs();
                else select(m.id);
              },
            },
            moduleIcon(m),
            h('span.more-name', m.name),
            sums[m.id]?.text ? h('span.more-sub', sums[m.id].text) : null,
            sums[m.id]?.count ? h('span.count', String(sums[m.id].count)) : null,
          ),
        )
      : null,
  );
}

/** The vertical list behind « ⋮ », right under the tabs. */
function moreList() {
  let el = document.getElementById('more');
  if (!el) {
    el = document.createElement('div');
    el.id = 'more';
    $('#tabs').after(el);
  }
  return el;
}

/** The module's brand logo when it has one, its glyph otherwise. */
function moduleIcon(m, cls = 'logo') {
  return m.logo ? h(`img.${cls}`, { src: m.logo, alt: '', draggable: false }) : h('span.ico', m.icon);
}

function select(id) {
  if (S.selected === id) return;
  S.selected = id;
  Sound.play('tick');
  renderOpen(true);
  takeKeys();
}

// ── Module views ─────────────────────────────────────────────────────────

const mounted = { id: null };

function uiFor(id) {
  return {
    h, mount, ago, clip, markdown,
    sound: Sound,
    action: (name, payload) => api.action(id, name, payload),
    core: (name, payload) => api.core(name, payload),
    settings: () => S.settings[id] || {},
    pin: (on = true) => {
      S.pinned = on;
      if (!on && !S.hovered) leaveTimer = setTimeout(() => close(), 1500);
    },
    close: () => close(true),
    open: () => open(id),
    flash,
    focusWindow: () => {
      api.send('mouse', true);
      api.send('focus-island');
    },
    relayout: () => layout(),
    /** Re-renders this module's panel after a local UI change (fold, selection…). */
    rerender: () => S.selected === id && S.mode === 'open' && renderPanel(),
  };
}

function renderPanel(force = false) {
  const panel = $('#panel');
  const id = S.selected;
  const view = S.views[id];
  if (!view) return mount(panel, h('div.empty', 'Aucun module actif. Active-en dans les réglages.'));
  const state = S.states[id] || {};
  const ui = uiFor(id);
  try {
    if (view.mount) {
      if (mounted.id !== id || force) {
        panel.replaceChildren();
        view.mount(panel, ui);
        mounted.id = id;
      }
      view.update?.(panel, state, ui);
    } else {
      // Never yank a text field from under the user's fingers: re-render on blur.
      const active = document.activeElement;
      if (!force && mounted.id === id && panel.contains(active) && /INPUT|TEXTAREA|SELECT/.test(active.tagName)) {
        active.addEventListener('blur', () => setTimeout(() => renderPanel(), 0), { once: true });
        return;
      }
      mounted.id = id;
      const scroll = panel.scrollTop;
      panel.replaceChildren();
      view.render(panel, state, ui);
      panel.scrollTop = scroll;
    }
  } catch (err) {
    console.error(id, err);
    mount(panel, h('div.empty', `Le module ${id} a planté : ${err.message}`));
  }
}

function renderOpen(force = false) {
  renderHeader();
  renderTabs();
  renderPanel(force);
  layout();
}

async function loadViews() {
  for (const m of S.modules) {
    if (!m.hasView || S.views[m.id]) continue;
    try {
      S.views[m.id] = (await import(`../modules/${m.dir}/view.js`)).default;
    } catch (err) {
      console.error('view', m.id, err);
    }
  }
}

// ── Main → island ────────────────────────────────────────────────────────

function onStateChanged(id) {
  renderNotch();
  if (S.mode === 'open') {
    renderHeader();
    renderTabs();
    if (id === S.selected) renderPanel();
  }
  updateMood();
  takeKeys();
}

api.on('state', ({ id, state }) => {
  S.states[id] = state;
  if (id === 'agenda' || id === 'gany') dressGany();
  onStateChanged(id);
});

api.on('alerts', onAlerts);

api.on('call', (call) => {
  S.call = call;
  renderNotch();
  if (S.mode === 'open') renderHeader();
  updateMood();
});

api.on('update', (u) => {
  S.update = u || {};
  if (S.mode === 'open') renderHeader();
});

api.on('system', (system) => {
  S.system = system || {};
  layout();
  updateMood();
});

/** What holds the alerts back, in a word: « En appel », « Plein écran »… */
function hushName() {
  const kinds = S.call?.kinds || ['call'];
  if (kinds.includes('call')) return 'En appel';
  if (kinds.includes('fullscreen')) return { presentation: 'Présentation', game: 'En jeu' }[S.system.fullscreen] || 'Plein écran';
  if (kinds.includes('lock')) return 'Session verrouillée';
  return S.call?.title || 'En appel';
}

api.on('expand', ({ id, pin }) => {
  if (pin) S.pinned = true;
  open(id || undefined);
  if (id && S.selected !== id) select(id);
  else if (S.mode === 'open') renderOpen();
});

api.on('unpin', ({ id }) => {
  if (!S.selected || S.selected === id) uiFor(id).pin(false);
});

api.on('reveal', () => {
  gany.poke();
  S.lastActivity = Date.now();
  updateMood();
});

api.on('settings', (settings) => {
  S.settings = settings;
  Sound.configure(settings.general || {});
  S.modules = S.modules.map((m) => ({ ...m, enabled: settings[m.id]?.enabled !== false }));
  if (S.mode === 'open') renderOpen();
  renderNotch();
  updateMood();
});

api.on('manifest', async (modules) => {
  S.modules = modules;
  await loadViews();
  renderNotch();
  if (S.mode === 'open') renderOpen(true);
});

// ── Gany's character ─────────────────────────────────────────────────────
// What Gany says without a word: impatience while an approval waits, the
// focus mode (tiny Gany, only the urgent passes).
// Each piece can be switched off in Réglages → Gany.

const MIN = 60000;

/** 0..3: how long the oldest Claude Code approval / question has been waiting. */
function impatienceLevel() {
  if (S.settings.gany?.impatience === false) return 0;
  const pending = S.states.claude?.pending || [];
  if (!pending.length) return 0;
  const waited = Date.now() - Math.min(...pending.map((p) => p.at || Date.now()));
  return waited >= 5 * MIN ? 3 : waited >= 2 * MIN ? 2 : waited >= 30000 ? 1 : 0;
}

let impatienceNow = 0;
function tickImpatience() {
  const level = impatienceLevel();
  if (level === impatienceNow) return;
  impatienceNow = level;
  gany.setImpatience(level);
  island.classList.toggle('impatient', level >= 2);
  if (S.mode === 'open') {
    currentPhrase = null;
    renderHeader();
  }
}
setInterval(tickImpatience, 5000);

/** Focus mode (src/modules/gany, started from the right-click menu). */
function focusing() {
  return (S.states.gany?.focus?.until || 0) > Date.now();
}
function applyFocus() {
  const on = focusing();
  if (on === island.classList.contains('focus')) return;
  island.classList.toggle('focus', on);
  if (S.mode === 'notch') layout(); // the hidden chips change the notch's width
}

/** Lines that come before everything else in the header. */
function ganyLines() {
  const out = [];
  if (focusing()) {
    const at = new Date(S.states.gany.focus.until).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', ' h ');
    const q = S.call?.queued || 0;
    // Started by Windows « Ne pas déranger »: it lasts as long as it does.
    const lead = S.states.gany.focus.dnd ? 'Ne pas déranger' : `Concentration jusqu’à ${at}`;
    out.push(`${lead}${q ? ` : je garde ${q} chose${q > 1 ? 's' : ''} pour après` : ', seul l’urgent passe'}.`);
  }
  const pending = S.states.claude?.pending || [];
  if (impatienceNow && pending.length) {
    const waited = Math.round((Date.now() - Math.min(...pending.map((p) => p.at || Date.now()))) / MIN);
    const who = pending[0].project || 'Claude';
    out.push(waited >= 1 ? `${who} attend ton feu vert depuis ${waited} min.` : `${who} attend ton feu vert.`);
  }
  return out;
}

// ── Boot ─────────────────────────────────────────────────────────────────

async function boot() {
  const b = await api.core('boot');
  window.__dev = b.dev;
  if (b.dev) console.log('boot', b.modules.map((m) => m.id).join(','));
  S.modules = b.modules;
  S.states = b.states;
  S.settings = b.settings;
  S.call = b.call || null;
  S.system = b.system || {};
  S.update = b.update || {};
  Sound.configure(b.settings.general || {});
  await loadViews();
  renderNotch();
  sendTrayIcon();
  dressGany();
  const kind = launchKind(S.settings.gany?.launch);
  if (kind && !reducedMotion()) startLaunch(kind);
  else if (kind) quietGreeting();
  if (b.alerts?.length) onAlerts(b.alerts);
}

// ── Gany's entrance ──────────────────────────────────────────────────────
// launch.js plays « l'ouverture du temple »: the big one the first time of the
// day, a short one after a restart. Réglages → Gany → Arrivée de Gany.

function startLaunch(kind = 'full') {
  if (launcher?.active) return;
  const g = S.settings.gany || {};
  const hour = new Date().getHours();
  const name = S.states.agenda?.selfName ? ` ${S.states.agenda.selfName}` : '';
  const hello = hour < 5 || hour >= 18 ? 'Bonsoir' : 'Bonjour';
  const words = kind === 'full' ? { title: 'Χαῖρε !', sub: `${hello}${name}, Gany est à ton service.` } : { title: 'Me revoilà !', sub: 'Gany reprend son service.' };
  if (g.launchSound !== false) Sound.play(kind === 'full' ? 'launch' : 'relaunch');
  launcher = new Launch({
    island,
    kind,
    words,
    dress: { outfit: gany.outfit, energy: gany.energy },
    rest: () => {
      const cs = getComputedStyle(canvas);
      return { ...lastSize, gx: parseFloat(cs.left) || 8, gy: parseFloat(cs.top) || 1, gs: parseFloat(cs.width) || 28, hidden: S.mode === 'line' };
    },
    onDone: () => {
      layout();
      updateMood();
    },
  });
}

/** Without motion (prefers-reduced-motion): a plain, silent hello in the notch. */
function quietGreeting() {
  S.alert = { key: 'greet', title: 'Χαῖρε ! Gany est à ton service.', text: 'Survole l’encoche pour me déplier.', mood: 'greet', priority: 99 };
  setMode('peek');
  setTimeout(() => {
    if (S.alert?.key === 'greet') {
      S.alert = null;
      if (S.mode === 'peek' && !S.hovered) close();
    }
    updateMood();
  }, 3200);
}

// Replayed from Gany's right-click menu (or the dev bar).
api.on('launch', ({ kind } = {}) => {
  if (S.mode === 'open') close(true);
  startLaunch(kind || 'full');
});

/** The tray icon is Gany himself, drawn by the same engine. */
function sendTrayIcon() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d');
  const g = new Gany(c);
  g.draw(performance.now(), ctx, 32);
  api.send('tray-icon', c.toDataURL('image/png'));
}

boot();
