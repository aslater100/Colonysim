# Milestone 3 — The Flip: Cohorts & Notables (COMPLETE)

## Trigger

"Found Town #2" unlocks at 20 settlers, 100 wood, 120 food, outside a raid. 8 settlers + 80 food + 80 wood depart as expedition. `RegionSim.fromTown()` converts the whole game in one call.

## Conversion (one-way, conserving)

Settlers binned into age bands (0–14 / 15–29 / 30–49 / 50–69 / 70+) by real age; stocks transfer exactly; satisfaction initialized from actual average mood. Population conserved exactly (cohorts + expedition = settlers — regression-tested).

**Notables carve-out:** Top 10 by (skills + combat + 5×friendships) stay as named individuals with roles: Mayor (+5 sat), Doctor (−15% mortality), Captain (+25% militia), Granger (+10% food), Forewoman (+10% wood), Reeve (+10% immigration). Notables age and die (actuarial risk), accumulate a bio, replaced by new Notables minted from cohorts when a role falls vacant.

Old town renders as a **representative diorama** (sprites wander/sleep — not authoritative, per GDD §2.4).

## Aggregate model

**Daily:** food = workers×1.15×season(0.15 winter)×land quality×role bonuses; consumption 0.75/head; satisfaction from food-days, crowding, raid fear; starvation shrinks cohorts.
**Monthly:** births 1.1% of fertile bands, band aging (1/span-years per year), mortality (1900 frontier rates, Doctor-modified), immigration to fed+content towns, inter-town migration down satisfaction gradient.
**Region clock:** 30 game-min/tick (~6 s/day at speed 1).

## State gate

Any town at 24+ pop, 80 food, 80 wood can send a new expedition (8 pop, 3-day travel). **Statehood:** 3 towns + 500 total population → charter eligible; Mayor drafts Regional Charter (~90 days) → INCORPORATION. Reached ~10–14 game-years in tests. `charterEligible()` also requires every settlement reachable via the route graph.
