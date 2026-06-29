import { describe, expect, it } from 'vitest';
import { RegionSim } from '../src/sim/region';
import type { Settlement, SectorId, SectorBonusBreakdown } from '../src/sim/region';
import { RegionMap, REGION_N } from '../src/sim/worldgen';
import { Weather } from '../src/sim/weather';
import { Rng } from '../src/sim/rng';
import { hexNeighbors } from '../src/sim/hex';

/**
 * Per-sector output-bonus BREAKDOWN — the read-only "why does this sector produce
 * what it does" readout behind the city panel. `sectorBonusBreakdown(townId, sector)`
 * decomposes a town's spatial output bonus into buildings / terrain / terrain-match /
 * district-clustering / district-zone / wonder. The KEY invariant: it is the single
 * source of truth — the live economy's `buildingBonus` returns `breakdown.total`, so
 * `total` equals the bonus that actually drives output BIT-FOR-BIT (proven with `toBe`,
 * not `toBeCloseTo`). Pure / read-only → the sim stays byte-identical.
 */

const SECTORS: SectorId[] = ['agriculture', 'industry', 'services', 'information'];

function colony(seed: number): RegionSim {
  const r = RegionSim.foundColony(new Rng(seed), new RegionMap(seed), new Weather(seed), {});
  r.treasury = 1_000_000;
  return r;
}

// white-box access to the private bonus methods the public readout must mirror
type Priv = {
  buildingBonus: (t: object, s: string) => number;
  sectorBonusParts: (t: object, s: string) => SectorBonusBreakdown;
  placedBuildingTerrainBonus: (t: object, s: string) => number;
  districtAdjacencyBonus: (t: object, s: string) => number;
  districtZoneBonus: (t: object, s: string) => number;
  wonderBonus: (t: object, s: string) => number;
  tileYieldFor: (t: object) => Partial<Record<SectorId, number>>;
};
const priv = (r: RegionSim) => r as unknown as Priv;

function cellColRow(cell: number): [number, number] {
  return [Math.floor(cell / REGION_N), cell % REGION_N];
}

/** A buildable cell plus a list of its buildable hex-neighbour cells. */
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

describe('sectorBonusBreakdown — single source of truth (byte-identical guard)', () => {
  it('total equals the private buildingBonus EXACTLY, every seed × sector', () => {
    for (const seed of [1, 3, 7, 11, 21, 42]) {
      const r = colony(seed);
      const t = r.settlements[0];
      for (const s of SECTORS) {
        const bd = r.sectorBonusBreakdown(t.id, s)!;
        expect(bd).not.toBeNull();
        // toBe (not toBeCloseTo): the refactor must be bit-for-bit identical, since
        // buildingBonus now literally returns sectorBonusParts(...).total.
        expect(bd.total).toBe(priv(r).buildingBonus(t, s));
      }
    }
  });

  it('total equals the sum of its own named parts exactly', () => {
    for (const seed of [2, 5, 13]) {
      const r = colony(seed);
      const t = r.settlements[0];
      for (const s of SECTORS) {
        const bd = r.sectorBonusBreakdown(t.id, s)!;
        const sum = bd.buildings + bd.terrain + bd.terrainMatch +
          bd.districtAdjacency + bd.districtZone + bd.wonder;
        expect(bd.total).toBe(sum);
        expect(bd.sector).toBe(s);
      }
    }
  });

  it('each component equals its corresponding live private method', () => {
    const r = colony(7);
    const t = r.settlements[0];
    for (const s of SECTORS) {
      const bd = r.sectorBonusBreakdown(t.id, s)!;
      expect(bd.terrain).toBe(priv(r).tileYieldFor(t)[s] ?? 0);
      expect(bd.terrainMatch).toBe(priv(r).placedBuildingTerrainBonus(t, s));
      expect(bd.districtAdjacency).toBe(priv(r).districtAdjacencyBonus(t, s));
      expect(bd.districtZone).toBe(priv(r).districtZoneBonus(t, s));
      expect(bd.wonder).toBe(priv(r).wonderBonus(t, s));
    }
  });
});

describe('sectorBonusBreakdown — the named sources attribute correctly', () => {
  it('counts a constructed building under `buildings`', () => {
    const r = colony(7);
    const t = r.settlements[0];
    const before = r.sectorBonusBreakdown(t.id, 'agriculture')!.buildings;
    t.buildings.push('grain_exchange'); // agriculture +20%
    const after = r.sectorBonusBreakdown(t.id, 'agriculture')!;
    expect(after.buildings).toBeCloseTo(before + 0.2, 10);
    // an 'all'-sector or other-sector building does not leak into agriculture
    expect(r.sectorBonusBreakdown(t.id, 'industry')!.buildings).toBe(0);
  });

  it('attributes a placed-district zone bonus under `districtZone`', () => {
    for (const seed of [3, 7, 11, 21, 42]) {
      const r = colony(seed);
      const t = r.settlements[0];
      const h = hub(r, t.id, 2);
      if (!h) continue;
      t.placedBuildings = h.nbrs.map((cell) => ({ id: 'grain_exchange', cell }));
      expect(r.placeDistrict(t.id, 'farming_district', h.center)).toBe(true);
      const bd = r.sectorBonusBreakdown(t.id, 'agriculture')!;
      expect(bd.districtZone).toBeGreaterThan(0);
      expect(bd.districtZone).toBe(priv(r).districtZoneBonus(t, 'agriculture'));
      // and it still totals to the live economy bonus
      expect(bd.total).toBe(priv(r).buildingBonus(t, 'agriculture'));
      return;
    }
    throw new Error('no seed produced a centre with two buildable neighbours');
  });
});

describe('sectorBonusBreakdown — purity & robustness', () => {
  it('returns null for an unknown town', () => {
    const r = colony(7);
    expect(r.sectorBonusBreakdown(99999, 'agriculture')).toBeNull();
  });

  it('mutates nothing — serialize() is unchanged and repeated calls are identical', () => {
    const r = colony(11);
    const t = r.settlements[0];
    const before = r.serialize();
    const a = r.sectorBonusBreakdown(t.id, 'industry')!;
    const b = r.sectorBonusBreakdown(t.id, 'industry')!;
    expect(a).toEqual(b);            // deterministic
    expect(r.serialize()).toBe(before); // read-only: no state touched
  });

  it('survives a serialize round-trip with identical numbers', () => {
    const r = colony(21);
    const t = r.settlements[0];
    const back = RegionSim.deserialize(r.serialize());
    const bt = back.settlements[0] as Settlement;
    for (const s of SECTORS) {
      expect(back.sectorBonusBreakdown(bt.id, s)!.total)
        .toBeCloseTo(r.sectorBonusBreakdown(t.id, s)!.total, 10);
    }
  });
});
