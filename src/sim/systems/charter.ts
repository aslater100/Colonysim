/**
 * Regional Charter (the incorporation civics gate) — Track-C tick subsystem lifted
 * to fn(r: RegionSim). Body VERBATIM (this.→r.); tick() dispatches; state +
 * serialize() stay on RegionSim. The eligibility query charterEligible() stays on
 * RegionSim, reached via r.
 */
import type { RegionSim } from '../region';

export function updateCharter(r: RegionSim): void {
    if (r.stateProclaimed || r.ceremonyPending) return;
    if (r.charterEligible()) {
      // The Mayor drafts the Regional Charter — the slice's civics gate.
      r.charterProgress = Math.min(100, r.charterProgress + 100 / 90); // ~90 days of drafting
      if (r.charterProgress >= 100) {
        r.ceremonyPending = true;
        r.addLog('The Regional Charter is drafted. The towns await your word. (Incorporation ceremony)', 'good');
      }
    } else {
      r.charterProgress = Math.max(0, r.charterProgress - 0.5);
    }
  }
