// Key extraction for the i18n coverage test (run directly to list the keys).
// Keys are the US-English source strings: literal T('…') / N('…') calls in the
// engine client (native/*.ts) and the shared modules (js/*.js), and the
// content tables' display text (lessons, Journey pages, practice
// difficulties, challenges, themes, achievements).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { LESSONS, JOURNEY, PRACTICE_DIFFICULTIES, CHALLENGES, THEMES, ACHIEVEMENTS } from '../js/content.js';

const ROOT = new URL('..', import.meta.url).pathname;
const SKIP = new Set(['i18n.js', 'sh-strings.js', 'i18n.ts']);
const unescape = (s) => s.replace(/\\(['"`\\])/g, '$1');

export function sourceKeys() {
  const keys = new Set();
  const call = /(?<![\w.$])(?:T|N)\(\s*(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)")/g;
  for (const dir of ['js', 'native']) {
    for (const f of readdirSync(join(ROOT, dir))) {
      if (!/\.(js|ts)$/.test(f) || SKIP.has(f)) continue;
      const src = readFileSync(join(ROOT, dir, f), 'utf8');
      for (const m of src.matchAll(call)) keys.add(unescape(m[1] ?? m[2]));
    }
  }
  // native/i18n.ts defTitle's generated round titles and the fallback.
  for (const k of ['Daily — {date}', 'Practice — {name}', 'Score chase — week {n}', 'Untitled']) keys.add(k);
  return keys;
}

export function contentKeys() {
  const keys = new Set();
  const add = (s) => { if (typeof s === 'string' && s) keys.add(s); };
  for (const l of LESSONS) { add(l.title); for (const s of l.tutorial.steps) add(s.text); }
  for (const d of JOURNEY) { add(d.title.replace(/^\d+\. /, '')); add(d.goals?.note); }
  for (const p of PRACTICE_DIFFICULTIES) { add(p.name); add(p.note); }
  for (const c of CHALLENGES) { add(c.name); add(c.note); }
  for (const t of THEMES) add(t.name);
  for (const a of ACHIEVEMENTS) { add(a.name); add(a.desc); }
  return keys;
}

export const ALL = new Set([...sourceKeys(), ...contentKeys()]);

if (process.argv[1] && process.argv[1].endsWith('i18n-keys.mjs')) console.log(JSON.stringify([...ALL], null, 1));
