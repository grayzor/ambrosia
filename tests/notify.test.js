// Scripts (src/modules/notify): the pure logic (cleaning, « Ouvrir » targets, the
// board of activities, throttling, alerts, ticker), the command's files on a scratch
// folder, and the module itself with a fake ctx (nothing opened, no Electron).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ambrosia-notify-'));
process.env.APPDATA = path.join(tmp, 'roaming');
process.env.LOCALAPPDATA = path.join(tmp, 'local');

const L = require('../src/modules/notify/logic');
const install = require('../src/modules/notify/install');

const T0 = 1_760_000_000_000;
const msg = (p) => L.normalize(p).msg;

test('normalize: live, done, error, one-shot; nothing to show is an error', () => {
  assert.equal(msg({ key: 'Sauvegarde NAS!', title: 'x' }).key, 'sauvegarde-nas');
  assert.equal(msg({ key: 'a', title: 'x' }).status, 'live');
  assert.equal(msg({ key: 'a', state: 'done' }).status, 'done');
  assert.equal(msg({ key: 'a', state: 'error' }).status, 'error');
  assert.equal(msg({ title: 'Script fini' }).status, 'info');
  assert.equal(msg({ key: 'a', progress: 0.5 }).progress, 0.5);
  assert.equal(msg({ key: 'a', progress: 7 }).progress, 1);
  assert.equal(msg({ key: 'a', progress: 'x', title: 't' }).progress, undefined);
  assert.equal(msg({ title: 't', priority: 'urgent' }).priority, undefined);
  assert.equal(msg({ title: 't', ttl: 99999 }).ttl, L.LIMITS.ttlMax);
  assert.equal(msg({ title: 't', ttl: 1 }).ttl, L.LIMITS.ttlMin);
  for (const bad of [null, [], 'x', {}, { key: 'a' }, { title: '   ' }, { key: '---', text: '' }]) {
    assert.ok(L.normalize(bad).error, JSON.stringify(bad));
  }
});

test('cleanText: control characters out, capped, bidi tricks removed', () => {
  assert.equal(L.cleanText('a\u0000b\r\nc\u001b[31m', 50), 'a b c [31m');
  assert.equal(L.cleanText('abc\u202edef', 50), 'abc def');
  const long = L.cleanText('x'.repeat(500), L.LIMITS.title);
  assert.equal(long.length, L.LIMITS.title);
  assert.ok(long.endsWith('…'));
  assert.equal(msg({ title: 'y'.repeat(500) }).title.length, L.LIMITS.title);
});

test('openTarget / openPlan: https or an absolute path; executables open their folder', () => {
  assert.deepEqual(L.openTarget('https://nas.example.com/logs?x=1'), { kind: 'url', target: 'https://nas.example.com/logs?x=1' });
  assert.deepEqual(L.openTarget('C:\\Logs\\..\\Logs\\backup.log'), { kind: 'path', target: 'C:\\Logs\\backup.log' });
  assert.deepEqual(L.openTarget('\\\\nas.corp.local\\share\\r.html'), { kind: 'path', target: '\\\\nas.corp.local\\share\\r.html' });
  for (const bad of ['http://x', 'file:///C:/x', 'javascript:alert(1)', 'relative\\x.txt', '\\\\?\\C:\\x', '\\\\.\\pipe\\x', 'C:\\a\nb', 42, '']) {
    assert.equal(L.openTarget(bad), null, String(bad));
  }
  assert.equal(msg({ title: 't', open: 'ms-settings:' }).open, undefined);
  assert.deepEqual(L.openPlan({ kind: 'path', target: 'C:\\Logs\\backup.log' }), { how: 'path', target: 'C:\\Logs\\backup.log' });
  assert.deepEqual(L.openPlan({ kind: 'path', target: 'C:\\Logs' }), { how: 'path', target: 'C:\\Logs' });
  for (const exe of ['C:\\Tools\\run.EXE', 'C:\\Tools\\x.ps1', 'C:\\Tools\\x.bat', 'C:\\Tools\\x.lnk', 'C:\\Tools\\x.vbs']) {
    assert.deepEqual(L.openPlan({ kind: 'path', target: exe }), { how: 'folder', target: 'C:\\Tools' }, exe);
  }
  assert.deepEqual(L.openPlan({ kind: 'url', target: 'https://x.example/' }), { how: 'url', target: 'https://x.example/' });
  assert.equal(L.openPlan(null), null);
});

test('Board: start, update, milestones, done with duration', () => {
  const b = new L.Board();
  let r = b.apply(msg({ key: 'nas', title: 'Sauvegarde NAS', text: '0/40 Go', progress: 0 }), T0);
  assert.equal(r.kind, 'start');
  r = b.apply(msg({ key: 'nas', progress: 0.1 }), T0 + 2000);
  assert.equal(r.kind, 'update');
  assert.equal(r.item.text, '0/40 Go'); // kept when not sent again
  assert.equal(r.item.title, 'Sauvegarde NAS');
  r = b.apply(msg({ key: 'nas', progress: 0.3, text: '12/40 Go' }), T0 + 4000);
  assert.equal(r.kind, 'milestone');
  r = b.apply(msg({ key: 'nas', progress: 0.4 }), T0 + 6000);
  assert.equal(r.kind, 'update');
  r = b.apply(msg({ key: 'nas', progress: 1 }), T0 + 8000);
  assert.equal(r.kind, 'update'); // 100 % is the end's job, not a ticker
  assert.equal(b.liveList().length, 1);
  r = b.apply(msg({ key: 'nas', state: 'done' }), T0 + 14 * 60000);
  assert.equal(r.kind, 'done');
  assert.equal(b.liveList().length, 0);
  assert.equal(b.recent[0].status, 'done');
  assert.equal(b.recent[0].title, 'Sauvegarde NAS');
  const a = L.alertFor('done', r.item);
  assert.equal(a.text, 'Terminé en 14 min');
  assert.equal(a.mood, 'finished');
  assert.equal(a.sound, 'tick');
  assert.equal(a.key, 'nas');
  assert.ok(!('ttl' in a), 'no undefined ttl over the host default');
  assert.ok(!('msg' in b.recent[0]), 'the raw message is not kept');
});

test('Board: error, one-shot, unknown key, quiet and priorities', () => {
  const b = new L.Board();
  b.apply(msg({ key: 'robo', title: 'Robocopy', open: 'C:\\Logs\\robo.log' }), T0);
  let r = b.apply(msg({ key: 'robo', state: 'error', text: 'Échec : disque plein' }), T0 + 1000);
  let a = L.alertFor(r.kind, r.item);
  assert.equal(a.mood, 'error');
  assert.equal(a.sound, 'error');
  assert.equal(a.text, 'Échec : disque plein');
  assert.equal(a.priority, L.PRIORITY.normal + 10);
  assert.equal(a.ttl, 30);
  assert.deepEqual(a.actions, [{ label: 'Ouvrir', action: 'open', payload: { id: r.item.id }, primary: true }]);
  assert.equal(b.find(r.item.id).open.target, 'C:\\Logs\\robo.log');

  r = b.apply(msg({ title: 'Script fini', quiet: true }), T0 + 2000);
  assert.equal(r.kind, 'info');
  a = L.alertFor(r.kind, r.item);
  assert.equal(a.sound, null);
  assert.equal(a.text, '');
  assert.equal(a.count, 1);

  r = b.apply(msg({ key: 'never-started', state: 'done', priority: 'high', pin: true, ttl: 60 }), T0 + 3000);
  a = L.alertFor(r.kind, r.item);
  assert.equal(a.title, 'never-started');
  assert.equal(a.text, 'Terminé');
  assert.equal(a.sound, 'finish');
  assert.equal(a.priority, L.PRIORITY.high);
  assert.equal(a.pin, true);
  assert.equal(a.ttl, 60);

  b.apply(msg({ key: 'low', title: 'x', priority: 'low' }), T0);
  r = b.apply(msg({ key: 'low', state: 'done' }), T0 + 1000);
  assert.equal(L.alertFor(r.kind, r.item).sound, null); // low priority: silent, kept from the start
});

test('Board: throttle per key, limit of live keys, flood guard', () => {
  const b = new L.Board();
  const m = msg({ key: 'k', title: 't', progress: 0.1 });
  assert.equal(b.wait(m, T0), 0);
  b.apply(m, T0);
  assert.equal(b.wait(m, T0 + 300), 700);
  assert.equal(b.wait(m, T0 + 1000), 0);
  assert.equal(b.wait(msg({ key: 'k', state: 'done' }), T0 + 10), 0); // the end never waits
  assert.equal(b.wait(msg({ key: 'other', title: 't' }), T0 + 10), 0);

  for (let i = 1; i < L.LIMITS.keys; i++) b.apply(msg({ key: `k${i}`, title: 't' }), T0);
  assert.equal(b.live.size, L.LIMITS.keys);
  assert.equal(b.apply(msg({ key: 'one-too-many', title: 't' }), T0).kind, 'full');
  assert.equal(b.apply(msg({ key: 'k1', text: 'still fine' }), T0 + 5000).kind, 'update');

  let allowed = 0;
  for (let i = 0; i < 20; i++) allowed += b.alertAllowed(T0 + i * 100) ? 1 : 0;
  assert.equal(allowed, L.LIMITS.alertsPerMin);
  assert.ok(b.alertAllowed(T0 + 61000));
});

test('Board: stale activities expire silently, recent is capped, dismiss and forget', () => {
  const b = new L.Board();
  b.apply(msg({ key: 'old', title: 'Vieux script' }), T0);
  b.apply(msg({ key: 'fresh', title: 'Récent' }), T0 + L.LIMITS.staleMs - 1000);
  const gone = b.expire(T0 + L.LIMITS.staleMs + 1);
  assert.deepEqual(gone.map((g) => g.key), ['old']);
  assert.equal(b.recent[0].status, 'stale');
  assert.ok(b.live.has('fresh'));
  assert.ok(b.forget('fresh'));
  assert.equal(b.live.size, 0);
  for (let i = 0; i < 30; i++) b.apply(msg({ title: `n${i}` }), T0 + i);
  assert.equal(b.recent.length, L.LIMITS.recent);
  assert.equal(b.recent[0].title, 'n29');
  assert.ok(b.dismiss(b.recent[0].id));
  assert.equal(b.recent[0].title, 'n28');
  // Saved data comes back.
  const again = new L.Board({ recent: b.recent });
  assert.equal(again.recent.length, b.recent.length);
});

test('tickerFor: title as lead, text and percentage', () => {
  const b = new L.Board();
  const { item } = b.apply(msg({ key: 'nas', title: 'Sauvegarde NAS', text: '12/40 Go', progress: 0.3 }), T0);
  const t = L.tickerFor(item, 3, T0);
  assert.equal(t.key, 'notify:nas');
  assert.equal(t.seq, 3);
  assert.equal(t.lead, 'Sauvegarde NAS');
  assert.deepEqual(t.parts, [{ name: '12/40 Go', text: '30 %' }]);
  assert.equal(t.foldedOnly, true);
  const bare = L.tickerFor(b.apply(msg({ key: 'b', title: 'Build' }), T0).item, 4, T0);
  assert.deepEqual(bare.parts, [{ name: 'en cours', text: null }]);
});

test('duration: seconds, minutes, hours', () => {
  assert.equal(L.duration(400), 'en 1 s');
  assert.equal(L.duration(40000), 'en 40 s');
  assert.equal(L.duration(14 * 60000), 'en 14 min');
  assert.equal(L.duration(65 * 60000), 'en 1 h 05');
});

test('install: the wrapper calls the script next to it, rewritten only when it changed', () => {
  const plain = install.wrapperText({ node: 'C:\\Program Files\\nodejs\\node.exe' });
  assert.match(plain, /^@echo off\r\n/);
  assert.match(plain, /"C:\\Program Files\\nodejs\\node\.exe" "%~dp0ambrosia-notify\.js" %\*\r\n$/);
  assert.ok(/^[\x00-\x7f]*$/.test(plain), 'ASCII only: cmd.exe reads the OEM code page');
  assert.match(install.wrapperText({ node: 'C:\\Users\\Clément\\node\\node.exe' }), /^node "%~dp0ambrosia-notify\.js" %\*/m);
  const el = install.wrapperText({ node: null, electron: 'C:\\app\\electron.exe' });
  assert.match(el, /set ELECTRON_RUN_AS_NODE=1\r\n"C:\\app\\electron\.exe" "%~dp0ambrosia-notify\.js" %\*/);

  const bin = path.join(tmp, 'bin-test');
  const first = install.ensureWrapper({ node: 'C:\\node\\node.exe', bin });
  assert.equal(first.changed, true);
  assert.equal(install.ensureWrapper({ node: 'C:\\node\\node.exe', bin }).changed, false);
  assert.equal(install.ensureWrapper({ node: 'D:\\node\\node.exe', bin }).changed, true);
  assert.equal(fs.readFileSync(path.join(bin, 'ambrosia-notify.js'), 'utf8'), fs.readFileSync(install.SOURCE, 'utf8'));
});

test('install: inPath', () => {
  assert.ok(install.inPath('C:\\Windows;C:\\Users\\me\\AppData\\Local\\Ambrosia\\bin\\;', 'c:\\users\\me\\appdata\\local\\ambrosia\\bin'));
  assert.ok(!install.inPath('C:\\Windows;C:\\Users\\me\\AppData\\Local\\Ambrosia', 'C:\\Users\\me\\AppData\\Local\\Ambrosia\\bin'));
  assert.ok(!install.inPath('', 'C:\\x'));
});

// ── The module, with a fake ctx ──────────────────────────────────────────────

function fakeCtx({ paused = false } = {}) {
  const hooks = new EventEmitter();
  const ctx = {
    hooks,
    states: [],
    alerts: [],
    opened: [],
    actions: new Map(),
    saved: null,
    log: () => {},
    data: { load: (fb) => fb, save: (v) => (ctx.saved = v) },
    setState: (s) => ctx.states.push(JSON.parse(JSON.stringify(s))),
    alert: (a) => ctx.alerts.push(a),
    paused: () => paused,
    pausedByUser: () => paused,
    focus: () => {},
    onAction: (name, fn) => ctx.actions.set(name, fn),
    openExternal: (u) => ctx.opened.push(['url', u]),
    openPath: async (p) => (ctx.opened.push(['path', p]), ''),
    last: () => ctx.states[ctx.states.length - 1],
    send: (payload) => hooks.emit('notify', { payload }),
  };
  return ctx;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('module: coalesces fast updates, the end wins, alerts once', async (t) => {
  const mod = require('../src/modules/notify/main');
  const ctx = fakeCtx();
  mod.init(ctx);
  t.after(() => mod.dispose());
  assert.ok(fs.existsSync(install.WRAPPER), 'the command is written at startup');

  ctx.send({ key: 'nas', title: 'Sauvegarde NAS', progress: 0.1 });
  assert.equal(ctx.last().live[0].progress, 0.1);
  assert.equal(ctx.last().ticker.lead, 'Sauvegarde NAS');
  for (let i = 2; i <= 9; i++) ctx.send({ key: 'nas', progress: i / 100, text: `${i} Go` });
  ctx.send({ key: 'nas', progress: 0.12 });
  await sleep(50);
  assert.equal(ctx.last().live[0].progress, 0.1, 'throttled: nothing applied yet');
  await sleep(1400);
  const live = ctx.last().live[0];
  assert.equal(live.progress, 0.12, 'the latest wins');
  assert.equal(live.text, '9 Go', 'fields it omitted come from the earlier ones');

  ctx.send({ key: 'nas', progress: 0.5 });
  ctx.send({ key: 'nas', state: 'done', text: 'Terminé en 14 min' });
  await sleep(1200);
  assert.equal(ctx.alerts.length, 1);
  assert.equal(ctx.alerts[0].text, 'Terminé en 14 min');
  assert.equal(ctx.last().live.length, 0, 'the throttled progress did not bring it back');
  assert.equal(ctx.saved.recent[0].status, 'done');

  // Garbage is ignored.
  ctx.send('nope');
  ctx.send({ key: 'x' });
  assert.equal(ctx.alerts.length, 1);
});

test('module: « Ouvrir » re-checks the target; paused means no alert', async (t) => {
  const mod = require('../src/modules/notify/main');
  const ctx = fakeCtx({ paused: true });
  mod.init(ctx);
  t.after(() => mod.dispose());
  const file = path.join(tmp, 'rapport.log');
  fs.writeFileSync(file, 'ok');
  ctx.send({ title: 'Rapport prêt', open: file });
  ctx.send({ title: 'Manquant', open: path.join(tmp, 'absent.log') });
  ctx.send({ title: 'Site', open: 'https://nas.example.com/' });
  ctx.send({ title: 'Outil', open: 'C:\\Windows\\System32\\calc.exe' });
  assert.equal(ctx.alerts.length, 0, 'paused');
  const [outil, site, manquant, rapport] = ctx.last().recent;
  const open = ctx.actions.get('open');
  assert.equal(await open({ id: rapport.id }), true);
  assert.match(await open({ id: manquant.id }), /^Introuvable/);
  await open({ id: site.id });
  await open({ id: outil.id });
  assert.equal(await open({ id: 'made-up' }), 'Rien à ouvrir.');
  assert.deepEqual(ctx.opened, [['path', file], ['url', 'https://nas.example.com/'], ['path', 'C:\\Windows\\System32']]);
});
