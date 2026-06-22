/**
 * Phase 18: Advisor System Depth (GDD §8.7)
 * Tests for skill-based forecast accuracy, ideology-biased advice,
 * advisor briefs queue, loyalty/betrayal, and portfolio-specific events.
 */
import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/sim';
import { RegionSim, MINISTER_ROLES, REGION_MINUTES_PER_TICK } from '../src/sim/region';
import { MINUTES_PER_DAY } from '../src/sim/defs';

const ticksPerDay = MINUTES_PER_DAY / REGION_MINUTES_PER_TICK;

function runDays(r: RegionSim, days: number): void {
  for (let i = 0; i < days * ticksPerDay; i++) r.tick();
}

/** Build a minimal flipped region. */
function flipped(seed: number): RegionSim {
  const sim = new Simulation(seed);
  while (sim.settlers.length < 22) sim.spawnSettler(48, 50);
  sim.stock.wood = 200;
  sim.stock.meal = 200;
  const r = RegionSim.fromTown(sim, 8, 80, 80);
  runDays(r, 5);
  return r;
}

/** Advance the region to nation-proclaimed state quickly for testing. */
function nationReady(seed = 42): RegionSim {
  const r = flipped(seed);
  r.stateProclaimed = true;
  r.stateName = 'Testonia';
  r.govLean = 'council';
  r.treasury = 500000;
  r.researched.push('statecraft', 'universal_suffrage', 'income_tax', 'free_press', 'labor_law', 'public_education');
  // Ensure 3+ settlements for tests that need them
  for (let i = r.settlements.length; i < 3; i++) {
    const home = r.settlements[0];
    if (r.canFoundTown(home.id).ok) r.foundTown(home.id);
  }
  runDays(r, 5);
  r.proclaimNation('Testonia', 'democracy', {});
  return r;
}

/** Assign a notable as minister for a role with given skill. */
function assignMinister(r: RegionSim, role: RegionSim['ministers'][0]['role'], skill: number): void {
  let notable = r.notables.find((n) => n.alive && !r.ministers.some((m) => m.notableId === n.id));
  if (!notable) {
    // Mint a notable if none available
    notable = {
      id: 99999 + Math.floor(Math.random() * 1000),
      name: 'Test Minister',
      age: 40,
      traits: [],
      role: 'Mayor',
      settlementId: r.settlements[0].id,
      bio: [],
      alive: true,
      loyalty: 100,
      monthsIgnored: 0,
      skill,
      factionAlignment: 'merchants',
    };
    r.notables.push(notable);
  }
  notable.skill = skill;
  notable.loyalty = 100;
  notable.monthsIgnored = 0;
  const m = r.ministers.find((x) => x.role === role);
  if (m) m.notableId = notable.id;
}

// ---- 1. advisorForecast with skill=100 returns value close to true (within 5%) ----
describe('Phase 18 — advisorForecast (GDD §8.7)', () => {
  it('high skill (100) returns value within 5% of true value', () => {
    const r = nationReady();
    assignMinister(r, 'treasury', 100);
    const trueValue = 10000;
    // Run 30 trials; all should be very close
    let allClose = true;
    for (let i = 0; i < 30; i++) {
      const est = r.advisorForecast('Finance', trueValue);
      if (Math.abs(est - trueValue) / trueValue > 0.05) {
        allClose = false;
        break;
      }
    }
    expect(allClose).toBe(true);
  });

  it('low skill (0) can return value far from true (high variance)', () => {
    const r = nationReady();
    assignMinister(r, 'treasury', 0);
    const trueValue = 10000;
    // Run many trials; at least one should deviate >10%
    let anyFar = false;
    for (let i = 0; i < 100; i++) {
      const est = r.advisorForecast('Finance', trueValue);
      if (Math.abs(est - trueValue) / trueValue > 0.10) {
        anyFar = true;
        break;
      }
    }
    expect(anyFar).toBe(true);
  });

  it('no minister gives very wide noise range', () => {
    const r = nationReady();
    // Ensure no treasury minister
    const m = r.ministers.find((x) => x.role === 'treasury');
    if (m) m.notableId = null;
    const trueValue = 10000;
    let anyFar = false;
    for (let i = 0; i < 100; i++) {
      const est = r.advisorForecast('Finance', trueValue);
      if (Math.abs(est - trueValue) / trueValue > 0.20) {
        anyFar = true;
        break;
      }
    }
    expect(anyFar).toBe(true);
  });
});

// ---- 2. biasedForecast ideology bias ----
describe('Phase 18 — biasedForecast ideology bias', () => {
  it('War minister returns approximately 75% of true occupation cost', () => {
    const r = nationReady();
    assignMinister(r, 'war', 100); // perfect skill so noise ~0
    const trueValue = 10000;
    // With skill=100, noise is very small; bias should dominate
    let avgBias = 0;
    const trials = 20;
    for (let i = 0; i < trials; i++) {
      avgBias += r.biasedForecast('War', trueValue, 'occupationCost');
    }
    avgBias /= trials;
    // Should be close to 75% = 7500 (within 10% accounting for skill noise)
    expect(avgBias).toBeGreaterThan(6000);
    expect(avgBias).toBeLessThan(9000);
  });

  it('Press minister returns approximately 60% of true credibility gap', () => {
    const r = nationReady();
    assignMinister(r, 'press', 100);
    const trueValue = 10000;
    let avgBias = 0;
    const trials = 20;
    for (let i = 0; i < trials; i++) {
      avgBias += r.biasedForecast('Press', trueValue, 'credibilityGap');
    }
    avgBias /= trials;
    // Should be close to 60% = 6000 (within 10% accounting for noise)
    expect(avgBias).toBeGreaterThan(4500);
    expect(avgBias).toBeLessThan(7500);
  });

  it('Interior minister returns approximately 130% of true risk value', () => {
    const r = nationReady();
    assignMinister(r, 'interior', 100);
    const trueValue = 10000;
    let avgBias = 0;
    const trials = 20;
    for (let i = 0; i < trials; i++) {
      avgBias += r.biasedForecast('Interior', trueValue, 'unreachRisk');
    }
    avgBias /= trials;
    // Should be close to 130% = 13000 (within 10%)
    expect(avgBias).toBeGreaterThan(10000);
    expect(avgBias).toBeLessThan(16000);
  });
});

// ---- 3. generateAdvisorBriefs — threshold conditions ----
describe('Phase 18 — generateAdvisorBriefs', () => {
  it('generates Treasury brief when projected debt service > 20% of revenue', () => {
    const r = nationReady();
    // Set up conditions: large debt, high bond rate, low revenue
    r.gdpLastMonth = 100;
    r.taxRate = 0.1;
    r.nationalDebt = 100000; // enormous debt relative to GDP
    r.passedLaws.push('central_bank_charter');
    r.generateAdvisorBriefs();
    const treasuryBrief = r.advisorBriefs.find((b) => b.portfolio === 'Treasury');
    expect(treasuryBrief).toBeDefined();
    expect(treasuryBrief?.message).toContain('debt service');
  });

  it('generates Foreign Affairs brief when rival relations < -40', () => {
    const r = nationReady();
    // Add a hostile rival
    r.rivals.push({
      id: 1001,
      name: 'Hostilia',
      flag: '#f00',
      relations: -50,
      treaties: [],
      regime: 'junta',
      personality: 'hegemon',
      weights: { expansion: 9, commerce: 4, ideology: 5, honor: 4, risk: 7, grudge: 5 },
      lastEnvoyDay: -999,
      lastGiftDay: -999,
      pop: 100000,
      gdp: 5000,
      reputation: 50,
      history: [],
      lastAiDay: -999,
      borderSettled: false,
    } as never);
    r.generateAdvisorBriefs();
    const foreignBrief = r.advisorBriefs.find((b) => b.portfolio === 'Foreign Affairs');
    expect(foreignBrief).toBeDefined();
    expect(foreignBrief?.message).toContain('Hostilia');
  });

  it('brief not re-generated for same portfolio within 12 months', () => {
    const r = nationReady();
    r.gdpLastMonth = 100;
    r.taxRate = 0.1;
    r.nationalDebt = 100000;
    r.passedLaws.push('central_bank_charter');
    r.generateAdvisorBriefs();
    const countAfterFirst = r.advisorBriefs.filter((b) => b.portfolio === 'Treasury').length;
    // Try again immediately (within 12 months)
    r.generateAdvisorBriefs();
    const countAfterSecond = r.advisorBriefs.filter((b) => b.portfolio === 'Treasury').length;
    expect(countAfterSecond).toBe(countAfterFirst); // no duplicate
  });

  it('generates Interior brief when 3+ settlements have low satisfaction + housing shortage', () => {
    const r = nationReady();
    // Ensure 3 settlements exist with poor conditions
    while (r.settlements.length < 3) runDays(r, 15);
    for (const t of r.settlements.slice(0, 3)) {
      t.satisfaction = 20;
      t.housing = 5;
      t.cohorts.bands[2] = 100; // overpopulated
    }
    r.generateAdvisorBriefs();
    const interiorBrief = r.advisorBriefs.find((b) => b.portfolio === 'Interior');
    expect(interiorBrief).toBeDefined();
    expect(interiorBrief?.message).toContain('settlements');
  });
});

// ---- 4. tickAdvisorLoyalty — monthly decay and defection ----
describe('Phase 18 — tickAdvisorLoyalty', () => {
  it('decrements loyalty when monthsIgnored >= 3', () => {
    const r = nationReady();
    assignMinister(r, 'interior', 60);
    const m = r.ministers.find((x) => x.role === 'interior')!;
    const notable = r.notables.find((n) => n.id === m.notableId)!;
    notable.loyalty = 50;
    notable.monthsIgnored = 3;
    // Set last action to far in the past (> 3 months ago)
    r.lastActionDay['interior'] = r.day - 100;
    r.tickAdvisorLoyalty();
    expect(notable.loyalty).toBeLessThan(50);
  });

  it('does not decrement loyalty when player acted recently', () => {
    const r = nationReady();
    assignMinister(r, 'interior', 60);
    const m = r.ministers.find((x) => x.role === 'interior')!;
    const notable = r.notables.find((n) => n.id === m.notableId)!;
    notable.loyalty = 80;
    notable.monthsIgnored = 0;
    // Recent action
    r.lastActionDay['interior'] = r.day - 10;
    r.tickAdvisorLoyalty();
    expect(notable.loyalty).toBe(80); // unchanged (no months ignored, no decay yet)
  });

  it('defection fires when loyalty is very low', () => {
    const r = nationReady();
    assignMinister(r, 'interior', 60);
    const m = r.ministers.find((x) => x.role === 'interior')!;
    const notable = r.notables.find((n) => n.id === m.notableId)!;
    notable.loyalty = 5; // critically low
    notable.monthsIgnored = 10;
    notable.factionAlignment = 'workers';
    r.lastActionDay['interior'] = r.day - 1000;
    // Run many ticks to trigger the 3% chance
    let defected = false;
    for (let i = 0; i < 200; i++) {
      r.tickAdvisorLoyalty();
      if (r.log.some((l) => l.text.includes('defected'))) {
        defected = true;
        break;
      }
    }
    expect(defected).toBe(true);
  });

  it('recordPortfolioAction resets monthsIgnored and boosts loyalty', () => {
    const r = nationReady();
    assignMinister(r, 'interior', 60);
    const m = r.ministers.find((x) => x.role === 'interior')!;
    const notable = r.notables.find((n) => n.id === m.notableId)!;
    notable.loyalty = 50;
    notable.monthsIgnored = 5;
    r.recordPortfolioAction('interior');
    expect(notable.monthsIgnored).toBe(0);
    expect(notable.loyalty).toBeGreaterThan(50);
  });
});

// ---- 5. Portfolio-specific events ----
describe('Phase 18 — portfolio-specific events', () => {
  it('research bottleneck fires when 3+ settlements lack schoolhouse', () => {
    const r = nationReady();
    // Ensure 3+ settlements without schoolhouse
    while (r.settlements.length < 3) runDays(r, 15);
    for (const t of r.settlements) {
      t.buildings = t.buildings.filter((b) => b !== 'schoolhouse');
    }
    // Reset the flag (may have been set during setup by monthly tick)
    r.researchBottleneckActive = false;
    r.log.length = 0; // clear log to check for the new event
    // Force the tick
    (r as unknown as { tickAdvisorEvents: () => void }).tickAdvisorEvents();
    expect(r.researchBottleneckActive).toBe(true);
    expect(r.log.some((l) => l.text.includes('SCIENCE MINISTRY'))).toBe(true);
  });

  it('research bottleneck clears when settlements get schools', () => {
    const r = nationReady();
    while (r.settlements.length < 3) runDays(r, 15);
    r.researchBottleneckActive = true;
    // Give all settlements a schoolhouse
    for (const t of r.settlements) {
      if (!t.buildings.includes('schoolhouse')) t.buildings.push('schoolhouse');
    }
    (r as unknown as { tickAdvisorEvents: () => void }).tickAdvisorEvents();
    expect(r.researchBottleneckActive).toBe(false);
  });

  it('research bottleneck penalty reduces researchRate()', () => {
    const r = nationReady();
    r.researchBottleneckActive = false;
    const rateWithout = r.researchRate();
    r.researchBottleneckActive = true;
    const rateWith = r.researchRate();
    expect(rateWith).toBeLessThan(rateWithout);
    expect(rateWith / rateWithout).toBeCloseTo(0.9, 1);
  });

  it('foreign secretary event fires and reduces relations when rival is cold', () => {
    const r = nationReady();
    const rival = {
      id: 2001,
      name: 'Coldria',
      flag: '#00f',
      relations: -35,
      treaties: [],
      regime: 'junta',
      personality: 'hegemon',
      weights: { expansion: 9, commerce: 4, ideology: 5, honor: 4, risk: 7, grudge: 5 },
      lastEnvoyDay: -999,
      lastGiftDay: -999,
      pop: 50000,
      gdp: 3000,
      reputation: 50,
      history: [],
      lastAiDay: -999,
      borderSettled: false,
    };
    r.rivals.push(rival as never);
    const initialRelations = rival.relations;
    // Force 100% chance for testing
    let eventFired = false;
    for (let i = 0; i < 200 && !eventFired; i++) {
      (r as unknown as { tickAdvisorEvents: () => void }).tickAdvisorEvents();
      if (r.log.some((l) => l.text.includes('FOREIGN SECRETARY'))) {
        eventFired = true;
      }
    }
    expect(eventFired).toBe(true);
    expect(rival.relations).toBeLessThan(initialRelations);
  });
});

// ---- 6. Serialize/deserialize round-trip ----
describe('Phase 18 — serialize/deserialize round-trip', () => {
  it('advisorBriefs survive save/load', () => {
    const sim = new Simulation(42);
    while (sim.settlers.length < 22) sim.spawnSettler(48, 50);
    sim.stock.wood = 200;
    sim.stock.meal = 200;
    const r = RegionSim.fromTown(sim, 8, 80, 80);
    r.stateProclaimed = true;
    r.nationProclaimed = true;
    r.advisorBriefs = [{ portfolio: 'Treasury', message: 'Test brief', day: 100 }];
    const r2 = RegionSim.deserialize(r.serialize(), sim);
    expect(r2.advisorBriefs).toHaveLength(1);
    expect(r2.advisorBriefs[0].portfolio).toBe('Treasury');
    expect(r2.advisorBriefs[0].message).toBe('Test brief');
  });

  it('advisorBriefLastDay survives save/load', () => {
    const sim = new Simulation(42);
    while (sim.settlers.length < 22) sim.spawnSettler(48, 50);
    sim.stock.wood = 200;
    sim.stock.meal = 200;
    const r = RegionSim.fromTown(sim, 8, 80, 80);
    r.advisorBriefLastDay = { Treasury: 500, Interior: 1200 };
    const r2 = RegionSim.deserialize(r.serialize(), sim);
    expect(r2.advisorBriefLastDay['Treasury']).toBe(500);
    expect(r2.advisorBriefLastDay['Interior']).toBe(1200);
  });

  it('lastActionDay survives save/load', () => {
    const sim = new Simulation(42);
    while (sim.settlers.length < 22) sim.spawnSettler(48, 50);
    sim.stock.wood = 200;
    sim.stock.meal = 200;
    const r = RegionSim.fromTown(sim, 8, 80, 80);
    r.lastActionDay = { treasury: 300, interior: 600 };
    const r2 = RegionSim.deserialize(r.serialize(), sim);
    expect(r2.lastActionDay['treasury']).toBe(300);
    expect(r2.lastActionDay['interior']).toBe(600);
  });

  it('researchBottleneckActive survives save/load', () => {
    const sim = new Simulation(42);
    while (sim.settlers.length < 22) sim.spawnSettler(48, 50);
    sim.stock.wood = 200;
    sim.stock.meal = 200;
    const r = RegionSim.fromTown(sim, 8, 80, 80);
    r.researchBottleneckActive = true;
    const r2 = RegionSim.deserialize(r.serialize(), sim);
    expect(r2.researchBottleneckActive).toBe(true);
  });

  it('pre-Phase-18 saves backfill new fields gracefully', () => {
    const sim = new Simulation(42);
    while (sim.settlers.length < 22) sim.spawnSettler(48, 50);
    sim.stock.wood = 200;
    sim.stock.meal = 200;
    const r = RegionSim.fromTown(sim, 8, 80, 80);
    // Simulate a pre-Phase-18 save by stripping the new fields from JSON
    const raw = JSON.parse(r.serialize());
    delete raw.advisorBriefs;
    delete raw.advisorBriefLastDay;
    delete raw.lastActionDay;
    delete raw.researchBottleneckActive;
    const r2 = RegionSim.deserialize(JSON.stringify(raw), sim);
    expect(r2.advisorBriefs).toEqual([]);
    expect(r2.advisorBriefLastDay).toEqual({});
    expect(r2.lastActionDay).toEqual({});
    expect(r2.researchBottleneckActive).toBe(false);
  });

  it('Notable loyalty and skill fields survive save/load', () => {
    const sim = new Simulation(42);
    while (sim.settlers.length < 22) sim.spawnSettler(48, 50);
    sim.stock.wood = 200;
    sim.stock.meal = 200;
    const r = RegionSim.fromTown(sim, 8, 80, 80);
    const notable = r.notables[0];
    notable.loyalty = 75;
    notable.skill = 88;
    notable.monthsIgnored = 2;
    notable.factionAlignment = 'landowners';
    const r2 = RegionSim.deserialize(r.serialize(), sim);
    const n2 = r2.notables.find((n) => n.id === notable.id)!;
    expect(n2.loyalty).toBe(75);
    expect(n2.skill).toBe(88);
    expect(n2.monthsIgnored).toBe(2);
    expect(n2.factionAlignment).toBe('landowners');
  });

  it('new minister roles (7 total) survive save/load', () => {
    const sim = new Simulation(42);
    while (sim.settlers.length < 22) sim.spawnSettler(48, 50);
    sim.stock.wood = 200;
    sim.stock.meal = 200;
    const r = RegionSim.fromTown(sim, 8, 80, 80);
    expect(r.ministers).toHaveLength(7);
    const r2 = RegionSim.deserialize(r.serialize(), sim);
    expect(r2.ministers).toHaveLength(7);
    const roles = r2.ministers.map((m) => m.role);
    expect(roles).toContain('interior');
    expect(roles).toContain('treasury');
    expect(roles).toContain('defence');
    expect(roles).toContain('war');
    expect(roles).toContain('press');
    expect(roles).toContain('science');
    expect(roles).toContain('foreign');
  });
});

// ---- 7. advisorBriefs queue cap ----
describe('Phase 18 — advisor briefs queue mechanics', () => {
  it('briefs queue is capped at 5 entries (drops oldest)', () => {
    const r = nationReady();
    // Push 6 briefs for different portfolios
    const portfolios = ['Treasury', 'Interior', 'Science', 'Foreign Affairs', 'Press', 'Economy'];
    for (const p of portfolios) {
      // Bypass the cooldown by manipulating lastBriefDay
      r.advisorBriefLastDay[p] = -99999;
      (r as unknown as { pushAdvisorBrief: (p: string, m: string) => void }).pushAdvisorBrief(p, `Brief from ${p}`);
    }
    expect(r.advisorBriefs).toHaveLength(5);
    // Newest should be first
    expect(r.advisorBriefs[0].portfolio).toBe('Economy');
  });

  it('dismissAdvisorBriefs clears all briefs', () => {
    const r = nationReady();
    r.advisorBriefs = [
      { portfolio: 'Treasury', message: 'A', day: 1 },
      { portfolio: 'Interior', message: 'B', day: 2 },
    ];
    r.dismissAdvisorBriefs();
    expect(r.advisorBriefs).toHaveLength(0);
  });
});
