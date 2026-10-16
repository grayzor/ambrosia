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

// The wardrobe (src/renderer/wardrobe.js holds the ids, labels and skins; the
// colours and proportions live here, with the drawing). Unknown ids fall back
// to the classic Ganymède.
const CLASSIC_LOOK = { head: 'laurel', glasses: 'none', wings: 'feathers', palette: 'marble', shape: 'soft', face: 'none', extra: 'none', companion: 'none' };

// body: radial gradient (light, middle, shade); rim: the glow at the bottom (r,g,b);
// wing: feather gradient; line: feather outline.
const PALETTES = {
  marble: { body: ['#FFFFFF', '#F2ECE1', '#CFC3AE'], rim: '232,185,35', wing: ['#FFFFFF', '#EDE6D6'], line: 'rgba(184,140,30,0.9)' },
  // Halloween: a mauve skin lit from below by a pumpkin glow.
  mauve: { body: ['#F6E6FF', '#CDA6EA', '#8A5DB0'], rim: '242,140,40', wing: ['#F3E4FF', '#C9A8E6'], line: 'rgba(90,50,130,0.9)' },
  mint: { body: ['#F6FFFA', '#CFF0E1', '#92C7AF'], rim: '232,185,35', wing: ['#FFFFFF', '#DDF3EA'], line: 'rgba(70,140,110,0.9)' },
  sky: { body: ['#F6FBFF', '#D0E6F7', '#92B6D4'], rim: '150,200,255', wing: ['#FFFFFF', '#DCEBF7'], line: 'rgba(70,110,160,0.9)' },
  rose: { body: ['#FFF6F9', '#F8D4E0', '#D99AB0'], rim: '232,185,35', wing: ['#FFFFFF', '#F7DDE6'], line: 'rgba(170,80,110,0.9)' },
  gold: { body: ['#FFF9DE', '#F3D98A', '#C79A30'], rim: '255,240,190', wing: ['#FFFBEA', '#F3DE9A'], line: 'rgba(156,116,16,0.95)' },
  night: { body: ['#DCDDFF', '#9C9FDC', '#5C5FA0'], rim: '150,170,255', wing: ['#E9EAFF', '#B3B6E8'], line: 'rgba(60,60,120,0.9)' },
};

// The superellipse of the body: exponent, half-width at the top / bottom, half-height.
const SHAPES = {
  soft: { n: 2.6, top: 1.0, bottom: 1.06, ry: 0.97 },
  round: { n: 2.0, top: 1.0, bottom: 1.02, ry: 1.0 },
  pear: { n: 2.3, top: 0.88, bottom: 1.16, ry: 0.98 },
  cube: { n: 4.4, top: 1.0, bottom: 1.0, ry: 0.92 },
};

// Occasions (logic.occasion) that put a hat on: over the laurel as before,
// instead of any other headwear.
const HAT_OCCASIONS = ['noel', 'nouvelan', 'halloween', 'epiphanie', 'paques'];

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
    this.wardrobe = { ...CLASSIC_LOOK };
  }

  /**
   * The wardrobe: { head, glasses, wings, palette, shape, face, extra, companion }
   * as resolved by src/renderer/wardrobe.js (resolve().slots). Missing or unknown
   * values keep the classic Ganymède.
   */
  setLook(slots) {
    const next = { ...CLASSIC_LOOK, ...(slots || {}) };
    if (!PALETTES[next.palette]) next.palette = CLASSIC_LOOK.palette;
    if (!SHAPES[next.shape]) next.shape = CLASSIC_LOOK.shape;
    this.wardrobe = next;
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

    const L = this.wardrobe;
    const pal = PALETTES[L.palette] || PALETTES.marble;
    // Companions stay out of the tiny sizes (tray, notch): too busy there.
    const companions = S >= 48 && L.companion !== 'none' ? L.companion : null;
    if (companions) this.drawCompanions(ctx, cx, cy, R, s, companions, 'back');
    if (p.halo) this.drawHalo(ctx, cx, cy - R * 1.12, R, s);
    if (tap > 0.6) this.drawDust(ctx, cx, cy + R * 0.98, R, tap);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(tilt);
    ctx.scale((1 + sq * 0.12) * (1 - reach * 0.06), (1 - sq * 0.12) * breathe * (1 + reach * 0.1));

    if (L.extra === 'cape') this.drawCape(ctx, R, s);
    this.drawWings(ctx, R, s, p, pal);
    this.drawBody(ctx, R, pal);
    if (this.outfit === 'avril') this.drawFish(ctx, R, s);
    ctx.save();
    if (p.crownWiggle) ctx.rotate(Math.sin(s * 7) * 0.08);
    // A holiday's hat sits on the laurel, or replaces any other headwear; on
    // Halloween, horns or a witch's hat already do the job.
    const occ = this.outfit;
    const spooky = occ === 'halloween' && ['horns', 'witch'].includes(L.head);
    if (!(occ && HAT_OCCASIONS.includes(occ) && L.head !== 'laurel' && !spooky)) this.drawHead(ctx, R, s, L.head);
    if (occ === 'weekend') {
      if (L.head === 'laurel') this.drawFlowers(ctx, R);
    } else if (occ && !spooky) this.drawOccasion(ctx, R, s, occ);
    ctx.restore();
    this.drawFace(ctx, R, s, p, blinkK);
    if (L.extra === 'bowtie' || L.extra === 'scarf') this.drawNeckwear(ctx, R, s, L.extra);
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
    if (companions) this.drawCompanions(ctx, cx, cy, R, s, companions, 'front');
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
    // A soft superellipse, a touch wider at the bottom (the shape slot changes it).
    const sh = SHAPES[this.wardrobe.shape] || SHAPES.soft;
    ctx.beginPath();
    const n = sh.n;
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * TAU;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const rx = R * (sa > 0 ? sh.bottom : sh.top);
      const ry = R * sh.ry;
      const x = Math.sign(ca) * Math.pow(Math.abs(ca), 2 / n) * rx;
      const y = Math.sign(sa) * Math.pow(Math.abs(sa), 2 / n) * ry;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  drawBody(ctx, R, pal = PALETTES.marble) {
    const g = ctx.createRadialGradient(-R * 0.35, -R * 0.45, R * 0.1, 0, 0, R * 1.25);
    g.addColorStop(0, pal.body[0]);
    g.addColorStop(0.55, pal.body[1]);
    g.addColorStop(1, pal.body[2]);
    this.bodyPath(ctx, R);
    ctx.fillStyle = g;
    ctx.fill();
    // golden rim light, the ambrosia glow
    ctx.save();
    this.bodyPath(ctx, R);
    ctx.clip();
    const rim = ctx.createLinearGradient(0, R, 0, R * 0.2);
    rim.addColorStop(0, `rgba(${pal.rim},0.45)`);
    rim.addColorStop(1, `rgba(${pal.rim},0)`);
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

  drawWings(ctx, R, s, p, pal = PALETTES.marble) {
    const kind = this.wardrobe.wings;
    if (kind === 'none') return;
    const flap = Math.sin(s * p.wingSpeed) * p.wingAmp;
    for (const side of [-1, 1]) {
      let a = -flap + this.wingLiftNow;
      if (p.wave && side === 1) a = Math.sin(s * 9) * 0.6 + 0.4;
      ctx.save();
      ctx.translate(side * R * 0.88, -R * 0.12);
      ctx.scale(side, 1);
      ctx.rotate(-a);
      if (kind === 'bat') {
        this.drawBatWing(ctx, R);
        ctx.restore();
        continue;
      }
      if (kind === 'butterfly') {
        this.drawButterflyWing(ctx, R, s);
        ctx.restore();
        continue;
      }
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
        wg.addColorStop(0, pal.wing[0]);
        wg.addColorStop(1, pal.wing[1]);
        ctx.fillStyle = wg;
        ctx.fill();
        ctx.strokeStyle = pal.line;
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

    // Glasses of the wardrobe; else the weekend shades, over open eyes only
    // (and with the laurel: they go with the flower crown).
    if (this.wardrobe.glasses !== 'none') this.drawGlasses(ctx, R, lx, ly, this.wardrobe.glasses, s);
    else if (this.outfit === 'weekend' && this.wardrobe.head === 'laurel' && !['closed', 'happy', 'spiral', 'heart', 'squint'].includes(p.eye)) this.drawSunglasses(ctx, R, lx, ly);
    if (this.wardrobe.face === 'freckles') this.drawFreckles(ctx, R, lx);

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
    if (this.wardrobe.face === 'fangs') this.drawFangs(ctx, R, mx, my, p.mouth);
    if (this.wardrobe.face === 'mustache') this.drawMustache(ctx, R, mx, my);
  }

  // ── Wardrobe (src/renderer/wardrobe.js) ──────────────────────────────────

  /** The head slot: laurel, horns, witch, beanie, flowers, none. */
  drawHead(ctx, R, s, kind) {
    switch (kind) {
      case 'horns':
        return this.drawHorns(ctx, R, s);
      case 'witch':
        return this.drawWitchHat(ctx, R, s);
      case 'beanie':
        return this.drawBeanie(ctx, R, s);
      case 'flowers':
        // a green vine under the flowers
        ctx.save();
        ctx.strokeStyle = '#5E9E5A';
        ctx.lineWidth = Math.max(0.6, R * 0.04);
        ctx.beginPath();
        ctx.arc(0, 0, R * 0.92, -2.55, -0.59);
        ctx.stroke();
        ctx.restore();
        return this.drawFlowers(ctx, R);
      case 'none':
        return undefined;
      default:
        return this.drawWreath(ctx, R);
    }
  }

  /** Two little curved horns, a touch of crimson. */
  drawHorns(ctx, R, s) {
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(side * R * 0.44, -R * 0.78);
      ctx.scale(side, 1);
      ctx.rotate(0.32 + Math.sin(s * 1.3) * 0.015);
      const w = R * 0.13;
      const h = R * 0.5;
      const g = ctx.createLinearGradient(0, 0, 0, -h);
      g.addColorStop(0, '#9E2B4E');
      g.addColorStop(0.7, '#5A1330');
      g.addColorStop(1, '#2A0717');
      ctx.beginPath();
      ctx.moveTo(-w, R * 0.04);
      ctx.quadraticCurveTo(-w * 0.9, -h * 0.55, R * 0.16, -h);
      ctx.quadraticCurveTo(w * 1.1, -h * 0.5, w, R * 0.04);
      ctx.closePath();
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = '#22050F';
      ctx.lineWidth = Math.max(0.5, R * 0.025);
      ctx.stroke();
      // ridges and a glint
      ctx.strokeStyle = 'rgba(255,190,210,0.35)';
      ctx.lineWidth = Math.max(0.5, R * 0.018);
      for (const k of [0.25, 0.5]) {
        ctx.beginPath();
        ctx.moveTo(-w * (1 - k * 0.7), -h * k);
        ctx.quadraticCurveTo(0, -h * k + R * 0.035, w * (1 - k * 0.5), -h * k - R * 0.02);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  drawWitchHat(ctx, R) {
    ctx.save();
    ctx.lineWidth = Math.max(0.6, R * 0.03);
    ctx.lineJoin = 'round';
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
    ctx.restore();
  }

  /** A knitted beanie with its pompom. */
  drawBeanie(ctx, R, s) {
    ctx.save();
    ctx.lineWidth = Math.max(0.5, R * 0.025);
    const g = ctx.createLinearGradient(0, -R * 1.35, 0, -R * 0.7);
    g.addColorStop(0, '#F0616D');
    g.addColorStop(1, '#B3262C');
    ctx.beginPath();
    ctx.moveTo(-R * 0.84, -R * 0.68);
    ctx.bezierCurveTo(-R * 0.86, -R * 1.42, R * 0.86, -R * 1.42, R * 0.84, -R * 0.68);
    ctx.closePath();
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = '#7A1A20';
    ctx.stroke();
    // the cuff, ribbed
    ctx.fillStyle = '#FFF4E6';
    roundRect(ctx, -R * 0.9, -R * 0.84, R * 1.8, R * 0.24, R * 0.1);
    ctx.fill();
    ctx.strokeStyle = 'rgba(160,120,90,0.45)';
    ctx.stroke();
    ctx.beginPath();
    for (let i = -6; i <= 6; i++) {
      ctx.moveTo(i * R * 0.13, -R * 0.81);
      ctx.lineTo(i * R * 0.13, -R * 0.63);
    }
    ctx.stroke();
    // pompom, wobbling a little
    ctx.beginPath();
    ctx.arc(Math.sin(s * 2) * R * 0.03, -R * 1.3, R * 0.17, 0, TAU);
    ctx.fillStyle = '#FFF4E6';
    ctx.fill();
    ctx.restore();
  }

  /** Bat wing, in the wing's frame (attached at 0,0, spreading towards +x). */
  drawBatWing(ctx, R) {
    const L = R * 0.92;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -R * 0.06);
    ctx.quadraticCurveTo(L * 0.2, -L * 0.55, L * 0.52, -L * 0.5); // up to the wrist
    ctx.quadraticCurveTo(L * 0.8, -L * 0.48, L, -L * 0.22); // to the tip
    // the scalloped trailing edge
    ctx.quadraticCurveTo(L * 0.8, -L * 0.14, L * 0.72, L * 0.06);
    ctx.quadraticCurveTo(L * 0.56, -L * 0.04, L * 0.44, L * 0.14);
    ctx.quadraticCurveTo(L * 0.28, L * 0.04, L * 0.16, L * 0.16);
    ctx.quadraticCurveTo(L * 0.06, L * 0.08, 0, R * 0.06);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, -L * 0.5, L, L * 0.1);
    g.addColorStop(0, '#4A2C66');
    g.addColorStop(1, '#22143A');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = '#120820';
    ctx.lineWidth = Math.max(0.6, R * 0.03);
    ctx.stroke();
    // finger bones from the wrist
    ctx.strokeStyle = 'rgba(190,150,230,0.55)';
    ctx.lineWidth = Math.max(0.5, R * 0.02);
    ctx.beginPath();
    for (const [x, y] of [[L, -L * 0.22], [L * 0.72, L * 0.06], [L * 0.44, L * 0.14]]) {
      ctx.moveTo(L * 0.52, -L * 0.5);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    // the little claw
    ctx.fillStyle = '#120820';
    ctx.beginPath();
    ctx.moveTo(L * 0.5, -L * 0.5);
    ctx.lineTo(L * 0.54, -L * 0.62);
    ctx.lineTo(L * 0.58, -L * 0.49);
    ctx.fill();
    ctx.restore();
  }

  /** Butterfly wing, same frame as the bat's. */
  drawButterflyWing(ctx, R, s) {
    ctx.save();
    const shimmer = 0.5 + Math.sin(s * 2) * 0.1;
    for (const [x, y, rx, ry, rot, c0, c1] of [
      [0.4, -0.28, 0.4, 0.27, -0.55, '#FFD1E1', '#FF8FB1'],
      [0.3, 0.14, 0.25, 0.17, 0.45, '#E3D6FF', '#B79CFF'],
    ]) {
      ctx.beginPath();
      ctx.ellipse(R * x, R * y, R * rx, R * ry, rot, 0, TAU);
      const g = ctx.createRadialGradient(R * x * 0.4, R * y * 0.4, R * 0.05, R * x, R * y, R * rx);
      g.addColorStop(0, c0);
      g.addColorStop(1, c1);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = 'rgba(120,70,120,0.7)';
      ctx.lineWidth = Math.max(0.5, R * 0.022);
      ctx.stroke();
    }
    ctx.fillStyle = `rgba(255,255,255,${shimmer})`;
    for (const [x, y, r] of [[0.55, -0.36, 0.07], [0.36, -0.2, 0.045], [0.38, 0.17, 0.05]]) {
      ctx.beginPath();
      ctx.arc(R * x, R * y, R * r, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  /** The glasses slot, drawn over the eyes whatever they do. */
  drawGlasses(ctx, R, lx, ly, kind) {
    if (kind === 'sun') return this.drawSunglasses(ctx, R, lx, ly);
    const ey = -R * 0.02 + ly;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (kind === 'monocle') {
      const x = R * 0.36 + lx;
      ctx.beginPath();
      ctx.arc(x, ey, R * 0.21, 0, TAU);
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fill();
      ctx.strokeStyle = GOLD_DARK;
      ctx.lineWidth = Math.max(0.8, R * 0.05);
      ctx.stroke();
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = Math.max(0.5, R * 0.022);
      ctx.beginPath();
      ctx.moveTo(x + R * 0.15, ey + R * 0.15);
      ctx.quadraticCurveTo(x + R * 0.35, ey + R * 0.55, x + R * 0.12, ey + R * 0.72);
      ctx.stroke();
      ctx.restore();
      return;
    }
    const frame = kind === 'square' ? INK : kind === 'heart' ? '#D6336C' : GOLD_DARK;
    ctx.strokeStyle = frame;
    ctx.lineWidth = Math.max(0.8, R * (kind === 'square' ? 0.055 : 0.042));
    for (const side of [-1, 1]) {
      const x = side * R * 0.36 + lx;
      ctx.beginPath();
      if (kind === 'square') roundRect(ctx, x - R * 0.2, ey - R * 0.15, R * 0.4, R * 0.3, R * 0.06);
      else if (kind === 'heart') heartPath(ctx, x, ey + R * 0.02, R * 0.2);
      else ctx.arc(x, ey, R * 0.19, 0, TAU);
      ctx.fillStyle = kind === 'heart' ? 'rgba(255,120,160,0.28)' : 'rgba(255,255,255,0.18)';
      ctx.fill();
      ctx.stroke();
      // the temple, towards the ear
      ctx.beginPath();
      ctx.moveTo(x + side * R * 0.19, ey - R * 0.04);
      ctx.lineTo(x + side * R * 0.34, ey - R * 0.08);
      ctx.stroke();
    }
    // the bridge
    ctx.beginPath();
    ctx.moveTo(-R * 0.17 + lx, ey - R * 0.02);
    ctx.quadraticCurveTo(lx, ey - R * 0.1, R * 0.17 + lx, ey - R * 0.02);
    ctx.stroke();
    ctx.restore();
  }

  drawFreckles(ctx, R, lx) {
    ctx.save();
    ctx.fillStyle = 'rgba(170,100,70,0.6)';
    for (const side of [-1, 1]) {
      for (const [dx, dy] of [[-0.06, -0.03], [0.03, -0.05], [0.07, 0.02], [-0.02, 0.03]]) {
        ctx.beginPath();
        ctx.arc(side * R * 0.58 + lx * 0.3 + side * dx * R, R * 0.24 + dy * R, Math.max(0.5, R * 0.022), 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /** Two little vampire fangs, hanging from the top of the mouth. */
  drawFangs(ctx, R, mx, my, mouth) {
    const top = { smile: 0.045, flat: 0.02, grin: -0.015, o: -0.03, frown: 0.03, pout: 0.03, wavy: 0.02, talk: 0.0, yawn: -0.07 }[mouth] ?? 0.045;
    const spread = mouth === 'grin' ? 0.075 : mouth === 'yawn' ? 0.06 : 0.05;
    ctx.save();
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(0.4, R * 0.014);
    ctx.lineJoin = 'round';
    for (const side of [-1, 1]) {
      const x = mx + side * R * spread;
      const y = my + R * top;
      ctx.beginPath();
      ctx.moveTo(x - R * 0.026, y);
      ctx.lineTo(x + R * 0.026, y);
      ctx.lineTo(x + side * R * 0.004, y + R * 0.075);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  drawMustache(ctx, R, mx, my) {
    ctx.save();
    ctx.fillStyle = '#4A3426';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(mx, my - R * 0.06);
      ctx.bezierCurveTo(mx + side * R * 0.08, my - R * 0.13, mx + side * R * 0.18, my - R * 0.05, mx + side * R * 0.23, my - R * 0.12);
      ctx.bezierCurveTo(mx + side * R * 0.22, my - R * 0.01, mx + side * R * 0.08, my - R * 0.0, mx, my - R * 0.03);
      ctx.fill();
    }
    ctx.restore();
  }

  /** A vampire's cape, behind him: the tall collar shows beside the head. */
  drawCape(ctx, R, s) {
    const sway = Math.sin(s * 1.4) * R * 0.03;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(0.6, R * 0.03);
    // the cloak
    ctx.beginPath();
    ctx.moveTo(-R * 0.75, -R * 0.3);
    ctx.lineTo(-R * 1.2 - sway, R * 1.0);
    for (let i = 0; i < 4; i++) {
      const x0 = -R * 1.2 + (i / 4) * R * 2.4;
      ctx.quadraticCurveTo(x0 + R * 0.3, R * 0.9, x0 + R * 0.6 + (i === 3 ? sway : 0), R * 1.04);
    }
    ctx.lineTo(R * 0.75, -R * 0.3);
    ctx.closePath();
    ctx.fillStyle = '#1C1226';
    ctx.fill();
    ctx.strokeStyle = '#0B0612';
    ctx.stroke();
    // the collar, black outside and red inside
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(side * R * 0.3, -R * 0.55);
      ctx.lineTo(side * R * 1.2, -R * 0.82);
      ctx.lineTo(side * R * 1.02, -R * 0.12);
      ctx.closePath();
      ctx.fillStyle = '#1C1226';
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(side * R * 0.42, -R * 0.53);
      ctx.lineTo(side * R * 1.1, -R * 0.74);
      ctx.lineTo(side * R * 0.95, -R * 0.24);
      ctx.closePath();
      ctx.fillStyle = '#B3262C';
      ctx.fill();
    }
    ctx.restore();
  }

  /** Bow tie or scarf, low on the body. */
  drawNeckwear(ctx, R, s, kind) {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(0.5, R * 0.022);
    if (kind === 'bowtie') {
      const y = R * 0.66;
      ctx.fillStyle = '#2B3A8F';
      ctx.strokeStyle = '#151D4A';
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(side * R * 0.22, y - R * 0.12);
        ctx.quadraticCurveTo(side * R * 0.27, y, side * R * 0.22, y + R * 0.12);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      roundRect(ctx, -R * 0.05, y - R * 0.06, R * 0.1, R * 0.12, R * 0.03);
      ctx.fill();
      ctx.stroke();
    } else {
      // scarf: a striped band hugging the body, a tail on the side
      ctx.save();
      this.bodyPath(ctx, R);
      ctx.clip();
      ctx.fillStyle = '#E5484D';
      ctx.fillRect(-R * 1.3, R * 0.5, R * 2.6, R * 0.22);
      ctx.fillStyle = '#FFF4E6';
      for (let i = -6; i <= 6; i += 2) ctx.fillRect(i * R * 0.14, R * 0.5, R * 0.07, R * 0.22);
      ctx.restore();
      ctx.save();
      ctx.translate(R * 0.5, R * 0.62);
      ctx.rotate(-0.15 + Math.sin(s * 1.8) * 0.05);
      ctx.fillStyle = '#E5484D';
      roundRect(ctx, 0, 0, R * 0.2, R * 0.5, R * 0.05);
      ctx.fill();
      ctx.fillStyle = '#FFF4E6';
      ctx.fillRect(0, R * 0.14, R * 0.2, R * 0.06);
      ctx.fillRect(0, R * 0.3, R * 0.2, R * 0.06);
      ctx.restore();
    }
    ctx.restore();
  }

  /**
   * Companions, in screen space: two bats circling (behind him on the far half
   * of the loop), a floating jack-o'-lantern, or fireflies.
   */
  drawCompanions(ctx, cx, cy, R, s, kind, layer) {
    ctx.save();
    if (kind === 'bats') {
      for (let i = 0; i < 2; i++) {
        const a = s * 0.8 + i * Math.PI;
        const front = Math.sin(a) > 0;
        if ((layer === 'front') !== front) continue;
        const x = cx + Math.cos(a) * R * 1.55;
        // the near half of the loop passes high, over the horns, never on his face
        const y = cy - R * 1.2 - Math.sin(a) * R * 0.28 + Math.sin(s * 5 + i) * R * 0.05;
        const k = R * (front ? 0.17 : 0.12);
        const flap = Math.sin(s * 16 + i * 2);
        ctx.fillStyle = front ? '#2A1838' : 'rgba(42,24,56,0.7)';
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.quadraticCurveTo(x + side * k * 0.8, y - k * (0.9 * flap + 0.2), x + side * k * 1.6, y - k * 0.2 * flap);
          ctx.quadraticCurveTo(x + side * k * 1.1, y + k * 0.15, x + side * k * 0.9, y + k * 0.35);
          ctx.quadraticCurveTo(x + side * k * 0.55, y + k * 0.15, x, y + k * 0.3);
          ctx.fill();
        }
        ctx.beginPath();
        ctx.ellipse(x, y + k * 0.1, k * 0.32, k * 0.4, 0, 0, TAU);
        ctx.fill();
        // two ears
        ctx.beginPath();
        ctx.moveTo(x - k * 0.25, y - k * 0.2);
        ctx.lineTo(x - k * 0.18, y - k * 0.55);
        ctx.lineTo(x - k * 0.05, y - k * 0.25);
        ctx.moveTo(x + k * 0.25, y - k * 0.2);
        ctx.lineTo(x + k * 0.18, y - k * 0.55);
        ctx.lineTo(x + k * 0.05, y - k * 0.25);
        ctx.fill();
        if (front) {
          ctx.fillStyle = '#F8DC6C';
          for (const side of [-1, 1]) {
            ctx.beginPath();
            ctx.arc(x + side * k * 0.12, y, Math.max(0.5, k * 0.07), 0, TAU);
            ctx.fill();
          }
        }
      }
    } else if (kind === 'pumpkin' && layer === 'front') {
      const x = cx - R * 1.32;
      const y = cy + R * 0.7 + Math.sin(s * 2.2) * R * 0.06;
      const k = R * 0.3;
      ctx.translate(x, y);
      ctx.rotate(Math.sin(s * 1.5) * 0.08);
      ctx.shadowColor = 'rgba(242,140,40,0.7)';
      ctx.shadowBlur = k * 0.8;
      for (const [dx, rx] of [[-0.45, 0.55], [0.45, 0.55], [0, 0.6]]) {
        ctx.beginPath();
        ctx.ellipse(dx * k, 0, rx * k, k * 0.82, 0, 0, TAU);
        ctx.fillStyle = dx ? '#D96A12' : '#F28C28';
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#4E7A2E';
      ctx.fillRect(-k * 0.08, -k * 1.05, k * 0.16, k * 0.3);
      // a carved face, lit from inside
      ctx.fillStyle = `rgba(255,${200 + Math.round(Math.sin(s * 9) * 30)},90,1)`;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(side * k * 0.42, -k * 0.12);
        ctx.lineTo(side * k * 0.18, -k * 0.12);
        ctx.lineTo(side * k * 0.3, -k * 0.38);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.moveTo(-k * 0.45, k * 0.15);
      ctx.quadraticCurveTo(0, k * 0.6, k * 0.45, k * 0.15);
      ctx.quadraticCurveTo(0, k * 0.35, -k * 0.45, k * 0.15);
      ctx.fill();
    } else if (kind === 'fireflies' && layer === 'front') {
      for (let i = 0; i < 5; i++) {
        const x = cx + Math.sin(s * (0.5 + i * 0.13) + i * 2.1) * R * 1.5;
        const y = cy - R * 0.2 + Math.cos(s * (0.4 + i * 0.11) + i * 1.3) * R * 0.95;
        const glow = 0.4 + 0.6 * Math.max(0, Math.sin(s * 2.4 + i * 1.7));
        ctx.shadowColor = `rgba(220,255,120,${glow})`;
        ctx.shadowBlur = R * 0.25;
        ctx.fillStyle = `rgba(230,255,150,${glow})`;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0.8, R * 0.045), 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
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
      case 'halloween':
        this.drawWitchHat(ctx, R);
        break;
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

/** The outline of a heart (for frames: fill and stroke it yourself). */
function heartPath(ctx, x, y, k) {
  ctx.moveTo(x, y + k * 0.8);
  ctx.bezierCurveTo(x - k * 1.4, y - k * 0.2, x - k * 0.6, y - k * 1.2, x, y - k * 0.45);
  ctx.bezierCurveTo(x + k * 0.6, y - k * 1.2, x + k * 1.4, y - k * 0.2, x, y + k * 0.8);
  ctx.closePath();
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
