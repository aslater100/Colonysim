import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/sim';
import { TUNING } from '../src/sim/defs';

// Track B Phase 5 — Simulation LOD. A dormant parcel runs only a coarse
// once-a-day `tickDormant()` instead of the full per-tick `tick()`, so the
// realm can hold many owned cells without paying a full sim for each one.

function paintFarm(sim: Simulation, x: number, y: number, w: number, h: number): void {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      sim.planZone('farm', x + dx, y + dy);
    }
  }
}

describe('Simulation — dormant LOD (Phase 5)', () => {
  it('advances exactly one day per call', () => {
    const sim = new Simulation(42);
    const before = sim.day;
    sim.tickDormant();
    expect(sim.day).toBe(before + 1);
    sim.tickDormant();
    expect(sim.day).toBe(before + 2);
  });

  it('accrues and auto-harvests dormant farms into the stockpile', () => {
    const sim = new Simulation(42);
    paintFarm(sim, 40, 52, 3, 3);
    paintFarm(sim, 44, 52, 3, 3);
    expect(sim.world.tiles.some((t) => t.farmZone)).toBe(true);

    const grainBefore = sim.stock.grain;
    // A couple of grow-cycles' worth of dormant days: ripe tiles yield grain.
    for (let i = 0; i < TUNING.farmGrowDays * 2 + 5; i++) sim.tickDormant();
    expect(sim.stock.grain).toBeGreaterThan(grainBefore);
  });

  it('never runs the death/agent path — population only holds or grows', () => {
    const sim = new Simulation(42);
    // Plenty of farmland plus a head start of stores so food never gates growth.
    paintFarm(sim, 40, 52, 4, 4);
    paintFarm(sim, 45, 52, 4, 4);
    sim.stock.grain += 4000;
    const popBefore = sim.settlers.length;

    let min = popBefore;
    for (let i = 0; i < 150; i++) {
      sim.tickDormant();
      min = Math.min(min, sim.settlers.length);
    }
    expect(min).toBeGreaterThanOrEqual(popBefore); // no dormant deaths/emigration
    expect(sim.settlers.length).toBeGreaterThan(popBefore); // a fed colony grows
    expect(sim.gameOver).toBe(false);
  });

  it('runs a long dormant horizon without error and keeps the stock-history window bounded', () => {
    const sim = new Simulation(7);
    for (let i = 0; i < 300; i++) sim.tickDormant();
    expect(sim.gameOver).toBe(false);
    for (const hist of Object.values(sim.stockHistory)) {
      expect((hist ?? []).length).toBeLessThanOrEqual(8);
    }
  });
});
