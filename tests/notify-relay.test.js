// ambrosia-notify: the argument parsing, and the real command against the real
// HookServer on a throwaway pipe (USERNAME, APPDATA and LOCALAPPDATA are overridden
// before anything from src/main is loaded).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'amb-notify-'));
const env = {
  ...process.env,
  USERNAME: `amb-notify-${process.pid}-${Math.random().toString(36).slice(2, 8)}`,
  APPDATA: path.join(tmp, 'roaming'),
  LOCALAPPDATA: path.join(tmp, 'local'),
};
Object.assign(process.env, { USERNAME: env.USERNAME, APPDATA: env.APPDATA, LOCALAPPDATA: env.LOCALAPPDATA });

const CLI = path.join(__dirname, '..', 'hook', 'ambrosia-notify.js');
const { parseArgs, parseProgress } = require(CLI);

function run(args, extraEnv = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [CLI, ...args], { env: { ...env, ...extraEnv } });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => resolve({ code, out, err, ms: Date.now() - started }));
  });
}

test('parseProgress: fractions, percentages, commas', () => {
  assert.equal(parseProgress('0.3'), 0.3);
  assert.equal(parseProgress('0,5'), 0.5);
  assert.equal(parseProgress('30'), 0.3);
  assert.equal(parseProgress('30%'), 0.3);
  assert.equal(parseProgress('45 %'), 0.45);
  assert.equal(parseProgress('1'), 1);
  assert.equal(parseProgress('0'), 0);
  assert.equal(parseProgress('100'), 1);
  assert.equal(parseProgress('150'), null);
  assert.equal(parseProgress('-1'), null);
  assert.equal(parseProgress('abc'), null);
  assert.equal(parseProgress(''), null);
});

test('parseArgs: a progressing activity', () => {
  const r = parseArgs(['--key', 'sauvegarde', '--title', 'Sauvegarde NAS', '--text', '12/40 Go', '--progress', '0.3']);
  assert.deepEqual(r, { payload: { key: 'sauvegarde', title: 'Sauvegarde NAS', text: '12/40 Go', progress: 0.3 } });
});

test('parseArgs: done, error, flags, = form and single dashes', () => {
  assert.deepEqual(parseArgs(['--key', 'b', '--done', '--text', 'Terminé en 14 min']).payload, { key: 'b', text: 'Terminé en 14 min', state: 'done' });
  assert.deepEqual(parseArgs(['--key=b', '--error']).payload, { key: 'b', state: 'error' });
  assert.deepEqual(parseArgs(['-Key', 'b', '-Title', 'Copie', '-Quiet', '-Pin', '-Priority', 'HIGH', '-ttl', '20']).payload, {
    key: 'b', title: 'Copie', quiet: true, pin: true, priority: 'high', ttl: 20,
  });
  // A value that looks like an option is still the value.
  assert.equal(parseArgs(['--title', 'Temp', '--text', '-5 °C']).payload.text, '-5 °C');
});

test('parseArgs: bare words make the title, then the text', () => {
  assert.deepEqual(parseArgs(['Script', 'fini']).payload, { title: 'Script fini' });
  assert.deepEqual(parseArgs(['--title', 'Robocopy', 'code', '1']).payload, { title: 'Robocopy', text: 'code 1' });
});

test('parseArgs: --open takes https or a path (made absolute), nothing else', () => {
  assert.equal(parseArgs(['--title', 'x', '--open', 'https://nas.example.com/logs']).payload.open, 'https://nas.example.com/logs');
  assert.equal(parseArgs(['--title', 'x', '--open', 'C:\\Logs\\backup.log']).payload.open, 'C:\\Logs\\backup.log');
  assert.equal(parseArgs(['--title', 'x', '--open', 'logs\\a.txt'], 'D:\\Scripts').payload.open, 'D:\\Scripts\\logs\\a.txt');
  assert.equal(parseArgs(['--title', 'x', '--open', '\\\\nas\\share\\rapport.html']).payload.open, '\\\\nas\\share\\rapport.html');
  for (const bad of ['http://intranet/x', 'file:///C:/x', 'ms-settings:display', 'javascript:alert(1)', '']) {
    assert.ok(parseArgs(['--title', 'x', '--open', bad]).error, bad);
  }
});

test('parseArgs: invalid input is an error, help is help', () => {
  for (const args of [
    [],
    ['--key', 'x'],
    ['--title'],
    ['--frobnicate'],
    ['--title', 'x', '--progress', 'beaucoup'],
    ['--title', 'x', '--ttl', '0'],
    ['--title', 'x', '--priority', 'urgent'],
    ['--key', 'x', '--done', '--error'],
    ['--key', '  ', '--done'],
    ['--done=yes', '--key', 'x'],
    ['--title', 'a', '--text', 'b', 'c'],
  ]) {
    assert.ok(parseArgs(args).error, JSON.stringify(args));
  }
  assert.ok(parseArgs(['--help']).help);
  assert.ok(parseArgs(['/?']).help);
  // Progress alone on a known key is enough.
  assert.deepEqual(parseArgs(['--key', 'x', '--progress', '50%']).payload, { key: 'x', progress: 0.5 });
});

test('parseArgs: long strings are capped', () => {
  const r = parseArgs(['--title', 'x'.repeat(5000), '--text', 'y'.repeat(5000)]);
  assert.ok(r.payload.title.length <= 200);
  assert.ok(r.payload.text.length <= 600);
});

test('command: no Ambrosia → exit 0 at once; bad args → exit 2', async () => {
  const none = await run(['--title', 'Script fini'], { LOCALAPPDATA: path.join(tmp, 'nowhere') });
  assert.equal(none.code, 0);
  assert.ok(none.ms < 1500, `took ${none.ms} ms`);
  const bad = await run(['--progress', 'x']);
  assert.equal(bad.code, 2);
  assert.match(bad.err, /ambrosia-notify/);
  const help = await run(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.out, /--progress/);
});

test('command → HookServer: emitted as notify, never as a Claude Code hook', async (t) => {
  const server = require('../src/main/hook-server');
  server.start();
  t.after(() => server.stop());
  await new Promise((r) => setTimeout(r, 150)); // listening
  const hooks = [];
  server.on('hook', (ev) => hooks.push(ev));
  const got = new Promise((resolve) => server.once('notify', resolve));
  const r = await run(['--key', 'sauvegarde', '--title', 'Sauvegarde NAS', '--progress', '30%']);
  assert.equal(r.code, 0);
  const ev = await got;
  assert.deepEqual(ev.payload, { key: 'sauvegarde', title: 'Sauvegarde NAS', progress: 0.3 });
  assert.equal(hooks.length, 0);

  // A wrong token is refused: nothing is emitted.
  fs.writeFileSync(path.join(env.LOCALAPPDATA, 'Ambrosia', 'hook-token'), 'not-the-token');
  let leaked = false;
  server.once('notify', () => (leaked = true));
  await run(['--title', 'intrus']);
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(leaked, false);
});
