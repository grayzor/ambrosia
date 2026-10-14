// « Prévenir du retard »: recipients, words, and the Bilan's send check, from the agenda.

const test = require('node:test');
const assert = require('node:assert');
const L = require('../src/modules/agenda/late');

test('recipients: the organizer, then the guests who accepted; never me, rooms or calendars', () => {
  const e = {
    organizer: 'Lea.Martin@x.fr',
    guests: [
      { email: 'lea.martin@x.fr', status: 'accepted', organizer: true },
      { email: 'moi@x.fr', status: 'accepted' },
      { email: 'karim@x.fr', status: 'accepted' },
      { email: 'peut-etre@x.fr', status: 'tentative' },
      { email: 'non@x.fr', status: 'declined' },
      { email: 'pas-repondu@x.fr', status: 'needsAction' },
      { email: 'c_123abc@resource.calendar.google.com', status: 'accepted' },
      { email: 'equipe@group.calendar.google.com', status: 'accepted' },
      { email: 'pas une adresse', status: 'accepted' },
    ],
  };
  assert.deepEqual(L.lateRecipients(e, 'Moi@x.fr'), ['lea.martin@x.fr', 'karim@x.fr']);
  // I organize: only those who accepted.
  assert.deepEqual(L.lateRecipients({ organizer: 'moi@x.fr', guests: [{ email: 'a@x.fr', status: 'accepted' }] }, 'moi@x.fr'), ['a@x.fr']);
  // Old cached events have no guests yet.
  assert.deepEqual(L.lateRecipients({}, 'moi@x.fr'), []);
});

test('text: prefilled, signed with the first name or the signature; a chip rewrites the delay', () => {
  assert.equal(L.lateText({ minutes: 5, name: 'Camille' }), 'Bonjour, j’arrive dans 5 min.\n\n— Camille');
  assert.equal(L.lateText({ minutes: 10, name: 'Camille', signature: 'Camille D.\nSupport IT' }), 'Bonjour, j’arrive dans 10 min.\n\nCamille D.\nSupport IT');
  assert.equal(L.lateText({ minutes: 'abc' }), 'Bonjour, j’arrive dans 5 min.');
  assert.equal(L.withDelay('Désolé, je serai là dans 5 minutes, je finis un appel.', 15), 'Désolé, je serai là dans 15 min, je finis un appel.');
  assert.equal(L.withDelay('J’arrive vite.', 10), 'J’arrive vite.'); // nothing to rewrite: left as typed
  assert.equal(L.lateSubject('  ATLAS -  prio '), 'Retard — ATLAS - prio');
});

test('prepare: valid addresses only, no empty subject or text', () => {
  assert.deepEqual(L.prepare({ to: 'a@x.fr, B@x.fr', subject: ' Retard — X ', body: 'Bonjour\r\n' }), { ok: true, expected: { to: ['a@x.fr', 'b@x.fr'], subject: 'Retard — X', body: 'Bonjour' } });
  assert.match(L.prepare({ to: 'a@x.fr, nimporte', subject: 's', body: 'b' }).error, /invalide/);
  assert.match(L.prepare({ to: '', subject: 's', body: 'b' }).error, /destinataire/);
  assert.match(L.prepare({ to: 'a@x.fr', subject: '', body: 'b' }).error, /vides/);
});

test('send check: Gmail must have received exactly the text and the recipients', () => {
  const tool = 'mcp__claude_ai_Gmail__send_message';
  const expected = { to: ['a@x.fr'], subject: 'Retard — X', body: 'Bonjour, j’arrive dans 5 min.' };
  const ok = { ok: true, structured: { sent: true, id: 'm1' }, toolCalls: [{ name: tool, input: { ...expected } }] };
  assert.equal(L.verifySend(ok, expected, tool).ok, true);
  const changed = { ...ok, toolCalls: [{ name: tool, input: { ...expected, to: ['a@x.fr', 'b@x.fr'] } }] };
  assert.equal(L.verifySend(changed, expected, tool).uncertain, true);
  assert.equal(L.verifySend({ ok: true, structured: { sent: true, id: 'm1' }, toolCalls: [] }, expected, tool).ok, false);
  assert.match(L.sendPrompt(expected), /send_message/);
});
