# Session Handoff — 2026-06-11 (post-M6c)

## Where things stand

- **Merged:** PR A (0.1 stabilization), PR B (tile-paint zones), PR #10
  (Electron desktop app + release pipeline), PR #11 / B2 (economy
  buildings), PR #12 / C (gates, wildlife, armed pawns, menu, save/load,
  SFX — v0.3.0), PR #13 / M6b (region routes — v0.4.0), PR #14 (town UX:
  drag-paint roads, fog of war, region minimap).
- **This PR (M6c):** the rail era — `rail` route kind (capacity 1,200,
  £8/terrain-cost, £0.5/cell/mo upkeep) behind the Railworks gate
  (State + year ≥ 1912), station + cross-tie + animated-train art in the
  region view, the storm washout → paid-repair loop (`repairCost` /
  `repairRoute`), and the +25% militia relief bonus when a built link
  (road/rail) connects a raided town to a larger one. Version 0.5.0.
  **The transportation design (docs/design/transportation.md) is now
  fully implemented (6a/6b/6c).**
- **Parallel PRs in flight (same session):** animal husbandry
  (`claude/animal-husbandry-ifaqdv`) and combat polish: smithy + ranged
  weapons (`claude/combat-smithy-ifaqdv`), both town-tier, both branched
  from main. They may need trivial rebases against each other; merge in
  any order, M6c is independent of both. Neither bumps the version —
  bump on merge per the ship loop.

## Release (pending — needs the user)

No `v*` tag has ever been pushed, so no desktop release exists yet. The
session tooling cannot push tags (403) or dispatch workflows (403). After
merging, either `git tag v0.5.0 main && git push origin v0.5.0`, or run
the **Release** workflow on `main` via workflow_dispatch. One release
supersedes everything earlier (0.2/0.3/0.4 were never tagged).

## Ship loop

After each merged gameplay PR: bump `package.json` version in the PR,
then push the matching `v*` tag after merge.

## User's standing instructions

- Each task = its own draft PR. User merges and play-tests themselves.
- Be frugal with tokens; tests and typecheck run in CI (test.yml) — do
  not run the full suite locally, push and let GitHub validate.
- Goal: "fully fleshed out game based on everything planned."

## The plan from here

Transportation is complete. Open ideas consistent with the GDD (minus
whatever the two in-flight PRs land): town-tier fishing jobs,
region-tier save/load (the in-game menu disables saving after the flip —
`sim.serialize()` is town-tier only; routes/settlements/notables need a
serializer), music/ambience, more event variety, Tier-2 goods markets
along routes (arbitrage, GDD §5.2), paved-highway era (1945+, ×2.2 —
the rail stranded-asset lesson, transportation.md §5).

## Architecture notes for M6c

- `RouteKind` now `'trail' | 'road' | 'rail'`; `KIND_RANK` enforces
  upgrade-only (`buildLink` refuses downgrades). `roadCost`/`buildRoad`
  kept as thin wrappers over `linkCost`/`buildLink` (tests use them).
- `railUnlocked()` = `stateProclaimed && year >= RAIL_ERA_YEAR (1912)`;
  one-time RAILWORKS log fires from `dailyUpdate`.
- Washouts: in `weatherRoutes`, on storm days, 12% chance one random
  built route with condition > 40 loses 45 condition with a log naming
  the repair price. `repairRoute` restores to 100 from the treasury;
  monthly maintenance still heals +8/mo as the slow path. NOTE: the
  washout roll consumes RNG draws on storm days — region sequences
  shifted again vs 0.4.0 (tests are behavior-based, suite unaffected).
- `routePath` gained a `usable` filter; `reliefLine(t)` = some larger
  town reachable via road/rail legs only → ×1.25 militia in the raid
  branch of `fireEvent`.
- Region view: rail renders as a steel line with cross-ties plus a
  little out-and-back engine (`drawTrain` — links-not-vehicles, flavor
  only; silent below condition 20); rail-connected towns get a depot
  sprite. Town panel: road buttons now only offered over trails, rail
  buttons once unlocked, repair buttons on built links below 85%.
- Region tier still has no save/load.
