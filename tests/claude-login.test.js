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
