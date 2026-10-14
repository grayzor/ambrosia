// Routines — what is read on disk (never written) and how Claude Desktop is reached.
//
//   * Existing scheduled tasks of the Claude app: ~/.claude/scheduled-tasks/<id>/SKILL.md
//     (prompt + name/description), and the app's own registry with the schedule:
//     %APPDATA%\Claude\claude-code-sessions\<account>\<org>\scheduled-tasks.json
//     ({ scheduledTasks: [{ id, cronExpression | fireAt, enabled, filePath, cwd… }] }).
//     That registry is internal to the app: Ambrosia only READS it (to show the schedule,
//     to confirm a creation). Tasks are created by the app itself (create_scheduled_task).
//   * Claude Code transcripts (~/.claude/projects/*/<session>.jsonl): the first request
//     of each recent session, read from the first 64 KB only.
//   * Claude Desktop's `claude://` handler, read from the registry, to open a new
//     Claude Code session with the creation request in its composer.
// Paths are parameters, so tests run on a scratch folder.

const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('./logic');

const home = () => process.env.USERPROFILE || os.homedir();
const defaultTasksDir = () => path.join(home(), '.claude', 'scheduled-tasks');
const defaultRegistryRoot = () => path.join(process.env.APPDATA || path.join(home(), 'AppData', 'Roaming'), 'Claude', 'claude-code-sessions');
const defaultProjectsDir = () => path.join(home(), '.claude', 'projects');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

/** Every scheduled-tasks.json of the Claude app (one per account / organisation). */
function registryFiles(root = defaultRegistryRoot()) {
  const out = [];
  try {
    for (const a of fs.readdirSync(root, { withFileTypes: true })) {
      if (!a.isDirectory()) continue;
      for (const b of fs.readdirSync(path.join(root, a.name), { withFileTypes: true })) {
        const f = path.join(root, a.name, b.name, 'scheduled-tasks.json');
        if (b.isDirectory() && fs.existsSync(f)) out.push(f);
      }
    }
  } catch {
    /* no Claude app */
  }
  return out;
}

/**
 * The user's scheduled tasks: [{ id, name, title, description, cron, fireAt, enabled, cwd, prompt, registered }].
 * `ids` also lists folders without SKILL.md (state folders), so a new id never collides.
 */
function readExistingTasks({ tasksDir = defaultTasksDir(), registryRoot = defaultRegistryRoot() } = {}) {
  const reg = new Map();
  for (const f of registryFiles(registryRoot)) {
    for (const t of readJson(f)?.scheduledTasks || []) if (t?.id) reg.set(t.id, t);
  }
  const tasks = [];
  const ids = [];
  let dirs = [];
  try {
    dirs = fs.readdirSync(tasksDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    /* none yet */
  }
  for (const id of dirs) {
    ids.push(id);
    let text;
    try {
      text = fs.readFileSync(path.join(tasksDir, id, 'SKILL.md'), 'utf8');
    } catch {
      continue;
    }
    const skill = L.parseSkill(text);
    const r = reg.get(id);
    tasks.push({
      id,
      name: skill.name || id,
      title: r?.displayName || '',
      description: skill.description,
      cron: r?.cronExpression || '',
      fireAt: r?.fireAt || null,
      enabled: r ? r.enabled !== false : true,
      cwd: r?.cwd || '',
      registered: !!r,
      prompt: skill.body,
    });
  }
  return { tasks, ids };
}

/** The folder most existing tasks run in (new ones go there too), else the home folder. */
function usualTaskFolder(tasks) {
  const count = new Map();
  for (const t of tasks) if (t.cwd) count.set(t.cwd, (count.get(t.cwd) || 0) + 1);
  const best = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return best && fs.existsSync(best) ? best : home();
}

/**
 * First requests of the user's recent Claude Code sessions, newest first:
 * [{ day, project, prompt }]. Ambrosia's own calls, agents' worktrees, scratch
 * folders and scheduled-task runs are left out.
 */
function readClaudeHistory({ projectsDir = defaultProjectsDir(), days = 21, now = new Date(), max = 120 } = {}) {
  const since = now.getTime() - days * L.DAY;
  const out = [];
  let projects = [];
  try {
    projects = fs.readdirSync(projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory() && !L.NOT_USER_PROJECT.test(d.name));
  } catch {
    return out;
  }
  for (const p of projects) {
    const dir = path.join(projectsDir, p.name);
    let files = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const f of files) {
      const file = path.join(dir, f);
      let st;
      try {
        st = fs.statSync(file);
      } catch {
        continue;
      }
      if (st.mtimeMs < since) continue;
      let head = '';
      try {
        const fd = fs.openSync(file, 'r');
        const buf = Buffer.alloc(65536);
        const n = fs.readSync(fd, buf, 0, buf.length, 0);
        fs.closeSync(fd);
        head = buf.subarray(0, n).toString('utf8');
      } catch {
        continue;
      }
      const first = L.firstPrompt(head.split('\n'));
      if (!first || (first.at && first.at < since)) continue;
      const project = path.basename(first.cwd || '') || p.name.split('-').filter(Boolean).pop();
      out.push({ at: first.at || st.mtimeMs, day: L.dayKey(new Date(first.at || st.mtimeMs)), project, prompt: first.text });
    }
  }
  return out
    .sort((a, b) => b.at - a.at)
    .slice(0, max)
    .map(({ at, ...rest }) => rest);
}

// ── Claude Desktop (shared with « Confier à Claude »: src/main/claude-desktop.js) ──

const desktop = require('../../main/claude-desktop');
/** The command Windows runs for claude:// links → exe path, or null. */
const protocolHandler = () => desktop.protocolHandler();
/** Opens the link in Claude Desktop (a running app receives it as a second instance). */
const openInDesktop = (url, opts) => desktop.openLink(url, opts);

module.exports = { readExistingTasks, usualTaskFolder, readClaudeHistory, registryFiles, protocolHandler, openInDesktop, defaultTasksDir };
