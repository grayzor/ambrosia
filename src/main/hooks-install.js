// Claude Code hook installation — same contract as coucou:
// read ~/.claude/settings.json, merge without touching anybody else's hooks,
// show the diff, take a dated backup, write only after an explicit click, and
// refuse to write if the file changed since the diff was shown.
// Uninstall removes Ambrosia's entries and nothing else.
//
// The statusLine relay (quota gauges) wraps the user's own statusLine: their
// command is kept, base64url-encoded after --chain, and still produces the line
// they see. Uninstall puts their command back exactly as it was.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const paths = require('./paths');

const MARKER = 'ambrosia-hook';
const STATUS_MARKER = 'ambrosia-statusline';

/** Every event the island reacts to, with the timeout written to settings.json. */
const HOOK_EVENTS = [
  ['SessionStart', 10],
  ['SessionEnd', 10],
  ['UserPromptSubmit', 10],
  ['PreToolUse', 10],
  ['PostToolUse', 10],
  ['PostToolUseFailure', 10],
  ['PermissionRequest', 120],
  ['Notification', 10],
  ['Stop', 10],
  ['StopFailure', 10],
  ['SubagentStart', 10],
  ['SubagentStop', 10],
  ['PreCompact', 10],
  ['PostCompact', 10],
  ['PermissionDenied', 10],
  ['TaskCreated', 10],
  ['TaskCompleted', 10],
];

function nodePath() {
  for (const dir of (process.env.PATH || '').split(';')) {
    const p = path.join(dir.trim(), 'node.exe');
    if (dir && fs.existsSync(p)) return p;
  }
  return null;
}

/** Claude Code may run hooks through Git Bash: forward slashes, quoted paths, nothing else. */
function command(arg) {
  const node = (nodePath() || 'node').replace(/\\/g, '/');
  const script = paths.hookScript.replace(/\\/g, '/');
  return `"${node}" "${script}" ${arg}`;
}

/** The statusLine command: our relay, with the user's previous command chained after it. */
function statusCommand(previous) {
  const node = (nodePath() || 'node').replace(/\\/g, '/');
  const script = paths.statusScript.replace(/\\/g, '/');
  const chain = previous ? ` --chain ${Buffer.from(previous, 'utf8').toString('base64url')}` : '';
  return `"${node}" "${script}"${chain}`;
}

/** The user's command chained inside ours ('' when there was none). */
function chainedCommand(cmd) {
  const m = String(cmd || '').match(/--chain\s+([A-Za-z0-9_-]+)/);
  return m ? Buffer.from(m[1], 'base64url').toString('utf8') : '';
}

const isOurStatus = (sl) => !!sl && typeof sl.command === 'string' && sl.command.includes(STATUS_MARKER);

function readSettings() {
  let bytes;
  try {
    bytes = fs.readFileSync(paths.claudeSettings);
  } catch (err) {
    if (err.code === 'ENOENT') return { value: {}, bytes: Buffer.alloc(0) };
    throw new Error(`Impossible de lire ${paths.claudeSettings} : ${err.message}`);
  }
  let text = bytes.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (!text.trim()) return { value: {}, bytes };
  let value;
  try {
    value = JSON.parse(text);
  } catch (err) {
    throw new Error(`${paths.claudeSettings} n'est pas du JSON valide (${err.message}). Ambrosia n'y touchera pas.`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${paths.claudeSettings} n'est pas un objet JSON. Ambrosia n'y touchera pas.`);
  }
  return { value, bytes };
}

const isOurs = (entry) =>
  Array.isArray(entry?.hooks) && entry.hooks.some((h) => typeof h.command === 'string' && h.command.includes(MARKER));

function withoutOurs(settings) {
  const root = withoutOurHooks(settings);
  if (isOurStatus(root.statusLine)) {
    const previous = chainedCommand(root.statusLine.command);
    if (previous) root.statusLine = { ...root.statusLine, command: previous };
    else delete root.statusLine;
  }
  return root;
}

function withoutOurHooks(settings) {
  const root = JSON.parse(JSON.stringify(settings));
  if (!root.hooks || typeof root.hooks !== 'object') return root;
  for (const [event, list] of Object.entries(root.hooks)) {
    if (!Array.isArray(list)) continue;
    const kept = list.filter((e) => !isOurs(e));
    if (kept.length) root.hooks[event] = kept;
    else delete root.hooks[event];
  }
  if (!Object.keys(root.hooks).length) delete root.hooks;
  return root;
}

function merged(settings) {
  const root = withoutOurs(settings);
  root.hooks = root.hooks || {};
  for (const [event, timeout] of HOOK_EVENTS) {
    const list = Array.isArray(root.hooks[event]) ? root.hooks[event] : [];
    list.push({ hooks: [{ type: 'command', command: command(event), timeout }] });
    root.hooks[event] = list;
  }
  // AskUserQuestion answered from the island (Claude Code 2.1.85+).
  root.hooks.PreToolUse.push({
    matcher: 'AskUserQuestion',
    hooks: [{ type: 'command', command: command('--ask'), timeout: 130 }],
  });
  // Quota gauges: wrap the user's statusLine, or stand alone when there is none.
  const sl = root.statusLine;
  if (!sl) root.statusLine = { type: 'command', command: statusCommand('') };
  else if ((sl.type === 'command' || !sl.type) && typeof sl.command === 'string' && sl.command.trim()) {
    root.statusLine = { ...sl, command: statusCommand(sl.command) };
  }
  return root;
}

const fingerprint = (bytes) => crypto.createHash('sha1').update(bytes).digest('hex');
const pretty = (v) => JSON.stringify(v, null, 2);

/** Minimal line diff (LCS) — settings files are small. */
function unifiedDiff(a, b) {
  const x = a.split('\n');
  const y = b.split('\n');
  const n = x.length;
  const m = y.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rows = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) {
      rows.push({ t: ' ', s: x[i] });
      i++;
      j++;
    } else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) {
      rows.push({ t: '+', s: y[j++] });
    } else {
      rows.push({ t: '-', s: x[i++] });
    }
  }
  // Keep 2 lines of context around changes.
  const keep = new Set();
  rows.forEach((r, k) => {
    if (r.t !== ' ') for (let d = -2; d <= 2; d++) keep.add(k + d);
  });
  const out = [];
  let skipped = false;
  rows.forEach((r, k) => {
    if (keep.has(k)) {
      out.push(`${r.t} ${r.s}`);
      skipped = false;
    } else if (!skipped) {
      out.push('  …');
      skipped = true;
    }
  });
  return out.join('\n');
}

function stamp() {
  const d = new Date();
  const p = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function status() {
  try {
    const { value } = readSettings();
    const lists = value.hooks || {};
    const installed = Object.values(lists).some((l) => Array.isArray(l) && l.some(isOurs));
    // Events added by a newer Ambrosia: reinstalling picks them up.
    const missing = installed ? HOOK_EVENTS.map(([e]) => e).filter((e) => !(Array.isArray(lists[e]) && lists[e].some(isOurs))) : [];
    const statusLine = isOurStatus(value.statusLine);
    // Written by another copy of Ambrosia (the sources, before the installed version):
    // the relay still runs from there, reinstalling points it here.
    const here = paths.hookScript.replace(/\\/g, '/').toLowerCase();
    const moved =
      installed &&
      Object.values(lists).some((l) => Array.isArray(l) && l.some((e) => isOurs(e) && !e.hooks.some((h) => String(h.command).toLowerCase().includes(here))));
    return {
      installed,
      missing,
      moved,
      statusLine,
      chained: statusLine ? chainedCommand(value.statusLine.command) : '',
      userStatusLine: statusLine ? '' : value.statusLine?.command || '',
      settingsPath: paths.claudeSettings,
      node: nodePath(),
      script: paths.hookScript,
    };
  } catch (err) {
    return { installed: false, error: err.message, settingsPath: paths.claudeSettings };
  }
}

function preview(install) {
  const { value, bytes } = readSettings();
  const next = install ? merged(value) : withoutOurs(value);
  return {
    diff: unifiedDiff(pretty(value), pretty(next)),
    settingsPath: paths.claudeSettings,
    backup: `${paths.claudeSettings}.bak-${stamp()}`,
    fingerprint: fingerprint(bytes),
  };
}

function write(install, expectedFingerprint) {
  const { value, bytes } = readSettings();
  if (fingerprint(bytes) !== expectedFingerprint) {
    throw new Error('settings.json a changé depuis l’aperçu. Rien n’a été écrit — relis le nouveau diff.');
  }
  fs.mkdirSync(path.dirname(paths.claudeSettings), { recursive: true });
  const backup = `${paths.claudeSettings}.bak-${stamp()}`;
  if (bytes.length) fs.copyFileSync(paths.claudeSettings, backup);
  const next = install ? merged(value) : withoutOurs(value);
  const tmp = `${paths.claudeSettings}.ambrosia-${process.pid}`;
  fs.writeFileSync(tmp, pretty(next) + '\n');
  fs.renameSync(tmp, paths.claudeSettings);
  return { backup: bytes.length ? backup : null };
}

module.exports = { status, preview, write, merged, withoutOurs, unifiedDiff, chainedCommand, HOOK_EVENTS, MARKER, STATUS_MARKER };
