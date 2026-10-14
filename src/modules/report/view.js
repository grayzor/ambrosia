// Bilan panel. mount/update: the recipients, subject and body fields are built once
// and survive every state push; they are only overwritten when the main process
// changed the text itself (new draft, a fact removed → `draft.rev`).

const SOURCE = {
  claude: { label: 'Claude Code', cls: '' },
  clickup: { label: 'ClickUp', cls: '.blue' },
  mail: { label: 'Mail', cls: '.gold' },
  chat: { label: 'Chat', cls: '.ok' },
  agenda: { label: 'Réunion', cls: '' },
};
const OUTCOME = { sent: 'Envoyé', draft: 'Brouillon Gmail', ignored: 'Ignoré', expired: 'Non envoyé' };

let els = null;

const nameOf = (email) => String(email || '').split('@')[0].split(/[._-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') || email;
const joinNames = (list) => {
  const n = list.map(nameOf);
  return n.length <= 1 ? n.join('') : `${n.slice(0, -1).join(', ')} et ${n[n.length - 1]}`;
};
const splitTo = (v) => String(v || '').split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);
const hhmm = (ms) => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', ' h ');
const dayLabel = (day) => new Date(day + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default {
  summary(st) {
    if (st.busy === 'drafting') return { dots: [{ color: '#8FD3A8', pulse: true }], text: 'Gany rédige ton bilan du jour…' };
    if (st.busy === 'sending') return { dots: [{ color: '#8FD3A8', pulse: true }], text: 'Envoi du bilan…' };
    const d = st.draft;
    if (d && d.day === todayKey() && !d.error) return { dots: [{ color: '#8FD3A8' }], badge: { text: '✎', color: '#8FD3A8' }, count: 1, text: 'Ton bilan du jour attend ta relecture' };
    if (d?.error) return { dots: [{ color: '#F0616D' }], count: 1, text: 'Le bilan n’est pas parti' };
    return null;
  },

  mount(root, ui) {
    const { h } = ui;
    const field = (label, input) => h('label', { style: { display: 'block', marginTop: '6px' } }, h('div.faint.small', { style: { margin: '0 0 3px 2px' } }, label), input);
    // The island stays open while a field has the focus (island.js: typing()).
    const onFocus = () => ui.focusWindow();
    const onBlur = () => flush();
    const onInput = () => {
      els.confirm = null;
      renderControls(ui, els.st);
      clearTimeout(els.timer);
      els.timer = setTimeout(flush, 500);
    };
    const to = h('input.text', { type: 'text', placeholder: 'adresse@exemple.fr, …', spellcheck: false, onfocus: onFocus, onblur: onBlur, oninput: onInput });
    const subject = h('input.text', { type: 'text', onfocus: onFocus, onblur: onBlur, oninput: onInput });
    const body = h('textarea.text', { rows: 8, onfocus: onFocus, onblur: onBlur, oninput: onInput, style: { resize: 'vertical', lineHeight: '1.4' } });
    const top = h('div');
    const editor = h('div', field('À', to), field('Objet', subject), field('Texte du mail', body));
    const facts = h('div');
    const controls = h('div', { style: { marginTop: '8px' } });
    const history = h('div');
    root.append(top, editor, facts, controls, history);
    els = { to, subject, body, top, editor, facts, controls, history, rev: null, id: null, confirm: null, st: {}, ui, timer: null };

    function flush() {
      clearTimeout(els.timer);
      if (!els.id) return Promise.resolve();
      return ui.action('edit', values());
    }
    els.flush = flush;
  },

  update(root, st, ui) {
    if (!els) return;
    els.st = st;
    els.ui = ui;
    const { h } = ui;
    const d = st.draft;

    // Text fields: only when the main process rewrote them.
    if (d && (d.id !== els.id || d.rev !== els.rev)) {
      els.to.value = (d.to || []).join(', ');
      els.subject.value = d.subject || '';
      els.body.value = d.body || '';
      els.id = d.id;
      els.rev = d.rev;
      els.confirm = null;
    }
    if (!d) els.id = null;
    els.editor.style.display = d ? '' : 'none';

    // Header / empty state / busy line
    const sentToday = !d && (st.history || []).find((x) => x.day === todayKey());
    ui.mount(
      els.top,
      d
        ? h('div.row', { style: { marginBottom: '2px' } },
            h('span.title', `Bilan du ${dayLabel(d.day)}`),
            d.day !== todayKey() ? h('span.pill.bad', 'pas d’aujourd’hui') : null,
            h('span.grow'),
            h('span.faint.small', `rédigé à ${hhmm(d.createdAt)}`),
          )
        : sentToday
          ? h('div.card',
              h('div.row', h('span.pill' + (sentToday.outcome === 'sent' ? '.ok' : ''), OUTCOME[sentToday.outcome] || sentToday.outcome), h('span.title.ellipsis.grow', sentToday.subject)),
              h('div.small.dim', { style: { marginTop: '4px' } },
                sentToday.outcome === 'sent' ? `Envoyé à ${joinNames(sentToday.to || [])} à ${hhmm(sentToday.at)}.` : sentToday.outcome === 'draft' ? 'Brouillon créé dans Gmail.' : 'Bilan du jour mis de côté.'),
              st.busy === 'drafting' ? h('div.small.faint', { style: { marginTop: '4px' } }, 'Gany rédige un nouveau bilan…') : null,
              h('div.btns', { style: { marginTop: '8px' } },
                sentToday.outcome === 'sent' ? h('button.btn.sm', { onclick: () => ui.action('openSent') }, 'Voir dans Gmail') : null,
                h('button.btn.sm', { disabled: !!st.busy, onclick: () => ui.action('draftNow') }, 'Rédiger un nouveau bilan'),
              ),
            )
          : h('div.card.empty',
              h('div', st.busy === 'drafting' ? 'Gany rassemble ta journée…' : 'Pas encore de bilan aujourd’hui.'),
              h('div.small', { style: { marginTop: '4px' } },
                st.busy === 'drafting'
                  ? 'Mails envoyés, ClickUp, Chat, sessions Claude et réunions du jour. Ça prend une minute ou deux.'
                  : st.nextAt
                    ? `Gany le rédigera ${new Date(st.nextAt).toDateString() === new Date().toDateString() ? 'à' : `le ${new Date(st.nextAt).toLocaleDateString('fr-FR', { weekday: 'long' })} à`} ${hhmm(st.nextAt)}. Rien ne part sans ton clic.`
                    : 'Rédaction automatique désactivée. Rien ne part sans ton clic.'),
              st.busy ? null : h('button.btn.primary.sm', { style: { marginTop: '10px' }, onclick: () => ui.action('draftNow') }, 'Rédiger le bilan maintenant'),
            ),
      st.error
        ? h('div.card', { style: { marginTop: '8px', borderColor: 'rgba(240,97,109,.4)' } },
            h('div.small', { style: { color: '#FF9AA3' } }, st.error),
            h('div.btns', { style: { marginTop: '6px' } },
              st.auth ? h('button.btn.sm', { onclick: () => ui.action('login') }, 'Se connecter') : null,
              h('button.btn.sm.ghost', { onclick: () => ui.action('dismissError') }, 'OK'),
            ))
        : null,
    );

    // Facts, each removable
    ui.mount(
      els.facts,
      d && d.faits?.length
        ? h('div', { style: { marginTop: '10px' } },
            h('div.faint.small', { style: { margin: '0 0 4px 2px' } }, `Points détectés (${d.faits.length}) · ✕ retire le point et sa ligne du texte`),
            h('div.list',
              d.faits.map((f, i) =>
                h('div.row', { style: { alignItems: 'flex-start' } },
                  h('span.pill' + (SOURCE[f.source]?.cls || ''), { style: { flex: 'none', marginTop: '1px' } }, SOURCE[f.source]?.label || f.source),
                  h('span.small.grow', { style: { lineHeight: '1.35' } }, f.texte),
                  h('button.btn.ghost.sm', {
                    title: 'Retirer ce point',
                    disabled: !!st.busy,
                    style: { flex: 'none', padding: '0 7px' },
                    onclick: async () => {
                      clearTimeout(els.timer);
                      await ui.action('removeFact', { index: i, ...values() });
                    },
                  }, '✕'),
                ),
              ),
            ),
          )
        : null,
    );

    renderControls(ui, st);
    renderHistory(ui, st);
    ui.relayout();
  },
};

function values() {
  return { to: splitTo(els.to.value), subject: els.subject.value, body: els.body.value };
}

function renderControls(ui, st) {
  const { h } = ui;
  const d = st.draft;
  if (!d) return ui.mount(els.controls);
  const busy = !!st.busy;
  const to = splitTo(els.to.value);
  const status =
    st.busy === 'sending' ? h('div.small.dim', 'Envoi en cours…')
    : st.busy === 'drafting-gmail' ? h('div.small.dim', 'Création du brouillon Gmail…')
    : st.busy === 'drafting' ? h('div.small.dim', 'Gany réécrit le bilan…')
    : d.error ? h('div.small', { style: { color: d.uncertain ? '#F8DC6C' : '#FF9AA3' } }, d.error)
    : null;

  if (els.confirm === 'send') {
    return ui.mount(els.controls,
      status,
      h('div.card.hot', { style: { marginTop: '6px' } },
        h('div.small', { style: { marginBottom: '8px' } },
          `Envoyer à ${joinNames(to)} ?`,
          d.uncertain ? h('div.faint.small', { style: { marginTop: '4px' } }, 'Le dernier envoi est incertain : vérifie d’abord tes Envoyés.') : null),
        h('div.btns.end',
          h('button.btn.sm.ghost', { onclick: () => { els.confirm = null; renderControls(ui, els.st); } }, 'Annuler'),
          h('button.btn.sm.primary', {
            disabled: busy,
            onclick: async () => {
              els.confirm = null;
              clearTimeout(els.timer);
              ui.sound.play('send');
              renderControls(ui, els.st);
              await ui.action('send', values());
            },
          }, 'Confirmer l’envoi'),
        ),
      ),
    );
  }
  if (els.confirm === 'regen') {
    return ui.mount(els.controls,
      h('div.card.hot', { style: { marginTop: '6px' } },
        h('div.small', { style: { marginBottom: '8px' } }, 'Réécrire le bilan ? Tes modifications du texte seront remplacées (les destinataires et les points retirés sont gardés).'),
        h('div.btns.end',
          h('button.btn.sm.ghost', { onclick: () => { els.confirm = null; renderControls(ui, els.st); } }, 'Annuler'),
          h('button.btn.sm.primary', { onclick: async () => { els.confirm = null; await els.flush(); ui.action('regenerate'); } }, 'Régénérer'),
        ),
      ),
    );
  }
  ui.mount(els.controls,
    status,
    h('div.btns.end', { style: { marginTop: '6px' } },
      h('button.btn.sm.ghost', { disabled: busy, onclick: () => { clearTimeout(els.timer); ui.action('ignore'); } }, 'Ignorer'),
      h('button.btn.sm', { disabled: busy, onclick: () => { if (d.edited) { els.confirm = 'regen'; renderControls(ui, els.st); } else ui.action('regenerate'); } }, 'Régénérer'),
      h('button.btn.sm', { disabled: busy || !to.length, onclick: async () => { clearTimeout(els.timer); await ui.action('gmailDraft', values()); } }, 'Brouillon Gmail'),
      h('button.btn.sm.primary', { disabled: busy || !to.length, title: to.length ? '' : 'Ajoute au moins un destinataire', onclick: () => { els.confirm = 'send'; renderControls(ui, els.st); } }, 'Envoyer…'),
    ),
  );
}

function renderHistory(ui, st) {
  const { h } = ui;
  const past = (st.history || []).filter((x) => !(x.day === todayKey() && !st.draft)).slice(0, 5);
  ui.mount(
    els.history,
    past.length
      ? h('div', { style: { marginTop: '12px' } },
          h('div.faint.small', { style: { margin: '0 0 4px 2px' } }, 'Bilans précédents'),
          h('div.list', past.map((x) => h('div.row.small',
            h('span.dim', { style: { flex: 'none', width: '92px' } }, new Date(x.day + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })),
            h('span.pill' + (x.outcome === 'sent' ? '.ok' : ''), { style: { flex: 'none' } }, OUTCOME[x.outcome] || x.outcome),
            h('span.ellipsis.grow.faint', x.subject || ''),
          ))),
        )
      : null,
  );
}
