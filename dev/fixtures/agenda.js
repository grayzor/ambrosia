// Agenda in the dev preview: what src/modules/agenda/main.js adds to the sample
// meetings of dev/island.html — the « late » mail, invitations to answer, Gemini's
// notes after a meeting — and fake actions (nothing is sent anywhere).
// The webcam mirror gets a drawn camera (window.__ambrosiaFakeCamera): the preview
// never asks the browser for the real one.
//
//   ?open=agenda            the tab: invitations, after-meeting actions, meetings
//   ?alert=late / brief     the meeting alerts, with « Prévenir du retard » / « Me voir »
//   ?alert=invite / notes   a new invitation, the after-meeting alert
//   ?alert=mirror           « Me voir » clicked: the mirror opens in the tab

const MIN = 60000;
const now = Date.now();
const iso = (min) => new Date(now + min * MIN).toISOString();
const day = (d) => {
  const x = new Date(now + d * 86400000);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
};
const at = (d, h, m = 0) => new Date(day(d) + (h * 60 + m) * MIN).toISOString();
const when = (start, end) => {
  const s = new Date(Date.parse(start));
  const hm = (ms) => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${s.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })}, ${hm(Date.parse(start))}–${hm(Date.parse(end))}`;
};

const LATE = {
  a: ['lea.martin@example.com', 'karim.benali@example.com', 'sophie.bernard@example.com'],
  b: ['camille.martin@example.com', 'hugo.bernard@example.com'],
};
const lateDraft = (id, title) => ({ to: LATE[id] || [], subject: `Retard — ${title}`, text: 'Bonjour, j’arrive dans 5 min.\n\n— Camille', minutes: 5, sent: null });

const inv1 = { start: at(1, 10), end: at(1, 11) };
const inv2 = { start: at(3, 14), end: at(3, 14, 30) };
const INVITATIONS = [
  {
    key: 'inv1', id: 'inv1', title: 'Comité de pilotage ATLAS', ...inv1, when: when(inv1.start, inv1.end), startMs: Date.parse(inv1.start),
    organizer: 'Léa Martin', organizerEmail: 'lea.martin@example.com', series: false, meet: true, location: '', attendees: 8,
    conflicts: [{ title: 'Point hebdo support', when: when(at(1, 10, 30), at(1, 11, 30)) }], responding: null, error: null,
  },
  {
    key: 'serie42', id: 'serie42_20261016', title: 'Point support boutiques', ...inv2, when: when(inv2.start, inv2.end), startMs: Date.parse(inv2.start),
    organizer: 'Inès Moreau', organizerEmail: 'ines.moreau@example.com', series: true, meet: true, location: '', attendees: 4,
    conflicts: [], responding: null, error: null,
  },
];

const NOTES = [
  {
    id: 'past1', title: 'Revue des incidents', start: iso(-95), end: iso(-35), status: 'found', tries: 2, read: true, canRead: true, clickup: true,
    notes: { title: 'Revue des incidents - 2026/10/13 09:00 CEST - Notes de Gemini', url: 'https://docs.google.com/document/d/example-notes/edit' },
    decisions: ['Le correctif du TPE est déployé d’abord sur les 5 boutiques pilotes.', 'Le support niveau 1 garde la main sur les réinitialisations de mot de passe.'],
    actions: [
      { id: 'a0', text: 'Préparer la liste des boutiques pilotes pour le correctif TPE', due: '2026-10-15', state: 'open' },
      { id: 'a1', text: 'Relancer le prestataire sur le ticket d’imprimante Lyon Part-Dieu', due: '', state: 'open' },
    ],
  },
  { id: 'past2', title: 'Daily Support', start: iso(-30), end: iso(-15), status: 'waiting', tries: 1, nextAt: now + 10 * MIN, actions: [], decisions: [] },
];

const LISTS = [
  { id: '901234', name: 'Actions de réunion', path: 'Olympe IT / Suivi' },
  { id: '901235', name: 'Support boutiques', path: 'Olympe IT / Run' },
  { id: '901236', name: 'Projets 2027', path: 'Olympe IT' },
];

let st = null; // the very object dev/island.html holds (its inline fake actions mutate it too)
let push = () => {};
let emit = () => {};
const set = (patch) => {
  Object.assign(st, patch);
  push({ ...st });
};
const later = (ms, fn) => new Promise((r) => setTimeout(() => r(fn()), ms));
const patchNote = (id, fn) => set({ notes: st.notes.map((n) => (n.id === id ? fn({ ...n }) : n)) });
const patchAction = (id, actionId, patch) => patchNote(id, (n) => ({ ...n, actions: n.actions.map((a) => (a.id === actionId ? { ...a, ...patch } : a)) }));

/** A drawn camera: a slow gradient, a silhouette, and a clock (so a frozen frame shows). */
function fakeCamera() {
  const c = Object.assign(document.createElement('canvas'), { width: 640, height: 360 });
  const g = c.getContext('2d');
  const stream = c.captureStream(15);
  const track = stream.getVideoTracks()[0];
  const t0 = performance.now();
  (function frame() {
    if (track.readyState === 'ended') return; // the mirror stopped it
    const t = (performance.now() - t0) / 1000;
    const grad = g.createLinearGradient(0, 0, 640, 360);
    grad.addColorStop(0, `hsl(${(200 + t * 8) % 360} 35% 32%)`);
    grad.addColorStop(1, `hsl(${(260 + t * 8) % 360} 30% 18%)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 640, 360);
    g.fillStyle = 'rgba(255,220,180,.85)';
    g.beginPath();
    g.arc(320 + Math.sin(t) * 6, 150, 62, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.ellipse(320, 360, 150, 110, 0, Math.PI, 0);
    g.fill();
    g.fillStyle = '#fff';
    g.font = '600 20px Segoe UI, sans-serif';
    g.fillText('Caméra simulée (dev) · ' + new Date().toLocaleTimeString('fr-FR'), 18, 34);
    requestAnimationFrame(frame);
  })();
  return stream;
}

export default {
  module: { id: 'agenda', name: 'Agenda', icon: '◷', logo: 'icons/calendar.svg', color: '#F2A65A', order: 15, hasView: true, dir: 'agenda', enabled: true, settings: [] },

  /** dev/island.html's sample agenda, completed with what the new features need. */
  state(prev = {}) {
    st = prev;
    Object.assign(st, {
      mirror: true,
      lateChips: [5, 10, 15],
      invitations: INVITATIONS.map((i) => ({ ...i })),
      notes: NOTES.map((n) => ({ ...n, actions: n.actions.map((a) => ({ ...a })) })),
      clickupList: { id: '901234', name: 'Actions de réunion' },
      meetings: (st.meetings || []).map((m) => ({ ...m, late: lateDraft(m.id, m.title), lateSending: false })),
    });
    return st;
  },

  connect(send, emitter) {
    push = send;
    emit = emitter;
    window.__ambrosiaFakeCamera = fakeCamera;
  },

  async action(name, p = {}) {
    switch (name) {
      case 'mirror':
        set({ focusMirror: { id: p.id, at: Date.now() } });
        return emit('expand', { id: 'agenda' });
      case 'lateForm':
        set({ focusLate: { id: p.id, at: Date.now() } });
        return emit('expand', { id: 'agenda' });
      case 'sendLate': {
        const to = String(p.to || '').split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);
        set({ meetings: st.meetings.map((m) => (m.id === p.id ? { ...m, lateSending: true } : m)) });
        return later(1200, () => {
          set({ meetings: st.meetings.map((m) => (m.id === p.id ? { ...m, lateSending: false, late: { ...m.late, sent: { at: Date.now(), to } } } : m)) });
          console.log('[dev] late mail (not sent):', p);
          return { ok: true };
        });
      }
      case 'setCamera':
        return true;
      case 'respond':
        set({ invitations: st.invitations.map((i) => (i.key === p.key ? { ...i, responding: p.status } : i)) });
        return later(900, () => {
          console.log('[dev] respond_to_event (not called):', p);
          set({ invitations: st.invitations.filter((i) => i.key !== p.key) });
          return { ok: true };
        });
      case 'showInvites':
        return emit('expand', { id: 'agenda' });
      case 'showNotes':
        set({ focusNotes: { id: p.id, at: Date.now() } });
        return emit('expand', { id: 'agenda' });
      case 'checkNotes':
        patchNote(p.id, (n) => ({ ...n, running: true }));
        return later(1500, () => patchNote(p.id, (n) => ({ ...n, running: false, tries: n.tries + 1, nextAt: Date.now() + 20 * MIN })));
      case 'createTask':
        patchAction(p.id, p.actionId, { state: 'creating' });
        return later(1000, () => {
          patchAction(p.id, p.actionId, { state: 'created', taskUrl: 'https://app.clickup.com/t/example' });
          return { ok: true };
        });
      case 'ignoreAction':
        patchAction(p.id, p.actionId, { state: 'ignored' });
        return true;
      case 'copyAction':
        return true;
      case 'hideNotes':
        set({ notes: st.notes.filter((n) => n.id !== p.id) });
        return true;
      case 'clickupLists':
        return later(800, () => ({ ok: true, lists: LISTS }));
      case 'setClickupList':
        set({ clickupList: { id: p.id, name: p.name } });
        return true;
      default:
        return null;
    }
  },

  alert(name) {
    if (name === 'invite') {
      const i = INVITATIONS[0];
      return { key: 'agenda:invite-inv1', module: 'agenda', at: Date.now(), ttl: 600, title: `Invitation : ${i.title}`, text: `${i.when} · de ${i.organizer} · en conflit avec « ${i.conflicts[0].title} »`, mood: 'mail', priority: 55,
        actions: [{ label: 'Accepter', action: 'respond', payload: { key: 'inv1', status: 'accepted' }, primary: true }, { label: 'Peut-être', action: 'respond', payload: { key: 'inv1', status: 'tentative' } }, { label: 'Refuser', action: 'respond', payload: { key: 'inv1', status: 'declined' } }] };
    }
    if (name === 'notes') {
      return { key: 'agenda:notes-past1', module: 'agenda', at: Date.now(), ttl: 600, title: 'Après « Revue des incidents » : 2 actions pour toi', text: NOTES[0].actions.map((a) => a.text).join(' · '), mood: 'mail', priority: 50,
        actions: [{ label: 'Voir', action: 'showNotes', payload: { id: 'past1' }, primary: true }] };
    }
    if (name === 'mirror') {
      setTimeout(() => this.action('mirror', { id: 'b' }), 300);
    }
    return null;
  },
};
