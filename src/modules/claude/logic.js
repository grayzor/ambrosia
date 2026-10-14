// Pure logic of the claude module (no Electron, no fs): tested in tests/claude-logic.test.js.

const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

// ── Progress: TodoWrite lists and TaskCreated / TaskCompleted ──────────────

/**
 * The session's to-do list as Claude keeps it. TodoWrite replaces the whole
 * list each time; the Task hooks add and complete one task at a time.
 * s.progress = { done, total, current, items: [{ text, status }] }
 */
function applyTodos(s, todos) {
  if (!Array.isArray(todos)) return false;
  const items = todos
    .filter((t) => t && (t.content || t.activeForm))
    .map((t) => ({ text: clip(t.content || t.activeForm, 120), active: clip(t.activeForm || t.content, 120), status: ['completed', 'in_progress'].includes(t.status) ? t.status : 'pending' }));
  s.todos = items;
  return refresh(s, 'todo');
}

function taskCreated(s, p) {
  const id = String(p.task_id || '');
  if (!id) return false;
  s.tasks ||= {};
  s.tasks[id] = { text: clip(p.task_subject || 'Tâche', 120), status: s.tasks[id]?.status || 'pending', at: Date.now() };
  return refresh(s, 'task');
}

function taskCompleted(s, p) {
  const id = String(p.task_id || '');
  if (!id) return false;
  s.tasks ||= {};
  s.tasks[id] = { ...(s.tasks[id] || { text: clip(p.task_subject || 'Tâche', 120), at: Date.now() }), status: 'completed' };
  return refresh(s, 'task');
}

function refresh(s, source) {
  const items = source === 'todo' ? s.todos || [] : Object.values(s.tasks || {}).sort((a, b) => a.at - b.at);
  if (!items.length) {
    s.progress = null;
    return true;
  }
  const done = items.filter((i) => i.status === 'completed').length;
  const cur = items.find((i) => i.status === 'in_progress') || items.find((i) => i.status === 'pending');
  s.progress = {
    source,
    done,
    total: items.length,
    current: done === items.length ? '' : cur ? cur.active || cur.text : '',
    items: items.slice(0, 14).map((i) => ({ text: i.text, status: i.status })),
  };
  return true;
}

/** A new prompt: a finished list is history, an unfinished one carries on. */
function newTurnProgress(s) {
  if (s.progress && s.progress.done >= s.progress.total) {
    s.progress = null;
    s.todos = [];
    s.tasks = {};
  }
}

// ── Gany vigile ──────────────────────────────────────────────────────────

/** Commands worth a glance, never blocked: [label, regex]. */
const SENSITIVE = [
  ['git push --force', /\bgit\s+push\b[^\n;&|]*?\s(--force(?!-with-lease)\b|-f\b|\+\S+)/i],
  ['git push --force-with-lease', /\bgit\s+push\b[^\n;&|]*?\s--force-with-lease\b/i],
  ['git reset --hard', /\bgit\s+reset\b[^\n;&|]*\s--hard\b/i],
  ['git clean', /\bgit\s+clean\b[^\n;&|]*\s-[a-z]*f/i],
  ['git branch -D', /\bgit\s+branch\b[^\n;&|]*\s-D\b/],
  ['suppression récursive (rm -rf)', /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|-r\s+-f|-f\s+-r|--recursive\s+--force|--force\s+--recursive)\b/i],
  ['suppression récursive (Remove-Item)', /\b(Remove-Item|ri|rm)\b[^\n;|]*\s-Recurse\b/i],
  ['suppression récursive (rd /s)', /\b(rd|rmdir|del)\b[^\n;|&]*\s\/s\b/i],
  ['SQL DROP', /\bDROP\s+(TABLE|DATABASE|SCHEMA|VIEW|INDEX)\b/i],
  ['SQL TRUNCATE', /\bTRUNCATE\s+(TABLE\s+)?\S/i],
  ['SQL DELETE sans WHERE', (t) => (t.match(/\bDELETE\s+FROM\b[^;]*/gi) || []).some((stmt) => !/\bWHERE\b/i.test(stmt))],
  ['SQL DELETE', /\bDELETE\s+FROM\b/i],
  ['écriture BigQuery (bq)', /\bbq\s+(rm|cp|load|mk|update|insert|truncate)\b/i],
  ['terraform destroy', /\bterraform\s+(destroy|apply\b[^\n;&|]*-auto-approve)/i],
  ['kubectl delete', /\bkubectl\s+delete\b/i],
  ['publication npm', /\bnpm\s+publish\b/i],
];

const SQL_DML = /\b(INSERT\s+INTO|UPDATE\s+\S+\s+SET|DELETE\s+FROM|MERGE\s+INTO|DROP\s+\w+|TRUNCATE|CREATE\s+OR\s+REPLACE|ALTER\s+TABLE)\b/i;

/**
 * Why a tool call deserves a heads-up, or null. Looks at shell commands, and at
 * SQL sent through a query tool (BigQuery connector…). `extra`: the user's own
 * regexes (strings), from the settings.
 */
function sensitive(tool, input = {}, extra = []) {
  const name = String(tool || '');
  const text = typeof input.command === 'string' ? input.command : '';
  const sql = /sql|query|bigquery/i.test(name) ? String(input.query || input.sql || input.statement || '') : '';
  const find = (t) => SENSITIVE.find(([, rule]) => (typeof rule === 'function' ? rule(t) : rule.test(t)));
  if (sql && SQL_DML.test(sql)) {
    const hit = find(sql);
    return hit ? hit[0] : `écriture SQL (${clip(sql.match(SQL_DML)[0].toUpperCase(), 24)})`;
  }
  if (!text) return null;
  const hit = find(text);
  if (hit) return hit[0];
  if (/\bbq\s+query\b/i.test(text) && SQL_DML.test(text)) return 'écriture BigQuery (bq query)';
  for (const src of extra || []) {
    try {
      if (src && new RegExp(src, 'i').test(text)) return `motif « ${clip(src, 30)} »`;
    } catch {
      /* invalid regex in the settings: ignored */
    }
  }
  return null;
}

// ── End of turn: files touched, last test run ─────────────────────────────

const base = (p) => String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop();

function newTurn(now) {
  return { startedAt: now, files: {}, tests: null };
}

/** An edit that went through (PostToolUse confirmed it). */
function addEdit(turn, diff) {
  if (!turn || !diff?.file) return;
  const f = (turn.files[diff.file] ||= { add: 0, del: 0, created: !!diff.created });
  f.add += Number(diff.add) || 0;
  f.del += Number(diff.del) || 0;
}

/** "# pass 42 / # fail 0", "3 failed, 40 passed", "Tests: 40 passed" → { passed, failed } (best effort). */
function testCounts(tail) {
  const t = String(tail || '');
  const num = (re) => {
    const m = t.match(re);
    return m ? Number(m[1]) : null;
  };
  const passed = num(/#\s*pass\s+(\d+)/i) ?? num(/(\d+)\s+(?:tests?\s+)?pass(?:ed|ing)?\b/i) ?? num(/\bpass(?:ed)?:?\s+(\d+)/i);
  const failed = num(/#\s*fail\s+(\d+)/i) ?? num(/(\d+)\s+(?:tests?\s+)?fail(?:ed|ing|ures?)?\b/i) ?? num(/\bfail(?:ed|ures)?:?\s+(\d+)/i);
  return { passed, failed };
}

function addTest(turn, command, test, now) {
  if (!turn || !test) return;
  const counts = testCounts(test.tail);
  turn.tests = { ok: !!test.ok && !(counts.failed > 0), command: clip(command, 80), ...counts, at: now };
}

/** A file as the user knows it: relative to the session's folder, its name when outside. */
function relPath(file, cwd) {
  const a = String(file || '').replace(/\\/g, '/');
  const c = String(cwd || '').replace(/\\/g, '/').replace(/\/+$/, '');
  return c && a.toLowerCase().startsWith(c.toLowerCase() + '/') ? a.slice(c.length + 1) : base(file);
}

function turnFiles(turn, cwd) {
  return Object.entries(turn?.files || {})
    .map(([f, v]) => ({ file: relPath(f, cwd), path: f, add: v.add, del: v.del, created: v.created, ...(v.via ? { via: v.via } : {}) }))
    .sort((a, b) => b.add + b.del - (a.add + a.del));
}

/** While a turn runs: the files touched so far, for the session card (« 4 fichiers +72 −18 »). */
function liveFiles(turn, cwd) {
  const files = turnFiles(turn, cwd);
  if (!files.length) return null;
  return {
    fileCount: files.length,
    add: files.reduce((n, f) => n + f.add, 0),
    del: files.reduce((n, f) => n + f.del, 0),
    files: files.slice(0, 12),
  };
}

/** The card shown when a turn ends; also what the evening report and the weekly harvest read. */
function summarizeTurn(turn, { cwd, now, prompt, project }) {
  const files = turnFiles(turn, cwd);
  return {
    at: now,
    project,
    prompt: clip(prompt, 160),
    tookSec: turn?.startedAt ? Math.round((now - turn.startedAt) / 1000) : 0,
    files: files.slice(0, 12),
    fileCount: files.length,
    add: files.reduce((n, f) => n + f.add, 0),
    del: files.reduce((n, f) => n + f.del, 0),
    tests: turn?.tests || null,
    branch: null,
    summary: '',
  };
}

// ── Live feed in the notch (« view.js +12 −3 · main.js +4 ») ─────────────

/** Tools whose successful PostToolUse is an edit worth showing. */
const EDIT_TOOLS = ['Edit', 'MultiEdit', 'Write', 'NotebookEdit'];
const TICKER = { windowMs: 6000, spanMs: 20000, ttlMs: 5000, items: 8, budget: 46 };

/**
 * The ticker after one more edit. Edits of the same session that follow each
 * other closely share one line (per file, newest first); a pause, another
 * session or a line that has run long enough starts a fresh one.
 * t = { sid, project, startedAt, at, seq, items: [{ path, rel, add, del }], dropped }
 * e = { sid, project, path, rel, add, del }
 */
function tickerPush(t, e, now, o = TICKER) {
  const fresh = !t || t.sid !== e.sid || now - t.at > o.windowMs || now - t.startedAt > o.spanMs;
  const items = fresh ? [] : t.items;
  const prev = items.find((i) => i.path === e.path);
  const item = { path: e.path, rel: e.rel || base(e.path), add: (prev?.add || 0) + (Number(e.add) || 0), del: (prev?.del || 0) + (Number(e.del) || 0) };
  const next = [item, ...items.filter((i) => i !== prev)];
  const dropped = (fresh ? 0 : t.dropped || 0) + Math.max(0, next.length - o.items);
  return { sid: e.sid, project: e.project || '', startedAt: fresh ? now : t.startedAt, at: now, seq: (t?.seq || 0) + 1, items: next.slice(0, o.items), dropped };
}

/** "view.js", or "claude/view.js" when two files of the line share a name. */
function displayNames(rels) {
  const segs = rels.map((r) => String(r || '').replace(/\\/g, '/').split('/').filter(Boolean));
  const depth = segs.map(() => 1);
  for (let round = 0; round < 4; round++) {
    const names = segs.map((s, i) => s.slice(-depth[i]).join('/'));
    let clash = false;
    names.forEach((n, i) => {
      if (depth[i] < segs[i].length && names.some((m, j) => j !== i && m.toLowerCase() === n.toLowerCase())) {
        depth[i]++;
        clash = true;
      }
    });
    if (!clash) return names;
  }
  return segs.map((s, i) => s.slice(-depth[i]).join('/'));
}

/** A long name cut in the middle, its extension kept: "triage-view-hel….test.js". */
function shortName(name, max = 24) {
  const s = String(name || '');
  if (s.length <= max) return s;
  const slash = s.lastIndexOf('/');
  if (slash > 0 && s.length - slash <= max - 1) return '…' + s.slice(slash); // the folder goes first
  const ext = (s.slice(slash + 1).match(/(\.[A-Za-z0-9]{1,6}){1,2}$/) || [''])[0];
  const keep = max - ext.length - 1;
  return keep >= 4 ? s.slice(0, keep) + '…' + ext : s.slice(0, max - 1) + '…';
}

/** "+12 −3", "+4", "−7", "±0". */
function delta(add, del) {
  return [add ? `+${add}` : '', del ? `−${del}` : ''].filter(Boolean).join(' ') || '±0';
}

/** What the notch shows: as many files as fit in `budget` characters, then "+N". */
function tickerParts(t, budget = TICKER.budget) {
  if (!t?.items?.length) return { parts: [], more: 0 };
  const names = displayNames(t.items.map((i) => i.rel));
  const parts = [];
  let used = 0;
  for (let i = 0; i < t.items.length; i++) {
    const it = t.items[i];
    const name = shortName(names[i], 24);
    const len = name.length + delta(it.add, it.del).length + 3;
    if (parts.length && used + len > budget) break;
    parts.push({ name, path: it.path, add: it.add, del: it.del });
    used += len;
  }
  return { parts, more: t.items.length - parts.length + (t.dropped || 0) };
}

// ── Diffs: what each edit changed, line by line ───────────────────────────

/** Kept per turn, in memory: beyond, edits are counted but their text is let go. */
const DIFF_CAPS = { perEdit: 60000, perTurn: 1000000, perFile: 40 };

function splitLines(text) {
  const s = String(text ?? '').replace(/\r\n/g, '\n');
  if (!s) return [];
  return s.replace(/\n$/, '').split('\n');
}

/**
 * Myers' O(ND) diff of two line arrays → [[op, i, j]], op '=' (a[i] = b[j]),
 * '-' (a[i] removed), '+' (b[j] added). Common head and tail are trimmed first;
 * past `maxD` differences it gives up on alignment: everything old out, everything new in.
 */
function diffLines(a, b, maxD = 1500) {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let ta = a.length;
  let tb = b.length;
  while (ta > head && tb > head && a[ta - 1] === b[tb - 1]) {
    ta--;
    tb--;
  }
  const ops = [];
  for (let i = 0; i < head; i++) ops.push(['=', i, i]);
  const A = a.slice(head, ta);
  const B = b.slice(head, tb);
  const mid = myers(A, B, maxD) || [...A.map((_, i) => ['-', i, -1]), ...B.map((_, j) => ['+', -1, j])];
  for (const [op, i, j] of mid) ops.push([op, i < 0 ? -1 : i + head, j < 0 ? -1 : j + head]);
  for (let k = 0; ta + k < a.length; k++) ops.push(['=', ta + k, tb + k]);
  return ops;
}

function myers(A, B, maxD) {
  const N = A.length;
  const M = B.length;
  if (!N) return B.map((_, j) => ['+', -1, j]);
  if (!M) return A.map((_, i) => ['-', i, -1]);
  const MAX = N + M;
  const off = MAX + 1;
  const V = new Int32Array(2 * MAX + 3);
  const trace = []; // trace[d] = V before step d, for k in [-d-1, d+1]
  for (let d = 0; d <= MAX; d++) {
    if (d > maxD) return null;
    trace.push(V.slice(off - d - 1, off + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && V[off + k - 1] < V[off + k + 1]) ? V[off + k + 1] : V[off + k - 1] + 1;
      let y = x - k;
      while (x < N && y < M && A[x] === B[y]) {
        x++;
        y++;
      }
      V[off + k] = x;
      if (x >= N && y >= M) return backtrack(trace, d, N, M);
    }
  }
  return null;
}

function backtrack(trace, D, N, M) {
  const ops = [];
  let x = N;
  let y = M;
  for (let d = D; d > 0; d--) {
    const v = trace[d];
    const at = (k) => v[k + d + 1];
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) ops.push(['=', --x, --y]);
    if (x === prevX) ops.push(['+', -1, --y]);
    else ops.push(['-', --x, -1]);
  }
  while (x > 0 && y > 0) ops.push(['=', --x, --y]);
  return ops.reverse();
}

/**
 * Rows of a unified view: { t: ' ' | '-' | '+', o, n, s } with line numbers from
 * `start` (null when unknown: an Edit whose place in the file was not found).
 */
function diffRows(oldText, newText, start = 1) {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const num = (i) => (start == null || i < 0 ? null : start + i);
  return diffLines(a, b).map(([op, i, j]) => (op === '=' ? { t: ' ', o: num(i), n: num(j), s: b[j] } : op === '-' ? { t: '-', o: num(i), n: null, s: a[i] } : { t: '+', o: null, n: num(j), s: b[j] }));
}

/**
 * Long unchanged runs fold into one row { t: '…', count, rows } (kept, so the view
 * can unfold them), `context` lines stay around each change.
 */
function foldRows(rows, context = 3) {
  const out = [];
  let i = 0;
  while (i < rows.length) {
    if (rows[i].t !== ' ') {
      out.push(rows[i++]);
      continue;
    }
    let j = i;
    while (j < rows.length && rows[j].t === ' ') j++;
    const keepHead = i === 0 ? 0 : context;
    const keepTail = j === rows.length ? 0 : context;
    if (j - i > keepHead + keepTail + 2) {
      out.push(...rows.slice(i, i + keepHead));
      out.push({ t: '…', count: j - i - keepHead - keepTail, rows: rows.slice(i + keepHead, j - keepTail) });
      out.push(...rows.slice(j - keepTail, j));
    } else out.push(...rows.slice(i, j));
    i = j;
  }
  return out;
}

/** 1-based line where `needle` starts in `text` (LF or CRLF), or null. */
function lineOf(text, needle) {
  const t = String(text || '');
  const n = String(needle || '');
  if (!n.trim()) return null;
  let i = t.indexOf(n);
  if (i < 0 && n.includes('\n') && !n.includes('\r')) i = t.indexOf(n.replace(/\n/g, '\r\n'));
  if (i < 0) return null;
  let line = 1;
  for (let k = t.indexOf('\n'); k >= 0 && k < i; k = t.indexOf('\n', k + 1)) line++;
  return line;
}

/** An edit rebuilt from the hook's tool_input (an older relay: texts cut at 4000 characters). */
function editFromInput(tool, input = {}) {
  const cutAt = (s) => typeof s === 'string' && s.length === 4001 && s.endsWith('…');
  const block = (o, n, extra = {}) => ({ old: String(o ?? ''), new: String(n ?? ''), cut: cutAt(o) || cutAt(n), ...extra });
  if (tool === 'Edit') return { tool, blocks: [block(input.old_string, input.new_string, input.replace_all ? { all: true } : {})], omitted: 0 };
  if (tool === 'MultiEdit' && Array.isArray(input.edits)) return { tool, blocks: input.edits.slice(0, 50).map((e) => block(e?.old_string, e?.new_string)), omitted: Math.max(0, input.edits.length - 50) };
  if (tool === 'Write') return { tool, blocks: [block('', input.content)], omitted: 0, oldUnknown: true };
  if (tool === 'NotebookEdit') return { tool, blocks: [block('', input.edit_mode === 'delete' ? '' : input.new_source, { cell: String(input.cell_id || '') })], omitted: 0 };
  return null;
}

/**
 * Keeps one confirmed edit's texts in the turn, within DIFF_CAPS. Over the caps the
 * edit is still counted (+N −M), the file just says some of its diff was let go.
 * Returns the stored entry, or null.
 */
function storeEdit(turn, file, edit, now, caps = DIFF_CAPS) {
  if (!turn || !file || !edit?.blocks) return null;
  turn.edits ||= {};
  turn.kept ||= 0;
  const list = (turn.edits[file] ||= []);
  const f = turn.files[file];
  const size = edit.blocks.reduce((n, b) => n + String(b.old || '').length + String(b.new || '').length, 0);
  if (list.length >= caps.perFile || turn.kept + Math.min(size, caps.perEdit * 2) > caps.perTurn) {
    if (f) f.dropped = (f.dropped || 0) + 1;
    return null;
  }
  let room = caps.perEdit;
  const blocks = edit.blocks.map((b) => {
    const o = String(b.old || '');
    const n = String(b.new || '');
    const keepO = o.slice(0, Math.max(0, room));
    room -= keepO.length;
    const keepN = n.slice(0, Math.max(0, room));
    room -= keepN.length;
    return { ...b, old: keepO, new: keepN, cut: !!b.cut || keepO.length < o.length || keepN.length < n.length };
  });
  const entry = { at: now, tool: edit.tool || '', blocks, omitted: Number(edit.omitted) || 0, ...(edit.created ? { created: true } : {}), ...(edit.oldUnknown ? { oldUnknown: true } : {}) };
  turn.kept += blocks.reduce((n, b) => n + b.old.length + b.new.length, 0);
  list.push(entry);
  return entry;
}

const TOOL_TITLES = { Edit: 'Modification', MultiEdit: 'Modifications', Write: 'Écriture', NotebookEdit: 'Cellule' };

/**
 * The view of one file for one turn: one block per edit (and per sub-edit of a
 * MultiEdit), rows folded. `entries` from storeEdit, in order.
 */
function fileDiff(entries, { context = 3, dropped = 0 } = {}) {
  const blocks = [];
  let firstLine = null;
  const notes = [];
  for (const e of entries || []) {
    e.blocks.forEach((b, i) => {
      const write = e.tool === 'Write';
      const start = write ? 1 : b.line ?? null;
      const rows = diffRows(b.old, b.new, start);
      const add = rows.filter((r) => r.t === '+').length;
      const del = rows.filter((r) => r.t === '-').length;
      if (firstLine == null) {
        const r = rows.find((x) => x.t !== ' ');
        firstLine = r ? r.n ?? r.o : start;
      }
      blocks.push({
        at: e.at,
        title: `${TOOL_TITLES[e.tool] || e.tool}${e.blocks.length > 1 ? ` ${i + 1}/${e.blocks.length}` : ''}${b.cell ? ` · cellule ${b.cell}` : ''}${b.all ? ' · toutes les occurrences' : ''}`,
        line: start,
        add,
        del,
        cut: !!b.cut,
        oldUnknown: !!e.oldUnknown,
        rows: foldRows(rows, context),
      });
    });
    if (e.omitted) notes.push(`${e.omitted} sous-modification${e.omitted > 1 ? 's' : ''} non conservée${e.omitted > 1 ? 's' : ''}`);
  }
  if (dropped) notes.push(`${dropped} modification${dropped > 1 ? 's' : ''} non conservée${dropped > 1 ? 's' : ''} (plafond de taille du tour)`);
  if (blocks.some((b) => b.cut)) notes.push('Textes très longs : aperçu tronqué. « Diff git » montre le fichier entier.');
  if (blocks.some((b) => b.oldUnknown)) notes.push('Contenu précédent inconnu : tout le fichier apparaît ajouté.');
  return { blocks, line: firstLine, notes };
}

/** `git diff` output → { binary, blocks: [{ title, line, add, del, rows }] }. */
function parseUnified(text, context = 3) {
  const out = { binary: false, blocks: [] };
  let cur = null;
  let o = 0;
  let n = 0;
  for (const line of String(text || '').replace(/\r\n/g, '\n').split('\n')) {
    const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/);
    if (m) {
      o = Number(m[1]);
      n = Number(m[2]);
      cur = { title: m[3] ? m[3].trim() : `Ligne ${n}`, line: n, add: 0, del: 0, rows: [] };
      out.blocks.push(cur);
      continue;
    }
    if (/^Binary files .* differ$/.test(line) || /^GIT binary patch/.test(line)) out.binary = true;
    if (!cur) continue;
    if (line.startsWith('+')) {
      cur.rows.push({ t: '+', o: null, n: n++, s: line.slice(1) });
      cur.add++;
    } else if (line.startsWith('-')) {
      cur.rows.push({ t: '-', o: o++, n: null, s: line.slice(1) });
      cur.del++;
    } else if (line.startsWith(' ')) cur.rows.push({ t: ' ', o: o++, n: n++, s: line.slice(1) });
    // "\ No newline at end of file" and the next file's header end nothing here
  }
  for (const b of out.blocks) b.rows = foldRows(b.rows, context);
  return out;
}

/**
 * `file` resolved inside `cwd` (Windows or POSIX paths, any case), or null when it
 * leaves it (.., another drive, a UNC path, a NUL byte). Pure string work.
 */
function pathUnder(cwd, file) {
  if (!cwd || !file || /\0/.test(cwd) || /\0/.test(file)) return null;
  const norm = (p) => String(p).replace(/\\/g, '/');
  const root = norm(cwd).replace(/\/+$/, '');
  let f = norm(file);
  const absolute = /^[A-Za-z]:\//.test(f) || f.startsWith('/');
  if (/^[A-Za-z]:(?!\/)/.test(f)) return null; // "C:foo": relative to a drive's own folder
  if (!absolute) f = `${root}/${f}`;
  const parts = [];
  const [drive, ...rest] = f.split('/');
  for (const seg of rest) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(seg);
  }
  const resolved = `${drive}/${parts.join('/')}`;
  const lower = (s) => s.toLowerCase();
  if (lower(resolved) === lower(root) || !lower(resolved).startsWith(lower(root) + '/')) return null;
  return /^[A-Za-z]:/.test(cwd) || String(cwd).includes('\\') ? resolved.replace(/\//g, '\\') : resolved;
}

/** Can this path go between double quotes on a cmd.exe line (`code -g`)? */
function quotable(p) {
  return typeof p === 'string' && !!p && !/["%!^\r\n\0]/.test(p);
}

// ── Git catch-up: files a command changed (sed, a formatter, a generator…) ──

/**
 * `git diff --numstat` (plain or -z) → [{ path, from?, add, del, binary }].
 * Binaries show "-\t-"; renames "a\tb\told => new", "a\tb\tsrc/{old => new}/f.js",
 * or with -z "a\tb\t\0old\0new\0".
 */
function parseNumstat(text) {
  const out = [];
  const s = String(text || '');
  const entry = (a, d, p, from) => {
    const binary = a === '-' && d === '-';
    out.push({ path: p, ...(from ? { from } : {}), add: binary ? 0 : Number(a) || 0, del: binary ? 0 : Number(d) || 0, binary });
  };
  if (s.includes('\0')) {
    const tok = s.split('\0');
    for (let i = 0; i < tok.length; i++) {
      const m = tok[i].replace(/^\r?\n/, '').match(/^(\d+|-)\t(\d+|-)\t(.*)$/s);
      if (!m) continue;
      if (m[3]) entry(m[1], m[2], m[3]);
      else if (i + 2 < tok.length) {
        entry(m[1], m[2], tok[i + 2], tok[i + 1]);
        i += 2;
      }
    }
    return out;
  }
  for (const line of s.split(/\r?\n/)) {
    const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (!m) continue;
    const p = m[3];
    const brace = p.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
    if (brace) {
      const join = (mid) => `${brace[1]}${mid}${brace[4]}`.replace(/\/{2,}/g, '/');
      entry(m[1], m[2], join(brace[3]), join(brace[2]));
    } else if (p.includes(' => ')) {
      const [from, to] = p.split(' => ');
      entry(m[1], m[2], to, from);
    } else entry(m[1], m[2], p);
  }
  return out;
}

/** A path as git quotes it ("a b\303\251.txt") → plain text. */
function unquoteGit(p) {
  if (!/^".*"$/.test(p)) return p;
  const body = p.slice(1, -1);
  const bytes = [];
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c !== '\\') {
      for (const b of new TextEncoder().encode(c)) bytes.push(b);
      continue;
    }
    const n = body[++i];
    if (/[0-7]/.test(n)) {
      bytes.push(parseInt(body.slice(i, i + 3), 8));
      i += 2;
    } else bytes.push(({ n: 10, t: 9, r: 13, b: 8, f: 12, v: 11, a: 7 })[n] ?? n.charCodeAt(0));
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** Untracked entries ("?? path") of `git status --porcelain` (plain or -z), at most `cap`. */
function parseUntracked(text, cap = 500) {
  const s = String(text || '');
  const out = [];
  if (s.includes('\0')) {
    const tok = s.split('\0');
    for (let i = 0; i < tok.length && out.length < cap; i++) {
      const t = tok[i];
      if (t.startsWith('?? ')) out.push(t.slice(3));
      else if (/^[RC]/.test(t)) i++; // a rename / copy carries its source in the next field
    }
    return out;
  }
  for (const line of s.split(/\r?\n/)) {
    if (line.startsWith('?? ') && out.length < cap) out.push(unquoteGit(line.slice(3)));
  }
  return out;
}

const normPath = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/**
 * Files changed during the turn outside the editing tools: the end snapshot
 * (`git diff --numstat <start HEAD>` + untracked files) minus the start one
 * (same command when the prompt arrived), minus what the tools already counted.
 * Snapshots: { top, head, numstat: [...], untracked: [...] }. → [{ path, rel, add, del, created?, binary?, dir? }]
 */
function gitCatchup(start, end, { known = [], cap = 30 } = {}) {
  if (!start || !end) return [];
  const top = String(end.top || start.top || '').replace(/[\\/]+$/, '');
  const sep = top.includes('\\') ? '\\' : '/';
  const abs = (rel) => `${top}${sep}${rel.replace(/\//g, sep)}`.replace(/[\\/]+$/, '');
  const skip = new Set(known.map(normPath));
  const before = new Map((start.numstat || []).map((e) => [e.path.toLowerCase(), e]));
  const out = [];
  for (const e of end.numstat || []) {
    const path = abs(e.path);
    if (skip.has(normPath(path))) continue;
    const s = before.get(e.path.toLowerCase());
    if (e.binary) {
      if (!s) out.push({ path, rel: e.path, add: 0, del: 0, binary: true });
      continue;
    }
    const dA = e.add - (s?.add || 0);
    const dD = e.del - (s?.del || 0);
    if (!dA && !dD) continue;
    // A line added before the turn and removed during it: one line deleted.
    out.push({ path, rel: e.path, add: Math.max(0, dA) + Math.max(0, -dD), del: Math.max(0, dD) + Math.max(0, -dA) });
  }
  const was = new Set((start.untracked || []).map((u) => u.toLowerCase()));
  for (const u of end.untracked || []) {
    if (was.has(u.toLowerCase())) continue;
    const path = abs(u);
    if (skip.has(normPath(path))) continue;
    out.push({ path, rel: u.replace(/\/$/, ''), add: 0, del: 0, created: true, ...(u.endsWith('/') ? { dir: true } : {}) });
  }
  return out.sort((a, b) => b.add + b.del - (a.add + a.del)).slice(0, cap);
}

/** Adds what git saw to the turn's files, marked « via commande ». */
function addCatchup(turn, entries) {
  if (!turn) return 0;
  let n = 0;
  for (const e of entries || []) {
    if (turn.files[e.path]) continue;
    turn.files[e.path] = { add: e.add, del: e.del, created: !!e.created, via: 'commande' };
    n++;
  }
  return n;
}

const GIT_ARGS = ['rev-parse', '--abbrev-ref', 'HEAD', '--path-format=absolute', '--git-dir', '--git-common-dir', '--show-toplevel'];

/**
 * Output of `git <GIT_ARGS>` → { branch, worktree, root, repo }. A linked worktree has
 * its own git dir; `repo` is the repository's name, the same for all its worktrees.
 */
function parseGit(out) {
  const [branch, gitDir, commonDir, top] = String(out || '').trim().split(/\r?\n/);
  if (!branch) return null;
  const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const worktree = !!gitDir && !!commonDir && norm(gitDir) !== norm(commonDir);
  const common = String(commonDir || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const repo = /\/\.git$/i.test(common) ? base(common.slice(0, -5)) : base(common).replace(/\.git$/i, '') || base(top);
  return { branch: branch === 'HEAD' ? 'détaché' : branch, worktree, root: base(top), repo: repo || base(top) };
}

// ── Requests answered elsewhere (in the terminal) ─────────────────────────
//
// Claude Code shows its own permission dialog while the PermissionRequest hook
// waits, and does not always kill the hook when the user answers there: the
// relay keeps waiting and the card would stay in the island. Any later event of
// the same session that proves the request is over settles it.

/** Past this delay, another tool call of the same agent is no longer a sibling of a parallel batch. */
const SETTLE_GRACE_MS = 1500;

/** A tool call's identity across events (the relay cuts long fields the same way each time). */
function callKey(tool, input) {
  let s = '';
  try {
    s = JSON.stringify(input ?? {});
  } catch {
    /* circular: cannot happen with JSON from a pipe */
  }
  return `${tool || ''}|${s.length > 2000 ? s.slice(0, 2000) : s}`;
}

/** A PreToolUse starts a call: calls = Map tool_use_id → { sid, agent, tool, key, at }. */
function trackCall(calls, p, now) {
  if (!p?.tool_use_id) return;
  calls.set(p.tool_use_id, { sid: p.session_id || '', agent: p.agent_id || '', tool: p.tool_name || '', key: callKey(p.tool_name, p.tool_input), at: now });
  if (calls.size > 400) for (const [id, c] of calls) if (now - c.at > 2 * 3600000 || calls.size > 400) calls.delete(id);
}

/**
 * The PreToolUse a PermissionRequest is about (it carries no tool_use_id): same
 * session, tool and input, the newest. → { id, agent, at } or null.
 */
function callOf(calls, p) {
  const key = callKey(p?.tool_name, p?.tool_input);
  let best = null;
  for (const [id, c] of calls || []) if (c.sid === (p.session_id || '') && c.key === key && (!best || c.at >= best.at)) best = { id, agent: c.agent, at: c.at };
  return best;
}

/**
 * Why a pending request no longer waits, given a later hook event `p`, or null.
 * item = { sessionId, tool, key, toolUseId?, agentId?, at }. A subagent's events
 * never settle the main agent's request (and the reverse): agent ids must match.
 * Another call of the same agent counts only if it started `grace` ms after the
 * request (siblings of a parallel batch start together).
 */
function settledBy(item, p, calls, now, grace = SETTLE_GRACE_MS) {
  if (!item || !p || (p.session_id || '') !== item.sessionId) return null;
  const ev = p.hook_event_name;
  const agent = p.agent_id || '';
  const mine = agent === (item.agentId || '');
  switch (ev) {
    case 'UserPromptSubmit':
    case 'Stop':
    case 'StopFailure':
    case 'SessionEnd':
    case 'SessionStart':
      return ev;
    case 'Notification':
      return p.notification_type === 'idle_prompt' ? 'idle' : null;
    case 'SubagentStop':
      return agent && agent === item.agentId ? ev : null;
    case 'PermissionDenied':
      return mine && p.tool_name === item.tool ? ev : null;
    case 'PermissionRequest': // the same agent asks for something else: it went past this one
      return mine && callKey(p.tool_name, p.tool_input) !== item.key && now - item.at > grace ? 'moved-on' : null;
    case 'PreToolUse':
    case 'PostToolUse':
    case 'PostToolUseFailure': {
      if (p.ambrosia_kind === 'ask') return null; // another waiting question: its own card
      if (item.toolUseId && p.tool_use_id === item.toolUseId) return ev === 'PreToolUse' ? null : ev;
      if (!mine) return null;
      if (!item.toolUseId && ev !== 'PreToolUse' && callKey(p.tool_name, p.tool_input) === item.key) return ev;
      const started = ev === 'PreToolUse' ? now : calls?.get?.(p.tool_use_id)?.at;
      return started && started - item.at > grace ? 'moved-on' : null;
    }
    default:
      return null;
  }
}

// ── Session cards: silence, context, model, title, subagents ──────────────

/**
 * Since when a busy session has been silent for more than `minutes` (the time of
 * its last hook event), or 0. A request waiting for you is not silence; a Bash
 * command gets its own timeout (2 min by default, 10 at most) plus a minute.
 */
function stalledSince(s, now, { minutes = 8, pending = false } = {}) {
  if (!s || pending || !(Number(minutes) > 0) || !['working', 'thinking'].includes(s.state)) return 0;
  const last = s.updatedAt || 0;
  let allow = Number(minutes) * 60000;
  const t = s.runningTool;
  if (t && /^(Bash|PowerShell)$/.test(t.name) && !t.background) allow = Math.max(allow, (Number(t.timeoutMs) || 120000) + 60000);
  return last && now - last > allow ? last : 0;
}

/** The tool running now (PreToolUse of the main agent until its PostToolUse), for the silence check. */
function runningTool(p, now) {
  const i = p?.tool_input || {};
  return { id: p?.tool_use_id || '', name: p?.tool_name || '', timeoutMs: Number(i.timeout) || 0, background: i.run_in_background === true, at: now };
}

/** Context fill → level: low < 50 ≤ mid < 70 ≤ high < 80 ≤ warn (auto-compact near) < 90 ≤ bad. */
function contextLevel(pct) {
  if (!Number.isFinite(pct)) return null;
  return pct >= 90 ? 'bad' : pct >= 80 ? 'warn' : pct >= 70 ? 'high' : pct >= 50 ? 'mid' : 'low';
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** "claude-opus-5-5-20260101" / "Opus 5.5" / "Sonnet 4.5 (1M context)" → "Opus 5.5", "Sonnet 4.5 1M". */
function shortModel(m) {
  const s = String(m || '').trim();
  if (!s) return '';
  const big = /\[1m\]|\b1m\b|\(1M/i.test(s) ? ' 1M' : '';
  const id = s.toLowerCase().match(/(opus|sonnet|haiku|fable)(?:[-\s](\d{1,2})(?!\d)(?:[-.](\d{1,2})(?!\d))?)?/);
  if (id) return `${cap(id[1])}${id[2] ? ` ${id[2]}${id[3] ? `.${id[3]}` : ''}` : ''}${big}`;
  return clip(s.replace(/^claude[\s-]*/i, ''), 18);
}

/** Reasoning effort, from the statusLine (`effort.level`) or a hook's `effort` field. */
const EFFORTS = { low: 'bas', medium: 'moyen', high: 'élevé', xhigh: 'très élevé', max: 'max' };
function effortOf(v) {
  const level = typeof v === 'string' ? v : v && typeof v === 'object' ? v.level : '';
  return Object.hasOwn(EFFORTS, level) ? level : '';
}

/** Slash commands that only set something up: no title in them. */
const SETUP_COMMANDS = /^\/(clear|compact|model|effort|resume|continue|config|init|login|logout|cost|status|help|memory|mcp|permissions|agents|hooks|rename|exit|quit|ide|theme|vim|doctor|context|usage|add-dir|plugins?|output-style|statusline|terminal-setup|fast|rewind|export|bug|feedback|release-notes|upgrade|privacy-settings|sandbox|todos|tasks|bashes)\b/i;

/**
 * The user's own words in a prompt, for a card title: blocks Claude Code or an
 * IDE inject (<system-reminder>, <ide_selection>…), slash-command wrappers,
 * pasted-text and image markers are dropped; a set-up command gives nothing.
 */
function promptTitle(text, max = 80) {
  let t = String(text || '');
  const name = t.match(/<command-name>\s*([^<]*?)\s*<\/command-name>/i);
  if (name) {
    const args = (t.match(/<command-args>([\s\S]*?)<\/command-args>/i) || [])[1] || '';
    t = `${name[1].startsWith('/') ? name[1] : `/${name[1]}`} ${args}`;
  }
  t = t
    .replace(/<([a-z][\w-]*)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/?[a-z][\w-]*(?:\s[^>]*)?\/?>/gi, ' ')
    .replace(/\[(Image|Pasted text) #\d+[^\]]*\]/gi, ' ')
    .replace(/^\s*Caveat:[^\n]*\n?/i, '')
    .trim();
  if (SETUP_COMMANDS.test(t)) return '';
  const slash = t.match(/^\/[\w:.-]+(?:\s+([\s\S]*))?$/);
  if (slash) t = (slash[1] || '').trim();
  return clip(t, max);
}

/** Subagents of a session: s.agents = { agent_id: { type, tool, at } }. */
function agentSeen(s, p, now, tool = '') {
  const id = p?.agent_id;
  if (!id) return false;
  s.agents ||= {};
  const a = (s.agents[id] ||= { type: '', tool: '', at: now });
  if (p.agent_type) a.type = String(p.agent_type).slice(0, 40);
  if (tool) a.tool = tool;
  a.at = now;
  const ids = Object.keys(s.agents);
  if (ids.length > 12) for (const k of ids.sort((x, y) => s.agents[x].at - s.agents[y].at).slice(0, ids.length - 12)) delete s.agents[k];
  return true;
}
function agentGone(s, p) {
  if (!p?.agent_id || !s.agents?.[p.agent_id]) return false;
  delete s.agents[p.agent_id];
  return true;
}
/** For the card: running subagents, busiest first; one silent for `staleMs` is dropped. */
function agentList(s, now, staleMs = 20 * 60000) {
  for (const [id, a] of Object.entries(s.agents || {})) if (now - a.at > staleMs) delete s.agents[id];
  return Object.entries(s.agents || {})
    .map(([id, a]) => ({ id, type: a.type || 'agent', tool: a.tool || '', at: a.at }))
    .sort((a, b) => b.at - a.at);
}

// ── « Ranger »: sessions put away until they move again ──────────────────

const STOWABLE = ['idle', 'finished', 'waiting', 'error', 'ratelimit', 'ended'];
const WAKE_EVENTS = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'SessionStart', 'SubagentStart'];
/** Does this hook event show the session at work again (it comes back to the list)? */
const wakes = (p) => !!p && (p.ambrosia_kind === 'ask' || WAKE_EVENTS.includes(p.hook_event_name));
/** Stowed sessions are remembered a week: stowed = { id: at }. */
function pruneStowed(stowed, now, days = 7) {
  for (const [id, at] of Object.entries(stowed || {})) if (now - at > days * 86400000) delete stowed[id];
  return stowed;
}

/** The Claude Code process of a session, in its ancestry (procs.chain): claude.exe, or node for an npm install. */
function claudePid(info) {
  const i = (info?.names || []).findIndex((n) => /^(claude|node)(\.exe)?$/i.test(n));
  return i >= 0 ? info.pids[i] : 0;
}

module.exports = {
  SETTLE_GRACE_MS, callKey, trackCall, callOf, settledBy,
  stalledSince, runningTool, contextLevel, shortModel, effortOf, EFFORTS, promptTitle, agentSeen, agentGone, agentList,
  STOWABLE, wakes, pruneStowed, claudePid,
  clip, applyTodos, taskCreated, taskCompleted, newTurnProgress, sensitive,
  newTurn, addEdit, addTest, testCounts, relPath, turnFiles, liveFiles, summarizeTurn, parseGit, GIT_ARGS,
  EDIT_TOOLS, TICKER, tickerPush, displayNames, shortName, delta, tickerParts,
  DIFF_CAPS, splitLines, diffLines, diffRows, foldRows, lineOf, editFromInput, storeEdit, fileDiff, parseUnified, pathUnder, quotable,
  parseNumstat, unquoteGit, parseUntracked, gitCatchup, addCatchup,
};
