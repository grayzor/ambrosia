// « En appel » : the queue of the module host, and how Agenda decides you are in a call.

const test = require('node:test');
const assert = require('node:assert');
const { CallMode, joinFr } = require('../src/main/call-mode');
const { currentCall } = require('../src/modules/agenda/call');
const presence = require('../src/main/presence');

const MODS = {
  mail: { name: 'Courrier', recap: { one: 'mail', many: 'mails' } },
  clickup: { name: 'ClickUp', recap: { one: 'interaction ClickUp', many: 'interactions ClickUp' } },
  gany: { name: 'Gany' },
};
const mail = (n, extra = {}) => ({ key: `mail:${n}`, module: 'mail', title: `Mail ${n}`, from: 'Sophie', mood: 'mail', sound: 'mail', priority: 60, ...extra });
const approval = { key: 'claude:p-1', module: 'claude', title: 'Bash', mood: 'approval', sound: 'approval', priority: 100 };

test('out of a call, every alert passes untouched', () => {
  const c = new CallMode();
  const a = mail(1);
  assert.equal(c.admit(a), a);
  assert.equal(c.status().active, false);
});

test('in a call: below the threshold waits silently, approvals and pinned alerts pass with a tick', () => {
  const c = new CallMode();
  assert.equal(c.set('agenda', { title: 'ATLAS' }), 'start');
  assert.equal(c.admit(mail(1)), null);
  assert.equal(c.admit({ ...mail(2), priority: 99 }), null);
  const passed = c.admit(approval);
  assert.equal(passed.sound, 'tick');
  const pinned = c.admit({ key: 'agenda:next', module: 'agenda', pin: true, priority: 85, sound: 'question' });
  assert.ok(pinned);
  assert.equal(pinned.sound, 'tick');
  assert.equal(c.status().queued, 2);
});

test('settings: a lower threshold lets urgent things through; sounds can be cut; off = no hold', () => {
  let s = { threshold: 75, softSound: false };
  const c = new CallMode(() => s);
  c.set('agenda', { title: 'x' });
  assert.equal(c.admit(mail(1)), null);
  assert.equal(c.admit({ ...mail(2), priority: 80 }).sound, null);
  s = { enabled: false };
  assert.equal(c.active, false);
  assert.ok(c.admit(mail(3)));
});

test('the same alert updated during the call counts once; a dismissed one leaves the queue', () => {
  const c = new CallMode();
  c.set('agenda', { title: 'x' });
  c.admit(mail(1));
  c.admit({ ...mail(1), title: 'Mail 1 (suite)' });
  c.admit(mail(2));
  assert.equal(c.status().queued, 2);
  assert.equal(c.dismiss('mail:2'), true);
  assert.equal(c.status().queued, 1);
});

test('end of call: one recap, the most urgent module first, then an empty queue', () => {
  const c = new CallMode();
  c.set('agenda', { title: 'x' });
  c.admit(mail(1));
  c.admit(mail(2));
  c.admit({ key: 'clickup:c', module: 'clickup', title: '[ATLAS-1] Blocage', mood: 'mail', sound: 'mail', priority: 80 });
  c.admit({ key: 'gany:lunch', module: 'gany', title: 'Déjeuner', priority: 45 });
  c.admit({ key: 'mail:digest', module: 'mail', title: '3 mails importants', count: 3, priority: 60 });
  assert.equal(c.set('agenda', null), 'end');
  const r = c.flush((id) => MODS[id]);
  assert.equal(r.title, 'Pendant ta réunion : 1 interaction ClickUp, 5 mails et 1 alerte Gany');
  assert.equal(r.module, 'clickup');
  assert.equal(r.priority, 80);
  assert.deepEqual(r.recap, [{ module: 'clickup', count: 1 }, { module: 'mail', count: 5 }, { module: 'gany', count: 1 }]);
  assert.equal(c.status().queued, 0);
  assert.equal(c.flush(), null);
  // after the call, alerts pass again
  assert.ok(c.admit(mail(9)));
});

test('a single held alert: the recap says what it was', () => {
  const c = new CallMode();
  c.set('agenda', { title: 'x' });
  c.admit(mail(1));
  c.set('agenda', null);
  const r = c.flush((id) => MODS[id]);
  assert.equal(r.title, 'Pendant ta réunion : 1 mail');
  assert.equal(r.text, 'Sophie · Mail 1');
  assert.equal(r.module, 'mail');
});

test('several sources: the call lasts until the last one ends', () => {
  const c = new CallMode();
  assert.equal(c.set('agenda', { title: 'a' }), 'start');
  assert.equal(c.set('teams', { title: 'b' }), null);
  assert.equal(c.set('agenda', null), null);
  assert.equal(c.active, true);
  assert.equal(c.set('teams', null), 'end');
  assert.equal(joinFr(['a', 'b', 'c']), 'a, b et c');
});

// ── Agenda: am I in a call? ────────────────────────────────────────────

const MIN = 60000;
const NOW = Date.parse('2026-10-12T09:20:00+02:00');
const at = (m) => new Date(NOW + m * MIN).toISOString();
const meet = (id, startIn, dur, extra = {}) => ({ id, title: id, start: at(startIn), end: at(startIn + dur), meetUrl: 'https://meet.google.com/abc-defg-hij', ...extra });
const live = { ok: true, inCall: true };
const quiet = { ok: true, inCall: false };

test('call: a running Meet you joined, with the mic held', () => {
  const m = [meet('atlas', -5, 15)];
  assert.equal(currentCall({ meetings: m, joined: new Set(['atlas']), sample: live, sampledAt: NOW, now: NOW })?.id, 'atlas');
  assert.equal(currentCall({ meetings: m, joined: new Set(), sample: live, sampledAt: NOW, now: NOW }), null);
  assert.equal(currentCall({ meetings: m, joined: new Set(['atlas']), sample: quiet, sampledAt: NOW, now: NOW }), null);
  // in person: nothing to detect
  assert.equal(currentCall({ meetings: [meet('salle', -5, 15, { meetUrl: '' })], joined: new Set(['salle']), sample: live, sampledAt: NOW, now: NOW }), null);
});

test('call: hanging up early ends it; overrunning keeps it, 30 min at most', () => {
  const m = [meet('atlas', -10, 15)];
  const joined = new Set(['atlas']);
  assert.equal(currentCall({ meetings: m, joined, sample: quiet, sampledAt: NOW, now: NOW, current: 'atlas' }), null);
  const after = NOW + 10 * MIN; // 5 min past the end
  assert.equal(currentCall({ meetings: m, joined, sample: live, sampledAt: after, now: after, current: 'atlas' })?.id, 'atlas');
  const late = NOW + 40 * MIN;
  assert.equal(currentCall({ meetings: m, joined, sample: live, sampledAt: late, now: late, current: 'atlas' }), null);
  // no fresh sample: trust the calendar until the end only
  assert.equal(currentCall({ meetings: m, joined, sample: live, sampledAt: NOW - 10 * MIN, now: NOW, current: 'atlas' })?.id, 'atlas');
  assert.equal(currentCall({ meetings: m, joined, sample: null, sampledAt: 0, now: after, current: 'atlas' }), null);
});

test('call: back-to-back, the meeting you just joined takes over', () => {
  const m = [meet('avant', -30, 31), meet('apres', 0, 30)];
  const r = currentCall({ meetings: m, joined: new Set(['avant', 'apres']), sample: live, sampledAt: NOW, now: NOW, current: 'avant' });
  assert.equal(r.id, 'apres');
});

test('agenda tells the host when the call starts and ends', async () => {
  const iso = (m) => new Date(Date.now() + m * MIN).toISOString();
  let sample = { ok: true, mic: [], titles: ['Meet - atlas - Google Chrome'], browserMic: true, inCall: true };
  presence.sample = async () => sample;
  delete require.cache[require.resolve('../src/modules/agenda/main.js')];
  const def = require('../src/modules/agenda/main.js');
  const defaults = Object.fromEntries(def.settings.filter((s) => 'default' in s).map((s) => [s.key, s.default]));
  const data = { events: [], selfEmail: '', fetchedAt: 0, connector: 'claude.ai Google Calendar', acks: {}, briefs: {} };
  const calls = [];
  const actions = new Map();
  const events = [{ id: 'atlas', title: 'atlas', start: iso(-5), end: iso(25), eventType: 'DEFAULT', attendees: 4, selfResponse: 'accepted', meetUrl: 'https://meet.google.com/abc-defg-hij' }];
  const ctx = {
    log() {},
    claude: { mcpPrefix: (n) => `mcp__${n}__`, run: async () => ({ ok: true, structured: { events } }) },
    settings: () => ({ ...defaults, briefAuto: false }),
    onSettings() {},
    data: { load: () => data, save() {} },
    setState() {},
    onAction: (n, fn) => actions.set(n, fn),
    alert() {},
    dismissAlert() {},
    setInCall: (info) => calls.push(info),
    openExternal() {},
  };
  def.init.call(def, ctx);
  await actions.get('refresh')();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].title, 'atlas');
  // hung up: the next presence sample (a minute later) no longer sees the call
  sample = { ok: true, mic: [], titles: [], browserMic: false, inCall: false };
  const realNow = Date.now;
  Date.now = () => realNow() + 61000;
  try {
    await actions.get('refresh')();
    await new Promise((r) => setTimeout(r, 20));
  } finally {
    Date.now = realNow;
  }
  def.dispose.call(def);
  assert.equal(calls.length, 2);
  assert.equal(calls[1], null);
});

test('module host: every ctx.alert goes through the call filter, one recap at the end', async () => {
  // The host needs electron only for shell.openExternal: a stub is enough here.
  require.cache[require.resolve('electron')] = { id: 'electron', filename: 'electron', loaded: true, exports: { shell: {} } };
  // …and nothing goes to the user's real ambrosia.log.
  const logFile = require.resolve('../src/main/log');
  require.cache[logFile] = { id: logFile, filename: logFile, loaded: true, exports: { line() {}, scope: () => () => {} } };
  const host = require('../src/main/modules');
  const { DEFAULTS } = require('../src/main/call-mode');
  host.call.settings = () => ({ ...DEFAULTS }); // not the user's settings file
  const sent = [];
  host.island = { send: (ch, data) => sent.push([ch, data]) };
  const fake = (def) => ({ def, state: {}, actions: new Map(), ctx: null, cleanups: [] });
  host.modules.set('mail', fake({ id: 'mail', name: 'Courrier', recap: { one: 'mail', many: 'mails' } }));
  host.modules.set('agenda', fake({ id: 'agenda', name: 'Agenda' }));
  const agenda = host.modules.get('agenda');
  await host.start(agenda);
  const ctx = agenda.ctx;

  ctx.setInCall({ title: 'ATLAS' });
  assert.equal(sent.at(-1)[0], 'call');
  assert.equal(sent.at(-1)[1].active, true);
  host.pushAlert({ key: 'mail:a', module: 'mail', title: 'A', sound: 'mail', priority: 60 });
  host.pushAlert({ key: 'mail:b', module: 'mail', title: 'B', sound: 'mail', priority: 60 });
  assert.equal(host.alerts.length, 0);
  assert.equal(sent.at(-1)[1].queued, 2);
  host.pushAlert({ key: 'claude:p', module: 'claude', title: 'Bash', sound: 'approval', priority: 100 });
  assert.equal(host.alerts.at(-1).sound, 'tick');
  ctx.react('wink', 2000, { sound: 'love', confetti: true });
  assert.deepEqual(sent.at(-1), ['react', { mood: 'wink', ms: 2000, sound: null, confetti: false }]);
  host.dismissAlert('mail:b'); // read in the island meanwhile

  ctx.setInCall(null);
  const recap = host.alerts.find((a) => a.key === 'core:call-recap');
  assert.equal(recap.title, 'Pendant ta réunion : 1 mail');
  assert.equal(recap.module, 'mail');
  assert.equal(recap.sound, 'mail');
  assert.equal(sent.at(-1)[1].active, false);
  host.modules.delete('mail');
  host.modules.delete('agenda');
});
