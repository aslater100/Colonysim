# Handoff — Centuria Development Guide

**Last updated:** 2026-06-26 · **Tests:** 826 passing · **Version:** v1.5.0 · **Status:** Phases 1–18 complete; performance-gated deep-expansion track underway (PRs #264, #265, #269 merged; audio stem override seam now wired — see below)

## Recent session (2026-06-26) — audio stem override seam (`AudioRegistry`)

Built the **audio half of the asset pipeline** — the sibling of `AssetRegistry`
(#265, art) and the `backdrop-<era>` slot. `src/ui/audio/audioRegistry.ts`
`AudioRegistry` loads recorded stems listed in `public/audio/audio_manifest.json`,
decodes them on a live `AudioContext`, and serves them by slot with **procedural
fallback** — so the whole WebAudio soundtrack keeps playing with real stems
layered on, or (the shipped default, empty `items`) entirely without them.
Verified: tsc clean, **826 tests** (5 new), `bench-region` PASS (60fps), vite
build green (manifest ships in `dist/audio/`), and a **real-Chromium probe**
confirming the shipped manifest resolves all 6 era slots with **`anyLoaded:false`**
→ byte-identical procedural playback.

- **Pure helpers (unit-tested in Node):** `musicStemSlot(year)` / `ambienceStemSlot(year)`
  → `music-<era>` / `ambience-<era>`, in lockstep with the music engine's
  `eraForYear` so the recorded bed and the synth turn over on the same windows.
  Era ids: ragtime · chipjazz · midcentury · analog · electronica · future.
- **`AudioRegistry`** mirrors `AssetRegistry` exactly: `load(ctx, dir='audio')`
  fetches the manifest, fires an independent fetch→`decodeAudioData` per stem
  (one bad stem never blocks the rest), `get`/`has` by slot. **Buffers are bound
  to the context they decode on**, so music and soundscape each own an instance.
- **Wired into `Music` (`music.ts`):** `setStems(reg)` attaches it; `updateStem()`
  (called from `update()`) crossfades the `music-<era>` bed in on the **same
  master gain**, swapping beds at era turnover (0.3s fade, no click) and **ducking
  by intensity** — the recording owns the calm mix, the procedural kit rises with
  tension so they never pile up. `main.ts` constructs the registry and calls
  `music.setStems(...)`. No stems loaded → `updateStem` is a no-op → unchanged.

**Ambience beds — done (this branch).** `Soundscape` now owns its **own**
`AudioRegistry` instance (a second one — buffers can't cross contexts): `setAmbience(reg)`
attaches it, and `updateBed()` (called from `update()` after the master ease,
before the pause return) loops the `ambience-<era>` bed under the diegetic events
on the **same `masterGain`** (so pause/disable already silence it), swapping beds
at era turnover with a 0.4s fade. `main.ts` calls `soundscape.setAmbience(...)`.
No beds → no-op → unchanged. Verified: tsc clean, 826 tests, bench PASS, build
green, Chromium probe — all **12** era slots (music + ambience) resolve from the
shipped manifest with `anyLoaded:false`.

**Next on audio:** **bulk generation** of the actual stems — still blocked on
`HF_TOKEN` (unset in web env) **+ an encoder** (`sharp`/`ffmpeg` not installed);
provision those before generating. Every audio change stays gated by
`scripts/bench-region.ts`.

## Earlier session (2026-06-26) — per-band parallax + horizon glow

Extended `src/ui/backdrop.ts` to the **two follow-ups the prior session flagged**
as next: true independent per-layer parallax, and a stat-driven horizon glow.
Verified: tsc clean, **821 tests** (6 new), `bench-region` PASS (60fps held, all
stages), vite build green, and a real-Chromium smoke render across 5 states
(dawn/crisis/solarpunk/storm, including a ±9999px extreme pan) reporting
**0.000% void gap** everywhere and a correctly-tinted horizon (crisis → red 255
ember, solarpunk → green-forward, storm → dim/desaturated).

- **Per-band blits (replaces the single composite gradient):** `Backdrop` now
  paints **one strip canvas per band** (`BandStrip`), each oversized by the 96px
  `MARGIN` bleed so the gradient's clamped end-colours flood the top/bottom and a
  parallax offset slides into matching colour — never a void. `draw()` blits them
  **back-to-front** (distant first), each offset by its **own** `band.parallax`
  fraction of `camX/camY`, so distant bands genuinely lag and near bands track —
  real per-layer depth, not one shared drift. Nearer bands paint over the seams.
- **Stat-driven horizon glow:** new pure `buildHorizonGlow(inputs)` → a
  `BackdropGlow {y, color, intensity}` carried on the palette (no new cache keys —
  it reads era/branch/sky/tension, all already keyed). Calm = faint dusk warmth,
  tense = amber unease, crisis = a **red ember** (overrides any branch tint). A
  calm *future* sky keeps its branch's signature light (solarpunk cyan-green,
  dystopia sodium-amber, drowned cold). Heavy weather smothers the bloom. Drawn
  per-frame as an **additive** (`globalCompositeOperation:'lighter'`) radial
  centred on the horizon, drifting with the near-sky parallax (`GLOW_PARALLAX`).

**Next on the backdrop:** real painted `backdrop-<era>` art once the asset
pipeline has `HF_TOKEN` + an encoder (the override seam already composites it on
top with the same parallax). Sample-stem music / ambience beds
(`audioRegistry.ts`) remain the other half of the atmosphere layer.

## Earlier session (2026-06-26) — parallax atmosphere backdrop (`drawBackdrop`)

Landed the first **Track-B atmosphere layer**: `src/ui/backdrop.ts` — the 5-band
parallax sky that fills the void the terrain cache leaves at the map margins (and
the whole frame when zoomed out), replacing the flat `#10141c` fill. Verified:
tsc clean, **815 tests** (10 new), `bench-region` PASS (60fps held), vite build
green, and a real-Chromium smoke render (clean multi-band gradient, gap-free).

- **Pure core (unit-tested in Node, like `registry.ts`):** `eraIdForYear` (sky
  era windows mirroring the music engine), `statBand` (tension → calm/tense/
  crisis), and `buildBackdropPalette({year, seasonIndex, branch, sky, tension})`
  → 5 depth-ordered bands (rising `parallax`) + a cache `key` + an override
  `slot` (`backdrop-<era>`). Every output is a pure read — no RNG, no save state.
  Era × season × era-branch × weather × tension each shift the colours (branch
  *repaints* the future sky: solarpunk cyan-green, dystopia smog-amber, drowned
  grey-blue; crisis reddens the horizon; storm darkens; winter desaturates).
- **DOM `Backdrop` class:** offscreen gradient re-painted only when the palette
  `key` changes (oversized by a 96px `MARGIN` so the parallax offset never
  exposes an edge); `draw()` blits it in **screen space before the camera
  transform** with a gentle pan-fraction parallax. If `AssetRegistry` holds the
  `backdrop-<era>` slot, a painted sky composites on top — the same procedural-
  fallback discipline as town sprites.
- **Wired in `regionview.ts`:** new `drawBackdrop(W,H)` called right after the
  base fill in `draw()` (screen space, behind the terrain blit). Note: the
  HANDOFF plan said "inside the camera transform / world-space"; screen-space is
  correct here — the terrain cache covers world-space opaquely, so the backdrop
  must sit in front of the void fill but behind the (camera-transformed) map, and
  parallax is a fraction of `camX/camY` applied at blit.

**Next on the backdrop:** per-band blits (true independent parallax per layer,
the data model already carries `band.parallax`); a stat-driven horizon glow /
"skyline" cue; then real painted `backdrop-<era>` art once the asset pipeline has
`HF_TOKEN` + an encoder. Sample-stem music / ambience beds (`audioRegistry.ts`)
remain the other half of the atmosphere layer.

## Earlier session (2026-06-26) — deep-expansion foundation (PRs #264, #265 merged)

Kickoff of the **"1GB" deep-expansion roadmap**: a performance-gated two-track effort —
simulation depth + an AI-generated asset pipeline toward a ~1GB production build. The full
roadmap is the **"Deep-Expansion Roadmap"** section below (folded into this doc so it persists
across sessions). Two foundation PRs merged to `main`, each verified (tsc clean, **805 tests**,
vite build green):

- **#264 — dynamic audio tension + 4X perf guard + restored headless.**
  - `RegionSim.tensionScalar()` (region.ts, just after the `dateLabel` getter) returns a 0–1
    scalar from `playerWar.support` / `maxGrievance` / `depressionDepth`, now fed to
    `music.update` + `soundscape.update` in `main.ts`. **The `tension` input was previously
    hardcoded to `0`**, so the audio engine's dynamic mixing was dead. Pure read (no RNG) —
    save/load determinism preserved.
  - **`scripts/bench-region.ts`** — the perf guard the shipping 4X game lacked. (The old
    `bench-scale.ts`/`bench-agents.ts` benched the **dropped town engine** — `Simulation`/
    `AgentStore`/`FlowField` — not `RegionSim`; both were removed in the backdrop PR since the
    modules they imported no longer exist.) This benches `RegionSim.tick()` at
    early-colony / mid-nation / late-nation against the 16.7ms / 64-tick frame budget, reporting
    mean **and worst-case** ms/tick. Baseline: mean ~0.003–0.007ms (64-tick frame ~0.2–0.4ms),
    worst single tick ~10–12ms (the monthly/yearly spike — the stutter to watch). **This is the
    60fps-at-all-stages gate; run it on every perf-sensitive change.**
  - **`src/sim/headless.ts`** restored — `npm run sim` pointed at a missing file. Long-run
    balance harness: ticks to a target year, reports treasury/GDP, inflation, pop, satisfaction.

- **#265 — live asset-override seam for the 4X map (`AssetRegistry`).**
  - **The override seam was dormant:** `buildSprites()`/`applyOverrides()` (`spriteOverrides.ts`)
    were only used by `sprites-preview.ts`, never by the live `RegionView` (which drew its own
    procedural glyphs). Now `src/ui/assets/registry.ts` `AssetRegistry` loads PNG/WebP listed in
    `public/assets/asset_manifest.json`, served by slot name with **procedural fallback**.
  - `RegionView` builds the registry, loads the manifest on construction, and `drawTownTier`
    draws a `town-<tier>` override when present (`townSpriteTier` / `TOWN_TIER_PX`), else the
    existing procedural shack→castle art. **No manifest items (the shipped default) = byte-identical
    behaviour**; generated/hand-made art slots in per population tier with zero code change. This
    is the integration point the AI asset pipeline and modders both target.

**Stale-doc corrections** (verified in code this session): the 4X boot path is
`index.html → src/main.ts → new RegionView` (there is no `core.html`/`coreview.ts`); `npm run sim`
is restored; the audio `tension` is wired; Phase 15 (FX) and Phase 16 (Warfare, ~80%) are genuinely
landed — **extend, don't rebuild**; Phase 14 (zoning/city-services) and the 5 parallax backdrop bands
are the real gaps.

**Next session — asset pipeline (integration seams already mapped; code-only, procedural fallback):**
- Parallax **`drawBackdrop()`**: insert in `regionview.ts` `draw()` just **before** the
  `g.drawImage(this.mapCache, 0, 0)` blit (~line 646, inside the camera transform → world-space);
  composite to an offscreen canvas keyed by era/season/stat-band, blit + parallax-offset per frame.
- **Sample-stem music**: attach in `Music.update()` (`music.ts`) beside the procedural synth on the
  same `master` gain; `eraForYear()` selects the era; crossfade by `intensity` (already tension-driven).
- **Ambience beds**: attach in `Soundscape.update()` after `ensure()`; loop under the diegetic events.
- New `src/ui/audio/audioRegistry.ts` + `audio_manifest.json` mirror `AssetRegistry`. **Bulk generation
  needs `HF_TOKEN`** (unset in the web env) **+ an encoder** (`sharp`/`ffmpeg` not installed) — provision
  those first. Every render/sim change stays gated by `scripts/bench-region.ts`.

## Deep-Expansion Roadmap — "The 1GB Simulation"

The forward plan: make Centuria a *much larger* game (~1 GB) — AAA-scale depth **and** production
value — while it stays smooth (60 fps, no stutter) at every stage. Size can only come from real
assets (the game is ~2.9 MB of code + 100 KB JSON with **zero binary assets** today; all art is
procedural Canvas 2D, all audio procedural WebAudio). Per GDD §3.1 the byte/beauty budget lives in
the atmosphere layer; the crisp foreground stays cheap.

**Locked decisions (user):** (1) one roadmap covering **both** simulation depth and audio-visual
production; (2) **AI-generated asset pipeline** (extend `scripts/hf-sprites.ts`); (3) **hybrid
distribution** — bundle core + early-era assets, stream later eras / 2040+ branches; (4) build a
**vertical slice** first; (5) **60 fps at all stages is a hard per-phase gate**, not a cleanup pass.

**Ground-truth (verified in code):** override seam was dormant → now wired (#265); `tension` was
hardcoded 0 → now wired (#264); `npm run sim` was broken → restored (#264); **Phase 15 (FX) &
Phase 16 (Warfare, ~80%) are genuinely landed — extend, don't rebuild**; Phase 14 (zoning/
city-services) and the 5 parallax backdrop bands are the real gaps. `serialize()` is a flat
field-dump with `?? default` backfill — **every new field must serialize + backfill** or tests/old
saves break.

### Track A — Asset pipeline ("the 1 GB engine")
- **Byte budget (Standard ≈ 1 GB):** the GB comes from audio (music stems ~0.4 GB OGG / ~4 GB FLAC,
  ambience ~256 MB, voice ~144 MB), cinematics-as-still-sequences (~375 MB via the existing
  `drawCinematic()`), parallax backdrops (~248 MB), Notable portraits (layered → ~300 MB), and
  building/unit/terrain/UI sprite sheets (~300 MB). **Image assets alone reach ~1 GB** — not solely
  dependent on hard-to-generate audio/video; FLAC stems are genuine quality, not bitrate padding.
- **Generation:** make `hf-sprites.ts`'s `CATALOG` a *loader* over `src/data/asset_manifest.json` +
  `audio_manifest.json` (slot, category, era, prompt, sha256); keep its `generateSprite()` + 503
  retry + `--dry-run`; add `--category/--era` filters and `scripts/hf-audio.ts`. `gen/post.ts`
  quantizes to era palettes (also the art-coherence guard) + OGG/Opus encode.
- **Integration:** `src/ui/assets/registry.ts` `AssetRegistry` is **shipped** (live override seam,
  procedural fallback). Next: `src/ui/audio/audioRegistry.ts` + `musicPlayer.ts` (no file-audio
  loader exists today) sitting beside procedural `Music` behind a common `IMusicEngine`, crossfading
  by the now-wired `tension`; `portraitSystem.ts` composites face layers per Notable.
- **Distribution (hybrid):** git stays code-only (`.gitignore` the generated `public/audio`,
  `public/backdrops`, `public/sprites/*.png`); asset packs = versioned zips as **GitHub Release
  assets** (≤2 GB/file, the channel `electron-updater` already uses); thin installer (~150–250 MB,
  eras 1–2) + on-demand era packs SHA-256-verified into `userData/packs`; lazy-by-era + prefetch.

### Track B — Simulation depth (extend real code; don't rebuild)
- **Economy (§5.2):** `INTERMEDIATE_GOODS` → full ~44-good set + supply-shock cascades
  (`supplyChainHealth`); physical goods on routes (transit × congestion); emergent `exchangeRate`;
  credit-rating coupon compounding. (`region.ts` `monthlyEconomy`, `economy.ts`, `defs.ts`)
- **Military (§7, on Phase-16 base):** `Front` model (contact lines, weekly `combatPower` ratio);
  war-support decay/rally (regime-modulated); casualty→cohort scar; peace via the deal engine +
  revanchism. (`region.ts` warfare ~10739–11005)
- **AI (§6.3):** personality → build/research priorities; discoverable agendas via `intel`;
  situation-based `DealVerdict` valuation; rival regime change via `TRANSITION_CHAINS`;
  tier-asymmetry guardrails by `AI_DIFFICULTY`.
- **Map (§6.2):** basin-partition worldgen (6–8 basins, resource skew); climate ghost-waterline live
  overlay (not in the static cache). `REGION_N=128` default; bigger sizes a stress-tested knob.
- **UI/UX (§11):** decompose-every-number tooltips; Century Graph screen; era UI skins; advisor
  briefs surfaced; **`drawBackdrop(era,branch,weather,stats)`** 5-band compositor w/ live-stats skyline.
- **Features:** Phase 14 zoning/city-services (per-settlement grid maps — land value, pollution
  diffusion, services, brownouts, R/C/I/O demand, in a new `zoning-system.ts`); Phase 10 climate
  depth (20-yr lag, sea-rise flooding, adaptation, accords).

### Track C — Engineering foundations
- **Modularize `region.ts` as free functions, NOT subclasses:** `src/sim/systems/*` exporting
  `fn(r: RegionSim, …)`; `tick()` becomes a dispatcher; state + `serialize()` stay on `RegionSim`.
  Free functions preserve RNG-consumption order (the determinism constraint, #236) where class
  refactors wouldn't. One leaf subsystem per PR, each guarded by a fixed-seed byte-identical
  `serialize()` diff. Phase-14 maps: coarse quantized typed arrays; migrate save off `localStorage`
  to filesystem/IndexedDB (it's near the cap already).

### Track D — Performance & smoothness (hard, per-phase gate)
- **Frame contract:** render ≤16.7 ms/frame; **budget the sim catch-up by wall-clock (~8 ms), not
  the 64-iteration count** (`main.ts:274`) so a heavy late tick can't stutter — let the calendar lag
  at 8× instead. Era/asset transitions ≤1 dropped frame (async + prefetched).
- **The guard:** `scripts/bench-region.ts` (shipped) — boots `RegionSim` at early/mid/late, reports
  mean + worst-case ms/tick vs the 16.7 ms / 64-tick budget. **`bench-region` is the 4X guard**
  (the old town-engine `bench-scale`/`bench-agents` were removed). Every perf-sensitive PR must
  show no "DROPS".
- **Render:** keep the static `mapCache`; composite backdrop bands once per era/stat-band change to
  an offscreen canvas (blit + parallax-offset per frame); pre-render Phase-14 heatmaps offscreen.
  **WebGL only if `bench-region` proves Canvas 2D can't hold 60 fps** — and then one overlay canvas,
  not an engine swap.
- **Asset I/O / memory:** `createImageBitmap` + `decodeAudioData` (async, off the render path);
  LRU-evict to keep only current+adjacent era resident (≤~1.5 GB working set); quality tiers cap disk+RAM.

### Phased roadmap (each shippable; balance- AND perf-gated) — **bold = the literal gigabyte**
`A0` wire seams + perf guard **(done — #264/#265)** → `A1` pipeline generalization (manifests,
`hf-audio`, audio/music registries) → `A2` distribution & packs (+ save → filesystem) →
**`B1-art` parallax backdrops + era UI skins** → **`B2-audio` music stems + ambience + voice** →
`C1` `region.ts` modularization → `D1-econ` 44-good economy + FX → `D2-mil` warfare Front model →
`D3-ai` rival agency → `E1` climate depth → `E2` zoning/city-services → `F1` UI/UX + cinematics +
quality tiers. Tracks A (assets/UI) and B (sim core) run in parallel (disjoint files).

### Top risks (stress-tested)
1. **Art-direction coherence at AI volume** → palette quantization in `gen/post.ts`, pinned per-era
   style, hand-authored hero assets, human review gate per pack.
2. **HF generation at volume** (rate limits, hours) → idempotent/resumable/batched; HF Spaces or
   local-diffusion fallback; confirm **model access + asset licensing** (`HF_TOKEN` unset + no
   `sharp`/`ffmpeg` in the web env — provision first).
3. **Audio quality** → AudioGen for ambience/loops; manifest accepts hand-authored stems; procedural floor.
4. **Late-game fps** → Track D in full + `bench-region` gate at every phase.
5. **Phase-14 save bloat** → quantized maps + filesystem save + a save-size regression test.
6. **Determinism in modularization** → free-function extraction + byte-identical `serialize()` diff per PR.

### Next increment (integration seams mapped) — `B1-art` + audio, code-only, procedural fallback
- `drawBackdrop()`: insert in `regionview.ts` `draw()` **before** the `g.drawImage(this.mapCache,0,0)`
  blit (~line 646, inside the camera transform → world-space); composite offscreen keyed by
  era/season/stat-band; blit + parallax-offset per frame.
- Sample-stem music: attach in `Music.update()` beside the synth on the same `master` gain;
  `eraForYear()` picks the era; crossfade by `intensity` (already tension-driven).
- Ambience beds: attach in `Soundscape.update()` after `ensure()`. All fall back to procedural.

## Overnight session (2026-06-22) — Phases 8–17 shipped

All the following were implemented as separate draft PRs targeting `main` for review:

| PR | Phase | Status |
|----|-------|--------|
| #251 | Phase 13: Population & Society Depth (GDD §5.5) | Draft, CI green |
| #252 | Phase 12: Media & Misinformation System (GDD §8.3) | Draft, CI green |
| #253 | Phase 11: Era 7–8 Renewables, Automation & Speculative Branches (GDD §10) | Draft, CI green |
| #254 | Phase 8: Notable System Depth — lifecycle, dynasty & advisor quality (GDD §2.4) | Draft, CI green |
| #255 | Phase 9: Full Government Type System — 15 regimes, transitions, policy slots (GDD §9) | Draft, CI green |
| #256 | Phase 17: Historical Scenarios & Alternate Era Starts (GDD §8.8, §6.1) | Draft, CI green |

Phases 14 (Zoning), 15 (Economy FX), 16 (Warfare Depth), and 18 (Advisor Depth) were also launched and may have PRs by morning.

## Previous session (2026-06-22) — UX & economy pass

User-reported fixes, all shipped on this branch:

1. **Calendar shows the real era** — top bar reads `October 3, 1935` (model's own `year`/`monthName`/`monthDay`), not a raw `Year 16` offset. The old HUD also used an inconsistent 365-day calc; now it matches the sim's 60-day year.
2. **Total population in the HUD** — `r.playerPop()` (whole nation) always shown; a selected settlement's share appears in parentheses.
3. **Overall happiness in the HUD** — new `r.avgSatisfaction()` (pop-weighted, player settlements), colour-coded `☺ %`.
4. **Zoom out further** — `RegionView.MIN_SCALE` 4 → 2.
5. **Bigger hexes, hex-sized cities** — `REGION_N` 256 → 128 (hexes ~2× larger on screen, still 16k cells). Settlement glyphs (sprite + depot + labels + resource chips) now scale to hex size via `glyphScale()`/`withGlyphScale()`: a small town ≈ 1 hex, a metropolis grows to ~2.25. Pick/hover radius tracks hex width.
6. **Dedicated Central Bank window (B)** — researching the **Central Banking** civic (or enacting the charter) now lights up `hasCentralBank()`, which gates a real **Central Bank panel** (policy rate, regime, bonds, discount window, currency) instead of burying it in Finance→Credit. The monetary controls + wiring moved there; the Credit sub-tab points to it.
7. **Economy rebalance** — see "Next session — priority fixes" below.

## The game: a standalone 4X campaign

TownCore (the town-detail / per-settler sim) is **dropped**. The shipping game is the
**4X campaign**, 1919→2100, colony→nation:

```
core.html → src/coreview.ts (shell)  →  src/ui/regionview.ts (UI)  →  src/sim/region.ts (RegionSim model)
```

- **`src/sim/region.ts`** — the deep model (~7.7k lines): sectoral economy, monetary policy +
  credit cycle, diplomacy/treaties/war, climate/emissions, tech + civics trees, factions/rivals,
  four win conditions, procedural worldgen (`src/sim/worldgen.ts`). **The depth lives here**; the
  UI surfaces it. Boot a campaign with **`RegionSim.foundColony(rng, map, weather, opts)`** (the
  replacement for the old `RegionSim.fromTown` flip).
- **`src/ui/regionview.ts`** — the 4X UI workhorse: the map (terrain/territory/**fog** cache,
  **atmosphere** lighting, routes, settlements, rivals, weather) + DOM panels (State →
  Finance/Politics/Diplomacy, Research, Routes, Settlements, Economy) + modals (Charter,
  Convention, Century report, Win, Era).
- **`src/coreview.ts`** — the campaign shell: boot, canvas, input, persistent top HUD, event log,
  toasts, objectives panel, help overlay, save/load, the fixed-timestep loop. Owns **no** map/panel
  rendering — that's `RegionView`. Tags `<body class="cv-app">` to scope the modern UI theme.
- The classic town game (`index.html` → `main.ts` → `Simulation`) still exists as "Classic Colony"
  on the title screen but is **not** the focus.

**Direction (user, locked):** painterly era-evolving map **and** modern strategy UI; colony→nation
arc starting from one fogged founding settlement.

## What's built (all merged to `main`)

- **Foundation** — `foundColony()`, clean shell, DPR-crisp canvas, draggable panels, HUD + log.
- **Terrain** — fog of war (feathered cloud shroud over `region.explorationMap`, hides
  undiscovered rivals; baked into the map cache, rebuilt as the explored count grows) + sea-depth
  bathymetry.
- **Atmosphere** — day/night tint, golden-hour dawn/dusk, population-scaled city lights, seasonal
  wash, vignette — all from one `atmosphere()` state, screen-space.
- **Modern UI** — cohesive cool-ink theme on CSS vars, scoped to `.cv-app` (classic game untouched):
  glass panels, pill tabs, accent buttons, slim scrollbars.
- **UX** — "Path to Nationhood" objectives panel (reads the model's own gates), event toasts,
  first-run welcome/help overlay.
- **Save/load** — autosave + Continue + manual save (Ctrl/⌘-S); `localStorage['centuria-4x-save']`
  stores the world seed + `region.serialize()`; reload via `RegionSim.deserialize` with a
  `{rng, regionMap, weather}` stub.
- **Content depth** — +12 wired tech/civic nodes filling 1919–2100 gaps; +8 era-gated regional
  events, +5 policy cards, +3 laws, all wired to existing sim hooks.
- **Main menu & UX** — new-game with terrain preferences (river/coast/highlands/random), continue
  if save exists, classic colony link. Economy sparklines (12-month GDP/treasury/inflation trends).
  Corner minimap with fog + click-to-pan. Settlement hover tooltips (pop/happiness/food).
- **Animated visuals** — subtle water shimmer, winter shores ice, seasonal particle effects.
- **Rival personality & diplomacy** — AI rivals initiate treaties based on personality archetypes
  (Hegemon/Trading Republic/Hermit Kingdom/Crusader/Opportunist), memorable diplomatic moments,
  rare special events (tributes, honor displays, alliance proposals).
- **Performance polish** — O(1) lookups for building/event definitions, researched techs, and enacted
  laws via Map/Set collections. Replaced 96 hot-path array searches in daily/monthly simulation loops
  with constant-time operations. ~2–4% overall speedup on long-run simulations.

## Gotchas

- `RegionView`'s camera works in **backing-store (device) pixels** (`canvas.width/height`,
  `MIN_SCALE = 1` = whole region fills the canvas). Feed it pointer coords in device px
  (CSS delta × DPR, or the `canvas.width / rect.width` ratio).
- `RegionView` auto-renders the State panel + selected-settlement inspector every frame — don't
  hand-roll canvas panels over it.
- The map cache is **static** (rebuilt only on signature change). Per-frame animation (water
  shimmer, atmosphere) must live in `draw()` after `g.restore()`, not in the cache.
- Content that shifts seeded balance must be checked with `npm run sim:macro` and the
  `region-longrun` tests, not just unit tests. New techs/policies/laws aren't auto-researched, so
  unmanaged baselines should be ~unchanged.
- Background agents share the working tree unless launched with `isolation: "worktree"`. Their
  worktrees live under `.claude/worktrees/` — exclude from vitest with `--exclude '**/.claude/**'`
  or test counts double.
- Stacked PRs only retarget to `main` cleanly if the repo has **"Automatically delete head
  branches"** on; otherwise they merge into stale base branches. Keep it on.

## Run & test

```bash
npm install
npm run dev        # http://localhost:5173/  (index.html → src/main.ts) ← the 4X game
npm run build      # tsc + vite build (must pass)
npx tsc --noEmit
npx vitest run --exclude '**/.claude/**'   # 815 tests
npx tsx scripts/bench-region.ts            # 60fps perf gate (early/mid/late) — must show no "DROPS"
npm run sim                                # headless long-run balance harness (restored)
```

> Note: `scripts/bench-region.ts` is the only perf bench — it gates the `RegionSim` 4X campaign.
> The old town-engine benches (`bench-scale.ts` / `bench-agents.ts`) were removed.

## Recent completions (PRs #218–#256)

- ✓ **#218** — Fix labor_law grievance test: measurement window and strike masking
- ✓ **#219** — Tech tree rebuilt as visual DAG: SVG edges, node state coloring, click-to-research
- ✓ **#220** — Naval system: harbor building (coastal_only), warship unit, sea-trade income method
- ✓ **#221** — Route maintenance budget: `routeBudget` knob (0–1.5), budget slider in UI, `maintainRoutes()` scaled
- ✓ **#222** — Harbor building added to `region_buildings.json`; warship in UNIT_TYPES
- ✓ **#223** — Tech tree visual layout fixes; research panel widened to `min(720px, calc(100vw - 240px))`
- ✓ **#224** — Route budget slider wired: live readout update without panel rebuild; 4 new budget tests
- ✓ **#225** — Phase 3 polish: dynamic panel sizing (Issue #14), treasury milestone events (Issue #15), music volume reduced 0.5→0.4 (Issue #13)
- ✓ **#226** — Rivals national identity (Issue #18): 11 named rival nations with unique flags/emblems, archetype-specific AI behavior, power comparison indicators; installer UI brightened (blue gradient, glowing title); package.json description updated
- ✓ **#229** — Land purchase mechanics (Phase 1): unclaimed land claim (£25/cell, `claimCell`/`canClaimCell`), population-scaled settlement buyout (`buyLand`/`canBuyLand`/`settlementBuyoutCost`), Claim Land Mode toggle in Diplomacy tab; 22 new tests (251 total)
- ✓ **#230** — Province View (Phase 2): `Province` interface + `computeProvinces()` in region.ts; `drawProvinceOverlay()` canvas layer (faction-colored name labels, pop/GDP/satisfaction stat bars, selection ring); `drawProvincePanel()` inspector DOM panel; click-to-select province; P key shortcut; Province View toggle in Diplomacy tab; 10 new tests (261 total)
- ✓ **#233** — Advanced Diplomacy (Phase 3) + Late-Game Flavor (Phase 4): espionage (`ESPIONAGE_OPS`, per-rival `intel`, `runEspionage` with exposure), trade blocs (`TradeBloc`, `blocTradeBonus`), era/victory cinematics (`drawCinematic`), post-2100 epilogue scroll (`epilogueBeats`/`drawEpilogueModal`); 24 new tests (285 total)
- ✓ **#236** — 1919 campaign start (Issue #25): `START_YEAR = 1919`, post-Great War founding lore in `foundColony()`; save/load determinism fix (preserve `currentGoal` on deserialize, guard `successCondition` callers with `typeof` so the `aiRng` stream stays aligned across save/load cycles); 3 test fixes (`region-longrun`, `region`, `region-found`) and updated era-gated tech/calendar test expectations for the new epoch; rival nation lore rewritten for post-WWI context (leader titles, descriptions, `techUnlock` refs); Humanitarians `minYear` 1920→1919; Merchant Guilds updated as a 1919–1925 transitional faction
- ✓ **#238** — Historical anchors (GDD §1): three scripted world-events that rhyme with history without reciting it — **world-war window** (1936–1948: fires when rival tensions peak + an expansionist is in the mix; escalates the most hostile rival pair into open war, shakes player confidence); **oil shock** (1970–1985: fires when combustion_engine is researched but no renewables exist; treasury drain + inflation spike + currency hit + industry slump in player settlements); **2020-analog pandemic** (2012–2027: 4%/month roll; pushes a 60–120 day pandemic_wave onto all settlements, with severity halved if `antibiotics` is researched); each fires at most once, is fully serialized, and backfills `false` on old saves; 18 new tests (`tests/historical-anchors.test.ts`, 334 total)
- ✓ **#239** — Great Depression anchor (GDD §8.1) + cabinet expansion (GDD §8.7): Depression moved to `tickHistoricalAnchors()` (1927–1936 window, `privateLeverage × policyRate > 0.12 && confidence < 55`); richer chain effects — confidence −40, leverage ×0.65, export collapse ×0.55, bank-failure treasury drain (~12% GDP), 150-day labor_shortage events on all player settlements, grievance +25 / satisfaction −15, legitimacy −12 for nation tier, two dramatic log entries (THE CRASH + DEPRESSION); cabinet expanded from 3 → 6 portfolios: Foreign Secretary (+5 envoy relations), Science Minister (+15% research rate), Press Secretary (−25% legitimacy decay); old saves with 3 ministers backfill remaining slots to null on deserialize
- ✓ **#239 (follow-up)** — Depression depth + response toolkit: `depressionDepth` (0→1, set 1.0 on crash, decays ~5%/mo over ~30 months) drives multi-year export suppression (`× max(0.3, 1 − depth×0.55)`) and a confidence-recovery ceiling (`35 + 65×(1−depth)`). Month-12 **recovery crossroads** (`chooseRecoveryPath`): stimulus (halves depth, −£8/mo × 24) vs austerity (−20% depth, services cut, grievance spike). New **emergency measures** (`enactDepressionMeasure`, once each while a slump is active, GDD §8.1): **QE** (rate cut, depth ×0.80, +inflation, needs Central Bank), **Leave Gold Standard** (float + devalue, depth ×0.78, export surge via existing fxBoost), **Public Works** (treasury cost, depth ×0.82, grievance −12 / clears labor_shortage). Each measure adds a `depressionCeilingBonus` so the recovery cap lifts. UI: redesigned **Depression Response panel** in `nationHtml` → `depressionResponseHtml()` (depth meter bar, crossroads fork cards, measure cards with used/blocked states) with dedicated `.crisis-banner`/`.depth-meter`/`.dep-measure-btn` CSS. All 5 depression-depth fields + `depressionMeasuresUsed`/`depressionCeilingBonus` serialize with old-save backfill. 34 tests in `tests/depression-cabinet.test.ts` (368 total)
- ✓ **#241** — Hex grid migration: square→pointy-top hexes (odd-r offset). New `src/sim/hex.ts` module: `hexNeighbors`, `hexCenter`, `hexCorners`, `hexLayoutParams`, `screenToHex`, `hexDistance`, `offsetToCube`. Updated: 6-dir neighbors + cube-distance A* in `worldgen.ts`; `canClaimCell` adjacency in `region.ts`; hex polygon rendering in `regionview.ts` (`drawTerrain`, `drawTerritories`, `drawFog`, `ensureWaterMask`, click hit-test). Tests: `hexNeighbors`/`hexDistance` in `tests/routes.test.ts`. Sim tests green (368) — but tests are sim-only, so the rendering layer shipped with known gaps:
- ✓ **#242** — Three-tier memory fog: explored-but-not-visible cells now show a cool-grey wash (`drawMemoryFog`, live overlay outside map cache) instead of full-colour terrain. Live rivals hidden in grey areas via `isVisibleToFaction` guard added at `regionview.ts:600,642`. Player scouts always shown; AI scouts hidden when not in current sight.
- ✓ **#244** — Rendering layer unified on hex geometry (all follow-ups from #241/#242 resolved):
  1. `toPx` rewritten to use `hexLayoutParams + hexCenter` — ALL map-space markers (settlements, routes, scouts, expeditions, rival diamonds, province labels, city lights, resource icons, army badges, trade-flow arrows) now land on the correct hex cell; drift ≥½ hex at high zoom is eliminated and click hit-tests match what is drawn.
  2. Rival fog hiding fixed as a consequence — marker positions now align with the fog hex coordinate.
  3. Expedition `isVisibleToFaction` guard added (mirrors scout guard pattern) so non-player expeditions are hidden in memory fog.
  4. Forest, plains, hills, and marsh terrain textures wrapped in `g.save/g.clip/g.restore` so `fillRect` details cannot bleed past hex edges; marsh reeds get their own clip block.
  5. Hillshade now samples hex-direction NW (`hexNeighborDir` dir 4) and W (dir 3) instead of square-grid `at(x,y-1)` / `at(x-1,y)`, removing the row-parity inconsistency on odd rows.
  6. `travelDays` (worldgen.ts) now lerps in cube coordinates (`offsetToCube` → lerp → round → convert back) so each sampled step lands on an actual hex neighbor.
- ✓ **#251** — Phase 13: Population & Society Depth — demographic transition (birth/death formulas, baby boom, aging crisis), migration appeal scores, education pipeline lag (25-slot ring buffer), Gini index, 6-rung unrest ladder (petitions→strikes→protests→riots→organized opposition→revolution), opinion dynamics with 1968/2030 youthquakes; 27 tests (428 total)
- ✓ **#252** — Phase 12: Media & Misinformation System — 6-tier media reach progression, press freedom axis (0–100), propaganda narrative, credibility gap (legitimacy cliff at ≥80 + spark), misinformation era (2015+, polarization growth), platform regulation, public media funding, media literacy investment (15-year lag); 5 new tech nodes; 49 tests (450 total)
- ✓ **#253** — Phase 11: Era 7–8 Renewables, Automation & Speculative Branches — 7 new tech/civic nodes (solar/wind, battery, EV, AI, carbon tax, cap-and-trade, green industrial policy), 4 new laws, automation unemployment drift, stranded asset write-downs, speculative branch gate at 2040 (solarpunk/corporatocracy/drowned); 38 tests (413 total)
- ✓ **#254** — Phase 8: Notable System Depth — full lifecycle (age, health, death, heir birth), WWI founding backstories, minister loyalty decay + defection, scandal events, `selectSuccessor()`, `advisorForecast()` with skill-weighted Gaussian noise, `buildDynastyTree()`; 23 tests (436 total)
- ✓ **#255** — Phase 9: Full Government Type System — 15 regime types, `GovTypeDef` with era gates/decay modifiers/maxSlots, `TransitionChain` system (multi-step authored chains), per-regime fields (planningOptimism, reportedGDP, credibilityGap, schismRisk, shareholderPatience), policy slots, `tickRegimeMechanics()`; 30 tests (431 total)
- ✓ **#256** — Phase 17: Historical Scenarios & Alternate Era Starts — `fromEraStart('1950'|'2000')`, 4 authored scenarios (The Long Peace, Iron Curtain, Digital Crossroads, Climate Emergency), scenario goals system, regime lock, difficulty knobs (crisisFrequency, aiAggression, historicalAnchors), scenario selection UI in title screen; 47 tests (448 total)
- ✓ **#249** — Economy rebalance + HUD/zoom/hex-scale/central-bank UX pass: real calendar (year/month/day in top bar), `playerPop()` + `avgSatisfaction()` in HUD, `MIN_SCALE` 4→2, `REGION_N` 256→128 + `glyphScale()`/`withGlyphScale()` hex-sized city sprites, `hasCentralBank()` + dedicated Central Bank window (B key), GDP-scaled public-sector spending (Wagner's law, `publicSector ≈ 9% GDP`), `flatCost()`/`devFactor()` for militia/scout costs, flat policy bonuses made GDP-scaled; 7 new tests (375 total)

### Remaining low-priority rendering notes

- **Memory fog refreshes weekly** — `isVisibleToFaction` rebuilds its cache every 7 days; grey boundary lags fast unit movement. Acceptable; could rebuild on scout/settlement events if needed.
- **Minimap on square dots** — intentional per plan (1px dots); no change needed.

## UI Architecture Notes (updated 2026-06-19)

**Dynamic panel sizing** — `.settlement-list-panel` and `.economy-panel` use `min-width: 260px` / `max-width: min(600px, calc(100vw - 380px))` so they expand to content without overflowing the viewport. Added `overflow-x: hidden`, `word-wrap: break-word`, `overflow-wrap: break-word` for long settlement names.

**Research panel** — rewritten as a visual SVG-overlay DAG (`drawResearchPanel()`). Column layout via `techTreeLayout()` (depth-first, barycenter row sort); bezier edges via the SVG overlay `.tt-edges`; node states `.tt-done`, `.tt-active`, `.tt-avail`, `.tt-locked`. Width `min(720px, calc(100vw - 240px))`.

**Route budget slider** — `oninput` updates `.rn-budget-readout` and `.rn-budget-note` spans in-place (no full panel rebuild). Calls `r.setRouteBudget(v)`. See `drawRouteNetworkPanel()`.

**Keyboard shortcuts** — ESC closes current panel; S=settlements, E=economy, R=research, N=route network.

## Event Logging Coverage (updated 2026-06-19)

`addLog(text, kind)` is the central log method. Events currently tracked:

| Category | Triggers |
|---|---|
| Population | Milestones: 50, 100, 200, 500, 1000, 2000 (per town) |
| Economy | Treasury milestones: £1k, £5k, £10k, £25k, £50k; treasury empty → services cut; strikes |
| Buildings | Completion: `The ${def.name} opens at ${t.name}` |
| Research | Tech breakthrough with description |
| Disasters | River floods, drought, sea-rise tidal events |
| Immigration | Waves of 3+ settlers drawn to content towns |
| Diplomacy | Treaty offers, rival emergence, regime change, war declaration, peace terms |
| Routes | Repair, washout, maintenance budget warnings |
| Rivals | New rival proclaimed; mischief; border friction; foreign wars |

## Audio System (updated 2026-06-19)

**Music** (`src/ui/music.ts`): procedural WebAudio, 6 era windows (ragtime 1900 → future 2040). Master volume target `0.4` (reduced from 0.5 for mid-game immersion). Variety comes from 3–4 hand-written melodic motifs per era that cycle bar-by-bar, with 25% chance of octave-up restatement. Tension scalar: paused → pad only (intensity 0); raid/conflict → full kit (intensity 1). Toggle stored in `localStorage['centuria-music']`.

**Soundscape** (`src/ui/soundscape.ts`): diegetic ambience — hammering (builders), train whistle (rail condition >50), crowd (grievance >50), birds (calm).

## Route Maintenance Budget

`r.routeBudget` (0–1.5, default 1.0) scales the monthly condition delta for all non-trail routes:

```
delta = min(12, -6 + 14 × budget)   // 0 = −6/mo; 1.0 = +8/mo; 1.5 = +15/mo
```

`r.routeUpkeepProjected()` returns the projected monthly spend at the current budget. UI slider in Route Network panel updates live without panel rebuild.

## Naval System

`hasHarbor(t)` — true if settlement has a 'harbor' building. `navalTradeIncome()` runs monthly: each harbor settlement earns `0.8 × sectorOutputOf(t) × 0.05` per month as sea-trade income to treasury. Harbor is `coastal_only: true`, prereq: `cartography`. Warship unit in `UNIT_TYPES` with `recruitCost: 80`, `trainingDays: 45`, `powerPerUnit: 3.0`, `supplyCost: 0.10`.

## Roadmap: Completed Phases

### Phase 1 ✓ (PR #229 — Land Purchase Mechanics) — COMPLETED
- ✓ **Unclaimed land purchase** — Players buy unclaimed hexes adjacent to settlements (£25/cell) at State tier
- ✓ **Settlement buyout** — Enhanced `buyLand()` with population-scaled costs (£400+£2/pop)
- ✓ **UI integration** — "Claim Land Mode" toggle in Diplomacy tab; click-to-claim map UX
- ✓ **Tests** — 22 comprehensive tests (all passing)

### Phase 2 ✓ (PR #230 — Province View) — COMPLETED
- ✓ **Province data model** — `Province` interface + `computeProvinces()` in `region.ts`; one province per settlement, keyed by settlement id
- ✓ **Canvas overlay** — `drawProvinceOverlay()`: faction-colored name labels with shadow, compact pop/GDP/satisfaction stat bars, selection ring for clicked province
- ✓ **Province inspector panel** — `drawProvincePanel()`: DOM panel with name, faction, population, GDP, satisfaction bar, garrison, buildings list; close button
- ✓ **Click-to-select** — Province View intercepts settlement clicks to set `selectedProvinceId` instead of opening settlement inspector
- ✓ **P key shortcut** — Toggle province view from anywhere (`main.ts`)
- ✓ **Diplomacy tab toggle** — "Province View (P)" button in State → Diplomacy section with active indicator
- ✓ **Tests** — 10 tests in `tests/province.test.ts`

### Phase 3 ✓ (PR #233 — Advanced Diplomacy: Espionage & Trade Blocs) — COMPLETED
- ✓ **Espionage/sabotage** — `EspionageOp` (gather_intel/steal_tech/sabotage_economy/incite_unrest) + `ESPIONAGE_OPS` defs; per-rival `intel` 0..1; `runEspionage()` rolls success + separate exposure on the AI stream; steal_tech vaults research / treasury, sabotage sets rivals back, incite_unrest can fracture alliances; exposure sours relations. UI: per-rival intel meter + covert-op buttons in Diplomacy tab
- ✓ **Trade blocs** — `TradeBloc` model (named multi-member union, shared tariff); `formTradeBloc`/`inviteToBloc`/`leaveTradeBloc`/`setBlocTariff` + `blocTradeBonus()` layered into monthly export earnings; UI section to found/grow/tune/dissolve
- ✓ **Treaty editor / trade negotiation** — already shipped earlier as the "bargaining table" deal modal (`DealBasket`, `openDealModal`); espionage + blocs were the genuinely-missing pieces
- ✓ **Tests** — 18 in `tests/diplomacy-advanced.test.ts`

### Phase 4 ✓ (PR #233 — Late-Game Flavor) — COMPLETED
- ✓ **Era-branching + victory cinematics** — `drawCinematic()`: frame-driven fullscreen canvas sequence (painterly sky, per-variant motif, letterbox, fade-in, title) that plays once when the century forks or a victory lands, before the DOM modal reveals; suppressed on loaded saves where the moment already passed; click / any key skips. Variants for all 3 era branches and all 4 win paths
- ✓ **Post-2100 epilogue** — `epilogueBeats()` resolves triggered post-2100 events to a narrative scroll (`drawEpilogueModal()`), shown once 3+ beats accumulate; persisted `epilogueShown` flag so it doesn't re-trigger on reload
- ✓ **Tests** — 6 in `tests/epilogue.test.ts`

---

## Roadmap: Outstanding Features

Phases 1–7 are **complete and merged to main**. The following phases are ordered by GDD priority and architectural dependency. Items marked *(in sim)* exist partially in `region.ts` but need UI surfacing or completion. Recommended model per phase noted.

> **Reading the GDD alongside this:** each phase below references the GDD section it implements. `GDD.md` is the design authority; this file is the implementation guide. When in doubt, the GDD wins on design intent.

### Phase 5 ✓ (Province-Level Governance) — COMPLETED
- ✓ **`HexProvincePolicy` interface** — `taxMultiplier` (0.5–2.0), `investmentLevel` (0–2), `autonomyLevel` (0–2) per province
- ✓ **`getProvincePolicy` / `setProvincePolicy`** — player reads and sets admin policy for any owned province; gated behind State proclamation
- ✓ **`applyProvincePolicyEffects()`** — monthly tick: high autonomy boosts satisfaction/reduces grievance; high investment drains treasury and accelerates garrison; low autonomy minor satisfaction drag
- ✓ **`tickRivalProvinceGovernance()`** — commerce-weighted rivals invest in inter-provincial infrastructure monthly, gaining small population growth
- ✓ **Province panel UI** — Tax / Investment / Autonomy dropdowns appear in the province inspector for player-owned provinces
- ✓ **Provincial army markers** — Province overlay shows `⚔N` icons for stationed player (blue) and rival (red) armies

### Phase 6 ✓ (AI Espionage & Trade Bloc Activity) — COMPLETED
- ✓ **`tickRivalEspionage()`** — hostile rivals (relations < 10) roll 4–10%/month chance of a covert op against the player: `economic_pressure` (treasury drain), `military_recon` (intelligence flavor), `incite_dissent` (raises town grievance); caught on counter-intel roll → reverse relations hit + log
- ✓ **`RivalTradeBloc` interface + `rivalTradeBlocs[]`** — rivals with high commerce weights (≥5) form their own trade blocs; `tickRivalTradeBlocActivity()` runs monthly; shown in diplomacy tab
- ✓ **`rivalBlocTariffFriction()`** — rival blocs apply external tariff pressure on player exports to trade-agreement members (up to −30%); wired into monthly export earnings
- ✓ **`Sanction` system** — `imposeSanction(rivalId)` / `liftSanction(rivalId)` / `sanctionPressureOnPlayer()`; player-imposed sanctions last 1 year (−40% bilateral trade, −10 relations); rival retaliation fires when exposed in a serious espionage op; `tickSanctions()` expires elapsed sanctions; UI in Diplomacy tab with impose/lift buttons; wired into export earnings (up to −50%)
- ✓ **Espionage exposure → sanctions** — when a sabotage/incite op is exposed and the rival is hostile (rel < −20), `rivalImposeSanction()` fires automatically

### Phase 7 ✓ (Inter-Provincial Unit Movement) — COMPLETED
- ✓ **`ProvincialArmy` interface** — `id`, `ownerId` (0=player), `provinceId`, `destinationId`, `transitDays`, `units[]`, `supply`
- ✓ **`deployArmy(fromId, toId, type, count)`** — draws units from stationed pool / war army / garrison; calculates transit time by distance and unit type (cavalry faster, warship slower); creates a moving `ProvincialArmy`
- ✓ **`cancelArmyMovement(armyId)`** — halts a player army mid-march
- ✓ **`updateArmyMovement()`** — monthly: drains supply, advances transit days, triggers arrival log; calls `resolveProvinceBattle()` on arrival
- ✓ **`resolveProvinceBattle(provinceId)`** — simple power comparison (unit count × powerPerUnit × morale/100 × rival boost); winner drives loser out with attrition; logged as `BATTLE of <name>`
- ✓ **`tickRivalArmyAI()`** — expansion-minded rivals (expansion ≥ 6) spawn small militia armies at player border provinces with 2.5%/month chance; max 2 rival armies per nation
- ✓ **Army display** — province overlay shows `⚔N` count badges for player armies (blue) and rival armies (red) at each province

---

### Phase 8 ✓ (PR #254 — Notable System Depth) — COMPLETED
- ✓ Full Notable lifecycle: monthly health decay, age-weighted death risk, heir birth (25–50 age window, 5%/yr)
- ✓ Minister loyalty decay + defection at loyalty < 20 (rival faction gains power, legitimacy −5)
- ✓ Scandal events for ministers with 5+ years in role
- ✓ `selectSuccessor()` prefers faction-aligned candidates
- ✓ `advisorForecast(portfolio, trueValue)` adds skill-weighted Gaussian noise
- ✓ `buildDynastyTree()` compiles DynastyNode[] from parent/child Notable links
- ✓ WWI founding backstories for 4–6 initial Notables in `foundColony()`
- ✓ 23 tests in `tests/phase8.test.ts`

### Phase 9 ✓ (PR #255 — Full Government Type System) — COMPLETED
- ✓ 15 regime types: democracy, republic, junta, monarchy, const_monarchy, abs_monarchy, oligarchy, theocracy, direct_democracy, corporatocracy, fascist, social_democracy, autocracy, one_party, technocracy
- ✓ `GovTypeDef` with `legitimacyDecayModifier`, `allowedLeanings`, `maxSlots`, `minYear?`, `maxYear?`
- ✓ Per-regime fields: `planningOptimism`, `reportedGDP`, `credibilityGap`, `schismRisk`, `shareholderPatience`
- ✓ `TRANSITION_CHAINS` for junta→democracy, abs_monarchy→democracy, autocracy→democracy
- ✓ `beginTransition()`, `advanceTransition()`, `activatePolicySlot()`, `deactivatePolicySlot()`
- ✓ `tickRegimeMechanics()` called monthly
- ✓ 30 tests in `tests/phase9.test.ts`

### Phase 10 — Climate System Depth (GDD §8.2) — *Sonnet scope*

Climate ledger exists (`emissions` tracking) but lacks the visible long-lag impact chain the GDD describes as the century's "slowest bad loop."

- **CO₂ accumulation with lag** — global `atmosphericCO2` (ppm, starts ~295 in 1919); each nation contributes per energy mix and industrial output; warming follows cumulative emissions with a **~20-year delayed impact** (player actions today hurt in 2 decades). NPC nations emit too
- **Ghost waterline** — render a faint blue coastal boundary on the hex map showing projected 2100 sea level; visible from ~2030. Quiet dread as persistent UI
- **Sea-level rise** — coastal hexes flood incrementally from ~2040; flooding destroys buildings, displaces population, creates climate refugees
- **Climate impact effects** — scaling with temperature rise: crop-yield volatility → failures; extreme-weather event frequency ↑ (storms, floods, droughts hitting infrastructure); habitability loss in coastal zones
- **Adaptation actions** — `buildSeaWall(provinceId)` (10-year build, high cost, blocks flooding); `floodProofZoning(settlementId)` (cost + build time, partial protection); `managedRetreat(settlementId)` (brutal politically, necessary late-game in worst scenarios)
- **Climate accords** — late-era diplomatic item (unlocks ~1990+): multi-nation treaty with emissions targets, verification mechanics, free-rider penalty (sanctions if defection detected), negotiated via the existing deal modal
- **Geoengineering** (2050+) — `launchGeoengineering()`: fast/cheap/side-effect-roulette; unilateral; triggers diplomatic crisis (`geoengineeringProtest[]` from affected rivals); roll random side effects (crop disruption, monsoon shift)
- **Test targets** — CO₂ accumulation rate, warming lag math, sea-level event triggers, accord serialization

### Phase 11 ✓ (PR #253 — Era 7–8 & Speculative Branch) — COMPLETED
- ✓ 7 new tech/civic nodes: solar_wind_parity, battery_storage, ev_adoption, ai_automation, carbon_tax, cap_and_trade, green_industrial_policy
- ✓ 4 new laws: carbon_pricing, cap_trade_law, green_industry_act, universal_basic_support
- ✓ `automationUnemployment` drift; `strandedAssetLoss` write-downs; `enactUniversalBasicSupport()`
- ✓ `determineSpeculativeBranch()` at 2040: solarpunk/corporatocracy/drowned based on CO₂, regime, Gini
- ✓ 38 tests in `tests/phase11.test.ts`

### Phase 11 spec (for reference) — Era 7–8 & Speculative Branch (GDD §10) — *Opus scope*

The game currently runs to 2100 but eras 7–8 (2010–2100) lack the full content, tech depth, and branching art the GDD specifies.

- **Climate & Automation era (2010–2040)**:
  - Renewables tech nodes: solar/wind parity, battery storage, grid-storage problem (intermittency), EV adoption curve
  - AI/automation waves: `automationUnemployment` variable; service/manufacturing job losses create political pressure for universal benefits or redistribution; automation also raises productivity
  - Carbon pricing civics: carbon tax (faction politics), cap-and-trade system, green industrial policy
  - Stranded asset mechanics: coal/oil infrastructure loses value as transition accelerates; `strandedAssetLoss` event for nations that moved late
- **Speculative branch (2040–2100)** — world-state-gated entry:
  - *Solarpunk branch* (low CO₂ + stable democracy + high equality): fusion power tech, cooperative global institutions, post-scarcity social contract
  - *Corporatocracy branch* (high inequality + tech dominance): arcologies, corporate charters replacing nation-states, subscription-tier citizenship
  - *Drowned branch* (high CO₂ + late adaptation): sea walls failing, climate refugee crises, resource wars over arable land, habitability collapse
  - Branch is determined by cumulative climate, economy, and regime choices — not a calendar flip
- **2040+ art/audio** — backdrop kits and era palette for each branch (see GDD §3.2); procedural soundtrack shifts to branch-appropriate idiom (organic acoustic for solarpunk, industrial dark synth for dystopia)
- **Test targets** — branch selection logic, speculative tech unlock gates, all three epilogue narrative paths

### Phase 12 ✓ (PR #252 — Media & Misinformation System) — COMPLETED
- ✓ 6-tier media reach: word_of_mouth → press → radio → television → internet → algorithmic
- ✓ `pressFreedom` (0–100), `propagandaNarrative`, `credibilityGap` accumulator
- ✓ Credibility gap ≥80 + spark → legitimacy cliff drop −30
- ✓ Misinformation era (2015+): polarization growth, algorithmic reach
- ✓ Player actions: grantPressLicense, censorMedia, enactPlatformRegulation, fundPublicMedia, investMediaLiteracy
- ✓ 5 new tech nodes; UI section in Politics tab; 49 tests in `tests/phase12.test.ts`

### Phase 12 spec — Media & Misinformation System (GDD §8.3) — *Sonnet scope*

The sim has no media system yet. This is the late-game political complexity layer.

- **Media reach progression** — `mediaReach` variable per era: word-of-mouth (1919) → press (1925+) → radio (1930s+) → TV (1950s+) → internet (1995+) → algorithmic feeds (2015+). Each stage multiplies how fast opinion moves (early century is a glacier; late century is a flash flood)
- **Press freedom axis** — extend existing liberty axis into a `pressFreedom` 0–100 variable:
  - Free press: approval reflects true conditions; corruption surfaces as forced scandal events; legitimacy is sturdy (earned)
  - Controlled press: player sets `propagandaNarrative` (buffers approval against bad news); `credibilityGap` accumulator grows monthly; gap > threshold + spark = legitimacy *collapse* (not decline)
- **Misinformation era** (2015+) — algorithmic feed event fires when `internet` tech researched + year ≥ 2015: opinion distribution *spread* widens (polarization parameter rises), consensus laws cost +20–30% more political capital, populist ideology swings amplify
- **Counters** (each with tradeoffs): `platformRegulation` (reduces polarization, angers tech factions), `publicMediaFunding` (buffers against credibility gap, costs treasury), `mediaLiteracyEducation` (15-year lag education investment, reduces long-run polarization)
- **Test targets** — credibility gap accumulation/collapse, misinformation era trigger, press freedom effect on scandal event rate

### Phase 13 ✓ (PR #251 — Population & Society Depth) — COMPLETED
- ✓ Demographic transition: `globalBirthRate()`/`globalDeathRate()`, baby boom (×1.2 1945–1975), aging crisis (pension burden 2050+)
- ✓ `appealScore()` for migration (wages, housing, services, safety, liberty); `tickAppealMigration()`
- ✓ Education pipeline lag: 25-slot `educationLag[]` ring buffer; `projectedSkilledWorkforce(n)`
- ✓ `giniIndex()` from 3-class wage approximation; grievance feedback per 0.1 above 0.4
- ✓ 6-rung unrest ladder with time-based escalation; `crackdownProtests()`, `concedeToProtesters()`
- ✓ Opinion dynamics: material experience drift, generational drift, 1968/2030s youthquakes
- ✓ 27 tests in `tests/phase13.test.ts`

### Phase 13 spec — Population & Society Depth (GDD §5.5) — *Sonnet scope*

The cohort matrix exists but several of the GDD's dynamic mechanisms are stub-level or absent.

- **Demographic transition** — birth rate formula: starts ~35/1000 (1919), falls with `educationLevel` + urbanization + child survival; death rate falls with health spending + sanitation. The mid-century boom and 2050s aging crisis (pension burden on shrinking workforce) emerge from this without scripting
- **Migration with appeal scores** — `appealScore(settlementId, class)` computed from wages, housing cost, services, safety, liberty-fit, discrimination; net migration flows down appeal gradient each tick; crises produce refugee *waves* (volume spike, not just trickle)
- **Education pipeline lag** — school coverage today → skilled cohorts 15–25 years later; the `educationLag[]` ring buffer tracks cohort progress; UI: "projected skilled workforce 2045" visible in education screen
- **Gini inequality index** — computed from wage distribution across class cohorts; feeds `unrestPressure` (inequality ↑ → unrest ↑, populist ideology drift toward extremes), crime, and policy political costs
- **Full unrest ladder** — expand current strike/grievance system to the full 6-rung ladder: petitions (flavor) → strikes (sector output −%) → protests (crackdown/concede branch) → riots (infrastructure damage) → organized opposition (faction power ↑) → revolution (§9 failure mode). Each rung visible in event log with attribution ("Dockworkers, day 8 — over wage decline and rent")
- **Opinion dynamics** — cohort ideology drifts toward (a) material experience (unemployed → anti-incumbent + extreme), (b) media exposure (Phase 12), (c) generational replacement (children imprint on the era they come of age in — 1968-analog and 2030s youthquakes emerge from this)
- **Test targets** — demographic transition curve shape, Gini formula, unrest ladder progression, education pipeline delay

### Phase 14 — Zoning, Infrastructure & City Services (GDD §5.1) — *Opus scope*

The largest unimplemented GDD system. Province view exists but zoning/services/pollution are absent.

- **Zoning system** — R/C/I/O zones with 3 density levels unlocked by era + demand; buildings grow from demand signals: residential demand = jobs + amenity − rent pressure; commercial = purchasing power; industrial = input access + freight capacity; office = tertiary workforce (era-gated)
- **Land value propagation** — `landValueMap` per settlement (hex-resolution); propagates from amenity, transit access, coverage; depressed by pollution; sets rents, class sorting (who can afford to live where), property-tax yield, gentrification pressure
- **Pollution diffusion** — per-building emission → local diffusion → global CO₂ ledger (hooks into Phase 10); health impact, land value drag, mood drag
- **Utility system**:
  - Power: generation → distribution → `brownoutRisk` (cuts industrial output 30% + mood if demand > capacity)
  - Water/sewage: drives disease events if underfunded
  - Waste: land value drag + ground pollution if uncollected
- **Service coverage** — radius-based coverage per service building (clinics, schools, police, fire, parks); coverage maps feed health, crime, education, approval. Service buildings have era versions (1919 schoolhouse vs 2050 learning center with different throughput)
- **Test targets** — zoning demand signals, land value gradient math, brownout trigger, service coverage radius computation

### Phase 15 — Extended Economy & FX (GDD §5.2) — *Sonnet scope*

Economy is the centerpiece system; this phase extends it toward the GDD's full-scope design.

- **Expand goods from 18 → 44** — add intermediate tier: chemicals, components, electronics, pharmaceuticals, vehicles. Each has an input/output recipe and era unlock. Supply chain failures propagate (no chemicals → no pharmaceuticals → health crisis)
- **Physical goods movement on routes** — goods travel on the transport network with real transit time and cost; `congestionTariff` (distance + route condition = implicit tax on goods movement). Price arbitrage traders: if price differential between two settlements > transport cost, a trade flow spawns to equalize
- **FX and currency system** — exchange rate from trade balance + interest rate differential + confidence; `devalue()` action: boosts exports, raises import prices (inflation), diplomatic friction; `currencyPeg` option (fixed rate vs a reserve-currency rival — stability + loss of monetary independence)
- **Monetary regimes** — gold standard (discipline + deflation risk), fiat (flexibility + inflation risk), currency union with an ally (bloc benefit + loss of independent rate)
- **Test targets** — goods route transit time, price convergence via arbitrage, FX devaluation effect on trade balance and inflation

### Phase 16 — Warfare System Depth (GDD §7) — *Opus scope*

Provincial army movement exists (Phase 7). This phase replaces the simple power comparison with the GDD's full strategic warfare layer.

- **Casus belli system** — `CB` types: border dispute, treaty violation, protection of co-ideologues, resource denial, fabricated (`fabricationCost` in reputation). CB quality sets `warSupport` at declaration: defensive war starts 85, land grab starts 40
- **Three mobilization levels** — `mobilizationLevel`: Peacetime / Partial / Total; each unlocks a cost/benefit package constrained by regime type:
  - Partial: selective draft, 15% manufacturing → armaments
  - Total: mass conscription (workforce −10–25%), 40–60% conversion, rationing, war bonds
- **Army Groups on fronts** — replace unit-count armies with `ArmyGroup` objects: manpower, equipment level (from industry), supply state, doctrine (tech tree), morale. `Front` objects between hostile territory with weekly resolution: `combatPower = manpower^0.6 × equipment × supply × doctrine × morale`. Sub-linear manpower exponent means quality and logistics beat raw mass
- **Supply lines** — supply flows from industrial centers down rail/road/sea network to fronts; overextended fronts `supply ×0.5` and falling. Cutting supply (deep front moves, blockade, bombing in late eras) is a first-class strategy
- **Occupation** — occupied provinces: partial output, garrison cost, `resistanceLevel` accumulating scaled by ideology distance + occupation policy (conciliatory ↔ brutal). Brutality is cheaper now, costlier forever — postwar integration penalties
- **War support decay** — `warSupport` decays with casualties/population, rationing, defeats; rallies on victories + home-soil attacks. Low support → strikes, draft riots, coup risk — *how* it bites depends on regime type
- **Full peace terms** — peace priced in `warScore` (front positions, occupied territory, blockade effects): annex province (15–25 each), reparations (10/tranche), DMZ (15), puppet (45), status quo (0). Overreach creates Grudge-9 revanchist rival
- **Test targets** — mobilization cost formulas, front resolution ratio math, occupation resistance growth, war support decay curves

### Phase 17 ✓ (PR #256 — Historical Scenarios & Alternate Starts) — COMPLETED
- ✓ `RegionSim.fromEraStart('1950'|'2000')` with pre-built starting state
- ✓ 4 authored scenarios: The Long Peace, Iron Curtain, Digital Crossroads, Climate Emergency
- ✓ `SCENARIOS` constant with `Scenario`/`ScenarioGoal` interfaces; `checkScenarioGoals()` monthly
- ✓ `beginRegimeLocked()` / `isGovLocked()` for regime-lock challenge starts
- ✓ Difficulty knobs: crisisFrequency, aiAggression, historicalAnchors wired into sim ticks
- ✓ Scenario selection UI in title screen; 47 tests in `tests/phase17.test.ts`

### Phase 17 spec — Historical Scenarios & Alternate Starts (GDD §8.8, §6.1) — *Sonnet scope*

- **Era starts** — begin in 1950 with a pre-built state (skip colony/state phases, start with an existing nation), or in 2000 as an information-age economy. `RegionSim.fromEraStart(era, opts)` constructor with authored starting conditions per era
- **Historical scenario layer** — authored starting conditions with named nations, historical parallels, and scripted opening events. Scenarios reference real geographical/political templates without replicating copyrighted works. Each scenario has 1–3 authored "scenario goals" on top of the standard win conditions
- **Regime-locked challenge starts** — player chooses a government type at campaign start (junta, theocracy, etc.) and is locked to it for the first 30 years; generates unique opening constraints and story beats
- **Difficulty knobs in sandbox** — expose all tuning parameters: crisis frequency/severity, AI aggression, economic volatility, starting region harshness, historical-anchor toggles (fire on schedule vs emergent only)
- **Test targets** — era start serializes cleanly, scenario goals wire to existing win-condition infrastructure

### Phase 18 — Advisor System Depth (GDD §8.7) — *Sonnet scope* — IN PROGRESS (PR pending)

Cabinet portfolios exist (Phase 2 via PR #239). This phase gives advisors the forecast quality and personality depth the GDD describes.

- **Skill-based forecast accuracy** — each cabinet Notable has a `skill` 0–100 value; advisor-generated forecasts (debt service cliff, confidence break, unrest threshold) add Gaussian noise scaled to `1 − skill/100`. A bad advisor gives plausible but wrong projections
- **Ideology-biased advice** — hawkish War minister consistently underestimates occupation costs; loyalist Press Secretary downplays credibility gap; pro-labor Interior minister overstates strike risk. Bias is deterministic per advisor ideology axis, invisible to the player until they notice the pattern
- **Advisor briefs** — dedicated `advisorBriefs[]` queue: each portfolio auto-generates a brief when a key variable crosses a warning threshold (Treasury: "debt service passes 20% of revenue within 3 years on current path"; Interior: "lower-class housing satisfaction below 30 in 4 settlements"; Science: "rivals outpacing your tech in 2 of 3 military branches"). Briefs surface in the event log with portfolio attribution
- **Advisor loyalty & betrayal** — `loyalty` 0–100 per Notable; falls when player ignores their advice repeatedly or fires a colleague they like; at loyalty < 20 + trigger (major loss, scandal), advisor defects to opposition faction or leaks information (approval hit + credibility gap ↑)
- **Portfolio-specific events** — Foreign Secretary: "envoy refused audience" (relations deterioration warning); Science Minister: "research bottleneck — need secondary schools in 3 more settlements"; Press Secretary: "credibility gap accelerating — recommend addressing [specific cause]"
- **Test targets** — forecast noise variance by skill, loyalty decay formula, brief threshold triggers, betrayal event chain

## Completed in PR #226

- ✓ **Rivals national identity** (Issue #18) — 11 named rival nations (Vasterholm, Kalimera, Tyrennia, Karelia, Sundered Communes, Northern League, Highland Federation, Crescent Sultanate, Iron Republics, Forest Collective, Sunset Empire) with unique flags/emblems, archetype descriptions, personality-driven treaty behavior, power comparison indicators
- ✓ **Installer UI** — Brightened from dark green to vibrant blue gradient; cyan glowing title with pulsing animation; gold→cyan gradient progress bar
- ✓ **Package description** — Updated to reflect 4X civilization builder scope (1919–2100, colonial to nation scale)

## Model Capability Guidance

- **Haiku scope:** Unit tests, bug fixes, small feature additions (<500 LOC), content hooks (events/techs/civics)
- **Opus scope:** Major architecture (Phases 5–7 above), cross-file refactors, large simulation features, integration testing

## Next session — priority fixes

- **✓ Economy rebalanced (was HIGH PRIORITY, addressed 2026-06-22).** The runaway treasury is fixed by
  giving the state a **GDP-scaled public-sector wage bill** (Wagner's law) in `monthlyEconomy`:
  `publicSector = gdp × (0.025 + 0.04·svc + 0.025·mil) × (1 + devShare×0.15)` where
  `devShare = (modernizationIndex + informationIndex)/2`. At the defaults (tax 10%, funded
  services/militia) this lands ~9% of GDP — just under the 10% tax take — so the budget runs a slim
  surplus and the tax/service levers are real decisions again; svc2/mil2 (~15.5%) needs the income-tax
  civic and a higher rate. Headless trace: 2029 treasury fell **$568M → ~$40M** (≈0.5 months of GDP,
  was ~7 months and climbing); early/mid game now genuinely tight (a building is 1–30% of treasury
  through ~1950). The `devShare` lift is deliberately gentle — a steeper one (≥0.35) tips the
  information-era budget into a **deficit death-spiral** (services auto-cut → satisfaction → emigration);
  0.15 verified safe across seeds. Flat headline costs (scout, militia drill) now scale via
  `flatCost(base) = base × devFactor`; the vestigial flat policy bonuses (austerity, protectionism) are
  now GDP-scaled. Regression guard: `tests/economy-balance.test.ts` ("treasury within a few months of
  GDP across a century"). **Residual:** late-game (post-2000) buildings are still cheap *relative to*
  treasury (~0.04%) because base build costs are small and devFactor (gpc^0.7) lags GDP growth; the fix
  band there is more late-game megaprojects/sinks, not more income damping.

## Known weak areas

- **Tech tree DAG layout** — `techTreeLayout()` uses barycenter heuristic; doesn't minimize crossings
  optimally for large sparse trees. Acceptable for current tree size (~40 nodes).

*(All previously noted performance weak spots — `activePolicies` array `.includes()`, `sectorProductivity()` per-settlement recalculation, `avgWageOf()` per-settle reduce — were resolved in PR #240 via `activePolicySet`, `sectorProdCache`, and `wageCache` respectively.)*

## Design reference

`GDD.md` is the design document. `docs/specs/` holds the per-milestone specs. (The former
`PLAN.md` documented the retired TownCore/seamless-world track and has been removed.)
