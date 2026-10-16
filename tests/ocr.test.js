const test = require('node:test');
const assert = require('node:assert');
const logic = require('../src/modules/ocr/logic');

// What Windows OCR returned for a small capture (winocr.js), coordinates ×2:
// a sentence cut in two « lines », then a two-column table listed column by column.
const CAPTURE = [
  { t: 'Erreur 0x80070005 :', w: [['Erreur', 29, 33, 90, 28], ['0x80070005', 129, 33, 193, 28], [':', 335, 41, 6, 20]] },
  { t: 'Magasin', w: [['Magasin', 29, 133, 130, 36]] },
  { t: 'Agence Delphes', w: [['Agence', 28, 183, 75, 36], ['Delphes', 117, 183, 144, 28]] },
  { t: 'accès refusé.', w: [['accès', 353, 33, 82, 28], ['refusé.', 448, 31, 101, 30]] },
  { t: 'Caisse 2', w: [['Caisse', 527, 133, 97, 28], ['2', 635, 133, 17, 28]] },
  { t: 'Hors ligne', w: [['Hors', 528, 183, 73, 28], ['ligne', 614, 181, 74, 38]] },
];

test('layout: rows put back together, columns as tabs, paragraphs as blank lines', () => {
  const out = logic.layout(CAPTURE);
  assert.strictEqual(out.text, 'Erreur 0x80070005 : accès refusé.\n\nMagasin\tCaisse 2\nAgence Delphes\tHors ligne');
  assert.strictEqual(out.rows, 3);
  assert.strictEqual(out.columns, true);
  assert.strictEqual(out.words, 12);
});

test('layout: plain prose stays prose', () => {
  const out = logic.layout([
    { w: [['Bonjour', 0, 0, 70, 20], ['à', 78, 0, 10, 20], ['tous,', 96, 0, 45, 20]] },
    { w: [['merci', 0, 26, 50, 20], ['pour', 58, 26, 40, 20], ['hier.', 106, 26, 42, 20]] },
  ]);
  assert.strictEqual(out.text, 'Bonjour à tous,\nmerci pour hier.');
  assert.strictEqual(out.columns, false);
});

test('layout: nothing usable', () => {
  assert.deepStrictEqual(logic.layout([]), { text: '', rows: 0, columns: false, words: 0 });
  assert.strictEqual(logic.layout(null).text, '');
  assert.strictEqual(logic.layout([{ w: [['  ', 0, 0, 5, 5], ['x', NaN, 0, 1, 1]] }]).text, '');
});

test('offerable: a fresh copy, not dismissed, within the window', () => {
  const now = 1_000_000;
  const clip = { seq: 7, at: now - 60_000 };
  assert.strictEqual(logic.offerable(clip, { now, minutes: 3 }), true);
  assert.strictEqual(logic.offerable(clip, { now, minutes: 3, dismissed: 7 }), false);
  assert.strictEqual(logic.offerable(clip, { now: now + 3 * 60_000, minutes: 3 }), false);
  assert.strictEqual(logic.offerable(clip, { now, enabled: false }), false);
  assert.strictEqual(logic.offerable(null, { now }), false);
});

test('isImagePath and explain', () => {
  assert.ok(logic.isImagePath('C:\\Captures\\écran.PNG'));
  assert.ok(logic.isImagePath('photo.jpeg'));
  assert.ok(!logic.isImagePath('rapport.pdf'));
  assert.ok(!logic.isImagePath(null));
  assert.match(logic.explain({ ok: false, code: -2003292336 }), /format/); // 0x88982F50
  assert.match(logic.explain({ ok: false, code: 'nolang', msg: 'Pas de reconnaissance' }), /Pas de reconnaissance/);
  assert.match(logic.explain({ ok: false, code: 5, msg: 'boom' }), /boom/);
});

test('preview: one line, cut with an ellipsis', () => {
  assert.strictEqual(logic.preview('a\n\tb   c'), 'a b c');
  assert.strictEqual(logic.preview('x'.repeat(100), 10), 'xxxxxxxxx…');
});
