// Pure logic of « Lire » (OCR): turning the engine's words into text that pastes
// well, and deciding when an image in the clipboard is worth offering.

const IMAGE_EXT = /\.(png|jpe?g|jfif|bmp|gif|tiff?|webp|heic|ico)$/i;

const isImagePath = (p) => typeof p === 'string' && IMAGE_EXT.test(p);

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/**
 * OCR lines → text. Windows cuts a row into several « lines » when words are far
 * apart, and lists them column by column; here words are put back in rows:
 *   * same row = vertical overlap of at least half the smaller height;
 *   * a wide gap inside a row (columns of a table, a form) = a tab, so the text
 *     pastes into Excel cell by cell;
 *   * a tall gap between rows = a blank line (a new paragraph).
 * `lines`: [{ t, w: [[text, x, y, w, h]] }] (winocr.js). Coordinates in any unit.
 * → { text, rows, columns (a tab somewhere), words }
 */
function layout(lines) {
  const words = [];
  for (const line of Array.isArray(lines) ? lines : []) {
    for (const w of Array.isArray(line?.w) ? line.w : []) {
      const [t, x, y, wd, ht] = w;
      if (typeof t !== 'string' || !t.trim() || ![x, y, wd, ht].every(Number.isFinite)) continue;
      words.push({ t: t.trim(), x, y, w: wd, h: Math.max(1, ht) });
    }
  }
  if (!words.length) return { text: '', rows: 0, columns: false, words: 0 };
  const lineH = median(words.map((w) => w.h));

  // Rows, top to bottom.
  words.sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2) || a.x - b.x);
  const rows = [];
  for (const w of words) {
    const row = rows.find((r) => {
      const overlap = Math.min(r.bottom, w.y + w.h) - Math.max(r.top, w.y);
      return overlap >= 0.5 * Math.min(r.h, w.h);
    });
    if (row) {
      row.words.push(w);
      row.top = Math.min(row.top, w.y);
      row.bottom = Math.max(row.bottom, w.y + w.h);
      row.h = median(row.words.map((x) => x.h));
    } else rows.push({ words: [w], top: w.y, bottom: w.y + w.h, h: w.h });
  }
  rows.sort((a, b) => a.top - b.top);

  let columns = false;
  const out = [];
  let prev = null;
  for (const r of rows) {
    r.words.sort((a, b) => a.x - b.x);
    let text = '';
    let end = null;
    for (const w of r.words) {
      if (end != null) {
        const gap = w.x - end;
        const tab = gap > 2.2 * Math.max(lineH, r.h);
        if (tab) columns = true;
        text += tab ? '\t' : ' ';
      }
      text += w.t;
      end = w.x + w.w;
    }
    if (prev && r.top - prev.bottom > 0.9 * lineH) out.push('');
    out.push(text);
    prev = r;
  }
  return { text: out.join('\n'), rows: rows.length, columns, words: words.length };
}

/** First words of a text, on one line (the tab's subtitle, an alert). */
function preview(text, max = 70) {
  const one = String(text || '').replace(/\s+/g, ' ').trim();
  return one.length > max ? one.slice(0, max - 1).trimEnd() + '…' : one;
}

/**
 * The clipboard holds an image copied a moment ago (a Win+Maj+S capture) that was
 * neither read nor dismissed: the island offers « Lire le texte » when you come by.
 * clip: { seq, at } | null.
 */
function offerable(clip, { now = Date.now(), minutes = 3, dismissed = null, enabled = true } = {}) {
  if (!enabled || !clip || clip.seq === dismissed) return false;
  return now - clip.at < Math.max(0.5, Number(minutes) || 3) * 60000;
}

/** A Windows OCR failure, in words. */
function explain(res) {
  if (!res) return 'Gany n’a rien pu lire.';
  if (res.code === 'nolang') return res.msg;
  if (res.code === 'spawn') return 'PowerShell n’a pas pu démarrer.';
  const hex = typeof res.code === 'number' ? (res.code >>> 0).toString(16).toUpperCase() : '';
  if (hex === '88982F50' || hex === '88982F07') return 'Ce format d’image n’est pas lisible par Windows.';
  if (hex === '80070002' || hex === '80070003') return 'L’image a disparu entre-temps.';
  return `La lecture a échoué${res.msg ? ` : ${preview(res.msg, 120)}` : '.'}`;
}

module.exports = { IMAGE_EXT, isImagePath, layout, preview, offerable, explain };
