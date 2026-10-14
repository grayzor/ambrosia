const test = require('node:test');
const assert = require('node:assert');
const L = require('../src/modules/claude/logic');

// ── Progress ────────────────────────────────────────────────────────────────

test('TodoWrite: x/y and what Claude is on now', () => {
  const s = {};
  L.applyTodos(s, [
    { content: 'Lire le code', activeForm: 'Lecture du code', status: 'completed' },
    { content: 'Écrire les tests', activeForm: 'Écriture des tests', status: 'in_progress' },
    { content: 'Committer', activeForm: 'Commit', status: 'pending' },
  ]);
  assert.equal(s.progress.done, 1);
  assert.equal(s.progress.total, 3);
  assert.equal(s.progress.current, 'Écriture des tests');
  assert.deepEqual(s.progress.items.map((i) => i.status), ['completed', 'in_progress', 'pending']);
});

test('TaskCreated / TaskCompleted build the same progress', () => {
  const s = {};
  L.taskCreated(s, { task_id: 't1', task_subject: 'Migrer la base' });
  L.taskCreated(s, { task_id: 't2', task_subject: 'Mettre à jour la doc' });
  assert.deepEqual([s.progress.done, s.progress.total, s.progress.current], [0, 2, 'Migrer la base']);
  L.taskCompleted(s, { task_id: 't1' });
  assert.deepEqual([s.progress.done, s.progress.total, s.progress.current], [1, 2, 'Mettre à jour la doc']);
  L.taskCompleted(s, { task_id: 't2' });
  assert.equal(s.progress.current, '');
});

test('a new prompt clears a finished list, keeps an unfinished one', () => {
  const s = {};
  L.applyTodos(s, [{ content: 'a', status: 'completed' }, { content: 'b', status: 'pending' }]);
  L.newTurnProgress(s);
  assert.equal(s.progress.total, 2);
  L.applyTodos(s, [{ content: 'a', status: 'completed' }, { content: 'b', status: 'completed' }]);
  L.newTurnProgress(s);
  assert.equal(s.progress, null);
});

// ── Gany vigile: sensitive commands ─────────────────────────────────────────

test('sensitive: the classics are spotted', () => {
  const bash = (command) => L.sensitive('Bash', { command });
  assert.equal(bash('git push --force origin main'), 'git push --force');
  assert.equal(bash('git push -f'), 'git push --force');
  assert.equal(bash('git push origin +main'), 'git push --force');
  assert.equal(bash('git push --force-with-lease'), 'git push --force-with-lease');
  assert.equal(bash('rm -rf node_modules'), 'suppression récursive (rm -rf)');
  assert.equal(bash('rm -fr build'), 'suppression récursive (rm -rf)');
  assert.equal(bash('Remove-Item .\\dist -Recurse -Force'), 'suppression récursive (Remove-Item)');
  assert.equal(bash('git reset --hard HEAD~3'), 'git reset --hard');
  assert.equal(bash('bq rm -f -t projet:dataset.table'), 'écriture BigQuery (bq)');
  assert.equal(bash('bq query --use_legacy_sql=false "UPDATE ds.t SET a=1 WHERE b=2"'), 'écriture BigQuery (bq query)');
  assert.equal(bash('psql -c "DROP TABLE clients"'), 'SQL DROP');
  assert.equal(bash('sqlite3 db "DELETE FROM logs"'), 'SQL DELETE sans WHERE');
  assert.equal(bash('sqlite3 db "DELETE FROM logs WHERE at < 1"'), 'SQL DELETE');
});

test('sensitive: ordinary commands stay quiet', () => {
  for (const command of ['git push origin main', 'git status', 'npm test', 'rm build.log', 'ls -rf', 'bq query "SELECT 1"', 'echo "drop me a line"', 'git push --dry-run', 'git fetch -f']) {
    assert.equal(L.sensitive('Bash', { command }), null, command);
  }
});

test('sensitive: SQL sent through a query tool (BigQuery connector)', () => {
  const tool = 'mcp__bigquery__execute_sql';
  assert.equal(L.sensitive(tool, { query: 'SELECT * FROM t' }), null);
  assert.equal(L.sensitive(tool, { query: 'DELETE FROM `p.d.t` WHERE day < "2024-01-01"' }), 'SQL DELETE');
  assert.match(L.sensitive(tool, { query: 'INSERT INTO t VALUES (1)' }), /écriture SQL/);
});

test('sensitive: the user’s own patterns, a broken one is ignored', () => {
  assert.equal(L.sensitive('Bash', { command: 'deploy prod' }, ['deploy\\s+prod', '(']), 'motif « deploy\\s+prod »');
  assert.equal(L.sensitive('Bash', { command: 'deploy staging' }, ['deploy\\s+prod', '(']), null);
});

test('an empty or malformed list is no progress', () => {
  const s = {};
  assert.equal(L.applyTodos(s, 'nope'), false);
  L.applyTodos(s, []);
  assert.equal(s.progress, null);
});

// ── Live feed in the notch ──────────────────────────────────────────────────

const edit = (path, add, del, sid = 's1') => ({ sid, project: 'ambrosia', path: `C:/r/${path}`, rel: path, add, del });

test('ticker: a burst of edits shares one line, newest first, per file', () => {
  let t = L.tickerPush(null, edit('src/view.js', 10, 2), 1000);
  t = L.tickerPush(t, edit('src/main.js', 4, 0), 2500);
  t = L.tickerPush(t, edit('src/view.js', 2, 1), 4000);
  assert.deepEqual(t.items.map((i) => [i.rel, i.add, i.del]), [['src/view.js', 12, 3], ['src/main.js', 4, 0]]);
  assert.equal(t.startedAt, 1000);
  assert.equal(t.seq, 3);
  const { parts, more } = L.tickerParts(t);
  assert.deepEqual(parts.map((p) => [p.name, p.add, p.del]), [['view.js', 12, 3], ['main.js', 4, 0]]);
  assert.equal(more, 0);
});

test('ticker: a pause, another session or a long run start a fresh line', () => {
  const t1 = L.tickerPush(null, edit('a.js', 1, 0), 1000);
  assert.equal(L.tickerPush(t1, edit('b.js', 1, 0), 1000 + L.TICKER.windowMs + 1).items.length, 1);
  assert.equal(L.tickerPush(t1, edit('b.js', 1, 0, 's2'), 1500).items.length, 1);
  let t = t1;
  for (let at = 2000; at <= 1000 + L.TICKER.spanMs; at += 2000) t = L.tickerPush(t, edit(`f${at}.js`, 1, 0), at);
  assert.ok(t.items.length > 1);
  assert.equal(L.tickerPush(t, edit('z.js', 1, 0), 1000 + L.TICKER.spanMs + 1500).items.length, 1);
});

test('ticker: past the item cap, the oldest files are counted, not shown', () => {
  let t = null;
  for (let i = 0; i < L.TICKER.items + 3; i++) t = L.tickerPush(t, edit(`f${i}.js`, 1, 0), 1000 + i * 100);
  assert.equal(t.items.length, L.TICKER.items);
  assert.equal(t.dropped, 3);
  const { parts, more } = L.tickerParts(t, 1000);
  assert.equal(parts.length, L.TICKER.items);
  assert.equal(more, 3);
});

test('ticker: what fits in the budget, then "+N"', () => {
  let t = null;
  for (const f of ['src/a-long-component.js', 'src/b.js', 'src/c.js', 'src/d.js']) t = L.tickerPush(t, edit(f, 120, 40), 1000);
  const { parts, more } = L.tickerParts(t, 30);
  assert.equal(parts.length + more, 4);
  assert.ok(parts.length >= 1 && more >= 1);
  // At least one file, however small the budget.
  assert.equal(L.tickerParts(t, 1).parts.length, 1);
});

test('displayNames: names alone, a folder added only when two collide', () => {
  assert.deepEqual(L.displayNames(['src/modules/claude/view.js', 'src/modules/agenda/view.js', 'src/main.js']), ['claude/view.js', 'agenda/view.js', 'main.js']);
  assert.deepEqual(L.displayNames(['a\\x\\index.js', 'b\\x\\index.js']), ['a/x/index.js', 'b/x/index.js']);
  assert.deepEqual(L.displayNames(['index.js', 'lib/index.js']), ['index.js', 'lib/index.js']);
});

test('shortName: the middle goes, the extension stays', () => {
  assert.equal(L.shortName('view.js'), 'view.js');
  const s = L.shortName('un-nom-de-fichier-vraiment-tres-long.test.js', 24);
  assert.equal(s.length, 24);
  assert.ok(s.endsWith('….test.js'), s);
  assert.equal(L.shortName('claude/un-nom-assez-long.js', 22), '…/un-nom-assez-long.js');
  assert.equal(L.shortName('abcdefghijklmnopqrstuvwxyz', 10).length, 10);
  assert.equal(L.delta(12, 3), '+12 −3');
  assert.equal(L.delta(4, 0), '+4');
  assert.equal(L.delta(0, 7), '−7');
  assert.equal(L.delta(0, 0), '±0');
});

test('liveFiles: cumulated counters while the turn runs', () => {
  const turn = L.newTurn(0);
  assert.equal(L.liveFiles(turn, 'C:\\r'), null);
  L.addEdit(turn, { file: 'C:\\r\\src\\a.js', add: 10, del: 2 });
  L.addEdit(turn, { file: 'C:\\r\\src\\b.js', add: 60, del: 16, created: true });
  L.addEdit(turn, { file: 'C:\\r\\src\\a.js', add: 2, del: 0 });
  const live = L.liveFiles(turn, 'C:\\r');
  assert.deepEqual([live.fileCount, live.add, live.del], [2, 72, 18]);
  assert.deepEqual(live.files.map((f) => f.file), ['src/b.js', 'src/a.js']);
  assert.equal(live.files[1].path, 'C:\\r\\src\\a.js');
});

test('NotebookEdit: lines of the new cell (relay-lib)', () => {
  const R = require('../hook/relay-lib');
  assert.deepEqual(R.editStats('NotebookEdit', { notebook_path: 'C:/n.ipynb', new_source: 'a\nb\nc', edit_mode: 'replace' }), { file: 'C:/n.ipynb', add: 3, del: 0 });
  assert.deepEqual(R.editStats('NotebookEdit', { notebook_path: 'C:/n.ipynb', edit_mode: 'delete' }), { file: 'C:/n.ipynb', add: 0, del: 0 });
});
