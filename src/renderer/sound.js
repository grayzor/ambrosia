// Ambrosia's sounds: a little lyre, synthesised with Karplus–Strong plucks.
// No audio files ship with the app; every sound is a handful of notes.
//
//   Sound.play('finish')     names: see SEQUENCES
//   Sound.setTheme('halloween')   themes: see THEMES (Gany's wardrobe picks one)

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12); // MIDI → Hz

// Rule of the house: a sound always says something. Real alerts (approval,
// question, mail, meeting, error, finish) keep their voice; the user's own
// gestures (click, petting, sending) get a soft touch; nothing plays on its own
// for decoration (hovering, unfolding, idle animations are silent).
//
// [midi note, start (s), gain]
const SEQUENCES = {
  hover: [[88, 0, 0.08]], // a click on the folded Gany: barely there
  greet: [[72, 0, 0.35], [76, 0.09, 0.32], [79, 0.18, 0.3], [84, 0.27, 0.35], [88, 0.4, 0.25]],
  // Launch (src/renderer/launch.js): a harp glissando as Gany comes down the
  // column of light, then one bright chord when he lands. Starts silent on purpose.
  launch: [
    [67, 0.5, 0.1], [69, 0.54, 0.11], [72, 0.58, 0.12], [74, 0.62, 0.13], [76, 0.66, 0.14], [79, 0.7, 0.15], [81, 0.74, 0.16],
    [84, 0.95, 0.24], [88, 0.95, 0.16], [91, 0.97, 0.12],
  ],
  relaunch: [[84, 0.4, 0.12], [88, 0.45, 0.12], [91, 0.5, 0.14]],
  approval: [[81, 0, 0.45], [88, 0.12, 0.45], [81, 0.5, 0.35], [88, 0.62, 0.35]],
  question: [[79, 0, 0.4], [84, 0.12, 0.35], [86, 0.24, 0.4]],
  finish: [[72, 0, 0.35], [76, 0.08, 0.35], [79, 0.16, 0.35], [84, 0.26, 0.45]],
  error: [[64, 0, 0.4], [60, 0.14, 0.4], [55, 0.28, 0.45]],
  mail: [[84, 0, 0.3], [88, 0.05, 0.28], [91, 0.1, 0.28], [96, 0.15, 0.3], [91, 0.42, 0.2], [96, 0.47, 0.25]],
  // Reactions to your own clicks: soft, they answer a gesture.
  annoyed: [[48, 0, 0.22], [47, 0.08, 0.2]],
  dizzy: [[72, 0, 0.14], [71, 0.07, 0.14], [70, 0.14, 0.14], [69, 0.21, 0.14], [68, 0.28, 0.14]],
  love: [[84, 0, 0.25], [88, 0.15, 0.25]],
  send: [[79, 0, 0.25], [86, 0.07, 0.25]],
  close: [[83, 0, 0.14], [76, 0.06, 0.12]], // declining an approval (no longer on folding)
  tick: [[96, 0, 0.08]],
  purr: [[60, 0, 0.08], [60, 0.18, 0.07], [60, 0.36, 0.06]],
  rate: [[67, 0, 0.3], [66, 0.2, 0.3]],
};

// Halloween (src/renderer/wardrobe.js → soundTheme): the same strings, the same
// moments, another mood. Diminished arpeggios and tritones instead of the bright
// major chords, the approval borrows the opening of Bach's Toccata in D minor,
// and every note is doubled by a slightly detuned string for a haunted shimmer.
// Names it does not redefine keep the lyre's notes, with the haunted timbre.
const HALLOWEEN = {
  hover: [[77, 0, 0.08]],
  greet: [[62, 0, 0.35], [65, 0.1, 0.32], [68, 0.2, 0.3], [71, 0.3, 0.32], [74, 0.45, 0.28]],
  launch: [
    [81, 0.5, 0.1], [80, 0.54, 0.11], [79, 0.58, 0.12], [78, 0.62, 0.13], [77, 0.66, 0.14], [76, 0.7, 0.15], [75, 0.74, 0.16],
    [62, 0.95, 0.24], [65, 0.95, 0.16], [68, 0.97, 0.14],
  ],
  relaunch: [[74, 0.4, 0.12], [77, 0.45, 0.12], [80, 0.5, 0.14]],
  approval: [[81, 0, 0.42], [79, 0.1, 0.36], [81, 0.2, 0.45], [79, 0.55, 0.3], [77, 0.64, 0.3], [76, 0.73, 0.3], [74, 0.82, 0.32], [73, 0.95, 0.32], [74, 1.12, 0.4]],
  question: [[74, 0, 0.4], [77, 0.12, 0.35], [80, 0.24, 0.4]],
  finish: [[62, 0, 0.35], [65, 0.08, 0.35], [69, 0.16, 0.35], [74, 0.26, 0.45], [73, 0.44, 0.2], [74, 0.52, 0.3]],
  error: [[62, 0, 0.4], [61, 0.16, 0.4], [56, 0.32, 0.45]],
  mail: [[81, 0, 0.3], [80, 0.05, 0.28], [77, 0.1, 0.28], [76, 0.15, 0.3], [77, 0.42, 0.2], [81, 0.47, 0.25]],
  annoyed: [[46, 0, 0.22], [45, 0.08, 0.2]],
  dizzy: [[70, 0, 0.14], [69, 0.07, 0.14], [68, 0.14, 0.14], [67, 0.21, 0.14], [66, 0.28, 0.14]],
  love: [[80, 0, 0.25], [84, 0.15, 0.25]],
  send: [[74, 0, 0.25], [80, 0.07, 0.25]],
  close: [[80, 0, 0.14], [73, 0.06, 0.12]],
  tick: [[89, 0, 0.08]],
  purr: [[55, 0, 0.08], [55, 0.18, 0.07], [55, 0.36, 0.06]],
  rate: [[62, 0, 0.3], [61, 0.2, 0.3]],
};

// A theme: its notes (falling back to the lyre's) and the timbre of its strings.
// bright: low-pass of the pluck (higher = brighter); decay: how long a string
// rings; detune: a second string this much sharper (0 = none), at `ghost` gain.
const THEMES = {
  lyre: { seq: SEQUENCES, tone: { bright: 0.55, decay: 0.996, detune: 0, ghost: 0 } },
  halloween: { seq: HALLOWEEN, tone: { bright: 0.32, decay: 0.998, detune: 0.012, ghost: 0.55 } },
};
let theme = 'lyre';

// The same sound twice within this window plays once (clicking Gany repeatedly,
// several alerts in one batch).
const REPEAT_MS = 1200;
const lastPlayed = new Map();

let ctx = null;
const cache = new Map();
let volume = 0.5;
let enabled = true;

function audio() {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

/** One plucked string, rendered once per pitch and timbre, and cached. */
function pluck(freq, tone = THEMES.lyre.tone) {
  const key = `${Math.round(freq * 10)}:${tone.bright}:${tone.decay}`;
  if (cache.has(key)) return cache.get(key);
  const ac = audio();
  const dur = 1.4;
  const rate = ac.sampleRate;
  const buf = ac.createBuffer(1, Math.floor(rate * dur), rate);
  const out = buf.getChannelData(0);
  const period = Math.max(2, Math.round(rate / freq));
  const ring = new Float32Array(period);
  for (let i = 0; i < period; i++) ring[i] = Math.random() * 2 - 1;
  let idx = 0;
  let prev = 0;
  for (let i = 0; i < out.length; i++) {
    const cur = ring[idx];
    const next = 0.5 * (cur + ring[(idx + 1) % period]) * tone.decay;
    ring[idx] = next;
    // gentle low-pass for a warmer, lyre-like tone
    prev = prev + (cur - prev) * tone.bright;
    out[i] = prev;
    idx = (idx + 1) % period;
  }
  cache.set(key, buf);
  return buf;
}

export const Sound = {
  configure({ sounds, volume: v }) {
    enabled = sounds !== false;
    if (typeof v === 'number') volume = v;
  },
  /** 'lyre' | 'halloween' (unknown names fall back to the lyre). */
  setTheme(name) {
    theme = THEMES[name] ? name : 'lyre';
  },
  get theme() {
    return theme;
  },
  /** `opts.theme` plays one sound in another theme (the wardrobe's « Écouter »). */
  play(name, opts = {}) {
    if (!enabled || volume <= 0) return;
    const th = THEMES[opts.theme] || THEMES[theme];
    const seq = th.seq[name] || SEQUENCES[name];
    if (!seq) return;
    const now = Date.now();
    if (now - (lastPlayed.get(name) || 0) < REPEAT_MS) return;
    lastPlayed.set(name, now);
    const { tone } = th;
    try {
      const ac = audio();
      if (ac.state === 'suspended') ac.resume();
      const t0 = ac.currentTime + 0.01;
      const string = (freq, at, gain) => {
        const src = ac.createBufferSource();
        src.buffer = pluck(freq, tone);
        const g = ac.createGain();
        g.gain.value = gain * volume;
        src.connect(g).connect(ac.destination);
        src.start(t0 + at);
      };
      for (const [note, at, gain] of seq) {
        string(NOTE(note), at, gain);
        if (tone.detune) string(NOTE(note) * (1 + tone.detune), at + 0.012, gain * tone.ghost);
      }
    } catch {
      /* audio is a nicety */
    }
  },
  names: Object.keys(SEQUENCES),
  themes: Object.keys(THEMES),
};
