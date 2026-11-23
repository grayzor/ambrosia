// The glow along the top of the screen — the window.
//
// A transparent strip across the top of the island's display, always click-through,
// never focused, hidden from screen capture like the island (Réglages → Discrétion),
// and hidden as soon as there is nothing to show. The island decides when it lights
// (src/renderer/glow-rules.js), src/renderer/glow.js draws it; this only places the
// window and carries the message.

const path = require('path');
const { BrowserWindow } = require('electron');
const paths = require('./paths');

const HEIGHT = 90; // the halo fades out within it
const WAVE_MS = 2100; // a wave plays, then the window may hide

class Glow {
  /**
   * place(): { bounds, cx } — the island's display bounds and its centre (screen px);
   * protect(): hidden from capture; above(): the island window, kept on top of the glow.
   */
  constructor({ place, protect, above }) {
    this.place = place;
    this.protect = protect;
    this.above = above;
    this.win = null;
    this.ready = false;
    this.state = { steady: null, wave: null };
    this.hideTimer = null;
    this.waveUntil = 0;
  }

  create() {
    if (this.win && !this.win.isDestroyed()) return this.win;
    this.ready = false;
    this.win = new BrowserWindow({
      width: 800,
      height: HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      title: 'Ambrosia — lueur',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.setIgnoreMouseEvents(true);
    this.applyProtection();
    this.win.loadFile(path.join(paths.ROOT, 'src', 'renderer', 'glow.html'));
    this.win.webContents.once('did-finish-load', () => {
      this.ready = true;
      this.flush();
    });
    this.win.on('closed', () => {
      this.win = null;
      this.ready = false;
    });
    return this.win;
  }

  applyProtection() {
    if (this.win && !this.win.isDestroyed()) this.win.setContentProtection(this.protect() !== false);
  }

  /** From the island: { steady, wave } (wave: { color, scope, id }, played once). */
  set(msg = {}) {
    const steady = msg.steady || null;
    const wave = msg.wave || null;
    if (wave) this.waveUntil = Date.now() + WAVE_MS;
    this.state = { steady, wave: wave || this.state.wave };
    if (!steady && !wave && Date.now() > this.waveUntil) return this.hideSoon(600);
    this.create();
    this.flush();
  }

  /** Position on the island's display, send the state, show without taking the focus. */
  flush() {
    const win = this.win;
    if (!win || win.isDestroyed() || !this.ready) return;
    const { bounds, cx } = this.place();
    win.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: HEIGHT });
    win.webContents.send('glow', { ...this.state, cx: cx - bounds.x });
    if (!win.isVisible()) {
      win.showInactive();
      this.above()?.moveTop?.(); // the island stays above its own light
    }
    clearTimeout(this.hideTimer);
    if (!this.state.steady) this.hideSoon(Math.max(0, this.waveUntil - Date.now()) + 200);
  }

  hideSoon(ms) {
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      if (this.state.steady || Date.now() < this.waveUntil) return;
      this.state = { steady: null, wave: null };
      if (this.win && !this.win.isDestroyed()) {
        this.win.webContents.send('glow', { steady: null });
        setTimeout(() => this.win && !this.win.isDestroyed() && !this.state.steady && Date.now() >= this.waveUntil && this.win.hide(), 550); // after the fade
      }
    }, ms);
  }

  /** The island moved to another display, or was hidden (full screen). */
  replace() {
    if (this.win && !this.win.isDestroyed() && this.win.isVisible()) this.flush();
  }

  off() {
    this.state = { steady: null, wave: null };
    this.waveUntil = 0;
    clearTimeout(this.hideTimer);
    if (this.win && !this.win.isDestroyed()) this.win.hide();
  }
}

module.exports = { Glow, HEIGHT };
