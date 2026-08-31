# Known Issues — Pair Sum

QA pass 2026-08-20. Static review driven by Qwen3.8 27B on spark105 (OBLITERATED Q5_K_M),
alongside the game's own unit tests, a headless-Chrome boot/mode/crawl sweep, and live probes
against `server.js`.

## Test results

| Check | Result |
| --- | --- |
| `npm test` | 39/39 pass |
| `node --check` on all modules | clean (8 modules + `server.js`) |
| `tests/e2e.mjs` (headless Chrome) | not present — replaced by an ad-hoc CDP boot/mode/crawl sweep (see below) |

Ad-hoc headless-Chrome coverage: boot (0 console errors), all six mode cards opened, a Daily
round played through hint/undo/add-rows/pause/resume/resize, a **Daily board cleared to a win**
(16 legal pairs applied via `listLegalPairs`, reaching "Page cleared!" with the full score
breakdown, achievements and a validated leaderboard submission — 0 console errors), an abandoned
round taken to results, a 70-click random UI crawl (0 errors), and a corrupt-`localStorage` reload
matrix (`{"broken":`, `null`, `[]`, `{}`, non-JSON — all booted cleanly).

## Confirmed defects

Defects below were each verified by reading the source, not just reported by the model.

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
