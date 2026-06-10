# CENTURIA

A colony-to-nation deep-simulation builder, 1900–2100. Begin with twelve
named settlers stepping off a wagon; end the century signing peace treaties
as a great power — RimWorld-intimate at town scale, Cities/Citystate at
state scale, Civ at nation scale, all in 8-bit pixel art over lush
era-evolving backdrops.

- **Design:** [GDD.md](GDD.md) — the full game design document.
- **Milestones:** [01 Tier-1 colony](docs/specs/01-tier1-colony.md) ·
  [02 raids, medicine & relationships](docs/specs/02-raids-medicine-relationships.md) ·
  [03 the flip — town #2, cohorts & Notables](docs/specs/03-the-flip.md) ·
  [04 State layer & procedural world](docs/specs/04-procedural-world.md) ·
  [05 roads, bridges & the art pass](docs/specs/05-roads-and-art.md)
- **Design docs:** [transportation](docs/design/transportation.md)

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
Raiders arrive from week two — your fighters meet them automatically while
the rest hide indoors; palisades (with deliberate gaps) shape the
battlefield. Keep a good medic: untreated wounds fester.

At 20 settlers you can **found a second town** — the moment you do, the
game flips (GDD §2.4): the population becomes cohort statistics on a
region map, your ten most storied settlers become named **Notables** with
roles, and the road to Statehood (3 towns, 500 citizens, a charter)
begins. The old town remains visitable as a living diorama.

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
