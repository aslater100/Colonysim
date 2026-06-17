# Handoff — Centuria Development Guide

> ## ⚑ CURRENT DIRECTION (2026-06-17) — TownCore dropped, the game is the **4X build**
>
> **TownCore is gone.** The town-detail / per-settler simulation track is retired. The
> shipping game is the **standalone 4X campaign**: `core.html` → `src/coreview.ts` →
> `RegionView` (`src/ui/regionview.ts`) over the deep `RegionSim` model (`src/sim/region.ts`,
> ~7.5k lines: sectoral economy, monetary policy + credit cycle, diplomacy/treaties/war,
> climate/emissions, tech + civics trees, factions/rivals, four win conditions, procedural
> worldgen). **The depth is already in the model** — the work is surfacing it through a
> beautiful, efficient UI and a stunning map, and adding new depth on top.
>
> **Visual direction (user, locked):** *both* a painterly era-evolving overworld **and** a
> modern strategy UI — **terrain/atmosphere first**, then UI polish. Maximum scope.
> **Start (user, locked):** **colony → nation arc** — begin as one founding settlement on a
> fogged map, expand → Charter → Statehood → Nation across 1900–2100.
>
> ### Architecture of the 4X build
> - **`src/coreview.ts`** — the campaign shell: boot, canvas (DPR-crisp), input, persistent
>   top HUD + event log, fixed-timestep loop. **Owns no rendering** beyond the HUD; the map
>   and every panel belong to `RegionView`.
> - **`src/ui/regionview.ts`** — the 4X UI workhorse: map (terrain/territory cache, routes,
>   settlements, rivals, weather) + DOM panels (State→Finance/Politics/Diplomacy, Research,
>   Routes, Settlements, Economy) + modals (Charter, Convention, Century report, Win, Era).
> - **`src/sim/region.ts`** — the model. Boot the campaign with **`RegionSim.foundColony(rng,
>   map, weather, opts)`** (the replacement for the dropped `RegionSim.fromTown` flip).
> - The classic town game (`index.html` → `main.ts` → `TownCore`/`Simulation`) still exists
>   and is reachable as "Classic Colony" from the title screen, but is **not** the focus.
>
> ### Overnight 4X PR queue (draft) — merge BOTTOM-UP (each stacked on the prior)
> 1. **#189 — 4X foundation** (`claude/4x-foundation`, off `main`): `foundColony` + clean RegionView shell. *Merge first.*
> 2. **#190 — terrain: fog of war + sea bathymetry** (`claude/4x-terrain-fog`, on #189).
> 3. **#191 — atmosphere: day/night + city lights + season + vignette** (`claude/4x-atmosphere`, on #190).
> 4. **#193 — modern UI theme** (`claude/4x-ui-polish`, on #191, scoped to `.cv-app`).
> 5. **#194 — "Path to Nationhood" objectives panel** (`claude/4x-objectives`, on #193).
> 6. **#195 — event toasts** (`claude/4x-toasts`, on #194).
> 7. **#196 — save/load (autosave + continue)** (`claude/4x-saveload`, on #195). ← stack tip (this HANDOFF lives here).
> - **#192 — tech & civics depth** (`claude/4x-tech-depth`, INDEPENDENT off `main`): +12 wired nodes, 899→902 tests, sim:macro ON TARGET. Merge any time.
> - All CI green at time of writing. node_modules worktrees live under `.claude/worktrees/` — exclude them from vitest with `--exclude '**/.claude/**'` or test counts double.
>
> ### Gotchas learned this session
> - `RegionView`'s camera works in **backing-store (device) pixels** (`canvas.width/height`,
>   `MIN_SCALE = 1` = whole region fills the canvas). Feed it pointer coords in device px
>   (multiply CSS delta by DPR, or use the `canvas.width / rect.width` ratio).
> - `RegionView` already auto-renders the State panel + selected-settlement inspector every
>   frame — don't hand-roll canvas panels over it.
> - `PLAN.md` below is **largely stale** (it documents the retired TownCore/seamless-world
>   track). Treat this banner + the dated snapshots as current; mine PLAN/old snapshots only
>   for the still-relevant `RegionSim`/`RegionView` internals.
> - Content that perturbs seeded balance must be checked against `npm run sim:macro` /
>   `region-longrun`, not just unit tests.

**Last updated:** 2026-06-17 (4X migration)  
**Active branch family:** `claude/4x-*` (stacked draft PRs off `main`)  
**Current test count:** 899 passing  
**Current version:** v0.42.0  
**Legacy note (pre-pivot):** the entries below describe the now-retired TownCore seamless-world
track; kept for `RegionSim`/`RegionView` reference, not as current direction.

---

## Session Snapshot — 4X overnight build (2026-06-17)

Took the 4X build from a broken placeholder (a `coreview.ts` that crashed on boot — it
queried a `<canvas>` `core.html` never had, hand-drew panels that fought `RegionView`, and
booted an empty `RegionSim`) to a playable, saveable, good-looking colony→nation campaign.
**8 draft PRs** (#189–#196 stacked + the independent #192), all CI green, suite 894 → 900
(stack) / 902 (#192).

- **#189 foundation** — `RegionSim.foundColony()` (the replacement for the dropped `fromTown`
  flip) + a clean shell delegating all map/panel rendering to `RegionView`; DPR-crisp canvas;
  persistent HUD + event log; fixed-timestep loop; draggable panels. `tests/region-found.test.ts`.
- **#190 fog of war + sea bathymetry** — explored frontier shrouds the unknown (feathered,
  cloud-mottled), hides undiscovered rivals; continuous ocean depth ramp. Map-cache only.
- **#191 atmosphere** — day/night tint, golden-hour dawn/dusk, population-scaled city lights,
  seasonal wash, vignette — all off one `atmosphere()` state, screen-space, near-free.
- **#193 modern UI** — cohesive cool-ink theme scoped to `body.cv-app` (classic game untouched):
  glass panels, pill tabs, accent buttons, slim scrollbars.
- **#194 objectives panel** — live "Path to Nationhood" checklist reading the model's own gates
  (`charterGates`/`canCallConventionGates`/`canFoundTown`); no model changes.
- **#195 event toasts** — notable good/bad log entries pop top-centre.
- **#196 save/load** — autosave + continue + manual save; localStorage; reuses `serialize()`/
  `deserialize()` via a `{rng,regionMap,weather}` stub + persisted seed. Round-trip test proves
  deterministic continuation.
- **#192 tech & civics depth** — +12 wired tech/civic nodes filling 1900–2100 gaps (incl. the
  empty 2000–2024 window); sim:macro ON TARGET.

**Good next candidates:** a proper 4X start/main menu for `core.html` (new-game with the
`foundColony` start-preference: river-valley/coastal/highlands/surprise; Continue if a save
exists); a minimap with fog; economy sparklines (needs a history sampler in `RegionSim`);
in-map tooltips; first-run tutorial. **Process note:** background agents share the working
tree unless launched with `isolation: "worktree"` — always isolate parallel agents.

---

## Where things stand (2026-06-17)

A long session shipped **13 PRs (#170–#182)** across all facets — the seamless-world backbone
is complete and the primary engine (CoreView / `core.html`, reached via title-screen **New
Colony**) is a full, audible, mouse-driven game. Highlights, newest first (details in the
dated snapshots below):

- **Seamless world M0→M3** (the backbone): `TownCore` chunk summary (#175), lazy
  `regionMap`/`site` + 🌐 World overview (#176), claim parcels (#178), holdings daily tribute
  (#179) + Provincial Roads tech (#182). `ParcelManager` (classic) was **not** re-based —
  the primary engine got a small native parcel model sharing one `parcelCost()`.
- **UX**: SoS-style bottom **command bar** + RTS hotkeys, `H`=home (#177); event **toasts**
  (#180); **audio** wired into CoreView — era music + ambience + SFX, 🔊 toggle (#181).
- **Content**: late-century **region tech tree** 2050–2100 (#172); **TownCore production
  techs** incl. a fixed dead `food_preservation` effect (#173); **extraction-zone** yield
  techs (#174).
- **Render/perf**: viewport culling + **HiDPI/DPR** (#170); ground-seam fix + station-view
  reuse (#171).

**Known follow-ups / deferred (good next-session candidates):**
- **Dormant per-parcel sim** — holdings currently give a flat biome tribute; a real dormant
  tick (crops grow, population drifts, each holding hosts its own grid) is the upgrade path
  (ponytail-noted in `TownCore.tickHoldings`).
- **Re-base `ParcelManager` on `TownCore`** if the classic↔primary parcel models should
  converge (a `ParcelHost` interface) — only needed if the region/nation tier moves onto SoA.
- **Town-tier expansion-tech gating** (`land_survey`/`road_building`/`cartography` are
  region-tier; town overview uses adjacency-only).
- **Content depth**: late-game buildings/stations (data-driven, opt-in/balance-safe, but need
  art or accept the generic fallback); region random events are still hardcoded.
- **UX**: first-run onboarding/tutorial; a real settings panel (audio toggle exists as a button).
- **Caution learned this session:** adding traits to `traits.json` perturbs seeded balance
  (a default-seed colony died) — content that changes the persona roll or core balance needs
  the headless harnesses (`npm run sim:town` / `sim:macro`) checked, not just unit tests.

---

## Session Snapshot — Provincial Roads tech (2026-06-17, latest)

**What landed:** A `provincial_roads` town tech (prereq carpentry) raises holdings daily
tribute (gold + biome staples) by 50% — ties research to seamless-world expansion. Opt-in;
894 tests. `holdingsIncome()`/`tickHoldings()` apply `holdingsMult()`.

---

## Session Snapshot — Audio in the primary engine (2026-06-17)

**What landed (branch `claude/game-build-iteration-assets-2kd2z0`):** CoreView (the primary
engine) was **silent** — the tested `Music` / `Soundscape` / `Sfx` modules were only wired
into the classic `main.ts`. Now CoreView instantiates all three (unlocked on first gesture):
era-aware procedural soundtrack by year, diegetic ambience driven by build activity, and
SFX on events — chime/thud/knell from new good/bad log entries (via `pollEvents`), plus a
raid-onset horn. A shared `tension` scalar (raid → 1, decays) swells the music. One master
`🔊 Sound` button toggles all three. Reuse-only, no new audio code; 893 tests still green.

---

## Session Snapshot — UX: event toasts (2026-06-16)

**What landed (branch `claude/game-build-iteration-assets-2kd2z0`):** Notable events
(`good`/`bad` log entries — raids, deaths, milestones, breakthroughs) now pop as
top-centre **toasts** for ~3.5s so they aren't missed in the bottom-left log. `pollEvents()`
(in the loop) diffs `core.log` and queues new good/bad entries (capped at 4); `drawToasts()`
renders them under the flash line, colour-coded. Primed on first poll so boot history is
silent; resets after load. UI-only — 893 tests still green; browser-verifiable.

---

## Session Snapshot — Backbone M3 (lazy): holdings income (2026-06-16)

**What landed (branch `claude/game-build-iteration-assets-2kd2z0`):** Claiming land now
**pays off**. Instead of a full dormant per-parcel sim (deferred — needs per-parcel
grids), each owned parcel beyond the capital sends a small daily tribute in
`TownCore.dailyUpdate` → `tickHoldings()`: a biome staple (plains→grain, forest→wood,
hills/mountains→stone, marsh→herbs, river→meal) + `HOLDING_TITHE` gold. `holdingsIncome()`
surfaces the gold/day in the overview header. Opt-in (only fires if you bought land), so
`sim:town` baseline is unchanged (10/10, mood 35). Tests 891→**893**. ponytail: flat
per-biome yield; the upgrade path is a real dormant sim (crops/pop) once a holding can
host its own grid.

---

## Session Snapshot — Backbone M2: claim parcels from the overview (2026-06-16)

**What landed (branch `claude/game-build-iteration-assets-2kd2z0`):** The world overview
is now interactive — you can **buy land**. Rather than re-base the `Simulation`-coupled
`ParcelManager` (deferred), the primary engine got a small native model:
- `parcelCost(...)` extracted to `defs.ts` as a pure function; `ParcelManager.cost` now
  calls it too, so classic + TownCore quote identical numbers from **one** formula
  (classic parcel tests unchanged).
- `TownCore` gains `ownedCells` (seeded with the home cell), `parcelPrice`, `canBuyParcel`
  (in-region + land + orthogonally adjacent + affordable), `buyParcel` (deduct gold, take
  title). Persisted via an additive optional `owned[]` save field (old saves backfill the
  home cell).
- CoreView overview: owned cells get a gold wash, buyable frontier cells a green outline,
  a hovered-cell info line (biome · price · claim/why-not), a Treasury/Holdings header, and
  **left-click claims**. Tech gating (`land_survey`/`road_building`) is region-tier and not
  wired at town tier yet — adjacency is the only gate (noted).

Tests 887→**891**. Browser-verifiable. Next: **M3** — dormant tick for owned-but-inactive
parcels (crops grow / slow drift off-screen), and showing each holding's chunk summary
(from the M0 `computeTownChunkSummary`) in the overview.

---

## Session Snapshot — UX: bottom command bar + RTS hotkeys (2026-06-16)

**What landed (branch `claude/game-build-iteration-assets-2kd2z0`):** Reworked CoreView
input toward RTS conventions (user ask: "way too many hotkeys; want a SoS-style central
command bar"). Added a **bottom-centre command bar** — categories `Build / Rooms / Work
/ Plans / Farm / Gather`, the active one's items wrap in a grid above; click a button to
pick the tool/room/station/blueprint. Rebuilt per frame into a `barHit` list, hit-tested
in `mousedown` before the map gets the click. **H now recentres on the colony** (the
"town hall"/base-camp key) instead of selecting the wall tool. Trimmed the two giant
tool-hotkey hint lines to one concise camera/global line. Single-letter tool keys still
work as optional shortcuts. UI-only — no sim change, 887 tests still green; browser-verified.

---

## Session Snapshot — Backbone M1: world overview in CoreView (2026-06-16)

**What landed (branch `claude/game-build-iteration-assets-2kd2z0`):** First *visible*
seamless-world step. `TownCore` now exposes a **lazy** `regionMap` + `site` (a
`RegionMap(seed)` + `startSite()`, computed on first access, re-derived on load — no
save fields, no cost until opened). CoreView gained a **"🌐 World" button** that toggles
a zoomed-out overview of the 128² region the colony occupies: biomes rasterised once to
an offscreen canvas (seed-static) and blitted scaled, a pulsing gold marker on the home
cell, Esc/button to return. Look-only for now (parcel **purchase = M2**); the town keeps
ticking behind it; canvas input is inert while open.

Browser-verified by the user. Tests 885→**887** (region context: in-range + deterministic
+ save round-trip). DPR/cull-friendly: the overview is a single cached blit, not 128² fills/frame.

**Next:** M2 — right-click a frontier cell in the overview → purchase cost panel (needs
`ParcelManager` re-based on TownCore: it's still `Simulation`-coupled — `home.economy.cash`,
`home.world`, `home.site`; TownCore has `gold`/`grid`/`site` getter, so an adapter or a
`ParcelHost` interface is the remaining M0 work).

---

## Session Snapshot — Backbone M0 slice: TownCore chunk summary (2026-06-16)

**What landed (branch `claude/game-build-iteration-assets-2kd2z0`):** First step of the
seamless-world reconciliation (M0). `worldchunks.computeChunkSummary` only understood
sim/world's `TileKind` objects (classic engine); added `computeTownChunkSummary(grid…)`
that downsamples a primary-engine `BuildGrid` (flat `TERRAIN` Uint8Array) into the same
`ChunkSummary` raster + dominant biome. Pure, DOM-free, headless-tested (885 tests).
Raster + biome only for now — building/stockpile markers come when the M1 world-view
renderer needs them (ponytail-noted). This is the piece M1 (world view in CoreView)
will blit for off-screen parcels.

**Note:** A trait-pool expansion was tried this session and **reverted** — adding 5
personality traits shifted seeded colony balance harsher (a default-seed colony died,
avg mood dropped below a pinned threshold). Not worth chasing seeded thresholds for
cosmetic variety. Also audited `region.ts`/`towncore.ts` for dead tech-id references
(after the `food_preservation` fix in #173): none remain.

---

## Session Snapshot — Content: extraction-zone yield techs (2026-06-16)

**What landed (branch `claude/game-build-iteration-assets-2kd2z0`):** Finished the
harvest-yield story. Field/flax zones had tech multipliers but woodcutter/quarry/fishery
were flat (the `towncore.ts` flat-yield stub). Added **Forestry** (wood ×1.25),
**Mining** (stone/ore ×1.30), **Fishing** (fish food ×1.25) to `research.ts`, wired in
`harvestZones()` mirroring the existing field-bonus pattern. TownCore tree 17→20.
Tests 881→**882**; non-extraction zones unchanged (still ×1).

---

## Session Snapshot — Content: TownCore production tech tree (2026-06-16)

**What landed (branch `claude/game-build-iteration-assets-2kd2z0`):** Content track,
**primary engine** this time — the SoA TownCore research tree (`src/sim/research.ts`)
had only 12 techs and several stations had no tech bonus at all. Added **5 techs**
(12→17) wired into `TownCore._stationSpeedMult`:

- **Food Preservation** — *activates a previously dead effect*: `towncore.ts` already
  checked `hasTech('food_preservation')` for the smoke_rack ×1.40 bonus, but no such
  tech existed, so it could never fire. Now it does.
- **Baking** (oven / baking_oven ×1.25), **Ceramics** (kiln / coke_oven ×1.25),
  **Animal Husbandry** (animal_pen dairy ×1.30), and **Mechanization** capstone
  (prereqs blacksmithing + carpentry) — **every** workstation runs +15% faster.
- Also folded `carpentry_bench` into the existing Carpentry bonus (it had none).

Tests 879→**881** (added Baking + Mechanization throughput tests; the existing
prereq-validation test covers the new nodes). `npm run sim:town` survival 10/10, avg
mood 35 (baseline unchanged — techs aren't auto-researched by the unmanaged harness).

**Note:** the town tier's player-facing tree is `research.ts` (`CoreTechDef`), consumed
by `towncore.ts`. `town_techs.json` feeds the *classic* sim via `defs.ts` — a separate,
demoted path; future town content should target `research.ts`.

---

## Session Snapshot — Content: late-century tech tree (2050–2100) (2026-06-16)

**What landed (branch `claude/game-build-iteration-assets-2kd2z0`):** First content drop
from the cross-facet roadmap (Content track). The region tech tree (`techtree.json`) had
**zero nodes after ~2050** — a 50-year endgame void. Added **8 late-century nodes**
(24→32), data-driven so they surface in the research UI automatically:

- **Tech:** Artificial Intelligence (2055), Robotics (2062), Carbon Capture (2070),
  Advanced Materials (2076), Orbital Industry (2090).
- **Civics:** Welfare State (2058), Participatory Democracy (2066), World Federation (2088).

**Effects wired** (reusing existing `has('id')` idioms in `region.ts`): AI → research
rate ×1.25; Carbon Capture → player emissions ×0.4 + world-emissions diffusion ×0.7
(gives the near-impossible Stewardship A-grade an endgame lever); Robotics → route
maintenance ×0.7 atop Automated Freight; Welfare State → grievance ×0.8 atop Labor
Standards; Participatory Democracy → satisfaction +3. Advanced Materials / Orbital
Industry / World Federation are honest era/capstone markers (no false numeric promises).

Tests: 874→**879** (added late-century effect coverage + a century-span assertion;
updated the node-count assertion). `npm run sim:macro` still **ON TARGET**; region
long-run to 2100 green.

**Roadmap note:** Plan approved (Seamless World backbone + co-equal Content & UX tracks).
Next content steps: late-game buildings/stations, then mirror the gap-fill into
`town_techs.json` (town tier stops at coal power, 1910).

---

## Session Snapshot — CoreView seam fix + station-view reuse (2026-06-16)

**What landed (branch `claude/game-build-iteration-assets-2kd2z0`):** Follow-up render
polish on `src/coreview.ts`. No sim/balance changes (all 874 tests pass).

- **Ground-tile seam fix.** Opaque base-terrain tiles (water/soil/sand/rock/grass)
  now draw through a `blitG` helper that bleeds them 1px into the right/bottom
  neighbour, closing the faint dark-grid seams that show through at fractional
  zoom (the same technique `render.ts` already used). Overlays with transparency
  (roads/walls/gates) keep the exact `blit` so connection art stays aligned.
- **Station-view reuse.** `stationViews()` is a generator yielding a fresh object
  per station; `draw()` consumed it three times per frame (glow collection, shadow
  pass, sprite pass). It's now materialized once into `stationList`, cutting 2×
  the per-frame object churn and `progressFor` lookups.

---

## Session Snapshot — CoreView render efficiency + HiDPI sharpness (2026-06-16)

**What landed (branch `claude/game-build-iteration-assets-2kd2z0`):** Render-path
work on the primary SoA `CoreView` (`src/coreview.ts`) — efficiency + fidelity, no
sim/balance changes (all 874 tests still pass).

- **Viewport culling.** The `draw()` terrain loop (and the tree-shadow, trap, and
  night-candlelight passes) iterated the full 96×96 grid every frame. They now clamp
  to the visible tile window (`vx0..vx1`, `vy0..vy1`, 2-tile margin for canopy/head
  overhang) — the single biggest frame-time win when zoomed in, where most of the
  grid is off-screen. Free-moving entities (settlers, deer, wolves, raiders, stations)
  are culled by an `onScreen()` footprint test; stations check both corners so
  multi-tile ones don't pop at the edge.
- **HiDPI rendering ("more pixels").** The canvas backing store is now sized at
  `cssW·DPR × cssH·DPR` (DPR capped at 2) with a per-frame `setTransform(DPR…)` base.
  Every coordinate stays in CSS px, so layout/input/camera are mathematically
  unchanged — the whole scene just renders at the display's native resolution
  (crisper sprites and HUD text on Retina/HiDPI). `cw`/`ch` module vars replace the
  old `canvas.width/height` reads.
- **Per-frame allocation removed.** The agent y-sort reuses a module `agentOrder`
  buffer instead of `Array.from(...).sort(...)` each frame.

**Note for next session:** `render.ts` (Classic Colony / fat sim) already culls but
is *not* DPR-aware; the same backing-store treatment could be applied there if the
classic path is revisited. CoreView is the default/primary engine.

---

## Session Snapshot — Seamless World Architecture Foundation (2026-06-16)

**What landed (PR #168 — revised):**
- **Phase 0 — ParcelManager integration:** Replaced bare `Simulation` with `ParcelManager(home)` throughout boot. The parcel grid (`64×64` cells) is now the world model; each parcel can host a town. Save format bumped to v3 (town + parcels, optional region). Backward compatible with v1/v2 saves via migration.
- **Phase 1 — Click-to-world navigation:** New `world` mode accessible from town view by clicking the minimap. Escape returns to town. World view placeholder ready for rendering (Phase 1B).
- **Reverted flip-dependent work:** Removed 3 commits that reinforced the hard mode switch (head-start at flip, rival activation timing). These contradicted the seamless-world vision and are no longer part of the architecture.
- **Infrastructure:** ParcelManager wired into save/load, world-view mode switching complete. Ready for WorldCamera rendering and parcel grid display.

**Why this direction:** The user's core vision is "I want the whole world always available (by clicking the map to view the world)" — a seamless, click-accessible world, not a hard flip. The architecture now supports this without sacrificing the live town gameplay.

**Balance note (SoA starter colonies):** Unmanaged SoA starter colonies sit at mood ~35 (120d), drifting down in winter. Root cause is by-design: warmth only recovers in *enclosed* rooms and the starter has no clothing chain. A *managed* colony (build a loom, balance work/leisure) avoids this. The harness (`npm run sim:town`) guards against regressions from this baseline.

---

## Architecture History — How We Got Here

**Previous milestone (2026-06-15, SoA TownCore completion):** The SoA town engine reached feature parity with the fat `Simulation`. All behavior ported to deterministic SoA columns: traits/skills, wounds/medical, relationships/thoughts, weather, raid/combat, economy, event log. Save format v10. ~16 PRs (#142–158), all tested. Test baseline **825 → 852**.

**Decision (2026-06-16):** Rather than a destructive render-path rewrite (hard flip), pivot to **seamless-world architecture**: click-accessible parcels with active/dormant simulation. `ParcelManager` manages a 64×64 grid; each parcel can host a town. Player clicks minimap to toggle between town detail (active parcel, full fidelity) and world overview (parcel grid, dormant neighbors). This eliminates the hard mode switch entirely.

### The SoA TownCore (PRs #145–158)
- **#145 launcher** — title-screen entry that boots the SoA core (`coreview.ts` / `core.html`).
- **#146 camera** — pan/zoom on the SoA renderer (scroll zoom, WASD/arrows/middle-drag pan, **O**
  overview). World drawn under a `translate+scale` transform; HUD stays screen-space.
- **#147 bigger world** — map 64²→**96²**, initial view centred on the colony; also fixed WASD pan
  (was colliding with build-tool keys → tools moved to **H/J/K**) and unreliable settler click-inspect.
- **#148 heightmap terrain** — `BuildGrid.generateTerrainHeightmap()`: a value-noise elevation field
  banded SoS-style into sea / fertile shore / land(+lowland forests) / mountains(+ore). Opt-in via
  `new TownCore({ terrain: 'heightmap' })`. Replaces the old scattered-blob generator (still present).
- **#150 rivers** — steepest-descent carving from high points to the sea (1-tile water channels).
- **#151 beaches** — a SOIL "sand" shore wherever land meets water (seas/lakes/rivers).
- **#152 forage** — a `forage` deposit layer (berries/mushrooms/herbs) scattered on grass + a
  `ZONE.FORAGE` that only works a deposit → food/herbs.
- **#153 economy panel** — toggle **I**: every stored good with count, net flow/day, market price,
  plus gold/inflation and (after #156) storage used/cap.
- **#154 farms** — `ZONE.ORCHARD` (grass) + `ZONE.VEGGARDEN` (soil) → **`produce`**, wired into the
  feeding priority + food-variety mood system.
- **#155 husbandry** — `pasture` room + `animal_pen` station (grain → **`dairy`**), dairy as food.
- **#156 logistics** — **colony storage cap** that scales with **population + built shelves/crates**
  (`storageCap()`); non-food overflow spoils daily (food is exempt — own freshness cap). New bulk
  `crate` station. (Region/nation deliberately stays a **Victoria-3 flow model** — treasury + GDP, no
  good stockpiles — see research note below.)
- **#157 religion** — `temple` room + `shrine` station (`CapacityKind 'faith'`) → a daily mood lift
  for worshippers (reuses the capacity-station pattern; no new per-agent need column).
- **#158 default-flip** — primary **New Colony → SoA engine**; fat sim demoted to **Classic Colony**.
  Reversible (swap two handlers); nothing deleted.

**Storage research (drove #156).** SoS = colony-tier physical storage that scales with built
warehouses (unwarehoused food spoils faster); Victoria 3 = *no* national stockpiles, goods are pure
flow and "storage" is value (treasury/wealth). So caps live at the **colony** tier; the region/nation
tier (`RegionSim`) already matches Victoria 3 and needs none.

### Pre-statehood + bug fixes (#142–144, also this session)
- **#142** re-landed the stranded macro harness on main + reconciled docs (see next snapshot).
- **#143** Minsky credit-cycle tuning (cycles now emerge ~2.9 busts/century; see next snapshot).
- **#144 pre-statehood governance** — the fat-sim region had a soft-lock: the whole monthly economy
  (`monthlyEconomy()`) only ran *after* statehood, but statehood needs £8k treasury, so a pre-State
  deficit had no lever. Now the economy runs pre-statehood (tax/services work), and the routes /
  economy / settlement panels + a trimmed Treasury panel are unlocked early (Politics/Diplomacy/
  central-bank stay nation-tier). Also a **zoom-drift fix**: `canvasXY` now maps CSS→canvas-buffer px.

---

## Next Priority — Seamless World Phases (2026-06-16)

**Roadmap:** Build the seamless-world game world by world by implementing click-accessible parcels with active/dormant simulation.

### Phase 1B — World view rendering
- Implement world rendering with `WorldCamera` (zoom-based LOD)
- Display parcel grid with biome summaries (chunk canvases at zoom 0.3–1.0, biome pixels < 0.3)
- Click parcel to switch to town view (town-detail ↔ world-overview toggle)

### Phase 2 — Parcel expansion & purchase UI
- Right-click fog cell to show purchase cost + tile data
- Parcel cost formula: `base × distance × terrain × holdings-premium × tech-discount`
- Tech gating: `land_survey`, `road_building`, `cartography` unlock expansion mechanics
- Rivals expand via same purchase system (Region/Nation phase)

### Phase 3 — Dormant simulation (off-screen parcels)
- Implement `tickDormant()` for non-active parcels (daily cheap tick)
- Crops grow, population flows, rivals expand/trade off-screen
- Active parcel (player's town) runs full `TownCore` fidelity
- FogMap replacement: 64×64 grid with explored/scouted/fogged states

### Multi-path win conditions (existing, verified in place)
All four are implemented in `region.ts`:
- **Unification** — control X% of the map by a target era
- **Legacy** — A grade in 3 of 4 century categories (prosperity / liberty / stewardship / standing)
- **Domination** — last nation with sovereignty at 2100
- **Solarpunk** — green branch achieved (warming < 2.3°C + democracy + satisfaction ≥ 42% + legitimacy ≥ 35%)

### Key files
- **SoA core:** `src/sim/towncore.ts` (~2,060 lines), `src/sim/startertown.ts`
- **World layer:** `src/sim/parcel.ts` (ParcelManager, 64×64 grid), `src/sim/fogmap.ts`, `src/ui/worldcam.ts` (coordinate transforms)
- **Rendering:** `src/ui/worldchunks.ts` (chunk-LOD foundation), `src/ui/render.ts` (town detail)
- **Region/Nation:** `src/sim/region.ts` (~7,000 lines) — rivals, economy, diplomacy, war, climate

---

### Seamless-world checklist
> **Re-based on the primary engine (TownCore) this session — see "Where things stand" up top.**
> The Phase 0/1 items below were the *classic-`Simulation`* scaffolding (`ParcelManager`,
> `main.ts` world mode). The shipped game uses TownCore-native M0–M3 instead.
1. ✅ **M0** — `computeTownChunkSummary` over `BuildGrid` (#175)
2. ✅ **M1** — lazy `TownCore.regionMap`/`site` + 🌐 World overview in CoreView (#176)
3. ✅ **M2** — claim adjacent parcels from the overview; shared `parcelCost()` (#178)
4. ✅ **M3** — holdings daily tribute + Provincial Roads tech (#179, #182)
5. ⬜ **Next** — real dormant per-parcel sim (crops/pop/grid per holding); optional
   `ParcelManager`↔TownCore convergence; town-tier expansion-tech gating
6. ℹ️ *Classic scaffolding (superseded):* Phase 0 ParcelManager + Phase 1 main.ts world mode

### Polish & future (post-seamless-world)
1. **Yearly Report** — annual in/out/net ledger per resource in the economy panel (the SoS report). Additive.
2. **Terrain detail** — dedicated `SAND` terrain (beaches reuse SOIL); river bridges/fords (water blocks movement).
3. **Sprite finish** — bespoke sprites for `animal_pen`/`shrine`/`crate` (fallback markers suffice for now).
4. **Macro tuning** — `LEVERAGE_FRAGILE`/`FRAGILITY_GAIN` dials if the business cycle should be busier/calmer.

---

## Session History — Macro Engine & Credit Cycle (2026-06-16, earlier)

### Reconciliation + recovered macro work

**PRs #135–141 (now reflected here):** #135/#138 docs reconciliation, #136/#137 macro credit-cycle
harness + region long-run test (see below), #139 version bump to **v0.41.0**, #140/#141 title-screen
z-index fix (in-game HUD no longer bleeds through the title screen) → **v0.41.1**.

**Recovered the stranded macro harness.** PRs #136 and #137 had been merged into the
`claude/loving-gates-3luzuc` *sub-branch* but never PR'd to `main`, so their ~14 tests + the
`sim:macro` harness were missing from trunk while PLAN.md already claimed them. This session
cherry-picks the two feature commits back onto main (pure additive, no conflicts):

- **`src/sim/macro-headless.ts`** + **`npm run sim:macro -- [years] [runs] [policy]`** — runs the
  nation-tier monetary engine (`RegionSim.tickMonetary`) across 110 game-years and multiple seeds,
  with `passive` (pinned rate) and `taylor` (dovish growth mandate) reaction functions.
- **`tests/macro.test.ts`** (11 cases) CI-pins `analyzeCycles` + `policyRateFor`.
- **`tests/region-longrun.test.ts`** (3 cases): 1900–2010 stays finite/in-clamp; 50-year run is
  byte-identical for a fixed seed; distinct seeds diverge.
- **Key finding (addressed in a follow-up PR):** credit busts were = **0/century** — confidence
  never moved off 70, leverage topped out ~2.0, so the cycle **under-emerged** (GDD §13.3 risk #3).
  Fixed by adding a **Minsky leverage-fragility term** to `RegionSim.tickMonetary`: a high *level*
  of private leverage (above `LEVERAGE_FRAGILE = 1.6`… tuned to 1.5) erodes confidence at
  `FRAGILITY_GAIN` per unit, independent of debt service. Under an active dovish banker the harness
  now reports **~2.9 busts/century, 0 depressions** (on target); the `passive` (pinned-neutral)
  control stays dormant (leverage never builds), confirming it's the credit cycle, not noise. Pinned
  by two end-to-end cases in `tests/macro.test.ts`.

Test baseline restored to **839** (825 on main + 14 recovered), then **841** with the cycle-emergence
tests.

---

## Session Snapshot — What Landed (2026-06-15)

### PR #134 — TownCore parity completion + research + live-game UX (52 commits, +4,004/−146; suite 709 → **825** tests)

The largest bundle to date. It closes the **B-6 behavior-parity gap** on the SoA `TownCore`,
adds the colony's first tech tree, and ships a wave of live-game UX. Three threads:

**1. `TownCore` reaches fat-sim parity (town tier).** Added on the deterministic core:
- **Random-event deck** — full auto deck (cold snap, rats, festival, fever, bumper harvest,
  windfall timber, skill breakthrough, storm, injured worker, merchant, settler feud) plus
  **choice events** (trader caravan, bandit demand, refugees, feud, scholar) and
  plague / found-gold / heatwave / wandering-healer / mineral-strike. `pendingChoice` serialized.
- **Seasonal farming + drought** (`weather.growthMult` → field yield), **colony-wide food-variety
  mood**, **clothing distribution + warmth decay**, **ale** as food+recreation, **burial-ground
  room** + unburied-dead / slept-on-ground mood penalties.
- **Progression & economy:** prestige + era progression, difficulty system + `startColony()`
  convenience ctor, town focus + town name, standing trade orders, 7-day stock history + `netFlow()`.
- **Content:** deer herd + hunting lodge, fishing → `fish_meal`, housing-preference mood bonus,
  flax harvest zone (loom chain), watchtower early-warning, spike traps, meal-spoilage cap,
  emigration, forester sapling regrowth, well + yard room, market room + stalls (passive gold),
  carpentry bench (wood → tools) + rope scaffolding bonus, barracks + drill.

**2. TownCore research system** — `src/sim/research.ts` (`ResearchBook`): 12 `CoreTechDef` across 3
tiers, library-desk point generation (10 pts/day), auto-research queue, prereq checks, serialization.
Real effects: `crop_rotation` (free) field yield ×1.25, `militia_training` +30% settler melee in raid
& wolf defense (via `defenderDamageMult` on `RaidForce.tick`/`WolfPack.tick`), `crop_science` stacks
to ×1.45. **TownCore save format bumped through v7 → v10** (research book, event timer, season tracker,
clothing/festival/milestone/drought state all serialized; old saves backfill).

**3. B-6 Stage 4 view adapter DONE + play-test + live UX.**
- **Iterator API** so renderers never reach into SoA columns: `TownCore.settlers()`,
  `stationViews()`, `raiders()` generators (+ `SettlerView`/station/raider view interfaces).
- **`core.html` is now a playable colony sim** — room paint (Z, `[`/`]` cycles 14 types), station
  tool (A, `,`/`.` cycles 19 types), gate (G), bare floor (D), unified erase (E), click-to-inspect
  settler overlay, expanded stats overlay; `index.html?core` routes the main app URL to it.
- **Live game (`sim.ts` + HUD):** research queue UI + per-tech ETA + tech descriptions, weather &
  temperature HUD, drought/flood overlays + HUD indicator, day/night cycle, prestige (pop milestones
  25/50/100/200, tiers, raid-survival), Y-key focus cycle, sick indicator + colony-health HUD +
  food-projection HUD, scholar event, library + infirmary + starting herbs in the founding town,
  tile hover tooltip, services HUD, winter tint, tools build bonus, immigration gates. Live save
  (`sim.ts`) stays `v: 3`; the **main-app `SAVE_VERSION` is 10**. Comprehensive event tests added.

---

PRs #131–132 added AI sprite generation on top of the PNG override pipeline from PR #130:

- **`scripts/hf-sprites.ts`** — CLI that calls the Hugging Face Inference API to generate pixel-art sprites and drops them into `public/sprites/`, updating `index.json`. Registered as `npm run hf-sprites`.
- **Model:** `nerijs/pixel-art-xl` (SDXL LoRA trained on pixel art). Generates at 512px+, 25 steps, `guidance_scale 7`, with a `negative_prompt` that suppresses smooth/realistic output. The browser's `applyOverrides()` scales the result to each slot's canvas size.
- **61 slots catalogued** with tuned prompts: terrain (grass, tree, water, rock, soil stages), build system (palisade, gate, floor, wall plans), creatures (settlers ×3 variants ×4 frames, raiders, wolves, deer), and items (wood, stone, grain, meal, tools, weapons, …).

**Quick usage:**
```bash
# Preview what would be generated (no API call)
npx tsx scripts/hf-sprites.ts --dry-run

# Generate all sprites
HF_TOKEN=hf_xxx npm run hf-sprites

# Generate a subset
HF_TOKEN=hf_xxx npm run hf-sprites -- --slots=tree,grass-0,rock

# Use a different model
HF_TOKEN=hf_xxx npm run hf-sprites -- --model=stabilityai/stable-diffusion-xl-base-1.0
```

Generated PNGs land in `public/sprites/<name>.png` and are registered in `public/sprites/index.json`. The game loads them automatically on next page refresh — no code change needed. See `public/sprites/README.md` for the full slot-naming convention.

---

PR #121 merged three major UI systems and fixed a critical FPS regression:

1. **Zoom-LOD rendering** (`src/ui/render.ts`): tiles collapse to flat colors at zoom < 0.4; decorative overlays (HP bars, status marks, graves) gate at zoom < 0.5. No visual pop; smooth FPS curve from 76fps (zoomed in) to 30fps+ (overview).

2. **WindowManager** (`src/ui/WindowManager.ts`): draggable panel system with localStorage persistence and z-order control. Grab-from-background only (excludes buttons/inputs). Converts CSS-anchored panels (e.g., `right: 0`) to left/top on first drag.

3. **Tabbed UI** (across `hud.ts` + `regionview.ts`): inspector resources/priorities/diplomacy split into tabs; town/state/economy panels organized into logical tab groups; Finance tab further split into Treasury/Credit sub-tabs. CSS-driven switching (no DOM rebuild). 60% reduction in vertical scroll per panel.

4. **Statehood banner fix**: moved up 6px to clear the opaque DOM bottombar (was hidden at zoom out).

---

## Key Architecture Patterns

### 1. WindowManager Pattern — What to Know

**File:** `src/ui/WindowManager.ts` (add to any HUD that needs draggable windows)

**Quick start:**
```typescript
const wm = new WindowManager([
  { id: 'inspector', element: inspectorEl, baseZ: 20 },
  { id: 'priorities', element: prioritiesEl, baseZ: 19 },
]);
// Later, add a panel dynamically:
wm.register({ id: 'myPanel', element: panelEl, baseZ: 15 });
```

**How it works:**
- Listens for `mousedown` at document level (capture phase)
- If the click lands on something in `NO_DRAG` selector (buttons, inputs, `.prio`, `.trade-btn`, etc.), the drag is skipped
- Otherwise, records the drag offset and moves the element until `mouseup`
- On release, saves the position to localStorage
- Raises the window to `zIndex = FOCUS_Z (1000)` on click; restores previous z-index when another window takes focus

**Adding a new draggable panel:**
1. Ensure the panel has a `data-window-id` attribute (WindowManager sets this automatically via `register()`)
2. If the panel contains interactive controls that shouldn't trigger drag, add their selectors to `NO_DRAG` (line 18)
3. Call `wm.register(cfg)` after the element exists in the DOM
4. Give it a unique `id`, the DOM element, and a `baseZ` (z-index when not focused)

**Why localStorage:** positions persist across sessions, so players don't have to reposition panels every time.

**Known limitation:** `NO_DRAG` is a static selector; if you add dynamic interactive content (e.g., a popover menu) after init, update `NO_DRAG` or add a data attribute to the new element.

### 2. Tab System Pattern — What to Know

**Pattern:** State variable + CSS visibility toggle + click handler delegation.

**Example — Finance sub-tabs (from `regionview.ts`):**

```typescript
// State:
let financeSubTab: 'treasury' | 'credit' = 'treasury';

// HTML (stays in DOM):
html`
  <div class="pal-tabs">
    <button class="pal-tab" data-restab="finance/treasury" ...>Treasury</button>
    <button class="pal-tab" data-restab="finance/credit" ...>Credit</button>
  </div>
  <div class="pal-subtabs" style=${financeSubTab === 'treasury' ? '' : 'display:none'}>
    <!-- Treasury content -->
  </div>
  <div class="pal-subtabs" style=${financeSubTab === 'credit' ? '' : 'display:none'}>
    <!-- Credit content -->
  </div>
`;

// Handler (mousedown delegation):
el.addEventListener('mousedown', (e) => {
  const btn = e.target.closest('[data-restab]');
  if (!btn) return;
  const [main, sub] = btn.dataset.restab.split('/');
  if (main === 'finance' && sub === 'treasury') financeSubTab = 'treasury';
  if (main === 'finance' && sub === 'credit') financeSubTab = 'credit';
  render(); // redraw; CSS visibility toggle applies next frame
});
```

**Why not CSS-only tabs?** We tried: `input[type=radio]` + `:checked` sibling combinator is fragile and hard to style. The state-driven approach is simpler and integrates cleanly with the rest of the reactive codebase.

**When to use:** if a panel has > 5 logical sections, split it into tabs. Each tab should contain 50–150 lines of content (a full screen of text at default zoom). If a tab is too long, add sub-tabs (Finance example).

**Nesting sub-tabs:** Keep it to 2 levels max. Main tabs (25% of panel width each) + sub-tabs (CSS `.pal-subtabs` with 2–3 buttons). Deeper nesting is impossible to click on mobile.

### 3. Zoom-LOD Rendering Pattern — What to Know

**File:** `src/ui/render.ts` (lines ~650–750, where `drawMap()` dispatch happens)

**Pattern:**
```typescript
const lod = zoom < LOD_ZOOM;          // 0.4
const detailZoom = zoom >= 0.5;       // 0.5

// Tile passes:
if (!lod) {
  // Draw grass, trees, water, overlays (normal detail)
} else {
  // Draw collapsed tile colors (flat rects)
}

// Entity passes:
// Always draw entities (buildings, settlers, animals)

// Decorative passes:
if (detailZoom) {
  // Draw HP bars, status marks, carried items, graves, corpses
}
```

**Why two thresholds?** Tile LOD (0.4) gates the most expensive passes (tile grid iteration). Detail LOD (0.5) gates per-entity overlays (HP bars, status marks). The split allows:
- At 0.45x zoom: tiles are flat (cheap) but entities still have visual details (context)
- At 0.35x zoom: both tiles and details are flat (maximum performance for overview)

**Adding a new rendering pass:**
1. If it's per-tile (grass, trees, water), gate it behind `if (!lod)`
2. If it's per-entity detail (status icons, labels), gate it behind `if (detailZoom)`
3. Measure frame time; if new pass drops FPS > 5, consider gating it behind a third threshold

**Measuring performance:**
- `console.time('drawMap'); ...; console.timeEnd('drawMap')` in `main.ts` tick loop
- Chrome DevTools → Performance tab → Frame rate graph (target ≥ 30fps at overview zoom)

---

## Code Locations — Where Things Live

### HUD Panels (Inspector, Priorities, Diplomacy)
- **File:** `src/ui/hud.ts`
- **Dragging:** WindowManager (registered at `main.ts` init)
- **Tabs:** `resourceTab` state variable (lines ~100), `wireTabs()` helper (lines ~120), `resourcesCard()` renders active tab (lines ~400)
- **CSS:** `src/style.css` `.inspector`, `.insp-tabs`, `.insp-tab`

### Region Panels (Town, State, Economy, Research)
- **File:** `src/ui/regionview.ts`
- **Dragging:** WindowManager (registered at `main.ts` when entering region mode)
- **Tabs:** 
  - Main tabs: `panelTab` (town), `statePanelTab` (state), `economyTab` (economy), `researchTab` (research)
  - Sub-tabs: `financeSubTab` (treasury/credit), `economyTab` (overview/settlements)
  - `wireTabs()` helper at line ~XX (search for `function wireTabs`)
- **CSS:** `src/style.css` `.pal-tabs`, `.pal-tab`, `.pal-subtabs`, `.pal-subtab`
- **Integration:** `draggablePanels` getter returns inspector + priorities + region panels for WindowManager registration

### Zoom-LOD Rendering
- **File:** `src/ui/render.ts`
- **Constants:** `LOD_ZOOM = 0.4` (line ~XX), `detailZoom = 0.5` (line ~XX)
- **Tile color collapse:** `tileColor()` function (line ~XX)
- **Main dispatch:** `drawMap()` function, gated passes within

### Window Persistence
- **File:** `src/ui/WindowManager.ts`
- **localStorage key:** `centuria_windows` (JSON record of `{ panelId: { x, y } }`)
- **Drag logic:** `onDown()`, `onMove()`, `onUp()` methods

---

## Common Edits — How to Do Them

### Add a new tab to the Resources panel
1. Add a new case to `resourceTab` state (e.g., `'trade'`)
2. Add a new button in the tab row with `data-restab="trade"`
3. Add a new content div in `resourcesCard()` with `style=${resourceTab === 'trade' ? '' : 'display:none'}`
4. Add the handler in the mousedown listener: `if (restab === 'trade') resourceTab = 'trade'`
5. Test: click the tab, ensure it switches

### Add a new draggable panel
1. Create the panel HTML in `hud.ts` or `regionview.ts` with a unique ID (e.g., `'my-panel'`)
2. Add it to the `draggablePanels` getter's return array
3. Pass the array to `WindowManager` constructor in `main.ts`
4. Test: click and drag the panel, reload the page (position should persist)

### Adjust zoom-LOD thresholds
1. `LOD_ZOOM = 0.4` in `render.ts` — lower = tiles stay detailed longer (better visuals, worse FPS). Raise to improve FPS at cost of detail.
2. `detailZoom = 0.5` in `render.ts` — gates HP bars, status marks. Adjust similarly.
3. Rerun with `npm run dev` and zoom out while watching frame time in console
4. Goal: ≥ 30fps at zoom 0.2, ≥ 60fps at zoom 1.0+

### Split a tall panel into tabs
1. Identify logical sections (e.g., "Overview", "Settlements", "Settings")
2. Create a state variable (e.g., `let myPanelTab = 'overview'`)
3. Move each section's HTML into a separate `<div>` with conditional `display:none`
4. Add buttons with `data-resub="sectionName"` to the tab row
5. Add a click handler to switch the state variable and re-render

---

## Testing

**Unit tests:** `npx vitest run` (825 tests, ~100s)  
**Type check:** `npx tsc --noEmit` (must pass before commit)  
**Build:** `npm run build` (must pass before commit)  
**Manual test:** `npm run dev` → http://localhost:5173 → play for 5 minutes at various zoom levels, check FPS and panel usability

**Smoke tests for UI changes:**
- Click every tab; ensure content switches correctly
- Drag every panel; refresh page; ensure position persists
- Zoom in/out; watch FPS at each threshold (goal ≥ 30fps at zoom 0.1–0.3)

---

## B-6 PART 3 — the swap, re-scoped (2026-06-15)

**Verdict from this session's verification:** repo is green (tsc + build clean, **825 tests** after
this session's stages) and
every PART 2 parity port is real. The raid GUI play-test is cleared. **But the swap is blocked
*structurally*, not by tuning** — a direct `TownCore`-for-`Simulation` swap would delete the playable
game because the live UI reads fat-sim shapes the SoA core lacks: a **World/terrain layer**, a
**building layer** (`buildings.json`), **fat settler objects** (vs SoA columns), an **event log**
(`sim.log`), **corpse/grave/item/animal arrays**, and **player build verbs**.

**Design decision (user):** target is **Songs of Syx** — *painted blueprints* for buildings (the
`BuildGrid` paint model wins; pre-placed buildings retire) **on complex terrain**. Full staged
roadmap in `PLAN.md` § *B-6 PART 3*. Status:
- **Stage 1 — terrain layer on `BuildGrid`** ✅ landed: `terrain`/`ore` Uint8 layers (grass/tree/
  water/soil/rock), terrain-aware `passable()`, deterministic `generateTerrain()`, base64
  serialization (old saves backfill to all-grass), opt-in `new TownCore({ terrain: true })`.
- **Stage 2 — harvest zones (Songs-of-Syx)** ✅ landed: a `zone` layer (field/woodcutter/quarry/
  fishery) designable only on matching terrain; `TownCore.harvestZones()` works them into raw goods
  daily (grain/wood/stone/iron_ore/meal), labour-capped, consuming zones deplete. `core.html` has
  paint tools + auto-zone. Yields are GUI-tunable flat constants.
- **Stage 3 — event log on `TownCore`** ✅ landed: `log: LogEntry[]` (`{ day, text, kind }`, the fat
  sim's shape) fed on founding/raids/wolves/deaths/births; save **v5** (old saves → empty log).
- **Stage 3b — settler names** ✅ landed: `AgentStore.names[]` (deterministic from id), through
  swap-remove, serialized; deaths/births named in the log.
- **Stage 4 — settler + collection view** ✅ landed (completed in PR #134): `TownCore.inspect(i) →
  SettlerView` for the HUD inspector, plus the renderer-facing iterator API —
  `settlers()` / `stationViews()` / `raiders()` generators so renderers never reach into SoA
  columns. (`tiles`/`zones`/`builds` iterables, if needed beyond the existing getters, land with the
  Stage 5 renderer.)
- **Stage 7 — blueprint construction** ✅ landed: `TownCore.builds[]` + `blueprintWall/Floor/Station`
  + `tickConstruction()` (materials + labour → real build), `cancelBlueprint`.
  `core.html`'s wall tool now paints blueprints the colony builds.
- **Research (PR #134)** ✅ landed: `src/sim/research.ts` (`ResearchBook`) — colony tech tree fed by
  library desks, with real raid/yield/health effects. Save bumped to **v10**.
- **Remaining: Stages 5, 6, 8 — renderer / live wiring / destructive swap.** These touch
  `render.ts`/`main.ts` (no test catches a regression), so land them in a session where the result
  can be watched. `core.html` + `src/coreview.ts` is the working SoA reference renderer to port from;
  the model layer (`TownCore`) is feature-complete and deterministic.

**Current SoA-core feature set (all on `TownCore`, deterministic + serialized):** terrain, harvest
zones + primary production, blueprint construction, room/station crafting, needs/mood/thoughts,
traits/skills, wounds/medical, relationships, weather, raids, wolves, town economy (loans/inflation),
settler names, event log (full random-event deck + choice events), seasonal farming/drought,
food-variety + clothing + burial mood systems, prestige/era progression, research tech tree,
`inspect()` + iterator view API. Save format **v10**.

## Next Steps (B-6 PART 2 Swap + Beyond)

**B-6 PART 2 — the live swap (still gated, NOT a "mechanical swap").**
Reality check: `TownCore` (~2,060 lines) is *not* a drop-in for `Simulation` (~3,860 lines) +
`region.ts` (~7,245 lines). The live `main.ts`/`render.ts`/`hud.ts`/`regionview.ts` are coupled to
`sim.settlers`/`sim.world`/`buildings.json`/the region flip — none of which the SoA core has. A
blind swap would *delete the playable game*. Do it incrementally, behind a flag, with a play-test.

- **Behavior parity port — done (PR #134).** On the SoA columns now: traits/skills, wounds/medical,
  relationships/thoughts, weather, market (buy/sell + daily price recovery), the **full random-event
  deck + choice events**, seasonal farming/drought, food-variety/clothing/burial mood systems,
  prestige/era progression, a **research tech tree** (`research.ts`), and **raids/combat**
  (`src/sim/raid.ts` — `RaidForce`/`raidSize()`; raiders converge, walls slow them, settlers rally
  as a militia, attackers flee on timeout; wired into `TownCore.tick` before the death pass).
  Tests: `tests/raid.test.ts` (15) + raid cases in `tests/parity.test.ts`.
- **Defense parity ports — done.** Three fat-sim threats/defenses now live on the SoA core:
  - **Spike traps** (`BuildGrid.trap` layer + `setTrap`/`tripTrap`, serialized): one-shot tiles that
    bite the first raider onto them for `TUNING.trapDamage`. Tripped in `RaidForce.advance`.
  - **Forged-weapon / spear bonuses** (`AgentStore.armed` column 0/1/2, serialized): `TownCore`
    arms the militia from the stores when a raid musters (`armColony` — forged `weapons` first, then
    wood `spears`); `settlerMeleeDamagePerHour` (exported from `raid.ts`) adds the tuned bonus for
    both raid and wolf defense.
  - **Wolf packs** (`src/sim/wolves.ts` — `WolfPack`, a smaller sibling of `RaidForce`): packs prowl
    in from an edge on a per-day roll (`TUNING.wolfFirstDay`/`wolfPackChancePerDay`), stalk and maul
    strays, the bitten fight back, and a mauled/overstayed wolf flees. Wired into `TownCore.tick` +
    `summonWolves`, serialized at save v3. Tests: `tests/wolves.test.ts` (8) + weapon/trap cases in
    `tests/raid.test.ts`.
- **Economy parity port (town tier) — done.** The town-tier slice of the fat sim's monetary stack now
  lives on the SoA core (`src/sim/ledger.ts` — `Ledger`):
  - **Lenders + loans**: three NPC lenders (`lenders.ts.createInitialLenders`); `TownCore.takeLoan`
    credits the treasury and records an amortizing loan; `repayLoan` pays it down manually. Each month
    (`day % 30`) interest accrues, the colony auto-services due installments from gold, and a loan
    overdue past a 90-day grace defaults (dropping the lender's confidence). Mirrors `region.ts`'s
    `requestLoan`/`repayLoan`/`updateLoans` — but with a deterministic loan-id counter, not the fat
    sim's `Math.random`.
  - **Inflation**: `TownCore.inflation` re-reckons monthly from the money supply (gold + outstanding
    debt) over a GDP proxy (`wealth()`), and rides on top of every market price via `priceMult`. A
    debt-free, coin-poor colony sits at 0% (so existing market tests are untouched); heavy borrowing
    prints money and lifts prices.
  - Save bumped to **v4** (ledger + inflation). Tests: `tests/ledger.test.ts` (15).
  - **Out of scope (region tier, swap territory):** GDP/tax engine, monetary-policy rate, bonds, FX,
    central bank, credit cycle — all welded to `region.ts`.
- **Play-test fixes (found by running `/core.html`):**
  - `BuildGrid` now has a **gate** (`setGate`/`clearGate`, serialized): a passable opening that still
    seals a room for enclosure — without it a fully-walled room was unreachable, so doored rooms
    were impossible. (This was a listed swap blocker; now done.)
  - **Rest/recreation are served colony-wide** in `TownCore` (`serveNeeds(..., colonyWide=true)`):
    settlers recover from total bed/table capacity instead of needing to stand in the room — the
    same global model already used for feeding. Before this, settlers slept where they collapsed,
    never recovered rest, and the colony starved. Regression: `towncore.test.ts` "survives and grows
    over 30 days" (the long-horizon test whose absence hid the bug).
- **Still missing before a swap is safe:** the `region.ts` flip and **raid balance tuning** (headless
  numbers are conservative — tune in the GUI). Spike traps, forged-weapon/spear bonuses and wolf packs
  are now ported (see the Defense parity ports note above).
- **Gate that remains: GUI play-test.** A *non-destructive parallel mode* now exists: `core.html`
  + `src/coreview.ts` boot a `TownCore` with a starter town and render it (agents/walls/stations/
  raiders + a stats overlay) in a real browser — `npm run dev` → `/core.html`. Controls: space
  pause · 1/2/3 speed · R raid now · N add settler · left-drag wall · right-drag erase. The live
  game (`main.ts`/`index.html`) is untouched. Use this to play-verify the core (esp. raid balance)
  before the destructive swap. ponytail: direct canvas draw, not the fat-sim `Renderer`.

**Future (after B-6 PART 2):**
- Phase 3 (Parcel purchase UI) — right-click fog cell, cost panel, purchase button (low friction; no new architecture)
- Phase 4 (Chunk rendering) — 3-mode zoom dispatch for seamless world (moderate complexity; coordinate math heavy)
- Phase 7 (Web Worker) — offload `TownCore` tick to worker thread (high architectural risk; follow pattern in `vite.config.ts` + `src/workers/`)

**Key invariant:** All new UI for phases 3–4 is temporary (replaced by Phase 4 renderer). Don't over-build the purchase UI; land the bare minimum (1–2 panels) and defer polish until Phase 4.

---

## Quick Reference — File Sizes & Complexity

| File | Size | Complexity | Last touched |
|---|---|---|---|
| `src/ui/WindowManager.ts` | ~65 lines | Very simple | 2026-06-15 |
| `src/ui/hud.ts` | ~41K lines | High (but modular by tab) | 2026-06-15 |
| `src/ui/regionview.ts` | ~123K lines | Very high (will be deprecated) | 2026-06-15 |
| `src/ui/render.ts` | ~23K lines | Very high (hot path) | 2026-06-15 |
| `src/style.css` | ~3K lines | Moderate | 2026-06-15 |
| `src/sim/towncore.ts` | ~2,060 lines | High (feature-complete town sim) | 2026-06-15 (PR #134) |
| `src/sim/research.ts` | ~190 lines | Simple | 2026-06-15 (PR #134) |

**Editing rules:**
- `WindowManager.ts` — can edit directly, small and isolated
- `hud.ts` + `regionview.ts` — coordinate with `style.css` for tab styling; search for the exact function before editing (line numbers drift)
- `render.ts` — always check frame time after edits; regressions are easy and hard to debug
- `style.css` — CSS-only; safe to edit but always test at multiple zoom levels

---

## Repo Health Checks (Do These Monthly)

```bash
# Test count stability
npm test 2>&1 | grep -i "passing\|failing"

# Type safety
npm tsc --noEmit

# Build size
npm run build && ls -lh dist/index.html

# Performance baseline (manual)
npm run dev
# Zoom in, 5s wait (should see 60fps)
# Zoom to 0.2x, 5s wait (should see 30fps+, no FPS drops > 5)
# Profiling: Chrome DevTools Performance tab, record 5s, check main thread time < 3ms per frame
```

---

## When Stuck

**FPS regression after edit:**
1. Undo the edit
2. Add `console.time('drawMap')` in `render.ts:drawMap()`, `console.timeEnd()` at the end
3. Note the time delta at zoom 0.5 and 0.2
4. Re-apply the edit; re-measure
5. If delta > 1ms, find which render pass is expensive and gate it behind LOD threshold

**Weird tab switching behavior:**
1. Check the state variable is declared at the right scope (function-level, not in a nested block)
2. Ensure `render()` is called after the state change (or the re-render won't see the new state)
3. Check `data-restab` attribute matches the handler's expected value

**Panel not dragging:**
1. Verify `data-window-id` is set on the panel element (WindowManager.register() does this)
2. Check that the clicked element is not in the `NO_DRAG` selector (look at line 18 in WindowManager.ts)
3. Verify localStorage is enabled in the browser (private mode disables it; the save silently fails but dragging still works)

**Build fails after package change:**
1. `rm -rf node_modules package-lock.json && npm ci`
2. `npx tsc --noEmit` (pinpoint the error)
3. If it's a type error in a new dependency, file a GH issue before merging

---

## Contact

- **Bug report:** Create a GH issue with reproduction steps
- **Architecture question:** Check PLAN.md § Model Assignment; if unsure, spawn a Plan agent
- **Code review:** Link the PR in Slack; allow 1–2 hours for feedback before merging

---

**Git flow reminder:**
```bash
git checkout -b claude/<task-name>
# ... make changes ...
git add src/...
git commit -m "Commit message here"
git push -u origin claude/<task-name>
# Create draft PR via GitHub web or gh CLI
# Once approved, squash-merge to main
```

No force-pushes to main. Rebase feature branches as needed; always create a new commit rather than amending after push.
