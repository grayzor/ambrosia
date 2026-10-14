// Gany's moments of the day, and the reactions other modules ask for.

const test = require('node:test');
const assert = require('node:assert');

function ganyHarness(peers, { idleMs = 0, stored } = {}) {
  delete require.cache[require.resolve('../src/modules/gany/main.js')];
  const def = require('../src/modules/gany/main.js');
  const defaults = Object.fromEntries(def.settings.filter((s) => 'default' in s).map((s) => [s.key, s.default]));
  const data = stored || { morning: '', evening: '', lunch: '' };
  const actions = new Map();
  const alerts = [];
  const reacts = [];
  const ctx = {
    log() {},
    settings: () => ({ ...defaults, eveningAt: '00:00' }),
    data: { load: () => data, save() {} },
    peers: () => peers,
    alert: (a) => alerts.push(a),
    react: (...a) => reacts.push(a),
    activity: () => ({ idleMs }),
    onAction: (n, fn) => actions.set(n, fn),
  };
  def.init.call(def, ctx);
  def.dispose.call(def);
  return { def, ctx, actions, alerts, reacts, data };
}

test('morning briefing: name, meetings, mails, ClickUp — once a day', async (t) => {
  const hour = new Date().getHours();
  if (hour < 7 || hour >= 12) return t.skip('only meaningful in the morning window (7–12 h)');
  const h = ganyHarness({
    agenda: { status: 'ok', selfName: 'Camille', today: { count: 3, firstStart: Date.now() + 3600000 } },
    mail: { unread: 1 },
    clickup: { unread: 2 },
  });
  await h.actions.get('presence')();
  await h.actions.get('presence')();
  assert.equal(h.alerts.length, 1);
  assert.match(h.alerts[0].title, /^Bonjour Camille !/);
  assert.match(h.alerts[0].text, /3 réunions aujourd’hui, la première à/);
  assert.match(h.alerts[0].text, /1 mail important · 2 interactions ClickUp/);
});

test('evening summary waits until someone is at the desk', () => {
  const { mock } = require('node:test');
  mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  try {
    delete require.cache[require.resolve('../src/modules/gany/main.js')];
    const def = require('../src/modules/gany/main.js');
    const defaults = Object.fromEntries(def.settings.filter((s) => 'default' in s).map((s) => [s.key, s.default]));
    const alerts = [];
    let idleMs = 3600000;
    def.init.call(def, {
      settings: () => ({ ...defaults, eveningAt: '00:00', lunch: false }),
      data: { load: () => ({ morning: '', evening: '', lunch: '' }), save() {} },
      peers: () => ({}),
      alert: (a) => alerts.push(a),
      react() {},
      activity: () => ({ idleMs }),
      onAction() {},
      log() {},
    });
    mock.timers.tick(60000);
    assert.equal(alerts.length, 0, 'nobody there: no summary');
    idleMs = 0;
    mock.timers.tick(60000);
    def.dispose.call(def);
    assert.equal(alerts.length, 1, 'back at the desk: the summary');
  } finally {
    mock.timers.reset();
  }
});

test('evening text', async () => {
  // Drive the private evening() through the interval: fake timers.
  const { mock } = require('node:test');
  mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  try {
    delete require.cache[require.resolve('../src/modules/gany/main.js')];
    const def = require('../src/modules/gany/main.js');
    const defaults = Object.fromEntries(def.settings.filter((s) => 'default' in s).map((s) => [s.key, s.default]));
    const alerts = [];
    def.init.call(def, {
      settings: () => ({ ...defaults, eveningAt: '00:00', lunch: false }),
      data: { load: () => ({ morning: '', evening: '', lunch: '' }), save() {} },
      peers: () => ({ agenda: { today: { joined: 4, onTime: 4, missed: 0 } }, claude: { today: { finished: 12 } }, mail: { doneToday: 2 }, clickup: { doneToday: 1 } }),
      alert: (a) => alerts.push(a),
      react() {},
      activity: () => ({ idleMs: 0 }),
      onAction() {},
      log() {},
    });
    mock.timers.tick(60000);
    def.dispose.call(def);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].mood, 'yawn');
    assert.equal(alerts[0].text, '4 réunions tenues à l’heure · 12 tâches Claude terminées · 3 sujets traités · 0 réunion ratée');
  } finally {
    mock.timers.reset();
  }
});

test('lunch: only when the slot starts and you are still active', () => {
  const { mock } = require('node:test');
  mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  try {
    delete require.cache[require.resolve('../src/modules/gany/main.js')];
    const def = require('../src/modules/gany/main.js');
    const defaults = Object.fromEntries(def.settings.filter((s) => 'default' in s).map((s) => [s.key, s.default]));
    const alerts = [];
    let idleMs = 10 * 60000;
    def.init.call(def, {
      settings: () => ({ ...defaults, evening: false }),
      data: { load: () => ({ morning: '', evening: '', lunch: '' }), save() {} },
      peers: () => ({ agenda: { lunch: { start: Date.now() - 60000, end: Date.now() + 3600000, title: 'Focus / lunch time' } } }),
      alert: (a) => alerts.push(a),
      react() {},
      activity: () => ({ idleMs }),
      onAction() {},
      log() {},
    });
    mock.timers.tick(60000); // away from the desk: already on a break
    assert.equal(alerts.length, 0);
    idleMs = 0;
    mock.timers.tick(60000); // still clicking: time to eat
    mock.timers.tick(60000); // and only once
    def.dispose.call(def);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].mood, 'lunch');
  } finally {
    mock.timers.reset();
  }
});
