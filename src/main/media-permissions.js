// Camera permission for the island (Agenda's « Me voir » mirror before a meeting).
//
// Electron grants every permission request when no handler is set. Here `media`
// gets a rule of its own: the camera only, never the microphone, and only for the
// island's own page (src/renderer, file://). Every other permission keeps
// Electron's default. getUserMedia is called only after a click in the island.

/**
 * Pure: may this media request / check go through?
 * @param {object} o
 * @param {boolean} o.isIsland     the request comes from the island's webContents
 * @param {string}  o.url          the requesting page (or origin)
 * @param {string[]} o.mediaTypes  'video' / 'audio' (request) — or one mediaType (check)
 */
function allowMedia({ isIsland, url, mediaTypes }) {
  if (!isIsland) return false;
  const u = String(url || '');
  if (!/^file:\/\//i.test(u)) return false;
  // A check may come with only the origin ("file://"); a request carries the page.
  if (/\.html/i.test(u) && !/\/src\/renderer\/index\.html/i.test(u.replace(/\\/g, '/'))) return false;
  const types = (mediaTypes || []).filter(Boolean);
  return types.length > 0 && types.every((t) => t === 'video');
}

/** Installs the handlers on the island's session. `getIsland()` → the island BrowserWindow (or null). */
function install(session, getIsland) {
  const isIsland = (wc) => {
    const w = getIsland();
    return !!w && !w.isDestroyed() && wc === w.webContents;
  };
  session.setPermissionRequestHandler((wc, permission, callback, details = {}) => {
    if (permission !== 'media') return callback(true);
    const url = details.requestingUrl || wc?.getURL?.() || '';
    callback(allowMedia({ isIsland: isIsland(wc), url, mediaTypes: details.mediaTypes || [] }));
  });
  session.setPermissionCheckHandler((wc, permission, origin, details = {}) => {
    if (permission !== 'media') return true;
    const url = details.requestingUrl || origin || wc?.getURL?.() || '';
    return allowMedia({ isIsland: isIsland(wc), url, mediaTypes: [details.mediaType || 'video'] });
  });
}

module.exports = { allowMedia, install };
