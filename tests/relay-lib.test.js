const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const R = require('../hook/relay-lib');
const L = require('../src/modules/claude/logic');

test('countDiff: a changed line is +1 −1, a moved line costs nothing', () => {
  assert.deepEqual(R.countDiff('a\nb\nc', 'a\nB\nc'), { add: 1, del: 1 });
  assert.deepEqual(R.countDiff('a\nb', 'b\na'), { add: 0, del: 0 });
  assert.deepEqual(R.countDiff('', 'x\ny\n'), { add: 2, del: 0 });
  assert.deepEqual(R.countDiff('x\r\ny', ''), { add: 0, del: 2 });
});

test('editStats: Edit, MultiEdit, and Write over an existing file', () => {
  assert.deepEqual(R.editStats('Edit', { file_path: 'C:\\p\\a.js', old_string: 'x', new_string: 'x\ny' }), { file: 'C:\\p\\a.js', add: 1, del: 0 });
  assert.deepEqual(R.editStats('MultiEdit', { file_path: 'b.js', edits: [{ old_string: 'a', new_string: 'b' }, { old_string: '', new_string: 'c' }] }), { file: 'b.js', add: 2, del: 1 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amb-w-'));
  const file = path.join(dir, 'f.txt');
  fs.writeFileSync(file, 'one\ntwo\nthree\n');
  assert.deepEqual(R.editStats('Write', { file_path: file, content: 'one\n2\nthree\nfour\n' }), { file, add: 2, del: 1, created: false });
  assert.deepEqual(R.editStats('Write', { file_path: path.join(dir, 'new.txt'), content: 'a\nb' }), { file: path.join(dir, 'new.txt'), add: 2, del: 0, created: true });
  assert.equal(R.editStats('Read', { file_path: file }), null);
});

test('isTestCommand: test runners, not lookalikes', () => {
  for (const c of ['npm test', 'npm run test -- --watch=false', 'pnpm test', 'npx vitest run', 'pytest -q', 'python -m pytest', 'go test ./...', 'cargo test', 'node --test tests/*.test.js', 'cd app && npm test', 'dotnet test', './gradlew test', 'mvn -q test']) {
    assert.ok(R.isTestCommand(c), c);
  }
  for (const c of ['npm install', 'echo test', 'git commit -m "test"', 'cat tests/a.js', 'npm run build']) assert.ok(!R.isTestCommand(c), c);
});

test('testTail + testCounts read the usual summaries', () => {
  const node = 'ok 1 - a\n# tests 46\n# suites 0\n# pass 45\n# fail 1\n# cancelled 0';
  assert.deepEqual(L.testCounts(R.testTail(node)), { passed: 45, failed: 1 });
  assert.deepEqual(L.testCounts('Tests:       2 failed, 40 passed, 42 total'), { passed: 40, failed: 2 });
  assert.deepEqual(L.testCounts('===== 12 passed in 0.31s ====='), { passed: 12, failed: null });
});

test('summarizeTurn: files relative to the project, biggest first, totals', () => {
  const turn = L.newTurn(1000);
  L.addEdit(turn, { file: 'C:\\dev\\app\\src\\a.js', add: 3, del: 1 });
  L.addEdit(turn, { file: 'C:\\dev\\app\\src\\a.js', add: 2, del: 0 });
  L.addEdit(turn, { file: 'C:\\dev\\app\\README.md', add: 10, del: 4, created: false });
  L.addEdit(turn, { file: 'D:\\ailleurs\\notes.txt', add: 1, del: 0 });
  L.addTest(turn, 'npm test', { ok: true, tail: '# pass 12\n# fail 0' }, 2000);
  const card = L.summarizeTurn(turn, { cwd: 'C:\\dev\\app', now: 61000, prompt: 'go', project: 'app' });
  assert.deepEqual(card.files.map((f) => [f.file, f.add, f.del]), [['README.md', 10, 4], ['src/a.js', 5, 1], ['notes.txt', 1, 0]]);
  assert.deepEqual([card.add, card.del, card.fileCount, card.tookSec], [16, 5, 3, 60]);
  assert.deepEqual([card.tests.ok, card.tests.passed, card.tests.failed], [true, 12, 0]);
  // a "passing" run that reports failures is a failure
  L.addTest(turn, 'npm test', { ok: true, tail: '# pass 11\n# fail 1' }, 3000);
  assert.equal(turn.tests.ok, false);
});

test('claimNudges: one session’s notes, oldest first, claimed once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amb-n-'));
  const put = (sid, id, text, at) => fs.writeFileSync(path.join(dir, `${sid}~${id}.json`), JSON.stringify({ id, text, at }));
  put('sess-1', 'b', 'Ensuite les tests', 2);
  put('sess-1', 'a', 'Garde le français', 1);
  put('sess-2', 'c', 'Pas pour toi', 1);
  fs.writeFileSync(path.join(dir, 'sess-1~d.json.tmp'), '{"id":"d","text":"pas encore prêt"}');
  const got = R.claimNudges(dir, 'sess-1');
  assert.deepEqual(got.map((n) => n.id), ['a', 'b']);
  assert.deepEqual(R.claimNudges(dir, 'sess-1'), []);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['sess-1~d.json.tmp', 'sess-2~c.json']);
  assert.equal(R.nudgeContext([got[0]]), 'Note de l’utilisateur, ajoutée pendant que tu travaillais : Garde le français');
  assert.match(R.nudgeContext(got), /\(2 notes\) :\n- Garde le français\n- Ensuite les tests/);
  // a session id cannot escape the folder
  assert.equal(R.safeId('..\\..\\x'), 'x');
});

test('parseGit: branch, linked worktree or not', () => {
  const main = 'main\nC:/r/.git\nC:/r/.git\nC:/r';
  assert.deepEqual(L.parseGit(main), { branch: 'main', worktree: false, root: 'r', repo: 'r' });
  // A worktree keeps its repository's name (the day's files are grouped by repository).
  const wt = 'feat\nC:/r/.git/worktrees/feat\nC:/r/.git\nC:/r/.claude/worktrees/feat';
  assert.deepEqual(L.parseGit(wt), { branch: 'feat', worktree: true, root: 'feat', repo: 'r' });
  assert.equal(L.parseGit('main\nC:/srv/proj.git\nC:/srv/proj.git\nC:/w/proj-checkout').repo, 'proj');
  assert.equal(L.parseGit(''), null);
});
