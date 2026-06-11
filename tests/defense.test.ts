import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/sim';
import { MINUTES_PER_DAY, MINUTES_PER_TICK, TUNING } from '../src/sim/defs';

const ticksPerDay = MINUTES_PER_DAY / MINUTES_PER_TICK;

function runDays(sim: Simulation, days: number): void {
  for (let i = 0; i < days * ticksPerDay; i++) sim.tick();
}

function paintFarm(sim: Simulation, x: number, y: number, w: number, h: number): void {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      sim.planZone('farm', x + dx, y + dy);
    }
  }
}

describe('defense & game feel (PR C)', () => {
  it('gates let settlers pass but block raiders and beasts', () => {
    const sim = new Simulation(42);
    expect(sim.planZone('gate', 32, 26)).toBe(true);
    expect(sim.world.at(32, 26).gatePlan).toBe(true);
    expect(sim.planZone('gate', 32, 26)).toBe(true); // paint again toggles off
    expect(sim.world.at(32, 26).gatePlan).toBe(false);
    sim.planZone('gate', 32, 26);
    // simulate finished construction: plan becomes gate
    const t = sim.world.at(32, 26);
    t.gatePlan = false;
    t.gate = true;
    t.wallHp = TUNING.gateMaxHp;
    expect(sim.world.passable(32, 26)).toBe(true); // settlers walk through
    expect(sim.world.passable(32, 26, true)).toBe(false); // hostiles do not
    const friendly = sim.world.findPath({ x: 32, y: 25 }, { x: 32, y: 27 });
    expect(friendly?.some((p) => p.x === 32 && p.y === 26)).toBe(true); // straight through the gate
    const hostile = sim.world.findPath({ x: 32, y: 25 }, { x: 32, y: 27 }, true);
    expect(hostile === null || !hostile.some((p) => p.x === 32 && p.y === 26)).toBe(true);
  });

  it('builders construct a planned gate from wood', () => {
    const sim = new Simulation(42);
    sim.stock.wood = 100;
    sim.planZone('gate', 33, 30);
    runDays(sim, 1);
    const t = sim.world.at(33, 30);
    expect(t.gate).toBe(true);
    expect(t.gatePlan).toBe(false);
    expect(t.wallHp).toBe(TUNING.gateMaxHp);
  });

  it('fighters arm themselves with spears when a raid lands', () => {
    const sim = new Simulation(42);
    sim.stock.wood = 200;
    const fighter = sim.settlers[0];
    fighter.combat = 8;
    fighter.health = 100;
    const woodBefore = sim.stock.wood;
    // startRaid sets raidActive/raidUntil; replace raiders with a known-reachable
    // position. RNG-shifted spawns can land east of the river where settlers
    // can't pathfind, causing setDestination to reset state='idle' after arming.
    sim.startRaid();
    sim.raiders = [{ id: 9999, pos: { x: 32, y: 28 }, path: [], health: TUNING.raiderHealth, combat: 3, state: 'attack', repathAt: 0 }];
    sim.tick();
    expect(fighter.armed).toBe(true);
    expect(fighter.state).toBe('fighting');
    expect(sim.stock.wood).toBeLessThan(woodBefore);
  });

  it('deer roam from day one and hunters bring real kills to the stockpile', () => {
    const sim = new Simulation(42);
    expect(sim.animals.filter((a) => a.kind === 'deer').length).toBe(TUNING.deerStartCount);
    sim.placeBuilding('lodge', 38, 32, true);
    sim.stock.meal = 0;
    sim.stock.grain = 0;
    for (const s of sim.settlers) s.needs.food = 100; // nobody eats the take mid-test
    const deerBefore = sim.animals.filter((a) => a.kind === 'deer').length;
    runDays(sim, 2);
    expect(sim.stock.meal).toBeGreaterThanOrEqual(TUNING.huntMealYield);
    expect(sim.animals.filter((a) => a.kind === 'deer').length).toBeLessThan(deerBefore + 2);
  });

  it('a wolf pack passes through without ending the colony', () => {
    const sim = new Simulation(42);
    sim.stock.meal = 500;
    sim.spawnWolfPack(3);
    expect(sim.animals.some((a) => a.kind === 'wolf')).toBe(true);
    runDays(sim, TUNING.wolfStayDays + 1);
    expect(sim.gameOver).toBe(false);
    expect(sim.animals.every((a) => a.kind !== 'wolf')).toBe(true); // left, hunted, or beaten off
  });

  it('save and load round-trips the sim and stays deterministic', () => {
    const a = new Simulation(7);
    paintFarm(a, 24, 36, 3, 3);
    a.placeBuilding('kitchen', 38, 32);
    runDays(a, 3);
    const snapshot = a.serialize();
    const b = Simulation.deserialize(snapshot);
    expect(b.minute).toBe(a.minute);
    expect(b.stock).toEqual(a.stock);
    expect(b.settlers.map((s) => s.name)).toEqual(a.settlers.map((s) => s.name));
    expect(b.world.tiles.filter((t) => t.farmZone).length)
      .toBe(a.world.tiles.filter((t) => t.farmZone).length);
    // The loaded game must continue exactly as the original would have.
    runDays(a, 2);
    runDays(b, 2);
    expect(b.stock).toEqual(a.stock);
    expect(b.settlers.map((s) => [s.name, Math.round(s.mood), Math.round(s.health)]))
      .toEqual(a.settlers.map((s) => [s.name, Math.round(s.mood), Math.round(s.health)]));
    expect(b.animals.length).toBe(a.animals.length);
  });
});
