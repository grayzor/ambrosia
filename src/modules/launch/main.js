// « Confier à Claude » — start an interactive Claude Code session from the island.
//
// No tab of its own: the form (src/renderer/launch-form.js) shows up on every
// triage card (Courrier, ClickUp…) and as « Nouvelle session » in the Claude tab,
// and calls the actions below through `ambrosia.action('launch', …)`.
// Nothing starts without the « Lancer » click; the terminal itself is opened by
// ctx.launchClaude (src/main/launcher.js), Claude Desktop by launcher.launchDesktop
// (claude://code/new: the prompt waits in the app's composer). Pure logic: ./logic.js.

const fs = require('fs');
const os = require('os');
const launcher = require('../../main/launcher');
const desktop = require('../../main/claude-desktop');
const L = require('./logic');

module.exports = {
  id: 'launch',
  name: 'Sessions Claude',
  icon: '▶',
  color: '#E08A5F',
  order: 11,
  settings: [
    { key: 'target', label: 'Lancer dans', type: 'select', default: 'auto', options: L.TARGETS, help: 'Claude Desktop : le prompt arrive dans l’onglet Code, tu l’envoies depuis l’app (modèle, mode et worktree s’y choisissent). Terminal : une session claude dans Windows Terminal.' },
    { key: 'repos', label: 'Dépôts connus (un chemin complet par ligne)', type: 'list', default: [], help: 'Proposés dans « Confier à Claude », avec les dossiers des sessions Claude Code récentes.' },
    { key: 'model', label: 'Modèle par défaut', type: 'select', default: 'opus', options: launcher.MODELS },
    { key: 'worktree', label: 'Proposer un worktree isolé (dépôts git)', type: 'boolean', default: true },
    {
      key: 'permissionMode',
      label: 'Mode de permission par défaut',
      type: 'select',
      default: '',
      options: [['', 'Celui de tes réglages Claude Code'], ['plan', 'Plan d’abord (plan)']],
    },
  ],

  init(ctx) {
    const data = ctx.data.load({ lastRepo: '', lastModel: '', history: [], settingsModel: '' });
    data.history ||= [];
    const isDir = (p) => {
      try {
        return fs.statSync(p).isDirectory();
      } catch {
        return false;
      }
    };

    // A new default model in Réglages wins over the last one picked in the form.
    const syncModel = () => {
      const m = ctx.settings().model;
      if (m !== data.settingsModel) {
        data.settingsModel = m;
        data.lastModel = '';
        ctx.data.save(data);
      }
    };
    syncModel();
    ctx.onSettings(syncModel);

    function repos() {
      const sessions = ctx.peers()?.claude?.sessions;
      return L.repoChoices({ known: ctx.settings().repos, sessions, history: data.history, last: data.lastRepo }).filter(isDir);
    }

    ctx.onAction('options', async ({ item, source, resume } = {}) => {
      const home = os.homedir();
      // « Continuer » / « Question à côté » on a Claude session card: its own folder, its own model by default.
      // A resumed CLI session always reopens in the terminal (`--resume`).
      if (resume?.sessionId) {
        const cwd = launcher.normDir(resume.cwd);
        return {
          cli: !!require('../../main/claude').locate(),
          desktop: false,
          target: 'terminal',
          resume: { sessionId: String(resume.sessionId), fork: !!resume.fork, project: String(resume.project || ''), exists: !!cwd && isDir(cwd) },
          repos: cwd ? [{ path: cwd, label: L.repoLabel(cwd, home), git: false }] : [],
          models: [['', 'Celui de la session'], ...launcher.MODELS],
          modes: [['', 'Tes réglages habituels'], ['plan', 'Plan d’abord']],
          worktreePref: false,
          defaults: { repo: cwd, model: '', worktree: false, permissionMode: '' },
          prompt: '',
          title: String(resume.title || ''),
        };
      }
      const list = repos();
      const hasDesktop = await desktop.available().catch(() => false);
      return {
        cli: !!require('../../main/claude').locate(),
        desktop: hasDesktop,
        maxLinkPrompt: desktop.MAX_Q,
        target: L.pickTarget(ctx.settings().target, hasDesktop),
        repos: list.map((p) => ({ path: p, label: L.repoLabel(p, home), git: launcher.isGitDir(p) })),
        models: launcher.MODELS,
        modes: [['', 'Tes réglages habituels'], ['plan', 'Plan d’abord']],
        worktreePref: ctx.settings().worktree !== false,
        defaults: L.defaults({ settings: ctx.settings(), data, repos: list, isGit: launcher.isGitDir }),
        prompt: item ? L.contextPrompt(item, source) : '',
        title: item ? L.titleOf(item) : '',
      };
    });

    ctx.onAction('probe', ({ path } = {}) => {
      const p = launcher.normDir(path);
      return { path: p, exists: !!p && isDir(p), git: !!p && launcher.isGitDir(p) };
    });

    // Claude Desktop: the app gets the folder and the prompt; Gany greets the session when it starts.
    const runDesktop = (o) =>
      launcher.launchDesktop({ cwd: o.cwd, prompt: o.prompt, title: o.title || '', onStart: () => ctx.react('greet', 2600, { sound: 'greet' }) });

    ctx.onAction('launch', async (o = {}) => {
      const run = o.target === 'desktop' && !o.resume ? runDesktop : ctx.launchClaude || launcher.launch;
      const res = await run({
        cwd: o.cwd,
        model: o.model,
        prompt: o.prompt,
        worktree: !!o.worktree,
        permissionMode: o.permissionMode || '',
        title: o.title || '',
        resume: o.resume || '',
        fork: !!o.fork,
      });
      if (res.ok && o.resume) {
        /* a resumed session: the form's last choices stay those of new sessions */
      } else if (res.ok) {
        const cwd = launcher.normDir(o.cwd);
        data.lastRepo = cwd;
        if (o.target !== 'desktop') data.lastModel = o.model || ''; // the app picks its own model
        data.history = [cwd, ...data.history.filter((h) => h.toLowerCase() !== cwd.toLowerCase())].slice(0, 10);
        ctx.data.save(data);
      } else {
        ctx.log('launch refused:', res.error);
      }
      return res;
    });

    ctx.setState({});
  },
};
