// The glow along the top of the screen — what the light looks like.
//
// The island decides WHEN (island.js → glowWanted / glowWave), the main process
// carries it to a click-through window across the top of the island's display
// (src/main/glow.js), and this draws it. The dev preview uses the same class on a
// div at the top of the page.
//
//   steady: { color, scope }   stays while it holds (an approval waits, a meeting runs without you)
//   wave:   { color, scope, id } passes once from the notch to the edges (a new alert with a sound)
//   scope:  'notch' (around the island) | 'full' (the whole top edge)
//   cx:     the island's centre, in px from the left of the display
//
// prefers-reduced-motion: the steady light does not breathe, waves do not play.

const CSS = `
.glow-root { position: absolute; inset: 0; overflow: hidden; pointer-events: none; --cx: 50%; }
.glow-layer { position: absolute; inset: 0; opacity: 0; transition: opacity .5s ease; }
.glow-layer.on { opacity: 1; }
.glow-layer .halo { position: absolute; inset: 0; background: radial-gradient(ellipse var(--rw) 100% at var(--cx) 0, color-mix(in srgb, var(--c) 55%, transparent) 0, color-mix(in srgb, var(--c) 18%, transparent) 45%, transparent 75%); }
.glow-layer .edge { position: absolute; left: 0; right: 0; top: 0; height: 2px; background: radial-gradient(ellipse var(--lw) 100% at var(--cx) 0, var(--c) 0, color-mix(in srgb, var(--c) 70%, transparent) 55%, transparent 100%); filter: drop-shadow(0 0 4px var(--c)); }
.glow-layer.notch { --rw: 360px; --lw: 520px; }
.glow-layer.full { --rw: 70%; --lw: 140%; }
.glow-layer.steady.on { animation: glow-breathe 2.6s ease-in-out infinite; }
@keyframes glow-breathe { 0%, 100% { opacity: .55; } 50% { opacity: 1; } }
.glow-layer.wave { transform-origin: var(--cx) 0; }
.glow-layer.wave.play { animation: glow-wave 1.9s cubic-bezier(.2, .7, .3, 1) forwards; }
@keyframes glow-wave {
  0% { opacity: 0; transform: scaleX(.08); }
  18% { opacity: 1; }
  100% { opacity: 0; transform: scaleX(1); }
}
@media (prefers-reduced-motion: reduce) {
  .glow-layer.steady.on { animation: none; opacity: .8; }
  .glow-layer.wave { display: none; }
}
`;

export class GlowView {
  constructor(container) {
    if (!document.getElementById('glow-css')) {
      const style = document.createElement('style');
      style.id = 'glow-css';
      style.textContent = CSS;
      document.head.append(style);
    }
    this.root = document.createElement('div');
    this.root.className = 'glow-root';
    this.steady = this.layer('steady');
    this.wave = this.layer('wave');
    this.root.append(this.steady, this.wave);
    container.append(this.root);
    this.waveId = null;
  }

  layer(kind) {
    const el = document.createElement('div');
    el.className = `glow-layer ${kind}`;
    el.innerHTML = '<div class="halo"></div><div class="edge"></div>';
    return el;
  }

  paint(el, g) {
    el.style.setProperty('--c', g.color || '#F8DC6C');
    el.classList.toggle('full', g.scope === 'full');
    el.classList.toggle('notch', g.scope !== 'full');
  }

  /** { steady, wave, cx }: see the top of the file. */
  set({ steady = null, wave = null, cx = null } = {}) {
    if (cx != null) this.root.style.setProperty('--cx', `${Math.round(cx)}px`);
    if (steady) this.paint(this.steady, steady);
    this.steady.classList.toggle('on', !!steady);
    if (wave && wave.id !== this.waveId) {
      this.waveId = wave.id;
      this.paint(this.wave, wave);
      this.wave.classList.remove('play');
      void this.wave.offsetWidth; // restart the animation
      this.wave.classList.add('play');
    }
  }
}
