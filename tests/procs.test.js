const test = require('node:test');
const assert = require('node:assert');
const { ancestors } = require('../src/main/procs');

const table = (rows) => new Map(rows.map(([pid, ppid, name]) => [pid, { pid, ppid, name }]));

test('ancestors: from Claude Code up to the terminal window', () => {
  const map = table([
    [40, 30, 'claude.exe'],
    [30, 20, 'pwsh.exe'],
    [20, 4, 'WindowsTerminal.exe'],
    [4, 0, 'System'],
  ]);
  assert.deepEqual(ancestors(40, map).map((p) => p.name), ['claude.exe', 'pwsh.exe', 'WindowsTerminal.exe', 'System']);
});

test('ancestors: a dead parent ends the chain, a cycle never loops', () => {
  assert.deepEqual(ancestors(40, table([[40, 999, 'claude.exe']])).map((p) => p.pid), [40]);
  assert.deepEqual(ancestors(1, table([[1, 2, 'a'], [2, 1, 'b']])).map((p) => p.pid), [1, 2]);
  assert.deepEqual(ancestors(7, table([])), []);
});
