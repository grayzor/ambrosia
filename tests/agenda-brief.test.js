// Meeting briefs: which meetings, the cache, read-only tools, clean output.

const test = require('node:test');
const assert = require('node:assert');
const B = require('../src/modules/agenda/brief');
const presence = require('../src/main/presence');

const MIN = 60000;
const NOW = Date.parse('2026-10-12T09:00:00+02:00');
const at = (min) => new Date(NOW + min * MIN).toISOString();
const ev = (id, startIn, extra = {}) => ({ id, title: id, start: at(startIn), end: at(startIn + 30), attendees: 4, meetUrl: 'https://meet.google.com/abc-defg-hij', updated: '2026-10-10T10:00:00Z', ...extra });
const prefix = (n) => `mcp__${n.replace(/[^a-zA-Z0-9_-]/g, '_')}__`;

test('due: only meetings starting within the lead time, not yet started', () => {
  const list = [ev('passee', -5), ev('bientot', 10), ev('limite', 15), ev('tard', 16)];
  assert.deepEqual(B.dueForBrief(list, {}, NOW, 15).map((e) => e.id), ['bientot', 'limite']);
  assert.deepEqual(B.dueForBrief(list, {}, NOW, 30).map((e) => e.id), ['bientot', 'limite', 'tard']);
});

test('cache: one brief per version of the event, redone when the event changes', () => {
  const e = ev('a', 10);
  const cache = { a: { fp: B.fingerprint(e), at: NOW - MIN, status: 'ok', brief: {} } };
  assert.equal(B.dueForBrief([e], cache, NOW, 15).length, 0);
  assert.ok(B.cached(cache, e));
  for (const changed of [{ ...e, start: at(12) }, { ...e, title: 'autre' }, { ...e, attendees: 5 }, { ...e, updated: '2026-10-12T06:00:00Z' }]) {
    assert.equal(B.cached(cache, changed), null);
    assert.equal(B.dueForBrief([changed], cache, NOW, 15).length, 1);
  }
});

test('cache: a failed brief is retried twice at most, five minutes apart', () => {
  const e = ev('a', 10);
  const entry = (tries, ago) => ({ a: { fp: B.fingerprint(e), at: NOW - ago * MIN, status: 'error', tries } });
  assert.equal(B.dueForBrief([e], entry(1, 2), NOW, 15).length, 0);
  assert.equal(B.dueForBrief([e], entry(1, 6), NOW, 15).length, 1);
  assert.equal(B.dueForBrief([e], entry(3, 6), NOW, 15).length, 0);
});

test('cache: briefs of vanished or long-over events are forgotten', () => {
  const cache = { garde: {}, finie: {}, disparue: {} };
  B.pruneCache(cache, [ev('garde', 10), ev('finie', -15 * 60)], NOW);
  assert.deepEqual(Object.keys(cache), ['garde']);
});

test('tools: read-only tools of the detected connectors only', () => {
  const tools = B.allowedTools({ calendar: 'claude.ai Google Calendar', gmail: 'claude.ai Gmail' }, prefix);
  assert.deepEqual(tools, [
    'mcp__claude_ai_Google_Calendar__get_event',
    'mcp__claude_ai_Gmail__search_threads',
    'mcp__claude_ai_Gmail__get_thread',
  ]);
  const all = B.allowedTools({ calendar: 'c', gmail: 'g', clickup: 'u', drive: 'd' }, prefix);
  for (const t of all) assert.doesNotMatch(t, /send|create|update|delete|respond|reply|forward|trash|move|label|share|draft|attach|comment|add_|remove/i);
});

test('connectors: claude.ai and connected ones win, stubs and unauthenticated are skipped', () => {
  const picked = B.pickConnectors([
    { name: 'plugin:productivity:gmail', status: '- Not configured' },
    { name: 'claude.ai Gmail', status: '√ Connected' },
    { name: 'plugin:productivity:clickup', status: '! Needs authentication' },
    { name: 'claude.ai ClickUp', status: '√ Connected' },
    { name: 'claude.ai Google Drive', status: '√ Connected' },
    { name: 'claude.ai Slack', status: '! Needs authentication' },
  ]);
  assert.deepEqual(picked, { gmail: 'claude.ai Gmail', clickup: 'claude.ai ClickUp', drive: 'claude.ai Google Drive' });
  assert.deepEqual(B.pickConnectors([{ name: 'plugin:productivity:clickup', status: '! Needs authentication' }]), {});
});

test('prompt: only steps for the sources that are there', () => {
  const e = ev('Reprise de stock', 10);
  const only = B.buildPrompt(e, { calendar: 'x' }, 'me@x.fr');
  assert.match(only, /get_event/);
  assert.doesNotMatch(only, /search_threads|clickup_|search_files/);
  const full = B.buildPrompt(e, { calendar: 'x', gmail: 'g', clickup: 'c', drive: 'd' });
  assert.match(full, /search_threads/);
  assert.match(full, /clickup_get_task/);
  assert.match(full, /search_files/);
});

test('sanitize: clamps counts, keeps https links only, ClickUp links only for tasks', () => {
  const out = B.sanitize({
    objet: '  Valider   le format  ',
    contexte: ['a', '', 'b', 'c', 'd', 'e'],
    participants: [{ nom: 'Léa' }, { nom: '' }],
    documents: [{ titre: 'ok', url: 'https://docs.google.com/x' }, { titre: 'js', url: 'javascript:alert(1)' }, { titre: 'http', url: 'http://x' }],
    taches: [{ titre: 'T', url: 'https://evil.example/t', statut: 'open' }, { titre: 'U', url: 'https://app.clickup.com/t/1' }],
    aPreparer: ['1', '2', '3', '4'],
  });
  assert.equal(out.objet, 'Valider le format');
  assert.deepEqual(out.contexte, ['a', 'b', 'c', 'd']);
  assert.deepEqual(out.participants, [{ nom: 'Léa', role: '', dernierEchange: '' }]);
  assert.deepEqual(out.documents, [{ titre: 'ok', url: 'https://docs.google.com/x' }]);
  assert.deepEqual(out.taches.map((t) => t.url), ['', 'https://app.clickup.com/t/1']);
  assert.equal(out.aPreparer.length, 3);
  assert.deepEqual(B.links(out), ['https://docs.google.com/x', 'https://app.clickup.com/t/1']);
  assert.deepEqual(B.sanitize(null).documents, []);
});

test('agenda: one automatic brief per meeting, then « Voir le brief » on its alert', async () => {
  presence.sample = async () => ({ ok: true, mic: [], titles: [], browserMic: false, inCall: false });
  delete require.cache[require.resolve('../src/modules/agenda/main.js')];
  const def = require('../src/modules/agenda/main.js');
  const defaults = Object.fromEntries(def.settings.filter((s) => 'default' in s).map((s) => [s.key, s.default]));
  const iso = (m) => new Date(Date.now() + m * MIN).toISOString();
  const events = [
    { id: 'proche', title: 'Reprise de stock', start: iso(2), end: iso(30), eventType: 'DEFAULT', attendees: 5, selfResponse: 'accepted', meetUrl: 'https://meet.google.com/abc-defg-hij' },
    { id: 'loin', title: 'Plus tard', start: iso(120), end: iso(150), eventType: 'DEFAULT', attendees: 5, selfResponse: 'accepted', meetUrl: '' },
  ];
  const data = { events: [], selfEmail: '', fetchedAt: 0, connector: 'claude.ai Google Calendar', acks: {} };
  const briefCalls = [];
  const actions = new Map();
  const alerts = new Map();
  const opened = [];
  let state = {};
  const ctx = {
    log() {},
    claude: {
      mcpPrefix: prefix,
      listMcp: async () => [{ name: 'claude.ai Gmail', status: '√ Connected' }, { name: 'claude.ai Google Drive', status: '! Needs authentication' }],
      run: async (o) => {
        if (o.jsonSchema === B.BRIEF_SCHEMA) {
          briefCalls.push(o);
          return { ok: true, structured: { objet: 'Valider la reprise', contexte: [], participants: [], documents: [{ titre: 'Doc', url: 'https://docs.google.com/d' }], taches: [], aPreparer: [] } };
        }
        return { ok: true, structured: { events } };
      },
    },
    settings: () => defaults,
    onSettings() {},
    data: { load: () => data, save() {} },
    setState: (p) => (state = { ...state, ...p }),
    onAction: (n, fn) => actions.set(n, fn),
    alert: (a) => alerts.set(a.key, a),
    dismissAlert: (k) => alerts.delete(k),
    openExternal: (u) => opened.push(u),
    focus() {},
  };
  def.init.call(def, ctx);
  await actions.get('refresh')();
  await new Promise((r) => setTimeout(r, 30));
  await actions.get('refresh')(); // a second tick: no second brief
  await new Promise((r) => setTimeout(r, 30));
  def.dispose.call(def);

  assert.equal(briefCalls.length, 1);
  const call = briefCalls[0];
  assert.match(call.prompt, /"proche"/);
  assert.equal(call.requireMcp, 'claude.ai Google Calendar');
  assert.deepEqual(call.allowedTools, ['mcp__claude_ai_Google_Calendar__get_event', 'mcp__claude_ai_Gmail__search_threads', 'mcp__claude_ai_Gmail__get_thread']);
  assert.equal(data.briefs.proche.status, 'ok');
  assert.ok(!data.briefs.loin);
  const m = state.meetings.find((x) => x.id === 'proche');
  assert.equal(m.brief.status, 'ok');
  assert.equal(m.brief.brief.objet, 'Valider la reprise');
  assert.deepEqual(alerts.get('proche').actions.map((a) => a.label), ['Rejoindre', 'Me voir', 'Brief', 'OK']);
  // links: only what the brief shows
  await actions.get('openLink')({ id: 'proche', url: 'https://docs.google.com/d' });
  await actions.get('openLink')({ id: 'proche', url: 'https://evil.example/' });
  assert.deepEqual(opened, ['https://docs.google.com/d']);
});
