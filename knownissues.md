# Known Issues — Pair Sum

QA pass 2026-08-20. Static review driven by Qwen3.8 27B on spark105 (OBLITERATED Q5_K_M),
alongside the game's own unit tests, a headless-Chrome boot/mode/crawl sweep, and live probes
against `server.js`.

## Test results

| Check | Result |
| --- | --- |
| `npm test` | 48/48 pass (2026-09-07; includes `tests/server.test.mjs` live API suite) |
| `node --check` on all modules | clean (8 modules + `server.js`) |
| `npm run test:e2e` (`tests/e2e.mjs`, headless Chrome) | PASS — desktop + mobile, no page errors (2026-09-07) |

Ad-hoc headless-Chrome coverage: boot (0 console errors), all six mode cards opened, a Daily
round played through hint/undo/add-rows/pause/resume/resize, a **Daily board cleared to a win**
(16 legal pairs applied via `listLegalPairs`, reaching "Page cleared!" with the full score
breakdown, achievements and a validated leaderboard submission — 0 console errors), an abandoned
round taken to results, a 70-click random UI crawl (0 errors), and a corrupt-`localStorage` reload
matrix (`{"broken":`, `null`, `[]`, `{}`, non-JSON — all booted cleanly).

## Resolved defects (fixed 2026-09-04)

All five confirmed defects below were re-verified against the current source,
fixed surgically, and confirmed resolved with a live `server.js` probe and a
headless-Chrome Practice-mode check (see each item). `npm test` (39/39) and
`npm run test:e2e` (PASS) both confirm no regressions.

### 1. Practice mode is dead — `PRACTICE_DIFFICULTIES` is used but never imported

- **File:** `js/main.js:355` (`openMode`, `case 'practice'`)
- **Trigger:** Title → Play → "🧘 Practice". Also reproduced by clicking the mode card in
  headless Chrome.
- **Behaviour:** `ReferenceError: PRACTICE_DIFFICULTIES is not defined` is thrown inside
  `openMode`; the setup screen never renders and the mode is unreachable. The whole Practice
  mode required by spec.md §Modes is unusable.
- **Expected:** The practice setup screen renders with the difficulty picker.
- **Evidence:** `js/main.js:355` reads
  `title: 'Practice', def, difficulties: [...PRACTICE_DIFFICULTIES],` but the import block at
  `js/main.js:9-11` is
  `import { LESSONS, JOURNEY, CHALLENGES, dailyForDate, practiceDef, makeDef, generateBoard, THEMES } from './content.js';`
  — `PRACTICE_DIFFICULTIES` is absent. It *is* exported at `js/content.js:445` and imported
  correctly by `js/ui.js:6`. Console output from headless Chrome:

  ```
  ReferenceError: PRACTICE_DIFFICULTIES is not defined
      at openMode (http://localhost:39501/js/main.js:355:51)
      at HTMLButtonElement.onclick (http://localhost:39501/js/ui.js:238:24)
  ```

- **RESOLVED 2026-09-04:** Added `PRACTICE_DIFFICULTIES` to the import block in
  `js/main.js` (now `js/main.js:12`). Verified: headless Chrome opens Title → Play → Practice
  and the setup screen renders with the Calm/Steady/Brisk/Steep difficulty picker and zero
  page errors.

### 2. Leaderboard stores client-declared `moves` / `invalid` / `elapsedMs` — the tie-break is spoofable

- **File:** `server.js:150-156` (`handleApi`, `/leaderboard/submit`), with
  `validateSubmission` at `server.js:76-106`
- **Trigger:** POST a genuinely valid replay envelope whose `result` object lies about the
  non-score fields.
- **Behaviour:** `validateSubmission` only cross-checks `result.score.total` and
  `result.status` against the replayed state. `moves`, `invalid` and `elapsedMs` are copied
  verbatim from the untrusted `result` object into the stored entry, even though `replay()`
  (`js/rules.js:385`) returns an authoritative `final` state carrying all three. Because the
  board is ordered by `elapsedMs` (see defect 3), a client can claim `elapsedMs: 0` and win
  every tie.
- **Expected:** spec.md:38 — "Ties use, in order: primary objective completion, fewer invalid
  actions, **lower authoritative elapsed time**, then stable session identifier." The values
  written to the board must come from `r.final`, not from `body.result`.
- **Evidence:** Live submission against a throwaway copy of the game on port 39521:

  ```
  replay ok= true status= active score= 0 authoritative elapsedMs= 0 invalid= 0 moves= 0
  submit status 200 {"ok":true,"board":"daily:daily-2026-08-20"}
  leaderboard: [{"name":"CHEATER","score":0,"moves":99999,"invalid":-50,
                 "elapsedMs":0,"status":"active","seed":"daily-2026-08-20"}]
  ```

  `moves: 99999` and `invalid: -50` were accepted and published although the replay says 0/0.
  Note the same request also put a still-`active` (unfinished) session on the ranked daily board.

- **RESOLVED 2026-09-04:** `validateSubmission` now returns `final: r.final`
  (`server.js:116`); the submit handler writes `score`, `moves`, `invalid`, `elapsedMs` and
  `status` from `check.final` instead of `result` (`server.js:151-159`). Verified live: a
  replay submission claiming `moves:99999 invalid:-50 elapsedMs:0` now stores
  `[0, 0, 0, 'aborted']`.

### 3. Server leaderboard ordering ignores completion and invalid count

- **File:** `server.js:130` (`handleApi`, `/leaderboard` GET)
- **Trigger:** Fetch any board with more than one entry.
- **Behaviour:** Entries are sorted with
  `.sort((a, b) => b.score - a.score || a.elapsedMs - b.elapsedMs)` — only score, then elapsed
  time. Completion status and invalid-action count are stored on each entry but never used.
- **Expected:** spec.md:38's four-key ordering, which the client already implements correctly in
  `compareResults` (`js/rules.js:408-414`: rank by status, then score, then `invalid`, then
  `elapsedMs`, then session id). Client and server therefore disagree about who is ahead.
- **Evidence:** `js/rules.js:408-414` versus `server.js:130`. Two *genuine* client submissions made
  by playing the Daily in headless Chrome (one abandoned round, one cleared board) landed on the
  same ranked board — `data/leaderboards.json` now holds:

  ```json
  { "sessionId": "mt1uy6ir-bxfqqw", "score": 0,    "status": "aborted", "elapsedMs": 3116, … }
  { "sessionId": "mt1uyx7f-1s5d1r", "score": 1614, "status": "won",     "elapsedMs": 1441, … }
  ```

  The `status` field is stored but never influences ranking.

- **RESOLVED 2026-09-04:** The `/leaderboard` GET sort now mirrors `compareResults`
  (`server.js:127-136`): rank by completion (`won`0 `lost`1 else2), then score desc, then
  `invalid` asc, then `elapsedMs` asc, then session id. The client's `compareResults` unit test
  (`tiebreak ordering`, in `tests/rules.test.mjs`) still passes, confirming the shared contract.

### 4. Dead version guard in `validateSubmission`

- **File:** `server.js:79-81`
- **Trigger:** Any submission.
- **Behaviour:** The block is empty:

  ```js
  if (envelope.rulesV !== undefined && envelope.rulesV !== RULES_VERSION) {
    // (older clients may omit rulesV; build field carries it)
  }
  ```

  A mismatched `envelope.rulesV` is detected and then ignored. Harmless today only because
  `envelope.build` is checked on the next line.
- **Expected:** Either reject the mismatch or drop the check.
- **Evidence:** The quoted lines.

- **RESOLVED 2026-09-04:** The guard now rejects a mismatch with `stale-version`
  (`server.js:90-92`). Verified live: a submission with `rulesV: RULES_VERSION + 999` returns
  HTTP 422 `{"error":"stale-version"}`.

### 5. Cloud saves are readable and writable by anyone who names the key

- **File:** `server.js:162-182` (`/save` POST and GET)
- **Trigger:** `GET /api/v1/save?player=<name>` for any player name; or POST the same key with a
  higher `rev`.
- **Behaviour:** The storage key is taken straight from the request with no token, session or
  identity check:

  ```js
  const key = String(body.player || 'guest').slice(0, 64);      // POST, server.js:165
  const key = String(url.searchParams.get('player') || 'guest').slice(0, 64);  // GET, server.js:180
  ```

  There is no `Authorization` handling anywhere in `server.js`, so any client can read another
  player's progression document, and — since the POST handler applies only a `rev` comparison —
  overwrite it by submitting a higher `rev`.
- **Expected:** spec.md:174 — "Validate all network input for **identity**, session membership,
  turn/tick, bounds, rate, payload size, and legal action." The sibling game `pixel-atelier` shows
  the shape of a fix: its `profileId(req)` (`pixel-atelier/server.js:89-94`) derives an opaque id
  by hashing the `Authorization: Bearer` token instead of trusting a client-named key.
- **Evidence:** After a Daily was played in headless Chrome, the save written under the `guest`
  key was retrieved by an unauthenticated request from a different client:

  ```
  $ curl -s "http://localhost:39501/api/v1/save?player=guest"
  {"doc":{"v":1,"journey":{},"achievements":{"first_clear":{"at":1787250792797},
   "mechanic_master":{...}},"totals":{"pairs":16,"clears":1},"streakDays":["2026-08-20"],...
  ```

- **RESOLVED 2026-09-04:** Added `profileId(req)` (`server.js:69-75`) mirroring the
  `pixel-atelier` helper: it derives an opaque sha-256 key from the `Authorization: Bearer`
  token (falling back to `guest`), and the `/save` POST/GET handlers now use it instead of
  trusting a client-named `player`/`body.player` key (`server.js:174`, `server.js:190`). A client
  can no longer address (read/overwrite) a specific player's key by name. Verified live: a save
  POST naming `player:"victim"` no longer creates a separate `victim` key — it lands under the
  guest identity, and the `player=victim` query name is ignored.

## Resolved defects (fixed 2026-09-07)

Second review pass (model: Kimi). All fixes verified with `npm test` (48/48,
including the new `tests/server.test.mjs` integration suite), `npm run
test:e2e` (desktop + mobile PASS), and a live headless-Chrome smoke run
against the real `server.js` covering hosted boot, a Daily win submitted and
listed on the global board, a Score-chase submission, token-keyed saves, and
reload → Continue.

### 6. Hover path-preview writes NaN vertices (console error on every legal hover)

- **Files:** `js/rules.js:172` (fixed), read by `js/render.js` `previewPath`.
- **Behaviour:** `checkPair`'s success result had no `a`/`b` fields, but
  `previewPath` computes the preview line endpoints from `check.a`/`check.b`,
  producing NaN vertex positions and a
  `THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN`
  console error for any player who hovered a legal target with a cell selected.
- **RESOLVED:** `checkPair` now echoes `a`/`b` on success; a unit test pins the
  contract and the e2e console filter for the NaN signature was removed so a
  regression fails the suite.

### 7. Undo leaves restored cells untappable on the 3D canvas

- **File:** `js/render.js` `syncState`.
- **Behaviour:** undo restored the pair in rules state, but the cells' token
  views kept `dying = true`: they finished their pop-out and were only
  respawned by a later sync, leaving the restored cells untappable on the
  canvas (DOM mirror and keyboard still worked).
- **RESOLVED:** `syncState` revives a dying view when its slot holds a digit
  again (`dying = false`, scale springs back), so refilled cells are tappable
  immediately.

### 8. Pause menu → Settings/Help rendered underneath the pause overlay

- **File:** `css/style.css` (`.pause-overlay` z-index 80 vs `.screens` 40).
- **Behaviour:** Settings/Help opened from the pause menu were invisible and
  unclickable behind the dimmed overlay.
- **RESOLVED:** `.screens` now sits at z-index 85 (above the overlay, below
  toasts). The e2e pause step now exercises pause → Settings → Back → resume.

### 9. Opening a full-page screen mid-round silently abandoned the round

- **File:** `js/main.js` (topbar Help/Settings/Profile handlers, `back()`).
- **Behaviour:** opening Help/Settings/Profile via the topbar during an active
  round and pressing Back/Escape went to the title screen while the round was
  still active — the machine transitioned to `title` with no snapshot, the
  timed clock kept running while the board was covered, and the round was
  unrecoverable.
- **RESOLVED:** the topbar chips now pause the round first (`pauseForScreen`),
  so Back returns to the pause overlay and Resume continues the round. Escape
  now acts as Back on any open screen. The e2e mid-round settings/help step
  asserts the pause-and-return contract.

### 10. Hosted global leaderboards always appeared empty; Score-chase board unreachable

- **Files:** `server.js` `/leaderboard` GET, `js/main.js` `nextAfterResults`,
  `js/ui.js` `renderBoards`, `js/platform.js` `leaderboard`.
- **Behaviour:** submissions are stored under `daily:<contentId>` /
  `challenge:<contentId>`, but the client queried `board=daily` /
  `board=challenge`, which never matched — hosted boards rendered empty. The
  Score-chase results button opened the *Challenge* board, and no Score-chase
  tab existed. Journey/Practice boards (never submitted server-side) hid local
  results behind an empty global response.
- **RESOLVED:** the server resolves `daily` to today's daily board and
  aggregates prefixed boards (`challenge:*`); the results "Scores" button opens
  the `score` board for Score chase; a Score-chase tab was added; Journey and
  Practice boards are served from local results even when hosted.

### 11. Leaderboard accepted fabricated boards with self-consistent replays

- **File:** `server.js` `validateSubmission`.
- **Behaviour:** the replay check used the client-supplied `envelope.init`
  cells, so a client could invent a trivially clearable layout, claim it was
  the Daily, and pass validation.
- **RESOLVED:** the server regenerates the authoritative content for the
  claimed mode/content id (Daily by date, Challenge by id, Score chase by ISO
  week) and rejects submissions whose seed/cols/initial cells do not match
  (`content-mismatch` / `unknown-content`). Covered by `tests/server.test.mjs`.

### 12. Client never authenticated API calls; leaderboard entries had no name

- **File:** `js/platform.js` `api`, `recordResult`; `js/main.js` `boot`.
- **Behaviour:** the server keys cloud saves by the bearer-token hash (defect
  5 fix), but the client never sent the launch token, so every save landed
  under the shared `guest` identity. Submissions carried no player name, so
  boards showed "Player". `reconcileProgress` existed but was never called, so
  cloud saves were write-only.
- **RESOLVED:** `api()` attaches `Authorization: Bearer <launchToken>` when
  present (memory only, never persisted); submissions include the profile
  display name; boot reconciles cloud progress when hosted. Smoke-verified:
  saves land under the token hash, the token is stripped from the URL and never
  reaches localStorage.

### Minor fixes in the same pass

- `index.html`: removed the leftover emoji data-URI favicon that overrode the
  authored `favicon.svg`; the toast stack is now `aria-live="polite"` instead
  of `aria-hidden` so achievement/notice toasts reach screen readers.
- `js/main.js`: the "no pairs" hint announcement now matches the on-screen
  alert when Add Rows is unavailable.
- `server.js`: malformed JSON bodies get HTTP 400 (`bad-json`) instead of 500;
  the listen log prints the actual bound port; `PAIR_SUM_DATA` env var allows
  an isolated data dir (used by the test suite); `PORT=0` selects an ephemeral
  port.
- `.gitignore`: ignore the runtime `data/` directory.

## Suspected — not confirmed

### 1. Whether the standalone server is meant to enforce identity at all

- **File:** `server.js` (no `Authorization` handling anywhere)
- **Concern:** Defect 5 assumes this server is the real host. The header comment calls it the
  "authoritative script (server=server.js)", but a StarHermit deployment may front it with
  host-provided identity, in which case the missing checks would be the platform's job.
- **Why unconfirmed:** The host contract is not in this repository.

## Checked, no defects found

- Suspend/resume: entered a round, performed an action, reloaded the page, and confirmed the
  game re-boots with its snapshot intact and no console errors or failed requests.
- `js/rules.js` + `js/session.js`: move legality, path finding, `addRows`, undo, scoring
  components, `replay`, `hashState`, `compareResults` — 39 unit tests pass and the model review
  returned NO DEFECTS FOUND; no contradiction with spec.md §Scoring found by reading.
- Daily / Journey / Learn / Challenge / Score-chase mode entry: opened each in headless Chrome,
  no console errors; only Practice fails (defect 1).
- In-round controls: hint, undo (including undo at turn zero), add-rows, pause, resume, window
  resize — no errors.
- Persistence: `pairsum:autosave`, `pairsum:save`, `pairsum:settings` each replaced with five
  kinds of corrupt payload; the game booted cleanly every time.
- Static file serving in `server.js`: traversal (`..`), `data/`, and dotfile paths are rejected.
- No `Math.random` in `js/rules.js` / `js/content.js` — determinism holds; the only uses are
  session ids, audio and particles.

## QA side effects

- Running `server.js` during this pass created an untracked `data/` directory in the game root
  containing `leaderboards.json` (two genuine Daily submissions made by the headless client, cited
  as evidence above) and `saves.json` (the cloud-save write that the client performs on round end).
  Left in place for central cleanup.

## Not tested

- Gamepad and touch input paths (`js/main.js` input routing) — no device available in headless
  Chrome.
- WebGL rendering quality tiers in `js/render.js`; headless runs use SwiftShader, so the visual
  acceptance criteria in spec.md §4 could not be judged.
- Real StarHermit host integration (`js/platform.js` launch token, presence, activity): only the
  bundled standalone `server.js` was exercised.
