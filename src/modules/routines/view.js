// Routines panel. mount/update: one card per suggestion, built once and kept in
// place, so the prompt being edited survives every state push. A card's prompt is
// only rewritten when the main process changed it itself (`rev`).

const SOURCE = {
  claude: { label: 'Claude Code', cls: '' },
  mail: { label: 'Mail', cls: '.gold' },
  agenda: { label: 'Agenda', cls: '' },
  clickup: { label: 'ClickUp', cls: '.blue' },
  chat: { label: 'Chat', cls: '.ok' },
  ambrosia: { label: 'Ambrosia', cls: '' },
};
const COLOR = '#6FC8D8';

let els = null;

const shortTool = (t) => String(t).replace(/^mcp__.+?__/, '');
const plural = (n, one, many = one + 's') => `${n} ${n > 1 ? many : one}`;
const pad = (n) => String(n).padStart(2, '0');

/** Same as logic.rhythmOf (the view is an ES module and cannot require it). */
function rhythmOf(expr) {
  const f = String(expr || '').trim().split(/\s+/);
  if (f.length !== 5) return null;
  const [mi, ho, dom, mon, dow] = f;
  if (!/^\d+$/.test(mi) || mon !== '*') return null;
  if (ho === '*' && dom === '*' && dow === '*') return { rhythm: 'hourly', time: `00:${pad(mi)}` };
  if (!/^\d+$/.test(ho)) return null;
  const time = `${pad(ho)}:${pad(mi)}`;
  if (dom === '1' && dow === '*') return { rhythm: 'monthly', time };
  if (dom !== '*') return null;
  const map = { '1-5': 'workdays', '*': 'daily', 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri' };
  return map[dow] ? { rhythm: map[dow], time } : null;
}

export default {
  summary(st) {
    if (st.busy === 'analyzing') return { dots: [{ color: COLOR, pulse: true }], text: 'Gany cherche ce qui se répète…' };
    const p = st.suggestions || [];
    if (!p.length) return null;
    const launched = p.filter((x) => x.status === 'launched').length;
    if (launched === p.length) return { dots: [{ color: COLOR, pulse: true }], text: 'Une tâche planifiée attend ton envoi dans Claude' };
    return {
      dots: [{ color: COLOR }],
      badge: { text: '↻', color: COLOR },
      count: p.length,
      text: p.length > 1 ? `Gany te propose ${p.length} tâches à confier à Claude` : `À confier à Claude : ${p[0].titre}`,
    };
  },

  mount(root, ui) {
    const { h } = ui;
    const top = h('div');
    const list = h('div');
    const created = h('div');
    root.append(top, list, created);
    els = { top, list, created, cards: new Map(), st: {}, ui };
  },

  update(root, st, ui) {
    if (!els) return;
    els.st = st;
    els.ui = ui;
    const { h } = ui;
    const p = st.suggestions || [];

    // Header, empty state, error
    const last = st.lastResult;
    ui.mount(
      els.top,
      h('div.row', { style: { marginBottom: '6px' } },
        h('span.title.grow', 'Tâches à confier à Claude'),
        st.lastRun ? h('span.faint.small', `analysé ${ui.ago(st.lastRun)}`) : null,
        h('button.btn.sm' + (p.length ? '.ghost' : ''), { disabled: !!st.busy || p.length >= 3, title: p.length >= 3 ? 'Réponds d’abord aux suggestions en attente' : '', onclick: () => ui.action('analyze') },
          st.busy === 'analyzing' ? 'Analyse…' : 'Analyser maintenant'),
      ),
      st.error
        ? h('div.card', { style: { marginBottom: '8px', borderColor: 'rgba(240,97,109,.4)' } },
            h('div.small', { style: { color: '#FF9AA3' } }, st.error),
            h('div.btns', { style: { marginTop: '6px' } },
              st.auth ? h('button.btn.sm', { onclick: () => ui.action('login') }, 'Se connecter') : null,
              h('button.btn.sm.ghost', { onclick: () => ui.action('dismissError') }, 'OK'),
            ))
        : null,
      p.length
        ? null
        : h('div.card.empty',
            h('div', st.busy === 'analyzing' ? 'Gany relit tes dernières semaines…' : 'Rien à confier à Claude pour l’instant.'),
            h('div.small', { style: { marginTop: '4px' } },
              st.busy === 'analyzing'
                ? 'Mails, réunions, ClickUp, sessions Claude Code : ce qui revient sans demander ta décision. Une à deux minutes.'
                : last?.rien
                  ? last.rien
                  : st.cadence === 'manuel'
                    ? 'Analyse automatique coupée : lance-la quand tu veux.'
                    : `Gany regarde ${st.cadence === 'semaine' ? 'chaque lundi' : 'chaque jour ouvré'} en fin de matinée ce qui se répète, et te propose de le confier à une tâche planifiée de Claude.`),
          ),
    );

    // Suggestion cards, kept in place
    const ids = new Set(p.map((x) => x.id));
    for (const [id, c] of els.cards) if (!ids.has(id)) {
      c.root.remove();
      els.cards.delete(id);
    }
    p.forEach((x, i) => {
      let c = els.cards.get(x.id);
      if (!c) {
        c = buildCard(ui, x);
        els.cards.set(x.id, c);
      }
      // Moved only when out of place: moving a node would blur the prompt being typed.
      if (els.list.children[i] !== c.root) els.list.insertBefore(c.root, els.list.children[i] || null);
      fillCard(ui, c, x, st);
    });

    // Recently created
    const done = st.created || [];
    ui.mount(
      els.created,
      done.length
        ? h('div', { style: { marginTop: '12px' } },
            h('div.faint.small', { style: { margin: '0 0 4px 2px' } }, 'Créées depuis Ambrosia'),
            h('div.list', done.map((t) => h('div.row.small',
              h('span.pill.ok', { style: { flex: 'none' } }, 'Créée'),
              h('span.ellipsis.grow', t.titre),
              h('span.faint', { style: { flex: 'none' } }, t.frequence || ''),
              h('button.btn.ghost.sm', { style: { flex: 'none' }, title: 'Ouvrir le dossier de la tâche', onclick: () => ui.action('openTask', { taskId: t.taskId }) }, '↗'),
            ))),
          )
        : null,
    );
    ui.relayout();
  },
};

function buildCard(ui, x) {
  const { h } = ui;
  const c = { id: x.id, rev: null, editingCron: false, open: false, timer: null };
  c.head = h('div');
  c.freq = h('div', { style: { marginTop: '8px' } });
  c.tools = h('div', { style: { marginTop: '6px' } });
  c.prompt = h('textarea.text.mono', {
    rows: 12,
    spellcheck: false,
    style: { resize: 'vertical', lineHeight: '1.35', fontSize: '11.5px', marginTop: '4px' },
    onfocus: () => ui.focusWindow(),
    onblur: () => flush(c),
    oninput: () => {
      clearTimeout(c.timer);
      c.timer = setTimeout(() => flush(c), 600);
    },
  });
  c.toggle = h('button.btn.ghost.sm', { style: { marginTop: '6px' }, onclick: () => { c.open = !c.open; fillCard(els.ui, c, current(c), els.st); els.ui.relayout(); } });
  c.promptBox = h('div', c.prompt, h('div.faint.small', { style: { marginTop: '3px' } }, 'Ambrosia ajoute à la fin un rappel des garde-fous : rien n’est envoyé, supprimé ni partagé.'));
  c.status = h('div', { style: { marginTop: '6px' } });
  c.controls = h('div.btns.end', { style: { marginTop: '8px' } });
  c.root = h('div.card', c.head, c.freq, c.tools, c.toggle, c.promptBox, c.status, c.controls);
  return c;
}

const current = (c) => (els.st.suggestions || []).find((x) => x.id === c.id) || {};

function flush(c) {
  clearTimeout(c.timer);
  return els.ui.action('edit', { id: c.id, prompt: c.prompt.value });
}

function fillCard(ui, c, x, st) {
  const { h } = ui;
  if (c.rev !== x.rev) {
    c.prompt.value = x.prompt || '';
    c.rev = x.rev;
  }
  const src = SOURCE[x.source] || SOURCE.ambrosia;
  const occ = x.occurrences || [];
  ui.mount(
    c.head,
    h('div.row', { style: { alignItems: 'flex-start' } },
      h('span.title.grow', { style: { lineHeight: '1.3' } }, x.titre),
      h('span.pill' + src.cls, { style: { flex: 'none' } }, src.label),
    ),
    h('div.small.dim', { style: { marginTop: '4px', lineHeight: '1.4' } }, x.pourquoi),
    occ.length
      ? h('div.small.faint', { style: { marginTop: '4px', lineHeight: '1.4' } },
          occ.slice(0, 4).map((o) => h('div', `· ${o}`)),
          occ.length > 4 ? h('div', `· et ${plural(occ.length - 4, 'autre')}`) : null)
      : null,
  );

  // Frequency, and its editor
  const r = rhythmOf(x.cron);
  ui.mount(
    c.freq,
    h('div.row',
      h('span.pill.gold', { style: { flex: 'none' } }, '◷'),
      h('span.small.grow', x.frequence),
      x.gain ? h('span.small.faint', { style: { flex: 'none' } }, x.gain) : null,
      x.status === 'launched' ? null : h('button.btn.ghost.sm', { style: { flex: 'none' }, onclick: () => { c.editingCron = !c.editingCron; fillCard(els.ui, c, current(c), els.st); els.ui.relayout(); } }, c.editingCron ? 'Fermer' : 'Modifier la fréquence'),
    ),
    c.editingCron ? cronEditor(ui, c, x, st, r) : null,
  );

  ui.mount(
    c.tools,
    h('div.row', { style: { flexWrap: 'wrap', gap: '4px' } },
      h('span.faint.small', 'Outils :'),
      (x.outils || []).length ? x.outils.map((t) => h('span.pill', { title: t }, shortTool(t))) : h('span.faint.small', 'aucun'),
    ),
  );

  c.toggle.textContent = c.open ? 'Masquer le prompt' : 'Voir et modifier le prompt';
  c.promptBox.style.display = c.open ? '' : 'none';

  const busy = x.status === 'launched';
  ui.mount(
    c.status,
    x.status === 'launched'
      ? h('div.small', { style: { color: '#A9D2FF', lineHeight: '1.4' } },
          'Une session Claude Code s’est ouverte dans l’app Claude avec la demande de création : envoie-la (Entrée) pour créer la tâche. Gany vérifie qu’elle apparaît…')
      : x.error
        ? h('div.small', { style: { color: x.status === 'unconfirmed' ? '#F8DC6C' : '#FF9AA3', lineHeight: '1.4' } }, x.error)
        : null,
  );
  ui.mount(
    c.controls,
    h('button.btn.sm.ghost', { disabled: busy, onclick: () => ui.action('refuse', { id: x.id }) }, 'Pas intéressé'),
    h('button.btn.sm.ghost', {
      title: 'Copier la demande de création, pour la coller dans une session Claude',
      onclick: async (e) => {
        const btn = e.currentTarget;
        const ok = await ui.action('copy', { id: x.id, prompt: c.prompt.value });
        if (!ok) return;
        btn.textContent = 'Copié ✓';
        ui.flash?.('wink', 1200);
        setTimeout(() => (btn.textContent = 'Copier'), 1800);
      },
    }, 'Copier'),
    x.status === 'unconfirmed' ? h('button.btn.sm', { onclick: () => ui.action('recheck', { id: x.id }) }, 'Vérifier à nouveau') : null,
    h('button.btn.sm.primary', {
      disabled: busy,
      onclick: async () => {
        clearTimeout(c.timer);
        await ui.action('create', { id: x.id, prompt: c.prompt.value });
      },
    }, x.status === 'unconfirmed' || x.status === 'error' ? 'Relancer la création' : 'Créer la tâche planifiée'),
  );
}

function cronEditor(ui, c, x, st, r) {
  const { h } = ui;
  const rhythms = st.rhythms || [];
  const custom = !r;
  const sel = h('select.text', { style: { width: 'auto', height: '26px' } },
    rhythms.map((o) => h('option', { value: o.id, selected: r?.rhythm === o.id }, o.label)),
    h('option', { value: 'cron', selected: custom }, 'Cron personnalisé'),
  );
  const time = h('input.text', { type: 'time', value: r?.time || '08:30', style: { width: '96px', height: '26px' }, onfocus: () => ui.focusWindow() });
  const cron = h('input.text.mono', { type: 'text', value: x.cron, spellcheck: false, style: { width: '140px', height: '26px' }, onfocus: () => ui.focusWindow() });
  const msg = h('span.small', { style: { color: '#FF9AA3' } });
  const sync = () => {
    const isCron = sel.value === 'cron';
    cron.style.display = isCron ? '' : 'none';
    time.style.display = isCron ? 'none' : '';
  };
  sel.addEventListener('change', sync);
  sync();
  return h('div.row', { style: { marginTop: '6px', flexWrap: 'wrap', gap: '6px' } },
    sel, time, cron,
    h('button.btn.sm', {
      onclick: async () => {
        const payload = sel.value === 'cron' ? { id: x.id, cron: cron.value } : { id: x.id, rhythm: sel.value, time: time.value };
        const res = await ui.action('setCron', { ...payload, prompt: c.prompt.value });
        if (res && res.ok === false) msg.textContent = res.error;
        else {
          c.editingCron = false;
          fillCard(els.ui, c, current(c), els.st);
          els.ui.relayout();
        }
      },
    }, 'Appliquer'),
    msg,
  );
}
