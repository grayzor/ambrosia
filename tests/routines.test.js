// Routines: the pure logic (guard, cron, duplicates, memory, SKILL.md, deep link),
// the disk reads on a scratch folder, and the module with a fake Claude CLI and a
// fake Claude Desktop — nothing is created, nothing is opened.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ambrosia-routines-'));
process.env.APPDATA = path.join(tmp, 'roaming');
process.env.LOCALAPPDATA = path.join(tmp, 'local');
process.env.USERPROFILE = path.join(tmp, 'home');
fs.mkdirSync(path.join(process.env.APPDATA, 'Ambrosia', 'data'), { recursive: true });
fs.writeFileSync(path.join(process.env.APPDATA, 'Ambrosia', 'settings.json'), JSON.stringify({ mail: { connector: 'claude.ai Gmail' } }));

const L = require('../src/modules/routines/logic');
const src = require('../src/modules/routines/sources');

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const NOW = new Date(2026, 9, 12, 11, 50); // Monday 12 October 2026, 11:50

// An existing task, in the user's style.
const GMAIL_TASK = `---
name: gmail-inbox-auto-drafts
description: Scan la boite Gmail de Camille, filtre les mails qui attendent une reponse de lui personnellement, et prepare des brouillons de reponse dans Gmail.
---

Tu es une tache planifiee qui traite la boite Gmail de Camille.

# Outils a utiliser
- Connecteur Gmail : search_threads, get_thread, create_draft, list_drafts
Aucune notification a envoyer et aucun marquage.
`;

const GOOD = {
  titre: 'Relevé des tickets HelpDesk avant le point du lundi',
  description: 'Rassemble les tickets HelpDesk ouverts de la semaine et prépare un résumé pour le point d’équipe du lundi.',
  pourquoi: 'Chaque lundi tu demandes à Claude la liste des tickets ouverts avant le point support.',
  occurrences: ['28/09 : « liste les tickets HelpDesk ouverts »', '05/10 : « refais la liste des tickets ouverts »', '12/10 : idem'],
  source: 'claude',
  cron: '30 8 * * 1',
  frequence: 'Chaque lundi à 8 h 30',
  prompt: 'Tu es une tâche planifiée qui prépare le point support du lundi.\n\n# Outils à utiliser\n- Gmail : search_threads, get_thread, create_draft\n\n# Étapes\n1. Cherche les notifications HelpDesk de la semaine.\n2. Prépare un brouillon Gmail de résumé (create_draft), sans l’envoyer.\n\nRéponds en français.',
  outils: ['search_threads', 'get_thread', 'create_draft'],
  gain: '~20 min par semaine',
};

// ── Guard ──────────────────────────────────────────────────────────────────

test('toolProblem: read and draft tools pass, outbound and irreversible ones do not', () => {
  for (const ok of ['search_threads', 'mcp__claude_ai_Gmail__get_thread', 'create_draft', 'list_events', 'clickup_filter_tasks', 'read_file_content', 'create_file', 'Read', 'Write', 'WebFetch', 'execute_sql_readonly', 'update_message_labels']) {
    assert.equal(L.toolProblem(ok), null, ok);
  }
  for (const bad of ['send_message', 'mcp__claude_ai_Gmail__send_message', 'reply', 'forward', 'trash_thread', 'delete_event', 'share_file', 'clickup_create_task_comment', 'clickup_send_chat_message', 'create_event', 'update_event', 'respond_to_event', 'clickup_update_task', 'clickup_execute_operator', 'create_scheduled_task', 'Bash', 'PowerShell', 'clickup_move_task']) {
    assert.ok(L.toolProblem(bad), bad);
  }
});

test('outboundSentences: an order to send is caught, a prohibition is not', () => {
  assert.deepEqual(L.outboundSentences(GOOD.prompt), []);
  assert.deepEqual(L.outboundSentences('N’envoie jamais de mail. Aucune notification a envoyer. Ne supprime rien.'), []);
  assert.deepEqual(L.outboundSentences('Réponds en français, en trois lignes.'), [], 'the final answer is not a mail');
  assert.equal(L.outboundSentences('Ensuite, envoie le résumé à toute l’équipe.').length, 1);
  assert.equal(L.outboundSentences('Puis appelle send_message avec le résumé.').length, 1);
  assert.equal(L.outboundSentences('Supprime les mails HelpDesk traités.').length, 1);
  assert.equal(L.outboundSentences('Réponds au mail de Maud avec le statut.').length, 1);
  assert.equal(L.outboundSentences('Utilise create_draft (pas send_message).').length, 0);
});

test('guard: tools, sentences, cron, size', () => {
  assert.deepEqual(L.guard(GOOD), { ok: true, reasons: [] });
  const bad = L.guard({ ...GOOD, outils: [...GOOD.outils, 'send_message'], prompt: GOOD.prompt + '\nEnvoie-le à Sophie.' });
  assert.equal(bad.ok, false);
  assert.equal(bad.reasons.length, 2);
  assert.equal(L.guard({ ...GOOD, cron: '*/5 * * * *' }).ok, false, 'more than hourly');
  assert.equal(L.guard({ ...GOOD, cron: '30 8 * *' }).ok, false, 'not 5 fields');
  assert.equal(L.guard({ ...GOOD, prompt: 'x'.repeat(L.MAX_PROMPT + 1) }).ok, false);
  assert.equal(L.guard({ ...GOOD, prompt: '  ' }).ok, false);
});

// ── Cron ───────────────────────────────────────────────────────────────────

test('describeCron: the user’s schedules in French', () => {
  assert.equal(L.describeCron('30 8 * * 1-5'), 'Du lundi au vendredi à 8 h 30');
  assert.equal(L.describeCron('0 9 * * 1'), 'Chaque lundi à 9 h');
  assert.equal(L.describeCron('51 8,14 * * 1-5'), 'Du lundi au vendredi à 8 h 51 et 14 h 51');
  assert.equal(L.describeCron('22 12 * * *'), 'Chaque jour à 12 h 22');
  assert.equal(L.describeCron('13 * * * *'), 'Toutes les heures (à 13)');
  assert.equal(L.describeCron('0 9 1 * *'), 'Le 1er de chaque mois à 9 h');
  assert.equal(L.describeCron('0 17 * * 1,3,5'), 'Lundi, mercredi et vendredi à 17 h');
  assert.match(L.describeCron('nope'), /invalide/);
  assert.equal(L.validCron('61 8 * * *'), false);
  assert.equal(L.validCron('0 8 * * 7'), true);
});

test('cronFrom / rhythmOf: the frequency editor round-trips', () => {
  assert.equal(L.cronFrom({ rhythm: 'workdays', time: '08:30' }), '30 8 * * 1-5');
  assert.equal(L.cronFrom({ rhythm: 'fri', time: '16:00' }), '0 16 * * 5');
  assert.equal(L.cronFrom({ rhythm: 'monthly', time: '09:05' }), '5 9 1 * *');
  assert.equal(L.cronFrom({ rhythm: 'hourly', time: '00:20' }), '20 * * * *');
  assert.equal(L.cronFrom({ rhythm: 'daily', time: '25:00' }), null);
  assert.equal(L.cronFrom({ rhythm: 'nope', time: '08:00' }), null);
  for (const r of L.RHYTHMS) {
    const cron = L.cronFrom({ rhythm: r.id, time: '07:45' });
    assert.equal(L.rhythmOf(cron).rhythm, r.id, r.id);
  }
  assert.equal(L.rhythmOf('51 8,14 * * 1-5'), null, 'not one of the presets: custom cron');
});

// ── Duplicates and memory ──────────────────────────────────────────────────

test('slugify: kebab-case, accent-free, unique', () => {
  assert.equal(L.slugify('Relevé des tickets HelpDesk avant le point'), 'releve-des-tickets-helpdesk-avant-le');
  assert.equal(L.slugify('Digest agenda', ['digest-agenda']), 'digest-agenda-2');
  assert.equal(L.slugify('!!!'), 'routine');
});

test('duplicateOf: an existing task, a refusal, a pending suggestion', () => {
  const existing = [{ id: 'gmail-inbox-auto-drafts', name: 'gmail-inbox-auto-drafts', description: L.parseSkill(GMAIL_TASK).description }];
  const drafts = { titre: 'Brouillons de réponse Gmail', description: 'Filtre les mails qui attendent une réponse de Camille et prépare des brouillons de réponse dans Gmail.' };
  assert.equal(L.duplicateOf(drafts, { existing })?.kind, 'existing');
  assert.equal(L.duplicateOf(GOOD, { existing }), null);
  const memory = [{ title: 'Relevé des tickets HelpDesk du lundi', outcome: 'refused' }];
  assert.equal(L.duplicateOf(GOOD, { existing, memory })?.kind, 'refused');
  assert.equal(L.duplicateOf(GOOD, { pending: [{ titre: 'Tickets HelpDesk avant le point du lundi' }] })?.kind, 'pending');
});

test('remember / expire: refusals are kept, silence expires after 14 days', () => {
  const data = { suggestions: [{ id: 'a', titre: 'A', createdAt: NOW.getTime() - 15 * L.DAY, status: 'new' }, { id: 'b', titre: 'B', createdAt: NOW.getTime(), status: 'new' }], memory: [] };
  assert.equal(L.expire(data, NOW), true);
  assert.deepEqual(data.suggestions.map((s) => s.id), ['b']);
  assert.equal(data.memory[0].outcome, 'expired');
  L.remember(data, data.suggestions[0], 'refused', NOW);
  L.remember(data, data.suggestions[0], 'refused', NOW);
  assert.equal(data.memory.filter((m) => m.id === 'b').length, 1, 'once per suggestion');
  for (let i = 0; i < 250; i++) L.remember(data, { id: 'x' + i, titre: 'x' }, 'refused', NOW);
  assert.equal(data.memory.length, 200);
});

test('sanitize: guard, duplicates, occurrences, room, ids', () => {
  const structured = {
    suggestions: [
      GOOD,
      { ...GOOD, titre: 'Relance automatique des fournisseurs', description: 'Relance les fournisseurs', outils: ['send_message'], prompt: 'Envoie une relance à chaque fournisseur.' },
      { ...GOOD, titre: 'Contrôle hebdo du flux ERP', description: 'Vérifie le flux ERP', occurrences: ['une fois'] },
      { ...GOOD, titre: 'Brouillons de réponse Gmail', description: 'Prépare des brouillons de réponse dans Gmail aux mails qui attendent une réponse de Camille.' },
      { ...GOOD, titre: 'Synthèse des demandes Chat du support', description: 'Résume les demandes Chat du support', cron: '0 17 * * 5' },
      { ...GOOD, titre: 'Point stock boutiques du vendredi', description: 'Vérifie les stocks boutiques' },
    ],
  };
  const existing = [{ id: 'gmail-inbox-auto-drafts', name: 'gmail-inbox-auto-drafts', description: L.parseSkill(GMAIL_TASK).description }];
  const { accepted, rejected } = L.sanitize(structured, { now: NOW, existing, taken: ['releve-des-tickets-helpdesk-avant-le'], room: 2 });
  assert.deepEqual(accepted.map((a) => a.titre), [GOOD.titre, 'Synthèse des demandes Chat du support']);
  assert.equal(accepted[0].taskId, 'releve-des-tickets-helpdesk-avant-le-2');
  assert.equal(accepted[1].frequence, 'Chaque vendredi à 17 h', 'the label is recomputed from the cron, not trusted');
  assert.equal(accepted[0].status, 'new');
  assert.equal(rejected.length, 3);
  assert.match(rejected[0].reasons.join(' '), /send_message/);
  assert.match(rejected[1].reasons.join(' '), /occurrences/);
  assert.match(rejected[2].reasons.join(' '), /Doublon/);
});

test('task folder: the placeholder becomes the real folder, and follows a new id', () => {
  const structured = { suggestions: [{ ...GOOD, prompt: GOOD.prompt + `\nÉcris le relevé dans ${L.TASK_DIR}\\releve.md et l’état dans ${L.TASK_DIR}\\state.json.` }] };
  const { accepted } = L.sanitize(structured, { now: NOW, tasksDir: 'C:\\Users\\n\\.claude\\scheduled-tasks\\' });
  const dir = `C:\\Users\\n\\.claude\\scheduled-tasks\\${accepted[0].taskId}`;
  assert.ok(accepted[0].prompt.includes(`${dir}\\releve.md`));
  assert.ok(accepted[0].prompt.includes(`${dir}\\state.json`));
  assert.ok(!accepted[0].prompt.includes(L.TASK_DIR));
  const moved = L.withTaskDir(accepted[0].prompt, dir + '-2', dir);
  assert.ok(moved.includes(`${dir}-2\\releve.md`) && moved.includes(`${dir}-2\\state.json`));
  assert.match(L.buildPrompt({ now: NOW }), /\{\{DOSSIER_TACHE\}\}/, 'the model is told about the placeholder');
});

// ── SKILL.md and the hand-over to Claude Desktop ───────────────────────────

test('buildSkillMd / parseSkill: frontmatter like the existing tasks, guard footer appended', () => {
  const md = L.buildSkillMd({ taskId: 'releve-tickets', description: GOOD.description, prompt: GOOD.prompt });
  assert.match(md, /^---\nname: releve-tickets\ndescription: Rassemble/);
  const back = L.parseSkill(md);
  assert.equal(back.name, 'releve-tickets');
  assert.equal(back.description, GOOD.description);
  assert.ok(back.body.startsWith(GOOD.prompt));
  assert.ok(back.body.endsWith(L.SAFETY_FOOTER));
  assert.deepEqual(L.outboundSentences(L.SAFETY_FOOTER), [], 'the footer itself passes the guard');
  assert.equal(L.parseSkill(GMAIL_TASK).name, 'gmail-inbox-auto-drafts');
  assert.equal(L.parseSkill('pas de frontmatter').body, 'pas de frontmatter');
});

test('creationRequest / deepLink: exact parameters, prompt verbatim, safe URL', () => {
  const s = { ...GOOD, taskId: 'releve-tickets' };
  const req = L.creationRequest(s);
  assert.match(req, /create_scheduled_task/);
  assert.match(req, /"taskId": "releve-tickets"/);
  assert.match(req, /"cronExpression": "30 8 \* \* 1"/);
  assert.match(req, /list_scheduled_tasks/);
  const body = req.split('<<<PROMPT\n')[1].split('\nPROMPT>>>')[0];
  assert.equal(body, L.finalPrompt(GOOD.prompt));
  const url = L.deepLink(req, 'C:\\Users\\camille\\Documents\\HelpDesk');
  assert.ok(url.startsWith('claude://code/new?q='));
  assert.ok(!/[\s"]/.test(url), 'no raw space or quote: one argv entry');
  const u = new URL(url);
  assert.equal(u.searchParams.get('q'), req);
  assert.equal(u.searchParams.get('folder'), 'C:\\Users\\camille\\Documents\\HelpDesk');
  assert.ok(req.length < 14000, 'under Claude Desktop’s cap');
});

test('creationStatus: found, waiting, given up', () => {
  const s = { cron: '30 8 * * 1', launchedAt: NOW.getTime() - 5 * L.MIN };
  assert.equal(L.creationStatus(s, null, NOW).status, 'launched');
  assert.equal(L.creationStatus(s, { cron: '35 8 * * 1' }, NOW).cron, '35 8 * * 1');
  assert.equal(L.creationStatus({ ...s, launchedAt: NOW.getTime() - 30 * L.MIN }, null, NOW).status, 'unconfirmed');
});

// ── When, and what is observed ─────────────────────────────────────────────

test('dueNow: working days after the hour, once, not in a call, not when full', () => {
  const S = { cadence: 'jour', at: '11:45' };
  assert.equal(L.dueNow(NOW, S, {}), true);
  assert.equal(L.dueNow(new Date(2026, 9, 12, 11, 30), S, {}), false);
  assert.equal(L.dueNow(NOW, S, {}, { inCall: true }), false);
  assert.equal(L.dueNow(NOW, S, { lastRun: NOW.getTime() - 3600000 }), false);
  assert.equal(L.dueNow(new Date(2026, 9, 11, 12, 0), S, {}), false, 'Sunday');
  assert.equal(L.dueNow(NOW, { ...S, cadence: 'manuel' }, {}), false);
  assert.equal(L.dueNow(new Date(2026, 9, 13, 12, 0), { ...S, cadence: 'semaine' }, {}), false, 'weekly: Mondays');
  assert.equal(L.dueNow(NOW, S, { suggestions: [{ status: 'new' }, { status: 'new' }, { status: 'launched' }] }), false);
});

test('firstPrompt: the real request, without app context, scheduled runs and sidechains skipped', () => {
  const line = (o) => JSON.stringify(o);
  assert.equal(
    L.firstPrompt([
      line({ type: 'summary' }),
      line({ type: 'user', isMeta: true, message: { content: 'meta' } }),
      line({ type: 'user', timestamp: '2026-10-09T09:32:30Z', cwd: 'C:\\x\\HelpDesk', message: { content: '<system-reminder>worktree</system-reminder>\nliste les tickets ouverts' } }),
    ]).text,
    'liste les tickets ouverts',
  );
  assert.equal(L.firstPrompt([line({ type: 'user', message: { content: '<scheduled-task name="x">run</scheduled-task>' } })]), null);
  assert.equal(L.firstPrompt([line({ type: 'user', isSidechain: true, message: { content: 'agent' } })]), null);
  assert.equal(
    L.firstPrompt([
      line({ type: 'user', message: { content: [{ type: 'text', text: '<ide_opened_file>f</ide_opened_file>' }] } }),
      line({ type: 'user', message: { content: [{ type: 'image' }, { type: 'text', text: 'ajoute le prix moyen' }] } }),
    ]).text,
    'ajoute le prix moyen',
  );
});

test('recurrences: same sender and subject shape, digits ignored', () => {
  const at = (d) => new Date(2026, 9, d).getTime();
  const r = L.recurrences({
    mail: [
      { from: 'HelpDesk <support@olympe.example>', title: 'Ticket 1234 en attente', at: at(1), done: true },
      { from: 'HelpDesk <support@olympe.example>', title: 'Ticket 5678 en attente', at: at(5), done: true },
      { from: 'Maud', title: 'Revue des ventes', at: at(9) },
    ],
    clickup: [{ from: 'Julie', title: 'Recette', at: at(2), verdict: 'noise' }, { from: 'Julie', title: 'Recette', at: at(3), verdict: 'noise' }],
  });
  assert.equal(r.length, 2);
  assert.equal(r[0].count, 2);
  assert.equal(r.find((g) => g.module === 'mail').done, 2);
  assert.equal(r.find((g) => g.module === 'clickup').noise, 2);
});

test('buildPrompt: read steps per connector, data delimited, existing and refused listed', () => {
  const p = L.buildPrompt({
    now: NOW,
    connectors: { gmail: 'claude.ai Gmail', calendar: 'claude.ai Google Calendar' },
    local: { sessionsClaude: [{ day: '2026-10-05', project: 'HelpDesk', prompt: 'liste les tickets' }] },
    existing: [{ id: 'gmail-inbox-auto-drafts', description: 'brouillons' }],
    refused: [{ title: 'Relance fournisseurs' }],
    selfEmail: 'n@example.com',
    room: 2,
  });
  assert.match(p, /in:sent newer_than:21d/);
  assert.match(p, /list_events/);
  assert.doesNotMatch(p, /clickup_filter_tasks avec/);
  assert.match(p, /<<<DONNEES_AMBROSIA[\s\S]*liste les tickets[\s\S]*DONNEES_AMBROSIA>>>/);
  assert.match(p, /gmail-inbox-auto-drafts/);
  assert.match(p, /refusé : « Relance fournisseurs »/);
  assert.match(p, /au plus 2 tâches/);
  const tools = L.readAllowedTools({ gmail: 'claude.ai Gmail', clickup: 'claude.ai ClickUp' }, (n) => `mcp__${n.replace(/[^\w-]/g, '_')}__`);
  assert.ok(tools.includes('mcp__claude_ai_Gmail__search_threads'));
  assert.ok(tools.every((t) => !L.toolProblem(t)), 'only read tools in the analysis');
});

// ── Disk reads (scratch folder) ────────────────────────────────────────────

test('readExistingTasks: SKILL.md + the app registry, state folders reserved', () => {
  const tasksDir = path.join(tmp, 'home', '.claude', 'scheduled-tasks');
  fs.mkdirSync(path.join(tasksDir, 'gmail-inbox-auto-drafts'), { recursive: true });
  fs.writeFileSync(path.join(tasksDir, 'gmail-inbox-auto-drafts', 'SKILL.md'), GMAIL_TASK);
  fs.mkdirSync(path.join(tasksDir, 'helpdesk-agenda-digest'), { recursive: true }); // state only
  const regDir = path.join(tmp, 'roaming', 'Claude', 'claude-code-sessions', 'acc', 'org');
  fs.mkdirSync(regDir, { recursive: true });
  fs.writeFileSync(path.join(regDir, 'scheduled-tasks.json'), JSON.stringify({ scheduledTasks: [{ id: 'gmail-inbox-auto-drafts', cronExpression: '51 8,14 * * 1-5', enabled: true, cwd: tmp }] }));
  const { tasks, ids } = src.readExistingTasks();
  assert.deepEqual(ids.sort(), ['gmail-inbox-auto-drafts', 'helpdesk-agenda-digest']);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].cron, '51 8,14 * * 1-5');
  assert.equal(tasks[0].registered, true);
  assert.equal(src.usualTaskFolder(tasks), tmp);
});

test('readClaudeHistory: recent user sessions only', () => {
  const projects = path.join(tmp, 'home', '.claude', 'projects');
  const write = (dir, name, content) => {
    fs.mkdirSync(path.join(projects, dir), { recursive: true });
    fs.writeFileSync(path.join(projects, dir, name), content.map((o) => JSON.stringify(o)).join('\n'));
  };
  const ts = new Date(NOW.getTime() - 2 * L.DAY).toISOString();
  write('C--Users-n-Documents-HelpDesk', 'a.jsonl', [{ type: 'user', timestamp: ts, cwd: 'C:\\Users\\n\\Documents\\HelpDesk', message: { content: 'liste les tickets ouverts' } }]);
  write('C--Users-n-Documents-HelpDesk', 'b.jsonl', [{ type: 'user', timestamp: ts, message: { content: '<scheduled-task name="x">…</scheduled-task>' } }]);
  write('C--Users-n-AppData-Local-Ambrosia-work', 'c.jsonl', [{ type: 'user', timestamp: ts, message: { content: 'internal' } }]);
  write('C--Users-n-Documents-ambrosia--claude-worktrees-agent-abc', 'd.jsonl', [{ type: 'user', timestamp: ts, message: { content: 'agent task' } }]);
  const h = src.readClaudeHistory({ now: NOW });
  assert.deepEqual(h.map((x) => x.prompt), ['liste les tickets ouverts']);
  assert.equal(h[0].project, 'HelpDesk');
});

// ── The module, with a fake CLI and a fake Claude Desktop ─────────────────

test('module: analyze → suggestion → edit, frequency, create (deep link), confirm, refuse', async () => {
  const opened = [];
  src.openInDesktop = async (url) => (opened.push(url), { ok: true, via: 'fake' });
  const def = require('../src/modules/routines/main');
  const h = { state: {}, actions: new Map(), alerts: [], reacts: [], calls: [] };
  let data;
  const ctx = {
    log() {},
    claude: {
      mcpPrefix: (n) => `mcp__${n.replace(/[^a-zA-Z0-9_-]/g, '_')}__`,
      run: async (o) => {
        h.calls.push(o);
        return { ok: true, structured: { suggestions: [GOOD, { ...GOOD, titre: 'Relance automatique', description: 'Relance', prompt: 'Envoie la relance.' }] } };
      },
      authStatus: async () => ({ loggedIn: true }),
      listMcp: async () => [],
    },
    settings: () => ({ auto: true, cadence: 'jour', at: '11:45', days: 21, useClaude: true, useAmbrosia: true, useMail: true, useCalendar: false, useClickup: false, useChat: false, model: 'sonnet', taskFolder: '' }),
    onSettings() {},
    data: { load: (fb) => (data ||= fb), save: (v) => (data = v) },
    setState: (p) => Object.assign(h.state, p),
    peers: () => ({ agenda: { selfName: 'Camille' } }),
    alert: (a) => h.alerts.push(a),
    dismissAlert() {},
    react: (...a) => h.reacts.push(a),
    activity: () => ({ idleMs: 0 }),
    inCall: () => false,
    focus() {},
    paused: () => false,
    openExternal: () => assert.fail('no shell link in tests'),
    openPath() {},
    onAction: (n, fn) => h.actions.set(n, fn),
  };
  def.init.call(def, ctx);
  const act = (n, p) => h.actions.get(n)(p || {});
  try {
    assert.equal(await act('analyze'), true);
    const call = h.calls[0];
    assert.deepEqual(call.allowedTools, ['mcp__claude_ai_Gmail__search_threads', 'mcp__claude_ai_Gmail__get_thread']);
    assert.equal(call.requireMcp, 'claude.ai Gmail');
    assert.match(call.prompt, /liste les tickets ouverts/, 'Claude Code history passed as data');
    assert.match(call.prompt, /gmail-inbox-auto-drafts/, 'existing tasks listed');
    assert.equal(h.state.suggestions.length, 1, 'the outbound one was dropped');
    const s = h.state.suggestions[0];

    // Edit the prompt, change the frequency
    await act('edit', { id: s.id, prompt: GOOD.prompt + '\nAjoute les tickets de plus de 7 jours.' });
    assert.deepEqual(await act('setCron', { id: s.id, rhythm: 'workdays', time: '08:15' }), { ok: true });
    assert.equal(h.state.suggestions[0].frequence, 'Du lundi au vendredi à 8 h 15');
    assert.equal((await act('setCron', { id: s.id, cron: '* * * * *' })).ok, false);

    // A forbidden edit is refused, nothing opens
    const no = await act('create', { id: s.id, prompt: GOOD.prompt + '\nEnvoie ensuite le résumé à Sophie.' });
    assert.equal(no.ok, false);
    assert.equal(opened.length, 0);

    // The real click
    const yes = await act('create', { id: s.id, prompt: GOOD.prompt + '\nAjoute les tickets de plus de 7 jours.' });
    assert.equal(yes.ok, true);
    assert.equal(opened.length, 1);
    const req = new URL(opened[0]).searchParams.get('q');
    assert.match(req, /"cronExpression": "15 8 \* \* 1-5"/);
    assert.match(req, /Ajoute les tickets de plus de 7 jours\./);
    assert.equal(h.state.suggestions[0].status, 'launched');

    // The app writes the SKILL.md → confirmed
    const dir = path.join(tmp, 'home', '.claude', 'scheduled-tasks', s.taskId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), L.buildSkillMd({ taskId: s.taskId, description: s.description, prompt: s.prompt }));
    await act('create', { id: s.id }); // a second click while launched just re-checks
    assert.equal(h.state.suggestions.length, 0);
    assert.equal(h.state.created[0].taskId, s.taskId);
    assert.equal(data.memory[0].outcome, 'created');

    // Next analysis: the same suggestion is never made again
    h.calls.length = 0;
    await act('analyze');
    assert.equal(h.state.suggestions.length, 0);
    assert.match(h.calls[0].prompt, new RegExp(s.taskId), 'the new task is now an existing one');

    // Refusal is remembered
    ctx.claude.run = async () => ({ ok: true, structured: { suggestions: [{ ...GOOD, titre: 'Synthèse hebdo des demandes boutiques', description: 'Résume les demandes boutiques' }] } });
    await act('analyze');
    const t = h.state.suggestions[0];
    assert.equal(await act('refuse', { id: t.id }), true);
    await act('analyze');
    assert.equal(h.state.suggestions.length, 0);
    assert.equal(data.memory[0].outcome, 'refused');
    assert.match(await act('forgetRefused'), /1 refus/);
  } finally {
    def.dispose();
  }
});
