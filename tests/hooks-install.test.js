const test = require('node:test');
const assert = require('node:assert');
const { merged, withoutOurs, HOOK_EVENTS, MARKER } = require('../src/main/hooks-install');

const theirs = {
  model: 'sonnet',
  hooks: {
    Stop: [{ hooks: [{ type: 'command', command: 'node streamdeck.js stop', timeout: 5 }] }],
    PreToolUse: [{ matcher: 'Task', hooks: [{ type: 'command', command: 'node streamdeck.js task' }] }],
  },
};

const ours = (list) => (list || []).filter((e) => e.hooks.some((h) => h.command.includes(MARKER)));

test('install adds every event and keeps the user’s own hooks', () => {
  const out = merged(theirs);
  assert.equal(out.model, 'sonnet');
  for (const [event] of HOOK_EVENTS) assert.equal(ours(out.hooks[event]).length >= 1, true, event);
  assert.equal(out.hooks.Stop[0].hooks[0].command, 'node streamdeck.js stop');
  assert.equal(out.hooks.PreToolUse[0].matcher, 'Task');
  // generic PreToolUse + the AskUserQuestion one
  assert.equal(ours(out.hooks.PreToolUse).length, 2);
  assert.ok(out.hooks.PreToolUse.some((e) => e.matcher === 'AskUserQuestion'));
});

test('installing twice does not duplicate entries', () => {
  const twice = merged(merged(theirs));
  assert.equal(ours(twice.hooks.Stop).length, 1);
  assert.equal(ours(twice.hooks.PreToolUse).length, 2);
});

test('uninstall restores exactly the original settings', () => {
  assert.deepEqual(withoutOurs(merged(theirs)), theirs);
  assert.deepEqual(withoutOurs(merged({})), {});
});

// ── statusLine relay (quota gauges) ────────────────────────────────────────

const { chainedCommand, STATUS_MARKER } = require('../src/main/hooks-install');

test('statusLine: installed alone when the user has none, removed on uninstall', () => {
  const out = merged({ model: 'sonnet' });
  assert.equal(out.statusLine.type, 'command');
  assert.ok(out.statusLine.command.includes(STATUS_MARKER));
  assert.ok(!out.statusLine.command.includes('--chain'));
  assert.deepEqual(withoutOurs(out), { model: 'sonnet' });
});

test('statusLine: the user’s own command is chained, kept verbatim, and restored', () => {
  const mine = { type: 'command', command: `jq -r '"[\\(.model.display_name)] \\(.context_window.used_percentage // 0)%"'`, padding: 2 };
  const before = { ...theirs, statusLine: mine };
  const out = merged(before);
  assert.ok(out.statusLine.command.includes(STATUS_MARKER));
  assert.equal(out.statusLine.padding, 2);
  assert.equal(chainedCommand(out.statusLine.command), mine.command);
  // base64url: no quote or space a shell could mangle
  assert.match(out.statusLine.command.split('--chain ')[1], /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(withoutOurs(out), before);
});

test('statusLine: reinstalling does not wrap our relay twice', () => {
  const mine = { type: 'command', command: '~/.claude/statusline.sh' };
  const twice = merged(merged({ statusLine: mine }));
  assert.equal(chainedCommand(twice.statusLine.command), mine.command);
  assert.equal(twice.statusLine.command.split(STATUS_MARKER).length, 2);
  assert.deepEqual(withoutOurs(twice), { statusLine: mine });
});

test('new events are installed (PostCompact, PermissionDenied, TaskCreated, TaskCompleted)', () => {
  const out = merged({});
  for (const e of ['PostCompact', 'PermissionDenied', 'TaskCreated', 'TaskCompleted']) assert.equal(ours(out.hooks[e]).length, 1, e);
});

test('PermissionRequest waits longer than the relay’s decision budget', () => {
  const [, timeout] = HOOK_EVENTS.find(([e]) => e === 'PermissionRequest');
  assert.ok(timeout * 1000 > 110000);
});
