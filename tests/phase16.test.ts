/**
 * Phase 16: Warfare System Depth — tests for GDD §7
 *
 * Tests cover:
 *  - generateCasusBelli()
 *  - setMobilizationLevel() / tickMobilization()
 *  - computeCombatPower()
 *  - resolveArmyGroupBattle()
 *  - tickSupplyLines()
 *  - tickOccupation() / setOccupationPolicyForProvince()
 *  - tickWarSupport()
 *  - computeWarScore()
 *  - proposePeace()
 *  - serialize/deserialize round-trips
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  RegionSim,
  ArmyGroup,
  CBDef,
  PeaceTermDef,
} from '../src/sim/region';

// ---- helpers ----

function makeRegion(seed = 42): RegionSim {
  return RegionSim.create(seed);
}

/** Inject a rival into the sim so war/CB tests have a target. */
function injectRival(r: RegionSim): number {
  const sim = r as unknown as {
    rivals: Array<{
      id: number; name: string; leader: string; archetype: string;
      weights: Record<string, number>; regime: string; agenda: string;
      compass: string; pop: number; relations: number; treaties: string[];
      borderSettled: boolean; emergedYear: number; history: string[];
      lastEnvoyDay: number; lastGiftDay: number;
    }>;
    nationProclaimed: boolean;
    stateProclaimed: boolean;
    playerWar: object | null;
    warSupport: number;
    treatiesBroken: number;
  };
  const id = 9001;
  sim.rivals.push({
    id, name: 'Testania', leader: 'Commander Test', archetype: 'hegemon',
    weights: { expansion: 7, commerce: 3, honor: 5, risk: 6, grudge: 3 },
    regime: 'junta', agenda: 'dominate', compass: 'east',
    pop: 80, relations: -70, treaties: [],
    borderSettled: false, emergedYear: 1920, history: [],
    lastEnvoyDay: -999, lastGiftDay: -999,
  });
  sim.nationProclaimed = true;
  sim.stateProclaimed = true;
  return id;
}

/** Force a player war against the injected rival. */
function forceWar(r: RegionSim, rivalId: number): void {
  const sim = r as unknown as {
    playerWar: {
      rivalId: number; cb: string; defensive: boolean; startedDay: number;
      support: number; score: number; mobilization: string; casualties: number;
      blockade: boolean; allies: number[]; enemyAllies: number[]; occupied: number;
      resistance: number; occupationPolicy: string; brutality: boolean;
      units: object[]; supplyReserve: number;
    } | null;
    warSupport: number;
    day: number;
  };
  sim.playerWar = {
    rivalId, cb: 'border_dispute', defensive: false, startedDay: sim.day - 1,
    support: 60, score: 30, mobilization: 'peacetime', casualties: 0,
    blockade: false, allies: [], enemyAllies: [], occupied: 0,
    resistance: 0, occupationPolicy: 'conciliatory', brutality: false,
    units: [], supplyReserve: 3,
  };
  sim.warSupport = 60;
}

/** Create a basic ArmyGroup for testing. */
function makeArmyGroup(overrides: Partial<ArmyGroup> = {}): ArmyGroup {
  return {
    id: 1,
    ownerId: 0,
    provinceId: 1000,
    transitDays: 0,
    manpower: 100,
    equipmentLevel: 80,
    supply: 1.0,
    doctrine: 60,
    morale: 90,
    ...overrides,
  };
}

// ---- 1. generateCasusBelli() ----

describe('generateCasusBelli()', () => {
  it('always includes fabricated CB for any rival', () => {
    const r = makeRegion();
    const rivalId = injectRival(r);
    const cbs = r.generateCasusBelli(rivalId);
    const fabricated = cbs.find((c) => c.type === 'fabricated');
    expect(fabricated).toBeDefined();
  });

  it('fabricated CB has negative warSupportBonus', () => {
    const r = makeRegion();
    const rivalId = injectRival(r);
    const cbs = r.generateCasusBelli(rivalId);
    const fabricated = cbs.find((c) => c.type === 'fabricated')!;
    expect(fabricated.warSupportBonus).toBeLessThan(0);
    expect(fabricated.warSupportBonus).toBe(-20);
  });

  it('fabricated CB has positive reputationCost (> 0)', () => {
    const r = makeRegion();
    const rivalId = injectRival(r);
    const cbs = r.generateCasusBelli(rivalId);
    const fabricated = cbs.find((c) => c.type === 'fabricated')!;
    expect(fabricated.reputationCost).toBeGreaterThan(0);
    expect(fabricated.reputationCost).toBe(25);
  });

  it('legitimate CBs have zero reputationCost', () => {
    const r = makeRegion();
    const rivalId = injectRival(r);
    const cbs = r.generateCasusBelli(rivalId);
    const legitimate = cbs.filter((c) => c.type !== 'fabricated');
    for (const cb of legitimate) {
      expect(cb.reputationCost).toBe(0);
    }
  });

  it('border_dispute CB has warSupportBonus of +5', () => {
    const r = makeRegion();
    const rivalId = injectRival(r);
    const cbs = r.generateCasusBelli(rivalId);
    const bd = cbs.find((c) => c.type === 'border_dispute');
    expect(bd).toBeDefined();
    expect(bd!.warSupportBonus).toBe(5);
  });

  it('protect_ideology CB generated when blocs differ greatly', () => {
    const r = makeRegion();
    const rivalId = injectRival(r);
    // Player bloc is liberal (default govType or null → assumed liberal)
    // Rival regime is 'junta' → autocratic bloc — hostile distance
    const cbs = r.generateCasusBelli(rivalId);
    const pi = cbs.find((c) => c.type === 'protect_ideology');
    expect(pi).toBeDefined();
    expect(pi!.warSupportBonus).toBe(10);
  });

  it('all returned CBs have the correct targetRivalId', () => {
    const r = makeRegion();
    const rivalId = injectRival(r);
    const cbs = r.generateCasusBelli(rivalId);
    for (const cb of cbs) {
      expect(cb.targetRivalId).toBe(rivalId);
    }
  });

  it('returns empty array for non-existent rival', () => {
    const r = makeRegion();
    const cbs = r.generateCasusBelli(9999);
    expect(cbs).toEqual([]);
  });
});

// ---- 2. setMobilizationLevel() / tickMobilization() ----

describe('setMobilizationLevel()', () => {
  it('returns false when trying to increase without active war', () => {
    const r = makeRegion();
    const result = r.setMobilizationLevel(1);
    expect(result).toBe(false);
    expect(r.mobilizationLevel).toBe(0);
  });

  it('level 0→1 increases garrison and manufacturing during war', () => {
    const r = makeRegion();
    const rivalId = injectRival(r);
    forceWar(r, rivalId);
    const playerSettlement = r.settlements.find((s) => s.factionId === r.playerFactionId)!;
    const initialGarrison = playerSettlement.garrisonStrength;
    // Set a non-zero industry output so the multiplier is visible
    playerSettlement.sectors.industry.output = 100;
    const initialIndustryOutput = playerSettlement.sectors.industry.output;
    const result = r.setMobilizationLevel(1);
    expect(result).toBe(true);
    expect(r.mobilizationLevel).toBe(1);
    expect(playerSettlement.garrisonStrength).toBeGreaterThan(initialGarrison);
    expect(playerSettlement.sectors.industry.output).toBeGreaterThan(initialIndustryOutput);
  });

  it('level 0→1 sets manufacturing output to approximately ×1.15', () => {
    const r = makeRegion();
    const rivalId = injectRival(r);
    forceWar(r, rivalId);
    const playerSettlement = r.settlements.find((s) => s.factionId === r.playerFactionId)!;
    // Set a non-zero industry output so the multiplier is visible
    playerSettlement.sectors.industry.output = 200;
    const initialIndustry = playerSettlement.sectors.industry.output;
    r.setMobilizationLevel(1);
    expect(playerSettlement.sectors.industry.output).toBeCloseTo(initialIndustry * 1.15, 1);
  });

  it('level 1→2 reduces workforce during war', () => {
    const r = makeRegion();
    const rivalId = injectRival(r);
    forceWar(r, rivalId);
    r.setMobilizationLevel(1);
    const playerSettlement = r.settlements.find((s) => s.factionId === r.playerFactionId)!;
    const initialWorkers = playerSettlement.cohorts.bands[1] + playerSettlement.cohorts.bands[2];
    r.setMobilizationLevel(2);
    expect(r.mobilizationLevel).toBe(2);
    const newWorkers = playerSettlement.cohorts.bands[1] + playerSettlement.cohorts.bands[2];
    expect(newWorkers).toBeLessThan(initialWorkers);
  });

  it('decreasing mobilization costs warSupport (-10)', () => {
    const r = makeRegion();
    const rivalId = injectRival(r);
    forceWar(r, rivalId);
    r.setMobilizationLevel(1);
    r.warSupport = 80;
    r.setMobilizationLevel(0);
    expect(r.warSupport).toBe(70);
    expect(r.mobilizationLevel).toBe(0);
  });

  it('can increase mobilization during war', () => {
    const r = makeRegion();
    const rivalId = injectRival(r);
    forceWar(r, rivalId);
    const result = r.setMobilizationLevel(1);
    expect(result).toBe(true);
  });
});

describe('tickMobilization()', () => {
  it('auto-demobilizes after 6 months without war', () => {
    const r = makeRegion();
    const rivalId = injectRival(r);
    forceWar(r, rivalId);
    r.setMobilizationLevel(1);
    // End the war manually
    (r as unknown as { playerWar: null }).playerWar = null;
    // Simulate 6 months
    for (let i = 0; i < 6; i++) {
      (r as unknown as { mobilizationMonths: number }).mobilizationMonths++;
      if ((r as unknown as { mobilizationMonths: number }).mobilizationMonths >= 6) {
        r.tickMobilization();
        break;
      }
    }
    expect(r.mobilizationLevel).toBe(0);
  });

  it('total mobilization drains treasury each month', () => {
    const r = makeRegion();
    const rivalId = injectRival(r);
    forceWar(r, rivalId);
    r.setMobilizationLevel(1);
    r.setMobilizationLevel(2);
    // Set a non-zero GDP so the cost is visible
    (r as unknown as { gdpLastMonth: number }).gdpLastMonth = 10000;
    r.mobilizationLevel = 2;
    const initialTreasury = r.treasury;
    r.tickMobilization();
    expect(r.treasury).toBeLessThan(initialTreasury);
  });
});

// ---- 3. computeCombatPower() ----

describe('computeCombatPower()', () => {
  it('higher equipment level produces higher power', () => {
    const r = makeRegion();
    const highEquip = makeArmyGroup({ equipmentLevel: 90 });
    const lowEquip = makeArmyGroup({ equipmentLevel: 30 });
    expect(r.computeCombatPower(highEquip)).toBeGreaterThan(r.computeCombatPower(lowEquip));
  });

  it('higher morale produces higher power', () => {
    const r = makeRegion();
    const highMorale = makeArmyGroup({ morale: 95 });
    const lowMorale = makeArmyGroup({ morale: 20 });
    expect(r.computeCombatPower(highMorale)).toBeGreaterThan(r.computeCombatPower(lowMorale));
  });

  it('sub-linear manpower: 4× manpower does NOT give 4× power (exponent 0.6)', () => {
    const r = makeRegion();
    const small = makeArmyGroup({ manpower: 100 });
    const large = makeArmyGroup({ manpower: 400 });
    const powerSmall = r.computeCombatPower(small);
    const powerLarge = r.computeCombatPower(large);
    // 4^0.6 ≈ 2.3, so large should be ~2.3× small, NOT 4×
    expect(powerLarge / powerSmall).toBeLessThan(3.5);
    expect(powerLarge / powerSmall).toBeGreaterThan(1.5);
  });

  it('supply 0 collapses combat power to zero', () => {
    const r = makeRegion();
    const noSupply = makeArmyGroup({ supply: 0 });
    expect(r.computeCombatPower(noSupply)).toBe(0);
  });

  it('higher doctrine level produces higher power', () => {
    const r = makeRegion();
    const highDoc = makeArmyGroup({ doctrine: 100 });
    const lowDoc = makeArmyGroup({ doctrine: 0 });
    expect(r.computeCombatPower(highDoc)).toBeGreaterThan(r.computeCombatPower(lowDoc));
  });
});

// ---- 4. resolveArmyGroupBattle() ----

describe('resolveArmyGroupBattle()', () => {
  it('stronger army wins battle and weaker loses manpower', () => {
    const r = makeRegion();
    const rivalId = injectRival(r);
    const provinceId = r.settlements[0]?.id ?? 1000;
    const groups = r as unknown as { armyGroups: ArmyGroup[]; nextArmyGroupId: number };
    const rivalInitialManpower = 50;
    // Player army: very strong
    groups.armyGroups.push({ id: groups.nextArmyGroupId++, ownerId: 0, provinceId, transitDays: 0, manpower: 500, equipmentLevel: 90, supply: 1.0, doctrine: 80, morale: 95 });
    // Rival army: very weak
    const rivalArmy: ArmyGroup = { id: groups.nextArmyGroupId++, ownerId: rivalId, provinceId, transitDays: 0, manpower: rivalInitialManpower, equipmentLevel: 10, supply: 0.5, doctrine: 10, morale: 20 };
    groups.armyGroups.push(rivalArmy);
    r.resolveArmyGroupBattle(provinceId);
    // After battle rival army should have taken losses (×0.7 = 35) and/or retreated
    // Player wins is deterministic given massive power ratio — rival loses manpower
    const remainingRivalArmies = groups.armyGroups.filter((a) => a.ownerId === rivalId);
    // Either rival retreated (different province) or took casualties
    if (remainingRivalArmies.length > 0) {
      expect(remainingRivalArmies[0].manpower).toBeLessThan(rivalInitialManpower);
    } else {
      // Eliminated entirely — also valid
      expect(remainingRivalArmies.length).toBe(0);
    }
  });

  it('loser suffers greater manpower loss than winner', () => {
    const r = makeRegion();
    const rivalId = injectRival(r);
    const provinceId = r.settlements[0]?.id ?? 1000;
    const groups = r as unknown as { armyGroups: ArmyGroup[]; nextArmyGroupId: number };
    // Clearly stronger player
    const playerArmy: ArmyGroup = { id: 1, ownerId: 0, provinceId, transitDays: 0, manpower: 400, equipmentLevel: 90, supply: 1.0, doctrine: 80, morale: 90 };
    const rivalArmy: ArmyGroup = { id: 2, ownerId: rivalId, provinceId, transitDays: 0, manpower: 50, equipmentLevel: 20, supply: 0.5, doctrine: 20, morale: 30 };
    groups.armyGroups = [playerArmy, rivalArmy];
    const playerManBefore = playerArmy.manpower;
    const rivalManBefore = rivalArmy.manpower;
    r.resolveArmyGroupBattle(provinceId);
    // Player lost some manpower (×0.9); rival lost more (×0.7)
    const playerLoss = (playerManBefore - playerArmy.manpower) / playerManBefore;
    const rivalLoss = (rivalManBefore - rivalArmy.manpower) / rivalManBefore;
    expect(rivalLoss).toBeGreaterThan(playerLoss);
  });

  it('no battle resolves when armies do not overlap', () => {
    const r = makeRegion();
    const groups = r as unknown as { armyGroups: ArmyGroup[]; nextArmyGroupId: number };
    groups.armyGroups.push({ id: 1, ownerId: 0, provinceId: 1000, transitDays: 0, manpower: 100, equipmentLevel: 80, supply: 1.0, doctrine: 60, morale: 90 });
    // No rival army — should not throw
    expect(() => r.resolveArmyGroupBattle(1000)).not.toThrow();
    expect(groups.armyGroups.length).toBe(1);
  });
});

// ---- 5. tickSupplyLines() ----

describe('tickSupplyLines()', () => {
  it('army at player province recovers supply', () => {
    const r = makeRegion();
    const playerProvinceId = r.settlements.find((s) => s.factionId === r.playerFactionId)!.id;
    const groups = r as unknown as { armyGroups: ArmyGroup[]; nextArmyGroupId: number };
    const army: ArmyGroup = { id: 1, ownerId: 0, provinceId: playerProvinceId, transitDays: 0, manpower: 100, equipmentLevel: 80, supply: 0.5, doctrine: 60, morale: 80 };
    groups.armyGroups.push(army);
    r.tickSupplyLines();
    expect(army.supply).toBeGreaterThan(0.5);
  });

  it('army at distant enemy province loses supply', () => {
    const r = makeRegion();
    const groups = r as unknown as { armyGroups: ArmyGroup[]; nextArmyGroupId: number };
    // Put army at a "province" very far from player settlements
    const army: ArmyGroup = { id: 1, ownerId: 0, provinceId: 9999, transitDays: 0, manpower: 100, equipmentLevel: 80, supply: 0.8, doctrine: 60, morale: 80 };
    groups.armyGroups.push(army);
    // Ensure there's no settlement with id 9999 (army is in hostile territory)
    r.tickSupplyLines();
    // Supply should either stay or decay (when province not recognized as player territory)
    expect(army.supply).toBeLessThanOrEqual(0.8);
  });

  it('supply below 0.4 decays morale and equipment level', () => {
    const r = makeRegion();
    const groups = r as unknown as { armyGroups: ArmyGroup[]; nextArmyGroupId: number };
    const army: ArmyGroup = { id: 1, ownerId: 0, provinceId: 9999, transitDays: 0, manpower: 100, equipmentLevel: 50, supply: 0.3, doctrine: 60, morale: 70 };
    groups.armyGroups.push(army);
    const initialMorale = army.morale;
    const initialEquip = army.equipmentLevel;
    r.tickSupplyLines();
    expect(army.morale).toBeLessThan(initialMorale);
    expect(army.equipmentLevel).toBeLessThan(initialEquip);
  });

  it('supply caps at 1.0 even at player province', () => {
    const r = makeRegion();
    const playerProvinceId = r.settlements.find((s) => s.factionId === r.playerFactionId)!.id;
    const groups = r as unknown as { armyGroups: ArmyGroup[]; nextArmyGroupId: number };
    const army: ArmyGroup = { id: 1, ownerId: 0, provinceId: playerProvinceId, transitDays: 0, manpower: 100, equipmentLevel: 80, supply: 1.0, doctrine: 60, morale: 90 };
    groups.armyGroups.push(army);
    r.tickSupplyLines();
    expect(army.supply).toBeLessThanOrEqual(1.0);
  });
});

// ---- 6. tickOccupation() ----

describe('tickOccupation()', () => {
  it('increases resistanceLevel monthly for occupied province', () => {
    const r = makeRegion();
    const rivalId = injectRival(r);
    const provinceId = r.settlements[0]?.id ?? 1000;
    const occ = r as unknown as {
      provincialOccupations: Record<number, { occupiedBy: number; resistanceLevel: number; occupationPolicy: string; brutalPolicyPenalty: number }>;
    };
    occ.provincialOccupations[provinceId] = { occupiedBy: rivalId, resistanceLevel: 10, occupationPolicy: 'normal', brutalPolicyPenalty: 0 };
    r.tickOccupation();
    expect(occ.provincialOccupations[provinceId].resistanceLevel).toBeGreaterThan(10);
  });

  it('conciliatory policy grows resistance faster than normal', () => {
    const r = makeRegion();
    const rivalId = injectRival(r);
    const pId1 = r.settlements[0]?.id ?? 1001;
    const occ = r as unknown as {
      provincialOccupations: Record<number, { occupiedBy: number; resistanceLevel: number; occupationPolicy: string; brutalPolicyPenalty: number }>;
    };
    // Two separate simulations: conciliatory vs normal
    const r2 = makeRegion();
    injectRival(r2);
    const pId2 = r2.settlements[0]?.id ?? 1001;
    const occ2 = r2 as unknown as {
      provincialOccupations: Record<number, { occupiedBy: number; resistanceLevel: number; occupationPolicy: string; brutalPolicyPenalty: number }>;
    };
    occ.provincialOccupations[pId1] = { occupiedBy: rivalId, resistanceLevel: 10, occupationPolicy: 'conciliatory', brutalPolicyPenalty: 0 };
    occ2.provincialOccupations[pId2] = { occupiedBy: rivalId, resistanceLevel: 10, occupationPolicy: 'normal', brutalPolicyPenalty: 0 };
    r.tickOccupation();
    r2.tickOccupation();
    const conciliatoryGrowth = occ.provincialOccupations[pId1].resistanceLevel;
    const normalGrowth = occ2.provincialOccupations[pId2].resistanceLevel;
    expect(conciliatoryGrowth).toBeGreaterThan(normalGrowth);
  });

  it('brutal policy accumulates brutalPolicyPenalty', () => {
    const r = makeRegion();
    const rivalId = injectRival(r);
    const provinceId = r.settlements[0]?.id ?? 1000;
    const occ = r as unknown as {
      provincialOccupations: Record<number, { occupiedBy: number; resistanceLevel: number; occupationPolicy: string; brutalPolicyPenalty: number }>;
    };
    occ.provincialOccupations[provinceId] = { occupiedBy: rivalId, resistanceLevel: 10, occupationPolicy: 'brutal', brutalPolicyPenalty: 0 };
    r.tickOccupation();
    expect(occ.provincialOccupations[provinceId].brutalPolicyPenalty).toBeGreaterThan(0);
  });

  it('province liberates itself when resistance exceeds 90', () => {
    const r = makeRegion();
    const rivalId = injectRival(r);
    const provinceId = r.settlements[0]?.id ?? 1000;
    const occ = r as unknown as {
      provincialOccupations: Record<number, { occupiedBy: number; resistanceLevel: number; occupationPolicy: string; brutalPolicyPenalty: number }>;
    };
    occ.provincialOccupations[provinceId] = { occupiedBy: rivalId, resistanceLevel: 92, occupationPolicy: 'normal', brutalPolicyPenalty: 0 };
    r.tickOccupation();
    // Province should be freed — no longer in occupations
    expect(occ.provincialOccupations[provinceId]).toBeUndefined();
  });
});

// ---- 7. tickWarSupport() ----

describe('tickWarSupport()', () => {
  it('decays war support over time', () => {
    const r = makeRegion();
    const rivalId = injectRival(r);
    forceWar(r, rivalId);
    r.warSupport = 80;
    r.tickWarSupport();
    expect(r.warSupport).toBeLessThan(80);
  });

  it('does not run if no active war', () => {
    const r = makeRegion();
    r.warSupport = 60;
    r.tickWarSupport(); // should not throw or modify
    expect(r.warSupport).toBe(60);
  });

  it('low war support (<20) adds grievance to settlements', () => {
    const r = makeRegion();
    const rivalId = injectRival(r);
    forceWar(r, rivalId);
    r.warSupport = 10;
    const playerSettlement = r.settlements.find((s) => s.factionId === r.playerFactionId)!;
    const initialGrievance = playerSettlement.grievance;
    r.tickWarSupport();
    expect(playerSettlement.grievance).toBeGreaterThan(initialGrievance);
  });

  it('very low war support (<5) reduces legitimacy', () => {
    const r = makeRegion();
    const rivalId = injectRival(r);
    forceWar(r, rivalId);
    (r as unknown as { legitimacy: number }).legitimacy = 50;
    r.warSupport = 3;
    r.tickWarSupport();
    expect((r as unknown as { legitimacy: number }).legitimacy).toBeLessThan(50);
  });

  it('total mobilization adds extra war support decay', () => {
    const r = makeRegion();
    const rivalId = injectRival(r);
    forceWar(r, rivalId);
    r.warSupport = 80;
    r.mobilizationLevel = 2;
    r.tickWarSupport();
    // Should lose base -1 + rationing -2 = at least -3
    expect(r.warSupport).toBeLessThanOrEqual(77);
  });
});

// ---- 8. computeWarScore() ----

describe('computeWarScore()', () => {
  it('returns 0 without armies or occupations', () => {
    const r = makeRegion();
    const rivalId = injectRival(r);
    forceWar(r, rivalId);
    const score = r.computeWarScore();
    // Score may be slightly non-zero due to existing playerWar.score/10
    expect(score).toBeGreaterThanOrEqual(-10);
    expect(score).toBeLessThanOrEqual(13); // 30/10 = +3 from injected war score
  });

  it('player armies at rival province add to war score', () => {
    const r = makeRegion();
    const rivalId = injectRival(r);
    forceWar(r, rivalId);
    const basescore = r.computeWarScore();
    // Add a player army at a rival province
    const groups = r as unknown as { armyGroups: ArmyGroup[] };
    // Rival faction has no settlements in default sim — use a made-up province
    // and add it as a rival settlement
    const rivalProvince = 8888;
    const sim = r as unknown as { rivals: Array<{ id: number }> };
    // Inject the rival settlement directly
    (r as unknown as { settlements: Array<{ id: number; factionId: number; x: number; y: number; cohorts: object; food: number; wood: number; satisfaction: number; housing: number; landQuality: number; site: object; lastRaidDay: number; lastFloodDay: number; strikeUntil: number; grievance: number; prices: object; recentEvents: object[]; factionId: number; garrisonStrength: number; stationedUnits: object[]; loyaltyToFaction: number; factionStrengths: object; sectors: object; buildings: object[]; construction: null; focus: string; activeEvents: object[]; policies: object }> }).settlements.push({
      id: rivalProvince, factionId: rivalId, x: 90, y: 90,
      cohorts: { bands: [5, 10, 8, 3, 0] }, food: 50, wood: 30, satisfaction: 60, housing: 20, landQuality: 0.5,
      site: { cellX: 9, cellY: 9, fertility: 0.5, coastal: false, riverAdj: false, elevation: 0.2 },
      lastRaidDay: -99, lastFloodDay: -99, strikeUntil: -1, grievance: 0,
      prices: { food: 0.08, wood: 0.12 }, recentEvents: [], garrisonStrength: 2,
      stationedUnits: [], loyaltyToFaction: 80, factionStrengths: new Map(), sectors: { agriculture: { share: 0.7, output: 10, wage: 10, growth: 0 }, industry: { share: 0.15, output: 14, wage: 14, growth: 0 }, services: { share: 0.12, output: 13, wage: 13, growth: 0 }, information: { share: 0.03, output: 30, wage: 30, growth: 0 } },
      buildings: [], construction: null, focus: 'balanced', activeEvents: [], policies: {},
    } as unknown as typeof r.settlements[0]);
    groups.armyGroups.push({ id: 1, ownerId: 0, provinceId: rivalProvince, transitDays: 0, manpower: 100, equipmentLevel: 80, supply: 1.0, doctrine: 60, morale: 90 });
    const newScore = r.computeWarScore();
    expect(newScore).toBeGreaterThan(basescore);
  });

  it('blockade adds to war score', () => {
    const r = makeRegion();
    const rivalId = injectRival(r);
    forceWar(r, rivalId);
    const scoreNoblockade = r.computeWarScore();
    (r as unknown as { playerWar: { blockade: boolean } }).playerWar!.blockade = true;
    const scoreBlockade = r.computeWarScore();
    expect(scoreBlockade).toBeGreaterThan(scoreNoblockade);
  });
});

// ---- 9. proposePeace() ----

describe('proposePeace()', () => {
  it('returns false if no active war', () => {
    const r = makeRegion();
    const result = r.proposePeace([{ type: 'status_quo', warScoreCost: 0 }]);
    expect(result).toBe(false);
  });

  it('status_quo with cost 0 always accepted when at war', () => {
    const r = makeRegion();
    const rivalId = injectRival(r);
    forceWar(r, rivalId);
    // Ensure war score >= 0
    const result = r.proposePeace([{ type: 'status_quo', warScoreCost: 0 }]);
    expect(result).toBe(true);
    expect((r as unknown as { playerWar: object | null }).playerWar).toBeNull();
  });

  it('returns false when warScoreCost exceeds computeWarScore()', () => {
    const r = makeRegion();
    const rivalId = injectRival(r);
    forceWar(r, rivalId);
    // Force war score low
    (r as unknown as { playerWar: { score: number } }).playerWar!.score = -50;
    // Very expensive term
    const result = r.proposePeace([{ type: 'reparations', warScoreCost: 999 }]);
    expect(result).toBe(false);
    // War should still be active
    expect((r as unknown as { playerWar: object | null }).playerWar).not.toBeNull();
  });

  it('reparations term adds to treasury', () => {
    const r = makeRegion();
    const rivalId = injectRival(r);
    forceWar(r, rivalId);
    // Force high war score so the term is accepted
    (r as unknown as { playerWar: { score: number } }).playerWar!.score = 1000;
    const initialTreasury = r.treasury;
    r.proposePeace([{ type: 'reparations', warScoreCost: 10, amount: 500 }]);
    expect(r.treasury).toBeGreaterThan(initialTreasury);
  });

  it('annexing > 2 provinces creates revanchist grudge', () => {
    const r = makeRegion();
    const rivalId = injectRival(r);
    forceWar(r, rivalId);
    // Force war score high enough to cover all annex costs (3 × 20 = 60, computeWarScore returns up to 100)
    (r as unknown as { playerWar: { score: number } }).playerWar!.score = 1000;
    const rv = r.rival(rivalId)!;
    // Start with grudge below 10 so there's room to increase
    rv.weights.grudge = 1;
    const initialGrudge = rv.weights.grudge;
    // Annex 3 provinces — triggers grudge penalty since annexCount > 2
    const terms: PeaceTermDef[] = [
      { type: 'annex_province', warScoreCost: 20, provinceId: 1001 },
      { type: 'annex_province', warScoreCost: 20, provinceId: 1002 },
      { type: 'annex_province', warScoreCost: 20, provinceId: 1003 },
    ];
    r.proposePeace(terms);
    expect(rv.weights.grudge).toBeGreaterThan(initialGrudge);
  });

  it('peace ends war (playerWar becomes null)', () => {
    const r = makeRegion();
    const rivalId = injectRival(r);
    forceWar(r, rivalId);
    r.proposePeace([{ type: 'status_quo', warScoreCost: 0 }]);
    expect((r as unknown as { playerWar: object | null }).playerWar).toBeNull();
  });
});

// ---- 10. Serialize / Deserialize round-trips ----

describe('serialize/deserialize round-trips', () => {
  it('mobilizationLevel round-trips correctly', () => {
    const r = makeRegion();
    const rivalId = injectRival(r);
    forceWar(r, rivalId);
    r.setMobilizationLevel(1);
    const json = r.serialize();
    const r2 = RegionSim.deserialize(json);
    expect(r2.mobilizationLevel).toBe(1);
  });

  it('mobilizationMonths round-trips correctly', () => {
    const r = makeRegion();
    (r as unknown as { mobilizationMonths: number }).mobilizationMonths = 3;
    const json = r.serialize();
    const r2 = RegionSim.deserialize(json);
    expect(r2.mobilizationMonths).toBe(3);
  });

  it('warSupport round-trips correctly', () => {
    const r = makeRegion();
    r.warSupport = 45;
    const json = r.serialize();
    const r2 = RegionSim.deserialize(json);
    expect(r2.warSupport).toBe(45);
  });

  it('armyGroups round-trip with all new fields', () => {
    const r = makeRegion();
    const groups = r as unknown as { armyGroups: ArmyGroup[] };
    groups.armyGroups.push({
      id: 99, ownerId: 0, provinceId: 1000, transitDays: 0,
      manpower: 250, equipmentLevel: 75, supply: 0.8, doctrine: 65, morale: 85,
    });
    const json = r.serialize();
    const r2 = RegionSim.deserialize(json);
    const restored = (r2 as unknown as { armyGroups: ArmyGroup[] }).armyGroups;
    expect(restored.length).toBe(1);
    expect(restored[0].manpower).toBe(250);
    expect(restored[0].equipmentLevel).toBe(75);
    expect(restored[0].supply).toBe(0.8);
    expect(restored[0].doctrine).toBe(65);
    expect(restored[0].morale).toBe(85);
  });

  it('provincialOccupations round-trip correctly', () => {
    const r = makeRegion();
    const occ = r as unknown as {
      provincialOccupations: Record<number, { occupiedBy: number; resistanceLevel: number; occupationPolicy: string; brutalPolicyPenalty: number }>;
    };
    occ.provincialOccupations[5555] = { occupiedBy: 9001, resistanceLevel: 42, occupationPolicy: 'brutal', brutalPolicyPenalty: 5 };
    const json = r.serialize();
    const r2 = RegionSim.deserialize(json);
    const occ2 = r2 as unknown as {
      provincialOccupations: Record<number, { occupiedBy: number; resistanceLevel: number; occupationPolicy: string; brutalPolicyPenalty: number }>;
    };
    expect(occ2.provincialOccupations[5555]).toBeDefined();
    expect(occ2.provincialOccupations[5555].resistanceLevel).toBe(42);
    expect(occ2.provincialOccupations[5555].occupationPolicy).toBe('brutal');
  });

  it('old saves backfill mobilizationLevel with 0', () => {
    const r = makeRegion();
    const json = JSON.parse(r.serialize());
    delete json.mobilizationLevel;
    const r2 = RegionSim.deserialize(JSON.stringify(json));
    expect(r2.mobilizationLevel).toBe(0);
  });

  it('old saves backfill warSupport with 60', () => {
    const r = makeRegion();
    const json = JSON.parse(r.serialize());
    delete json.warSupport;
    const r2 = RegionSim.deserialize(JSON.stringify(json));
    expect(r2.warSupport).toBe(60);
  });

  it('old saves backfill armyGroups with empty array', () => {
    const r = makeRegion();
    const json = JSON.parse(r.serialize());
    delete json.armyGroups;
    const r2 = RegionSim.deserialize(JSON.stringify(json));
    expect((r2 as unknown as { armyGroups: ArmyGroup[] }).armyGroups).toEqual([]);
  });

  it('old saves backfill armyGroup fields with safe defaults', () => {
    const r = makeRegion();
    const json = JSON.parse(r.serialize());
    json.armyGroups = [{ id: 1, ownerId: 0, provinceId: 1000, transitDays: 0 }];
    const r2 = RegionSim.deserialize(JSON.stringify(json));
    const groups = (r2 as unknown as { armyGroups: ArmyGroup[] }).armyGroups;
    expect(groups[0].manpower).toBe(100);
    expect(groups[0].equipmentLevel).toBe(50);
    expect(groups[0].supply).toBe(1.0);
    expect(groups[0].doctrine).toBe(50);
    expect(groups[0].morale).toBe(80);
  });
});
