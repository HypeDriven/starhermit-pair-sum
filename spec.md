# Pair Sum — Product and Game Specification

**Document status:** running specification of the shipped game (StarHermit engine 1.22.0 script game).  
**Game index:** 17  
**Genre:** Number logic puzzle  
**Players:** 1 player; optional asynchronous score comparison  
**Targets:** the StarHermit client (native) and browsers through the engine's web runtime; desktop, phone portrait and phone landscape  
**Rendering direction:** a 3D board on `starhermit:scene` (ported from the three.js r160 browser build) under an immediate-mode `starhermit:ui` interface, with every token a named, accessible target

## 1. Product vision

Pair Sum is a game in which players connect equal numbers or pairs matching the target sum when their path is unobstructed. Its signature setting is a crisp notebook world with dimensional number tokens. The product should feel immediately understandable, responsive within one input, and polished enough that the board or playfield itself is the visual hero. Sessions should begin quickly, make the next useful action obvious without solving the game for the player, and end with a clear explanation of score and progress.

The experience must be original. Do not copy names, layouts, characters, iconography, writing, audio, progression maps, or level data from an existing title. Use an original visual language, original procedural assets, and internally authored content.

### Design pillars

1. **Readable before spectacular:** legal actions, hazards, selection, ownership, and goals remain legible with effects disabled.
2. **One-input confidence:** every press, tap, drag, key, or pointer action gives immediate visual and sonic acknowledgment.
3. **Short path to play:** a returning player reaches the primary playfield in at most two deliberate actions.
4. **Fair mastery:** randomness is seeded and inspectable; outcomes never depend on hidden purchases or invisible stat boosts.
5. **Scalable beauty:** the same art direction survives low-power mobile hardware and high-resolution desktop displays.

## 2. Core game design

### Objective and rules contract

Connect equal numbers or pairs matching the target sum when their path is unobstructed.

The rules engine must represent legal actions independently from rendering. It must expose legal-action queries, deterministic resolution, serializable state, a monotonically increasing turn/tick number, and a terminal-state reason. Tutorials and hints call the same legal-action API used by play rather than duplicating rules.

### Core loop

The repeated loop is: **scan the board, select a valid pair, clear it, collapse or extend rows, and continue**. Input is locked only during the shortest non-interruptible resolution phase. Cosmetic animation may continue after the logical state is ready, but skip/fast-forward must settle every object into the exact deterministic end state.

### Scoring and victory

Score pair chains and board clears; ensure the legal-path rule is visualized. Results show a component breakdown rather than one unexplained total. Store integers for score and simulation units; format values only in presentation. Ties use, in order: primary objective completion, fewer invalid actions, lower authoritative elapsed time, then stable session identifier.

### Modes

- **Learn:** interactive lessons introduce one rule at a time and require the player to perform the action.
- **Journey:** authored progression with gradually combined mechanics and periodic mastery stages.
- **Daily:** one shared seed and ruleset per UTC day, synchronized to platform time.
- **Practice:** selectable difficulty, restart, undo where rules permit, and no effect on competitive rating.
- **Challenge:** constrained goals such as move limits, speed targets, altered layouts, or restricted tools.
- **Score chase:** asynchronous global and friends comparisons using validated seeds and rulesets.

### Difficulty and content generation

- Represent content as versioned data: identifier, seed, initial state, goals, allowed mechanics, par values, tutorial flags, and presentation theme.
- Run offline validators to prove basic legality, reachable goals, bounded duration, and absence of soft locks. Logic puzzles additionally require a unique or explicitly accepted solution class.
- Difficulty is measured from solution depth, branching factor, time pressure, motor precision, hidden information, and recovery options—not merely larger numbers.
- Introduce one new concept in isolation, combine it with one known concept, then test mastery before adding another.
- Daily seeds are immutable after publication. If content is defective, mark the day excluded from ranking rather than silently replacing it.

### Game-state model

`boot → title → profile-ready → mode-select → preparing → tutorial/countdown → active ↔ paused/reconnecting → resolving → results → progression`.

Every transition has one owner and an explicit reason. Backgrounding pauses solo simulation. In hosted play, the authoritative clock continues where rules require it, while the returning client receives a fresh snapshot and a concise “while you were away” summary.

## 3. Interaction and user-interface design

### Information hierarchy

1. **Primary:** playfield, current objective, legal interaction target, and immediate danger or turn state.
2. **Secondary:** score/progress, remaining moves or time, opponent/party status where applicable.
3. **Tertiary:** settings, social controls, cosmetics, help, and history.

The 3D board fills the stage but is never the only UI: menus, text, settings and the round's status are `starhermit:ui` widgets over or beside it, and every token is a named target (`Row r, column c, digit v`) that screen readers, play scripts and the browser's accessibility mirror reach, placed from the token's projected footprint so labels align with the 3D targets.

### Responsive layouts

Layouts are picked each frame from the window's logical size (the runtime's interface scale applied; native/screens.ts):
- **Wide (≥ 1024 logical px):** top bar (brand, round title, Help, Settings, profile chip), the Objective rail on the left (objective, score, chain, digits left, moves and time left when limited, Journey progress) and the Status rail on the right (cloud-save line); the board fills the stage between them under the HUD pill (digits left · moves · clock, with the red alert line under it) above a centred action tray.
- **Compact:** the rails are gone; the board, HUD pill and tray stay.
- **Portrait phones (≤ 700 px wide):** the round title leaves the bar, the profile chip shows its icon alone when the bar is too narrow, and the tray spans the width.
- **Short landscape (≤ 500 px tall):** the tray is a column at the right, the lesson banner a side panel at the left, and the pause card compact.

The board is fitted (orthographic frustum offset) into the stage area those leave free, so it never sits under the HUD, lesson banner or tray. The runtime's interface and text sizes scale everything (the old ui-scale.js); a change of size or orientation re-lays out without touching the round.

### Screens and overlays

- **Title:** two number-tile pairs (3 + 7, 5 + 5) under dashed arcs (lacquered at Surface detail, bobbing with ambient motion), **Pair Sum**, the tagline, **Play** and **Continue round** (when a round was left or paused), then 📅 Daily challenge (done ✓), 🗺️ Journey (n/40), 🏆 Scores, 🎖️ Achievements, ⚙️ Settings, and **Sign in with StarHermit** (guests) / **Invite a friend** (signed in).
- **Choose a mode:** six cards — Learn, Journey, Daily, Practice, Challenge (accented), Score chase.
- **Journey:** five notebooks of eight pages (four per row on phones); mastery pages show ★; done pages are filled with stars; locked ones are disabled.
- **Setup:** title, board / rules / expected duration / players / assists / limits / result (ranked or not) / seed, a note, **Start** and **← Back**; Practice adds the difficulty row (Calm, Steady, Brisk, Steep); Learn lists the six lessons; Challenge lists its four cards (each starts at once).
- **Play:** countdown 3, 2, 1, Go! (0.6 s each; lessons skip it), the HUD, lesson banner with **Skip lesson**, tray (💡 Hint, ↩️ Undo, ➕ Add rows, ⏸️ Pause; mirrored by the left-handed tray), toasts bottom-right (achievements, notices) and the sound-caption line.
- **Pause card:** summary, **Resume**, Settings, Help, Restart round, Leave round; Escape / Back resumes. Help, Settings or the profile from the top bar pause the round first; their Back returns to the card.
- **Results:** headline (Page cleared! / Out of time / Out of moves / Round ended), the score breakdown (pairs, chain bonus, row clears, board clear, time bonus, total), elapsed · invalid actions · redeals · seed, a personal-best note, unlocked achievements, the leaderboard line (signed-in ranked rounds), **Retry**, **Next page / Next lesson / Scores / New page**, **Title**.
- **Help:** five rule cards with demo cells and the Controls card from the effective bindings.
- **Settings, Achievements, Scores** (tabs Daily, Score chase, Challenge, Journey, Practice), **Profile** (name, account, boards cleared, pairs connected, days played, cloud sync).

Full-page screens are drawn on the notebook page (ruled with a red margin at Surface detail Detailed, unless high contrast); their actions sit pinned at the bottom and the body scrolls when it is taller than the window.

### Input

- **Pointer / touch:** a tap (under 12 px and 0.6 s) on a token selects it; a tap on a second token tries the pair; tapping the selected token or empty paper deselects. With a selection, hover previews the path to the token under the mouse (a line plus dots on the cells it passes). The board is picked by raycasting the token meshes only; presses on the bar, rails, HUD, banner or tray belong to them. Phones use the same taps; nothing needs multi-touch.
- **Keyboard (rebindable in the runtime's Options; `control.*` in starhermit.txt):** arrows move the board cursor to the nearest token in that direction (its focus ring shows after key or pad use), Enter / Space / Numpad Enter select or connect, Escape cancels the selection, else pauses (Back on screens), H hint, U undo, A add rows, R reset camera. Enter on a focused button stays the button's.
- **Gamepad:** D-pad or left stick moves the cursor, South selects / connects, East or Start cancels / pauses, North hints, West undoes, the right shoulder adds rows, the right stick press resets the camera; the runtime's focus navigation covers the screens.
- Commands carry action ids (rules `nextCmdId`), so a repeated press never double-commits.

### Accessibility

- Full keyboard and pad operation with visible focus; every token is a named button target; the round's events are announced (selection, legality of the cursor's target, hints, invalid reasons, lesson steps, results) through the runtime's screen-reader announcements.
- Colour is reinforced by lift, the grounded ring and labels. Settings › Color palette (Default, Deuteranopia-safe, Protanopia-safe, Tritanopia-safe) recolours the selection, legal-target and path markers.
- Reduced motion, high contrast and larger text are the runtime's Options: reduced motion removes the shake, sparks, motes, lamp shimmer, idle bob, title bob and springs (tokens snap); high contrast swaps the theme for black on white and drops the paper decorations.
- Sound volumes and mute are the runtime's; Settings › Captions for sounds shows a caption line for every meaningful sound.
- Settings also offer the left-handed tray, haptics (a short vibration on a clear and on an invalid pair, where the device has a motor), timing assistance (+50 % on time limits; the round becomes unranked) and Replay lessons.

### Localization

- Every player-facing string ships in en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR and it-IT: the screens, HUD, token target names, toasts, announcements, captions, invalid reasons and the content (lessons, the 40 Journey page titles and notes, notebooks, practice difficulties, challenges, achievements). `js/i18n.js` looks strings up by their US-English text in `js/locales/*.js` (es-ES and fr-CA list only their differences, en-GB only its spelling); the account strings are `js/sh-strings.js`. Round titles stay English in saved data and are translated at display (`defTitle`, including "Daily — date", "Practice — name" and "Score chase — week n").
- The language is the runtime's interface language (Options › Language: explicit choice, else the account's preferred language, else the device's), mapped to the nearest shipped locale (es-MX → es-419, en-AU → en-GB, fr → fr-FR, pt-PT → pt-BR). Everything is drawn through `T()` each frame, so a change shows at once without restarting the round.
- `tests/i18n.test.mjs` checks that every key used in native/*.ts, the shared modules and the content exists in all nine locales with matching placeholders, and that no locale keeps unused keys.

## 4. Visual and audio design

### Visual contract

The subject is the active playfield at near-tabletop to room scale, framed so state changes occupy most of the screen. The scene is a crisp notebook world with dimensional number tokens. Use an authored camera, original procedural geometry, restrained environmental storytelling, and a deterministic visual seed. The no-post-processing baseline must still communicate hierarchy, depth, selection, and state.

### 3D scene design

- Use physically based lighting and color management with one dominant key, soft environment fill, and contact grounding. Gameplay colors are tested after tone mapping.
- Build reusable semantic meshes for active pieces, board cells, obstacles, targets, and environment modules. Geometry detail follows silhouette importance and camera distance.
- Use instancing for repeated pieces and props, pooled effects, texture atlases where appropriate, and explicit disposal on scene changes.
- Separate render layers for environment, gameplay, selection/ghosts, effects, and UI anchors. Cosmetic particles never intercept raycasts.
- Selection uses a combination of lift/pose, outline or rim, and grounded marker—not bloom alone. Legal targets preview before commit; invalid targets explain why.
- Event hierarchy: input acknowledgment < legal move < combo/goal < round completion. Reserve camera motion, strong emission, and dense particles for the highest tier.
- Audio uses original short transients tied to logical events, layered material impacts, quiet ambience, and adaptive music stems. Randomized pitch/variant is seeded for replay consistency where recording matters.

### Camera and motion

- Choose orthographic or low-distortion perspective according to depth requirements; expose framing constants rather than magic offsets.
- Camera transitions use authored duration/easing or critically damped springs and remain interruptible. Never animate by cumulative per-frame lerp.
- Decorative motion is paused or reduced when hidden. Gameplay animation derives from simulation state and interpolation alpha, not frame count.
- Camera shake is low-amplitude, event-tiered, disabled by reduced motion, and never changes raycast truth.

### Performance budgets

- Target 60 fps at the default tier and a stable 30 fps fallback on constrained mobile hardware.
- Default active gameplay: ≤150 draw calls desktop, ≤90 mobile; ≤350k visible triangles desktop, ≤140k mobile; transient particles ≤20k desktop and ≤5k mobile.
- Cap device pixel ratio by quality tier; dynamically lower render scale before dropping simulation rate. UI text remains native resolution.
- Avoid runtime shader compilation during active play by prewarming required variants. Avoid per-frame allocations in simulation/render loops.
- Quality tiers independently control shadows, environment detail, particles, post effects, antialiasing, and render scale; they never alter rules or visibility of hazards.

### Graphics

**Graphics.** The board renders with ACES filmic tone mapping at exposure 2.3 and sRGB output, a warm key light with PCF soft shadows, a hemisphere fill tinted by the theme's paper and rule colours (both r160's intensities ÷ π: the engine's punctual lights take three's legacy units), and reflections of a prefiltered room environment (`RoomEnvironment`, intensity 0.14). Tokens are rounded, bevelled tiles extruded from a rounded square (caps mapped across the digit texture, welded sides), one draw call each with its own material so selection and legal-target glows never leak; the digit face is a debossed card with a pressed-ink highlight drawn on a canvas per digit and theme in Liberation Serif Bold (bundled in `assets/fonts/` under the SIL OFL 1.1, as the generic serif draws as sans-serif on the web runtime's canvases). At Surface detail Detailed the tiles are more finely bevelled and (High, Ultra) clear-coated, the page gets a paper-fibre bump map (High, Ultra) and every cell slot shows a faint dashed pencil outline. With shadows off, soft blob shadows ground the tokens. Effects per tier: ambient occlusion (GTAO), bloom limited to the effect sparks and the selection ring (threshold 0.9 on linear light), a display-space colour grade (gentle S-curve, +7 % saturation, cool shadows and warm highlights, vignette), FXAA / SMAA / MSAA, denser spark bursts, and ambient motion (drifting dust motes, a slow lamp shimmer and drift, a tiny idle bob) that stops under reduced motion.

The runtime's Options choose the graphics level (Auto from the device, Low, Balanced, High, Ultra and the levels within them), render scale, pixel-ratio cap, adaptive resolution and the frame-rate limit and readout; the game maps the level to the browser build's presets (`native/quality.ts`, from js/gfx.js TABLE and BUDGETS) and applies a change live.

| Tier | Shadows | AO | Bloom | Grade | AA | Particles | Ambient | Detail |
|---|---|---|---|---|---|---|---|---|
| Low | off (blobs) | off | off | off | off | low | static | plain |
| Balanced | 1024² | off | on | on | FXAA | high | animated | detailed |
| High | 2048² | on | on | on | SMAA | high | animated | detailed |
| Ultra | 4096² | high | on | on | MSAA | high | animated | detailed |

| Budget | Low | Balanced | High | Ultra |
|---|---|---|---|---|
| Token and paper shading | Lambert | Standard | clear-coated Physical tokens | as High |
| Digit-face texture | 128 px | 256 px | 256 px | 512 px |
| Ruled-paper texture | 512 px | 512 px | 1024 px | 2048 px |
| Token corner / bevel segments (Plain 2 / 1) | 2 / 1 | 3 / 2 | 5 / 4 | 8 / 5 |
| Paper-fibre bump | no | no | yes | yes |
| Spark pool (Particles low: 20 %) | 600 | 1500 | 3000 | 4500 |
| Dust motes (Particles low: half) | 24 | 40 | 80 | 120 |
| Bloom / AO resolution | ½ | ½ | ½ | full |

Spark and mote budgets grow with the level index within a tier (≤ 2×, at most 9000 / 240). Board, tokens, tap areas and rules are identical on every tier.

**Audio.** The authored one-shots (`sfx/*.opus`, `sfx/manifest.json`) play on the runtime's effects bus for select, deselect, clear, chain clear, row collapse, rows added, invalid pair, round win, round lose, hint, undo and UI. The quiet desk ambience (noise lowpassed at 320 Hz) and the generative pentatonic music (a note every 1.2 s, a low triangle every 4.8 s; a second, denser line fades in with chains) are rendered once into looping clips on the music bus. A hidden window and the pause card silence them.

## 5. Technical architecture

### Client modules

- `native/main.ts` (engine entry): the screen flow, starting every mode, the session's events, input (taps, keys, pads), the fixed-step clock (the session clock advances 1000/60 ms a step while not hidden; the countdown, the pause before the results and the time limits run on it, so play scripts replay exactly), lifecycle (a hidden window pauses the round).
- `native/screens.ts`: the whole `starhermit:ui` interface and the token targets; `native/style.ts` the tokens per notebook theme and high contrast over `assets/ui-style.json` (converted from `tools/ui-style.css` with `npm run css`).
- `native/render.ts`: the `starhermit:scene` board; `native/quality.ts` the tiers; `native/audio.ts` the sound; `native/i18n.ts` the language; `native/platform.ts` the save, options and platform calls; `native/game.ts` types over the shared modules.
- Shared pure modules (also run by the node tests): `js/rules.js` (legality, paths, scoring, replay, hashing), `js/content.js` (themes, generator, lessons, Journey, Daily, practice, challenges, achievements, validators), `js/session.js` (state machine, validated commands, undo, lesson gating, snapshots, replay envelope; its clock is injected), `js/progress.js` (the save, merges, results bookkeeping, achievements, local boards, options), `js/i18n.js` + `js/locales/`, `js/sh-strings.js`.

No module mutates rules state except through a validated command; the board renders immutable snapshots.

### Determinism, replay, and security

- Fixed simulation step where physics exists; quantize authoritative inputs and define stable collision/order rules.
- Use separate seeded random streams for rules, content decoration, and audiovisual variants. Cosmetic randomness never changes rules.
- Replay envelope: schema version, build/content version, seed, initial hash, timestamp offset, ordered commands, periodic state hashes, terminal result.
- Validate all network input for identity, session membership, turn/tick, bounds, rate, payload size, and legal action. Reject duplicates idempotently by command ID.
- Treat client clocks, scores, inventories, roles, physics outcomes, and completion claims as untrusted in competitive contexts.

### Loading and resilience

- The engine's loader (`index.html`, written by `npm run package`) starts the package by its file index (`starhermit-files.json`); the sound clips load one at a time once the mixer runs (in browsers after the first press), so a clip still loading is silent, never an error.
- Leaving or pausing a round keeps a durable snapshot in the save; **Continue round** restores it paused with a "while you were away" note.

## 6. StarHermit integration

### Packaging and launch
- `starhermit.txt`: name, description, owner, `server=score-script.js`, cover, `launch=index.html`, `engine.api=1`, `engine.entry=native/main.ts`, `engine.version=1.22.0`, `engine.minor=20`, `engine.capabilities=platform,storage,clipboard`, `control.*` for left, right, up, down, choose, cancel, hint, undo, addrows and camera with `engine.gamepad.*` defaults. (The old `addRows` action is now `addrows`: a rebinding made in the browser build is not carried over.)
- `npm run package` writes the loader and the file index; `.starhermitignore` leaves tests/, tools/ and the docs out of the package.

### Identity, preferences, and progress
- **Player:** the runtime's signed-in player (`player()`); guests play fully offline and may keep a local display name (Profile › Display name, saved with Enter or Save).
- **Save:** the engine save (`saves`, schema 1; on the device and, signed in, in the account's cloud slot) holds `{ progress, results, snapshot, name }`. A conflict with another device merges (`mergeSave`: journey done/best/stars, totals and daily bests take the larger value; achievements keep the earliest unlock; streak days and results are unioned; the local round in progress wins). The browser build's cloud slot (`game:<slug>`, the bare progress document written by the JS SDK) shows as foreign: it is merged into the device's save and replaced once (`replaceForeign`). Guests' old browser localStorage cannot be read by the engine and is not migrated.
- **Options:** the notebook theme, colour palette, left-handed tray, haptics, timing assistance and sound captions are engine settings (synced with the account). The browser build's values in the account's settings KV are adopted unless set since, then every old KV key (volumes, mute, graphics, reduced motion, contrast, larger text, language, hold to confirm, camera tilt) is removed.
- **Clock:** the Daily's UTC day and the Score chase week follow the platform's clock once it answered (`serverNow`), else the device's.
- **Invite:** signed in, the title offers **Invite a friend** (copies the platform's invite link). Signed out mid-session, a toast says so and play continues locally.

### Achievements and leaderboards
- Achievements (first clear, Lane Reader, seven-day streak, mastery stage, a thousand pairs) are a local set inside the cloud-saved progress document; no platform achievements are declared.
- Signed in, every finished ranked round (Daily, Challenges, Journey mastery pages, Score chase; won or lost, not abandoned; not with timing assistance) posts its total through `score-script.js`: a practice session whose game socket carries `{ type: 'result', scores: { 'high-score': total } }`; the script range-checks it (integer 0–100,000) and posts it to the `high-score` board. Results show "Posting score to the leaderboard…", then the rank, "posted" or "not posted". Scores shows that board's entries (read-only) on the Daily, Score chase and Challenge tabs when signed in; Journey and Practice, and everything for guests, show the device's own results.

### Not used
- Hosted rooms, matchmaking, chat, replays and voice: the game is solo. Results are recorded only through `score-script.js` (solo boards: the client's total, range-checked).

## 7. Content, economy, and retention

- Launch scope: tutorial sequence, at least 40 authored stages or equivalent procedural depth, daily challenge, practice, five visual themes, and a mastery track.
- Cosmetic rewards may alter materials, trails, board surrounds, ambience, or profile flourishes, but never hitboxes, timing windows, information, or power.
- Reward cadence: early feedback every session, meaningful unlock every 3–5 sessions, and long-term goals visible without manipulative countdowns.
- No real-money wagering, paid random rewards, forced advertising, energy pressure, punitive streak loss, or purchases that affect competitive outcomes.
- Notifications, if ever added by the host, are opt-in, frequency-capped, quiet-hour aware, and never use false urgency.

## 8. Analytics and privacy

Measure tutorial completion, first meaningful action time, session duration bands, level attempts, quit state, input modality, performance tier, reconnect success, and accessibility feature usage only in aggregate. Use random session identifiers, short retention, and explicit consent where required. Never collect message content, drawings, voice, private board notes, or exact pointer trails as analytics.

Success targets for the first public test: median first-play time under 20 seconds, tutorial completion above 80%, crash-free sessions above 99.5%, p95 input acknowledgment below 100 ms locally, and at least 95% of supported mobile sessions holding their selected frame-rate tier.

## 9. Testing and acceptance criteria

### Rules and content

- Unit-test every legal action, invalid-action reason, scoring component, terminal state, and serialization migration.
- Property-test deterministic replay: the same version, seed, and commands produce identical state hashes.
- Fuzz malformed commands and generated content; prove no hangs, NaN physics, impossible mandatory states, or unbounded loops.
- Golden-test representative easy, medium, hard, interrupted, resumed, and terminal sessions.

### Interface and accessibility

- Test pointer, coarse touch, keyboard-only, gamepad, screen reader, zoom to 200%, reduced motion, high contrast, safe areas, and both mobile orientations.
- Verify focus restoration after every modal, meaningful live announcements, no keyboard traps, and no hover-only instructions.
- Confirm all critical labels fit translated strings at 30% expansion and support right-to-left layout where localized.

### Graphics and performance

- Produce fixed-camera captures for every quality tier, deterministic seed sweeps, no-post baselines, debug-view mosaics, and 10-minute temporal stability runs.
- Profile CPU, GPU, memory, shader compilation, draw calls, triangles, texture memory, and garbage collection on representative desktop and mobile classes.
- Verify effects cannot obscure legal targets, alter picking, leak resources, or continue expensive updates while hidden.

### Checks (`npm test`)
- Unit (node --test): `tests/rules.test.mjs`, `content.test.mjs` (every shipped definition validates), `replay.test.mjs` (deterministic replay, fuzz), `progress.test.mjs` (save normalizing, merge, foreign-save migration, results, achievements, boards, options), `i18n.test.mjs`.
- Native (`tests/native.mjs`): the web index matches the files, `tsc` (no skipLibCheck), `starhermit check` with zero warnings, and the play scripts in `tests/native/` as signed-out render checks: `journey-1.play` (Journey page 1 clicked to its results and the next page) and `learn-phone.play` (the six lessons touched on a 390 × 844 DPR-3 phone, each to its results), both generated by `tools/gen-plays.mjs` from the rules; `menus.play` (settings, theme, scores, achievements, setups, a Practice round by keys, pause, help, leave, continue, restart, the profile name); `landscape.play` (844 × 390 DPR 3: the tray column, a hint, the pause card, the lesson side panel).
- Browser (`npm run test:browser`, `tools/browser-play.mjs`): the packaged loader in Chrome on the GPU at desktop, phone (DPR 3) and phone landscape (DPR 3): lesson 1 by mouse, a Practice round by keys and pause; lesson 2 by finger taps; a landscape hint and pause; it fails on console errors or the runtime's error screen.

## 10. Definition of done and non-goals

The game is done when `npm test` and `npm run test:browser` pass after `npm run package`. Non-goals: real-money systems, monetization, hosted multiplayer, and copying any existing product.

## Known limitations and port differences

- The browser build's per-effect graphics overrides, its own sound sliders, frame-rate options and Language panel are the runtime's Options now; the Settings **Hold to confirm** toggle (stored but never acted on) and the stored camera tilt are gone.
- The old DOM board mirror became the tokens' named targets: arrow keys now show a focus ring on the 3D token instead of switching to the flat notebook view; Tab moves among widgets (the old Tab-cycles-cells shortcut is not kept).
- Fixed while porting: the board sat off-centre in the free stage area (a sign slip in the old frustum offset), Practice round titles lost their difficulty name, and "New personal best" could never show (every round shared one session id); the colour-palette setting now recolours the markers, and haptics vibrate.
- Guests' old browser progress (localStorage) is not migrated; signed-in players' cloud progress is.
