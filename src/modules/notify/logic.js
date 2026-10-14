// Scripts — pure logic: what a script sent (hook/ambrosia-notify.js), what the island
// shows. No Electron, no timers: src/modules/notify/main.js owns those.
//
// A message with a key is a live activity (progress bar, notch dot) until --done or
// --error; without a key it is a one-shot note. Everything coming in is untrusted
// text from the pipe: cleaned, capped, and only ever inserted as text by the view.

const path = require('path');

const LIMITS = {
  keys: 20, // live activities at once
  key: 40,
  title: 60,
  text: 160,
  open: 600,
  recent: 12, // finished ones kept in the tab
  everyMs: 1000, // one update per second and per key, the latest wins
  staleMs: 30 * 60000, // no news for 30 min: the activity expires
  alertsPerMin: 6, // a script in a loop does not flood the notch
  ttlMin: 3,
  ttlMax: 3600,
};

const PRIORITY = { low: 30, normal: 55, high: 80 };
const MILESTONES = 4; // a ticker line at 25, 50, 75 %

// Opened as their folder rather than run: --open is a « show me », never a « run this ».
const EXECUTABLE = /\.(exe|com|bat|cmd|ps1|psm1|psd1|vbs|vbe|js|jse|wsf|wsh|ws|msi|msp|mst|scr|hta|cpl|msc|jar|lnk|url|reg|pif|scf|inf|sct|application|appref-ms|gadget|dll|sys|xll|psc1|diagcab|settingcontent-ms)$/i;

/** Control characters out, whitespace collapsed, capped with an ellipsis. */
function cleanText(v, n) {
  if (v == null) return '';
  const s = String(v).replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
}

const cleanKey = (v) =>
  String(v ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, LIMITS.key);

/**
 * Where « Ouvrir » goes: { kind: 'url' | 'path', target } or null.
 * https only for addresses; an absolute Windows path (drive or UNC) otherwise.
 */
function openTarget(v) {
  if (typeof v !== 'string' || !v || v.length > LIMITS.open || /[\u0000-\u001f]/.test(v)) return null;
  if (/^https:\/\//i.test(v)) {
    try {
      const u = new URL(v);
      return u.protocol === 'https:' && u.hostname ? { kind: 'url', target: u.href } : null;
    } catch {
      return null;
    }
  }
  // C:\… or \\server\share\… — not the \\?\ and \\.\ device namespaces.
  if (/^[a-z]:[\\/]/i.test(v) || /^\\\\(?![?.][\\/])[^\\/]+[\\/][^\\/]+/.test(v)) return { kind: 'path', target: path.win32.normalize(v) };
  return null;
}

/** What the click does: open the address, the file / folder, or the folder of an executable. */
function openPlan(open) {
  if (!open) return null;
  if (open.kind === 'url') return { how: 'url', target: open.target };
  if (EXECUTABLE.test(open.target)) return { how: 'folder', target: path.win32.dirname(open.target) };
  return { how: 'path', target: open.target };
}

/** The pipe payload → a clean message, or { error }. */
function normalize(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return { error: 'message illisible' };
  const key = cleanKey(p.key);
  const status = p.state === 'done' || p.state === 'error' ? p.state : key ? 'live' : 'info';
  const msg = {
    key,
    status,
    title: cleanText(p.title, LIMITS.title),
    text: p.text == null ? undefined : cleanText(p.text, LIMITS.text),
    progress: typeof p.progress === 'number' && Number.isFinite(p.progress) ? Math.min(1, Math.max(0, p.progress)) : undefined,
    ttl: typeof p.ttl === 'number' && p.ttl > 0 ? Math.round(Math.min(LIMITS.ttlMax, Math.max(LIMITS.ttlMin, p.ttl))) : undefined,
    pin: p.pin === true || undefined,
    quiet: p.quiet === true || undefined,
    priority: PRIORITY[p.priority] ? p.priority : undefined,
    open: p.open == null ? undefined : openTarget(p.open) || undefined,
  };
  if (!msg.title && !msg.text && !(key && (status !== 'live' || msg.progress !== undefined))) return { error: 'rien à afficher' };
  return { msg };
}

/** "en 14 min", "en 1 h 05", "en 40 s". */
function duration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `en ${Math.max(1, s)} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `en ${m} min`;
  return `en ${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

const pct = (p) => `${Math.round(p * 100)} %`;

/**
 * The live activities and the recent ones. `apply(msg, now)` →
 * { kind: 'start' | 'update' | 'milestone' | 'done' | 'error' | 'info' | 'full', item }.
 */
class Board {
  constructor(saved = {}) {
    this.live = new Map();
    this.recent = Array.isArray(saved.recent) ? saved.recent.slice(0, LIMITS.recent) : [];
    this.lastAt = new Map(); // key → last applied update (throttle)
    this.alertTimes = [];
    this.seq = 0;
  }

  newId(key, now) {
    return `${key || 'note'}-${now.toString(36)}-${++this.seq}`;
  }

  /** ms to wait before this live update may be applied (0 = now). Terminal ones never wait. */
  wait(msg, now) {
    if (msg.status !== 'live') return 0;
    const last = this.lastAt.get(msg.key);
    return last == null ? 0 : Math.max(0, last + LIMITS.everyMs - now);
  }

  apply(msg, now) {
    if (msg.status === 'info') {
      const item = { id: this.newId('', now), key: '', status: 'info', title: msg.title, text: msg.text || '', open: msg.open || null, endedAt: now, msg };
      this.remember(item);
      return { kind: 'info', item };
    }
    const prev = this.live.get(msg.key);
    if (msg.status === 'live') {
      if (!prev && this.live.size >= LIMITS.keys) return { kind: 'full', item: null };
      this.lastAt.set(msg.key, now);
      const item = {
        id: prev?.id || this.newId(msg.key, now),
        key: msg.key,
        status: 'live',
        title: msg.title || prev?.title || msg.key,
        text: msg.text ?? prev?.text ?? '',
        progress: msg.progress ?? prev?.progress ?? null,
        open: msg.open || prev?.open || null,
        quiet: msg.quiet ?? prev?.quiet,
        priority: msg.priority || prev?.priority,
        startedAt: prev?.startedAt || now,
        updatedAt: now,
      };
      this.live.set(msg.key, item);
      if (!prev) return { kind: 'start', item };
      const before = prev.progress == null ? -1 : Math.floor(prev.progress * MILESTONES);
      const after = item.progress == null ? -1 : Math.floor(item.progress * MILESTONES);
      return { kind: after > before && item.progress < 1 && after > 0 ? 'milestone' : 'update', item };
    }
    // done / error: the end of an activity, known or not.
    this.live.delete(msg.key);
    this.lastAt.delete(msg.key);
    const item = {
      id: prev?.id || this.newId(msg.key, now),
      key: msg.key,
      status: msg.status,
      title: msg.title || prev?.title || msg.key,
      text: msg.text ?? '',
      progress: msg.status === 'done' ? 1 : (msg.progress ?? prev?.progress ?? null),
      open: msg.open || prev?.open || null,
      startedAt: prev?.startedAt || null,
      endedAt: now,
      msg: { ...msg, quiet: msg.quiet ?? prev?.quiet, priority: msg.priority || prev?.priority },
    };
    this.remember(item);
    return { kind: msg.status, item };
  }

  remember(item) {
    const { msg, ...kept } = item;
    this.recent = [kept, ...this.recent.filter((r) => r.id !== item.id)].slice(0, LIMITS.recent);
  }

  /** Activities without news for staleMs: moved to recent as « sans nouvelles ». */
  expire(now) {
    const gone = [];
    for (const [key, a] of this.live) {
      if (now - a.updatedAt < LIMITS.staleMs) continue;
      this.live.delete(key);
      this.lastAt.delete(key);
      const item = { ...a, status: 'stale', endedAt: a.updatedAt };
      this.remember(item);
      gone.push(item);
    }
    return gone;
  }

  forget(key) {
    this.lastAt.delete(key);
    return this.live.delete(key);
  }

  dismiss(id) {
    const n = this.recent.length;
    this.recent = this.recent.filter((r) => r.id !== id);
    return n !== this.recent.length;
  }

  find(id) {
    for (const a of this.live.values()) if (a.id === id) return a;
    return this.recent.find((r) => r.id === id) || null;
  }

  /** At most alertsPerMin alerts a minute; past that, the tab still records them. */
  alertAllowed(now) {
    this.alertTimes = this.alertTimes.filter((t) => now - t < 60000);
    if (this.alertTimes.length >= LIMITS.alertsPerMin) return false;
    this.alertTimes.push(now);
    return true;
  }

  liveList() {
    return [...this.live.values()].sort((a, b) => a.startedAt - b.startedAt);
  }
}

/** The alert an ending activity (or a one-shot note) raises. */
function alertFor(kind, item) {
  const msg = item.msg || {};
  const prio = msg.priority || 'normal';
  const error = kind === 'error';
  const silent = msg.quiet || prio === 'low';
  const took = item.startedAt ? duration(item.endedAt - item.startedAt) : '';
  const text = item.text || (error ? 'Échec' : kind === 'done' ? `Terminé${took ? ' ' + took : ''}` : '');
  return defined({
    key: item.key || item.id,
    from: 'Script',
    title: item.title || (error ? 'Un script a échoué' : 'Script'),
    text,
    mood: error ? 'error' : kind === 'done' ? 'finished' : 'wink',
    // The real voice for a failure; a discreet tick for an end or a note (the finish
    // chord when the script asked for --priority high). --quiet / low: silence.
    sound: silent ? null : error ? 'error' : prio === 'high' ? 'finish' : 'tick',
    priority: PRIORITY[prio] + (error ? 10 : 0),
    ttl: msg.ttl ?? (error ? 30 : undefined),
    pin: msg.pin || undefined,
    count: 1,
    actions: item.open ? [{ label: 'Ouvrir', action: 'open', payload: { id: item.id }, primary: true }] : undefined,
  });
}

/** Without its undefined fields: the host's defaults (alert ttl…) must not be overwritten by them. */
function defined(o) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

/** The line that passes in the folded notch when an activity starts or crosses a quarter. */
function tickerFor(item, seq, now) {
  return {
    key: `notify:${item.key}`,
    at: now,
    seq,
    ttl: 4000,
    foldedOnly: true,
    lead: item.title,
    parts: [{ name: item.text || (item.progress == null ? 'en cours' : 'avancement'), text: item.progress == null ? null : pct(item.progress) }],
    action: { name: 'show', payload: { id: item.id } },
    title: [item.title, item.text].filter(Boolean).join(' — '),
  };
}

module.exports = { LIMITS, PRIORITY, Board, normalize, defined, cleanText, cleanKey, openTarget, openPlan, alertFor, tickerFor, duration, pct };
