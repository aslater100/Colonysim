# Milestone 6b/6c — Region Routes (COMPLETE, all four kinds shipped)

## Corridors

`RegionMap.cellCost`: plains 1, forest 1.3, hills 1.8, marsh 2.2, mountains 3.5, river 3 (1+2 bridge surcharge), sea/lake impassable. `RegionMap.corridor(a, b)`: A* over 64×64 grid, Float64 distances (the 6a mixed-precision lesson, applied proactively). Pass-finding through valleys emerges from the cost field. Corridors memoized in `RegionSim` (UI prices roads every frame).

## Route kinds

| Kind | Gate | Build cost | Capacity/mo | Maintenance |
|---|---|---|---|---|
| Trail | auto on founding | free | 60 | none; −2 condition/storm-day, +0.1/day footfall |
| Wagon road | State + treasury | £2 × terrain cost | 200 | £0.2/cell/mo |
| Rail | State + year ≥ 1912 | £8 × terrain cost | 1,200 | £0.5/cell/mo |
| Highway | State + year ≥ 1945 | £3 × terrain cost | 900 | £0.15/cell/mo |

`KIND_RANK` enforces upgrade-only; `buildLink` refuses downgrades. Highway above rail in rank — paving replaces steel (stranded-asset choice is the player's).

**Effective capacity = capacity × condition/100.** Condition floor 15 (a rotted road carries less than a healthy trail). Unpaid maintenance: −6/mo condition, logs rutting-over. **Washouts:** on storm days, 12% chance a random built route with condition > 40 loses 45 condition with repair cost logged; `repairRoute` restores to 100 from treasury; monthly maintenance heals +8/mo as slow path. Note: washout roll consumes RNG draws on storm days — region sequences differ from v0.4.0 (tests are behavior-based, suite unaffected).

## Network rules

Trails auto-blazed when a town is founded (origin → new town) — network is a tree by construction. **Caravans** clamp to remaining capacity per leg (BFS hop-path); famine behind a goat trail is possible. No route → smugglers at 30% efficiency. Migration between unconnected towns → 30% trickle. **Charter gate:** `charterEligible()` requires every settlement reachable through route graph.

**Relief line:** `reliefLine(t)` = larger town reachable via road/rail only → ×1.25 militia in raid branch of `fireEvent`. `routePath` has a `usable` filter for this.

## Region UI

Routes draw along actual corridors (dotted trail, solid road, steel+cross-ties rail, dashed-centerline highway); line brightness = condition. Settlement panel: ROUTES section with build buttons priced by terrain ("£38: 12 plains, 6 hills, 1 river crossing"). Rail-connected towns get a depot sprite; animated train on rail links above condition 20.
