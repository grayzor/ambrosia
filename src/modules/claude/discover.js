// Sessions without hooks: what Claude Code itself writes in ~/.claude/sessions.
//
// Each running `claude` keeps <pid>.json there (pid, sessionId, cwd, startedAt,
// procStart = creation FILETIME, kind, entrypoint "cli" | "claude-desktop" |
// "claude-vscode"…, name, status "busy" | "idle" | "waiting" + waitingFor,
// updatedAt, statusUpdatedAt, hostSessionId = the Claude app's "local_…" id).
// The *.key files next to them are secrets: never opened.
//
// Ambrosia reads these files at startup, on change (fs.watch) and every 30 s, so a
// session started before Ambrosia (or before the hooks, or after a crash) shows up
// at once instead of at its next hook event. Hooks stay the source of truth:
// discovery only creates sessions it has never seen, fills blanks, ends sessions
// whose process is gone, and fixes a state left stale by a missed Stop hook.
// The tail of the transcript (64 KB at most) gives the last prompt and activity.
//
// Pure parts are exported for tests/claude-discover.test.js; `attach()` is the
// runtime the Claude module plugs in.

const fs = require('fs');
const os = require('os');
const path = require('path');

const SCAN_MS = 30000;
const TAIL_BYTES = 64 * 1024;
/** A "working" session whose file says idle, with no hook for this long, missed its Stop. */
const STALE_MS = 60000;
/** The file must be newer than the last hook by this much to correct it (clock skew, ordering). */
const NEWER_MS = 3000;

const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};
const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
const base = (p) => String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop();

/** One session file → a clean record, or null (torn write, other kind, missing fields). */
function parseRecord(text) {
  let o;
  try {
    o = JSON.parse(String(text || '').replace(/^﻿/, ''));
  } catch {
    return null;
  }
  if (!o || typeof o !== 'object') return null;
  const pid = num(o.pid);
  if (!pid || typeof o.sessionId !== 'string' || !o.sessionId || typeof o.cwd !== 'string' || !o.cwd) return null;
  // Interactive sessions only: background workers and SDK runs are not the user's terminals.
  if (o.kind && o.kind !== 'interactive') return null;
  return {
    pid,
    sessionId: o.sessionId.slice(0, 80),
    cwd: o.cwd,
    startedAt: num(o.startedAt),
    procStart: /^\d{12,20}$/.test(String(o.procStart || '')) ? String(o.procStart) : '',
    entrypoint: typeof o.entrypoint === 'string' ? o.entrypoint : '',
    name: typeof o.name === 'string' ? clip(o.name, 80) : '',
    status: typeof o.status === 'string' ? o.status : '',
    waitingFor: typeof o.waitingFor === 'string' ? o.waitingFor : '',
    updatedAt: num(o.updatedAt),
    statusUpdatedAt: num(o.statusUpdatedAt),
    hostSessionId: typeof o.hostSessionId === 'string' && /^local_[A-Za-z0-9-]{1,64}$/.test(o.hostSessionId) ? o.hostSessionId : '',
    version: typeof o.version === 'string' ? o.version : '',
  };
}

/** Where the session runs, as the card's pill says it. */
function sourceLabel(entrypoint) {
  const e = String(entrypoint || '').toLowerCase();
  if (e.includes('desktop')) return 'Claude Desktop';
  if (e.includes('vscode') || e.includes('cursor') || e.includes('jetbrains') || e.includes('ide')) return 'VS Code';
  return 'Terminal';
}

/** Ambrosia's own `claude -p` calls run in %LOCALAPPDATA%\Ambrosia\work: never shown. */
function isInternal(cwd, internalDir) {
  if (!internalDir) return false;
  const norm = (p) => path.win32.normalize(String(p || '')).replace(/[\\/]+$/, '').toLowerCase();
  const c = norm(cwd);
  const d = norm(internalDir);
  return c === d || c.startsWith(d + '\\');
}

/** FILETIME string → epoch ms (same as procs.filetimeMs, kept here so tests need no procs). */
function filetimeMs(ft) {
  if (!/^\d{12,20}$/.test(String(ft || ''))) return 0;
  return Number(BigInt(ft) / 10000n) - 11644473600000;
}

/**
 * Is the process of `rec` the one that wrote the file? A pid alone lies: Windows
 * reuses them (a crashed session's file can point at an unrelated process).
 * `proc` = { name, start } from the process table, or null if the pid is gone.
 */
function sameProcess(rec, proc) {
  if (!proc) return false;
  const a = filetimeMs(rec.procStart);
  const b = filetimeMs(proc.start);
  if (a && b) return Math.abs(a - b) < 2000;
  return /claude|node|bun/i.test(proc.name || '');
}

/** The module's state for a file status. waiting → not "approval": only a hook can answer. */
function mapStatus(status) {
  if (status === 'busy' || status === 'shell') return 'working';
  if (status === 'waiting') return 'waiting';
  if (status === 'idle') return 'idle';
  return '';
}

function waitingLabel(waitingFor) {
  if (/permission|sandbox|worker/i.test(waitingFor)) return 'attend une autorisation';
  if (/input/i.test(waitingFor)) return 'attend ta réponse';
  return 'attend';
}

/** Last activity we know of: the file's own clocks and the transcript's last line. */
function lastActivity(rec, tail) {
  return Math.max(rec.updatedAt || 0, rec.statusUpdatedAt || 0, rec.startedAt || 0, tail?.at || 0);
}

/**
 * Last user prompt, last assistant text and last timestamp of a transcript tail
 * (JSONL; the first line may be cut). Tool results, meta lines, slash commands
 * and subagents' lines are skipped.
 */
function tailInfo(text) {
  const out = { prompt: '', lastMessage: '', at: 0 };
  const lines = String(text || '').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || line[0] !== '{') continue;
    let j;
    try {
      j = JSON.parse(line);
    } catch {
      continue;
    }
    if (!out.at) out.at = Date.parse(j.timestamp) || 0;
    // Claude Code also appends { type: "last-prompt", lastPrompt } after each turn.
    if (j.type === 'last-prompt' && typeof j.lastPrompt === 'string' && !out.prompt) {
      out.prompt = clip(j.lastPrompt, 400);
      continue;
    }
    if (j.isSidechain || j.isMeta) continue;
    const c = j.message?.content;
    const textOf = (blocks) => (typeof blocks === 'string' ? blocks : Array.isArray(blocks) ? blocks.filter((x) => x?.type === 'text').map((x) => x.text).join('\n') : '');
    if (j.type === 'assistant' && !out.lastMessage) {
      const t = textOf(c).trim();
      if (t) out.lastMessage = t.slice(0, 3000);
    } else if (j.type === 'user' && !out.prompt) {
      if (Array.isArray(c) && c.some((x) => x?.type === 'tool_result')) continue;
      const clean = textOf(c).replace(/<([a-z][\w-]*)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').trim();
      if (clean && !/^<|^\/[a-z]/i.test(clean)) out.prompt = clip(clean, 400);
    }
    if (out.prompt && out.lastMessage) break;
  }
  return out;
}

/** ~/.claude/projects/<slug>: every character outside [A-Za-z0-9] becomes "-". */
const projectSlug = (cwd) => String(cwd || '').replace(/[^A-Za-z0-9]/g, '-');

/** A new session card from a file (same shape as the hook-made ones in main.js). */
function newSession(rec, tail, now = Date.now()) {
  const state = mapStatus(rec.status) || 'idle';
  const s = {
    id: rec.sessionId,
    cwd: rec.cwd,
    project: base(rec.cwd) || 'Session',
    state,
    steps: [],
    prompt: tail?.prompt || '',
    lastMessage: tail?.lastMessage || '',
    startedAt: rec.startedAt || now,
    updatedAt: lastActivity(rec, tail) || now,
    entrypoint: rec.entrypoint,
    term: sourceLabel(rec.entrypoint),
    name: rec.name,
    pid: rec.pid,
    hostSessionId: rec.hostSessionId,
    discovered: true,
  };
  s.steps.push({ at: now, label: `Repérée sans hook (${s.term})${state === 'waiting' ? ` · ${waitingLabel(rec.waitingFor)}` : ''}` });
  return s;
}

/**
 * A session the hooks already know: the file only corrects a state the hooks left
 * behind (a Stop or a Notification that never came). Returns { state, note } or null.
 * `pending` = an approval / question card is open for it (the hooks are talking).
 */
function reconcile(s, rec, now = Date.now(), pending = false) {
  const target = mapStatus(rec.status);
  if (!target || target === s.state || pending) return null;
  if (['approval', 'question', 'ended', 'error', 'ratelimit'].includes(s.state)) return null;
  const hookAt = s.hookAt || s.updatedAt || 0;
  if (!(rec.statusUpdatedAt > hookAt + NEWER_MS)) return null;
  if (target === 'idle') {
    if (!['working', 'thinking'].includes(s.state) || now - hookAt < STALE_MS) return null;
    return { state: 'idle', note: '↺ au repos (fin de tour manquée par les hooks)' };
  }
  if (target === 'working') {
    if (!['idle', 'finished', 'waiting'].includes(s.state)) return null;
    return { state: 'working', note: '↺ au travail (vu dans ~/.claude/sessions)' };
  }
  if (target === 'waiting') {
    if (!['working', 'thinking'].includes(s.state)) return null;
    return { state: 'waiting', note: `↺ ${waitingLabel(rec.waitingFor)}` };
  }
  return null;
}

/**
 * The newest record per session id (a /clear keeps the pid, a resume can reuse an id),
 * without internal ones.
 */
function latestBySession(records, internalDir) {
  const out = new Map();
  for (const r of records) {
    if (!r || isInternal(r.cwd, internalDir)) continue;
    const prev = out.get(r.sessionId);
    if (!prev || (r.updatedAt || 0) > (prev.updatedAt || 0)) out.set(r.sessionId, r);
  }
  return out;
}

// ── Runtime ─────────────────────────────────────────────────────────────────

function readTail(file, bytes = TAIL_BYTES) {
  const st = fs.statSync(file);
  const len = Math.min(st.size, bytes);
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.size - len);
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Plugs discovery into the Claude module.
 * @param {object} o
 * @param {Map} o.sessions              the module's sessions (id → card), mutated here
 * @param {(id) => boolean} o.pending   an approval / question waits for this session
 * @param {(s, pid) => void} o.track    remember the session's process (for « Aller au terminal »)
 * @param {(s) => void} o.end           the process is gone: same as a SessionEnd hook
 * @param {(s, label) => void} o.step
 * @param {() => void} o.publish
 * @param {() => object} o.settings
 * @param {(...a) => void} o.log
 * @returns {{ stop(), forget(id), scan() }}
 */
function attach(o) {
  const procs = o.procs || require('../../main/procs'); // injectable for tests
  const home = process.env.USERPROFILE || os.homedir();
  const dir = o.dir || path.join(home, '.claude', 'sessions');
  const projectsDir = o.projectsDir || path.join(home, '.claude', 'projects');
  const internalDir = o.internalDir ?? require('../../main/paths').workDir;
  const verified = new Map(); // `${pid}:${procStart}` → { ok, at }: identity checked against the process table
  const tails = new Map(); // session id → { file, mtime, size, info }
  const forgotten = new Map(); // session id → last activity when the user clicked « Oublier »
  let busy = false;
  let again = false;

  function readRecords() {
    let names = [];
    try {
      names = fs.readdirSync(dir).filter((f) => /^\d+\.json$/.test(f)); // never the *.key files
    } catch {
      return [];
    }
    const out = [];
    for (const f of names) {
      try {
        const r = parseRecord(fs.readFileSync(path.join(dir, f), 'utf8'));
        if (r) out.push(r);
      } catch {
        /* removed meanwhile */
      }
    }
    return out;
  }

  /** Alive and the same process: kill(0) each time, the process table when the pair is new or every 5 min. */
  async function aliveSet(records) {
    const alive = new Set();
    const toCheck = [];
    for (const r of records) {
      if (!procs.exists(r.pid)) continue;
      const k = `${r.pid}:${r.procStart}`;
      const v = verified.get(k);
      if (v && Date.now() - v.at < 5 * 60000) {
        if (v.ok) alive.add(k);
      } else toCheck.push([k, r]);
    }
    if (toCheck.length && (process.platform === 'win32' || o.procs)) {
      const table = await procs.table().catch(() => null);
      for (const [k, r] of toCheck) {
        const ok = table && table.size ? sameProcess(r, table.get(r.pid)) : true; // no table: trust kill(0)
        verified.set(k, { ok, at: Date.now() });
        if (ok) alive.add(k);
      }
    } else for (const [k] of toCheck) alive.add(k);
    if (verified.size > 400) for (const [k, v] of verified) if (Date.now() - v.at > 10 * 60000) verified.delete(k);
    return alive;
  }

  function tailOf(rec) {
    try {
      let t = tails.get(rec.sessionId);
      if (!t) {
        let file = path.join(projectsDir, projectSlug(rec.cwd), `${rec.sessionId}.jsonl`);
        if (!fs.existsSync(file)) {
          // Long paths get another slug: look for the file in every project folder once.
          file = null;
          for (const d of fs.readdirSync(projectsDir)) {
            const f = path.join(projectsDir, d, `${rec.sessionId}.jsonl`);
            if (fs.existsSync(f)) {
              file = f;
              break;
            }
          }
        }
        t = { file, mtime: 0, size: 0, info: null };
        tails.set(rec.sessionId, t);
      }
      if (!t.file) return null;
      const st = fs.statSync(t.file);
      if (st.mtimeMs !== t.mtime || st.size !== t.size) {
        t.info = tailInfo(readTail(t.file));
        t.info.at = Math.max(t.info.at || 0, st.mtimeMs);
        Object.assign(t, { mtime: st.mtimeMs, size: st.size });
      }
      return t.info;
    } catch {
      return null;
    }
  }

  async function scan() {
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    try {
      const now = Date.now();
      const all = readRecords();
      const aliveKeys = await aliveSet(all);
      const live = latestBySession(all.filter((r) => aliveKeys.has(`${r.pid}:${r.procStart}`)), internalDir);
      const deadPids = new Set(all.filter((r) => !aliveKeys.has(`${r.pid}:${r.procStart}`)).map((r) => r.pid));
      const livePids = new Set([...live.values()].map((r) => r.pid));
      const forgetMs = (Number(o.settings().forgetAfterMin) || 180) * 60000;
      let changed = false;

      for (const rec of live.values()) {
        const s = o.sessions.get(rec.sessionId);
        const tail = s && !s.discovered ? null : tailOf(rec);
        const act = lastActivity(rec, tail);
        if (!s) {
          if (forgotten.has(rec.sessionId) && forgotten.get(rec.sessionId) >= act) continue;
          const active = ['working', 'waiting'].includes(mapStatus(rec.status));
          if (!active && now - act > forgetMs) continue; // asleep for hours: the user does not need it
          forgotten.delete(rec.sessionId);
          const fresh = newSession(rec, tail, now);
          o.sessions.set(fresh.id, fresh);
          o.track(fresh, rec.pid);
          changed = true;
          continue;
        }
        // Known session: blanks only, the hooks have the rest.
        const fill = { pid: rec.pid, hostSessionId: rec.hostSessionId, name: rec.name };
        for (const [k, v] of Object.entries(fill)) {
          if (v && s[k] !== v) {
            s[k] = v;
            changed = true;
          }
        }
        if (!s.entrypoint && rec.entrypoint) s.entrypoint = rec.entrypoint;
        if (!s.term) s.term = sourceLabel(rec.entrypoint);
        o.track(s, rec.pid);
        if (s.discovered) {
          // Still no hook: the file and the transcript are all we have.
          const state = mapStatus(rec.status) || s.state;
          if (state !== s.state) {
            s.state = state;
            if (state === 'waiting') o.step(s, `⏸ ${waitingLabel(rec.waitingFor)}`);
            changed = true;
          }
          if (tail && (tail.prompt !== s.prompt || tail.lastMessage !== s.lastMessage)) {
            s.prompt = tail.prompt || s.prompt;
            s.lastMessage = tail.lastMessage || s.lastMessage;
            changed = true;
          }
          if (act > s.updatedAt) {
            s.updatedAt = act;
            changed = true;
          }
        } else {
          const fix = reconcile(s, rec, now, o.pending(s.id));
          if (fix) {
            s.state = fix.state;
            s.updatedAt = Math.max(s.updatedAt, rec.statusUpdatedAt);
            o.step(s, fix.note);
            changed = true;
          }
        }
      }

      // Gone: a discovered session no file lists any more, or a session whose process died.
      for (const s of [...o.sessions.values()]) {
        if (s.state === 'ended' || o.pending(s.id)) continue;
        const gone = s.discovered ? !live.has(s.id) : !!s.pid && !livePids.has(s.pid) && (deadPids.has(s.pid) || !procs.exists(s.pid));
        if (gone) {
          o.end(s);
          changed = true;
        }
      }
      if (changed) o.publish();
    } catch (err) {
      o.log('discovery', err);
    } finally {
      busy = false;
      if (again) {
        again = false;
        setTimeout(scan, 500);
      }
    }
  }

  // fs.watch on Windows is reliable for one flat folder; the timer is the safety net.
  let watcher = null;
  let debounce = null;
  try {
    fs.mkdirSync(dir, { recursive: true });
    watcher = fs.watch(dir, (_ev, file) => {
      if (file && !/\.json$/i.test(String(file))) return;
      clearTimeout(debounce);
      debounce = setTimeout(scan, 1500);
    });
    watcher.on('error', () => {
      watcher?.close();
      watcher = null;
    });
  } catch {
    watcher = null;
  }
  const timer = setInterval(scan, SCAN_MS);
  const first = setTimeout(scan, 1500);

  return {
    scan,
    /** « Oublier »: not rediscovered until it shows new activity. */
    forget(id) {
      const s = o.sessions.get(id);
      forgotten.set(id, s ? Math.max(s.updatedAt || 0, Date.now()) : Date.now());
      tails.delete(id);
    },
    stop() {
      clearInterval(timer);
      clearTimeout(first);
      clearTimeout(debounce);
      watcher?.close();
    },
  };
}

module.exports = {
  STALE_MS,
  parseRecord,
  sourceLabel,
  isInternal,
  filetimeMs,
  sameProcess,
  mapStatus,
  waitingLabel,
  lastActivity,
  tailInfo,
  projectSlug,
  newSession,
  reconcile,
  latestBySession,
  attach,
};
