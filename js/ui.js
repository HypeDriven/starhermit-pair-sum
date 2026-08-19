// Pair Sum — DOM UI shell.
// Semantic HTML over/beside the canvas: screens, HUD, pause, settings, help,
// results, leaderboards, and the accessible board mirror. UI state is fully
// separate from simulation state.

import { ACHIEVEMENTS, THEMES, JOURNEY, PRACTICE_DIFFICULTIES, CHALLENGES, getTheme } from './content.js';
import { remainingCount } from './rules.js';

const $ = (id) => document.getElementById(id);

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    el.append(c.nodeType ? c : document.createTextNode(c));
  }
  return el;
}

export function fmtMs(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const DEFAULT_BINDINGS = {
  'Arrow keys': 'Move among cells',
  'Enter / Space': 'Select / connect',
  'Esc': 'Cancel selection · Pause',
  'H': 'Hint',
  'U': 'Undo',
  'A': 'Add rows',
  'R': 'Reset camera',
  'Gamepad': 'D-pad moves focus · A connects · B cancels · Start pauses · Y hints',
};

export class UI {
  constructor(platform) {
    this.platform = platform;
    this.actions = {}; // set by main.js
    this.currentScreen = 'title';
    this.lastFocus = null;
    this.mirrorButtons = [];
    this.mirrorState = null;
    this.captionTimer = null;
  }

  // --- primitives -------------------------------------------------------------

  announce(msg, assertive = false) {
    const el = $(assertive ? 'live-alert' : 'live-polite');
    el.textContent = '';
    requestAnimationFrame(() => { el.textContent = msg; });
  }

  caption(text) {
    const el = $('caption-line');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.captionTimer);
    this.captionTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  toast(msg) {
    const t = h('div', { class: 'toast', text: msg });
    $('toast-stack').append(t);
    setTimeout(() => t.remove(), 3600);
  }

  applySettingsClasses(s) {
    document.body.classList.toggle('high-contrast', !!s.highContrast);
    document.body.classList.toggle('large-text', !!s.largeText);
    document.body.classList.toggle('reduced-motion', !!s.reducedMotion);
    document.body.classList.toggle('left-handed', !!s.leftHanded);
    document.body.dataset.theme = s.theme;
    document.body.dataset.palette = s.palette || 'default';
  }

  // --- screens ------------------------------------------------------------------

  showScreen(name) {
    const prev = document.querySelector('.screen:not([hidden])');
    for (const el of document.querySelectorAll('.screen')) el.hidden = true;
    $('screens').style.pointerEvents = name ? 'auto' : 'none';
    if (name) {
      if (!prev && document.activeElement) this.lastFocus = document.activeElement;
      const el = $(`screen-${name}`);
      el.hidden = false;
      this.currentScreen = name;
      const focusable = el.querySelector('button, [href], input, select, [tabindex]');
      focusable?.focus({ preventScroll: true });
    } else {
      this.currentScreen = null;
      this.lastFocus?.focus?.({ preventScroll: true });
    }
    this.actions.onScreenChange?.(name);
  }

  setPlayingUI(on) {
    $('hud').hidden = !on;
    $('action-tray').hidden = !on;
    $('rail-left').style.visibility = on ? 'visible' : '';
    $('rail-right').style.visibility = on ? 'visible' : '';
  }

  setTopStatus(text) { $('topbar-status').textContent = text || ''; }

  updateProfileChip() {
    $('btn-profile').textContent = this.platform.profile.guest
      ? '👤 Guest' : `👤 ${this.platform.profile.name}`;
  }

  // --- HUD -------------------------------------------------------------------

  updateHUD(state, def) {
    $('stat-score').textContent = String(state.score.total);
    $('stat-chain').textContent = state.chain > 1 ? `${state.chain}×` : '—';
    $('stat-remaining').textContent = String(remainingCount(state));
    $('stat-moves-wrap').style.display = state.limits.moves != null ? '' : 'none';
    $('stat-time-wrap').style.display = state.limits.timeMs != null ? '' : 'none';
    if (state.limits.moves != null) $('stat-moves').textContent = String(Math.max(0, state.limits.moves - state.moves));
    $('hud-objective').textContent = this.objectiveText(state, def);
    $('btn-hint').disabled = !def.assists?.hints || state.status !== 'active';
    $('btn-undo').disabled = !this.actions.canUndo?.();
    $('btn-addrows').disabled = state.status !== 'active';
  }

  updateClock(state) {
    if (state?.limits.timeMs != null) {
      const left = Math.max(0, state.limits.timeMs - state.elapsedMs);
      $('stat-time').textContent = fmtMs(left);
    }
  }

  objectiveText(state, def) {
    const left = remainingCount(state);
    const parts = [`${left} digits left`];
    if (state.limits.moves != null) parts.push(`${Math.max(0, state.limits.moves - state.moves)} moves`);
    if (state.limits.timeMs != null) parts.push(fmtMs(Math.max(0, state.limits.timeMs - state.elapsedMs)));
    return parts.join(' · ');
  }

  showAlert(text) {
    const el = $('hud-alert');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(this._alertTimer);
    this._alertTimer = setTimeout(() => { el.hidden = true; }, 2200);
  }

  // --- accessible mirror board ----------------------------------------------------

  // Concise navigable model of the board state; decorative 3D objects are
  // never announced. Fully playable with pointer or keyboard.
  syncMirror(state, selection, legalTargets, hintPair) {
    this.mirrorState = state;
    const host = $('board-mirror');
    const cols = state.cols;
    const rows = state.cells.length / cols;
    const key = state.cells.join(',') + `|${cols}`;
    if (this._mirrorKey !== key) {
      this._mirrorKey = key;
      host.style.gridTemplateColumns = `repeat(${cols}, minmax(28px, 1fr))`;
      host.innerHTML = '';
      this.mirrorButtons = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          const v = state.cells[i];
          const btn = h('button', {
            class: 'cell-btn', type: 'button', role: 'gridcell',
            'data-empty': v === 0 ? '1' : '0',
            'aria-label': v === 0
              ? `Row ${r + 1}, column ${c + 1}, empty`
              : `Row ${r + 1}, column ${c + 1}, digit ${v}`,
            'aria-disabled': v === 0 ? 'true' : 'false',
            tabindex: v === 0 ? '-1' : '0',
          }, v === 0 ? '' : String(v));
          btn.addEventListener('click', () => this.actions.tapCell?.(i));
          host.append(btn);
          this.mirrorButtons[i] = btn;
        }
      }
    }
    // Selection / legality classes
    const legal = new Set(legalTargets || []);
    for (let i = 0; i < this.mirrorButtons.length; i++) {
      const btn = this.mirrorButtons[i];
      if (!btn) continue;
      btn.classList.toggle('selected', i === selection);
      btn.classList.toggle('legal-target', legal.has(i));
      btn.classList.toggle('hint', !!hintPair && (hintPair.a === i || hintPair.b === i));
      if (i === selection) {
        btn.setAttribute('aria-label', btn.getAttribute('aria-label').replace(/, selected$|, legal target$/, '') + ', selected');
      }
    }
  }

  setMirrorVisible(visible) {
    $('board-mirror').classList.toggle('mirror-hidden', !visible);
    document.body.classList.toggle('show-mirror', visible);
  }

  focusCell(i) {
    const btn = this.mirrorButtons?.[i];
    if (btn && btn.getAttribute('data-empty') !== '1') btn.focus();
  }

  // --- title / modes ---------------------------------------------------------------

  renderTitle(progress, dailyDef, hasSave) {
    $('btn-continue').hidden = !hasSave;
    const done = Object.values(progress.journey).filter((j) => j.done).length;
    $('journey-status').textContent = `(${done}/${JOURNEY.length})`;
    const todayKey = `daily-${new Date(this.platform.serverNow()).toISOString().slice(0, 10)}`;
    $('daily-status').textContent = progress.bestDaily[todayKey] ? '(done ✓)' : '';
  }

  renderModes(onPick) {
    const modes = [
      { id: 'learn', icon: '🎓', name: 'Learn', desc: 'Six short interactive lessons. One rule at a time — you perform each move.', meta: '5–10 min · unranked' },
      { id: 'journey', icon: '🗺️', name: 'Journey', desc: 'Forty authored pages across five notebooks, with mastery stages.', meta: 'Long form · progress saved' },
      { id: 'daily', icon: '📅', name: 'Daily', desc: 'One shared seed for everyone, per UTC day. No hints, no undo.', meta: '3 min · ranked' },
      { id: 'practice', icon: '🧘', name: 'Practice', desc: 'Pick a difficulty. Hints, undo and restart freely; never ranked.', meta: 'Unranked' },
      { id: 'challenge', icon: '⏱️', name: 'Challenge', desc: 'Move limits, speed targets, altered layouts, restricted tools.', meta: 'Ranked' },
      { id: 'score', icon: '🏆', name: 'Score chase', desc: 'Chase the global and friends boards on validated seeds.', meta: 'Ranked' },
    ];
    const host = $('mode-list');
    host.innerHTML = '';
    for (const m of modes) {
      host.append(h('button', {
        class: 'mode-card', type: 'button',
        onclick: () => onPick(m.id),
      },
        h('h3', { text: `${m.icon} ${m.name}` }),
        h('p', { text: m.desc }),
        h('div', { class: 'meta', text: m.meta }),
      ));
    }
  }

  renderJourney(progress, onPick) {
    const host = $('journey-map');
    host.innerHTML = '';
    const doneCount = Object.values(progress.journey).filter((j) => j.done).length;
    for (let t = 0; t < 5; t++) {
      const row = h('div', { class: 'journey-theme-row' });
      row.append(h('h3', { text: THEMES[t].name }));
      const grid = h('div', { class: 'stage-row' });
      for (let s = 0; s < 8; s++) {
        const idx = t * 8 + s;
        const def = JOURNEY[idx];
        const rec = progress.journey[def.id];
        const unlocked = idx === 0 || progress.journey[JOURNEY[idx - 1].id]?.done;
        const mastery = def.goals?.mastery;
        const btn = h('button', {
          class: `stage-node${rec?.done ? ' done' : ''}${mastery ? ' mastery' : ''}${unlocked ? '' : ' locked'}`,
          type: 'button',
          'aria-label': `${def.title}${mastery ? ' (mastery)' : ''}${rec?.done ? `, completed, best ${rec.best}` : unlocked ? '' : ', locked'}`,
          disabled: unlocked ? null : '',
          onclick: unlocked ? () => onPick(def) : null,
        }, mastery ? '★' : String(idx + 1));
        if (rec?.stars) btn.append(h('span', { class: 'stars', text: '★'.repeat(rec.stars) }));
        grid.append(btn);
      }
      row.append(grid);
      host.append(row);
    }
    $('journey-progress-mini').textContent = `Journey: ${doneCount}/${JOURNEY.length} pages cleared.`;
  }

  // --- setup screen ---------------------------------------------------------------

  // Shows rules, expected duration, player count, assists, ranked status
  // before commitment.
  renderSetup({ title, def, difficulties, selectedDiff, onDiff, note }) {
    const body = $('setup-body');
    body.innerHTML = '';
    $('setup-h').textContent = title;
    const kv = (k, v) => h('div', { class: 'kv' }, h('span', { text: k }), h('strong', { text: v }));
    if (difficulties) {
      body.append(h('div', { class: 'diff-row', role: 'group', 'aria-label': 'Difficulty' },
        difficulties.map((d) => h('button', {
          class: 'diff-btn', type: 'button',
          'aria-pressed': d.id === selectedDiff ? 'true' : 'false',
          onclick: () => onDiff(d.id),
        }, d.name))));
    }
    if (def) {
      const pairs = Math.floor(def.cells.filter((c) => c !== 0).length / 2);
      body.append(
        kv('Board', `${def.cells.length / def.cols} rows × ${def.cols} · ${pairs} pairs`),
        kv('Rules', 'Connect equal numbers or pairs summing to ten along a clear row, column, or fold.'),
        kv('Expected', def.limits?.timeMs ? `${fmtMs(def.limits.timeMs)} limit` : `${Math.max(2, Math.round(pairs * 4 / 60))}–${Math.max(3, Math.round(pairs * 9 / 60))} min`),
        kv('Players', '1 (asynchronous score comparison)'),
        kv('Assists', `Hints ${def.assists?.hints ? 'on' : 'off'} · Undo ${def.assists?.undo ? 'on' : 'off'}`),
        kv('Limits', [
          def.limits?.moves ? `${def.limits.moves} moves` : null,
          def.limits?.timeMs ? fmtMs(def.limits.timeMs) : null,
        ].filter(Boolean).join(' · ') || 'None'),
        kv('Result', def.ranked ? 'Ranked — submitted with seed and ruleset' : 'Unranked — no effect on rating'),
        kv('Seed', def.seed),
      );
    }
    if (note) body.append(h('p', { class: 'result-note', text: note }));
  }

  // --- results ------------------------------------------------------------------------

  renderResults(result, def, { isBest, achievements, nextLabel }) {
    const body = $('results-body');
    body.innerHTML = '';
    const won = result.status === 'won';
    const headline = won ? 'Page cleared!' :
      result.reason === 'time-limit' ? 'Out of time' :
      result.reason === 'move-limit' ? 'Out of moves' : 'Round ended';
    body.append(h('div', { class: 'result-headline', text: headline }));
    const rows = [
      ['Pairs cleared', `${result.moves} × 10`, result.score.pairs],
      ['Chain bonus', `best chain ${result.bestChain}×`, result.score.chain],
      ['Row clears', '', result.score.rows],
      ['Board clear', '', result.score.clear],
      ['Time bonus', '', result.score.time],
    ];
    const table = h('table', { class: 'score-table' });
    for (const [label, note, val] of rows) {
      table.append(h('tr', {},
        h('td', { text: label }),
        h('td', { class: 'result-note', text: note }),
        h('td', { text: String(val) })));
    }
    table.append(h('tr', { class: 'total' },
      h('td', { text: 'Total' }), h('td', {}), h('td', { text: String(result.score.total) })));
    body.append(table);
    body.append(h('p', {
      class: 'result-note',
      text: `${fmtMs(result.elapsedMs)} elapsed · ${result.invalid} invalid action${result.invalid === 1 ? '' : 's'} · ` +
        `${result.addRowsUsed} redeal${result.addRowsUsed === 1 ? '' : 's'} · seed ${result.seed}`,
    }));
    if (isBest) body.append(h('p', { class: 'result-note', text: '★ New personal best for this page.' }));
    if (achievements?.length) {
      body.append(h('p', { class: 'result-note', text: `🎖️ Unlocked: ${achievements.map((k) => ACHIEVEMENTS.find((a) => a.key === k)?.name || k).join(', ')}` }));
    }
    $('btn-next').textContent = nextLabel || 'Next';
    this.announce(`${headline} Total score ${result.score.total}.`, true);
  }

  // --- help ----------------------------------------------------------------------------

  renderHelp(bindings) {
    const body = $('help-body');
    body.innerHTML = '';
    const cell = (txt, cls = '') => h('div', { class: `demo-cell ${cls}`, text: txt });
    const cards = [
      {
        t: 'Connect matching pairs',
        p: 'Select two digits that are equal — or that add to ten. Both cells clear.',
        demo: [cell('4', 'match'), cell('4', 'match'), cell('3', 'match'), cell('7', 'match')],
      },
      {
        t: 'Paths must be clear',
        p: 'A pair connects along its row, its column, or the reading-order fold between rows. Every cell on the path must be empty; filled cells block.',
        demo: [cell('5', 'match'), cell('·'), cell('5', 'match'), cell('8', 'block')],
      },
      {
        t: 'Cleared cells never block',
        p: 'Empty cells are open lanes. Clearing pairs in the middle opens longer connections across the page.',
        demo: [cell('2', 'match'), cell('·'), cell('·'), cell('8', 'match')],
      },
      {
        t: 'Add rows when stuck',
        p: 'If nothing connects, Add Rows rewrites every remaining digit as fresh rows below. It costs your chain but keeps the page alive.',
        demo: [cell('➕')],
      },
      {
        t: 'Scoring',
        p: 'Pairs score 10. Consecutive clears without a mistake build a chain bonus. Clearing whole rows and the whole board pay extra; beat par time for a bonus.',
        demo: [],
      },
    ];
    for (const c of cards) {
      body.append(h('div', { class: 'rule-card' },
        h('h3', { text: c.t }), h('p', { text: c.p }),
        c.demo.length ? h('div', { class: 'rule-demo' }, c.demo) : null));
    }
    const map = { ...DEFAULT_BINDINGS, ...(bindings || {}) };
    const controls = h('div', { class: 'rule-card' }, h('h3', { text: 'Controls' }));
    for (const [k, v] of Object.entries(map)) {
      controls.append(h('p', {}, h('kbd', { text: k }), ` ${v}`));
    }
    body.append(controls);
  }

  // --- settings -------------------------------------------------------------------------

  renderSettings(s, onChange) {
    const body = $('settings-body');
    body.innerHTML = '';
    const row = (label, control) => h('div', { class: 'set-row' }, h('label', { text: label }), control);
    const group = (t) => h('div', { class: 'set-group', text: t });
    const check = (key) => h('input', {
      type: 'checkbox', ...(s[key] ? { checked: '' } : {}),
      onchange: (e) => onChange(key, e.target.checked),
      'aria-label': key,
    });
    const slider = (key) => h('input', {
      type: 'range', min: '0', max: '1', step: '0.05', value: String(s[key]),
      oninput: (e) => onChange(key, Number(e.target.value)),
      'aria-label': key,
    });
    const select = (key, options) => {
      const sel = h('select', { onchange: (e) => onChange(key, e.target.value), 'aria-label': key });
      for (const [v, label] of options) {
        sel.append(h('option', { value: v, ...(s[key] === v ? { selected: '' } : {}) }, label));
      }
      return sel;
    };

    body.append(
      group('Audio'),
      row('Mute all', check('muted')),
      row('Music', slider('volMusic')),
      row('Effects', slider('volEffects')),
      row('Ambience', slider('volAmbience')),
      row('Voice cues', slider('volVoice')),
      row('Captions for sounds', check('captions')),
      group('Graphics'),
      row('Theme', select('theme', THEMES.map((t) => [t.id, t.name]))),
      row('Quality tier', select('quality', [['low', 'Low (30 fps target)'], ['medium', 'Medium'], ['high', 'High (60 fps target)']])),
      row('Reduced motion', check('reducedMotion')),
      row('High contrast', check('highContrast')),
      row('Color palette', select('palette', [['default', 'Default'], ['deuteranopia', 'Deuteranopia-safe'], ['protanopia', 'Protanopia-safe'], ['tritanopia', 'Tritanopia-safe']])),
      row('Larger text', check('largeText')),
      group('Controls'),
      row('Left-handed tray', check('leftHanded')),
      row('Hold to confirm', check('holdToConfirm')),
      row('Haptics', check('haptics')),
      row('Timing assistance (+50% clocks)', check('timingAssist')),
      group('Privacy'),
      row('Share anonymous usage stats', check('telemetryConsent')),
      h('div', { class: 'set-row' },
        h('label', { text: 'Tutorial' }),
        h('button', { class: 'chip', type: 'button', onclick: () => onChange('replayTutorial', true) }, 'Replay lessons')),
    );
  }

  // --- achievements / boards / profile ------------------------------------------------------

  renderAchievements(progress) {
    const host = $('ach-body');
    host.innerHTML = '';
    for (const a of ACHIEVEMENTS) {
      const got = progress.achievements[a.key];
      host.append(h('div', { class: `ach-card ${got ? 'unlocked' : 'locked'}` },
        h('h3', { text: `${got ? '🎖️' : '🔒'} ${a.name}` }),
        h('p', { text: a.desc }),
        h('div', { class: 'meta', text: got ? `Unlocked ${new Date(got.at).toLocaleDateString()}` : 'Locked' })));
    }
  }

  async renderBoards(boardKey = 'daily') {
    const body = $('boards-body');
    body.innerHTML = '';
    const tabs = h('div', { class: 'board-tabs', role: 'tablist' });
    for (const [key, label] of [['daily', 'Daily'], ['journey', 'Journey'], ['challenge', 'Challenge'], ['practice', 'Practice']]) {
      tabs.append(h('button', {
        class: 'diff-btn', type: 'button', role: 'tab',
        'aria-selected': key === boardKey ? 'true' : 'false',
        onclick: () => this.renderBoards(key),
      }, label));
    }
    body.append(tabs, h('p', { text: 'Loading…' }));
    const res = await this.platform.leaderboard(boardKey);
    body.querySelector('p')?.remove();
    const table = h('table', { class: 'board-table' });
    table.append(h('tr', {},
      h('th', { text: '#' }), h('th', { text: 'Player' }), h('th', { class: 'num', text: 'Score' }),
      h('th', { class: 'num', text: 'Moves' }), h('th', { class: 'num', text: 'Time' }), h('th', { text: 'Result' })));
    res.entries.slice(0, 25).forEach((e, i) => {
      table.append(h('tr', {},
        h('td', { text: String(i + 1) }),
        h('td', { text: e.name || '—' }),
        h('td', { class: 'num', text: String(e.score) }),
        h('td', { class: 'num', text: String(e.moves) }),
        h('td', { class: 'num', text: fmtMs(e.elapsedMs) }),
        h('td', { text: e.status === 'won' ? '✓' : '✗' })));
    });
    if (!res.entries.length) table.append(h('tr', {}, h('td', { colspan: '6', text: 'No entries yet — be the first.' })));
    body.append(table);
    body.append(h('p', {
      class: 'board-note',
      text: `Board: ${res.label}. Submissions include ruleset, content version, seed, assists and duration; ` +
        `impossible or stale-version scores are rejected.`,
    }));
  }

  renderProfile() {
    const p = this.platform.profile;
    const prog = this.platform.progress;
    const body = $('profile-body');
    body.innerHTML = '';
    const row = (label, control) => h('div', { class: 'set-row' }, h('label', { text: label }), control);
    const nameInput = h('input', {
      type: 'text', value: p.guest ? '' : p.name, maxlength: '24',
      placeholder: 'Display name', 'aria-label': 'Display name',
      onchange: (e) => {
        const v = e.target.value.trim().slice(0, 24);
        if (v) {
          p.name = v;
          p.guest = false;
          this.platform.saveProfile();
          this.updateProfileChip();
          this.toast('Name saved locally.');
        }
      },
    });
    body.append(
      row('Display name', nameInput),
      row('Account', h('span', { text: p.guest ? 'Guest — progress is stored on this device.' : 'Local profile' })),
      row('Boards cleared', h('strong', { text: String(prog.totals.clears) })),
      row('Pairs connected', h('strong', { text: String(prog.totals.pairs) })),
      row('Days played', h('strong', { text: String(prog.streakDays.length) })),
      h('p', {
        class: 'result-note',
        text: this.platform.hosted
          ? 'Connected to host — progress syncs to the cloud with conflict-safe merge.'
          : 'Offline mode — sign-in and cloud save activate when hosted.',
      }),
    );
  }

  // --- pause / countdown -------------------------------------------------------------------

  showPause(summary) {
    $('pause-summary').textContent = summary || '';
    $('pause-overlay').hidden = false;
    this.lastFocus = document.activeElement;
    $('btn-resume').focus();
  }

  hidePause() {
    $('pause-overlay').hidden = true;
    this.lastFocus?.focus?.({ preventScroll: true });
  }

  showLesson(text) {
    const el = $('lesson-banner');
    if (!text) { el.hidden = true; return; }
    el.hidden = false;
    $('lesson-text').textContent = text;
    this.announce(text);
  }

  async countdown() {
    const el = $('countdown');
    el.hidden = false;
    for (const n of ['3', '2', '1', 'Go!']) {
      el.textContent = n;
      this.announce(n);
      await new Promise((r) => setTimeout(r, 600));
    }
    el.hidden = true;
  }
}
