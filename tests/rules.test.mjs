// Rules engine unit tests: every legal action, invalid-action reason, scoring
// component, terminal state, and serialization round-trip.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, applyCommand, checkPair, listLegalPairs, getHint, canAddRows,
  serialize, deserialize, hashState, compareResults, createStream,
  SCORE, remainingCount, pathBetween,
} from '../js/rules.js';

function defWith(cells, cols = 3, extra = {}) {
  return { seed: 't', cols, cells, ...extra };
}

function cmd(state, c) {
  return { id: state.nextCmdId, at: state.elapsedMs + 1000, ...c };
}

test('equal adjacent pair is legal via row', () => {
  const s = createGame(defWith([4, 4, 7, 0, 0, 3]));
  const c = checkPair(s, 0, 1);
  assert.equal(c.ok, true);
  assert.equal(c.via, 'row');
});

test('sum-to-ten pair is legal', () => {
  const s = createGame(defWith([3, 7, 0]));
  assert.equal(checkPair(s, 0, 1).ok, true);
});

test('column path works through empty cells', () => {
  const s = createGame(defWith([6, 1, 2, 0, 8, 9, 4, 0, 0]));
  // 6@0 and 4@6 same column with empty middle
  const c = checkPair(s, 0, 6);
  assert.equal(c.ok, true);
  assert.equal(c.via, 'col');
});

test('sequence fold across rows is legal', () => {
  const s = createGame(defWith([5, 5, 7, 3, 6, 4]));
  const c = checkPair(s, 2, 3); // 7 and 3 across the fold
  assert.equal(c.ok, true);
  assert.equal(c.via, 'seq');
});

test('non-matching digits rejected with no-match', () => {
  const s = createGame(defWith([2, 5, 0]));
  const c = checkPair(s, 0, 1);
  assert.equal(c.ok, false);
  assert.equal(c.reason, 'no-match');
});

test('filled cells block the path with blocked reason', () => {
  const s = createGame(defWith([4, 1, 4]));
  const c = checkPair(s, 0, 2);
  assert.equal(c.ok, false);
  assert.equal(c.reason, 'blocked');
});

test('same cell and empty cell reasons', () => {
  const s = createGame(defWith([4, 0, 4]));
  assert.equal(checkPair(s, 0, 0).reason, 'same-cell');
  assert.equal(checkPair(s, 0, 1).reason, 'empty-cell');
  assert.equal(checkPair(s, 0, 99).reason, 'out-of-bounds');
});

test('cleared cells never block (gaps are open lanes)', () => {
  const s = createGame(defWith([4, 1, 6]));
  const r1 = applyCommand(s, cmd(s, { type: 'pair', a: 0, b: 2 }));
  // 4+6=10 with 1 between -> blocked! must be invalid
  assert.equal(r1.events[0].type, 'invalid');
  assert.equal(r1.events[0].reason, 'blocked');
  // clear 1@1 with something? nothing matches. Use a fresh board:
  const s2 = createGame(defWith([4, 1, 6, 0, 9, 0]));
  const r2 = applyCommand(s2, cmd(s2, { type: 'pair', a: 1, b: 4 })); // 1+9 column
  assert.equal(r2.events[0].type, 'clear');
  const r3 = applyCommand(r2.state, cmd(r2.state, { type: 'pair', a: 0, b: 2 }));
  assert.equal(r3.events[0].type, 'clear'); // now open through the gap
});

test('scoring: pair, chain, row clear, board clear, time bonus', () => {
  const s = createGame(defWith([4, 4, 0, 7, 3, 0], 3, { par: { timeMs: 60000 } }));
  let r = applyCommand(s, cmd(s, { type: 'pair', a: 0, b: 1 }));
  assert.equal(r.state.score.pairs, SCORE.PAIR);
  assert.equal(r.state.score.chain, 0); // first clear: no chain bonus
  assert.equal(r.state.chain, 1);
  assert.deepEqual(r.state.cells, [7, 3, 0]); // row 0 collapsed
  r = applyCommand(r.state, cmd(r.state, { type: 'pair', a: 0, b: 1 })); // 7+3
  const sc = r.state.score;
  assert.equal(sc.pairs, SCORE.PAIR * 2);
  assert.equal(sc.chain, SCORE.CHAIN_STEP); // chain of 2
  assert.equal(r.state.rowsCleared, 2);
  assert.equal(sc.rows, SCORE.ROW_CLEAR * 2);
  assert.equal(sc.clear, SCORE.BOARD_CLEAR);
  assert.ok(sc.time > 0); // under par
  assert.equal(r.state.status, 'won');
  assert.equal(r.state.terminalReason, 'board-clear');
  assert.equal(sc.total, Math.round((sc.pairs + sc.chain + sc.rows) * 1) + sc.clear + sc.time);
});

test('invalid action breaks chain and is counted', () => {
  const s = createGame(defWith([4, 4, 2, 5, 7, 3]));
  let r = applyCommand(s, cmd(s, { type: 'pair', a: 0, b: 1 }));
  assert.equal(r.state.chain, 1);
  r = applyCommand(r.state, cmd(r.state, { type: 'pair', a: 2, b: 3 })); // 2+5=7 no match
  assert.equal(r.state.invalid, 1);
  assert.equal(r.state.chain, 0);
  assert.equal(r.state.moves, 1);
});

test('row collapse removes empty rows and remaps indices', () => {
  const s = createGame(defWith([4, 4, 0, 7, 3, 9]));
  const r = applyCommand(s, cmd(s, { type: 'pair', a: 0, b: 1 }));
  assert.equal(r.state.cells.length, 3); // row 0 collapsed
  assert.deepEqual(r.state.cells, [7, 3, 9]);
});

test('addRows full cycle leads to win (lesson 6 shape)', () => {
  const s = createGame(defWith([5, 2, 8, 0, 0, 0, 7, 3, 0]));
  let r = applyCommand(s, cmd(s, { type: 'pair', a: 1, b: 2 }));
  r = applyCommand(r.state, cmd(r.state, { type: 'pair', a: 3, b: 4 })); // 7+3
  assert.equal(remainingCount(r.state), 1);
  r = applyCommand(r.state, cmd(r.state, { type: 'addRows' }));
  assert.equal(r.state.addRowsUsed, 1);
  const hint = getHint(r.state);
  assert.ok(hint, 'a pair must exist after redeal');
  r = applyCommand(r.state, cmd(r.state, { type: 'pair', a: hint.a, b: hint.b }));
  assert.equal(r.state.status, 'won');
});

test('move limit produces lost terminal', () => {
  const s = createGame(defWith([4, 4, 2, 2], 2, { limits: { moves: 1 } }));
  const r = applyCommand(s, cmd(s, { type: 'pair', a: 0, b: 1 }));
  assert.equal(r.state.status, 'lost');
  assert.equal(r.state.terminalReason, 'move-limit');
});

test('time limit enforced by authoritative clock', () => {
  const s = createGame(defWith([4, 4], 2, { limits: { timeMs: 5000 } }));
  const c = { id: 1, at: 6000, type: 'note' };
  const r = applyCommand(s, c);
  assert.equal(r.state.status, 'lost');
  assert.equal(r.state.terminalReason, 'time-limit');
});

test('giveUp produces aborted terminal', () => {
  const s = createGame(defWith([4, 4], 2));
  const r = applyCommand(s, cmd(s, { type: 'giveUp' }));
  assert.equal(r.state.status, 'aborted');
  assert.equal(r.state.terminalReason, 'gave-up');
});

test('commands after round end are rejected', () => {
  const s = createGame(defWith([4, 4], 2));
  const r = applyCommand(s, cmd(s, { type: 'pair', a: 0, b: 1 }));
  const r2 = applyCommand(r.state, { id: 2, at: 2000, type: 'giveUp' });
  assert.equal(r2.error, 'round-over');
});

test('command ids: duplicates rejected idempotently, gaps rejected', () => {
  const s = createGame(defWith([4, 4, 7, 3], 2));
  const c = cmd(s, { type: 'pair', a: 0, b: 1 });
  const r = applyCommand(s, c);
  assert.ok(r.state);
  const dup = applyCommand(r.state, c);
  assert.equal(dup.error, 'duplicate-command');
  const gap = applyCommand(r.state, { id: 9, at: 0, type: 'giveUp' });
  assert.equal(gap.error, 'out-of-order-command');
});

test('tick increases monotonically', () => {
  const s = createGame(defWith([4, 4, 7, 3], 2));
  const r1 = applyCommand(s, cmd(s, { type: 'note' }));
  const r2 = applyCommand(r1.state, cmd(r1.state, { type: 'note' }));
  assert.ok(r2.state.tick > r1.state.tick);
  assert.ok(r1.state.tick > s.tick);
});

test('serialization round-trip preserves hash', () => {
  let s = createGame(defWith([4, 4, 7, 3, 9, 1], 3));
  s = applyCommand(s, cmd(s, { type: 'pair', a: 0, b: 1 })).state;
  const restored = deserialize(serialize(s));
  assert.equal(hashState(restored), hashState(s));
});

test('deserialize rejects garbage', () => {
  assert.throws(() => deserialize('{"nope":true}'));
  assert.throws(() => deserialize('42'));
});

test('tiebreak ordering: completion, invalids, time, session id', () => {
  const base = { score: { total: 100 }, invalid: 0, elapsedMs: 1000, sessionId: 'b' };
  const win = { ...base, status: 'won' };
  const loss = { ...base, status: 'lost', score: { total: 999 } };
  assert.ok(compareResults(win, loss) < 0); // completion beats score
  const cleaner = { ...win, invalid: 0, sessionId: 'a' };
  const sloppier = { ...win, invalid: 2, sessionId: 'a' };
  assert.ok(compareResults(cleaner, sloppier) < 0);
  const faster = { ...win, elapsedMs: 500, sessionId: 'a' };
  const slower = { ...win, elapsedMs: 1500, sessionId: 'a' };
  assert.ok(compareResults(faster, slower) < 0);
  const idA = { ...win, sessionId: 'a' };
  const idB = { ...win, sessionId: 'b' };
  assert.ok(compareResults(idA, idB) < 0);
});

test('seeded stream is deterministic and independent', () => {
  const a = createStream('same-seed');
  const b = createStream('same-seed');
  for (let i = 0; i < 20; i++) assert.equal(a.next(), b.next());
  const c = createStream('other-seed');
  assert.notEqual(createStream('x').next(), c.next());
});

test('hint uses the same legality API as play', () => {
  const s = createGame(defWith([6, 1, 2, 0, 8, 9, 4, 0, 0]));
  const h = getHint(s);
  assert.ok(h);
  assert.ok(listLegalPairs(s).some((p) => p.a === h.a && p.b === h.b));
  assert.equal(checkPair(s, h.a, h.b).ok, true);
});

test('canAddRows false when board empty', () => {
  const s = createGame(defWith([4, 4], 2));
  const r = applyCommand(s, cmd(s, { type: 'pair', a: 0, b: 1 }));
  assert.equal(canAddRows(r.state), false);
  assert.equal(getHint(r.state), null);
});

test('pathBetween reports intermediate cells for visualization', () => {
  const s = createGame(defWith([4, 0, 0, 4], 4));
  const p = pathBetween(s, 0, 3);
  assert.equal(p.ok, true);
  assert.equal(p.via, 'row');
  assert.deepEqual(p.path, [1, 2]);
});
