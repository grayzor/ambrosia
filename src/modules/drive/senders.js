// The addresses Google sends Docs / Sheets / Slides comment and sharing
// notifications from. The Drive module reads only these mails; Courrier leaves
// them to it while Drive is on (see src/modules/mail/main.js).

const COMMENTS = ['comments-noreply@docs.google.com'];
const SHARES = ['drive-shares-dm-noreply@google.com', 'drive-shares-noreply@google.com'];
const ALL = [...COMMENTS, ...SHARES];

/** Gmail query part: `from:(a OR b …)`. */
const fromQuery = (list = ALL) => `from:(${list.join(' OR ')})`;

/** Gmail query part that excludes them: `-from:a -from:b …`. */
const excludeQuery = (list = ALL) => list.map((a) => `-from:${a}`).join(' ');

module.exports = { COMMENTS, SHARES, ALL, fromQuery, excludeQuery };
