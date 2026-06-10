# CENTURIA — Game Design Document
### A colony-to-nation deep-simulation builder, 1900–2100

**Version 0.1 — Foundational GDD**

---

## 1. Names & Elevator Pitch

**Candidate names:**

1. **CENTURIA** *(recommended)* — evokes the two-century span and the march of generations; short, ownable, reads well in 8-bit type.
2. **THE LONG CENTURY** — historians' framing ("the long twentieth century"), signals the era-spanning ambition and the political-economy soul.
3. **SMOKE & SIGNAL** — the energy/information arc in two words: coal smoke in 1900, signal (radio → internet → AI) by 2100; also describes the art style's smoky, atmospheric backdrops.

**Elevator pitch:**
CENTURIA begins with twelve named settlers stepping off a wagon in 1900 and ends — two hundred years later — with you signing peace treaties as a great power in 2100. It is three games stacked into one continuous life: a RimWorld-intimate colony sim where losing one carpenter to fever is a tragedy; a Cities-Skylines-meets-Citystate political economy where you wire towns together with rail, tax brackets, and ideology; and a Civ-scale grand strategy of trade wars, world wars, and climate reckoning. The same valley plays utterly differently as a liberal democracy, a junta, or a corporate state. Rendered in deliberate 8-bit pixel art set against lush, era-evolving painterly backdrops — steam and soot giving way to neon, then to solar glass or drowned coastlines — CENTURIA spends its entire rendering budget on one thing: the deepest economic, political, and social simulation that fits in a sprite.

---

## 2. The Spine: Town → State → Nation

This is the load-bearing system. Every other system in this document attaches to one of its three tiers, and the document is ordered so that nothing is specified before the tier it lives on exists.

### 2.1 The three tiers

| | Tier 1 — TOWN | Tier 2 — STATE | Tier 3 — NATION |
|---|---|---|---|
| **Reference DNA** | RimWorld | Cities: Skylines + Citystate II | Civ VI |
| **Map scope** | One local map, ~256×256 tiles | Regional map, ~12–20 town sites | Continental map, provinces & borders |
| **Population model** | Individual agents (every settler simulated) | Aggregate cohorts + Notables | Aggregate cohorts + Notables |
| **You directly control** | Individual work priorities, every building | Zoning, inter-town infrastructure, budgets, first laws | National policy, diplomacy, war, macroeconomy |
| **Economy** | Physical goods, barter-ish, no currency | Currency, markets, taxation, sectors | Central bank, trade blocs, business cycles |
| **Government** | Founder/Council (no formal type) | Provisional Charter (proto-government) | Full government types (constitutional moment) |
| **Threats** | Raids, disease, famine, weather | Recessions, strikes, rival-state friction | Wars, depressions, revolutions, climate |
| **Typical years** | 1900–1915 | 1910–1940 | 1930–2100 |

### 2.2 Promotion rules (exact)

**Town → State ("Incorporation"):**
- Control **≥ 3 towns** (founded by expedition, or absorbed by treaty/purchase from minor settlements).
- Combined population **≥ 500**.
- Civics node **Regional Charter** researched (civics tree, mid-Industrial era).
- All towns connected by road or rail (the connection requirement is what makes Tier-2 infrastructure play start *before* the promotion — you build the State before you proclaim it).
- One-time treasury cost (≈ 6 months of town output) representing surveys, courts, and a land registry.

**State → Nation ("Proclamation"):**
- Control **≥ 3 States** (≥ 9 settlements).
- Combined population **≥ 6,000**.
- Civics node **Statecraft** researched.
- Hold a **Constitutional Convention** — a major interactive event where you formally choose your first government type (§9), seat your founding Notables as ministers or rivals, and set the national flag/name. This is the promotion-as-moment requirement: Proclamation is a 3–5 decision scripted sequence, not a button.

**Why 3-and-3:** small enough that promotion arrives while the previous tier is still fun (no grinding out town #7 at town granularity), large enough that each promotion roughly triples your scope — which matches the roughly 10× zoom-out each tier applies.

### 2.3 The soft ceiling on Town 1 (the performance release valve)

Individual simulation is budgeted for **~150 agents**. The design pushes you to expand *before* you hit it:

- Up to **60 settlers**: no penalty.
- **61–100**: each settler above 60 adds **−0.75% global work efficiency** ("Growing Pains" — informal governance stops scaling) and **−1 mood/10 settlers** ("Crowded Frontier").
- **101–150**: penalties double; immigration wagons stop arriving ("word has spread there's no room").
- **150** is a hard cap.

The fix for Growing Pains is researching Regional Charter and founding town #2 — at which point penalties clear, because administration formalizes. Expansion is simultaneously the narrative goal, the mechanical cure, and the performance valve. The player never experiences the agent cap as an arbitrary wall; they experience it as their town outgrowing frontier informality.

### 2.4 The simulation flip (individual → aggregate)

The moment town #2 is founded, the population model switches **once, permanently, everywhere**:

- Every settler is folded into a **cohort matrix**: `[age band (0–14, 15–29, 30–49, 50–69, 70+)] × [class (lower/middle/upper)] × [education (none/basic/secondary/tertiary)]` per settlement, with each cell carrying counts, health, employment, and an **ideology distribution** (two axes, economic left↔right and liberty↔authority, stored as mean + spread per cell). Cohorts age, reproduce, migrate, learn, and shift opinion by statistical model — never per-agent.
- The flip is **continuous, not jarring**, because of the handoff design below.

**The Notables carve-out (keeping the attachment):** at the flip, the **8–16 most story-laden settlers** (highest skills, most relationships, most event history — the ones the player already cares about) are promoted to **Notables**: named individuals tracked forever, with traits, opinions, relationships, aging, and death. Notables fill every named role for the rest of the game: mayors, ministers, generals, central bankers, union bosses, press barons, dynasty members, coup plotters. Their children can become Notables. The founding carpenter whose leg you saved in 1903 can be the agriculture minister who resigns over your collectivization law in 1931 — that continuity is the emotional through-line of the whole 200 years. Notable cap: **~24 alive at once**; new ones are minted from cohort statistics when roles open (a strike spawns a named union leader drawn from the lower-class industrial cohort).

**Drill-down without recursion:** at any tier you can open any settlement and manage it (zoning, services, local policies). The city view renders **representative agents** — sprites instantiated *from* cohort statistics to walk the streets, visualize traffic and crowding, and be inspected ("Mara T., 34, textile worker, lower class, leans left, angry about rents") — but they are **portraits of the statistics, not the simulation itself**. This preserves the Skylines pleasure of drilling into a life while keeping the authoritative model aggregate. *(This is a deliberate liberty taken with the brief: the brief says individual sim exists only in the single-town phase, which I keep authoritative-side — but cosmetic representative agents are cheap, and without them the city view feels dead.)*

### 2.5 Zoom, territory, and what switches on per tier

- **Zoom levels:** Town view (tile-level) → Region view (town markers, routes, terrain) → Continent view (provinces, borders, trade lanes). Promotion unlocks the next view; all previous views remain accessible (the altitude *defaults* up, it doesn't lock up).
- **Territory:** Tier 1 claims a radius around the town. Tier 2 claims hex-province parcels by survey + settlement + infrastructure reach. Tier 3 inherits state borders; further territory comes from settlement of unclaimed land (scarce by mid-century), purchase, treaty, or war.
- **Systems switching on:** currency, taxation, zoning, and proto-politics at Tier 2; central bank, formal government types, full diplomacy/war, trade agreements at Tier 3. (Full table in the systems sections.)
- **Tier asymmetry on the shared map:** see §6.4 for how a Tier-1 player coexists with a Tier-3 rival.

---

## 3. Art & Audio Direction

### 3.1 The two-layer look: 8-bit foreground, painterly-pixel background

The signature image is **simple readable sprites in front of deep atmospheric backdrops**. Concretely:

- **Foreground (gameplay layer):** strict 8-bit discipline. Sprites on a 16×16 base grid (buildings up to 48×64), **4 colors per sprite** from era palettes, no anti-aliasing, no rotation (4-direction only), chunky 1-px outlines. Everything the player can click is foreground. The constraint is functional: at a glance, gameplay-relevant objects pop out of the lush backdrop *because* they're flatter and cruder.
- **Background (atmosphere layer):** 5 parallax bands behind the play field — sky/celestial, far terrain, distant skyline, mid haze, near canopy — each allowed **full 64-color era palettes**, dithered gradients, animated weather, and painterly composition. The background is where the budget for beauty lives and where the century's storytelling happens: it shows what your *civilization* looks like while the foreground shows what your *decisions* look like.
- **The contrast rule:** background may never contain a clickable object; foreground may never use background palettes. Players learn in minutes that crisp = interactive, lush = world.
- **Dynamic backdrop composition:** the skyline band is procedurally assembled from your actual stats — industrial output adds smokestacks, finance sector adds towers, smog particle density maps to your pollution number, neon density to your service/consumer economy, cranes to construction rate. The backdrop is a live dashboard you read emotionally before you read it numerically.

### 3.2 Era visual evolution

Each era swaps palettes, backdrop kits, and lighting; transitions blend over 2–3 game years so the century *creeps* rather than flips.

| Era | Palette feel | Backdrop signature |
|---|---|---|
| 1900–18 | Sepia, soot browns, gaslight amber | Smokestacks, rail trestles, coal haze, oil lamps at night |
| 1918–39 | Warmer brick reds, early electric white | Radio masts, art-deco rooflines, breadlines in busts |
| 1939–45 | Desaturated olive/steel | Blackout nights, searchlights, factory glow, barrage balloons |
| 1945–70 | Optimistic pastels, chrome cyan | Highways, suburbs, drive-ins, cooling towers, TV aerials |
| 1970–91 | Smoggy ochre, sodium orange | Concrete blocks, traffic haze, oil refineries, first wind turbines |
| 1991–2010 | Cool blues, glass white, CRT glow | Glass towers, billboards, container ports, satellite dishes |
| 2010–40 | High-contrast: solar white vs. storm grey | Solar fields, server farms, flood barriers, megastorm skies |
| 2040–2100 | **Branches:** solarpunk greens/golds *or* cyberpunk neon-on-black *or* drowned grey-greens | Vertical farms & garden towers / corporate arcologies & acid rain / sea walls, stilt districts, abandoned coastal zones — chosen by your climate, economy, and regime outcomes, not the calendar |

Day/night cycle, seasons, and weather run at all tiers; at Nation tier the continent view gets its own backdrop treatment (jet contrails, satellite tracks, aurora of city lights at night that literally grows as nations urbanize).

### 3.3 Audio arc

- **Soundtrack ages with the century:** 1900s = chiptune interpretations of ragtime and brass bands; interwar = chip-jazz; mid-century = chip arrangements with synth strings creeping in; 70s–90s = analog synth idioms; 2000s+ = layered electronica; 2040+ branches (organic/acoustic-hybrid for solarpunk, industrial dark synth for dystopia). The chip timbre never fully leaves — it's the franchise voice — but the instrumentation around it modernizes.
- **Soundscape is diegetic data:** hammering, looms, train whistles → traffic drone, phone rings → notification chimes, drone hum. Unrest is audible (chanting under the music) before it's visible. Each government type tints the public-address layer (church bells under theocracy, patriotic loudspeakers under one-party rule).
- **Dynamic mixing:** music intensity follows a tension scalar (war, crisis, unrest); paused game drops to ambient only, making pause a place to think.

---

## 4. The Core Gameplay Loop

### 4.1 Minute-to-minute (varies by tier — by design)

**Tier 1 (a typical 10 minutes):** check overnight events → triage a sick settler (assign to bed, choose treatment) → adjust work priorities (harvest before the frost) → queue two buildings, designate a mine → respond to an event card (a wanderer asks to join: accept the extra mouth?) → set winter food rationing → unpause, watch sprites work, drill into a settler whose mood is dropping → pause, fix it (build a recreation hut next to the mill).

**Tier 2:** review the regional dashboard (unemployment by town, goods flows) → re-zone a district in town 2 → approve the rail link bond issue → set this year's income-tax band → handle a strike event in the textile sector (concede / negotiate via a Notable / send constables) → check the election forecast → unpause.

**Tier 3:** read advisor briefs → respond to a diplomatic envoy (counter-offer on a trade treaty) → adjust the central-bank rate against rising inflation → slot a new policy card after the election → review the war plan for theater 2, change mobilization level → drill into the capital to fix a service shortfall the interior minister flagged → unpause.

The verbs evolve (assign → zone → legislate) but the loop shape is constant: **read the situation → intervene at your altitude → let the simulation answer → an event personalizes the consequences through a Notable.**

### 4.2 The full arc (one playthrough, ~35–60 hours)

1. **1900–1908, survival:** 12 settlers, first winter, first raid, first death and funeral. You learn the people.
2. **1908–1918, outgrowing the frontier:** Growing Pains penalties bite; you send an expedition to found town 2, then 3; rail link; **Incorporation** ceremony — your founders become a provisional government, the population becomes cohorts, your favorites become Notables.
3. **1918–1939, the political economy:** currency, taxes, classes, lobbies, the first election (or your refusal to hold one). The 1929-analog crash stress-tests you. You expand to 3 states.
4. **~1935, Proclamation:** the Constitutional Convention. You choose what this country *is*. Every system recolors.
5. **1939–1945, the war era:** rival nations have matured in parallel; the great-power war arrives by invitation or aggression. Mobilization, rationing, fronts, peace terms.
6. **1945–1990, the long boom and its bill:** suburbanization, energy choices, Cold-War-style bloc politics, oil shocks, maybe a regime change (chosen or suffered).
7. **1990–2040, information and climate:** services/information economy, media and misinformation politics, automation unemployment, emissions bill coming due.
8. **2040–2100, the reckoning:** fusion or collapse, sea walls or retreat, solarpunk or corporatocracy. The game ends 1 Jan 2100 with a **Century Report**: your timeline, your Notables' dynasty tree, your counters — and sandbox continues past it if you wish.

---

## 5. Core Systems

Each system below specifies: key variables, what the player does, what the sim does back, and connections.

### 5.1 City building & infrastructure (Tiers 1–2 hands-on; Tier 3 by exception)

**Key variables per settlement:** land value map, pollution maps (air/water/noise/ground), service coverage maps, traffic load per road segment, utility capacity vs. demand per grid.

- **Tier 1:** direct placement — every structure hand-placed; no zoning. Stockpiles are physical; goods are hauled by settlers.
- **Tier 2+ zoning:** R/C/I/O zones with 3 density levels unlocked by era + demand. Buildings grow from demand: residential demand = jobs + amenity − rent pressure; commercial demand = local purchasing power; industrial demand = input access + freight capacity; office demand = tertiary-educated workforce (era-gated).
- **Utilities:** generation → distribution → consumption with hard capacity. Power plants by era (coal 1900 → oil/gas 1930s → nuclear 1960s → renewables 2000s+ → fusion 2060s, see §10); brownouts cut industrial output 30% and mood; water/sewage drive disease; garbage drives land value and ground pollution.
- **Transport:** roads (dirt → paved → highway), rail (freight is king 1900–1950), transit (tram → bus → metro), later airports/ports. Congestion is computed per segment from agent/freight flow; freight congestion raises goods prices locally (direct economy hook).
- **Services:** police, fire, clinics/hospitals, schools/universities, parks — radius-based coverage feeding crime, health, education, and land value. Service buildings have era versions (the 1905 schoolhouse and the 2050 learning center are different buildings with different throughput).
- **Land value** propagates from amenity, coverage, transit access, and pollution (negatively); it sets rents (class sorting — who can afford to live where), property-tax yield, and gentrification pressure (a feedback the politics system reads).
- **Pollution** is produced per building, diffuses locally, sinks into ground/water, and exports to the global climate ledger (§8.2).

**Connections:** infrastructure capacity caps economic throughput (§5.2); service coverage feeds approval (§5.3); coverage gaps concentrate by class and become political grievances; pollution feeds health, mood, and climate.

### 5.2 Economic simulation (centerpiece)

**Architecture: physical micro, behavioral macro.** Goods are real and conserved (produced, stored, shipped, consumed) at Tiers 1–2 granularity; macro variables (inflation, GDP, rates) emerge from sums over the physical layer plus a financial layer that is deliberately behavioral.

**Goods & supply chains (MVP set of 18, full set ~44):**

- *Primary:* grain, livestock, wood, coal, iron ore, oil (era-gated), stone.
- *Intermediate:* lumber, steel, textiles, fuel, electricity, chemicals (full), components (full).
- *Final:* food, clothing, tools, consumer goods, machinery, luxury goods; later vehicles, electronics, pharmaceuticals (full).
- *Abstract sectors (Tier 2+):* construction, services, finance, information — modeled as capacity/output without physical tokens.

Each producing building: inputs/tick → outputs/tick × efficiency (labor skill, power, machinery level). Goods move on the transport network with real transit time and cost; **distance and congestion are tariffs nature charges**.

**Markets & prices:** each settlement has a local market per good. Price update per tick: `Δp = p × 0.05 × (demand − supply) / max(supply, ε)`, clamped ±2%/day, with arbitrage by traders moving goods between settlements (margin > transport cost) — regional price convergence emerges from this rule, not from script.

**Labor market:** workforce by cohort cell supplies labor to sectors; each sector posts demand at a wage; wages drift toward clearing: persistent vacancies push wages up 1–3%/quarter, persistent unemployment pushes down (stickier downward — 0.5%/quarter — which is what makes recessions hurt). Education gates sector access (no engineers without secondary schools). Unemployment by class is a first-order input to approval, migration, and unrest.

**Macro layer (switches on at Tier 2, full controls at Tier 3):**
- **GDP** = sum of value-added; reported quarterly with sector breakdown.
- **Inflation** emerges from money growth vs. real output plus shock terms (energy price pass-through is explicit: fuel feeds everything's costs).
- **Central bank (Tier 3):** set the policy rate (or peg, or print). Low rates → credit expansion → investment & asset prices ↑ → boom; credit builds private **leverage**; when debt service exceeds ~18% of GDP, the economy is fragile — any shock (harvest failure, oil shock, war scare) can flip **confidence** (a 0–100 behavioral variable) and trigger deleveraging: the bust. **Business cycles are therefore emergent**: the boom plants the bust. Central-bank independence is a policy with political costs either way.
- **Currency & FX (Tier 3):** exchange rate from trade balance + rate differential + confidence; devaluation boosts exports and import prices (inflation) — a real lever with real teeth.

**Public finance:**
- **Tax instruments:** income (progressive, set 3 band rates), corporate, land value, consumption/VAT (unlocks 1950s), tariffs (per good category), capital gains (full scope). Each has a distinct incidence (who pays → who gets angry → §5.3) and an evasion/flight elasticity that rises with rate and falls with state capacity.
- **Spending:** services, infrastructure, transfers (pensions, unemployment insurance, subsidies), military, debt service.
- **Debt:** issue bonds at coupon = base rate + credit-rating spread. **Credit rating (AAA→D)** from debt/GDP, deficit trend, inflation, political stability; downgrades compound interest costs — the debt-spiral failure state is legible on one chart.
- **Sectoral transition over time:** as machinery, education, and tech advance, labor productivity in agriculture/industry rises, releasing labor to services then information — the agrarian→industrial→service→information arc emerges from relative productivity + demand saturation (engine: Engel-style demand curves — food demand saturates, services demand doesn't). Post-2040 it branches: automation can carry productivity past employment (post-scarcity politics, §8.1) or the energy/climate bill can drag it down (contraction).

### 5.3 Government & politics

**The universal state, present under every regime:**
- **Approval (0–100):** rolling average of cohort satisfaction = weighted (employment, real wage growth, service coverage, safety, liberty-fit, war fatigue, scandals). Computed per class and per region — *who* is unhappy matters as much as the average.
- **Legitimacy (0–100):** the regime's *right to rule* in citizens' eyes. Distinct from approval: a democracy with 30 approval is unpopular; an autocracy with 30 legitimacy is in danger. Each regime type has different legitimacy sources (elections won, dynasty continuity, ideology, performance, divine sanction — see §9).
- **Liberty↔Control axis (0–100):** position set by your laws (press, assembly, courts, surveillance). It gates which policies are available, sets emigration/immigration appeal for different cohorts, and creates *fit* effects: educated/urban cohorts want liberty, security-anxious cohorts tolerate control.
- **Corruption (0–100):** grows with state control, spending opacity, and one-party tenure; shrinks with press freedom, courts, and prosecutions (which cost political capital and can hit your own faction's Notables). Corruption is a direct tax on every spending program's efficiency.
- **Political capital:** the currency of action. Earned by approval, legitimacy, and faction support; spent to pass laws, change policies, prosecute, purge, or call referenda. Big moves (changing government type) cost more than you can bank — they require a *window* (crisis, war victory, landslide).
- **Factions & lobbies:** 6–10 active interest groups depending on era and economy — landowners, industrialists, labor, finance, military, clergy, intelligentsia, agrarians, later environmentalists and tech. Each has: power (share of economy/army/media it controls), demands (concrete policy positions), and patience. Every law lists who it pleases and angers *before* you sign it.
- **Laws & policies:** a living statute book organized in domains (economic, social, security, information). Passing a law costs political capital scaled by opposition; repeal is costlier than passage (institutions ossify). Tier 3 adds **policy slots** (Civ-style): your government type grants slots by category (economic/social/security/diplomatic) into which researched policy cards are socketed — representing what your administration can *focus* on, on top of the statute book.

**Power transitions:** elections (scheduled or called), succession (dynastic, with crises when heirs are weak/contested), coups (military faction power × low legitimacy × a trigger), revolutions (sustained unrest + an organized opposition faction + a spark event), constitutional reform (the orderly path: expensive, slow, rare windows). **Changing government type is a mid-game event chain, not a toggle:** 3–8 linked decisions over months/years with faction resistance, possible violence, international reactions, and a new constitution at the end. The full regime roster with mechanics per type is the comparison table in §9.

**Connections:** every economic variable is also a political variable through class incidence; the media system (§8.3) modulates how true the public's *perception* of any number is; war needs the consent machinery (§7.5).

### 5.4 Trade, diplomacy & warfare (overview — warfare detailed in §7)

**Trade (first-class, Tier 2 inter-town → Tier 3 international):**
- **Comparative advantage is geological and learned:** map resources set primary advantages; accumulated industry skill sets manufactured ones.
- **Trade routes** are concrete objects (rail/sea/road/air lanes) with capacity and interdictability (war hook).
- **Instruments:** tariffs per good category, trade agreements (mutual tariff cuts, scoped by good), embargoes/sanctions (unilateral or bloc), strategic stockpiles, export controls on dual-use goods (late eras).
- **Dependency is the strategic substance:** the trade screen shows your *import dependency ratio* per critical good (food, fuel, steel, components) and who supplies it. An opponent reading 80% fuel dependency on you has a casus-belli-free weapon; so do you. Supply shocks (embargo, war, canal closure event) propagate through real supply chains — the oil shock isn't a popup, it's a fuel price your trucking, plastics, and heating all pay.

**Diplomacy (Tier 3; proto-version of the same verbs at Tiers 1–2 with neighboring towns/states):**
- **Relations ledger per rival:** −100..+100 from treaty history, trade volume, ideology distance, border friction, favors and grudges (memory list with decay halflives of *decades* for betrayals, years for favors).
- **Treaty types:** non-aggression, defensive pact, alliance, trade agreement, border settlement, tribute, tech exchange, climate accord (late era), peace treaties.
- **Negotiation is bargaining (§6.3):** multi-item offers, counter-offers, AI-side valuation — never a single accept/reject.
- **Reputation:** treaty-breaking is remembered by *everyone*, priced into all future deals (+30–50% ask), and is the deliberate cost of opportunism.

### 5.5 Population & society (the aggregate layer)

The cohort matrix (§2.4) is the substrate; these are its dynamics:

- **Demographic transition:** birth rates start high (1900: ~35/1000) and fall with education, urbanization, and child survival; death rates fall with health spending and sanitation. The transition is the century's quiet motor: it gives the 1950s boom and the 2050s aging crisis (pension spending vs. shrinking workforce — a fiscal time bomb the player sets in the 1980s).
- **Migration:** settlements and (Tier 3) nations have an *appeal score* per class (wages, housing cost, services, safety, liberty-fit, discrimination). Net migration flows down appeal gradients. Crises produce refugee waves — accepting them is labor + cost + political reaction, a recurring dilemma with era-specific framing (1915 war refugees, 2045 climate refugees).
- **Education pipeline:** school coverage converts child cohorts to basic/secondary; universities to tertiary. 15–25 year lag between spending and workforce effect — the canonical long-lag investment the UI must make visible (§8.5).
- **Social mobility & inequality:** class transitions per generation from education access + economy structure; a **Gini-style inequality index** feeds unrest, populism (ideology drift to extremes), and crime. Redistribution lowers it at efficiency and faction cost — the Citystate tension, kept central.
- **Opinion dynamics:** each cohort cell's ideology drifts toward (a) its material experience (unemployed drift anti-incumbent and toward extremes; prosperous drift status-quo), (b) media exposure (§8.3), (c) generational replacement (children imprint on the era they come of age in — the 1968-analog and 2030s youthquakes emerge from this). Regimes can suppress *expression* without changing *opinion* — the gap between them is the pressure gauge for revolution.
- **Unrest ladder:** grievance accumulates per cohort → petitions → strikes (sector output cut) → protests (with crackdown/concede branching) → riots → organized opposition → revolution (§9 failure modes). Each rung is visible, attributable ("dockworkers, over wage decline and rent"), and interruptible — repression resets the rung but raises hidden pressure; concession costs capital but vents it.

### 5.6 Time, eras & technology

- **Clock:** continuous real-time with pause and 3 speeds; **calendar compression rises with tier** — at speed 1: Town ≈ 45s/day, State ≈ 8s/day, Nation ≈ 1.5s/day (≈ 40s/month). Rationale in §8.6.
- **Eras** (the 8-era spine from the brief, adopted as-is, §10) gate buildings, units, policies, events, art, and music. Era entry is by *date window + tech threshold* — you can lag or lead the world by a decade, not forever.
- **Twin trees:** **Technology** (~120 nodes full / ~60 MVP; physical capability: power, transport, industry, medicine, information, military) and **Civics** (~80/~40; social capability: administration, suffrage, labor law, welfare state, mass media, environmentalism, statecraft — including the ladder gates Regional Charter and Statecraft). Tech progresses from research spending + education + diffusion (lagging nations adopt proven tech at discount — prevents runaway leaders); civics progress from spending + *lived conditions* (you can't research Mass Suffrage with no middle class; Environmentalism unlocks faster the dirtier your air is — civics are demanded by society, not just chosen).
- **The energy transition is the tree's spine:** coal → oil/gas → nuclear → renewables → fusion, each with cost curves, infrastructure lock-in (a coal grid resists conversion — stranded-asset costs are explicit), geopolitics (oil dependency), and emissions (§8.2). Energy price is the single most connected number in the economy, by design.
- **Speculative branch (2040+):** fusion, general automation, geoengineering, arcologies, life extension — gated by world state, so the endgame tree differs run to run.

---

## 6. Game Modes & the AI Opponents

### 6.1 Sandbox

Open-ended; world generated with **0–7 rivals set to passive/cooperative or none at all**. All internal failure states remain live (bankruptcy, revolution, collapse, depopulation, climate catastrophe) — the world can still kill you, it just won't *decide* to. Sandbox exposes generation knobs: map size/climate, resource abundance, crisis frequency, historical-anchor toggle (fire the 1918/1929/1939 analogs on schedule, or let only emergent crises occur), era start (begin in 1950 with a pre-built state for players who want the back half).

### 6.2 AI Opponents (Grand Strategy)

A shared continent, **default 5 rivals (range 3–7)**, all of whom **start as single towns in 1900 and climb the same ladder**. World gen seeds 6–8 viable basins separated by soft geography (mountains, rivers, distance), each with a distinct resource skew so comparative advantage and dependency are baked into the map. Unclaimed land between basins is the early-century expansion frontier; it runs out around the 1930s–50s, which is exactly when the game wants territorial pressure to start translating into diplomacy and war.

**Rival pacing:** AI expansion speed is drawn per-rival from its personality (below) ± difficulty setting; the *world* reaching Nation tier is loosely banded (first AI Proclamation ~1925–1945) so the grand-strategy layer reliably exists by mid-century even if the player lingers at town scale.

### 6.3 The opponents as actors

Each rival is generated (or hand-authored in scenarios) from:

- **Personality weights (0–10):** Expansion, Commerce, Ideology, Honor (treaty-keeping), Risk, Grudge. These drive everything: build priorities, settlement rate, treaty appetite, war thresholds. Archetypes are presets over the weights — *the Hegemon* (Exp 9, Risk 7), *the Trading Republic* (Com 9, Honor 7), *the Hermit Kingdom* (Exp 2, Grudge 8), *the Crusader State* (Ideo 9), *the Opportunist* (Risk 9, Honor 2).
- **An agenda:** 1–2 generated long-term goals, discoverable through diplomacy/espionage ("control the southern coast," "unite the river basins under one faith," "corner the oil trade"). Agendas explain behavior — the opponent should feel *legible in hindsight*.
- **A regime:** rivals choose government types at their own Proclamations (personality-weighted) and can change them — the 1930s should produce at least one neighboring autocracy organically. Regime distance feeds relations; regime *change* in a rival is a world event the player reads about and reacts to.

**Negotiation engine:** every treaty is a basket of items, each with a value in **diplomatic points** computed *from that AI's own situation and personality* (fuel access is worth triple to an oil-poor industrializer; a border province is near-priceless to a high-Grudge rival who lost it to you in 1942). The AI accepts when `offered value ≥ asked value × (1 + risk premium − relationship bonus)`, counter-offers when within 30% (it removes/adds items, asks sweeteners), and walks away — stating why, truthfully but vaguely ("our people will not trade away the coast") — when far off. The player has the same toolkit against them. Honor weight sets the probability a signed treaty survives a tempting betrayal window; betrayed treaties feed the reputation ledger everyone reads.

### 6.4 Tier asymmetry on the shared map

- A Tier-3 rival sees a Tier-1 player as a *minor settlement*: it can trade with you, court you (protection/tribute offers), pressure your borders — but **annexation of minors costs disproportionate legitimacy and reputation** ("bullying" penalty with all other powers), which is the diegetic guardrail that keeps the early game survivable without making big rivals fake. Difficulty settings scale this guardrail.
- Early-game friction is town-scale regardless of tier gap: border survey disputes, raid sponsorship (deniable), trade spats, resource-claim races — handled by the proto-diplomacy verbs.
- A Tier-1 *player* sees Tier-3 rivals as the weather of the world: their wars move prices (your wool exports boom in their wartime), their refugees arrive at your gate, their blocs ask you to lean. You are small, not safe — and the game is honest about which.

---

## 7. Warfare (country-vs-country, strategic and abstracted)

Combat abstraction *rises* with tier: Tier 1 raids are settler-level fights (defend behind walls, every wound tracked); Tier 2 conflicts are militia/constabulary actions resolved semi-abstractly; Tier 3 war is the full system below. No tactical battles, ever, at Tier 3 — the player fights with industry, logistics, and politics.

### 7.1 Declaration & casus belli

Wars need a casus belli (border dispute, treaty violation, protection of co-ideologues, resource denial, fabricated — fabrication costs reputation and home-front legitimacy). CB quality scales **war support** (the home-front consent meter) at declaration: a defensive war starts at support 85; a naked land grab at 40.

### 7.2 Mobilization & the war economy

Three mobilization levels — **Peacetime / Partial / Total** — each a package of sliders the regime type constrains (§9):

| | Partial | Total |
|---|---|---|
| Conscription | volunteers + selective draft | mass conscription (workforce −10–25%) |
| Industry | 15% of manufacturing → armaments | 40–60% conversion; consumer goods scarcity |
| Rationing | none | food/fuel rationed (mood −, but support + if war is popular) |
| Finance | war bonds | bonds + money printing (inflation lag bomb) |

War is a *stimulus first* (armaments demand, full employment) *and a drain after* (debt, inflation, lost workforce, deferred maintenance) — both halves modeled, so victors can still lose the peace.

### 7.3 Fronts, forces, attrition

- Forces are **Army Groups** (the only military "unit"), with manpower, equipment level (from your industry's tech/output), supply state, doctrine (tech tree), and morale.
- Wars resolve on **fronts** — contact lines between hostile territories, plus naval/air theaters as lane-control layers (blockade = trade interdiction made of warships).
- Weekly front resolution: `combat power = manpower^0.6 × equipment × supply × doctrine × morale`; the ratio moves the front line through provinces and sets casualty rates. The sub-linear manpower exponent makes quality and logistics matter more than raw mass — industrial strategy is the real war game.
- **Supply** flows down the rail/road/sea network from industrial centers; overextended fronts starve (power ×0.5 and falling). Cutting supply (deep front moves, blockade, bombing — late eras) beats frontal pushes.
- **Attrition** burns manpower and equipment continuously even on quiet fronts; manpower pools draw down cohort males 15–49 (visible forever after in the demographic pyramid — wars leave scars the pension system feels in 1970).

### 7.4 Occupation, war weariness, peace

- Occupied provinces yield partial output, cost garrisons, and accumulate **resistance** scaled by ideology distance and your occupation policy (conciliatory ↔ brutal; brutality is cheaper now, costlier forever — resistance memory, reputation, postwar integration penalties).
- **War support** decays with casualties/population, rationing, defeats, and duration; rallies on victories and attacks on home soil. Low support → strikes, draft riots, electoral wipeouts, coup risk — *how* it bites depends on regime (§9).
- **Peace is negotiated with the §6.3 engine**, priced in **war score** (front positions, occupied territory, blockade effects, capital threat): annex border province (15–25 each), reparations (10/tranche), demilitarized zone (15), puppet/regime change (45), status quo (0). Overreach is possible and punished: a humiliated rival is a Grudge-9 revanchist for fifty years — the Versailles loop is a designed trap.

### 7.5 Regime × war (the headline interactions)

Democracies mobilize slowly, need support > ~45 to sustain offensives, but get war-bond and ally bonuses and recover legitimacy from *defensive* victory. Juntas/one-party states reach Total mobilization fast and ignore support down to ~25, but defeat is existential (coup/revolution check on major losses) and their economies pay corruption tax on every shell. Monarchies fight cabinet wars cheaply but dynastic prestige is on the line. Corporatocracies fight short profitable wars well and long wars terribly (shareholder patience is the war-support analog). Full column in §9.

---

## 8. The "Also Design These" Systems

### 8.1 Dynamic crises & events

Two engines, one pipeline:

- **Historical anchors** (toggleable, default on): the 1918 pandemic, the 1929-analog crash (fires only if a global credit boom exists — the sim sets the fuse, history strikes the match), the world-war window (1936–1948, fires when great-power tension peaks), oil shocks, a 2020-analog pandemic, climate tipping events. Anchors are *parameterized by world state*, so they rhyme with history rather than reciting it.
- **Emergent crises** from the sim's own thresholds: bank runs (leverage + confidence break), energy shortages, hyperinflation (money printing), automation unemployment waves, famines, secession movements, refugee surges.
- **Event presentation:** crises arrive as chains with decisions, always voiced through Notables (your finance minister begs for the gold-standard exit; the union boss offers a no-strike pact for board seats). Decisions trade short-term pain against long-term structure — and the *same* crisis under a different regime offers different options (a junta *can* shoot the strikers; a democracy can't, and both face the consequences).

Crises are the designed stress-tests where economy, politics, and regime collide — the game's exam questions.

### 8.2 Climate & environment (the century-long system)

- **Global ledger:** atmospheric CO₂ starts at ~295 ppm (1900); every nation's energy mix and industry emits into it; warming follows cumulative emissions with **~20-year lag** (the cruelty of the system — by the time it hurts, the cause is two governments old). NPC nations emit too; one green player can't solo-fix it — hence late-era **climate accords**, the hardest multiplayer-with-AI negotiation in the game (verification, free-riding, sanctions for defection).
- **Local ledger:** your pollution maps (health, land value) — fixable in years, giving short-loop feedback that *teaches* the long loop.
- **Impacts (scaling with +°C):** crop-yield volatility → failures; extreme-weather frequency (storms, floods, droughts, fires) hitting infrastructure; sea-level rise threatening coastal districts from ~2040 (the map shows the projected 2100 waterline as a thin blue ghost-line decades early — quiet dread as UI).
- **Responses, all with long lags and real costs:** mitigation (energy transition, carbon tax — a tax with full faction politics attached), adaptation (sea walls: 10-year builds, province-scale costs; flood-proofing; crop research), retreat (managed relocation of districts — politically brutal), geoengineering (2050+, cheap, fast, side-effect roulette, unilateral — a diplomacy bomb).
- The endgame's solarpunk/dystopia/drowned branching (§3.2) is the climate system's verdict made visible.

### 8.3 Information, media & legitimacy

- **Media reach** evolves: word of mouth → press (1900) → radio (1925) → TV (1950) → internet (1995) → algorithmic feeds (2015+). Reach multiplies how fast opinion moves — early-century opinion is a glacier, late-century a flash flood.
- **Press freedom (a law axis):** free press → approval reflects *true* conditions, corruption is exposed (forced scandal events), legitimacy is sturdy because it's earned. Controlled press → you set a **propaganda narrative** that buffers approval against bad news, but a **credibility gap** accumulates between narrative and lived reality; gap > threshold + spark = legitimacy *collapse* rather than decline (the Ceaușescu cliff). Free media is a shock absorber; propaganda is a dam.
- **Misinformation era (2015+):** algorithmic media polarizes — opinion distributions widen (the spread parameter rises), consensus policies cost more capital, populist swings amplify. Counters (platform regulation, public media, media literacy education) each have liberty/cost/effectiveness tradeoffs and angry constituencies.

### 8.4 Threats & failure states that scale

| Tier | Lethal threats | Failure state |
|---|---|---|
| Town | starvation, freezing, disease, raids | **Depopulation** (colonists dead/fled) |
| State | bankruptcy, strikes, rival-state coercion | **Bankruptcy** (debt spiral → receivership event chain), **Secession** |
| Nation | depression, revolution, coup, total war, climate | **Revolution/coup** (you may continue as the *new* regime under penalties — losing power ≠ always game over), **Conquest**, **Collapse** (cascade of secessions), **Climate catastrophe** (habitability loss) |

The danger curve hands off smoothly: by the time raids stop mattering (~Tier 2 constabulary), economic crises have taken their slot; by the time you can't go bankrupt easily, war and revolution can take everything. Sandbox legacy scoring (Century Report) plays the role of victory conditions; Grand Strategy adds optional legacy goals (hegemony, ideology spread, climate stewardship) — **endings are graded, not binary**, because a 200-year sim should end like history does: with a verdict, not a win screen.

### 8.5 UI/UX & data visualization principles

(Screens themselves in §11.) Rules:

1. **Three altitudes everywhere:** glance (the backdrop itself + 6-number top bar) → overview (dashboards, heatmap overlays) → drill-down (any number decomposes into its terms).
2. **Every number explains itself:** tooltips show the formula's terms with values ("Approval 38 = 50 base −9 unemployment −7 inflation +6 services −2 war"). No black boxes — in a deep sim, *the explanation is the tutorial*.
3. **Trends over levels:** every dashboard number carries a sparkline; the long-lag systems (debt, demographics, CO₂, education) get a dedicated **Century Graph** screen plotting any variable across the whole run.
4. **Pixel-crisp data:** 8-bit aesthetic is an asset for data viz — hard pixel bars, 1-px line charts, dithered heatmaps, no anti-aliased mush. One UI skin per era (brass gauges → CRT green → flat glass) keeps even menus storytelling.
5. **Attribution on events:** every crisis banner links to the chart of the variable that caused it, at the moment it crossed its threshold.

### 8.6 Pacing & time scale

**Decision: real-time with pause, tier-scaled calendar compression** (Town 45s/day → Nation 1.5s/day at speed 1; ×1/×3/×8 speeds; auto-pause on events by configurable severity).

*Justification:* the colony layer's intimacy needs RimWorld's watch-the-day texture, which turn-based kills; the nation layer needs to cross decades, which day-scale real-time kills. Compression-by-tier means the player's *decision rate stays roughly constant* (~one meaningful intervention per minute) while the calendar accelerates — matching the fiction (a founder sweats days; a head of state thinks in quarters). Turn-based was rejected because the economy's continuous feedback (prices, attrition, opinion drift) reads better moving than stepped; pure fixed-rate real-time was rejected because no single rate serves both ends of a 200-year arc. Long-lag weight is delivered by the Century Graphs (§8.5) and by *scheduled future pain made visible now* (pension projections, debt service curves, the 2100 waterline).

### 8.7 Advisors / cabinet

Six portfolios — **Treasury, Interior, Foreign, War, Science, Information** — each held by a **Notable** with skill (quality of forecasts and execution), loyalty (coup/defection math), ideology (they push their politics in their briefs), and ambition. Advisors surface issues ("Treasury: debt service passes 20% of revenue within 3 years on current path"), offer 2–3 framed options on events, and *can be wrong* in personality-consistent ways (skill sets forecast noise; ideology sets bias — the hawkish War minister undercounts occupation costs *every time*). Appointing, sacking, and being betrayed by ministers is the governance theme at human scale; under dynastic/junta regimes, the cabinet IS the succession/coup battleground.

### 8.8 Difficulty, onboarding & modding

- **Onboarding is the spine itself:** Tier 1 is a natural ~2-hour tutorial — a dozen settlers, no economy screens, no diplomacy; systems switch on one promotion at a time, each introduced by an advisor walkthrough of its one new screen. A deep sim that starts shallow and *earns* its depth is the accessibility strategy; there is no separate tutorial campaign in MVP.
- **Difficulty:** presets (Story/Standard/Brutal/Historical) over knobs: crisis frequency/severity, AI aggression and guardrails (§6.4), economic volatility, starting region harshness. Sandbox exposes every knob.
- **Replayability:** starting regions (river valley / coastal / mountain / arid) reshape the whole economic century; era starts (1900/1950/2000); regime-locked challenge starts.
- **Modding:** goods, buildings, techs, civics, events, government types, AI personalities, and palettes all defined in data files (JSON/TOML), not code; event chains in a simple scripting layer; Steam-Workshop-style sharing post-launch. The cohort model's stats-not-agents design is mod-friendly by nature — modders add columns, not pathfinding.

*(Audio: covered in §3.3.)*

---

## 9. Government-Type Comparison Table

Shared chassis (§5.3): Approval, Legitimacy, Liberty↔Control, Corruption, Political Capital, Factions. Each regime is a configuration of that chassis plus unique mechanics. Numbers are starting design values, not final balance.

| Regime | Power gained / held / lost | Legitimacy source | Economic profile | Signature bonuses / penalties | Transition paths out | Failure mode | At war |
|---|---|---|---|---|---|---|---|
| **Liberal democracy** | Elections (4–5 yr) / coalition + approval / lost elections | Electoral mandate (resets each win) | Market-leaning, strong property rights | +Innovation, +FDI, +treaty trust; gridlock: laws cost +30% capital with hostile legislature | → social democracy, → illiberal (erosion chain), → wartime emergency powers | Gridlock paralysis in crisis; populist capture | Slow mobilization; needs support >45; strong allies & war bonds; defensive wars boost legitimacy |
| **Social democracy** | Elections / labor-coalition approval / elections, fiscal crisis | Mandate + welfare performance | High tax & redistribution, strong services | +Cohesion (unrest −30%), +health/education efficiency; −capital flight risk at top rates, chronic deficit pressure | → liberal democracy, → command socialism (radicalization) | Debt spiral; tax-base flight | As liberal democracy; rationing tolerated better (solidarity) |
| **Illiberal democracy** | Elections (tilted) / media control + patronage / rare upset, mass protest | Manufactured majority | Crony-market: connected firms favored | +Capital for leader's faction; corruption +2/yr; courts unreliable → −FDI | → authoritarianism (consolidate) or → liberal democracy (one lost election it can't steal) | Stolen-election protest cascade | Medium mobilization; uses war for rally-around-flag (support +15 at declaration, decays double) |
| **Constitutional monarchy** | Heredity + elected gov't / dynasty prestige / dynasty discredit or republic referendum | Tradition + performance blend | As host democracy | +Stability (legitimacy floor 30), +diplomacy with monarchies; succession events are national moments | → liberal democracy (quietly), → absolute (royal coup, rare) | Succession crisis with weak heir | Cabinet wars cheap; royal family at front = support bonus & risk |
| **Absolute monarchy** | Heredity / court factions + army / death, coup, revolution | Dynastic + divine tradition (decays each era past 1918) | Extractive-agrarian bias; slow modernization | Fast decisions (laws −50% capital); −research; nobility faction must be fed land/privilege | → constitutional (granted charter), → revolution (the default exit) | Succession war; modernization trap (reform angers nobles, stasis angers everyone else) | Total command of army; war support irrelevant until casualties hit nobility/peasant thresholds → revolt |
| **Oligarchy / plutocracy** | Wealth / lobby consensus / inter-elite war, populist revolt | Performance for elites only | Ultra-low tax, minimal services, high inequality | +GDP growth +1%/yr early; Gini +; unrest accumulates structurally; policy menu vetoed by lobbies | → corporatocracy (formalization), → populist autocracy or democracy (revolt outcomes) | Populist revolution | Mercenary-heavy; short wars for assets; long wars break elite consensus |
| **One-party state / command socialism** | Party ranks / control apparatus / palace coup, system collapse | Ideology + delivered equality | Central planning: you set output targets directly (planning minigame); shortages from plan error | +Heavy-industry mobilization, +equality; −consumer innovation, corruption +, information distortion (your own stats lie to you at high control — the game shows you the *reported* numbers) | → market reform chain (perestroika event risk: collapse), → nationalism pivot | Legitimacy collapse when ideology's promises visibly fail (credibility gap, §8.3) | Fastest Total mobilization; support floor ~25; defeat = regime-ending |
| **Military junta** | Coup / barracks loyalty / counter-coup, transition pact | Order & national security | Security-first budgets, stagnant private sector | +Unrest suppression, instant martial law; −investment, −research, officer corruption; every crisis raises counter-coup odds | → managed democratization (the good exit), → personalist dictatorship | Counter-coup roulette | Strong early war; logistics corruption bites long wars; *needs* external threat to justify itself (peace is dangerous to a junta) |
| **Technocracy** | Expert councils / measured results / measurable failure, populist backlash | Performance metrics, publicly tracked | Optimization-heavy, evidence-driven | +Research +25%, +infrastructure efficiency, +climate competence; legitimacy is *brittle* — one big visible failure (pandemic mishandled, grid collapse) cuts it 30+; low pageantry = weak emotional loyalty | → liberal democracy, → corporatocracy | "Competence crash" after a black-swan failure | Plans superb wars on paper; war support modeled poorly by its own experts (morale is not a spreadsheet) |
| **Theocracy** | Clerical hierarchy / doctrine + piety / schism, secular revolution | Divine sanction | Tithe economy, charity-based welfare | +Cohesion & morale, legitimacy immune to material dips; −science (doctrine-gated tech: some nodes locked), education filtered | → constitutional theocracy, → secular revolution | Schism (faction split on doctrine) | Holy-war CB (cheap, support 90 start); peace with "infidels" costs legitimacy — hard to *stop* wars |
| **Corporatocracy** (2040+ natural, earlier possible) | Board acquisition / shareholder value / hostile takeover, consumer revolt | Prosperity & service delivery (citizens-as-customers) | Everything privatized; services are subscription tiers by class | +Efficiency +20%, +tech, +trade; inequality extreme, non-customers (poor cohorts) are unrest reservoirs; "elections" are shareholder meetings | → technocracy, → neo-feudal fragmentation (collapse) | Mass consumer revolt / rival corp state buyout | Short profitable wars excellent (PMCs); long wars = stock crash = takeover risk |
| **Direct democracy / syndicalist commune** | Referenda & councils / participation / apathy, emergency centralization | Process itself (every decision pre-legitimized) | Cooperative firms, flat wages | +Legitimacy ceiling 100, unrest −50%; every law takes a **referendum delay** (months) — crisis response structurally slow; demagogue events | → social democracy (delegation creep), → junta (emergency powers never returned) | Paralysis in fast crises | Mobilization needs referendum (slow but, once voted, support is iron); poor at offensive wars by design |
| **Fascist / ultranationalist** *(period mechanic, 1925–1955 window)* | Paramilitary seizure / cult + terror + spoils / total war defeat, leader death | Leader cult + perpetual grievance narrative | Autarky drive, armament Keynesianism (booms while arming) | +Mobilization speed (best in game), +short-term growth; *requires* escalating external conflict (legitimacy −5/yr at peace), purges burn Notables, reputation floor | → military junta (cult decapitated), → defeat & occupation | The war it must start, it eventually loses — or becomes a pariah autarky | The whole regime is a war engine; war support starts 90, collapses catastrophically past casualty thresholds |

**Transitions are event chains, not toggles** (§5.3): each arrow above is a 3–8 step chain with faction resistance, capital costs, possible violence, and international reaction. The chains are authored per-pair where historically resonant (absolute monarchy → revolution has bespoke content) and generic otherwise.

---

## 10. Era / Technology Timeline & the Energy Transition

The brief's 8-era spine is adopted unchanged — it's correct. Per era: entry condition, signature techs (T) and civics (C), energy stage, and the era's *designed question*.

| Era | Entry | Signature unlocks | Energy | The era's question |
|---|---|---|---|---|
| **1900–18 Industrial** | start | T: electrification, steel mills, rail networks, telegraph. C: town charter, public schooling, **Regional Charter** | **Coal** (only option; smog is the price of growth) | Survive, then outgrow the frontier |
| **1918–39 Interwar** | date + electrification | T: automobiles, assembly line, radio, early aviation. C: mass suffrage, labor unions, central banking, **Statecraft** | Coal + early **oil** | Who gets the gains? (class politics arrives; the crash tests your bank system) |
| **1939–45 War economy** | tension-triggered window | T: radar, synthetics, rocketry, (atomic program — late, expensive, world-changing). C: total mobilization, rationing systems | Oil ascendant (fuel = strategy) | Can your system fight? |
| **1945–70 Atomic boom** | postwar | T: nuclear power, highways, television, jet aviation, early computing. C: welfare state, suburban planning, international institutions | Oil/gas dominant + **nuclear** option (cheap, clean, dread events: meltdown risk small but era-defining if it fires) | Spend the boom: consumption, welfare, or empire? |
| **1970–91 Shocks** | date + computing | T: microprocessors, telecom, industrial robotics. C: environmental regulation (demanded by your own smog), deregulation, monetarism | **Oil shock anchors**: price ×3 events; first renewables (expensive) | Stagflation: the first crisis your old tools make *worse* |
| **1991–2010 Information** | date + microprocessors | T: internet, logistics revolution, biotech. C: globalization (trade costs −40%), financial liberalization (growth + fragility) | Gas + nuclear plateau; renewables cost curve bending | Open up and ride the boom — and own the 2008-analog bust it breeds |
| **2010–40 Climate & Automation** | date + internet | T: solar/wind at parity, batteries, AI/automation waves, EVs. C: platform regulation, carbon pricing, universal benefits (automation answer) | **Renewables transition** — stranded coal/oil assets, grid storage problem, petro-state rivals destabilize | Transition fast enough without breaking your workers and your budget |
| **2040–2100 Speculative** | world-state-gated | T (branching): fusion, geoengineering, arcologies, general automation, life extension. C: post-work social contract, climate accords with teeth, (dark branch) corporate charters, surveillance states | **Fusion** if research + stability held; else renewables-plus-scarcity; else collapse energy poverty | The verdict: solarpunk, corporate neon, or the sea |

**Energy-transition thread, mechanically:** each stage has capital cost, fuel cost, emissions/GWh, and *lock-in* (grid + workforce + lobby built around the incumbent — the coal lobby is a faction that fights its own obsolescence). Energy price feeds every supply chain (§5.2), emissions feed the climate ledger (§8.2), import dependency feeds diplomacy (§5.4). The transition is never free and never optional — only early or late, and late is more expensive. This single thread touches all six core systems, which is why it's load-bearing.

---

## 11. Key UI Screens

The UI itself climbs the ladder: Tier 1 ships 4 screens, Tier 2 adds 4, Tier 3 adds 4 — the interface *grows at promotions*, which is both onboarding (§8.8) and spectacle. Era skins restyle chrome (brass → bakelite → CRT → glass).

**Top bar (always present, contents evolve by tier):**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ⏸ ▶▶▶  12 Mar 1934 │ ☼ Spring │ POP 8,420 │ £ 12,300 (+340/q) │ APPROVAL 47▾ │
│ ⚠ Dockworkers strike — day 6        ⚠ Treasury: debt service 18% and rising  │
└──────────────────────────────────────────────────────────────────────────────┘
```

**City view (Tier 1/2) — play field over parallax backdrop, overlay palette on the left:**

```
┌─[OVERLAYS]──┬────────────────────────────────────────────────┬─[INSPECTOR]──┐
│ ▣ none      │        ~ clouds ~      ▓▓ distant skyline ▓▓   │ SAWMILL #2   │
│ □ land val  │   ▒▒ haze ▒▒   smokestacks ║║║  birds ^v^      │ workers 4/6  │
│ □ pollution │ ┌──┐┌──┐ ▲▲▲  ┌────┐      ╔══╗   ┌─┐┌─┐       │ wood→lumber  │
│ □ traffic   │ │RR││RR│ ▲▲▲  │MILL│══════╣ST╠═══│C││C│       │ eff 71% ▾    │
│ □ services  │ └──┘└──┘ trees└────┘ rail ╚══╝   └─┘└─┘       │ ► no power!  │
│ □ crime     │ ═══════════════╪══ road ═══╪═════════════      │ [fix] [info] │
└─────────────┴────────────────────────────────────────────────┴──────────────┘
```

**Economy dashboard (Tier 2+) — every figure has a sparkline and decomposes on click:**

```
┌─ ECONOMY ── Q3 1934 ─────────────────────────────────────────────────────────┐
│ GDP £842k ▁▂▃▅▆█ +3.1%   INFLATION 2.4% ▃▃▂▃▄   UNEMPLOYMENT 11% ▆▅▅▆█ ⚠     │
│ SECTORS: agri ████░ 31%  industry ███████ 44%  services ███ 22%  info ░ 3%  │
│ BUDGET: tax +9.2k │ spend −8.1k │ debt 38% GDP │ rating AA− ▾ │ bonds 4.1%  │
│ TRADE: exports lumber/steel +2.2k │ imports fuel −1.8k │ FUEL DEPENDENCY 74%⚠│
│ [labor] [prices] [supply chains] [public finance] [century graphs]           │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Government screen (Tier 3) — chassis on the left, factions on the right:**

```
┌─ GOVERNMENT: Liberal Democracy ── est. 1935 ─────────────────────────────────┐
│ APPROVAL 47 ▾   LEGITIMACY 61 ▴   LIBERTY ████████░░ 78   CORRUPTION 23 ▴⚠   │
│ approval = 50 −6 unemp −4 rents +5 services +2 liberty-fit  [why? ▸ charts]  │
│ NEXT ELECTION: Nov 1936 — forecast: GOVT 44% / AGRARIAN 31% / LABOUR 25%     │
│ FACTIONS: industrialists ●●●●○ content │ labor ●●○○○ ANGRY (wage law veto)   │
│ POLICY SLOTS [econ:Free Trade][econ:––][social:Pensions][security:––]        │
│ STATUTES: 34 laws │ pending: Unemployment Insurance (cost 12 PC, angers IND) │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Diplomacy map (Tier 3) — continent with relation-tinted borders; negotiation as a two-pan scale:**

```
┌─ NEGOTIATION: Kingdom of Veles (relation −12, Honor 7, agenda: coastal unity)┐
│ YOU OFFER                 │ THEY ASK                  │ THE SCALE             │
│ ▸ tariff cut: steel       │ ▸ border twn. Ostrava     │   offer ▓▓▓▓▓░░ 68    │
│ ▸ tech: rail signaling    │ ▸ non-aggression 10yr     │   ask   ▓▓▓▓▓▓░ 81    │
│ [+ add item]              │ [+ request item]          │  "We are not close."  │
│            [propose]  [counter history ▸]  [walk away]                       │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Tech/era tree** — horizontal century timeline, twin lanes (tech above, civics below), the energy stages drawn as a colored spine through the middle; your position and each rival's discovered position marked on the same timeline.

---

## 12. Map of Major Feedback Loops

Reinforcing (R) loops drive booms and collapses; balancing (B) loops are the player's stabilizers. The art of the game is noticing which loop you're inside.

1. **R — Growth engine:** production → wages → demand → investment → production. *(Damped by: land/labor limits, congestion, wage inflation.)*
2. **R — Credit cycle:** low rates → credit → asset prices → confidence → more credit → **fragility** → shock → deleveraging → bust. *(Player brake: central bank; political cost of braking a party is the trap.)*
3. **B — Tax thermostat:** spending needs → taxes → flight/evasion above tolerance → revenue falls → rating falls → austerity or spiral.
4. **R — Inequality spiral:** growth concentrates → Gini ↑ → unrest + populist drift → instability → investment ↓ → lower-class pain ↑ → unrest ↑. *(Brake: redistribution — which strains loop 3 and angers elite factions.)*
5. **B/R — Legitimacy loop:** performance → approval → legitimacy → political capital → capacity to fix performance. Runs as a virtuous (B) circle until a shock flips it into a doom (R) spiral — the flip point is the revolution mechanic.
6. **R — Propaganda dam:** control press → buffer approval → credibility gap grows → bigger eventual break. *(The longer it works, the worse it ends.)*
7. **R — Education flywheel (slowest good loop):** schools → skilled cohorts (15–25 yr lag) → productivity + innovation → revenue → schools.
8. **R — Carbon debt (slowest bad loop):** cheap energy → growth → emissions → (20-yr lag) warming → disasters + yield loss → costs → pressure to use *cheap energy* to pay for repairs. *(The trap of the late century; exit is the energy transition, loop 7's revenue makes it affordable.)*
9. **R — War spiral:** tension → arms spending → rival insecurity → tension; war → grudges → revanchism → war. *(Brakes: diplomacy, exhaustion, and the §7.4 overreach lesson.)*
10. **B — Migration valve:** bad conditions → emigration → labor loss → worse conditions (can flip R: brain drain) / good conditions → immigration → growth + housing pressure + nativist faction reaction (feeds loop 4).

The signature designed cascade (from the brief, fully supported by the loops above): tax hike (3) → middle-class flight (10) → land value & revenue fall (1↓) → service cuts → approval fall (5 flips) → unrest (4) → coup (5's floor). Every link is a number on a chart the player could have watched.

---

## 13. MVP vs. Full Scope, and the Top Balance Risks

### 13.1 MVP (a complete, shippable game — "the spine plus one deep system per tier")

- **The full three-tier ladder** — non-negotiable; it *is* the game. Both promotions, the simulation flip, Notables, all three zoom levels.
- **Tier 1 complete:** ~30 settler jobs/buildings, needs/moods/health, raids/disease/weather.
- **Economy:** 18 goods, markets, labor, public finance, credit-cycle macro; **no FX**, single currency world.
- **Politics:** the universal chassis + **6 regimes** (liberal democracy, social democracy, absolute monarchy, junta, one-party state, technocracy), elections/coups/revolutions, factions, statute book (policy *slots* deferred).
- **Diplomacy & war:** relations, 6 treaty types, the negotiation engine, fronts/mobilization/peace-terms warfare. **3–5 AI rivals**, 4 personality archetypes.
- **Eras 1–6 (1900–2010)** with art/audio sets; climate ledger running but with impacts simplified to weather/yield events; **misinformation era and speculative branch deferred** — MVP ends at 2010 with the Century Report.
- **UI:** the 12 screens, tooltips-with-formulas, overlays, century graphs.
- **Modes:** Sandbox + Grand Strategy. No scenarios.

### 13.2 Full scope adds

Eras 7–8 with the 2040+ branching endgame; climate adaptation/geoengineering/accords; FX & monetary regimes; all 13 regimes + bespoke transition chains; policy slots; 44-good economy with chemicals/electronics chains; espionage; misinformation systems; historical-scenario layer; dynasty depth for Notables; 7 rivals; modding tools & workshop; map/start variety; full audio arc.

### 13.3 Top balance risks (watch these from the first playable)

1. **The flip kills attachment.** If players grieve the cohort transition, the spine fails. Mitigations: Notables carved from *their* favorites (not random), representative-agent drill-down, and the founders' story continuing. *Test: do players name-drop Notables in playtest diaries after 1950?*
2. **Tier 3 abandons Tier 1 players (and vice versa).** Some players want RimWorld forever, some want Civ now. Mitigations: sandbox era-starts at both ends; "lingering" at a tier must stay viable (soft ceilings pressure, never force).
3. **Emergent business cycles either don't emerge or never stop.** Credit-cycle parameters are the single most sensitive dial in the design; budget a dedicated tuning harness (headless 200-year sims, thousands of runs, distribution targets: 2–4 major busts per century, depression-scale ≤1).
4. **Snowballing** — the inequality, education, and growth loops all reward the leader. Counters built in (tech diffusion discount, overreach penalties, aging costs of early booms, climate bill scaling with cumulative output) need constant verification against AI-vs-AI runs.
5. **Regime balance vs. regime flavor.** The table's bonuses must make autocracies *tempting* in crises and *costly* across decades — if democracy is strictly better (or worse), the political heart of the game flatlines. Target: within ±15% century-end legacy score across regimes in competent hands, with wildly different variance.
6. **Information overload at Tier 3.** If players stop reading dashboards, the sim's depth is wasted. The advisor layer is the safety net — advisors must reliably surface the one number that matters this quarter.
7. **War too cheap or too dull.** Abstracted war risks feeling like a spreadsheet exchange. The home-front systems (rationing moods, war support, Notables at the front) carry the emotional weight — they ship in MVP for this reason, not as polish.

### 13.4 Where this design departs from the brief (called out honestly)

1. **Representative agents at Tier 2+** (§2.4): the brief says individual simulation exists *only* in the single-town phase. Kept true for the authoritative model; added cosmetic agents rendered from cohort stats because a silent aggregate city reads as dead, and the Skylines "follow a citizen" pleasure is too valuable to lose. Cost is rendering-only.
2. **Endings are graded, not won** (§8.4): the brief leaves victory conditions optional; this design commits to legacy scoring over win states, because binary victory fights the 200-year simulation ethos (and Grand Strategy still offers authored legacy goals for players who want a finish line).
3. **MVP ends at 2010, not 2100** (§13.1): the brief treats the full span as core. The last two eras are the most speculative, most branch-heavy content with the least reusable systems; shipping a superb 1900–2010 and patching the future in is the honest scope call. The climate ledger still runs from day one of MVP so the bill is *visible* — only its endgame payoff is deferred.
4. **Fascism/communism as period mechanics, with guardrails:** handled as the brief asks, but deliberately framed through mechanics (grievance engines, purges, credibility gaps) and consequences rather than aesthetics — the design treats them as cautionary systems, and the era content is written to historical outcome, not fantasy.

---

*End of GDD v0.1. The recommended build order falls out of the document order: the spine first (§2), then Tier 1 (§5.1 + the settler model), then the flip and the economy (§5.2), then politics (§5.3/§9), then the world (§6/§7). Each milestone is a playable game.*
