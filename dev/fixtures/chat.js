// Demander in the dev preview: a short conversation, an attachment, and the voice.
// « synth » answers with a made-up babble (a WAV built here), so Gany's mouth moves
// in the browser too. Buttons: live call, Gany speaking, dictation, a microphone error.
// Same shapes as src/modules/chat/main.js.

const now = Date.now();
const COLOR = '#B79CFF';

let state = {
  messages: [
    { role: 'user', text: 'Qu’y a-t-il sur cette image ?', at: now - 5 * 60000, files: ['capture.png'] },
    { role: 'assistant', text: 'Une erreur **0x80070005** : l’accès est refusé sur le poste 2 de l’Agence de Delphes. Vérifie les droits du compte de service.', at: now - 5 * 60000 },
    { role: 'user', text: 'Combien de mails importants ce matin ?', at: now - 60000, voice: true },
    { role: 'assistant', text: 'Trois, dont un de Claire sur le budget.', at: now - 60000, voice: true },
  ],
  busy: false,
  attachments: [],
  voice: { phase: null, partial: '', error: null, dictating: false, dictated: null, utter: null, live: false, install: null },
  mood: null,
};

let push = () => {};
const moodOf = (v) =>
  v.phase === 'listening' || v.dictating ? { name: 'listen', priority: 45 } : v.phase === 'thinking' ? { name: 'thinking', priority: 45 } : v.phase === 'speaking' ? { name: 'speak', priority: 45 } : null;
const setVoice = (patch) => {
  const voice = { ...state.voice, ...patch };
  state = { ...state, voice, mood: moodOf(voice) };
  push(state);
};
let utter = 0;
let dict = 0;

/** A WAV of syllable-like bursts: the dev stand-in for the main process' voice. */
function babble(text) {
  const rate = 16000;
  const secs = Math.min(4, 0.4 + text.length * 0.045);
  const n = Math.floor(rate * secs);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  str(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const syl = Math.max(0, Math.sin(t * Math.PI * 7)) ** 2; // ~7 syllables a second
    const s = (Math.sin(2 * Math.PI * 180 * t) * 0.6 + Math.sin(2 * Math.PI * 360 * t) * 0.25) * syl * 0.25;
    v.setInt16(44 + i * 2, s * 32767, true);
  }
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function liveStart() {
  setVoice({ live: true, phase: 'speaking', partial: '', error: null, utter: { id: ++utter, parts: ['Oui ? Je t’écoute.'], done: true } });
}
function hear() {
  const words = 'est-ce que j’ai des réunions cet après-midi'.split(' ');
  let i = 0;
  setVoice({ live: true, phase: 'listening', partial: '', utter: null });
  const t = setInterval(() => {
    if (++i > words.length) {
      clearInterval(t);
      state.messages = [...state.messages, { role: 'user', text: 'Est-ce que j’ai des réunions cet après-midi ?', at: Date.now(), voice: true }];
      setVoice({ phase: 'thinking', partial: '' });
      setTimeout(answer, 1200);
      return;
    }
    setVoice({ partial: words.slice(0, i).join(' ') });
  }, 260);
}
function answer() {
  const parts = ['Oui, deux.', 'Reprise de stock à quinze heures, puis le débrief ATLAS à seize heures trente.'];
  state.messages = [...state.messages, { role: 'assistant', text: parts.join(' '), at: Date.now(), voice: true }];
  setVoice({ phase: 'speaking', utter: { id: ++utter, parts, done: true } });
}

export default {
  module: { id: 'chat', name: 'Demander', icon: '☉', logo: '../../assets/icon.png', color: COLOR, order: 30, hasView: true, dir: 'chat', enabled: true, settings: [] },
  state: () => state,
  connect(send) {
    push = send;
  },
  action(name, payload = {}) {
    if (name === 'synth') return { ok: true, b64: babble(payload.text || '') };
    if (name === 'spoken') {
      if (state.voice.utter?.id === payload.id) setVoice({ utter: null, phase: state.voice.live ? 'listening' : null });
      return null;
    }
    if (name === 'interrupt') return setVoice({ utter: state.voice.utter ? { ...state.voice.utter, stop: true } : null, phase: state.voice.live ? 'listening' : null });
    if (name === 'live') return payload.on === false || state.voice.live ? setVoice({ live: false, phase: null, partial: '', utter: null }) : liveStart();
    if (name === 'dictate') {
      if (state.voice.dictating) return setVoice({ dictating: false, partial: '' });
      setVoice({ dictating: true, partial: '' });
      setTimeout(() => setVoice({ partial: 'reformule ce mail' }), 700);
      setTimeout(() => setVoice({ partial: '', dictated: { seq: ++dict, text: 'Reformule ce mail plus poliment.' } }), 1600);
      setTimeout(() => setVoice({ dictating: false }), 3000);
      return true;
    }
    if (name === 'detach') {
      state = { ...state, attachments: state.attachments.filter((a) => a.path !== payload.path) };
      return push(state);
    }
    if (name === 'attach' || name === 'attachClipboard' || name === 'attachData') {
      state = { ...state, attachments: [...state.attachments, { path: 'C:\\tmp\\capture.png', name: 'capture.png', thumb: null }] };
      return push(state);
    }
    if (name === 'clearVoiceError') return setVoice({ error: null });
    if (name === 'send') {
      state = { ...state, messages: [...state.messages, { role: 'user', text: payload.text, at: Date.now() }, { role: 'assistant', text: 'Réponse d’exemple (dev).', at: Date.now() }], attachments: [] };
      return push(state);
    }
    return null;
  },
  alert: () => null,
  buttons: [
    ['live : écoute', hear],
    ['live : Gany parle', answer],
    ['erreur micro', () => setVoice({ live: false, phase: null, error: { text: 'Windows demande ton accord pour la reconnaissance vocale en ligne.', fix: { label: 'Ouvrir le réglage', url: 'ms-settings:privacy-speech' }, help: 'Paramètres → Confidentialité et sécurité → Voix → « Reconnaissance vocale en ligne ».' } })],
  ],
};
