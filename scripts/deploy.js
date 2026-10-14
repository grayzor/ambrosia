// Deploys Ambrosia on this machine, straight from the repository folder:
//   * Start menu shortcut "Ambrosia" (electron.exe + this folder, Gany's icon);
//   * launch at Windows sign-in (registered by the app itself, Réglages → Général);
//   * the `ambrosia-notify` command in %LOCALAPPDATA%\Ambrosia\bin (Réglages → Scripts);
//   * stops any running instance and starts the fresh one.
//
// There is no build step: editing the code and choosing "Redémarrer" in the tray
// menu is enough to ship a change.
//
//   npm run deploy            install / update and launch
//   npm run undeploy          remove the shortcut and the sign-in entry, stop the app

const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ELECTRON = require('electron'); // path of electron.exe when required from Node
const remove = process.argv.includes('--remove');
const startMenu = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Ambrosia.lnk');
const icon = path.join(ROOT, 'assets', 'icon.ico');

function ps(script) {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' });
}

function stopRunning() {
  // Only this repository's electron.exe (its path is inside the folder), never another Electron app.
  const script = `Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -like '*${ROOT.replace(/'/g, "''")}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  try {
    ps(script);
  } catch {
    /* nothing running */
  }
}

function shortcut(target) {
  const q = (s) => s.replace(/'/g, "''");
  ps(
    `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${q(target)}');` +
      `$s.TargetPath='${q(ELECTRON)}';$s.Arguments='"${q(ROOT)}"';$s.WorkingDirectory='${q(ROOT)}';` +
      `$s.IconLocation='${q(icon)},0';$s.Description='Ambrosia — Gany, l''échanson des dieux';$s.Save()`,
  );
}

if (remove) {
  stopRunning();
  if (fs.existsSync(startMenu)) fs.unlinkSync(startMenu);
  try {
    ps(`Remove-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name 'fr.grayzor.ambrosia' -ErrorAction SilentlyContinue`);
  } catch {
    /* not registered */
  }
  console.log('Ambrosia retirée (raccourci, démarrage auto). Les hooks Claude se retirent depuis Réglages → Claude.');
  process.exit(0);
}

if (!fs.existsSync(icon)) {
  console.log('Génération des icônes…');
  execFileSync(ELECTRON, [path.join(ROOT, 'scripts', 'gen-icons.js')], { stdio: 'inherit' });
}
shortcut(startMenu);
console.log('Raccourci du menu Démarrer :', startMenu);

// The `ambrosia-notify` command for the user's scripts (Réglages → Scripts). The PATH is
// left alone: adding it is a click in Réglages.
try {
  const notify = require('../src/modules/notify/install');
  notify.ensureWrapper({ node: process.execPath });
  console.log('Commande pour tes scripts :', notify.WRAPPER);
} catch (err) {
  console.log('Commande ambrosia-notify non écrite :', err.message);
}

stopRunning();
const child = spawn(ELECTRON, [ROOT], { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: false });
child.unref();
console.log('Ambrosia lancée. Gany t’attend en haut de l’écran. (Démarrage automatique : Réglages → Général)');
