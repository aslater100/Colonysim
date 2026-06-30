import { describe, expect, it } from 'vitest';
import {
  RegionSim,
  INTERMEDIATE_GOODS,
  LOCAL_GOODS_INFLATION,
  LOCAL_GOODS_OUTPUT_DRAG,
  type Settlement,
} from '../src/sim/region';
import { tickIntermediateGoods, localGoodDemand, localGoodPrice, worldGoodDemand } from '../src/sim/systems/goods';

/**
 * PR-3 slice 3 — per-good LOCAL prices + the local-goods macro coupling (the first
 * slice where the per-town goods ledger reaches GDP/inflation). Slice 2 made each
 * town produce a good only up to a local input gate, stranding cross-sector goods in
 * a specialised multi-town nation, but nothing read that. Slice 3 closes the loop:
 *
 *  - each good is priced PER TOWN from its local stock vs. its local demand
 *    (`localGoodPrice`): a producer flush with a good prices it at base, a town that
 *    consumes it but holds none prices it dear — the signal arbitrage ships on;
 *  - a nation-wide LOCAL-GOODS SCARCITY index (`r.localGoodsScarcity`, cached from
 *    the per-town production GATES) feeds cost-push inflation + an industry-output
 *    drag. Driven off the gate (not stock magnitudes), it is EXACTLY 0 whenever
 *    every gate is 1 — single-town / self-sufficient play, in boom or raw shock
 *    alike — so that play stays byte-identical and the index never double-counts the
 *    raw cascade; it is positive only when specialisation strands a good.
 *
 * The fixtures mirror goods-local.test.ts: hand-built towns with pinned sector
 * outputs and an unwarmed norm so every raw flows at level 1 — leaving the per-town
 * gate / local stock as the only thing that can move a price or the index.
 */

/** A good's full monthly output, read off the catalog (so the tests don't hard-code
 *  magnitudes that would drift if a recipe is retuned). */
function baseOutput(id: string): number {
  const g = INTERMEDIATE_GOODS.find((x) => x.id === id);
  if (!g) throw new Error(`no such good: ${id}`);
  return g.baseOutput;
}

/** Build a sim with `layout.length` player towns, pinned sector outputs, an empty
 *  ledger and an unwarmed norm (raws flow at level 1). Year pinned so the chain is
 *  unlocked. No ticking → no AI-founded towns to contaminate the ledger/proxy. */
function townsSim(layout: Array<{ ind: number; agri: number }>, year = 2000): RegionSim {
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
    s.goodStocks = undefined;
  });
  r.sectorOutputNorm = { industry: 0, agriculture: 0 };
  Object.defineProperty(r, 'year', { get: () => year, configurable: true });
  return r;
}

// ============================================================
// 1. localGoodDemand — the consumption appetite denominator
// ============================================================
describe('localGoodDemand', () => {
  it('a single all-rounder town demands every good its goods consume', () => {
    const r = townsSim([{ ind: 100, agri: 100 }]);
    const t = r.settlements[0];
    // textiles feeds clothing + consumer_goods + luxury_goods (3 consumers); a lone
    // town is the whole of every sector (share 1), so it demands one unit per
    // consumer = 3.
    expect(localGoodDemand(r, t, 'textiles')).toBeCloseTo(3, 6);
    // components feeds vehicles + machinery + consumer_goods + electronics = 4.
    expect(localGoodDemand(r, t, 'components')).toBeCloseTo(4, 6);
  });

  it('a raw material is never demanded (only tracked goods are priced)', () => {
    const r = townsSim([{ ind: 100, agri: 100 }]);
    const t = r.settlements[0];
    for (const raw of ['coal', 'iron', 'oil', 'grain', 'livestock', 'wood']) {
      expect(localGoodDemand(r, t, raw), raw).toBe(0);
    }
  });

  it('a town with no producing-sector output demands nothing', () => {
    // Town 1 is pure agriculture: it makes no industry goods, so it draws none of
    // their (industry-attributed) inputs — textiles demand here is 0.
    const r = townsSim([
      { ind: 100, agri: 0 },
      { ind: 0, agri: 100 },
    ]);
    expect(localGoodDemand(r, r.settlements[1], 'textiles')).toBe(0);
    // …while the pure-industry town, which makes the textile-finals, demands it.
    expect(localGoodDemand(r, r.settlements[0], 'textiles')).toBeGreaterThan(0);
  });
});

// ============================================================
// 2. localGoodPrice — rises as stock falls below demand
// ============================================================
describe('localGoodPrice', () => {
  it('a town flush with a good prices it at base; an empty consumer prices it dear', () => {
    const r = townsSim([{ ind: 100, agri: 100 }]);
    const t = r.settlements[0];
    const demand = localGoodDemand(r, t, 'textiles'); // 3
    expect(demand).toBeGreaterThan(0);

    (t.goodStocks ??= {})['textiles'] = demand * 10; // well-stocked → no scarcity
    const flush = localGoodPrice(r, t, 'textiles');

    t.goodStocks['textiles'] = 0; // consumes it but holds none → fully scarce
    const empty = localGoodPrice(r, t, 'textiles');

    expect(empty).toBeGreaterThan(flush);
    // Full scarcity doubles the price (GAIN = 1.0): empty == 2 × the base (= flush).
    expect(empty).toBeCloseTo(flush * 2, 6);
  });

  it('price falls monotonically as stock rises toward demand', () => {
    const r = townsSim([{ ind: 100, agri: 100 }]);
    const t = r.settlements[0];
    const demand = localGoodDemand(r, t, 'textiles');
    let prev = Infinity;
    for (const frac of [0, 0.25, 0.5, 0.75, 1, 2]) {
      (t.goodStocks ??= {})['textiles'] = demand * frac;
      const p = localGoodPrice(r, t, 'textiles');
      expect(p, `stock=${frac}×demand`).toBeLessThanOrEqual(prev);
      prev = p;
    }
    // At/over demand the price has bottomed out at base (no further fall).
    (t.goodStocks ??= {})['textiles'] = demand * 5;
    expect(localGoodPrice(r, t, 'textiles')).toBeCloseTo(prev, 6);
  });

  it('an un-demanded good is priced at base regardless of LOCAL stock (world self-sufficient)', () => {
    // The pure-agri town demands no industry good, so steel is base-priced for it
    // whether it holds a lot or none — no false LOCAL scarcity where there is no
    // appetite. Keep the WORLD self-sufficient in steel (stock the industry town past
    // its world demand) so the world-anchor adds nothing and this isolates the local
    // invariant; the anchor's effect when the world IS short lives in world-anchor.test.ts.
    const r = townsSim([
      { ind: 100, agri: 0 },
      { ind: 0, agri: 100 },
    ]);
    const [ind, agri] = r.settlements;
    (ind.goodStocks ??= {})['steel'] = worldGoodDemand(r, 'steel') * 5 + 1000;
    (agri.goodStocks ??= {})['steel'] = 0;
    const atZero = localGoodPrice(r, agri, 'steel');
    agri.goodStocks['steel'] = 999;
    const atPlenty = localGoodPrice(r, agri, 'steel');
    expect(atZero).toBe(atPlenty); // demand 0 → local scarcity 0 → flat base price
  });
});

// ============================================================
// 3. localGoodsScarcity index — 0 in self-sufficient play, >0 on specialisation
// ============================================================
describe('localGoodsScarcity index (macro signal)', () => {
  it('is 0 for a single all-rounder town (byte-identical case)', () => {
    const r = townsSim([{ ind: 100, agri: 100 }]);
    tickIntermediateGoods(r);
    expect(r.localGoodsScarcity).toBe(0);
  });

  it('is 0 for mixed self-sufficient towns (divergence needs specialisation)', () => {
    const r = townsSim([
      { ind: 50, agri: 50 },
      { ind: 50, agri: 50 },
    ]);
    tickIntermediateGoods(r);
    expect(r.localGoodsScarcity).toBe(0);
  });

  it('is positive and bounded for a specialised multi-town nation', () => {
    const r = townsSim([
      { ind: 100, agri: 0 }, // pure industry — strands the textile-finals
      { ind: 0, agri: 100 }, // pure agriculture — banks textiles it can't consume
    ]);
    tickIntermediateGoods(r);
    expect(r.localGoodsScarcity).toBeGreaterThan(0);
    expect(r.localGoodsScarcity).toBeLessThanOrEqual(1);
  });

  it('eases once the stranded input is shipped into the deprived town', () => {
    const r = townsSim([
      { ind: 100, agri: 0 },
      { ind: 0, agri: 100 },
    ]);
    tickIntermediateGoods(r);
    const starved = r.localGoodsScarcity;
    expect(starved).toBeGreaterThan(0);

    // A standing supply of textiles in the industry town reopens its gate.
    (r.settlements[0].goodStocks ??= {})['textiles'] = 1000;
    tickIntermediateGoods(r);
    expect(r.localGoodsScarcity).toBeLessThan(starved);
  });

  it('stays finite and in [0,1] across repeated ticks', () => {
    const r = townsSim([
      { ind: 80, agri: 20 },
      { ind: 20, agri: 80 },
    ]);
    for (let i = 0; i < 6; i++) {
      tickIntermediateGoods(r);
      expect(Number.isFinite(r.localGoodsScarcity)).toBe(true);
      expect(r.localGoodsScarcity).toBeGreaterThanOrEqual(0);
      expect(r.localGoodsScarcity).toBeLessThanOrEqual(1);
    }
  });
});

// ============================================================
// 4. Macro coupling — cost-push inflation (mirrors supply-cost-push.test.ts)
// ============================================================
describe('local-goods cost-push inflation', () => {
  const NEUTRAL_RATE = 0.05;
  const BASE_TARGET = 0.02;
  const REVERT = 0.15;
  const tickMonetary = (r: RegionSim): void =>
    (r as unknown as { tickMonetary(): void }).tickMonetary();

  /** A specialised 2-town nation (pure industry + pure agri) with a central bank, so
   *  every raw still flows (each extracting sector has output somewhere → severity 0)
   *  but cross-sector goods strand → localGoodsScarcity > 0. */
  function specialised(): RegionSim {
    const r = townsSim([
      { ind: 100, agri: 0 },
      { ind: 0, agri: 100 },
    ], 1975);
    r.researched.add('central_banking');
    expect(r.hasCentralBank()).toBe(true);
    expect(r.policyRate).toBeCloseTo(NEUTRAL_RATE, 10);
    return r;
  }

  /** A mixed self-sufficient control: same towns, same bank, but no stranding. */
  function mixedControl(): RegionSim {
    const r = townsSim([
      { ind: 50, agri: 50 },
      { ind: 50, agri: 50 },
    ], 1975);
    r.researched.add('central_banking');
    return r;
  }

  it('a specialised nation pushes inflation above an identical self-sufficient control', () => {
    const shocked = specialised();
    const control = mixedControl();
    tickIntermediateGoods(shocked);
    tickIntermediateGoods(control);

    // No RAW shock either way — the divergence is purely local distribution.
    expect(shocked.supplyShockSeverity()).toBe(0);
    expect(control.supplyShockSeverity()).toBe(0);
    expect(shocked.localGoodsScarcity).toBeGreaterThan(0);
    expect(control.localGoodsScarcity).toBe(0);

    for (let i = 0; i < 12; i++) {
      tickMonetary(shocked);
      tickMonetary(control);
    }
    expect(control.inflationRate).toBeCloseTo(BASE_TARGET, 6); // no push
    expect(shocked.inflationRate).toBeGreaterThan(control.inflationRate);
  });

  it('tracks the scarcity·gain target via the monetary mean-reversion', () => {
    const r = specialised();
    tickIntermediateGoods(r);
    const scarcity = r.localGoodsScarcity;
    expect(scarcity).toBeGreaterThan(0);

    const target = BASE_TARGET + scarcity * LOCAL_GOODS_INFLATION;
    const months = 12;
    for (let i = 0; i < months; i++) tickMonetary(r);
    const expected = target + (BASE_TARGET - target) * Math.pow(1 - REVERT, months);
    expect(r.inflationRate).toBeCloseTo(expected, 8);
  });

  it('never breaches the 0.50 inflation ceiling, even at maximum scarcity', () => {
    const r = specialised();
    r.localGoodsScarcity = 1; // force the worst case
    for (let i = 0; i < 100; i++) {
      tickMonetary(r);
      expect(r.inflationRate).toBeLessThanOrEqual(0.5);
    }
    expect(r.inflationRate).toBeCloseTo(BASE_TARGET + LOCAL_GOODS_INFLATION, 6);
  });
});

// ============================================================
// 5. Macro coupling — industry-output drag (determinism-matched injection)
// ============================================================
describe('local-goods industry-output drag', () => {
  it('drags industry output by exactly (1 − scarcity × DRAG) vs an identical control', () => {
    // Two single-town sims share a seed → determinism-matched. Tick both in lockstep
    // to a year with industry + goods, inject scarcity on one, then advance both to
    // the next monthlyUpdate (day % 30 === 0). `updateSectors` (early in the monthly
    // block) reads the injected value; every other factor is identical, so industry
    // output differs by exactly the drag. (`tickIntermediateGoods`, late in the same
    // block, then resets the scalar to 0 — so we compare right after this one block.)
    const a = RegionSim.create(7);
    const b = RegionSim.create(7);
    while (a.year < 1925) { a.tick(); b.tick(); }

    const industry = (r: RegionSim) =>
      r.settlements.reduce((s, t) => s + t.sectors.industry.output, 0);

    const scarcity = 0.5;
    b.localGoodsScarcity = scarcity;
    a.localGoodsScarcity = 0;
    // The daily ticks before the boundary don't read the scalar, so a and b stay
    // matched until exactly one monthlyUpdate fires at the next multiple of 30.
    const target = (Math.floor(a.day / 30) + 1) * 30;
    while (a.day < target) { a.tick(); b.tick(); }

    expect(industry(a)).toBeGreaterThan(0); // a meaningful, non-trivial drag target
    expect(industry(b)).toBeLessThan(industry(a));
    expect(industry(b)).toBeCloseTo(industry(a) * (1 - scarcity * LOCAL_GOODS_OUTPUT_DRAG), 4);
  });
});
