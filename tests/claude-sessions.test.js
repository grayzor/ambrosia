const test = require('node:test');
const assert = require('node:assert');
const L = require('../src/modules/claude/logic');

// ── Requests answered in the terminal ──────────────────────────────────────

const SID = 'sess-1';
const T0 = 1_000_000;
const pre = (id, tool, input, extra = {}) => ({ hook_event_name: 'PreToolUse', session_id: SID, tool_use_id: id, tool_name: tool, tool_input: input, ...extra });
const post = (id, tool, input, extra = {}) => ({ hook_event_name: 'PostToolUse', session_id: SID, tool_use_id: id, tool_name: tool, tool_input: input, ...extra });
const ask = (tool, input, extra = {}) => ({ hook_event_name: 'PermissionRequest', session_id: SID, tool_name: tool, tool_input: input, ...extra });

/** The pending item main.js builds from a PermissionRequest, bound to its PreToolUse. */
function request(calls, p, at) {
  const bound = L.callOf(calls, p);
  return { sessionId: SID, tool: p.tool_name, key: L.callKey(p.tool_name, p.tool_input), toolUseId: bound?.id || '', agentId: p.agent_id || bound?.agent || '', at };
}

test('a PermissionRequest is bound to its PreToolUse (same session, tool and input, newest)', () => {
  const calls = new Map();
  L.trackCall(calls, pre('t1', 'Bash', { command: 'ls' }), T0);
  L.trackCall(calls, pre('t2', 'Bash', { command: 'npm test' }), T0 + 10);
  L.trackCall(calls, pre('t3', 'Bash', { command: 'npm test' }, { agent_id: 'ag-1' }), T0 + 20);
  const b = L.callOf(calls, ask('Bash', { command: 'npm test' }));
  assert.equal(b.id, 't3');
  assert.equal(b.agent, 'ag-1', 'the subagent that asked, even though PermissionRequest does not say');
  assert.equal(L.callOf(calls, { ...ask('Bash', { command: 'npm test' }), session_id: 'other' }), null);
});

test('settled: the call itself ends (allowed or denied in the terminal), its own PreToolUse does not', () => {
  const calls = new Map();
  const p = pre('t1', 'Bash', { command: 'git push' });
  L.trackCall(calls, p, T0);
  const item = request(calls, ask('Bash', { command: 'git push' }), T0 + 50);
  assert.equal(L.settledBy(item, p, calls, T0 + 60), null);
  assert.equal(L.settledBy(item, post('t1', 'Bash', { command: 'git push' }), calls, T0 + 9000), 'PostToolUse');
  assert.equal(L.settledBy(item, { ...post('t1', 'Bash', {}), hook_event_name: 'PostToolUseFailure' }, calls, T0 + 9000), 'PostToolUseFailure');
});

test('settled: the turn moved on (new prompt, Stop, idle notification, session end)', () => {
  const item = { sessionId: SID, tool: 'Bash', key: 'k', toolUseId: 't1', agentId: '', at: T0 };
  for (const ev of ['UserPromptSubmit', 'Stop', 'StopFailure', 'SessionEnd', 'SessionStart']) {
    assert.equal(L.settledBy(item, { hook_event_name: ev, session_id: SID }, new Map(), T0 + 100), ev);
  }
  assert.equal(L.settledBy(item, { hook_event_name: 'Notification', session_id: SID, notification_type: 'idle_prompt' }, new Map(), T0), 'idle');
  assert.equal(L.settledBy(item, { hook_event_name: 'Notification', session_id: SID, notification_type: 'permission_prompt' }, new Map(), T0), null, 'the terminal dialog showing up is not an answer');
  assert.equal(L.settledBy(item, { hook_event_name: 'Stop', session_id: 'another' }, new Map(), T0), null, 'another session never settles it');
});

test('settled: another call of the same agent, started after the request (not a parallel sibling)', () => {
  const calls = new Map();
  L.trackCall(calls, pre('t1', 'Read', { file_path: 'a' }), T0);
  L.trackCall(calls, pre('t2', 'Read', { file_path: 'b' }), T0 + 5); // same parallel batch
  const item = request(calls, ask('Read', { file_path: 'a' }), T0 + 20);
  assert.equal(L.settledBy(item, post('t2', 'Read', { file_path: 'b' }), calls, T0 + 3000), null, 'a sibling that started with it');
  assert.equal(L.settledBy(item, pre('t9', 'Grep', { pattern: 'x' }), calls, T0 + 400), null, 'too close: may still be the same batch');
  assert.equal(L.settledBy(item, pre('t9', 'Grep', { pattern: 'x' }), calls, T0 + 5000), 'moved-on');
  L.trackCall(calls, pre('t10', 'Edit', {}), T0 + 6000);
  assert.equal(L.settledBy(item, post('t10', 'Edit', {}), calls, T0 + 7000), 'moved-on');
  assert.equal(L.settledBy(item, ask('Write', { file_path: 'z' }), calls, T0 + 6000), 'moved-on', 'asks for something else');
});

test('settled: a subagent never settles the main agent’s request, and the reverse', () => {
  const calls = new Map();
  L.trackCall(calls, pre('t1', 'Bash', { command: 'deploy' }), T0);
  const main = request(calls, ask('Bash', { command: 'deploy' }), T0 + 10);
  assert.equal(L.settledBy(main, pre('s1', 'Read', {}, { agent_id: 'ag-1' }), calls, T0 + 60000), null);
  assert.equal(L.settledBy(main, { hook_event_name: 'SubagentStop', session_id: SID, agent_id: 'ag-1' }, calls, T0 + 60000), null);
  L.trackCall(calls, pre('s2', 'Bash', { command: 'rm x' }, { agent_id: 'ag-1' }), T0 + 100);
  const sub = request(calls, ask('Bash', { command: 'rm x' }), T0 + 110);
  assert.equal(sub.agentId, 'ag-1');
  assert.equal(L.settledBy(sub, pre('m2', 'Read', {}), calls, T0 + 60000), null, 'the main agent moving does not answer the subagent');
  assert.equal(L.settledBy(sub, pre('s3', 'Read', {}, { agent_id: 'ag-1' }), calls, T0 + 60000), 'moved-on');
  assert.equal(L.settledBy(sub, { hook_event_name: 'SubagentStop', session_id: SID, agent_id: 'ag-1' }, calls, T0 + 60000), 'SubagentStop');
});

test('settled without a bound PreToolUse (older hooks): the same call ending still counts', () => {
  const item = { sessionId: SID, tool: 'Bash', key: L.callKey('Bash', { command: 'ls' }), toolUseId: '', agentId: '', at: T0 };
  assert.equal(L.settledBy(item, post('tx', 'Bash', { command: 'ls' }), new Map(), T0 + 100), 'PostToolUse');
  assert.equal(L.settledBy(item, post('ty', 'Bash', { command: 'pwd' }), new Map(), T0 + 100), null, 'unknown start: not proof');
  assert.equal(L.settledBy(item, { ...pre('tz', 'Bash', { command: 'ls' }), ambrosia_kind: 'ask' }, new Map(), T0 + 9000), null);
});

// ── Silence, context, model, title, subagents ─────────────────────────────

test('stalledSince: busy and silent past the limit, never while a request waits, long Bash gets its timeout', () => {
  const min = 60000;
  const s = { state: 'working', updatedAt: T0 };
  assert.equal(L.stalledSince(s, T0 + 7 * min, { minutes: 8 }), 0);
  assert.equal(L.stalledSince(s, T0 + 9 * min, { minutes: 8 }), T0);
  assert.equal(L.stalledSince(s, T0 + 9 * min, { minutes: 8, pending: true }), 0);
  assert.equal(L.stalledSince(s, T0 + 9 * min, { minutes: 0 }), 0, '0 = never');
  assert.equal(L.stalledSince({ ...s, state: 'finished' }, T0 + 60 * min, { minutes: 8 }), 0);
  const long = { ...s, runningTool: L.runningTool(pre('t', 'Bash', { command: 'npm run build', timeout: 600000 }), T0) };
  assert.equal(L.stalledSince(long, T0 + 10 * min, { minutes: 8 }), 0, '10 min timeout + 1 min');
  assert.equal(L.stalledSince(long, T0 + 12 * min, { minutes: 8 }), T0);
  const bg = { ...s, runningTool: L.runningTool(pre('t', 'Bash', { command: 'serve', timeout: 600000, run_in_background: true }), T0) };
  assert.equal(L.stalledSince(bg, T0 + 9 * min, { minutes: 8 }), T0, 'a background command returns at once');
});

test('contextLevel thresholds', () => {
  assert.deepEqual([10, 55, 72, 84, 93, NaN].map(L.contextLevel), ['low', 'mid', 'high', 'warn', 'bad', null]);
});

test('shortModel and effortOf', () => {
  assert.equal(L.shortModel('claude-opus-5-5-20260101'), 'Opus 5.5');
  assert.equal(L.shortModel('Opus 4.1'), 'Opus 4.1');
  assert.equal(L.shortModel('claude-opus-4-20250514'), 'Opus 4');
  assert.equal(L.shortModel('Sonnet 4.5 (1M context)'), 'Sonnet 4.5 1M');
  assert.equal(L.shortModel('claude-sonnet-4-5[1m]'), 'Sonnet 4.5 1M');
  assert.equal(L.shortModel('claude-3-5-haiku-20241022'), 'Haiku');
  assert.equal(L.shortModel(''), '');
  assert.equal(L.effortOf({ level: 'xhigh' }), 'xhigh');
  assert.equal(L.effortOf('high'), 'high');
  assert.equal(L.effortOf({ level: 'turbo' }), '');
  assert.equal(L.effortOf(undefined), '');
});

test('promptTitle: the user’s words, without injected blocks or set-up commands', () => {
  assert.equal(L.promptTitle('<ide_selection>The user selected lines 1-9 of x.js</ide_selection>\nCorrige le bug du ticker'), 'Corrige le bug du ticker');
  assert.equal(L.promptTitle('<system-reminder>sois bref</system-reminder>Ajoute un test [Image #1]'), 'Ajoute un test');
  assert.equal(L.promptTitle('<command-name>/review</command-name>\n<command-message>review</command-message>\n<command-args>la PR 42</command-args>'), 'la PR 42');
  assert.equal(L.promptTitle('<command-name>/clear</command-name><command-args></command-args>'), '');
  assert.equal(L.promptTitle('/model opus'), '');
  assert.equal(L.promptTitle('/compact'), '');
  assert.equal(L.promptTitle('/mon-skill fais le ménage'), 'fais le ménage');
  assert.equal(L.promptTitle('Explique   pourquoi\n\nça casse'), 'Explique pourquoi ça casse');
  assert.equal(L.promptTitle('x'.repeat(200), 80).length, 80);
});

test('subagents: seen, current tool, gone, stale ones dropped', () => {
  const s = {};
  L.agentSeen(s, { agent_id: 'a1', agent_type: 'Explore' }, T0);
  L.agentSeen(s, { agent_id: 'a2', agent_type: 'general-purpose' }, T0 + 10, 'Lit · x.js');
  L.agentSeen(s, { agent_id: 'a1' }, T0 + 20, 'Recherche · foo');
  assert.deepEqual(L.agentList(s, T0 + 30).map((a) => [a.type, a.tool]), [['Explore', 'Recherche · foo'], ['general-purpose', 'Lit · x.js']]);
  assert.equal(L.agentGone(s, { agent_id: 'a2' }), true);
  assert.equal(L.agentList(s, T0 + 30).length, 1);
  assert.equal(L.agentList(s, T0 + 30 * 60000).length, 0, 'silent for 20 min: dropped');
  assert.equal(L.agentSeen(s, {}, T0), false, 'the main agent is not a subagent');
});

test('stow: which events wake a session, a week of memory, the Claude process in the ancestry', () => {
  assert.equal(L.wakes({ hook_event_name: 'UserPromptSubmit' }), true);
  assert.equal(L.wakes({ hook_event_name: 'PreToolUse' }), true);
  assert.equal(L.wakes({ hook_event_name: 'Stop' }), false);
  assert.equal(L.wakes({ hook_event_name: 'Notification' }), false);
  assert.equal(L.wakes({ hook_event_name: 'PreToolUse', ambrosia_kind: 'ask' }), true);
  const stowed = { a: T0, b: T0 - 8 * 86400000 };
  assert.deepEqual(Object.keys(L.pruneStowed(stowed, T0)), ['a']);
  assert.equal(L.claudePid({ pids: [10, 20, 30], names: ['bash.exe', 'claude.exe', 'WindowsTerminal.exe'] }), 20);
  assert.equal(L.claudePid({ pids: [10], names: ['pwsh.exe'] }), 0);
  assert.equal(L.claudePid(null), 0);
});
