// Automatic updates — the files: download with its SHA-256 checked, unzip, assemble a
// version folder next to the running one, switch the `current` junction, clean up.
// Plain Node (no Electron): scripts and tests load it too. The network goes through the
// `fetch` it is given (Electron's net.fetch in the app: the system proxy applies).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { Readable } = require('stream');
const L = require('./update-logic');

/**
 * Downloads `url` to `file`, checking the size and the SHA-256 announced by the
 * manifest; every redirect must land on a trusted host. Written to `file.download`
 * first, renamed only once verified. → file
 */
async function download({ fetch, url, file, sha256, size, feed, signal, onProgress }) {
  if (!L.trustedUrl(url, feed)) throw new Error(`adresse refusée : ${url}`);
  const res = await fetch(url, { signal, redirect: 'follow', cache: 'no-store' });
  if (!res.ok) throw new Error(`téléchargement : HTTP ${res.status}`);
  if (res.url && !L.trustedUrl(res.url, feed)) throw new Error(`redirection refusée : ${new URL(res.url).host}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.download`;
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(tmp);
  let got = 0;
  try {
    for await (const chunk of Readable.fromWeb(res.body)) {
      got += chunk.length;
      if (size && got > size) throw new Error('fichier plus gros qu’annoncé');
      hash.update(chunk);
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      onProgress?.(got, size);
    }
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  } catch (err) {
    out.destroy();
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  if (size && got !== size) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`fichier incomplet (${got} / ${size} octets)`);
  }
  const digest = hash.digest('hex');
  if (sha256 && digest !== sha256) {
    fs.rmSync(tmp, { force: true });
    throw new Error('empreinte SHA-256 différente de celle du manifeste');
  }
  fs.rmSync(file, { force: true });
  fs.renameSync(tmp, file);
  return file;
}

/** SHA-256 of a file already on disk (a download kept from an earlier run). */
function sha256Of(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (c) => hash.update(c))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/** Windows' own tar (bsdtar, Windows 10 1803+) reads zip files; never the one of Git. */
function tarExe() {
  return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
}

function run(file, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout: 5 * 60 * 1000, maxBuffer: 4 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${path.basename(file)} : ${String(stderr || err.message).trim().slice(0, 300)}`));
      else resolve(stdout);
    });
  });
}

/** Unzips `zip` into `dir` (created). tar.exe, or Expand-Archive when it is missing. */
async function extractZip(zip, dir) {
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(tarExe())) return run(tarExe(), ['-xf', zip, '-C', dir]);
  const q = (s) => `'${s.replace(/'/g, "''")}'`;
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath ${q(zip)} -DestinationPath ${q(dir)} -Force`]);
}

/** Copies a folder, hard-linking files when possible (same disk: instant, no extra space). */
function linkTree(from, to, skip = () => false) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name);
    const b = path.join(to, e.name);
    if (skip(a)) continue;
    if (e.isDirectory()) linkTree(a, b, skip);
    else if (e.isFile()) {
      try {
        fs.linkSync(a, b);
      } catch {
        fs.copyFileSync(a, b);
      }
    }
  }
}

/** A complete version folder: the executable, and the application of the right version. */
function verifyVersionDir(dir, version) {
  const exe = path.join(dir, L.EXE);
  const pkgFile = path.join(dir, 'resources', 'app', 'package.json');
  if (!fs.existsSync(exe)) throw new Error(`${L.EXE} absent de la version ${version}`);
  if (!fs.existsSync(path.join(dir, 'resources', 'app', 'src', 'main', 'main.js'))) throw new Error(`application incomplète (${version})`);
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
  } catch {
    throw new Error(`package.json illisible (${version})`);
  }
  if (pkg.version !== version) throw new Error(`la version ${version} annonce ${pkg.version}`);
  return dir;
}

/**
 * Builds <home>\<version> from a downloaded zip, beside the running version.
 *   kind 'full': the zip is the whole version (Ambrosia.exe at its root).
 *   kind 'app':  the zip is resources\app only; Electron comes from `runtimeDir`
 *                (the running version, same Electron), hard-linked.
 * Assembled in <version>.partial and renamed once verified: a half-written version
 * never looks finished. → the version folder
 */
async function assemble({ home, version, kind, zip, runtimeDir }) {
  const lay = L.layout(home);
  const dir = lay.versionDir(version);
  if (fs.existsSync(dir)) {
    try {
      return verifyVersionDir(dir, version);
    } catch {
      fs.rmSync(dir, { recursive: true, force: true }); // a broken leftover
    }
  }
  const partial = lay.partialDir(version);
  fs.rmSync(partial, { recursive: true, force: true });
  try {
    if (kind === 'app') {
      if (!runtimeDir || !fs.existsSync(path.join(runtimeDir, L.EXE))) throw new Error('pas de version en place à compléter');
      const appDir = path.join(runtimeDir, 'resources', 'app');
      linkTree(runtimeDir, partial, (p) => p === appDir);
      await extractZip(zip, path.join(partial, 'resources', 'app'));
    } else {
      await extractZip(zip, partial);
    }
    verifyVersionDir(partial, version);
    fs.renameSync(partial, dir);
  } catch (err) {
    fs.rmSync(partial, { recursive: true, force: true });
    throw err;
  }
  return dir;
}

/** The version `current` points to, or null. */
function currentVersion(home) {
  try {
    return L.versionOfDir(home, fs.realpathSync(L.layout(home).current));
  } catch {
    return null;
  }
}

/**
 * Points `current` at <home>\<version>. A directory junction (no admin right needed):
 * removing it never touches the folder it points to, and the running version keeps
 * running from its own folder.
 */
function switchCurrent(home, version) {
  const lay = L.layout(home);
  const target = lay.versionDir(version);
  verifyVersionDir(target, version);
  const next = `${lay.current}.next`;
  removeLink(next);
  fs.symlinkSync(target, next, 'junction');
  removeLink(lay.current);
  try {
    fs.renameSync(next, lay.current);
  } catch {
    // Renaming a junction can be refused by an antivirus holding it: create it in place.
    removeLink(next);
    fs.symlinkSync(target, lay.current, 'junction');
  }
  return lay.current;
}

/** Removes a junction (or a symlink) itself, never what it points to. */
function removeLink(p) {
  let st;
  try {
    st = fs.lstatSync(p);
  } catch {
    return;
  }
  if (!st.isSymbolicLink()) throw new Error(`${p} n’est pas un lien : Ambrosia n’y touche pas`);
  fs.unlinkSync(p);
}

/** Removes old versions and unfinished ones (update-logic.toRemove). Busy files stay for next time. */
function cleanup(home, { running }) {
  let names;
  try {
    names = fs.readdirSync(home);
  } catch {
    return [];
  }
  const removed = [];
  for (const name of L.toRemove(names, { running, current: currentVersion(home) })) {
    const p = path.join(home, name);
    try {
      if (fs.lstatSync(p).isSymbolicLink()) continue;
      fs.rmSync(p, { recursive: true, force: true, maxRetries: 2 });
      removed.push(name);
    } catch {
      /* in use: next start */
    }
  }
  return removed;
}

/** Start menu shortcut to the `current` executable (PowerShell, WScript.Shell). */
function writeShortcut(lnk, exe, icon = exe) {
  fs.mkdirSync(path.dirname(lnk), { recursive: true });
  const q = (s) => s.replace(/'/g, "''");
  const script =
    `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${q(lnk)}');` +
    `$s.TargetPath='${q(exe)}';$s.Arguments='';$s.WorkingDirectory='${q(path.dirname(exe))}';` +
    `$s.IconLocation='${q(icon)},0';$s.Description='Ambrosia — Gany, l''échanson des dieux';$s.Save()`;
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
}

/** Leaves the watchdog running after Ambrosia exits (update-logic.watchdogScript). */
function spawnWatchdog(opts) {
  const { spawn } = require('child_process');
  const encoded = Buffer.from(L.watchdogScript(opts), 'utf16le').toString('base64');
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  return child.pid;
}

module.exports = { spawnWatchdog, download, sha256Of, extractZip, linkTree, verifyVersionDir, assemble, currentVersion, switchCurrent, removeLink, cleanup, writeShortcut, tarExe };
