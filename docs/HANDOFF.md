# Session Handoff — 2026-06-11 (post-v0.9.0)

## Where things stand

Merged this session, in order (user merges fast — keep PRs small):

- **#15 / M6c (v0.5.0):** rail era — `rail` kind behind the Railworks
  gate (State + 1912), storm washout → `repairRoute` loop, +25% militia
  relief over built links, stations/ties/train art. Transportation
  6a/6b/6c complete.
- **#16 (v0.6.0):** region-tier save/load — `RegionSim.serialize` /
  `.deserialize(json, sim)`; v2 combined `{v:2, mode:'region', town,
  region}` under the `centuria-save` key (v1 town saves still load);
  menu now opens in region mode (Esc / top-bar button).
- **#17 (v0.7.0):** region event deck 5 → 9 — highwaymen (rob caravan
  *freight* on rotted routes; the freight gate matters, robbing
  subsistence starved the harness), Notable bio beats, fires (State
  brigade), prospectors. Deck balance held at 45/55 bad-to-good.
- **#18 (v0.8.0):** region markets — GDD §5.2 price rule per town
  (food/wood, ±2%/day clamp, 0.25×–4× band), monthly `traders()`
  arbitraging along routes when margin > 1.5× freight, 5% State levy,
  turnover in GDP. The levy can part-fund road upkeep (the M6b rot
  test gluts markets to kill margins).
- **#19 (v0.9.0):** asphalt age — `highway` kind (cap 900, £3, £0.15)
  behind State + 1945; ranks above rail so paving *replaces* steel:
  the stranded-asset lesson as a player choice. The trail → road →
  rail → highway century is fully built.

## In flight (check before starting anything town-tier)

Two parallel sessions were launched on town-tier features, branched
from pre-#15 main; if their PRs aren't open yet, the branches may
still appear later:

- `claude/animal-husbandry-ifaqdv` — pastures/livestock/butchering.
- `claude/combat-smithy-ifaqdv` — smithy + crafted melee/ranged arms.

Neither bumps the version (bump on merge). Both may need trivial
rebases against each other; both are independent of the region-tier
work above.

## Release (pending — needs the user)

No `v*` tag has ever been pushed; session tooling gets 403 on tags and
workflow dispatch. One `git tag v0.9.0 main && git push origin v0.9.0`
(or the Release workflow on main) supersedes everything earlier.

## User's standing instructions

- Each task = its own draft PR. User merges and play-tests themselves.
- Tests/typecheck run in CI (test.yml); don't run the full suite
  locally — targeted files only when diagnosing. NOTE: vitest doesn't
  typecheck; a quick `npx tsc --noEmit` before pushing catches TS
  errors that CI's build step would bounce (cost one round-trip in
  #18).
- Goal: "fully fleshed out game based on everything planned."

## NEXT COMMITTED TASK: the music & ambience layer

Design agreed, not yet built (an earlier sketch was discarded
uncommitted — start fresh):

- **Same no-assets philosophy as `Sfx`** (src/ui/audio.ts): pure
  WebAudio oscillators/noise, no files.
- **`Sfx.context()`**: expose the lazily-created AudioContext (return
  null until `unlock()` has run; resume if suspended) so a `Music`
  class can share it.
- **`Music` class** in audio.ts:
  - *Generative lullaby:* sparse pentatonic melody, seeded from
    `(day, step)` so each day deterministically hums its own tune —
    hash-pick from a scale, ~25% rests, soft triangle notes ~0.03
    gain, a low sine drone under every fourth step.
  - *Season keys it:* roots A3/C4/G3/E3 for spring/summer/autumn/
    winter; winter pace slower (~1.25s/step vs ~0.8).
  - *Danger darkens it:* minor pentatonic + faster pace while
    `sim.raidActive` (town) or any settlement's `lastRaidDay` within
    ~3 days (region).
  - *Weather bed:* one looped lightly-pinked noise buffer →
    lowpass → gain; per-sky targets via `setTargetAtTime` (storm
    ~0.05 gain/1.5kHz, rain ~0.03/2.6kHz, snow-wind ~0.02/420Hz,
    overcast whisper, clear silent).
  - `muted` with its own `centuria-music-off` localStorage pref;
    also silent while `sfx.muted`.
- **Wiring:** `music.tick(seasonIndex, sky, day, danger)` once per
  frame in main.ts's loop (source = sim or region by mode — both
  expose `seasonIndex`, `weather`, `day`); a `Music: ON/OFF` button in
  the hud menu next to `Sound:` (hud gets a `music` ref from main).
- **No sim impact, no tests needed** (vitest env has no AudioContext;
  all paths null-guard). CI's tsc is the check that matters.
- **Conflict watch:** main.ts/hud.ts may also be touched by the two
  in-flight town-tier PRs — keep edits additive.

## After that (open ideas consistent with the GDD)

Town-tier fishing jobs; town-tier event variety; maglev/automated
freight (2000+, speculative era, transportation.md §5); Tier-2 zoning
and the goods set beyond food/wood (GDD §5.1/§5.2) as the markets
slice grows up.
