import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/sim';
import { RegionSim, REGION_MINUTES_PER_TICK, ROUTE_SPECS, RAIL_ERA_YEAR } from '../src/sim/region';
import { RegionMap } from '../src/sim/worldgen';
import { MINUTES_PER_DAY, DAYS_PER_YEAR, START_YEAR } from '../src/sim/defs';

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

function toStatehood(r: RegionSim): void {
  for (let year = 0; year < 18 && !r.ceremonyPending; year++) {
    runDays(r, 60);
    for (const t of r.settlements) {
      if (r.settlements.length + r.expeditions.length < 4 && r.canFoundTown(t.id).ok) {
        r.foundTown(t.id);
        break;
      }
    }
  }
  r.completeIncorporation('Testonia', 'council');
}

describe('Region corridors (M6b)', () => {
  it('A* corridor is contiguous, land-only, and at least manhattan-priced', () => {
    const map = new RegionMap(42);
    const a = map.startSite();
    const b = map.bestSiteNear(a.cellX, a.cellY, [{ x: a.cellX, y: a.cellY }])!;
    const c = map.corridor(a.cellX, a.cellY, b.cellX, b.cellY)!;
    expect(c).not.toBeNull();
    expect(c.path[0]).toEqual({ x: a.cellX, y: a.cellY });
    expect(c.path[c.path.length - 1]).toEqual({ x: b.cellX, y: b.cellY });
    for (let i = 1; i < c.path.length; i++) {
      const step = Math.abs(c.path[i].x - c.path[i - 1].x) + Math.abs(c.path[i].y - c.path[i - 1].y);
      expect(step).toBe(1); // 4-dir contiguous
      expect(map.isWater(c.path[i].x, c.path[i].y)).toBe(false);
    }
    const manhattan = Math.abs(b.cellX - a.cellX) + Math.abs(b.cellY - a.cellY);
    expect(c.cost).toBeGreaterThanOrEqual(manhattan); // cheapest cell costs 1
  });

  it('trails are blazed automatically when towns are founded', () => {
    const r = flipped(42);
    expect(r.settlements).toHaveLength(2);
    expect(r.routes).toHaveLength(1);
    expect(r.routes[0].kind).toBe('trail');
    expect(r.routes[0].path.length).toBeGreaterThanOrEqual(2);
    expect(r.connectedToAll()).toBe(true);
  });
});

describe('Caravan capacity (M6b)', () => {
  it('clamps food transfers to route capacity — and a road raises the ceiling', () => {
    const r = flipped(42);
    const [home, town2] = r.settlements;
    const route = r.routeBetween(home.id, town2.id)!;
    route.condition = 100;
    town2.food = 0;
    home.food = r.popOf(home) * 0.75 * 60 + 1000; // deep surplus
    r.caravans();
    const overTrail = town2.food;
    expect(overTrail).toBeGreaterThan(0);
    expect(overTrail).toBeLessThanOrEqual(ROUTE_SPECS.trail.capacity * 0.9 + 1e-9);
    expect(route.freight).toBeGreaterThan(0); // the overlay sees the flow
    // the same hunger behind a wagon road: more grain moves
    route.kind = 'road';
    route.condition = 100;
    town2.food = 0;
    home.food = r.popOf(home) * 0.75 * 60 + 1000;
    r.caravans();
    expect(town2.food).toBeGreaterThan(overTrail);
  });

  it('a rotted route moves less grain (condition decay → capacity loss)', () => {
    const r = flipped(42);
    const [home, town2] = r.settlements;
    const route = r.routeBetween(home.id, town2.id)!;
    route.condition = 15; // the floor: a goat track
    town2.food = 0;
    home.food = r.popOf(home) * 0.75 * 60 + 1000;
    r.caravans();
    expect(town2.food).toBeLessThanOrEqual(ROUTE_SPECS.trail.capacity * 0.15 * 0.9 + 1e-9);
  });

  it('with no route at all, only a smuggler trickle arrives (30%)', () => {
    const r = flipped(42);
    const [home, town2] = r.settlements;
    r.routes = [];
    town2.food = 0;
    home.food = r.popOf(home) * 0.75 * 60 + 1000;
    const need = r.popOf(town2) * 0.75 * 20;
    r.caravans();
    expect(town2.food).toBeCloseTo(need * 0.3, 5);
  });
});

describe('Roads & the treasury (M6b)', () => {
  it('roads are State works: nothing builds before Incorporation', () => {
    const r = flipped(42);
    const [a, b] = r.settlements;
    expect(r.buildRoad(a.id, b.id)).toBe(false);
    expect(r.routeBetween(a.id, b.id)!.kind).toBe('trail');
  });

  it('roadCost prices the terrain and buildRoad charges the treasury', () => {
    const r = flipped(42);
    toStatehood(r);
    const [a, b] = r.settlements;
    const cost = r.roadCost(a.id, b.id)!;
    expect(cost.total).toBeGreaterThan(0);
    expect(cost.breakdown.length).toBeGreaterThan(0);
    r.treasury = cost.total - 1;
    expect(r.buildRoad(a.id, b.id)).toBe(false); // can't afford it
    r.treasury = cost.total + 10;
    expect(r.buildRoad(a.id, b.id)).toBe(true);
    expect(r.treasury).toBeCloseTo(10, 5);
    const route = r.routeBetween(a.id, b.id)!;
    expect(route.kind).toBe('road');
    expect(route.condition).toBe(100);
    expect(r.buildRoad(a.id, b.id)).toBe(false); // already a road
  });

  it('maintenance: a funded treasury keeps roads up, an empty one lets them rot', () => {
    const r = flipped(42);
    toStatehood(r);
    const [a, b] = r.settlements;
    r.treasury = 10000;
    expect(r.buildRoad(a.id, b.id)).toBe(true);
    const route = r.routeBetween(a.id, b.id)!;
    route.condition = 50;
    runDays(r, 35); // one maintenance cycle, funded
    expect(route.condition).toBeGreaterThan(52);
    // now starve the treasury: no taxes, no reserves — and glut every
    // market so the trade levy can't quietly fund the road gangs either
    r.taxRate = 0;
    r.servicesLevel = 0;
    r.militiaLevel = 0;
    r.treasury = 0;
    for (const t of r.settlements) {
      t.food = 1e6;
      t.wood = 1e6;
    }
    route.condition = 80;
    runDays(r, 95); // three unfunded cycles
    expect(route.condition).toBeLessThan(70);
  });
});

/** jump the region clock so the Railworks era is open */
function toRailEra(r: RegionSim): void {
  const target = (RAIL_ERA_YEAR - START_YEAR) * DAYS_PER_YEAR * MINUTES_PER_DAY;
  if (r.minute < target) r.minute = target;
}

describe('The rail era (M6c)', () => {
  it('rail waits on both the State and the Railworks year', () => {
    const r = flipped(42);
    const [a, b] = r.settlements;
    expect(r.railUnlocked()).toBe(false);
    expect(r.buildRail(a.id, b.id)).toBe(false); // no State yet
    toStatehood(r);
    r.treasury = 100000;
    if (r.year < RAIL_ERA_YEAR) {
      expect(r.railUnlocked()).toBe(false);
      expect(r.buildRail(a.id, b.id)).toBe(false); // era not open yet
    }
    toRailEra(r);
    expect(r.railUnlocked()).toBe(true);
    const cost = r.railCost(a.id, b.id)!;
    expect(cost.total).toBeGreaterThan(r.roadCost(a.id, b.id)!.total); // steel is dear
    const before = r.treasury;
    expect(r.buildRail(a.id, b.id)).toBe(true);
    expect(r.treasury).toBeCloseTo(before - cost.total, 5);
    const route = r.routeBetween(a.id, b.id)!;
    expect(route.kind).toBe('rail');
    expect(route.condition).toBe(100);
    expect(r.buildRoad(a.id, b.id)).toBe(false); // no downgrading steel to dirt
    expect(r.buildRail(a.id, b.id)).toBe(false); // already rail
  });

  it('rail moves far more grain than a road (capacity 1200)', () => {
    const r = flipped(42);
    const [home, town2] = r.settlements;
    const route = r.routeBetween(home.id, town2.id)!;
    // a hungry boomtown: need far beyond road capacity, so the link is the limit
    town2.cohorts.bands = [0, 200, 100, 0, 0];
    route.kind = 'road';
    route.condition = 100;
    town2.food = 0;
    home.food = r.popOf(home) * 0.75 * 60 + 100000; // deep surplus
    r.caravans();
    const overRoad = town2.food;
    expect(overRoad).toBeLessThanOrEqual(ROUTE_SPECS.road.capacity * 0.9 + 1e-9);
    route.kind = 'rail';
    town2.food = 0;
    home.food = r.popOf(home) * 0.75 * 60 + 100000;
    r.caravans();
    expect(town2.food).toBeGreaterThan(overRoad);
    expect(town2.food).toBeLessThanOrEqual(ROUTE_SPECS.rail.capacity * 0.9 + 1e-9);
  });
});

describe('Washouts & repair (M6c)', () => {
  it('repairRoute restores a damaged link from the treasury', () => {
    const r = flipped(42);
    toStatehood(r);
    const [a, b] = r.settlements;
    r.treasury = 10000;
    expect(r.buildRoad(a.id, b.id)).toBe(true);
    const route = r.routeBetween(a.id, b.id)!;
    route.condition = 40; // a storm took the bridge
    const cost = r.repairCost(route);
    expect(cost).toBeGreaterThan(0);
    r.treasury = cost - 1;
    expect(r.repairRoute(a.id, b.id)).toBe(false); // can't afford the crews
    expect(route.condition).toBe(40);
    r.treasury = cost + 5;
    expect(r.repairRoute(a.id, b.id)).toBe(true);
    expect(route.condition).toBe(100);
    expect(r.treasury).toBeCloseTo(5, 5);
    expect(r.repairRoute(a.id, b.id)).toBe(false); // nothing left to fix
  });

  it('trails cannot be bought back to health — only built links repair', () => {
    const r = flipped(42);
    toStatehood(r);
    const [a, b] = r.settlements;
    const route = r.routeBetween(a.id, b.id)!;
    expect(route.kind).toBe('trail');
    route.condition = 40;
    r.treasury = 10000;
    expect(r.repairRoute(a.id, b.id)).toBe(false);
  });
});

describe('Militia relief rides the network (M6c)', () => {
  it('a built link to a larger town counts as a relief line; a trail does not', () => {
    const r = flipped(42);
    const [home, town2] = r.settlements;
    // make town2 clearly the smaller settlement
    town2.cohorts.bands = [1, 4, 3, 0, 0];
    home.cohorts.bands[2] += 50;
    const route = r.routeBetween(home.id, town2.id)!;
    route.kind = 'trail';
    expect(r.reliefLine(town2)).toBe(false); // raiders cut trails easily
    route.kind = 'road';
    expect(r.reliefLine(town2)).toBe(true);
    expect(r.reliefLine(home)).toBe(false); // nobody bigger to ride from
    route.kind = 'rail';
    expect(r.reliefLine(town2)).toBe(true);
  });
});

describe('The charter rides the network (GDD §2.2)', () => {
  it('charter eligibility requires every town connected by routes', () => {
    const r = flipped(42);
    // three towns and plenty of citizens, but sever the routes
    const t2 = r.settlements[1];
    r.settlements.push({ ...t2, id: 9999, name: 'Island Rock', cohorts: { bands: [...t2.cohorts.bands] } });
    r.settlements[0].cohorts.bands[2] = 600;
    expect(r.totalPop()).toBeGreaterThanOrEqual(500);
    expect(r.settlements.length).toBeGreaterThanOrEqual(3);
    expect(r.charterEligible()).toBe(false); // the new town has no route
    expect(r.connectedToAll()).toBe(false);
    // a trail to the orphan town completes the graph
    r.routes.push({
      a: t2.id, b: 9999, kind: 'trail', condition: 100,
      path: [{ x: 0, y: 0 }, { x: 1, y: 0 }], terrainCost: 2, freight: 0,
    });
    expect(r.connectedToAll()).toBe(true);
    expect(r.charterEligible()).toBe(true);
  });
});
