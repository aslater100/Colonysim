/**
 * Local market price clearing (GDD §5.2, first slice) — Track-C tick subsystem
 * lifted to fn(r: RegionSim). Body VERBATIM (this.→r.); dispatched per-settlement
 * from the daily update; state + serialize() stay on RegionSim. The stock/need
 * queries (stockOf / monthNeed) stay on RegionSim, reached via r.
 */
import type { RegionSim } from '../region';
import { TRADE_GOODS, BASE_PRICE, type Settlement } from '../region';

/** The GDD §5.2 price rule, verbatim at this altitude:
 *  Δp = p × 0.05 × (demand − supply) / max(supply, ε), clamped ±2%/day. */
export function updateMarket(r: RegionSim, t: Settlement): void {
    for (const g of TRADE_GOODS) {
      const supply = Math.max(1, r.stockOf(t, g));
      const demand = r.monthNeed(t, g);
      const raw = t.prices[g] * 0.05 * ((demand - supply) / supply);
      const delta = Math.max(-t.prices[g] * 0.02, Math.min(t.prices[g] * 0.02, raw));
      t.prices[g] = Math.max(BASE_PRICE[g] * 0.25, Math.min(BASE_PRICE[g] * 4, t.prices[g] + delta));
    }
  }
