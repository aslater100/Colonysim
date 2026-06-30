import { describe, it, expect } from 'vitest';
import { RegionSim, CO2_BASE_PPM, SEA_WALL_YEAR, REGION_MINUTES_PER_TICK } from '../src/sim/region';
import { MINUTES_PER_DAY, DAYS_PER_YEAR, START_YEAR } from '../src/sim/defs';
import { tickClimate } from '../src/sim/systems/climate';

const ticksPerDay = MINUTES_PER_DAY / REGION_MINUTES_PER_TICK;

function makeNation(seed = 42): RegionSim {
  const r = RegionSim.create(seed);
  r.stateProclaimed = true;
  r.nationProclaimed = true;
  r.govType = 'republic';
  r.legitimacy = 60;
  r.activePolicies = [];
  r.treasury = 5000;
  r.passedLaws.add('central_bank_charter');
  return r;
}

function runMonth(r: RegionSim): void {
  for (let i = 0; i < 30 * ticksPerDay; i++) r.tick();
}

function setYear(r: RegionSim, year: number): void {
  r.minute = (year - START_YEAR) * DAYS_PER_YEAR * MINUTES_PER_DAY;
}

function getCoastalSettlement(r: RegionSim) {
  for (let i = 0; i < 200 && r.settlements.length < 3; i++) {
    runMonth(r);
  }
  return r.settlements.find((t) => t.site.coastal && t.factionId === r.playerFactionId);
}

// ---- Emissions & CO₂ accumulation ----

describe('Climate: CO₂ accumulation', () => {
  it('co2ppm starts at baseline', () => {
    const r = RegionSim.create(1);
    expect(r.co2ppm).toBe(CO2_BASE_PPM);
  });

  it('co2ppm rises each month as emissions are added', () => {
    const r = makeNation();
    const before = r.co2ppm;
    runMonth(r);
    expect(r.co2ppm).toBeGreaterThan(before);
  });

  it('playerEmissions() is positive with base tech', () => {
    const r = makeNation();
    expect(r.playerEmissions()).toBeGreaterThan(0);
  });

  it('playerEmissions() increases with heavy industry research', () => {
    const r = makeNation();
    const base = r.playerEmissions();
    r.researched.add('combustion_engine');
    r.researched.add('mass_production');
    expect(r.playerEmissions()).toBeGreaterThan(base);
  });

  it('playerEmissions() decreases with green tech', () => {
    const r = makeNation();
    r.researched.add('combustion_engine');
    r.researched.add('mass_production');
    const dirty = r.playerEmissions();
    r.researched.add('renewables');
    r.researched.add('fusion_power');
    expect(r.playerEmissions()).toBeLessThan(dirty);
  });

  it('worldEmissions() is positive', () => {
    const r = makeNation();
    expect(r.worldEmissions()).toBeGreaterThan(0);
  });
});

// ---- Warming lag ----

describe('Climate: warming lag', () => {
  it('warmingC starts at 0', () => {
    const r = RegionSim.create(1);
    expect(r.warmingC).toBe(0);
  });

  it('warmingC lags behind CO₂ accumulation (is less than equilibrium)', () => {
    const r = makeNation();
    // Force emissions up
    r.researched.add('combustion_engine');
    r.researched.add('mass_production');
    r.researched.add('electrical_grid');
    // Run for 10 simulated years
    for (let i = 0; i < 120; i++) runMonth(r);
    const equilibrium = Math.max(0, (r.co2ppm - CO2_BASE_PPM) * 0.011);
    // warmingC should be less than equilibrium (the ~20-year lag)
    expect(r.warmingC).toBeGreaterThan(0);
    expect(r.warmingC).toBeLessThan(equilibrium);
  });

  it('projectedWarming() exceeds current warmingC when emissions are ongoing', () => {
    const r = makeNation();
    r.researched.add('combustion_engine');
    for (let i = 0; i < 24; i++) runMonth(r);
    expect(r.projectedWarming()).toBeGreaterThan(r.warmingC);
  });
});

// ---- Sea-rise announcement ----

describe('Climate: sea-rise announcement', () => {
  it('seaRiseAnnounced starts false', () => {
    const r = RegionSim.create(1);
    expect(r.seaRiseAnnounced).toBe(false);
  });

  it('seaRiseAnnounced fires when warmingC >= 1.2 and a coastal settlement exists', () => {
    const r = makeNation();
    // Manually force conditions: set warmingC just above threshold and ensure
    // a coastal settlement exists
    const coastal = r.settlements.find((t) => t.site.coastal);
    if (!coastal) {
      // Force-add a coastal site to the first settlement
      r.settlements[0].site = { ...r.settlements[0].site, coastal: true };
    }
    r.warmingC = 1.25;
    tickClimate(r);
    expect(r.seaRiseAnnounced).toBe(true);
    expect(r.log.some((l) => l.text.includes('waterline'))).toBe(true);
  });
});

// ---- Sea wall ----

describe('Climate: sea wall', () => {
  it('buildSeaWall() requires year >= SEA_WALL_YEAR', () => {
    const r = makeNation();
    setYear(r, SEA_WALL_YEAR - 5);
    const coastal = r.settlements.find((t) => t.site.coastal);
    if (!coastal) {
      r.settlements[0].site = { ...r.settlements[0].site, coastal: true };
    }
    const target = r.settlements.find((t) => t.site.coastal)!;
    const ok = r.buildSeaWall(target.id);
    expect(ok).toBe(false);
  });

  it('buildSeaWall() sets seaWall = true and deducts treasury', () => {
    const r = makeNation();
    setYear(r, SEA_WALL_YEAR + 1);
    // Ensure a coastal settlement for the player
    const target = r.settlements.find((t) => t.site.coastal && t.factionId === r.playerFactionId)
      ?? r.settlements[0];
    target.site = { ...target.site, coastal: true };
    r.treasury = 2000;
    const before = r.treasury;
    const ok = r.buildSeaWall(target.id);
    expect(ok).toBe(true);
    expect(target.seaWall).toBe(true);
    expect(r.treasury).toBeLessThan(before);
  });

  it('buildSeaWall() cannot be built twice on the same settlement', () => {
    const r = makeNation();
    setYear(r, SEA_WALL_YEAR + 1);
    const target = r.settlements[0];
    target.site = { ...target.site, coastal: true };
    r.treasury = 5000;
    r.buildSeaWall(target.id);
    const after = r.treasury;
    const ok2 = r.buildSeaWall(target.id);
    expect(ok2).toBe(false);
    expect(r.treasury).toBe(after); // no double charge
  });
});

// ---- Flood-proofing ----

describe('Climate: flood-proofing', () => {
  it('canFloodProof() returns false before year 2020', () => {
    const r = makeNation();
    setYear(r, 1950);
    const target = r.settlements[0];
    target.site = { ...target.site, coastal: true };
    expect(r.canFloodProof(target.id)).toBe(false);
  });

  it('buildFloodProof() sets floodProofed and charges treasury', () => {
    const r = makeNation();
    setYear(r, 2022);
    const target = r.settlements[0];
    target.site = { ...target.site, coastal: true };
    r.treasury = 2000;
    const before = r.treasury;
    const ok = r.buildFloodProof(target.id);
    expect(ok).toBe(true);
    expect(target.floodProofed).toBe(true);
    expect(r.treasury).toBeLessThan(before);
  });

  it('buildFloodProof() fails if seaWall already present', () => {
    const r = makeNation();
    setYear(r, 2022);
    const target = r.settlements[0];
    target.site = { ...target.site, coastal: true };
    target.seaWall = true;
    r.treasury = 2000;
    expect(r.buildFloodProof(target.id)).toBe(false);
    expect(target.floodProofed).toBeFalsy();
  });

  it('flood-proofed settlement takes halved tidal damage', () => {
    const r = makeNation();
    setYear(r, 2040);
    const target = r.settlements[0];
    target.site = { ...target.site, coastal: true };
    target.satisfaction = 60;
    target.food = 500;

    // Base damage (no protection)
    const base = RegionSim.create(42);
    base.stateProclaimed = true;
    base.nationProclaimed = true;
    base.govType = 'republic';
    setYear(base, 2040);
    const baseTarget = base.settlements[0];
    baseTarget.site = { ...baseTarget.site, coastal: true };
    baseTarget.satisfaction = 60;
    baseTarget.food = 500;
    base.warmingC = 2.0;
    tickClimate(base);
    const baseSatLoss = 60 - baseTarget.satisfaction;

    // Flood-proofed damage
    target.floodProofed = true;
    r.warmingC = 2.0;
    tickClimate(r);
    const satLoss = 60 - target.satisfaction;

    expect(satLoss).toBeLessThan(baseSatLoss);
    expect(satLoss).toBeLessThanOrEqual(baseSatLoss * 0.6); // roughly halved
  });
});

// ---- Managed retreat ----

describe('Climate: managed retreat', () => {
  it('canManagedRetreat() returns false before year 2025', () => {
    const r = makeNation();
    setYear(r, 2010);
    const target = r.settlements[0];
    target.site = { ...target.site, coastal: true };
    expect(r.canManagedRetreat(target.id)).toBe(false);
  });

  it('doManagedRetreat() removes coastal status and hits satisfaction', () => {
    const r = makeNation();
    setYear(r, 2030);
    const target = r.settlements[0];
    target.site = { ...target.site, coastal: true };
    target.satisfaction = 60;
    target.grievance = 20;
    r.treasury = 5000;
    const ok = r.doManagedRetreat(target.id);
    expect(ok).toBe(true);
    expect(target.site.coastal).toBe(false);
    expect(target.satisfaction).toBeLessThan(60);
    expect(target.grievance).toBeGreaterThan(20);
  });

  it('doManagedRetreat() fails if treasury too low', () => {
    const r = makeNation();
    setYear(r, 2030);
    const target = r.settlements[0];
    target.site = { ...target.site, coastal: true };
    r.treasury = 1; // not enough
    const ok = r.doManagedRetreat(target.id);
    expect(ok).toBe(false);
    expect(target.site.coastal).toBe(true); // unchanged
  });

  it('doManagedRetreat() prevents future tidal flooding', () => {
    const r = makeNation();
    setYear(r, 2040);
    const target = r.settlements[0];
    target.site = { ...target.site, coastal: true };
    target.satisfaction = 80;
    r.treasury = 5000;
    r.doManagedRetreat(target.id);
    const satAfterRetreat = target.satisfaction;
    // Now force a high-warming tick — shouldn't damage the retreated settlement
    r.warmingC = 2.5;
    tickClimate(r);
    // Settlement is no longer coastal so flood loop skips it
    expect(target.satisfaction).toBeGreaterThanOrEqual(satAfterRetreat);
  });
});

// ---- Accord serialization ----

describe('Climate: serialization round-trip', () => {
  it('seaRiseAnnounced survives serialize/deserialize', () => {
    const r = makeNation();
    r.seaRiseAnnounced = true;
    const json = r.serialize();
    const r2 = RegionSim.deserialize(json);
    expect(r2.seaRiseAnnounced).toBe(true);
  });

  it('floodProofed survives serialize/deserialize', () => {
    const r = makeNation();
    setYear(r, 2022);
    const target = r.settlements[0];
    target.site = { ...target.site, coastal: true };
    r.treasury = 2000;
    r.buildFloodProof(target.id);
    expect(target.floodProofed).toBe(true);
    const json = r.serialize();
    const r2 = RegionSim.deserialize(json);
    const t2 = r2.settlements.find((s) => s.id === target.id)!;
    expect(t2.floodProofed).toBe(true);
  });

  it('accordCompliance survives serialize/deserialize with rival data', () => {
    const r = makeNation();
    r.accordCompliance[99] = 0.72;
    const json = r.serialize();
    const r2 = RegionSim.deserialize(json);
    expect(r2.accordCompliance[99]).toBeCloseTo(0.72, 5);
  });

  it('co2ppm and warmingC survive round-trip', () => {
    const r = makeNation();
    for (let i = 0; i < 24; i++) runMonth(r);
    const ppm = r.co2ppm;
    const warm = r.warmingC;
    const json = r.serialize();
    const r2 = RegionSim.deserialize(json);
    expect(r2.co2ppm).toBeCloseTo(ppm, 5);
    expect(r2.warmingC).toBeCloseTo(warm, 5);
  });
});
