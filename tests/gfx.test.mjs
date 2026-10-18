// Unit tests for the pure graphics quality model (js/gfx.js) and the
// Graphics panel's locale picker.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// js/gpu-level.js is a classic script in the page (window.StarHermitGpu); evaluate it the same way here.
new Function('window', 'module', readFileSync(new URL('../js/gpu-level.js', import.meta.url), 'utf8'))(globalThis, undefined);
const {
  PRESETS, CATEGORIES, detectPreset, detectLevel, presetForLevel, budgetFor, sparkCap, moteCount, resolve, presetTier, choosePreset, describe,
  LEVELS, BUDGETS, SPARK_MAX, MOTE_MAX,
} = await import('../js/gfx.js');
const { pickLocale, gfxStrings, GFX_LOCALES } = await import('../js/gfxui.js');

const DESK = { cores: 8, memoryGb: 8 };
const PHONE = { mobile: true, cores: 8, memoryGb: 8 };

test('hardware level picks the Auto preset (Low 0, Balanced 4, High 10, Ultra 17)', () => {
  assert.equal(detectPreset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', DESK), 'low');
  assert.equal(detectLevel('llvmpipe (LLVM 15.0.7, 256 bits)', DESK), 0);
  assert.equal(detectPreset('', DESK), 'low', 'no WebGL');
  assert.equal(detectPreset('ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', DESK), 'low');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) UHD Graphics 620)', DESK), 'low');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)', DESK), 'balanced');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce GTX 1070 Direct3D11 vs_5_0 ps_5_0)', DESK), 'high');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 Direct3D11 vs_5_0 ps_5_0)', DESK), 'ultra');
  assert.equal(detectLevel('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0)', DESK), 20);
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0)', DESK), 'ultra');
  for (const [p, lv] of Object.entries(LEVELS)) assert.equal(presetForLevel(lv), p);
  assert.equal(presetForLevel(3), 'low');
  assert.equal(presetForLevel(16), 'high');
});

test('phones and tablets are Balanced at most; software GPUs stay Low', () => {
  assert.equal(detectPreset('Adreno (TM) 740', PHONE), 'balanced');
  assert.ok(detectLevel('Adreno (TM) 740', PHONE) <= 9);
  assert.equal(detectPreset('Apple M1', true), 'balanced', 'boolean mobile flag still caps');
  assert.equal(detectPreset('SwiftShader', PHONE), 'low');
});

test('per-preset budgets are explicit, grow from Low to Ultra and scale with the level', () => {
  const keys = ['material', 'digit', 'paper', 'curve', 'bevel', 'paperBump', 'sparks', 'motes', 'bloomRes', 'aoRes', 'blur'];
  for (const p of PRESETS) for (const k of keys) assert.ok(BUDGETS[p][k] != null, `${p}.${k}`);
  for (let i = 1; i < PRESETS.length; i++) for (const k of keys) {
    if (typeof BUDGETS.low[k] === 'number') assert.ok(BUDGETS[PRESETS[i]][k] >= BUDGETS[PRESETS[i - 1]][k], `${PRESETS[i]}.${k}`);
  }
  assert.deepEqual(PRESETS.map((p) => BUDGETS[p].material), ['lambert', 'standard', 'physical', 'physical']);
  assert.deepEqual(PRESETS.map((p) => BUDGETS[p].bloomRes), [0.5, 0.5, 0.5, 1], 'half-res bloom below Ultra');
  assert.deepEqual(PRESETS.map((p) => BUDGETS[p].blur), [false, false, true, true]);
  assert.deepEqual(resolve({ preset: 'high' }, 'low', 10).budget, BUDGETS.high, 'floor level = the tuned budget');
  assert.deepEqual(resolve({ preset: 'ultra' }, 'low', 0).budget, resolve({ preset: 'ultra' }, 'ultra', 17).budget);
  assert.ok(budgetFor('balanced', 9).motes > budgetFor('balanced', 4).motes, 'counts scale up within the preset');
  assert.ok(budgetFor('ultra', 20).sparks <= SPARK_MAX && budgetFor('ultra', 20).motes <= MOTE_MAX);
  assert.equal(sparkCap(resolve({ preset: 'high' }, 'low', 10)), BUDGETS.high.sparks);
  assert.equal(moteCount(resolve({ preset: 'high' }, 'low', 10)), BUDGETS.high.motes);
  assert.equal(resolve({}, 'low', 0).budget.material, 'lambert', 'headless SwiftShader: Low, Lambert');
});

test('graphics summary level label in every locale', () => {
  for (const loc of GFX_LOCALES) assert.match(gfxStrings(loc).level.replace('{n}', 7), /7$/, loc);
});

test('resolve: auto uses the detected preset and its tiers', () => {
  const r = resolve({}, 'low');
  assert.equal(r.preset, 'low');
  assert.equal(r.auto, true);
  for (const cat of Object.keys(CATEGORIES)) assert.equal(r[cat], presetTier('low', cat));
  assert.equal(r.post, false, 'Low renders without a post chain');
  assert.equal(r.adaptive, true);
  assert.equal(r.showFps, false);
  assert.equal(resolve({ preset: 'auto' }, 'nonsense').preset, 'balanced');
});

test('resolve: explicit preset, overrides and invalid values', () => {
  const r = resolve({ preset: 'high', bloom: 'off', shadows: 'bogus', antialias: 'msaa' }, 'low');
  assert.equal(r.preset, 'high');
  assert.equal(r.auto, false);
  assert.equal(r.bloom, 'off');
  assert.equal(r.shadows, presetTier('high', 'shadows'), 'invalid override falls back to preset');
  assert.equal(r.antialias, 'msaa');
  assert.equal(r.post, true);
  const plain = resolve({ preset: 'low', antialias: 'fxaa' }, 'low');
  assert.equal(plain.post, true, 'any post effect enables the chain');
});

test('resolve: render scale is clamped to 50–200% and multiplies the preset scale', () => {
  assert.equal(resolve({ preset: 'high', render_scale: 5 }).userScale, 2);
  assert.equal(resolve({ preset: 'high', render_scale: 0.1 }).userScale, 0.5);
  assert.equal(resolve({ preset: 'high', render_scale: 'x' }).userScale, 1);
  const u = resolve({ preset: 'ultra', render_scale: 1.5 });
  assert.equal(u.scale, presetTier('ultra', 'scale') * 1.5);
  assert.ok(resolve({ preset: 'low' }).dprCap <= resolve({ preset: 'high' }).dprCap);
});

test('choosePreset clears per-category overrides but keeps other settings', () => {
  const saved = { preset: 'high', bloom: 'off', ao: 'high', render_scale: 1.3, adaptive: false, show_fps: true };
  const next = choosePreset(saved, 'ultra');
  assert.equal(next.preset, 'ultra');
  for (const cat of Object.keys(CATEGORIES)) assert.equal(next[cat], undefined);
  assert.equal(next.render_scale, 1.3);
  assert.equal(next.adaptive, false);
  assert.equal(next.show_fps, true);
  assert.equal(saved.bloom, 'off', 'input is not mutated');
  assert.equal(choosePreset(saved, 'auto').preset, 'auto');
});

test('presets are ordered by cost', () => {
  const rank = (cat, p) => CATEGORIES[cat].indexOf(presetTier(p, cat));
  for (const cat of ['shadows', 'ao', 'bloom', 'grade', 'particles', 'detail']) {
    for (let i = 1; i < PRESETS.length; i++) {
      assert.ok(rank(cat, PRESETS[i]) >= rank(cat, PRESETS[i - 1]), `${cat} ${PRESETS[i]}`);
    }
  }
});

test('describe summarises cost and pixels, with optional localized fragments', () => {
  const low = describe(resolve({ preset: 'low' }), [800, 600]);
  assert.match(low, /no shadows/);
  assert.match(low, /800×600 px/);
  const ultra = describe(resolve({ preset: 'ultra' }));
  assert.match(ultra, /4096² shadows/);
  assert.match(ultra, /MSAA/);
  assert.match(describe(resolve({ preset: 'low' }), null, { noShadows: 'sin sombras' }), /sin sombras/);
});

test('graphics panel locales cover every required language', () => {
  for (const l of ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT']) {
    assert.ok(GFX_LOCALES.includes(l), l);
    const S = gfxStrings(l);
    for (const cat of Object.keys(CATEGORIES)) assert.ok(S.cat[cat], `${l} ${cat}`);
    for (const tiers of Object.values(CATEGORIES)) for (const t of tiers) assert.ok(S.tier[t], `${l} ${t}`);
    for (const k of ['section', 'quality', 'auto', 'scale', 'fromPreset', 'adaptive', 'showFps', 'postFailed', ...PRESETS]) {
      assert.ok(S[k], `${l} ${k}`);
    }
  }
  assert.equal(pickLocale('es-MX'), 'es-419');
  assert.equal(pickLocale('es-ES'), 'es-ES');
  assert.equal(pickLocale('fr-CA'), 'fr-CA');
  assert.equal(pickLocale('fr-BE'), 'fr-FR');
  assert.equal(pickLocale('pt-PT'), 'pt-BR');
  assert.equal(pickLocale('en-GB'), 'en-GB');
  assert.equal(pickLocale('de'), 'de-DE');
  assert.equal(pickLocale('ja-JP'), 'en-US');
});
