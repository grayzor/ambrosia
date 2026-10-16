// « Lire » panel: the images Gany read, their text (selectable, copied already),
// and what comes next: copy again, a better reading by Claude, a question to Gany.
// The text comes from an image: always inserted as text (ui.h).

const COLOR = '#7FD6C2';
const SOURCE = { drop: 'Déposée', clip: 'Copiée', paste: 'Collée' };

const askGany = (it) => window.ambrosia.action('chat', 'attach', { paths: [it.image], focus: true }).catch(() => {});

export default {
  summary(st) {
    const out = {};
    if (st.busy) Object.assign(out, { dots: [{ color: COLOR, pulse: true }], text: 'Gany lit une image…' });
    // An image copied a moment ago: offered at the top of the island when you come by.
    if (st.clip) {
      out.offer = {
        key: `ocr:clip:${st.clip.seq}`,
        at: st.clip.at,
        icon: '⌕',
        color: COLOR,
        text: 'Une image vient d’être copiée.',
        actions: [
          { label: 'Lire le texte', action: 'readClipboard', primary: true },
          { label: 'Demander à Gany', module: 'chat', action: 'attachClipboard' },
        ],
        dismiss: { action: 'dismissClip' },
      };
    }
    return Object.keys(out).length ? out : null;
  },

  render(root, st, ui) {
    const { h } = ui;
    const items = st.items || [];
    if (!items.length) {
      root.append(
        h('div.empty', 'Glisse une image sur l’encoche, côté « Lire le texte », ou copie une capture (Win+Maj+S) : Gany t’en donne le texte.'),
        h('div.btns.end', h('button.btn.sm', { onclick: () => ui.action('readClipboard') }, 'Lire l’image copiée')),
      );
      return;
    }
    root.append(
      h('div.row', { style: { margin: '0 2px 6px' } },
        h('span.faint.small.grow', 'Lu par Windows, hors ligne. Le texte est sélectionnable.'),
        h('button.btn.sm.ghost', { onclick: () => ui.action('readClipboard') }, 'Lire l’image copiée'),
        h('button.btn.sm.ghost', { onclick: () => ui.action('clear') }, 'Effacer'),
      ),
      h('div.list', items.map((it) => card(it, ui))),
    );
  },
};

function card(it, ui) {
  const { h } = ui;
  const copiedNow = it.copied && Date.now() - it.copied < 60000;
  const meta = [SOURCE[it.source] || 'Image', ui.ago(it.at)];
  if (it.words) meta.push(`${it.words} mot${it.words > 1 ? 's' : ''}`);
  if (it.columns) meta.push('colonnes séparées par des tabulations');
  return h('div.card.ocr-card',
    h('div.row',
      it.thumb ? h('img.ocr-thumb', { src: it.thumb, alt: '' }) : h('span.ocr-thumb.blank', '⌕'),
      h('div.grow', { style: { minWidth: 0 } },
        h('div.title.ellipsis', { title: it.name }, it.name),
        h('div.faint.small', meta.join(' · ')),
      ),
      copiedNow ? h('span.pill.ok', 'Copié') : null,
      h('button.btn.sm.ghost.icon', { title: 'Retirer', onclick: () => ui.action('remove', { id: it.id }) }, '×'),
    ),
    it.busy ? h('div.small.dim.ocr-wait', 'Gany déchiffre l’image…') : null,
    it.error ? h('div.small', { style: { color: '#FF9AA3', marginTop: '6px' } }, it.error) : null,
    it.empty ? h('div.small.dim', { style: { marginTop: '6px' } }, 'Aucun texte trouvé. Claude saura peut-être lire mieux (écriture manuscrite, photo de biais).') : null,
    it.text ? h('pre.ocr-text', it.text) : null,
    it.claude?.busy ? h('div.small.dim.ocr-wait', 'Claude relit l’image…') : null,
    it.claude?.error ? h('div.small', { style: { color: '#FF9AA3', marginTop: '6px' } }, `Claude : ${it.claude.error}`) : null,
    it.claude?.text
      ? [
          h('div.faint.small', { style: { marginTop: '8px' } }, 'Lecture de Claude'),
          h('pre.ocr-text', it.claude.text),
        ]
      : null,
    it.busy
      ? null
      : h('div.btns.end', { style: { marginTop: '8px' } },
          it.text ? h('button.btn.sm' + (it.claude?.text ? '' : '.primary'), { onclick: () => ui.action('copy', { id: it.id }) }, 'Copier') : null,
          it.claude?.text ? h('button.btn.sm.primary', { onclick: () => ui.action('copy', { id: it.id, which: 'claude' }) }, 'Copier (Claude)') : null,
          it.image && !it.claude?.text
            ? h('button.btn.sm', { disabled: !!it.claude?.busy, title: 'Tableaux, écriture manuscrite, photo floue : Claude relit l’image', onclick: () => ui.action('claude', { id: it.id }) }, 'Mieux lire avec Claude')
            : null,
          it.image ? h('button.btn.sm', { title: 'Poser une question sur cette image', onclick: () => askGany(it) }, 'Demander à Gany') : null,
          it.image && it.source !== 'drop' ? h('button.btn.sm.ghost', { title: 'Remettre l’image dans le presse-papiers', onclick: () => ui.action('copyImage', { id: it.id }) }, 'Recopier l’image') : null,
        ),
  );
}
