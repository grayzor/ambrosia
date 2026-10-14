// The named-pipe server the hook relay talks to.
//
// Each connection carries one JSON line `{ v, token, waits, payload }`. The token
// lives in %LOCALAPPDATA%\Ambrosia\hook-token, readable by this account only: a
// process of another user can find the pipe, but cannot feed it events.
//
// For waiting events (PermissionRequest, AskUserQuestion) the connection stays
// open until someone calls `reply(answer)`. If the relay gives up first, the
// `onGone` callbacks fire so the island can drop a card nobody waits on anymore.
//
// `{ token, kind: 'notify', payload }` comes from hook/ambrosia-notify.js (the user's
// scripts): emitted as 'notify', never as 'hook', and closed at once.

const net = require('net');
const fs = require('fs');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const paths = require('./paths');
const log = require('./log').scope('hooks');

const MAX_LINE = 512 * 1024;

class HookServer extends EventEmitter {
  start() {
    this.token = crypto.randomBytes(24).toString('hex');
    fs.writeFileSync(paths.tokenFile, this.token, { mode: 0o600 });
    this.server = net.createServer((sock) => this.accept(sock));
    this.server.on('error', (err) => {
      log('pipe error:', err.message);
      if (err.code === 'EADDRINUSE') setTimeout(() => this.server.listen(paths.pipeName), 2000);
    });
    this.server.listen(paths.pipeName, () => log('listening on', paths.pipeName));
  }

  accept(sock) {
    let buf = '';
    let handled = false;
    sock.setEncoding('utf8');
    sock.on('error', () => {});
    sock.on('data', (chunk) => {
      if (handled) return;
      buf += chunk;
      if (buf.length > MAX_LINE) return sock.destroy();
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      handled = true;
      let msg;
      try {
        msg = JSON.parse(buf.slice(0, nl));
      } catch {
        return sock.destroy();
      }
      if (!msg || msg.token !== this.token || !msg.payload) {
        log('rejected a connection with a bad token');
        return sock.destroy();
      }
      // ambrosia-notify (the user's own scripts): not a Claude Code hook, never answered.
      if (msg.kind === 'notify') {
        sock.end();
        try {
          this.emit('notify', { payload: msg.payload });
        } catch (err) {
          log('notify handler crashed:', err);
        }
        return;
      }
      const gone = [];
      let answered = !msg.waits;
      const event = {
        payload: msg.payload,
        waits: !!msg.waits,
        /** Answers a waiting hook. `{ decision: 'allow'|'deny'|'always'|'answer'|'pass', ... }` */
        reply(answer) {
          if (answered) return;
          answered = true;
          if (!sock.destroyed) sock.end(JSON.stringify(answer || { decision: 'pass' }) + '\n');
        },
        get answered() {
          return answered;
        },
        onGone(fn) {
          gone.push(fn);
        },
      };
      sock.on('close', () => {
        if (!answered) {
          answered = true;
          gone.forEach((fn) => fn());
        }
      });
      if (!msg.waits) sock.end();
      try {
        this.emit('hook', event);
      } catch (err) {
        log('handler crashed:', err);
        event.reply({ decision: 'pass' });
      }
    });
  }

  stop() {
    this.server?.close();
  }
}

module.exports = new HookServer();
