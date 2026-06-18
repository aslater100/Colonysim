import { describe, expect, it } from 'vitest';
import { RegionSim, REGION_MINUTES_PER_TICK, ROUTE_SPECS, RAIL_ERA_YEAR, HIGHWAY_ERA_YEAR, MAGLEV_ERA_YEAR } from '../src/sim/region';
import { RegionMap, CELL_SCALE } from '../src/sim/worldgen';
import { MINUTES_PER_DAY, DAYS_PER_YEAR, START_YEAR } from '../src/sim/defs';

const ticksPerDay = MINUTES_PER_DAY / REGION_MINUTES_PER_TICK;

function runDays(r: RegionSim, days: number): void {
  for (let i = 0; i < days * ticksPerDay; i++) r.tick();
}

/** Create a colony and launch the first expedition, wait for 2 towns and 1 auto-blazed trail. */
function flipped(seed: number): RegionSim {
  const r = RegionSim.create(seed, { aiDifficulty: 'normal', currencySymbol: '$' });
  r.settlements[0].cohorts.bands[2] += 20;
  r.settlements[0].food = 200;
  r.settlements[0].wood = 200;
  r.foundTown(r.settlements[0].id);
  runDays(r, 30); // wait for expedition to arrive (2-30 game-days)
  return r;
}

function toStatehood(r: RegionSim): void {
  for (let year = 0; year < 40 && !r.ceremonyPending; year++) {
    // Ensure charter requirements stay met during loop (including new settlements)
    r.treasury = Math.max(r.treasury, 12000); // enough for roads + buffer
    for (const t of r.settlements) {
      t.garrisonStrength = Math.max(t.garrisonStrength || 0, 5);
      // Boost population to ensure 500+ for charter gate
      t.cohorts.bands[1] = Math.max(t.cohorts.bands[1], 100);
    }
    runDays(r, 60);

    // Need 3 player settlements to reach statehood (rivals don't count)
    let playerSettlements = r.settlements.filter((s) => s.factionId === r.playerFactionId);
    for (const t of r.settlements) {
      if (playerSettlements.length < 3 && r.canFoundTown(t.id).ok) {
        r.foundTown(t.id);
        runDays(r, 60); // let the expedition complete
        playerSettlements = r.settlements.filter((s) => s.factionId === r.playerFactionId);
        break;
      }
    }

    // Ensure all player settlements are connected via roads
    if (playerSettlements.length >= 2) {
      r.treasury = Math.max(r.treasury, 12000); // refresh if spent
      for (let i = 0; i < playerSettlements.length; i++) {
        for (let j = i + 1; j < playerSettlements.length; j++) {
          if (!r.routeBetween(playerSettlements[i].id, playerSettlements[j].id)) {
            r.buildRoad(playerSettlements[i].id, playerSettlements[j].id);
          }
        }
      }
    }

    // Check if charter is eligible and manually trigger ceremony if needed
    if (r.charterEligible() && !r.ceremonyPending) {
      r.ceremonyPending = true;
    }
  }

  // Final ensure requirements are met before completing incorporation
  r.treasury = Math.max(r.treasury, 50000);
  const finalPlayerSettlements = r.settlements.filter((s) => s.factionId === r.playerFactionId);
  for (const t of finalPlayerSettlements) {
    t.garrisonStrength = Math.max(t.garrisonStrength || 0, 5);
  }
  if (!r.stateProclaimed) {
    if (!r.ceremonyPending && r.charterEligible()) {
      r.ceremonyPending = true;
    }
    r.completeIncorporation('Testonia', 'council');
  }
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
    expect(r.settlements.filter((s) => s.factionId === r.playerFactionId)).toHaveLength(2);
    expect(r.routes).toHaveLength(1);
    expect(r.routes[0].kind).toBe('trail');
    expect(r.routes[0].path.length).toBeGreaterThanOrEqual(2);
    expect(r.connectedToAll()).toBe(true);
  });

  it('a newcomer grafts onto the nearest town already on the backbone, not the root (no star)', () => {
    const r = flipped(42);
    const internals = r as unknown as {
      settlements: Array<{ id: number; x: number; y: number; factionId: number }>;
      networkAnchor: (t: { id: number; x: number; y: number; factionId: number }) => number;
    };
    const [home, town2] = internals.settlements;
    // a newcomer hard by town2 but far from the root: it should anchor to town2
    const newcomer = { ...town2, id: 9001, x: town2.x + 1, y: town2.y };
    expect(internals.networkAnchor(newcomer)).toBe(town2.id);
    expect(internals.networkAnchor(newcomer)).not.toBe(home.id);
  });

  it('founding many towns keeps the whole faction connected as a single tree', () => {
    const r = flipped(42);
    for (let i = 0; i < 6; i++) {
      // top a town up so the expansion economy lets it send settlers, then wait for arrival
      const src = r.settlements.find((t) => t.factionId === r.playerFactionId)!;
      src.food = 2000;
      src.wood = 2000;
      src.cohorts.bands = [20, 60, 40, 10, 5];
      if (!r.canFoundTown(src.id).ok) break;
      r.foundTown(src.id);
      runDays(r, 60);
    }
    const playerTowns = r.settlements.filter((t) => t.factionId === r.playerFactionId);
    expect(playerTowns.length).toBeGreaterThan(2);
    expect(r.connectedToAll()).toBe(true);
    // a backbone is a tree: one trail per newcomer, never a parallel branch
    const playerIds = new Set(playerTowns.map((t) => t.id));
    const playerRoutes = r.routes.filter((rt) => playerIds.has(rt.a) && playerIds.has(rt.b));
    expect(playerRoutes).toHaveLength(playerTowns.length - 1);
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
    // Call maintainRoutes directly to isolate the mechanic from weather/washout noise.
    route.condition = 50;
    (r as any).maintainRoutes();
    expect(route.condition).toBeGreaterThan(50); // funded maintenance improved the road
    // unfunded: three cycles drain the road
    r.treasury = 0;
    route.condition = 80;
    (r as any).maintainRoutes();
    (r as any).maintainRoutes();
    (r as any).maintainRoutes();
    expect(route.condition).toBeLessThan(70);
  });
});

/** jump the region clock so a given era year is open */
function toYear(r: RegionSim, year: number): void {
  const target = (year - START_YEAR) * DAYS_PER_YEAR * MINUTES_PER_DAY;
  if (r.minute < target) r.minute = target;
}

function toRailEra(r: RegionSim): void {
  toYear(r, RAIL_ERA_YEAR);
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

describe('The asphalt age (transportation.md §5)', () => {
  it('highways wait on the State and 1945 — then replace even rail', () => {
    const r = flipped(42);
    toStatehood(r);
    r.treasury = 1e6;
    const [a, b] = r.settlements;
    expect(r.highwayUnlocked()).toBe(false);
    expect(r.buildHighway(a.id, b.id)).toBe(false); // era not open
    toRailEra(r);
    expect(r.buildRail(a.id, b.id)).toBe(true);
    toYear(r, HIGHWAY_ERA_YEAR);
    expect(r.highwayUnlocked()).toBe(true);
    expect(r.buildHighway(a.id, b.id)).toBe(true); // pave over the rail bed
    const route = r.routeBetween(a.id, b.id)!;
    expect(route.kind).toBe('highway');
    expect(route.condition).toBe(100);
    expect(r.buildRail(a.id, b.id)).toBe(false); // no going back to steel
    expect(r.buildHighway(a.id, b.id)).toBe(false); // already paved
  });

  it('the stranded-asset arithmetic: cheaper to build and keep, less to carry', () => {
    expect(ROUTE_SPECS.highway.buildPerCost).toBeLessThan(ROUTE_SPECS.rail.buildPerCost);
    expect(ROUTE_SPECS.highway.maintPerCell).toBeLessThan(ROUTE_SPECS.rail.maintPerCell);
    expect(ROUTE_SPECS.highway.capacity).toBeLessThan(ROUTE_SPECS.rail.capacity);
    expect(ROUTE_SPECS.highway.capacity).toBeGreaterThan(ROUTE_SPECS.road.capacity);
  });
});

describe('The maglev era (transportation.md §5)', () => {
  it('maglev waits on the State and 2005 — then floats over even asphalt', () => {
    const r = flipped(42);
    toStatehood(r);
    r.treasury = 1e7;
    const [a, b] = r.settlements;
    expect(r.maglevUnlocked()).toBe(false);
    expect(r.buildMaglev(a.id, b.id)).toBe(false); // era not open
    toYear(r, HIGHWAY_ERA_YEAR);
    expect(r.buildHighway(a.id, b.id)).toBe(true);
    expect(r.maglevUnlocked()).toBe(false); // 1945 asphalt is not 2005 superconductors
    toYear(r, MAGLEV_ERA_YEAR);
    expect(r.maglevUnlocked()).toBe(true);
    const cost = r.maglevCost(a.id, b.id)!;
    expect(cost.total).toBeGreaterThan(r.railCost(a.id, b.id)!.total); // dearest build in the game
    const before = r.treasury;
    expect(r.buildMaglev(a.id, b.id)).toBe(true);
    expect(r.treasury).toBeCloseTo(before - cost.total, 5);
    const route = r.routeBetween(a.id, b.id)!;
    expect(route.kind).toBe('maglev');
    expect(route.condition).toBe(100);
    expect(r.buildHighway(a.id, b.id)).toBe(false); // nothing tops the guideway
    expect(r.buildRail(a.id, b.id)).toBe(false);
    expect(r.buildMaglev(a.id, b.id)).toBe(false); // already floating
  });

  it('maglev moves more grain than rail (capacity 3000)', () => {
    const r = flipped(42);
    const [home, town2] = r.settlements;
    const route = r.routeBetween(home.id, town2.id)!;
    // a megacity's hunger: need far beyond rail capacity, so the link is the limit
    town2.cohorts.bands = [0, 600, 300, 0, 0];
    route.kind = 'rail';
    route.condition = 100;
    town2.food = 0;
    home.food = r.popOf(home) * 0.75 * 60 + 1e6; // deep surplus
    r.caravans();
    const overRail = town2.food;
    expect(overRail).toBeLessThanOrEqual(ROUTE_SPECS.rail.capacity * 0.9 + 1e-9);
    route.kind = 'maglev';
    town2.food = 0;
    home.food = r.popOf(home) * 0.75 * 60 + 1e6;
    r.caravans();
    expect(town2.food).toBeGreaterThan(overRail);
    expect(town2.food).toBeLessThanOrEqual(ROUTE_SPECS.maglev.capacity * 0.9 + 1e-9);
  });

  it('the capex/opex inversion: dearest to build, more capacity than steel, cheap to run', () => {
    expect(ROUTE_SPECS.maglev.buildPerCost).toBeGreaterThan(ROUTE_SPECS.rail.buildPerCost);
    expect(ROUTE_SPECS.maglev.capacity).toBeGreaterThan(ROUTE_SPECS.rail.capacity);
    expect(ROUTE_SPECS.maglev.maintPerCell).toBeLessThan(ROUTE_SPECS.rail.maintPerCell);
    expect(ROUTE_SPECS.maglev.speed).toBeGreaterThan(ROUTE_SPECS.rail.speed);
  });

  it('Automated Freight research cuts every maintenance bill by 40%', () => {
    const r = flipped(42);
    toStatehood(r);
    r.treasury = 1e6;
    const [a, b] = r.settlements;
    expect(r.buildRoad(a.id, b.id)).toBe(true);
    const route = r.routeBetween(a.id, b.id)!;
    const manned = r.maintBill(route);
    expect(manned).toBeCloseTo((route.path.length / CELL_SCALE) * ROUTE_SPECS.road.maintPerCell, 5);
    r.researched.add('automated_logistics');
    expect(r.maintBill(route)).toBeCloseTo(manned * 0.6, 5);
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

describe('Route Network controls (Phase A)', () => {
  it('deleteRoute tears a built link back to a trail, keeping the towns connected', () => {
    const r = flipped(42);
    toStatehood(r);
    const [a, b] = r.settlements;
    r.treasury = 10000;
    expect(r.buildRoad(a.id, b.id)).toBe(true);
    expect(r.routeBetween(a.id, b.id)!.kind).toBe('road');
    expect(r.deleteRoute(a.id, b.id)).toBe(true);
    const route = r.routeBetween(a.id, b.id)!;
    expect(route.kind).toBe('trail');
    expect(route.condition).toBe(100);
    expect(r.connectedToAll()).toBe(true); // no settlement orphaned
    expect(r.deleteRoute(a.id, b.id)).toBe(false); // a trail has nothing to tear up
  });

  it('deleteRoute is a State work — nothing tears up before Incorporation', () => {
    const r = flipped(42);
    const [a, b] = r.settlements;
    // force a road onto the graph without statehood, then try to delete it
    r.routeBetween(a.id, b.id)!.kind = 'road';
    expect(r.deleteRoute(a.id, b.id)).toBe(false);
    expect(r.routeBetween(a.id, b.id)!.kind).toBe('road');
  });

  it('a pinned cargo priority overrides the automatic dominant-cargo reading', () => {
    const r = flipped(42);
    toStatehood(r);
    const [a, b] = r.settlements;
    r.treasury = 10000;
    expect(r.buildRoad(a.id, b.id)).toBe(true);
    expect(r.setRouteCargoPriority(a.id, b.id, 'information')).toBe(true);
    const route = r.routeBetween(a.id, b.id)!;
    expect(route.cargoPriority).toBe('information');
    expect(route.cargoType).toBe('information');
    // the monthly recompute must not wash the pin away
    runDays(r, 35);
    expect(route.cargoType).toBe('information');
    // clearing the pin hands the route back to the automatic tag
    expect(r.setRouteCargoPriority(a.id, b.id, null)).toBe(true);
    expect(route.cargoPriority).toBeNull();
  });

  it('cargoPriority survives a save/load round-trip', () => {
    const r = flipped(42);
    toStatehood(r);
    const playerSettlements = r.settlements.filter((s) => s.factionId === r.playerFactionId);
    const [a, b] = playerSettlements;
    r.treasury = 10000;
    r.buildRoad(a.id, b.id);
    r.setRouteCargoPriority(a.id, b.id, 'industry');
    const r2 = RegionSim.deserialize(r.serialize());
    expect(r2.routeBetween(a.id, b.id)!.cargoPriority).toBe('industry');
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
    // Set up charter requirements: treasury and garrison
    r.treasury = 8000;
    for (const t of r.settlements) {
      t.garrisonStrength = 5;
    }
    expect(r.charterEligible()).toBe(true);
  });
});
