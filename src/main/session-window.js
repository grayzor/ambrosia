// « Aller au terminal »: which window (and which Windows Terminal tab) holds a
// Claude Code session, then bring it forward.
//
// Inputs: the session's process chain (procs.chain from the claude pid: claude.exe,
// the shell, WindowsTerminal.exe / Code.exe / the Claude app…), its entrypoint, its
// name and folder. procs.focusBySurvey lists the windows and the Windows Terminal
// tabs; `decide()` below picks, in JS (pure, tests/session-window.test.js):
//
//   * Windows Terminal: the tab whose title is the session's. Claude Code titles its
//     tab "✳ <session name>" (◐ / ◑ while it works); Ambrosia's own launches start as
//     "Claude · <dossier>". Only a unique match is selected, else just the window.
//     A dead link in the chain (the shell that started claude is gone) does not
//     matter: every Windows Terminal window is searched by tab title.
//   * VS Code / Cursor: the window whose title names the session's folder
//     ("fichier - <dossier> - Visual Studio Code").
//   * Claude Desktop: claude://code/continue?session=<local_…> opens the session in
//     the app (hostSessionId from ~/.claude/sessions), and its main window comes forward.
//   * Otherwise the first window owned by the chain (classic console…).
// Last resort: the folder opens in VS Code (`code "<dossier>"`, path checked).

const fs = require('fs');
const path = require('path');

const TERMINALS = /^(windowsterminal|openconsole|wezterm-gui|alacritty|tabby|hyper|conemu64|conemu|mintty|warp)(\.exe)?$/i;
const EDITORS = /^(code|code - insiders|cursor|windsurf|vscodium|codium)(\.exe)?$/i;
const WT_CLASS = 'CASCADIA_HOSTING_WINDOW_CLASS';

/** "✳ verify-stock", "◐ Claude · ambrosia" → "verify-stock", "claude · ambrosia" (spinner glyphs and case off). */
function normTitle(t) {
  return String(t || '')
    .replace(/^[\s✳◐◑·*✢✶✻✽⠀-⣿]+/u, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** What hosts the session: 'wt' | 'terminal' | 'editor' | 'desktop' | 'console'. */
function hostKind({ names = [], entrypoint = '', term = '' } = {}) {
  const n = names.map((x) => String(x).toLowerCase());
  if (/desktop/i.test(entrypoint)) return 'desktop';
  if (n.some((x) => /^windowsterminal(\.exe)?$/.test(x))) return 'wt';
  if (n.some((x) => EDITORS.test(x)) || /vscode|cursor/i.test(`${entrypoint} ${term}`)) return 'editor';
  if (n.some((x) => TERMINALS.test(x))) return 'terminal';
  if (/windows terminal/i.test(term)) return 'wt';
  return 'console';
}

/** Titles the session's tab may carry, most specific first. */
function wantedTitles({ name = '', project = '' } = {}) {
  const out = [];
  if (name) out.push(name);
  if (project) out.push(`Claude · ${project}`);
  return [...new Set(out.map(normTitle).filter((t) => t.length >= 3))];
}

/**
 * The tab of `tabs` ([{ h, i, name }]) for one of `wanted` (normalized titles, in order).
 * Exact title first, then "contains"; ambiguous (two tabs) → null. `prefer` = window
 * handles of the session's own Windows Terminal, which break a tie.
 */
function pickTab(tabs, wanted, prefer = []) {
  const unique = (list) => {
    if (list.length === 1) return list[0];
    const mine = list.filter((t) => prefer.includes(t.h));
    return mine.length === 1 ? mine[0] : null;
  };
  for (const w of wanted) {
    const exact = tabs.filter((t) => normTitle(t.name) === w);
    if (exact.length) return unique(exact);
  }
  for (const w of wanted) {
    if (w.length < 6) continue;
    const near = tabs.filter((t) => normTitle(t.name).includes(w));
    if (near.length) return unique(near);
  }
  return null;
}

/** VS Code-like window for a folder: one " - " segment of the title is the folder's name. */
function pickEditorWindow(windows, cwd) {
  const folder = path.win32.basename(String(cwd || '').replace(/[\\/]+$/, '')).toLowerCase();
  if (!folder) return null;
  const segs = (t) => String(t || '').split(/\s+[-—–]\s+/).map((s) => s.replace(/\s*\((workspace|espace de travail)\)$/i, '').trim().toLowerCase());
  return windows.find((w) => EDITORS.test(w.proc) && segs(w.title).includes(folder)) || null;
}

/** The Claude app's main window (Electron: Chrome_WidgetWin_1, process "claude"). */
function pickDesktopWindow(windows) {
  const app = windows.filter((w) => /^claude(\.exe)?$/i.test(w.proc) && w.cls === 'Chrome_WidgetWin_1');
  return app.find((w) => /^claude$/i.test(w.title.trim())) || app[0] || null;
}

/** First window owned by the chain, in chain order (the session's terminal before its parents). */
function pickChainWindow(windows, pids) {
  for (const pid of pids || []) {
    const w = windows.find((x) => x.pid === pid);
    if (w) return w;
  }
  return null;
}

/**
 * The decision: { h, tab: { i, name } | null, via } or null.
 * @param {{ windows, tabs }} survey   from procs.focusBySurvey
 * @param {object} t                   { pids, names, entrypoint, term, name, project, cwd }
 */
function decide(survey, t) {
  const windows = survey?.windows || [];
  const tabs = survey?.tabs || [];
  const kind = hostKind(t);
  const pids = t.pids || [];
  const chainWin = pickChainWindow(windows, pids);
  const wanted = wantedTitles(t);

  if (kind === 'desktop') {
    const w = pickDesktopWindow(windows) || chainWin;
    return w ? { h: w.h, tab: null, via: 'desktop' } : null;
  }
  if (kind === 'editor') {
    const w = pickEditorWindow(windows, t.cwd) || chainWin;
    if (w) return { h: w.h, tab: null, via: 'editor' };
  }
  // Windows Terminal (also when the chain is cut: claude outlived the shell that started it).
  if (kind === 'wt' || (kind === 'console' && !chainWin) || (chainWin && chainWin.cls === WT_CLASS)) {
    const own = windows.filter((w) => w.cls === WT_CLASS && pids.includes(w.pid)).map((w) => w.h);
    const tab = wanted.length ? pickTab(tabs, wanted, own) : null;
    if (tab) return { h: tab.h, tab: { i: tab.i, name: tab.name }, via: 'tab' };
    const w = chainWin || (own.length ? windows.find((x) => x.h === own[0]) : null);
    if (w) return { h: w.h, tab: null, via: 'window' };
    return null;
  }
  return chainWin ? { h: chainWin.h, tab: null, via: 'window' } : null;
}

/** claude://code/continue?session=local_… (Claude Desktop's own deep link to one session). */
function desktopSessionLink(hostSessionId) {
  return /^local_[A-Za-z0-9-]{1,64}$/.test(String(hostSessionId || '')) ? `claude://code/continue?session=${hostSessionId}` : null;
}

/** A folder `code "<dir>"` may receive through cmd.exe: absolute, existing, nothing cmd would read. */
function codeFolder(cwd, exists = (p) => fs.existsSync(p) && fs.statSync(p).isDirectory()) {
  const d = String(cwd || '').trim();
  if (!d || !path.win32.isAbsolute(d) || /["%!^&|<>\r\n]/.test(d)) return null;
  try {
    return exists(d) ? d : null;
  } catch {
    return null;
  }
}

/**
 * Brings the session forward. `t` = { pids, names, entrypoint, term, name, project, cwd, hostSessionId }.
 * → { ok, how: 'tab' | 'window' | 'editor' | 'desktop' | 'code', label, tabMissed?, error? }
 */
async function gotoSession(t, { openExternal, log = () => {} } = {}) {
  const procs = require('./procs');
  const kind = hostKind(t);
  let linked = false;
  if (kind === 'desktop') {
    const link = desktopSessionLink(t.hostSessionId);
    if (link) {
      const r = await require('./claude-desktop')
        .openLink(link, { openExternal })
        .catch(() => ({ ok: false }));
      linked = !!r.ok;
    }
  }
  const r = await procs.focusBySurvey((survey) => decide(survey, t));
  const d = r.decision;
  if (r.ok && d) {
    const label = d.via === 'desktop' ? 'Claude' : d.via === 'editor' ? 'VS Code' : 'Terminal';
    return { ok: true, how: d.via, label, tabMissed: !!d.tab && r.tab === false };
  }
  if (r.error) log('focus', r.error);
  if (kind === 'desktop') {
    if (linked) return { ok: true, how: 'desktop', label: 'Claude' };
    if (openExternal) {
      await openExternal('claude://');
      return { ok: true, how: 'desktop', label: 'Claude', fallback: true };
    }
  }
  // Nothing on screen holds the session: its folder in VS Code (coucou does the same).
  const dir = codeFolder(t.cwd);
  if (dir) {
    const ok = await new Promise((resolve) => {
      const { spawn } = require('child_process');
      const child = spawn(`code "${dir}"`, { shell: true, detached: true, windowsHide: true, stdio: 'ignore' });
      child.once('error', () => resolve(false));
      child.once('spawn', () => {
        child.unref();
        resolve(true);
      });
    });
    if (ok) return { ok: true, how: 'code', label: 'VS Code', fallback: true };
  }
  return {
    ok: false,
    error: d ? 'Windows a refusé de mettre la fenêtre au premier plan.' : 'Fenêtre introuvable : la session a peut-être été fermée.',
  };
}

module.exports = { normTitle, hostKind, wantedTitles, pickTab, pickEditorWindow, pickDesktopWindow, pickChainWindow, decide, desktopSessionLink, codeFolder, gotoSession };
