import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/sim';
import { ParcelManager } from '../src/sim/parcel';
import { PARCEL_TUNING, EXPANSION_TECHS } from '../src/sim/defs';
import { REGION_N } from '../src/sim/worldgen';

const SEED = 12345;

function newManager(): { sim: Simulation; mgr: ParcelManager } {
  const sim = new Simulation(SEED);
  return { sim, mgr: new ParcelManager(sim) };
}

/** Find an in-region land cell orthogonally adjacent to the home parcel. */
function adjacentLandCell(mgr: ParcelManager): { x: number; y: number } | null {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const x = mgr.homeCellX + dx;
    const y = mgr.homeCellY + dy;
    if (x < 0 || y < 0 || x >= REGION_N || y >= REGION_N) continue;
    if (!mgr.regionMap.isWater(x, y)) return { x, y };
  }
  return null;
}

/** A land cell at Chebyshev distance ≥ 2 from home (never orthogonally adjacent). */
function distantLandCell(mgr: ParcelManager): { x: number; y: number } | null {
  for (let r = 2; r <= 6; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = mgr.homeCellX + dx;
        const y = mgr.homeCellY + dy;
        if (x < 0 || y < 0 || x >= REGION_N || y >= REGION_N) continue;
        if (!mgr.regionMap.isWater(x, y)) return { x, y };
      }
    }
  }
  return null;
}

describe('ParcelManager — home parcel & economy', () => {
  it('starts with exactly the home parcel owned, sharing the live world', () => {
    const { sim, mgr } = newManager();
    expect(mgr.ownedCount()).toBe(1);
    expect(mgr.isOwned(mgr.homeCellX, mgr.homeCellY)).toBe(true);
    const home = mgr.at(mgr.homeCellX, mgr.homeCellY)!;
    expect(home.world).toBe(sim.world); // never regenerated from seed
    expect(home.purchaseCost).toBe(0);
  });

  it('routes gold through the home Simulation treasury (Fix 7)', () => {
    const { sim, mgr } = newManager();
    expect(mgr.gold).toBe(sim.economy.cash);
    mgr.deposit(100);
    expect(sim.economy.cash).toBe(mgr.gold);
    const before = mgr.gold;
    expect(mgr.spend(before + 1)).toBe(false); // unaffordable: nothing moves
    expect(mgr.gold).toBe(before);
    expect(mgr.spend(50)).toBe(true);
    expect(mgr.gold).toBe(before - 50);
  });

  it('exposes the home stockpile as the canonical stock', () => {
    const { sim, mgr } = newManager();
    expect(mgr.stock).toBe(sim.stock);
  });
});

describe('ParcelManager — purchase', () => {
  it('cost grows with the expansion premium as holdings increase', () => {
    const { mgr } = newManager();
    const cell = adjacentLandCell(mgr);
    expect(cell).not.toBeNull();
    const first = mgr.cost(cell!.x, cell!.y);
    // Buy it, then the *same-distance* cost basis should reflect one more owned.
    mgr.gold = first + 1_000_000;
    expect(mgr.purchase(cell!.x, cell!.y)).not.toBeNull();
    // A hypothetical equally-distant cell now costs more (premium kicked in).
    expect(mgr.cost(cell!.x, cell!.y)).toBeGreaterThan(first);
    expect(first).toBeGreaterThanOrEqual(PARCEL_TUNING.baseCost);
  });

  it('purchasing deducts gold, takes title, generates terrain, reveals neighbours', () => {
    const { mgr } = newManager();
    const cell = adjacentLandCell(mgr)!;
    const price = mgr.cost(cell.x, cell.y);
    mgr.gold = price + 500;
    const goldBefore = mgr.gold;

    const p = mgr.purchase(cell.x, cell.y);
    expect(p).not.toBeNull();
    expect(p!.owned).toBe(true);
    expect(p!.world).not.toBeNull();
    expect(mgr.gold).toBe(goldBefore - price);
    expect(mgr.ownedCount()).toBe(2);
    // At least one neighbour of the new cell is now explored.
    const revealedNeighbour = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(
      ([dx, dy]) => mgr.isExplored(cell.x + dx, cell.y + dy),
    );
    expect(revealedNeighbour).toBe(true);
  });

  it('refuses unaffordable, non-adjacent, water, and out-of-region purchases', () => {
    const { mgr } = newManager();
    const cell = adjacentLandCell(mgr)!;

    // Unaffordable.
    mgr.gold = 0;
    expect(mgr.purchase(cell.x, cell.y)).toBeNull();
    expect(mgr.ownedCount()).toBe(1);

    // Non-adjacent (far from home, even with infinite gold).
    mgr.gold = 1_000_000;
    const farX = Math.min(REGION_N - 1, mgr.homeCellX + 10);
    expect(mgr.canPurchase(farX, mgr.homeCellY)).toBe(false);

    // Out of region.
    expect(mgr.purchase(-1, mgr.homeCellY)).toBeNull();
    expect(mgr.canPurchase(REGION_N, mgr.homeCellY)).toBe(false);
  });
});

describe('ParcelManager — expansion techs (Phase 3)', () => {
  it('road_building discounts every acquisition', () => {
    const { mgr } = newManager();
    const cell = adjacentLandCell(mgr)!;
    const full = mgr.cost(cell.x, cell.y);
    mgr.hasTech = (id) => id === EXPANSION_TECHS.roadBuilding;
    const discounted = mgr.cost(cell.x, cell.y);
    expect(discounted).toBeLessThan(full);
    // Within rounding of the configured multiplier.
    expect(Math.abs(discounted - full * PARCEL_TUNING.roadDiscount)).toBeLessThanOrEqual(1);
  });

  it('land_survey unlocks non-adjacent explored parcels', () => {
    const { mgr } = newManager();
    const far = distantLandCell(mgr)!;
    mgr.gold = 1_000_000;
    mgr.markExplored(far.x, far.y);

    // Explored but not adjacent to any holding → unreachable without the tech.
    expect(mgr.canPurchase(far.x, far.y)).toBe(false);

    mgr.hasTech = (id) => id === EXPANSION_TECHS.landSurvey;
    expect(mgr.canPurchase(far.x, far.y)).toBe(true);
    expect(mgr.purchase(far.x, far.y)).not.toBeNull();
    expect(mgr.isOwned(far.x, far.y)).toBe(true);
  });

  it('land_survey still requires the cell to have been explored', () => {
    const { mgr } = newManager();
    const far = distantLandCell(mgr)!;
    mgr.gold = 1_000_000;
    mgr.hasTech = (id) => id === EXPANSION_TECHS.landSurvey;
    // Never revealed → off-frontier, even with the survey tech and ample gold.
    expect(mgr.canPurchase(far.x, far.y)).toBe(false);
  });

  it('cartography surveys a wider frontier on purchase', () => {
    const { mgr } = newManager();
    const cell = adjacentLandCell(mgr)!;
    mgr.gold = 1_000_000;
    mgr.hasTech = (id) => id === EXPANSION_TECHS.cartography;
    mgr.purchase(cell.x, cell.y);

    // A cell exactly two rings out from the new holding is now explored —
    // something the plain orthogonal reveal (radius 1) would never reach.
    const r = PARCEL_TUNING.cartographyRevealRadius;
    let revealedFar = false;
    for (let dx = -r; dx <= r && !revealedFar; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (mgr.isExplored(cell.x + dx, cell.y + dy)) { revealedFar = true; break; }
      }
    }
    expect(revealedFar).toBe(true);
  });
});

describe('ParcelManager — serialization', () => {
  it('round-trips ownership and exploration; terrain regenerates deterministically', () => {
    const { sim, mgr } = newManager();
    const cell = adjacentLandCell(mgr)!;
    mgr.gold = mgr.cost(cell.x, cell.y) + 1000;
    mgr.purchase(cell.x, cell.y);

    const save = mgr.serialize();
    const restored = ParcelManager.deserialize(save, sim);

    expect(restored.ownedCount()).toBe(mgr.ownedCount());
    expect(restored.isOwned(cell.x, cell.y)).toBe(true);
    expect(restored.isOwned(mgr.homeCellX, mgr.homeCellY)).toBe(true);

    // Lazily-generated terrain is seed-stable: same tile kinds across loads.
    const a = mgr.worldFor(cell.x, cell.y);
    const b = restored.worldFor(cell.x, cell.y);
    expect(b.tiles.map((t) => t.kind)).toEqual(a.tiles.map((t) => t.kind));
  });
});
