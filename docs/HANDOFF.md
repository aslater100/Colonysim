# Session Handoff — 2026-06-11 (post-PR C)

The PR A → B → B2 → C roadmap is complete. Delete this file once the
release below has shipped.

## Where things stand

- **Merged:** PR A (0.1 stabilization), PR B (tile-paint zones), PR #10
  (Electron desktop app + release pipeline), PR #11 / B2 (economy
  buildings).
- **This PR (C):** gates, armed pawns, deer/wolves with real hunting,
  palette hotkeys, in-game menu with save/load, WebAudio SFX. Version
  bumped to 0.3.0.

## Release (pending — needs the user)

No `v*` tag has ever been pushed, so no desktop release exists yet. The
session tooling cannot push tags (403) or dispatch workflows (403), so
after merging this PR, the user should either:

- `git tag v0.3.0 main && git push origin v0.3.0`, or
- run the **Release** workflow on `main` via workflow_dispatch.

That builds Windows/macOS/Linux installers and publishes a GitHub
Release; installed copies then auto-update (Windows/Linux). `v0.2.0` was
never tagged and is superseded — one `v0.3.0` release covers everything.

## Ship loop from now on

After each merged gameplay PR: bump `package.json` version in the PR,
then push the matching `v*` tag after merge.

## User's standing instructions

- Each task = its own draft PR. User merges and play-tests themselves.
- Be frugal with tokens; tests run in CI (test.yml). Run only targeted
  local tests when diagnosing.
- Goal: "fully fleshed out game based on everything planned."

## What might come next (no committed roadmap)

Ideas consistent with the GDD: combat polish (ranged weapons, a
smithy), animal husbandry (tamed deer → pasture), fishing on river
sites, region-tier save/load (the in-game menu disables saving after
the flip), music/ambience beyond SFX, more event variety.

## Architecture notes for the new systems (PR C)

- Gates: `Tile.gate`/`gatePlan`, shared `wallHp` (`TUNING.gateMaxHp`).
  `World.passable(x, y, hostile)` / `findPath(..., hostile)` — raiders,
  wolves and deer path with `hostile = true`; raiders bash the nearest
  wall *or* gate via `nearestBarrier()`.
- Animals: `sim.animals: Animal[]` (deer/wolf), updated in
  `updateAnimals()`. Deer flee inside `deerFleeRadius` (3) which is
  deliberately < `huntRange` (4.5) so hunters shoot without spooking;
  the hunt task stalks `task.animalId`, kills, and the hunter carries
  meals back. Empty woods fall back to the old abstract trip. Wolves
  prey on close settlers (who counterattack) or deer, and leave after
  `wolfStayDays` or when mauled.
- Armed: `Settler.armed` — fighters spend `spearWoodCost` wood at raid
  start; `settlerDamagePerHour()` adds `spearDamageBonus`.
- Save/load: `sim.serialize()` / `Simulation.deserialize()` — seed
  rebuilds RegionMap/Weather/worldgen; everything mutable (tiles,
  agents, stocks, schedules, RNG word via `Rng.get/setState`) is
  captured; `reserved` rebuilds from in-flight tasks. The menu stores
  to localStorage `centuria-save`; loading sets a sessionStorage flag
  and reloads (see `bootSim()` in main.ts). Determinism after load is
  covered by a test.
- Hotkeys live in `Hud.handleKey()`; menu in `Hud.openMenu()` (pauses
  while open). SFX: `src/ui/audio.ts`, driven by palette clicks and a
  log watcher in main.ts (`playLogSounds`).
- Test note: deer spawn at founding shifts every seed's RNG sequence —
  all 52 tests were re-run locally and pass, including the 60-day
  survival test.
