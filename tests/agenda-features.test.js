// Agenda, wired: the « late » mail, invitations and Gemini's notes through the module
// itself (src/modules/agenda/main.js) with a fake Claude CLI — what each click runs.

const test = require('node:test');
const assert = require('node:assert');
const N = require('../src/modules/agenda/notes');
const presence = require('../src/main/presence');

const MIN = 60000;
const prefix = (n) => `mcp__${n.replace(/[^a-zA-Z0-9_-]/g, '_')}__`;

async function agenda(run, extraData = {}) {
  presence.sample = async () => ({ ok: true, mic: [], titles: [], browserMic: false, inCall: false });
  delete require.cache[require.resolve('../src/modules/agenda/main.js')];
  const def = require('../src/modules/agenda/main.js');
  const defaults = Object.fromEntries(def.settings.filter((s) => 'default' in s).map((s) => [s.key, s.default]));
  const data = { events: [], selfEmail: 'moi@x.fr', fetchedAt: 0, connector: 'claude.ai Google Calendar', acks: {}, briefServers: { gmail: 'claude.ai Gmail', at: Date.now() }, ...extraData };
  const actions = new Map();
  const runs = [];
  let state = {};
  const ctx = {
    log() {},
    claude: { mcpPrefix: (n) => `mcp__${n.replace(/[^a-zA-Z0-9_-]/g, '_')}__`, run: async (o) => (runs.push(o), run(o)) },
    settings: () => ({ ...defaults, briefAuto: false }),
    onSettings() {},
    data: { load: () => data, save() {} },
    setState: (p) => (state = { ...state, ...p }),
    onAction: (n, fn) => actions.set(n, fn),
    alert() {},
    dismissAlert() {},
    react() {},
    openExternal() {},
  };
  def.init.call(def, ctx);
  return { actions, runs, data, state: () => state, stop: () => def.dispose.call(def) };
}

test('sendLate: one turn, Gmail send_message as its only tool, checked afterwards', async (t) => {
  const iso = (m) => new Date(Date.now() + m * MIN).toISOString();
  const e = { id: 'r', title: 'Revue', start: iso(-5), end: iso(25), attendees: 3, selfResponse: 'accepted', meetUrl: 'https://meet.google.com/a', organizer: 'o@x.fr', guests: [{ email: 'o@x.fr', status: 'accepted', organizer: true }] };
  const tool = 'mcp__claude_ai_Gmail__send_message';
  const a = await agenda((o) => {
    if (!o.allowedTools.includes(tool)) return { ok: true, structured: { events: [e] } };
    const args = JSON.parse(o.prompt.split('\n')[1]);
    return { ok: true, structured: { sent: true, id: 'm1' }, toolCalls: [{ name: tool, input: args }] };
  }, { events: [e] });
  t.after(a.stop);
  const r = await a.actions.get('sendLate')({ id: 'r', to: 'o@x.fr', subject: 'Retard — Revue', body: 'Bonjour, j’arrive dans 5 min.' });
  assert.deepEqual(r, { ok: true });
  const send = a.runs.find((o) => o.allowedTools.includes(tool));
  assert.deepEqual(send.allowedTools, [tool]);
  assert.equal(a.data.lateSent.r.to[0], 'o@x.fr');
  // Bad recipients: nothing leaves.
  const n = a.runs.length;
  assert.equal((await a.actions.get('sendLate')({ id: 'r', to: 'pas-une-adresse', subject: 's', body: 'b' })).ok, false);
  assert.equal(a.runs.length, n);
});

test('agenda: an invitation answered from the island, with ONE respond_to_event call', async (t) => {
  presence.sample = async () => ({ ok: true, mic: [], titles: [], browserMic: false, inCall: false });
  delete require.cache[require.resolve('../src/modules/agenda/main.js')];
  const def = require('../src/modules/agenda/main.js');
  const defaults = Object.fromEntries(def.settings.filter((s) => 'default' in s).map((s) => [s.key, s.default]));
  const iso = (m) => new Date(Date.now() + m * MIN).toISOString();
  const today = { id: 'inv', title: 'Comité', start: iso(120), end: iso(180), attendees: 5, selfResponse: 'needsAction', meetUrl: 'https://meet.google.com/x', organizer: 'o@x.fr', guests: [{ email: 'o@x.fr', name: 'Orga', status: 'accepted', organizer: true }] };
  const later = { id: 'loin', title: 'Point loin', start: iso(3 * 24 * 60), end: iso(3 * 24 * 60 + 30), attendees: 3, selfResponse: 'needsAction', meetUrl: '' };
  const busy = { id: 'occupe', title: 'Déjà pris', start: iso(3 * 24 * 60 + 15), end: iso(3 * 24 * 60 + 45), selfResponse: 'accepted' };
  const data = { events: [], selfEmail: 'moi@x.fr', fetchedAt: 0, connector: 'claude.ai Google Calendar', acks: {} };
  const actions = new Map();
  const alerts = new Map();
  const runs = [];
  let state = {};
  const tool = 'mcp__claude_ai_Google_Calendar__respond_to_event';
  const ctx = {
    log() {},
    claude: {
      mcpPrefix: (n) => `mcp__${n.replace(/[^a-zA-Z0-9_-]/g, '_')}__`,
      run: async (o) => {
        runs.push(o);
        if (o.allowedTools.includes(tool)) return { ok: true, structured: { done: true }, toolsUsed: [tool] };
        return { ok: true, structured: { selfEmail: 'moi@x.fr', events: [today], invitations: [later], busy: [busy] } };
      },
    },
    settings: () => ({ ...defaults, briefAuto: false }),
    onSettings() {},
    data: { load: () => data, save() {} },
    setState: (p) => (state = { ...state, ...p }),
    onAction: (n, fn) => actions.set(n, fn),
    alert: (a) => alerts.set(a.key, a),
    dismissAlert: (k) => alerts.delete(k),
    react() {},
    openExternal() {},
  };
  def.init.call(def, ctx);
  t.after(() => def.dispose.call(def));
  await actions.get('refresh')();
  // The first read looked 14 days ahead (once an hour).
  assert.match(runs[0].prompt, /needsAction/);
  assert.ok(runs[0].jsonSchema.properties.invitations);
  assert.deepEqual(state.invitations.map((i) => i.key), ['inv', 'loin']);
  assert.deepEqual(state.invitations[1].conflicts.map((c) => c.title), ['Déjà pris']);
  assert.equal(state.invitations[0].organizer, 'Orga');
  // First time: one summary alert.
  assert.ok(alerts.has('invites'));
  const r = await actions.get('respond')({ key: 'inv', status: 'declined', comment: 'Pas dispo' });
  assert.deepEqual(r, { ok: true });
  const call = runs.find((o) => o.allowedTools.includes(tool));
  assert.deepEqual(call.allowedTools, [tool]);
  assert.deepEqual(JSON.parse(call.prompt.split('\n')[1]), { eventId: 'inv', responseStatus: 'declined', responseComment: 'Pas dispo' });
  assert.deepEqual(state.invitations.map((i) => i.key), ['loin']);
  // Answered once: a second click finds nothing to answer.
  assert.equal((await actions.get('respond')({ key: 'inv', status: 'accepted' })).ok, false);
  // The next read looks ahead again, and keeps it answered even if the calendar still says needsAction.
  await actions.get('refresh')();
  assert.ok(runs.at(-1).jsonSchema.properties.invitations);
  assert.deepEqual(state.invitations.map((i) => i.key), ['loin']);
});

test('agenda: a Meet joined → notes looked for after the end → actions → one ClickUp task on click', async (t) => {
  presence.sample = async () => ({ ok: true, mic: [], titles: [], browserMic: true, inCall: true });
  delete require.cache[require.resolve('../src/modules/agenda/main.js')];
  const def = require('../src/modules/agenda/main.js');
  const defaults = Object.fromEntries(def.settings.filter((s) => 'default' in s).map((s) => [s.key, s.default]));
  const e = { id: 'tenue', title: 'Revue', start: new Date(Date.now() - 2 * MIN).toISOString(), end: new Date(Date.now() + 1500).toISOString(), attendees: 4, selfResponse: 'accepted', meetUrl: 'https://meet.google.com/abc-defg-hij' };
  const servers = { calendar: 'claude.ai Google Calendar', drive: 'claude.ai Google Drive', clickup: 'claude.ai ClickUp' };
  const data = { events: [], selfEmail: 'camille@x.fr', fetchedAt: 0, connector: servers.calendar, acks: {}, briefServers: { drive: servers.drive, clickup: servers.clickup, at: Date.now() } };
  const actions = new Map();
  const alerts = new Map();
  const runs = [];
  let state = {};
  let settings = { ...defaults, briefAuto: false, clickupList: 'https://app.clickup.com/9012/v/li/901234' };
  const doc = { title: 'Revue - Notes de Gemini', url: 'https://docs.google.com/document/d/abc/edit' };
  const ctx = {
    log() {},
    claude: {
      mcpPrefix: prefix,
      run: async (o) => {
        runs.push(o);
        if (o.allowedTools.some((x) => x.endsWith('clickup_create_task'))) return { ok: true, structured: { done: true, url: 'https://app.clickup.com/t/abc' }, toolsUsed: o.allowedTools };
        if (o.jsonSchema === N.NOTES_SCHEMA) return { ok: true, structured: { attachments: [doc], found: true, notesUrl: doc.url, read: true, decisions: ['Go'], actions: [{ texte: 'Préparer la liste', echeance: '' }] } };
        return { ok: true, structured: { events: [e] } };
      },
    },
    settings: () => settings,
    setSettings: (p) => (settings = { ...settings, ...p }),
    onSettings() {},
    data: { load: () => data, save() {} },
    setState: (p) => (state = { ...state, ...p }),
    onAction: (n, fn) => actions.set(n, fn),
    alert: (a) => alerts.set(a.key, a),
    dismissAlert: (k) => alerts.delete(k),
    react() {},
    openExternal() {},
  };
  def.init.call(def, ctx);
  t.after(() => def.dispose.call(def));
  await actions.get('refresh')(); // in the call
  await new Promise((r) => setTimeout(r, 1800)); // the meeting ends
  await actions.get('refresh')(); // settled: queued
  assert.equal(data.notes.tenue.status, 'waiting');
  assert.equal(state.notes[0].id, 'tenue');
  // Too early for the first look (end + 10 min); « Chercher maintenant » does it.
  assert.ok(!runs.some((o) => o.jsonSchema === N.NOTES_SCHEMA));
  await actions.get('checkNotes')({ id: 'tenue' });
  await new Promise((r) => setTimeout(r, 30));
  const read = runs.find((o) => o.jsonSchema === N.NOTES_SCHEMA);
  assert.deepEqual(read.allowedTools, ['mcp__claude_ai_Google_Calendar__get_event', 'mcp__claude_ai_Google_Drive__read_file_content']);
  assert.equal(data.notes.tenue.status, 'found');
  assert.equal(alerts.get('notes-tenue').title, 'Après « Revue » : 1 action pour toi');
  assert.equal(alerts.get('notes-tenue').pin, undefined);
  // Create the task: one turn, clickup_create_task only, exactly the arguments built locally.
  const r = await actions.get('createTask')({ id: 'tenue', actionId: 'a0' });
  assert.deepEqual(r, { ok: true });
  const call = runs.find((o) => o.allowedTools.some((x) => x.endsWith('clickup_create_task')));
  assert.deepEqual(call.allowedTools, ['mcp__claude_ai_ClickUp__clickup_create_task']);
  const args = JSON.parse(call.prompt.split('\n')[1]);
  assert.equal(args.list_id, '901234');
  assert.equal(args.name, 'Préparer la liste');
  assert.equal(data.notes.tenue.actions[0].state, 'created');
  // Twice: refused.
  assert.equal((await actions.get('createTask')({ id: 'tenue', actionId: 'a0' })).ok, false);
  // Only the notes document opens.
  const opened = [];
  ctx.openExternal = (u) => opened.push(u);
  await actions.get('openNotes')({ id: 'tenue' });
  assert.deepEqual(opened, [doc.url]);
});
