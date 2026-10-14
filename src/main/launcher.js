// Starts an INTERACTIVE Claude Code session for the user, in Windows Terminal.
//
// Unlike src/main/claude.js (headless background turns), this is the user's own
// session: their hooks, their settings, their permission mode. Ambrosia only opens
// the terminal; the session then shows up in the Claude module through the hooks.
//
// No user text ever goes through a shell command line:
//   * the CLI arguments (prompt included) are quoted here with the MSVC rules
//     (`quoteArg`) and written to a temporary file;
//   * the terminal runs `powershell.exe -EncodedCommand <base64>`: a script that
//     only holds paths (single-quoted), reads that file and hands it verbatim to
//     CreateProcess (ProcessStartInfo.Arguments). cmd.exe, wt.exe and PowerShell
//     never parse the prompt, so " & | % ^ ; and newlines are plain characters.
//
//   launch({ cwd, model, prompt, worktree, permissionMode, title }) →
//     { ok, sessionId, via: 'wt' | 'cmd', error }

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

/** Aliases accepted by `claude --model` (checked against `claude --help`, 2.1.x). */
const MODELS = [
  ['opus', 'Opus'],
  ['sonnet', 'Sonnet'],
  ['haiku', 'Haiku'],
  ['fable', 'Fable'],
];
/** Permission modes Ambrosia may ask for. Never bypassPermissions, dontAsk or auto. */
const MODES = ['plan', 'acceptEdits', 'manual'];
/** A Claude Code session id, the only thing `--resume` may receive from Ambrosia. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The whole command line is capped at 32 767 characters by Windows. */
const MAX_PROMPT = 24000;

// ── Pure helpers (tested in tests/launcher.test.js) ─────────────────────────

/**
 * One argument quoted for CreateProcess, so that the program's argv parser
 * (MSVC CRT / CommandLineToArgvW) gets it back unchanged. Same rules as libuv.
 */
function quoteArg(arg) {
  const a = String(arg);
  if (a === '') return '""';
  if (!/[\s"]/.test(a)) return a;
  let out = '"';
  let slashes = 0;
  for (const ch of a) {
    if (ch === '\\') {
      slashes++;
      continue;
    }
    if (ch === '"') {
      out += '\\'.repeat(slashes * 2 + 1) + '"';
    } else {
      out += '\\'.repeat(slashes) + ch;
    }
    slashes = 0;
  }
  return out + '\\'.repeat(slashes * 2) + '"';
}

const joinArgs = (args) => args.map(quoteArg).join(' ');

/** "Corriger l’export Mnémosyne !" → "corriger-l-export-mnemosyne" */
function slug(s, max = 32) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}

function worktreeName(title, rand = crypto.randomBytes(2).toString('hex')) {
  return ['gany', slug(title, 32), rand].filter(Boolean).join('-');
}

/**
 * The `claude` arguments. Throws on anything outside the whitelists.
 * The prompt goes last, after `--`, so a prompt starting with "-" stays a prompt.
 */
function claudeArgs(o) {
  const args = [];
  if (o.model) {
    if (!MODELS.some(([m]) => m === o.model)) throw new Error(`modèle inconnu : ${o.model}`);
    args.push('--model', o.model);
  }
  if (o.permissionMode) {
    if (!MODES.includes(o.permissionMode)) throw new Error(`mode de permission refusé : ${o.permissionMode}`);
    args.push('--permission-mode', o.permissionMode);
  }
  // `-r [value]` too: only a session id (uuid) ever goes after it. --fork-session = a copy under a new id.
  if (o.resume) {
    if (!UUID.test(String(o.resume))) throw new Error(`session à reprendre invalide : ${o.resume}`);
    args.push('--resume', String(o.resume));
    if (o.fork) args.push('--fork-session');
  } else if (o.fork) throw new Error('--fork-session sans session à reprendre');
  // `-w [name]` takes an optional value: always give one, never let it eat the next argument.
  if (o.worktree && !o.resume) args.push('--worktree', o.worktreeName || worktreeName(o.title));
  if (o.sessionId) args.push('--session-id', o.sessionId);
  if (o.name) args.push('--name', String(o.name).replace(/[\r\n]+/g, ' ').slice(0, 80));
  const prompt = cleanPrompt(o.prompt);
  if (prompt) args.push('--', prompt);
  return args;
}

/** CreateProcess cannot carry NUL; Windows line endings are folded. */
function cleanPrompt(p) {
  const s = String(p || '').replace(/\0/g, '').replace(/\r\n?/g, '\n').trim();
  if (s.length > MAX_PROMPT) throw new Error(`prompt trop long (${s.length} caractères, ${MAX_PROMPT} au plus)`);
  return s;
}

/**
 * A PowerShell single-quoted literal. PowerShell also closes such strings on the
 * typographic quotes ‘ ’ ‚ ‛, so those are doubled too.
 */
function psQuote(s) {
  return `'${String(s).replace(/['\u2018\u2019\u201A\u201B]/g, (q) => q + q)}'`;
}

/**
 * The script the terminal runs. It holds paths only; the arguments come from
 * `argsFile`, read as UTF-8 and passed verbatim to CreateProcess.
 * `prefix` = arguments placed before the file's (cli.js for an npm install).
 */
function psScript({ exe, prefix = '', cwd, argsFile, banner }) {
  return [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    'Remove-Item Env:AMBROSIA_INTERNAL, Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue',
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    banner ? `Write-Host ${psQuote(banner)} -ForegroundColor DarkYellow` : '',
    'try {',
    `  Set-Location -LiteralPath ${psQuote(cwd)}`,
    `  $file = ${psQuote(argsFile)}`,
    '  $argsLine = [System.IO.File]::ReadAllText($file, [System.Text.Encoding]::UTF8)',
    '  Remove-Item -LiteralPath $file -ErrorAction SilentlyContinue',
    '  $psi = New-Object System.Diagnostics.ProcessStartInfo',
    `  $psi.FileName = ${psQuote(exe)}`,
    `  $psi.Arguments = (${psQuote(prefix)} + ' ' + $argsLine).Trim()`,
    '  $psi.UseShellExecute = $false',
    `  $psi.WorkingDirectory = ${psQuote(cwd)}`,
    '  $proc = [System.Diagnostics.Process]::Start($psi)',
    '  $proc.WaitForExit()',
    '} catch {',
    "  Write-Host (\"Ambrosia n'a pas pu lancer Claude Code : \" + $_.Exception.Message) -ForegroundColor Red",
    '}',
  ]
    .filter(Boolean)
    .join('\r\n');
}

/** `-EncodedCommand` wants base64 of UTF-16LE: no quote, space or `;` left to parse. */
const encodePs = (script) => Buffer.from(script, 'utf16le').toString('base64');

/** Terminal tab title: no character Windows Terminal or cmd would interpret. */
const safeTitle = (t) => String(t || 'Claude Code').replace(/[;"^&|%<>\r\n\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Claude Code';

/** How to open the terminal: Windows Terminal first, a plain console window otherwise. */
function terminalCommands(encoded, title) {
  const ps = ['powershell.exe', '-NoLogo', '-NoProfile', '-NoExit', '-EncodedCommand', encoded];
  return {
    // No subcommand option beyond the title: wt.exe follows the user's own "new window/tab" preference.
    wt: { file: 'wt.exe', args: ['new-tab', '--title', safeTitle(title), ...ps] },
    // `start` opens a new console; only constants and base64 reach cmd.exe.
    cmd: { file: 'cmd.exe', line: `/d /s /c "start "Claude Code" ${ps.join(' ')}"` },
  };
}

/** Normalised folder, without trailing separator (keeps "C:\"). */
function normDir(p) {
  if (!p || typeof p !== 'string') return '';
  let d = path.win32.normalize(p.trim());
  if (d.length > 3) d = d.replace(/[\\/]+$/, '');
  return d;
}

/** A Claude Code worktree (`<repo>\.claude\worktrees\<name>`) stands for its repository. */
function mainRepo(p) {
  const d = normDir(p);
  const m = d.match(/^(.*?)[\\/]\.claude[\\/]worktrees[\\/][^\\/]+(?:[\\/].*)?$/i);
  return m ? m[1] : d;
}

/** True when `dir` or one of its parents holds a `.git` (folder, or file for a worktree). */
function isGitDir(dir, exists = fs.existsSync) {
  let d = normDir(dir);
  for (let i = 0; d && i < 40; i++) {
    if (exists(path.win32.join(d, '.git'))) return true;
    const up = path.win32.dirname(d);
    if (up === d) break;
    d = up;
  }
  return false;
}

// ── Launching ───────────────────────────────────────────────────────────────

/**
 * What to execute for the CLI path `claude.js` resolved. A native claude.exe is
 * run directly; an npm install (claude.cmd) is run as `node cli.js`, because a
 * .cmd would go through cmd.exe and re-parse the prompt.
 */
function executable(cli, exists = fs.existsSync, which = findOnPath) {
  if (!cli) return { error: 'CLI Claude introuvable : installe Claude Code ou indique son chemin dans Réglages → Claude.' };
  if (!/\.(cmd|bat)$/i.test(cli)) return { exe: cli, prefix: '' };
  const dir = path.win32.dirname(cli);
  const script = path.win32.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
  const node = [path.win32.join(dir, 'node.exe')].find((p) => exists(p)) || which('node.exe');
  if (exists(script) && node) return { exe: node, prefix: quoteArg(script) };
  return { error: 'Claude Code est installé via npm (claude.cmd) et son cli.js est introuvable : installe la version native (claude install) ou indique le chemin de claude.exe dans Réglages.' };
}

function findOnPath(name) {
  for (const dir of (process.env.PATH || '').split(';')) {
    const p = dir && path.join(dir.trim(), name);
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

// Sessions launched from here, waiting for their SessionStart hook.
const expected = new Map(); // sessionId → { cwd, at, onStart }
let listening = false;

function watchHooks() {
  if (listening) return;
  listening = true;
  require('./hook-server').on('hook', (ev) => {
    const p = ev?.payload || {};
    if (p.hook_event_name !== 'SessionStart' || !expected.size) return;
    let id = expected.has(p.session_id) ? p.session_id : null;
    // A CLI that ignored --session-id: same folder (or a worktree of it), started just now.
    if (!id) {
      const cwd = mainRepo(p.cwd).toLowerCase();
      for (const [k, v] of expected) if (v.cwd.toLowerCase() === cwd && Date.now() - v.at < (v.window || 120000)) id = k;
    }
    if (!id) return;
    const job = expected.get(id);
    expected.delete(id);
    try {
      job.onStart?.(p);
    } catch {
      /* a reaction must never break the hooks */
    }
  });
  setInterval(() => {
    for (const [k, v] of expected) if (Date.now() - v.at > 10 * 60000) expected.delete(k);
  }, 60000).unref();
}

function cleanOld(dir) {
  try {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (Date.now() - fs.statSync(p).mtimeMs > 86400000) fs.unlinkSync(p);
    }
  } catch {
    /* nothing to clean */
  }
}

function run(cmd, env) {
  return new Promise((resolve) => {
    const child = cmd.line
      ? spawn(cmd.file, [cmd.line], { windowsVerbatimArguments: true, detached: true, windowsHide: true, stdio: 'ignore', env })
      : spawn(cmd.file, cmd.args, { detached: true, windowsHide: false, stdio: 'ignore', env });
    child.once('error', (err) => resolve({ ok: false, error: err.message }));
    child.once('spawn', () => {
      child.unref();
      resolve({ ok: true });
    });
  });
}

/**
 * Opens a terminal on `claude` in `cwd`. Resolves (never rejects).
 * @param {object} o
 * @param {string} o.cwd               existing folder (the repository)
 * @param {string} [o.model]           one of MODELS (empty = the user's default)
 * @param {string} [o.prompt]          first message, sent as soon as the session starts
 * @param {boolean} [o.worktree]       `--worktree gany-<titre>-xxxx` (git repositories only)
 * @param {string} [o.permissionMode]  one of MODES (empty = the user's own setting)
 * @param {string} [o.title]           short label: worktree name, session name, tab title
 * @param {string} [o.resume]          session id to continue (`--resume <uuid>`, never a worktree)
 * @param {boolean} [o.fork]           with `resume`: a copy under a new id (`--fork-session`)
 * @param {(payload) => void} [o.onStart]  called on the session's SessionStart hook
 */
async function launch(o = {}) {
  const log = require('./log').scope('launch');
  try {
    const cwd = normDir(o.cwd);
    if (!cwd || !path.win32.isAbsolute(cwd)) return { ok: false, error: 'Choisis un dossier (chemin complet).' };
    if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) return { ok: false, error: `Dossier introuvable : ${cwd}` };
    if (o.worktree && !isGitDir(cwd)) return { ok: false, error: 'Ce dossier n’est pas un dépôt git : décoche « worktree isolé ».' };

    const cli = executable(require('./claude').locate());
    if (cli.error) return { ok: false, error: cli.error };

    // Resuming keeps the session's id (--session-id is only allowed with --fork-session) and its name.
    const resume = o.resume && !o.fork;
    const sessionId = resume ? String(o.resume) : crypto.randomUUID();
    const title = String(o.title || '').trim();
    const args = claudeArgs({
      model: o.model,
      permissionMode: o.permissionMode,
      worktree: !!o.worktree && !o.resume,
      resume: o.resume || '',
      fork: !!o.fork,
      title,
      sessionId: resume ? '' : sessionId,
      name: title && !resume ? `Gany · ${title}` : '',
      prompt: o.prompt,
    });

    const dir = path.join(require('./paths').local, 'launch');
    fs.mkdirSync(dir, { recursive: true });
    cleanOld(dir);
    const argsFile = path.join(dir, `${sessionId}.args`);
    fs.writeFileSync(argsFile, joinArgs(args), 'utf8');

    const repo = path.win32.basename(cwd) || cwd;
    const script = psScript({ exe: cli.exe, prefix: cli.prefix, cwd, argsFile, banner: `Gany lance Claude Code dans ${repo}…` });
    const cmds = terminalCommands(encodePs(script), `Claude · ${repo}`);
    const env = { ...process.env };
    delete env.AMBROSIA_INTERNAL;
    delete env.ELECTRON_RUN_AS_NODE;

    let via = 'wt';
    let res = await run(cmds.wt, env);
    if (!res.ok) {
      log('wt.exe unavailable:', res.error);
      via = 'cmd';
      res = await run(cmds.cmd, env);
    }
    if (!res.ok) {
      fs.rmSync(argsFile, { force: true });
      return { ok: false, error: `Impossible d’ouvrir un terminal : ${res.error}` };
    }
    watchHooks();
    expected.set(sessionId, { cwd: mainRepo(cwd), at: Date.now(), onStart: o.onStart });
    log(`session ${sessionId}${o.resume ? (o.fork ? ` (copy of ${o.resume})` : ' (resumed)') : ''} via ${via} in ${cwd} model=${o.model || '-'} worktree=${!!o.worktree} mode=${o.permissionMode || '-'} prompt=${String(o.prompt || '').length} chars`);
    return { ok: true, sessionId, via };
  } catch (err) {
    log('launch failed:', err);
    return { ok: false, error: err.message };
  }
}

// ── In Claude Desktop instead of a terminal ──────────────────────────────────

/**
 * Opens a new Claude Code session in the Claude Desktop app (Code tab), on `cwd`,
 * with `prompt` in its composer: the user reads it and sends it there. The link
 * carries no model, permission mode or worktree (the app has none of those
 * parameters: they are chosen in the app). A prompt too long for the link is
 * copied to the clipboard instead (`clipboard: true`). Resolves (never rejects).
 *   launchDesktop({ cwd, prompt, title, onStart }) → { ok, via: 'desktop', clipboard, error }
 */
async function launchDesktop(o = {}, deps = {}) {
  const log = require('./log').scope('launch');
  const desktop = deps.desktop || require('./claude-desktop');
  try {
    const cwd = normDir(o.cwd);
    if (!cwd || !path.win32.isAbsolute(cwd)) return { ok: false, error: 'Choisis un dossier (chemin complet).' };
    if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) return { ok: false, error: `Dossier introuvable : ${cwd}` };
    if (!(await desktop.available())) return { ok: false, error: 'Claude Desktop n’est pas installé (lien claude:// absent) : choisis « Terminal ».' };
    const prompt = cleanPrompt(o.prompt);
    const link = desktop.newSessionLink({ prompt, folder: cwd });
    if (link.clipboard) {
      const copy = deps.copy || ((t) => require('electron').clipboard.writeText(t));
      copy(prompt);
    }
    const res = await desktop.openLink(link.url);
    if (!res.ok) return { ok: false, error: res.error };
    // The app starts claude when the user sends: same folder within a few minutes = this launch.
    if (o.onStart) {
      watchHooks();
      expected.set(crypto.randomUUID(), { cwd: mainRepo(cwd), at: Date.now(), onStart: o.onStart, window: 10 * 60000 });
    }
    log(`desktop session in ${cwd} prompt=${prompt.length} chars${link.clipboard ? ' (clipboard)' : ''}`);
    return { ok: true, via: 'desktop', clipboard: !!link.clipboard };
  } catch (err) {
    log('desktop launch failed:', err);
    return { ok: false, error: err.message };
  }
}

module.exports = {
  launchDesktop,
  MODELS,
  MODES,
  MAX_PROMPT,
  quoteArg,
  joinArgs,
  slug,
  worktreeName,
  claudeArgs,
  cleanPrompt,
  psQuote,
  psScript,
  encodePs,
  safeTitle,
  terminalCommands,
  normDir,
  mainRepo,
  isGitDir,
  executable,
  launch,
};
