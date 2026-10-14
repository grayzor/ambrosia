// The statusLine relay must print exactly what the user's own statusLine prints,
// and hand the plan gauges to Ambrosia without delaying it.

const test = require('node:test');
const assert = require('node:assert');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'hook', 'ambrosia-statusline.js');

function sandbox() {
  const user = `amb-sl-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const local = fs.mkdtempSync(path.join(os.tmpdir(), 'amb-'));
  fs.mkdirSync(path.join(local, 'Ambrosia'));
  fs.writeFileSync(path.join(local, 'Ambrosia', 'hook-token'), 'secret');
  return { user, local, pipe: `\\\\.\\pipe\\ambrosia-${user}` };
}

function run(box, args, input) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [SCRIPT, ...args], { env: { ...process.env, USERNAME: box.user, LOCALAPPDATA: box.local, AMBROSIA_INTERNAL: '' } });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ code, out, ms: Date.now() - started }));
    child.stdin.end(typeof input === 'string' ? input : JSON.stringify(input));
  });
}

const chain = (cmd) => ['--chain', Buffer.from(cmd).toString('base64url')];
const sample = {
  session_id: 's1',
  workspace: { current_dir: 'C:\\dev\\ambrosia' },
  model: { display_name: 'Opus' },
  context_window: { used_percentage: 42 },
  rate_limits: { five_hour: { used_percentage: 23.5, resets_at: 1738425600 }, seven_day: { used_percentage: 41.2, resets_at: 1738857600 } },
  transcript_path: 'C:\\secret\\path.jsonl',
};

test('no Ambrosia, no previous statusLine: a short line of its own, quick', async () => {
  const r = await run(sandbox(), [], sample);
  assert.equal(r.code, 0);
  assert.equal(r.out.trim(), 'Opus · contexte 42 % · 5 h 24 % · semaine 41 %');
  assert.ok(r.ms < 2500, `took ${r.ms} ms`);
  const garbage = await run(sandbox(), [], 'pas du json');
  assert.equal(garbage.out.trim(), '');
});

test('the chained command prints exactly as before, and its exit code is kept', async () => {
  const box = sandbox();
  const r = await run(box, chain('echo ligne-de-statut'), sample);
  assert.equal(r.out.trim(), 'ligne-de-statut');
  assert.equal(r.code, 0);
  const bad = await run(box, chain('exit 3'), sample);
  assert.equal(bad.code, 3);
});

test('the gauges reach Ambrosia, nothing else from the JSON', async () => {
  const box = sandbox();
  const got = new Promise((resolve) => {
    const server = net.createServer((s) => {
      let buf = '';
      s.on('data', (d) => {
        buf += d;
        if (!buf.includes('\n')) return;
        resolve(JSON.parse(buf.split('\n')[0]));
        server.close();
      });
    }).listen(box.pipe);
  });
  const r = await run(box, chain('echo ok'), sample);
  const msg = await got;
  assert.equal(r.out.trim(), 'ok');
  assert.equal(msg.token, 'secret');
  assert.equal(msg.waits, false);
  assert.equal(msg.payload.hook_event_name, 'StatusLine');
  assert.deepEqual(msg.payload.rate_limits.five_hour, { used_percentage: 23.5, resets_at: 1738425600 });
  assert.equal(msg.payload.cwd, 'C:\\dev\\ambrosia');
  assert.equal(msg.payload.transcript_path, undefined);
});

test('effort level and session name are passed on when present (session cards)', () => {
  const { extract } = require('../hook/ambrosia-statusline');
  const x = extract({ ...sample, effort: { level: 'xhigh' }, session_name: 'Jauges du forfait' });
  assert.deepEqual(x.effort, { level: 'xhigh' });
  assert.equal(x.session_name, 'Jauges du forfait');
  const none = extract(sample);
  assert.equal(none.effort, undefined, 'absent when the model takes no effort level');
  assert.equal(none.session_name, undefined);
});
