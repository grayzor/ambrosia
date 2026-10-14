// The claude module's diffs: line diff (Myers), folding, caps, git output, path checks.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('../src/modules/claude/logic');
const R = require('../hook/relay-lib');

/** Rebuilds both sides from the ops: a diff must lose nothing. */
function check(a, b, ops = L.diffLines(a, b)) {
  const left = ops.filter(([op]) => op !== '+').map(([, i]) => a[i]);
  const right = ops.filter(([op]) => op !== '-').map(([, , j]) => b[j]);
  assert.deepEqual(left, a);
  assert.deepEqual(right, b);
  for (const [op, i, j] of ops) if (op === '=') assert.equal(a[i], b[j]);
  return ops;
}

function lcs(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  return dp[0][0];
}

const sig = (rows) => rows.map((r) => (r.t === '…' ? `…${r.count}` : `${r.t}${r.s}`)).join('|');

test('diff: empty sides', () => {
  assert.deepEqual(L.diffLines([], []), []);
  assert.deepEqual(L.diffRows('', ''), []);
  assert.equal(sig(L.diffRows('', 'a\nb')), '+a|+b');
  assert.equal(sig(L.diffRows('a\nb\n', '')), '-a|-b');
});

test('diff: pure additions, pure deletions, a replacement', () => {
  assert.equal(sig(L.diffRows('a\nc', 'a\nb\nc')), ' a|+b| c');
  assert.equal(sig(L.diffRows('a\nb\nc', 'a\nc')), ' a|-b| c');
  assert.equal(sig(L.diffRows('a\nb\nc', 'a\nx\nc')), ' a|-b|+x| c');
  assert.equal(sig(L.diffRows('a\r\nb\r\n', 'a\nb\n')), ' a| b'); // line endings do not count
});

test('diff: minimal on random inputs (as many kept lines as the LCS)', () => {
  let seed = 7;
  const rnd = (n) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
  for (let k = 0; k < 300; k++) {
    const a = Array.from({ length: rnd(14) }, () => 'xyzw'[rnd(4)]);
    const b = Array.from({ length: rnd(14) }, () => 'xyzw'[rnd(4)]);
    const ops = check(a, b);
    assert.equal(ops.filter(([op]) => op === '=').length, lcs(a, b), `${a.join('')} / ${b.join('')}`);
  }
});

test('diff: line numbers from the edit’s place, none when unknown', () => {
  const rows = L.diffRows('a\nb\nc', 'a\nB\nc', 120);
  assert.deepEqual(rows.map((r) => [r.t, r.o, r.n]), [[' ', 120, 120], ['-', 121, null], ['+', null, 121], [' ', 122, 122]]);
  assert.deepEqual(L.diffRows('a', 'b', null).map((r) => [r.o, r.n]), [[null, null], [null, null]]);
});

test('diff: a long file with one change is quick and exact', () => {
  const a = Array.from({ length: 20000 }, (_, i) => `ligne ${i}`);
  const b = a.slice();
  b[12345] = 'changée';
  b.push('fin');
  const t = Date.now();
  const ops = check(a, b);
  assert.ok(Date.now() - t < 1000);
  assert.deepEqual(ops.filter(([op]) => op !== '=').map(([op, i, j]) => [op, i, j]), [['-', 12345, -1], ['+', -1, 12345], ['+', -1, 20000]]);
});

test('diff: past maxD it gives up aligning, still loses nothing', () => {
  const a = Array.from({ length: 400 }, (_, i) => `a${i}`);
  const b = Array.from({ length: 400 }, (_, i) => `b${i}`);
  const ops = check(a, b, L.diffLines(a, b, 10));
  assert.equal(ops.filter(([op]) => op === '-').length, 400);
  // Two big unrelated files: bounded time.
  const t = Date.now();
  check(a.concat(b), b.concat(a));
  assert.ok(Date.now() - t < 2000);
});

test('foldRows: long unchanged runs fold, three lines of context stay', () => {
  const a = Array.from({ length: 50 }, (_, i) => `l${i}`);
  const b = a.slice();
  b[25] = 'X';
  const rows = L.foldRows(L.diffRows(a.join('\n'), b.join('\n')));
  assert.equal(sig(rows), '…22| l22| l23| l24|-l25|+X| l26| l27| l28|…21');
  assert.equal(rows[0].rows.length, 22);
  assert.equal(rows[0].rows[0].n, 1);
  // Short runs stay as they are.
  assert.equal(sig(L.foldRows(L.diffRows('a\nb\nc', 'a\nB\nc'))), ' a|-b|+B| c');
  // Two changes far apart: one fold in the middle, short edges kept.
  const c = a.slice();
  c[2] = 'Y';
  c[45] = 'Z';
  const mid = L.foldRows(L.diffRows(a.join('\n'), c.join('\n')));
  assert.equal(mid.filter((r) => r.t === '…').length, 1);
  assert.equal(mid.find((r) => r.t === '…').count, 36);
  assert.equal(mid.length, 2 + 2 + 3 + 1 + 3 + 2 + 4);
});

test('lineOf: where the new text starts, LF or CRLF', () => {
  assert.equal(L.lineOf('a\nb\nc\nd', 'c\nd'), 3);
  assert.equal(L.lineOf('a\r\nb\r\nc\r\nd', 'c\nd'), 3);
  assert.equal(L.lineOf('abc', 'abc'), 1);
  assert.equal(L.lineOf('abc', 'zzz'), null);
  assert.equal(L.lineOf('abc', '  '), null);
});

test('storeEdit: caps per file and per turn, the rest is counted as dropped', () => {
  const caps = { perEdit: 10, perTurn: 30, perFile: 2 };
  const turn = L.newTurn(0);
  const file = 'C:/r/a.js';
  L.addEdit(turn, { file, add: 1, del: 1 });
  const e1 = L.storeEdit(turn, file, { tool: 'Edit', blocks: [{ old: 'abcdefgh', new: 'ABCDEFGH' }] }, 1, caps);
  assert.equal(e1.blocks[0].old, 'abcdefgh');
  assert.equal(e1.blocks[0].new, 'AB'); // 10 characters per edit
  assert.equal(e1.blocks[0].cut, true);
  assert.ok(L.storeEdit(turn, file, { tool: 'Edit', blocks: [{ old: 'x', new: 'y' }] }, 2, caps));
  assert.equal(L.storeEdit(turn, file, { tool: 'Edit', blocks: [{ old: 'x', new: 'y' }] }, 3, caps), null); // 2 per file
  assert.equal(turn.files[file].dropped, 1);
  const other = 'C:/r/b.js';
  L.addEdit(turn, { file: other, add: 1, del: 0 });
  assert.ok(L.storeEdit(turn, other, { tool: 'Write', blocks: [{ old: '', new: '0123456789' }] }, 4, caps));
  assert.equal(L.storeEdit(turn, other, { tool: 'Write', blocks: [{ old: '', new: '0123456789' }] }, 5, caps), null); // 30 per turn
  assert.equal(turn.files[other].dropped, 1);
  const d = L.fileDiff(turn.edits[other], { dropped: turn.files[other].dropped });
  assert.match(d.notes.join(' '), /1 modification non conservée/);
});

test('fileDiff: one block per edit and per MultiEdit part, first changed line', () => {
  const entries = [
    { at: 1, tool: 'MultiEdit', blocks: [{ old: 'a', new: 'b', line: 10 }, { old: 'c', new: 'd\ne', line: 40, all: true }], omitted: 3 },
    { at: 2, tool: 'Write', blocks: [{ old: 'x\ny', new: 'x\nz', cut: true }], oldUnknown: true },
  ];
  const d = L.fileDiff(entries);
  assert.deepEqual(d.blocks.map((b) => b.title), ['Modifications 1/2', 'Modifications 2/2 · toutes les occurrences', 'Écriture']);
  assert.deepEqual(d.blocks.map((b) => [b.add, b.del]), [[1, 1], [2, 1], [1, 1]]);
  assert.equal(d.line, 10);
  assert.equal(d.blocks[2].line, 1);
  const notes = d.notes.join(' ');
  assert.match(notes, /3 sous-modifications non conservées/);
  assert.match(notes, /aperçu tronqué/);
  assert.match(notes, /Contenu précédent inconnu/);
});

test('editFromInput: an older relay’s 4000-character cut is spotted', () => {
  const long = 'x'.repeat(4000) + '…';
  const e = L.editFromInput('Edit', { old_string: long, new_string: 'y' });
  assert.equal(e.blocks[0].cut, true);
  assert.equal(L.editFromInput('Write', { content: 'a' }).oldUnknown, true);
  assert.equal(L.editFromInput('Read', {}), null);
});

test('parseUnified: hunks, line numbers, binaries', () => {
  const out = L.parseUnified([
    'diff --git a/x.js b/x.js',
    '--- a/x.js',
    '+++ b/x.js',
    '@@ -10,3 +10,4 @@ function f() {',
    ' a',
    '-b',
    '+B',
    '+C',
    ' c',
    '@@ -40 +41 @@',
    '-old',
    '+new',
    '\\ No newline at end of file',
  ].join('\r\n'));
  assert.equal(out.binary, false);
  assert.equal(out.blocks.length, 2);
  assert.equal(out.blocks[0].title, 'function f() {');
  assert.deepEqual(out.blocks[0].rows.map((r) => [r.t, r.o, r.n]), [[' ', 10, 10], ['-', 11, null], ['+', null, 11], ['+', null, 12], [' ', 12, 13]]);
  assert.deepEqual([out.blocks[1].title, out.blocks[1].add, out.blocks[1].del], ['Ligne 41', 1, 1]);
  assert.equal(L.parseUnified('diff --git a/i.png b/i.png\nBinary files a/i.png and b/i.png differ').binary, true);
  assert.deepEqual(L.parseUnified('').blocks, []);
});

test('pathUnder: inside the folder only', () => {
  const cwd = 'C:\\Users\\me\\repo';
  assert.equal(L.pathUnder(cwd, 'C:\\Users\\me\\repo\\src\\a.js'), 'C:\\Users\\me\\repo\\src\\a.js');
  assert.equal(L.pathUnder(cwd, 'c:/users/ME/repo/src/a.js'), 'c:\\users\\ME\\repo\\src\\a.js'); // any case
  assert.equal(L.pathUnder(cwd, 'src/./b.js'), 'C:\\Users\\me\\repo\\src\\b.js');
  assert.equal(L.pathUnder(cwd, 'src\\..\\c.js'), 'C:\\Users\\me\\repo\\c.js');
  for (const bad of ['..\\secret.txt', 'src\\..\\..\\x', 'C:\\Users\\me\\repo2\\a.js', 'C:\\Users\\me\\repo', 'D:\\repo\\a.js', '\\\\server\\share\\a.js', 'C:evil.js', 'a\0b', '', null]) {
    assert.equal(L.pathUnder(cwd, bad), null, String(bad));
  }
  assert.equal(L.pathUnder('/home/me/repo', '/home/me/repo/x.js'), '/home/me/repo/x.js');
  assert.equal(L.pathUnder('/home/me/repo', '/etc/passwd'), null);
  assert.equal(L.pathUnder('', 'a.js'), null);
});

test('quotable: what may go between double quotes on a cmd line', () => {
  assert.equal(L.quotable('C:\\Users\\me\\Mon dossier\\a & b.js'), true);
  for (const bad of ['C:\\a"b.js', 'C:\\%PATH%.js', 'C:\\a!b.js', 'C:\\a^b.js', 'a\nb', '']) assert.equal(L.quotable(bad), false, bad);
});

// ── Relay side: the texts handed over, capped ──────────────────────────────

test('relay editInfo: Edit and MultiEdit texts, capped per text and per event', () => {
  const big = 'x'.repeat(R.EDIT_CAP + 10);
  const e = R.editInfo('Edit', { file_path: 'C:/a.js', old_string: 'a', new_string: big, replace_all: true });
  assert.deepEqual(e.stats, { file: 'C:/a.js', add: 1, del: 1 });
  assert.equal(e.edit.blocks[0].new.length, R.EDIT_CAP);
  assert.equal(e.edit.blocks[0].cut, true);
  assert.equal(e.edit.blocks[0].all, true);
  const edits = Array.from({ length: 60 }, (_, i) => ({ old_string: `o${i}`, new_string: 'n'.repeat(5000) }));
  const m = R.editInfo('MultiEdit', { file_path: 'C:/a.js', edits });
  const size = m.edit.blocks.reduce((n, b) => n + b.old.length + b.new.length, 0);
  assert.ok(size <= R.EDIT_TOTAL, `${size}`);
  assert.equal(m.edit.blocks.length + m.edit.omitted, 60);
  assert.equal(m.stats.add, 60);
  assert.equal(R.editStats('MultiEdit', { file_path: 'C:/a.js', edits }).add, 60); // stats alone, unchanged
});

test('relay editInfo: a Write carries the previous content (read once)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amb-diff-'));
  const file = path.join(dir, 'f.txt');
  fs.writeFileSync(file, 'a\nb\n');
  const w = R.editInfo('Write', { file_path: file, content: 'a\nc\n' });
  assert.deepEqual(w.stats, { file, add: 1, del: 1, created: false });
  assert.deepEqual([w.edit.blocks[0].old, w.edit.blocks[0].new], ['a\nb\n', 'a\nc\n']);
  const n = R.editInfo('Write', { file_path: path.join(dir, 'new.txt'), content: 'x' });
  assert.equal(n.edit.created, true);
  fs.rmSync(dir, { recursive: true, force: true });
});
