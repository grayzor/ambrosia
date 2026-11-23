const test = require('node:test');
const assert = require('node:assert');
const { AlertLog, groups, sources } = require('../src/main/alert-log');

const H = 3600 * 1000;

test('newest first, same key replaces and counts the repeats', () => {
  const log = new AlertLog();
  log.add({ key: 'mail:a', module: 'mail', title: 'Un', sound: 'mail' }, 1000);
  log.add({ key: 'clickup:b', module: 'clickup', title: 'Deux' }, 2000);
  log.add({ key: 'mail:a', module: 'mail', title: 'Un bis' }, 3000);
  const s = log.snapshot(3000);
  assert.deepStrictEqual(s.items.map((x) => x.key), ['mail:a', 'clickup:b']);
  assert.strictEqual(s.items[0].title, 'Un bis');
  assert.strictEqual(s.items[0].repeats, 1);
  assert.strictEqual(s.items[0].loud, false);
});

test('held alerts are kept and marked, the call recap is not', () => {
  const log = new AlertLog();
  log.add({ key: 'mail:a', module: 'mail', title: 'Pendant l’appel' }, 1000, { held: true });
  assert.strictEqual(log.add({ key: 'core:call-recap', title: 'Pendant ta réunion : 1 mail' }, 2000), false);
  const s = log.snapshot(2000);
  assert.strictEqual(s.items.length, 1);
  assert.strictEqual(s.items[0].held, true);
});

test('module is read from the key when missing; texts are clipped', () => {
  const log = new AlertLog();
  log.add({ key: 'agenda:x', title: 'a'.repeat(400), text: 'b\n\n  c' }, 1);
  const it = log.snapshot(1).items[0];
  assert.strictEqual(it.module, 'agenda');
  assert.strictEqual(it.title.length, 160);
  assert.strictEqual(it.text, 'b c');
});

test('cap and age', () => {
  const log = new AlertLog({ max: 3 });
  for (let i = 0; i < 5; i++) log.add({ key: `m:${i}` }, i);
  assert.deepStrictEqual(log.snapshot(5).items.map((x) => x.key), ['m:4', 'm:3', 'm:2']);
  const old = new AlertLog();
  old.add({ key: 'm:old' }, 0);
  old.add({ key: 'm:new' }, 23 * H);
  assert.deepStrictEqual(old.snapshot(25 * H).items.map((x) => x.key), ['m:new']);
});

test('unseen counts what arrived after the tab was opened', () => {
  const log = new AlertLog();
  log.add({ key: 'm:1' }, 100);
  log.add({ key: 'm:2' }, 200);
  assert.strictEqual(log.unseen(), 2);
  log.seen(250);
  assert.strictEqual(log.unseen(), 0);
  log.add({ key: 'm:1' }, 300); // came back
  assert.strictEqual(log.snapshot(300).unseen, 1);
  log.clear(400);
  assert.deepStrictEqual(log.snapshot(400), { items: [], seenAt: 400, unseen: 0 });
});

test('groups by day and sources by count', () => {
  const now = new Date(2026, 10, 23, 15, 0).getTime();
  const items = [
    { key: 'a', module: 'mail', at: now - H },
    { key: 'b', module: 'claude', at: now - 2 * H },
    { key: 'c', module: 'mail', at: now - 20 * H },
    { key: 'd', module: 'mail', at: now - 50 * H },
  ];
  assert.deepStrictEqual(groups(items, now).map((g) => [g.label, g.items.length]), [['Aujourd’hui', 2], ['Hier', 1], ['Plus tôt', 1]]);
  assert.deepStrictEqual(sources(items), [{ module: 'mail', count: 3 }, { module: 'claude', count: 1 }]);
});
