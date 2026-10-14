// Routines — Gany spots what keeps coming back in the user's work and suggests a
// scheduled task of the Claude app that would do it for him, created in one click.
//
//   * Looking (once a day by default, late morning, never in a call): ONE headless
//     turn with the READ tools of the connectors found (Gmail sent/received, Calendar,
//     ClickUp, Google Chat) and Ambrosia's own observations (first requests of recent
//     Claude Code sessions, what Gany flagged again and again), passed as data.
//     JSON schema out: at most 3 suggestions, each with its full prompt.
//   * Checking, locally: the guard (logic.guard — no send/delete/share tool, no
//     outbound sentence, at most hourly), duplicates of existing tasks
//     (~/.claude/scheduled-tasks) and of everything already suggested (memory).
//   * Creating: the scheduled-tasks tools only exist inside the Claude app, not in
//     `claude -p`. So the click opens a new Claude Code session of Claude Desktop
//     (claude://code/new deep link) with the exact create_scheduled_task request in
//     its composer: the user sends it there. Ambrosia then watches
//     ~/.claude/scheduled-tasks/<id>/SKILL.md (and the app's registry) to confirm.
// Pure logic: ./logic.js, disk reads: ./sources.js (tests: tests/routines.test.js).

const L = require('./logic');
const src = require('./sources');

const PATTERNS = { gmail: /gmail/i, calendar: /calendar/i, clickup: /clickup/i, chat: /\bchat mcp\b|google[\s_-]*chat/i };

module.exports = {
  id: 'routines',
  name: 'Routines',
  icon: '↻',
  color: '#6FC8D8',
  order: 38,
  secondary: true,
  settings: [
    { key: 'auto', label: 'Chercher des tâches à confier à Claude', type: 'boolean', default: true },
    { key: 'cadence', label: 'Fréquence de l’analyse', type: 'select', default: 'jour', options: ['jour', 'semaine', 'manuel'], help: 'jour = chaque jour ouvré ; semaine = le lundi ; manuel = seulement avec « Analyser maintenant ».' },
    { key: 'at', label: 'Heure de l’analyse (au calme, jamais pendant une réunion)', type: 'text', default: '11:45' },
    { key: 'days', label: 'Période observée (jours)', type: 'number', default: 21 },
    { key: 'useClaude', label: 'Mes sessions Claude Code (premières demandes, lues sur ce PC)', type: 'boolean', default: true },
    { key: 'useAmbrosia', label: 'Ce que Gany m’a signalé plusieurs fois (mails, ClickUp, Chat, Drive)', type: 'boolean', default: true },
    { key: 'useMail', label: 'Mes mails envoyés et reçus (Gmail)', type: 'boolean', default: true },
    { key: 'useCalendar', label: 'Mes réunions récurrentes (Google Agenda)', type: 'boolean', default: true },
    { key: 'useClickup', label: 'Mes tâches ClickUp', type: 'boolean', default: true },
    { key: 'useChat', label: 'Mes messages Google Chat', type: 'boolean', default: false },
    { key: 'model', label: 'Modèle de l’analyse', type: 'select', default: 'sonnet', options: ['haiku', 'sonnet', 'opus'] },
    { key: 'taskFolder', label: 'Dossier de travail des nouvelles tâches (vide = celui de tes tâches existantes)', type: 'text', default: '' },
    { key: 'analyze', type: 'button', label: 'Analyser maintenant', action: 'analyzeFromSettings' },
    { key: 'forget', type: 'button', label: 'Oublier les suggestions refusées', action: 'forgetRefused' },
  ],

  init(ctx) {
    // Lazy: tests load this file without Electron.
    const { store } = require('../../main/store');
    const data = ctx.data.load({ suggestions: [], memory: [], created: [], lastRun: 0, lastResult: null, connectors: {}, detectedAt: 0, announce: false });
    data.suggestions ||= [];
    data.memory ||= [];
    data.created ||= [];
    data.connectors ||= {};
    let busy = null; // 'analyzing'
    let error = null;
    let auth = false;

    const s = () => ctx.settings();
    const save = () => ctx.data.save(data);
    const now = () => new Date();
    const pending = () => data.suggestions.filter((x) => x.status !== 'created');

    function publish() {
      const p = pending();
      ctx.setState({
        busy,
        error,
        auth,
        suggestions: p,
        created: data.created.slice(0, 5),
        lastRun: data.lastRun,
        lastResult: data.lastResult,
        cadence: s().auto === false ? 'manuel' : s().cadence || 'jour',
        rhythms: L.RHYTHMS.map(({ id, label }) => ({ id, label })),
        mood: busy ? { name: 'thinking', priority: 10 } : null,
      });
    }

    // ── Connectors: reuse what the other modules found, detect the rest ───
    function connectors() {
      const st = s();
      const known = (id, re) => {
        const name = store.get(id, 'connector') || store.loadData(id, {}).connector || '';
        return re.test(name) ? name : '';
      };
      const pick = (on, kind, id) => (on ? known(id, PATTERNS[kind]) || data.connectors[kind] || '' : '');
      return {
        gmail: pick(st.useMail, 'gmail', 'mail'),
        calendar: pick(st.useCalendar, 'calendar', 'agenda'),
        clickup: pick(st.useClickup, 'clickup', 'clickup'),
        chat: pick(st.useChat, 'chat', 'gchat'),
      };
    }

    async function detect() {
      const a = await ctx.claude.authStatus();
      if (!a.loggedIn) {
        auth = true;
        return null;
      }
      auth = false;
      const servers = (await ctx.claude.listMcp()).filter((m) => !/not configured|needs auth|^×|failed/i.test(m.status));
      const pick = (re) => servers.filter((m) => re.test(m.name)).sort((a, b) => /^claude\.ai /.test(b.name) - /^claude\.ai /.test(a.name))[0]?.name || '';
      data.connectors = Object.fromEntries(Object.entries(PATTERNS).map(([k, re]) => [k, pick(re)]));
      data.detectedAt = Date.now();
      save();
      ctx.log('connectors:', JSON.stringify(data.connectors));
      return data.connectors;
    }

    // ── What Ambrosia saw ────────────────────────────────────────────────
    function localObservations(t) {
      const st = s();
      const days = Math.max(3, Math.min(60, Number(st.days) || 21));
      const out = {};
      if (st.useClaude !== false) out.sessionsClaude = src.readClaudeHistory({ days, now: t });
      if (st.useAmbrosia !== false) {
        const byModule = {};
        const noise = [];
        for (const id of ['mail', 'clickup', 'gchat', 'drive']) {
          const d = store.loadData(id, {});
          byModule[id] = (d.items || []).filter((i) => !i.at || t.getTime() - i.at < days * L.DAY);
          for (const f of (d.feedback || []).filter((x) => x.verdict === 'noise').slice(-10)) noise.push({ module: id, from: L.clip(f.from, 60), titre: L.clip(f.title, 100) });
        }
        out.recurrencesAmbrosia = L.recurrences(byModule);
        out.pasImportant = noise;
      }
      return { local: out, days };
    }

    // ── The analysis ─────────────────────────────────────────────────────
    async function analyze({ manual = false } = {}) {
      if (busy) return false;
      const room = L.MAX_PENDING - pending().length;
      if (room <= 0) {
        error = manual ? 'Trois suggestions attendent déjà ta réponse : réponds-y d’abord.' : null;
        publish();
        return false;
      }
      busy = 'analyzing';
      error = null;
      publish();
      try {
        let c = connectors();
        const st = s();
        const missing = (st.useMail && !c.gmail) || (st.useCalendar && !c.calendar) || (st.useClickup && !c.clickup) || (st.useChat && !c.chat);
        if (missing && (manual || Date.now() - (data.detectedAt || 0) > 24 * 3600000)) {
          await detect();
          c = connectors();
        }
        const t = now();
        const { tasks, ids } = src.readExistingTasks();
        const { local, days } = localObservations(t);
        const agenda = store.loadData('agenda', {});
        const peers = ctx.peers();
        const refused = data.memory.filter((m) => m.outcome !== 'expired').slice(0, 30).map((m) => ({ title: m.title, description: m.description }));
        const style = tasks.map((x) => x.prompt).filter((p) => p && p.length > 400).sort((a, b) => a.length - b.length)[0] || '';
        const prompt = L.buildPrompt({
          now: t,
          connectors: c,
          local,
          existing: tasks.map((x) => ({ id: x.id, title: x.title || x.name, description: x.description, schedule: x.cron ? L.describeCron(x.cron) : x.fireAt ? 'une seule fois' : '' })),
          refused,
          style,
          selfEmail: agenda.selfEmail || '',
          selfName: peers.agenda?.selfName || '',
          days,
          room,
        });
        const primary = c.gmail || c.clickup || c.calendar || c.chat || '';
        const res = await ctx.claude.run({
          prompt,
          systemPrompt: L.SYSTEM,
          model: st.model || 'sonnet',
          allowedTools: L.readAllowedTools(c, ctx.claude.mcpPrefix),
          jsonSchema: L.SCHEMA,
          ...(primary ? { requireMcp: primary } : {}),
          timeoutMs: 600000,
        });
        data.lastRun = Date.now();
        if (!res.ok || !res.structured) {
          auth = !!res.authError;
          error = res.mcpNotReady ? `Le connecteur ${primary} n’est pas prêt : réessaie dans quelques minutes.` : res.error || 'Réponse illisible';
          ctx.log('analysis failed:', error);
          save();
          return false;
        }
        const { accepted, rejected } = L.sanitize(res.structured, {
          now: t,
          existing: tasks,
          memory: data.memory,
          pending: pending(),
          taken: ids,
          tasksDir: src.defaultTasksDir(),
          room,
        });
        for (const r of rejected) ctx.log(`rejected « ${r.titre} »: ${r.reasons.join(' | ')}`);
        data.suggestions.push(...accepted);
        data.lastResult = {
          at: Date.now(),
          found: accepted.length,
          rejected: rejected.length,
          rien: accepted.length ? '' : L.clip(res.structured.rien || '', 200),
          sources: Object.entries(c).filter(([, v]) => v).map(([k]) => k).concat(Object.keys(local)),
        };
        ctx.log(`analysis: ${accepted.length} suggestion(s), ${rejected.length} rejected`);
        if (accepted.length) data.announce = true;
        save();
        if (manual) ctx.focus(false);
        else announce();
        return true;
      } finally {
        busy = null;
        publish();
      }
    }

    /** The soft "look" — silent, only to someone at the desk and not in a meeting. */
    function announce() {
      if (!data.announce) return;
      const p = pending().filter((x) => x.status === 'new');
      if (!p.length) {
        data.announce = false;
        return save();
      }
      if (ctx.inCall?.() || ctx.activity().idleMs > 10 * L.MIN) return;
      data.announce = false;
      save();
      ctx.alert({
        key: 'suggest',
        title: 'Gany a repéré une tâche qui se répète',
        text: p.length > 1 ? `${p[0].titre} (+${p.length - 1} autre${p.length > 2 ? 's' : ''})` : p[0].titre,
        mood: 'wink',
        priority: 30,
        ttl: 14,
        actions: [{ label: 'Voir', action: 'open', primary: true }],
      });
    }

    // ── Editing a suggestion ─────────────────────────────────────────────
    const find = (id) => data.suggestions.find((x) => x.id === id);

    function applyEdit(x, p = {}) {
      if (typeof p.prompt === 'string') x.prompt = p.prompt.replace(/\r\n/g, '\n').slice(0, L.MAX_PROMPT + 2000);
      return x;
    }

    function setCron(x, p) {
      const cron = p.cron ? String(p.cron).trim().replace(/\s+/g, ' ') : L.cronFrom(p);
      if (!cron || !L.validCron(cron)) return 'Fréquence invalide.';
      if (L.cronTooFrequent(cron)) return 'Au plus une exécution par heure.';
      x.cron = cron;
      x.frequence = L.describeCron(cron);
      return null;
    }

    // ── Creating: Claude Desktop does it, on the user's send ───────────────
    async function create(p = {}) {
      const x = find(p.id);
      if (!x) return { ok: false, error: 'Suggestion introuvable.' };
      applyEdit(x, p);
      if (p.cron || p.rhythm) {
        const bad = setCron(x, p);
        if (bad) return fail(x, bad);
      }
      const g = L.guard(x);
      if (!g.ok) return fail(x, `Gany ne crée pas cette tâche : ${g.reasons.join(' ')}`);
      const { tasks, ids } = src.readExistingTasks();
      if (ids.includes(x.taskId)) {
        // Sent on a previous click after all: just confirm it.
        if (x.status === 'launched' || x.status === 'unconfirmed') {
          x.status = 'launched';
          check();
          return { ok: true };
        }
        // The id was taken meanwhile: a new one, and the prompt follows its folder.
        const before = L.taskDir(src.defaultTasksDir(), x.taskId);
        x.taskId = L.slugify(x.titre, ids);
        x.prompt = L.withTaskDir(x.prompt, L.taskDir(src.defaultTasksDir(), x.taskId), before);
        x.rev = (x.rev || 1) + 1;
      }
      const request = L.creationRequest(x);
      const url = L.deepLink(request, s().taskFolder || src.usualTaskFolder(tasks));
      const opened = await src.openInDesktop(url, { openExternal: ctx.openExternal });
      if (!opened.ok) {
        copy(request);
        return fail(x, `${opened.error} La demande de création est copiée : colle-la dans une session Claude Code de l’app Claude.`);
      }
      Object.assign(x, { status: 'launched', launchedAt: Date.now(), error: null });
      save();
      publish();
      watch();
      ctx.log(`launched ${x.taskId} via ${opened.via}`);
      return { ok: true };
    }

    function fail(x, msg) {
      x.error = msg;
      if (x.status !== 'launched') x.status = 'error';
      save();
      publish();
      return { ok: false, error: msg };
    }

    function copy(text) {
      try {
        require('electron').clipboard.writeText(text);
        return true;
      } catch {
        return false;
      }
    }

    // After the click: confirm from the disk (the app writes SKILL.md, then its registry).
    let watcher = null;
    function watch() {
      if (watcher) return;
      watcher = setInterval(check, 10000);
    }
    function check() {
      const launched = data.suggestions.filter((x) => x.status === 'launched');
      if (!launched.length) {
        clearInterval(watcher);
        watcher = null;
        return;
      }
      const { tasks } = src.readExistingTasks();
      let changed = false;
      for (const x of launched) {
        const found = tasks.find((t) => t.id === x.taskId);
        const st = L.creationStatus(x, found, now());
        if (st.status === 'launched') continue;
        changed = true;
        if (st.status === 'created') {
          Object.assign(x, { status: 'created', cron: st.cron, frequence: L.describeCron(st.cron), confirmedAt: Date.now() });
          L.remember(data, x, 'created', now());
          data.created.unshift({ taskId: x.taskId, titre: x.titre, frequence: x.frequence, at: Date.now(), registered: !!found.registered });
          data.created = data.created.slice(0, 20);
          data.suggestions = data.suggestions.filter((y) => y.id !== x.id);
          ctx.log(`created ${x.taskId}`);
          ctx.react('love', 2400);
        } else {
          x.status = 'unconfirmed';
          x.error = 'Je ne vois pas la tâche dans Claude. As-tu envoyé la demande dans la session ouverte ?';
        }
      }
      if (changed) {
        save();
        publish();
      }
    }

    ctx.onAction('analyze', () => analyze({ manual: true }));
    ctx.onAction('analyzeFromSettings', async () => {
      const ok = await analyze({ manual: true });
      return ok ? (data.lastResult?.found ? `${data.lastResult.found} suggestion(s) dans l’îlot.` : `Rien à proposer pour l’instant. ${data.lastResult?.rien || ''}`) : error || 'Analyse impossible.';
    });
    ctx.onAction('edit', (p = {}) => {
      const x = find(p.id);
      if (x) {
        applyEdit(x, p);
        save();
      }
      return true; // no publish: the field is the source of truth while typing
    });
    ctx.onAction('setCron', (p = {}) => {
      const x = find(p.id);
      if (!x) return false;
      applyEdit(x, p);
      const bad = setCron(x, p);
      if (bad) return { ok: false, error: bad };
      x.error = null;
      save();
      publish();
      return { ok: true };
    });
    ctx.onAction('create', (p) => create(p));
    ctx.onAction('copy', (p = {}) => {
      const x = find(p.id);
      if (!x) return false;
      applyEdit(x, p);
      return copy(L.creationRequest(x));
    });
    ctx.onAction('refuse', (p = {}) => {
      const x = find(p.id);
      if (!x) return false;
      L.remember(data, x, 'refused', now());
      data.suggestions = data.suggestions.filter((y) => y.id !== x.id);
      if (!pending().length) ctx.dismissAlert('suggest');
      save();
      publish();
      ctx.react('shy', 2000);
      return true;
    });
    ctx.onAction('recheck', (p = {}) => {
      const x = find(p.id);
      if (x && x.status === 'unconfirmed') {
        Object.assign(x, { status: 'launched', launchedAt: Date.now(), error: null });
        save();
        watch();
        check();
        publish();
      }
      return true;
    });
    ctx.onAction('openTask', ({ taskId } = {}) => ctx.openPath(require('path').join(src.defaultTasksDir(), String(taskId || '').replace(/[^\w-]/g, ''))));
    ctx.onAction('open', () => ctx.focus(false));
    ctx.onAction('dismissError', () => {
      error = null;
      publish();
    });
    ctx.onAction('login', () => ctx.claude.openLoginTerminal());
    ctx.onAction('forgetRefused', () => {
      const n = data.memory.filter((m) => m.outcome === 'refused').length;
      data.memory = data.memory.filter((m) => m.outcome !== 'refused');
      save();
      return n ? `${n} refus oublié${n > 1 ? 's' : ''}.` : 'Aucun refus mémorisé.';
    });
    ctx.onSettings(() => publish());

    // The clock: look once a day (or week), late morning; announce when someone is there.
    const tick = () => {
      try {
        if (L.expire(data, now())) {
          save();
          publish();
        }
        if (!ctx.paused() && L.dueNow(now(), s(), data, { inCall: !!ctx.inCall?.() })) {
          analyze().catch((e) => ctx.log('analysis crashed', e));
        } else announce();
      } catch (err) {
        ctx.log('tick', err);
      }
    };
    const timer = setInterval(tick, L.MIN);
    const first = setTimeout(tick, 45000);
    if (data.suggestions.some((x) => x.status === 'launched')) watch();
    this._stop = () => {
      clearInterval(timer);
      clearTimeout(first);
      clearInterval(watcher);
    };
    publish();
  },

  dispose() {
    this._stop?.();
  },
};
