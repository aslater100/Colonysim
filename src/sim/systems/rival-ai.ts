/**
 * Rival AI cadence (GDD §6.2) — Track-C tick subsystem lifted to fn(r: RegionSim).
 * Body VERBATIM (this.→r.); dispatched monthly from tick(). The AI helpers it
 * drives (rivalDiplomaticRound / updateFactionAI / maybeDevelopFactionTown /
 * factionTownOutput / aiKnobs) stay on RegionSim and keep their aiRng draw order,
 * reached via r; state + serialize() stay on RegionSim.
 */
import type { RegionSim } from '../region';

/** Staggered per-rival diplomacy + per-faction spatial AI, once per month. */
export function updateRivalAI(r: RegionSim): void {
    // Nation-level rivals: staggered diplomatic cadence (peace, war, treaties).
    // GDD §6.2: Personality-driven AI generates offers based on weights, relations, and situation.
    for (const rival of r.rivals) {
      if (r.day - rival.lastEnvoyDay >= 365) {
        r.rivalDiplomaticRound(rival);
        rival.lastEnvoyDay = r.day;
      }
    }

    // Regional factions: staggered AI so not every faction acts each month.
    // Runs from tick 1 — rivals expand and scout regardless of player statehood.
    for (const faction of r.regionalFactions) {
      if (faction.id === r.playerFactionId) {
        // The player faction never runs the full rival AI (no procedural goals,
        // expansion, military or diplomacy — those are the human's to drive). But
        // in autoplay (flag-gated; OFF for live human play) it DOES exercise its
        // own spatial path: develop the player's town(s) on the same cadence,
        // funded from the national treasury and reserve-gated like a rival. This
        // is what makes the headless balance signal reflect a player who actually
        // builds, instead of one bare town carrying the whole economy on raw yields.
        if (r.autoDevelopPlayer && r.day - faction.lastUpdateDay >= faction.updateFrequency) {
          r.maybeDevelopFactionTown(faction, r.aiKnobs(), r.factionTownOutput(faction));
          faction.lastUpdateDay = r.day;
        }
        continue;
      }
      if (r.day - faction.lastUpdateDay >= faction.updateFrequency) {
        r.updateFactionAI(faction);
        faction.lastUpdateDay = r.day;
      }
    }
  }
