// The alerts journal — « Alertes » in the island: what Gany said lately.
//
// Pure logic, shared by the module host (src/main/modules.js) and the dev preview
// (dev/island.html loads this file as a plain script). Every ctx.alert lands here,
// shown or held for a call, so an alert that passed while you looked away (or that
// waited for the end of a meeting) can still be found.
//
//   * in memory only: mail subjects and senders never reach the disk, a restart forgets;
//   * the same key replaces its entry (a script's progress, a card that came back) and
//     counts the repeats;
//   * MAX entries, MAX_AGE at most; « seen » marks the moment the tab was last opened.

(function (root) {
  const MAX = 60;
  const MAX_AGE = 24 * 3600 * 1000;
  /** Alerts that only summarise others already in the journal. */
  const SKIP = /^core:call-recap$/;

  const clip = (s, n) => {
    const t = String(s ?? '').replace(/\s+/g, ' ').trim();
    return t.length > n ? t.slice(0, n - 1) + '…' : t;
  };

  class AlertLog {
    constructor({ max = MAX, maxAge = MAX_AGE } = {}) {
      this.max = max;
      this.maxAge = maxAge;
      this.items = []; // newest first
      this.seenAt = 0;
    }

    /** One alert, as pushed by a module: { key, module, title, text, from, mood, priority, sound }. */
    add(a, now = Date.now(), { held = false } = {}) {
      if (!a || !a.key || SKIP.test(a.key)) return false;
      const prev = this.items.find((x) => x.key === a.key);
      const entry = {
        key: String(a.key),
        module: a.module || String(a.key).split(':')[0],
        title: clip(a.title, 160),
        text: clip(a.text, 300),
        from: clip(a.from, 60),
        mood: a.mood || null,
        priority: Number(a.priority) || 0,
        loud: !!a.sound,
        held: !!held,
        count: Number(a.count) || 0,
        at: now,
        repeats: prev ? prev.repeats + 1 : 0,
      };
      this.items = [entry, ...this.items.filter((x) => x.key !== entry.key)];
      this.prune(now);
      return true;
    }

    prune(now = Date.now()) {
      this.items = this.items.filter((x) => now - x.at < this.maxAge).slice(0, this.max);
    }

    /** The tab was opened: what is listed now is seen. */
    seen(now = Date.now()) {
      this.seenAt = now;
    }

    clear(now = Date.now()) {
      this.items = [];
      this.seenAt = now;
    }

    unseen() {
      return this.items.filter((x) => x.at > this.seenAt).length;
    }

    snapshot(now = Date.now()) {
      this.prune(now);
      return { items: this.items.map((x) => ({ ...x })), seenAt: this.seenAt, unseen: this.unseen() };
    }
  }

  /** « Aujourd'hui », « Hier », « Plus tôt »: the groups of the list, newest first. */
  function groups(items, now = Date.now()) {
    const day = (t) => new Date(t).toDateString();
    const today = day(now);
    const yesterday = day(now - 24 * 3600 * 1000);
    const out = [];
    for (const it of items) {
      const d = day(it.at);
      const label = d === today ? 'Aujourd’hui' : d === yesterday ? 'Hier' : 'Plus tôt';
      const last = out[out.length - 1];
      if (last?.label === label) last.items.push(it);
      else out.push({ label, items: [it] });
    }
    return out;
  }

  /** The modules present in the list, with their count, for the filter chips (most first). */
  function sources(items) {
    const n = new Map();
    for (const it of items) n.set(it.module, (n.get(it.module) || 0) + 1);
    return [...n.entries()].map(([module, count]) => ({ module, count })).sort((a, b) => b.count - a.count || a.module.localeCompare(b.module));
  }

  const api = { AlertLog, groups, sources, MAX, MAX_AGE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AmbrosiaAlertLog = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
