// Automatic updates: the pure part (src/main/update-logic.js) and the files
// (src/main/update-install.js) against real zips, a local server and real junctions.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const L = require('../src/main/update-logic');
const I = require('../src/main/update-install');
const paths = require('../src/main/paths');

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const manifest = (over = {}) => ({
  version: '0.1.58',
  electron: '44.5.1',
  commit: 'abcdef1234567',
  date: '2026-10-14T10:00:00Z',
  notes: 'https://github.com/grayzor/ambrosia/releases/tag/v0.1.58',
  assets: {
    full: { name: 'Ambrosia-0.1.58-win-x64.zip', size: 110e6, sha256: 'a'.repeat(64) },
    app: { name: 'Ambrosia-0.1.58-app.zip', size: 400e3, sha256: 'b'.repeat(64) },
  },
  ...over,
});

test('versions: numeric order, a "v" prefix accepted, garbage is the oldest', () => {
  assert.ok(L.compareVersions('0.1.10', '0.1.9') > 0);
  assert.ok(L.compareVersions('0.2.0', '0.1.99') > 0);
  assert.equal(L.compareVersions('v1.0.0', '1.0.0'), 0);
  assert.ok(L.compareVersions('0.1.0', 'abc') > 0);
  assert.equal(L.isNewer('0.1.58', '0.1.58'), false);
  assert.equal(L.wanted('0.1.59', { running: '0.1.58', failed: '0.1.59' }), false, 'a version that failed here is skipped');
  assert.equal(L.wanted('0.1.60', { running: '0.1.58', failed: '0.1.59' }), true);
});

test('manifest: only the expected shape gets through', () => {
  const m = L.parseManifest(JSON.stringify(manifest()));
  assert.equal(m.version, '0.1.58');
  assert.equal(m.assets.app.name, 'Ambrosia-0.1.58-app.zip');
  assert.throws(() => L.parseManifest(manifest({ version: '0.1.58; rm -rf' })), /version invalide/);
  assert.throws(() => L.parseManifest(manifest({ assets: { full: { name: '../evil.zip', size: 1, sha256: 'a'.repeat(64) } } })), /invalide/);
  assert.throws(() => L.parseManifest(manifest({ assets: { full: { name: 'a.zip', size: 1, sha256: 'xyz' } } })), /empreinte/);
  assert.throws(() => L.parseManifest(manifest({ assets: {} })), /complet absent/);
  // notes link: GitHub only; no Electron version → no app-only update
  assert.equal(L.parseManifest(manifest({ notes: 'https://evil.example/x' })).notes, '');
  assert.equal(L.parseManifest(manifest({ electron: '' })).assets.app, null);
});

test('asset: the small application zip only with the same Electron and a runtime to reuse', () => {
  const m = L.parseManifest(manifest());
  assert.equal(L.pickAsset(m, { electron: '44.5.1', canReuseRuntime: true }).kind, 'app');
  assert.equal(L.pickAsset(m, { electron: '44.6.0', canReuseRuntime: true }).kind, 'full');
  assert.equal(L.pickAsset(m, { electron: '44.5.1', canReuseRuntime: false }).kind, 'full', 'from the sources: the whole version');
  const feed = L.feedOf({ repo: 'grayzor/ambrosia' });
  assert.equal(feed.latest, 'https://github.com/grayzor/ambrosia/releases/latest/download/latest.json');
  assert.equal(L.assetUrl(feed, m, 'Ambrosia-0.1.58-app.zip'), 'https://github.com/grayzor/ambrosia/releases/download/v0.1.58/Ambrosia-0.1.58-app.zip');
});

test('hosts: GitHub and its file servers over https; a test feed on this machine only', () => {
  const gh = L.feedOf({ repo: 'grayzor/ambrosia' });
  assert.ok(L.trustedUrl('https://github.com/grayzor/ambrosia/releases/latest/download/latest.json', gh));
  assert.ok(L.trustedUrl('https://release-assets.githubusercontent.com/x', gh));
  assert.ok(L.trustedUrl('https://objects.githubusercontent.com/x', gh));
  assert.equal(L.trustedUrl('http://github.com/x', gh), false);
  assert.equal(L.trustedUrl('https://github.com.evil.example/x', gh), false);
  assert.equal(L.trustedUrl('https://evilgithubusercontent.com/x', gh), false);
  const local = L.feedOf({ base: 'http://127.0.0.1:5000/' });
  assert.equal(local.latest, 'http://127.0.0.1:5000/latest.json');
  assert.ok(L.trustedUrl('http://127.0.0.1:5000/a.zip', local));
  assert.equal(L.trustedUrl('https://example.com/a.zip', local), false);
});

test('when: a check every 3 h, not while locked, not right after a failure', () => {
  const h = 3600e3;
  assert.equal(L.checkDue({ now: 10 * h, lastCheck: 0 }), true);
  assert.equal(L.checkDue({ now: 10 * h, lastCheck: 9 * h }), false);
  assert.equal(L.checkDue({ now: 10 * h, lastCheck: 7 * h }), true);
  assert.equal(L.checkDue({ now: 10 * h, lastCheck: 0, locked: true }), false);
  assert.equal(L.checkDue({ now: 10 * h, lastCheck: 0, lastError: 10 * h - 60e3 }), false);
});

test('at start: automatic only when on, packaged, and not a version that just failed', () => {
  const now = 1e12;
  const base = { auto: true, mode: 'packaged', version: '0.1.58', now };
  assert.equal(L.autoAllowed(base), true);
  assert.equal(L.autoAllowed({ ...base, auto: false }), false, 'Réglages → automatique off: the button only');
  assert.equal(L.autoAllowed({ ...base, mode: 'source' }), false, 'never replaces the sources by itself');
  assert.equal(L.autoAllowed({ ...base, mode: 'dev' }), false);
  assert.equal(L.autoAllowed({ ...base, attempt: { version: '0.1.58', at: now - 60e3 } }), false, 'loop guard');
  assert.equal(L.autoAllowed({ ...base, attempt: { version: '0.1.58', at: now - 3600e3 } }), true);
  assert.equal(L.autoAllowed({ ...base, failed: '0.1.58' }), false, 'rolled back by the watchdog');
  assert.ok(L.startBudgetMs('app') < L.startBudgetMs('full'));
});

test('layout: version folders, the stable path through `current`, what to clean', () => {
  const home = path.join('C:', 'Users', 'u', 'AppData', 'Local', 'Ambrosia', 'app');
  assert.equal(L.versionOfDir(home, path.join(home, '0.1.58')), '0.1.58');
  assert.equal(L.versionOfDir(home, path.join(home, 'current')), null);
  assert.equal(L.versionOfDir(home, path.join(home, '0.1.58', 'resources')), null);
  assert.equal(L.versionOfDir(home, 'C:\\elsewhere\\0.1.58'), null);
  // Claude Code's hooks, the sign-in entry: through the junction once installed
  assert.equal(paths.stableRoot(path.join(home, '0.1.58', 'resources', 'app'), home), path.join(home, 'current', 'resources', 'app'));
  assert.equal(paths.stableRoot('C:\\dev\\ambrosia', home), 'C:\\dev\\ambrosia', 'the sources keep their own path');
  // keep: running, current, and one older spare; partial downloads go
  const names = ['0.1.50', '0.1.55', '0.1.56', '0.1.57', '0.1.58', 'current', '0.1.59.partial', 'notes.txt'];
  assert.deepStrictEqual(L.toRemove(names, { running: '0.1.57', current: '0.1.58' }).sort(), ['0.1.50', '0.1.55', '0.1.59.partial'].sort());
  assert.deepStrictEqual(L.toRemove(['0.1.57', '0.1.58'], { running: '0.1.58', current: '0.1.58' }), []);
});

test('watchdog: puts the previous version back only if the new one never started', () => {
  const ps = L.watchdogScript({ dataFile: 'C:\\d\\update.json', version: '0.1.58', current: 'C:\\h\\current', backDir: "C:\\h\\0.1.57", exe: 'C:\\h\\current\\Ambrosia.exe', delayS: 90 });
  assert.match(ps, /Start-Sleep -Seconds 90/);
  assert.match(ps, /\$j\.attempt\.version -ne '0\.1\.58'/);
  assert.match(ps, /New-Item -ItemType Junction -Path \$c -Target 'C:\\h\\0\.1\.57'/);
  assert.match(ps, /failed -NotePropertyValue '0\.1\.58'/);
  // from the sources: no junction to restore, electron.exe + the folder again
  const src = L.watchdogScript({ dataFile: 'C:\\d\\update.json', version: '0.1.58', current: 'C:\\h\\current', backDir: null, exe: 'C:\\n\\electron.exe', args: ["C:\\it's mine\\ambrosia"] });
  assert.doesNotMatch(src, /Junction/);
  assert.match(src, /-ArgumentList '"C:\\it''s mine\\ambrosia"'/);
});

// ── Files, for real ──────────────────────────────────────────────────────

const win = process.platform === 'win32' && fs.existsSync(I.tarExe());

function fakeVersion(dir, version, extra = 'x') {
  fs.mkdirSync(path.join(dir, 'resources', 'app', 'src', 'main'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Ambrosia.exe'), 'runtime ' + extra);
  fs.writeFileSync(path.join(dir, 'ffmpeg.dll'), 'dll');
  fs.mkdirSync(path.join(dir, 'locales'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'locales', 'fr.pak'), 'fr');
  fs.writeFileSync(path.join(dir, 'resources', 'app', 'package.json'), JSON.stringify({ version }));
  fs.writeFileSync(path.join(dir, 'resources', 'app', 'src', 'main', 'main.js'), `// ${version}`);
}

function zipOf(dir, file) {
  execFileSync(I.tarExe(), ['-a', '-c', '-f', file, '-C', dir, ...fs.readdirSync(dir)]);
  return fs.readFileSync(file);
}

test('download, assemble, switch, clean up (zips, local server, junctions)', { skip: !win && 'Windows only' }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ambrosia-upd-'));
  const home = path.join(tmp, 'app');
  const src = path.join(tmp, 'build');
  // The version in place, installed: 0.1.57.
  fakeVersion(path.join(home, '0.1.57'), '0.1.57');
  I.switchCurrent(home, '0.1.57');
  assert.equal(I.currentVersion(home), '0.1.57');

  // What CI would publish for 0.1.58: the whole version, and the application alone.
  fakeVersion(path.join(src, 'full'), '0.1.58', 'new');
  const fullZip = zipOf(path.join(src, 'full'), path.join(src, 'full.zip'));
  const appZip = zipOf(path.join(src, 'full', 'resources', 'app'), path.join(src, 'app.zip'));
  const files = { '/v0.1.58/full.zip': fullZip, '/v0.1.58/app.zip': appZip };
  const server = http.createServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { location: 'https://example.com/x.zip' });
      return res.end();
    }
    const body = files[req.url];
    if (!body) return res.writeHead(404).end();
    res.writeHead(200, { 'content-length': body.length });
    res.end(body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const feed = L.feedOf({ base: `http://127.0.0.1:${server.address().port}` });
  try {
    const dl = path.join(tmp, 'dl');
    // A wrong fingerprint: refused, nothing left behind.
    await assert.rejects(
      I.download({ fetch, url: `${feed.download}/v0.1.58/app.zip`, file: path.join(dl, 'app.zip'), sha256: 'f'.repeat(64), size: appZip.length, feed }),
      /SHA-256/,
    );
    assert.equal(fs.existsSync(path.join(dl, 'app.zip')), false);
    assert.equal(fs.existsSync(path.join(dl, 'app.zip.download')), false);
    // A host outside the feed: refused before any request.
    await assert.rejects(I.download({ fetch, url: 'https://example.com/a.zip', file: path.join(dl, 'a.zip'), feed }), /adresse refusée/);

    // Same Electron: the application zip, Electron's files hard-linked from 0.1.57.
    let p = 0;
    const z = await I.download({ fetch, url: `${feed.download}/v0.1.58/app.zip`, file: path.join(dl, 'app.zip'), sha256: sha(appZip), size: appZip.length, feed, onProgress: (g) => (p = g) });
    assert.equal(p, appZip.length);
    const dir = await I.assemble({ home, version: '0.1.58', kind: 'app', zip: z, runtimeDir: path.join(home, '0.1.57') });
    assert.equal(dir, path.join(home, '0.1.58'));
    assert.equal(fs.readFileSync(path.join(dir, 'Ambrosia.exe'), 'utf8'), 'runtime x', 'the runtime in place, reused');
    assert.equal(fs.readFileSync(path.join(dir, 'locales', 'fr.pak'), 'utf8'), 'fr');
    assert.equal(fs.readFileSync(path.join(dir, 'resources', 'app', 'src', 'main', 'main.js'), 'utf8'), '// 0.1.58');
    assert.equal(fs.existsSync(path.join(home, '0.1.58.partial')), false);

    // The running version untouched, `current` switched.
    I.switchCurrent(home, '0.1.58');
    assert.equal(I.currentVersion(home), '0.1.58');
    assert.equal(fs.readFileSync(path.join(home, 'current', 'resources', 'app', 'package.json'), 'utf8'), '{"version":"0.1.58"}');
    assert.equal(fs.readFileSync(path.join(home, '0.1.57', 'resources', 'app', 'src', 'main', 'main.js'), 'utf8'), '// 0.1.57');

    // A new Electron: the whole version.
    fs.rmSync(dir, { recursive: true });
    fs.rmSync(path.join(home, 'current'));
    const zf = await I.download({ fetch, url: `${feed.download}/v0.1.58/full.zip`, file: path.join(dl, 'full.zip'), sha256: sha(fullZip), size: fullZip.length, feed });
    await I.assemble({ home, version: '0.1.58', kind: 'full', zip: zf });
    assert.equal(fs.readFileSync(path.join(home, '0.1.58', 'Ambrosia.exe'), 'utf8'), 'runtime new');
    I.switchCurrent(home, '0.1.58');

    // A zip announcing another version is refused.
    await assert.rejects(I.assemble({ home, version: '0.1.59', kind: 'full', zip: zf }), /annonce 0\.1\.58/);
    assert.equal(fs.existsSync(path.join(home, '0.1.59.partial')), false);

    // Clean-up: older versions go, the running one, current and one spare stay.
    fakeVersion(path.join(home, '0.1.40'), '0.1.40');
    fakeVersion(path.join(home, '0.1.41'), '0.1.41');
    fs.mkdirSync(path.join(home, '0.1.60.partial'));
    const removed = I.cleanup(home, { running: '0.1.58' });
    assert.deepStrictEqual(removed.sort(), ['0.1.40', '0.1.41', '0.1.60.partial']);
    assert.deepStrictEqual(fs.readdirSync(home).sort(), ['0.1.57', '0.1.58', 'current']);
    assert.equal(I.currentVersion(home), '0.1.58', 'the junction itself is never removed by the clean-up');

    // removeLink never deletes a real folder.
    assert.throws(() => I.removeLink(path.join(home, '0.1.57')), /pas un lien/);
    assert.ok(fs.existsSync(path.join(home, '0.1.57', 'Ambrosia.exe')));
  } finally {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
