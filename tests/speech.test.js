const test = require('node:test');
const assert = require('node:assert');
const { speakable, Sentences, isEcho, isGoodbye, explainListenError } = require('../src/main/speech-logic');
const { asciiJson } = require('../src/main/speech');

test('speakable: what a person would say, not what a screen shows', () => {
  assert.strictEqual(speakable('**Oui** : voir [la doc](https://x.fr/doc) ou https://y.fr 🎉'), 'Oui : voir la doc ou un lien');
  assert.strictEqual(speakable('## Titre\n- un\n- deux'), 'Titre. un. deux');
  assert.strictEqual(speakable('Avant\n```js\ncode()\n```\nAprès'), 'Avant. Après');
  assert.strictEqual(speakable('Lance `npm test`.'), 'Lance npm test.');
  assert.strictEqual(speakable('Fini !\n\nEnsuite.'), 'Fini ! Ensuite.');
});

test('Sentences: whole sentences as they complete, the rest on flush', () => {
  const s = new Sentences();
  assert.deepStrictEqual(s.push('Bonjour ! Tu as trois ma'), ['Bonjour !']);
  assert.deepStrictEqual(s.push('ils. Le premier vient de '), ['Tu as trois mails.']);
  assert.deepStrictEqual(s.push('Zeus'), []);
  assert.deepStrictEqual(s.flush(), ['Le premier vient de Zeus']);
  assert.deepStrictEqual(s.flush(), []);
});

test('Sentences: a decimal is not the end of a sentence, a long one is cut at a comma', () => {
  const s = new Sentences({ max: 80 });
  assert.deepStrictEqual(s.push('Il fait 12.5 degrés. '), ['Il fait 12.5 degrés.']);
  const long = 'Une phrase très longue qui continue, encore et encore, sans jamais finir vraiment, avec des virgules partout';
  const out = s.push(long);
  assert.ok(out.length >= 1);
  assert.ok(out[0].length <= 81);
  assert.match(out[0], /,$/);
});

test('isEcho: Gany hearing himself vs. the user cutting in', () => {
  const said = 'Tu as trois mails importants et une réunion dans vingt minutes.';
  assert.strictEqual(isEcho('trois mails importants', said), true);
  assert.strictEqual(isEcho('une réunion dans vingt', said), true);
  assert.strictEqual(isEcho('stop', said), false);
  assert.strictEqual(isEcho('attends', said), false);
  assert.strictEqual(isEcho('non mais lis-moi le premier', said), false);
  assert.strictEqual(isEcho('', said), true);
  assert.strictEqual(isEcho('bonjour', ''), false);
});

test('isGoodbye: the end of the call, not a sentence that mentions it', () => {
  for (const t of ['Au revoir Gany', 'merci, c’est tout', 'Stop.', 'ok bye', 'Bonne journée !', 'Merci au revoir']) assert.ok(isGoodbye(t), t);
  for (const t of ['dis au revoir à Paul de ma part', 'stop le serveur de test', 'merci', '']) assert.ok(!isGoodbye(t), t);
});

test('explainListenError: Windows settings to open, never a guess', () => {
  const privacy = explainListenError(-2147199735, 'The speech privacy policy was not accepted');
  assert.strictEqual(privacy.fix.url, 'ms-settings:privacy-speech');
  assert.strictEqual(explainListenError(-2147024891).fix.url, 'ms-settings:privacy-microphone');
  assert.strictEqual(explainListenError('MicrophoneUnavailable').fix.url, 'ms-settings:sound');
  assert.match(explainListenError('NetworkFailure').text, /réseau/);
  assert.match(explainListenError(42, 'boom').text, /boom/);
});

test('asciiJson: Piper gets plain ASCII', () => {
  const j = asciiJson({ text: 'échanson « Gany »' });
  assert.ok(/^[\x20-\x7e]*$/.test(j));
  assert.deepStrictEqual(JSON.parse(j), { text: 'échanson « Gany »' });
});
