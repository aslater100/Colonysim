import { describe, expect, it } from 'vitest';
import { RegionSim, SEA_LANE_CAPACITY } from '../src/sim/region';
import { RegionMap, REGION_N } from '../src/sim/worldgen';
import { Weather } from '../src/sim/weather';
import { Rng } from '../src/sim/rng';

/**
 * Sea lanes (the maritime layer): when two coastal towns sit on different
 * continents/islands, the auto-blazed trail becomes a real sea lane —
 * pathfound across the water, flagged `sea`, carrying shipping capacity — not
 * a straight chord over the land the corridor A* refuses to cross.
 */

function colony(seed: number): RegionSim {
  return RegionSim.foundColony(new Rng(seed), new RegionMap(seed), new Weather(seed), {});
}

/** First coastal land cell belonging to landmass `lm` (adjacent to open sea). */
function coastalCellOf(m: RegionMap, lm: number): { x: number; y: number } | null {
  for (let y = 1; y < REGION_N - 1; y++) {
    for (let x = 1; x < REGION_N - 1; x++) {
      if (m.landmassAt(x, y) !== lm) continue;
      if (m.at(x + 1, y).biome === 'sea' || m.at(x - 1, y).biome === 'sea'
        || m.at(x, y + 1).biome === 'sea' || m.at(x, y - 1).biome === 'sea') return { x, y };
    }
  }
  return null;
}

/** Clone the founding settlement onto a new cell to stand up a second town fast. */
function addTownAt(r: RegionSim, cell: { x: number; y: number }): number {
  const home = r.settlements[0];
  const coord = r.map.cellToCoord(cell.x, cell.y);
  const id = r.nextId++;
  r.settlements.push({
    ...home,
    id,
    name: `Town ${id}`,
    x: coord.rx,
    y: coord.ry,
    site: r.map.siteAt(cell.x, cell.y),
    buildings: [],
    placedBuildings: [],
    placedDistricts: [],
    construction: null,
  });
  return id;
}

describe('sea lanes — blazeTrail across water', () => {
  it('lays a real sea lane between towns on different continents', () => {
    const m = new RegionMap(42);
    const r = RegionSim.foundColony(new Rng(42), m, new Weather(42), {});
    const home = r.settlements[0];
    const homeLm = m.landmassAt(...(Object.values(m.coordToCell(home.x, home.y)) as [number, number]));

    // A coastal cell on the biggest OTHER continent.
    const other = m.landmassSizes
      .map((n, i) => ({ i, n }))
      .filter((o) => o.i !== homeLm && o.n >= 500)
      .sort((a, b) => b.n - a.n)[0];
    expect(other).toBeTruthy();
    const cell = coastalCellOf(m, other.i)!;
    expect(cell).toBeTruthy();

    const townId = addTownAt(r, cell);
    r.blazeTrail(home.id, townId);
    const route = r.routeBetween(home.id, townId)!;
    expect(route).toBeTruthy();
    expect(route.sea, 'route across water is a sea lane').toBe(true);
    // The path is genuine water pathfinding, not a two-point chord.
    expect(route.path.length).toBeGreaterThan(2);
    const waterCells = route.path.filter((p) => m.isWater(p.x, p.y)).length;
    expect(waterCells, 'the lane runs over the sea').toBeGreaterThan(0);
    // Shipping capacity, not the mule-train trail figure.
    expect(r.effectiveCapacity(route)).toBeCloseTo(SEA_LANE_CAPACITY, 5);
  });

  it('a same-continent link stays a land trail (no false sea lane)', () => {
    const m = new RegionMap(7);
    const r = RegionSim.foundColony(new Rng(7), m, new Weather(7), {});
    const home = r.settlements[0];
    const hc = m.coordToCell(home.x, home.y);
    const homeLm = m.landmassAt(hc.x, hc.y);

    // A settleable land cell a few hexes away on the SAME continent.
    let near: { x: number; y: number } | null = null;
    for (let rad = 4; rad < 20 && !near; rad++) {
      for (let dy = -rad; dy <= rad && !near; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          const x = hc.x + dx, y = hc.y + dy;
          if (x < 2 || y < 2 || x >= REGION_N - 2 || y >= REGION_N - 2) continue;
          if (m.landmassAt(x, y) === homeLm && m.siteScore(x, y) > 0
            && Math.hypot(dx, dy) >= 4) { near = { x, y }; break; }
        }
      }
    }
    expect(near).toBeTruthy();
    const townId = addTownAt(r, near!);
    r.blazeTrail(home.id, townId);
    const route = r.routeBetween(home.id, townId)!;
    expect(route.sea).toBeFalsy();
    expect(route.kind).toBe('trail');
  });
});
