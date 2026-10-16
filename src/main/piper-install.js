// Piper (neural text-to-speech, offline) for Gany's voice in a live conversation.
// Installed on demand from Réglages → Demander, never at startup:
//   %LOCALAPPDATA%\Ambrosia\piper\piper\piper.exe     the program (GitHub rhasspy/piper)
//   %LOCALAPPDATA%\Ambrosia\piper\voices\<id>.onnx     the voices (Hugging Face rhasspy/piper-voices)
// Every file is checked against a pinned hash before it is kept: a download that
// does not match is thrown away.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const paths = require('./paths');

const ROOT = path.join(paths.local, 'piper');
const EXE = path.join(ROOT, 'piper', 'piper.exe');
const VOICES_DIR = path.join(ROOT, 'voices');

const PROGRAM = {
  url: 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip',
  size: 22477236,
  sha256: 'f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea',
};

const HF = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/fr/fr_FR';
/** French voices. `speaker`: multi-speaker models (UPMC: 0 Jessica, 1 Pierre). */
const VOICES = {
  'fr_FR-tom-medium': { label: 'Tom (homme)', dir: 'tom/medium', size: 63511038, sha256: 'bf65074ccdeeeeaa832e75edb1c0a513c01c9a972bdf085ff8a6e71ea234fd41', jsonSha1: '526f2bd0757728b7e74275915025db812ef1c400' },
  'fr_FR-upmc-medium': { label: 'Pierre (homme)', dir: 'upmc/medium', speaker: 1, size: 76733615, sha256: '9abb3800c199148897a9ed64e100d224f3de83579f100044174ad19418f1786f', jsonSha1: 'ad64e0d4727318ffc0ab4caad0d02f944686ee24' },
  'fr_FR-gilles-low': { label: 'Gilles (homme, plus grave)', dir: 'gilles/low', size: 63104526, sha256: '5cd711846720e261c2a176f6924c198a7424d0a75dd4b0a5357a5fb9cb739285', jsonSha1: '5645b492bb2275d385fe96a938fd92b092615ee5' },
  'fr_FR-siwis-medium': { label: 'Siwis (femme)', dir: 'siwis/medium', size: 63201294, sha256: '641d1ab097da2b81128c076810edb052b385decc8be3381814802a64a73baf99', jsonSha1: 'ecb3b00cc2fc9e72ba9c5dcc5edeb717a05fa9aa' },
};
const DEFAULT_VOICE = 'fr_FR-tom-medium';

const voiceFile = (id) => path.join(VOICES_DIR, `${id}.onnx`);
const voiceInstalled = (id) => !!VOICES[id] && fs.existsSync(voiceFile(id)) && fs.existsSync(voiceFile(id) + '.json');

function status() {
  return {
    installed: fs.existsSync(EXE),
    exe: EXE,
    voices: Object.keys(VOICES).filter(voiceInstalled),
  };
}

/** Electron's fetch (system proxy) in the app, Node's elsewhere (tests, scripts). */
function fetcher() {
  try {
    const { net } = require('electron');
    if (net?.fetch) return net.fetch.bind(net);
  } catch {
    /* not in Electron */
  }
  return globalThis.fetch;
}

/** Downloads `url` to `dest` (via a .part file), reporting bytes; returns the sha256 and sha1 of git blob form. */
async function download(url, dest, size, onBytes) {
  const res = await fetcher()(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`téléchargement refusé (${res.status}) : ${url}`);
  const part = dest + '.part';
  const hash = crypto.createHash('sha256');
  const bytes = [];
  let got = 0;
  const body = Readable.fromWeb(res.body);
  body.on('data', (chunk) => {
    got += chunk.length;
    hash.update(chunk);
    if (size < 1e6) bytes.push(chunk);
    onBytes?.(got);
  });
  await pipeline(body, fs.createWriteStream(part));
  const blob = size < 1e6 ? Buffer.concat(bytes) : null;
  const sha1 = blob ? crypto.createHash('sha1').update(`blob ${blob.length}\0`).update(blob).digest('hex') : null;
  return { part, sha256: hash.digest('hex'), sha1, size: got };
}

function keep(part, dest) {
  fs.rmSync(dest, { force: true });
  fs.renameSync(part, dest);
}

function unzip(zip, dir) {
  return new Promise((resolve, reject) => {
    const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    execFile(tar, ['-xf', zip, '-C', dir], { windowsHide: true, timeout: 120000 }, (err) => (err ? reject(err) : resolve()));
  });
}

/**
 * Installs what is missing: the program, then the voice. `onProgress({ step, ratio })`.
 * Resolves to { ok, voice } or { ok: false, error }.
 */
async function install(voice = DEFAULT_VOICE, onProgress = () => {}) {
  const v = VOICES[voice];
  if (!v) return { ok: false, error: `voix inconnue : ${voice}` };
  try {
    fs.mkdirSync(VOICES_DIR, { recursive: true });
    if (!fs.existsSync(EXE)) {
      onProgress({ step: 'Programme Piper', ratio: 0 });
      const zip = path.join(ROOT, 'piper_windows_amd64.zip');
      const got = await download(PROGRAM.url, zip, PROGRAM.size, (n) => onProgress({ step: 'Programme Piper', ratio: n / PROGRAM.size }));
      if (got.sha256 !== PROGRAM.sha256) {
        fs.rmSync(got.part, { force: true });
        throw new Error('le programme téléchargé ne correspond pas à la version attendue');
      }
      keep(got.part, zip);
      await unzip(zip, ROOT);
      fs.rmSync(zip, { force: true });
      if (!fs.existsSync(EXE)) throw new Error('piper.exe introuvable après extraction');
    }
    if (!voiceInstalled(voice)) {
      const base = `${HF}/${v.dir}/${voice}`;
      const json = await download(`${base}.onnx.json?download=true`, voiceFile(voice) + '.json', 5000);
      if (json.sha1 !== v.jsonSha1) {
        fs.rmSync(json.part, { force: true });
        throw new Error('la description de la voix ne correspond pas');
      }
      const model = await download(`${base}.onnx?download=true`, voiceFile(voice), v.size, (n) => onProgress({ step: `Voix ${v.label}`, ratio: n / v.size }));
      if (model.sha256 !== v.sha256) {
        fs.rmSync(model.part, { force: true });
        fs.rmSync(json.part, { force: true });
        throw new Error('la voix téléchargée ne correspond pas à la version attendue');
      }
      keep(json.part, voiceFile(voice) + '.json');
      keep(model.part, voiceFile(voice));
    }
    onProgress({ step: 'Prêt', ratio: 1 });
    return { ok: true, voice };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** Removes Piper and every voice. */
function uninstall() {
  fs.rmSync(ROOT, { recursive: true, force: true });
}


module.exports = { VOICES, DEFAULT_VOICE, EXE, VOICES_DIR, voiceFile, voiceInstalled, status, install, uninstall };
