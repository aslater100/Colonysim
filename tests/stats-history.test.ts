import { describe, it, expect } from 'vitest';
import { RegionSim, STATS_HISTORY_MAX } from '../src/sim/region';
import { DAYS_PER_YEAR, START_YEAR } from '../src/sim/defs';

/**
 * Annual stats history (Century Graph data layer, GDD §8.7).
 *
 * One StatSnapshot is pushed each January; the ring buffer caps at
 * STATS_HISTORY_MAX. Serialized/deserialized for save-load continuity.
 */

function nation(seed = 1000): RegionSim {
  const r = RegionSim.create(seed);
  r.stateProclaimed = true;
  r.nationProclaimed = true;
  r.govType = 'republic';
  r.treasury = 5000;
  return r;
}

function advanceYears(r: RegionSim, years: number): void {
  const target = r.year + years;
  while (r.year < target) r.tick();
}

describe('annual stats history (Century Graph)', () => {
  it('starts empty', () => {
    const r = nation();
    expect(r.statsHistory).toEqual([]);
  });

  it('grows by one entry per year', () => {
    const r = nation();
    advanceYears(r, 5);
    // statsHistory should have one entry per year elapsed
    expect(r.statsHistory.length).toBeGreaterThanOrEqual(5);
    expect(r.statsHistory.length).toBeLessThanOrEqual(6);
  });

  it('snapshots contain the correct year', () => {
    const r = nation();
    advanceYears(r, 3);
    for (const snap of r.statsHistory) {
      expect(snap.year).toBeGreaterThanOrEqual(START_YEAR);
      expect(snap.year).toBeLessThanOrEqual(START_YEAR + 5);
    }
  });

  it('GDP in snapshot is positive and finite', () => {
    const r = nation();
    advanceYears(r, 2);
    for (const snap of r.statsHistory) {
      expect(Number.isFinite(snap.gdp)).toBe(true);
      expect(snap.gdp).toBeGreaterThanOrEqual(0);
    }
  });

  it('population in snapshot is positive', () => {
    const r = nation();
    advanceYears(r, 2);
    for (const snap of r.statsHistory) {
      expect(snap.pop).toBeGreaterThan(0);
    }
  });

  it('warmingC in snapshot matches the simulated warming', () => {
    const r = nation();
    advanceYears(r, 3);
    // Early game warming should be small (< 1°C)
    for (const snap of r.statsHistory) {
      expect(snap.warmingC).toBeGreaterThanOrEqual(0);
      expect(snap.warmingC).toBeLessThan(5);
    }
  });

  it('satisfaction stays in [0, 100]', () => {
    const r = nation();
    advanceYears(r, 3);
    for (const snap of r.statsHistory) {
      expect(snap.satisfaction).toBeGreaterThanOrEqual(0);
      expect(snap.satisfaction).toBeLessThanOrEqual(100);
    }
  });

  it('ring buffer caps at STATS_HISTORY_MAX', () => {
    const r = nation();
    // Manually push more than the cap
    for (let i = 0; i < STATS_HISTORY_MAX + 10; i++) {
      (r as any).tickStatsHistory?.();
    }
    expect(r.statsHistory.length).toBeLessThanOrEqual(STATS_HISTORY_MAX);
  });

  it('serializes and deserializes correctly', () => {
    const r = nation();
    advanceYears(r, 4);
    const snapshotCount = r.statsHistory.length;
    const json = r.serialize();
    const r2 = RegionSim.deserialize(json);
    expect(r2.statsHistory.length).toBe(snapshotCount);
    if (snapshotCount > 0) {
      expect(r2.statsHistory[0].year).toBe(r.statsHistory[0].year);
      expect(r2.statsHistory[0].gdp).toBeCloseTo(r.statsHistory[0].gdp, 6);
    }
  });

  it('old saves backfill to empty array', () => {
    // Simulate an old save without statsHistory
    const r = nation();
    const json = r.serialize();
    const parsed = JSON.parse(json);
    delete parsed.statsHistory;
    const r2 = RegionSim.deserialize(JSON.stringify(parsed));
    expect(r2.statsHistory).toEqual([]);
  });

  it('STATS_HISTORY_MAX is exported and at least 100', () => {
    expect(STATS_HISTORY_MAX).toBeGreaterThanOrEqual(100);
  });
});
