# CENTURIA

A colony-to-nation deep-simulation builder, 1900–2100. Begin with twelve
named settlers stepping off a wagon; end the century signing peace treaties
as a great power — RimWorld-intimate at town scale, Cities/Citystate at
state scale, Civ at nation scale, all in pixel art over lush
era-evolving backdrops.

- **Design:** [GDD.md](GDD.md) — the full game design document.
- **Milestones:** [01 Tier-1 colony](docs/specs/01-tier1-colony.md) ·
  [02 raids, medicine & relationships](docs/specs/02-raids-medicine-relationships.md) ·
  [03 the flip — town #2, cohorts & Notables](docs/specs/03-the-flip.md) ·
  [04 State layer & procedural world](docs/specs/04-procedural-world.md) ·
  [05 roads, bridges & the art pass](docs/specs/05-roads-and-art.md)
- **Design docs:** [transportation](docs/design/transportation.md)

## Download

Grab the latest installer from the **[Releases page](https://github.com/aslater100/Centuria/releases/latest)**:

| Platform | File |
|----------|------|
| Windows | `Centuria-Setup-x.x.x.exe` |
| macOS (Apple Silicon) | `Centuria-x.x.x-arm64.dmg` |
| Linux | `Centuria-x.x.x.AppImage` |

Once installed the app checks for updates automatically on each launch.

## Run it (development)

```bash
npm install
npm run dev      # play in the browser
npm test         # simulation tests
npm run sim      # headless tuning harness: `npm run sim -- <days> <runs>`
npm run build    # production build
```

## Playing the prototype

### Town Phase (1900–1915)

You start in Spring 1900 with 12 settlers, two cabins, a stockpile, and
about three weeks of provisions. Build farm plots and a cookhouse before
the wagon food runs out; mark trees for wood; get cabins up before winter.
Raiders arrive from week two — your fighters meet them automatically while
the rest hide indoors; palisades (with deliberate gaps) shape the
battlefield. Keep a good medic: untreated wounds fester.

- **Build menu** (left): place blueprints; settlers haul wood and build.
  Shift-click to place repeatedly. *Chop Trees* marks trees for felling.
- **Click a settler** for needs, mood, traits, thoughts, and current task;
  **Work Priorities** opens the per-settler job table (click cells, 0–3).
- **Controls:** **Space** pause · **1/2/3** speed · **WASD/arrows** pan · **Esc** deselect.

### Regional Phase (1910–1940+)

At 20 settlers you can **found a second town** — the moment you do, the game flips: the population becomes cohort statistics on a region map, your most storied settlers become named **Notables** with roles, and the economy shifts to a currency-based system.

**The Regional Map opens:** manage multiple towns across a landscape. Each town has its own production and can trade with others. A second town requires treasury funds (you must build wealth first). Founding a third town and reaching 500 combined citizens lets you proclaim a **Charter** (if you also have a garrison and treasury reserves) — formal statehood.

**Sectoral Economy:** as towns grow, settlers specialize. A town's **sectors** (agriculture, industry, commerce, services, artisan) compete for labor. Your tech choices and zoning decisions determine which sectors thrive. Build a textile mill and your commerce sector grows; neglect it and workers drift to farming. This determines your tax base, trade goods, and citizen mood.

**Town Tiers & City Works:** each town has a tier (1–4) unlocked by population and economic development. Unlock the **Drafting Table** (Tier 2+) to zone residential, industrial, and commercial districts, manage services, and fine-tune local policy. Build roads and rail between towns to unlock trade and reduce isolation penalties.

**Regional Factions & Politics:** rival settlements and factions appear on the map. You can negotiate trade deals, establish truces, or clash with rivals. Local **policies** (labor laws, tax brackets, subsidies) affect both your treasury and citizen ideology. Your choices accumulate as political capital that shapes your nation's future government type.

**Military & Garrison:** maintain a garrison to deter raids and rival aggression. Military readiness becomes a charter requirement and a defensive necessity as rivals grow stronger.

### Nation Phase (1930–2100)

Reaching 9 towns, 6,000 citizens, and researching Statecraft unlocks the **Constitutional Convention** — a scripted event where you choose your government type (democracy, monarchy, junta, corporate state, etc.). Your chosen ideology and notable ministers shape your nation's laws, trade blocs, and diplomatic options.

At the nation tier, you manage provinces, sign treaties, wage wars, and steer a macroeconomy with interest rates and trade policies. The same valley plays utterly differently as a liberal democracy, a junta, or a corporate oligarchy.

## Systems

The simulation is built on a three-tier spine (Town → State → Nation), with each tier introducing new mechanical depth:

| System | Town | State | Nation |
|--------|------|-------|--------|
| **Scope** | One town, 12–150 settlers | Region, 3+ towns, cohort statistics | Continent, provinces, trade blocs |
| **Population** | Individual agents, mood/skills/thoughts | Cohorts (age/class/education) + Notables | Cohorts + Notables as ministers/generals |
| **Economy** | Barter-ish, no currency | Currency, markets, sectors, taxation | Central bank, trade agreements, business cycles |
| **Government** | Founder/Council | Charter (proto-government) | Full government types (democracies, juntas, etc.) |
| **Conflicts** | Raids, disease, famine | Recessions, strikes, rival friction | Wars, revolutions, climate crises |
| **Key Progression** | Tech tree (farming→crafts→industry) | Civics (Regional Charter), town founding | Civics (Statecraft), Constitutional Convention |

**Sectoral Economy** — Each settlement has labor distributed across sectors (agriculture, industry, commerce, services, artisan). Population growth, tech choices, zoning, and policies steer which sectors dominate, shaping your economy and tax base.

**Notables System** — Named individuals (carpenter, medic, guard captain) persist from the town phase through state and nation tiers. They age, gain experience, form relationships, develop ideology, and fill government roles. The founding carpenter's journey from town builder to agriculture minister creates the emotional through-line across two centuries.

**Zoning & City Management** — Starting at Tier 2, unlock the Drafting Table to zone towns and manage services (schools, hospitals, markets). Zoning decisions shape population growth, sector specialization, and district culture.

**Ideology & Politics** — Cohorts and Notables track political opinions (economic left↔right, liberty↔authority). Policies (labor laws, subsidies, trade tariffs) shift ideology over time. Your nation's government type emerges from the accumulated ideology choices of your citizens and leadership.

**Factions & Diplomacy** — Rival settlements and factions compete on the region and continent maps. Negotiate trade, establish truces, sign treaties, or wage war. Your choices build reputation that affects future diplomatic options.

## Layout

```
GDD.md            the design document
docs/specs/       per-milestone implementation specs
src/sim/          headless deterministic simulation core (no DOM)
src/data/         moddable JSON content defs (buildings, traits, names)
src/ui/           canvas renderer (8-bit sprites + parallax backdrop) and HUD
tests/            vitest simulation tests
```
