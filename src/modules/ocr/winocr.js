// Windows' own OCR (Windows.Media.Ocr): offline, fast, the languages of the user's
// profile (fr-FR, en-US here). One short PowerShell per image (see src/main/winrt.js).
//
// Small images (screenshots of a dialog) are upscaled ×2 first: the engine wants
// letters at least ~10 px tall, and a 96-dpi capture is often just under.

const { PRELUDE, scriptFile, spawnScript } = require('../../main/winrt');

const SCRIPT = PRELUDE + String.raw`
$path = $args[0]
$lang = $args[1]
[void][Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
[void][Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
[void][Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
[void][Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
function Reply($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress -Depth 6)) }
try {
  if ($lang -and $lang -ne 'auto') {
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new($lang))
  } else {
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  }
  if (-not $engine) {
    $have = ([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | ForEach-Object { $_.LanguageTag }) -join ', '
    Reply @{ ok = $false; code = 'nolang'; msg = "Pas de reconnaissance de texte pour « $lang » (installées : $have)" }
    exit
  }
  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $dec = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $w = [double]$dec.PixelWidth
  $h = [double]$dec.PixelHeight
  $max = [double][Windows.Media.Ocr.OcrEngine]::MaxImageDimension
  $big = [Math]::Max($w, $h)
  $scale = 1.0
  if ($big -le 1600) { $scale = [Math]::Min(2.0, $max / $big) } elseif ($big -gt $max) { $scale = $max / $big }
  $tf = New-Object Windows.Graphics.Imaging.BitmapTransform
  $tf.ScaledWidth = [uint32][Math]::Max(1, [Math]::Round($w * $scale))
  $tf.ScaledHeight = [uint32][Math]::Max(1, [Math]::Round($h * $scale))
  if ($scale -gt 1) { $tf.InterpolationMode = [Windows.Graphics.Imaging.BitmapInterpolationMode]::Cubic } else { $tf.InterpolationMode = [Windows.Graphics.Imaging.BitmapInterpolationMode]::Fant }
  $bmp = Await ($dec.GetSoftwareBitmapAsync([Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied, $tf, [Windows.Graphics.Imaging.ExifOrientationMode]::RespectExifOrientation, [Windows.Graphics.Imaging.ColorManagementMode]::DoNotColorManage)) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $res = Await ($engine.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])
  $lines = @()
  foreach ($line in $res.Lines) {
    $words = @()
    foreach ($wd in $line.Words) {
      $r = $wd.BoundingRect
      $words += , @($wd.Text, [Math]::Round($r.X, 1), [Math]::Round($r.Y, 1), [Math]::Round($r.Width, 1), [Math]::Round($r.Height, 1))
    }
    $lines += , @{ t = $line.Text; w = $words }
  }
  Reply @{ ok = $true; lang = $engine.RecognizerLanguage.LanguageTag; scale = $scale; width = $w; height = $h; angle = $res.TextAngle; lines = $lines }
} catch {
  $e = Root-Error $_
  Reply @{ ok = $false; code = $e.HResult; msg = $e.Message }
}
`;

/**
 * Reads the text of one image. Resolves (never rejects) to
 * `{ ok, lang, scale, width, height, lines: [{ t, w: [[text, x, y, w, h]] }] }`
 * or `{ ok: false, code, msg }`.
 */
function recognize(file, lang = 'auto', { timeoutMs = 30000 } = {}) {
  return new Promise((resolve) => {
    const child = spawnScript(scriptFile('ocr', SCRIPT), [file, lang || 'auto']);
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on('error', (e) => finish({ ok: false, code: 'spawn', msg: e.message }));
    child.on('exit', () => finish(null));
    let done = false;
    function finish(early) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (early) return resolve(early);
      const row = out.trim().split(/\r?\n/).pop() || '';
      try {
        resolve(JSON.parse(row));
      } catch {
        resolve({ ok: false, code: 'output', msg: (err || out || 'aucune réponse').trim().slice(0, 300) });
      }
    }
  });
}

module.exports = { recognize };
