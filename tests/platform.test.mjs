// Platform adapter over the shared StarHermit SDK: launch token, profile
// name, game:<slug> cloud-save round-trip, settings KV, controls, and no
// network at all when standalone.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Load the shipped SDK copy as a classic script (the package is ESM).
const sdkModule = { exports: {} };
new Function('module', 'self', fs.readFileSync(new URL('../starhermit-sdk.js', import.meta.url), 'utf8'))(sdkModule, globalThis);
const SDK = sdkModule.exports;
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = 'h.' + b64u({ sub: 'user-123456', game_scope: 'ps-slug', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.s';

// SDK renewal timers must not keep the test process alive.
const unrefTimeout = (f, ms) => { const t = setTimeout(f, ms); t.unref(); return t; };

function fakeServer() {
  const calls = [], saves = {}, kv = {}, etags = {};
  let version = 0;
  const fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push([method, url]);
    const r = (status, body) => new Response(body == null ? null : body, { status });
    if (url.includes('/cloud-saves/')) {
      // Conditional writes like the platform: If-Match / If-None-Match after a
      // load, 412 with the current etag when stale, { etag } on success.
      const tail = decodeURIComponent(url.split('/cloud-saves/')[1]);
      const key = tail.replace(/\/info$/, '');
      const h = new Headers(init.headers || {});
      if (tail.endsWith('/info')) return r(200, JSON.stringify(saves[key] ? { exists: true, etag: etags[key] } : { exists: false }));
      if (method === 'PUT') {
        if ((h.get('If-Match') && h.get('If-Match') !== etags[key]) || (h.get('If-None-Match') === '*' && saves[key])) return r(412, JSON.stringify({ etag: etags[key] || null }));
        saves[key] = Buffer.from(JSON.parse(init.body).dataBase64, 'base64');
        etags[key] = '"v' + (++version) + '"';
        return r(200, JSON.stringify({ etag: etags[key] }));
      }
      return saves[key] ? r(200, saves[key]) : r(404);
    }
    if (url.endsWith('/profile')) return r(200, JSON.stringify({ username: 'u', nickname: 'Tess' }));
    if (url.endsWith('/settings') && method === 'PATCH') { Object.assign(kv, JSON.parse(init.body).settings); return r(200, '{}'); }
    if (url.endsWith('/settings')) return r(200, JSON.stringify({ settings: kv }));
    if (url.endsWith('/controls')) return r(200, JSON.stringify({ actions: [{ action: 'hint', codes: ['KeyJ'] }] }));
    return r(404);
  };
  return { calls, saves, kv, etags, fetch, bump(key) { etags[key] = '"v' + (++version) + '"'; } };
}

function install(hash, srv, hostname = 'ps-slug.starhermit.com') {
  const win = {
    location: { hash, search: '', pathname: '/', hostname, origin: 'https://' + hostname, href: 'https://' + hostname + '/' },
    history: { replaceState() {} },
    addEventListener() {},
  };
  win.StarHermit = SDK.create({ window: win, fetch: srv.fetch, setTimeout: unrefTimeout });
  globalThis.window = win;
  globalThis.location = win.location;
  globalThis.history = win.history;
  globalThis.fetch = srv.fetch; // any direct request is counted too
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  return win;
}

globalThis.document = { addEventListener() {}, hidden: false };
const tick = () => new Promise((r) => setTimeout(r, 15));

test('hosted: token, profile, cloud save game:<slug>, settings KV, controls', async () => {
  const srv = fakeServer();
  install('#game_token=' + token, srv, 'ps-slug.starhermit.com');
  const { Platform } = await import('../js/platform.js?hosted');
  const P = await new Platform().init();
  assert.equal(P.hosted, true);
  assert.equal(P.userId, 'user-123456');
  assert.equal(P.gameSlug, 'ps-slug');
  assert.equal(P.nickname, 'Tess');
  assert.equal(P.profile.guest, false);

  P.progress.totals.clears = 5;
  P.progress.rev = 1;
  await P.flushCloudSave();
  assert.deepEqual(Object.keys(srv.saves), ['game:ps-slug']);
  assert.equal((await P.cloudLoad()).totals.clears, 5);

  P.settings.muted = true;
  P.saveSettings();
  await tick();
  assert.equal(srv.kv.muted, true);
  assert.equal('tutorialsDone' in srv.kv, false);
  srv.kv.palette = 'tritanopia';
  assert.equal(await P.loadPlatformSettings(), true);
  assert.equal(P.settings.palette, 'tritanopia');

  assert.deepEqual(await P.loadBindings({ hint: ['KeyH'], undo: ['KeyU'] }), { hint: ['KeyJ'], undo: ['KeyU'] });
  assert.ok(P.inviteLink().endsWith('/game-invite/user-123456/ps-slug'));
  assert.equal(P.canSignIn(), false);
  // own-server routes are never called
  assert.ok(!srv.calls.some(([, u]) => /\/time|\/presence|\/activity/.test(u)));
});

test('standalone: no token means no fetch at all (even on localhost)', async () => {
  const srv = fakeServer();
  install('', srv, 'localhost');
  const { Platform } = await import('../js/platform.js?standalone');
  const P = await new Platform().init();
  assert.equal(P.hosted, false);
  assert.equal(P.nickname, null);
  P.saveProgress();
  await P.flushCloudSave();
  assert.equal(await P.cloudLoad(), null);
  P.saveSettings();
  assert.equal(await P.loadPlatformSettings(), false);
  assert.deepEqual(await P.loadBindings({ hint: ['KeyH'] }), { hint: ['KeyH'] });
  assert.equal(P.inviteLink(), null);
  assert.equal(P.canSignIn(), false);
  assert.equal((await P.leaderboard('daily')).source, 'local');
  await tick();
  assert.equal(srv.calls.length, 0);
});

test('sign-in is offered on a StarHermit UUID host without a token', async () => {
  const srv = fakeServer();
  install('', srv, '0b9d6f2e-3c4a-4e5b-9a7c-1d2e3f405162.starhermit.com');
  const { Platform } = await import('../js/platform.js?uuid');
  const P = await new Platform().init();
  assert.equal(P.canSignIn(), true);
});

test('cloud-save conflict: a write that lost to another device re-reads, merges and saves again', async () => {
  const srv = fakeServer();
  const win = install('#game_token=' + token, srv, 'ps-slug.starhermit.com');
  const { Platform } = await import('../js/platform.js?conflict');
  const P = await new Platform().init();
  P.progress.journey['journey-1'] = { done: true, best: 300, stars: 2 };
  P.progress.totals = { pairs: 40, clears: 2 };
  await P.reconcileProgress();                     // empty slot; writes are conditional from now on
  await P.flushCloudSave();
  const other = { v: 1, rev: 9, journey: { 'journey-1': { done: true, best: 500, stars: 1 }, 'journey-2': { done: true, best: 200, stars: 3 } },
    achievements: { first_clear: { at: 1 } }, totals: { pairs: 90, clears: 5 }, streakDays: ['2026-10-01'], bestDaily: { 'daily-2026-10-01': 700 }, mastery: {} };
  srv.saves['game:ps-slug'] = Buffer.from(await win.StarHermit._zip('save.json', new TextEncoder().encode(JSON.stringify(other))));
  srv.bump('game:ps-slug');
  P.progress.streakDays = ['2026-10-02'];
  let merged = 0;
  P.onProgressMerged = () => { merged++; };
  P.saveProgress();
  await P.flushCloudSave();                        // 412 → saveconflict → reconcile
  for (let i = 0; i < 40 && !merged; i++) await tick();
  await P.flushCloudSave();
  const stored = JSON.parse(new TextDecoder().decode(await win.StarHermit._unzip(srv.saves['game:ps-slug'])));
  assert.deepEqual(stored.journey['journey-1'], { done: true, best: 500, stars: 2 });
  assert.equal(stored.journey['journey-2'].stars, 3);
  assert.deepEqual(stored.totals, { pairs: 90, clears: 5 });
  assert.deepEqual(stored.streakDays, ['2026-10-01', '2026-10-02']);
  assert.equal(stored.bestDaily['daily-2026-10-01'], 700);
  assert.ok(stored.achievements.first_clear);
});
