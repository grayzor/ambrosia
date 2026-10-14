#!/usr/bin/env node
// ambrosia-statusline — the statusLine command Ambrosia installs.
//
// Claude Code runs it after each assistant message with the session JSON on
// stdin (model, cost, context window, and for claude.ai subscribers
// `rate_limits.five_hour` / `seven_day`). It does two things at once:
//
//   1. hands a small extract of that JSON to Ambrosia over the named pipe
//      (fire and forget, 300 ms to connect, never more than 1.5 s in all);
//   2. runs the user's previous statusLine command, if there was one, with the
//      same stdin, and prints exactly what it prints: the status line looks the
//      same as before. Its exit code is ours. Without one, it prints a short
//      line of its own (model, context, plan gauges) rather than an empty one.
//
// The previous command travels in the settings.json entry itself, base64url
// after --chain, so uninstalling restores it without any side file.
//
// Usage: node ambrosia-statusline.js [--chain <base64url>]

'use strict';
const net = require('net');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const CONNECT_TIMEOUT = 300;
const PIPE_BUDGET = 1500;
const CHAIN_BUDGET = 10000;

const PIPE = `\\\\.\\pipe\\ambrosia-${(process.env.USERNAME || 'user').toLowerCase()}`;
const LOCAL = path.join(process.env.LOCALAPPDATA || path.join(require('os').homedir(), 'AppData', 'Local'), 'Ambrosia');

function chainArg(argv) {
  const i = argv.indexOf('--chain');
  if (i < 0 || !argv[i + 1]) return '';
  try {
    return Buffer.from(argv[i + 1], 'base64url').toString('utf8');
  } catch {
    return '';
  }
}

/** Claude Code runs status lines through Git Bash when installed, PowerShell otherwise: so do we. */
function gitBash() {
  const env = process.env.CLAUDE_CODE_GIT_BASH_PATH;
  if (env && fs.existsSync(env)) return env;
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    if (fs.existsSync(path.join(dir, 'git.exe'))) {
      for (const rel of ['../bin/bash.exe', '../../bin/bash.exe']) {
        const p = path.resolve(dir, rel);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  for (const p of ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe']) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function runChain(cmd, input) {
  return new Promise((resolve) => {
    if (!cmd) return resolve(0);
    let child;
    try {
      if (process.platform !== 'win32') child = spawn('sh', ['-c', cmd], { stdio: ['pipe', 'inherit', 'inherit'] });
      else {
        const bash = gitBash();
        child = bash
          ? spawn(bash, ['-c', cmd], { stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true })
          : spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true });
      }
    } catch {
      return resolve(1);
    }
    const t = setTimeout(() => child.kill(), CHAIN_BUDGET);
    child.on('error', () => resolve(1));
    child.on('close', (code) => {
      clearTimeout(t);
      resolve(code ?? 1);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

/** Only what Ambrosia uses: never the whole JSON. */
function extract(d) {
  const out = {
    hook_event_name: 'StatusLine',
    session_id: d.session_id || '',
    cwd: d.workspace?.current_dir || d.cwd || process.cwd(),
    version: d.version || '',
    model: d.model?.display_name || d.model?.id || '',
  };
  if (d.rate_limits && typeof d.rate_limits === 'object') {
    out.rate_limits = {};
    for (const k of ['five_hour', 'seven_day']) {
      const w = d.rate_limits[k];
      if (w && Number.isFinite(Number(w.used_percentage))) out.rate_limits[k] = { used_percentage: Number(w.used_percentage), resets_at: Number(w.resets_at) || 0 };
    }
  }
  if (d.cost) out.cost = { total_lines_added: d.cost.total_lines_added, total_lines_removed: d.cost.total_lines_removed, total_duration_ms: d.cost.total_duration_ms };
  if (d.context_window) out.context = { used_percentage: d.context_window.used_percentage ?? null };
  // Reasoning effort (absent when the model has none) and the session's name or AI title.
  if (d.effort && typeof d.effort.level === 'string') out.effort = { level: d.effort.level.slice(0, 12) };
  if (typeof d.session_name === 'string' && d.session_name) out.session_name = d.session_name.slice(0, 120);
  return out;
}

/** The line shown when the user had no status line: "Opus · contexte 34 % · 5 h 84 % · semaine 41 %". */
function ownLine(raw) {
  let d;
  try {
    let text = raw.toString('utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    d = JSON.parse(text);
  } catch {
    return '';
  }
  const x = extract(d || {});
  const pct = (n) => `${Math.round(n)} %`;
  const parts = [];
  if (x.model) parts.push(x.model);
  if (Number.isFinite(x.context?.used_percentage)) parts.push(`contexte ${pct(x.context.used_percentage)}`);
  if (x.rate_limits?.five_hour) parts.push(`5 h ${pct(x.rate_limits.five_hour.used_percentage)}`);
  if (x.rate_limits?.seven_day) parts.push(`semaine ${pct(x.rate_limits.seven_day.used_percentage)}`);
  return parts.join(' · ');
}

function sendToAmbrosia(raw) {
  return new Promise((resolve) => {
    if (process.env.AMBROSIA_INTERNAL) return resolve();
    let token = '';
    let data;
    try {
      token = fs.readFileSync(path.join(LOCAL, 'hook-token'), 'utf8').trim();
      let text = raw.toString('utf8');
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      data = JSON.parse(text);
    } catch {
      return resolve();
    }
    if (!data || typeof data !== 'object') return resolve();
    const done = () => {
      clearTimeout(budget);
      resolve();
    };
    const budget = setTimeout(() => {
      sock.destroy();
      resolve();
    }, PIPE_BUDGET);
    const sock = net.connect(PIPE);
    const connectTimer = setTimeout(() => sock.destroy(), CONNECT_TIMEOUT);
    sock.on('error', done);
    sock.on('close', done);
    sock.on('connect', () => {
      clearTimeout(connectTimer);
      sock.end(JSON.stringify({ v: 1, token, waits: false, payload: extract(data) }) + '\n');
    });
  });
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

async function main() {
  const raw = await readStdin();
  const chain = chainArg(process.argv.slice(2));
  // Both at once: the user's line never waits for the pipe.
  const [code] = await Promise.all([runChain(chain, raw), sendToAmbrosia(raw)]);
  if (!chain) process.stdout.write(ownLine(raw) + '\n');
  process.exitCode = code;
}

if (require.main === module) main().catch(() => process.exit(0));

module.exports = { extract, chainArg, ownLine };
