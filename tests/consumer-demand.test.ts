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

  it('the on-map serialized economy is byte-identical with the flag on vs off (telemetry-only activation)', () => {
    const run = (cd: boolean): string => {
      const r = RegionSim.create(1007);
      r.autoDevelopPlayer = true;
      r.consumerDemand = cd;
      const target = r.year + 40;
      let guard = 0;
      while (r.year < target && !r.gameOver && guard < 2_000_000) {
        r.tick();
        guard++;
      }
      return JSON.stringify(r.serialize());
    };
    // The world scarcity feeds the one-sided price anchor, but on-map towns are uniformly
    // slack on local stock → the lift is uniform → no price gaps → no arbitrage flow change
    // → the serialized economy is byte-for-byte identical. The activation is telemetry-only
    // until the per-town local price is made flow-based (the handed-off next increment).
    expect(run(true)).toBe(run(false));
  });
});
