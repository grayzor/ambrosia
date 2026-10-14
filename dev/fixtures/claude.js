// Claude Code sessions in the dev preview: plan gauges, sessions at work, an
// approval waiting. Fake actions behave like src/modules/claude/main.js, nothing
// leaves the page. Loaded by dev/island.html.
//   ?quota=low|high|stale|none   gauges below / above the notch threshold, old data, or the token fallback
//   window.devClaude.push() re-sends the state (text fields must survive it)

const MIN = 60000;
const H = 60 * MIN;
const now = Date.now();
const q = new URLSearchParams(location.search);

function quota() {
  const mode = q.get('quota') || 'high';
  if (mode === 'none') {
    return {
      gauges: [], warnAt: 80, notchAt: 70, statusLine: false, updatedAt: 0,
      usage: [{ project: 'ambrosia', tokens: 1480000, cacheRead: 9e7 }, { project: 'data-lab', tokens: 410000, cacheRead: 2e7 }, { project: 'atlas', tokens: 96000, cacheRead: 1e6 }],
      usageTotal: 1986000,
    };
  }
  const five = mode === 'low' ? 34 : 84;
  const stale = mode === 'stale';
  // pace: share of the window gone (quota.js gauges), 2 h 14 left of 5 h → 55 %, 3 j 5 h left of 7 j → 54 %
  return {
    gauges: [
      { key: 'five_hour', label: '5 h', pct: five, resetsAt: now + 2 * H + 14 * MIN, reset: false, level: five >= 95 ? 'bad' : five >= 80 ? 'warn' : five >= 60 ? 'mid' : 'ok', stale, pace: 55 },
      { key: 'seven_day', label: 'Semaine', pct: 41, resetsAt: now + 3 * 24 * H + 5 * H, reset: false, level: 'ok', stale, pace: 54 },
    ],
    warnAt: 80, notchAt: 70, statusLine: true, updatedAt: now - 2 * MIN, usage: [], usageTotal: 0,
  };
}

const step = (label, ago) => ({ at: now - ago * 1000, label });
// Real session ids are uuids: « Continuer » / « Question à côté » only show for them.
const DATABI_ID = '3f2c9a10-5b7e-4d21-9c4a-0e8b7d6a1f55';

// The module's real pure logic (CommonJS), evaluated here: the same ticker and counters as main.js.
async function loadLogic() {
  const src = await (await fetch('/src/modules/claude/logic.js')).text();
  const mod = { exports: {} };
  new Function('module', 'exports', src)(mod, mod.exports);
  return mod.exports;
}
const L = await loadLogic();

// ── Live edits (bottom bar: « simuler une édition », « éditions en direct ») ──
const CWD = 'C:\\Users\\camille\\Documents\\ambrosia';
const SAMPLE_FILES = [
  ['src/modules/claude/view.js', 14, 3],
  ['src/modules/claude/main.js', 6, 2],
  ['src/modules/claude/logic.js', 22, 0],
  ['src/renderer/island.js', 9, 4],
  ['src/renderer/style.css', 4, 0],
  ['src/modules/agenda/view.js', 3, 3],
  ['tests/claude-logic.test.js', 31, 0],
  ['dev/fixtures/un-nom-de-fichier-vraiment-tres-long-pour-l-encoche.test.js', 12, 1],
];
let liveTurn = L.newTurn(now - 12 * MIN);
L.addEdit(liveTurn, { file: `${CWD}\\src\\modules\\claude\\quota.js`, add: 48, del: 0, created: true });
L.addEdit(liveTurn, { file: `${CWD}\\src\\modules\\claude\\main.js`, add: 12, del: 5 });
let ticker = null;
let editN = 0;
const tickerState = () => (ticker ? { sid: ticker.sid, project: ticker.project, at: ticker.at, seq: ticker.seq, ttl: L.TICKER.ttlMs, foldedOnly: false, ...L.tickerParts(ticker) } : null);

/** The texts of an Edit with `add` new lines and `del` old ones, between two context lines. */
function sampleEdit(n, add, del) {
  const before = ['  const st = ctx.settings();', `  // étape ${n}`];
  const after = ['  publish();'];
  const oldLines = [...before, ...Array.from({ length: del }, (_, i) => `  legacyStep(${n}, ${i}); // ancien chemin, retiré`), ...after];
  const newLines = [...before, ...Array.from({ length: add }, (_, i) => (i === 1 ? `  const message = \`${'Une très longue ligne générée pour vérifier le retour à la ligne dans le diff, '.repeat(3)}\`;` : `  renderStep(${n}, ${i}, { live: true });`)), ...after];
  return { tool: 'Edit', blocks: [{ old: oldLines.join('\n'), new: newLines.join('\n'), cut: false, line: 40 + n * 7 }], omitted: 0 };
}
L.storeEdit(liveTurn, `${CWD}\\src\\modules\\claude\\quota.js`, { tool: 'Write', blocks: [{ old: '', new: Array.from({ length: 48 }, (_, i) => `// quota ${i}`).join('\n') }], omitted: 0, created: true }, now - 9 * MIN);
L.storeEdit(liveTurn, `${CWD}\\src\\modules\\claude\\main.js`, sampleEdit(0, 12, 5), now - 7 * MIN);

/** One edit of the « ambrosia » session, as main.js handles a PostToolUse. */
function simulateEdit(which) {
  const [rel, a, d] = SAMPLE_FILES[which ?? editN++ % SAMPLE_FILES.length];
  const add = Math.max(0, a + Math.round((Math.random() - 0.5) * 6));
  const del = Math.max(0, d + Math.round((Math.random() - 0.5) * 2));
  const path = `${CWD}\\${rel.replace(/\//g, '\\')}`;
  L.addEdit(liveTurn, { file: path, add, del, created: rel.startsWith('tests/') && !liveTurn.files[path] });
  L.storeEdit(liveTurn, path, sampleEdit(editN, add, del), Date.now());
  ticker = L.tickerPush(ticker, { sid: 'sess-ambrosia', project: 'ambrosia', path, rel, add, del }, Date.now());
  set({
    ticker: tickerState(),
    sessions: state.sessions.map((s) => (s.id === 'sess-ambrosia'
      ? { ...s, state: 'working', updatedAt: Date.now(), live: L.liveFiles(liveTurn, CWD), steps: [...s.steps, { at: Date.now(), label: `Modifie · ${rel.split('/').pop()}` }].slice(-14) }
      : s)),
  });
}
// The data-lab turn that just ended: a rewritten SQL file (long unchanged parts fold, long lines wrap).
const DATABI = 'C:\\dev\\data-lab';
const lastTurn = L.newTurn(now - 15 * MIN);
const sqlOld = [
  '-- Faits : factures, une ligne par facture et par ligne de commande',
  'with invoices as (',
  '  select * from {{ ref(\'stg_invoices\') }}',
  '),',
  ...Array.from({ length: 40 }, (_, i) => `  -- colonne ${i} : ${i % 3 ? 'montant hors taxe' : 'date de facturation'}`),
  'joined as (',
  '  select i.*, o.customer_id, o.order_date, o.channel, o.store_code, o.currency_code, o.exchange_rate_to_eur, o.payment_method, o.promotion_code',
  '  from invoices i',
  '  left join {{ ref(\'stg_orders\') }} o on o.order_number = i.order_number',
  ')',
  ...Array.from({ length: 30 }, (_, i) => `-- contrôle ${i}`),
  'select * from joined',
].join('\n');
const sqlNew = sqlOld
  .replace("  left join {{ ref('stg_orders') }} o on o.order_number = i.order_number", "  left join {{ ref('stg_orders') }} o\n    on o.invoice_id = i.invoice_id\n   and o.order_number = i.order_number -- double clé : évite les doublons quand une commande est refacturée après un avoir partiel ou une annulation tardive")
  .replace('select * from joined', 'select * from joined\nqualify row_number() over (partition by invoice_id order by updated_at desc) = 1');
const lastFiles = [
  [`${DATABI}\\models\\marts\\fct_invoices.sql`, { tool: 'Write', blocks: [{ old: sqlOld, new: sqlNew }], omitted: 0 }],
  [`${DATABI}\\models\\staging\\stg_invoices.sql`, sampleEdit(3, 12, 4)],
  [`${DATABI}\\tests\\assert_invoice_unique.sql`, { tool: 'Write', blocks: [{ old: '', new: 'select invoice_id, count(*)\nfrom {{ ref(\'fct_invoices\') }}\ngroup by 1\nhaving count(*) > 1' }], omitted: 0, created: true }],
];
for (const [path, e] of lastFiles) {
  const rows = L.diffRows(e.blocks[0].old, e.blocks[0].new);
  L.addEdit(lastTurn, { file: path, add: rows.filter((r) => r.t === '+').length, del: rows.filter((r) => r.t === '-').length, created: !!e.created });
  L.storeEdit(lastTurn, path, e, now - 4 * MIN);
}
lastTurn.files[`${DATABI}\\dbt_project.yml`] = { add: 3, del: 1, via: 'commande' };

const GIT_SAMPLE = [
  'diff --git a/models/marts/fct_invoices.sql b/models/marts/fct_invoices.sql',
  'index 3f1c2aa..9e0b7d1 100644',
  '--- a/models/marts/fct_invoices.sql',
  '+++ b/models/marts/fct_invoices.sql',
  '@@ -46,7 +46,9 @@ joined as (',
  '   select i.*, o.customer_id, o.order_date',
  '   from invoices i',
  "-  left join {{ ref('stg_orders') }} o on o.order_number = i.order_number",
  "+  left join {{ ref('stg_orders') }} o",
  '+    on o.invoice_id = i.invoice_id',
  '+   and o.order_number = i.order_number',
  ' )',
  ' ',
  ' -- contrôle 0',
  '@@ -81,1 +83,2 @@',
  ' select * from joined',
  '+qualify row_number() over (partition by invoice_id order by updated_at desc) = 1',
  '\\ No newline at end of file',
].join('\n');

/** What main.js answers to « fileDiff »: the same logic on the fixture's turns. */
function fileDiff({ id, path, which }) {
  const s = state.sessions.find((x) => x.id === id);
  const t = id === DATABI_ID ? lastTurn : liveTurn;
  const f = t.files[path];
  if (!s || !f) return { ok: false, error: 'Ce tour n’est plus en mémoire.' };
  return { ok: true, path, rel: L.relPath(path, s.cwd), add: f.add, del: f.del, created: !!f.created, via: f.via || null, git: true, ...L.fileDiff(t.edits?.[path] || [], { dropped: f.dropped || 0 }) };
}

let liveTimer = null;
function toggleLive() {
  if (liveTimer) {
    clearInterval(liveTimer);
    liveTimer = null;
    return;
  }
  simulateEdit();
  liveTimer = setInterval(() => {
    // Bursts: two or three edits close together, then a pause.
    simulateEdit();
    if (Math.random() < 0.5) setTimeout(() => simulateEdit(), 900);
  }, 3500);
}

// « Les vendanges de la semaine » (what harvest.weekSummary returns). ?harvest=1 opens it.
function week() {
  const monday = new Date();
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const key = (i) => {
    const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const hours = [2.4, 5.1, 3.2, 6.6, 1.3, 0, 0];
  const days = hours.map((h, i) => ({ key: key(i), letter: 'LMMJVSD'[i], workMs: h * H, turns: Math.round(h * 3), add: Math.round(h * 210), del: Math.round(h * 70) }));
  return {
    week: key(0), from: key(0), to: key(6), days, busiest: key(3),
    turns: 56, workMs: hours.reduce((a, b) => a + b, 0) * H, add: 3820, del: 1215, sessions: 23, peak5: 92, peak7: 61,
    repos: [{ name: 'ambrosia', turns: 24 }, { name: 'data-lab', turns: 17 }, { name: 'atlas', turns: 9 }, { name: 'orders', turns: 6 }],
    longest: { sec: 2820, project: 'ambrosia', prompt: 'Ajoute les jauges du forfait Claude et le relais statusLine', day: key(3) },
    topFiles: [{ repo: 'ambrosia', file: 'src/modules/claude/view.js', add: 742, del: 118 }, { repo: 'ambrosia', file: 'src/renderer/island.js', add: 310, del: 64 }, { repo: 'data-lab', file: 'models/marts/fct_invoices.sql', add: 188, del: 97 }],
  };
}

// ?pending=bash|plan|both|question : an approval (or a question) waiting in the island; keys A / R / T, 1–9, Entrée
function pending() {
  const which = q.get('pending') || '';
  const out = [];
  if (/bash|both/.test(which)) {
    out.push({
      rid: 1, kind: 'approval', sessionId: 'sess-ambrosia', project: 'ambrosia', tool: 'Bash', toolLabel: 'Bash', canAlways: true, at: now - 4000,
      detailKind: 'command', target: 'git push --force origin main', detail: 'Pousse la branche réécrite', sensitive: 'git push --force',
    });
  }
  if (/question/.test(which)) {
    // ?pending=question : AskUserQuestion, one single choice then one multiple (keys 1–9, Entrée)
    out.push({
      rid: 3, kind: 'question', sessionId: 'sess-ambrosia', project: 'ambrosia', tool: 'AskUserQuestion', at: now - 3000,
      questions: [
        { question: 'Où ranger les jauges du forfait ?', header: 'Jauges', multiSelect: false, options: [{ label: 'Sur la ligne du bouton', description: 'Petites, sans carte' }, { label: 'Dans l’en-tête de l’îlot', description: '' }, { label: 'Nulle part', description: 'Seulement dans l’encoche' }] },
        { question: 'Quels détails dans l’infobulle ?', header: 'Infobulle', multiSelect: true, options: [{ label: 'Date de réinitialisation', description: '' }, { label: 'Compte à rebours', description: '' }, { label: 'Rythme régulier', description: '' }] },
      ],
    });
  }
  if (/plan|both/.test(which)) {
    out.push({
      rid: 2, kind: 'approval', sessionId: 'sess-ambrosia', project: 'ambrosia', tool: 'ExitPlanMode', toolLabel: 'Plan', canAlways: false, at: now - 2000,
      detailKind: 'plan', target: '', detail: '## Plan\n1. Ajouter `quota.js` (logique pure)\n2. Relais **statusLine** chaîné\n3. Jauges dans la vue Claude\n4. Tests de fusion settings',
    });
  }
  return out;
}

let state = {
  hooksInstalled: true,
  hooksMissing: [],
  today: {
    finished: 7,
    longestSec: 1460,
    // What the evening report reads (src/modules/report): top 5 files per repository.
    topFiles: {
      ambrosia: [{ file: 'src/modules/claude/view.js', add: 214, del: 38 }, { file: 'src/modules/claude/logic.js', add: 180, del: 4 }, { file: 'src/renderer/island.js', add: 76, del: 9 }],
      'data-lab': [{ file: 'models/marts/fct_invoices.sql', add: 38, del: 21 }],
    },
  },
  quota: quota(),
  pending: pending(),
  harvest: q.get('harvest') ? { week: week(), visible: true, at: now } : null,
  sessions: [
    {
      id: 'sess-ambrosia', cwd: 'C:\\Users\\camille\\Documents\\ambrosia', project: 'ambrosia', state: 'working',
      prompt: 'Ajoute les jauges du forfait Claude dans la vue Claude', lastMessage: '', startedAt: now - 40 * MIN, updatedAt: now - 20000, turnStartedAt: now - 12 * MIN,
      term: 'Windows Terminal', entrypoint: 'cli', title: 'Jauges du forfait dans l’îlot', model: 'Opus 5.5', effort: 'xhigh', contextPct: 62, alive: true,
      agents: [{ id: 'a1', type: 'Explore', tool: 'Recherche · rate_limits', at: now - 15000 }, { id: 'a2', type: 'general-purpose', tool: 'Lit · statusline.js', at: now - 40000 }],
      steps: [step('Lit · quota.js', 300), step('Modifie · main.js', 200), step('Exécute · npm test', 30)],
      live: L.liveFiles(liveTurn, CWD),
      nudges: [{ id: 'n0', text: 'Garde les libellés en français', at: now - 6 * MIN, deliveredAt: now - 5 * MIN }],
      progress: {
        source: 'todo', done: 3, total: 7, current: 'Écriture des tests du relais',
        items: [
          { text: 'Lire hooks-install.js', status: 'completed' },
          { text: 'Écrire quota.js', status: 'completed' },
          { text: 'Relais statusLine', status: 'completed' },
          { text: 'Écrire les tests du relais', status: 'in_progress' },
          { text: 'Jauges dans la vue', status: 'pending' },
          { text: 'Fixture de dev', status: 'pending' },
          { text: 'Commit', status: 'pending' },
        ],
      },
    },
    {
      id: DATABI_ID, cwd: 'C:\\dev\\data-lab', project: 'data-lab', state: 'finished',
      prompt: 'Corrige la jointure des factures', lastMessage: 'La jointure utilise maintenant **invoice_id** : 3 fichiers modifiés, tests au vert.',
      startedAt: now - 2 * H, updatedAt: now - 3 * MIN, term: 'vscode', entrypoint: 'claude-vscode',
      title: 'Doublons dans fct_invoices', model: 'Sonnet 4.5', contextPct: 34, alive: false, // terminal closed: « Continuer » comes first
      steps: [step('Modifie · invoices.sql', 400), step('Exécute · dbt test', 240)],
      lastTurn: {
        ...L.summarizeTurn(lastTurn, { cwd: DATABI, now: now - 3 * MIN, prompt: 'Corrige la jointure des factures', project: 'data-lab' }),
        tookSec: 734,
        tests: { ok: true, command: 'dbt test -s fct_invoices', passed: 14, failed: 0 },
        branch: { branch: 'fix-jointure-factures', worktree: true, root: 'fix-jointure-factures' },
        summary: 'Jointure des factures sur invoice_id, doublons supprimés et test d’unicité ajouté.',
      },
    },
    {
      // Silent for 12 min while working (logic.stalledSince), context near auto-compact
      id: '7b1e4c02-9d3a-4f6e-8a21-5c0d9e3b7a64', cwd: 'C:\\dev\\atlas', project: 'atlas', state: 'working',
      prompt: 'Migre les exports Atlas vers la nouvelle API', lastMessage: '', startedAt: now - 70 * MIN, updatedAt: now - 12 * MIN, turnStartedAt: now - 31 * MIN,
      term: 'Windows Terminal', entrypoint: 'cli', title: 'Migration des exports Atlas', model: 'Opus 5.5', effort: 'high', contextPct: 87, alive: true,
      stalledSince: now - 12 * MIN,
      steps: [step('Lit · export.py', 900), step('Exécute · pytest tests/test_export.py', 720)],
    },
    // « Ranger »: put away, behind the « 2 sessions rangées » link
    {
      id: 'c41d7e88-2a6b-4b0f-b3e9-71f2a8d4c0e1', cwd: 'C:\\dev\\orders', project: 'orders', state: 'finished', stowed: true,
      prompt: 'Ajoute le champ remise au flux', lastMessage: 'Champ ajouté.', startedAt: now - 5 * H, updatedAt: now - 2 * H, term: 'Windows Terminal', entrypoint: 'cli',
      title: 'Champ remise du flux', model: 'Sonnet 4.5', contextPct: 21, alive: false, steps: [],
    },
    {
      id: '0e9a5b3c-6f1d-4c8e-a2b7-d4e1f0c9b8a7', cwd: 'C:\\Users\\camille\\Documents\\notes', project: 'notes', state: 'idle', stowed: true,
      prompt: '', lastMessage: '', startedAt: now - 6 * H, updatedAt: now - 3 * H, term: 'Windows Terminal', entrypoint: 'cli', steps: [],
    },
  ],
};

// ?claudeAlert=<kind> shows one of them after the launch greeting.
const ALERTS = {
  quota: { title: 'Forfait Claude : 84 % (5 h)', text: 'Réinitialisation dans 2 h 14. Garde le gros œuvre pour après.', mood: 'ratelimit', sound: 'rate', priority: 65, ttl: 14 },
  quotaBack: { title: 'Le forfait Claude est rechargé', text: 'La fenêtre de 5 h repart de zéro.', mood: 'relief', sound: 'finish', priority: 50, confetti: true, ttl: 10 },
  finished: { title: 'Terminé · data-lab (12 min)', text: 'La jointure utilise maintenant invoice_id : 3 fichiers modifiés, tests au vert.', mood: 'finished', sound: 'finish', priority: 30, actions: [{ label: 'VS Code', action: 'gotoTerminal', payload: { id: DATABI_ID } }] },
  waiting: { title: 'ambrosia attend ta réponse', text: 'Je pousse la branche ou tu préfères relire d’abord ?', mood: 'waiting', sound: 'question', priority: 36, actions: [{ label: 'Terminal', action: 'gotoTerminal', payload: { id: 'sess-ambrosia' }, primary: true }] },
  loop: { title: 'ambrosia tourne en rond', text: '3 échecs d’outil d’affilée. Dernier : Exit code 1', mood: 'dizzy', sound: 'dizzy', priority: 60, ttl: 14, actions: [{ label: 'Voir', action: 'open', payload: { id: 'sess-ambrosia' }, primary: true }] },
  compact: { title: 'ambrosia : contexte saturé', text: 'Deuxième compaction dans le même tour. Pense à /clear (ou à découper la tâche).', mood: 'thinking', sound: 'question', priority: 50, ttl: 14 },
  denied: { title: 'data-lab : le mode auto a refusé Bash', text: '[Irreversible Local Destruction] · rm -rf /tmp/build', mood: 'surprised', sound: 'tick', priority: 45, ttl: 10 },
  sensitive: { title: 'data-lab : écriture BigQuery (bq)', text: 'bq rm -f -t olympe-dwh:staging.factures_tmp', mood: 'surprised', sound: 'approval', priority: 70, ttl: 12, actions: [{ label: 'Voir', action: 'open', payload: { id: DATABI_ID }, primary: true }] },
  harvest: { title: 'Les vendanges de la semaine sont prêtes', text: '18,6 h de travail des agents, +3820 −1215 lignes. Les amphores sont pleines !', mood: 'love', sound: 'love', priority: 40, ttl: 20, confetti: true, actions: [{ label: 'Voir', action: 'showHarvest', primary: true }] },
  finishedQuiet: { title: 'Terminé · data-lab (12 min)', text: 'Ton terminal est au premier plan : alerte discrète, sans son.', mood: 'finished', priority: 20, ttl: 3, quiet: true },
};

let push = () => {};
let emitter = () => {};
const set = (patch) => {
  state = { ...state, ...patch };
  push(state);
};

export default {
  module: { id: 'claude', name: 'Claude', icon: '✦', logo: 'icons/claude.svg', color: '#E08A5F', order: 10, hasView: true, dir: 'claude', enabled: true, settings: [] },
  state: () => state,
  // Extra buttons in the dev bar (dev/island.html)
  buttons: [
    ['simuler une édition', () => simulateEdit()],
    ['éditions en direct', toggleLive],
    // main.js settles a request answered in the terminal (logic.settledBy): the card simply goes
    ['répondu au terminal', () => set({ pending: state.pending.slice(1) })],
  ],
  connect(send, emit) {
    push = send;
    emitter = emit;
    // window.devClaude.alert('quota') etc.: the alerts main.js would raise.
    const alert = (kind) => {
      const a = ALERTS[kind];
      if (a) emit('alerts', [{ key: `claude:${kind}`, module: 'claude', at: Date.now(), ...a }]);
    };
    window.devClaude = { push: () => push({ ...state }), state: () => state, set, alert, kinds: () => Object.keys(ALERTS) };
    if (q.get('claudeAlert')) setTimeout(() => alert(q.get('claudeAlert')), 4200); // after the launch greeting
  },
  action(name, p = {}) {
    switch (name) {
      case 'forget':
        set({ sessions: state.sessions.filter((s) => s.id !== p.id) });
        return true;
      case 'stow':
      case 'unstow':
        set({ sessions: state.sessions.map((s) => (s.id === p.id ? { ...s, stowed: name === 'stow' } : s)) });
        return true;
      case 'answer':
        console.log('réponse envoyée au relais', name, p);
        window.devClaude.lastAnswer = { name, ...p };
        set({ pending: state.pending.filter((x) => x.rid !== p.rid) });
        return true;
      case 'nudge': {
        // Like main.js: queued, then "delivered" by the next tool call (here 4 s later).
        const nid = String(Date.now());
        const touch = (fn) => set({ sessions: state.sessions.map((s) => (s.id === p.id ? fn(s) : s)) });
        touch((s) => ({ ...s, nudges: [...(s.nudges || []), { id: nid, text: p.text, at: Date.now(), deliveredAt: 0 }] }));
        setTimeout(() => touch((s) => ({ ...s, nudges: (s.nudges || []).map((n) => (n.id === nid ? { ...n, deliveredAt: Date.now() } : n)) })), 4000);
        return true;
      }
      case 'cancelNudge':
        set({ sessions: state.sessions.map((s) => (s.id === p.id ? { ...s, nudges: (s.nudges || []).filter((n) => n.id !== p.nid) } : s)) });
        return true;
      case 'showHarvest':
        set({ harvest: { week: week(), visible: true, at: Date.now() } });
        emitter('expand', { id: 'claude' }); // ctx.focus()
        return true;
      case 'hideHarvest':
        set({ harvest: null });
        return true;
      case 'copyHarvest':
        // main.js: clipboard.writeImage(nativeImage.createFromDataURL(dataUrl))
        window.devClaude.lastPng = p.dataUrl;
        console.log('PNG prêt pour le presse-papier', Math.round(p.dataUrl.length / 1024), 'Ko');
        return p.dataUrl.startsWith('data:image/png;base64,');
      case 'gotoTerminal':
        // main.js walks the process ancestry and calls SetForegroundWindow; here we just say so.
        console.log('aller au terminal', p.id);
        window.devClaude.lastGoto = p.id;
        return p.id === 'missing' ? { ok: false, error: 'Terminal introuvable' } : { ok: true, window: 'WindowsTerminal' };
      case 'open':
        set({ focusSession: { id: p.id, at: Date.now() } });
        emitter('expand', { id: 'claude' }); // ctx.focus()
        return true;
      case 'fileDiff':
        return new Promise((resolve) => setTimeout(() => resolve(fileDiff(p)), 150));
      case 'gitDiff':
        // main.js: git diff HEAD -- <file> in the session's folder (execFile, 4 s at most)
        return new Promise((resolve) => setTimeout(() => resolve(p.path.endsWith('dbt_project.yml')
          ? { ok: true, path: p.path, ...L.parseUnified('@@ -12,4 +12,6 @@ models:\n   data_lab:\n-    +materialized: view\n+    +materialized: table\n+    marts:\n+      +schema: marts\n     staging:\n'), empty: false }
          : { ok: true, path: p.path, ...L.parseUnified(GIT_SAMPLE), empty: false }), 400));
      case 'openInCode':
        console.log('code -g', `${p.path}:${p.line}`);
        window.devClaude.lastCode = `${p.path}:${p.line}`;
        return true;
      case 'copyPath':
        console.log('chemin copié', p.path);
        return true;
      case 'decide':
      case 'commentPlan':
        console.log('réponse envoyée au relais', name, p);
        window.devClaude.lastAnswer = { name, ...p };
        set({ pending: state.pending.filter((x) => x.rid !== p.rid) });
        return true;
      default:
        return true;
    }
  },
};
