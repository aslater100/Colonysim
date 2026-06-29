import { describe, expect, it } from 'vitest';
import { RegionSim } from '../src/sim/region';
import { RegionMap, REGION_N } from '../src/sim/worldgen';
import { Weather } from '../src/sim/weather';
import { Rng } from '../src/sim/rng';
import { hexNeighbors } from '../src/sim/hex';

/**
 * Spatial-4X Phase D — PLACEMENT PREVIEW. `placementPreview(townId, cell, defId)`
 * reports the output bonus a building WOULD earn at a candidate cell — a terrain
 * pulse (same rule as placedBuildingTerrainBonus) plus the MARGINAL district-synergy
 * gain to the town — so the placement UI can colour the best sites. It is pure /
 * read-only, so these tests also pin that it never mutates the sim and that its
 * district number agrees exactly with the live districtAdjacencyBonus delta.
 */

const TILE_PLACE_BONUS = 0.05; // mirrors RegionSim.TILE_PLACE_BONUS
const DISTRICT_ADJ_BONUS = 0.04; // mirrors RegionSim.DISTRICT_ADJ_BONUS

function colony(seed: number): RegionSim {
  const r = RegionSim.foundColony(new Rng(seed), new RegionMap(seed), new Weather(seed), {});
  r.treasury = 1_000_000;
  return r;
}

// white-box access to the private district method + the map (for the terrain rule)
type Cell = { fertility: number; river: boolean; ore: boolean; roughness: number };
type Priv = {
  districtAdjacencyBonus: (t: object, s: string) => number;
  map: { at: (col: number, row: number) => Cell };
};
const priv = (r: RegionSim) => r as unknown as Priv;

function cellColRow(cell: number): [number, number] {
  return [Math.floor(cell / REGION_N), cell % REGION_N];
}

/** A chain of `n` mutually-buildable cells, each a hex neighbour of the previous
 *  (a connected district shape). Null if the seed's ring can't supply one. */
function district(r: RegionSim, townId: number, n: number): number[] | null {
  const cells = new Set(r.buildablePlacementCells(townId));
  for (const start of cells) {
    const chain = [start];
    const used = new Set([start]);
    let head = start;
    while (chain.length < n) {
      const [col, row] = cellColRow(head);
      const next = hexNeighbors(col, row)
        .map(([ax, ay]) => ax * REGION_N + ay)
        .find((c) => cells.has(c) && !used.has(c));
      if (next === undefined) break;
      chain.push(next); used.add(next); head = next;
    }
    if (chain.length === n) return chain;
  }
  return null;
}

describe('placementPreview — validity guards', () => {
  it('returns null for an unknown building def', () => {
    const r = colony(7);
    const t = r.settlements[0];
    const cell = r.buildablePlacementCells(t.id)[0];
    expect(r.placementPreview(t.id, cell, 'no_such_building')).toBeNull();
  });

  it('returns null for an unknown town', () => {
    const r = colony(7);
    expect(r.placementPreview(99999, 0, 'grain_exchange')).toBeNull();
  });

  it('returns null for a cell outside the buildable ring', () => {
    const r = colony(7);
    const t = r.settlements[0];
    const legal = new Set(r.buildablePlacementCells(t.id));
    let notCell = -1;
    for (let c = 0; c < REGION_N * REGION_N; c++) { if (!legal.has(c)) { notCell = c; break; } }
    expect(notCell).toBeGreaterThanOrEqual(0);
    expect(r.placementPreview(t.id, notCell, 'grain_exchange')).toBeNull();
  });

  it('returns null for an already-occupied cell', () => {
    const r = colony(7);
    const t = r.settlements[0];
    const cell = r.buildablePlacementCells(t.id)[0];
    t.placedBuildings = [{ id: 'grain_exchange', cell }];
    expect(r.placementPreview(t.id, cell, 'grain_exchange')).toBeNull();
  });
});

describe('placementPreview — terrain match', () => {
  it("an agriculture building earns the terrain pulse iff the cell suits agriculture", () => {
    for (const seed of [3, 7, 11, 21, 42]) {
      const r = colony(seed);
      const t = r.settlements[0];
      for (const cell of r.buildablePlacementCells(t.id)) {
        const [col, row] = cellColRow(cell);
        const c = priv(r).map.at(col, row);
        const expected = (c.fertility > 1.05 || c.river) ? TILE_PLACE_BONUS : 0;
        const pv = r.placementPreview(t.id, cell, 'grain_exchange')!;
        expect(pv.sector).toBe('agriculture');
        expect(pv.terrainBonus).toBeCloseTo(expected, 10);
      }
    }
  });

  it("an industry building earns the pulse iff the cell suits industry", () => {
    for (const seed of [3, 7, 11, 21, 42]) {
      const r = colony(seed);
      const t = r.settlements[0];
      for (const cell of r.buildablePlacementCells(t.id)) {
        const [col, row] = cellColRow(cell);
        const c = priv(r).map.at(col, row);
        const expected = (c.ore || c.roughness > 0.35) ? TILE_PLACE_BONUS : 0;
        const pv = r.placementPreview(t.id, cell, 'ironworks')!;
        expect(pv.sector).toBe('industry');
        expect(pv.terrainBonus).toBeCloseTo(expected, 10);
      }
    }
  });

  it("an 'all' building earns the pulse for every matching terrain rule (sum)", () => {
    for (const seed of [3, 7, 11, 21, 42]) {
      const r = colony(seed);
      const t = r.settlements[0];
      const coastal = t.site.coastal;
      for (const cell of r.buildablePlacementCells(t.id)) {
        const [col, row] = cellColRow(cell);
        const c = priv(r).map.at(col, row);
        let matches = 0;
        if (c.fertility > 1.05 || c.river) matches++;
        if (c.ore || c.roughness > 0.35) matches++;
        if (c.river || coastal) matches++;
        const pv = r.placementPreview(t.id, cell, 'power_station')!; // sector 'all'
        expect(pv.sector).toBe('all');
        expect(pv.terrainBonus).toBeCloseTo(matches * TILE_PLACE_BONUS, 10);
        expect(pv.districtBonus).toBe(0); // 'all' never forms a district
      }
    }
  });
});

describe('placementPreview — district synergy (marginal)', () => {
  it('adding a second same-sector building adjacent to the first scores one pulse each', () => {
    for (const seed of [3, 7, 11, 21]) {
      const r = colony(seed);
      const t = r.settlements[0];
      const pair = district(r, t.id, 2);
      if (!pair) continue;
      t.placedBuildings = [{ id: 'grain_exchange', cell: pair[0] }];
      const pv = r.placementPreview(t.id, pair[1], 'grain_exchange')!;
      // before: a lone building scores 0; after: an adjacent pair scores 2 pulses.
      expect(pv.districtBonus).toBeCloseTo(2 * DISTRICT_ADJ_BONUS, 10);
      return;
    }
    throw new Error('no seed produced an adjacent buildable pair');
  });

  it('districtBonus equals the live districtAdjacencyBonus delta exactly (incl. neighbour lift)', () => {
    for (const seed of [3, 7, 11, 21, 42, 99]) {
      const r = colony(seed);
      const t = r.settlements[0];
      const chain = district(r, t.id, 3);
      if (!chain) continue;
      // place the first two; preview adding the third (which lifts its neighbour too)
      t.placedBuildings = [
        { id: 'grain_exchange', cell: chain[0] },
        { id: 'grain_exchange', cell: chain[1] },
      ];
      const before = priv(r).districtAdjacencyBonus(t, 'agriculture');
      const pv = r.placementPreview(t.id, chain[2], 'grain_exchange')!;
      t.placedBuildings.push({ id: 'grain_exchange', cell: chain[2] });
      const after = priv(r).districtAdjacencyBonus(t, 'agriculture');
      expect(pv.districtBonus).toBeCloseTo(after - before, 10);
      expect(after - before).toBeGreaterThan(0);
      return;
    }
    throw new Error('no seed produced a 3-cell chain');
  });

  it('a non-adjacent candidate earns no district bonus', () => {
    const r = colony(7);
    const t = r.settlements[0];
    const cells = r.buildablePlacementCells(t.id);
    // find a placed cell and a candidate that are not hex neighbours
    let placedCell = -1, candidate = -1;
    outer: for (const x of cells) {
      const [cx, cy] = cellColRow(x);
      const nbrs = new Set(hexNeighbors(cx, cy).map(([ax, ay]) => ax * REGION_N + ay));
      for (const y of cells) {
        if (y !== x && !nbrs.has(y)) { placedCell = x; candidate = y; break outer; }
      }
    }
    expect(placedCell).toBeGreaterThanOrEqual(0);
    t.placedBuildings = [{ id: 'grain_exchange', cell: placedCell }];
    const pv = r.placementPreview(t.id, candidate, 'grain_exchange')!;
    expect(pv.districtBonus).toBe(0);
  });

  it('a different-sector neighbour does not form a district', () => {
    for (const seed of [3, 7, 11, 21]) {
      const r = colony(seed);
      const t = r.settlements[0];
      const pair = district(r, t.id, 2);
      if (!pair) continue;
      t.placedBuildings = [{ id: 'ironworks', cell: pair[0] }]; // industry
      const pv = r.placementPreview(t.id, pair[1], 'grain_exchange')!; // agriculture
      expect(pv.districtBonus).toBe(0);
      return;
    }
    throw new Error('no seed produced an adjacent buildable pair');
  });
});

describe('placementPreview — purity & totals', () => {
  it('total is exactly terrainBonus + districtBonus', () => {
    for (const seed of [3, 7, 11, 21, 42]) {
      const r = colony(seed);
      const t = r.settlements[0];
      const pair = district(r, t.id, 2);
      if (!pair) continue;
      t.placedBuildings = [{ id: 'grain_exchange', cell: pair[0] }];
      const pv = r.placementPreview(t.id, pair[1], 'grain_exchange')!;
      expect(pv.total).toBeCloseTo(pv.terrainBonus + pv.districtBonus, 10);
      return;
    }
    throw new Error('no seed produced an adjacent buildable pair');
  });

  it('does not mutate placedBuildings and is deterministic', () => {
    const r = colony(11);
    const t = r.settlements[0];
    const pair = district(r, t.id, 2)!;
    t.placedBuildings = [{ id: 'grain_exchange', cell: pair[0] }];
    const lenBefore = t.placedBuildings.length;
    const a = r.placementPreview(t.id, pair[1], 'grain_exchange')!;
    const b = r.placementPreview(t.id, pair[1], 'grain_exchange')!;
    expect(t.placedBuildings.length).toBe(lenBefore); // pure — no side effects
    expect(a).toEqual(b); // deterministic
  });
});
