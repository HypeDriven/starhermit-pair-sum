// The browser build's DOM shell (index.html + js/ui.js) as starhermit:ui,
// built every frame over the board: the top bar (brand, round title, Help,
// Settings and the profile chip), the Objective and Status rails, the HUD
// pill with its alert, the lesson banner with Skip lesson, the action tray
// (Hint, Undo, Add rows, Pause; mirrored for the left-handed tray), the
// countdown, the toasts and the sound captions, the board's named targets
// (each token as the old DOM mirror's cell buttons: screen readers and play
// scripts find them) with the keyboard cursor, the pause card, and every
// full-page screen (title with its number tiles, modes, Journey, setup with
// the lesson / difficulty / challenge lists, results, help, settings,
// achievements, scores, profile), drawn on the notebook page (ruled at
// Surface detail Detailed). The old media queries are layouts picked by the
// window's logical size: wide (≥ 1024 px: both rails), compact (the board
// alone under the bar), portrait phones (≤ 700 px wide: a full-width tray, no
// round title) and short landscape (≤ 500 px tall: the tray as a column at
// the right and the lesson as a side panel). The board is fitted into the
// stage left free by them (main.ts free → render.ts).
import { frame, openMenu } from "starhermit:engine";
import { bindings, requestRebind } from "starhermit:input";
import * as draw from "starhermit:draw";
import * as ui from "starhermit:ui";
import { Content, Progress, Rules, type Def } from "./game.ts";
import { N, S, T, defTitle, fmtMs } from "./i18n.ts";
import * as platform from "./platform.ts";
import * as render from "./render.ts";
import {
  app, back, continueRound, copyInvite, currentLook, doAddRows, doHint, doPause, doUndo, fresh, free, goTitle, hudRects, inRound,
  later, leaderboardLine, leaveRound, nextAfterResults, openMode, openPlay, openScreen, pauseForScreen, pauseSummary, pickChallenge,
  pickDifficulty, pickLesson, pickStage, playing, restartRound, resumeRound, session, signIn, skipLesson, stage, startPending, toast,
} from "./main.ts";
import { mix, token } from "./style.ts";

// ------------------------------------------------------------------ layout
interface Layout { lw: number; lh: number; sc: number; wide: boolean; phone: boolean; short: boolean }
function layoutNow(): Layout {
  const f = frame();
  const sc = ui.preferences().scale;
  const sa = f.safeArea;
  const lw = Math.max(1, (f.width - sa.left - sa.right) / sc), lh = Math.max(1, (f.height - sa.top - sa.bottom) / sc);
  return { lw, lh, sc, wide: lw >= 1024, phone: lw <= 700 && lh > lw, short: lh <= 500 && lw > lh };
}
const lastSize = new Map<string, ui.Rect>();
function textWidth(text: string, style: string, kind?: "button" | "heading"): number {
  return ui.measureText(text, { ...(kind ? { kind } : {}), style: [style] }).width / ui.preferences().scale;
}
/** Text up to `width` wide: one label when it fits, else a paragraph. */
function para(text: string, width: number, cls = "text", id?: string, size?: number): void {
  if (!text) return;
  let u = size ? ui.style(cls, { text: { size } }) : ui.style(cls);
  if (id) u = u.id(id);
  if (ui.measureText(text, { style: [cls], ...(size ? { size } : {}) }).width / ui.preferences().scale <= width) u.label(text);
  else u.paragraph(text, Math.max(20, width));
}
interface Btn { id: string; text: string; style?: string; act: () => void; disabled?: boolean; name?: string; selected?: boolean; content?: () => void; width?: number; height?: number }
const buttonWidth = (text: string, style: string): number => textWidth(text, style, "button") + 4;
function button(b: Btn): void {
  const style = b.style ?? "link-btn";
  const opts: ui.ButtonOptions = {};
  if (b.disabled) opts.disabled = true;
  if (b.selected !== undefined) opts.selected = b.selected;
  if (b.content) opts.content = b.content;
  else if (b.name && b.name !== b.text) opts.content = () => { ui.label(b.text); };
  const s: ui.Style = {};
  if (b.width != null) s.width = b.width;
  if (b.height != null) s.height = b.height;
  if (ui.style(style, s).id(b.id).button(b.name ?? b.text, opts) && fresh()) later(b.act);
}
/** Buttons at their own widths in rows that wrap at `width` (flex-wrap). */
function flow(label: string, list: Btn[], width: number, gap = 10, justify: "start" | "center" | "end" = "center"): void {
  const rows: Btn[][] = [[]];
  let used = 0;
  const bw = (b: Btn): number => Math.min(width, b.width ?? buttonWidth(b.text, b.style ?? "link-btn"));
  for (const b of list) {
    const w = bw(b);
    if (rows[rows.length - 1]!.length && used + gap + w > width) { rows.push([]); used = 0; }
    used += (rows[rows.length - 1]!.length ? gap : 0) + w;
    rows[rows.length - 1]!.push(b);
  }
  ui.column(label, () => {
    rows.forEach((row, ri) => ui.row(`${label}-r${ri}`, () => { for (const b of row) button(b); }, { spacing: gap, width, justify, align: "center" }));
  }, { spacing: gap, width });
}
function rect(r: ui.Rect): void { hudRects.push({ x: r.x, y: r.y, width: r.width, height: r.height }); }
/** A box over a window rectangle (window px) drawn by a placed role-none widget (its draw paints it). */
function paint(id: string, x: number, y: number, w: number, h: number, drawFn: (r: ui.Rect) => void): void {
  if (w <= 0 || h <= 0) return;
  const sc = ui.preferences().scale, sa = frame().safeArea;
  ui.place(id, { anchor: "top-start", x: (x - sa.left) / sc, y: (y - sa.top) / sc }, () => {
    ui.widget("", { role: "none", size: { width: w / sc, height: h / sc }, draw: drawFn });
  });
}
/** The window rectangle of a logical one. */
function toWindow(x: number, y: number, w: number, h: number): ui.Rect {
  const sc = ui.preferences().scale, sa = frame().safeArea;
  return { x: sa.left + x * sc, y: sa.top + y * sc, width: w * sc, height: h * sc };
}

// ------------------------------------------------------------------ the frame
export function drawScreens(): void {
  const L = layoutNow();
  const f = frame();
  if (app.screen) {
    fullScreen(L);
  } else {
    playScreen(L);
    if (session.machine === "paused") pauseCard(L);
  }
  toasts(L);
  if (app.focusNext) {
    const age = f.frame - app.openedFrame;
    if (age >= 1) ui.setFocus(app.focusNext);
    if (age >= 3) app.focusNext = null;
  }
}

// ------------------------------------------------------------------ the play screen (index.html #topbar, #layout)
function playScreen(L: Layout): void {
  const sc = L.sc;
  const s = session.state, def = app.def;
  const live = playing();
  // The bar is as tall as its chips need (style.css min-height 48 / 44 phones / 40 short landscape).
  const barH = Math.max(L.phone ? 44 : L.short ? 40 : 48, (lastSize.get("bar")?.height ?? 0) / sc);
  const railW = L.wide ? 240 : 0;
  const stageL = { x: railW, y: barH, width: L.lw - 2 * railW, height: L.lh - barH };
  Object.assign(stage, toWindow(stageL.x, stageL.y, stageL.width, stageL.height));

  // ---- the top bar
  const bar = ui.place("topbar", { anchor: "top-start", x: 0, y: 0 }, () => {
    ui.row("topbar-row", () => {
      ui.style("brand").label("✍️ Pair Sum");
      const name = platform.signedIn() ? platform.displayName() || T("Player") : (platform.save().name || T("Guest"));
      const chipList: Btn[] = [
        { id: "btn-help", text: T("Help"), style: "chip", act: () => { pauseForScreen(); openScreen("help"); } },
        { id: "btn-settings", text: T("Settings"), style: "chip", act: () => { pauseForScreen(); openScreen("settings"); } },
        { id: "btn-profile", text: `👤 ${name}`, name: T("Profile"), style: "chip", act: () => { pauseForScreen(); openScreen("profile"); } },
      ];
      let chipsW = chipList.reduce((n, b) => n + buttonWidth(b.text, "chip") + 8, 0);
      if (chipsW + textWidth("✍️ Pair Sum", "brand") + 36 > L.lw) {
        // Narrow phones: the profile chip shows its icon alone (its name stays the accessible label).
        chipsW -= buttonWidth(chipList[2]!.text, "chip") - buttonWidth("👤", "chip");
        chipList[2]!.text = "👤";
      }
      const mid = L.lw - textWidth("✍️ Pair Sum", "brand") - chipsW - 110;
      if (!L.phone && mid > 60) {
        ui.column("topbar-status", () => { para(def ? defTitle(def) : "", mid, "top-status", "topbar-status-text"); }, { width: mid, align: "center" });
      } else ui.spacer();
      const chips = (): void => { for (const b of chipList) button(b); };
      ui.row("topbar-actions", chips, { spacing: 8, align: "center" });
    }, { style: "topbar", width: L.lw, spacing: 12, align: "center" });
  });
  lastSize.set("bar", bar);
  rect(bar);

  // ---- the rails (wide)
  if (L.wide) {
    rail("rail-left", "top-start", barH, L.lh - barH, () => leftRail(railW - 28));
    rail("rail-right", "top-end", barH, L.lh - barH, () => rightRail(railW - 28));
    const line = (id: string, x: number): void => paint(id, toWindow(x, 0, 0, 0).x, toWindow(0, barH, 0, 0).y, 2 * sc, (L.lh - barH) * sc,
      (r) => draw.rect(r.x, r.y, r.width, r.height, token("rule")));
    line("rail-left-edge", railW - 2);
    line("rail-right-edge", L.lw - railW);
  }

  // ---- the HUD pill (objective) and its alert
  let top = stageL.y + 8;
  if (s && def) {
    const pillW = Math.min(stageL.width - 24, (L.short ? 0.56 * L.lw : 9999));
    const pill = ui.place("hud", { anchor: "top-start", x: stageL.x + stageL.width / 2 - (lastSize.get("hud")?.width ?? 0) / sc / 2, y: stageL.y + 8 }, () => {
      ui.column("hud-col", () => {
        ui.column("hud-pill", () => para(objectiveText(), pillW - 34, "pill-text", "hud-objective"), { style: "hud-pill", align: "center" });
        if (app.alert) ui.column("hud-alert", () => para(app.alert!.text, pillW - 30, "alert-text", "hud-alert-text"), { style: "hud-alert", align: "center" });
      }, { align: "center", spacing: 8 });
    });
    lastSize.set("hud", pill);
    top = (pill.y + pill.height - frame().safeArea.top) / sc;
  }

  // ---- the lesson banner (side panel on short landscape)
  let freeL = stageL.x, freeR = stageL.x + stageL.width, freeT = top + 4, freeB = stageL.y + stageL.height;
  if (app.lesson && s) {
    const side = L.short;
    const bw = side ? Math.min(0.34 * L.lw, 260) : Math.min(560, 0.92 * stageL.width);
    const prev = lastSize.get("lesson");
    const x = side ? stageL.x + 10 : stageL.x + stageL.width / 2 - (prev ? prev.width / sc : bw) / 2;
    const y = stageL.y + 48;
    const banner = ui.place("lesson", { anchor: "top-start", x, y }, () => {
      ui.column("lesson-banner", () => {
        para(T(app.lesson!), bw - 36, side ? "text-small" : "lesson-text", "lesson-text");
        ui.row("lesson-actions", () => {
          ui.spacer();
          button({ id: "btn-lesson-skip", text: T("Skip lesson"), style: "chip", act: skipLesson });
        }, { width: bw - 36 });
      }, { style: "lesson-banner", width: bw, spacing: side ? 6 : 8 });
    });
    lastSize.set("lesson", banner);
    rect(banner);
    if (side) freeL = Math.max(freeL, (banner.x + banner.width) / sc - frame().safeArea.left / sc + 4);
    else freeT = Math.max(freeT, (banner.y + banner.height) / sc - frame().safeArea.top / sc + 4);
  }

  // ---- the action tray
  if (s && def) {
    let items: { id: string; icon: string; text: string; act: () => void; disabled: boolean; primary?: boolean }[] = [
      { id: "btn-hint", icon: "💡", text: T("Hint"), act: doHint, disabled: !live || !def.assists?.hints },
      { id: "btn-undo", icon: "↩️", text: T("Undo"), act: doUndo, disabled: !live || !session.undoAllowed() },
      { id: "btn-addrows", icon: "➕", text: T("Add rows"), act: doAddRows, disabled: !live, primary: true },
      { id: "btn-pause", icon: "⏸️", text: T("Pause"), act: doPause, disabled: !live },
    ];
    if (platform.options.leftHanded) items = items.reverse();
    const vertical = L.short;
    const full = L.phone;
    const bw = full ? (L.lw - 24 - 24 - 3 * 10) / 4 : 64;
    const build = (): void => {
      for (const b of items) {
        button({
          id: b.id, text: b.text, name: b.text, style: "tray-btn", act: b.act, disabled: b.disabled, width: full ? bw : undefined,
          content: () => ui.column(`${b.id}-face`, () => {
            ui.style("tray-icon").label(b.icon);
            ui.style(b.primary ? "tray-label-primary" : "tray-label").label(b.text);
          }, { align: "center", spacing: 1 }),
        });
      }
    };
    const prev = lastSize.get("tray");
    let tray: ui.Rect;
    if (vertical) {
      tray = ui.place("tray", { anchor: "bottom-end", x: 10, y: 10 }, () => ui.column("tray-col", build, { style: "tray-wide", spacing: 10, align: "center" }));
      freeR = Math.min(freeR, L.lw - 10 - tray.width / sc - 4);
    } else {
      const x = full ? 12 : stageL.x + stageL.width / 2 - (prev ? prev.width / sc : 300) / 2;
      tray = ui.place("tray", { anchor: "bottom-start", x, y: 10 }, () =>
        ui.row("tray-row", build, { style: full ? "tray-wide" : "tray", spacing: 10, align: "center", ...(full ? { width: L.lw - 24, justify: "space-around" as const } : {}) }));
      freeB = Math.min(freeB, L.lh - 10 - tray.height / sc - 4);
    }
    lastSize.set("tray", tray);
    rect(tray);
  }
  Object.assign(free, toWindow(freeL, freeT, Math.max(1, freeR - freeL), Math.max(1, freeB - freeT)));

  // ---- the countdown (3, 2, 1, Go!)
  if (app.countdownAt !== null) {
    const k = Math.floor((session.clock() - app.countdownAt) / 600);
    const text = ["3", "2", "1", T("Go!")][Math.max(0, Math.min(3, k))]!;
    const size = Math.max(64, Math.min(144, 0.18 * L.lw));
    ui.place("countdown", { anchor: "top-start", x: stageL.x, y: stageL.y + stageL.height / 2 - size * 0.7 }, () => {
      ui.column("countdown-col", () => { ui.style("countdown", { text: { size } }).id("countdown").label(text); }, { width: stageL.width, align: "center" });
    });
  }

  // ---- the caption line (sound captions)
  if (app.caption) {
    ui.place("caption", { anchor: "bottom", y: 76 }, () => ui.column("caption-col", () => para(app.caption!.text, Math.min(L.lw - 60, 420), "caption-text", "caption-text"), { style: "caption", align: "center" }));
  }

  boardTargets(L);
}

function rail(id: string, anchor: "top-start" | "top-end", topY: number, h: number, build: () => void): void {
  const r = ui.place(id, { anchor, x: 0, y: topY }, () => {
    ui.column(id, () => {
      const prev = lastSize.get(`${id}-in`);
      const scroll = !!prev && prev.height / ui.preferences().scale > h - 32;
      const body = (): void => { lastSize.set(`${id}-in`, ui.column(`${id}-in`, build, { spacing: 6, width: 212 - (scroll ? 14 : 0) })); };
      if (scroll) ui.scrollArea(`${id}-scroll`, { width: 212, height: h - 32 }, body);
      else body();
    }, { style: "rail", width: 240, height: h, spacing: 0 });
  });
  rect(r);
}
function objectiveText(): string {
  const s = session.state!;
  const parts = [T("{n} digits left", { n: Rules.remainingCount(s) })];
  if (s.limits.moves != null) parts.push(T("{n} moves", { n: Math.max(0, s.limits.moves - s.moves) }));
  if (s.limits.timeMs != null) parts.push(fmtMs(Math.max(0, s.limits.timeMs - displayElapsed())));
  return parts.join(" · ");
}
function displayElapsed(): number {
  const s = session.state!;
  return session.machine === "active" || session.machine === "tutorial" ? Math.floor(session.nowMs()) : s.elapsedMs;
}
function statRow(id: string, label: string, value: string, w: number): void {
  ui.row(id, () => {
    ui.style("stat-label").label(label);
    ui.spacer();
    ui.style("stat-value").id(`${id}-v`).label(value);
  }, { style: "stat-row", width: w, align: "center" });
}
/** index.html #rail-left: the objective and the round's stats. */
function leftRail(w: number): void {
  const s = session.state;
  para(T("Objective").toUpperCase(), w, "rail-title");
  para(T("Clear the page by connecting matching pairs."), w, "text", "objective-text");
  ui.spacer(0.0001);
  statRow("stat-score", T("Score"), s ? String(s.score.total) : "0", w);
  statRow("stat-chain", T("Chain"), s && s.chain > 1 ? `${s.chain}×` : "—", w);
  statRow("stat-remaining", T("Digits left"), s ? String(Rules.remainingCount(s)) : "0", w);
  if (s && s.limits.moves != null) statRow("stat-moves", T("Moves left"), String(Math.max(0, s.limits.moves - s.moves)), w);
  if (s && s.limits.timeMs != null) statRow("stat-time", T("Time left"), fmtMs(Math.max(0, s.limits.timeMs - displayElapsed())), w);
  const done = Object.values(platform.save().progress.journey).filter((j) => j.done).length;
  para(T("Journey: {done}/{total} pages cleared.", { done, total: Content.JOURNEY.length }), w, "mini", "journey-mini");
}
/** index.html #rail-right: the status and the cloud-save line. */
function rightRail(w: number): void {
  para(T("Status").toUpperCase(), w, "rail-title");
  const st = platform.syncState();
  const text = st === "local" ? N("Offline — progress stays on this device.") : st === "saving" ? N("Saving to your account…")
    : st === "synced" ? N("Progress synced to your account.") : N("Cloud sync unavailable — changes kept on this device.");
  para(T(text), w, st === "error" ? "sync-error" : "sync-note", "sync-note");
}

// ------------------------------------------------------------------ the board's named targets and the cursor
function boardTargets(L: Layout): void {
  const s = session.state;
  if (!s || !inRound() || session.machine === "paused") return;
  const cols = s.cols;
  for (let i = 0; i < s.cells.length; i++) {
    const v = s.cells[i]!;
    if (v === 0) continue;
    const r = render.cellRect(i);
    if (!r || r.width <= 0) continue;
    const name = T("Row {r}, column {c}, digit {v}", { r: Math.floor(i / cols) + 1, c: (i % cols) + 1, v }) + (i === session.selection ? T(", selected") : "");
    ui.target(name, r, { role: "button" });
  }
  const cur = app.cursor;
  if (cur != null && app.cursorShown && s.cells[cur] !== 0) {
    const r = render.cellRect(cur);
    if (r) {
      const sc = L.sc, sa = frame().safeArea;
      ui.place("board-cursor", { anchor: "top-start", x: (r.x - sa.left) / sc - 4, y: (r.y - sa.top) / sc - 4 }, () => {
        ui.widget("", { role: "none", size: { width: r.width / sc + 8, height: r.height / sc + 8 }, draw: (q) => draw.box(q.x, q.y, q.width, q.height, "cursor") });
      });
    }
  }
}

// ------------------------------------------------------------------ toasts
function toasts(L: Layout): void {
  if (!app.toasts.length) return;
  const w = Math.min(L.lw - 24, 360);
  ui.place("toast-stack", { anchor: "bottom-end", x: 12, y: 90 }, () => {
    ui.column("toast-col", () => {
      app.toasts.forEach((t, i) => ui.column(`toast-${i}`, () => para(t.text, w - 36, "toast-text", `toast-${i}-text`), { style: "toast" }));
    }, { spacing: 8, align: "end" });
  });
}

// ------------------------------------------------------------------ the pause card (index.html #pause-overlay)
function pauseCard(L: Layout): void {
  // Short landscape: a compact card (the links in wrapping rows) so it fits 390 px.
  const compact = L.lh < 560;
  const w = Math.min(compact ? 560 : 420, 0.92 * L.lw);
  const inner = w - (compact ? 40 : 64);
  const links: Btn[] = [
    { id: "btn-pause-settings", text: T("Settings"), style: "link-btn", act: () => openScreen("settings") },
    { id: "btn-pause-help", text: T("Help"), style: "link-btn", act: () => openScreen("help") },
    { id: "btn-restart-round", text: T("Restart round"), style: "link-btn", act: () => { resumeRound(); restartRound(); } },
    { id: "btn-leave-round", text: T("Leave round"), style: "link-danger", act: () => { resumeRound(); leaveRound(); } },
  ];
  const open = ui.dialog(T("Paused"), "", true, () => {
    ui.column("pause-card", () => {
      ui.style("screen-h1", { text: { size: compact ? 24 : 32 } }).id("pause-h").label(T("Paused"));
      para(pauseSummary(), inner, "dim-small", "pause-summary");
      ui.column("pause-actions", () => {
        button({ id: "btn-resume", text: T("Resume"), style: "big-btn", width: inner, act: resumeRound });
        if (compact) flow("pause-links", links, inner, 4);
        else for (const b of links) button(b);
      }, { spacing: compact ? 4 : 8, align: "center", width: inner });
    }, { style: "pause-card", width: w, align: "center", spacing: compact ? 6 : 12, ...(compact ? { padding: 16 } : {}) });
  });
  // Escape / Back closes the card: resume (not on the frame it opened).
  if (!open && fresh()) later(resumeRound);
}

// ------------------------------------------------------------------ full-page screens (index.html .screen)
function fullScreen(L: Layout): void {
  const f = frame();
  const look = currentLook();
  const hc = ui.preferences().highContrast;
  const ruled = look.detailed && !hc;
  // The page (with the ruled notebook lines and margin at Surface detail Detailed).
  paint("page", 0, 0, f.width, f.height, (r) => {
    draw.rect(r.x, r.y, r.width, r.height, token("paper"));
    if (!ruled) return;
    const sc = L.sc;
    const line = mix(token("rule"), 0.42, token("paper"));
    for (let y = 31 * sc; y < r.height; y += 32 * sc) draw.rect(r.x, r.y + y, r.width, Math.max(1, sc), line);
    if (L.lw >= 760) draw.rect(r.x + 63 * sc, r.y, 2 * sc, r.height, mix("#d98f8f", 0.6, token("paper")));
  });
  const footerH = app.screen === "title" ? 0 : (lastSize.get("footer")?.height ?? 70 * L.sc) / L.sc;
  const bodyH = L.lh - footerH;
  const cw = Math.min(L.lw - 40, contentWidth(app.screen!, L));
  const key = `screen-${app.screen}`;
  const prev = lastSize.get(key);
  const scroll = !!prev && prev.height / L.sc > bodyH;
  const opening = f.frame - app.openedFrame <= 6;
  ui.place("screen", { anchor: "top-start", x: 0, y: 0 }, () => {
    ui.column("screen-col", () => {
      const body = (): void => {
        const r = ui.column(`${key}-body`, () => {
          ui.column(`${key}-inner`, () => buildScreen(app.screen!, cw - (scroll ? 14 : 0), L), {
            width: cw - (scroll ? 14 : 0), spacing: 12, align: "center",
          });
        }, { width: L.lw - (scroll ? 14 : 0), align: "center", padding: { top: 24, bottom: 16 } });
        lastSize.set(key, r);
      };
      if (scroll) ui.scrollArea(`${key}-scroll`, { width: L.lw, height: bodyH }, body, opening ? { scrollTo: { top: 0 } } : undefined);
      else if (app.screen === "title") {
        // The title is centred in the window (safe centring: overflow scrolls from the top).
        ui.column("title-centre", () => { ui.spacer(); body(); ui.spacer(); }, { width: L.lw, height: bodyH });
      } else body();
    }, { width: L.lw, height: L.lh, spacing: 0 });
  });
  if (app.screen !== "title") {
    const foot = ui.place("footer", { anchor: "bottom", y: 0 }, () => {
      ui.column("footer-col", () => footer(app.screen!, Math.min(L.lw - 24, 560)), { width: L.lw, align: "center", padding: { top: 8, bottom: 12 } });
    });
    lastSize.set("footer", foot);
  }
}
function contentWidth(name: string, L: Layout): number {
  switch (name) {
    case "modes": case "achievements": return Math.min(720, 0.94 * L.lw);
    case "journey": return Math.min(680, 0.94 * L.lw);
    case "help": case "boards": return Math.min(640, 0.94 * L.lw);
    case "title": return Math.min(480, L.lw);
    default: return Math.min(560, 0.94 * L.lw);
  }
}
function h1(text: string, L: Layout, id: string): void {
  const size = Math.max(28.8, Math.min(41.6, 0.05 * L.lw));
  para(text, Math.min(L.lw - 40, 700), "screen-h1", id, size);
}
function buildScreen(name: string, w: number, L: Layout): void {
  switch (name) {
    case "title": titleScreen(w, L); break;
    case "modes": modesScreen(w, L); break;
    case "journey": journeyScreen(w, L); break;
    case "setup": setupScreen(w, L); break;
    case "results": resultsScreen(w, L); break;
    case "help": helpScreen(w, L); break;
    case "settings": settingsScreen(w, L); break;
    case "achievements": achievementsScreen(w, L); break;
    case "boards": boardsScreen(w, L); break;
    case "profile": profileScreen(w, L); break;
  }
}
function footer(name: string, w: number): void {
  if (name === "setup") {
    const list: Btn[] = [];
    if (app.setup?.kind === "fixed" || app.setup?.kind === "practice") list.push({ id: "btn-setup-start", text: T("Start"), style: "big-btn", act: startPending });
    list.push({ id: "btn-back", text: T("← Back"), style: "back-btn", act: back });
    flow("setup-actions", list, w, 14);
  } else if (name === "results") {
    flow("results-actions", [
      { id: "btn-retry", text: T("Retry"), style: "big-btn", act: restartRound },
      { id: "btn-next", text: T(app.results?.nextLabel ?? N("Next")), style: "big-btn-secondary", act: nextAfterResults },
      { id: "btn-results-home", text: T("Title"), style: "link-btn", act: goTitle },
    ], w, 14);
  } else {
    button({ id: "btn-back", text: T("← Back"), style: "back-btn", act: back });
  }
}

// ------------------------------------------------------------------ title
function titleTiles(L: Layout): void {
  if (L.lh <= 500) return;
  const look = currentLook();
  const hc = ui.preferences().highContrast;
  const lacquer = look.detailed && !hc;
  const bob = look.ambient && !ui.preferences().reducedMotion;
  const t = frame().time;
  const delays = [0, -0.8, -1.7, -2.5];
  ui.row("title-tiles", () => {
    [["3", "7"], ["5", "5"]].forEach((pair, p) => {
      ui.widget("", {
        role: "none", size: { width: 106, height: 64 },
        draw: (r, st) => {
          const s = st.scale;
          // The dashed arc joining the pair (tile-pair::after).
          const ax = r.x + 24 * s, aw = r.width - 48 * s, ay = r.y + 2 * s;
          const accent = token("accent");
          for (let k = 0; k < 9; k++) {
            if (k % 2) continue;
            const x0 = ax + (aw * k) / 9, x1 = ax + (aw * (k + 1)) / 9;
            draw.line(x0, ay, x1, ay, accent, 2 * s);
          }
          draw.line(ax, ay, ax - 2 * s, ay + 12 * s, accent, 2 * s);
          draw.line(ax + aw, ay, ax + aw + 2 * s, ay + 12 * s, accent, 2 * s);
          pair.forEach((d, i) => {
            const phase = delays[p * 2 + i]!;
            const dy = bob ? -4 * s * (0.5 - 0.5 * Math.cos(((t - phase) / 3.4) * 2 * Math.PI)) : 0;
            const x = r.x + i * 58 * s, y = r.y + 14 * s + dy, sz = 48 * s;
            if (lacquer) {
              draw.roundRect(x, y + 3 * s, sz, sz, 10, mix(token("rule"), 0.8, "#000000"));
              draw.roundRect(x, y, sz, sz, 10, token("panel"));
              draw.roundRect(x + 2 * s, y + 2 * s, sz - 4 * s, sz * 0.45, 8, mix(token("panel"), 0.7, "#ffffff"));
              draw.strokeRoundRect(x, y, sz, sz, 10, mix(token("rule"), 0.85, "#000000"), 2);
            } else {
              draw.roundRect(x, y, sz, sz, 10, token("panel"));
              draw.strokeRoundRect(x, y, sz, sz, 10, token("rule"), 2);
            }
            draw.text(d, x + sz / 2, y + sz / 2 - 15 * s, { size: 25.6 * s, font: "serif", weight: "bold", color: token("ink"), align: "center" });
          });
        },
      });
    });
  }, { spacing: 28 });
}
function titleScreen(w: number, L: Layout): void {
  const save = platform.save();
  titleTiles(L);
  ui.spacer(0.0001);
  para("Pair Sum", L.lw - 40, "title-h1", "title-h", Math.max(41.6, Math.min(72, 0.09 * L.lw)));
  para(T("Connect equal numbers — or pairs that make ten — along open paths."), Math.min(w, 46 * 9), "tagline", "tagline");
  const bw = Math.min(320, 0.86 * L.lw);
  ui.column("title-actions", () => {
    button({ id: "btn-play", text: T("Play"), style: "big-btn", width: bw, act: openPlay });
    if (save.snapshot) button({ id: "btn-continue", text: T("Continue round"), style: "big-btn-secondary", width: bw, act: continueRound });
  }, { spacing: 12, align: "center" });
  const today = `daily-${new Date(platform.nowMs()).toISOString().slice(0, 10)}`;
  const done = Object.values(save.progress.journey).filter((j) => j.done).length;
  const links: Btn[] = [
    { id: "btn-daily", text: `📅 ${T("Daily challenge")}${save.progress.bestDaily[today] ? ` ${T("(done ✓)")}` : ""}`, act: () => openMode("daily") },
    { id: "btn-journey", text: `🗺️ ${T("Journey")} (${done}/${Content.JOURNEY.length})`, act: () => openMode("journey") },
    { id: "btn-boards", text: `🏆 ${T("Scores")}`, act: () => openScreen("boards") },
    { id: "btn-achievements", text: `🎖️ ${T("Achievements")}`, act: () => openScreen("achievements") },
    { id: "btn-title-settings", text: `⚙️ ${T("Settings")}`, act: () => openScreen("settings") },
  ];
  if (!platform.signedIn()) links.push({ id: "btn-sh-signin", text: S("signIn"), act: signIn });
  if (platform.inviteLink()) links.push({ id: "btn-sh-invite", text: S("invite"), act: copyInvite });
  ui.column("title-secondary", () => { for (const b of links) button(b); }, { spacing: 6, align: "center", padding: { top: 14 } });
}

// ------------------------------------------------------------------ modes, journey, setup
const MODES = [
  { id: "learn", icon: "🎓", name: N("Learn"), desc: N("Six short interactive lessons. One rule at a time — you perform each move."), meta: N("5–10 min · unranked") },
  { id: "journey", icon: "🗺️", name: N("Journey"), desc: N("Forty authored pages across five notebooks, with mastery stages."), meta: N("Long form · progress saved") },
  { id: "daily", icon: "📅", name: N("Daily"), desc: N("One shared seed for everyone, per UTC day. No hints, no undo."), meta: N("3 min · ranked") },
  { id: "practice", icon: "🧘", name: N("Practice"), desc: N("Pick a difficulty. Hints, undo and restart freely; never ranked."), meta: N("Unranked") },
  { id: "challenge", icon: "⏱️", name: N("Challenge"), desc: N("Move limits, speed targets, altered layouts, restricted tools."), meta: N("Ranked") },
  { id: "score", icon: "🏆", name: N("Score chase"), desc: N("Chase the global and friends boards on validated seeds."), meta: N("Ranked") },
];
/** CSS repeat(auto-fit, minmax(min, 1fr)). */
function cardGrid(id: string, count: number, w: number, min: number, gap: number, cell: (i: number, cw: number) => void): void {
  const cols = Math.max(1, Math.floor((w + gap) / (min + gap)));
  const cw = (w - (cols - 1) * gap) / cols;
  ui.column(id, () => {
    for (let r = 0; r * cols < count; r++) {
      ui.row(`${id}-r${r}`, () => { for (let i = r * cols; i < Math.min(count, (r + 1) * cols); i++) cell(i, cw); }, { spacing: gap, align: "stretch" });
    }
  }, { spacing: gap, width: w });
}
/** A card button (mode-card): a title, text and a meta line. */
function cardButton(id: string, name: string, title: string, text: string, meta: string, cw: number, act: () => void, accent = false): void {
  const inner = cw - 36;
  button({
    id, text: name, name, style: accent ? "card-btn-accent" : "card-btn", width: cw, act,
    content: () => ui.column(`${id}-face`, () => {
      para(title, inner, "mode-h3");
      para(text, inner, "mode-p");
      if (meta) para(meta, inner, "meta");
    }, { spacing: 6, width: inner }),
  });
}
function modesScreen(w: number, L: Layout): void {
  h1(T("Choose a mode"), L, "modes-h");
  cardGrid("mode-list", MODES.length, w, 200, 12, (i, cw) => {
    const m = MODES[i]!;
    cardButton(`mode-${m.id}`, T(m.name), `${m.icon} ${T(m.name)}`, T(m.desc), T(m.meta), cw, () => openMode(m.id), m.id === "challenge");
  });
}
function journeyScreen(w: number, L: Layout): void {
  const prog = platform.save().progress;
  h1(T("Journey"), L, "journey-h");
  para(T("Forty pages across five notebooks. Mastery stages every eighth page."), w, "sub", "journey-sub");
  const perRow = L.phone ? 4 : 8, gap = 6;
  const nw = (w - (perRow - 1) * gap) / perRow;
  for (let t = 0; t < 5; t++) {
    ui.column(`journey-theme-${t}`, () => {
      para(T(Content.THEMES[t]!.name), w, "journey-h3");
      for (let rr = 0; rr < 8 / perRow; rr++) {
        ui.row(`journey-row-${t}-${rr}`, () => {
          for (let s = rr * perRow; s < (rr + 1) * perRow; s++) {
            const idx = t * 8 + s;
            const def = Content.JOURNEY[idx]!;
            const rec = prog.journey[def.id];
            const unlocked = idx === 0 || !!prog.journey[Content.JOURNEY[idx - 1]!.id]?.done;
            const mastery = !!def.goals?.mastery;
            const name = `${defTitle(def)}${mastery ? T(" (mastery)") : ""}${rec?.done ? T(", completed, best {best}", { best: rec.best }) : unlocked ? "" : T(", locked")}`;
            const done = !!rec?.done;
            const cls = mastery ? (done ? "stage-mastery-done" : "stage-mastery") : done ? "stage-done" : "stage";
            button({
              id: `stage-${idx + 1}`, text: name, name, style: cls, width: nw, height: nw, disabled: !unlocked, act: () => pickStage(def),
              content: () => ui.column(`stage-${idx + 1}-face`, () => {
                ui.style(done ? "stage-n-done" : "stage-n").label(mastery ? "★" : String(idx + 1));
                if (rec?.stars) ui.style(done ? "stage-stars-done" : "stage-stars").label("★".repeat(rec.stars));
              }, { align: "center", spacing: 0 }),
            });
          }
        }, { spacing: gap });
      }
    }, { spacing: 6, width: w, padding: { top: 8 } });
  }
}
function kv(id: string, key: string, value: string, w: number): void {
  const kw = textWidth(key, "kv-key") + 4;
  const vw = w - kw - 18;
  ui.row(id, () => {
    ui.column(`${id}-k`, () => ui.style("kv-key").label(key), { width: kw });
    ui.column(`${id}-v`, () => para(value, vw - 4, "kv-val"), { width: vw, align: "end" });
  }, { style: "kv-row", width: w, spacing: 18, align: "start" });
}
function setupScreen(w: number, L: Layout): void {
  const p = app.setup;
  if (!p) return;
  const def = p.kind === "fixed" || p.kind === "practice" ? p.def ?? null : null;
  h1(def && p.title === def.title ? defTitle(def) : T(p.title), L, "setup-h");
  ui.column("setup-body", () => {
    if (p.kind === "practice") {
      flow("diff-row", Content.PRACTICE_DIFFICULTIES.map((d) => ({
        id: `diff-${d.id}`, text: T(d.name), style: "diff-btn", selected: d.id === app.practiceDiff, act: () => pickDifficulty(d.id),
      })), w, 8, "start");
    }
    if (def) setupDetails(def, w);
    if (p.note) para(T(p.note), w, "note", "setup-note");
    if (p.kind === "learn") {
      cardGrid("lesson-list", Content.LESSONS.length, w, 200, 12, (i, cw) => {
        const l = Content.LESSONS[i]!;
        const intro = T(l.tutorial!.steps[0]!.text);
        cardButton(`lesson-${i + 1}`, `${i + 1}. ${T(l.title)}`, `${i + 1}. ${T(l.title)}`, intro.length > 72 ? `${intro.slice(0, 72)}…` : intro, "", cw, () => pickLesson(i));
      });
    }
    if (p.kind === "challenge") {
      cardGrid("challenge-list", Content.CHALLENGES.length, w, 200, 12, (i, cw) => {
        const c = Content.CHALLENGES[i]!;
        cardButton(`challenge-${c.id}`, T(c.name), T(c.name), T(c.note), T("ranked"), cw, () => pickChallenge(i));
      });
    }
  }, { spacing: 12, width: w });
}
function setupDetails(def: Def, w: number): void {
  const pairs = Math.floor(def.cells.filter((c) => c !== 0).length / 2);
  kv("kv-board", T("Board"), T("{rows} rows × {cols} · {pairs} pairs", { rows: def.cells.length / def.cols, cols: def.cols, pairs }), w);
  kv("kv-rules", T("Rules"), T("Connect equal numbers or pairs summing to ten along a clear row, column, or fold."), w);
  kv("kv-expected", T("Expected"), def.limits?.timeMs ? T("{time} limit", { time: fmtMs(def.limits.timeMs) })
    : T("{a}–{b} min", { a: Math.max(2, Math.round((pairs * 4) / 60)), b: Math.max(3, Math.round((pairs * 9) / 60)) }), w);
  kv("kv-players", T("Players"), T("1 (asynchronous score comparison)"), w);
  kv("kv-assists", T("Assists"), T("Hints {hints} · Undo {undo}", { hints: def.assists?.hints ? T("on") : T("off"), undo: def.assists?.undo ? T("on") : T("off") }), w);
  kv("kv-limits", T("Limits"), [def.limits?.moves ? T("{n} moves", { n: def.limits.moves }) : null, def.limits?.timeMs ? fmtMs(def.limits.timeMs) : null]
    .filter(Boolean).join(" · ") || T("None"), w);
  kv("kv-result", T("Result"), def.ranked ? T("Ranked — submitted with seed and ruleset") : T("Unranked — no effect on rating"), w);
  kv("kv-seed", T("Seed"), def.seed, w);
}

// ------------------------------------------------------------------ results
function resultsScreen(w: number, L: Layout): void {
  const R = app.results;
  h1(T("Results"), L, "results-h");
  if (!R) return;
  const r = R.result;
  const won = r.status === "won";
  const headline = T(won ? N("Page cleared!") : r.reason === "time-limit" ? N("Out of time") : r.reason === "move-limit" ? N("Out of moves") : N("Round ended"));
  para(headline, w, "result-headline", "result-headline");
  const rows: [string, string, number][] = [
    [T("Pairs cleared"), `${r.moves} × 10`, r.score.pairs],
    [T("Chain bonus"), T("best chain {n}×", { n: r.bestChain }), r.score.chain],
    [T("Row clears"), "", r.score.rows],
    [T("Board clear"), "", r.score.clear],
    [T("Time bonus"), "", r.score.time],
  ];
  const c1 = Math.max(...rows.map(([l]) => textWidth(l, "text"))) + 24, c3 = 70, c2 = w - c1 - c3;
  ui.column("score-table", () => {
    rows.forEach(([label, note, v], i) => ui.row(`score-${i}`, () => {
      ui.column(`score-${i}-a`, () => para(label, c1 - 8, "text"), { width: c1 });
      ui.column(`score-${i}-b`, () => para(note, c2 - 8, "note"), { width: c2 });
      ui.column(`score-${i}-c`, () => para(String(v), c3 - 8, "score-num", `score-${i}-n`), { width: c3, align: "end" });
    }, { style: "score-row", width: w, spacing: 0, align: "center" }));
    ui.row("score-total", () => {
      ui.column("score-total-a", () => para(T("Total"), w - c3 - 8, "total"), { width: w - c3 });
      ui.column("score-total-b", () => para(String(r.score.total), c3 - 8, "total-num", "score-total"), { width: c3, align: "end" });
    }, { style: "score-row-last", width: w, spacing: 0, align: "center" });
  }, { width: w, spacing: 0 });
  para([
    T("{time} elapsed", { time: fmtMs(r.elapsedMs) }),
    r.invalid === 1 ? T("1 invalid action") : T("{n} invalid actions", { n: r.invalid }),
    r.addRowsUsed === 1 ? T("1 redeal") : T("{n} redeals", { n: r.addRowsUsed }),
    T("seed {seed}", { seed: r.seed }),
  ].join(" · "), w, "note", "results-meta");
  if (R.isBest) para(T("★ New personal best for this page."), w, "note", "results-best");
  if (R.achievements.length) {
    para(T("🎖️ Unlocked: {names}", { names: R.achievements.map((k) => T(Content.ACHIEVEMENTS.find((a) => a.key === k)?.name ?? k)).join(", ") }), w, "note", "results-ach");
  }
  const lb = leaderboardLine();
  if (lb) para(lb, w, "note", "results-lb");
}

// ------------------------------------------------------------------ help
function keysFor(action: string): string {
  const GLYPH: Record<string, string> = { "Arrow Up": "↑", "Arrow Down": "↓", "Arrow Left": "←", "Arrow Right": "→", Escape: "Esc" };
  let list: string[] = [];
  try { list = bindings(action).filter((b) => b.device === "keyboard").map((b) => GLYPH[b.label] ?? b.label); } catch { /* not yet */ }
  return [...new Set(list)].join(" / ");
}
function demo(id: string, cells: [string, string][]): void {
  ui.row(id, () => {
    cells.forEach(([txt, cls], i) => ui.widget("", {
      role: "none", size: { width: 40, height: 40 },
      draw: (r, st) => {
        draw.box(r.x, r.y, r.width, r.height, cls);
        draw.text(txt, r.x + r.width / 2, r.y + r.height / 2 - 11 * st.scale, { size: 18 * st.scale, font: "serif", weight: "bold", color: token("ink"), align: "center" });
        void i;
      },
    }));
  }, { spacing: 6 });
}
function helpScreen(w: number, L: Layout): void {
  h1(T("How to play"), L, "help-h");
  const inner = w - 36;
  const cards: [string, string, [string, string][]][] = [
    [N("Connect matching pairs"), N("Select two digits that are equal — or that add to ten. Both cells clear."), [["4", "demo-match"], ["4", "demo-match"], ["3", "demo-match"], ["7", "demo-match"]]],
    [N("Paths must be clear"), N("A pair connects along its row, its column, or the reading-order fold between rows. Every cell on the path must be empty; filled cells block."), [["5", "demo-match"], ["·", "demo-cell"], ["5", "demo-match"], ["8", "demo-block"]]],
    [N("Cleared cells never block"), N("Empty cells are open lanes. Clearing pairs in the middle opens longer connections across the page."), [["2", "demo-match"], ["·", "demo-cell"], ["·", "demo-cell"], ["8", "demo-match"]]],
    [N("Add rows when stuck"), N("If nothing connects, Add Rows rewrites every remaining digit as fresh rows below. It costs your chain but keeps the page alive."), [["➕", "demo-cell"]]],
    [N("Scoring"), N("Pairs score 10. Consecutive clears without a mistake build a chain bonus. Clearing whole rows and the whole board pay extra; beat par time for a bonus."), []],
  ];
  cards.forEach(([t, p, cells], i) => ui.column(`rule-${i}`, () => {
    para(T(t), inner, "rule-h3");
    para(T(p), inner, "text");
    if (cells.length) demo(`rule-${i}-demo`, cells);
  }, { style: "rule-card", width: w, spacing: 6 }));
  // The effective keys (the runtime's rebinds included).
  const k = keysFor;
  const rows: [string, string][] = [
    [[k("left"), k("right"), k("up"), k("down")].filter(Boolean).join(" "), N("Move among cells")],
    [k("choose"), N("Select / connect")], [k("cancel"), N("Cancel selection · Pause")],
    [k("hint"), N("Hint")], [k("undo"), N("Undo")], [k("addrows"), N("Add rows")], [k("camera"), N("Reset camera")],
    [T("Gamepad"), N("D-pad moves focus · A connects · B cancels · Start pauses · Y hints")],
  ];
  ui.column("controls-card", () => {
    para(T("Controls"), inner, "rule-h3");
    rows.forEach(([key, text], i) => {
      if (!key) return;
      const kw = textWidth(key, "kbd-text") + 18;
      ui.row(`ctl-${i}`, () => {
        ui.column(`ctl-${i}-k`, () => ui.style("kbd-text").label(key), { style: "kbd" });
        para(T(text), inner - kw - 8, "text");
      }, { spacing: 8, width: inner, align: "center" });
    });
    para(T("Pointer and touch: tap two tokens to connect them; tap empty paper to cancel. Every round action is in the tray."), inner, "note", "help-pointer");
  }, { style: "rule-card", width: w, spacing: 6 });
}

// ------------------------------------------------------------------ settings
function group(text: string, w: number): void { ui.column(`group-${text}`, () => para(T(text).toUpperCase(), w, "set-group"), { width: w, padding: { top: 14 } }); }
/** A labelled select in a settings row. */
function selectRow(id: string, label: string, idx: number, options: string[], w: number, set: (i: number) => void): void {
  ui.row(`${id}-row`, () => {
    para(label, w * 0.45, "text", `${id}-label`);
    ui.spacer();
    const pick = ui.id(id).select(label, idx, options, { width: Math.min(w * 0.5, 260) } as ui.WidgetOptions);
    if (pick !== idx) later(() => set(pick));
  }, { style: "set-row", width: w, align: "center" });
}
/** A settings row with a check box (a role "checkbox" widget: built-in check box labels don't wrap). */
function toggleRow(id: string, label: string, on: boolean, w: number, set: (v: boolean) => void): void {
  ui.row(`${id}-row`, () => {
    para(T(label), w - 60, "text", `${id}-label`);
    ui.spacer();
    const res = ui.id(id).widget(T(label), {
      role: "checkbox", checked: on, size: { width: 44, height: 44 },
      draw: (r, st) => {
        const s = st.scale, box = 22 * s, bx = r.x + (r.width - box) / 2, by = r.y + (r.height - box) / 2;
        draw.roundRect(bx, by, box, box, 4, on ? token("accent") : token("panel"));
        draw.strokeRoundRect(bx, by, box, box, 4, token("rule"), 2);
        if (on) draw.text("✓", bx + box / 2, by + 1 * s, { size: 17 * s, color: "#ffffff", align: "center", weight: "bold" });
      },
    });
    if (res.activated && fresh()) later(() => set(!on));
  }, { style: "set-row", width: w, align: "center" });
}
const PALETTE_NAMES: [string, string][] = [["default", N("Default")], ["deuteranopia", N("Deuteranopia-safe")], ["protanopia", N("Protanopia-safe")], ["tritanopia", N("Tritanopia-safe")]];
function settingsScreen(w: number, L: Layout): void {
  const o = platform.options;
  h1(T("Settings"), L, "settings-h");
  para(T("Sound, graphics, language, larger text, high contrast and reduced motion are in the StarHermit Options."), w, "note", "options-note");
  flow("settings-runtime", [
    { id: "btn-options", text: T("Open Options"), style: "chip", act: () => openMenu() },
    { id: "btn-rebind", text: T("Key bindings"), style: "chip", act: () => requestRebind() },
  ], w, 10, "start");
  group(N("Audio"), w);
  toggleRow("set-captions", N("Captions for sounds"), o.captions, w, (v) => platform.setOption("captions", v));
  group(N("Display"), w);
  selectRow("set-theme", T("Theme"), Math.max(0, Content.THEMES.findIndex((t) => t.id === o.theme)), Content.THEMES.map((t) => T(t.name)), w,
    (i) => platform.setOption("theme", Content.THEMES[i]!.id));
  selectRow("set-palette", T("Color palette"), Math.max(0, PALETTE_NAMES.findIndex(([id]) => id === o.palette)), PALETTE_NAMES.map(([, l]) => T(l)), w,
    (i) => platform.setOption("palette", PALETTE_NAMES[i]![0]));
  group(N("Controls"), w);
  toggleRow("set-left", N("Left-handed tray"), o.leftHanded, w, (v) => platform.setOption("leftHanded", v));
  toggleRow("set-haptics", N("Haptics"), o.haptics, w, (v) => platform.setOption("haptics", v));
  toggleRow("set-timing", N("Timing assistance (+50% clocks)"), o.timingAssist, w, (v) => platform.setOption("timingAssist", v));
  group(N("Privacy"), w);
  ui.row("set-tutorial-row", () => {
    para(T("Tutorial"), w * 0.5, "text");
    ui.spacer();
    button({ id: "btn-replay-lessons", text: T("Replay lessons"), style: "chip", act: () => openMode("learn") });
  }, { style: "set-row", width: w, align: "center" });
}

// ------------------------------------------------------------------ achievements, scores, profile
function achievementsScreen(w: number, L: Layout): void {
  const prog = platform.save().progress;
  h1(T("Achievements"), L, "ach-h");
  cardGrid("ach-body", Content.ACHIEVEMENTS.length, w, 200, 12, (i, cw) => {
    const a = Content.ACHIEVEMENTS[i]!;
    const got = prog.achievements[a.key];
    ui.column(`ach-${a.key}`, () => {
      para(`${got ? "🎖️" : "🔒"} ${T(a.name)}`, cw - 36, "mode-h3");
      para(T(a.desc), cw - 36, "mode-p");
      para(got ? T("Unlocked {date}", { date: new Date(got.at).toISOString().slice(0, 10) }) : T("Locked"), cw - 36, "meta");
    }, { style: got ? "ach-on" : "ach-off", width: cw, spacing: 6 });
  });
}
let hosted: platform.HostedRow[] | null | undefined;
let hostedFor = "";
const TABS: [string, string][] = [["daily", N("Daily")], ["score", N("Score chase")], ["challenge", N("Challenge")], ["journey", N("Journey")], ["practice", N("Practice")]];
function boardsScreen(w: number, L: Layout): void {
  h1(T("Scores"), L, "boards-h");
  const tab = app.boardsTab;
  ui.row("board-tabs", () => {
    flow("board-tabs-flow", TABS.map(([key, label]) => ({
      id: `tab-${key}`, text: T(label), style: "diff-btn", selected: key === tab, act: () => { app.boardsTab = key; },
    })), w, 8, "start");
  }, { width: w, role: "radiogroup" });
  // Journey and Practice results never leave the device; signed in, the others show the platform's board (read-only).
  const global = platform.signedIn() && (tab === "daily" || tab === "score" || tab === "challenge");
  let rows: string[][];
  let source: "global" | "local" = "local";
  if (global) {
    const key = `${tab}:${app.openedFrame}`;
    if (hostedFor !== key) { hostedFor = key; hosted = undefined; void platform.hostedBoard(false).then((r) => { hosted = r; }); }
    if (hosted === undefined) { para(T("Loading…"), w, "note", "boards-loading"); return; }
    if (hosted) {
      source = "global";
      rows = hosted.slice(0, 25).map((e, i) => [String(i + 1), e.name || "—", String(e.score), "—", "—", "—"]);
    } else rows = localRows(tab);
  } else rows = localRows(tab);
  table("board-table", w, ["#", T("Player"), T("Score"), T("Moves"), T("Time"), T("Result")], [1, 4, 2, 2, 2, 2], rows, [true, false, true, true, true, false]);
  if (!rows.length) para(T("No entries yet — be the first."), w, "note", "boards-empty");
  const label = source === "global" ? N("global (read-only)") : N("casual (local)");
  para(source === "global"
    ? T("Board: {label}. Platform leaderboard is read-only; personal bests are kept on this device and synced with your account.", { label: T(label) })
    : T("Board: {label}. Personal bests are kept on this device and synced with your account.", { label: T(label) }), w, "note", "boards-note");
}
function localRows(tab: string): string[][] {
  const name = platform.signedIn() ? platform.displayName() || T("Player") : platform.save().name || T("Guest");
  return Progress.localBoard(platform.save(), tab).slice(0, 25).map((e, i) => [
    String(i + 1), name, String(e.score), String(e.moves), fmtMs(e.elapsedMs), e.status === "won" ? "✓" : "✗",
  ]);
}
/** A table of columns sized by share, each at least its heading's longest word. */
function table(id: string, w: number, heads: string[], shares: number[], rows: string[][], numeric: boolean[]): void {
  const word = (t: string): number => Math.max(...t.split(" ").map((x) => textWidth(x, "th"))) + 14;
  const total = shares.reduce((a, b) => a + b, 0);
  const widths = shares.map((s, i) => Math.max(word(heads[i]!), (w * s) / total));
  const k = w / widths.reduce((a, b) => a + b, 0);
  const cw = widths.map((x) => x * k);
  const row = (rid: string, cells: string[], head: boolean): void => {
    ui.row(rid, () => cells.forEach((c, i) => ui.column(`${rid}-${i}`, () => para(c, cw[i]! - 10, head ? "th" : numeric[i] ? "td-num" : "td"),
      { width: cw[i]!, align: numeric[i] ? "end" : "start", padding: { start: 4, end: 4 } })), { style: "score-row", width: w, spacing: 0 });
  };
  ui.column(id, () => {
    row(`${id}-h`, heads, true);
    rows.forEach((r, i) => row(`${id}-${i}`, r, false));
  }, { width: w, spacing: 0 });
}
let nameDraft: string | null = null;
function profileScreen(w: number, L: Layout): void {
  const save = platform.save();
  const prog = save.progress;
  const hostedPlayer = platform.signedIn();
  h1(T("Profile"), L, "profile-h");
  const row = (id: string, label: string, value: () => void): void => {
    ui.row(id, () => { para(label, w * 0.45, "text"); ui.spacer(); value(); }, { style: "set-row", width: w, align: "center" });
  };
  row("prof-name", T("Display name"), () => {
    if (hostedPlayer) { ui.style("strong").label(platform.displayName() || T("Player")); return; }
    // Guests keep a local display name (the browser build's profile field), saved with Enter or Save.
    if (nameDraft === null) nameDraft = save.name;
    nameDraft = ui.id("profile-name").textField(T("Display name"), nameDraft, { maxChars: 24, width: Math.min(w * 0.5 - 70, 200), placeholder: T("Display name") });
    const commit = (): void => {
      const name = (nameDraft ?? "").trim().slice(0, 24);
      if (!name || name === save.name) return;
      save.name = name;
      platform.persist();
      toast(T("Name saved locally."));
    };
    if (ui.submitted(T("Display name")) && fresh()) later(commit);
    button({ id: "btn-save-name", text: T("Save"), style: "chip", act: commit });
  });
  row("prof-account", T("Account"), () => para(hostedPlayer ? T("StarHermit account") : save.name ? T("Local profile") : T("Guest — progress is stored on this device."), w * 0.5, "text"));
  row("prof-clears", T("Boards cleared"), () => ui.style("strong").label(String(prog.totals.clears)));
  row("prof-pairs", T("Pairs connected"), () => ui.style("strong").label(String(prog.totals.pairs)));
  row("prof-days", T("Days played"), () => ui.style("strong").label(String(prog.streakDays.length)));
  const st = platform.syncState();
  row("prof-sync", T("Cloud sync"), () => para(T(st === "local" ? N("Off — local only") : st === "saving" ? N("Saving…") : st === "synced" ? N("Synced")
    : N("Unavailable — retrying with your next save")), w * 0.5, "text"));
  para(hostedPlayer
    ? T("Connected to the platform — progress syncs to your account cloud save with conflict-safe merge.")
    : T("Offline mode — cloud save and platform identity activate when launched by the host."), w, "note");
}
