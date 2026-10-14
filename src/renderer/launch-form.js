// « Confier à Claude » / « Nouvelle session » — the form that starts an
// interactive Claude Code session (src/modules/launch, src/main/launcher.js), in
// Windows Terminal or in Claude Desktop (« Lancer dans » ; the app's link carries
// only the folder and the prompt, so model / mode / worktree are greyed there).
//
//   import { launchButton, launchOpen, launchForm } from '../../renderer/launch-form.js';
//   if (launchOpen(key)) card.append(launchForm(ui, key));
//   else btns.append(launchButton(ui, key, { item, source: 'ClickUp' }));
//
// Views that use render() are rebuilt on every state update: the form keeps its
// values here, keyed by card, so a rebuild (or a blur) never loses what was typed.
// The only thing that launches anything is the « Lancer » button.

const forms = new Map(); // key → { loading, opts, values, status, error, origin }
const api = () => window.ambrosia;

export const launchOpen = (key) => forms.has(key);

/** Opens the form for `key`; `item` (a triage card) pre-fills the prompt. */
export async function openLaunch(ui, key, { item = null, source = '', resume = null } = {}) {
  const f = { loading: true, values: {}, status: '', error: '', item, resume };
  forms.set(key, f);
  ui.pin(true);
  ui.rerender();
  try {
    const o = await api().action('launch', 'options', { item, source, resume });
    f.opts = o;
    f.values = {
      repo: o.defaults.repo || (o.repos.length ? o.repos[0].path : '__other'),
      other: '',
      otherGit: false,
      model: o.defaults.model,
      worktree: !!o.defaults.worktree,
      permissionMode: o.defaults.permissionMode || '',
      prompt: o.prompt || '',
      title: o.title || '',
      target: o.target === 'desktop' && o.desktop ? 'desktop' : 'terminal',
    };
    if (o.resume && !o.resume.exists) f.error = 'Le dossier de cette session n’existe plus : impossible de la reprendre.';
    if (!o.cli && !o.desktop) f.error = 'CLI Claude introuvable : installe Claude Code ou indique son chemin dans Réglages → Claude.';
  } catch (err) {
    f.error = /inconnue/.test(err.message) ? 'Le module « Sessions Claude » est désactivé (Réglages).' : err.message;
  }
  f.loading = false;
  if (forms.get(key) === f) ui.rerender();
}

export function closeLaunch(ui, key) {
  forms.delete(key);
  if (!forms.size) ui.pin(false);
  ui.rerender();
}

/** The « Confier à Claude » button of a card. */
export function launchButton(ui, key, opts = {}) {
  return ui.h('button.btn.sm', { title: 'Lancer une session Claude Code sur ce sujet (tu relis tout avant)', onclick: () => { ui.sound.play('tick'); openLaunch(ui, key, opts); } }, 'Confier à Claude');
}

// A click must survive the blur of the textarea: island.js re-renders a panel when
// a text field loses focus, which would swap the button out before its click lands.
const press = (fn) => ({
  onmousedown: (e) => e.preventDefault(),
  onclick: (e) => {
    document.activeElement?.blur?.();
    fn(e);
  },
});

const label = (h, text) => h('div.faint.small', { style: { margin: '8px 0 3px' } }, text);
const field = { width: '100%', background: '#0B0A0E', border: '1px solid var(--line)', borderRadius: '10px', color: 'var(--text)', font: 'inherit', padding: '6px 8px', outline: 'none' };

/**
 * The form. `onLaunched()` runs after a successful launch (e.g. mark the card
 * « Confiée à Claude »).
 */
export function launchForm(ui, key, { onLaunched } = {}) {
  const { h } = ui;
  const f = forms.get(key);
  const resume = f?.resume || null; // « Continuer » / « Question à côté » (claude --resume [--fork-session])
  const isNew = !f?.item && !resume;
  const head = h('div.row',
    h('span.state-dot', { style: { '--c': '#E08A5F' } }),
    h('span.title.grow.ellipsis', resume ? (resume.fork ? `Question à côté · ${resume.project}` : `Continuer · ${resume.project}`) : isNew ? 'Nouvelle session Claude Code' : 'Confier à Claude'),
    h('button.btn.sm.ghost', { title: 'Fermer sans rien lancer', ...press(() => closeLaunch(ui, key)) }, '✕'),
  );
  const card = h('div.card.hot', { style: { marginTop: isNew ? 0 : '8px' } }, head);
  if (!f || f.loading) {
    card.append(h('div.small.dim', { style: { marginTop: '6px' } }, 'Gany prépare le formulaire…'));
    return card;
  }
  if (!f.opts) {
    card.append(h('div.small', { style: { color: '#FF9AA3', marginTop: '6px' } }, f.error));
    return card;
  }
  const v = f.values;
  const o = f.opts;
  const focus = () => ui.focusWindow();
  const chosen = () => (v.repo === '__other' ? null : o.repos.find((r) => r.path === v.repo));
  const isGit = () => (v.repo === '__other' ? v.otherGit : !!chosen()?.git);

  // Dépôt
  const repoSelect = h('select', {
    style: field,
    onfocus: focus,
    onchange: (e) => {
      v.repo = e.target.value;
      v.worktree = o.worktreePref && isGit();
      e.target.blur(); // island.js holds re-renders while a field has the focus
      ui.rerender();
    },
  },
    o.repos.map((r) => h('option', { value: r.path, selected: r.path === v.repo, title: r.path }, r.label + (r.git ? '' : ' (pas git)'))),
    h('option', { value: '__other', selected: v.repo === '__other' }, 'Autre dossier…'),
  );
  if (resume) card.append(label(h, 'Dossier de la session'), h('div.small.mono.ellipsis.dim', { title: v.repo }, v.repo));
  else card.append(label(h, 'Dépôt'), repoSelect);
  if (v.repo === '__other') {
    card.append(h('input.text', {
      style: { marginTop: '6px', padding: '6px 8px' },
      placeholder: 'C:\\chemin\\complet\\du\\dépôt',
      value: v.other,
      onfocus: focus,
      oninput: (e) => (v.other = e.target.value),
      onchange: async (e) => {
        const p = await api().action('launch', 'probe', { path: e.target.value });
        v.otherGit = !!p.git;
        v.otherExists = !!p.exists;
        v.worktree = o.worktreePref && v.otherGit;
        ui.rerender();
      },
    }));
    if (v.other && v.otherExists === false) card.append(h('div.small', { style: { color: '#FF9AA3' } }, 'Dossier introuvable.'));
  }
  if (!o.repos.length && v.repo !== '__other') card.append(h('div.faint.small', 'Ajoute tes dépôts dans Réglages → Sessions Claude.'));

  // Lancer dans : Claude Desktop (onglet Code) ou Terminal
  const inDesktop = v.target === 'desktop';
  const target = (id, title, sub, enabled, tip) =>
    h('button.choice' + (v.target === id ? '.sel' : ''), {
      style: { flex: '1 1 0', minWidth: 0, opacity: enabled ? 1 : 0.5 },
      disabled: !enabled,
      title: tip,
      ...press(() => {
        v.target = id;
        ui.sound.play('tick');
        ui.rerender();
      }),
    }, h('span.tick'), h('span', h('div', title), h('div.faint.small', sub)));
  card.append(
    label(h, 'Lancer dans'),
    h('div.row', { style: { gap: '8px', alignItems: 'stretch' } },
      target('desktop', 'Claude Desktop', 'Onglet Code, tu envoies', !!o.desktop, o.desktop ? 'Le prompt arrive dans l’app : tu le relis et tu l’envoies là-bas.' : 'Claude Desktop n’est pas installé (lien claude:// absent).'),
      target('terminal', 'Terminal', 'Windows Terminal', !!o.cli, o.cli ? 'Une session claude interactive dans Windows Terminal.' : 'CLI Claude introuvable.'),
    ),
  );

  // Modèle, permissions (le lien de Claude Desktop ne les transmet pas)
  const select = (prop, options) => h('select', { style: { ...field, opacity: inDesktop ? 0.5 : 1 }, disabled: inDesktop, onfocus: focus, onchange: (e) => (v[prop] = e.target.value) },
    options.map(([val, text]) => h('option', { value: val, selected: val === v[prop] }, text)));
  card.append(
    h('div.row', { style: { gap: '8px', alignItems: 'flex-end' } },
      h('div.grow', label(h, 'Modèle'), select('model', o.models)),
      h('div.grow', label(h, 'Permissions'), select('permissionMode', o.modes)),
    ),
  );
  if (inDesktop) card.append(h('div.faint.small', { style: { marginTop: '3px' } }, 'Dans Claude Desktop, le modèle, le mode et le worktree se choisissent dans l’app, avant d’envoyer.'));

  // Worktree (never for a resumed session: it lives where it was)
  const git = isGit() && !inDesktop;
  if (!resume) card.append(
    h('button.choice' + (v.worktree && git ? '.sel' : ''), {
      style: { marginTop: '8px', opacity: git ? 1 : 0.5 },
      disabled: !git,
      title: inDesktop ? 'Dans Claude Desktop, le worktree se choisit dans l’app' : git ? 'claude --worktree : une copie isolée du dépôt, sur sa propre branche' : 'Seulement pour un dépôt git',
      ...press(() => {
        v.worktree = !v.worktree;
        ui.sound.play('tick');
        ui.rerender();
      }),
    },
      h('span.tick'),
      h('span', h('div', 'Dans un worktree isolé'), h('div.faint.small', git ? 'Claude travaille sur sa propre branche, ton dossier reste intact.' : inDesktop ? 'À choisir dans Claude Desktop.' : 'Ce dossier n’est pas un dépôt git.')),
    ),
  );

  // Prompt
  card.append(
    label(h, resume ? 'Ton message (facultatif)' : isNew ? 'Premier message (facultatif)' : 'Prompt — relis et complète avant de lancer'),
    h('textarea.text', {
      rows: isNew || resume ? 4 : 9,
      style: { fontSize: '12px', lineHeight: '1.35', padding: '7px 9px' },
      placeholder: resume ? (resume.fork ? 'Ta question : une copie de la conversation y répond, la session d’origine n’est pas dérangée…' : 'La suite pour Claude, qui reprend là où il s’était arrêté…') : isNew ? 'Ce que Claude doit faire en arrivant…' : '',
      onfocus: focus,
      oninput: (e) => (v.prompt = e.target.value),
    }, v.prompt), // a textarea's text is its child (h() would set a no-op "value" attribute)
  );
  if (!isNew && !resume) card.append(h('div.faint.small', { style: { marginTop: '3px' } }, 'Le contexte vient de l’extérieur : il est encadré pour que Claude le traite comme une donnée.'));
  // The claude:// link keeps 14 336 characters of prompt: beyond, it travels by the clipboard.
  if (inDesktop && o.maxLinkPrompt && v.prompt.length > o.maxLinkPrompt) {
    card.append(h('div.small', { style: { marginTop: '3px', color: 'var(--gold-light)' } }, `Prompt trop long pour le lien de Claude Desktop (${v.prompt.length} caractères) : Gany le copiera, tu le colleras (Ctrl+V) dans l’app.`));
  }

  // Lancer
  const launch = async () => {
    if (f.status === 'launching') return;
    const cwd = v.repo === '__other' ? v.other.trim() : v.repo;
    if (!cwd) {
      f.error = 'Choisis un dépôt.';
      ui.flash('annoyed', 900);
      return ui.rerender();
    }
    f.status = 'launching';
    f.error = '';
    ui.rerender();
    const res = await api().action('launch', 'launch', {
      cwd,
      target: v.target,
      model: v.model,
      worktree: !resume && v.worktree && isGit() && !inDesktop,
      permissionMode: v.permissionMode,
      prompt: v.prompt,
      title: v.title,
      ...(resume ? { resume: resume.sessionId, fork: !!resume.fork } : {}),
    }).catch((err) => ({ ok: false, error: err.message }));
    if (!res?.ok) {
      f.status = '';
      f.error = res?.error || 'Lancement impossible.';
      ui.flash('annoyed', 900);
      return ui.rerender();
    }
    f.status = 'launched';
    f.done =
      res.via !== 'desktop'
        ? 'Claude démarre dans Windows Terminal.'
        : res.clipboard
          ? 'Claude Desktop s’ouvre sur le dossier : colle le prompt (Ctrl+V), relis-le et envoie-le.'
          : 'Claude Desktop s’ouvre : relis le prompt et envoie-le depuis l’app.';
    ui.sound.play('send');
    ui.flash('wink', 1600);
    onLaunched?.(res);
    ui.rerender();
    setTimeout(() => forms.get(key) === f && closeLaunch(ui, key), res.clipboard ? 5000 : 2400);
  };
  card.append(
    // h() skips null children; Element.append would print "null"
    h('div', f.error ? h('div.small', { style: { color: '#FF9AA3', marginTop: '6px' } }, f.error) : null),
    h('div', f.status === 'launched' ? h('div.small', { style: { color: '#7EE08F', marginTop: '6px' } }, f.done) : null),
    h('div.btns.end', { style: { marginTop: '8px' } },
      h('button.btn.ghost.sm', press(() => closeLaunch(ui, key)), 'Annuler'),
      h('button.btn.primary.sm', { disabled: f.status === 'launching' || f.status === 'launched' || (inDesktop ? !o.desktop : !o.cli), ...press(launch) },
        f.status === 'launching' ? 'Lancement…' : f.status === 'launched' ? 'Lancée ✓' : 'Lancer'),
    ),
  );
  return card;
}
