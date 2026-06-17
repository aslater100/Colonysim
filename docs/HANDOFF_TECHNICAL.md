# HANDOFF_TECHNICAL: Centuria Data Model & System Interactions

**For**: Developers implementing features  
**Reference**: HANDOFF.md for overview  
**Version**: Phase 1 spec  

---

## Data Model: Core Classes

### RegionSim (main game state)

```typescript
interface RegionSim {
  // Identity
  year: number (1800–2100)
  difficulty: 'easy' | 'normal' | 'hard'
  cityState: {
    name: string
    flagColors: [r, g, b] × 3  // flag design
    primaryColor: [r, g, b]      // territory color
  }

  // Governance
  ideology: [left_right, auth_lib, progress_tradition, militarism_pacifism, secular_theocracy]
    // Range: -100 (full left) to +100 (full right), similar for others
    // Computed on tick from law effects, faction responses, events
  governmentType: string (computed from ideology)
    // Matches dominant ideology combo (see HANDOFF.md Phase 1)
    // Locked after year 5, but can shift via laws or revolution
  politicalCapital: number (starts 50, regenerates 2/quarter, 0–100 cap)

  // Economy
  treasury: number (currency units, can go negative)
  totalDebt: number (accumulated bonds issued)
  inflation: number (0–200%, computes from spending/production + interest rate)
  interestRate: number (2–15%, player-controlled)
  currencyStrength: number (computed: (treasury/debt) × (world_inflation/inflation))
  reserveCurrencyStatus: boolean (true if most stable + largest economy)

  // Factions & Politics
  factions: Map<'workers' | 'merchants' | 'landowners' | 'military', Faction>
  laws: Law[] (array of enacted laws with ideology effects)
  
  // Settlements
  settlements: Settlement[]
  
  // Rivals (AI)
  rivals: Rival[]
  
  // Tech tree
  techTree: TechTree
  researchPoints: number
  researchPointsPerYear: number (base 0.2, scales with era + tech)
  
  // Serialization version
  serializationVersion: 3 (v2 = old region format, v3 = includes ideology + economy)
}
```

### Faction

```typescript
interface Faction {
  id: 'workers' | 'merchants' | 'landowners' | 'military'
  opinion: number (-100 to +100)
  grievance: number (0–100)
  power: number (0–100, affects law passage odds)
  demand: {
    text: string (e.g., "Raise wages!")
    severity: 1 | 2 | 3 (affects grievance increment)
    issuedAtYear: number
    active: boolean
  } | null
  ideologyPreference: {
    leftRight: -50 to +50 (workers: -30, merchants: +30, etc.)
    authLib: -50 to +50
    // etc. for all 5 axes
  }
}
```

**Faction grievance rules**:
- Ignore demand: `grievance += 10 * severity`
- Comply demand: `grievance -= 20`
- Negotiate: `grievance -= 10, politicalCapital -= 3–5`
- Decays: `grievance -= 1 per quarter` (automates slowly)
- At 75%: Faction **hostile** (blocks laws, -20% production in opposing sectors)
- At 100%: **Revolution triggered** (see below)

### Settlement

```typescript
interface Settlement {
  id: string
  name: string
  position: [x, y]
  population: number
  happiness: number (0–100)
  
  sectors: {
    agriculture: number (base 100 × fertility × tech_mult)
    industry: number (base 50 × infra_mult × tech_mult)
    services: number (base 30 × pop_ratio × education_mult)
    information: number (base 0, unlocks late-game)
  }
  
  realOutput: { agriculture, industry, services, information }
    // Computed: nominal / (1 + inflation) × currency_strength
  
  infrastructure: {
    roads: boolean
    ports: boolean (coastal only)
    powerPlants: { coal, oil, nuclear, solar, wind }
    waterSystems: { irrigation, sewage }
    railroads: boolean
  }
  
  power: {
    consumed: number (10 + 0.1 × population)
    supplied: number (sum of plants)
    brownout: boolean (supplied < consumed → production −30%)
  }
  water: {
    consumed: number (5 + 0.05 × population)
    supplied: number (from systems)
    diseaseRisk: number (100 if no sewage, 0 with sewage)
  }
  
  maintenance: number (0.1 per infra node per quarter)
  
  construction: {
    projectName: string | null
    progressDays: number
    totalDays: number
  } | null
}
```

### Ideology & Government

```typescript
interface Ideology {
  leftRight: number    // -100 (left) to +100 (right)
  authLib: number      // -100 (auth) to +100 (lib)
  progress: number     // -100 (tradition) to +100 (progress)
  militarism: number   // -100 (pacifism) to +100 (militarism)
  secular: number      // -100 (secular) to +100 (theocracy)
}

function governmentType(ideology: Ideology): string {
  const auth = ideology.authLib < -20
  const right = ideology.leftRight > 20
  const mil = ideology.militarism > 50
  const theoc = ideology.secular > 50

  if (theoc) return 'Theocracy'
  if (mil) return 'Military Junta'
  if (auth && right) return 'Autocracy'
  if (auth && !right) return 'Communist Dictatorship'
  if (!auth && right) return 'Oligarchy'
  if (!auth && !right) return 'Democracy'
  return 'Constitutional Monarchy' // balanced
}
```

### TechTree

```typescript
interface TechTree {
  branches: {
    [branchName: string]: TechBranch
  }
}

interface TechBranch {
  name: string
  tiers: TechTier[]
}

interface TechTier {
  nodes: TechNode[]
  minTierReq: number (can't unlock Tier 3 until Tier 1 unlocked)
}

interface TechNode {
  id: string
  name: string
  cost: number (1–5 points)
  unlocks: {
    buildingTypes?: string[]
    unitTypes?: string[]
    laws?: string[]
    economyFeatures?: string[] (e.g., 'centralBank', 'cryptocurrency')
  }
  effects: {
    productionMultiplier?: number (e.g., 1.2 = +20%)
    researchSpeedBonus?: number
    militaryUnitCost?: number (multiplier)
  }
  researched: boolean
  researchedAtYear: number | null
}

// Specialization bonus: if branch has 4+ nodes, remaining nodes cost -1
function effectiveCost(node: TechNode, branchNodesUnlocked: number): number {
  return Math.max(1, node.cost - (branchNodesUnlocked >= 4 ? 1 : 0))
}
```

### Economy & Inflation

```typescript
function computeInflation(spending: number, production: number, interestRate: number): number {
  const baseInflation = (spending / Math.max(1, production)) * 100
  const interestEffect = (interestRate - 2) / 20
  return baseInflation * (1 - Math.min(0.9, interestEffect))
    // Cap interest effect at 90% (can't reduce inflation below 10% of base)
}

function computeCurrencyStrength(
  ownTreasury: number,
  ownDebt: number,
  ownInflation: number,
  worldAverageInflation: number
): number {
  const fundamentals = ownTreasury / Math.max(1, ownDebt)
  const inflationRatio = worldAverageInflation / Math.max(1, ownInflation)
  return fundamentals * inflationRatio
}

function computeRealOutput(nominal: number, inflation: number, currencyStrength: number): number {
  return (nominal / (1 + inflation / 100)) * currencyStrength
}

// Example: nominal agriculture 100, inflation 8%, currency 0.95
// Real: (100 / 1.08) * 0.95 = 88.4
```

### Revolution

```typescript
interface RevolutionEvent {
  triggeredBy: Faction
  outcome: {
    newGovernmentType: string
    ideologyShift: Partial<Ideology> (faction's preferences override)
    treasuryDamage: number (-30% of current treasury)
    buildingsDamaged: number (~10% of total)
    unrestDuration: number (3 months)
    productionPenalty: number (-10% for 3 months)
  }
  techResetDetails: {
    pointsReturned: number (40% of spent points)
    researchDisruption: number (10 years of -50% research speed)
    ideologyLock: {
      duration: 5, // years
      forcedBranch: string (faction's tech preference)
    }
  }
}

// Trigger: faction.grievance >= 100 or (2+ factions at 75%+)
// Outcome: ideology flips toward revolutionary faction's preference
```

---

## System Interaction Matrix

**How systems affect each other** (A → B = "A affects B"):

```
INFLATION → Military upkeep costs (higher inflation = higher upkeep)
INFLATION → Currency strength (higher inflation = weaker currency)
INFLATION → Population happiness (high inflation > 10% = −5% happiness)
INFLATION → Treasury (real value eroded if spending > income)

CURRENCY STRENGTH → Trade income (weak currency = higher trade revenue if not embargoed)
CURRENCY STRENGTH → Import costs (weak currency = expensive imports)
CURRENCY STRENGTH → Diplomacy opinion (weak currency signals weakness, −5 opinion)

TREASURY → Currency strength (low/negative treasury = weak currency)
TREASURY → Infrastructure maintenance (can't pay = degradation = -20% efficiency)
TREASURY → Unit upkeep (can't pay = unit attrition)
TREASURY → Faction negotiation (can't afford compliance = grievance rises)

WAR → Production (−50% in war zones for duration + 10 years occupation)
WAR → Treasury (unit losses + 20% repair costs)
WAR → Inflation (supply shocks from disruption)
WAR → Happiness (−20% in occupied territories)

FACTION DEMANDS IGNORED → Grievance (per demand ignored)
FACTION GRIEVANCE (75%+) → Law passage (faction blocks all non-preferred laws)
FACTION GRIEVANCE (75%+) → Production (−20% in faction-aligned sectors if hostile)
FACTION GRIEVANCE (100%) → Revolution (government flips, tech reset)

IDEOLOGY SHIFT → Government type (emergent, locks after year 5)
GOVERNMENT TYPE → Law availability (e.g., Theocracy can't pass "Secularism" law)
GOVERNMENT TYPE → Faction opinion (Democracy favors workers/merchants, Auth favors military)
GOVERNMENT TYPE → Political capital regen (Democracy regen slower, Auth faster)

TECH RESEARCH → Production (unlocks multipliers: e.g., Engineering +30% industry)
TECH RESEARCH → Upkeep costs (Military tech reduces unit costs by 10–20% per tier)
TECH RESEARCH → Infrastructure efficiency (Infrastructure tech reduces maintenance −20%)
TECH RESEARCH → Happiness (Society tech increases happiness +5% per unlock)

HAPPINESS (<40%) → Population growth (−5% growth per quarter)
HAPPINESS (<40%) → Production (−20% across all sectors)
HAPPINESS (<40%) → Immigration (−50% immigration if <30%)
HAPPINESS (>80%) → Immigration (+50% immigration)
HAPPINESS (>80%) → Culture spread (spreads to neighbors if adjacent)

POWER SHORTAGE → Production (−30% if supply < demand)
WATER SHORTAGE → Agriculture (−20% agriculture, −10% happiness)
WATER + NO SEWAGE → Disease (2% population loss per quarter)

SANCTIONS/EMBARGO → Trade income (−30% for embargoed nation)
SANCTIONS → War trigger probability (+50% if embargoed for 20+ years)

POPULATION GROWTH → Sector demand (higher pop = more consumption)
POPULATION GROWTH → Housing/food demand (growth > 2%/quarter = unrest if supply fails)
```

---

## Edge Cases & Constraints

### Negative Treasury

```
If treasury < 0:
  - Year 1–10: Can borrow at interest (debt accumulates)
  - At debt > 2× annual income: Credit crises trigger
    → Interest rate spikes to 20%
    → Can't borrow more
    → Must austerity (cut spending)
  - If treasury < -50% annual income: Default risk
    → Rival can demand tribute
    → Currency crashes (strength → 0.5)
    → Need revolution or player concession to recover
```

### War Escalation & Attrition

```
War length > 10 years:
  - Both sides suffer 30% unit loss per year
  - Homeland production drops 20% (war economy)
  - If attacker's strength < 0.5 initial, automatic withdrawal (too weak)
  - If defender's strength = 0, territory lost

Occupation:
  - Conquered settlement produces at 50% for 10 years (resistance)
  - Happiness −30% in occupied territory
  - Can be improved via Administration tech (reduces occupation penalty)
```

### Population Collapse Prevention

```
If population < 500:
  - Settlement "critical" status (visually red)
  - Production −50%
  - Can't maintain infrastructure
  
If population → 0:
  - Settlement abandoned
  - Removed from map
  - (But game doesn't end, other settlements continue)
```

### Revolution Sequencing

```
If multiple factions hit 100% grievance simultaneously:
  - Highest-power faction initiates revolution
  - Other factions may join (50%+ chance if 75%+ grievance)
  - Outcome: government flips to plurality faction's preference
  
If revolution triggered during war:
  - War pauses for 6 months (mobilization disrupted)
  - Can resume after, but units damaged (−20%)
```

### Tech Tree Cliff Prevention

```
If player has <5 points remaining and all affordable nodes cost 5+:
  - "Stalled research" warning appears
  - Should have specced earlier (not a hard blocker, but painful)
  
If revolution returns points mid-research:
  - Current research halts (partial progress lost)
  - Player can re-invest or switch branches
```

### Inflation Bounds

```
Minimum inflation: 2% (even with 15% interest rate)
Maximum inflation: 200% (hyperinflation, currency effectively worthless)

If inflation > 150% for 10+ years:
  - Currency collapse risk event (chance to force devaluation)
  - Treasury loss: −25% of current balance
  - Triggers demand from "Economically Sensible" factions
```

---

## Serialization Format (v3)

```typescript
interface SaveGame {
  version: 3
  year: number
  cityState: { name, flagColors, primaryColor }
  ideology: [LR, AL, PT, MP, ST]
  treasury: number
  totalDebt: number
  inflation: number
  interestRate: number
  politicalCapital: number
  
  factions: Array<{
    id: string
    opinion: number
    grievance: number
    power: number
    demand: { text, severity, issuedAtYear } | null
  }>
  
  laws: Array<{ id, enactedAtYear, effects }>
  
  settlements: Array<{
    id, name, position,
    population, happiness,
    sectors: { agriculture, industry, services, information },
    infrastructure: { roads, ports, plants, water, railroads },
    power: { consumed, supplied },
    water: { consumed, supplied, diseaseRisk },
    construction: { projectName, progressDays, totalDays } | null
  }>
  
  rivals: Array<{ id, name, ideology, opinion, treasury, units }>
  
  techTree: {
    [branchId]: Array<{ nodeId, researched, researchedAtYear }>
  }
  researchPoints: number
  
  metadata: {
    difficulty: 'easy' | 'normal' | 'hard'
    playtimeTicks: number
    lastSavedAtYear: number
  }
}
```

**Migration from v2 → v3**:
- Load v2 settlement data
- Initialize ideology = [0, 0, 0, 0, 0] (neutral)
- Initialize economy fields (treasury, inflation, debt)
- Set factions to neutral (opinion 0)
- Populate tech tree as "not researched"

---

## Tick Order & System Dependencies

See `TICK_CYCLE.md` for detailed sequence. **Key rule**: Compute in dependency order:
1. Economy tick (inflation, production, trade)
2. Settlement consumption (subtracts from production)
3. Factions (power shifts based on economy outcome)
4. Demands (issued based on faction state)
5. Military (upkeep costs deducted)
6. War (casualties, territory changes)
7. Population (growth/decay based on happiness, food, water)
8. Revolution check (triggered if faction 100%)

Dependencies prevent circular updates (e.g., can't compute inflation before production is known).

---

## Balance Tuning Parameters

See `BALANCE_KNOBS.md` for visual sliders. Key formulas:

| Parameter | Formula | Tuning | Impact |
|-----------|---------|--------|--------|
| Research points/year | Base 0.2 (scales by era) | Adjust per_era_multiplier | How fast tech progresses |
| Faction demand frequency | grievance / 25 demands/quarter | Adjust grievance divisor | How often factions bug player |
| War attrition | 30% per turn | Adjust war_attrition_rate | War length/costliness |
| Inflation base | spending / production | Adjust production_baseline | Economic baseline tightness |
| Interest rate effect | (rate - 2) / 20 | Adjust interest_scale | How much rate controls inflation |
| Currency strength floor | 0.5 (weak) to 2.0 (strong) | Adjust min/max_strength | Trade competitiveness range |
| Infrastructure maintenance | 0.1 per node/quarter | Adjust maintenance_cost | Infrastructure upkeep burden |

---

## Testing Checklist

- [ ] Negative treasury triggers debt accumulation (not immediate loss)
- [ ] Revolution respects 40% point return + 10-year disruption
- [ ] Inflation formula clips at 2% min, 200% max
- [ ] War attrition: 30% per turn, defender's strength never negative
- [ ] Faction grievance: complying −20%, ignoring +10 per severity
- [ ] Power/water shortage triggers production penalty, not instant failure
- [ ] Tech specialization bonus: 4+ nodes unlock −1 cost
- [ ] Currency strength affects trade income (weak currency = better exports)
- [ ] Ideology shifts accumulate correctly (laws + events + faction responses)
- [ ] Government type locks after year 5; can shift via laws/revolution

---

## Known Issues / Deferred

- (None yet; add as discovered during implementation)

---

**Next**: BALANCE_KNOBS.md for tuning sliders.
