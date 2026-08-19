// Content tests: all shipped definitions validate (legality, reachable goals,
// bounded duration, no soft locks), journey structure, lessons completable.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  JOURNEY, LESSONS, CHALLENGES, THEMES, ACHIEVEMENTS, validateAll,
  dailyForDate, CONTENT_VERSION,
} from '../js/content.js';
import { createGame, applyCommand, listLegalPairs } from '../js/rules.js';

test('all shipped content passes offline validators', () => {
  const reports = validateAll();
  const bad = reports.filter((r) => !r.ok);
  assert.equal(bad.length, 0, bad.map((r) => `${r.id}: ${r.errors.join('; ')}`).join('\n'));
  assert.ok(reports.length >= 40, 'validator coverage');
});

test('journey: 40 stages, 5 themes, mastery every 8th', () => {
  assert.equal(JOURNEY.length, 40);
  for (let i = 0; i < 40; i++) {
    assert.equal(JOURNEY[i].goals.mastery, (i + 1) % 8 === 0, `stage ${i + 1} mastery flag`);
    assert.equal(JOURNEY[i].theme, THEMES[Math.floor(i / 8)].id);
    assert.ok(JOURNEY[i].v === CONTENT_VERSION);
  }
});

test('lessons are completable by following their own steps', () => {
  for (const lesson of LESSONS) {
    let state = createGame(lesson);
    let cmdId = 1;
    for (const step of lesson.tutorial.steps) {
      const req = step.require;
      if (req.type === 'any-addrows') {
        const r = applyCommand(state, { id: cmdId++, at: state.elapsedMs + 1000, type: 'addRows' });
        assert.ifError(r.error, `${lesson.id} addRows: ${r.error}`);
        state = r.state;
        continue;
      }
      const legal = listLegalPairs(state);
      let pick = null;
      if (req.type === 'any-pair') pick = legal[0];
      else {
        const want = req.values.slice().sort((a, b) => a - b).join(',');
        pick = legal.find((p) =>
          [state.cells[p.a], state.cells[p.b]].sort((a, b) => a - b).join(',') === want);
      }
      assert.ok(pick, `${lesson.id}: no legal pair for step "${step.text.slice(0, 40)}"`);
      const r = applyCommand(state, { id: cmdId++, at: state.elapsedMs + 1000, type: 'pair', a: pick.a, b: pick.b });
      assert.ifError(r.error);
      state = r.state;
    }
    assert.equal(state.status, 'won', `${lesson.id} should be cleared by its own steps`);
  }
});

test('challenges build valid ranked definitions', () => {
  for (const c of CHALLENGES) {
    const def = c.build();
    assert.equal(def.mode, 'challenge');
    assert.ok(def.ranked);
    assert.ok(def.limits.moves || def.limits.timeMs || def.mechanics.length > 0);
  }
});

test('achievement keys are stable lowercase identifiers', () => {
  const keys = ACHIEVEMENTS.map((a) => a.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const k of keys) assert.match(k, /^[a-z0-9_]+$/);
  assert.equal(ACHIEVEMENTS.length, 5); // the declared static set
});

test('five visual themes ship with complete palettes', () => {
  assert.equal(THEMES.length, 5);
  for (const t of THEMES) {
    for (const field of ['paper', 'ink', 'rule', 'accent', 'select', 'legal', 'danger', 'token', 'sky']) {
      assert.match(t[field], /^#[0-9a-f]{6}$/i, `${t.id}.${field}`);
    }
  }
});

test('daily content is ranked, unassisted, and within content version', () => {
  const def = dailyForDate(new Date(Date.UTC(2026, 7, 18)));
  assert.ok(def.ranked);
  assert.equal(def.assists.hints, false);
  assert.equal(def.assists.undo, false);
  assert.equal(def.v, CONTENT_VERSION);
});
