// Builds the release Ambrosia updates itself from (src/main/updater.js), the way CI
// does on every merge into main (.github/workflows/release.yml):
//
//   dist/Ambrosia/                       Electron renamed Ambrosia.exe + resources/app
//   dist/Ambrosia-<v>-win-x64.zip        the whole version (first install, new Electron)
//   dist/Ambrosia-<v>-app.zip            resources/app only (same Electron: a small update)
//   dist/latest.json                     the manifest: version, Electron, SHA-256 of both
//
// The version is <major>.<minor> of package.json + the number of commits of HEAD:
// every merge into main gives a higher one, and the same commit always the same.
//
//   node scripts/build.js [--version 0.1.123] [--out dist] [--no-zip]

const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const OUT = path.resolve(ROOT, arg('--out', 'dist'));
const REPO = process.env.GITHUB_REPOSITORY || 'grayzor/ambrosia';
/** What the packaged app is made of: no dev/, no tests/, no scripts/. */
const APP_FILES = ['src', 'hook', 'assets', 'LICENSE'];

const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

function version() {
  const given = arg('--version');
  if (given) return given.replace(/^v/, '');
  const [major, minor] = pkg.version.split('.');
  return `${major}.${minor}.${git('rev-list', '--count', 'HEAD')}`;
}

/** Windows' own tar writes zip files (bsdtar, -a picks the format from the name). */
function zip(dir, file) {
  fs.rmSync(file, { force: true });
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  execFileSync(fs.existsSync(tar) ? tar : 'tar', ['-a', '-c', '-f', file, '-C', dir, ...fs.readdirSync(dir)], { stdio: 'inherit' });
  const bytes = fs.readFileSync(file);
  return { name: path.basename(file), size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

const v = version();
if (!/^\d+\.\d+\.\d+$/.test(v)) throw new Error(`version invalide : ${v}`);
const electronExe = require('electron'); // path of electron.exe from plain Node
const electronVersion = require('electron/package.json').version;
const runtime = path.dirname(electronExe);
const dest = path.join(OUT, 'Ambrosia');
const app = path.join(dest, 'resources', 'app');

console.log(`Ambrosia ${v} (Electron ${electronVersion}) → ${dest}`);
fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(runtime, dest, { recursive: true });
fs.renameSync(path.join(dest, 'electron.exe'), path.join(dest, 'Ambrosia.exe'));
fs.rmSync(path.join(dest, 'resources', 'default_app.asar'), { force: true });

fs.mkdirSync(app, { recursive: true });
for (const f of APP_FILES) fs.cpSync(path.join(ROOT, f), path.join(app, f), { recursive: true });
const { scripts, devDependencies, private: _p, ...meta } = pkg;
fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ ...meta, version: v }, null, 2) + '\n');

if (process.argv.includes('--no-zip')) process.exit(0);

const full = zip(dest, path.join(OUT, `Ambrosia-${v}-win-x64.zip`));
const appZip = zip(app, path.join(OUT, `Ambrosia-${v}-app.zip`));
let commit = '';
try {
  commit = git('rev-parse', 'HEAD');
} catch {
  /* not a checkout */
}
const manifest = {
  version: v,
  electron: electronVersion,
  commit,
  date: new Date().toISOString(),
  notes: `https://github.com/${REPO}/releases/tag/v${v}`,
  assets: { full, app: appZip },
};
fs.writeFileSync(path.join(OUT, 'latest.json'), JSON.stringify(manifest, null, 2) + '\n');
fs.copyFileSync(path.join(ROOT, 'scripts', 'install.ps1'), path.join(OUT, 'install.ps1'));
console.log(`${full.name} ${(full.size / 1e6).toFixed(1)} Mo · ${appZip.name} ${(appZip.size / 1e3).toFixed(0)} Ko`);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${v}\n`);
