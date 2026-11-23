// When the top of the screen lights up — the pure part (tests: tests/glow.test.js).
//
// Plain script: island.js imports it (`import './glow-rules.js'` then
// globalThis.AmbrosiaGlowRules), the tests require() it. The light follows the sound
// rule: it always has a reason, and Gany keeps it off whenever he keeps quiet.
//
//   steady — while something waits for you: an approval / a question of Claude Code
//            (orange), a meeting that runs without you (red), one about to start (amber,
//            around the notch only). Off once the island is open: you are looking.
//   wave   — once, from the notch to the edges, for a new alert that came with a sound.
//            Its colour says what it is (finished: green, error: red…), else the module's.
//
// Réglages → Encoche → « Lueur en haut de l'écran »: 'auto' (around the notch, the whole
// top edge for what is urgent), 'notch' (always around the notch), 'off'.

(function (root) {
  const ORANGE = '#F2A65A';
  const RED = '#F0616D';
  const GREEN = '#3FB950';
  const GOLD = '#F8DC6C';

  const MOOD_COLORS = {
    approval: ORANGE,
    question: ORANGE,
    'meeting-soon': ORANGE,
    'meeting-now': RED,
    'meeting-late': RED,
    error: RED,
    ratelimit: RED,
    finished: GREEN,
    cheer: GREEN,
  };

  /**
   * Gany keeps quiet: glow off. ctx = { setting, paused, locked, hushed, focus, fullscreen }.
   * hushed: « en appel » (a call, the session locked, a full-screen app); focus: concentration
   * or Windows « Ne pas déranger ».
   */
  function quiet(ctx = {}) {
    return ctx.setting === 'off' || !!(ctx.paused || ctx.locked || ctx.hushed || ctx.focus || ctx.fullscreen);
  }

  const wide = (ctx) => (ctx.setting === 'notch' ? 'notch' : 'full');

  /** The light that stays, from Gany's mood (island.js updateMood). ctx.open: the island is unfolded. */
  function steady(mood, ctx = {}) {
    if (!mood || quiet(ctx) || ctx.open) return null;
    if (mood === 'approval' || mood === 'question') return { color: ORANGE, scope: wide(ctx) };
    if (mood === 'meeting-now' || mood === 'meeting-late') return { color: RED, scope: wide(ctx) };
    if (mood === 'meeting-soon') return { color: ORANGE, scope: 'notch' };
    return null;
  }

  /** The light that passes once, for a new alert: { color, scope } or null. */
  function wave(alert, ctx = {}, moduleColor = null) {
    if (!alert || !alert.sound || quiet(ctx) || ctx.open) return null;
    const color = MOOD_COLORS[alert.mood] || moduleColor || GOLD;
    const scope = (alert.priority ?? 50) >= 90 ? wide(ctx) : 'notch';
    return { color, scope };
  }

  const api = { steady, wave, quiet, MOOD_COLORS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AmbrosiaGlowRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
