import { describe, expect, it } from 'vitest';
import { analyzeCycles, policyRateFor, runOne, type MacroSample } from '../src/sim/macro-headless';

/** Build a sample series from parallel confidence/gdp arrays (other fields fixed). */
function series(confidence: number[], gdp: number[]): MacroSample[] {
  return confidence.map((c, i) => ({
    t: i,
    gdp: gdp[i],
    confidence: c,
    leverage: 0,
    inflation: 0.02,
    rate: 0.05,
  }));
}

describe('analyzeCycles — credit busts', () => {
  it('counts each downward crossing of the 30-pt deleveraging threshold', () => {
    const flat = [100, 100, 100, 100, 100, 100, 100];
    const conf = [70, 70, 25, 25, 70, 70, 20];
    const s = analyzeCycles(series(conf, flat), 100);
    expect(s.busts).toBe(2); // two separate dips below 30
    expect(s.minConfidence).toBe(20);
  });

  it('does not count a confidence dip that stays at/above the threshold', () => {
    const s = analyzeCycles(series([70, 40, 35, 31, 70], [100, 100, 100, 100, 100]), 100);
    expect(s.busts).toBe(0);
  });

  it('reports zero busts for a healthy, growing economy', () => {
    const s = analyzeCycles(series([70, 70, 70], [100, 101, 102]), 100);
    expect(s.busts).toBe(0);
    expect(s.recessions).toBe(0);
    expect(s.depressions).toBe(0);
  });
});

describe('analyzeCycles — GDP drawdowns', () => {
  it('counts a peak-to-trough drawdown of >=10% as one recession episode', () => {
    // peak 110, trough 90 => 18.2% drawdown, recovers to a new peak (120)
    const s = analyzeCycles(series([70, 70, 70, 70, 70], [100, 110, 90, 95, 120]), 100);
    expect(s.recessions).toBe(1);
    expect(s.depressions).toBe(0);
    expect(s.maxDrawdownPct).toBeCloseTo(18.2, 0);
  });

  it('flags a >=25% drawdown as a depression as well as a recession', () => {
    const s = analyzeCycles(series([70, 70], [100, 70]), 100);
    expect(s.recessions).toBe(1);
    expect(s.depressions).toBe(1);
    expect(s.maxDrawdownPct).toBeCloseTo(30, 0);
  });

  it('counts two distinct recessions separated by a full recovery', () => {
    const gdp = [100, 85, 100, 105, 90, 105];
    const s = analyzeCycles(series([70, 70, 70, 70, 70, 70], gdp), 100);
    expect(s.recessions).toBe(2);
  });
});

describe('analyzeCycles — per-century scaling', () => {
  it('scales counts to a 100-year rate', () => {
    const s = analyzeCycles(series([70, 25, 70], [100, 100, 100]), 50);
    expect(s.busts).toBe(1);
    expect(s.bustsPerCentury).toBe(2); // 1 bust over 50 years = 2/century
  });
});

describe('policyRateFor', () => {
  it('passive policy pins the rate at the neutral 5%', () => {
    expect(policyRateFor('passive', 0.02)).toBe(0.05);
    expect(policyRateFor('passive', 0.20)).toBe(0.05);
  });

  it('taylor policy sits below neutral at target inflation (accommodative)', () => {
    expect(policyRateFor('taylor', 0.02)).toBeCloseTo(0.025, 6);
  });

  it('taylor policy leans up as inflation climbs, clamped to 15%', () => {
    expect(policyRateFor('taylor', 0.05)).toBeGreaterThan(0.05);
    expect(policyRateFor('taylor', 0.20)).toBe(0.15);
  });

  it('taylor policy clamps to a 1% floor when inflation is very low', () => {
    expect(policyRateFor('taylor', 0)).toBe(0.01);
  });
});

// End-to-end: pin the actual RegionSim credit cycle, not just the analyzer.
// Guards the GDD §13.3 risk #3 fix — the Minsky leverage-fragility term that
// makes the business cycle emerge under an active (dovish growth-mandate) banker
// while staying dormant when the rate is pinned at neutral.
describe('credit cycle emergence (RegionSim.tickMonetary)', () => {
  it('emerges under an active dovish policy without running away', () => {
    const { stats } = runOne(1000, 'taylor', 110);
    // The cycle turns: leverage builds, fragility breaks confidence below 30.
    expect(stats.busts).toBeGreaterThanOrEqual(1);
    expect(stats.minConfidence).toBeLessThan(30);
    // …but it does not run away into perpetual depression (GDD: <=1/century).
    expect(stats.depressionsPerCentury).toBeLessThanOrEqual(1);
    expect(stats.bustsPerCentury).toBeLessThanOrEqual(6);
  }, 30_000);

  it('stays dormant when the policy rate is pinned at neutral (control)', () => {
    const { stats } = runOne(1000, 'passive', 110);
    // Neutral rate => leverage never builds => no fragility => no credit busts.
    expect(stats.busts).toBe(0);
    expect(stats.maxLeverage).toBeLessThan(0.5);
    expect(stats.minConfidence).toBeGreaterThanOrEqual(60);
  }, 30_000);
});
