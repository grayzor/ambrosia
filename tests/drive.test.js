// Drive: comment links, one card per comment thread, and Courrier leaving the
// Google notifications to Drive.

const test = require('node:test');
const assert = require('node:assert');
const drive = require('../src/modules/drive/main');
const senders = require('../src/modules/drive/senders');
const { collapse } = require('../src/main/triage');

const COMMENT = 'https://docs.google.com/spreadsheets/d/FILE1/edit?disco=AAACIPcxYQU&usp=comment_email_document&ts=6ac4b751&usp_dm=false';

test('links: the comment in the document, tracking dropped; Drive and Gmail kept; nothing else', () => {
  const { docUrl } = drive;
  assert.equal(docUrl(COMMENT), 'https://docs.google.com/spreadsheets/d/FILE1/edit?disco=AAACIPcxYQU');
  assert.equal(docUrl('https://docs.google.com/document/d/F2/edit?usp=drivesdk'), 'https://docs.google.com/document/d/F2/edit');
  assert.equal(docUrl('https://drive.google.com/drive/folders/X1'), 'https://drive.google.com/drive/folders/X1');
  assert.equal(docUrl('https://mail.google.com/mail/?authuser=a#all/thread-f:1'), 'https://mail.google.com/mail/?authuser=a#all/thread-f:1');
  assert.equal(docUrl('https://evil.example/docs.google.com'), '');
  assert.equal(docUrl('http://docs.google.com/document/d/F2/edit'), '');
  assert.equal(docUrl('not a url'), '');
});

test('groupBy: a reply in the same comment thread replaces the card', () => {
  const out = collapse(
    [
      { id: 'm1', from: 'Maud', verdict: 'important', url: COMMENT },
      { id: 'm2', from: 'Maud', verdict: 'urgent', url: COMMENT.replace('ts=6ac4b751', 'ts=7') },
      { id: 'm3', from: 'Paul', verdict: 'important', url: 'https://docs.google.com/spreadsheets/d/FILE1/edit?disco=OTHER' },
      { id: 'm4', from: 'Léa', verdict: 'important', url: 'https://drive.google.com/drive/folders/X1' }, // no thread
    ],
    drive.groupKey,
  );
  assert.deepEqual(out.map((i) => i.id).sort(), ['m2', 'm3', 'm4']);
});

test('steps: only Google notification senders, one item per message', () => {
  const since = Date.parse('2026-10-11T08:00:00Z');
  const text = drive.steps({ since, settings: { shares: false } });
  assert.match(text, /from:\(comments-noreply@docs\.google\.com OR drive-shares-dm-noreply@google\.com OR drive-shares-noreply@google\.com\) after:1791705600/);
  assert.match(text, /id = le champ id du MESSAGE/);
  assert.match(text, /"noise"/);
  assert.match(drive.steps({ since, settings: { shares: true } }), /"important" quand une personne/);
});

test('Courrier leaves the Drive notifications to Drive, only while Drive is on', () => {
  const { mailQuery } = require('../src/modules/mail/main');
  const since = Date.parse('2026-10-11T08:00:00Z');
  const on = mailQuery({ since, settings: { query: 'in:inbox' } }, { drive: true, gchat: false });
  for (const a of senders.ALL) assert.ok(on.includes(`-from:${a}`), a);
  assert.doesNotMatch(on, /chat-noreply/);
  assert.match(on, /^in:inbox .* after:1791705600$/);
  assert.equal(mailQuery({ since, settings: { query: 'in:inbox' } }, { drive: false, gchat: false }), 'in:inbox after:1791705600');
  // Google Chat's reminder mails go to Google Chat in the same way.
  assert.equal(mailQuery({ since, settings: { query: 'in:inbox' } }, { drive: false, gchat: true }), 'in:inbox -from:chat-noreply@google.com after:1791705600');
});
