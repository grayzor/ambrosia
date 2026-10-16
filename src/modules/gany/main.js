// Gany's personality — the moments of the day, built from the other modules'
// states (agenda, mail, ClickUp, Google Chat, Drive, Claude). No tab of its own, no AI call: every
// line here comes from data Ambrosia already has.
//
//   * Morning: the first time you come by after 7:00, a short briefing.
//   * Lunch: when your lunch / focus slot starts and you are still at it.
//   * Evening: at the end of the day, the day's tally, then Gany yawns.
//   * Breaks: after a long stretch of continuous activity, a silent nudge.
//   * Order: when everything that waited is done, confetti (silent).
//   * Days of the year: holidays and fêtes (a hat, a phrase), pushed in the state.
//   * Focus: from the right-click menu, Gany makes himself tiny for a while and
//     only the urgent gets through (the « en appel » queue of the module host).
//   * Wardrobe: skins and accessories (src/renderer/wardrobe.js), Halloween by
//     default in October; Réglages → Gany → Apparence (settings.js « wardrobe »).
// The island side (src/renderer/island.js) handles the rest: idle animations,
// weekend outfit, petting, phrases, glances, confetti.

const MIN = 60000;
const logic = require('./logic');
const wardrobe = require('../../renderer/wardrobe');

const MORNING_LINES = [
  'Que les dieux te soient favorables aujourd’hui.',
  'L’ambroisie est servie, l’Olympe t’attend.',
  'Même Hermès n’a pas autant de messages à porter.',
  'Zeus a validé ta journée. Enfin, presque.',
  'Une coupe de nectar et c’est parti.',
  'Athéna te prête sa sagesse pour la journée.',
];

const EVENING_LINES = [
  'L’Olympe peut dormir tranquille.',
  'Même Atlas pose le ciel le soir.',
  'Repose-toi, demain Hélios se lève tôt.',
  'Belle journée de demi-dieu.',
];

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const hhmm = (ms) => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', ' h ');
const plural = (n, one, many = one + 's') => `${n} ${n > 1 ? many : one}`;

function minutesOf(spec, fallback) {
  const m = String(spec || '').match(/(\d{1,2})\s*[h:]\s*(\d{2})?/);
  return m ? Number(m[1]) * 60 + Number(m[2] || 0) : fallback;
}

module.exports = {
  id: 'gany',
  name: 'Gany',
  icon: '☺',
  logo: '../../assets/icon.png',
  color: '#E8B923',
  order: 90,
  settings: [
    // Skin and accessories: { skin: null | id, slots: {} }; null = the season decides.
    { key: 'look', label: 'Apparence de Gany', type: 'wardrobe', default: wardrobe.reset() },
    {
      key: 'soundTheme',
      label: 'Thème des sons',
      type: 'select',
      default: 'auto',
      options: wardrobe.SOUND_THEMES,
      help: 'Les mêmes sons aux mêmes moments, dans une autre ambiance. « Selon le skin » : la harpe hantée avec le skin Halloween (par défaut en octobre), la lyre sinon.',
    },
    {
      key: 'launch',
      label: 'Arrivée de Gany au démarrage',
      type: 'select',
      default: 'daily',
      options: [['daily', 'La grande le premier lancement du jour, une courte ensuite'], ['short', 'Toujours la courte'], ['off', 'Aucune']],
    },
    { key: 'launchSound', label: 'Un petit air de lyre à l’arrivée', type: 'boolean', default: true },
    { key: 'morning', label: 'Message du matin (au premier passage après 7 h)', type: 'boolean', default: true },
    { key: 'evening', label: 'Bilan de fin de journée', type: 'boolean', default: true },
    { key: 'eveningAt', label: 'Heure du bilan', type: 'text', default: '18:30' },
    { key: 'lunch', label: 'Rappel de pause déjeuner (créneau lunch / focus de l’agenda)', type: 'boolean', default: true },
    { key: 'idleAnimations', label: 'Petites animations quand il ne se passe rien', type: 'boolean', default: true },
    { key: 'weekendOutfit', label: 'Tenue du week-end (vendredi après-midi)', type: 'boolean', default: true },
    { key: 'occasions', label: 'Fêtes et jours fériés (bonnet de Noël, poisson d’avril, cocarde du 14 Juillet…)', type: 'boolean', default: true },
    { key: 'phrases', label: 'Petites phrases dans l’îlot', type: 'boolean', default: true },
    { key: 'followWindows', label: 'Gany jette un œil à la fenêtre que tu ouvres', type: 'boolean', default: true },
    { key: 'energy', label: 'Gany fatigué les jours chargés, guilleret les jours calmes', type: 'boolean', default: true },
    { key: 'breaks', label: 'Rappel de pause (s’étirer, boire) après une longue activité continue, sans son', type: 'boolean', default: true },
    { key: 'breakEvery', label: 'Rappel de pause au bout de (minutes d’activité continue)', type: 'number', default: 90 },
    { key: 'focus', label: 'Mode concentration dans le menu de Gany (clic droit) : seul l’urgent passe', type: 'boolean', default: true },
    { key: 'celebrate', label: 'Confettis quand tout est traité (« L’Olympe est en ordre »), sans son', type: 'boolean', default: true },
    { key: 'impatience', label: 'Gany s’impatiente quand une approbation de Claude Code attend (sans son)', type: 'boolean', default: true },
  ],

  init(ctx) {
    const data = ctx.data.load({ morning: '', evening: '', lunch: '' });
    const today = () => new Date().toDateString();
    const save = () => ctx.data.save(data);
    const st = () => ctx.settings();
    const peer = (id) => ctx.peers()[id] || {};

    function morning() {
      const now = new Date();
      if (!st().morning || data.morning === today() || now.getHours() < 7 || now.getHours() >= 12) return;
      data.morning = today();
      save();
      const ag = peer('agenda');
      const name = ag.selfName ? ` ${ag.selfName}` : '';
      const bits = [];
      const t = ag.today;
      if (t?.count) {
        const first = t.firstStart && t.firstStart > Date.now() ? `, la première à ${hhmm(t.firstStart)}` : '';
        bits.push(`${plural(t.count, 'réunion')} aujourd’hui${first}`);
      } else if (ag.status === 'ok') bits.push('aucune réunion aujourd’hui');
      const mail = peer('mail').unread || 0;
      const cu = peer('clickup').unread || 0;
      if (mail) bits.push(`${plural(mail, 'mail important', 'mails importants')}`);
      if (cu) bits.push(`${plural(cu, 'interaction ClickUp', 'interactions ClickUp')}`);
      const gc = peer('gchat').unread || 0;
      if (gc) bits.push(plural(gc, 'message Chat', 'messages Chat'));
      const dr = peer('drive').unread || 0;
      if (dr) bits.push(plural(dr, 'demande dans tes documents', 'demandes dans tes documents'));
      ctx.alert({
        key: 'morning',
        title: `Bonjour${name} ! ${(st().occasions !== false && logic.occasion()?.phrase) || pick(MORNING_LINES)}`,
        text: bits.length ? bits.join(' · ') : 'Rien d’urgent pour l’instant.',
        mood: 'greet',
        sound: 'greet',
        priority: 45,
        ttl: 14,
      });
    }

    function evening() {
      const now = new Date();
      if (!st().evening || data.evening === today() || ctx.locked?.()) return;
      const at = minutesOf(st().eveningAt, 18 * 60 + 30);
      if (now.getHours() * 60 + now.getMinutes() < at) return;
      // Only to someone who is still there.
      if (ctx.activity().idleMs > 10 * MIN) return;
      data.evening = today();
      save();
      const t = peer('agenda').today || {};
      const claude = peer('claude').today || {};
      const bits = [];
      if (t.joined) bits.push(`${plural(t.joined, 'réunion tenue', 'réunions tenues')}${t.onTime === t.joined ? ' à l’heure' : ''}`);
      if (claude.finished) bits.push(`${plural(claude.finished, 'tâche Claude terminée', 'tâches Claude terminées')}`);
      const treated = ['mail', 'clickup', 'gchat', 'drive'].reduce((n, id) => n + (peer(id).doneToday || 0), 0);
      if (treated) bits.push(`${plural(treated, 'sujet traité', 'sujets traités')}`);
      bits.push(t.missed ? `${plural(t.missed, 'réunion ratée', 'réunions ratées')} (on fera mieux demain)` : '0 réunion ratée');
      ctx.alert({
        key: 'evening',
        title: `Belle journée ! ${pick(EVENING_LINES)}`,
        text: bits.join(' · '),
        mood: 'yawn',
        sound: 'love',
        priority: 45,
        ttl: 16,
      });
      setTimeout(() => ctx.react('yawn', 3500), 16000);
    }

    function lunch() {
      if (!st().lunch || data.lunch === today() || ctx.locked?.()) return;
      const l = peer('agenda').lunch;
      if (!l) return;
      const now = Date.now();
      if (now < l.start || now > l.start + 20 * MIN) return;
      // You are still clicking away: time to put the keyboard down.
      if (ctx.activity().idleMs > 2 * MIN) return;
      data.lunch = today();
      save();
      ctx.alert({
        key: 'lunch',
        title: 'L’ambroisie est servie !',
        text: `${l.title || 'Pause déjeuner'} jusqu’à ${hhmm(l.end)} — décroche un peu, les dieux aussi mangent.`,
        mood: 'lunch',
        sound: 'love',
        priority: 50,
        ttl: 20,
      });
    }

    // Breaks: continuous activity is mouse activity without a 5-minute rest.
    let breakState = null;
    function breaks() {
      if (!st().breaks) return;
      const now = new Date();
      const peers = ctx.peers();
      const urgent = Object.values(peers).some((p) => (p?.mood?.priority ?? 0) >= 60);
      const blocked = urgent || ctx.paused?.() || ctx.inCall?.() || now.getHours() < 8 || now.getHours() >= 20;
      const r = logic.breakTick(breakState, { now: now.getTime(), idleMs: ctx.activity().idleMs, everyMin: Math.max(20, Number(st().breakEvery) || 90), blocked });
      breakState = r.state;
      if (r.nudge) ctx.alert(logic.breakAlert(r.nudge));
    }

    // Days of the year: the island dresses Gany from state.occasion.
    let occasionDay = '';
    function dayOfYear() {
      if (occasionDay === today()) return;
      occasionDay = today();
      ctx.setState?.({ occasion: logic.occasion() });
    }
    dayOfYear();

    // Order: the load (unread everywhere + Claude Code) falls to zero after a busy stretch.
    let partyState = null;
    function celebrate() {
      if (st().celebrate === false) return;
      const r = logic.celebrateTick(partyState, {
        now: Date.now(),
        load: logic.workload(ctx.peers()),
        active: ctx.activity().idleMs < 5 * MIN,
        allowed: !ctx.paused?.() && !ctx.inCall?.(),
      });
      partyState = r.state;
      if (r.party) ctx.alert(logic.celebrateAlert(r.party));
    }
    const partyTimer = setInterval(celebrate, 15000);

    // Focus: Gany makes himself tiny; what can wait is held by the module host
    // (ctx.setInCall, src/main/call-mode.js) and comes back as one recap.
    let focusTimer = null;
    function focusOn(until, by = null) {
      clearTimeout(focusTimer);
      data.focusUntil = until;
      data.focusBy = by; // 'dnd': started by Windows « Ne pas déranger », which ends it too
      save();
      const dnd = by === 'dnd';
      ctx.setInCall({ title: dnd ? 'Ne pas déranger' : 'Concentration', endsAt: until, recapLead: dnd ? 'Pendant ton « Ne pas déranger »' : 'Pendant ta concentration', always: true, kind: 'focus' });
      ctx.setState({ focus: { until, dnd } });
      focusTimer = setTimeout(() => focusOff(true), Math.max(0, until - Date.now()));
    }
    function focusOff(timeUp = false) {
      clearTimeout(focusTimer);
      if (!data.focusUntil) return;
      data.focusUntil = 0;
      data.focusBy = null;
      save();
      ctx.setInCall(null);
      ctx.setState({ focus: null });
      if (timeUp) ctx.react('wink', 2400);
    }
    ctx.onAction('focus', ({ minutes } = {}) => {
      if (st().focus === false) return;
      focusOn(Date.now() + Math.max(5, Math.min(480, Number(minutes) || 50)) * MIN);
    });
    ctx.onAction('unfocus', () => focusOff());
    // A focus that outlives a restart goes on.
    if (data.focusUntil > Date.now()) focusOn(data.focusUntil, data.focusBy || null);
    else if (data.focusUntil) focusOff();

    // Windows « Ne pas déranger » (main.js reads it; Réglages → Discrétion): the focus
    // follows it, 12 h at most, and never ends a focus started from the menu.
    let lastDnd = null;
    function followDnd(sys) {
      if (st().focus === false || sys?.dnd == null) return;
      const r = logic.dndFocus({ dnd: sys.dnd, prevDnd: lastDnd, focusActive: data.focusUntil > Date.now(), focusBy: data.focusBy });
      lastDnd = sys.dnd;
      if (r === 'on') focusOn(Date.now() + 12 * 60 * MIN, 'dnd');
      else if (r === 'off') focusOff();
    }
    ctx.onSystem?.(followDnd);
    followDnd(ctx.system?.());

    // The island tells us when you come by (first hover of a while).
    ctx.onAction('presence', () => morning());
    const timer = setInterval(() => {
      evening();
      lunch();
      breaks();
      dayOfYear();
    }, MIN);
    this._stop = () => {
      clearInterval(timer);
      clearInterval(partyTimer);
      clearTimeout(focusTimer);
    };
  },

  dispose() {
    this._stop?.();
  },
};
