# CENTURIA

A deep 4X civilization simulator spanning 1919–2100. Found a colony in the
wreckage of the Great War; end eight decades later as a great power signing
peace treaties — Explore a procedural world, Expand from a single settlement
into a mighty nation, eXploit resources through a dynamic sectoral economy,
and eXterminate rivals through diplomacy and war.
True to its roots in games like Victoria, all in hi-def pixel art over lush era-evolving backdrops.

- **Design:** [GDD.md](GDD.md) — the full game design document.
- **Development guide:** [HANDOFF.md](HANDOFF.md) — architecture, completed phases, and roadmap.
- **Early specs:** [docs/specs/](docs/specs/) — per-milestone implementation specs (historical reference).
- **Design docs:** [transportation](docs/design/transportation.md) · [HF MCP + sprite generation](docs/design/hf-mcp-sprites.md)

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

## Gameplay overview

### Colony Phase (1919–1930s)

You arrive in 1919 — the Great War is over, empires have collapsed, and the map has new borders. Your founding settlement is a single town in a procedurally generated valley. Manage its **sectoral economy** (agriculture, industry, commerce, services) as your population grows in cohorts. Research tech and civics nodes to unlock new buildings and capabilities. Build roads to expand, establish trade routes, and found a second and third town.

**The 4X Map:** the game opens on a regional hex map with fog of war. Explore the surroundings, claim territory, and watch rival nations (also starting as single colonies in 1919) grow on the same map.

- **Controls:** **Space** pause · **1/2/5/10×** game speed · **WASD/arrows** pan · **Esc** close panel
- **Keyboard shortcuts:** **S** settlements · **E** economy · **R** research · **N** route network · **P** province view

### Regional/State Phase (1928–1940s)

Found a second and third town and unlock **Regional Charter** — formal statehood. The population becomes cohort statistics (age/class/education), your most storied founders become named **Notables** with roles, and the economy shifts to a full currency-based system.

**Sectoral Economy:** each settlement distributes labor across sectors. Tech choices, zoning, and policies determine which sectors thrive. This shapes your tax base, trade goods, and citizen mood.

**Provinces:** each settlement is a province with its own tax policy, investment level, and autonomy setting. Deploy armies between provinces, manage local governance, and respond to province-level events.

**Regional Factions & Politics:** factions (workers, merchants, landowners, military) push demands. Pass laws, negotiate with factions, manage strikes and grievances. Rival settlements grow and form their own nations on the map.

**Historical Anchors:** the Great Depression fires 1927–1936 if your private leverage and confidence are fragile. Respond with stimulus, austerity, QE, public works, or gold-standard exit — each with lasting consequences.

### Nation Phase (1940–2100)

Reaching 3 states, 6,000 citizens, and researching Statecraft unlocks the **Constitutional Convention** — a scripted event where you choose your government type. Your chosen ideology and Notable ministers shape your nation's laws, trade blocs, and diplomatic options.

At the nation tier: manage provinces, sign treaties, run espionage operations, wage wars with inter-provincial army movement, and steer a macroeconomy with interest rates and monetary policy. The world-war window fires 1936–1948 if great-power tensions peak. The oil shock hits 1970–1985 if you haven't transitioned away from combustion.

**Scope and timeline:**
- **Years simulated:** 1919–2100 (~180 years); the game ends 1 January 2100 with a Century Report
- **Era boundaries:** Interwar (1919 — game start), War Economy (1939), Atomic Boom (1945), Shocks (1970), Information (1991), Climate & Automation (2010), Speculative Branch (2040)
- **Game pacing:** Real-time with pause; calendar accelerates per tier to keep decision rate constant. At 1× speed: ~1 hour per in-game year. Play at 1×–10× acceleration; pause anytime to manage crises, plan infrastructure, or just breathe

## Systems

The simulation is built on a three-tier spine (Town → State → Nation), with each tier introducing new mechanical depth:

| System | Colony (1919–1930s) | State (1928–1945) | Nation (1940–2100) |
|--------|------|-------|--------|
| **Scope** | One founding settlement, hex map, fog of war | Region, 3+ towns, provinces | Continent, provinces, trade blocs |
| **Population** | Cohorts (age/class/education) from founding | Cohorts + Notables with roles | Cohorts + Notables as ministers/generals |
| **Economy** | Sectors, barter-adjacent, proto-currency | Currency, markets, taxation, route trade | Central bank, monetary policy, business cycles, espionage |
| **Government** | Founder/Council | Charter (proto-government) | Full government types (democracies, juntas, etc.) |
| **Conflicts** | Rival friction, historical anchors | Recessions, strikes, Depression (1927–36) | Wars, revolutions, oil shocks, pandemic, climate |
| **Key Progression** | Tech + civics tree, road/rail expansion | Civics (Regional Charter), town founding | Civics (Statecraft), Constitutional Convention |

**Sectoral Economy** — Each settlement has labor distributed across sectors (agriculture, industry, commerce, services, artisan). Population growth, tech choices, zoning, and policies steer which sectors dominate, shaping your economy and tax base.

**Notables System** — When your colony earns statehood, your most storied founders are promoted to named Notables. They age, form relationships, develop ideology, and fill government roles (mayors, ministers, generals, press barons). A Notable born in 1890 who helped build your first settlement can serve as agriculture minister in 1940 before dying in office — that continuity is the emotional through-line of the whole campaign.

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
