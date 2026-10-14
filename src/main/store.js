// Settings and per-module data, as plain JSON files.
//
// settings.json holds one object per section (`general`, `island`, `claude`, and one
// per module id). Modules declare their defaults; what is on disk wins.
// Writes are atomic (temp file + rename) so a crash never leaves half a file.

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const paths = require('./paths');

const CORE_DEFAULTS = {
  general: { sounds: true, volume: 0.5, autostart: true, paused: false },
  island: {
    /** 'notch' keeps a small black notch visible; 'line' retracts into a thin line. */
    idleStyle: 'notch',
    /** ms the pointer must stay still on the notch before it unfolds (passing over never opens it). */
    restDelay: 450,
    /** After the island was slid aside, seconds before it goes back to the centre (0 = never). */
    returnSeconds: 60,
    /** ms after the pointer leaves before it folds back. */
    leaveDelay: 650,
    /** How long a non-pinned alert stays visible, in seconds. */
    alertSeconds: 9,
    /** Which screen: 'primary', 'mouse' (the pointer's, after a moment), 'window' (the active window's), 'fixed' (displayId). */
    display: 'primary',
    displayId: '',
    /** A file dragged near the island opens a drop zone (Gany drinks it). */
    dropZone: true,
  },
  /** Gany knows how to be forgotten (src/main/system.js, main.js « Windows integration »). */
  discretion: {
    /** Invisible to screen sharing, recordings and remote control (you still see it). */
    hideFromCapture: true,
    /** Steps aside while a full-screen app, a game or a presentation covers its screen. */
    fullscreen: true,
    /** Gany's focus mode follows Windows « Ne pas déranger ». */
    followDnd: true,
  },
  /** « En appel » (src/main/call-mode.js): in a meeting, only what is urgent interrupts. */
  call: {
    enabled: true,
    /** Alerts below this priority wait for the end of the call (100 = all but Claude Code approvals / questions). */
    threshold: 100,
    /** What still passes plays a discreet tick instead of its sound. */
    softSound: true,
  },
  /** Automatic updates (src/main/updater.js): installed at start when on; a button otherwise. */
  update: { auto: true },
  cli: {
    /** Path of claude.exe. Empty means auto-detect (PATH, then the Claude desktop app's bundled CLI). */
    path: '',
    /** Model used for Ambrosia's own small background jobs. */
    fastModel: 'haiku',
  },
};

function readJson(file, fallback) {
  try {
    let text = fs.readFileSync(file, 'utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    return text.trim() ? JSON.parse(text) : fallback;
  } catch (err) {
    if (err.code !== 'ENOENT') require('./log').line('store', `unreadable ${file}:`, err.message);
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

class Store extends EventEmitter {
  constructor() {
    super();
    this.defaults = JSON.parse(JSON.stringify(CORE_DEFAULTS));
    this.values = readJson(paths.settingsFile, {});
  }

  /** Modules call this once with their defaults. */
  declare(section, defaults) {
    this.defaults[section] = { ...(this.defaults[section] || {}), ...defaults };
  }

  section(name) {
    return { ...(this.defaults[name] || {}), ...(this.values[name] || {}) };
  }

  get(name, key) {
    return this.section(name)[key];
  }

  /** Merges `patch` into a section, saves, and emits `change:<section>`. */
  set(name, patch) {
    this.values[name] = { ...(this.values[name] || {}), ...patch };
    writeJson(paths.settingsFile, this.values);
    this.emit(`change:${name}`, this.section(name));
    this.emit('change', name, this.section(name));
  }

  all() {
    const out = {};
    for (const name of new Set([...Object.keys(this.defaults), ...Object.keys(this.values)])) {
      out[name] = this.section(name);
    }
    return out;
  }

  // ── Module data (state that is not a setting: seen ids, history…) ──────────
  loadData(id, fallback = {}) {
    return readJson(path.join(paths.dataDir, `${id}.json`), fallback);
  }

  saveData(id, value) {
    writeJson(path.join(paths.dataDir, `${id}.json`), value);
  }
}

module.exports = { store: new Store(), readJson, writeJson };
