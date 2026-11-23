// The calendar of the Agenda tab — the pure part (tests: tests/agenda-calendar.test.js).
//
// Left, a month grid with a dot on each day that has something; right, the day you
// pick. No extra read of the calendar: today comes from the agenda read (now − 3 h →
// now + 20 h), the next 14 days from the hourly look-ahead that already finds the
// invitations (`busy` = every event of those days that is not declined).
//
// Plain script: require()d by main.js, imported by view.js (globalThis.AmbrosiaCalendar).

(function (root) {
  const DAY = 24 * 3600 * 1000;
  const pad = (n) => String(n).padStart(2, '0');

  /** Local 'YYYY-MM-DD' of a time (ms) or of a date-only string. */
  function dayKey(t) {
    if (typeof t === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    const d = new Date(typeof t === 'string' ? Date.parse(t) : t);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  /** Midnight (local) of a 'YYYY-MM-DD'. */
  function dayStart(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d).getTime();
  }

  const allDay = (e) => !/T\d/.test(e.start || '');

  /**
   * Every day of the window [today, today + horizon] → its events, sorted (all-day first).
   * Declined events and working-location markers are left out; ignored titles too
   * (Réglages → Agenda → « Ignorer les événements dont le titre contient »).
   * An invitation still to answer is kept, marked `invite`.
   */
  function buildDays({ events = [], busy = [], invitations = [] } = {}, now = Date.now(), { horizon = 14, ignore = [] } = {}) {
    const from = dayKey(now);
    const to = dayKey(dayStart(from) + horizon * DAY + DAY / 2);
    const days = {};
    const seen = new Set();
    const tags = (ignore || []).filter(Boolean).map((t) => String(t).toLowerCase());
    for (const e of [...events, ...busy, ...invitations]) {
      if (!e?.id || !e.start || Number.isNaN(Date.parse(e.start))) continue;
      if (/declined/i.test(e.selfResponse || '') || /WORKING_LOCATION/i.test(e.eventType || '')) continue;
      if (tags.some((t) => String(e.title || '').toLowerCase().includes(t))) continue;
      const key = dayKey(allDay(e) ? e.start.slice(0, 10) : e.start);
      if (key < from || key > to) continue;
      const id = `${e.id}@${e.start}`;
      if (seen.has(id)) continue;
      seen.add(id);
      (days[key] ||= []).push({
        id: e.id,
        title: String(e.title || '(sans titre)'),
        start: allDay(e) ? null : Date.parse(e.start),
        end: allDay(e) || Number.isNaN(Date.parse(e.end)) ? null : Date.parse(e.end),
        allDay: allDay(e),
        invite: /needsAction/i.test(e.selfResponse || ''),
        tentative: /tentative/i.test(e.selfResponse || ''),
        meet: !!e.meetUrl,
        focus: /FOCUS_TIME|OUT_OF_OFFICE/i.test(e.eventType || ''),
      });
    }
    for (const list of Object.values(days)) list.sort((a, b) => (a.allDay === b.allDay ? (a.start || 0) - (b.start || 0) : a.allDay ? -1 : 1));
    return { from, to, days };
  }

  /** The weeks (Monday first) of a month: [[{ key, day, inMonth }] × 7]. */
  function monthGrid(year, month) {
    const first = new Date(year, month, 1);
    const shift = (first.getDay() + 6) % 7; // Monday = 0
    const weeks = [];
    let d = new Date(year, month, 1 - shift);
    while (weeks.length < 6) {
      const week = [];
      for (let i = 0; i < 7; i++) {
        week.push({ key: dayKey(d.getTime()), day: d.getDate(), inMonth: d.getMonth() === month });
        d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
      }
      weeks.push(week);
      if (d.getMonth() !== month) break;
    }
    return weeks;
  }

  /** The months the window touches ({ year, month }), for ‹ ›. */
  function monthsOf(from, to) {
    const out = [];
    let [y, m] = from.split('-').map(Number);
    const [ty, tm] = to.split('-').map(Number);
    while (y < ty || (y === ty && m <= tm)) {
      out.push({ year: y, month: m - 1 });
      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
    }
    return out;
  }

  const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

  /** « Mardi 24 novembre » for the day header. */
  function dayLabel(key) {
    const d = new Date(dayStart(key));
    const w = WEEKDAYS[d.getDay()];
    return `${w[0].toUpperCase()}${w.slice(1)} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  }

  const api = { buildDays, monthGrid, monthsOf, dayKey, dayStart, dayLabel, MONTHS, WEEKDAYS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AmbrosiaCalendar = api;
})(globalThis);
