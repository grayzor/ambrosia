// « Se connecter » (Réglages → Claude) : the line cmd.exe receives.

const test = require('node:test');
const assert = require('node:assert');
const { loginCommand } = require('../src/main/claude');

test('the login terminal passes its quoted title to cmd.exe verbatim', () => {
  const cli = 'C:\\Users\\Camille Dupont\\.local\\bin\\claude.exe';
  const { file, args, options } = loginCommand(cli);
  assert.equal(file, 'cmd.exe');
  assert.equal(options.windowsVerbatimArguments, true);
  assert.equal(options.shell, false);
  // What Node hands to cmd.exe once the arguments are kept verbatim.
  assert.equal(args.join(' '), `/c start "Connexion Claude" cmd /k "${cli}" auth login`);
});

// A signed-out CLI (expired OAuth session) loads no claude.ai connector: that is
// a sign-in problem, not « connecteur absent » retried forever.
const { connectorOutcome } = require('../src/main/claude');

test('a sign-in failure wins over « connecteur pas prêt »', () => {
  const res = connectorOutcome(
    { ok: false, error: 'Failed to authenticate: OAuth session expired', authError: true, toolsUsed: [], mcpServers: [] },
    'claude.ai Gmail',
  );
  assert.equal(res.authError, true);
  assert.equal(res.mcpNotReady, false);
  assert.match(res.error, /Se connecter/);
});

test('an absent connector is flagged so run() can check the sign-in', () => {
  const res = connectorOutcome({ ok: false, toolsUsed: [], mcpServers: [{ name: 'rea', status: 'pending' }] }, 'claude.ai Gmail');
  assert.equal(res.mcpNotReady, true);
  assert.equal(res.connectorAbsent, true);
  assert.match(res.error, /absent/);
});

test('a pending connector is « pas prêt », not absent', () => {
  const res = connectorOutcome({ ok: true, toolsUsed: [], mcpServers: [{ name: 'claude.ai Gmail', status: 'pending' }] }, 'claude.ai Gmail');
  assert.equal(res.mcpNotReady, true);
  assert.equal(res.connectorAbsent, false);
});

test('a connected connector, or one whose tools ran, keeps the answer', () => {
  const ok = { ok: true, text: 'x', toolsUsed: [], mcpServers: [{ name: 'claude.ai Gmail', status: 'connected' }] };
  assert.equal(connectorOutcome(ok, 'claude.ai Gmail'), ok);
  const used = { ok: true, text: 'x', toolsUsed: ['mcp__claude_ai_Gmail__search_threads'], mcpServers: [] };
  assert.equal(connectorOutcome(used, 'claude.ai Gmail'), used);
  assert.equal(connectorOutcome(ok, undefined), ok);
});
