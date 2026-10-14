// Scripts panel: the activities in progress (with their bar), then the recent ends.
// Everything here was typed by a script: always inserted as text (ui.h).

const COLOR = '#8EC5E8';
const BAD = '#F0616D';
const STATUS = {
  done: { label: 'Terminé', cls: '.ok' },
  error: { label: 'Échec', cls: '.bad' },
  stale: { label: 'Sans nouvelles', cls: '' },
  info: { label: 'Message', cls: '.blue' },
};
const EXAMPLE = 'ambrosia-notify --key sauvegarde --title "Sauvegarde NAS" --text "12/40 Go" --progress 0.3';

const pct = (p) => `${Math.round(p * 100)} %`;

export default {
  summary(st) {
    const live = st.live || [];
    if (!live.length) return st.ticker ? { ticker: st.ticker } : null;
    const one = live.length === 1 ? live[0] : null;
    return {
      // A ring that fills up when the script says how far it is, a pulse when it does not.
      dots: live.slice(0, 3).map((a) => ({ color: COLOR, pulse: a.progress == null, progress: a.progress ?? undefined })),
      badge: one ? (one.progress != null ? { text: pct(one.progress), color: COLOR } : null) : { text: `${live.length}`, color: COLOR },
      text: one ? `${one.title}${one.progress != null ? ' · ' + pct(one.progress) : ' en cours'}` : `${live.length} scripts en cours`,
      ticker: st.ticker || undefined,
    };
  },

  render(root, st, ui) {
    const { h } = ui;
    const live = st.live || [];
    const recent = st.recent || [];
    const open = (a) => (a.open ? h('button.btn.sm', { title: a.open.target, onclick: () => ui.action('open', { id: a.id }) }, 'Ouvrir') : null);

    if (!live.length && !recent.length) {
      root.append(
        h('div.empty', 'Aucun script ne s’est encore manifesté.'),
        h('div.small.dim', 'Dans un script PowerShell, une tâche planifiée ou une sauvegarde :'),
        h('div.code', EXAMPLE),
        h('div.small.faint', 'Puis --done ou --error avec la même --key à la fin. Le chemin de la commande, l’aide et « Tester » : Réglages → Scripts.'),
      );
      return;
    }

    if (live.length) {
      root.append(
        h('div.list',
          live.map((a) =>
            h('div.card',
              h('div.row',
                h('span.state-dot' + (a.progress == null ? '.pulse' : ''), { style: { '--c': COLOR } }),
                h('span.title.grow.ellipsis', { title: a.title }, a.title),
                a.progress != null ? h('span.pill.blue', pct(a.progress)) : h('span.pill', 'en cours'),
              ),
              a.text ? h('div.small.dim.ellipsis', { title: a.text, style: { marginTop: '3px' } }, a.text) : null,
              a.progress != null
                ? h('div', { style: { height: '4px', borderRadius: '2px', background: 'var(--card-2)', overflow: 'hidden', marginTop: '7px' } },
                    h('div', { style: { width: `${Math.round(a.progress * 100)}%`, height: '100%', background: COLOR, transition: 'width .4s' } }))
                : null,
              h('div.row', { style: { marginTop: '6px' } },
                h('span.faint.small.grow', `démarré ${ui.ago(a.startedAt)}`, Date.now() - a.updatedAt > 60000 ? ` · dernière nouvelle ${ui.ago(a.updatedAt)}` : ''),
                open(a),
                h('button.btn.sm.ghost', { title: 'Retirer de l’encoche (le script peut la relancer)', onclick: () => ui.action('forget', { key: a.key }) }, 'Retirer'),
              ),
            ),
          ),
        ),
      );
    }

    if (recent.length) {
      root.append(
        h('div.row', { style: { margin: live.length ? '12px 2px 6px' : '0 2px 6px' } },
          h('span.faint.small.grow', 'Récemment'),
          h('button.btn.sm.ghost', { onclick: () => ui.action('clear') }, 'Effacer'),
        ),
        h('div.list',
          recent.map((r) => {
            const s = STATUS[r.status] || STATUS.info;
            return h('div.card', { style: r.status === 'error' ? { borderColor: 'rgba(240,97,109,.35)' } : null },
              h('div.row',
                h('span.pill' + s.cls, s.label),
                h('span.grow.ellipsis', { title: r.title }, r.title),
                h('span.faint.small', ui.ago(r.endedAt)),
              ),
              r.text ? h('div.small.dim', { style: { marginTop: '3px', color: r.status === 'error' ? BAD : null, wordBreak: 'break-word' } }, r.text) : null,
              r.open
                ? h('div.btns', { style: { marginTop: '6px' } }, open(r), h('button.btn.sm.ghost', { onclick: () => ui.action('dismiss', { id: r.id }) }, 'Oublier'))
                : null,
            );
          }),
        ),
      );
    }
  },
};
