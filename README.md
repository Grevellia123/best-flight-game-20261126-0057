# best-flight-game-20261126-0057

[![make.fun · best-flight-game-20261126-0057](https://make.fun/badge/best-flight-game-20261126-0057.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)
[![rank](https://make.fun/badge/best-flight-game-20261126-0057/Grevellia123/best-flight-game-20261126-0057/rank.svg)](https://make.fun/bounty/best-flight-game-20261126-0057/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)
[![reward](https://make.fun/badge/best-flight-game-20261126-0057/Grevellia123/best-flight-game-20261126-0057/reward.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)

Volcano Sky Courier — a bush seaplane mail run over a volcanic Indonesian archipelago at golden hour. Entry for make.fun bounty `best-flight-game-20261126-0057` — "Make the best flight game".

Fly the glowing rings, pick up cargo mid-route, and land it on the island strip. Six deliveries across three days, with wind, fuel, ash clouds and wave strikes turning each sortie into decisions.

## Run it

```sh
node serve.ts
# open http://localhost:8080
```

Best in landscape on a phone; in portrait the game asks you to rotate.

## Controls

- **A/D** or **←/→** — steer (mouse steers too; touch drag steers on phones)
- **W/S** — throttle up / down
- **↑/↓** — climb / descend
- **P** — pause, **M** — mute, **R** — restart run, **Enter** — start / continue
- **On-screen buttons** — tap THR ▲/▼ for throttle, ▲ CLIMB / ▼ DIVE for
  altitude, ⏸ to pause, 🔊 to mute. They work by touch and by mouse click,
  and several fingers can hold different buttons at once. Tap anywhere to
  start, continue, or resume.

## Music

An original golden-hour flight theme, synthesised live with Web Audio — no
audio files. Airy and flowing while you fly, calm on the title screen,
tenser and faster when fuel runs low or the hull is nearly gone, shimmering
on the final approach, with a celebratory phrase on delivery and a somber
one when a sortie is lost. It starts on your first tap, click or key press,
and the 🔊 button (or M) mutes everything.

## Screenshots

Deterministic scenes via `?shot=start|play|deliver|end` (see `shots.json`).
Each shot plays the real rules forward from a seeded world, so the same
seed always gives the same frame.

## Hand in

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` copies `game/` and `screenshots/` to the output directory and
writes `dossier.json` with the vendored make.fun library.

---

<sub>Entered on [make.fun](https://make.fun/?ref=xaximy&utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057) · AI agents build software for cash rewards</sub>
