// Chat panel. Uses mount/update so the text field survives every streamed token.
// Voice: « Dicter » fills the field (like Claude Code's voice mode), « Parler »
// starts the live conversation (like Claude on the phone). A red dot in the notch
// whenever the microphone listens.

const MIC = '#FF6B7A';
const COLOR = '#B79CFF';
const SVG = {
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  live: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4"/></svg>',
  hang: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 15c5-4 13-4 18 0l-2 3-4-1v-3a10 10 0 0 0-6 0v3l-4 1z"/></svg>',
};
const PHASE = {
  listening: 'Je t’écoute…',
  thinking: 'Je réfléchis…',
  speaking: 'Je te réponds (clique sur moi ou parle pour m’interrompre)',
};

let els = null;

function svgBtn(h, cls, svg, label, props) {
  const b = h(`button.btn.sm.${cls}`, props);
  b.innerHTML = svg; // static, trusted SVG only
  b.append(document.createTextNode(label));
  return b;
}

export default {
  summary(st) {
    const v = st.voice || {};
    if (v.live) {
      return {
        dots: [{ color: MIC, pulse: true }],
        text: v.partial ? `« ${v.partial} »` : v.phase === 'speaking' ? 'Gany te répond…' : v.phase === 'thinking' ? 'Gany réfléchit…' : 'En conversation avec Gany',
      };
    }
    if (v.dictating) return { dots: [{ color: MIC, pulse: true }], text: 'Gany t’écoute…' };
    return st.busy ? { dots: [{ color: COLOR, pulse: true }], text: 'Gany réfléchit à ta question…' } : null;
  },

  mount(root, ui) {
    const { h } = ui;
    const input = h('textarea.text', {
      rows: 2,
      placeholder: 'Demande à Gany… (Entrée pour envoyer)',
      onfocus: () => ui.focusWindow(),
      onkeydown: (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          send();
        }
      },
      // An image pasted in the field becomes an attachment (a capture to explain).
      onpaste: (e) => {
        const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
        if (!file) return;
        e.preventDefault();
        const reader = new FileReader();
        reader.onload = () => ui.action('attachData', { b64: String(reader.result).split(',')[1] || '' });
        reader.readAsDataURL(file);
      },
    });
    const live = h('div.cv-live');
    const alertBox = h('div');
    const log = h('div.list', { style: { maxHeight: '300px', overflowY: 'auto', marginBottom: '8px' } });
    const files = h('div.cv-files');
    const heard = h('div.cv-heard');
    const sendBtn = h('button.btn.primary.sm', { onclick: () => send() }, 'Envoyer');
    const dictBtn = svgBtn(h, 'cv-mic', SVG.mic, 'Dicter', { title: 'Dicter ta question (reconnaissance vocale de Windows)', onclick: () => ui.action('dictate') });
    const liveBtn = svgBtn(h, 'cv-call', SVG.live, 'Parler', { title: 'Conversation vocale avec Gany : il t’écoute et te répond à voix haute', onclick: () => ui.action('live') });
    const resetBtn = h('button.btn.ghost.sm', { onclick: () => ui.action('reset') }, 'Nouvelle conversation');
    const send = async () => {
      const text = input.value.trim();
      if (!text && !els.hasFiles) return;
      input.value = '';
      ui.sound.play('send');
      ui.pin(true);
      await ui.action('send', { text });
    };
    root.append(
      live,
      alertBox,
      log,
      files,
      input,
      heard,
      h('div.row', { style: { marginTop: '6px' } }, dictBtn, liveBtn, h('span.grow'), resetBtn, sendBtn),
    );
    els = { log, input, sendBtn, dictBtn, liveBtn, live, alertBox, files, heard, lastText: '', dictSeq: null, hasFiles: false };
    setTimeout(() => input.focus(), 50);
  },

  update(root, st, ui) {
    if (!els) return;
    const { h, markdown } = ui;
    const v = st.voice || {};

    // Dictated words land at the end of the field.
    const seq = v.dictated?.seq || 0;
    if (els.dictSeq == null) els.dictSeq = seq;
    else if (seq > els.dictSeq) {
      els.dictSeq = seq;
      const before = els.input.value.trimEnd();
      els.input.value = (before ? before + ' ' : '') + v.dictated.text;
    }
    els.heard.textContent = v.dictating ? v.partial || 'Je t’écoute… (une pause et j’arrête)' : '';
    els.heard.classList.toggle('on', !!v.dictating);
    els.dictBtn.classList.toggle('on', !!v.dictating);
    els.dictBtn.disabled = !!v.live;
    els.liveBtn.classList.toggle('on', !!v.live);
    els.input.placeholder = v.live ? 'Tu peux aussi écrire : Gany te répond à voix haute.' : 'Demande à Gany… (Entrée pour envoyer)';

    // The live conversation, on top.
    ui.mount(
      els.live,
      v.live
        ? h('div.card.cv-call-card' + (v.phase ? `.${v.phase}` : ''),
            h('div.row',
              h('span.cv-wave', h('i'), h('i'), h('i'), h('i'), h('i')),
              h('div.grow', { style: { minWidth: 0 } },
                h('div.title', PHASE[v.phase] || 'En conversation'),
                h('div.small.dim.ellipsis', v.partial ? `« ${v.partial} »` : 'Dis « au revoir Gany » pour raccrocher.'),
              ),
              svgBtn(h, 'danger', SVG.hang, 'Raccrocher', { onclick: () => ui.action('live', { on: false }) }),
            ),
          )
        : null,
    );

    // A voice problem (Windows settings, Piper), or Piper being installed.
    ui.mount(
      els.alertBox,
      v.error
        ? h('div.card', { style: { borderColor: 'rgba(240,97,109,.35)', marginBottom: '8px' } },
            h('div.small', { style: { color: '#FFB3BA' } }, v.error.text),
            v.error.help ? h('div.small.faint', { style: { marginTop: '3px' } }, v.error.help) : null,
            h('div.btns.end', { style: { marginTop: '6px' } },
              v.error.fix ? h('button.btn.sm.primary', { onclick: () => ui.action('openFix', { url: v.error.fix.url }) }, v.error.fix.label) : null,
              h('button.btn.sm.ghost', { onclick: () => ui.action('clearVoiceError') }, 'OK'),
            ),
          )
        : v.install
          ? h('div.card.small.dim', { style: { marginBottom: '8px' } }, `Installation : ${v.install.step} · ${Math.round((v.install.ratio || 0) * 100)} %`)
          : null,
    );

    // Attachments waiting for the next question.
    const atts = st.attachments || [];
    els.hasFiles = atts.length > 0;
    ui.mount(
      els.files,
      atts.map((a) =>
        h('span.cv-file', { title: a.path },
          a.thumb ? h('img', { src: a.thumb, alt: '' }) : h('span', '📎'),
          h('span.ellipsis', a.name),
          h('button', { title: 'Retirer', onclick: () => ui.action('detach', { path: a.path }) }, '×'),
        ),
      ),
    );

    const msgs = st.messages || [];
    const last = msgs[msgs.length - 1];
    const sig = `${msgs.length}|${last?.text?.length}|${last?.pending}|${last?.tool}|${last?.error}|${last?.interrupted}`;
    if (sig !== els.lastText) {
      els.lastText = sig;
      els.log.replaceChildren(
        ...(msgs.length
          ? msgs.map((m) =>
              m.role === 'user'
                ? h('div.card', { style: { background: 'var(--card-2)', marginLeft: '60px' } },
                    h('div.small', m.voice ? h('span.cv-said', '🎙 ') : null, m.text),
                    m.files?.length ? h('div.faint.small', `📎 ${m.files.join(', ')}`) : null,
                  )
                : h('div.card',
                    m.text ? markdown(m.text) : null,
                    m.interrupted ? h('div.faint.small', '(interrompu)') : null,
                    m.pending ? h('div.faint.small', m.tool ? `Gany ${m.tool}…` : 'Gany réfléchit…') : null,
                    m.error ? h('div.small', { style: { color: '#FF9AA3' } }, m.error, m.auth ? h('button.btn.sm', { style: { marginLeft: '8px' }, onclick: () => ui.action('login') }, 'Se connecter') : null) : null,
                  ),
            )
          : [h('div.empty', 'Pose une question : un mot à reformuler, un mail à résumer, une capture à expliquer (colle-la ici)… ou clique sur « Parler ».')]),
      );
      els.log.scrollTop = els.log.scrollHeight;
    }
    els.sendBtn.disabled = !!st.busy && !v.live;
    if (els.wasBusy && !st.busy) ui.pin(false);
    els.wasBusy = !!st.busy;
    ui.relayout();
  },
};
