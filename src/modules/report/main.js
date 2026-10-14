// Bilan — at the end of the day, Gany drafts the report of the user's day for
// their managers. The user reads it, edits it in the island, then sends it (or not).
//
//   * Drafting: ONE headless Claude turn with the READ tools of the connectors it
//     found (Gmail sent mails, ClickUp, Google Chat) and Ambrosia's own data
//     (Claude Code sessions journaled from the hooks, today's meetings), passed as
//     clearly delimited data. JSON schema out. No write tool is ever available here.
//   * Sending: only on an explicit click + confirmation, as a separate turn whose
//     only allowed tool is Gmail's send_message (or create_draft for « Brouillon
//     Gmail »), with the user's exact text; the tool call's real arguments are
//     checked afterwards (logic.verifySend).
// Pure logic: ./logic.js (tested in tests/report.test.js).

const L = require('./logic');

const DEFAULT_STYLE = `Va à l'essentiel : des faits, des résultats, des décisions.
Pas de superlatifs ni d'autocongratulation.
Tutoiement ou vouvoiement : vouvoiement par défaut.`;

module.exports = {
  id: 'report',
  name: 'Bilan',
  icon: '✎',
  color: '#8FD3A8',
  order: 35,
  secondary: true,
  settings: [
    { key: 'auto', label: 'Rédiger le bilan automatiquement en fin de journée', type: 'boolean', default: true },
    { key: 'at', label: 'Heure du bilan', type: 'text', default: '17:30' },
    { key: 'days', label: 'Jours (un par ligne, ou une plage : lun-ven)', type: 'list', default: ['lun-ven'] },
    { key: 'to', label: 'Destinataires (une adresse par ligne)', type: 'list', default: [], help: 'Pré-remplis dans chaque bilan, modifiables avant l’envoi.' },
    { key: 'style', label: 'Consignes de style', type: 'textarea', default: DEFAULT_STYLE, help: 'Réinjectées telles quelles dans la demande de rédaction.' },
    { key: 'signature', label: 'Formule de signature', type: 'textarea', default: '' },
    { key: 'useMail', label: 'Lire mes mails envoyés du jour (Gmail)', type: 'boolean', default: true },
    { key: 'useClickup', label: 'Lire mes tâches et commentaires ClickUp du jour', type: 'boolean', default: true },
    { key: 'useChat', label: 'Lire mes messages Google Chat du jour', type: 'boolean', default: true },
    { key: 'model', label: 'Modèle de rédaction', type: 'select', default: 'sonnet', options: ['haiku', 'sonnet', 'opus'] },
    { key: 'chatConnector', label: 'Nom du connecteur Google Chat (vide = détection auto)', type: 'text', default: '' },
    { key: 'detect', type: 'button', label: 'Détecter les connecteurs', action: 'detect' },
  ],

  init(ctx) {
    // Lazy: tests load this file without Electron.
    const { store } = require('../../main/store');
    const data = ctx.data.load({ journal: { day: '', sessions: {} }, current: null, history: [], lastAuto: '', connectors: {}, detectedAt: 0 });
    data.journal ||= { day: '', sessions: {} };
    data.history ||= [];
    data.connectors ||= {};
    let busy = null; // 'drafting' | 'sending' | 'drafting-gmail'
    let error = null;
    let auth = false;

    const s = () => ctx.settings();
    const save = () => ctx.data.save(data);
    const now = () => new Date();

    function publish() {
      const d = data.current;
      ctx.setState({
        busy,
        error,
        auth,
        draft: d,
        history: data.history.slice(0, 7).map(({ body, ...h }) => h),
        nextAt: L.nextRun(now(), s()),
        connectors: connectors(),
        mood: busy ? { name: busy === 'sending' ? 'working' : 'thinking', priority: 12 } : null,
      });
    }

    // ── Claude Code journal, from the hooks ───────────────────────────────
    const onHook = (ev) => {
      try {
        if (L.recordHook(data.journal, ev.payload || {}, now())) save();
      } catch (err) {
        ctx.log('journal', err);
      }
    };
    ctx.hooks.on('hook', onHook);

    // ── Connectors: reuse what Courrier / ClickUp found, detect the rest ──
    function connectors() {
      const st = s();
      const known = (id) => store.get(id, 'connector') || store.loadData(id, {}).connector || '';
      return {
        gmail: st.useMail ? known('mail') || data.connectors.gmail || '' : '',
        clickup: st.useClickup ? known('clickup') || data.connectors.clickup || '' : '',
        chat: st.useChat ? st.chatConnector || data.connectors.chat || '' : '',
      };
    }

    async function detect() {
      const a = await ctx.claude.authStatus();
      if (!a.loggedIn) {
        auth = true;
        return null;
      }
      auth = false;
      const servers = (await ctx.claude.listMcp()).filter((m) => !/not configured|^×/i.test(m.status));
      const pick = (re) => servers.filter((m) => re.test(m.name)).sort((a, b) => /^claude\.ai /.test(b.name) - /^claude\.ai /.test(a.name))[0]?.name || '';
      data.connectors = { gmail: pick(/gmail/i), clickup: pick(/clickup/i), chat: pick(/google[\s_-]*chat|gchat|^claude\.ai chat$/i) };
      data.detectedAt = Date.now();
      save();
      ctx.log('connectors:', JSON.stringify(data.connectors));
      return data.connectors;
    }

    // ── Drafting ──────────────────────────────────────────────────────────
    async function draft({ manual = false } = {}) {
      if (busy) return false;
      busy = 'drafting';
      error = null;
      publish();
      try {
        let c = connectors();
        const missing = (s().useMail && !c.gmail) || (s().useClickup && !c.clickup) || (s().useChat && !c.chat);
        if (missing && (manual || Date.now() - (data.detectedAt || 0) > 24 * 3600000)) {
          await detect();
          c = connectors();
        }
        const t = now();
        const peers = ctx.peers();
        const agendaData = store.loadData('agenda', {});
        const local = {
          claude: L.claudeToday(data.journal, peers.claude?.sessions, t, peers.claude?.today?.turns),
          fichiersModifies: L.filesForPrompt(peers.claude?.today?.topFiles),
          reunions: L.meetingsToday(agendaData, t, store.get('agenda', 'ignoreTags') || []),
          compteurs: {
            tachesClaudeTerminees: peers.claude?.today?.finished || 0,
            sujetsTraitesDansAmbrosia: (peers.mail?.doneToday || 0) + (peers.clickup?.doneToday || 0),
          },
        };
        const prev = data.current;
        const sameDay = prev?.day === L.dayKey(t);
        const prompt = L.buildPrompt({
          now: t,
          connectors: c,
          local,
          settings: s(),
          selfEmail: agendaData.selfEmail || '',
          clickupMeId: store.loadData('clickup', {}).meId || '',
          excluded: sameDay ? prev.removed || [] : [],
        });
        const primary = c.gmail || c.clickup || c.chat || '';
        const res = await ctx.claude.run({
          prompt,
          systemPrompt: L.SYSTEM,
          model: s().model || 'sonnet',
          allowedTools: L.readAllowedTools(c, ctx.claude.mcpPrefix),
          jsonSchema: L.SCHEMA,
          ...(primary ? { requireMcp: primary } : {}),
          timeoutMs: 600000,
        });
        if (!res.ok || !res.structured) {
          auth = !!res.authError;
          error = res.mcpNotReady ? `Le connecteur ${primary} n’est pas prêt : réessaie dans quelques minutes.` : res.error || 'Réponse illisible';
          ctx.log('draft failed:', error);
          return false;
        }
        // A draft from another day that nobody sent or ignored: archived as is.
        if (prev && !sameDay) L.archive(data, 'expired', t);
        const sources = Object.entries(c).filter(([, v]) => v).map(([k]) => k);
        const recipients = sameDay ? prev.to : L.parseRecipients(s().to).to;
        data.current = L.fromStructured(res.structured, { now: t, to: recipients, sources });
        if (sameDay) data.current.removed = prev.removed || [];
        save();
        ctx.log(`draft ready: ${data.current.faits.length} faits, sources ${sources.join(',') || '-'}`);
        if (manual) ctx.focus(false);
        else announce();
        return true;
      } finally {
        busy = null;
        publish();
      }
    }

    /** The soft "it's ready" — only to someone who is at the desk. */
    function announce() {
      const d = data.current;
      if (!d || d.alerted || d.status !== 'ready') return;
      if (ctx.activity().idleMs > 10 * L.MIN) return;
      d.alerted = true;
      save();
      ctx.alert({
        key: 'ready',
        title: 'Ton bilan du jour est prêt',
        text: `${d.faits.length} point${d.faits.length > 1 ? 's' : ''} · à relire avant envoi`,
        mood: 'wink',
        sound: 'love',
        priority: 45,
        ttl: 16,
        actions: [{ label: 'Relire', action: 'open', primary: true }],
      });
    }

    // ── Editing ───────────────────────────────────────────────────────────
    function applyEdit(p = {}) {
      const d = data.current;
      if (!d) return null;
      if (p.to !== undefined) d.to = L.parseRecipients(p.to).to;
      if (typeof p.subject === 'string') d.subject = p.subject.slice(0, 300);
      if (typeof p.body === 'string') d.body = p.body.replace(/\r\n/g, '\n').slice(0, 20000);
      d.edited = true;
      return d;
    }

    // ── Sending / Gmail draft: explicit click only, one write tool per turn ──
    async function deliver(kind, payload) {
      if (busy) return { ok: false, error: 'Gany est occupé, réessaie dans un instant.' };
      const d = applyEdit(payload);
      if (!d) return { ok: false, error: 'Aucun bilan.' };
      const fail = (msg) => {
        d.error = msg;
        d.uncertain = false;
        save();
        publish();
        return { ok: false, error: msg };
      };
      const { to, bad } = L.parseRecipients(payload?.to ?? d.to);
      if (bad.length) return fail(`Adresse invalide : ${bad.join(', ')}`);
      if (!to.length) return fail('Aucun destinataire.');
      if (!d.subject.trim() || !d.body.trim()) return fail('L’objet et le texte ne peuvent pas être vides.');
      let gmail = connectors().gmail || store.get('mail', 'connector') || store.loadData('mail', {}).connector || data.connectors.gmail;
      if (!gmail) gmail = (await detect())?.gmail;
      if (!gmail) return fail('Aucun connecteur Gmail : connecte Gmail sur claude.ai.');

      const tool = ctx.claude.mcpPrefix(gmail) + L.WRITE_TOOLS[kind];
      const expected = { to, subject: d.subject, body: d.body };
      busy = kind === 'send' ? 'sending' : 'drafting-gmail';
      d.error = null;
      save();
      publish();
      let check;
      try {
        const res = await ctx.claude.run({
          prompt: L.sendPrompt(kind, expected),
          systemPrompt: L.SEND_SYSTEM,
          model: 'sonnet',
          allowedTools: [tool], // and nothing else
          jsonSchema: L.SEND_SCHEMA,
          requireMcp: gmail,
          timeoutMs: 180000,
        });
        check = L.verifySend(res, expected, tool);
        if (res.authError) auth = true;
      } finally {
        busy = null;
      }
      ctx.log(`${kind}: ok=${check.ok} uncertain=${check.uncertain}${check.error ? ' err=' + check.error : ''}`);
      if (!check.ok) {
        d.error = check.error;
        d.uncertain = check.uncertain;
        save();
        publish();
        return { ok: false, error: check.error };
      }
      if (kind === 'send') {
        d.messageId = check.id;
        L.archive(data, 'sent', now());
        ctx.react('finished', 2600, { sound: 'finish', confetti: true });
      } else {
        L.archive(data, 'draft', now());
        ctx.openExternal(check.viewUrl || 'https://mail.google.com/mail/u/0/#drafts');
        ctx.react('wink', 2400, { sound: 'love' });
      }
      ctx.dismissAlert('ready');
      save();
      publish();
      return { ok: true };
    }

    ctx.onAction('draftNow', () => draft({ manual: true }));
    ctx.onAction('regenerate', () => draft({ manual: true }));
    ctx.onAction('edit', (p) => {
      if (applyEdit(p)) save();
      return true; // no publish: the fields are the source of truth while typing
    });
    ctx.onAction('removeFact', ({ index, ...edit }) => {
      const d = applyEdit(edit);
      if (!d) return false;
      L.removeFact(d, Number(index));
      save();
      publish();
      return true;
    });
    ctx.onAction('send', (p) => deliver('send', p));
    ctx.onAction('gmailDraft', (p) => deliver('draft', p));
    ctx.onAction('ignore', () => {
      if (!data.current || busy) return false;
      L.archive(data, 'ignored', now());
      ctx.dismissAlert('ready');
      save();
      publish();
      ctx.react('shy', 2200);
      return true;
    });
    ctx.onAction('open', () => ctx.focus(false));
    ctx.onAction('openSent', () => ctx.openExternal('https://mail.google.com/mail/u/0/#sent'));
    ctx.onAction('dismissError', () => {
      error = null;
      publish();
    });
    ctx.onAction('login', () => ctx.claude.openLoginTerminal());
    ctx.onAction('detect', async () => {
      const c = await detect();
      publish();
      if (!c) return 'La CLI Claude n’est pas connectée : Réglages → Claude (IA) → Se connecter.';
      const names = Object.entries(c).filter(([, v]) => v).map(([, v]) => v);
      return names.length ? `Connecteurs trouvés : ${names.join(', ')}` : 'Aucun connecteur Gmail, ClickUp ou Google Chat. Connecte-les sur claude.ai (Paramètres → Connecteurs).';
    });
    ctx.onSettings(() => publish());

    // The clock: draft at the end of the working day, announce when someone is there.
    const tick = () => {
      try {
        if (!ctx.paused() && L.dueNow(now(), s(), data)) {
          data.lastAuto = L.dayKey(now());
          save();
          draft().catch((e) => ctx.log('draft crashed', e));
        } else announce();
      } catch (err) {
        ctx.log('tick', err);
      }
    };
    const timer = setInterval(tick, L.MIN);
    const first = setTimeout(tick, 30000);
    this._stop = () => {
      clearInterval(timer);
      clearTimeout(first);
      ctx.hooks.off('hook', onHook);
    };
    publish();
  },

  dispose() {
    this._stop?.();
  },
};
