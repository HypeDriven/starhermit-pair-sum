# Pair Sum

Connect equal numbers — or pairs that sum to ten — along a clear row,
column, or reading-order fold. A notebook-world number logic puzzle on the
StarHermit engine (script game, engine 1.28.0, `engine.minor=30`): played
natively by the StarHermit client and in browsers by the engine's web
runtime through the loader `index.html`.

## Run and check

```sh
STARHERMIT=~/sh/runtime/1.28.0/starhermit-1.28.0-linux-x86_64/starhermit
$STARHERMIT .            # play natively (as a guest)
npm test                 # unit tests + native checks (tsc, starhermit check, play scripts)
npm run test:browser     # the packaged game in Chrome: desktop, phone, landscape
npm run package          # after every change: rewrites index.html + starhermit-files.json
npm run css              # after editing tools/ui-style.css
npm run plays            # regenerates the generated play scripts from the rules
```

## Layout

- `native/` — the engine client: `main.ts` (entry: flow, input, clock), `screens.ts` (UI), `render.ts` (3D board), `audio.ts`, `platform.ts` (save, options, leaderboard), `quality.ts`, `style.ts`, `i18n.ts`, `game.ts`
- `js/rules.js` — pure deterministic rules engine (legality, scoring, replay, hashing)
- `js/content.js` — themes, seeded generator, 40-stage journey, lessons, daily, challenges, validators
- `js/session.js` — state machine, commands, undo, replay envelope, snapshots
- `js/progress.js` — the save document, merges, results, achievements, options
- `js/i18n.js`, `js/locales/`, `js/sh-strings.js` — the nine locales
- `score-script.js` — the platform script that posts ranked totals to the `high-score` board
- `tests/` — node unit tests, `native.mjs` and `native/*.play`; `tools/` — packaging, CSS, play-script generator, browser check

## Controls

Arrows move · Enter connects · Esc cancel/pause · H hint · U undo · A add rows ·
R camera reset (rebind in the runtime's Options) · gamepad supported. Touch:
tap two tokens; every round action is in the tray.
