# BALANCE_KNOBS: Visual Tuning Reference

**Purpose**: Single source of truth for game balance parameters  
**Format**: Visual sliders + ranges (not tables)  
**Update**: Every balance change goes here + HANDOFF.md  

---

## Research Points Distribution

**Total points across 300 years: 60**

```
EARLY GAME (1800–1850):     0.2 pts/year    = 10 pts over 50 years
INDUSTRIAL (1850–1920):     0.3 pts/year    = 21 pts over 70 years
MODERN (1920–1980):         0.4 pts/year    = 24 pts over 60 years
INFO AGE (1980–2100):       0.5 pts/year    = 60 pts over 120 years
---
TOTAL ACROSS 300 YEARS:                      ~60 points available

Branch cost to fully specialize: 15–20 pts
Single branch cost per node: 1–5 pts
Specialization bonus: −1 pt if 4+ nodes unlocked in branch
```

**Slider representation:**
```
Early Game Research Speed:  [========] 0.2 pts/yr (tuning: 0.1–0.4)
Industrial Boost:           [==========] 0.3 pts/yr (tuning: 0.2–0.5)
Modern Era Ramp:            [===========] 0.4 pts/yr (tuning: 0.3–0.6)
Info Age Peak:              [============] 0.5 pts/yr (tuning: 0.4–0.8)

Specialization Bonus Threshold: 4 nodes (tuning: 3–5)
Specialization Discount:     −1 point (tuning: −0.5 to −1.5)
```

---

## Inflation Control

**Healthy range: 2–5% annually**

```
Interest Rate Player Control:   2% ──────────────── 15%
                                └─ Min  Range  Max ─┘

Target Inflation (player sets):  2% ────────── 5%

Base Inflation Formula:
  Base = (Spending / Production) × 100
  
Interest Rate Effect:
  Effect = (InterestRate − 2) / 20
  Final = Base × (1 − Effect)  [capped at 2% min, 200% max]

Slider representation:
Interest Rate Control:       2% [====≡====] 15%  (player controlled)
Target Inflation:            2% [≡======] 5%    (player controlled)
Inflation Cap (min):             [≡] 2%          (hardcoded)
Inflation Cap (max):             [≡] 200%        (hardcoded)

Tuning knobs:
  Base spending/production ratio divisor: 100 (tuning: 50–150)
  Interest rate scale: 20 (tuning: 10–30)
  Inflation min floor: 2% (tuning: 1–3%)
  Inflation max ceiling: 200% (tuning: 100–300%)
```

**Example scenario**:
```
Spending $100, Production $80:
  Base = (100/80) × 100 = 125%
  
At Interest Rate 8%:
  Effect = (8 − 2) / 20 = 0.3
  Final = 125 × (1 − 0.3) = 87.5%

At Interest Rate 12%:
  Effect = (12 − 2) / 20 = 0.5
  Final = 125 × (1 − 0.5) = 62.5%
  
(Higher interest rate lowers inflation as intended)
```

---

## Currency Strength Bounds

**Formula: (Treasury / Debt) × (World Avg Inflation / Your Inflation)**

```
Weak Currency:      [≡] 0.5  (exports cheap, imports expensive)
Normal Range:       [===========≡===========] 0.8–1.2
Strong Currency:    [≡] 2.0  (exports expensive, imports cheap)

Trade Income Modifier (based on strength):
  Strength 0.5 = +50% export income (but −30% import goods)
  Strength 1.0 = normal trade
  Strength 2.0 = −30% export income (but +50% import cost savings)

Reserve Currency Status:
  Triggers at: Strength > 1.5 AND GDP > 50% world GDP
  Effect: +10% of all global trade revenue
  Penalty if lost: −15% trade income (reversion shock)

Tuning knobs:
  Treasury/Debt ratio weight: 1.0 (tuning: 0.5–1.5)
  Inflation ratio weight: 1.0 (tuning: 0.5–1.5)
  Reserve currency threshold (strength): 1.5 (tuning: 1.2–2.0)
  Reserve currency GDP threshold: 50% (tuning: 40–60%)
  Reserve revenue bonus: 10% (tuning: 5–20%)
```

---

## Faction Grievance & Demands

**Grievance range: 0–100% (triggers at 75%, revolution at 100%)**

```
Ignore demand:     Grievance += (10 × Severity)
                   └─ Severity 1: +10,  Severity 2: +20,  Severity 3: +30

Comply demand:     Grievance −= 20

Negotiate demand:  Grievance −= 10,  Political Capital −= 3–5

Natural decay:     Grievance −= 1 per quarter (0.25% per month)

Hostile threshold: 75%  (blocks opposing laws, −20% production)
Revolution trigger: 100%  (government flips, 40% tech points return)

Demand frequency by grievance:
  0–25%:   0–1 demands/quarter
  25–50%:  1 demand/quarter
  50–75%:  1–2 demands/quarter
  75–100%: 2–3 demands/quarter

Slider representation:
Ignore grievance gain:       [========≡] 10 (per severity) [tuning: 5–20]
Comply grievance loss:       [========≡] −20 [tuning: −10 to −30]
Negotiate grievance loss:    [====≡] −10 [tuning: −5 to −15]
Natural decay rate:          [≡] −1/quarter [tuning: −0.5 to −2]
Hostile threshold:           [≡] 75% [tuning: 60–80%]
Revolution threshold:        [≡] 100% [tuning: 90–100%]
Demand frequency scalar:     [========≡] 1.0 [tuning: 0.5–2.0x]
```

---

## Military Upkeep & War Costs

**Unit upkeep scales with distance + inflation**

```
Base Upkeep (per unit, per turn):
  Infantry:   2  [≡]
  Cavalry:    3  [≡]
  Artillery:  5  [≡]
  Armor:      8  [≡]
  Aircraft:  10  [≡]
  Naval:      6  [≡]

Distance penalty:
  Upkeep × (1 + distance/10)
  └─ Capital garrison: 0 penalty
  └─ 10 cells away: +100% cost
  └─ 20 cells away: +200% cost
  
With Railways tech: penalty halved
  └─ 10 cells away with rails: +50%

Inflation multiplier:
  Upkeep × (1 + inflation/100)
  └─ At 10% inflation: +10% upkeep
  └─ At 50% inflation: +50% upkeep
  (Represents resource scarcity)

War attrition:
  30% of loser's units per turn [tuning: 20–50%]
  
War victory condition:
  Attacker strength > Defender strength
  (modified by militarism_bonus + terrain_defense)

Slider representation:
Base Infantry Cost:           [========≡] 2 pts [tuning: 1–3]
Distance Penalty Scalar:      [========≡] 1.0 [tuning: 0.5–2.0]
Railways Penalty Reduction:   [=========≡] −50% [tuning: −30 to −70%]
Inflation Upkeep Multiplier:  [========≡] 1.0 [tuning: 0.5–1.5]
War Attrition Rate:           [========≡] 30% [tuning: 20–50%]
Militarism Bonus (attack):    [========≡] +20% [tuning: 10–40%]
```

---

## Settlement Production & Infrastructure

**Real output = Nominal × (1 / (1 + inflation)) × currency_strength**

```
Agriculture base (per settlement):
  100 + 50×fertility_modifier + 30×tech_multiplier

Industry base:
  50 + 20×infrastructure_multiplier + 25×tech_multiplier

Services base:
  30 + 40×population_ratio + 15×education_tech

Information (late-game):
  0 (unlocks post-1980 with Science tech)

Tech multipliers (per research node):
  Engineering +30% industry
  Agriculture tech +20% agriculture
  Education +25% services efficiency

Infrastructure costs (maintenance per quarter):
  0.1 treasury per node (roads, ports, plants, water, rails)
  [tuning: 0.05–0.2]

Power consumption:
  10 + 0.1×population (per settlement)
  
Power shortage penalty:
  −30% production if supply < demand
  [tuning: −20 to −50%]

Water consumption:
  5 + 0.05×population
  
Water shortage penalties:
  −20% agriculture
  −10% happiness
  Disease risk if no sewage: 2% population loss/quarter
  [tuning: −10 to −30% agriculture, disease 1–5%]

Slider representation:
Agriculture Base:            [========≡] 100 [tuning: 50–150]
Industry Base:               [=========≡] 50 [tuning: 30–80]
Services Base:               [======≡] 30 [tuning: 15–50]
Tech Multiplier per Node:    [=======≡] +30% [tuning: +15 to +50%]
Infrastructure Maintenance:  [========≡] 0.1/quarter [tuning: 0.05–0.2]
Power Shortage Penalty:      [========≡] −30% [tuning: −20 to −50%]
Water Shortage Agriculture:  [========≡] −20% [tuning: −10 to −30%]
Disease Risk (no sewage):    [========≡] 2%/quarter [tuning: 1–5%]
```

---

## Happiness & Population Growth

**Happiness range: 0–100% (growth/decay based on value)**

```
Happiness drivers:
  +5 per welfare law
  −5 per high tax
  −20 if unemployment > 30%
  −10 if disease present
  +10 if education > 50%
  −30 if at war (occupied settlement)
  −15 if inflation > 10%

Population growth:
  Base: 1.5% per year
  At happiness > 80%: +1% growth bonus
  At happiness < 40%: −1% growth penalty
  
  Critical threshold: population < 500
    └─ Settlement becomes uninhabitable
    └─ Production −50%
    └─ Can be recovered via immigration if happiness restored

Immigration (from other nations):
  At happiness > 80%: +50% immigration bonus
  At happiness < 40%: −50% immigration penalty
  Affected by: culture level, ideology compatibility

Slider representation:
Base Growth Rate:            [========≡] 1.5%/year [tuning: 0.5–3%]
Happiness Growth Bonus:      [========≡] +1% [tuning: 0.5–2%]
Happiness Decay Penalty:     [========≡] −1% [tuning: −0.5 to −2%]
Immigration Bonus:           [========≡] +50% [tuning: 20–100%]
Immigration Penalty:         [========≡] −50% [tuning: −30 to −80%]
Critical Population:         [========≡] 500 [tuning: 200–1000]
War Happiness Penalty:       [========≡] −30% [tuning: −20 to −50%]
```

---

## Revolution & Tech Reset

**Tech reset on revolution: 40% of spent points return + 10-year disruption**

```
Points returned:
  40% of total spent points
  [tuning: 30–50%]

Research disruption duration:
  10 years of −50% research speed
  [tuning: 5–15 years]
  [tuning: −30 to −70% research speed]

Ideology lock:
  5 years of forced research in revolutionary faction's branch
  [tuning: 3–10 years]
  [tuning: faction tech preference weights]

Treasury penalty:
  −30% of current treasury (destroyed in upheaval)
  [tuning: −20 to −50%]

Destruction:
  ~10% of buildings destroyed
  [tuning: 5–20%]

Unrest period:
  3 months of −10% production
  [tuning: 1–6 months, −5 to −20% production]

Slider representation:
Points Returned on Revolution:  [========≡] 40% [tuning: 30–50%]
Research Disruption Duration:   [========≡] 10 years [tuning: 5–15]
Research Speed Reduction:       [=========≡] −50% [tuning: −30 to −70%]
Ideology Lock Duration:         [========≡] 5 years [tuning: 3–10]
Treasury Damage:                [========≡] −30% [tuning: −20 to −50%]
Building Destruction:           [========≡] 10% [tuning: 5–20%]
Unrest Production Penalty:      [========≡] −10% [tuning: −5 to −20%]
```

---

## Win Condition Thresholds

| Victory Type | Condition | Threshold | Tuning Range |
|---|---|---|---|
| Economic Superpower | World GDP % | 50% | 40–60% |
| | Reserve currency | Yes | — |
| | Budget surplus years | 20 | 10–30 |
| Military Hegemon | Territory % | 40% | 30–50% |
| | Military strength ratio | 2.0× | 1.5–3.0× |
| | Wars won (last 50 years) | 100% | 80–100% |
| Cultural Dominant | Avg happiness | 80% | 70–90% |
| | World population % | 50% | 40–60% |
| | Ideology axes won | 3+ | 2–5 |
| Technological Leader | Tech nodes researched | 60% | 50–70% |
| | Space tech unlocked | Yes | — |
| | Science output lead | 30+ years | 20–40 years |
| Diplomatic Superpower | Vassals/allies | 6+ | 4–8 |
| | Peace brokered | 5+ | 3–8 |
| | UN votes controlled | 3+ | 2–5 |
| Longevity | Year reached | 2100 | — |
| | Min happiness | 40% | 30–50% |
| | Solvency | Treasury never negative | — |
| Climate Stabilization | CO₂ reduction | 50% | 40–60% |
| | Net-zero by | 2080 | 2070–2100 |

---

## Era-Based Scaling

```
ERA 1 (1800–1850):   Mercantilism era
  └─ Research speed: 0.2 pts/year
  └─ Inflation baseline: 5%
  └─ War cost: 1.0×
  └─ Unit upkeep: 1.0×

ERA 2 (1850–1920):   Industrial revolution
  └─ Research speed: 0.3 pts/year (+50%)
  └─ Inflation baseline: 4%
  └─ War cost: 1.2× (mechanized warfare)
  └─ Unit upkeep: 1.1×

ERA 3 (1920–1980):   Modern age
  └─ Research speed: 0.4 pts/year (+100% from era 1)
  └─ Inflation baseline: 3%
  └─ War cost: 1.5× (industrial-scale war)
  └─ Unit upkeep: 1.3×

ERA 4 (1980–2100):   Information age
  └─ Research speed: 0.5 pts/year (+150%)
  └─ Inflation baseline: 2%
  └─ War cost: 1.2× (asymmetric warfare)
  └─ Unit upkeep: 1.2× (digital command reduces waste)
  └─ New tech paths unlock (crypto, space, biotech)

Slider representation:
Era 1 Research Multiplier:  [=========≡] 1.0x (base)
Era 2 Research Multiplier:  [==========≡] 1.5x
Era 3 Research Multiplier:  [===========≡] 2.0x
Era 4 Research Multiplier:  [============≡] 2.5x

Era 1 Inflation Baseline:   [=========≡] 5% (no tax control)
Era 2 Inflation Baseline:   [========≡] 4%
Era 3 Inflation Baseline:   [========≡] 3%
Era 4 Inflation Baseline:   [========≡] 2%
```

---

## Difficulty Modifiers

```
EASY:
  Faction demand frequency: 0.5× (half as often)
  Ignore grievance gain: ×0.7 (harder to anger)
  Research speed: 1.3× (faster tech)
  Enemy AI aggression: 0.6× (rivals less likely to attack)
  War attrition: 0.8× (less costly)

NORMAL:
  All multipliers: 1.0× (baseline)

HARD:
  Faction demand frequency: 1.5× (demands come faster)
  Ignore grievance gain: ×1.3 (factions anger quickly)
  Research speed: 0.8× (slower tech)
  Enemy AI aggression: 1.5× (rivals attack more)
  War attrition: 1.2× (wars are bloodier)
  Inflation baseline: +1% per era (economic chaos)
```

---

## Recommended Tuning Order

1. **Start with defaults** (all sliders at 1.0 or marked value)
2. **Play through 1 full game** to 2100 (4–6 hours)
3. **Identify problem areas** (e.g., "inflation spirals too quickly", "wars too easy to win", "tech tree unbalanced")
4. **Adjust 1 slider at a time** by ±10–20% and replay
5. **Document findings** in this file with date + result
6. **Push changes** to HANDOFF.md + HANDOFF_TECHNICAL.md

**Testing checklist**:
- [ ] Economic victory is achievable without military
- [ ] Military victory is achievable without economy
- [ ] Cultural victory is achievable at normal difficulty
- [ ] Tech specialization vs. generalist play feels balanced
- [ ] Revolutions don't feel arbitrary (grievance should climb visibly)
- [ ] Wars take 3–10 years to resolve (not instant, not endless)
- [ ] Player reaches year 2100 in ~4 hours (typical session)

---

**Version History**:
- 2026-06-17: Initial sliders (all at recommended baseline)
- (Add updates as balance changes are made)

