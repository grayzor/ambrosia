# Ambrosia - first install of the published version (then it updates itself).
#
#   irm https://github.com/grayzor/ambrosia/releases/latest/download/install.ps1 | iex
#
# Same layout as the updater (src/main/update-logic.js):
#   %LOCALAPPDATA%\Ambrosia\app\<version>\   Ambrosia.exe + resources\app
#   %LOCALAPPDATA%\Ambrosia\app\current      junction to the version in use
# plus a Start menu shortcut. No admin rights. ASCII only: Windows PowerShell 5.1
# reads a script file without BOM in the ANSI code page.

param(
  [string]$Feed = 'https://github.com/grayzor/ambrosia/releases/latest/download'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$home_ = Join-Path $env:LOCALAPPDATA 'Ambrosia\app'
$tmp = Join-Path $env:LOCALAPPDATA 'Ambrosia\updates'
New-Item -ItemType Directory -Force -Path $home_, $tmp | Out-Null

Write-Host 'Ambrosia : recherche de la derniere version...'
$m = Invoke-RestMethod -UseBasicParsing -Uri "$Feed/latest.json"
$v = [string]$m.version
if ($v -notmatch '^\d+\.\d+\.\d+$') { throw "Version invalide dans latest.json : $v" }
$asset = $m.assets.full
if ($asset.name -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*\.zip$') { throw 'Nom de fichier invalide dans latest.json' }

# The releases of version $v (not "latest": the manifest and the zip must match).
$base = $Feed -replace '/latest/download$', "/download/v$v"
$zip = Join-Path $tmp $asset.name
Write-Host "Telechargement d'Ambrosia $v ($([math]::Round($asset.size / 1MB)) Mo)..."
Invoke-WebRequest -UseBasicParsing -Uri "$base/$($asset.name)" -OutFile $zip
$sha = (Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash.ToLower()
if ($sha -ne ([string]$asset.sha256).ToLower()) { Remove-Item -Force $zip; throw 'Empreinte SHA-256 differente de celle du manifeste : fichier rejete.' }

$dir = Join-Path $home_ $v
$partial = "$dir.partial"
if (-not (Test-Path (Join-Path $dir 'Ambrosia.exe'))) {
  if (Test-Path $partial) { Remove-Item -Recurse -Force $partial }
  New-Item -ItemType Directory -Force -Path $partial | Out-Null
  $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
  if (Test-Path $tar) { & $tar -xf $zip -C $partial; if ($LASTEXITCODE) { throw 'Decompression impossible' } }
  else { Expand-Archive -LiteralPath $zip -DestinationPath $partial -Force }
  $pkg = Get-Content -Raw -LiteralPath (Join-Path $partial 'resources\app\package.json') | ConvertFrom-Json
  if ($pkg.version -ne $v -or -not (Test-Path (Join-Path $partial 'Ambrosia.exe'))) { throw 'Version incomplete' }
  if (Test-Path $dir) { Remove-Item -Recurse -Force $dir }
  Rename-Item -LiteralPath $partial -NewName $v
}
Remove-Item -Force $zip

# An Ambrosia already running (the sources, or an older install) holds the single
# instance: it has to go before the new one starts.
$running = @(Get-CimInstance Win32_Process -Filter "Name='Ambrosia.exe' or Name='electron.exe'" | Where-Object { $_.CommandLine -like '*mbrosia*' -and $_.CommandLine -notlike '*--type=*' })
if ($running.Count) {
  $answer = Read-Host 'Ambrosia tourne deja. La fermer pour lancer la nouvelle version ? [O/n]'
  if ($answer -notmatch '^[nN]') {
    $running | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 2
  }
}

$current = Join-Path $home_ 'current'
if (Test-Path $current) { [System.IO.Directory]::Delete($current) }
New-Item -ItemType Junction -Path $current -Target $dir | Out-Null

$exe = Join-Path $current 'Ambrosia.exe'
$lnk = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Ambrosia.lnk'
$s = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
$s.TargetPath = $exe
$s.WorkingDirectory = $current
$s.IconLocation = (Join-Path $current 'resources\app\assets\icon.ico') + ',0'
$s.Description = 'Ambrosia'
$s.Save()

Start-Process -FilePath $exe
Write-Host "Ambrosia $v installee dans $dir. Gany t'attend en haut de l'ecran ; les mises a jour suivantes se font seules (Reglages > Mises a jour)."
