// « Confier à Claude » in Claude Desktop: the claude://code/new link, the target
// choice, launchDesktop with a fake app. Nothing is opened here.
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const D = require('../src/main/claude-desktop');
const { launchDesktop } = require('../src/main/launcher');
const L = require('../src/modules/launch/logic');

test('newSessionLink: q and folder, decoded back verbatim by the app’s URL parser', () => {
  const prompt = 'Contexte :\n"""\nTitre : Échec export & 100 % des « tickets »\n"""\n\nMa demande : propose un plan.';
  const { url, clipboard } = D.newSessionLink({ prompt, folder: 'C:\\Users\\n\\Mes dépôts\\ambrosia' });
  assert.equal(clipboard, false);
  assert.ok(url.startsWith('claude://code/new?q='));
  assert.ok(!/[\s"]/.test(url), 'one argv entry, no quoting needed');
  const u = new URL(url);
  assert.equal(u.searchParams.get('q'), prompt);
  assert.equal(u.searchParams.get('folder'), 'C:\\Users\\n\\Mes dépôts\\ambrosia');
  assert.equal(D.newSessionLink({ folder: 'C:\\x' }).url, 'claude://code/new?folder=C%3A%5Cx');
});

test('newSessionLink: never cut, the clipboard takes what the link cannot carry', () => {
  const long = 'a'.repeat(D.MAX_Q + 1);
  const r = D.newSessionLink({ prompt: long, folder: 'C:\\x' });
  assert.equal(r.clipboard, true);
  assert.equal(new URL(r.url).searchParams.get('q'), null);
  assert.equal(new URL(r.url).searchParams.get('folder'), 'C:\\x');
  // Under 14 336 characters but too heavy once encoded (é = %C3%A9).
  const heavy = 'é'.repeat(5000);
  assert.ok(heavy.length < D.MAX_Q);
  assert.equal(D.newSessionLink({ prompt: heavy }).clipboard, true);
  assert.equal(D.newSessionLink({ prompt: 'a'.repeat(D.MAX_Q) }).clipboard, false);
  assert.ok(D.newSessionLink({ prompt: 'a'.repeat(D.MAX_Q) }).url.length <= D.MAX_LINK);
});

test('pickTarget: Claude Desktop when installed, unless Terminal is chosen', () => {
  assert.equal(L.pickTarget('auto', true), 'desktop');
  assert.equal(L.pickTarget(undefined, true), 'desktop');
  assert.equal(L.pickTarget('auto', false), 'terminal');
  assert.equal(L.pickTarget('desktop', false), 'terminal');
  assert.equal(L.pickTarget('terminal', true), 'terminal');
  assert.deepEqual(L.TARGETS.map(([id]) => id), ['auto', 'desktop', 'terminal']);
});

function fakeDesktop(installed = true) {
  const opened = [];
  return {
    opened,
    available: async () => installed,
    newSessionLink: D.newSessionLink,
    openLink: async (url) => (opened.push(url), { ok: true, via: 'fake' }),
  };
}

test('launchDesktop: folder checked, link opened, long prompt copied', async () => {
  const desktop = fakeDesktop();
  const copied = [];
  const copy = (t) => copied.push(t);
  const cwd = os.tmpdir();

  const ok = await launchDesktop({ cwd, prompt: 'Fais le point\r\nsur le dépôt' }, { desktop, copy });
  assert.deepEqual(ok, { ok: true, via: 'desktop', clipboard: false });
  assert.equal(new URL(desktop.opened[0]).searchParams.get('q'), 'Fais le point\nsur le dépôt');
  assert.equal(copied.length, 0);

  const long = 'x'.repeat(D.MAX_Q + 10);
  const r = await launchDesktop({ cwd, prompt: long }, { desktop, copy });
  assert.equal(r.clipboard, true);
  assert.deepEqual(copied, [long]);
  assert.equal(new URL(desktop.opened[1]).searchParams.get('q'), null);

  assert.match((await launchDesktop({ cwd: 'relatif' }, { desktop, copy })).error, /chemin complet/);
  assert.match((await launchDesktop({ cwd: cwd + '\\nexiste-pas-' + Date.now() }, { desktop, copy })).error, /introuvable/);
  assert.match((await launchDesktop({ cwd }, { desktop: fakeDesktop(false), copy })).error, /pas installé/);
  assert.equal(desktop.opened.length, 2);
});
