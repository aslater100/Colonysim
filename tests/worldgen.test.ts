import { describe, expect, it } from 'vitest';
import { RegionMap, REGION_N } from '../src/sim/worldgen';
import { Weather } from '../src/sim/weather';

describe('RegionMap (procedural world)', () => {
  it('is deterministic for a seed and varies across seeds', () => {
    const a = new RegionMap(42);
    const b = new RegionMap(42);
    const c = new RegionMap(43);
    expect(a.cells.map((x) => x.biome)).toEqual(b.cells.map((x) => x.biome));
    expect(a.cells.map((x) => x.biome)).not.toEqual(c.cells.map((x) => x.biome));
  });

  it('generates a coherent world: sea, rivers, mountains, fertile land', () => {
    for (const seed of [1, 42, 1234]) {
      const m = new RegionMap(seed);
      const biomes = new Map<string, number>();
      for (const cell of m.cells) biomes.set(cell.biome, (biomes.get(cell.biome) ?? 0) + 1);
      expect(biomes.get('sea') ?? 0).toBeGreaterThan(30);
      expect(m.cells.filter((c) => c.river).length).toBeGreaterThan(15);
      expect(biomes.get('mountains') ?? 0).toBeGreaterThan(5);
      expect(m.cells.some((c) => c.fertility > 0.85)).toBe(true);
      for (const cell of m.cells) {
        expect(cell.fertility).toBeGreaterThanOrEqual(0.3);
        expect(cell.fertility).toBeLessThanOrEqual(1.4);
      }
    }
  });

  it('picks a livable start site (not sea, not mountains, decent land)', () => {
    for (const seed of [1, 42, 1234, 9999]) {
      const m = new RegionMap(seed);
      const s = m.startSite();
      expect(m.isWater(s.cellX, s.cellY)).toBe(false);
      expect(m.at(s.cellX, s.cellY).biome).not.toBe('mountains');
      expect(s.fertility).toBeGreaterThan(0.5);
    }
  });

  it('expedition sites avoid claimed land and travel time reflects terrain', () => {
    const m = new RegionMap(42);
    const start = m.startSite();
    const site = m.bestSiteNear(start.cellX, start.cellY, [{ x: start.cellX, y: start.cellY }]);
    expect(site).not.toBeNull();
    const d = Math.hypot(site!.cellX - start.cellX, site!.cellY - start.cellY);
    expect(d).toBeGreaterThanOrEqual(6);
    const days = m.travelDays(start.cellX, start.cellY, site!.cellX, site!.cellY);
    expect(days).toBeGreaterThanOrEqual(2);
    expect(days).toBeLessThan(30);
  });
});

describe('Weather', () => {
  it('is deterministic and varied', () => {
    const a = new Weather(42);
    const b = new Weather(42);
    const days = Array.from({ length: 120 }, (_, d) => a.forDay(d).rainfall);
    expect(days).toEqual(Array.from({ length: 120 }, (_, d) => b.forDay(d).rainfall));
    expect(Math.max(...days) - Math.min(...days)).toBeGreaterThan(0.3);
  });

  it('produces droughts and wet spells across a decade', () => {
    const w = new Weather(42);
    let droughtDays = 0;
    let wetDays = 0;
    for (let d = 0; d < 600; d++) {
      if (w.isDrought(d)) droughtDays++;
      if (w.recentRain(d) > 0.5) wetDays++;
    }
    expect(droughtDays).toBeGreaterThan(5);
    expect(wetDays).toBeGreaterThan(5);
    for (let d = 0; d < 600; d += 37) {
      const g = w.growthMult(d);
      expect(g).toBeGreaterThanOrEqual(0.35);
      expect(g).toBeLessThanOrEqual(1.1);
    }
  });
});

