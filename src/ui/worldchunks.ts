// Track B Phase 4 — Zoom-coupled multi-chunk rendering (foundation).
//
// At the two zoomed-out tiers the seamless world can't afford to draw 9,216
// tiles + agents per parcel. Instead each owned parcel is summarised once into
// a cheap, blittable descriptor:
//   • Mode B (0.3 ≤ zoom < 1.0) — a downsampled terrain raster + building-icon
//     markers + a stockpile fill swatch.
//   • Mode C (zoom < 0.3)       — a single dominant-biome colour per parcel.
// (Mode A at zoom ≥ 1.0 is the existing per-tile render.ts, untouched.)
//
// Scanning the 96×96 tile grid is the expensive part, so `ChunkCache` memoises
// the summary per cell and only recomputes on an explicit `markDirty` (a build,
// a demolition, a stock swing). This module is the pure, DOM-free core — it
// produces RGBA pixel buffers and marker lists, never canvases — so it runs in
// the headless harness and (later) the Phase 7 worker. The thin step of
// rasterising a summary onto an offscreen canvas is deferred to the render-side
// wiring, exactly as Phases 1/2/5/6 deferred their live-file integration.

import { World, MAP_W, MAP_H, type TileKind } from '../sim/world';
import { CAPACITY_PER_TILE, buildingDef, type Provides, type ResourceKind } from '../sim/defs';

/** Downsample resolution: the 96×96 tile grid collapses to RES×RES pixels.
 *  Must divide MAP_W/MAP_H so blocks tile the parcel exactly (48 → 2×2 tiles). */
export const CHUNK_RES = 48;

// ── Palettes ─────────────────────────────────────────────────────────────────

/** Terrain colour per tile kind (Mode B raster + Mode C dominant biome). */
export const TERRAIN_COLORS: Record<TileKind, string> = {
  grass: '#4a7c3a',
  tree: '#2f5e2a',
  water: '#2f6fb0',
  soil: '#8a6a3f',
  rock: '#7a7a7a',
};

/** Building icon categories (plan: food=green, housing=tan, production=orange, military=red). */
export type BuildingCategory = 'housing' | 'food' | 'production' | 'military' | 'civic';

export const CATEGORY_COLORS: Record<BuildingCategory, string> = {
  housing: '#c9a36b',
  food: '#5bbf4a',
  production: '#e08a2c',
  military: '#c0392b',
  civic: '#7b5bbf',
};

/** Each building's `provides` maps to an icon category. Record-typed so adding a
 *  new `Provides` member is a compile error until it's categorised here. */
const PROVIDES_CATEGORY: Record<Provides, BuildingCategory> = {
  sleep: 'housing',
  cook: 'food', granary: 'food', hunt: 'food', fishing: 'food',
  ranching: 'food', milling: 'food', brewing: 'food', preservation: 'food',
  craft: 'production', forge: 'production', forestry: 'production', sawmill: 'production',
  kiln: 'production', mining: 'production', smithing: 'production', coke_furnace: 'production',
  warehouse: 'production', storage: 'production', well: 'production',
  watchtower: 'military',
  civic: 'civic', recreation: 'civic', medical: 'civic', apothecary: 'civic',
  herbalism: 'civic', burial: 'civic', trade: 'civic', education: 'civic', warmth: 'civic',
};

/** A handful of buildings read better as military than their `provides` implies
 *  (barracks sleep soldiers; the armoury is a forge but it arms them). */
const DEFID_CATEGORY: Record<string, BuildingCategory> = {
  barracks: 'military',
  armory: 'military',
};

/** Bulk-resource swatch colours for the stockpile fill marker. */
export const RESOURCE_COLORS: Partial<Record<ResourceKind, string>> = {
  grain: '#d8a93a',
  wood: '#7a5230',
  stone: '#888888',
  meal: '#5bbf4a',
  iron: '#b8c0c8',
  brick: '#b5552f',
};

/** Icon category for a building def id. */
export function categoryOf(defId: string): BuildingCategory {
  return DEFID_CATEGORY[defId] ?? PROVIDES_CATEGORY[buildingDef(defId).provides];
}

// ── Summary types ──────────────────────────────────────────────────────────────

export interface BuildingMarker {
  /** Grid coords in 0..res-1 (downsampled tile space). */
  x: number;
  y: number;
  category: BuildingCategory;
  color: string;
}

export interface StockpileFill {
  /** 0..1 of stockpile capacity in use. */
  fill: number;
  /** Swatch colour of the dominant stored resource. */
  color: string;
}

export interface ChunkSummary {
  cellX: number;
  cellY: number;
  /** Downsample resolution; `pixels` is res×res RGBA, row-major. */
  res: number;
  /** res*res*4 bytes — directly wrappable as `new ImageData(pixels, res, res)`. */
  pixels: Uint8ClampedArray;
  /** Single dominant-biome colour for the Mode C far-zoom block. */
  biome: string;
  /** Built buildings as coloured icon markers in grid space. */
  buildings: BuildingMarker[];
  /** Stockpile fill swatch, or null when the parcel has no storage zone. */
  stockpile: StockpileFill | null;
}

export interface ChunkSummaryOpts {
  /** Buildings to draw as icons (typically `Simulation.buildings`). */
  buildings?: { defId: string; x: number; y: number; built: boolean }[];
  /** Stockpile contents (typically `Simulation.stock`) for the fill swatch. */
  stock?: Partial<Record<ResourceKind, number>>;
  /** Override the downsample resolution; defaults to `CHUNK_RES`. */
  res?: number;
}

// ── Summary computation (pure) ──────────────────────────────────────────────────

function parseHex(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Collapse a parcel's terrain into a downsampled raster plus its dominant biome,
 * and overlay built buildings + stockpile fill from the optional sim snapshot.
 */
export function computeChunkSummary(world: World, opts: ChunkSummaryOpts = {}): ChunkSummary {
  const res = opts.res ?? CHUNK_RES;
  if (MAP_W % res !== 0 || MAP_H % res !== 0) {
    throw new Error(`worldchunks: res ${res} must divide MAP_W=${MAP_W}/MAP_H=${MAP_H}`);
  }
  const blockW = MAP_W / res;
  const blockH = MAP_H / res;

  const pixels = new Uint8ClampedArray(res * res * 4);
  const globalCounts: Partial<Record<TileKind, number>> = {};
  let stockpileTiles = 0;

  for (let gy = 0; gy < res; gy++) {
    for (let gx = 0; gx < res; gx++) {
      // Dominant tile kind in this block keeps biome edges crisp (no muddy
      // averaging of water into grass).
      const counts: Partial<Record<TileKind, number>> = {};
      for (let dy = 0; dy < blockH; dy++) {
        for (let dx = 0; dx < blockW; dx++) {
          const t = world.at(gx * blockW + dx, gy * blockH + dy);
          counts[t.kind] = (counts[t.kind] ?? 0) + 1;
          globalCounts[t.kind] = (globalCounts[t.kind] ?? 0) + 1;
          if (t.stockpileZone) stockpileTiles++;
        }
      }
      const kind = dominantKind(counts);
      const [r, g, b] = parseHex(TERRAIN_COLORS[kind]);
      const i = (gy * res + gx) * 4;
      pixels[i] = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
      pixels[i + 3] = 255;
    }
  }

  const biome = TERRAIN_COLORS[dominantKind(globalCounts)];

  const buildings: BuildingMarker[] = [];
  for (const b of opts.buildings ?? []) {
    if (!b.built) continue;
    const category = categoryOf(b.defId);
    buildings.push({
      x: Math.min(res - 1, Math.floor((b.x / MAP_W) * res)),
      y: Math.min(res - 1, Math.floor((b.y / MAP_H) * res)),
      category,
      color: CATEGORY_COLORS[category],
    });
  }

  const stockpile = stockpileFill(stockpileTiles, opts.stock);

  return { cellX: world.site.cellX, cellY: world.site.cellY, res, pixels, biome, buildings, stockpile };
}

function dominantKind(counts: Partial<Record<TileKind, number>>): TileKind {
  let best: TileKind = 'grass';
  let bestN = -1;
  for (const k in counts) {
    const n = counts[k as TileKind] ?? 0;
    if (n > bestN) {
      bestN = n;
      best = k as TileKind;
    }
  }
  return best;
}

function stockpileFill(
  tiles: number,
  stock: Partial<Record<ResourceKind, number>> | undefined,
): StockpileFill | null {
  if (tiles <= 0) return null;
  const capacity = tiles * CAPACITY_PER_TILE;
  let total = 0;
  let dominant: ResourceKind | null = null;
  let dominantQty = 0;
  for (const k in stock ?? {}) {
    const qty = stock![k as ResourceKind] ?? 0;
    if (qty <= 0) continue;
    total += qty;
    if (qty > dominantQty) {
      dominantQty = qty;
      dominant = k as ResourceKind;
    }
  }
  const fill = capacity > 0 ? Math.min(1, total / capacity) : 0;
  const color = (dominant && RESOURCE_COLORS[dominant]) || '#aaaaaa';
  return { fill, color };
}

/** Dominant-biome colour for a parcel (Mode C far-zoom block), without the full raster. */
export function biomeColorOf(world: World): string {
  const counts: Partial<Record<TileKind, number>> = {};
  for (const t of world.tiles) counts[t.kind] = (counts[t.kind] ?? 0) + 1;
  return TERRAIN_COLORS[dominantKind(counts)];
}

// ── Cache ────────────────────────────────────────────────────────────────────────
// Keyed by "cellX,cellY". A parcel is summarised lazily on first request and
// reused until the render layer marks it dirty (build/demolish/stock change).

const cacheKey = (cellX: number, cellY: number): string => `${cellX},${cellY}`;

export class ChunkCache {
  private summaries = new Map<string, ChunkSummary>();
  private dirty = new Set<string>();

  /** Force the next `get` for this cell to recompute. */
  markDirty(cellX: number, cellY: number): void {
    this.dirty.add(cacheKey(cellX, cellY));
  }

  /** Cached summary for a cell, recomputing on first ask or after `markDirty`. */
  get(cellX: number, cellY: number, world: World, opts: ChunkSummaryOpts = {}): ChunkSummary {
    const k = cacheKey(cellX, cellY);
    if (this.dirty.has(k)) {
      this.summaries.delete(k);
      this.dirty.delete(k);
    }
    let s = this.summaries.get(k);
    if (!s) {
      s = computeChunkSummary(world, opts);
      this.summaries.set(k, s);
    }
    return s;
  }

  /** Already have a fresh (non-dirty) summary for this cell? */
  has(cellX: number, cellY: number): boolean {
    const k = cacheKey(cellX, cellY);
    return this.summaries.has(k) && !this.dirty.has(k);
  }

  /** Drop a single cell's summary. */
  invalidate(cellX: number, cellY: number): void {
    const k = cacheKey(cellX, cellY);
    this.summaries.delete(k);
    this.dirty.delete(k);
  }

  /** Drop every cached summary (e.g. on load). */
  clear(): void {
    this.summaries.clear();
    this.dirty.clear();
  }

  /** Number of cached summaries (excludes pending-dirty bookkeeping). */
  get size(): number {
    return this.summaries.size;
  }
}
