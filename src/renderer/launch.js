// Gany's entrance, when Ambrosia starts: « l'ouverture du temple ».
//
//   0.0 s  the notch unfolds into a wide card, with an overshoot
//   0.1 s  two temple doors slide apart and become columns; light leaks through
//   0.4 s  nectar rains down a column of light; Gany flies down it
//   0.95 s he lands (squash, stretch), a ring of gold dust bursts
//   1.3 s  he glides aside, « Χαῖρε ! » writes itself in gold
//   1.75 s he tips his kylix: the ambrosia runs into the meander frieze
//   2.5 s  a little bow
//   2.9 s  everything folds back into the notch with a spring, Gany flies to his seat
//
// The short version (a restart the same day) keeps the bounce, the drop and a wink.
// Everything is drawn on one overlay canvas (no image), at 60 fps, only while it
// plays; the island keeps its own shape (CSS variables), driven frame by frame.
// Hovering the island or an alert arriving folds it at once (interrupt()).

import { Gany } from './gany.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
const lerp = (a, b, k) => a + (b - a) * k;
const out = (k) => 1 - (1 - k) ** 3;
const easeIn = (k) => k * k * k;
const inOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
const back = (k, c = 1.70158) => 1 + (c + 1) * (k - 1) ** 3 + c * (k - 1) ** 2;
/** A damped spring from 0 to 1: one clear overshoot, then rest. */
const spring = (k) => (k >= 1 ? 1 : 1 - Math.exp(-5.5 * k) * Math.cos(2.6 * Math.PI * k));
const pulse = (t, a, b) => (t > a && t < b ? Math.sin(Math.PI * seg(t, a, b)) : 0);

const GOLD = '#E8B923';
const GOLD_LIGHT = '#F8DC6C';

// Seeded, so every launch looks the same (and screenshots compare).
function rng(seed) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}
const R = rng(7);
const RAIN = Array.from({ length: 46 }, () => ({ x: R() * 2 - 1, v: 380 + R() * 260, len: 10 + R() * 22, w: 1 + R() * 1.2, a: 0.35 + R() * 0.55, t0: R() * 0.45 }));
const RING = Array.from({ length: 84 }, () => ({ a: R() * TAU, j: (R() - 0.5) * 0.25, s: 1 + R() * 1.6, al: 0.45 + R() * 0.55 }));
const STARS = Array.from({ length: 34 }, () => ({ x: R(), y: R(), s: 0.6 + R() * 1.1, ph: R() * TAU }));
const SPLASH = Array.from({ length: 9 }, () => ({ vx: (R() - 0.5) * 70, vy: -40 - R() * 60, ph: R() }));

const FULL = {
  W: 540, H: 156, Rr: 30, G: 100,
  expand: [0, 0.55], doors: [0.12, 0.8], descend: [0.42, 0.95], land: 0.95,
  glide: [1.3, 1.75], pour: [1.72, 2.5], stream: [1.86, 2.48], title: [1.5, 2.0], sub: [1.85, 2.25],
  bow: [2.5, 2.85], tc: 2.95, collapse: 0.7,
};
const SHORT = {
  W: 320, H: 80, Rr: 24, G: 62,
  expand: [0, 0.36], descend: [0.1, 0.4], land: 0.4,
  title: [0.45, 0.75], sub: [0.6, 0.9], tc: 1.25, collapse: 0.45,
};

export class Launch {
  /**
   * @param {object} o
   * @param {HTMLElement} o.island   the island element (its --w/--h/--r are driven)
   * @param {'full'|'short'} o.kind
   * @param {() => {w,h,r,gx,gy,gs,hidden}} o.rest  where the island and Gany settle
   * @param {{outfit, energy}} o.dress
   * @param {{title, sub}} o.words
   * @param {() => void} o.onDone
   */
  constructor({ island, kind = 'full', rest, dress = {}, words = {}, onDone }) {
    this.island = island;
    this.kind = kind;
    this.T = kind === 'short' ? SHORT : FULL;
    this.restOf = rest;
    this.onDone = onDone;
    this.words = { title: words.title || 'Χαῖρε !', sub: words.sub || 'Gany est à ton service.' };
    this.tc = this.T.tc;
    this.active = true;
    const r = island.getBoundingClientRect();
    this.X0 = r.left + r.width / 2;
    this.Y0 = r.top;
    this.start = { w: r.width, h: r.height, r: parseFloat(getComputedStyle(island).getPropertyValue('--r')) || 14 };
    this.rest = null;

    this.canvas = document.getElementById('launch') || document.body.appendChild(Object.assign(document.createElement('canvas'), { id: 'launch' }));
    this.canvas.style.display = 'block';
    this.ctx = this.canvas.getContext('2d');
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = innerWidth * this.dpr;
    this.canvas.height = innerHeight * this.dpr;

    this.off = document.createElement('canvas');
    this.off.width = this.off.height = Math.ceil(this.T.G * this.dpr) + 2;
    this.offCtx = this.off.getContext('2d');
    this.gany = new Gany(this.off);
    this.gany.setOutfit(dress.outfit);
    this.gany.setLook(dress.look);
    this.gany.setEnergy(dress.energy);
    this.frieze = this.kind === 'full' ? this.makeFrieze() : null;

    island.classList.add('launching');
    this.t0 = performance.now();
    this.frame = this.frame.bind(this);
    requestAnimationFrame(this.frame);
  }

  get elapsed() {
    return (performance.now() - this.t0) / 1000;
  }

  /** Fold now (pointer on the island, an alert to show). */
  interrupt() {
    const t = this.elapsed;
    if (t < this.tc) this.tc = Math.max(0, t);
  }

  // ── Choreography ─────────────────────────────────────────────────────────

  /** Everything at time t, before the fold. Pure in t. */
  pose(t) {
    const T = this.T;
    const full = this.kind === 'full';
    const { X0, Y0 } = this;
    const p = {};
    // Island: grows with an overshoot, height a hair behind the width.
    const ew = back(seg(t, T.expand[0], T.expand[1]), 1.4);
    const eh = back(seg(t, T.expand[0] + 0.04, T.expand[1] + 0.04), 1.6);
    p.w = lerp(this.start.w, T.W, ew);
    p.h = Math.max(4, lerp(this.start.h, T.H, eh));
    p.r = lerp(this.start.r, T.Rr, seg(t, 0, T.expand[1]));

    // Gany: from above the screen edge, down the column of light.
    const restX = full ? X0 : X0 - T.W / 2 + 48;
    const restY = Y0 + (full ? 76 : 41);
    const landY = restY + T.G * 0.06;
    const d = T.descend;
    let x = restX;
    let y;
    if (t < d[0]) y = Y0 - T.G;
    else if (t < d[1]) y = lerp(Y0 - T.G * 0.7, landY, easeIn(seg(t, d[0], d[1])));
    else if (t < d[1] + 0.14) y = lerp(landY, restY - T.G * 0.13, out(seg(t, d[1], d[1] + 0.14)));
    else y = lerp(restY - T.G * 0.13, restY, inOut(seg(t, d[1] + 0.14, d[1] + 0.34)));
    let size = T.G * lerp(0.4, 1, back(seg(t, d[0], d[1] - 0.1)));
    let sx = 1;
    let sy = 1;
    // landing squash, then the stretch of the rebound
    const sq = pulse(t, T.land - 0.07, T.land + 0.08);
    const st = pulse(t, T.land + 0.03, T.land + 0.22);
    sx += 0.16 * sq - 0.1 * st;
    sy += -0.16 * sq + 0.15 * st;
    let rot = t < d[1] ? Math.sin(t * 9) * 0.05 : 0;
    let mood = t < T.land ? 'soar' : 'greet';
    let look = { x: 0, y: t < T.land ? 0.9 : 0.1 };
    if (full) {
      // glide to the left, leaning into it
      const g = inOut(seg(t, T.glide[0], T.glide[1]));
      x = lerp(restX, X0 - 165, g);
      rot += -0.12 * pulse(t, T.glide[0], T.glide[1]);
      if (t >= T.glide[0] && t < T.glide[1]) look = { x: -0.8, y: 0 };
      // pour
      if (t >= T.pour[0] && t < T.pour[1]) {
        mood = 'pour';
        look = { x: 0.7, y: 0.6 };
      }
      this.gany.pourK = Math.min(out(seg(t, T.pour[0], T.stream[0])), 1 - inOut(seg(t, T.stream[1] - 0.1, T.pour[1])));
      // bow
      const bw = pulse(t, T.bow[0], T.bow[1]);
      if (t >= T.bow[0]) {
        mood = 'greet';
        look = { x: 0.1, y: 0.25 };
      }
      rot += 0.22 * bw;
      y += bw * T.G * 0.06;
      sy -= 0.06 * bw;
    } else {
      if (t > T.land + 0.25) mood = 'wink';
    }
    Object.assign(p, { x, y, size, sx, sy, rot, mood, look });

    // Light, doors, rain, words
    // the column of light follows Gany when he glides aside, and dims
    p.beamX = x;
    p.beam = full
      ? 0.35 * seg(t, 0.2, 0.45) * (1 - seg(t, 1.1, 1.7)) + 0.65 * pulse(t, 0.4, 1.4) + 0.12 * seg(t, 1.2, 1.6) * (1 - seg(t, 2.2, 2.9))
      : 0.9 * pulse(t, 0.05, 0.75);
    p.doors = full ? inOut(seg(t, T.doors[0], T.doors[1])) : 1;
    p.title = seg(t, T.title[0], T.title[1]);
    p.shimmer = full ? seg(t, T.title[1], T.title[1] + 0.55) : seg(t, T.title[1], T.title[1] + 0.4);
    p.sub = seg(t, T.sub[0], T.sub[1]);
    p.frieze = full ? out(seg(t, T.stream[0] + 0.08, T.stream[1] + 0.25)) : 0;
    p.decor = 1;
    p.glow = 0;
    return p;
  }

  /** The fold: from pose(tc) to the island's resting shape, on a spring. */
  fold(t) {
    if (!this.rest) {
      this.rest = this.restOf();
      // The resting Gany's anchor (body centre) in viewport coordinates.
      const left = this.X0 - this.rest.w / 2;
      this.rest.ax = left + this.rest.gx + this.rest.gs / 2;
      this.rest.ay = this.Y0 + this.rest.gy + this.rest.gs * 0.56;
    }
    const a = this.pose(this.tc);
    const rs = this.rest;
    const C = this.T.collapse;
    const k = seg(t, this.tc, this.tc + C);
    // Gany flies to his seat first, then the island closes around him with a bounce.
    const m = out(seg(t, this.tc, this.tc + C * 0.55));
    const ew = spring(seg(t, this.tc + C * 0.06, this.tc + C));
    const eh = spring(seg(t, this.tc + C * 0.16, this.tc + C));
    const p = { ...a };
    p.w = lerp(a.w, rs.w, ew);
    p.h = Math.max(3, lerp(a.h, rs.h, eh));
    p.r = lerp(a.r, rs.r, inOut(k));
    // his seat rides the island's left edge through the bounce
    p.x = lerp(a.x, this.X0 - p.w / 2 + rs.gx + rs.gs / 2, m);
    p.y = lerp(a.y, rs.ay, m) - Math.sin(Math.PI * m) * 10; // a little hop on the way
    p.size = lerp(a.size, rs.gs, m);
    p.sx = lerp(a.sx, 1, m);
    p.sy = lerp(a.sy, 1, m);
    p.rot = a.rot * (1 - m);
    p.mood = k > 0.5 ? 'idle' : a.mood === 'pour' ? 'greet' : a.mood;
    p.look = { x: a.look.x * (1 - m), y: a.look.y * (1 - m) };
    p.decor = 1 - seg(t, this.tc, this.tc + 0.22);
    p.beam = a.beam * p.decor;
    p.ganyAlpha = rs.hidden ? 1 - m : 1;
    // the ambrosia of the frieze becomes the notch's underline, then fades
    p.glow = this.kind === 'full' ? pulse(t, this.tc + 0.1, this.tc + this.T.collapse + 0.55) : 0.7 * pulse(t, this.tc + 0.05, this.tc + this.T.collapse + 0.35);
    this.gany.pourK = 0;
    return p;
  }

  // ── Frame ────────────────────────────────────────────────────────────────

  frame(now) {
    if (!this.active) return;
    // dev: window.__launchAt = 1.2 freezes the entrance at 1.2 s (screenshots)
    const t = typeof window.__launchAt === 'number' ? window.__launchAt : (now - this.t0) / 1000;
    const endAt = this.tc + this.T.collapse + 0.6;
    if (t >= this.tc + this.T.collapse && !this.handed) {
      // The island takes back its shape; the real Gany fades in at the same spot.
      this.handed = true;
      this.island.classList.remove('launching');
      this.onDone?.();
    }
    if (t >= endAt) return this.stop();
    const p = t < this.tc ? this.pose(t) : this.fold(t);
    if (!this.handed) {
      this.island.style.setProperty('--w', `${p.w.toFixed(1)}px`);
      this.island.style.setProperty('--h', `${p.h.toFixed(1)}px`);
      this.island.style.setProperty('--r', `${p.r.toFixed(1)}px`);
    }
    this.draw(t, now, p);
    requestAnimationFrame(this.frame);
  }

  stop() {
    this.active = false;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.canvas.style.display = 'none';
    if (!this.handed) {
      this.handed = true;
      this.island.classList.remove('launching');
      this.onDone?.();
    }
  }

  draw(t, now, p) {
    const c = this.ctx;
    const { X0, Y0 } = this;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, innerWidth, innerHeight);
    const left = X0 - p.w / 2;
    const bottom = Y0 + p.h;

    if (p.decor > 0.01 && !this.handed) {
      c.save();
      islandPath(c, left, Y0, p.w, p.h, p.r);
      c.clip();
      c.globalAlpha = p.decor;
      this.drawSky(c, t, p, left, bottom);
      this.drawBeam(c, t, p, bottom);
      if (this.kind === 'full') {
        this.drawRain(c, t, p, bottom);
        this.drawFrieze(c, t, p, bottom);
        this.drawStream(c, t, p, bottom);
        this.drawDoors(c, t, p, left, bottom);
      }
      this.drawRing(c, t, p);
      this.drawWords(c, t, p);
      c.restore();
    }

    // Gany, drawn at his current size, then squashed and turned.
    const g = this.gany;
    g.setMood(p.mood);
    g.look(p.look.x * 200, p.look.y * 200);
    const size = Math.max(8, Math.min(this.T.G, p.size));
    const oc = this.offCtx;
    oc.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.draw(now, oc, size);
    // After the hand-over the real Gany is back: this one fades out over him.
    const alpha = (p.ganyAlpha ?? 1) * (this.handed ? 1 - seg(t, this.tc + this.T.collapse, this.tc + this.T.collapse + 0.22) : 1);
    if (alpha > 0.01) {
      c.save();
      c.globalAlpha = alpha;
      c.translate(p.x, p.y);
      c.rotate(p.rot);
      c.scale(p.sx, p.sy);
      c.drawImage(this.off, 0, 0, size * this.dpr, size * this.dpr, -size / 2, -size * 0.56, size, size);
      c.restore();
    }

    // The underline of nectar under the folded notch.
    if (p.glow > 0.01) {
      const gw = p.w * 0.7;
      const gr = c.createLinearGradient(X0 - gw / 2, 0, X0 + gw / 2, 0);
      gr.addColorStop(0, 'rgba(248,220,108,0)');
      gr.addColorStop(0.5, `rgba(248,220,108,${0.95 * p.glow})`);
      gr.addColorStop(1, 'rgba(248,220,108,0)');
      c.save();
      c.shadowColor = 'rgba(232,185,35,0.9)';
      c.shadowBlur = 8;
      c.fillStyle = gr;
      c.fillRect(X0 - gw / 2, bottom - 1, gw, 2);
      c.restore();
    }
  }

  // ── Layers ───────────────────────────────────────────────────────────────

  drawSky(c, t, p, left, bottom) {
    const cy = this.Y0 + p.h * 0.55;
    const rad = Math.max(40, p.w * 0.6);
    const g = c.createRadialGradient(p.beamX, cy, 0, p.beamX, cy, rad);
    g.addColorStop(0, `rgba(232,185,35,${0.1 + 0.16 * p.beam})`);
    g.addColorStop(0.5, `rgba(120,80,160,${0.08 * p.beam})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(left, this.Y0, p.w, p.h);
    // stars of the Olympian night
    for (const s of STARS) {
      const a = (0.25 + 0.45 * (0.5 + 0.5 * Math.sin(t * 3 + s.ph))) * seg(t, 0.15, 0.6);
      if (a < 0.02) continue;
      c.fillStyle = `rgba(255,246,220,${a})`;
      c.fillRect(left + s.x * p.w, this.Y0 + s.y * p.h, s.s, s.s);
    }
  }

  drawBeam(c, t, p, bottom) {
    if (p.beam < 0.01) return;
    const half = this.kind === 'full' ? 46 : 30;
    const g = c.createLinearGradient(p.beamX - half, 0, p.beamX + half, 0);
    g.addColorStop(0, 'rgba(255,236,170,0)');
    g.addColorStop(0.5, `rgba(255,236,170,${0.42 * p.beam})`);
    g.addColorStop(1, 'rgba(255,236,170,0)');
    c.fillStyle = g;
    c.fillRect(p.beamX - half, this.Y0, half * 2, bottom - this.Y0);
    // a hot core
    const core = c.createLinearGradient(p.beamX - 4, 0, p.beamX + 4, 0);
    core.addColorStop(0, 'rgba(255,255,240,0)');
    core.addColorStop(0.5, `rgba(255,255,240,${0.55 * p.beam})`);
    core.addColorStop(1, 'rgba(255,255,240,0)');
    c.fillStyle = core;
    c.fillRect(p.beamX - 4, this.Y0, 8, bottom - this.Y0);
  }

  drawRain(c, t, p, bottom) {
    const fade = 1 - seg(t, 0.85, 1.05);
    if (fade <= 0) return;
    c.lineCap = 'round';
    for (const r of RAIN) {
      const tt = t - 0.25 - r.t0;
      if (tt <= 0) continue;
      const yb = this.Y0 + tt * r.v;
      const yt = yb - r.len;
      if (yt > bottom) continue;
      const x = p.beamX + r.x * 38;
      const g = c.createLinearGradient(0, yt, 0, yb);
      g.addColorStop(0, 'rgba(248,220,108,0)');
      g.addColorStop(1, `rgba(255,240,180,${r.a * fade})`);
      c.strokeStyle = g;
      c.lineWidth = r.w;
      c.beginPath();
      c.moveTo(x, Math.max(this.Y0, yt));
      c.lineTo(x, Math.min(bottom, yb));
      c.stroke();
    }
  }

  drawRing(c, t, p) {
    const T = this.T;
    const k = seg(t, T.land, T.land + (this.kind === 'full' ? 1.2 : 0.8));
    if (k <= 0 || k >= 1) return;
    const rx = lerp(10, this.kind === 'full' ? 330 : 190, out(k));
    const ry = rx * 0.3;
    const fade = (1 - k) * Math.min(1, k / 0.06);
    const cx = this.kind === 'full' ? this.X0 : p.beamX;
    const cy = this.Y0 + (this.kind === 'full' ? 76 : 41) + T.G * 0.3;
    for (const d of RING) {
      const r = 1 + d.j;
      c.fillStyle = `rgba(255,232,150,${d.al * fade})`;
      c.fillRect(cx + Math.cos(d.a) * rx * r, cy + Math.sin(d.a) * ry * r, d.s, d.s);
    }
  }

  drawDoors(c, t, p, left, bottom) {
    // Two dark doors meet in the middle, slide apart and end as two columns.
    const col = 15;
    const inner = 8;
    const half = p.w / 2;
    const dw = lerp(half - inner + 1, col, p.doors);
    const h = bottom - this.Y0;
    for (const side of [-1, 1]) {
      const x = side < 0 ? left + inner * p.doors : this.X0 + half - inner * p.doors - dw;
      const g = c.createLinearGradient(x, 0, x + dw, 0);
      g.addColorStop(0, '#15121C');
      g.addColorStop(0.5, '#221D2C');
      g.addColorStop(1, '#15121C');
      c.fillStyle = g;
      c.fillRect(x, this.Y0, dw, h);
      // fluting
      c.strokeStyle = `rgba(232,185,35,${0.18 + 0.2 * p.doors})`;
      c.lineWidth = 1;
      const n = Math.max(2, Math.round(dw / 7));
      for (let i = 1; i < n; i++) {
        const fx = x + (i / n) * dw;
        c.beginPath();
        c.moveTo(fx, this.Y0 + 6);
        c.lineTo(fx, bottom - 9);
        c.stroke();
      }
      // gold edge where the light comes through
      const edge = side < 0 ? x + dw : x;
      c.fillStyle = `rgba(248,220,108,${0.9 - 0.5 * p.doors})`;
      c.fillRect(edge - 1, this.Y0, 2, h);
      // base and capital, once they are columns
      if (p.doors > 0.6) {
        c.fillStyle = `rgba(232,185,35,${(p.doors - 0.6) * 2})`;
        c.fillRect(x - 3, bottom - 8, dw + 6, 3);
        c.fillRect(x - 2, this.Y0 + 3, dw + 4, 2);
      }
    }
    // the light leaking between the doors, brightest when they just part
    const gap = this.X0 + half - inner * p.doors - dw - (left + inner * p.doors + dw);
    const leak = pulse(p.doors, 0, 0.8);
    if (leak > 0.01 && gap > 0) {
      const lg = c.createLinearGradient(0, this.Y0, 0, bottom);
      lg.addColorStop(0, `rgba(255,250,225,${0.9 * leak})`);
      lg.addColorStop(1, `rgba(248,220,108,${0.3 * leak})`);
      c.fillStyle = lg;
      c.fillRect(this.X0 - Math.min(gap, 60) / 2, this.Y0, Math.min(gap, 60), h);
    }
  }

  makeFrieze() {
    // A Greek key, pre-drawn twice: dim (carved) and lit (filled with ambrosia).
    const T = this.T;
    const w = T.W - 2 * 30;
    const hgt = 9;
    const mk = (lit) => {
      const cv = document.createElement('canvas');
      cv.width = Math.ceil((w + 8) * this.dpr);
      cv.height = Math.ceil((hgt + 8) * this.dpr);
      const x = cv.getContext('2d');
      x.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      x.translate(4, 4);
      x.strokeStyle = lit ? GOLD_LIGHT : 'rgba(232,185,35,0.28)';
      x.lineWidth = lit ? 1.6 : 1.2;
      x.lineJoin = 'miter';
      if (lit) {
        x.shadowColor = 'rgba(255,200,60,0.95)';
        x.shadowBlur = 5;
      }
      const u = 13;
      x.beginPath();
      x.moveTo(0, hgt);
      x.lineTo(w, hgt);
      for (let i = 0; i + u <= w + 0.5; i += u) {
        x.moveTo(i, hgt);
        x.lineTo(i, 0);
        x.lineTo(i + u * 0.78, 0);
        x.lineTo(i + u * 0.78, hgt * 0.68);
        x.lineTo(i + u * 0.36, hgt * 0.68);
        x.lineTo(i + u * 0.36, hgt * 0.34);
      }
      x.stroke();
      return cv;
    };
    return { dim: mk(false), lit: mk(true), w, hgt };
  }

  drawFrieze(c, t, p, bottom) {
    const f = this.frieze;
    if (!f) return;
    const x0 = this.X0 - f.w / 2 - 4;
    const y0 = bottom - f.hgt - 14;
    const show = seg(t, 0.5, 1.0);
    if (show <= 0) return;
    c.save();
    c.globalAlpha *= show;
    c.drawImage(f.dim, x0, y0, f.dim.width / this.dpr, f.dim.height / this.dpr);
    c.restore();
    if (p.frieze <= 0) return;
    // the ambrosia runs both ways from where the stream lands
    const from = this.streamFoot?.x ?? this.X0 - 120;
    const span = p.frieze * f.w * 1.1;
    c.save();
    c.beginPath();
    c.rect(from - span, y0 - 4, span * 2, f.hgt + 16);
    c.clip();
    c.drawImage(f.lit, x0, y0, f.lit.width / this.dpr, f.lit.height / this.dpr);
    c.restore();
  }

  drawStream(c, t, p, bottom) {
    const T = this.T;
    if (t < T.stream[0] || t > T.stream[1] + 0.3) return;
    const lipLocal = this.gany.cupLip(p.size);
    // lip in viewport coordinates (Gany's anchor is his body centre at 0.56)
    const lx = p.x + (lipLocal.x - p.size / 2) * p.sx;
    const ly = p.y + (lipLocal.y - p.size * 0.56) * p.sy;
    const fy = bottom - 14 - 5;
    const fx = lx + 10;
    this.streamFoot = { x: fx, y: fy };
    // head falls in, tail leaves at the end
    const head = seg(t, T.stream[0], T.stream[0] + 0.12);
    const tail = seg(t, T.stream[1], T.stream[1] + 0.16);
    if (head <= tail) return;
    const pt = (k) => {
      // a quadratic arc: out of the lip, then straight down
      const cx = lx + 14;
      const cy = ly + 4;
      const u = 1 - k;
      return { x: u * u * lx + 2 * u * k * cx + k * k * fx, y: u * u * ly + 2 * u * k * cy + k * k * fy };
    };
    c.save();
    c.lineCap = 'round';
    c.shadowColor = 'rgba(255,200,60,0.8)';
    c.shadowBlur = 6;
    const steps = 16;
    for (const [col, wdt, dash] of [[GOLD, 3.2, null], [GOLD_LIGHT, 1.4, [5, 7]]]) {
      c.strokeStyle = col;
      c.lineWidth = wdt;
      c.setLineDash(dash || []);
      c.lineDashOffset = -t * 140;
      c.beginPath();
      for (let i = 0; i <= steps; i++) {
        const k = tail + (head - tail) * (i / steps);
        const q = pt(k);
        if (i === 0) c.moveTo(q.x, q.y);
        else c.lineTo(q.x, q.y);
      }
      c.stroke();
    }
    c.setLineDash([]);
    // splashes where it lands
    if (head >= 1 && tail < 0.9) {
      for (const s of SPLASH) {
        const ph = (t * 2.2 + s.ph) % 1;
        const x = fx + s.vx * ph * 0.35;
        const y = fy + (s.vy * ph + 220 * ph * ph) * 0.35;
        c.fillStyle = `rgba(255,226,130,${1 - ph})`;
        c.beginPath();
        c.arc(x, Math.min(y, fy + 2), 1.3, 0, TAU);
        c.fill();
      }
    }
    c.restore();
  }

  drawWords(c, t, p) {
    if (p.title <= 0) return;
    const full = this.kind === 'full';
    const x = full ? this.X0 - 92 : this.X0 - this.T.W / 2 + 96;
    const y = this.Y0 + (full ? 76 : 40);
    c.save();
    // the title writes itself from left to right
    c.font = `800 ${full ? 36 : 22}px "Segoe UI Variable Display", "Segoe UI", sans-serif`;
    c.textBaseline = 'alphabetic';
    const tw = c.measureText(this.words.title).width;
    c.beginPath();
    c.rect(x - 4, y - 50, (tw + 14) * out(p.title), 70);
    c.save();
    c.clip();
    const g = c.createLinearGradient(x, 0, x + tw, 0);
    const sh = p.shimmer * 1.6 - 0.3; // a band of light passes over it
    g.addColorStop(0, GOLD_LIGHT);
    g.addColorStop(clamp(sh - 0.12, 0, 1), GOLD);
    g.addColorStop(clamp(sh, 0, 1), '#FFFBEA');
    g.addColorStop(clamp(sh + 0.12, 0, 1), GOLD);
    g.addColorStop(1, '#F2A65A');
    c.shadowColor = 'rgba(232,185,35,0.45)';
    c.shadowBlur = 12;
    c.fillStyle = g;
    c.fillText(this.words.title, x, y);
    c.restore();
    // and the subtitle rises in
    if (p.sub > 0) {
      c.globalAlpha *= p.sub;
      c.font = `600 ${full ? 13.5 : 11.5}px "Segoe UI Variable Text", "Segoe UI", sans-serif`;
      c.fillStyle = 'rgba(244,240,232,0.85)';
      c.fillText(this.words.sub, x + 1, y + (full ? 24 : 17) + (1 - out(p.sub)) * 6);
    }
    c.restore();
  }
}

/** The island's outline: square top (the screen edge), rounded bottom. */
function islandPath(c, x, y, w, h, r) {
  r = Math.min(r, h, w / 2);
  c.beginPath();
  c.moveTo(x, y);
  c.lineTo(x + w, y);
  c.lineTo(x + w, y + h - r);
  c.arcTo(x + w, y + h, x + w - r, y + h, r);
  c.lineTo(x + r, y + h);
  c.arcTo(x, y + h, x, y + h - r, r);
  c.closePath();
}

/** 'full' the first time today, 'short' after a restart the same day, null for a renderer reload. */
export function launchKind(setting) {
  if (setting === 'off') return null;
  const today = new Date().toDateString();
  let reload = false;
  let seen = '';
  try {
    reload = sessionStorage.getItem('ambrosia.launched') === '1';
    sessionStorage.setItem('ambrosia.launched', '1');
    seen = localStorage.getItem('ambrosia.launchDay') || '';
    localStorage.setItem('ambrosia.launchDay', today);
  } catch {
    /* storage unavailable: treat as a first launch */
  }
  if (reload) return null;
  if (setting === 'short') return 'short';
  return seen === today ? 'short' : 'full';
}

export const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
