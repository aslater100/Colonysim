import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/sim';
import { MINUTES_PER_DAY, MINUTES_PER_TICK } from '../src/sim/defs';
import { MAP_W } from '../src/sim/world';

const ticksPerDay = MINUTES_PER_DAY / MINUTES_PER_TICK;

function runDays(sim: Simulation, days: number): void {
  for (let i = 0; i < days * ticksPerDay; i++) sim.tick();
}

describe('Roads (Milestone 6a)', () => {
  it('pathfinding prefers a road over open ground', () => {
    const sim = new Simulation(42);
    // straight gravel road through the clearing
    for (let x = 22; x <= 42; x++) sim.world.at(x, 30).road = 'gravel';
    const path = sim.world.findPath({ x: 22, y: 30 }, { x: 42, y: 30 })!;
    expect(path).not.toBeNull();
    const onRoad = path.filter((p) => sim.world.at(p.x, p.y).road === 'gravel').length;
    expect(onRoad / path.length).toBeGreaterThan(0.85);
    // a parallel trip one row off still detours onto the road when it pays
    const detour = sim.world.findPath({ x: 22, y: 33 }, { x: 42, y: 33 })!;
    expect(detour.some((p) => sim.world.at(p.x, p.y).road === 'gravel')).toBe(true);
  });

  it('bridges are the only way across water', () => {
    const sim = new Simulation(42);
    // find a water column from the site river
    let wx = -1;
    let wy = -1;
    outer: for (let y = 20; y < 44; y++) {
      for (let x = 44; x < MAP_W; x++) {
        if (sim.world.at(x, y).kind === 'water') {
          wx = x;
          wy = y;
          break outer;
        }
      }
    }
    expect(wx).toBeGreaterThan(0);
    expect(sim.world.passable(wx, wy)).toBe(false);
    expect(sim.planRoad('bridge', wx, wy)).toBe(true);
    expect(sim.world.at(wx, wy).roadPlan).toBe('bridge');
    sim.world.at(wx, wy).road = 'bridge'; // force-complete
    sim.world.at(wx, wy).roadPlan = null;
    expect(sim.world.passable(wx, wy)).toBe(true);
  });

  it('settlers quarry marked rock into stone', () => {
    const sim = new Simulation(42);
    // place a rock in the clearing and mark it
    sim.world.at(26, 26).kind = 'rock';
    sim.markTree(26, 26);
    expect(sim.world.at(26, 26).marked).toBe(true);
    runDays(sim, 3);
    expect(sim.stock.stone).toBeGreaterThan(0);
  });

  it('planned roads get built by settlers and speed movement', () => {
    const sim = new Simulation(42);
    for (let x = 24; x <= 34; x++) sim.planRoad('dirt', x, 28);
    runDays(sim, 4);
    const built = [];
    for (let x = 24; x <= 34; x++) if (sim.world.at(x, 28).road === 'dirt') built.push(x);
    expect(built.length).toBeGreaterThan(6);
    expect(sim.world.speedMult(built[0], 28, false)).toBeCloseTo(1.3);
    expect(sim.world.speedMult(built[0], 28, true)).toBe(1); // mud in rain
  });

  it('plank roads consume wood from the stockpile', () => {
    const sim = new Simulation(42);
    const woodBefore = sim.stock.wood;
    for (let x = 24; x <= 31; x++) sim.planRoad('plank', x, 27);
    runDays(sim, 4);
    const built = [];
    for (let x = 24; x <= 31; x++) if (sim.world.at(x, 27).road === 'plank') built.push(x);
    expect(built.length).toBeGreaterThan(4);
    expect(sim.stock.wood).toBeLessThan(woodBefore);
  });
});
