// Gany's voice in the island: plays what the chat module wants said, sentence by
// sentence, while Claude is still writing the rest. The sound of each sentence
// comes from the main process (Windows voice or Piper, src/main/speech.js); here
// it is played, and its loudness moves Gany's mouth.
//
//   const player = new VoicePlayer({ api, gany }); player.update(chatState.voice, settings)

/**
 * The voices pad every sentence with silence at both ends; played one after the
 * other, those gaps make Gany sound slow. Keep the sound plus a short breath
 * (40 ms ahead, 120 ms after: the pause between two sentences).
 */
function trim(ac, buf) {
  const data = buf.getChannelData(0);
  const loud = 0.012;
  let a = 0;
  let b = data.length - 1;
  while (a < b && Math.abs(data[a]) < loud) a++;
  while (b > a && Math.abs(data[b]) < loud) b--;
  a = Math.max(0, a - Math.round(buf.sampleRate * 0.04));
  b = Math.min(data.length, b + Math.round(buf.sampleRate * 0.12));
  if (b - a <= 0 || (a === 0 && b === data.length)) return buf;
  const out = ac.createBuffer(buf.numberOfChannels, b - a, buf.sampleRate);
  for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(a, b), c);
  return out;
}

export class VoicePlayer {
  constructor({ api, gany, onSpeaking = () => {} }) {
    this.api = api;
    this.gany = gany;
    this.onSpeaking = onSpeaking; // (true|false): Gany's face while the sound plays
    this.ctx = null;
    this.utter = null; // { id, parts, done, stop }
    this.next = 0; // index of the next part to fetch
    this.played = 0; // parts finished
    this.sounds = []; // index → Promise<AudioBuffer|null>
    this.source = null;
    this.playing = false;
    this.volume = 0.9;
    this.muted = false; // « Couper les sons »: the conversation goes on, in writing only
    this.raf = null;
  }

  audio() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.gain = this.ctx.createGain();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.gain.connect(this.analyser).connect(this.ctx.destination);
      this.level = new Float32Array(this.analyser.fftSize);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  /** New state from the chat module: `voice.utter` = { id, parts, done, stop }. */
  update(voice, settings = {}) {
    this.volume = typeof settings.voiceVolume === 'number' ? settings.voiceVolume : 0.9;
    if (this.gain) this.gain.gain.value = this.volume;
    const u = voice?.utter || null;
    if (!u) {
      if (this.utter) this.stop(false);
      return;
    }
    if (!this.utter || u.id !== this.utter.id) {
      if (this.utter) this.stop(false);
      this.utter = { ...u, parts: [...u.parts] };
      this.next = 0;
      this.played = 0;
      this.sounds = [];
    } else this.utter = { ...u, parts: [...u.parts] };
    if (u.stop) return this.stop(false);
    // Fetch the sound of every new sentence now, in order: the main process voices them one by one.
    while (this.next < this.utter.parts.length) {
      const i = this.next++;
      this.sounds[i] = this.muted ? Promise.resolve(null) : this.fetch(this.utter.parts[i]);
    }
    this.pump();
  }

  /** The island's « Couper les sons » silences Gany too, even mid-sentence. */
  setMuted(on) {
    this.muted = !!on;
    if (!this.muted || !this.source) return;
    try {
      this.source.stop(); // its end lets the queue run on, silently, to « spoken »
    } catch {
      /* already stopped */
    }
    this.onSpeaking(false);
  }

  async fetch(text) {
    try {
      const res = await this.api.action('chat', 'synth', { text });
      if (!res?.ok) return null;
      const bin = atob(res.b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return trim(this.audio(), await this.audio().decodeAudioData(bytes.buffer));
    } catch {
      return null;
    }
  }

  async pump() {
    if (this.playing || !this.utter) return;
    const id = this.utter.id;
    if (this.played >= this.utter.parts.length) {
      if (this.utter.done) this.finish(id);
      return;
    }
    this.playing = true;
    const buf = await this.sounds[this.played];
    // Cut off (or replaced) while the sound was being made.
    if (!this.utter || this.utter.id !== id) return;
    if (buf && !this.muted) await this.play(buf);
    if (!this.utter || this.utter.id !== id) return;
    this.playing = false;
    this.played++;
    this.pump();
  }

  play(buf) {
    return new Promise((resolve) => {
      const ac = this.audio();
      const src = ac.createBufferSource();
      src.buffer = buf;
      src.connect(this.gain);
      this.source = src;
      src.onended = () => {
        if (this.source === src) this.source = null;
        resolve();
      };
      src.start();
      this.onSpeaking(true);
      this.lipSync();
    });
  }

  /** Gany's mouth follows the loudness of his voice. */
  lipSync() {
    cancelAnimationFrame(this.raf);
    const tick = () => {
      if (!this.source) {
        this.gany.setVoice(0);
        return;
      }
      this.analyser.getFloatTimeDomainData(this.level);
      let sum = 0;
      for (const v of this.level) sum += v * v;
      const rms = Math.sqrt(sum / this.level.length);
      this.gany.setVoice(Math.min(1, rms * 6));
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  finish(id) {
    this.utter = null;
    this.gany.setVoice(0);
    this.onSpeaking(false);
    this.api.action('chat', 'spoken', { id }).catch(() => {});
  }

  /** Silence now. `tell`: let the chat module know (a click on Gany). */
  stop(tell = true) {
    const id = this.utter?.id;
    this.utter = null;
    this.sounds = [];
    this.playing = false;
    try {
      this.source?.stop();
    } catch {
      /* already stopped */
    }
    this.source = null;
    this.gany.setVoice(0);
    this.onSpeaking(false);
    if (tell && id != null) this.api.action('chat', 'interrupt').catch(() => {});
  }

  get speaking() {
    return !!this.source;
  }
}
