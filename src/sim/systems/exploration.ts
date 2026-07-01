/**
 * Exploration / fog-of-war (GDD §6.2) — Track-C tick subsystem lifted to
 * fn(r: RegionSim). Body VERBATIM (this.→r.) ⇒ byte-identical RNG order (guarded
 * by serialize-determinism); tick() dispatches; state + serialize() stay on
 * RegionSim. The queries it reads (has / revealTiles / settlement / buildingSight)
 * stay on RegionSim, reached via r.
 */
import type { RegionSim } from '../region';

/** Called once per game-day: settlements, routes and scouts lift the fog. */
export function updateExploration(r: RegionSim): void {
    // The space age ends the fog for good: orbital survey sees everything.
    if (r.has('computing')) {
      for (let x = 0; x < 100; x++) {
        for (let y = 0; y < 100; y++) {
          r.explorationMap[x][y] = 'explored';
        }
      }
      return;
    }
    // Settlements and routes automatically reveal tiles around them
    let sightRadius = 2; // base sight radius
    // Technology improvements to sight: wires, then wings
    if (r.has('electrical_grid')) sightRadius += 1; // telegraph lines along every road
    if (r.has('combustion_engine')) sightRadius += 2; // aerial survey
    for (const settlement of r.settlements) {
      // Phase 2: a telegraph office extends this town's survey reach
      r.revealTiles(settlement.x, settlement.y, sightRadius + r.buildingSight(settlement), 'explored');
    }

    // Routes also reveal tiles (caravans passively explore)
    for (const route of r.routes) {
      const a = r.settlement(route.a);
      const b = r.settlement(route.b);
      if (!a || !b) continue;
      // Reveal a corridor along the route (simplified: just endpoints)
      r.revealTiles(a.x, a.y, 1, 'explored');
      r.revealTiles(b.x, b.y, 1, 'explored');
    }

    // Scout units reveal tiles
    for (const scout of r.scouts) {
      r.revealTiles(scout.x, scout.y, 5, 'explored');
    }
  }
