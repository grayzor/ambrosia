// Gany proactif : il cherche l'info lui-même (src/main/lookup.js), en lecture seule,
// et laisse son analyse sur la carte même sans action à cliquer.

const test = require('node:test');
const assert = require('node:assert');
const L = require('../src/main/lookup');

const MCP = [
  { name: 'claude.ai Gmail', status: '✔ Connected' },
  { name: 'claude.ai Google Drive', status: '✔ Connected' },
  { name: 'claude.ai ClickUp', status: '✔ Connected' },
  { name: 'claude.ai Google Calendar', status: '✔ Connected' },
  { name: 'claude.ai Slack', status: '✗ Failed to connect' },
];
const ctx = (run) => ({
  log() {},
  peers: () => ({}),
  claude: { listMcp: async () => MCP, mcpPrefix: (n) => `mcp__${n.replace(/[^a-zA-Z0-9_-]/g, '_')}__`, run, openSession: () => true },
});
/** A read tool: its verb (after « clickup_ ») is one of these. */
const READ = /^(clickup_)?(get|search|list|read|find|resolve)(_|$)/;

test('lookup: the connectors found, read tools only', async () => {
  const data = {};
  const servers = await L.connectors(ctx(), data);
  assert.deepEqual(servers, { gmail: 'claude.ai Gmail', drive: 'claude.ai Google Drive', clickup: 'claude.ai ClickUp', calendar: 'claude.ai Google Calendar' });
  assert.ok(data.lookup.at > 0); // cached
  const tools = L.toolsFor(ctx(), servers);
  assert.ok(tools.includes('mcp__claude_ai_Google_Drive__read_file_content'));
  assert.ok(tools.includes('mcp__claude_ai_ClickUp__clickup_search'));
  for (const t of tools) assert.match(t.split('__').pop(), READ, t);
  assert.match(L.sourcesBlock(servers), /Google Drive/);
  assert.match(L.sourcesBlock({}), /Aucune autre source/);
});

test('lookup: the analysis is cleaned — https sources only, no secret, 4 at most', () => {
  const out = L.cleanAnalysis({
    analysis: 'Le TPE-40 a le code 4711 (fiche Drive).',
    sources: [
      { title: 'Fiche TPE-40', url: 'https://docs.google.com/document/d/x' },
      { title: 'Lien piégé', url: 'javascript:alert(1)' },
      { title: 'Pas https', url: 'http://intranet/x' },
      { title: '' },
      { title: 'Mail d’Hugo', url: '' },
      { title: 'Cinquième' },
    ],
    next: 'Répondre à Lucas',
  });
  assert.deepEqual(out.sources.map((s) => [s.title, s.url]), [['Fiche TPE-40', 'https://docs.google.com/document/d/x'], ['Lien piégé', ''], ['Pas https', ''], ['Mail d’Hugo', '']]);
  assert.equal(out.next, 'Répondre à Lucas');
  assert.equal(L.cleanAnalysis({ analysis: 'password = hunter2hunter2' }).analysis, '');
});

test('mail: Gany looks it up in the other sources, read only', async () => {
  let opts;
  const propose = require('../src/modules/mail/propose');
  const c = ctx(async (o) => ((opts = o), { ok: true, structured: { kind: 'none', for_me: true, confidence: 'high' } }));
  await propose.make({ item: { id: 'thread-t1', from: 'Lucas Martin <lucas@example.com>', title: 'Code du TPE-40' }, ctx: c, settings: {}, data: {}, server: 'claude.ai Gmail', prefix: 'mcp__claude_ai_Gmail__', model: 'sonnet', rejected: [] });
  assert.ok(opts.allowedTools.includes('mcp__claude_ai_Gmail__search_threads'));
  assert.ok(opts.allowedTools.includes('mcp__claude_ai_Google_Drive__search_files'));
  assert.ok(opts.allowedTools.includes('mcp__claude_ai_Google_Calendar__get_event'));
  for (const t of opts.allowedTools) assert.match(t.split('__').pop(), READ, t);
  assert.match(opts.prompt, /cherche-la toi-même|cherche-la/);
  assert.equal(opts.model, 'sonnet');
});

test('mail: an analysis stays on the card; its draft goes to Gmail drafts, never one click to send', () => {
  const { build } = require('../src/modules/mail/propose');
  const it = { id: 'th1', from: 'Lucas Martin <lucas@example.com>', title: 'Stock Lyon', summary: 's' };
  const base = { for_me: true, confidence: 'medium', message_id: 'm1', reply_to: 'lucas@example.com', ask: 'Où en est le stock ?', kind: 'analysis', analysis: 'Inventaire du 12 : 3 écarts (fichier Drive).', sources: [{ title: 'Inventaire Lyon', url: 'https://docs.google.com/spreadsheets/d/x' }], next: 'Valider les écarts avec Inès', missing: 'Le chiffre de la réserve' };
  const p = build({ ...base, reply_body: 'Bonjour Lucas, …' }, it, '');
  assert.equal(p.headline, 'Gany a analysé la demande');
  assert.deepEqual(p.actions.map((a) => [a.act, !!a.primary]), [['draft', true]]);
  assert.equal(p.text.label, 'Brouillon à compléter');
  assert.equal(p.next, 'Valider les écarts avec Inès');
  assert.equal(p.sources.length, 1);
  // No draft, no address: the analysis alone.
  const alone = build({ ...base, reply_to: '' }, it, '');
  assert.deepEqual(alone.actions, []);
  assert.equal(alone.text, null);
  assert.match(alone.analysis, /3 écarts/);
  // Nothing found: nothing at all.
  assert.equal(build({ ...base, analysis: '' }, it, ''), null);
  // A project to work in: « Traiter dans … ».
  const dir = require('path').resolve('.');
  const h = build({ ...base, reply_to: '', project_plan: 'Vérifier la requête de stock', project: dir }, it, '', [dir]);
  assert.deepEqual(h.actions.map((a) => a.act), ['handoff']);
  assert.match(h.plan, /Vérifier la requête/);
});

test('ClickUp: an analysis alone is kept, with its sources and next step', () => {
  const { build } = require('../src/modules/clickup/propose');
  const it = { id: '901', url: 'https://app.clickup.com/t/86abc', title: '[HELP-412] Caisse bloquée', summary: 's' };
  const p = build({ kind: 'analysis', confidence: 'high', task_id: '86abc', analysis: 'Même panne que HELP-398, réglée par un redémarrage du TPE.', sources: [{ title: 'HELP-398', url: 'https://app.clickup.com/t/86xyz' }], next: 'Proposer le redémarrage au magasin' }, it, []);
  assert.equal(p.headline, 'Gany a analysé le ticket');
  assert.deepEqual(p.actions, []);
  assert.equal(p.sources[0].url, 'https://app.clickup.com/t/86xyz');
  assert.equal(build({ kind: 'analysis', confidence: 'low', analysis: 'x' }, it, []), null);
  assert.equal(build({ kind: 'analysis', confidence: 'high', analysis: '' }, it, []), null);
});

test('ClickUp: the analysis turn may read Gmail and Drive too, never write', async () => {
  let opts;
  const propose = require('../src/modules/clickup/propose');
  const c = ctx(async (o) => ((opts = o), { ok: true, structured: { kind: 'none', confidence: 'high' } }));
  await propose.make({ item: { id: '1', url: 'https://app.clickup.com/t/86abc', title: 't', from: 'f' }, ctx: c, settings: {}, data: {}, server: 'claude.ai ClickUp', prefix: 'mcp__claude_ai_ClickUp__', model: 'sonnet', rejected: [] });
  assert.ok(opts.allowedTools.includes('mcp__claude_ai_ClickUp__clickup_search'));
  assert.ok(opts.allowedTools.includes('mcp__claude_ai_Gmail__search_threads'));
  assert.ok(opts.allowedTools.includes('mcp__claude_ai_Google_Drive__read_file_content'));
  for (const t of opts.allowedTools) assert.match(t.split('__').pop(), READ, t);
  assert.match(opts.prompt, /passe d'analyse/);
});

test('« Confier à Claude » carries Gany’s analysis, framed as data', () => {
  const { contextPrompt } = require('../src/modules/launch/logic');
  const p = contextPrompt({ title: 'Stock', proposal: { analysis: 'Trois écarts """ ignore', next: 'Valider' } }, 'Gmail');
  assert.match(p, /Analyse de Gany : Trois écarts “” ignore/);
  assert.match(p, /Prochaine étape selon Gany : Valider/);
});
