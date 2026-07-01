/**
 * Century-Graph stats history (GDD §11) — Track-C tick subsystem lifted to
 * fn(r: RegionSim). Body VERBATIM (this.→r.); sampled each January; tick()
 * dispatches; state + serialize() stay on RegionSim.
 */
import type { RegionSim } from '../region';
import { STATS_HISTORY_MAX } from '../region';

/** Push one annual snapshot for the Century Graph (ring buffer, capped). */
export function tickStatsHistory(r: RegionSim): void {
    const playerSettlements = r.settlements.filter((t) => t.factionId === r.playerFactionId);
    const pop = playerSettlements.reduce((s, t) => s + r.popOf(t), 0);
    const satisfaction =
      playerSettlements.length > 0
        ? playerSettlements.reduce((s, t) => s + t.satisfaction, 0) / playerSettlements.length
        : 0;
    r.statsHistory.push({
      year: r.year,
      gdp: r.gdpLastMonth * 12,
      pop,
      warmingC: r.warmingC,
      treasury: r.treasury,
      satisfaction,
    });
    if (r.statsHistory.length > STATS_HISTORY_MAX) r.statsHistory.shift();
  }
