// Pair Sum — platform adapter.
// Local-first: guest practice works fully offline after load. When hosted
// (StarHermit-style), the same-origin /api routes provide server time,
// leaderboards, cloud saves, presence and telemetry. Tokens never persist to
// local storage; structured {"error":...} responses and rate limits are
// recoverable UI states.

const LS_PREFIX = 'pairsum:';

export class Platform {
  constructor() {
    this.hosted = false;
    this.offsetMs = 0;           // server-time offset (round-trip adjusted)
    this.launchToken = null;     // short-lived; read from launch, never stored
    this.consent = { telemetry: false };
    this.leaderboardCache = new Map();
    this._hb = null;
  }

  // --- bootstrap ---------------------------------------------------------------

  async init() {
    this.readLaunchToken();
    this.settings = this.loadLocal('settings') || defaultSettings();
    this.profile = this.loadLocal('profile') || {
      name: 'Guest', guest: true, createdAt: Date.now(),
    };
    this.progress = this.loadLocal('progress') || {
      v: 1, journey: {}, achievements: {}, totals: { pairs: 0, clears: 0 },
      streakDays: [], bestDaily: {}, mastery: {},
    };
    this.results = this.loadLocal('results') || [];
    await this.detectHost();
    return this;
  }

  readLaunchToken() {
    // The host shell injects a short-lived launch token in the URL; the game
    // scope (slug) is read from it rather than hard-coded. Never persisted.
    const params = new URLSearchParams(location.search);
    this.launchToken = params.get('launch') || null;
    if (this.launchToken && history.replaceState) {
      history.replaceState(null, '', location.pathname); // strip from address bar
    }
  }

  async detectHost() {
    try {
      const t0 = Date.now();
      const res = await fetch('/api/v1/time', { signal: AbortSignal.timeout(2500) });
      const t1 = Date.now();
      if (!res.ok) throw new Error(`time ${res.status}`);
      const body = await res.json();
      if (typeof body.now !== 'number') throw new Error('bad time payload');
      // Round-trip-adjusted offset: assume symmetric latency.
      this.offsetMs = body.now - (t0 + (t1 - t0) / 2);
      this.hosted = true;
    } catch {
      this.hosted = false;
      this.offsetMs = 0;
    }
  }

  serverNow() {
    return Date.now() + this.offsetMs;
  }

  serverOffsetMs() {
    return this.offsetMs;
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
    if (this.hosted) this.cloudSave(this.progress).catch(() => {});
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
    const res = await fetch(`/api/v1${path}`, {
      headers: { 'content-type': 'application/json' },
      ...opts,
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

  async cloudSave(doc) {
    if (!this.hosted) return null;
    return this.api('/save', { method: 'POST', body: { game: 'pair-sum', doc } });
  }

  async cloudLoad() {
    if (!this.hosted) return null;
    try {
      const res = await this.api('/save?game=pair-sum');
      return res.doc || null;
    } catch {
      return null;
    }
  }

  // Merge local + cloud progression. Both snapshots preserved on conflict.
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
      await this.cloudSave(this.progress);
      return { source: 'local-wins' };
    }
    return { source: 'same' };
  }

  // --- results / leaderboards ---------------------------------------------------------

  recordResult(result, envelope) {
    this.results.push(result);
    if (this.results.length > 200) this.results = this.results.slice(-200);
    this.saveLocal('results', this.results);
    this.updateProgressFromResult(result);
    if (this.hosted && (result.mode === 'daily' || result.mode === 'challenge' || result.mode === 'score')) {
      this.api('/leaderboard/submit', { method: 'POST', body: { result, envelope } })
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
    // Local leaderboard always available; hosted adds global/friends boards.
    const local = this.results
      .filter((r) => boardMatches(board, r))
      .sort((a, b) => b.score.total - a.score.total)
      .slice(0, 50)
      .map((r) => ({ name: this.profile.name, me: true, ...publicEntry(r) }));
    if (!this.hosted) return { source: 'local', entries: local, label: 'casual (local)' };
    try {
      const res = await this.api(`/leaderboard?board=${encodeURIComponent(board)}${friends ? '&friends=1' : ''}`);
      return { source: 'global', entries: res.entries, label: res.validated ? 'validated' : 'casual' };
    } catch (e) {
      return { source: 'local', entries: local, label: 'casual (local)', error: e.message };
    }
  }

  // --- presence + telemetry -----------------------------------------------------------

  startPresence() {
    if (!this.hosted || this._hb) return;
    const beat = () => this.api('/presence', { method: 'POST', body: { game: 'pair-sum' } }).catch(() => {});
    beat();
    this._hb = setInterval(beat, 30000); // throttled heartbeats while playing
  }

  stopPresence() {
    clearInterval(this._hb);
    this._hb = null;
  }

  track(eventName, data = {}) {
    // Anonymous funnel events only; no raw text or personal data.
    const ALLOWED = ['start', 'tutorial-step', 'round-end', 'retry', 'settings-change', 'error'];
    if (!ALLOWED.includes(eventName)) return;
    if (!this.consent.telemetry || !this.hosted) return;
    this.api('/events', { method: 'POST', body: { game: 'pair-sum', event: eventName, data } })
      .catch(() => {});
  }

  async activityStart() {
    if (!this.hosted) return;
    try { await this.api('/activity/start', { method: 'POST', body: { game: 'pair-sum' } }); } catch {}
  }

  async activityEnd() {
    if (!this.hosted) return;
    try { await this.api('/activity/end', { method: 'POST', body: { game: 'pair-sum' } }); } catch {}
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
