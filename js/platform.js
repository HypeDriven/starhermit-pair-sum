// Pair Sum — platform adapter.
// Local-first: guest practice works fully offline after load. When hosted
// (StarHermit), a launch token read from the URL fragment authenticates
// same-origin /api calls: profile nickname, cloud saves, read-only
// leaderboards. Tokens never persist to local storage; structured
// {"error":...} responses and rate limits are recoverable UI states.
// Presence/telemetry/activity and validated score submission target only the
// game's own dev server (npm start on localhost) — the platform has no such
// per-game routes.

const LS_PREFIX = 'pairsum:';

export class Platform {
  constructor() {
    this.hosted = false;         // true iff a launch token was read
    this.localDev = false;       // own dev server (localhost, no token)
    this.offsetMs = 0;           // server-time offset (round-trip adjusted)
    this.launchToken = null;     // short-lived; read from launch, never stored
    this.userId = null;          // JWT sub
    this.gameSlug = null;        // JWT game_scope; never hard-coded
    this.nickname = null;        // platform display name (NEVER username)
    this.gameInfo = null;        // GET /api/v1/games/{slug} cache
    this.syncState = 'offline';  // offline | saving | synced | error
    this.consent = { telemetry: false };
    this._names = new Map();     // userId -> nickname cache
    this._cloudTimer = null;
    this._cloudFlushing = false;
    this._cloudAgain = false;
    this._refreshTimer = null;
    this._hb = null;
  }

  // --- bootstrap ---------------------------------------------------------------

  async init() {
    this.readLaunchToken();
    this.localDev = !this.hosted && isLocalHost(location.hostname);
    this.settings = this.loadLocal('settings') || defaultSettings();
    this.profile = this.loadLocal('profile') || {
      name: 'Guest', guest: true, createdAt: Date.now(),
    };
    this.progress = this.loadLocal('progress') || {
      v: 1, journey: {}, achievements: {}, totals: { pairs: 0, clears: 0 },
      streakDays: [], bestDaily: {}, mastery: {},
    };
    this.results = this.loadLocal('results') || [];
    this.syncClock();
    if (this.hosted) {
      this.syncState = 'synced'; // local cache is authoritative until a save runs
      this.scheduleTokenRefresh();
      window.addEventListener('pagehide', () => { this.flushCloudSave(); });
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.flushCloudSave();
      });
      await this.fetchProfile().catch(() => {});
    }
    return this;
  }

  readLaunchToken() {
    // The host appends a short-lived launch token to the URL fragment
    // (#game_token=<jwt>[&session_id=<guid>]). Read it once, then strip it.
    let token = null;
    if (location.hash.length > 1) {
      const frag = new URLSearchParams(location.hash.slice(1));
      token = frag.get('game_token');
      if (token && history.replaceState) {
        history.replaceState(null, '', location.pathname + location.search);
      }
    }
    // Local-dev fallback only: ?launch= / ?token= / ?game_token=.
    if (!token) {
      const params = new URLSearchParams(location.search);
      token = params.get('launch') || params.get('token') || params.get('game_token');
      if (token && history.replaceState) {
        history.replaceState(null, '', location.pathname + location.hash);
      }
    }
    this.launchToken = token;
    this.hosted = !!token; // hosted mode activates iff a token was read
    if (!token) return;
    const payload = decodeLaunchToken(token);
    if (payload?.sub) this.userId = payload.sub;
    if (payload?.game_scope) this.gameSlug = payload.game_scope;
  }

  async syncClock() {
    // Server time keeps daily boundaries/countdowns honest. On failure the
    // local clock is used. Never gates hosted mode — hosted iff a token read.
    if (!this.hosted && !this.localDev) return;
    try {
      const t0 = Date.now();
      const res = await fetch('/api/v1/time', { signal: AbortSignal.timeout(2500) });
      const t1 = Date.now();
      if (!res.ok) throw new Error(`time ${res.status}`);
      const body = await res.json();
      if (typeof body.now !== 'number') throw new Error('bad time payload');
      // Round-trip-adjusted offset: assume symmetric latency.
      this.offsetMs = body.now - (t0 + (t1 - t0) / 2);
    } catch {
      this.offsetMs = 0;
    }
  }

  serverNow() {
    return Date.now() + this.offsetMs;
  }

  serverOffsetMs() {
    return this.offsetMs;
  }

  // --- identity ----------------------------------------------------------------

  async fetchProfile() {
    // Nickname for display; NEVER GET /api/v1/me (403 for launch tokens) and
    // never surface usernames. Fallback: "Player " + id.slice(0, 8).
    if (!this.userId) return;
    let name = null;
    try {
      const p = await this.api(`/users/${encodeURIComponent(this.userId)}/profile`);
      if (p && typeof p.nickname === 'string' && p.nickname.trim()) {
        name = p.nickname.trim().slice(0, 24);
      }
    } catch { /* fall through to the id-based fallback */ }
    if (!name) name = 'Player ' + String(this.userId).slice(0, 8);
    this.nickname = name;
    this.profile = { ...this.profile, name, guest: false, platformId: this.userId };
    this.saveProfile();
  }

  async displayNameFor(userId) {
    if (userId == null || userId === '') return '—';
    if (this._names.has(userId)) return this._names.get(userId);
    let name = null;
    try {
      const p = await this.api(`/users/${encodeURIComponent(userId)}/profile`);
      if (p && typeof p.nickname === 'string' && p.nickname.trim()) name = p.nickname.trim();
    } catch { /* offline-tolerant: fall back below */ }
    if (!name) name = 'Player ' + String(userId).slice(0, 8);
    this._names.set(userId, name);
    return name;
  }

  scheduleTokenRefresh() {
    // Tokens live 60 min; re-mint at 45 min, retry failures in ~60 s.
    if (!this.hosted || !this.gameSlug) return;
    clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(() => this.refreshLaunchToken(), 45 * 60 * 1000);
  }

  async refreshLaunchToken() {
    try {
      const res = await this.api(`/games/${encodeURIComponent(this.gameSlug)}/launch-token`, {
        method: 'POST',
      });
      if (res && typeof res.token === 'string' && res.token) {
        this.launchToken = res.token;
        const payload = decodeLaunchToken(res.token);
        if (payload?.sub) this.userId = payload.sub;
        if (payload?.game_scope) this.gameSlug = payload.game_scope;
        if (payload?.sub && !this.nickname) await this.fetchProfile().catch(() => {});
      }
    } catch {
      this._refreshTimer = setTimeout(() => this.refreshLaunchToken(), 60 * 1000);
      return;
    }
    this.scheduleTokenRefresh();
  }

  // --- local persistence ---------------------------------------------------------

  saveLocal(key, value) {
    try {
      const k = key.startsWith(LS_PREFIX) ? key : LS_PREFIX + key;
      if (value === null || value === undefined) localStorage.removeItem(k);
      else localStorage.setItem(k, JSON.stringify(value));
    } catch { /* storage full/blocked: play session continues without saves */ }
  }

  loadLocal(key) {
    try {
      const k = key.startsWith(LS_PREFIX) ? key : LS_PREFIX + key;
      const raw = localStorage.getItem(k);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  saveSettings() { this.saveLocal('settings', this.settings); }
  saveProfile() { this.saveLocal('profile', this.profile); }

  saveProgress() {
    // Versioned, checksummed progression document.
    this.progress.v = 1;
    const body = JSON.stringify(this.progress);
    let sum = 0;
    for (let i = 0; i < body.length; i++) sum = (sum + body.charCodeAt(i) * (i + 1)) % 1000003;
    this.saveLocal('progress', this.progress);
    this.saveLocal('progress:checksum', sum);
    this.scheduleCloudSave();
  }

  verifyProgress() {
    const sum = this.loadLocal('progress:checksum');
    if (sum == null) return true; // nothing stored yet
    const body = JSON.stringify(this.progress);
    let calc = 0;
    for (let i = 0; i < body.length; i++) calc = (calc + body.charCodeAt(i) * (i + 1)) % 1000003;
    if (calc !== sum) {
      // Corrupted local copy: keep it aside and start clean rather than crash.
      this.saveLocal('progress:corrupt', this.progress);
      this.progress = { v: 1, journey: {}, achievements: {}, totals: { pairs: 0, clears: 0 }, streakDays: [], bestDaily: {}, mastery: {} };
      return false;
    }
    return true;
  }

  // --- hosted API -------------------------------------------------------------------

  async api(path, opts = {}) {
    const headers = { 'content-type': 'application/json', ...(opts.headers || {}) };
    // The host-issued launch token authenticates every REST call; it lives only
    // in memory and is never persisted (spec: never store tokens).
    if (this.launchToken) headers.authorization = `Bearer ${this.launchToken}`;
    const res = await fetch(`/api/v1${path}`, {
      ...opts,
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 429) {
      const err = new Error('rate-limited');
      err.recoverable = true;
      err.retryAfter = Number(res.headers.get('retry-after')) || 5;
      throw err;
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(body.error || `http-${res.status}`);
      err.structured = !!body.error;
      throw err;
    }
    return body;
  }

  setSync(state) {
    if (this.syncState === state) return;
    this.syncState = state;
    this.onSyncChange?.();
  }

  // --- cloud save (one slot; zip+base64; localStorage stays the offline cache) ----

  async cloudSave(doc) {
    if (!this.hosted || !this.gameSlug) return null;
    const zip = zipStore('progress.json', new TextEncoder().encode(JSON.stringify(doc)));
    return this.api(`/me/cloud-saves/${encodeURIComponent(this.gameSlug)}`, {
      method: 'PUT',
      body: { dataBase64: bytesToBase64(zip) },
    });
  }

  scheduleCloudSave() {
    if (!this.hosted || !this.gameSlug) return;
    this.setSync('saving');
    clearTimeout(this._cloudTimer);
    this._cloudTimer = setTimeout(() => this.flushCloudSave(), 2000);
  }

  async flushCloudSave() {
    clearTimeout(this._cloudTimer);
    if (!this.hosted || !this.gameSlug) return;
    if (this._cloudFlushing) { this._cloudAgain = true; return; }
    this._cloudFlushing = true;
    try {
      await this.cloudSave(this.progress);
      this.setSync('synced');
    } catch {
      // Local cache intact; the next saveProgress retries.
      this.setSync(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'error');
    } finally {
      this._cloudFlushing = false;
      if (this._cloudAgain) { this._cloudAgain = false; this.scheduleCloudSave(); }
    }
  }

  async cloudLoad() {
    if (!this.hosted || !this.gameSlug) return null;
    try {
      const res = await fetch(`/api/v1/me/cloud-saves/${encodeURIComponent(this.gameSlug)}`, {
        headers: { authorization: `Bearer ${this.launchToken}` },
        signal: AbortSignal.timeout(10000),
      });
      if (res.status === 404) return null; // no cloud save yet
      if (!res.ok) throw new Error(`http-${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      return JSON.parse(new TextDecoder().decode(unzipFirstEntry(bytes)));
    } catch {
      return null; // offline-tolerant: local cache continues the session
    }
  }

  // Merge local + cloud progression. Both snapshots preserved on conflict;
  // the remote copy wins when it is ahead (or when neither is a descendant).
  async reconcileProgress() {
    const remote = await this.cloudLoad();
    if (!remote) return { source: 'local' };
    const localRev = this.progress.rev || 0;
    const remoteRev = remote.rev || 0;
    if (remoteRev > localRev) {
      this.saveLocal('progress:pre-reconcile', this.progress); // preserve both
      this.progress = remote;
      this.saveProgress();
      return { source: 'cloud' };
    }
    if (localRev > remoteRev) {
      await this.cloudSave(this.progress).then(
        () => this.setSync('synced'),
        () => this.setSync('error'),
      );
      return { source: 'local-wins' };
    }
    return { source: 'same' };
  }

  // --- results / leaderboards ---------------------------------------------------------

  recordResult(result, envelope) {
    // Personal bests are kept locally and travel inside the cloud-saved doc.
    // Clients can never submit to a platform leaderboard (script-owned); the
    // envelope only feeds the own dev server's replay validation (localDev).
    this.results.push(result);
    if (this.results.length > 200) this.results = this.results.slice(-200);
    this.saveLocal('results', this.results);
    this.updateProgressFromResult(result);
    if (this.localDev && (result.mode === 'daily' || result.mode === 'challenge' || result.mode === 'score')) {
      this.api('/leaderboard/submit', { method: 'POST', body: { result, envelope, name: this.profile?.name } })
        .catch(() => { /* offline-tolerant: local record already kept */ });
    }
  }

  updateProgressFromResult(r) {
    const p = this.progress;
    p.rev = (p.rev || 0) + 1;
    if (r.status === 'won') {
      p.totals.clears += 1;
      p.totals.pairs += r.moves;
      const day = new Date(this.serverNow()).toISOString().slice(0, 10);
      if (!p.streakDays.includes(day)) p.streakDays.push(day);
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
      if (r.mode === 'daily') {
        const cur = p.bestDaily[r.contentId] || 0;
        p.bestDaily[r.contentId] = Math.max(cur, r.score.total);
      }
      // Mastery stages: id by title check via def id pattern journey-N mastery
      // handled by caller through achievements.
    } else {
      p.totals.pairs += r.moves;
    }
    this.checkAchievements(r);
    this.saveProgress();
  }

  checkAchievements(r) {
    // Achievements stay local (part of the cloud-saved doc); a pure browser
    // game has no server-authoritative unlock path.
    const p = this.progress;
    const grant = (key) => {
      if (p.achievements[key]) return null; // idempotent
      p.achievements[key] = { at: Date.now() };
      return key;
    };
    const newly = [];
    const push = (k) => { const g = grant(k); if (g) newly.push(g); };
    if (r.status === 'won') push('first_clear');
    if (r.status === 'won' && r.pathTallies && r.pathTallies.row > 0 && r.pathTallies.col > 0 && r.pathTallies.seq > 0) {
      push('mechanic_master');
    }
    if (p.streakDays.length >= 7) push('streak_7');
    if (r.status === 'won' && r.mode === 'journey' && /-(8|16|24|32|40)$/.test(r.contentId)) push('mastery_stage');
    if (p.totals.pairs >= 1000) push('thousand_pairs');
    if (newly.length) this.onAchievements?.(newly);
    return newly;
  }

  async leaderboard(board, { friends = false } = {}) {
    // Local leaderboard always available; hosted adds a read-only global
    // board from the platform. Journey/practice results never leave the
    // device, so those boards are always local.
    const local = this.results
      .filter((r) => boardMatches(board, r))
      .sort((a, b) => b.score.total - a.score.total)
      .slice(0, 50)
      .map((r) => ({ name: this.profile.name, me: true, ...publicEntry(r) }));
    if (board === 'journey' || board === 'practice') {
      return { source: 'local', entries: local, label: 'casual (local)' };
    }
    if (this.localDev) {
      // Own dev server only: read the replay-validated board.
      try {
        const res = await this.api(`/leaderboard?board=${encodeURIComponent(board)}${friends ? '&friends=1' : ''}`);
        return { source: 'global', entries: res.entries, label: res.validated ? 'validated' : 'casual' };
      } catch (e) {
        return { source: 'local', entries: local, label: 'casual (local)', error: e.message };
      }
    }
    if (!this.hosted) {
      return { source: 'local', entries: local, label: 'casual (local)' };
    }
    try {
      this.gameInfo = this.gameInfo ||
        await this.api(`/games/${encodeURIComponent(this.gameSlug)}`);
      const lbId = this.gameInfo.leaderboardId;
      if (!lbId) return { source: 'local', entries: local, label: 'casual (local)' };
      const q = `friendsOnly=${friends ? '1' : ''}&page=1&pageSize=50`;
      const res = await this.api(`/leaderboards/${encodeURIComponent(lbId)}/entries?${q}`);
      const entries = await Promise.all((res.entries || []).map((e) => this.publicLeaderboardEntry(e)));
      return { source: 'global', entries, label: 'global (read-only)' };
    } catch (e) {
      return { source: 'local', entries: local, label: 'casual (local)', error: e.message };
    }
  }

  async publicLeaderboardEntry(e) {
    const userId = e.userId ?? e.user_id ?? null;
    return {
      name: await this.displayNameFor(userId),
      me: userId != null && userId === this.userId,
      score: e.score ?? 0,
      moves: e.moves ?? null,
      invalid: e.invalid ?? null,
      elapsedMs: e.elapsedMs ?? null,
      status: e.status ?? null,
      seed: e.seed, rulesV: e.rulesV, contentV: e.contentV,
    };
  }

  // --- presence + telemetry (own dev server only) -------------------------------------

  startPresence() {
    if (!this.localDev || this._hb) return;
    const beat = () => this.api('/presence', { method: 'POST', body: { game: this.gameSlug || 'pair-sum' } }).catch(() => {});
    beat();
    this._hb = setInterval(beat, 30000); // throttled heartbeats while playing
  }

  stopPresence() {
    clearInterval(this._hb);
    this._hb = null;
  }

  track(eventName, data = {}) {
    // Anonymous funnel events only; no raw text or personal data. The platform
    // has no per-game telemetry route, so this fires at the dev server only.
    const ALLOWED = ['start', 'tutorial-step', 'round-end', 'retry', 'settings-change', 'error'];
    if (!ALLOWED.includes(eventName)) return;
    if (!this.consent.telemetry || !this.localDev) return;
    this.api('/events', { method: 'POST', body: { game: this.gameSlug || 'pair-sum', event: eventName, data } })
      .catch(() => {});
  }

  async activityStart() {
    if (!this.localDev) return;
    try { await this.api('/activity/start', { method: 'POST', body: { game: this.gameSlug || 'pair-sum' } }); } catch {}
  }

  async activityEnd() {
    if (!this.localDev) return;
    try { await this.api('/activity/end', { method: 'POST', body: { game: this.gameSlug || 'pair-sum' } }); } catch {}
  }
}

function isLocalHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' ||
    hostname === '[::1]' || hostname === '::1';
}

function decodeLaunchToken(token) {
  // base64url-decode the JWT payload (no signature verification needed:
  // the API validates the token on every call).
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
    return json && typeof json === 'object' ? json : null;
  } catch {
    return null;
  }
}

function publicEntry(r) {
  return {
    score: r.score.total, moves: r.moves, invalid: r.invalid,
    elapsedMs: r.elapsedMs, status: r.status,
    seed: r.seed, rulesV: r.rulesV, contentV: r.contentV,
    assists: r.assists, durationMs: r.durationMs,
  };
}

function boardMatches(board, r) {
  if (board === 'daily') return r.mode === 'daily';
  if (board === 'journey') return r.mode === 'journey' && r.status === 'won';
  if (board === 'challenge') return r.mode === 'challenge';
  if (board.startsWith('daily:')) return r.contentId === board.slice(6);
  return r.mode === board;
}

// Minimal ZIP writer/reader (stored entries only, no compression).
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zipStore(name, dataBytes) {
  const enc = new TextEncoder();
  const nameB = enc.encode(name);
  const crc = crc32(dataBytes);
  const out = [];
  const u16 = (v) => out.push(v & 0xff, (v >> 8) & 0xff);
  const u32 = (v) => out.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  u32(0x04034b50); u16(20); u16(0); u16(0); u16(0); u16(0);
  u32(crc); u32(dataBytes.length); u32(dataBytes.length);
  u16(nameB.length); u16(0);
  const local = out.length;
  const head = new Uint8Array(out);
  const cd = [];
  const c16 = (v) => cd.push(v & 0xff, (v >> 8) & 0xff);
  const c32 = (v) => cd.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  c32(0x02014b50); c16(20); c16(20); c16(0); c16(0); c16(0); c16(0);
  c32(crc); c32(dataBytes.length); c32(dataBytes.length);
  c16(nameB.length); c16(0); c16(0); c16(0); c16(0); c32(0); c32(0); // attrs + local-header offset
  const cdHead = new Uint8Array(cd);
  const cdOff = head.length + nameB.length + dataBytes.length;
  const parts = [head, nameB, dataBytes, cdHead, nameB];
  const eocd = [];
  const e32 = (v) => eocd.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  const e16 = (v) => eocd.push(v & 0xff, (v >> 8) & 0xff);
  e32(0x06054b50); e16(0); e16(0); e16(1); e16(1);
  e32(cdHead.length + nameB.length); e32(cdOff); e16(0);
  parts.push(new Uint8Array(eocd));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.length; }
  return buf;
}
function unzipFirstEntry(zipBytes) {
  // Stored single-entry reader: scan local headers for compression 0.
  const dv = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  let off = 0;
  while (off + 30 <= zipBytes.length && dv.getUint32(off, true) === 0x04034b50) {
    const method = dv.getUint16(off + 8, true);
    const size = dv.getUint32(off + 18, true);
    const nameLen = dv.getUint16(off + 26, true);
    const extraLen = dv.getUint16(off + 28, true);
    const dataOff = off + 30 + nameLen + extraLen;
    if (method !== 0) throw new Error('unsupported zip entry');
    return zipBytes.slice(dataOff, dataOff + size);
  }
  throw new Error('bad zip');
}
function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function base64ToBytes(b64) {
  const s = atob(b64);
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}

export function defaultSettings() {
  return {
    v: 1,
    theme: 'notebook',
    quality: 'medium',
    muted: false,
    volMusic: 0.5, volEffects: 0.8, volAmbience: 0.4, volVoice: 0.8,
    captions: false,
    reducedMotion: false,
    highContrast: false,
    palette: 'default',       // default | deuteranopia | protanopia | tritanopia
    largeText: false,
    leftHanded: false,
    holdToConfirm: false,     // hold-versus-toggle
    haptics: true,
    timingAssist: false,      // +50% on time limits
    cameraTilt: 'standard',
    tutorialsDone: {},
    bindings: null,           // player overrides for desktop action bindings
    telemetryConsent: false,
  };
}
