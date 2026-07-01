/**
 * Statecraft — administration of held territory (GDD §5.5) — Track-C tick
 * subsystems lifted to fn(r: RegionSim). Bodies VERBATIM (this.→r.); dispatched
 * monthly; state + serialize() stay on RegionSim. Deterministic (no RNG).
 */
import type { RegionSim } from '../region';
import { formatCurrency } from '../defs';

/** Collect 5%/month tribute from every vassal into the national treasury. */
export function collectVassalTribute(r: RegionSim): void {
    const playerFaction = r.faction(r.playerFactionId);
    if (!playerFaction) return;
    for (const vassalId of playerFaction.vassals) {
      const vassal = r.faction(vassalId);
      if (!vassal) continue;
      const tribute = Math.floor(vassal.treasury * 0.05);
      if (tribute <= 0) continue;
      vassal.treasury -= tribute;
      r.treasury += tribute;
      if (tribute >= 10) {
        r.addLog(`TRIBUTE: ${vassal.name} pays ${formatCurrency(tribute)} to your treasury.`, 'good');
      }
    }
  }

/** Apply per-province autonomy/investment policy effects to player settlements. */
export function applyProvincePolicyEffects(r: RegionSim): void {
    if (!r.stateProclaimed) return;
    for (const s of r.settlements) {
      if (s.factionId !== r.playerFactionId) continue;
      const pol = r.provincePolicies[s.id];
      if (!pol) continue;
      if (pol.autonomyLevel >= 2) {
        s.satisfaction = Math.min(100, s.satisfaction + 0.3);
        s.grievance = Math.max(0, s.grievance - 0.5);
      } else if (pol.autonomyLevel === 0 && s.satisfaction > 40) {
        s.satisfaction = Math.max(0, s.satisfaction - 0.1);
      }
      if (pol.investmentLevel >= 2 && r.treasury > 5) {
        r.treasury -= 2;
        s.garrisonStrength = Math.min(r.garrisonCap(s), s.garrisonStrength + 0.5);
      }
    }
  }
