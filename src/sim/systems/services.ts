/**
 * City-service coverage effects (Phase 14 / GDD §11) — the second `region.ts`
 * tick subsystem extracted to the roadmap's free-function form `fn(r: RegionSim)`
 * (Track C). See systems/pollution.ts for the rationale: the body runs verbatim
 * against the same RegionSim so RNG-consumption order is untouched, tick()
 * dispatches, state + serialize() stay on RegionSim, and the byte-identical
 * serialize() diff is guarded by tests/serialize-determinism.
 *
 * Zero RNG; its sole RegionSim dependency, `computeServiceCoverage`, is public.
 */
import type { RegionSim } from '../region';

/**
 * Refresh each player settlement's health/education/safety coverage and apply the
 * monthly social consequences of a shortfall: thin healthcare and unsafe streets
 * raise grievance, weak schooling shaves satisfaction. Pure (no RNG, no I/O);
 * mutates only `serviceCoverage`, `grievance`, and `satisfaction` on player towns.
 */
export function tickServiceCoverage(r: RegionSim): void {
  for (const t of r.settlements) {
    if (t.factionId !== r.playerFactionId) continue;
    const sc = r.computeServiceCoverage(t.id);
    t.serviceCoverage = sc;
    // Low health (< 0.3): death pressure, represented as a slow grievance climb.
    if (sc.health < 0.3) {
      t.grievance = Math.min(100, (t.grievance ?? 0) + 0.5);
    }
    // Low education (< 0.2): satisfaction -2 per month.
    if (sc.education < 0.2) {
      t.satisfaction = Math.max(0, t.satisfaction - 2);
    }
    // Low safety (< 0.3): grievance +1 per month.
    if (sc.safety < 0.3) {
      t.grievance = Math.min(100, (t.grievance ?? 0) + 1);
    }
  }
}
