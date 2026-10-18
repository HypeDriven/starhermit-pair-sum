// Graphics benchmark hook for tools/gfx-bench.mjs (dev-only): picks a preset in Settings → Graphics,
// starts a Practice round at the hardest difficulty and keeps clearing pairs by tapping the 3D tokens
// (the rules engine's first legal pair, located through the renderer's own camera projection, like a
// player taps them), adding rows when stuck — tokens lift, slide and pop, sparks burst, motes drift.
// A finished round goes to Retry.
export const presets = ['low', 'balanced', 'high', 'ultra'];
export const levels = { low: 0, balanced: 4, high: 10, ultra: 17 };

export async function setPreset(page, preset) {
  await page.waitForFunction(() => window.__pairsum?.session.machine === 'title' && !!window.__pairsum.renderer, null, { timeout: 30000 });
  await page.click('#btn-title-settings');
  await page.waitForSelector('#screen-settings:not([hidden]) #gfx-section #gfx-preset');
  await page.locator('#gfx-preset').scrollIntoViewIfNeeded();
  await page.selectOption('#gfx-preset', preset);
  await page.waitForFunction((p) => document.body.dataset.gfxPreset === p || window.__pairsum.renderer.q.preset === p, preset);
  await page.locator('#screen-settings [data-back]').click();
  await page.waitForSelector('#screen-settings', { state: 'hidden' });
}

// Next move: screen points of a legal pair's tokens, or what to press instead.
const nextMove = (page) => page.evaluate(async () => {
  const { listLegalPairs, canAddRows } = await import('./js/rules.js');
  const g = window.__pairsum, s = g.session.state, r = g.renderer;
  if (!s || s.status !== 'active' || g.session.machine !== 'active') return { results: !document.getElementById('btn-retry').closest('[hidden]') };
  const ok = (i) => r.tokens.has(i) && !r.tokens.get(i).dying;
  const pair = listLegalPairs(s).find((p) => ok(p.a) && ok(p.b));
  if (!pair) return { add: canAddRows(s) };
  const at = (i) => {
    const v = r.tokens.get(i).mesh.position.clone().project(r.camera);
    const rect = r.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  };
  return { a: at(pair.a), b: at(pair.b) };
});

export async function start(page) {
  await page.click('#btn-play');
  await page.locator('.mode-card').filter({ has: page.locator('h3', { hasText: /Practice/ }) }).click();
  await page.waitForSelector('#screen-setup:not([hidden])');
  await page.locator('.diff-btn').last().click();
  await page.click('#btn-setup-start');
  await page.waitForFunction(() => window.__pairsum.session.machine === 'active', null, { timeout: 15000 });
  let open = true;
  page.once('close', () => { open = false; });
  (async () => {
    while (open) {
      try {
        const m = await nextMove(page);
        if (m.a) {
          await page.mouse.click(m.a.x, m.a.y);
          await page.waitForTimeout(120);
          await page.mouse.click(m.b.x, m.b.y);
        } else if (m.add) await page.click('#btn-addrows', { timeout: 2000 });
        else if (m.results) await page.click('#btn-retry', { timeout: 2000 });
      } catch (e) { if (!open) return; if (process.env.BENCH_DEBUG) console.error(e.message); }
      await page.waitForTimeout(400).catch(() => {});
    }
  })();
  await page.waitForTimeout(1500);
}
