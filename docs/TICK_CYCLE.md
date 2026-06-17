# TICK_CYCLE: Simulation Tick Order & Dependencies

**Purpose**: Define exact order of operations each game tick to prevent circular dependencies  
**Frequency**: 4 ticks per in-game month (1 tick ≈ 1 week)  
**Total**: ~1,200 ticks per year

---

## Tick Order (CRITICAL)

Follow this order exactly. Each step depends on prior steps.

```
┌─ TICK START (player year + game tick)
│
├─ Step 1: PRODUCTION & ECONOMY
│  ├─ For each settlement:
│  │  ├─ Compute base sector outputs (agriculture, industry, services, information)
│  │  │   using: base × tech_multipliers × (1 − war_disruption)
│  │  ├─ Compute real output: nominal / (1 + inflation) × currency_strength
│  │  ├─ Subtract consumption (population × food_per_capita)
│  │  ├─ Check power (if short: production −30%)
│  │  ├─ Check water (if short: agriculture −20%, health −10%)
│  │  └─ Net production exported as trade / stored as surplus
│  │
│  ├─ Global trade calculation:
│  │  ├─ Sum all settlements' exports
│  │  ├─ Apply sanctions (−30% for embargoed rivals)
│  │  ├─ Apply currency effects (weak currency = +50% export value)
│  │  └─ Add to player treasury
│  │
│  ├─ Government spending deduction:
│  │  ├─ Military upkeep (per unit)
│  │  ├─ Infrastructure maintenance (0.1 × num_nodes)
│  │  ├─ Welfare programs (if laws enacted)
│  │  └─ Subtract from treasury
│  │
│  └─ Compute inflation this tick:
│     ├─ spending = (military + infrastructure + welfare)
│     ├─ production = sum of real outputs
│     ├─ base_inflation = (spending / production) × 100
│     ├─ interest_effect = (player_interest_rate − 2) / 20
│     └─ inflation = base_inflation × (1 − interest_effect) [clamped 2–200%]
│
├─ Step 2: SETTLEMENT UPDATES
│  ├─ For each settlement:
│  │  ├─ Apply happiness modifiers:
│  │  │  ├─ +5 per welfare law
│  │  │  ├─ −5 per tax law
│  │  │  ├─ −20 if unemployment > 30%
│  │  │  ├─ −15 if inflation > 10%
│  │  │  └─ −30 if occupied by war
│  │  │
│  │  ├─ Apply production penalties:
│  │  │  ├─ −10% if power shortage
│  │  │  ├─ −20% if water shortage
│  │  │  └─ −50% if occupied territory
│  │  │
│  │  ├─ Population growth/decay:
│  │  │  ├─ Base: 1.5% per 4 ticks (1 month)
│  │  │  ├─ Happiness > 80%: +1% bonus
│  │  │  ├─ Happiness < 40%: −1% penalty
│  │  │  ├─ Starvation check: if food shortage, −2%
│  │  │  └─ Disease check: if no sewage + water short, −2%
│  │  │
│  │  └─ Construction progress:
│  │     ├─ If construction in progress: +1 day progress
│  │     ├─ If treasury insufficient: stall project
│  │     └─ If complete: unlock building, reset to null
│  │
│  └─ Check settlement viability:
│     └─ If population < 500: mark critical (−50% production)
│     └─ If population = 0: abandon settlement
│
├─ Step 3: FACTION STATE UPDATES
│  ├─ For each faction:
│  │  ├─ Update power based on economy:
│  │  │  ├─ Workers: power +2 if unemployment > 30%, −2 if > 50% employed
│  │  │  ├─ Merchants: power +2 if trade income > avg, −1 if sanctions active
│  │  │  ├─ Landowners: power +1 if agriculture surplus, −1 if shortage
│  │  │  └─ Military: power +1 per 2 units, −1 per military spending cut
│  │  │
│  │  ├─ Update opinion based on government type:
│  │  │  ├─ Democracy: Workers +10, Merchants +5, others −2
│  │  │  ├─ Autocracy: Military +10, others −5
│  │  │  ├─ Oligarchy: Merchants +10, others −3
│  │  │  └─ etc. (see ideology.ts for full matrix)
│  │  │
│  │  ├─ Grievance natural decay:
│  │  │  └─ grievance −= 1 per tick (−4 per month / −48 per year)
│  │  │
│  │  └─ Issue demand if conditions met:
│  │     ├─ 1 demand per 25% grievance per quarter
│  │     ├─ Severity determined by grievance level
│  │     └─ Text picked from faction demand templates
│
├─ Step 4: IDEOLOGY ACCUMULATION
│  ├─ Apply law ideology effects:
│  │  └─ For each active law: add its ideology deltas to ideology vector
│  │
│  ├─ Apply event ideology effects:
│  │  ├─ War: +5 militarism per year at war
│  │  ├─ Famine: +5 auth (government takes control)
│  │  ├─ Tech breakthrough: +3 progress
│  │  └─ etc.
│  │
│  └─ Compute government type from ideology:
│     ├─ Matches dominant axis (see ideology.ts for mapping)
│     ├─ If year >= 5: lock government (can't change until revolution)
│     └─ If changed, broadcast event (government shift message)
│
├─ Step 5: MILITARY & WARS
│  ├─ For each unit:
│  │  ├─ Deduct upkeep from treasury:
│  │  │  └─ upkeep = base_cost × (1 + distance/10) × (1 + inflation/100)
│  │  │
│  │  └─ Check readiness:
│  │     └─ If treasury negative and upkeep not paid: unit attrition (−10%)
│  │
│  ├─ For each active war:
│  │  ├─ Resolve one turn of combat:
│  │  │  ├─ attacker_strength = sum(attacker_units) × militarism_bonus
│  │  │  ├─ defender_strength = sum(defender_units) × terrain_defense
│  │  │  ├─ loser_strength = loser of above comparison
│  │  │  ├─ loser_units ×= (1 − 0.3) (30% attrition)
│  │  │  ├─ defender_territory_production −= 50% (occupation disruption)
│  │  │  └─ war_duration += 1 turn
│  │  │
│  │  ├─ Check war end conditions:
│  │  │  ├─ If defender_strength = 0: attacker wins (territory transfers)
│  │  │  ├─ If war_duration > max_war_length: stalemate (peace negotiation)
│  │  │  └─ If either side's strength < critical: option to sue for peace
│  │  │
│  │  └─ War consequences:
│  │     ├─ Treasury damage: −5% of current treasury
│  │     ├─ Population unhappiness: −20% in war zones
│  │     └─ Inflation spike: +10% for war duration
│
├─ Step 6: SANCTIONS & DIPLOMACY
│  ├─ Check embargo durations:
│  │  ├─ If embargo_duration expired: lift automatically
│  │  └─ If war ends: sanctions can be negotiated
│  │
│  ├─ Update rival opinions:
│  │  ├─ Player tech lead: ±2 opinion per rival
│  │  ├─ Military threat: ±3 opinion per rival
│  │  ├─ Trade partner: +2 opinion per rival
│  │  └─ War history: −5 per rival player defeated
│  │
│  └─ Rival demand handling:
│     ├─ Each rival may issue demand (tech steal, land, tribute)
│     └─ Player can Comply/Refuse (triggers opinion shift or minor war)
│
├─ Step 7: POPULATION & CULTURE
│  ├─ For each settlement:
│  │  ├─ Population growth/migration:
│  │  │  ├─ Immigration: +pop × 5% if happiness > 80%, −5% if < 40%
│  │  │  ├─ Emigration: +pop × 2% if in critical state or at war
│  │  │  └─ Migration from rivals: culture% chance to convert adjacent cells
│  │  │
│  │  └─ Culture influence:
│  │     ├─ If culture > 50%: can culture-flip adjacent rival cells
│  │     ├─ High culture = +5% tourism income
│  │     └─ Low culture = −5% happiness
│
├─ Step 8: TECHNOLOGY & RESEARCH
│  ├─ Add research points per turn:
│  │  ├─ base = researchPoints_per_year / 12 (divided into 12 months × 4 ticks)
│  │  ├─ if_locked_research: base ×= 0.5 (if revolution-locked)
│  │  └─ if_disrupted: base ×= 0.5 (if 10 years post-revolution)
│  │
│  ├─ Research progress:
│  │  ├─ If player has active research: accumulate points toward node
│  │  ├─ When accumulated >= node_cost: unlock node, reset accumulator
│  │  └─ Announce tech discovery with toast
│  │
│  └─ Unlock effects:
│     ├─ Building types unlocked
│     ├─ Unit types unlocked
│     ├─ Laws available
│     ├─ Infrastructure options available
│     └─ Production multipliers apply immediately
│
├─ Step 9: REVOLUTION CHECK
│  ├─ For each faction:
│  │  ├─ If grievance >= 100%: trigger revolution
│  │  └─ (See Step 10)
│  │
│  ├─ Check multi-faction crisis:
│  │  ├─ If 2+ factions at 75%+ grievance: coalition revolution possible
│  │  └─ Outcome = highest-power faction's government preference
│  │
│  └─ If no single revolution, check if pair of factions can revolt together
│     └─ Chance increases if ideologically opposed (workers + military, etc.)
│
├─ Step 10: REVOLUTION EXECUTION (if triggered)
│  ├─ Revolution event:
│  │  ├─ Government type flips to revolutionary faction's preference
│  │  ├─ Ideology axes shift toward faction's preferences (−30 to +30 points)
│  │  ├─ Treasury damage: −30% of current balance
│  │  ├─ Buildings destroyed: ~10% of total
│  │  ├─ Production penalty: −10% for 3 months
│  │  └─ Unrest period active flag: set for 12 ticks (3 months)
│  │
│  ├─ Tech reset:
│  │  ├─ Points returned: 40% of total spent
│  │  ├─ Research disruption: next 40 ticks (10 years) at −50% speed
│  │  ├─ Ideology lock: next 20 ticks (5 years) forced into faction's branch
│  │  └─ All current research stalls (progress reset to 0)
│  │
│  ├─ Rival response:
│  │  ├─ If revolution successful: rival opinions shift (weak nation = lower threat)
│  │  ├─ If military faction took over: other militaries get +5 opinion
│  │  └─ If workers took over: other democracies get +5 opinion
│  │
│  └─ Post-revolution message log entry:
│     └─ "[Year]: Revolution! [Faction] seizes power. New government: [Type]."
│
└─ TICK END
   ├─ Increment tick counter
   ├─ Every 4 ticks (1 month): monthly effects
   ├─ Every 48 ticks (12 months): yearly effects
   │  ├─ Check win conditions
   │  ├─ Emit era transition if year boundary crossed
   │  └─ Save autosave checkpoint
   └─ Continue to next tick
```

---

## Key Dependency Rules

**These MUST be obeyed**:

1. **Production happens before spending**
   - Can't deduct upkeep before computing income
   - Deficit spending tracked at end of production

2. **Inflation computes AFTER spending is known**
   - Can't modify inflation retroactively
   - Set at end of Step 1 for use in next tick

3. **Factions update AFTER economy settled**
   - Faction power shifts based on final economy state
   - Opinion changes based on government type (stable)

4. **Wars happen AFTER factions (no feedback)**
   - War casualties affect next tick's factions (not same tick)
   - This prevents circular "war causes grievance causes revolution causes war"

5. **Population changes after all consumption**
   - Starvation only triggers after Step 1 (food checked)
   - Growth applied after happiness computed

6. **Tech research happens BEFORE checking win conditions**
   - Win condition checks run at end of year, after research accumulated
   - No loop (research can't affect itself)

7. **Revolution happens LAST**
   - All other systems settle first
   - Revolution resets tech, not affecting current tick's production

---

## Tick Frequency & Calendar

**1 game tick = 1 week of in-game time**

```
4 ticks/month
12 months/year
300 years (1800–2100)
= 1,200 ticks/year
= 36,000 ticks total (1800–2100)

Real-time (approximate):
  1 tick ≈ 3 seconds at normal speed
  1 year ≈ 1 hour
  Full game ≈ 5–6 hours (including pauses, decisions)
```

**Time acceleration**:
- 1× normal speed (default)
- 2× fast
- 5× faster
- 10× fastest
- Player can pause at any time

---

## Annual Events (Yearly Tick)

**Once per in-game year** (every 48 ticks):

```
1. Win condition check
   └─ If any player victory met: trigger win screen

2. Era transition check
   └─ If year crossed era boundary (1850, 1920, 1980):
      ├─ Modal: era name + description
      ├─ Palette shift
      ├─ Music stinger
      └─ Research point rate updated

3. Rival turn (happens once per year, not per tick)
   ├─ Each rival:
   │  ├─ Compute agenda (expansion, trade, culture, militarize)
   │  ├─ Issue demands/proposals to player
   │  ├─ Move units if at war
   │  ├─ Tech research accumulation
   │  └─ Settlement expansion (founding new towns)
   │
   └─ Inter-rival diplomacy:
      ├─ Rivals can ally/declare war with each other
      └─ Doesn't affect player directly, but geopolitics shift

4. Environmental events (low frequency)
   ├─ Rare: Plague (−2% population if disease risk)
   ├─ Rare: Famine (if agriculture shortage, −20% production for 6 months)
   ├─ Rare: Boom (if production surplus, +10% trade income for 1 year)
   └─ Climate: Global CO₂ accumulates (late-game impact)

5. Autosave checkpoint
   └─ Save game state to localStorage

6. Log update
   └─ Annual summary to event log: "[Year]: Population [N], Treasury [M]"
```

---

## Debugging Checklist

If something feels wrong, check tick order:

- [ ] Is production computed before spending deduction? (Step 1 → Step 2)
- [ ] Is inflation set AFTER all spending known? (end of Step 1)
- [ ] Are faction grievance decays monotonic (always downward without new demands)? (Step 3)
- [ ] Are wars affecting treasury AFTER upkeep is deducted? (Step 5 after Step 2)
- [ ] Does revolution happen LAST (Step 10), not interrupting production? 
- [ ] Are win conditions checked once per year, not per tick?
- [ ] Is research interrupting revenue OR revenue interrupting research? (should be independent, Step 1 and Step 8)

---

## Known Issues / Deferred

- (None yet; add as discovered during implementation)

---

**Reference**: HANDOFF_TECHNICAL.md for data model, BALANCE_KNOBS.md for parameter tuning.

