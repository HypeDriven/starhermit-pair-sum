// Pair Sum — platform adapter.
// Local-first: guest practice works fully offline after load. StarHermit goes
// through the shared SDK (starhermit-sdk.js, window.StarHermit): it reads the
// launch token (#game_token / #access_token, stripped after read), renews it,
// and owns the `game:<slug>` cloud-save slot, the settings KV, controls,
// read-only leaderboards and the invite link. Hosted mode = the SDK holds a
// token; without one no request is made at all. The game never calls its own
// server routes (/api, /ws): the device clock is authoritative and boards,
// achievements and stats are local.

const sdk = () => (typeof window !== 'undefined' && window.StarHermit) || globalThis.StarHermit || null;

// Player preferences mirrored to the StarHermit settings KV (progress-like
// fields such as tutorialsDone stay in the local/cloud documents).
const KV_KEYS = ['theme', 'graphics', 'muted', 'volMusic', 'volEffects', 'volAmbience', 'volVoice', 'captions',
  'reducedMotion', 'highContrast', 'palette', 'largeText', 'leftHanded', 'holdToConfirm', 'haptics',
  'timingAssist', 'cameraTilt'];

const LS_PREFIX = 'pairsum:';

export class Platform {
  constructor() {
    this.nickname = null;        // platform display name (nickname, never username)
    this.avatarUrl = null;
    this.onAuth = null;          // ({ signedIn }) after a sign-out (refused renewal)
    this.syncState = 'offline';  // offline | saving | synced | error
    this._cloudTimer = null;
    this._cloudFlushing = false;
    this._cloudAgain = false;
    this._kvSig = null;
  }

  /** true iff the SDK holds a launch token */
  get hosted() { const s = sdk(); return !!(s && s.signedIn && s.slug); }
  get userId() { return this.hosted ? sdk().userId : null; }
  get gameSlug() { const s = sdk(); return s ? s.slug : null; }

  // --- bootstrap ---------------------------------------------------------------

  async init() {
    const sh = sdk();
    if (sh && !this._inited) {
      this._inited = true;
      sh.init();
      let was = this.hosted;
      sh.on('auth', (a) => {
        if (a.signedIn === was) return; // renewals change nothing visible
        was = a.signedIn;
        if (!a.signedIn) {
          this.nickname = null;
          this.avatarUrl = null;
          this.profile = { ...this.profile, guest: true };
          this.setSync('offline');
        }
        this.onAuth?.(a);
      });
    }
    this.settings = this.loadLocal('settings') || defaultSettings();
    this.profile = this.loadLocal('profile') || {
      name: 'Guest', guest: true, createdAt: Date.now(),
    };
    this.progress = this.loadLocal('progress') || {
      v: 1, journey: {}, achievements: {}, totals: { pairs: 0, clears: 0 },
      streakDays: [], bestDaily: {}, mastery: {},
    };
    this.results = this.loadLocal('results') || [];
    if (this.hosted) {
      this.syncState = 'synced'; // local cache is authoritative until a save runs
      window.addEventListener('pagehide', () => { this.flushCloudSave(); });
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.flushCloudSave();
      });
      await this.fetchProfile().catch(() => {});
    }
    return this;
  }

  // Device clock: there is no client-reachable time route.
  serverNow() {
    return Date.now();
  }

  serverOffsetMs() {
    return 0;
  }

  // --- identity ----------------------------------------------------------------

  async fetchProfile() {
    // Nickname for display (never /api/v1/me); fallback "Player " + id prefix.
    if (!this.hosted) return;
    const p = await sdk().profile();
    const name = (p ? p.displayName : 'Player ' + String(this.userId).slice(0, 6)).slice(0, 24);
    this.nickname = name;
    this.profile = { ...this.profile, name, guest: false, platformId: this.userId };
    this.saveProfile();
    sdk().avatarUrl().then((u) => { this.avatarUrl = u; this.onProfileChange?.(); }).catch(() => {});
  }

  async displayNameFor(userId) {
    if (userId == null || userId === '') return '—';
    const p = this.hosted ? await sdk().profile(String(userId)) : null;
    return p ? p.displayName : 'Player ' + String(userId).slice(0, 6);
  }

  // --- sign-in, invite, settings KV, controls ------------------------------------

  canSignIn() { const s = sdk(); return !!(s && s.canSignIn()); }
  signIn() { const s = sdk(); return !!(s && s.signIn()); }
  inviteLink() { return this.hosted ? sdk().inviteLink() : null; }

  pushPlatformSettings() {
    if (!this.hosted) return;
    const o = {};
    for (const k of KV_KEYS) o[k] = this.settings[k] ?? null;
    const sig = JSON.stringify(o);
    if (sig === this._kvSig) return;
    this._kvSig = sig;
    sdk().patchSettings(o);
  }

  /** Apply the account's settings KV (it wins over local values). Resolves true when anything changed. */
  async loadPlatformSettings() {
    if (!this.hosted) return false;
    const kv = await sdk().getSettings();
    let changed = false;
    for (const k of KV_KEYS) {
      if (kv?.[k] === undefined || kv[k] === null) continue;
      this.settings[k] = kv[k];
      changed = true;
    }
    if (changed) this.saveLocal('settings', this.settings);
    this._kvSig = JSON.stringify(Object.fromEntries(KV_KEYS.map((k) => [k, this.settings[k] ?? null])));
    return changed;
  }

  async loadBindings(defaults) {
    const copy = JSON.parse(JSON.stringify(defaults));
    if (!this.hosted) return copy;
    try { return await sdk().loadBindings(defaults); } catch { return copy; }
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

  saveSettings() { this.saveLocal('settings', this.settings); this.pushPlatformSettings(); }
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

  setSync(state) {
    if (this.syncState === state) return;
    this.syncState = state;
    this.onSyncChange?.();
  }

  // --- cloud save (one slot; zip+base64; localStorage stays the offline cache) ----

  async cloudSave(doc) {
    if (!this.hosted) return null;
    if (!(await sdk().writeSave(JSON.stringify(doc), { keepalive: true }))) throw new Error('cloud-save-failed');
    return true;
  }

  scheduleCloudSave() {
    if (!this.hosted) return;
    this.setSync('saving');
    clearTimeout(this._cloudTimer);
    this._cloudTimer = setTimeout(() => this.flushCloudSave(), 2000);
  }

  async flushCloudSave() {
    clearTimeout(this._cloudTimer);
    if (!this.hosted) return;
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
    if (!this.hosted) return null;
    return sdk().loadJSON(); // null when none / unreachable: the local cache continues
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

  recordResult(result) {
    // Personal bests are kept locally and travel inside the cloud-saved doc.
    // Signed-in ranked rounds are also posted through submitScore() below.
    this.results.push(result);
    if (this.results.length > 200) this.results = this.results.slice(-200);
    this.saveLocal('results', this.results);
    this.updateProgressFromResult(result);
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
    if (!this.hosted) {
      return { source: 'local', entries: local, label: 'casual (local)' };
    }
    try {
      const res = await sdk().leaderboard(null, { pageSize: 50, scope: friends ? 'friends' : undefined });
      if (!res || !res.board) return { source: 'local', entries: local, label: 'casual (local)' };
      const entries = await Promise.all((res.items || []).map((e) => this.publicLeaderboardEntry(e)));
      return { source: 'global', entries, label: 'global (read-only)' };
    } catch (e) {
      return { source: 'local', entries: local, label: 'casual (local)', error: e.message };
    }
  }

  // Post a finished ranked round to the leaderboards (score-script.js); resolves
  // { posted, rank } — rank on the high-score board, or null. Signed in only.
  async submitScore(total) {
    if (!this.hosted) return { posted: false, rank: null };
    const s = sdk();
    try {
      const keys = await s.submitScores({ 'high-score': total });
      if (!(keys || []).includes('high-score')) return { posted: false, rank: null };
      try {
        const r = await s.leaderboard('high-score', { pageSize: 100 });
        const me = (r.items || []).find((e) => e.userId === this.userId);
        return { posted: true, rank: me ? me.rank : null };
      } catch { return { posted: true, rank: null }; }
    } catch { return { posted: false, rank: null }; }
  }

  async publicLeaderboardEntry(e) {
    const userId = e.userId ?? null;
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
    graphics: {},             // graphics quality settings (see js/gfx.js); {} = Auto
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
  };
}
