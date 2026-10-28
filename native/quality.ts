// The look per graphics level: the browser build's four presets and budgets
// (js/gfx.js TABLE / BUDGETS, each tuned to hold 60 FPS on the weakest GPU
// its Auto gave it) keyed by the runtime's quality tier (frame().quality),
// with the spark pool and the dust motes scaled within the tier by the level
// (frame().levelIndex, at most 2×), as the browser build scaled them by its
// hardware level. The runtime owns the rest of what the old Graphics panel
// did: Auto and the level choice, render scale and the pixel-ratio cap,
// adaptive resolution, the frame-rate limit and readout. The old panel's
// per-effect overrides are not offered (the runtime's Options choose a level).
import type { QualityTier } from "starhermit:engine";
import type { AntialiasMode } from "starhermit:scene";

export interface Budget {
  /** Token and paper shading: Lambert (Low), Standard (Balanced), clear-coated Physical tokens (High/Ultra). */
  material: "lambert" | "standard" | "physical";
  /** Digit-face texture size in px. */
  digit: number;
  /** Ruled-paper texture size in px. */
  paper: number;
  /** Token corner / bevel segments (Surface detail Detailed; Plain keeps 2 / 1). */
  curve: number;
  bevel: number;
  /** Paper-fibre bump map (Detailed). */
  paperBump: boolean;
  /** Spark pool at Particles High (Low: 20 %). */
  sparks: number;
  /** Dust motes at Particles High (Low: half; Ambient motion on). */
  motes: number;
  /** Bloom / GTAO resolution (fraction of the frame). */
  bloomRes: number;
  aoRes: number;
}
export interface Look {
  preset: QualityTier;
  /** Key-light shadow map (0 = off: soft blob shadows ground the tokens). */
  shadows: 0 | 1024 | 2048 | 4096;
  ao: "off" | "on" | "high";
  bloom: boolean;
  grade: boolean;
  antialias: AntialiasMode;
  particles: "low" | "high";
  /** Ambient motion: dust motes, the lamp shimmer, the idle bob of the tokens and the title tiles. */
  ambient: boolean;
  /** Surface detail Detailed: bevelled tokens, slot outlines, the fibre bump, ruled screens. */
  detailed: boolean;
  budget: Budget;
}

/** gfx.js TABLE. */
const TABLE: Record<QualityTier, Omit<Look, "preset" | "budget">> = {
  low: { shadows: 0, ao: "off", bloom: false, grade: false, antialias: "off", particles: "low", ambient: false, detailed: false },
  balanced: { shadows: 1024, ao: "off", bloom: true, grade: true, antialias: "fxaa", particles: "high", ambient: true, detailed: true },
  high: { shadows: 2048, ao: "on", bloom: true, grade: true, antialias: "smaa", particles: "high", ambient: true, detailed: true },
  ultra: { shadows: 4096, ao: "high", bloom: true, grade: true, antialias: "msaa", particles: "high", ambient: true, detailed: true },
};
/** gfx.js BUDGETS. */
const BUDGETS: Record<QualityTier, Budget> = {
  low: { material: "lambert", digit: 128, paper: 512, curve: 2, bevel: 1, paperBump: false, sparks: 600, motes: 24, bloomRes: 0.5, aoRes: 0.5 },
  balanced: { material: "standard", digit: 256, paper: 512, curve: 3, bevel: 2, paperBump: false, sparks: 1500, motes: 40, bloomRes: 0.5, aoRes: 0.5 },
  high: { material: "physical", digit: 256, paper: 1024, curve: 5, bevel: 4, paperBump: true, sparks: 3000, motes: 80, bloomRes: 0.5, aoRes: 0.5 },
  ultra: { material: "physical", digit: 512, paper: 2048, curve: 8, bevel: 5, paperBump: true, sparks: 4500, motes: 120, bloomRes: 1, aoRes: 1 },
};
/** The first level index of each tier. */
const TIER_FLOOR: Record<QualityTier, number> = { low: 0, balanced: 2, high: 4, ultra: 7 };
export const SPARK_MAX = 9000, MOTE_MAX = 240;

/** The look for a quality tier at a level index (0 … 9). */
export function lookFor(preset: QualityTier, levelIndex: number): Look {
  const b = { ...BUDGETS[preset] };
  // Levels are about 1.64× apart in GPU throughput: budgets grow with the level above the tier's first, at most 2×.
  const k = Math.min(2, Math.pow(1.64, Math.max(0, levelIndex - TIER_FLOOR[preset])));
  b.sparks = Math.min(SPARK_MAX, Math.round(b.sparks * k));
  b.motes = Math.min(MOTE_MAX, Math.round(b.motes * k));
  return { preset, ...TABLE[preset], budget: b };
}
/** gfx.js sparkCap: the live spark pool (Particles Low: 20 % of the budget). */
export function sparkCap(l: Look): number { return Math.max(1, Math.round(l.budget.sparks * (l.particles === "high" ? 1 : 0.2))); }
/** gfx.js moteCount (Particles Low: half). */
export function moteCount(l: Look): number { return Math.round(l.budget.motes * (l.particles === "high" ? 1 : 0.5)); }
