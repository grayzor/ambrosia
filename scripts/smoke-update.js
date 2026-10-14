// End-to-end check of a release, run by CI before publishing it (and by hand):
// the packaged app starts, and an older installed version updates itself to it.
//
//   1. a copy of dist/Ambrosia relabelled 0.0.1 is installed the way users have it
//      (<LOCALAPPDATA>\Ambrosia\app\0.0.1 + the `current` junction);
//   2. dist/ is served on 127.0.0.1 like GitHub releases (latest.json, v<version>/…);
//   3. the old version is started: at start it must download the small application
//      zip, assemble the new version, switch `current` and restart into it.
//
// Isolated from a real Ambrosia: APPDATA / LOCALAPPDATA / USERNAME in a temp folder,
// AMBROSIA_ISOLATED (own Electron profile, no sign-in entry), Gany paused, silent.
//
//   node scripts/smoke-update.js [dist]

const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const I = require('../src/main/update-install');

const DIST = path.resolve(process.argv[2] || 'dist');
const manifest = JSON.parse(fs.readFileSync(path.join(DIST, 'latest.json'), 'utf8'));
const V = manifest.version;
const OLD = '0.0.1';
const TIMEOUT = 180000;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ambrosia-smoke-'));
const roaming = path.join(tmp, 'roaming');
const local = path.join(tmp, 'local');
const home = path.join(local, 'Ambrosia', 'app');
const logFile = path.join(local, 'Ambrosia', 'ambrosia.log');

function killAll() {
  const like = path.join(tmp, '*').replace(/'/g, "''");
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Get-CimInstance Win32_Process -Filter "Name='Ambrosia.exe'" | Where-Object { $_.ExecutablePath -like '${like}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`]);
  } catch {
    /* nothing left */
  }
}

function logText() {
  try {
    return fs.readFileSync(logFile, 'utf8');
  } catch {
    return '';
  }
}

async function main() {
  // Settings of the throwaway profile: paused (no background work, no AI call), silent.
  fs.mkdirSync(path.join(roaming, 'Ambrosia'), { recursive: true });
  fs.writeFileSync(
    path.join(roaming, 'Ambrosia', 'settings.json'),
    JSON.stringify({ general: { paused: true, sounds: false, autostart: false }, gany: { launch: 'off' }, update: { auto: true } }),
  );
  // The "old" version, installed.
  console.log(`Installation d’une ${OLD} (copie de ${V})…`);
  const old = path.join(home, OLD);
  fs.cpSync(path.join(DIST, 'Ambrosia'), old, { recursive: true });
  const pkgFile = path.join(old, 'resources', 'app', 'package.json');
  fs.writeFileSync(pkgFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(pkgFile, 'utf8')), version: OLD }, null, 2));
  I.switchCurrent(home, OLD);

  // GitHub releases, on this machine.
  const files = { '/latest.json': path.join(DIST, 'latest.json') };
  for (const a of Object.values(manifest.assets)) files[`/v${V}/${a.name}`] = path.join(DIST, a.name);
  const served = [];
  const server = http.createServer((req, res) => {
    const file = files[req.url];
    served.push(`${req.method} ${req.url} ${file ? 200 : 404}`);
    if (!file) return res.writeHead(404).end();
    res.writeHead(200, { 'content-length': fs.statSync(file).size });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const feed = `http://127.0.0.1:${server.address().port}`;

  const env = {
    ...process.env,
    APPDATA: roaming,
    LOCALAPPDATA: local,
    USERNAME: `ambrosia-smoke-${process.pid}`,
    AMBROSIA_ISOLATED: '1',
    AMBROSIA_UPDATE_FEED: feed,
  };
  console.log(`Démarrage de la ${OLD}, mise à jour attendue vers la ${V}…`);
  spawn(path.join(home, 'current', 'Ambrosia.exe'), [], { env, detached: true, stdio: 'ignore' }).unref();

  const started = Date.now();
  let ok = false;
  while (Date.now() - started < TIMEOUT) {
    await new Promise((r) => setTimeout(r, 1000));
    const log = logText();
    if (log.includes(`start v${V} `) && log.includes(`mis à jour : ${OLD} → ${V}`)) {
      ok = true;
      break;
    }
  }
  // Let the new version live a few seconds: it must not crash right after.
  if (ok) await new Promise((r) => setTimeout(r, 8000));
  const log = logText();
  server.close();
  killAll();

  const problems = [];
  if (!ok) problems.push(`pas de redémarrage dans la ${V} en ${TIMEOUT / 1000} s`);
  if (I.currentVersion(home) !== V) problems.push(`current → ${I.currentVersion(home)}, attendu ${V}`);
  if (!served.some((s) => s.includes(manifest.assets.app.name) && s.endsWith('200'))) problems.push('le petit fichier application n’a pas été téléchargé');
  if (!fs.existsSync(path.join(roaming, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Ambrosia.lnk'))) problems.push('raccourci du menu Démarrer absent');
  if (/\[core\] uncaught/.test(log)) problems.push('erreur non rattrapée dans le journal');
  console.log('Requêtes :', served.join(' | '));
  console.log('Journal (mises à jour et démarrages) :');
  console.log(log.split('\n').filter((l) => /\[update\]|\] start v|uncaught/.test(l)).join('\n'));
  if (problems.length) {
    console.error('\nÉCHEC :', problems.join(' ; '));
    console.error(log.split('\n').slice(-40).join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`\nOK : la ${OLD} s’est mise à jour seule vers la ${V} et a redémarré dessus.`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    killAll();
    setTimeout(() => {
      try {
        fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
      } catch {
        /* a file still held: the temp folder keeps it */
      }
    }, 1500);
  });
