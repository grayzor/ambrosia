// « Prévenir du retard » — the pure part: who gets the word, and the words.
// Sending follows the Bilan module exactly (../report/logic.js): an explicit click
// plus a confirmation, then ONE Claude turn whose only tool is Gmail's
// send_message, and the tool call's real arguments checked by verifySend.

const R = require('../report/logic');

const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[a-z]{2,}$/i;
/** Meeting rooms and shared calendars are not people. */
const NOT_A_PERSON = /@resource\.calendar\.google\.com$|@group\.calendar\.google\.com$|@group\.v\.calendar\.google\.com$/i;

const CHIPS = [5, 10, 15];

/**
 * Recipients of the « late » mail: the organizer, then the guests who accepted.
 * Never the user, a room or a shared calendar; no duplicates.
 * @param {object} e  agenda event: { organizer, guests: [{ email, status, organizer }] }
 */
function lateRecipients(e, selfEmail = '') {
  const me = String(selfEmail || '').toLowerCase();
  const out = [];
  const add = (v) => {
    const m = String(v || '').trim().toLowerCase();
    if (!EMAIL.test(m) || NOT_A_PERSON.test(m) || m === me || out.includes(m)) return;
    out.push(m);
  };
  const guests = Array.isArray(e?.guests) ? e.guests : [];
  add(e?.organizer);
  for (const g of guests) if (g?.organizer) add(g.email);
  for (const g of guests) if (/^accepted$/i.test(g?.status || '')) add(g.email);
  return out.slice(0, 30);
}

const clampMin = (n, fallback = 5) => {
  const v = Math.round(Number(n));
  return v >= 1 && v <= 120 ? v : fallback;
};

/** The prefilled message: « Bonjour, j’arrive dans 5 min. » + signature (or « — Prénom »). */
function lateText({ minutes = 5, name = '', signature = '' } = {}) {
  const sig = String(signature || '').trim() || (name ? `— ${name}` : '');
  return [`Bonjour, j’arrive dans ${clampMin(minutes)} min.`, sig].filter(Boolean).join('\n\n');
}

/** A chip (5 / 10 / 15) rewrites the first « N min » of the text, whatever the user typed around it. */
function withDelay(text, minutes) {
  const m = clampMin(minutes);
  const t = String(text || '');
  const re = /\b\d{1,3}\s?(min(utes?)?)\b/i;
  return re.test(t) ? t.replace(re, `${m} min`) : t;
}

function lateSubject(title) {
  return `Retard — ${String(title || 'réunion').replace(/\s+/g, ' ').trim()}`.slice(0, 200);
}

/**
 * Checks a send request before anything leaves: recipients, subject, text.
 * → { ok, expected: { to, subject, body } } | { ok: false, error }
 */
function prepare({ to, subject, body }) {
  const { to: list, bad } = R.parseRecipients(to);
  if (bad.length) return { ok: false, error: `Adresse invalide : ${bad.join(', ')}` };
  if (!list.length) return { ok: false, error: 'Aucun destinataire.' };
  const s = String(subject || '').trim();
  const b = String(body || '').replace(/\r\n/g, '\n').trim();
  if (!s || !b) return { ok: false, error: 'L’objet et le texte ne peuvent pas être vides.' };
  return { ok: true, expected: { to: list, subject: s.slice(0, 300), body: b.slice(0, 5000) } };
}

module.exports = {
  CHIPS,
  lateRecipients,
  lateText,
  withDelay,
  lateSubject,
  prepare,
  // The Bilan's send pattern, as is.
  sendPrompt: (expected) => R.sendPrompt('send', expected),
  verifySend: R.verifySend,
  SEND_SYSTEM: R.SEND_SYSTEM,
  SEND_SCHEMA: R.SEND_SCHEMA,
  SEND_TOOL: R.WRITE_TOOLS.send,
  joinNames: R.joinNames,
};
