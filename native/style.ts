// The look of the top bar, rails, HUD, tray and screens: the browser build's
// css/style.css, rewritten class-based in tools/ui-style.css and converted
// once with `starhermit css` into assets/ui-style.json (`npm run css`),
// registered at start with the theme the runtime's own widgets (scroll bars,
// focus rings, selects, text fields) take. The five notebook themes
// (body[data-theme]) and the runtime's high-contrast option
// (body.high-contrast) are token sets; the colour-mix() and opacity shades
// the sheet used are recomputed from them here.
import { files } from "starhermit:engine";
import * as ui from "starhermit:ui";

type Tokens = Record<string, string>;
/** style.css body[data-theme="…"]. */
const THEMES: Record<string, Tokens> = {
  notebook: { paper: "#f6f1e3", ink: "#2c3244", rule: "#b9c4d6", accent: "#e2703a", panel: "#fffdf6" },
  dusk: { paper: "#232838", ink: "#e8e4d8", rule: "#3a4258", accent: "#f0a35e", panel: "#2a3044" },
  mint: { paper: "#eef7f0", ink: "#243b32", rule: "#b8d8c8", accent: "#1f8a70", panel: "#f8fffb" },
  slate: { paper: "#eceff3", ink: "#232a35", rule: "#c2cad4", accent: "#5b5fc7", panel: "#f8fafc" },
  candy: { paper: "#fdf0f4", ink: "#432734", rule: "#eccfdc", accent: "#d6417a", panel: "#fffafc" },
};
/** body.high-contrast. */
const CONTRAST: Tokens = { paper: "#ffffff", ink: "#000000", rule: "#666666", accent: "#0044cc", panel: "#ffffff", focus: "#0033aa" };

const hex = (c: string): number[] => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const toHex = (v: number[]): string => `#${v.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, "0")).join("")}`;
/** color-mix(in srgb, a p, b). */
export function mix(a: string, p: number, b: string): string {
  const x = hex(a), y = hex(b);
  return toHex(x.map((v, i) => v * p + y[i]! * (1 - p)));
}
const alpha = (c: string, a: number): string => c.slice(0, 7) + Math.round(a * 255).toString(16).padStart(2, "0");

let current: Tokens = {};
/** The tokens for a theme and contrast, with the sheet's derived shades. */
export function tokensFor(theme: string, highContrast: boolean): Tokens {
  const t: Tokens = { focus: "#2f80ed", danger: "#c0392b", legal: "#3f9d63", ...(highContrast ? CONTRAST : THEMES[theme] ?? THEMES.notebook!) };
  // Text the old sheet faded with opacity over the panel / paper.
  t["ink-75"] = mix(t.ink!, 0.75, t.panel!);
  t["ink-60"] = mix(t.ink!, 0.62, t.panel!);
  t["panel-88"] = alpha(t.panel!, 0.88);
  t["panel-92"] = alpha(t.panel!, 0.92);
  t["accent-dark"] = mix(t.accent!, 0.7, "#000000");
  return t;
}

export function initStyles(): void {
  const css = files.readJson("assets/ui-style.json") as unknown as ui.CssStyles;
  ui.setFont({ family: "sans-serif" });
  ui.setTheme({
    fontSize: 16, smallSize: 13.6, headingSize: 24, padding: 8, spacing: 8, radius: 8,
    text: "#2c3244", muted: "#5d606a", panel: "#fffdf6", control: "#fffdf6", hovered: "#f6f1e3",
    pressed: "#ece6d4", field: "#fffdf6", accent: "#e2703a", focus: "#2f80ed", outline: "#b9c4d6",
  });
  ui.setTokens(css.tokens);
  ui.setStyles({
    ...css.styles,
    label: { text: { color: "$ink" } },
    paragraph: { text: { color: "$ink" } },
    heading: { text: { color: "$ink" } },
    widget: { focusRing: { color: "$focus", width: 3, offset: 2 } },
    scrollArea: { parts: { bar: { background: "$rule", radius: 4 } } },
    tooltip: { background: "$panel", text: { color: "$ink" }, radius: 6, padding: 6 },
    // The pause overlay's dim (rgba(20, 20, 30, 0.45)) behind the dialogs.
    dialog: { background: "#00000000", padding: 0, parts: { backdrop: { background: "#14141e73" } } },
  });
  applyTokens("notebook", false);
}

let key = "";
/** Applies the theme / contrast tokens (cheap when unchanged). */
export function applyTokens(theme: string, highContrast: boolean): void {
  const k = `${theme}:${highContrast}`;
  if (k === key) return;
  key = k;
  current = tokensFor(theme, highContrast);
  ui.setTokens(current);
  ui.setTheme({
    text: current.ink!, muted: current["ink-75"]!, panel: current.panel!, control: current.panel!, hovered: current.paper!,
    pressed: mix(current.paper!, 0.9, current.ink!), field: current.panel!, accent: current.accent!, focus: current.focus!, outline: current.rule!,
  });
}
/** A token's current colour (for draw calls, which take real colours). */
export function token(name: string): string { return current[name] ?? "#000000"; }
