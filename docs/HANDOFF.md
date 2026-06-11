# Session Handoff — 2026-06-11 (v0.17.0)

## Current state

Version **v0.17.0** (rival nations + diplomacy). Transportation arc, governance stack, audio layer, and the first external-actor slice are complete.

## Shipped

| Version | Feature |
|---|---|
| 0.1 | Tier-1 colony: needs/mood/food chain/events, headless deterministic sim |
| 0.2 | Raids, medicine (wound→infection→scar), relationships + Notables seed |
| 0.3 | Defense & game feel: gates, wildlife, armed pawns, menu, save/load, SFX |
| 0.4 | The Flip + Notables carve-out; cohort model; Statehood gate; procedural world (terrain/weather/rivers); region routes (trail/road), capacity-clamped caravans |
| 0.5 | Town roads/bridges/stone; rail era (Railworks gate + 1912, capacity 1,200); art pass; washout/repair loop; militia relief bonus |
| 0.6 | Region save/load: v2 combined snapshots `{v:2, mode:'region', town, region}` under `centuria-save`; v1 town saves still load |
| 0.7 | Region event variety: 9 incidents (highwaymen gate on freight, Notable bio beats, town fires, prospectors) |
| 0.8 | Region markets: GDD §5.2 price rule (±2%/day, 0.25×–4× band); arbitrage traders; 5% State levy into treasury |
| 0.9 | Highway era: `highway` kind (capacity 900, £3/tc, £0.15/cell/mo) behind State+1945; transportation arc complete (trail→road→rail→highway) |
| 0.10 | Procedural era-aware music: WebAudio only, 6 era windows (ragtime→speculative), tension scalar, `centuria-music` toggle |
| 0.11 | Town-tier event variety: 5→12 named incidents; fishing dock (grain-free food from water) |
| 0.12 | Diegetic soundscape: hammering (builders), train whistle (B♭, rail condition>50), crowd chanting (grievance>50), bird chirps (calm) |
| 0.13 | Research tree: twin tech/civics trees gate era unlocks |
| 0.14 | Elections, factions & political capital: Tier-2 politics |
| 0.15 | Constitutional Convention; Nation proclamation; 13 government types (democracy→fascism) |
| 0.16 | Policy slots (3–4/gov type, 9 cards, 20 PC to swap); statute book 4→12 laws (8 nation-tier laws) |
| 0.17 | Rival nations + diplomacy: ≤6 powers emerge 1922+, §6.3 personality archetypes, 10 era-gated regimes in 4 blocs, generated founding histories, player relations ledger + 3 treaty types + envoys/gifts/AI offers, pairwise rival relations with alliances/customs unions/ultimatums, foreign wars (refugee waves, export booms, dictated peaces, defeat-toppled regimes), sponsored raids |

## Ship loop

Each task = its own draft PR. Bump `package.json` version in the PR; push matching `v*` tag after merge.
User merges and play-tests; CI validates (test.yml — do not run the suite locally).

## Standing instructions

- Be frugal with tokens.
- Goal: "fully fleshed out game based on everything planned."

## What's next

**Biggest gap:** War (GDD §7) — rivals and treaties now exist, but hostility tops out at sponsored raids and border friction. A casus-belli → mobilization → war-score → negotiated-peace loop (priced with the §6.3 engine) is the natural next slice.

Other GDD-aligned open items:
- Negotiation depth: multi-item treaty baskets with counter-offers (GDD §6.3; acceptance is currently a single personality-priced threshold)
- Maglev/automated freight (transportation.md §5, 2000+ speculative era)
- Eras 7–8 (2040–2100: solarpunk / dystopia / drowned endings)
- Full climate system (CO₂ ledger framework exists; impacts currently simplified to events)
- FX & monetary regimes (single-currency only today)
- Espionage + misinformation systems
- Historical scenarios (GDD §9)
- Animal husbandry + ranged combat polish (may be partially shipped; check src/)

## Architecture reference

- **Route kinds:** `'trail' | 'road' | 'rail' | 'highway'`; `KIND_RANK` enforces upgrade-only; `buildLink` refuses downgrades.
- **Gates:** `railUnlocked()` = `stateProclaimed && year >= 1912`; highway = State + year ≥ 1945.
- **Save format:** v2 `{v:2, mode:'region', town, region}` under `centuria-save`; v1 town saves still load.
- **Clocks:** town = 4 game-min/tick; region = 30 game-min/tick (~6 s/day at speed 1).
- **Effective route capacity:** `capacity × condition/100`; condition floor 15; unpaid maintenance −6/mo; washouts −45 condition on storm days (12% chance), `repairRoute` restores to 100 from treasury.
- **Relief line:** `reliefLine(t)` = larger town reachable via road/rail → ×1.25 militia in raid branch of `fireEvent`.
- **Markets:** `routePath` with `usable` filter; arbitrage fires when margin > 1.5× freight (£0.01/unit/hop); clamped to remaining capacity after caravans; 5% State levy into treasury.
- **Policy effects:** ongoing monthly in `monthlyEconomy`; faction wiring in `updateFactions`.
- **Region events:** `routePath` for highwaymen — freight gate means quiet routes carry nothing worth robbing; earlier draft robbed subsistence and starved the harness.
- **Diplomacy:** rivals emerge in `updateDiplomacy` (monthly) from 1922, ≤6, archetype presets over §6.3 weights; regimes from `RIVAL_REGIMES` (10, era-gated, 4 blocs; `blocAffinity` feeds both player and pair baselines); treaty acceptance = `relations ≥ treatyAsk()` (personality-priced, +15/breach reputation penalty); hostile = relations < −40 with no NAP → sponsored raids (×1.3 strength, 50% per raid) and border friction; trade agreements pay `exportEarningsLastMonth` in `monthlyEconomy` (×1.5 during `warBoomUntil`).
- **The world's own politics:** `rivalPairs` (keyed `minId:maxId`) drift in `tickForeignRelations`; pairs > 45 + honor ally, > 25 + commerce open customs unions, < −20 trade ultimatums, < −50 → `startForeignWar` (240–720 days; refugee waves 20%/mo; peace bleeds the loser ~10–15% pop, sets the pair at −60, 50% defeat-topples its regime via era-gated `pickRegime`). Alliances block war within the pair and harden sides when wars start. Rival `history[]` accrues beats (capped 16, founding line kept).
