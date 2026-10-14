// Ambrosia — entry point of the main process.
//
// One transparent, always-on-top window sits at the top centre of the primary
// screen. Everything outside the island shape lets clicks through
// (setIgnoreMouseEvents + forward), so the page decides when it wants the mouse.

const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, shell, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const paths = require('./paths');
const { store } = require('./store');
const log = require('./log').scope('core');
const hookServer = require('./hook-server');
const hooksInstall = require('./hooks-install');
const claude = require('./claude');
const host = require('./modules');
const foreground = require('./foreground');
const sys = require('./system');
const updater = require('./updater');

const DEV = process.argv.includes('--dev');
const WIN_W = 760;
const WIN_H = 600;

// A second Ambrosia beside the real one (scripts/smoke-update.js, with APPDATA and
// LOCALAPPDATA elsewhere): its own Electron profile, so its own single-instance lock,
// and no sign-in entry (that one is shared by the whole Windows account).
const ISOLATED = !!process.env.AMBROSIA_ISOLATED;
if (ISOLATED) app.setPath('userData', path.join(paths.roaming, 'electron'));

app.setAppUserModelId('fr.grayzor.ambrosia');
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let island = null;
let settingsWin = null;
let tray = null;
let cursorTimer = null;
let lastCursor = '';

// ── Island window ─────────────────────────────────────────────────────────────

// The display the island sits on (Réglages → Encoche → Écran: principal, souris, fenêtre active, choisi).
let displayId = null;
// The display under the pointer / of the window in front, once it stayed there a moment.
const follower = new sys.DisplayFollower(1000);

function targetDisplay() {
  return screen.getAllDisplays().find((d) => d.id === displayId) || screen.getPrimaryDisplay();
}

function wantedDisplay() {
  const i = store.section('island');
  return sys.pickDisplay(screen.getAllDisplays(), { mode: i.display, primaryId: screen.getPrimaryDisplay().id, followedId: follower.id, fixedId: i.displayId }) || screen.getPrimaryDisplay();
}

function placeIsland() {
  if (!island) return;
  clearTimeout(homeTimer);
  clearInterval(homeAnim);
  const target = wantedDisplay();
  displayId = target.id;
  const { bounds } = target;
  island.setBounds({
    x: Math.round(bounds.x + (bounds.width - WIN_W) / 2),
    y: bounds.y,
    width: WIN_W,
    height: WIN_H,
  });
}

function createIsland() {
  island = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    title: 'Ambrosia',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  island.setAlwaysOnTop(true, 'screen-saver');
  island.setIgnoreMouseEvents(true, { forward: true });
  applyCaptureProtection();
  placeIsland();
  island.loadFile(path.join(paths.ROOT, 'src', 'renderer', 'index.html'));
  island.once('ready-to-show', () => !aside && island.showInactive());
  island.on('closed', () => (island = null));
  // Errors in the island (a module view that throws…) land in the log too.
  island.webContents.on('console-message', (e) => {
    const level = e.level ?? 0;
    if (DEV || level === 'error' || level >= 3) log(`[island:${e.level}]`, e.message, e.sourceId ? `(${String(e.sourceId).split('/').slice(-2).join('/')}:${e.lineNumber})` : '');
  });
  island.webContents.on('render-process-gone', (_e, d) => log('island renderer gone', d.reason));
  // Other topmost windows (taskbar, some apps) can push us down: reassert now and then.
  setInterval(() => island && !island.isDestroyed() && island.setAlwaysOnTop(true, 'screen-saver'), 15000).unref();
  if (process.argv.includes('--devtools')) island.webContents.openDevTools({ mode: 'detach' });
}

/**
 * Hidden from screen capture (WDA_EXCLUDEFROMCAPTURE): a Meet share, a recording or
 * a remote-control tool never shows the island; you still see it. Réglages → Discrétion.
 */
function applyCaptureProtection() {
  if (island && !island.isDestroyed()) island.setContentProtection(store.get('discretion', 'hideFromCapture') !== false);
}

function send(channel, data) {
  if (island && !island.isDestroyed()) island.webContents.send(channel, data);
  if (settingsWin && !settingsWin.isDestroyed() && (channel === 'settings' || channel === 'update')) settingsWin.webContents.send(channel, data);
}

// Last time the user moved the mouse anywhere (Gany's sense of "you are here").
let lastMove = Date.now();

host.island = {
  send,
  expand: (id, pin) => send('expand', { id, pin }),
  reveal: () => send('reveal', {}),
  activity: () => ({ idleMs: Date.now() - lastMove }),
};

// The island's shape, in window coordinates, as reported by the page.
let islandRect = { x: 0, y: 0, w: 0, h: 0 };
let hovering = false;

/**
 * Hover detection and eye tracking, from one 20 Hz poll of the cursor.
 *
 * Mouse forwarding (setIgnoreMouseEvents forward:true) is unreliable on some
 * Windows setups, so the main process decides: inside the island shape the
 * window takes the mouse, everywhere else clicks go through to what is below.
 */
function startCursorFeed() {
  clearInterval(cursorTimer);
  let ticks = 0;
  cursorTimer = setInterval(() => {
    if (!island || island.isDestroyed()) return;
    const p = screen.getCursorScreenPoint();
    // Several screens: follow the pointer's display, or move once the island folded.
    if (++ticks % 4 === 0) followDisplays(p);
    // Stepped aside (full screen): nothing to hover.
    if (aside) return;
    const b = island.getBounds();
    const x = p.x - b.x;
    const y = p.y - b.y;
    const r = islandRect;
    // A few pixels of slack, and the very top row always counts (mouse slammed to the edge).
    const inside = r.w > 0 && x >= r.x - 4 && x <= r.x + r.w + 4 && y >= -2 && y <= r.y + r.h + 4;
    if (inside !== hovering) {
      hovering = inside;
      applyMouse();
      island.webContents.send('hover', inside);
    }
    watchDrop({ x, y });
    const key = `${p.x},${p.y}`;
    if (key === lastCursor) return;
    lastCursor = key;
    lastMove = Date.now();
    island.webContents.send('cursor', { x, y, sx: p.x, sy: p.y });
  }, 50);
}

// ── Moving the island along the top edge ────────────────────────────────
// The user slides it aside to click what is behind; it comes back to the
// centre on its own after island.returnSeconds (a temporary wish, not a setting).

let drag = null;
let dragTimer = null;
let homeTimer = null;
let homeAnim = null;

function homeX() {
  const { bounds } = targetDisplay();
  return Math.round(bounds.x + (bounds.width - WIN_W) / 2);
}

ipcMain.on('drag', (_e, phase) => {
  if (!island || island.isDestroyed()) return;
  if (phase === 'start') {
    clearTimeout(homeTimer);
    clearInterval(homeAnim);
    drag = { cursorX: screen.getCursorScreenPoint().x, winX: island.getBounds().x };
    clearInterval(dragTimer);
    dragTimer = setInterval(dragStep, 16);
  } else {
    clearInterval(dragTimer);
    drag = null;
    scheduleHome();
  }
});

function dragStep() {
  if (!drag || !island || island.isDestroyed()) return;
  const { bounds } = targetDisplay();
  const half = (islandRect.w || 200) / 2 + 12; // the ears stay on screen
  let center = drag.winX + WIN_W / 2 + (screen.getCursorScreenPoint().x - drag.cursorX);
  center = Math.max(bounds.x + half, Math.min(bounds.x + bounds.width - half, center));
  island.setPosition(Math.round(center - WIN_W / 2), bounds.y);
}

function scheduleHome() {
  clearTimeout(homeTimer);
  const secs = Number(store.get('island', 'returnSeconds'));
  if (!(secs > 0)) return;
  homeTimer = setTimeout(goHome, secs * 1000);
}

function goHome() {
  if (!island || island.isDestroyed() || drag) return;
  // Never slide away from under the pointer: wait until it leaves.
  if (hovering) {
    homeTimer = setTimeout(goHome, 3000);
    return;
  }
  const from = island.getBounds().x;
  const to = homeX();
  if (from === to) return;
  const started = Date.now();
  clearInterval(homeAnim);
  homeAnim = setInterval(() => {
    const t = Math.min(1, (Date.now() - started) / 420);
    const e = 1 - Math.pow(1 - t, 3);
    island.setPosition(Math.round(from + (to - from) * e), targetDisplay().bounds.y);
    if (t >= 1) clearInterval(homeAnim);
  }, 16);
}

ipcMain.on('island-rect', (_e, r) => {
  if (r && typeof r.w === 'number') islandRect = r;
});

// ── Windows integration ─────────────────────────────────────────────────────
// Full screen, session lock, « Ne pas déranger », several screens, file drags.
// The pure part is src/main/system.js; the watcher (one PowerShell loop) foreground.js.

/** The window takes the mouse over the island shape, and over the drop zone during a file drag. */
function applyMouse() {
  if (island && !island.isDestroyed()) island.setIgnoreMouseEvents(!(hovering || dropArmed), { forward: true });
}

// Full screen on the island's display (a video, a game, a presentation): the island
// steps aside — the page says when nothing needs showing, and the window hides.
let aside = false;
let fullscreen = null;

ipcMain.on('aside', (_e, on) => {
  if (!island || island.isDestroyed() || aside === !!on) return;
  aside = !!on;
  if (aside) {
    if (hovering) island.webContents.send('hover', false);
    hovering = false;
    setDropArmed(false);
    dropNear = false;
    foreground.watchButton(false);
    applyMouse();
    island.hide();
  } else {
    island.showInactive();
    island.setAlwaysOnTop(true, 'screen-saver');
  }
});

function checkFullscreen() {
  const fg = foreground.current;
  const rect = fg?.w > 0 ? screen.screenToDipRect(null, { x: fg.x, y: fg.y, width: fg.w, height: fg.h }) : null;
  const kind = store.get('discretion', 'fullscreen') === false ? null : sys.fullscreenKind(foreground.quns, rect, targetDisplay().bounds);
  if (kind === fullscreen) return;
  fullscreen = kind;
  log('plein écran :', kind || 'fini');
  // Held like a call: only what passes the « En réunion » threshold shows, the rest is recapped after.
  host.setSystem({ fullscreen: kind });
}

// Session locked or PC asleep: Gany sleeps, no new background work, alerts wait for a recap.
let screenLocked = false;
let asleep = false;
function pushLock() {
  const locked = screenLocked || asleep;
  if (locked !== host.system.locked) log(locked ? 'session verrouillée : Gany dort' : 'session reprise');
  host.setSystem({ locked });
}

function watchSession() {
  powerMonitor.on('lock-screen', () => ((screenLocked = true), pushLock()));
  powerMonitor.on('unlock-screen', () => ((screenLocked = false), pushLock()));
  powerMonitor.on('suspend', () => ((asleep = true), pushLock()));
  powerMonitor.on('resume', () => ((asleep = false), pushLock()));
  // A missed unlock event must not leave Gany asleep for good: input while Windows does
  // not say "locked" means someone is back.
  setInterval(() => {
    if (screenLocked && powerMonitor.getSystemIdleState(30) === 'active') {
      screenLocked = false;
      pushLock();
    }
  }, 30000).unref();
}

// Windows « Ne pas déranger »: the gany module's focus follows it (Réglages → Discrétion).
function pushDnd() {
  const follow = store.get('discretion', 'followDnd') !== false;
  host.setSystem({ dnd: !follow ? false : foreground.dnd ? sys.dndOn(foreground.dnd) : null });
}

// Several screens: the display of the window in front (mode « fenêtre active »).
let fgDisplayId = null;
function noteForegroundDisplay(w) {
  if (!w?.w || !w?.h || !w.title || /^Ambrosia$|Réglages — Ambrosia|^Program Manager$/.test(w.title)) return;
  fgDisplayId = screen.getDisplayMatching(screen.screenToDipRect(null, { x: w.x, y: w.y, width: w.w, height: w.h })).id;
}

/** 5 times a second: which display the island wants, and move there once it is folded. */
function followDisplays(p) {
  const mode = store.get('island', 'display');
  if (mode === 'mouse') follower.see(screen.getDisplayNearestPoint(p).id, Date.now());
  else if (mode === 'window') follower.see(fgDisplayId, Date.now());
  const want = wantedDisplay();
  if (want.id === displayId) return;
  // Never from under the user's hand: open, peeking, hovered, slid, or taking a drop.
  if (islandRect.h > 32 || hovering || drag || dropArmed) return;
  log('écran :', want.label || want.id);
  placeIsland();
  checkFullscreen();
}

// A file dragged toward the island: near it, the watcher reports the mouse button.
// Held on arrival = a drag that started elsewhere (a click starts with the button up
// here): the window takes the mouse over the zone so Windows delivers the drop, and
// the page opens the drop zone only when a real drag with files enters.
let dropNear = false;
let dropFromAfar = null;
let dropArmed = false;

function setDropArmed(on) {
  if (on === dropArmed) return;
  dropArmed = on;
  applyMouse();
  send('drop-armed', on);
}

function watchDrop(pt) {
  const near = store.get('island', 'dropZone') !== false && sys.inDropZone(pt, islandRect);
  if (near === dropNear) return;
  dropNear = near;
  dropFromAfar = null;
  foreground.watchButton(near);
  if (!near) setDropArmed(false);
}

function onButton(down) {
  if (!dropNear) return;
  if (dropFromAfar === null) dropFromAfar = down;
  else if (down) dropFromAfar = false; // pressed inside the zone: a click, a window drag
  setDropArmed(down && dropFromAfar);
}

// The page saw a drag without files (a link, some text): let it reach what is below.
ipcMain.on('drop-reject', () => {
  dropFromAfar = false;
  setDropArmed(false);
});

// ── Settings window ───────────────────────────────────────────────────────────

function openSettings(section) {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    if (section) settingsWin.webContents.send('goto', section);
    return;
  }
  settingsWin = new BrowserWindow({
    width: 860,
    height: 680,
    minWidth: 640,
    minHeight: 480,
    title: 'Réglages — Ambrosia',
    backgroundColor: '#0E0D12',
    autoHideMenuBar: true,
    icon: fs.existsSync(path.join(paths.ROOT, 'assets', 'icon.png')) ? path.join(paths.ROOT, 'assets', 'icon.png') : undefined,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  settingsWin.loadFile(path.join(paths.ROOT, 'src', 'settings', 'index.html'), { hash: section || '' });
  settingsWin.on('closed', () => (settingsWin = null));
}

// ── Tray ──────────────────────────────────────────────────────────────────────

function trayMenu() {
  const paused = store.get('general', 'paused');
  const upd = updater.state();
  return Menu.buildFromTemplate([
    ...(upd.status === 'ready' ? [{ label: `Mettre à jour Ambrosia (${upd.ready})`, click: () => installUpdate().catch(() => {}) }, { type: 'separator' }] : []),
    { label: 'Ouvrir l’îlot', click: () => send('expand', { id: null }) },
    { label: 'Réglages…', click: () => openSettings() },
    { type: 'separator' },
    {
      label: paused ? 'Reprendre' : 'Mettre en pause',
      click: () => {
        store.set('general', { paused: !paused });
        tray.setContextMenu(trayMenu());
      },
    },
    { label: 'Recharger', click: () => relaunch() },
    { label: 'Ouvrir le journal', click: () => shell.openPath(paths.logFile) },
    { type: 'separator' },
    { label: 'Quitter Ambrosia', click: () => app.quit() },
  ]);
}

function createTray() {
  const iconFile = path.join(paths.ROOT, 'assets', 'tray.png');
  const img = fs.existsSync(iconFile) ? nativeImage.createFromPath(iconFile) : nativeImage.createEmpty();
  tray = new Tray(img);
  tray.setToolTip('Ambrosia');
  tray.setContextMenu(trayMenu());
  tray.on('click', () => send('expand', { id: null }));
}

/** « Mettre à jour » from the island, the tray or Réglages: a click, nothing else. */
function installUpdate() {
  return updater.install().catch((err) => {
    log('mise à jour', err.message);
    throw err;
  });
}

function relaunch() {
  app.relaunch({ args: process.argv.slice(1) });
  app.exit(0);
}

// ── IPC ───────────────────────────────────────────────────────────────────────

ipcMain.on('mouse', (_e, wants) => {
  if (!island || island.isDestroyed()) return;
  if (wants) island.setIgnoreMouseEvents(false);
  else if (!hovering && !dropArmed) island.setIgnoreMouseEvents(true, { forward: true });
});

ipcMain.on('focus-island', () => {
  if (island && !island.isDestroyed()) island.focus();
});

ipcMain.on('blur-island', () => {
  if (island && !island.isDestroyed() && island.isFocused()) island.blur();
});

// Right-click on Gany: the quick menu, native.
ipcMain.on('gany-menu', () => {
  if (!island || island.isDestroyed()) return;
  const g = store.section('general');
  const act = (id, name) => () => host.action(id, name).catch((err) => log('menu action', err.message));
  const has = (id) => host.modules.get(id)?.ctx;
  Menu.buildFromTemplate([
    g.paused
      ? { label: 'Reprendre', click: () => store.set('general', { paused: false, pausedUntil: 0 }) }
      : { label: 'Pause 1 h', click: () => store.set('general', { paused: true, pausedUntil: Date.now() + 3600000 }) },
    { label: g.sounds === false ? 'Réactiver les sons' : 'Couper les sons', click: () => store.set('general', { sounds: g.sounds === false }) },
    { type: 'separator' },
    { label: 'Relire l’agenda', enabled: !!has('agenda'), click: act('agenda', 'refresh') },
    { label: 'Vérifier les mails', enabled: !!has('mail'), click: act('mail', 'refresh') },
    { label: 'Vérifier ClickUp', enabled: !!has('clickup'), click: act('clickup', 'refresh') },
    { type: 'separator' },
    ...ganyFocusItems(has),
    { label: 'Rejouer l’arrivée de Gany', click: () => send('launch', { kind: 'full' }) },
    { label: 'Réglages…', click: () => openSettings() },
  ]).popup({ window: island });
});

/** Gany's focus mode in his menu (src/modules/gany): tiny Gany, only the urgent passes. */
function ganyFocusItems(has) {
  if (!has('gany') || store.get('gany', 'focus') === false) return [];
  const until = host.modules.get('gany')?.state?.focus?.until || 0;
  const run = (name, payload) => () => host.action('gany', name, payload).catch((err) => log('menu action', err.message));
  if (until > Date.now()) {
    if (host.modules.get('gany')?.state?.focus?.dnd) return [{ label: 'Finir la concentration (« Ne pas déranger » de Windows)', click: run('unfocus') }];
    const at = new Date(until).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', ' h ');
    return [{ label: `Finir la concentration (prévue jusqu’à ${at})`, click: run('unfocus') }];
  }
  return [{ label: 'Concentration', submenu: [25, 50, 90, 120].map((m) => ({ label: m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ''}`, click: run('focus', { minutes: m }) })) }];
}

// A timed pause ("Pause 1 h") ends on its own, also across restarts.
setInterval(() => {
  const g = store.section('general');
  if (g.paused && g.pausedUntil && Date.now() >= g.pausedUntil) store.set('general', { paused: false, pausedUntil: 0 });
}, 30000).unref();

// Gany glances at the window you switch to.
function watchForeground() {
  const follow = () => store.get('gany', 'followWindows') !== false;
  // Windows integration (section above): full screen, « Ne pas déranger », display, file drags.
  foreground.on('change', (w) => {
    noteForegroundDisplay(w);
    checkFullscreen();
  });
  foreground.on('rect', (w) => {
    noteForegroundDisplay(w);
    checkFullscreen();
  });
  foreground.on('quns', checkFullscreen);
  foreground.on('dnd', pushDnd);
  foreground.on('button', onButton);
  foreground.on('change', (w) => {
    if (!island || island.isDestroyed() || !follow() || /^Ambrosia$|Réglages — Ambrosia/.test(w.title)) return;
    const r = screen.screenToDipRect(null, { x: w.x, y: w.y, width: w.w, height: w.h });
    const b = island.getBounds();
    send('glance', { x: r.x + r.width / 2 - b.x, y: r.y + r.height / 2 - b.y });
  });
  foreground.start();
}

ipcMain.on('tray-icon', (_e, dataUrl) => {
  if (tray && typeof dataUrl === 'string') tray.setImage(nativeImage.createFromDataURL(dataUrl));
});

ipcMain.handle('action', (_e, id, name, payload) => host.action(id, name, payload));

const core = {
  boot: () => ({
    modules: host.manifest(),
    states: host.states(),
    alerts: host.alerts,
    call: host.call.status(),
    system: host.system,
    settings: store.all(),
    update: updater.state(),
    dev: DEV,
  }),
  /** Réglages → Mises à jour, and the island's « Mettre à jour » button. */
  update: () => updater.state(),
  updateCheck: () => updater.checkNow(),
  updateInstall: () => installUpdate(),
  settings: () => store.all(),
  setSettings: ({ section, patch }) => {
    store.set(section, patch);
    return store.section(section);
  },
  openSettings: (section) => openSettings(section),
  dismissAlert: (key) => host.dismissAlert(key),
  openExternal: (url) => /^(https?|mailto):/i.test(url) && shell.openExternal(url),
  openPath: (p) => shell.openPath(p),
  quit: () => app.quit(),
  relaunch: () => relaunch(),
  hooksStatus: () => hooksInstall.status(),
  hooksPreview: (install) => hooksInstall.preview(install),
  hooksWrite: ({ install, fingerprint }) => hooksInstall.write(install, fingerprint),
  claudeStatus: async () => ({ ...(await claude.authStatus()), path: claude.locate(true) }),
  claudeLogin: () => claude.openLoginTerminal(),
  logPath: () => paths.logFile,
  /** Réglages → Encoche → « Écran choisi »: the screens plugged in now. */
  displays: () => {
    const primary = screen.getPrimaryDisplay().id;
    return screen.getAllDisplays().map((d, i) => ({ id: String(d.id), label: sys.displayLabel(d, i, primary) }));
  },
};

ipcMain.handle('core', async (_e, name, payload) => {
  const fn = core[name];
  if (!fn) throw new Error(`commande inconnue ${name}`);
  return fn(payload);
});

store.on('change', (section) => {
  send('settings', store.all());
  if (section === 'general') {
    tray?.setContextMenu(trayMenu());
    applyAutostart();
  }
  if (section === 'discretion') {
    applyCaptureProtection();
    checkFullscreen();
    pushDnd();
  }
  // Enabling / disabling a module takes effect immediately.
  const m = host.modules.get(section);
  if (m) {
    const enabled = store.get(section, 'enabled') !== false;
    if (enabled && !m.ctx) host.start(m).then(() => send('manifest', host.manifest()));
    else if (!enabled && m.ctx) host.stop(section).then(() => send('manifest', host.manifest()));
  }
});

function applyAutostart() {
  if (ISOLATED) return;
  // Installed: the `current` executable (it survives updates). From the sources
  // (npm run deploy): electron.exe with the project folder as argument.
  const target = updater.launchTarget();
  app.setLoginItemSettings({
    openAtLogin: !!store.get('general', 'autostart') && !DEV,
    path: target.path,
    args: target.args,
  });
}

// ── Dev: reload the island when its files change, relaunch on main changes ───

function watchForDev() {
  let timer = null;
  let needsRelaunch = false;
  const onChange = (file) => {
    // Node-side files (src/main/*, modules' main.js) need a relaunch; views only a reload.
    if (/[\\/](main\.js|src[\\/]main[\\/])/.test(file) && !/renderer|settings/.test(file)) needsRelaunch = true;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (needsRelaunch) {
        log('main changed → relaunch', file);
        relaunch();
      } else {
        log('view changed → reload', file);
        island?.webContents.reloadIgnoringCache();
        settingsWin?.webContents.reloadIgnoringCache();
      }
    }, 250);
  };
  fs.watch(path.join(paths.ROOT, 'src'), { recursive: true }, (_ev, file) => file && onChange(path.join('src', file)));
}

// ── Start ─────────────────────────────────────────────────────────────────────

app.on('second-instance', () => send('expand', { id: null }));
app.on('window-all-closed', (e) => e.preventDefault());

app.whenReady().then(async () => {
  log(`start v${app.getVersion()} dev=${DEV} mode=${updater.mode}`);
  // The update first (src/main/updater.js): a newer version installs itself and
  // restarts before anything else shows. Later in the day, only a click installs.
  updater.init({
    onState: (st) => {
      send('update', st);
      tray?.setContextMenu(trayMenu());
    },
    isLocked: () => !!host.system.locked,
  });
  if (await updater.startup()) return;
  hookServer.start();
  host.discover();
  createIsland();
  // The camera, for Agenda's mirror: video only, island page only (never the mic).
  require('./media-permissions').install(require('electron').session.defaultSession, () => island);
  createTray();
  startCursorFeed();
  watchForeground();
  watchSession();
  applyAutostart();
  screen.on('display-metrics-changed', placeIsland);
  screen.on('display-added', placeIsland);
  screen.on('display-removed', placeIsland);
  if (DEV) watchForDev();
  await host.startAll();
  send('manifest', host.manifest());
  greetUpdate();
});

/** Just updated: a quiet word once Gany has arrived (no sound, nothing to do). */
function greetUpdate() {
  const from = updater.state().updatedFrom;
  if (!from) return;
  setTimeout(() => {
    host.pushAlert({ key: 'core:updated', title: `Ambrosia est à jour : ${app.getVersion()}`, text: `Avant : ${from}. Les nouveautés sont dans Réglages → Mises à jour.`, mood: 'cheer', priority: 20, ttl: 6 });
  }, 6000);
}

app.on('before-quit', async () => {
  hookServer.stop();
  foreground.stop();
  await host.disposeAll();
});

process.on('uncaughtException', (err) => log('uncaught', err));
process.on('unhandledRejection', (err) => log('unhandled', err));
