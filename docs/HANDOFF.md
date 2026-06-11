# Session Handoff — 2026-06-11 (v0.16.0)

## Current state

Version **v0.16.0** (policy slots + expanded statute book). Transportation arc, governance stack, and audio layer are complete.

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

## Ship loop

Each task = its own draft PR. Bump `package.json` version in the PR; push matching `v*` tag after merge.
User merges and play-tests; CI validates (test.yml — do not run the suite locally).

## Standing instructions

- Be frugal with tokens.
- Goal: "fully fleshed out game based on everything planned."

## What's next

**Biggest gap:** AI rival nations + diplomacy — the world has no other nations; Nation-tier play is missing its main external actor.

Other GDD-aligned open items:
- Maglev/automated freight (transportation.md §5, 2000+ speculative era)
- Eras 7–8 (2040–2100: solarpunk / dystopia / drowned endings)
- Full climate system (CO₂ ledger framework exists; impacts currently simplified to events)
- FX & monetary regimes (single-currency only today)
- Espionage + misinformation systems
- Historical scenarios (GDD §9)
- War: front-based system, treaty types (GDD §7)
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
