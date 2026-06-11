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

  function toStatehood(r: RegionSim): void {
    for (let year = 0; year < 18 && !r.ceremonyPending; year++) {
      runDays(r, 60);
      // expand whenever the strongest town can afford it (a player would)
      for (const t of r.settlements) {
        if (r.settlements.length + r.expeditions.length < 4 && r.canFoundTown(t.id).ok) {
          r.foundTown(t.id);
          break;
        }
      }
    }
    r.completeIncorporation('Testonia', 'council');
  }

  it('reaches Statehood: 3 towns + 500 pop + charter + ceremony', () => {
    const r = flipped(42);
    toStatehood(r);
    expect(r.settlements.length).toBeGreaterThanOrEqual(3);
    expect(r.stateProclaimed).toBe(true);
    expect(r.stateName).toBe('Testonia');
    expect(r.log.some((l) => l.text.includes('INCORPORATION'))).toBe(true);
  });

  it('statehood brings money: taxes fill the treasury, spending drains it', () => {
    const r = flipped(42);
    toStatehood(r);
    r.taxRate = 0.15;
    runDays(r, 120);
    expect(r.gdpLastMonth).toBeGreaterThan(0);
    expect(r.treasury).toBeGreaterThan(0);
  });

  it('crushing taxes breed strikes', () => {
    const r = flipped(42);
    toStatehood(r);
    r.taxRate = 0.3;
    r.servicesLevel = 0;
    runDays(r, 360);
    expect(r.log.some((l) => l.text.includes('Strike in'))).toBe(true);
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

describe('Region event variety', () => {
  function flipped(seed: number): RegionSim {
    const sim = new Simulation(seed);
    grow(sim);
    const r = RegionSim.fromTown(sim, 8, 80, 80);
    runDays(r, 5);
    return r;
  }

  /** the event methods are private; tests reach in to fire them directly */
  type EventHooks = {
    eventBandits(t: unknown): void;
    eventFire(t: unknown): void;
    eventProspectors(t: unknown): void;
    eventNotableBeat(t: unknown): void;
  };
  const hooks = (r: RegionSim) => r as unknown as EventHooks;

  it('highwaymen rob rotted routes but hang where the grade is kept', () => {
    const r = flipped(42);
    const [home, town2] = r.settlements;
    const route = r.routeBetween(home.id, town2.id)!;
    route.kind = 'road';
    route.condition = 30; // a rotted road is cover
    route.freight = 50; // and the caravans make it worth working
    home.food = 500;
    hooks(r).eventBandits(home);
    expect(home.food).toBeLessThan(500);
    expect(r.log[r.log.length - 1].text).toContain('Highwaymen prey');
    route.condition = 90; // a kept road is not
    const before = home.food;
    hooks(r).eventBandits(home);
    expect(home.food).toBe(before);
    expect(r.log[r.log.length - 1].text).toContain('They hang');
  });

  it('a funded State fire brigade holds the damage down', () => {
    const a = flipped(42);
    const burnt = a.settlements[0];
    burnt.wood = 100;
    hooks(a).eventFire(burnt);
    const unfundedLoss = 100 - burnt.wood;
    const b = flipped(42);
    const saved = b.settlements[0];
    b.stateProclaimed = true;
    b.servicesLevel = 1;
    saved.wood = 100;
    hooks(b).eventFire(saved);
    expect(100 - saved.wood).toBeLessThan(unfundedLoss);
  });

  it('prospectors pay the treasury once there is a State, the stores before', () => {
    const r = flipped(42);
    const t = r.settlements[0];
    const wood = t.wood;
    hooks(r).eventProspectors(t);
    expect(t.wood).toBeGreaterThan(wood);
    r.stateProclaimed = true;
    r.treasury = 0;
    hooks(r).eventProspectors(t);
    expect(r.treasury).toBeGreaterThan(0);
  });

  it('Notable beats accrue to the bio — the attachment engine keeps writing', () => {
    const r = flipped(42);
    const t = r.settlements[0];
    const n = r.notablesAt(t.id)[0];
    const beats = n.bio.length;
    for (let i = 0; i < 12; i++) hooks(r).eventNotableBeat(t);
    expect(r.notablesAt(t.id).some((m) => m.bio.length > beats)).toBe(true);
  });

  it('the long run shows the wider deck, not just the original five', () => {
    const r = flipped(42);
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      runDays(r, 15); // 600 days total, sampling before the log cap trims
      for (const l of r.log) {
        if (l.text.includes('Highwaymen')) seen.add('bandits');
        if (l.text.includes('Fire') || l.text.includes('brigade')) seen.add('fire');
        if (l.text.includes('Prospectors')) seen.add('prospectors');
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });
});

describe('Region save/load', () => {
  function flippedPair(seed: number): { sim: Simulation; r: RegionSim } {
    const sim = new Simulation(seed);
    grow(sim);
    const r = RegionSim.fromTown(sim, 8, 80, 80);
    runDays(r, 200); // a few years of history: towns, trails, events
    return { sim, r };
  }

  /** save + load: deserialize atop a restored town sim, as the menu does */
  function roundTrip(sim: Simulation, r: RegionSim): RegionSim {
    const town = Simulation.deserialize(sim.serialize());
    return RegionSim.deserialize(r.serialize(), town);
  }

  it('round-trips the region exactly', () => {
    const { sim, r } = flippedPair(42);
    const r2 = roundTrip(sim, r);
    expect(r2.day).toBe(r.day);
    expect(r2.totalPop()).toBe(r.totalPop());
    expect(r2.settlements.map((s) => s.name)).toEqual(r.settlements.map((s) => s.name));
    expect(r2.settlements.map((s) => s.food)).toEqual(r.settlements.map((s) => s.food));
    expect(r2.notables.map((n) => [n.name, n.role, n.alive])).toEqual(
      r.notables.map((n) => [n.name, n.role, n.alive]));
    expect(r2.routes.map((rt) => [rt.a, rt.b, rt.kind, rt.condition])).toEqual(
      r.routes.map((rt) => [rt.a, rt.b, rt.kind, rt.condition]));
  });

  it('a loaded region continues deterministically — same history unfolds', () => {
    const { sim, r } = flippedPair(42);
    const r2 = roundTrip(sim, r);
    runDays(r, 150);
    runDays(r2, 150);
    expect(r2.totalPop()).toBe(r.totalPop());
    expect(r2.settlements.map((s) => s.food)).toEqual(r.settlements.map((s) => s.food));
    expect(r2.log[r2.log.length - 1]).toEqual(r.log[r.log.length - 1]);
  });

  it('preserves the State: name, lean, treasury, and built routes', () => {
    const { sim, r } = flippedPair(42);
    for (let year = 0; year < 18 && !r.ceremonyPending; year++) {
      runDays(r, 60);
      for (const t of r.settlements) {
        if (r.settlements.length + r.expeditions.length < 4 && r.canFoundTown(t.id).ok) {
          r.foundTown(t.id);
          break;
        }
      }
    }
    r.completeIncorporation('Testonia', 'mayor');
    r.treasury = 5000;
    const [a, b] = r.settlements;
    expect(r.buildRoad(a.id, b.id)).toBe(true);
    const r2 = roundTrip(sim, r);
    expect(r2.stateProclaimed).toBe(true);
    expect(r2.stateName).toBe('Testonia');
    expect(r2.govLean).toBe('mayor');
    expect(r2.treasury).toBe(r.treasury);
    expect(r2.routeBetween(a.id, b.id)!.kind).toBe('road');
    expect(r2.charterProgress).toBe(r.charterProgress);
  });
});
