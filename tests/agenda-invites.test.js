// Invitations waiting for an answer: which ones, clashes, the exact respond_to_event call.

const test = require('node:test');
const assert = require('node:assert');
const I = require('../src/modules/agenda/invites');

const MIN = 60000;
const NOW = Date.parse('2026-10-13T09:00:00+02:00');
const at = (min) => new Date(NOW + min * MIN).toISOString();
const ev = (id, startIn, dur, extra = {}) => ({ id, title: id, start: at(startIn), end: at(startIn + dur), selfResponse: 'accepted', eventType: 'DEFAULT', ...extra });

test('pending: needsAction only, not over, a series once (its first instance), not just answered', () => {
  const list = [
    ev('ok', 60, 30),
    ev('inv', 120, 60, { selfResponse: 'needsAction' }),
    ev('finie', -90, 30, { selfResponse: 'needsAction' }),
    ev('serie_1', 24 * 60, 30, { selfResponse: 'needsAction', recurringEventId: 'serie' }),
    ev('serie_2', 48 * 60, 30, { selfResponse: 'needsAction', recurringEventId: 'serie' }),
    ev('repondue', 300, 30, { selfResponse: 'needsAction' }),
    ev('declinee', 400, 30, { selfResponse: 'declined' }),
  ];
  const p = I.pendingInvitations(list, NOW, { repondue: { status: 'accepted', at: NOW } });
  assert.deepEqual(p.map((i) => i.key), ['inv', 'serie']);
  assert.equal(p[1].id, 'serie_1');
  assert.equal(p[1].series, true);
  // The same invitation read twice (today's read and the 14-day look-ahead) counts once.
  assert.equal(I.pendingInvitations([list[1], { ...list[1] }], NOW).length, 1);
});

test('conflicts: busy events that overlap — not declined, not pending, not the same series', () => {
  const inv = ev('inv', 60, 60, { selfResponse: 'needsAction', recurringEventId: 's' });
  const all = [
    ev('chevauche', 90, 60),
    ev('avant', 0, 60), // ends exactly at the start: no clash
    ev('apres', 120, 30), // starts exactly at the end
    ev('refusee', 70, 30, { selfResponse: 'declined' }),
    ev('autre-invit', 70, 30, { selfResponse: 'needsAction' }),
    ev('peut-etre', 65, 10, { selfResponse: 'tentative' }),
    ev('meme-serie', 60, 60, { recurringEventId: 's' }),
    ev('lieu', 0, 600, { eventType: 'WORKING_LOCATION' }),
    { id: 'journee', title: 'Férié', start: '2026-10-13', end: '2026-10-14', selfResponse: 'accepted' },
  ];
  assert.deepEqual(I.conflicts(inv, all).map((c) => c.id), ['peut-etre', 'chevauche']);
});

test('respond: exact arguments; the series id for a series; a comment only with Peut-être / Refuser', () => {
  assert.deepEqual(I.respondArgs({ id: 'e1' }, 'accepted', 'merci'), { ok: true, args: { eventId: 'e1', responseStatus: 'accepted' } });
  assert.deepEqual(I.respondArgs({ id: 'e1_2026', recurringEventId: 'e1' }, 'declined', '  Pas dispo,\n désolé '), { ok: true, args: { eventId: 'e1', responseStatus: 'declined', responseComment: 'Pas dispo, désolé' } });
  assert.deepEqual(I.respondArgs({ id: 'e1' }, 'tentative'), { ok: true, args: { eventId: 'e1', responseStatus: 'tentative' } });
  assert.equal(I.respondArgs({ id: 'e1' }, 'needsAction').ok, false);
  assert.equal(I.respondArgs({}, 'accepted').ok, false);
});

test('first seen: alert once per invitation', () => {
  const a = { key: 'a' };
  const b = { key: 'b' };
  const one = I.firstSeen([a], {}, NOW);
  assert.deepEqual(one.fresh, [a]);
  const two = I.firstSeen([a, b], one.seen, NOW + MIN);
  assert.deepEqual(two.fresh, [b]);
  assert.deepEqual(I.firstSeen([a, b], two.seen, NOW + 2 * MIN).fresh, []);
});

test('Courrier leaves calendar invitations to Agenda while « Invitations » is on', () => {
  const { mailQuery } = require('../src/modules/mail/main');
  const since = Date.parse('2026-10-11T08:00:00Z');
  assert.equal(mailQuery({ since, settings: { query: 'in:inbox' } }, { invites: true }), 'in:inbox -filename:invite.ics after:1791705600');
  assert.equal(mailQuery({ since, settings: { query: 'in:inbox' } }, { invites: false }), 'in:inbox after:1791705600');
});
