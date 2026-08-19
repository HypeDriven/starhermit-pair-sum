// Pair Sum — session controller.
// Owns the game-state machine and every transition's reason; routes all rules
// changes through validated commands; keeps undo snapshots, the replay
// envelope, tutorial gating, and the authoritative session clock.

import {
  createGame, applyCommand, serialize, deserialize, hashState, replay,
  checkPair, getHint, canAddRows, remainingCount, listLegalPairs,
} from './rules.js';

export const MACHINE_STATES = [
  'boot', 'title', 'profile-ready', 'mode-select', 'preparing',
  'tutorial', 'countdown', 'active', 'paused', 'reconnecting',
  'resolving', 'results', 'progression',
];

const AUTOSAVE_KEY = 'pairsum:autosave';

export class Session {
  constructor(platform, emit) {
    this.platform = platform;   // persistence + hosted adapter
    this.emit = emit;           // (event) => void  UI/render/audio sink
    this.machine = 'boot';
    this.machineReason = 'init';
    this.def = null;
    this.state = null;          // rules state (immutable snapshots)
    this.selection = null;      // UI-level selected cell index
    this.undoStack = [];        // serialized snapshots (practice/journey/learn)
    this.commands = [];         // ordered applied commands (replay log)
    this.checkpoints = [];      // periodic state hashes
    this.sessionId = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
    this.startStamp = 0;        // perf clock when round went active
    this.pauseAccum = 0;
    this.pauseStart = 0;
    this.tutorialStep = 0;
    this.pathTallies = { row: 0, col: 0, seq: 0 }; // achievement tracking
    this.onTransition = null;
  }

  transition(to, reason) {
    if (!MACHINE_STATES.includes(to)) throw new Error(`unknown machine state ${to}`);
    const from = this.machine;
    this.machine = to;
    this.machineReason = reason;
    this.onTransition?.(from, to, reason);
    this.emit({ type: 'machine', from, to, reason });
  }

  // --- clock ---------------------------------------------------------------
  nowMs() {
    if (this.machine !== 'active' && this.machine !== 'resolving') return this.state?.elapsedMs ?? 0;
    return this.pauseAccum + (performance.now() - this.startStamp);
  }

  // --- round lifecycle -----------------------------------------------------
  startRound(def) {
    this.def = def;
    this.state = createGame(def);
    this.selection = null;
    this.undoStack = [];
    this.commands = [];
    this.checkpoints = [{ after: 0, hash: hashState(this.state) }];
    this.tutorialStep = 0;
    this.pathTallies = { row: 0, col: 0, seq: 0 };
    this.pauseAccum = 0;
    this.transition(def.mode === 'learn' ? 'tutorial' : 'countdown', `start:${def.id}`);
    this.emit({ type: 'round', def, state: this.state });
  }

  beginActive() {
    this.startStamp = performance.now();
    this.pauseAccum = this.state?.elapsedMs ?? 0;
    this.transition('active', 'countdown-complete');
  }

  pause(reason = 'user') {
    if (this.machine !== 'active') return;
    this.pauseAccum = this.nowMs();
    this.pauseStart = performance.now();
    this.transition('paused', reason);
    this.saveSnapshot();
  }

  resume() {
    if (this.machine !== 'paused' && this.machine !== 'reconnecting') return;
    this.startStamp = performance.now();
    this.transition('active', `resume:${this.machineReason}`);
  }

  // Backgrounding pauses solo simulation; on return we rebuild from the last
  // safe snapshot and summarize what happened while away.
  background() {
    if (this.machine === 'active') this.pause('background');
  }

  // --- commands ------------------------------------------------------------
  dispatch(cmd) {
    if (!this.state) return { error: 'no-round' };
    const withMeta = { id: this.state.nextCmdId, at: Math.floor(this.nowMs()), ...cmd };
    const r = applyCommand(this.state, withMeta);
    if (r.error) return r;
    this.state = r.state;
    this.commands.push(withMeta);
    if (this.commands.length % 5 === 0 || this.state.status !== 'active') {
      this.checkpoints.push({ after: withMeta.id, hash: hashState(this.state) });
    }
    for (const e of r.events || []) {
      if (e.type === 'clear') this.pathTallies[e.via] = (this.pathTallies[e.via] || 0) + 1;
      this.emit({ type: 'game-event', event: e, state: this.state });
    }
    if (this.state.status !== 'active') {
      this.transition('resolving', this.state.terminalReason);
      this.saveResult();
      this.clearAutosave();
      this.emit({ type: 'round-end', state: this.state, def: this.def });
    }
    return r;
  }

  // Selection + pair attempt with lesson gating and invalid explanations.
  tapCell(index) {
    if (this.machine !== 'active' && this.machine !== 'tutorial') return { error: 'not-active' };
    if (!this.state || this.state.status !== 'active') return { error: 'round-over' };
    if (this.state.cells[index] === 0) {
      this.selection = null;
      this.emit({ type: 'select', index: null });
      return { ok: true };
    }
    if (this.selection === null) {
      this.selection = index;
      this.emit({ type: 'select', index });
      return { ok: true };
    }
    if (this.selection === index) {
      this.selection = null;
      this.emit({ type: 'select', index: null });
      return { ok: true };
    }
    const a = this.selection;
    const b = index;
    // Tutorials gate on the lesson's required action before touching rules.
    const gate = this.lessonGate({ type: 'pair', a, b });
    if (gate) {
      this.emit({ type: 'lesson-blocked', message: gate });
      this.selection = null;
      this.emit({ type: 'select', index: null });
      return { error: 'lesson-gated' };
    }
    const legality = checkPair(this.state, a, b);
    if (!legality.ok) {
      // Legal API drives the explanation; rules still record the invalid try.
      this.dispatch({ type: 'pair', a, b });
      this.selection = null;
      this.emit({ type: 'select', index: null });
      this.emit({ type: 'invalid', reason: legality.reason, a, b });
      return { error: legality.reason };
    }
    this.pushUndo();
    const r = this.dispatch({ type: 'pair', a, b });
    this.selection = null;
    this.emit({ type: 'select', index: null });
    if (!r.error) this.advanceLesson({ type: 'pair', a, b, state: this.state });
    return r;
  }

  addRows() {
    if (this.machine !== 'active' && this.machine !== 'tutorial') return { error: 'not-active' };
    const gate = this.lessonGate({ type: 'addRows' });
    if (gate) {
      this.emit({ type: 'lesson-blocked', message: gate });
      return { error: 'lesson-gated' };
    }
    if (!canAddRows(this.state)) return { error: 'nothing-to-add' };
    this.pushUndo();
    const r = this.dispatch({ type: 'addRows' });
    if (!r.error) this.advanceLesson({ type: 'addRows' });
    return r;
  }

  giveUp() {
    if (!this.state || this.state.status !== 'active') return { error: 'round-over' };
    return this.dispatch({ type: 'giveUp' });
  }

  hint() {
    if (!this.def?.assists?.hints) return { error: 'hints-disabled' };
    const h = getHint(this.state);
    if (h) this.emit({ type: 'hint', ...h });
    else this.emit({ type: 'hint', none: true, canAddRows: canAddRows(this.state) });
    return h;
  }

  legalTargetPreview(index) {
    // Used by hover/focus: preview what connecting the current selection to
    // `index` would do, without committing.
    if (this.selection === null || this.selection === index) return null;
    return checkPair(this.state, this.selection, index);
  }

  // --- undo ----------------------------------------------------------------
  undoAllowed() {
    return !!this.def?.assists?.undo && this.undoStack.length > 0 &&
      this.state?.status === 'active' &&
      (this.machine === 'active' || this.machine === 'tutorial');
  }

  pushUndo() {
    if (!this.def?.assists?.undo) return;
    this.undoStack.push(serialize(this.state));
    if (this.undoStack.length > 100) this.undoStack.shift();
  }

  undo() {
    if (!this.undoAllowed()) return { error: 'undo-unavailable' };
    this.state = deserialize(this.undoStack.pop());
    this.selection = null;
    this.commands.push({ id: -1, at: Math.floor(this.nowMs()), type: 'undo-marker' });
    this.emit({ type: 'undo', state: this.state });
    return { ok: true };
  }

  // --- lessons ---------------------------------------------------------------
  currentLessonStep() {
    const steps = this.def?.tutorial?.steps;
    if (!steps || this.tutorialStep >= steps.length) return null;
    return steps[this.tutorialStep];
  }

  lessonGate(action) {
    const step = this.currentLessonStep();
    if (!step) return null;
    const req = step.require;
    if (req.type === 'any-pair' && action.type === 'pair') return null;
    if (req.type === 'any-addrows' && action.type === 'addRows') return null;
    if (req.type === 'pair' && action.type === 'pair') {
      const got = [this.state.cells[action.a], this.state.cells[action.b]]
        .sort((x, y) => x - y).join(',');
      const want = req.values.slice().sort((x, y) => x - y).join(',');
      if (got === want) return null;
    }
    return 'Follow the lesson: ' + step.text;
  }

  advanceLesson(action) {
    const step = this.currentLessonStep();
    if (!step) return;
    this.tutorialStep += 1;
    const next = this.currentLessonStep();
    this.emit({ type: 'lesson-step', index: this.tutorialStep, step: next, done: !next });
  }

  // --- persistence / replay --------------------------------------------------
  saveSnapshot() {
    if (!this.state || this.state.status !== 'active') return;
    const snap = {
      v: 1, def: this.def, state: serialize(this.state),
      commands: this.commands.filter((c) => c.id > 0),
      savedAt: Date.now(), sessionId: this.sessionId,
    };
    this.platform.saveLocal(AUTOSAVE_KEY, snap);
  }

  // Reconnect from the durable snapshot, not from cached client memory.
  restoreSnapshot() {
    const snap = this.platform.loadLocal(AUTOSAVE_KEY);
    if (!snap) return null;
    try {
      this.def = snap.def;
      this.state = deserialize(snap.state);
      this.commands = snap.commands || [];
      this.sessionId = snap.sessionId || this.sessionId;
      this.selection = null;
      this.undoStack = [];
      const awayMs = Date.now() - (snap.savedAt || Date.now());
      this.transition('paused', 'reconnect');
      this.emit({ type: 'round', def: this.def, state: this.state });
      this.emit({
        type: 'while-away',
        summary: `Round restored. You were away ${Math.max(1, Math.round(awayMs / 60000))} min; ` +
          `${remainingCount(this.state)} digits remain, score ${this.state.score.total}.`,
      });
      return snap;
    } catch {
      this.clearAutosave();
      return null;
    }
  }

  hasSnapshot() {
    return !!this.platform.loadLocal(AUTOSAVE_KEY);
  }

  clearAutosave() {
    this.platform.saveLocal(AUTOSAVE_KEY, null);
  }

  replayEnvelope() {
    return {
      schema: 1,
      build: this.def?.rulesV ?? 1,
      contentV: this.def?.v ?? 1,
      contentId: this.def?.id ?? null,
      seed: this.def?.seed,
      init: {
        seed: this.def.seed, cols: this.def.cols, cells: this.def.cells,
        limits: this.def.limits, par: this.def.par, mult: this.def.mult,
        mode: this.def.mode, contentId: this.def.id, mechanics: this.def.mechanics,
      },
      initHash: this.checkpoints[0]?.hash,
      timestampOffset: this.platform.serverOffsetMs?.() ?? 0,
      commands: this.commands.filter((c) => c.id > 0),
      checkpoints: this.checkpoints,
      result: this.state
        ? {
            status: this.state.status, reason: this.state.terminalReason,
            seed: this.def?.seed, contentId: this.def?.id, mode: this.def?.mode,
            score: { ...this.state.score }, moves: this.state.moves,
            invalid: this.state.invalid, elapsedMs: this.state.elapsedMs,
            addRowsUsed: this.state.addRowsUsed, bestChain: this.state.bestChain,
            sessionId: this.sessionId,
          }
        : null,
    };
  }

  verifyOwnReplay() {
    const env = this.replayEnvelope();
    const r = replay(env);
    return r.ok && r.finalHash === this.checkpoints[this.checkpoints.length - 1]?.hash;
  }

  saveResult() {
    const result = {
      contentId: this.def.id, mode: this.def.mode, seed: this.def.seed,
      status: this.state.status, reason: this.state.terminalReason,
      score: { ...this.state.score }, moves: this.state.moves,
      invalid: this.state.invalid, elapsedMs: this.state.elapsedMs,
      bestChain: this.state.bestChain, addRowsUsed: this.state.addRowsUsed,
      pathTallies: { ...this.pathTallies },
      sessionId: this.sessionId, at: Date.now(),
      assists: this.def.assists, rulesV: this.def.rulesV, contentV: this.def.v,
      durationMs: this.state.elapsedMs,
    };
    this.platform.recordResult(result, this.replayEnvelope());
  }
}
