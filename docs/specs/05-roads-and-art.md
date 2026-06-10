# Milestone 6a Spec — Town Roads, Bridges, Stone + the RimWorld Art Pass

Implements §2 of the transportation design (docs/design/transportation.md)
plus an art-direction correction requested in review: the look should lean
**RimWorld, not Dwarf Fortress** — readable naturalistic top-down, soft
shadows, blended terrain — while staying strictly pixel art per the GDD.

## Roads (mechanics)

- **Tile state, not buildings** (`Tile.road` / `Tile.roadPlan`): dirt
  (free, ×1.3, mud in rain → ×1.0), plank (1 wood, ×1.6), gravel
  (1 stone, ×1.8), **bridge** (4 wood, ×1.4, the only legal water
  crossing). Drag-paint to plan; settlers build them via the `build`
  work type; materials are charged on completion.
- **Stone** is a new resource: mark rock with the (renamed) Chop/Quarry
  tool → 4 stone per rock tile, 90 min work.
- **Cost-aware pathfinding:** BFS replaced with A* (binary heap,
  admissible manhattan heuristic; exact heuristic when the map has no
  roads yet). Tile cost = 1/speed, so settlers — and raiders — prefer
  roads automatically. Bridges open the river's far bank.
- **Traffic overlay:** transits per tile recorded on movement, decay
  daily, rendered as a warm heatmap — the first true data overlay
  (GDD §8.5), and the tool that shows you where roads should go.

## Bug found (worth remembering)

The A* `dist` table was `Float32Array` while heap entries were float64:
road step costs like 1/1.8 rounded differently in the two precisions, so
every node reached via a road compared as "stale" and the search returned
null — *pathfinding worked perfectly until you built the first road*.
In vitest the resulting path-thrash OOM'd the worker. Fix: `Float64Array`.
Lesson: mixed-precision distance comparisons are a trap.

## Art pass (RimWorld-leaning)

- **Terrain:** per-tile glyph flecks removed; grass is two close tones in
  irregular patches chosen by a coarse cluster hash (organic fields, no
  checkerboard), with sparse blades and occasional dirt patches.
- **Shadows everywhere:** drop shadows under trees, rocks, pawns, items,
  and buildings — the single biggest readability/feel win.
- **Trees:** full 20×22 rounded canopies, lit upper-left, overhanging
  their tile so stands read as woods rather than rows of glyphs.
- **Pawns:** capsule bodies with distinct heads, hair colors, and skin
  variation; ground shadow.
- **Buildings:** visible wall base + shaded roof + door (structures, not
  blobs); stockpile shows crates and a grain pile; muted earthy palette
  throughout.
- Two-pass tile rendering (ground+roads, then standing terrain) so
  canopies overlap correctly.

## Tests

5 new road tests (path prefers roads ≥85% of tiles, bridge-gated water
crossing, quarrying, settler-built roads with mud-speed checks, plank
wood consumption); 33 total passing.

## Deferred to 6b/6c

Region Route objects, capacity-clamped caravans, maintenance, rail era,
road wear, carts.
