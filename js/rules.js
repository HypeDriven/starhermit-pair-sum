// Pair Sum — deterministic rules engine.
// Pure module: no DOM, no rendering, no I/O. Same file runs in browser and Node.
//
// Rules contract:
//  - Board is a flat array of cells, `cols` wide. 0 = empty, 1..9 = digits.
//  - A pair (a,b) is legal when both cells hold digits that MATCH
//    (equal values, or values summing to TARGET_SUM) AND the path between
//    them is unobstructed. Paths are: same row, same column, or reading-order
//    sequence (every cell strictly between a and b in row-major order is empty).
//  - Clearing a pair empties both cells. Fully empty rows collapse away.
//  - "Add rows" appends all remaining digits, in reading order, as new rows.
//  - Win: every cell is empty. Loss: a configured move/time limit is exceeded.
// Determinism: state changes happen only through applyCommand(); identical
// (version, seed, command list) always yields identical state hashes.

export const RULES_VERSION = 1;
export const TARGET_SUM = 10;
export const DEFAULT_COLS = 9;

export const SCORE = {
  PAIR: 10,
  CHAIN_STEP: 5,      // bonus per chain depth beyond the first
  ROW_CLEAR: 25,
  BOARD_CLEAR: 200,
  TIME_BONUS_PER_SEC: 2,
};

// ---------------------------------------------------------------------------
// Seeded random streams (rules / decoration / audiovisual stay separate)
// ---------------------------------------------------------------------------

export function hashSeed(str) {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function createStream(seed) {
  // mulberry32
  let s = (typeof seed === 'string' ? hashSeed(seed) : seed >>> 0) || 0x9e3779b9;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)), // inclusive
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
    getState: () => s,
  };
}

// ---------------------------------------------------------------------------
// Game creation
// ---------------------------------------------------------------------------

// def: { seed, cols, cells, limits:{moves,timeMs}, par:{moves,timeMs}, mult,
//        mode, contentId, mechanics:[] }
export function createGame(def) {
  const cols = def.cols || DEFAULT_COLS;
  if (!Array.isArray(def.cells) || def.cells.length === 0) {
    throw new Error('createGame: def.cells must be a non-empty array');
  }
  if (def.cells.length % cols !== 0) throw new Error('createGame: cells must fill whole rows');
  return {
    v: RULES_VERSION,
    seed: String(def.seed),
    contentId: def.contentId || null,
    mode: def.mode || 'practice',
    cols,
    cells: def.cells.slice(),
    tick: 0,                 // monotonically increasing command tick
    nextCmdId: 1,            // action identifiers prevent double commits
    status: 'active',        // active | won | lost | aborted
    terminalReason: null,    // board-clear | move-limit | time-limit | gave-up
    elapsedMs: 0,
    moves: 0,
    invalid: 0,
    chain: 0,
    bestChain: 0,
    addRowsUsed: 0,
    rowsCleared: 0,
    score: { pairs: 0, chain: 0, rows: 0, clear: 0, time: 0, total: 0 },
    limits: { moves: def.limits?.moves ?? null, timeMs: def.limits?.timeMs ?? null },
    par: { moves: def.par?.moves ?? null, timeMs: def.par?.timeMs ?? null },
    mult: typeof def.mult === 'number' ? def.mult : 1,
    mechanics: Array.isArray(def.mechanics) ? def.mechanics.slice() : [],
  };
}

// ---------------------------------------------------------------------------
// Legality queries (shared by play, hints and tutorials)
// ---------------------------------------------------------------------------

export function rowOf(state, i) { return Math.floor(i / state.cols); }
export function colOf(state, i) { return i % state.cols; }
export function remainingCount(state) {
  let n = 0;
  for (const c of state.cells) if (c !== 0) n++;
  return n;
}

export function valuesMatch(x, y) {
  return x !== 0 && y !== 0 && (x === y || x + y === TARGET_SUM);
}

// Returns { ok, via: 'row'|'col'|'seq'|null, path: [indices between a and b] }
export function pathBetween(state, a, b) {
  if (a === b) return { ok: false, via: null, path: [] };
  const [lo, hi] = a < b ? [a, b] : [b, a];
  const cols = state.cols;
  // Same row
  if (rowOf(state, lo) === rowOf(state, hi)) {
    const path = [];
    let clear = true;
    for (let i = lo + 1; i < hi; i++) {
      path.push(i);
      if (state.cells[i] !== 0) { clear = false; break; }
    }
    if (clear) return { ok: true, via: 'row', path };
  }
  // Same column
  if (colOf(state, lo) === colOf(state, hi)) {
    const path = [];
    let clear = true;
    for (let i = lo + cols; i < hi; i += cols) {
      path.push(i);
      if (state.cells[i] !== 0) { clear = false; break; }
    }
    if (clear) return { ok: true, via: 'col', path };
  }
  // Reading-order sequence (wraps across rows; empty cells never block)
  {
    const path = [];
    let clear = true;
    for (let i = lo + 1; i < hi; i++) {
      path.push(i);
      if (state.cells[i] !== 0) { clear = false; break; }
    }
    if (clear) return { ok: true, via: 'seq', path };
  }
  return { ok: false, via: null, path: [] };
}

// Full legality check with an explanatory reason for invalid actions.
export function checkPair(state, a, b) {
  if (state.status !== 'active') return { ok: false, reason: 'round-over' };
  if (!Number.isInteger(a) || !Number.isInteger(b) ||
      a < 0 || b < 0 || a >= state.cells.length || b >= state.cells.length) {
    return { ok: false, reason: 'out-of-bounds' };
  }
  if (a === b) return { ok: false, reason: 'same-cell' };
  if (state.cells[a] === 0 || state.cells[b] === 0) return { ok: false, reason: 'empty-cell' };
  if (!valuesMatch(state.cells[a], state.cells[b])) return { ok: false, reason: 'no-match' };
  const p = pathBetween(state, a, b);
  if (!p.ok) return { ok: false, reason: 'blocked' };
  return { ok: true, reason: null, via: p.via, path: p.path };
}

export function listLegalPairs(state) {
  const out = [];
  if (state.status !== 'active') return out;
  const filled = [];
  for (let i = 0; i < state.cells.length; i++) if (state.cells[i] !== 0) filled.push(i);
  for (let x = 0; x < filled.length; x++) {
    for (let y = x + 1; y < filled.length; y++) {
      if (!valuesMatch(state.cells[filled[x]], state.cells[filled[y]])) continue;
      const p = pathBetween(state, filled[x], filled[y]);
      if (p.ok) out.push({ a: filled[x], b: filled[y], via: p.via });
    }
  }
  return out;
}

// Hints and tutorials call the exact same legality API as play.
export function getHint(state) {
  const pairs = listLegalPairs(state);
  return pairs.length ? pairs[0] : null;
}

export function canAddRows(state) {
  return state.status === 'active' && remainingCount(state) > 0;
}

// ---------------------------------------------------------------------------
// Command application — the only way rules state ever changes
// ---------------------------------------------------------------------------

function cloneState(state) {
  return {
    ...state,
    cells: state.cells.slice(),
    score: { ...state.score },
    limits: { ...state.limits },
    par: { ...state.par },
    mechanics: state.mechanics.slice(),
  };
}

function recomputeTotal(state) {
  const s = state.score;
  const base = Math.round((s.pairs + s.chain + s.rows) * state.mult);
  s.total = base + s.clear + s.time;
}

function collapseRows(state, events) {
  const cols = state.cols;
  const kept = [];
  const removed = [];
  for (let r = 0; r < state.cells.length / cols; r++) {
    let empty = true;
    for (let c = 0; c < cols; c++) if (state.cells[r * cols + c] !== 0) { empty = false; break; }
    if (empty) removed.push(r); else {
      for (let c = 0; c < cols; c++) kept.push(state.cells[r * cols + c]);
    }
  }
  if (removed.length) {
    state.cells = kept;
    state.rowsCleared += removed.length;
    state.score.rows += removed.length * SCORE.ROW_CLEAR;
    events.push({ type: 'collapse', rows: removed });
  }
}

function finish(state, events, status, reason) {
  state.status = status;
  state.terminalReason = reason;
  if (status === 'won') {
    state.score.clear += SCORE.BOARD_CLEAR;
    if (state.par.timeMs != null && state.elapsedMs < state.par.timeMs) {
      state.score.time += Math.floor((state.par.timeMs - state.elapsedMs) / 1000) * SCORE.TIME_BONUS_PER_SEC;
    }
    recomputeTotal(state);
    events.push({ type: 'win', score: { ...state.score } });
  } else {
    recomputeTotal(state);
    events.push({ type: 'lose', reason, score: { ...state.score } });
  }
}

// cmd: { id, at, type:'pair'|'addRows'|'giveUp'|'note', a?, b? }
// Returns { state, events } on success or { state, error } on rejection.
// The input state is never mutated; the returned state is a new object.
export function applyCommand(state, cmd) {
  if (!cmd || typeof cmd !== 'object') return { state, error: 'malformed-command' };
  if (!Number.isInteger(cmd.id) || cmd.id < 1) return { state, error: 'bad-command-id' };
  if (cmd.id < state.nextCmdId) return { state, error: 'duplicate-command' }; // idempotent reject
  if (cmd.id > state.nextCmdId) return { state, error: 'out-of-order-command' };
  const at = Number.isFinite(cmd.at) && cmd.at >= 0 ? Math.floor(cmd.at) : state.elapsedMs;

  const s = cloneState(state);
  s.nextCmdId = cmd.id + 1;
  s.tick += 1;
  s.elapsedMs = Math.max(s.elapsedMs, at);
  const events = [];

  if (s.status !== 'active') return { state, error: 'round-over' };

  // Authoritative clock: time limit enforced on every command.
  if (s.limits.timeMs != null && s.elapsedMs > s.limits.timeMs) {
    finish(s, events, 'lost', 'time-limit');
    return { state: s, events };
  }

  switch (cmd.type) {
    case 'pair': {
      const check = checkPair(s, cmd.a, cmd.b);
      if (!check.ok) {
        if (check.reason === 'round-over') return { state, error: 'round-over' };
        if (check.reason === 'out-of-bounds') return { state, error: 'out-of-bounds' };
        // In-bounds but illegal: recorded as an invalid action (tiebreaker,
        // breaks the chain) rather than rejecting the command.
        s.invalid += 1;
        s.chain = 0;
        events.push({ type: 'invalid', reason: check.reason, a: cmd.a, b: cmd.b });
        recomputeTotal(s);
        return { state: s, events };
      }
      const va = s.cells[cmd.a];
      const vb = s.cells[cmd.b];
      s.cells[cmd.a] = 0;
      s.cells[cmd.b] = 0;
      s.moves += 1;
      s.chain += 1;
      s.bestChain = Math.max(s.bestChain, s.chain);
      s.score.pairs += SCORE.PAIR;
      s.score.chain += SCORE.CHAIN_STEP * (s.chain - 1);
      events.push({
        type: 'clear', a: cmd.a, b: cmd.b, va, vb,
        via: check.via, path: check.path, chain: s.chain,
      });
      collapseRows(s, events);
      if (remainingCount(s) === 0) {
        finish(s, events, 'won', 'board-clear');
      } else if (s.limits.moves != null && s.moves >= s.limits.moves) {
        finish(s, events, 'lost', 'move-limit');
      } else {
        recomputeTotal(s);
      }
      return { state: s, events };
    }
    case 'addRows': {
      if (!canAddRows(s)) return { state, error: 'nothing-to-add' };
      const rest = s.cells.filter((c) => c !== 0);
      const pad = (s.cols - (rest.length % s.cols)) % s.cols;
      for (const v of rest) s.cells.push(v);
      for (let i = 0; i < pad; i++) s.cells.push(0);
      s.addRowsUsed += 1;
      s.chain = 0;
      events.push({ type: 'addRows', count: rest.length });
      recomputeTotal(s);
      return { state: s, events };
    }
    case 'giveUp': {
      finish(s, events, 'aborted', 'gave-up');
      return { state: s, events };
    }
    case 'note': // heartbeat / elapsed-time sync; affects only the clock + limits
      recomputeTotal(s);
      return { state: s, events };
    default:
      return { state, error: 'unknown-command' };
  }
}

// ---------------------------------------------------------------------------
// Serialization, migration, hashing (replay + persistence)
// ---------------------------------------------------------------------------

export function serialize(state) {
  return JSON.stringify(state);
}

const MIGRATIONS = {
  // version N -> N+1 handlers live here as the schema evolves
};

export function deserialize(json) {
  const s = typeof json === 'string' ? JSON.parse(json) : json;
  if (!s || typeof s !== 'object' || !Array.isArray(s.cells)) {
    throw new Error('deserialize: not a Pair Sum state');
  }
  let v = s.v ?? 1;
  while (v < RULES_VERSION) {
    const mig = MIGRATIONS[v];
    if (!mig) throw new Error(`deserialize: no migration from v${v}`);
    Object.assign(s, mig(s));
    v = s.v;
  }
  return s;
}

export function hashState(state) {
  // Stable FNV-1a over the authoritative fields (order-independent formatting).
  const parts = [
    state.v, state.cols, state.tick, state.status, state.terminalReason ?? '-',
    state.moves, state.invalid, state.chain, state.addRowsUsed, state.rowsCleared,
    state.elapsedMs, state.score.total, state.cells.join(','),
  ].join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < parts.length; i++) {
    h ^= parts.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// Replay an envelope and report per-checkpoint validity (used by the
// authoritative validation script and by the property tests).
export function replay(envelope) {
  const def = envelope.init;
  let state = createGame(def);
  const checkpoints = [{ after: 0, hash: hashState(state) }];
  const events = [];
  for (const cmd of envelope.commands) {
    const r = applyCommand(state, cmd);
    if (r.error) return { ok: false, error: r.error, atCommand: cmd.id };
    state = r.state;
    events.push(...(r.events || []));
    checkpoints.push({ after: cmd.id, hash: hashState(state) });
  }
  return {
    ok: true,
    final: state,
    finalHash: hashState(state),
    checkpoints,
    events,
  };
}

// Tiebreak order: completion, fewer invalid actions, lower elapsed time,
// then stable session identifier. Returns negative when a ranks above b.
export function compareResults(a, b) {
  const rank = (r) => (r.status === 'won' ? 0 : r.status === 'lost' ? 1 : 2);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (a.score.total !== b.score.total) return b.score.total - a.score.total;
  if (a.invalid !== b.invalid) return a.invalid - b.invalid;
  if (a.elapsedMs !== b.elapsedMs) return a.elapsedMs - b.elapsedMs;
  return String(a.sessionId).localeCompare(String(b.sessionId));
}
