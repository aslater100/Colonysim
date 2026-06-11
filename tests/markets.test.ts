import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/sim';
import { RegionSim, REGION_MINUTES_PER_TICK, BASE_PRICE, ROUTE_SPECS } from '../src/sim/region';
import { MINUTES_PER_DAY } from '../src/sim/defs';

const ticksPerDay = MINUTES_PER_DAY / REGION_MINUTES_PER_TICK;

function grow(sim: Simulation): void {
  while (sim.settlers.length < 22) sim.spawnSettler(32, 34);
  sim.stock.wood = 200;
  sim.stock.meal = 200;
}

function runDays(r: RegionSim, days: number): void {
  for (let i = 0; i < days * ticksPerDay; i++) r.tick();
}

/** flip and let the first expedition arrive: 2 towns, 1 auto-blazed trail */
function flipped(seed: number): RegionSim {
  const sim = new Simulation(seed);
  grow(sim);
  const r = RegionSim.fromTown(sim, 8, 80, 80);
  runDays(r, 5);
  return r;
}

describe('Local markets (GDD §5.2)', () => {
  it('scarcity raises the price, glut lowers it — clamped ±2%/day', () => {
    const r = flipped(42);
    const t = r.settlements[0];
    t.food = 1; // an empty granary prices grain dear
    const p0 = t.prices.food;
    runDays(r, 1);
    expect(t.prices.food).toBeGreaterThan(p0);
    expect(t.prices.food).toBeLessThanOrEqual(p0 * 1.02 + 1e-9);
    t.food = 1e6; // a glut prices it cheap
    const p1 = t.prices.food;
    runDays(r, 1);
    expect(t.prices.food).toBeLessThan(p1);
    expect(t.prices.food).toBeGreaterThanOrEqual(p1 * 0.98 - 1e-9);
  });

  it('prices stay inside the 0.25×–4× band around base', () => {
    const r = flipped(42);
    const t = r.settlements[0];
    t.food = 1;
    runDays(r, 400); // years of famine pricing
    expect(t.prices.food).toBeLessThanOrEqual(BASE_PRICE.food * 4 + 1e-9);
  });

  it('traders move goods from cheap to dear along a route', () => {
    const r = flipped(42);
    const [home, town2] = r.settlements;
    home.wood = 5000; // timber town
    home.prices.wood = 0.06;
    town2.wood = 0;
    town2.prices.wood = 0.3;
    const route = r.routeBetween(home.id, town2.id)!;
    route.condition = 100;
    route.freight = 0;
    r.traders();
    expect(town2.wood).toBeGreaterThan(0);
    expect(route.freight).toBeGreaterThan(0); // the overlay sees commerce too
    expect(r.tradeValueLastMonth).toBeGreaterThan(0);
  });

  it('no route, no trade — peddlers do not arbitrage', () => {
    const r = flipped(42);
    const [home, town2] = r.settlements;
    r.routes = [];
    home.wood = 5000;
    home.prices.wood = 0.06;
    town2.wood = 0;
    town2.prices.wood = 0.3;
    r.traders();
    expect(town2.wood).toBe(0);
    expect(r.tradeValueLastMonth).toBe(0);
  });

  it('a thin margin is not worth the trip', () => {
    const r = flipped(42);
    const [home, town2] = r.settlements;
    home.wood = 5000;
    home.prices.wood = 0.12;
    town2.wood = 0;
    town2.prices.wood = 0.125; // gap below 1.5× the freight rate
    r.traders();
    expect(town2.wood).toBe(0);
  });

  it('trade clamps to what the route can still carry after the caravans', () => {
    const r = flipped(42);
    const [home, town2] = r.settlements;
    home.wood = 50000;
    home.prices.wood = 0.06;
    town2.wood = 0;
    town2.prices.wood = 0.3;
    const route = r.routeBetween(home.id, town2.id)!;
    route.condition = 100;
    route.freight = r.effectiveCapacity(route); // caravans used it all
    r.traders();
    expect(town2.wood).toBe(0);
    route.freight = r.effectiveCapacity(route) - 10; // 10 units of headroom
    r.traders();
    expect(town2.wood).toBeLessThanOrEqual(10 * 0.95 + 1e-9);
    expect(town2.wood).toBeGreaterThan(0);
  });

  it('the State levies the turnover; before the State nobody collects', () => {
    const r = flipped(42);
    const [home, town2] = r.settlements;
    home.wood = 5000;
    home.prices.wood = 0.06;
    town2.wood = 0;
    town2.prices.wood = 0.3;
    r.treasury = 0;
    r.traders();
    expect(r.tradeValueLastMonth).toBeGreaterThan(0);
    expect(r.treasury).toBe(0); // no State, no levy
    r.stateProclaimed = true;
    home.wood = 5000;
    town2.wood = 0;
    const route = r.routeBetween(home.id, town2.id)!;
    route.freight = 0;
    r.traders();
    expect(r.treasury).toBeCloseTo(r.tradeValueLastMonth * 0.05, 6);
  });

  it('capacity spec sanity: a trail can carry a trade at all', () => {
    expect(ROUTE_SPECS.trail.capacity).toBeGreaterThan(1);
  });
});
