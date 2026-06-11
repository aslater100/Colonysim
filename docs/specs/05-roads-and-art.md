# Milestone 6a — Town Roads, Bridges & Stone + Art Pass (COMPLETE)

## Roads

Tile state (`Tile.road` / `Tile.roadPlan`), not buildings. Types: **dirt** (free, ×1.3, mud in rain → ×1.0), **plank** (1 wood, ×1.6), **gravel** (1 stone, ×1.8), **bridge** (4 wood, ×1.4 — only legal water crossing). Drag-paint to plan; settlers build via the `build` work type.

**Stone:** mark rock with Quarry tool → 4 stone per rock tile, 90 min work.

**A* pathfinding** (binary heap, manhattan heuristic) replaces BFS. Tile cost = 1/speed, so settlers and raiders prefer roads automatically.

**Critical bug fixed:** A* `dist` table was `Float32Array` while heap entries were float64. Road step costs (e.g. 1/1.8) rounded differently in the two precisions → every road-node compared as stale → null path → vitest OOM'd the worker. Fix: `Float64Array`. **Lesson: mixed-precision distance comparisons are a trap.** (Applied proactively in all subsequent A* code.)

**Traffic overlay:** transits/tile recorded on movement, daily decay, warm heatmap — the first data overlay (GDD §8.5).

## Art pass (RimWorld-leaning)

Organic terrain patches via coarse cluster hash (no checkerboard). Drop shadows under trees/rocks/pawns/items/buildings — biggest single readability win. Trees: 20×22 rounded canopies, lit upper-left, overhanging their tile. Pawns: capsule bodies, distinct heads, hair colors, skin variation. Buildings: wall base + shaded roof + door. Two-pass tile rendering (ground+roads, then standing terrain) so canopies overlap correctly.
