/**
 * Colony expeditions → new town founding (GDD §2.1) — Track-C tick subsystem
 * lifted to fn(r: RegionSim). Body VERBATIM (this.→r.); dispatched daily; no RNG.
 * The founding helpers (ordinal / blazeTrail / networkAnchor / mintNotable) stay
 * on RegionSim, reached via r; state + serialize() stay on RegionSim.
 */
import type { RegionSim } from '../region';
import { defaultPrices, defaultSectors, DEFAULT_CITY_POLICIES, type Settlement } from '../region';
import { FactionId as NewFactionId, activeFactions } from '../defs';

/** Advance in-flight expeditions; on arrival, found the new town and wire it in. */
export function updateExpeditions(r: RegionSim): void {
    for (const e of [...r.expeditions]) {
      const totalDays = Math.max(1, e.arrivesDay - e.departDay);
      const f = Math.min(1, (r.day - e.departDay) / totalDays);
      e.x = e.x + (e.targetX - e.x) * Math.min(1, f * 0.5 + 0.1);
      e.y = e.y + (e.targetY - e.y) * Math.min(1, f * 0.5 + 0.1);
      if (r.day >= e.arrivesDay) {
        const town: Settlement = {
          id: r.nextId++,
          name: e.name,
          x: e.targetX,
          y: e.targetY,
          foundedDay: r.day,
          cohorts: { bands: [e.pop * 0.1, e.pop * 0.55, e.pop * 0.35, 0, 0] },
          food: e.food,
          wood: e.wood,
          satisfaction: 60,
          housing: e.pop + 4,
          landQuality: e.site.fertility,
          site: e.site,
          lastRaidDay: -99,
          lastFloodDay: -99,
          strikeUntil: -1,
          grievance: 0,
          prices: defaultPrices(),
          recentEvents: [],
          // Phase 0: Regional faction system
          factionId: r.playerFactionId,
          garrisonStrength: 2, // new towns have smaller garrisons
          stationedUnits: [],
          loyaltyToFaction: 100,
          factionStrengths: new Map(activeFactions(r.year).map(f => [f.id, 50] as [NewFactionId, number])),
          sectors: defaultSectors(),
          buildings: [],
          placedBuildings: [],
          placedDistricts: [],
          construction: null,
          focus: 'balanced',
          activeEvents: [],
          policies: { ...DEFAULT_CITY_POLICIES },
        };
        r.settlements.push(town);
        // Reveal the new settlement and surrounding area
        r.revealTiles(town.x, town.y, 2, 'explored');
        // Update player faction settlement list
        const playerFaction = r.faction(r.playerFactionId);
        if (playerFaction) {
          playerFaction.settlementIds.push(town.id);
        }
        r.expeditions = r.expeditions.filter((o) => o !== e);
        const flavor = e.site.river ? 'on the riverbank' : e.site.coastal ? 'by the sea' : e.site.fertility > 1 ? 'in good black soil' : 'on thin ground';
        r.addLog(`${town.name} is founded ${flavor} — the ${r.ordinal(r.settlements.length)} town of the colony.`, 'good');
        // graft the new town onto the central network: blaze its trail to the
        // nearest town already on the faction backbone, not whoever sent the expedition
        r.blazeTrail(r.networkAnchor(town), town.id);
        // A founder steps up
        r.mintNotable('Reeve', town.id);
      }
    }
  }
