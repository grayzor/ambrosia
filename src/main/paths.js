// Every path Ambrosia reads or writes, in one place.
//
// Roaming (%APPDATA%\Ambrosia) holds what the user chose: settings and module data.
// Local (%LOCALAPPDATA%\Ambrosia) holds what belongs to this machine only: the log,
// the hook token and the scratch folder internal Claude calls run in.

const path = require('path');
const os = require('os');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..', '..');

// Under `node --test`, never the user's real folders (a test line in the real log
// reads like real activity): a test that wants its own sets APPDATA / LOCALAPPDATA
// to a temp folder, the others share %TEMP%\ambrosia-test.
const testing = !!process.env.NODE_TEST_CONTEXT;
const tmp = os.tmpdir().toLowerCase() + path.sep;
function base(dir, name) {
  if (!testing || dir.toLowerCase().startsWith(tmp)) return dir;
  return path.join(os.tmpdir(), 'ambrosia-test', name);
}

const roaming = path.join(base(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'roaming'), 'Ambrosia');
const local = path.join(base(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'local'), 'Ambrosia');

// An installed Ambrosia runs from %LOCALAPPDATA%\Ambrosia\app\<version>\resources\app
// (src/main/update-logic.js). What outlives an update (Claude Code's hook commands, the
// sign-in entry, the Start menu) goes through the `current` junction instead.
const appHome = path.join(local, 'app');
function stableRoot(root = ROOT, home = appHome) {
  const rel = path.relative(home, root);
  if (!rel.startsWith('..') && !path.isAbsolute(rel) && /^[^\\/]+[\\/]resources[\\/]app$/i.test(rel)) return path.join(home, 'current', 'resources', 'app');
  return root;
}
const STABLE_ROOT = stableRoot();

for (const dir of [roaming, local, path.join(roaming, 'data'), path.join(local, 'work'), path.join(local, 'nudges')]) {
  fs.mkdirSync(dir, { recursive: true });
}

module.exports = {
  ROOT,
  /** ROOT, or its path through the `current` junction when installed (stable across updates). */
  STABLE_ROOT,
  stableRoot,
  /** Installed versions and the `current` junction (src/main/updater.js). */
  appHome,
  /** Downloaded update files, before they become a version folder. */
  updatesDir: path.join(local, 'updates'),
  roaming,
  local,
  settingsFile: path.join(roaming, 'settings.json'),
  dataDir: path.join(roaming, 'data'),
  logFile: path.join(local, 'ambrosia.log'),
  tokenFile: path.join(local, 'hook-token'),
  /** Empty folder internal `claude -p` calls run in: no project settings, no CLAUDE.md. */
  workDir: path.join(local, 'work'),
  hookScript: path.join(STABLE_ROOT, 'hook', 'ambrosia-hook.js'),
  /** statusLine relay: quota gauges, chained to the user's own statusLine. */
  statusScript: path.join(STABLE_ROOT, 'hook', 'ambrosia-statusline.js'),
  /** Queued instructions for running sessions, claimed by the hook relay (see hook/relay-lib.js). */
  nudgesDir: path.join(local, 'nudges'),
  modulesDir: path.join(ROOT, 'src', 'modules'),
  claudeSettings: path.join(os.homedir(), '.claude', 'settings.json'),
  /** Machine-wide namespace, so the user name keeps two accounts apart. */
  pipeName: `\\\\.\\pipe\\ambrosia-${(process.env.USERNAME || 'user').toLowerCase()}`,
};
