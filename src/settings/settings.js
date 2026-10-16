// Settings window. Core sections are declared here; every module section is
// generated from the `settings` array its main.js exports — a new module gets
// its settings page for free.

import { h, mount } from '../renderer/ui.js';
import { Gany } from '../renderer/gany.js';
import { Sound } from '../renderer/sound.js';
import '../renderer/wardrobe.js'; // plain script: globalThis.AmbrosiaWardrobe

const api = window.ambrosia;

const CORE = [
  {
    id: 'general',
    name: 'Général',
    icon: '◎',
    lead: 'Les réglages de base d’Ambrosia.',
    fields: [
      { key: 'sounds', label: 'Sons (petite lyre)', type: 'boolean' },
      { key: 'volume', label: 'Volume', type: 'range', min: 0, max: 1, step: 0.05 },
      { key: 'autostart', label: 'Lancer Ambrosia à l’ouverture de session Windows', type: 'boolean' },
      { key: 'paused', label: 'Pause : Gany ne dérange plus (les hooks passent la main au terminal)', type: 'boolean' },
    ],
  },
  {
    id: 'island',
    name: 'Encoche',
    icon: '▬',
    lead: 'L’îlot en haut au centre de ton écran.',
    fields: [
      { key: 'idleStyle', label: 'Au repos', type: 'select', options: [['notch', 'Petite encoche noire'], ['line', 'Fine ligne, presque invisible']] },
      {
        key: 'display',
        label: 'Écran',
        type: 'select',
        options: [['primary', 'Écran principal'], ['mouse', 'Suivre la souris'], ['window', 'Suivre la fenêtre active'], ['fixed', 'Écran choisi']],
        help: 'Avec plusieurs écrans. « Suivre la souris » attend que le pointeur reste un instant sur un autre écran : le traverser ne déplace pas l’îlot. L’îlot ne change d’écran qu’une fois replié.',
      },
      { key: 'displayId', label: 'Écran choisi', type: 'display', help: 'Pour « Écran choisi ». Débranché, l’îlot revient sur l’écran principal.' },
      { key: 'dropZone', label: 'Ouvrir une zone de dépôt quand un fichier glissé approche', type: 'boolean', help: 'Glisse un fichier vers l’encoche : elle s’ouvre pour le recevoir, Gany le boit et te propose un résumé.' },
      { key: 'restDelay', label: 'Temps d’immobilité avant dépliage (ms)', type: 'number', help: 'La souris doit rester immobile sur l’encoche ce temps-là : la survoler en passant ne l’ouvre pas.' },
      { key: 'returnSeconds', label: 'Retour au centre après un déplacement (secondes, 0 = jamais)', type: 'number', help: 'Clic maintenu sur l’encoche puis glisser à gauche ou à droite pour la pousser de côté.' },
      { key: 'leaveDelay', label: 'Délai avant repli quand la souris part (ms)', type: 'number' },
      { key: 'alertSeconds', label: 'Durée d’affichage d’une alerte (secondes)', type: 'number' },
    ],
  },
  {
    id: 'call',
    name: 'En réunion',
    icon: '◐',
    lead: 'Quand tu es en appel (réunion de l’agenda, Meet détecté), Gany garde pour plus tard ce qui peut attendre, puis te fait un seul récap à la fin. Déplier l’îlot pendant l’appel montre tout, normalement.',
    fields: [
      { key: 'enabled', label: 'Ne pas déranger pendant les appels', type: 'boolean' },
      { key: 'threshold', label: 'Laisser passer à partir de la priorité', type: 'number', help: '100 = seulement les approbations et questions de Claude Code (et les alertes épinglées, comme ta prochaine réunion). Repères : mail urgent 80, mail 60, erreur Claude 70.' },
      { key: 'softSound', label: 'Ce qui passe joue un petit son discret au lieu de son son habituel', type: 'boolean' },
    ],
  },
  {
    id: 'discretion',
    name: 'Discrétion',
    icon: '◌',
    lead: 'Gany sait se faire oublier : en partage d’écran, en plein écran, quand Windows est en « Ne pas déranger », et quand ta session est verrouillée (il dort, rien de nouveau ne démarre, et tu retrouves un seul récap en revenant).',
    fields: [
      { key: 'hideFromCapture', label: 'Masquer l’îlot des partages d’écran et des enregistrements', type: 'boolean', help: 'Meet, enregistrements, prise en main à distance : l’îlot n’y apparaît pas. Toi, tu le vois toujours.' },
      { key: 'fullscreen', label: 'S’effacer en plein écran (vidéo, présentation, jeu)', type: 'boolean', help: 'Sur l’écran de l’îlot seulement. Ce qui peut attendre est gardé pour un récap à la sortie ; ce qui passe le seuil « En réunion » (approbations de Claude Code…) s’affiche quand même.' },
      { key: 'followDnd', label: 'Suivre le « Ne pas déranger » de Windows', type: 'boolean', help: 'Activé dans Windows : la concentration de Gany démarre (seul l’urgent passe). Désactivé : elle s’arrête, sauf si c’est toi qui l’avais lancée. Ambrosia ne touche jamais au réglage de Windows.' },
    ],
  },
  {
    id: 'update',
    name: 'Mises à jour',
    icon: '⇣',
    lead: 'Ambrosia se met à jour depuis ses versions publiées sur GitHub, comme Claude Code : elle vérifie, télécharge, puis installe.',
    special: 'update',
    fields: [
      {
        key: 'auto',
        label: 'Mise à jour automatique au démarrage',
        type: 'boolean',
        help: 'Au lancement d’Ambrosia, une nouvelle version s’installe d’elle-même avant que Gany n’arrive. En journée, Gany la télécharge et te propose seulement le bouton « Mettre à jour » (en haut de l’îlot, ici, ou dans l’icône de la barre des tâches) : rien ne s’installe sans ton clic.',
      },
    ],
  },
  {
    id: 'cli',
    name: 'Claude (IA)',
    icon: '✶',
    lead: 'Toute l’IA d’Ambrosia passe par la CLI Claude Code, avec ton abonnement Claude — comme Claude Code lui-même. Aucune clé API.',
    special: 'cli',
    fields: [
      { key: 'path', label: 'Chemin de claude.exe (vide = détection automatique)', type: 'text' },
      { key: 'fastModel', label: 'Modèle des petites tâches de fond', type: 'select', options: ['haiku', 'sonnet'] },
    ],
  },
];

const S = { settings: {}, modules: [], current: location.hash.slice(1) || 'general' };
let logo = null; // Gany in the corner, dressed like in the island

function sections() {
  return [
    ...CORE.map((c) => ({ ...c, core: true })),
    ...S.modules.map((m) => ({
      id: m.id,
      name: m.name,
      icon: m.icon,
      module: m,
      lead: '',
      fields: [{ key: 'enabled', label: `Activer le module ${m.name}`, type: 'boolean' }, ...m.settings],
    })),
  ];
}

function renderNav() {
  const all = sections();
  const icon = (s) => (s.module?.logo ? h('img.ico', { src: '../renderer/' + s.module.logo, alt: '', style: { width: '16px', height: '16px', objectFit: 'contain' } }) : h('span.ico', s.icon));
  const item = (s) => h('div.nav-item' + (S.current === s.id ? '.sel' : ''), { onclick: () => go(s.id) }, icon(s), s.name);
  mount(
    document.getElementById('sections'),
    all.filter((s) => s.core).map(item),
    h('div.nav-group', 'Modules'),
    all.filter((s) => !s.core).map(item),
    h('div.nav-group', 'Divers'),
    h('div.nav-item', { onclick: async () => api.core('openPath', await api.core('logPath')) }, h('span.ico', '≡'), 'Journal'),
    h('div.nav-item', { onclick: () => api.core('relaunch') }, h('span.ico', '↻'), 'Redémarrer Ambrosia'),
  );
}

function go(id) {
  S.current = id;
  history.replaceState(null, '', '#' + id);
  render();
}

let savedTimer = null;
async function save(section, key, value, flag) {
  S.settings[section] = await api.core('setSettings', { section, patch: { [key]: value } });
  flag?.classList.add('on');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => flag?.classList.remove('on'), 1200);
}

function field(section, f) {
  const value = S.settings[section]?.[f.key];
  const flag = h('span.saved', 'enregistré');
  const help = f.help ? h('div.help', f.help) : null;
  switch (f.type) {
    case 'boolean':
      return h('div.field.inline',
        h('label.l', f.label, flag),
        h('label.switch', h('input', { type: 'checkbox', checked: !!value, onchange: (e) => save(section, f.key, e.target.checked, flag) }), h('span')),
        help,
      );
    case 'select':
      return h('div.field',
        h('label.l', f.label, flag),
        h('select.text', { onchange: (e) => save(section, f.key, e.target.value, flag) },
          (f.options || []).map((o) => {
            const [v, label] = Array.isArray(o) ? o : [o, o];
            return h('option', { value: v, selected: v === value }, label);
          }),
        ),
        help,
      );
    case 'number':
      return h('div.field', h('label.l', f.label, flag), h('input.text', { type: 'number', value: value ?? '', onchange: (e) => save(section, f.key, Number(e.target.value), flag) }), help);
    case 'range':
      return h('div.field', h('label.l', f.label, flag), h('input', { type: 'range', min: f.min, max: f.max, step: f.step, value: value ?? 0.5, onchange: (e) => save(section, f.key, Number(e.target.value), flag) }), help);
    case 'textarea':
      return h('div.field', h('label.l', f.label, flag), h('textarea.text', { rows: 9, value: value ?? '', onchange: (e) => save(section, f.key, e.target.value, flag) }), help);
    case 'list':
      return h('div.field',
        h('label.l', f.label, flag),
        h('textarea.text', {
          rows: 4,
          value: (value || []).join('\n'),
          onchange: (e) => save(section, f.key, e.target.value.split('\n').map((x) => x.trim()).filter(Boolean), flag),
        }),
        help,
      );
    case 'button': {
      const out = h('div.small.dim', { style: { marginTop: '6px' } });
      return h('div.field',
        h('button.btn', {
          onclick: async (e) => {
            e.target.disabled = true;
            out.textContent = '…';
            try {
              const r = await api.action(section, f.action);
              out.textContent = typeof r === 'string' ? r : 'Fait.';
            } catch (err) {
              out.textContent = err.message;
            }
            e.target.disabled = false;
          },
        }, f.label),
        out,
        help,
      );
    }
    case 'hooks':
      return hooksPanel();
    case 'wardrobe':
      return wardrobePanel(section, f, flag);
    case 'display': {
      // The screens plugged in now, asked to the main process.
      const select = h('select.text', { onchange: (e) => save(section, f.key, e.target.value, flag) }, h('option', { value: value ?? '' }, '…'));
      api.core('displays').then((list) =>
        mount(select,
          h('option', { value: '', selected: !value }, '— Écran principal —'),
          list.map((d) => h('option', { value: d.id, selected: d.id === String(value) }, d.label)),
          value && !list.some((d) => d.id === String(value)) ? h('option', { value, selected: true }, 'Écran débranché (l’îlot est sur l’écran principal)') : null,
        ),
      );
      return h('div.field', h('label.l', f.label, flag), select, help);
    }
    default:
      return h('div.field', h('label.l', f.label, flag), h('input.text', { type: 'text', value: value ?? '', onchange: (e) => save(section, f.key, e.target.value, flag) }), help);
  }
}

// ── Claude Code hooks: diff, confirm, write — never silently ────────────────

function hooksPanel() {
  const box = h('div.field');
  const refresh = async () => {
    const st = await api.core('hooksStatus');
    mount(box,
      h('label.l', 'Hooks Claude Code'),
      h('div.status', h('span.state-dot', { style: { '--c': st.installed ? 'var(--ok)' : 'var(--warn)' } }), st.installed ? 'Installés — Gany voit tes sessions' : 'Non installés'),
      st.installed
        ? h('div.status', h('span.state-dot', { style: { '--c': st.statusLine ? 'var(--ok)' : 'var(--warn)' } }), st.statusLine ? 'Relais statusLine installé — jauges du forfait' : 'Relais statusLine absent : réinstalle pour voir les jauges du forfait')
        : null,
      st.installed && st.missing?.length ? h('div.note', `Nouveaux événements à installer : ${st.missing.join(', ')}. Clique sur Réinstaller.`) : null,
      st.moved ? h('div.note', 'Le relais installé appartient à une autre copie d’Ambrosia (les sources, une ancienne installation). Clique sur Réinstaller pour qu’il suive cette version et ses mises à jour.') : null,
      st.chained ? h('div.help', 'Ta statusLine d’origine est conservée et enchaînée (même affichage qu’avant) : ', h('span.mono', st.chained)) : null,
      !st.statusLine && st.userStatusLine ? h('div.help', 'Ta statusLine actuelle sera conservée : le relais l’exécute et affiche exactement sa sortie. ', h('span.mono', st.userStatusLine)) : null,
      !st.statusLine && !st.userStatusLine ? h('div.help', 'Tu n’as pas de statusLine : le relais en affiche une courte (modèle, contexte, jauges 5 h et semaine) et transmet les jauges à Ambrosia.') : null,
      st.error ? h('div.note', st.error) : null,
      !st.node ? h('div.note', 'node.exe introuvable dans le PATH : le relais ne pourra pas tourner.') : null,
      h('div.help', `Fichier : ${st.settingsPath}. Ambrosia ajoute ses entrées à côté des tiennes, sans les toucher, et fait une sauvegarde datée avant d’écrire. Désinstaller remet ta statusLine telle qu’elle était.`),
      h('div.btns', { style: { marginTop: '10px' } },
        h('button.btn' + (st.installed ? '' : '.primary'), { onclick: () => preview(true) }, st.installed ? 'Réinstaller…' : 'Installer les hooks…'),
        st.installed ? h('button.btn.danger', { onclick: () => preview(false) }, 'Désinstaller…') : null,
      ),
    );
  };
  const preview = async (install) => {
    let p;
    try {
      p = await api.core('hooksPreview', install);
    } catch (err) {
      return box.append(h('div.note', err.message));
    }
    const diff = h('div.diff', p.diff.split('\n').map((l) => h('div.' + (l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : 'ctx'), l)));
    const result = h('div.small', { style: { marginTop: '8px' } });
    mount(box,
      h('label.l', install ? 'Voici exactement ce qui sera ajouté' : 'Voici ce qui sera retiré'),
      diff,
      h('div.help', `Sauvegarde : ${p.backup}`),
      h('div.btns', { style: { marginTop: '10px' } },
        h('button.btn', { onclick: refresh }, 'Annuler'),
        h('button.btn.primary', {
          onclick: async () => {
            try {
              const r = await api.core('hooksWrite', { install, fingerprint: p.fingerprint });
              await api.action('claude', 'refreshHooks').catch(() => {});
              await refresh();
              box.append(h('div.note', `C’est fait. ${r.backup ? 'Sauvegarde : ' + r.backup + '. ' : ''}Les nouvelles sessions Claude Code seront visibles (relance celles déjà ouvertes).`));
            } catch (err) {
              result.textContent = err.message;
            }
          },
        }, install ? 'Écrire dans settings.json' : 'Retirer de settings.json'),
      ),
      result,
    );
  };
  refresh();
  return box;
}

// ── Gany's wardrobe (src/renderer/wardrobe.js): skins, slots, live preview ──

const Wardrobe = globalThis.AmbrosiaWardrobe;
const PREVIEW_MOODS = [['idle', 'Au repos'], ['working', 'Au travail'], ['approval', 'Approbation'], ['finished', 'Terminé'], ['mail', 'Un mail'], ['sleeping', 'Endormi']];
let dressing = []; // the Gany instances of the panel, stopped when it is redrawn
let previewMood = 'idle';

function stopWardrobe() {
  for (const g of dressing) g.stop();
  dressing = [];
}

function miniGany(slots, { size = 64, mood = 'idle', fps = 30 } = {}) {
  const c = h('canvas', { style: { width: size + 'px', height: size + 'px' } });
  const g = new Gany(c);
  g.setLook(slots);
  g.setMood(mood);
  g.setFps(fps);
  dressing.push(g);
  // started once the canvas is in the page (it needs its CSS size)
  requestAnimationFrame(() => g.start());
  c.addEventListener('mousemove', (e) => g.look(e.offsetX - size / 2, e.offsetY - size / 2));
  return { canvas: c, gany: g };
}

const until = ([m, d]) => new Date(2000, m - 1, d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });

function wardrobePanel(section, f, flag) {
  const box = h('div.field.wardrobe');
  const draw = () => {
    stopWardrobe();
    const look = Wardrobe.normalize(S.settings[section]?.[f.key]);
    const now = new Date();
    const r = Wardrobe.resolve(look, { date: now, soundTheme: S.settings[section]?.soundTheme });
    const base = Wardrobe.skinById(r.skin);
    const season = Wardrobe.SEASONS.find((x) => x.id === r.season);
    const seasonal = Wardrobe.seasonalSkin(now);
    const set = (next) => save(section, f.key, next, flag).then(draw);

    const preview = miniGany(r.slots, { size: 168, mood: previewMood, fps: 60 });
    logo?.setLook(r.slots);
    const status = r.auto
      ? season
        ? `Selon la saison : ${base.label}, jusqu’au ${until(season.to)}.`
        : `Selon la saison : ${base.label}.`
      : `Skin choisi : ${base.label}.`;
    const tweaks = r.overridden.length ? ` ${r.overridden.length} retouche${r.overridden.length > 1 ? 's' : ''} à la main.` : '';

    const skinCard = (skin, { auto = false } = {}) => {
      const sel = auto ? r.auto : !r.auto && r.skin === skin.id;
      return h('button.wd-skin' + (sel ? '.sel' : ''), { title: auto ? 'Le skin de la saison, Ganymède le reste de l’année' : skin.label, onclick: () => set(auto ? Wardrobe.reset() : Wardrobe.chooseSkin(look, skin.id)) },
        miniGany(skin.slots, { size: 58 }).canvas,
        h('span', auto ? 'Selon la saison' : skin.label),
        auto ? h('span.wd-sub', seasonal.id === 'classic' ? 'Ganymède' : seasonal.label) : null,
      );
    };

    const slotRow = (slot) => {
      const mine = r.overridden.includes(slot.id);
      return h('div.wd-slot',
        h('div.wd-slot-l', slot.label, mine ? h('button.wd-undo', { title: `Revenir à celui du skin ${base.label}`, onclick: () => set(Wardrobe.chooseSlot(look, slot.id, null, { date: now })) }, '↺') : null),
        h('div.wd-opts', slot.options.map(([v, label]) =>
          h('button.wd-opt' + (r.slots[slot.id] === v ? '.sel' : '') + (mine && r.slots[slot.id] === v ? '.mine' : ''), { onclick: () => set(Wardrobe.chooseSlot(look, slot.id, v, { date: now })) }, label),
        )),
      );
    };

    mount(box,
      h('label.l', f.label, flag),
      h('div.wd-top',
        h('div.wd-stage',
          preview.canvas,
          h('div.wd-moods', PREVIEW_MOODS.map(([m, label]) =>
            h('button.wd-opt' + (previewMood === m ? '.sel' : ''), { onclick: (e) => {
              previewMood = m;
              preview.gany.setMood(m);
              for (const b of e.target.parentNode.children) b.classList.toggle('sel', b === e.target);
            } }, label),
          )),
        ),
        h('div.wd-side',
          h('div.status', h('span.state-dot', { style: { '--c': r.auto ? 'var(--gold)' : 'var(--ok)' } }), status + tweaks),
          h('div.help', 'Un skin habille Gany de la tête aux pieds ; chaque pièce se change ensuite à la main. Sans choix de ta part, Gany suit la saison (Halloween en octobre). Les fêtes ajoutent encore leur chapeau.'),
          h('div.wd-skins', skinCard(seasonal, { auto: true }), Wardrobe.SKINS.map((k) => skinCard(k))),
          h('div.btns', { style: { marginTop: '10px' } },
            h('button.btn', { disabled: r.auto && !r.overridden.length, onclick: () => set(Wardrobe.reset()) }, 'Remettre à zéro (selon la saison)'),
            h('button.btn', {
              title: 'Le petit air d’accueil, dans le thème des sons en place',
              onclick: () => {
                const theme = Wardrobe.resolve(S.settings[section]?.[f.key], { soundTheme: S.settings[section]?.soundTheme }).sound;
                Sound.configure({ ...(S.settings.general || {}), sounds: true });
                Sound.play('greet', { theme });
              },
            }, '▶ Écouter les sons'),
          ),
        ),
      ),
      h('div.wd-slots', Wardrobe.SLOTS.map(slotRow)),
    );
  };
  draw();
  return box;
}

// ── Updates (src/main/updater.js) ───────────────────────────────────────────

const ago = (ms) => {
  if (!ms) return 'jamais';
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'à l’instant';
  if (m < 60) return `il y a ${m} min`;
  const hrs = Math.round(m / 60);
  return hrs < 24 ? `il y a ${hrs} h` : `il y a ${Math.round(hrs / 24)} j`;
};

let updateBox = null;
function updatePanel() {
  updateBox = h('div.field', h('div.dim', 'Vérification…'));
  api.core('update').then(renderUpdate);
  return updateBox;
}

function renderUpdate(u) {
  if (!updateBox || !u) return;
  const busy = ['checking', 'downloading', 'installing'].includes(u.status);
  const dot = u.status === 'error' ? 'var(--bad)' : u.status === 'ready' ? 'var(--gold)' : u.status === 'uptodate' ? 'var(--ok)' : 'var(--dim)';
  const line =
    u.mode === 'dev'
      ? 'Mode développement (npm run dev) : pas de mise à jour.'
      : u.status === 'checking'
        ? 'Vérification…'
        : u.status === 'downloading'
          ? `Téléchargement de la ${u.latest}${u.progress != null ? ` : ${Math.round(u.progress * 100)} %` : '…'}`
          : u.status === 'ready'
            ? `La ${u.ready} est prête : un clic et Ambrosia redémarre dessus.`
            : u.status === 'installing'
              ? 'Installation, Ambrosia redémarre…'
              : u.mode === 'source' && u.latest
                ? `Version publiée : ${u.latest}`
                : u.status === 'uptodate'
                  ? 'Ambrosia est à jour.'
                  : u.status === 'error'
                    ? 'La dernière tentative a échoué.'
                    : u.latest
                      ? `La ${u.latest} est publiée.`
                      : '—';
  const out = h('div.small', { style: { marginTop: '6px' } });
  const run = (name) => async (e) => {
    e.target.disabled = true;
    out.textContent = '…';
    try {
      renderUpdate(await api.core(name));
    } catch (err) {
      out.textContent = err.message;
      e.target.disabled = false;
    }
  };
  mount(updateBox,
    h('label.l', `Version en place : ${u.running}`),
    h('div.status', h('span.state-dot', { style: { '--c': dot } }), line),
    u.error ? h('div.note', u.error) : null,
    u.mode === 'source'
      ? h('div.help', `Ambrosia tourne depuis ses sources (npm start, npm run deploy) : elle ne se remplace pas toute seule. « Installer la version publiée » la télécharge dans ${u.appHome}, met le menu Démarrer et le lancement automatique dessus, puis redémarre : elle se mettra ensuite à jour d’elle-même.`)
      : null,
    h('div.help', `Dernière vérification : ${ago(u.lastCheck)}. Source : github.com/${u.repo}, fichiers vérifiés par leur empreinte SHA-256.`),
    h('div.btns', { style: { marginTop: '10px' } },
      u.mode === 'packaged' && u.status === 'ready' ? h('button.btn.primary', { onclick: run('updateInstall') }, `Mettre à jour (${u.ready})`) : null,
      u.mode === 'source' && u.latest ? h('button.btn.primary', { disabled: busy, onclick: run('updateInstall') }, 'Installer la version publiée') : null,
      u.mode !== 'dev' ? h('button.btn', { disabled: busy, onclick: run('updateCheck') }, 'Vérifier maintenant') : null,
      u.notes ? h('button.btn', { onclick: () => api.core('openExternal', u.notes) }, 'Voir les nouveautés') : null,
    ),
    out,
  );
}

// ── CLI status ──────────────────────────────────────────────────────────────

function cliPanel() {
  const box = h('div.field', h('div.dim', 'Vérification de la CLI…'));
  const refresh = async () => {
    const st = await api.core('claudeStatus');
    mount(box,
      h('label.l', 'État'),
      h('div.status', h('span.state-dot', { style: { '--c': st.loggedIn ? 'var(--ok)' : 'var(--bad)' } }),
        !st.path ? 'CLI Claude introuvable' : st.loggedIn ? `Connectée (${st.authMethod || 'abonnement'})${st.email ? ' · ' + st.email : ''}` : 'Non connectée'),
      st.path ? h('div.help.mono', st.path) : null,
      !st.loggedIn && st.path
        ? h('div.note', 'Connecte la CLI une fois avec ton compte Claude (abonnement). Un terminal va s’ouvrir : suis les instructions, puis reviens ici.')
        : null,
      h('div.btns', { style: { marginTop: '10px' } },
        !st.loggedIn && st.path ? h('button.btn.primary', { onclick: () => api.core('claudeLogin') }, 'Se connecter à Claude') : null,
        h('button.btn', { onclick: refresh }, 'Revérifier'),
      ),
    );
  };
  refresh();
  return box;
}

function render() {
  stopWardrobe();
  renderNav();
  const sec = sections().find((s) => s.id === S.current) || sections()[0];
  const content = document.getElementById('content');
  mount(content,
    h('h1', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, sec.module?.logo ? h('img', { src: '../renderer/' + sec.module.logo, alt: '', style: { width: '24px', height: '24px', objectFit: 'contain' } }) : sec.icon, sec.name),
    sec.lead ? h('div.lead', sec.lead) : null,
    sec.special === 'cli' ? cliPanel() : null,
    sec.special === 'update' ? updatePanel() : null,
    sec.fields.map((f) => field(sec.id, f)),
  );
}

async function boot() {
  const b = await api.core('boot');
  S.settings = b.settings;
  S.modules = b.modules;
  logo = new Gany(document.getElementById('logo'));
  logo.setLook(Wardrobe.resolve(S.settings.gany?.look).slots);
  render();
  logo.start();
  logo.setFps(30);
  api.on('goto', go);
  api.on('update', (u) => S.current === 'update' && renderUpdate(u));
  api.on('manifest', (m) => {
    S.modules = m;
    renderNav();
  });
}

boot();
