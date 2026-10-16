// Gany's wardrobe: skins, slots, the seasonal default (src/renderer/wardrobe.js).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const W = require('../src/renderer/wardrobe');

const OCT = new Date(2026, 9, 16, 10, 0);
const JUNE = new Date(2026, 5, 3, 10, 0);

test('season: Halloween covers the whole of October, and only October', () => {
  assert.equal(W.season(new Date(2026, 9, 1, 0, 0))?.id, 'halloween');
  assert.equal(W.season(OCT)?.id, 'halloween');
  assert.equal(W.season(new Date(2026, 9, 31, 23, 59))?.id, 'halloween');
  assert.equal(W.season(new Date(2026, 8, 30, 23, 59)), null);
  assert.equal(W.season(new Date(2026, 10, 1, 0, 0)), null);
  assert.equal(W.season(JUNE), null);
});

test('no choice: the season decides (Halloween now, Ganymède in June)', () => {
  const oct = W.resolve(undefined, { date: OCT });
  assert.equal(oct.skin, 'halloween');
  assert.equal(oct.auto, true);
  assert.equal(oct.season, 'halloween');
  assert.deepEqual(
    { head: oct.slots.head, wings: oct.slots.wings, palette: oct.slots.palette, face: oct.slots.face },
    { head: 'horns', wings: 'bat', palette: 'mauve', face: 'fangs' },
  );
  assert.equal(oct.sound, 'halloween');

  const june = W.resolve({ skin: null, slots: {} }, { date: JUNE });
  assert.equal(june.skin, 'classic');
  assert.deepEqual(june.slots, W.CLASSIC);
  assert.equal(june.sound, 'lyre');
});

test('an explicit skin always wins over the season', () => {
  const r = W.resolve(W.chooseSkin(W.reset(), 'classic'), { date: OCT });
  assert.equal(r.skin, 'classic');
  assert.equal(r.auto, false);
  assert.equal(r.slots.head, 'laurel');
  assert.equal(r.sound, 'lyre');
  // and a Halloween skin chosen in June stays Halloween
  assert.equal(W.resolve({ skin: 'halloween', slots: {} }, { date: JUNE }).slots.wings, 'bat');
});

test('slots changed by hand win over the skin, seasonal or chosen', () => {
  let look = W.chooseSlot(W.reset(), 'glasses', 'round', { date: OCT });
  assert.deepEqual(look, { skin: null, slots: { glasses: 'round' } });
  const oct = W.resolve(look, { date: OCT });
  assert.equal(oct.slots.glasses, 'round');
  assert.equal(oct.slots.head, 'horns'); // still Halloween around them
  assert.deepEqual(oct.overridden, ['glasses']);
  // the season ends, the hand-made change stays
  const june = W.resolve(look, { date: JUNE });
  assert.equal(june.slots.head, 'laurel');
  assert.equal(june.slots.glasses, 'round');

  look = W.chooseSlot({ skin: 'winter', slots: {} }, 'head', 'horns');
  assert.equal(W.resolve(look, { date: JUNE }).slots.head, 'horns');
  assert.equal(W.resolve(look, { date: JUNE }).slots.palette, 'sky');
});

test('choosing what the skin already has removes the override; null too', () => {
  let look = W.chooseSlot(W.reset(), 'wings', 'feathers', { date: OCT });
  assert.deepEqual(look.slots, { wings: 'feathers' });
  look = W.chooseSlot(look, 'wings', 'bat', { date: OCT }); // Halloween's own wings
  assert.deepEqual(look.slots, {});
  look = W.chooseSlot({ skin: 'classic', slots: { face: 'mustache' } }, 'face', null);
  assert.deepEqual(look, { skin: 'classic', slots: {} });
});

test('choosing a skin drops the hand-made changes; reset goes back to the season', () => {
  const look = W.chooseSkin({ skin: null, slots: { glasses: 'sun' } }, 'scholar');
  assert.deepEqual(look, { skin: 'scholar', slots: {} });
  assert.deepEqual(W.reset(), { skin: null, slots: {} });
  assert.equal(W.resolve(W.reset(), { date: OCT }).skin, 'halloween');
  assert.deepEqual(W.chooseSkin(look, 'nope'), { skin: null, slots: {} });
});

test('stored garbage is ignored: unknown skin, slot or value, wrong types', () => {
  assert.deepEqual(W.normalize({ skin: 'pirate', slots: { head: 'horns', hat: 'x', wings: 'jet', glasses: 3 } }), { skin: null, slots: { head: 'horns' } });
  assert.deepEqual(W.normalize('halloween'), { skin: null, slots: {} });
  assert.deepEqual(W.normalize(null), { skin: null, slots: {} });
  assert.deepEqual(W.normalize({ skin: 'spring', slots: [] }), { skin: 'spring', slots: {} });
  assert.equal(W.chooseSlot(W.reset(), 'glasses', 'laser', { date: JUNE }).slots.glasses, undefined);
});

test('sound theme: auto follows the skin, an explicit theme wins', () => {
  assert.equal(W.resolve(W.reset(), { date: OCT, soundTheme: 'auto' }).sound, 'halloween');
  assert.equal(W.resolve(W.reset(), { date: OCT, soundTheme: 'lyre' }).sound, 'lyre');
  assert.equal(W.resolve(W.reset(), { date: JUNE, soundTheme: 'halloween' }).sound, 'halloween');
  assert.equal(W.resolve({ skin: 'classic' }, { date: OCT }).sound, 'lyre');
  assert.equal(W.resolve(W.reset(), { date: OCT, soundTheme: 'bogus' }).sound, 'halloween');
});

test('every skin sets every slot to a known value', () => {
  for (const skin of W.SKINS) {
    for (const slot of W.SLOTS) {
      assert.ok(slot.options.some(([v]) => v === skin.slots[slot.id]), `${skin.id}.${slot.id} = ${skin.slots[slot.id]}`);
    }
  }
  const ids = W.SKINS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('gany.js draws every palette and shape the wardrobe offers', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/renderer/gany.js'), 'utf8');
  const block = (name) => src.slice(src.indexOf(`const ${name} = {`), src.indexOf('};', src.indexOf(`const ${name} = {`)));
  for (const [slot, table] of [['palette', 'PALETTES'], ['shape', 'SHAPES']]) {
    const keys = block(table);
    for (const [v] of W.SLOTS.find((s) => s.id === slot).options) assert.match(keys, new RegExp(`\\n\\s+${v}: \\{`), `${table}.${v}`);
  }
  // and the classic look matches the first option of every slot
  const classic = src.match(/const CLASSIC_LOOK = (\{[^}]+\})/)[1].replace(/(\w+):/g, '"$1":').replace(/'/g, '"');
  assert.deepEqual(JSON.parse(classic), W.CLASSIC);
});

test('no field of Gany hides one of his methods (this.look once replaced look(dx, dy))', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/renderer/gany.js'), 'utf8');
  const body = src.slice(src.indexOf('export class Gany'), src.indexOf('\nfunction heart('));
  const methods = new Set([...body.matchAll(/^ {2}(?:get |set )?(\w+)\([^)]*\) \{$/gm)].map((m) => m[1]));
  const fields = new Set([...body.matchAll(/this\.(\w+) =[^=]/g)].map((m) => m[1]));
  assert.ok(methods.has('look') && methods.has('setLook') && fields.has('wardrobe'));
  assert.deepEqual([...fields].filter((f) => methods.has(f)), []);
});

test('the gany module declares the look and the sound theme', () => {
  const def = require('../src/modules/gany/main.js');
  const look = def.settings.find((s) => s.key === 'look');
  assert.equal(look.type, 'wardrobe');
  assert.deepEqual(look.default, { skin: null, slots: {} });
  const theme = def.settings.find((s) => s.key === 'soundTheme');
  assert.equal(theme.default, 'auto');
  assert.deepEqual(theme.options.map(([v]) => v), ['auto', 'lyre', 'halloween']);
});
