// Google Chat: read tools only, links, one card per conversation / thread.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const gchat = require('../src/modules/gchat/main');
const { collapse } = require('../src/main/triage');

test('read tools only, never send_message; the CLI connector name matches', () => {
  const src = fs.readFileSync(require.resolve('../src/modules/gchat/main'), 'utf8');
  const tools = src.match(/readTools: \[([^\]]*)\]/)[1];
  assert.doesNotMatch(tools, /send/);
  const pattern = new Function(`return ${src.match(/connectorPattern: (\/.*\/i),/)[1]}`)();
  // As listed by `claude mcp list`.
  assert.ok(pattern.test('claude.ai Chat MCP'));
  assert.ok(!pattern.test('claude.ai Claude Docs'));
  assert.ok(!pattern.test('claude.ai Gmail'));
});

test('links: DM → conversation, space → thread, a real Chat link is kept', () => {
  const { chatUrl } = gchat;
  assert.equal(chatUrl({ id: 'spaces/AAA/messages/m1', kind: 'dm' }), 'https://chat.google.com/dm/AAA');
  assert.equal(chatUrl({ space: 'spaces/BBB', thread: 'spaces/BBB/threads/t9', kind: 'space' }), 'https://chat.google.com/room/BBB/t9');
  assert.equal(chatUrl({ space: 'spaces/BBB', kind: 'space' }), 'https://chat.google.com/room/BBB');
  assert.equal(chatUrl({ url: 'https://mail.google.com/chat/u/0/#chat/space/BBB', space: 'spaces/BBB' }), 'https://mail.google.com/chat/u/0/#chat/space/BBB');
  // Any other link from the model is not trusted.
  assert.equal(chatUrl({ url: 'https://evil.example/x', space: 'spaces/CCC', kind: 'group' }), 'https://chat.google.com/dm/CCC');
  assert.equal(chatUrl({ url: 'javascript:alert(1)' }), '');
});

test('groupBy: one card per direct conversation, one per thread in a space', () => {
  const out = collapse(
    [
      { id: 'spaces/D/messages/1', kind: 'dm', from: 'Maud', verdict: 'important' },
      { id: 'spaces/D/messages/2', kind: 'dm', from: 'Maud', verdict: 'urgent' },
      { id: 'spaces/S/messages/3', kind: 'space', thread: 'spaces/S/threads/a', from: 'Paul', verdict: 'important' },
      { id: 'spaces/S/messages/4', kind: 'space', thread: 'spaces/S/threads/b', from: 'Zoé', verdict: 'important' },
      { id: 'spaces/S/messages/5', kind: 'space', from: 'Léa', verdict: 'important' }, // no thread: its own card
    ],
    gchat.groupKey,
  );
  assert.deepEqual(out.map((i) => i.id).sort(), ['spaces/D/messages/2', 'spaces/S/messages/3', 'spaces/S/messages/4', 'spaces/S/messages/5']);
});

/** The real gchat module on the engine, with a fake CLI. */
function harness(answers, settingsPatch = {}, stored = {}) {
  const defaults = Object.fromEntries(gchat.settings.filter((s) => 'default' in s).map((s) => [s.key, s.default]));
  const settings = { ...defaults, activeHours: '0-24', weekends: true, ...settingsPatch };
  const data = { seen: {}, items: [], feedback: [], lastCheck: 0, connector: 'claude.ai Chat MCP', connectorSource: 'Google Chat', stats: {}, ...stored };
  if (settingsPatch.via === 'mails') Object.assign(data, { connector: 'claude.ai Gmail', connectorSource: 'Gmail' });
  const actions = new Map();
  const runs = [];
  let state = {};
  const ctx = {
    log() {},
    claude: {
      mcpPrefix: (n) => `mcp__${n.replace(/[^a-zA-Z0-9_-]/g, '_')}__`,
      authStatus: async () => ({ loggedIn: true }),
      listMcp: async () => [
        { name: 'claude.ai Chat MCP', status: '✔ Connected' },
        { name: 'claude.ai Gmail', status: '✔ Connected' },
      ],
      run: async (o) => {
        runs.push(o);
        return { ok: true, structured: answers.shift() };
      },
    },
    settings: () => settings,
    onSettings() {},
    data: { load: () => data, save() {} },
    setState: (p) => (state = { ...state, ...p }),
    getState: () => state,
    onAction: (n, fn) => actions.set(n, fn),
    alert() {},
    dismissAlert() {},
    paused: () => false,
    openExternal() {},
  };
  gchat.init.call(gchat, ctx);
  const act = async (name, payload) => {
    const r = await actions.get(name)(payload);
    gchat.dispose.call(gchat);
    return r;
  };
  return { act, state: () => state, runs, data, ctx };
}

const REFUSED = { found: 0, items: [], source_error: 'Chat MCP access is not enabled for this project.' };
const REMINDER = {
  found: 1,
  items: [{ id: '1a0fb719', kind: 'dm', from: 'Camille <c@x.fr>', title: 'Demain aussi le compte stp', verdict: 'important', reason: 'Demande directe', url: 'https://mail.google.com/mail/?authuser=a#all/thread-f:1|msg-f:1' }],
};

test('Auto: Google refuses the connector → the same check reads the reminder mails', async () => {
  const t = harness([REFUSED, REMINDER]);
  await t.act('refresh');
  assert.equal(t.runs.length, 2);
  assert.ok(t.runs[0].allowedTools.every((x) => x.startsWith('mcp__claude_ai_Chat_MCP__')));
  assert.ok(!t.runs[0].allowedTools.some((x) => /send/.test(x)));
  assert.deepEqual(t.runs[1].allowedTools, ['mcp__claude_ai_Gmail__search_threads', 'mcp__claude_ai_Gmail__get_thread']);
  assert.equal(t.runs[1].requireMcp, 'claude.ai Gmail');
  assert.match(t.runs[1].prompt, /from:chat-noreply@google\.com after:/);
  assert.equal(t.state().status, 'ok');
  assert.match(t.state().via, /refuse/);
  assert.equal(t.state().items[0].url, REMINDER.items[0].url);
  assert.ok(t.data.chatBlockedAt > 0);
});

test('Auto: after an hour on the mails, the connector is tried again', () => {
  const s = { via: 'auto' };
  assert.equal(gchat.mode(s, { chatBlockedAt: Date.now() - 50 * 60000 }), 'mails');
  assert.equal(gchat.mode(s, { chatBlockedAt: Date.now() - 61 * 60000 }), 'chat');
  assert.equal(gchat.mode({ via: 'chat' }, { chatBlockedAt: Date.now() }), 'chat');
  assert.equal(gchat.mode({ via: 'mails' }, {}), 'mails');
});

test('connector only: a refusal is shown, with what to do', async () => {
  const t = harness([REFUSED], { via: 'chat' });
  await t.act('refresh');
  assert.equal(t.runs.length, 1);
  assert.equal(t.state().status, 'error');
  assert.match(t.state().error, /Developer Preview Program/);
});

test('reminder mails: one card per person (DM) or per space', () => {
  const g = 'https://mail.google.com/mail/?authuser=a#all/thread-f:';
  const out = collapse(
    [
      { id: 'a', kind: 'dm', from: 'Camille <c@x.fr>', verdict: 'important', url: g + '1' },
      { id: 'b', kind: 'dm', from: 'Camille <c@x.fr>', verdict: 'urgent', url: g + '2' },
      { id: 'c', kind: 'space', context: 'Projet Data', from: 'Hugo', verdict: 'important', url: g + '3' },
      { id: 'd', kind: 'space', context: 'Projet Data', from: 'Inès', verdict: 'important', url: g + '4' },
    ],
    gchat.groupKey,
  );
  assert.deepEqual(out.map((i) => i.id).sort(), ['b', 'c']);
});

test('steps: mentions, direct messages and the user’s own replies, in the window', () => {
  const since = Date.parse('2026-10-11T08:00:00Z');
  const text = gchat.steps({ since, settings: { me: '', spaces: false } });
  assert.match(text, /"mentionsMe":true/);
  assert.match(text, /DIRECT_MESSAGE/);
  assert.match(text, /"sender":"users\/me"/);
  assert.match(text, /2026-10-11T08:00:00\.000Z/);
  assert.doesNotMatch(text, /NAMED_SPACE/);
  const more = gchat.steps({ since, settings: { me: 'moi@x.fr', spaces: true } });
  assert.match(more, /NAMED_SPACE/);
  assert.match(more, /"sender":"moi@x.fr"/);
});

test('bursts: a person’s messages that each start a thread in a space are one card, counted', () => {
  const S = 'spaces/AAQ';
  const msg = (key, from, verdict) => ({ id: `${S}/messages/${key}.${key}`, thread: `${S}/threads/${key}`, kind: 'space', from, verdict });
  const out = collapse(
    [
      msg('a1', 'Renaud VIOLON <renaud@x.fr>', 'important'),
      msg('a2', 'Renaud VIOLON <renaud@x.fr>', 'urgent'),
      msg('a3', 'Renaud VIOLON <renaud@x.fr>', 'urgent'),
      msg('b1', 'Zoé <zoe@x.fr>', 'important'),
      // A real reply inside a thread stays with its thread.
      { id: `${S}/messages/t9.r1`, thread: `${S}/threads/t9`, kind: 'space', from: 'Renaud VIOLON <renaud@x.fr>', verdict: 'important' },
    ],
    gchat.groupKey,
  );
  assert.equal(out.length, 3);
  const renaud = out.find((i) => i.id === `${S}/messages/a2.a2`);
  assert.equal(renaud.count, 3);
  assert.equal(gchat.groupKey(renaud), `${S}/from/renaud@x.fr`);
  assert.equal(out.find((i) => i.from.startsWith('Zoé')).count, undefined);
  // An item the model already merged keeps its count, and adds up with the others.
  const merged = collapse([{ ...msg('c1', 'Paul', 'important'), count: 4 }, msg('c2', 'Paul', 'important')], gchat.groupKey);
  assert.equal(merged[0].count, 5);
});

test('steps: one element per topic, even across conversations; the open cards are given to continue', async () => {
  const since = Date.UTC(2026, 9, 14, 8);
  const text = gchat.steps({ since, settings: { me: '', spaces: false }, data: {} });
  assert.match(text, /jamais un élément par message/);
  assert.match(text, /plusieurs conversations, fils ou personnes/);
  assert.match(text, /count = le nombre de messages/);
  assert.match(gchat.mailSteps({ since }), /jamais un par ligne/);
  // The engine lists the open cards (not the done ones), with their subject.
  const items = [
    { id: 'spaces/D/messages/1', group: 'spaces/D', topic: 'accès helpdesk coupons', from: 'Maud <m@x.fr>', title: 'Accès HelpDesk', summary: 'Donner l’accès coupons', verdict: 'important', at: since },
    { id: 'x', group: 'spaces/E', from: 'Old', title: 'Fini', verdict: 'important', done: true, at: since },
  ];
  const t = harness([{ found: 0, items: [] }], {}, { items, lastCheck: since });
  await t.act('refresh');
  const p = t.runs[0].prompt;
  assert.match(p, /id=spaces\/D\/messages\/1 · clé=spaces\/D · sujet=accès helpdesk coupons · .* · Maud · « Accès HelpDesk »/);
  assert.doesNotMatch(p, /Fini/);
  assert.match(p, /topic = exactement son sujet=/);
});

test('spaces ("salons"): only what is addressed to the user; DMs: everything', () => {
  const { adjust } = gchat;
  assert.equal(adjust({ kind: 'space', to_me: 'direct' }, 'important'), 'important');
  assert.equal(adjust({ kind: 'space', to_me: 'reply' }, 'urgent'), 'urgent');
  assert.equal(adjust({ kind: 'space', to_me: 'cc' }, 'important'), 'normal');
  assert.equal(adjust({ kind: 'space', to_me: 'all' }, 'urgent'), 'normal');
  assert.equal(adjust({ kind: 'space', to_me: 'group' }, 'important'), 'normal');
  assert.equal(adjust({ kind: 'group', to_me: 'group' }, 'important'), 'important');
  assert.equal(adjust({ kind: 'group', to_me: 'none' }, 'important'), 'normal');
  assert.equal(adjust({ kind: 'dm', to_me: 'none' }, 'important'), 'important');
  assert.equal(adjust({ kind: 'space', to_me: 'cc' }, 'noise'), 'noise');
  // The prompt explains a mention in copy, and @all.
  const text = gchat.steps({ since: Date.now(), settings: {}, data: { meUser: 'users/42' } });
  assert.match(text, /data-user="users\/42"/);
  assert.match(text, /users\/all/);
  assert.match(text, /s'adresse à Paul, pas à l'utilisateur/);
});

test('a space mention in copy never becomes a card, even from a VIP', async () => {
  const S = 'spaces/S';
  const t = harness([{ found: 2, me_user: 'users/42', items: [
    { id: `${S}/messages/a.a`, space: S, thread: `${S}/threads/a`, kind: 'space', to_me: 'cc', from: 'Hélène <h@x.fr>', title: 'Coupons ATLAS', verdict: 'important', reason: 'Mention' },
    { id: `${S}/messages/b.b`, space: S, thread: `${S}/threads/b`, kind: 'space', to_me: 'direct', from: 'Hélène <h@x.fr>', title: 'Accès HelpDesk', verdict: 'important', reason: 'Question pour toi' },
  ] }], { vip: ['Hélène'] });
  await t.act('refresh');
  assert.deepEqual(t.data.items.map((i) => i.title), ['Accès HelpDesk']);
  assert.equal(t.data.meUser, 'users/42');
});

test('read in Google Chat: the open card goes silently, a message already read never alerts', async () => {
  const D = 'spaces/D';
  const alerts = [];
  const dismissed = [];
  const open = { id: `${D}/messages/1`, group: D, from: 'Maud <m@x.fr>', title: 'Accès HelpDesk', verdict: 'important', at: Date.now() - 600000, read: false };
  const t = harness([{ found: 2, settled: [{ id: open.id, how: 'read' }, { id: 'spaces/X/messages/9', how: 'read' }], items: [
    { id: 'spaces/E/messages/5', space: 'spaces/E', kind: 'dm', from: 'Zoé <z@x.fr>', title: 'Déjà vu', verdict: 'urgent', reason: 'r', handled: true },
  ] }], {}, { items: [open], lastCheck: Date.now() - 300000 });
  t.ctx.alert = (a) => alerts.push(a);
  t.ctx.dismissAlert = (k) => dismissed.push(k);
  await t.act('refresh');
  assert.match(t.runs[0].prompt, /"isUnread":true/);
  assert.equal(t.state().items.length, 0);
  assert.equal(t.state().unread, 0);
  assert.equal(t.state().settledToday, 1);
  assert.equal(t.state().settleSource, 'Google Chat');
  assert.equal(t.data.items[0].doneBy, 'source');
  assert.deepEqual(dismissed, [open.id]);
  assert.equal(alerts.length, 0);
});

test('through the reminder mails, nothing is closed for the user (they say nothing of what was read)', async () => {
  const open = { id: 'm1', group: 'mail:dm:camille', from: 'Camille', title: 'Compte', verdict: 'important', at: Date.now() - 600000 };
  const t = harness([{ found: 0, items: [], settled: [{ id: 'm1', how: 'read' }] }], { via: 'mails' }, { items: [open], lastCheck: Date.now() - 300000 });
  await t.act('refresh');
  assert.doesNotMatch(t.runs[0].prompt, /settled =/);
  assert.equal(t.state().items.length, 1);
});

test('one subject over two conversations is one card; a later message on it replaces the open card', async () => {
  const a = { id: 'spaces/A/messages/1', space: 'spaces/A', kind: 'dm', from: 'Maud <m@x.fr>', title: 'Incident ATLAS', topic: 'Incident ATLAS prod', verdict: 'important', reason: 'r' };
  const b = { id: 'spaces/B/messages/2', space: 'spaces/B', thread: 'spaces/B/threads/t', kind: 'space', to_me: 'direct', from: 'Hugo <h@x.fr>', title: 'ATLAS', topic: 'incident atlas prod', verdict: 'urgent', reason: 'r' };
  const c = { id: 'spaces/C/messages/3', space: 'spaces/C', kind: 'dm', from: 'Inès <i@x.fr>', title: 'ATLAS toujours KO', topic: 'incident atlas prod', verdict: 'important', reason: 'r' };
  const t = harness([{ found: 2, items: [a, b] }, { found: 1, items: [c] }]);
  await t.act('refresh');
  assert.equal(t.data.items.length, 1);
  assert.equal(t.data.items[0].id, b.id);
  assert.equal(t.data.items[0].messages, 2);
  await t.act('refresh');
  assert.equal(t.data.items.length, 1);
  assert.equal(t.data.items[0].id, c.id);
  assert.equal(t.data.items[0].messages, 3);
});

test('a follow-up replaces the open card of its conversation, adds up its messages, and comes without a sound', async () => {
  const D = 'spaces/D';
  const first = { found: 2, items: [{ id: `${D}/messages/1`, space: D, kind: 'dm', from: 'Maud <m@x.fr>', title: 'Accès HelpDesk', verdict: 'important', reason: 'Demande', count: 2 }] };
  const next = { found: 1, items: [{ id: `${D}/messages/3`, space: D, kind: 'dm', from: 'Maud <m@x.fr>', title: 'Accès HelpDesk', verdict: 'important', reason: 'Relance' }] };
  const t = harness([first, next]);
  const alerts = [];
  const dismissed = [];
  t.ctx.alert = (a) => alerts.push(a);
  t.ctx.dismissAlert = (k) => dismissed.push(k);
  await t.act('refresh');
  await t.act('refresh');
  assert.equal(t.data.items.length, 1);
  assert.equal(t.data.items[0].id, `${D}/messages/3`);
  assert.equal(t.data.items[0].messages, 3);
  assert.deepEqual(dismissed, [`${D}/messages/1`]);
  assert.equal(alerts[0].sound, 'mail');
  assert.equal(alerts[1].sound, null);
});

test('cards: the space’s resource name is never shown as its name', () => {
  const n = gchat.normalize;
  assert.equal(n({ kind: 'space', context: 'spaces/AAQ' }).context, 'Espace');
  assert.equal(n({ kind: 'space', context: 'Infra HELPDESK' }).context, 'Infra HELPDESK');
  assert.equal(n({ kind: 'dm', context: '' }).context, 'Message direct');
});
