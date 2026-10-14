// Calendar invitations waiting for an answer — the pure part. main.js reads them
// (the agenda read, plus a 14-day look-ahead once an hour) and answers on a click
// with ONE write tool of the Calendar connector, `respond_to_event` (callTool).

const MIN = 60000;

/** responseStatus → button label (the only three answers Google accepts). */
const RESPONSES = { accepted: 'Accepter', tentative: 'Peut-être', declined: 'Refuser' };

const start = (e) => Date.parse(e.start);
const end = (e) => Date.parse(e.end);
const allDay = (e) => !/T\d/.test(e.start || '');

/** Busy for the user: not declined, not a mere working-location marker. */
const busy = (e) => !/declined|needsAction/i.test(e.selfResponse || '') && !/WORKING_LOCATION/i.test(e.eventType || '') && !allDay(e);

/**
 * Invitations to answer: the user's own entry says needsAction, the event is not
 * over, and was not just answered from Ambrosia (`responded`: id → { status, at },
 * until the next read shows the new status). A recurring series counts once:
 * the earliest instance stands for it, and the answer goes to the whole series.
 */
function pendingInvitations(events, now, responded = {}) {
  const seen = new Set();
  const out = [];
  const list = [...(events || [])].filter((e) => e?.id && !Number.isNaN(start(e))).sort((a, b) => start(a) - start(b));
  for (const e of list) {
    if (!/needsAction/i.test(e.selfResponse || '')) continue;
    if (end(e) <= now) continue;
    const key = e.recurringEventId || e.id;
    if (seen.has(key) || seen.has(e.id) || responded[key] || responded[e.id]) continue;
    seen.add(key);
    seen.add(e.id);
    out.push({ ...e, key, series: !!e.recurringEventId });
  }
  return out.slice(0, 20);
}

/** The user's busy events that overlap an invitation (same series excluded). */
function conflicts(inv, events) {
  if (allDay(inv)) return [];
  const a = start(inv);
  const b = end(inv);
  const seen = new Set();
  return (events || [])
    .filter((e) => e?.id && e.id !== inv.id && !(inv.recurringEventId && e.recurringEventId === inv.recurringEventId))
    .filter((e) => busy(e) && start(e) < b && end(e) > a)
    .filter((e) => (seen.has(e.id) ? false : seen.add(e.id)))
    .sort((x, y) => start(x) - start(y))
    .map((e) => ({ id: e.id, title: String(e.title || ''), start: e.start, end: e.end }));
}

/**
 * The exact arguments of `respond_to_event`. A recurring invitation is answered
 * for the whole series (like Gmail's invitation card). A comment only goes with
 * « Peut-être » / « Refuser ». → { ok, args } | { ok: false, error }
 */
function respondArgs(inv, status, comment = '') {
  if (!RESPONSES[status]) return { ok: false, error: 'Réponse inconnue.' };
  const eventId = String(inv?.recurringEventId || inv?.id || '');
  if (!eventId) return { ok: false, error: 'Invitation introuvable.' };
  const args = { eventId, responseStatus: status };
  const c = String(comment || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (c && status !== 'accepted') args.responseComment = c;
  return { ok: true, args };
}

/** Invitations seen for the first time (to alert once), and the updated memory. */
function firstSeen(pending, seen = {}, now = Date.now()) {
  const fresh = pending.filter((i) => !seen[i.key]);
  const next = { ...seen };
  for (const i of pending) next[i.key] ||= now;
  // Forget what has been gone for a month.
  for (const [k, at] of Object.entries(next)) if (now - at > 30 * 24 * 60 * MIN && !pending.some((i) => i.key === k)) delete next[k];
  return { fresh, seen: next };
}

/** "mar. 14 oct., 10:00–11:00" (or "mar. 14 oct., journée"). */
function when(e) {
  const d = new Date(start(e));
  const day = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  if (allDay(e)) return `${day}, journée`;
  const hm = (ms) => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${hm(start(e))}–${hm(end(e))}`;
}

module.exports = { RESPONSES, pendingInvitations, conflicts, respondArgs, firstSeen, when, busy };
