// Gany looks it up himself — what the proposers (src/modules/mail/propose.js,
// src/modules/clickup/propose.js) may read to analyse a mail or a ticket on their own:
//
//   * the READ tools of the claude.ai connectors found by `claude mcp list` (Gmail,
//     Google Drive, ClickUp, Google Calendar), never a write tool;
//   * the user's reference projects (Réglages → ClickUp → « Projets de référence »):
//     their CLAUDE.md, their Claude Code memory, their code, with Read / Grep / Glob,
//     secrets denied.
//
// Everything read is untrusted data. The result is an analysis with its sources, a
// draft or a plan: nothing leaves without the user's click (triage.js → apply).

const fs = require('fs');
const os = require('os');
const path = require('path');

/** Read-only tools, per connector (names as the claude.ai connectors expose them). */
const READ_TOOLS = {
  gmail: ['search_threads', 'get_thread'],
  drive: ['search_files', 'get_file_metadata', 'read_file_content'],
  clickup: ['clickup_search', 'clickup_get_task', 'clickup_get_task_comments', 'clickup_get_threaded_comments', 'clickup_find_member_by_name'],
  calendar: ['search_events', 'list_events', 'get_event'],
};

/** How the connectors show up in `claude mcp list` (claude.ai ones are preferred). */
const CONNECTORS = {
  gmail: /gmail/i,
  drive: /google drive|\bdrive\b/i,
  clickup: /clickup/i,
  calendar: /calendar/i,
};

const WHAT = {
  gmail: 'Gmail (search_threads avec une requête Gmail, get_thread) : les échanges passés sur ce sujet, une réponse déjà donnée, un document envoyé',
  drive: 'Google Drive (search_files, get_file_metadata, read_file_content) : procédures, comptes rendus, fichiers de suivi',
  clickup: 'ClickUp (clickup_search, clickup_get_task, ses commentaires) : les tickets liés, leur statut, ce qui a été dit',
  calendar: 'l’agenda (search_events, list_events, get_event) : une réunion citée, une disponibilité',
};

/** The usable connectors of `claude mcp list`: { gmail, drive, clickup, calendar } → server name. */
function pickConnectors(list) {
  const usable = (list || []).filter((m) => !/not configured|needs auth|failed|^[×!✗]/i.test(m.status || ''));
  const out = {};
  for (const [kind, re] of Object.entries(CONNECTORS)) {
    const found = usable.filter((m) => re.test(m.name)).sort((a, b) => /^claude\.ai /.test(b.name) - /^claude\.ai /.test(a.name))[0];
    if (found) out[kind] = found.name;
  }
  return out;
}

/** The connectors, looked up at most every 6 hours (cached in the module's data). */
async function connectors(ctx, data) {
  const fresh = data.lookup && Date.now() - (data.lookup.at || 0) < 6 * 3600000;
  if (!fresh) {
    const list = ctx.claude.listMcp ? await ctx.claude.listMcp().catch(() => null) : null;
    if (list) data.lookup = { ...pickConnectors(list), at: Date.now() };
  }
  const { at, ...servers } = data.lookup || {};
  return servers;
}

/** The allowed tools for these connectors (read only). */
function toolsFor(ctx, servers) {
  const out = [];
  for (const [kind, server] of Object.entries(servers || {})) {
    if (!server || !READ_TOOLS[kind]) continue;
    const prefix = ctx.claude.mcpPrefix(server);
    out.push(...READ_TOOLS[kind].map((t) => prefix + t));
  }
  return [...new Set(out)];
}

/** What Gany may read, said in the prompt. */
function sourcesBlock(servers, dirs = []) {
  const lines = Object.keys(servers || {}).filter((k) => WHAT[k]).map((k) => `- ${WHAT[k]}`);
  if (dirs.length) lines.push(`- les projets de référence de l'utilisateur (Read, Grep, Glob) : leur CLAUDE.md et leur mémoire sont plus bas`);
  return lines.length ? `Sources que tu peux lire toi-même (lecture seule) :\n${lines.join('\n')}` : 'Aucune autre source n’est lisible : appuie-toi seulement sur ce que tu as.';
}

// ── Reference projects (shared with ClickUp) ───────────────────────────────

/** Claude Code keeps a project's memory in ~/.claude/projects/<path with - >/memory. */
function memoryDir(project) {
  return path.join(os.homedir(), '.claude', 'projects', path.resolve(project).replace(/[^a-zA-Z0-9]/g, '-'), 'memory');
}

/** A Read deny rule for an absolute folder: C:\x\y → Read(//c/x/y/<glob>). */
function denyRule(dir, glob) {
  const posix = path.resolve(dir).replace(/\\/g, '/').replace(/^([a-zA-Z]):/, (_, d) => '/' + d.toLowerCase());
  return `Read(/${posix}/${glob})`;
}
// Secrets never reach the analysis: env files, keys, local settings, and GCP
// service-account keys (<project>-<12 hex>.json).
const SECRETS = ['**/.env*', '**/*.pem', '**/*.key', '**/*.pfx', '**/*.p12', '**/settings.local.json', '**/*credentials*.json', `**/*-${'[0-9a-f]'.repeat(12)}.json`, '**/.git/**'];
/** A draft that looks like it carries a secret is dropped, whatever the reason. */
const SECRET_LIKE = /BEGIN [A-Z ]*PRIVATE KEY|"private_key"|\b(pass(word)?|pwd|secret|token|api[_-]?key)\s*[:=]\s*\S{6,}|AIza[0-9A-Za-z_-]{30}|\bsk-[A-Za-z0-9_-]{20,}|\w+:\/\/[^\s:@/]+:[^\s@/]+@/i;

function projects(list) {
  return (list || []).map((p) => String(p).trim()).filter((p) => p && fs.existsSync(p));
}

function readClip(file, max) {
  try {
    return fs.readFileSync(file, 'utf8').slice(0, max);
  } catch {
    return '';
  }
}

/** CLAUDE.md, the memory index and the skill names of each reference project. */
function knowledge(dirs) {
  const out = [];
  for (const dir of dirs) {
    const mem = memoryDir(dir);
    let skills = [];
    try {
      skills = fs.readdirSync(path.join(dir, '.claude', 'skills'));
    } catch {
      /* none */
    }
    out.push(
      `## Projet de référence : ${dir}`,
      readClip(path.join(dir, 'CLAUDE.md'), 12000) || '(pas de CLAUDE.md)',
      fs.existsSync(mem) ? `\n### Sa mémoire Claude Code (${mem}) — index, lis les fichiers utiles avec Read\n${readClip(path.join(mem, 'MEMORY.md'), 14000)}` : '',
      skills.length ? `\n### Ses skills (${path.join(dir, '.claude', 'skills')}\\<nom>\\SKILL.md) : ${skills.join(', ')}` : '',
    );
  }
  return out.filter(Boolean).join('\n');
}

/** Options of a `ctx.claude.run` that may read the projects: Read/Grep/Glob there, secrets denied. */
function projectRun(dirs) {
  const addDirs = [...dirs, ...dirs.map(memoryDir).filter((d) => fs.existsSync(d))];
  return addDirs.length
    ? { tools: ['Read', 'Grep', 'Glob'], addDirs, disallowedTools: addDirs.flatMap((d) => SECRETS.map((g) => denyRule(d, g))) }
    : {};
}

// ── The analysis itself ─────────────────────────────────────────────────

/** Fields every proposer adds to its schema: Gany's own analysis and where it comes from. */
const ANALYSIS_FIELDS = {
  analysis: { type: 'string', description: 'Ce que tu as compris et TROUVÉ toi-même dans les sources (faits, statut, diagnostic), 6 phrases max. Rien d’inventé.' },
  sources: {
    type: 'array',
    description: 'Les sources lues qui fondent l’analyse (4 au plus)',
    items: { type: 'object', properties: { title: { type: 'string' }, url: { type: 'string', description: 'Lien https de la source si l’outil l’a donné, sinon ""' } }, required: ['title'] },
  },
  next: { type: 'string', description: 'La prochaine étape que tu recommandes à l’utilisateur, une phrase' },
  missing: { type: 'string', description: 'Ce qui manque encore pour conclure (une info, une décision), sinon ""' },
};

const LOOKUP_RULES = `Sois proactif : si la demande appelle une information (un statut, un historique, une procédure, un document, une réponse déjà donnée, un diagnostic), cherche-la toi-même dans les sources ci-dessous avant de conclure ; une dizaine de lectures au plus. Ne cite que ce que tu as vraiment lu : chaque fait de ton analyse vient d'une source (sources = les éléments lus qui comptent). Si tu ne trouves pas, dis-le dans missing, sans deviner.`;

const clip = (s, n) => String(s || '').trim().slice(0, n);

/** The analysis part of a model answer, cleaned: https links only, secrets dropped. */
function cleanAnalysis(out) {
  const analysis = SECRET_LIKE.test(out?.analysis || '') ? '' : clip(out?.analysis, 1200);
  const sources = (Array.isArray(out?.sources) ? out.sources : [])
    .map((s) => ({ title: clip(s?.title, 120), url: /^https:\/\/[^\s"'<>]+$/.test(String(s?.url || '').trim()) ? String(s.url).trim().slice(0, 500) : '' }))
    .filter((s) => s.title)
    .slice(0, 4);
  return { analysis, sources, next: clip(out?.next, 300), missing: clip(out?.missing, 300) };
}

module.exports = {
  READ_TOOLS,
  pickConnectors,
  connectors,
  toolsFor,
  sourcesBlock,
  memoryDir,
  denyRule,
  SECRETS,
  SECRET_LIKE,
  projects,
  knowledge,
  projectRun,
  ANALYSIS_FIELDS,
  LOOKUP_RULES,
  cleanAnalysis,
};
