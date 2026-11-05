// The look per graphics level. The engine's effects come from levelSettings() for
// the frame's level: shadows and their map size, ambient occlusion, bloom, the
// grade and anti-aliasing. The game's own art (materials, textures, segments, spark
// and mote budgets; js/gfx.js) stays keyed by the runtime's quality tier
// (frame().quality), with sparks and motes scaled within the tier by the level's
// particle budget over the tier's anchor level (at most 2×). The runtime owns the
// rest of what the old Graphics panel did: Auto and the level choice, render scale
// and the pixel-ratio cap, adaptive resolution, the frame-rate limit and readout.
// The old panel's per-effect overrides are not offered (the runtime's Options choose a level).
import { levelSettings, type GraphicsLevel, type LevelSettings, type QualityTier } from "starhermit:engine";
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
}
export interface Look {
  preset: QualityTier;
  /** Key-light shadow map: the level's size (0 = off: soft blob shadows ground the tokens). */
  shadows: number;
  ao: { resolution: number; samples: number; denoiseSamples: number } | null;
  /** The level's bloom resolution (null = off). */
  bloom: number | null;
  grade: boolean;
  antialias: AntialiasMode;
  particles: "low" | "high";
  /** Ambient motion: dust motes, the lamp shimmer, the idle bob of the tokens and the title tiles. */
  ambient: boolean;
  /** Surface detail Detailed: bevelled tokens, slot outlines, the fibre bump, ruled screens. */
  detailed: boolean;
  budget: Budget;
}

/** gfx.js TABLE, the game's own columns. */
const ART: Record<QualityTier, Pick<Look, "particles" | "ambient" | "detailed">> = {
  low: { particles: "low", ambient: false, detailed: false },
  balanced: { particles: "high", ambient: true, detailed: true },
  high: { particles: "high", ambient: true, detailed: true },
  ultra: { particles: "high", ambient: true, detailed: true },
};
/** gfx.js BUDGETS. */
const BUDGETS: Record<QualityTier, Budget> = {
  low: { material: "lambert", digit: 128, paper: 512, curve: 2, bevel: 1, paperBump: false, sparks: 600, motes: 24 },
  balanced: { material: "standard", digit: 256, paper: 512, curve: 3, bevel: 2, paperBump: false, sparks: 1500, motes: 40 },
  high: { material: "physical", digit: 256, paper: 1024, curve: 5, bevel: 4, paperBump: true, sparks: 3000, motes: 80 },
  ultra: { material: "physical", digit: 512, paper: 2048, curve: 8, bevel: 5, paperBump: true, sparks: 4500, motes: 120 },
};
const ANCHOR: Record<QualityTier, GraphicsLevel> = { low: "quantum", balanced: "molecular", high: "terrestrial", ultra: "galactic" };
export const SPARK_MAX = 9000, MOTE_MAX = 240;

/** The look for a graphics level's settings. */
export function lookFor(s: LevelSettings = levelSettings()): Look {
  const preset = s.quality;
  const b = { ...BUDGETS[preset] };
  const k = Math.min(2, s.particles / levelSettings(ANCHOR[preset]).particles);
  b.digit = Math.min(b.digit, s.maxTextureSize);
  b.sparks = Math.min(SPARK_MAX, Math.round(b.sparks * k));
  b.motes = Math.min(MOTE_MAX, Math.round(b.motes * k));
  return {
    preset, ...ART[preset],
    shadows: s.shadows ? s.shadowMapSize : 0,
    ao: s.ao && { resolution: s.ao.resolution, samples: s.ao.samples, denoiseSamples: s.ao.denoiseSamples },
    bloom: s.bloom ? s.bloom.resolution : null,
    grade: s.grade,
    antialias: s.antialias,
    budget: b,
  };
}
/** gfx.js sparkCap: the live spark pool (Particles Low: 20 % of the budget). */
export function sparkCap(l: Look): number { return Math.max(1, Math.round(l.budget.sparks * (l.particles === "high" ? 1 : 0.2))); }
/** gfx.js moteCount (Particles Low: half). */
export function moteCount(l: Look): number { return Math.round(l.budget.motes * (l.particles === "high" ? 1 : 0.5)); }
