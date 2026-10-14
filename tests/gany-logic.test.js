// Gany's character, the pure part: breaks, celebrations, days of the year.

const test = require('node:test');
const assert = require('node:assert');
const logic = require('../src/modules/gany/logic.js');

const MIN = 60000;

test('duration reads like a person would say it', () => {
  assert.equal(logic.duration(45 * MIN), '45 min');
  assert.equal(logic.duration(90 * MIN), '1 h 30');
  assert.equal(logic.duration(120 * MIN), '2 h');
});

test('break: one nudge after a long stretch of activity, then every period', () => {
  let st = null;
  let t = 0;
  const nudges = [];
  // 4 hours of steady mouse activity, one tick a minute
  for (let i = 0; i <= 240; i++) {
    t = i * MIN;
    const r = logic.breakTick(st, { now: t, idleMs: 10000, everyMin: 90 });
    st = r.state;
    if (r.nudge) nudges.push([i, r.nudge.kind]);
  }
  assert.deepEqual(nudges, [[90, 'stretch'], [180, 'water']]);
  assert.match(logic.breakAlert({ kind: 'stretch', activeMs: 90 * MIN }).text, /^1 h 30 que tu enchaînes/);
  assert.equal(logic.breakAlert({ kind: 'water', activeMs: 90 * MIN }).mood, 'drink');
  assert.equal(logic.breakAlert({ kind: 'water', activeMs: 90 * MIN }).sound, undefined, 'a break nudge is silent');
});

test('break: a real pause (5 min still) starts the count again', () => {
  let st = null;
  for (let i = 0; i < 80; i++) st = logic.breakTick(st, { now: i * MIN, idleMs: 0, everyMin: 90 }).state;
  // a 6-minute break
  st = logic.breakTick(st, { now: 86 * MIN, idleMs: 6 * MIN, everyMin: 90 }).state;
  assert.equal(st.activeSince, null);
  let r;
  for (let i = 87; i < 170; i++) {
    r = logic.breakTick(st, { now: i * MIN, idleMs: 0, everyMin: 90 });
    st = r.state;
    assert.equal(r.nudge, null, `no nudge at minute ${i}`);
  }
});

test('break: blocked (a call, something urgent) delays without losing it', () => {
  let st = null;
  for (let i = 0; i < 90; i++) st = logic.breakTick(st, { now: i * MIN, idleMs: 0, everyMin: 90 }).state;
  let r = logic.breakTick(st, { now: 90 * MIN, idleMs: 0, everyMin: 90, blocked: true });
  assert.equal(r.nudge, null);
  r = logic.breakTick(r.state, { now: 100 * MIN, idleMs: 0, everyMin: 90 });
  assert.equal(r.nudge.kind, 'stretch');
  assert.equal(Math.round(r.nudge.activeMs / MIN), 100);
});

test('workload counts what waits everywhere, Claude Code included', () => {
  const peers = {
    mail: { unread: 2 },
    clickup: { unread: 1 },
    agenda: { today: { count: 5 } },
    gany: { unread: 9 },
    claude: { pending: [{}], sessions: [{ state: 'working' }, { state: 'finished' }, { state: 'idle' }] },
  };
  assert.equal(logic.workload(peers), 5);
  assert.equal(logic.workload({}), 0);
});

const T0 = Date.UTC(2026, 9, 12, 9); // a real clock: the cooldown counts from the last party

test('celebrate: confetti when a busy stretch is cleared, once in a while', () => {
  let st = null;
  const tick = (now, load, extra = {}) => {
    const r = logic.celebrateTick(st, { now: T0 + now, load, ...extra });
    st = r.state;
    return r.party;
  };
  assert.equal(tick(0, 2), null);
  assert.equal(tick(1, 4), null);
  assert.deepEqual(tick(2, 0), { cleared: 4 });
  // busy again and cleared within the cooldown: no second party
  tick(10 * MIN, 5);
  assert.equal(tick(11 * MIN, 0), null);
  // much later: yes
  tick(300 * MIN, 3);
  assert.deepEqual(tick(301 * MIN, 0), { cleared: 3 });
  assert.equal(logic.celebrateAlert({ cleared: 3 }).sound, undefined, 'the party is silent');
});

test('celebrate: not for a small load, nor when away or in a call', () => {
  let st = logic.celebrateTick(null, { now: T0, load: 2 }).state;
  assert.equal(logic.celebrateTick(st, { now: T0 + 1, load: 0 }).party, null, 'two things are not a feat');
  st = logic.celebrateTick(null, { now: T0, load: 6 }).state;
  assert.equal(logic.celebrateTick(st, { now: T0 + 1, load: 0, active: false }).party, null);
  st = logic.celebrateTick(null, { now: T0, load: 6 }).state;
  assert.equal(logic.celebrateTick(st, { now: T0 + 1, load: 0, allowed: false }).party, null);
});

test('easter and the movable feasts', () => {
  const ymd = (d) => [d.getFullYear(), d.getMonth() + 1, d.getDate()].join('-');
  assert.equal(ymd(logic.easter(2024)), '2024-3-31');
  assert.equal(ymd(logic.easter(2025)), '2025-4-20');
  assert.equal(ymd(logic.easter(2026)), '2026-4-5');
  assert.equal(logic.occasion(new Date(2026, 3, 6, 10)).id, 'paques', 'Easter Monday');
  assert.equal(logic.occasion(new Date(2026, 4, 14)).id, 'ascension');
  assert.equal(logic.occasion(new Date(2026, 4, 25)).id, 'pentecote');
});

test('days of the year: hats and phrases', () => {
  assert.equal(logic.occasion(new Date(2026, 6, 14, 18)).outfit, 'juillet');
  assert.equal(logic.occasion(new Date(2026, 3, 1)).outfit, 'avril');
  assert.equal(logic.occasion(new Date(2026, 11, 20)).outfit, 'noel');
  assert.match(logic.occasion(new Date(2026, 11, 25)).phrase, /Joyeux Noël/);
  assert.equal(logic.occasion(new Date(2026, 4, 1)).outfit, null, 'a phrase without a hat');
  assert.equal(logic.occasion(new Date(2026, 9, 12)), null, 'an ordinary Monday');
});
