# Plan: Centuria — Pre-Req Fixes + Seamless World System

---

## Track C — Scale Engine (Songs-of-Syx-scale town tier)

**Decision (2026-06-14):** build a fresh data-oriented town engine alongside the
current `Simulation`, prove each stage on the bench, swap when it beats the old
core on both speed AND behavior parity. The current game stays untouched and
playable throughout. Region tier (politics/econ/central banks/exchanges) is
month-cadence over 4–8 factions — cheap, sits on top, not part of this track.

**Why:** `scripts/bench-scale.ts` showed the fat-object sim costs 13ms/tick at
just 200 agents and grows superlinearly (629MB heap at 5k). Two walls: GC from
fat per-agent objects, and per-agent A* every idle tick.

**Stage 1 — SoA agent core. ✅ LANDED.** `src/sim/agents.ts` (`AgentStore`):
every agent field in flat typed arrays, allocation-free tick, swap-remove deaths,
time-sliced decisions. `scripts/bench-agents.ts` proves the floor:

| agents | fat-object | SoA core | heap old→new |
|---|---|---|---|
| 200 | 13.2 ms | 0.018 ms | 16 → 7 MB |
| 5000 | 1663 ms | 0.098 ms | 629 → 9 MB |
| 10000 | n/a | 0.194 ms | 7 MB flat |

Caveat: cost FLOOR only — straight-line movement, no jobs/pathing yet.

**Stage 2 — Flow-field pathing. ✅ LANDED.** `src/sim/flowfield.ts` (`FlowField`):
one Dijkstra sweep from a hot destination (stockpile, hearth, job cluster) over the
whole map — O(map), paid once — yields an integration field (cost-to-goal) plus a
per-tile step direction; every agent heading there reads its tile's direction in
O(1). The cost model matches `world.findPath` (entering a tile costs `1/speedMult`,
so roads pull the field exactly as A* would); diagonals never cut a wall corner.
Standalone + DOM-free (typed arrays, preallocated heap, allocation-free `build()`),
so it runs headless, in the bench, against `world.ts`, or in a future worker.
`AgentStore` follows registered `fields` instead of straight-lining; with none
registered it keeps the Stage-1 wander so the bench still reads the cost floor.

| pass | 1000 | 5000 | 10000 | per-field build |
|---|---|---|---|---|
| floor (no pathing) | 0.018 ms | 0.087 ms | 0.173 ms | — |
| flow-field pathing | 0.027 ms | 0.146 ms | 0.273 ms | ~2.5 ms / 96² (once) |

Pathing adds ~0.03 µs/agent over the floor vs the fat-object sim's per-idle-agent
A* (1663 ms at 5k). Tests: `tests/flowfield.test.ts` (11 cases, incl. `world.findPath`
reachability parity on a real generated map). Bench: `scripts/bench-agents.ts` (two
passes — floor vs flow-field). Next: Stage 3 wires the job board so a field's goals
come from open jobs rather than a fixed destination.

**Stage 3 — Job board.** Central open-job list; agents pull nearest matching job
(O(agents+jobs)) instead of each scanning the map (O(agents×map)). Replaces
`findTask`'s per-settler full scan.

**Stage 4 — Behavior port. 🔶 IN PROGRESS.** Move full-fidelity needs/mood/thoughts/
skills/combat/traits onto the SoA columns until the new core matches the old sim's
behavior. Add headless parity tests.

- ✅ **Traits + skills (v0.33.0).** `AgentStore` gains a `skill` column plus two
  trait-index columns (`trait0`/`trait1`) whose effects are collapsed once, at
  spawn, into flat multiplier columns (`workSpeedMult`/`moodBaseBonus`/
  `warmthDecayMult`/`foodDecayMult`/`housingPref`) so the hot tick reads one
  multiplier instead of re-walking a `string[]` per agent (the fat sim's per-tick
  allocation+branch cost). The 21-way per-`WorkKind` skill split — a discrete-
  building artifact — collapses to one craft `skill` that accelerates whichever
  station an agent mans: `tickProduction` now sums worker *effort*
  `(0.5 + skill×0.1) × workSpeedMult` (skill 5 + neutral traits = 1.0, so every
  pre-existing test is bit-identical). Skill grows `0.06/hr` while Working, capped
  at 10; food decay × `foodDecayMult`; exposed warmth loss × `warmthDecayMult`;
  mood target += `moodBaseBonus`, clamped 0..100 (matches the fat sim). `TownCore`
  rolls two distinct traits + a 0..7 starting skill on every founder/newcomer.
  Serialization persists `skill`/`trait0`/`trait1` and re-derives the mults on load
  (pre-Stage-4 saves backfill to competent+untraited). Tests: `tests/persona.test.ts`
  (14 cases). `agents.ts` stays pure/SoA — only new import is `TRAIT_DEFS` from defs.
- ⬜ **Remaining Stage-4 slices** (each its own PR): wounds/infection/sickness +
  medical recovery; relationships/thoughts/mood events; combat power + raids;
  weather (temperature → warmth model); trading/economy. Each needs headless
  parity tests vs the fat sim's behavior before B-6 PART 2 (the live swap).

**Stage 5 — Render + bigger maps.** 96×96 holds only ~9k tiles; SoS cities need
larger worlds. Wire to the chunk-LOD renderer (Phase 4 foundation already landed).
Swap the live town tier to the new core once it wins on speed + parity.

### Build-system rewrite — layered rooms (decided 2026-06-14)

**Decision:** drop pre-built building objects for the Songs-of-Syx model — the
player paints **walls → floors → room designations → workstations**, and the useful
spaces emerge from their combination. A room does nothing on its own; **its output
is the SUM of the workstations inside it** (place another oven, get another bread
slot — the bakery scales with the floor you give it). Built natively on the scale
engine, where it unifies the remaining stages: a craft station with no worker *is* an
open job (Stage 3 job board), station tiles *are* flow-field goals (Stage 2), and
beds/desks/sickbeds *are* the need capacities (Stage 4). The live `Simulation` and
its 33 discrete buildings stay playable until the final swap.

Stages (extend Track C; the live game is untouched until B-6):
- **B-1 — Foundation. ✅ LANDED.** `src/sim/build.ts` (`BuildGrid`): four flat
  typed-array layers (`wall`/`floor`/`roomType`/`station`) + a `roomId` derived by
  O(map) flood-fill into `rooms` (connected same-designation floor; walls and type
  changes are boundaries; enclosure tested for warmth later). `roomOutput()` sums a
  room's valid stations into sleep/recreation/education/medical/storage capacities +
  a net resource `flow`. Stations resolve to the room under their origin and are
  inert if the room type doesn't accept them. Pure, DOM-free, `passable()` exposed
  for `FlowField`; same ethos as `agents.ts`/`flowfield.ts`. Data: `src/data/rooms.json`
  (14 room types) + `src/data/stations.json` (19 workstations: craft recipes +
  capacity slots), loaded via `ROOM_DEFS`/`STATION_DEFS` in `defs.ts` with 1-based
  numeric layer ids and load-time cross-ref validation. Tests: `tests/build.test.ts`
  (13 cases). Additive — not wired into the live sim.
- **B-2 — Production. ✅ LANDED.** `src/sim/stockpile.ts` (`Stockpile`): a
  `Float32Array` resource store indexed by the stable `RESOURCE_KINDS` order
  (new `defs.ts` export) — allocation-free reads, atomic `removeAll()`, sparse
  `snapshot()`. `AgentStore` gains a `stationId` SoA column +
  `assignStation()`/`unassignStation()`. `BuildGrid.tickProduction(agents,
  stockpile, minutesPerTick)` does an O(agents) worker-count pass, then advances
  each craft station's recipe by `minutesPerTick × workers`, firing at
  `recipe.work` (atomic `removeAll` of inputs → add outputs, excess progress
  carries forward), stalling clamped when inputs are short; capacity stations
  are skipped. Duck-typed `WorkerSource` keeps `build.ts` import-free of
  `agents.ts`. Tests: `tests/production.test.ts` (16). Additive.
- **B-3 — Job board (= Stage 3). ✅ LANDED.** `src/sim/jobs.ts` (`JobBoard`):
  `rebuild()` derives the open-job list = craft stations in a valid room, unmanned,
  inputs in stock (optional `Stockpile`); `assignIdle()` greedily matches idle
  agents to the nearest open job (injectable `JobCostFn`, default Manhattan;
  flow-field cost honours walls), `O(idle × jobs)` — replaces `findTask`'s
  per-settler `O(agents × map)` scan; `buildField()` collapses open jobs into one
  multi-source `FlowField` for "walk to nearest job" movement. Haul jobs wait on a
  spatial stockpile (current `Stockpile` is town-global). Tests: `tests/jobs.test.ts`
  (13). Additive.
- **B-4 — Needs from rooms (= part of Stage 4). ✅ LANDED.** `src/sim/needs.ts`:
  `aggregateCapacities(grid)` sums every usable room's sleep/recreation/education/
  medical/storage (enclosure-required types contribute nothing until walled);
  `roomAt(grid,x,y)` resolves an agent's room in O(1); `serveNeeds(grid, agents,
  minutesPerTick)` applies room-driven recovery to the SoA need columns — enclosure
  → warmth (toward 100, exposed cools to an ambient floor), Sleeping in a free bed
  slot → rest, a free recreation slot → recreation (both bed/table capacity-gated).
  Kept out of `AgentStore.tick` so the bench still reads the movement floor. Tests:
  `tests/needs.test.ts` (13). Additive.
- **B-5 — Render + paint UI. ✅ LANDED.** `src/data/blueprints.json` (7 templates); `BlueprintDef`+
  `BLUEPRINT_DEFS` in `defs.ts`; `BuildGrid.stampBlueprint()`; `Camera` gains `buildGrid`/`roomPaintMode`/
  `roomTypeId`/`stationTypeId`/`stampBlueprint`; `render.ts` draws floor-tint + per-room-type colour
  overlay + station labels + blueprint/paint-cursor ghosts; `hud.ts` ROOMS category with Wall/Floor/Erase
  tools, 14 room-type buttons, 10 station buttons, 7 blueprint stamps ([V] hotkey for wall); `main.ts`
  wires drag-paint + single-click stamp against a standalone `BuildGrid`. Tests: `tests/blueprints.test.ts` (7). Additive.
- **B-6 — Integrated town core (swap candidate). 🔶 PART 1 LANDED.** `src/sim/towncore.ts`
  (`TownCore`) is the first half of B-6: it **composes every scale-engine module into one
  deterministic, serializable simulation** — the thing the final swap installs in place of the
  fat-object `Simulation`. Per-tick it runs the plan's data-flow end to end: sleep/wake + need-
  interrupt state transitions → `JobBoard.rebuild`/`assignIdle` (idle agents claim the nearest
  open craft station, routed by a job `FlowField`) → `BuildGrid.tickProduction` (recipes consume/
  produce against the shared `Stockpile`) → `serveNeeds` (room warmth/rest/recreation) →
  `AgentStore.tick` (needs decay, mood, movement) → swap-remove deaths → day rollover that feeds
  agents from produced meals and grows/loses population. Round-trip serialization added to the three
  stateful modules — `Stockpile.serialize/deserialize`, `AgentStore.serialize/deserialize`
  (`AgentStoreSave`; NaN dest sentinel persisted as null), `BuildGrid.serialize/deserialize`
  (`BuildGridSave`; painted layers base64, stations + recipe progress preserved, `station`/`roomId`
  layers + `rooms` re-derived on load) — and `TownCore.serialize/deserialize` (`TownCoreSave`, v1).
  Pure/DOM-free with a `npx tsx src/sim/towncore.ts` self-check (determinism + round-trip) and
  `tests/towncore.test.ts` (12 cases). **Still additive — the live game is untouched.**
  **PART 2 (the actual swap) is deliberately deferred and gated:** wiring `TownCore` into `main.ts`/
  `render.ts` in place of `Simulation`, the save-format v-bump on the live save, and retiring
  `buildings.json` must wait on (a) **behavior parity** with the fat-object sim's 526-test surface
  (combat/raids/weather/trading/economy/traits/skills are not yet ported onto the SoA columns) and
  (b) a **GUI play-test** — neither is safe to do blind from headless CI. Land PART 2 once the
  parity port (the rest of Stage 4) is done and the user has play-verified the new core.

---


## Session Handoff (Read This First in a New Session)

**Repo:** `/home/user/Centuria` — TypeScript + Canvas 2D + Vite + Electron city-builder.  
**Git remote:** `aslater100/centuria` — never push to `main` without user approval; one feature branch + draft PR per stage.  
**Plan file:** `PLAN.md` (this file, committed to repo)  
**Toolchain:** `npm ci` once per fresh container, then `npx vitest run` (full suite ~90s), `npx tsc --noEmit`, `npm run build`. CI (`.github/workflows/test.yml`) runs `npm install → npm run build → npm test` on Node 24. Note: `tsconfig` `include` is `["src"]`, so `tsc` checks `src/` only — `tests/` and `scripts/` are verified by `vitest`/`tsx` at run time, not by `tsc`.

### Current state (updated 2026-06-14)

**Test baseline: 540 passing** (526 prior + 14 persona). `tsc` + `vite build` clean. B-2→B-6 PART 1 merged. **Stage 4 behavior port has begun: traits + skills landed (v0.33.0, `tests/persona.test.ts`).**

**Scale engine (Track C):**
- **Stage 1 ✅** — `src/sim/agents.ts` (`AgentStore`, SoA agent core).
- **Stage 2 ✅** (PR #100, merged) — `src/sim/flowfield.ts` (`FlowField`) + `AgentStore` flow-field following + two-pass `scripts/bench-agents.ts` + `tests/flowfield.test.ts`.
- Stages 3–5 are now subsumed by the build-system rewrite below (job board = open stations, etc.).

**Build-system rewrite (replaces pre-built buildings with painted walls/floors/rooms/workstations):**
- **B-1 ✅** (PR #101, merged) — `src/sim/build.ts` (`BuildGrid`) + `src/data/rooms.json` (14 room types) + `src/data/stations.json` (19 workstations) + `ROOM_DEFS`/`STATION_DEFS` loaders in `defs.ts` + `tests/build.test.ts`.

**▶ Pick up next: Build-system B-6 PART 2 — the live swap (gated).** B-1→B-5 and **B-6 PART 1**
(the integrated `TownCore` swap candidate) have landed. `TownCore` already composes all the
scale-engine modules into one deterministic, serializable town sim with tests. Before PART 2
(wire `TownCore` into `main.ts`/`render.ts`, retire `buildings.json`, v-bump the live save) is
safe, two things must happen first: **(1) finish the Stage-4 behavior port** — combat, raids,
weather, trading, economy, traits and skills still live only on the fat-object `Simulation`,
not on the SoA columns, so a swap today would lose them; add headless parity tests asserting the
new core matches the old sim's behavior. **(2) GUI play-test** the new core (paint a town, watch
it run) — the destructive swap can't be validated from headless CI alone. PART 2 touches
`render.ts`/the live sim and is destructive, so it needs design review + the user's play-verify
before starting. Full breakdown in the **Build-system rewrite** subsection under Track C above.

**Key data-flow once B-5/B-6 wire it together:** `JobBoard.rebuild` → `assignIdle`
(idle agents claim nearest unmanned craft station) → `BuildGrid.tickProduction`
(recipes consume/produce against the shared `Stockpile`) → `serveNeeds` (rooms top up
warmth/rest/recreation). `aggregateCapacities` feeds the housing/services caps.

**Key invariant for the scale-engine modules** (`agents.ts`, `flowfield.ts`, `build.ts`, `fogmap.ts`, `parcel.ts`): pure, DOM-free, typed-array/SoA, each with a `npx tsx <file>` self-check and a dedicated test file, and **additive** — none is wired into the live `Simulation` yet. The current 33-building game stays playable until the final swap (B-6).

### Sim + World Optimization (landed 2026-06-14)

Five concrete hot-path fixes applied and verified (441 tests pass):

| Fix | File | Mechanism | Win |
|---|---|---|---|
| **Per-tick tile scan** | `sim.ts` | `buildTileTaskScan()` scans MAP once per tick; `findTask()` reads the cached lists instead of doing 5 separate 9,216-tile sweeps per idle settler | ~5× fewer tile iterations in findTask with any idle settlers |
| **Remove settlers spread** | `sim.ts` | `tick()` iterated `[...this.settlers]` (new array every tick); replaced with backwards index loop (splice-safe, zero allocation) | GC pressure eliminated |
| **Fog skip when stationary** | `sim.ts` | `_settlerLastRevealIdx` tracks last tile index per settler; `revealAround()` called only when the settler moves to a new tile | ~70% of reveal calls eliminated for working/sleeping settlers |
| **Soil tile cache** | `sim.ts` | `soilTiles()` builds a filtered slice once from worldgen output (soil never changes kind); `accrueDormantFarms()` and the winter-kill loop iterate only soil tiles | Dormant tick and daily winter scan skip ~80% of tiles |
| **A\* road check cache** | `world.ts` | `findPath()` scanned all 9,216 tiles every call to detect any road; now uses `_anyRoadDirty`/`hasAnyRoad()` — recomputed only when `invalidatePathCache()` is called (terrain change) | O(n) per pathfind → O(1) |
| **FOOD_HAUL_KINDS constant** | `sim.ts` | Module-level `ReadonlySet`; was `new Set(...)` inside `findTask()` per idle settler | Allocation eliminated |
| **countAssigned precompute** | `sim.ts` | Was `settlers.filter(...)` per building per task; now `Map<buildingId, count>` built once at start of `findTask()` | O(n²) → O(n) |

### Track A status — verified against source 2026-06-14 (v0.31.0)

Track A is **substantially complete**; the bug fixes landed alongside the governor-tier work
(see `docs/HANDOFF.md`). Verified by reading the live code:

| Fix | Status | Evidence |
|---|---|---|
| **1 — Worldgen sparse** | ⚠️ **Partial** | Ore deposits done (`worldgen.ts` `generateOre()`, `Cell.ore`). The FBM/river/mountain *density retuning* was deliberately **not** applied — the shipped game (and its colony-balance/CI tests) is tuned around the current generator (4 octaves, mountain >0.72, ≤7 rivers); `worldgen.test.ts` passes as-is. Retuning is deferred to avoid destabilizing live balance. |
| **2 — Stockpile/cook/preempt** | ✅ Done | `CAPACITY_PER_TILE`/`NEED_INTERRUPT_THRESHOLD`/`cookTriggerMult` in `defs.ts`; capacity + cook + need-break preemption wired in `sim.ts`. |
| **3 — Tech gating** | ✅ Done | `requiredTech` in `buildings.json`, enforced in `sim.ts` `canPlace()` and disabled in `hud.ts`. |
| **4 — Upgrade visuals** | ✅ Done | `render.ts` keys building sprites by `` `${defId}:${level}` ``. |
| **5 — Gate meshing** | ✅ Done | `sprites.gateVariants[16]`; `render.ts` neighbor-mask gate draw. |
| **6 — Supply chains** | ✅ Done | flour/bread/flax/quarry/timber/brick wired in `sim.ts`; `stockHistory` tracked; **RES** resources panel in `hud.ts`. |
| **7 — Treasury continuity** | ⬜ Deferred | By design folded into **Track B Phase 2** (no `ParcelManager` / `homeSim` canonical economy exists yet). |

**Net:** the active forward work is **Track B (Seamless World)**, which also subsumes Fix 7.

**Track B progress:**
- ✅ **Phase 1** — `src/ui/worldcam.ts` (WorldCamera + world coordinate system). Additive; not yet wired into `main.ts` (mode switch stays as dev fallback). Tests: `tests/worldcam.test.ts`.
- ✅ **Phase 2** — `src/sim/parcel.ts` (`Parcel` + `ParcelManager`). 64×64 parcel grid over the region; home parcel auto-owned sharing the live `Simulation.world`; lazy seed-deterministic terrain per parcel; expansion cost formula (`PARCEL_TUNING` in `defs.ts`); **unified economy (Fix 7)** — all gold routes through the home `Simulation.economy.cash`, so expansion can't reset the treasury; `serialize()`/`deserialize()` persist only ownership/exploration (terrain regenerates from seed). Additive; not yet wired into `main.ts`. Tests: `tests/parcel.test.ts`.
- 🔶 **Phase 3** — *sim-side landed; UI pending.*
  - ✅ **Tech gating (sim):** the three expansion techs now drive `ParcelManager`. `land_survey` relaxes purchase from "orthogonally adjacent" to "any explored frontier cell"; `road_building` discounts every acquisition (`PARCEL_TUNING.roadDiscount = 0.8`); `cartography` widens the post-purchase reveal from the 4 orthogonal neighbours to a Chebyshev block (`PARCEL_TUNING.cartographyRevealRadius = 2`). Gating is via an injectable `ParcelManager.hasTech` predicate (default = nothing researched, so the data model stays standalone and its tests stay pure); wire it to `RegionSim.has` at integration time. Tech ids centralised in `EXPANSION_TECHS` (`defs.ts`). Tests: `tests/parcel.test.ts` (4 new cases).
  - ✅ **Tech tree data:** `land_survey` / `road_building` / `cartography` added to `src/data/techtree.json` (region `tech` tree; `land_survey` ← `steam_power`, the other two ← `land_survey`).
  - ⬜ **Remaining:** the purchase UI itself (right-click a fog-adjacent cell → cost-breakdown panel → `purchase()`), and pointing `ParcelManager.hasTech` at the live `RegionSim`. Deferred deliberately: the only place to host it today is the 123 K-line `regionview.ts`, which Phase 4 replaces with the seamless `WorldCamera` renderer — building throwaway UI there is wasted effort, and it can't be exercised by the headless CI. Land the UI together with the Phase 4 renderer (or once `ParcelManager` is wired into `main.ts`).
- 🔶 **Phase 4** — *chunk-summary foundation landed; render.ts pipeline pending.*
  - ✅ **Chunk summaries (`src/ui/worldchunks.ts`):** a parcel collapses into a cheap, blittable `ChunkSummary` for the two zoomed-out tiers — a `CHUNK_RES`×`CHUNK_RES` (48², dominant-kind) terrain raster as a flat RGBA `Uint8ClampedArray` (directly `new ImageData(...)`-wrappable for Mode B), a single dominant-biome hex colour for the Mode C far block (`biomeColorOf`), per-building icon markers coloured by category (`categoryOf` → housing/food/production/military/civic, `Record<Provides, …>`-typed so a new `provides` won't compile until it's categorised, plus barracks/armoury defId overrides), and a stockpile fill swatch (fill ratio vs `stockpile_tiles × CAPACITY_PER_TILE`, tinted by the dominant stored resource). `ChunkCache` memoises one summary per `"cellX,cellY"` and recomputes only on an explicit `markDirty` (build/demolish/stock swing). Pure & DOM-free (produces pixel buffers + marker lists, never canvases), so it runs headless and in the Phase 7 worker; thresholds already live in `worldcam.ts` (`renderModeFor`, `CHUNK_ZOOM`/`TILE_ZOOM`). Tests: `tests/worldchunks.test.ts` (10 cases).
  - ⬜ **Remaining:** the `render.ts` 3-mode dispatch (rasterise summaries onto offscreen chunk canvases, Mode A↔B cross-fade, Mode C `ImageData` blit), `ChunkCache.markDirty` wiring to build/demolish/stock events, and cross-chunk pathfinding. Lands with the `ParcelManager`→`main.ts` integration that also unblocks the Phase 3 purchase UI and Phase 5 dormant loop.
- 🔶 **Phase 5** — *sim-side landed; main-loop wiring pending.*
  - ✅ **Dormant tick (sim):** `Simulation.tickDormant()` + `isActive` flag. Once-a-day coarse update — crop growth + auto sow/harvest into the stockpile, plus the existing food-gated population flows — skipping every per-tick agent path (pathfinding, needs/deaths, raids, weather drama, trading). Self-contained and additive, mirroring the Phase 2/3 approach. Tests: `tests/dormant.test.ts`.
  - ⬜ **Remaining:** the `main.ts` budget loop (active = full ticks, dormant parcels round-robin one `tickDormant()` per game-day) — lands when `ParcelManager` is wired into `main.ts` alongside Phase 4.
- 🔶 **Phase 6** — *foundation landed; region.ts adoption pending.*
  - ✅ **Typed-array fog (`src/sim/fogmap.ts`):** `FogMap` — a 100×100 `Uint8Array` with the same three-state `fogged/explored/scouted` semantics as `RegionSim.explorationMap`, a circular `reveal()` matching `revealTiles`, `clearScouted()`, `exploredFraction()` (for the zoom-out gate), compact base64 (de)serialization (scouted persisted as explored, as today), and `fromLegacyRows()`/`toLegacyRows()` migration off the existing `'0'`/`'1'` row-string save format. Portable base64 (no Buffer/btoa) so it runs in Node, browser, and the Phase 7 worker. Additive — the live `region.ts` serializer is untouched. Tests: `tests/fogmap.test.ts`.
  - ⬜ **Remaining:** swap `region.ts`'s `explorationMap` reads/writes onto `FogMap` and migrate its serializer (v-bump + `fromLegacyRows` on load), plus the multi-zoom fog rendering. A broad refactor across the 6,967-line `region.ts` with save-compat surface — sequence it with the Phase 4 renderer so fog and chunks change together.

### What this plan covers (two tracks, sequential)

**Track A — Pre-Requisite Bug Fixes** (8 bugs; do these first, each is self-contained):
All root-caused with exact file/line evidence. Fix in order: worldgen → stockpile/cook/preemption → tech gating → building upgrade visuals → gate meshing → supply chains → treasury continuity. Each fix has its own verification step at the bottom of the file.

**Track B — Seamless World** (7 phases; do after all Track A verifications pass):
Replace the hard `mode: 'town' | 'region'` switch in `main.ts` with a single continuous `WorldCamera`. Zoom drives everything: zoom ≥1.0 = full tile rendering; 0.3–1.0 = chunk canvas icons; <0.3 = biome pixel blocks. Player starts zoomed into founding town; world expands as they explore and purchase parcels.

### Validated codebase facts (confirmed against source — do not re-derive)

| File | Size | Key facts confirmed |
|---|---|---|
| `src/sim/sim.ts` | 3,348 lines | `Simulation` class: instance-scoped state, safe to instantiate N times. `serialize()` / `deserialize()` are pure JSON — no DOM/browser APIs. Cook trigger at `meals < settlers * 3` (~line 1965, re-read before editing as line numbers drift). |
| `src/sim/region.ts` | 6,967 lines | `explorationMap: TileVisibility[][]` — **100×100** (not 64×64), three states: `'fogged'`/`'explored'`/`'scouted'`. Serializer packs it as `'0'`/`'1'` string (scouted is ephemeral). |
| `src/sim/worldgen.ts` | 407 lines | `RegionMap.siteAt(x, y)` **already exists** at line 236–247 — returns `TownSite`. Do NOT add it; use it. Constructor calls `generate()` internally. |
| `src/ui/render.ts` | 22,614 lines | `TILE = 32`. Zoom currently 0.5–4.0. Wall bitmask uses 4-bit neighbor mask; gate rendering at line ~231 uses a single static sprite (bug). |
| `src/ui/regionview.ts` | 123,459 lines | Entire separate mode to be replaced by Track B. Do not modify during Track A. |
| `src/ui/hud.ts` | 41,032 lines | `renderSubmenu()` at line 381 — no tech filtering. |
| `src/ui/sprites.ts` | ~1,600 lines | `palisadeVariants[16]` at line 1502 — reuse this pattern for `gateVariants[16]`. Stockpile zone sprite at line 1458. |
| `src/sim/defs.ts` | ~300 lines | `TileKind = 'grass' \| 'tree' \| 'water' \| 'soil' \| 'rock'` (union, not enum — safe to add `'ore'`). `currencyFallback` at line 65 is a module-level `let` — minor gotcha if running multiple sims with different currencies; default all parcels to same currency. |
| `src/data/buildings.json` | ~200 lines | 32 building types. No `requiredTech` field — must be added to 17 buildings. |
| `src/data/town_techs.json` | ~150 lines | `unlocks` array is purely descriptive — never enforced in code. |
| `src/sim/headless.ts` | — | Loop at lines 87–94 already creates N independent `Simulation` instances — safe for multi-parcel testing. |
| `vite.config.ts` | 3 lines | Currently only `base: './'`. **Must add** `worker: { format: 'es' }` + `build: { target: 'ES2022' }` before Phase 7. |

### Key numbers (do not re-derive)
- World coordinate space: 64×64 region cells × 96×96 tiles × 32px = 196,608 world-px per axis (~37.7M tiles — must be data-sparse, not flat)
- Town parcel canvas: 96×96 tiles = 3,072×3,072px at zoom 1.0
- Region fog map: **100×100** (matching `explorationMap` dimensions), 10KB as `Uint8Array`
- FBM currently: 4 octaves / threshold 0.72 / max 7 rivers (all too low — Fix 1)
- Resources: 23 kinds total; 6 shown in UI; 4 never produced (`flour`, `bread`, `rope`, `preserved`)
- Buildings: 32 types; 17 should be tech-gated; none are (Fix 3)
- `serialize()` save format is currently `v: 3`; parcel migration targets `v: 4`

### Where to start
1. Read the Track A fixes in order.
2. Before editing any file, run `grep` for the exact function/line referenced — line numbers drift as fixes accumulate.
3. After each fix, run the corresponding verification step from the checklist at the bottom.
4. Do not begin Track B Phase 1 until all 14 Track A verification steps pass.

---

## Track A — Pre-Requisite Bug Fixes

### Fix 1: Worldgen Too Sparse
**File:** `src/sim/worldgen.ts`

Root causes: 4 FBM octaves (too smooth), mountain threshold 0.72 (too high), max 7 rivers, uniform west-east gradient.

Changes:
- Raise FBM to **6 octaves** (amplitudes: 0.5, 0.25, 0.125, 0.0625, 0.03125, 0.015625)
- Increase river sources to **15–20**; add secondary low-elevation network
- Lower mountain threshold to **0.65**; add hill plateau band at 0.58–0.65
- Add radial noise mask so inland areas get varied elevation independent of the east gradient
- Add **ore deposit tiles** (3–5 clusters per map in hills/mountains biome) — needed for mining

### Fix 2: Stockpile Capacity, Visual Fill, Cook Balance, Need-Break Preemption
**Files:** `src/sim/sim.ts`, `src/sim/defs.ts`, `src/ui/sprites.ts`, `src/ui/render.ts`

Root causes (each confirmed with line numbers):
- `stock: Record<ResourceKind, number>` has no max. `capacityBonus` in `BuildingDef` is never enforced.
- Stockpile zone sprite (`sprites.ts:1458`) is a static floor grid — no fill state.
- Cook trigger fires only when `meals < settlers * 3` (line ~1965) — ~1.1 day buffer, never "fills."
- `'store'` work kind declared in `WORK_KINDS` but zero task generation code.
- Grain cook check: `stock.grain > 0` — single grain halts cooking.
- Researchers/assigned workers don't preempt tasks for food/sleep.

Changes:
- Add to `defs.ts`: `CAPACITY_PER_TILE = 50`, `NEED_INTERRUPT_THRESHOLD = 20`, `cookTriggerMult = 8`
- Compute `stockpileCapacity = stockpile_tiles × CAPACITY_PER_TILE + Σ(building.capacityBonus)`. Block haul task when at limit.
- Raise cook trigger to `settlers * cookTriggerMult`
- Change grain check to `>= cookBatch`
- Implement `'store'` task generation: `grain > 40 && meals < settlers * 5` → emit haul task
- In settler tick loop: after each work step, if `s.food < NEED_INTERRUPT_THRESHOLD || s.sleep < NEED_INTERRUPT_THRESHOLD` → preempt task (re-queue it), redirect settler to need
- `sprites.ts`: add fill-level parameter to stockpile zone sprite; render 4–8 fill levels tinted by dominant resource (grain=amber, wood=brown, stone=grey, meals=green)
- `render.ts`: compute fill ratio + dominant resource at draw time; pass into zone sprite

### Fix 3: Tech Tree Gating Not Implemented
**Files:** `src/data/buildings.json`, `src/sim/sim.ts:468`, `src/ui/hud.ts:381`

Root cause: `canPlace()` checks only spatial constraints. `unlocks` in `town_techs.json` is never read.

Changes:
- Add `requiredTech?: string` to each of the 17 affected buildings in `buildings.json` (map from existing `town_techs.json` `unlocks` entries — the mapping is already documented there)
- `sim.ts:canPlace()`: prepend `if (def.requiredTech && !this.hasTech(def.requiredTech)) return false;`
- `hud.ts:renderSubmenu()`: for each building, check `sim.hasTech(item.requiredTech)`; if false, set `btn.disabled = true; btn.classList.add('locked'); btn.title = 'Requires: ' + techName`

### Fix 4: Building Upgrades Have No Visual Change
**Files:** `src/ui/render.ts:262`, `src/ui/sprites.ts`

Root cause: `sprites.buildings[b.defId]` — single canvas per defId, level never checked.

Changes:
- Change sprite cache key to `defId:level` (e.g., `"house:2"`)
- Pass `b.level` into sprite renderer; at level 2+ add visible overlay: extra pixel row at top (second storey hint), banner pixel, or roof-color shift
- Minimum viable: 1×4px vertical pip per tier, top-right corner of building tile, omitted at zoom < 0.5
- Pre-render all `maxLevel` variants at startup for buildings that have upgrades

### Fix 5: Gates Don't Mesh With Walls
**Files:** `src/ui/render.ts:231`, `src/ui/sprites.ts:1502`

Root cause: `g.drawImage(sprites.gate, px, py)` — single static sprite, no neighbor mask.

Changes:
- Create `sprites.gateVariants[16]` using same pattern as `palisadeVariants[16]` at line 1502
- Gate needs at minimum: straight-NS (mask 5), straight-EW (mask 10), isolated (mask 0); remaining 13 fall back to dominant-axis straight
- `render.ts`: replace line 231 with the same 4-bit neighbor mask computation used by walls (gate checks for `wall || gate` in all 4 cardinal directions)

### Fix 6: Supply Chains Broken, 17/23 Resources Invisible, Wrong Verbs
**Files:** `src/sim/sim.ts`, `src/ui/hud.ts`, `src/sim/defs.ts`, `src/sim/worldgen.ts`

Root causes (confirmed via code trace):
- Mill outputs `produce` not `flour` (line ~2400); task label "mill flour" is misleading
- `bread` declared but never produced or consumed
- `timber` and `brick` produced but no building consumes them
- `rope` and `preserved` declared but never produced
- Rock harvest uses task kind `'chop'` — label says "chop stone"; no quarry zone exists
- 17 of 23 resources invisible in UI; no Resources tab

Changes:
- `sim.ts`: change mill output from `produce` to `flour`
- `sim.ts`: add bakery task `2 flour → 2 bread`; add `bread` to `mealKinds`
- `sim.ts`: wire `timber` into construction build costs for cottage, longhouse, warehouse; wire `brick` into kiln, well, watchtower build costs; make armoury consume `timber` instead of `wood` (matches existing description text)
- `sim.ts`: add flax field zone (parallel to farm zone); flax grows like grain, harvested as `flax`
- `sim.ts`: add quarry zone mechanic (parallel to farm zone); settlers auto-quarry designated rock tiles; rename rock-harvest task label from `'chop'` → `'quarry'`
- `sim.ts`: add `stockHistory: Partial<Record<ResourceKind, number[]>>` tracking daily snapshots (rolling 7-day window) for production/consumption rate display
- `worldgen.ts`: ore deposit tile placement (3–5 clusters in hills/mountains)
- `hud.ts`: add **Resources tab** — all 23 resources grouped (Basic / Refined / Food Variety); per resource: stock, 7-day avg production rate, 7-day avg consumption rate, net flow (green/red); flag resources with consumers but zero producers as "No source" in red

### Fix 7: Treasury Resets on Expansion
**Files:** `src/sim/sim.ts`, `src/sim/region.ts`, `src/main.ts`

Root cause: town-tier `Simulation.gold` and region-tier `RegionSim` treasury are separate; mode switch loses context.

Changes (integrated with Track B Phase 2):
- Home parcel's `Simulation.stock` and `Simulation.gold` become the **canonical global economy**
- `ParcelManager` (new, Track B) holds a reference to `homeSim`; parcel purchase deducts from `homeSim.gold`
- Dormant parcel production feeds into `homeSim.stock`
- `RegionSim` player treasury field deprecated; AI faction economics stay in `RegionSim`
- Save migration v3→v4: copy `regionSim.playerGold` into `homeSim.gold` if non-zero

---

## Track B — Seamless World (7 Phases)

Do after all Track A fixes pass verification.

### Phase 1: Unified Camera + World Coordinate System
**New file:** `src/ui/worldcam.ts`  
**Modified:** `src/main.ts`

```typescript
export interface WorldCamera {
  x: number;    // world-space pixel (1 world-px = 1 tile-px at zoom 1.0)
  y: number;
  zoom: number; // 0.05 (full region) to 4.0 (tile detail)
}

// Coordinate helpers:
cellX = Math.floor(wx / (96 * 32));
cellY = Math.floor(wy / (96 * 32));
tx = Math.floor((wx % (96 * 32)) / 32);
ty = Math.floor((wy % (96 * 32)) / 32);
```

Remove `mode: 'town' | 'region'` from `main.ts`. Replace two-branch loop with single `WorldRenderer` dispatching on `zoom`. Keep old mode button as dev fallback until Phase 4 is complete.

### Phase 2: Parcel Data Model + Unified Economy
**New file:** `src/sim/parcel.ts`  
**Modified:** `src/sim/sim.ts`, `src/sim/region.ts`, `src/sim/worldgen.ts`

```typescript
interface Parcel {
  cellX: number; cellY: number;
  owned: boolean;
  explored: boolean;
  purchaseCost: number;
  world: World | null; // null until purchased; lazily generated from seed
}
```

- Home cell auto-owned at game start with `world = sim.world`
- `worldgen.ts`: `RegionMap.siteAt(cellX, cellY)` already exists (confirmed) — use it directly as the per-parcel chunk generation hook; no changes to `worldgen.ts` for this step
- Serialization: `Uint8Array` of owned flags + independent `Simulation.serialize()` per owned parcel
- Economy unification (Fix 7): home sim stock is canonical

### Phase 3: Parcel Purchase System
**Modified:** `src/ui/hud.ts`, `src/ui/regionview.ts`, `src/sim/defs.ts`, `src/data/techtree.json`

```
cost(parcel) = BASE_COST
             × (1 + dist × DISTANCE_SCALE)
             × terrain_difficulty_multiplier
             × (1 + owned_count × EXPANSION_PREMIUM)
```

Add to `defs.ts`: `PARCEL_TUNING` constants block.  
Add to `techtree.json`: `land_survey` (buy non-adjacent), `road_building` (cost reduction), `cartography` (reveal biomes).  
UI: right-click fog-adjacent cell → purchase panel with cost breakdown → deduct `homeSim.gold` → mark `owned: true` → lazy world generation.

### Phase 4: Zoom-Coupled Multi-Chunk Rendering
**New file:** `src/ui/worldchunks.ts`  
**Modified:** `src/ui/render.ts`

Three render modes by zoom:
```
zoom ≥ 1.0   →  Mode A: full tile/agent rendering (existing render.ts, unchanged)
zoom 0.3–1.0 →  Mode B: pre-rendered chunk canvases per parcel (2–4px building icons)
zoom < 0.3   →  Mode C: 1 fillRect per parcel (biome color)
```

`ChunkCache` class:
```typescript
class ChunkCache {
  private bitmaps: Map<string, HTMLCanvasElement> = new Map(); // key "cellX,cellY"
  private dirty: Set<string> = new Set();
  markDirty(cellX: number, cellY: number): void;
  getBitmap(cellX: number, cellY: number, world: World): HTMLCanvasElement;
  renderDirty(sim: RegionSim): void;
}
```

- Chunk canvas (Mode B): terrain colors, 4×4px building squares by category (food=green, housing=tan, production=orange, military=red), stockpile fill as colored zone, fog overlay
- Cross-fade: alpha blend Mode A ↔ Mode B in 0.8–1.0× zone
- Seam prevention: `Math.floor()` throughout camera→world-pixel math
- Cross-chunk pathfinding: waypoint at cell border tile; new intra-chunk A* path starts in adjacent cell
- Zoom gate: `minZoom = Math.max(0.01, 0.25 - farExploredRadius * 0.007)`

### Phase 5: Simulation LOD
**Modified:** `src/sim/sim.ts`, `src/main.ts`, `src/sim/region.ts`

```typescript
// In Simulation:
isActive: boolean = true;
tickDormant(minute: number): void {
  if (minute % MINUTES_PER_DAY === 0) this.dailyUpdateDormant();
}
// dailyUpdateDormant: farm accrual, cohort population growth, no pathfinding

// In main.ts tick loop:
activeSim.tick(minute);
if (minute % MINUTES_PER_DAY === 0) {
  for (const p of parcels.filter(p => p.owned && !p.isActive)) {
    p.world?.sim.tickDormant(minute);
  }
}
// Budget: active = 64 ticks/frame; dormant = max 4/frame round-robin
```

### Phase 6: Fog of War Unification
**Modified:** `src/sim/region.ts`, `src/ui/render.ts`

```typescript
// In RegionSim — replaces explorationMap: TileVisibility[][] (100×100):
fogMap: Uint8Array; // 100×100 = 10,000 bytes, indexed [x * 100 + y]
// Values: 0='fogged', 1='explored', 2='scouted' (matches existing TileVisibility semantics)
```

Migration: `'fogged'` → 0, `'explored'` → 1, `'scouted'` → 2.  
`'scouted'` is ephemeral — existing serializer only persists `'fogged'`/`'explored'`; cells start at 0/1 after load and reach 2 only while a scout has line-of-sight. No data loss.  
Serialization: base64-encode the `Uint8Array` (more compact than the existing string format).  
Keeps `tile.explored` at town level unchanged.  
Rendering: Mode C → 100×100 `ImageData` scaled to viewport; Mode B → semi-transparent overlay per chunk cell; Mode A → existing per-tile fog (unchanged). Alpha blend in 0.8–1.0× transition zone.

### Phase 7: Web Worker Offload
**Modified:** `vite.config.ts` (first), **New file:** `src/workers/town-sim.worker.ts`

**Step 0 — update `vite.config.ts` before any worker code:**
```typescript
export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: { target: 'ES2022' },
});
```
Create `src/workers/` directory. No npm deps needed.

Move `Simulation` class to worker. Main thread ↔ worker via `postMessage`:
- Main → Worker: build commands, zone changes, tick advance
- Worker → Main: settler positions, stock levels, log events (deltas only)
- `SharedArrayBuffer` for `fogMap` (zero-copy updates)
- `OffscreenCanvas` for chunk canvas (render in worker, transfer bitmap)

Prerequisite: existing `headless.ts` confirms sim is already DOM-free. Vite config requires `worker: { format: 'es' }`.

---

## Stress Test — Validated Findings (Corrections to Plan)

All seven assumptions from planning were validated against actual code. Five are safe; two require plan corrections.

| Assumption | Result | Evidence |
|---|---|---|
| `RegionMap.siteAt()` needs to be added | ❌ **Already exists** — `worldgen.ts:236–247`, actively called from 3 sites in `region.ts`. Remove from Phase 2 work list. | `region.ts` calls `this.map.siteAt(x, y)` at lines 6758, 6822 |
| `explorationMap` is a 64×64 boolean array | ❌ **Wrong on both counts** — see correction below | `region.ts:1674` + `region.ts:662` |
| `headless.ts` supports multiple Simulation instances | ✅ Safe — standard class instances, no singletons. Loop at `headless.ts:87–94` already creates N independent instances. | One minor gotcha: `currencyFallback` in `defs.ts:65` is a module-level `let` — if parcels use different currencies this var gets stomped. Default to same currency across all sims. |
| `Simulation.serialize()` touches DOM | ✅ Pure JSON — no `document`, `window`, `localStorage`, or canvas. Safe for Node.js headless and Web Worker. | `sim.ts:3184–3236` |
| `TileKind` is an enum | ✅ Union type: `type TileKind = 'grass' \| 'tree' \| 'water' \| 'soil' \| 'rock'` in `world.ts:5`. No exhaustive switch statements — all comparisons are identity checks. Adding `'ore'` requires no refactor. | `world.ts:5`, confirmed no `switch (t.kind)` anywhere |
| Vite supports Web Workers with no config | ❌ **Config change needed** — see correction below | `vite.config.ts` has only `base: './'` |
| `stock.grain > 0` cook check line number | ⚠️ Line numbers will drift as Track A edits apply. Always re-read the cook task generation section before editing rather than jumping to a cached line number. | — |

### Correction 1: `explorationMap` is 100×100, three-state

**Actual type** (`region.ts:1674`):
```typescript
explorationMap: TileVisibility[][] = [];
// TileVisibility = 'fogged' | 'explored' | 'scouted'  (region.ts:662)
// Initialized as 100×100 array (region.ts:1710):
Array.from({ length: 100 }, () => Array.from({ length: 100 }, () => 'fogged'))
```

The plan's `fogMap` was specified as `Uint8Array` of **64×64**. That's wrong — the region coordinate space is 100×100, not 64×64.

**Fix to Phase 6 (Fog Unification)**:
- Change `fogMap` to `Uint8Array` of **100×100** (10,000 bytes — still negligible)
- Migration mapping: `'fogged'` → 0, `'explored'` → 1, `'scouted'` → 2
- `'scouted'` is ephemeral (not serialized in existing save format; existing serializer writes only `'0'`/`'1'`). After load, all cells start at 0 or 1; cells become `2` only while a scout has line-of-sight. No data loss on migration.
- The existing serializer packs `explorationMap` to a compact string — after migration, `fogMap` serializes as a base64-encoded `Uint8Array` (more compact than the current string format).
- All plan references to "64×64 fogMap" or "fogMap indexed `[cellX * 64 + cellY]`" → update to `[x * 100 + y]` (matching the existing 100×100 coordinate system)

### Correction 2: Vite needs explicit worker config before Phase 7

**Current `vite.config.ts`:**
```typescript
export default defineConfig({
  base: './',
});
```

**Required addition** (3 lines, add at start of Phase 7):
```typescript
export default defineConfig({
  base: './',
  worker: {
    format: 'es',
  },
  build: {
    target: 'ES2022', // match tsconfig.json target
  },
});
```

`src/workers/` directory does not exist yet — create it with the worker file.  
No npm deps needed — Web Workers are native to Electron's Chromium renderer.  
`new Worker(new URL('./town-sim.worker.ts', import.meta.url))` is the correct Vite ESM worker instantiation pattern.

---

## Agentic Use Plan

When to spawn sub-agents vs. implement directly:

| Situation | Action |
|---|---|
| Need to read/locate code before implementing | Spawn **Explore agent** (read-only; protects main context from large file dumps) |
| Pre-req fixes that touch a single small file (`defs.ts`, `buildings.json`, `techtree.json`) | Implement directly — no agent needed |
| Multi-file pre-req fixes (e.g., stockpile: `sim.ts` + `sprites.ts` + `render.ts`) | Implement directly with parallel tool calls where reads are independent |
| Phase 1–3 (WorldCamera, Parcel, Purchase) — new files + targeted edits | Implement directly; files are well-specified |
| Phase 4 (`worldchunks.ts` + `render.ts` 3-mode pipeline) — largest single implementation | Consider spawning a **worktree agent** (isolation mode) for `worldchunks.ts`; merge results |
| Phase 7 (Web Worker) — most architecturally risky | Spawn **worktree agent** so main branch is unaffected until validated |
| Verification steps that require running the headless harness | Use Bash tool directly (not an agent) — output is small and deterministic |
| TypeScript compile errors that span 3+ files | Spawn **Explore agent** to read error context before editing |

Sub-agent spawning rules:
- Never spawn an agent to do something you could do in 1–2 direct tool calls
- Always give the agent the exact file paths and line numbers from this plan — don't make it re-discover what was already validated
- Explore agents are read-only and cheap; use them liberally to protect context
- Worktree agents are for risky changes; always check their diff before merging

---

## Model Assignment — Per Task

Context ceiling is the binding constraint. `render.ts` is 22K lines; `regionview.ts` is 123K lines. Haiku 4.5's 200K cap makes it unusable for any task requiring render.ts + other files in context simultaneously.

### Haiku 4.5 ($1/$5 per MTok) — small isolated files only

Use only when the entire task fits in files totaling < 150K tokens.

| Task | Why Haiku |
|---|---|
| Add `PARCEL_TUNING`, `CAPACITY_PER_TILE`, `NEED_INTERRUPT_THRESHOLD`, `cookTriggerMult` to `defs.ts` | Single small file, purely additive |
| Add `requiredTech` to 17 buildings in `buildings.json` | JSON file, mechanical mapping from `town_techs.json` |
| Add 3 tech entries to `techtree.json` (`land_survey`, `road_building`, `cartography`) | JSON file, well-specified |
| Write `Parcel` interface declaration in `parcel.ts` (new file, no context needed) | New file from scratch, spec in plan |
| Write `parcel.test.ts` unit tests for cost formula | Tests only; no large file context required |
| Single-line fix: cook trigger multiplier (`settlers * 3` → `settlers * cookTriggerMult`) | One line in sim.ts — read only that section |
| Single-line fix: grain cook check (`> 0` → `>= cookBatch`) | One line in sim.ts |
| Single-line fix: quarry task label (`'chop'` → `'quarry'`) | One label string |
| Single-line fix: mill output (`produce` → `flour`) | One variable name |

**Do not use Haiku for**: any task that requires reading `render.ts`, `regionview.ts`, `hud.ts`, `region.ts`, or `sim.ts` in full.

### Sonnet 4.6 ($3/$15 per MTok) — default for most implementation

1M context window handles the full codebase. Use for everything not on the Haiku or Opus lists.

| Task | Notes |
|---|---|
| **Fix 1**: `worldgen.ts` FBM + rivers + mountains + ore deposits | Single file, complex logic |
| **Fix 2**: Stockpile capacity enforcement in `sim.ts` | Needs sim.ts context |
| **Fix 2**: Stockpile visual fill in `sprites.ts` + `render.ts` | Two files, medium complexity |
| **Fix 2**: Need-break preemption in settler tick loop (`sim.ts`) | Needs tick loop context |
| **Fix 2**: `'store'` task implementation (`sim.ts`) | Additive, needs task-gen context |
| **Fix 3**: Tech gating in `sim.ts:canPlace()` + `hud.ts:renderSubmenu()` | Two files, well-specified |
| **Fix 4**: Level-keyed building sprites in `sprites.ts` + `render.ts` | Two files |
| **Fix 5**: Gate neighbor mask in `render.ts` + `sprites.ts` | Two files, pattern already exists |
| **Fix 6**: Supply chain fixes in `sim.ts` (flour, bread, timber, brick, quarry, flax) | Single file, multiple additive changes |
| **Fix 6**: Resources tab in `hud.ts` | Single file, new UI panel |
| **Phase 1**: `worldcam.ts` (new file) + `main.ts` mode-switch removal | Well-specified, new file + targeted edit |
| **Phase 2**: `parcel.ts` `ParcelManager` class (new file) | New file, spec in plan |
| **Phase 2**: `worldgen.ts` — ~~add `RegionMap.siteAt()`~~ already exists; no change needed | — |
| **Phase 3**: Parcel purchase UI in `hud.ts` | Single file |
| **Phase 4**: `worldchunks.ts` `ChunkCache` class (new file) | New file, moderate complexity |
| **Phase 4**: `render.ts` 3-mode zoom pipeline scaffold | Complex but well-specified |
| **Phase 5**: `tickDormant()` in `sim.ts` + loop modification in `main.ts` | Two files, well-specified |
| **Phase 6**: Fog unification in `region.ts` + `render.ts` | Two files, well-specified |

### Opus 4.8 ($5/$25 per MTok) — complex cross-file architecture only

| Task | Why Opus |
|---|---|
| **Phase 7**: Web Worker migration — `SharedArrayBuffer`, `OffscreenCanvas`, `postMessage` delta protocol, Vite worker config | Most architecturally risky task; threading model requires holding worker/main boundary in mind simultaneously |
| **Phase 2 integration**: Connecting `ParcelManager` → `region.ts` → `sim.ts` → `main.ts` simultaneously — the first multi-file wiring pass | 4 interdependent files with circular dependencies; one wrong reference breaks all four |
| **Debugging coordinate math mismatches** when zoom transitions produce visual seams that span `worldcam.ts` + `render.ts` + `region.ts` | Classic 3-file cross-cutting bug; Sonnet loses track of the coordinate transforms |
| **Cross-chunk pathfinding** (border waypoint design + integration) | Touches `sim.ts` A* + `world.ts` + `parcel.ts` + new pathfinding protocol |
| **Save/load migration** (v3→v4 parcel array wrapping) | Must handle old save structures without breaking existing saves; one wrong field drops all player progress |

**Rule of thumb**: if you're unsure, start with Sonnet. Escalate to Opus if you get stuck across more than 2 files in the same session.

---

## Critical Files Reference

| File | Size | Role | First touched in |
|---|---|---|---|
| `src/sim/worldgen.ts` | 407 lines | Terrain generation | Fix 1 |
| `src/sim/defs.ts` | ~300 lines | Constants + types | Fix 2 |
| `src/sim/sim.ts` | 3,348 lines | Town agent sim | Fix 2 |
| `src/data/buildings.json` | ~200 lines | Building defs | Fix 3 |
| `src/data/town_techs.json` | ~150 lines | Tech tree | Fix 3 |
| `src/ui/sprites.ts` | ~1,600 lines | Sprite generation | Fix 4 |
| `src/ui/render.ts` | 22,614 lines | Canvas renderer | Fix 4 |
| `src/ui/hud.ts` | 41,032 lines | HUD | Fix 6 |
| `src/sim/region.ts` | 6,967 lines | Region sim | Phase 2 |
| `src/ui/regionview.ts` | 123,459 lines | Region view (deprecated) | Phase 4 |
| `src/main.ts` | unknown | Entry point + tick loop | Phase 1 |
| `src/sim/headless.ts` | unknown | Test harness | Verification |
| `vite.config.ts` | unknown | Build config | Phase 7 |

**New files to create:**
- `src/ui/worldcam.ts` — WorldCamera interface (Phase 1)
- `src/sim/parcel.ts` — Parcel + ParcelManager (Phase 2)
- ✅ `src/ui/worldchunks.ts` — ChunkCache + chunk summaries (Phase 4 foundation; landed)
- `src/workers/town-sim.worker.ts` — Web Worker (Phase 7)
- `tests/parcel.test.ts` — Unit tests (Fix 3 / Phase 2)

---

## Verification Checklist

### Track A
1. **Worldgen**: 10 maps generated; each has ≥ 10 rivers, ≥ 20% mountain coverage, ore deposits visible in hills/mountains
2. **Stockpile capacity**: haul task blocked when `stockpile_tiles × 50` capacity reached
3. **Stockpile visual**: zone overlay shifts color/shade across 4+ fill levels
4. **Cook balance**: headless 30-day run, 12 settlers; `stock.meal` stabilizes > 60 by day 15
5. **Store task**: log shows `'store'` task emitted when `grain > 40 && meals < settlers * 5`
6. **Need-break**: headless run with researcher assigned; no settler drops below food=10 or sleep=10
7. **Tech gating**: placing Mill before Milling tech fails; Mill button disabled in HUD; re-enabled after research
8. **Building upgrade**: house at level 2 looks visually different from level 1 at zoom ≥ 1.0
9. **Gate meshing**: gate placed between two walls; all three tiles visually connect
10. **Supply chains**: headless 60-day run; `stock.flour > 0` after mill worker assigned; `stock.bread > 0` after bakery assigned; at least one construction uses timber
11. **Resources tab**: all 23 resources visible; net flow shown; "No source" flag on rope
12. **Quarry verb**: rock-harvest task labeled "quarry"; quarry zone designation works
13. **Ore deposits**: 5 maps; each has 3–5 ore clusters in hills/mountains biome
14. **Treasury continuity**: start new game; note gold; switch to region view; confirm same gold value shown

### Track B
15. **WorldCamera**: zoom from 4.0 → 0.1 without mode-switch button; rendering dispatches correctly at each threshold
16. **Parcel purchase**: buy adjacent parcel; gold deducted from `homeSim.gold`; new tile world generates; visible at zoom 0.5 in chunk canvas
17. **Chunk canvas**: Mode B shows terrain + building icons + stockpile fill; Mode C shows biome blocks; no seams between parcels
18. **Dormant sim**: 5-parcel headless 200-day run; dormant parcel populations change daily; frame time < 16ms
19. **Fog**: fog consistent at all zoom levels; no tile/cell boundary artifacts; scout exploration reveals cells in both views
20. **Save/load**: serialize 3-parcel world; deserialize; fog state, parcel ownership, and gold all persist
21. **Web Worker**: main thread frame time < 8ms with worker running; no settler position lag > 1 frame
