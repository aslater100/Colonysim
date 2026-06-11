# Session Handoff — 2026-06-11 (v0.18.0)

## Current state

Version **v0.18.0** (war). Transportation arc, governance stack, audio layer, rival nations + diplomacy, and the casus-belli → mobilization → war-score → negotiated-peace loop are complete.

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
| 0.18 | War (GDD §7): nation-tier `playerWar` — 3 casus belli (CB quality sets war support; fabrication costs legitimacy + reputation), 3 mobilization levels (GDP stimulus + £/pop drain + rationing), monthly front resolution on `manpower^0.6 × quality` power ratio, attrition scars cohorts, support floors per regime (home front breaks → capitulation), peace table priced in war score (status quo/reparations/annex/regime change) with grudge premium + Versailles trap; hostile rivals can declare on the player |

## Ship loop

Each task = its own draft PR. Bump `package.json` version in the PR; push matching `v*` tag after merge.
User merges and play-tests; CI validates (test.yml — do not run the suite locally).

## Standing instructions

- Be frugal with tokens.
- Goal: "fully fleshed out game based on everything planned."

## What's next

GDD-aligned open items (roughly in order of pull):
- Negotiation depth: multi-item treaty baskets with counter-offers (GDD §6.3; treaty acceptance and the peace table are both single personality-priced thresholds today)
- War depth: blockade/trade interdiction during wars (routes exist), allied co-belligerence (defensive pacts only add power now), occupation/resistance (GDD §7.4)
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
- **Player war (GDD §7):** one front at a time (`playerWar`), nation-tier only. CBs earned by hostility (`availableCasusBelli`: raids < −40 w/o NAP, border < −20, fabricated always at −10 legitimacy + breach). `warPower` = `totalPop^0.6 × quality(militia/standing army/defence minister/military reform/junta) × mobilization(1/1.6/2.3)` + defensive-pact allies at `pop^0.6 × 0.25`; rival = `pop^0.6 × (0.5 + exp×0.04 + risk×0.015)`. Monthly in `tickPlayerWar`: score ±16×ratio+rng, attrition bleeds bands 1–2 (`casualties` accrues), support decays/rallies; floors 45/45/35/25 (dem/rep/mon/junta) — below: legitimacy −2 + grievance; floor−15 → forced `capitulate` (treasury ×0.6, pop −4%, legitimacy −15/−25 junta), same as score ≤ −60. `offerPeace` ask = term score (0/30/55/80) + grudge×2; victory pays legitimacy +10 (+15 defensive), treasury ×0.9 demobilization, enemy pop ×0.92; annexation = grudge+3, relations −80 (Versailles trap); regime change → `changeRegime('defeat')`, relations 15. War pins enemy relations ≤ −60 and blocks envoy/gift/treaty verbs. Hostile rivals (< −60, no NAP) declare on the player risk/expansion-weighted; democracies need 6 months at war for Total mobilization unless defensive. Mobilization economics live in `monthlyEconomy` (`gdpMult` stimulus, `upkeepPerPop` drain).
