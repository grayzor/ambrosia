// Windows integration: full screen, session lock, several screens, file drags,
// « Ne pas déranger » (src/main/system.js), and how they share the « en appel » queue.

const test = require('node:test');
const assert = require('node:assert');
const S = require('../src/main/system');
const { CallMode } = require('../src/main/call-mode');
const { dndFocus } = require('../src/modules/gany/logic');

const SCREEN = { x: 0, y: 0, width: 1920, height: 1080 };
const LEFT = { x: -1920, y: 0, width: 1920, height: 1080 };

test('full screen: only when the window in front covers the island’s display', () => {
  const fs = { x: 0, y: 0, width: 1920, height: 1080 };
  assert.equal(S.fullscreenKind(S.QUNS.BUSY, fs, SCREEN), 'fullscreen');
  assert.equal(S.fullscreenKind(S.QUNS.RUNNING_D3D_FULL_SCREEN, fs, SCREEN), 'game');
  // borders a few pixels beyond the edges still count
  assert.equal(S.fullscreenKind(S.QUNS.BUSY, { x: -1, y: -1, width: 1922, height: 1082 }, SCREEN), 'fullscreen');
  // full screen on the other display: this one is left alone
  assert.equal(S.fullscreenKind(S.QUNS.BUSY, { ...LEFT }, SCREEN), null);
  // a maximised window (taskbar visible) is not full screen
  assert.equal(S.fullscreenKind(S.QUNS.BUSY, { x: -8, y: -8, width: 1936, height: 1048 }, SCREEN), null);
  // normal, quiet time (first hour after an install, NOT Do Not Disturb), unknown
  assert.equal(S.fullscreenKind(S.QUNS.ACCEPTS_NOTIFICATIONS, fs, SCREEN), null);
  assert.equal(S.fullscreenKind(S.QUNS.QUIET_TIME, fs, SCREEN), null);
  assert.equal(S.fullscreenKind(null, fs, SCREEN), null);
  // presentation settings: no window to compare, you are presenting
  assert.equal(S.fullscreenKind(S.QUNS.PRESENTATION_MODE, null, SCREEN), 'presentation');
  assert.equal(S.fullscreenKind(S.QUNS.BUSY, null, SCREEN), null);
});

test('session lock: no new work while locked, then one module after the other', () => {
  const s = new S.Suspend({ stepMs: 10000, leadMs: 3000 });
  assert.equal(s.held('mail', 0), false);
  assert.equal(s.set('lock', true), 'lock');
  assert.equal(s.set('sleep', true), null);
  assert.equal(s.held('mail', 0), true);
  assert.equal(s.set('lock', false), null, 'still asleep');
  assert.equal(s.set('sleep', false), 'unlock');
  const plan = s.resume(['agenda', 'mail', 'clickup'], 1000);
  assert.deepEqual([...plan.values()], [4000, 14000, 24000]);
  assert.equal(s.held('agenda', 3999), true);
  assert.equal(s.held('agenda', 4000), false);
  assert.equal(s.held('mail', 4000), true);
  assert.equal(s.held('clickup', 24000), false);
  assert.equal(s.held('unknown', 1000), false, 'a module not in the plan is free');
  // locking again forgets the plan
  s.set('lock', true);
  s.set('lock', false);
  assert.equal(s.held('clickup', 1000), false);
});

test('lock and full screen hold alerts like a call, whatever « En réunion », and recap in their own words', () => {
  const c = new CallMode(() => ({ enabled: false }));
  const mail = { key: 'mail:1', module: 'mail', title: 'Stock', priority: 60, sound: 'mail' };
  c.set('core:lock', { title: 'Session verrouillée', recapLead: 'Pendant ton absence', always: true, kind: 'lock' });
  assert.equal(c.admit(mail), null);
  assert.ok(c.admit({ key: 'claude:p', module: 'claude', priority: 100, sound: 'approval' }), 'approvals still pass');
  assert.deepEqual(c.status().kinds, ['lock']);
  assert.equal(c.set('core:lock', null), 'end');
  assert.equal(c.flush((id) => (id === 'mail' ? { name: 'Courrier', recap: { one: 'mail', many: 'mails' } } : null)).title, 'Pendant ton absence : 1 mail');
});

test('overlapping sources: the recap speaks for the last one to end', () => {
  const c = new CallMode();
  c.set('agenda', { title: 'ATLAS' });
  c.set('core:fullscreen', { ...S.FULLSCREEN_INFO.presentation, always: true, kind: 'fullscreen' });
  assert.deepEqual(c.status().kinds, ['call', 'fullscreen']);
  c.admit({ key: 'mail:1', module: 'mail', title: 'x', priority: 60 });
  assert.equal(c.set('core:fullscreen', null), null);
  assert.equal(c.set('agenda', null), 'end');
  assert.match(c.flush().title, /^Pendant ta réunion : /);
  // and the other way round
  c.set('core:fullscreen', { ...S.FULLSCREEN_INFO.fullscreen, always: true, kind: 'fullscreen' });
  c.set('agenda', { title: 'ATLAS' });
  c.admit({ key: 'mail:2', module: 'mail', title: 'y', priority: 60 });
  c.set('agenda', null);
  c.set('core:fullscreen', null);
  assert.match(c.flush().title, /^Pendant ton plein écran : /);
});

test('several screens: a display is followed once the pointer stayed there a moment', () => {
  const f = new S.DisplayFollower(1000);
  assert.equal(f.see(1, 0), 1);
  assert.equal(f.see(2, 100), 1, 'just crossing');
  assert.equal(f.see(1, 600), 1);
  assert.equal(f.see(2, 700), 1);
  assert.equal(f.see(2, 1600), 1);
  assert.equal(f.see(2, 1700), 2, 'stayed 1 s');
  assert.equal(f.see(null, 1800), 2, 'nothing known: no move');
});

test('several screens: the mode picks the display, unplugged falls back to the primary', () => {
  const displays = [{ id: 10 }, { id: 20 }, { id: 30 }];
  const o = { primaryId: 10, followedId: 30, fixedId: '20' };
  assert.equal(S.pickDisplay(displays, { ...o, mode: 'primary' }).id, 10);
  assert.equal(S.pickDisplay(displays, { ...o, mode: undefined }).id, 10);
  assert.equal(S.pickDisplay(displays, { ...o, mode: 'mouse' }).id, 30);
  assert.equal(S.pickDisplay(displays, { ...o, mode: 'window' }).id, 30);
  assert.equal(S.pickDisplay(displays, { ...o, mode: 'fixed' }).id, 20);
  assert.equal(S.pickDisplay(displays, { ...o, mode: 'fixed', fixedId: '99' }).id, 10);
  assert.equal(S.pickDisplay(displays, { ...o, mode: 'mouse', followedId: null }).id, 10);
  assert.equal(S.displayLabel({ id: 10, label: 'DELL U2720Q', size: { width: 1280, height: 720 }, scaleFactor: 2 }, 0, 10), 'DELL U2720Q — 2560 × 1440 (principal)');
  assert.equal(S.displayLabel({ id: 20, size: { width: 1920, height: 1080 } }, 1, 10), 'Écran 2 — 1920 × 1080');
});

test('file drag: the zone around the island', () => {
  const notch = { x: 296, y: 0, w: 168, h: 30 }; // centred in the 760 px window
  assert.equal(S.inDropZone({ x: 380, y: 10 }, notch), true);
  assert.equal(S.inDropZone({ x: 200, y: 140 }, notch), true, '120 px around');
  assert.equal(S.inDropZone({ x: 380, y: 160 }, notch), false, 'too far below');
  assert.equal(S.inDropZone({ x: 100, y: 10 }, notch), false, 'too far aside');
  assert.equal(S.inDropZone({ x: 380, y: -40 }, notch), false, 'above: another screen');
  assert.equal(S.inDropZone({ x: 380, y: 10 }, { x: 380, y: 0, w: 0, h: 0 }), false, 'no shape, no zone');
});

test('« Ne pas déranger »: the Windows 11 value wins, else the quiet-hours profile', () => {
  assert.equal(S.dndOn({ reg: 0, wnf: 0 }), true);
  assert.equal(S.dndOn({ reg: 1, wnf: 2 }), false);
  assert.equal(S.dndOn({ reg: -1, wnf: 1 }), true, 'never toggled on Windows 11, or Windows 10 Focus Assist');
  assert.equal(S.dndOn({ reg: -1, wnf: 0 }), false);
  assert.equal(S.dndOn({ reg: -1, wnf: -1 }), false);
  assert.equal(S.dndOn(), false);
});

test('« Ne pas déranger » drives the focus, never ends one the user started', () => {
  // turned on: a focus starts, unless one runs
  assert.equal(dndFocus({ dnd: true, prevDnd: false, focusActive: false }), 'on');
  assert.equal(dndFocus({ dnd: true, prevDnd: null, focusActive: false }), 'on', 'already on at start');
  assert.equal(dndFocus({ dnd: true, prevDnd: false, focusActive: true, focusBy: null }), null);
  // turned off: ends the focus it started only
  assert.equal(dndFocus({ dnd: false, prevDnd: true, focusActive: true, focusBy: 'dnd' }), 'off');
  assert.equal(dndFocus({ dnd: false, prevDnd: true, focusActive: true, focusBy: null }), null);
  // after a restart, the state is new: a focus DND started ends if DND is now off
  assert.equal(dndFocus({ dnd: false, prevDnd: null, focusActive: true, focusBy: 'dnd' }), 'off');
  // no change, or unknown: nothing
  assert.equal(dndFocus({ dnd: true, prevDnd: true, focusActive: false }), null, 'the user ended it: stays ended');
  assert.equal(dndFocus({ dnd: null, prevDnd: true, focusActive: true, focusBy: 'dnd' }), null);
});
