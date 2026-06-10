import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/sim';
import { RegionSim, REGION_MINUTES_PER_TICK } from '../src/sim/region';
import { MINUTES_PER_DAY } from '../src/sim/defs';

const ticksPerDay = MINUTES_PER_DAY / REGION_MINUTES_PER_TICK;

function grow(sim: Simulation): void {
  // make the town flip-eligible without playing 20 game-days
  while (sim.settlers.length < 22) sim.spawnSettler(32, 34);
  sim.stock.wood = 200;
  sim.stock.meal = 200;
}

function runDays(r: RegionSim, days: number): void {
  for (let i = 0; i < days * ticksPerDay; i++) r.tick();
}

describe('The flip (GDD §2.4)', () => {
  it('conserves population: settlers in ≈ cohorts + expedition out', () => {
    const sim = new Simulation(42);
    grow(sim);
    const before = sim.settlers.length;
    const r = RegionSim.fromTown(sim, 8, 80, 80);
    expect(Math.round(r.totalPop())).toBe(before);
    expect(r.expeditions).toHaveLength(1);
    expect(r.expeditions[0].pop).toBe(8);
  });

  it('carves out Notables from the most story-laden settlers', () => {
    const sim = new Simulation(42);
    grow(sim);
    const star = sim.settlers[0];
    for (const k of Object.keys(star.skills) as (keyof typeof star.skills)[]) star.skills[k] = 10;
    star.combat = 10;
    const r = RegionSim.fromTown(sim, 8, 80, 80);
    expect(r.notables.length).toBeGreaterThanOrEqual(6);
    expect(r.notables.some((n) => n.name === star.name)).toBe(true);
    const roles = new Set(r.notables.map((n) => n.role));
    expect(roles.has('Mayor')).toBe(true);
    expect(roles.has('Doctor')).toBe(true);
  });

  it('the expedition arrives and founds town #2', () => {
    const sim = new Simulation(42);
    grow(sim);
    const r = RegionSim.fromTown(sim, 8, 80, 80);
    runDays(r, 5);
    expect(r.settlements).toHaveLength(2);
    expect(r.expeditions).toHaveLength(0);
    expect(r.log.some((l) => l.text.includes('is founded'))).toBe(true);
  });
});

describe('RegionSim (aggregate model)', () => {
  function flipped(seed: number): RegionSim {
    const sim = new Simulation(seed);
    grow(sim);
    const r = RegionSim.fromTown(sim, 8, 80, 80);
    runDays(r, 5);
    return r;
  }

  it('cohorts age, give birth, and grow over years', () => {
    const r = flipped(42);
    const start = r.totalPop();
    runDays(r, 240); // 4 game-years
    expect(r.gameOver).toBe(false);
    expect(r.totalPop()).toBeGreaterThan(start);
    const home = r.settlements[0];
    expect(home.cohorts.bands[0]).toBeGreaterThan(0); // children born
    expect(home.cohorts.bands[4]).toBeGreaterThan(0); // elders aged in
  });

  it('dead Notables are replaced from the cohorts', () => {
    const r = flipped(42);
    const mayor = r.notables.find((n) => n.role === 'Mayor')!;
    mayor.age = 90; // force the actuarial issue
    runDays(r, 300);
    const mayors = r.notables.filter((n) => n.role === 'Mayor');
    expect(mayors.length).toBeGreaterThan(1); // a successor was minted
    expect(mayors.some((n) => n.alive)).toBe(true);
  });

  it('reaches Statehood: 3 towns + 500 pop + charter drafting', () => {
    const r = flipped(42);
    for (let year = 0; year < 14 && !r.stateProclaimed; year++) {
      runDays(r, 60);
      // expand whenever the strongest town can afford it (a player would)
      for (const t of r.settlements) {
        if (r.settlements.length + r.expeditions.length < 4 && r.canFoundTown(t.id).ok) {
          r.foundTown(t.id);
          break;
        }
      }
    }
    expect(r.settlements.length).toBeGreaterThanOrEqual(3);
    expect(r.stateProclaimed).toBe(true);
    expect(r.log.some((l) => l.text.includes('INCORPORATION'))).toBe(true);
  });

  it('is deterministic for a given seed', () => {
    const a = flipped(7);
    const b = flipped(7);
    runDays(a, 100);
    runDays(b, 100);
    expect(a.totalPop()).toBe(b.totalPop());
    expect(a.settlements.map((s) => s.name)).toEqual(b.settlements.map((s) => s.name));
  });
});
