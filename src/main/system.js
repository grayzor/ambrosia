// Windows integration — the pure part (no Electron, no timers): tested in tests/system.test.js.
//
//   * Full screen: SHQueryUserNotificationState (polled by foreground.js) says a
//     full-screen app, a game or a presentation is running; the island steps
//     aside when it covers the island's display.
//   * Session lock: no new background work while away, then a staggered resume.
//   * Several screens: which display the island follows, without jumping when
//     the pointer only crosses another one.
//   * File drag: the zone around the island where an approaching drag opens it.
//   * Windows « Ne pas déranger »: the registry value, else the WNF quiet-hours profile.

/** SHQueryUserNotificationState values (QUERY_USER_NOTIFICATION_STATE). */
const QUNS = {
  NOT_PRESENT: 1, // screen saver, locked, fast user switching
  BUSY: 2, // a full-screen app is running (or presentation settings are applied)
  RUNNING_D3D_FULL_SCREEN: 3, // an exclusive full-screen Direct3D game
  PRESENTATION_MODE: 4, // « presentation settings » switched on
  ACCEPTS_NOTIFICATIONS: 5, // normal
  // 6 = QUIET_TIME: the first hour after a Windows install or upgrade, NOT Do Not Disturb.
  QUIET_TIME: 6,
  APP: 7, // a Windows Store app is running full screen
};

/** Does `r` cover the whole display `b` (a couple of pixels of slack: borders)? */
function covers(r, b, slack = 2) {
  if (!r || !b || !(r.width > 0) || !(r.height > 0)) return false;
  return r.x <= b.x + slack && r.y <= b.y + slack && r.x + r.width >= b.x + b.width - slack && r.y + r.height >= b.y + b.height - slack;
}

/**
 * Is something full screen on the island's display, and what?
 * @param {number} quns  SHQueryUserNotificationState
 * @param {{x,y,width,height}|null} fg  foreground window, in DIP
 * @param {{x,y,width,height}} display  bounds of the island's display, in DIP
 * @returns {'presentation'|'game'|'fullscreen'|null}
 */
function fullscreenKind(quns, fg, display) {
  // Presentation settings have no window: you are presenting, wherever.
  if (quns === QUNS.PRESENTATION_MODE) return 'presentation';
  if (quns !== QUNS.BUSY && quns !== QUNS.RUNNING_D3D_FULL_SCREEN && quns !== QUNS.APP) return null;
  // A full-screen window on another display leaves this one alone.
  if (!covers(fg, display)) return null;
  return quns === QUNS.RUNNING_D3D_FULL_SCREEN ? 'game' : 'fullscreen';
}

/** What the « en appel » recap calls the time spent full screen. */
const FULLSCREEN_INFO = {
  presentation: { title: 'Présentation', recapLead: 'Pendant ta présentation' },
  game: { title: 'Jeu en plein écran', recapLead: 'Pendant ta partie' },
  fullscreen: { title: 'Plein écran', recapLead: 'Pendant ton plein écran' },
};

/**
 * Session lock (and sleep): while any reason holds, no new background work.
 * When the last one goes, modules resume one after the other (`plan`), so the
 * mail, ClickUp, Chat… checks that waited do not all start in the same second.
 */
class Suspend {
  constructor({ stepMs = 12000, leadMs = 4000 } = {}) {
    this.reasons = new Set();
    this.plan = new Map(); // module id → when it may start new work again
    this.stepMs = stepMs;
    this.leadMs = leadMs;
  }

  get locked() {
    return this.reasons.size > 0;
  }

  /** reason: 'lock' | 'sleep'. Returns 'lock', 'unlock' or null (no change overall). */
  set(reason, on) {
    const was = this.locked;
    if (on) this.reasons.add(reason);
    else this.reasons.delete(reason);
    if (!was && this.locked) {
      this.plan.clear();
      return 'lock';
    }
    return was && !this.locked ? 'unlock' : null;
  }

  /** One module every stepMs, in the given order, after a short breath. */
  resume(ids, now) {
    this.plan = new Map(ids.map((id, i) => [id, now + this.leadMs + i * this.stepMs]));
    return this.plan;
  }

  /** May this module start new work now? */
  held(id, now) {
    return this.locked || (this.plan.get(id) || 0) > now;
  }
}

/**
 * Follows a display (under the pointer, or of the window in front) only once it
 * has been there for holdMs: crossing a screen on the way does not move the island.
 */
class DisplayFollower {
  constructor(holdMs = 1000) {
    this.holdMs = holdMs;
    this.id = null;
    this.cand = null;
  }

  /** A display seen now; returns the one followed. */
  see(id, now) {
    if (id == null) return this.id;
    if (this.id == null) this.id = id;
    if (id === this.id) {
      this.cand = null;
      return this.id;
    }
    if (this.cand?.id !== id) this.cand = { id, since: now };
    if (now - this.cand.since >= this.holdMs) {
      this.id = id;
      this.cand = null;
    }
    return this.id;
  }
}

/**
 * The display the island wants, by mode: 'primary', 'mouse', 'window', 'fixed'.
 * @param {Array<{id}>} displays
 * @param {{ mode, primaryId, followedId, fixedId }} o
 */
function pickDisplay(displays, { mode, primaryId, followedId, fixedId }) {
  const byId = (id) => displays.find((d) => String(d.id) === String(id));
  const primary = byId(primaryId) || displays[0] || null;
  if (mode === 'fixed') return byId(fixedId) || primary; // unplugged: back to the main screen
  if (mode === 'mouse' || mode === 'window') return byId(followedId) || primary;
  return primary;
}

/** « DELL U2720Q — 2560 × 1440 (principal) » for the settings list. */
function displayLabel(d, i, primaryId) {
  const size = d.size ? `${Math.round(d.size.width * (d.scaleFactor || 1))} × ${Math.round(d.size.height * (d.scaleFactor || 1))}` : '';
  const name = d.label || `Écran ${i + 1}`;
  return `${name}${size ? ` — ${size}` : ''}${String(d.id) === String(primaryId) ? ' (principal)' : ''}`;
}

/**
 * Is the pointer in the zone where an approaching file drag opens the island?
 * Window coordinates; `rect` is the island's shape (top centre of the window).
 */
function inDropZone(p, rect, margin = 120) {
  if (!p || !rect || !(rect.w > 0)) return false;
  return p.x >= rect.x - margin && p.x <= rect.x + rect.w + margin && p.y >= -2 && p.y <= rect.y + rect.h + margin;
}

/**
 * Windows « Ne pas déranger ». Windows 11 writes NOC_GLOBAL_SETTING_TOASTS_ENABLED
 * (0 = DND on, 1 = off; absent until first toggled). Before that, and on Windows 10
 * (Focus Assist), the WNF quiet-hours profile says it: 0 = off, 1 = priority only,
 * 2 = alarms only. Unknown (-1 / null) is off.
 */
function dndOn({ reg, wnf } = {}) {
  if (reg === 0) return true;
  if (reg === 1) return false;
  return Number(wnf) > 0;
}

module.exports = { QUNS, covers, fullscreenKind, FULLSCREEN_INFO, Suspend, DisplayFollower, pickDisplay, displayLabel, inDropZone, dndOn };
