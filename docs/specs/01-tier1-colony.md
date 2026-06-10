# Milestone 1 Spec — Tier-1 Colony (the founding town)

Implements the first rung of the GDD's spine (§2): the RimWorld-granularity
town phase, as a playable vertical slice. This document records what is in
the slice, the exact numbers used, and what is deliberately deferred.

## Architecture (load-bearing decisions)

- **Simulation core is headless and deterministic.** `src/sim/` has no DOM
  dependency; `Simulation` takes a seed and is driven by `tick()`. This is
  what makes the GDD §13.3 tuning harness possible (`npm run sim`), and it
  keeps the door open to porting the renderer (e.g. to an engine) without
  touching the sim.
- **Fixed timestep.** 1 tick = 4 game-minutes; 8 ticks/real-second at speed 1
  ⇒ 45 s per game day (GDD §8.6's Town-tier rate). Speeds ×1/×3/×8.
- **Content is data.** Buildings, traits, and names live in `src/data/*.json`
  (GDD §8.8 moddability). Tuning constants are centralized in
  `defs.ts:TUNING` so the harness can sweep them.
- **Renderer split per GDD §3.1:** `ui/sprites.ts` draws strict 8-bit
  foreground sprites (16px grid, ≤4 colors, 1px outline) procedurally;
  `ui/render.ts` draws the painterly parallax backdrop (sky by hour, stars,
  sun/moon, three ridge bands, haze) that gameplay never touches.

## Systems in the slice

| System | Spec |
|---|---|
| Calendar | 15-day seasons, 60-day years, start Spring 1900 |
| Temperature | season base (10/22/8/−8 °C) + diurnal ±6 + cold-snap −10; interiors = outdoor+14 with a 14 °C hearth floor |
| Needs | food/rest/warmth/recreation/social, 0–100; decay per `TUNING.needDecayPerHour` |
| Mood | weighted needs (35/25/15/15/10) + trait base + thoughts − soft-cap penalty; smoothed 5%/tick |
| Mental break | below mood 20: (20−mood)×1.5 %/day → 1 day of refusing work |
| Health | starvation −2/h, freezing −3/h, regen +0.5/h when fed and warm; 0 = death |
| Work | priorities 0–3 per settler per job (build/farm/chop/cook/haul); task pick = priority desc, then distance; skill 0–10 sets speed (0.5+0.1·skill) and grows with use |
| Food chain | farm tile: sow → 12 days growth (growing seasons only; winter kills crops) → 10 grain; cookhouse: 1 grain → 1 meal (70 food vs 35 raw, so cooking doubles food efficiency); ~1 farm tile feeds ~1 settler |
| Construction | blueprint → haul wood from stockpile → build work; cancel refunds |
| Events | every 3–6 days: wanderer joins (gated on food stores > 2×pop), 3-day cold snap, rats eat 10% of grain, festival (+8 mood, 2 days) |
| The spine hook | soft cap at 60 settlers: −0.75% work efficiency per settler over, −1 mood/10 over; hard cap 150; immigration stops when full (GDD §2.3) |
| Failure state | depopulation — everyone dead ends the run |

## Balance evidence (headless harness, naive auto-player)

- 8/8 seeds survive 75 days (two winters' worth of stress incl. one full
  winter), pop 12 → ~17, avg mood ~68.
- A colony that builds no farms starves at day ~40 (asserted in tests):
  wagon provisions (160 meals, 40 grain) are a ~3-week fuse.
- Killers found and fixed during tuning, kept as regression knowledge:
  sleeping through starvation, the winter "warming-state" deadlock,
  rat losses at 25% erasing exactly one winter buffer.

## Deferred (next milestones, in GDD build order)

1. Raids and defense (the remaining Tier-1 threat class), medical treatment,
   relationships between settlers.
2. Expeditions to found town #2 → the simulation flip + Notables carve-out
   (GDD §2.4) — the next *structural* milestone.
3. Era palette swaps, audio, save/load, more goods (wood is the only
   build material in the slice).
