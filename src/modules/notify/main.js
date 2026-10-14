// Scripts — the user's own scripts (PowerShell, scheduled tasks, robocopy, builds)
// push « live activities » into the island with the `ambrosia-notify` command
// (hook/ambrosia-notify.js → named pipe, `kind: 'notify'` → hook-server emits 'notify').
//
// A live activity shows as a dot (a ring when it has a progress) and a badge in the
// notch, plus a short ticker line when it starts and at each quarter; no sound. Its end
// (--done / --error) or a one-shot note raises an alert, which goes through the « en
// appel » queue like any other. « Ouvrir » (--open) only ever runs on a click, after the
// target is checked again here. Pure logic: ./logic.js; the command's files: ./install.js.

const fs = require('fs');
const { execFile } = require('child_process');
const L = require('./logic');
const install = require('./install');

const TEST_KEY = 'ambrosia-test';

module.exports = {
  id: 'notify',
  name: 'Scripts',
  icon: '⌁',
  color: '#8EC5E8',
  order: 40,
  secondary: true,
  recap: { one: 'message de script', many: 'messages de scripts' },
  settings: [
    {
      key: 'copyExample',
      label: 'Copier un exemple de commande',
      type: 'button',
      action: 'copyExample',
      help:
        `Tes scripts affichent leur avancement dans l’encoche avec la commande ${install.WRAPPER}. ` +
        'Options : --key (identifiant de l’activité), --title, --text, --progress (0 à 1 ou 30%), --done, --error, ' +
        '--open (https:// ou un chemin : bouton « Ouvrir »), --ttl (s), --pin, --quiet, --priority low|normal|high. ' +
        'Sans --key : un simple message. La commande ne bloque jamais ton script, même si Ambrosia est fermée. ' +
        'Une tâche planifiée doit tourner sous ton compte, session ouverte.',
    },
    { key: 'test', label: 'Tester', type: 'button', action: 'test', help: 'Lance la vraie commande : une activité de test avance dans l’encoche, puis se termine.' },
    {
      key: 'addToPath',
      label: 'Ajouter au PATH utilisateur',
      type: 'button',
      action: 'addToPath',
      help: `Ajoute ${install.BIN} à ta variable PATH (ton compte Windows seulement) : « ambrosia-notify » marche alors dans tout nouveau terminal. Rien n’y est écrit sans ce clic.`,
    },
  ],

  init(ctx) {
    const board = new L.Board(ctx.data.load({ recent: [] }));
    const pending = new Map(); // key → the latest throttled update
    const timers = new Map();
    let ticker = null;
    let seq = 0;
    let testWaiter = null;
    let addedToPath = false;
    let publishTimer = null;

    try {
      const r = install.ensureWrapper();
      if (r.changed) ctx.log('command written:', r.file);
    } catch (err) {
      ctx.log('command not written:', err.message);
    }

    const save = () => ctx.data.save({ recent: board.recent });

    function publish(soon = false) {
      clearTimeout(publishTimer);
      if (soon) return void (publishTimer = setTimeout(() => publish(), 300));
      ctx.setState({ live: board.liveList(), recent: board.recent, ticker });
    }

    function apply(msg) {
      const now = Date.now();
      const r = board.apply(msg, now);
      if (r.kind === 'full') return ctx.log(`${L.LIMITS.keys} activities already live: dropped`, msg.key);
      if (r.kind === 'start' || r.kind === 'milestone') ticker = L.tickerFor(r.item, ++seq, now);
      if (r.kind === 'done' || r.kind === 'error' || r.kind === 'info') {
        if (ticker?.key === `notify:${r.item.key}`) ticker = null;
        save();
        // Paused by the user: the tab still records it, Gany stays quiet. Locked: the host queues it for the recap.
        if (!ctx.pausedByUser() && board.alertAllowed(now)) ctx.alert(L.alertFor(r.kind, r.item));
      }
      publish(r.kind === 'update');
    }

    const onNotify = (ev) => {
      const r = L.normalize(ev?.payload);
      if (r.error) return ctx.log('ignored:', r.error);
      const msg = r.msg;
      if (msg.key === TEST_KEY && testWaiter) testWaiter(true);
      if (msg.status === 'live') {
        // One update a second per key; the latest wins, fields it omits keep the older ones.
        const wait = board.wait(msg, Date.now());
        if (wait > 0) {
          pending.set(msg.key, { ...pending.get(msg.key), ...L.defined(msg) });
          if (!timers.has(msg.key)) {
            timers.set(msg.key, setTimeout(() => {
              timers.delete(msg.key);
              const m = pending.get(msg.key);
              pending.delete(msg.key);
              if (m) apply(m);
            }, wait));
          }
          return;
        }
      } else if (msg.key) {
        // The end wins over a progress still waiting its turn.
        pending.delete(msg.key);
        clearTimeout(timers.get(msg.key));
        timers.delete(msg.key);
      }
      apply(msg);
    };
    ctx.hooks.on('notify', onNotify);

    // Activities that stopped talking (script killed, machine asleep) fade out silently.
    const sweep = setInterval(() => {
      if (board.expire(Date.now()).length) {
        save();
        publish();
      }
    }, 60000);

    // ── Actions ───────────────────────────────────────────────────────────
    ctx.onAction('open', async ({ id } = {}) => {
      const plan = L.openPlan(board.find(id)?.open);
      if (!plan) return 'Rien à ouvrir.';
      if (plan.how === 'url') return void ctx.openExternal(plan.target);
      if (!fs.existsSync(plan.target)) return `Introuvable : ${plan.target}`;
      const err = await ctx.openPath(plan.target);
      return err || true;
    });
    ctx.onAction('show', () => ctx.focus());
    ctx.onAction('forget', ({ key } = {}) => {
      if (board.forget(String(key || ''))) publish();
    });
    ctx.onAction('dismiss', ({ id } = {}) => {
      if (board.dismiss(id)) {
        save();
        publish();
      }
    });
    ctx.onAction('clear', () => {
      board.recent = [];
      save();
      publish();
    });

    ctx.onAction('copyExample', () => {
      const bare = addedToPath || install.inPath(process.env.PATH);
      require('electron').clipboard.writeText(bare ? install.EXAMPLE : install.EXAMPLE.replace(/^ambrosia-notify/, `& "${install.WRAPPER}"`));
      return bare ? `Copié : ${install.EXAMPLE}` : 'Copié, avec le chemin complet (forme PowerShell). Après « Ajouter au PATH utilisateur », « ambrosia-notify » seul suffit.';
    });

    ctx.onAction('test', async () => {
      try {
        install.ensureWrapper();
      } catch (err) {
        return `La commande n’a pas pu être écrite : ${err.message}`;
      }
      // The real thing: cmd.exe → the wrapper → node → the pipe. Fixed arguments only.
      const run = (args) =>
        new Promise((resolve) => {
          const line = `"${install.WRAPPER}" --key ${TEST_KEY} ${args}`;
          execFile('cmd.exe', ['/d', '/s', '/c', `"${line}"`], { windowsVerbatimArguments: true, windowsHide: true, timeout: 8000 }, (err) =>
            resolve(err ? err.message : null),
          );
        });
      const arrived = new Promise((resolve) => {
        testWaiter = resolve;
        setTimeout(() => resolve(false), 5000);
      });
      const err = await run('--title "Test d’Ambrosia" --text "Ça avance…" --progress 0.35');
      const ok = await arrived;
      testWaiter = null;
      if (!ok) return `La commande n’a pas joint Ambrosia${err ? ` : ${err}` : '.'} Regarde le journal (Divers → Journal).`;
      setTimeout(() => run('--text "Presque…" --progress 0.8'), 1500);
      setTimeout(() => run('--done --text "Tout fonctionne : tes scripts peuvent parler à Gany."'), 3200);
      return 'Ça marche : regarde l’encoche, l’activité de test se termine dans 3 s.';
    });

    ctx.onAction('addToPath', () => {
      if (install.inPath(process.env.PATH) && !addedToPath) return `Déjà dans le PATH : ${install.BIN}`;
      return new Promise((resolve) => {
        execFile(
          'powershell.exe',
          // base64 of UTF-16LE: no quote of the script is ever re-parsed by a command line.
          ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(install.ADD_TO_PATH_PS, 'utf16le').toString('base64')],
          { env: { ...process.env, AMBROSIA_BIN: install.BIN }, windowsHide: true, timeout: 20000 },
          (err, stdout) => {
            if (err) return resolve(`Échec : ${err.message.split('\n')[0]}`);
            addedToPath = true;
            resolve(/deja/.test(stdout) ? `Déjà dans ton PATH utilisateur : ${install.BIN}` : `Ajouté à ton PATH utilisateur : ${install.BIN}. Ouvre un nouveau terminal pour l’utiliser.`);
          },
        );
      });
    });

    this._stop = () => {
      ctx.hooks.off('notify', onNotify);
      clearInterval(sweep);
      clearTimeout(publishTimer);
      for (const t of timers.values()) clearTimeout(t);
    };
    publish();
  },

  dispose() {
    this._stop?.();
  },
};
