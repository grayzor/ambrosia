// Windows Runtime (OCR, speech) from Node without a native module: small Windows
// PowerShell 5.1 scripts. PowerShell 7 cannot load WinRT types, so it is always
// powershell.exe. Scripts are written once to %LOCALAPPDATA%\Ambrosia\ps and run
// with -File (no quoting of a long -Command line, no encoding surprises).
//
//   * PRELUDE: UTF-8 console, and `Await $op ([Type])` for an IAsyncOperation.
//   * compileCs(): a C# helper compiled on the fly (csc of .NET Framework) when a
//     WinRT event is needed: PowerShell cannot subscribe to WinRT events, C# can.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const paths = require('./paths');

const dir = path.join(paths.local, 'ps');

const PRELUDE = String.raw`
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch {}
try { [Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false } catch {}
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$script:asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation${'`'}1' })[0]
function Await($op, [Type]$type) {
  $task = $script:asTask.MakeGenericMethod($type).Invoke($null, @($op))
  [void]$task.Wait(-1)
  $task.Result
}
function Root-Error($err) {
  $e = $err.Exception
  while ($e.InnerException) { $e = $e.InnerException }
  $e
}
`;

/**
 * PowerShell that compiles `$cs` (a here-string defined before) against the given
 * WinRT metadata files (e.g. 'Windows.Media') and leaves the assembly in `$asm`.
 * On a compile error: one JSON line { k: 'error', code: 'compile', msg } and exit 3.
 */
function compileCs(winmds) {
  return String.raw`
$wm = Join-Path $env:windir 'System32\WinMetadata'
$gac = Join-Path $env:windir 'Microsoft.NET\assembly\GAC_MSIL'
$cp = New-Object System.CodeDom.Compiler.CompilerParameters
foreach ($w in @(${winmds.map((w) => `'${w}'`).join(', ')})) { [void]$cp.ReferencedAssemblies.Add((Join-Path $wm "$w.winmd")) }
foreach ($a in @('System.Runtime', 'System.Runtime.InteropServices.WindowsRuntime')) {
  $f = Get-ChildItem (Join-Path $gac "$a\*\$a.dll") | Select-Object -First 1
  [void]$cp.ReferencedAssemblies.Add($f.FullName)
}
$cp.GenerateInMemory = $true
$built = (New-Object Microsoft.CSharp.CSharpCodeProvider).CompileAssemblyFromSource($cp, $cs)
if ($built.Errors.HasErrors) {
  $msg = ($built.Errors | Where-Object { -not $_.IsWarning } | ForEach-Object { $_.ErrorText }) -join ' | '
  [Console]::Out.WriteLine((@{ k = 'error'; code = 'compile'; msg = $msg } | ConvertTo-Json -Compress))
  exit 3
}
$asm = $built.CompiledAssembly
`;
}

/** Writes the script once (again only when its text changed) and returns its path. */
function scriptFile(name, body) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.ps1`);
  // A BOM, so Windows PowerShell reads the script as UTF-8 (accents in messages).
  const text = '﻿' + body.replace(/\r?\n/g, '\r\n');
  let same = false;
  try {
    same = fs.readFileSync(file, 'utf8') === text;
  } catch {
    /* first run */
  }
  if (!same) fs.writeFileSync(file, text, 'utf8');
  return file;
}

/** Starts a script. `mta`: WinRT objects and their events live happily on MTA threads. */
function spawnScript(file, args = [], { mta = false } = {}) {
  const flags = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'];
  if (mta) flags.push('-Mta');
  return spawn('powershell.exe', [...flags, '-File', file, ...args.map(String)], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, AMB_PARENT: String(process.pid) },
  });
}

/** Calls `fn(line)` for every complete stdout line of a child process. */
function onLines(stream, fn) {
  let buf = '';
  stream.setEncoding('utf8');
  stream.on('data', (d) => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const row = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      if (row) fn(row);
    }
  });
}

module.exports = { PRELUDE, compileCs, scriptFile, spawnScript, onLines, dir };
