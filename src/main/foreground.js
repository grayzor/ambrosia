// Which window has the focus? Gany glances at it when you switch apps.
//
// One small PowerShell process stays alive and prints a JSON line only when
// something changes: no polling from Node, no native module. Stopped with the
// app; restarted (with a delay) if it dies. It watches, in one loop:
//   * the foreground window (every 700 ms): 'change' (another window), 'rect'
//     (the same one moved or went full screen);
//   * SHQueryUserNotificationState (every 700 ms): 'quns' — a full-screen app,
//     game or presentation (src/main/system.js);
//   * Windows « Ne pas déranger » (every 2.5 s): 'dnd' — { reg, wnf };
//   * the primary mouse button, only while the pointer is near the island
//     (watchButton, every 60 ms): 'button' — a file drag approaching the
//     island (main.js opens the drop zone). Far from it: no button polling.

const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const log = require('./log').scope('foreground');

const SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -Namespace Amb -Name Fg -MemberDefinition @'
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
[DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vk);
[DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
[DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int state);
[DllImport("ntdll.dll")] public static extern int NtQueryWnfStateData(ref ulong name, IntPtr type, IntPtr scope, out uint stamp, byte[] buf, ref uint size);
public struct RECT { public int Left, Top, Right, Bottom; }
'@
function Say($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress)); [Console]::Out.Flush() }
$last = [IntPtr]::Zero
$lastRect = ''
$quns = -1
$dnd = ''
$btn = $null
$near = $false
$clock = [Diagnostics.Stopwatch]::StartNew()
$tick = -700
$dndTick = -2500
$alive = 0
$parent = [int]$env:AMB_PARENT
# WNF_SHEL_QUIETHOURS_ACTIVE_PROFILE_CHANGED: Focus Assist / quiet hours profile (0 = off).
$wnfName = [uint64]'0x0D83063EA3BF1C75'
$dndKey = 'HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Notifications\Settings'
# Ambrosia writes "1" while the pointer is near the island (watch the button), "0" after.
# Waiting on this read is also the loop's sleep: a "1" wakes it at once.
$in = [Console]::OpenStandardInput()
$inBuf = New-Object byte[] 64
$read = $in.ReadAsync($inBuf, 0, 64)
while ($true) {
  if ($read.IsCompleted) {
    if ($read.IsFaulted -or $read.Result -le 0) { exit }
    $near = $inBuf[$read.Result - 1] -eq 49 -or ($read.Result -ge 2 -and $inBuf[$read.Result - 2] -eq 49)
    $btn = $null
    $read = $in.ReadAsync($inBuf, 0, 64)
  }
  if ($near) {
    # The primary button (the right one when they are swapped): its state on arrival, then its changes.
    $vk = 1
    if ([Amb.Fg]::GetSystemMetrics(23)) { $vk = 2 }
    $down = ([Amb.Fg]::GetAsyncKeyState($vk) -band 0x8000) -ne 0
    if ($down -ne $btn) { $btn = $down; Say @{ k = 'btn'; down = $down } }
  }
  $now = $clock.ElapsedMilliseconds
  if ($now - $tick -ge 700) {
    $tick = $now
    # Ambrosia gone (even killed hard): stop too, never linger. Its closed pipe says so at
    # once (the read above); this costlier check only now and then, in case.
    if ($now - $alive -ge 10000) {
      $alive = $now
      if ($parent -and -not (Get-Process -Id $parent -ErrorAction SilentlyContinue)) { exit }
    }
    $h = [Amb.Fg]::GetForegroundWindow()
    $r = New-Object Amb.Fg+RECT
    [void][Amb.Fg]::GetWindowRect($h, [ref]$r)
    $rect = "$($r.Left),$($r.Top),$($r.Right),$($r.Bottom)"
    if ($h -ne $last) {
      $last = $h
      $lastRect = $rect
      $sb = New-Object System.Text.StringBuilder 256
      [void][Amb.Fg]::GetWindowText($h, $sb, 256)
      $owner = [uint32]0
      [void][Amb.Fg]::GetWindowThreadProcessId($h, [ref]$owner)
      Say @{ title = $sb.ToString(); pid = $owner; x = $r.Left; y = $r.Top; w = $r.Right - $r.Left; h = $r.Bottom - $r.Top }
    } elseif ($rect -ne $lastRect) {
      $lastRect = $rect
      Say @{ k = 'rect'; x = $r.Left; y = $r.Top; w = $r.Right - $r.Left; h = $r.Bottom - $r.Top }
    }
    $s = 0
    if ([Amb.Fg]::SHQueryUserNotificationState([ref]$s) -eq 0 -and $s -ne $quns) { $quns = $s; Say @{ k = 'quns'; state = $s } }
  }
  if ($now - $dndTick -ge 2500) {
    $dndTick = $now
    $reg = [Microsoft.Win32.Registry]::GetValue($dndKey, 'NOC_GLOBAL_SETTING_TOASTS_ENABLED', $null)
    if ($null -eq $reg) { $reg = -1 }
    $buf = New-Object byte[] 4
    $size = [uint32]4
    $stamp = [uint32]0
    $n = $wnfName
    $wnf = -1
    if ([Amb.Fg]::NtQueryWnfStateData([ref]$n, [IntPtr]::Zero, [IntPtr]::Zero, [ref]$stamp, $buf, [ref]$size) -eq 0 -and $size -ge 4) { $wnf = [BitConverter]::ToInt32($buf, 0) }
    $key = "$reg/$wnf"
    if ($key -ne $dnd) { $dnd = $key; Say @{ k = 'dnd'; reg = [int]$reg; wnf = $wnf } }
  }
  $wait = 700
  if ($near) { $wait = 60 }
  [void]$read.Wait($wait)
}
`;

class Foreground extends EventEmitter {
  constructor() {
    super();
    this.current = null; // { pid, title, at, x, y, w, h } — physical pixels
    this.quns = null; // SHQueryUserNotificationState (src/main/system.js → QUNS)
    this.dnd = null; // { reg, wnf }
    this.button = false;
  }

  start() {
    if (this.child) return;
    this.stopped = false;
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore'],
      env: { ...process.env, AMB_PARENT: String(process.pid) },
    });
    this.child = child;
    this.near = false;
    child.stdin.on('error', () => {}); // the watcher died: 'exit' restarts it
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const row = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        let w;
        try {
          w = JSON.parse(row);
        } catch {
          continue; // partial line
        }
        this.line(w);
      }
    });
    child.on('exit', () => {
      this.child = null;
      if (!this.stopped) {
        log('watcher exited, restarting in 30 s');
        setTimeout(() => this.start(), 30000).unref();
      }
    });
  }

  /** Watch the mouse button (pointer near the island) or stop. Its state comes first, then its changes. */
  watchButton(on) {
    if (!this.child || this.near === !!on) return;
    this.near = !!on;
    if (!on) this.button = false;
    this.child.stdin.write(on ? '1\n' : '0\n');
  }

  /** One line of the watcher. */
  line(w) {
    switch (w.k) {
      case 'btn':
        this.button = !!w.down;
        return this.emit('button', this.button);
      case 'quns':
        this.quns = Number(w.state);
        return this.emit('quns', this.quns);
      case 'dnd':
        this.dnd = { reg: Number(w.reg), wnf: Number(w.wnf) };
        log('ne pas déranger', JSON.stringify(this.dnd));
        return this.emit('dnd', this.dnd);
      case 'rect':
        if (!this.current) return;
        Object.assign(this.current, { x: w.x, y: w.y, w: w.w, h: w.h });
        return this.emit('rect', this.current);
      default:
        // Which process owns the window in front (the claude module compares it with a session's terminal).
        this.current = { pid: Number(w.pid) || 0, title: w.title || '', at: Date.now(), x: w.x, y: w.y, w: w.w, h: w.h };
        // Physical pixels: the caller converts with screen.screenToDipRect.
        if (w.w > 0 && w.h > 0) this.emit('change', w);
    }
  }

  stop() {
    this.stopped = true;
    this.child?.kill();
    this.child = null;
  }
}

module.exports = new Foreground();
