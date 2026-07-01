/**
 * Regional events — settlement-level disasters & windfalls (Phase 4) — Track-C
 * tick subsystem lifted to fn(r: RegionSim). Body VERBATIM (this.→r.) ⇒
 * byte-identical RNG order (guarded by serialize-determinism); fired/expired
 * monthly per settlement; state + serialize() stay on RegionSim. townEvent stays
 * on RegionSim, reached via r.
 */
import type { RegionSim } from '../region';
import { REGION_EVENT_DEFS } from '../region';

/** Fire and expire settlement-level events monthly. */
export function tickRegionalEvents(r: RegionSim): void {
    for (const t of r.settlements) {
      // Expire events whose duration has run
      t.activeEvents = t.activeEvents.filter((ev) => ev.untilDay > r.day);
      // Roll each event definition per settlement
      // Phase 17: scale event probability by crisisFrequency difficulty knob
      const crisisScale = r.difficultySettings.crisisFrequency;
      for (const def of REGION_EVENT_DEFS) {
        if (def.minYear !== undefined && r.year < def.minYear) continue; // era-gated
        if (!r.rng.chance(def.probability * crisisScale)) continue;
        if (t.activeEvents.some((ev) => ev.kind === def.kind)) continue; // no stacking
        t.activeEvents.push({ kind: def.kind, untilDay: r.day + def.durationDays, severity: 1 });
        // events-depth: one-shot satisfaction/grievance swings (bounded, clamped)
        if (def.satisfaction) t.satisfaction = Math.max(0, Math.min(100, t.satisfaction + def.satisfaction));
        if (def.grievance) t.grievance = Math.max(0, Math.min(100, t.grievance + def.grievance));
        const good = def.outputMult >= 1.0;
        r.townEvent(t, `${def.name}: ${def.desc}`, good ? 'good' : 'bad');
        r.addLog(`${def.name} strikes ${t.name} — ${def.desc}`, good ? 'good' : 'bad');
      }
    }
  }
