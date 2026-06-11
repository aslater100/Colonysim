import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/sim';
import { RegionSim, REGION_MINUTES_PER_TICK } from '../src/sim/region';
import type { DealBasket, RivalNation, RivalPersonality } from '../src/sim/region';
import { MINUTES_PER_DAY } from '../src/sim/defs';

const ticksPerDay = MINUTES_PER_DAY / REGION_MINUTES_PER_TICK;

function grow(sim: Simulation): void {
  while (sim.settlers.length < 22) sim.spawnSettler(32, 34);
  sim.stock.wood = 200;
  sim.stock.meal = 200;
}

function runDays(r: RegionSim, days: number): void {
  for (let i = 0; i < days * ticksPerDay; i++) r.tick();
}

function flippedPair(seed: number): { sim: Simulation; r: RegionSim } {
  const sim = new Simulation(seed);
  grow(sim);
  const r = RegionSim.fromTown(sim, 8, 80, 80);
  runDays(r, 5);
  return { sim, r };
}

function stateReady(seed = 42): RegionSim {
  const { r } = flippedPair(seed);
  r.stateProclaimed = true;
  r.stateName = 'Testonia';
  r.govLean = 'council';
  r.treasury = 500;
  return r;
}

function basket(parts: Partial<DealBasket>): DealBasket {
  return { treaties: [], goldToThem: 0, goldToYou: 0, borderSettlement: false, ...parts };
}

/** Pin the jittered weights so the arithmetic is deterministic. */
function fix(rv: RivalNation, w: RivalPersonality): void {
  rv.weights = w;
}

const TRADER: RivalPersonality = { expansion: 3, commerce: 9, ideology: 3, honor: 7, risk: 3, grudge: 3 };
const HEGEMON: RivalPersonality = { expansion: 9, commerce: 4, ideology: 5, honor: 4, risk: 7, grudge: 5 };
const HERMIT: RivalPersonality = { expansion: 2, commerce: 2, ideology: 6, honor: 6, risk: 2, grudge: 8 };

describe('Basket valuation (GDD §6.3: priced from their situation and personality)', () => {
  it('a commerce-minded court signs a basket it values outright', () => {
    const r = stateReady();
    const rv = r.spawnRival('trading_republic')!;
    fix(rv, TRADER);
    rv.relations = 10;
    const b = basket({ treaties: ['trade_agreement'] });
    const v = r.evaluateDeal(rv, b);
    expect(v.accept).toBe(true);
    expect(v.get).toBeGreaterThan(v.cost);
    expect(r.proposeDeal(rv.id, b)).toBe(true);
    expect(rv.treaties).toContain('trade_agreement');
    expect(r.log.some((l) => l.text.includes('ACCORD'))).toBe(true);
  });

  it('hatred prices the table itself: a hermit at −80 will not even talk', () => {
    const r = stateReady();
    const rv = r.spawnRival('hermit_kingdom')!;
    fix(rv, HERMIT);
    rv.relations = -80;
    const v = r.evaluateDeal(rv, basket({ treaties: ['trade_agreement'] }));
    expect(v.accept).toBe(false);
    expect(v.counter).toBeNull();
    expect(v.reason).toContain('will not deal with you');
  });

  it('an entangling pact is a concession — gold makes it square', () => {
    const r = stateReady();
    const rv = r.spawnRival('hegemon')!;
    fix(rv, HEGEMON);
    rv.relations = 30;
    expect(r.treatyAppetite(rv, 'defensive_pact')).toBeLessThan(0);
    expect(r.evaluateDeal(rv, basket({ treaties: ['defensive_pact'] })).accept).toBe(false);
    const cash = r.treasury;
    expect(r.proposeDeal(rv.id, basket({ treaties: ['defensive_pact'], goldToThem: 80 }))).toBe(true);
    expect(rv.treaties).toContain('defensive_pact');
    expect(r.treasury).toBe(cash - 80);
  });

  it('asking them to pay works when the basket covers it', () => {
    const r = stateReady();
    const rv = r.spawnRival('trading_republic')!;
    fix(rv, TRADER);
    rv.relations = 40;
    const cash = r.treasury;
    expect(r.proposeDeal(rv.id, basket({ treaties: ['trade_agreement'], goldToYou: 40 }))).toBe(true);
    expect(r.treasury).toBe(cash + 40);
  });

  it('an empty basket is no basket; gold you do not have stays in the vault', () => {
    const r = stateReady();
    const rv = r.spawnRival('trading_republic')!;
    expect(r.evaluateDeal(rv, basket({})).accept).toBe(false);
    expect(r.proposeDeal(rv.id, basket({}))).toBe(false);
    expect(r.proposeDeal(rv.id, basket({ treaties: ['trade_agreement'], goldToThem: 10_000 }))).toBe(false);
  });
});

describe('Counter-offers (GDD §6.3: within 30%, they name the sweetener)', () => {
  function shortOffer() {
    const r = stateReady();
    const rv = r.spawnRival('hegemon')!;
    fix(rv, HEGEMON);
    rv.relations = 30;
    const b = basket({ treaties: ['defensive_pact'], goldToThem: 50 });
    return { r, rv, b };
  }

  it('a near miss comes back sweetened, and the counter can be signed', () => {
    const { r, rv, b } = shortOffer();
    const v = r.evaluateDeal(rv, b);
    expect(v.accept).toBe(false);
    expect(v.counter).not.toBeNull();
    expect(v.counter!.goldToThem).toBeGreaterThan(b.goldToThem);
    expect(r.proposeDeal(rv.id, b)).toBe(false);
    const counter = r.counterFor(rv.id);
    expect(counter).toBeDefined();
    const cash = r.treasury;
    expect(r.acceptCounter(rv.id)).toBe(true);
    expect(rv.treaties).toContain('defensive_pact');
    expect(r.treasury).toBe(cash - counter!.basket.goldToThem);
    expect(r.counterFor(rv.id)).toBeUndefined();
  });

  it('declining a counter is a small, remembered slight', () => {
    const { r, rv, b } = shortOffer();
    r.proposeDeal(rv.id, b);
    const rel = rv.relations;
    expect(r.declineCounter(rv.id)).toBe(true);
    expect(rv.relations).toBeLessThan(rel);
    expect(r.counterFor(rv.id)).toBeUndefined();
  });

  it('counters lapse if left on the table', () => {
    const { r, rv, b } = shortOffer();
    r.proposeDeal(rv.id, b);
    expect(r.counterFor(rv.id)).toBeDefined();
    runDays(r, 130); // the chancery sweeps its desk on the monthly tick after expiry
    expect(r.counterFor(rv.id)).toBeUndefined();
  });
});

describe('Reputation at the table (GDD §5.4: everyone reads the ledger)', () => {
  it('broken seals push a signable deal out of reach', () => {
    const r = stateReady();
    const rv = r.spawnRival('hegemon')!;
    fix(rv, HEGEMON);
    rv.relations = 30;
    const b = basket({ treaties: ['defensive_pact'], goldToThem: 80 });
    expect(r.evaluateDeal(rv, b).accept).toBe(true);
    r.treatiesBroken = 2;
    const v = r.evaluateDeal(rv, b);
    expect(v.accept).toBe(false);
    expect(v.counter).toBeNull(); // not even close any more
    expect(v.reason).toContain('broken seals');
  });
});

describe('Border settlement (GDD §5.4: a treaty type, and a casus belli sink)', () => {
  it('hermits welcome a fixed frontier — and it retires the border CB', () => {
    const r = stateReady();
    const rv = r.spawnRival('hermit_kingdom')!;
    fix(rv, HERMIT);
    rv.relations = -30;
    expect(r.borderAppetite(rv)).toBeGreaterThan(0);
    expect(r.availableCasusBelli(rv)).toContain('border_dispute');
    expect(r.proposeDeal(rv.id, basket({ borderSettlement: true, goldToThem: 30 }))).toBe(true);
    expect(rv.borderSettled).toBe(true);
    expect(r.availableCasusBelli(rv)).not.toContain('border_dispute');
    expect(rv.history.some((h) => h.includes('Settled the frontier'))).toBe(true);
  });

  it('a hegemon will not pin a border it means to move', () => {
    const r = stateReady();
    const rv = r.spawnRival('hegemon')!;
    fix(rv, HEGEMON);
    rv.relations = 0;
    const v = r.evaluateDeal(rv, basket({ borderSettlement: true }));
    expect(v.accept).toBe(false);
    expect(v.reason).toContain('frontier');
  });
});

describe('Negotiation save/load', () => {
  it('round-trips counters and settled borders; old saves default clean', () => {
    const { sim, r } = flippedPair(42);
    r.stateProclaimed = true;
    r.stateName = 'Testonia';
    r.govLean = 'council';
    r.treasury = 500;
    const rv = r.spawnRival('hegemon')!;
    fix(rv, HEGEMON);
    rv.relations = 30;
    rv.borderSettled = true;
    r.proposeDeal(rv.id, basket({ treaties: ['defensive_pact'], goldToThem: 50 }));
    expect(r.counterFor(rv.id)).toBeDefined();
    const town = Simulation.deserialize(sim.serialize());
    const r2 = RegionSim.deserialize(r.serialize(), town);
    expect(r2.counterFor(rv.id)?.basket).toEqual(r.counterFor(rv.id)!.basket);
    expect(r2.rival(rv.id)!.borderSettled).toBe(true);
    // a v0.17-era save knows nothing of counters or surveys
    const d = JSON.parse(r.serialize());
    delete d.counters;
    for (const x of d.rivals) delete x.borderSettled;
    const r3 = RegionSim.deserialize(JSON.stringify(d), Simulation.deserialize(sim.serialize()));
    expect(r3.counters).toEqual([]);
    expect(r3.rival(rv.id)!.borderSettled).toBe(false);
    runDays(r3, 3); // and it still ticks
  });
});
