import { describe, expect, it } from 'vitest';
import { RegionSim, DISTRICT_DEFS } from '../src/sim/region';
import { RegionMap, REGION_N } from '../src/sim/worldgen';
import { Weather } from '../src/sim/weather';
import { Rng } from '../src/sim/rng';
import { hexNeighbors } from '../src/sim/hex';

/**
 * Spatial-4X Phase D — DISTRICT placement category. A district is a themed zone the
 * player places (separate from buildings): it grants its sector a flat bonus AND
 * +DISTRICT_ZONE_BONUS for each same-sector building on an adjacent hex, capped at
 * DISTRICT_ZONE_CAP. Player-only — autoplay never zones, so a town with no districts
 * is byte-identical to base. Tests pin the rule, the cap, occupancy, the gates, the
 * placement preview, and serialization discipline.
 */

function colony(seed: number): RegionSim {
  const r = RegionSim.foundColony(new Rng(seed), new RegionMap(seed), new Weather(seed), {});
  r.treasury = 1_000_000;
  return r;
}

// white-box access to the private zone-bonus method
type Priv = { districtZoneBonus: (t: object, s: string) => number };
const priv = (r: RegionSim) => r as unknown as Priv;

const DISTRICT_ZONE_BONUS = 0.05; // mirrors RegionSim.DISTRICT_ZONE_BONUS
const DISTRICT_ZONE_CAP = 3;      // mirrors RegionSim.DISTRICT_ZONE_CAP
const FARM = DISTRICT_DEFS.find((d) => d.id === 'farming_district')!;

function cellColRow(cell: number): [number, number] {
  return [Math.floor(cell / REGION_N), cell % REGION_N];
}

/** A buildable cell plus a list of its buildable hex-neighbour cells, so a test can
 *  zone a district on `center` and surround it with same-sector buildings. Returns
 *  null if the seed's ring can't supply a centre with `wantNbrs` free neighbours. */
function hub(r: RegionSim, townId: number, wantNbrs: number): { center: number; nbrs: number[] } | null {
  const cells = new Set(r.buildablePlacementCells(townId));
  for (const center of cells) {
    const [col, row] = cellColRow(center);
    const nbrs = hexNeighbors(col, row)
      .map(([ax, ay]) => ax * REGION_N + ay)
      .filter((c) => cells.has(c));
    if (nbrs.length >= wantNbrs) return { center, nbrs: nbrs.slice(0, wantNbrs) };
  }
  return null;
}

function advanceMonth(r: RegionSim): void {
  for (let i = 0; i < 1440; i++) r.tick();
}

describe('districtZoneBonus — the rule', () => {
  it('is 0 in every sector for a town with no districts (byte-identical guard)', () => {
    const r = colony(7);
    const t = r.settlements[0];
    expect(t.placedDistricts).toEqual([]);
    for (const s of ['agriculture', 'industry', 'services', 'information']) {
      expect(priv(r).districtZoneBonus(t, s)).toBe(0);
    }
  });

  it('grants the flat bonus to its sector with no adjacent buildings', () => {
    const r = colony(7);
    const t = r.settlements[0];
    const cell = r.buildablePlacementCells(t.id)[0];
    t.placedDistricts = [{ id: 'farming_district', cell }];
    expect(priv(r).districtZoneBonus(t, 'agriculture')).toBeCloseTo(FARM.bonus, 10);
    // other sectors untouched
    expect(priv(r).districtZoneBonus(t, 'industry')).toBe(0);
    expect(priv(r).districtZoneBonus(t, 'services')).toBe(0);
  });

  it('adds DISTRICT_ZONE_BONUS for each adjacent same-sector building', () => {
    for (const seed of [3, 7, 11, 21, 42]) {
      const r = colony(seed);
      const t = r.settlements[0];
      const h = hub(r, t.id, 2);
      if (!h) continue;
      t.placedDistricts = [{ id: 'farming_district', cell: h.center }];
      t.placedBuildings = h.nbrs.map((cell) => ({ id: 'grain_exchange', cell }));
      // flat + 2 adjacent farms
      expect(priv(r).districtZoneBonus(t, 'agriculture'))
        .toBeCloseTo(FARM.bonus + 2 * DISTRICT_ZONE_BONUS, 10);
      return;
    }
    throw new Error('no seed produced a centre with two buildable neighbours');
  });

  it('caps the adjacency reward at DISTRICT_ZONE_CAP buildings', () => {
    for (const seed of [3, 7, 11, 21, 42, 99, 123]) {
      const r = colony(seed);
      const t = r.settlements[0];
      const h = hub(r, t.id, 4); // more neighbours than the cap (3)
      if (!h) continue;
      t.placedDistricts = [{ id: 'farming_district', cell: h.center }];
      t.placedBuildings = h.nbrs.map((cell) => ({ id: 'grain_exchange', cell }));
      // 4 adjacent farms, but only CAP are paid
      expect(priv(r).districtZoneBonus(t, 'agriculture'))
        .toBeCloseTo(FARM.bonus + DISTRICT_ZONE_CAP * DISTRICT_ZONE_BONUS, 10);
      return;
    }
    throw new Error('no seed produced a centre with four buildable neighbours');
  });

  it('only same-sector buildings count (a services building does not lift a farm zone)', () => {
    for (const seed of [3, 7, 11, 21, 42]) {
      const r = colony(seed);
      const t = r.settlements[0];
      const h = hub(r, t.id, 2);
      if (!h) continue;
      t.placedDistricts = [{ id: 'farming_district', cell: h.center }];
      t.placedBuildings = h.nbrs.map((cell) => ({ id: 'market_hall', cell })); // services
      // flat bonus only — no same-sector neighbour
      expect(priv(r).districtZoneBonus(t, 'agriculture')).toBeCloseTo(FARM.bonus, 10);
      return;
    }
    throw new Error('no seed produced a centre with two buildable neighbours');
  });
});

describe('placeDistrict — placement, occupancy & gates', () => {
  it('debits the treasury and the zone bonus takes effect immediately', () => {
    const r = colony(7);
    const t = r.settlements[0];
    const cell = r.buildablePlacementCells(t.id)[0];
    const before = r.treasury;
    expect(r.placeDistrict(t.id, 'farming_district', cell)).toBe(true);
    expect(t.placedDistricts).toEqual([{ id: 'farming_district', cell }]);
    expect(r.treasury).toBe(before - r.districtCost(FARM));
    expect(priv(r).districtZoneBonus(t, 'agriculture')).toBeCloseTo(FARM.bonus, 10);
  });

  it('a district occupies its hex — no building or second district may share it', () => {
    const r = colony(7);
    const t = r.settlements[0];
    const cell = r.buildablePlacementCells(t.id)[0];
    expect(r.placeDistrict(t.id, 'farming_district', cell)).toBe(true);
    expect(r.canPlaceBuildingAt(t.id, cell)).toBe(false);       // building blocked
    expect(r.placeDistrict(t.id, 'commercial_district', cell)).toBe(false); // overlap blocked
  });

  it('a building cell blocks a district', () => {
    const r = colony(7);
    const t = r.settlements[0];
    const cell = r.buildablePlacementCells(t.id)[0];
    t.placedBuildings = [{ id: 'grain_exchange', cell }];
    expect(r.canPlaceBuildingAt(t.id, cell)).toBe(false);
    expect(r.placeDistrict(t.id, 'farming_district', cell)).toBe(false);
  });

  it('enforces the per-city max (district-scale)', () => {
    const r = colony(7);
    const t = r.settlements[0];
    const cells = r.buildablePlacementCells(t.id);
    expect(r.placeDistrict(t.id, 'farming_district', cells[0])).toBe(true);
    // max is 1 → a second farming district anywhere fails the check
    expect(r.districtBuildCheck(t, FARM).ok).toBe(false);
    expect(r.placeDistrict(t.id, 'farming_district', cells[1])).toBe(false);
  });

  it('gates behind the prereq tech', () => {
    const r = colony(7);
    const t = r.settlements[0];
    const campus = DISTRICT_DEFS.find((d) => d.id === 'research_campus')!;
    expect(campus.prereq).toBe('computing');
    const check = r.districtBuildCheck(t, campus); // fresh colony lacks 'computing'
    expect(check.ok).toBe(false);
    expect(check.reason.toLowerCase()).toContain('requires');
  });

  it('gates on the treasury', () => {
    const r = colony(7);
    const t = r.settlements[0];
    r.treasury = 0;
    expect(r.districtBuildCheck(t, FARM).ok).toBe(false);
    expect(r.placeDistrict(t.id, 'farming_district', r.buildablePlacementCells(t.id)[0])).toBe(false);
  });
});

describe('districtPlacementPreview — matches the live bonus', () => {
  it('previews flat + adjacency reward, equal to the post-placement zone bonus', () => {
    for (const seed of [3, 7, 11, 21, 42]) {
      const r = colony(seed);
      const t = r.settlements[0];
      const h = hub(r, t.id, 2);
      if (!h) continue;
      t.placedBuildings = h.nbrs.map((cell) => ({ id: 'grain_exchange', cell }));
      const pv = r.districtPlacementPreview(t.id, h.center, 'farming_district');
      expect(pv).not.toBeNull();
      expect(pv!.terrainBonus).toBeCloseTo(FARM.bonus, 10);          // flat themed bonus
      expect(pv!.districtBonus).toBeCloseTo(2 * DISTRICT_ZONE_BONUS, 10); // 2 adjacent farms
      expect(pv!.total).toBeCloseTo(pv!.terrainBonus + pv!.districtBonus, 10);
      // and it equals what the live path yields once actually placed
      r.placeDistrict(t.id, 'farming_district', h.center);
      expect(priv(r).districtZoneBonus(t, 'agriculture')).toBeCloseTo(pv!.total, 10);
      return;
    }
    throw new Error('no seed produced a centre with two buildable neighbours');
  });

  it('returns null for an illegal cell', () => {
    const r = colony(7);
    const t = r.settlements[0];
    const cell = r.buildablePlacementCells(t.id)[0];
    r.placeDistrict(t.id, 'farming_district', cell);
    expect(r.districtPlacementPreview(t.id, cell, 'commercial_district')).toBeNull(); // occupied
    expect(r.districtPlacementPreview(t.id, cell, 'no_such_district')).toBeNull();     // unknown def
  });
});

describe('districts — serialization & determinism', () => {
  it('round-trips placedDistricts losslessly and preserves the zone bonus', () => {
    const r = colony(11);
    const t = r.settlements[0];
    const h = hub(r, t.id, 2);
    if (h) {
      t.placedBuildings = h.nbrs.map((cell) => ({ id: 'grain_exchange', cell }));
      r.placeDistrict(t.id, 'farming_district', h.center);
    }
    const before = priv(r).districtZoneBonus(t, 'agriculture');
    const json = r.serialize();
    const back = RegionSim.deserialize(json);
    const bt = back.settlements[0];
    expect(bt.placedDistricts).toEqual(t.placedDistricts);
    expect(priv(back).districtZoneBonus(bt, 'agriculture')).toBeCloseTo(before, 10);
    // re-serialize is a fixed point (no key-order drift from the new field)
    expect(back.serialize()).toBe(json);
  });

  it('is deterministic across two same-seed sims', () => {
    const a = colony(21), b = colony(21);
    const ha = hub(a, a.settlements[0].id, 2), hb = hub(b, b.settlements[0].id, 2);
    expect(ha).toEqual(hb); // same seed → same ring → same hub
    if (!ha || !hb) return;
    a.placeDistrict(a.settlements[0].id, 'farming_district', ha.center);
    b.placeDistrict(b.settlements[0].id, 'farming_district', hb.center);
    expect(priv(a).districtZoneBonus(a.settlements[0], 'agriculture'))
      .toBe(priv(b).districtZoneBonus(b.settlements[0], 'agriculture'));
  });

  it('a zoned, well-sited district lifts the town agriculture output', () => {
    for (const seed of [3, 7, 11, 21, 42]) {
      const base = colony(seed);
      const tb = base.settlements[0];
      const h = hub(base, tb.id, 2);
      if (!h) continue;
      // both runs place the same farms; only the zoned run adds the district
      const zoned = colony(seed);
      const tz = zoned.settlements[0];
      tb.placedBuildings = h.nbrs.map((cell) => ({ id: 'grain_exchange', cell }));
      tz.placedBuildings = h.nbrs.map((cell) => ({ id: 'grain_exchange', cell }));
      zoned.placeDistrict(tz.id, 'farming_district', h.center);
      advanceMonth(base);
      advanceMonth(zoned);
      expect(tz.sectors.agriculture.output).toBeGreaterThan(tb.sectors.agriculture.output);
      return;
    }
    throw new Error('no seed produced a centre with two buildable neighbours');
  });
});
