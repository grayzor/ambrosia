// Triage engine — "watch a source, judge, only speak up for what matters".
//
// Courrier (Gmail) and ClickUp are two configurations of this engine. Each
// check is one headless Claude turn (`claude -p`, the user's subscription) that
// may only call the READ tools of one claude.ai connector, returns a strict JSON
// list of items, and Gany alerts on the important ones. Seen ids, the "Traité"
// list, feedback ("Pas important") and daily stats are handled here once.
//
//   module.exports = triage({ id, name, icon, color, order, source, connectorPattern,
//     readTools, systemPrompt, defaultRules, steps(ctx), normalize(raw), labels,
//     recap: { one, many } (wording of the « en appel » recap), ... })
//
// Source content is untrusted: the system prompt says so, the output is a JSON
// schema, only read tools are allowed, VIP / ignore lists are applied locally.
//
// Proposals (optional `cfg.proposer`): for a fresh important item, a second
// read-only turn prepares what the user would do (a reply, an invite, a ClickUp
// comment…). It shows on the card and in the alert; nothing leaves Ambrosia until
// the user clicks one of its actions, and each click runs exactly one write tool
// (`callTool`). When Gany cannot help, `make` returns null and the card stays as is.
//
//   proposer: { max, settings, eligible(item, s), make(c) → proposal | null,
//               apply(c) → { ok, error, url, done }, alert(item) → alert fields }
//   proposal: { headline, ask, analysis, read: { from, date, text },
//               text: { label, value }, actions: [{ act, label, primary, usesText }], data }

const ITEM_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Identifiant stable de l’élément (fil, commentaire…)' },
    from: { type: 'string', description: 'Qui en est à l’origine (nom, puis adresse entre <> si connue)' },
    title: { type: 'string', description: 'Sujet ou titre court' },
    context: { type: 'string', description: 'Où ça se passe (liste, projet, dossier…), court' },
    date: { type: 'string' },
    verdict: { type: 'string', enum: ['urgent', 'important', 'normal', 'noise'] },
    reason: { type: 'string', description: 'Pourquoi, en 12 mots max, en français' },
    summary: { type: 'string', description: 'Ce qu’on attend de l’utilisateur, une phrase, en français' },
    url: { type: 'string', description: 'Lien direct vers l’élément' },
  },
  required: ['id', 'from', 'title', 'verdict', 'reason'],
};

const lower = (s) => String(s || '').toLowerCase();
const matches = (from, list) => (list || []).some((x) => x && lower(from).includes(lower(x.trim())));
const shortFrom = (from) => String(from || '').replace(/<[^>]*>/, '').replace(/"/g, '').trim() || from;

const SEVERITY = { urgent: 3, important: 2, normal: 1, noise: 0 };
const FOLLOW_UP_MS = 30 * 60000; // a card replaced within this delay: its follow-up comes without a sound

/**
 * One item per group key, the most severe; ties go to the one with a real author.
 * The kept item's `count` adds up the messages of the group (an item may already
 * stand for several, `count` from the model).
 */
function collapse(items, key) {
  const best = new Map();
  const counts = new Map();
  const loose = [];
  for (const it of items) {
    const k = it && key(it);
    if (!k) {
      loose.push(it);
      continue;
    }
    counts.set(k, (counts.get(k) || 0) + (Number(it.count) || 1));
    const cur = best.get(k);
    const score = (x) => (SEVERITY[x.verdict] ?? 0) * 2 + (/^clickup$/i.test(String(x.from).trim()) ? 0 : 1);
    if (!cur || score(it) > score(cur)) best.set(k, it);
  }
  return [...[...best].map(([k, it]) => (counts.get(k) > 1 ? { ...it, count: counts.get(k) } : it)), ...loose];
}

const EXEC_SCHEMA = {
  type: 'object',
  properties: {
    done: { type: 'boolean', description: 'true si l’outil a réussi' },
    error: { type: 'string', description: 'Le message d’erreur de l’outil, sinon vide' },
    url: { type: 'string', description: 'Le lien renvoyé par l’outil (viewUrl, htmlLink, url), sinon vide' },
  },
  required: ['done'],
};

/**
 * Runs ONE write tool of a connector with exactly these arguments, because the
 * user just clicked for it. The turn may call nothing else. → { ok, error, url }
 */
async function callTool(ctx, server, tool, args) {
  const prefix = ctx.claude.mcpPrefix(server);
  const res = await ctx.claude.run({
    prompt: [
      `Appelle une seule fois l'outil ${tool} avec exactement ces arguments (JSON) :`,
      JSON.stringify(args),
      `N'appelle aucun autre outil et ne change aucun argument. Ensuite renvoie le JSON : done = true si l'outil a réussi, error = son message d'erreur sinon, url = le lien qu'il renvoie s'il y en a un.`,
    ].join('\n'),
    systemPrompt: 'Tu exécutes une action que l’utilisateur vient de valider d’un clic, telle quelle. Tu ne fais rien d’autre. Réponds uniquement avec le JSON demandé.',
    model: 'haiku',
    allowedTools: [prefix + tool],
    jsonSchema: EXEC_SCHEMA,
    requireMcp: server,
    timeoutMs: 120000,
  });
  if (!res.ok) return { ok: false, error: res.error || 'échec' };
  if (!(res.toolsUsed || []).includes(prefix + tool)) return { ok: false, error: `l’outil ${tool} n’a pas été appelé` };
  if (!res.structured?.done) return { ok: false, error: res.structured?.error || 'l’outil a échoué' };
  const url = String(res.structured.url || '');
  return { ok: true, url: /^https:\/\//.test(url) ? url : '' };
}

const delay = (ms) => {
  let t;
  const p = new Promise((r) => (t = setTimeout(r, ms)));
  p.cancel = () => clearTimeout(t);
  return p;
};

function inHours(spec, weekends) {
  const now = new Date();
  if (!weekends && (now.getDay() === 0 || now.getDay() === 6)) return false;
  const m = String(spec || '').match(/(\d{1,2})\s*-\s*(\d{1,2})/);
  if (!m) return true;
  const hr = now.getHours();
  return hr >= Number(m[1]) && hr < Number(m[2]);
}

/**
 * @param {object} cfg
 * @param {string} cfg.source            human name of the source ("Gmail", "ClickUp")
 * @param {RegExp} cfg.connectorPattern  matches the connector name in `claude mcp list`
 * @param {string[]} cfg.readTools       tool names (without the mcp__ prefix) the turn may call
 * @param {(c:{since:number, firstRun:boolean, settings:object, data:object}) => string} cfg.steps
 *                                       the tool-calling instructions for one check
 * @param {(raw:object, settings:object) => object} [cfg.normalize]  fix up one returned item
 * @param {(raw:object) => string} [cfg.groupBy]  items with the same key (e.g. the task url) are
 *                                       one card: the most severe one is kept, and it replaces an
 *                                       open card for the same key instead of stacking under it
 * @param {object} [cfg.extraSchema]     extra top-level output properties (e.g. me_id)
 * @param {object} [cfg.itemFields]      extra properties of each item (e.g. the Chat thread); they
 *                                       reach normalize / groupBy, which decide what is kept
 * @param {(structured:object, data:object) => void} [cfg.onStructured]
 * @param {(settings:object, data:object) => object} [cfg.variant]  overrides of source,
 *                                       connectorPattern, readTools, steps, systemPrompt and a
 *                                       `label` shown in the panel ("via …"), e.g. a fallback source
 * @param {(error:string, data:object, settings:object) => boolean} [cfg.onSourceError]  return
 *                                       true after switching variant to retry the check at once
 * @param {(error:string) => string} [cfg.explainError]  turns a tool error the turn reported
 *                                       (`source_error`) into a French explanation
 */
function triage(cfg) {
  const settings = [
    { key: 'intervalMin', label: 'Vérifier toutes les (minutes)', type: 'number', default: cfg.intervalMin || 10, help: 'Chaque vérification est un petit appel Claude sur ton abonnement.' },
    { key: 'activeHours', label: 'Heures de veille', type: 'text', default: '7-20', help: 'Format 7-20. En dehors, Gany ne vérifie que si tu le demandes.' },
    { key: 'weekends', label: 'Veiller aussi le week-end', type: 'boolean', default: false },
    { key: 'rules', label: 'Ce qui compte pour toi', type: 'textarea', default: cfg.defaultRules, help: 'Écris-le comme à un assistant humain. Plus c’est précis, meilleur est le tri.' },
    { key: 'vip', label: cfg.vipLabel || 'Toujours important (personnes, un par ligne)', type: 'list', default: [] },
    { key: 'ignore', label: cfg.ignoreLabel || 'Jamais important (personnes, un par ligne)', type: 'list', default: [] },
    ...(cfg.extraSettings || []),
    ...(cfg.proposer
      ? [
          { key: 'propose', label: cfg.proposer.label || 'Proposer une action quand Gany peut la préparer', type: 'boolean', default: true, help: 'Gany prépare, toi seul envoies : rien ne part sans ton clic.' },
          ...(cfg.proposer.settings || []),
          { key: 'proposeModel', label: 'Modèle des propositions', type: 'select', default: 'sonnet', options: ['haiku', 'sonnet', 'opus'] },
        ]
      : []),
    { key: 'model', label: 'Modèle de tri', type: 'select', default: 'haiku', options: ['haiku', 'sonnet'] },
    { key: 'connector', label: `Nom du connecteur ${cfg.source} (vide = détection auto)`, type: 'text', default: '' },
    { key: 'detect', type: 'button', label: `Détecter le connecteur ${cfg.source}`, action: 'detect' },
  ];

  const schema = {
    type: 'object',
    properties: {
      found: { type: 'number', description: 'Nombre total d’éléments examinés dans la fenêtre, importants ou non' },
      items: { type: 'array', items: cfg.itemFields ? { ...ITEM_SCHEMA, properties: { ...ITEM_SCHEMA.properties, ...cfg.itemFields } } : ITEM_SCHEMA },
      source_error: { type: 'string', description: 'Vide, sauf si un outil a renvoyé une erreur qui empêche la vérification : recopie alors son message' },
      ...(cfg.extraSchema || {}),
    },
    required: ['found', 'items'],
  };

  return {
    id: cfg.id,
    name: cfg.name,
    icon: cfg.icon,
    logo: cfg.logo,
    color: cfg.color,
    order: cfg.order,
    recap: cfg.recap,
    settings,

    init(ctx) {
      const data = ctx.data.load({ seen: {}, items: [], feedback: [], lastCheck: 0, connector: '', stats: {} });
      // Older Courrier data called the title "subject".
      for (const i of data.items) if (!i.title && i.subject) i.title = i.subject;
      for (const f of data.feedback) if (!f.title && f.subject) f.title = f.subject;
      data.rejected ||= [];
      let timer = null;
      let retryTimer = null;
      let checking = false;
      let deferred = false; // a check skipped by a pause or a locked session, run at resume
      let proposing = 0;
      const busy = new Map(); // item id → action running
      let disposed = false;

      const today = () => new Date().toISOString().slice(0, 10);
      const stats = () => (data.stats[today()] ||= { checked: 0, important: 0 });
      // A module may read another source for a while (cfg.variant): the detected
      // connector is remembered with the source it belongs to.
      const cur = () => ({ ...cfg, ...(cfg.variant?.(ctx.settings(), data) || {}) });
      const connectorName = () => {
        const c = cur();
        if (c.source === cfg.source && ctx.settings().connector) return ctx.settings().connector;
        return (data.connectorSource || cfg.source) === c.source ? data.connector || '' : '';
      };

      const save = () => {
        const cutoff = Date.now() - 14 * 86400000;
        for (const [id, ts] of Object.entries(data.seen)) if (ts < cutoff) delete data.seen[id];
        data.items = data.items.slice(0, 80);
        // A handled item no longer needs its draft nor the mail text.
        for (const i of data.items) if (i.done && i.proposal) delete i.proposal;
        for (const d of Object.keys(data.stats)) if (d !== today()) delete data.stats[d];
        ctx.data.save(data);
      };

      const publish = (patch = {}) => {
        const shown = data.items.filter((i) => i.verdict !== 'noise' && !i.done);
        const unread = shown.filter((i) => !i.read);
        const urgent = unread.some((i) => i.verdict === 'urgent');
        ctx.setState({
          items: shown.slice(0, 25).map((i) => (busy.has(i.id) ? { ...i, busy: busy.get(i.id) } : i)),
          doneToday: data.items.filter((i) => i.done && i.doneAt > Date.now() - 86400000).length,
          unread: unread.length,
          lastCheck: data.lastCheck,
          connector: connectorName(),
          via: cur().label || null,
          stats: stats(),
          checking,
          proposing,
          mood: unread.length ? { name: cfg.mood || 'mail', priority: urgent ? 75 : 60 } : checking ? { name: 'thinking', priority: 5 } : null,
          ...patch,
        });
      };

      async function detect() {
        const c = cur();
        publish({ status: 'detecting' });
        // claude.ai connectors only load for a signed-in CLI: check that first.
        const auth = await ctx.claude.authStatus();
        if (!auth.loggedIn) {
          publish({ status: 'auth', error: auth.error || 'CLI Claude non connectée' });
          return null;
        }
        const servers = await ctx.claude.listMcp();
        // Prefer the claude.ai connector; plugin stubs ("Not configured") never work.
        const found = servers
          .filter((s) => c.connectorPattern.test(s.name) && !/not configured|^×/i.test(s.status))
          .sort((a, b) => /^claude\.ai /.test(b.name) - /^claude\.ai /.test(a.name))[0];
        if (found) {
          data.connector = found.name;
          data.connectorSource = c.source;
          save();
          ctx.log('connector:', found.name, found.status);
          publish({ status: 'ok', error: null });
          return found.name;
        }
        ctx.log(`no ${c.source} connector among`, servers.map((s) => s.name).join(', ') || '(none)');
        publish({ status: 'no-connector', error: `Aucun connecteur ${c.source} trouvé dans Claude Code.` });
        return null;
      }

      function prompt(since, firstRun) {
        const s = ctx.settings();
        const fb = data.feedback.slice(-25);
        return [
          cur().steps({ since, firstRun, settings: s, data }),
          `Ensuite, renvoie le JSON : found = le nombre total d'éléments examinés, items = un objet par élément (au minimum tous les "important" et "urgent", idéalement aussi les autres). Si rien, renvoie {"found": 0, "items": []}. Si un outil renvoie une erreur qui empêche la vérification (accès refusé, service non activé…), n'invente rien : renvoie {"found": 0, "items": [], "source_error": "<le message d'erreur>"}.`,
          '',
          `## Les critères de l'utilisateur`,
          s.rules || cfg.defaultRules,
          s.vip?.length ? `\nToujours importants : ${s.vip.join(', ')}` : '',
          s.ignore?.length ? `\nJamais importants : ${s.ignore.join(', ')}` : '',
          fb.length ? `\n## Ses corrections passées (apprends-en)\n${fb.map((f) => `- "${f.title}" de ${f.from} → ${f.verdict === 'important' ? 'IMPORTANT' : 'pas important'}`).join('\n')}` : '',
        ]
          .filter((x) => x !== '')
          .join('\n');
      }

      /** The notch moment of one item; with a proposal, its text and buttons. */
      function itemAlert(item, withSound) {
        const p = item.proposal;
        ctx.alert({
          key: item.id,
          from: shortFrom(item.from),
          title: item.title,
          text: p ? `${p.headline} — ${p.ask || item.summary || item.reason}` : item.summary || item.reason,
          mood: cfg.mood || 'mail',
          sound: withSound ? 'mail' : null,
          priority: item.verdict === 'urgent' ? 80 : 60,
          ttl: p ? 25 : item.verdict === 'urgent' ? 30 : 14,
          actions: p ? [{ label: 'Voir', action: 'show', payload: { id: item.id }, primary: true }] : undefined,
          // The proposer may word the moment itself (e.g. a one-click invite).
          ...(p && cfg.proposer.alert ? cfg.proposer.alert(item) : {}),
        });
      }

      /** A read-only turn that prepares what the user would do. → true if Gany has something. */
      async function propose(item) {
        const s = ctx.settings();
        const server = connectorName();
        if (!server) return false;
        proposing++;
        publish();
        try {
          const p = await cfg.proposer.make({
            item,
            ctx,
            settings: s,
            data,
            server,
            prefix: ctx.claude.mcpPrefix(server),
            model: s.proposeModel || 'sonnet',
            rejected: data.rejected.slice(-15),
          });
          if (!p || !Array.isArray(p.actions) || !p.actions.length || disposed) return false;
          item.proposal = p;
          item.proposalAt = Date.now();
          item.applied = {};
          save();
          ctx.log(`proposal for ${item.id}: ${p.actions.map((a) => a.act).join(', ')}`);
          return true;
        } catch (err) {
          ctx.log('proposal crashed', err);
          return false;
        } finally {
          proposing--;
          if (!disposed) publish();
        }
      }

      async function check(manual = false, retried = false) {
        if (checking) return;
        const s = ctx.settings();
        const c = cur();
        if (!manual && ctx.locked?.()) {
          deferred = true; // the status stays as it was: « vérifié il y a… »
          return;
        }
        if (!manual && (ctx.paused() || !inHours(s.activeHours, s.weekends))) {
          if (ctx.paused()) deferred = true;
          publish({ status: 'off-hours' });
          return;
        }
        let server = connectorName();
        if (!server) server = await detect();
        if (!server) return;

        checking = true;
        publish({ status: 'checking' });
        const firstRun = !data.lastCheck;
        // A little overlap: sources index with a lag; seen ids dedupe the rest.
        const since = firstRun ? Date.now() - (cfg.lookbackHours || 12) * 3600000 : data.lastCheck - 5 * 60000;
        const prefix = ctx.claude.mcpPrefix(server);
        const startedAt = Date.now();
        const res = await ctx.claude.run({
          prompt: prompt(since, firstRun),
          systemPrompt: c.systemPrompt,
          model: s.model || 'haiku',
          allowedTools: c.readTools.map((t) => prefix + t),
          jsonSchema: schema,
          requireMcp: server,
          timeoutMs: 300000,
        });
        checking = false;

        if (!res.ok) {
          const status = res.authError ? 'auth' : res.mcpNotReady ? 'no-connector' : 'error';
          ctx.log('check failed:', status, res.error);
          publish({ status, error: res.error });
          // A connector still connecting is usually ready a few minutes later.
          if (res.mcpNotReady) {
            clearTimeout(retryTimer);
            retryTimer = setTimeout(() => check(manual).catch(() => {}), 3 * 60000);
          }
          return;
        }
        let raw = Array.isArray(res.structured?.items) ? res.structured.items : [];
        // The source refused (access disabled, quota…): say so instead of "nothing important",
        // and keep the window open for the next try.
        const srcErr = String(res.structured?.source_error || '').trim();
        if (srcErr && !raw.length) {
          ctx.log('source error:', srcErr);
          // The module can switch to another source (Google Chat → its reminder mails) and retry at once.
          if (!retried && cfg.onSourceError?.(srcErr, data, s)) {
            save();
            return check(manual, true);
          }
          publish({ status: 'error', error: cfg.explainError ? cfg.explainError(srcErr) : srcErr });
          return;
        }
        if (cfg.groupBy) raw = collapse(raw, cfg.groupBy);
        cfg.onStructured?.(res.structured || {}, data);
        data.lastCheck = startedAt;
        const fresh = [];
        const followUps = new Set(); // continue a card signalled a moment ago: no second sound
        // Items the model examined but did not list still count as triaged.
        const unlisted = Math.max(0, (Number(res.structured?.found) || 0) - raw.length);
        stats().checked += firstRun ? unlisted : Math.min(unlisted, 50);
        for (const r of raw) {
          if (!r?.id || data.seen[r.id]) continue;
          data.seen[r.id] = Date.now();
          stats().checked++;
          let verdict = r.verdict;
          if (matches(r.from, s.vip)) verdict = verdict === 'urgent' ? 'urgent' : 'important';
          if (matches(r.from, s.ignore)) verdict = 'noise';
          if (verdict !== 'important' && verdict !== 'urgent') continue;
          const item = {
            id: r.id,
            from: r.from || '',
            title: r.title || '(sans titre)',
            context: r.context || '',
            date: r.date || '',
            verdict,
            reason: r.reason || '',
            summary: r.summary || '',
            url: r.url || '',
            at: Date.now(),
            read: false,
            ...(cfg.normalize ? cfg.normalize(r, s) : {}),
          };
          if (Number(r.count) > 1) item.messages = Math.min(99, Math.round(Number(r.count)));
          if (cfg.groupBy) item.group = cfg.groupBy(r) || '';
          // Same id, or an open card about the same thing: the new one replaces it and
          // takes its messages along (people send several short messages in a row).
          const replaced = data.items.filter((i) => i.id === item.id || (item.group && i.group === item.group && !i.done));
          for (const old of replaced) {
            if (old.id === item.id) continue;
            item.messages = Math.min(99, (item.messages || 1) + (old.messages || 1));
            if (Date.now() - (old.at || 0) < FOLLOW_UP_MS) followUps.add(item.id);
            ctx.dismissAlert(old.id);
          }
          data.items = data.items.filter((i) => !replaced.includes(i));
          data.items.unshift(item);
          fresh.push(item);
          stats().important++;
        }
        save();
        ctx.log(`checked ${res.structured?.found ?? raw.length} items (${raw.length} listed), ${fresh.length} important, ${Date.now() - startedAt}ms`);

        const single = fresh.length === 1 || (fresh.length > 1 && !firstRun);
        // Gany prepares the reply before calling the user over, so both come together;
        // a slow proposal still gets its own (silent) moment when it lands.
        const alerted = new Set();
        if (cfg.proposer && s.propose !== false) {
          const eligible = fresh.filter((i) => !cfg.proposer.eligible || cfg.proposer.eligible(i, s)).slice(0, cfg.proposer.max || 3);
          const jobs = eligible.map((item) =>
            propose(item).then((ok) => {
              if (ok && alerted.has(item.id) && !item.read && !item.done) itemAlert(item, false);
            }),
          );
          if (jobs.length) {
            const budget = delay(cfg.proposer.budgetMs ?? 90000);
            await Promise.race([Promise.all(jobs), budget]);
            budget.cancel();
          }
        }

        if (single) {
          // Each important item gets its own moment in the notch (three at most).
          for (const item of fresh.slice(0, 3).reverse()) {
            itemAlert(item, !followUps.has(item.id));
            alerted.add(item.id);
          }
        } else if (fresh.length > 1) {
          ctx.alert({
            key: 'digest',
            title: cfg.labels.digest(fresh.length),
            count: fresh.length,
            text: fresh.map((i) => i.title).join(' · '),
            mood: cfg.mood || 'mail',
            sound: 'mail',
            priority: 60,
            ttl: 14,
          });
        }
        publish({ status: 'ok', error: null });
      }

      function schedule() {
        clearTimeout(timer);
        const min = Math.max(2, Number(ctx.settings().intervalMin) || cfg.intervalMin || 10);
        timer = setTimeout(async () => {
          await check(false).catch((e) => ctx.log('check crashed', e));
          schedule();
        }, min * 60000);
        publish({ nextCheck: Date.now() + min * 60000 });
      }

      const shownCount = () => data.items.filter((i) => i.verdict !== 'noise' && !i.done).length;
      /** The list just went from something to nothing: Gany stretches with relief. */
      function celebrateIfEmpty(before) {
        if (before > 0 && shownCount() === 0) ctx.react?.('relief', 2800, { sound: 'love' });
      }

      function mark(id, patch) {
        const before = shownCount();
        const item = data.items.find((i) => i.id === id);
        if (item) Object.assign(item, patch);
        ctx.dismissAlert(id);
        save();
        publish();
        celebrateIfEmpty(before);
        return item;
      }

      function feedback(id, verdict) {
        const item = data.items.find((i) => i.id === id);
        if (!item) return;
        data.feedback.push({ from: item.from, title: item.title, verdict });
        data.feedback = data.feedback.slice(-40);
        mark(id, verdict === 'noise' ? { verdict: 'noise' } : { read: true });
      }

      ctx.onAction('refresh', () => check(true).then(schedule));
      ctx.onAction('detect', async () => {
        const name = await detect();
        if (name) return `Connecteur trouvé : ${name}`;
        if (ctx.getState().status === 'auth') return 'La CLI Claude n’est pas connectée : Réglages → Claude (IA) → Se connecter.';
        return `Aucun connecteur ${cur().source}. Connecte-le sur claude.ai (Paramètres → Connecteurs) puis réessaie.`;
      });
      ctx.onAction('open', ({ id }) => {
        const item = mark(id, { read: true });
        if (item?.url && /^https:\/\//.test(item.url)) ctx.openExternal(item.url);
      });
      ctx.onAction('read', ({ id }) => mark(id, { read: true }));
      ctx.onAction('readAll', () => {
        data.items.forEach((i) => (i.read = true));
        save();
        publish();
      });
      // "Traité" : the item leaves the list for good.
      ctx.onAction('done', ({ id }) => mark(id, { read: true, done: true, doneAt: Date.now() }));
      ctx.onAction('doneAll', () => {
        const before = shownCount();
        for (const i of data.items) {
          if (i.done || i.verdict === 'noise') continue;
          Object.assign(i, { read: true, done: true, doneAt: Date.now() });
          ctx.dismissAlert(i.id);
        }
        save();
        publish();
        celebrateIfEmpty(before);
      });
      ctx.onAction('undoDone', () => {
        const last = data.items.filter((i) => i.done).sort((a, b) => b.doneAt - a.doneAt)[0];
        if (last) last.done = false;
        save();
        publish();
      });
      // « Confier à Claude » launched a session about it: noted on the card, not "Traité".
      ctx.onAction('delegated', ({ id }) => mark(id, { read: true, delegatedAt: Date.now() }));
      // ── Proposals: shown by the alert, applied one click at a time ──
      ctx.onAction('show', ({ id }) => {
        mark(id, { read: true });
        ctx.focus?.(false);
      });
      ctx.onAction('apply', async ({ id, act, text }) => {
        const item = data.items.find((i) => i.id === id);
        const p = item?.proposal;
        // Only an action Gany proposed, once at a time per item.
        const action = p?.actions.find((a) => a.act === act);
        if (!action || busy.has(id) || item.applied?.[act]?.ok) return null;
        if (action.usesText && p.text) {
          const t = String(text ?? p.text.value).trim();
          if (!t) return 'Le texte est vide.';
          p.text.value = t;
        }
        busy.set(id, act);
        publish();
        let res;
        try {
          res = await cfg.proposer.apply({ act, item, proposal: p, text: p.text?.value || '', ctx, settings: ctx.settings(), data, server: connectorName() });
        } catch (err) {
          res = { ok: false, error: err.message };
        }
        busy.delete(id);
        if (disposed) return null;
        (item.applied ||= {})[act] = { ok: !!res?.ok, at: Date.now(), error: res?.ok ? '' : res?.error || 'échec' };
        if (res?.ok) {
          ctx.log(`applied ${act} on ${id}`);
          if (res.url) ctx.openExternal(res.url);
          const before = shownCount();
          Object.assign(item, { read: true });
          if (res.done) Object.assign(item, { done: true, doneAt: Date.now() });
          ctx.dismissAlert(id);
          save();
          publish();
          if (res.done && before > 0 && shownCount() === 0) celebrateIfEmpty(before);
          else ctx.react?.('wink', 2200, { sound: 'love' });
        } else {
          ctx.log(`apply ${act} on ${id} failed:`, res?.error);
          save();
          publish();
        }
        return res?.ok ? null : res?.error || 'échec';
      });
      // "Pas utile" on a proposal: it goes, and the next ones learn from it.
      ctx.onAction('dismissProposal', ({ id }) => {
        const item = data.items.find((i) => i.id === id);
        if (!item?.proposal) return;
        data.rejected.push({ from: item.from, title: item.title, what: item.proposal.headline || '' });
        data.rejected = data.rejected.slice(-30);
        delete item.proposal;
        save();
        publish();
      });

      ctx.onAction('notImportant', ({ id }) => feedback(id, 'noise'));
      ctx.onAction('important', ({ id }) => feedback(id, 'important'));
      ctx.onAction('login', () => ctx.claude.openLoginTerminal());

      ctx.onSettings(() => schedule());
      // Back from a lock or a pause (the host staggers the modules): the skipped check now.
      ctx.onResume?.(() => {
        if (!deferred) return;
        deferred = false;
        check(false).catch((e) => ctx.log('check crashed', e));
      });
      // A proposal or an action still running when the module stops must not write
      // over the data of the next instance.
      this._dispose = () => (disposed = true);
      this._stop = () => {
        clearTimeout(timer);
        clearTimeout(retryTimer);
      };

      publish({ status: data.lastCheck ? 'ok' : 'idle' });
      // First check shortly after launch (staggered per module), then on the interval.
      timer = setTimeout(async () => {
        await check(false).catch((e) => ctx.log('check crashed', e));
        schedule();
      }, cfg.firstDelayMs ?? 20000);
    },

    dispose() {
      this._dispose?.();
      this._stop?.();
    },
  };
}

module.exports = { triage, inHours, shortFrom, collapse, callTool };
