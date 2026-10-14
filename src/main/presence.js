// "Am I in a call right now?" — read locally, nothing leaves the machine.
//
// Two signals, from one short PowerShell run:
//   * mic   — apps currently using the microphone, from Windows' privacy store
//             (CapabilityAccessManager\ConsentStore\microphone: LastUsedTimeStop is 0
//             while in use). Meet keeps the mic open even when muted, so a browser
//             holding the mic is a reliable "in a call".
//   * titles — visible window titles that look like a call ("Meet - <title>",
//             Teams, Zoom), to tell back-to-back meetings apart.
//
// Callers poll this only around meetings (a few minutes per meeting), never all day.

const { execFile } = require('child_process');

const SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$base = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone'
$keys = @(Get-ChildItem "$base\NonPackaged") + @(Get-ChildItem $base | Where-Object { $_.PSChildName -ne 'NonPackaged' })
$mic = @()
foreach ($k in $keys) {
  $p = Get-ItemProperty $k.PSPath
  if ($p.LastUsedTimeStart -and ($p.LastUsedTimeStop -eq 0 -or $p.LastUsedTimeStop -lt $p.LastUsedTimeStart)) {
    $mic += ($k.PSChildName -replace '#', '\')
  }
}
Add-Type -Namespace Amb -Name W -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
public delegate bool EnumProc(IntPtr h, IntPtr l);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
'@
$titles = New-Object System.Collections.Generic.List[string]
[Amb.W]::EnumWindows({ param($h, $l)
  if ([Amb.W]::IsWindowVisible($h)) {
    $sb = New-Object System.Text.StringBuilder 512
    [void][Amb.W]::GetWindowText($h, $sb, 512)
    $t = $sb.ToString()
    if ($t -match 'Meet|Teams|Zoom|Visioconf') { $titles.Add($t) }
  }
  return $true
}, [IntPtr]::Zero) | Out-Null
@{ mic = @($mic); titles = @($titles) } | ConvertTo-Json -Compress
`;

const BROWSERS = /\\(chrome|msedge|firefox|brave|opera|vivaldi|arc)\.exe$/i;
const CALL_APPS = /teams|zoom|webex|meet/i;

/** `{ ok, inCall, browserMic, mic:[apps], titles:[...] }` — never throws. */
function sample() {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT],
      { windowsHide: true, timeout: 15000 },
      (err, stdout) => {
        try {
          const out = JSON.parse(String(stdout).trim() || '{}');
          const mic = [].concat(out.mic || []).filter(Boolean);
          const titles = [].concat(out.titles || []).filter(Boolean);
          const browserMic = mic.some((a) => BROWSERS.test(a));
          resolve({ ok: true, mic, titles, browserMic, inCall: browserMic || mic.some((a) => CALL_APPS.test(a)) });
        } catch {
          resolve({ ok: false, mic: [], titles: [], browserMic: false, inCall: false, error: err?.message });
        }
      },
    );
  });
}

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Is the user in THIS meeting? A window titled with the meeting's name or Meet
 * code is proof; a call window for something else means "in another call";
 * otherwise an open browser mic counts, unless another meeting is still running
 * (back-to-back: the mic then belongs to the previous one).
 */
function joined(event, s, otherRunning = false) {
  if (!s?.ok) return false;
  const code = (String(event.meetUrl || '').match(/[a-z]{3}-[a-z]{4}-[a-z]{3}/) || [])[0];
  const title = norm(event.title);
  const callTitles = s.titles.filter((t) => /meet/i.test(t));
  if (callTitles.some((t) => (code && t.includes(code)) || (title.length > 3 && norm(t).includes(title)))) return true;
  if (!s.inCall) return false;
  return !otherRunning;
}

module.exports = { sample, joined, norm };
