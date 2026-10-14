const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const D = require('../src/modules/claude/discover');

const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'claude-sessions.json'), 'utf8'));
const rec = (name) => D.parseRecord(JSON.stringify(FIX[name]));
const WORK = 'C:\\Users\\camille\\AppData\\Local\\Ambrosia\\work';

test('parseRecord: interactive sessions only, torn files and missing fields refused', () => {
  const r = rec('4468.json');
  assert.equal(r.pid, 4468);
  assert.equal(r.sessionId, 'd8d9ba0d-4dbe-4af1-ba3d-eda84fd7b113');
  assert.equal(r.entrypoint, 'cli');
  assert.equal(r.status, 'busy');
  assert.equal(r.procStart, '134363509584607613');
  assert.equal(rec('10252.json').hostSessionId, 'local_46d84f0b-1fb4-45c3-b919-8a08a80d4fe2');
  assert.equal(rec('10252.json').waitingFor, 'permission prompt');
  assert.equal(rec('888.json'), null, 'a background worker is not a session of the user');
  assert.equal(D.parseRecord(FIX['999.json']), null);
  assert.equal(D.parseRecord('{"pid":1,"cwd":"C:\\\\x"}'), null);
  assert.equal(D.parseRecord('{"pid":2,"sessionId":"a","cwd":"C:\\\\x","hostSessionId":"evil/../x"}').hostSessionId, '');
});

test('procStart is the creation FILETIME: it matches startedAt', () => {
  const r = rec('4468.json');
  assert.ok(Math.abs(D.filetimeMs(r.procStart) - r.startedAt) < 3000);
  assert.equal(D.filetimeMs('nope'), 0);
});

test('sameProcess: a reused pid is not the session', () => {
  const r = rec('9764.json');
  assert.equal(D.sameProcess(r, { name: 'WUDFHost.exe', start: '134363011301111438' }), false);
  assert.equal(D.sameProcess(r, { name: 'claude.exe', start: '134362011301111433' }), true, 'CIM rounds to the microsecond');
  assert.equal(D.sameProcess(r, null), false);
  assert.equal(D.sameProcess({ ...r, procStart: '' }, { name: 'claude.exe', start: '' }), true);
  assert.equal(D.sameProcess({ ...r, procStart: '' }, { name: 'notepad.exe', start: '' }), false);
});

test('sourceLabel and isInternal', () => {
  assert.equal(D.sourceLabel('claude-desktop'), 'Claude Desktop');
  assert.equal(D.sourceLabel('claude-vscode'), 'VS Code');
  assert.equal(D.sourceLabel('cli'), 'Terminal');
  assert.equal(D.sourceLabel(''), 'Terminal');
  assert.ok(D.isInternal(WORK + '\\', WORK));
  assert.ok(D.isInternal(WORK.toUpperCase() + '\\sub', WORK));
  assert.ok(!D.isInternal(WORK + '-other', WORK));
  assert.ok(!D.isInternal('C:\\Users\\camille\\Documents\\HelpDesk', WORK));
});

test('tailInfo: last prompt and answer, tool results, meta lines and a cut first line skipped', () => {
  const lines = [
    '"cut":"line"}',
    JSON.stringify({ type: 'user', timestamp: '2026-10-13T08:00:00Z', message: { content: 'Vérifie le stock StockSync' } }),
    JSON.stringify({ type: 'assistant', timestamp: '2026-10-13T08:00:05Z', message: { content: [{ type: 'text', text: 'Je regarde.' }] } }),
    JSON.stringify({ type: 'user', timestamp: '2026-10-13T08:00:06Z', message: { content: [{ type: 'tool_result', content: 'ok' }] } }),
    JSON.stringify({ type: 'user', isMeta: true, timestamp: '2026-10-13T08:00:07Z', message: { content: 'caveat' } }),
    JSON.stringify({ type: 'user', timestamp: '2026-10-13T08:00:08Z', message: { content: '<command-name>/clear</command-name>' } }),
    JSON.stringify({ type: 'assistant', timestamp: '2026-10-13T08:01:00Z', message: { content: [{ type: 'text', text: 'Tout est à jour.' }] } }),
    '',
  ];
  const t = D.tailInfo(lines.join('\n'));
  assert.equal(t.prompt, 'Vérifie le stock StockSync');
  assert.equal(t.lastMessage, 'Tout est à jour.');
  assert.equal(t.at, Date.parse('2026-10-13T08:01:00Z'));
  assert.deepEqual(D.tailInfo(''), { prompt: '', lastMessage: '', at: 0 });
  // The "last-prompt" line Claude Code writes after each turn, when the prompt itself is far behind.
  const tail = [
    JSON.stringify({ type: 'assistant', timestamp: '2026-10-13T09:00:00Z', message: { content: [{ type: 'text', text: 'Bundles prêts.' }] } }),
    JSON.stringify({ type: 'last-prompt', lastPrompt: 'fais-moi 2 bundles git', sessionId: 'x' }),
    JSON.stringify({ type: 'custom-title', customTitle: 'Deux bundles', sessionId: 'x' }),
  ].join('\n');
  assert.deepEqual(D.tailInfo(tail), { prompt: 'fais-moi 2 bundles git', lastMessage: 'Bundles prêts.', at: Date.parse('2026-10-13T09:00:00Z') });
});

test('projectSlug: the folder name Claude Code uses', () => {
  assert.equal(D.projectSlug('C:\\Users\\camille\\Documents\\ambrosia\\.claude\\worktrees\\x-1'), 'C--Users-camille-Documents-ambrosia--claude-worktrees-x-1');
});

test('newSession: a card shaped like the hook-made ones', () => {
  const s = D.newSession(rec('10252.json'), { prompt: 'Fais les bundles', lastMessage: '', at: 0 }, 1791876400000);
  assert.equal(s.id, 'ec0dc9ab-e9fc-4ad1-81cc-41b8dc0500a1');
  assert.equal(s.project, 'HelpDesk');
  assert.equal(s.state, 'waiting');
  assert.equal(s.term, 'Claude Desktop');
  assert.equal(s.prompt, 'Fais les bundles');
  assert.equal(s.discovered, true);
  assert.match(s.steps[0].label, /sans hook.*autorisation/);
  assert.equal(D.newSession(rec('4468.json'), null).state, 'working');
});

test('reconcile: the hooks win, a missed Stop is fixed after a minute', () => {
  const now = 1_000_000_000;
  const file = (status, at, waitingFor = '') => ({ status, statusUpdatedAt: at, waitingFor });
  const s = (state, hookAt) => ({ state, hookAt, updatedAt: hookAt });
  // Missed Stop: working for us, idle in the file since after the last hook.
  assert.deepEqual(D.reconcile(s('working', now - 120000), file('idle', now - 100000), now).state, 'idle');
  // Too early: the Stop hook may still be on its way.
  assert.equal(D.reconcile(s('working', now - 20000), file('idle', now - 10000), now), null);
  // The file is older than the last hook: the hook is right.
  assert.equal(D.reconcile(s('working', now - 120000), file('idle', now - 121000), now), null);
  // An open approval card: never touched.
  assert.equal(D.reconcile(s('working', now - 120000), file('idle', now - 100000), now, true), null);
  assert.equal(D.reconcile(s('approval', now - 120000), file('idle', now - 100000), now), null);
  // Busy again without hooks (hooks missing for this session).
  assert.equal(D.reconcile(s('finished', now - 60000), file('busy', now - 1000), now).state, 'working');
  // Waiting for a permission the hooks did not report.
  const w = D.reconcile(s('working', now - 60000), file('waiting', now - 1000, 'permission prompt'), now);
  assert.equal(w.state, 'waiting');
  assert.match(w.note, /autorisation/);
  assert.equal(D.reconcile(s('idle', now), file('idle', now + 10000), now), null);
});

// ── attach(): the runtime, on a scratch folder with a fake process table ──

function scratch() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'amb-discover-'));
  const dir = path.join(root, 'sessions');
  const projects = path.join(root, 'projects');
  fs.mkdirSync(dir);
  fs.mkdirSync(path.join(projects, 'C--Users-camille-Documents-HelpDesk'), { recursive: true });
  for (const [name, v] of Object.entries(FIX)) if (!name.startsWith('_')) fs.writeFileSync(path.join(dir, name), typeof v === 'string' ? v : JSON.stringify(v));
  const transcript = [
    JSON.stringify({ type: 'user', timestamp: '2026-10-13T08:00:00Z', message: { content: 'Vérifie le stock StockSync complet' } }),
    JSON.stringify({ type: 'assistant', timestamp: '2026-10-13T08:00:05Z', message: { content: [{ type: 'text', text: 'Je lance la vérification.' }] } }),
  ].join('\n');
  fs.writeFileSync(path.join(projects, 'C--Users-camille-Documents-HelpDesk', 'd8d9ba0d-4dbe-4af1-ba3d-eda84fd7b113.jsonl'), transcript);
  return { root, dir, projects };
}

function fakeProcs(alive) {
  return {
    exists: (pid) => alive.has(pid),
    table: async () =>
      new Map([
        [4468, { pid: 4468, name: 'claude.exe', start: '134363509584607613' }],
        [10252, { pid: 10252, name: 'claude.exe', start: '134363498445665573' }],
        [9764, { pid: 9764, name: 'WUDFHost.exe', start: '134363611111111111' }],
        [777, { pid: 777, name: 'claude.exe', start: '134363509584607613' }],
      ].filter(([pid]) => alive.has(pid))),
  };
}

test('attach: seeds live sessions, skips dead / internal ones, never reads *.key', async () => {
  const { root, dir, projects } = scratch();
  const realRead = fs.readFileSync;
  const opened = [];
  fs.readFileSync = function (p, ...rest) {
    opened.push(String(p));
    return realRead.call(this, p, ...rest);
  };
  const sessions = new Map();
  const ended = [];
  let published = 0;
  const alive = new Set([4468, 10252, 9764, 777, 888]);
  const tracked = new Map();
  const d = D.attach({
    dir,
    projectsDir: projects,
    internalDir: WORK,
    procs: fakeProcs(alive),
    sessions,
    pending: () => false,
    track: (s, pid) => tracked.set(s.id, pid),
    end: (s) => {
      s.state = 'ended';
      ended.push(s.id);
    },
    step: (s, label) => s.steps.push({ label }),
    publish: () => published++,
    settings: () => ({ forgetAfterMin: 180 }),
    log: () => {},
  });
  try {
    await d.scan();
    fs.readFileSync = realRead;
    assert.ok(!opened.some((p) => p.endsWith('.key')), 'key files are never opened');
    assert.deepEqual([...sessions.keys()].sort(), ['d8d9ba0d-4dbe-4af1-ba3d-eda84fd7b113', 'ec0dc9ab-e9fc-4ad1-81cc-41b8dc0500a1']);
    const cli = sessions.get('d8d9ba0d-4dbe-4af1-ba3d-eda84fd7b113');
    assert.equal(cli.state, 'working');
    assert.equal(cli.term, 'Terminal');
    assert.equal(cli.prompt, 'Vérifie le stock StockSync complet');
    assert.equal(cli.lastMessage, 'Je lance la vérification.');
    assert.equal(tracked.get(cli.id), 4468);
    assert.equal(sessions.get('ec0dc9ab-e9fc-4ad1-81cc-41b8dc0500a1').state, 'waiting');
    assert.equal(published, 1);

    // The file goes idle; the desktop session's process dies.
    fs.writeFileSync(path.join(dir, '4468.json'), JSON.stringify({ ...FIX['4468.json'], status: 'idle', statusUpdatedAt: FIX['4468.json'].statusUpdatedAt + 60000 }));
    alive.delete(10252);
    await d.scan();
    assert.equal(cli.state, 'idle');
    assert.deepEqual(ended, ['ec0dc9ab-e9fc-4ad1-81cc-41b8dc0500a1']);

    // « Oublier »: not back until it shows new activity.
    sessions.delete(cli.id);
    d.forget(cli.id);
    await d.scan();
    assert.ok(!sessions.has(cli.id));

    // A hook-known session whose process is gone ends too.
    sessions.set('hooked', { id: 'hooked', state: 'idle', pid: 4242, steps: [], updatedAt: Date.now(), hookAt: Date.now() });
    await d.scan();
    assert.equal(sessions.get('hooked').state, 'ended');
  } finally {
    fs.readFileSync = realRead;
    d.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
