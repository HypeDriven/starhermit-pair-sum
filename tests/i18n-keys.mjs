// Key extraction for the i18n coverage test (run directly to list the keys).
// Keys are the US-English source strings: literal T('…') / N('…') calls in js/,
// data-i18n / data-i18n-aria / data-i18n-title / data-i18n-html markup in
// index.html, and the content tables' display text (lessons, Journey pages,
// practice difficulties, challenges, themes, achievements).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { LESSONS, JOURNEY, PRACTICE_DIFFICULTIES, CHALLENGES, THEMES, ACHIEVEMENTS } from '../js/content.js';

const ROOT = new URL('..', import.meta.url).pathname;
const SKIP = new Set(['i18n.js', 'gfxui.js']);
const unescape = (s) => s.replace(/\\(['"`\\])/g, '$1');

export function sourceKeys() {
  const keys = new Set();
  const call = /(?<![\w.$])(?:T|N)\(\s*(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)")/g;
  for (const f of readdirSync(join(ROOT, 'js'))) {
    if (!f.endsWith('.js') || SKIP.has(f)) continue;
    const src = readFileSync(join(ROOT, 'js', f), 'utf8');
    for (const m of src.matchAll(call)) keys.add(unescape(m[1] ?? m[2]));
  }
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  for (const m of html.matchAll(/data-i18n(?:-aria|-title)?="([^"]+)"/g)) keys.add(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  for (const m of html.matchAll(/<p data-i18n-html>([\s\S]*?)<\/p>/g)) keys.add(m[1].trim());
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
  // Generated round titles (ui.js defTitle) and the 'Untitled' fallback.
  for (const k of ['Daily — {date}', 'Practice — {name}', 'Score chase — week {n}']) keys.add(k);
  return keys;
}

export const ALL = new Set([...sourceKeys(), ...contentKeys()]);

if (process.argv[1] && process.argv[1].endsWith('i18n-keys.mjs')) console.log(JSON.stringify([...ALL], null, 1));
