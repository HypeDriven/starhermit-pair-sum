// Pair Sum — DOM UI shell.
// Semantic HTML over/beside the canvas: screens, HUD, pause, settings, help,
// results, leaderboards, and the accessible board mirror. UI state is fully
// separate from simulation state.

import { ACHIEVEMENTS, THEMES, JOURNEY, PRACTICE_DIFFICULTIES, CHALLENGES, getTheme } from './content.js';
import { remainingCount } from './rules.js';
import { renderGraphicsSection } from './gfxui.js';
import { T, N, getLang } from './i18n.js';

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

export function syncText(state) {
  return T({
    offline: N('Off — local only'),
    saving: N('Saving…'),
    synced: N('Synced'),
    error: N('Unavailable — retrying with your next save'),
  }[state] || N('Off — local only'));
}

// Round titles are stored in English on the def (and in saved snapshots);
// translate them at display time, including the generated patterns.
export function defTitle(def) {
  const title = String(def?.title || N('Untitled'));
  let m;
  if ((m = /^(\d+)\. (.+)$/.exec(title))) return `${m[1]}. ${T(m[2])}`;
  if ((m = /^Daily — (.+)$/.exec(title))) return T('Daily — {date}', { date: m[1] });
  if ((m = /^Practice — (.+)$/.exec(title))) return T('Practice — {name}', { name: T(m[2]) });
  if ((m = /^Score chase — week (\d+)$/.exec(title))) return T('Score chase — week {n}', { n: m[1] });
  return T(title);
}

const KEY_NAMES = { Escape: 'Esc', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Space: 'Space', Enter: 'Enter', NumpadEnter: 'Num Enter' };
const keyLabel = (code) => KEY_NAMES[code] || String(code || '').replace(/^Key/, '').replace(/^Digit/, '');
const ACTION_TEXT = [
  [['left', 'right', 'up', 'down'], N('Move among cells')], [['choose'], N('Select / connect')], [['cancel'], N('Cancel selection · Pause')],
  [['hint'], N('Hint')], [['undo'], N('Undo')], [['addRows'], N('Add rows')], [['camera'], N('Reset camera')],
];
/** Help rows from bindings { action: [codes] }: key label -> action text. */
export function bindingLabels(keys) {
  const out = {};
  for (const [actions, text] of ACTION_TEXT) {
    const label = actions.map((a) => (keys[a] || []).map(keyLabel).join(' / ')).filter(Boolean).join(' ');
    if (label) out[label] = text;
  }
  out.Gamepad = DEFAULT_BINDINGS.Gamepad;
  return out;
}

export const DEFAULT_BINDINGS = {
  [N('Arrow keys')]: N('Move among cells'),
  [N('Enter / Space')]: N('Select / connect'),
  'Esc': N('Cancel selection · Pause'),
  'H': N('Hint'),
  'U': N('Undo'),
  'A': N('Add rows'),
  'R': N('Reset camera'),
  [N('Gamepad')]: N('D-pad moves focus · A connects · B cancels · Start pauses · Y hints'),
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
    this._last = {};   // last render call per screen, replayed by relocalize()
  }

  // Language changed: re-render the visible screen from its last call and the
  // always-on chrome; main.js refreshes the HUD, pause card and lesson banner.
  relocalize() {
    const name = this.currentScreen;
    if (name && this._last[name]) this._last[name]();
    this._mirrorKey = null;
    this.updateProfileChip();
    this.updateSyncNote();
    if (this._last.journeyMini) this._last.journeyMini();
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
    const btn = $('btn-profile');
    const guest = this.platform.profile.guest;
    btn.textContent = guest ? `👤 ${T('Guest')}` : `${this.platform.avatarUrl ? '' : '👤 '}${this.platform.profile.name}`;
    btn.setAttribute('aria-label', T('Profile'));
    if (!guest && this.platform.avatarUrl) {
      const img = h('img', { class: 'chip-avatar', src: this.platform.avatarUrl, alt: '', width: '18', height: '18' });
      btn.prepend(img);
    }
  }

  // Cloud-save status, shown in the right-rail status slot.
  updateSyncNote() {
    const el = $('presence-note');
    if (!el) return;
    const text = {
      offline: N('Offline — progress stays on this device.'),
      saving: N('Saving to your account…'),
      synced: N('Progress synced to your account.'),
      error: N('Cloud sync unavailable — changes kept on this device.'),
    }[this.platform.syncState] || '';
    el.textContent = text ? T(text) : '';
    el.dataset.sync = this.platform.syncState;
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
    const parts = [T('{n} digits left', { n: left })];
    if (state.limits.moves != null) parts.push(T('{n} moves', { n: Math.max(0, state.limits.moves - state.moves) }));
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
              ? T('Row {r}, column {c}, empty', { r: r + 1, c: c + 1 })
              : T('Row {r}, column {c}, digit {v}', { r: r + 1, c: c + 1, v }),
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
        const sel = T(', selected');
        const base = btn.getAttribute('aria-label');
        if (!base.endsWith(sel)) btn.setAttribute('aria-label', base + sel);
      }
    }
  }

  setMirrorVisible(visible) {
    $('board-mirror').classList.toggle('mirror-hidden', !visible);
    document.body.classList.toggle('show-mirror', visible);
  }

  focusCell(i) {
    const btn = this.mirrorButtons?.[i];
    if (btn && btn.getAttribute('data-empty') !== '1') {
      // Hidden mirror cells cannot receive focus or show the directional cursor.
      this.setMirrorVisible(true);
      btn.focus({ preventScroll: true });
    }
  }

  // --- title / modes ---------------------------------------------------------------

  renderTitle(progress, dailyDef, hasSave) {
    this._last.title = () => this.renderTitle(progress, dailyDef, hasSave);
    $('btn-continue').hidden = !hasSave;
    const done = Object.values(progress.journey).filter((j) => j.done).length;
    $('journey-status').textContent = `(${done}/${JOURNEY.length})`;
    const todayKey = `daily-${new Date(this.platform.serverNow()).toISOString().slice(0, 10)}`;
    $('daily-status').textContent = progress.bestDaily[todayKey] ? T('(done ✓)') : '';
  }

  renderModes(onPick) {
    this._last.modes = () => this.renderModes(onPick);
    const modes = [
      { id: 'learn', icon: '🎓', name: N('Learn'), desc: N('Six short interactive lessons. One rule at a time — you perform each move.'), meta: N('5–10 min · unranked') },
      { id: 'journey', icon: '🗺️', name: N('Journey'), desc: N('Forty authored pages across five notebooks, with mastery stages.'), meta: N('Long form · progress saved') },
      { id: 'daily', icon: '📅', name: N('Daily'), desc: N('One shared seed for everyone, per UTC day. No hints, no undo.'), meta: N('3 min · ranked') },
      { id: 'practice', icon: '🧘', name: N('Practice'), desc: N('Pick a difficulty. Hints, undo and restart freely; never ranked.'), meta: N('Unranked') },
      { id: 'challenge', icon: '⏱️', name: N('Challenge'), desc: N('Move limits, speed targets, altered layouts, restricted tools.'), meta: N('Ranked') },
      { id: 'score', icon: '🏆', name: N('Score chase'), desc: N('Chase the global and friends boards on validated seeds.'), meta: N('Ranked') },
    ];
    const host = $('mode-list');
    host.innerHTML = '';
    for (const m of modes) {
      host.append(h('button', {
        class: 'mode-card', type: 'button',
        onclick: () => onPick(m.id),
      },
        h('h3', { text: `${m.icon} ${T(m.name)}` }),
        h('p', { text: T(m.desc) }),
        h('div', { class: 'meta', text: T(m.meta) }),
      ));
    }
  }

  renderJourney(progress, onPick) {
    this._last.journey = () => this.renderJourney(progress, onPick);
    this._last.journeyMini = () => {
      const n = Object.values(progress.journey).filter((j) => j.done).length;
      $('journey-progress-mini').textContent = T('Journey: {done}/{total} pages cleared.', { done: n, total: JOURNEY.length });
    };
    const host = $('journey-map');
    host.innerHTML = '';
    const doneCount = Object.values(progress.journey).filter((j) => j.done).length;
    for (let t = 0; t < 5; t++) {
      const row = h('div', { class: 'journey-theme-row' });
      row.append(h('h3', { text: T(THEMES[t].name) }));
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
          'aria-label': `${defTitle(def)}${mastery ? T(' (mastery)') : ''}${rec?.done ? T(', completed, best {best}', { best: rec.best }) : unlocked ? '' : T(', locked')}`,
          disabled: unlocked ? null : '',
          onclick: unlocked ? () => onPick(def) : null,
        }, mastery ? '★' : String(idx + 1));
        if (rec?.stars) btn.append(h('span', { class: 'stars', text: '★'.repeat(rec.stars) }));
        grid.append(btn);
      }
      row.append(grid);
      host.append(row);
    }
    $('journey-progress-mini').textContent = T('Journey: {done}/{total} pages cleared.', { done: doneCount, total: JOURNEY.length });
  }

  // --- setup screen ---------------------------------------------------------------

  // Shows rules, expected duration, player count, assists, ranked status
  // before commitment.
  // `title` is English (a key or a def title); `note` an English key.
  renderSetup(opts) {
    this._last.setup = () => this.renderSetup(opts);
    const { title, def, difficulties, selectedDiff, onDiff, note } = opts;
    const body = $('setup-body');
    body.innerHTML = '';
    $('setup-h').textContent = def && title === def.title ? defTitle(def) : T(title);
    const kv = (k, v) => h('div', { class: 'kv' }, h('span', { text: k }), h('strong', { text: v }));
    if (difficulties) {
      body.append(h('div', { class: 'diff-row', role: 'group', 'aria-label': T('Difficulty') },
        difficulties.map((d) => h('button', {
          class: 'diff-btn', type: 'button',
          'aria-pressed': d.id === selectedDiff ? 'true' : 'false',
          onclick: () => onDiff(d.id),
        }, T(d.name)))));
    }
    if (def) {
      const pairs = Math.floor(def.cells.filter((c) => c !== 0).length / 2);
      body.append(
        kv(T('Board'), T('{rows} rows × {cols} · {pairs} pairs', { rows: def.cells.length / def.cols, cols: def.cols, pairs })),
        kv(T('Rules'), T('Connect equal numbers or pairs summing to ten along a clear row, column, or fold.')),
        kv(T('Expected'), def.limits?.timeMs ? T('{time} limit', { time: fmtMs(def.limits.timeMs) }) : T('{a}–{b} min', { a: Math.max(2, Math.round(pairs * 4 / 60)), b: Math.max(3, Math.round(pairs * 9 / 60)) })),
        kv(T('Players'), T('1 (asynchronous score comparison)')),
        kv(T('Assists'), T('Hints {hints} · Undo {undo}', { hints: def.assists?.hints ? T('on') : T('off'), undo: def.assists?.undo ? T('on') : T('off') })),
        kv(T('Limits'), [
          def.limits?.moves ? T('{n} moves', { n: def.limits.moves }) : null,
          def.limits?.timeMs ? fmtMs(def.limits.timeMs) : null,
        ].filter(Boolean).join(' · ') || T('None')),
        kv(T('Result'), def.ranked ? T('Ranked — submitted with seed and ruleset') : T('Unranked — no effect on rating')),
        kv(T('Seed'), def.seed),
      );
    }
    if (note) body.append(h('p', { class: 'result-note', text: T(note) }));
  }

  // --- results ------------------------------------------------------------------------

  renderResults(result, def, opts, relocalizing) {
    this._last.results = () => this.renderResults(result, def, opts, true);
    const { isBest, achievements, nextLabel } = opts;
    const body = $('results-body');
    const lb = document.getElementById('results-lb');
    body.innerHTML = '';
    const won = result.status === 'won';
    const headline = T(won ? N('Page cleared!') :
      result.reason === 'time-limit' ? N('Out of time') :
      result.reason === 'move-limit' ? N('Out of moves') : N('Round ended'));
    body.append(h('div', { class: 'result-headline', text: headline }));
    const rows = [
      [T('Pairs cleared'), `${result.moves} × 10`, result.score.pairs],
      [T('Chain bonus'), T('best chain {n}×', { n: result.bestChain }), result.score.chain],
      [T('Row clears'), '', result.score.rows],
      [T('Board clear'), '', result.score.clear],
      [T('Time bonus'), '', result.score.time],
    ];
    const table = h('table', { class: 'score-table' });
    for (const [label, note, val] of rows) {
      table.append(h('tr', {},
        h('td', { text: label }),
        h('td', { class: 'result-note', text: note }),
        h('td', { text: String(val) })));
    }
    table.append(h('tr', { class: 'total' },
      h('td', { text: T('Total') }), h('td', {}), h('td', { text: String(result.score.total) })));
    body.append(table);
    body.append(h('p', {
      class: 'result-note',
      text: [
        T('{time} elapsed', { time: fmtMs(result.elapsedMs) }),
        result.invalid === 1 ? T('1 invalid action') : T('{n} invalid actions', { n: result.invalid }),
        result.addRowsUsed === 1 ? T('1 redeal') : T('{n} redeals', { n: result.addRowsUsed }),
        T('seed {seed}', { seed: result.seed }),
      ].join(' · '),
    }));
    if (isBest) body.append(h('p', { class: 'result-note', text: T('★ New personal best for this page.') }));
    if (achievements?.length) {
      body.append(h('p', { class: 'result-note', text: T('🎖️ Unlocked: {names}', { names: achievements.map((k) => T(ACHIEVEMENTS.find((a) => a.key === k)?.name || k)).join(', ') }) }));
    }
    $('btn-next').textContent = T(nextLabel || N('Next'));
    if (relocalizing) { if (lb && this._lbText) this.setLeaderboardLine(this._lbText); return; }
    this._lbText = null;
    this.announce(T('{headline} Total score {n}.', { headline, n: result.score.total }), true);
  }

  // StarHermit leaderboard line on the results screen (signed-in ranked rounds only).
  // `text` is a function so a language change can re-render the line.
  setLeaderboardLine(text) {
    this._lbText = text;
    const body = $('results-body');
    let line = document.getElementById('results-lb');
    if (!line) {
      line = h('p', { class: 'result-note', id: 'results-lb', role: 'status' });
      body.append(line);
    }
    line.textContent = typeof text === 'function' ? text() : text;
  }

  // --- help ----------------------------------------------------------------------------

  renderHelp(keys) {
    this._last.help = () => this.renderHelp(keys);
    const body = $('help-body');
    body.innerHTML = '';
    const cell = (txt, cls = '') => h('div', { class: `demo-cell ${cls}`, text: txt });
    const cards = [
      {
        t: N('Connect matching pairs'),
        p: N('Select two digits that are equal — or that add to ten. Both cells clear.'),
        demo: [cell('4', 'match'), cell('4', 'match'), cell('3', 'match'), cell('7', 'match')],
      },
      {
        t: N('Paths must be clear'),
        p: N('A pair connects along its row, its column, or the reading-order fold between rows. Every cell on the path must be empty; filled cells block.'),
        demo: [cell('5', 'match'), cell('·'), cell('5', 'match'), cell('8', 'block')],
      },
      {
        t: N('Cleared cells never block'),
        p: N('Empty cells are open lanes. Clearing pairs in the middle opens longer connections across the page.'),
        demo: [cell('2', 'match'), cell('·'), cell('·'), cell('8', 'match')],
      },
      {
        t: N('Add rows when stuck'),
        p: N('If nothing connects, Add Rows rewrites every remaining digit as fresh rows below. It costs your chain but keeps the page alive.'),
        demo: [cell('➕')],
      },
      {
        t: N('Scoring'),
        p: N('Pairs score 10. Consecutive clears without a mistake build a chain bonus. Clearing whole rows and the whole board pay extra; beat par time for a bonus.'),
        demo: [],
      },
    ];
    for (const c of cards) {
      body.append(h('div', { class: 'rule-card' },
        h('h3', { text: T(c.t) }), h('p', { text: T(c.p) }),
        c.demo.length ? h('div', { class: 'rule-demo' }, c.demo) : null));
    }
    // Effective keyboard bindings (StarHermit rebinds included).
    const controls = h('div', { class: 'rule-card' }, h('h3', { text: T('Controls') }));
    for (const [k, v] of Object.entries(keys ? bindingLabels(keys) : DEFAULT_BINDINGS)) {
      controls.append(h('p', {}, h('kbd', { text: T(k) }), ` ${T(v)}`));
    }
    body.append(controls);
  }

  // --- settings -------------------------------------------------------------------------

  renderSettings(s, onChange, gfxApi) {
    this._last.settings = () => this.renderSettings(s, onChange, gfxApi);
    const body = $('settings-body');
    // The Graphics host keeps its node across re-renders: game-options.js mounts
    // the shared Frame rate / Language / Sound / Report sections in it.
    const keepGfx = document.getElementById('gfx-section');
    keepGfx?.remove();
    body.innerHTML = '';
    let n = 0;
    const row = (label, control) => {
      const id = control.id || `set-ctl-${++n}`;
      control.id = id;
      return h('div', { class: 'set-row' }, h('label', { text: label, for: id }), control);
    };
    const group = (t, key) => h('div', { class: 'set-group', text: t, 'data-group': key });
    const check = (key) => h('input', {
      type: 'checkbox', ...(s[key] ? { checked: '' } : {}),
      onchange: (e) => onChange(key, e.target.checked),
    });
    const slider = (key) => h('input', {
      type: 'range', min: '0', max: '1', step: '0.05', value: String(s[key]),
      oninput: (e) => onChange(key, Number(e.target.value)),
    });
    const select = (key, options) => {
      const sel = h('select', { onchange: (e) => onChange(key, e.target.value) });
      for (const [v, label] of options) {
        sel.append(h('option', { value: v, ...(s[key] === v ? { selected: '' } : {}) }, label));
      }
      return sel;
    };

    body.append(
      group(T('Audio'), 'audio'),
      row(T('Mute all'), check('muted')),
      row(T('Music'), slider('volMusic')),
      row(T('Effects'), slider('volEffects')),
      row(T('Ambience'), slider('volAmbience')),
      row(T('Voice cues'), slider('volVoice')),
      row(T('Captions for sounds'), check('captions')),
      group(T('Display'), 'display'),
      row(T('Theme'), select('theme', THEMES.map((t) => [t.id, T(t.name)]))),
      row(T('Reduced motion'), check('reducedMotion')),
      row(T('High contrast'), check('highContrast')),
      row(T('Color palette'), select('palette', [['default', T('Default')], ['deuteranopia', T('Deuteranopia-safe')], ['protanopia', T('Protanopia-safe')], ['tritanopia', T('Tritanopia-safe')]])),
      row(T('Larger text'), check('largeText')),
      group(T('Controls'), 'controls'),
      row(T('Left-handed tray'), check('leftHanded')),
      row(T('Hold to confirm'), check('holdToConfirm')),
      row(T('Haptics'), check('haptics')),
      row(T('Timing assistance (+50% clocks)'), check('timingAssist')),
      group(T('Privacy'), 'privacy'),
      h('div', { class: 'set-row' },
        h('label', { text: T('Tutorial') }),
        h('button', { class: 'chip', type: 'button', onclick: () => onChange('replayTutorial', true) }, T('Replay lessons'))),
    );
    if (gfxApi) {
      let gfx = keepGfx;
      if (!gfx) {
        gfx = h('section', { id: 'gfx-section', class: 'gfx-section', 'data-gfx-section': '' });
        gfx.append(h('div', { id: 'gfx-box' }));
      }
      // Graphics sits right after Display so it is easy to find.
      const controlsGroup = body.querySelector('.set-group[data-group="controls"]');
      body.insertBefore(gfx, controlsGroup || null);
      // Only the game's own box is redrawn; the shared sections after it stay.
      renderGraphicsSection(gfx.querySelector('#gfx-box'), gfxApi);
    }
  }

  // --- achievements / boards / profile ------------------------------------------------------

  renderAchievements(progress) {
    this._last.achievements = () => this.renderAchievements(progress);
    const host = $('ach-body');
    host.innerHTML = '';
    for (const a of ACHIEVEMENTS) {
      const got = progress.achievements[a.key];
      host.append(h('div', { class: `ach-card ${got ? 'unlocked' : 'locked'}` },
        h('h3', { text: `${got ? '🎖️' : '🔒'} ${T(a.name)}` }),
        h('p', { text: T(a.desc) }),
        h('div', { class: 'meta', text: got ? T('Unlocked {date}', { date: new Date(got.at).toLocaleDateString(getLang()) }) : T('Locked') })));
    }
  }

  async renderBoards(boardKey = 'daily') {
    this._last.boards = () => this.renderBoards(boardKey);
    const body = $('boards-body');
    body.innerHTML = '';
    const tabs = h('div', { class: 'board-tabs', role: 'tablist' });
    for (const [key, label] of [['daily', N('Daily')], ['score', N('Score chase')], ['challenge', N('Challenge')], ['journey', N('Journey')], ['practice', N('Practice')]]) {
      tabs.append(h('button', {
        class: 'diff-btn', type: 'button', role: 'tab',
        'aria-selected': key === boardKey ? 'true' : 'false',
        onclick: () => this.renderBoards(key),
      }, T(label)));
    }
    body.append(tabs, h('p', { text: T('Loading…') }));
    const res = await this.platform.leaderboard(boardKey);
    body.querySelector('p')?.remove();
    const table = h('table', { class: 'board-table' });
    table.append(h('tr', {},
      h('th', { text: '#' }), h('th', { text: T('Player') }), h('th', { class: 'num', text: T('Score') }),
      h('th', { class: 'num', text: T('Moves') }), h('th', { class: 'num', text: T('Time') }), h('th', { text: T('Result') })));
    res.entries.slice(0, 25).forEach((e, i) => {
      table.append(h('tr', {},
        h('td', { text: String(i + 1) }),
        h('td', { text: e.name || '—' }),
        h('td', { class: 'num', text: String(e.score ?? 0) }),
        h('td', { class: 'num', text: e.moves == null ? '—' : String(e.moves) }),
        h('td', { class: 'num', text: e.elapsedMs == null ? '—' : fmtMs(e.elapsedMs) }),
        h('td', { text: e.status == null ? '—' : e.status === 'won' ? '✓' : '✗' })));
    });
    if (!res.entries.length) table.append(h('tr', {}, h('td', { colspan: '6', text: T('No entries yet — be the first.') })));
    body.append(table);
    body.append(h('p', {
      class: 'board-note',
      text: res.source === 'global'
        ? T('Board: {label}. Platform leaderboard is read-only; personal bests are kept on this device and synced with your account.', { label: T(res.label) })
        : T('Board: {label}. Personal bests on this device; the bundled dev server validates submissions (ruleset, content version, seed, assists, duration) and rejects impossible or stale-version scores.', { label: T(res.label) }),
    }));
  }

  renderProfile() {
    this._last.profile = () => this.renderProfile();
    const p = this.platform.profile;
    const prog = this.platform.progress;
    const body = $('profile-body');
    body.innerHTML = '';
    const row = (label, control) => h('div', { class: 'set-row' }, h('label', { text: label }), control);
    const hosted = this.platform.hosted;
    // Hosted accounts use the platform nickname; the local edit field is for
    // guest/offline play only.
    const nameControl = hosted
      ? h('strong', { text: p.name })
      : h('input', {
        type: 'text', value: p.guest ? '' : p.name, maxlength: '24',
        placeholder: T('Display name'), 'aria-label': T('Display name'),
        onchange: (e) => {
          const v = e.target.value.trim().slice(0, 24);
          if (v) {
            p.name = v;
            p.guest = false;
            this.platform.saveProfile();
            this.updateProfileChip();
            this.toast(T('Name saved locally.'));
          }
        },
      });
    body.append(
      row(T('Display name'), nameControl),
      row(T('Account'), h('span', { text: hosted ? T('StarHermit account') : (p.guest ? T('Guest — progress is stored on this device.') : T('Local profile')) })),
      row(T('Boards cleared'), h('strong', { text: String(prog.totals.clears) })),
      row(T('Pairs connected'), h('strong', { text: String(prog.totals.pairs) })),
      row(T('Days played'), h('strong', { text: String(prog.streakDays.length) })),
      row(T('Cloud sync'), h('span', { text: syncText(this.platform.syncState) })),
      h('p', {
        class: 'result-note',
        text: hosted
          ? T('Connected to the platform — progress syncs to your account cloud save with conflict-safe merge.')
          : T('Offline mode — cloud save and platform identity activate when launched by the host.'),
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
    for (const n of ['3', '2', '1', T('Go!')]) {
      el.textContent = n;
      this.announce(n);
      await new Promise((r) => setTimeout(r, 600));
    }
    el.hidden = true;
  }
}
