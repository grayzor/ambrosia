// Island panel for Agenda: today's real meetings, and whether you are in them;
// the webcam mirror, the « late » mail, invitations to answer, and the actions
// Gemini's notes left for the user after a meeting.

import { startMirror, stopMirror, mirrorBlock, mirrorId } from './mirror.js';

const hhmm = (ms) => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

function until(ms) {
  const m = Math.round((ms - Date.now()) / 60000);
  if (m <= 0) return 'maintenant';
  if (m < 60) return `dans ${m} min`;
  const h = Math.floor(m / 60);
  return `dans ${h} h${m % 60 ? String(m % 60).padStart(2, '0') : ''}`;
}

// Briefs the user unfolded (local to the view), and the last « Voir le brief » seen.
const unfolded = new Set();
let focusSeen = 0;
// « Me voir », « Prévenir du retard », « Voir » (notes) from an alert: each seen once.
const seen = { mirror: 0, late: 0, notes: 0 };
// The « late » forms (local: they survive the re-renders): id → { open, to, subject, text, confirm, error, uncertain }
const lateForms = new Map();
// Invitations: key → { status, text } while a comment is being written for « Peut-être » / « Refuser ».
const inviteNotes = new Map();
const inviteErrs = new Map();
// After-meeting actions: errors of the last click, the ClickUp list picker.
const taskErrs = new Map();
let picker = null; // { loading, lists, error }

const PHASE = {
  soon: { label: 'Bientôt', cls: 'gold' },
  now: { label: 'Maintenant', cls: 'bad' },
  late: { label: 'En retard', cls: 'bad' },
  later: { label: '', cls: '' },
};

export default {
  summary(st) {
    // An on-time streak earns a laurel in the notch for the day.
    const base = summarize(st);
    if (!st.trophy) return base;
    return { ...(base || {}), trophy: st.trophy };
  },

  render(root, st, ui) {
    return render(root, st, ui);
  },
};

function summarize(st) {
  {
    const list = st.meetings || [];
    const alarm = list.find((e) => ['soon', 'now', 'late'].includes(e.phase) && !e.joined && !e.acked);
    const next = list.find((e) => e.phase === 'later' || e.phase === 'soon');
    const inCall = list.find((e) => e.joined && ['now', 'late'].includes(e.phase));
    if (alarm) {
      return {
        badge: { text: alarm.phase === 'soon' ? `◷ ${Math.max(1, Math.round((alarm.startMs - Date.now()) / 60000))} min` : alarm.phase === 'late' ? '◷ retard' : '◷ maintenant', color: alarm.phase === 'soon' ? '#F2A65A' : '#F0616D' },
        count: 1,
        text: `${alarm.title} · ${alarm.phase === 'soon' ? until(alarm.startMs) : alarm.phase === 'late' ? 'en cours sans toi' : 'c’est l’heure'}`,
      };
    }
    if (inCall) return { dots: [{ color: '#3FB950' }], text: `En réunion : ${inCall.title}` };
    if (next && next.startMs - Date.now() < 60 * 60000) {
      return { badge: { text: `◷ ${until(next.startMs).replace('dans ', '')}`, color: '#E8B923' }, text: `Prochaine réunion ${until(next.startMs)} : ${next.title}` };
    }
    return next ? { text: `Prochaine réunion à ${hhmm(next.startMs)}` } : null;
  }
}

function render(root, st, ui) {
  {
    const { h, ago } = ui;
    const list = st.meetings || [];

    root.append(
      h('div.row', { style: { margin: '0 2px 8px' } },
        h('span.small.dim.grow.ellipsis',
          st.status === 'checking' ? 'Gany lit ton agenda…' : st.fetchedAt ? `Agenda lu ${ago(st.fetchedAt)}` : 'Première lecture dans un instant',
          st.ignored ? ` · ${st.ignored} créneau${st.ignored > 1 ? 'x' : ''} ignoré${st.ignored > 1 ? 's' : ''} (solo, [Claude], focus…)` : '',
        ),
        h('button.btn.sm.ghost', { onclick: () => ui.action('openCalendar') }, 'Agenda'),
        h('button.btn.sm', { disabled: !!st.checking, onclick: () => { ui.sound.play('tick'); ui.action('refresh'); } }, st.checking ? '…' : 'Relire'),
      ),
    );

    if (st.status === 'auth') {
      root.append(h('div.card.hot', h('div.title', 'La CLI Claude n’est pas connectée'), h('div.btns', { style: { marginTop: '8px' } }, h('button.btn.primary.sm', { onclick: () => ui.action('login') }, 'Se connecter à Claude'))));
    } else if (st.status === 'no-connector') {
      root.append(
        h('div.card.hot',
          h('div.title', 'Google Calendar n’est pas relié à Claude Code'),
          h('div.dim.small', 'Sur claude.ai → Paramètres → Connecteurs, connecte (ou reconnecte) Google Calendar. Si le connecteur est juste lent à démarrer, Gany réessaie dans 3 minutes.'),
          st.error ? h('div.faint.small.ellipsis', { title: st.error }, st.error) : null,
          h('div.btns', { style: { marginTop: '8px' } },
            h('button.btn.sm', { onclick: () => ui.core('openExternal', 'https://claude.ai/settings/connectors') }, 'Ouvrir claude.ai'),
            h('button.btn.primary.sm', { onclick: async () => { await ui.action('detect'); await ui.action('refresh'); } }, 'Détecter et relire'),
          ),
        ),
      );
    } else if (st.status === 'error' && st.error) {
      root.append(h('div.card', h('div.small', { style: { color: '#FF9AA3' } }, 'Dernière lecture ratée : ', st.error)));
    }

    // From an alert: « Me voir » lights the camera (that click), « Prévenir du retard »
    // opens the form, « Voir » brings the after-meeting actions into view. Once each,
    // and only right after the click (not when the island reloads later).
    const fresh = (f, k) => f && f.at !== seen[k] && Date.now() - f.at < 20000 && (seen[k] = f.at);
    if (fresh(st.focusMirror, 'mirror') && st.mirror !== false) startMirror(st.focusMirror.id, ui);
    if (fresh(st.focusLate, 'late')) openLate(list.find((e) => e.id === st.focusLate.id));
    const notesFocus = fresh(st.focusNotes, 'notes') ? st.focusNotes.id : null;
    // The camera goes off once its meeting is joined, acknowledged or over.
    const mid = mirrorId();
    if (mid) {
      const m = list.find((e) => e.id === mid);
      if (!m || m.joined || m.acked || m.phase === 'over' || st.mirror === false) stopMirror();
    }

    for (const block of [invitesBlock(st, ui), notesBlock(st, ui)]) if (block) root.append(block);
    if (notesFocus) requestAnimationFrame(() => root.querySelector(`[data-notes="${CSS.escape(notesFocus)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));

    if (!list.length) {
      root.append(h('div.empty', st.fetchedAt ? 'Plus aucune réunion aujourd’hui. Gany veille quand même.' : ''));
      return;
    }

    // « Voir le brief » (from the alert): unfold that one and bring it into view.
    let scrollTo = st.focusLate && seen.late === st.focusLate.at && Date.now() - st.focusLate.at < 3000 ? st.focusLate.id : null;
    if (st.focusBrief && st.focusBrief.at !== focusSeen) {
      focusSeen = st.focusBrief.at;
      unfolded.add(st.focusBrief.id);
      scrollTo = st.focusBrief.id;
    }

    const cards = h('div.list');
    for (const e of list) {
      const active = ['soon', 'now', 'late'].includes(e.phase);
      const alarm = active && !e.joined && !e.acked;
      const state = e.joined
        ? h('span.pill.ok', 'Connecté ✓')
        : e.acked
          ? h('span.pill', 'OK')
          : PHASE[e.phase]?.label
            ? h(`span.pill.${PHASE[e.phase].cls}`, PHASE[e.phase].label)
            : h('span.faint.small', until(e.startMs));
      const showBrief = e.brief?.brief && unfolded.has(e.id);
      cards.append(
        h('div.card' + (alarm ? '.hot' : ''), { dataset: { id: e.id }, style: alarm && e.phase !== 'soon' ? { borderColor: 'rgba(240,97,109,.6)' } : null },
          h('div.row',
            h('span.mono.small', { style: { color: 'var(--gold-light)' } }, `${hhmm(e.startMs)}–${hhmm(e.endMs)}`),
            h('span.title.grow.ellipsis', { title: e.title }, e.title),
            state,
          ),
          h('div.small.faint.ellipsis', { style: { marginTop: '2px' } },
            e.meetUrl ? 'Meet' : 'Présentiel',
            e.location ? ` · ${e.location}` : '',
            ` · ${e.attendees} participants`,
            /needsAction/i.test(e.selfResponse) ? ' · pas encore répondu' : '',
            e.late?.sent ? h('span', { style: { color: '#7EE08F' } }, ` · retard signalé à ${hhmm(e.late.sent.at)} ✓`) : '',
          ),
          h('div.btns', { style: { marginTop: '6px' } },
            active || e.startMs - Date.now() < 15 * 60000
              ? [
                  // Meet wants the camera: the mirror lets go of it first.
                  e.meetUrl ? h('button.btn.sm' + (alarm ? '.primary' : ''), { onclick: () => { if (mirrorId() === e.id) stopMirror(); ui.action('join', { id: e.id }); } }, 'Rejoindre le Meet') : null,
                  alarm ? h('button.btn.sm', { title: 'C’est réglé : Gany ne dira plus rien pour cette réunion', onclick: () => ui.action('ack', { id: e.id }) }, 'OK') : null,
                  e.acked ? h('button.btn.sm.ghost', { onclick: () => ui.action('unack', { id: e.id }) }, 'Réactiver l’alerte') : null,
                ]
              : null,
            briefButton(e, ui),
            mirrorButton(e, st, ui),
            lateButton(e, ui),
          ),
          e.brief?.status === 'error' && !e.brief.brief ? h('div.small.faint.ellipsis', { style: { marginTop: '4px' }, title: e.brief.error || '' }, 'Brief raté : ', e.brief.error || 'erreur inconnue') : null,
          showBrief ? briefBlock(e, ui) : null,
          mirrorBlock(e.id, ui),
          lateForms.get(e.id)?.open ? lateBlock(e, st, ui) : null,
        ),
      );
    }
    root.append(cards);
    if (scrollTo) {
      requestAnimationFrame(() => root.querySelector(`[data-id="${CSS.escape(scrollTo)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    }
  }
}

/** « Préparer » before there is a brief, « Brief » to unfold it, a busy label while Gany reads. */
function briefButton(e, ui) {
  const { h } = ui;
  const b = e.brief;
  if (b?.status === 'pending') return h('button.btn.sm.ghost', { disabled: true }, 'Gany prépare le brief…');
  if (b?.brief) {
    const open = unfolded.has(e.id);
    return h('button.btn.sm' + (open ? '' : '.ghost'), {
      onclick: () => {
        open ? unfolded.delete(e.id) : unfolded.add(e.id);
        ui.sound.play('tick');
        ui.rerender();
      },
    }, open ? 'Masquer le brief' : 'Brief ▾');
  }
  return h('button.btn.sm.ghost', {
    title: 'Gany lit l’invitation, tes mails avec les participants, les tâches et documents liés (lecture seule)',
    onclick: () => {
      unfolded.add(e.id);
      ui.sound.play('tick');
      ui.action('brief', { id: e.id });
    },
  }, b?.status === 'error' ? 'Réessayer le brief' : 'Préparer');
}

/** The brief itself. Every string comes from outside: inserted as text by h(). */
function briefBlock(e, ui) {
  const { h, ago } = ui;
  const d = e.brief.brief;
  const link = (url, text) => h('span.link', { title: url, onclick: () => ui.action('openLink', { id: e.id, url }) }, text);
  const empty = !d.objet && !d.contexte.length && !d.participants.length && !d.documents.length && !d.taches.length && !d.aPreparer.length;
  return h('div.brief.small',
    empty ? h('div.dim', 'Gany n’a rien trouvé d’utile pour cette réunion.') : null,
    d.objet ? [h('div.brief-h', 'Objet'), h('div', d.objet)] : null,
    d.contexte.length ? [h('div.brief-h', 'Contexte'), h('ul', d.contexte.map((x) => h('li', x)))] : null,
    d.aPreparer.length ? [h('div.brief-h', 'À préparer'), h('ul', d.aPreparer.map((x) => h('li', { style: { color: 'var(--gold-light)' } }, x)))] : null,
    d.participants.length
      ? [
          h('div.brief-h', 'Participants'),
          d.participants.map((p) =>
            h('div.ellipsis', { title: [p.nom, p.role, p.dernierEchange].filter(Boolean).join(' · ') },
              h('span', { style: { fontWeight: 600 } }, p.nom),
              p.role ? h('span.dim', ` · ${p.role}`) : null,
              p.dernierEchange ? h('span.faint', ` · ${p.dernierEchange}`) : null,
            ),
          ),
        ]
      : null,
    d.documents.length ? [h('div.brief-h', 'Documents'), d.documents.map((x) => h('div.ellipsis', link(x.url, x.titre)))] : null,
    d.taches.length
      ? [
          h('div.brief-h', 'Tâches'),
          d.taches.map((t) => h('div.row', h('span.grow.ellipsis', t.url ? link(t.url, t.titre) : t.titre), t.statut ? h('span.pill', t.statut) : null)),
        ]
      : null,
    h('div.row', { style: { marginTop: '8px' } },
      h('span.faint.grow', e.brief.status === 'pending' ? 'Gany le met à jour…' : `Préparé ${ago(e.brief.at)}`),
      e.brief.status === 'pending' ? null : h('button.btn.sm.ghost', { onclick: () => ui.action('brief', { id: e.id }) }, 'Refaire'),
    ),
  );
}

// ── « Me voir » ──────────────────────────────────────────────────────────

/** Before a Meet (running, or within 30 min) that the user has not joined yet. */
function mirrorButton(e, st, ui) {
  const { h } = ui;
  if (st.mirror === false || !e.meetUrl || e.joined || e.acked || mirrorId() === e.id) return null;
  if (!['soon', 'now', 'late'].includes(e.phase) && e.startMs - Date.now() > 30 * 60000) return null;
  return h('button.btn.sm.ghost', {
    title: 'Un miroir pour vérifier caméra, coiffure et lumière avant d’entrer. Sans micro, rien n’est enregistré.',
    onclick: () => {
      ui.sound.play('tick');
      startMirror(e.id, ui);
    },
  }, 'Me voir');
}

// ── « Prévenir du retard » ───────────────────────────────────────────────

function openLate(e) {
  if (!e?.late) return;
  const f = lateForms.get(e.id);
  if (f) {
    f.open = true;
    return;
  }
  lateForms.set(e.id, { open: true, to: e.late.to.join(', '), subject: e.late.subject, text: e.late.text, minutes: e.late.minutes, confirm: false, error: null });
}

/** From a few minutes before the start until the meeting is joined. */
function lateButton(e, ui) {
  const { h } = ui;
  if (!e.late || e.joined || lateForms.get(e.id)?.open) return null;
  if (!['soon', 'now', 'late'].includes(e.phase) && e.startMs - Date.now() > 15 * 60000) return null;
  return h('button.btn.sm.ghost', {
    title: 'Un mot à l’organisateur et aux participants : tu relis, puis tu envoies',
    onclick: () => {
      openLate(e);
      ui.sound.play('tick');
      ui.rerender();
    },
  }, e.late.sent ? 'Prévenir à nouveau' : 'Prévenir du retard');
}

const nameOf = (email) => String(email).split('@')[0].split(/[._-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const names = (list) => {
  const n = list.map(nameOf);
  return n.length <= 1 ? n.join('') : n.length <= 3 ? `${n.slice(0, -1).join(', ')} et ${n[n.length - 1]}` : `${n.slice(0, 2).join(', ')} et ${n.length - 2} autres`;
};
const emails = (v) => String(v || '').split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);

/** Same rule as late.js withDelay: the first « N min » of the text follows the chip. */
function withDelay(text, m) {
  const re = /\b\d{1,3}\s?(min(utes?)?)\b/i;
  return re.test(text) ? text.replace(re, `${m} min`) : text;
}

/** The editable mail. Nothing leaves before « Envoyer… » then « Confirmer l’envoi ». */
function lateBlock(e, st, ui) {
  const { h } = ui;
  const f = lateForms.get(e.id);
  const sending = !!e.lateSending;
  const edit = (k) => (ev) => {
    f[k] = ev.target.value;
    if (f.confirm) {
      f.confirm = false;
      ui.rerender();
    }
  };
  const field = (label, input) => h('label', { style: { display: 'block', marginTop: '6px' } }, h('div.faint.small', { style: { margin: '0 0 3px 2px' } }, label), input);
  const onfocus = () => ui.focusWindow(); // the island keeps the keyboard while you type
  const chip = (m) =>
    h('button.btn.sm' + (Number(f.minutes) === m ? '.primary' : '.ghost'), {
      disabled: sending,
      onclick: () => {
        f.minutes = m;
        f.text = withDelay(f.text, m);
        f.confirm = false;
        ui.sound.play('tick');
        ui.rerender();
      },
    }, `${m} min`);
  const to = emails(f.to);
  return h('div.brief.small', { dataset: { late: e.id } },
    h('div.row',
      h('span.brief-h.grow', { style: { margin: 0 } }, 'Prévenir du retard'),
      (st.lateChips || [5, 10, 15]).map(chip),
    ),
    field('À', h('input.text', { type: 'text', value: f.to, spellcheck: false, placeholder: 'adresse@exemple.fr, …', disabled: sending, onfocus, oninput: edit('to') })),
    !e.late.to.length ? h('div.faint', { style: { marginTop: '3px' } }, 'Gany ne connaît pas encore les participants de cette réunion : ajoute les adresses.') : null,
    field('Objet', h('input.text', { type: 'text', value: f.subject, disabled: sending, onfocus, oninput: edit('subject') })),
    field('Message', h('textarea.text', { rows: 3, disabled: sending, onfocus, oninput: edit('text'), style: { resize: 'vertical', lineHeight: '1.4' } }, f.text)),
    e.late.sent ? h('div', { style: { marginTop: '6px', color: '#7EE08F' } }, `Prévenu à ${hhmm(e.late.sent.at)} : ${names(e.late.sent.to || [])} ✓`) : null,
    f.error ? h('div', { style: { marginTop: '6px', color: '#FF9AA3' } }, f.error) : null,
    h('div.btns.end', { style: { marginTop: '8px' } },
      sending
        ? h('button.btn.sm', { disabled: true }, 'Envoi en cours…')
        : f.confirm
          ? [
              h('span.dim.grow', { style: { alignSelf: 'center' } }, `Envoyer à ${names(to)} ?`),
              h('button.btn.sm.ghost', { onclick: () => { f.confirm = false; ui.rerender(); } }, 'Annuler'),
              h('button.btn.sm.primary', {
                onclick: async () => {
                  f.confirm = false;
                  f.error = null;
                  const r = await ui.action('sendLate', { id: e.id, to: f.to, subject: f.subject, body: f.text });
                  if (r?.ok) f.open = false;
                  else f.error = r?.error || 'Échec de l’envoi.';
                  ui.rerender();
                },
              }, 'Confirmer l’envoi'),
            ]
          : [
              h('button.btn.sm.ghost', { onclick: () => { f.open = false; f.confirm = false; ui.rerender(); } }, 'Fermer'),
              h('button.btn.sm.primary', {
                onclick: () => {
                  if (!emails(f.to).length || !f.text.trim()) {
                    f.error = 'Il faut au moins un destinataire et un message.';
                  } else {
                    f.confirm = true;
                    f.error = null;
                    ui.sound.play('tick');
                  }
                  ui.rerender();
                },
              }, 'Envoyer…'),
            ],
    ),
  );
}

// ── Invitations ──────────────────────────────────────────────────────────

const ANSWERS = [['accepted', 'Accepter'], ['tentative', 'Peut-être'], ['declined', 'Refuser']];

function invitesBlock(st, ui) {
  const { h } = ui;
  const list = st.invitations || [];
  if (!list.length) return null;
  return h('div.card', { style: { marginBottom: '8px' } },
    h('div.row', h('span.title.grow', `Invitations en attente (${list.length})`), h('span.faint.small', 'réponds sans ouvrir l’agenda')),
    list.map((inv) => inviteRow(inv, ui)),
  );
}

function inviteRow(inv, ui) {
  const { h } = ui;
  const note = inviteNotes.get(inv.key);
  const busy = !!inv.responding;
  const err = inviteErrs.get(inv.key) || inv.error;
  const send = async (status, comment = '') => {
    inviteErrs.delete(inv.key);
    const r = await ui.action('respond', { key: inv.key, status, comment });
    if (r?.ok) inviteNotes.delete(inv.key);
    else inviteErrs.set(inv.key, r?.error || 'Échec');
    ui.rerender();
  };
  return h('div', { dataset: { invite: inv.key }, style: { borderTop: '1px solid var(--line)', marginTop: '8px', paddingTop: '8px' } },
    h('div.row',
      h('span.grow.ellipsis', { style: { fontWeight: 600 }, title: inv.title }, inv.title),
      inv.series ? h('span.pill', { title: 'Réunion récurrente : la réponse vaut pour toute la série' }, 'Série') : null,
    ),
    h('div.small.faint.ellipsis', { style: { marginTop: '2px' }, title: inv.organizerEmail || '' },
      inv.when,
      inv.organizer ? ` · de ${inv.organizer}` : '',
      inv.meet ? ' · Meet' : inv.location ? ` · ${inv.location}` : '',
      inv.attendees ? ` · ${inv.attendees} participants` : '',
    ),
    inv.conflicts.length
      ? h('div.small.ellipsis', { style: { marginTop: '2px', color: '#FFB27A' }, title: inv.conflicts.map((c) => `${c.title} (${c.when})`).join('\n') },
          `⚠ En conflit avec « ${inv.conflicts[0].title} »`,
          inv.conflicts.length > 1 ? ` et ${inv.conflicts.length - 1} autre${inv.conflicts.length > 2 ? 's' : ''}` : '',
        )
      : null,
    note
      ? h('div', { style: { marginTop: '6px' } },
          h('input.text', {
            type: 'text',
            value: note.text,
            maxLength: 300,
            placeholder: 'Un mot pour l’organisateur (facultatif)',
            disabled: busy,
            onfocus: () => ui.focusWindow(),
            oninput: (ev) => (note.text = ev.target.value),
            onkeydown: (ev) => ev.key === 'Enter' && send(note.status, note.text),
          }),
          h('div.btns.end', { style: { marginTop: '6px' } },
            h('button.btn.sm.ghost', { disabled: busy, onclick: () => { inviteNotes.delete(inv.key); ui.rerender(); } }, 'Annuler'),
            h('button.btn.sm' + (note.status === 'declined' ? '.danger' : '.primary'), { disabled: busy, onclick: () => send(note.status, note.text) },
              busy ? 'Gany répond…' : note.status === 'declined' ? 'Refuser l’invitation' : 'Répondre « Peut-être »'),
          ),
        )
      : h('div.btns', { style: { marginTop: '6px' } },
          ANSWERS.map(([status, label]) =>
            h('button.btn.sm' + (status === 'accepted' ? '.primary' : status === 'declined' ? '.ghost' : ''), {
              disabled: busy,
              onclick: () => {
                ui.sound.play('tick');
                // « Accepter » answers at once; the other two may carry a word first.
                if (status === 'accepted') return send(status);
                inviteNotes.set(inv.key, { status, text: '' });
                ui.rerender();
              },
            }, busy && inv.responding === status ? 'Gany répond…' : label),
          ),
        ),
    err ? h('div.small', { style: { marginTop: '4px', color: '#FF9AA3' } }, err) : null,
  );
}

// ── After the meeting: Gemini's notes → actions ──────────────────────────

function notesBlock(st, ui) {
  const { h } = ui;
  const list = st.notes || [];
  if (!list.length) return null;
  return h('div', { style: { marginBottom: '8px' } }, list.map((n) => (n.status === 'waiting' ? waitingLine(n, ui) : notesCard(n, st, ui))));
}

function waitingLine(n, ui) {
  const { h } = ui;
  return h('div.row', { dataset: { notes: n.id }, style: { margin: '0 2px 6px' } },
    h('span.small.faint.grow.ellipsis', { title: n.error || '' },
      n.running ? `Gany lit les notes de « ${n.title} »…` : `Gany guette les notes Gemini de « ${n.title} »`,
      !n.running && n.nextAt ? ` · prochain coup d’œil à ${hhmm(n.nextAt)}` : '',
    ),
    n.running ? null : h('button.btn.sm.ghost', { onclick: () => { ui.sound.play('tick'); ui.action('checkNotes', { id: n.id }); } }, 'Chercher maintenant'),
  );
}

function notesCard(n, st, ui) {
  const { h } = ui;
  const open = n.actions.filter((a) => a.state !== 'ignored');
  const canTask = n.clickup && !!st.clickupList;
  return h('div.card', { dataset: { notes: n.id } },
    h('div.row',
      h('span.title.grow.ellipsis', { title: n.title }, `Après « ${n.title} »`),
      n.notes ? h('span.link.small', { title: n.notes.title, onclick: () => ui.action('openNotes', { id: n.id }) }, 'Notes de Gemini ↗') : null,
      h('button.btn.sm.ghost', { title: 'Ne plus afficher', onclick: () => ui.action('hideNotes', { id: n.id }) }, 'Masquer'),
    ),
    n.decisions.length ? [h('div.brief-h', 'Décisions'), h('ul.small', { style: { margin: 0, paddingLeft: '16px' } }, n.decisions.map((d) => h('li', d)))] : null,
    !n.read
      ? h('div.small.dim', { style: { marginTop: '4px' } }, n.canRead ? 'Gany n’a pas pu lire le document : ouvre-le.' : 'Connecte Google Drive sur claude.ai pour que Gany lise les notes ; en attendant, ouvre-les.')
      : !n.actions.length
        ? h('div.small.dim', { style: { marginTop: '4px' } }, 'Aucune action pour toi dans ces notes.')
        : null,
    open.length ? h('div.brief-h', 'Tes actions') : null,
    open.map((a) => actionRow(n, a, canTask, st, ui)),
    // The target list: chosen once, here or in Réglages → Agenda.
    n.clickup && open.some((a) => a.state === 'open') ? listLine(st, ui) : null,
  );
}

function actionRow(n, a, canTask, st, ui) {
  const { h } = ui;
  const key = `${n.id}/${a.id}`;
  const err = taskErrs.get(key) || a.error;
  const act = (name) => async () => {
    taskErrs.delete(key);
    ui.sound.play('tick');
    const r = await ui.action(name, { id: n.id, actionId: a.id });
    if (name === 'createTask' && !r?.ok) taskErrs.set(key, r?.error || 'Échec');
    ui.rerender();
  };
  return h('div', { style: { marginTop: '6px' } },
    h('div.row',
      h('span.grow', { style: { userSelect: 'text' } }, a.text),
      a.due ? h('span.pill.gold', { title: `Échéance écrite dans les notes : ${a.due}` }, a.due.split('-').reverse().slice(0, 2).join('/')) : null,
    ),
    h('div.btns', { style: { marginTop: '4px' } },
      a.state === 'created'
        ? [h('span.pill.ok', 'Tâche créée ✓'), a.taskUrl ? h('button.btn.sm.ghost', { onclick: () => ui.action('openTask', { id: n.id, actionId: a.id }) }, 'Ouvrir') : null]
        : a.state === 'creating'
          ? h('button.btn.sm', { disabled: true }, 'Création…')
          : [
              canTask
                ? h('button.btn.sm.primary', {
                    title: `Crée la tâche « ${a.text} » dans la liste ${st.clickupList.name || st.clickupList.id}${a.due ? `, échéance ${a.due}` : ''}, avec le lien vers les notes.`,
                    onclick: act('createTask'),
                  }, 'Créer la tâche ClickUp')
                : null,
              h('button.btn.sm' + (canTask ? '.ghost' : ''), { onclick: act('copyAction') }, 'Copier'),
              h('button.btn.sm.ghost', { onclick: act('ignoreAction') }, 'Ignorer'),
            ],
    ),
    err ? h('div.small', { style: { marginTop: '3px', color: '#FF9AA3' } }, err) : null,
  );
}

/** « → Liste ClickUp : X · Changer », or the picker (a read-only listing of the lists). */
function listLine(st, ui) {
  const { h } = ui;
  const load = async () => {
    picker = { loading: true };
    ui.rerender();
    const r = await ui.action('clickupLists');
    picker = r?.ok ? { lists: r.lists } : { error: r?.error || 'Lecture ratée' };
    ui.rerender();
  };
  if (picker?.lists) {
    return h('div.row', { style: { marginTop: '8px' } },
      h('select', {
        style: { flex: '1', minWidth: '0', height: '26px', background: 'var(--card-2)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: '8px', font: 'inherit', fontSize: '12px' },
        onchange: async (ev) => {
          const l = picker.lists.find((x) => x.id === ev.target.value);
          if (!l) return;
          await ui.action('setClickupList', { id: l.id, name: l.name });
          picker = null;
          ui.rerender();
        },
      },
        h('option', { value: '' }, 'Choisis la liste des actions de réunion…'),
        picker.lists.map((l) => h('option', { value: l.id, selected: st.clickupList?.id === l.id }, l.path ? `${l.path} / ${l.name}` : l.name)),
      ),
      h('button.btn.sm.ghost', { onclick: () => { picker = null; ui.rerender(); } }, 'Annuler'),
    );
  }
  return h('div.row.small', { style: { marginTop: '8px' } },
    h('span.faint.grow.ellipsis', st.clickupList ? `→ Liste ClickUp : ${st.clickupList.name || st.clickupList.id}` : picker?.error ? `Listes ClickUp : ${picker.error}` : 'Choisis une fois la liste ClickUp où créer ces tâches.'),
    h('button.btn.sm' + (st.clickupList ? '.ghost' : ''), { disabled: !!picker?.loading, onclick: load }, picker?.loading ? 'Gany lit tes listes…' : st.clickupList ? 'Changer' : 'Choisir la liste…'),
  );
}
