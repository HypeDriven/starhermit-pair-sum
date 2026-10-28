// Pair Sum — the save document, its merge, results/achievements bookkeeping,
// the local boards and the game's own options. Pure (no storage, no
// platform): the engine client (native/platform.ts) and the node tests share
// it. Moved here from the browser build's js/platform.js, unchanged in what
// it decides.
//
// The engine save is { v, progress, results, snapshot, name }:
//  - progress: the versioned progression document the browser build kept in
//    localStorage (pairsum:progress) and mirrored to the cloud slot
//    game:<slug> (journey pages done/best/stars, achievements, totals, streak
//    days, daily bests, mastery);
//  - results: the last 200 finished rounds (the local boards and personal
//    bests; pairsum:results, never synced by the browser build);
//  - snapshot: the paused / left round to continue (pairsum:autosave);
//  - name: the guest's local display name (pairsum:profile).
// The browser build's cloud slot held the bare progress document (the JS
// SDK's writeSave): readForeign() reads that text.

export const SAVE_VERSION = 1;
const MAX_RESULTS = 200;

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const clone = (x) => JSON.parse(JSON.stringify(x));

export function emptyProgress() {
  return { v: 1, journey: {}, achievements: {}, totals: { pairs: 0, clears: 0 }, streakDays: [], bestDaily: {}, mastery: {} };
}

export function defaultSave() {
  return { v: SAVE_VERSION, progress: emptyProgress(), results: [], snapshot: null, name: '' };
}

/** A progress document from anything (missing fields from the empty one). */
export function normalizeProgress(raw) {
  const p = obj(raw) ? clone(raw) : {};
  const out = { ...emptyProgress(), ...p };
  for (const k of ['journey', 'achievements', 'bestDaily', 'mastery']) out[k] = obj(out[k]) || {};
  out.totals = { pairs: 0, clears: 0, ...(obj(out.totals) || {}) };
  out.streakDays = Array.isArray(out.streakDays) ? out.streakDays.filter((d) => typeof d === 'string') : [];
  return out;
}

/** A save document from anything. */
export function normalize(raw) {
  const d = obj(raw) || {};
  return {
    v: SAVE_VERSION,
    progress: normalizeProgress(d.progress),
    results: Array.isArray(d.results) ? d.results.filter((r) => obj(r) && obj(r.score)).slice(-MAX_RESULTS) : [],
    snapshot: obj(d.snapshot) ? d.snapshot : null,
    name: typeof d.name === 'string' ? d.name.slice(0, 24) : '',
  };
}

/** Merge two progress docs: nothing either side earned is dropped (platform.js mergeProgress). */
export function mergeProgress(remote, local) {
  const a = remote || {}, b = local || {};
  const out = { v: 1, rev: Math.max(a.rev || 0, b.rev || 0) + 1, journey: {}, achievements: {}, totals: {}, streakDays: [], bestDaily: {}, mastery: {} };
  for (const id of new Set([...Object.keys(a.journey || {}), ...Object.keys(b.journey || {})])) {
    const x = a.journey?.[id] || {}, y = b.journey?.[id] || {};
    out.journey[id] = { done: !!(x.done || y.done), best: Math.max(x.best || 0, y.best || 0), stars: Math.max(x.stars || 0, y.stars || 0) };
  }
  for (const k of new Set([...Object.keys(a.achievements || {}), ...Object.keys(b.achievements || {})])) {
    const ats = [a.achievements?.[k]?.at, b.achievements?.[k]?.at].filter((t) => t != null);
    out.achievements[k] = { at: ats.length ? Math.min(...ats) : Date.now() };
  }
  for (const k of new Set(['pairs', 'clears', ...Object.keys(a.totals || {}), ...Object.keys(b.totals || {})])) {
    out.totals[k] = Math.max(a.totals?.[k] || 0, b.totals?.[k] || 0);
  }
  out.streakDays = [...new Set([...(a.streakDays || []), ...(b.streakDays || [])])].sort().slice(-60);
  for (const k of new Set([...Object.keys(a.bestDaily || {}), ...Object.keys(b.bestDaily || {})])) {
    out.bestDaily[k] = Math.max(a.bestDaily?.[k] || 0, b.bestDaily?.[k] || 0);
  }
  out.mastery = { ...(a.mastery || {}), ...(b.mastery || {}) };
  return out;
}

/** Whether two progress docs say the same (the merge's revision aside). */
export function sameProgress(a, b) {
  const strip = (d) => JSON.stringify({ ...normalizeProgress(d), rev: 0, v: 1 });
  return strip(a) === strip(b);
}

/** Merge two saves (another device saved since, or the old cloud slot); the local round in progress and name win. */
export function mergeSave(remote, local) {
  const a = normalize(remote), b = normalize(local);
  const progress = sameProgress(a.progress, b.progress) ? b.progress : mergeProgress(a.progress, b.progress);
  const seen = new Set();
  const results = [...a.results, ...b.results]
    .filter((r) => { const k = `${r.sessionId}|${r.at}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((x, y) => (x.at || 0) - (y.at || 0))
    .slice(-MAX_RESULTS);
  return { v: SAVE_VERSION, progress, results, snapshot: b.snapshot ?? a.snapshot, name: b.name || a.name };
}

export function sameSave(a, b) {
  const x = normalize(a), y = normalize(b);
  return sameProgress(x.progress, y.progress) && JSON.stringify([x.results, x.snapshot, x.name]) === JSON.stringify([y.results, y.snapshot, y.name]);
}

/** The browser build's cloud slot text (the bare progress document) as a save, or null. */
export function readForeign(text) {
  if (typeof text !== 'string' || !text) return null;
  try {
    const d = JSON.parse(text);
    if (!obj(d)) return null;
    if (obj(d.progress)) return normalize(d);
    if (!('journey' in d) && !('achievements' in d) && !('totals' in d)) return null;
    return normalize({ progress: d });
  } catch { return null; }
}

// --- results, progress and achievements (platform.js recordResult) ------------------------------

/** Records a finished round: the results list, the progress, the achievements. Returns the newly unlocked keys. */
export function recordResult(save, r, today, now = Date.now()) {
  save.results.push(r);
  if (save.results.length > MAX_RESULTS) save.results = save.results.slice(-MAX_RESULTS);
  const p = save.progress;
  p.rev = (p.rev || 0) + 1;
  if (r.status === 'won') {
    p.totals.clears += 1;
    p.totals.pairs += r.moves;
    if (!p.streakDays.includes(today)) p.streakDays.push(today);
    if (p.streakDays.length > 60) p.streakDays = p.streakDays.slice(-60);
    if (r.mode === 'journey') {
      const cur = p.journey[r.contentId] || {};
      p.journey[r.contentId] = {
        done: true,
        best: Math.max(cur.best || 0, r.score.total),
        stars: Math.max(cur.stars || 0, r.invalid === 0 ? 3 : r.score.total > 0 ? 2 : 1),
      };
      if (r.reason === 'board-clear' && /Mastery/.test(r.contentId)) p.mastery[r.contentId] = true;
    }
    if (r.mode === 'daily') p.bestDaily[r.contentId] = Math.max(p.bestDaily[r.contentId] || 0, r.score.total);
  } else {
    p.totals.pairs += r.moves;
  }
  return checkAchievements(p, r, now);
}

/** platform.js checkAchievements: idempotent unlocks; the newly unlocked keys. */
export function checkAchievements(p, r, now = Date.now()) {
  const newly = [];
  const push = (key) => { if (!p.achievements[key]) { p.achievements[key] = { at: now }; newly.push(key); } };
  if (r.status === 'won') push('first_clear');
  if (r.status === 'won' && r.pathTallies && r.pathTallies.row > 0 && r.pathTallies.col > 0 && r.pathTallies.seq > 0) push('mechanic_master');
  if (p.streakDays.length >= 7) push('streak_7');
  if (r.status === 'won' && r.mode === 'journey' && /-(8|16|24|32|40)$/.test(r.contentId)) push('mastery_stage');
  if (p.totals.pairs >= 1000) push('thousand_pairs');
  return newly;
}

function boardMatches(board, r) {
  if (board === 'daily') return r.mode === 'daily';
  if (board === 'journey') return r.mode === 'journey' && r.status === 'won';
  if (board === 'challenge') return r.mode === 'challenge';
  return r.mode === board;
}

/** A local board's entries, best first (platform.js leaderboard, local part). */
export function localBoard(save, board) {
  return save.results.filter((r) => boardMatches(board, r))
    .sort((a, b) => b.score.total - a.score.total)
    .slice(0, 50)
    .map((r) => ({ score: r.score.total, moves: r.moves, elapsedMs: r.elapsedMs, status: r.status, seed: r.seed }));
}

/** Whether a won round beats an earlier result of the same page (main.js checkPersonalBest). */
export function isPersonalBest(save, result) {
  const prev = save.results
    .filter((r) => r.contentId === result.contentId && r.sessionId !== result.sessionId)
    .reduce((m, r) => Math.max(m, r.score?.total || 0), 0);
  return result.status === 'won' && result.score.total > prev && prev > 0;
}

// --- the game's own options -------------------------------------------------------------------
// The browser build's settings that stay the game's (engine `settings`, synced with the account):
// the notebook theme, the colour palette, the left-handed tray, haptics, timing assistance and
// sound captions. Volumes, mute, graphics, reduced motion, high contrast and larger text are the
// runtime's Options now.
export const THEME_IDS = ['notebook', 'dusk', 'mint', 'slate', 'candy'];
export const PALETTES = ['default', 'deuteranopia', 'protanopia', 'tritanopia'];
export const DEFAULT_OPTIONS = { theme: 'notebook', palette: 'default', leftHanded: false, haptics: true, timingAssist: false, captions: false };
export const OPTION_KEYS = Object.keys(DEFAULT_OPTIONS);
/** The browser build's keys in the account's settings KV (platform.js KV_KEYS), removed once migrated. */
export const BROWSER_KEYS = ['theme', 'graphics', 'muted', 'volMusic', 'volEffects', 'volAmbience', 'volVoice', 'captions',
  'reducedMotion', 'highContrast', 'palette', 'largeText', 'leftHanded', 'holdToConfirm', 'haptics', 'timingAssist', 'cameraTilt', 'ui.language'];

/** The valid option values among `raw`. */
export function pickOptions(raw) {
  const o = obj(raw) || {};
  const out = {};
  if (THEME_IDS.includes(o.theme)) out.theme = o.theme;
  if (PALETTES.includes(o.palette)) out.palette = o.palette;
  for (const k of ['leftHanded', 'haptics', 'timingAssist', 'captions']) if (typeof o[k] === 'boolean') out[k] = o[k];
  return out;
}
