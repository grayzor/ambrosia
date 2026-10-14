// Island panel shared by every triage module (Courrier, ClickUp…): the important
// items, nothing else. A module's view.js is one call:
//
//   export default triageView({ source: 'Gmail', badge: '✉', one: 'mail', many: 'mails',
//                               open: 'Ouvrir dans Gmail', color: '#E8B923' });
//
// Every card gets « Confier à Claude » (src/renderer/launch-form.js).

import { launchButton, launchOpen, launchForm } from './launch-form.js';

const shortFrom = (from) => String(from || '').replace(/<[^>]*>/, '').replace(/"/g, '').trim() || from;
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
// Agreement: "mail trié" / "interaction triée".
const agree = (L, word, n) => word + (L.feminine ? 'e' : '') + (n > 1 ? 's' : '');

// What the user typed in a proposal stays put across re-renders (state updates).
const drafts = new Map();
const reading = new Set();
const folded = new Set();

/**
 * Gany's proposal on a card: what is asked, the source text on demand, the
 * editable draft, and one button per action. Nothing runs without a click.
 */
function proposalBox(m, ui, L) {
  const { h } = ui;
  const p = m.proposal;
  const applied = m.applied || {};
  const busy = m.busy;
  const key = m.id;
  if (folded.has(key)) {
    return h('div.proposal.folded', { onclick: () => { folded.delete(key); ui.rerender(); } },
      h('span.prop-head', '✦ ', p.headline), h('span.faint.small', ' · afficher'));
  }
  const value = p.text ? (drafts.has(key) ? drafts.get(key) : p.text.value) : '';
  const failed = Object.entries(applied).find(([, r]) => !r.ok);
  // The highlighted button is the next thing to do: the main action, then the rest.
  const left = p.actions.filter((a) => !applied[a.act]?.ok);
  const next = left.find((a) => a.primary) || left[0];
  const button = (a) => {
    const did = applied[a.act]?.ok;
    const running = busy === a.act;
    return h('button.btn.sm' + (a === next ? '.primary' : ''), {
      title: a.title || '',
      disabled: did || !!busy,
      onclick: (e) => {
        e.stopPropagation();
        ui.sound.play(a.primary ? 'send' : 'tick');
        ui.action('apply', { id: key, act: a.act, text: a.usesText ? (drafts.has(key) ? drafts.get(key) : value) : undefined });
      },
    }, running ? '…' : did ? `${a.label} ✓` : a.label);
  };
  return h('div.proposal',
    h('div.row',
      h('span.prop-head.grow', '✦ ', p.headline),
      h('button.btn.sm.ghost.icon', { title: 'Replier', onclick: () => { folded.add(key); ui.rerender(); } }, '–'),
      h('button.btn.sm.ghost.icon', { title: 'Pas utile : Gany apprendra', onclick: () => { ui.flash('annoyed', 700); drafts.delete(key); ui.action('dismissProposal', { id: key }); } }, '×'),
    ),
    p.ask ? h('div.small', p.ask) : null,
    p.analysis ? h('div.small.dim', p.analysis) : null,
    p.plan ? h('div.small.dim', '→ ', p.plan) : null,
    p.read
      ? reading.has(key)
        ? h('div.prop-read',
            h('div.small.faint', p.read.from, p.read.date ? ` · ${p.read.date}` : '', h('a.prop-link', { onclick: () => { reading.delete(key); ui.rerender(); } }, ' · masquer')),
            h('div.small.prop-source', p.read.text))
        : h('a.prop-link.small', { onclick: () => { reading.add(key); ui.rerender(); } }, `Lire ${L.readLabel || 'le message'} ▾`)
      : null,
    p.text
      ? h('textarea.text.prop-text', {
          rows: Math.min(8, Math.max(3, value.split('\n').length + 1)),
          value,
          disabled: !!busy || !!applied.send?.ok || !!applied.comment?.ok,
          'aria-label': p.text.label,
          oninput: (e) => drafts.set(key, e.target.value),
          onclick: (e) => e.stopPropagation(),
        }, value)
      : null,
    h('div.btns', { style: { marginTop: '6px' } }, p.actions.map(button)),
    failed && !busy ? h('div.small', { style: { color: '#FF9AA3', marginTop: '4px' } }, 'Raté : ', failed[1].error) : null,
  );
}

export function triageView(L) {
  const STATUS = {
    checking: `Gany parcourt ${L.where || L.source}…`,
    detecting: `Recherche du connecteur ${L.source}…`,
    'off-hours': 'Hors des heures de veille',
    idle: 'Première vérification dans un instant',
  };

  function statusBar(st, ui) {
    const { h, ago } = ui;
    const s = st.stats || {};
    const text = (st.status === 'ok' && st.proposing ? 'Gany prépare une proposition…' : '') || STATUS[st.status] || (st.lastCheck ? `Vérifié ${ago(st.lastCheck)}` : '');
    return h('div.row', { style: { margin: '0 2px 8px' } },
      h('span.small.dim.grow.ellipsis', text, s.checked ? ` · ${plural(s.checked, L.one, L.many)} ${agree(L, 'trié', s.checked)} aujourd’hui, ${s.important || 0} ${agree(L, 'retenu', s.important || 0)}` : ''),
      st.doneToday ? h('button.btn.sm.ghost', { title: 'Remettre le dernier élément traité dans la liste', onclick: () => ui.action('undoDone') }, 'Annuler') : null,
      (st.items || []).length ? h('button.btn.sm.ghost', { onclick: () => ui.action('doneAll') }, 'Tout traité') : null,
      h('button.btn.sm', { disabled: !!st.checking, onclick: () => { ui.sound.play('tick'); ui.action('refresh'); } }, st.checking ? '…' : 'Vérifier'),
    );
  }

  return {
    summary(st) {
      const unread = st.unread || 0;
      const urgent = (st.items || []).some((i) => !i.read && i.verdict === 'urgent');
      return {
        badge: unread ? { text: `${L.badge} ${unread}`, color: urgent ? '#F0616D' : L.color } : null,
        dots: st.checking ? [{ color: '#6CB4FF', pulse: true }] : [],
        count: unread || null,
        text: unread ? `${plural(unread, L.one, L.many)} ${L.qualifier ? L.qualifier + ' ' : ''}${agree(L, 'important', unread)}` : null,
      };
    },

    render(root, st, ui) {
      const { h, ago } = ui;
      root.append(statusBar(st, ui));
      // The module reads a fallback source for now (e.g. Google Chat through its reminder mails).
      if (st.via) root.append(h('div.small.faint', { style: { margin: '-4px 2px 8px' } }, st.via));

      if (st.status === 'auth') {
        root.append(
          h('div.card.hot',
            h('div.title', 'La CLI Claude n’est pas connectée'),
            h('div.dim.small', 'Gany utilise ton abonnement Claude via Claude Code. Connecte-toi une fois, dans le terminal qui va s’ouvrir.'),
            h('div.btns', { style: { marginTop: '8px' } }, h('button.btn.primary.sm', { onclick: () => ui.action('login') }, 'Se connecter à Claude')),
          ),
        );
      } else if (st.status === 'no-connector') {
        root.append(
          h('div.card.hot',
            h('div.title', `${L.source} n’est pas relié à Claude Code`),
            h('div.dim.small', `Sur claude.ai → Paramètres → Connecteurs, connecte (ou reconnecte) ${L.source}, puis relance la détection. Si le connecteur est juste lent à démarrer, Gany réessaie tout seul dans 3 minutes.`),
            st.error ? h('div.faint.small.ellipsis', { title: st.error }, st.error) : null,
            h('div.btns', { style: { marginTop: '8px' } },
              h('button.btn.sm', { onclick: () => ui.core('openExternal', 'https://claude.ai/settings/connectors') }, 'Ouvrir claude.ai'),
              h('button.btn.primary.sm', { onclick: async () => { await ui.action('detect'); await ui.action('refresh'); } }, 'Détecter et vérifier'),
            ),
          ),
        );
      } else if (st.status === 'error' && st.error) {
        root.append(h('div.card', h('div.small', { style: { color: '#FF9AA3' } }, 'Dernière vérification ratée : ', st.error)));
      }

      const items = st.items || [];
      if (!items.length) {
        root.append(h('div.empty', st.doneToday ? `Tout est traité (${st.doneToday} aujourd’hui). Gany garde l’œil ouvert.` : st.lastCheck ? 'Rien d’important. Gany garde l’œil ouvert.' : `${L.feminine ? 'Aucune' : 'Aucun'} ${L.one} ${agree(L, 'trié', 1)} pour l’instant.`));
        return;
      }
      const list = h('div.list');
      for (const m of items.slice(0, 12)) {
        const urgent = m.verdict === 'urgent';
        const title = m.title || m.subject;
        const launchKey = `${L.source}:${m.id}`;
        const delegating = launchOpen(launchKey);
        list.append(
          h('div.card' + (!m.read ? '.hot' : ''), { style: { opacity: m.read && !delegating ? 0.62 : 1 } },
            h('div.row',
              h('span.state-dot' + (!m.read ? '.pulse' : ''), { style: { '--c': urgent ? '#F0616D' : L.color } }),
              h('span.grow.ellipsis.title', { style: { cursor: 'pointer' }, title, onclick: () => ui.action('open', { id: m.id }) }, title),
              urgent ? h('span.pill.bad', 'Urgent') : null,
              m.delegatedAt ? h('span.pill', { style: { color: '#E08A5F' }, title: `Session Claude Code lancée ${ago(m.delegatedAt)}` }, 'Confiée à Claude') : null,
              h('span.faint.small', ago(m.at)),
            ),
            h('div.small.ellipsis', { style: { marginTop: '2px' } },
              h('span', { style: { color: 'var(--gold-light)' } }, shortFrom(m.from)),
              m.context ? h('span.faint', ' · ', m.context) : null,
              m.messages > 1 ? h('span.faint', ` · ${m.messages} ${L.many || 'messages'}`) : null,
            ),
            m.summary && !m.proposal ? h('div.small.dim', m.summary) : null,
            m.reason ? h('div.small.faint', '↳ ', m.reason) : null,
            m.proposal && !delegating ? proposalBox(m, ui, L) : null,
            delegating
              ? launchForm(ui, launchKey, { onLaunched: () => ui.action('delegated', { id: m.id }) })
              : h('div.btns', { style: { marginTop: '6px' } },
                  m.url ? h('button.btn.sm' + (m.read || m.proposal ? '' : '.primary'), { onclick: () => ui.action('open', { id: m.id }) }, L.open) : null,
                  h('button.btn.sm' + ((m.read || !m.url) && !m.proposal ? '.primary' : ''), { title: 'Retirer de la liste', onclick: () => { ui.sound.play('tick'); ui.action('done', { id: m.id }); } }, 'Traité ✓'),
                  launchButton(ui, launchKey, { item: m, source: L.source }),
                  h('span.grow'),
                  h('button.btn.sm.ghost', { title: 'Gany apprendra de cette correction', onclick: () => { ui.flash('annoyed', 900); ui.action('notImportant', { id: m.id }); } }, 'Pas important'),
                ),
          ),
        );
      }
      root.append(list);
    },
  };
}
