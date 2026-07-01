/**
 * Internal migration (GDD §5.5) — Track-C tick subsystem lifted to fn(r: RegionSim).
 * Body VERBATIM (this.→r.); dispatched monthly; no RNG. People follow contentment
 * and pay down the route network; state + serialize() stay on RegionSim.
 */
import type { RegionSim } from '../region';
import type { Settlement } from '../region';

/** Move a slow trickle from the least- to the most-appealing town, network-gated. */
export function migrate(r: RegionSim): void {
    if (r.settlements.length < 2) return;
    // People follow both contentment and pay (Phase 1): a booming mill town
    // pulls labor off poor farms even when life there is pleasant enough.
    const regionWage = r.settlements.reduce((s, t) => s + r.avgWageOf(t), 0) / r.settlements.length;
    const score = (t: Settlement) => t.satisfaction + (r.avgWageOf(t) - regionWage) * 30;
    // One pass for the magnet and the source — no full sort, and avgWageOf runs
    // once per town instead of O(n log n) times through a comparator.
    let best = r.settlements[0], worst = r.settlements[0];
    let bestScore = score(best), worstScore = bestScore;
    for (const t of r.settlements) {
      const sc = score(t);
      if (sc > bestScore) { bestScore = sc; best = t; }      // first max (matches stable sort [0])
      if (sc <= worstScore) { worstScore = sc; worst = t; }  // last min (matches stable sort [last])
    }
    // Don't feed an already-overcrowded destination; cap the capital magnet effect.
    const destFull = r.popOf(best) >= best.housing;
    if (bestScore - worstScore > 15 && r.popOf(worst) > 10 && !destFull) {
      // movers ride the network too: without a route, only a trickle walks out
      const connected = r.routePath(worst.id, best.id) !== null;
      // 1% per month (was 2%): urbanization is gradual, not a mass exodus
      const movers = r.popOf(worst) * 0.01 * (connected ? 1 : 0.3);
      r.removePop(worst, movers);
      best.cohorts.bands[1] += movers * 0.7;
      best.cohorts.bands[2] += movers * 0.3;
    }
  }
