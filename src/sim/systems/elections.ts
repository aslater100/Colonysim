/**
 * Elections (GDD §5.3) — Track-C tick subsystem lifted to fn(r: RegionSim).
 * Bodies VERBATIM (this.→r.); checkElection is dispatched from tick() and drives
 * runElection as a module sibling. Deterministic (no RNG); state + serialize()
 * stay on RegionSim.
 */
import type { RegionSim } from '../region';
import { GOV_TYPES } from '../region';

/** Schedule and (when due) run the next election, if the regime holds them. */
export function checkElection(r: RegionSim): void {
    if (!r.stateProclaimed || !r.has('universal_suffrage')) return;
    // Non-democratic governments don't hold elections after proclamation
    if (r.nationProclaimed && r.govType !== null) {
      const def = GOV_TYPES.find((g) => g.id === r.govType)!;
      if (!def.electionsRequired) return;
    }
    if (r.nextElectionDay < 0) {
      r.nextElectionDay = r.day + 240; // ~4 game-years
    }
    if (r.day >= r.nextElectionDay) runElection(r);
  }

/** Run an election: award political capital proportional to approval. */
export function runElection(r: RegionSim): void {
    const n = r.settlements.length;
    const avgSat = n > 0
      ? r.settlements.reduce((s, t) => s + t.satisfaction, 0) / n
      : 50;
    const earned = Math.round(20 + (avgSat / 100) * 80);
    r.politicalCapital = Math.min(200, r.politicalCapital + earned);
    r.lastElectionYear = r.year;
    r.nextElectionDay = r.day + 240;
    const result = avgSat >= 65 ? 'LANDSLIDE' : avgSat >= 50 ? 'MAJORITY' : avgSat >= 35 ? 'MINORITY' : 'LOST';
    r.addLog(
      `ELECTION ${r.year}: ${result} (approval ${Math.round(avgSat)}%) — ${earned} political capital earned.` +
      (result === 'LOST' ? ' The government limps on.' : ''),
      avgSat >= 50 ? 'good' : 'bad',
    );
    // Democracy/Republic: legitimacy refreshed by elections (GDD §5.3)
    if (r.nationProclaimed && (r.govType === 'democracy' || r.govType === 'republic')) {
      const legBonus = result === 'LANDSLIDE' ? 20 : result === 'MAJORITY' ? 12 : result === 'MINORITY' ? 4 : -12;
      r.legitimacy = Math.max(0, Math.min(100, r.legitimacy + legBonus));
    }
  }
