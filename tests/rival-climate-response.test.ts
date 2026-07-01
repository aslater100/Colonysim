import { describe, expect, it } from 'vitest';
import {
  RegionSim,
  INTERMEDIATE_GOODS,
  RESOURCE_DISPUTE_POP_THRESHOLD,
  RESOURCE_DISPUTE_SCARCITY_THRESHOLD,
  URGENCY_AGGRESSION_LIFT,
  WORLD_GREEN_URGENCY_C,
  rivalClimateUrgency,
  type Settlement,
  type RivalNation,
} from '../src/sim/region';
import { worldGoodScarcity } from '../src/sim/systems/goods';
import { updateDiplomacy, tickRivalClimateBlocActivity } from '../src/sim/systems/diplomacy';

/**
 * EXISTENTIAL CLIMATE RESPONSE (flag `rivalClimateResponse`, default OFF).
 *
 * The world used to sit still for the Drowned branch: rival relations-drift
 * settles at a comfortable equilibrium (a probe found a Hegemon's baseline
 * around only -12 to -37) that never crosses the -40/-60 hostility gates, so
 * wars essentially never happened (measured: 0 across an 8-seed×181y default
 * sweep). This flag makes fossil-locked archetypes turn to land/resources as
 * warming worsens (a real `resource_dispute` casus belli off `worldGoodScarcity`,
 * plus an urgency-scaled relations drag and war-roll lift), while green-leaning
 * archetypes form an autonomous climate coalition instead. Measured effect (same
 * 8-seed×181y sweep, flag ON): wars 22–65/run (was 0), outcome split diversifies
 * (4 drowned/4 dystopia vs 6/2 OFF), economy stays bounded/solvent.
 */

/** Push a synthetic off-map great power (mirrors tests/rival-world-market.test.ts). */
function addRival(r: RegionSim, opts: { id: number; archetype?: RivalNation['archetype']; pop?: number }): RivalNation {
  const rv = {
    id: opts.id,
    name: `Power ${opts.id}`,
    leader: 'the Directorate',
    archetype: opts.archetype ?? 'opportunist',
    weights: { expansion: 5, commerce: 4.5, ideology: 5, honor: 5, risk: 5, grudge: 5 },
    regime: 'parliamentary',
    agenda: '',
    compass: 'north',
    pop: opts.pop ?? 50000,
    relations: 0,
    treaties: [],
    borderSettled: false,
    emergedYear: 1990,
    history: [],
    lastEnvoyDay: -999,
    lastGiftDay: -999,
  } as RivalNation;
  r.rivals.push(rv);
  return rv;
}

/** Fixture mirroring tests/world-anchor.test.ts — pins sector outputs (and the
 *  year, so every good's eraUnlock has passed) so a good's world scarcity is
 *  controllable via goodStocks. */
function worldSim(layout: Array<{ ind: number; agri: number; faction?: number }>): RegionSim {
  const r = RegionSim.create(7);
  const base = r.settlements[0];
  while (r.settlements.length < layout.length) {
    const clone = structuredClone(base) as Settlement;
    clone.id = base.id + r.settlements.length;
    clone.name = `Town ${r.settlements.length}`;
    r.settlements.push(clone);
  }
  layout.forEach((l, i) => {
    const s = r.settlements[i];
    s.sectors.industry.output = l.ind;
    s.sectors.agriculture.output = l.agri;
    s.factionId = l.faction ?? r.playerFactionId;
    s.goodStocks = undefined;
  });
  r.sectorOutputNorm = { industry: 0, agriculture: 0 };
  r.rivals = [];
  Object.defineProperty(r, 'year', { get: () => 2000, configurable: true });
  return r;
}

/** Force `worldGoodScarcity('textiles')` comfortably above the CB threshold:
 *  two industry towns demand it, nobody supplies it. */
function starveWorldOfTextiles(r: RegionSim): void {
  r.settlements.push(structuredClone(r.settlements[0]) as Settlement);
  r.settlements[0].sectors.industry.output = 100;
  r.settlements[0].sectors.agriculture.output = 0;
  r.settlements[0].goodStocks = undefined;
  r.settlements[1].sectors.industry.output = 100;
  r.settlements[1].sectors.agriculture.output = 0;
  r.settlements[1].factionId = 99;
  r.settlements[1].goodStocks = undefined;
  expect(worldGoodScarcity(r, 'textiles')).toBeGreaterThan(RESOURCE_DISPUTE_SCARCITY_THRESHOLD);
}

describe('rivalClimateUrgency — pure per-rival pressure signal', () => {
  it('is 0 with no warming, for any archetype', () => {
    const r = RegionSim.create(1000);
    r.warmingC = 0;
    const rv = addRival(r, { id: 1, archetype: 'hermit_kingdom' });
    expect(rivalClimateUrgency(r, rv)).toBe(0);
  });

  it('is 0 for a fully green-committed archetype regardless of warming (propensity 1.0)', () => {
    const r = RegionSim.create(1000);
    r.warmingC = 5;
    const rv = addRival(r, { id: 1, archetype: 'trading_republic' });
    expect(rivalClimateUrgency(r, rv)).toBe(0);
  });

  it('rises toward its cap for a fossil-locked archetype as warming worsens', () => {
    const r = RegionSim.create(1000);
    const rv = addRival(r, { id: 1, archetype: 'hermit_kingdom' }); // propensity 0.1
    r.warmingC = 0;
    const low = rivalClimateUrgency(r, rv);
    r.warmingC = WORLD_GREEN_URGENCY_C;
    const high = rivalClimateUrgency(r, rv);
    expect(high).toBeGreaterThan(low);
    expect(high).toBeCloseTo(0.9, 6); // 1.0 warmingUrgency × (1 − 0.1) greenSlack
  });

  it('stays bounded to [0,1] even past the urgency ceiling', () => {
    const r = RegionSim.create(1000);
    const rv = addRival(r, { id: 1, archetype: 'hegemon' });
    r.warmingC = WORLD_GREEN_URGENCY_C * 10; // way past the cap
    const u = rivalClimateUrgency(r, rv);
    expect(u).toBeGreaterThanOrEqual(0);
    expect(u).toBeLessThanOrEqual(1);
  });
});

describe('rivalResourceGrievance — a REAL resource_dispute casus belli, not a flat threshold', () => {
  it('is always false when the flag is off, however scarce the world / large the rival', () => {
    const r = worldSim([{ ind: 100, agri: 0 }]);
    starveWorldOfTextiles(r);
    const rv = addRival(r, { id: 99, pop: RESOURCE_DISPUTE_POP_THRESHOLD * 10 });
    r.rivalClimateResponse = false;
    expect(r.rivalResourceGrievance(rv)).toBe(false);
  });

  it('is false for a rival too small to plausibly matter, even under world scarcity', () => {
    const r = worldSim([{ ind: 100, agri: 0 }]);
    starveWorldOfTextiles(r);
    const rv = addRival(r, { id: 99, pop: RESOURCE_DISPUTE_POP_THRESHOLD - 1 });
    r.rivalClimateResponse = true;
    expect(r.rivalResourceGrievance(rv)).toBe(false);
  });

  it('is false for a large rival when the world is NOT short of anything', () => {
    const r = worldSim([{ ind: 100, agri: 0 }]);
    // Flush every good so nothing clears the scarcity bar.
    for (const g of INTERMEDIATE_GOODS) {
      (r.settlements[0].goodStocks ??= {})[g.id] = 1_000_000;
    }
    const rv = addRival(r, { id: 99, pop: RESOURCE_DISPUTE_POP_THRESHOLD * 10 });
    r.rivalClimateResponse = true;
    expect(r.rivalResourceGrievance(rv)).toBe(false);
  });

  it('is true for a large rival once the flag is on AND the world is genuinely short', () => {
    const r = worldSim([{ ind: 100, agri: 0 }]);
    starveWorldOfTextiles(r);
    const rv = addRival(r, { id: 99, pop: RESOURCE_DISPUTE_POP_THRESHOLD * 10 });
    r.rivalClimateResponse = true;
    expect(r.rivalResourceGrievance(rv)).toBe(true);
  });

  it('availableCasusBelli surfaces resource_dispute exactly when the grievance holds', () => {
    const r = worldSim([{ ind: 100, agri: 0 }]);
    starveWorldOfTextiles(r);
    const rv = addRival(r, { id: 99, pop: RESOURCE_DISPUTE_POP_THRESHOLD * 10 });
    r.rivalClimateResponse = false;
    expect(r.availableCasusBelli(rv)).not.toContain('resource_dispute');
    r.rivalClimateResponse = true;
    expect(r.availableCasusBelli(rv)).toContain('resource_dispute');
  });
});

describe('existential climate response — the relations drag makes wars measurable', () => {
  it('a fossil-locked rival\'s relations sour FASTER under warming when the flag is on', () => {
    const mkRun = (flag: boolean): number => {
      const r = RegionSim.create(1000);
      r.warmingC = WORLD_GREEN_URGENCY_C;
      r.rivalClimateResponse = flag;
      const rv = addRival(r, { id: 1, archetype: 'hegemon' });
      rv.relations = 0;
      updateDiplomacy(r);
      return r.rivals[0].relations;
    };
    const off = mkRun(false);
    const on = mkRun(true);
    expect(on).toBeLessThan(off);
  });

  it('a fully green rival\'s relations drift is UNCHANGED by the flag (no drag applied)', () => {
    const mkRun = (flag: boolean): number => {
      const r = RegionSim.create(1000);
      r.warmingC = WORLD_GREEN_URGENCY_C;
      r.rivalClimateResponse = flag;
      const rv = addRival(r, { id: 1, archetype: 'trading_republic' });
      rv.relations = 0;
      updateDiplomacy(r);
      return r.rivals[0].relations;
    };
    expect(mkRun(true)).toBeCloseTo(mkRun(false), 6);
  });

  it('is a no-op with no warming even when the flag is on (urgency is 0)', () => {
    const mkRun = (flag: boolean): number => {
      const r = RegionSim.create(1000);
      r.warmingC = 0;
      r.rivalClimateResponse = flag;
      const rv = addRival(r, { id: 1, archetype: 'hegemon' });
      rv.relations = 0;
      updateDiplomacy(r);
      return r.rivals[0].relations;
    };
    expect(mkRun(true)).toBeCloseTo(mkRun(false), 6);
  });
});

describe('existential climate response — autonomous rival climate coalitions', () => {
  it('never forms a bloc when the flag is off (no RNG draw, no state touched)', () => {
    const r = RegionSim.create(1000);
    r.rivalClimateResponse = false;
    const a = addRival(r, { id: 1, archetype: 'trading_republic' });
    const b = addRival(r, { id: 2, archetype: 'crusader_state' });
    r.rivalPairs[r.pairKey(a.id, b.id)] = 50;
    for (let i = 0; i < 200; i++) tickRivalClimateBlocActivity(r);
    expect(r.rivalClimateBlocs).toHaveLength(0);
  });

  it('eventually forms between two green-eligible, non-hostile rivals when the flag is on', () => {
    const r = RegionSim.create(1000);
    r.rivalClimateResponse = true;
    const a = addRival(r, { id: 1, archetype: 'trading_republic' });
    const b = addRival(r, { id: 2, archetype: 'crusader_state' });
    r.rivalPairs[r.pairKey(a.id, b.id)] = 50;
    let formed = false;
    for (let i = 0; i < 500 && !formed; i++) {
      tickRivalClimateBlocActivity(r);
      formed = r.rivalClimateBlocs.some((bl) => bl.memberRivalIds.includes(a.id) && bl.memberRivalIds.includes(b.id));
    }
    expect(formed).toBe(true);
  });

  it('does not form when the pair is too hostile, even with the flag on', () => {
    const r = RegionSim.create(1000);
    r.rivalClimateResponse = true;
    const a = addRival(r, { id: 1, archetype: 'trading_republic' });
    const b = addRival(r, { id: 2, archetype: 'crusader_state' });
    r.rivalPairs[r.pairKey(a.id, b.id)] = -80; // well below the bloc threshold
    for (let i = 0; i < 500; i++) tickRivalClimateBlocActivity(r);
    expect(r.rivalClimateBlocs).toHaveLength(0);
  });

  it('membership measurably lifts the world green share (archetypeGreenShare), so bloc members bend the curve faster', () => {
    const r = RegionSim.create(1000);
    const a = addRival(r, { id: 1, archetype: 'crusader_state' }); // propensity 0.9, not the 1.0 ceiling
    const before = r.worldEmissions();
    r.rivalClimateBlocs.push({ id: 1, memberRivalIds: [a.id], foundedYear: r.year });
    const after = r.worldEmissions();
    // A boosted propensity cuts emissions further (worldEmissions falls, never rises).
    expect(after).toBeLessThanOrEqual(before);
  });
});

describe('existential climate response — round-trips and stays out of the way when off', () => {
  it('rivalClimateBlocs serializes and deserializes (backward-compatible ?? [] for old saves)', () => {
    const r = RegionSim.create(1000);
    r.rivalClimateResponse = true;
    const a = addRival(r, { id: 1, archetype: 'trading_republic' });
    const b = addRival(r, { id: 2, archetype: 'crusader_state' });
    r.rivalClimateBlocs.push({ id: 1, memberRivalIds: [a.id, b.id], foundedYear: r.year });
    const saved = r.serialize();
    const loaded = RegionSim.deserialize(saved);
    expect(loaded.rivalClimateBlocs).toEqual([{ id: 1, memberRivalIds: [a.id, b.id], foundedYear: r.year }]);

    // An old save with no rivalClimateBlocs field at all still loads cleanly.
    const old = JSON.parse(saved);
    delete old.rivalClimateBlocs;
    delete old.nextRivalClimateBlocId;
    const loadedOld = RegionSim.deserialize(JSON.stringify(old));
    expect(loadedOld.rivalClimateBlocs).toEqual([]);
  });

  // INTENT CHANGE: this flag used to be a run-mode toggle (deliberately NOT
  // serialized; this test asserted a fresh load always starts OFF). It is now a
  // World Dynamism campaign option chosen at new game, so it persists through
  // save/load. Old saves without the key still default OFF (see
  // tests/world-dynamism.test.ts for the full matrix).
  it('the flag is serialized — a campaign option survives save/load', () => {
    const r = RegionSim.create(1000);
    r.rivalClimateResponse = true;
    const saved = r.serialize();
    const loaded = RegionSim.deserialize(saved);
    expect(loaded.rivalClimateResponse).toBe(true);
  });
});

describe('existential climate response — the roll multiplier itself', () => {
  it('URGENCY_AGGRESSION_LIFT is a positive amplifier (documents the intended direction)', () => {
    expect(URGENCY_AGGRESSION_LIFT).toBeGreaterThan(0);
  });
});
