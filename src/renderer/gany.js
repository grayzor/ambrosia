// Gany — Ganymède, l'échanson des dieux, celui qui sert l'ambroisie.
//
// A small marble-white cherub with a golden laurel wreath and two little wings,
// drawn entirely in Canvas 2D: no images, no sprite sheets. Every mood is a set
// of parameters the frame function eases towards, so switching mood never pops.
//
//   const g = new Gany(canvas); g.setMood('working'); g.look(x, y); g.start();
//
// Moods: idle, working, thinking, approval, question, finished, error, mail,
// sleeping, annoyed, dizzy, love, ratelimit, greet, waiting, meeting-soon/now/late/call.

const TAU = Math.PI * 2;

const MOODS = {
  idle: { wingSpeed: 2.2, wingAmp: 0.1, bob: 0.012, eye: 'open', mouth: 'smile', eyeScale: 1 },
  working: { wingSpeed: 15, wingAmp: 0.38, bob: 0.04, eye: 'open', mouth: 'o', sparkles: 3, eyeScale: 1 },
  thinking: { wingSpeed: 3, wingAmp: 0.12, bob: 0.015, eye: 'open', mouth: 'flat', lookUp: true, dots: true, eyeScale: 1 },
  approval: { wingSpeed: 7, wingAmp: 0.3, bob: 0.03, eye: 'wide', mouth: 'o', mark: '!', wingLift: 0.35, eyeScale: 1.2 },
  question: { wingSpeed: 4, wingAmp: 0.18, bob: 0.02, eye: 'open', mouth: 'flat', mark: '?', tilt: 0.12, eyeScale: 1.1 },
  waiting: { wingSpeed: 3, wingAmp: 0.14, bob: 0.02, eye: 'open', mouth: 'smile', mark: '…', eyeScale: 1 },
  finished: { wingSpeed: 9, wingAmp: 0.32, bob: 0.0, jump: true, eye: 'happy', mouth: 'grin', sparkles: 6, eyeScale: 1 },
  error: { wingSpeed: 1.2, wingAmp: 0.04, bob: 0.008, eye: 'sad', mouth: 'frown', cloud: true, wingLift: -0.25, eyeScale: 1 },
  mail: { wingSpeed: 8, wingAmp: 0.28, bob: 0.035, eye: 'open', mouth: 'smile', envelope: true, eyeScale: 1.1 },
  sleeping: { wingSpeed: 0.8, wingAmp: 0.03, bob: 0.01, eye: 'closed', mouth: 'flat', zzz: true, wingLift: -0.3, eyeScale: 1 },
  annoyed: { wingSpeed: 6, wingAmp: 0.2, bob: 0, eye: 'squint', mouth: 'pout', shake: true, eyeScale: 1 },
  dizzy: { wingSpeed: 2, wingAmp: 0.15, bob: 0.02, eye: 'spiral', mouth: 'wavy', stars: true, sway: true, eyeScale: 1 },
  love: { wingSpeed: 5, wingAmp: 0.22, bob: 0.02, eye: 'heart', mouth: 'smile', hearts: true, eyeScale: 1 },
  ratelimit: { wingSpeed: 1.5, wingAmp: 0.06, bob: 0.01, eye: 'tired', mouth: 'flat', sweat: true, wingLift: -0.2, eyeScale: 1 },
  // Meetings: Gany holds an hourglass. Calm and golden a few minutes before,
  // orange at the start, red and panicking when the meeting runs without you.
  'meeting-soon': { wingSpeed: 4, wingAmp: 0.16, bob: 0.02, eye: 'open', mouth: 'smile', hourglass: 'soon', eyeScale: 1.05 },
  'meeting-now': { wingSpeed: 10, wingAmp: 0.32, bob: 0.035, eye: 'wide', mouth: 'o', hourglass: 'now', mark: '!', markColor: '#F2A65A', eyeScale: 1.2 },
  'meeting-late': { wingSpeed: 16, wingAmp: 0.42, bob: 0.03, eye: 'wide', mouth: 'o', hourglass: 'late', shake: true, sweat: true, mark: '!', markColor: '#FF5C6C', eyeScale: 1.3 },
  // In a call (« en appel »): Gany keeps still and quiet, eyes half closed, wings low.
  'meeting-call': { wingSpeed: 1.6, wingAmp: 0.06, bob: 0.008, eye: 'happy', mouth: 'flat', wingLift: -0.15, tilt: 0.06, eyeScale: 1 },
  // Little moments of personality
  yawn: { wingSpeed: 1.2, wingAmp: 0.05, bob: 0.008, eye: 'closed', mouth: 'yawn', wingLift: 0.25, eyeScale: 1 },
  wink: { wingSpeed: 6, wingAmp: 0.22, bob: 0.02, eye: 'wink', mouth: 'grin', sparkles: 2, eyeScale: 1 },
  relief: { wingSpeed: 2, wingAmp: 0.08, bob: 0, eye: 'happy', mouth: 'o', wingLift: 0.5, puff: true, eyeScale: 1 },
  surprised: { wingSpeed: 12, wingAmp: 0.4, bob: 0, eye: 'wide', mouth: 'o', mark: '!', jump: true, eyeScale: 1.4 },
  shy: { wingSpeed: 3, wingAmp: 0.12, bob: 0.015, eye: 'happy', mouth: 'smile', blush: true, tilt: -0.1, eyeScale: 1 },
  purr: { wingSpeed: 3, wingAmp: 0.1, bob: 0.01, eye: 'happy', mouth: 'smile', blush: true, hearts: true, tilt: 0.08, sway: true, eyeScale: 1 },
  drink: { wingSpeed: 4, wingAmp: 0.15, bob: 0.015, eye: 'happy', mouth: 'flat', cup: 'drink', eyeScale: 1 },
  hungry: { wingSpeed: 7, wingAmp: 0.25, bob: 0.03, eye: 'open', mouth: 'o', cup: 'offer', eyeScale: 1.15 },
  lunch: { wingSpeed: 3, wingAmp: 0.12, bob: 0.02, eye: 'happy', mouth: 'grin', bowl: true, eyeScale: 1 },
  greet: { wingSpeed: 6, wingAmp: 0.25, bob: 0.02, eye: 'happy', mouth: 'grin', wave: true, sparkles: 4, eyeScale: 1 },
  // Launch: flying down the column of light, then pouring the ambrosia.
  soar: { wingSpeed: 24, wingAmp: 0.5, bob: 0, eye: 'open', mouth: 'o', eyeScale: 1.1 },
  pour: { wingSpeed: 4, wingAmp: 0.14, bob: 0, eye: 'happy', mouth: 'smile', cup: 'pour', eyeScale: 1 },
  // Well-being: a long stretch, wings up, before a break.
  stretch: { wingSpeed: 1.4, wingAmp: 0.05, bob: 0.008, eye: 'closed', mouth: 'o', stretch: true, wingLift: 0.85, eyeScale: 1 },
  // Focus mode: eyes closed, levitating, a thin golden halo.
  focus: { wingSpeed: 1.1, wingAmp: 0.04, bob: 0.03, eye: 'closed', mouth: 'smile', halo: true, wingLift: -0.1, eyeScale: 1 },
  // Everything is done: both wings up, a jump, sparkles.
  // The live conversation (src/modules/chat): all ears, then talking (mouth on the voice).
  listen: { wingSpeed: 3, wingAmp: 0.12, bob: 0.012, eye: 'open', mouth: 'smile', waves: true, tilt: 0.1, eyeScale: 1.1 },
  speak: { wingSpeed: 4.5, wingAmp: 0.16, bob: 0.02, eye: 'open', mouth: 'talk', eyeScale: 1 },
  // Reading an image (Lire): a magnifying glass, eyes on it.
  read: { wingSpeed: 2.5, wingAmp: 0.1, bob: 0.01, eye: 'open', mouth: 'flat', lens: true, eyeScale: 1.05 },
  cheer: { wingSpeed: 13, wingAmp: 0.35, bob: 0, jump: true, eye: 'happy', mouth: 'grin', sparkles: 8, wingLift: 0.6, eyeScale: 1 },
};

const GOLD = '#E8B923';
const GOLD_LIGHT = '#F8DC6C';
const GOLD_DARK = '#9C7410';
const INK = '#2A2433';

export class Gany {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.mood = 'idle';
    this.p = { ...MOODS.idle };
    this.lookTarget = { x: 0, y: 0 };
    this.lookNow = { x: 0, y: 0 };
    this.blink = 0;
    this.nextBlink = performance.now() + 2500;
    this.moodSince = performance.now();
    this.fps = 60;
    this.running = false;
    this.squish = 0;
    this.lastFrame = 0;
    this.eyeScaleNow = 1;
    this.wingLiftNow = 0;
    this.outfit = null; // 'weekend'
    this.energy = 'normal'; // 'tired' | 'normal' | 'cheerful'
    this.idle = null; // { name, until, started }
    this.glanceAt = null; // { x, y, until }
    this.impatience = 0; // 0..3, while an approval waits
    this.pourK = 1; // 0..1, how far the cup is tipped (mood 'pour')
    this.voice = 0; // 0..1, loudness of his voice (mood 'speak')
    this.voiceNow = 0;
  }

  /**
   * 'weekend' (flower crown + sunglasses), an occasion ('noel', 'nouvelan',
   * 'avril', 'juillet', 'halloween', 'valentin', 'epiphanie', 'paques') or null.
   */
  setOutfit(name) {
    this.outfit = name || null;
  }

  /** 0 = calm, 1..3 = an approval has been waiting longer and longer. */
  setImpatience(level) {
    this.impatience = Math.max(0, Math.min(3, level | 0));
  }

  /** Loudness of Gany's voice, 0..1, while he speaks: his mouth follows it. */
  setVoice(level) {
    this.voice = Math.max(0, Math.min(1, Number(level) || 0));
  }

  /** 'tired' draws dark circles, 'cheerful' a bouncier Gany. */
  setEnergy(name) {
    this.energy = name || 'normal';
  }

  /**
   * A short idle animation, only meaningful while the mood is idle:
   * 'yawn' | 'crown' | 'fly' | 'cup' | 'doze'.
   */
  playIdle(name, ms = 3500) {
    const now = performance.now();
    this.idle = { name, started: now, until: now + ms };
  }

  /** Eyes turn to a point (canvas-centre relative px) for a moment. */
  glance(dx, dy, ms = 1800) {
    const d = Math.hypot(dx, dy) || 1;
    this.glanceAt = { x: dx / d, y: Math.max(-1, Math.min(1, dy / d)), until: performance.now() + ms };
  }

  setMood(name) {
    if (!MOODS[name] || name === this.mood) return;
    this.mood = name;
    this.p = { ...MOODS[name] };
    this.moodSince = performance.now();
  }

  /** Pointer position relative to the canvas centre, in CSS pixels. */
  look(dx, dy) {
    const d = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, d / 260);
    this.lookTarget = { x: (dx / d) * k, y: (dy / d) * k };
  }

  poke() {
    this.squish = 1;
  }

  setFps(fps) {
    this.fps = fps;
  }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = (t) => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      if (this.fps < 60 && t - this.lastFrame < 1000 / this.fps - 2) return;
      this.lastFrame = t;
      this.draw(t);
    };
    requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
  }

  /** Renders one frame into an arbitrary context (also used for icons). */
  draw(t = performance.now(), ctx = this.ctx, size) {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const S = size || c.clientWidth || 96;
    if (!size) {
      const px = Math.round(S * dpr);
      if (c.width !== px || c.height !== px) {
        c.width = px;
        c.height = px;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    ctx.clearRect(0, 0, S, S);

    let p = this.p;
    const s = t / 1000;
    // Idle actions play over the idle mood only.
    const idle = this.idle && t < this.idle.until && this.mood === 'idle' ? this.idle : null;
    if (this.idle && !idle && t >= this.idle.until) this.idle = null;
    if (idle) {
      const k = (t - idle.started) / (idle.until - idle.started);
      if (idle.name === 'yawn') p = { ...p, ...(k > 0.15 && k < 0.8 ? { eye: 'closed', mouth: 'yawn', wingLift: 0.3 } : {}) };
      else if (idle.name === 'doze') p = { ...p, eye: k < 0.85 ? 'closed' : 'open', mouth: 'flat', zzz: k > 0.2 && k < 0.85, wingAmp: 0.03 };
      else if (idle.name === 'crown') p = { ...p, lookUp: true, crownWiggle: true };
      else if (idle.name === 'cup') p = { ...p, eye: 'happy', cup: 'spin' };
      else if (idle.name === 'fly') p = { ...p, fly: true };
    }
    if (this.energy === 'cheerful') p = { ...p, bob: (p.bob || 0) * 1.8 + 0.01 };
    // An approval that waits: Gany taps his foot, looks at the card then at you,
    // and fumes after a few minutes (see setImpatience).
    const imp = /^(approval|question)$/.test(this.mood) ? this.impatience : 0;
    if (imp) p = { ...p, mark: ['', '!', '!!', '!!!'][imp] || p.mark, steam: imp >= 3, blushHot: imp >= 2 };
    const since = (t - this.moodSince) / 1000;
    const R = S * 0.27;
    let cx = S / 2;
    let cy = S * 0.56;

    // Eased state
    let target = this.lookTarget;
    if (p.fly) target = { x: Math.cos(s * 2.6) * 0.9, y: Math.sin(s * 3.7) * 0.5 - 0.4 };
    else if (this.glanceAt && t < this.glanceAt.until) target = this.glanceAt;
    else if (imp && s % 4 < 2.8) target = { x: 0.55, y: 0.85 }; // towards the card below
    else if (p.lens) target = { x: 0.45, y: 0.55 }; // on the glass
    this.lookNow.x += ((p.lookUp ? 0.5 : target.x) - this.lookNow.x) * 0.15;
    this.lookNow.y += ((p.lookUp ? -0.8 : target.y) - this.lookNow.y) * 0.15;
    this.eyeScaleNow += (p.eyeScale - this.eyeScaleNow) * 0.15;
    this.wingLiftNow += ((p.wingLift || 0) - this.wingLiftNow) * 0.1;
    this.squish *= 0.88;
    this.voiceNow += (this.voice - this.voiceNow) * (this.voice > this.voiceNow ? 0.6 : 0.3);

    // Blink
    if (t > this.nextBlink) {
      this.blink = 1;
      this.nextBlink = t + 2600 + Math.random() * 3200;
    }
    this.blink = Math.max(0, this.blink - 0.12);
    const blinkK = this.blink > 0 ? Math.abs(Math.sin(this.blink * Math.PI)) : 0;

    // Body motion
    cy += Math.sin(s * 2.4) * S * p.bob;
    if (p.jump) cy -= Math.abs(Math.sin(since * 5.5)) * S * 0.09 * Math.max(0, 1 - since / 3);
    if (p.shake) cx += Math.sin(s * 40) * S * 0.015 * (p.hourglass === 'late' ? 0.6 + 0.4 * Math.abs(Math.sin(s * 2)) : Math.max(0, 1 - since / 1.2));
    // Foot tapping: a short hop, faster as the wait grows.
    let tap = 0;
    if (imp) {
      const ph = (s * (0.9 + imp * 0.5)) % 1;
      tap = ph < 0.18 ? Math.sin((ph / 0.18) * Math.PI) : 0;
      cy -= tap * S * 0.035;
    }
    let tilt = p.tilt || 0;
    if (p.sway) tilt += Math.sin(s * 3) * 0.12;
    const breathe = 1 + Math.sin(s * 1.8) * 0.018;
    // A long stretch: up, hold, down.
    const reach = p.stretch ? Math.max(0, Math.sin(s * 1.3)) ** 2 : 0;
    const sq = this.squish;

    if (p.halo) this.drawHalo(ctx, cx, cy - R * 1.12, R, s);
    if (tap > 0.6) this.drawDust(ctx, cx, cy + R * 0.98, R, tap);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(tilt);
    ctx.scale((1 + sq * 0.12) * (1 - reach * 0.06), (1 - sq * 0.12) * breathe * (1 + reach * 0.1));

    this.drawWings(ctx, R, s, p);
    this.drawBody(ctx, R);
    if (this.outfit === 'avril') this.drawFish(ctx, R, s);
    ctx.save();
    if (p.crownWiggle) ctx.rotate(Math.sin(s * 7) * 0.08);
    this.drawWreath(ctx, R);
    if (this.outfit === 'weekend') this.drawFlowers(ctx, R);
    else if (this.outfit) this.drawOccasion(ctx, R, s, this.outfit);
    ctx.restore();
    this.drawFace(ctx, R, s, p, blinkK);
    if (p.envelope) this.drawEnvelope(ctx, R, s);
    if (p.hourglass) this.drawHourglass(ctx, R, s, p.hourglass);
    if (p.cup) this.drawCup(ctx, R, s, p.cup);
    if (p.bowl) this.drawBowl(ctx, R, s);
    if (p.lens) this.drawLens(ctx, R, s);
    ctx.restore();

    // Overlays in screen space
    if (p.mark) this.drawMark(ctx, cx + R * 0.95, cy - R * 1.35, R, s, p.mark);
    if (p.dots) this.drawDots(ctx, cx + R * 1.0, cy - R * 1.3, R, s);
    if (p.sparkles) this.drawSparkles(ctx, cx, cy, R, s, p.sparkles);
    if (p.zzz) this.drawZzz(ctx, cx + R * 0.9, cy - R * 1.1, R, s);
    if (p.cloud) this.drawCloud(ctx, cx, cy - R * 1.65, R, s);
    if (p.stars) this.drawStars(ctx, cx, cy - R * 1.05, R, s);
    if (p.hearts) this.drawHearts(ctx, cx, cy, R, s);
    if (p.puff) this.drawPuff(ctx, cx + R * 0.35, cy + R * 0.2, R, s);
    if (p.fly) this.drawFly(ctx, cx, cy, R, s);
    if (p.sweat) this.drawSweat(ctx, cx + R * 0.85, cy - R * 0.55, R, s);
    if (p.steam) this.drawSteam(ctx, cx, cy - R * 0.9, R, s);
    if (p.waves) this.drawWaves(ctx, cx, cy, R, s);
  }

  /**
   * Where the ambrosia leaves the cup (mood 'pour'), in canvas px for a Gany
   * drawn at `size`: the launch animation draws the stream from there.
   */
  cupLip(size) {
    const R = size * 0.27;
    const w = R * 0.7 * 1.3;
    const a = 0.25 + this.pourK * 1.05;
    const ox = R * 1.18;
    const oy = R * 0.3;
    return { x: size / 2 + ox + Math.cos(a) * (w / 2), y: size * 0.56 + oy + Math.sin(a) * (w / 2) };
  }

  // ── Parts ─────────────────────────────────────────────────────────────────

  bodyPath(ctx, R) {
    // A soft superellipse, a touch wider at the bottom.
    ctx.beginPath();
    const n = 2.6;
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * TAU;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const rx = R * (sa > 0 ? 1.06 : 1.0);
      const ry = R * 0.97;
      const x = Math.sign(ca) * Math.pow(Math.abs(ca), 2 / n) * rx;
      const y = Math.sign(sa) * Math.pow(Math.abs(sa), 2 / n) * ry;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  drawBody(ctx, R) {
    const g = ctx.createRadialGradient(-R * 0.35, -R * 0.45, R * 0.1, 0, 0, R * 1.25);
    g.addColorStop(0, '#FFFFFF');
    g.addColorStop(0.55, '#F2ECE1');
    g.addColorStop(1, '#CFC3AE');
    this.bodyPath(ctx, R);
    ctx.fillStyle = g;
    ctx.fill();
    // golden rim light, the ambrosia glow
    ctx.save();
    this.bodyPath(ctx, R);
    ctx.clip();
    const rim = ctx.createLinearGradient(0, R, 0, R * 0.2);
    rim.addColorStop(0, 'rgba(232,185,35,0.45)');
    rim.addColorStop(1, 'rgba(232,185,35,0)');
    ctx.fillStyle = rim;
    ctx.fillRect(-R * 1.2, -R, R * 2.4, R * 2.1);
    ctx.restore();
  }

  drawWreath(ctx, R) {
    // Two golden laurel branches on top of the head, tips meeting at the front.
    const leaves = 5;
    const rr = R * 0.9;
    for (const side of [-1, 1]) {
      // the stem
      ctx.beginPath();
      ctx.strokeStyle = GOLD_DARK;
      ctx.lineWidth = Math.max(0.6, R * 0.03);
      const a0 = -Math.PI / 2 + side * 0.18;
      const a1 = -Math.PI / 2 + side * 1.2;
      ctx.arc(0, 0, rr, Math.min(a0, a1), Math.max(a0, a1));
      ctx.stroke();
      for (let i = 0; i < leaves; i++) {
        const k = i / (leaves - 1);
        const a = -Math.PI / 2 + side * (0.22 + k * 0.95);
        const x = Math.cos(a) * rr;
        const y = Math.sin(a) * rr;
        // direction along the branch, towards the front tip
        const tx = side * Math.sin(a);
        const ty = -side * Math.cos(a);
        const tangent = Math.atan2(ty, tx);
        for (const out of [1, -1]) {
          const len = R * (0.27 - k * 0.04);
          const wid = len * 0.4;
          const ang = tangent + out * side * -0.6;
          ctx.save();
          ctx.translate(x + Math.cos(a) * out * R * 0.035, y + Math.sin(a) * out * R * 0.035);
          ctx.rotate(ang);
          const lg = ctx.createLinearGradient(0, -wid, 0, wid);
          lg.addColorStop(0, GOLD_LIGHT);
          lg.addColorStop(1, GOLD);
          ctx.fillStyle = lg;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.quadraticCurveTo(len * 0.5, -wid, len, 0);
          ctx.quadraticCurveTo(len * 0.5, wid, 0, 0);
          ctx.fill();
          ctx.strokeStyle = GOLD_DARK;
          ctx.lineWidth = Math.max(0.5, R * 0.018);
          ctx.stroke();
          ctx.restore();
        }
      }
    }
    // the two berries at the front
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(side * R * 0.2, -R * 0.99, R * 0.055, 0, TAU);
      ctx.fillStyle = GOLD_LIGHT;
      ctx.fill();
      ctx.strokeStyle = GOLD_DARK;
      ctx.lineWidth = Math.max(0.5, R * 0.015);
      ctx.stroke();
    }
  }

  drawWings(ctx, R, s, p) {
    const flap = Math.sin(s * p.wingSpeed) * p.wingAmp;
    for (const side of [-1, 1]) {
      let a = -flap + this.wingLiftNow;
      if (p.wave && side === 1) a = Math.sin(s * 9) * 0.6 + 0.4;
      ctx.save();
      ctx.translate(side * R * 0.88, -R * 0.12);
      ctx.scale(side, 1);
      ctx.rotate(-a);
      // three feathers
      for (let f = 0; f < 3; f++) {
        const len = R * (0.62 - f * 0.12);
        const ang = -0.55 + f * 0.42;
        ctx.save();
        ctx.rotate(ang);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(len * 0.35, -len * 0.32, len * 0.85, -len * 0.22, len, 0);
        ctx.bezierCurveTo(len * 0.8, len * 0.14, len * 0.3, len * 0.18, 0, 0);
        const wg = ctx.createLinearGradient(0, 0, len, 0);
        wg.addColorStop(0, '#FFFFFF');
        wg.addColorStop(1, '#EDE6D6');
        ctx.fillStyle = wg;
        ctx.fill();
        ctx.strokeStyle = 'rgba(184,140,30,0.9)';
        ctx.lineWidth = Math.max(0.6, R * 0.025);
        ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
    }
  }

  drawFace(ctx, R, s, p, blinkK) {
    const lx = this.lookNow.x * R * 0.14;
    const ly = this.lookNow.y * R * 0.1;
    const ex = R * 0.36;
    const ey = -R * 0.02;
    const es = this.eyeScaleNow;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // cheeks
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(side * R * 0.58 + lx * 0.3, R * 0.28, R * 0.15, R * 0.09, 0, 0, TAU);
      ctx.fillStyle = p.blush || p.blushHot || this.outfit === 'valentin' ? 'rgba(255,105,120,0.75)' : p.eye === 'heart' || p.mouth === 'pout' ? 'rgba(255,120,120,0.55)' : 'rgba(255,150,140,0.32)';
      ctx.fill();
    }

    for (const side of [-1, 1]) {
      const x = side * ex + lx;
      const y = ey + ly;
      ctx.fillStyle = INK;
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(1, R * 0.075);
      // A busy day leaves marks.
      if (this.energy === 'tired' && !['closed', 'happy'].includes(p.eye)) {
        ctx.strokeStyle = 'rgba(120,90,150,0.45)';
        ctx.lineWidth = Math.max(0.8, R * 0.035);
        ctx.beginPath();
        ctx.arc(x, y + R * 0.08, R * 0.13, Math.PI * 0.2, Math.PI * 0.8);
        ctx.stroke();
        ctx.strokeStyle = INK;
        ctx.lineWidth = Math.max(1, R * 0.075);
      }
      switch (p.eye === 'wink' ? (side === 1 ? 'happy' : 'open') : p.eye) {
        case 'happy':
          ctx.beginPath();
          ctx.arc(x, y + R * 0.06, R * 0.13, Math.PI * 1.1, Math.PI * 1.9);
          ctx.stroke();
          break;
        case 'closed':
          ctx.beginPath();
          ctx.arc(x, y - R * 0.02, R * 0.12, Math.PI * 0.15, Math.PI * 0.85);
          ctx.stroke();
          break;
        case 'squint':
          ctx.beginPath();
          ctx.moveTo(x - side * R * 0.12, y - R * 0.1);
          ctx.lineTo(x + side * R * 0.08, y);
          ctx.lineTo(x - side * R * 0.12, y + R * 0.1);
          ctx.stroke();
          break;
        case 'spiral': {
          ctx.lineWidth = Math.max(0.8, R * 0.045);
          ctx.beginPath();
          for (let i = 0; i < 40; i++) {
            const a = i * 0.45 + s * 6 * side;
            const r = (i / 40) * R * 0.15;
            const px = x + Math.cos(a) * r;
            const py = y + Math.sin(a) * r;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.stroke();
          break;
        }
        case 'heart': {
          const k = R * 0.15 * (1 + Math.sin(s * 8) * 0.08);
          heart(ctx, x, y, k, '#E5484D');
          break;
        }
        default: {
          const w = R * 0.115 * es;
          let h = R * 0.17 * es * (1 - blinkK * 0.92);
          if (p.eye === 'tired') h *= 0.45;
          ctx.beginPath();
          ctx.ellipse(x, y, w, Math.max(h, R * 0.012), 0, 0, TAU);
          ctx.fill();
          if (h > R * 0.06) {
            ctx.beginPath();
            ctx.arc(x - w * 0.35, y - h * 0.4, w * 0.36, 0, TAU);
            ctx.fillStyle = '#FFFFFF';
            ctx.fill();
            ctx.beginPath();
            ctx.arc(x + w * 0.3, y + h * 0.35, w * 0.16, 0, TAU);
            ctx.fill();
          }
          if (p.eye === 'sad') {
            ctx.strokeStyle = INK;
            ctx.lineWidth = Math.max(0.8, R * 0.05);
            ctx.beginPath();
            ctx.moveTo(x - side * R * 0.15, y - R * 0.3);
            ctx.lineTo(x + side * R * 0.08, y - R * 0.22);
            ctx.stroke();
          }
          if (p.eye === 'tired') {
            ctx.strokeStyle = INK;
            ctx.lineWidth = Math.max(0.8, R * 0.04);
            ctx.beginPath();
            ctx.moveTo(x - R * 0.13, y - R * 0.08);
            ctx.lineTo(x + R * 0.13, y - R * 0.08);
            ctx.stroke();
          }
        }
      }
    }

    // Weekend shades, over open eyes only
    if (this.outfit === 'weekend' && !['closed', 'happy', 'spiral', 'heart', 'squint'].includes(p.eye)) this.drawSunglasses(ctx, R, lx, ly);

    // mouth
    const mx = lx * 0.6;
    const my = R * 0.3 + ly * 0.5;
    ctx.strokeStyle = INK;
    ctx.fillStyle = INK;
    ctx.lineWidth = Math.max(0.8, R * 0.05);
    ctx.beginPath();
    switch (p.mouth) {
      case 'grin':
        ctx.moveTo(mx - R * 0.14, my - R * 0.02);
        ctx.quadraticCurveTo(mx, my + R * 0.2, mx + R * 0.14, my - R * 0.02);
        ctx.closePath();
        ctx.fillStyle = '#7A2E3A';
        ctx.fill();
        ctx.stroke();
        break;
      case 'o':
        ctx.ellipse(mx, my + R * 0.02, R * 0.055, R * 0.07, 0, 0, TAU);
        ctx.fillStyle = '#7A2E3A';
        ctx.fill();
        break;
      case 'frown':
        ctx.arc(mx, my + R * 0.1, R * 0.09, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
        break;
      case 'flat':
        ctx.moveTo(mx - R * 0.07, my + R * 0.02);
        ctx.lineTo(mx + R * 0.07, my + R * 0.02);
        ctx.stroke();
        break;
      case 'pout':
        ctx.moveTo(mx - R * 0.07, my + R * 0.05);
        ctx.quadraticCurveTo(mx, my - R * 0.03, mx + R * 0.07, my + R * 0.05);
        ctx.stroke();
        break;
      case 'wavy':
        ctx.moveTo(mx - R * 0.12, my);
        for (let i = 1; i <= 4; i++) ctx.quadraticCurveTo(mx - R * 0.12 + (i - 0.5) * R * 0.06, my + (i % 2 ? -1 : 1) * R * 0.05, mx - R * 0.12 + i * R * 0.06, my);
        ctx.stroke();
        break;
      case 'talk': {
        // Opens with the voice; a small line between words.
        const k = this.voiceNow;
        if (k < 0.04) {
          ctx.moveTo(mx - R * 0.06, my + R * 0.02);
          ctx.quadraticCurveTo(mx, my + R * 0.06, mx + R * 0.06, my + R * 0.02);
          ctx.stroke();
          break;
        }
        ctx.ellipse(mx, my + R * 0.03, R * (0.06 + k * 0.03), R * (0.025 + k * 0.1), 0, 0, TAU);
        ctx.fillStyle = '#7A2E3A';
        ctx.fill();
        break;
      }
      case 'yawn':
        ctx.ellipse(mx, my + R * 0.06, R * 0.1, R * 0.15, 0, 0, TAU);
        ctx.fillStyle = '#7A2E3A';
        ctx.fill();
        break;
      default: // smile
        ctx.arc(mx, my - R * 0.04, R * 0.1, Math.PI * 0.2, Math.PI * 0.8);
        ctx.stroke();
    }
  }

  drawEnvelope(ctx, R, s) {
    const w = R * 0.95;
    const h = R * 0.62;
    const y = R * 0.42 + Math.sin(s * 5) * R * 0.04;
    ctx.save();
    ctx.translate(0, y);
    ctx.rotate(Math.sin(s * 2.5) * 0.06);
    ctx.fillStyle = '#FFFBF0';
    ctx.strokeStyle = GOLD_DARK;
    ctx.lineWidth = Math.max(0.7, R * 0.035);
    roundRect(ctx, -w / 2, -h / 2, w, h, R * 0.06);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-w / 2, -h / 2);
    ctx.lineTo(0, h * 0.08);
    ctx.lineTo(w / 2, -h / 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, h * 0.08, R * 0.1, 0, TAU);
    ctx.fillStyle = '#C0392B';
    ctx.fill();
    ctx.restore();
  }

  drawSunglasses(ctx, R, lx, ly) {
    ctx.save();
    ctx.fillStyle = '#1B1A22';
    ctx.strokeStyle = GOLD_DARK;
    ctx.lineWidth = Math.max(0.6, R * 0.025);
    for (const side of [-1, 1]) {
      roundRect(ctx, side * R * 0.36 + lx - R * 0.2, -R * 0.13 + ly, R * 0.4, R * 0.26, R * 0.09);
      ctx.fill();
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(-R * 0.16 + lx, -R * 0.04 + ly);
    ctx.lineTo(R * 0.16 + lx, -R * 0.04 + ly);
    ctx.stroke();
    // a glint
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(-R * 0.45 + lx, -R * 0.09 + ly, R * 0.08, R * 0.03);
    ctx.restore();
  }

  drawFlowers(ctx, R) {
    // along the two laurel branches, symmetric, plus one at the front
    const spots = [-2.45, -2.05, -1.57, -1.09, -0.69];
    const colors = ['#FF8FB1', '#FFFFFF', '#FFB86B', '#FF8FB1', '#B79CFF'];
    spots.forEach((a, i) => {
      const x = Math.cos(a) * R * 0.92;
      const y = Math.sin(a) * R * 0.92;
      for (let k = 0; k < 5; k++) {
        const pa = (k / 5) * TAU;
        ctx.beginPath();
        ctx.arc(x + Math.cos(pa) * R * 0.07, y + Math.sin(pa) * R * 0.07, R * 0.065, 0, TAU);
        ctx.fillStyle = colors[i];
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(x, y, R * 0.05, 0, TAU);
      ctx.fillStyle = GOLD;
      ctx.fill();
    });
  }

  /** Days of the year (src/modules/gany/logic.js → occasion): a hat or a detail. */
  drawOccasion(ctx, R, s, name) {
    ctx.save();
    ctx.lineWidth = Math.max(0.6, R * 0.03);
    ctx.lineJoin = 'round';
    switch (name) {
      case 'noel': {
        // Santa's hat, the tip flopping to the side
        const g = ctx.createLinearGradient(0, -R * 1.6, 0, -R * 0.8);
        g.addColorStop(0, '#F0616D');
        g.addColorStop(1, '#B3262C');
        const sway = Math.sin(s * 1.6) * R * 0.05;
        ctx.beginPath();
        ctx.moveTo(-R * 0.78, -R * 0.82);
        ctx.quadraticCurveTo(-R * 0.45, -R * 1.62, R * 0.25, -R * 1.58);
        ctx.quadraticCurveTo(R * 0.8 + sway, -R * 1.5, R * 0.95 + sway, -R * 1.12);
        ctx.quadraticCurveTo(R * 0.6, -R * 1.25, R * 0.78, -R * 0.82);
        ctx.closePath();
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = '#7A1A20';
        ctx.stroke();
        ctx.fillStyle = '#FFFFFF';
        roundRect(ctx, -R * 0.88, -R * 0.94, R * 1.76, R * 0.26, R * 0.13);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(R * 0.97 + sway, -R * 1.08, R * 0.15, 0, TAU);
        ctx.fill();
        break;
      }
      case 'nouvelan': {
        // A striped party hat, slightly askew
        ctx.translate(R * 0.18, -R * 0.82);
        ctx.rotate(0.22);
        ctx.beginPath();
        ctx.moveTo(-R * 0.34, 0);
        ctx.lineTo(0, -R * 0.95);
        ctx.lineTo(R * 0.34, 0);
        ctx.closePath();
        ctx.fillStyle = '#7C5CFF';
        ctx.fill();
        ctx.save();
        ctx.clip();
        ctx.fillStyle = GOLD_LIGHT;
        for (let i = 0; i < 4; i++) ctx.fillRect(-R, -R * (0.12 + i * 0.24), R * 2, R * 0.1);
        ctx.restore();
        ctx.strokeStyle = GOLD_DARK;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, -R * 0.97, R * 0.12, 0, TAU);
        ctx.fillStyle = '#FF8FB1';
        ctx.fill();
        break;
      }
      case 'juillet': {
        // The tricolour cockade pinned on the laurel
        for (const [r, c] of [[0.2, '#E1000F'], [0.14, '#FFFFFF'], [0.08, '#000091']]) {
          ctx.beginPath();
          ctx.arc(R * 0.6, -R * 0.74, R * r, 0, TAU);
          ctx.fillStyle = c;
          ctx.fill();
        }
        break;
      }
      case 'halloween': {
        // A witch's hat
        ctx.fillStyle = '#2B1F3A';
        ctx.strokeStyle = '#120C1A';
        ctx.beginPath();
        ctx.moveTo(-R * 0.5, -R * 0.92);
        ctx.quadraticCurveTo(-R * 0.1, -R * 1.5, R * 0.15, -R * 1.85);
        ctx.quadraticCurveTo(R * 0.2, -R * 1.4, R * 0.5, -R * 0.92);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#F28C28';
        ctx.fillRect(-R * 0.46, -R * 1.08, R * 0.92, R * 0.12);
        ctx.fillStyle = '#2B1F3A';
        ctx.beginPath();
        ctx.ellipse(0, -R * 0.9, R * 0.95, R * 0.14, 0, 0, TAU);
        ctx.fill();
        ctx.stroke();
        break;
      }
      case 'valentin':
        heart(ctx, 0, -R * 1.02, R * 0.16 * (1 + Math.sin(s * 6) * 0.1), '#E5484D');
        break;
      case 'epiphanie': {
        // The paper crown of the galette des rois
        const g = ctx.createLinearGradient(0, -R * 1.3, 0, -R * 0.8);
        g.addColorStop(0, GOLD_LIGHT);
        g.addColorStop(1, GOLD);
        ctx.beginPath();
        ctx.moveTo(-R * 0.7, -R * 0.8);
        for (let i = 0; i <= 5; i++) {
          const x = -R * 0.7 + (i / 5) * R * 1.4;
          ctx.lineTo(x, i % 2 ? -R * 1.08 : -R * 1.32);
        }
        ctx.lineTo(R * 0.7, -R * 0.8);
        ctx.closePath();
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = GOLD_DARK;
        ctx.stroke();
        ctx.fillStyle = '#E5484D';
        for (const x of [-0.42, 0, 0.42]) {
          ctx.beginPath();
          ctx.arc(x * R, -R * 0.95, R * 0.06, 0, TAU);
          ctx.fill();
        }
        break;
      }
      case 'paques':
        // Bunny ears, one of them folded
        for (const side of [-1, 1]) {
          ctx.save();
          ctx.translate(side * R * 0.32, -R * 0.9);
          ctx.rotate(side * 0.22 + (side === 1 ? Math.sin(s * 2) * 0.05 : 0));
          ctx.beginPath();
          ctx.ellipse(0, -R * 0.42, R * 0.16, R * 0.45, 0, 0, TAU);
          ctx.fillStyle = '#FFFFFF';
          ctx.fill();
          ctx.strokeStyle = '#CFC3AE';
          ctx.stroke();
          ctx.beginPath();
          ctx.ellipse(0, -R * 0.4, R * 0.08, R * 0.32, 0, 0, TAU);
          ctx.fillStyle = '#FFB3C7';
          ctx.fill();
          ctx.restore();
        }
        break;
      default:
        break;
    }
    ctx.restore();
  }

  /** April fool: a paper fish stuck on his side. */
  drawFish(ctx, R, s) {
    ctx.save();
    ctx.translate(R * 0.66, R * 0.5);
    ctx.rotate(0.5 + Math.sin(s * 3) * 0.06);
    ctx.fillStyle = '#8FD3FF';
    ctx.strokeStyle = '#2E6F99';
    ctx.lineWidth = Math.max(0.5, R * 0.025);
    ctx.beginPath();
    ctx.ellipse(0, 0, R * 0.26, R * 0.13, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(R * 0.22, 0);
    ctx.lineTo(R * 0.4, -R * 0.12);
    ctx.lineTo(R * 0.4, R * 0.12);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(-R * 0.14, -R * 0.02, R * 0.03, 0, TAU);
    ctx.fillStyle = INK;
    ctx.fill();
    ctx.restore();
  }

  drawHalo(ctx, x, y, R, s) {
    ctx.save();
    ctx.translate(x, y + Math.sin(s * 1.2) * R * 0.05);
    ctx.shadowColor = 'rgba(248,220,108,0.9)';
    ctx.shadowBlur = R * 0.4;
    ctx.strokeStyle = `rgba(248,220,108,${0.65 + Math.sin(s * 2) * 0.25})`;
    ctx.lineWidth = Math.max(0.8, R * 0.07);
    ctx.beginPath();
    ctx.ellipse(0, 0, R * 0.55, R * 0.15, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  /** Sound coming in: golden arcs by his ear, pulsing outwards (mood 'listen'). */
  drawWaves(ctx, x, y, R, s) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(0.8, R * 0.07);
    for (let i = 0; i < 3; i++) {
      const ph = (s * 0.9 + i / 3) % 1;
      const r = R * (0.5 + ph * 0.55);
      ctx.strokeStyle = `rgba(248,220,108,${0.85 * (1 - ph)})`;
      ctx.beginPath();
      ctx.arc(x + R * 0.7, y - R * 0.2, r, -Math.PI * 0.28, Math.PI * 0.28);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** A golden magnifying glass held up in front (mood 'read'). */
  drawLens(ctx, R, s) {
    const x = R * 0.62 + Math.sin(s * 1.6) * R * 0.08;
    const y = R * 0.38 + Math.cos(s * 1.3) * R * 0.05;
    const r = R * 0.34;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = GOLD_DARK;
    ctx.lineWidth = Math.max(1, R * 0.12);
    ctx.beginPath();
    ctx.moveTo(x + r * 0.7, y + r * 0.7);
    ctx.lineTo(x + r * 1.45, y + r * 1.45);
    ctx.stroke();
    ctx.fillStyle = 'rgba(190,230,255,0.35)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = Math.max(1, R * 0.09);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = Math.max(0.6, R * 0.04);
    ctx.beginPath();
    ctx.arc(x, y, r * 0.65, Math.PI * 1.1, Math.PI * 1.45);
    ctx.stroke();
    ctx.restore();
  }

  drawDust(ctx, x, y, R, k) {
    ctx.fillStyle = `rgba(220,215,235,${(k - 0.6) * 1.6})`;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(x + side * R * (0.55 + (1 - k) * 0.3), y, R * 0.09, 0, TAU);
      ctx.fill();
    }
  }

  /** Little puffs from the head: he has been waiting for too long. */
  drawSteam(ctx, x, y, R, s) {
    for (const side of [-1, 1]) {
      for (const off of [0, 0.5]) {
        const ph = (s * 1.4 + off + (side > 0 ? 0.25 : 0)) % 1;
        const px = x + side * R * (0.85 + ph * 0.35);
        const py = y + R * 0.35 - ph * R * 0.75;
        ctx.fillStyle = `rgba(255,255,255,${0.9 * (1 - ph)})`;
        for (const [dx, dy, r] of [[0, 0, 0.09], [0.08, -0.05, 0.07], [-0.07, -0.04, 0.06]]) {
          ctx.beginPath();
          ctx.arc(px + side * dx * R, py + dy * R, R * r * (0.7 + ph * 0.8), 0, TAU);
          ctx.fill();
        }
      }
    }
  }

  /** The golden kylix of the cupbearer: 'drink' (to the mouth), 'offer', 'spin'. */
  drawCup(ctx, R, s, how) {
    ctx.save();
    if (how === 'drink') {
      ctx.translate(R * 0.18, R * 0.28);
      ctx.rotate(-0.55);
    } else if (how === 'pour') {
      // Held out to the side and tipped: the stream itself is drawn by the caller (cupLip).
      ctx.translate(R * 1.18, R * 0.3);
      ctx.rotate(0.25 + this.pourK * 1.05);
      ctx.scale(1.3, 1.3);
    } else if (how === 'spin') {
      ctx.translate(-R * 0.5, R * 0.58);
      ctx.rotate(Math.sin(s * 6) * 0.35);
    } else {
      ctx.translate(-R * 0.45, R * 0.55 + Math.sin(s * 5) * R * 0.04);
    }
    const w = R * 0.7;
    // bowl
    ctx.beginPath();
    ctx.moveTo(-w / 2, 0);
    ctx.quadraticCurveTo(0, w * 0.55, w / 2, 0);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, 0, 0, w * 0.3);
    g.addColorStop(0, GOLD_LIGHT);
    g.addColorStop(1, GOLD);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = GOLD_DARK;
    ctx.lineWidth = Math.max(0.6, R * 0.03);
    ctx.stroke();
    // ambrosia surface
    ctx.beginPath();
    ctx.ellipse(0, 0, w / 2 - R * 0.03, R * 0.05, 0, 0, TAU);
    ctx.fillStyle = '#F6B44B';
    ctx.fill();
    // stem and foot
    ctx.fillStyle = GOLD;
    ctx.fillRect(-R * 0.03, w * 0.26, R * 0.06, R * 0.18);
    ctx.beginPath();
    ctx.ellipse(0, w * 0.26 + R * 0.19, R * 0.16, R * 0.045, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  drawBowl(ctx, R, s) {
    // A small golden bowl of ambrosia held low, steaming.
    ctx.save();
    ctx.translate(0, R * 0.98);
    const w = R * 0.86;
    const h = R * 0.36;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, GOLD_LIGHT);
    g.addColorStop(1, GOLD_DARK);
    ctx.beginPath();
    ctx.moveTo(-w / 2, 0);
    ctx.bezierCurveTo(-w / 2, h * 0.9, w / 2, h * 0.9, w / 2, 0);
    ctx.closePath();
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = GOLD_DARK;
    ctx.lineWidth = Math.max(0.6, R * 0.03);
    ctx.stroke();
    // foot
    ctx.beginPath();
    ctx.ellipse(0, h * 0.72, w * 0.18, R * 0.04, 0, 0, TAU);
    ctx.fillStyle = GOLD_DARK;
    ctx.fill();
    // rim and honey-coloured ambrosia
    ctx.beginPath();
    ctx.ellipse(0, 0, w / 2, R * 0.08, 0, 0, TAU);
    ctx.fillStyle = GOLD_LIGHT;
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, R * 0.005, w / 2 - R * 0.06, R * 0.05, 0, 0, TAU);
    ctx.fillStyle = '#FFD27A';
    ctx.fill();
    // steam
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = Math.max(0.6, R * 0.03);
    for (let i = -1; i <= 1; i++) {
      const ph = (s * 0.8 + (i + 1) * 0.33) % 1;
      ctx.globalAlpha = 1 - ph;
      ctx.beginPath();
      ctx.moveTo(i * R * 0.18, -R * 0.06 - ph * R * 0.3);
      ctx.quadraticCurveTo(i * R * 0.18 + R * 0.07, -R * 0.16 - ph * R * 0.3, i * R * 0.18, -R * 0.26 - ph * R * 0.3);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  drawPuff(ctx, x, y, R, s) {
    const ph = (s * 0.7) % 1;
    ctx.fillStyle = `rgba(235,235,255,${0.7 * (1 - ph)})`;
    for (const [dx, dy, r] of [[0, 0, 0.1], [0.12, -0.04, 0.08], [0.22, 0.02, 0.06]]) {
      ctx.beginPath();
      ctx.arc(x + (dx + ph * 0.4) * R, y + (dy - ph * 0.2) * R, r * R, 0, TAU);
      ctx.fill();
    }
  }

  drawFly(ctx, cx, cy, R, s) {
    const x = cx + Math.cos(s * 2.6) * R * 1.25;
    const y = cy - R * 0.9 + Math.sin(s * 3.7) * R * 0.45;
    ctx.fillStyle = '#2A2433';
    ctx.beginPath();
    ctx.arc(x, y, R * 0.05, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(220,235,255,0.8)';
    const flap = Math.sin(s * 60) * R * 0.03;
    ctx.beginPath();
    ctx.ellipse(x - R * 0.04, y - R * 0.05 - flap, R * 0.04, R * 0.025, -0.5, 0, TAU);
    ctx.ellipse(x + R * 0.04, y - R * 0.05 - flap, R * 0.04, R * 0.025, 0.5, 0, TAU);
    ctx.fill();
  }

  drawHourglass(ctx, R, s, level) {
    const tint = { soon: GOLD_LIGHT, now: '#F2A65A', late: '#F0616D' }[level];
    const w = R * 0.62;
    const h = R * 0.86;
    const wobble = level === 'late' ? Math.sin(s * 22) * 0.18 : level === 'now' ? Math.sin(s * 9) * 0.1 : Math.sin(s * 2) * 0.05;
    ctx.save();
    ctx.translate(R * 0.42, R * 0.62);
    ctx.rotate(wobble + 0.12);
    // glass
    ctx.beginPath();
    ctx.moveTo(-w / 2, -h / 2);
    ctx.lineTo(w / 2, -h / 2);
    ctx.quadraticCurveTo(w * 0.45, -h * 0.08, w * 0.06, 0);
    ctx.quadraticCurveTo(w * 0.45, h * 0.08, w / 2, h / 2);
    ctx.lineTo(-w / 2, h / 2);
    ctx.quadraticCurveTo(-w * 0.45, h * 0.08, -w * 0.06, 0);
    ctx.quadraticCurveTo(-w * 0.45, -h * 0.08, -w / 2, -h / 2);
    ctx.closePath();
    ctx.fillStyle = 'rgba(230,240,255,0.55)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,110,140,0.8)';
    ctx.lineWidth = Math.max(0.6, R * 0.025);
    ctx.stroke();
    // sand: the top empties as the level rises
    const left = { soon: 0.6, now: 0.25, late: 0.05 }[level];
    ctx.fillStyle = tint;
    ctx.beginPath();
    const topY = -h / 2 + h * 0.48 * (1 - left);
    ctx.moveTo(-w * 0.42 * left - w * 0.04, topY);
    ctx.lineTo(w * 0.42 * left + w * 0.04, topY);
    ctx.lineTo(w * 0.05, -h * 0.03);
    ctx.lineTo(-w * 0.05, -h * 0.03);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    const pile = h * 0.42 * (1 - left * 0.8);
    ctx.moveTo(-w * 0.44, h / 2 - R * 0.02);
    ctx.quadraticCurveTo(0, h / 2 - pile * 1.4, w * 0.44, h / 2 - R * 0.02);
    ctx.closePath();
    ctx.fill();
    // falling grain
    const g = (s * 3) % 1;
    ctx.beginPath();
    ctx.arc(0, -h * 0.02 + g * h * 0.4, R * 0.025, 0, TAU);
    ctx.fill();
    // golden caps
    ctx.fillStyle = GOLD;
    ctx.strokeStyle = GOLD_DARK;
    for (const y of [-h / 2, h / 2]) {
      roundRect(ctx, -w * 0.62, y - R * 0.05, w * 1.24, R * 0.1, R * 0.04);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  drawMark(ctx, x, y, R, s, mark) {
    const k = 1 + Math.sin(s * 6) * 0.08;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(k, k);
    ctx.font = `800 ${R * 0.9}px "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = R * 0.12;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.strokeText(mark, 0, 0);
    ctx.fillStyle = this.p.markColor || GOLD_LIGHT;
    ctx.fillText(mark, 0, 0);
    ctx.restore();
  }

  drawDots(ctx, x, y, R, s) {
    for (let i = 0; i < 3; i++) {
      const a = Math.max(0, Math.sin(s * 4 - i * 0.7));
      ctx.beginPath();
      ctx.arc(x + i * R * 0.24, y - a * R * 0.1, R * 0.07, 0, TAU);
      ctx.fillStyle = `rgba(248,220,108,${0.4 + a * 0.6})`;
      ctx.fill();
    }
  }

  drawSparkles(ctx, cx, cy, R, s, n) {
    for (let i = 0; i < n; i++) {
      const a = s * 1.6 + (i / n) * TAU;
      const r = R * (1.35 + Math.sin(s * 3 + i) * 0.1);
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r * 0.75;
      const k = R * 0.09 * (0.6 + 0.4 * Math.sin(s * 7 + i * 2));
      star(ctx, x, y, k, GOLD_LIGHT);
    }
  }

  drawZzz(ctx, x, y, R, s) {
    ctx.font = `700 ${R * 0.38}px "Segoe UI", sans-serif`;
    for (let i = 0; i < 3; i++) {
      const ph = (s * 0.5 + i / 3) % 1;
      ctx.fillStyle = `rgba(230,225,255,${1 - ph})`;
      ctx.fillText('z', x + ph * R * 0.5, y - ph * R * 0.8);
    }
  }

  drawCloud(ctx, x, y, R, s) {
    x += Math.sin(s * 1.5) * R * 0.08;
    ctx.fillStyle = '#6B6880';
    for (const [dx, dy, r] of [[-0.25, 0.02, 0.2], [0, -0.06, 0.25], [0.25, 0.02, 0.2]]) {
      ctx.beginPath();
      ctx.arc(x + dx * R, y + dy * R, r * R, 0, TAU);
      ctx.fill();
    }
    if (Math.sin(s * 3) > 0.7) {
      ctx.strokeStyle = GOLD_LIGHT;
      ctx.lineWidth = Math.max(1, R * 0.06);
      ctx.beginPath();
      ctx.moveTo(x, y + R * 0.15);
      ctx.lineTo(x - R * 0.08, y + R * 0.32);
      ctx.lineTo(x + R * 0.04, y + R * 0.32);
      ctx.lineTo(x - R * 0.04, y + R * 0.5);
      ctx.stroke();
    }
  }

  drawStars(ctx, cx, cy, R, s) {
    for (let i = 0; i < 4; i++) {
      const a = s * 3 + (i / 4) * TAU;
      star(ctx, cx + Math.cos(a) * R * 0.75, cy + Math.sin(a) * R * 0.22, R * 0.1, GOLD_LIGHT);
    }
  }

  drawHearts(ctx, cx, cy, R, s) {
    for (let i = 0; i < 3; i++) {
      const ph = (s * 0.6 + i / 3) % 1;
      const x = cx + Math.sin(ph * 6 + i * 2) * R * 0.7;
      const y = cy - R * 0.9 - ph * R * 0.9;
      ctx.globalAlpha = 1 - ph;
      heart(ctx, x, y, R * 0.12, '#FF6B81');
      ctx.globalAlpha = 1;
    }
  }

  drawSweat(ctx, x, y, R, s) {
    const d = (s % 1.4) / 1.4;
    ctx.fillStyle = 'rgba(120,190,255,0.9)';
    ctx.beginPath();
    const yy = y + d * R * 0.3;
    ctx.moveTo(x, yy - R * 0.12);
    ctx.quadraticCurveTo(x + R * 0.09, yy + R * 0.02, x, yy + R * 0.05);
    ctx.quadraticCurveTo(x - R * 0.09, yy + R * 0.02, x, yy - R * 0.12);
    ctx.fill();
  }
}

function heart(ctx, x, y, k, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(0, k * 0.8);
  ctx.bezierCurveTo(-k * 1.4, -k * 0.2, -k * 0.6, -k * 1.2, 0, -k * 0.45);
  ctx.bezierCurveTo(k * 0.6, -k * 1.2, k * 1.4, -k * 0.2, 0, k * 0.8);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function star(ctx, x, y, k, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const r = i % 2 ? k * 0.35 : k;
    const a = (i / 8) * TAU;
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export const MOOD_NAMES = Object.keys(MOODS);
