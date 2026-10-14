// After the meeting: Gemini's notes → the user's actions → ClickUp tasks on click.

const test = require('node:test');
const assert = require('node:assert');
const N = require('../src/modules/agenda/notes');

const MIN = 60000;
const END = Date.parse('2026-10-13T10:00:00+02:00');
const meeting = { id: 'm1', title: 'Revue des incidents', start: new Date(END - 60 * MIN).toISOString(), end: new Date(END).toISOString() };
const prefix = (n) => `mcp__${n.replace(/[^a-zA-Z0-9_-]/g, '_')}__`;

test('Gemini notes titles, French and English', () => {
  for (const t of ['Revue - 2026/10/13 09:00 CEST - Notes de Gemini', 'Weekly sync - Notes by Gemini', 'Notes prises par Gemini', 'Gemini notes']) assert.ok(N.isGeminiNotes(t), t);
  for (const t of ['Ordre du jour', 'Notes de réunion', 'Présentation Gemini 2027']) assert.ok(!N.isGeminiNotes(t), t);
});

test('schedule: end + 10, 25, 45, 80, 115 min, then given up; queued once, never redone', () => {
  const entries = {};
  assert.equal(N.queue(entries, meeting, END), true);
  assert.equal(N.queue(entries, meeting, END), false);
  const e = entries.m1;
  assert.deepEqual(N.due(entries, END + 9 * MIN), []);
  assert.deepEqual(N.due(entries, END + 10 * MIN), [e]);
  e.tries = 1;
  assert.deepEqual(N.due(entries, END + 20 * MIN), []);
  assert.equal(N.nextCheck(e), END + 25 * MIN);
  e.tries = 4;
  assert.equal(N.nextCheck(e), END + 115 * MIN);
  e.tries = 5;
  assert.deepEqual(N.due(entries, END + 3 * 60 * MIN), []);
  assert.equal(e.status, 'none');
  // Found: never looked at again.
  const f = {};
  N.queue(f, meeting, END);
  f.m1.status = 'found';
  assert.deepEqual(N.due(f, END + 10 * MIN), []);
  // Old entries go.
  assert.deepEqual(Object.keys(N.prune({ ...f }, END + 4 * 24 * 60 * MIN)), []);
});

test('prompt and tools: read-only (get_event, read_file_content), Drive only when connected', () => {
  const both = { calendar: 'claude.ai Google Calendar', drive: 'claude.ai Google Drive' };
  assert.deepEqual(N.allowedTools(both, prefix), ['mcp__claude_ai_Google_Calendar__get_event', 'mcp__claude_ai_Google_Drive__read_file_content']);
  assert.deepEqual(N.allowedTools({ calendar: both.calendar }, prefix), ['mcp__claude_ai_Google_Calendar__get_event']);
  const p = N.buildPrompt(meeting, both, { name: 'Camille', email: 'camille@x.fr' });
  assert.match(p, /get_event avec eventId = "m1"/);
  assert.match(p, /read_file_content/);
  assert.match(p, /Camille, camille@x.fr/);
  assert.doesNotMatch(N.buildPrompt(meeting, { calendar: both.calendar }), /appelle read_file_content/);
});

test('sanitize: the notes link must be an attachment of the event, Docs/Drive https, Gemini title', () => {
  const doc = { title: 'Revue - Notes de Gemini', url: 'https://docs.google.com/document/d/abc/edit' };
  const raw = {
    attachments: [doc, { title: 'Ordre du jour', url: 'https://docs.google.com/document/d/xyz' }],
    found: true,
    notesUrl: doc.url,
    read: true,
    decisions: ['a', 'b', 'c', 'd'],
    actions: [{ texte: '  Préparer   la liste ', echeance: '2026-10-15' }, { texte: 'Relancer', echeance: 'vendredi' }, { texte: '' }],
  };
  const out = N.sanitize(raw);
  assert.deepEqual(out.notes, doc);
  assert.equal(out.decisions.length, 3);
  assert.deepEqual(out.actions, [{ id: 'a0', text: 'Préparer la liste', due: '2026-10-15', state: 'open' }, { id: 'a1', text: 'Relancer', due: '', state: 'open' }]);
  // A link that is not among the attachments, or not https Docs: refused.
  assert.equal(N.sanitize({ ...raw, attachments: [], notesUrl: doc.url }).found, false);
  assert.equal(N.sanitize({ ...raw, attachments: [{ title: doc.title, url: 'http://evil.example/x' }], notesUrl: 'http://evil.example/x' }).found, false);
  // Not a Gemini document.
  assert.equal(N.sanitize({ ...raw, attachments: [{ title: 'Ordre du jour', url: doc.url }] }).found, false);
  // Found but not read (no Drive): the link, no actions.
  const unread = N.sanitize({ ...raw, read: false });
  assert.deepEqual([unread.found, unread.read, unread.actions.length], [true, false, 0]);
});

test('task: exact clickup_create_task arguments; list id from a link; copy text', () => {
  const action = { text: 'Préparer la liste', due: '2026-10-15' };
  const args = N.taskArgs({ action, listId: '901234', meeting, notesUrl: 'https://docs.google.com/document/d/abc/edit', meId: '42' });
  assert.equal(args.list_id, '901234');
  assert.equal(args.name, 'Préparer la liste');
  assert.equal(args.due_date, '2026-10-15');
  assert.deepEqual(args.assignees, ['42']);
  assert.match(args.markdown_description, /« Revue des incidents »/);
  assert.match(args.markdown_description, /https:\/\/docs\.google\.com\/document\/d\/abc\/edit/);
  const bare = N.taskArgs({ action: { text: 'x', due: '' }, listId: '1', meeting, notesUrl: 'javascript:alert(1)' });
  assert.deepEqual(Object.keys(bare).sort(), ['list_id', 'markdown_description', 'name']);
  assert.doesNotMatch(bare.markdown_description, /javascript/);
  assert.equal(N.parseListId('https://app.clickup.com/9012/v/li/901234567'), '901234567');
  assert.equal(N.parseListId(' 901234 '), '901234');
  assert.equal(N.parseListId('Actions'), '');
  assert.match(N.copyText({ action, meeting, notesUrl: 'https://docs.google.com/document/d/abc' }), /Préparer la liste \(échéance 2026-10-15\)\nRéunion : Revue des incidents\nNotes : https/);
  assert.deepEqual(N.sanitizeLists({ lists: [{ id: '901234', name: 'A', path: 'S' }, { id: '901234', name: 'dup' }, { id: 'x', name: 'bad' }] }), [{ id: '901234', name: 'A', path: 'S' }]);
});
