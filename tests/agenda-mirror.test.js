// « Me voir »: the camera for the island's own page, video only; nothing else changes.

const test = require('node:test');
const assert = require('node:assert');
const M = require('../src/main/media-permissions');

const PAGE = 'file:///C:/Users/n/ambrosia/src/renderer/index.html';

test('allowMedia: video only, island only, its own page only', () => {
  assert.equal(M.allowMedia({ isIsland: true, url: PAGE, mediaTypes: ['video'] }), true);
  assert.equal(M.allowMedia({ isIsland: true, url: 'file://', mediaTypes: ['video'] }), true); // a check carries the origin only
  assert.equal(M.allowMedia({ isIsland: true, url: PAGE, mediaTypes: ['audio'] }), false);
  assert.equal(M.allowMedia({ isIsland: true, url: PAGE, mediaTypes: ['video', 'audio'] }), false);
  assert.equal(M.allowMedia({ isIsland: true, url: PAGE, mediaTypes: [] }), false);
  assert.equal(M.allowMedia({ isIsland: false, url: PAGE, mediaTypes: ['video'] }), false);
  assert.equal(M.allowMedia({ isIsland: true, url: 'https://evil.example/', mediaTypes: ['video'] }), false);
  assert.equal(M.allowMedia({ isIsland: true, url: 'file:///C:/Users/n/ambrosia/src/settings/index.html', mediaTypes: ['video'] }), false);
});

test('install: media is decided by the rule, other permissions keep Electron’s default', () => {
  const island = { webContents: { getURL: () => PAGE }, isDestroyed: () => false };
  const other = { getURL: () => 'file:///C:/x/src/settings/index.html' };
  let request;
  let check;
  M.install({ setPermissionRequestHandler: (fn) => (request = fn), setPermissionCheckHandler: (fn) => (check = fn) }, () => island);
  const ask = (wc, permission, details) => {
    let out;
    request(wc, permission, (v) => (out = v), details);
    return out;
  };
  assert.equal(ask(island.webContents, 'media', { mediaTypes: ['video'], requestingUrl: PAGE }), true);
  assert.equal(ask(island.webContents, 'media', { mediaTypes: ['audio'], requestingUrl: PAGE }), false);
  assert.equal(ask(other, 'media', { mediaTypes: ['video'], requestingUrl: other.getURL() }), false);
  assert.equal(ask(other, 'notifications', {}), true);
  assert.equal(check(island.webContents, 'media', 'file://', { mediaType: 'video' }), true);
  assert.equal(check(island.webContents, 'media', 'file://', { mediaType: 'audio' }), false);
  assert.equal(check(other, 'media', 'file://', { mediaType: 'video' }), false);
  assert.equal(check(other, 'clipboard-sanitized-write', 'file://', {}), true);
});
