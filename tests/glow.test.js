const test = require('node:test');
const assert = require('node:assert');
const G = require('../src/renderer/glow-rules');

test('steady: approvals and meetings that run without you, never once open', () => {
  assert.deepStrictEqual(G.steady('approval', {}), { color: '#F2A65A', scope: 'full' });
  assert.deepStrictEqual(G.steady('question', { setting: 'notch' }), { color: '#F2A65A', scope: 'notch' });
  assert.deepStrictEqual(G.steady('meeting-late', {}), { color: '#F0616D', scope: 'full' });
  assert.deepStrictEqual(G.steady('meeting-soon', {}), { color: '#F2A65A', scope: 'notch' });
  assert.strictEqual(G.steady('mail', {}), null);
  assert.strictEqual(G.steady('working', {}), null);
  assert.strictEqual(G.steady('approval', { open: true }), null);
  assert.strictEqual(G.steady(null, {}), null);
});

test('Gany keeps quiet, the light too', () => {
  for (const ctx of [{ setting: 'off' }, { paused: true }, { locked: true }, { hushed: true }, { focus: true }, { fullscreen: 'presentation' }]) {
    assert.strictEqual(G.steady('approval', ctx), null, JSON.stringify(ctx));
    assert.strictEqual(G.wave({ sound: 'mail', mood: 'mail' }, ctx), null, JSON.stringify(ctx));
  }
});

test('wave: only an alert with a sound; colour by mood, else the module; urgent goes wide', () => {
  assert.strictEqual(G.wave({ mood: 'mail', priority: 60 }, {}), null); // silent alert: no light either
  assert.deepStrictEqual(G.wave({ sound: 'mail', mood: 'mail', priority: 60 }, {}, '#7B68EE'), { color: '#7B68EE', scope: 'notch' });
  assert.deepStrictEqual(G.wave({ sound: 'finish', mood: 'finished' }, {}, '#D97757'), { color: '#3FB950', scope: 'notch' });
  assert.deepStrictEqual(G.wave({ sound: 'approval', mood: 'approval', priority: 100 }, {}), { color: '#F2A65A', scope: 'full' });
  assert.deepStrictEqual(G.wave({ sound: 'approval', mood: 'approval', priority: 100 }, { setting: 'notch' }), { color: '#F2A65A', scope: 'notch' });
  assert.deepStrictEqual(G.wave({ sound: 'x' }, {}), { color: '#F8DC6C', scope: 'notch' });
  assert.strictEqual(G.wave({ sound: 'mail' }, { open: true }), null);
});
