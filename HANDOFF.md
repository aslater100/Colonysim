# Handoff — Centuria Development Guide

**Last updated:** 2026-06-22 · **Tests:** 448+ passing · **Version:** v1.0.1 · **Status:** Phases 1–17 complete (overnight session: Phases 8–9, 11–17 shipped as draft PRs #251–256)

## Overnight session (2026-06-22) — Phases 8–17 shipped

All the following were implemented as separate draft PRs targeting `main` for review:

| PR | Phase | Status |
|----|-------|--------|
| #251 | Phase 13: Population & Society Depth (GDD §5.5) | Draft, CI green |
| #252 | Phase 12: Media & Misinformation System (GDD §8.3) | Draft, CI green |
| #253 | Phase 11: Era 7–8 Renewables, Automation & Speculative Branches (GDD §10) | Draft, CI green |
| #254 | Phase 8: Notable System Depth — lifecycle, dynasty & advisor quality (GDD §2.4) | Draft, CI green |
| #255 | Phase 9: Full Government Type System — 15 regimes, transitions, policy slots (GDD §9) | Draft, CI green |
| #256 | Phase 17: Historical Scenarios & Alternate Era Starts (GDD §8.8, §6.1) | Draft, CI green |

Phases 14 (Zoning), 15 (Economy FX), 16 (Warfare Depth), and 18 (Advisor Depth) were also launched and may have PRs by morning.

## Previous session (2026-06-22) — UX & economy pass

User-reported fixes, all shipped on this branch:

1. **Calendar shows the real era** — top bar reads `October 3, 1935` (model's own `year`/`monthName`/`monthDay`), not a raw `Year 16` offset. The old HUD also used an inconsistent 365-day calc; now it matches the sim's 60-day year.
2. **Total population in the HUD** — `r.playerPop()` (whole nation) always shown; a selected settlement's share appears in parentheses.
3. **Overall happiness in the HUD** — new `r.avgSatisfaction()` (pop-weighted, player settlements), colour-coded `☺ %`.
4. **Zoom out further** — `RegionView.MIN_SCALE` 4 → 2.
5. **Bigger hexes, hex-sized cities** — `REGION_N` 256 → 128 (hexes ~2× larger on screen, still 16k cells). Settlement glyphs (sprite + depot + labels + resource chips) now scale to hex size via `glyphScale()`/`withGlyphScale()`: a small town ≈ 1 hex, a metropolis grows to ~2.25. Pick/hover radius tracks hex width.
6. **Dedicated Central Bank window (B)** — researching the **Central Banking** civic (or enacting the charter) now lights up `hasCentralBank()`, which gates a real **Central Bank panel** (policy rate, regime, bonds, discount window, currency) instead of burying it in Finance→Credit. The monetary controls + wiring moved there; the Credit sub-tab points to it.
7. **Economy rebalance** — see "Next session — priority fixes" below.

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
npx vitest run --exclude '**/.claude/**'   # 368 tests
```

## Recent completions (PRs #218–#256)

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
- ✓ **#241** — Hex grid migration: square→pointy-top hexes (odd-r offset). New `src/sim/hex.ts` module: `hexNeighbors`, `hexCenter`, `hexCorners`, `hexLayoutParams`, `screenToHex`, `hexDistance`, `offsetToCube`. Updated: 6-dir neighbors + cube-distance A* in `worldgen.ts`; `canClaimCell` adjacency in `region.ts`; hex polygon rendering in `regionview.ts` (`drawTerrain`, `drawTerritories`, `drawFog`, `ensureWaterMask`, click hit-test). Tests: `hexNeighbors`/`hexDistance` in `tests/routes.test.ts`. Sim tests green (368) — but tests are sim-only, so the rendering layer shipped with known gaps:
- ✓ **#242** — Three-tier memory fog: explored-but-not-visible cells now show a cool-grey wash (`drawMemoryFog`, live overlay outside map cache) instead of full-colour terrain. Live rivals hidden in grey areas via `isVisibleToFaction` guard added at `regionview.ts:600,642`. Player scouts always shown; AI scouts hidden when not in current sight.
- ✓ **#244** — Rendering layer unified on hex geometry (all follow-ups from #241/#242 resolved):
  1. `toPx` rewritten to use `hexLayoutParams + hexCenter` — ALL map-space markers (settlements, routes, scouts, expeditions, rival diamonds, province labels, city lights, resource icons, army badges, trade-flow arrows) now land on the correct hex cell; drift ≥½ hex at high zoom is eliminated and click hit-tests match what is drawn.
  2. Rival fog hiding fixed as a consequence — marker positions now align with the fog hex coordinate.
  3. Expedition `isVisibleToFaction` guard added (mirrors scout guard pattern) so non-player expeditions are hidden in memory fog.
  4. Forest, plains, hills, and marsh terrain textures wrapped in `g.save/g.clip/g.restore` so `fillRect` details cannot bleed past hex edges; marsh reeds get their own clip block.
  5. Hillshade now samples hex-direction NW (`hexNeighborDir` dir 4) and W (dir 3) instead of square-grid `at(x,y-1)` / `at(x-1,y)`, removing the row-parity inconsistency on odd rows.
  6. `travelDays` (worldgen.ts) now lerps in cube coordinates (`offsetToCube` → lerp → round → convert back) so each sampled step lands on an actual hex neighbor.
- ✓ **#251** — Phase 13: Population & Society Depth — demographic transition (birth/death formulas, baby boom, aging crisis), migration appeal scores, education pipeline lag (25-slot ring buffer), Gini index, 6-rung unrest ladder (petitions→strikes→protests→riots→organized opposition→revolution), opinion dynamics with 1968/2030 youthquakes; 27 tests (428 total)
- ✓ **#252** — Phase 12: Media & Misinformation System — 6-tier media reach progression, press freedom axis (0–100), propaganda narrative, credibility gap (legitimacy cliff at ≥80 + spark), misinformation era (2015+, polarization growth), platform regulation, public media funding, media literacy investment (15-year lag); 5 new tech nodes; 49 tests (450 total)
- ✓ **#253** — Phase 11: Era 7–8 Renewables, Automation & Speculative Branches — 7 new tech/civic nodes (solar/wind, battery, EV, AI, carbon tax, cap-and-trade, green industrial policy), 4 new laws, automation unemployment drift, stranded asset write-downs, speculative branch gate at 2040 (solarpunk/corporatocracy/drowned); 38 tests (413 total)
- ✓ **#254** — Phase 8: Notable System Depth — full lifecycle (age, health, death, heir birth), WWI founding backstories, minister loyalty decay + defection, scandal events, `selectSuccessor()`, `advisorForecast()` with skill-weighted Gaussian noise, `buildDynastyTree()`; 23 tests (436 total)
- ✓ **#255** — Phase 9: Full Government Type System — 15 regime types, `GovTypeDef` with era gates/decay modifiers/maxSlots, `TransitionChain` system (multi-step authored chains), per-regime fields (planningOptimism, reportedGDP, credibilityGap, schismRisk, shareholderPatience), policy slots, `tickRegimeMechanics()`; 30 tests (431 total)
- ✓ **#256** — Phase 17: Historical Scenarios & Alternate Era Starts — `fromEraStart('1950'|'2000')`, 4 authored scenarios (The Long Peace, Iron Curtain, Digital Crossroads, Climate Emergency), scenario goals system, regime lock, difficulty knobs (crisisFrequency, aiAggression, historicalAnchors), scenario selection UI in title screen; 47 tests (448 total)
- ✓ **#249** — Economy rebalance + HUD/zoom/hex-scale/central-bank UX pass: real calendar (year/month/day in top bar), `playerPop()` + `avgSatisfaction()` in HUD, `MIN_SCALE` 4→2, `REGION_N` 256→128 + `glyphScale()`/`withGlyphScale()` hex-sized city sprites, `hasCentralBank()` + dedicated Central Bank window (B key), GDP-scaled public-sector spending (Wagner's law, `publicSector ≈ 9% GDP`), `flatCost()`/`devFactor()` for militia/scout costs, flat policy bonuses made GDP-scaled; 7 new tests (375 total)

### Remaining low-priority rendering notes

- **Memory fog refreshes weekly** — `isVisibleToFaction` rebuilds its cache every 7 days; grey boundary lags fast unit movement. Acceptable; could rebuild on scout/settlement events if needed.
- **Minimap on square dots** — intentional per plan (1px dots); no change needed.

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

## Roadmap: Outstanding Features

Phases 1–7 are **complete and merged to main**. The following phases are ordered by GDD priority and architectural dependency. Items marked *(in sim)* exist partially in `region.ts` but need UI surfacing or completion. Recommended model per phase noted.

> **Reading the GDD alongside this:** each phase below references the GDD section it implements. `GDD.md` is the design authority; this file is the implementation guide. When in doubt, the GDD wins on design intent.

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

---

### Phase 8 ✓ (PR #254 — Notable System Depth) — COMPLETED
- ✓ Full Notable lifecycle: monthly health decay, age-weighted death risk, heir birth (25–50 age window, 5%/yr)
- ✓ Minister loyalty decay + defection at loyalty < 20 (rival faction gains power, legitimacy −5)
- ✓ Scandal events for ministers with 5+ years in role
- ✓ `selectSuccessor()` prefers faction-aligned candidates
- ✓ `advisorForecast(portfolio, trueValue)` adds skill-weighted Gaussian noise
- ✓ `buildDynastyTree()` compiles DynastyNode[] from parent/child Notable links
- ✓ WWI founding backstories for 4–6 initial Notables in `foundColony()`
- ✓ 23 tests in `tests/phase8.test.ts`

### Phase 9 ✓ (PR #255 — Full Government Type System) — COMPLETED
- ✓ 15 regime types: democracy, republic, junta, monarchy, const_monarchy, abs_monarchy, oligarchy, theocracy, direct_democracy, corporatocracy, fascist, social_democracy, autocracy, one_party, technocracy
- ✓ `GovTypeDef` with `legitimacyDecayModifier`, `allowedLeanings`, `maxSlots`, `minYear?`, `maxYear?`
- ✓ Per-regime fields: `planningOptimism`, `reportedGDP`, `credibilityGap`, `schismRisk`, `shareholderPatience`
- ✓ `TRANSITION_CHAINS` for junta→democracy, abs_monarchy→democracy, autocracy→democracy
- ✓ `beginTransition()`, `advanceTransition()`, `activatePolicySlot()`, `deactivatePolicySlot()`
- ✓ `tickRegimeMechanics()` called monthly
- ✓ 30 tests in `tests/phase9.test.ts`

### Phase 10 — Climate System Depth (GDD §8.2) — *Sonnet scope*

Climate ledger exists (`emissions` tracking) but lacks the visible long-lag impact chain the GDD describes as the century's "slowest bad loop."

- **CO₂ accumulation with lag** — global `atmosphericCO2` (ppm, starts ~295 in 1919); each nation contributes per energy mix and industrial output; warming follows cumulative emissions with a **~20-year delayed impact** (player actions today hurt in 2 decades). NPC nations emit too
- **Ghost waterline** — render a faint blue coastal boundary on the hex map showing projected 2100 sea level; visible from ~2030. Quiet dread as persistent UI
- **Sea-level rise** — coastal hexes flood incrementally from ~2040; flooding destroys buildings, displaces population, creates climate refugees
- **Climate impact effects** — scaling with temperature rise: crop-yield volatility → failures; extreme-weather event frequency ↑ (storms, floods, droughts hitting infrastructure); habitability loss in coastal zones
- **Adaptation actions** — `buildSeaWall(provinceId)` (10-year build, high cost, blocks flooding); `floodProofZoning(settlementId)` (cost + build time, partial protection); `managedRetreat(settlementId)` (brutal politically, necessary late-game in worst scenarios)
- **Climate accords** — late-era diplomatic item (unlocks ~1990+): multi-nation treaty with emissions targets, verification mechanics, free-rider penalty (sanctions if defection detected), negotiated via the existing deal modal
- **Geoengineering** (2050+) — `launchGeoengineering()`: fast/cheap/side-effect-roulette; unilateral; triggers diplomatic crisis (`geoengineeringProtest[]` from affected rivals); roll random side effects (crop disruption, monsoon shift)
- **Test targets** — CO₂ accumulation rate, warming lag math, sea-level event triggers, accord serialization

### Phase 11 ✓ (PR #253 — Era 7–8 & Speculative Branch) — COMPLETED
- ✓ 7 new tech/civic nodes: solar_wind_parity, battery_storage, ev_adoption, ai_automation, carbon_tax, cap_and_trade, green_industrial_policy
- ✓ 4 new laws: carbon_pricing, cap_trade_law, green_industry_act, universal_basic_support
- ✓ `automationUnemployment` drift; `strandedAssetLoss` write-downs; `enactUniversalBasicSupport()`
- ✓ `determineSpeculativeBranch()` at 2040: solarpunk/corporatocracy/drowned based on CO₂, regime, Gini
- ✓ 38 tests in `tests/phase11.test.ts`

### Phase 11 spec (for reference) — Era 7–8 & Speculative Branch (GDD §10) — *Opus scope*

The game currently runs to 2100 but eras 7–8 (2010–2100) lack the full content, tech depth, and branching art the GDD specifies.

- **Climate & Automation era (2010–2040)**:
  - Renewables tech nodes: solar/wind parity, battery storage, grid-storage problem (intermittency), EV adoption curve
  - AI/automation waves: `automationUnemployment` variable; service/manufacturing job losses create political pressure for universal benefits or redistribution; automation also raises productivity
  - Carbon pricing civics: carbon tax (faction politics), cap-and-trade system, green industrial policy
  - Stranded asset mechanics: coal/oil infrastructure loses value as transition accelerates; `strandedAssetLoss` event for nations that moved late
- **Speculative branch (2040–2100)** — world-state-gated entry:
  - *Solarpunk branch* (low CO₂ + stable democracy + high equality): fusion power tech, cooperative global institutions, post-scarcity social contract
  - *Corporatocracy branch* (high inequality + tech dominance): arcologies, corporate charters replacing nation-states, subscription-tier citizenship
  - *Drowned branch* (high CO₂ + late adaptation): sea walls failing, climate refugee crises, resource wars over arable land, habitability collapse
  - Branch is determined by cumulative climate, economy, and regime choices — not a calendar flip
- **2040+ art/audio** — backdrop kits and era palette for each branch (see GDD §3.2); procedural soundtrack shifts to branch-appropriate idiom (organic acoustic for solarpunk, industrial dark synth for dystopia)
- **Test targets** — branch selection logic, speculative tech unlock gates, all three epilogue narrative paths

### Phase 12 ✓ (PR #252 — Media & Misinformation System) — COMPLETED
- ✓ 6-tier media reach: word_of_mouth → press → radio → television → internet → algorithmic
- ✓ `pressFreedom` (0–100), `propagandaNarrative`, `credibilityGap` accumulator
- ✓ Credibility gap ≥80 + spark → legitimacy cliff drop −30
- ✓ Misinformation era (2015+): polarization growth, algorithmic reach
- ✓ Player actions: grantPressLicense, censorMedia, enactPlatformRegulation, fundPublicMedia, investMediaLiteracy
- ✓ 5 new tech nodes; UI section in Politics tab; 49 tests in `tests/phase12.test.ts`

### Phase 12 spec — Media & Misinformation System (GDD §8.3) — *Sonnet scope*

The sim has no media system yet. This is the late-game political complexity layer.

- **Media reach progression** — `mediaReach` variable per era: word-of-mouth (1919) → press (1925+) → radio (1930s+) → TV (1950s+) → internet (1995+) → algorithmic feeds (2015+). Each stage multiplies how fast opinion moves (early century is a glacier; late century is a flash flood)
- **Press freedom axis** — extend existing liberty axis into a `pressFreedom` 0–100 variable:
  - Free press: approval reflects true conditions; corruption surfaces as forced scandal events; legitimacy is sturdy (earned)
  - Controlled press: player sets `propagandaNarrative` (buffers approval against bad news); `credibilityGap` accumulator grows monthly; gap > threshold + spark = legitimacy *collapse* (not decline)
- **Misinformation era** (2015+) — algorithmic feed event fires when `internet` tech researched + year ≥ 2015: opinion distribution *spread* widens (polarization parameter rises), consensus laws cost +20–30% more political capital, populist ideology swings amplify
- **Counters** (each with tradeoffs): `platformRegulation` (reduces polarization, angers tech factions), `publicMediaFunding` (buffers against credibility gap, costs treasury), `mediaLiteracyEducation` (15-year lag education investment, reduces long-run polarization)
- **Test targets** — credibility gap accumulation/collapse, misinformation era trigger, press freedom effect on scandal event rate

### Phase 13 ✓ (PR #251 — Population & Society Depth) — COMPLETED
- ✓ Demographic transition: `globalBirthRate()`/`globalDeathRate()`, baby boom (×1.2 1945–1975), aging crisis (pension burden 2050+)
- ✓ `appealScore()` for migration (wages, housing, services, safety, liberty); `tickAppealMigration()`
- ✓ Education pipeline lag: 25-slot `educationLag[]` ring buffer; `projectedSkilledWorkforce(n)`
- ✓ `giniIndex()` from 3-class wage approximation; grievance feedback per 0.1 above 0.4
- ✓ 6-rung unrest ladder with time-based escalation; `crackdownProtests()`, `concedeToProtesters()`
- ✓ Opinion dynamics: material experience drift, generational drift, 1968/2030s youthquakes
- ✓ 27 tests in `tests/phase13.test.ts`

### Phase 13 spec — Population & Society Depth (GDD §5.5) — *Sonnet scope*

The cohort matrix exists but several of the GDD's dynamic mechanisms are stub-level or absent.

- **Demographic transition** — birth rate formula: starts ~35/1000 (1919), falls with `educationLevel` + urbanization + child survival; death rate falls with health spending + sanitation. The mid-century boom and 2050s aging crisis (pension burden on shrinking workforce) emerge from this without scripting
- **Migration with appeal scores** — `appealScore(settlementId, class)` computed from wages, housing cost, services, safety, liberty-fit, discrimination; net migration flows down appeal gradient each tick; crises produce refugee *waves* (volume spike, not just trickle)
- **Education pipeline lag** — school coverage today → skilled cohorts 15–25 years later; the `educationLag[]` ring buffer tracks cohort progress; UI: "projected skilled workforce 2045" visible in education screen
- **Gini inequality index** — computed from wage distribution across class cohorts; feeds `unrestPressure` (inequality ↑ → unrest ↑, populist ideology drift toward extremes), crime, and policy political costs
- **Full unrest ladder** — expand current strike/grievance system to the full 6-rung ladder: petitions (flavor) → strikes (sector output −%) → protests (crackdown/concede branch) → riots (infrastructure damage) → organized opposition (faction power ↑) → revolution (§9 failure mode). Each rung visible in event log with attribution ("Dockworkers, day 8 — over wage decline and rent")
- **Opinion dynamics** — cohort ideology drifts toward (a) material experience (unemployed → anti-incumbent + extreme), (b) media exposure (Phase 12), (c) generational replacement (children imprint on the era they come of age in — 1968-analog and 2030s youthquakes emerge from this)
- **Test targets** — demographic transition curve shape, Gini formula, unrest ladder progression, education pipeline delay

### Phase 14 — Zoning, Infrastructure & City Services (GDD §5.1) — *Opus scope*

The largest unimplemented GDD system. Province view exists but zoning/services/pollution are absent.

- **Zoning system** — R/C/I/O zones with 3 density levels unlocked by era + demand; buildings grow from demand signals: residential demand = jobs + amenity − rent pressure; commercial = purchasing power; industrial = input access + freight capacity; office = tertiary workforce (era-gated)
- **Land value propagation** — `landValueMap` per settlement (hex-resolution); propagates from amenity, transit access, coverage; depressed by pollution; sets rents, class sorting (who can afford to live where), property-tax yield, gentrification pressure
- **Pollution diffusion** — per-building emission → local diffusion → global CO₂ ledger (hooks into Phase 10); health impact, land value drag, mood drag
- **Utility system**:
  - Power: generation → distribution → `brownoutRisk` (cuts industrial output 30% + mood if demand > capacity)
  - Water/sewage: drives disease events if underfunded
  - Waste: land value drag + ground pollution if uncollected
- **Service coverage** — radius-based coverage per service building (clinics, schools, police, fire, parks); coverage maps feed health, crime, education, approval. Service buildings have era versions (1919 schoolhouse vs 2050 learning center with different throughput)
- **Test targets** — zoning demand signals, land value gradient math, brownout trigger, service coverage radius computation

### Phase 15 — Extended Economy & FX (GDD §5.2) — *Sonnet scope*

Economy is the centerpiece system; this phase extends it toward the GDD's full-scope design.

- **Expand goods from 18 → 44** — add intermediate tier: chemicals, components, electronics, pharmaceuticals, vehicles. Each has an input/output recipe and era unlock. Supply chain failures propagate (no chemicals → no pharmaceuticals → health crisis)
- **Physical goods movement on routes** — goods travel on the transport network with real transit time and cost; `congestionTariff` (distance + route condition = implicit tax on goods movement). Price arbitrage traders: if price differential between two settlements > transport cost, a trade flow spawns to equalize
- **FX and currency system** — exchange rate from trade balance + interest rate differential + confidence; `devalue()` action: boosts exports, raises import prices (inflation), diplomatic friction; `currencyPeg` option (fixed rate vs a reserve-currency rival — stability + loss of monetary independence)
- **Monetary regimes** — gold standard (discipline + deflation risk), fiat (flexibility + inflation risk), currency union with an ally (bloc benefit + loss of independent rate)
- **Test targets** — goods route transit time, price convergence via arbitrage, FX devaluation effect on trade balance and inflation

### Phase 16 — Warfare System Depth (GDD §7) — *Opus scope*

Provincial army movement exists (Phase 7). This phase replaces the simple power comparison with the GDD's full strategic warfare layer.

- **Casus belli system** — `CB` types: border dispute, treaty violation, protection of co-ideologues, resource denial, fabricated (`fabricationCost` in reputation). CB quality sets `warSupport` at declaration: defensive war starts 85, land grab starts 40
- **Three mobilization levels** — `mobilizationLevel`: Peacetime / Partial / Total; each unlocks a cost/benefit package constrained by regime type:
  - Partial: selective draft, 15% manufacturing → armaments
  - Total: mass conscription (workforce −10–25%), 40–60% conversion, rationing, war bonds
- **Army Groups on fronts** — replace unit-count armies with `ArmyGroup` objects: manpower, equipment level (from industry), supply state, doctrine (tech tree), morale. `Front` objects between hostile territory with weekly resolution: `combatPower = manpower^0.6 × equipment × supply × doctrine × morale`. Sub-linear manpower exponent means quality and logistics beat raw mass
- **Supply lines** — supply flows from industrial centers down rail/road/sea network to fronts; overextended fronts `supply ×0.5` and falling. Cutting supply (deep front moves, blockade, bombing in late eras) is a first-class strategy
- **Occupation** — occupied provinces: partial output, garrison cost, `resistanceLevel` accumulating scaled by ideology distance + occupation policy (conciliatory ↔ brutal). Brutality is cheaper now, costlier forever — postwar integration penalties
- **War support decay** — `warSupport` decays with casualties/population, rationing, defeats; rallies on victories + home-soil attacks. Low support → strikes, draft riots, coup risk — *how* it bites depends on regime type
- **Full peace terms** — peace priced in `warScore` (front positions, occupied territory, blockade effects): annex province (15–25 each), reparations (10/tranche), DMZ (15), puppet (45), status quo (0). Overreach creates Grudge-9 revanchist rival
- **Test targets** — mobilization cost formulas, front resolution ratio math, occupation resistance growth, war support decay curves

### Phase 17 ✓ (PR #256 — Historical Scenarios & Alternate Starts) — COMPLETED
- ✓ `RegionSim.fromEraStart('1950'|'2000')` with pre-built starting state
- ✓ 4 authored scenarios: The Long Peace, Iron Curtain, Digital Crossroads, Climate Emergency
- ✓ `SCENARIOS` constant with `Scenario`/`ScenarioGoal` interfaces; `checkScenarioGoals()` monthly
- ✓ `beginRegimeLocked()` / `isGovLocked()` for regime-lock challenge starts
- ✓ Difficulty knobs: crisisFrequency, aiAggression, historicalAnchors wired into sim ticks
- ✓ Scenario selection UI in title screen; 47 tests in `tests/phase17.test.ts`

### Phase 17 spec — Historical Scenarios & Alternate Starts (GDD §8.8, §6.1) — *Sonnet scope*

- **Era starts** — begin in 1950 with a pre-built state (skip colony/state phases, start with an existing nation), or in 2000 as an information-age economy. `RegionSim.fromEraStart(era, opts)` constructor with authored starting conditions per era
- **Historical scenario layer** — authored starting conditions with named nations, historical parallels, and scripted opening events. Scenarios reference real geographical/political templates without replicating copyrighted works. Each scenario has 1–3 authored "scenario goals" on top of the standard win conditions
- **Regime-locked challenge starts** — player chooses a government type at campaign start (junta, theocracy, etc.) and is locked to it for the first 30 years; generates unique opening constraints and story beats
- **Difficulty knobs in sandbox** — expose all tuning parameters: crisis frequency/severity, AI aggression, economic volatility, starting region harshness, historical-anchor toggles (fire on schedule vs emergent only)
- **Test targets** — era start serializes cleanly, scenario goals wire to existing win-condition infrastructure

### Phase 18 — Advisor System Depth (GDD §8.7) — *Sonnet scope* — IN PROGRESS (PR pending)

Cabinet portfolios exist (Phase 2 via PR #239). This phase gives advisors the forecast quality and personality depth the GDD describes.

- **Skill-based forecast accuracy** — each cabinet Notable has a `skill` 0–100 value; advisor-generated forecasts (debt service cliff, confidence break, unrest threshold) add Gaussian noise scaled to `1 − skill/100`. A bad advisor gives plausible but wrong projections
- **Ideology-biased advice** — hawkish War minister consistently underestimates occupation costs; loyalist Press Secretary downplays credibility gap; pro-labor Interior minister overstates strike risk. Bias is deterministic per advisor ideology axis, invisible to the player until they notice the pattern
- **Advisor briefs** — dedicated `advisorBriefs[]` queue: each portfolio auto-generates a brief when a key variable crosses a warning threshold (Treasury: "debt service passes 20% of revenue within 3 years on current path"; Interior: "lower-class housing satisfaction below 30 in 4 settlements"; Science: "rivals outpacing your tech in 2 of 3 military branches"). Briefs surface in the event log with portfolio attribution
- **Advisor loyalty & betrayal** — `loyalty` 0–100 per Notable; falls when player ignores their advice repeatedly or fires a colleague they like; at loyalty < 20 + trigger (major loss, scandal), advisor defects to opposition faction or leaks information (approval hit + credibility gap ↑)
- **Portfolio-specific events** — Foreign Secretary: "envoy refused audience" (relations deterioration warning); Science Minister: "research bottleneck — need secondary schools in 3 more settlements"; Press Secretary: "credibility gap accelerating — recommend addressing [specific cause]"
- **Test targets** — forecast noise variance by skill, loyalty decay formula, brief threshold triggers, betrayal event chain

## Completed in PR #226

- ✓ **Rivals national identity** (Issue #18) — 11 named rival nations (Vasterholm, Kalimera, Tyrennia, Karelia, Sundered Communes, Northern League, Highland Federation, Crescent Sultanate, Iron Republics, Forest Collective, Sunset Empire) with unique flags/emblems, archetype descriptions, personality-driven treaty behavior, power comparison indicators
- ✓ **Installer UI** — Brightened from dark green to vibrant blue gradient; cyan glowing title with pulsing animation; gold→cyan gradient progress bar
- ✓ **Package description** — Updated to reflect 4X civilization builder scope (1919–2100, colonial to nation scale)

## Model Capability Guidance

- **Haiku scope:** Unit tests, bug fixes, small feature additions (<500 LOC), content hooks (events/techs/civics)
- **Opus scope:** Major architecture (Phases 5–7 above), cross-file refactors, large simulation features, integration testing

## Next session — priority fixes

- **✓ Economy rebalanced (was HIGH PRIORITY, addressed 2026-06-22).** The runaway treasury is fixed by
  giving the state a **GDP-scaled public-sector wage bill** (Wagner's law) in `monthlyEconomy`:
  `publicSector = gdp × (0.025 + 0.04·svc + 0.025·mil) × (1 + devShare×0.15)` where
  `devShare = (modernizationIndex + informationIndex)/2`. At the defaults (tax 10%, funded
  services/militia) this lands ~9% of GDP — just under the 10% tax take — so the budget runs a slim
  surplus and the tax/service levers are real decisions again; svc2/mil2 (~15.5%) needs the income-tax
  civic and a higher rate. Headless trace: 2029 treasury fell **$568M → ~$40M** (≈0.5 months of GDP,
  was ~7 months and climbing); early/mid game now genuinely tight (a building is 1–30% of treasury
  through ~1950). The `devShare` lift is deliberately gentle — a steeper one (≥0.35) tips the
  information-era budget into a **deficit death-spiral** (services auto-cut → satisfaction → emigration);
  0.15 verified safe across seeds. Flat headline costs (scout, militia drill) now scale via
  `flatCost(base) = base × devFactor`; the vestigial flat policy bonuses (austerity, protectionism) are
  now GDP-scaled. Regression guard: `tests/economy-balance.test.ts` ("treasury within a few months of
  GDP across a century"). **Residual:** late-game (post-2000) buildings are still cheap *relative to*
  treasury (~0.04%) because base build costs are small and devFactor (gpc^0.7) lags GDP growth; the fix
  band there is more late-game megaprojects/sinks, not more income damping.

## Known weak areas

- **Tech tree DAG layout** — `techTreeLayout()` uses barycenter heuristic; doesn't minimize crossings
  optimally for large sparse trees. Acceptable for current tree size (~40 nodes).

*(All previously noted performance weak spots — `activePolicies` array `.includes()`, `sectorProductivity()` per-settlement recalculation, `avgWageOf()` per-settle reduce — were resolved in PR #240 via `activePolicySet`, `sectorProdCache`, and `wageCache` respectively.)*

## Design reference

`GDD.md` is the design document. `docs/specs/` holds the per-milestone specs. (The former
`PLAN.md` documented the retired TownCore/seamless-world track and has been removed.)
