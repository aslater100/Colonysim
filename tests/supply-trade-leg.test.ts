import { describe, expect, it } from 'vitest';
import { RegionSim, OIL_EMBARGO_DAYS, SUPPLY_SHOCK_EXPORT_DRAG } from '../src/sim/region';
import { tickIntermediateGoods } from '../src/sim/systems/goods';

/**
 * Trade leg of the goods→economy coupling (GDD §5.2). A supply-chain shock does
 * not only cut output (`supplyShockMult`) and raise prices (cost-push) — it also
 * chokes *exports*: a nation short on fuel, components, or food has less surplus
 * to sell abroad. `monthlyEconomy()` now scales `exportEarningsLastMonth` by
 * `1 − supplyShockSeverity × SUPPLY_SHOCK_EXPORT_DRAG`, reading the same
 * below-the-era-baseline severity as the other two legs — so it is exactly ×1 in
 * healthy play (byte-identical) and only a real cascade trims foreign sales.
 */

function freshSim(seed = 7): RegionSim {
  return RegionSim.create(seed, { aiDifficulty: 'normal', currencySymbol: '$' });
}

/** Pin the reported year so era-gated goods unlock, without touching `day`. */
function pinYear(r: RegionSim, year: number): void {
  Object.defineProperty(r, 'year', { get: () => year, configurable: true });
}

/** Both extracting sectors produce, so every raw flows on the proxy — only an
 *  explicit embargo can cut a raw in these tests. */
function flowAllRaws(r: RegionSim): void {
  for (const s of r.settlements) {
    s.sectors.industry.output = 100;
    s.sectors.agriculture.output = 100;
  }
}

function embargoOil(r: RegionSim, cut: number): void {
  r.rawEmbargoes['oil'] = { until: r.day + OIL_EMBARGO_DAYS, cut };
}

/** A trade-partner rival so `exportEarningsLastMonth` is non-zero to measure. */
function addTradeRival(r: RegionSim): void {
  (r.rivals as unknown[]).push({
    id: 9001, name: 'Mercantis', leader: 'The Factor', archetype: 'merchant',
    weights: { expansion: 3, commerce: 9, ideology: 3, honor: 7, risk: 3, grudge: 3 },
    regime: 'liberal_democracy', agenda: 'trade', compass: 'east', pop: 100000,
    relations: 60, treaties: ['trade_agreement'], borderSettled: true,
    emergedYear: 1900, history: [], lastEnvoyDay: 0, lastGiftDay: 0,
  });
}

const runMonthlyEconomy = (r: RegionSim): void =>
  (r as unknown as { monthlyEconomy(): void }).monthlyEconomy();

/** A control and a shocked sim, identical but for the embargo, each run through
 *  one monthlyEconomy. The only export difference is the supply-shock drag. */
function pair(embargoCut: number | null): { control: RegionSim; shocked: RegionSim; severity: number } {
  const control = freshSim();
  const shocked = freshSim();
  for (const r of [control, shocked]) {
    pinYear(r, 1975);
    flowAllRaws(r);
    addTradeRival(r);
  }
  if (embargoCut !== null) embargoOil(shocked, embargoCut);
  tickIntermediateGoods(control);
  tickIntermediateGoods(shocked);
  runMonthlyEconomy(control);
  runMonthlyEconomy(shocked);
  return { control, shocked, severity: shocked.supplyShockSeverity() };
}

// ============================================================
// 1. Healthy play: no shock → exports untouched (byte-identical)
// ============================================================
describe('the export drag is inert in healthy play', () => {
  it('with no embargo, severity is 0 and both sims earn identical exports', () => {
    const { control, shocked, severity } = pair(null);
    expect(severity).toBe(0);
    expect(control.supplyShockSeverity()).toBe(0);
    expect(control.exportEarningsLastMonth).toBeGreaterThan(0); // exports exist to measure
    expect(shocked.exportEarningsLastMonth).toBe(control.exportEarningsLastMonth);
  });
});

// ============================================================
// 2. A real shock trims exports by exactly severity·drag
// ============================================================
describe('a supply shock chokes exports', () => {
  it('scales export earnings by 1 − severity·SUPPLY_SHOCK_EXPORT_DRAG', () => {
    const { control, shocked, severity } = pair(0.6); // historical partial oil cut
    expect(severity).toBeCloseTo(1 - (12 + 4 * 0.4) / 16, 10); // 0.15
    expect(control.exportEarningsLastMonth).toBeGreaterThan(0);
    expect(shocked.exportEarningsLastMonth).toBeCloseTo(
      control.exportEarningsLastMonth * (1 - severity * SUPPLY_SHOCK_EXPORT_DRAG),
      6,
    );
    expect(shocked.exportEarningsLastMonth).toBeLessThan(control.exportEarningsLastMonth);
  });

  it('a total cut chokes exports harder than a partial cut', () => {
    const partial = pair(0.6);
    const total = pair(1);
    expect(total.severity).toBeGreaterThan(partial.severity);
    expect(total.shocked.exportEarningsLastMonth).toBeLessThan(partial.shocked.exportEarningsLastMonth);
  });
});

// ============================================================
// 3. Bounded: never more than SUPPLY_SHOCK_EXPORT_DRAG off, never zeroed
// ============================================================
describe('the export drag is bounded', () => {
  it('at maximum severity it trims exactly SUPPLY_SHOCK_EXPORT_DRAG and no more', () => {
    const control = freshSim();
    const shocked = freshSim();
    for (const r of [control, shocked]) {
      pinYear(r, 1975);
      flowAllRaws(r);
      addTradeRival(r);
    }
    tickIntermediateGoods(control);
    // Force the worst case: zero supply health against a fully-unlocked baseline.
    tickIntermediateGoods(shocked);
    shocked.supplyChainHealth = 0;
    expect(shocked.supplyShockSeverity()).toBeCloseTo(1, 10);

    runMonthlyEconomy(control);
    runMonthlyEconomy(shocked);
    // Halved (drag 0.5), never zeroed.
    expect(shocked.exportEarningsLastMonth).toBeCloseTo(
      control.exportEarningsLastMonth * (1 - SUPPLY_SHOCK_EXPORT_DRAG),
      6,
    );
    expect(shocked.exportEarningsLastMonth).toBeGreaterThan(0);
  });
});
