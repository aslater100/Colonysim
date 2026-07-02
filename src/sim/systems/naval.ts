/**
 * Naval trade income (GDD §5.2) — Track-C tick subsystem lifted to fn(r: RegionSim).
 * Body VERBATIM (this.→r.) ⇒ byte-identical RNG order (guarded by
 * serialize-determinism); dispatched monthly; state + serialize() stay on RegionSim.
 */
import type { RegionSim } from '../region';
import { formatCurrency } from '../defs';

/** Monthly harbor trade income. Harbors earn from coastal trade; every sea lane
 *  the player has opened to another continent or island adds an overseas leg,
 *  and warships escort the lot for a premium. The maritime network pays. */
export function navalTradeIncome(r: RegionSim): void {
    const harborTowns = r.settlements.filter(
      (t) => t.factionId === r.playerFactionId && t.buildings.includes('harbor'),
    );
    if (harborTowns.length === 0) return;
    const warships = r.playerWar?.units.find((u) => u.type === 'warship')?.count ?? 0;
    // Base income per harbor (£/month) plus a warship escort premium
    const perHarbor = 12 + warships * 2;
    // Sea lanes the player commands: an overseas leg between two of its own
    // towns. Each is a trade route the harbors feed — worth more when escorted.
    const seaLanes = r.routes.filter(
      (rt) =>
        rt.sea &&
        r.settlement(rt.a)?.factionId === r.playerFactionId &&
        r.settlement(rt.b)?.factionId === r.playerFactionId,
    ).length;
    const perLane = 9 + warships * 2;
    const income = harborTowns.length * perHarbor + seaLanes * perLane;
    r.treasury += income;
    if (r.rng.chance(0.3)) {
      const town = harborTowns[r.rng.int(harborTowns.length)];
      const laneNote = seaLanes > 0
        ? ` ${seaLanes} sea lane${seaLanes > 1 ? 's' : ''} keep the overseas trade flowing.`
        : '';
      r.addLog(
        `Sea trade earns ${formatCurrency(income)} this month — ${town.name}'s harbor is busy.${laneNote}`,
        'good',
      );
    }
  }
