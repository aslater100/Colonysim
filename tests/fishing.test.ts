import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/sim';
import { MINUTES_PER_DAY, MINUTES_PER_TICK, TUNING } from '../src/sim/defs';

const ticksPerDay = MINUTES_PER_DAY / MINUTES_PER_TICK;

function runDays(sim: Simulation, days: number): void {
  for (let i = 0; i < days * ticksPerDay; i++) sim.tick();
}

describe('fishing dock', () => {
  it('produces meals without grain when built near water', () => {
    // Default world (seed 42) has a river around x=51; place dock at x=44 (within fishRange=8)
    const sim = new Simulation(42);
    sim.placeBuilding('fishing_dock', 44, 32, true);
    sim.stock.meal = 0;
    sim.stock.grain = 0;
    for (const s of sim.settlers) s.needs.food = 100; // suppress eating mid-test
    runDays(sim, 2);
    expect(sim.stock.meal).toBeGreaterThanOrEqual(TUNING.fishMealYield);
  });

  it('does not fish when placed far from water', () => {
    // Place dock in the centre clearing well away from the river
    const sim = new Simulation(42);
    sim.placeBuilding('fishing_dock', 25, 30, true);
    sim.stock.meal = 0;
    sim.stock.grain = 0;
    for (const s of sim.settlers) s.needs.food = 100;
    runDays(sim, 2);
    // No water within fishRange — dock is idle
    expect(sim.stock.meal).toBe(0);
  });

  it('does not fish when meals are plentiful', () => {
    const sim = new Simulation(42);
    sim.placeBuilding('fishing_dock', 44, 32, true);
    const plenty = sim.settlers.length * 10;
    sim.stock.meal = plenty;
    sim.stock.grain = 0;
    runDays(sim, 1);
    // Meals were plentiful — fishing task threshold not reached
    expect(sim.stock.meal).toBeLessThanOrEqual(plenty);
  });
});
