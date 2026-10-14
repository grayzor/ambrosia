// "Is the user in a call right now?" — for the island's « en appel » mode.
//
// The calendar says which meeting runs; presence.js (sampled only around
// meetings) confirms the user is in it. Pure: main.js feeds it the last sample.

const MIN = 60000;

/**
 * The meeting the user is in, or null.
 * @param {object} o
 * @param {object[]} o.meetings   real meetings (relevant), with ISO start / end
 * @param {Map|Set} o.joined      ids of meetings the user was seen joining
 * @param {object} o.sample       last presence.sample() ({ ok, inCall })
 * @param {number} o.sampledAt    when it was taken
 * @param {number} o.now
 * @param {string|null} o.current id of the meeting we already consider "in call"
 */
function currentCall({ meetings, joined, sample, sampledAt, now, current = null }) {
  const fresh = !!sample?.ok && now - sampledAt < 3 * MIN;
  const live = fresh && !!sample.inCall;
  const start = (e) => Date.parse(e.start);
  const end = (e) => Date.parse(e.end);
  // A running meeting with a Meet the user joined, and the mic still held: the latest one wins (back-to-back).
  if (live) {
    const running = meetings
      .filter((e) => e.meetUrl && joined.has(e.id) && now >= start(e) - 5 * MIN && now < end(e))
      .sort((a, b) => start(b) - start(a))[0];
    if (running) return running;
  }
  const cur = current && meetings.find((e) => e.id === current);
  if (!cur) return null;
  // The call overruns: stay in it while presence still sees it, 30 min at most.
  if (live && now < end(cur) + 30 * MIN) return cur;
  // No fresh sample (PowerShell slow, failed): trust the calendar until the end.
  if (!fresh && now < end(cur)) return cur;
  return null;
}

module.exports = { currentCall };
