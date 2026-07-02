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
      const riverCount = m.cells.filter((c) => c.river).length;
      const seaCount = biomes.get('sea') ?? 0;
      const mountainCount = biomes.get('mountains') ?? 0;
      console.log(`Seed ${seed}: sea=${seaCount}, rivers=${riverCount}, mountains=${mountainCount}`);
      expect(seaCount).toBeGreaterThan(30);
      expect(riverCount).toBeGreaterThan(0);
      expect(mountainCount).toBeGreaterThan(5);
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

  it('builds MULTIPLE continents separated by open sea, plus islands', () => {
    for (const seed of [1, 42, 1234, 7, 9999]) {
      const m = new RegionMap(seed);
      // Several substantial landmasses (not one blob) — the whole point.
      const majors = m.landmassSizes.filter((n) => n >= 500);
      expect(majors.length, `seed ${seed} major continents`).toBeGreaterThanOrEqual(3);
      // The heartland is big but never the ONLY land — real ocean splits the world.
      const land = m.landmassSizes.reduce((a, b) => a + b, 0);
      const largest = Math.max(...m.landmassSizes);
      expect(largest / land, `seed ${seed} not a single dominant mass`).toBeLessThan(0.8);
      // Islands: land too small to be a continent, dotting the open sea.
      const islands = m.landmassSizes.filter((n) => n > 0 && n < 500);
      expect(islands.length, `seed ${seed} islands`).toBeGreaterThan(0);
      // A majority-ocean world (the sea the maritime system crosses).
      const sea = m.cells.filter((c) => c.biome === 'sea' || c.biome === 'lake').length;
      expect(sea / m.cells.length, `seed ${seed} ocean fraction`).toBeGreaterThan(0.4);
    }
  });

  it('the start site sits on a real continent, never an islet', () => {
    for (const seed of [1, 42, 1234, 7, 9999]) {
      const m = new RegionMap(seed);
      const s = m.startSite();
      const lm = m.landmassAt(s.cellX, s.cellY);
      expect(lm, `seed ${seed} start is on land`).toBeGreaterThanOrEqual(0);
      expect(m.landmassSizes[lm], `seed ${seed} start continent size`).toBeGreaterThan(500);
      // The worked ring has room to build/farm — never a bare speck.
      expect(m.workableLand(s.cellX, s.cellY)).toBeGreaterThanOrEqual(RegionMap.MIN_WORKABLE_RING);
    }
  });

  it('sea lanes link coastal cells across the ocean where no land corridor exists', () => {
    for (const seed of [1, 42, 1234, 7]) {
      const m = new RegionMap(seed);
      const bySize = m.landmassSizes
        .map((n, i) => ({ i, n }))
        .sort((a, b) => b.n - a.n)
        .slice(0, 2)
        .map((o) => o.i);
      const coastalOf = (lm: number): { x: number; y: number } | null => {
        for (let y = 0; y < REGION_N; y++) {
          for (let x = 0; x < REGION_N; x++) {
            if (m.landmassAt(x, y) !== lm) continue;
            if (m.at(x + 1, y).biome === 'sea' || m.at(x - 1, y).biome === 'sea'
              || m.at(x, y + 1).biome === 'sea' || m.at(x, y - 1).biome === 'sea') return { x, y };
          }
        }
        return null;
      };
      const a = coastalOf(bySize[0])!;
      const b = coastalOf(bySize[1])!;
      expect(a).toBeTruthy();
      expect(b).toBeTruthy();
      // Two different continents: no land corridor, but a navigable sea lane.
      expect(m.corridor(a.x, a.y, b.x, b.y), `seed ${seed} no land bridge`).toBeNull();
      const lane = m.seaLane(a.x, a.y, b.x, b.y);
      expect(lane, `seed ${seed} sea lane exists`).not.toBeNull();
      // The lane is (almost) all water — only its two port endpoints are land.
      const landCells = lane!.path.filter((p) => !m.isWater(p.x, p.y)).length;
      expect(landCells).toBeLessThanOrEqual(2);
    }
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

