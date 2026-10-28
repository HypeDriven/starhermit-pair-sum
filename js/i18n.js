// Pair Sum localization core.
//
// Every player-facing string is authored in US English and looked up by that
// English text: T('Play') → the current locale's translation (en-US is the key
// itself). Placeholders use {name}. N('…') marks a string for extraction
// without translating it (the caller translates at display time).
//
// Nine locales: en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT.
// es-ES and fr-CA list only their differences from es-419 and fr-FR; en-GB only
// its spelling changes.
//
// The engine client (native/i18n.ts) sets the locale from the runtime's
// interface language (Options › Language, else the account's or the device's).

import EN_GB from './locales/en-GB.js';
import { ES_419, ES_ES } from './locales/es.js';
import DE_DE from './locales/de.js';
import { FR_FR, FR_CA } from './locales/fr.js';
import PT_BR from './locales/pt.js';
import IT_IT from './locales/it.js';

export const LOCALES = ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT'];

/** Locale → { English key: translation }. */
export const DICTS = {
  'en-US': {},
  'en-GB': EN_GB,
  'es-419': ES_419,
  'es-ES': { ...ES_419, ...ES_ES },
  'de-DE': DE_DE,
  'fr-FR': FR_FR,
  'fr-CA': { ...FR_FR, ...FR_CA },
  'pt-BR': PT_BR,
  'it-IT': IT_IT,
};

let lang = 'en-US';
let dict = DICTS[lang];
const listeners = new Set();

export function fmt(s, vars) {
  return String(s).replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? String(vars[k]) : m));
}

/** Translate an English source string (unknown strings pass through). */
export function T(key, vars) {
  if (key == null) return '';
  const s = String(key);
  const out = Object.prototype.hasOwnProperty.call(dict, s) ? dict[s] : s;
  return vars ? fmt(out, vars) : out;
}

/** Mark a string for extraction; translated later with T(). */
export const N = (key) => key;

export function getLang() { return lang; }

export function onLanguage(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function setLocale(next) {
  const resolved = DICTS[next] ? next : 'en-US';
  const changed = resolved !== lang;
  lang = resolved;
  dict = DICTS[lang];
  if (changed) for (const fn of [...listeners]) fn(lang);
}
