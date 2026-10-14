// The address Google Chat sends its reminder mails from ("… messaged you on
// Google Chat while you were away"). Google Chat reads them as a fallback;
// Courrier leaves them to it while Google Chat is on (src/modules/mail/main.js).

const CHAT_NOTIFIER = 'chat-noreply@google.com';

module.exports = { CHAT_NOTIFIER };
