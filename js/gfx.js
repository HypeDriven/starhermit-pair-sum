// Pair Sum — graphics quality model: presets, per-category overrides, StarHermit
// hardware-level detection, per-preset asset/effect budgets and a cost summary. Pure (no three.js, no DOM) so the renderer,
// the settings panel and unit tests agree on what a setting means.

export const PRESETS = ['low', 'balanced', 'high', 'ultra'];

// Category → allowed tiers, cheapest first.
export const CATEGORIES = {
  shadows: ['off', 'low', 'medium', 'high'],
  ao: ['off', 'on', 'high'],
  bloom: ['off', 'on'],
  grade: ['off', 'on'],
  antialias: ['off', 'fxaa', 'smaa', 'msaa'],
  particles: ['low', 'high'],
  background: ['static', 'animated'],
  detail: ['plain', 'detailed'],
};

// Each preset is a row of tiers, a render scale (multiplies the capped device
// pixel ratio) and a device-pixel-ratio cap.
const TABLE = {
  low:      { scale: 1,    dprCap: 1,   shadows: 'off',    ao: 'off',  bloom: 'off', grade: 'off', antialias: 'off',  particles: 'low',  background: 'static',   detail: 'plain' },
  balanced: { scale: 1,    dprCap: 1.5, shadows: 'low',    ao: 'off',  bloom: 'on',  grade: 'on',  antialias: 'fxaa', particles: 'high', background: 'animated', detail: 'detailed' },
  high:     { scale: 1,    dprCap: 2,   shadows: 'medium', ao: 'on',   bloom: 'on',  grade: 'on',  antialias: 'smaa', particles: 'high', background: 'animated', detail: 'detailed' },
  ultra:    { scale: 1.25, dprCap: 2,   shadows: 'high',   ao: 'high', bloom: 'on',  grade: 'on',  antialias: 'msaa', particles: 'high', background: 'animated', detail: 'detailed' },
};

export const SHADOW_MAP = { off: 0, low: 1024, medium: 2048, high: 4096 };

// Auto picks the preset from the StarHermit hardware level (0 = Galaxy S20 / Intel UHD or weaker, 20 = RTX
// 5090; js/gpu-level.js → window.StarHermitGpu, a classic script loaded before the game): Low from 0,
// Balanced from 4, High from 10, Ultra from 17. Phones, tablets and ≤ 4 GB machines are capped at level 9.
export const LEVELS = { low: 0, balanced: 4, high: 10, ultra: 17 };
const gpuApi = () => globalThis.StarHermitGpu;

/** Hardware level 0–20 for an unmasked renderer string plus StarHermitGpu.detectSystem() facts. */
export function detectLevel(gpu, system) {
  const G = gpuApi();
  const sys = { webgl: true, webgl2: true, ...(typeof system === 'object' && system ? system : { mobile: !!system }), gpu: String(gpu || '') };
  if (!gpu) sys.webgl = false; // no renderer string: no usable WebGL
  return G ? G.detectLevel(sys) : (gpu ? LEVELS.balanced : 0);
}

/** The preset Auto starts from for a hardware level. */
export function presetForLevel(level) {
  const G = gpuApi();
  return G ? G.presetForLevel(level, LEVELS) : PRESETS.filter((p) => LEVELS[p] <= level).pop() || 'low';
}

/** Best preset for this GPU (`system`: detectSystem() facts, or true for a phone/tablet). */
export function detectPreset(gpu, system) {
  return presetForLevel(detectLevel(gpu, system));
}

/*
 * Per-preset asset and effect budget. Each preset holds 60 FPS on the weakest GPU Auto gives it (Low →
 * level 0, Balanced → 4, High → 10, Ultra → 17; measured with tests/gfx-bench.mjs). Board, tokens, tap
 * areas and rules are identical on every preset — only visuals change.
 *   material  token and paper shading: lambert (Low) / standard (Balanced) / clear-coated physical
 *             tokens (High, Ultra; Detail on)
 *   digit     token-face (digit) texture size in px; paper  ruled-paper texture size in px
 *   curve / bevel  token corner and bevel segments (Detail on; Plain keeps 2 / 1)
 *   paperBump  paper-grain bump map (Detail on)
 *   sparks    spark pool at Particles "high" (low: 20 %), scaled with the level
 *   motes     dust motes (Background animated), scaled with the level
 *   bloomRes / aoRes  bloom and GTAO resolution as a fraction of the frame
 *   blur      frosted (backdrop-filter) pause overlay over the live board
 */
export const BUDGETS = {
  low: { material: 'lambert', digit: 128, paper: 512, curve: 2, bevel: 1, paperBump: false, sparks: 600, motes: 24, bloomRes: 0.5, aoRes: 0.5, blur: false },
  balanced: { material: 'standard', digit: 256, paper: 512, curve: 3, bevel: 2, paperBump: false, sparks: 1500, motes: 40, bloomRes: 0.5, aoRes: 0.5, blur: false },
  high: { material: 'physical', digit: 256, paper: 1024, curve: 5, bevel: 4, paperBump: true, sparks: 3000, motes: 80, bloomRes: 0.5, aoRes: 0.5, blur: true },
  ultra: { material: 'physical', digit: 512, paper: 2048, curve: 8, bevel: 5, paperBump: true, sparks: 4500, motes: 120, bloomRes: 1, aoRes: 1, blur: true },
};
export const SPARK_MAX = 9000;
export const MOTE_MAX = 240;
const PARTICLE_SHARE = { low: 0.2, high: 1 };

/** A preset's concrete budget for a hardware level (particle counts scale ≤ 2× within the preset). */
export function budgetFor(preset, level) {
  const b = { ...(BUDGETS[preset] || BUDGETS.balanced) };
  const G = gpuApi(), floor = LEVELS[preset] || 0;
  const lv = Math.max(Number.isFinite(level) ? level : floor, floor);
  const k = G ? Math.min(2, G.scaleBudget(1, lv, floor)) : 1;
  b.sparks = Math.min(SPARK_MAX, Math.round(b.sparks * k));
  b.motes = Math.min(MOTE_MAX, Math.round(b.motes * k));
  return b;
}

/** Live spark-pool size for resolved settings (Particles tier share of the preset's budget). */
export function sparkCap(r) {
  return Math.max(1, Math.round(r.budget.sparks * (PARTICLE_SHARE[r.particles] ?? 0.2)));
}

/** Dust motes for resolved settings (Particles low: half). */
export function moteCount(r) {
  return Math.round(r.budget.motes * (r.particles === 'high' ? 1 : 0.5));
}

/**
 * Resolve saved settings into concrete tiers.
 * `saved`: { preset: 'auto'|preset, render_scale, adaptive, show_fps, <category>: tier }.
 * Missing or unknown category values mean "from preset".
 */
export function resolve(saved, detected, level) {
  const s = saved || {};
  const auto = !PRESETS.includes(s.preset);
  const preset = auto ? (PRESETS.includes(detected) ? detected : 'balanced') : s.preset;
  const row = TABLE[preset];
  const userScale = clamp(Number(s.render_scale) || 1, 0.5, 2);
  const out = { preset, auto, userScale, scale: row.scale * userScale, dprCap: row.dprCap };
  for (const [cat, tiers] of Object.entries(CATEGORIES)) {
    out[cat] = tiers.includes(s[cat]) ? s[cat] : row[cat];
  }
  out.level = Number.isFinite(level) ? level : LEVELS[preset];
  out.budget = budgetFor(preset, out.level);
  out.adaptive = s.adaptive !== false;
  out.showFps = !!s.show_fps;
  // Post-processing runs only when something needs it (MSAA is done in the
  // composer's multisampled target so it can be switched live).
  out.post = out.ao !== 'off' || out.bloom === 'on' || out.grade === 'on' || out.antialias !== 'off';
  return out;
}

/** The preset's own tier for a category (for "From preset (…)" labels). */
export function presetTier(preset, cat) {
  return TABLE[preset]?.[cat];
}

/** Choosing a preset clears every per-category override. */
export function choosePreset(saved, preset) {
  const s = { ...(saved || {}) };
  for (const cat of Object.keys(CATEGORIES)) delete s[cat];
  s.preset = PRESETS.includes(preset) ? preset : 'auto';
  return s;
}

const EN = {
  noShadows: 'no shadows', shadows: '{n}² shadows', ao: 'ambient occlusion', aoHigh: 'full ambient occlusion',
  bloom: 'bloom', grade: 'colour grade', noAA: 'no anti-aliasing', particles: 'dense particles', animated: 'ambient motion',
};

/** Short cost summary; `L` optionally supplies localized fragments (see EN). */
export function describe(r, pixels, L = EN) {
  const t = (k) => (L && L[k]) || EN[k];
  const parts = [
    r.shadows === 'off' ? t('noShadows') : t('shadows').replace('{n}', SHADOW_MAP[r.shadows]),
    r.ao === 'off' ? null : r.ao === 'high' ? t('aoHigh') : t('ao'),
    r.bloom === 'on' ? t('bloom') : null,
    r.grade === 'on' ? t('grade') : null,
    r.antialias === 'off' ? t('noAA') : r.antialias.toUpperCase(),
    r.particles === 'high' ? t('particles') : null,
    r.background === 'animated' ? t('animated') : null,
    pixels ? `${pixels[0]}×${pixels[1]} px` : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}
