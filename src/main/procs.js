// Windows process tree: which processes a Claude Code session runs under, so
// Ambrosia can tell whether its terminal is the window in front, and bring that
// window forward on request. PowerShell only, no native module, never on the
// hook path: the relay just sends a pid (CLAUDE_PID, or its parent's).

const { execFile } = require('child_process');
const log = require('./log').scope('procs');

function powershell(script, timeout = 8000) {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => resolve(err && !stdout ? '' : String(stdout || '')),
    );
  });
}

// One snapshot of the whole table serves every lookup made within a few seconds.
// `start` = creation time as a FILETIME string (what Claude Code writes as procStart).
let snap = null;
async function table() {
  if (snap && Date.now() - snap.at < 4000) return snap.promise;
  const script = "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,@{n='Start';e={ if ($_.CreationDate) { [string]$_.CreationDate.ToFileTimeUtc() } }} | ConvertTo-Json -Compress";
  const promise = powershell(script).then((out) => {
    const map = new Map();
    try {
      for (const r of [].concat(JSON.parse(out || '[]'))) map.set(Number(r.ProcessId), { pid: Number(r.ProcessId), ppid: Number(r.ParentProcessId), name: String(r.Name || ''), start: r.Start ? String(r.Start) : '' });
    } catch (err) {
      log('process table unreadable', err.message);
    }
    return map;
  });
  snap = { at: Date.now(), promise };
  return promise;
}

/** Does a process with this pid exist? Free (no spawn), but blind to pid reuse. */
function exists(pid) {
  if (!(Number(pid) > 0)) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/** FILETIME (100 ns since 1601, as a string: too big for a double) → epoch ms. */
function filetimeMs(ft) {
  if (!/^\d{12,20}$/.test(String(ft || ''))) return 0;
  return Number(BigInt(ft) / 10000n) - 11644473600000;
}

/** [{ pid, name }] from `pid` up to the oldest ancestor still alive (pure, for tests). */
function ancestors(pid, map, max = 16) {
  const out = [];
  const seen = new Set();
  let cur = map.get(Number(pid));
  while (cur && !seen.has(cur.pid) && out.length < max) {
    seen.add(cur.pid);
    out.push({ pid: cur.pid, name: cur.name });
    if (!cur.ppid || cur.ppid === cur.pid) break;
    cur = map.get(cur.ppid);
  }
  return out;
}

/** The ancestry of a live process, or [] if it is gone. */
async function chain(pid) {
  if (!(Number(pid) > 0) || process.platform !== 'win32') return [];
  return ancestors(pid, await table());
}

// ── Windows, tabs, focus: one PowerShell for the survey and the act ─────────
//
// The script lists the visible top-level windows (EnumWindows: handle, pid,
// process, class, title) and the tabs of every Windows Terminal window (UI
// Automation: TabItem names are the tab titles), prints that as one JSON line,
// then waits on stdin for the decision Ambrosia takes in JS (session-window.js):
// { h, tab: { i, name } | null }. It selects the tab (SelectionItemPattern, only if
// the name at that index is still the expected one), brings the window forward,
// and checks that the focus really landed (GetForegroundWindow), with the
// AttachThreadInput fallback when Windows refused the plain SetForegroundWindow.

const WINDOW_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -Namespace Amb -Name Win2 -MemberDefinition @'
public delegate bool EnumProc(System.IntPtr h, System.IntPtr l);
[DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, System.IntPtr l);
[DllImport("user32.dll")] static extern bool IsWindowVisible(System.IntPtr h);
[DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr h);
[DllImport("user32.dll")] static extern System.IntPtr GetWindow(System.IntPtr h, uint cmd);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(System.IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(System.IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint pid);
[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[DllImport("user32.dll")] static extern System.IntPtr GetAncestor(System.IntPtr h, uint flags);
[DllImport("user32.dll")] static extern bool SetForegroundWindow(System.IntPtr h);
[DllImport("user32.dll")] static extern bool BringWindowToTop(System.IntPtr h);
[DllImport("user32.dll")] static extern bool ShowWindow(System.IntPtr h, int n);
[DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
[DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
[DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, System.UIntPtr extra);
public static System.Collections.Generic.List<System.IntPtr> Tops() {
  var list = new System.Collections.Generic.List<System.IntPtr>();
  EnumWindows((h, l) => { if (IsWindowVisible(h) && GetWindow(h, 4) == System.IntPtr.Zero) list.Add(h); return true; }, System.IntPtr.Zero);
  return list;
}
public static string Text(System.IntPtr h) { var s = new System.Text.StringBuilder(512); GetWindowText(h, s, 512); return s.ToString(); }
public static string Cls(System.IntPtr h) { var s = new System.Text.StringBuilder(256); GetClassName(h, s, 256); return s.ToString(); }
public static uint Pid(System.IntPtr h) { uint p; GetWindowThreadProcessId(h, out p); return p; }
static bool Front(System.IntPtr h) { var f = GetForegroundWindow(); return f == h || GetAncestor(f, 3) == h; }
static bool Landed(System.IntPtr h) { for (int i = 0; i < 8; i++) { if (Front(h)) return true; System.Threading.Thread.Sleep(40); } return false; }
public static string Focus(System.IntPtr h) {
  if (IsIconic(h)) ShowWindow(h, 9);
  if (Front(h)) return "already";
  // Windows only lets the app the user last touched take the focus: a tap on Alt unlocks it.
  keybd_event(0x12, 0, 0, System.UIntPtr.Zero);
  keybd_event(0x12, 0, 2, System.UIntPtr.Zero);
  SetForegroundWindow(h);
  if (Landed(h)) return "set";
  // Still refused: share the input queue of the window in front for a moment.
  uint p;
  uint fgThread = GetWindowThreadProcessId(GetForegroundWindow(), out p);
  uint me = GetCurrentThreadId();
  bool att = fgThread != 0 && fgThread != me && AttachThreadInput(me, fgThread, true);
  BringWindowToTop(h);
  ShowWindow(h, 5);
  SetForegroundWindow(h);
  if (att) AttachThreadInput(me, fgThread, false);
  return Landed(h) ? "attached" : "";
}
'@
$names = @{}
$wins = @()
foreach ($h in [Amb.Win2]::Tops()) {
  $title = [Amb.Win2]::Text($h)
  if (-not $title) { continue }
  $wpid = [Amb.Win2]::Pid($h)
  if (-not $names.ContainsKey($wpid)) { $names[$wpid] = (Get-Process -Id $wpid -ErrorAction SilentlyContinue).ProcessName }
  $wins += @{ h = [int64]$h; pid = [int]$wpid; proc = [string]$names[$wpid]; cls = [Amb.Win2]::Cls($h); title = $title; min = [Amb.Win2]::IsIconic($h) }
}
$A = [System.Windows.Automation.AutomationElement]
$tabCond = New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::TabItem)
$tabs = @()
foreach ($w in ($wins | Where-Object { $_.cls -eq 'CASCADIA_HOSTING_WINDOW_CLASS' })) {
  $el = $A::FromHandle([IntPtr]$w.h)
  if (-not $el) { continue }
  $i = 0
  foreach ($t in $el.FindAll([System.Windows.Automation.TreeScope]::Descendants, $tabCond)) {
    $sel = $false
    try { $sel = $t.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Current.IsSelected } catch {}
    $tabs += @{ h = $w.h; i = $i; name = $t.Current.Name; sel = $sel }
    $i++
  }
}
[Console]::Out.WriteLine((@{ fg = [int64][Amb.Win2]::GetForegroundWindow(); windows = @($wins); tabs = @($tabs) } | ConvertTo-Json -Compress -Depth 4))
[Console]::Out.Flush()
$line = [Console]::In.ReadLine()
$d = $null
try { $d = $line | ConvertFrom-Json } catch {}
if (-not $d -or -not $d.h) { [Console]::Out.WriteLine('{"ok":false}'); exit }
$h = [IntPtr][int64]$d.h
$tabOk = $null
if ($d.tab) {
  $tabOk = $false
  $el = $A::FromHandle($h)
  $all = if ($el) { $el.FindAll([System.Windows.Automation.TreeScope]::Descendants, $tabCond) } else { @() }
  if ($all.Count -gt [int]$d.tab.i) {
    $t = $all[[int]$d.tab.i]
    if ($t.Current.Name -eq $d.tab.name) {
      try { $t.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select(); $tabOk = $true } catch {}
    }
  }
}
$how = [Amb.Win2]::Focus($h)
[Console]::Out.WriteLine((@{ ok = [bool]$how; how = $how; tab = $tabOk; fg = [int64][Amb.Win2]::GetForegroundWindow() } | ConvertTo-Json -Compress))
`;

/** JSON for the script's stdin: ASCII only (\u escapes), whatever the console code page. */
const asciiJson = (v) => JSON.stringify(v).replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

/**
 * Lists windows and Windows Terminal tabs, lets `decide(survey)` pick
 * ({ h, tab } or null), then selects / focuses. Never rejects; ~1 s, 8 s at most.
 * → { ok, how: 'already' | 'set' | 'attached', tab: true | false | null, survey, decision }
 */
function focusBySurvey(decide, timeout = 8000) {
  if (process.platform !== 'win32') return Promise.resolve({ ok: false, error: 'Windows only' });
  return new Promise((resolve) => {
    const { spawn } = require('child_process');
    let child;
    try {
      // The script goes as -EncodedCommand (~14 KB of base64): stdin stays free for the decision.
      const encoded = Buffer.from(WINDOW_SCRIPT, 'utf16le').toString('base64');
      child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    } catch (err) {
      return resolve({ ok: false, error: err.message });
    }
    let out = '';
    let survey = null;
    let decision = null;
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      resolve({ survey, decision, ...r });
    };
    const timer = setTimeout(() => finish({ ok: false, error: 'délai dépassé' }), timeout);
    child.on('error', (err) => finish({ ok: false, error: err.message }));
    child.on('close', () => finish({ ok: false, error: 'PowerShell s’est arrêté' }));
    child.stdout.on('data', (chunk) => {
      out += chunk.toString('utf8');
      let nl;
      while ((nl = out.indexOf('\n')) >= 0) {
        const line = out.slice(0, nl).trim();
        out = out.slice(nl + 1);
        if (!line.startsWith('{')) continue;
        let j;
        try {
          j = JSON.parse(line);
        } catch {
          continue;
        }
        if (!survey) {
          survey = { fg: j.fg, windows: [].concat(j.windows || []), tabs: [].concat(j.tabs || []) };
          try {
            decision = decide(survey) || null;
          } catch (err) {
            log('focus decision', err);
            decision = null;
          }
          child.stdin.write(asciiJson(decision || {}) + '\n');
          child.stdin.end();
          if (!decision) finish({ ok: false });
        } else finish({ ok: !!j.ok, how: j.how || '', tab: j.tab ?? null });
      }
    });
    child.stdin.on('error', () => {}); // the script may be gone before the decision is written
  });
}

module.exports = { chain, ancestors, table, exists, filetimeMs, focusBySurvey, asciiJson };
