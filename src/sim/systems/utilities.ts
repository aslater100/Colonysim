/**
 * City utilities — power / water / waste (Phase 14, GDD §5.1) — Track-C tick
 * subsystem lifted to fn(r: RegionSim). Body VERBATIM (this.→r.) ⇒ byte-identical
 * RNG order (guarded by serialize-determinism); tick() dispatches monthly; state +
 * serialize() stay on RegionSim. computePowerBalance / townEvent stay on RegionSim,
 * reached via r.
 */
import type { RegionSim } from '../region';

/** Update power/water/waste coverage for every player settlement, monthly. */
export function tickUtilities(r: RegionSim): void {
    for (const t of r.settlements) {
      if (t.factionId !== r.playerFactionId) continue;
      const pop = r.popOf(t);
      // Power balance
      const pb = r.computePowerBalance(t.id);
      t.powerCapacity = pb.capacity;
      t.powerDemand = pb.demand;
      if (pb.demand > pb.capacity) {
        // Brownout: log once per year
        const lastBrownout = t.lastBrownoutYear ?? -999;
        if (r.year > lastBrownout) {
          t.lastBrownoutYear = r.year;
          r.townEvent(t, `Power demand exceeds supply — brownouts rolling across ${t.name}.`, 'bad');
        }
        t.satisfaction = Math.max(0, t.satisfaction - 5);
        // Industry output penalty applied via sector output mult (tracked via active event instead)
        // We model it as a monthly satisfaction drag and log the event
      }
      // Water coverage
      if (t.buildings.includes('waterworks')) {
        t.waterCoverage = 1.0;
      } else {
        t.waterCoverage = Math.min(0.5, pop / 200);
      }
      // Waste coverage
      if (t.buildings.includes('sanitation') || t.buildings.includes('market_hall')) {
        t.wasteCoverage = 1.0;
      } else {
        t.wasteCoverage = Math.min(0.3, pop / 500);
      }
      // Disease event: waterCoverage < 0.5 and pop > 100: 5% chance/month
      if ((t.waterCoverage ?? 0) < 0.5 && pop > 100 && r.rng.chance(0.05)) {
        r.townEvent(t, `Poor water supply in ${t.name} — disease spreads among the population.`, 'bad');
        t.satisfaction = Math.max(0, t.satisfaction - 3);
      }
    }
  }
