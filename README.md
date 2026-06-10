# CENTURIA

A colony-to-nation deep-simulation builder, 1900–2100. Begin with twelve
named settlers stepping off a wagon; end the century signing peace treaties
as a great power — RimWorld-intimate at town scale, Cities/Citystate at
state scale, Civ at nation scale, all in 8-bit pixel art over lush
era-evolving backdrops.

- **Design:** [GDD.md](GDD.md) — the full game design document.
- **Current milestone:** Tier-1 colony prototype
  ([spec](docs/specs/01-tier1-colony.md)).

## Run it

```bash
npm install
npm run dev      # play in the browser
npm test         # simulation tests
npm run sim      # headless tuning harness: `npm run sim -- <days> <runs>`
npm run build    # production build
```

## Playing the prototype

You start in Spring 1900 with 12 settlers, two cabins, a stockpile, and
about three weeks of provisions. Build farm plots and a cookhouse before
the wagon food runs out; mark trees for wood; get cabins up before winter.

- **Build menu** (left): place blueprints; settlers haul wood and build.
  Shift-click to place repeatedly. *Chop Trees* marks trees for felling.
- **Click a settler** for needs, mood, traits, thoughts, and current task;
  **Work Priorities** opens the per-settler job table (click cells, 0–3).
- **Space** pause · **1/2/3** speed · **WASD/arrows** pan · **Esc** deselect.

## Layout

```
GDD.md            the design document
docs/specs/       per-milestone implementation specs
src/sim/          headless deterministic simulation core (no DOM)
src/data/         moddable JSON content defs (buildings, traits, names)
src/ui/           canvas renderer (8-bit sprites + parallax backdrop) and HUD
tests/            vitest simulation tests
```
