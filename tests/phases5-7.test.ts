import { describe, it, expect } from 'vitest';
import {
  RegionSim,
  DEFAULT_PROVINCE_POLICY,
} from '../src/sim/region';
import type { RivalNation } from '../src/sim/region';

function makeRegion(seed = 42): RegionSim {
  return RegionSim.create(seed);
}

function ensureRival(r: RegionSim): RivalNation {
  if (r.rivals.length === 0) {
    (r as unknown as { spawnRival: () => void }).spawnRival();
  }
  return r.rivals[0];
}

function proclaimState(r: RegionSim): void {
  r.stateProclaimed = true;
  r.treasury = 5000;
}

// ---- Phase 5: Province governance ----

describe('Phase 5: Province governance', () => {
  it('getProvincePolicy returns defaults for an uninitialised province', () => {
    const r = makeRegion();
    const s = r.settlements[0];
    const pol = r.getProvincePolicy(s.id);
    expect(pol.taxMultiplier).toBe(DEFAULT_PROVINCE_POLICY.taxMultiplier);
    expect(pol.investmentLevel).toBe(DEFAULT_PROVINCE_POLICY.investmentLevel);
    expect(pol.autonomyLevel).toBe(DEFAULT_PROVINCE_POLICY.autonomyLevel);
  });

  it('setProvincePolicy rejects changes before State proclamation', () => {
    const r = makeRegion();
    const s = r.settlements[0];
    const ok = r.setProvincePolicy(s.id, { taxMultiplier: 1.5 });
    expect(ok).toBe(false);
  });

  it('setProvincePolicy accepts changes for player provinces after State', () => {
    const r = makeRegion();
    proclaimState(r);
    const s = r.settlements.find((x) => x.factionId === r.playerFactionId);
    expect(s).toBeDefined();
    const ok = r.setProvincePolicy(s!.id, { taxMultiplier: 1.5 });
    expect(ok).toBe(true);
    expect(r.getProvincePolicy(s!.id).taxMultiplier).toBeCloseTo(1.5);
  });

  it('taxMultiplier is clamped to 0.5..2.0', () => {
    const r = makeRegion();
    proclaimState(r);
    const s = r.settlements.find((x) => x.factionId === r.playerFactionId)!;
    r.setProvincePolicy(s.id, { taxMultiplier: 5.0 });
    expect(r.getProvincePolicy(s.id).taxMultiplier).toBe(2.0);
    r.setProvincePolicy(s.id, { taxMultiplier: 0.1 });
    expect(r.getProvincePolicy(s.id).taxMultiplier).toBe(0.5);
  });

  it('investmentLevel is clamped to 0..2', () => {
    const r = makeRegion();
    proclaimState(r);
    const s = r.settlements.find((x) => x.factionId === r.playerFactionId)!;
    r.setProvincePolicy(s.id, { investmentLevel: 99 });
    expect(r.getProvincePolicy(s.id).investmentLevel).toBe(2);
  });

  it('autonomyLevel is clamped to 0..2', () => {
    const r = makeRegion();
    proclaimState(r);
    const s = r.settlements.find((x) => x.factionId === r.playerFactionId)!;
    r.setProvincePolicy(s.id, { autonomyLevel: -1 });
    expect(r.getProvincePolicy(s.id).autonomyLevel).toBe(0);
  });

  it('province policies round-trip through serialize/deserialize', () => {
    const r = makeRegion();
    proclaimState(r);
    const s = r.settlements.find((x) => x.factionId === r.playerFactionId)!;
    r.setProvincePolicy(s.id, { taxMultiplier: 1.5, investmentLevel: 2, autonomyLevel: 1 });
    const r2 = RegionSim.deserialize(r.serialize());
    const pol = r2.getProvincePolicy(s.id);
    expect(pol.taxMultiplier).toBeCloseTo(1.5);
    expect(pol.investmentLevel).toBe(2);
    expect(pol.autonomyLevel).toBe(1);
  });
});

// ---- Phase 6: Rival espionage (AI-side) ----

describe('Phase 6: Rival espionage', () => {
  it('rivals have no operations pending at start', () => {
    const r = makeRegion();
    const rv = ensureRival(r);
    // lastEspionageDay is undefined at spawn
    expect(rv.lastEspionageDay).toBeUndefined();
  });

  it('rival espionage tick is gated behind State proclamation', () => {
    const r = makeRegion();
    const rv = ensureRival(r);
    rv.relations = -50; // hostile
    const treasuryBefore = r.treasury;
    // Tick 100 months without state proclaimed
    for (let i = 0; i < 100; i++) {
      (r as unknown as { tickRivalEspionage: () => void }).tickRivalEspionage?.();
    }
    // Treasury should be unchanged (gate blocks ops without State)
    expect(r.treasury).toBe(treasuryBefore);
  });
});

// ---- Phase 6: AI trade blocs ----

describe('Phase 6: AI rival trade blocs', () => {
  it('rivalTradeBlocs starts empty', () => {
    const r = makeRegion();
    expect(r.rivalTradeBlocs).toHaveLength(0);
  });

  it('rival blocs persist through serialize/deserialize', () => {
    const r = makeRegion();
    r.rivalTradeBlocs.push({ id: 1, memberRivalIds: [10, 11], foundedYear: 1920, tariff: 0.15 });
    const r2 = RegionSim.deserialize(r.serialize());
    expect(r2.rivalTradeBlocs).toHaveLength(1);
    expect(r2.rivalTradeBlocs[0].tariff).toBeCloseTo(0.15);
  });

  it('rivalBlocTariffFriction is 0 with no blocs', () => {
    const r = makeRegion();
    expect(r.rivalBlocTariffFriction()).toBe(0);
  });

  it('rivalBlocTariffFriction is non-zero when a rival bloc has a trade member', () => {
    const r = makeRegion();
    proclaimState(r);
    const rv = ensureRival(r);
    rv.treaties.push('trade_agreement');
    r.rivalTradeBlocs.push({ id: 1, memberRivalIds: [rv.id], foundedYear: 1920, tariff: 0.2 });
    expect(r.rivalBlocTariffFriction()).toBeGreaterThan(0);
  });

  it('rivalBlocTariffFriction caps at 0.3', () => {
    const r = makeRegion();
    proclaimState(r);
    const rv = ensureRival(r);
    rv.treaties.push('trade_agreement');
    // High-tariff bloc
    r.rivalTradeBlocs.push({ id: 1, memberRivalIds: [rv.id], foundedYear: 1920, tariff: 0.5 });
    expect(r.rivalBlocTariffFriction()).toBeLessThanOrEqual(0.3);
  });
});

// ---- Phase 6: Economic sanctions ----

describe('Phase 6: Economic sanctions', () => {
  it('activeSanctions returns empty at start', () => {
    const r = makeRegion();
    expect(r.activeSanctions()).toHaveLength(0);
  });

  it('imposeSanction requires State proclamation', () => {
    const r = makeRegion();
    const rv = ensureRival(r);
    const result = r.imposeSanction(rv.id);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('State');
  });

  it('imposeSanction creates an active sanction', () => {
    const r = makeRegion();
    proclaimState(r);
    const rv = ensureRival(r);
    rv.relations = -40;
    const result = r.imposeSanction(rv.id);
    expect(result.ok).toBe(true);
    const active = r.activeSanctions();
    expect(active.some((s) => s.targetId === rv.id && s.imposerId === 0)).toBe(true);
  });

  it('imposeSanction reduces rival relations', () => {
    const r = makeRegion();
    proclaimState(r);
    const rv = ensureRival(r);
    rv.relations = -20;
    const relBefore = rv.relations;
    r.imposeSanction(rv.id);
    expect(rv.relations).toBeLessThan(relBefore);
  });

  it('cannot impose duplicate sanctions on the same rival', () => {
    const r = makeRegion();
    proclaimState(r);
    const rv = ensureRival(r);
    r.imposeSanction(rv.id);
    const second = r.imposeSanction(rv.id);
    expect(second.ok).toBe(false);
    expect(second.reason).toContain('already');
  });

  it('liftSanction removes the sanction and gives a relations boost', () => {
    const r = makeRegion();
    proclaimState(r);
    const rv = ensureRival(r);
    r.imposeSanction(rv.id);
    const relAfterImpose = rv.relations;
    const lifted = r.liftSanction(rv.id);
    expect(lifted).toBe(true);
    expect(r.activeSanctions().some((s) => s.targetId === rv.id && s.imposerId === 0)).toBe(false);
    expect(rv.relations).toBeGreaterThan(relAfterImpose);
  });

  it('sanctionPressureOnPlayer is 0 with no sanctions against player', () => {
    const r = makeRegion();
    expect(r.sanctionPressureOnPlayer()).toBe(0);
  });

  it('sanctionPressureOnPlayer accumulates rival-imposed sanctions', () => {
    const r = makeRegion();
    const rv = ensureRival(r);
    r.sanctions.push({ imposerId: rv.id, targetId: 0, startDay: r.day, untilDay: r.day + 365, tradeReduction: 0.25 });
    expect(r.sanctionPressureOnPlayer()).toBeCloseTo(0.25);
  });

  it('sanctionPressureOnPlayer caps at 0.5', () => {
    const r = makeRegion();
    const rv = ensureRival(r);
    // Stack several sanctions
    for (let i = 0; i < 5; i++) {
      r.sanctions.push({ imposerId: rv.id + i, targetId: 0, startDay: r.day, untilDay: r.day + 365, tradeReduction: 0.3 });
    }
    expect(r.sanctionPressureOnPlayer()).toBeLessThanOrEqual(0.5);
  });

  it('sanctions persist through serialize/deserialize', () => {
    const r = makeRegion();
    proclaimState(r);
    const rv = ensureRival(r);
    r.imposeSanction(rv.id);
    const r2 = RegionSim.deserialize(r.serialize());
    expect(r2.activeSanctions().some((s) => s.targetId === rv.id && s.imposerId === 0)).toBe(true);
  });
});

// ---- Phase 7: Provincial army movement ----

describe('Phase 7: Provincial army movement', () => {
  it('provincialArmies starts empty', () => {
    const r = makeRegion();
    expect(r.provincialArmies).toHaveLength(0);
  });

  it('armiesAt returns empty when no armies exist', () => {
    const r = makeRegion();
    expect(r.armiesAt(1)).toHaveLength(0);
  });

  it('deployArmy requires State proclamation', () => {
    const r = makeRegion();
    const s = r.settlements[0];
    const result = r.deployArmy(s.id, s.id + 1, 'militia', 3);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('State');
  });

  it('deployArmy from a non-player province is rejected', () => {
    const r = makeRegion();
    proclaimState(r);
    const s = r.settlements.find((x) => x.factionId !== r.playerFactionId);
    if (!s) return; // skip if all settlements are player-owned
    const target = r.settlements.find((x) => x.id !== s.id)!;
    const result = r.deployArmy(s.id, target.id, 'militia', 1);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('Not your province');
  });

  it('deployArmy with garrisoned militia creates a moving army', () => {
    const r = makeRegion();
    proclaimState(r);
    const from = r.settlements.find((s) => s.factionId === r.playerFactionId)!;
    const to = r.settlements.find((s) => s.id !== from.id) ?? from;
    // Ensure garrison is high enough to detach militia
    from.garrisonStrength = 20;
    const result = r.deployArmy(from.id, to.id, 'militia', 3);
    expect(result.ok).toBe(true);
    expect(r.provincialArmies).toHaveLength(1);
    expect(r.provincialArmies[0].destinationId).toBe(to.id);
    expect(r.provincialArmies[0].ownerId).toBe(0);
  });

  it('cancelArmyMovement halts a moving army', () => {
    const r = makeRegion();
    proclaimState(r);
    const from = r.settlements.find((s) => s.factionId === r.playerFactionId)!;
    const to = r.settlements.find((s) => s.id !== from.id) ?? from;
    from.garrisonStrength = 20;
    r.deployArmy(from.id, to.id, 'militia', 3);
    const army = r.provincialArmies[0];
    expect(army.destinationId).not.toBeNull();
    const cancelled = r.cancelArmyMovement(army.id);
    expect(cancelled).toBe(true);
    expect(army.destinationId).toBeNull();
    expect(army.transitDays).toBe(0);
  });

  it('provincial armies persist through serialize/deserialize', () => {
    const r = makeRegion();
    r.provincialArmies.push({
      id: 1, ownerId: 0, provinceId: 100, destinationId: 200,
      transitDays: 7, units: [{ type: 'militia', count: 5, morale: 90, suppliedDays: 60 }], supply: 2,
    });
    const r2 = RegionSim.deserialize(r.serialize());
    expect(r2.provincialArmies).toHaveLength(1);
    expect(r2.provincialArmies[0].units[0].count).toBe(5);
    expect(r2.provincialArmies[0].transitDays).toBe(7);
  });
});
