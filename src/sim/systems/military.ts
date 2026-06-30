/**
 * Warfare (GDD §7, Phase 16) — the tenth `region.ts` tick subsystem lifted to the
 * Track-C free-function form `fn(r: RegionSim, …)`. See systems/pollution.ts for the
 * rationale: each body runs VERBATIM against the same RegionSim so the
 * RNG-consumption order is byte-identical, `tick()` dispatches, and all state +
 * serialize() stay on RegionSim. The byte-identical serialize() diff is guarded by
 * tests/serialize-determinism.
 *
 * These are the war TICKS — the per-month resolution of the front, armies, supply,
 * occupation and home-front morale. `updateArmyMovement` drives `resolveProvinceBattle`
 * as a module sibling; `tickPlayerWar` is the player-war resolver, called from
 * systems/diplomacy.ts (`updateDiplomacy`). The player ACTIONS (setMobilization,
 * proposePeace, deployUnits, capitulate, …) and the UI QUERIES
 * (computeCombatPower / computeWarScore) stay on RegionSim — the moved bodies reach
 * them, and the war state, through `r`.
 */
import type { RegionSim, ProvincialArmy } from '../region';
import {
  UNIT_TYPES,
  MOBILIZATION_DEFS,
  OCCUPATION_DEFS,
  MAX_OCCUPIED_MARCHES,
  WAR_SUPPORT_FLOOR,
  WAR_SUPPORT_DECAY_MULT,
  ROUTE_CONDITION_FLOOR,
  blocAffinity,
} from '../region';

  /** Monthly: advance armies, resolve battles on arrival, drain supply. */
export function updateArmyMovement(r: RegionSim): void {
    for (const army of r.provincialArmies) {
      army.supply = Math.max(0, army.supply - 1 / 30);
      if (army.supply <= 0) {
        for (const u of army.units) u.morale = Math.max(0, u.morale - 5);
      }
    }
    for (const army of [...r.provincialArmies]) {
      if (!army.destinationId) continue;
      army.transitDays -= 30;
      if (army.transitDays <= 0) {
        const toName = r.settlement(army.destinationId)?.name ?? 'destination';
        const ownerName = army.ownerId === 0 ? 'Our army' : (r.rival(army.ownerId)?.name ?? 'Enemy force');
        army.provinceId = army.destinationId;
        army.destinationId = null;
        army.transitDays = 0;
        r.addLog(`${ownerName} arrives at ${toName}.`, 'info');
        resolveProvinceBattle(r, army.provinceId);
      }
    }
    r.provincialArmies = r.provincialArmies.filter(
      (a) => a.units.reduce((s, u) => s + u.count, 0) > 0,
    );
  }

  /** Resolve combat when opposing armies occupy the same province. */
export function resolveProvinceBattle(r: RegionSim, provinceId: number): void {
    const playerArmies = r.provincialArmies.filter((a) => a.ownerId === 0 && a.provinceId === provinceId && !a.destinationId);
    const rivalArmies = r.provincialArmies.filter((a) => a.ownerId !== 0 && a.provinceId === provinceId && !a.destinationId);
    if (!playerArmies.length || !rivalArmies.length) return;
    const sName = r.settlement(provinceId)?.name ?? 'the province';
    const calcPower = (armies: ProvincialArmy[], rivalBoost = 1) =>
      armies.reduce((sum, a) => sum + a.units.reduce((s, u) =>
        s + u.count * UNIT_TYPES[u.type].powerPerUnit * (u.morale / 100), 0) * rivalBoost, 0);
    const rvId = rivalArmies[0].ownerId;
    const rv = r.rival(rvId);
    const rivalBoost = rv ? 0.6 + rv.weights.expansion * 0.04 : 0.6;
    const playerPower = calcPower(playerArmies);
    const rivalPower = calcPower(rivalArmies, rivalBoost);
    const playerWins = playerPower >= rivalPower * (0.8 + r.rng.next() * 0.4);
    if (playerWins) {
      r.provincialArmies = r.provincialArmies.filter((a) => !(a.ownerId === rvId && a.provinceId === provinceId));
      for (const a of playerArmies) {
        for (const u of a.units) { u.count = Math.max(1, Math.round(u.count * 0.8)); u.morale = Math.max(40, u.morale - 10); }
      }
      if (rv) rv.relations = r.clampRel(rv.relations - 5);
      r.addLog(`BATTLE of ${sName}: our forces rout ${rv?.name ?? 'the enemy'}!`, 'good');
    } else {
      const homeId = r.settlements.find((s) => s.factionId === r.playerFactionId)?.id ?? provinceId;
      for (const a of playerArmies) {
        a.provinceId = homeId;
        a.destinationId = null;
        for (const u of a.units) { u.count = Math.max(1, Math.round(u.count * 0.7)); u.morale = Math.max(20, u.morale - 20); }
      }
      r.addLog(`BATTLE of ${sName}: ${rv?.name ?? 'the enemy'} drives our forces back!`, 'bad');
    }
  }

  /** Monthly: rival AI spawns and manoeuvres armies (expansion-minded powers threaten borders). */
export function tickRivalArmyAI(r: RegionSim): void {
    // Phase 17: scale expansion chance by aiAggression difficulty knob
    const aggressionScale = r.difficultySettings.aiAggression;
    for (const rv of r.rivals) {
      if (rv.weights.expansion < 6) continue;
      if (!r.rng.chance(0.025 * aggressionScale)) continue;
      const rvArmies = r.provincialArmies.filter((a) => a.ownerId === rv.id);
      if (rvArmies.length >= 2) continue;
      const targets = r.settlements.filter((s) => s.factionId === r.playerFactionId);
      if (!targets.length) continue;
      const target = targets[r.rng.int(targets.length)];
      const armySize = 2 + r.rng.int(4);
      r.provincialArmies.push({
        id: r.nextArmyId++,
        ownerId: rv.id,
        provinceId: target.id,
        destinationId: null,
        transitDays: 0,
        units: [{ type: 'militia', count: armySize, morale: 70, suppliedDays: 60 }],
        supply: 1.5,
      });
      r.addLog(`Intelligence: ${rv.name} is massing troops near ${target.name}!`, 'bad');
    }
  }

  /** Monthly tick: mobilization effects and auto-demobilization (Phase 16). */
export function tickMobilization(r: RegionSim): void {
    if (r.mobilizationLevel === 0) return;
    r.mobilizationMonths++;
    const atWar = r.playerWar !== null;
    // Auto-reduce to 0 if not at war for 6 months
    if (!atWar && r.mobilizationMonths >= 6) {
      r.mobilizationLevel = 0;
      r.mobilizationMonths = 0;
      r.addLog('Mobilization expires — no active war after 6 months. Forces stand down.', 'info');
      return;
    }
    // Total mobilization costs
    if (r.mobilizationLevel === 2) {
      const gdp = r.gdpLastMonth;
      const cost = gdp * 0.03;
      r.treasury -= cost;
      // Satisfaction -3/month
      for (const s of r.settlements) {
        if (s.factionId === r.playerFactionId) {
          s.satisfaction = Math.max(0, s.satisfaction - 3);
        }
      }
      // WarSupport drain from rationing
      if (atWar && r.playerWar) {
        r.warSupport = Math.max(0, r.warSupport - 0.5);
      }
    }
  }

  /** Resolve a battle between Army Groups at a province (Phase 16). */
export function resolveArmyGroupBattle(r: RegionSim, provinceId: number): void {
    const playerArmies = r.armyGroups.filter((a) => a.ownerId === 0 && a.provinceId === provinceId && !a.destinationId);
    const rivalArmies = r.armyGroups.filter((a) => a.ownerId !== 0 && a.provinceId === provinceId && !a.destinationId);
    if (!playerArmies.length || !rivalArmies.length) return;
    const sName = r.settlement(provinceId)?.name ?? `Province ${provinceId}`;
    const playerPower = playerArmies.reduce((s, a) => s + r.computeCombatPower(a), 0);
    const rivalPower = rivalArmies.reduce((s, a) => s + r.computeCombatPower(a), 0);
    const playerWins = playerPower >= rivalPower * (0.8 + r.rng.next() * 0.4);
    const rvId = rivalArmies[0].ownerId;
    const rv = r.rival(rvId);
    const rvName = rv?.name ?? 'rival forces';
    if (playerWins) {
      // Loser retreats to adjacent province
      const retreatTarget = r.settlements.find((s) => s.factionId === rvId)?.id ?? provinceId;
      for (const a of rivalArmies) {
        a.manpower = Math.round(a.manpower * 0.7); // loser manpower ×0.7
        a.morale = Math.max(0, a.morale - 20);     // loser morale -20
        a.provinceId = retreatTarget;
      }
      for (const a of playerArmies) {
        a.manpower = Math.round(a.manpower * 0.9); // winner manpower ×0.9
        a.morale = Math.min(100, a.morale + 5);    // winner morale +5
        a.wonBattleThisMonth = true;
      }
      r.lastBattleWon = true;
      const casualties = Math.round(rivalPower * 0.3 + playerPower * 0.1);
      r.addLog(`BATTLE OF ${sName.toUpperCase()}: our forces prevail, ${rvName} retreats — ${casualties} casualties.`, 'good');
    } else {
      // Player loses — retreat to nearest player province
      const homeId = r.settlements.find((s) => s.factionId === r.playerFactionId)?.id ?? provinceId;
      for (const a of playerArmies) {
        a.manpower = Math.round(a.manpower * 0.7); // loser manpower ×0.7
        a.morale = Math.max(0, a.morale - 20);     // loser morale -20
        a.provinceId = homeId;
      }
      for (const a of rivalArmies) {
        a.manpower = Math.round(a.manpower * 0.9); // winner manpower ×0.9
        a.morale = Math.min(100, a.morale + 5);    // winner morale +5
      }
      r.lastBattleWon = false;
      const casualties = Math.round(playerPower * 0.3 + rivalPower * 0.1);
      r.addLog(`BATTLE OF ${sName.toUpperCase()}: our forces lose, ${rvName} holds the field — ${casualties} casualties.`, 'bad');
    }
    // Remove armies with no manpower
    r.armyGroups = r.armyGroups.filter((a) => a.manpower > 0);
  }

  /** Monthly tick: supply line decay for Army Groups (Phase 16). */
export function tickSupplyLines(r: RegionSim): void {
    const playerProvinces = new Set(
      r.settlements.filter((s) => s.factionId === r.playerFactionId).map((s) => s.id)
    );
    for (const army of r.armyGroups) {
      const atPlayerProvince = playerProvinces.has(army.provinceId);
      if (atPlayerProvince) {
        // Supply recovers at player province
        army.supply = Math.min(1.0, army.supply + 0.05);
      } else {
        // Check distance: more than 2 hexes from nearest player province
        const prov = r.settlement(army.provinceId);
        if (prov) {
          const minDist = r.settlements
            .filter((s) => s.factionId === r.playerFactionId)
            .reduce((minD, ps) => Math.min(minD, Math.hypot(prov.x - ps.x, prov.y - ps.y)), Infinity);
          if (minDist > 20) { // ~2 hexes in 0–100 coord space
            army.supply = Math.max(0, army.supply - 0.08);
          }
        }
      }
      // Low supply penalties
      if (army.supply < 0.4) {
        army.morale = Math.max(0, army.morale - 3);
        army.equipmentLevel = Math.max(0, army.equipmentLevel - 2);
      }
      // Critical supply: forced retreat
      if (army.supply < 0.2 && army.ownerId === 0) {
        const home = r.settlements.find((s) => s.factionId === r.playerFactionId);
        if (home && army.provinceId !== home.id) {
          army.provinceId = home.id;
          r.addLog(`Supply critical — army at ${r.settlement(army.provinceId)?.name ?? 'field'} falls back to home territory.`, 'bad');
        }
      }
    }
  }

  /** Monthly tick: occupation resistance and events (Phase 16). */
export function tickOccupation(r: RegionSim): void {
    for (const [provIdStr, occ] of Object.entries(r.provincialOccupations)) {
      const provId = Number(provIdStr);
      const province = r.settlement(provId);
      if (!province) continue;
      const rv = r.rival(occ.occupiedBy);
      // Ideology distance: compare player bloc to occupier bloc
      const playerBloc = r.playerBloc() ?? 'liberal';
      const occupierBloc = rv ? r.regimeOf(rv).bloc : 'autocratic';
      const ideologyDistance = Math.max(0, -blocAffinity(playerBloc, occupierBloc));
      let resistanceGrowth = 1 + ideologyDistance * 0.5;
      // Policy modifiers
      if (occ.occupationPolicy === 'brutal') {
        resistanceGrowth *= 0.7; // slower now, worse postwar
        occ.brutalPolicyPenalty = Math.min(100, occ.brutalPolicyPenalty + 1);
      } else if (occ.occupationPolicy === 'conciliatory') {
        resistanceGrowth *= 1.4;
      }
      occ.resistanceLevel = Math.min(100, occ.resistanceLevel + resistanceGrowth);
      // Guerrilla events at high resistance
      if (occ.resistanceLevel > 70 && r.rng.chance(0.4)) {
        const gdp = r.gdpLastMonth;
        r.treasury -= gdp * 0.01;
        // Supply penalty on any army groups at enemy provinces
        for (const ag of r.armyGroups) {
          if (ag.ownerId !== 0 && ag.provinceId === provId) {
            ag.supply = Math.max(0, ag.supply - 0.1);
          }
        }
        r.addLog(`Guerrilla activity in ${province.name} — partisans raid supply lines and drain treasury.`, 'bad');
      }
      // Province liberation at extreme resistance
      if (occ.resistanceLevel > 90) {
        delete r.provincialOccupations[provId];
        // Expel occupying armies
        r.armyGroups = r.armyGroups.filter(
          (ag) => !(ag.ownerId !== 0 && ag.provinceId === provId)
        );
        r.addLog(`LIBERATION: the people of ${province.name} expel the occupying forces — the province is free!`, 'good');
      }
    }
  }

  /** Monthly tick: war support decay and rally (Phase 16). */
export function tickWarSupport(r: RegionSim): void {
    if (!r.playerWar) return;
    // Base decay — scaled by regime's decay multiplier (all 1.0 now; tune later)
    const decayMult = WAR_SUPPORT_DECAY_MULT[r.govType ?? 'democracy'];
    r.warSupport = Math.max(0, r.warSupport - 1 * decayMult);
    // Decay from mobilization level 2 (rationing)
    if (r.mobilizationLevel === 2) {
      r.warSupport = Math.max(0, r.warSupport - 2);
    }
    // Decay from casualties (rough estimate from player war casualties)
    const totalPop = r.totalPop();
    if (totalPop > 0 && r.playerWar.casualties > 0) {
      const casualtyRate = r.playerWar.casualties / totalPop;
      r.warSupport = Math.max(0, r.warSupport - casualtyRate * 50);
    }
    // Rally: won a battle this month
    if (r.lastBattleWon) {
      r.warSupport = Math.min(100, r.warSupport + 5);
    }
    // Rally: rival attacks player home province
    const playerProvinces = r.settlements.filter((s) => s.factionId === r.playerFactionId).map((s) => s.id);
    const enemyAtHome = r.armyGroups.some(
      (ag) => ag.ownerId !== 0 && playerProvinces.includes(ag.provinceId)
    );
    if (enemyAtHome) {
      r.warSupport = Math.min(100, r.warSupport + 10);
      r.addLog('Enemy forces threaten the homeland — war support surges!', 'bad');
    }
    // Events at low war support
    if (r.warSupport < 20) {
      // Draft riots
      for (const s of r.settlements) {
        if (s.factionId === r.playerFactionId) {
          s.grievance = Math.min(100, s.grievance + 15);
          s.satisfaction = Math.max(0, s.satisfaction - 10);
        }
      }
      if (r.rng.chance(0.5)) {
        r.addLog('DRAFT RIOTS: war weariness boils over — grievance surges in the streets.', 'bad');
      }
    }
    if (r.warSupport < 5) {
      // Coup risk
      r.legitimacy = Math.max(0, r.legitimacy - 25);
      if (r.mobilizationLevel > 0) {
        r.mobilizationLevel = Math.max(0, r.mobilizationLevel - 1) as 0 | 1 | 2;
      }
      r.addLog('COUP RISK: the government teeters — legitimacy collapses, mobilization falters.', 'bad');
    }
    // Reset battle flag
    r.lastBattleWon = false;
  }

  /** Consume supply reserves based on army size and unit types (GDD §7.1, §7.3). */
export function consumeWarSupply(r: RegionSim): void {
    const w = r.playerWar;
    if (!w || w.units.length === 0) return;

    // Calculate monthly supply demand from all units
    const monthDays = 30;
    const supplyDemand = w.units.reduce((total, unit) => {
      const unitDef = UNIT_TYPES[unit.type];
      return total + unit.count * unitDef.supplyCost * monthDays;
    }, 0);

    // Deduct from supply reserve
    w.supplyReserve -= supplyDemand;

    // Log supply status
    if (w.supplyReserve > 3) {
      // Army is well-supplied
    } else if (w.supplyReserve > 1) {
      if (r.rng.chance(0.3)) r.addLog('Supply lines stretching thin — rations cut.', 'info');
    } else if (w.supplyReserve > 0) {
      if (r.rng.chance(0.3)) r.addLog('SUPPLY CRISIS: The army goes hungry. Morale plummets.', 'bad');
      // Reduce morale on critical shortage
      for (const unit of w.units) {
        unit.morale = Math.max(30, unit.morale - 10);
      }
    } else {
      // No supply left — army begins to disband
      if (r.rng.chance(0.5)) {
        const disbanded = Math.ceil(w.units.reduce((sum, u) => sum + u.count, 0) * 0.1);
        let remaining = disbanded;
        for (const unit of w.units) {
          const loss = Math.min(remaining, unit.count);
          unit.count -= loss;
          remaining -= loss;
          if (remaining === 0) break;
        }
        w.units = w.units.filter(u => u.count > 0);
        r.addLog(`DESERTION: ${disbanded} troops abandon the army — supply exhausted.`, 'bad');
      }
      w.supplyReserve = 0;
    }
  }

  /** Monthly war resolution (GDD §7.3–7.4): the front moves on the power
   *  ratio, attrition bleeds the cohorts, and the home front keeps score. */
export function tickPlayerWar(r: RegionSim): void {
    const w = r.playerWar;
    if (!w) return;
    if (w.startedDay === r.day) return; // the declaration day musters; the front resolves with the month
    const rv = r.rival(w.rivalId);
    if (!rv) {
      // Rival no longer exists — inconclusive end (bookkeep with a placeholder name)
      r.warScars.push({ rivalId: w.rivalId, rivalName: `rival#${w.rivalId}`, yearEnded: r.year, outcome: 'status_quo', occupied: w.occupied, casualties: w.casualties, durationMonths: Math.round((r.day - w.startedDay) / 30) });
      r.playerWar = null;
      return;
    }
    const mob = MOBILIZATION_DEFS[w.mobilization];
    const P = r.warPower();
    const R = r.rivalWarPower(rv);
    const delta = 16 * ((P - R) / (P + R)) + r.rng.int(9) - 4;
    w.score = Math.max(-100, Math.min(100, w.score + delta));
    if (w.blockade) {
      rv.pop *= 0.997; // the quays starve before the trenches do
      w.score = Math.min(100, w.score + 1.5);
    }
    // Front stub: mirrors war score; future Front system will read this position.
    w.front = { position: w.score };
    // Attrition (GDD §7.3): burns even on quiet fronts; the pyramid keeps the scar
    const lossRate =
      (w.mobilization === 'total' ? 0.006 : w.mobilization === 'partial' ? 0.004 : 0.003) +
      (delta < 0 ? 0.002 : 0);
    let lost = 0;
    for (const t of r.settlements) {
      const l = (t.cohorts.bands[1] + t.cohorts.bands[2]) * lossRate;
      t.cohorts.bands[1] -= l * 0.7;
      t.cohorts.bands[2] -= l * 0.3;
      t.satisfaction = Math.max(0, t.satisfaction + mob.satMonthly); // rationing bites
      lost += l;
    }
    w.casualties += lost;
    rv.pop *= 1 - lossRate * (delta > 0 ? 1.2 : 0.8);
    // co-belligerents bleed beside you, at half the rate (GDD §7.3)
    for (const id of w.allies) {
      const ally = r.rival(id);
      if (ally) ally.pop *= 1 - lossRate * 0.5;
    }
    // Interdiction runs both ways (GDD §7.3): their raiders cut your routes
    if (r.routes.length > 0 && r.rng.chance(0.3)) {
      const rt = r.routes[r.rng.int(r.routes.length)];
      rt.condition = Math.max(ROUTE_CONDITION_FLOOR, rt.condition - 12);
      const an = r.settlement(rt.a)?.name ?? '?';
      const bn = r.settlement(rt.b)?.name ?? '?';
      r.addLog(`Enemy raiders fire the depots — the ${an}–${bn} ${rt.kind} is cut about.`, 'bad');
    }
    // War support (GDD §7.4): decays with duration and defeat, rallies on victories
    w.support += delta > 4 ? 2 : delta < -4 ? -4 : -1.5;
    if (w.mobilization === 'total') w.support -= 1.5;
    w.support = Math.max(0, Math.min(100, w.support));
    // Occupation (GDD §7.4): a winning front takes ground; a losing one cedes it
    if (w.score >= 35 && w.occupied < MAX_OCCUPIED_MARCHES && r.rng.chance(0.3)) {
      w.occupied++;
      w.support = Math.min(100, w.support + 3); // the parade writes the headline
      r.addLog(`Our columns take one of ${rv.name}'s marches — military administration begins (${w.occupied} occupied).`, 'good');
    } else if (w.score < 0 && w.occupied > 0 && r.rng.chance(0.25)) {
      w.occupied--;
      if (w.occupied === 0) w.resistance = 0;
      r.addLog(`${rv.name}'s counterattack retakes its march — the garrison falls back (${w.occupied} occupied).`, 'bad');
    }
    if (w.occupied > 0) {
      const occ = OCCUPATION_DEFS[w.occupationPolicy];
      // resistance scales with ideology distance and your policy (GDD §7.4)
      const distance = blocAffinity(r.playerBloc() ?? 'liberal', r.regimeOf(rv).bloc) < 0 ? 1.5 : 1;
      w.resistance = Math.min(100, w.resistance + occ.resistance * distance);
      r.treasury += w.occupied * (occ.yield - occ.garrison); // partial output, garrisons paid
      if (w.resistance > 50 && r.rng.chance(w.resistance / 120)) {
        w.casualties += w.occupied * 1.5;
        w.score = Math.max(-100, w.score - 2);
        w.support = Math.max(0, w.support - 1.5);
        r.addLog('Partisans burn the depots in the occupied marches — garrisons bleed and the occupation sours.', 'bad');
      }
    }
    if (r.rng.chance(0.35)) {
      r.addLog(
        delta > 4
          ? `The front moves: our columns push into ${rv.name}'s marches.`
          : delta < -4
            ? `Bad news from the front: ${rv.name}'s offensive gains ground.`
            : `Stalemate on the ${rv.name} front. The shells fall; the line holds.`,
        delta < -4 ? 'bad' : 'info',
      );
    }
    // The regime's consent floor (GDD §7.5)
    const floor = WAR_SUPPORT_FLOOR[r.govType ?? 'democracy'];
    if (w.support < floor) {
      r.legitimacy = Math.max(0, r.legitimacy - 2);
      for (const t of r.settlements) t.grievance = Math.min(100, t.grievance + 4);
      if (r.rng.chance(0.3)) r.addLog('War weariness: draft riots and strike talk — the home front is buckling.', 'bad');
      if (w.support <= floor - 15) {
        r.addLog('THE HOME FRONT BREAKS: the government cannot continue the war.', 'bad');
        r.capitulate();
        return;
      }
    }
    // The enemy dictates when the scoreboard is theirs
    if (w.score <= -60) {
      r.capitulate();
      return;
    }
    // A beaten enemy lets you know the table is set (GDD §7.4)
    if (w.score >= 60 && r.rng.chance(0.25)) {
      r.addLog(`${rv.name} sues for peace — its envoys ask what the guns will cost to stop.`, 'info');
    }
  }

  /** An AI settlement whose population decays below one person is a ghost town:
   *  removePop is multiplicative, so without this a starved rival town would
   *  linger forever displaying a fractional "pop 0.004" (the collapsed outposts
   *  players kept seeing on the map). Remove it from the map and its faction,
   *  hand the capital to a survivor, and let a faction with no towns left die.
   *  RNG-free so determinism holds. The player's own towns are left alone —
   *  those are visible and managed, and colony death is the town tier's call. */
export function abandonGhostTowns(r: RegionSim): void {
    const doomed = r.settlements.filter(
      (t) => t.factionId !== r.playerFactionId && r.popOf(t) < 1,
    );
    for (const t of doomed) {
      const faction = r.faction(t.factionId);
      r.settlements = r.settlements.filter((s) => s !== t);
      r.routes = r.routes.filter((rt) => rt.a !== t.id && rt.b !== t.id);
      r._routePathCache.clear(); // routes removed with the destroyed settlement
      r.activeRailRoutes = r.routes.filter((r) => r.kind === 'rail' && r.condition > 50).length;
      r.notables = r.notables.filter((n) => n.settlementId !== t.id);
      if (faction) {
        faction.settlementIds = faction.settlementIds.filter((id) => id !== t.id);
        if (faction.capital === t.id) {
          faction.capital = faction.settlementIds[0] ?? -1;
        }
      }
      r.addLog(`${t.name} is abandoned — the last of its people have drifted away. A ghost town now.`, 'bad');
    }
  }
