// Localization: the engine's string tables (assets/strings.json, US-English text as the keys, the nine
// StarHermit locales; the account strings are the engine's own starhermit.* keys) in the interface language
// the runtime reports (the player's choice in Options › Language, else the account's preferred language or
// the device's). Every string is drawn through T() each frame, so a change shows on the next frame and never
// restarts the round.
import { strings } from "starhermit:engine";
import * as ui from "starhermit:ui";

strings.load("assets/strings.json");
strings.defaultLocale = "en-US";
ui.setLanguage(strings.locale);
strings.onChange((locale) => ui.setLanguage(locale));

export type Vars = Record<string, string | number>;
const fill = (s: string, vars?: Vars | null): string => s.replace(/\{(\w+)\}/g, (m, k: string) => (vars && vars[k] != null ? String(vars[k]) : m));
/** An English source string in the player's language (unknown strings pass through); `{name}` placeholders from vars. */
export function T(key: string | null | undefined, vars?: Vars | null): string {
  if (key == null) return "";
  const s = String(key);
  return strings.has(s) ? strings.t(s, vars ?? undefined) : fill(s, vars);
}
/** Marks an English key that is translated with T() where it is shown. */
export const N = (s: string): string => s;
/** The engine's account strings. */
const ACCOUNT: Record<string, string> = {
  signIn: "signIn", invite: "invite", copied: "inviteCopied", copyFailed: "inviteFailed", signedOut: "signedOut",
  lbPosting: "leaderboardPosting", lbRank: "leaderboardRank", lbPosted: "leaderboardPosted", lbNotPosted: "leaderboardNotPosted",
};
export function S(key: keyof typeof ACCOUNT, vars?: Vars): string { return strings.t(`starhermit.${ACCOUNT[key]}`, vars); }

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
