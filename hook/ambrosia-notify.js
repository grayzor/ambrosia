#!/usr/bin/env node
// ambrosia-notify — lets the user's own scripts (PowerShell, scheduled tasks,
// backups, builds) push a « live activity » into the island.
//
//   ambrosia-notify --key sauvegarde --title "Sauvegarde NAS" --text "12/40 Go" --progress 0.3
//   ambrosia-notify --key sauvegarde --done --text "Terminé en 14 min"
//   ambrosia-notify --key sauvegarde --error --text "Échec : disque plein"
//   ambrosia-notify --title "Script fini"
//
// Same pipe and token as the hook relay (ambrosia-hook.js), with `kind: 'notify'`:
// the module host routes it to src/modules/notify, never to the Claude Code side.
// Same hard rule too: never hang the caller. Ambrosia closed → exit 0 at once.
// Exit code: 0 always, 2 for invalid arguments.

'use strict';
const net = require('net');
const fs = require('fs');
const path = require('path');

const CONNECT_TIMEOUT = 300;
const BUDGET = 1500;
// Generous here, the island cuts further (src/modules/notify/logic.js).
const CAPS = { key: 60, title: 200, text: 600, open: 1000 };
const PRIORITIES = ['low', 'normal', 'high'];
const VALUES = ['key', 'title', 'text', 'progress', 'ttl', 'open', 'priority'];
const FLAGS = ['done', 'error', 'pin', 'quiet', 'help'];

const USAGE = `ambrosia-notify — affiche l’avancement d’un script dans l’encoche d’Ambrosia.

  ambrosia-notify --key <id> --title "<titre>" [--text "<détail>"] [--progress <p>]
  ambrosia-notify --key <id> --done  [--text "<détail>"]
  ambrosia-notify --key <id> --error [--text "<détail>"]
  ambrosia-notify --title "<titre>" [--text "<détail>"]        (message unique)

Options :
  --key <id>        identifiant de l’activité (les mises à jour suivantes la reprennent)
  --title, --text   titre et détail (affichés tels quels, raccourcis si trop longs)
  --progress <p>    avancement : 0 à 1, ou un pourcentage (30 ou 30%)
  --done, --error   fin de l’activité : réussite ou échec
  --ttl <s>         durée d’affichage de l’alerte, en secondes
  --pin             l’alerte reste jusqu’à ce que tu la fermes
  --open <cible>    bouton « Ouvrir » : une adresse https:// ou un chemin (fichier, dossier)
  --quiet           sans son
  --priority <p>    low, normal (défaut) ou high

Ne bloque jamais : si Ambrosia n’est pas lancée, la commande rend la main aussitôt.
Code de sortie : 0, ou 2 si les arguments sont invalides.`;

const clip = (s, n) => (s.length > n ? s.slice(0, n) : s);

/** "0.3", "30", "30%", "30 %", "0,3" → 0.3. Above 1 means a percentage. null if invalid. */
function parseProgress(v) {
  const m = String(v ?? '').trim().replace(',', '.').match(/^(\d+(?:\.\d+)?)\s*(%?)$/);
  if (!m) return null;
  let n = Number(m[1]);
  if (m[2] || n > 1) n /= 100;
  return n >= 0 && n <= 1 ? n : null;
}

/**
 * argv (without node and the script) → { help } | { error } | { payload }.
 * `--name value`, `--name=value` and `-name value` are all accepted (PowerShell habits);
 * words without a dash make the title (or the text when --title is given).
 */
function parseArgs(argv, cwd = process.cwd()) {
  const o = {};
  const words = [];
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i]);
    if (a === '/?' || a === '-h') return { help: true };
    const m = a.match(/^--?([a-z]+)(?:=([\s\S]*))?$/i);
    if (!m) {
      words.push(a);
      continue;
    }
    const name = m[1].toLowerCase();
    if (FLAGS.includes(name)) {
      if (m[2] !== undefined) return { error: `--${name} ne prend pas de valeur` };
      o[name] = true;
    } else if (VALUES.includes(name)) {
      let v = m[2];
      if (v === undefined) {
        if (i + 1 >= argv.length) return { error: `--${name} attend une valeur` };
        v = String(argv[++i]);
      }
      o[name] = v;
    } else {
      return { error: `option inconnue : ${a}` };
    }
  }
  if (o.help) return { help: true };

  const payload = {};
  if (words.length) {
    if (o.title === undefined) o.title = words.join(' ');
    else if (o.text === undefined) o.text = words.join(' ');
    else return { error: `argument en trop : ${words.join(' ')}` };
  }
  if (o.key !== undefined) {
    const key = o.key.trim();
    if (!key) return { error: '--key est vide' };
    payload.key = clip(key, CAPS.key);
  }
  if (o.title !== undefined) payload.title = clip(o.title, CAPS.title);
  if (o.text !== undefined) payload.text = clip(o.text, CAPS.text);
  if (o.done && o.error) return { error: '--done et --error ensemble ?' };
  if (o.done) payload.state = 'done';
  if (o.error) payload.state = 'error';
  if (o.progress !== undefined) {
    const p = parseProgress(o.progress);
    if (p === null) return { error: `--progress invalide : ${o.progress} (0 à 1, ou 30%)` };
    payload.progress = p;
  }
  if (o.ttl !== undefined) {
    const t = Number(String(o.ttl).replace(',', '.'));
    if (!(t > 0)) return { error: `--ttl invalide : ${o.ttl} (des secondes)` };
    payload.ttl = t;
  }
  if (o.priority !== undefined) {
    const p = o.priority.toLowerCase();
    if (!PRIORITIES.includes(p)) return { error: `--priority invalide : ${o.priority} (low, normal ou high)` };
    payload.priority = p;
  }
  if (o.open !== undefined) {
    const v = o.open.trim();
    if (/^https:\/\//i.test(v)) {
      try {
        payload.open = new URL(v).href;
      } catch {
        return { error: `--open : adresse invalide : ${v}` };
      }
    } else if (/^[a-z][a-z0-9+.-]+:/i.test(v)) {
      // Any other scheme (http:, file:, ms-settings:…). A drive letter is one character.
      return { error: `--open : seulement une adresse https:// ou un chemin (${v})` };
    } else if (!v) {
      return { error: '--open est vide' };
    } else {
      payload.open = path.win32.resolve(cwd, v); // relative to where the script runs
    }
    if (payload.open.length > CAPS.open) return { error: '--open : cible trop longue' };
  }
  if (o.pin) payload.pin = true;
  if (o.quiet) payload.quiet = true;
  if (!payload.title && !payload.text && !(payload.key && (payload.state || payload.progress !== undefined))) {
    return { error: 'rien à afficher : donne au moins --title ou --text' };
  }
  return { payload };
}

/** Hands the message to Ambrosia. Resolves false when nobody listens (never rejects). */
function send(payload, env = process.env) {
  const pipe = `\\\\.\\pipe\\ambrosia-${(env.USERNAME || 'user').toLowerCase()}`;
  const local = path.join(env.LOCALAPPDATA || path.join(require('os').homedir(), 'AppData', 'Local'), 'Ambrosia');
  let token = '';
  try {
    token = fs.readFileSync(path.join(local, 'hook-token'), 'utf8').trim();
  } catch {
    return Promise.resolve(false); // Ambrosia never ran here
  }
  return new Promise((resolve) => {
    const sock = net.connect(pipe);
    const done = (ok) => {
      clearTimeout(timer);
      sock.destroy();
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), CONNECT_TIMEOUT);
    sock.on('error', () => done(false));
    sock.on('connect', () => {
      clearTimeout(timer);
      sock.write(JSON.stringify({ v: 1, token, kind: 'notify', payload }) + '\n', () => {
        sock.end();
        resolve(true);
      });
    });
  });
}

async function main() {
  setTimeout(() => process.exit(0), BUDGET).unref();
  const r = parseArgs(process.argv.slice(2));
  if (r.help) {
    process.stdout.write(USAGE + '\n');
    return process.exit(0);
  }
  if (r.error) {
    process.stderr.write(`ambrosia-notify : ${r.error}\n(ambrosia-notify --help pour l’aide)\n`);
    return process.exit(2);
  }
  const ok = await send(r.payload);
  // A word for whoever types it by hand; scripts get silence and exit code 0.
  if (!ok && process.stderr.isTTY) process.stderr.write('ambrosia-notify : Ambrosia ne tourne pas, rien n’a été affiché.\n');
  process.exit(0);
}

module.exports = { parseArgs, parseProgress, send, USAGE };

if (require.main === module) main().catch(() => process.exit(0));
