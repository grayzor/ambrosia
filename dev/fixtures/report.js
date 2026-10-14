// Bilan in the dev preview: a sample draft, and fake actions that behave like
// src/modules/report/main.js (nothing is sent anywhere). Loaded by dev/island.html.
// window.devReport.push() re-sends the state, to check that edits survive an update.

const MIN = 60000;
const day = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const ago = (days) => day(new Date(Date.now() - days * 86400000));

const FAITS = [
  { texte: 'J’ai livré la recette de l’anonymisation Mnémosyne (DATA-666) à Julie.', source: 'clickup' },
  { texte: 'J’ai validé avec Thomas le plan de bascule ATLAS pour jeudi.', source: 'mail' },
  { texte: 'J’ai corrigé l’adresse de facturation dans le flux client (DATA-753).', source: 'chat' },
  { texte: 'J’ai ajouté le module Bilan à Ambrosia (rédaction, relecture, envoi sur clic).', source: 'claude' },
  { texte: 'J’ai animé le point « ATLAS - prio de la journée ».', source: 'agenda' },
];

function sampleDraft(rev = 1) {
  const body = [
    'Bonjour Sophie, bonjour Marc,',
    '',
    'Aujourd’hui :',
    ...FAITS.map((f) => `- ${f.texte}`),
    '',
    'En cours :',
    '- Recette du flux factures : retours métier attendus demain matin.',
    '',
    'Points d’attention :',
    '- Accès à l’environnement de préproduction toujours en attente côté infra.',
    '',
    'Demain :',
    '- Répétition de la bascule ATLAS avec l’équipe.',
    '',
    'Bonne soirée,',
    'Camille',
  ].join('\n');
  return {
    id: Date.now(),
    day: day(),
    createdAt: Date.now() - 6 * MIN,
    rev,
    status: 'ready',
    to: ['sophie.bernard@example.com', 'marc.lefevre@example.com'],
    subject: `Bilan du ${new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}`,
    body,
    faits: FAITS.map((f) => ({ ...f })),
    removed: [],
    enCours: [],
    blocages: [],
    demain: [],
    sources: ['gmail', 'clickup', 'chat'],
    error: null,
  };
}

let state = {
  busy: null,
  error: null,
  draft: sampleDraft(),
  nextAt: null,
  history: [
    { day: ago(1), outcome: 'sent', at: Date.now() - 86400000, to: ['sophie.bernard@example.com'], subject: 'Bilan de la journée', faits: 4 },
    { day: ago(3), outcome: 'ignored', at: Date.now() - 3 * 86400000, to: [], subject: 'Bilan du jour', faits: 2 },
  ],
};

let push = () => {};
const set = (patch) => {
  state = { ...state, ...patch };
  push(state);
};

export default {
  module: { id: 'report', name: 'Bilan', icon: '✎', color: '#8FD3A8', order: 35, secondary: true, hasView: true, dir: 'report', enabled: true, settings: [] },
  state: () => state,
  /** island.html hands over a way to push a new state, as the main process would. */
  connect(send) {
    push = send;
    window.devReport = { push: () => push({ ...state }), state: () => state };
  },
  action(name, p = {}) {
    const d = state.draft;
    const edit = () => {
      if (!d) return;
      if (p.to) d.to = p.to;
      if (typeof p.subject === 'string') d.subject = p.subject;
      if (typeof p.body === 'string') d.body = p.body;
      d.edited = true;
    };
    switch (name) {
      case 'edit':
        edit();
        return true;
      case 'removeFact': {
        edit();
        const [f] = d.faits.splice(p.index, 1);
        const lines = d.body.split('\n');
        const i = lines.findIndex((l) => l.replace(/^\s*-\s*/, '').trim() === f.texte);
        if (i >= 0) {
          lines.splice(i, 1);
          d.body = lines.join('\n');
          d.rev++;
        }
        set({ draft: { ...d } });
        return true;
      }
      case 'draftNow':
      case 'regenerate':
        set({ busy: 'drafting' });
        setTimeout(() => set({ busy: null, draft: { ...sampleDraft((d?.rev || 0) + 1), to: d?.to || sampleDraft().to } }), 1500);
        return true;
      case 'send':
      case 'gmailDraft':
        edit();
        set({ busy: name === 'send' ? 'sending' : 'drafting-gmail' });
        setTimeout(() => {
          if (p.subject?.includes('erreur')) return set({ busy: null, draft: { ...d, error: 'Résultat incertain : vérifie dans Gmail avant de recommencer.', uncertain: true } });
          set({ busy: null, draft: null, history: [{ day: day(), outcome: name === 'send' ? 'sent' : 'draft', at: Date.now(), to: d.to, subject: d.subject, faits: d.faits.length }, ...state.history] });
        }, 1200);
        return { ok: true };
      case 'ignore':
        set({ draft: null, history: [{ day: day(), outcome: 'ignored', at: Date.now(), to: d.to, subject: d.subject, faits: d.faits.length }, ...state.history] });
        return true;
      default:
        return null;
    }
  },
};
