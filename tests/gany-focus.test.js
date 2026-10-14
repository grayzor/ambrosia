// Gany's focus mode: the gany module drives the « en appel » queue of the module host.

const test = require('node:test');
const assert = require('node:assert');
const { CallMode } = require('../src/main/call-mode');

const FOCUS = { title: 'Concentration', recapLead: 'Pendant ta concentration', always: true };
const mail = (n) => ({ key: `mail:${n}`, module: 'mail', title: `Mail ${n}`, mood: 'mail', sound: 'mail', priority: 60 });

test('focus holds what can wait and recaps it as « Pendant ta concentration »', () => {
  const c = new CallMode();
  assert.equal(c.set('gany', FOCUS), 'start');
  assert.equal(c.admit(mail(1)), null);
  assert.equal(c.admit(mail(2)), null);
  assert.ok(c.admit({ key: 'claude:p', module: 'claude', priority: 100, sound: 'approval' }), 'approvals still pass');
  assert.equal(c.set('gany', null), 'end');
  const recap = c.flush((id) => (id === 'mail' ? { name: 'Courrier', recap: { one: 'mail', many: 'mails' } } : null));
  assert.equal(recap.title, 'Pendant ta concentration : 2 mails');
});

test('focus works even when « En réunion » is switched off; a real call keeps its own words', () => {
  const c = new CallMode(() => ({ enabled: false }));
  c.set('gany', FOCUS);
  assert.equal(c.active, true);
  assert.equal(c.admit(mail(1)), null);
  c.set('gany', null);
  const off = new CallMode(() => ({ enabled: false }));
  off.set('agenda', { title: 'ATLAS' });
  assert.equal(off.active, false, 'a meeting with the setting off holds nothing');
  const meeting = new CallMode();
  meeting.set('agenda', { title: 'ATLAS' });
  meeting.admit(mail(1));
  meeting.set('agenda', null);
  assert.match(meeting.flush(() => null).title, /^Pendant ta réunion/);
});

function ganyWithFocus(stored = {}) {
  delete require.cache[require.resolve('../src/modules/gany/main.js')];
  const def = require('../src/modules/gany/main.js');
  const defaults = Object.fromEntries(def.settings.filter((s) => 'default' in s).map((s) => [s.key, s.default]));
  const calls = [];
  const states = [];
  const actions = new Map();
  const data = { morning: '', evening: '', lunch: '', ...stored };
  def.init.call(def, {
    log() {},
    settings: () => ({ ...defaults }),
    data: { load: () => data, save() {} },
    peers: () => ({}),
    alert() {},
    react() {},
    activity: () => ({ idleMs: 0 }),
    onAction: (n, fn) => actions.set(n, fn),
    setInCall: (info) => calls.push(info),
    setState: (s) => states.push(s),
  });
  return { def, calls, states, actions, data };
}

test('gany module: focus from the menu, then stopped', () => {
  const g = ganyWithFocus();
  g.actions.get('focus')({ minutes: 25 });
  assert.equal(g.calls[0].recapLead, 'Pendant ta concentration');
  assert.equal(g.calls[0].always, true);
  const focus = () => g.states.filter((x) => 'focus' in x);
  const until = focus()[0].focus.until;
  assert.ok(Math.abs(until - (Date.now() + 25 * 60000)) < 2000);
  assert.equal(g.data.focusUntil, until, 'survives a restart');
  g.actions.get('unfocus')();
  assert.equal(g.calls[1], null);
  assert.equal(focus()[1].focus, null);
  g.def.dispose.call(g.def);
});

test('gany module: a focus still running after a restart goes on, an expired one is cleared', () => {
  const on = ganyWithFocus({ focusUntil: Date.now() + 10 * 60000 });
  assert.equal(on.calls[0].title, 'Concentration');
  on.def.dispose.call(on.def);
  const old = ganyWithFocus({ focusUntil: Date.now() - 60000 });
  assert.deepEqual(old.calls, [null]);
  assert.equal(old.data.focusUntil, 0);
  old.def.dispose.call(old.def);
});
