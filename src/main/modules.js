// Feature modules — the one place new features plug in.
//
// A module is a folder in src/modules/<id>/ with:
//   main.js  (required)  Node side: polls, listens to hooks, calls Claude.
//   view.js  (optional)  Island side: an ES module that renders its panel.
//
// main.js exports:
//   {
//     id, name, icon, color, order,
//     settings: [ { key, label, type, default, help, options } ],   // auto-rendered in Réglages
//     init(ctx), dispose()
//   }
// See CLAUDE.md for the full `ctx` API, and `npm run new-module -- <id>` to scaffold one.

const fs = require('fs');
const path = require('path');
const { shell } = require('electron');
const paths = require('./paths');
const { store } = require('./store');
const claude = require('./claude');
const hookServer = require('./hook-server');
const launcher = require('./launcher');
const logger = require('./log');
const { CallMode } = require('./call-mode');
const { Suspend, FULLSCREEN_INFO } = require('./system');

class ModuleHost {
  constructor() {
    this.modules = new Map(); // id → { def, state, actions, ctx }
    this.alerts = [];
    this.island = null; // set by main.js: { send(channel, data), expand(id), reveal() }
    // « En appel » : every ctx.alert goes through it (see call-mode.js).
    this.call = new CallMode(() => store.section('call'));
    store.on('change:call', () => {
      // Switched off during a call: what waited comes out now.
      if (this.call.settings().enabled === false && !this.call.active) this.flushCall();
      this.sendCall();
    });
    // Windows (main.js, src/main/system.js): session locked, full screen, « Ne pas déranger ».
    this.system = { locked: false, fullscreen: null, dnd: null };
    this.suspend = new Suspend();
    this.systemListeners = new Set();
    this.resumeTimers = [];
    // The end of a user pause resumes the modules too, one after the other.
    let paused = !!store.get('general', 'paused');
    store.on('change:general', (g) => {
      if (paused && !g.paused) this.resume();
      paused = !!g.paused;
    });
  }

  /**
   * Windows says something changed: { locked, fullscreen: 'fullscreen'|'game'|'presentation'|null, dnd }.
   * Locked and full screen hold alerts like a call (always, whatever « En réunion »),
   * a lock also stops new background work (ctx.paused) until a staggered resume.
   */
  setSystem(patch) {
    const before = this.system;
    this.system = { ...before, ...patch };
    const s = this.system;
    if (s.locked !== before.locked) {
      const change = this.suspend.set('lock', !!s.locked);
      this.setInCall('core:lock', s.locked ? { title: 'Session verrouillée', recapLead: 'Pendant ton absence', always: true, kind: 'lock' } : null);
      if (change === 'unlock') this.resume();
      else if (change === 'lock') this.resumeTimers.splice(0).forEach(clearTimeout);
    }
    if (s.fullscreen !== before.fullscreen) {
      const info = FULLSCREEN_INFO[s.fullscreen];
      this.setInCall('core:fullscreen', info ? { ...info, always: true, kind: 'fullscreen' } : null);
    }
    if (s.locked !== before.locked || s.fullscreen !== before.fullscreen || s.dnd !== before.dnd) {
      this.island?.send('system', this.system);
      for (const fn of this.systemListeners) {
        try {
          fn(this.system, before);
        } catch (err) {
          logger.line('modules', 'system listener', err);
        }
      }
    }
  }

  /** After a lock or a pause: each module may start new work again in its turn, its onResume runs then. */
  resume() {
    this.resumeTimers.splice(0).forEach(clearTimeout);
    const list = [...this.modules.values()].filter((m) => m.ctx).sort((a, b) => (a.def.order ?? 50) - (b.def.order ?? 50));
    const now = Date.now();
    const plan = this.suspend.resume(list.map((m) => m.def.id), now);
    for (const m of list) {
      if (!m.resumers?.length) continue;
      const t = setTimeout(() => {
        if (!m.ctx || m.ctx.paused()) return;
        for (const fn of m.resumers) Promise.resolve().then(fn).catch((err) => m.ctx?.log('resume', err));
      }, Math.max(0, plan.get(m.def.id) - now));
      this.resumeTimers.push(t);
    }
    logger.line('modules', 'resume', list.map((m) => m.def.id).join(','));
  }

  sendCall() {
    this.island?.send('call', this.call.status());
  }

  /** A module says the user is in a call (info) or no longer (null). */
  setInCall(source, info) {
    const change = this.call.set(source, info || null);
    if (change) logger.line('call', change, source, info?.title || '');
    if (change === 'end') this.flushCall();
    this.sendCall();
  }

  flushCall() {
    const recap = this.call.flush((id) => {
      const def = this.modules.get(id)?.def;
      return def ? { name: def.name || id, recap: def.recap } : null;
    });
    if (recap) this.pushAlert({ ...recap, key: 'core:call-recap' });
  }

  discover() {
    const dirs = fs
      .readdirSync(paths.modulesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
      .map((d) => d.name);
    for (const dir of dirs) {
      const file = path.join(paths.modulesDir, dir, 'main.js');
      if (!fs.existsSync(file)) continue;
      try {
        const def = require(file);
        def.id = def.id || dir;
        def.hasView = fs.existsSync(path.join(paths.modulesDir, dir, 'view.js'));
        def.dir = dir;
        const defaults = { enabled: true };
        for (const s of def.settings || []) if (s.key && 'default' in s) defaults[s.key] = s.default;
        store.declare(def.id, defaults);
        this.modules.set(def.id, { def, state: {}, actions: new Map(), ctx: null, cleanups: [] });
      } catch (err) {
        logger.line('modules', `failed to load ${dir}:`, err);
      }
    }
  }

  async startAll() {
    const list = [...this.modules.values()].sort((a, b) => (a.def.order ?? 50) - (b.def.order ?? 50));
    for (const m of list) {
      if (store.get(m.def.id, 'enabled') === false) continue;
      await this.start(m);
    }
  }

  async start(m) {
    const id = m.def.id;
    const host = this;
    const ctx = {
      id,
      log: logger.scope(id),
      claude,
      hooks: hookServer,
      settings: () => store.section(id),
      setSettings: (patch) => store.set(id, patch),
      onSettings(fn) {
        store.on(`change:${id}`, fn);
        m.cleanups.push(() => store.off(`change:${id}`, fn));
      },
      data: {
        load: (fallback) => store.loadData(id, fallback),
        save: (value) => store.saveData(id, value),
      },
      /** Shallow-merges into the module state and pushes it to the island. */
      setState(patch) {
        m.state = { ...m.state, ...patch };
        host.island?.send('state', { id, state: m.state });
      },
      getState: () => m.state,
      /** Handles `ambrosia.action('<id>', name, payload)` calls from the view. */
      onAction(name, fn) {
        m.actions.set(name, fn);
      },
      /**
       * Shows an alert in the island.
       * { key, title, text, mood, pin, sound, ttl (s), view (true = open the module panel),
       *   count (how many things it stands for, for the « en appel » recap) }
       */
      alert(a) {
        host.pushAlert({ ...a, module: id, key: `${id}:${a.key || Date.now()}` });
      },
      dismissAlert(key) {
        host.dismissAlert(`${id}:${key}`);
      },
      /** Opens the island on this module's panel (used for approvals). */
      focus(pin = false) {
        host.island?.expand(id, pin);
      },
      unpin() {
        host.island?.send('unpin', { id });
      },
      reveal() {
        host.island?.reveal();
      },
      /**
       * No NEW background work now (periodic checks, briefs, routines…): the user's pause,
       * the Windows session locked, or the staggered resume after them. Work already
       * running finishes. Claude Code hooks look at pausedByUser() instead.
       */
      paused: () => !!store.get('general', 'paused') || host.suspend.held(id, Date.now()),
      pausedByUser: () => !!store.get('general', 'paused'),
      /** The Windows session is locked (or the PC asleep). */
      locked: () => host.suspend.locked,
      /** Called once paused() turns false again (after a lock or a pause), in this module's turn. */
      onResume(fn) {
        (m.resumers ||= []).push(fn);
        m.cleanups.push(() => (m.resumers = m.resumers.filter((f) => f !== fn)));
      },
      /** Windows: { locked, fullscreen, dnd } (dnd: « Ne pas déranger » on, false when not followed, null until known). */
      system: () => host.system,
      onSystem(fn) {
        host.systemListeners.add(fn);
        m.cleanups.push(() => host.systemListeners.delete(fn));
      },
      /** Read-only view of every module's state (the gany module builds its briefings from it). */
      peers: () => host.states(),
      /**
       * A short reaction of Gany, without an alert: ctx.react('wink', 2500, { sound, confetti }).
       * Moods: see src/renderer/gany.js. In a call: no sound, no confetti.
       */
      react: (mood, ms = 2500, extra = {}) =>
        host.suspend.locked ? undefined : host.island?.send('react', { mood, ms, ...extra, ...(host.call.active ? { sound: null, confetti: false } : {}) }),
      /**
       * « En appel » : ctx.setInCall({ title, endsAt }) while the user is in a call, null after.
       * Non-urgent alerts then wait and come back as one recap at the end (src/main/call-mode.js).
       */
      setInCall: (info) => host.setInCall(id, info),
      inCall: () => host.call.active,
      /** { idleMs } since the user last moved the mouse, from the main process. */
      activity: () => host.island?.activity?.() || { idleMs: 0 },
      openExternal: (url) => shell.openExternal(url),
      openPath: (p) => shell.openPath(p),
      /**
       * Opens Windows Terminal on an interactive `claude` session (src/main/launcher.js):
       * { cwd, model, prompt, worktree, permissionMode, title } → { ok, sessionId, error }.
       * Gany greets the session when its SessionStart hook arrives. Only on a user's click.
       */
      launchClaude: (o) =>
        launcher.launch({ ...o, onStart: () => host.island?.send('react', { mood: 'greet', ms: 2600, sound: 'greet' }) }),
    };
    m.ctx = ctx;
    try {
      await m.def.init?.(ctx);
      ctx.log('started');
    } catch (err) {
      ctx.log('init failed:', err);
    }
  }

  async stop(id) {
    const m = this.modules.get(id);
    if (!m) return;
    try {
      await m.def.dispose?.();
    } catch {
      /* ignore */
    }
    m.cleanups.splice(0).forEach((fn) => fn());
    this.setInCall(id, null);
    m.ctx = null;
    m.state = {};
    m.actions.clear();
    this.island?.send('state', { id, state: {} });
  }

  async action(id, name, payload) {
    const m = this.modules.get(id);
    const fn = m?.actions.get(name);
    if (!fn) throw new Error(`action inconnue ${id}.${name}`);
    return fn(payload);
  }

  pushAlert(alert) {
    // In a call, what can wait is queued (no peek, no sound) for the recap.
    const a = this.call.admit(alert);
    if (!a) return this.sendCall();
    this.alerts = this.alerts.filter((x) => x.key !== a.key);
    this.alerts.push({ ttl: store.get('island', 'alertSeconds'), at: Date.now(), ...a });
    this.island?.send('alerts', this.alerts);
  }

  dismissAlert(key) {
    if (this.call.dismiss(key)) this.sendCall();
    const before = this.alerts.length;
    this.alerts = this.alerts.filter((x) => x.key !== key);
    if (before !== this.alerts.length) this.island?.send('alerts', this.alerts);
  }

  manifest() {
    return [...this.modules.values()]
      .map(({ def }) => ({
        id: def.id,
        name: def.name || def.id,
        icon: def.icon || '•',
        /** Image path relative to src/renderer/ (brand logo), shown instead of the glyph. */
        logo: def.logo || null,
        color: def.color || '#E8B923',
        order: def.order ?? 50,
        hasView: def.hasView,
        /** A section rarely visited: its tab waits behind « ⋮ » unless it needs the user. */
        secondary: !!def.secondary,
        dir: def.dir,
        settings: def.settings || [],
        enabled: store.get(def.id, 'enabled') !== false,
      }))
      .sort((a, b) => a.order - b.order);
  }

  states() {
    const out = {};
    for (const [id, m] of this.modules) out[id] = m.state;
    return out;
  }

  async disposeAll() {
    for (const id of this.modules.keys()) await this.stop(id);
  }
}

module.exports = new ModuleHost();
