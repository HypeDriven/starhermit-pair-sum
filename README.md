# Pair Sum

Connect equal numbers — or pairs that sum to ten — along a clear row, column,
or reading-order fold. A notebook-world number logic puzzle: Three.js
presentation over a fully playable semantic HTML layer.

## Run

```sh
npm start          # serves the game + authoritative API on :8080 (PORT to override)
# or any static server — the game also runs fully offline/local
```

Open http://localhost:8080/ and press **Play**.

## Test

```sh
npm test           # rules, content validation, replay determinism, fuzz
```

## Layout

- `js/rules.js` — pure deterministic rules engine (legality, scoring, replay, hashing)
- `js/content.js` — themes, seeded generator, 40-stage journey, lessons, daily, challenges, validators
- `js/session.js` — state machine, commands, undo, replay envelope, snapshots
- `js/render.js` — Three.js scene (procedural tokens/paper, springs, pooled particles, quality tiers)
- `js/ui.js` — DOM shell: screens, HUD, settings, accessible board mirror
- `js/audio.js` — synthesized WebAudio buses (music/effects/ambience/voice)
- `js/platform.js` — local-first persistence + hosted adapter (time sync, boards, cloud save, telemetry)
- `js/main.js` — bootstrap, input routing (pointer/touch/keyboard/gamepad), lifecycle
- `server.js` — zero-dependency Node host: static files, `/api/v1/*`, replay-validated leaderboards
- `starhermit.txt` — distribution manifest (`name=Pair Sum`, `launch=index.html`, `server=server.js`)

## Controls

Arrows move · Enter connects · Esc cancel/pause · H hint · U undo · A add rows ·
R camera reset · gamepad supported. Touch: tap two tokens; everything else is
in the bottom tray.
