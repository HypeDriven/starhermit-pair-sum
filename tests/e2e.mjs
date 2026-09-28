/**
 * Pair Sum — end-to-end playthrough test (dev only, not shipped).
 *
 * Drives the real visible UI in headless Chrome via playwright-core:
 *   title → Play → mode select → Journey → stage 1 setup → countdown →
 *   plays the board to a win by clicking the actual 3D tokens on the canvas
 *   (cell screen positions are only *read* from the renderer; every action is
 *   a real mouse/keyboard interaction) — exercising hint, hover path-preview,
 *   undo, pause/resume, the results screen, journey progression, and settings
 *   + help open/change/close via the topbar mid-round. Runs twice: desktop
 *   1280x800 and mobile 390x844 (touch).
 *
 * The game is fully playable offline as a guest (see js/platform.js), so this
 * test serves the repo with a minimal embedded static server. The one network
 * call the game makes offline is the host-detection probe GET /api/v1/time;
 * its expected 404 console message is filtered (the game handles it by design
 * and switches to offline mode).
 *
 * Regression coverage for previously fixed defects (see knownissues.md):
 *  - Practice mode must render its setup screen (missing import regression).
 *  - Pause overlay → Settings must open ABOVE the overlay and return to it
 *    (.screens z-index must beat .pause-overlay).
 *  - Hovering a legal target with a cell selected must not produce NaN
 *    geometry errors (checkPair echoes a/b for previewPath).
 *  - Undo must revive the restored cells' 3D tokens immediately (dying views
 *    are revived in syncState), keeping every refilled cell tappable.
 *  - Opening a full-page screen mid-round pauses the round; Back returns to
 *    the pause overlay, never silently abandons the round on the title screen.
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOT = (stage, vp) => `/tmp/pair-sum-e2e-${stage}-${vp}.png`;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2',
  '.ts': 'text/javascript; charset=utf-8',
};

function serve() {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      let p = normalize(decodeURIComponent(url.pathname));
      if (p === '/' || p === '\\') p = '/index.html';
      const file = join(ROOT, p);
      if (!file.startsWith(ROOT)) throw new Error('traversal');
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not-found' }));
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// Benign GPU/swiftshader noise (from tools/production_game_audit.mjs).
const browserNoise = /GL Driver Message|GPU stall due to ReadPixels|Automatic fallback to software WebGL|EnableWebGLDeveloperExtensions/i;

const errors = [];
function watch(page, tag) {
  page.on('pageerror', (e) => errors.push(`[${tag}] pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    const text = m.text();
    if (browserNoise.test(text)) return;
    // Expected offline host-detection probe (GET /api/v1/time 404): the game
    // catches this and runs in its supported offline/guest mode.
    if (/Failed to load resource/.test(text) && (m.location()?.url || '').includes('/api/v1/')) return;
    errors.push(`[${tag}] console ${m.type()}: ${text}`);
  });
}

const step = async (name, fn) => {
  await fn();
  console.log(`ok - ${name}`);
};

// Read game state for synchronization/targeting only (never acts on the game).
// `pairs` is filtered to cells whose 3D tokens are actually clickable right
// now; after an undo the revived tokens are no longer `dying` (regression
// coverage: syncState revives them), so every refilled cell stays tappable.
const readBoard = (page) => page.evaluate(async () => {
  const { listLegalPairs, canAddRows, remainingCount } = await import('./js/rules.js');
  const g = window.__pairsum;
  const s = g.session.state;
  if (!s) return { machine: g.session.machine, status: null };
  const r = g.renderer;
  const mirrorVisible = !document.getElementById('board-mirror').classList.contains('mirror-hidden');
  const tappable = (i) => mirrorVisible || (r?.tokens.has(i) && !r.tokens.get(i).dying);
  const all = listLegalPairs(s).map((p) => [p.a, p.b]);
  const filled = [];
  for (let i = 0; i < s.cells.length; i++) if (s.cells[i] !== 0 && tappable(i)) filled.push(i);
  return {
    machine: g.session.machine,
    status: s.status,
    left: remainingCount(s),
    pairs: all.filter(([a, b]) => tappable(a) && tappable(b)),
    totalPairs: all.length,
    nudgeCell: filled[0] ?? null,
    canAdd: canAddRows(s),
    selection: g.session.selection,
  };
});

// Click a board cell through the visible UI: the 3D token on the canvas, or
// the DOM mirror cell when the notebook fallback is active. Retries briefly
// because the renderer initializes asynchronously and can lag round start
// under load.
async function clickCell(page, index) {
  let last = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const info = await page.evaluate((i) => {
      const g = window.__pairsum;
      const r = g.renderer;
      const mirrorHidden = document.getElementById('board-mirror').classList.contains('mirror-hidden');
      const view = r?.tokens.get(i);
      if (view) {
        const v = view.mesh.position.clone().project(r.camera);
        const rect = r.renderer.domElement.getBoundingClientRect();
        return {
          mode: 'canvas',
          x: rect.left + ((v.x + 1) / 2) * rect.width,
          y: rect.top + ((1 - v.y) / 2) * rect.height,
        };
      }
      return { mode: mirrorHidden ? 'none' : 'mirror', hasRenderer: !!r, tokenCount: r ? r.tokens.size : -1 };
    }, index);
    last = info;
    if (info.mode === 'canvas') {
      await page.mouse.click(info.x, info.y);
      return;
    }
    if (info.mode === 'mirror') {
      await page.locator('#board-mirror .cell-btn').nth(index).click();
      return;
    }
    await page.waitForTimeout(400);
  }
  throw new Error(`no screen point for cell ${index}: ${JSON.stringify(last)}`);
}

// Select cell a, then connect it to cell c; retry if a tap missed the token.
async function clickPair(page, a, c) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await clickCell(page, a);
    const sel = await page.evaluate(() => window.__pairsum.session.selection);
    if (sel === a) {
      await clickCell(page, c);
      return;
    }
    await page.waitForTimeout(300);
  }
  throw new Error(`cell ${a} never became selected`);
}

// Hover over a cell without clicking (drives the hover path-preview a player
// sees before connecting).
async function hoverCell(page, index) {
  const info = await page.evaluate((i) => {
    const g = window.__pairsum;
    const r = g.renderer;
    const mirrorHidden = document.getElementById('board-mirror').classList.contains('mirror-hidden');
    const view = r?.tokens.get(i);
    if (mirrorHidden && view) {
      const v = view.mesh.position.clone().project(r.camera);
      const rect = r.renderer.domElement.getBoundingClientRect();
      return { mode: 'canvas', x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
    }
    return { mode: 'mirror' };
  }, index);
  if (info.mode === 'canvas') await page.mouse.move(info.x, info.y);
  else await page.locator('#board-mirror .cell-btn').nth(index).hover();
}

async function playRound(page, vp) {
  let undoChecked = false;
  let hoverChecked = false;
  let pauseChecked = false;
  let shot = false;
  for (let i = 0; i < 200; i++) {
    const b = await readBoard(page);
    if (b.status !== 'active') return b;
    if (!b.pairs.length) {
      if (b.totalPairs > 0) {
        // Legal pairs exist but their tokens are mid-animation (e.g. a token
        // that was still sliding in). Nudge a sync by selecting/deselecting
        // another filled cell, then retry.
        if (b.nudgeCell == null) throw new Error('no tappable cell to nudge respawn');
        await clickCell(page, b.nudgeCell);
        await clickCell(page, b.nudgeCell);
        await page.waitForTimeout(300);
        continue;
      }
      if (!b.canAdd) throw new Error(`dead end: no legal pairs and no add-rows (left=${b.left})`);
      await page.click('#btn-addrows');
      await page.waitForTimeout(300);
      continue;
    }
    const [a, c] = b.pairs[0];
    await clickPair(page, a, c);
    await page.waitForTimeout(250);
    if (!shot) { await page.screenshot({ path: SHOT('play', vp) }); shot = true; }

    if (!undoChecked) {
      const before = (await readBoard(page)).left;
      await page.click('#btn-undo');
      const after = (await readBoard(page)).left;
      if (after !== before + 2) throw new Error(`undo did not restore the pair (${before} -> ${after})`);
      undoChecked = true;
    } else if (!hoverChecked) {
      // Exercise the hover path-preview a player uses before connecting:
      // select one cell of a legal pair, hover its partner, then connect.
      // (This is the interaction that triggers known bug #3's console error.)
      hoverChecked = true;
      const nb = await readBoard(page);
      if (nb.pairs.length) {
        const [ha, hb] = nb.pairs[0];
        await clickCell(page, ha);
        await page.waitForFunction((want) => window.__pairsum.session.selection === want, ha, { timeout: 3000 });
        await hoverCell(page, hb);
        await page.waitForTimeout(350);
        await clickCell(page, hb);
        await page.waitForTimeout(250);
      }
    } else if (!pauseChecked && (await readBoard(page)).left <= 4) {
      if (vp === 'desktop') await page.keyboard.press('Escape');
      else await page.click('#btn-pause');
      await page.waitForSelector('#pause-overlay:not([hidden])');
      await page.screenshot({ path: SHOT('pause', vp) });
      // Pause-menu Settings must open above the overlay and return to it.
      await page.click('#btn-pause-settings');
      await page.waitForSelector('#screen-settings:not([hidden])');
      await page.locator('#screen-settings [data-back]').click();
      await page.waitForSelector('#pause-overlay:not([hidden])');
      await page.click('#btn-resume');
      await page.waitForSelector('#pause-overlay', { state: 'hidden' });
      pauseChecked = true;
    }
  }
  throw new Error('round did not terminate within 200 actions');
}

// Graphics settings through the visible UI: preset Low → High (applied to the
// canvas/body), a per-effect override, Ultra clears overrides, the frame-rate
// readout, persistence across a reload, then back to Auto for the rest of the run.
async function graphicsSettings(page, vp) {
  const state = () => page.evaluate(() => ({
    canvas: document.querySelector('#canvas-host canvas')?.dataset.gfxPreset,
    body: document.body.dataset.gfxPreset,
    q: window.__pairsum.renderer?.q,
    saved: JSON.parse(localStorage.getItem('pairsum:settings') || '{}').graphics,
    summary: document.getElementById('gfx-summary')?.textContent || '',
  }));
  const openGfx = async () => {
    await page.click('#btn-title-settings');
    await page.waitForSelector('#screen-settings:not([hidden]) #gfx-section #gfx-preset');
    await page.locator('#gfx-preset').scrollIntoViewIfNeeded();
  };
  await page.waitForFunction(() => !!window.__pairsum.renderer);
  await openGfx();
  const autoLabel = await page.locator('#gfx-preset option[value="auto"]').textContent();
  if (!/Auto \(detected: Low\)/.test(autoLabel)) throw new Error(`software GPU should auto-detect Low: ${autoLabel}`);

  await page.selectOption('#gfx-preset', 'low');
  let st = await state();
  if (st.canvas !== 'low' || st.body !== 'low' || st.q.post) throw new Error('Low not applied: ' + JSON.stringify(st));

  await page.selectOption('#gfx-preset', 'high');
  await page.waitForTimeout(600); // a few frames with the High post chain
  st = await state();
  if (st.canvas !== 'high' || st.q.bloom !== 'on' || st.q.ao !== 'on') throw new Error('High not applied: ' + JSON.stringify(st.q));
  if (!/bloom/.test(st.summary) || !/px/.test(st.summary)) throw new Error('summary missing: ' + st.summary);
  const fromPreset = await page.locator('#gfx-cat-shadows option[value="preset"]').textContent();
  if (!/From preset \(Medium\)/.test(fromPreset)) throw new Error('preset label: ' + fromPreset);

  await page.selectOption('#gfx-cat-bloom', 'off');
  st = await state();
  if (st.q.bloom !== 'off' || st.saved.bloom !== 'off') throw new Error('bloom override not applied: ' + JSON.stringify(st));
  if (/bloom/.test(st.summary)) throw new Error('summary still lists bloom: ' + st.summary);

  // Ultra clears the override; then High + override again for the reload check.
  await page.selectOption('#gfx-preset', 'ultra');
  await page.waitForTimeout(600);
  st = await state();
  if (st.q.bloom !== 'on' || st.saved.bloom !== undefined) throw new Error('preset did not clear overrides');
  if (await page.inputValue('#gfx-cat-bloom') !== 'preset') throw new Error('override select not reset');
  await page.selectOption('#gfx-preset', 'high');
  await page.selectOption('#gfx-cat-bloom', 'off');
  await page.locator('#gfx-fps').check();
  if (await page.locator('#fps-meter').isHidden()) throw new Error('fps readout not shown');
  if (vp === 'mobile') {
    // Panel fits the phone width (no horizontal overflow).
    const over = await page.evaluate(() => document.getElementById('screen-settings').scrollWidth - innerWidth);
    if (over > 1) throw new Error(`settings panel overflows by ${over}px`);
  }
  await page.locator('#gfx-summary').scrollIntoViewIfNeeded();
  await page.screenshot({ path: SHOT('graphics', vp) });

  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#screen-title:not([hidden])');
  await page.waitForFunction(() => !!window.__pairsum?.renderer);
  await openGfx();
  st = await state();
  if (st.canvas !== 'high' || st.q.bloom !== 'off' || !st.q.showFps) throw new Error('not restored after reload: ' + JSON.stringify(st.q));
  if (await page.inputValue('#gfx-preset') !== 'high' || await page.inputValue('#gfx-cat-bloom') !== 'off') {
    throw new Error('panel does not show the saved settings after reload');
  }
  // Keyboard: the preset select is reachable and operable.
  await page.focus('#gfx-preset');
  await page.selectOption('#gfx-preset', 'auto');
  await page.locator('#gfx-fps').uncheck();
  st = await state();
  if (st.q.preset !== 'low' || !st.q.auto || st.saved.bloom !== undefined) throw new Error('auto not restored: ' + JSON.stringify(st.q));
  if (await page.locator('#fps-meter').isVisible()) throw new Error('fps readout still visible');
  await page.locator('#screen-settings [data-back]').click();
  await page.waitForSelector('#screen-title:not([hidden])');
}

async function runPass(browser, vp, viewport) {
  const context = await browser.newContext({
    viewport,
    hasTouch: vp === 'mobile',
  });
  const page = await context.newPage();
  watch(page, vp);
  try {
    await step(`${vp}: load + title visible`, async () => {
      await page.goto(BASE, { waitUntil: 'load' });
      await page.waitForSelector('#screen-title:not([hidden])', { timeout: 15000 });
      await page.waitForFunction(() => window.__pairsum?.session.machine === 'title');
      await page.screenshot({ path: SHOT('title', vp) });
    });

    await step(`${vp}: title Settings → Graphics presets, override, persistence`, async () => {
      await graphicsSettings(page, vp);
    });

    await step(`${vp}: play → mode select`, async () => {
      await page.click('#btn-play');
      await page.waitForSelector('#screen-modes:not([hidden])');
      if (await page.locator('.mode-card').count() !== 6) throw new Error('expected 6 mode cards');
      await page.screenshot({ path: SHOT('modes', vp) });
    });

    await step(`${vp}: practice setup renders (regression: missing import)`, async () => {
      await page.locator('.mode-card', { hasText: 'Practice' }).click();
      await page.waitForSelector('#screen-setup:not([hidden])');
      const diffs = await page.locator('.diff-btn').count();
      if (diffs !== 4) throw new Error(`expected 4 difficulty buttons, got ${diffs}`);
      await page.locator('#screen-setup [data-back]').click();
      await page.waitForSelector('#screen-modes:not([hidden])');
    });

    await step(`${vp}: journey map → stage 1 setup`, async () => {
      await page.locator('.mode-card', { hasText: 'Journey' }).click();
      await page.waitForSelector('#screen-journey:not([hidden])');
      const nodes = await page.locator('.stage-node').count();
      if (nodes !== 40) throw new Error(`expected 40 journey stages, got ${nodes}`);
      const unlocked = await page.locator('.stage-node:not(.locked)').count();
      if (unlocked !== 1) throw new Error(`expected 1 unlocked stage, got ${unlocked}`);
      await page.screenshot({ path: SHOT('journey', vp) });
      await page.locator('.stage-node:not(.locked)').first().click();
      await page.waitForSelector('#screen-setup:not([hidden])');
      await page.screenshot({ path: SHOT('setup', vp) });
    });

    await step(`${vp}: start → countdown → active`, async () => {
      await page.click('#btn-setup-start');
      await page.waitForFunction(() => window.__pairsum.session.machine === 'countdown');
      await page.screenshot({ path: SHOT('countdown', vp) });
      await page.waitForFunction(() => window.__pairsum.session.machine === 'active', null, { timeout: 10000 });
      if (await page.locator('#action-tray').isHidden()) throw new Error('action tray not visible in play');
    });

    await step(`${vp}: hint announces a pair`, async () => {
      await page.click('#btn-hint');
      await page.waitForFunction(() => document.getElementById('live-polite').textContent.includes('Hint:'));
    });

    await step(`${vp}: clear the board (undo + pause/resume exercised)`, async () => {
      const end = await playRound(page, vp);
      console.log(`  status=${end.status} left=${end.left}`);
      if (end.status !== 'won') throw new Error(`expected a win, got ${end.status}`);
    });

    await step(`${vp}: results screen → back to title`, async () => {
      await page.waitForSelector('#screen-results:not([hidden])', { timeout: 8000 });
      const body = await page.textContent('#results-body');
      if (!/Page cleared!/.test(body)) throw new Error('results headline missing');
      await page.screenshot({ path: SHOT('results', vp) });
      const prog = await page.evaluate(() => JSON.parse(localStorage.getItem('pairsum:progress')));
      if (!prog?.journey?.['journey-1']?.done) throw new Error('journey-1 completion not persisted');
      await page.click('#btn-results-home');
      await page.waitForSelector('#screen-title:not([hidden])');
      // Stage 2 should now be unlocked.
      await page.click('#btn-journey');
      await page.waitForSelector('#screen-journey:not([hidden])');
      const unlocked = await page.locator('.stage-node:not(.locked)').count();
      if (unlocked !== 2) throw new Error(`expected 2 unlocked stages after win, got ${unlocked}`);
      await page.locator('#screen-journey [data-back]').click();
      await page.waitForSelector('#screen-modes:not([hidden])'); // journey back lands on modes
      await page.locator('#screen-modes [data-back]').click();
      await page.waitForSelector('#screen-title:not([hidden])');
    });

    await step(`${vp}: settings + help mid-round pause and return safely`, async () => {
      // Start stage 2, open Settings via the topbar mid-round: the round must
      // pause and Back must return to the pause overlay — never silently
      // abandon the round on the title screen.
      await page.click('#btn-journey');
      await page.waitForSelector('#screen-journey:not([hidden])');
      await page.locator('.stage-node:not(.locked)').nth(1).click();
      await page.waitForSelector('#screen-setup:not([hidden])');
      await page.click('#btn-setup-start');
      await page.waitForFunction(() => window.__pairsum.session.machine === 'active', null, { timeout: 10000 });

      await page.click('#btn-settings');
      await page.waitForSelector('#screen-settings:not([hidden])');
      const machine = await page.evaluate(() => window.__pairsum.session.machine);
      if (machine !== 'paused') throw new Error(`opening settings mid-round should pause, got ${machine}`);
      await page.locator('input[aria-label="muted"]').check();
      await page.locator('select[aria-label="palette"]').selectOption('deuteranopia');
      await page.locator('input[aria-label="reducedMotion"]').check();
      const applied = await page.evaluate(() => ({
        muted: window.__pairsum.platform.settings.muted,
        palette: window.__pairsum.platform.settings.palette,
        reduced: window.__pairsum.platform.settings.reducedMotion,
      }));
      if (!applied.muted || applied.palette !== 'deuteranopia' || !applied.reduced) {
        throw new Error('settings not applied: ' + JSON.stringify(applied));
      }
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('pairsum:settings')));
      if (!saved?.muted || saved.palette !== 'deuteranopia' || !saved.reducedMotion) {
        throw new Error('settings not persisted: ' + JSON.stringify(saved));
      }
      await page.screenshot({ path: SHOT('settings', vp) });
      await page.locator('#screen-settings [data-back]').click();
      await page.waitForSelector('#pause-overlay:not([hidden])');
      await page.click('#btn-resume');
      await page.waitForFunction(() => window.__pairsum.session.machine === 'active', null, { timeout: 5000 });

      // Help from the topbar mid-round: same pause-and-return contract.
      await page.click('#btn-help');
      await page.waitForSelector('#screen-help:not([hidden])');
      const helpBody = await page.textContent('#help-body');
      if (!helpBody.trim()) throw new Error('help body empty');
      await page.screenshot({ path: SHOT('help', vp) });
      await page.keyboard.press('Escape');
      await page.waitForSelector('#pause-overlay:not([hidden])');
      await page.click('#btn-resume');
      await page.waitForFunction(() => window.__pairsum.session.machine === 'active', null, { timeout: 5000 });
    });
  } finally {
    await context.close();
  }
  if (errors.length) {
    throw new Error(`page errors in ${vp} pass:\n` + errors.join('\n'));
  }
}

// --- main -------------------------------------------------------------------

const server = await serve();
const BASE = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  await runPass(browser, 'desktop', { width: 1280, height: 800 });
  await runPass(browser, 'mobile', { width: 390, height: 844 });
  console.log('\nE2E PASS — pair-sum playable end-to-end on desktop and mobile, no page errors');
} catch (e) {
  console.error(String(e.stack || e));
  if (errors.length) console.error('PAGE ERRORS:\n' + errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.close();
}
