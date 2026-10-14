// Tiny append-only log, rotated at 2 MB. It never leaves the machine.

const fs = require('fs');
const paths = require('./paths');

const MAX = 2 * 1024 * 1024;

function line(scope, ...parts) {
  const text = parts
    .map((p) => (p instanceof Error ? p.stack || p.message : typeof p === 'string' ? p : JSON.stringify(p)))
    .join(' ');
  const row = `${new Date().toISOString()} [${scope}] ${text}\n`;
  try {
    const size = fs.existsSync(paths.logFile) ? fs.statSync(paths.logFile).size : 0;
    if (size > MAX) fs.renameSync(paths.logFile, paths.logFile + '.1');
    fs.appendFileSync(paths.logFile, row);
  } catch {
    /* logging must never crash the app */
  }
  if (process.argv.includes('--dev')) process.stdout.write(row);
}

/** `const log = require('./log').scope('mail'); log('hello')` */
function scope(name) {
  return (...parts) => line(name, ...parts);
}

module.exports = { line, scope };
