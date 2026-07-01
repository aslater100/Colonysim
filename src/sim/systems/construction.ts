/**
 * Construction completion (Phase 2, GDD §5.1) — Track-C tick subsystem lifted to
 * fn(r: RegionSim). Body VERBATIM (this.→r.); dispatched daily; state +
 * serialize() stay on RegionSim. The siting/logging helpers (canPlaceBuildingAt /
 * autoPlaceCell / townEvent) stay on RegionSim, reached via r.
 */
import type { RegionSim } from '../region';
import { REGION_BUILDINGS_MAP } from '../region';

/** Finish any building whose scaffolding-time has elapsed; site it and claim Wonders. */
export function updateConstruction(r: RegionSim): void {
    for (const t of r.settlements) {
      if (t.construction && r.day >= t.construction.doneDay) {
        const def = REGION_BUILDINGS_MAP.get(t.construction!.id);
        t.buildings.push(t.construction.id);
        // Record where it sits (chosen cell, or auto-sited in the worked ring).
        const cell = t.construction.cell !== undefined && r.canPlaceBuildingAt(t.id, t.construction.cell)
          ? t.construction.cell
          : r.autoPlaceCell(t);
        if (cell >= 0) t.placedBuildings.push({ id: t.construction.id, cell });
        t.construction = null;
        if (def) {
          // Phase D: a completed Wonder is claimed by its faction empire-wide
          // (keyed on completion, so ownership holds even if the cell relocated).
          if (def.unique) {
            r.wonderOwner[def.id] = t.factionId;
            if (t.factionId === r.playerFactionId) r.prestige += def.prestige ?? 0;
          }
          r.addLog(`The ${def.name} opens at ${t.name}.`, 'good');
          r.townEvent(t, `The ${def.name} opens its doors.`, 'good');
        }
      }
    }
  }
