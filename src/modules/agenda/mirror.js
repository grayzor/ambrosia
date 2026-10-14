// « Me voir » — a live webcam mirror in the island, to check camera, hair and light
// before joining a meeting. Island side only (ES module, imported by view.js).
//
// The camera starts on a click only (the button, or « Me voir » on the meeting
// alert), video only — the microphone is never requested. Nothing is recorded or
// saved. Every track stops when the mirror is closed, the island folds, another tab
// replaces the panel, the meeting is joined / acknowledged / over, or after 2 min.
// The main process lets only the island's own page use the camera (media-permissions.js).

const MAX_MS = 2 * 60000;

/** The one mirror: { id, stream, video, select, left, startedAt, watch, error, note, ui } */
let cur = null;

// May be called while the panel renders: redraw right after, never inside it.
const redraw = (ui) => queueMicrotask(() => ui?.rerender());

const islandOpen = () => !!document.getElementById('island')?.classList.contains('mode-open');

const MESSAGES = {
  NotAllowedError: 'Accès à la caméra refusé. Windows : Paramètres → Confidentialité → Caméra → autoriser les applications de bureau.',
  SecurityError: 'Accès à la caméra refusé.',
  NotReadableError: 'La caméra est déjà utilisée par une autre application (Meet, Teams…), ou bloquée par le pilote.',
  AbortError: 'La caméra est déjà utilisée par une autre application (Meet, Teams…).',
  NotFoundError: 'Aucune caméra détectée.',
  OverconstrainedError: 'La caméra choisie n’est plus disponible.',
};
const explain = (err) => MESSAGES[err?.name] || `Caméra indisponible : ${err?.message || err}`;

async function open(deviceId) {
  // The dev preview (dev/island.html) has no camera of its own: a drawn one.
  if (typeof window.__ambrosiaFakeCamera === 'function') return window.__ambrosiaFakeCamera();
  if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('pas de caméra'), { name: 'NotFoundError' });
  const video = { width: { ideal: 640 }, height: { ideal: 360 }, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) };
  return navigator.mediaDevices.getUserMedia({ video, audio: false });
}

function stopTracks() {
  for (const t of cur?.stream?.getTracks() || []) t.stop();
  if (cur?.video) cur.video.srcObject = null;
  if (cur) cur.stream = null;
}

/** Stops the camera and forgets the mirror. */
export function stopMirror() {
  if (!cur) return;
  const ui = cur.ui;
  clearInterval(cur.watch);
  stopTracks();
  cur = null;
  ui?.pin(false);
  redraw(ui);
}

/** The meeting the mirror is open for (or null). */
export const mirrorId = () => cur?.id || null;

/** Opens the mirror for meeting `id` (a click led here). */
export async function startMirror(id, ui) {
  if (cur?.id === id && (cur.stream || cur.starting)) return;
  stopMirror();
  const video = document.createElement('video');
  Object.assign(video, { autoplay: true, muted: true, playsInline: true });
  video.className = 'mirror-video';
  // A mirror: flipped, like the self-view in Meet.
  video.style.cssText = 'display:block;width:100%;height:100%;object-fit:cover;transform:scaleX(-1)';
  const left = document.createElement('span');
  cur = { id, ui, video, left, select: null, stream: null, starting: true, error: null, note: null, startedAt: Date.now(), attached: false };
  const me = cur;
  // Fold, other tab, 2 minutes: the camera goes off on its own.
  me.watch = setInterval(() => {
    if (cur !== me) return clearInterval(me.watch);
    const gone = me.attached && !me.video.isConnected;
    if (gone || !islandOpen() || Date.now() - me.startedAt > MAX_MS) return stopMirror();
    const s = Math.max(0, Math.round((MAX_MS - (Date.now() - me.startedAt)) / 1000));
    me.left.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }, 500);
  ui.pin(true); // the island stays open while you look at yourself
  redraw(ui);
  await attach(me, ui.settings().cameraId || '');
}

async function attach(me, deviceId) {
  me.starting = true;
  me.error = null;
  let stream = null;
  try {
    stream = await open(deviceId);
  } catch (err) {
    // The chosen camera is unplugged: the default one.
    if (deviceId && /Overconstrained|NotFound/.test(err?.name || '')) {
      me.note = 'La caméra choisie n’est pas disponible : caméra par défaut.';
      return attach(me, '');
    }
    me.error = explain(err);
  }
  me.starting = false;
  if (cur !== me) {
    // Closed while the camera was starting: turn it straight off.
    for (const t of stream?.getTracks() || []) t.stop();
    return;
  }
  if (stream) {
    me.stream = stream;
    me.video.srcObject = stream;
    me.video.play?.().catch(() => {});
    // Stopping from outside (camera unplugged): say so.
    for (const t of stream.getVideoTracks()) t.addEventListener('ended', () => cur === me && stopMirror());
    me.deviceId = stream.getVideoTracks()[0]?.getSettings?.().deviceId || deviceId;
    me.select = await picker(me);
  }
  redraw(me.ui);
}

/** The camera picker: only when there is more than one camera (labels are known once the camera is on). */
async function picker(me) {
  let cams = [];
  try {
    cams = (await navigator.mediaDevices?.enumerateDevices?.() || []).filter((d) => d.kind === 'videoinput');
  } catch {}
  if (cams.length < 2) return null;
  const sel = document.createElement('select');
  sel.className = 'text mirror-select';
  cams.forEach((d, i) => {
    const o = document.createElement('option');
    o.value = d.deviceId;
    o.textContent = d.label || `Caméra ${i + 1}`;
    o.selected = d.deviceId === me.deviceId;
    sel.append(o);
  });
  sel.addEventListener('change', async () => {
    const id = sel.value;
    me.ui.action('setCamera', { deviceId: id, label: sel.selectedOptions[0]?.textContent || '' });
    stopTracks();
    me.note = null;
    redraw(me.ui);
    await attach(me, id);
  });
  return sel;
}

/** The mirror block for meeting `id`, or null when the mirror is not open for it. */
export function mirrorBlock(id, ui) {
  if (cur?.id !== id) return null;
  const { h } = ui;
  cur.ui = ui;
  // The first time, bring it into view (the meeting card may be low in the list).
  if (!cur.attached) requestAnimationFrame(() => cur?.video.closest('.mirror')?.scrollIntoView({ block: 'nearest' }));
  cur.attached = true;
  const close = h('button.btn.sm', { onclick: () => { ui.sound.play('tick'); stopMirror(); } }, 'Fermer le miroir');
  if (cur.error) {
    return h('div.mirror', { style: { marginTop: '8px' } }, h('div.small', { style: { color: '#FF9AA3' } }, cur.error), h('div.btns', { style: { marginTop: '6px' } }, h('button.btn.sm.ghost', { onclick: () => startMirror(id, ui) }, 'Réessayer'), close));
  }
  return h('div.mirror', { style: { marginTop: '8px' } },
    h('div.mirror-frame', { style: { position: 'relative', maxWidth: '340px', margin: '0 auto', borderRadius: '10px', overflow: 'hidden', background: '#000', aspectRatio: '16 / 9' } },
      cur.video,
      cur.starting ? h('div.small.dim', { style: { position: 'absolute', inset: '0', display: 'grid', placeItems: 'center' } }, 'Gany allume la caméra…') : null,
      h('span.pill', { style: { position: 'absolute', left: '6px', top: '6px', background: 'rgba(0,0,0,.55)', color: '#fff' } }, '● Aperçu, rien n’est enregistré'),
    ),
    cur.note ? h('div.small.faint', { style: { marginTop: '4px' } }, cur.note) : null,
    h('div.row', { style: { marginTop: '6px' } },
      cur.select,
      h('span.grow'),
      h('span.small.faint.mono', { title: 'Le miroir s’éteint tout seul' }, cur.left),
      close,
    ),
  );
}
