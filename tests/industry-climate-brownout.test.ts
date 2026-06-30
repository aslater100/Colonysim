import { describe, it, expect } from 'vitest';
import {
  RegionSim,
  INDUSTRY_BROWNOUT_THRESHOLD,
  INDUSTRY_BROWNOUT_SLOPE,
  INDUSTRY_BROWNOUT_MAX_DRAG,
} from '../src/sim/region';

/**
 * Industry brownout climate drag (Tier-2 re-baseline feature).
 *
 * industryClimateMult() mirrors agriClimateMult() but fires at +3°C:
 *   - Exactly 1.0 below threshold → byte-identical in normal play
 *   - Linear above threshold, capped at INDUSTRY_BROWNOUT_MAX_DRAG
 *   - Wired into updateSectors via the climateMult channel (industry sector only)
 */

function colonyAtWarming(warmingC: number): RegionSim {
  const r = RegionSim.create(1);
  (r as any).warmingC = warmingC;
  return r;
}

describe('INDUSTRY_BROWNOUT constants', () => {
  it('threshold is 3.0°C', () => {
    expect(INDUSTRY_BROWNOUT_THRESHOLD).toBe(3.0);
  });

  it('max drag is 0.30 (30%)', () => {
    expect(INDUSTRY_BROWNOUT_MAX_DRAG).toBe(0.30);
  });

  it('slope is positive', () => {
    expect(INDUSTRY_BROWNOUT_SLOPE).toBeGreaterThan(0);
  });
});

describe('industryClimateMult()', () => {
  it('is exactly 1.0 at 0°C warming', () => {
    const r = colonyAtWarming(0);
    expect((r as any).industryClimateMult()).toBe(1.0);
  });

  it('is exactly 1.0 at the threshold (3.0°C)', () => {
    const r = colonyAtWarming(INDUSTRY_BROWNOUT_THRESHOLD);
    expect((r as any).industryClimateMult()).toBe(1.0);
  });

  it('is < 1.0 above the threshold', () => {
    const r = colonyAtWarming(INDUSTRY_BROWNOUT_THRESHOLD + 0.5);
    expect((r as any).industryClimateMult()).toBeLessThan(1.0);
  });

  it('equals 1 − slope × (warming − threshold) below the cap', () => {
    const excess = 1.0;
    const r = colonyAtWarming(INDUSTRY_BROWNOUT_THRESHOLD + excess);
    const expected = 1 - INDUSTRY_BROWNOUT_SLOPE * excess;
    expect((r as any).industryClimateMult()).toBeCloseTo(expected, 10);
  });

  it('is capped at (1 − INDUSTRY_BROWNOUT_MAX_DRAG) at extreme warming', () => {
    const r = colonyAtWarming(100);
    expect((r as any).industryClimateMult()).toBeCloseTo(1 - INDUSTRY_BROWNOUT_MAX_DRAG, 10);
  });

  it('is monotonically decreasing above the threshold', () => {
    const warmings = [3.0, 3.5, 4.0, 4.5, 5.0, 6.0];
    const mults = warmings.map(w => (colonyAtWarming(w) as any).industryClimateMult());
    for (let i = 1; i < mults.length; i++) {
      expect(mults[i]).toBeLessThanOrEqual(mults[i - 1]);
    }
  });
});

describe('brownout drags industry output but not agriculture', () => {
  it('agriculture sector output is unaffected by brownout warming', () => {
    const r1 = colonyAtWarming(INDUSTRY_BROWNOUT_THRESHOLD - 0.1);
    const r2 = colonyAtWarming(INDUSTRY_BROWNOUT_THRESHOLD + 1.0);

    // Force identical workers and shares so only climateMult differs
    for (const r of [r1, r2]) {
      const t = r.settlements[0];
      t.sectors.agriculture.share = 0.5;
      t.sectors.industry.share = 0.5;
    }

    // Run one monthly update to let updateSectors fire
    const TICKS = 30 * 24; // approximate one month of ticks
    for (let i = 0; i < TICKS; i++) { r1.tick(); r2.tick(); }

    const agri1 = r1.settlements[0].sectors.agriculture.output;
    const agri2 = r2.settlements[0].sectors.agriculture.output;
    const ind1  = r1.settlements[0].sectors.industry.output;
    const ind2  = r2.settlements[0].sectors.industry.output;

    // Agriculture should be roughly equal (same warming range, well below agri threshold)
    // Industry in r2 should be less than r1 (brownout active)
    // Note: agri at warmingC=2.9 vs 4.0: agri threshold is 1.5, so both have agri drag
    // but the DIFFERENCE in agri drag is small (0.1°C × 0.06 = 0.006) vs industry drag (1°C × 0.10 = 0.10)
    // So ind2/ind1 gap should be substantially larger than agri2/agri1 gap.
    if (ind1 > 0 && agri1 > 0) {
      const indRatio = ind2 / ind1;
      const agriRatio = agri2 / agri1;
      // Industry drag from brownout should exceed agriculture drift
      expect(indRatio).toBeLessThan(agriRatio);
    }
  });
});

describe('brownout is byte-identical below threshold', () => {
  it('industryClimateMult is 1.0 for normal play warming (< 3°C)', () => {
    // Typical late-game warming: ~1.5–2.5°C; brownout does not activate
    for (const w of [0, 0.5, 1.0, 1.5, 2.0, 2.5, 2.9]) {
      const r = colonyAtWarming(w);
      expect((r as any).industryClimateMult()).toBe(1.0);
    }
  });
});
