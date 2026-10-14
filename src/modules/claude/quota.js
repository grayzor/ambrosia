// Claude plan gauges: the 5-hour and weekly windows of a claude.ai subscription.
//
// Source: the statusLine relay (hook/ambrosia-statusline.js), which forwards
// `rate_limits.five_hour` / `seven_day` = { used_percentage 0–100, resets_at
// (epoch seconds) }. Claude Code only sends them to Pro/Max subscribers, after
// the first API answer of a session. Without them, a fallback counts today's
// tokens per project from the transcripts (~/.claude/projects/**/*.jsonl), with
// no percentage. Pure logic except scanUsage (fs only), tested in tests/quota.test.js.

const fs = require('fs');
const path = require('path');

const WINDOWS = [
  ['five_hour', '5 h'],
  ['seven_day', 'Semaine'],
];

const empty = () => ({ five_hour: null, seven_day: null, updatedAt: 0, warned: {}, celebrated: {} });

/**
 * Takes a `rate_limits` object in. Returns the events it triggers:
 *   { type: 'warn', key, pct, resetsAt }   crossed the warning threshold (once per window)
 *   { type: 'reset', key }                 a window that was high started afresh
 */
function ingest(q, rl, now, warnAt = 80) {
  const events = [];
  if (!rl || typeof rl !== 'object') return events;
  q.warned ||= {};
  q.celebrated ||= {};
  for (const [key] of WINDOWS) {
    const w = rl[key];
    if (!w || !Number.isFinite(Number(w.used_percentage))) continue;
    const pct = Math.max(0, Math.min(100, Number(w.used_percentage)));
    const resetsAt = Number(w.resets_at) > 0 ? Number(w.resets_at) * 1000 : 0;
    const prev = q[key];
    const sameWindow = prev && Math.abs((prev.resetsAt || 0) - resetsAt) < 5 * 60000;
    // A new window while the old one was high: the plan is back.
    if (prev && !sameWindow && resetsAt > (prev.resetsAt || 0) && wasHigh(prev, warnAt) && q.celebrated[key] !== prev.resetsAt) {
      q.celebrated[key] = prev.resetsAt;
      events.push({ type: 'reset', key });
    }
    q[key] = { pct, resetsAt, seenAt: now, hit: sameWindow ? !!prev.hit : false, peak: Math.max(pct, sameWindow ? prev.peak || 0 : 0) };
    if (warnAt > 0 && pct >= warnAt && q.warned[key] !== resetsAt) {
      q.warned[key] = resetsAt;
      events.push({ type: 'warn', key, pct, resetsAt });
    }
  }
  q.updatedAt = now;
  return events;
}

const wasHigh = (w, warnAt) => !!w && (w.hit || (warnAt > 0 && (w.peak ?? w.pct) >= warnAt));

/** Time passes: a window whose reset time is behind us is reset, even without new data. */
function tick(q, now, warnAt = 80) {
  const events = [];
  q.celebrated ||= {};
  for (const [key] of WINDOWS) {
    const w = q[key];
    if (!w || !w.resetsAt || w.resetsAt > now || w.done) continue;
    w.done = true;
    if (wasHigh(w, warnAt) && q.celebrated[key] !== w.resetsAt) {
      q.celebrated[key] = w.resetsAt;
      events.push({ type: 'reset', key });
    }
  }
  return events;
}

/** A "usage limit reached" notification: the windows near the top are the culprits. */
function markHit(q) {
  const hot = WINDOWS.map(([k]) => q[k]).filter((w) => w && !w.done);
  const top = hot.filter((w) => w.pct >= 90);
  for (const w of top.length ? top : hot) w.hit = true;
}

/** "2 h 14", "3 j 5 h", "12 min". */
function countdown(ms) {
  if (!(ms > 0)) return 'maintenant';
  const min = Math.ceil(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ${String(min % 60).padStart(2, '0')}`;
  return `${Math.floor(h / 24)} j ${h % 24} h`;
}

/** Length of each window, for the linear pace. */
const SPAN = { five_hour: 5 * 3600000, seven_day: 7 * 24 * 3600000 };

/**
 * What the view draws: one gauge per window. `level`: ok | mid | warn | bad.
 * `pace`: the share of the window already gone (0–100), where a steady use would
 * stand now; above it, the plan is spent faster than the clock.
 */
function gauges(q, now, warnAt = 80) {
  if (!q) return [];
  const out = [];
  for (const [key, label] of WINDOWS) {
    const w = q[key];
    if (!w) continue;
    const reset = w.done || (w.resetsAt && w.resetsAt <= now);
    const pct = reset ? 0 : Math.round(w.pct);
    out.push({
      key,
      label,
      pct,
      resetsAt: reset ? 0 : w.resetsAt,
      reset,
      level: w.hit && !reset ? 'bad' : pct >= Math.max(warnAt, 1) ? (pct >= 95 ? 'bad' : 'warn') : pct >= warnAt * 0.75 ? 'mid' : 'ok',
      stale: now - (w.seenAt || 0) > 6 * 3600000,
      pace: !reset && w.resetsAt ? Math.round(Math.max(0, Math.min(1, 1 - (w.resetsAt - now) / SPAN[key])) * 100) : null,
    });
  }
  return out;
}

// ── Fallback: today's tokens, from the transcripts ─────────────────────────

const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const base = (p) => String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop();

/**
 * Adds the usage of today's new transcript lines to `cache` (incremental: each
 * file is read from where the previous scan stopped). Assistant rows repeat the
 * same `usage` for every content block of one answer: deduplicated by message id.
 * cache = { day, files: { path: offset }, seen: { msgId: 1 }, projects: { name: { tokens, cacheRead } } }
 */
function scanUsage(projectsDir, cache, now = new Date()) {
  const day = dayKey(now);
  if (cache.day !== day) Object.assign(cache, { day, files: {}, seen: {}, projects: {} });
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  let dirs = [];
  try {
    dirs = fs.readdirSync(projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return cache;
  }
  for (const d of dirs) {
    const dir = path.join(projectsDir, d.name);
    let files = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const f of files) {
      const file = path.join(dir, f);
      let st;
      try {
        st = fs.statSync(file);
      } catch {
        continue;
      }
      if (st.mtimeMs < start) continue;
      const from = Math.min(cache.files[file] || 0, st.size);
      if (st.size <= from) continue;
      readRows(file, from, st.size, (row) => addRow(cache, row, start));
      cache.files[file] = st.size;
    }
  }
  return cache;
}

function readRows(file, from, to, onRow) {
  const len = Math.min(to - from, 64 * 1024 * 1024);
  let buf;
  try {
    const fd = fs.openSync(file, 'r');
    buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, from);
    fs.closeSync(fd);
  } catch {
    return;
  }
  for (const line of buf.toString('utf8').split('\n')) {
    if (!line.includes('"usage"')) continue;
    try {
      onRow(JSON.parse(line));
    } catch {
      /* partial line */
    }
  }
}

function addRow(cache, row, start) {
  if (row?.type !== 'assistant' || !row.message?.usage) return;
  const at = Date.parse(row.timestamp || '');
  if (!(at >= start)) return;
  const id = row.message.id || row.uuid;
  if (id) {
    if (cache.seen[id]) return;
    cache.seen[id] = 1;
  }
  const u = row.message.usage;
  const name = base(row.cwd) || 'Session';
  const p = (cache.projects[name] ||= { tokens: 0, cacheRead: 0 });
  p.tokens += (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0);
  p.cacheRead += u.cache_read_input_tokens || 0;
}

/** Sorted list for the view: [{ project, tokens, cacheRead }]. */
function usageList(cache) {
  return Object.entries(cache?.projects || {})
    .map(([project, v]) => ({ project, ...v }))
    .filter((p) => p.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens);
}

/** 1 234 567 → "1,2 M". */
function tokens(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace('.', ',')} M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} k`;
  return String(n);
}

module.exports = { WINDOWS, SPAN, empty, ingest, tick, markHit, gauges, countdown, scanUsage, usageList, tokens, dayKey };
