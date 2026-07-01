/**
 * Route weathering (GDD §8.2) — Track-C tick subsystem lifted to fn(sim: RegionSim).
 * Body VERBATIM (this.→sim.) ⇒ byte-identical RNG order (guarded by
 * serialize-determinism); dispatched daily; state + serialize() stay on RegionSim.
 * (The parameter is `sim` here, not `r`, because the loop binds a route to `r`.)
 */
import type { RegionSim } from '../region';
import { ROUTE_CONDITION_FLOOR } from '../region';
import { formatCurrency } from '../defs';

/** Storms degrade routes and can wash out a link; trails slowly heal in fair weather. */
export function weatherRoutes(sim: RegionSim): void {
    const storm = sim.weather.forDay(sim.day).sky === 'storm';
    for (const r of sim.routes) {
      if (storm) {
        r.condition = Math.max(ROUTE_CONDITION_FLOOR, r.condition - (r.kind === 'trail' ? 2 : 0.5));
      } else if (r.kind === 'trail') {
        r.condition = Math.min(100, r.condition + 0.1);
      }
    }
    // Washout odds rise with the thermometer (GDD §8.2): a warmer sky
    // carries more water, and the storms that drop it hit harder.
    const washoutChance = Math.min(0.3, 0.12 * (1 + sim.warmingC * 0.3));
    if (storm && sim.routes.length > 0 && sim.rng.chance(washoutChance)) {
      const r = sim.routes[sim.rng.int(sim.routes.length)];
      if (r.kind !== 'trail' && r.condition > 40) {
        r.condition = Math.max(ROUTE_CONDITION_FLOOR, r.condition - 45);
        const a = sim.settlement(r.a)?.name ?? '?';
        const b = sim.settlement(r.b)?.name ?? '?';
        sim.addLog(
          `Storm washout: the ${r.kind} between ${a} and ${b} is cut — ` +
          `${r.kind === 'rail' ? 'a trestle is down' : r.kind === 'maglev' ? 'a guideway pylon is down' : 'a bridge is out'}. Repairs would cost ` + formatCurrency(sim.repairCost(r)) + `.`,
          'bad',
        );
      }
    }
  }
