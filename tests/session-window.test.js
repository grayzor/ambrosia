const test = require('node:test');
const assert = require('node:assert');
const W = require('../src/main/session-window');
const { asciiJson } = require('../src/main/procs');

// A survey shaped like procs.focusBySurvey's (taken on a real desktop, anonymised).
const WT = { h: 2820842, pid: 25788, proc: 'WindowsTerminal', cls: 'CASCADIA_HOSTING_WINDOW_CLASS', title: '✳ verify-stocksync-full-stock', min: true };
const WT2 = { h: 999, pid: 25788, proc: 'WindowsTerminal', cls: 'CASCADIA_HOSTING_WINDOW_CLASS', title: '◐ Claude · ambrosia', min: false };
const CODE = { h: 133648, pid: 19432, proc: 'Code', cls: 'Chrome_WidgetWin_1', title: 'main.js - HelpDesk - Visual Studio Code', min: true };
const DESK = { h: 67266, pid: 19444, proc: 'claude', cls: 'Chrome_WidgetWin_1', title: 'Claude', min: false };
const CONSOLE = { h: 5555, pid: 30, proc: 'cmd', cls: 'ConsoleWindowClass', title: 'C:\\Windows\\system32\\cmd.exe - claude', min: false };
const survey = {
  windows: [{ h: 1, pid: 2, proc: 'chrome', cls: 'Chrome_WidgetWin_1', title: 'Mail', min: false }, DESK, WT, CODE, WT2, CONSOLE],
  tabs: [
    { h: WT.h, i: 0, name: '✳ verify-stocksync-full-stock', sel: true },
    { h: WT.h, i: 1, name: '✳ Claude Code', sel: false },
    { h: WT2.h, i: 0, name: 'PowerShell', sel: false },
    { h: WT2.h, i: 1, name: '◐ Claude · ambrosia', sel: true },
  ],
};

test('normTitle: Claude Code’s spinner glyphs and case off', () => {
  assert.equal(W.normTitle('✳ verify-stocksync-full-stock'), 'verify-stocksync-full-stock');
  assert.equal(W.normTitle('◐  Claude ·  ambrosia '), 'claude · ambrosia');
  assert.equal(W.normTitle('◑ Fix bug'), 'fix bug');
});

test('hostKind: from the process chain, then the entrypoint', () => {
  assert.equal(W.hostKind({ names: ['claude.exe', 'pwsh.exe', 'WindowsTerminal.exe'] }), 'wt');
  assert.equal(W.hostKind({ names: ['claude.exe', 'Code.exe'] }), 'editor');
  assert.equal(W.hostKind({ names: [], entrypoint: 'claude-vscode' }), 'editor');
  assert.equal(W.hostKind({ names: ['claude.exe', 'claude.exe'], entrypoint: 'claude-desktop' }), 'desktop');
  assert.equal(W.hostKind({ names: ['claude.exe', 'cmd.exe'] }), 'console');
  assert.equal(W.hostKind({ names: ['claude.exe', 'wezterm-gui.exe'] }), 'terminal');
});

test('pickTab: exact title, unique; ambiguous → nothing', () => {
  const want = W.wantedTitles({ name: 'verify-stocksync-full-stock', project: 'HelpDesk' });
  assert.deepEqual(W.pickTab(survey.tabs, want), survey.tabs[0]);
  assert.deepEqual(W.pickTab(survey.tabs, W.wantedTitles({ project: 'ambrosia' })), survey.tabs[3]);
  const twice = [...survey.tabs, { h: 7, i: 0, name: '✳ verify-stocksync-full-stock' }];
  assert.equal(W.pickTab(twice, want), null);
  assert.deepEqual(W.pickTab(twice, want, [7]), twice[4], 'the session’s own window breaks the tie');
  assert.equal(W.pickTab(survey.tabs, W.wantedTitles({ name: 'ab' })), null, 'too short to trust');
});

test('decide: Windows Terminal tab, even when the chain is cut', () => {
  // Chain intact: claude → pwsh → WindowsTerminal.
  const d = W.decide(survey, { pids: [40, 31, 25788], names: ['claude.exe', 'pwsh.exe', 'WindowsTerminal.exe'], name: 'verify-stocksync-full-stock', project: 'HelpDesk' });
  assert.deepEqual(d, { h: WT.h, tab: { i: 0, name: '✳ verify-stocksync-full-stock' }, via: 'tab' });
  // The shell that started claude is gone: only claude.exe left in the chain.
  const cut = W.decide(survey, { pids: [4468, 28516], names: ['claude.exe', 'claude.exe'], entrypoint: 'cli', name: 'verify-stocksync-full-stock', project: 'HelpDesk' });
  assert.equal(cut.via, 'tab');
  assert.equal(cut.h, WT.h);
  // No tab matches: the session's own terminal window.
  const win = W.decide(survey, { pids: [40, 25788], names: ['claude.exe', 'WindowsTerminal.exe'], name: 'autre chose', project: 'x' });
  assert.deepEqual(win, { h: WT.h, tab: null, via: 'window' });
});

test('decide: VS Code window by folder, Claude Desktop, classic console', () => {
  assert.deepEqual(W.decide(survey, { pids: [50], names: ['claude.exe'], entrypoint: 'claude-vscode', cwd: 'C:\\Users\\n\\Documents\\HelpDesk' }), { h: CODE.h, tab: null, via: 'editor' });
  assert.equal(W.decide(survey, { pids: [50], names: ['claude.exe'], entrypoint: 'claude-vscode', cwd: 'C:\\Users\\n\\Documents\\Autre' }), null);
  assert.deepEqual(W.decide(survey, { pids: [10252, 19444], names: ['claude.exe', 'claude.exe'], entrypoint: 'claude-desktop' }), { h: DESK.h, tab: null, via: 'desktop' });
  assert.deepEqual(W.decide(survey, { pids: [40, 30], names: ['claude.exe', 'cmd.exe'] }), { h: CONSOLE.h, tab: null, via: 'window' });
  assert.equal(W.decide({ windows: [], tabs: [] }, { pids: [1] }), null);
});

test('pickEditorWindow: a folder segment of the title, workspace suffix tolerated', () => {
  const ws = { ...CODE, title: 'ambrosia (Workspace) - Visual Studio Code' };
  assert.equal(W.pickEditorWindow([ws], 'C:\\x\\ambrosia\\'), ws);
  assert.equal(W.pickEditorWindow([{ ...CODE, proc: 'chrome' }], 'C:\\x\\HelpDesk'), null);
  assert.equal(W.pickEditorWindow([{ ...CODE, proc: 'Cursor', title: 'a.ts — HelpDesk — Cursor' }], 'C:\\x\\HelpDesk').proc, 'Cursor');
});

test('desktopSessionLink and codeFolder: only safe values', () => {
  assert.equal(W.desktopSessionLink('local_46d84f0b-1fb4-45c3-b919-8a08a80d4fe2'), 'claude://code/continue?session=local_46d84f0b-1fb4-45c3-b919-8a08a80d4fe2');
  assert.equal(W.desktopSessionLink('local_../../x'), null);
  assert.equal(W.desktopSessionLink(''), null);
  const yes = () => true;
  assert.equal(W.codeFolder('C:\\Users\\n\\Mes projets\\ambrosia', yes), 'C:\\Users\\n\\Mes projets\\ambrosia');
  assert.equal(W.codeFolder('C:\\x" & calc', yes), null);
  assert.equal(W.codeFolder('C:\\100%', yes), null);
  assert.equal(W.codeFolder('relatif\\dossier', yes), null);
  assert.equal(W.codeFolder('C:\\absent', () => false), null);
});

test('asciiJson: what the PowerShell script reads on stdin stays ASCII', () => {
  const s = asciiJson({ tab: { name: '✳ Vérifier' } });
  assert.ok(/^[\x20-\x7e]*$/.test(s));
  assert.deepEqual(JSON.parse(s), { tab: { name: '✳ Vérifier' } });
});
