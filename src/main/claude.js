// Ambrosia's only door to AI: the Claude Code CLI in headless mode (`claude -p`).
//
// It runs on the user's Claude subscription exactly like Claude Code does — no API
// key, no separate billing. Every internal call:
//   * runs in an empty scratch folder with `--setting-sources project`, so the
//     user's hooks (Ambrosia's own included) and CLAUDE.md files stay out of it;
//   * carries AMBROSIA_INTERNAL=1, which the hook relay ignores, belt and braces;
//   * gets no built-in tools unless the caller names them (`tools`), and only the
//     MCP tools listed in `allowedTools` — anything else is denied, never prompted.

const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const { store } = require('./store');
const log = require('./log').scope('claude');

let cachedPath = null;

// Every turn of the CLI ends with a `rate_limit_event` carrying the plan's real
// 5-hour and weekly use (`rate_limit_info.unifiedWindows`). Claude Desktop never
// runs the statusLine, so Ambrosia's own calls are the steady source of the gauges.
const rateListeners = new Set();
function onRateLimits(fn) {
  rateListeners.add(fn);
  return () => rateListeners.delete(fn);
}
function rateEvent(ev) {
  if (ev?.type !== 'rate_limit_event' || !ev.rate_limit_info) return;
  for (const fn of rateListeners) {
    try {
      fn(ev.rate_limit_info);
    } catch (err) {
      log('rate limits listener', err);
    }
  }
}

function versionKey(v) {
  return v.split('.').map((n) => n.padStart(6, '0')).join('.');
}

/** The newest claude.exe the Claude desktop app keeps in %APPDATA%\Claude\claude-code. */
function desktopBundled() {
  const base = path.join(process.env.APPDATA || '', 'Claude', 'claude-code');
  try {
    const versions = fs
      .readdirSync(base)
      .filter((d) => /^\d+\.\d+\.\d+/.test(d))
      .sort((a, b) => (versionKey(a) < versionKey(b) ? 1 : -1));
    for (const v of versions) {
      const dir = path.join(base, v);
      for (const sub of fs.readdirSync(dir)) {
        const exe = path.join(dir, sub, 'claude.exe');
        if (fs.existsSync(exe)) return exe;
      }
      const direct = path.join(dir, 'claude.exe');
      if (fs.existsSync(direct)) return direct;
    }
  } catch {
    /* no desktop app */
  }
  return null;
}

function fromPath() {
  for (const dir of (process.env.PATH || '').split(';')) {
    for (const name of ['claude.exe', 'claude.cmd']) {
      const p = path.join(dir.trim(), name);
      if (dir && fs.existsSync(p)) return p;
    }
  }
  const local = path.join(process.env.USERPROFILE || '', '.local', 'bin', 'claude.exe');
  return fs.existsSync(local) ? local : null;
}

/** Path of the CLI, or null. The desktop app updates its copy, so it is re-resolved hourly. */
function locate(force = false) {
  const configured = store.get('cli', 'path');
  if (configured) return fs.existsSync(configured) ? configured : null;
  if (!force && cachedPath && fs.existsSync(cachedPath)) return cachedPath;
  cachedPath = fromPath() || desktopBundled();
  return cachedPath;
}
setInterval(() => locate(true), 60 * 60 * 1000).unref();

/**
 * Kills the CLI and everything it started. On Windows a plain kill leaves its
 * MCP subprocesses alive, and they keep the stdout pipe (and 'close') hanging.
 */
function killTree(child) {
  if (!child || child.exitCode !== null) return;
  try {
    execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
  } catch {
    child.kill();
  }
}

function baseEnv() {
  return { ...process.env, AMBROSIA_INTERNAL: '1', CLAUDE_CODE_ENTRYPOINT: 'ambrosia' };
}

function isAuthProblem(text) {
  return /authenticat|oauth|log ?in|not logged|invalid api key|credential/i.test(text || '');
}

/** `{ loggedIn, authMethod, ... }` from `claude auth status`, or `{ loggedIn:false, error }`. */
function authStatus() {
  const cli = locate();
  if (!cli) return Promise.resolve({ loggedIn: false, error: 'CLI Claude introuvable' });
  return new Promise((resolve) => {
    execFile(cli, ['auth', 'status'], { env: baseEnv(), windowsHide: true, timeout: 15000 }, (err, stdout) => {
      try {
        resolve({ cli, ...JSON.parse(stdout) });
      } catch {
        resolve({ cli, loggedIn: false, error: err ? err.message : 'réponse illisible' });
      }
    });
  });
}

/**
 * Lines of `claude mcp list`, parsed to `{ name, status }`. Slow (it health-checks
 * every server), so callers cache the answer.
 */
function listMcp() {
  const cli = locate();
  if (!cli) return Promise.resolve([]);
  return new Promise((resolve) => {
    execFile(
      cli,
      ['mcp', 'list'],
      { cwd: paths.workDir, env: baseEnv(), windowsHide: true, timeout: 90000 },
      (err, stdout) => {
        const out = [];
        for (const row of String(stdout || '').split(/\r?\n/)) {
          const m = row.match(/^(.+?):\s+(.*?)\s+-\s+(.*)$/);
          if (m) out.push({ name: m[1].trim(), target: m[2], status: m[3].trim() });
        }
        if (err && !out.length) log('mcp list failed:', err.message);
        resolve(out);
      },
    );
  });
}

/** The tool-name prefix Claude Code gives an MCP server: `mcp__<name with _>__`. */
function mcpPrefix(serverName) {
  return `mcp__${serverName.replace(/[^a-zA-Z0-9_-]/g, '_')}__`;
}

function buildArgs(o, format) {
  const args = ['-p', '--output-format', format, '--model', o.model || store.get('cli', 'fastModel')];
  // User settings stay loaded (claude.ai connectors need them) but no hook fires:
  // neither Ambrosia's own relay nor any other tool the user wired to Claude Code.
  args.push('--settings', JSON.stringify({ disableAllHooks: true }));
  args.push('--permission-prompts', 'none');
  args.push('--tools', o.tools ? o.tools.join(',') : '');
  if (o.allowedTools && o.allowedTools.length) args.push('--allowedTools', o.allowedTools.join(','));
  if (o.disallowedTools && o.disallowedTools.length) args.push('--disallowedTools', o.disallowedTools.join(','));
  if (o.systemPrompt) args.push('--system-prompt', o.systemPrompt);
  if (o.appendSystemPrompt) args.push('--append-system-prompt', o.appendSystemPrompt);
  if (o.jsonSchema) args.push('--json-schema', JSON.stringify(o.jsonSchema));
  if (o.effort) args.push('--effort', o.effort);
  for (const dir of o.addDirs || []) args.push('--add-dir', dir);
  if (o.resume) args.push('--resume', o.resume);
  if (!o.persist && !o.resume) args.push('--no-session-persistence');
  if (format === 'stream-json') args.push('--verbose');
  if (o.partial) args.push('--include-partial-messages');
  return args;
}

// A small queue: Ambrosia's background jobs never run more than two CLIs at once.
const MAX_PARALLEL = 2;
let running = 0;
const waiting = [];
function slot() {
  if (running < MAX_PARALLEL) {
    running++;
    return Promise.resolve();
  }
  return new Promise((r) => waiting.push(r));
}
function release() {
  const next = waiting.shift();
  if (next) next();
  else running--;
}

/**
 * One headless turn. Resolves (never rejects) to
 * `{ ok, text, structured, sessionId, error, authError, costUsd }`.
 *
 * @param {object} o
 * @param {string} o.prompt
 * @param {string} [o.model]        alias or full id; defaults to settings.cli.fastModel
 * @param {string[]} [o.tools]      built-in tools to enable (default: none)
 * @param {string[]} [o.allowedTools]  tools allowed without a prompt (MCP read tools…)
 * @param {object} [o.jsonSchema]   structured output; result in `structured`
 * @param {number} [o.timeoutMs]    default 180 s
 * @param {string} [o.requireMcp]   MCP server the turn needs (e.g. "claude.ai Gmail"): if it
 *                                  was not ready and none of its tools ran, the result is
 *                                  `{ ok:false, mcpNotReady:true }` instead of a made-up answer.
 */
async function run(o) {
  if (!o.requireMcp) return runOnce(o, 0);
  // claude.ai connectors connect in the background and headless mode does not wait
  // for them: the prompt goes in after a warm-up. If the connector is still not
  // connected when the turn starts, the CLI is stopped at once (no wasted turn)
  // and started again with a longer warm-up; the last try runs regardless.
  const warmups = [12000, 30000, 60000];
  let res;
  for (let i = 0; i < warmups.length; i++) {
    res = await runOnce(o, warmups[i], i < warmups.length - 1);
    if (!res.mcpNotReady) return res;
    log(`${o.requireMcp} not ready after ${warmups[i] / 1000} s`);
  }
  return res;
}

async function runOnce(o, warmupMs, abortIfPending = false) {
  const cli = locate();
  if (!cli) return { ok: false, error: 'CLI Claude introuvable — installe Claude Code ou indique son chemin dans les réglages.' };
  await slot();
  const started = Date.now();
  try {
    return await new Promise((resolve) => {
      const args = buildArgs(o, 'stream-json');
      if (warmupMs) args.push('--input-format', 'stream-json');
      const child = spawn(cli, args, { cwd: paths.workDir, env: baseEnv(), windowsHide: true });
      let stdout = '';
      let stderr = '';
      // What the CLI loaded and what the model actually called, for requireMcp.
      let mcpServers = [];
      const toolsUsed = [];
      const toolCalls = []; // { name, input }: lets a caller check what a write tool really received
      let lineBuf = '';
      let aborted = false;
      child.stdout.on('data', (d) => {
        lineBuf += d;
        let nl;
        while ((nl = lineBuf.indexOf('\n')) >= 0) {
          const row = lineBuf.slice(0, nl);
          lineBuf = lineBuf.slice(nl + 1);
          if (!row.startsWith('{')) continue;
          try {
            const ev = JSON.parse(row);
            rateEvent(ev);
            if (ev.type === 'system' && ev.subtype === 'init') {
              mcpServers = ev.mcp_servers || [];
              const needed = o.requireMcp && mcpServers.find((m) => m.name === o.requireMcp);
              if (abortIfPending && needed?.status !== 'connected') {
                aborted = true;
                killTree(child);
              }
            }
            if (ev.type === 'assistant') for (const c of ev.message?.content || []) if (c.type === 'tool_use') {
              toolsUsed.push(c.name);
              toolCalls.push({ name: c.name, input: c.input || {} });
            }
            if (ev.type === 'result') {
              stdout = row;
              if (warmupMs) child.stdin.end(); // one turn only: let the CLI exit
              // Safety net: the answer is in, do not wait on a lingering process.
              setTimeout(() => killTree(child), 5000);
            }
          } catch {
            /* not an event line */
          }
        }
      });
      let finished = false;
      const timer = setTimeout(() => {
        killTree(child);
        finish({ ok: false, error: 'délai dépassé' });
      }, (o.timeoutMs || 180000) + warmupMs);
      child.stderr.on('data', (d) => (stderr += d));
      child.on('error', (err) => finish({ ok: false, error: err.message }));
      // 'exit' rather than 'close': grandchildren may hold the pipes open.
      child.on('exit', () => setTimeout(() => finish(null), 150));
      function finish(early) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (early) return resolve({ ...early, toolsUsed, toolCalls, mcpServers });
        let res = aborted ? { ok: false } : parseResult(stdout, stderr);
        res.toolsUsed = toolsUsed;
        res.toolCalls = toolCalls;
        res.mcpServers = mcpServers;
        if (o.requireMcp) {
          const prefix = mcpPrefix(o.requireMcp);
          const server = mcpServers.find((m) => m.name === o.requireMcp);
          if (!toolsUsed.some((t) => t.startsWith(prefix)) && server?.status !== 'connected') {
            res = { ...res, ok: false, mcpNotReady: true, error: `Le connecteur « ${o.requireMcp} » n’est pas prêt (${server ? server.status : 'absent'}).` };
          }
        }
        log(`run ${o.model || 'fast'} ${Date.now() - started}ms ok=${res.ok}${res.error ? ' err=' + res.error : ''}`);
        resolve(res);
      }
      if (!warmupMs) child.stdin.end(o.prompt);
      else {
        const msg = { type: 'user', message: { role: 'user', content: o.prompt } };
        setTimeout(() => !child.killed && child.stdin.write(JSON.stringify(msg) + '\n'), warmupMs);
      }
    });
  } finally {
    release();
  }
}

function parseResult(stdout, stderr) {
  const trimmed = stdout.trim();
  const start = trimmed.lastIndexOf('\n{"');
  const jsonText = start >= 0 ? trimmed.slice(start + 1) : trimmed;
  let r;
  try {
    r = JSON.parse(jsonText);
  } catch {
    const msg = (stderr || stdout || 'réponse vide').trim().slice(0, 300);
    return { ok: false, error: msg, authError: isAuthProblem(msg) };
  }
  if (r.is_error) {
    const msg = String(r.result || r.subtype || 'erreur');
    return { ok: false, error: msg, authError: isAuthProblem(msg), sessionId: r.session_id };
  }
  let structured = r.structured_output ?? null;
  if (structured == null && typeof r.result === 'string') {
    const m = r.result.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        structured = JSON.parse(m[0]);
      } catch {
        /* free text answer */
      }
    }
  }
  return { ok: true, text: r.result || '', structured, sessionId: r.session_id, costUsd: r.total_cost_usd };
}

/**
 * A streamed turn for the chat. `onEvent({ type: 'delta', text })`, then
 * `{ type: 'done', sessionId, text }` or `{ type: 'error', error, authError }`.
 * Returns `{ cancel() }`.
 */
function stream(o, onEvent) {
  const cli = locate();
  if (!cli) {
    onEvent({ type: 'error', error: 'CLI Claude introuvable' });
    return { cancel() {} };
  }
  const child = spawn(cli, buildArgs({ ...o, persist: true, partial: true }, 'stream-json'), {
    cwd: paths.workDir,
    env: baseEnv(),
    windowsHide: true,
  });
  let buf = '';
  let full = '';
  let sessionId = o.resume || null;
  let finished = false;
  const finish = (ev) => {
    if (finished) return;
    finished = true;
    onEvent(ev);
  };
  child.stdout.on('data', (d) => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const row = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!row) continue;
      let ev;
      try {
        ev = JSON.parse(row);
      } catch {
        continue;
      }
      if (ev.session_id) sessionId = ev.session_id;
      rateEvent(ev);
      if (ev.type === 'stream_event' && ev.event?.type === 'content_block_delta' && ev.event.delta?.type === 'text_delta') {
        full += ev.event.delta.text;
        onEvent({ type: 'delta', text: ev.event.delta.text });
      } else if (ev.type === 'stream_event' && ev.event?.type === 'content_block_start' && ev.event.content_block?.type === 'tool_use') {
        onEvent({ type: 'tool', name: ev.event.content_block.name });
      } else if (ev.type === 'result') {
        if (ev.is_error) finish({ type: 'error', error: String(ev.result || 'erreur'), authError: isAuthProblem(ev.result) });
        else finish({ type: 'done', sessionId, text: ev.result || full });
        setTimeout(() => killTree(child), 5000);
      }
    }
  });
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  child.on('error', (err) => finish({ type: 'error', error: err.message }));
  // 'exit' rather than 'close': MCP subprocesses may keep the pipes open.
  child.on('exit', () => setTimeout(() => {
    if (!finished) {
      const msg = stderr.trim() || 'la CLI s’est arrêtée sans réponse';
      finish({ type: 'error', error: msg.slice(0, 300), authError: isAuthProblem(msg) });
    }
  }, 300));
  child.stdin.end(o.prompt);
  return {
    cancel() {
      finish({ type: 'error', error: 'annulé' });
      killTree(child);
    },
  };
}

/**
 * A conversation that stays open: one CLI process, a user message per turn on stdin
 * (`--input-format stream-json`), so a spoken exchange does not pay the CLI's start
 * at every sentence. `onEvent`: `{ type: 'delta', text, turn }`, `{ type: 'tool', name, turn }`,
 * `{ type: 'done', text, sessionId, turn }`, `{ type: 'error', error, authError, turn }`,
 * `{ type: 'closed', error }`. Turns are numbered from 1 in the order they were sent.
 * Returns `{ send(text) → turn, interrupt(), close() }`.
 */
function conversation(o, onEvent) {
  const cli = locate();
  if (!cli) {
    setImmediate(() => onEvent({ type: 'closed', error: 'CLI Claude introuvable' }));
    return { send: () => 0, interrupt() {}, close() {} };
  }
  const args = buildArgs({ ...o, persist: true, partial: true }, 'stream-json');
  args.push('--input-format', 'stream-json');
  const child = spawn(cli, args, { cwd: paths.workDir, env: baseEnv(), windowsHide: true });
  let sent = 0;
  let turn = 1; // the turn the CLI is answering now
  let full = '';
  let sessionId = o.resume || null;
  let closed = false;
  let stderr = '';
  let buf = '';
  child.stdin.on('error', () => {});
  child.stdout.on('data', (d) => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const row = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!row) continue;
      let ev;
      try {
        ev = JSON.parse(row);
      } catch {
        continue;
      }
      if (ev.session_id) sessionId = ev.session_id;
      rateEvent(ev);
      if (ev.type === 'stream_event' && ev.event?.type === 'content_block_delta' && ev.event.delta?.type === 'text_delta') {
        full += ev.event.delta.text;
        onEvent({ type: 'delta', text: ev.event.delta.text, turn });
      } else if (ev.type === 'stream_event' && ev.event?.type === 'content_block_start' && ev.event.content_block?.type === 'tool_use') {
        onEvent({ type: 'tool', name: ev.event.content_block.name, turn });
      } else if (ev.type === 'result') {
        if (ev.is_error && ev.subtype !== 'error_during_execution') onEvent({ type: 'error', error: String(ev.result || 'erreur'), authError: isAuthProblem(ev.result), turn });
        else onEvent({ type: 'done', text: ev.result || full, sessionId, turn, interrupted: ev.subtype === 'error_during_execution' });
        full = '';
        turn++;
      }
    }
  });
  child.stderr.on('data', (d) => (stderr += d));
  const close = (error) => {
    if (closed) return;
    closed = true;
    onEvent({ type: 'closed', error, sessionId });
  };
  child.on('error', (err) => close(err.message));
  child.on('exit', () => setTimeout(() => close(stderr.trim().slice(0, 300) || null), 200));
  log(`conversation ${o.model || 'fast'}${o.resume ? ' (suite)' : ''}`);
  return {
    send(text) {
      if (closed) return 0;
      child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: String(text) } }) + '\n');
      return ++sent;
    },
    /** Stops the answer being written (the next message is answered right after). */
    interrupt() {
      if (closed) return;
      child.stdin.write(JSON.stringify({ type: 'control_request', request_id: `int-${Date.now()}`, request: { subtype: 'interrupt' } }) + '\n');
    },
    close() {
      if (closed) return;
      child.stdin.end();
      setTimeout(() => killTree(child), 3000);
    },
  };
}

/**
 * The cmd.exe call behind openLoginTerminal. Verbatim arguments: otherwise Node
 * escapes the quoted title C-style (\"), cmd.exe misreads it and `start` looks
 * for a program named `Claude\`.
 */
function loginCommand(cli) {
  return {
    file: 'cmd.exe',
    args: ['/c', 'start', '"Connexion Claude"', 'cmd', '/k', `"${cli}" auth login`],
    options: { detached: true, windowsHide: false, shell: false, windowsVerbatimArguments: true },
  };
}

/** Opens a terminal running `claude auth login` so the user can sign in once. */
function openLoginTerminal() {
  const cli = locate();
  if (!cli) return false;
  const { file, args, options } = loginCommand(cli);
  spawn(file, args, options).unref();
  return true;
}

/**
 * Text safe inside one double-quoted cmd.exe argument: no quote, no %VAR%, no
 * delayed expansion, one line, and no trailing backslash (it would escape the
 * closing quote for claude.exe). Everything else (& | < > ^) is literal there.
 */
function cmdQuotable(text, max = 3000) {
  return String(text || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/"/g, '’')
    .replace(/[%!]/g, ' ')
    .replace(/[\x00-\x1f]/g, '')
    .slice(0, max)
    .replace(/\\+$/, '')
    .trim();
}

/**
 * Opens an interactive Claude Code session in `cwd` (a terminal window), started
 * with `prompt`. Plan mode by default: Claude reads and proposes, the user approves
 * before anything is changed. The session is the user's own (hooks, CLAUDE.md,
 * permissions of that project), so Ambrosia sees it like any other.
 */
function openSession({ cwd, prompt, title = 'Gany', planMode = true }) {
  const cli = locate();
  if (!cli || !cwd || !fs.existsSync(cwd)) return false;
  if (/["%!\r\n]/.test(cli + cwd)) return false;
  const args = [`"${cmdQuotable(title, 60) || 'Gany'}"`, '/D', `"${cwd.replace(/\\+$/, '')}"`, `"${cli}"`];
  if (planMode) args.push('--permission-mode', 'plan');
  args.push(`"${cmdQuotable(prompt)}"`);
  spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"start ${args.join(' ')}"`], {
    detached: true,
    windowsHide: false,
    windowsVerbatimArguments: true,
  }).unref();
  return true;
}

module.exports = { locate, authStatus, listMcp, mcpPrefix, run, stream, conversation, onRateLimits, openLoginTerminal, loginCommand, openSession, cmdQuotable };
