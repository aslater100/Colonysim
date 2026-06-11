# Milestone 4/5 — State Layer & Procedural World (COMPLETE)

## State layer

**Incorporation ceremony:** charter completion pauses history; player names the State and chooses a lean: *Council of Towns* (+6 sat, −15% collection), *Iron Mayor* (+20% collection, +20% militia, −6 sat), *Merchant Compact* (+15% income, services +25% cost).

**Money at Statehood:** monthly GDP = workers × land; tax slider 0–30%; treasury; services (satisfaction, −5%/level mortality) and militia (+20%/level); admin overhead; forced service cuts when treasury empties.

**Grievance & strikes:** 0–100 gauge builds under taxes > 15%; vents as 15-day production strikes (−40%) — first rung of GDD §5.5 unrest ladder.

## Procedural world

`RegionMap(seed)`: 64×64-cell grid; fBm elevation with west-sea/east-mountains continental gradient; moisture + temperature fields; rivers descending from wet heights to sea (confluence attraction, lake depressions); biomes (sea/lake/river/marsh/plains/forest/hills/mountains). Each cell derives **fertility** (0.3–1.4), **forest**, **roughness**.

**Critical bug fixed:** Original value-noise hash was biased (mean 0.24, range 0.05–0.43) — world generated as featureless mush with no mountains, forests, or droughts. Replaced with murmur-style finalizer (mean 0.5, full range). **Lesson: distribution-test noise primitives before tuning anything above them.**

**Weather:** `Weather(seed)`: seasonal rainfall × multi-day fBm fronts → sky states (clear/overcast/rain/storm/snow); ±4°C anomalies. One deterministic series shared by both tiers.

**Limits propagate:** Crop growth = base × tile fertility × water balance (drought 0.35×, well-watered 1.1×, waterlogged 0.85×). Floods: sustained rain bursts riverbanks — town drowns field tiles near water; region spoils 15% of river-town stores. River/coastal towns have weather-independent fishery (+0.18 food/worker). Wood scales with cell forest density. Expeditions scored by fertility/river/coast/roughness; travel time computed across actual terrain; `canFoundTown` fails when no viable land remains.
