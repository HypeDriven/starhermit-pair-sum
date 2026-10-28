// Pair Sum on the StarHermit engine: the entry module (starhermit.txt
// engine.entry), played natively by the StarHermit client and in browsers by
// the engine's web runtime. The rules (js/rules.js), content (js/content.js)
// and session (js/session.js: the state machine, validated commands, undo,
// lesson gating, snapshots, results) are the browser build's, unchanged in
// what they decide; this module is what js/main.js did around them — the
// screen flow (title → modes → setup → countdown → active ⇄ paused →
// results), starting every mode (Learn, Journey, Daily, Practice, Challenge,
// Score chase), continuing the saved round, the session's events (sounds,
// sparks, alerts, announcements, captions, lesson steps, achievements),
// selection and pairs by taps, clicks, keys and pads (the board cursor
// stands in for the old DOM mirror's focus), hints, undo, Add rows, the
// time limits, the results with personal bests and the high-score post, and
// the lifecycle (a hidden window pauses the round, as visibilitychange did).
// Screens are drawn by screens.ts (starhermit:ui), the board by render.ts
// (starhermit:scene).
//
// Time is the runtime's fixed steps: the session clock advances 1000/60 ms a
// step (the browser build read performance.now()), and the countdown and the
// pause before the results run on it too, so a hidden window and slow frames
// never move them and play scripts replay exactly.
import { clipboard, frame, onFixedUpdate, onPreferencesChange, onRender, onResume, onStart, onSuspend, onUpdate, preferences, setFixedRate } from "starhermit:engine";
import { onAction, onPointerButton, onPointerMove, onTouch, vibrate } from "starhermit:input";
import * as ui from "starhermit:ui";
import { onSessionEnded, requestSignIn } from "starhermit:platform";
import { Content, Progress, Rules, SessionClass, type Def, type GameEvent, type Result, type SessionEvent } from "./game.ts";
import * as audio from "./audio.ts";
import { N, S, T, defTitle } from "./i18n.ts";
import * as platform from "./platform.ts";
import { lookFor } from "./quality.ts";
import * as render from "./render.ts";
import { drawScreens } from "./screens.ts";
import { applyTokens, initStyles } from "./style.ts";

export type ScreenName = "title" | "modes" | "journey" | "setup" | "results" | "help" | "settings" | "achievements" | "boards" | "profile";
export interface Setup {
  kind: "fixed" | "practice" | "learn" | "challenge";
  def?: Def; title: string; note?: string; lesson?: number;
}
export interface Results {
  result: Result; def: Def; isBest: boolean; achievements: string[]; nextLabel: string;
}

// ------------------------------------------------------------------ the session and its platform adapter
const AUTOSAVE = "pairsum:autosave";
let clockMs = 0;
export const session = new SessionClass({
  saveLocal: (key, value) => {
    if (key !== AUTOSAVE) return;
    platform.save().snapshot = value ?? null;
    platform.persist();
  },
  loadLocal: (key) => (key === AUTOSAVE ? platform.save().snapshot : null),
  recordResult: (r) => {
    app.newAchievements = platform.recordResult(r);
    for (const k of app.newAchievements) {
      const a = Content.ACHIEVEMENTS.find((x) => x.key === k);
      toast(T("🎖️ Achievement unlocked: {name}", { name: T(a?.name ?? k.replace(/_/g, " ")) }));
    }
  },
  serverOffsetMs: () => platform.nowMs() - Date.now(),
}, (e) => onSessionEvent(e));
session.clock = () => clockMs;

export const app = {
  /** The full-page screen (main.js ui.currentScreen), or null on the play screen. */
  screen: "title" as ScreenName | null,
  /** Frame the screen opened on (the press that opened it must not also act on it). */
  openedFrame: 0,
  focusNext: null as string | null,
  def: null as Def | null,
  setup: null as Setup | null,
  practiceDiff: "steady",
  boardsTab: "daily",
  results: null as Results | null,
  lb: null as platform.Posted | "posting" | null,
  newAchievements: [] as string[],
  /** The keyboard / pad cursor (the old DOM mirror's focus). */
  cursor: null as number | null,
  /** The cursor ring shows after keys or pad moved it (the old mirror revealed its focus then), not after taps. */
  cursorShown: false,
  /** The countdown's start on the session clock (3, 2, 1, Go!: 0.6 s each), or null. */
  countdownAt: null as number | null,
  lesson: null as string | null,
  alert: null as { text: string; until: number } | null,
  caption: null as { text: string; until: number } | null,
  toasts: [] as { text: string; until: number }[],
  hint: null as { a: number; b: number; until: number } | null,
  resultsAt: null as number | null,
};
const now = (): number => clockMs / 1000;
export const fresh = (): boolean => frame().frame !== app.openedFrame;

// ------------------------------------------------------------------ helpers
export function announce(text: string, assertive = false): void {
  if (text) ui.announce(text.slice(0, 500), { politeness: assertive ? "assertive" : "polite" });
}
export function toast(text: string): void {
  app.toasts.push({ text, until: now() + 3.6 });
  if (app.toasts.length > 4) app.toasts.shift();
}
function showAlert(text: string): void { app.alert = { text, until: now() + 2.2 }; }
function haptic(ms: number): void { if (platform.options.haptics) { try { vibrate(ms); } catch { /* no motor */ } } }
/** Audio captions (Settings › Captions for sounds), in the game language (main.js captionText). */
function caption(text: string): void {
  if (!platform.options.captions) return;
  const m = /^Pair cleared, chain (\d+)$/.exec(text);
  app.caption = { text: m ? T("Pair cleared, chain {n}", { n: m[1]! }) : T(text), until: now() + 1.8 };
}
export const CAPTION_KEYS = [N("Pair cleared"), N("Row cleared"), N("Rows added"), N("That pair is not legal"), N("Board clear!"), N("Round over")];
export function inRound(): boolean {
  const s = session.state;
  return !!s && s.status === "active" && (session.machine === "active" || session.machine === "tutorial");
}
export function playing(): boolean { return inRound() && app.screen === null && app.countdownAt === null; }

// ------------------------------------------------------------------ screens
export function openScreen(name: ScreenName | null): void {
  app.screen = name;
  app.openedFrame = frame().frame;
  ui.setFocus(null);
  render.setActive(name === null);
  if (name === null) render.resetCamera();
}
export function goTitle(): void {
  session.transition("title", "home");
  openScreen("title");
  app.focusNext = "btn-play";
}
/** main.js back(): a screen over a paused round returns to the pause card; Journey and setups go back to the modes. */
export function back(): void {
  if (session.machine === "paused") { openScreen(null); return; }
  if (app.screen === "journey" || app.screen === "setup") { openScreen("modes"); return; }
  goTitle();
}
/** Opening a full-page screen mid-round pauses the round first (main.js pauseForScreen). */
export function pauseForScreen(): void {
  if (inRound()) pauseRound("screen");
}
export function openPlay(): void { openScreen("modes"); session.transition("mode-select", "play"); }

// ------------------------------------------------------------------ modes and setup (main.js openMode)
function isoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((date.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}
function applyTimingAssist(def: Def): void {
  if (platform.options.timingAssist && def.limits?.timeMs) {
    def.limits = { ...def.limits, timeMs: Math.floor(def.limits.timeMs * 1.5) };
    def.assists = { ...def.assists, timingAssist: true };
    def.ranked = false; // the assist makes the result unranked
  }
}
export function dailyDef(): Def { return Content.dailyForDate(new Date(platform.nowMs())); }
let practiceSeq = 0;
function practiceSeed(): string { return `practice-${Date.now()}-${++practiceSeq}`; }
export function openMode(mode: string): void {
  switch (mode) {
    case "learn":
      app.setup = { kind: "learn", title: N("Learn"), note: N("Pick a lesson. Each teaches one rule and asks you to perform it.") };
      openScreen("setup");
      break;
    case "journey":
      openScreen("journey");
      break;
    case "daily": {
      const def = dailyDef();
      applyTimingAssist(def);
      app.setup = { kind: "fixed", def, title: def.title, note: N("Same seed for every player today. Daily seeds are immutable; a defective day is excluded from ranking, never silently replaced.") };
      openScreen("setup");
      app.focusNext = "btn-setup-start";
      break;
    }
    case "practice": {
      const def = Content.practiceDef(app.practiceDiff, practiceSeed());
      applyTimingAssist(def);
      app.setup = { kind: "practice", def, title: N("Practice"), note: N("Unranked. Restart and undo freely.") };
      openScreen("setup");
      break;
    }
    case "challenge":
      app.setup = { kind: "challenge", title: N("Challenge"), note: N("Constrained goals. Ranked where noted.") };
      openScreen("setup");
      break;
    case "score": {
      const d = new Date(platform.nowMs());
      const week = isoWeek(d);
      const seed = `score-${d.getUTCFullYear()}-w${week}`;
      const gen = Content.generateBoard(seed, { rows: 5, cols: 9, minDigit: 1, maxDigit: 9 });
      const filled = gen.cells.filter((c) => c !== 0).length;
      const def = Content.makeDef({
        id: seed, seed, title: `Score chase — week ${week}`, mode: "score", theme: "slate", cells: gen.cells, solution: gen.solution, mult: 1.5,
        mechanics: ["equal-pairs", "sum-pairs", "seq-paths", "add-rows"],
        par: { moves: Math.floor(filled / 2), timeMs: Math.floor(filled / 2) * 4000 },
        assists: { hints: false, undo: false }, ranked: true, goals: { type: "clear", note: N("One shared weekly seed. No assists.") },
      });
      app.setup = { kind: "fixed", def, title: def.title, note: N("Shared weekly seed and ruleset. Results stay on this device; signed in, the global board is shown read-only.") };
      openScreen("setup");
      app.focusNext = "btn-setup-start";
      break;
    }
  }
}
export function pickDifficulty(id: string): void { app.practiceDiff = id; openMode("practice"); }
export function pickStage(def: Def): void {
  app.setup = { kind: "fixed", def, title: def.title, note: def.goals?.note };
  openScreen("setup");
  app.focusNext = "btn-setup-start";
}
export function pickLesson(i: number): void { app.setup = { kind: "learn", title: N("Learn"), lesson: i }; startPending(); }
export function pickChallenge(i: number): void {
  const def = Content.CHALLENGES[i]!.build();
  applyTimingAssist(def);
  app.setup = { kind: "fixed", def, title: def.title };
  startPending();
}
export function startPending(): void {
  const p = app.setup;
  if (!p) return;
  let def: Def | null = null;
  if (p.kind === "fixed") def = p.def ?? null;
  else if (p.kind === "practice") { def = Content.practiceDef(app.practiceDiff, practiceSeed()); applyTimingAssist(def); }
  else if (p.kind === "learn") def = Content.LESSONS[p.lesson ?? 0] ?? null;
  if (!def) return;
  startRound(def);
}

// ------------------------------------------------------------------ rounds
let lastNoteSent = 0;
function startRound(def: Def): void {
  app.def = def;
  app.cursor = null;
  app.results = null;
  app.resultsAt = null;
  app.lb = null;
  app.hint = null;
  app.alert = null;
  lastNoteSent = 0;
  render.clearBoard();
  session.startRound(def);
  openScreen(null);
  if (def.mode === "learn") {
    app.lesson = session.currentLessonStep()?.text ?? null;
    if (app.lesson) announce(T(app.lesson));
    app.countdownAt = null;
    if (session.machine === "countdown" || session.machine === "tutorial") session.beginActive();
  } else {
    app.lesson = null;
    app.countdownAt = clockMs;
    announce("3");
  }
}
export function restartRound(): void {
  if (!app.def) { goTitle(); return; }
  if (app.def.mode === "practice" && app.setup?.kind === "practice") { startPending(); return; }
  startRound(app.def);
}
export function leaveRound(): void {
  session.saveSnapshot();
  goTitle();
}
export function continueRound(): void {
  if (session.restoreSnapshot()) {
    app.def = session.def;
    app.lesson = null;
    app.countdownAt = null;
    app.results = null;
    openScreen(null);
  } else {
    toast(T("No saved round found."));
  }
}
export function skipLesson(): void {
  session.tutorialStep = session.def?.tutorial?.steps?.length ?? 0;
  app.lesson = null;
  if (session.machine === "tutorial") session.transition("active", "lesson-skipped");
}
export function pauseRound(reason = "user"): void {
  if (session.machine !== "active") return;
  session.pause(reason);
  audio.setSuspended(true);
  app.focusNext = "btn-resume";
  app.openedFrame = frame().frame;
}
export function resumeRound(): void {
  session.resume();
  audio.setSuspended(false);
  app.openedFrame = frame().frame;
  ui.setFocus(null);
}
export function pauseSummary(): string {
  const s = session.state;
  if (!s) return "";
  return T("{left} digits left · score {score} · {moves} moves", { left: Rules.remainingCount(s), score: s.score.total, moves: s.moves });
}

function showResults(): void {
  const s = session.state, def = app.def;
  if (!s || !def) return;
  session.transition("results", s.terminalReason ?? "");
  const result = session.replayEnvelope().result!;
  const newly = app.newAchievements;
  app.newAchievements = [];
  const isBest = Progress.isPersonalBest(platform.save(), result);
  const nextLabel = def.mode === "journey" ? N("Next page") : def.mode === "learn" ? N("Next lesson")
    : def.mode === "daily" || def.mode === "score" ? N("Scores") : N("New page");
  app.results = { result, def, isBest, achievements: newly, nextLabel };
  openScreen("results");
  app.focusNext = "btn-retry";
  const won = result.status === "won";
  const headline = T(won ? N("Page cleared!") : result.reason === "time-limit" ? N("Out of time") : result.reason === "move-limit" ? N("Out of moves") : N("Round ended"));
  announce(T("{headline} Total score {n}.", { headline, n: result.score.total }), true);
  postToLeaderboard(result);
}
/** Signed in, a finished ranked round (won or lost, not abandoned) posts its total to the high-score board. */
function postToLeaderboard(result: Result): void {
  app.lb = null;
  if (!app.def?.ranked || !platform.signedIn() || result.status === "aborted") return;
  app.lb = "posting";
  const r0 = app.results;
  void platform.postScore(result.score.total).then((r) => { if (app.results === r0) app.lb = r; });
}
export function leaderboardLine(): string | null {
  const r = app.lb;
  if (!r) return null;
  if (r === "posting") return S("lbPosting");
  return !r.posted ? S("lbNotPosted") : r.rank ? S("lbRank", { rank: r.rank }) : S("lbPosted");
}
export function nextAfterResults(): void {
  const def = app.def;
  if (def?.mode === "journey") {
    const idx = Content.JOURNEY.findIndex((d) => d.id === def.id);
    const next = Content.JOURNEY[idx + 1];
    if (next && platform.save().progress.journey[def.id]?.done) { startRound(next); return; }
    openMode("journey");
    return;
  }
  if (def?.mode === "learn") {
    const idx = Content.LESSONS.findIndex((d) => d.id === def.id);
    const next = Content.LESSONS[idx + 1];
    if (next) { app.setup = { kind: "learn", title: N("Learn"), lesson: idx + 1 }; startRound(next); return; }
    goTitle();
    return;
  }
  if (def?.mode === "daily" || def?.mode === "score") {
    app.boardsTab = def.mode;
    openScreen("boards");
    return;
  }
  restartRound();
}

// ------------------------------------------------------------------ session events (main.js onSessionEvent)
function hintText(a: number, b: number, via: string): string {
  const s = session.state!;
  const key = via === "row" ? N("Hint: connect the {a} and {b}, along the same row.")
    : via === "col" ? N("Hint: connect the {a} and {b}, along the same column.")
      : N("Hint: connect the {a} and {b}, along the fold between rows.");
  return T(key, { a: s.cells[a]!, b: s.cells[b]! });
}
export function invalidReasonText(reason: string): string {
  return T(({
    "no-match": N("Those digits do not match — pairs must be equal or sum to ten."),
    "blocked": N("The path is blocked by other digits."),
    "same-cell": N("Pick two different cells."),
    "empty-cell": N("That cell is already cleared."),
    "round-over": N("The round is over."),
  } as Record<string, string>)[reason] ?? N("That move is not legal."));
}
function audioFor(e: GameEvent): void {
  if (e.type === "clear") { caption(`Pair cleared${(e.chain ?? 1) > 1 ? `, chain ${e.chain}` : ""}`); audio.play((e.chain ?? 1) > 1 ? "clearChain" : "clear"); }
  else if (e.type === "collapse") { caption("Row cleared"); audio.play("collapse"); }
  else if (e.type === "addRows") { caption("Rows added"); audio.play("addRows"); }
  else if (e.type === "invalid") { caption("That pair is not legal"); audio.play("invalid"); }
  else if (e.type === "win") { caption("Board clear!"); audio.play("win"); }
  else if (e.type === "lose") { caption("Round over"); audio.play("lose"); }
}
function onSessionEvent(e: SessionEvent): void {
  switch (e.type) {
    case "round":
      app.def = e.def ?? app.def;
      app.cursor = null;
      syncRender(true);
      break;
    case "game-event": {
      const ev = e.event!;
      audioFor(ev);
      render.onGameEvent(ev);
      if (ev.type === "clear") { audio.excite(); haptic(15); }
      if (ev.type === "invalid") { showAlert(invalidReasonText(ev.reason ?? "")); announce(invalidReasonText(ev.reason ?? ""), true); haptic(40); }
      if (ev.type === "win" || ev.type === "lose") {
        app.resultsAt = clockMs + (ev.type === "win" ? 1200 : 600);
      }
      syncRender(false);
      break;
    }
    case "select":
      audio.play(e.index == null ? "deselect" : "select");
      render.setSelection(session.selection, legalTargets());
      if (session.selection == null) render.previewPath(null);
      break;
    case "hint":
      if (e.none) {
        showAlert(e.canAddRows ? T("No pairs connect — try Add Rows.") : T("No moves left."));
        announce(e.canAddRows ? T("No legal pairs. Use Add Rows.") : T("No moves left."), true);
      } else if (e.a != null && e.b != null) {
        audio.play("hint");
        announce(hintText(e.a, e.b, e.via ?? "seq"));
        render.setHint(e.a, e.b);
        app.hint = { a: e.a, b: e.b, until: now() + 2.4 };
      }
      break;
    case "undo":
      audio.play("undo");
      syncRender(false);
      announce(T("Undone."));
      break;
    case "lesson-step":
      if (e.done) {
        app.lesson = null;
        toast(T("Lesson complete — finish the page!"));
        announce(T("Lesson steps complete. Clear the rest of the page."));
        if (session.machine === "tutorial") session.transition("active", "lesson-steps-done");
      } else if (e.step) {
        app.lesson = e.step.text;
        announce(T(e.step.text));
      }
      break;
    case "lesson-blocked":
      showAlert(T("That is not the lesson move."));
      announce(e.stepText ? T("Follow the lesson: {step}", { step: T(e.stepText) }) : T(e.message ?? ""), true);
      break;
    case "while-away": {
      const text = T("Round restored. You were away {min} min; {left} digits remain, score {score}.", { min: e.awayMin ?? 1, left: e.remaining ?? 0, score: e.score ?? 0 });
      toast(text);
      announce(text);
      break;
    }
  }
}
export function legalTargets(): number[] {
  const s = session.state, sel = session.selection;
  if (!s || sel == null) return [];
  return Rules.listLegalPairs(s).filter((p) => p.a === sel || p.b === sel).map((p) => (p.a === sel ? p.b : p.a));
}
function syncRender(force: boolean): void {
  if (session.state) render.syncState(session.state, session.selection, legalTargets(), force);
}

// ------------------------------------------------------------------ round actions (tray, keys, taps)
export function tapCell(i: number): void {
  if (!playing()) return;
  session.tapCell(i);
  app.cursor = i;
  app.cursorShown = false;
}
export function doHint(): void { if (playing()) session.hint(); }
export function doUndo(): void { if (playing()) session.undo(); }
export function doAddRows(): void { if (playing()) session.addRows(); }
export function doPause(): void { if (playing()) pauseRound("user"); }
export function resetCamera(): void { render.resetCamera(); toast(T("Camera reset.")); }
export function signIn(): void { void requestSignIn().catch(() => undefined); }
export function copyInvite(): void {
  const link = platform.inviteLink();
  if (!link) return;
  try { clipboard.writeText(link); toast(S("copied")); } catch { toast(S("copyFailed")); }
}

function previewForCursor(): void {
  if (app.cursor == null || session.selection == null) { render.previewPath(null); return; }
  const check = session.legalTargetPreview(app.cursor);
  render.previewPath(check);
  if (check && !check.ok && check.reason) announce(T("Not legal: {reason}", { reason: invalidReasonText(check.reason) }));
  else if (check?.ok) announce(T("Legal target. Press Enter to connect."));
}
/** main.js moveGrid: the nearest occupied cell in a screen direction. */
function moveCursor(dr: number, dc: number): void {
  const s = session.state!;
  const cols = s.cols, cells = s.cells;
  const filled: number[] = [];
  for (let i = 0; i < cells.length; i++) if (cells[i] !== 0) filled.push(i);
  if (!filled.length) return;
  if (app.cursor == null || cells[app.cursor] === 0) app.cursor = filled[0]!;
  else {
    const r0 = Math.floor(app.cursor / cols), c0 = app.cursor % cols;
    let best: number | null = null, bestScore = Infinity;
    for (const i of filled) {
      if (i === app.cursor) continue;
      const dRow = Math.floor(i / cols) - r0, dCol = (i % cols) - c0;
      if (dr < 0 && dRow >= 0) continue;
      if (dr > 0 && dRow <= 0) continue;
      if (dc < 0 && dCol >= 0) continue;
      if (dc > 0 && dCol <= 0) continue;
      const score = Math.abs(dRow) * 10 + Math.abs(dCol);
      if (score < bestScore) { bestScore = score; best = i; }
    }
    if (best != null) app.cursor = best;
  }
  app.cursorShown = true;
  const v = cells[app.cursor]!;
  announce(T("Row {r}, column {c}, digit {v}", { r: Math.floor(app.cursor / cols) + 1, c: (app.cursor % cols) + 1, v }));
  previewForCursor();
}

onAction((e) => {
  if (!e.pressed || ui.capturingKeys()) return;
  const a = e.action;
  if (a === "cancel") {
    if (!fresh()) return;
    // Escape is Back on any open screen; from a screen over a paused round this returns to the pause card.
    if (app.screen) { if (app.screen !== "title") back(); return; }
    if (session.machine === "paused") return; // the pause card's own close resumes
    if (inRound() && app.countdownAt === null) {
      if (session.selection != null) { session.tapCell(session.selection); render.previewPath(null); }
      else pauseRound("user");
    }
    return;
  }
  if (!playing()) return;
  if (a === "hint") doHint();
  else if (a === "undo") doUndo();
  else if (a === "addrows") doAddRows();
  else if (a === "camera") resetCamera();
  else if (a === "left" || a === "right" || a === "up" || a === "down") {
    ui.setFocus(null);
    moveCursor(a === "up" ? -1 : a === "down" ? 1 : 0, a === "left" ? -1 : a === "right" ? 1 : 0);
  } else if (a === "choose") {
    if (ui.focused() !== null) return; // Enter / Space on a focused button is the button's
    if (app.cursor == null || session.state!.cells[app.cursor] === 0) { moveCursor(0, 0); return; }
    tapCell(app.cursor);
    app.cursorShown = true;
    previewForCursor();
  }
});

// ------------------------------------------------------------------ taps on the board (main.js wireCanvasInput)
/** Rectangles (window pixels) where a press belongs to the UI, set by screens.ts each frame. */
export const hudRects: { x: number; y: number; width: number; height: number }[] = [];
/** The stage (window pixels) and the part of it the board is fitted into, set by screens.ts. */
export const stage: render.Rect = { x: 0, y: 0, width: 0, height: 0 };
export const free: render.Rect = { x: 0, y: 0, width: 0, height: 0 };
const inStage = (x: number, y: number): boolean => x >= stage.x && y >= stage.y && x <= stage.x + stage.width && y <= stage.y + stage.height;
const onHud = (x: number, y: number): boolean => hudRects.some((r) => x >= r.x && y >= r.y && x <= r.x + r.width && y <= r.y + r.height);
type PEvent = { kind: "down" | "up" | "cancel"; x: number; y: number; id: number };
const events: PEvent[] = [];
let lastTouch = -1e9;
let press: { x: number; y: number; t: number; id: number } | null = null;
let hover: { x: number; y: number } | null = null;
onTouch((e) => {
  lastTouch = now();
  if (e.control) return;
  if (e.phase === "start") events.push({ kind: "down", x: e.x, y: e.y, id: e.id });
  else if (e.phase === "end") events.push({ kind: "up", x: e.x, y: e.y, id: e.id });
  else if (e.phase !== "move") events.push({ kind: "cancel", x: e.x, y: e.y, id: e.id });
});
onPointerButton((e) => {
  if (e.button !== 0 || now() - lastTouch < 0.6) return;
  events.push({ kind: e.pressed ? "down" : "up", x: e.x, y: e.y, id: -1 });
});
onPointerMove((x, y) => { if (now() - lastTouch >= 0.6) hover = { x, y }; });
/** Tap vs drag by distance (12 px) and time (0.6 s); a tap off the tokens deselects; hover previews the path. */
function pointerInput(): void {
  const sc = frame().scale;
  for (const ev of events.splice(0)) {
    if (ev.kind === "down") {
      press = null;
      if (!playing() || !inStage(ev.x, ev.y) || onHud(ev.x, ev.y)) continue;
      press = { x: ev.x, y: ev.y, t: frame().time, id: ev.id };
      continue;
    }
    if (!press || press.id !== ev.id) continue;
    const p = press;
    press = null;
    if (ev.kind === "cancel" || !playing()) { render.previewPath(null); continue; }
    if (Math.hypot(ev.x - p.x, ev.y - p.y) < 12 * sc && frame().time - p.t < 0.6) {
      ui.setFocus(null);
      const cell = render.pickCell(ev.x, ev.y);
      if (cell != null) tapCell(cell);
      else if (session.selection != null) { session.tapCell(session.selection); app.cursor = null; }
    }
    render.previewPath(null);
  }
  if (hover && playing() && session.selection != null && inStage(hover.x, hover.y) && !onHud(hover.x, hover.y) && !app.cursorShown) {
    const cell = render.pickCell(hover.x, hover.y);
    render.previewPath(cell != null && cell !== session.selection ? session.legalTargetPreview(cell) : null);
  }
}

// ------------------------------------------------------------------ the clock
let hidden = false;
onFixedUpdate(() => {
  if (hidden) return;
  clockMs += 1000 / 60;
  // The countdown (ui.js countdown: 3, 2, 1, Go! at 0.6 s each).
  if (app.countdownAt !== null) {
    const k = Math.floor((clockMs - app.countdownAt) / 600);
    const prev = Math.floor((clockMs - 1000 / 60 - app.countdownAt) / 600);
    if (k !== prev && k >= 1 && k <= 3) announce(k === 3 ? T("Go!") : String(3 - k));
    if (k >= 4) {
      app.countdownAt = null;
      if (session.machine === "countdown" || session.machine === "tutorial") session.beginActive();
    }
  }
  // The resolution phase → results (main.js setTimeout 1200 / 600 ms).
  if (app.resultsAt !== null && clockMs >= app.resultsAt) { app.resultsAt = null; showResults(); }
  // Time limits: enforced through a command at most once a second (main.js frame).
  const s = session.state;
  if (s && s.limits.timeMs != null && s.status === "active" && (session.machine === "active" || session.machine === "tutorial")) {
    const t = session.nowMs();
    if (t - lastNoteSent > 1000) {
      lastNoteSent = t;
      if (t > s.limits.timeMs) session.dispatch({ type: "note" });
    }
  }
});

// ------------------------------------------------------------------ boot and lifecycle
let lookKey = "";
function applyLook(): void {
  const f = frame();
  const k = `${f.quality}:${f.levelIndex}`;
  if (k === lookKey) return;
  lookKey = k;
  render.applyLook(lookFor(f.quality, f.levelIndex));
}
export function currentLook(): ReturnType<typeof lookFor> { const f = frame(); return lookFor(f.quality, f.levelIndex); }
function applyOptions(): void {
  render.setTheme(platform.options.theme);
  render.setPalette(platform.options.palette);
}

onStart(() => {
  setFixedRate(60);
  initStyles();
  platform.initPlatform();
  audio.loadSfx();
  render.setReducedMotion(preferences().reducedMotion);
  applyLook();
  applyOptions();
  session.transition("title", "boot-complete");
  openScreen("title");
  app.focusNext = "btn-play";
});
onPreferencesChange((p) => render.setReducedMotion(p.reducedMotion));
platform.onOptionsChange(() => applyOptions());
platform.onProgressMerged(() => { if (app.screen === "title") announce(T("Progress restored from your StarHermit cloud save.")); });
onSessionEnded(() => toast(S("signedOut"))); // keep playing locally
onSuspend(() => {
  hidden = true;
  // Backgrounding pauses solo play (the player resumes from the pause card).
  if (session.machine === "active") pauseRound("background");
  audio.setSuspended(true);
  platform.flush();
});
onResume(() => { hidden = false; if (session.machine !== "paused") audio.setSuspended(false); });

let frameDt = 0;
onUpdate((dt) => {
  frameDt = dt;
  applyLook();
  applyTokens(platform.options.theme, ui.preferences().highContrast);
  audio.update(dt);
  const t = now();
  if (app.alert && app.alert.until < t) app.alert = null;
  if (app.caption && app.caption.until < t) app.caption = null;
  if (app.hint && app.hint.until < t) app.hint = null;
  app.toasts = app.toasts.filter((x) => x.until >= t);
});
const pending: (() => void)[] = [];
/** A widget's press, run once the frame's UI is built (state changes mid-build would break later widgets). */
export function later(fn: () => void): void { pending.push(fn); }
onRender(() => {
  hudRects.length = 0;
  drawScreens();
  for (const fn of pending.splice(0)) fn();
  pointerInput();
  const f = frame();
  render.update(frameDt, f.width, f.height, free);
});
export { defTitle };
