# Handoff — Centuria Development Guide

**Last updated:** 2026-06-18 · **Tests:** 917 passing · **Version:** v0.43.0

## The game: a standalone 4X campaign

TownCore (the town-detail / per-settler sim) is **dropped**. The shipping game is the
**4X campaign**, 1900→2100, colony→nation:

```
core.html → src/coreview.ts (shell)  →  src/ui/regionview.ts (UI)  →  src/sim/region.ts (RegionSim model)
```

- **`src/sim/region.ts`** — the deep model (~7.7k lines): sectoral economy, monetary policy +
  credit cycle, diplomacy/treaties/war, climate/emissions, tech + civics trees, factions/rivals,
  four win conditions, procedural worldgen (`src/sim/worldgen.ts`). **The depth lives here**; the
  UI surfaces it. Boot a campaign with **`RegionSim.foundColony(rng, map, weather, opts)`** (the
  replacement for the old `RegionSim.fromTown` flip).
- **`src/ui/regionview.ts`** — the 4X UI workhorse: the map (terrain/territory/**fog** cache,
  **atmosphere** lighting, routes, settlements, rivals, weather) + DOM panels (State →
  Finance/Politics/Diplomacy, Research, Routes, Settlements, Economy) + modals (Charter,
  Convention, Century report, Win, Era).
- **`src/coreview.ts`** — the campaign shell: boot, canvas, input, persistent top HUD, event log,
  toasts, objectives panel, help overlay, save/load, the fixed-timestep loop. Owns **no** map/panel
  rendering — that's `RegionView`. Tags `<body class="cv-app">` to scope the modern UI theme.
- The classic town game (`index.html` → `main.ts` → `Simulation`) still exists as "Classic Colony"
  on the title screen but is **not** the focus.

**Direction (user, locked):** painterly era-evolving map **and** modern strategy UI; colony→nation
arc starting from one fogged founding settlement.

## What's built (all merged to `main`)

- **Foundation** — `foundColony()`, clean shell, DPR-crisp canvas, draggable panels, HUD + log.
- **Terrain** — fog of war (feathered cloud shroud over `region.explorationMap`, hides
  undiscovered rivals; baked into the map cache, rebuilt as the explored count grows) + sea-depth
  bathymetry.
- **Atmosphere** — day/night tint, golden-hour dawn/dusk, population-scaled city lights, seasonal
  wash, vignette — all from one `atmosphere()` state, screen-space.
- **Modern UI** — cohesive cool-ink theme on CSS vars, scoped to `.cv-app` (classic game untouched):
  glass panels, pill tabs, accent buttons, slim scrollbars.
- **UX** — "Path to Nationhood" objectives panel (reads the model's own gates), event toasts,
  first-run welcome/help overlay.
- **Save/load** — autosave + Continue + manual save (Ctrl/⌘-S); `localStorage['centuria-4x-save']`
  stores the world seed + `region.serialize()`; reload via `RegionSim.deserialize` with a
  `{rng, regionMap, weather}` stub.
- **Content depth** — +12 wired tech/civic nodes filling 1900–2100 gaps; +8 era-gated regional
  events, +5 policy cards, +3 laws, all wired to existing sim hooks.
- **Main menu & UX** — new-game with terrain preferences (river/coast/highlands/random), continue
  if save exists, classic colony link. Economy sparklines (12-month GDP/treasury/inflation trends).
  Corner minimap with fog + click-to-pan. Settlement hover tooltips (pop/happiness/food).
- **Animated visuals** — subtle water shimmer, winter shores ice, seasonal particle effects.
- **Rival personality & diplomacy** — AI rivals initiate treaties based on personality archetypes
  (Hegemon/Trading Republic/Hermit Kingdom/Crusader/Opportunist), memorable diplomatic moments,
  rare special events (tributes, honor displays, alliance proposals).
- **Performance polish** — O(1) lookups for building/event definitions, researched techs, and enacted
  laws via Map/Set collections. Replaced 96 hot-path array searches in daily/monthly simulation loops
  with constant-time operations. ~2–4% overall speedup on long-run simulations.

## Gotchas

- `RegionView`'s camera works in **backing-store (device) pixels** (`canvas.width/height`,
  `MIN_SCALE = 1` = whole region fills the canvas). Feed it pointer coords in device px
  (CSS delta × DPR, or the `canvas.width / rect.width` ratio).
- `RegionView` auto-renders the State panel + selected-settlement inspector every frame — don't
  hand-roll canvas panels over it.
- The map cache is **static** (rebuilt only on signature change). Per-frame animation (water
  shimmer, atmosphere) must live in `draw()` after `g.restore()`, not in the cache.
- Content that shifts seeded balance must be checked with `npm run sim:macro` and the
  `region-longrun` tests, not just unit tests. New techs/policies/laws aren't auto-researched, so
  unmanaged baselines should be ~unchanged.
- Background agents share the working tree unless launched with `isolation: "worktree"`. Their
  worktrees live under `.claude/worktrees/` — exclude from vitest with `--exclude '**/.claude/**'`
  or test counts double.
- Stacked PRs only retarget to `main` cleanly if the repo has **"Automatically delete head
  branches"** on; otherwise they merge into stale base branches. Keep it on.

## Run & test

```bash
npm install
npm run dev        # http://localhost:5173/core.html  ← the 4X game
npm run build      # tsc + vite build (must pass)
npx tsc --noEmit
npx vitest run --exclude '**/.claude/**'   # 917 tests
npm run sim:macro  # nation-tier monetary harness — keep "ON TARGET"
```

## Recent completions (PRs #189–#204)

- ✓ **#189** — 4X foundation: `foundColony()`, clean shell, HUD + log, draggable panels
- ✓ **#190** — Terrain: fog of war + sea bathymetry
- ✓ **#191** — Atmosphere: day/night, city lights, seasonal tints, vignette
- ✓ **#192** — Tech & civics depth: +12 nodes (32→44 total)
- ✓ **#193** — Modern UI: cool-ink dark theme (`.cv-app` scoped)
- ✓ **#194** — "Path to Nationhood" objectives panel
- ✓ **#195** — Event toasts (log highlights as transient cards)
- ✓ **#196** — Save/load: autosave + continue + localStorage
- ✓ **#197** — Welcome overlay: first-run guide + ? button
- ✓ **#199–#200** — Recovery: UI stack + events/governance depth (stacked PR consolidation)
- ✓ **#201** — Handoff refresh: deleted stale PLAN.md
- ✓ **#202** — Technical docs: HANDOFF_TECHNICAL, BALANCE_KNOBS, TICK_CYCLE
- ✓ **#203** — Main menu + sparklines + minimap + settlement tooltips
- ✓ **#204** — Richer rival behavior: personality-driven diplomacy + rare special events
- ✓ **#205** — Performance polish: O(1) collection lookups in hot simulation paths

## Good next candidates

- **World view / province layer** — continental map for nation-tier play (procedural province
  borders, trade routes, capitals, military deployment).
- **Per-faction visibility** in settlement founding (currently uses global exploration map).
- **Advanced diplomacy UI** — treaty editor, trade bloc negotiation, espionage/sabotage.
- **Late-game flavor** — era-branching cinematics, victory cinematics, post-2100 epilogue states.

## Known weak areas

- **activePolicies lookups** — still uses array `.includes()` in 18 calls. Small impact (policy slots
  are fixed-size, typically 3–4 items), but could convert to Set if microoptimization needed.
- **sectorProductivity() method** — 23 `.has()` checks per settlement per month now O(1), but could
  cache the multiplier per sector once per month instead of recalculating 4× per settlement.
- **UI render loop** — not yet profiled. Canvas paint, DOM panel rendering, and event handler
  performance unknown. Likely less critical than simulation hotpaths but worth measuring under
  typical play (1–3 month-per-second tick rate).
- **Migration and trade calculations** — use `.reduce()` to recompute avgWageOf() per settlement
  once per month; low impact but could cache during the monthly update phase.

## Design reference

`GDD.md` is the design document. `docs/specs/` holds the per-milestone specs. (The former
`PLAN.md` documented the retired TownCore/seamless-world track and has been removed.)
