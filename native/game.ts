// The browser build's pure game modules (shared with the node tests), typed
// for this client: the rules (js/rules.js: legality, paths, scoring, replay),
// the content (js/content.js: themes, generator, lessons, the 40 Journey
// pages, the Daily, practice, challenges, achievements), the session
// (js/session.js: the state machine, validated commands, undo, lesson gating,
// snapshots, results) and the save (js/progress.js).
import * as rules from "../js/rules.js";
import * as content from "../js/content.js";
import * as session from "../js/session.js";
import * as progress from "../js/progress.js";

export interface Score { pairs: number; chain: number; rows: number; clear: number; time: number; total: number }
export interface State {
  v: number; seed: string; contentId: string | null; mode: string; cols: number; cells: number[]; tick: number; nextCmdId: number;
  status: "active" | "won" | "lost" | "aborted"; terminalReason: string | null; elapsedMs: number; moves: number; invalid: number;
  chain: number; bestChain: number; addRowsUsed: number; rowsCleared: number; score: Score;
  limits: { moves: number | null; timeMs: number | null }; par: { moves: number | null; timeMs: number | null }; mult: number; mechanics: string[];
}
export interface LessonStep { text: string; require: { type: string; values?: number[] } }
export interface Def {
  v: number; rulesV: number; id: string; seed: string; cols: number; cells: number[]; solution: [number, number][] | null;
  goals: { type: string; mastery?: boolean; note?: string; daily?: string }; limits: { moves?: number; timeMs?: number };
  par: { moves?: number; timeMs?: number }; mult: number; mechanics: string[]; tutorial: { steps: LessonStep[] } | null;
  theme: string; mode: string; title: string; assists: { hints: boolean; undo: boolean; timingAssist?: boolean }; ranked: boolean;
}
export interface Theme {
  id: string; name: string; paper: string; ink: string; rule: string; margin: string; token: string; tokenEdge: string;
  accent: string; select: string; legal: string; danger: string; sky: string;
}
export interface Check { ok: boolean; reason: string | null; via?: string; path?: number[]; a?: number; b?: number }
export interface Pair { a: number; b: number; via: string }
export interface GameEvent { type: string; a?: number; b?: number; chain?: number; reason?: string; rows?: number[]; via?: string; count?: number }
export interface Result {
  contentId: string; mode: string; seed: string; status: string; reason: string | null; score: Score; moves: number; invalid: number;
  elapsedMs: number; bestChain: number; addRowsUsed: number; pathTallies?: { row: number; col: number; seq: number }; sessionId: string; at: number;
}
export interface SessionEvent {
  type: string; event?: GameEvent; state?: State; def?: Def; index?: number | null; reason?: string; none?: boolean; canAddRows?: boolean;
  a?: number; b?: number; via?: string; step?: LessonStep | null; done?: boolean; message?: string; stepText?: string | null;
  awayMin?: number; remaining?: number; score?: number;
}
export interface Envelope { result: Result | null }
export interface SessionPlatform {
  saveLocal(key: string, value: unknown): void;
  loadLocal(key: string): unknown;
  recordResult(r: Result): void;
  serverOffsetMs(): number;
}
export interface Session {
  machine: string; def: Def | null; state: State | null; selection: number | null; tutorialStep: number; sessionId: string;
  clock: () => number; onTransition: ((from: string, to: string, reason: string) => void) | null;
  transition(to: string, reason: string): void;
  nowMs(): number;
  startRound(def: Def): void; beginActive(): void; pause(reason?: string): void; resume(): void; background(): void;
  dispatch(cmd: { type: string }): { error?: string };
  tapCell(i: number): { error?: string };
  addRows(): { error?: string };
  giveUp(): { error?: string };
  hint(): Pair | null;
  legalTargetPreview(i: number): Check | null;
  undoAllowed(): boolean; undo(): { error?: string };
  currentLessonStep(): LessonStep | null;
  saveSnapshot(): void; restoreSnapshot(): unknown; hasSnapshot(): boolean; clearAutosave(): void;
  replayEnvelope(): Envelope;
}
export interface Achievement { key: string; name: string; desc: string }
export interface Difficulty { id: string; name: string; rows: number; min: number; max: number; mult: number; note: string }
export interface Challenge { id: string; name: string; note: string; build(): Def }
export interface Progress {
  v: number; rev?: number; journey: Record<string, { done: boolean; best: number; stars: number }>;
  achievements: Record<string, { at: number }>; totals: { pairs: number; clears: number }; streakDays: string[];
  bestDaily: Record<string, number>; mastery: Record<string, boolean>;
}
export interface SaveDoc { v: number; progress: Progress; results: Result[]; snapshot: unknown; name: string }
export interface Options { theme: string; palette: string; leftHanded: boolean; haptics: boolean; timingAssist: boolean; captions: boolean }
export interface BoardRow { score: number; moves: number; elapsedMs: number; status: string; seed: string }

interface RulesApi {
  TARGET_SUM: number; DEFAULT_COLS: number;
  remainingCount(s: State): number; listLegalPairs(s: State): Pair[]; checkPair(s: State, a: number, b: number): Check;
  createStream(seed: string | number): { next(): number; int(lo: number, hi: number): number };
  hashSeed(s: string): number;
}
interface ContentApi {
  THEMES: Theme[]; LESSONS: Def[]; JOURNEY: Def[]; PRACTICE_DIFFICULTIES: Difficulty[]; CHALLENGES: Challenge[]; ACHIEVEMENTS: Achievement[];
  getTheme(id: string): Theme; dailyForDate(d: Date): Def; practiceDef(id: string, seed?: string): Def;
  makeDef(p: Record<string, unknown>): Def; generateBoard(seed: string, p: Record<string, unknown>): { cells: number[]; cols: number; solution: [number, number][] };
}
interface ProgressApi {
  defaultSave(): SaveDoc; normalize(raw: unknown): SaveDoc; mergeSave(remote: unknown, local: unknown): SaveDoc; sameSave(a: unknown, b: unknown): boolean;
  readForeign(text: string): SaveDoc | null; recordResult(save: SaveDoc, r: Result, today: string, now?: number): string[];
  localBoard(save: SaveDoc, board: string): BoardRow[]; isPersonalBest(save: SaveDoc, r: Result): boolean;
  DEFAULT_OPTIONS: Options; OPTION_KEYS: (keyof Options)[]; BROWSER_KEYS: string[]; THEME_IDS: string[]; PALETTES: string[];
  pickOptions(raw: unknown): Partial<Options>;
}

export const Rules = rules as unknown as RulesApi;
export const Content = content as unknown as ContentApi;
export const Progress = progress as unknown as ProgressApi;
export const SessionClass = (session as unknown as { Session: new (p: SessionPlatform, emit: (e: SessionEvent) => void) => Session }).Session;
