// Island panel for Claude Code sessions: pending approvals / questions first,
// then every live session with its current step.

import { launchOpen, launchForm, openLaunch } from '../../renderer/launch-form.js';

const NEW = 'claude:new';

const STATES = {
  idle: { label: 'Au repos', color: '#6E687A' },
  thinking: { label: 'Réfléchit…', color: '#6CB4FF', pulse: true },
  working: { label: 'Travaille', color: '#E8B923', pulse: true },
  approval: { label: 'Attend ton accord', color: '#F2A65A', pulse: true },
  question: { label: 'Te pose une question', color: '#F2A65A', pulse: true },
  waiting: { label: 'Attend ta réponse', color: '#F8DC6C' },
  finished: { label: 'Terminé', color: '#3FB950' },
  error: { label: 'Erreur', color: '#F0616D' },
  ratelimit: { label: 'Limite atteinte', color: '#F0616D' },
  ended: { label: 'Fermée', color: '#3A3542' },
};

const open = new Set(); // sessions whose details are unfolded
const picks = new Map(); // rid → [[labels], …] for question cards
const others = new Map(); // rid → free text per question
const notes = new Map(); // rid → instruction typed under « Refuser » / plan remarks
let focusedAt = 0;
let showStowed = false; // the « N rangées » link unfolded
const drafts = new Map(); // session id → instruction being typed (« Glisser une consigne »)
const cursors = new Map(); // rid → the question the keyboard answers (1–9, Entrée)
let keyActions = null; // { rid, a, r, t, 1…9, enter }: what the keys do on the request shown

/** Top-row digits work on AZERTY without Shift (« & é " ' ( - è _ ç »): the physical key decides. */
const AZERTY_DIGITS = '&é"\'(-è_ç';
function keyOf(e) {
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code || '');
  if (m) return m[1];
  if (/^[1-9]$/.test(e.key)) return e.key;
  const i = AZERTY_DIGITS.indexOf(e.key);
  if (i >= 0 && e.key) return String(i + 1);
  if (e.key === 'Enter') return 'enter';
  return String(e.key || '').length === 1 ? e.key.toLowerCase() : '';
}

const LEVEL_COLORS = { ok: '#3FB950', mid: '#E8B923', warn: '#F2A65A', bad: '#F0616D' };

/** The plan gauge that matters most for the notch, when it is above the threshold. */
function hotGauge(q) {
  if (!q?.gauges?.length || !(q.notchAt > 0)) return null;
  const top = q.gauges.filter((g) => !g.reset).sort((a, b) => b.pct - a.pct)[0];
  return top && top.pct >= q.notchAt ? top : null;
}

export default {
  summary(st) {
    const live = (st.sessions || []).filter((s) => s.state !== 'ended' && !s.stowed);
    const pending = st.pending || [];
    const busy = live.filter((s) => ['working', 'thinking'].includes(s.state));
    const hot = hotGauge(st.quota);
    if (!live.length && !pending.length && !hot) return null;
    const quotaText = hot ? `forfait ${hot.label.toLowerCase()} à ${hot.pct} %` : '';
    // x/y of the busiest session's to-do list (sessions come most recent first).
    const prog = (busy.find((s) => s.progress?.total) || live.find((s) => s.progress?.total && s.progress.done < s.progress.total))?.progress;
    const progText = prog ? `${prog.done}/${prog.total}` : '';
    return {
      dots: live.slice(0, 5).map((s) => ({ color: STATES[s.state]?.color, pulse: STATES[s.state]?.pulse })),
      badge: pending.length
        ? { text: pending.length > 1 ? `${pending.length} !` : '!', color: '#F2A65A' }
        : hot
          ? { text: `${hot.key === 'five_hour' ? '5h' : 'sem.'} ${hot.pct}%`, color: LEVEL_COLORS[hot.level] || '#F2A65A' }
          : prog
            ? { text: progText, color: '#E8B923' }
            : null,
      count: pending.length || null,
      text: [
        pending.length
          ? `${pending.length} demande${pending.length > 1 ? 's' : ''} en attente`
          : live.length
            ? `${live.length} session${live.length > 1 ? 's' : ''} Claude${busy.length ? ` · ${busy.length} en cours` : ''}`
            : '',
        progText ? `tâches ${progText}` : '',
        quotaText,
      ].filter(Boolean).join(' · '),
      // The live feed of edits: island.js shows it a few seconds in the notch, no sound, no peek.
      ticker: st.ticker?.parts?.length
        ? { key: `claude:${st.ticker.sid}`, at: st.ticker.at, seq: st.ticker.seq, ttl: st.ticker.ttl, foldedOnly: st.ticker.foldedOnly, lead: st.ticker.project, parts: st.ticker.parts, more: st.ticker.more, action: { name: 'open', payload: { id: st.ticker.sid } }, title: 'Voir la session' }
        : null,
    };
  },

  /** island.js: while a request waits, the island takes the keyboard when the pointer is on it. */
  wantsKeys(st, ui) {
    return ui.settings().keys !== false && !!st.pending?.length;
  },

  /** A key pressed in the open island (not in a text field): A / R / T, 1–9, Entrée. True when handled. */
  onKey(e, st, ui) {
    const p = st.pending?.[0];
    if (ui.settings().keys === false || diff || !p || keyActions?.rid !== p.rid) return false;
    const fn = keyActions[keyOf(e)];
    if (typeof fn !== 'function') return false;
    fn();
    return true;
  },

  render(root, st, ui) {
    const { h } = ui;
    ensureStyle();
    keyActions = null; // set again by the request card drawn below
    // « Voir » on an alert: that session comes unfolded, once.
    if (st.focusSession && st.focusSession.at > focusedAt) {
      focusedAt = st.focusSession.at;
      if (st.focusSession.id) open.add(st.focusSession.id);
      diff = null;
    }
    // A file's diff, opened from a card: it takes the whole panel until « ← Sessions ».
    if (diff) {
      root.append(diffPanel(ui));
      if (diff.top) {
        diff.top = false;
        requestAnimationFrame(() => (root.scrollTop = 0));
      }
      return;
    }
    const pending = st.pending || [];
    if (pending.length) {
      const p = pending[0];
      root.append(p.kind === 'approval' ? approvalCard(p, ui) : questionCard(p, ui));
      if (pending.length > 1) root.append(h('div.faint.small', { style: { margin: '6px 4px 0' } }, `+ ${pending.length - 1} autre(s) demande(s) en attente`));
      root.append(h('div', { style: { height: '10px' } }));
    }
    // Plan gauges and « Nouvelle session » (src/renderer/launch-form.js) share the top row.
    const gauges = quotaStrip(st.quota, st, ui);
    if (gauges.length || !launchOpen(NEW)) {
      root.append(h('div.row.cl-top', gauges, h('span.grow'),
        launchOpen(NEW) ? null : h('button.btn.sm', { title: 'Lancer Claude Code dans un de tes dépôts', onclick: () => openLaunch(ui, NEW) }, '+ Nouvelle session')));
    }
    if (launchOpen(NEW)) root.append(launchForm(ui, NEW), h('div', { style: { height: '10px' } }));
    if (st.harvest?.visible && st.harvest.week) root.append(harvestCard(st.harvest.week, ui));

    const all = (st.sessions || []).filter((s) => s.state !== 'ended');
    const sessions = all.filter((s) => !s.stowed);
    const stowed = all.filter((s) => s.stowed);
    if (!stowed.length) showStowed = false;
    if (!sessions.length && !pending.length && stowed.length) {
      root.append(h('div.card.empty', h('div', 'Toutes les sessions sont rangées.'), h('div.small', 'Elles reviennent d’elles-mêmes dès que Claude reprend.')));
    } else if (!sessions.length && !pending.length) {
      root.append(
        h('div.card.empty',
          h('div', 'Aucune session Claude Code en cours.'),
          st.hooksInstalled === false
            ? h('div', { style: { marginTop: '8px' } },
                h('div.small.dim', 'Les hooks ne sont pas installés : Gany ne voit rien passer.'),
                h('button.btn.primary.sm', { style: { marginTop: '8px' }, onclick: () => ui.core('openSettings', 'claude') }, 'Installer les hooks…'))
            : h('div.small', 'Lance `claude` dans un terminal ou une session dans l’app : elle apparaîtra ici.'),
        ),
      );
    } else {
      const list = h('div.list');
      for (const s of sessions) list.append(sessionCard(s, ui));
      root.append(list);
    }
    // « Ranger »: a faint link to see the sessions put away (they come back on their own when Claude moves).
    if (stowed.length) {
      root.append(h('div.row', { style: { justifyContent: 'center', marginTop: '8px' } },
        h('a.cl-stowed-link', { href: '#', onclick: (e) => { e.preventDefault(); showStowed = !showStowed; ui.rerender(); } },
          showStowed ? 'Masquer les sessions rangées' : `${stowed.length} session${stowed.length > 1 ? 's' : ''} rangée${stowed.length > 1 ? 's' : ''}`)));
      if (showStowed) {
        const list = h('div.list', { style: { marginTop: '6px' } });
        for (const s of stowed) list.append(sessionCard(s, ui));
        root.append(list);
      }
    }
    if (!st.harvest?.visible) {
      root.append(h('div.row', { style: { justifyContent: 'center', marginTop: '10px' } },
        h('button.btn.ghost.sm', { title: 'Le récap de la semaine des agents', onclick: () => ui.action('showHarvest') }, '🍇 Les vendanges de la semaine')));
    }
  },
};

// ── Les vendanges de la semaine ─────────────────────────────────────────

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const fromKey = (k) => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const num = (n) => Number(n || 0).toLocaleString('fr-FR');
function work(ms) {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
}
function weekRange(w) {
  const a = fromKey(w.from);
  const b = fromKey(w.to);
  return a.getMonth() === b.getMonth()
    ? `du lundi ${a.getDate()} au dimanche ${b.getDate()} ${MONTHS[b.getMonth()]}`
    : `du lundi ${a.getDate()} ${MONTHS[a.getMonth()]} au dimanche ${b.getDate()} ${MONTHS[b.getMonth()]}`;
}

function harvestCard(w, ui) {
  const { h } = ui;
  const W = 540;
  const H = 330;
  const canvas = h('canvas.cl-harvest', { width: W * 2, height: H * 2, style: { width: '100%', aspectRatio: `${W} / ${H}` } });
  drawHarvest(canvas, w, W, H);
  const copy = h('button.btn.sm.primary', {
    onclick: async () => {
      const ok = await ui.action('copyHarvest', { dataUrl: canvas.toDataURL('image/png') }).catch(() => false);
      copy.textContent = ok ? 'Copiée !' : 'Échec de la copie';
      if (ok) ui.flash('love', 1400);
      setTimeout(() => (copy.textContent = 'Copier l’image'), 1800);
    },
  }, 'Copier l’image');
  return h('div.card', { style: { marginBottom: '10px' } },
    canvas,
    h('div.btns.end', { style: { marginTop: '8px' } },
      h('span.faint.small.grow', 'Une image à coller où tu veux (chat, mail, notes).'),
      h('button.btn.sm.ghost', { onclick: () => ui.action('hideHarvest') }, 'Fermer'),
      copy,
    ),
  );
}

/** An amphora outline, base at (x, y), `w` wide and `ht` tall. */
function amphora(c, x, y, w, ht) {
  const cx = x + w / 2;
  const top = y - ht;
  c.beginPath();
  c.moveTo(cx - w * 0.16, top); // lip
  c.lineTo(cx + w * 0.16, top);
  c.lineTo(cx + w * 0.12, top + ht * 0.14); // neck
  c.bezierCurveTo(cx + w * 0.5, top + ht * 0.22, cx + w * 0.52, top + ht * 0.62, cx + w * 0.14, y - ht * 0.08); // shoulder → body
  c.lineTo(cx + w * 0.1, y); // foot
  c.lineTo(cx - w * 0.1, y);
  c.lineTo(cx - w * 0.14, y - ht * 0.08);
  c.bezierCurveTo(cx - w * 0.52, top + ht * 0.62, cx - w * 0.5, top + ht * 0.22, cx - w * 0.12, top + ht * 0.14);
  c.closePath();
}

function drawHarvest(canvas, w, W, H) {
  const c = canvas.getContext('2d');
  c.setTransform(2, 0, 0, 2, 0, 0);
  const font = (size, weight = 400) => `${weight} ${size}px "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif`;
  // Background: dark wine, a gold rim.
  const bg = c.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#1E1020');
  bg.addColorStop(1, '#0E0A12');
  c.fillStyle = bg;
  c.beginPath();
  c.roundRect(0.5, 0.5, W - 1, H - 1, 18);
  c.fill();
  c.strokeStyle = 'rgba(232,185,35,.35)';
  c.lineWidth = 1;
  c.stroke();
  // A meander along the top, very discreet.
  c.strokeStyle = 'rgba(232,185,35,.18)';
  c.beginPath();
  for (let x = 18; x < W - 30; x += 16) {
    c.moveTo(x, 14);
    c.lineTo(x, 8);
    c.lineTo(x + 10, 8);
    c.lineTo(x + 10, 12);
    c.lineTo(x + 5, 12);
  }
  c.stroke();
  // Grapes
  c.fillStyle = '#8E4A9E';
  for (const [gx, gy] of [[0, 0], [8, 0], [16, 0], [4, 7], [12, 7], [8, 14]]) {
    c.beginPath();
    c.arc(W - 46 + gx, 30 + gy, 4.2, 0, Math.PI * 2);
    c.fill();
  }
  c.fillStyle = '#5E9E4A';
  c.beginPath();
  c.ellipse(W - 30, 24, 7, 3.5, -0.5, 0, Math.PI * 2);
  c.fill();
  // Title
  const gold = c.createLinearGradient(20, 0, 320, 0);
  gold.addColorStop(0, '#F8DC6C');
  gold.addColorStop(1, '#F2A65A');
  c.fillStyle = gold;
  c.font = font(21, 700);
  c.fillText('Les vendanges de la semaine', 22, 44);
  c.fillStyle = '#A39CB0';
  c.font = font(12);
  c.fillText(`${weekRange(w)} · Gany a mis la récolte en amphores`, 22, 64);

  // Seven amphorae, filled with the agents' working time of each day.
  const max = Math.max(...w.days.map((d) => d.workMs), 1);
  const ax = 22;
  const base = 200;
  const aw = 38;
  const ah = 92;
  w.days.forEach((d, i) => {
    const x = ax + i * (aw + 6);
    const level = d.workMs / max;
    amphora(c, x, base, aw, ah);
    c.fillStyle = 'rgba(255,255,255,.04)';
    c.fill();
    if (level > 0) {
      c.save();
      amphora(c, x, base, aw, ah);
      c.clip();
      const fill = c.createLinearGradient(0, base - ah, 0, base);
      fill.addColorStop(0, '#F8DC6C');
      fill.addColorStop(1, '#B0405F');
      c.fillStyle = fill;
      c.fillRect(x, base - ah * Math.max(0.06, level * 0.92), aw, ah);
      c.restore();
    }
    amphora(c, x, base, aw, ah);
    c.strokeStyle = d.key === w.busiest ? '#F8DC6C' : 'rgba(232,185,35,.5)';
    c.lineWidth = d.key === w.busiest ? 1.6 : 1;
    c.stroke();
    // handles
    c.beginPath();
    c.arc(x + aw * 0.22, base - ah * 0.76, aw * 0.14, Math.PI * 0.5, Math.PI * 1.5);
    c.arc(x + aw * 0.78, base - ah * 0.76, aw * 0.14, Math.PI * 1.5, Math.PI * 0.5);
    c.stroke();
    c.textAlign = 'center';
    c.fillStyle = d.workMs ? '#F4F0E8' : '#6E687A';
    c.font = font(11, 700);
    c.fillText(d.letter, x + aw / 2, base + 16);
    c.fillStyle = '#A39CB0';
    c.font = font(9.5);
    c.fillText(d.workMs ? work(d.workMs).replace(' min', '′').replace(' h ', 'h') : '·', x + aw / 2, base + 29);
    c.textAlign = 'left';
  });

  // Big numbers
  const stats = [
    [work(w.workMs), 'de travail des agents'],
    [num(w.sessions), w.sessions > 1 ? 'sessions' : 'session'],
    [`+${num(w.add)}  −${num(w.del)}`, 'lignes modifiées'],
    [num(w.repos.length), w.repos.length > 1 ? 'dépôts' : 'dépôt'],
  ];
  stats.forEach(([big, small], i) => {
    const y = 104 + i * 30;
    c.fillStyle = i === 2 ? '#7EE08F' : '#F4F0E8';
    c.font = font(17, 700);
    c.fillText(big, 350, y);
    c.fillStyle = '#A39CB0';
    c.font = font(10.5);
    c.fillText(small, 350, y + 12);
  });

  // Highlights
  const lines = [];
  if (w.longest?.sec) {
    const day = DAYS[fromKey(w.longest.day).getDay()];
    lines.push(`Plus longue tâche : ${work(w.longest.sec * 1000)} sur ${w.longest.project} (${day})${w.longest.prompt ? ` — « ${w.longest.prompt.slice(0, 48)}${w.longest.prompt.length > 48 ? '…' : ''} »` : ''}`);
  }
  if (w.peak5 || w.peak7) lines.push(`Pic du forfait : ${w.peak5 ? `5 h à ${w.peak5} %` : ''}${w.peak5 && w.peak7 ? ' · ' : ''}${w.peak7 ? `semaine à ${w.peak7} %` : ''}`);
  if (w.repos.length) lines.push(`Dépôts : ${w.repos.slice(0, 5).map((r) => `${r.name} (${r.turns})`).join(' · ')}`);
  if (w.topFiles?.length) {
    const name = (f) => String(f).replace(/\\/g, '/').split('/').pop();
    lines.push(`Fichiers phares : ${w.topFiles.map((f) => `${name(f.file)} (${f.repo}) +${num(f.add)} −${num(f.del)}`).join(' · ')}`);
  }
  if (!w.turns) lines.push('Pas encore de récolte cette semaine : les amphores attendent.');
  c.font = font(11.5);
  const step = lines.length > 3 ? 17 : 19;
  lines.slice(0, 4).forEach((l, i) => {
    c.fillStyle = i === 0 ? '#F4F0E8' : '#A39CB0';
    c.fillText(fit(c, l, W - 44), 22, (lines.length > 3 ? 248 : 252) + i * step);
  });
  c.fillStyle = '#6E687A';
  c.font = font(10);
  c.textAlign = 'right';
  c.fillText('Ambrosia · Gany, échanson des dieux', W - 18, H - 14);
  c.textAlign = 'left';
}

/** Clips a line to the width, with an ellipsis. */
function fit(c, text, width) {
  if (c.measureText(text).width <= width) return text;
  let t = text;
  while (t.length > 4 && c.measureText(t + '…').width > width) t = t.slice(0, -1);
  return t + '…';
}

const BUSY = ['working', 'thinking', 'approval', 'question'];
const STOWABLE = ['idle', 'finished', 'waiting', 'error', 'ratelimit', 'ended']; // = logic.STOWABLE
const CTX_COLORS = { low: 'var(--faint)', mid: 'var(--dim)', high: '#E8B923', warn: '#F2A65A', bad: '#F0616D' };
const ctxLevel = (pct) => (pct >= 90 ? 'bad' : pct >= 80 ? 'warn' : pct >= 70 ? 'high' : pct >= 50 ? 'mid' : 'low'); // = logic.contextLevel
const EFFORT_FR = { low: 'bas', medium: 'moyen', high: 'élevé', xhigh: 'très élevé', max: 'max' };

/** « ctx 72 % »: how full the context is; past 80 %, auto-compact is near (a visual hint, no sound). */
function contextPill(h, pct) {
  if (!Number.isFinite(pct)) return null;
  const level = ctxLevel(pct);
  const near = level === 'warn' || level === 'bad';
  return h('span.cl-ctx.' + level, {
    style: { '--c': CTX_COLORS[level] },
    title: near
      ? `Contexte rempli à ${pct} % : la compaction automatique approche. /compact (ou /clear) quand ça t’arrange.`
      : `Contexte rempli à ${pct} %`,
  }, near ? '⚠ ' : '', `ctx ${pct} %`);
}

/** Running subagents: one line folded (« 2 sous-agents · Explore : Lit · x.js »), one per agent unfolded. */
function agentsBlock(h, s, unfolded) {
  const list = s.agents || [];
  if (!list.length) return null;
  const head = h('span.cl-agents-n', `⑂ ${list.length} sous-agent${list.length > 1 ? 's' : ''}`);
  if (!unfolded) {
    return h('div.small.faint.ellipsis.cl-agents', head, list.slice(0, 3).map((a) => ['  ', h('span.cl-agent-type', a.type), a.tool ? ` ${a.tool}` : '']));
  }
  return h('div.cl-agents', h('div.small.faint', head),
    list.map((a) => h('div.small.faint.ellipsis.mono', { style: { paddingLeft: '14px' } }, h('span.cl-agent-type', a.type), a.tool ? ` · ${a.tool}` : '')));
}

function sessionCard(s, ui) {
  const { h, ago, clip, markdown } = ui;
  const meta = STATES[s.state] || STATES.idle;
  const unfolded = open.has(s.id);
  const lastStep = s.steps[s.steps.length - 1];
  const busy = BUSY.includes(s.state);
  // Between turns, the card shows what the last one did.
  const showTurn = !!s.lastTurn && !busy;
  const silent = s.stalledSince && !s.stowed;
  const resumeKey = `claude:resume:${s.id}`;
  const title = s.name || s.title;
  const model = [s.model, s.effort ? EFFORT_FR[s.effort] || s.effort : ''].filter(Boolean).join(' · ');
  const elapsed = busy && s.turnStartedAt ? Math.round((Date.now() - s.turnStartedAt) / 1000) : 0;
  const card = h('div.card.cl-session' + (['approval', 'question'].includes(s.state) ? '.hot' : '') + (s.stowed ? '.cl-stowed' : ''),
    h('div.row', { style: { cursor: 'pointer' }, onclick: () => { unfolded ? open.delete(s.id) : open.add(s.id); ui.open(); rerender(ui); } },
      h('span.state-dot' + (meta.pulse && !silent ? '.pulse' : ''), { style: { '--c': meta.color } }),
      h('span.title.cl-name', { title: s.cwd || s.project }, s.project),
      title ? h('span.dim.small.ellipsis.cl-label', { title }, title) : null,
      h('span.grow'),
      contextPill(h, s.contextPct),
      model ? h('span.faint.small.cl-model', { title: `Modèle : ${s.model || '?'}${s.effort ? ` · effort de raisonnement : ${EFFORT_FR[s.effort] || s.effort}` : ''}` }, model) : null,
      h('span.pill', meta.label),
      elapsed >= 30
        ? h('span.faint.small.cl-time', { title: `Tour en cours depuis ${dur(elapsed)}` }, dur(elapsed))
        : h('span.faint.small.cl-time', ago(s.updatedAt)),
      STOWABLE.includes(s.state) && !s.stowed
        ? btn(h, '.ghost.sm.cl-stow', { title: 'Retirer de la liste — elle revient d’elle-même si Claude reprend', onclick: (e) => { e.stopPropagation(); open.delete(s.id); ui.action('stow', { id: s.id }); } }, 'Ranger')
        : null,
      s.stowed ? btn(h, '.ghost.sm', { title: 'Remettre dans la liste', onclick: (e) => { e.stopPropagation(); ui.action('unstow', { id: s.id }); } }, 'Ressortir') : null,
    ),
    s.prompt ? h('div.dim.small.ellipsis', { style: { marginTop: '4px' } }, '› ', s.prompt) : null,
    silent
      ? h('div.small.cl-silent', { title: 'Aucun événement de Claude Code depuis : il réfléchit longuement, attend un outil… ou s’est bloqué. Jette un œil au terminal.' }, '⏳ Silencieux depuis ', dur(Math.round((Date.now() - s.stalledSince) / 1000)))
      : null,
    progressBar(s.progress, h),
    lastStep && !unfolded && !showTurn ? h('div.faint.small.ellipsis.mono', { style: { marginTop: '2px' } }, lastStep.label) : null,
    busy ? agentsBlock(h, s, unfolded) : null,
    !showTurn && s.live?.fileCount ? liveBlock(s, ui, unfolded) : null,
    showTurn ? turnBlock(s, ui, unfolded) : null,
    unfolded ? null : nudgeBlock(s, ui, false),
  );
  if (unfolded) {
    if (s.progress?.items?.length) {
      card.append(h('div.cl-todos', s.progress.items.map((i) => h('div.small.ellipsis.cl-todo.' + i.status, h('span.cl-tick', i.status === 'completed' ? '✓' : i.status === 'in_progress' ? '›' : '○'), i.text))));
    }
    if (s.steps.length) {
      card.append(h('div', { style: { marginTop: '6px' } }, s.steps.slice(-8).map((st) => h('div.faint.small.ellipsis.mono', st.label))));
    }
    if (s.lastMessage) card.append(h('div.sep'), h('div.small', markdown(clip(s.lastMessage, 1500))));
    card.append(nudgeBlock(s, ui, true) || '');
    // A finished session whose terminal is gone: « Continuer » comes first (claude --resume).
    // A Claude Desktop session goes on in the app (the main button reopens it there), never in a terminal.
    const resumable = !busy && s.state !== 'ended' && /^[0-9a-f-]{36}$/i.test(s.id) && !/desktop/i.test(`${s.entrypoint} ${s.term}`);
    const resumeFirst = resumable && s.alive === false;
    const resume = (fork) => () => {
      ui.sound.play('tick');
      openLaunch(ui, resumeKey, { resume: { sessionId: s.id, cwd: s.cwd, project: s.project, title, fork } });
    };
    card.append(
      h('div.btns', { style: { marginTop: '8px' } },
        resumeFirst ? h('button.btn.sm.primary', { title: 'Reprendre cette conversation dans un nouveau terminal (claude --resume)', onclick: resume(false) }, 'Continuer') : null,
        h('button.btn.sm' + (resumeFirst ? '' : '.primary'), {
          title: 'Mettre au premier plan la fenêtre de cette session',
          onclick: async (e) => {
            e.target.disabled = true;
            const r = await ui.action('gotoTerminal', { id: s.id }).catch(() => ({ ok: false }));
            e.target.disabled = false;
            if (r?.ok) ui.close();
            else ui.flash('annoyed', 1200);
          },
        }, hostLabel(s)),
        resumable && !resumeFirst ? h('button.btn.sm', { title: 'Reprendre cette conversation dans un nouveau terminal (claude --resume)', onclick: resume(false) }, 'Continuer') : null,
        /^[0-9a-f-]{36}$/i.test(s.id) && s.state !== 'ended'
          ? h('button.btn.sm', { title: 'Une copie de la conversation dans un nouveau terminal (--fork-session) : poser une question sans déranger la session', onclick: resume(true) }, 'Question à côté')
          : null,
        h('button.btn.sm', { onclick: () => ui.action('openFolder', { id: s.id }) }, 'Dossier'),
        /vscode/i.test(`${s.entrypoint} ${s.term}`) ? null : h('button.btn.sm', { onclick: () => ui.action('openCode', { id: s.id }) }, 'VS Code'),
        h('button.btn.sm', { onclick: async () => { await ui.action('copyResume', { id: s.id }); ui.flash('love', 1200); } }, 'Copier la reprise'),
        h('span.grow'),
        h('button.btn.sm.ghost', { onclick: () => ui.action('forget', { id: s.id }) }, 'Oublier'),
      ),
    );
  }
  // « Continuer » / « Question à côté »: the shared launch form, prefilled for claude --resume.
  if (launchOpen(resumeKey)) card.append(launchForm(ui, resumeKey));
  return card;
}

function approvalCard(p, ui) {
  const { h, clip, markdown } = ui;
  const plan = p.detailKind === 'plan';
  const note = () => (notes.get(p.rid) || '').trim();
  const done = () => notes.delete(p.rid);
  const decide = (decision, extra = {}) => {
    ui.sound.play(decision === 'deny' ? 'close' : 'send');
    done();
    ui.action('decide', { rid: p.rid, decision, ...extra });
  };
  const deny = (interrupt) => decide('deny', { message: note(), interrupt });
  const comment = () => {
    if (!note()) {
      ui.flash('annoyed', 900);
      return card.querySelector('textarea')?.focus();
    }
    ui.sound.play('send');
    const text = note();
    done();
    ui.action('commentPlan', { rid: p.rid, text });
  };
  // Keyboard (island.js → onKey): A autoriser, R refuser (or comment the plan), T toujours.
  const keys = ui.settings().keys !== false;
  keyActions = { rid: p.rid, a: () => decide('allow'), r: () => (plan ? comment() : deny(false)), t: p.canAlways ? () => decide('always') : null };
  const kbd = (k) => (keys ? h('span.cl-kbd', k) : null);
  const body = [];
  if (p.detailKind === 'edit' && p.diff) {
    body.push(h('div.mono.small.ellipsis', p.target));
    for (const d of p.diff) {
      body.push(h('pre', h('span', { style: { color: '#FF9AA3' } }, clip(d.old, 500).split('\n').map((l) => '- ' + l).join('\n')), '\n', h('span', { style: { color: '#7EE08F' } }, clip(d.new, 500).split('\n').map((l) => '+ ' + l).join('\n'))));
    }
  } else if (p.detailKind === 'plan') {
    body.push(h('div.code', markdown(p.detail)));
  } else {
    if (p.target) body.push(h('pre', p.target));
    if (p.detail) body.push(h(p.detailKind === 'write' ? 'pre' : 'div.dim.small', p.detail));
  }
  // The instruction field: kept per request across state updates (the island
  // re-renders on blur, never under the user's fingers).
  const field = textField(ui, notes, p.rid, {
    placeholder: plan ? 'Tes remarques sur le plan…' : 'Consigne pour Claude si tu refuses (facultatif)…',
    onsubmit: () => (plan ? comment() : deny(false)),
  });
  const card = h('div.card.hot',
    h('div.row',
      h('span.state-dot.pulse', { style: { '--c': '#F2A65A' } }),
      h('span.title.grow.ellipsis', plan ? `${p.project} propose un plan` : `${p.project} veut utiliser`),
      p.sensitive ? h('span.pill.bad', { title: 'Commande sensible : relis-la avant d’autoriser' }, `⚠ ${p.sensitive}`) : null,
      h('span.pill.gold', p.toolLabel),
    ),
    body,
    h('div', { style: { marginTop: '8px' } }, field),
    h('div.btns.end', { style: { marginTop: '8px' } },
      btn(h, '.ghost.sm', { title: 'Laisser le terminal poser la question', onclick: () => decide('pass') }, 'Terminal'),
      btn(h, '.danger.sm', { title: 'Refuser et arrêter Claude (interrompt le tour)', onclick: () => deny(true) }, 'Arrêter'),
      plan
        ? btn(h, '', { title: 'Refuser le plan avec tes remarques : Claude le révise', onclick: comment }, ['Commenter le plan', kbd('R')])
        : btn(h, '.danger', { title: 'Refuser ; la consigne ci-dessus est transmise à Claude', onclick: () => deny(false) }, ['Refuser', kbd('R')]),
      p.canAlways ? btn(h, '', { title: 'Autoriser et ne plus demander pour ce type d’action', onclick: () => decide('always') }, ['Toujours', kbd('T')]) : null,
      btn(h, '.primary', { onclick: () => decide('allow') }, [plan ? 'Valider le plan' : 'Autoriser', kbd('A')]),
    ),
  );
  return card;
}

/**
 * A button that does not take the focus: clicking it right after typing must
 * not blur the text field first (a blur re-renders the panel and the click
 * would land on a button that no longer exists).
 */
function btn(h, cls, props, label) {
  return h('button.btn' + cls, { ...props, onmousedown: (e) => e.preventDefault() }, label);
}

/** An auto-growing textarea whose text lives in `store` (survives re-renders). Ctrl+Entrée = onsubmit. */
function textField(ui, store, key, { placeholder, onsubmit, rows = 1 }) {
  const grow = (el) => {
    el.style.height = 'auto';
    el.style.height = `${Math.min(120, el.scrollHeight + 2)}px`;
  };
  const el = ui.h('textarea.text.cl-note', {
    rows,
    placeholder,
    onfocus: () => ui.focusWindow(),
    oninput: (e) => {
      store.set(key, e.target.value);
      grow(e.target);
    },
    onkeydown: (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || !e.shiftKey)) {
        e.preventDefault();
        onsubmit?.();
      }
    },
  });
  el.value = store.get(key) || ''; // a textarea's text is a property, not an attribute
  if (el.value) requestAnimationFrame(() => grow(el));
  return el;
}

function questionCard(p, ui) {
  const { h } = ui;
  if (!picks.has(p.rid)) picks.set(p.rid, p.questions.map(() => []));
  const sel = picks.get(p.rid);
  const free = others.get(p.rid) || [];
  others.set(p.rid, free);

  const keys = ui.settings().keys !== false;
  const qi = Math.min(cursors.get(p.rid) || 0, p.questions.length - 1); // the question the keys answer
  const card = h('div.card.hot',
    h('div.row', h('span.state-dot.pulse', { style: { '--c': '#F2A65A' } }), h('span.title.grow', `${p.project} te demande`)),
  );
  const choose = (i, o) => {
    const q = p.questions[i];
    if (q.multiSelect) sel[i] = sel[i].includes(o.label) ? sel[i].filter((x) => x !== o.label) : [...sel[i], o.label];
    else sel[i] = [o.label];
    free[i] = '';
    ui.sound.play('tick');
  };
  p.questions.forEach((q, i) => {
    const active = keys && i === qi;
    card.append(
      h('div' + (active && p.questions.length > 1 ? '.cl-qactive' : ''), { style: { marginTop: '8px' } },
        q.header ? h('span.pill.gold', q.header) : null,
        h('div', { style: { margin: '4px 0 6px', fontWeight: 600 } }, q.question),
        h('div.list',
          q.options.map((o, n) =>
            h('button.choice' + (sel[i].includes(o.label) ? '.sel' : ''), {
              onclick: () => {
                choose(i, o);
                rerender(ui);
              },
            },
              h('span.tick'),
              h('span.grow', h('div', o.label), o.description ? h('div.faint.small', o.description) : null),
              active && n < 9 ? h('span.cl-kbd', String(n + 1)) : null,
            ),
          ),
          h('input.text', {
            placeholder: 'Autre réponse…',
            value: free[i] || '',
            onfocus: () => ui.focusWindow(),
            oninput: (e) => {
              free[i] = e.target.value;
              if (free[i]) sel[i] = [];
            },
          }),
        ),
      ),
    );
  });
  const send = () => {
    const answers = {};
    p.questions.forEach((q, i) => {
      const chosen = free[i]?.trim() ? [free[i].trim()] : sel[i];
      if (!chosen.length) return;
      answers[q.question] = q.multiSelect ? chosen : chosen[0];
    });
    if (!Object.keys(answers).length) return ui.flash('annoyed', 900);
    ui.sound.play('send');
    picks.delete(p.rid);
    others.delete(p.rid);
    cursors.delete(p.rid);
    ui.action('answer', { rid: p.rid, answers });
  };
  // Keyboard: 1–9 picks in the active question (a single choice moves on, and sends after the last one);
  // Entrée moves on from a multiple choice, or sends.
  const next = () => {
    if (qi < p.questions.length - 1) {
      cursors.set(p.rid, qi + 1);
      rerender(ui);
    } else send();
  };
  keyActions = { rid: p.rid, enter: next };
  p.questions[qi].options.slice(0, 9).forEach((o, n) => {
    keyActions[String(n + 1)] = () => {
      choose(qi, o);
      if (p.questions[qi].multiSelect) rerender(ui);
      else next();
    };
  });
  card.append(
    h('div.btns.end', { style: { marginTop: '10px' } },
      h('button.btn.ghost.sm', { onclick: () => ui.action('decide', { rid: p.rid, decision: 'pass' }) }, 'Répondre dans le terminal'),
      h('button.btn.primary', { onclick: send }, 'Envoyer', keys ? h('span.cl-kbd', '↵') : null),
    ),
  );
  return card;
}

/**
 * « Glisser une consigne »: a note Claude reads at its next step (PostToolUse)
 * or with your next prompt. Shown on busy sessions, and on any unfolded one.
 */
function nudgeBlock(s, ui, unfolded) {
  const { h, ago } = ui;
  const busy = ['working', 'thinking', 'approval', 'question'].includes(s.state);
  const list = (s.nudges || []).filter((n) => !n.deliveredAt || Date.now() - n.deliveredAt < 30 * 60000);
  if (!busy && !unfolded && !list.length) return null;
  const send = async () => {
    const text = (drafts.get(s.id) || '').trim();
    if (!text) return ui.flash('annoyed', 800);
    drafts.delete(s.id);
    // Let go of the field: the island holds re-renders while you type in it.
    if (document.activeElement?.tagName === 'TEXTAREA') document.activeElement.blur();
    ui.sound.play('send');
    const ok = await ui.action('nudge', { id: s.id, text });
    if (!ok) {
      drafts.set(s.id, text);
      ui.flash('annoyed', 900);
    }
    ui.rerender();
  };
  const rows = list.map((n) =>
    h('div.row.small.cl-nudge' + (n.deliveredAt ? '.done' : ''),
      h('span', n.deliveredAt ? '✓' : '⏳'),
      h('span.ellipsis.grow', '« ', n.text, ' »'),
      n.deliveredAt
        ? h('span.faint', `livrée ${ago(n.deliveredAt)}`)
        : [h('span.faint', busy ? 'au prochain outil' : 'avec ta prochaine demande'), btn(h, '.ghost.sm', { title: 'Retirer cette consigne', onclick: () => ui.action('cancelNudge', { id: s.id, nid: n.id }) }, 'Retirer')],
    ),
  );
  return h('div.cl-nudges', { onclick: (e) => e.stopPropagation() },
    rows,
    s.state === 'ended'
      ? null
      : h('div.row', { style: { marginTop: '6px', gap: '6px' } },
          h('div.grow', textField(ui, drafts, s.id, { placeholder: busy ? 'Glisser une consigne… (Claude la lira à sa prochaine étape)' : 'Glisser une consigne pour la prochaine demande…', onsubmit: send })),
          btn(h, '.sm', { title: 'Mettre en file : livrée sans interrompre Claude', onclick: send }, 'Glisser'),
        ),
  );
}

const hostLabel = (s) => (/desktop/i.test(s.entrypoint || '') ? 'Ouvrir Claude' : /vscode/i.test(`${s.entrypoint} ${s.term}`) ? 'Aller à VS Code' : 'Aller au terminal');

const dur = (sec) => (sec < 90 ? `${sec} s` : sec < 5400 ? `${Math.round(sec / 60)} min` : `${Math.floor(sec / 3600)} h ${String(Math.round((sec % 3600) / 60)).padStart(2, '0')}`);

/** End of turn: branch / worktree, last test run, files changed with +N −M, optional one-line summary. */
function turnBlock(s, ui, unfolded) {
  const { h } = ui;
  const t = s.lastTurn;
  const pills = [];
  if (t.branch) pills.push(h('span.pill.blue', { title: t.branch.worktree ? `Worktree de ${t.branch.root}` : t.branch.root }, `⎇ ${t.branch.branch}`), t.branch.worktree ? h('span.pill', 'worktree') : null);
  if (t.tests) {
    const n = t.tests.ok ? t.tests.passed : t.tests.failed;
    pills.push(h('span.pill.' + (t.tests.ok ? 'ok' : 'bad'), { title: t.tests.command }, t.tests.ok ? `✓ tests${n != null ? ' ' + n : ''}` : `✗ tests${n != null ? ' · ' + n + ' en échec' : ''}`));
  }
  if (t.fileCount) pills.push(h('span.small', h('span.cl-add', `+${t.add}`), ' ', h('span.cl-del', `−${t.del}`), h('span.faint', ` · ${t.fileCount} fichier${t.fileCount > 1 ? 's' : ''}`)));
  if (t.tookSec >= 5) pills.push(h('span.faint.small', dur(t.tookSec)));
  if (!pills.length && !t.summary) return null;
  return h('div.cl-turn',
    h('div.row', { style: { flexWrap: 'wrap', gap: '6px' } }, pills),
    t.summary ? h('div.small.dim.ellipsis', { style: { marginTop: '3px' } }, '✦ ', t.summary) : null,
    unfolded ? fileList(ui, s, t, 'last') : null,
  );
}

/** The files a turn touched, +N −M each; a click opens the file's diff. */
function fileList(ui, s, t, which) {
  const { h } = ui;
  if (!t.files?.length) return null;
  return h('div.cl-files',
    t.files.map((f) =>
      h('div.row.small.mono.cl-file', {
        title: f.path ? `Voir le diff de ${f.file}` : f.file,
        onclick: (e) => {
          e.stopPropagation();
          if (f.path) openDiff(ui, s, f, which);
        },
      },
        h('span.ellipsis.grow', f.file, f.created ? h('span.faint', ' (nouveau)') : null),
        f.via ? h('span.pill.cl-via', { title: 'Modifié hors des outils d’édition (commande, script…), vu par git en fin de tour' }, 'via commande') : null,
        h('span.cl-add', `+${f.add}`),
        h('span.cl-del', `−${f.del}`),
      ),
    ),
    t.fileCount > t.files.length ? h('div.faint.small', `+ ${t.fileCount - t.files.length} autres`) : null);
}

// ── A file's diff ───────────────────────────────────────────────────────

let diff = null; // { id, path, rel, which, mode: 'turn' | 'git', turn, git, loading, unfold: Set, top }

function openDiff(ui, s, f, which) {
  // A file changed by a command has no edit texts: git is all there is.
  diff = { id: s.id, project: s.project, path: f.path, rel: f.file, which, mode: f.via ? 'git' : 'turn', via: f.via || null, add: f.add, del: f.del, turn: null, git: null, loading: true, unfold: new Set(), top: true };
  ui.sound.play('tick');
  ui.rerender();
  loadDiff(ui);
}

async function loadDiff(ui) {
  const d = diff;
  d.loading = true;
  const res = await ui.action(d.mode === 'git' ? 'gitDiff' : 'fileDiff', { id: d.id, path: d.path, which: d.which }).catch((err) => ({ ok: false, error: String(err?.message || err) }));
  if (diff !== d) return; // closed or replaced meanwhile
  d[d.mode] = res || { ok: false, error: 'Pas de réponse.' };
  d.loading = false;
  ui.rerender();
}

function switchDiff(ui, mode) {
  if (!diff || diff.mode === mode) return;
  diff.mode = mode;
  diff.unfold = new Set();
  if (diff[mode]) ui.rerender();
  else {
    ui.rerender();
    loadDiff(ui);
  }
}

const MAX_ROWS = 4000; // past this, the rest of a git diff is left out of the DOM

/** The panel is rebuilt only when the diff itself changes, not at every hook event of every session. */
function diffPanel(ui) {
  const key = `${diff.mode}|${diff.loading}|${[...diff.unfold].join(',')}|${!!diff.turn}|${!!diff.git}`;
  if (diff.el && diff.key === key) return diff.el;
  diff.key = key;
  return (diff.el = buildDiffPanel(ui));
}

function buildDiffPanel(ui) {
  const { h } = ui;
  const d = diff;
  const res = d[d.mode];
  const canGit = !!d.via || !!d.turn?.git;
  const firstLine = res?.line ?? res?.blocks?.find((b) => b.line)?.line ?? 1;
  const head = h('div.row.cl-dhead',
    btn(h, '.ghost.sm', { title: 'Revenir aux sessions', onclick: () => { diff = null; ui.rerender(); } }, '← Sessions'),
    h('span.mono.ellipsis.grow', { title: d.path }, d.rel),
    d.via ? h('span.pill.cl-via', 'via commande') : null,
    h('span.small', h('span.cl-add', `+${d.add ?? 0}`), ' ', h('span.cl-del', `−${d.del ?? 0}`)),
  );
  const tabs = h('div.row.cl-dtabs',
    d.via ? null : h('button.btn.sm' + (d.mode === 'turn' ? '.primary' : '.ghost'), { onclick: () => switchDiff(ui, 'turn') }, 'Ce tour'),
    canGit ? h('button.btn.sm' + (d.mode === 'git' ? '.primary' : '.ghost'), { title: 'git diff HEAD -- fichier, dans le dossier de la session', onclick: () => switchDiff(ui, 'git') }, 'Diff git') : null,
    h('span.grow'),
    h('span.faint.small', d.project || ''),
  );
  const body = [];
  if (d.loading && !res) body.push(h('div.faint.small.cl-dnote', d.mode === 'git' ? 'git diff…' : 'Calcul du diff…'));
  else if (!res?.ok) body.push(h('div.small.cl-dnote.bad', res?.error || 'Diff indisponible.'));
  else {
    for (const n of res.notes || []) body.push(h('div.faint.small.cl-dnote', n));
    if (res.binary) body.push(h('div.faint.small.cl-dnote', 'Fichier binaire : pas de diff ligne à ligne.'));
    if (d.mode === 'git' && res.empty) body.push(h('div.faint.small.cl-dnote', 'Aucune différence avec le dernier commit (fichier non suivi, ou déjà commité).'));
    if (d.mode === 'turn' && !res.blocks?.length) body.push(h('div.faint.small.cl-dnote', 'Le texte de ces modifications n’a pas été conservé.' + (canGit ? ' Essaie « Diff git ».' : '')));
    let budget = MAX_ROWS;
    (res.blocks || []).forEach((b, i) => {
      if (budget <= 0) return;
      const rows = rowEls(h, ui, b.rows, `${d.mode}.${i}`, () => budget--);
      body.push(h('div.cl-dblock',
        h('div.row.small.cl-dtitle',
          h('span.ellipsis', b.title),
          b.line ? h('span.faint', `ligne ${b.line}`) : null,
          h('span.grow'),
          b.at ? h('span.faint', new Date(b.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })) : null,
          h('span.cl-add', `+${b.add}`),
          h('span.cl-del', `−${b.del}`),
        ),
        h('div.cl-diff', rows),
      ));
    });
    if (budget <= 0) body.push(h('div.faint.small.cl-dnote', 'Diff très long : la suite est coupée. Ouvre le fichier dans VS Code.'));
  }
  return h('div.card.cl-dcard', { onclick: (e) => e.stopPropagation() },
    head,
    tabs,
    body,
    h('div.btns', { style: { marginTop: '8px' } },
      h('button.btn.sm.primary', { title: 'code -g fichier:ligne (sinon l’application par défaut)', onclick: () => ui.action('openInCode', { id: d.id, path: d.path, line: firstLine }) }, 'Ouvrir dans VS Code'),
      h('button.btn.sm', { onclick: async () => { if (await ui.action('copyPath', { id: d.id, path: d.path })) ui.flash('love', 1000); } }, 'Copier le chemin'),
    ),
  );
}

const clipLine = (s) => (s.length > 1200 ? `${s.slice(0, 1200)}… (+${s.length - 1200} caractères)` : s);

function rowEls(h, ui, rows, key, spend) {
  const out = [];
  rows.forEach((r, i) => {
    if (r.t === '…') {
      const k = `${key}.${i}`;
      if (diff.unfold.has(k)) out.push(...rowEls(h, ui, r.rows, k, spend));
      else {
        out.push(h('div.cl-dl.fold', { title: 'Déplier', onclick: () => { diff.unfold.add(k); ui.rerender(); } },
          h('span.cl-ln'), h('span.cl-ln'), h('span.cl-sg', '⋯'), h('span.cl-code', `${r.count} ligne${r.count > 1 ? 's' : ''} inchangée${r.count > 1 ? 's' : ''}`)));
      }
      return;
    }
    if (spend() <= 0) return;
    const cls = r.t === '+' ? '.add' : r.t === '-' ? '.del' : '';
    out.push(h('div.cl-dl' + cls, h('span.cl-ln', r.o ?? ''), h('span.cl-ln', r.n ?? ''), h('span.cl-sg', r.t === '+' ? '+' : r.t === '-' ? '−' : ''), h('span.cl-code', clipLine(String(r.s ?? '')))));
  });
  return out;
}

/** While Claude works: what the turn has changed so far, updated at each edit. */
function liveBlock(s, ui, unfolded) {
  const { h } = ui;
  const t = s.live;
  return h('div.cl-turn.cl-live',
    h('div.row.small', { style: { gap: '6px' } },
      h('span.cl-pen', '✎'),
      h('span', `${t.fileCount} fichier${t.fileCount > 1 ? 's' : ''}`),
      h('span.cl-add', `+${t.add}`),
      h('span.cl-del', `−${t.del}`),
      unfolded ? null : h('span.faint.ellipsis.grow', t.files[0]?.file || ''),
    ),
    unfolded ? fileList(ui, s, t, 'live') : null,
  );
}

/** Thin bar + "3/7 · what Claude is on now", from TodoWrite or the Task hooks. */
function progressBar(prog, h) {
  if (!prog?.total) return null;
  const pct = Math.round((prog.done / prog.total) * 100);
  const complete = prog.done >= prog.total;
  return h('div.cl-progress',
    h('div.cl-bar.thin', h('i', { style: { width: `${Math.max(3, pct)}%`, background: complete ? '#3FB950' : '#E8B923' } })),
    h('div.row.small',
      h('span.cl-count', `${prog.done}/${prog.total}`),
      h('span.faint.ellipsis.grow', complete ? 'toutes les tâches sont faites' : prog.current || ''),
    ),
  );
}

// ── Plan gauges ─────────────────────────────────────────────────────────

/** "2 h 14", "3 j 5 h", "12 min" (same as quota.js, for the live countdown). */
function countdown(ms) {
  if (!(ms > 0)) return 'maintenant';
  const min = Math.ceil(ms / 60000);
  if (min < 60) return `${min} min`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} h ${String(min % 60).padStart(2, '0')}`;
  return `${Math.floor(hours / 24)} j ${hours % 24} h`;
}

function tokens(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace('.', ',')} M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} k`;
  return String(n);
}

const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
/** "aujourd’hui 14:30", "demain 09:00", "mardi 14:30". */
function when(ts) {
  const d = new Date(ts);
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(new Date())) / 86400000);
  const hm = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${diff === 0 ? 'aujourd’hui' : diff === 1 ? 'demain' : WEEKDAYS[d.getDay()]} ${hm}`;
}

/** A small item of the top row, its details in a tooltip on hover. */
function gaugeItem(h, { label, value, color, pct, pace, stale, tip }) {
  return h('div.cl-g' + (stale ? '.stale' : ''),
    h('span.cl-gl', label),
    h('span.cl-gp', { style: { color } }, value),
    pct != null
      ? h('span.cl-gbar',
          h('i', { style: { width: `${Math.max(3, pct)}%`, background: color } }),
          pace != null ? h('b.cl-pace', { style: { left: `${pace}%` } }) : null)
      : null,
    h('div.cl-tip', tip),
  );
}

/**
 * The plan gauges, small, on the row of « + Nouvelle session »: « 5 h 84 % ▬ »,
 * « Sem. 41 % ▬ ». The tick on each bar is the linear pace (where a steady use
 * would stand now). Reset time, countdown and staleness are in the tooltip.
 */
function quotaStrip(q, st, ui) {
  const { h } = ui;
  if (!q) return [];
  const gauges = q.gauges || [];
  if (gauges.length) {
    return gauges.map((g) => {
      const color = LEVEL_COLORS[g.level] || LEVEL_COLORS.ok;
      const gap = g.pace != null ? g.pct - g.pace : 0;
      return gaugeItem(h, {
        label: g.key === 'five_hour' ? '5 h' : 'Sem.',
        value: `${g.pct} %`,
        color,
        pct: g.pct,
        pace: g.reset ? null : g.pace,
        stale: g.stale,
        tip: [
          h('div.cl-tip-h', `${g.key === 'five_hour' ? 'Fenêtre de 5 h' : 'Semaine'} · ${g.pct} % utilisés`),
          g.reset
            ? h('div', 'Réinitialisée : le compteur repart de zéro.')
            : g.resetsAt
              ? h('div', `Réinit. ${when(g.resetsAt)} · dans `, h('span', { dataset: { reset: String(g.resetsAt) } }, countdown(g.resetsAt - Date.now())))
              : null,
          g.pace != null && !g.reset
            ? h('div', `Rythme régulier : ${g.pace} %`,
                gap >= 5 ? h('span', { style: { color: LEVEL_COLORS.warn } }, ` · ${gap} pts d’avance`) : gap <= -5 ? h('span', { style: { color: LEVEL_COLORS.ok } }, ` · ${-gap} pts de marge`) : ' · pile dans le rythme')
            : null,
          g.stale ? h('div.faint', 'Donnée ancienne (plus de 6 h) : mise à jour à la prochaine réponse de Claude.') : null,
        ],
      });
    });
  }
  // No rate_limits: today's tokens, the projects in the tooltip.
  const out = [];
  if (q.usage?.length) {
    out.push(gaugeItem(h, {
      label: 'Aujourd’hui',
      value: `${tokens(q.usageTotal)} tokens`,
      color: 'var(--dim)',
      tip: [h('div.cl-tip-h', 'Tokens du jour par projet'), q.usage.map((p) => h('div', `${p.project} · ${tokens(p.tokens)}`))],
    }));
  }
  if (!q.statusLine && st.hooksInstalled) {
    out.push(h('a.cl-g.cl-hint', { href: '#', onclick: (e) => (e.preventDefault(), ui.core('openSettings', 'claude')) },
      'Jauges du forfait ?',
      h('div.cl-tip', 'Réinstalle les hooks (Réglages → Claude) pour ajouter le relais statusLine et voir les jauges 5 h et semaine.')));
  }
  return out;
}

// Live countdowns without waiting for a state update.
setInterval(() => {
  for (const el of document.querySelectorAll('[data-reset]')) el.textContent = countdown(Number(el.dataset.reset) - Date.now());
}, 30000);

function ensureStyle() {
  if (document.getElementById('claude-view-css')) return;
  const css = `
  .cl-session > .row:first-child { gap: 7px; }
  .cl-name { flex: none; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cl-label { flex: 0 1 auto; min-width: 0; }
  .cl-model, .cl-time { flex: none; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .cl-ctx { flex: none; font-size: 10.5px; font-weight: 700; color: var(--c); white-space: nowrap; font-variant-numeric: tabular-nums; }
  .cl-ctx.warn, .cl-ctx.bad { padding: 0 6px; border-radius: 9px; background: color-mix(in srgb, var(--c) 16%, transparent); }
  .cl-stow { display: none; height: 20px; padding: 0 7px; font-size: 11px; }
  .cl-session:hover .cl-stow { display: inline-block; }
  .cl-session.cl-stowed { opacity: .65; }
  .cl-silent { margin-top: 3px; color: #F2C48A; }
  .cl-agents { margin-top: 3px; }
  .cl-agents-n { color: #A9D2FF; }
  .cl-agent-type { color: var(--dim); }
  a.cl-stowed-link { font-size: 11px; color: var(--faint); text-decoration: none; }
  a.cl-stowed-link:hover { color: var(--gold-light); }
  .cl-kbd { display: inline-block; min-width: 13px; margin-left: 6px; padding: 0 3px; border-radius: 4px; border: 1px solid currentColor; font-size: 9.5px; font-weight: 700; line-height: 13px; text-align: center; opacity: .5; }
  .cl-qactive { box-shadow: inset 2px 0 0 var(--gold); padding-left: 6px; }
  .cl-top { gap: 14px; margin: 0 2px 8px; min-height: 24px; }
  .cl-g { position: relative; display: inline-flex; align-items: center; gap: 5px; font-size: 11px; cursor: default; white-space: nowrap; }
  .cl-g.stale { opacity: .6; }
  .cl-gl { color: var(--faint); font-weight: 600; }
  .cl-gp { font-weight: 700; font-variant-numeric: tabular-nums; }
  .cl-gbar { position: relative; width: 36px; height: 3px; border-radius: 2px; background: rgba(255,255,255,.1); }
  .cl-gbar > i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 2px; transition: width .4s; }
  .cl-pace { position: absolute; top: -2px; width: 1px; height: 7px; margin-left: -.5px; background: rgba(255,255,255,.6); }
  a.cl-hint { color: var(--faint); text-decoration: none; cursor: pointer; }
  a.cl-hint:hover { color: var(--gold-light); }
  .cl-tip { display: none; position: absolute; top: calc(100% + 7px); left: 0; z-index: 30; width: max-content; max-width: 280px; padding: 7px 10px; border-radius: 10px; background: #1B1922; border: 1px solid var(--line); color: var(--dim); font-size: 11px; font-weight: 400; line-height: 1.5; white-space: normal; box-shadow: 0 8px 22px rgba(0,0,0,.55); pointer-events: none; }
  .cl-g:hover > .cl-tip { display: block; }
  .cl-tip-h { color: var(--text); font-weight: 600; }
  .cl-bar { height: 6px; border-radius: 3px; background: #0B0A0E; overflow: hidden; margin: 4px 0 3px; }
  .cl-bar > i { display: block; height: 100%; border-radius: 3px; transition: width .4s; }
  textarea.cl-note { font-size: 12px; padding: 6px 9px; min-height: 30px; line-height: 1.35; }
  .cl-progress { margin-top: 6px; }
  .cl-bar.thin { height: 4px; margin: 0 0 3px; }
  .cl-count { font-weight: 700; color: var(--gold-light); font-variant-numeric: tabular-nums; }
  .cl-todos { margin-top: 6px; display: grid; gap: 2px; }
  .cl-todo { color: var(--dim); }
  .cl-todo.completed { color: var(--faint); text-decoration: line-through; }
  .cl-todo.in_progress { color: var(--text); }
  .cl-tick { display: inline-block; width: 14px; color: var(--gold); }
  .cl-turn { margin-top: 6px; }
  .cl-add { color: #7EE08F; font-variant-numeric: tabular-nums; }
  .cl-del { color: #FF9AA3; font-variant-numeric: tabular-nums; }
  .cl-pen { color: var(--gold); }
  .cl-file { cursor: pointer; border-radius: 5px; padding: 0 3px; margin: 0 -3px; }
  .cl-file:hover { background: var(--card-2); }
  .cl-file:hover .ellipsis { color: var(--text); text-decoration: underline; text-decoration-color: rgba(255,255,255,.25); }
  .pill.cl-via { font-size: 10px; padding: 0 6px; color: #A9D2FF; }
  .cl-dhead { gap: 8px; }
  .cl-dhead .mono { font-weight: 600; }
  .cl-dtabs { gap: 6px; margin: 8px 0 6px; }
  .cl-dnote { margin: 4px 0; }
  .cl-dnote.bad { color: #FF9AA3; }
  .cl-dblock { margin-top: 8px; }
  .cl-dtitle { gap: 8px; margin-bottom: 3px; color: var(--dim); }
  .cl-diff { font-family: var(--mono); font-size: 11px; line-height: 1.45; background: #0B0A0E; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; user-select: text; }
  .cl-dl { display: grid; grid-template-columns: 36px 36px 14px 1fr; }
  .cl-dl .cl-ln { color: var(--faint); text-align: right; padding-right: 6px; user-select: none; font-variant-numeric: tabular-nums; opacity: .8; }
  .cl-dl .cl-sg { user-select: none; color: var(--faint); }
  .cl-dl .cl-code { white-space: pre-wrap; overflow-wrap: anywhere; padding-right: 8px; color: #CFC9D8; min-height: 1.45em; }
  .cl-dl.add { background: rgba(63,185,80,.14); }
  .cl-dl.add .cl-code, .cl-dl.add .cl-sg { color: #A6EDB1; }
  .cl-dl.del { background: rgba(240,97,109,.14); }
  .cl-dl.del .cl-code, .cl-dl.del .cl-sg { color: #FFB8BE; }
  .cl-dl.fold { cursor: pointer; background: rgba(255,255,255,.035); }
  .cl-dl.fold .cl-code { color: var(--faint); font-style: italic; }
  .cl-dl.fold:hover .cl-code { color: var(--gold-light); }
  .cl-files { margin-top: 6px; display: grid; gap: 1px; }
  .cl-files .row { gap: 6px; }
  .cl-files .mono { font-size: 11px; }
  .cl-harvest { display: block; border-radius: 12px; }
  .cl-nudges { margin-top: 6px; }
  .cl-nudge { gap: 6px; color: var(--gold-light); margin-top: 3px; }
  .cl-nudge.done { color: #7EE08F; }
  `;
  document.head.append(Object.assign(document.createElement('style'), { id: 'claude-view-css', textContent: css }));
}

function rerender(ui) {
  ui.rerender();
}
