// The save document (js/progress.js): normalizing, the cross-device merge, the
// browser build's cloud slot (foreign save) migration, results bookkeeping,
// achievements, the local boards, personal bests and the game's options.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultSave, normalize, mergeSave, sameSave, readForeign, recordResult, localBoard, isPersonalBest, pickOptions,
  mergeProgress, BROWSER_KEYS, OPTION_KEYS,
} from '../js/progress.js';

const result = (o = {}) => ({
  contentId: 'journey-1', mode: 'journey', seed: 'journey-1', status: 'won', reason: 'board-clear', moves: 13, invalid: 0,
  elapsedMs: 14000, bestChain: 13, addRowsUsed: 0, pathTallies: { row: 1, col: 1, seq: 1 }, sessionId: 's1', at: 1000,
  score: { pairs: 130, chain: 390, rows: 75, clear: 200, time: 90, total: 885 }, ...o,
});

test('normalize fills a missing or broken save', () => {
  assert.deepEqual(normalize(null), defaultSave());
  const n = normalize({ progress: { journey: 3, totals: { pairs: 5 } }, results: [1, null, result()], snapshot: 'x', name: 7 });
  assert.deepEqual(n.progress.journey, {});
  assert.equal(n.progress.totals.pairs, 5);
  assert.equal(n.progress.totals.clears, 0);
  assert.equal(n.results.length, 1);
  assert.equal(n.snapshot, null);
  assert.equal(n.name, '');
});

test('recordResult: totals, journey stars, mastery, daily best, achievements once', () => {
  const s = defaultSave();
  const newly = recordResult(s, result(), '2026-10-28', 5);
  assert.deepEqual(newly, ['first_clear', 'mechanic_master']);
  assert.deepEqual(s.progress.journey['journey-1'], { done: true, best: 885, stars: 3 });
  assert.equal(s.progress.totals.clears, 1);
  assert.equal(s.progress.totals.pairs, 13);
  assert.deepEqual(s.progress.streakDays, ['2026-10-28']);
  assert.deepEqual(recordResult(s, result({ sessionId: 's2' }), '2026-10-28'), []);
  recordResult(s, result({ contentId: 'journey-8', sessionId: 's3' }), '2026-10-29');
  assert.ok(s.progress.achievements.mastery_stage);
  recordResult(s, result({ mode: 'daily', contentId: 'daily-2026-10-29', sessionId: 's4', score: { ...result().score, total: 500 } }), '2026-10-29');
  assert.equal(s.progress.bestDaily['daily-2026-10-29'], 500);
  const lost = recordResult(s, result({ status: 'lost', reason: 'move-limit', moves: 4, sessionId: 's5' }), '2026-10-30');
  assert.deepEqual(lost, []);
  assert.equal(s.progress.totals.pairs, 13 * 4 + 4);
});

test('local boards and personal bests (main.js checkPersonalBest)', () => {
  const s = defaultSave();
  recordResult(s, result({ sessionId: 'a', score: { ...result().score, total: 300 } }), '2026-10-28');
  const better = result({ sessionId: 'b', score: { ...result().score, total: 400 } });
  assert.equal(isPersonalBest(s, better), true);
  recordResult(s, better, '2026-10-28');
  assert.equal(isPersonalBest(s, better), true);
  assert.equal(isPersonalBest(s, result({ sessionId: 'c', score: { ...result().score, total: 350 } })), false);
  const board = localBoard(s, 'journey');
  assert.deepEqual(board.map((e) => e.score), [400, 300]);
  assert.deepEqual(localBoard(s, 'daily'), []);
});

test('mergeSave keeps everything either device earned; the local round in progress wins', () => {
  const a = defaultSave(), b = defaultSave();
  recordResult(a, result({ sessionId: 'x', at: 1 }), '2026-10-01');
  recordResult(b, result({ contentId: 'journey-2', sessionId: 'y', at: 2 }), '2026-10-02');
  a.snapshot = { remote: true };
  b.snapshot = { local: true };
  const m = mergeSave(a, b);
  assert.ok(m.progress.journey['journey-1'].done && m.progress.journey['journey-2'].done);
  assert.deepEqual(m.progress.streakDays, ['2026-10-01', '2026-10-02']);
  assert.equal(m.results.length, 2);
  assert.deepEqual(m.snapshot, { local: true });
  assert.equal(m.progress.totals.clears, 1); // totals take the larger side (platform.js mergeProgress)
  assert.ok(sameSave(m, mergeSave(m, m)));
});

test('achievement merge keeps the earliest unlock', () => {
  const m = mergeProgress({ achievements: { first_clear: { at: 5 } } }, { achievements: { first_clear: { at: 3 } } });
  assert.equal(m.achievements.first_clear.at, 3);
});

test('readForeign: the browser build\'s cloud slot was the bare progress document', () => {
  const old = { v: 1, rev: 4, journey: { 'journey-1': { done: true, best: 700, stars: 2 } }, achievements: { first_clear: { at: 9 } },
    totals: { pairs: 20, clears: 2 }, streakDays: ['2026-10-01'], bestDaily: {}, mastery: {} };
  const s = readForeign(JSON.stringify(old));
  assert.equal(s.progress.journey['journey-1'].best, 700);
  assert.equal(s.progress.totals.clears, 2);
  assert.deepEqual(s.results, []);
  assert.equal(readForeign('not json'), null);
  assert.equal(readForeign(JSON.stringify({ unrelated: 1 })), null);
  // Merged over this device's save, nothing is lost.
  const local = defaultSave();
  recordResult(local, result({ contentId: 'journey-3' }), '2026-10-02');
  const m = mergeSave(s, local);
  assert.ok(m.progress.journey['journey-1'].done && m.progress.journey['journey-3'].done);
});

test('options: only valid values are taken; the old KV keys are listed for removal', () => {
  assert.deepEqual(pickOptions({ theme: 'dusk', palette: 'nope', leftHanded: true, haptics: 'yes', timingAssist: false, captions: true }),
    { theme: 'dusk', leftHanded: true, timingAssist: false, captions: true });
  for (const k of OPTION_KEYS) assert.ok(BROWSER_KEYS.includes(k), k);
  for (const k of ['muted', 'graphics', 'reducedMotion', 'highContrast', 'largeText']) assert.ok(BROWSER_KEYS.includes(k));
});
