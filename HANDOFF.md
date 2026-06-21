# Handoff — Centuria Development Guide

**Last updated:** 2026-06-21 · **Tests:** 368 passing · **Version:** v1.0.1 · **Status:** Phases 1–7 complete + historical anchors + Depression anchor/depth/response toolkit + cabinet expansion

## The game: a standalone 4X campaign

TownCore (the town-detail / per-settler sim) is **dropped**. The shipping game is the
**4X campaign**, 1919→2100, colony→nation:

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
- **Content depth** — +12 wired tech/civic nodes filling 1919–2100 gaps; +8 era-gated regional
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
npx vitest run --exclude '**/.claude/**'   # 316 tests
```

## Recent completions (PRs #218–#238)

- ✓ **#218** — Fix labor_law grievance test: measurement window and strike masking
- ✓ **#219** — Tech tree rebuilt as visual DAG: SVG edges, node state coloring, click-to-research
- ✓ **#220** — Naval system: harbor building (coastal_only), warship unit, sea-trade income method
- ✓ **#221** — Route maintenance budget: `routeBudget` knob (0–1.5), budget slider in UI, `maintainRoutes()` scaled
- ✓ **#222** — Harbor building added to `region_buildings.json`; warship in UNIT_TYPES
- ✓ **#223** — Tech tree visual layout fixes; research panel widened to `min(720px, calc(100vw - 240px))`
- ✓ **#224** — Route budget slider wired: live readout update without panel rebuild; 4 new budget tests
- ✓ **#225** — Phase 3 polish: dynamic panel sizing (Issue #14), treasury milestone events (Issue #15), music volume reduced 0.5→0.4 (Issue #13)
- ✓ **#226** — Rivals national identity (Issue #18): 11 named rival nations with unique flags/emblems, archetype-specific AI behavior, power comparison indicators; installer UI brightened (blue gradient, glowing title); package.json description updated
- ✓ **#229** — Land purchase mechanics (Phase 1): unclaimed land claim (£25/cell, `claimCell`/`canClaimCell`), population-scaled settlement buyout (`buyLand`/`canBuyLand`/`settlementBuyoutCost`), Claim Land Mode toggle in Diplomacy tab; 22 new tests (251 total)
- ✓ **#230** — Province View (Phase 2): `Province` interface + `computeProvinces()` in region.ts; `drawProvinceOverlay()` canvas layer (faction-colored name labels, pop/GDP/satisfaction stat bars, selection ring); `drawProvincePanel()` inspector DOM panel; click-to-select province; P key shortcut; Province View toggle in Diplomacy tab; 10 new tests (261 total)
- ✓ **#233** — Advanced Diplomacy (Phase 3) + Late-Game Flavor (Phase 4): espionage (`ESPIONAGE_OPS`, per-rival `intel`, `runEspionage` with exposure), trade blocs (`TradeBloc`, `blocTradeBonus`), era/victory cinematics (`drawCinematic`), post-2100 epilogue scroll (`epilogueBeats`/`drawEpilogueModal`); 24 new tests (285 total)
- ✓ **#236** — 1919 campaign start (Issue #25): `START_YEAR = 1919`, post-Great War founding lore in `foundColony()`; save/load determinism fix (preserve `currentGoal` on deserialize, guard `successCondition` callers with `typeof` so the `aiRng` stream stays aligned across save/load cycles); 3 test fixes (`region-longrun`, `region`, `region-found`) and updated era-gated tech/calendar test expectations for the new epoch; rival nation lore rewritten for post-WWI context (leader titles, descriptions, `techUnlock` refs); Humanitarians `minYear` 1920→1919; Merchant Guilds updated as a 1919–1925 transitional faction
- ✓ **#238** — Historical anchors (GDD §1): three scripted world-events that rhyme with history without reciting it — **world-war window** (1936–1948: fires when rival tensions peak + an expansionist is in the mix; escalates the most hostile rival pair into open war, shakes player confidence); **oil shock** (1970–1985: fires when combustion_engine is researched but no renewables exist; treasury drain + inflation spike + currency hit + industry slump in player settlements); **2020-analog pandemic** (2012–2027: 4%/month roll; pushes a 60–120 day pandemic_wave onto all settlements, with severity halved if `antibiotics` is researched); each fires at most once, is fully serialized, and backfills `false` on old saves; 18 new tests (`tests/historical-anchors.test.ts`, 334 total)
- ✓ **#239** — Great Depression anchor (GDD §8.1) + cabinet expansion (GDD §8.7): Depression moved to `tickHistoricalAnchors()` (1927–1936 window, `privateLeverage × policyRate > 0.12 && confidence < 55`); richer chain effects — confidence −40, leverage ×0.65, export collapse ×0.55, bank-failure treasury drain (~12% GDP), 150-day labor_shortage events on all player settlements, grievance +25 / satisfaction −15, legitimacy −12 for nation tier, two dramatic log entries (THE CRASH + DEPRESSION); cabinet expanded from 3 → 6 portfolios: Foreign Secretary (+5 envoy relations), Science Minister (+15% research rate), Press Secretary (−25% legitimacy decay); old saves with 3 ministers backfill remaining slots to null on deserialize
- ✓ **#239 (follow-up)** — Depression depth + response toolkit: `depressionDepth` (0→1, set 1.0 on crash, decays ~5%/mo over ~30 months) drives multi-year export suppression (`× max(0.3, 1 − depth×0.55)`) and a confidence-recovery ceiling (`35 + 65×(1−depth)`). Month-12 **recovery crossroads** (`chooseRecoveryPath`): stimulus (halves depth, −£8/mo × 24) vs austerity (−20% depth, services cut, grievance spike). New **emergency measures** (`enactDepressionMeasure`, once each while a slump is active, GDD §8.1): **QE** (rate cut, depth ×0.80, +inflation, needs Central Bank), **Leave Gold Standard** (float + devalue, depth ×0.78, export surge via existing fxBoost), **Public Works** (treasury cost, depth ×0.82, grievance −12 / clears labor_shortage). Each measure adds a `depressionCeilingBonus` so the recovery cap lifts. UI: redesigned **Depression Response panel** in `nationHtml` → `depressionResponseHtml()` (depth meter bar, crossroads fork cards, measure cards with used/blocked states) with dedicated `.crisis-banner`/`.depth-meter`/`.dep-measure-btn` CSS. All 5 depression-depth fields + `depressionMeasuresUsed`/`depressionCeilingBonus` serialize with old-save backfill. 34 tests in `tests/depression-cabinet.test.ts` (368 total)

## UI Architecture Notes (updated 2026-06-19)

**Dynamic panel sizing** — `.settlement-list-panel` and `.economy-panel` use `min-width: 260px` / `max-width: min(600px, calc(100vw - 380px))` so they expand to content without overflowing the viewport. Added `overflow-x: hidden`, `word-wrap: break-word`, `overflow-wrap: break-word` for long settlement names.

**Research panel** — rewritten as a visual SVG-overlay DAG (`drawResearchPanel()`). Column layout via `techTreeLayout()` (depth-first, barycenter row sort); bezier edges via the SVG overlay `.tt-edges`; node states `.tt-done`, `.tt-active`, `.tt-avail`, `.tt-locked`. Width `min(720px, calc(100vw - 240px))`.

**Route budget slider** — `oninput` updates `.rn-budget-readout` and `.rn-budget-note` spans in-place (no full panel rebuild). Calls `r.setRouteBudget(v)`. See `drawRouteNetworkPanel()`.

**Keyboard shortcuts** — ESC closes current panel; S=settlements, E=economy, R=research, N=route network.

## Event Logging Coverage (updated 2026-06-19)

`addLog(text, kind)` is the central log method. Events currently tracked:

| Category | Triggers |
|---|---|
| Population | Milestones: 50, 100, 200, 500, 1000, 2000 (per town) |
| Economy | Treasury milestones: £1k, £5k, £10k, £25k, £50k; treasury empty → services cut; strikes |
| Buildings | Completion: `The ${def.name} opens at ${t.name}` |
| Research | Tech breakthrough with description |
| Disasters | River floods, drought, sea-rise tidal events |
| Immigration | Waves of 3+ settlers drawn to content towns |
| Diplomacy | Treaty offers, rival emergence, regime change, war declaration, peace terms |
| Routes | Repair, washout, maintenance budget warnings |
| Rivals | New rival proclaimed; mischief; border friction; foreign wars |

## Audio System (updated 2026-06-19)

**Music** (`src/ui/music.ts`): procedural WebAudio, 6 era windows (ragtime 1900 → future 2040). Master volume target `0.4` (reduced from 0.5 for mid-game immersion). Variety comes from 3–4 hand-written melodic motifs per era that cycle bar-by-bar, with 25% chance of octave-up restatement. Tension scalar: paused → pad only (intensity 0); raid/conflict → full kit (intensity 1). Toggle stored in `localStorage['centuria-music']`.

**Soundscape** (`src/ui/soundscape.ts`): diegetic ambience — hammering (builders), train whistle (rail condition >50), crowd (grievance >50), birds (calm).

## Route Maintenance Budget

`r.routeBudget` (0–1.5, default 1.0) scales the monthly condition delta for all non-trail routes:

```
delta = min(12, -6 + 14 × budget)   // 0 = −6/mo; 1.0 = +8/mo; 1.5 = +15/mo
```

`r.routeUpkeepProjected()` returns the projected monthly spend at the current budget. UI slider in Route Network panel updates live without panel rebuild.

## Naval System

`hasHarbor(t)` — true if settlement has a 'harbor' building. `navalTradeIncome()` runs monthly: each harbor settlement earns `0.8 × sectorOutputOf(t) × 0.05` per month as sea-trade income to treasury. Harbor is `coastal_only: true`, prereq: `cartography`. Warship unit in `UNIT_TYPES` with `recruitCost: 80`, `trainingDays: 45`, `powerPerUnit: 3.0`, `supplyCost: 0.10`.

## Roadmap: Completed Phases

### Phase 1 ✓ (PR #229 — Land Purchase Mechanics) — COMPLETED
- ✓ **Unclaimed land purchase** — Players buy unclaimed hexes adjacent to settlements (£25/cell) at State tier
- ✓ **Settlement buyout** — Enhanced `buyLand()` with population-scaled costs (£400+£2/pop)
- ✓ **UI integration** — "Claim Land Mode" toggle in Diplomacy tab; click-to-claim map UX
- ✓ **Tests** — 22 comprehensive tests (all passing)

### Phase 2 ✓ (PR #230 — Province View) — COMPLETED
- ✓ **Province data model** — `Province` interface + `computeProvinces()` in `region.ts`; one province per settlement, keyed by settlement id
- ✓ **Canvas overlay** — `drawProvinceOverlay()`: faction-colored name labels with shadow, compact pop/GDP/satisfaction stat bars, selection ring for clicked province
- ✓ **Province inspector panel** — `drawProvincePanel()`: DOM panel with name, faction, population, GDP, satisfaction bar, garrison, buildings list; close button
- ✓ **Click-to-select** — Province View intercepts settlement clicks to set `selectedProvinceId` instead of opening settlement inspector
- ✓ **P key shortcut** — Toggle province view from anywhere (`main.ts`)
- ✓ **Diplomacy tab toggle** — "Province View (P)" button in State → Diplomacy section with active indicator
- ✓ **Tests** — 10 tests in `tests/province.test.ts`

### Phase 3 ✓ (PR #233 — Advanced Diplomacy: Espionage & Trade Blocs) — COMPLETED
- ✓ **Espionage/sabotage** — `EspionageOp` (gather_intel/steal_tech/sabotage_economy/incite_unrest) + `ESPIONAGE_OPS` defs; per-rival `intel` 0..1; `runEspionage()` rolls success + separate exposure on the AI stream; steal_tech vaults research / treasury, sabotage sets rivals back, incite_unrest can fracture alliances; exposure sours relations. UI: per-rival intel meter + covert-op buttons in Diplomacy tab
- ✓ **Trade blocs** — `TradeBloc` model (named multi-member union, shared tariff); `formTradeBloc`/`inviteToBloc`/`leaveTradeBloc`/`setBlocTariff` + `blocTradeBonus()` layered into monthly export earnings; UI section to found/grow/tune/dissolve
- ✓ **Treaty editor / trade negotiation** — already shipped earlier as the "bargaining table" deal modal (`DealBasket`, `openDealModal`); espionage + blocs were the genuinely-missing pieces
- ✓ **Tests** — 18 in `tests/diplomacy-advanced.test.ts`

### Phase 4 ✓ (PR #233 — Late-Game Flavor) — COMPLETED
- ✓ **Era-branching + victory cinematics** — `drawCinematic()`: frame-driven fullscreen canvas sequence (painterly sky, per-variant motif, letterbox, fade-in, title) that plays once when the century forks or a victory lands, before the DOM modal reveals; suppressed on loaded saves where the moment already passed; click / any key skips. Variants for all 3 era branches and all 4 win paths
- ✓ **Post-2100 epilogue** — `epilogueBeats()` resolves triggered post-2100 events to a narrative scroll (`drawEpilogueModal()`), shown once 3+ beats accumulate; persisted `epilogueShown` flag so it doesn't re-trigger on reload
- ✓ **Tests** — 6 in `tests/epilogue.test.ts`

---

## Roadmap: Outstanding Features (Beyond Initial Scope)

The four prioritized phases (1–4) are **complete and merged to main**. The following larger features remain unstarted and are recommended for Sonnet/Opus due to architectural complexity:

### Phase 5 ✓ (Province-Level Governance) — COMPLETED
- ✓ **`HexProvincePolicy` interface** — `taxMultiplier` (0.5–2.0), `investmentLevel` (0–2), `autonomyLevel` (0–2) per province
- ✓ **`getProvincePolicy` / `setProvincePolicy`** — player reads and sets admin policy for any owned province; gated behind State proclamation
- ✓ **`applyProvincePolicyEffects()`** — monthly tick: high autonomy boosts satisfaction/reduces grievance; high investment drains treasury and accelerates garrison; low autonomy minor satisfaction drag
- ✓ **`tickRivalProvinceGovernance()`** — commerce-weighted rivals invest in inter-provincial infrastructure monthly, gaining small population growth
- ✓ **Province panel UI** — Tax / Investment / Autonomy dropdowns appear in the province inspector for player-owned provinces
- ✓ **Provincial army markers** — Province overlay shows `⚔N` icons for stationed player (blue) and rival (red) armies

### Phase 6 ✓ (AI Espionage & Trade Bloc Activity) — COMPLETED
- ✓ **`tickRivalEspionage()`** — hostile rivals (relations < 10) roll 4–10%/month chance of a covert op against the player: `economic_pressure` (treasury drain), `military_recon` (intelligence flavor), `incite_dissent` (raises town grievance); caught on counter-intel roll → reverse relations hit + log
- ✓ **`RivalTradeBloc` interface + `rivalTradeBlocs[]`** — rivals with high commerce weights (≥5) form their own trade blocs; `tickRivalTradeBlocActivity()` runs monthly; shown in diplomacy tab
- ✓ **`rivalBlocTariffFriction()`** — rival blocs apply external tariff pressure on player exports to trade-agreement members (up to −30%); wired into monthly export earnings
- ✓ **`Sanction` system** — `imposeSanction(rivalId)` / `liftSanction(rivalId)` / `sanctionPressureOnPlayer()`; player-imposed sanctions last 1 year (−40% bilateral trade, −10 relations); rival retaliation fires when exposed in a serious espionage op; `tickSanctions()` expires elapsed sanctions; UI in Diplomacy tab with impose/lift buttons; wired into export earnings (up to −50%)
- ✓ **Espionage exposure → sanctions** — when a sabotage/incite op is exposed and the rival is hostile (rel < −20), `rivalImposeSanction()` fires automatically

### Phase 7 ✓ (Inter-Provincial Unit Movement) — COMPLETED
- ✓ **`ProvincialArmy` interface** — `id`, `ownerId` (0=player), `provinceId`, `destinationId`, `transitDays`, `units[]`, `supply`
- ✓ **`deployArmy(fromId, toId, type, count)`** — draws units from stationed pool / war army / garrison; calculates transit time by distance and unit type (cavalry faster, warship slower); creates a moving `ProvincialArmy`
- ✓ **`cancelArmyMovement(armyId)`** — halts a player army mid-march
- ✓ **`updateArmyMovement()`** — monthly: drains supply, advances transit days, triggers arrival log; calls `resolveProvinceBattle()` on arrival
- ✓ **`resolveProvinceBattle(provinceId)`** — simple power comparison (unit count × powerPerUnit × morale/100 × rival boost); winner drives loser out with attrition; logged as `BATTLE of <name>`
- ✓ **`tickRivalArmyAI()`** — expansion-minded rivals (expansion ≥ 6) spawn small militia armies at player border provinces with 2.5%/month chance; max 2 rival armies per nation
- ✓ **Army display** — province overlay shows `⚔N` count badges for player armies (blue) and rival armies (red) at each province

## Completed in PR #226

- ✓ **Rivals national identity** (Issue #18) — 11 named rival nations (Vasterholm, Kalimera, Tyrennia, Karelia, Sundered Communes, Northern League, Highland Federation, Crescent Sultanate, Iron Republics, Forest Collective, Sunset Empire) with unique flags/emblems, archetype descriptions, personality-driven treaty behavior, power comparison indicators
- ✓ **Installer UI** — Brightened from dark green to vibrant blue gradient; cyan glowing title with pulsing animation; gold→cyan gradient progress bar
- ✓ **Package description** — Updated to reflect 4X civilization builder scope (1919–2100, colonial to nation scale)

## Model Capability Guidance

- **Haiku scope:** Unit tests, bug fixes, small feature additions (<500 LOC), content hooks (events/techs/civics)
- **Opus scope:** Major architecture (Phases 5–7 above), cross-file refactors, large simulation features, integration testing

## Known weak areas

- **activePolicies lookups** — still uses array `.includes()` in 18 calls. Small impact (policy slots
  are fixed-size, typically 3–4 items), but could convert to Set if microoptimization needed.
- **sectorProductivity() method** — 23 `.has()` checks per settlement per month now O(1), but could
  cache the multiplier per sector once per month instead of recalculating 4× per settlement.
- **Migration and trade calculations** — use `.reduce()` to recompute avgWageOf() per settlement
  once per month; low impact but could cache during the monthly update phase.
- **Tech tree DAG layout** — `techTreeLayout()` uses barycenter heuristic; doesn't minimize crossings
  optimally for large sparse trees. Acceptable for current tree size (~40 nodes).

## Design reference

`GDD.md` is the design document. `docs/specs/` holds the per-milestone specs. (The former
`PLAN.md` documented the retired TownCore/seamless-world track and has been removed.)
