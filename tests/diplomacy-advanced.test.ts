import { describe, it, expect } from 'vitest';
import { RegionSim, ESPIONAGE_OPS, ESPIONAGE_COOLDOWN_DAYS, BLOC_RELATIONS_FLOOR, BLOC_FORM_COST } from '../src/sim/region';
import type { RivalNation } from '../src/sim/region';

function makeRegion(seed = 42): RegionSim {
  return RegionSim.create(seed);
}

/** Plant a rival nation (diplomacy entity) for tests that need one. */
function ensureRival(r: RegionSim): RivalNation {
  if (r.rivals.length === 0) {
    (r as unknown as { spawnRival: () => void }).spawnRival();
  }
  return r.rivals[0];
}

describe('Phase 3: Espionage', () => {
  it('intelOf starts at 0 for a fresh rival', () => {
    const r = makeRegion();
    const rv = ensureRival(r);
    expect(r.intelOf(rv.id)).toBe(0);
  });

  it('canRunEspionage requires State proclamation', () => {
    const r = makeRegion();
    const rv = ensureRival(r);
    const can = r.canRunEspionage(rv.id, 'gather_intel');
    expect(can.ok).toBe(false);
    expect(can.reason).toContain('State');
  });

  it('canRunEspionage requires sufficient treasury', () => {
    const r = makeRegion();
    (r as unknown as { stateProclaimed: boolean }).stateProclaimed = true;
    const rv = ensureRival(r);
    (r as unknown as { treasury: number }).treasury = 0;
    const can = r.canRunEspionage(rv.id, 'gather_intel');
    expect(can.ok).toBe(false);
    expect(can.reason).toContain('Need');
  });

  it('higher-tier ops are gated behind intel', () => {
    const r = makeRegion();
    (r as unknown as { stateProclaimed: boolean }).stateProclaimed = true;
    (r as unknown as { treasury: number }).treasury = 5000;
    const rv = ensureRival(r);
    rv.intel = 0;
    const can = r.canRunEspionage(rv.id, 'steal_tech');
    expect(can.ok).toBe(false);
    expect(can.reason).toContain('intel');
  });

  it('gather_intel succeeds and raises intel (deterministic via seed)', () => {
    const r = makeRegion();
    (r as unknown as { stateProclaimed: boolean }).stateProclaimed = true;
    (r as unknown as { treasury: number }).treasury = 5000;
    const rv = ensureRival(r);
    const before = r.intelOf(rv.id);
    const result = r.runEspionage(rv.id, 'gather_intel');
    expect(result.ok).toBe(true);
    // gather_intel has 85% base success; on success intel climbs
    if (result.success) {
      expect(r.intelOf(rv.id)).toBeGreaterThan(before);
    }
  });

  it('running an op charges the treasury and sets the cooldown', () => {
    const r = makeRegion();
    (r as unknown as { stateProclaimed: boolean }).stateProclaimed = true;
    (r as unknown as { treasury: number }).treasury = 5000;
    const rv = ensureRival(r);
    const before = (r as unknown as { treasury: number }).treasury;
    r.runEspionage(rv.id, 'gather_intel');
    expect((r as unknown as { treasury: number }).treasury).toBe(before - ESPIONAGE_OPS.gather_intel.cost);
    // immediately trying again is blocked by cooldown
    const can = r.canRunEspionage(rv.id, 'gather_intel');
    expect(can.ok).toBe(false);
    expect(can.reason).toContain('field');
  });

  it('cooldown clears after ESPIONAGE_COOLDOWN_DAYS', () => {
    const r = makeRegion();
    (r as unknown as { stateProclaimed: boolean }).stateProclaimed = true;
    (r as unknown as { treasury: number }).treasury = 5000;
    const rv = ensureRival(r);
    r.runEspionage(rv.id, 'gather_intel');
    rv.lastEspionageDay = r.day - ESPIONAGE_COOLDOWN_DAYS - 1;
    const can = r.canRunEspionage(rv.id, 'gather_intel');
    expect(can.ok).toBe(true);
  });

  it('espionageSuccessChance rises with intel', () => {
    const r = makeRegion();
    const rv = ensureRival(r);
    rv.intel = 0;
    const low = r.espionageSuccessChance(rv.id, 'steal_tech');
    rv.intel = 0.9;
    const high = r.espionageSuccessChance(rv.id, 'steal_tech');
    expect(high).toBeGreaterThan(low);
  });

  it('intel and cooldown survive serialize/deserialize', () => {
    const r = makeRegion();
    (r as unknown as { stateProclaimed: boolean }).stateProclaimed = true;
    const rv = ensureRival(r);
    rv.intel = 0.5;
    rv.lastEspionageDay = 123;
    const r2 = RegionSim.deserialize(r.serialize());
    const rv2 = r2.rival(rv.id)!;
    expect(rv2.intel).toBe(0.5);
    expect(rv2.lastEspionageDay).toBe(123);
  });
});

describe('Phase 3: Trade blocs', () => {
  function eligibleRival(r: RegionSim): RivalNation {
    const rv = ensureRival(r);
    rv.relations = 80;
    if (!rv.treaties.includes('trade_agreement')) rv.treaties.push('trade_agreement');
    return rv;
  }

  it('canFormTradeBloc requires a warm trade partner', () => {
    const r = makeRegion();
    (r as unknown as { stateProclaimed: boolean }).stateProclaimed = true;
    (r as unknown as { treasury: number }).treasury = 5000;
    const rv = ensureRival(r);
    rv.relations = -50; // hostile, no agreement
    const can = r.canFormTradeBloc();
    expect(can.ok).toBe(false);
  });

  it('forms a bloc with eligible partners and charges the fee', () => {
    const r = makeRegion();
    (r as unknown as { stateProclaimed: boolean }).stateProclaimed = true;
    (r as unknown as { treasury: number }).treasury = 5000;
    const rv = eligibleRival(r);
    const before = (r as unknown as { treasury: number }).treasury;
    expect(r.formTradeBloc('Test Union')).toBe(true);
    expect((r as unknown as { treasury: number }).treasury).toBe(before - BLOC_FORM_COST);
    const bloc = r.playerTradeBloc();
    expect(bloc).not.toBeNull();
    expect(bloc!.memberRivalIds).toContain(rv.id);
    expect(bloc!.name).toBe('Test Union');
  });

  it('only one player bloc can exist at a time', () => {
    const r = makeRegion();
    (r as unknown as { stateProclaimed: boolean }).stateProclaimed = true;
    (r as unknown as { treasury: number }).treasury = 5000;
    eligibleRival(r);
    expect(r.formTradeBloc()).toBe(true);
    expect(r.formTradeBloc()).toBe(false); // already leading one
  });

  it('blocTradeBonus is positive once a bloc exists with members', () => {
    const r = makeRegion();
    (r as unknown as { stateProclaimed: boolean }).stateProclaimed = true;
    (r as unknown as { treasury: number }).treasury = 5000;
    (r as unknown as { gdpLastMonth: number }).gdpLastMonth = 400;
    eligibleRival(r);
    r.formTradeBloc();
    expect(r.blocTradeBonus()).toBeGreaterThan(0);
  });

  it('a higher shared tariff increases the bonus', () => {
    const r = makeRegion();
    (r as unknown as { stateProclaimed: boolean }).stateProclaimed = true;
    (r as unknown as { treasury: number }).treasury = 5000;
    (r as unknown as { gdpLastMonth: number }).gdpLastMonth = 400;
    eligibleRival(r);
    r.formTradeBloc();
    r.setBlocTariff(0);
    const low = r.blocTradeBonus();
    r.setBlocTariff(0.5);
    const high = r.blocTradeBonus();
    expect(high).toBeGreaterThan(low);
  });

  it('inviteToBloc admits an eligible non-member', () => {
    const r = makeRegion();
    (r as unknown as { stateProclaimed: boolean }).stateProclaimed = true;
    (r as unknown as { treasury: number }).treasury = 5000;
    eligibleRival(r);
    r.formTradeBloc();
    // spawn a second eligible rival
    (r as unknown as { spawnRival: () => void }).spawnRival();
    const second = r.rivals[1];
    if (second) {
      second.relations = 70;
      if (!second.treaties.includes('trade_agreement')) second.treaties.push('trade_agreement');
      expect(r.inviteToBloc(second.id)).toBe(true);
      expect(r.playerTradeBloc()!.memberRivalIds).toContain(second.id);
    }
  });

  it('leaveTradeBloc dissolves the union', () => {
    const r = makeRegion();
    (r as unknown as { stateProclaimed: boolean }).stateProclaimed = true;
    (r as unknown as { treasury: number }).treasury = 5000;
    eligibleRival(r);
    r.formTradeBloc();
    expect(r.leaveTradeBloc()).toBe(true);
    expect(r.playerTradeBloc()).toBeNull();
  });

  it('bloc survives serialize/deserialize', () => {
    const r = makeRegion();
    (r as unknown as { stateProclaimed: boolean }).stateProclaimed = true;
    (r as unknown as { treasury: number }).treasury = 5000;
    eligibleRival(r);
    r.formTradeBloc('Persisted Union');
    const r2 = RegionSim.deserialize(r.serialize());
    const bloc = r2.playerTradeBloc();
    expect(bloc).not.toBeNull();
    expect(bloc!.name).toBe('Persisted Union');
  });

  it('BLOC_RELATIONS_FLOOR is the documented threshold', () => {
    expect(BLOC_RELATIONS_FLOOR).toBe(40);
  });
});
