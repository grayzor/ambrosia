// Agenda rules with a fake calendar and a fake "am I in a call" sampler.

const test = require('node:test');
const assert = require('node:assert');
const presence = require('../src/main/presence');

const MIN = 60000;
const iso = (offsetMin) => new Date(Date.now() + offsetMin * MIN).toISOString();
const ev = (id, startIn, dur, extra = {}) => ({
  id, title: id, start: iso(startIn), end: iso(startIn + dur), eventType: 'DEFAULT',
  attendees: 4, selfResponse: 'accepted', meetUrl: `https://meet.google.com/abc-defg-${id.slice(0, 3).padEnd(3, 'x')}`, ...extra,
});

async function run(events, sample) {
  presence.sample = async () => ({ ok: true, mic: [], titles: [], browserMic: false, inCall: false, ...sample });
  delete require.cache[require.resolve('../src/modules/agenda/main.js')];
  const def = require('../src/modules/agenda/main.js');
  const defaults = Object.fromEntries(def.settings.filter((s) => 'default' in s).map((s) => [s.key, s.default]));
  const data = { events: [], selfEmail: '', fetchedAt: 0, connector: 'claude.ai Google Calendar', acks: {} };
  const actions = new Map();
  const alerts = new Map();
  let state = {};
  const ctx = {
    log() {},
    claude: { mcpPrefix: (n) => `mcp__${n.replace(/[^a-zA-Z0-9_-]/g, '_')}__`, run: async () => ({ ok: true, structured: { selfEmail: 'me@x.fr', events } }) },
    settings: () => defaults,
    onSettings() {},
    data: { load: () => data, save() {} },
    setState: (p) => (state = { ...state, ...p }),
    onAction: (n, fn) => actions.set(n, fn),
    alert: (a) => alerts.set(a.key, a),
    dismissAlert: (k) => alerts.delete(k),
    openExternal() {},
  };
  def.init.call(def, ctx);
  await actions.get('refresh')();
  await new Promise((r) => setTimeout(r, 20)); // let the post-refresh tick finish
  def.dispose.call(def);
  return { alerts, state: () => state, actions, def };
}

test('only real meetings count: [Claude] slots, solo, focus, declined and all-day are ignored', async () => {
  const { alerts, state } = await run([
    ev('[Claude] sujet', 1, 60, { attendees: 0, selfResponse: 'none', meetUrl: '' }),
    ev('solo', 1, 30, { attendees: 1 }),
    ev('focus', 1, 30, { eventType: 'FOCUS_TIME' }),
    ev('refusee', 1, 30, { selfResponse: 'declined' }),
    { ...ev('journee', 0, 0), start: '2026-10-07', end: '2026-10-08' },
    ev('vraie', 2, 30),
  ]);
  assert.deepEqual([...alerts.keys()], ['vraie']);
  assert.deepEqual(state().meetings.map((m) => m.id), ['vraie']);
});

test('levels: soon → orange, started → red, late → red with a louder priority', async () => {
  const { alerts } = await run([ev('bientot', 2, 30), ev('debut', -1, 30), ev('retard', -6, 30), ev('plustard', 45, 30)]);
  assert.equal(alerts.get('bientot').mood, 'meeting-soon');
  assert.equal(alerts.get('debut').mood, 'meeting-now');
  assert.equal(alerts.get('retard').mood, 'meeting-late');
  assert.ok(alerts.get('retard').priority > alerts.get('bientot').priority);
  assert.ok(!alerts.has('plustard'));
  for (const a of alerts.values()) {
    assert.equal(a.pin, true);
    // Before the start, « Me voir » (the webcam mirror); no guest list here, so no « Prévenir du retard ».
    assert.deepEqual(a.actions.map((x) => x.label), a.mood === 'meeting-soon' ? ['Rejoindre', 'Me voir', 'OK'] : ['Rejoindre', 'OK']);
  }
});

test('late: « Prévenir du retard » when there is someone to tell; « Me voir » can be turned off', async () => {
  const guests = [{ email: 'orga@x.fr', name: 'Orga', status: 'accepted', organizer: true }, { email: 'me@x.fr', status: 'accepted' }];
  const { alerts, state } = await run([ev('retard', -6, 30, { organizer: 'orga@x.fr', guests }), ev('bientot', 2, 30, { organizer: 'orga@x.fr', guests })]);
  assert.deepEqual(alerts.get('retard').actions.map((x) => x.label), ['Rejoindre', 'Prévenir du retard', 'OK']);
  assert.deepEqual(alerts.get('bientot').actions.map((x) => x.label), ['Rejoindre', 'Me voir', 'Retard…', 'OK']);
  assert.deepEqual(alerts.get('retard').actions[1].payload, { id: 'retard' });
  const m = state().meetings.find((x) => x.id === 'retard');
  assert.deepEqual(m.late.to, ['orga@x.fr']);
  assert.equal(m.late.subject, 'Retard — retard');
});

test('in the call (browser mic + Meet window): no alert', async () => {
  const { alerts, state } = await run([ev('atlas', -5, 30)], { inCall: true, browserMic: true, titles: ['Meet - atlas - Google Chrome'] });
  assert.equal(alerts.size, 0);
  assert.equal(state().meetings[0].joined, true);
});

test('back-to-back: still in the previous call, the next one still alerts', async () => {
  const { alerts } = await run([ev('avant', -30, 32), ev('apres', 1, 30)], { inCall: true, browserMic: true, titles: [] });
  assert.ok(alerts.has('apres'));
});

test('OK silences one meeting for good; in-person meetings stop after 10 min', async () => {
  const { alerts, actions } = await run([ev('a', -3, 30), ev('salle', -12, 60, { meetUrl: '' })]);
  assert.ok(alerts.has('a'));
  assert.ok(!alerts.has('salle'));
  await actions.get('ack')({ id: 'a' });
  assert.ok(!alerts.has('a'));
});

test('a meeting joined on time and over: wink, streak + 1, counted once', async () => {
  // joined 1 min after the start, the meeting ended a minute ago
  presence.sample = async () => ({ ok: true, mic: [], titles: [], browserMic: true, inCall: true });
  delete require.cache[require.resolve('../src/modules/agenda/main.js')];
  const def = require('../src/modules/agenda/main.js');
  const defaults = Object.fromEntries(def.settings.filter((s) => 'default' in s).map((s) => [s.key, s.default]));
  // started a minute ago, ends in ~3 s
  const e = ev('tenue', -1, 1.05);
  const data = { events: [], selfEmail: 'camille.dupont@x.fr', fetchedAt: 0, connector: 'claude.ai Google Calendar', acks: {}, streak: 2 };
  const actions = new Map();
  const reacts = [];
  const alerts = [];
  let state = {};
  const ctx = {
    log() {},
    claude: { mcpPrefix: (n) => `mcp__${n}__`, run: async () => ({ ok: true, structured: { events: [e] } }) },
    settings: () => defaults,
    onSettings() {},
    data: { load: () => data, save() {} },
    setState: (p) => (state = { ...state, ...p }),
    onAction: (n, fn) => actions.set(n, fn),
    alert: (a) => alerts.push(a),
    dismissAlert() {},
    react: (...a) => reacts.push(a),
    openExternal() {},
  };
  def.init.call(def, ctx);
  await actions.get('refresh')(); // joined now, during the meeting
  await new Promise((r) => setTimeout(r, 20));
  // let the meeting end, then the next tick settles it
  await new Promise((r) => setTimeout(r, Math.max(0, Date.parse(e.end) - Date.now()) + 200));
  await actions.get('refresh')();
  await new Promise((r) => setTimeout(r, 20));
  def.dispose.call(def);
  assert.equal(state.selfName, 'Camille');
  assert.equal(data.streak, 3);
  assert.equal(state.today.joined, 1);
  assert.equal(state.today.onTime, 1);
  // streak 3 is a milestone: confetti alert rather than a plain wink
  assert.ok(alerts.some((a) => a.key === 'streak' && a.confetti));
});
