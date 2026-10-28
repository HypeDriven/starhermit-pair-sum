// Localization: the browser build's dictionaries (js/locales/*.js through
// js/i18n.js, US-English text as the keys, the nine StarHermit locales; the
// account strings in js/sh-strings.js) in the interface language the runtime
// reports (preferences().language: the player's choice in Options › Language,
// else the account's preferred language or the device's). The runtime's
// Options replace the game's own Language setting (sh-language.js) and the
// DOM re-labelling: every string is drawn through T() each frame, so a change
// shows on the next frame and never restarts the round.
import { onPreferencesChange, preferences } from "starhermit:engine";
import * as ui from "starhermit:ui";
import { LOCALES, T as translate, setLocale } from "../js/i18n.js";
import { shStrings } from "../js/sh-strings.js";

const PRIMARY: Record<string, string> = { en: "en-US", es: "es-419", de: "de-DE", fr: "fr-FR", pt: "pt-BR", it: "it-IT" };

/** The shipped locale nearest a BCP 47 tag (en-GB, es-ES and fr-CA by region; es-MX → es-419, pt-PT → pt-BR). */
export function pickLocale(tag: string): string {
  const s = String(tag || "en-US");
  const exact = (LOCALES as string[]).find((l) => l.toLowerCase() === s.toLowerCase());
  if (exact) return exact;
  const lang = s.split("-")[0]!.toLowerCase();
  if (lang === "en" && /-(gb|uk|ie|au|nz|za|in)$/i.test(s)) return "en-GB";
  if (lang === "es" && /-es$/i.test(s)) return "es-ES";
  if (lang === "fr" && /-ca$/i.test(s)) return "fr-CA";
  return PRIMARY[lang] ?? "en-US";
}

let locale = "";
function apply(tag: string): void {
  const next = pickLocale(tag);
  if (next === locale) return;
  locale = next;
  setLocale(locale);
  ui.setLanguage(locale);
}
apply(preferences().language);
onPreferencesChange((p) => apply(p.language));

export function currentLocale(): string { return locale; }
export type Vars = Record<string, string | number>;
/** An English source string in the player's language; `{name}` placeholders from vars. */
export function T(key: string, vars?: Vars | null): string { return translate(key, vars ?? undefined) as string; }
/** Marks an English key that is translated with T() where it is shown. */
export const N = (s: string): string => s;
/** The account strings (signIn, invite, copied, copyFailed, signedOut, lbPosting, lbRank, lbPosted, lbNotPosted). */
export function S(key: string, vars?: Vars): string {
  let s = (shStrings(locale) as Record<string, string>)[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}

/** m:ss, rounded up (ui.js fmtMs). */
export function fmtMs(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Round titles stay English in the def (and snapshots) and are translated at display (ui.js defTitle). */
export function defTitle(def: { title?: string } | null): string {
  const title = String(def?.title || N("Untitled"));
  let m: RegExpExecArray | null;
  if ((m = /^(\d+)\. (.+)$/.exec(title))) return `${m[1]}. ${T(m[2]!)}`;
  if ((m = /^Daily — (.+)$/.exec(title))) return T("Daily — {date}", { date: m[1]! });
  if ((m = /^Practice — (.+)$/.exec(title))) return T("Practice — {name}", { name: T(m[1]!) }); // ui.js read m[2] (undefined): the name was lost
  if ((m = /^Score chase — week (\d+)$/.exec(title))) return T("Score chase — week {n}", { n: m[1]! });
  return T(title);
}
