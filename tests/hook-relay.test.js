// The relay must never block Claude Code, and must print exactly the documented
// JSON when the island answers. Each test runs the real hook/ambrosia-hook.js
// against a throwaway pipe (USERNAME and LOCALAPPDATA are overridden).

const test = require('node:test');
const assert = require('node:assert');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const HOOK = path.join(__dirname, '..', 'hook', 'ambrosia-hook.js');

function sandbox() {
  const user = `amb-test-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const local = fs.mkdtempSync(path.join(os.tmpdir(), 'amb-'));
  fs.mkdirSync(path.join(local, 'Ambrosia'));
  fs.writeFileSync(path.join(local, 'Ambrosia', 'hook-token'), 'secret');
  return { user, local, pipe: `\\\\.\\pipe\\ambrosia-${user}` };
}

function runHook(box, args, payload) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [HOOK, ...args], {
      env: { ...process.env, USERNAME: box.user, LOCALAPPDATA: box.local, AMBROSIA_INTERNAL: '' },
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ code, out: out.trim(), ms: Date.now() - started }));
    child.stdin.end(JSON.stringify(payload));
  });
}

test('no island running: exits at once, prints nothing', async () => {
  const box = sandbox();
  const r = await runHook(box, ['PermissionRequest'], { hook_event_name: 'PermissionRequest', tool_name: 'Bash' });
  assert.equal(r.code, 0);
  assert.equal(r.out, '');
  assert.ok(r.ms < 2000, `took ${r.ms} ms`);
});

test('fire-and-forget event reaches the island with the token', async () => {
  const box = sandbox();
  const got = new Promise((resolve) => {
    const server = net.createServer((s) => {
      s.on('data', (d) => {
        resolve(JSON.parse(String(d).split('\n')[0]));
        s.end();
        server.close();
      });
    }).listen(box.pipe);
  });
  const r = await runHook(box, ['PreToolUse'], { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_response: 'x'.repeat(10) });
  const msg = await got;
  assert.equal(r.out, '');
  assert.equal(msg.token, 'secret');
  assert.equal(msg.waits, false);
  assert.equal(msg.payload.tool_name, 'Read');
  assert.equal(msg.payload.tool_response, undefined);
  // where the session runs, for "terminal in front?" — resolved later by Ambrosia
  assert.equal(msg.payload.ambrosia_ppid, process.pid);
});

/** A pipe that records every message, never answers. */
function recorder(box) {
  const got = [];
  const server = net.createServer((s) => {
    let buf = '';
    s.on('data', (d) => {
      buf += d;
      if (buf.includes('\n')) got.push(JSON.parse(buf.split('\n')[0]));
    });
  }).listen(box.pipe);
  return { got, close: () => server.close() };
}

test('edits are measured and test results read before long fields are cut', async () => {
  const box = sandbox();
  const rec = recorder(box);
  const big = Array.from({ length: 3000 }, (_, i) => `ligne ${i}`).join('\n'); // > 4000 chars: truncated in the payload
  await runHook(box, ['PreToolUse'], { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'C:\\p\\a.js', old_string: 'x', new_string: big } });
  await runHook(box, ['PostToolUse'], { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: { stdout: '# pass 45\n# fail 0\n', stderr: '' } });
  await new Promise((r) => setTimeout(r, 100));
  rec.close();
  const [edit, run] = rec.got;
  assert.deepEqual(edit.payload.ambrosia_diff, { file: 'C:\\p\\a.js', add: 3000, del: 1 });
  assert.ok(edit.payload.tool_input.new_string.length < 4100);
  // The texts for the island's diff survive the cut (up to relay-lib's own caps).
  assert.deepEqual(edit.payload.ambrosia_edit, { tool: 'Edit', blocks: [{ old: 'x', new: big, cut: false }], omitted: 0 });
  assert.equal(run.payload.ambrosia_test.ok, true);
  assert.match(run.payload.ambrosia_test.tail, /# pass 45/);
  assert.equal(run.payload.tool_response, undefined);
});

test('fire-and-forget never waits for Ambrosia’s answer', async () => {
  const box = sandbox();
  const rec = recorder(box); // reads, never replies, never closes
  const r = await runHook(box, ['PostToolUse'], { hook_event_name: 'PostToolUse', session_id: 's1', tool_name: 'Read' });
  rec.close();
  assert.equal(r.out, '');
  assert.ok(r.ms < 1500, `took ${r.ms} ms`);
});

test('queued note: delivered as additionalContext by the next PostToolUse, at once, once', async () => {
  const box = sandbox();
  const dir = path.join(box.local, 'Ambrosia', 'nudges');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 's1~n1.json'), JSON.stringify({ id: 'n1', text: 'Utilise pnpm', at: 1 }));
  const rec = recorder(box);
  const sub = await runHook(box, ['PostToolUse'], { hook_event_name: 'PostToolUse', session_id: 's1', agent_id: 'sub', tool_name: 'Read' });
  assert.equal(sub.out, '', 'a subagent never gets the main agent’s notes');
  const r = await runHook(box, ['PostToolUse'], { hook_event_name: 'PostToolUse', session_id: 's1', tool_name: 'Read' });
  const again = await runHook(box, ['PostToolUse'], { hook_event_name: 'PostToolUse', session_id: 's1', tool_name: 'Read' });
  await new Promise((res) => setTimeout(res, 100));
  rec.close();
  assert.deepEqual(JSON.parse(r.out), {
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'Note de l’utilisateur, ajoutée pendant que tu travaillais : Utilise pnpm' },
  });
  assert.ok(r.ms < 1500, `took ${r.ms} ms`);
  assert.equal(again.out, '');
  assert.deepEqual(rec.got.find((m) => m.payload.ambrosia_delivered)?.payload.ambrosia_delivered, ['n1']);
});

test('queued note: still delivered when Ambrosia is closed, with UserPromptSubmit too', async () => {
  const box = sandbox();
  const dir = path.join(box.local, 'Ambrosia', 'nudges');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 's9~n1.json'), JSON.stringify({ id: 'n1', text: 'Pense au changelog', at: 1 }));
  const r = await runHook(box, ['UserPromptSubmit'], { hook_event_name: 'UserPromptSubmit', session_id: 's9', prompt: 'continue' });
  assert.equal(JSON.parse(r.out).hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(JSON.parse(r.out).hookSpecificOutput.additionalContext, /Pense au changelog/);
  assert.ok(r.ms < 1500, `took ${r.ms} ms`);
});

test('permission: "always" prints allow + the suggested rules', async () => {
  const box = sandbox();
  const server = net.createServer((s) => {
    s.on('data', () => s.end(JSON.stringify({ decision: 'always' }) + '\n'));
  }).listen(box.pipe);
  const suggestion = { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test' }], behavior: 'allow', destination: 'localSettings' };
  const r = await runHook(box, ['PermissionRequest'], { hook_event_name: 'PermissionRequest', tool_name: 'Bash', permission_suggestions: [suggestion] });
  server.close();
  const out = JSON.parse(r.out);
  assert.equal(out.hookSpecificOutput.hookEventName, 'PermissionRequest');
  assert.equal(out.hookSpecificOutput.decision.behavior, 'allow');
  assert.deepEqual(out.hookSpecificOutput.decision.updatedPermissions, [suggestion]);
});

test('permission: "deny" carries the user’s instruction and the interrupt flag', async () => {
  const box = sandbox();
  const answers = [
    { decision: 'deny', message: 'Utilise plutôt npm ci', interrupt: true },
    { decision: 'deny', message: 'Pas sur main' },
    { decision: 'deny' },
  ];
  const server = net.createServer((s) => s.on('data', () => s.end(JSON.stringify(answers.shift()) + '\n'))).listen(box.pipe);
  const run = () => runHook(box, ['PermissionRequest'], { hook_event_name: 'PermissionRequest', tool_name: 'Bash' }).then((r) => JSON.parse(r.out).hookSpecificOutput.decision);
  assert.deepEqual(await run(), { behavior: 'deny', message: 'Utilise plutôt npm ci', interrupt: true });
  assert.deepEqual(await run(), { behavior: 'deny', message: 'Pas sur main' });
  assert.deepEqual(await run(), { behavior: 'deny', message: 'Refusé depuis Ambrosia' });
  server.close();
});

test('permission: "pass" prints nothing so the terminal asks', async () => {
  const box = sandbox();
  const server = net.createServer((s) => s.on('data', () => s.end(JSON.stringify({ decision: 'pass' }) + '\n'))).listen(box.pipe);
  const r = await runHook(box, ['PermissionRequest'], { hook_event_name: 'PermissionRequest', tool_name: 'Bash' });
  server.close();
  assert.equal(r.out, '');
});

test('AskUserQuestion: answers become updatedInput', async () => {
  const box = sandbox();
  const server = net.createServer((s) =>
    s.on('data', () => s.end(JSON.stringify({ decision: 'answer', answers: { 'Quel nom ?': 'Gany' } }) + '\n')),
  ).listen(box.pipe);
  const questions = [{ question: 'Quel nom ?', header: 'Nom', options: [{ label: 'Gany' }, { label: 'Hébé' }], multiSelect: false }];
  const r = await runHook(box, ['--ask'], { hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions } });
  server.close();
  const out = JSON.parse(r.out).hookSpecificOutput;
  assert.equal(out.permissionDecision, 'allow');
  assert.deepEqual(out.updatedInput.answers, { 'Quel nom ?': 'Gany' });
  assert.deepEqual(out.updatedInput.questions, questions);
});

test('--ask ignores other tools', async () => {
  const box = sandbox();
  const r = await runHook(box, ['--ask'], { hook_event_name: 'PreToolUse', tool_name: 'Bash' });
  assert.equal(r.out, '');
});
