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
  const calls = [], saves = {}, kv = {};
  const fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push([method, url]);
    const r = (status, body) => new Response(body == null ? null : body, { status });
    if (url.includes('/cloud-saves/')) {
      const key = decodeURIComponent(url.split('/cloud-saves/')[1]);
      if (method === 'PUT') { saves[key] = Buffer.from(JSON.parse(init.body).dataBase64, 'base64'); return r(200, '{}'); }
      return saves[key] ? r(200, saves[key]) : r(404);
    }
    if (url.endsWith('/profile')) return r(200, JSON.stringify({ username: 'u', nickname: 'Tess' }));
    if (url.endsWith('/settings') && method === 'PATCH') { Object.assign(kv, JSON.parse(init.body).settings); return r(200, '{}'); }
    if (url.endsWith('/settings')) return r(200, JSON.stringify({ settings: kv }));
    if (url.endsWith('/controls')) return r(200, JSON.stringify({ actions: [{ action: 'hint', codes: ['KeyJ'] }] }));
    return r(404);
  };
  return { calls, saves, kv, fetch };
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
