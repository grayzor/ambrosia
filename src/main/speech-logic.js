// Pure logic of the voice conversation with Gany (src/main/speech.js, the chat
// module): what can be said aloud, where a sentence ends while Claude streams,
// Gany hearing himself through the speakers, and Windows' errors in words.

/** Markdown and screen-only bits out, so the voice reads what a person would say. */
function speakable(text) {
  return String(text || '')
    .replace(/```[\s\S]*?(```|$)/g, ' ') // code blocks: not for the ear
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<?https?:\/\/[^\s>)]+>?/g, 'un lien')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s*(?:[-*+•]|\d+[.)])\s+/gm, '')
    .replace(/(\*\*|__|\*|_|~~)(?=\S)([^*_~]+?)\1/g, '$2')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\|/g, ', ')
    .replace(/\p{Extended_Pictographic}️?/gu, '')
    .replace(/[ \t]*\n+[ \t]*/g, '. ')
    .replace(/\.(\s*\.)+/g, '.')
    .replace(/([!?:;,])\s*\./g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Cuts a streamed answer into sentences as they complete, so the voice starts on
 * the first one while Claude writes the rest. `push(delta)` → complete sentences;
 * `flush()` → what is left. A very long sentence is cut at a comma.
 */
class Sentences {
  constructor({ max = 240 } = {}) {
    this.buf = '';
    this.max = max;
  }

  push(delta) {
    this.buf += delta;
    const out = [];
    for (;;) {
      const m = this.buf.match(/^([\s\S]*?[.!?…]+["»)]*)(\s+|\n)/) || this.buf.match(/^([\s\S]*?)\n\s*\n/);
      if (m) {
        out.push(m[1]);
        this.buf = this.buf.slice(m[0].length);
        continue;
      }
      if (this.buf.length > this.max) {
        const cut = this.buf.lastIndexOf(', ', this.max);
        const at = cut > 40 ? cut + 1 : this.buf.lastIndexOf(' ', this.max);
        if (at > 0) {
          out.push(this.buf.slice(0, at));
          this.buf = this.buf.slice(at + 1);
          continue;
        }
      }
      break;
    }
    return out.map(speakable).filter(Boolean);
  }

  flush() {
    const rest = speakable(this.buf);
    this.buf = '';
    return rest ? [rest] : [];
  }
}

const norm = (s, min = 2) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9' ]+/g, ' ')
    .split(/[\s']+/)
    .filter((w) => w.length >= min);

const STOP_WORDS = new Set(['stop', 'attends', 'attend', 'arrete', 'chut', 'pardon', 'gany', 'silence', 'tais']);

/**
 * Is what the microphone heard just Gany's own voice coming out of the speakers?
 * True when most of its words are words Gany is saying. A headset never echoes;
 * on speakers this keeps Gany from interrupting himself.
 */
function isEcho(heard, spoken) {
  const words = norm(heard);
  if (!words.length) return true;
  const said = new Set(norm(spoken));
  if (!said.size) return false;
  const foreign = words.filter((w) => !said.has(w));
  // « Attends », « stop » cut in at once; otherwise two foreign words are needed,
  // a single odd word is more often Gany misheard than the user.
  if (foreign.some((w) => STOP_WORDS.has(w))) return false;
  return foreign.length < 2 || 1 - foreign.length / words.length >= 0.6;
}

/** « Au revoir Gany », « merci c'est tout », « stop » : the end of the conversation. */
function isGoodbye(text) {
  const t = norm(text, 1).join(' ');
  return /^(?:(?:merci|ok|bon|alors|bien|parfait)\s+)*(?:au revoir|bye|bye bye|salut|a plus|a bientot|bonne journee|bonne soiree|c est tout|ce sera tout|ca sera tout|termine|on arrete|arrete|stop|fin de la conversation|raccroche)(?:\s+gany|\s+merci)*$/.test(t);
}

/** Windows speech errors (HRESULT, or a SpeechRecognitionResultStatus) in words, with the fix. */
function explainListenError(code, msg = '') {
  const hex = typeof code === 'number' ? (code >>> 0).toString(16).toUpperCase() : String(code || '');
  if (hex === '80045509' || /privacy policy/i.test(msg)) {
    return {
      text: 'Windows demande ton accord pour la reconnaissance vocale en ligne.',
      fix: { label: 'Ouvrir le réglage', url: 'ms-settings:privacy-speech' },
      help: 'Paramètres → Confidentialité et sécurité → Voix → « Reconnaissance vocale en ligne ».',
    };
  }
  if (hex === '80070005' || /access.*denied|refus/i.test(msg)) {
    return { text: 'Windows refuse l’accès au micro aux applications de bureau.', fix: { label: 'Ouvrir le réglage', url: 'ms-settings:privacy-microphone' } };
  }
  if (hex === 'MicrophoneUnavailable' || hex === '8004503A' || /microphone/i.test(msg)) {
    return { text: 'Aucun micro disponible (débranché, ou pris par une autre application).', fix: { label: 'Réglages du son', url: 'ms-settings:sound' } };
  }
  if (hex === 'NetworkFailure') return { text: 'La reconnaissance vocale de Windows ne joint pas ses serveurs (réseau).' };
  if (hex === 'TopicLanguageNotSupported' || hex === 'GrammarLanguageMismatch') {
    return { text: 'Cette langue n’est pas installée pour la reconnaissance vocale.', fix: { label: 'Langues de Windows', url: 'ms-settings:regionlanguage' } };
  }
  if (hex === 'compile') return { text: 'Windows n’a pas pu préparer l’écoute (compilateur .NET bloqué ?).', help: msg };
  return { text: `L’écoute s’est arrêtée${msg ? ` : ${String(msg).replace(/\s+/g, ' ').slice(0, 140)}` : ` (${hex || 'erreur inconnue'})`}.` };
}

/** What Gany is told when the conversation is spoken. */
const VOICE_RULES = `Conversation vocale en direct, comme au téléphone : l'utilisateur te parle à voix haute (transcription automatique, il peut y avoir des erreurs : devine le sens) et entend ta réponse lue par une voix de synthèse.
Réponds comme on parle : une à trois phrases courtes, en français, sans markdown, sans liste, sans emoji, sans lien ni adresse, les nombres et les heures écrits pour être dits.
Si tu dois chercher quelque chose, dis-le en quelques mots avant. S'il te coupe la parole, enchaîne sur ce qu'il dit.`;

module.exports = { speakable, Sentences, isEcho, isGoodbye, explainListenError, VOICE_RULES, norm };
