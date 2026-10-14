#!/usr/bin/env node
// ambrosia-hook — the relay Claude Code runs on every hook event.
//
// Reads the hook JSON on stdin and hands it to Ambrosia over the named pipe
// \\.\pipe\ambrosia-<user>. Port of coucou-hook, same hard rule:
//
//   NEVER BLOCK CLAUDE CODE.
//   * No pipe (Ambrosia closed) → exit 0 at once, nothing on stdout.
//   * Every step runs under a deadline; past it we exit, silent.
//   * Only PermissionRequest and AskUserQuestion (--ask) wait for an answer.
//     No answer → empty stdout → Claude Code asks in the terminal as usual.
//
// Usage: node ambrosia-hook.js <EventName> | --ask

'use strict';
const net = require('net');
const fs = require('fs');
const path = require('path');

const CONNECT_TIMEOUT = 300;
const FIRE_AND_FORGET_BUDGET = 2000;
const DECISION_BUDGET = 110000; // settings.json gives PermissionRequest 120 s
const ASK_BUDGET = 125000; // and the --ask hook 130 s
const MAX_FIELD_LEN = 4000;
const DROPPED_FIELDS = ['tool_response'];

const PIPE = `\\\\.\\pipe\\ambrosia-${(process.env.USERNAME || 'user').toLowerCase()}`;
const LOCAL = path.join(process.env.LOCALAPPDATA || path.join(require('os').homedir(), 'AppData', 'Local'), 'Ambrosia');
const TOKEN_FILE = path.join(LOCAL, 'hook-token');
const NUDGES_DIR = path.join(LOCAL, 'nudges');

// What fire-and-forget events print when they exit: the user's queued notes, if any.
let defaultOut = null;

function quit(stdout = defaultOut) {
  if (stdout) process.stdout.write(JSON.stringify(stdout) + '\n', () => process.exit(0));
  else process.exit(0);
}

// Ambrosia's own `claude -p` calls must not show up as sessions.
if (process.env.AMBROSIA_INTERNAL) quit();

const argv = process.argv.slice(2);
const askMode = argv.includes('--ask');
const argEvent = argv.find((a) => !a.startsWith('--')) || '';

function truncate(v) {
  if (typeof v === 'string') return v.length > MAX_FIELD_LEN ? v.slice(0, MAX_FIELD_LEN) + '…' : v;
  if (Array.isArray(v)) return v.map(truncate);
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) v[k] = truncate(v[k]);
  }
  return v;
}

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    const t = setTimeout(() => resolve(Buffer.concat(chunks)), 1500);
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => {
      clearTimeout(t);
      resolve(Buffer.concat(chunks));
    });
    process.stdin.on('error', () => resolve(Buffer.alloc(0)));
  });
}

/** The documented PermissionRequest / PreToolUse outputs. Unknown → nothing. */
function output(event, payload, answer) {
  const d = answer && answer.decision;
  if (event === 'PermissionRequest') {
    if (d === 'allow') return { hookSpecificOutput: { hookEventName: event, decision: { behavior: 'allow' } } };
    if (d === 'always') {
      const decision = { behavior: 'allow' };
      if (Array.isArray(payload.permission_suggestions) && payload.permission_suggestions.length) {
        decision.updatedPermissions = payload.permission_suggestions;
      }
      return { hookSpecificOutput: { hookEventName: event, decision } };
    }
    if (d === 'deny') {
      // `message` tells Claude why (or what to do instead); `interrupt` stops the turn.
      const decision = { behavior: 'deny', message: String(answer.message || '').slice(0, 4000) || 'Refusé depuis Ambrosia' };
      if (answer.interrupt === true) decision.interrupt = true;
      return { hookSpecificOutput: { hookEventName: event, decision } };
    }
    return null;
  }
  if (event === 'PreToolUse' && d === 'answer' && answer.answers) {
    const questions = (payload.tool_input && payload.tool_input.questions) || [];
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        updatedInput: { questions, answers: answer.answers },
      },
    };
  }
  return null;
}

async function main() {
  let raw = await readStdin();
  if (!raw.length) quit();
  if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) raw = raw.subarray(3);
  let payload;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch {
    quit();
  }
  if (!payload || typeof payload !== 'object') quit();

  const event = payload.hook_event_name || argEvent;
  payload.hook_event_name = event;
  if (askMode && payload.tool_name !== 'AskUserQuestion') quit();
  if (askMode) payload.ambrosia_kind = 'ask';

  // A few facts computed here, before long fields are cut: edit sizes, test results.
  let edit = null; // the edit's texts, for the island's diff: kept past the 4000-character cut
  try {
    const lib = require('./relay-lib');
    // Notes the user slid in while Claude works ("Glisser une consigne"), for the main
    // agent only: a subagent's PostToolUse would hand them to the wrong context.
    if ((event === 'PostToolUse' && !payload.agent_id) || event === 'UserPromptSubmit') {
      const notes = lib.claimNudges(NUDGES_DIR, payload.session_id);
      if (notes.length) {
        defaultOut = { hookSpecificOutput: { hookEventName: event, additionalContext: lib.nudgeContext(notes) } };
        payload.ambrosia_delivered = notes.map((n) => n.id);
      }
    }
    const input = payload.tool_input || {};
    if (event === 'PreToolUse' && ['Edit', 'MultiEdit', 'Write', 'NotebookEdit'].includes(payload.tool_name)) {
      const info = lib.editInfo(payload.tool_name, input);
      payload.ambrosia_diff = info && info.stats;
      edit = info && info.edit;
    }
    if ((event === 'PostToolUse' || event === 'PostToolUseFailure') && lib.isTestCommand(input.command)) {
      const r = payload.tool_response;
      const text = event === 'PostToolUse' ? (r && typeof r === 'object' ? `${r.stdout || ''}\n${r.stderr || ''}` : String(r || '')) : String(payload.error || '');
      payload.ambrosia_test = { ok: event === 'PostToolUse' && !(r && r.interrupted), tail: lib.testTail(text) };
    }
  } catch {
    /* extras only: the event still goes through */
  }
  for (const f of DROPPED_FIELDS) delete payload[f];
  if (!payload.cwd) payload.cwd = process.cwd();
  payload.term_program = payload.term_program || process.env.TERM_PROGRAM || '';
  payload.wt_session = process.env.WT_SESSION || '';
  payload.vscode_pid = process.env.VSCODE_PID || '';
  payload.entrypoint = process.env.CLAUDE_CODE_ENTRYPOINT || '';
  // Where the session runs: Claude Code's own pid when it says so, our parent's otherwise.
  // Ambrosia walks up from there later (terminal in front? bring it forward?), never here.
  payload.ambrosia_pid = Number(process.env.CLAUDE_PID) || 0;
  payload.ambrosia_ppid = process.ppid || 0;
  truncate(payload);
  if (edit) payload.ambrosia_edit = edit; // already capped by relay-lib (EDIT_CAP, EDIT_TOTAL)

  let token = '';
  try {
    token = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  } catch {
    quit(); // Ambrosia never ran: nobody to talk to.
  }

  const waits = askMode || event === 'PermissionRequest';
  const budget = askMode ? ASK_BUDGET : waits ? DECISION_BUDGET : FIRE_AND_FORGET_BUDGET;
  setTimeout(() => quit(), budget).unref();

  const sock = net.connect(PIPE);
  const connectTimer = setTimeout(() => {
    sock.destroy();
    quit();
  }, CONNECT_TIMEOUT);
  sock.on('error', () => quit());
  sock.on('connect', () => {
    clearTimeout(connectTimer);
    sock.write(JSON.stringify({ v: 1, token, waits, payload }) + '\n', () => {
      if (!waits) {
        sock.end();
        quit();
      }
    });
  });

  if (!waits) return;
  let buf = '';
  sock.on('data', (d) => {
    buf += d;
    const nl = buf.indexOf('\n');
    if (nl < 0) return;
    let answer = null;
    try {
      answer = JSON.parse(buf.slice(0, nl));
    } catch {
      /* silence is the safe answer */
    }
    sock.destroy();
    quit(output(askMode ? 'PreToolUse' : event, payload, answer));
  });
  sock.on('close', () => quit());
}

main().catch(() => quit());
