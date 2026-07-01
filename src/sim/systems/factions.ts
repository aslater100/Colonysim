/**
 * Faction dynamics (GDD §5.3/§6) — Track-C tick subsystems lifted to fn(r: RegionSim).
 * Bodies VERBATIM (this.→r.); dispatched monthly; no RNG. `updateFactions` recomputes
 * the three national estates (workers/landowners/merchants) then drives the regional-
 * trade + alliance helpers (which stay on RegionSim, reached via r); `updateSettlementFactions`
 * drifts each settlement's per-interest-group strength. State + serialize() stay on RegionSim.
 */
import type { RegionSim } from '../region';
import { activeFactions } from '../defs';

/** Recompute the three national estates from pop/food/trade + passed laws, monthly. */
export function updateFactions(r: RegionSim): void {
    const pop = r.totalPop();
    const food = r.settlements.reduce((s, t) => s + t.food, 0);
    const trade = r.tradeValueLastMonth;

    const workerPower = Math.min(70, 30 + pop * 0.05);
    const workerSupport = Math.max(0, Math.min(100,
      50 + (r.servicesLevel - 1) * 20
      - Math.max(0, r.taxRate - 0.15) * 100
      + (r.passedLaws.has('workers_charter') ? 20 : 0)
      - (r.passedLaws.has('conscription_act') ? 5 : 0)
      + (r.passedLaws.has('estate_tax') ? 10 : 0)
      + (r.passedLaws.has('progressive_tax') ? 15 : 0)
      + (r.passedLaws.has('welfare_benefits') ? 10 : 0)
      + (r.passedLaws.has('national_education_act') ? 10 : 0)
      + (r.passedLaws.has('healthcare_act') ? 10 : 0)
      + (r.passedLaws.has('land_reform') ? 20 : 0)
      + (r.passedLaws.has('trade_unions_act') ? 20 : 0),
    ));

    const landownerPower = Math.min(50, 15 + food * 0.005);
    const landownerSupport = Math.max(0, Math.min(100,
      70 - r.taxRate * 160
      - (r.passedLaws.has('estate_tax') ? 25 : 0)
      - (r.passedLaws.has('workers_charter') ? 10 : 0)
      - (r.passedLaws.has('progressive_tax') ? 10 : 0)
      - (r.passedLaws.has('land_reform') ? 30 : 0)
      - (r.passedLaws.has('trade_unions_act') ? 10 : 0)
      + (r.passedLaws.has('tariff_act') ? 10 : 0),
    ));

    const merchantPower = Math.min(40, 10 + trade * 0.12);
    const merchantSupport = Math.max(0, Math.min(100,
      50 + trade * 0.05
      + (r.passedLaws.has('merchants_charter') ? 25 : 0)
      - (r.passedLaws.has('workers_charter') ? 10 : 0)
      - (r.passedLaws.has('progressive_tax') ? 10 : 0)
      + (r.passedLaws.has('press_freedom_act') ? 10 : 0)
      - (r.passedLaws.has('tariff_act') ? 10 : 0),
    ));

    r.factions = [
      {
        id: 'workers', name: 'Workers', power: workerPower, support: workerSupport,
        demand: workerSupport < 40 ? 'better services & lower taxes' : 'content',
      },
      {
        id: 'landowners', name: 'Landowners', power: landownerPower, support: landownerSupport,
        demand: landownerSupport < 40 ? 'tax cuts' : 'content',
      },
      {
        id: 'merchants', name: 'Merchants', power: merchantPower, support: merchantSupport,
        demand: merchantSupport < 40 ? 'open markets' : 'content',
      },
    ];

    // Update regional faction economies: calculate production based on resource focus
    r.updateRegionalTrade();

    // Update faction alliances: compatible goals form pacts, incompatible ones break
    r.updateFactionAlliances();
  }

/** Drift each settlement's per-interest-group faction strengths, monthly. */
export function updateSettlementFactions(r: RegionSim): void {
    for (const settlement of r.settlements) {
      // Get active factions for this year
      const activeFacs = activeFactions(r.year);

      for (const factionDef of activeFacs) {
        const currentStrength = settlement.factionStrengths.get(factionDef.id) ?? 50;
        let newStrength = currentStrength;

        // Faction gains 20 strength when player passes a law they promote
        for (const law of factionDef.promotes) {
          if (r.passedLaws.has(law)) {
            newStrength += 2;
          }
        }

        // Faction loses 15 strength when player passes a law they oppose
        for (const law of factionDef.opposes) {
          if (r.passedLaws.has(law)) {
            newStrength -= 2;
          }
        }

        // Tech research boosts faction strength (if they have modifiers for that tech)
        // Example: environmentalists boost when solar/wind researched
        if (factionDef.id === 'environmentalists' && (r.has('solar_cells') || r.has('wind_power'))) {
          newStrength += 1;
        }
        if (factionDef.id === 'oil_barons' && (r.has('coal_mining') || r.has('oil_refining'))) {
          newStrength += 1;
        }
        if (factionDef.id === 'scientists' && (r.has('computing') || r.has('automation'))) {
          newStrength += 1;
        }

        // Economic conditions affect factions
        // Industrialists grow stronger during high GDP growth
        if (factionDef.id === 'industrialists' && r.gdpLastMonth > 50000) {
          newStrength += 0.5;
        }
        // Pacifists gain strength during peace
        if (factionDef.id === 'pacifists' && !r.playerWar) {
          newStrength += 0.5;
        }
        // Militarists gain during war
        if (factionDef.id === 'militarists' && r.playerWar) {
          newStrength += 0.5;
        }

        // Natural decay if faction goals are being ignored (very slow)
        newStrength *= 0.99;

        // Clamp to 0-100
        newStrength = Math.max(0, Math.min(100, newStrength));

        settlement.factionStrengths.set(factionDef.id, newStrength);
      }
    }
  }
