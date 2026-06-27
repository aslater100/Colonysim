# Design: Spatial City Layer — a Civ/Age-of-Wonders model that stays a clear 4X

**Status:** Draft for review · **Author:** design pass, pre-implementation · **Scope:** large, multi-phase

> ## Governing principle (the north star)
> **Clarity of the 4X strategic layer is paramount.** The spatial city layer adds
> depth and tactile agency — you choose *where* to found cities and *where* to
> place key buildings — but it must **never bury the empire game in
> micromanagement.** The model is **Civilization VI's districts** (a handful of
> meaningful placements per city) and **Age of Wonders' strategic map**, *not*
> SimCity's dense per-tile painting. Every spatial decision should be a *strategic*
> one (where, given terrain and adjacency), made a few times per city — not a
> chore repeated on every hex. When in doubt, fewer, weightier placements.

---

## 1. What this adds

1. **Found cities where you choose.** Click a valid land hex to found a town
   (already gated by a minimum-spacing rule in the sim).
2. **Place key buildings/districts on hexes** in a city's territory — homes,
   resource buildings, factories, power, schools, services, and eventually
   **wonders** — with terrain and **adjacency** mattering.
3. **More detailed town/building art** so the populated map reads well.

All three sit *on top of* the existing macro 4X (explore with scouts, expand by
founding, exploit the economy, exterminate via warfare) — which stays the
dominant, legible layer.

---

## 2. What already exists (we extend, not rebuild)

This is the key finding: **most of the spatial substrate is already in the
codebase.**

- **Hex world.** `src/sim/hex.ts` — pointy-top, odd-r offset hexes with
  `hexNeighbors` (6 dirs), `hexNeighborDir`, `hexDistance`, `hexCorners`. The
  region is a **128×128 hex grid** (`REGION_N`, `src/sim/worldgen.ts`).
- **Rich per-tile terrain.** `RegionMap.cells[]` already stores `elevation`,
  `moisture`, `temperature`, `biome`, `fertility`, `river`/`flow` per hex — exactly
  the inputs Civ uses for tile yields.
- **Founding with spacing.** `RegionSim.foundSettlement(x, y)` exists and already
  **rejects sites within `MIN_SETTLEMENT_SPACING` (8 / 0–100 coords)** of any
  town. "Pick where towns establish, not too close to others" is *already the
  rule* — it just needs a click-to-found UI.
- **Buildings + economy.** `Settlement.buildings: string[]`; each
  `REGION_BUILDINGS` def is `{ id, cost, days, upkeep, max, sector, bonus,
  satisfaction? }` and adds a flat `bonus` to one sector's output via
  `buildingBonus()` inside the sector-share economy (`updateSectors`).

**The gap:** buildings are an *abstract list* with no position, and the economy is
*sector-share %*, with no spatial/tile/adjacency component. That's what the new
layer introduces — **incrementally, so the 4X stays playable at every step.**

---

## 3. Design principles

1. **Macro stays primary.** The empire HUD, the map, and the founding/economy/war
   loop remain the default view. The city/tile layer is something you *zoom into*
   for a city, not a constant demand.
2. **District-scale, not tile-painting.** A city works a small ring of hexes
   (radius ~2–3). Most are auto-worked for base yields; you make a *few*
   deliberate placements (districts/buildings/wonders) where terrain & adjacency
   reward you. Target ~3–8 meaningful placements per mature city, not dozens.
3. **Extend the economy, don't replace it.** Tile yields and placed buildings feed
   the **existing sector-share output model** (agriculture/industry/services/
   information). We add a spatial *source* of sector bonuses; we keep the proven
   downstream economy (supply chain, FX, trade) intact.
4. **Determinism preserved.** New systems are free functions over `RegionSim` with
   a fixed-seed, byte-identical `serialize()` diff per PR (the repo's existing
   constraint). RNG-consumption order is sacred.
5. **Every phase ships and is playable.** No "big bang." The game is a complete 4X
   after each phase; the spatial layer deepens it.
6. **Old saves migrate.** Existing abstract buildings auto-place onto sensible
   tiles on load; nothing breaks.

---

## 4. The model

### 4.1 City territory (the worked ring)
On founding, a city claims the hexes within `WORK_RADIUS` (start ~2; grows with
population/era to ~3). Claimed hexes:
- are **owned** by that city (tracked on the world grid: `tileOwner: Int16Array`
  indexed by cell, `-1` = unclaimed);
- contribute **base yields** from their terrain (see 4.2);
- are where you may **place** buildings/districts.
Borders never overlap (claim resolves nearest-city-wins); unclaimed land between
cities is the expansion frontier — preserving the 4X *expand* tension.

### 4.2 Tile yields → sector outputs
Each owned hex yields into the **existing four sectors**, derived from data the map
*already has*:
- **Agriculture** ← `fertility`, grassland/plains biome, river adjacency.
- **Industry** ← mountain/hill `elevation`, forest (timber), mineral sites
  (`siteType` already returns mountain/forest/coastal/plains).
- **Services** ← coastal/river (trade), town centre.
- **Information** ← unlocked later (era), boosted by specific districts.
A city's tile yields sum into a **per-sector tile bonus** that plugs into
`updateSectors` exactly where `buildingBonus()` does today (so the integration
point is surgical). In healthy early play the numbers are calibrated so the
**macro economy is unchanged at founding** — tiles *re-express* current output
spatially before they *add* to it.

### 4.3 Buildings & districts on tiles
Buildings keep their existing defs (`sector`, `bonus`, `cost`, `days`, `max`) and
gain:
- a **placement**: a `{cell}` on an owned hex (stored per building);
- **terrain requirements** (e.g. a port needs coastal; a mine needs mountain);
- **adjacency bonuses** (e.g. a factory next to a mine, a school next to the town
  centre) — the Civ "district synergy" hook, kept *simple and legible* (one or two
  adjacency rules per building, surfaced in the placement UI).
`buildingBonus()` becomes "sum of placed buildings' bonuses **+ adjacency**" — same
shape, richer source. `max` still caps per-city counts so the placement count stays
**bounded and strategic.**

### 4.4 Founding (click-to-found)
A "found city" action (an expedition/settler reaching a tile, or a direct action
per current rules) enters **placement mode**: valid hexes highlight (land,
in-territory range, ≥ `MIN_SETTLEMENT_SPACING` from other cities — *all already
computable*), invalid ones dim. Click → `foundSettlement(x, y)`. This is a thin UI
over existing sim logic.

### 4.5 Wonders
Special, expensive, **one-per-empire** placements with empire-wide effects and
distinctive art — the aspirational long-game goals (Civ wonders / AoW). They reuse
the building-placement system with a global-effect flag and a build race vs. rivals
(ties into the existing rival-AI + win conditions).

---

## 5. Data-model & save changes

- **World grid:** add `tileOwner: Int16Array` (cell → city id, −1 unclaimed). Typed
  array, quantized — cheap to serialize (the roadmap already calls for typed-array
  city maps + a save-size guard, which exists).
- **Settlement:** add `placedBuildings: Array<{ id: string; cell: number }>`
  (replaces/augments `buildings: string[]`; keep `buildings` as a derived view for
  back-compat during migration), and `claimedTiles` (derivable from `tileOwner`, so
  not stored).
- **Migration:** on load, for each old `buildings[]` entry, auto-place onto a valid
  owned tile (deterministic order); backfill `tileOwner` by claiming each city's
  ring. Old saves open and play; the `serialize()` round-trip test + save-size
  guard gate it.

---

## 6. Map interaction & UI (keep it clear)

- **Two altitudes of play.** Empire view (default — the current map/HUD) and a
  **city view** you enter by selecting a city (highlights its worked ring +
  placements). You only see tile detail when you've chosen to look at a city, so
  the macro view stays uncluttered.
- **Placement is modal & guided.** Build a building → enter placement mode → valid
  hexes glow with their adjacency payoff previewed → click to place. Cancel returns
  to macro. No persistent tile-painting cursor.
- **Reuse the build toolbar** (`.buildbar`) — selecting a building arms placement
  instead of silently queueing it abstractly.
- The macro HUD (statehood tracker, treasury, etc.) is never replaced by city
  micro.

---

## 7. Risks & how we hold the line

| Risk | Mitigation |
|---|---|
| **Micromanagement buries the 4X** (the #1 risk) | District-scale placement (few, weighty), auto-worked base tiles, city view is opt-in, bounded placement counts via `max`. Playtest each phase for "does the empire game still read clearly?" |
| Determinism break | Free-function systems + byte-identical serialize diff per PR; deterministic migration order. |
| Save bloat (128² owner grid + placements) | Typed arrays, quantization, the existing save-size regression test. |
| Perf at 128×128 | Tile yields recomputed only on claim/placement change (cached), not per-frame; render placements via the existing culled draw loop. |
| Economy balance drift | Calibrate tiles to **re-express, then add**: macro economy byte-stable at founding, then graded; re-baseline `region-longrun`/`economy-balance` deliberately per phase. |
| Scope creep into SimCity | Hard cap on placement density; every new building must justify a *strategic* (not busywork) choice. |

---

## 8. Phased roadmap (each phase ships; the 4X is always playable)

**Phase A — Expand, spatially (founding + territory).**
Click-to-found UI over the existing `foundSettlement` + spacing rule; claim & render
each city's worked ring (`tileOwner`); show borders. *No economy change yet* — pure
spatial expand. Highest agency-per-effort; lowest risk. **Ships a visibly more
Civ-like 4X immediately.**

**Phase B — Place buildings on tiles (visual + interaction).**
Buildings gain a `cell` and render on their hex; the build toolbar arms placement
mode; terrain requirements enforced. **Economy stays abstract** (bonus still flat) —
so this is byte-identical to today economically, purely adding spatial placement +
art. De-risks the data model + UI before touching yields.

**Phase C — Tiles & adjacency feed the economy (exploit).**
Tile yields and building adjacency become the *source* of sector bonuses, plugged
into `updateSectors` at the `buildingBonus` seam. Calibrated re-express-then-add;
re-baseline the economy suites. This is the real "exploit" depth.

**Phase D — Districts & wonders.**
Multi-building districts with stronger synergies; one-per-empire wonders with
global effects + a rival build race. The aspirational long game.

**Cross-cutting (every phase):** the town/building **art** improves alongside
(Phase 1 visual polish already landed — sprite armies, shaded towns); determinism
+ save-size guards green; a playtest check that the **4X still reads clearly**.

---

## 9. Open decisions (need your call)

1. **Placement density.** Civ-6-district feel (~3–8 weighty placements/city) vs. a
   bit denser. *Recommendation: district-scale, per the north star.*
2. **Worked-tile radius.** Start radius 2 (→3 late game)? Bigger radius = more
   territory pressure (more 4X expand tension) but more tiles to reason about.
3. **Do tiles re-express or purely add?** Recommendation: re-express current output
   at founding (macro byte-stable), then add depth — so balance doesn't lurch.
4. **Founding agent.** Keep the current expedition/settler trigger, or add a direct
   "found here" action? (Affects whether founding costs a unit.)
5. **City view UX.** Zoom-to-city overlay vs. a dedicated city screen.

---

*This doc is the plan we refine before any code. Phase A is the natural first
build — it makes the game visibly more Civ/AoW (found where you click, see your
borders) with the least risk and zero economy disruption, while everything stays a
clear 4X.*
