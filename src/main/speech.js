// Gany's ears and voice, for the live conversation (src/modules/chat).
//
//   listen()  Windows speech recognition (Windows.Media.SpeechRecognition, continuous
//             dictation). Text appears while you speak (hypotheses), then each phrase
//             (result). Needs « Reconnaissance vocale en ligne » on in Windows'
//             privacy settings: the audio goes to Microsoft, like Windows' own dictation.
//             A C# helper compiled on the fly, because PowerShell cannot subscribe to
//             WinRT events. Runs only while listening; the microphone is never opened
//             otherwise.
//   voice()   text → WAV. 'windows': the voices of Windows (Paul, Julie, Hortense);
//             'piper': neural voices, offline, installed from Réglages (piper-install.js).
//             One process stays alive while you talk, stopped after a few idle minutes.

const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { PRELUDE, compileCs, scriptFile, spawnScript, onLines } = require('./winrt');
const piper = require('./piper-install');
const paths = require('./paths');
const log = require('./log').scope('speech');

// ── Listening ───────────────────────────────────────────────────────────────

const LISTEN_CS = String.raw`
using System;
using System.Text;
using System.Threading;
using Windows.Foundation;
using Windows.Globalization;
using Windows.Media.SpeechRecognition;

public static class AmbListen {
  static readonly object gate = new object();

  static string Q(string s) {
    var b = new StringBuilder("\"");
    foreach (char c in s ?? "") {
      if (c == '"' || c == '\\') b.Append('\\').Append(c);
      else if (c < 32 || c > 126) b.Append("\\u").Append(((int)c).ToString("x4"));
      else b.Append(c);
    }
    return b.Append('"').ToString();
  }

  static void Emit(string json) {
    lock (gate) { Console.Out.WriteLine(json); Console.Out.Flush(); }
  }

  static void Fail(Exception e) {
    Emit("{\"k\":\"error\",\"code\":" + e.HResult + ",\"msg\":" + Q(e.Message) + "}");
  }

  static T Wait<T>(IAsyncOperation<T> op) {
    while (op.Status == AsyncStatus.Started) Thread.Sleep(5);
    if (op.Status != AsyncStatus.Completed) throw op.ErrorCode ?? new Exception(op.Status.ToString());
    return op.GetResults();
  }

  static void WaitA(IAsyncAction op) {
    while (op.Status == AsyncStatus.Started) Thread.Sleep(5);
    if (op.Status != AsyncStatus.Completed) throw op.ErrorCode ?? new Exception(op.Status.ToString());
    op.GetResults();
  }

  public static int Run(string lang, int idleSec) {
    SpeechRecognizer r;
    try { r = new SpeechRecognizer(new Language(lang)); }
    catch (Exception e) { Fail(e); return 2; }
    var done = new ManualResetEvent(false);
    var session = r.ContinuousRecognitionSession;
    session.AutoStopSilenceTimeout = TimeSpan.FromSeconds(idleSec > 0 ? idleSec : 600);
    r.HypothesisGenerated += new TypedEventHandler<SpeechRecognizer, SpeechRecognitionHypothesisGeneratedEventArgs>((s, e) => {
      Emit("{\"k\":\"hyp\",\"text\":" + Q(e.Hypothesis.Text) + "}");
    });
    r.StateChanged += new TypedEventHandler<SpeechRecognizer, SpeechRecognizerStateChangedEventArgs>((s, e) => {
      Emit("{\"k\":\"state\",\"state\":" + Q(e.State.ToString()) + "}");
    });
    session.ResultGenerated += new TypedEventHandler<SpeechContinuousRecognitionSession, SpeechContinuousRecognitionResultGeneratedEventArgs>((s, e) => {
      var res = e.Result;
      if (res.Status != SpeechRecognitionResultStatus.Success) { Emit("{\"k\":\"status\",\"status\":" + Q(res.Status.ToString()) + "}"); return; }
      if (string.IsNullOrWhiteSpace(res.Text)) return;
      Emit("{\"k\":\"result\",\"text\":" + Q(res.Text) + ",\"confidence\":" + Q(res.Confidence.ToString()) + "}");
    });
    session.Completed += new TypedEventHandler<SpeechContinuousRecognitionSession, SpeechContinuousRecognitionCompletedEventArgs>((s, e) => {
      Emit("{\"k\":\"done\",\"status\":" + Q(e.Status.ToString()) + "}");
      done.Set();
    });
    try {
      var compiled = Wait(r.CompileConstraintsAsync());
      if (compiled.Status != SpeechRecognitionResultStatus.Success) {
        Emit("{\"k\":\"error\",\"code\":" + Q(compiled.Status.ToString()) + ",\"msg\":\"\"}");
        return 3;
      }
      WaitA(session.StartAsync());
    } catch (Exception e) { Fail(e); return 4; }
    Emit("{\"k\":\"ready\"}");
    // Ambrosia's orders on stdin: pause / resume / stop (a closed pipe = stop).
    var input = new Thread(() => {
      try {
        string line;
        while ((line = Console.In.ReadLine()) != null) {
          line = line.Trim();
          try {
            if (line == "pause") { WaitA(session.PauseAsync()); Emit("{\"k\":\"paused\"}"); }
            else if (line == "resume") { session.Resume(); Emit("{\"k\":\"resumed\"}"); }
            else if (line == "stop") break;
          } catch (Exception e) { Fail(e); }
        }
      } catch (Exception) { }
      try { WaitA(session.StopAsync()); } catch (Exception) { }
      done.Set();
    });
    input.IsBackground = true;
    input.Start();
    done.WaitOne();
    return 0;
  }
}
`;

const LISTEN_PS = PRELUDE + `
$cs = @'
${LISTEN_CS}
'@
` + compileCs(['Windows.Foundation', 'Windows.Globalization', 'Windows.Media']) + String.raw`
$lang = $args[0]
$idle = [int]$args[1]
[void]$asm.GetType('AmbListen').GetMethod('Run').Invoke($null, @($lang, $idle))
`;

/**
 * Starts listening. Returns an EventEmitter:
 *   'ready' · 'hyp' (text so far) · 'result' (a finished phrase) · 'state' (Idle,
 *   Capturing, SoundStarted, SpeechDetected…) · 'error' ({ code, msg }) · 'end'.
 * Methods: pause(), resume(), stop().
 */
function listen({ lang = 'fr-FR', idleSec = 0 } = {}) {
  const ev = new EventEmitter();
  const child = spawnScript(scriptFile('listen', LISTEN_PS), [lang, idleSec], { mta: true });
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    ev.emit('end');
  };
  child.stdin.on('error', () => {});
  onLines(child.stdout, (row) => {
    let m;
    try {
      m = JSON.parse(row);
    } catch {
      return;
    }
    if (m.k === 'hyp' || m.k === 'result') ev.emit(m.k, String(m.text || ''));
    else if (m.k === 'state') ev.emit('state', m.state);
    else if (m.k === 'error') ev.emit('error', { code: m.code, msg: m.msg || '' });
    else if (m.k === 'status') ev.emit('status', m.status);
    else if (m.k === 'done') {
      if (m.status && m.status !== 'Success' && m.status !== 'UserCanceled') ev.emit('error', { code: m.status, msg: '' });
      end();
    } else if (m.k === 'ready') ev.emit('ready');
  });
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  child.on('error', (err) => ev.emit('error', { code: 'spawn', msg: err.message }));
  child.on('exit', (code) => {
    if (code && !ended && stderr) log('listen exited', code, stderr.trim().slice(0, 300));
    end();
  });
  const say = (cmd) => !ended && child.stdin.writable && child.stdin.write(cmd + '\n');
  ev.pause = () => say('pause');
  ev.resume = () => say('resume');
  ev.stop = () => {
    say('stop');
    child.stdin.end();
    setTimeout(() => !ended && child.kill(), 3000).unref();
  };
  return ev;
}

// ── Voice ───────────────────────────────────────────────────────────────────

const SPEAK_PS = PRELUDE + String.raw`
[void][Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media, ContentType = WindowsRuntime]
[void][Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
$synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
$all = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices
$inv = [Globalization.CultureInfo]::InvariantCulture
# One request per line: id <TAB> voice <TAB> pitch <TAB> rate <TAB> base64(UTF-8 text)
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $f = $line.Split([char]9)
  $id = $f[0]
  try {
    $v = $all | Where-Object { $_.DisplayName -eq $f[1] } | Select-Object -First 1
    if (-not $v) { $v = $all | Where-Object { $_.Language -eq 'fr-FR' } | Select-Object -First 1 }
    if ($v -and $synth.Voice.Id -ne $v.Id) { $synth.Voice = $v }
    $synth.Options.AudioPitch = [double]::Parse($f[2], $inv)
    $synth.Options.SpeakingRate = [double]::Parse($f[3], $inv)
    $text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($f[4]))
    $st = Await ($synth.SynthesizeTextToStreamAsync($text)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
    $reader = New-Object Windows.Storage.Streams.DataReader($st.GetInputStreamAt(0))
    $n = Await ($reader.LoadAsync([uint32]$st.Size)) ([uint32])
    $bytes = New-Object byte[] $n
    $reader.ReadBytes($bytes)
    [Console]::Out.WriteLine("ok" + [char]9 + $id + [char]9 + [Convert]::ToBase64String($bytes))
  } catch {
    $e = Root-Error $_
    [Console]::Out.WriteLine("err" + [char]9 + $id + [char]9 + ($e.Message -replace '\s+', ' '))
  }
  [Console]::Out.Flush()
}
`;

/** A long-lived synthesis process: requests in order, one answer each. */
class Engine {
  constructor(name, start) {
    this.name = name;
    this.start = start;
    this.child = null;
    this.waiting = new Map(); // id → { resolve, timer }
    this.seq = 0;
    this.idle = null;
  }

  ensure() {
    if (this.child) return this.child;
    const child = this.start();
    this.child = child;
    child.stdin.on('error', () => {});
    child.stderr?.on('data', (d) => log(`${this.name}:`, String(d).trim().slice(0, 200)));
    child.on('error', (err) => this.failAll(err.message));
    child.on('exit', () => {
      if (this.child === child) this.child = null;
      this.failAll('la voix s’est arrêtée');
    });
    return child;
  }

  failAll(msg) {
    for (const [, w] of this.waiting) {
      clearTimeout(w.timer);
      w.resolve({ ok: false, error: msg });
    }
    this.waiting.clear();
  }

  /** `line(id)` builds the request. Resolves to { ok, wav: Buffer } or { ok:false, error }. */
  request(line) {
    clearTimeout(this.idle);
    this.idle = setTimeout(() => this.stop(), 5 * 60000);
    this.idle.unref?.();
    const id = `${++this.seq}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        resolve({ ok: false, error: 'la voix met trop de temps' });
      }, 30000);
      this.waiting.set(id, { resolve, timer });
      this.ensure().stdin.write(line(id) + '\n');
    });
  }

  answer(id, res) {
    const w = this.waiting.get(id);
    if (!w) return;
    clearTimeout(w.timer);
    this.waiting.delete(id);
    w.resolve(res);
  }

  stop() {
    clearTimeout(this.idle);
    const c = this.child;
    this.child = null;
    if (c) {
      c.stdin.end();
      setTimeout(() => c.kill(), 2000).unref?.();
    }
    this.failAll('voix arrêtée');
  }
}

function windowsEngine() {
  const engine = new Engine('windows', () => {
    const child = spawnScript(scriptFile('speak', SPEAK_PS));
    onLines(child.stdout, (row) => {
      const [kind, id, rest] = row.split('\t');
      if (kind === 'ok') engine.answer(id, { ok: true, wav: Buffer.from(rest || '', 'base64') });
      else if (kind === 'err') engine.answer(id, { ok: false, error: rest || 'erreur' });
    });
    return child;
  });
  return {
    name: 'windows',
    synth(text, { voice = 'Microsoft Paul', pitch = 1, rate = 1 } = {}) {
      const b64 = Buffer.from(text, 'utf8').toString('base64');
      return engine.request((id) => [id, voice, pitch.toFixed(2), rate.toFixed(2), b64].join('\t'));
    },
    stop: () => engine.stop(),
  };
}

/** JSON for Piper's stdin, ASCII only (\u escapes): no code page can garble it. */
const asciiJson = (o) => JSON.stringify(o).replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

function piperEngine(voiceId, { rate = 1 } = {}) {
  const dir = path.join(paths.local, 'piper', 'out');
  fs.mkdirSync(dir, { recursive: true });
  const meta = piper.VOICES[voiceId] || {};
  const files = new Map(); // output file → request id
  const engine = new Engine('piper', () => {
    const args = ['--model', piper.voiceFile(voiceId), '--json-input', '--quiet', '--sentence_silence', '0.05'];
    if (meta.speaker != null) args.push('--speaker', String(meta.speaker));
    // length_scale > 1 is slower: the inverse of a speaking rate.
    args.push('--length_scale', (1 / Math.min(2.2, Math.max(0.6, rate))).toFixed(2));
    const child = spawn(piper.EXE, args, { cwd: dir, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    onLines(child.stdout, (row) => {
      const file = row.trim();
      const id = files.get(path.normalize(file));
      if (!id) return;
      files.delete(path.normalize(file));
      fs.readFile(file, (err, wav) => {
        fs.unlink(file, () => {});
        engine.answer(id, err ? { ok: false, error: err.message } : { ok: true, wav });
      });
    });
    return child;
  });
  return {
    name: 'piper',
    voiceId,
    synth(text) {
      return engine.request((id) => {
        const file = path.join(dir, `gany-${process.pid}-${id}.wav`);
        files.set(path.normalize(file), id);
        return asciiJson({ text, output_file: file });
      });
    },
    stop: () => engine.stop(),
  };
}

let current = null; // { key, engine }

/**
 * Text → WAV with the voice chosen in Réglages → Demander. Falls back on Windows'
 * voice when Piper or its voice is missing. Resolves to { ok, wav, engine } or { ok:false, error }.
 * o: { engine: 'auto'|'windows'|'piper', winVoice, piperVoice, pitch, rate }
 */
async function synth(text, o = {}) {
  // 'auto' (default): Piper once it is installed, Windows' voice until then.
  const usePiper = o.engine !== 'windows' && piper.status().installed && piper.voiceInstalled(o.piperVoice);
  const key = usePiper ? `piper:${o.piperVoice}:${o.rate || 1}` : 'windows';
  if (current?.key !== key) {
    current?.engine.stop();
    current = { key, engine: usePiper ? piperEngine(o.piperVoice, { rate: o.rate || 1 }) : windowsEngine() };
  }
  const res = await current.engine.synth(text, { voice: o.winVoice, pitch: o.pitch ?? 1, rate: o.rate ?? 1 });
  return { ...res, engine: current.engine.name };
}

function stopVoice() {
  current?.engine.stop();
  current = null;
}

module.exports = { listen, synth, stopVoice, asciiJson };
