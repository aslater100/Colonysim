/**
 * Climate & the reckoning (GDD §8.2, §3.2 eras 7–8) + Phase-11 energy transition —
 * the seventh `region.ts` tick subsystem lifted to the Track-C free-function form
 * `fn(r: RegionSim, …)`. See systems/pollution.ts for the rationale: each body runs
 * VERBATIM against the same RegionSim so the RNG-consumption order is byte-identical
 * (tickClimate draws for extreme-weather selection, tickAccords for compliance noise,
 * checkStrandedAssets for the quarterly write-down roll), `tick()` dispatches, and all
 * state + serialize() stay on RegionSim. The byte-identical serialize() diff is guarded
 * by tests/serialize-determinism.
 *
 * Only the per-tick subsystem moves. The player ACTIONS (deployGeoengineering, the
 * sea-wall / flood-proof / managed-retreat builders, enactUniversalBasicSupport,
 * sanctionAccordDefector) and the era/ending MILESTONE logic (decideBranch,
 * buildCenturyReport, determineSpeculativeBranch) stay on RegionSim — tickClimate calls
 * decideBranch/buildCenturyReport/triggerEpilogueEvent through `r`, so those (and the
 * per-event log-throttle fields) were made public for this seam.
 */
import type { RegionSim, RegionalEventKind } from '../region';
import {
  CO2_BASE_PPM,
  WARMING_PER_PPM,
  WARMING_LAG_TICKS,
  GEOENGINEER_DURATION_DAYS,
  GEOENGINEER_COOLING,
  ACCORD_DEFECT_THRESHOLD,
  EARLY_SOLARPUNK_YEAR,
  BRANCH_YEAR,
  CENTURY_YEAR,
} from '../region';
import { formatCurrency } from '../defs';

/** The global carbon ledger, run monthly from the first decade (GDD §8.2): emissions
 *  raise CO₂ and lagged warming, geoengineering cools within its window, and warming
 *  drives the coastal reckoning — tidal flooding, climate-refugee flight inland,
 *  sea-wall overtopping at ≥4 °C, and extreme-weather amplification. Closes by checking
 *  the era-branch fork and the 2100 Century Report. No luck in the ledger itself; the
 *  only RNG is the extreme-weather event selection above +1.5 °C. */
export function tickClimate(r: RegionSim): void {
  const emit = r.playerEmissions() + r.worldEmissions();
  r.emissionsLastMonth = emit;
  r.co2ppm += emit;
  const equilibrium = Math.max(0, (r.co2ppm - CO2_BASE_PPM) * WARMING_PER_PPM);
  r.warmingC += (equilibrium - r.warmingC) / WARMING_LAG_TICKS;
  // Geoengineering: phased aerosol cooling over the active window
  if (r.geoDeployed && r.day - r.geoDeployDay < GEOENGINEER_DURATION_DAYS) {
    const ticksInWindow = GEOENGINEER_DURATION_DAYS / 30; // 30-day climate ticks
    r.warmingC = Math.max(0, r.warmingC - GEOENGINEER_COOLING / ticksInWindow);
  }
  tickAccords(r);
  // The ghost-line announcement: quiet dread as UI (GDD §8.2)
  if (!r.seaRiseAnnounced && r.warmingC >= 1.2 && r.settlements.some((t) => t.site.coastal)) {
    r.seaRiseAnnounced = true;
    r.addLog(
      `+${r.warmingC.toFixed(1)}°C: State surveyors pencil the projected 2100 waterline onto the coastal charts. ` +
      `It runs through streets people live on.`,
      'bad',
    );
  }
  // The sea collects (GDD §8.2): tidal flooding on unwalled coastal towns
  if (r.year >= 2035 && r.warmingC > 1.5) {
    const severity = (r.warmingC - 1.5) * (r.eraBranch === 'drowned' ? 1.5 : 1);
    let hit = false;
    for (const t of r.settlements) {
      if (!t.site.coastal || t.seaWall || r.popOf(t) < 1) continue;
      const damageScale = t.floodProofed ? 0.5 : 1.0;
      t.food *= Math.max(0.7, 1 - 0.05 * severity * damageScale);
      r.removePop(t, r.popOf(t) * 0.0015 * severity * damageScale);
      t.satisfaction = Math.max(0, t.satisfaction - 2 * severity * damageScale);
      hit = true;
    }
    if (hit && r.day - r.lastTidalLogDay > 300) {
      r.lastTidalLogDay = r.day;
      r.addLog(
        'King tides take the low streets again — unwalled coastal towns pump out cellars and count who left.',
        'bad',
      );
    }
  }
  // Climate refugee migration (GDD §8.2): coastal flooding bleeds population
  // inland. Flight rate is mild (0.1% per severity unit/tick) so the effect
  // builds gradually, matching the slow-burn feel of sea-level rise.
  if (r.year >= 2035 && r.warmingC > 1.5) {
    const severity = (r.warmingC - 1.5) * (r.eraBranch === 'drowned' ? 1.5 : 1);
    const playerSettlements = r.settlements.filter((t) => t.factionId === r.playerFactionId);
    const flooded = playerSettlements.filter((t) => t.site.coastal && !t.seaWall && r.popOf(t) > 5);
    const inland = playerSettlements.filter((t) => !t.site.coastal);
    if (flooded.length > 0 && inland.length > 0) {
      const dest = inland.reduce((best, t) => (r.popOf(t) > r.popOf(best) ? t : best));
      let totalMovers = 0;
      for (const from of flooded) {
        const fromPop = r.popOf(from);
        if (fromPop < 5) continue;
        const flightRate = Math.min(0.01, 0.001 * severity);
        const movers = fromPop * flightRate;
        if (movers < 0.1) continue;
        r.removePop(from, movers);
        dest.cohorts.bands[1] += movers * 0.7;
        dest.cohorts.bands[2] += movers * 0.3;
        totalMovers += movers;
      }
      if (totalMovers >= 1 && r.day - r.lastRefugeesLogDay > 365) {
        r.lastRefugeesLogDay = r.day;
        r.addLog(
          `Tidal flooding pushes families inland — ${Math.round(totalMovers)} people arrive at ${dest.name} ` +
          `seeking higher ground (+${r.warmingC.toFixed(1)}°C warming).`,
          'bad',
        );
      }
    }
  }
  // Sea-wall overtopping (GDD §8.2): at ≥4°C even walled towns are breached.
  // Sea walls buy time, not immunity — extreme warming overwashes any earthwork.
  if (r.warmingC >= 4.0 && r.year >= 2060) {
    const overtopSeverity = (r.warmingC - 4.0) * 0.4; // gentler than unprotected
    let overtopHit = false;
    for (const t of r.settlements) {
      if (!t.site.coastal || !t.seaWall || r.popOf(t) < 1) continue;
      const damageScale = t.floodProofed ? 0.3 : 0.6;
      t.food *= Math.max(0.85, 1 - 0.03 * overtopSeverity * damageScale);
      r.removePop(t, r.popOf(t) * 0.0008 * overtopSeverity * damageScale);
      t.satisfaction = Math.max(0, t.satisfaction - 1.5 * overtopSeverity * damageScale);
      overtopHit = true;
    }
    if (overtopHit && r.day - r.lastTidalLogDay > 600) {
      r.lastTidalLogDay = r.day;
      r.addLog(
        `+${r.warmingC.toFixed(1)}°C: The sea walls weren't built for this. Storm surge overtops the ` +
        `barriers; the walled districts flood behind their own defences. Even protection has its ceiling.`,
        'bad',
      );
    }
  }
  // Extreme weather amplification: warming > 1.5°C makes storms and droughts
  // more frequent (GDD §8.2: "extreme-weather frequency ↑ with temperature rise").
  // Monthly probability: ~4% at +2°C, ~8% at +2.5°C.
  if (r.warmingC >= 1.5 && r.stateProclaimed) {
    const extraChance = (r.warmingC - 1.5) * 0.08;
    if (r.rng.next() < extraChance && r.day - r.lastExtremeWeatherDay > 60) {
      const playerTowns = r.settlements.filter((t) => t.factionId === r.playerFactionId);
      const target = playerTowns[r.rng.int(playerTowns.length)];
      if (target && !target.activeEvents.some((e) => e.kind === 'drought' || e.kind === 'flood')) {
        const isDrought = r.rng.next() < 0.55;
        const kind: RegionalEventKind = isDrought ? 'drought' : 'flood';
        target.activeEvents.push({ kind, untilDay: r.day + 50, severity: 0.8 });
        r.lastExtremeWeatherDay = r.day;
        r.addLog(
          isDrought
            ? `Climate volatility: prolonged drought scorches the fields around ${target.name} (+${r.warmingC.toFixed(1)}°C warming effect).`
            : `Climate volatility: storm surge overwhelms drainage at ${target.name} — farmland underwater.`,
          'bad',
        );
      }
    }
  }
  // Era branching: early path (1990) if oil barons beaten, otherwise standard (2040)
  if (r.eraBranch === null && r.year >= EARLY_SOLARPUNK_YEAR && r.beatOilBarons) r.decideBranch();
  if (r.eraBranch === null && r.year >= BRANCH_YEAR) r.decideBranch();
  if (!r.centuryReport && r.year >= CENTURY_YEAR) r.buildCenturyReport();
  r.triggerEpilogueEvent(); // post-2100 flavor events
}

/** Monthly: drift accord compliance and detect free-riders (GDD §8.2).
 *  Commerce-driven signatories stay honest; expansion-minded ones quietly
 *  cheat. First detection triggers one log entry; the player can sanction. */
export function tickAccords(r: RegionSim): void {
  for (const rv of r.rivals) {
    if (!rv.treaties.includes('climate_accord')) {
      if (r.accordCompliance[rv.id] !== undefined) {
        delete r.accordCompliance[rv.id];
        r.accordDefectLogged.delete(rv.id);
      }
      continue;
    }
    let comp = r.accordCompliance[rv.id] ?? 1.0;
    // High-commerce powers keep their word; expansion hawks cut corners
    const drift = (rv.weights.commerce - rv.weights.expansion) * 0.006;
    comp = Math.max(0, Math.min(1, comp + drift + (r.rng.next() - 0.55) * 0.04));
    r.accordCompliance[rv.id] = comp;
    if (comp < ACCORD_DEFECT_THRESHOLD && !r.accordDefectLogged.has(rv.id)) {
      r.accordDefectLogged.add(rv.id);
      r.addLog(
        `ACCORD DEFECTION: satellite readings show ${rv.name}'s emissions climbing behind diplomatic smiles. ` +
        `Sanction them (−20 relations, accord torn) or absorb the betrayal to keep the network intact.`,
        'bad',
      );
    }
    if (comp >= ACCORD_DEFECT_THRESHOLD + 0.1) {
      r.accordDefectLogged.delete(rv.id);
    }
  }
}

/** Phase 11: probabilistic write-downs of fossil infrastructure as renewables
 *  undercut it on cost (fires ~quarterly at peak once solar_wind_parity is in).
 *  Green Industry Act buffers the loss. Returns the loss amount (0 if none). */
export function checkStrandedAssets(r: RegionSim): number {
  if (!r.has('solar_wind_parity')) return 0;
  // Stranding risk scales with how far the energy transition has progressed
  // and how many fossil-era investments the economy carries.
  const fossilDepth =
    (r.has('combustion_engine') ? 1 : 0) +
    (r.has('mass_production') ? 1 : 0) +
    (r.has('electrical_grid') ? 1 : 0);
  if (fossilDepth === 0) return 0;

  // Each clean tech node reduces the stranding risk (assets are already written off or avoided)
  const cleanDepth =
    (r.has('solar_wind_parity') ? 1 : 0) +
    (r.has('battery_storage') ? 1 : 0) +
    (r.has('ev_adoption') ? 1 : 0);

  // Green Industry Act buffers losses — the state absorbs them via the treasury
  const buffered = r.passedLaws.has('green_industry_act');

  // Base write-down: £ per stranded unit of fossil infrastructure
  const baseWrite = r.gdpLastMonth * 0.015 * (fossilDepth / 3) * (1 - cleanDepth / 4);
  if (baseWrite <= 0) return 0;

  // Probabilistic: stranding events happen ~quarterly at peak
  if (!r.rng.chance(0.25)) return 0;

  const loss = buffered ? baseWrite * 0.4 : baseWrite;
  r.treasury = Math.max(0, r.treasury - loss);
  r.strandedAssetLoss += loss;
  const msg = buffered
    ? `GREEN TRANSITION: a tranche of fossil infrastructure is written down — state policy absorbs ${formatCurrency(loss)} of the stranded-asset loss.`
    : `STRANDED ASSETS: coal and oil infrastructure loses ${formatCurrency(loss)} of book value as renewables undercut on cost. The write-down lands on the treasury.`;
  r.addLog(msg, 'bad');
  return loss;
}

/** Monthly drift of automation unemployment (Phase 11). Fires once ai_automation is
 *  researched; UBS halves the drift. High automation shaves services satisfaction and
 *  lifts grievance across all settlements. No RNG. */
export function tickAutomation(r: RegionSim): void {
  if (!r.has('ai_automation')) return;
  // Automation steadily displaces workers; UBS softens the drift
  const rate = r.ubsActive ? 0.001 : 0.002;
  r.automationUnemployment = Math.min(0.3, r.automationUnemployment + rate);

  // High automation reduces services sector wages and satisfaction
  if (r.automationUnemployment > 0.05) {
    const displaceEffect = (r.automationUnemployment - 0.05) * 40;
    for (const t of r.settlements) {
      t.satisfaction = Math.max(0, t.satisfaction - displaceEffect * 0.01);
      t.grievance = Math.min(100, t.grievance + displaceEffect * 0.005);
    }
  }

  // Information sector booms (offsetting for those who can access it)
  // This is a GDP effect, reflected through sector output in updateSectors
}
