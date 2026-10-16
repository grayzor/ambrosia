// Lire (OCR) in the dev preview: two images already read (one with a table), and a
// capture « just copied » so the offer shows at the top of the open island.
// Same shapes as src/modules/ocr/main.js. Buttons: « image copiée », « lire ».

const MIN = 60000;
const COLOR = '#7FD6C2';
const now = Date.now();

const thumb = (bg, fg) => {
  const c = document.createElement('canvas');
  c.width = 88;
  c.height = 68;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, 88, 68);
  g.fillStyle = fg;
  for (let y = 10; y < 60; y += 10) g.fillRect(8, y, 30 + ((y * 7) % 44), 4);
  return c.toDataURL();
};

let state = {
  items: [
    {
      id: 'o2', at: now - 2 * MIN, source: 'clip', name: 'Image copiée', image: 'C:\\Users\\dev\\AppData\\Local\\Ambrosia\\ocr\\clip.png', thumb: thumb('#fff', '#333'),
      text: 'Erreur 0x80070005 : accès refusé.\n\nMagasin\tCaisse\tÉtat\nAgence de Delphes\tCaisse 2\tHors ligne\nAgence de Corinthe\tCaisse 1\tEn ligne', words: 16, columns: true, lang: 'fr-FR', copied: now - 2 * MIN,
    },
    {
      id: 'o1', at: now - 40 * MIN, source: 'drop', name: 'ticket-photo.jpg', image: 'C:\\Users\\dev\\Pictures\\ticket-photo.jpg', thumb: thumb('#d9cfc0', '#5a4a3a'),
      text: 'TICKET N° 004512\nCB **** 6411\nTOTAL 51,25 EUR', words: 8, columns: false, lang: 'fr-FR',
      claude: { text: '| Article | Prix |\n|---|---|\n| Support portable | 51,25 € |\n\nTicket n° 004512, payé par carte.' },
    },
  ],
  clip: { seq: 42, at: now - 20000 },
  busy: false,
  mood: null,
};

let push = () => {};
const set = (patch) => {
  state = { ...state, ...patch };
  state.busy = state.items.some((i) => i.busy || i.claude?.busy);
  state.mood = state.busy ? { name: 'read', priority: 30 } : null;
  push(state);
};
const patchItem = (id, patch) => set({ items: state.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) });

let n = 0;
function readClipboard() {
  const id = `new${++n}`;
  set({ clip: null, items: [{ id, at: Date.now(), source: 'clip', name: 'Image copiée', image: 'C:\\tmp\\x.png', thumb: thumb('#1d2330', '#9fd'), busy: true }, ...state.items].slice(0, 6) });
  setTimeout(() => patchItem(id, { busy: false, text: 'Mot de passe expiré\nContactez le support informatique au 4242.', words: 9, copied: Date.now() }), 1300);
  return true;
}

export default {
  module: { id: 'ocr', name: 'Lire', icon: '⌕', color: COLOR, order: 36, secondary: true, hasView: true, dir: 'ocr', enabled: true, settings: [] },
  state: () => state,
  connect(send) {
    push = send;
  },
  action(name, payload = {}) {
    if (name === 'readClipboard' || name === 'readData' || name === 'readFile') return readClipboard();
    if (name === 'dismissClip') return set({ clip: null });
    if (name === 'copy') return patchItem(payload.id, { copied: Date.now() });
    if (name === 'remove') return set({ items: state.items.filter((i) => i.id !== payload.id) });
    if (name === 'clear') return set({ items: [] });
    if (name === 'claude') {
      patchItem(payload.id, { claude: { busy: true } });
      setTimeout(() => patchItem(payload.id, { claude: { text: 'Mot de passe expiré.\nContactez le support informatique au 4242.' } }), 1500);
    }
    return null;
  },
  buttons: [
    ['image copiée', () => set({ clip: { seq: Date.now(), at: Date.now() } })],
    ['lire (OCR)', readClipboard],
  ],
};
