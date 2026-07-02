# Handoff — Centuria Development Guide

> ⚠️ **STANDING RULE — UPDATE THE HANDOFF EVERY SESSION.** End every session by
> updating BOTH this file (`HANDOFF.md` — this top status block + the "Prioritized
> non-asset backlog") AND `.handoff.md` (the short per-session baton): record what
> shipped, gate results (tests/tsc/bench/determinism), any intentional re-baseline,
> gotchas/failed paths, and the next step. Make it the final commit **even when the
> feature already merged** — the handoff IS the deliverable for the next session.

**Last updated:** 2026-07-02 (session 19 — agenda-driven peace resistance + table-cost differentiation) · **Tests:** 1456 passing · **Version:** v1.6.0 · **Status:** Phases 1–18 complete; deep-expansion underway. **LATEST SESSION (session 19 — AGENDA-DRIVEN PEACE; 2 feature commits):** (1) AgendaKind enum + AGENDA_PEACE_RESISTANCE: new structured `AgendaKind` type and `ARCHETYPE_AGENDA` mapping let each rival archetype charge quantitatively more or less war-score per peace term. Hegemon resists giving up border provinces (+15); trading republic resists reparations (+15); crusader state resists regime change (+20); opportunist discounts both (−5). `peaceBasketAsk` adds the resistance per term; `peaceCounter` now sorts by effective (agenda-adjusted) score so rivals concede their least-valued terms first. UI peace-term buttons show per-archetype resistance notes. Pure `rivalAgendaKind()` derived from archetype — no new serialized state. Byte-identical (all hooks in player-query methods only). `tests/agenda-peace.test.ts` +23. (2) AGENDA_TABLE_COST: `{ isolation: +10, opportunism: −5 }` wired into `tableCost()` — hermit kingdoms cost more diplomatic capital to approach, opportunists are eager dealmakers. UI agenda tooltip surfaces "Difficult to approach" / "Eager dealmakers" note. `tests/agenda-peace.test.ts` +4 (27 total). Both commits byte-identical in headless. **PRIOR SESSION (session 18 — THE WAR CYCLE CLOSES; 2 feature commits):** (1) Rival revanchism: rivals who lost a war to the player now remember it and can re-declare using the 'revanchism' CB (highest war-support, 85) after `REVANCHISM_BUILDUP_YEARS=5` with hostile relations (<−40) and no pact; probability weighted by grudge+risk weights × archetype multiplier. Distinctive log: "marches for revenge — they have not forgiven their defeat." Byte-identical: `warScars` always empty in headless. `tests/revanchism.test.ts` +14. (2) Front peak → peace leverage: `peaceBasketAsk` now subtracts `floor(max(0, front.peak) × FRONT_PEAK_LEVERAGE_SCALE=0.15)` alongside the occupation discount. A breakthrough peak (80) shaves ~12 off the basket. Negative peaks yield zero leverage. UI tooltip shows full discount breakdown. `tests/peace-leverage.test.ts` +8. Both byte-identical in headless. **PRIOR SESSION (session 17 — THE WAR BECOMES LEGIBLE; 2 feature commits):** (1) `PlayerWar.front` was a write-only stub mirroring the noisy war score; now it's a lagging integrator (`advanceFront`, eases `FRONT_LAG`=0.35/mo toward the score) with a high-water `peak` and a derived `FrontPhase` (breakthrough/advancing/contested/falling_back/collapse) — the war reads as a moving line, not the last roll; it narrates posture changes to the event log and gets its own war-panel meter. (2) `warScars` recorded every war but was never shown; now `WarScar` carries the front's `frontPeak` and the diplomacy panel shows a per-rival `⚔ war record: 2W 1L · revanchism available` line. Both draw NO RNG and touch no RNG-gated branch → every autoplay/headless sweep (which never holds a `playerWar`) stays byte-identical; serialize-determinism byte-identical, bench worst 16.3ms, vite build green. New `tests/front-line.test.ts` (11). Full session-17 write-up in the `## Recent session (2026-07-02)` section below; session-16 (the Gilded Century) detail in `.handoff.md` (top entry). **PRIOR SESSION (session 16 — THE GILDED CENTURY; 5 commits):** full write-up in `.handoff.md` (top entry) — summary: a live `:root` design-token system (Civ VI direction: navy surfaces, gold gilding, parchment text) replaced the scattered light-indigo theme; the dead `.cv-app` token block was deleted (live classes ported); every panel family re-tokened; the wrapped-sentences problem killed at the root (fixed widths + break-word → `width:max-content` with caps + styled scroll, 56ch prose measure); unified controls (gilded primaries, brass sliders, `.stepper` +/− keys, `.meter` bars, engraved `.panel-title` nameplates); World Dynamism new-game toggles expose consumerDemand + rivalClimateResponse as SERIALIZED campaign options (persistence test intentionally flipped; headless env flags still override — default sweep byte-identical); new-mechanics UI: ARSENAL readout (war room + Economy→Supply), intel-gated rival ⚒ arms line, Economy→Wonders tab with 🚀 THE SPACE RACE; scenario list got real cards (its classes had never been styled); NEW scripts/shoot-ui.mjs Playwright harness = the repeatable visual gate (10 screenshots verified). Gates: tsc, 1393 tests, default sweep byte-identical to session-15 baseline, bench 6.9ms. Known UI follow-ons + gotchas (fake E/S/R hotkeys, RegionalFaction vs RivalNation id-space in drawRivalPanel, panel stacking) recorded in the baton.

**Prior session: PLACEMENT PREVIEW NOW COUNTS THE DISTRICT-ZONE LIFT (spatial accuracy).** `placementPreview(townId,cell,defId)` showed a building's terrain pulse + marginal district-ADJACENCY synergy but OMITTED the marginal district-ZONE lift: siting a same-sector building on a hex adjacent to a zoned district raises that district's `districtZoneBonus` (+`DISTRICT_ZONE_BONUS` 0.05/adjacent building, capped 3), yet the preview never told the player — so a hex beside your farming district read the SAME +N% as one far from it. Added a `zoneBonus` field to `PlacementPreview`, computed as the marginal `districtZoneBonusFrom` delta (recompute the zone bonus with the candidate building hypothetically added, minus current → exactly the lift it gives the district, cap-aware), and folded it into `total`. **Refactored `districtZoneBonus` → a pure `districtZoneBonusFrom(districts,buildings,sector)` core** shared by the live path and the preview (the proven `districtBonusByCells` single-source-of-truth pattern); the empty-`placedDistricts` early-return guard stays in `districtZoneBonus` → **live tick byte-identical** (autoplay never zones → identical early-return; determinism harness green, headless finite/stable). Preview is pure/read-only → byte-identical. The placement overlay's `+N%` label/tint reads `pv.total`, so a hex beside a district now correctly shows the higher value (render-only, no UI code change). `districtPlacementPreview` returns `zoneBonus:0` (a district never triggers another district's zone). New tests in `tests/placement-preview.test.ts` (now 18, +5; existing "total" assertion updated to +zoneBonus). Gates: tsc clean, vite build green, **1103 tests** (1098+5), serialize-determinism green, headless 3-seed×60y finite/stable (infl 2.0%). **⚠️ STRUCTURAL WEAK AREA flagged in `.handoff.md`:** every spatial feature shipped over the last ~8 sessions is player-only/dormant in autoplay, so the headless balance suite tests a different game than a human plays; the gap widens each session and closing it needs AI spatial play (re-baseline) or a human playtest — weigh this before adding *another* dormant feature. **NEXT:** (a) wire district zoning into rival/AI build logic IF a re-baseline is wanted (deliberately player-only now); (b) economy track — **44-good catalog** (current is the 16-good MVP-18 tier; re-baseline-risk, own session); still wants a **human downturn playtest** (goods coupling still DORMANT in autoplay, `localGoodsScarcity`==0). PRIOR session below.

**Prior session: PER-SECTOR OUTPUT-BONUS BREAKDOWN (spatial legibility — the "why").** The spatial economy is now rich (worked-ring terrain yield + terrain-match pulse + district-clustering synergy + placed-district zone + empire Wonders) but was **OPAQUE after placement** — `placementPreview` told you the bonus *before* you build, nothing told you *why* a town produces what it does *now*. Added `SectorBonusBreakdown` + public read-only `sectorBonusBreakdown(townId, sector)` (`region.ts`): decomposes the sector's output bonus into named sources `{ buildings, terrain, terrainMatch, districtAdjacency, districtZone, wonder, total }`. **Refactored `buildingBonus` into a `sectorBonusParts` single source of truth** — `buildingBonus` now literally `return …sectorBonusParts(t,sector).total`, with the summation order preserved EXACTLY, so the displayed numbers can never drift from the ones that actually drive output and the refactor is **bit-for-bit identical** (proven: 4-seed×181y headless diff matches HEAD verbatim, and a test asserts `breakdown.total === buildingBonus(t,s)` with `toBe`, not `toBeCloseTo`). **Pure/read-only → byte-identical** (the breakdown only reads the same idempotent tile-yield/district caches the tick does; `serialize()` unchanged before/after). UI (`regionview.ts`, render-only): each Economy-tab sector row gains a `+N%` spatial-bonus badge (shown only when >0) with a `title` tooltip listing the contributing sources in plain language (`spatialBonusTooltip`). New `tests/sector-breakdown.test.ts` (8: total==buildingBonus exactly per seed×sector, total==sum-of-parts, each part==its live private method, building/zone attribution, null-for-unknown-town, purity/serialize-unchanged, round-trip). Gates: tsc clean, vite build green, **1098 tests** (1090+8), serialize-determinism green, save-size green (no new serialized field), headless 4-seed×181y **byte-identical to HEAD**. **NEXT:** (a) wire district zoning into rival/AI build logic IF a re-baseline is wanted (deliberately player-only now); (b) economy track — **44-good catalog** (current is the 16-good MVP-18 tier; re-baseline-risk, own session); still wants a **human downturn playtest** (goods coupling still DORMANT in autoplay, `localGoodsScarcity`==0). PRIOR session below.

**Prior session: DISTRICTS AS A PLACEMENT CATEGORY (the remaining big spatial rock).** Phase D slice 2 gave *emergent* districts (same-sector buildings on adjacent hexes earn an adjacency synergy); this session makes a **DISTRICT its own placed entity** — a themed zone (`DistrictDef`, loaded from a new `"districts"` array in `region_buildings.json`: Farming/Industrial/Commercial/Research, one per sector, `max` 1/city, prereq-gated where apt). New private `districtZoneBonus(t,sector)` wired into `buildingBonus` at the same seam as the Phase C/D bonuses: each hosted district grants its sector a **flat `def.bonus` +5% PLUS `DISTRICT_ZONE_BONUS` 0.05 per same-sector building on an adjacent hex, capped at `DISTRICT_ZONE_CAP` 3** (the reward is to zone amid your matching cluster). **Player-only & additive → BYTE-IDENTICAL in autoplay** (the AI never zones; the method early-returns 0 when `placedDistricts` is empty → zero hot-path cost; headless 4-seed×181y matches HEAD exactly — the proven Wonders-slice-1 pattern). Districts live in a **separate `Settlement.placedDistricts` array** (building-bonus loops never pull one in), occupy their hex (`canPlaceBuildingAt` now also excludes district cells — empty-array no-op in headless), pay upkeep (player-only), and take effect **on placement** (instant zoning; minimal serialized footprint — one `placedDistricts: []` per settlement, round-trip lossless + serialize fixed-point verified). Public API: `placeDistrict`/`districtBuildCheck`/`districtCost`/`districtPlacementPreview` (pure). UI (`regionview.ts`/`style.css`, render-only): a **DISTRICTS** city-panel section arms placement (`.armed` button); legal hexes tint by themed sector with a `+N%` preview label; placed zones draw as a translucent themed hex under the building icons. New `tests/district-zones.test.ts` (16). Gates: tsc clean, vite build green, **1090 tests** (1074+16), serialize-determinism green, save-size green, headless 4-seed×181y **byte-identical to HEAD**, ⚠️ bench-region worst-tick UNRELIABLE in this web container as always (zone bonus never runs in autoplay `tick()`). **NEXT:** (a) wire district zoning into rival/AI build logic IF a re-baseline is wanted (deliberately player-only now); (b) economy track — **44-good catalog** (current is the 16-good MVP-18 tier; re-baseline-risk, own session); still wants a **human downturn playtest** (goods coupling still DORMANT in autoplay, `localGoodsScarcity`==0).

**Prior session: PLACEMENT-TIME SITE PREVIEW.** Phase D buildings earn terrain-match + district-synergy bonuses, but the player placed them blind (flat amber legal-cell highlight). Added public `placementPreview(townId, cell, defId): PlacementPreview | null` (`region.ts`) — for a candidate cell it returns the `terrainBonus` (mirrors `placedBuildingTerrainBonus`: agri on fertile/river, industry on ore/rough, services on river/coastal; an `'all'` building sums every matching rule) plus the **MARGINAL** `districtBonus` (the town's district synergy recomputed WITH the candidate hypothetically added, minus current — so it captures the lift to same-sector neighbours, not just what the new building earns) and their `total`. **Pure/read-only**: it clones the cells-by-sector map before adding the candidate, never touches `_districtCache`, mutates nothing → sim byte-identical. The inner district sum was extracted into two private helpers (`districtCellsBySector` + `districtBonusByCells`) that `districtAdjacencyBonus` routes through **verbatim** (same iteration/summation order → bit-identical, proven by the headless diff + the existing 9 `districts.test.ts`). UI (`drawBuildingPlacementOverlay`, render-only): each legal hex is tinted green ∝ `total` and labelled `+N%` over the base amber/gold, so the best site reads at a glance. New `tests/placement-preview.test.ts` (13). Gates: tsc clean, **1074 tests** (1061+13), serialize-determinism green, save-size green (no new serialized field), headless 4-seed×181y **byte-identical to HEAD**, ⚠️ bench-region worst-tick UNRELIABLE in this web container as always (mean tick 0.0107ms unchanged; `placementPreview` runs only on UI render, never in `tick()`). **NEXT:** (a) deepen spatial — **district as its own placement category** (themed multi-building zones) is the remaining big spatial rock; (b) economy track (44-good catalog — current is the 16-good MVP-18 tier); still wants a **human downturn playtest** (goods coupling still DORMANT in autoplay, `localGoodsScarcity`==0).

**Prior session: DEMAND-AWARE GLOBAL GOODS SHIPPING.** The price-arbitrage matcher (`tickPriceArbitrage`, `systems/arbitrage.ts`) priced each good per town (PR-3 slice 3) but dispatched shipments by walking each town PAIR in isolation, shipping only that pair's single biggest local gap — so a scarce surplus was split by settlement-array order and a lane carried at most one good. Replaced step-2 dispatch with a **global, demand-aware** matcher: gather EVERY profitable (good, cheap source → dear market) opportunity across the whole network, sort largest-price-gap-first (deterministic tie-break: good id → source id → market id), then dispatch greedily with a running `shipGoodFrom` debit + a per-directed-lane "one in-flight shipment" busy set. The most acute shortage **anywhere** now pulls from its cheapest reachable supplier first (a limited surplus reaches the NEEDIEST town, not the earliest-indexed), and a pair can carry a **different good in each direction**. **Step 2 consumes no RNG** (only the step-1 delivery/strand logs do — unchanged), so the global ordering cannot perturb the RNG stream. **BYTE-IDENTICAL in balanced play** — proven by a 4-seed×181y headless diff that matches HEAD exactly (treasury/GDP/pop/inflation); empirically autoplay opens NO price gaps (towns specialise via Phase C/D terrain yields yet stay self-sufficient → `localGoodsScarcity`==0, zero trade flows ever dispatch), so this is a zero-re-baseline correctness upgrade just like slice 3 — it only changes WHICH lanes ship under a genuine shortage. Gates: tsc clean, **1061 tests** (1055+6 in `tests/arbitrage-global.test.ts`), serialize-determinism green, save-size green, headless byte-identical, ⚠️ bench-region worst-tick UNRELIABLE in this web container as before (mean tick 0.003–0.013ms unchanged; the spike is GC jitter the unmodified baseline also shows). **NEXT:** (a) deepen spatial (district as its own placement category / placement-time bonus preview); (b) economy track (44-good catalog — current is the 16-good MVP-18 tier); still wants a **human downturn playtest**. ⚠️ The goods coupling is **DORMANT in autoplay** (scarcity always 0) — the follow-up that makes all this machinery actually BITE is a deliberate specialisation/balance change (re-baseline), deferred until after a human playtest by design.

**Prior session: WAGNER-STYLE RIVAL TREASURY SINK.** Rivals ran the player's real economy (6% tax on town output) but lacked a recurring spending sink, so they banked nearly the whole take and ballooned to ~2 months of (enormous) late-game output (~1.25–1.8M gold @2100). Added `rivalStateCost()` (private, `region.ts`), debited each `updateFactionAI` after the tax credit. **KEY FINDING — the rival treasury is the FAMINE SHOCK-ABSORBER** (emergency grain is paid from the faction purse; late-game climate warming → widespread starvation): a first design that charged a flat development-ramped share of output UNCONDITIONALLY drained the purse to 0 during the famine and **collapsed the rival population** (seed 1: 171805 → 334 pop @2100). The shipped design is a **reserve-skim** — spend down only the SURPLUS above a prudent reserve that scales with output (`RIVAL_RESERVE_MONTHS` 1.5 × output) at `RIVAL_SURPLUS_SKIM` 0.25/mo + flat `RIVAL_ADMIN_PER_TOWN` 5, and **stand down entirely when treasury < reserve** so the famine buffer is never touched. Result (4-seed×181y probe): no collapse, rivals stay strong peers (100k–171k pop, 20–24 towns), the hoard caps at ~1.0–1.4 months of output (max ~540–615k @2100, ≈halved). **Intentional re-baseline** (the rival trajectory is chaotic w.r.t. treasury — the surplus partly funded expansion, so rivals are modestly leaner in territory too; every tuning lands differently but uniformly healthy — "strong peers", not an exact pop number). Gates: tsc clean, **1055 tests** (1046+9 in `tests/rival-state-cost.test.ts`), serialize-determinism green, save-size green, headless 8-seed×181y stable (player markers finite, inflation 2.0%), vite build green. ⚠️ bench-region worst-tick is UNRELIABLE in this web container — the unmodified baseline also "fails" (3-town early-colony stage spikes to 16.7ms with a 0.004ms mean; pure GC jitter), and the change is only a handful of float ops per faction. **NEXT:** (a) deepen spatial (district as its own placement category / placement-time bonus preview); (b) economy track (44-good catalog, demand-aware global shipping); still wants a **human downturn playtest**.

**Prior session: SPATIAL PHASE D slice 2 — DISTRICTS.** Placed buildings of the same sector on **adjacent hexes** now form a **district** and earn a clustering synergy bonus (the Civ-6 district hook): each building earns `DISTRICT_ADJ_BONUS` (0.04) per same-sector neighbour, capped at `DISTRICT_ADJ_CAP` (2) per building, so a tight cluster pays the most while the total stays **bounded and legible**. Mixed-sector / `'all'` buildings never form a district. `districtAdjacencyBonus(t, sector)` (in `region.ts`) feeds `buildingBonus` at the **same seam as the Phase C terrain yields** (`tileYieldFor` + `placedBuildingTerrainBonus` + `wonderBonus`); cached per settlement keyed by **placement count** (placements only ever grow → key is sound, no explicit invalidation); transient `_districtCache` is **NOT serialized** (rebuilt lazily, terrain+cells static). Render: a faint sector-coloured **connector glow** between adjacent same-sector buildings in `drawPlacedBuildings` so a district reads at a glance (render-only, no sim impact). New `tests/districts.test.ts` (9: adjacency rule, per-building cap, same-sector-only, non-adjacent earns nothing, cache invalidation on count change, determinism, `_districtCache` not in save, clustered>scattered output integration). **Intentional re-baseline** (autoplay auto-sites buildings into nearest cells → they cluster → the bonus fires; this is precedented by Phase C). Gates: tsc clean, **1046 tests** (1037+9), serialize-determinism green, **save-size green**, **bench-region PASS (worst tick 13.8ms < 16.7ms)**, headless 8-seed×181y stable (finite/bounded, inflation 2.0%), vite build green. **NEXT:** Phase D is effectively feature-complete (Wonders + rival build-race + districts); options are (a) deepen the spatial layer — a **district as its own placement category** (themed multi-building zones) or a **placement-time district-bonus preview in the UI**; (b) the **economy track** — 44-good catalog, demand-aware (global) shipping; or (c) the **Wagner-style rival treasury sink** (rivals balloon to ~1.4M late-game — benign, tech-capped, but a clean follow-up). Still wants a **human downturn playtest** now that towns specialise (Phase C) + districts amplify it + rivals are real economic actors.

**Prior session (PR #304, MERGED): RIVALS NOW RUN THE PLAYER'S REAL ECONOMY + SPATIAL PHASE D slice 1b — RIVAL WONDER BUILD-RACE.** Rivals were perma-weak (≈1 town, ≈100 gold, no advancement) because their treasury ran on a near-zero abstract formula (`pop·0.002·techProgress` ≈ 0 — a vicious cycle) and their towns were denied the resilience player towns get. Fixes (intentional re-baseline): (1) **rival treasury now collects tax (`RIVAL_TAX_RATE` 0.06) from the REAL sector output of its own towns** each `updateFactionAI` — the keystone; rivals become economic peers of the player (treasury 120k–180k vs player 141k @2000; 12 towns, 100k+ pop by century-end); (2) **era-based natural growth (births/deaths/baby-boom) applies to EVERY town**, not just the player's; (3) **emergency grain is drawn from the OWNING faction's purse** (player treasury or a rival faction's) so a solvent rival feeds its people; (4) **`techProgress` capped (`RIVAL_TECH_CAP` 30)** — it feeds `militaryStrength`, and on a real treasury the uncapped float ran to ~4500 → a 200×+ army; the cap keeps rivals strong but pop-bounded. **Wonder build-race:** a rich, era-ready rival breaks ground on an unclaimed Wonder via the player's own construction pipeline (`maybeBuildRivalWonder`, aiRng-gated); `wonderClaimed(id)` = first-to-break-ground exclusion enforced for both rivals and the player (`cityBuildCheck`); era gate via the prereq tech's era-year (`wonderEraYear`, since rivals have no researched-node set). **3 latent save/load determinism bugs fixed** (surfaced once rivals are active): runtime routes now set `cargoPriority: null` (matching deserialize); `contactedFactionIds` is serialized (was re-firing FIRST CONTACT on reload → log/event desync with synced rng); a goal's `successCondition` (a function JSON drops) is **re-attached on load** from an id→condition registry probed across faction/era profiles; lazily-created `goodStocks`/`lastEmergencyGrainDay` are **pinned to a fixed key position** in deserialize so the canonical round-trip is byte-stable. **Perf:** the corridor A* heap swaps use a temp var instead of array destructuring (**14.8ms → 7.9ms per solve, result-identical** — this was the worst-tick cause once rivals founded towns) + `routePath` BFS memoized per tick (cleared at tick start, on route mutation, and at the direct test entry points). Gates: tsc clean, **1037 tests** (new `tests/wonder-race.test.ts`; phase-8 notable-death test made phase-robust — it was a ~36% coin-flip keyed to the shared rng phase), serialize-determinism green, **bench-region PASS (worst tick 15.5ms < 16.7ms)**, vite build green. **NEXT (rivals):** they lack the player's nation-tier spending sinks (policies/services/welfare), so late-game treasury balloons (~1.3M @2081) — benign now (tech capped → military pop-bounded), but a **Wagner-style rival state-cost sink** is the clean follow-up; and **wants a human downturn playtest** now that rivals are real economic actors (depression ~1929, a war). Then Phase D **slice 2 — districts**.

**Prior session (PR #303, merged): (1) BLOAT CLEANUP + (2) SPATIAL PHASE D slice 1 — WONDERS.** Cleanup: deleted the dead `src/sim/economy.ts` (an abandoned tiered-economy module — `BASE_PRICES`/`EconomyData`/factory fns, zero refs; the live `Lender`/`Loan` interfaces moved to `lenders.ts`), 8 unused `lenders.ts` exports, the unused `public/` "Claude Design system" scaffold (`_ds_bundle.js`, `public/components/`, `public/assets/sprite-*.js`, `tokens/`, `styles.css` — loaded by index.html but never referenced by `src/`; kept the live asset/audio manifest seams + `public/sprites/*`), and `tools/sprite-preview.mjs`; pruned 4 tautological/duplicative tests; and instead of deleting the write-only `GovTypeDef.maxYear`, **wired it into `proclaimNation`** (removing a hardcoded `1955`). −3686/+35 lines, byte-identical. **Wonders (Phase D slice 1):** one-per-EMPIRE buildings — `RegionalBuildingDef.{unique,empireBonus,empireSector,prestige}`, `wonderBonus(t,sector)` added to the `buildingBonus` seam (routed through `empireBonus`, local `bonus:0`), new serialized `wonderOwner`+`prestige`, empire-uniqueness in `cityBuildCheck`, ownership+prestige on completion, Century-Report telemetry, gold placement highlight, 5-wonder roster, 14 tests. **Byte-identical to base in autoplay** (no AI wonder building yet — **slice 1b rival build-race DONE this session, PR #304**; **slice 2 — districts** is next). **Prior session: Spatial Phase C — PER-HEX TERRAIN YIELDS + BUILDING ADJACENCY BONUSES.** Towns now specialise (grassland → agri-dominant, mountains → industry-dominant), which ACTIVATES the PR-3 slice-3 macro coupling (`localGoodsScarcity`). `tileYieldFor(t)` iterates the worked ring and caches agri/industry/services bonuses per settlement (transient, not serialized); `placedBuildingTerrainBonus(t, sector)` adds +5% when a placed building sited on matching terrain. Both feed into `buildingBonus` → `updateSectors`. 17 new tests in `tests/terrain-yields.test.ts`. Intentional re-baseline (markers shift from slice-3 base). **Prior session: PR-3 slice 3 — PER-GOOD LOCAL PRICES + the goods→economy MACRO COUPLING.** The full machinery landed: each tracked good is priced PER TOWN from local stock vs. demand (`localGoodPrice` in `systems/goods.ts`); arbitrage drops the wage-gap proxy and now ships the largest-price-gap good from the cheap (abundant) town to the dear (short) one (a deprived town pulls what it needs); and a nation-wide `localGoodsScarcity` index ∈ [0,1] — cached each month from the per-town production GATES — feeds cost-push inflation (`× LOCAL_GOODS_INFLATION` 0.08) + an industry-output drag (`× (1 − scarcity·LOCAL_GOODS_OUTPUT_DRAG)` 0.10). **⚠️ KEY FINDING (corrects the prior baton's "markers WILL move"):** the coupling is **INERT in today's balanced play — headless markers are BYTE-IDENTICAL to base** — because the index is gate-driven and real autoplay towns are MIXED (self-sufficient → every gate 1 → index 0 in all 8 seeds × 181y). It bites only under SPECIALISATION (forced fixtures prove index ≈ 0.14, textiles 2.0 in the industry town vs 1.0 in the agri town → ship textiles in). So slice 3 ships the substrate with ZERO balance risk today; **the spatial Phase C (terrain yields → specialised towns) is the natural activator.** Gate-driven (not stock-magnitude) so it never double-counts the raw cascade and stays 0 for a self-sufficient town even during a raw shock (the single-town oil-embargo cost-push tests pass unchanged). New serialized field `localGoodsScarcity` (backfill 0). 1003 tests (15 new in `tests/goods-prices.test.ts`; 4 wage-based arbitrage tests reworked), tsc/build/determinism/bench(13.8ms)/save-size all green. **Prior session: PR-3 slice 2 — the PER-TOWN SUPPLY SOLVE.** `tickIntermediateGoods` (in `src/sim/systems/goods.ts`) still resolves the nation-wide cascade ONCE for every macro signal (`supplyChainHealth`, severity, the output drag, the pharma/electronics RNG effects — byte-identical), but the **stock ledger is now resolved per town** (`distributeGoodProduction`): a town makes its sector-weighted share of `baseOutput·level` only to the extent it locally holds that good's INTERMEDIATE inputs (Liebig gate `min(1, have/need)`), consuming them from its OWN `goodStocks`; raws stay folded into `level` and never gate. A single-town nation (and any nation whose goods are co-located with their inputs) is **byte-identical** — every gate is 1, and the catalog is topological so a town's own upstream output this tick is in stock before downstream reads it (both invariants now guarded by tests). A **cross-sector** good in a **multi-town** nation diverges by design (`clothing`/`consumer_goods`/`luxury_goods` are industry-attributed yet need agri `textiles`: a pure-industry town makes none until textiles are shipped in). **Macro-neutral TODAY** — nothing reads good-stock *magnitudes* into GDP/inflation yet, so the headless 8-seed×181y **markers are byte-identical to base**; the divergence is confined to the per-town ledger (the substrate the per-good-prices slice will consume). 988 tests (8 new in `tests/goods-local.test.ts`), tsc/build/determinism-harness/bench(11.8ms)/save-size(83.5KiB) all green; a 4-lens adversarial review returned no blockers/majors. Seam: `goodProducingSector` exported, `capitalSettlement()` made public. **Prior session: C1 extraction — the intermediate-goods subsystem (`tickIntermediateGoods`) lifted out of the 14k-line `region.ts` into `src/sim/systems/goods.ts`** (the FOURTH Track-C leaf after `systems/pollution.ts` + `systems/services.ts` + `systems/arbitrage.ts`, and the method **PR-3 slice 2 will rewrite** — the dependency-rule-mandated step *before* that balance change, and the prior baton's named next task. Free function `fn(r: RegionSim)`; `tick()` dispatches via `tickIntermediateGoods(this)` in the same tick slot. Body moved **verbatim** (`this.`→`r.`), preserving the pharma/electronics RNG draw order; seam: `advanceSectorOutputNorms`/`rawSupplyLevel`/`_electronicsDisrupted`/`supplyShockMult` made public, `sectorRawLevel` stays private. **Byte-identical** — determinism harness ✅, 8-seed × 181y headless **byte-for-byte identical** to base (matching sha256), 980 tests / tsc / build / bench-region all green; a 3-lens adversarial review returned SHIP / zero defects). **Prior session: C1 extraction — the trade-arbitrage subsystem (`tickPriceArbitrage` + `computeCongestionTariff`) → `src/sim/systems/arbitrage.ts`** (the third Track-C leaf; first extracted subsystem that consumes RNG + mutates the per-town ledger; `addGoodStock`/`shipGoodFrom` made public; byte-identical). **Earlier: PR-3 slice 1 — "goods ride the rails"** (trade-route shipments now carry **real physical `cargo`**: units of the shipped good are debited from the source town's `goodStocks` on dispatch and credited to the destination's on arrival — a severed route now strands the **real units**, where before only abstract arbitrage profit moved and the flow's goodId/volume were decorative. The dispatch logic / `pendingIncome` are untouched and nothing reads intermediate-stock *magnitudes* into the economy, so it's **macro-neutral — proven by a byte-for-byte-identical 8-seed × 181y headless diff**. It's the substrate the *per-town supply solve* — PR-3 slice 2, the actual balance change — will consume). **Then: #294 merged — the per-settlement-stocks STORAGE SWAP (PR-2)** (the goods ledger moved onto **`Settlement.goodStocks`** per town; `produceGood` splits the tick's output by producing-sector, `drawGood` drains greedily in-order, both preserving the nation-wide aggregate exactly → **byte-identical gameplay**; built on **#292 — the per-settlement-stocks FOUNDATION** ledger seam). **Earlier: 8 PRs (#283–#286, #288)** — cost-push inflation; non-asset depth pass (export-drag trade leg + serialize-determinism harness & 3 bug fixes + first C1 extraction + perf-guard re-baseline); C1 services extraction + situation-aware deals; AI difficulty belligerence + intel-gated agenda; **#288 = Tier-2 climate farm drag (A) + Tier-3 goods-on-routes first slice (B).**

> **PARALLEL TRACK — SPATIAL 4X redesign** (`docs/design/spatial-4x-redesign.md`): a second session is turning Centuria into a Civ/Age-of-Wonders spatial city game (found towns by clicking, place buildings on hexes) **while keeping the 4X clear**. **Phase A (click-to-found) MERGED #289**; **Phase B (place buildings on hexes) MERGED #291**; **Phase C (tile yields + building adjacency → economy) MERGED #301** (intentional re-baseline; 17 new tests; now activates PR-3 slice 3's dormant coupling). **Phase D slice 1 (Wonders) MERGED #303**; **slice 1b (rival Wonder build-race, on the back of rivals-run-the-real-economy) MERGED #304**. Next: Phase D **slice 2 — districts**. See `.handoff.md` §0. Lesson learned: AI text-to-image is the wrong tool for crisp foreground sprites — procedural rendering + the spatial layer is the win.

> 🌾⚠️ **#288 — two intentional BALANCE changes (user picked A+B), UNVERIFIED-BY-HUMAN (unit + headless only):**
> **A — agriculture climate drag:** warming past +1.5°C trims the agriculture *sector's*
> GDP (`agriClimateMult`, ≤30%, distinct from the older +0.8°C subsistence-food drag).
> Non-divergent (≤14% of the ag sector at the observed ~3.8°C; warming is a pure sink).
> Dials: `AGRI_CLIMATE_THRESHOLD`/`_SLOPE`/`_MAX_DRAG`. **WANTS a late-game playtest.**
> **B — physical goods on routes (first slice):** trade flows now *deliver* — arbitrage
> profit (`pendingIncome`, serialized) pays out on ARRIVAL after `transitDays` of travel,
> a severed route strands the cargo, and a long-standing inverted buy/sell direction bug
> is fixed. Macro-neutral (arbitrage is minor; headless unchanged). **Follow-on:** per-good
> prices (still a wage-gap proxy) and per-settlement goods stocks — the big rock. **#292
> laid its foundation (the ledger seam) and #294 DID THE SWAP:** the ledger now lives on
> `Settlement.goodStocks` per town; the nation-wide totals the chain reads are the sum across
> towns, so gameplay is still byte-identical. **✅ PR-3 slice 2 then made the ledger diverge** —
> each town consumes/produces against its OWN stock (`distributeGoodProduction`), so a cross-sector
> good underproduces in a town lacking its input — but it stays **macro-neutral** (nothing reads
> stock magnitudes yet, markers byte-identical to base). The deliberate macro balance change is
> **slice 3 — per-good local prices**, where local stock finally feeds inflation/output.

> 🟢 **PR #284 (open, this session) — non-asset depth pass, 4 commits:**
> 1. **D1-econ trade leg** — a supply shock now chokes *exports*
>    (`exportEarningsLastMonth ×= 1 − severity·SUPPLY_SHOCK_EXPORT_DRAG`, 0.5). With
>    the merged GDP drag + cost-push, all three legs (GDP, prices, trade) are wired.
>    Byte-identical (severity 0 in healthy play).
> 2. **Determinism + save-fidelity hardening (Track C guard).** A new full-state
>    `serialize()` determinism harness (`tests/serialize-determinism.test.ts`) caught
>    three latent defects, all fixed: (a) **5 `Math.random()` calls** made saves
>    non-reproducible for a fixed seed — notable health decay + loan ids now use a new
>    serialized **`auxRng`** (mirrors `aiRng`; main+AI streams stay byte-identical);
>    (b) the one-month-lagged `supplyShockMult`/`_electronicsDisrupted` caches weren't
>    serialized → a mid-shock reload dropped the drag, now persisted; (c) Phase-14
>    city-service fields + notable defaults weren't round-trip-symmetric → a shared
>    `cityServiceFields()` helper + spread-first notable backfill make a save lossless.
> 3. **First C1 extraction** — `tickPollution` → `src/sim/systems/pollution.ts` as a
>    free function `fn(r: RegionSim)` (the roadmap pattern; preserves RNG order),
>    proven byte-identical by the harness. Establishes the `systems/` dir + convention.
> 4. **Track D perf guard** — `bench-region` re-baselined off the obsolete "mean×64"
>    model to the real wall-clock catch-up budget; hard gate is now the worst single
>    tick (> 16.7 ms = stutter; currently ~10.6 ms, passes).
>
> **The determinism harness is the key unlock:** every future `region.ts` extraction
> and every "byte-identical" claim now has a real PASS/FAIL gate, not a hand-wave.

> ⚠️ **Untested-by-human balance change live on `main`:** PR #280's *Phase-2 graded
> extraction proxy* (an ordinary contraction now drags industry via the chain) is
> validated only by unit tests + an 8-seed×181y headless macro-stability sweep — it
> has **not** been eyeballed in-game. Worth a playtest during a downturn (depression
> ~1929, a war) before building more economy on top of it. Dials live in `region.ts`:
> `RAW_SHORTAGE_DEADBAND` 0.9 / `RAW_SHORTAGE_FLOOR` 0.5 / `RAW_SHORTAGE_MIN_LEVEL`
> 0.35 / `SECTOR_NORM_ALPHA` 0.02, all bounded by `SUPPLY_SHOCK_MAX_DRAG` 0.15.

> 🎨 **Visual/audio assets — the "1 GB" that makes the game *much larger* — are NOT in.**
> The repo still ships **zero binary assets**: all art is procedural Canvas 2D, all
> audio procedural WebAudio (`find` for png/jpg/ogg/flac/… returns nothing). Manifests
> exist (`public/assets/asset_manifest.json`, `public/audio/audio_manifest.json`) and
> the `AssetRegistry` override seam + `hf-sprites.ts` dry-run are wired, but generation
> has never run here — `HF_TOKEN` unset, no `sharp`/`ffmpeg`, `huggingface.co` 403s in
> this web env. The generated `.png`/`.ogg` are `.gitignore`'d by design (hybrid
> distribution = GitHub Release packs, not git). Pipeline files the roadmap still wants
> — `scripts/hf-audio.ts`, `scripts/gen/post.ts`, `src/data/*_manifest.json`, the
> audio/music registries — **don't exist yet**. The literal-gigabyte phases `B1-art`
> (parallax backdrops + era UI skins) and `B2-audio` (music stems + ambience + voice)
> are the bold roadmap items and remain **un-started in earnest** — they need an env
> with network egress + image/audio tooling to actually generate.

## Recent session (2026-07-02) — the front line becomes real (D2-mil `front` scaffold activated)

**Activated the one genuinely-inert D2-mil scaffold, then gave the recorded-but-hidden war history a home.** Two coherent "the war becomes legible" increments (2 commits).

**Activated the one genuinely-inert D2-mil scaffold.** `PlayerWar.front` was a write-only stub — `w.front = { position: w.score }` mirrored the noisy monthly war score and nothing read it (the d2-mil scaffold test even skipped it: `foundColony` spawns 0 rivals, so its inject-war path never fired). Now the front is a **lagging integrator** of the war score, so the line reads as a coherent moving front rather than the last roll.

**Increment 1 — the front line (commit 1):**
- `region.ts`: `FrontPhase` type (breakthrough/advancing/contested/falling_back/collapse); `FRONT_LAG = 0.35`; pure `frontPhase(pos)` classifier; `FRONT_PHASE_LABEL` (UI meter tone + log tone + narration line); pure **`advanceFront(prev, score)`** = the integrator (ease `position` toward `score` by `FRONT_LAG`, carry the high-water `peak`, derive `phase`). `PlayerWar.front` widened to `{ position; peak; phase }`.
- `systems/military.ts` (`tickPlayerWar`): the front write now calls `advanceFront(w.front, w.score)` and **narrates a posture change** to the event log (only on transition, `{0}`→rival name). No new RNG draw — the integrator is pure arithmetic on the already-updated `w.score`.
- `ui/regionview.ts`: the war panel gains a **`front` meter row** (position → 0..100 bar, tone by phase, label = posture, tooltip shows the deepest advance) beside the raw war-score row.
- Stale-comment cleanup: removed the "all 1.0 now (no-op scaffold)" doc above `WAR_SUPPORT_DECAY_MULT` (it was tuned live long ago: 0.55 fascist … 1.5 direct_democracy, already plugged into `tickWarSupport`).

**Increment 2 — the war record (commit 2).** `warScars` records every war (rival, outcome, casualties, duration) and drives revanchism (region.ts:10596/10893) + a regime event (regime.ts:85), but the player **never saw it** — no UI anywhere. Now: `WarScar` gains an optional `frontPeak` (the front's high-water mark, set in `recordWarScar` + the military.ts status_quo push), and the **diplomacy panel** shows a per-rival `⚔ war record: 2W 1L · revanchism available` line (regionview.ts, in the RivalNation block beside the war verb — `rv` is a real RivalNation so `rv.id` matches `warScars.rivalId`, sidestepping the RegionalFaction id-space trap). Fully **additive**: `frontPeak` is optional (old-save backfill), the UI reads the already-public `warScars` (no getter), and nothing in the tick path changed → byte-identical in every sweep. `+1 test` (status_quo end path records a numeric `frontPeak`).

**Why it's safe / determinism.** Both increments run only inside `tickPlayerWar` / at war-end / in read-only UI, gated on a `playerWar` that **no autoplay/headless sweep ever holds** → every balance/long-run/determinism run is byte-identical. The change draws no RNG and touches no RNG-gated branch, so draw ORDER is untouched (the trap that would have broken determinism — gating an existing `rng.chance()` on a new condition — was deliberately avoided; the score/occupation/peace logic is untouched). `playerWar` serializes wholesale → `front` persists automatically; pre-front saves self-heal on the next war tick (`advanceFront(undefined, score)` starts the line on the score).

**Method note (reusability).** Extracted the integrator as a **pure exported `advanceFront`** rather than inlining it, so it unit-tests without a full war fixture and the UI/sim share one source of truth.

**Gates:** tsc clean; **1404 tests** (1393 + 11 new in `tests/front-line.test.ts`: phase thresholds, label completeness, integrator no-overshoot/peak-monotone/geometric-convergence, wired-into-`tickPlayerWar` invariants via the war-materiel inject-rival fixture, `frontPeak` recorded at war-end, serialize round-trip); `serialize-determinism` byte-identical (seeds 1000/2024/7); `bench-region` PASS (worst tick 16.3ms < 16.7ms); `vite build` green.

**NEXT (front follow-ons + the standing menu).** The front is now a real readable state and the *foundation* for combat coupling — the deliberate v1 stopped short of changing outcomes. Natural increment 2: **let the front feed the peace table** (blend `front.position`/`peak` into `computeWarScore` or the occupation gate) — but that changes war outcomes (re-baseline the war tests) and must NOT gate an existing `rng.chance()` on the new value (draw-order trap); draw first, then decide. Also open: regional-war (`assaultSettlement`) combat has no civilian cohort cost (only `garrisonStrength`); Phase 10 climate sea-rise/adaptation; Phase 14 zoning/land-value (the big spatial rock, save-bloat-gated). Track-C tick-extraction backlog is **empty** (remaining region.ts bulk is query/action surface needing interface-segregation, not the tick-fn seam).

## Recent session (2026-07-01) — Track-C wave 4: economy/faction ticks cleared (9 more methods → 6 modules)

**After wave 3 emptied the pre-analyzed backlog, a fresh 10-agent scout ranked the remaining tick-shaped economy/faction methods; the clean ones were lifted the same way.** region.ts **13,631 → 13,321 (−310 more, −664 total this session)**; each its own commit; `tsc` + `serialize-determinism` byte-identical + affected-test-file green per step; full 1307 + `vite build` + `bench-region` (worst 12.4 ms) green.

**Shipped:** `statecraft.ts`←`collectVassalTribute`+`applyProvincePolicyEffects` (no exposure) · `naval.ts`←`navalTradeIncome` (no exposure) · `migration.ts`←`migrate` (expose `routePath`) · `route-weather.ts`←`weatherRoutes` (param named **`sim`** — the loop binds a route to `r`) · `factions.ts`←`updateFactions`+`updateSettlementFactions` (expose `updateRegionalTrade`+`updateFactionAlliances`) · `trade-season.ts`←`traders`+`caravans` (expose `legCapacity`+`addStock`; param **`sim`**; repoint routes.test.ts's 8 `r.caravans()` calls).

**Gotchas reconfirmed:** (i) two methods (`weatherRoutes`, `traders`/`caravans`) bind a route/leg to a loop variable `r`, which collides with the `r: RegionSim` convention — name the param **`sim`** in those modules (documented in each file header). (ii) `formatCurrency` is exported from `defs.ts`, NOT `region.ts` — import it from `../defs`. (iii) `ROUTE_CONDITION_FLOOR`/`REGION_BUILDINGS_MAP` live in region.ts (export them there). (iv) the "`tsc` doesn't typecheck tests/" trap bit again on the routes.test import — always run the affected test file. The scout also VALIDATED every wave-3 extraction as already-done/clean, and confirmed `caravans`'s 8 test pokes (the only pokes in wave 4).

## Recent session (2026-07-01) — Track-C wave 3: the ENTIRE pre-analyzed backlog cleared (14 tick methods → 12 modules)

**Cleared the whole wave-2 backlog** — the biggest-lift engineering work (dismantling the ~14k-line `RegionSim` God-object one per-tick subsystem at a time). **14 methods** (the 13 ranked items + `runElection`, paired with `checkElection`) lifted into **12 new `systems/*` modules**; **region.ts 13,985 → 13,631 (−354 lines)**; one commit per extraction; `tsc` + `serialize-determinism` byte-identical + the affected test file green at EVERY step; full **1307 tests** + `vite build` + `bench-region` (worst tick 13.99 ms < 16.7 ms, no DROPS) green at the end.

**Shipped (commit order):** `exploration.ts`←`updateExploration` (expose `buildingSight`) · `stats.ts`←`tickStatsHistory` · `market.ts`←`updateMarket` (expose `stockOf`/`monthNeed`) · `scenarios.ts`←`checkScenarioGoals` · `victory.ts`←`checkWinConditions`+`checkProclamationGate` (imports `tickAdvisorLoyalty`/`tickAdvisorEvents` from regime) · `utilities.ts`←`tickUtilities` + `events.ts`←`tickRegionalEvents` (expose `townEvent`) · `elections.ts`←`checkElection`+`runElection` · `construction.ts`←`updateConstruction` (export `REGION_BUILDINGS_MAP`, expose `autoPlaceCell`) · `scouts.ts`←`updateScouts` (expose `movePlayerScout`/`moveScout`/`invalidateFactionVisibility`/`spawnScout`) · `rival-ai.ts`←`updateRivalAI` (expose `rivalDiplomaticRound`/`factionTownOutput`/`maybeDevelopFactionTown`) · `expeditions.ts`←`updateExpeditions` (expose `nextId`/`ordinal`/`blazeTrail`/`networkAnchor`).

**Method — EXPOSE-ONLY, not co-extract.** Where a moved body called a private helper, I flipped it `private`→public and LEFT it on RegionSim (called via `r.helper()`), rather than pulling the helper (and its transitive deps) into the new module. This keeps the aiRng/rng draw order provably byte-identical (the helper body is untouched and runs in the exact same sequence) and sidesteps the transitive-dependency risk the scout flagged for the 3/5 items (scouts, rival-ai, expeditions all had helpers that themselves draw aiRng / call more privates). Trade-off: the single-use helpers now sit as public dead-ish surface on RegionSim; a future cosmetic pass could co-extract the truly-single-use ones (ordinal, movePlayerScout, …) for cleaner module boundaries — NOT worth the determinism risk now.

**★ NEW GOTCHA — `tsc --noEmit` does NOT typecheck `tests/`.** When I forgot a test import, `tickUtilities is not defined` passed `tsc` clean and only surfaced at runtime (5 phase14 tests threw `ReferenceError`). **Every test-poke repoint MUST be verified by running the affected test file** (`npx vitest run <file>`), never by `tsc` alone. (The determinism byte-check + full suite already do this; the lesson is: don't trust a green `tsc` as proof the test edits are correct.)

**Gotcha reconfirmed:** the cast-poke traps still bite — `(r as any).m?.()` SILENTLY no-ops after a method leaves RegionSim (stats-history had one), `(r as unknown as {m():void}).m()` throws loudly (phase14/region-wins/wonders). Always `grep -rn` the method name in `tests/` before extracting and repoint to `m(r)`. This session's repointed files: stats-history, phase17, region-wins, phase14, region.test, wonders, wonder-race.

**READY-TO-EXECUTE backlog:** EMPTY — the wave-2 ranked list is fully consumed. For the NEXT Track-C wave, re-scout what tick-shaped methods remain on RegionSim (the God-object is now 13,631 lines / one class; the remaining bulk is query/action surface — spatial/city-build, war/diplomacy ACTIONS, `serialize`/`deserialize` — which needs interface-segregation, not the tick-fn seam). The `opinion-media` cluster stays flagged NOT-a-clean-lift (UI-query entangled). **Alternatively pivot to feature depth** — Phase 10 climate sea-rise/adaptation, Phase 14 zoning/land-value, Phase 16 warfare Front model — or the deferred **on-map economy RESPONSE to the now-live world market** (consumer-demand increment 2), all of which move the game forward rather than just its structure.

## Recent session (2026-06-30) — Track-C wave 2: SIX more tick subsystems extracted + pre-analyzed backlog for the rest (PR #324)

**Continued the Track-C decomposition** (the biggest-lift engineering work — dismantling the ~15k-line `RegionSim` God-object one per-tick subsystem at a time). Shipped 6 extractions this session (region.ts **14,969 → 13,985, −984 lines, 18 methods, 6 modules**), each its own commit, **1307 tests + tsc + vite build + serialize-determinism byte-identical at every step**, and every moved body additionally verified line-for-line against its original (a `git show <prev>:region.ts` diff with `this.`→`r.` applied → 0 deltas beyond the intended). CI green on PR #324.

**Shipped (commit order):** `systems/monetary.ts` (`tickMonetary`+`tickFX`, −192; exposed `computeCreditRating`+`depressionCeilingBonus`, exported `NEUTRAL_RATE`/`LEVERAGE_*`/`FRAGILITY_GAIN`) · `systems/military.ts` (the 11 war ticks incl. `tickPlayerWar` now called from diplomacy.ts, −478; exposed only `nextArmyId`+`_routePathCache`; the player ACTIONS + `computeCombatPower`/`computeWarScore` stay) · `systems/historical.ts` (`tickHistoricalAnchors`, −155; exposed 5 once-fired latches) · `systems/notables.ts` (`tickNotableLifecycle`, −82; exposed `mintNotable`) · `systems/{research,trade,charter,loans}.ts` (4 trivial ticks, −77, ZERO exposures/pokes).

**Method:** for multi-fn or large clusters use the programmatic slice+transform (Python locates each method by signature regex, slices doc-comment..first `^  }`, applies `this.resolveProvinceBattle(`→sibling-call fix then `this.`→`r.`, deletes bottom-to-top with seam-blank collapse, then string-swaps the `tick()` dispatch + adds the import). `tsc` reveals every `private`→public flip needed; then repoint test pokes; gate on `serialize-determinism` + full suite.

**Gotcha confirmed again:** the cast-and-call test trap `(r as unknown as {m(): void }).m()` and `(r as any).m?.()` SILENTLY no-op after a method moves off RegionSim — always `grep -rn` the method name in `tests/` and repoint to the free fn. Files repointed this session: phase15, phase16, goods-prices, supply-cost-push, historical-anchors, depression-cabinet, oil-shock-chain, region.test.

### READY-TO-EXECUTE backlog — remaining tick methods, ranked cleanest-first (mapped by a 19-agent scouting workflow this session; re-`grep` signatures by name, line numbers shift after each extraction)

All are pure per-tick steps still on `RegionSim`. `priv`=private members the body touches (flip to public). `ext`=external call-sites, `pokes`=test files calling it directly (repoint). The opinion-media cluster (`tickMedia`/`tickOpinionDynamics`/`updateMediaReach`/`opinionVelocity`) remains NOT a clean lift (UI-query entangled) — skip until a dedicated pass.

- **`updateExploration`** (clean 5/5, ~36 ln, was @9195-9230) — priv=['buildingSight']; ext=0; pokes=0; consts=['REGION_BUILDINGS_MAP (derived from exported REGION_BUILDINGS)']. Extract now: pure per-tick step with zero external call-sites, no RNG, only utility method calls, and simple public field mutations—trivial clean lift like alre _Risk:_ None: buildingSight() is private but easily exposed; REGION_BUILDINGS_MAP is module const already available to systems/*.ts; no determinism risks (no RNG); no sibling tick entanglement.
- **`tickRegionalEvents`** (clean 5/5, ~22 ln, was @8281-8302) — priv=none; ext=1; pokes=1; consts=['REGION_EVENT_DEFS (exported)', 'RegionalEventDef (exported)', 'RegionalEventKind (exported)', 'ActiveEvent (exported)']. Extract now; trivial clean lift with pure per-tick semantics, no private member coupling, RNG-deterministic _Risk:_ townEvent() is private helper that would need extraction or exposure; test poke uses cast-and-call trap that silently no-ops after move if not repointed
- **`updateScouts`** (clean 5/5, ~23 ln, was @14164-14186) — priv=['scouts', 'playerFactionId', 'rng']; ext=0; pokes=0; consts=['Scout (exported)', 'RegionalFaction (exported)']. Extract now: pure per-tick step (no RNG subtleties with rival spawning, deterministic player scout movement isolated), zero external call-sites, four private-on _Risk:_ Helpers movePlayerScout/moveScout/invalidateFactionVisibility/spawnScout must also be extracted (or kept as module-scoped); RNG draw order in spawnScout (line 14184) critical to determinism byte-match
- **`checkScenarioGoals`** (clean 5/5, ~18 ln, was @5276-5293) — priv=none; ext=5; pokes=1; consts=['SCENARIOS']. Extract now — pure per-tick step, zero sibling tick calls, only public members touched, exported const used, trivial test repointing (5 direct calls in one file _Risk:_ The method uses checkFn.call(this) to dynamically invoke goal-check methods (goalSurviveTo2000, etc.) by name lookup — body verbatim transfer will preserve this pattern; no type loss since the cast (t
- **`checkWinConditions`** (clean 5/5, ~30 ln, was @5809-5838) — priv=none; ext=6; pokes=1; consts=none. Extract now — textbook clean per-tick victory-check step with zero private-member entanglement and straightforward test repointing. _Risk:_ Test file uses type-cast helper (r as unknown).checkWinConditions?.() which would need repointing to a direct checkWinConditions(r) call after extraction; no RNG or ordering subtleties.
- **`tickStatsHistory`** (clean 5/5, ~18 ln, was @7259-7276) — priv=none; ext=1; pokes=1; consts=['STATS_HISTORY_MAX']. Extract now: pure per-month stats-recording step with no private members, no sibling tick calls, single exported const, only one test poke (optional-chain safe) _Risk:_ Test uses optional-chain (r as any).tickStatsHistory?.() which silently no-ops after extraction—test must be updated to call tickStatsHistory(r) directly."
- **`updateMarket`** (clean 5/5, ~11 ln, was @5992-6002) — priv=['stockOf', 'monthNeed']; ext=0; pokes=0; consts=['TRADE_GOODS', 'BASE_PRICE']. Extract now: pure per-tick step dispatched from dailyUpdate() within tick(), zero external call-sites, no test pokes. Trivial clean lift once helper methods (st _Risk:_ None: no optional-chaining traps, no RNG-order entanglement, no UI queries, no state mutation beyond Settlement.prices[] which is argument-scoped. Byte-identical RNG draw order guaranteed if helpers i
- **`checkElection`** (clean 4/5, ~13 ln, was @9437-9449) — priv=none; ext=0; pokes=1; consts=['GOV_TYPES (exported)']. Extract now; pair with runElection as nested helper to maintain test isolation and RNG determinism, or extract both together. Pure tick step, zero external call _Risk:_ checkElection calls private runElection() method (lines 9452-9472) — if extracting checkElection alone, runElection must become a nested helper in systems/elections.ts or both must move together. Test
- **`tickUtilities`** (clean 4/5, ~39 ln, was @8238-8276) — priv=['townEvent']; ext=6; pokes=1; consts=none. Extract now — pure per-tick utility computation, minimal private dependencies (only townEvent), no sibling tick calls, RNG order safe via single this.rng.chance _Risk:_ Only private member touched is townEvent (simple logging, easily exported/repointed); RNG is called exactly once per tick (disease event 5% check) — order preserved if extracted. All data mutations ar
- **`checkProclamationGate`** (clean 4/5, ~16 ln, was @5959-5974) — priv=none; ext=2; pokes=2; consts=none. Extract now: pure per-tick gate-check with clean separation (no private members, no sibling tick calls). Tests use type casts (safe, will continue to work post- _Risk:_ Tests mock playerTerritoryControl as a method on r; ensure casts survive (they should, as they're just accessing the RegionSim interface). The body calls generateAdvisorBriefs + two already-extracted 
- **`updateExpeditions`** (clean 3/5, ~60 ln, was @9086-9145) — priv=['nextId']; ext=0; pokes=0; consts=['Settlement', 'defaultPrices', 'defaultSectors', 'activeFactions', 'DEFAULT_CITY_POLICIES', 'NewFactionId']. extract later; depends on 4 private helper methods (ordinal, blazeTrail, networkAnchor, mintNotable) that would need public exposure or careful reexport _Risk:_ mutates private field nextId (affects ID counter continuity); calls 4 private methods (ordinal, blazeTrail, networkAnchor, mintNotable) that are not tick-steps and would need to be exposed; side effec
- **`updateConstruction`** (clean 3/5, ~25 ln, was @8617-8641) — priv=['autoPlaceCell', 'townEvent']; ext=2; pokes=2; consts=['REGION_BUILDINGS_MAP (NOT exported)']. Extract with medium effort: clean per-tick body (no RNG), but requires private member exposure (autoPlaceCell, townEvent) and module-level const access (REGION_ _Risk:_ Must export REGION_BUILDINGS_MAP or make it publicly available in systems/ module; autoPlaceCell and townEvent need private→public flip; two test files call it via cast pattern (r as any).updateConstr
- **`updateRivalAI`** (clean 3/5, ~35 ln, was @13684-13718) — priv=none; ext=0; pokes=0; consts=['AI_DIFFICULTY (exported from defs.ts)', 'TREATY_DEFS (exported from region.ts)']. Extract now — called only from monthlyUpdate dispatched in tick; few external call-sites (zero); no sibling tick methods wired; public field reads only (rivals, _Risk:_ Helper methods (rivalDiplomaticRound, updateFactionAI, maybeDevelopFactionTown, factionTownOutput) carry transitive complex dependencies (offers, stateProclaimed, aiRng, addLog, settlement accessor). 

## Recent session (2026-06-30) — Track-C decomposition: 4 tick subsystems lifted out of the RegionSim monolith (PR #323)

**The biggest-lift engineering work**: `src/sim/region.ts` is a **15.8k-line God-object** (`RegionSim`, ~308 methods) — the structural risk every session fights. Continued the proven Track-C modularization (the seam already used for `pollution`/`services`/`arbitrage`/`goods`): each per-tick subsystem moves to `systems/<name>.ts` as `export function tickX(r: RegionSim, …)`, body **verbatim** so the RNG-draw order is byte-identical, `tick()` dispatches, all state + `serialize()` stay on `RegionSim`. Behaviour-preserving ⇒ provably safe via `tests/serialize-determinism` + the full suite — reduces the central risk with **zero gameplay/balance change**.

**Shipped 4 extractions (region.ts −873 lines: 15,843 → 14,970), each its own commit, 1307 tests green + tsc + determinism byte-identical at every step:**
- `systems/regime.ts` ← `tickAdvisorLoyalty`, `tickAdvisorEvents`, `tickLegitimacy`, `tickRegimeMechanics` (governance; **0** new public surface). Commit `6f402cc`.
- `systems/demographics.ts` ← `tickDemographicTransition`, `tickAppealMigration`, `tickEducationLag`, `tickUnrestLadder` (exposed `computeDemographicPhase`, `removePop`). `tickStatsHistory` stays (stats subsystem, sits between them). Commit `7533e52`.
- `systems/climate.ts` ← `tickClimate`, `tickAccords`, `checkStrandedAssets`, `tickAutomation` (exposed `decideBranch`/`buildCenturyReport`/`triggerEpilogueEvent` + 4 log-throttle fields; exported `WARMING_PER_PPM`/`WARMING_LAG_TICKS`). Player actions + era-milestone logic stay. Commit `1830fbd`.
- `systems/diplomacy.ts` ← `updateDiplomacy` (orchestrator) + `tickForeignRelations`, `endForeignWar`, `tickRivalEspionage`, `tickRivalTradeBlocActivity`, `tickRivalProvinceGovernance`, `tickSanctions`. Only `updateDiplomacy` is dispatched from `tick()`; it drives the other six as module siblings (`tickX(r)`) plus `r.tickPlayerWar()` (warfare, stays). Exposed `noteHistory`/`changeRegime`/`clampRel`/`playerBloc`/`startPlayerWar`/`tickPlayerWar` + `nextRivalBlocId`. Zero test-file changes. Commit `5b4f408`. **Built via programmatic slice+transform** (Python sliced the verbatim bodies, did `this.`→`r.` + sibling-call rewrite) — determinism stayed byte-identical, confirming the approach for the big multi-fn clusters.

**Recipe for the next extraction (followed exactly above):** (1) confirm the tick fn's call-sites with `grep -rn` over `src/ui` + `tests` (the analysis agents UNDERCOUNTED test calls — always verify yourself); (2) write the module with bodies transcribed verbatim, `this.`→`r.`; (3) one atomic Python script on region.ts that asserts boundary lines, deletes the method ranges bottom-to-top, adds the import, swaps `this.tickX()`→`tickX(this)` at the dispatch sites, and flips `private`→public on the members the moved bodies touch directly; (4) update any test call-sites to import the free fn; (5) gate on `tsc` + `vitest run serialize-determinism <area>` then the full 1307. Per-extraction commit.

### READY-TO-EXECUTE backlog (mapped this session by a 7-agent analysis workflow — pick up here)
> ✅ **SUPERSEDED — `monetary` + `military` were both DONE in Track-C wave 2 (PR #324). See the `## Recent session (2026-06-30) — Track-C wave 2` section above for the current pre-analyzed backlog (≈13 remaining ticks).** Kept below for historical context.

Ordered cleanest-first. Positions are **as of commit `5b4f408`** — re-`grep` signatures by name first (line numbers shift after each extraction; names are stable).
- **`systems/monetary.ts` — NEXT, fully pre-analyzed (medium, ~210 lines).** Move ONLY `tickMonetary` (@6335–6487; mind the size — the next method is `goodStock`@6488) and `tickFX` (@6848–6904); they're independent (no sibling calls). `computeCreditRating` (@6317) is called from TWO sites (one outside tickMonetary) → **stays + expose**; also expose field `depressionCeilingBonus`. `computeExchangeRate` (called by `tickFX` and by `tests/phase15.test.ts`) plus `devalue`/`switchCurrencyRegime` are queries/actions → **stay**. Export the module consts the bodies use — `NEUTRAL_RATE`, `FRAGILITY_GAIN`, `LEVERAGE_FRAGILE`, `LEVERAGE_FRAGILITY` (let `tsc` confirm the exact set). Dispatch: `if (this.hasCentralBank()) this.tickMonetary()` + `this.tickFX()`. Tests: `phase15.test.ts` calls `r.tickFX()`/`r.computeExchangeRate()` (both stay reachable — only their internals move), and `goods-prices.test.ts` wraps `tickMonetary` in a local cast helper → repoint it at the new free fn.
- **`systems/military.ts` (medium, ~465 lines, biggest but most coupled).** Move the war TICKS: `updateArmyMovement`, `resolveProvinceBattle`, `tickRivalArmyAI`, `tickMobilization`, `resolveArmyGroupBattle`, `tickSupplyLines`, `tickOccupation`, `tickWarSupport`, `consumeWarSupply`, `tickPlayerWar`, `abandonGhostTowns`. Keep the player ACTIONS (`setMobilization`, `proposePeace`, `offerPeace`, `deployUnits`, `capitulate`, …) and the QUERIES `computeCombatPower`/`computeWarScore` (UI-read) on RegionSim. `removePop` is already public (exposed this session).
- **`opinion-media` — NOT viable as a clean lift** (the analysis flagged it high-coupling/cleanliness-1): `tickOpinionDynamics`, `tickMedia`, `updateMediaReach`, `opinionVelocity` are entangled with UI queries. Skip until a dedicated pass.

### Weak areas / gotchas found this session (carry forward)
- **Deps don't install cleanly in this env:** `npm ci` fails on `electron`'s postinstall (binary download blocked by the proxy → "server aborted"). Use **`npm ci --ignore-scripts`** (vite/vitest/tsx/tsc don't need the Electron binary). CI is unaffected — `test.yml` sets `ELECTRON_SKIP_BINARY_DOWNLOAD=1`.
- **Test call-site trap:** `tests/{climate-refugee-migration,seawall-overtopping}.test.ts` drove `tickClimate` via `(r as any).tickClimate?.()`. After the method moves off `RegionSim` that optional-chain **silently no-ops** (tsc stays green, the test passes while testing nothing). Fixed to `tickClimate(r)` this session; watch for the same `?.()` pattern when extracting any method a test pokes via cast.
- **`region.ts` is still ~15.0k lines / one class** (14,970 after 4 extractions). The remaining tick subsystems above (monetary, military) are the next ~700 lines of safe reduction. The big non-tick bulk (the spatial/city-build methods ~7958-9074, the diplomacy ACTIONS, the war ACTIONS, `serialize`/`deserialize` @~13.4k) are query/action surfaces, not tick steps — they need a different (interface-segregation) approach, not the tick-fn seam.
- **The 7 analysis agents undercounted external call-sites** (e.g. claimed `tickAdvisorLoyalty`/`tickClimate` had 0, but tests call them). Trust the grep, not the agent, for call-site counts.

## Recent session (2026-06-28 latest) — Spatial Phase C: per-hex terrain yields + building adjacency

User said "Continue" → the spatial track's headline next step was **Phase C** (terrain yields feed
the economy, the natural activator of the PR-3 slice 3 dormant coupling). Implementation in
`src/sim/region.ts`; 17 new tests in `tests/terrain-yields.test.ts`.

- **`tileYieldFor(t: Settlement)`** (private). Iterates ring cells d=1..CITY_WORK_RADIUS, skipping
  water and center, and accumulates fertility / ore / roughness / forest / river fractions:
  - `agriculture` = `(meanFertility−1.0)×0.20 + riverFrac×0.06`, clamped [−0.15, 0.25]
  - `industry` = `roughFrac×0.10 + oreFrac×0.15 + forestFrac×0.06`, clamped [−0.05, 0.25]
  - `services` = `riverFrac×0.10 + (coastal?0.08:0)`, clamped [0, 0.20]; `information` = 0
  Result cached on `_tileYieldCache: Map<number,…>` — transient private field, NOT serialized.
- **`placedBuildingTerrainBonus(t, sector)`** (private). For each placed building whose sector
  matches the query, reads the cell's terrain and adds +5% if: agri→fertile/river cell;
  industry→ore/rough cell; services→river/coastal cell.
- **`buildingBonus(t, sector)`** extended to add `yields[sector] + placedBuildingTerrainBonus(t, sector)`.
  `updateSectors` unchanged (already consumes `buildingBonus`).
- **Intentional re-baseline.** Headless markers shift from the slice-3 base (expected — terrain
  shapes economies). Headless suite still PASS (stable + finite + bounded), just at shifted values.
- **Phase C activates slice 3.** Towns now specialise → `localGoodsScarcity` > 0 in real play →
  cost-push + output drag + price-driven arbitrage all bite. Re-baseline economy-balance target;
  want a human playtest (depression ~1929, war).
- **Gates:** tsc clean; **1020 tests** (1003 + 17); determinism harness ✅; bench-region PASS
  (worst tick 11.9ms < 16.7ms); vite build green; headless 8-seed × 181y stable (inflation 2.0%).
- **Key gotchas for the next agent:** `advanceMonth` = 1440 ticks (not 30); `foundColony` pref
  key is `pref` not `terrain`; `_tileYieldCache` must not appear in serialized JSON.

## Recent session (2026-06-28) — PR-3 slice 3: per-good local prices + macro coupling

User said "Keep working". The economy track's headline next step was **PR-3 slice 3** (per-good
local prices — "the first slice that moves the macro economy"), and every prerequisite was in place
(slice 2's per-town gate, slice 1's cargo, the four C1 extractions). This session built the full
slice in `systems/goods.ts` + `systems/arbitrage.ts` + the macro seam in `region.ts`.

- **Per-good local PRICES (`localGoodPrice`).** Each tracked good is priced PER TOWN: `basePrice ×
  (1 + scarcity × GAIN)`, scarcity = `clamp(1 − stock/demand)`; `localGoodDemand` is the town's
  full-supply consumption appetite (Σ over the goods it makes that consume the good). A producer
  flush with a good prices it at base; a town that consumes it but holds none prices it dear.
  Pure reads off `goodStocks` — **no raw is ever priced** (the load-bearing invariant).
- **Price-driven ARBITRAGE.** Dropped the wage-gap proxy: each lane ships the good with the largest
  profitable **price gap**, from the cheap (abundant) town to the dear (short) one — a deprived town
  pulls exactly the good it needs (the proxy shipped `goodIds[0]` regardless).
- **The macro coupling.** A nation-wide **`localGoodsScarcity`** index ∈ [0,1], cached each month
  from the per-town production **GATES** (lost output / potential output), feeds (a) cost-push
  inflation and (b) an industry-output drag, both one-month-lagged like `supplyShockMult`.
- **⚠️ THE KEY FINDING — the coupling is INERT in current balanced play; markers are BYTE-IDENTICAL
  to base.** This **corrects the prior baton's prediction** ("the markers WILL move from base"). The
  index is gate-driven, so it's exactly 0 whenever every gate is 1 — and real autoplay towns are
  MIXED (industry & agriculture both), so they're self-sufficient and never strand a cross-sector
  good (measured: `localGoodsScarcity` = 0 in all 8 headless seeds × 181y, a clean probe before
  wiring). So slice 3 ships the full machinery with **ZERO balance risk today**; it bites only under
  **SPECIALISATION** (a forced pure-industry + pure-agri 2-town fixture gives index ≈ 0.14, textiles
  priced 2.0 in the industry town vs 1.0 in the agri town → arbitrage ships textiles in). **Spatial
  Phase C (per-hex terrain yields → specialised towns) is the natural activator** — slice 3 + Phase
  C together produce the gameplay.
- **Why gate-driven, not stock magnitudes.** A stock-based index would also fire during a RAW shock
  (level<1 depletes stocks) → double-counting the raw cascade AND breaking single-town
  byte-identity-during-shock. The gate is the **pure** slice-2-divergence signal: for a
  self-sufficient town `have/need ≥ 1` regardless of `level`, so the gate stays 1 in boom OR shock →
  index 0 → no double-count. (The supply-cost-push single-town oil-embargo tests pass unchanged.)
- **Gates.** tsc clean; **1003 tests** (988 + 15 new in `tests/goods-prices.test.ts`; 4 wage-based
  arbitrage tests in `phase15.test.ts` reworked to price-driven); determinism harness ✅; bench-region
  PASS (worst tick 13.8ms < 16.7ms); save-size < 192 KiB; headless 8-seed×181y byte-identical + stable.
- **Seam.** `LOCAL_GOODS_INFLATION` / `LOCAL_GOODS_OUTPUT_DRAG` exported from region.ts;
  `LOCAL_GOODS_PRICE_GAIN` in goods.ts; `localGoodPrice` + `localGoodDemand` exported (arbitrage
  imports `localGoodPrice` call-time-only). New serialized field `localGoodsScarcity` (backfill 0).

## Recent session (2026-06-28) — PR-3 slice 2: the per-town supply solve

User said "continue". Every prerequisite for **PR-3 slice 2** (the per-town supply solve) was in
place — the storage swap (#294), slice 1's physical `cargo` on routes, and all four C1 extractions
(`tickIntermediateGoods` already lives in `systems/goods.ts`) — so this session wrote slice 2
there, in the goods system, not the 14k-line monolith.

- **The mechanic.** The nation-wide cascade (`resolveSupplyChainGraded`) still resolves ONCE and
  still drives every MACRO signal — `supplyChainHealth`, `supplyShockSeverity`, the output drag
  `supplyShockMult`, `_electronicsDisrupted`, and the pharma plague / electronics research-slow RNG
  effects — **byte-identical**, because a raw shortage still cascades through the graph exactly as
  before. What changed is the **STOCK LEDGER**: the old nation-wide `produceGood`/`drawGood`
  (deposit `baseOutput·level` split by sector weight, drain `level` of each input from one pool) is
  replaced by a new free function `distributeGoodProduction(r, good, level)` that resolves supply
  **per town** — each town makes its sector-weighted share of `baseOutput·level` only up to a
  **local input gate** `min over intermediate inputs of min(1, town.stock[i] / need)`, and consumes
  those inputs from its **own** `goodStocks` (`shipGoodFrom` debit, `addGoodStock` deposit). Raw
  inputs stay folded into `level` (the sector proxy / embargoes) and never gate per-town.
- **Single-town / co-located play is byte-identical.** A lone town produces every input it consumes
  (stocks grow unbounded), so every gate is 1 and it banks the full `baseOutput·level`, exactly as
  the old pool did. Two invariants make that hold even at unlock boundaries, both now guarded by
  tests: (1) `INTERMEDIATE_GOODS` is **topologically ordered** (every intermediate input precedes
  its consumer), and the loop runs in that order, so a town's own upstream output *this tick* is in
  stock before its downstream goods read it; (2) `baseOutput(i) ≥ #consumers(i)` for every input,
  so the first-tick gate is 1 before any buffer accrues.
- **The intended divergence.** A **cross-sector** good in a **multi-town** nation:
  `clothing`/`consumer_goods`/`luxury_goods` are industry-attributed yet need agri `textiles`. A
  pure-industry town holds no textiles → makes none of them; the textiles strand, unused, in the
  agri town (verified: `consumer_goods` 0, `textiles` 10 banked in the agri town) — until they are
  **shipped in** (the gate reads current stock, which includes arrived cargo → production
  restored). Mixed self-sufficient towns don't diverge — specialization is what triggers it.
- **Macro-neutral today, by construction.** No economy path reads good-stock *magnitudes* (the
  cascade reads `rawSupplyLevel` for raws only; the sole economy reader, `supplyShockMult`, derives
  from `supplyChainHealth`/baseline, never a stock amount). So the per-town ledger divergence does
  not reach GDP/inflation/etc.: the **headless 8-seed × 181y markers are byte-identical to base**
  (stash-and-diff confirmed), with the divergence confined to the serialized per-town `goodStocks`.
  This is the *deliberate* low-risk shape: slice 2 lands the substrate with zero balance risk; the
  playtest-worthy macro shift arrives with **per-good local prices** (the next slice, which makes
  local stock bite).
- **Gates.** tsc clean; **988 tests** (980 + 8 new in `tests/goods-local.test.ts`: single-town full
  production, specialized-multi-town divergence, shipping relief, mixed-town non-divergence,
  non-negative/finite bounds, determinism, + the two invariant guards); determinism harness ✅
  (multi-town centuries — determinism/load-stability is the gate now, not equivalence-to-base);
  bench-region PASS (worst tick 11.8 ms < 16.7 ms); save-size 83.5 KiB < 192; headless stable +
  markers byte-identical. A **4-lens adversarial review** (correctness / macro-neutrality+RNG-order
  / seam+import-cycle / test-fidelity, each finding adversarially verified) returned **no blockers
  or majors** — only confirmations + nits.
- **Seam (the C1 recipe: expose only what's touched).** `goodProducingSector` exported and
  `capitalSettlement()` made public on `RegionSim` — the two reads `distributeGoodProduction` needs.
  The `INTERMEDIATE_IDS` set is built **lazily (call-time)** via a memo, never at module top level —
  the region.ts↔goods.ts import cycle means a load-time read of `INTERMEDIATE_GOODS`/
  `goodProducingSector` would see `undefined` (the gotcha the baton warned about; hit it once,
  fixed it). `produceGood`/`drawGood` stay (still the tested ledger API) but no longer run in the
  production tick.

## Recent session (2026-06-28) — C1 extraction: intermediate-goods subsystem → systems/goods.ts

User said "continue". The economy track's headline next step is **PR-3 slice 2** (the per-town
supply solve) — a *deliberate balance change* wanting a downturn playtest — and the project's
own **dependency rules** + the prior baton both name the exact prerequisite leaf: *"`tickIntermediateGoods`
is the next leaf — pull it into `systems/goods.ts` before PR-3 slice 2 rewrites it."* So this
session shipped that de-risked, fully-verifiable prerequisite — the same "ship the verifiable
slice, defer the unverifiable balance change" discipline that produced the prior three Track-C
leaves and PR-3 slice 1.

- **The move.** `tickIntermediateGoods` (the monthly intermediate-goods tick: advance sector
  norms → prune embargoes → resolve the graded supply cascade → produce/draw the stock ledger →
  fire the pharma plague-roll + electronics research-slow secondary effects) left `region.ts` for
  a new **`src/sim/systems/goods.ts`** as a free function `tickIntermediateGoods(r: RegionSim)`.
  `tick()` now dispatches `tickIntermediateGoods(this)` in the **same tick slot** (immediately
  before `tickPriceArbitrage(this)`). The body moved **verbatim** (`this.`→`r.`); no logic changed.
- **The FOURTH Track-C leaf** (after `systems/pollution.ts` #284, `systems/services.ts` #285, and
  `systems/arbitrage.ts`). Like arbitrage it **consumes RNG** (the `0.15·pharmaShortfall` plague
  draw, the `int(settlements.length)` target pick, the `0.3·electronicsShortfall` research-slow
  draw) — the free-function form runs the body against the same `RegionSim`, so not one draw moves.
- **Seam (the C1 recipe: every touched `r.x` must be public).** Made public on `RegionSim`:
  methods `advanceSectorOutputNorms` + `rawSupplyLevel` (were `private`), and the two one-month
  cache fields `_electronicsDisrupted` + `supplyShockMult` (were `private`). **`sectorRawLevel`
  stays private** — it's only called by `rawSupplyLevel` (a method that stays on the class), so it
  needn't be exposed (minimal surface). The unused `SUPPLY_FULL_EPS` import was dropped from
  `region.ts` (its sole consumer was the moved method; `noUnusedLocals` would have failed tsc);
  `resolveSupplyChainGraded` + `INTERMEDIATE_GOODS` stay (still used by `supplyChainSnapshot` /
  `supplyChainBaselineHealth`). `goods.ts` imports `INTERMEDIATE_GOODS` (a *value*) from
  `region.ts` call-time-only — the same safe runtime import cycle as `arbitrage.ts`.
- **Byte-identical — proven, not asserted.** Pure code move → verified by the **determinism
  harness** AND an **8-seed × 181y headless sweep diffed byte-for-byte against the pre-change
  baseline (identical sha256)**. tsc clean, vite build green, **bench-region PASS** (worst tick
  11.8 ms < 16.7 ms), save-size guard ✅. A **3-lens adversarial review** (move-fidelity /
  test-fidelity / seam-minimality + synthesizer) returned **SHIP, zero confirmed defects**.
- **Tests.** The six suites that called `r.tickIntermediateGoods()` (phase15, supply, supply-shock,
  oil-shock-chain, supply-cost-push, supply-trade-leg) now import & call the free function
  `tickIntermediateGoods(r)` (mirroring how phase14 calls `tickPollution` and phase15 calls
  `tickPriceArbitrage`). Count unchanged at **980** — a pure refactor adds no behaviour to cover;
  the harness is the gate. (Bonus: tightened one pre-existing tautological assertion in phase15 —
  `chemicals >= 0` → `> 0` — now it actually verifies production, which the review confirmed holds.)
- **Why this, not slice 2.** Slice 2 adds hundreds of lines to the goods system and is a real
  balance change; landing it in the 14k-line monolith is what the dependency rule warns against.
  With `tickIntermediateGoods` out, slice 2 can grow in `systems/goods.ts`. Slice 2 remains the
  headline next step (see §5 of `.handoff.md`).

## Recent session (2026-06-27 latest) — C1 extraction: trade-arbitrage subsystem → systems/arbitrage.ts

User said "continue". The economy track's headline next step is **PR-3 slice 2** (the per-town
supply solve), but that is a *deliberate balance change* wanting a downturn playtest — and the
project's own **dependency rules** sequence a C1 extraction *before* it: *"continue C1 leaf
extractions before the big D1-econ goods/price/FX features — they add hundreds of lines; land
them in `systems/`, not the 14k-line monolith."* The prior baton named the exact leaf
("lift `tickPriceArbitrage` into `systems/` now it's grown a cargo leg"). So this session
shipped that de-risked, fully-verifiable prerequisite — the same "ship the verifiable slice,
defer the unverifiable balance change" discipline that produced slice 1.

- **The move.** `tickPriceArbitrage` (the trade-route shipment pipeline: advance in-transit
  flows → deliver/strand → dispatch new arbitrage) and its helper `computeCongestionTariff`
  left `region.ts` for a new **`src/sim/systems/arbitrage.ts`** as free functions
  `fn(r: RegionSim, …)`. `tick()` now dispatches `tickPriceArbitrage(this)` (matching the
  `tickPollution(this)` / `tickServiceCoverage(this)` calls). The method bodies moved
  **verbatim** (`this.`→`r.`, and the internal `this.computeCongestionTariff(…)` →
  `computeCongestionTariff(r, …)`); no logic changed.
- **The third Track-C leaf** (after `systems/pollution.ts` #284 and `systems/services.ts`
  #285), and the first that **consumes RNG** (the 0.1/0.15 delivery/stranding `addLog` draws)
  and **mutates the per-town goods ledger** (cargo debit/credit). The free-function form is
  exactly what keeps that safe: the body runs against the same `RegionSim`, so not one draw
  moves. State + `serialize()` stay on `RegionSim`.
- **Seam.** `addGoodStock` and `shipGoodFrom` went `private` → **public** (the C1 recipe:
  every touched `r.x` must be public). They sit beside the public `goodStock`/`produceGood`/
  `drawGood` accessors, so the goods surface stays coherent. One runtime import cycle is
  introduced and is **safe**: `arbitrage.ts` imports `INTERMEDIATE_GOODS` (a value) from
  `region.ts`, but only reads it *inside the function body* (call-time), so ESM live-bindings
  have it initialized by the time a tick runs (confirmed green across harness + headless +
  full suite).
- **Byte-identical — proven, not asserted.** Pure code move → verified by the **determinism
  harness** (`serialize()` across same-seed runs) AND an **8-seed × 181y headless sweep diffed
  byte-for-byte against base** (GDP/treasury/inflation/pop/sat/outcome all identical). tsc
  clean, vite build green, **bench-region PASS** (worst tick 11.3 ms < 16.7 ms), save-size ✅.
- **Tests.** The `computeCongestionTariff()` / `tickPriceArbitrage()` suites in
  `tests/phase15.test.ts` now import & call the free functions (`fn(r, …)` not `r.fn(…)`),
  mirroring `tests/phase14.test.ts`'s `tickPollution`/`tickServiceCoverage` calls. Count
  unchanged at **980** — a pure refactor adds no behaviour to cover; the harness is the gate.
- **Why this, not slice 2.** Slice 2 adds hundreds of lines to the goods system and is a real
  balance change; landing it in the 14k-line monolith, on top of the not-yet-extracted
  arbitrage code, is exactly what the dependency rule warns against. With arbitrage out, the
  goods/trade code is calmer and slice 2 can grow in `systems/`. Slice 2 remains the headline
  next step (see §5 of `.handoff.md`); it can now optionally be preceded by extracting
  `tickIntermediateGoods` into `systems/goods.ts` (the method slice 2 rewrites).

## Recent session (2026-06-27) — PR-3 slice 1: "goods ride the rails" (physical cargo on trade routes)

User said "continue" → picked up the explicitly-sequenced next step (PR-3) and shipped its
**first, macro-neutral slice** — the #288 follow-on the prior baton named as PR-3's entry
point ("extend the `pendingIncome` delivery to move physical units into the destination
town's `goodStocks`").

The gap it closes: a `tradeFlows` entry carried a `goodId` + `volume` that were
**decorative** — only the arbitrage *profit* (`pendingIncome`) ever moved; the cargo itself
never left a warehouse, so the GDD §5.2 promise of "physical goods on routes" was half-true.

- **The mechanic.** Each flow now carries **`cargo`** (new serialized field) — the real
  units of `goodId` **debited from the source town's `goodStocks` on dispatch**
  (`shipGoodFrom(t, id, max)` ships `min(volume, what the town actually holds)`, never
  negative) and **credited to the destination town's `goodStocks` on arrival** (after
  `transitDays`, via the existing `addGoodStock`). **A severed route now strands the REAL
  cargo** — debited on dispatch, never credited → destroyed (the #288 narrative, literally,
  not just "abstract profit lost"). A town holding none of the good ships zero cargo but
  the profit flow still dispatches (dispatch is independent of physical stock).
- **Macro-neutral — PROVEN by direct diff.** The dispatch decision, transit time and
  `pendingIncome` are **untouched**; cargo is purely additive per-town bookkeeping. Nothing
  reads intermediate-good *stock magnitudes* into the macro economy — the solver's
  `rawSupplyLevel` proxies **true raws** (coal/iron/…, never in the ledger) off sector
  output and resolves intermediates through the **graph**, never their stock size (the same
  "ledger is gameplay-inert in healthy play" insight that de-risked #292/#294). Verified
  empirically: stashed the change and re-ran the **8-seed × 181y headless sweep** — the
  output (GDP/treasury/inflation/pop/sat/outcome, all 8 seeds) is **byte-for-byte
  identical**. So the per-town stocks now *move* but observe no behaviour yet — that's slice 2.
- **Serialization.** `cargo` rides the existing `tradeFlows` serialize; deserialize
  backfills `cargo: f.cargo ?? 0` (pre-cargo flows start at 0), mirroring `pendingIncome`.
- **Why ship this slice first (not the whole of PR-3).** It's the substrate the *real*
  balance change — per-town supply solving — consumes, but it's independently coherent,
  fully verifiable without a human, and macro-neutral, so it lands de-risked: the same
  decompose-and-verify discipline as #292 seam → #294 storage swap.
- **Verified.** tsc clean, vite build green; determinism harness ✅; save-size guard ✅
  (cargo is one number per flow, flows capped to one per lane); bench-region PASS; headless
  byte-identical to base. Tests 975 → **980** (+5: dispatch-debits-source, none-held-ships-
  zero-but-dispatches-profit, arrival-credits-destination, severed-route-destroys-cargo,
  pre-cargo-save-backfills-to-0; the tradeFlows round-trip now also asserts cargo).

**Next (PR-3 slice 2, INTENTIONAL DIVERGENCE — the actual balance change):** consume a
good's inputs from the *producing town's* stock and run a **local supply level per town**,
so the imported stock now *matters* (a town builds vehicles only if components arrive). This
is the first deliberate balance change → downturn playtest + re-baseline the headless sweep;
watch bench-region (per-town solving is hot-path work) and the RNG order of the secondary
disease/research draws. Then per-good local prices → the 44-good catalog.

## Recent session (2026-06-27 latest) — per-settlement-stocks STORAGE SWAP: goods stocks move per-town (PR #294)

User said "continue" → picked up the explicitly-sequenced PR-2 the #292 seam was built for
and shipped it. The goods ledger no longer lives in one nation-wide `intermediateGoodStocks`
pool; it lives per town on **`Settlement.goodStocks?: Record<string,number>`** (optional,
sparse). Because every read/write already flowed through the #292 accessors, this was a
backing-store repoint — production/consumption logic untouched.

- **Aggregate-equivalent / byte-identical gameplay.** The supply chain reads nation-wide
  totals; those are now the **sum across towns**, but the values match the old single pool:
  - `produceGood(id,qty)` **distributes** the tick's output across towns by the producing
    sector's output (`goodProducingSector` → agriculture for food/textiles, industry for the
    rest). Every contributing town but the last gets its proportional share; the **last gets
    the exact remainder** so Σ == qty (no float drift). All sector outputs 0 → banks in the
    capital.
  - `drawGood(id,qty)` drains towns **greedily in array order** until qty is met or stock is
    exhausted; the aggregate falls by exactly `min(qty,total)` (matches old `max(0,pool−qty)`),
    using only subtraction so the floor is exact. Still a **no-op for an untracked raw**.
  - `seedGoodStock` seeds a 0-entry into the **capital** if untracked; never overwrites.
  - `goodStocksSnapshot()` is now a **derived aggregate** (UI/debug/test read), not the
    serialize source. `restoreGoodStocks` is **legacy-migration only** (old top-level pool →
    capital, guarded so a new save isn't clobbered).
- **Serialization.** Per-town `goodStocks` rides each settlement's `...s` spread (sparse —
  absent when empty); the top-level `intermediateGoodStocks` key is gone. `deserialize` keeps
  `r.restoreGoodStocks(d.intermediateGoodStocks)` as the migration call (no-op for new saves).
- **Why it was safe (the key insight that de-risked the whole swap).** The stock ledger is
  **gameplay-inert in healthy play**: the cascade solver's `rawLevel` callback is only invoked
  for **leaf raws** (coal/iron/…), which are never tracked in the ledger, so it reads the
  **sector proxy**, never a tracked good's magnitude. The Supply UI panel reads the **live
  solve** (`supplyChainSnapshot`), not stock magnitudes. So the per-town split changes no
  observable behaviour today — it's pure storage groundwork for consume/ship-between-towns.
- **Verified.** tsc clean, vite build green; determinism harness (3 seeds × 4 checkpoints +
  fixed-point reload) ✅; save-size guard (all 4 ceilings, +<2 KiB for 16 goods × N towns) ✅;
  headless 8-seed × 181y all finite at 2.0% inflation. Tests 971 → **975** (+4: snapshot
  aggregation, legacy migration into capital, per-settlement round-trip, new-save format).

**Next (PR-3, INTENTIONAL DIVERGENCE — no longer byte-identical):** consume a good's inputs
from the producing town's stock, run a *local* supply level per town, and ship surplus over
the existing route network (extend #288's `pendingIncome` arrival delivery to move physical
units into the destination's `goodStocks`). First deliberate balance change → downturn
playtest + re-baseline the headless sweep. Then per-good local prices → the 44-good catalog.

## Recent session (2026-06-27 late) — per-settlement-stocks FOUNDATION: the goods-stock ledger seam (PR #292)

User asked "what's next (per-settlement-stocks foundation)?" The blocker for goods moving
*between* towns is that `intermediateGoodStocks` is a single nation-wide pool. Rather than
swap the backing store in one large risky change, this session shipped the **seam** so the
later swap is surgical, not a scatter-edit.

- **The mechanic.** Every read/write of the ledger now flows through accessors on
  `RegionSim`: `goodStock(id)` (0-default read), `hasGoodStock(id)` ("is this good
  tracked?"), `produceGood(id,qty)` (deposit), `drawGood(id,qty)` (consume, floors at 0,
  **no-op for an untracked raw** — that's how raws stay proxied by `sectorRawLevel`),
  `seedGoodStock(id)` (seed-to-0, **never overwrites**), and `goodStocksSnapshot()` /
  `restoreGoodStocks(d)` (the serialize/deserialize legs). Five touch points routed: the
  `tickIntermediateGoods` production loop, `rawSupplyLevel`, serialize, deserialize.
- **Byte-identical, verified 3 ways.** The accessors wrap the same single record, so
  behaviour AND the save format are unchanged: the full-`serialize()` determinism harness
  passes, the save-size guard passes, and a direct same-seed `serialize()` snapshot is
  **hash-for-hash identical to base `main`** across 3 seeds × 5 era checkpoints (1950–2070)
  with the ledger populated (15–16 goods).
- **Tests.** +7 unit tests pin the accessor contract, incl. the two subtle invariants the
  PR-2 swap must preserve (`drawGood` no-ops on an untracked raw; `seedGoodStock` never
  overwrites). 964 → **971** (incl. #291), tsc clean, vite build green, headless 8-seed ×
  181y all finite.
- **Gotcha.** `stockOf` was already the per-town food/wood trade-market reader — the
  intermediate-goods ledger read is **`goodStock(id)`**.

**Next (PR-2):** per-settlement storage — add `Settlement.goodStocks`, attribute production
per-town (distribute the same totals by sector output), have the supply solver read the
nation-wide *sum* so it stays aggregate-equivalent / byte-identical, serialize per-town +
backfill legacy saves into the capital, and re-check the save-size guard (44 goods × N towns
is exactly what it watches — sparse-serialize non-zero entries). Only after that does
spatial behaviour intentionally diverge (consume-where-produced → ship surplus on routes →
local prices → 44-good catalog).

## Recent session (2026-06-27 pm) — non-asset depth pass (PR #284): trade leg + the two guards + first extraction

User brief: "finish the rest of the non-asset work." Ran a codebase-wide inventory
workflow (8 readers — econ/military/AI/climate/zoning/modularization/UI/perf — +
a synthesizer) to ground-truth the roadmap against the real code, then shipped the
safest, highest-value byte-identical items from the resulting backlog (4 commits on
PR #284; see the status block at the top of this file for the per-commit summary).

**Ground-truth corrections the inventory surfaced (the handoff was stale):**
- The **wall-clock sim catch-up budget is already in `main.ts`** (`runCatchUp`,
  budgetMs≈8, not a 64-tick count) — the gap was the *bench guard* still using the
  old "mean×64" verdict (now re-baselined).
- **`drawBackdrop()` is already wired** into `regionview.ts draw()` (before the
  mapCache blit) — not the gap the roadmap implied.
- **Emergent FX already exists** (`computeExchangeRate` reads trade balance / rates /
  confidence). The real gap is *two competing FX writers* (`tickMonetary` regime path
  vs `tickFX`) — a consolidation, deferred (medium-risk).
- **Phase-14 zoning is scalar state on `RegionSim`**, substantially implemented — NOT
  greenfield; the `zoning-system.ts` grid-map vision is the unbuilt part.
- The sim had **genuine non-determinism** (5 `Math.random()` sites) — now fixed.

### Prioritized non-asset backlog (from the inventory synthesizer — pick up here)

**★ CURRENT TOP PRIORITIES (session 13 — supersede the dated list below):**
0. ✅ **Existential climate response — Phase A of the "world fights back" roadmap (session 13).** DONE — see the session-13 write-up above. Flag `rivalClimateResponse` (default OFF, byte-identical): rival relations sour + war frequency rises with warming urgency for fossil-locked archetypes (real `resource_dispute` CB, no more hardcoded `'fabricated'`/`'border_dispute'` for rival-declared wars), while green-leaning archetypes form autonomous climate coalitions (`rivalClimateBlocs`) that measurably bend `worldEmissions`. Measured: wars 0→22-65/run, outcome split 6dys/2drowned→4d/4dys (more variety, not less). **Tuning constants (`URGENCY_RELATIONS_DRAG` 45, `URGENCY_AGGRESSION_LIFT` 1.5, `CLIMATE_BLOC_*` thresholds) are first-pass — want a human playtest before any default-flip.** **Remaining roadmap (own future sessions, plan file `/root/.claude/plans/async-tumbling-crystal.md` has the full design):** Phase B — military-industrial complex (extend with a literal `electricity`/`fuel` good so "power" becomes fightable-over via the SAME generic scarcity-CB machinery, zero extra CB work); Phase C — multi-continental world (grow the hex grid + real naval combat; riskiest, sequenced last — worldgen determinism + save-version migration for existing saves + O(N²) perf at scale); Phase D — ✓ SHIPPED (session 15): rocketry→satellites ladder + space_program/satellite_network/orbital_station via the existing Wonder/`wonderOwner` pattern, pure data+tests, rivals race them from ~1966. Phase B partially delivered sessions 14–15 (player armamentsCapacity + rival arms base + physical materiel draw); the literal `electricity`/`fuel` good remains open.
1. ✅ **Autoplay state-budget SINK (session 12).** DONE — a government-consumption sink in `monthlyEconomy` (`region.ts`): a proclaimed autoplay STATE spends down `max(0, treasury − gdpLastMonth×1.5) × 0.5` each month (`AUTOPLAY_STATE_RESERVE_MONTHS`/`_GOV_SKIM`), clamped ≥0. Treasury now pins at ~1.5× monthly GDP (headless treas/GDP(mo) 40→~20, stable) instead of climbing. Byte-identical when the flag is off; +2 tests. **This unblocks #2.**
2. **★ flip `autoplayStatehood`+`consumerDemand` DEFAULT-ON (re-baseline).** ⚠️ **Session 13 re-measured: STILL 8/8 drowned** (infl ~4.3–5.4%, treas/GDP ~20mo — the session-12 sink holds; pop 68–88k). The blocker is now clearly a balance-FEEL call, not a treasury bound: 8/8 drowned = no outcome variety. Add a `consumerDemand`-gated variety counterweight (e.g. development/statehood-scaled green-transition boost, byte-identical for default sweep + live play) BEFORE the flip, or accept 8/8 drowned as the stagflation-century intent — either way wants a human playtest. **Worth checking together with #0** — the new climate-bloc mechanic already diversifies outcomes under `rivalClimateResponse` alone; it may partially or fully solve this too once both flags are measured together. With the treasury bounded, turn both flags on by default in `headless.ts` (keep `SIM_*` escape hatches), re-pin the headless markers, re-baseline the outcome split, tune `FINAL_SHORTFALL_OUTPUT_DRAG`/`_INFLATION`, and audit that no snapshot/economy test assumes the old defaults. Wants a human playtest before committing the default flip.
3. OPTIONAL faithfulness: either enforce `requiresNation` in `enactLaw` and make autoplay proclaim a NATION properly (blocked today by the 50%-territory convention gate autoplay reaches only 15–27% of — needs conquest/territory work), or drop the charter law's `requiresNation` flag to match the code's actual state-level enforcement. ⚠️ **Session 13 finding: "enforce it" would BREAK the session-11 autoplay central-bank chain** (autoplay charters at state tier, never nation) — low value either way, likely skip permanently.
4. Leg-2 `RivalNation`↔`RegionalFaction` id-space unification (the multi-session rock). Session 13 note: the dead Phase-16 `resource_denial`/`generateCasusBelli` scaffold is a live example of the cost of NOT having unified id-spaces yet (it silently never fires because `settlement.factionId` and `RivalNation.id` are different spaces) — worth remembering as a concrete case when this rock finally gets tackled.

Order: byte-identical + low-risk + high-value first; deps noted. ✅ = shipped this PR.

**Tier-0 guards (both ✅ this session — they gate everything else):**
- ✅ Fixed-seed full-`serialize()` determinism harness (the byte-identical gate).
- ✅ `bench-region` wall-clock + worst-tick gate.

**Safe wave (byte-identical TRUE, low-risk — ship next):**
1. ✅ **D1-econ trade leg** (supply shock → exports).
2. ✅ **C1: extract `tickPollution`** → `systems/pollution.ts` (first leaf).
3. ✅ **C1: extract `tickServiceCoverage`** → `systems/services.ts` (PR #285).
4. ✅ **D3-ai: situation-aware `DealVerdict`** (PR #285) — `rivalSituation(rv)∈[0,1]`
   (1 while fighting a foreign war), additive `SITUATION_TREATY_BONUS` for protection/
   trade. Byte-identical (0 at peace; `evaluateDeal` is player-initiated only, not in
   the tick/AI path, so headless is untouched). Keyed off foreign-war state (NOT
   relations — that would have moved the existing diplomacy tests).
5. ◑ **D3-ai: agenda legibility** (PR #286) — intel-gated agenda *display* shipped
   (panel shows a rival's agenda only at `intelOf ≥ 0.5`; display-only, byte-identical).
   The structured `AgendaKind` *enum* (prereq for agenda-driven behaviour) is still
   open — note the agenda is already archetype-derived + shown "stated" at spawn, so
   the enum's value is future behaviour, not display.
6. ✅ **D3-ai: tier-asymmetry guardrail** (PR #286) — rival belligerence (hostile
   mischief + tribute ultimatum) now runs through `aggroChance(p) = clamp(p ×
   aiAggression)`, reusing the EXISTING `aiAggression` knob (not a new one). Scales
   the threshold not the draw → byte-identical at the 1.0 default (all tests +
   headless); only easy/hard tiers shift nastiness.
7. **D2-mil: regime-modulated war-support DECAY rate** (`WAR_SUPPORT_DECAY_MULT`, all
   1.0 → no-op now); **Front stub** (`front?:{position}` from `w.score`, write-only);
   **post-war `warScars` record** (pure bookkeeping). All TRUE/low-risk — but pure
   scaffolding (no immediate gameplay change), so weigh value before shipping.
8. **UIUX: era skin via `data-era`**, decompose tooltips (render-only, TRUE).
   ⚠️ **NOT the climate crop-yield drag** — the inventory mis-tagged it byte-identical;
   verified `warmingC` reaches **2.0–4.7 °C by 2100** (not <1.5), so a "zero below
   1.5 °C" drag fires in every run → it's a Tier-2 **re-baseline** balance change.

**Tier-2 (needs re-baseline — own PRs):**
- ✅ **EMERGENT WORLD GREEN TRANSITION — different timelines to 2100 (this session).**
  Autoplay always drowned because all climate levers were player-driven. The rival
  world now decarbonizes by seed-varying archetype propensity (`worldGreenShare`),
  cutting `worldEmissions`/`playerEmissions` and crediting the era verdict → the
  8-seed sweep spreads 5 drowned / 3 dystopia. Deterministic, no new RNG/field.
  Follow-on: archetype-steered building; autonomous rival green-bloc accords.
- ✅ **AI SPATIAL PLAY — rivals build & zone (this session).** Closed the #1 structural
  weak area: every spatial feature was player-only/dormant in autoplay (in fact NO
  faction built regular buildings or zoned districts — only ~5 rival Wonders/run).
  `maybeDevelopRivalTown` (rival-only, human play untouched) now raises terrain-fit
  buildings on bonus-maximizing hexes (`bestPlacementCell`) + zones districts on
  clusters, funded from the surplus above a famine floor (`RIVAL_DEV_RESERVE_MONTHS`
  0.5 mo ≈ 50× the grain draw → no death spiral), aiRng-gated. Healthy re-baseline:
  ~50+ buildings + ~13 districts/run, player markers bounded across 8 seeds.
- ✅ **PERSONALITY-STEERED rival spatial play (two sessions).** `factionBuildLean(faction)`
  — a per-`SectorId` thumb-on-the-scale from regime bloc + tech focus + belligerence (NO
  RNG, NO new serialized field) — now steers ALL THREE rival spatial decisions: building
  choice (`tryBuildRivalBuilding`), **district choice** (`tryZoneRivalDistrict`, cluster
  size then lean), and **expansion siting** (`findBestExpansionSite`, lean→terrain via
  `EXPAND_LEAN_SCALE`). So WHO the rival is shapes WHAT it builds, WHAT it zones, and WHERE
  it settles. Bounded re-baseline, outcomes unchanged (4d/4dys); `tests/rival-development.test.ts` 33.
- revanchism CB + AI war-frequency shift;
  sea-wall overtopping / climate-refugee migration; brownout −30 % industrial output;
  ✅ **Century Graph — SHIPPED (session 13, render-only, NO new serialized field: `statsHistory`
  was already persisted).** `src/ui/centuryGraph.ts` draws the annual GDP/pop/warming/treasury
  history as 4 mini line-charts in BOTH the 2100 Century Report and the live Economy [E] overview.
  Remaining UI follow-ons: live-stats skyline (backdrop tint from live metrics); **consolidate the two FX
  writers** (do after more of C1 lands so `region.ts` is calmer).
- ✅ **PLAYER-FACTION AUTO-DEVELOP in autoplay (this session).** The autoplay player
  held one bare town (0 placed buildings/districts) so the headless balance signal saw
  the spatial economy only via rivals. New public `autoDevelopPlayer` flag (default OFF
  → live human play byte-identical; headless on) lets the player faction reuse the rival
  develop logic, funded from the NATIONAL treasury via a `factionDevPurse`/`spendFactionDev`
  seam (rival path byte-identical). Bounded re-baseline: player builds 10–15/run, pop
  21.6–22.9k, treas 8.9–12.6 mo, infl 2.0%, 4d/4dys. `tests/player-autodevelop.test.ts` (9).
- ✅ **PLAYER AUTO-EXPAND (session 9).** The autoplay player now FOUNDS towns too (new
  `autoExpandPlayer` flag, `PLAYER_TOWN_CAP` 5, default OFF → live play byte-identical; headless
  ON): the rival expansion block became a shared purse-seamed `maybeExpandFaction` (rival path
  byte-identical), the player reuses it from the national treasury. Multi-town nation (pop 61–79k
  vs 21k single-town), satisfaction recovered from 0. Weak area: the multi-town treasury runs
  leaner (0.2–5.6 mo of GDP) because the autoplay player never proclaims statehood.
- **Remaining spatial-AI follow-on:** (a) tune lean magnitudes (`BUILD_LEAN_*`,
  `EXPAND_LEAN_SCALE`, `RIVAL_DEV_RESERVE_MONTHS`) + `PLAYER_TOWN_CAP` after a human playtest.

**★ GLOBAL-WORLD ARC (the headline structural direction — "one global economy; worldwide politics; climate hits everyone"):**
- ✅ **Leg 3 — climate as a shared shock: ALREADY DONE** (verified this session). Warming bites
  every faction's output uniformly — `agriClimateMult` in `updateSectors(t)` (loops all settlements),
  the subsistence `climateDrag`, famine grain from each town's own faction purse. No per-faction exemption.
- ◑ **Leg 1 — world market: SUBSTANTIALLY COMPLETE.** ✅ `worldGoodPrice`/`worldGoodSupply`/`worldGoodDemand`/
  `worldMarketTightness` (`systems/goods.ts`) — ONE clearing price per good across ALL factions' towns;
  `tests/world-market.test.ts` (13); `wMkt%` headless column. ✅ **(a) world-price anchor** — `localGoodPrice`
  reflects WORLD scarcity via a one-sided `eff = localScar + 0.5·max(0, worldScar−localScar)`; byte-identical
  in balanced play, bites under specialisation; `tests/world-anchor.test.ts` (8). ✅ **(b) cross-faction trade** —
  dropped the `playerFactionId` filter so every faction's towns trade at the local/world price, crediting the
  source purse via `addFactionTreasury`; `tests/cross-faction-trade.test.ts` (13). ✅ **(c) the great powers join
  the world market** — off-map `RivalNation`s now tilt `worldGoodDemand` by their war/commerce/climate posture
  (`rivalNetDemandTilt`, ±0.6 cap; derived, pure, no new field); byte-identical economy in balanced play (uniform
  anchor lift → no arbitrage change; on-map stock dwarfs demand → wMkt stays 0), bites under shortage; new
  `worldPowerPressure()` telemetry + `gpP%` headless column; `tests/rival-world-market.test.ts` (18).
  ✅ **(d) WORLD MARKET ACTIVATED — the consumer-demand structural fix (this session).** ★ **ROOT-CAUSE FINDING
  (corrects this whole arc): the world market was dormant NOT because play is "balanced" but because demand is
  STRUCTURALLY MIS-SCALED.** `localGoodDemand`/`worldGoodDemand` counted only intermediate-INPUT demand (normalized
  to sector shares, O(1)/good) with NO final-consumption sink, while production deposits `baseOutput × level`
  units/tick — so the 8 TERMINAL goods (food/clothing/tools/vehicles/machinery/consumer_goods/pharmaceuticals/
  luxury_goods) have ~0 demand, every good oversupplies by ~baseOutput×, stocks accumulate UNBOUNDED (probe seed
  1000 @2100: steel supply 2881 vs demand 1.83 — 1574×), and `worldGoodScarcity = 1 − supply/demand` is pinned at
  0 FOREVER. **No amount of specialisation/war can lift it — the prior "bites under specialisation" claim is FALSE
  for the world market.** FIX: flag-gated CONSUMER-DEMAND model (`r.consumerDemand`, default OFF, NOT serialized —
  the `autoDevelopPlayer` pattern). When on, the world market reads a FLOW signal: this-tick production capacity
  (`baseOutput × level`, from a new transient `r.goodLevels` cache set in `tickIntermediateGoods`) vs an EXOGENOUS
  final-consumption demand (`finalGoodDemand = baseOutput × FINAL_APPETITE` 1.0, level-independent) tilted by the
  great powers. So a supply shock (level<1), a great-power war, or a warming breadbasket FINALLY lifts world
  scarcity. `FINAL_APPETITE` 1.0 = the balanced boundary (scarcity exactly 0 in healthy play, positive under ANY
  stress; a commercial surplus floors at 0). **BYTE-IDENTICAL when off** (all legacy branches verbatim; `goodLevels`
  written-but-unread; nothing serialized) — 1307 tests (1292+15 `tests/consumer-demand.test.ts`), determinism +
  save-size green. **ACTIVATION measured & BOUNDED:** 8-seed×181y headless `SIM_CONSUMER_DEMAND=1` → `wMkt%` from a
  structural 0.0 to a LIVE **3.6–6.7%** that tracks `gpP%` (seed 1042 gpP 7.8%→wMkt 6.7%), while the on-map
  serialized economy is BYTE-FOR-BYTE identical to OFF (only telemetry differs — the world scarcity feeds the
  one-sided price anchor, but on-map towns are uniformly slack → uniform lift → no price gaps → no flow change).
  **Telemetry-only activation: the world SIGNAL is now global & alive; the on-map economy does not yet RESPOND.**
  ✅ **(e) INCREMENT 2 — the per-town final-consumption SINK (session 9). THE ON-MAP ECONOMY NOW RESPONDS.**
  `localFinalGoodDemand` = a town's POP-share of the world final appetite; `tickIntermediateGoods` DRAINS each
  town's stock by it each month, so a town short of a good it doesn't make prices it dear → `localGoodPrice` (which
  now folds in the final demand) → arbitrage ships it in → **REAL on-map flows (8–52/run, was a structural 0)**. Per-town
  `goodsShortfall` drags satisfaction (`GOODS_SATISFACTION_PENALTY` 12); world-aggregate `finalConsumptionShortfall`
  15–22%. All gated on `consumerDemand` (default OFF → byte-identical); TRANSIENT signals (not serialized). Measured
  bounded/solvent.
  ✅ **(f) INCREMENT 3 — the household shortage BITES the macro (session 10). THE STAGFLATION PAIR.** `finalConsumptionShortfall`
  now drags OUTPUT and PRICES too. **Output** (UNgated, `updateSectors`): industry ×`(1 − localGoodsScarcity×0.10 −
  finalConsumptionShortfall×FINAL_SHORTFALL_OUTPUT_DRAG 0.20)`, additive + bounded (never zeroes industry; no spiral — production
  `level` is raw-supply-driven, not output-driven). **Price** (cost-push, `tickMonetary`): inflation target +=
  `finalConsumptionShortfall × FINAL_SHORTFALL_INFLATION 0.15`, CALL-SITE gated on a central bank (region.ts:5784) → bites a
  human/future-statehood nation, not today's central-bank-less autoplayer (forward-wiring, unit-tested). Both 0 when `consumerDemand`
  off → byte-identical. Measured 8-seed×181y: bounded (pop 62–77k, all solvent, fShort 13–22%, no runaway; some drowned→dystopia).
  `tests/consumer-demand.test.ts` now 25 (+4). **STILL DEFERRED (needs the flags to co-occur):** (i) let the autoplay player PROCLAIM
  statehood + charter a central bank so BOTH cost-push channels (increment 3 + the existing `localGoodsScarcity` push) light up in the
  sweep → measurable inflation; (ii) flip `consumerDemand` ON by default (re-baseline; makes increments 2+3 live for humans and lights
  the cost-push where a central bank exists) — wants a human downturn playtest. (`localGoodsScarcity` — the input-stranding index —
  stays 0 because the sink drives FINAL-consumption shortage, not production-input starvation.)
- ◯ **Leg 2 — unify `RivalNation`↔`RegionalFaction` id-spaces: NOT a slice, a multi-session redesign.**
  They are genuinely different entities (off-map great powers w/ archetype+diplomacy vs. on-map territorial AI
  w/ settlements+regime), no shared key. Sequence last; don't bulldoze. With leg 1 substantially done, this is
  the remaining headline rock — but a careful first slice would be a byte-identical read-only BRIDGE (a derived
  correspondence/telemetry), not the full merge.
- **Cross-cutting test debts:** ✅ the SPECIALISATION/coupling stress-probe is substantially covered by
  `goods-prices.test.ts` §3–5 (only a live-`tick()` long-horizon version is missing — see leg-1 NEXT); ✅ the
  flag-ON `autoDevelopPlayer` balance-bound guard shipped in `tests/player-autodevelop.test.ts`.

**Tier-3 (large rewrites, last):** spatial military Front (full resolution rewrite,
new RNG order — needs the Front stub first); **per-settlement goods stocks** — the heart
of making the goods ledger economically real, sequenced: ✅ **PR-1 ledger seam (#292)** →
✅ **PR-2 per-settlement storage (#294)** (ledger now on `Settlement.goodStocks`; production
distributed per-town by producing sector, draws greedy in-order, solver reads the nation-wide
*sum* → byte-identical; per-town serialize via the settlement spread + legacy-pool→capital
migration; save-size guard re-checked, +<2 KiB) → **PR-3 goods consumed/shipped between
towns** (INTENTIONAL DIVERGENCE), itself sequenced: ✅ **slice 1 — "goods ride the rails"**
(trade flows carry real `cargo`: debit source town on dispatch, credit destination on
arrival, severed route strands the real units; dispatch/profit untouched → **macro-neutral**,
headless byte-identical) → ✅ **slice 2 — per-town consume + LOCAL supply level**
(`distributeGoodProduction`: each town makes a good only up to a local-intermediate-input gate,
consuming inputs from its own ledger; nation cascade still drives all macro signals → single-town
byte-identical, cross-sector goods diverge in multi-town nations; **macro-neutral today** because
nothing reads stock magnitudes yet — headless markers byte-identical to base, divergence confined
to the per-town `goodStocks`) → ✅ **slice 3 — per-good local prices + the goods→economy coupling**
(per-town `localGoodPrice` from local stock vs. demand; arbitrage drops the wage-gap proxy and ships
the largest-price-gap good cheap→dear town; a gate-driven nation-wide `localGoodsScarcity` index
feeds cost-push inflation + an industry-output drag. **BUT inert in today's balanced play — markers
BYTE-IDENTICAL to base** [corrects the earlier "markers will move" plan]: the gate-driven index is
0 unless towns SPECIALISE, and autoplay towns are mixed/self-sufficient. Ships the substrate with
zero balance risk; **the macro shift + re-baseline + downturn playtest land once specialisation
exists — spatial Phase C terrain yields is the activator.** "Raws never in `goodStocks`" invariant
kept) → ✅ **slice 4 — activate via specialisation** (Phase C terrain yields MERGED #301;
**spatial Phase D slice 2 — DISTRICTS** [same-sector adjacency synergy via `districtAdjacencyBonus`,
+0.04/neighbour capped at 2] further amplifies specialisation) → ✅ **demand-aware (global) shipping**
(`tickPriceArbitrage` now gathers every profitable cheap→dear opportunity network-wide and dispatches
largest-gap-first with a running stock debit + per-directed-lane cap, so a scarce surplus reaches the
neediest town first and a pair trades both directions; no RNG in dispatch → **byte-identical in balanced
play**, proven by a 4-seed×181y headless diff matching HEAD; 6 tests in `tests/arbitrage-global.test.ts`) →
✅ **placement-time site preview** (`placementPreview`, the green `+N%` legal-hex tint) → ✅ **DISTRICT as
its own placement category** (`DistrictDef` themed zones in `placedDistricts`; `districtZoneBonus` flat +5%
+ 0.05/adjacent-same-sector-building capped 3; **player-only → byte-identical in autoplay**; 16 tests in
`tests/district-zones.test.ts`) → ✅ **per-sector output-bonus BREAKDOWN** (the spatial "why": public read-only
`sectorBonusBreakdown(townId,sector)` decomposes the bonus into buildings/terrain/terrainMatch/districtAdjacency/
districtZone/wonder; `buildingBonus` refactored to return a `sectorBonusParts` single-source-of-truth `.total` with
the add-order preserved → **bit-identical**, a test asserts `total === buildingBonus` with `toBe`; Economy-tab `+N%`
badge + decomposing tooltip, render-only; 8 tests in `tests/sector-breakdown.test.ts`) →
✅ **placement preview counts the district-ZONE lift** (the building `placementPreview` gained a
`zoneBonus` field = marginal `districtZoneBonusFrom` delta, so a same-sector building sited beside a
zoned district now shows the +0.05/adjacent-building reward it gives that district, cap-aware;
`districtZoneBonus` refactored to a shared pure `districtZoneBonusFrom(districts,buildings,sector)`
core with the empty-districts early-return preserved → **live byte-identical**; pure preview → byte-identical;
5 new tests in `tests/placement-preview.test.ts`) →
44-good catalog (current is the 16-good MVP-18 tier); E2 R/C/I/O demand + land-value grid maps (trips the
save-size guard by design); `drawBackdrop` parallax compositing. **NB the whole goods coupling is DORMANT
in autoplay** (`localGoodsScarcity`==0 every seed — towns specialise via terrain yields but stay
self-sufficient) → making it BITE is a deliberate balance re-baseline, deferred until a human downturn playtest.

**Dependency rules:** the determinism harness (✅) precedes every "byteIdenticalSafe"
claim; `bench-region` (✅) precedes large `region.ts` cost; **continue C1 leaf
extractions before the big D1-econ goods/price/FX features** (they add hundreds of
lines — land them in `systems/`, not the 14k-line monolith). ✅ `tickPollution`
(`systems/pollution.ts`), ✅ `tickServiceCoverage` (`systems/services.ts`), ✅
`tickPriceArbitrage`+`computeCongestionTariff` (`systems/arbitrage.ts`), and ✅
`tickIntermediateGoods` (`systems/goods.ts`) are all extracted. **The goods system has a home
outside the monolith, and ✅ PR-3 slice 2 (the per-town supply solve, `distributeGoodProduction`)
was written *there*.** The ledger accessors (`produceGood`/`drawGood`/`seedGoodStock`/`goodStock`/
`addGoodStock`/`shipGoodFrom`) + the raw proxy (`rawSupplyLevel`/`sectorRawLevel`/
`advanceSectorOutputNorms`) stay on `RegionSim` beside the per-town `goodStocks` store; slice 3
(per-good prices) builds on the per-town ledger slice 2 now maintains.

## Recent session (2026-06-27) — supply shock → cost-push inflation: the stagflation half (D1-econ)

The graded supply chain could *drag output* (`supplyShockMult`, ≤15% industry bite) and
trigger two secondary effects, but a shortage's other half — **dearer goods** — was
missing. The 1973 oil shock cut production and exports yet never touched prices; it read as
a plain recession, not the stagflation it was. This session wires the **"prices" leg** of
the handoff's D1-econ next step ("make goods read into the economy — GDP, prices, or trade").

- **The mechanic.** `tickMonetary()`'s inflation target gains a cost-push term:
  `inflTarget += supplyShockSeverity() × SUPPLY_SHOCK_INFLATION` (gain **0.30**, in
  `region.ts` beside `SUPPLY_SHOCK_MAX_DRAG`). `supplyShockSeverity()` is the *same* signal
  the output drag reads — how far supply health has fallen **below the era-structural
  baseline** — so it is **exactly 0 in all healthy play** (raws flowing → actual == baseline).
  The term is therefore +0 there and the whole monetary RNG stream stays byte-identical;
  only a genuine cascade lifts prices. No new serialized field, no new RNG (severity is a
  pure no-RNG read), one-month price lag (tickMonetary runs before tickIntermediateGoods in
  the tick, reading last month's cached `supplyChainHealth`).
- **Calibration.** Partial oil embargo (`OIL_EMBARGO_CUT` 0.6) → severity 0.15 → +4.5pp to
  the target → inflation peaks ~4.5–4.8% over the window (from a 2% base); a total cut →
  severity 0.25 → ~6.7%. Hard-capped by the existing 0.50 inflation ceiling. **Bounded and a
  pure sink:** inflation feeds confidence/GDP but never sector output → the raw proxy, so it
  *cannot* reinforce the shortage that caused it (verified: `currencyEfficiency`/
  `economyOutputMult` don't read inflation). Non-divergent by construction.
- **Verified end-to-end.** Unit suite `tests/supply-cost-push.test.ts` (6: inert-in-healthy,
  push-vs-control, severity·gain closed form, scales-with-severity, 0.50-cap, heals). Real
  tick-loop probe (seed 42, forced 1974 oil embargo): inflation 2.00% → **4.50%** peak →
  mean-reverts to 2.01% by 1994 as the chain heals; GDP 19.6k → 39.6k and pop 2.0k → 4.6k
  grow straight through — **no spiral**. 8-seed × 181y headless: all finite, all end at 2.0%
  inflation (fully healed). **906 → 926 tests**, tsc clean, build green.
- **UI.** Supply tab headline now reads both halves of a shock: `industry −X% · prices +Y.Ypp`
  (the price line gated on `hasCentralBank()`, since that's what realizes the push).

**Next on the economy (D1-econ):** two legs of "GDP, prices, trade" remain. **Trade** is the
natural next one — a shortage should also choke *exports* (a nation short on fuel/components
has less to sell), and the oil embargo already cuts export earnings via the depression path
but not via the supply chain; route `supplyShockSeverity()` into `exportEarningsLastMonth` in
`monthlyEconomy` the same byte-identical way (severity 0 → ×1). Or deepen **GDP**: today the
chain only *drags* industry on a shock — nothing reads the *positive* breadth of a healthy
goods mix into output. Or the bigger items: physical goods on routes, per-good prices, the
full ~44-good set (current is the 16-good MVP-18 tier). Or pick up `C1` (region.ts is 14k
lines; `supply.ts` is the free-function template).

## Recent session (2026-06-26) — graded raw availability: ordinary shortages bite (D1-econ)

The cascade + the GDP drag + the MVP-18 DAG + the oil shock all shipped, but the
raw proxy was still **binary** — a raw flowed iff its extracting sector's output
was >0, so the chain only moved on an *embargo* or a *total* sector shutdown.
This session makes raw availability **fractional**, in two layers (the user
explicitly chose "both, in that order"; each landed + verified before the next).

- **Phase 1 — graded solver + partial oil shock (byte-identical in healthy play).**
  New `resolveSupplyChainGraded` in `supply.ts`: each raw reports a *level* in
  [0,1]; a good's level is the **min over its inputs** (Liebig's law of the
  minimum), health is the **mean** level. It strictly generalises the boolean
  solver — when every raw is 0 or 1 the mean equals supplied/active and the
  sets are identical, so wiring it in is byte-identical in every all-or-nothing
  scenario (all current play). `rawEmbargoes` gained a `cut` fraction
  (`{ until, cut }`, old numeric saves migrate to `cut:1`), and the 1970s oil
  anchor now cuts oil **partially** (`OIL_EMBARGO_CUT = 0.6`) — oil → fuel →
  trucking/plastics run at 40% for the window, a more historical 1973 than a
  total shutoff. Stock ledger produces `baseOutput × level`; secondary effects
  (plague/research-slow) scale their RNG draw by the shortfall, so a full cut
  keeps the exact pre-graded draw and healthy play draws nothing.
- **Phase 2 — graded extraction proxy (intentional, bounded balance change).**
  Each extracting sector keeps a trailing EWMA output norm (`sectorOutputNorm`,
  serialized). `sectorRawLevel` grades off output/norm: ≥ norm (steady/growing)
  → full 1.0, so healthy play stays byte-clean and the whole suite is unperturbed;
  a contraction below the deadband (0.9) grades the raw toward MIN_LEVEL (0.35)
  at the floor (0.5). The norm chases output, so the drag fires on the *transition*
  into a downturn and heals — it bites the shock, not the steady state. Feedback
  is damped on three axes (floor never 0, 1-month-lagged mult, 15% max drag), so
  the loop is non-divergent (verified across 8 seeds × 181y in the headless sim).
- **Tests:** graded-solver unit tests (boolean-equivalence, Liebig min, clamp,
  cycles) + partial-embargo + graded-proxy + migration coverage. **890 → 906.**
  tsc clean, full suite green (determinism/save-size/economy-balance still in
  range), build green.

**Next on the economy (D1-econ):** the goods are STILL an **abstract layer** —
stocks feed only `supplyChainHealth` (→ the drag) + the two secondary effects;
nothing reads them into GDP, prices, or trade. That's the remaining depth step
(make goods *do more* economically). The graded plumbing (levels per good, a
`cut` per embargo, per-sector norms) is now the substrate to build real
consumption/prices on. Or pick up `C1` (region.ts modularization) — `supply.ts`
+ the `supply*` / `rawSupplyLevel` / `sectorRawLevel` methods are the template.

## Recent session (2026-06-26) — the oil shock animates the chain + a Supply UI (D1-econ)

The DAG (#278) deepened the graph but the cascade still only fired on a *total
sector shutdown*, and the supply chain had **zero UI**. This session makes the
chain matter in ordinary play via the GDD §5.4 anchor and makes it legible.

- **Oil shock → supply cascade.** A new transient embargo ledger
  (`rawEmbargoes: Record<raw, untilDay>`) cuts a raw at the root for a window. The
  1970s oil-shock anchor now stamps `oil` for `OIL_EMBARGO_DAYS` (180d ≈ the 1973
  embargo). `fuel` (← oil) and the fuel-burning finals — **vehicles, machinery,
  consumer_goods** (GDD §5.4 "trucking, plastics") — now take `fuel` as an input,
  so the cut cascades oil → fuel → those three (4/16 goods → health 0.75 →
  ~3.75% industry drag for the window). "The oil shock isn't a popup."
- **Byte-identical in healthy play.** `fuel` always flows when oil does, so the
  three finals stay supplied and the era baseline is unchanged — the drag is still
  exactly 1.0 with no embargo. Only a real oil cut bites. The embargo ledger
  serializes (backfills `{}` on old saves) and prunes expired entries each tick.
- **Economy → Supply tab.** `supplyChainSnapshot()` (pure read; reuses the
  extracted `rawSupplyAvailable` predicate) drives a new tab: health bar + live
  industrial drag, an **OIL EMBARGO** banner with countdown, the GDD §5.4
  critical-goods dependency board (food/fuel/steel/components → their raws), and a
  disrupted-first per-good status grid. Screenshot-verified in a 2018 dev save.
- **Tests:** `tests/oil-shock-chain.test.ts` (12 — cascade, bounded drag, expiry,
  anchor wiring, persistence, snapshot purity). tsc clean, **890 tests**, build green.

**Next on the economy (D1-econ):** the raw proxy is still **binary** for the
*untouched* raws (a raw flows iff its sector's output > 0). The complementary move
is **(a) graded raw availability** — a per-raw ratio (extraction/imports vs. demand)
so ordinary shortages drag output, not just embargoes/total collapse. And the goods
are still an **abstract layer**: nothing reads stocks into GDP/prices/trade yet.

## Recent session (2026-06-26) — supply-chain DAG → GDD §5.2 MVP-18 goods set (D1-econ)

With the cascade (#276) and the GDP drag (#277) merged, the graph itself was the
shallow part: only the 5-good intermediate tier, so a raw shock had little to
cascade through. Laid the GDD §5.2 named set as a proper **primary → intermediate
→ final DAG** (16 manufactured goods), byte-identical to the economy.

- **`INTERMEDIATE_GOODS` 5 → 16:** adds `lumber, steel, textiles, fuel,
  electricity` (intermediate) and `food, clothing, tools, machinery,
  consumer_goods, luxury_goods` (final). The original five keep their **exact**
  recipes/eras, so the cascade + the pharma→disease / electronics→research
  effects are unchanged. Now a coal outage cascades through steel/chemicals/
  electricity → components → vehicles/electronics/machinery/consumer_goods; an
  iron outage takes the iron branch; copper still confines to electronics (+ its
  lone dependent luxury_goods).
- **Primary raws split by extracting sector:** `AGRICULTURAL_RAWS` (grain,
  livestock) proxy off **agriculture** output; `EXTRACTIVE_RAWS` (wood/coal/iron/
  copper/oil/stone) off **industry**. coal/iron/copper behaviour preserved
  exactly. In healthy play both sectors produce → every raw flows → every good
  supplied → health at its era baseline → drag stays exactly 1.0. The chain still
  switches on in 1920, so the 1919 founding year keeps an empty graph.
- **Determinism:** a 5-seed × 9-epoch golden of the macro economy (GDP, treasury,
  pop, inflation, confidence, FX, leverage, debt) is **byte-identical** — the
  richer graph moves only the supply-*health* metric at era boundaries, never the
  economy in healthy play. tsc clean, **878 tests** (phase15/supply/supply-shock
  updated for the new graph), bench-region PASS (60fps), build green.

**Caveat for the next agent:** the goods are still an **abstract layer** — stocks
feed *only* `supplyChainHealth` (→ the drag) + the two secondary effects; nothing
reads them into GDP, prices, or trade. And the raw proxy is binary (a raw flows
iff its sector's output > 0), so the drag still only bites on a *total sector
shutdown*. The expansion is the DAG groundwork; making it *matter in ordinary
play* is the next move (below).

## Recent session (2026-06-26) — supply-shock output drag: the cascade now bites GDP (D1-econ) · PR #277 (merged)

The PR #276 cascade was *correct* but *inert to the economy*: `supplyChainHealth`
was computed + serialized yet never consumed, so a raw collapse slowed research /
raised disease but left industrial output — and GDP — untouched. This session
wires it in, the way the prior baton flagged: a **small, bounded, era-baselined**
drag on the **industry sector** only.

- **The era-baselining is the whole trick.** `supplyChainHealth` dips below 1.0
  even in perfectly healthy play whenever a good unlocks before one of its
  intermediate inputs (vehicles unlock 1925 but need components, which unlock
  1930 → health 0.5 across 1925–1929). A naive `output *= health` would tax that
  window and perturb the early game / balance suites. Instead the drag scales with
  how far **actual** health falls *below the era-structural baseline*
  (`resolveSupplyChain(GOODS, year, () => true).health` — what health *would* be
  with every raw flowing). In healthy play actual == baseline → severity 0 → mult
  **exactly 1.0** → byte-identical (verified: a 5-seed × 9-epoch golden snapshot of
  GDP/treasury/pop/… is unchanged; `region-longrun` determinism + `save-size`
  guards green).
- **`region.ts`:** `SUPPLY_SHOCK_MAX_DRAG = 0.15` (a *total* collapse trims industry
  15%, never zeroes it — so the drag can't starve the raw proxy and spiral);
  `supplyShockSeverity()` (era-baselined shortfall, 0..1) + `supplyShockOutputMult()`
  (in `[0.85, 1]`); `tickIntermediateGoods()` caches the mult the same month it
  sets health (so actual + baseline share a `year` — computing it later, after a
  Jan year-roll, fabricated a phantom shock at era boundaries; that was the one bug
  the golden diff caught); `updateSectors()` multiplies **industry** output by it.
  The mult is a transient cache (derived from the serialized `supplyChainHealth`),
  read one month later by `updateSectors` — a realistic lag, no new save field.
- **`tests/supply-shock.test.ts`** — 11 tests: no-drag across the 1925–29 boundary
  despite health 0.5 (the baseline proof), total collapse → 0.85 floor, partial
  copper-cut → 0.97, industry-only integration, old-save backfill shows no shock.
  **864 → 875.** Verified: tsc clean, bench-region PASS (60fps), vite build green.

**Next on the economy (D1-econ):** the drag only fires on a *total* industry
shutdown (the raw proxy is binary: raws flow iff total industry output > 0), so
it models catastrophe, not friction. A graded raw-availability proxy (per-raw,
scaled by mining/imports) would let ordinary shortages bite too. Then the GDD's
5→44 goods expansion (current set is only the intermediate tier; new recipes drop
straight into `INTERMEDIATE_GOODS` and flow through the existing solver) and
physical goods on routes (transit × congestion). Or pick up `C1` (region.ts leaf
modularization) — `supply.ts` is the template.

## Recent session (2026-06-26) — supply-shock cascade for intermediate goods (D1-econ) · PR #276 (merged)

Closed a real correctness gap in the Phase-15 intermediate-goods economy: shocks
did **not** propagate. The graph (`coal/iron/copper → chemicals → components/
pharmaceuticals → electronics/vehicles`) buffered each good's stock without bound
(output ≫ the 1-unit/tick consumption), so once a good primed, its buffer fed
downstream forever — a raw-material outage never reached dependents and the GDD
§5.2 cascade ("no chemicals → no pharmaceuticals → health crisis") was dead.
`supplyChainHealth` + the electronics/pharma disruption flags only ever reacted to
a good's *own direct* inputs.

- **`src/sim/supply.ts`** (new, pure, no-RNG/no-IO, unit-tested in Node):
  `resolveSupplyChain(goods, year, rawAvailable)` → `{active, disrupted, supplied,
  health}` — a deterministic topological pass where a good is supplied iff its
  whole upstream chain is intact. Cycle-safe (transitive self-dependency → unmet,
  no infinite loop); queries the raw-availability predicate **only** for raw
  materials (intermediates resolve recursively). Plus `rawMaterialsOf()`.
- **`region.ts` `tickIntermediateGoods()`** delegates the health + disruption-flag
  derivation to the solver. The **stock ledger** (produce `baseOutput`, draw down
  inputs) and the **random secondary effects** (plague roll, research-slow log)
  are unchanged, in the **same RNG order** — determinism preserved by construction.
  Net −8 lines.
- **Behaviour:** healthy play is byte-identical (industry keeps raws flowing → no
  disruptions either way → identical RNG stream; all long-run/balance/anchor/
  climate integration suites pass untouched). The cascade only bites in a genuine
  raw collapse (deep depression / wartime industry shutdown) — then a coal outage
  correctly slows research (−10%) and raises disease risk across the *whole*
  downstream chain.
- **`tests/supply.test.ts`** — 18 tests: era gating, per-raw outage isolation
  (coal→all 5; iron→iron branch; copper→electronics only), deep-chain + cycle
  robustness, predicate-only-for-raws, and an integration test proving a
  downstream good no longer free-rides on buffered upstream stock once its input
  is cut. Verified: tsc clean, **864 tests** (18 new), `bench-region` PASS (60fps),
  vite build green.

**Next on the economy (D1-econ):** `supplyChainHealth` is computed + serialized
but still **not consumed by output** — wiring it into industrial output is the
obvious follow-up, but note health dips below 1.0 even in healthy play at each
good's unlock (e.g. vehicles 1925 needs components 1930 → health 0.5 in 1925–30),
so a naive `mult = f(health)` would perturb the early-game balance; baseline or
gate it. Then the GDD's 18→44 goods expansion (chemicals/components/electronics/
pharma/vehicles is only the intermediate tier) and physical goods on routes.

## Recent session (2026-06-26) — manifest-driven generator for the LIVE 4X slots (A1)

Closed the gap where the asset pipeline couldn't target the slots the shipping
game actually overrides. `scripts/hf-sprites.ts`'s catalog is for the **dropped**
town engine (`public/sprites/`); the live `AssetRegistry` slots (`town-<tier>`,
`backdrop-<era>`) and the audio manifest had **no generator**. Added:

- **`src/data/assetCatalog.ts`** (type-checked, unit-tested, no network/fs):
  `LIVE_ASSET_CATALOG` — the 6 town tiers (mirroring `townSpriteTier`) + 5
  backdrop eras (mirroring `eraIdForYear`), each with a tuned prompt (backdrop
  palettes echo `ERA_SKY` so generated art and the procedural fallback read as
  the same era). Plus the pure `mergeManifestItems(existing, incoming)` (replace
  by slot, preserve others, sort — diff-friendly manifest).
- **`scripts/hf-assets.ts`** — thin CLI + HF I/O over the catalog: writes PNG
  bytes straight to `public/assets/` (HF returns PNG the registry loads directly,
  **so sprites/backdrops need no encoder**), sha256s them, and `mergeManifestItems`
  into `asset_manifest.json`. `--dry-run` / `--slots` / `--category` / `--era`
  filters; `npm run hf-assets`. Generated PNGs are **gitignored** (hybrid
  distribution = Release packs, not git blobs); committed manifest stays empty →
  procedural fallback. Verified: tsc clean, **829 tests** (8 new), dry-run +
  all filters exercised offline, build green.

**⛔ Generation is blocked by network egress, not the token.** The user supplied a
valid `HF_TOKEN`, but this web env's egress policy **403s `huggingface.co`** (agent
proxy `CONNECT tunnel failed, response 403`), and the HF MCP `dynamic_space`
**invoke** path is disabled (`gradio=none`) — only discover/inspect work. So no
assets can be generated *from here*. To actually generate: run
`HF_TOKEN=… npm run hf-assets` **locally**, or re-provision the web env with a
network policy that allowlists `huggingface.co`. The catalog/generator/manifest
plumbing is all ready and dry-run-verified; only the egress step remains.
*(Audio stem generation additionally needs an OGG encoder — `sharp`/`ffmpeg`
absent here too.)*

## Recent session (2026-06-26) — save-size regression guard (Risk #5)

Added the roadmap's **Risk #5** guard ("Phase-14 save bloat → a save-size
regression test"), `tests/save-size.test.ts`. Measured today's `serialize()`
footprint and locked it in: **~22 KiB at founding**, plateauing at **~82 KiB
across a century and beyond** (2009 ≈ 2100 ≈ 2128 — the log-bearing fields are
capped, so accumulation is bounded, not linear in elapsed time). The guard
asserts an early ceiling (<64 KiB), a century ceiling (<192 KiB, generous
headroom), non-ballooning past the century (+110 more years < 2× the +90 size),
and **no round-trip expansion** (save→load→save doesn't grow — a field that
duplicated each reload would balloon localStorage past its ~5 MB cap). The
upcoming Phase-14 per-settlement grid maps are the obvious bloat risk this
catches before it reaches a user's save. Verified: tsc clean, **825 tests** (4
new). *Finding:* a reload re-serializes ~0.9% **smaller** — benign, the
`?? default` backfill omits stored defaults on the re-dump (not a bug).
## Recent session (2026-06-26) — wall-clock-budgeted sim catch-up (Track D)

Closed the **`main.ts:274` frame-budget gap** the roadmap's Track D called out:
the loop drained up to a *fixed 64 ticks* per frame, but ticks aren't uniformly
cheap — the monthly/yearly economy spike is a ~10–14 ms single tick (per
`bench-region`). A cluster inside one frame blew the 16.7 ms budget and stuttered
regardless of the count. Now the drain is **budgeted by wall-clock**: tick until
~8 ms is spent (or the backlog clears, or a hard 240-tick ceiling), then yield —
a heavy tick can't blow the frame; the calendar simply lags a frame and catches
up, which is invisible next to a dropped frame.

- **`src/ui/simLoop.ts` `runCatchUp(acc, tick, now, opts)`** — pure and
  side-effect-free except through the injected `tick`/`now` callbacks, so it
  unit-tests with a **fake clock** (no AudioContext/canvas/RAF). Returns
  `{acc, ticks, budgetBound}`; the time check is *after* each tick so one
  over-budget tick completes but no further tick starts (overrun bounded to one
  tick). Carried backlog is clamped to `maxBacklog` so a sustained budget-bound
  stretch can't spiral into ever-growing catch-up debt.
- **`main.ts` loop** swaps the `guard++ < 64` while-loop for `runCatchUp(...,
  { budgetMs: 8, maxTicks: 240, maxBacklog: 240 })`, preserving the
  `ceremonyOpen` tick-skip. Verified: tsc clean, **829 tests** (8 new,
  fake-clock), `bench-region` PASS (60fps), vite build green.

## Recent session (2026-06-26) — audio stem override seam (`AudioRegistry`)

Built the **audio half of the asset pipeline** — the sibling of `AssetRegistry`
(#265, art) and the `backdrop-<era>` slot. `src/ui/audio/audioRegistry.ts`
`AudioRegistry` loads recorded stems listed in `public/audio/audio_manifest.json`,
decodes them on a live `AudioContext`, and serves them by slot with **procedural
fallback** — so the whole WebAudio soundtrack keeps playing with real stems
layered on, or (the shipped default, empty `items`) entirely without them.
Verified: tsc clean, **826 tests** (5 new), `bench-region` PASS (60fps), vite
build green (manifest ships in `dist/audio/`), and a **real-Chromium probe**
confirming the shipped manifest resolves all 6 era slots with **`anyLoaded:false`**
→ byte-identical procedural playback.

- **Pure helpers (unit-tested in Node):** `musicStemSlot(year)` / `ambienceStemSlot(year)`
  → `music-<era>` / `ambience-<era>`, in lockstep with the music engine's
  `eraForYear` so the recorded bed and the synth turn over on the same windows.
  Era ids: ragtime · chipjazz · midcentury · analog · electronica · future.
- **`AudioRegistry`** mirrors `AssetRegistry` exactly: `load(ctx, dir='audio')`
  fetches the manifest, fires an independent fetch→`decodeAudioData` per stem
  (one bad stem never blocks the rest), `get`/`has` by slot. **Buffers are bound
  to the context they decode on**, so music and soundscape each own an instance.
- **Wired into `Music` (`music.ts`):** `setStems(reg)` attaches it; `updateStem()`
  (called from `update()`) crossfades the `music-<era>` bed in on the **same
  master gain**, swapping beds at era turnover (0.3s fade, no click) and **ducking
  by intensity** — the recording owns the calm mix, the procedural kit rises with
  tension so they never pile up. `main.ts` constructs the registry and calls
  `music.setStems(...)`. No stems loaded → `updateStem` is a no-op → unchanged.

**Ambience beds — done (this branch).** `Soundscape` now owns its **own**
`AudioRegistry` instance (a second one — buffers can't cross contexts): `setAmbience(reg)`
attaches it, and `updateBed()` (called from `update()` after the master ease,
before the pause return) loops the `ambience-<era>` bed under the diegetic events
on the **same `masterGain`** (so pause/disable already silence it), swapping beds
at era turnover with a 0.4s fade. `main.ts` calls `soundscape.setAmbience(...)`.
No beds → no-op → unchanged. Verified: tsc clean, 826 tests, bench PASS, build
green, Chromium probe — all **12** era slots (music + ambience) resolve from the
shipped manifest with `anyLoaded:false`.

**Next on audio:** **bulk generation** of the actual stems — still blocked on
`HF_TOKEN` (unset in web env) **+ an encoder** (`sharp`/`ffmpeg` not installed);
provision those before generating. Every audio change stays gated by
`scripts/bench-region.ts`.

## Earlier session (2026-06-26) — per-band parallax + horizon glow

Extended `src/ui/backdrop.ts` to the **two follow-ups the prior session flagged**
as next: true independent per-layer parallax, and a stat-driven horizon glow.
Verified: tsc clean, **821 tests** (6 new), `bench-region` PASS (60fps held, all
stages), vite build green, and a real-Chromium smoke render across 5 states
(dawn/crisis/solarpunk/storm, including a ±9999px extreme pan) reporting
**0.000% void gap** everywhere and a correctly-tinted horizon (crisis → red 255
ember, solarpunk → green-forward, storm → dim/desaturated).

- **Per-band blits (replaces the single composite gradient):** `Backdrop` now
  paints **one strip canvas per band** (`BandStrip`), each oversized by the 96px
  `MARGIN` bleed so the gradient's clamped end-colours flood the top/bottom and a
  parallax offset slides into matching colour — never a void. `draw()` blits them
  **back-to-front** (distant first), each offset by its **own** `band.parallax`
  fraction of `camX/camY`, so distant bands genuinely lag and near bands track —
  real per-layer depth, not one shared drift. Nearer bands paint over the seams.
- **Stat-driven horizon glow:** new pure `buildHorizonGlow(inputs)` → a
  `BackdropGlow {y, color, intensity}` carried on the palette (no new cache keys —
  it reads era/branch/sky/tension, all already keyed). Calm = faint dusk warmth,
  tense = amber unease, crisis = a **red ember** (overrides any branch tint). A
  calm *future* sky keeps its branch's signature light (solarpunk cyan-green,
  dystopia sodium-amber, drowned cold). Heavy weather smothers the bloom. Drawn
  per-frame as an **additive** (`globalCompositeOperation:'lighter'`) radial
  centred on the horizon, drifting with the near-sky parallax (`GLOW_PARALLAX`).

**Next on the backdrop:** real painted `backdrop-<era>` art once the asset
pipeline has `HF_TOKEN` + an encoder (the override seam already composites it on
top with the same parallax). Sample-stem music / ambience beds
(`audioRegistry.ts`) remain the other half of the atmosphere layer.

## Earlier session (2026-06-26) — parallax atmosphere backdrop (`drawBackdrop`)

Landed the first **Track-B atmosphere layer**: `src/ui/backdrop.ts` — the 5-band
parallax sky that fills the void the terrain cache leaves at the map margins (and
the whole frame when zoomed out), replacing the flat `#10141c` fill. Verified:
tsc clean, **815 tests** (10 new), `bench-region` PASS (60fps held), vite build
green, and a real-Chromium smoke render (clean multi-band gradient, gap-free).

- **Pure core (unit-tested in Node, like `registry.ts`):** `eraIdForYear` (sky
  era windows mirroring the music engine), `statBand` (tension → calm/tense/
  crisis), and `buildBackdropPalette({year, seasonIndex, branch, sky, tension})`
  → 5 depth-ordered bands (rising `parallax`) + a cache `key` + an override
  `slot` (`backdrop-<era>`). Every output is a pure read — no RNG, no save state.
  Era × season × era-branch × weather × tension each shift the colours (branch
  *repaints* the future sky: solarpunk cyan-green, dystopia smog-amber, drowned
  grey-blue; crisis reddens the horizon; storm darkens; winter desaturates).
- **DOM `Backdrop` class:** offscreen gradient re-painted only when the palette
  `key` changes (oversized by a 96px `MARGIN` so the parallax offset never
  exposes an edge); `draw()` blits it in **screen space before the camera
  transform** with a gentle pan-fraction parallax. If `AssetRegistry` holds the
  `backdrop-<era>` slot, a painted sky composites on top — the same procedural-
  fallback discipline as town sprites.
- **Wired in `regionview.ts`:** new `drawBackdrop(W,H)` called right after the
  base fill in `draw()` (screen space, behind the terrain blit). Note: the
  HANDOFF plan said "inside the camera transform / world-space"; screen-space is
  correct here — the terrain cache covers world-space opaquely, so the backdrop
  must sit in front of the void fill but behind the (camera-transformed) map, and
  parallax is a fraction of `camX/camY` applied at blit.

**Next on the backdrop:** per-band blits (true independent parallax per layer,
the data model already carries `band.parallax`); a stat-driven horizon glow /
"skyline" cue; then real painted `backdrop-<era>` art once the asset pipeline has
`HF_TOKEN` + an encoder. Sample-stem music / ambience beds (`audioRegistry.ts`)
remain the other half of the atmosphere layer.

## Earlier session (2026-06-26) — deep-expansion foundation (PRs #264, #265 merged)

Kickoff of the **"1GB" deep-expansion roadmap**: a performance-gated two-track effort —
simulation depth + an AI-generated asset pipeline toward a ~1GB production build. The full
roadmap is the **"Deep-Expansion Roadmap"** section below (folded into this doc so it persists
across sessions). Two foundation PRs merged to `main`, each verified (tsc clean, **805 tests**,
vite build green):

- **#264 — dynamic audio tension + 4X perf guard + restored headless.**
  - `RegionSim.tensionScalar()` (region.ts, just after the `dateLabel` getter) returns a 0–1
    scalar from `playerWar.support` / `maxGrievance` / `depressionDepth`, now fed to
    `music.update` + `soundscape.update` in `main.ts`. **The `tension` input was previously
    hardcoded to `0`**, so the audio engine's dynamic mixing was dead. Pure read (no RNG) —
    save/load determinism preserved.
  - **`scripts/bench-region.ts`** — the perf guard the shipping 4X game lacked. (The old
    `bench-scale.ts`/`bench-agents.ts` benched the **dropped town engine** — `Simulation`/
    `AgentStore`/`FlowField` — not `RegionSim`; both were removed in the backdrop PR since the
    modules they imported no longer exist.) This benches `RegionSim.tick()` at
    early-colony / mid-nation / late-nation against the 16.7ms / 64-tick frame budget, reporting
    mean **and worst-case** ms/tick. Baseline: mean ~0.003–0.007ms (64-tick frame ~0.2–0.4ms),
    worst single tick ~10–12ms (the monthly/yearly spike — the stutter to watch). **This is the
    60fps-at-all-stages gate; run it on every perf-sensitive change.**
  - **`src/sim/headless.ts`** restored — `npm run sim` pointed at a missing file. Long-run
    balance harness: ticks to a target year, reports treasury/GDP, inflation, pop, satisfaction.

- **#265 — live asset-override seam for the 4X map (`AssetRegistry`).**
  - **The override seam was dormant:** `buildSprites()`/`applyOverrides()` (`spriteOverrides.ts`)
    were only used by `sprites-preview.ts`, never by the live `RegionView` (which drew its own
    procedural glyphs). Now `src/ui/assets/registry.ts` `AssetRegistry` loads PNG/WebP listed in
    `public/assets/asset_manifest.json`, served by slot name with **procedural fallback**.
  - `RegionView` builds the registry, loads the manifest on construction, and `drawTownTier`
    draws a `town-<tier>` override when present (`townSpriteTier` / `TOWN_TIER_PX`), else the
    existing procedural shack→castle art. **No manifest items (the shipped default) = byte-identical
    behaviour**; generated/hand-made art slots in per population tier with zero code change. This
    is the integration point the AI asset pipeline and modders both target.

**Stale-doc corrections** (verified in code this session): the 4X boot path is
`index.html → src/main.ts → new RegionView` (there is no `core.html`/`coreview.ts`); `npm run sim`
is restored; the audio `tension` is wired; Phase 15 (FX) and Phase 16 (Warfare, ~80%) are genuinely
landed — **extend, don't rebuild**; Phase 14 (zoning/city-services) and the 5 parallax backdrop bands
are the real gaps.

**Next session — asset pipeline (integration seams already mapped; code-only, procedural fallback):**
- Parallax **`drawBackdrop()`**: insert in `regionview.ts` `draw()` just **before** the
  `g.drawImage(this.mapCache, 0, 0)` blit (~line 646, inside the camera transform → world-space);
  composite to an offscreen canvas keyed by era/season/stat-band, blit + parallax-offset per frame.
- **Sample-stem music**: attach in `Music.update()` (`music.ts`) beside the procedural synth on the
  same `master` gain; `eraForYear()` selects the era; crossfade by `intensity` (already tension-driven).
- **Ambience beds**: attach in `Soundscape.update()` after `ensure()`; loop under the diegetic events.
- New `src/ui/audio/audioRegistry.ts` + `audio_manifest.json` mirror `AssetRegistry`. **Bulk generation
  needs `HF_TOKEN`** (unset in the web env) **+ an encoder** (`sharp`/`ffmpeg` not installed) — provision
  those first. Every render/sim change stays gated by `scripts/bench-region.ts`.

## Deep-Expansion Roadmap — "The 1GB Simulation"

The forward plan: make Centuria a *much larger* game (~1 GB) — AAA-scale depth **and** production
value — while it stays smooth (60 fps, no stutter) at every stage. Size can only come from real
assets (the game is ~2.9 MB of code + 100 KB JSON with **zero binary assets** today; all art is
procedural Canvas 2D, all audio procedural WebAudio). Per GDD §3.1 the byte/beauty budget lives in
the atmosphere layer; the crisp foreground stays cheap.

**Locked decisions (user):** (1) one roadmap covering **both** simulation depth and audio-visual
production; (2) **AI-generated asset pipeline** (extend `scripts/hf-sprites.ts`); (3) **hybrid
distribution** — bundle core + early-era assets, stream later eras / 2040+ branches; (4) build a
**vertical slice** first; (5) **60 fps at all stages is a hard per-phase gate**, not a cleanup pass.

**Ground-truth (verified in code):** override seam was dormant → now wired (#265); `tension` was
hardcoded 0 → now wired (#264); `npm run sim` was broken → restored (#264); **Phase 15 (FX) &
Phase 16 (Warfare, ~80%) are genuinely landed — extend, don't rebuild**; Phase 14 (zoning/
city-services) and the 5 parallax backdrop bands are the real gaps. `serialize()` is a flat
field-dump with `?? default` backfill — **every new field must serialize + backfill** or tests/old
saves break.

### Track A — Asset pipeline ("the 1 GB engine")
- **Byte budget (Standard ≈ 1 GB):** the GB comes from audio (music stems ~0.4 GB OGG / ~4 GB FLAC,
  ambience ~256 MB, voice ~144 MB), cinematics-as-still-sequences (~375 MB via the existing
  `drawCinematic()`), parallax backdrops (~248 MB), Notable portraits (layered → ~300 MB), and
  building/unit/terrain/UI sprite sheets (~300 MB). **Image assets alone reach ~1 GB** — not solely
  dependent on hard-to-generate audio/video; FLAC stems are genuine quality, not bitrate padding.
- **Generation:** make `hf-sprites.ts`'s `CATALOG` a *loader* over `src/data/asset_manifest.json` +
  `audio_manifest.json` (slot, category, era, prompt, sha256); keep its `generateSprite()` + 503
  retry + `--dry-run`; add `--category/--era` filters and `scripts/hf-audio.ts`. `gen/post.ts`
  quantizes to era palettes (also the art-coherence guard) + OGG/Opus encode.
- **Integration:** `src/ui/assets/registry.ts` `AssetRegistry` is **shipped** (live override seam,
  procedural fallback). Next: `src/ui/audio/audioRegistry.ts` + `musicPlayer.ts` (no file-audio
  loader exists today) sitting beside procedural `Music` behind a common `IMusicEngine`, crossfading
  by the now-wired `tension`; `portraitSystem.ts` composites face layers per Notable.
- **Distribution (hybrid):** git stays code-only (`.gitignore` the generated `public/audio`,
  `public/backdrops`, `public/sprites/*.png`); asset packs = versioned zips as **GitHub Release
  assets** (≤2 GB/file, the channel `electron-updater` already uses); thin installer (~150–250 MB,
  eras 1–2) + on-demand era packs SHA-256-verified into `userData/packs`; lazy-by-era + prefetch.

### Track B — Simulation depth (extend real code; don't rebuild)
- **Economy (§5.2):** `INTERMEDIATE_GOODS` → full ~44-good set + supply-shock cascades
  (`supplyChainHealth`); physical goods on routes (transit × congestion); emergent `exchangeRate`;
  credit-rating coupon compounding. (`region.ts` `monthlyEconomy`, `economy.ts`, `defs.ts`)
- **Military (§7, on Phase-16 base):** `Front` model (contact lines, weekly `combatPower` ratio);
  war-support decay/rally (regime-modulated); casualty→cohort scar; peace via the deal engine +
  revanchism. (`region.ts` warfare ~10739–11005)
- **AI (§6.3):** personality → build/research priorities; discoverable agendas via `intel`;
  situation-based `DealVerdict` valuation; rival regime change via `TRANSITION_CHAINS`;
  tier-asymmetry guardrails by `AI_DIFFICULTY`.
- **Map (§6.2):** basin-partition worldgen (6–8 basins, resource skew); climate ghost-waterline live
  overlay (not in the static cache). `REGION_N=128` default; bigger sizes a stress-tested knob.
- **UI/UX (§11):** decompose-every-number tooltips; Century Graph screen; era UI skins; advisor
  briefs surfaced; **`drawBackdrop(era,branch,weather,stats)`** 5-band compositor w/ live-stats skyline.
- **Features:** Phase 14 zoning/city-services (per-settlement grid maps — land value, pollution
  diffusion, services, brownouts, R/C/I/O demand, in a new `zoning-system.ts`); Phase 10 climate
  depth (20-yr lag, sea-rise flooding, adaptation, accords).

### Track C — Engineering foundations
- **Modularize `region.ts` as free functions, NOT subclasses:** `src/sim/systems/*` exporting
  `fn(r: RegionSim, …)`; `tick()` becomes a dispatcher; state + `serialize()` stay on `RegionSim`.
  Free functions preserve RNG-consumption order (the determinism constraint, #236) where class
  refactors wouldn't. One leaf subsystem per PR, each guarded by a fixed-seed byte-identical
  `serialize()` diff. Phase-14 maps: coarse quantized typed arrays; migrate save off `localStorage`
  to filesystem/IndexedDB (it's near the cap already).

### Track D — Performance & smoothness (hard, per-phase gate)
- **Frame contract:** render ≤16.7 ms/frame; **budget the sim catch-up by wall-clock (~8 ms), not
  the 64-iteration count** (`main.ts:274`) so a heavy late tick can't stutter — let the calendar lag
  at 8× instead. Era/asset transitions ≤1 dropped frame (async + prefetched).
- **The guard:** `scripts/bench-region.ts` (shipped) — boots `RegionSim` at early/mid/late, reports
  mean + worst-case ms/tick vs the 16.7 ms / 64-tick budget. **`bench-region` is the 4X guard**
  (the old town-engine `bench-scale`/`bench-agents` were removed). Every perf-sensitive PR must
  show no "DROPS".
- **Render:** keep the static `mapCache`; composite backdrop bands once per era/stat-band change to
  an offscreen canvas (blit + parallax-offset per frame); pre-render Phase-14 heatmaps offscreen.
  **WebGL only if `bench-region` proves Canvas 2D can't hold 60 fps** — and then one overlay canvas,
  not an engine swap.
- **Asset I/O / memory:** `createImageBitmap` + `decodeAudioData` (async, off the render path);
  LRU-evict to keep only current+adjacent era resident (≤~1.5 GB working set); quality tiers cap disk+RAM.

### Phased roadmap (each shippable; balance- AND perf-gated) — **bold = the literal gigabyte**
`A0` wire seams + perf guard **(done — #264/#265)** → `A1` pipeline generalization (manifests,
`hf-audio`, audio/music registries) → `A2` distribution & packs (+ save → filesystem) →
**`B1-art` parallax backdrops + era UI skins** → **`B2-audio` music stems + ambience + voice** →
`C1` `region.ts` modularization → `D1-econ` 44-good economy + FX → `D2-mil` warfare Front model →
`D3-ai` rival agency → `E1` climate depth → `E2` zoning/city-services → `F1` UI/UX + cinematics +
quality tiers. Tracks A (assets/UI) and B (sim core) run in parallel (disjoint files).

### Top risks (stress-tested)
1. **Art-direction coherence at AI volume** → palette quantization in `gen/post.ts`, pinned per-era
   style, hand-authored hero assets, human review gate per pack.
2. **HF generation at volume** (rate limits, hours) → idempotent/resumable/batched; HF Spaces or
   local-diffusion fallback; confirm **model access + asset licensing** (`HF_TOKEN` unset + no
   `sharp`/`ffmpeg` in the web env — provision first).
3. **Audio quality** → AudioGen for ambience/loops; manifest accepts hand-authored stems; procedural floor.
4. **Late-game fps** → Track D in full + `bench-region` gate at every phase.
5. **Phase-14 save bloat** → quantized maps + filesystem save + a save-size regression test.
6. **Determinism in modularization** → free-function extraction + byte-identical `serialize()` diff per PR.

### Next increment (integration seams mapped) — `B1-art` + audio, code-only, procedural fallback
- `drawBackdrop()`: insert in `regionview.ts` `draw()` **before** the `g.drawImage(this.mapCache,0,0)`
  blit (~line 646, inside the camera transform → world-space); composite offscreen keyed by
  era/season/stat-band; blit + parallax-offset per frame.
- Sample-stem music: attach in `Music.update()` beside the synth on the same `master` gain;
  `eraForYear()` picks the era; crossfade by `intensity` (already tension-driven).
- Ambience beds: attach in `Soundscape.update()` after `ensure()`. All fall back to procedural.

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
npm run dev        # http://localhost:5173/  (index.html → src/main.ts) ← the 4X game
npm run build      # tsc + vite build (must pass)
npx tsc --noEmit
npx vitest run --exclude '**/.claude/**'   # 815 tests
npx tsx scripts/bench-region.ts            # 60fps perf gate (early/mid/late) — must show no "DROPS"
npm run sim                                # headless long-run balance harness (restored)
```

> Note: `scripts/bench-region.ts` is the only perf bench — it gates the `RegionSim` 4X campaign.
> The old town-engine benches (`bench-scale.ts` / `bench-agents.ts`) were removed.

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
