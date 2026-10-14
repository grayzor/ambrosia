// Scaffolds a new feature module:  npm run new-module -- agenda "Agenda" 📅
// Creates src/modules/<id>/main.js and view.js, ready to run. Restart Ambrosia
// (tray → Recharger) and the module shows up as a tab, with its settings page.

const fs = require('fs');
const path = require('path');

const [id, name = id, icon = '◆'] = process.argv.slice(2);
if (!id || !/^[a-z][a-z0-9-]*$/.test(id)) {
  console.error('Usage : npm run new-module -- <id-en-minuscules> ["Nom affiché"] [icône]');
  process.exit(1);
}
const dir = path.join(__dirname, '..', 'src', 'modules', id);
if (fs.existsSync(dir)) {
  console.error(`Le module ${id} existe déjà.`);
  process.exit(1);
}
fs.mkdirSync(dir, { recursive: true });

fs.writeFileSync(
  path.join(dir, 'main.js'),
  `// ${name} — describe what this module does in one sentence.

module.exports = {
  id: '${id}',
  name: ${JSON.stringify(name)},
  icon: ${JSON.stringify(icon)},
  color: '#6CB4FF',
  order: 50,
  // Rendered automatically in Réglages → ${name}. Types: boolean, number, text,
  // textarea, list (one item per line), select (options), button (action).
  settings: [
    { key: 'intervalMin', label: 'Rafraîchir toutes les (minutes)', type: 'number', default: 15 },
  ],

  init(ctx) {
    let timer = null;

    async function refresh() {
      ctx.setState({ loading: true });
      // Need AI? One headless Claude turn on the user's subscription:
      // const res = await ctx.claude.run({ prompt: '…', jsonSchema: { … } });
      // if (res.ok) use res.structured or res.text
      ctx.setState({ loading: false, items: [], updatedAt: Date.now() });
    }

    function schedule() {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        await refresh().catch((err) => ctx.log('refresh failed', err));
        schedule();
      }, Math.max(1, ctx.settings().intervalMin) * 60000);
    }

    ctx.onAction('refresh', () => refresh());
    ctx.onSettings(schedule);
    this._stop = () => clearTimeout(timer);

    refresh();
    schedule();
  },

  dispose() {
    this._stop?.();
  },
};
`,
);

fs.writeFileSync(
  path.join(dir, 'view.js'),
  `// Island panel for ${name}.

export default {
  // What the notch and the tab show. Return null to stay quiet.
  summary(st) {
    const n = (st.items || []).length;
    return n ? { badge: { text: String(n) }, count: n, text: \`\${n} élément(s)\` } : null;
  },

  render(root, st, ui) {
    const { h, ago } = ui;
    root.append(
      h('div.row', { style: { marginBottom: '8px' } },
        h('span.small.dim.grow', st.updatedAt ? \`Mis à jour \${ago(st.updatedAt)}\` : ''),
        h('button.btn.sm', { onclick: () => ui.action('refresh') }, st.loading ? '…' : 'Rafraîchir'),
      ),
    );
    const items = st.items || [];
    if (!items.length) return root.append(h('div.empty', 'Rien pour l’instant.'));
    root.append(h('div.list', items.map((it) => h('div.card', it.title))));
  },
};
`,
);

console.log(`Module créé : src/modules/${id}/ — redémarre Ambrosia (icône de la barre des tâches → Recharger).`);
