import { describe, it, expect } from 'vitest';
import { BuildGrid } from '../src/sim/build';
import { BLUEPRINT_DEFS } from '../src/sim/defs';

describe('BLUEPRINT_DEFS', () => {
  it('loads 7 blueprints', () => {
    expect(BLUEPRINT_DEFS.length).toBe(7);
    expect(BLUEPRINT_DEFS.map((b) => b.id)).toEqual([
      'hut', 'kitchen', 'mill', 'sawmill', 'workshop', 'tavern', 'infirmary',
    ]);
  });
});

describe('stampBlueprint', () => {
  it('hut creates one enclosed home room with 2 beds', () => {
    const grid = new BuildGrid(20, 20);
    const bp = BLUEPRINT_DEFS.find((b) => b.id === 'hut')!;
    expect(grid.stampBlueprint(bp, 1, 1)).toBe(true);
    expect(grid.rooms.length).toBe(1);
    expect(grid.rooms[0].typeId).toBe(1); // home = typeId 1
    expect(grid.rooms[0].enclosed).toBe(true);
    expect(grid.rooms[0].stationIds.length).toBe(2); // 2 beds
    expect(grid.stations.length).toBe(2);
  });

  it('kitchen creates 2 craft oven stations', () => {
    const grid = new BuildGrid(20, 20);
    const bp = BLUEPRINT_DEFS.find((b) => b.id === 'kitchen')!;
    grid.stampBlueprint(bp, 0, 0);
    expect(grid.rooms.length).toBe(1);
    expect(grid.rooms[0].stationIds.length).toBe(2);
  });

  it('mill creates 2 millstones (2×2 each)', () => {
    const grid = new BuildGrid(20, 20);
    const bp = BLUEPRINT_DEFS.find((b) => b.id === 'mill')!;
    grid.stampBlueprint(bp, 0, 0);
    expect(grid.stations.length).toBe(2);
    expect(grid.stations[0].w).toBe(2);
    expect(grid.stations[0].h).toBe(2);
    expect(grid.rooms[0].stationIds.length).toBe(2);
  });

  it('tavern creates tables and brew_vat', () => {
    const grid = new BuildGrid(20, 20);
    const bp = BLUEPRINT_DEFS.find((b) => b.id === 'tavern')!;
    grid.stampBlueprint(bp, 0, 0);
    expect(grid.stations.length).toBe(3); // 2 tables + 1 brew_vat
    expect(grid.rooms.length).toBe(1);
  });

  it('returns false when footprint is out of bounds', () => {
    const grid = new BuildGrid(5, 5);
    const bp = BLUEPRINT_DEFS.find((b) => b.id === 'mill')!; // 6×6
    expect(grid.stampBlueprint(bp, 0, 0)).toBe(false);
    expect(grid.rooms.length).toBe(0);
  });

  it('two huts side by side form separate rooms', () => {
    const grid = new BuildGrid(30, 10);
    const bp = BLUEPRINT_DEFS.find((b) => b.id === 'hut')!;
    grid.stampBlueprint(bp, 0, 0);
    grid.stampBlueprint(bp, 6, 0); // gap of 1 tile between them
    expect(grid.rooms.length).toBe(2);
    expect(grid.stations.length).toBe(4); // 2 beds × 2 huts
  });
});
