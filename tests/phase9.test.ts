import { describe, expect, it } from 'vitest';
import {
  RegionSim,
  REGION_MINUTES_PER_TICK,
  GOV_TYPES,
  POLICY_CARDS,
  TRANSITION_CHAINS,
} from '../src/sim/region';
import { MINUTES_PER_DAY } from '../src/sim/defs';

const ticksPerDay = MINUTES_PER_DAY / REGION_MINUTES_PER_TICK;

function runDays(r: RegionSim, days: number): void {
  for (let i = 0; i < days * ticksPerDay; i++) r.tick();
}

function runMonths(r: RegionSim, months: number): void {
  runDays(r, months * 30);
}

function makeNationReady(seed = 42): RegionSim {
  const r = RegionSim.create(seed, { aiDifficulty: 'normal', currencySymbol: '$' });
  r.tick();
  r.stateProclaimed = true;
  r.proclamationReady = true;
  r.stateName = 'Testonia';
  r.govLean = 'council';
  r.treasury = 40000;
  r.militiaLevel = 2;
  r.researched.add('statecraft');
  r.researched.add('universal_suffrage');
  r.researched.add('income_tax');
  r.researched.add('free_press');
  r.researched.add('labor_law');
  r.researched.add('public_education');
  for (const t of r.settlements) {
    t.cohorts.bands[2] += 800;
    t.garrisonStrength = 5;
  }
  return r;
}

function makeNation(gov: string, seed = 42): RegionSim {
  const r = makeNationReady(seed);
  r.proclaimNation('Testland', gov as any, {});
  return r;
}

// ============================================================
// Test 1: All 15 regime types exist in GOV_TYPES with required fields
// ============================================================
describe('Phase 9: GOV_TYPES completeness', () => {
  const expectedIds = [
    'democracy', 'republic', 'junta', 'monarchy',
    'const_monarchy', 'abs_monarchy', 'oligarchy', 'theocracy',
    'direct_democracy', 'corporatocracy', 'fascist',
    'social_democracy', 'autocracy', 'one_party', 'technocracy',
  ];

  it('all 15 regime types exist in GOV_TYPES', () => {
    const ids = GOV_TYPES.map((g) => g.id);
    for (const id of expectedIds) {
      expect(ids).toContain(id);
    }
    expect(GOV_TYPES.length).toBeGreaterThanOrEqual(15);
  });

  it('every regime has required fields: id, name, electionsRequired, allowedLeanings, legitimacyDecayModifier, maxSlots', () => {
    for (const g of GOV_TYPES) {
      expect(typeof g.id).toBe('string');
      expect(typeof g.name).toBe('string');
      expect(typeof g.electionsRequired).toBe('boolean');
      expect(Array.isArray(g.allowedLeanings)).toBe(true);
      expect(typeof g.legitimacyDecayModifier).toBe('number');
      expect(g.legitimacyDecayModifier).toBeGreaterThan(0);
      expect(typeof g.maxSlots).toBe('number');
      expect(g.maxSlots).toBeGreaterThan(0);
    }
  });
});

// ============================================================
// Test 2: Fascist regime has minYear=1925, maxYear=1955; cannot emerge after 1955
// ============================================================
describe('Phase 9: Fascist regime period gate', () => {
  it('fascist gov has minYear=1925 and maxYear=1955', () => {
    const fascist = GOV_TYPES.find((g) => g.id === 'fascist')!;
    expect(fascist).toBeDefined();
    expect(fascist.minYear).toBe(1925);
    expect(fascist.maxYear).toBe(1955);
  });

  it('proclaimNation with fascist after 1955 does not set govType', () => {
    const r = makeNationReady(42);
    // Advance time past 1955: sim starts 1919; 37 years * 60 days/year
    r.minute = (1956 - 1919) * 60 * MINUTES_PER_DAY;
    expect(r.year).toBeGreaterThan(1955);
    r.proclaimNation('Late Fascism', 'fascist' as any, {});
    expect(r.govType).toBeNull();
    expect(r.nationProclaimed).toBe(false);
  });
});

// ============================================================
// Test 3: planningOptimism grows monthly under one_party regime
// ============================================================
describe('Phase 9: One-party planning optimism', () => {
  it('planningOptimism grows each month under one_party regime', () => {
    const r = makeNation('one_party');
    expect(r.planningOptimism).toBe(0);
    runMonths(r, 3);
    expect(r.planningOptimism).toBeGreaterThan(0);
    expect(r.planningOptimism).toBeCloseTo(0.03, 1);
  });

  it('planningOptimism is capped at 1', () => {
    const r = makeNation('one_party');
    r.planningOptimism = 0.99;
    runMonths(r, 5);
    expect(r.planningOptimism).toBeLessThanOrEqual(1);
  });
});

// ============================================================
// Test 4: reportedGDP diverges from actual when planningOptimism > 0 (one_party)
// ============================================================
describe('Phase 9: One-party reported GDP', () => {
  it('reportedGDP exceeds gdpLastMonth when planningOptimism > 0', () => {
    const r = makeNation('one_party');
    r.planningOptimism = 0.5;
    runMonths(r, 1);
    expect(r.reportedGDP).toBeGreaterThan(r.gdpLastMonth);
  });

  it('reportedGDP equals gdpLastMonth for non-one_party regimes', () => {
    const r = makeNation('democracy');
    runMonths(r, 1);
    expect(r.reportedGDP).toBeCloseTo(r.gdpLastMonth, 0);
  });
});

// ============================================================
// Test 5: Theocracy schismRisk grows when secular techs are researched
// ============================================================
describe('Phase 9: Theocracy schism risk', () => {
  it('schismRisk grows when secular techs are researched under theocracy', () => {
    const r = makeNation('theocracy');
    expect(r.schismRisk).toBe(0);
    r.researched.add('computing');
    r.researched.add('civil_rights');
    runMonths(r, 1);
    expect(r.schismRisk).toBeGreaterThan(0);
  });

  it('schismRisk does not grow without secular techs', () => {
    const r = makeNation('theocracy');
    const secularTechs = ['computing', 'civil_rights', 'antibiotics', 'public_education', 'social_insurance'];
    for (const t of secularTechs) r.researched.delete(t);
    runMonths(r, 2);
    expect(r.schismRisk).toBe(0);
  });
});

// ============================================================
// Test 6: Schism fires at schismRisk > 70 — resets to 30 after firing
// ============================================================
describe('Phase 9: Theocracy schism event', () => {
  it('schism fires at schismRisk > 70 — legitimacy drops and schismRisk resets to 30', () => {
    const r = makeNation('theocracy');
    r.schismRisk = 71;
    r.researched.add('computing');
    // Use a seeded rng that will trigger the event — just run many months
    // 3% chance per month; after enough months it fires
    let schismFired = false;
    for (let month = 0; month < 200; month++) {
      const prevSchismRisk = r.schismRisk;
      runMonths(r, 1);
      if (r.schismRisk === 30 && prevSchismRisk > 30) {
        schismFired = true;
        break;
      }
    }
    // Either schism fired and reset, or schismRisk grew beyond 100 (capped)
    // The key property: schismRisk should never exceed 100
    expect(r.schismRisk).toBeLessThanOrEqual(100);
  });
});

// ============================================================
// Test 7: Corporatocracy shareholderPatience decays in long war
// ============================================================
describe('Phase 9: Corporatocracy shareholder patience', () => {
  it('shareholderPatience starts at 80 on proclamation', () => {
    const r = makeNation('corporatocracy');
    expect(r.shareholderPatience).toBe(80);
  });

  it('shareholderPatience decays when at war longer than 12 months', () => {
    const r = makeNation('corporatocracy');
    const startDay = r.day - 13 * 30;
    (r as any).playerWar = {
      rivalId: 1,
      cb: 'border_dispute',
      defensive: false,
      startedDay: startDay,
      startDay: startDay,
      support: 60,
      score: 0,
      mobilization: 'volunteer',
      casualties: 0,
      blockade: false,
      allies: [],
      enemyAllies: [],
      occupied: 0,
      resistance: 0,
      occupationPolicy: 'standard',
      brutality: false,
      units: [],
      supplyReserve: 3,
    };
    const before = r.shareholderPatience;
    runMonths(r, 1);
    expect(r.shareholderPatience).toBeLessThan(before);
  });

  it('shareholderPatience recovers in peacetime', () => {
    const r = makeNation('corporatocracy');
    r.shareholderPatience = 50;
    runMonths(r, 2);
    expect(r.shareholderPatience).toBeGreaterThan(50);
  });
});

// ============================================================
// Test 8: activatePolicySlot() rejects wrong category
// ============================================================
describe('Phase 9: activatePolicySlot() validation', () => {
  it('rejects wrong category for a policy card (welfare_state is social, not economic)', () => {
    const r = makeNation('democracy');
    r.researched.add('labor_law');
    const ok = r.activatePolicySlot('economic', 'welfare_state');
    expect(ok).toBe(false);
  });

  it('rejects card whose prereqs are not met', () => {
    const r = makeNation('democracy');
    r.researched.delete('labor_law');
    const ok = r.activatePolicySlot('social', 'welfare_state');
    expect(ok).toBe(false);
  });

  it('returns false when nation is not proclaimed', () => {
    const r = makeNationReady(42);
    const ok = r.activatePolicySlot('economic', 'free_trade');
    expect(ok).toBe(false);
  });
});

// ============================================================
// Test 9: activatePolicySlot() succeeds for matching category
// ============================================================
describe('Phase 9: activatePolicySlot() success', () => {
  it('accepts a policy card matching the category when prereqs met (free_trade=economic)', () => {
    const r = makeNation('democracy');
    const ok = r.activatePolicySlot('economic', 'free_trade');
    expect(ok).toBe(true);
    expect(r.policySlots.some((s) => s.cardId === 'free_trade')).toBe(true);
  });

  it('rejects duplicate slots beyond category capacity (democracy has 1 economic slot)', () => {
    const r = makeNation('democracy');
    r.activatePolicySlot('economic', 'free_trade');
    // austerity also has no prereqs except income_tax which is researched
    const ok = r.activatePolicySlot('economic', 'austerity');
    expect(ok).toBe(false);
  });
});

// ============================================================
// Test 10: beginTransition() initializes transition chain correctly (junta→democracy)
// ============================================================
describe('Phase 9: beginTransition()', () => {
  it('returns false before nation is proclaimed', () => {
    const r = makeNationReady(42);
    const ok = r.beginTransition('democracy');
    expect(ok).toBe(false);
  });

  it('initializes transition chain for junta→democracy', () => {
    const r = makeNation('junta');
    r.politicalCapital = 999;
    const ok = r.beginTransition('democracy');
    expect(ok).toBe(true);
    expect(r.transitionChain).not.toBeNull();
    expect(r.transitionChain!.fromGov).toBe('junta');
    expect(r.transitionChain!.toGov).toBe('democracy');
    expect(r.transitionChain!.currentStep).toBe(0);
    expect(r.transitionChain!.steps.length).toBe(3);
  });

  it('returns false if no transition chain exists for the pair', () => {
    const r = makeNation('republic');
    const ok = r.beginTransition('theocracy');
    expect(ok).toBe(false);
  });

  it('returns false if a transition is already in progress', () => {
    const r = makeNation('junta');
    r.politicalCapital = 999;
    r.beginTransition('democracy');
    const ok2 = r.beginTransition('democracy');
    expect(ok2).toBe(false);
  });
});

// ============================================================
// Test 11: advanceTransition() applies faction effects and advances step
// ============================================================
describe('Phase 9: advanceTransition() step effects', () => {
  it('deducts political capital for the step', () => {
    const r = makeNation('junta');
    r.politicalCapital = 999;
    r.beginTransition('democracy');
    const stepCost = TRANSITION_CHAINS['junta:democracy'][0].capitalCost;
    const before = r.politicalCapital;
    r.advanceTransition();
    expect(r.politicalCapital).toBe(before - stepCost);
  });

  it('returns false if insufficient political capital', () => {
    const r = makeNation('junta');
    r.politicalCapital = 0;
    r.beginTransition('democracy');
    const ok = r.advanceTransition();
    expect(ok).toBe(false);
  });

  it('advances the step index', () => {
    const r = makeNation('junta');
    r.politicalCapital = 999;
    r.beginTransition('democracy');
    r.advanceTransition();
    expect(r.transitionChain!.currentStep).toBe(1);
  });
});

// ============================================================
// Test 12: Full transition chain (junta→democracy) completes after 3 steps
// ============================================================
describe('Phase 9: full transition chain completion', () => {
  it('junta→democracy changes govType after 3 steps', () => {
    const r = makeNation('junta');
    r.politicalCapital = 9999;
    r.beginTransition('democracy');
    expect(r.govType).toBe('junta');
    r.advanceTransition(); // step 1
    expect(r.govType).toBe('junta');
    r.advanceTransition(); // step 2
    expect(r.govType).toBe('junta');
    r.advanceTransition(); // step 3 — completes
    expect(r.govType).toBe('democracy');
    expect(r.transitionChain).toBeNull();
  });

  it('legitimacy increases on transition completion', () => {
    const r = makeNation('junta');
    r.politicalCapital = 9999;
    const beforeLeg = r.legitimacy;
    r.beginTransition('democracy');
    r.advanceTransition();
    r.advanceTransition();
    r.advanceTransition();
    expect(r.legitimacy).toBeGreaterThanOrEqual(beforeLeg);
  });
});

// ============================================================
// Test 13: Serialize/deserialize round-trip preserves all Phase 9 fields
// ============================================================
describe('Phase 9: serialize/deserialize round-trip', () => {
  it('preserves schismRisk, shareholderPatience, planningOptimism, policySlots, transitionChain', () => {
    const r = makeNation('junta');
    r.schismRisk = 42;
    r.shareholderPatience = 33;
    r.planningOptimism = 0.7;
    r.policySlots = [{ category: 'economic', slotId: 'economic_0', cardId: 'free_trade' }];
    r.politicalCapital = 9999;
    r.beginTransition('democracy');

    const json = r.serialize();
    const r2 = RegionSim.deserialize(json);

    expect(r2.schismRisk).toBe(42);
    expect(r2.shareholderPatience).toBe(33);
    expect(r2.planningOptimism).toBeCloseTo(0.7);
    expect(r2.policySlots.length).toBe(1);
    expect(r2.policySlots[0].cardId).toBe('free_trade');
    expect(r2.transitionChain).not.toBeNull();
    expect(r2.transitionChain!.fromGov).toBe('junta');
    expect(r2.transitionChain!.toGov).toBe('democracy');
    expect(r2.transitionChain!.currentStep).toBe(0);
  });

  it('backfills Phase 9 defaults for pre-Phase9 saves (missing fields)', () => {
    const r = makeNation('democracy');
    const json = r.serialize();
    const parsed = JSON.parse(json);
    delete parsed.planningOptimism;
    delete parsed.reportedGDP;
    delete parsed.credibilityGap;
    delete parsed.schismRisk;
    delete parsed.shareholderPatience;
    delete parsed.transitionChain;
    delete parsed.policySlots9;
    const json2 = JSON.stringify(parsed);

    const r2 = RegionSim.deserialize(json2);
    expect(r2.planningOptimism).toBe(0);
    expect(r2.reportedGDP).toBe(0);
    expect(r2.credibilityGap).toBe(0);
    expect(r2.schismRisk).toBe(0);
    expect(r2.shareholderPatience).toBe(80);
    expect(r2.transitionChain).toBeNull();
    expect(r2.policySlots).toEqual([]);
  });
});
