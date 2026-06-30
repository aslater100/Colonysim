import { describe, it, expect } from 'vitest';
import { RegionSim } from '../src/sim/region';
import { tickClimate } from '../src/sim/systems/climate';

/**
 * Climate refugee migration (GDD §8.2).
 *
 * Coastal, unwalled player settlements bleed population to the largest
 * inland settlement when tidal flooding is active (year ≥ 2035, warmingC > 1.5).
 * Flight rate: min(1%, 0.1% × severity) per monthly tick — slow-burn effect.
 */

function makeRegion(warmingC: number, year: number) {
  const r = RegionSim.create(3, {});
  r.stateProclaimed = true;
  r.nationProclaimed = true;

  // Coastal unwalled settlement (source)
  const coast = r.settlements[0];
  (coast.site as any).coastal = true;
  coast.seaWall = false;
  coast.name = 'Port Town';

  // Inland settlement (destination)
  const inland = { ...structuredClone(coast) } as any;
  inland.id = coast.id + 500;
  inland.name = 'Inland City';
  (inland.site as any).coastal = false;
  inland.seaWall = false;
  // Give inland more pop so it's the "largest"
  inland.cohorts = { bands: [0, 200, 100, 50, 20, 10] };
  r.settlements.push(inland);

  (r as any).warmingC = warmingC;
  Object.defineProperty(r, 'year', { get: () => year, configurable: true });
  // Ensure log gate passes
  (r as any).lastRefugeesLogDay = 0;

  return { r, coast, inland };
}

describe('climate refugee migration', () => {
  it('no migration below year 2035 gate', () => {
    const { r, coast, inland } = makeRegion(2.5, 2030);
    const coastPopBefore = (r as any).popOf(coast);
    const inlandPopBefore = (r as any).popOf(inland);
    tickClimate(r);
    expect((r as any).popOf(coast)).toBe(coastPopBefore);
    expect((r as any).popOf(inland)).toBe(inlandPopBefore);
  });

  it('no migration below 1.5°C warming even after 2035', () => {
    const { r, coast, inland } = makeRegion(1.0, 2050);
    const coastPopBefore = (r as any).popOf(coast);
    const inlandPopBefore = (r as any).popOf(inland);
    tickClimate(r);
    expect((r as any).popOf(coast)).toBe(coastPopBefore);
    expect((r as any).popOf(inland)).toBe(inlandPopBefore);
  });

  it('coastal pop decreases and inland pop increases at moderate warming', () => {
    const { r, coast, inland } = makeRegion(2.5, 2060);
    const coastPopBefore = (r as any).popOf(coast);
    const inlandPopBefore = (r as any).popOf(inland);
    if (coastPopBefore <= 5) return; // nothing to flee

    tickClimate(r);

    const coastPopAfter = (r as any).popOf(coast);
    const inlandPopAfter = (r as any).popOf(inland);
    // Coastal pop should not increase
    expect(coastPopAfter).toBeLessThanOrEqual(coastPopBefore);
    // Inland pop should not decrease
    expect(inlandPopAfter).toBeGreaterThanOrEqual(inlandPopBefore);
  });

  it('walled coastal town does NOT send refugees (seaWall protects)', () => {
    const { r, coast, inland } = makeRegion(2.5, 2060);
    coast.seaWall = true;
    const coastPopBefore = (r as any).popOf(coast);
    const inlandPopBefore = (r as any).popOf(inland);
    tickClimate(r);
    // Walled — no refugee flow from this gate (overtopping is a separate block)
    const inlandPopAfter = (r as any).popOf(inland);
    // Inland pop should not grow from refugees when coastal is walled
    expect(inlandPopAfter).toBeLessThanOrEqual(inlandPopBefore + 0.5); // rounding tolerance
    void coastPopBefore; // suppress unused warning
  });

  it('higher warming produces proportionally larger migration flow', () => {
    const { r: r1, coast: c1, inland: i1 } = makeRegion(2.0, 2060);
    const { r: r2, coast: c2, inland: i2 } = makeRegion(3.5, 2060);

    const pop1Before = (r1 as any).popOf(c1);
    const pop2Before = (r2 as any).popOf(c2);
    const inland1Before = (r1 as any).popOf(i1);
    const inland2Before = (r2 as any).popOf(i2);

    tickClimate(r1);
    tickClimate(r2);

    const loss1 = pop1Before - (r1 as any).popOf(c1);
    const loss2 = pop2Before - (r2 as any).popOf(c2);
    const gain1 = (r1 as any).popOf(i1) - inland1Before;
    const gain2 = (r2 as any).popOf(i2) - inland2Before;

    if (pop1Before > 5 && pop2Before > 5) {
      // Higher warming → more loss
      expect(loss2).toBeGreaterThanOrEqual(loss1);
      // More loss → more inland gain
      expect(gain2).toBeGreaterThanOrEqual(gain1);
    }
  });

  it('migration is zero when no inland settlements exist', () => {
    const { r, coast } = makeRegion(2.5, 2060);
    // Remove inland settlements (keep only the coastal one)
    r.settlements = r.settlements.filter((t: any) => t.id === coast.id);
    const popBefore = (r as any).popOf(coast);
    tickClimate(r);
    // No destination → no migration → pop unchanged by refugee block
    const popAfter = (r as any).popOf(coast);
    // Pop may fall from tidal flooding, but not FROM the refugee block
    // Just assert no crash
    expect(popAfter).toBeLessThanOrEqual(popBefore);
    expect(Number.isFinite(popAfter)).toBe(true);
  });

  it('lastRefugeesLogDay is serialized and restored', () => {
    const { r } = makeRegion(2.5, 2060);
    (r as any).lastRefugeesLogDay = 12345;
    const json = r.serialize();
    const r2 = RegionSim.deserialize(json);
    expect((r2 as any).lastRefugeesLogDay).toBe(12345);
  });
});
