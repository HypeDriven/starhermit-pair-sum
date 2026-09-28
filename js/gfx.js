// Pair Sum — graphics quality model: presets, per-category overrides, GPU
// detection and a cost summary. Pure (no three.js, no DOM) so the renderer,
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

/**
 * Best preset for this GPU, from the unmasked renderer string when the browser
 * exposes it. Software renderers get Low; discrete GPUs / Apple M get High;
 * everything else Balanced. Touch/mobile devices are capped at Balanced.
 */
export function detectPreset(gpu, mobile = false) {
  const g = String(gpu || '').toLowerCase();
  let p = 'balanced';
  if (/swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/.test(g)) p = 'low';
  else if (/nvidia|geforce|rtx|gtx|quadro|radeon rx|radeon pro|amd radeon(?! graphics)|apple m\d/.test(g)) p = 'high';
  if (mobile && PRESETS.indexOf(p) > PRESETS.indexOf('balanced')) p = 'balanced';
  return p;
}

/**
 * Resolve saved settings into concrete tiers.
 * `saved`: { preset: 'auto'|preset, render_scale, adaptive, show_fps, <category>: tier }.
 * Missing or unknown category values mean "from preset".
 */
export function resolve(saved, detected) {
  const s = saved || {};
  const auto = !PRESETS.includes(s.preset);
  const preset = auto ? (PRESETS.includes(detected) ? detected : 'balanced') : s.preset;
  const row = TABLE[preset];
  const userScale = clamp(Number(s.render_scale) || 1, 0.5, 2);
  const out = { preset, auto, userScale, scale: row.scale * userScale, dprCap: row.dprCap };
  for (const [cat, tiers] of Object.entries(CATEGORIES)) {
    out[cat] = tiers.includes(s[cat]) ? s[cat] : row[cat];
  }
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
