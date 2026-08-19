// Pair Sum — versioned content: themes, generators, journey, lessons, daily,
// challenges, and offline validators. Pure module (browser + Node).

import {
  createStream, hashSeed, createGame, listLegalPairs, applyCommand,
  remainingCount, RULES_VERSION, DEFAULT_COLS,
} from './rules.js';

export const CONTENT_VERSION = 1;

// ---------------------------------------------------------------------------
// Visual themes (presentation only — never affect rules or information)
// ---------------------------------------------------------------------------

export const THEMES = [
  {
    id: 'notebook', name: 'Field Notebook',
    paper: '#f6f1e3', ink: '#2c3244', rule: '#b9c4d6', margin: '#d98f8f',
    token: '#fdfaf1', tokenEdge: '#d8cfae', accent: '#e2703a', select: '#2f80ed',
    legal: '#3f9d63', danger: '#c0392b', sky: '#e9e2cf',
  },
  {
    id: 'dusk', name: 'Dusk Study',
    paper: '#232838', ink: '#e8e4d8', rule: '#3a4258', margin: '#8f5f6e',
    token: '#2f3650', tokenEdge: '#454f6e', accent: '#f0a35e', select: '#7aa5f8',
    legal: '#6fcf97', danger: '#eb5757', sky: '#1a1e2c',
  },
  {
    id: 'mint', name: 'Mint Ledger',
    paper: '#eef7f0', ink: '#243b32', rule: '#b8d8c8', margin: '#d98f8f',
    token: '#fbfefd', tokenEdge: '#b9d3c4', accent: '#1f8a70', select: '#2f80ed',
    legal: '#3f9d63', danger: '#c0392b', sky: '#dcefe4',
  },
  {
    id: 'slate', name: 'Slate Archive',
    paper: '#eceff3', ink: '#232a35', rule: '#c2cad4', margin: '#a08fd9',
    token: '#f8fafc', tokenEdge: '#c8d0da', accent: '#5b5fc7', select: '#2f80ed',
    legal: '#3f9d63', danger: '#c0392b', sky: '#dde3ea',
  },
  {
    id: 'candy', name: 'Sugar Draft',
    paper: '#fdf0f4', ink: '#432734', rule: '#eccfdc', margin: '#8fb8d9',
    token: '#fffafc', tokenEdge: '#e8c8d6', accent: '#d6417a', select: '#7a4de8',
    legal: '#3f9d63', danger: '#c0392b', sky: '#f7e2ec',
  },
];

export function getTheme(id) {
  return THEMES.find((t) => t.id === id) || THEMES[0];
}

// ---------------------------------------------------------------------------
// Board generator — domino tiling guarantees a constructive solution.
// Every digit pair occupies a horizontal or vertical domino, so its two cells
// are always mutually reachable; clearing dominoes in any order solves it.
// ---------------------------------------------------------------------------

function matchedPair(stream, minDigit, maxDigit) {
  const a = stream.int(minDigit, maxDigit);
  let b;
  if (stream.next() < 0.5) {
    b = a; // equal pair
  } else {
    const s = 10 - a;
    b = s >= minDigit && s <= maxDigit ? s : a;
  }
  return [a, b];
}

// params: { rows, cols, minDigit, maxDigit, emptyCols (trim side columns) }
export function generateBoard(seed, params = {}) {
  const cols = params.cols || DEFAULT_COLS;
  const rows = params.rows || 4;
  const minDigit = params.minDigit ?? 1;
  const maxDigit = params.maxDigit ?? 9;
  const stream = createStream(`board:${seed}`);
  const cells = new Array(rows * cols).fill(0);
  const solution = [];

  // Random maximal domino tiling of the grid.
  const free = new Set();
  for (let i = 0; i < rows * cols; i++) free.add(i);
  const starts = stream.shuffle([...free]);
  for (const i of starts) {
    if (!free.has(i)) continue;
    const r = Math.floor(i / cols);
    const c = i % cols;
    const horizontal = c + 1 < cols && free.has(i + 1);
    const vertical = r + 1 < rows && free.has(i + cols);
    let j = -1;
    if (horizontal && vertical) j = stream.next() < 0.5 ? i + 1 : i + cols;
    else if (horizontal) j = i + 1;
    else if (vertical) j = i + cols;
    else continue; // isolated single — left empty (visual variety)
    const [a, b] = matchedPair(stream, minDigit, maxDigit);
    cells[i] = a;
    cells[j] = b;
    solution.push([i, j]);
    free.delete(i);
    free.delete(j);
  }

  // Optional side-column trim for early lessons / small boards.
  const trim = params.emptyCols || 0;
  if (trim > 0) {
    for (let r = 0; r < rows; r++) {
      for (let c = cols - trim; c < cols; c++) cells[r * cols + c] = 0;
    }
  }
  return { cells: compactRows(cells, cols), cols, solution };
}

function compactRows(cells, cols) {
  const out = [];
  for (let r = 0; r < cells.length / cols; r++) {
    let empty = true;
    for (let c = 0; c < cols; c++) if (cells[r * cols + c] !== 0) { empty = false; break; }
    if (!empty) for (let c = 0; c < cols; c++) out.push(cells[r * cols + c]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Offline validators — legality, reachable goals, bounded duration, no locks
// ---------------------------------------------------------------------------

// Proves a definition solvable. When a constructive solution is stored it is
// replayed (with index remapping across row collapses and re-deals); otherwise
// a bounded greedy solver is used. Also measures difficulty signals.
export function validateContent(def) {
  const report = { id: def.id, ok: true, errors: [], metrics: {} };
  try {
    const first = createGame(def);
    report.metrics.pairs = remainingCount(first) / 2;
    report.metrics.openingBranching = listLegalPairs(first).length;
    const used = def.solution ? simulateSolution(def, report) : simulateGreedy(def, report);
    if (!used) report.errors.push('solver produced no terminal state');
  } catch (e) {
    report.errors.push(`exception: ${e.message}`);
  }
  if (report.errors.length) report.ok = false;
  return report;
}

// Follows def.solution (original-layout index pairs). Returns true when a
// terminal state was reached; fills report.metrics.
function simulateSolution(def, report) {
  let state = createGame(def);
  const cols = def.cols;
  // orig[k] = index in the original layout of the digit currently at slot k
  let orig = state.cells.map((_, i) => i);
  let steps = 0;
  let branchSum = 0;
  let cmdId = 1;
  const queue = def.solution.slice();
  while (state.status === 'active' && steps < 500) {
    branchSum += listLegalPairs(state).length;
    if (!queue.length) {
      // Solution exhausted but board not empty: redeal and continue greedily.
      const r = applyCommand(state, { id: cmdId++, at: state.elapsedMs + 1500, type: 'addRows' });
      if (r.error) { report.errors.push(`soft-lock after solution: ${r.error}`); return true; }
      const remainingOrig = orig.filter((_, k) => state.cells[k] !== 0);
      state = r.state;
      orig = orig.concat(remainingOrig);
      while (orig.length < state.cells.length) orig.push(-1);
      report.metrics.usedAddRows = true;
      const legal = listLegalPairs(state);
      if (legal.length) queue.push([orig[legal[0].a], orig[legal[0].b]]);
      steps++;
      continue;
    }
    const [oi, oj] = queue.shift();
    const a = orig.indexOf(oi);
    const b = orig.indexOf(oj);
    if (a < 0 || b < 0 || state.cells[a] === 0 || state.cells[b] === 0) continue; // already consumed
    const r = applyCommand(state, { id: cmdId++, at: state.elapsedMs + 1500, type: 'pair', a, b });
    if (r.error) { report.errors.push(`solution step rejected: ${r.error}`); return true; }
    const collapsed = (r.events || []).find((e) => e.type === 'collapse');
    if (collapsed) {
      const removed = new Set(collapsed.rows);
      const nextOrig = [];
      for (let row = 0; row < state.cells.length / cols; row++) {
        if (removed.has(row)) continue;
        for (let c = 0; c < cols; c++) nextOrig.push(orig[row * cols + c]);
      }
      orig = nextOrig;
    }
    state = r.state;
    steps++;
  }
  report.metrics.solutionDepth = steps;
  report.metrics.avgBranching = steps ? +(branchSum / steps).toFixed(2) : 0;
  if (state.status === 'active') { report.errors.push('unbounded: solution replay never terminated'); return false; }
  if (state.status !== 'won') report.errors.push(`solution replay ended: ${state.terminalReason}`);
  return true;
}

function simulateGreedy(def, report) {
  let state = createGame(def);
  const totalPairs = remainingCount(state) / 2;
  const maxSteps = Math.max(totalPairs * 4, (state.limits.moves || 0) + 4, 60);
  let steps = 0;
  let branchSum = 0;
  while (state.status === 'active' && steps < maxSteps) {
    const legal = listLegalPairs(state);
    branchSum += legal.length;
    if (!legal.length) {
      const r = applyCommand(state, { id: state.nextCmdId, at: state.elapsedMs, type: 'addRows' });
      if (r.error) { report.errors.push('soft-lock: no pairs and addRows rejected'); return true; }
      state = r.state;
      report.metrics.usedAddRows = true;
    } else {
      const p = legal[0];
      const r = applyCommand(state, { id: state.nextCmdId, at: state.elapsedMs + 1500, type: 'pair', a: p.a, b: p.b });
      if (r.error) { report.errors.push(`command rejected: ${r.error}`); return true; }
      state = r.state;
    }
    steps++;
  }
  report.metrics.solutionDepth = steps;
  report.metrics.avgBranching = steps ? +(branchSum / steps).toFixed(2) : 0;
  if (state.status === 'active') {
    report.errors.push('unbounded: exceeded step budget');
    return false;
  }
  if (state.status === 'lost' && def.limits?.moves == null && def.limits?.timeMs == null) {
    report.errors.push(`unexpected terminal: ${state.terminalReason}`);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Content definition wrapper
// ---------------------------------------------------------------------------

let defCounter = 0;
export function makeDef(partial) {
  return {
    v: CONTENT_VERSION,
    rulesV: RULES_VERSION,
    id: partial.id || `gen-${++defCounter}`,
    seed: String(partial.seed),
    cols: partial.cols || DEFAULT_COLS,
    cells: partial.cells,
    solution: partial.solution || null,
    goals: partial.goals || { type: 'clear' },
    limits: partial.limits || {},
    par: partial.par || {},
    mult: partial.mult ?? 1,
    mechanics: partial.mechanics || [],
    tutorial: partial.tutorial || null,
    theme: partial.theme || 'notebook',
    mode: partial.mode || 'practice',
    title: partial.title || 'Untitled',
    assists: partial.assists ?? { hints: true, undo: true },
    ranked: partial.ranked ?? false,
  };
}

// ---------------------------------------------------------------------------
// Learn — interactive lessons, one rule at a time, player must perform it
// ---------------------------------------------------------------------------

function lessonDef(id, title, rows, steps) {
  const cells = rows.flat();
  return makeDef({
    id: `learn-${id}`, seed: `learn-${id}`, title, mode: 'learn',
    cells, cols: rows[0].length, theme: 'notebook',
    tutorial: { steps }, assists: { hints: true, undo: true },
    par: { timeMs: null }, mult: 1,
  });
}

export const LESSONS = [
  lessonDef(1, 'Equal neighbours', [
    [4, 4, 7],
    [0, 0, 3],
    [0, 0, 0],
  ], [
    { text: 'Numbers that match can be connected. Tap the two 4s — equal numbers always pair.', require: { type: 'pair', values: [4, 4] } },
    { text: 'Now clear the last pair on your own.', require: { type: 'any-pair' } },
  ]),
  lessonDef(2, 'Making ten', [
    [3, 7, 5],
    [0, 0, 5],
    [0, 0, 0],
  ], [
    { text: 'Pairs that add to ten also connect. Connect 3 and 7.', require: { type: 'pair', values: [3, 7] } },
    { text: 'The two 5s are equal AND sum to ten. Clear them to finish.', require: { type: 'any-pair' } },
  ]),
  lessonDef(3, 'Down the column', [
    [6, 0, 0],
    [2, 8, 0],
    [4, 0, 0],
    [1, 9, 0],
  ], [
    { text: 'Pairs connect down a clear column too. Connect 2 and 8.', require: { type: 'pair', values: [2, 8] } },
    { text: 'Now 1 and 9 down column one.', require: { type: 'pair', values: [1, 9] } },
    { text: 'Finish the board: 6 and 4 make ten.', require: { type: 'any-pair' } },
  ]),
  lessonDef(4, 'Across the fold', [
    [5, 5, 7],
    [3, 6, 4],
    [0, 0, 0],
  ], [
    { text: 'Paths follow reading order and may fold onto the next row: 7 and 3 make ten across the fold.', require: { type: 'pair', values: [7, 3] } },
    { text: 'Now 6 and 4 make ten along the row.', require: { type: 'pair', values: [6, 4] } },
    { text: 'Finish with the two 5s.', require: { type: 'any-pair' } },
  ]),
  lessonDef(5, 'Open lanes', [
    [4, 1, 6],
    [0, 9, 0],
    [3, 7, 0],
  ], [
    { text: 'Empty cells never block a path. 4 and 6 connect through the gap... they sit in one row with 1 between them — blocked! Connect 1 and 9 down the open middle instead.', require: { type: 'pair', values: [1, 9] } },
    { text: 'Now the top row is open: 4 and 6 make ten.', require: { type: 'pair', values: [4, 6] } },
    { text: 'Finish with 3 and 7.', require: { type: 'any-pair' } },
  ]),
  lessonDef(6, 'Running low', [
    [5, 2, 8],
    [0, 0, 0],
    [7, 3, 0],
  ], [
    { text: 'When nothing connects, Add Rows rewrites the remaining digits as fresh rows. Clear 2 and 8 first.', require: { type: 'pair', values: [2, 8] } },
    { text: 'Now clear 7 and 3.', require: { type: 'pair', values: [7, 3] } },
    { text: 'Only a lone 5 remains — press Add Rows.', require: { type: 'any-addrows' } },
    { text: 'The 5s connect down the column. Clear them.', require: { type: 'any-pair' } },
  ]),
];

// ---------------------------------------------------------------------------
// Journey — 40 authored-parameter stages across five themes.
// One new concept in isolation → combine with a known concept → mastery test.
// ---------------------------------------------------------------------------

const JOURNEY_SCRIPT = [
  // Theme 1 — Notebook: core pairing vocabulary
  { title: 'First Lines', rows: 3, min: 1, max: 5, mult: 1, note: 'Equal numbers and small sums.' },
  { title: 'Tens', rows: 3, min: 1, max: 9, mult: 1, note: 'Full sum-to-ten range.' },
  { title: 'Long Lanes', rows: 4, min: 1, max: 9, mult: 1, note: 'Longer rows, longer paths.' },
  { title: 'Cross Hatching', rows: 4, min: 2, max: 8, mult: 1.1, note: 'Columns matter.' },
  { title: 'Crowded Page', rows: 5, min: 1, max: 9, mult: 1.1, note: 'Denser board.' },
  { title: 'Thin Margin', rows: 5, min: 3, max: 9, mult: 1.2, note: 'Fewer equal pairs.' },
  { title: 'Deep Stacks', rows: 6, min: 1, max: 9, mult: 1.2, note: 'Tall board.' },
  { title: 'Mastery: The Notebook', rows: 6, min: 1, max: 9, mult: 1.5, mastery: true, parMovesRatio: 1.0, note: 'Clear with no wasted moves.' },
  // Theme 2 — Dusk: add-rows economy
  { title: 'Second Wind', rows: 4, min: 1, max: 9, mult: 1.1, addRows: true, note: 'Add Rows unlocked as a tool.' },
  { title: 'Leftovers', rows: 4, min: 2, max: 9, mult: 1.2, addRows: true, note: 'Plan the redeal.' },
  { title: 'Late Edition', rows: 5, min: 1, max: 8, mult: 1.2, addRows: true, note: 'Mixed lanes.' },
  { title: 'Ink Budget', rows: 4, min: 1, max: 9, mult: 1.3, addRows: true, moveLimitRatio: 1.6, note: 'A loose move limit appears.' },
  { title: 'Night Shift', rows: 5, min: 1, max: 9, mult: 1.3, addRows: true, moveLimitRatio: 1.5, note: 'Tighter budget.' },
  { title: 'Deadline Draft', rows: 5, min: 2, max: 9, mult: 1.4, addRows: true, moveLimitRatio: 1.4, note: 'Tighter still.' },
  { title: 'Moonlit Margin', rows: 6, min: 1, max: 9, mult: 1.4, addRows: true, moveLimitRatio: 1.5, note: 'Tall and timed by moves.' },
  { title: 'Mastery: Dusk Study', rows: 6, min: 1, max: 9, mult: 1.6, mastery: true, addRows: true, moveLimitRatio: 1.3, note: 'Prove the redeal economy.' },
  // Theme 3 — Mint: clocks
  { title: 'First Bell', rows: 4, min: 1, max: 9, mult: 1.2, addRows: true, timeSec: 150, note: 'A generous clock.' },
  { title: 'Steady Hand', rows: 4, min: 1, max: 9, mult: 1.3, addRows: true, timeSec: 120, note: 'Less generous.' },
  { title: 'Quick Sums', rows: 5, min: 1, max: 8, mult: 1.3, addRows: true, timeSec: 150, note: 'Bigger board, similar clock.' },
  { title: 'Sharp Minute', rows: 4, min: 1, max: 9, mult: 1.4, addRows: true, timeSec: 90, note: 'Ninety seconds.' },
  { title: 'Double Deadline', rows: 5, min: 1, max: 9, mult: 1.4, addRows: true, timeSec: 120, moveLimitRatio: 1.8, note: 'Clock and budget together.' },
  { title: 'Green Room', rows: 5, min: 2, max: 9, mult: 1.5, addRows: true, timeSec: 105, note: 'Fewer equals under time.' },
  { title: 'Pressing On', rows: 6, min: 1, max: 9, mult: 1.5, addRows: true, timeSec: 150, note: 'Tall board, real clock.' },
  { title: 'Mastery: Mint Ledger', rows: 6, min: 1, max: 9, mult: 1.7, mastery: true, addRows: true, timeSec: 120, note: 'Two minutes, tall board.' },
  // Theme 4 — Slate: restricted tools
  { title: 'Bare Page', rows: 4, min: 1, max: 9, mult: 1.3, noHints: true, note: 'No hints from here.' },
  { title: 'Grey Area', rows: 5, min: 1, max: 9, mult: 1.4, noHints: true, note: 'Read the lanes yourself.' },
  { title: 'Stone Path', rows: 5, min: 2, max: 8, mult: 1.4, noHints: true, addRows: true, note: 'Redeal, unaided.' },
  { title: 'Archive Rules', rows: 5, min: 1, max: 9, mult: 1.5, noHints: true, noUndo: true, note: 'No undo either.' },
  { title: 'Cold Storage', rows: 6, min: 1, max: 9, mult: 1.5, noHints: true, addRows: true, note: 'Tall, unaided.' },
  { title: 'Narrow Columns', rows: 6, min: 1, max: 9, mult: 1.5, noHints: true, cols: 7, note: 'An altered layout.' },
  { title: 'Hard Cover', rows: 6, min: 2, max: 9, mult: 1.6, noHints: true, noUndo: true, timeSec: 180, note: 'Everything combined.' },
  { title: 'Mastery: Slate Archive', rows: 7, min: 1, max: 9, mult: 1.8, mastery: true, noHints: true, noUndo: true, addRows: true, note: 'The archive final.' },
  // Theme 5 — Candy: combined mastery
  { title: 'Sugar Rush', rows: 5, min: 1, max: 9, mult: 1.5, addRows: true, timeSec: 120, note: 'Fast and sweet.' },
  { title: 'Paper Route', rows: 6, min: 1, max: 8, mult: 1.5, addRows: true, moveLimitRatio: 1.5, note: 'Efficient lines.' },
  { title: 'Mixed Media', rows: 6, min: 1, max: 9, mult: 1.6, addRows: true, timeSec: 150, moveLimitRatio: 1.9, note: 'Two constraints.' },
  { title: 'Sweet Spot', rows: 6, min: 2, max: 9, mult: 1.6, noHints: true, timeSec: 140, note: 'Unaided speed.' },
  { title: 'Folding Press', rows: 7, min: 1, max: 9, mult: 1.6, addRows: true, cols: 8, note: 'Wide press layout.' },
  { title: 'Final Draft', rows: 7, min: 1, max: 9, mult: 1.7, noHints: true, addRows: true, moveLimitRatio: 1.6, note: 'Draft discipline.' },
  { title: 'Red Pen', rows: 7, min: 2, max: 9, mult: 1.7, noHints: true, noUndo: true, timeSec: 170, note: 'No second thoughts.' },
  { title: 'Mastery: Sugar Draft', rows: 8, min: 1, max: 9, mult: 2, mastery: true, noHints: true, addRows: true, timeSec: 200, moveLimitRatio: 2.0, note: 'The whole notebook.' },
];

function buildJourney() {
  const stages = [];
  JOURNEY_SCRIPT.forEach((script, idx) => {
    const n = idx + 1;
    const theme = THEMES[Math.floor(idx / 8)].id;
    const seed = `journey-${n}`;
    const cols = script.cols || DEFAULT_COLS;
    const gen = generateBoard(seed, { rows: script.rows, cols, minDigit: script.min, maxDigit: script.max });
    const filled = gen.cells.filter((c) => c !== 0).length;
    const pairCount = Math.floor(filled / 2);
    const limits = {};
    if (script.moveLimitRatio) limits.moves = Math.ceil(pairCount * script.moveLimitRatio);
    if (script.timeSec) limits.timeMs = script.timeSec * 1000;
    const mechanics = ['equal-pairs', 'sum-pairs', 'row-paths', 'col-paths', 'seq-paths'];
    if (script.addRows || n >= 9) mechanics.push('add-rows');
    if (limits.moves) mechanics.push('move-limit');
    if (limits.timeMs) mechanics.push('time-limit');
    if (script.cols && script.cols !== DEFAULT_COLS) mechanics.push('altered-layout');
    stages.push(makeDef({
      id: `journey-${n}`, seed, title: `${n}. ${script.title}`,
      mode: 'journey', theme, cols, cells: gen.cells, solution: gen.solution,
      limits, mult: script.mult, mechanics,
      par: { moves: pairCount, timeMs: script.timeSec ? script.timeSec * 800 : pairCount * 4500 },
      assists: { hints: !script.noHints, undo: !script.noUndo },
      ranked: !!script.mastery,
      goals: { type: 'clear', mastery: !!script.mastery, note: script.note },
    }));
  });
  return stages;
}

export const JOURNEY = buildJourney();

// ---------------------------------------------------------------------------
// Daily — one shared seed per UTC day, immutable after publication
// ---------------------------------------------------------------------------

export function dailyForDate(date) {
  const iso = date.toISOString().slice(0, 10); // UTC day boundary
  const seed = `daily-${iso}`;
  const stream = createStream(`daily-params:${iso}`);
  const rows = stream.int(4, 6);
  const useClock = stream.next() < 0.4;
  const gen = generateBoard(seed, { rows, cols: DEFAULT_COLS, minDigit: 1, maxDigit: 9 });
  const filled = gen.cells.filter((c) => c !== 0).length;
  const pairCount = Math.floor(filled / 2);
  return makeDef({
    id: seed, seed, title: `Daily — ${iso}`, mode: 'daily', theme: THEMES[stream.int(0, THEMES.length - 1)].id,
    cols: DEFAULT_COLS, cells: gen.cells, solution: gen.solution,
    limits: useClock ? { timeMs: (120 + stream.int(0, 60)) * 1000 } : {},
    mult: 1.5, mechanics: ['equal-pairs', 'sum-pairs', 'seq-paths', 'add-rows'].concat(useClock ? ['time-limit'] : []),
    par: { moves: pairCount, timeMs: pairCount * 4000 },
    assists: { hints: false, undo: false }, ranked: true,
    goals: { type: 'clear', daily: iso },
  });
}

// ---------------------------------------------------------------------------
// Practice — selectable difficulty, unrated, restart + undo
// ---------------------------------------------------------------------------

export const PRACTICE_DIFFICULTIES = [
  { id: 'calm', name: 'Calm', rows: 3, min: 1, max: 6, mult: 1, note: 'Small board, friendly digits.' },
  { id: 'steady', name: 'Steady', rows: 4, min: 1, max: 9, mult: 1.1, note: 'The standard page.' },
  { id: 'brisk', name: 'Brisk', rows: 5, min: 1, max: 9, mult: 1.25, note: 'Denser, wider range.' },
  { id: 'steep', name: 'Steep', rows: 6, min: 2, max: 9, mult: 1.5, note: 'Tall and unforgiving.' },
];

export function practiceDef(difficultyId, seed = `practice-${Date.now()}`) {
  const d = PRACTICE_DIFFICULTIES.find((x) => x.id === difficultyId) || PRACTICE_DIFFICULTIES[1];
  const gen = generateBoard(seed, { rows: d.rows, cols: DEFAULT_COLS, minDigit: d.min, maxDigit: d.max });
  const filled = gen.cells.filter((c) => c !== 0).length;
  return makeDef({
    id: `${d.id}:${seed}`, seed, title: `Practice — ${d.name}`, mode: 'practice',
    theme: 'notebook', cells: gen.cells, solution: gen.solution, mult: d.mult,
    mechanics: ['equal-pairs', 'sum-pairs', 'seq-paths', 'add-rows'],
    par: { moves: Math.floor(filled / 2), timeMs: Math.floor(filled / 2) * 5000 },
    assists: { hints: true, undo: true }, ranked: false,
    goals: { type: 'clear', note: d.note },
  });
}

// ---------------------------------------------------------------------------
// Challenge — constrained goals
// ---------------------------------------------------------------------------

export const CHALLENGES = [
  {
    id: 'ten-move-tango', name: 'Ten-Move Tango',
    note: 'Clear a small page in at most ten moves.',
    build() {
      const seed = 'challenge-ten-move';
      const gen = generateBoard(seed, { rows: 3, cols: DEFAULT_COLS, minDigit: 1, maxDigit: 9 });
      const filled = gen.cells.filter((c) => c !== 0).length;
      return makeDef({
        id: this.id, seed, title: this.name, mode: 'challenge', theme: 'slate',
        cells: gen.cells, solution: gen.solution, limits: { moves: Math.max(10, Math.floor(filled / 2)) },
        mult: 1.5, mechanics: ['move-limit'], ranked: true,
        par: { moves: Math.floor(filled / 2) }, goals: { type: 'clear', note: this.note },
        assists: { hints: true, undo: false },
      });
    },
  },
  {
    id: 'ninety-seconds', name: 'Ninety Seconds',
    note: 'Beat the clock: ninety seconds, one page.',
    build() {
      const seed = 'challenge-ninety';
      const gen = generateBoard(seed, { rows: 4, cols: DEFAULT_COLS, minDigit: 1, maxDigit: 9 });
      return makeDef({
        id: this.id, seed, title: this.name, mode: 'challenge', theme: 'mint',
        cells: gen.cells, solution: gen.solution, limits: { timeMs: 90000 },
        mult: 1.5, mechanics: ['time-limit'], ranked: true,
        par: { timeMs: 75000 }, goals: { type: 'clear', note: this.note },
        assists: { hints: true, undo: false },
      });
    },
  },
  {
    id: 'narrow-lanes', name: 'Narrow Lanes',
    note: 'An altered six-column layout changes every path.',
    build() {
      const seed = 'challenge-narrow';
      const gen = generateBoard(seed, { rows: 6, cols: 6, minDigit: 1, maxDigit: 9 });
      return makeDef({
        id: this.id, seed, title: this.name, mode: 'challenge', theme: 'dusk',
        cells: gen.cells, cols: 6, solution: gen.solution, mult: 1.5,
        mechanics: ['altered-layout'], ranked: true,
        par: {}, goals: { type: 'clear', note: this.note },
        assists: { hints: true, undo: false },
      });
    },
  },
  {
    id: 'unaided', name: 'Unaided',
    note: 'No hints, no undo. Trust your reading of the page.',
    build() {
      const seed = 'challenge-unaided';
      const gen = generateBoard(seed, { rows: 5, cols: DEFAULT_COLS, minDigit: 2, maxDigit: 9 });
      return makeDef({
        id: this.id, seed, title: this.name, mode: 'challenge', theme: 'candy',
        cells: gen.cells, solution: gen.solution, mult: 1.6,
        mechanics: ['restricted-tools'], ranked: true,
        par: {}, goals: { type: 'clear', note: this.note },
        assists: { hints: false, undo: false },
      });
    },
  },
];

// ---------------------------------------------------------------------------
// Achievements (stable lowercase keys, idempotent unlocks)
// ---------------------------------------------------------------------------

export const ACHIEVEMENTS = [
  { key: 'first_clear', name: 'First Clear', desc: 'Clear your first board.' },
  { key: 'mechanic_master', name: 'Lane Reader', desc: 'Clear a pair via each path type: row, column, and fold.' },
  { key: 'streak_7', name: 'Seven-Page Streak', desc: 'Clear boards on seven different days.' },
  { key: 'mastery_stage', name: 'Mastery Bound', desc: 'Complete any Mastery stage in the Journey.' },
  { key: 'thousand_pairs', name: 'Long Game', desc: 'Clear one thousand pairs in total.' },
];

// ---------------------------------------------------------------------------
// Bulk validation (used by tests and the server script)
// ---------------------------------------------------------------------------

export function validateAll() {
  const reports = [];
  for (const def of [...LESSONS, ...JOURNEY, ...CHALLENGES.map((c) => c.build())]) {
    reports.push(validateContent(def));
  }
  for (let d = 0; d < 14; d++) {
    const date = new Date(Date.UTC(2026, 0, 1 + d));
    reports.push(validateContent(dailyForDate(date)));
  }
  for (const diff of PRACTICE_DIFFICULTIES) {
    for (let i = 0; i < 5; i++) reports.push(validateContent(practiceDef(diff.id, `val-${diff.id}-${i}`)));
  }
  return reports;
}

export { hashSeed };
