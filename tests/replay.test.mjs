// Property + fuzz tests: deterministic replay, malformed commands, and
// generated-content soundness (no hangs, no impossible mandatory states).

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, applyCommand, hashState, replay, listLegalPairs, canAddRows,
} from '../js/rules.js';
import { generateBoard, practiceDef, PRACTICE_DIFFICULTIES, dailyForDate, validateContent } from '../js/content.js';

function playGreedy(def, maxSteps = 400) {
  let state = createGame(def);
  const commands = [];
  const hashes = [hashState(state)];
  let steps = 0;
  while (state.status === 'active' && steps < maxSteps) {
    const legal = listLegalPairs(state);
    let cmd;
    if (!legal.length) {
      if (!canAddRows(state)) break;
      cmd = { id: state.nextCmdId, at: state.elapsedMs + 1200, type: 'addRows' };
    } else {
      const p = legal[steps % legal.length]; // vary choices deterministically
      cmd = { id: state.nextCmdId, at: state.elapsedMs + 1200, type: 'pair', a: p.a, b: p.b };
    }
    const r = applyCommand(state, cmd);
    assert.ifError(r.error);
    state = r.state;
    commands.push(cmd);
    hashes.push(hashState(state));
    steps++;
  }
  return { state, commands, hashes, steps };
}

test('replay determinism: same seed + commands → identical hashes', () => {
  for (let i = 0; i < 8; i++) {
    const def = practiceDef('brisk', `prop-${i}`);
    const a = playGreedy(def);
    const b = playGreedy(def);
    assert.deepEqual(a.hashes, b.hashes, `run ${i} diverged`);
    // And the replay API agrees with live play.
    const env = {
      init: def, commands: a.commands,
    };
    const r = replay(env);
    assert.ok(r.ok);
    assert.equal(r.finalHash, a.hashes[a.hashes.length - 1]);
  }
});

test('fuzz: malformed commands never corrupt state or hang', () => {
  const def = practiceDef('steady', 'fuzz-1');
  let state = createGame(def);
  const junk = [
    null, undefined, 42, 'string', [], {},
    { id: -1 }, { id: 0 }, { id: 1.5 }, { id: 'x' },
    { id: 1, type: 'pair' },
    { id: 1, type: 'pair', a: 'x', b: {} },
    { id: 1, type: 'pair', a: -5, b: 99999 },
    { id: 1, type: 'pair', a: NaN, b: Infinity },
    { id: 1, type: 'nope' },
    { id: 1, type: 'addRows', extra: 'junk' },
    { id: 1, at: -50, type: 'note' },
    { id: 1, at: NaN, type: 'note' },
    { id: 1, type: 'giveUp' },
  ];
  for (const j of junk) {
    const before = hashState(state);
    const r = applyCommand(state, j);
    if (r.error) {
      assert.equal(hashState(r.state), before, `state mutated by ${JSON.stringify(j)}`);
    } else {
      state = r.state; // valid command (e.g. giveUp) — must still be coherent
      assert.ok(Number.isInteger(state.tick));
      assert.ok(state.cells.every((c) => Number.isInteger(c) && c >= 0 && c <= 9));
    }
  }
});

test('fuzz: generated boards are always well-formed and bounded', () => {
  for (let i = 0; i < 30; i++) {
    const gen = generateBoard(`fz-${i}`, { rows: 2 + (i % 6), cols: 5 + (i % 5), minDigit: 1, maxDigit: 9 });
    assert.equal(gen.cells.length % gen.cols, 0);
    assert.ok(gen.cells.every((c) => Number.isInteger(c) && c >= 0 && c <= 9));
    const report = validateContent({
      id: `fz-${i}`, seed: `fz-${i}`, cols: gen.cols, cells: gen.cells,
      solution: gen.solution, limits: {}, par: {}, mult: 1,
    });
    assert.ok(report.ok, `${report.id}: ${report.errors.join('; ')}`);
  }
});

test('daily seeds immutable: same UTC day → identical board', () => {
  const d = new Date(Date.UTC(2026, 5, 15, 23, 59));
  const a = dailyForDate(d);
  const b = dailyForDate(new Date(Date.UTC(2026, 5, 15, 0, 1)));
  assert.deepEqual(a.cells, b.cells);
  const c = dailyForDate(new Date(Date.UTC(2026, 5, 16)));
  assert.notDeepEqual(c.cells, a.cells);
});

test('golden sessions: easy, medium, hard all reach terminal states', () => {
  for (const diff of PRACTICE_DIFFICULTIES) {
    const { state, steps } = playGreedy(practiceDef(diff.id, `golden-${diff.id}`));
    assert.notEqual(state.status, 'active', `${diff.id} never terminated in ${steps} steps`);
    assert.ok(Number.isFinite(state.score.total));
    assert.ok(state.score.total >= 0);
  }
});

test('interrupted + resumed session replays identically', () => {
  const def = practiceDef('steady', 'golden-resume');
  const full = playGreedy(def);
  // "Interrupt" halfway: state after k commands, then continue.
  const k = Math.max(1, Math.floor(full.commands.length / 2));
  let state = createGame(def);
  for (const c of full.commands.slice(0, k)) state = applyCommand(state, c).state;
  const midHash = hashState(state);
  for (const c of full.commands.slice(k)) state = applyCommand(state, c).state;
  assert.equal(hashState(state), full.hashes[full.hashes.length - 1]);
  assert.equal(midHash, full.hashes[k]);
});

test('no NaN or negative values ever appear in scores', () => {
  const { state } = playGreedy(practiceDef('steep', 'nan-check'));
  for (const v of Object.values(state.score)) {
    assert.ok(Number.isFinite(v) && v >= 0);
  }
});
