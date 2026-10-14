// The `ambrosia-notify` command, in %LOCALAPPDATA%\Ambrosia\bin: a copy of
// hook/ambrosia-notify.js (self-contained) and a .cmd wrapper that runs it with node, or
// with Electron as node when node.exe is not in the PATH. Written by the module at
// startup and by `npm run deploy`, rewritten only when it changed. The PATH is never
// touched here: Réglages → Scripts offers it on a click.
// No Electron in this file: scripts/deploy.js loads it from plain Node.

const fs = require('fs');
const path = require('path');
const paths = require('../../main/paths');

const BIN = path.join(paths.local, 'bin');
const WRAPPER = path.join(BIN, 'ambrosia-notify.cmd');
const SOURCE = path.join(paths.ROOT, 'hook', 'ambrosia-notify.js');
const SCRIPT = path.join(BIN, 'ambrosia-notify.js');

const EXAMPLE = 'ambrosia-notify --key sauvegarde --title "Sauvegarde NAS" --text "12/40 Go" --progress 0.3';

function nodeOnPath() {
  for (const dir of (process.env.PATH || '').split(';')) {
    const p = path.join(dir.trim(), 'node.exe');
    if (dir.trim() && fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * The wrapper's text. cmd.exe reads a batch file in the OEM code page, so it holds no
 * path that could be non-ASCII: the script sits next to it (%~dp0), and node is called
 * by name when its full path is not plain ASCII. `electron`: Electron as plain node.
 */
function wrapperText({ node, electron }) {
  const ascii = (s) => /^[\x20-\x7e]+$/.test(s);
  const lines = ['@echo off', "rem Ambrosia : affiche l'avancement d'un script dans l'encoche (fichier genere, ne pas modifier)."];
  if (node) lines.push(`${ascii(node) ? `"${node}"` : 'node'} "%~dp0ambrosia-notify.js" %*`);
  else lines.push('setlocal', 'set ELECTRON_RUN_AS_NODE=1', `"${electron}" "%~dp0ambrosia-notify.js" %*`);
  return lines.join('\r\n') + '\r\n';
}

function writeIfChanged(file, bytes) {
  try {
    if (fs.readFileSync(file).equals(bytes)) return false;
  } catch {
    /* not there yet */
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  return true;
}

/** Writes the wrapper and the script copy if missing or different. → { file, changed } */
function ensureWrapper({ node = nodeOnPath(), electron = process.execPath, bin = BIN, source = SOURCE } = {}) {
  const a = writeIfChanged(path.join(bin, 'ambrosia-notify.js'), fs.readFileSync(source));
  const b = writeIfChanged(path.join(bin, 'ambrosia-notify.cmd'), Buffer.from(wrapperText({ node, electron }), 'latin1'));
  return { file: path.join(bin, 'ambrosia-notify.cmd'), changed: a || b };
}

/** Is `dir` one of the entries of a PATH string (case-insensitive, trailing slash ignored)? */
function inPath(pathValue, dir = BIN) {
  const norm = (s) => s.trim().replace(/[\\/]+$/, '').toLowerCase();
  return String(pathValue || '')
    .split(';')
    .some((p) => p.trim() && norm(p) === norm(dir));
}

/**
 * PowerShell that appends $env:AMBROSIA_BIN to the user's PATH (HKCU\Environment), keeping
 * the value's type and its %VARIABLES% unexpanded, then tells Windows (WM_SETTINGCHANGE)
 * so new terminals see it. Prints "deja" or "ajoute". Run only on a click.
 */
const ADD_TO_PATH_PS = `
$ErrorActionPreference = 'Stop'
$dir = $env:AMBROSIA_BIN
$k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
$cur = [string]$k.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
$parts = @($cur -split ';' | Where-Object { $_.Trim() -ne '' })
if ($parts | Where-Object { $_.Trim().TrimEnd('\\').ToLower() -eq $dir.TrimEnd('\\').ToLower() }) {
  $k.Close()
  'deja'
} else {
  $kind = if ($cur) { $k.GetValueKind('Path') } else { [Microsoft.Win32.RegistryValueKind]::ExpandString }
  $k.SetValue('Path', (($parts + $dir) -join ';'), $kind)
  $k.Close()
  Add-Type -Namespace Ambrosia -Name Env -MemberDefinition '[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern System.IntPtr SendMessageTimeout(System.IntPtr h, uint m, System.UIntPtr w, string l, uint f, uint t, out System.UIntPtr r);'
  $r = [System.UIntPtr]::Zero
  [void][Ambrosia.Env]::SendMessageTimeout([System.IntPtr]0xffff, 0x1A, [System.UIntPtr]::Zero, 'Environment', 2, 3000, [ref]$r)
  'ajoute'
}
`;

module.exports = { BIN, WRAPPER, SCRIPT, SOURCE, EXAMPLE, ADD_TO_PATH_PS, nodeOnPath, wrapperText, ensureWrapper, inPath };
