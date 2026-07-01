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
        if ((r.autoDevelopPlayer || r.autoExpandPlayer) && r.day - faction.lastUpdateDay >= faction.updateFrequency) {
          const knobs = r.aiKnobs();
          // Auto-EXPAND first (found a new town) so a fresh town is available to
          // develop this same update; then develop an existing town. Both are
          // flag-gated and purse-seamed to the national treasury; both are OFF for
          // live human play, so no player aiRng draw fires there (byte-identical).
          if (r.autoExpandPlayer && r.playerMayExpand(faction)) r.maybeExpandFaction(faction, knobs, r.factionPopulation(faction));
          if (r.autoDevelopPlayer) r.maybeDevelopFactionTown(faction, knobs, r.factionTownOutput(faction));
          // Statehood/governance director: the human drives incorporation, research and
          // law-making by hand, so in the sweep the player faction had none — it grew to
          // a multi-town COLONY that never proclaimed statehood, researched nothing, and
          // never chartered a central bank (leaving the whole statehood / tech-gated /
          // monetary layer dormant). advanceAutoplayStatehood walks it up the natural,
          // code-enforced gates so the sweep exercises a real state. Separately
          // flag-gated (default OFF, incl. the default sweep) so the treas/GDP signal
          // stays clean until an autoplay state-budget sink lands; OFF for live human
          // play ⇒ byte-identical there.
          if (r.autoplayStatehood) advanceAutoplayStatehood(r);
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

/** The statehood/economic spine the central-bank charter (and the elections that pay
 *  for it) depend on. Researched first, in order; everything else is picked cheapest.
 *  income_tax + statecraft are requiresState nodes, so they only open up once the
 *  charter is signed — which is exactly step 1 below. */
const AUTOPLAY_RESEARCH_SPINE = [
  'common_law', 'free_press', 'labor_law', 'income_tax', 'universal_suffrage', 'statecraft',
];

/** Autoplay-only statehood progression (flag-gated behind the autoplay seam above, so
 *  OFF for live human play → no effect / byte-identical there). Every step goes through
 *  the same public methods the UI calls (completeIncorporation / startResearch /
 *  enactLaw) and respects their gates, so the autoplayer can only do what a human could:
 *
 *    1. STATE  — sign the Regional Charter the moment updateCharter offers the ceremony
 *                (charterEligible is already met deep in the sweep: 3+ towns, pop, routes,
 *                treasury, garrison). Without this the player stays a colony forever.
 *    2. TECH   — the autoplayer had no research director (activeResearch stayed null, so
 *                tickResearch was inert and NOTHING was ever researched). Climb the tree,
 *                steering toward the spine that elections + the central bank need.
 *    3. BANK   — once a state has statecraft + income_tax and elections (gated on
 *                universal_suffrage, NOT on nationhood — see checkElection) have banked
 *                ≥50 political capital, enact the Central Bank Charter. hasCentralBank()
 *                flips true, so tickMonetary() runs and the session-9/10 cost-push
 *                inflation finally bites in the sweep instead of lying dormant.
 *
 *  NOTE: the charter law is tagged requiresNation in its def, but enactLaw only enforces
 *  requiresState (+ prereqs + cost); a state autoplayer chartering a bank matches what
 *  the code actually permits. A future pass may make autoplay proclaim a nation properly
 *  (blocked today by the 50%-territory convention gate the autoplayer never reaches). */
export function advanceAutoplayStatehood(r: RegionSim): void {
  // 1. STATEHOOD.
  if (r.ceremonyPending && !r.stateProclaimed) {
    r.completeIncorporation('The Frontier State', 'council');
  }
  // 2. RESEARCH — availableToResearch() already enforces prereqs/era/requiresState, so
  //    this only ever starts legal research. Prefer the spine; else cheapest (stable id
  //    tie-break keeps the pick deterministic).
  if (!r.activeResearch) {
    const avail = r.availableToResearch();
    if (avail.length > 0) {
      const spinePick = AUTOPLAY_RESEARCH_SPINE.map((id) => avail.find((n) => n.id === id)).find(Boolean);
      const pick = spinePick ?? avail.slice().sort((a, b) => a.cost - b.cost || (a.id < b.id ? -1 : 1))[0];
      r.startResearch(pick.id);
    }
  }
  // 3. CENTRAL BANK — the switch that lights up cost-push inflation in the sweep.
  if (
    r.stateProclaimed &&
    !r.passedLaws.has('central_bank_charter') &&
    r.has('statecraft') &&
    r.has('income_tax') &&
    r.politicalCapital >= 50
  ) {
    r.enactLaw('central_bank_charter');
  }
}
