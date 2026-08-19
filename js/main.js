// Pair Sum — bootstrap module.
// Host handshake, capability detection, module wiring, input routing
// (pointer/touch/keyboard/gamepad), lifecycle and screen flow.

import { Session } from './session.js';
import { Platform } from './platform.js';
import { UI } from './ui.js';
import { AudioEngine } from './audio.js';
import {
  LESSONS, JOURNEY, CHALLENGES, dailyForDate, practiceDef, makeDef, generateBoard, THEMES,
} from './content.js';
import { listLegalPairs, remainingCount } from './rules.js';

const $ = (id) => document.getElementById(id);

let platform, ui, session, audio, renderer = null;
let webglFailed = false;
let currentDef = null;
let pendingSetup = null;   // {kind, ...} for the setup screen
let practiceDiff = 'steady';
let lastNoteSent = 0;
let cursorIndex = null;    // keyboard/gamepad cursor
let gamepadState = {};

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot() {
  platform = await new Platform().init();
  platform.verifyProgress();
  wireAchievements();
  ui = new UI(platform);
  audio = new AudioEngine(platform.settings, (t) => ui.caption(t));
  platform.consent.telemetry = !!platform.settings.telemetryConsent;

  session = new Session(platform, onSessionEvent);
  session.onTransition = onTransition;

  wireUI();
  wireInput();
  initRenderer();
  ui.applySettingsClasses(platform.settings);
  ui.updateProfileChip();

  session.transition('title', 'boot-complete');
  ui.renderTitle(platform.progress, dailyForDate(new Date(platform.serverNow())), session.hasSnapshot());
  ui.showScreen('title');
  platform.track('start', { hosted: platform.hosted });
  platform.activityStart();
  window.addEventListener('beforeunload', () => platform.activityEnd());

  // First-gesture audio unlock.
  const unlock = () => { audio.ensure(); audio.applyVolumes(); };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });

  requestAnimationFrame(frame);

  // Debug/testing handle (also handy in devtools).
  window.__pairsum = { session, ui, platform, audio, get renderer() { return renderer; } };
}

function initRenderer() {
  try {
    // Dynamically import so a WebGL failure never breaks the DOM game.
    import('./render.js').then(({ BoardRenderer }) => {
      try {
        renderer = new BoardRenderer($('canvas-host'), {
          themeId: platform.settings.theme,
          quality: platform.settings.quality,
          emit: onRendererEvent,
        });
        renderer.setReducedMotion(platform.settings.reducedMotion);
        renderer.start();
        wireCanvasInput();
        ui.setMirrorVisible(false);
        if (session.state) syncRender();
      } catch (e) {
        enterFallback(e);
      }
    }).catch(enterFallback);
  } catch (e) {
    enterFallback(e);
  }
}

function enterFallback(e) {
  webglFailed = true;
  renderer = null;
  $('canvas-host').style.display = 'none';
  $('webgl-fallback').hidden = false;
  ui.setMirrorVisible(true);
  console.warn('3D unavailable, DOM mirror active:', e);
  platform.track('error', { category: 'webgl' });
}

function onRendererEvent(e) {
  if (e.type === 'webgl-lost') {
    ui.setMirrorVisible(true);
    ui.toast('Graphics context lost — notebook view active while GPU recovers.');
  } else if (e.type === 'webgl-restored') {
    ui.setMirrorVisible(false);
    ui.toast('3D view restored.');
  }
}

// ---------------------------------------------------------------------------
// Session event sink
// ---------------------------------------------------------------------------

function onSessionEvent(e) {
  switch (e.type) {
    case 'machine':
      break;
    case 'round':
      currentDef = e.def;
      cursorIndex = null;
      syncRender();
      updateAllUI();
      break;
    case 'game-event':
      audio.onGameEvent(e.event);
      renderer?.onGameEvent(e.event);
      if (e.event.type === 'clear') audio.excite();
      if (e.event.type === 'invalid') {
        ui.showAlert(invalidReasonText(e.event.reason));
        ui.announce(invalidReasonText(e.event.reason), true);
      }
      if (e.event.type === 'win' || e.event.type === 'lose') {
        // resolution phase → results
        setTimeout(showResults, e.event.type === 'win' ? 1200 : 600);
      }
      updateAllUI();
      break;
    case 'select':
      audio.onGameEvent({ type: e.index == null ? 'deselect' : 'select' });
      updateSelection();
      break;
    case 'invalid':
      break; // handled via game-event
    case 'hint':
      if (e.none) {
        ui.showAlert(e.canAddRows ? 'No pairs connect — try Add Rows.' : 'No moves left.');
        ui.announce('No legal pairs. Use Add Rows.', true);
      } else {
        audio.onGameEvent({ type: 'hint' });
        ui.announce(`Hint: connect the ${hintText(e)}.`);
        renderer?.setHint(e);
        ui.syncMirror(session.state, session.selection, legalTargets(), e);
        setTimeout(() => ui.syncMirror(session.state, session.selection, legalTargets(), null), 2400);
      }
      break;
    case 'undo':
      audio.onGameEvent({ type: 'undo' });
      syncRender();
      updateAllUI();
      ui.announce('Undone.');
      break;
    case 'lesson-step':
      if (e.done) {
        ui.showLesson(null);
        ui.toast('Lesson complete — finish the page!');
        ui.announce('Lesson steps complete. Clear the rest of the page.');
        if (session.machine === 'tutorial') session.transition('active', 'lesson-steps-done');
      } else {
        ui.showLesson(e.step.text);
      }
      break;
    case 'lesson-blocked':
      ui.showAlert('That is not the lesson move.');
      ui.announce(e.message, true);
      break;
    case 'while-away':
      ui.toast(e.summary);
      ui.announce(e.summary);
      break;
    case 'round-end':
      platform.stopPresence();
      break;
    default:
      break;
  }
}

function hintText(h) {
  const va = session.state.cells[h.a];
  const vb = session.state.cells[h.b];
  const kind = h.via === 'row' ? 'same row' : h.via === 'col' ? 'same column' : 'fold between rows';
  return `${va} and ${vb}, along the ${kind}`;
}

function invalidReasonText(reason) {
  return {
    'no-match': 'Those digits do not match — pairs must be equal or sum to ten.',
    'blocked': 'The path is blocked by other digits.',
    'same-cell': 'Pick two different cells.',
    'empty-cell': 'That cell is already cleared.',
    'round-over': 'The round is over.',
  }[reason] || 'That move is not legal.';
}

function onTransition(from, to, reason) {
  if (to === 'active') {
    ui.setPlayingUI(true);
    ui.showScreen(null);
    platform.startPresence();
  }
  if (to === 'paused') {
    ui.showPause(pauseSummary());
  }
  if (to === 'results') {
    ui.setPlayingUI(false);
  }
}

function pauseSummary() {
  const s = session.state;
  if (!s) return '';
  return `${remainingCount(s)} digits left · score ${s.score.total} · ${s.moves} moves`;
}

// ---------------------------------------------------------------------------
// Screen flow
// ---------------------------------------------------------------------------

function wireUI() {
  Object.assign(ui.actions, {
    tapCell: (i) => { session.tapCell(i); cursorIndex = i; updateAllUI(); },
    canUndo: () => session.undoAllowed(),
    onScreenChange: (name) => { if (name) ui.setPlayingUI(false); },
  });

  $('btn-play').onclick = () => { audio.uiClick(); ui.renderModes(openMode); ui.showScreen('modes'); session.transition('mode-select', 'play'); };
  $('btn-continue').onclick = () => { audio.uiClick(); continueRound(); };
  $('btn-daily').onclick = () => { audio.uiClick(); openMode('daily'); };
  $('btn-journey').onclick = () => { audio.uiClick(); openMode('journey'); };
  $('btn-boards').onclick = () => { audio.uiClick(); ui.renderBoards(); ui.showScreen('boards'); };
  $('btn-achievements').onclick = () => { audio.uiClick(); ui.renderAchievements(platform.progress); ui.showScreen('achievements'); };
  $('btn-help').onclick = () => { audio.uiClick(); ui.renderHelp(platform.settings.bindings); ui.showScreen('help'); };
  $('btn-settings').onclick = () => { audio.uiClick(); openSettings(); };
  $('btn-profile').onclick = () => { audio.uiClick(); ui.renderProfile(); ui.showScreen('profile'); };

  for (const btn of document.querySelectorAll('[data-back]')) {
    btn.onclick = () => { audio.uiClick(); back(); };
  }

  $('btn-setup-start').onclick = () => { audio.uiClick(); startPending(); };
  $('btn-hint').onclick = () => session.hint();
  $('btn-undo').onclick = () => session.undo();
  $('btn-addrows').onclick = () => { session.addRows(); updateAllUI(); };
  $('btn-pause').onclick = () => session.pause('user');
  $('btn-resume').onclick = () => { ui.hidePause(); session.resume(); };
  $('btn-pause-settings').onclick = () => openSettings();
  $('btn-pause-help').onclick = () => { ui.renderHelp(platform.settings.bindings); ui.showScreen('help'); };
  $('btn-restart-round').onclick = () => { ui.hidePause(); restartRound(); };
  $('btn-leave-round').onclick = () => { ui.hidePause(); leaveRound(); };
  $('btn-lesson-skip').onclick = () => {
    session.tutorialStep = session.def?.tutorial?.steps?.length ?? 0;
    ui.showLesson(null);
    if (session.machine === 'tutorial') session.transition('active', 'lesson-skipped');
  };
  $('btn-retry').onclick = () => { audio.uiClick(); restartRound(); };
  $('btn-next').onclick = () => { audio.uiClick(); nextAfterResults(); };
  $('btn-results-home').onclick = () => { audio.uiClick(); goTitle(); };

  window.addEventListener('resize', () => renderer?.resize());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      session.background();
      audio.setBackgrounded(true);
      renderer?.stop();
    } else {
      audio.setBackgrounded(false);
      renderer?.start();
      renderer?.resize();
    }
  });

  window.addEventListener('error', (e) => {
    platform.track('error', { category: 'runtime' });
    console.error(e.error || e.message);
  });
}

function back() {
  if (session.machine === 'paused') {
    ui.showScreen(null);
    ui.showPause(pauseSummary());
    return;
  }
  if (ui.currentScreen === 'journey' || ui.currentScreen === 'setup') {
    ui.renderModes(openMode);
    ui.showScreen('modes');
  } else {
    goTitle();
  }
}

function goTitle() {
  session.transition('title', 'home');
  ui.setPlayingUI(false);
  ui.renderTitle(platform.progress, dailyForDate(new Date(platform.serverNow())), session.hasSnapshot());
  ui.showScreen('title');
}

function openMode(mode) {
  platform.track('start', { mode });
  switch (mode) {
    case 'learn': {
      pendingSetup = { kind: 'learn' };
      const body = $('setup-body');
      ui.renderSetup({ title: 'Learn', def: null, note: 'Pick a lesson. Each teaches one rule and asks you to perform it.' });
      const list = document.createElement('div');
      list.className = 'card-grid';
      LESSONS.forEach((l, i) => {
        const b = document.createElement('button');
        b.className = 'mode-card';
        b.type = 'button';
        b.innerHTML = `<h3>${i + 1}. ${l.title}</h3><p>${l.tutorial.steps[0].text.slice(0, 72)}…</p>`;
        b.onclick = () => { pendingSetup = { kind: 'learn', lesson: i }; startPending(); };
        list.append(b);
      });
      body.append(list);
      $('btn-setup-start').style.display = 'none';
      ui.showScreen('setup');
      break;
    }
    case 'journey':
      ui.renderJourney(platform.progress, (def) => {
        pendingSetup = { kind: 'fixed', def };
        ui.renderSetup({ title: def.title, def, note: def.goals?.note });
        $('btn-setup-start').style.display = '';
        ui.showScreen('setup');
      });
      ui.showScreen('journey');
      break;
    case 'daily': {
      const def = dailyForDate(new Date(platform.serverNow()));
      applyTimingAssist(def);
      pendingSetup = { kind: 'fixed', def };
      ui.renderSetup({
        title: def.title, def,
        note: 'Same seed for every player today. Daily seeds are immutable; a defective day is excluded from ranking, never silently replaced.',
      });
      $('btn-setup-start').style.display = '';
      ui.showScreen('setup');
      break;
    }
    case 'practice': {
      const def = practiceDef(practiceDiff);
      applyTimingAssist(def);
      pendingSetup = { kind: 'practice' };
      ui.renderSetup({
        title: 'Practice', def, difficulties: [...PRACTICE_DIFFICULTIES],
        selectedDiff: practiceDiff,
        onDiff: (id) => { practiceDiff = id; openMode('practice'); },
        note: 'Unranked. Restart and undo freely.',
      });
      $('btn-setup-start').style.display = '';
      ui.showScreen('setup');
      break;
    }
    case 'challenge': {
      pendingSetup = { kind: 'challenge' };
      ui.renderSetup({ title: 'Challenge', def: null, note: 'Constrained goals. Ranked where noted.' });
      const body = $('setup-body');
      const list = document.createElement('div');
      list.className = 'card-grid';
      for (const c of CHALLENGES) {
        const b = document.createElement('button');
        b.className = 'mode-card';
        b.type = 'button';
        b.innerHTML = `<h3>${c.name}</h3><p>${c.note}</p><div class="meta">ranked</div>`;
        b.onclick = () => {
          const def = c.build();
          applyTimingAssist(def);
          pendingSetup = { kind: 'fixed', def };
          startPending();
        };
        list.append(b);
      }
      body.append(list);
      $('btn-setup-start').style.display = 'none';
      ui.showScreen('setup');
      break;
    }
    case 'score': {
      // Weekly shared seed for the score-chase board.
      const now = new Date(platform.serverNow());
      const week = isoWeek(now);
      const seed = `score-${now.getUTCFullYear()}-w${week}`;
      const gen = generateBoard(seed, { rows: 5, cols: 9, minDigit: 1, maxDigit: 9 });
      const filled = gen.cells.filter((c) => c !== 0).length;
      const def = makeDef({
        id: seed, seed, title: `Score chase — week ${week}`, mode: 'score',
        theme: 'slate', cells: gen.cells, solution: gen.solution, mult: 1.5,
        mechanics: ['equal-pairs', 'sum-pairs', 'seq-paths', 'add-rows'],
        par: { moves: Math.floor(filled / 2), timeMs: Math.floor(filled / 2) * 4000 },
        assists: { hints: false, undo: false }, ranked: true,
        goals: { type: 'clear', note: 'One shared weekly seed. No assists.' },
      });
      pendingSetup = { kind: 'fixed', def };
      ui.renderSetup({
        title: def.title, def,
        note: 'Global and friends boards use validated seeds and rulesets. Submissions carry the full replay.',
      });
      $('btn-setup-start').style.display = '';
      ui.showScreen('setup');
      break;
    }
    default:
      break;
  }
}

function isoWeek(d) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((date - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}

function applyTimingAssist(def) {
  if (platform.settings.timingAssist && def.limits?.timeMs) {
    def.limits = { ...def.limits, timeMs: Math.floor(def.limits.timeMs * 1.5) };
    def.assists = { ...def.assists, timingAssist: true };
    def.ranked = false; // assist makes the result unranked
  }
}

async function startPending() {
  if (!pendingSetup) return;
  let def = null;
  if (pendingSetup.kind === 'fixed') def = pendingSetup.def;
  else if (pendingSetup.kind === 'practice') def = practiceDef(practiceDiff);
  else if (pendingSetup.kind === 'learn') def = LESSONS[pendingSetup.lesson ?? 0];
  if (!def) return;
  if (pendingSetup.kind === 'practice') applyTimingAssist(def);
  currentDef = def;
  startRound(def);
}

async function runCountdown(skipCount) {
  if (!skipCount) await ui.countdown();
  if (session.machine === 'countdown' || session.machine === 'tutorial') session.beginActive();
  updateAllUI();
}

function startRound(def) {
  session.startRound(def);
  ui.setPlayingUI(true);
  ui.showScreen(null);
  $('lesson-banner').hidden = def.mode !== 'learn';
  if (def.mode === 'learn') {
    const step = session.currentLessonStep();
    ui.showLesson(step?.text || null);
    runCountdown(true);
  } else {
    runCountdown(false);
  }
}

function restartRound() {
  if (!currentDef) return goTitle();
  platform.track('retry', { contentId: currentDef.id });
  startRound(currentDef);
}

function leaveRound() {
  session.saveSnapshot();
  platform.stopPresence();
  goTitle();
}

function continueRound() {
  if (session.restoreSnapshot()) {
    ui.setPlayingUI(true);
    ui.showScreen(null);
    ui.showPause(pauseSummary());
  } else {
    ui.toast('No saved round found.');
    ui.renderTitle(platform.progress, dailyForDate(new Date(platform.serverNow())), false);
  }
}

function showResults() {
  const s = session.state;
  if (!s) return;
  session.transition('results', s.terminalReason);
  const result = session.replayEnvelope().result;
  const newly = platform.progress._lastNewAchievements || [];
  platform.progress._lastNewAchievements = null;
  const isBest = checkPersonalBest(result);
  const nextLabel =
    currentDef?.mode === 'journey' ? 'Next page' :
    currentDef?.mode === 'learn' ? 'Next lesson' :
    currentDef?.mode === 'daily' || currentDef?.mode === 'score' ? 'Scores' : 'New page';
  ui.renderResults(result, currentDef, { isBest, achievements: newly, nextLabel });
  ui.showScreen('results');
  ui.setPlayingUI(false);
}

function checkPersonalBest(result) {
  const prev = platform.results
    .filter((r) => r.contentId === result.contentId && r.sessionId !== result.sessionId)
    .reduce((m, r) => Math.max(m, r.score?.total || 0), 0);
  return result.status === 'won' && result.score.total > prev && prev > 0;
}

function nextAfterResults() {
  if (currentDef?.mode === 'journey') {
    const idx = JOURNEY.findIndex((d) => d.id === currentDef.id);
    const next = JOURNEY[idx + 1];
    if (next && platform.progress.journey[currentDef.id]?.done) {
      currentDef = next;
      startRound(next);
      return;
    }
    openMode('journey');
    return;
  }
  if (currentDef?.mode === 'learn') {
    const idx = LESSONS.findIndex((d) => d.id === currentDef.id);
    const next = LESSONS[idx + 1];
    if (next) {
      currentDef = next;
      startRound(next);
      return;
    }
    goTitle();
    return;
  }
  if (currentDef?.mode === 'daily' || currentDef?.mode === 'score') {
    ui.renderBoards(currentDef.mode === 'daily' ? 'daily' : 'challenge');
    ui.showScreen('boards');
    return;
  }
  restartRound();
}

// Achievement unlocks surface as toasts.
function wireAchievements() {
  platform.onAchievements = (keys) => {
    platform.progress._lastNewAchievements = keys;
    for (const k of keys) ui.toast(`🎖️ Achievement unlocked: ${k.replace(/_/g, ' ')}`);
  };
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function openSettings() {
  ui.renderSettings(platform.settings, onSettingChange);
  ui.showScreen('settings');
}

function onSettingChange(key, value) {
  const s = platform.settings;
  if (key === 'replayTutorial') {
    platform.track('settings-change', { key });
    openMode('learn');
    return;
  }
  s[key] = value;
  platform.saveSettings();
  platform.consent.telemetry = !!s.telemetryConsent;
  platform.track('settings-change', { key });
  ui.applySettingsClasses(s);
  audio.applyVolumes();
  if (key === 'theme' && renderer) renderer.setTheme(value);
  if (key === 'quality' && renderer) renderer.setQuality(value);
  if (key === 'reducedMotion' && renderer) renderer.setReducedMotion(value);
  if (key === 'telemetryConsent') ui.toast(value ? 'Anonymous stats on. Thank you!' : 'Anonymous stats off.');
}

// ---------------------------------------------------------------------------
// Rendering + UI sync
// ---------------------------------------------------------------------------

function legalTargets() {
  if (!session.state || session.selection == null) return [];
  const sel = session.selection;
  return listLegalPairs(session.state)
    .filter((p) => p.a === sel || p.b === sel)
    .map((p) => (p.a === sel ? p.b : p.a));
}

function syncRender() {
  if (!session.state) return;
  if (renderer) {
    renderer.legalTargets = legalTargets();
    renderer.syncState(session.state, session.selection);
  }
  ui.syncMirror(session.state, session.selection, legalTargets(), null);
}

function updateSelection() {
  if (renderer) {
    renderer.legalTargets = legalTargets();
    renderer.setSelection(session.selection);
  }
  ui.syncMirror(session.state, session.selection, legalTargets(), null);
}

function updateAllUI() {
  if (!session.state || !currentDef) return;
  ui.updateHUD(session.state, currentDef);
  ui.setTopStatus(`${currentDef.title}`);
  syncRender();
}

// ---------------------------------------------------------------------------
// Input: pointer / touch on the 3D canvas
// ---------------------------------------------------------------------------

function wireCanvasInput() {
  const el = renderer.renderer.domElement;
  let downAt = 0, downX = 0, downY = 0, captured = false;

  el.addEventListener('pointerdown', (e) => {
    downAt = performance.now();
    downX = e.clientX;
    downY = e.clientY;
    captured = true;
    el.setPointerCapture(e.pointerId); // pointer capture for drags
  });

  el.addEventListener('pointerup', (e) => {
    if (!captured) return;
    captured = false;
    const dist = Math.hypot(e.clientX - downX, e.clientY - downY);
    const dt = performance.now() - downAt;
    // tap vs drag/camera gesture by distance+time thresholds
    if (dist < 12 && dt < 600) {
      const cell = renderer.pickCell(e.clientX, e.clientY);
      if (cell != null) {
        session.tapCell(cell);
        cursorIndex = cell;
        updateAllUI();
      } else if (session.selection != null) {
        session.tapCell(session.selection); // tap empty space: deselect
        updateSelection();
      }
    }
    renderer.previewPath(null);
  });

  el.addEventListener('pointercancel', () => {
    captured = false; // cancel safely on lost capture
    renderer.previewPath(null);
  });

  el.addEventListener('lostpointercapture', () => { captured = false; });

  // Hover previews legal targets before commit; never required.
  el.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' || session.selection == null || !session.state) return;
    const cell = renderer.pickCell(e.clientX, e.clientY);
    if (cell != null && cell !== session.selection) {
      renderer.previewPath(session.legalTargetPreview(cell));
    } else {
      renderer.previewPath(null);
    }
  });
}

// ---------------------------------------------------------------------------
// Input: keyboard
// ---------------------------------------------------------------------------

function wireInput() {
  document.addEventListener('keydown', (e) => {
    const inRound = session.state && session.state.status === 'active' &&
      (session.machine === 'active' || session.machine === 'tutorial');
    const onPlayScreen = ui.currentScreen === null;

    if (e.key === 'Escape') {
      if (ui.currentScreen === 'settings' || ui.currentScreen === 'help') { back(); return; }
      if (session.machine === 'paused') { ui.hidePause(); session.resume(); return; }
      if (inRound) {
        if (session.selection != null) {
          session.tapCell(session.selection); // cancel selection first
          updateSelection();
        } else {
          session.pause('user');
        }
        e.preventDefault();
        return;
      }
    }
    if (!inRound || !onPlayScreen) return;

    const cols = session.state.cols;
    const cells = session.state.cells;
    const filled = [];
    for (let i = 0; i < cells.length; i++) if (cells[i] !== 0) filled.push(i);

    const moveCursor = (di) => {
      if (!filled.length) return;
      if (cursorIndex == null || cells[cursorIndex] === 0) cursorIndex = filled[0];
      else {
        const pos = filled.indexOf(cursorIndex);
        cursorIndex = filled[(pos + di + filled.length) % filled.length];
      }
      ui.focusCell(cursorIndex);
      previewForCursor();
      e.preventDefault();
    };
    const moveGrid = (dr, dc) => {
      if (!filled.length) return;
      if (cursorIndex == null || cells[cursorIndex] === 0) { cursorIndex = filled[0]; }
      else {
        const r0 = Math.floor(cursorIndex / cols), c0 = cursorIndex % cols;
        let best = null, bestScore = Infinity;
        for (const i of filled) {
          if (i === cursorIndex) continue;
          const r = Math.floor(i / cols), c = i % cols;
          const dRow = r - r0, dCol = c - c0;
          if (dr < 0 && dRow >= 0) continue;
          if (dr > 0 && dRow <= 0) continue;
          if (dc < 0 && dCol >= 0) continue;
          if (dc > 0 && dCol <= 0) continue;
          const score = Math.abs(dRow) * 10 + Math.abs(dCol);
          if (score < bestScore) { bestScore = score; best = i; }
        }
        if (best != null) cursorIndex = best;
      }
      ui.focusCell(cursorIndex);
      previewForCursor();
      e.preventDefault();
    };

    switch (e.key) {
      case 'ArrowLeft': moveGrid(0, -1); break;
      case 'ArrowRight': moveGrid(0, 1); break;
      case 'ArrowUp': moveGrid(-1, 0); break;
      case 'ArrowDown': moveGrid(1, 0); break;
      case 'Tab': moveCursor(e.shiftKey ? -1 : 1); break;
      case 'Enter':
      case ' ':
        if (cursorIndex != null) {
          session.tapCell(cursorIndex);
          updateAllUI();
          e.preventDefault();
        }
        break;
      case 'h': case 'H': session.hint(); break;
      case 'u': case 'U': session.undo(); break;
      case 'a': case 'A': session.addRows(); updateAllUI(); break;
      case 'r': case 'R': renderer?.resize(); ui.toast('Camera reset.'); break;
      default: break;
    }
  });
}

function previewForCursor() {
  if (cursorIndex == null || session.selection == null) return;
  const check = session.legalTargetPreview(cursorIndex);
  renderer?.previewPath(check);
  if (check && !check.ok && check.reason) {
    ui.announce(`Not legal: ${invalidReasonText(check.reason)}`);
  } else if (check?.ok) {
    ui.announce('Legal target. Press Enter to connect.');
  }
}

// ---------------------------------------------------------------------------
// Input: gamepad (focus navigation + primary/secondary/pause)
// ---------------------------------------------------------------------------

function pollGamepad() {
  const pads = navigator.getGamepads?.() || [];
  const gp = [...pads].find((p) => p && p.connected);
  if (!gp) return;
  const pressed = (i) => gp.buttons[i]?.pressed;
  const edge = (name, now) => {
    const was = gamepadState[name];
    gamepadState[name] = now;
    return now && !was;
  };
  const axisX = gp.axes[0] || 0;
  const axisY = gp.axes[1] || 0;
  const now = performance.now();
  const repeatOk = !gamepadState.axisAt || now - gamepadState.axisAt > 220;
  const key = (k) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

  if (edge('a', pressed(0))) key('Enter');
  if (edge('b', pressed(1))) key('Escape');
  if (edge('y', pressed(3))) key('h');
  if (edge('x', pressed(2))) key('u');
  if (edge('start', pressed(9))) key('Escape');
  if (repeatOk) {
    if (pressed(14) || axisX < -0.5) { key('ArrowLeft'); gamepadState.axisAt = now; }
    else if (pressed(15) || axisX > 0.5) { key('ArrowRight'); gamepadState.axisAt = now; }
    else if (pressed(12) || axisY < -0.5) { key('ArrowUp'); gamepadState.axisAt = now; }
    else if (pressed(13) || axisY > 0.5) { key('ArrowDown'); gamepadState.axisAt = now; }
  }
}

// ---------------------------------------------------------------------------
// Frame loop: HUD clock, time-limit enforcement, gamepad
// ---------------------------------------------------------------------------

function frame() {
  requestAnimationFrame(frame);
  pollGamepad();
  const s = session.state;
  if (!s || session.machine !== 'active' && session.machine !== 'tutorial') return;
  if (s.limits.timeMs != null && s.status === 'active') {
    // Display clock updates without touching rules state.
    const displayState = { ...s, elapsedMs: Math.floor(session.nowMs()) };
    ui.updateClock(displayState);
    // Authoritative enforcement goes through a command at most once a second.
    if (session.nowMs() - lastNoteSent > 1000) {
      lastNoteSent = session.nowMs();
      if (session.nowMs() > s.limits.timeMs) {
        session.dispatch({ type: 'note' });
      }
    }
  }
}

boot();
