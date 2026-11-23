const test = require('node:test');
const assert = require('node:assert');
const C = require('../src/modules/agenda/calendar');

// Monday 23 November 2026, 15:00 local time.
const NOW = new Date(2026, 10, 23, 15, 0).getTime();
const at = (d, h, m = 0) => new Date(2026, 10, 23 + d, h, m).toISOString();

test('dayKey and dayLabel are local', () => {
  assert.strictEqual(C.dayKey(NOW), '2026-11-23');
  assert.strictEqual(C.dayKey('2026-12-01'), '2026-12-01');
  assert.strictEqual(C.dayKey(new Date(2026, 10, 23, 23, 59).getTime()), '2026-11-23');
  assert.strictEqual(C.dayLabel('2026-11-24'), 'Mardi 24 novembre');
});

test('buildDays: today from the agenda read, the 14 days from the look-ahead, sorted, deduplicated', () => {
  const events = [{ id: 'a', title: 'Revue', start: at(0, 16), end: at(0, 17), selfResponse: 'accepted' }];
  const busy = [
    { id: 'b', title: 'Daily', start: at(1, 9, 30), end: at(1, 10), selfResponse: 'accepted', meetUrl: 'https://meet.google.com/x' },
    { id: 'c', title: 'Plus tôt', start: at(1, 8), end: at(1, 8, 30), selfResponse: 'tentative' },
    { id: 'b', title: 'Daily', start: at(1, 9, 30), end: at(1, 10), selfResponse: 'accepted' }, // same instance twice
    { id: 'd', title: 'Refusé', start: at(2, 9), end: at(2, 10), selfResponse: 'declined' },
    { id: 'e', title: 'Bureau', start: at(2, 0), end: at(3, 0), selfResponse: 'accepted', eventType: 'WORKING_LOCATION' },
    { id: 'f', title: 'Congés', start: '2026-11-26', end: '2026-11-27', selfResponse: 'accepted', eventType: 'OUT_OF_OFFICE' },
    { id: 'g', title: 'Point du 26', start: at(3, 10), end: at(3, 11), selfResponse: 'accepted' },
    { id: 'h', title: 'Trop loin', start: at(20, 10), end: at(20, 11), selfResponse: 'accepted' },
    { id: 'i', title: '[Claude] bloc', start: at(4, 10), end: at(4, 11), selfResponse: 'accepted' },
  ];
  const invitations = [{ id: 'j', title: 'Comité', start: at(1, 14), end: at(1, 15), selfResponse: 'needsAction' }];
  const cal = C.buildDays({ events, busy, invitations }, NOW, { ignore: ['[Claude]'] });
  assert.strictEqual(cal.from, '2026-11-23');
  assert.strictEqual(cal.to, '2026-12-07');
  assert.deepStrictEqual(Object.keys(cal.days).sort(), ['2026-11-23', '2026-11-24', '2026-11-26']);
  assert.deepStrictEqual(cal.days['2026-11-24'].map((e) => e.id), ['c', 'b', 'j']);
  const [c, b, j] = cal.days['2026-11-24'];
  assert.strictEqual(c.tentative, true);
  assert.strictEqual(b.meet, true);
  assert.strictEqual(j.invite, true);
  // All-day first, marked as such.
  assert.deepStrictEqual(cal.days['2026-11-26'].map((e) => [e.id, e.allDay, e.focus]), [['f', true, true], ['g', false, false]]);
});

test('buildDays leaves the past days out and survives bad input', () => {
  const cal = C.buildDays({ events: [{ id: 'x', title: 'Hier', start: at(-1, 10), end: at(-1, 11) }, { id: 'y', start: 'pas une date' }, null] }, NOW);
  assert.deepStrictEqual(cal.days, {});
  assert.deepStrictEqual(C.buildDays(undefined, NOW).days, {});
});

test('monthGrid: Monday first, whole weeks', () => {
  const weeks = C.monthGrid(2026, 10); // November 2026 starts on a Sunday
  assert.strictEqual(weeks[0][0].key, '2026-10-26');
  assert.strictEqual(weeks[0][6].key, '2026-11-01');
  assert.strictEqual(weeks[0][6].inMonth, true);
  assert.ok(weeks.every((w) => w.length === 7));
  assert.strictEqual(weeks.at(-1).at(-1).key, '2026-12-06');
  assert.strictEqual(weeks.flat().filter((c) => c.inMonth).length, 30);
});

test('monthsOf: the months the window touches', () => {
  assert.deepStrictEqual(C.monthsOf('2026-11-23', '2026-12-07'), [{ year: 2026, month: 10 }, { year: 2026, month: 11 }]);
  assert.deepStrictEqual(C.monthsOf('2026-12-20', '2027-01-03'), [{ year: 2026, month: 11 }, { year: 2027, month: 0 }]);
  assert.deepStrictEqual(C.monthsOf('2026-11-01', '2026-11-15'), [{ year: 2026, month: 10 }]);
});
