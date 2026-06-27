import { describe, expect, it } from 'vitest';
import { RegionSim, CITY_WORK_RADIUS } from '../src/sim/region';
import { RegionMap, REGION_N } from '../src/sim/worldgen';
import { Weather } from '../src/sim/weather';
import { Rng } from '../src/sim/rng';

/**
 * Spatial-4X Phase B: buildings get a hex (`placedBuildings`) and you place them
 * in the city's worked ring. Render-only — `buildings` stays the economy source,
 * so the macro economy is unchanged (guarded by the full suite). These pin the
 * placement validation, the buildCity cell path, the auto-site/migration, and the
 * save round-trip.
 */
function colony(seed: number): RegionSim {
  const r = RegionSim.foundColony(new Rng(seed), new RegionMap(seed), new Weather(seed), {});
  r.treasury = 1_000_000;
  return r;
}

describe('canPlaceBuildingAt — worked-ring validation', () => {
  it('accepts ring cells and rejects the centre / out-of-ring', () => {
    const r = colony(3);
    const home = r.settlements[0];
    const c = r.map.coordToCell(home.x, home.y);
    expect(r.canPlaceBuildingAt(home.id, c.x * REGION_N + c.y)).toBe(false); // the centre itself
    const cells = r.buildablePlacementCells(home.id);
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      expect(r.canPlaceBuildingAt(home.id, cell)).toBe(true);
      const col = Math.floor(cell / REGION_N), row = cell % REGION_N;
      expect(r.map.isWater(col, row)).toBe(false); // never water
    }
    // A cell on the far edge is well outside the ring.
    expect(r.canPlaceBuildingAt(home.id, 0)).toBe(false);
  });

  it('rejects a cell once it is occupied', () => {
    const r = colony(3);
    const home = r.settlements[0];
    const cell = r.buildablePlacementCells(home.id)[0];
    home.placedBuildings.push({ id: 'grain_exchange', cell });
    expect(r.canPlaceBuildingAt(home.id, cell)).toBe(false);
  });
});

describe('buildCity — placement', () => {
  it('breaks ground at a chosen valid cell and stores it on the construction', () => {
    const r = colony(5);
    const home = r.settlements[0];
    const cell = r.buildablePlacementCells(home.id)[0];
    expect(r.buildCity(home.id, 'grain_exchange', cell)).toBe(true);
    expect(home.construction?.id).toBe('grain_exchange');
    expect(home.construction?.cell).toBe(cell);
  });

  it('refuses an illegal placement cell', () => {
    const r = colony(5);
    const home = r.settlements[0];
    expect(r.buildCity(home.id, 'grain_exchange', 0)).toBe(false); // far corner, out of ring
    expect(home.construction).toBeNull();
  });
});

describe('ensurePlacements — auto-site / migration', () => {
  it('sites every unplaced building deterministically in the ring', () => {
    const r = colony(9);
    const home = r.settlements[0];
    home.buildings = ['grain_exchange', 'market_hall', 'waterworks'];
    home.placedBuildings = [];
    r.ensurePlacements(home);
    expect(home.placedBuildings.length).toBe(3);
    const cells = new Set(home.placedBuildings.map((p) => p.cell));
    expect(cells.size).toBe(3); // distinct hexes
    for (const p of home.placedBuildings) {
      const col = Math.floor(p.cell / REGION_N), row = p.cell % REGION_N;
      const c = r.map.coordToCell(home.x, home.y);
      expect(Math.max(Math.abs(col - c.x), Math.abs(row - c.y))).toBeLessThanOrEqual(CITY_WORK_RADIUS);
    }
  });

  it('is deterministic for a fixed seed', () => {
    const a = colony(11); const b = colony(11);
    for (const r of [a, b]) { r.settlements[0].buildings = ['grain_exchange', 'market_hall']; r.settlements[0].placedBuildings = []; r.ensurePlacements(r.settlements[0]); }
    expect(a.settlements[0].placedBuildings).toEqual(b.settlements[0].placedBuildings);
  });
});

describe('placements survive save/load (and migrate old saves)', () => {
  it('round-trips placedBuildings', () => {
    const r = colony(7);
    const home = r.settlements[0];
    const cell = r.buildablePlacementCells(home.id)[0];
    home.buildings = ['grain_exchange'];
    home.placedBuildings = [{ id: 'grain_exchange', cell }];
    const r2 = RegionSim.deserialize(r.serialize());
    expect(r2.settlements[0].placedBuildings).toEqual([{ id: 'grain_exchange', cell }]);
  });

  it('migrates a pre-Phase-B save (buildings, no placements)', () => {
    const r = colony(7);
    r.settlements[0].buildings = ['grain_exchange', 'market_hall'];
    r.settlements[0].placedBuildings = [];
    const raw = JSON.parse(r.serialize());
    for (const s of raw.settlements) delete s.placedBuildings; // simulate an old save
    const r2 = RegionSim.deserialize(JSON.stringify(raw));
    expect(r2.settlements[0].placedBuildings.length).toBe(2); // auto-sited on load
  });
});
