/**
 * Naval trade income (GDD §5.2) — Track-C tick subsystem lifted to fn(r: RegionSim).
 * Body VERBATIM (this.→r.) ⇒ byte-identical RNG order (guarded by
 * serialize-determinism); dispatched monthly; state + serialize() stay on RegionSim.
 */
import type { RegionSim } from '../region';
import { formatCurrency } from '../defs';

/** Monthly harbor trade income, with a warship-escort premium and occasional log. */
export function navalTradeIncome(r: RegionSim): void {
    const harborTowns = r.settlements.filter(
      (t) => t.factionId === r.playerFactionId && t.buildings.includes('harbor'),
    );
    if (harborTowns.length === 0) return;
    const warships = r.playerWar?.units.find((u) => u.type === 'warship')?.count ?? 0;
    // Base income per harbor (£/month) plus a warship escort premium
    const perHarbor = 12 + warships * 2;
    const income = harborTowns.length * perHarbor;
    r.treasury += income;
    if (r.rng.chance(0.3)) {
      const town = harborTowns[r.rng.int(harborTowns.length)];
      r.addLog(
        `Sea trade earns ${formatCurrency(income)} this month — ${town.name}'s harbor is busy.`,
        'good',
      );
    }
  }
