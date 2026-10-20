const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Q = require('../src/modules/claude/quota');

const H = 3600000;
const T0 = Date.parse('2026-10-09T10:00:00');
const rl = (five, week, fiveReset = T0 + 2 * H, weekReset = T0 + 50 * H) => ({
  five_hour: { used_percentage: five, resets_at: fiveReset / 1000 },
  seven_day: { used_percentage: week, resets_at: weekReset / 1000 },
});

test('warns once per window when crossing the threshold', () => {
  const q = Q.empty();
  assert.deepEqual(Q.ingest(q, rl(40, 20), T0, 80), []);
  const ev = Q.ingest(q, rl(81, 20), T0 + 60000, 80);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].type, 'warn');
  assert.equal(ev[0].key, 'five_hour');
  assert.deepEqual(Q.ingest(q, rl(88, 20), T0 + 120000, 80), [], 'no second warning in the same window');
});

test('a new window after a high one is a reset (confetti), after a low one it is not', () => {
  const q = Q.empty();
  Q.ingest(q, rl(92, 30), T0, 80);
  const ev = Q.ingest(q, rl(3, 30, T0 + 7 * H), T0 + 3 * H, 80);
  assert.deepEqual(ev.map((e) => e.type), ['reset']);
  const calm = Q.empty();
  Q.ingest(calm, rl(20, 30), T0, 80);
  assert.deepEqual(Q.ingest(calm, rl(3, 30, T0 + 7 * H), T0 + 3 * H, 80), []);
});

test('tick resets a high window at resets_at, once', () => {
  const q = Q.empty();
  Q.ingest(q, rl(97, 30), T0, 80);
  assert.deepEqual(Q.tick(q, T0 + H, 80), []);
  assert.deepEqual(Q.tick(q, T0 + 2 * H + 1, 80).map((e) => e.key), ['five_hour']);
  assert.deepEqual(Q.tick(q, T0 + 2 * H + 60000, 80), []);
  // the data that follows does not celebrate it again
  assert.deepEqual(Q.ingest(q, rl(1, 30, T0 + 7 * H), T0 + 2 * H + 120000, 80), []);
  const g = Q.gauges(q, T0 + 2 * H + 120000, 80).find((x) => x.key === 'five_hour');
  assert.equal(g.pct, 1);
});

test('a usage-limit notification counts as high, even below the threshold', () => {
  const q = Q.empty();
  Q.ingest(q, rl(60, 30), T0, 80);
  Q.markHit(q);
  assert.equal(Q.tick(q, T0 + 2 * H + 1, 80).length, 1);
});

test('gauges: levels, reset windows, countdown', () => {
  const q = Q.empty();
  Q.ingest(q, rl(96, 70), T0, 80);
  const g = Q.gauges(q, T0, 80);
  assert.deepEqual(g.map((x) => [x.key, x.level]), [['five_hour', 'bad'], ['seven_day', 'mid']]);
  assert.equal(Q.gauges(q, T0 + 3 * H, 80)[0].reset, true);
  assert.equal(Q.countdown(2 * H + 14 * 60000), '2 h 14');
  assert.equal(Q.countdown(50 * H), '2 j 2 h');
  assert.equal(Q.countdown(5 * 60000), '5 min');
});

test('gauges: linear pace = share of the window already gone', () => {
  const q = Q.empty();
  // 5 h window resetting in 2 h: 3 h of 5 gone → 60 %; week resetting in 50 h of 168 → 70 %.
  Q.ingest(q, rl(40, 20), T0, 80);
  const [five, week] = Q.gauges(q, T0, 80);
  assert.equal(five.pace, 60);
  assert.equal(week.pace, 70);
  assert.equal(Q.gauges(q, T0 + 3 * H, 80)[0].pace, null, 'no pace once the window has reset');
  const far = Q.empty();
  Q.ingest(far, rl(10, 10, T0 + 9 * H), T0, 80); // a reset further than the window: clamped
  assert.equal(Q.gauges(far, T0, 80)[0].pace, 0);
});

test('fallback: today’s tokens per project from the transcripts, deduplicated and incremental', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amb-usage-'));
  fs.mkdirSync(path.join(dir, 'C--proj'));
  const file = path.join(dir, 'C--proj', 's1.jsonl');
  const now = new Date();
  const row = (id, ts, cwd, u) => JSON.stringify({ type: 'assistant', timestamp: ts, cwd, message: { id, usage: u } });
  const today = now.toISOString();
  const before = new Date(now.getTime() - 86400000 * 2).toISOString();
  const u1 = { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 10, cache_read_input_tokens: 1000 };
  fs.writeFileSync(file, [
    row('m1', today, 'C:\\dev\\ambrosia', u1),
    row('m1', today, 'C:\\dev\\ambrosia', u1), // same answer, another content block
    row('m0', before, 'C:\\dev\\ambrosia', { input_tokens: 999, output_tokens: 999 }),
    JSON.stringify({ type: 'user', message: { content: 'hi' } }),
  ].join('\n') + '\n');
  const cache = {};
  Q.scanUsage(dir, cache, now);
  assert.deepEqual(Q.usageList(cache), [{ project: 'ambrosia', tokens: 160, cacheRead: 1000 }]);
  fs.appendFileSync(file, row('m2', today, 'C:\\dev\\data-lab', { input_tokens: 5, output_tokens: 5 }) + '\n');
  Q.scanUsage(dir, cache, now);
  assert.deepEqual(Q.usageList(cache).map((p) => [p.project, p.tokens]), [['ambrosia', 160], ['data-lab', 10]]);
  assert.equal(Q.tokens(1234567), '1,2 M');
});

test('fromCli reads the rate_limit_event of a CLI turn in the statusLine shape', () => {
  const info = {
    status: 'allowed',
    resetsAt: 1792447800,
    rateLimitType: 'five_hour',
    unifiedWindows: { five_hour: { utilization: 0.23, resetsAt: 1792447800 }, seven_day: { utilization: 0.4567, resetsAt: 1792598400 } },
  };
  assert.deepEqual(Q.fromCli(info), {
    five_hour: { used_percentage: 23, resets_at: 1792447800 },
    seven_day: { used_percentage: 45.7, resets_at: 1792598400 },
  });
  // One window only, without unifiedWindows.
  assert.deepEqual(Q.fromCli({ rateLimitType: 'seven_day', utilization: 0.9, resetsAt: 1792598400 }), {
    seven_day: { used_percentage: 90, resets_at: 1792598400 },
  });
  assert.equal(Q.fromCli({ status: 'allowed' }), null);
  assert.equal(Q.fromCli({ unifiedWindows: { five_hour: { resetsAt: 1 } } }), null);
  assert.equal(Q.fromCli(null), null);
  // Fed to ingest, it gives the real percentage.
  const q = Q.empty();
  Q.ingest(q, Q.fromCli(info), 1792440000000, 80);
  assert.equal(Q.gauges(q, 1792440000000)[0].pct, 23);
  assert.equal(Q.gauges(q, 1792440000000)[1].pct, 46);
});
