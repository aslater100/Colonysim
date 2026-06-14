import { describe, expect, it } from 'vitest';
import { World, MAP_W, MAP_H } from '../src/sim/world';
import { Rng } from '../src/sim/rng';
import { Simulation } from '../src/sim/sim';
import {
  ChunkCache,
  CHUNK_RES,
  TERRAIN_COLORS,
  CATEGORY_COLORS,
  categoryOf,
  computeChunkSummary,
  biomeColorOf,
} from '../src/ui/worldchunks';

// Track B Phase 4 — chunk-summary foundation. A parcel collapses into a cheap,
// blittable descriptor (downsampled terrain raster + building markers + a
// stockpile swatch) for the two zoomed-out render tiers. Pure & DOM-free.

function allWater(world: World): void {
  for (const t of world.tiles) t.kind = 'water';
}

describe('worldchunks — building categories', () => {
  it('maps buildings to icon categories by provides + overrides', () => {
    expect(categoryOf('house')).toBe('housing');
    expect(categoryOf('mill')).toBe('food');
    expect(categoryOf('sawmill')).toBe('production');
    expect(categoryOf('watchtower')).toBe('military');
    expect(categoryOf('barracks')).toBe('military'); // defId override (provides=sleep)
    expect(categoryOf('armory')).toBe('military'); // defId override (provides=forge)
  });
});

describe('worldchunks — computeChunkSummary', () => {
  it('produces a res×res RGBA raster and a hex biome colour', () => {
    const world = new World(new Rng(1));
    const s = computeChunkSummary(world);
    expect(s.res).toBe(CHUNK_RES);
    expect(s.pixels.length).toBe(CHUNK_RES * CHUNK_RES * 4);
    expect(s.biome).toMatch(/^#[0-9a-f]{6}$/i);
    // Every pixel is opaque.
    for (let i = 3; i < s.pixels.length; i += 4) expect(s.pixels[i]).toBe(255);
    // A default world is grass-dominant.
    expect(s.biome).toBe(TERRAIN_COLORS.grass);
  });

  it('reports the dominant biome of a water-covered parcel', () => {
    const world = new World(new Rng(2));
    allWater(world);
    expect(biomeColorOf(world)).toBe(TERRAIN_COLORS.water);
    const [r0, g0, b0] = [
      parseInt(TERRAIN_COLORS.water.slice(1, 3), 16),
      parseInt(TERRAIN_COLORS.water.slice(3, 5), 16),
      parseInt(TERRAIN_COLORS.water.slice(5, 7), 16),
    ];
    const s = computeChunkSummary(world);
    expect(s.biome).toBe(TERRAIN_COLORS.water);
    // Raster is all water too.
    expect([s.pixels[0], s.pixels[1], s.pixels[2]]).toEqual([r0, g0, b0]);
  });

  it('places building markers in grid space, coloured by category', () => {
    const world = new World(new Rng(3));
    const buildings = [
      { defId: 'house', x: 0, y: 0, built: true },
      { defId: 'mill', x: MAP_W - 1, y: MAP_H - 1, built: true },
      { defId: 'sawmill', x: 10, y: 10, built: false }, // unbuilt: skipped
    ];
    const s = computeChunkSummary(world, { buildings });
    expect(s.buildings.length).toBe(2);
    for (const m of s.buildings) {
      expect(m.x).toBeGreaterThanOrEqual(0);
      expect(m.x).toBeLessThan(CHUNK_RES);
      expect(m.y).toBeGreaterThanOrEqual(0);
      expect(m.y).toBeLessThan(CHUNK_RES);
    }
    expect(s.buildings[0]).toMatchObject({ x: 0, y: 0, color: CATEGORY_COLORS.housing });
    expect(s.buildings[1].color).toBe(CATEGORY_COLORS.food);
    // Bottom-right tile clamps into the last grid cell.
    expect(s.buildings[1].x).toBe(CHUNK_RES - 1);
  });

  it('computes a stockpile swatch only when a storage zone exists', () => {
    const world = new World(new Rng(4));
    expect(computeChunkSummary(world).stockpile).toBeNull();

    world.at(48, 48).stockpileZone = true;
    world.at(49, 48).stockpileZone = true; // 2 tiles → capacity 100
    const s = computeChunkSummary(world, { stock: { grain: 30, wood: 20 } });
    expect(s.stockpile).not.toBeNull();
    expect(s.stockpile!.fill).toBeCloseTo(0.5, 5); // 50 / 100
    expect(s.stockpile!.color).toBe('#d8a93a'); // grain dominates
  });

  it('clamps stockpile fill to 1 when overflowing capacity', () => {
    const world = new World(new Rng(5));
    world.at(48, 48).stockpileZone = true; // capacity 50
    const s = computeChunkSummary(world, { stock: { grain: 9999 } });
    expect(s.stockpile!.fill).toBe(1);
  });

  it('rejects a resolution that does not divide the tile grid', () => {
    const world = new World(new Rng(6));
    expect(() => computeChunkSummary(world, { res: 7 })).toThrow();
  });

  it('summarises a live Simulation parcel end-to-end', () => {
    const sim = new Simulation(11);
    const s = computeChunkSummary(sim.world, { buildings: sim.buildings, stock: sim.stock });
    expect(s.cellX).toBe(sim.world.site.cellX);
    expect(s.cellY).toBe(sim.world.site.cellY);
    expect(s.pixels.length).toBe(CHUNK_RES * CHUNK_RES * 4);
  });
});

describe('worldchunks — ChunkCache', () => {
  it('memoises summaries and recomputes only when marked dirty', () => {
    const world = new World(new Rng(7));
    const cache = new ChunkCache();
    expect(cache.has(3, 4)).toBe(false);

    const first = cache.get(3, 4, world);
    expect(cache.size).toBe(1);
    expect(cache.has(3, 4)).toBe(true);
    // Same reference on a cache hit (no recompute).
    expect(cache.get(3, 4, world)).toBe(first);

    cache.markDirty(3, 4);
    expect(cache.has(3, 4)).toBe(false);
    const second = cache.get(3, 4, world);
    expect(second).not.toBe(first); // recomputed
    expect(second.pixels).toEqual(first.pixels); // …but identical content
  });

  it('invalidate and clear drop cached entries', () => {
    const world = new World(new Rng(8));
    const cache = new ChunkCache();
    cache.get(1, 1, world);
    cache.get(2, 2, world);
    expect(cache.size).toBe(2);

    cache.invalidate(1, 1);
    expect(cache.size).toBe(1);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});
