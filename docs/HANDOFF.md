# Session Handoff — 2026-06-11

Continuation notes for the next working session. Delete this file once the
roadmap below is done.

## Where things stand

- **Merged:** PR A (0.1 stabilization), PR #9 / PR B (tile-paint zones for
  farm/stockpile/wall + GitHub Actions test workflow).
- **Open:** PR #10 (draft) — Electron desktop app + auto-updating release
  pipeline. Branch `claude/magical-cori-7ife76` @ `752ab99`. CI status was
  not yet verified when the session ended — check it first.
- **After #10 merges:** trigger the Release workflow (push tag `v0.2.0`, or
  run `release.yml` via workflow_dispatch on main). It builds Windows NSIS /
  macOS DMG / Linux AppImage on a 3-OS matrix and publishes a GitHub
  Release. `package.json` is already at version 0.2.0. Installed copies
  auto-update from Releases on Windows/Linux (electron-updater); macOS
  auto-update needs signed builds, so users re-download the DMG there.
- **Ship loop from now on:** after each merged gameplay PR, bump
  `package.json` version + push a `v*` tag so the desktop app updates.

## User's standing instructions

- Each task = its own PR (draft). User merges and play-tests themselves.
- Be frugal with tokens: no re-verifying merged work; tests run on GitHub
  Actions (test.yml), only run *targeted* local tests when diagnosing.
- All development on branch `claude/magical-cori-7ife76`: after each merge,
  `git fetch origin main && git reset --hard origin/main`, build the next
  PR, push, open new draft PR from the same branch.
- Goal: "fully fleshed out game based on everything planned."

## Roadmap (remaining, in order)

### PR B2 — economy buildings (designed, not yet implemented)
New entries in `src/data/buildings.json` + handlers:
- **bakery** (3×2, provides `cook`): bigger/faster batches than kitchen
  (e.g. bakeWorkPerMeal ~12 vs 20, batch 8) — cook task already keys off
  `builtOf('cook')`; prefer bakery when present.
- **hunting lodge** (2×2, provides `hunt`, new WorkKind `hunt`): abstract
  hunting trips (~240 min work) yielding ~3 meals; one hunter per lodge
  (reserve by buildingId). Becomes concrete when animals land in PR C.
- **market** (3×3, provides `trade`): HUD barter panel on selection —
  `sim.trade(give, get, qty)` with fixed rates (wood/stone → grain etc.).
- **forester** (2×2, provides `forestry`, new WorkKind `plant`): plant
  saplings on free grass within radius ~6; add `Tile.sapling: boolean`
  reusing `t.growth`; mature → `kind='tree'` after ~8 days
  (updateSaplings alongside updateFarms). Needs a sapling sprite.
- **granary** (3×2, provides `granary`): meal cap = base 80 + 150 per
  granary; excess spoils in dailyUpdate() with a log line. Grain uncapped.
- **clinic** (2×3, provides `medical`, capacity 2): preferred bed-rest
  destination in goSleep()/decide(); ~2× healthRegen while resting there.

New Provides: `hunt | trade | forestry | granary | medical`. New WorkKinds
`hunt`, `plant` — WORK_KINDS drives skill init and the priorities UI
automatically (sim.ts ~line 257 spawn loop). One fast test per building.

### PR C — defense & game feel
Gates (paintable zone kind: settlers pass, raiders treat as wall), armed
pawns, animals (deer → real hunting, wolves), keyboard hotkeys for the
palette, in-game menu (pause/restart + save/load), audio (WebAudio SFX).
Save/load matters for the desktop app — serialize Simulation (mostly plain
data) to JSON, localStorage or file.

## Architecture crib sheet (avoid re-reading the big files)

- `src/sim/sim.ts` (~1600 lines), Simulation class:
  - `findTask()` ~1080: task generation (farm zones → cook → craft → bury
    → medic), candidates sorted prio/dist, `reserved` set dedupes via
    `taskKey()` (`kind:buildingId|itemId|patientId|x,y`).
  - `runTask()` switch ~1148: cases chop/build/farm/cook/craft/bury/medic/
    haul. Work speed = (0.5 + skill×0.1) × trait × softCap × sick × rain.
  - `decide()` ~975: need priority — food FIRST (death-spiral fix), then
    bed-rest (`goSleep`), sleep, warmth, recreation.
  - `dailyUpdate()` ~494: population flows, raid scheduling, winter crop
    kill, drought/flood. `updatePopulationFlows()` ~548.
  - Zone API: `planZone(kind,x,y)` (TOGGLES — second paint clears),
    `bulldozeTile(x,y)` (right-click), `nearestStockpileTile(pos)`.
  - `builtOf(provides)` returns built Buildings by their `provides` tag.
- `src/sim/world.ts`: Tile { kind: grass|tree|rock|water|soil, road,
  roadPlan, farmZone, stockpileZone, wall, wallPlan, wallHp, sown, growth,
  fertility, marked, buildingId }. `passable()` blocks wall, wallPlan,
  water-without-bridge, rock, buildings. Map 64×64.
- `src/sim/defs.ts`: TUNING (all balance numbers), BUILDING_DEFS from
  `src/data/buildings.json` — **no trailing commas** (broke Vite JSON
  parse once). Current building ids: house, kitchen, hall, hearth, tailor,
  graveyard (farm/stockpile/palisade are zones now, NOT buildings).
- Farms are instantly workable when painted (no construction). This
  shifted the sim timeline — the raid test asserts a `'The raid is over.'`
  log rather than `raidActive === false` at an arbitrary day.
- UI: `hud.ts` — palette ZONES section drives `cam.placingZone: PaintKind`;
  HUD rebuilds innerHTML every frame, so **never bind onclick on rebuilt
  nodes — use mousedown delegation** (cancel-build/priorities bug history).
  `render.ts`: zones in pass 1, walls/HP bars in pass 2.
  `sprites.ts`: `buildSprites()` returns SpriteSet (stockpileZone,
  wallPlan, palisade already added). `main.ts`: drag-paint dispatcher
  (road kinds dirt/plank/gravel/bridge → planRoad, else planZone);
  contextmenu → bulldozeTile.
- Tests: `tests/sim.test.ts` has `paintFarm(sim,x,y,w,h)` helper; 4 files,
  ~40 tests, full suite ~4 min in CI (60-day survival test ~140 s alone).
  Headless balance harness: `npm run sim -- [days] [runs]`.

## Gotchas

- `ELECTRON_SKIP_BINARY_DOWNLOAD=1` for npm install in test CI (already in
  test.yml) and locally — the Electron binary is only needed to run the
  shell or package installers.
- electron-updater is CJS — loaded via `createRequire` in
  `electron/main.js`; update check only runs when `app.isPackaged`.
- `vite.config.ts` sets `base: './'` so the bundle loads over `file://`
  in Electron — do not remove.
- GitHub MCP tools are restricted to aslater100/Colonysim; PR events
  arrive as webhooks (failures only — CI success is never delivered, so
  poll `get_check_runs` / `pull_request_read` after pushes).
