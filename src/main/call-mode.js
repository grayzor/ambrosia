// "En appel" — while the user is in a meeting, Gany holds back what can wait.
//
// Pure logic, shared by the module host (src/main/modules.js) and the dev preview
// (dev/island.html loads this file as a plain script). Any module can say "the
// user is in a call" (ctx.setInCall); today Agenda does, from presence.js.
//
// While a call is on:
//   * an alert below the threshold (default 100: all but Claude Code approvals and
//     questions) that is not pinned is queued, silently, instead of shown;
//   * what still passes plays at most a discreet tick;
//   * when the call ends, ONE recap alert ("Pendant ta réunion : 2 mails, 1
//     interaction ClickUp") replaces the queue, and opens the busiest module.
// Opening the island during the call shows every module as usual: only the
// interruptions are held, never the content.

(function (root) {
  const DEFAULTS = { enabled: true, threshold: 100, softSound: true };

  /** "2 mails", "1 interaction ClickUp" — from the module's `recap` labels, else its name. */
  function label(n, mod) {
    const r = mod?.recap;
    if (r) return `${n} ${n > 1 ? r.many : r.one}`;
    const name = mod?.name || 'alerte';
    return `${n} ${n > 1 ? 'alertes' : 'alerte'} ${name}`;
  }

  function joinFr(parts) {
    if (parts.length <= 1) return parts.join('');
    return `${parts.slice(0, -1).join(', ')} et ${parts[parts.length - 1]}`;
  }

  class CallMode {
    /**
     * @param {() => object} settings  current `call` settings ({ enabled, threshold, softSound })
     */
    constructor(settings = () => ({})) {
      this.settings = () => ({ ...DEFAULTS, ...(settings() || {}) });
      this.sources = new Map(); // module id → { title, endsAt, since }
      this.queue = []; // held alerts, latest version per key
      this.since = 0;
    }

    get active() {
      if (!this.sources.size) return false;
      // A source with `always` (Gany's focus mode) holds even when « En réunion » is off.
      return this.settings().enabled !== false || [...this.sources.values()].some((s) => s.always);
    }

    /** What the island needs to know. */
    status() {
      const first = [...this.sources.values()][0] || null;
      return {
        active: this.active,
        title: first?.title || '',
        // What holds: 'call' (a meeting), 'focus', 'fullscreen', 'lock'… (info.kind, 'call' by default).
        kinds: [...new Set([...this.sources.values()].map((s) => s.kind || 'call'))],
        since: this.since || null,
        queued: this.queue.reduce((n, a) => n + (Number(a.count) || 1), 0),
        threshold: this.settings().threshold,
      };
    }

    /**
     * A source reports the user in (info) or out of (null) a call.
     * Returns 'start', 'end' or null (no change of the overall state).
     */
    set(source, info) {
      const was = this.sources.size > 0;
      const gone = this.sources.get(source);
      if (info) this.sources.set(source, { ...(gone || {}), ...info });
      // The recap says what it was: « Pendant ta réunion », « Pendant ta concentration »…
      if (info) this.lead = info.recapLead || 'Pendant ta réunion';
      else this.sources.delete(source);
      // …and the words of the last one to end, when several overlapped.
      if (!info && gone && !this.sources.size) this.lead = gone.recapLead || 'Pendant ta réunion';
      const is = this.sources.size > 0;
      if (!was && is) {
        this.since = Date.now();
        return 'start';
      }
      if (was && !is) return 'end';
      return null;
    }

    /** Does this alert wait for the end of the call? */
    holds(a) {
      if (!this.active || a.pin) return false;
      return (Number(a.priority) || 50) < (Number(this.settings().threshold) || 100);
    }

    /**
     * The alert as it should be shown now, or null when it is queued.
     * Alerts that pass during a call play at most a discreet tick.
     */
    admit(a) {
      if (this.holds(a)) {
        this.queue = this.queue.filter((x) => x.key !== a.key);
        this.queue.push({ ...a, heldAt: Date.now() });
        return null;
      }
      if (this.active && a.sound) return { ...a, sound: this.settings().softSound === false ? null : 'tick', confetti: false };
      return a;
    }

    /** A module dismissed an alert (read, done…): it no longer needs a recap. */
    dismiss(key) {
      const before = this.queue.length;
      this.queue = this.queue.filter((x) => x.key !== key);
      return before !== this.queue.length;
    }

    /**
     * Empties the queue into one recap alert (or null when nothing waited).
     * @param {(id:string) => {name:string, recap?:{one:string, many:string}}} moduleOf
     */
    flush(moduleOf = () => null) {
      const held = this.queue;
      this.queue = [];
      this.since = 0;
      if (!held.length) return null;
      const groups = new Map();
      for (const a of held) {
        const g = groups.get(a.module) || { module: a.module, n: 0, top: a };
        g.n += Number(a.count) || 1;
        if ((Number(a.priority) || 50) > (Number(g.top.priority) || 50)) g.top = a;
        groups.set(a.module, g);
      }
      const list = [...groups.values()].sort((x, y) => (Number(y.top.priority) || 50) - (Number(x.top.priority) || 50) || y.n - x.n);
      const top = list[0];
      const total = list.reduce((n, g) => n + g.n, 0);
      const parts = list.map((g) => label(g.n, moduleOf(g.module)));
      return {
        key: 'call-recap',
        module: top.module,
        title: `${this.lead || 'Pendant ta réunion'} : ${joinFr(parts)}`,
        text: total === 1 ? [held[0].from, held[0].title].filter(Boolean).join(' · ') : held.slice(-3).reverse().map((a) => a.title).filter(Boolean).join(' · '),
        mood: top.top.mood || 'mail',
        sound: top.top.sound || 'mail',
        priority: Number(top.top.priority) || 50,
        ttl: 30,
        recap: list.map((g) => ({ module: g.module, count: g.n })),
      };
    }
  }

  const api = { CallMode, DEFAULTS, label, joinFr };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AmbrosiaCallMode = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
