// Claude Desktop, reached through its `claude://` deep links (read-only research of
// the app's handler, 2.31226.x):
//
//   claude://code/new?q=<prompt>&folder=<dir>     new Claude Code session, prompt in
//       the composer (NOT sent: the user sends it). `prompt` is an alias of `q`;
//       `folder` and `file` may repeat. No model, permission mode or worktree
//       parameter: those are picked in the app. q is cut at 14 336 characters, and
//       a cold start with more than 26 624 bytes of argv is relaunched with the
//       link truncated (folders then dropped).
//   claude://code/continue?session=<local_…>      opens one session (its id in the app,
//       `hostSessionId` in ~/.claude/sessions/<pid>.json), or `last`.
//   claude://code/needs-input?session=<local_…>   the sessions waiting for the user.
//   claude://resume?session=<uuid>                imports a CLI session into the app.
//
// The handler is read from the registry and started with the link as its only
// argument, exactly what Windows does on a click: a running app gets it as a
// second instance. Shared by the routines (scheduled tasks), « Confier à Claude »
// and « Aller au terminal ».

const fs = require('fs');
const { execFile, spawn } = require('child_process');

/** Longest `q` the app keeps (characters, after decoding). */
const MAX_Q = 14336;
/** Above this many bytes of argv, a cold start relaunches the app with the link cut. */
const MAX_ARGV_BYTES = 26624;

let cached = null; // { at, promise }

/** The command Windows runs for claude:// links, e.g. "C:\…\claude.exe" "%1" → exe path, or null. */
function protocolHandler() {
  if (process.platform !== 'win32') return Promise.resolve(null);
  if (cached && Date.now() - cached.at < 5 * 60000) return cached.promise;
  const query = (root) =>
    new Promise((resolve) => {
      execFile('reg', ['query', `${root}\\Software\\Classes\\claude\\shell\\open\\command`, '/ve'], { windowsHide: true, timeout: 8000 }, (err, out) => {
        const m = !err && String(out).match(/REG_SZ\s+"?([^"\r\n]+?\.exe)"?/i);
        resolve(m && fs.existsSync(m[1]) ? m[1] : null);
      });
    });
  const promise = query('HKCU').then((exe) => exe || query('HKLM'));
  cached = { at: Date.now(), promise };
  return promise;
}

/** Longest link we hand over: the argv cap, minus room for the app's own path. */
const MAX_LINK = MAX_ARGV_BYTES - 1024;

/**
 * claude://code/new?q=…&folder=… for a new Claude Code session (pure). A prompt the
 * link cannot carry whole (over MAX_Q characters, or a link over MAX_LINK once
 * encoded: accents weigh 6 bytes) is never cut: the link opens the folder alone and
 * `clipboard: true` tells the caller to copy the prompt for the user to paste.
 * → { url, clipboard }
 */
function newSessionLink({ prompt = '', folder = '' } = {}) {
  const q = String(prompt || '');
  const make = (text) => {
    const parts = [];
    if (text) parts.push(`q=${encodeURIComponent(text)}`);
    if (folder) parts.push(`folder=${encodeURIComponent(folder)}`);
    return `claude://code/new${parts.length ? `?${parts.join('&')}` : ''}`;
  };
  const url = make(q);
  if (q.length <= MAX_Q && url.length <= MAX_LINK) return { url, clipboard: false };
  return { url: make(''), clipboard: true };
}

/** Is Claude Desktop installed (a claude:// handler that exists on disk)? */
const available = () => protocolHandler().then((exe) => !!exe);

/**
 * Opens the link in Claude Desktop. No handler → the shell, for short links only
 * (ShellExecute cuts long ones) → else { ok:false }.
 */
async function openLink(url, { openExternal } = {}) {
  const exe = await protocolHandler();
  if (exe) {
    try {
      spawn(exe, [url], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
      return { ok: true, via: 'handler' };
    } catch (err) {
      if (!openExternal) return { ok: false, error: err.message };
    }
  }
  if (openExternal && url.length < 2000) {
    await openExternal(url);
    return { ok: true, via: 'shell' };
  }
  return { ok: false, error: 'Claude Desktop introuvable (lien claude:// non enregistré).' };
}

module.exports = { MAX_Q, MAX_ARGV_BYTES, MAX_LINK, newSessionLink, protocolHandler, available, openLink };
