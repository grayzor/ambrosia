// « Les vendanges de la semaine » — what the agents did, day by day, kept about
// eight weeks in the claude module's data, and the weekly summary Gany shows on
// Friday afternoon. Pure logic, tested in tests/harvest.test.js.

const KEEP_DAYS = 56;
const DAY = 86400000;

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** Monday of the week of `now` (local time), as a day key: the week's id. */
function weekKey(now) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return dayKey(d);
}

function day(days, now) {
  const key = dayKey(now);
  return (days[key] ||= { sessions: {}, turns: 0, workMs: 0, add: 0, del: 0, repos: {}, longest: null, peak5: 0, peak7: 0 });
}

const FILES_PER_REPO = 150; // per day: past this, a new file of that repo is not tracked
const REPOS_PER_DAY = 20;

/**
 * One finished turn of one session. `repo` (the git repository's name, the same for
 * all its worktrees) and `files` ([{ file, add, del }], relative paths) feed the
 * day's most edited files.
 */
function recordTurn(days, now, { sessionId, project, tookSec, add, del, prompt, repo, files }) {
  const d = day(days, now);
  if (sessionId && Object.keys(d.sessions).length < 400) d.sessions[sessionId] = 1;
  d.turns++;
  d.workMs += Math.max(0, Number(tookSec) || 0) * 1000;
  d.add += Number(add) || 0;
  d.del += Number(del) || 0;
  if (project) d.repos[project] = (d.repos[project] || 0) + 1;
  if (tookSec > (d.longest?.sec || 0)) d.longest = { sec: tookSec, project: project || '', prompt: String(prompt || '').slice(0, 120) };
  const name = repo || project;
  if (name && Array.isArray(files) && files.length) {
    d.files ||= {};
    if (!d.files[name] && Object.keys(d.files).length >= REPOS_PER_DAY) return;
    const per = (d.files[name] ||= {});
    for (const f of files) {
      if (!f?.file) continue;
      const key = String(f.file).replace(/\\/g, '/');
      if (!per[key] && Object.keys(per).length >= FILES_PER_REPO) continue;
      const v = (per[key] ||= [0, 0]);
      v[0] += Number(f.add) || 0;
      v[1] += Number(f.del) || 0;
    }
  }
}

const byChurn = (a, b) => b.add + b.del - (a.add + a.del) || a.file.localeCompare(b.file);

/** The day's most edited files, per repository: { repo: [{ file, add, del }] } (top `n` each). */
function dayTopFiles(days, now, n = 5) {
  const d = days[dayKey(now)];
  const out = {};
  for (const [repo, files] of Object.entries(d?.files || {})) {
    const list = Object.entries(files).map(([file, [add, del]]) => ({ file, add, del })).filter((f) => f.add + f.del > 0).sort(byChurn).slice(0, n);
    if (list.length) out[repo] = list;
  }
  return out;
}

/** The highest plan usage seen that day (statusLine rate_limits). */
function recordQuota(days, now, five, week) {
  const d = day(days, now);
  if (Number.isFinite(five)) d.peak5 = Math.max(d.peak5, Math.round(five));
  if (Number.isFinite(week)) d.peak7 = Math.max(d.peak7, Math.round(week));
}

function prune(days, now) {
  const limit = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - KEEP_DAYS * DAY;
  for (const key of Object.keys(days)) if (parseDay(key).getTime() < limit) delete days[key];
}

const LETTERS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

/** The week of `now`, Monday to Sunday: totals, per day, highlights. */
function weekSummary(days, now) {
  const monday = parseDay(weekKey(now));
  const per = [];
  const sessions = new Set();
  const repos = {};
  const files = {}; // "repo\0file" → { repo, file, add, del }
  let longest = null;
  const out = { week: weekKey(now), from: dayKey(monday), to: dayKey(new Date(monday.getTime() + 6 * DAY + 3600000)), turns: 0, workMs: 0, add: 0, del: 0, peak5: 0, peak7: 0 };
  for (let i = 0; i < 7; i++) {
    const date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    const d = days[dayKey(date)];
    per.push({ key: dayKey(date), letter: LETTERS[i], workMs: d?.workMs || 0, turns: d?.turns || 0, add: d?.add || 0, del: d?.del || 0 });
    if (!d) continue;
    for (const s of Object.keys(d.sessions)) sessions.add(s);
    for (const [r, n] of Object.entries(d.repos)) repos[r] = (repos[r] || 0) + n;
    for (const [repo, per] of Object.entries(d.files || {})) {
      for (const [file, [add, del]] of Object.entries(per)) {
        const f = (files[`${repo}\0${file}`] ||= { repo, file, add: 0, del: 0 });
        f.add += add;
        f.del += del;
      }
    }
    out.turns += d.turns;
    out.workMs += d.workMs;
    out.add += d.add;
    out.del += d.del;
    out.peak5 = Math.max(out.peak5, d.peak5 || 0);
    out.peak7 = Math.max(out.peak7, d.peak7 || 0);
    if (d.longest && d.longest.sec > (longest?.sec || 0)) longest = { ...d.longest, day: dayKey(date) };
  }
  out.days = per;
  out.sessions = sessions.size;
  out.repos = Object.entries(repos)
    .map(([name, turns]) => ({ name, turns }))
    .sort((a, b) => b.turns - a.turns);
  out.longest = longest;
  out.topFiles = Object.values(files).filter((f) => f.add + f.del > 0).sort(byChurn).slice(0, 3);
  const best = per.reduce((a, b) => (b.workMs > a.workMs ? b : a), per[0]);
  out.busiest = best.workMs ? best.key : null;
  return out;
}

/** Friday afternoon (by default), once a week, and only if there is something to show. */
function due(now, settings, shownWeek, summary) {
  if (settings.harvestEnabled === false) return false;
  const wanted = Number(settings.harvestDay ?? 5);
  if (now.getDay() !== wanted) return false;
  const [h, m] = String(settings.harvestAt || '15:00').split(':').map(Number);
  if (now.getHours() * 60 + now.getMinutes() < (h || 0) * 60 + (m || 0)) return false;
  if (shownWeek === weekKey(now)) return false;
  return !!summary && summary.turns > 0;
}

module.exports = { weekKey, dayKey, recordTurn, recordQuota, prune, weekSummary, dayTopFiles, due, KEEP_DAYS, FILES_PER_REPO };
