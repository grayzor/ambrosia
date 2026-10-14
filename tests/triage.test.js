// The triage engine with a fake Claude CLI: no network, no Electron.

const test = require('node:test');
const assert = require('node:assert');
const { triage } = require('../src/main/triage');

function harness(answers, settingsPatch = {}, stored, extra = {}) {
  const def = triage({
    id: 't', name: 'T', source: 'Src', connectorPattern: /src/i, readTools: ['read'],
    defaultRules: 'r', systemPrompt: 's', steps: () => 'steps', labels: { digest: (n) => `${n} digest` },
    firstDelayMs: 1e9,
    ...extra,
  });
  const defaults = Object.fromEntries(def.settings.filter((s) => 'default' in s).map((s) => [s.key, s.default]));
  const settings = { ...defaults, activeHours: '0-24', weekends: true, ...settingsPatch };
  const data = stored || { seen: {}, items: [], feedback: [], lastCheck: 0, connector: 'claude.ai Src', stats: {} };
  const actions = new Map();
  const alerts = [];
  const prompts = [];
  const opened = [];
  let state = {};
  const ctx = {
    log() {},
    claude: {
      mcpPrefix: (n) => `mcp__${n.replace(/[^a-zA-Z0-9_-]/g, '_')}__`,
      run: async (o) => {
        prompts.push(o);
        const a = answers.shift();
        return typeof a === 'function' ? a(o) : { ok: true, structured: a };
      },
    },
    settings: () => settings,
    onSettings() {},
    data: { load: () => data, save() {} },
    setState: (p) => (state = { ...state, ...p }),
    getState: () => state,
    onAction: (n, fn) => actions.set(n, fn),
    alert: (a) => alerts.push(a),
    dismissAlert() {},
    paused: () => false,
    openExternal: (u) => opened.push(u),
    focus() {},
    react() {},
  };
  def.init.call(def, ctx);
  const act = async (name, payload) => {
    const r = await actions.get(name)(payload);
    def._stop(); // 'refresh' reschedules: keep the test process free of timers
    return r;
  };
  return { act, state: () => state, alerts, prompts, data, opened };
}

const item = (id, verdict, from = 'Alice <alice@x.fr>') => ({ id, from, title: `t-${id}`, verdict, reason: 'r' });

test('only important and urgent items are kept, with one alert each', async () => {
  const t = harness([{ found: 5, items: [item('a', 'important'), item('b', 'noise'), item('c', 'urgent'), item('d', 'normal')] }]);
  await t.act('refresh');
  assert.deepEqual(t.state().items.map((i) => i.id).sort(), ['a', 'c']);
  assert.equal(t.state().unread, 2);
  assert.equal(t.state().stats.checked, 5); // 4 listed + 1 examined but not listed
  // first run with several items: one digest instead of a burst of alerts
  assert.equal(t.alerts.length, 1);
  assert.equal(t.state().mood.name, 'mail');
  assert.equal(t.state().mood.priority, 75);
});

test('only read tools of the detected connector are allowed', async () => {
  const t = harness([{ found: 0, items: [] }]);
  await t.act('refresh');
  assert.deepEqual(t.prompts[0].allowedTools, ['mcp__claude_ai_Src__read']);
  assert.equal(t.prompts[0].requireMcp, 'claude.ai Src');
});

test('an item already seen never comes back', async () => {
  const t = harness([{ found: 1, items: [item('a', 'important')] }, { found: 1, items: [item('a', 'urgent')] }]);
  await t.act('refresh');
  await t.act('done', { id: 'a' });
  await t.act('refresh');
  assert.equal(t.state().items.length, 0);
});

test('VIP and ignore lists override the model', async () => {
  const t = harness(
    [{ found: 2, items: [item('a', 'normal', 'Boss <boss@corp.fr>'), item('b', 'urgent', 'Robot <noreply@saas.io>')] }],
    { vip: ['boss@corp.fr'], ignore: ['saas.io'] },
  );
  await t.act('refresh');
  assert.deepEqual(t.state().items.map((i) => [i.id, i.verdict]), [['a', 'important']]);
});

test('Traité removes from the list, Annuler brings it back', async () => {
  const t = harness([{ found: 2, items: [item('a', 'important'), item('b', 'important')] }]);
  await t.act('refresh');
  await t.act('done', { id: 'a' });
  assert.deepEqual(t.state().items.map((i) => i.id), ['b']);
  assert.equal(t.state().doneToday, 1);
  await t.act('undoDone');
  assert.equal(t.state().items.length, 2);
  await t.act('doneAll');
  assert.equal(t.state().items.length, 0);
  assert.equal(t.state().mood, null);
});

test('« Confier à Claude » notes the card without marking it Traité', async () => {
  const t = harness([{ found: 1, items: [item('a', 'important')] }]);
  await t.act('refresh');
  await t.act('delegated', { id: 'a' });
  const [a] = t.state().items;
  assert.ok(a.delegatedAt > 0);
  assert.equal(a.read, true);
  assert.ok(!a.done);
  assert.equal(t.state().doneToday, 0);
});

test('"Pas important" hides the item and is fed back to the next prompt', async () => {
  const t = harness([{ found: 1, items: [item('a', 'important')] }, { found: 0, items: [] }]);
  await t.act('refresh');
  await t.act('notImportant', { id: 'a' });
  assert.equal(t.state().items.length, 0);
  await t.act('refresh');
  assert.match(t.prompts[1].prompt, /"t-a" de Alice <alice@x\.fr> → pas important/);
});

test('old Courrier data (subject) still shows', async () => {
  const stored = { seen: { x: Date.now() }, items: [{ id: 'x', subject: 'Ancien', verdict: 'important', at: 1, read: false }], feedback: [{ subject: 'S', from: 'F', verdict: 'noise' }], lastCheck: 1, connector: 'claude.ai Src', stats: {} };
  const t = harness([{ found: 0, items: [] }], {}, stored);
  await t.act('refresh');
  assert.equal(t.state().items[0].title, 'Ancien');
  assert.match(t.prompts[0].prompt, /"S" de F/);
});

test('groupBy: one card per task, the most severe, real author preferred', () => {
  const { collapse } = require('../src/main/triage');
  const u = 'https://app.clickup.com/t/abc';
  const out = collapse(
    [
      { id: 'task-abc-1', from: 'ClickUp', verdict: 'important', url: u },
      { id: 'c1', from: 'Julie', verdict: 'urgent', url: u },
      { id: 'c2', from: 'Paul', verdict: 'important', url: u },
      { id: 'x', from: 'Zoé', verdict: 'important', url: '' },
    ],
    (r) => r.url,
  );
  assert.deepEqual(out.map((i) => i.id).sort(), ['c1', 'x']);
});

test('a source error is shown, not "nothing important", and the window stays open', async () => {
  const t = harness([{ found: 0, items: [], source_error: 'Chat MCP access is not enabled for this project.' }]);
  await t.act('refresh');
  assert.equal(t.state().status, 'error');
  assert.match(t.state().error, /not enabled/);
  assert.equal(t.data.lastCheck, 0); // the next check looks at the same window again
  assert.match(t.prompts[0].prompt, /source_error/);
  assert.ok(t.prompts[0].jsonSchema.properties.source_error);
});

// ── Proposals ────────────────────────────────────────────────────────────

const { callTool } = require('../src/main/triage');

/** A proposer that drafts a reply for every item, sending it with the engine's callTool. */
const replyProposer = {
  max: 2,
  async make({ item, ctx, prefix, model }) {
    const res = await ctx.claude.run({ prompt: `propose ${item.id}`, model, allowedTools: [prefix + 'read'] });
    if (!res.structured?.body) return null;
    return {
      headline: 'Réponse', ask: 'q ?', text: { label: 'R', value: res.structured.body },
      actions: [{ act: 'send', label: 'Envoyer', primary: true, usesText: true }], data: { mid: 'm-' + item.id },
    };
  },
  apply: async ({ ctx, server, proposal, text }) => ({ ...(await callTool(ctx, server, 'reply', { messageId: proposal.data.mid, body: text })), done: true }),
};
const toolRan = (structured) => (o) => ({ ok: true, structured, toolsUsed: o.allowedTools });

test('a proposal is prepared read-only, and comes with the alert', async () => {
  const t = harness([{ found: 1, items: [item('a', 'important')] }, { body: 'Oui.' }], {}, undefined, { proposer: replyProposer });
  await t.act('refresh');
  assert.equal(t.state().items[0].proposal.text.value, 'Oui.');
  assert.deepEqual(t.prompts[1].allowedTools, ['mcp__claude_ai_Src__read']);
  assert.equal(t.prompts[1].model, 'sonnet');
  assert.equal(t.alerts.length, 1);
  assert.equal(t.alerts[0].actions[0].action, 'show');
  assert.match(t.alerts[0].text, /^Réponse — q \?/);
});

test('no proposal: the card and the alert stay as before, without a word', async () => {
  const t = harness([{ found: 1, items: [item('a', 'important')] }, { body: '' }], {}, undefined, { proposer: replyProposer });
  await t.act('refresh');
  assert.equal(t.state().items[0].proposal, undefined);
  assert.equal(t.alerts[0].actions, undefined);
  assert.equal(t.alerts[0].text, 'r');
});

test('the switch in Réglages turns proposals off', async () => {
  const t = harness([{ found: 1, items: [item('a', 'important')] }], { propose: false }, undefined, { proposer: replyProposer });
  await t.act('refresh');
  assert.equal(t.prompts.length, 1);
});

test('a click runs exactly one write tool, with the text as edited', async () => {
  const t = harness([{ found: 1, items: [item('a', 'important')] }, { body: 'Oui.' }, toolRan({ done: true })], {}, undefined, { proposer: replyProposer });
  await t.act('refresh');
  assert.equal(await t.act('apply', { id: 'a', act: 'send', text: 'Oui, avec plaisir.' }), null);
  const exec = t.prompts[2];
  assert.deepEqual(exec.allowedTools, ['mcp__claude_ai_Src__reply']);
  assert.match(exec.prompt, /"body":"Oui, avec plaisir\."/);
  assert.match(exec.prompt, /"messageId":"m-a"/);
  assert.equal(t.state().items.length, 0); // sent → handled
});

test('an action Gany did not propose is refused; a failure stays on the card', async () => {
  const t = harness([{ found: 1, items: [item('a', 'important')] }, { body: 'Oui.' }, () => ({ ok: true, structured: { done: true }, toolsUsed: [] })], {}, undefined, { proposer: replyProposer });
  await t.act('refresh');
  assert.equal(await t.act('apply', { id: 'a', act: 'delete' }), null);
  assert.equal(t.prompts.length, 2);
  assert.match(await t.act('apply', { id: 'a', act: 'send' }), /pas été appelé/);
  const it = t.state().items[0];
  assert.equal(it.applied.send.ok, false);
  assert.equal(it.done, undefined);
});

test('"Pas utile" removes the proposal and teaches the next ones', async () => {
  let seen;
  const proposer = { ...replyProposer, make: async (c) => ((seen = c.rejected), replyProposer.make(c)) };
  const t = harness([{ found: 1, items: [item('a', 'important')] }, { body: 'Oui.' }, { found: 1, items: [item('b', 'important')] }, { body: '' }], {}, undefined, { proposer });
  await t.act('refresh');
  await t.act('dismissProposal', { id: 'a' });
  assert.equal(t.state().items.find((i) => i.id === 'a').proposal, undefined);
  await t.act('refresh');
  assert.deepEqual(seen.map((r) => r.title), ['t-a']);
});

test('mail proposals: only a sure, personal ask; invites need the agenda and clean addresses', () => {
  const { build } = require('../src/modules/mail/propose');
  const it = { id: 'th1', from: 'Théo <theo@corp.fr>', title: 'Comité' };
  const base = { for_me: true, confidence: 'high', message_id: 'msg1', reply_to: 'theo@corp.fr', ask: 'a' };
  assert.equal(build({ ...base, kind: 'none' }, it, 'cal'), null);
  assert.equal(build({ ...base, kind: 'reply', reply_body: 'Oui', for_me: false }, it, 'cal'), null);
  assert.equal(build({ ...base, kind: 'reply', reply_body: 'Oui', confidence: 'low' }, it, 'cal'), null);
  assert.deepEqual(build({ ...base, kind: 'reply', reply_body: 'Oui' }, it, '').actions.map((a) => a.act), ['send', 'draft']);
  assert.equal(build({ ...base, kind: 'invite', event_id: 'e1', emails: ['theo@corp.fr'] }, it, ''), null);
  assert.equal(build({ ...base, kind: 'invite', event_id: 'e1', emails: ['pas une adresse'] }, it, 'cal'), null);
  const inv = build({ ...base, kind: 'invite', event_id: 'e1', event_title: 'Comité', emails: ['Theo@corp.fr', 'x"@y'], reply_body: 'Fait' }, it, 'cal');
  assert.deepEqual(inv.data.emails, ['theo@corp.fr']);
  assert.deepEqual(inv.actions.map((a) => a.act), ['invite', 'send', 'draft']);
});

test('ClickUp proposals: no secret in a draft, plain-word statuses, plan-first hand-off', () => {
  const { build, handoffPrompt } = require('../src/modules/clickup/propose');
  const it = { id: '901', url: 'https://app.clickup.com/t/86abc', title: '[ATLAS-1] Stock', summary: 's' };
  const out = { kind: 'proposal', confidence: 'high', task_id: '86abc', ask: 'a', comment: 'Voici : postgresql://u:hunter2@db/x', status: 'done', project_plan: 'Requêter BigQuery', project: 'C:/p' };
  const p = build(out, it, ['C:/p']);
  assert.deepEqual(p.actions.map((a) => a.act), ['status', 'handoff']);
  assert.equal(build({ ...out, comment: '', status: 'done"; rm', project_plan: '' }, it, []), null);
  const ok = build({ ...out, comment: 'Le stock vient de ADEIZ.', reply_to_id: '901' }, it, ['C:/p']);
  assert.equal(ok.actions[0].act, 'comment');
  assert.equal(ok.data.replyTo, '901');
  assert.match(handoffPrompt(it, p), /^Traite le ticket ClickUp https:\/\/app\.clickup\.com\/t\/86abc .*plan avant d'agir/);
});

test('the hand-off prompt survives cmd.exe quoting', () => {
  const { cmdQuotable } = require('../src/main/claude');
  assert.equal(cmdQuotable('a "b" %PATH% !x!\r\nc\\'), 'a ’b’  PATH   x  c');
});
