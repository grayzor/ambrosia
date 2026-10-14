// Gany's character — the pure part (no Electron, no timers): tested in tests/gany-logic.test.js.

const MIN = 60000;

/** "1 h 30", "45 min" */
function duration(ms) {
  const m = Math.round(ms / MIN);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`;
}

/**
 * Break reminders. Called once a minute with how long the mouse has been still.
 * Continuous activity starts with the first move after a real break (restMin
 * without moving); after everyMin of it, one nudge, then again every everyMin.
 * `blocked` (a call, focus, something urgent, night) delays the nudge without
 * losing it.
 *
 * @returns {{ state, nudge: null | { kind: 'stretch'|'water', activeMs } }}
 */
function breakTick(prev, { now, idleMs, everyMin = 90, restMin = 5, blocked = false }) {
  const st = { activeSince: prev?.activeSince ?? null, lastNudge: prev?.lastNudge || 0, count: prev?.count || 0 };
  if (idleMs >= restMin * MIN) return { state: { ...st, activeSince: null, lastNudge: 0 }, nudge: null };
  if (st.activeSince == null) st.activeSince = now - idleMs;
  const from = Math.max(st.activeSince, st.lastNudge);
  if (blocked || now - from < everyMin * MIN) return { state: st, nudge: null };
  st.lastNudge = now;
  st.count += 1;
  return { state: st, nudge: { kind: st.count % 2 ? 'stretch' : 'water', activeMs: now - st.activeSince } };
}

/** The alert for a break nudge: silent, low priority, short. */
function breakAlert(nudge) {
  const d = duration(nudge.activeMs);
  return nudge.kind === 'stretch'
    ? { key: 'break', title: 'Une petite pause ?', text: `${d} que tu enchaînes : lève-toi, étire-toi une minute.`, mood: 'stretch', priority: 25, ttl: 12 }
    : { key: 'break', title: 'Une gorgée d’eau ?', text: `${d} sans pause. Même les dieux s’hydratent.`, mood: 'drink', priority: 25, ttl: 12 };
}

/**
 * What still waits for the user, across modules: every `unread` count (mail,
 * ClickUp, Chat, Drive…), Claude Code's pending approvals and running sessions.
 */
function workload(peers = {}) {
  let n = 0;
  for (const [id, st] of Object.entries(peers)) {
    if (!st || id === 'gany') continue;
    if (Number.isFinite(st.unread)) n += st.unread;
  }
  const c = peers.claude || {};
  n += (c.pending || []).length;
  n += (c.sessions || []).filter((s) => ['working', 'thinking', 'approval', 'question'].includes(s.state)).length;
  return n;
}

/**
 * « L'Olympe est en ordre » : a party when the load drops to zero after at
 * least `minPeak` things waited, the user was at it (active) and nothing
 * forbids it (a call…), at most once per cooldown.
 *
 * @returns {{ state, party: null | { cleared } }}
 */
function celebrateTick(prev, { now, load, active = true, allowed = true, minPeak = 3, cooldownMin = 180 }) {
  const st = { peak: prev?.peak || 0, last: prev?.last || 0 };
  if (load > 0) return { state: { ...st, peak: Math.max(st.peak, load) }, party: null };
  const due = st.peak >= minPeak && active && allowed && now - st.last >= cooldownMin * MIN;
  return due ? { state: { peak: 0, last: now }, party: { cleared: st.peak } } : { state: { ...st, peak: 0 }, party: null };
}

function celebrateAlert({ cleared }) {
  return {
    key: 'clear',
    title: 'L’Olympe est en ordre !',
    text: `${cleared} sujets traités, plus rien ne t’attend. Gany te sert une coupe.`,
    mood: 'cheer',
    priority: 20,
    ttl: 7,
    confetti: true,
  };
}

/** Easter Sunday (Gregorian, anonymous algorithm), local date. */
function easter(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

// [month, day, id, outfit, phrase]
const FIXED = [
  [1, 1, 'nouvelan', 'nouvelan', 'Bonne année ! Que l’Olympe te soit favorable.'],
  [1, 6, 'epiphanie', 'epiphanie', 'Épiphanie : qui aura la fève ?'],
  [2, 2, 'chandeleur', null, 'Chandeleur : une crêpe à l’ambroisie ?'],
  [2, 14, 'valentin', 'valentin', 'Saint-Valentin : même Éros prend sa journée.'],
  [4, 1, 'avril', 'avril', 'Poisson d’avril ! (Regarde bien mon flanc.)'],
  [5, 1, 'travail', null, 'Fête du Travail : un brin de muguet pour toi.'],
  [5, 8, 'victoire', null, '8 Mai : jour férié, l’Olympe se souvient.'],
  [6, 21, 'musique', null, 'Fête de la musique : Gany accorde sa lyre.'],
  [7, 14, 'juillet', 'juillet', 'Fête nationale : feux d’artifice sur l’Olympe ce soir !'],
  [8, 15, 'assomption', null, 'Assomption : l’Olympe est à la plage.'],
  [10, 31, 'halloween', 'halloween', 'Halloween : même Hadès est de sortie.'],
  [11, 1, 'toussaint', null, 'Toussaint : jour férié.'],
  [11, 11, 'armistice', null, '11 Novembre : jour férié, l’Olympe se souvient.'],
  [12, 24, 'reveillon', 'noel', 'Réveillon ce soir : Gany a sorti son bonnet.'],
  [12, 25, 'noel', 'noel', 'Joyeux Noël ! Même Zeus fait une pause.'],
  [12, 31, 'sylvestre', 'nouvelan', 'Dernier jour de l’année : Gany prépare les cotillons.'],
];

/**
 * The day of the year, French calendar: holidays and a few fêtes.
 * @returns {null | { id, outfit: string|null, phrase }}
 */
function occasion(date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const day = new Date(y, m - 1, d).getTime();
  const e = easter(y).getTime();
  const DAY = 86400000;
  const rel = Math.round((day - e) / DAY);
  if (rel === 0) return { id: 'paques', outfit: 'paques', phrase: 'Joyeuses Pâques ! Gany a caché des œufs sur l’Olympe.' };
  if (rel === 1) return { id: 'paques', outfit: 'paques', phrase: 'Lundi de Pâques : il reste des œufs quelque part.' };
  if (rel === 39) return { id: 'ascension', outfit: null, phrase: 'Jeudi de l’Ascension : Gany s’y connaît en élévation.' };
  if (rel === 50) return { id: 'pentecote', outfit: null, phrase: 'Lundi de Pentecôte : solidarité ou repos ?' };
  const hit = FIXED.find(([fm, fd]) => fm === m && fd === d);
  if (hit) return { id: hit[2], outfit: hit[3], phrase: hit[4] };
  // The days before Christmas: the hat comes out.
  if (m === 12 && d >= 18 && d <= 26) return { id: 'noel', outfit: 'noel', phrase: 'Noël approche, Gany a sorti son bonnet.' };
  return null;
}

/**
 * Windows « Ne pas déranger » drives the focus mode, at its changes only: it
 * starts a focus when none runs, and ends only the focus it started — never one
 * the user chose (which then simply goes on).
 * @returns {'on'|'off'|null}
 */
function dndFocus({ dnd, prevDnd, focusActive, focusBy }) {
  if (dnd == null || dnd === prevDnd) return null;
  if (dnd && !focusActive) return 'on';
  if (!dnd && focusActive && focusBy === 'dnd') return 'off';
  return null;
}

module.exports = { MIN, duration, breakTick, breakAlert, workload, celebrateTick, celebrateAlert, easter, occasion, dndFocus };
