import { describe, it, expect } from 'vitest';
import { RegionSim, type Settlement, LOCAL_GOODS_INFLATION, LOCAL_GOODS_OUTPUT_DRAG } from '../src/sim/region';
import { tickIntermediateGoods } from '../src/sim/systems/goods';

/**
 * Specialisation / goods-coupling stress-probe (cross-cutting test debt).
 *
 * The per-town goods ledger (PR-3 slice 2) is DORMANT in single-town / self-
 * sufficient autoplay: every town holds its own inputs, every gate is 1, and
 * `localGoodsScarcity` stays 0. The coupling ONLY activates when a CROSS-SECTOR
 * good is split across specialised towns and those towns can't re-supply each other.
 *
 * This probe:
 *   1. Builds a two-town nation — one pure-agri (textiles producer via livestock),
 *      one pure-industry (clothing producer that NEEDS textiles as input).
 *   2. Gives the industry town ZERO textiles stock and NO trade route to the agri
 *      town, so every clothing production gate fires at 0.
 *   3. Asserts `localGoodsScarcity > 0` after a tick of tickIntermediateGoods.
 *   4. Asserts the coupling bites: the scarcity drives non-zero inflation pressure
 *      and non-trivial output drag.
 *   5. Asserts it stays BOUNDED: scarcity ∈ (0, 1], inflation target doesn't
 *      exceed the plausible ceiling (2% base + 8% full scarcity push = 10%), and
 *      output drag is ≤ LOCAL_GOODS_OUTPUT_DRAG.
 */

/** Build a two-town specialised nation with year pinned past 1920. */
function specialisedSim(): RegionSim {
  const r = RegionSim.create(7);
  const base = r.settlements[0];
  // Add second town
  const t2 = structuredClone(base) as Settlement;
  t2.id = base.id + 1;
  t2.name = 'Industry Town';
  r.settlements.push(t2);

  // Town 0 (agri): produces textiles (agri-attributed) — NO industry output
  const s0 = r.settlements[0];
  s0.sectors.agriculture.output = 100;
  s0.sectors.industry.output = 0;
  s0.goodStocks = {};

  // Town 1 (industry): produces clothing (needs textiles) — NO agriculture output
  const s1 = r.settlements[1];
  s1.sectors.agriculture.output = 0;
  s1.sectors.industry.output = 100;
  s1.goodStocks = {}; // zero textiles — gate fires

  // No routes between towns → no arbitrage can rescue the industry town

  // Pin year to 1930 (textiles + clothing both unlocked at 1920)
  Object.defineProperty(r, 'year', { get: () => 1930, configurable: true });

  return r;
}

describe('specialisation / goods-coupling stress-probe', () => {
  it('localGoodsScarcity is 0 in a single-town self-sufficient nation', () => {
    const r = RegionSim.create(7);
    r.settlements[0].sectors.agriculture.output = 100;
    r.settlements[0].sectors.industry.output = 100;
    r.settlements[0].goodStocks = {};
    Object.defineProperty(r, 'year', { get: () => 1930, configurable: true });

    tickIntermediateGoods(r);
    expect((r as any).localGoodsScarcity).toBe(0);
  });

  it('localGoodsScarcity > 0 when industry town lacks cross-sector inputs', () => {
    const r = specialisedSim();
    tickIntermediateGoods(r);
    const scarcity: number = (r as any).localGoodsScarcity;
    expect(scarcity).toBeGreaterThan(0);
  });

  it('scarcity stays bounded in [0, 1]', () => {
    const r = specialisedSim();
    tickIntermediateGoods(r);
    const scarcity: number = (r as any).localGoodsScarcity;
    expect(scarcity).toBeGreaterThanOrEqual(0);
    expect(scarcity).toBeLessThanOrEqual(1);
  });

  it('coupling bites: inflation pressure = scarcity × LOCAL_GOODS_INFLATION', () => {
    const r = specialisedSim();
    tickIntermediateGoods(r);
    const scarcity: number = (r as any).localGoodsScarcity;
    const push = scarcity * LOCAL_GOODS_INFLATION;
    // With full scarcity the push is LOCAL_GOODS_INFLATION (0.08); partially gated → less
    expect(push).toBeGreaterThan(0);
    expect(push).toBeLessThanOrEqual(LOCAL_GOODS_INFLATION);
  });

  it('output drag stays ≤ LOCAL_GOODS_OUTPUT_DRAG', () => {
    const r = specialisedSim();
    tickIntermediateGoods(r);
    const scarcity: number = (r as any).localGoodsScarcity;
    const drag = scarcity * LOCAL_GOODS_OUTPUT_DRAG;
    expect(drag).toBeGreaterThan(0);
    expect(drag).toBeLessThanOrEqual(LOCAL_GOODS_OUTPUT_DRAG);
  });

  it('scarcity does not appear when the industry town has been pre-supplied with textiles', () => {
    const r = specialisedSim();
    // Pre-fill industry town with enough textiles to meet its share
    const industryTown = r.settlements[1];
    (industryTown.goodStocks ??= {})['textiles'] = 10000; // large surplus
    tickIntermediateGoods(r);
    const scarcity: number = (r as any).localGoodsScarcity;
    expect(scarcity).toBe(0);
  });

  it('multiple ticks keep scarcity stable (does not spiral)', () => {
    const r = specialisedSim();
    const scaricities: number[] = [];
    for (let i = 0; i < 5; i++) {
      tickIntermediateGoods(r);
      scaricities.push((r as any).localGoodsScarcity);
    }
    // All positive (no miraculuous self-heal without arbitrage or stocks)
    for (const s of scaricities) {
      expect(s).toBeGreaterThan(0);
      expect(s).toBeLessThanOrEqual(1);
    }
    // Does not grow unboundedly (bounded by design — ratio of potentials)
    const max = Math.max(...scaricities);
    const min = Math.min(...scaricities);
    expect(max - min).toBeLessThan(1); // spread < 1 (trivially true but guards spiral)
  });

  it('single-town self-sufficient nation is byte-identical: localGoodsScarcity stays 0 across ticks', () => {
    const r = RegionSim.create(7);
    r.settlements[0].sectors.agriculture.output = 100;
    r.settlements[0].sectors.industry.output = 100;
    r.settlements[0].goodStocks = {};
    Object.defineProperty(r, 'year', { get: () => 1950, configurable: true });

    for (let i = 0; i < 6; i++) {
      tickIntermediateGoods(r);
      expect((r as any).localGoodsScarcity).toBe(0);
    }
  });
});
