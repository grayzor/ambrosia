// Automatic updates, the way Claude Code does them: detect, download, then install.
//
//   At start: the first thing Ambrosia does. A version already downloaded installs at
//   once; otherwise a short check, and if a newer one is out it is fetched and
//   installed before the island appears (Réglages → Mises à jour → automatique, on by
//   default). Too slow: the start goes on, the update is offered once it is ready.
//   During the day: a check every 3 h, the download in the background, then a
//   « Mettre à jour » button (island header, Réglages, tray). Only a click installs.
//
// Releases come from GitHub (latest.json + zips, built by .github/workflows/release.yml).
// Run from the sources (npm start / deploy), Ambrosia never replaces itself: it only
// says what is published, and installs it on a click (« Installer la version publiée »).
// The pure part is update-logic.js, the files update-install.js.

const { app, net } = require('electron');
const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const { store } = require('./store');
const log = require('./log').scope('update');
const L = require('./update-logic');
const I = require('./update-install');

/** Where releases are published. AMBROSIA_UPDATE_FEED (a local server) for tests. */
const REPO = 'grayzor/ambrosia';
const feed = L.feedOf(process.env.AMBROSIA_UPDATE_FEED ? { base: process.env.AMBROSIA_UPDATE_FEED } : { repo: REPO });
const START_MENU = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Ambrosia.lnk');

const lay = L.layout(paths.appHome);
const running = app.getVersion();
const DEV = process.argv.includes('--dev');
/** 'packaged' (a release: updates itself), 'source' (npm start / deploy), 'dev' (npm run dev: nothing). */
const mode = DEV ? 'dev' : app.isPackaged ? 'packaged' : 'source';

let data = store.loadData('update', {});
const save = () => store.saveData('update', data);

const S = {
  mode,
  running,
  status: 'idle', // idle | checking | uptodate | downloading | ready | installing | error | off
  latest: null, // version published
  notes: '',
  ready: null, // version downloaded and assembled, waiting for a click (or the next start)
  progress: null, // 0..1 while downloading
  error: '',
  lastCheck: data.lastCheck || 0,
  updatedFrom: null,
};

let listeners = [];
let timer = null;
let job = null; // the download in progress: one at a time
let locked = () => false;

function emit() {
  for (const fn of listeners) {
    try {
      fn(state());
    } catch (err) {
      log('listener', err.message);
    }
  }
}

function set(patch) {
  Object.assign(S, patch);
  emit();
}

function state() {
  return { ...S, auto: store.get('update', 'auto') !== false, repo: REPO, appHome: paths.appHome };
}

const fetchImpl = (url, opts) => net.fetch(url, opts);

function withTimeout(promise, ms, what) {
  let t;
  return Promise.race([promise, new Promise((_r, reject) => (t = setTimeout(() => reject(new Error(`${what} : délai dépassé`)), ms)))]).finally(() => clearTimeout(t));
}

/** The version folders already assembled and newer than this one: the newest. */
function staged() {
  let names = [];
  try {
    names = fs.readdirSync(paths.appHome);
  } catch {
    return null;
  }
  const versions = names.filter((n) => L.VERSION_RE.test(n) && L.wanted(n, { running, failed: data.failed })).sort((a, b) => L.compareVersions(b, a));
  for (const v of versions) {
    try {
      I.verifyVersionDir(lay.versionDir(v), v);
      return v;
    } catch {
      /* broken: cleaned later */
    }
  }
  return null;
}

/** The folder of the running version (packaged), to reuse its Electron. */
function runtimeDir() {
  if (mode !== 'packaged') return null;
  try {
    return path.dirname(fs.realpathSync(process.execPath));
  } catch {
    return path.dirname(process.execPath);
  }
}

/** Reads latest.json. → the manifest, or null when nothing is published yet. */
async function check({ manual = false } = {}) {
  if (mode === 'dev') return null;
  if (job && !manual) return null;
  set({ status: job ? S.status : 'checking', error: '' });
  try {
    const res = await fetchImpl(feed.latest, { cache: 'no-store', redirect: 'follow' });
    if (res.url && !L.trustedUrl(res.url, feed)) throw new Error(`redirection refusée : ${new URL(res.url).host}`);
    data.lastCheck = Date.now();
    data.lastError = 0;
    save();
    if (res.status === 404) {
      set({ status: S.ready ? 'ready' : 'uptodate', lastCheck: data.lastCheck, latest: null });
      return null;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const m = L.parseManifest(await res.text());
    const newer = L.wanted(m.version, { running, failed: data.failed });
    set({ latest: m.version, notes: m.notes, lastCheck: data.lastCheck, status: S.ready ? 'ready' : job ? S.status : newer ? 'idle' : 'uptodate' });
    if (newer) log(`version ${m.version} publiée (en place : ${running})`);
    return newer || mode === 'source' ? m : null;
  } catch (err) {
    data.lastError = Date.now();
    save();
    log('vérification', err.message);
    set({ status: S.ready ? 'ready' : 'error', error: `Vérification impossible : ${err.message}` });
    if (manual) throw err;
    return null;
  }
}

/**
 * Downloads and assembles `m`'s version next to the running one (once: a second call
 * joins the first). → the version, ready to switch to.
 */
function prepare(m) {
  if (S.ready && !L.isNewer(m.version, S.ready)) return Promise.resolve(S.ready);
  if (job) return job;
  const asset = L.pickAsset(m, { electron: process.versions.electron, canReuseRuntime: mode === 'packaged' });
  const zip = path.join(paths.updatesDir, asset.name);
  job = (async () => {
    set({ status: 'downloading', progress: 0, error: '' });
    log(`téléchargement ${asset.name} (${asset.kind}, ${Math.round(asset.size / 1024)} Ko)`);
    const cached = fs.existsSync(zip) && (await I.sha256Of(zip)) === asset.sha256;
    if (!cached) {
      let last = 0;
      await I.download({
        fetch: fetchImpl,
        url: L.assetUrl(feed, m, asset.name),
        file: zip,
        sha256: asset.sha256,
        size: asset.size,
        feed,
        onProgress: (got, size) => {
          const p = size ? got / size : null;
          if (p != null && p - last >= 0.05) {
            last = p;
            set({ progress: p });
          }
        },
      });
    }
    await I.assemble({ home: paths.appHome, version: m.version, kind: asset.kind, zip, runtimeDir: runtimeDir() });
    fs.rmSync(zip, { force: true });
    log(`version ${m.version} prête`);
    set({ status: 'ready', ready: m.version, progress: null });
    return m.version;
  })()
    .catch((err) => {
      log('préparation', err.message);
      data.lastError = Date.now();
      save();
      set({ status: 'error', progress: null, error: `Mise à jour impossible : ${err.message}` });
      throw err;
    })
    .finally(() => (job = null));
  return job;
}

/**
 * Switches to `version` and restarts through the `current` junction. The Start menu
 * shortcut follows; the sign-in entry is rewritten by the new version (main.js).
 */
async function apply(version, why) {
  set({ status: 'installing', error: '' });
  try {
    I.switchCurrent(paths.appHome, version);
  } catch (err) {
    log('installation', err.message);
    set({ status: 'error', error: `Installation impossible : ${err.message}` });
    return false;
  }
  try {
    await I.writeShortcut(START_MENU, lay.currentExe, path.join(lay.current, 'resources', 'app', 'assets', 'icon.ico'));
  } catch (err) {
    log('raccourci', err.message);
  }
  data.attempt = { version, from: running, at: Date.now() };
  save();
  // If the new version never comes up, the watchdog puts this one back (update-logic.watchdogScript).
  const inHome = mode === 'packaged' && !!L.versionOfDir(paths.appHome, runtimeDir() || '');
  try {
    I.spawnWatchdog({
      dataFile: path.join(paths.dataDir, 'update.json'),
      version,
      current: lay.current,
      backDir: inHome ? runtimeDir() : null,
      exe: inHome ? lay.currentExe : process.execPath,
      args: mode === 'source' ? process.argv.slice(1) : [],
    });
  } catch (err) {
    log('surveillance', err.message);
  }
  log(`installation ${running} → ${version} (${why}), redémarrage`);
  app.relaunch({ execPath: lay.currentExe, args: [] });
  app.exit(0);
  return true;
}

/**
 * The very first thing at start (main.js, before the island). → true when Ambrosia is
 * restarting into a new version (the caller stops there).
 */
async function startup() {
  if (mode === 'dev') {
    set({ status: 'off' });
    return false;
  }
  // Came back in the version we were installing: done.
  if (data.attempt?.version === running) {
    S.updatedFrom = data.attempt.from;
    log(`mis à jour : ${data.attempt.from} → ${running}`);
    data.attempt = null;
    save();
  }
  // The watchdog brought this version back: the other one did not start.
  if (data.failed && L.isNewer(data.failed, running)) {
    S.error = `La version ${data.failed} n’a pas démarré : Ambrosia est revenue à la ${running}. Elle attend la suivante.`;
    log(`version ${data.failed} en échec, ignorée`);
  }
  if (mode === 'packaged') {
    try {
      const removed = I.cleanup(paths.appHome, { running: L.versionOfDir(paths.appHome, runtimeDir() || '') || running });
      if (removed.length) log('anciennes versions retirées :', removed.join(', '));
    } catch (err) {
      log('nettoyage', err.message);
    }
    fs.rmSync(paths.updatesDir, { recursive: true, force: true, maxRetries: 1 });
  }
  const now = Date.now();
  const auto = store.get('update', 'auto') !== false;
  const ready = mode === 'packaged' ? staged() : null;
  if (ready) {
    S.ready = ready;
    S.status = 'ready';
    if (L.autoAllowed({ auto, mode, version: ready, attempt: data.attempt, failed: data.failed, now })) return apply(ready, 'démarrage');
  }
  schedule();
  const m = await withTimeout(check(), 8000, 'vérification').catch((err) => (log(err.message), null));
  if (!m || mode !== 'packaged') return false;
  const prep = prepare(m);
  prep.catch(() => {});
  if (!L.autoAllowed({ auto, mode, version: m.version, attempt: data.attempt, failed: data.failed, now })) {
    if (data.attempt?.version === m.version) log(`la version ${m.version} n’a pas démarré tout à l’heure : proposée, pas réinstallée`);
    return false;
  }
  const kind = L.pickAsset(m, { electron: process.versions.electron, canReuseRuntime: true }).kind;
  try {
    const v = await withTimeout(prep, L.startBudgetMs(kind), 'téléchargement');
    return apply(v, 'démarrage');
  } catch (err) {
    log(`pas de mise à jour au démarrage (${err.message}) : proposée quand elle sera prête`);
    return false;
  }
}

/** During the day: check now and then, prepare in the background, never install alone. */
function schedule() {
  clearInterval(timer);
  timer = setInterval(async () => {
    if (!L.checkDue({ now: Date.now(), lastCheck: data.lastCheck, lastError: data.lastError, locked: locked() })) return;
    const m = await check();
    if (m && mode === 'packaged') prepare(m).catch(() => {});
  }, 10 * 60 * 1000);
  timer.unref?.();
}

/** « Vérifier maintenant » (Réglages): check, and prepare what is new. */
async function checkNow() {
  const m = await check({ manual: true });
  if (m && mode === 'packaged') prepare(m).catch(() => {});
  return state();
}

/** « Mettre à jour » (island, Réglages, tray): a click, never anything else. */
async function install() {
  if (mode === 'dev') throw new Error('Pas de mise à jour en mode développement.');
  if (mode === 'source') return installPublished();
  let v = S.ready || staged();
  if (!v) {
    const m = await check({ manual: true });
    if (!m) return state();
    v = await prepare(m);
  }
  await apply(v, 'clic');
  return state();
}

/**
 * Run from the sources: install the published version (full download) in
 * %LOCALAPPDATA%\Ambrosia\app and switch to it. On a click only.
 */
async function installPublished() {
  const m = await check({ manual: true });
  if (!m) throw new Error('Aucune version publiée pour l’instant.');
  const v = await prepare(m);
  await apply(v, 'passage à la version publiée');
  return state();
}

/** Installed in %LOCALAPPDATA%\Ambrosia\app (a release run from elsewhere is not). */
function installed() {
  if (mode !== 'packaged') return false;
  const rel = path.relative(paths.appHome, paths.ROOT);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** What the sign-in entry launches: the `current` executable once installed. */
function launchTarget() {
  if (mode === 'packaged') return { path: installed() ? lay.currentExe : process.execPath, args: [] };
  return { path: process.execPath, args: [paths.ROOT] };
}

function init({ onState, isLocked } = {}) {
  if (onState) listeners.push(onState);
  if (isLocked) locked = isLocked;
}

module.exports = { init, startup, state, checkNow, install, launchTarget, mode, running };
