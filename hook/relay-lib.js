// Small, synchronous helpers for the hook relay. Everything here must stay cheap
// (a few string splits, at most one small file read): the relay runs on every
// tool call of every Claude Code session. Shared with the claude module's tests.

'use strict';
const fs = require('fs');
const path = require('path');

const MAX_READ = 2 * 1024 * 1024;

function lines(text) {
  const s = String(text ?? '').replace(/\r\n/g, '\n');
  if (!s) return [];
  return s.replace(/\n$/, '').split('\n');
}

/**
 * +N −M between two texts, as a multiset of lines: a moved line counts for
 * nothing, a changed line for +1 −1. Close to `git diff --stat`, without an LCS.
 */
function countDiff(oldText, newText) {
  const bag = new Map();
  for (const l of lines(oldText)) bag.set(l, (bag.get(l) || 0) + 1);
  let add = 0;
  for (const l of lines(newText)) {
    const n = bag.get(l);
    if (n) bag.set(l, n - 1);
    else add++;
  }
  let del = 0;
  for (const n of bag.values()) del += n;
  return { add, del };
}

/** Line stats of an Edit / MultiEdit / Write, computed before the relay truncates long fields. */
function editStats(tool, input) {
  const info = editInfo(tool, input, false);
  return info && info.stats;
}

// What the island needs to show the diff of an edit, cut to a reasonable size:
// the relay hands it over as is (other long fields are cut at 4000 characters).
const EDIT_CAP = 60000; // characters per text
const EDIT_TOTAL = 150000; // per event (the pipe takes 512 KB per message)
const MAX_BLOCKS = 50;

/**
 * { stats: { file, add, del, created? }, edit: { tool, blocks: [{ old, new, cut, all? }], omitted, created? } }.
 * The Write's previous content is read once, for both. `withEdit` false: stats only.
 */
function editInfo(tool, input, withEdit = true) {
  if (!input || typeof input !== 'object') return null;
  const file = typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : '';
  if (!file) return null;
  let left = EDIT_TOTAL;
  const cap = (v) => {
    const s = typeof v === 'string' ? v : '';
    const n = Math.max(0, Math.min(EDIT_CAP, left));
    left -= Math.min(s.length, n);
    return s.length > n ? [s.slice(0, n), true] : [s, false];
  };
  const block = (o, n, extra) => {
    const [a, c1] = cap(o);
    const [b, c2] = cap(n);
    return { old: a, new: b, cut: c1 || c2, ...extra };
  };
  const out = (stats, blocks, more = {}) => ({ stats, edit: withEdit ? { tool, blocks, omitted: 0, ...more } : null });
  if (tool === 'NotebookEdit') {
    // One cell; what it replaced is in the notebook, not in the input.
    const stats = { file, add: input.edit_mode === 'delete' ? 0 : lines(input.new_source).length, del: 0 };
    return out(stats, withEdit ? [block('', input.edit_mode === 'delete' ? '' : input.new_source, { cell: String(input.cell_id || '') })] : []);
  }
  if (tool === 'Edit') {
    const stats = { file, ...countDiff(input.old_string, input.new_string) };
    return out(stats, withEdit ? [block(input.old_string, input.new_string, input.replace_all ? { all: true } : {})] : []);
  }
  if (tool === 'MultiEdit' && Array.isArray(input.edits)) {
    const stats = { file, add: 0, del: 0 };
    const blocks = [];
    for (const e of input.edits) {
      const d = countDiff(e && e.old_string, e && e.new_string);
      stats.add += d.add;
      stats.del += d.del;
      if (withEdit && blocks.length < MAX_BLOCKS && left > 0) blocks.push(block(e && e.old_string, e && e.new_string, e && e.replace_all ? { all: true } : {}));
    }
    return out(stats, blocks, { omitted: withEdit ? input.edits.length - blocks.length : 0 });
  }
  if (tool === 'Write') {
    let old = '';
    try {
      const st = fs.statSync(file);
      if (st.isFile() && st.size <= MAX_READ) old = fs.readFileSync(file, 'utf8');
    } catch {
      /* new file */
    }
    const stats = { file, ...countDiff(old, input.content), created: !old };
    return out(stats, withEdit ? [block(old, input.content)] : [], { created: !old });
  }
  return null;
}

const TEST_RE =
  /(^|[\s;&|(/\\])((npm|pnpm|yarn|bun)\s+(run\s+)?test\b|npx\s+(jest|vitest|mocha|playwright)\b|(jest|vitest|mocha|pytest|phpunit|rspec)\b|python\s+-m\s+(pytest|unittest)\b|go\s+test\b|cargo\s+test\b|dotnet\s+test\b|mvn\s+(\S+\s+)*test\b|gradlew?\s+(\S+\s+)*test\b|node\s+--test\b|deno\s+test\b|make\s+test\b|tox\b)/i;

/** Does this shell command run a test suite? */
function isTestCommand(cmd) {
  return typeof cmd === 'string' && TEST_RE.test(cmd);
}

/** The few lines of a test run that say how it went ("# pass 42", "3 failed, 40 passed"…). */
function testTail(text) {
  const tail = String(text || '').slice(-6000).split(/\r?\n/);
  const keep = tail.filter((l) => /\b(pass(ed|ing)?|fail(ed|ing|ures?)?|tests?|errors?)\b/i.test(l) && /\d/.test(l));
  return keep.slice(-3).map((l) => l.trim().slice(0, 160)).join('\n');
}

// ── Queued instructions ("Glisser une consigne") ───────────────────────────
// Ambrosia drops one file per instruction in <local>/nudges: `<session>~<id>.json`.
// The relay claims them with an atomic rename, so a note is delivered once,
// even when two hooks of the same session run in parallel. No pipe round trip:
// the relay never waits for Ambrosia to know whether there is something to say.

const safeId = (s) => String(s || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);

function claimNudges(dir, sessionId) {
  const sid = safeId(sessionId);
  if (!sid) return [];
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (!name.startsWith(sid + '~') || !name.endsWith('.json')) continue;
    const from = path.join(dir, name);
    const taken = `${from}.${process.pid}.taken`;
    try {
      fs.renameSync(from, taken);
    } catch {
      continue; // another hook got it first
    }
    try {
      const n = JSON.parse(fs.readFileSync(taken, 'utf8'));
      if (n && typeof n.text === 'string' && n.text.trim()) out.push({ id: String(n.id || ''), text: n.text.trim().slice(0, 4000), at: Number(n.at) || 0 });
    } catch {
      /* unreadable: dropped */
    }
    try {
      fs.unlinkSync(taken);
    } catch {
      /* ignore */
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** The text Claude reads (hookSpecificOutput.additionalContext). */
function nudgeContext(nudges) {
  if (!nudges.length) return '';
  const head = 'Note de l’utilisateur, ajoutée pendant que tu travaillais';
  if (nudges.length === 1) return `${head} : ${nudges[0].text}`;
  return `${head} (${nudges.length} notes) :\n${nudges.map((n) => `- ${n.text}`).join('\n')}`;
}

module.exports = { countDiff, editStats, editInfo, EDIT_CAP, EDIT_TOTAL, isTestCommand, testTail, claimNudges, nudgeContext, safeId };
