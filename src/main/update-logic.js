// Automatic updates — the pure part (no Electron, no network): versions, the release
// manifest, which file to fetch, where versions live, when to check, what to clean.
// The side effects are in update-install.js (files) and updater.js (network, relaunch).
//
// Layout of an installed Ambrosia (%LOCALAPPDATA%\Ambrosia\app):
//   0.1.57\            a complete version: Ambrosia.exe, Electron's files, resources\app
//   0.1.58\
//   current → 0.1.58   directory junction; the Start menu, the sign-in entry and Claude
//                      Code's hooks all go through it, so an update never breaks them.
// The running version is never touched: the next one is assembled next to it, the
// junction is switched, and Ambrosia restarts through it.

const path = require('path');

const VERSION_RE = /^\d+\.\d+\.\d+$/;
const ASSET_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.zip$/;
const SHA_RE = /^[a-f0-9]{64}$/;

/** "0.1.58" → [0, 1, 58]; anything else → null. */
function parseVersion(v) {
  const s = String(v || '').trim().replace(/^v/, '');
  return VERSION_RE.test(s) ? s.split('.').map(Number) : null;
}

/** < 0 when a is older than b, 0 when equal, > 0 when newer. Unparsable versions are the oldest. */
function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return (x ? 1 : 0) - (y ? 1 : 0);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

const isNewer = (candidate, running) => compareVersions(candidate, running) > 0;

/**
 * latest.json, written by scripts/build.js in CI, checked field by field: a manifest
 * comes from the network, nothing in it is trusted until it has the expected shape.
 * → { version, electron, commit, date, notes, assets: { full, app? } } or throws.
 */
function parseManifest(raw) {
  const m = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!m || typeof m !== 'object') throw new Error('manifeste illisible');
  const version = String(m.version || '');
  if (!VERSION_RE.test(version)) throw new Error(`version invalide : ${version.slice(0, 40)}`);
  const asset = (a, name) => {
    if (!a) return null;
    if (!ASSET_RE.test(String(a.name || ''))) throw new Error(`fichier ${name} invalide`);
    if (!SHA_RE.test(String(a.sha256 || '').toLowerCase())) throw new Error(`empreinte ${name} invalide`);
    const size = Number(a.size);
    if (!(size > 0 && size < 1024 * 1024 * 1024)) throw new Error(`taille ${name} invalide`);
    return { name: a.name, sha256: a.sha256.toLowerCase(), size };
  };
  const full = asset(m.assets?.full, 'complet');
  if (!full) throw new Error('fichier complet absent du manifeste');
  const electron = /^\d+\.\d+\.\d+/.test(String(m.electron || '')) ? String(m.electron) : '';
  return {
    version,
    electron,
    commit: /^[a-f0-9]{7,40}$/.test(String(m.commit || '')) ? m.commit : '',
    date: typeof m.date === 'string' ? m.date.slice(0, 40) : '',
    notes: /^https:\/\/github\.com\//.test(String(m.notes || '')) ? m.notes : '',
    assets: { full, app: electron ? asset(m.assets?.app, 'application') : null },
  };
}

/**
 * Which file to download. Same Electron as the one running (and a runtime to copy it
 * from): only the application (a few hundred KB) — otherwise the full version (~110 MB).
 */
function pickAsset(manifest, { electron, canReuseRuntime }) {
  const app = manifest.assets.app;
  if (app && canReuseRuntime && electron && manifest.electron === electron) return { kind: 'app', ...app };
  return { kind: 'full', ...manifest.assets.full };
}

/** Release download URL of one manifest file. */
function assetUrl(feed, manifest, name) {
  return `${feed.download}/v${manifest.version}/${encodeURIComponent(name)}`;
}

/** Where the manifest and the files come from (a GitHub repo's releases, or a test server). */
function feedOf({ repo, base } = {}) {
  if (base) {
    const b = String(base).replace(/\/+$/, '');
    return { latest: `${b}/latest.json`, download: b, local: true };
  }
  return {
    latest: `https://github.com/${repo}/releases/latest/download/latest.json`,
    download: `https://github.com/${repo}/releases/download`,
    local: false,
  };
}

/** GitHub serves release files from its own hosts only (after a redirect). */
function trustedUrl(url, feed) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  // A test feed (AMBROSIA_UPDATE_FEED) is served from this machine only.
  if (feed?.local) return /^https?:$/.test(u.protocol) && /^(127\.0\.0\.1|localhost|\[::1\])$/.test(u.hostname);
  if (u.protocol !== 'https:') return false;
  return u.hostname === 'github.com' || /(^|\.)githubusercontent\.com$/.test(u.hostname);
}

// ── Install layout ────────────────────────────────────────────────────────

const EXE = 'Ambrosia.exe';

function layout(appHome) {
  return {
    home: appHome,
    current: path.join(appHome, 'current'),
    currentExe: path.join(appHome, 'current', EXE),
    versionDir: (v) => path.join(appHome, v),
    partialDir: (v) => path.join(appHome, `${v}.partial`),
  };
}

/** Is `dir` (a real path) one version folder right under the install home? → its version, or null. */
function versionOfDir(appHome, dir) {
  const rel = path.relative(appHome, dir);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || /[\\/]/.test(rel)) return null;
  return VERSION_RE.test(rel) ? rel : null;
}

/**
 * Version folders to delete: everything but the running one, the one `current` points
 * to, and the newest other one (a way back, by hand). Unfinished downloads (*.partial) go.
 */
function toRemove(names, { running, current }) {
  const keep = new Set([running, current].filter(Boolean));
  const versions = names.filter((n) => VERSION_RE.test(n)).sort((a, b) => compareVersions(b, a));
  const spare = versions.find((v) => !keep.has(v) && compareVersions(v, current || running) < 0);
  if (spare) keep.add(spare);
  return [...versions.filter((v) => !keep.has(v)), ...names.filter((n) => /^\d+\.\d+\.\d+\.partial$/.test(n))];
}

// ── When ──────────────────────────────────────────────────────────────────

const CHECK_EVERY_MS = 3 * 3600 * 1000;
const RETRY_MS = 20 * 60 * 1000;
/** Same version tried at start within this window and still not running it: stop insisting. */
const LOOP_GUARD_MS = 15 * 60 * 1000;

/** Is a periodic check due? Not while locked / paused (no background work then). */
function checkDue({ now, lastCheck, lastError, locked }) {
  if (locked) return false;
  if (lastError && now - lastError < RETRY_MS) return false;
  return !lastCheck || now - lastCheck >= CHECK_EVERY_MS;
}

/**
 * At start, may the update to `version` install itself? Only when automatic updates are
 * on, the run is a real one (not `npm run dev`, not from the sources), and the same
 * version did not just fail to come up (attempt recorded, still running the old one).
 */
function autoAllowed({ auto, mode, version, attempt, failed, now }) {
  if (!auto || mode !== 'packaged') return false;
  if (failed === version) return false;
  if (attempt && attempt.version === version && now - attempt.at < LOOP_GUARD_MS) return false;
  return true;
}

/** A version worth offering: newer than the running one, and not one that failed to start here. */
function wanted(version, { running, failed }) {
  return isNewer(version, running) && version !== failed;
}

/**
 * The watchdog left behind by an install (update-install.spawnWatchdog): PowerShell that
 * waits, and if the new version never said it started (data.attempt still names it),
 * points `current` back to the previous version, records the failure and restarts it.
 */
function watchdogScript({ dataFile, version, current, backDir, exe, args = [], delayS = 90 }) {
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const argList = args.length ? ` -ArgumentList ${args.map((a) => q(`"${a}"`)).join(',')}` : '';
  return [
    `Start-Sleep -Seconds ${Number(delayS) || 90}`,
    `$f = ${q(dataFile)}`,
    `try { $j = Get-Content -LiteralPath $f -Raw -Encoding UTF8 | ConvertFrom-Json } catch { exit 0 }`,
    `if (-not $j.attempt -or $j.attempt.version -ne ${q(version)}) { exit 0 }`,
    `Get-CimInstance Win32_Process -Filter "Name='Ambrosia.exe'" | Where-Object { $_.ExecutablePath -like ${q(path.join(path.dirname(current), '*'))} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
    // Directory.Delete on a junction removes the link only, never the folder behind it.
    backDir ? `$c = ${q(current)}; try { [System.IO.Directory]::Delete($c) } catch {}` : '',
    backDir ? `New-Item -ItemType Junction -Path $c -Target ${q(backDir)} | Out-Null` : '',
    `$j.attempt = $null`,
    `$j | Add-Member -NotePropertyName failed -NotePropertyValue ${q(version)} -Force`,
    `$j | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $f -Encoding UTF8`,
    `Start-Process -FilePath ${q(exe)}${argList}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** How long the start waits for a download before going on (the update is offered later). */
function startBudgetMs(kind) {
  return kind === 'app' ? 30000 : 90000;
}

module.exports = {
  EXE,
  VERSION_RE,
  CHECK_EVERY_MS,
  RETRY_MS,
  LOOP_GUARD_MS,
  parseVersion,
  compareVersions,
  isNewer,
  parseManifest,
  pickAsset,
  assetUrl,
  feedOf,
  trustedUrl,
  layout,
  versionOfDir,
  toRemove,
  checkDue,
  autoAllowed,
  wanted,
  watchdogScript,
  startBudgetMs,
};
