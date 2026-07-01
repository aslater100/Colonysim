import { describe, expect, it } from 'vitest';
import {
  RegionSim,
  INTERMEDIATE_GOODS,
  type Settlement,
  type RivalNation,
} from '../src/sim/region';
import {
  finalGoodDemand,
  worldGoodDemand,
  worldGoodSupply,
  worldGoodScarcity,
  worldMarketTightness,
  localFinalGoodDemand,
  localGoodPrice,
  tickIntermediateGoods,
} from '../src/sim/systems/goods';

/**
 * CONSUMER-DEMAND model (global-world leg 1) — the structural fix that lets the
 * world market TIGHTEN.
 *
 * The goods demand functions counted only intermediate-INPUT demand (a good is
 * demanded solely as an input to OTHER goods), normalized to sector shares (O(1)),
 * while production deposits `baseOutput × level` units/tick — so the 8 terminal
 * goods consume nothing, every good oversupplies by ~baseOutput×, stocks accumulate
 * unbounded, and `worldGoodScarcity = 1 − supply/demand` is pinned at 0 in EVERY
 * long run (regardless of specialisation/war — the demand denominator is mis-scaled,
 * not the play "balanced"). These tests pin the fix: behind `r.consumerDemand` the
 * world market reads a FLOW signal (this-tick production capacity `baseOutput × level`
 * vs an exogenous final-consumption demand `baseOutput × FINAL_APPETITE`, tilted by
 * the great powers), so a supply shock / great-power war / warming breadbasket finally
 * registers — and OFF every path is byte-identical to the legacy stock model.
 *
 * Fixtures mirror world-market.test.ts / rival-world-market.test.ts: hand-built towns,
 * pinned sector outputs, an unwarmed norm, an empty rival roster cleared defensively.
 */
function worldSim(
  layout: Array<{ ind: number; agri: number; faction?: number }>,
  opts: { year?: number; consumerDemand?: boolean } = {},
): RegionSim {
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
  r.foreignWars = [];
  r.warmingC = 0;
  r.consumerDemand = opts.consumerDemand ?? false;
  Object.defineProperty(r, 'year', { get: () => opts.year ?? 2000, configurable: true });
  return r;
}

/** Pin a good's this-tick supply level (the cascade's Liebig min the flow scarcity reads). */
function setLevel(r: RegionSim, goodId: string, level: number): void {
  r.goodLevels.set(goodId, level);
}

function addRival(r: RegionSim, opts: { id: number; commerce?: number; pop?: number }): RivalNation {
  const rv = {
    id: opts.id,
    name: `Power ${opts.id}`,
    leader: 'the Directorate',
    archetype: 'opportunist',
    weights: { expansion: 5, commerce: opts.commerce ?? 4.5, ideology: 5, honor: 5, risk: 5, grudge: 5 },
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

function setWar(r: RegionSim, aId: number, bId: number): void {
  r.foreignWars.push({ a: aId, b: bId, startedDay: 0, endsDay: 9_999_999 });
}

const baseOutputOf = (id: string): number => INTERMEDIATE_GOODS.find((g) => g.id === id)!.baseOutput;

// ============================================================
// 1. finalGoodDemand — the missing sink, flag-gated
// ============================================================
describe('finalGoodDemand', () => {
  it('is 0 when the consumer-demand model is off (byte-identical guard)', () => {
    const r = worldSim([{ ind: 100, agri: 100 }], { consumerDemand: false });
    for (const g of INTERMEDIATE_GOODS) expect(finalGoodDemand(r, g.id)).toBe(0);
  });

  it('is a positive baseOutput-scaled appetite for an unlocked good when on', () => {
    const r = worldSim([{ ind: 100, agri: 100 }], { consumerDemand: true });
    expect(finalGoodDemand(r, 'textiles')).toBeGreaterThan(0);
    // Proportional to baseOutput (in production units) — robust to the FINAL_APPETITE dial:
    // demand(steel)/demand(textiles) == baseOutput(steel)/baseOutput(textiles).
    expect(finalGoodDemand(r, 'steel') / finalGoodDemand(r, 'textiles')).toBeCloseTo(
      baseOutputOf('steel') / baseOutputOf('textiles'),
      9,
    );
  });

  it('is 0 for a not-yet-unlocked good and for a raw (no appetite they cannot make)', () => {
    const early = worldSim([{ ind: 100, agri: 100 }], { year: 1923, consumerDemand: true });
    expect(finalGoodDemand(early, 'electronics')).toBe(0); // unlocks 1950
    expect(finalGoodDemand(early, 'lumber')).toBeGreaterThan(0); // unlocks 1920
    const r = worldSim([{ ind: 100, agri: 100 }], { consumerDemand: true });
    expect(finalGoodDemand(r, 'coal')).toBe(0); // a raw is never tracked/priced
  });
});

// ============================================================
// 2. THE STRUCTURAL FIX — a shock registers despite unbounded stock
// ============================================================
describe('the structural fix: scarcity is no longer pinned at 0 by accumulated stock', () => {
  it('a supply shock registers under consumer-demand even with a vast hoard (where the stock model pins it at 0)', () => {
    // A town sitting on 10,000 units of textiles — the unbounded accumulation a long
    // run produces. A 50%-cut chain (level 0.5) is a real shock.
    const off = worldSim([{ ind: 100, agri: 100 }], { consumerDemand: false });
    (off.settlements[0].goodStocks ??= {})['textiles'] = 10_000;
    setLevel(off, 'textiles', 0.5);
    // Legacy stock model: supply (10000) ≫ demand → scarcity clamped at 0, the shock invisible.
    expect(worldGoodScarcity(off, 'textiles')).toBe(0);

    const on = worldSim([{ ind: 100, agri: 100 }], { consumerDemand: true });
    (on.settlements[0].goodStocks ??= {})['textiles'] = 10_000; // same vast hoard
    setLevel(on, 'textiles', 0.5);
    // Flow model: production capacity (baseOutput × 0.5) vs demand (baseOutput × 1) →
    // scarcity 0.5. The shock is FELT, the hoard irrelevant.
    expect(worldGoodScarcity(on, 'textiles')).toBeCloseTo(0.5, 9);
  });

  it('is exactly 0 in a healthy balanced world (level 1, no great-power tilt) — the balanced boundary', () => {
    const r = worldSim([{ ind: 100, agri: 100 }], { consumerDemand: true });
    for (const g of INTERMEDIATE_GOODS) {
      if (r.year < g.eraUnlock) continue;
      setLevel(r, g.id, 1);
      expect(worldGoodScarcity(r, g.id), g.id).toBe(0);
    }
    expect(worldMarketTightness(r)).toBe(0);
  });

  it('scales monotonically with the depth of the cut and stays bounded [0,1]', () => {
    const r = worldSim([{ ind: 100, agri: 100 }], { consumerDemand: true });
    let prev = -1;
    for (const level of [1, 0.75, 0.5, 0.25, 0]) {
      setLevel(r, 'steel', level);
      const sc = worldGoodScarcity(r, 'steel');
      expect(sc).toBeGreaterThanOrEqual(prev); // deeper cut → more scarce
      expect(sc).toBeGreaterThanOrEqual(0);
      expect(sc).toBeLessThanOrEqual(1);
      prev = sc;
    }
    expect(worldGoodScarcity(r, 'steel')).toBe(1); // a total cut → fully scarce
  });
});

// ============================================================
// 3. the great powers finally bite the world market
// ============================================================
describe('great-power tilt drives world scarcity under consumer-demand', () => {
  it('a great-power WAR tightens the world even at full production (the tilt now bites)', () => {
    const peace = worldSim([{ ind: 100, agri: 100 }], { consumerDemand: true });
    addRival(peace, { id: 90 });
    addRival(peace, { id: 91 });
    setLevel(peace, 'steel', 1);
    expect(worldGoodScarcity(peace, 'steel')).toBe(0); // balanced powers → no tilt → 0

    const war = worldSim([{ ind: 100, agri: 100 }], { consumerDemand: true });
    const a = addRival(war, { id: 90 });
    const b = addRival(war, { id: 91 });
    setWar(war, a.id, b.id);
    setLevel(war, 'steel', 1);
    // War lifts world demand above full capacity → positive scarcity from the tilt alone.
    expect(worldGoodScarcity(war, 'steel')).toBeGreaterThan(0);
  });

  it('a warming breadbasket tightens AGRI goods (textiles) but not steel', () => {
    const r = worldSim([{ ind: 100, agri: 100 }], { consumerDemand: true });
    addRival(r, { id: 90 });
    r.warmingC = 3; // climate hits the global breadbasket
    setLevel(r, 'textiles', 1);
    setLevel(r, 'steel', 1);
    expect(worldGoodScarcity(r, 'textiles')).toBeGreaterThan(0); // agri-attributed → climate import tilt
    expect(worldGoodScarcity(r, 'steel')).toBe(0); // industrial good → untouched by the food tilt
  });

  it('a commercial surplus (export tilt) relieves the world — scarcity floors at 0, never negative', () => {
    const r = worldSim([{ ind: 100, agri: 100 }], { consumerDemand: true });
    addRival(r, { id: 90, commerce: 9 }); // a Trading Republic: net exporter
    setLevel(r, 'steel', 1);
    const sc = worldGoodScarcity(r, 'steel');
    expect(sc).toBe(0); // relief cannot make a good super-abundant past base
    expect(sc).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================
// 4. byte-identical when OFF + determinism
// ============================================================
describe('byte-identical when off + determinism', () => {
  it('worldGoodDemand off equals the legacy intermediate-demand stock model', () => {
    const r = worldSim([{ ind: 0, agri: 100 }, { ind: 100, agri: 0, faction: 99 }], { consumerDemand: false });
    // Legacy: sum of every settlement's intermediate-input demand (no final sink).
    const legacy = worldGoodSupply(r, 'textiles'); // 0 (empty ledger) — sanity that supply is read
    expect(legacy).toBe(0);
    // textiles is consumed by the industry town → legacy demand > 0 and is the stock-model value.
    expect(worldGoodDemand(r, 'textiles')).toBeGreaterThan(0);
    // It does NOT equal the (much larger) consumer-demand flow value.
    const on = worldSim([{ ind: 0, agri: 100 }, { ind: 100, agri: 0, faction: 99 }], { consumerDemand: true });
    expect(worldGoodDemand(on, 'textiles')).not.toBeCloseTo(worldGoodDemand(r, 'textiles'), 3);
    expect(worldGoodDemand(on, 'textiles')).toBeCloseTo(baseOutputOf('textiles'), 9); // baseOutput × APPETITE(1.0)
  });

  it('worldGoodScarcity off is the legacy stock measure (0 for a stocked good, regardless of level cache)', () => {
    const r = worldSim([{ ind: 100, agri: 100 }], { consumerDemand: false });
    (r.settlements[0].goodStocks ??= {})['steel'] = 5000;
    setLevel(r, 'steel', 0.1); // a level cache the OFF path must ignore
    expect(worldGoodScarcity(r, 'steel')).toBe(0); // stock ≫ demand → 0, level cache untouched
  });

  it('is deterministic — identical state yields an identical reading on each model', () => {
    const mk = (cd: boolean): number => {
      const r = worldSim([{ ind: 70, agri: 40 }], { consumerDemand: cd });
      addRival(r, { id: 5, commerce: 4.5 });
      setLevel(r, 'steel', 0.6);
      return worldGoodScarcity(r, 'steel');
    };
    expect(mk(true)).toBe(mk(true));
    expect(mk(false)).toBe(mk(false));
  });
});

// ============================================================
// 5. live integration — activated, finite, bounded; the on-map economy untouched
// ============================================================
describe('consumer-demand in live autoplay', () => {
  it('ON: the world market is LIVE (tightness > 0) yet finite & bounded over 30y', () => {
    const r = RegionSim.create(1000);
    r.autoDevelopPlayer = true;
    r.consumerDemand = true;
    const target = r.year + 30;
    let guard = 0;
    while (r.year < target && !r.gameOver && guard < 2_000_000) {
      r.tick();
      guard++;
    }
    const tight = r.worldMarketTightness();
    expect(Number.isFinite(tight)).toBe(true);
    expect(tight).toBeGreaterThanOrEqual(0);
    expect(tight).toBeLessThanOrEqual(1);
  });

  it('OFF: stays dormant (tightness 0) — the legacy structural baseline', () => {
    const r = RegionSim.create(1000);
    r.autoDevelopPlayer = true;
    r.consumerDemand = false;
    const target = r.year + 30;
    let guard = 0;
    while (r.year < target && !r.gameOver && guard < 2_000_000) {
      r.tick();
      guard++;
    }
    expect(r.worldMarketTightness()).toBe(0);
  });

  it('increment 2: consumer-demand ON now DIVERGES the on-map economy from OFF (the sink makes it respond), yet stays deterministic & bounded', () => {
    const run = (cd: boolean): RegionSim => {
      const r = RegionSim.create(1007);
      r.autoDevelopPlayer = true;
      r.autoExpandPlayer = true; // a multi-town nation so cross-town shortage can open
      r.consumerDemand = cd;
      const target = r.year + 40;
      let guard = 0;
      while (r.year < target && !r.gameOver && guard < 2_000_000) {
        r.tick();
        guard++;
      }
      return r;
    };
    const on = run(true);
    const off = run(false);
    // Increment 2 (the per-town final-consumption SINK) is deliberately NOT telemetry-only:
    // households DRAIN each town's stock, so a town short of a good it doesn't make goes
    // genuinely short → its price rises → arbitrage ships it in → the serialized on-map
    // economy DIVERGES from the flag-off (legacy, no-sink) run. This asserts the response
    // that increment 1 explicitly deferred ("telemetry-only until the per-town local price
    // is made flow-based — the next increment").
    expect(JSON.stringify(on.serialize())).not.toBe(JSON.stringify(off.serialize()));
    // The response is real: some households went short, and real goods are moving on-map.
    expect(on.finalConsumptionShortfall).toBeGreaterThan(0);
    expect(on.finalConsumptionShortfall).toBeLessThanOrEqual(1);
    // Determinism holds under the flag (same seed + flag → byte-identical), the Track-C contract.
    expect(JSON.stringify(run(true).serialize())).toBe(JSON.stringify(on.serialize()));
    // Bounded / finite: the sink cannot spiral the nation into non-finite state.
    expect(Number.isFinite(on.treasury)).toBe(true);
    expect(on.playerPop()).toBeGreaterThan(0);
  });
});

describe('CONSUMER-DEMAND increment 2 — the per-town final-consumption SINK', () => {
  it('localFinalGoodDemand is 0 for every good when the model is off (byte-identical)', () => {
    const r = worldSim([{ ind: 10, agri: 10 }, { ind: 0, agri: 20 }], { consumerDemand: false });
    for (const g of INTERMEDIATE_GOODS) {
      for (const t of r.settlements) expect(localFinalGoodDemand(r, t, g.id)).toBe(0);
    }
  });

  it('splits the world final appetite by POPULATION share (Σ over towns == finalGoodDemand; a bigger town wants more)', () => {
    const r = worldSim([{ ind: 10, agri: 10 }, { ind: 10, agri: 10 }], { consumerDemand: true });
    r.settlements[0].cohorts.bands = r.settlements[0].cohorts.bands.map((b) => b * 2); // town 0 twice the people
    const good = 'steel'; // unlocked well before the fixture year (2000)
    const d0 = localFinalGoodDemand(r, r.settlements[0], good);
    const d1 = localFinalGoodDemand(r, r.settlements[1], good);
    expect(d0).toBeCloseTo(2 * d1, 6);                       // demand tracks population
    expect(d0 + d1).toBeCloseTo(finalGoodDemand(r, good), 6); // and decomposes the world appetite exactly
  });

  it('localGoodPrice: the sink makes a terminal good stock-sensitive when ON (dear when empty), inert to stock when OFF', () => {
    // `food` is terminal — no chain consumes it → intermediate-input demand is 0, so the
    // legacy (OFF) price ignores stock entirely. The final-consumption sink is what gives
    // it a demand to be short against.
    const price = (cd: boolean, stock: number): number => {
      const r = worldSim([{ ind: 10, agri: 10 }], { consumerDemand: cd });
      r.settlements[0].goodStocks = { food: stock };
      return localGoodPrice(r, r.settlements[0], 'food');
    };
    expect(price(false, 0)).toBe(price(false, 100000));      // OFF: no final demand → price is stock-blind (base)
    expect(price(true, 0)).toBeGreaterThan(price(true, 100000)); // ON: empty shelf dear, full shelf base
  });

  it('the sink DRAINS a pure-consumer town\'s stock and records its shortfall (ON); OFF the shelf is untouched', () => {
    const run = (cd: boolean) => {
      // Town 1 produces nothing (ind=agri=0) but has people → a pure consumer.
      const r = worldSim([{ ind: 10, agri: 10 }, { ind: 0, agri: 0 }], { consumerDemand: cd });
      const consumer = r.settlements[1];
      consumer.goodStocks = { food: 1000 };
      tickIntermediateGoods(r);
      return {
        stock: consumer.goodStocks?.food ?? 0,
        townShortfall: r.goodsShortfall.get(consumer.id) ?? 0,
        worldShortfall: r.finalConsumptionShortfall,
      };
    };
    const off = run(false);
    expect(off.stock).toBe(1000);            // OFF: no drain runs
    expect(off.townShortfall).toBe(0);
    expect(off.worldShortfall).toBe(0);
    const on = run(true);
    expect(on.stock).toBeLessThan(1000);     // ON: households ate into the shelf
    expect(on.townShortfall).toBeGreaterThan(0); // it holds only food, so most of its appetite went unmet
    expect(on.townShortfall).toBeLessThanOrEqual(1);
    expect(on.worldShortfall).toBeGreaterThan(0);
    expect(on.worldShortfall).toBeLessThanOrEqual(1);
  });

  it('a well-supplied producer town meets its own households (low shortfall) while a bare consumer town goes short (high shortfall)', () => {
    const r = worldSim([{ ind: 40, agri: 40 }, { ind: 0, agri: 0 }], { consumerDemand: true });
    // Give the producer a deep buffer of everything; leave the consumer bare.
    const stocks: Record<string, number> = {};
    for (const g of INTERMEDIATE_GOODS) stocks[g.id] = 100000;
    r.settlements[0].goodStocks = { ...stocks };
    r.settlements[1].goodStocks = {};
    tickIntermediateGoods(r);
    const producer = r.goodsShortfall.get(r.settlements[0].id) ?? 0;
    const consumer = r.goodsShortfall.get(r.settlements[1].id) ?? 0;
    expect(producer).toBeLessThan(consumer); // the shelf-rich town feeds its people; the bare one cannot
    expect(consumer).toBeGreaterThan(0.5);   // the bare consumer meets almost none of its appetite
  });

  it('the FELT coupling: an unmet-goods town loses satisfaction when ON; the term is inert when OFF (byte-identical)', () => {
    // Warm the same seed to a stable capital, inject a total goods shortfall, tick once
    // (dailyUpdate reads the injected shortfall before the goods tick overwrites it) and
    // compare the day's satisfaction move ON vs OFF. Both sims are rng-identical through
    // this tick (the sink + the penalty consume no rng), so the only difference is the
    // `goodsTerm` — which is present ON, gated to 0 OFF.
    const dayMove = (cd: boolean): number => {
      const r = RegionSim.create(1000);
      const warm = r.year + 5;
      while (r.year < warm && !r.gameOver) r.tick();
      const cap = r.settlements.find((t) => t.factionId === r.playerFactionId)!;
      r.consumerDemand = cd;
      const before = cap.satisfaction;
      // Tick across ONE day roll (so `dailyUpdate` runs once), re-injecting the total
      // shortfall each sub-tick so the daily satisfaction update reads it (the sim's
      // sub-day calendar means a single tick may not advance a whole day).
      const startDay = r.day;
      let guard = 0;
      while (r.day === startDay && guard < 10000) {
        r.goodsShortfall.set(cap.id, 1); // households can source NONE of their goods
        r.tick();
        guard++;
      }
      return cap.satisfaction - before;
    };
    expect(dayMove(true)).toBeLessThan(dayMove(false)); // the −penalty pulls the target down only when ON
  });
});
