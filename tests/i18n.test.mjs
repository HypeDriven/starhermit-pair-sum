// Every player-facing string exists in all nine locales (node --test).
// Keys are the US-English source strings (see tests/i18n-keys.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DICTS, LOCALES, T, setLocale } from '../js/i18n.js';
import { gfxStrings } from '../js/gfxui.js';
import { ALL } from './i18n-keys.mjs';

const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const tags = (s) => (String(s).match(/<[^>]+>/g) || []).join('');

test('the key set is non-trivial', () => {
  assert.ok(ALL.size > 300, `only ${ALL.size} keys found`);
});

for (const locale of LOCALES.filter((l) => l !== 'en-US' && l !== 'en-GB')) {
  test(`${locale}: every key used in markup, code and content is translated with the same placeholders and markup`, () => {
    const dict = DICTS[locale];
    const missing = [...ALL].filter((k) => !Object.prototype.hasOwnProperty.call(dict, k));
    assert.deepEqual(missing, [], `${missing.length} missing in ${locale}`);
    assert.deepEqual([...ALL].filter((k) => placeholders(dict[k]) !== placeholders(k)), [], 'placeholder mismatch');
    assert.deepEqual([...ALL].filter((k) => tags(dict[k]) !== tags(k)), [], 'markup mismatch');
  });
}

test('no locale carries keys that no longer exist', () => {
  for (const locale of LOCALES) {
    const stray = Object.keys(DICTS[locale]).filter((k) => !ALL.has(k));
    assert.deepEqual(stray, [], locale);
  }
});

test('Graphics and StarHermit strings follow the game language', () => {
  for (const locale of LOCALES) assert.ok(gfxStrings(locale).sh.signIn, locale);
  setLocale('de-DE');
  assert.equal(gfxStrings().section, 'Grafik');
  setLocale('en-US');
});

test('T falls back to the key and fills placeholders; regional variants inherit', () => {
  setLocale('de-DE');
  assert.equal(T('Not a real key {x}', { x: 1 }), 'Not a real key 1');
  assert.equal(T('{n} moves', { n: 3 }), '3 Züge');
  setLocale('fr-CA');
  assert.equal(T('Score'), 'Pointage');
  assert.equal(T('Hint'), 'Indice');
  setLocale('es-ES');
  assert.equal(T('Settings'), 'Ajustes');
  assert.equal(T('Hint'), 'Pista');
  setLocale('en-GB');
  assert.equal(T('Color palette'), 'Colour palette');
  setLocale('en-US');
  assert.equal(T('Hint'), 'Hint');
});
