/**
 * Phase 11 — Renewables, Automation & Carbon Pricing
 *
 * Tests cover:
 *  - New tech nodes (solar_wind_parity, battery_storage, ev_adoption, ai_automation)
 *  - New civics (carbon_tax, cap_and_trade, green_industrial_policy) in techtree
 *  - New laws (carbon_pricing, cap_trade_law, green_industry_act, universal_basic_support)
 *  - RegionSim fields: automationUnemployment, strandedAssetLoss, speculativeBranch, ubsActive
 *  - checkStrandedAssets(): stranding occurs and buffers with green_industry_act
 *  - enactUniversalBasicSupport(): activation and idempotence
 *  - determineSpeculativeBranch(): all 3 paths (solarpunk/corporatocracy/drowned)
 *  - Monthly tick integration: automation drift, stranded-asset checks
 *  - Emissions reduction from Phase 11 techs/laws
 *  - Serialize/deserialize roundtrip of Phase 11 fields
 */
import { describe, expect, it } from 'vitest';
import {
  RegionSim, REGION_MINUTES_PER_TICK, BRANCH_YEAR, TECH_TREE, REGION_LAWS,
} from '../src/sim/region';
import { MINUTES_PER_DAY, DAYS_PER_YEAR, START_YEAR } from '../src/sim/defs';

const ticksPerDay = MINUTES_PER_DAY / REGION_MINUTES_PER_TICK;

function runDays(r: RegionSim, days: number): void {
  for (let i = 0; i < days * ticksPerDay; i++) r.tick();
}

function makeColony(seed = 42): RegionSim {
  const r = RegionSim.create(seed, { currencySymbol: '$' });
  r.settlements[0].food = 500;
  r.settlements[0].wood = 500;
  r.settlements[0].satisfaction = 60;
  return r;
}

function nationReady(seed = 42): RegionSim {
  const r = makeColony(seed);
  r.stateProclaimed = true;
  r.stateName = 'Testonia';
  r.govLean = 'council';
  r.treasury = 500;
  r.proclaimNation('Testland', 'democracy', {});
  return r;
}

function setYear(r: RegionSim, year: number): void {
  r.minute = (year - START_YEAR) * DAYS_PER_YEAR * MINUTES_PER_DAY;
}

// ---- Phase 11 Tech Tree ----

describe('Phase 11 tech nodes exist in TECH_TREE', () => {
  it('solar_wind_parity is defined with correct prereqs', () => {
    const node = TECH_TREE.find((n) => n.id === 'solar_wind_parity');
    expect(node).toBeDefined();
    expect(node!.tree).toBe('tech');
    expect(node!.prereqs).toContain('renewables');
    expect(node!.cost).toBeGreaterThan(0);
  });

  it('battery_storage requires solar_wind_parity', () => {
    const node = TECH_TREE.find((n) => n.id === 'battery_storage');
    expect(node).toBeDefined();
    expect(node!.prereqs).toContain('solar_wind_parity');
  });

  it('ev_adoption requires battery_storage', () => {
    const node = TECH_TREE.find((n) => n.id === 'ev_adoption');
    expect(node).toBeDefined();
    expect(node!.prereqs).toContain('battery_storage');
  });

  it('ai_automation requires computing', () => {
    const node = TECH_TREE.find((n) => n.id === 'ai_automation');
    expect(node).toBeDefined();
    expect(node!.prereqs).toContain('computing');
  });
});

describe('Phase 11 civic nodes exist in TECH_TREE', () => {
  it('carbon_tax civic is defined and requires environmentalism', () => {
    const node = TECH_TREE.find((n) => n.id === 'carbon_tax');
    expect(node).toBeDefined();
    expect(node!.tree).toBe('civics');
    expect(node!.prereqs).toContain('environmentalism');
  });

  it('cap_and_trade requires carbon_tax', () => {
    const node = TECH_TREE.find((n) => n.id === 'cap_and_trade');
    expect(node).toBeDefined();
    expect(node!.prereqs).toContain('carbon_tax');
  });

  it('green_industrial_policy requires cap_and_trade and battery_storage', () => {
    const node = TECH_TREE.find((n) => n.id === 'green_industrial_policy');
    expect(node).toBeDefined();
    expect(node!.prereqs).toContain('cap_and_trade');
    expect(node!.prereqs).toContain('battery_storage');
  });
});

describe('Phase 11 laws exist in REGION_LAWS', () => {
  it('carbon_pricing law is defined', () => {
    const law = REGION_LAWS.find((l) => l.id === 'carbon_pricing');
    expect(law).toBeDefined();
    expect(law!.requiresState).toBe(true);
    expect(law!.prereqs).toContain('carbon_tax');
  });

  it('cap_trade_law is defined', () => {
    const law = REGION_LAWS.find((l) => l.id === 'cap_trade_law');
    expect(law).toBeDefined();
    expect(law!.prereqs).toContain('cap_and_trade');
  });

  it('green_industry_act is defined', () => {
    const law = REGION_LAWS.find((l) => l.id === 'green_industry_act');
    expect(law).toBeDefined();
    expect(law!.prereqs).toContain('green_industrial_policy');
  });

  it('universal_basic_support law is defined', () => {
    const law = REGION_LAWS.find((l) => l.id === 'universal_basic_support');
    expect(law).toBeDefined();
    expect(law!.prereqs).toContain('ai_automation');
    expect(law!.prereqs).toContain('welfare_benefits');
  });
});

// ---- Phase 11 Fields ----

describe('RegionSim Phase 11 fields initialize to defaults', () => {
  it('automationUnemployment starts at 0', () => {
    const r = nationReady();
    expect(r.automationUnemployment).toBe(0);
  });

  it('strandedAssetLoss starts at 0', () => {
    const r = nationReady();
    expect(r.strandedAssetLoss).toBe(0);
  });

  it('speculativeBranch starts null', () => {
    const r = nationReady();
    expect(r.speculativeBranch).toBeNull();
  });

  it('ubsActive starts false', () => {
    const r = nationReady();
    expect(r.ubsActive).toBe(false);
  });
});

// ---- checkStrandedAssets ----

describe('checkStrandedAssets()', () => {
  it('returns 0 when solar_wind_parity not researched', () => {
    const r = nationReady();
    r.gdpLastMonth = 1000;
    // No solar_wind_parity in researched list
    expect(r.checkStrandedAssets()).toBe(0);
    expect(r.strandedAssetLoss).toBe(0);
  });

  it('may produce a write-down when solar_wind_parity is researched and fossil tech exists', () => {
    const r = nationReady();
    r.researched.add('renewables'); r.researched.add('computing'); r.researched.add('solar_wind_parity');
    r.researched.add('combustion_engine'); r.researched.add('mass_production'); r.researched.add('electrical_grid');
    r.gdpLastMonth = 5000;
    r.treasury = 10000;
    // Run many checks to ensure at least one stranding event fires (25% chance per call)
    let totalLoss = 0;
    for (let i = 0; i < 50; i++) {
      totalLoss += r.checkStrandedAssets();
    }
    expect(totalLoss).toBeGreaterThan(0);
    expect(r.strandedAssetLoss).toBeGreaterThan(0);
  });

  it('green_industry_act buffers stranded-asset losses (smaller write-down)', () => {
    const r1 = nationReady(42);
    const r2 = nationReady(42);

    const fossilTechs = ['combustion_engine', 'mass_production', 'electrical_grid', 'renewables', 'computing', 'solar_wind_parity'];
    for (const t of fossilTechs) { r1.researched.add(t); r2.researched.add(t); }
    r1.gdpLastMonth = 5000;
    r2.gdpLastMonth = 5000;

    // Only r2 has the buffering law
    r2.passedLaws.add('green_industry_act');

    // Run many checks to get stable averages
    let loss1 = 0;
    let loss2 = 0;
    const RUNS = 100;
    for (let i = 0; i < RUNS; i++) {
      loss1 += r1.checkStrandedAssets();
      loss2 += r2.checkStrandedAssets();
    }

    // With green_industry_act, losses should be less (buffered at 40%)
    if (loss1 > 0 && loss2 > 0) {
      expect(loss2).toBeLessThan(loss1);
    }
  });
});

// ---- enactUniversalBasicSupport ----

describe('enactUniversalBasicSupport()', () => {
  it('returns false when law not passed', () => {
    const r = nationReady();
    expect(r.enactUniversalBasicSupport()).toBe(false);
    expect(r.ubsActive).toBe(false);
  });

  it('activates when law is passed', () => {
    const r = nationReady();
    r.passedLaws.add('universal_basic_support');
    expect(r.enactUniversalBasicSupport()).toBe(true);
    expect(r.ubsActive).toBe(true);
    expect(r.log.some((l) => l.text.includes('UNIVERSAL BASIC SUPPORT'))).toBe(true);
  });

  it('is idempotent: returns false on second call', () => {
    const r = nationReady();
    r.passedLaws.add('universal_basic_support');
    r.enactUniversalBasicSupport();
    expect(r.enactUniversalBasicSupport()).toBe(false);
  });
});

// ---- determineSpeculativeBranch ----

describe('determineSpeculativeBranch()', () => {
  it('drowned path: high warming overrides everything (with Phase 11 tech active)', () => {
    const r = nationReady();
    setYear(r, BRANCH_YEAR);
    r.co2ppm = 600;
    r.warmingC = 2.8;
    // Phase 11 tech must be present for determineSpeculativeBranch to engage
    r.researched.add('renewables'); r.researched.add('computing');
    r.researched.add('solar_wind_parity'); r.researched.add('battery_storage'); r.researched.add('ai_automation');
    r.passedLaws.add('universal_basic_support'); r.passedLaws.add('green_industry_act');
    r.determineSpeculativeBranch();
    expect(r.speculativeBranch).toBe('drowned');
    expect(r.eraBranch).toBe('drowned');
    expect(r.log.some((l) => l.text.includes('DROWNED'))).toBe(true);
  });

  it('solarpunk path: green tech + civic equity + low warming + democracy', () => {
    const r = nationReady();
    setYear(r, BRANCH_YEAR);
    r.co2ppm = 320;
    r.warmingC = 0.8;
    r.researched.add('renewables'); r.researched.add('computing');
    r.researched.add('solar_wind_parity'); r.researched.add('battery_storage');
    r.researched.add('ai_automation'); r.researched.add('welfare_benefits');
    r.passedLaws.add('universal_basic_support'); r.passedLaws.add('green_industry_act');
    r.determineSpeculativeBranch();
    expect(r.speculativeBranch).toBe('solarpunk');
    expect(r.eraBranch).toBe('solarpunk');
    expect(r.log.some((l) => l.text.includes('SOLARPUNK'))).toBe(true);
  });

  it('corporatocracy path: automation without equity = neon future', () => {
    const r = nationReady();
    setYear(r, BRANCH_YEAR);
    r.co2ppm = 380;
    r.warmingC = 1.5;
    r.researched.add('renewables'); r.researched.add('computing');
    r.researched.add('solar_wind_parity'); r.researched.add('battery_storage'); r.researched.add('ai_automation');
    // No UBS, no green_industry_act
    r.determineSpeculativeBranch();
    expect(r.speculativeBranch).toBe('corporatocracy');
    expect(r.eraBranch).toBe('dystopia'); // maps to dystopia in existing taxonomy
    expect(r.log.some((l) => l.text.includes('CORPORATOCRACY'))).toBe(true);
  });

  it('verdict is read once and only once', () => {
    const r = nationReady();
    setYear(r, BRANCH_YEAR);
    r.co2ppm = 600;
    r.warmingC = 2.8;
    // Phase 11 tech present so the full branch logic engages
    r.researched.add('renewables'); r.researched.add('computing');
    r.researched.add('solar_wind_parity'); r.researched.add('battery_storage'); r.researched.add('ai_automation');
    r.determineSpeculativeBranch();
    expect(r.speculativeBranch).toBe('drowned');
    // Changing conditions should not alter the verdict
    r.co2ppm = 300;
    r.warmingC = 0.1;
    r.passedLaws.add('universal_basic_support'); r.passedLaws.add('green_industry_act');
    r.determineSpeculativeBranch();
    expect(r.speculativeBranch).toBe('drowned'); // locked in
  });

  it('corporatocracy with high automation raises grievance', () => {
    const r = nationReady();
    setYear(r, BRANCH_YEAR);
    r.co2ppm = 380;
    r.warmingC = 1.5;
    r.automationUnemployment = 0.20; // above 12% threshold
    r.researched.add('solar_wind_parity'); r.researched.add('battery_storage'); r.researched.add('ai_automation');
    const grievanceBefore = r.settlements[0].grievance;
    r.determineSpeculativeBranch();
    expect(r.speculativeBranch).toBe('corporatocracy');
    expect(r.settlements[0].grievance).toBeGreaterThan(grievanceBefore);
  });

  it('solarpunk branch boosts satisfaction', () => {
    const r = nationReady();
    setYear(r, BRANCH_YEAR);
    r.co2ppm = 300;
    r.warmingC = 0.5;
    r.researched.add('renewables'); r.researched.add('computing');
    r.researched.add('solar_wind_parity'); r.researched.add('battery_storage');
    r.researched.add('ai_automation'); r.researched.add('welfare_benefits');
    r.passedLaws.add('universal_basic_support'); r.passedLaws.add('green_industry_act');
    const satBefore = r.settlements[0].satisfaction;
    r.determineSpeculativeBranch();
    expect(r.speculativeBranch).toBe('solarpunk');
    expect(r.settlements[0].satisfaction).toBeGreaterThan(satBefore);
  });
});

// ---- Automation drift ----

describe('Automation unemployment drift', () => {
  it('automationUnemployment stays 0 without ai_automation', () => {
    const r = nationReady();
    setYear(r, 2030);
    r.gdpLastMonth = 1000;
    // Run several monthly ticks
    const monthTick = (reg: RegionSim) => (reg as unknown as { tickAutomation(): void }).tickAutomation();
    for (let i = 0; i < 12; i++) monthTick(r);
    expect(r.automationUnemployment).toBe(0);
  });

  it('automationUnemployment drifts upward with ai_automation', () => {
    const r = nationReady();
    r.researched.add('ai_automation');
    const monthTick = (reg: RegionSim) => (reg as unknown as { tickAutomation(): void }).tickAutomation();
    for (let i = 0; i < 24; i++) monthTick(r);
    expect(r.automationUnemployment).toBeGreaterThan(0);
  });

  it('UBS halves the automation drift rate', () => {
    const r1 = nationReady(1);
    r1.researched.add('ai_automation');

    const r2 = nationReady(2);
    r2.researched.add('ai_automation');
    r2.ubsActive = true;

    const tick1 = (reg: RegionSim) => (reg as unknown as { tickAutomation(): void }).tickAutomation();
    const MONTHS = 24;
    for (let i = 0; i < MONTHS; i++) {
      tick1(r1);
      tick1(r2);
    }
    expect(r1.automationUnemployment).toBeGreaterThan(r2.automationUnemployment);
  });

  it('automationUnemployment caps at 0.3', () => {
    const r = nationReady();
    r.researched.add('ai_automation');
    r.automationUnemployment = 0.29;
    const tick = (reg: RegionSim) => (reg as unknown as { tickAutomation(): void }).tickAutomation();
    for (let i = 0; i < 10; i++) tick(r);
    expect(r.automationUnemployment).toBeLessThanOrEqual(0.3);
  });
});

// ---- Emissions reduction from Phase 11 ----

describe('Phase 11 emissions reductions', () => {
  it('solar_wind_parity reduces player emissions by ~15%', () => {
    const r = nationReady();
    r.researched.add('renewables');
    const before = r.playerEmissions();
    r.researched.add('computing'); r.researched.add('solar_wind_parity');
    const after = r.playerEmissions();
    expect(after).toBeCloseTo(before * 0.85, 5);
  });

  it('ev_adoption further reduces player emissions', () => {
    const r = nationReady();
    r.researched.add('renewables'); r.researched.add('computing'); r.researched.add('solar_wind_parity');
    const before = r.playerEmissions();
    r.researched.add('automated_logistics'); r.researched.add('battery_storage'); r.researched.add('ev_adoption');
    const after = r.playerEmissions();
    expect(after).toBeLessThan(before);
  });

  it('carbon_pricing law cuts emissions by ~25%', () => {
    const r = nationReady();
    r.researched.add('renewables'); r.researched.add('computing'); r.researched.add('solar_wind_parity');
    r.researched.add('environmentalism'); r.researched.add('carbon_tax');
    const before = r.playerEmissions();
    r.passedLaws.add('carbon_pricing');
    const after = r.playerEmissions();
    expect(after).toBeCloseTo(before * 0.75, 5);
  });

  it('cap_trade_law further cuts emissions on top of carbon_pricing', () => {
    const r = nationReady();
    r.researched.add('renewables'); r.researched.add('computing'); r.researched.add('solar_wind_parity');
    r.researched.add('environmentalism'); r.researched.add('carbon_tax'); r.researched.add('statecraft'); r.researched.add('cap_and_trade');
    r.passedLaws.add('carbon_pricing');
    const before = r.playerEmissions();
    r.passedLaws.add('cap_trade_law');
    const after = r.playerEmissions();
    expect(after).toBeCloseTo(before * 0.65, 5);
  });
});

// ---- Serialize/deserialize roundtrip ----

describe('Phase 11 fields persist across saves', () => {
  it('roundtrips automationUnemployment, strandedAssetLoss, speculativeBranch, ubsActive', () => {
    const r = nationReady();
    r.automationUnemployment = 0.08;
    r.strandedAssetLoss = 1234.5;
    r.speculativeBranch = 'corporatocracy';
    r.ubsActive = true;

    const back = RegionSim.deserialize(r.serialize());
    expect(back.automationUnemployment).toBeCloseTo(0.08);
    expect(back.strandedAssetLoss).toBeCloseTo(1234.5);
    expect(back.speculativeBranch).toBe('corporatocracy');
    expect(back.ubsActive).toBe(true);
  });

  it('older saves without Phase 11 fields default correctly', () => {
    const r = nationReady();

    // Manually strip Phase 11 fields from the serialized blob
    const raw = JSON.parse(r.serialize());
    delete raw.automationUnemployment;
    delete raw.strandedAssetLoss;
    delete raw.speculativeBranch;
    delete raw.ubsActive;

    const back = RegionSim.deserialize(JSON.stringify(raw));
    expect(back.automationUnemployment).toBe(0);
    expect(back.strandedAssetLoss).toBe(0);
    expect(back.speculativeBranch).toBeNull();
    expect(back.ubsActive).toBe(false);
  });
});

// ---- Monthly tick integration ----

describe('Monthly tick integrates Phase 11 systems', () => {
  it('automation unemployment increases over real game time with ai_automation', () => {
    const r = nationReady();
    setYear(r, 2030);
    r.researched.add('computing'); r.researched.add('automated_logistics'); r.researched.add('ai_automation');
    const before = r.automationUnemployment;
    // Run 2 months of ticks
    runDays(r, 60);
    expect(r.automationUnemployment).toBeGreaterThan(before);
  });
});
