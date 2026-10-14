// DOM helpers shared by the island and every module view. No framework.
//
//   h('div.card#main', { onclick: fn, title: 'x', style: { color: 'red' } }, 'text', child, [more])
//
// Strings are always inserted as text (never as HTML): mail subjects, commands
// and Claude's answers can contain anything.

export function h(tag, props, ...children) {
  const [, name = 'div', rest = ''] = tag.match(/^([a-z0-9-]*)(.*)$/i) || [];
  const el = document.createElement(name || 'div');
  for (const part of rest.match(/[.#][^.#]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sv == null) continue;
        if (sk.startsWith('--')) el.style.setProperty(sk, sv);
        else el.style[sk] = sv;
      }
    }
    else if (k === 'class') el.className += ' ' + v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Replaces the children of `el`. */
export function mount(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

/** "il y a 3 min" */
export function ago(ts) {
  if (!ts) return '';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 45) return 'à l’instant';
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export function clip(text, n) {
  text = String(text ?? '');
  return text.length > n ? text.slice(0, n - 1) + '…' : text;
}

/**
 * A tiny, safe markdown renderer for Claude's answers: paragraphs, **bold**,
 * `code`, ``` blocks, bullet lists and links. Builds DOM nodes; never innerHTML.
 */
export function markdown(text) {
  const root = h('div.md');
  const lines = String(text || '').split('\n');
  let list = null;
  let code = null;
  for (const line of lines) {
    if (line.startsWith('```')) {
      if (code) {
        root.append(code);
        code = null;
      } else code = h('pre');
      continue;
    }
    if (code) {
      code.append(document.createTextNode(line + '\n'));
      continue;
    }
    const bullet = line.match(/^\s*[-*•]\s+(.*)/) || line.match(/^\s*\d+[.)]\s+(.*)/);
    if (bullet) {
      if (!list) {
        list = h('ul');
        root.append(list);
      }
      list.append(h('li', inline(bullet[1])));
      continue;
    }
    list = null;
    const head = line.match(/^#{1,4}\s+(.*)/);
    if (head) root.append(h('div.md-h', inline(head[1])));
    else if (line.trim()) root.append(h('p', inline(line)));
  }
  if (code) root.append(code);
  return root;
}

function inline(text) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:[^)]+\))/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('**')) out.push(h('b', t.slice(2, -2)));
    else if (t.startsWith('`')) out.push(h('code', t.slice(1, -1)));
    else {
      const [, label, url] = t.match(/\[([^\]]+)\]\(([^)]+)\)/);
      out.push(h('a', { href: '#', onclick: (e) => (e.preventDefault(), window.ambrosia.core('openExternal', url)) }, label));
    }
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
