// Git snapshots of a session's working tree, for the end-of-turn catch-up
// (files a command changed). Only runs in Ambrosia, never in the hook relay:
// execFile with an argument array (no shell), short deadlines, and
// GIT_OPTIONAL_LOCKS=0 so git never takes the index lock Claude may need.
// Tested against a real repository in tests/claude-git.test.js.

const { execFile } = require('child_process');
const path = require('path');
const L = require('./logic');

const ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0' };

function git(cwd, args, timeout = 3000) {
  return new Promise((resolve) => {
    execFile('git', ['-C', cwd, '-c', 'core.quotepath=off', ...args], { windowsHide: true, timeout, maxBuffer: 2 * 1024 * 1024, env: ENV }, (err, out) => resolve(err ? null : String(out)));
  });
}

/**
 * { top, head, numstat, untracked } of the working tree `cwd` belongs to (a linked
 * worktree is its own top), or null outside a repository. `head`: compare with this
 * commit (the start snapshot's) rather than the current HEAD.
 */
async function snapshot(cwd, head) {
  if (!cwd) return null;
  const top = (await git(cwd, ['rev-parse', '--show-toplevel'], 1500))?.trim();
  if (!top) return null;
  if (head === undefined) head = (await git(cwd, ['rev-parse', '--verify', '-q', 'HEAD'], 1500))?.trim() || null;
  const [num, st] = await Promise.all([
    head ? git(cwd, ['diff', '--numstat', '-z', '-M', head]) : Promise.resolve(''),
    git(cwd, ['status', '--porcelain', '-z', '--untracked-files=normal']),
  ]);
  if (num == null || st == null) return null;
  return { top: path.normalize(top), head, numstat: L.parseNumstat(num), untracked: L.parseUntracked(st) };
}

module.exports = { snapshot, git, ENV };
