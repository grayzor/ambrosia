const test = require('node:test');
const assert = require('node:assert');
const H = require('../src/modules/claude/harvest');

const at = (d, h = 10) => new Date(2026, 9, d, h, 0); // October 2026: Mon 5 … Sun 11

test('weekKey: the Monday of the week, Sunday included', () => {
  assert.equal(H.weekKey(at(5)), '2026-10-05');
  assert.equal(H.weekKey(at(9)), '2026-10-05');
  assert.equal(H.weekKey(at(11, 23)), '2026-10-05');
  assert.equal(H.weekKey(at(12)), '2026-10-12');
});

test('a week of turns: totals, unique sessions, repos, longest task, quota peak', () => {
  const days = {};
  H.recordTurn(days, at(5), { sessionId: 'a', project: 'ambrosia', tookSec: 600, add: 120, del: 30, prompt: 'Jauges' });
  H.recordTurn(days, at(5, 14), { sessionId: 'a', project: 'ambrosia', tookSec: 2820, add: 400, del: 90, prompt: 'Relais statusLine' });
  H.recordTurn(days, at(7), { sessionId: 'b', project: 'data-lab', tookSec: 300, add: 10, del: 2, prompt: 'Jointure' });
  H.recordTurn(days, at(2), { sessionId: 'old', project: 'atlas', tookSec: 9999, add: 1, del: 1 }); // previous week
  H.recordQuota(days, at(7), 92.4, 41);
  H.recordQuota(days, at(8), 60, 55);
  const w = H.weekSummary(days, at(9, 16));
  assert.equal(w.from, '2026-10-05');
  assert.equal(w.to, '2026-10-11');
  assert.equal(w.sessions, 2);
  assert.equal(w.turns, 3);
  assert.equal(w.workMs, 3720 * 1000);
  assert.deepEqual([w.add, w.del], [530, 122]);
  assert.deepEqual(w.repos, [{ name: 'ambrosia', turns: 2 }, { name: 'data-lab', turns: 1 }]);
  assert.equal(w.longest.prompt, 'Relais statusLine');
  assert.equal(w.longest.day, '2026-10-05');
  assert.deepEqual([w.peak5, w.peak7], [92, 55]);
  assert.equal(w.busiest, '2026-10-05');
  assert.deepEqual(w.days.map((d) => d.letter).join(''), 'LMMJVSD');
});

test('the day’s most edited files, per repository (worktrees under their repository)', () => {
  const days = {};
  H.recordTurn(days, at(5, 9), { sessionId: 'a', project: 'agent-x', repo: 'ambrosia', tookSec: 60, add: 30, del: 5, files: [{ file: 'src\\view.js', add: 20, del: 5 }, { file: 'src/logic.js', add: 10, del: 0 }] });
  H.recordTurn(days, at(5, 11), { sessionId: 'b', project: 'ambrosia', repo: 'ambrosia', tookSec: 60, add: 9, del: 1, files: [{ file: 'src/view.js', add: 4, del: 1 }, { file: 'README.md', add: 5, del: 0 }] });
  H.recordTurn(days, at(5, 12), { sessionId: 'c', project: 'data-lab', tookSec: 60, add: 3, del: 3, files: [{ file: 'a.sql', add: 3, del: 3 }, { file: 'dist', add: 0, del: 0 }] });
  const top = H.dayTopFiles(days, at(5, 18));
  assert.deepEqual(top.ambrosia, [{ file: 'src/view.js', add: 24, del: 6 }, { file: 'src/logic.js', add: 10, del: 0 }, { file: 'README.md', add: 5, del: 0 }]);
  assert.deepEqual(top['data-lab'], [{ file: 'a.sql', add: 3, del: 3 }]); // no repo name: the project; empty rows left out
  assert.equal(H.dayTopFiles(days, at(5), 1).ambrosia.length, 1);
  assert.deepEqual(H.dayTopFiles(days, at(6)), {});
  // The week: the three most worked files, all repositories together.
  H.recordTurn(days, at(7), { sessionId: 'd', project: 'data-lab', tookSec: 60, add: 50, del: 0, files: [{ file: 'a.sql', add: 50, del: 0 }] });
  const w = H.weekSummary(days, at(9));
  assert.deepEqual(w.topFiles.map((f) => [f.repo, f.file, f.add, f.del]), [['data-lab', 'a.sql', 53, 3], ['ambrosia', 'src/view.js', 24, 6], ['ambrosia', 'src/logic.js', 10, 0]]);
});

test('the day’s files are capped per repository', () => {
  const days = {};
  const files = Array.from({ length: H.FILES_PER_REPO + 20 }, (_, i) => ({ file: `f${i}.js`, add: 1, del: 0 }));
  H.recordTurn(days, at(5), { sessionId: 'a', project: 'p', tookSec: 1, add: 1, del: 0, files });
  assert.equal(Object.keys(days['2026-10-05'].files.p).length, H.FILES_PER_REPO);
});

test('prune keeps about eight weeks', () => {
  const days = { '2026-07-01': {}, '2026-08-20': {}, '2026-10-09': {} };
  H.prune(days, at(9));
  assert.deepEqual(Object.keys(days), ['2026-08-20', '2026-10-09']);
});

test('due: Friday after the hour, once a week, only with something to show', () => {
  const some = { turns: 3 };
  const st = { harvestDay: 5, harvestAt: '15:00' };
  assert.equal(H.due(at(9, 14), st, '', some), false, 'too early');
  assert.equal(H.due(at(9, 15), st, '', some), true);
  assert.equal(H.due(at(9, 16), st, '2026-10-05', some), false, 'already shown this week');
  assert.equal(H.due(at(8, 16), st, '', some), false, 'Thursday');
  assert.equal(H.due(at(9, 16), st, '', { turns: 0 }), false, 'nothing harvested');
  assert.equal(H.due(at(9, 16), { ...st, harvestEnabled: false }, '', some), false);
  assert.equal(H.due(at(6, 9), { harvestDay: '2', harvestAt: '08:30' }, '', some), true, 'setting as a string (select)');
});
