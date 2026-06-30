/**
 * Foreign affairs (GDD §5.4, §6.2–6.4) — the eighth `region.ts` tick subsystem
 * lifted to the Track-C free-function form `fn(r: RegionSim, …)`. See
 * systems/pollution.ts for the rationale: each body runs VERBATIM against the same
 * RegionSim so the RNG-consumption order is byte-identical, `tick()` dispatches
 * (via `updateDiplomacy`, the entry point), and all state + serialize() stay on
 * RegionSim. The byte-identical serialize() diff is guarded by
 * tests/serialize-determinism.
 *
 * `updateDiplomacy` is the orchestrator: it drives the relations drift / AI offers /
 * mischief loop, then calls the other diplomacy ticks as module siblings — and
 * `r.tickPlayerWar()`, which stays on RegionSim with the rest of the warfare system
 * (a future systems/military.ts). The player ACTIONS and queries in this region
 * (proposeDeal, sendEnvoy, imposeSanction, startForeignWar, the sanction queries, …)
 * and the helpers `noteHistory`/`changeRegime`/`clampRel`/`playerBloc`/`startPlayerWar`
 * stay on RegionSim — the moved bodies reach them through `r`, so those (and the
 * `nextRivalBlocId` counter) were made public for this seam.
 */
import type { RegionSim } from '../region';
import type { ForeignWar, RivalNation } from '../region';
import {
  blocAffinity,
  RIVAL_EMERGENCE_YEAR,
  MAX_RIVALS,
  ARCHETYPE_GREEN_PROPENSITY,
  ARCHETYPE_WAR_FREQ_MULT,
} from '../region';
import { formatCurrency } from '../defs';

  /** Monthly diplomacy tick: emergence, relations drift, AI offers,
   *  hostile mischief, regime change abroad, and foreign wars. */
export function updateDiplomacy(r: RegionSim): void {
    // Emergence: the world proclaims its nations on its own clock (GDD §6.2),
    // banded so the first foreign power reliably exists by mid-century.
    if (r.year >= RIVAL_EMERGENCE_YEAR && r.rivals.length < MAX_RIVALS) {
      const overdue = r.rivals.length === 0 && r.year >= 1940;
      if (r.rng.chance(overdue ? 0.25 : 0.03)) r.spawnRival();
    }
    r.offers = r.offers.filter((o) => o.expiresDay > r.day && r.rival(o.rivalId));
    r.counters = r.counters.filter((c) => c.expiresDay > r.day && r.rival(c.rivalId));
    const myBloc = r.playerBloc();
    for (const rv of r.rivals) {
      rv.pop *= 1.0015; // they grow whether you watch or not
      if (r.playerWar?.rivalId === rv.id) {
        rv.relations = r.clampRel(Math.min(rv.relations, -60)); // war pins the ledger
        continue; // mischief, offers, and drift all yield to the front
      }
      // Relations drift toward a baseline set by personality, regime
      // distance (GDD §5.4), and whatever ink is already on the page.
      let base = rv.weights.commerce * 1.2 - rv.weights.expansion * 1.5 - rv.weights.grudge * 0.8;
      if (myBloc) base += blocAffinity(myBloc, r.regimeOf(rv).bloc);
      if (rv.treaties.includes('non_aggression')) base += 8;
      if (rv.treaties.includes('trade_agreement')) base += 12;
      if (rv.treaties.includes('defensive_pact')) base += 16;
      if (rv.borderSettled) base += 6; // a fixed frontier is a quiet one
      rv.relations = r.clampRel(rv.relations + (base - rv.relations) * 0.04);
      // AI-initiated offers (GDD §6.3): commerce courts you; caution wants fences
      if (r.stateProclaimed && !r.offers.some((o) => o.rivalId === rv.id)) {
        if (!rv.treaties.includes('trade_agreement') && rv.weights.commerce >= 5 && rv.relations > 30 && r.rng.chance(0.12)) {
          r.offers.push({ rivalId: rv.id, kind: 'trade_agreement', expiresDay: r.day + 90 });
          r.addLog(`Envoys from ${rv.name} arrive with ledgers and samples: they offer a Trade Agreement.`, 'info');
        } else if (!rv.treaties.includes('non_aggression') && rv.relations < -10 && rv.relations > -50 && rv.weights.risk <= 5 && r.rng.chance(0.08)) {
          r.offers.push({ rivalId: rv.id, kind: 'non_aggression', expiresDay: r.day + 90 });
          r.addLog(`${rv.name} proposes a Non-Aggression Pact — cold neighbors, fenced borders.`, 'info');
        } else if (
          !rv.treaties.includes('climate_accord') &&
          r.accordUnlocked() &&
          r.warmingC > 1.8 &&
          r.year >= 2020 &&
          (ARCHETYPE_GREEN_PROPENSITY[rv.archetype] ?? 0.5) >= 0.6 &&
          r.rng.chance(0.06)
        ) {
          // High-propensity rival (trading republic or crusader) invites player to the Climate Accord
          r.offers.push({ rivalId: rv.id, kind: 'climate_accord', expiresDay: r.day + 180 });
          r.addLog(
            `${rv.name} extends a formal invitation to the Climate Accord — ` +
            `warming is past +${r.warmingC.toFixed(1)}°C and they call for collective action.`,
            'info',
          );
        }
      }
      // Hostile mischief (GDD §6.4): town-scale friction, deniable and cheap.
      // Difficulty-scaled (aggroChance) so harder tiers see nastier neighbours.
      if (rv.relations < -40 && !rv.treaties.includes('non_aggression') && r.rng.chance(r.aggroChance(0.1 + rv.weights.risk * 0.015))) {
        if (!rv.borderSettled && (r.rng.chance(0.5) || r.tradeValueLastMonth <= 0)) {
          const t = r.settlements[r.rng.int(r.settlements.length)];
          if (t) {
            t.grievance = Math.min(100, t.grievance + 6);
            rv.relations = r.clampRel(rv.relations - 3);
            r.addLog(`Border friction: ${rv.name}'s surveyors plant markers in ${t.name}'s outfields. Tempers fray.`, 'bad');
          }
        } else {
          const toll = Math.min(r.treasury, 5 + r.rng.int(10));
          r.treasury -= toll;
          r.addLog(`${rv.name}'s customs men shake down caravans at the frontier — ` + formatCurrency(toll) + ` in seized goods and bribes.`, 'bad');
        }
      }
      // Beyond mischief (GDD §7.1): an emboldened hostile power declares war outright
      if (
        !r.playerWar && r.nationProclaimed && rv.relations < -60 &&
        !rv.treaties.includes('non_aggression') &&
        r.rng.chance((0.01 + rv.weights.risk * 0.003 + rv.weights.expansion * 0.002) * ARCHETYPE_WAR_FREQ_MULT[rv.archetype])
      ) {
        // a settled frontier leaves them no honest grievance — they stage one
        r.startPlayerWar(rv, rv.borderSettled ? 'fabricated' : 'border_dispute', true);
        continue;
      }
      // Regime change abroad is world news the player reads about (GDD §6.3)
      if (r.rng.chance(0.01)) r.changeRegime(rv, 'drift');
    }
    tickForeignRelations(r);
    r.tickPlayerWar();
    tickRivalEspionage(r);       // Phase 6: rivals spy on the player
    tickRivalTradeBlocActivity(r); // Phase 6: rivals form their own blocs
    tickRivalProvinceGovernance(r); // Phase 5: rivals invest in provinces
    tickSanctions(r);            // Phase 6: expire elapsed sanctions
  }
  /** The world's own politics (GDD §6.4): rival pairs drift, ally, feud,
   *  and fight — the player reads the dispatches and sells into the booms. */
export function tickForeignRelations(r: RegionSim): void {
    for (let i = 0; i < r.rivals.length; i++) {
      for (let j = i + 1; j < r.rivals.length; j++) {
        const a = r.rivals[i];
        const b = r.rivals[j];
        const key = r.pairKey(a.id, b.id);
        const allied = r.alliances.includes(key);
        const atWar = r.warBetween(a.id, b.id) !== undefined;
        // Drift toward a baseline from both personalities and bloc distance
        let base =
          (a.weights.commerce + b.weights.commerce) * 1.2 -
          (a.weights.expansion + b.weights.expansion) * 1.5 +
          blocAffinity(r.regimeOf(a).bloc, r.regimeOf(b).bloc);
        if (allied) base += 25;
        let rel = (r.rivalPairs[key] ?? 0) + (base - (r.rivalPairs[key] ?? 0)) * 0.03;
        if (atWar) rel = Math.min(rel, -50);
        r.rivalPairs[key] = r.clampRel(rel);
        if (atWar) continue;
        if (!allied && rel > 45 && a.weights.honor + b.weights.honor >= 10 && r.rng.chance(0.05)) {
          r.alliances.push(key);
          r.noteHistory(a, `Allied with ${b.name}, ${r.year}.`);
          r.noteHistory(b, `Allied with ${a.name}, ${r.year}.`);
          r.addLog(`PACT ABROAD: ${a.name} and ${b.name} sign an alliance — the world is choosing sides.`, 'info');
        } else if (!allied && rel > 25 && a.weights.commerce + b.weights.commerce >= 10 && r.rng.chance(0.04)) {
          r.rivalPairs[key] = r.clampRel(rel + 5);
          r.addLog(`${a.name} and ${b.name} open a customs union — freight moves freely between them.`, 'info');
        } else if (rel < -20 && r.rng.chance(0.06)) {
          r.rivalPairs[key] = r.clampRel(rel - 4);
          r.addLog(`${a.name} and ${b.name} trade ultimatums over a border survey. The chanceries buzz.`, 'info');
        }
        if (!allied && rel < -50 && r.rng.chance(0.03 + (a.weights.risk + b.weights.risk) * 0.003)) {
          r.startForeignWar(a.id, b.id);
        }
      }
    }
    // Run the active wars: refugees flow now, the reckoning comes at the peace
    for (const w of [...r.foreignWars]) {
      const a = r.rival(w.a);
      const b = r.rival(w.b);
      if (!a || !b) {
        r.foreignWars = r.foreignWars.filter((x) => x !== w);
        continue;
      }
      if (r.rng.chance(0.2) && r.settlements.length > 0) {
        const t = r.settlements[r.rng.int(r.settlements.length)];
        const wave = 2 + r.rng.int(6);
        t.cohorts.bands[1] += wave * 0.6;
        t.cohorts.bands[0] += wave * 0.25;
        t.cohorts.bands[2] += wave * 0.15;
        r.addLog(`Refugees from the ${a.name}–${b.name} war reach ${t.name} — ${wave} souls with what they could carry.`, 'info');
      }
      if (r.day >= w.endsDay) endForeignWar(r, w, a, b);
    }
  }
  /** The peace: the loser bleeds population, nurses a grudge for decades,
   *  and may lose its government to the defeat (GDD §6.3 regime change). */
export function endForeignWar(r: RegionSim, w: ForeignWar, a: RivalNation, b: RivalNation): void {
    r.foreignWars = r.foreignWars.filter((x) => x !== w);
    const aWins = r.rng.next() < a.pop / (a.pop + b.pop);
    const winner = aWins ? a : b;
    const loser = aWins ? b : a;
    loser.pop *= 0.85 + r.rng.next() * 0.1;
    winner.pop *= 1.02;
    r.rivalPairs[r.pairKey(a.id, b.id)] = -60; // betrayal-grade memory
    r.noteHistory(winner, `Victorious over ${loser.name}, ${r.year}.`);
    r.noteHistory(loser, `Defeated by ${winner.name}, ${r.year}.`);
    r.addLog(
      `PEACE ABROAD: the ${a.name}–${b.name} war ends — ${winner.name} dictates terms, and ${loser.name} signs them. ` +
      `The export boom cools.`,
      'info',
    );
    if (r.rng.chance(0.5)) r.changeRegime(loser, 'defeat');
  }
  /** Monthly tick: hostile rivals may run covert operations against the player. */
export function tickRivalEspionage(r: RegionSim): void {
    if (!r.stateProclaimed) return;
    for (const rv of r.rivals) {
      if (r.playerWar?.rivalId === rv.id) continue;
      if (rv.relations > 10) continue;
      const chance = 0.04 + rv.weights.risk * 0.006 + Math.abs(Math.min(0, rv.relations)) * 0.001;
      if (!r.aiRng.chance(chance)) continue;
      if (r.day - (rv.lastEspionageDay ?? -90) < 90) continue;
      rv.lastEspionageDay = r.day;
      // Operation chosen by personality
      const op = rv.weights.commerce >= 6 ? 'economic_pressure'
               : rv.weights.expansion >= 7 ? 'military_recon'
               : 'incite_dissent';
      const playerIntel = r.intelOf(rv.id);
      const caught = r.aiRng.chance(0.15 + playerIntel * 0.35);
      if (!caught) {
        switch (op) {
          case 'economic_pressure': {
            const drain = Math.min(r.treasury, 5 + r.rng.int(15));
            r.treasury = Math.max(0, r.treasury - drain);
            r.addLog(`Trade irregularities cost the treasury ${formatCurrency(drain)} — ${rv.name} interference suspected.`, 'bad');
            break;
          }
          case 'military_recon': {
            // Rival tracks our defences; manifest as a log warning
            r.addLog(`Military attachés from ${rv.name} are spotted near the frontier — border security alerted.`, 'info');
            break;
          }
          case 'incite_dissent': {
            const t = r.settlements.length > 0 ? r.settlements[r.rng.int(r.settlements.length)] : null;
            if (t && t.factionId === r.playerFactionId) {
              t.grievance = Math.min(100, t.grievance + 5);
              r.addLog(`Agitators stir trouble in ${t.name} — ${rv.name}'s hand is suspected.`, 'bad');
            }
            break;
          }
        }
      } else {
        // Caught: expose the operation, slight relations hit for them, sanctions threat
        rv.relations = r.clampRel(rv.relations - 6);
        r.addLog(`COUNTER-INTEL: ${rv.name}'s agents are caught and expelled. Their operation fails.`, 'good');
      }
    }
  }
  /** Monthly tick: commerce-weighted rivals form independent trade blocs. */
export function tickRivalTradeBlocActivity(r: RegionSim): void {
    // Clean up blocs whose membership has fallen below 2
    r.rivalTradeBlocs = r.rivalTradeBlocs.filter(
      (b) => b.memberRivalIds.filter((id) => r.rival(id)).length >= 2,
    );
    for (let i = 0; i < r.rivals.length; i++) {
      const a = r.rivals[i];
      if (a.weights.commerce < 5) continue;
      for (let j = i + 1; j < r.rivals.length; j++) {
        const b = r.rivals[j];
        if (b.weights.commerce < 5) continue;
        if (r.pairRelations(a.id, b.id) < 40) continue;
        const together = r.rivalTradeBlocs.some(
          (bl) => bl.memberRivalIds.includes(a.id) && bl.memberRivalIds.includes(b.id),
        );
        if (together || !r.rng.chance(0.025)) continue;
        const aBloc = r.rivalTradeBlocs.find((bl) => bl.memberRivalIds.includes(a.id));
        const bBloc = r.rivalTradeBlocs.find((bl) => bl.memberRivalIds.includes(b.id));
        if (aBloc && !aBloc.memberRivalIds.includes(b.id)) {
          aBloc.memberRivalIds.push(b.id);
          r.addLog(`${b.name} joins ${a.name}'s trade union — tariff walls rise for outsiders.`, 'info');
        } else if (bBloc && !bBloc.memberRivalIds.includes(a.id)) {
          bBloc.memberRivalIds.push(a.id);
          r.addLog(`${a.name} accedes to ${b.name}'s trade union — the bloc grows.`, 'info');
        } else if (!aBloc && !bBloc) {
          const tariff = 0.1 + (a.weights.commerce + b.weights.commerce) * 0.01;
          r.rivalTradeBlocs.push({
            id: r.nextRivalBlocId++,
            memberRivalIds: [a.id, b.id],
            foundedYear: r.year,
            tariff: Math.min(0.4, tariff),
          });
          r.addLog(`${a.name} and ${b.name} found a trade union — the world organises into blocs.`, 'info');
        }
      }
    }
  }
  /** Monthly: rival AI builds inter-provincial connections (commerce-weighted). */
export function tickRivalProvinceGovernance(r: RegionSim): void {
    for (const rv of r.rivals) {
      if (rv.weights.commerce < 5 || !r.rng.chance(0.04)) continue;
      rv.pop = Math.round(rv.pop * 1.004);
      if (r.rng.chance(0.3)) {
        r.noteHistory(rv, `Improved provincial infrastructure, ${r.year}.`);
      }
    }
  }
  /** Monthly: expire elapsed sanctions. */
export function tickSanctions(r: RegionSim): void {
    r.sanctions = r.sanctions.filter((s) => s.untilDay < 0 || s.untilDay > r.day);
  }
