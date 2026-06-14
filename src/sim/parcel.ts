// Track B Phase 2 — Parcel Data Model + Unified Economy.
//
// The seamless world is a 64×64 grid of *parcels* (one per region cell). The
// player founds one — the home parcel — and the realm grows a cell at a time by
// purchasing neighbours. Each parcel's terrain is generated lazily from the
// shared region seed (so a parcel is free to model until it is actually owned).
//
// This module is the data spine for that system. It deliberately does NOT wire
// into main.ts / region.ts yet (Phase 3 adds the purchase UI, Phase 5 the
// dormant simulation) — like Phase 1's WorldCamera it is an additive foundation
// with its own tests, so the live town/region switch is untouched.
//
// Unified economy (Fix 7): the home parcel's Simulation is the canonical
// treasury and stockpile. ParcelManager funnels every spend/deposit through it,
// so expansion can never "reset" the player's gold the way the old hard
// town↔region mode switch did.

import { Rng } from './rng';
import { World } from './world';
import { RegionMap, REGION_N } from './worldgen';
import { PARCEL_TUNING, EXPANSION_TECHS } from './defs';
import type { ResourceKind } from './defs';
import type { Simulation } from './sim';

export interface Parcel {
  cellX: number;
  cellY: number;
  /** Player holds title to this cell. */
  owned: boolean;
  /** Cell has been revealed (scouting / adjacency) — purchasable when true. */
  explored: boolean;
  /** Gold price to acquire, as computed when this Parcel was last offered. */
  purchaseCost: number;
  /** Terrain, generated lazily from the region seed; null until owned/visited. */
  world: World | null;
}

const cellKey = (cellX: number, cellY: number): string => `${cellX},${cellY}`;

export interface ParcelSave {
  v: 1;
  homeCellX: number;
  homeCellY: number;
  /** Owned cells other than the home parcel (home is always owned). */
  owned: [number, number][];
  /** Explored-but-not-owned cells. */
  explored: [number, number][];
}

export class ParcelManager {
  /** The canonical economy + the home parcel's live town. */
  readonly home: Simulation;
  readonly regionMap: RegionMap;
  readonly seed: number;
  readonly homeCellX: number;
  readonly homeCellY: number;

  /**
   * Whether a region-tier expansion tech is researched. Defaults to "nothing
   * researched" so the data model stays standalone (and its tests stay pure);
   * once the ParcelManager is wired into the live game this is pointed at
   * `RegionSim.has`, so `land_survey` / `road_building` / `cartography` take
   * effect without the sim layer ever importing the region module.
   */
  hasTech: (id: string) => boolean = () => false;

  private parcels = new Map<string, Parcel>();

  constructor(home: Simulation) {
    this.home = home;
    this.regionMap = home.regionMap;
    this.seed = home.seed;
    this.homeCellX = home.site.cellX;
    this.homeCellY = home.site.cellY;

    // The home parcel is owned from the first frame and shares the live town's
    // already-generated world — never regenerate it from seed.
    this.parcels.set(cellKey(this.homeCellX, this.homeCellY), {
      cellX: this.homeCellX,
      cellY: this.homeCellY,
      owned: true,
      explored: true,
      purchaseCost: 0,
      world: home.world,
    });
  }

  // ── Canonical economy (Fix 7) ──────────────────────────────────────────────
  // Every gold movement routes through the home Simulation's treasury so the
  // realm has a single purse regardless of how many parcels it spans.

  get gold(): number {
    return this.home.economy.cash;
  }
  set gold(v: number) {
    this.home.economy.cash = v;
  }

  /** Deduct gold if affordable; returns false (and spends nothing) otherwise. */
  spend(amount: number): boolean {
    if (amount < 0 || this.home.economy.cash < amount) return false;
    this.home.economy.cash -= amount;
    return true;
  }

  deposit(amount: number): void {
    if (amount > 0) this.home.economy.cash += amount;
  }

  /** The canonical stockpile lives on the home parcel. */
  get stock(): Record<ResourceKind, number> {
    return this.home.stock;
  }

  // ── Parcel access ───────────────────────────────────────────────────────────

  /** A deterministic per-cell seed so a parcel's terrain is stable across loads. */
  private parcelSeed(cellX: number, cellY: number): number {
    // Mix the region seed with the cell index; keep it a positive 32-bit int.
    let h = Math.imul(this.seed ^ 0x9e3779b9, 0x85ebca6b);
    h = Math.imul(h ^ (cellX * 73856093), 0xc2b2ae35);
    h = Math.imul(h ^ (cellY * 19349663), 0x27d4eb2d);
    h ^= h >>> 16;
    return h >>> 0;
  }

  /** Generate (or reuse) the terrain for a cell. Home reuses the live world. */
  worldFor(cellX: number, cellY: number): World {
    const p = this.ensure(cellX, cellY);
    if (!p.world) {
      p.world = new World(new Rng(this.parcelSeed(cellX, cellY)), this.regionMap.siteAt(cellX, cellY));
    }
    return p.world;
  }

  /** Fetch the parcel record for a cell, creating an unowned one on first ask. */
  ensure(cellX: number, cellY: number): Parcel {
    const k = cellKey(cellX, cellY);
    let p = this.parcels.get(k);
    if (!p) {
      p = {
        cellX,
        cellY,
        owned: false,
        explored: false,
        purchaseCost: this.cost(cellX, cellY),
        world: null,
      };
      this.parcels.set(k, p);
    }
    return p;
  }

  /** Existing parcel record, or undefined if this cell has never been touched. */
  at(cellX: number, cellY: number): Parcel | undefined {
    return this.parcels.get(cellKey(cellX, cellY));
  }

  isOwned(cellX: number, cellY: number): boolean {
    return this.at(cellX, cellY)?.owned ?? false;
  }

  isExplored(cellX: number, cellY: number): boolean {
    return this.at(cellX, cellY)?.explored ?? false;
  }

  ownedParcels(): Parcel[] {
    return [...this.parcels.values()].filter((p) => p.owned);
  }

  ownedCount(): number {
    let n = 0;
    for (const p of this.parcels.values()) if (p.owned) n++;
    return n;
  }

  // ── Expansion ───────────────────────────────────────────────────────────────

  /** Price to acquire a cell: base × distance × terrain × holdings premium,
   *  discounted once `road_building` is researched. */
  cost(cellX: number, cellY: number): number {
    const d = Math.hypot(cellX - this.homeCellX, cellY - this.homeCellY);
    const biome = this.regionMap.at(cellX, cellY).biome;
    const terrain = PARCEL_TUNING.terrainMult[biome] ?? 1;
    const owned = this.ownedCount();
    const discount = this.hasTech(EXPANSION_TECHS.roadBuilding) ? PARCEL_TUNING.roadDiscount : 1;
    const raw =
      PARCEL_TUNING.baseCost *
      (1 + d * PARCEL_TUNING.distanceScale) *
      terrain *
      (1 + owned * PARCEL_TUNING.expansionPremium) *
      discount;
    return Math.round(raw);
  }

  /** Reveal a cell for purchase (scouting / owning a neighbour). */
  markExplored(cellX: number, cellY: number): void {
    if (!inRegion(cellX, cellY)) return;
    const p = this.ensure(cellX, cellY);
    p.explored = true;
    p.purchaseCost = this.cost(cellX, cellY); // refresh against current holdings
  }

  /**
   * Can this cell be bought right now? In-region, land, unowned, reachable,
   * and affordable. "Reachable" normally means orthogonally adjacent to a
   * holding; `land_survey` relaxes that to any already-explored frontier cell.
   */
  canPurchase(cellX: number, cellY: number): boolean {
    if (!inRegion(cellX, cellY)) return false;
    if (this.isOwned(cellX, cellY)) return false;
    if (this.regionMap.isWater(cellX, cellY)) return false;
    if (!this.isReachable(cellX, cellY)) return false;
    return this.gold >= this.cost(cellX, cellY);
  }

  /** Adjacent to a holding, or — with `land_survey` — any explored frontier cell. */
  private isReachable(cellX: number, cellY: number): boolean {
    if (this.adjacentToOwned(cellX, cellY)) return true;
    return this.hasTech(EXPANSION_TECHS.landSurvey) && this.isExplored(cellX, cellY);
  }

  /** Is the cell orthogonally next to a parcel the player already owns? */
  adjacentToOwned(cellX: number, cellY: number): boolean {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      if (this.isOwned(cellX + dx, cellY + dy)) return true;
    }
    return false;
  }

  /**
   * Buy a parcel: deduct from the canonical treasury, take title, generate its
   * terrain, and reveal its neighbours for further expansion. Returns the new
   * Parcel, or null if the purchase was illegal/unaffordable (no gold spent).
   */
  purchase(cellX: number, cellY: number): Parcel | null {
    if (!this.canPurchase(cellX, cellY)) return null;
    const price = this.cost(cellX, cellY);
    if (!this.spend(price)) return null;

    const p = this.ensure(cellX, cellY);
    p.owned = true;
    p.explored = true;
    p.purchaseCost = price;
    this.worldFor(cellX, cellY); // lazily realise terrain now that it's ours
    this.revealFrontier(cellX, cellY);
    return p;
  }

  /**
   * Open the cells around a fresh holding to the frontier. Normally just the
   * four orthogonal neighbours; `cartography` surveys a wider Chebyshev block,
   * exposing the biomes of cells two rings out.
   */
  private revealFrontier(cellX: number, cellY: number): void {
    if (this.hasTech(EXPANSION_TECHS.cartography)) {
      const r = PARCEL_TUNING.cartographyRevealRadius;
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (dx === 0 && dy === 0) continue;
          this.markExplored(cellX + dx, cellY + dy);
        }
      }
      return;
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      this.markExplored(cellX + dx, cellY + dy);
    }
  }

  // ── Serialization ─────────────────────────────────────────────────────────
  // Terrain is regenerated from the seed on load, so we persist only the cheap
  // ownership/exploration flags. The home parcel is implied (always owned).

  serialize(): ParcelSave {
    const owned: [number, number][] = [];
    const explored: [number, number][] = [];
    for (const p of this.parcels.values()) {
      const here = p.cellX === this.homeCellX && p.cellY === this.homeCellY;
      if (p.owned && !here) owned.push([p.cellX, p.cellY]);
      else if (p.explored && !p.owned) explored.push([p.cellX, p.cellY]);
    }
    return { v: 1, homeCellX: this.homeCellX, homeCellY: this.homeCellY, owned, explored };
  }

  /** Rebuild a manager for an already-loaded home Simulation. */
  static deserialize(save: ParcelSave, home: Simulation): ParcelManager {
    const mgr = new ParcelManager(home);
    for (const [x, y] of save.owned ?? []) {
      const p = mgr.ensure(x, y);
      p.owned = true;
      p.explored = true;
      mgr.worldFor(x, y);
    }
    for (const [x, y] of save.explored ?? []) {
      mgr.ensure(x, y).explored = true;
    }
    return mgr;
  }
}

function inRegion(cellX: number, cellY: number): boolean {
  return cellX >= 0 && cellY >= 0 && cellX < REGION_N && cellY < REGION_N;
}
