import { describe, expect, it } from 'vitest';
import { RegionSim } from '../src/sim/region';
import { RegionMap, REGION_N } from '../src/sim/worldgen';
import { Weather } from '../src/sim/weather';
import { Rng } from '../src/sim/rng';
import { hexNeighbors } from '../src/sim/hex';

/**
 * Spatial-4X Phase D slice 2 — DISTRICTS. Placed buildings of the same sector on
 * adjacent hexes form a district and earn a clustering synergy bonus (the Civ-6
 * district hook). Tests pin the adjacency rule, the per-building cap, the
 * same-sector-only requirement, the cache, and serialization discipline.
 */

function colony(seed: number): RegionSim {
  const r = RegionSim.foundColony(new Rng(seed), new RegionMap(seed), new Weather(seed), {});
  r.treasury = 1_000_000;
  return r;
}

// white-box access to the private district method
type Priv = { districtAdjacencyBonus: (t: object, s: string) => number };
const priv = (r: RegionSim) => r as unknown as Priv;

const DISTRICT_ADJ_BONUS = 0.04; // mirrors RegionSim.DISTRICT_ADJ_BONUS
const DISTRICT_ADJ_CAP = 2;      // mirrors RegionSim.DISTRICT_ADJ_CAP

function cellColRow(cell: number): [number, number] {
  return [Math.floor(cell / REGION_N), cell % REGION_N];
}

/** Find a chain of `n` mutually-buildable cells where each step is a hex neighbour
 *  of the previous one (a connected district shape). Returns null if the seed's
 *  ring can't supply one. */
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

function advanceMonth(r: RegionSim): void {
  for (let i = 0; i < 1440; i++) r.tick();
}

describe('districtAdjacencyBonus — the adjacency rule', () => {
  it('is 0 with fewer than two same-sector placements', () => {
    const r = colony(7);
    const t = r.settlements[0];
    t.placedBuildings = [];
    expect(priv(r).districtAdjacencyBonus(t, 'agriculture')).toBe(0);
    const cells = r.buildablePlacementCells(t.id);
    t.placedBuildings = [{ id: 'grain_exchange', cell: cells[0] }];
    expect(priv(r).districtAdjacencyBonus(t, 'agriculture')).toBe(0);
  });

  it('two same-sector buildings on adjacent hexes form a district (each gains one pulse)', () => {
    for (const seed of [3, 7, 11, 21]) {
      const r = colony(seed);
      const t = r.settlements[0];
      const pair = district(r, t.id, 2);
      if (!pair) continue;
      t.placedBuildings = pair.map((cell) => ({ id: 'grain_exchange', cell }));
      // each of the two buildings has exactly one same-sector neighbour
      expect(priv(r).districtAdjacencyBonus(t, 'agriculture')).toBeCloseTo(2 * DISTRICT_ADJ_BONUS, 10);
      return; // one good seed is enough
    }
    throw new Error('no seed produced an adjacent buildable pair');
  });

  it('two same-sector buildings that are NOT adjacent earn nothing', () => {
    const r = colony(7);
    const t = r.settlements[0];
    const cells = r.buildablePlacementCells(t.id);
    // pick two cells that are not hex neighbours
    let a = -1, b = -1;
    outer: for (const x of cells) {
      const [cx, cy] = cellColRow(x);
      const nbrs = new Set(hexNeighbors(cx, cy).map(([ax, ay]) => ax * REGION_N + ay));
      for (const y of cells) {
        if (y !== x && !nbrs.has(y)) { a = x; b = y; break outer; }
      }
    }
    expect(a).toBeGreaterThanOrEqual(0);
    t.placedBuildings = [{ id: 'grain_exchange', cell: a }, { id: 'grain_exchange', cell: b }];
    expect(priv(r).districtAdjacencyBonus(t, 'agriculture')).toBe(0);
  });

  it('mixed-sector neighbours do not form a district (legible: same sector only)', () => {
    for (const seed of [3, 7, 11, 21]) {
      const r = colony(seed);
      const t = r.settlements[0];
      const pair = district(r, t.id, 2);
      if (!pair) continue;
      // one agriculture, one industry on adjacent cells — neither has a same-sector neighbour
      t.placedBuildings = [
        { id: 'grain_exchange', cell: pair[0] }, // agriculture
        { id: 'workshops', cell: pair[1] },       // industry
      ];
      expect(priv(r).districtAdjacencyBonus(t, 'agriculture')).toBe(0);
      expect(priv(r).districtAdjacencyBonus(t, 'industry')).toBe(0);
      return;
    }
    throw new Error('no seed produced an adjacent buildable pair');
  });

  it('a building stops earning past the adjacency cap', () => {
    // A 4-cell connected blob: the central cell can touch 3 neighbours but is
    // capped at DISTRICT_ADJ_CAP. We assert the total is bounded by the cap.
    for (const seed of [3, 7, 11, 21, 42, 99]) {
      const r = colony(seed);
      const t = r.settlements[0];
      const blob = district(r, t.id, 4);
      if (!blob) continue;
      t.placedBuildings = blob.map((cell) => ({ id: 'grain_exchange', cell }));
      const bonus = priv(r).districtAdjacencyBonus(t, 'agriculture');
      // No single building can contribute more than CAP pulses, so the whole
      // cluster is at most (#buildings × CAP) pulses.
      expect(bonus).toBeLessThanOrEqual(blob.length * DISTRICT_ADJ_CAP * DISTRICT_ADJ_BONUS + 1e-9);
      expect(bonus).toBeGreaterThan(0);
      return;
    }
    throw new Error('no seed produced a 4-cell district');
  });
});

describe('districtAdjacencyBonus — cache & determinism', () => {
  it('recomputes when the placement count changes', () => {
    for (const seed of [3, 7, 11, 21]) {
      const r = colony(seed);
      const t = r.settlements[0];
      const pair = district(r, t.id, 2);
      if (!pair) continue;
      t.placedBuildings = [{ id: 'grain_exchange', cell: pair[0] }];
      expect(priv(r).districtAdjacencyBonus(t, 'agriculture')).toBe(0); // single → no district, caches len=1
      t.placedBuildings.push({ id: 'grain_exchange', cell: pair[1] });   // len now 2 → cache invalidated
      expect(priv(r).districtAdjacencyBonus(t, 'agriculture')).toBeCloseTo(2 * DISTRICT_ADJ_BONUS, 10);
      return;
    }
    throw new Error('no seed produced an adjacent buildable pair');
  });

  it('is deterministic across two same-seed sims', () => {
    const a = colony(11), b = colony(11);
    const ta = a.settlements[0], tb = b.settlements[0];
    const pa = district(a, ta.id, 3), pb = district(b, tb.id, 3);
    expect(pa).toEqual(pb); // same seed → same ring → same district
    if (!pa || !pb) return;
    ta.placedBuildings = pa.map((cell) => ({ id: 'grain_exchange', cell }));
    tb.placedBuildings = pb.map((cell) => ({ id: 'grain_exchange', cell }));
    expect(priv(a).districtAdjacencyBonus(ta, 'agriculture'))
      .toBe(priv(b).districtAdjacencyBonus(tb, 'agriculture'));
  });
});

describe('districts — serialization discipline & integration', () => {
  it('does not leak _districtCache into the serialized save', () => {
    const r = colony(7);
    const t = r.settlements[0];
    const pair = district(r, t.id, 2);
    if (pair) t.placedBuildings = pair.map((cell) => ({ id: 'grain_exchange', cell }));
    priv(r).districtAdjacencyBonus(t, 'agriculture'); // populate the cache
    const json = JSON.stringify(r.serialize());
    expect(json.includes('_districtCache')).toBe(false);
  });

  it('a clustered agriculture district lifts sector output over a scattered layout', () => {
    for (const seed of [3, 7, 11, 21, 42]) {
      const clustered = colony(seed);
      const tc = clustered.settlements[0];
      const blob = district(clustered, tc.id, 3);
      if (!blob) continue;
      // need a non-adjacent triple for the scattered control on the same seed
      const all = clustered.buildablePlacementCells(tc.id);
      const scatter: number[] = [];
      for (const c of all) {
        const [cx, cy] = cellColRow(c);
        const nbrs = new Set(hexNeighbors(cx, cy).map(([ax, ay]) => ax * REGION_N + ay));
        if (!scatter.some((s) => nbrs.has(s))) scatter.push(c);
        if (scatter.length === 3) break;
      }
      if (scatter.length < 3) continue;

      const scattered = colony(seed);
      const ts = scattered.settlements[0];
      tc.placedBuildings = blob.map((cell) => ({ id: 'grain_exchange', cell }));
      ts.placedBuildings = scatter.map((cell) => ({ id: 'grain_exchange', cell }));

      const bc = priv(clustered).districtAdjacencyBonus(tc, 'agriculture');
      const bs = priv(scattered).districtAdjacencyBonus(ts, 'agriculture');
      expect(bc).toBeGreaterThan(bs);
      expect(bs).toBe(0);
      return;
    }
    throw new Error('no seed produced both a 3-cluster and a scattered triple');
  });
});
