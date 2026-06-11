# Milestone 1 — Tier-1 Colony (COMPLETE)

## Load-bearing architecture

- `src/sim/` is headless, DOM-free; `Simulation(seed)` driven by `tick()` — enables the tuning harness (`npm run sim`) and keeps the door open to swapping the renderer.
- Fixed timestep: 1 tick = 4 game-min; 8 ticks/real-second at speed 1 (45 s/game-day). Speeds ×1/×3/×8.
- Content in `src/data/*.json`; tuning constants centralized in `defs.ts:TUNING`.
- Renderer split: `ui/sprites.ts` draws 8-bit foreground (16px grid, ≤4 colors); `ui/render.ts` draws painterly parallax backdrop (sky/stars/sun/moon/ridges).

## Systems

**Calendar:** 15-day seasons, 60-day years, start Spring 1900.
**Temperature:** season base (10/22/8/−8 °C) + diurnal ±6 + cold-snap −10; indoor = outdoor+14 with 14 °C hearth floor.
**Needs:** food/rest/warmth/recreation/social (0–100), decay per `TUNING.needDecayPerHour`.
**Mood:** weighted needs (35/25/15/15/10) + trait base + thoughts − soft-cap penalty; smoothed 5%/tick. Mental break below 20: (20−mood)×1.5 %/day → 1 day refusing work.
**Health:** starvation −2/h, freeze −3/h, regen +0.5/h when fed and warm; 0 = death.
**Work:** priorities 0–3 per settler per job; skill 0–10 sets speed (0.5+0.1×skill), grows with use.
**Food chain:** farm tile → 12-day growth (growing seasons only; winter kills) → 10 grain; cookhouse: 1 grain → 1 meal (70 food vs 35 raw — cooking doubles efficiency). ~1 farm tile feeds ~1 settler.
**Construction:** blueprint → haul from stockpile → build; cancel refunds.
**Events** (every 3–6 days): wanderer joins (gated on food > 2×pop), cold snap, rats eat 10% grain, festival (+8 mood, 2 days).

## Balance

Soft cap 60 settlers: −0.75% work efficiency + −1 mood per 10 over. Hard cap 150. Wagon provisions (160 meals, 40 grain) ≈ 3-week fuse; colony without farms starves by day ~40. Three killers found and fixed during tuning: sleeping-through-starvation, the winter warming-state deadlock, 25%-rat-loss erasing the winter buffer.
