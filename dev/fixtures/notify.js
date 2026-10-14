// Scripts in the dev preview: a backup that progresses (ring in the notch, ticker at each
// quarter), a few recent ends, and dev-bar buttons that play what `ambrosia-notify`
// would send. Same shapes as src/modules/notify/main.js (nothing is opened).
// ?alert=script / ?alert=scriptError: the alert of an end.

const MIN = 60000;
const COLOR = '#8EC5E8';
const now = Date.now();

let state = {
  live: [
    { id: 'nas-1', key: 'sauvegarde', status: 'live', title: 'Sauvegarde NAS', text: '12/40 Go', progress: 0.3, open: { kind: 'path', target: 'C:\\Logs\\sauvegarde.log' }, startedAt: now - 6 * MIN, updatedAt: now },
  ],
  recent: [
    { id: 'gpo-1', key: 'gpupdate', status: 'done', title: 'GPO magasins', text: 'Terminé en 3 min · 42 postes', progress: 1, open: null, startedAt: now - 50 * MIN, endedAt: now - 47 * MIN },
    { id: 'robo-1', key: 'robocopy', status: 'error', title: 'Robocopy Archives', text: 'Échec : disque plein (code 8)', progress: 0.62, open: { kind: 'path', target: 'C:\\Logs\\robocopy.log' }, startedAt: now - 3 * 60 * MIN, endedAt: now - 2 * 60 * MIN },
    { id: 'note-1', key: '', status: 'info', title: 'Inventaire exporté', text: 'inventaire-2026-10.csv', open: null, endedAt: now - 5 * 60 * MIN },
  ],
  ticker: null,
};

let push = () => {};
let emit = () => {};
let seq = 0;
const set = (patch) => {
  state = { ...state, ...patch };
  push(state);
};
const pct = (p) => `${Math.round(p * 100)} %`;
const ticker = (a) => ({
  key: `notify:${a.key}`, at: Date.now(), seq: ++seq, ttl: 4000, foldedOnly: true, lead: a.title,
  parts: [{ name: a.text || 'en cours', text: a.progress == null ? null : pct(a.progress) }],
  action: { name: 'show', payload: { id: a.id } },
});

function alertFor(kind, a) {
  return {
    key: `notify:${a.key || a.id}`, module: 'notify', at: Date.now(), from: 'Script', title: a.title, text: a.text,
    mood: kind === 'error' ? 'error' : 'finished', sound: kind === 'error' ? 'error' : 'tick',
    priority: kind === 'error' ? 65 : 55, ttl: kind === 'error' ? 30 : 9, count: 1,
    actions: a.open ? [{ label: 'Ouvrir', action: 'open', payload: { id: a.id }, primary: true }] : undefined,
  };
}

// The backup creeps forward, a ticker line at each quarter, until 90 % (the end is a button).
setInterval(() => {
  const a = state.live.find((x) => x.key === 'sauvegarde');
  if (!a || a.progress >= 0.9) return;
  const before = Math.floor(a.progress * 4);
  const progress = Math.min(0.9, +(a.progress + 0.02).toFixed(2));
  const next = { ...a, progress, text: `${Math.round(progress * 40)}/40 Go`, updatedAt: Date.now() };
  set({ live: state.live.map((x) => (x === a ? next : x)), ticker: Math.floor(progress * 4) > before ? ticker(next) : state.ticker });
}, 1500);

function end(key, kind, text) {
  const a = state.live.find((x) => x.key === key);
  if (!a) return;
  const item = { ...a, status: kind, text, endedAt: Date.now(), progress: kind === 'done' ? 1 : a.progress };
  set({ live: state.live.filter((x) => x !== a), recent: [item, ...state.recent].slice(0, 12), ticker: null });
  emit('alerts', [alertFor(kind, item)]);
}

function start(key, title, text, progress) {
  if (state.live.some((x) => x.key === key)) return;
  const a = { id: `${key}-${Date.now()}`, key, status: 'live', title, text, progress, open: null, startedAt: Date.now(), updatedAt: Date.now() };
  set({ live: [...state.live, a], ticker: ticker(a) });
}

export default {
  module: { id: 'notify', name: 'Scripts', icon: '⌁', color: COLOR, order: 40, secondary: true, hasView: true, dir: 'notify', enabled: true, settings: [] },
  state: () => state,
  connect(send, emitter) {
    push = send;
    emit = emitter;
    window.devNotify = { state: () => state, set };
  },
  action(name, p = {}) {
    switch (name) {
      case 'open':
        console.log('notify: would open', [...state.live, ...state.recent].find((x) => x.id === p.id)?.open);
        return true;
      case 'show':
        emit('expand', { id: 'notify' });
        return true;
      case 'forget':
        set({ live: state.live.filter((x) => x.key !== p.key) });
        return true;
      case 'dismiss':
        set({ recent: state.recent.filter((x) => x.id !== p.id) });
        return true;
      case 'clear':
        set({ recent: [] });
        return true;
      default:
        return null;
    }
  },
  alert(name) {
    if (name === 'script') return alertFor('done', { key: 'sauvegarde', id: 'x', title: 'Sauvegarde NAS', text: 'Terminé en 14 min', open: { kind: 'path', target: 'C:\\Logs\\sauvegarde.log' } });
    if (name === 'scriptError') return alertFor('error', { key: 'robocopy', id: 'y', title: 'Robocopy Archives', text: 'Échec : disque plein (code 8)', open: null });
    return null;
  },
  buttons: [
    ['script : build', () => start('build', 'Build HelpDesk', 'Compilation…', null)],
    ['script : copie', () => start('copie', 'Copie profils', '3/12 postes', 0.25)],
    ['script : sauvegarde finie', () => end('sauvegarde', 'done', 'Terminé en 14 min')],
    ['script : build en échec', () => end('build', 'error', 'Échec : 3 tests en erreur')],
  ],
};
