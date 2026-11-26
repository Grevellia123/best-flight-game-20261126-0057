# Volcano Sky Courier

A bush seaplane mail run over a volcanic Indonesian archipelago at golden
hour. Entry for make.fun bounty `best-flight-game-20261126-0057` — "Make the
best flight game".

Fly the glowing rings, pick up cargo mid-route, and land it on the island
strip. Six deliveries across three days, with wind, fuel, ash clouds and
wave strikes turning each sortie into decisions.

## Play

Serve `game/` locally and open it in a desktop browser:

```sh
node serve.ts
# open http://localhost:8080
```

## Controls

- **A/D** or **←/→** — steer (mouse steers too)
- **W/S** — throttle up / down
- **↑/↓** — climb / descend
- **P** — pause, **M** — mute, **R** — restart run, **Enter** — start / continue

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
