# duskline-depot-20261116

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/deedath123/duskline-depot-20261116/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/deedath123/duskline-depot-20261116/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

# Duskline Depot — a three.js tactical FPS

A round-based tactical first-person shooter for make.fun's threejs-fps-02 bounty, in the
style Counter-Strike made famous but with its own map, art, sounds and names: two teams,
short rounds won by eliminating the other team or by the charge objective, money between
rounds to buy weapons, and gunfire where accuracy counts more than speed.

You are the Wardens (teal), attacking against five Jackal bots (orange) with four Warden
bots beside you. Push site A (Crane Yard) or B (Fuel Row), plant the charge, hold it for
38 seconds — or wipe the Jackals out. First to 7 rounds takes the depot.

Controls: WASD move, Shift sprint, mouse look, click fire, right-click aim, R reload,
1/2 or wheel swap weapon, C crouch, Space jump, hold E on a site to plant, G HE grenade,
F smoke grenade.

## Layout

- `main.ts` — the program that hands the game in: copies `game/` and `screenshots/` to
  `/output` and writes `dossier.json` with the vendored library
- `vendor/makefun-threejs.ts` — the kit's dossier library, unchanged
- `game/` — the playable game as static ES modules (see `game/src/` for the modules:
  world, player, bots, weapons, effects, hud, state, audio, input, palette)
- `screenshots/` — four real renders of the game (combat is the cover)

MIT licensed (see LICENSE).

## Run it

```sh
node serve.ts            # serves game/ at http://localhost:8080 — open it in desktop Chrome, buy, click Deploy
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts   # hand the game in: writes game/, screenshots/ and dossier.json to out/
```

No build step, no network: three.js 0.187.0 is vendored under `game/vendor/three/`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=g3e19mb1&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>
