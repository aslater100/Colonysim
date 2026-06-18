import { describe, expect, it } from 'vitest';
import { RegionSim, REGION_MINUTES_PER_TICK, BRANCH_YEAR, CENTURY_YEAR } from '../src/sim/region';
import { MINUTES_PER_DAY, DAYS_PER_YEAR, START_YEAR } from '../src/sim/defs';

/**
 * Long-horizon integration guard for the nation tier. The unit suites exercise
 * the monetary/economy primitives in isolation, but nothing runs `RegionSim`
 * across a full century — where compounding (treasury, debt, inflation, GDP)
 * is most likely to drift into NaN/Infinity or where the tick path could pick
 * up hidden non-determinism. These tests close that gap.
 */
const ticksPerDay = MINUTES_PER_DAY / REGION_MINUTES_PER_TICK;

function nation(seed: number): RegionSim {
  const r = RegionSim.create(seed);
  r.stateProclaimed = true;
  r.nationProclaimed = true;
  r.govType = 'republic';
  r.legitimacy = 60;
  r.activePolicies = [];
  r.treasury = 1000;
  r.passedLaws.add('central_bank_charter');
  r.passedLaws.add('income_tax');
  return r;
}

function runYears(r: RegionSim, years: number): void {
  const days = Math.round(years * DAYS_PER_YEAR);
  for (let d = 0; d < days; d++) {
    for (let t = 0; t < ticksPerDay; t++) r.tick();
  }
}

/** A snapshot of the scalars that compound over a long run. */
function snapshot(r: RegionSim) {
  return {
    year: r.year,
    gdp: r.gdpLastMonth,
    confidence: r.confidence,
    inflation: r.inflationRate,
    leverage: r.privateLeverage,
    treasury: r.treasury,
    exchangeRate: r.exchangeRate,
    nationalDebt: r.nationalDebt,
  };
}

describe('Region tier — long-horizon stability (integration)', () => {
  it('runs the full 1900→2010 nation span with all macro state finite', () => {
    const r = nation(1000);
    expect(() => runYears(r, 110)).not.toThrow();
    const s = snapshot(r);
    expect(r.year).toBe(START_YEAR + 110);
    for (const [key, value] of Object.entries(s)) {
      expect(Number.isFinite(value), `${key} should be finite, got ${value}`).toBe(true);
    }
    // Bounded fields must stay inside their documented ranges after a century.
    expect(s.confidence).toBeGreaterThanOrEqual(0);
    expect(s.confidence).toBeLessThanOrEqual(100);
    expect(s.inflation).toBeGreaterThanOrEqual(0);
    expect(s.inflation).toBeLessThanOrEqual(0.5); // tickMonetary clamps to [0, 0.50]
    expect(s.exchangeRate).toBeGreaterThanOrEqual(0.30);
    expect(s.exchangeRate).toBeLessThanOrEqual(2.0);
    expect(s.leverage).toBeGreaterThanOrEqual(0);
    expect(s.treasury).toBeGreaterThanOrEqual(0);
  });

  it('is deterministic over a 50-year run for a fixed seed', () => {
    const a = nation(2024);
    runYears(a, 50);
    const b = nation(2024);
    runYears(b, 50);
    expect(snapshot(a)).toEqual(snapshot(b));
  });

  it('diverges for different seeds (the run is actually seed-driven)', () => {
    const a = nation(7);
    runYears(a, 50);
    const b = nation(99);
    runYears(b, 50);
    // At least one compounding scalar should differ between distinct seeds.
    expect(snapshot(a)).not.toEqual(snapshot(b));
  });
});

/** The late game (era fork at 2040, century report at 2100) was never exercised
 *  by the longrun guard, which stopped at 2010 — yet the era-branch reveal modal
 *  depends on `decideBranch()` firing. These pin the end-of-game milestones. */
describe('Region tier — late-game milestones fire', () => {
  it('decides an era branch once the run passes BRANCH_YEAR (2040)', () => {
    const r = nation(1000);
    expect(r.eraBranch).toBeNull();
    runYears(r, BRANCH_YEAR - START_YEAR + 5); // → 2045
    expect(r.eraBranch).not.toBeNull();
    expect(['solarpunk', 'dystopia', 'drowned']).toContain(r.eraBranch);
  });

  it('builds a century report with four graded categories at 2100', () => {
    const r = nation(1000);
    runYears(r, CENTURY_YEAR - START_YEAR + 1); // → 2101
    expect(r.centuryReport).not.toBeNull();
    const g = r.centuryReport!.grades;
    for (const cat of [g.stewardship, g.prosperity, g.liberty, g.standing]) {
      expect(['A', 'B', 'C', 'D', 'F']).toContain(cat);
    }
  });

  it('the era branch, once decided, is stable for the rest of the run', () => {
    const r = nation(1000);
    runYears(r, BRANCH_YEAR - START_YEAR + 2); // → 2042
    const decided = r.eraBranch;
    runYears(r, 20); // → 2062
    expect(r.eraBranch).toBe(decided); // a fork is permanent, not re-rolled
  });
});
