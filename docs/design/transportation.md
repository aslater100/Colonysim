# Transportation & Roads — System Design

> Status: **PLANNED** (design approved for implementation as Milestones 6a–6c).
> Builds on: per-tile town maps (M1), the region cell grid + terrain costs
> (M5 `worldgen.travelDays`), grain caravans (M5), the State treasury (M4),
> and the GDD's era arc (§5.1 transport, §10 timeline).

## 1. Design goals & the tensions they resolve

1. **Movement is a budget, not a given.** The procedural world already
   prices distance (roughness, water). Transportation is the player's
   counter-spend: pay once in wood/money/labor to make a corridor cheap
   forever. *Tension resolved: terrain limits vs. player agency.*
2. **Capacity, not teleportation.** Goods and people move along concrete
   links with throughput limits. Caravans (M5) currently move food by
   magic; routes make that honest — and make logistics a strategic
   surface (and later, a military one: GDD §7.3 supply). *Tension:
   simulation honesty vs. micromanagement — solved by managing links,
   not vehicles.*
3. **The century is visible on the roads.** Dirt ruts (1900) → gravel →
   rail (the spine of 1910–1950) → paved highways (1950+), per the GDD
   era table. Each era changes the map's look and the economy's reach.
4. **Same system, three altitudes.** Tile paths in town, route links in
   region, corridors at nation — mirroring the spine. One mental model:
   *a link has a speed multiplier, a capacity, a build cost set by
   terrain, and a maintenance cost.*

## 2. Town tier (tile roads) — Milestone 6a

### Mechanics
- New buildable **path tiles** (not buildings — a `road` field on `Tile`,
  like `wall`): placed by drag, built by settlers with the existing
  `build` work type.

| Type | Era | Cost/tile | Build work | Speed on tile | Notes |
|---|---|---|---|---|---|
| Dirt path | 1900 | free | 10 min | ×1.3 | turns to mud in rain (×1.0) |
| Plank road | 1900 | 1 wood | 25 min | ×1.6 | all-weather |
| Gravel road | tech: Quarrying | 1 stone* | 40 min | ×1.8 | all-weather; wagons +cap |
| **Bridge** | 1900 | 4 wood | 120 min | ×1.4 | the only legal water crossing; 1-wide spans only |

  *introduces stone as a resource from rock tiles (chop-equivalent job) —
  small scope add, also future-proofs minerals.*

- **Movement integration:** `stepAgent` reads the tile under the agent;
  road tiles multiply speed. Pathfinding (`World.findPath`) becomes
  cost-aware (BFS → uniform-cost search, weight 1/speedMult), so settlers
  *prefer* roads automatically — built roads visibly reorganize the
  colony's daily traffic, which is the payoff moment.
- **Hauling throughput** is therefore emergent: faster legs = more hauls
  per day. No separate cart system in 6a (carts can come with Tier-2
  density if needed).
- **Bridges** cross the M5 river: the east bank's timber and land open up
  only after the colony can afford a bridge — terrain limitation, plus
  the counter-spend, exactly as the worldgen intends. Floods damage
  bridges (repair work) but never delete them silently.
- **Raid interaction:** raiders use roads too (cost-aware pathing) —
  roads are arteries in *and* out. A bridge is a chokepoint: palisade +
  bridge = the classic defended crossing.

### UI
Road tool in the build palette (drag to paint, cost preview); roads render
as 8-bit ruts/planks/gravel with wear; a traffic overlay (heatmap of agent
transits per tile) added to the overlay palette — the first true data
overlay of GDD §8.5.

## 3. Region tier (route links) — Milestone 6b

### Mechanics
- **Routes are first-class objects:** `Route { a: settlementId, b:
  settlementId, kind, condition 0–100 }` over a path of region cells
  (computed once with A* over terrain cost; stored so the line renders
  along valleys/passes, not as a chord).

| Kind | Era / gate | Build cost | Speed | Capacity (food-equiv/month) | Maintenance |
|---|---|---|---|---|---|
| Trail | auto on founding | free | ×1.0 | 60 | none, degrades in storms |
| Wagon road | State + treasury | £2 × terrain cost/cell | ×1.7 | 200 | £0.2/cell/mo |
| Rail | tech: Railworks (~1912) + £ | £8 × terrain cost/cell | ×4.0 | 1,200 | £0.5/cell/mo |

- **Terrain cost/cell** comes from the existing `travelDays` weights:
  plains 1, forest 1.3, hills 1.8, marsh 2.2, mountains 3.5 (pass-finding
  emerges from A*), river crossing +2 (a bridge), sea: ferries only
  (late). Mountain rail is gloriously expensive — geography writes the
  network's shape, which is the point.
- **Everything that moves between towns rides the network:**
  - **Caravans (M5) become capacity-limited:** food transfers clamp to
    route capacity. A famine behind a goat trail is now possible — and
    fixable with money. (The M5 magic transfer is the fallback only
    while no route exists, at 30% efficiency: smugglers and peddlers.)
  - **Expeditions & migration** use network-aware travel times
    (`travelDays` consults routes; off-network legs pay raw terrain).
  - **Militia response** (new): a raided town gets +25% militia if a
    road/rail connects it to a larger town — the network is defense.
  - **Future hooks:** Tier-2 goods markets price-converge along routes
    (arbitrage already designed in GDD §5.2); war supply (GDD §7.3)
    flows down this same graph. Build once, spend twice.
- **Condition & weather:** storms and floods damage routes (condition
  ↓; capacity scales with condition); maintenance restores it from the
  treasury; an unmaintained empire silently rots — the GDD's long-lag
  decay made local.
- **The State gate (already built):** the M2→State requirement "all towns
  connected" (GDD §2.2) becomes real: charter eligibility adds *every
  settlement reachable via routes*, replacing the implicit assumption.

### UI
Region map: route lines drawn along their actual cell paths (dotted trail,
solid road, hatched rail); click two towns → build preview with cost
breakdown by terrain ("£184: 12 plains, 6 hills, 1 river crossing");
condition shown by line brightness; a freight overlay (tonnage flowing per
route) joins the State panel.

## 4. Nation tier (corridors) — designed now, built with Tier 3

Routes aggregate into **corridors** between provinces; capacity becomes
strategic (mobilization rates, trade volumes); rail networks set army
redeployment speed (GDD §7); harbors and sea lanes join the graph. No
implementation in M6 — but the Route schema above (kind/capacity/
condition over a cell path) is deliberately already the right shape.

## 5. Era evolution (the visible century)

- **1900–10:** dirt and plank towns, trail regions; mud season matters.
- **1910–45:** gravel + the **rail boom** — rail is deliberately the best
  value in the game during this window (matching its real dominance);
  stations render in towns; the backdrop gains trestles and smoke.
- **1945+:** paved roads/highways (×2.2, cheap) erode rail's monopoly —
  the player who over-built rail faces the stranded-asset lesson early
  (rehearsing the GDD's energy lock-in theme).
- **2000+:** maglev/automated freight as speculative-era upgrades.

## 6. Implementation plan

| Milestone | Scope | Est. size |
|---|---|---|
| **6a** | Town roads + bridge + stone + cost-aware pathfinding + traffic overlay | ~400 LOC + tests |
| **6b** | Region Route objects + A* corridors + capacity-clamped caravans + maintenance + route UI | ~450 LOC + tests |
| **6c** | Rail era (tech gate, rail kind, stations, art), weather damage/repair loop, militia-response bonus | ~300 LOC + tests |

**Test plan:** pathfinding prefers roads (path cost assertions); bridge
opens the far bank (reachability before/after); caravan clamp (famine with
trail, fed with road); A* route avoids mountains when a valley exists
(cost comparison); maintenance decay → capacity loss; determinism
throughout; harness: survival unchanged in 6a, statehood date improves
~1–2 years with roads in 6b (roads should *matter*).

**Tuning risks to watch:** road speed making raids too fast (raiders ride
arteries too — may need defender-side response buff); rail trivializing
distance (capacity costs keep geography relevant); UI drag-painting feel.

## 7. Decision log

- **Links-not-vehicles** at region tier: individual wagons/trains are
  rendering flavor (animated dots on routes), never simulation objects —
  same philosophy as the cohort flip (GDD §2.4).
- **Roads as tile-state, not buildings:** avoids building-grid conflicts,
  allows under-walking, halves the render cost.
- **Stone introduced in 6a** rather than a special bridge-only cost:
  smallest honest step toward the mineral economy the industrial era
  needs anyway.
