import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/sim';
import { RegionSim, REGION_MINUTES_PER_TICK, TECH_TREE, RAIL_ERA_YEAR, HIGHWAY_ERA_YEAR, MAGLEV_ERA_YEAR } from '../src/sim/region';
import { MINUTES_PER_DAY } from '../src/sim/defs';

const ticksPerDay = MINUTES_PER_DAY / REGION_MINUTES_PER_TICK;

function makeRegion(): RegionSim {
  const sim = new Simulation(42);
  while (sim.settlers.length < 22) sim.spawnSettler(32, 34);
  sim.stock.wood = 200;
  sim.stock.meal = 200;
  return RegionSim.fromTown(sim, 8, 80, 80);
}

function runDays(r: RegionSim, days: number): void {
  for (let i = 0; i < days * ticksPerDay; i++) r.tick();
}

describe('Tech tree: node definitions', () => {
  it('has the expected number of nodes', () => {
    expect(TECH_TREE.length).toBe(17);
  });

  it('start nodes have zero cost and no prereqs', () => {
    const starts = TECH_TREE.filter((n) => n.cost === 0);
    expect(starts.length).toBe(2);
    expect(starts.every((n) => n.prereqs.length === 0)).toBe(true);
    const ids = starts.map((n) => n.id);
    expect(ids).toContain('steam_power');
    expect(ids).toContain('common_law');
  });

  it('each node has a valid tree field', () => {
    for (const n of TECH_TREE) {
      expect(['tech', 'civics']).toContain(n.tree);
    }
  });

  it('all prereqs reference existing node ids', () => {
    const ids = new Set(TECH_TREE.map((n) => n.id));
    for (const n of TECH_TREE) {
      for (const p of n.prereqs) {
        expect(ids.has(p), `${n.id} prereq "${p}" not found`).toBe(true);
      }
    }
  });
});

describe('Tech tree: research state', () => {
  it('starts with steam_power and common_law researched', () => {
    const r = makeRegion();
    expect(r.has('steam_power')).toBe(true);
    expect(r.has('common_law')).toBe(true);
    expect(r.has('steel_industry')).toBe(false);
  });

  it('research rate scales with population', () => {
    const r = makeRegion();
    // add a second settlement with population
    runDays(r, 5); // let expedition arrive and found town #2
    const rate1 = r.researchRate();
    // add more population
    for (const t of r.settlements) t.cohorts.bands[1] += 100;
    const rate2 = r.researchRate();
    expect(rate2).toBeGreaterThan(rate1);
  });

  it('public_education multiplies research rate by 1.5', () => {
    const r = makeRegion();
    const before = r.researchRate();
    r.researched.push('public_education');
    const after = r.researchRate();
    expect(after).toBeCloseTo(before * 1.5, 5);
  });

  it('electrical_grid multiplies research rate by 1.25', () => {
    const r = makeRegion();
    const before = r.researchRate();
    r.researched.push('electrical_grid');
    const after = r.researchRate();
    expect(after).toBeCloseTo(before * 1.25, 5);
  });

  it('both boosts stack multiplicatively', () => {
    const r = makeRegion();
    const before = r.researchRate();
    r.researched.push('public_education', 'electrical_grid');
    const after = r.researchRate();
    expect(after).toBeCloseTo(before * 1.5 * 1.25, 5);
  });
});

describe('Tech tree: availability', () => {
  it('nodes with unmet prereqs are not available', () => {
    const r = makeRegion();
    const available = r.availableToResearch().map((n) => n.id);
    // electrical_grid requires steel_industry which is not researched yet
    expect(available).not.toContain('electrical_grid');
    // mass_production requires electrical_grid AND combustion_engine
    expect(available).not.toContain('mass_production');
  });

  it('nodes with met prereqs and correct era are available', () => {
    const r = makeRegion();
    // steam_power is done; public_education and steel_industry prereqs are met
    const available = r.availableToResearch().map((n) => n.id);
    expect(available).toContain('public_education');
    expect(available).toContain('steel_industry');
  });

  it('nodes with requiresState are locked until state is proclaimed', () => {
    const r = makeRegion();
    expect(r.stateProclaimed).toBe(false);
    const available = r.availableToResearch().map((n) => n.id);
    expect(available).not.toContain('income_tax');
  });

  it('startResearch returns false for a locked node', () => {
    const r = makeRegion();
    const ok = r.startResearch('electrical_grid'); // prereq not met
    expect(ok).toBe(false);
    expect(r.activeResearch).toBeNull();
  });

  it('startResearch returns true for an available node and sets activeResearch', () => {
    const r = makeRegion();
    const ok = r.startResearch('steel_industry');
    expect(ok).toBe(true);
    expect(r.activeResearch).toBe('steel_industry');
    expect(r.researchProgress).toBe(0);
  });

  it('cancelResearch clears the active node', () => {
    const r = makeRegion();
    r.startResearch('steel_industry');
    r.cancelResearch();
    expect(r.activeResearch).toBeNull();
    expect(r.researchProgress).toBe(0);
  });
});

describe('Tech tree: research completion', () => {
  it('completes a node once enough RP have accumulated', () => {
    const r = makeRegion();
    r.startResearch('steel_industry');
    const node = TECH_TREE.find((n) => n.id === 'steel_industry')!;
    // Force progress to just under the cost
    r.researchProgress = node.cost - 0.01;
    // One more daily tick should complete it
    runDays(r, 1);
    expect(r.has('steel_industry')).toBe(true);
    expect(r.activeResearch).toBeNull();
  });

  it('logs a message when a node completes', () => {
    const r = makeRegion();
    r.startResearch('public_education');
    const node = TECH_TREE.find((n) => n.id === 'public_education')!;
    r.researchProgress = node.cost - 0.01;
    const logBefore = r.log.length;
    runDays(r, 1);
    expect(r.log.length).toBeGreaterThan(logBefore);
    const entry = r.log[r.log.length - 1];
    expect(entry.text).toContain('Public Education');
  });

  it('auto-unlocks dependant nodes after prerequisite completes', () => {
    const r = makeRegion();
    // Advance to year 1912 so electrical_grid's era gate is met
    r.minute = (1912 - 1900) * 60 * MINUTES_PER_DAY;
    r.startResearch('steel_industry');
    const node = TECH_TREE.find((n) => n.id === 'steel_industry')!;
    r.researchProgress = node.cost - 0.01;
    runDays(r, 1);
    // electrical_grid needs steel_industry — now available (era 1912 met)
    const available = r.availableToResearch().map((n) => n.id);
    expect(available).toContain('electrical_grid');
  });
});

describe('Tech tree: gameplay effects', () => {
  it('steel_industry unlocks rail 5 years early', () => {
    const r = makeRegion();
    r.stateProclaimed = true;
    r.stateName = 'Test State';
    // Without steel_industry, rail unlocks at RAIL_ERA_YEAR
    // Simulate being 1 year before the normal threshold
    const earlyYear = RAIL_ERA_YEAR - 4;
    // Advance sim to earlyYear
    const targetDay = (earlyYear - 1900) * 60;
    r.minute = targetDay * MINUTES_PER_DAY;
    expect(r.year).toBe(earlyYear);
    expect(r.railUnlocked()).toBe(false);
    // Research steel_industry → now unlocked
    r.researched.push('steel_industry');
    expect(r.railUnlocked()).toBe(true);
  });

  it('without steel_industry rail does NOT unlock before RAIL_ERA_YEAR', () => {
    const r = makeRegion();
    r.stateProclaimed = true;
    r.stateName = 'Test State';
    const targetDay = (RAIL_ERA_YEAR - 1900 - 1) * 60; // one year before
    r.minute = targetDay * MINUTES_PER_DAY;
    expect(r.railUnlocked()).toBe(false);
  });

  it('asphalt unlocks highway 5 years early', () => {
    const r = makeRegion();
    r.stateProclaimed = true;
    r.stateName = 'Test State';
    const earlyYear = HIGHWAY_ERA_YEAR - 4;
    const targetDay = (earlyYear - 1900) * 60;
    r.minute = targetDay * MINUTES_PER_DAY;
    expect(r.highwayUnlocked()).toBe(false);
    r.researched.push('asphalt');
    expect(r.highwayUnlocked()).toBe(true);
  });

  it('computing multiplies research rate by 1.25', () => {
    const r = makeRegion();
    const before = r.researchRate();
    r.researched.push('computing');
    const after = r.researchRate();
    expect(after).toBeCloseTo(before * 1.25, 5);
  });

  it('maglev research unlocks maglev lines 5 years early', () => {
    const r = makeRegion();
    r.stateProclaimed = true;
    r.stateName = 'Test State';
    const earlyYear = MAGLEV_ERA_YEAR - 4;
    const targetDay = (earlyYear - 1900) * 60;
    r.minute = targetDay * MINUTES_PER_DAY;
    expect(r.maglevUnlocked()).toBe(false);
    r.researched.push('maglev');
    expect(r.maglevUnlocked()).toBe(true);
  });

  it('labor_law reduces grievance build rate', () => {
    const r = makeRegion();
    runDays(r, 5); // found town #2
    r.stateProclaimed = true;
    r.stateName = 'Test State';
    r.govLean = 'council';
    r.taxRate = 0.25; // high tax to generate grievance

    // Run 30 days WITHOUT labor_law
    const r2 = makeRegion();
    runDays(r2, 5);
    r2.stateProclaimed = true;
    r2.stateName = 'Test State';
    r2.govLean = 'council';
    r2.taxRate = 0.25;

    for (const t of r.settlements) t.grievance = 0;
    for (const t of r2.settlements) t.grievance = 0;

    // Give labor_law to r but not r2
    r.researched.push('labor_law');
    runDays(r, 30);
    runDays(r2, 30);

    const grievanceWith = r.settlements.reduce((s, t) => s + t.grievance, 0);
    const grievanceWithout = r2.settlements.reduce((s, t) => s + t.grievance, 0);
    expect(grievanceWith).toBeLessThan(grievanceWithout);
  });

  it('income_tax adds 3% of GDP to treasury each month', () => {
    const r = makeRegion();
    runDays(r, 5);
    r.stateProclaimed = true;
    r.stateName = 'Test State';
    r.govLean = 'council';
    r.taxRate = 0.1;
    r.gdpLastMonth = 100;
    r.treasury = 0;

    const r2 = makeRegion();
    runDays(r2, 5);
    r2.stateProclaimed = true;
    r2.stateName = 'Test State';
    r2.govLean = 'council';
    r2.taxRate = 0.1;
    r2.gdpLastMonth = 100;
    r2.treasury = 0;

    r.researched.push('income_tax');
    // Run exactly 30 days so monthly economy fires once
    runDays(r, 30);
    runDays(r2, 30);

    expect(r.treasury).toBeGreaterThan(r2.treasury);
  });
});

describe('Tech tree: save/load round-trip', () => {
  it('research state survives serialize/deserialize', () => {
    const sim = new Simulation(42);
    while (sim.settlers.length < 22) sim.spawnSettler(32, 34);
    sim.stock.wood = 200;
    sim.stock.meal = 200;
    const r = RegionSim.fromTown(sim, 8, 80, 80);
    r.researched.push('steel_industry');
    // public_education has era 1900 and prereq common_law — available from start
    r.startResearch('public_education');
    r.researchProgress = 42;

    const json = r.serialize();
    const r2 = RegionSim.deserialize(json, sim);
    expect(r2.has('steel_industry')).toBe(true);
    expect(r2.activeResearch).toBe('public_education');
    expect(r2.researchProgress).toBeCloseTo(42);
  });

  it('old saves without research fields load with defaults', () => {
    const sim = new Simulation(42);
    while (sim.settlers.length < 22) sim.spawnSettler(32, 34);
    sim.stock.wood = 200;
    sim.stock.meal = 200;
    const r = RegionSim.fromTown(sim, 8, 80, 80);
    const raw = JSON.parse(r.serialize());
    delete raw.researched;
    delete raw.activeResearch;
    delete raw.researchProgress;
    const r2 = RegionSim.deserialize(JSON.stringify(raw), sim);
    expect(r2.researched).toContain('steam_power');
    expect(r2.researched).toContain('common_law');
    expect(r2.activeResearch).toBeNull();
    expect(r2.researchProgress).toBe(0);
  });
});
