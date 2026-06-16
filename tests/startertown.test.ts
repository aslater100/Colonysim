import { describe, it, expect } from 'vitest';
import { TownCore } from '../src/sim/towncore';
import { buildStarterTown } from '../src/sim/startertown';

/** The canonical starter town (shared by the GUI and the headless harness) must
 *  build into a living, working colony — this pins the extraction so a refactor
 *  can't quietly produce an empty or non-functional start. */
describe('buildStarterTown', () => {
  const MAP = 96;

  it('seeds a populated colony with rooms, stations and zones', () => {
    const core = new TownCore({ width: MAP, height: MAP, seed: 1, terrain: 'heightmap' });
    buildStarterTown(core, MAP);
    expect(core.population).toBe(8);          // 8 founders
    expect(core.grid.rooms.length).toBeGreaterThan(0);
    expect(core.grid.stations.length).toBeGreaterThan(0);
    expect(core.stock.count('grain')).toBeGreaterThan(0);
  });

  it('runs for a month without the colony dying', () => {
    const core = new TownCore({ width: MAP, height: MAP, seed: 1, terrain: 'heightmap' });
    buildStarterTown(core, MAP);
    const targetDay = core.day + 30;
    let guard = 0;
    while (core.day < targetDay && guard++ < 300000) core.tick();
    expect(core.population).toBeGreaterThan(0); // survives the first month unmanaged
  });
});
