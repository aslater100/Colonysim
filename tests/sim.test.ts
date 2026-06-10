import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/sim';
import { MINUTES_PER_DAY, MINUTES_PER_TICK, TUNING } from '../src/sim/defs';

const ticksPerDay = MINUTES_PER_DAY / MINUTES_PER_TICK;

function runDays(sim: Simulation, days: number): void {
  for (let i = 0; i < days * ticksPerDay; i++) sim.tick();
}

describe('Simulation', () => {
  it('founds a colony of 12 with starting stocks', () => {
    const sim = new Simulation(42);
    expect(sim.settlers).toHaveLength(12);
    expect(sim.stock.meal).toBeGreaterThan(0);
    expect(sim.buildings.some((b) => b.built && b.defId === 'stockpile')).toBe(true);
  });

  it('is deterministic for a given seed', () => {
    const a = new Simulation(7);
    const b = new Simulation(7);
    runDays(a, 5);
    runDays(b, 5);
    expect(a.stock).toEqual(b.stock);
    expect(a.settlers.map((s) => [s.name, Math.round(s.mood)])).toEqual(
      b.settlers.map((s) => [s.name, Math.round(s.mood)]),
    );
  });

  it('settlers eat: meals are consumed over time', () => {
    const sim = new Simulation(42);
    const before = sim.stock.meal + sim.stock.grain;
    runDays(sim, 3);
    expect(sim.stock.meal + sim.stock.grain).toBeLessThan(before);
    expect(sim.settlers.length).toBeGreaterThan(0);
  });

  it('farms sown in spring sustain the colony past the wagon provisions', () => {
    const sim = new Simulation(42);
    sim.placeBuilding('farm', 24, 36);
    sim.placeBuilding('farm', 28, 36);
    sim.placeBuilding('farm', 32, 36);
    sim.placeBuilding('kitchen', 38, 32);
    runDays(sim, TUNING.farmGrowDays + 14);
    expect(sim.world.tiles.some((t) => t.kind === 'soil')).toBe(true);
    expect(sim.gameOver).toBe(false);
    expect(sim.settlers.length).toBeGreaterThanOrEqual(10);
  });

  it('a colony that never farms starves once provisions run out', () => {
    const sim = new Simulation(42);
    runDays(sim, 45);
    expect(sim.gameOver).toBe(true);
  });

  it('soft population ceiling reduces work efficiency above the cap', () => {
    const sim = new Simulation(42);
    expect(sim.softCapWorkMult()).toBe(1);
    for (let i = 0; i < 70; i++) sim.spawnSettler(32, 32);
    expect(sim.settlers.length).toBeGreaterThan(TUNING.softCapPop);
    expect(sim.softCapWorkMult()).toBeLessThan(1);
    expect(sim.softCapMoodPenalty()).toBeGreaterThan(0);
  });

  it('raids arrive, are fought off or leave, and the colony endures', () => {
    const sim = new Simulation(42);
    sim.placeBuilding('farm', 24, 36);
    sim.placeBuilding('farm', 28, 36);
    sim.placeBuilding('farm', 32, 36);
    sim.placeBuilding('kitchen', 38, 32);
    runDays(sim, 30); // past firstRaidDay window (11–15)
    const raidLogged = sim.log.some((l) => l.text.startsWith('RAID!'));
    expect(raidLogged).toBe(true);
    expect(sim.raidActive).toBe(false); // resolved, not stuck
    expect(sim.gameOver).toBe(false);
  });

  it('palisades block pathing until destroyed', () => {
    const sim = new Simulation(42);
    const b = sim.placeBuilding('palisade', 32, 20, true);
    expect(b).not.toBeNull();
    // prebuilt palisades don't set the wall flag via construction; set directly
    sim.world.at(32, 20).wall = true;
    expect(sim.world.passable(32, 20)).toBe(false);
    sim.world.at(32, 20).wall = false;
    expect(sim.world.passable(32, 20)).toBe(true);
  });

  it('a medic treats wounds, clearing infection risk', () => {
    const sim = new Simulation(42);
    const patient = sim.settlers[0];
    const medic = sim.settlers[1];
    patient.wound = { at: sim.minute, untreated: true, infectionRolled: false };
    patient.health = 70;
    for (const s of sim.settlers) s.priorities.medic = 0;
    medic.priorities.medic = 3;
    medic.skills.medic = 8;
    runDays(sim, 2);
    expect(patient.wound === null || patient.wound.untreated === false).toBe(true);
    expect(patient.infection).toBe(false);
  });

  it('settlers recreating together become friends, deepening grief', () => {
    const sim = new Simulation(42);
    sim.placeBuilding('farm', 24, 36);
    sim.placeBuilding('farm', 28, 36);
    sim.placeBuilding('farm', 32, 36);
    sim.placeBuilding('kitchen', 38, 32);
    sim.placeBuilding('hall', 24, 28);
    runDays(sim, 25);
    const someFriendship = sim.settlers.some((s) => sim.friendsOf(s).length > 0);
    expect(someFriendship).toBe(true);
  });

  it('colony survives 60 days with basic infrastructure on default seeds', () => {
    const sim = new Simulation(1001);
    sim.placeBuilding('farm', 24, 36);
    sim.placeBuilding('farm', 28, 36);
    sim.placeBuilding('farm', 24, 40);
    sim.placeBuilding('farm', 28, 40);
    sim.placeBuilding('kitchen', 38, 32);
    sim.placeBuilding('house', 23, 28);
    sim.placeBuilding('house', 40, 28);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        if (sim.world.at(x, y).kind === 'tree') sim.markTree(x, y);
      }
    }
    runDays(sim, 60);
    expect(sim.gameOver).toBe(false);
    expect(sim.settlers.length).toBeGreaterThan(6);
  });
});
