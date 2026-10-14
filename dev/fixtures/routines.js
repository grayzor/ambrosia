// Routines in the dev preview: sample suggestions, and fake actions that behave like
// src/modules/routines/main.js (nothing is created, Claude Desktop is not opened).
// dev/island.html?open=routines · ?alert=routine shows the soft alert.
// window.devRoutines.push() re-sends the state, to check that a prompt being edited survives.

const MIN = 60000;
const DAY = 86400000;
const RHYTHMS = [
  ['workdays', 'Du lundi au vendredi', '1-5'], ['daily', 'Tous les jours', '*'], ['mon', 'Chaque lundi', '1'], ['tue', 'Chaque mardi', '2'],
  ['wed', 'Chaque mercredi', '3'], ['thu', 'Chaque jeudi', '4'], ['fri', 'Chaque vendredi', '5'], ['monthly', 'Le 1er du mois'], ['hourly', 'Toutes les heures'],
];
const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const label = (cron) => {
  const [mi, ho, dom, , dow] = cron.split(' ');
  const at = `à ${Number(ho)} h${Number(mi) ? ' ' + mi.padStart(2, '0') : ''}`;
  if (ho === '*') return `Toutes les heures (à ${mi.padStart(2, '0')})`;
  if (dom === '1') return `Le 1er de chaque mois ${at}`;
  if (dow === '1-5') return `Du lundi au vendredi ${at}`;
  if (dow === '*') return `Chaque jour ${at}`;
  return /^\d$/.test(dow) ? `Chaque ${DAYS[Number(dow)]} ${at}` : `Planning cron : ${cron}`;
};

const PROMPT_TICKETS = `Tu es une tâche planifiée qui prépare le point d'équipe Support informatique du lundi pour Camille Dupont (camille.dupont@olympe.example), Olympe Industries. Chaque exécution démarre sans mémoire : tout est ici.

# Objectif
Rassembler les tickets HelpDesk de la semaine écoulée qui concernent les boutiques, et préparer un résumé que Camille relira avant le point de 9 h 30.

# Outils à utiliser
- Connecteur Gmail : search_threads, get_thread, create_draft

# Étapes
1. search_threads avec query = "from:support@olympe.example newer_than:7d", pageSize = 50.
2. Regroupe les tickets par boutique et par statut (ouvert, en attente, résolu). Lis au plus 10 fils avec get_thread si le statut n'est pas clair.
3. Prépare un brouillon Gmail (create_draft) adressé à Camille lui-même, objet « Point support - tickets de la semaine », avec : les tickets encore ouverts (les plus anciens d'abord), ceux en attente d'un retour boutique, le nombre de tickets résolus.

# Sortie
Un brouillon Gmail, et un résumé de 5 lignes dans ta réponse. Réponds en français.`;

const PROMPT_ATLAS = `Tu es une tâche planifiée qui vérifie chaque matin les tâches ClickUp ATLAS de Camille Dupont avant le point « ATLAS - prio de la journée ».

# Objectif
Lister les tâches ATLAS qui ont bougé depuis la veille (statut, commentaire, échéance) pour que Camille arrive au point en sachant quoi dire.

# Outils à utiliser
- ClickUp : clickup_filter_tasks, clickup_get_task

# Étapes
1. clickup_filter_tasks avec assignees = [son identifiant], order_by = "updated", include_closed = true.
2. Garde les tâches dont le nom commence par « [ATLAS- » et mises à jour depuis hier 9 h.
3. Pour chacune : statut, dernière activité, échéance dépassée ou non.

# Sortie
Un tableau court dans ta réponse, les échéances dépassées en premier. Réponds en français.`;

const now = Date.now();
const SUGGESTIONS = [
  {
    id: 's1', rev: 1, status: 'new', createdAt: now - 20 * MIN, source: 'claude', taskId: 'point-support-tickets-de-la-semaine',
    titre: 'Point support du lundi : tickets HelpDesk de la semaine',
    description: 'Rassemble les tickets HelpDesk de la semaine par boutique et prépare un brouillon de résumé avant le point du lundi.',
    pourquoi: 'Trois lundis de suite, tu as demandé à Claude la liste des tickets boutiques avant le point support de 9 h 30.',
    occurrences: ['28/09 · HelpDesk : « liste les tickets ouverts des boutiques »', '05/10 · HelpDesk : « refais la liste des tickets HelpDesk de la semaine »', '12/10 · HelpDesk : « même liste que la semaine dernière »'],
    cron: '15 8 * * 1', frequence: label('15 8 * * 1'), gain: '~25 min par semaine',
    outils: ['search_threads', 'get_thread', 'create_draft'], prompt: PROMPT_TICKETS,
  },
  {
    id: 's2', rev: 1, status: 'new', createdAt: now - 20 * MIN, source: 'agenda', taskId: 'atlas-taches-du-matin',
    titre: 'Ce qui a bougé sur ATLAS avant la prio du jour',
    description: 'Liste chaque matin les tâches ClickUp ATLAS mises à jour depuis la veille, avant le point « ATLAS - prio de la journée ».',
    pourquoi: 'Le point « ATLAS - prio de la journée » revient chaque matin, et tu ouvres ClickUp juste avant pour faire le tour des tâches.',
    occurrences: ['Réunion quotidienne à 9 h 15 (récurrente)', '6, 7 et 9/10 : tâches ATLAS consultées entre 9 h et 9 h 15'],
    cron: '0 9 * * 1-5', frequence: label('0 9 * * 1-5'), gain: '~10 min par jour',
    outils: ['clickup_filter_tasks', 'clickup_get_task'], prompt: PROMPT_ATLAS,
  },
];

let state = {
  busy: null,
  error: null,
  suggestions: SUGGESTIONS.map((s) => ({ ...s })),
  created: [{ taskId: 'releve-ventes-hebdo', titre: 'Relevé des ventes hebdo', frequence: 'Chaque vendredi à 16 h', at: now - 3 * DAY }],
  lastRun: now - 25 * MIN,
  lastResult: { at: now - 25 * MIN, found: 2, rejected: 1, rien: '' },
  cadence: 'jour',
  rhythms: RHYTHMS.map(([id, l]) => ({ id, label: l })),
};

let push = () => {};
const set = (patch) => {
  state = { ...state, ...patch };
  push(state);
};
const patchOne = (id, patch) => set({ suggestions: state.suggestions.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
const find = (id) => state.suggestions.find((s) => s.id === id);

export default {
  module: { id: 'routines', name: 'Routines', icon: '↻', color: '#6FC8D8', order: 38, secondary: true, hasView: true, dir: 'routines', enabled: true, settings: [] },
  state: () => state,
  connect(send) {
    push = send;
    window.devRoutines = { push: () => push({ ...state }), state: () => state };
  },
  alert(name) {
    if (name !== 'routine') return null;
    return { key: 'routines:suggest', module: 'routines', at: Date.now(), title: 'Gany a repéré une tâche qui se répète', text: `${SUGGESTIONS[0].titre} (+1 autre)`, mood: 'wink', priority: 30, ttl: 30,
      actions: [{ label: 'Voir', action: 'open', primary: true }] };
  },
  action(name, p = {}) {
    const s = find(p.id);
    if (s && typeof p.prompt === 'string') s.prompt = p.prompt;
    switch (name) {
      case 'edit':
        return true;
      case 'setCron': {
        const r = RHYTHMS.find((x) => x[0] === p.rhythm);
        const [h, m] = String(p.time || '').split(':').map(Number);
        const cron = p.cron || (r && (r[0] === 'hourly' ? `${m} * * * *` : r[0] === 'monthly' ? `${m} ${h} 1 * *` : `${m} ${h} * * ${r[2]}`));
        if (!cron || /^\*|\//.test(cron) || cron.split(' ').length !== 5) return { ok: false, error: 'Fréquence invalide.' };
        patchOne(p.id, { cron, frequence: label(cron), error: null });
        return { ok: true };
      }
      case 'create':
        if (/envoie/i.test(s.prompt)) {
          patchOne(p.id, { status: 'error', error: 'Gany ne crée pas cette tâche : Action sortante demandée : « Envoie… »' });
          return { ok: false };
        }
        patchOne(p.id, { status: 'launched', error: null });
        // ?fail=1: Gany never sees the task appear
        setTimeout(() => {
          if (new URLSearchParams(location.search).get('fail')) return patchOne(p.id, { status: 'unconfirmed', error: 'Je ne vois pas la tâche dans Claude. As-tu envoyé la demande dans la session ouverte ?' });
          const x = find(p.id);
          set({ suggestions: state.suggestions.filter((y) => y.id !== p.id), created: [{ taskId: x.taskId, titre: x.titre, frequence: x.frequence, at: Date.now() }, ...state.created] });
        }, 2500);
        return { ok: true };
      case 'recheck':
        patchOne(p.id, { status: 'launched', error: null });
        return true;
      case 'refuse':
        set({ suggestions: state.suggestions.filter((y) => y.id !== p.id) });
        return true;
      case 'copy':
        return true;
      case 'analyze':
        set({ busy: 'analyzing' });
        setTimeout(() => set({ busy: null, lastRun: Date.now(), suggestions: state.suggestions.length ? state.suggestions : SUGGESTIONS.map((x) => ({ ...x })) }), 1500);
        return true;
      default:
        return null;
    }
  },
};
