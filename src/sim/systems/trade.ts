/**
 * Trade-route cargo (GDD §5.3, Phase 6) — Track-C tick subsystem lifted to
 * fn(r: RegionSim). Body VERBATIM (this.→r.); tick() dispatches; state +
 * serialize() stay on RegionSim. Tags each route with the sector good whose
 * cross-town output gap is widest (a governor's manual pin wins).
 */
import type { RegionSim } from '../region';
import { SECTOR_IDS, type SectorId } from '../region';

  /** Monthly: tag each route with its dominant cargo based on the output gap
   *  between connected settlements. The greater the surplus difference in a
   *  sector, the more that sector's goods fill the wagons. */
export function updateRouteCargo(r: RegionSim): void {
    for (const route of r.routes) {
      const a = r.settlement(route.a);
      const b = r.settlement(route.b);
      if (!a || !b) { route.cargoType = null; continue; }
      // A governor's manual pin (Phase A route-network controls) wins over the
      // auto reading — the wagons carry what the state directs.
      if (route.cargoPriority) { route.cargoType = route.cargoPriority; continue; }
      let maxDiff = 0;
      let dominant: SectorId | null = null;
      for (const id of SECTOR_IDS) {
        const diff = Math.abs(a.sectors[id].output - b.sectors[id].output);
        if (diff > maxDiff) { maxDiff = diff; dominant = id; }
      }
      route.cargoType = maxDiff > 0.5 ? dominant : null;
    }
  }
