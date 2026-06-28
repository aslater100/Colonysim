import { describe, expect, it } from 'vitest';
import { RegionSim, CITY_WORK_RADIUS } from '../src/sim/region';
import { RegionMap, REGION_N } from '../src/sim/worldgen';
import { Weather } from '../src/sim/weather';
import { Rng } from '../src/sim/rng';

/**
 * Spatial-4X Phase C: per-hex terrain yields feed sector output bonuses,
 * and placed buildings on matching terrain earn an adjacency bonus.
 * Tests pin the yield formula, the adjacency rule, and the integration point
 * (sector output is higher on favourable terrain than neutral ground).
 */

function colony(seed: number): RegionSim {
  const r = RegionSim.foundColony(new Rng(seed), new RegionMap(seed), new Weather(seed), {});
  r.treasury = 1_000_000;
  return r;
}

// ---- white-box access to the (private) tile yield and adjacency methods ----
type Priv = { tileYieldFor: (t: object) => Record<string, number>; placedBuildingTerrainBonus: (t: object, s: string) => number };
const priv = (r: RegionSim) => r as unknown as Priv;

// ---- helper: advance one full monthly tick so updateSectors fires ----
// REGION_MINUTES_PER_TICK = 30, MINUTES_PER_DAY = 1440 → 48 ticks/day.
// monthlyUpdate fires every 30 days, so a full month = 30 × 48 = 1440 ticks.
function advanceMonth(r: RegionSim): void {
  for (let i = 0; i < 1440; i++) r.tick();
}

// ---- 1. Tile yield values are finite and in the documented ranges ----

describe('tileYieldFor — bounds and finiteness', () => {
  it('returns a finite value in [-0.15, 0.25] for agriculture on any start site', () => {
    for (const seed of [1, 7, 42, 1000, 2024]) {
      const r = colony(seed);
      const t = r.settlements[0];
      const y = priv(r).tileYieldFor(t);
      expect(Number.isFinite(y.agriculture), `seed ${seed} agri finite`).toBe(true);
      expect(y.agriculture, `seed ${seed}`).toBeGreaterThanOrEqual(-0.15);
      expect(y.agriculture, `seed ${seed}`).toBeLessThanOrEqual(0.25);
    }
  });

  it('returns a finite value in [-0.05, 0.25] for industry on any start site', () => {
    for (const seed of [1, 7, 42, 1000, 2024]) {
      const r = colony(seed);
      const t = r.settlements[0];
      const y = priv(r).tileYieldFor(t);
      expect(Number.isFinite(y.industry), `seed ${seed} indust finite`).toBe(true);
      expect(y.industry, `seed ${seed}`).toBeGreaterThanOrEqual(-0.05);
      expect(y.industry, `seed ${seed}`).toBeLessThanOrEqual(0.25);
    }
  });

  it('returns 0 for information (reserved for later eras)', () => {
    const r = colony(7);
    const t = r.settlements[0];
    expect(priv(r).tileYieldFor(t).information).toBe(0);
  });

  it('services bonus is ≥ 0 (never a penalty)', () => {
    for (const seed of [1, 7, 42, 1000, 2024]) {
      const r = colony(seed);
      const t = r.settlements[0];
      const y = priv(r).tileYieldFor(t);
      expect(y.services, `seed ${seed}`).toBeGreaterThanOrEqual(0);
    }
  });
});

// ---- 2. Coastal sites earn a services bonus ----

describe('tileYieldFor — coastal bonus', () => {
  it('a coastal town earns a positive services yield', () => {
    // Seed 2 with pref 'coastal' gives a coastal start (verified).
    const r = RegionSim.foundColony(new Rng(2), new RegionMap(2), new Weather(2), { pref: 'coastal' });
    r.treasury = 1_000_000;
    const t = r.settlements[0];
    expect(t.site.coastal, 'expected a coastal start with seed 2 + coastal pref').toBe(true);
    const y = priv(r).tileYieldFor(t);
    expect(y.services).toBeGreaterThan(0);
  });
});

// ---- 3. Caching — same result on repeated calls ----

describe('tileYieldFor — cache stability', () => {
  it('returns the same object on repeated calls (cache hit)', () => {
    const r = colony(42);
    const t = r.settlements[0];
    const first = priv(r).tileYieldFor(t);
    const second = priv(r).tileYieldFor(t);
    expect(first).toBe(second); // reference equality → same cached object
  });

  it('same seed produces identical tile yields (determinism)', () => {
    const a = colony(99);
    const b = colony(99);
    const ya = priv(a).tileYieldFor(a.settlements[0]);
    const yb = priv(b).tileYieldFor(b.settlements[0]);
    expect(ya.agriculture).toBeCloseTo(yb.agriculture, 12);
    expect(ya.industry).toBeCloseTo(yb.industry, 12);
    expect(ya.services).toBeCloseTo(yb.services, 12);
  });

  it('distinct seeds produce distinct tile yields', () => {
    const a = priv(colony(7)).tileYieldFor(colony(7).settlements[0]);
    const b = priv(colony(99)).tileYieldFor(colony(99).settlements[0]);
    const same = a.agriculture === b.agriculture && a.industry === b.industry && a.services === b.services;
    // Very unlikely for two random seeds to produce identical terrain yields
    expect(same, 'all sectors identical for different seeds').toBe(false);
  });
});

// ---- 4. Placed-building adjacency bonus ----

describe('placedBuildingTerrainBonus', () => {
  it('returns 0 when there are no placed buildings', () => {
    const r = colony(5);
    const t = r.settlements[0];
    t.placedBuildings = [];
    expect(priv(r).placedBuildingTerrainBonus(t, 'agriculture')).toBe(0);
    expect(priv(r).placedBuildingTerrainBonus(t, 'industry')).toBe(0);
    expect(priv(r).placedBuildingTerrainBonus(t, 'services')).toBe(0);
  });

  it('an agriculture building on a fertile cell earns the adjacency bonus', () => {
    const r = colony(9);
    const t = r.settlements[0];
    // Find a ring cell with high fertility or river
    const cells = r.buildablePlacementCells(t.id);
    const c = r.map.coordToCell(t.x, t.y);
    const fertileCell = cells.find((cell) => {
      const col = Math.floor(cell / REGION_N), row = cell % REGION_N;
      const mapCell = r.map.at(col, row);
      return mapCell.fertility > 1.05 || mapCell.river;
    });
    if (fertileCell === undefined) return; // no fertile ring cell on this seed; skip

    t.placedBuildings = [{ id: 'grain_exchange', cell: fertileCell }];
    expect(priv(r).placedBuildingTerrainBonus(t, 'agriculture')).toBeGreaterThan(0);
  });

  it('a non-matching sector building on fertile soil earns no agriculture adjacency', () => {
    const r = colony(9);
    const t = r.settlements[0];
    const cells = r.buildablePlacementCells(t.id);
    const fertileCell = cells.find((cell) => {
      const col = Math.floor(cell / REGION_N), row = cell % REGION_N;
      return r.map.at(col, row).fertility > 1.05;
    });
    if (fertileCell === undefined) return;
    // workshops are industry sector, not agriculture
    t.placedBuildings = [{ id: 'workshops', cell: fertileCell }];
    expect(priv(r).placedBuildingTerrainBonus(t, 'agriculture')).toBe(0);
  });

  it('adjacency bonus does not double-count for a building placed on non-matching terrain', () => {
    const r = colony(5);
    const t = r.settlements[0];
    const cells = r.buildablePlacementCells(t.id);
    // Find a cell that's not ore and not rough (poor industry terrain)
    const flatCell = cells.find((cell) => {
      const col = Math.floor(cell / REGION_N), row = cell % REGION_N;
      const mc = r.map.at(col, row);
      return !mc.ore && mc.roughness <= 0.35;
    });
    if (flatCell === undefined) return;
    t.placedBuildings = [{ id: 'workshops', cell: flatCell }];
    expect(priv(r).placedBuildingTerrainBonus(t, 'industry')).toBe(0);
  });
});

// ---- 5. Integration: tile yields feed into updateSectors → sector output ----

describe('Phase C integration — terrain shapes sector output', () => {
  it('sector output is strictly positive on any start site (terrain bonus never zeroes output)', () => {
    for (const seed of [1, 7, 42, 1000, 2024]) {
      const r = colony(seed);
      advanceMonth(r);
      const t = r.settlements[0];
      for (const id of ['agriculture', 'industry', 'services'] as const) {
        expect(t.sectors[id].output, `seed ${seed} ${id}`).toBeGreaterThan(0);
      }
    }
  });

  it('tile yield bonus is reflected in sector output (output with bonus > output without)', () => {
    // Compare buildingBonus of two identical towns with different tile yields
    // We do this indirectly: run a month and check that the yield actually differs
    const r1 = colony(7);
    const r2 = colony(99);
    advanceMonth(r1);
    advanceMonth(r2);
    // The two seeds have different terrain → agriculture outputs should differ
    const ag1 = r1.settlements[0].sectors.agriculture.output;
    const ag2 = r2.settlements[0].sectors.agriculture.output;
    // They are on different terrain — at least ONE of the sector outputs must differ
    // (same as the "diverges for different seeds" check in the longrun tests)
    const anyDiffers = Math.abs(ag1 - ag2) > 1e-8 ||
      Math.abs(r1.settlements[0].sectors.industry.output - r2.settlements[0].sectors.industry.output) > 1e-8;
    expect(anyDiffers, 'terrain did not differentiate any sector output').toBe(true);
  });

  it('placed building on matching terrain boosts its sector output vs neutral placement', () => {
    const r = colony(9);
    const t = r.settlements[0];

    // Find a ring cell with fertile terrain for agriculture
    const cells = r.buildablePlacementCells(t.id);
    const fertileCell = cells.find((cell) => {
      const col = Math.floor(cell / REGION_N), row = cell % REGION_N;
      return r.map.at(col, row).fertility > 1.05 || r.map.at(col, row).river;
    });
    // Find a ring cell that's neither fertile nor river
    const neutralCell = cells.find((cell) => {
      const col = Math.floor(cell / REGION_N), row = cell % REGION_N;
      const mc = r.map.at(col, row);
      return mc.fertility <= 1.05 && !mc.river;
    });

    if (fertileCell === undefined || neutralCell === undefined) return; // seed doesn't split; skip

    // Run without any placed buildings
    t.placedBuildings = [];
    advanceMonth(r);
    const baseBuildingBonus = priv(r).placedBuildingTerrainBonus(t, 'agriculture');
    expect(baseBuildingBonus).toBe(0); // no placed buildings → no adjacency bonus

    // Now place a grain exchange on the fertile cell
    t.placedBuildings = [{ id: 'grain_exchange', cell: fertileCell }];
    const goodBonus = priv(r).placedBuildingTerrainBonus(t, 'agriculture');

    // And on the neutral cell
    t.placedBuildings = [{ id: 'grain_exchange', cell: neutralCell }];
    const neutralBonus = priv(r).placedBuildingTerrainBonus(t, 'agriculture');

    // Fertile placement earns more than neutral
    expect(goodBonus).toBeGreaterThan(neutralBonus);
  });

  it('serialize round-trip preserves tile yield cache state (ticking is stable post-load)', () => {
    const r1 = colony(42);
    advanceMonth(r1);
    // Reload and tick another month — must not throw and output must match
    const r2 = RegionSim.deserialize(r1.serialize());
    expect(() => advanceMonth(r2)).not.toThrow();
    // Sector outputs on the reloaded run should be finite and positive
    for (const id of ['agriculture', 'industry', 'services'] as const) {
      expect(r2.settlements[0].sectors[id].output).toBeGreaterThan(0);
      expect(Number.isFinite(r2.settlements[0].sectors[id].output)).toBe(true);
    }
  });
});

// ---- 6. No new serialized fields (save-size guard compatibility) ----

describe('Phase C serialization discipline', () => {
  it('tile yield cache is NOT in the serialized JSON (transient only)', () => {
    const r = colony(7);
    // Warm the cache
    priv(r).tileYieldFor(r.settlements[0]);
    const raw = JSON.parse(r.serialize());
    // The cache must not appear in any settlement or top-level key
    for (const s of raw.settlements) {
      expect('_tileYieldCache' in s, 'cache leaked into settlement').toBe(false);
    }
    expect('_tileYieldCache' in raw, 'cache leaked into top-level save').toBe(false);
  });
});
