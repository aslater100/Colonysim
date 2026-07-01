/**
 * Faction scouts — movement, spawning, expiry (GDD §6.2) — Track-C tick subsystem
 * lifted to fn(r: RegionSim). Body VERBATIM (this.→r.) ⇒ byte-identical RNG order
 * (the main r.rng.chance draws here run in the same sequence; the per-scout
 * movement helpers draw the separate aiRng stream and stay on RegionSim, reached
 * via r); tick() dispatches; state + serialize() stay on RegionSim.
 */
import type { RegionSim } from '../region';

/** Move, expire and auto-spawn scouts once per game-day. */
export function updateScouts(r: RegionSim): void {
    for (const scout of r.scouts) {
      if (r.day < scout.expireDay) {
        const oldX = scout.x, oldY = scout.y;
        // Player scouts use deterministic movement (no AI RNG consumed).
        if (scout.factionId === r.playerFactionId) {
          r.movePlayerScout(scout);
        } else {
          r.moveScout(scout);
        }
        if (Math.abs(scout.x - oldX) > 0.1 || Math.abs(scout.y - oldY) > 0.1) {
          r.invalidateFactionVisibility(scout.factionId);
        }
      }
    }
    r.scouts = r.scouts.filter((s) => r.day < s.expireDay);
    // Auto-spawn only for rival factions; player hires scouts manually.
    for (const faction of r.regionalFactions) {
      if (faction.id === r.playerFactionId) continue;
      if (r.rng.chance(0.1)) r.spawnScout(faction);
    }
  }
