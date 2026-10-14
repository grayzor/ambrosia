// End-of-turn git catch-up: parsing git's output, comparing two snapshots, and a
// real repository (with a linked worktree) when git is installed.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const L = require('../src/modules/claude/logic');
const GitSnap = require('../src/modules/claude/gitsnap');

test('parseNumstat: counts, binaries, renames (plain output)', () => {
  const out = L.parseNumstat(['12\t3\tsrc/a.js', '-\t-\tdocs/logo.png', '5\t2\tsrc/{old => new}/f.js', '0\t0\told.txt => new.txt', '1\t1\tsrc/{ => lib}/g.js', ''].join('\n'));
  assert.deepEqual(out, [
    { path: 'src/a.js', add: 12, del: 3, binary: false },
    { path: 'docs/logo.png', add: 0, del: 0, binary: true },
    { path: 'src/new/f.js', from: 'src/old/f.js', add: 5, del: 2, binary: false },
    { path: 'new.txt', from: 'old.txt', add: 0, del: 0, binary: false },
    { path: 'src/lib/g.js', from: 'src/g.js', add: 1, del: 1, binary: false },
  ]);
});

test('parseNumstat: -z output, renames in two fields', () => {
  const out = L.parseNumstat('12\t3\tsrc/a b.js\x00-\t-\timg.png\x005\t2\t\x00src/old.js\x00src/new.js\x00');
  assert.deepEqual(out.map((e) => [e.path, e.from || null, e.add, e.del, e.binary]), [
    ['src/a b.js', null, 12, 3, false],
    ['img.png', null, 0, 0, true],
    ['src/new.js', 'src/old.js', 5, 2, false],
  ]);
  assert.deepEqual(L.parseNumstat(''), []);
});

test('parseUntracked: plain (quoted) and -z (renames skipped)', () => {
  assert.deepEqual(L.parseUntracked(' M src/a.js\n?? new.txt\n?? "dossier/\\303\\251t\\303\\251 \\"x\\".txt"\n?? build/\n'), ['new.txt', 'dossier/été "x".txt', 'build/']);
  assert.deepEqual(L.parseUntracked('R  new.js\x00old.js\x00?? a b.txt\x00 M c.js\x00?? dir/\x00'), ['a b.txt', 'dir/']);
  assert.equal(L.parseUntracked(Array.from({ length: 10 }, (_, i) => `?? f${i}`).join('\n'), 3).length, 3);
});

test('gitCatchup: only what changed during the turn, tools excluded', () => {
  const start = { top: 'C:\\r', head: 'abc', numstat: [{ path: 'a.js', add: 10, del: 2, binary: false }, { path: 'img.png', add: 0, del: 0, binary: true }, { path: 'same.js', add: 4, del: 4, binary: false }], untracked: ['old-notes.txt'] };
  const end = {
    top: 'C:\\r',
    head: 'abc',
    numstat: [
      { path: 'a.js', add: 15, del: 2, binary: false }, // +5 by a command
      { path: 'img.png', add: 0, del: 0, binary: true }, // dirty before: can't tell
      { path: 'same.js', add: 4, del: 4, binary: false }, // untouched
      { path: 'tool.js', add: 30, del: 1, binary: false }, // the Edit tool did it
      { path: 'gen/schema.ts', add: 100, del: 0, binary: false },
      { path: 'new.bin', add: 0, del: 0, binary: true },
      { path: 'shrunk.js', add: 2, del: 0, binary: false },
    ],
    untracked: ['old-notes.txt', 'out.json', 'dist/'],
  };
  start.numstat.push({ path: 'shrunk.js', add: 5, del: 0, binary: false }); // 3 of its added lines removed again
  const out = L.gitCatchup(start, end, { known: ['c:/r/TOOL.js'] });
  const by = Object.fromEntries(out.map((e) => [e.rel, e]));
  assert.deepEqual(Object.keys(by).sort(), ['a.js', 'dist', 'gen/schema.ts', 'new.bin', 'out.json', 'shrunk.js']);
  assert.deepEqual([by['a.js'].add, by['a.js'].del], [5, 0]);
  assert.deepEqual([by['shrunk.js'].add, by['shrunk.js'].del], [0, 3]);
  assert.equal(by['gen/schema.ts'].path, 'C:\\r\\gen\\schema.ts');
  assert.equal(by['out.json'].created, true);
  assert.equal(by.dist.dir, true);
  assert.equal(by['new.bin'].binary, true);
  assert.equal(out[0].rel, 'gen/schema.ts'); // the biggest first
  assert.equal(L.gitCatchup(start, end, { cap: 2 }).length, 2);
  assert.deepEqual(L.gitCatchup(null, end), []);
});

test('addCatchup: « via commande » rows join the turn, tool rows untouched', () => {
  const turn = L.newTurn(0);
  L.addEdit(turn, { file: 'C:\\r\\a.js', add: 1, del: 0 });
  assert.equal(L.addCatchup(turn, [{ path: 'C:\\r\\a.js', add: 9, del: 9 }, { path: 'C:\\r\\b.js', add: 3, del: 1 }]), 1);
  const card = L.summarizeTurn(turn, { cwd: 'C:\\r', now: 1000, prompt: '', project: 'r' });
  assert.deepEqual(card.files.map((f) => [f.file, f.add, f.del, f.via || null]), [['b.js', 3, 1, 'commande'], ['a.js', 1, 0, null]]);
  assert.deepEqual([card.fileCount, card.add, card.del], [2, 4, 1]);
});

// ── A real repository ───────────────────────────────────────────────────────

let hasGit = true;
try {
  execFileSync('git', ['--version'], { stdio: 'ignore' });
} catch {
  hasGit = false;
}

function repo() {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'amb-git-')));
  const run = (args, cwd = dir) => execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { stdio: 'pipe' }).toString();
  run(['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(dir, 'a.txt'), '1\n2\n3\n');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'b\n');
  fs.writeFileSync(path.join(dir, 'd.txt'), 'd\n');
  run(['add', '.']);
  run(['commit', '-q', '-m', 'init']);
  return { dir, run };
}

test('snapshot + catch-up on a real repository: commands, commits, new files, worktree', { skip: !hasGit && 'git absent' }, async () => {
  const { dir, run } = repo();
  try {
    fs.appendFileSync(path.join(dir, 'a.txt'), 'dirty before\n'); // already changed when the prompt arrives
    const start = await GitSnap.snapshot(dir);
    assert.ok(start?.head);
    assert.equal(start.top.toLowerCase(), path.normalize(dir).toLowerCase());
    // The turn: a command appends to a.txt, the Edit tool changes b.txt, a commit, a new file and folder.
    fs.appendFileSync(path.join(dir, 'a.txt'), 'x\ny\n');
    fs.writeFileSync(path.join(dir, 'b.txt'), 'B\n');
    fs.writeFileSync(path.join(dir, 'd.txt'), 'd\nd2\n');
    run(['commit', '-q', '-m', 'during the turn', '--', 'd.txt']);
    fs.writeFileSync(path.join(dir, 'c.txt'), 'c1\nc2\nc3\n');
    fs.mkdirSync(path.join(dir, 'gen'));
    fs.writeFileSync(path.join(dir, 'gen', 'x.ts'), 'x\n');
    const end = await GitSnap.snapshot(dir, start.head);
    const out = L.gitCatchup(start, end, { known: [path.join(dir, 'b.txt')] });
    const by = Object.fromEntries(out.map((e) => [e.rel, e]));
    assert.deepEqual(Object.keys(by).sort(), ['a.txt', 'c.txt', 'd.txt', 'gen']);
    assert.deepEqual([by['a.txt'].add, by['a.txt'].del], [2, 0]);
    assert.deepEqual([by['d.txt'].add, by['d.txt'].del], [1, 0]); // committed during the turn: still seen
    assert.equal(by['c.txt'].created, true);
    assert.equal(by.gen.dir, true);
    assert.equal(by['c.txt'].path.toLowerCase(), path.join(dir, 'c.txt').toLowerCase());
    // A linked worktree is its own working tree.
    const wt = `${dir}-wt`;
    run(['worktree', 'add', '-q', wt, '-b', 'feature']);
    const ws = await GitSnap.snapshot(path.join(wt));
    assert.equal(ws.top.toLowerCase(), path.normalize(wt).toLowerCase());
    fs.appendFileSync(path.join(wt, 'a.txt'), 'wt\n');
    const we = await GitSnap.snapshot(wt, ws.head);
    assert.deepEqual(L.gitCatchup(ws, we).map((e) => [e.rel, e.add]), [['a.txt', 1]]);
    run(['worktree', 'remove', '--force', wt]);
    // Outside a repository: nothing, quickly.
    assert.equal(await GitSnap.snapshot(os.tmpdir()), null);
    // No index.lock left behind (GIT_OPTIONAL_LOCKS=0).
    assert.equal(fs.existsSync(path.join(dir, '.git', 'index.lock')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
