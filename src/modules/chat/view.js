// Chat panel. Uses mount/update so the text field survives every streamed token.

let els = null;

export default {
  summary(st) {
    return st.busy ? { dots: [{ color: '#B79CFF', pulse: true }], text: 'Gany réfléchit à ta question…' } : null;
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
    });
    const log = h('div.list', { style: { maxHeight: '300px', overflowY: 'auto', marginBottom: '8px' } });
    const sendBtn = h('button.btn.primary.sm', { onclick: () => send() }, 'Envoyer');
    const resetBtn = h('button.btn.ghost.sm', { onclick: () => ui.action('reset') }, 'Nouvelle conversation');
    const send = async () => {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      ui.sound.play('send');
      ui.pin(true);
      await ui.action('send', { text });
    };
    root.append(log, input, h('div.btns.end', { style: { marginTop: '6px' } }, resetBtn, sendBtn));
    els = { log, input, sendBtn, count: -1, lastText: '' };
    setTimeout(() => input.focus(), 50);
  },

  update(root, st, ui) {
    if (!els) return;
    const { h, markdown } = ui;
    const msgs = st.messages || [];
    const last = msgs[msgs.length - 1];
    const sig = `${msgs.length}|${last?.text?.length}|${last?.pending}|${last?.tool}|${last?.error}`;
    if (sig === els.lastText) return;
    els.lastText = sig;
    els.log.replaceChildren(
      ...(msgs.length
        ? msgs.map((m) =>
            m.role === 'user'
              ? h('div.card', { style: { background: 'var(--card-2)', marginLeft: '60px' } }, h('div.small', m.text))
              : h('div.card',
                  m.text ? markdown(m.text) : null,
                  m.pending ? h('div.faint.small', m.tool ? `Gany ${m.tool}…` : 'Gany réfléchit…') : null,
                  m.error ? h('div.small', { style: { color: '#FF9AA3' } }, m.error, m.auth ? h('button.btn.sm', { style: { marginLeft: '8px' }, onclick: () => ui.action('login') }, 'Se connecter') : null) : null,
                ),
          )
        : [h('div.empty', 'Pose une question : un mot à reformuler, un mail à résumer, une info à chercher…')]),
    );
    els.log.scrollTop = els.log.scrollHeight;
    els.sendBtn.disabled = !!st.busy;
    if (els.wasBusy && !st.busy) ui.pin(false);
    els.wasBusy = !!st.busy;
    ui.relayout();
  },
};
