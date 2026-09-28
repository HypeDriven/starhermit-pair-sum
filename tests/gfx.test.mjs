// Unit tests for the pure graphics quality model (js/gfx.js) and the
// Graphics panel's locale picker.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRESETS, CATEGORIES, detectPreset, resolve, presetTier, choosePreset, describe,
} from '../js/gfx.js';
import { pickLocale, gfxStrings, GFX_LOCALES } from '../js/gfxui.js';

test('detectPreset: software renderers get low, discrete GPUs high, others balanced', () => {
  assert.equal(detectPreset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'), 'low');
  assert.equal(detectPreset('llvmpipe (LLVM 15.0.7, 256 bits)'), 'low');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0)'), 'high');
  assert.equal(detectPreset('ANGLE (AMD, AMD Radeon RX 6800 XT)'), 'high');
  assert.equal(detectPreset('Apple M2'), 'high');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) UHD Graphics 620)'), 'balanced');
  assert.equal(detectPreset('Adreno (TM) 650'), 'balanced');
  assert.equal(detectPreset(''), 'balanced');
  assert.equal(detectPreset(undefined), 'balanced');
});

test('detectPreset: touch/mobile devices are capped at balanced', () => {
  assert.equal(detectPreset('Apple M1', true), 'balanced');
  assert.equal(detectPreset('Mali-G78', true), 'balanced');
  assert.equal(detectPreset('SwiftShader', true), 'low');
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
