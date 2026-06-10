# Milestone 3 Spec — The Flip: Town #2, Cohorts & Notables

Implements the structural heart of the GDD (§2.4): the moment the colony
expands past its first town, individual simulation ends and the aggregate
model takes over — with a carve-out of named Notables to carry the
attachment forward. This is the spine's first promotion-in-miniature: the
default operating altitude rises to the region map.

## The flip trigger

- **"Found Town #2"** (build palette) unlocks at 20 settlers, 100 wood,
  120 food, not during a raid — the Growing Pains soft cap (Milestone 1)
  is the pressure that pushes players here.
- On click: 8 settlers, 80 food, 80 wood leave as an expedition;
  `RegionSim.fromTown()` converts the whole game in one call.

## The conversion (one-way, conserving)

- Every settler is binned into **cohort bands** (0–14 / 15–29 / 30–49 /
  50–69 / 70+) using their real ages; stocks transfer; satisfaction
  initializes from actual average mood. Population is conserved exactly
  (cohorts + expedition = settlers; regression-tested).
- **Notables carve-out:** the 10 most story-laden settlers — scored by
  total skills + combat + 5 per friendship (Milestone 2's relationship
  data is the input, by design) — stay named individuals with roles:
  Mayor (+5 satisfaction), Doctor (−15% mortality), Captain (+25%
  militia), Granger (+10% food), Forewoman (+10% wood), Reeve (+10%
  immigration). Notables age, die (actuarial risk), accumulate a bio,
  and are **replaced by new Notables minted from the cohorts** when a
  role falls vacant.
- The old town keeps rendering as a **representative diorama**
  ("Visit Founder's Rest"): sprites wander and sleep at night, but
  nothing there is authoritative — exactly the GDD §2.4 split.

## The aggregate model (daily/monthly steps)

- **Daily:** food production = workers × 1.15 × season (0.15 in winter) ×
  land quality × role bonuses; consumption 0.75/head; wood → housing
  growth; satisfaction from food-days, crowding, raid fear; starvation
  shrinks cohorts.
- **Monthly:** births (1.1% of fertile bands), band aging (1/span-years
  per year), mortality per band (1900 frontier rates, Doctor-modified),
  immigration to fed and content towns, inter-town migration down the
  satisfaction gradient.
- **Region clock:** 30 game-min/tick (vs 4 in town) — the GDD §8.6
  altitude-scaled compression: ~6 s/day at speed 1.
- **Events:** abstract raids (militia strength vs raid strength — combat
  abstraction rises with tier, GDD §7), fevers, harvests, wagon trains,
  fairs.

## Expansion & the State gate

- Any town with 24+ pop, 80 food, 80 wood can send a new expedition
  (8 pop; 3-day travel; named towns from a pool).
- **Statehood (GDD §2.2):** 3 towns + 500 total population makes the
  colony charter-eligible; the Mayor then drafts the Regional Charter
  (~90 days — the slice's stand-in for the civics gate), ending in the
  INCORPORATION moment. Reached in ~10–14 game-years in tests.

## Deferred

The full Tier-2 game (zoning, regional economy, currency, politics) —
Statehood is this slice's horizon, not its content. Also deferred:
authored flip ceremony UI (currently a log moment), choosing expedition
members by hand, multiple region biomes, Notable portraits.
