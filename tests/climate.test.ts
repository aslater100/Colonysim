import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/sim';
import {
  RegionSim, REGION_MINUTES_PER_TICK, CO2_BASE_PPM, SEA_WALL_YEAR, BRANCH_YEAR, CENTURY_YEAR,
  ACCORD_DEFECT_THRESHOLD, GEOENGINEER_COOLING, GEOENGINEER_DURATION_DAYS,
} from '../src/sim/region';
import { MINUTES_PER_DAY, DAYS_PER_YEAR, START_YEAR } from '../src/sim/defs';

const ticksPerDay = MINUTES_PER_DAY / REGION_MINUTES_PER_TICK;

function grow(sim: Simulation): void {
  while (sim.settlers.length < 22) sim.spawnSettler(32, 34);
  sim.stock.wood = 200;
  sim.stock.meal = 200;
}

function runDays(r: RegionSim, days: number): void {
  for (let i = 0; i < days * ticksPerDay; i++) r.tick();
}

function flippedPair(seed: number): { sim: Simulation; r: RegionSim } {
  const sim = new Simulation(seed);
  grow(sim);
  const r = RegionSim.fromTown(sim, 8, 80, 80);
  runDays(r, 12);
  return { sim, r };
}

function nationReady(seed = 42): RegionSim {
  const { r } = flippedPair(seed);
  r.stateProclaimed = true;
  r.stateName = 'Testonia';
  r.govLean = 'council';
  r.treasury = 500;
  r.proclaimNation('Testland', 'democracy', {});
  return r;
}

/** Park the calendar at a given year (1 Jan equivalent). */
function setYear(r: RegionSim, year: number): void {
  r.minute = (year - START_YEAR) * DAYS_PER_YEAR * MINUTES_PER_DAY;
}

const climateTick = (r: RegionSim) => (r as unknown as { tickClimate(): void }).tickClimate();

describe('The global ledger (GDD §8.2)', () => {
  it('starts at the 1900 baseline and rises with every climate tick', () => {
    const { r } = flippedPair(42);
    const before = r.co2ppm;
    expect(before).toBeCloseTo(CO2_BASE_PPM, 0); // within a whisker of the 1900 baseline
    climateTick(r);
    expect(r.co2ppm).toBeGreaterThan(before);
    expect(r.emissionsLastMonth).toBeGreaterThan(0);
  });

  it('the world out-emits the player: one green nation cannot solo-fix the sky', () => {
    const r = nationReady();
    setYear(r, 1970);
    expect(r.worldEmissions()).toBeGreaterThan(r.playerEmissions() * 5);
  });

  it('warming lags the ledger by decades, then closes on equilibrium', () => {
    const { r } = flippedPair(42);
    r.co2ppm = 500; // a mid-century sky, instantly
    climateTick(r);
    const equilibrium = (r.co2ppm - CO2_BASE_PPM) * 0.011;
    expect(r.warmingC).toBeLessThan(equilibrium * 0.1); // the bill has not arrived
    let prev = r.warmingC;
    for (let i = 0; i < 200; i++) {
      climateTick(r);
      expect(r.warmingC).toBeGreaterThanOrEqual(prev);
      prev = r.warmingC;
    }
    // two governments later, most of the gap is closed
    expect(r.warmingC).toBeGreaterThan(equilibrium * 0.8);
  });

  it('green tech cuts national intensity and diffuses to the world', () => {
    const r = nationReady();
    setYear(r, 2046);
    const basePlayer = r.playerEmissions();
    const baseWorld = r.worldEmissions();
    r.researched.add('renewables');
    expect(r.playerEmissions()).toBeCloseTo(basePlayer * 0.6, 5);
    expect(r.worldEmissions()).toBeCloseTo(baseWorld * 0.8, 5);
    r.researched.add('fusion_power');
    expect(r.worldEmissions()).toBeCloseTo(baseWorld * 0.8 * 0.5, 5);
    expect(r.playerEmissions()).toBeCloseTo(basePlayer * 0.6 * 0.15, 5);
  });

  it('the Carbon Levy is a real law: environmentalism-gated, cuts emissions ×0.7', () => {
    const r = nationReady();
    r.politicalCapital = 100;
    expect(r.enactLaw('carbon_levy')).toBe(false); // society has not noticed the smoke yet
    r.researched.add('environmentalism');
    const before = r.playerEmissions();
    expect(r.enactLaw('carbon_levy')).toBe(true);
    expect(r.playerEmissions()).toBeCloseTo(before * 0.7, 5);
  });
});

describe('The sea collects (GDD §8.2 impacts)', () => {
  it('tidal flooding bleeds unwalled coastal towns once the heat is in', () => {
    const r = nationReady();
    setYear(r, 2050);
    r.eraBranch = 'drowned';
    r.warmingC = 2.5;
    r.co2ppm = 560;
    const t = r.settlements[0];
    t.site.coastal = true;
    const pop = r.popOf(t);
    const sat = t.satisfaction;
    climateTick(r);
    expect(r.popOf(t)).toBeLessThan(pop);
    expect(t.satisfaction).toBeLessThan(sat);
  });

  it('a sea wall holds: walled towns shrug the tide off', () => {
    const r = nationReady();
    setYear(r, 2050);
    r.warmingC = 2.5;
    r.co2ppm = 560;
    const t = r.settlements[0];
    t.site.coastal = true;
    r.treasury = 1000;
    const cost = r.seaWallCost(t);
    expect(r.buildSeaWall(t.id)).toBe(true);
    expect(r.treasury).toBe(1000 - cost);
    expect(t.seaWall).toBe(true);
    expect(r.buildSeaWall(t.id)).toBe(false); // already raised
    const pop = r.popOf(t);
    climateTick(r);
    expect(r.popOf(t)).toBe(pop);
  });

  it('walls are adaptation-era works: not before the survey year, not inland', () => {
    const r = nationReady();
    r.treasury = 1000;
    const t = r.settlements[0];
    t.site.coastal = true;
    setYear(r, SEA_WALL_YEAR - 1);
    expect(r.buildSeaWall(t.id)).toBe(false);
    setYear(r, SEA_WALL_YEAR);
    expect(r.buildSeaWall(t.id)).toBe(true);
    const inland = { ...t, id: t.id }; // second call on a non-coastal town
    inland.site = { ...t.site, coastal: false };
    r.settlements[0] = inland;
    inland.seaWall = false;
    expect(r.buildSeaWall(inland.id)).toBe(false);
  });
});

describe('The 2040 verdict (GDD §3.2 eras 7–8)', () => {
  it('a hot projection drowns the century regardless of politics', () => {
    const r = nationReady();
    setYear(r, BRANCH_YEAR);
    r.co2ppm = 600;
    r.warmingC = 2.6;
    climateTick(r);
    expect(r.eraBranch).toBe('drowned');
    expect(r.log.some((l) => l.text.includes('DROWNED CENTURY'))).toBe(true);
  });

  it('a cool, content democracy earns the garden century', () => {
    const r = nationReady();
    setYear(r, BRANCH_YEAR);
    r.co2ppm = 320;
    r.warmingC = 0.3;
    r.legitimacy = 80;
    for (const t of r.settlements) t.satisfaction = 70;
    climateTick(r);
    expect(r.eraBranch).toBe('solarpunk');
  });

  it('the same sky over a junta goes neon', () => {
    const { r } = flippedPair(42);
    r.stateProclaimed = true;
    r.stateName = 'Testonia';
    r.govLean = 'council';
    r.treasury = 500;
    r.proclaimNation('Testland', 'junta', {});
    setYear(r, BRANCH_YEAR);
    r.co2ppm = 320;
    r.warmingC = 0.3;
    r.legitimacy = 80;
    for (const t of r.settlements) t.satisfaction = 70;
    climateTick(r);
    expect(r.eraBranch).toBe('dystopia');
  });

  it('the verdict is read once and only once', () => {
    const r = nationReady();
    setYear(r, BRANCH_YEAR);
    r.co2ppm = 600;
    r.warmingC = 2.6;
    climateTick(r);
    expect(r.eraBranch).toBe('drowned');
    r.co2ppm = 300; // even if the sky somehow cleared…
    r.warmingC = 0;
    climateTick(r);
    expect(r.eraBranch).toBe('drowned'); // …history does not re-vote
  });
});

describe('The Century Report (GDD §8.4)', () => {
  it('1 Jan 2100: a graded verdict, not a win screen — and the sandbox runs on', () => {
    const r = nationReady();
    setYear(r, CENTURY_YEAR);
    r.co2ppm = 480;
    r.warmingC = 1.8;
    climateTick(r);
    const rep = r.centuryReport!;
    expect(rep).not.toBeNull();
    expect(rep.grades.stewardship).toBe('B'); // +1.8°C: scarred but standing
    expect(['A', 'B', 'C', 'D', 'F']).toContain(rep.grades.prosperity);
    expect(rep.grades.liberty).toMatch(/[AB]/); // a legitimate democracy
    expect(rep.verdict).toContain('grades');
    expect(r.gameOver).toBe(false);
    expect(r.log.some((l) => l.text.includes('THE CENTURY REPORT'))).toBe(true);
    climateTick(r); // a second century does not re-report
    expect(r.centuryReport).toBe(rep);
  });
});

describe('Climate persists across saves', () => {
  it('roundtrips the ledger, the verdict, and the walls', () => {
    const { sim, r } = flippedPair(42);
    r.stateProclaimed = true;
    r.stateName = 'Testonia';
    r.govLean = 'council';
    r.co2ppm = 455;
    r.warmingC = 1.4;
    r.eraBranch = 'dystopia';
    r.settlements[0].seaWall = true;
    const back = RegionSim.deserialize(r.serialize(), sim);
    expect(back.co2ppm).toBe(455);
    expect(back.warmingC).toBe(1.4);
    expect(back.eraBranch).toBe('dystopia');
    expect(back.settlements[0].seaWall).toBe(true);
    expect(back.centuryReport).toBeNull();
  });

  it('roundtrips accord compliance and geoengineering state', () => {
    const { sim, r } = flippedPair(42);
    r.stateProclaimed = true;
    r.stateName = 'Testonia';
    r.govLean = 'council';
    r.treasury = 500;
    r.proclaimNation('Testland', 'democracy', {});
    r.geoDeployed = true;
    r.geoDeployDay = 100;
    r.accordCompliance[7] = 0.8;
    const back = RegionSim.deserialize(r.serialize(), sim);
    expect(back.geoDeployed).toBe(true);
    expect(back.geoDeployDay).toBe(100);
    expect(back.accordCompliance[7]).toBeCloseTo(0.8);
  });
});

function makeRivalWith(r: RegionSim, commerce: number, expansion: number) {
  const rv = {
    id: 99, name: 'Testovia', leader: 'Dr. Test', archetype: 'trading_republic' as const,
    weights: { commerce, expansion, ideology: 3, honor: 5, risk: 3, grudge: 2 },
    regime: 'parliamentary', agenda: 'expand trade', compass: 'east' as const,
    pop: 8000, relations: 50, treaties: [] as import('../src/sim/region').TreatyKind[],
    borderSettled: false, emergedYear: 1930, history: [],
    lastEnvoyDay: -9999, lastGiftDay: -9999,
  };
  r.rivals.push(rv);
  return rv;
}

describe('Climate Accords (GDD §8.2)', () => {
  it('a signed accord cuts world emissions proportional to signatory pop', () => {
    const r = nationReady();
    setYear(r, 2030);
    const baseLine = r.worldEmissions();
    const rv = makeRivalWith(r, 7, 2);
    rv.treaties.push('climate_accord');
    r.accordCompliance[rv.id] = 1.0;
    expect(r.worldEmissions()).toBeLessThan(baseLine);
  });

  it('a defecting signatory (low compliance) barely cuts world emissions', () => {
    const r = nationReady();
    setYear(r, 2030);
    const rv = makeRivalWith(r, 7, 2);
    rv.treaties.push('climate_accord');
    r.accordCompliance[rv.id] = 0.0; // full defector
    const defectorEmissions = r.worldEmissions();
    r.accordCompliance[rv.id] = 1.0; // compliant
    const compliantEmissions = r.worldEmissions();
    expect(compliantEmissions).toBeLessThan(defectorEmissions);
  });

  it('accordUnlocked() gates the treaty behind environmentalism + year', () => {
    const r = nationReady();
    setYear(r, 2008);
    r.researched.add('environmentalism');
    expect(r.accordUnlocked()).toBe(false); // not yet 2010
    setYear(r, 2010);
    expect(r.accordUnlocked()).toBe(true);
  });

  it('proposeTreaty rejects climate_accord before accordUnlocked()', () => {
    const r = nationReady();
    setYear(r, 2005); // before the accord era
    const rv = makeRivalWith(r, 9, 1);
    rv.relations = 80;
    expect(r.proposeTreaty(rv.id, 'climate_accord')).toBe(false);
  });

  it('sanctionAccordDefector tears the accord without incrementing treatiesBroken', () => {
    const r = nationReady();
    setYear(r, 2025);
    const rv = makeRivalWith(r, 3, 8);
    rv.treaties.push('climate_accord');
    r.accordCompliance[rv.id] = 0.1; // clear defector
    const brokenBefore = r.treatiesBroken;
    expect(r.sanctionAccordDefector(rv.id)).toBe(true);
    expect(rv.treaties.includes('climate_accord')).toBe(false);
    expect(r.treatiesBroken).toBe(brokenBefore); // their fault — not a breach
    expect(r.accordCompliance[rv.id]).toBeUndefined();
  });

  it('cannot sanction a compliant signatory', () => {
    const r = nationReady();
    const rv = makeRivalWith(r, 8, 2);
    rv.treaties.push('climate_accord');
    r.accordCompliance[rv.id] = 0.9; // fully compliant
    expect(r.sanctionAccordDefector(rv.id)).toBe(false);
  });
});

describe('Geoengineering (GDD §8.2)', () => {
  it('deployGeoengineering() requires the tech and nation tier', () => {
    const r = nationReady();
    setYear(r, 2055);
    expect(r.deployGeoengineering()).toBe(false); // no tech yet
    r.researched.add('renewables');
    r.researched.add('computing');
    r.researched.add('geoengineering');
    expect(r.deployGeoengineering()).toBe(true);
    expect(r.geoDeployed).toBe(true);
  });

  it('can only deploy once', () => {
    const r = nationReady();
    setYear(r, 2055);
    r.researched.add('renewables');
    r.researched.add('computing');
    r.researched.add('geoengineering');
    r.deployGeoengineering();
    expect(r.deployGeoengineering()).toBe(false);
  });

  it('geoengineering suppresses warmingC over the active window', () => {
    const r = nationReady();
    setYear(r, 2055);
    r.co2ppm = 500;
    r.warmingC = 2.0;
    r.researched.add('renewables');
    r.researched.add('computing');
    r.researched.add('geoengineering');
    r.deployGeoengineering();
    // Run climate ticks inside the active window
    const before = r.warmingC;
    for (let i = 0; i < 4; i++) climateTick(r);
    expect(r.warmingC).toBeLessThan(before);
  });

  it('geoengineering cools by the full GEOENGINEER_COOLING amount within the window', () => {
    const r = nationReady();
    setYear(r, 2055);
    r.co2ppm = CO2_BASE_PPM; // no natural warming pressure
    r.warmingC = 1.5;
    r.researched.add('renewables');
    r.researched.add('computing');
    r.researched.add('geoengineering');
    r.deployGeoengineering();
    const ticksInWindow = GEOENGINEER_DURATION_DAYS / 30;
    for (let i = 0; i < ticksInWindow; i++) climateTick(r);
    expect(r.warmingC).toBeLessThan(1.5 - GEOENGINEER_COOLING * 0.9); // most of the cooling applied
  });

  it('geoengineering stops cooling after the duration', () => {
    const r = nationReady();
    setYear(r, 2055);
    r.co2ppm = CO2_BASE_PPM;
    r.warmingC = 1.0;
    r.researched.add('renewables');
    r.researched.add('computing');
    r.researched.add('geoengineering');
    r.deployGeoengineering();
    // advance past the window
    r.geoDeployDay = r.day - GEOENGINEER_DURATION_DAYS - 1;
    const before = r.warmingC;
    climateTick(r);
    // Without geoengineering, only natural lag cooling applies (~warmingC/WARMING_LAG_TICKS per tick)
    // which is much less than the active geo cooling (GEOENGINEER_COOLING / ticksInWindow ≈ 0.1)
    expect(r.warmingC).toBeGreaterThanOrEqual(before - 0.05);
  });

  it('geoengineering is a diplomacy bomb: all rivals lose 15 relations', () => {
    const r = nationReady();
    setYear(r, 2055);
    r.researched.add('renewables');
    r.researched.add('computing');
    r.researched.add('geoengineering');
    const rv = makeRivalWith(r, 5, 5);
    rv.relations = 40;
    r.deployGeoengineering();
    expect(rv.relations).toBe(25);
  });
});
