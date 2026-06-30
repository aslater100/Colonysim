import { describe, it, expect } from 'vitest';
import {
  RegionSim,
  AGRI_CLIMATE_THRESHOLD,
  AGRI_CLIMATE_SLOPE,
  AGRI_CLIMATE_MAX_DRAG,
} from '../src/sim/region';

/**
 * Farm-economy climate drag (GDD §8.2, Tier-2 balance). Realized warming past
 * `AGRI_CLIMATE_THRESHOLD`°C erodes the agriculture SECTOR's output (its GDP
 * contribution) — distinct from, and additive to, the older subsistence-food drag
 * in dailyUpdate. Bounded by `AGRI_CLIMATE_MAX_DRAG`, exactly 1.0 below the
 * threshold, and a pure sink (warming is emissions-driven), so non-divergent.
 *
 * This is an intentional balance change: a warm late century trims agricultural
 * GDP. Verified non-divergent across 8 seeds × 181y in the headless sim; wants a
 * human late-game playtest to tune the curve.
 */

function nation(seed = 1000): RegionSim {
  const r = RegionSim.create(seed);
  r.stateProclaimed = true;
  r.nationProclaimed = true;
  return r;
}

function playerTown(r: RegionSim) {
  return r.settlements.find((t) => t.factionId === r.playerFactionId)!;
}

const setWarming = (r: RegionSim, c: number): void => {
  (r as unknown as { warmingC: number }).warmingC = c;
};
const updateSectors = (r: RegionSim, t: ReturnType<typeof playerTown>): void =>
  (r as unknown as { updateSectors(t: unknown): void }).updateSectors(t);

describe('agriClimateMult', () => {
  it('is exactly 1.0 at or below the threshold (no drag in a cool world)', () => {
    const r = nation();
    for (const c of [0, 0.8, 1.0, AGRI_CLIMATE_THRESHOLD]) {
      setWarming(r, c);
      expect(r.agriClimateMult()).toBe(1);
    }
  });

  it('drags linearly above the threshold', () => {
    const r = nation();
    setWarming(r, 2.5); // 1.0°C over → 0.06 drag
    expect(r.agriClimateMult()).toBeCloseTo(1 - 1.0 * AGRI_CLIMATE_SLOPE, 12);
    setWarming(r, 3.5); // 2.0°C over → 0.12 drag
    expect(r.agriClimateMult()).toBeCloseTo(1 - 2.0 * AGRI_CLIMATE_SLOPE, 12);
  });

  it('never drags more than the cap, even at extreme warming', () => {
    const r = nation();
    setWarming(r, 12);
    expect(r.agriClimateMult()).toBeCloseTo(1 - AGRI_CLIMATE_MAX_DRAG, 12);
    expect(r.agriClimateMult()).toBeGreaterThan(0); // never zeroes the farm economy
  });
});

describe('warming erodes agriculture and (above 3°C) industry', () => {
  it('lowers agriculture output by exactly the agri mult at moderate warming (below brownout threshold)', () => {
    // Use warmingC = 2.5°C: above agri threshold (1.5°C) but below brownout threshold (3.0°C)
    // so only agriculture is affected.
    const cool = nation();
    const warm = nation();
    const tc = playerTown(cool);
    const tw = playerTown(warm);
    setWarming(cool, 0);
    setWarming(warm, 2.5); // above agri threshold, below brownout threshold
    updateSectors(cool, tc);
    updateSectors(warm, tw);

    expect(warm.agriClimateMult()).toBeLessThan(1);
    expect(tw.sectors.agriculture.output).toBeLessThan(tc.sectors.agriculture.output);
    expect(tw.sectors.agriculture.output / tc.sectors.agriculture.output).toBeCloseTo(
      warm.agriClimateMult(),
      6,
    );
    // At 2.5°C, brownout threshold not yet reached — industry and services untouched.
    expect(tw.sectors.industry.output).toBeCloseTo(tc.sectors.industry.output, 9);
    expect(tw.sectors.services.output).toBeCloseTo(tc.sectors.services.output, 9);
  });

  it('lowers industry output by exactly the brownout mult at extreme warming (≥3°C)', () => {
    const cool = nation();
    const warm = nation();
    const tc = playerTown(cool);
    const tw = playerTown(warm);
    setWarming(cool, 0);
    setWarming(warm, 4.0); // above brownout threshold
    updateSectors(cool, tc);
    updateSectors(warm, tw);

    expect((warm as any).industryClimateMult()).toBeLessThan(1);
    expect(tw.sectors.industry.output).toBeLessThan(tc.sectors.industry.output);
    // Services carry no warming term.
    expect(tw.sectors.services.output).toBeCloseTo(tc.sectors.services.output, 9);
  });
});
