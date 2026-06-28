import { describe, expect, it } from 'vitest';
import { RegionSim, OIL_EMBARGO_DAYS, SUPPLY_SHOCK_INFLATION } from '../src/sim/region';
import { tickIntermediateGoods } from '../src/sim/systems/goods';
import { MINUTES_PER_DAY, DAYS_PER_YEAR, START_YEAR } from '../src/sim/defs';

/**
 * Cost-push inflation from a supply-chain shock (GDD §5.2). A shortage is not
 * only fewer goods made (the bounded `supplyShockMult` output drag) — it is also
 * dearer goods. The 1973 oil embargo quadrupled prices; that stagflation half of
 * the shock was missing. The monthly inflation target now gains
 * `supplyShockSeverity × SUPPLY_SHOCK_INFLATION`, so a real cascade lifts prices
 * a few points and heals as the chain does — but is exactly 0 in healthy play
 * (severity is 0 whenever raws flow), so the monetary stream stays byte-identical
 * there. These tests pin the mechanic; the full suite proves the byte-identity.
 */

const NEUTRAL_RATE = 0.05; // policyRate default; keeps leverage-inflation at 0 here
const REVERT = 0.15;       // tickMonetary inflation mean-reversion per month
const BASE_TARGET = 0.02;  // tickMonetary base inflation target

function freshSim(seed = 7): RegionSim {
  return RegionSim.create(seed, { aiDifficulty: 'normal', currencySymbol: '$' });
}

/** A central bank is the gate for tickMonetary (and so for the cost-push). */
function withCentralBank(r: RegionSim): RegionSim {
  r.researched.add('central_banking');
  expect(r.hasCentralBank()).toBe(true);
  expect(r.policyRate).toBeCloseTo(NEUTRAL_RATE, 10); // leverage term stays 0
  return r;
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

const tickMonetary = (r: RegionSim): void =>
  (r as unknown as { tickMonetary(): void }).tickMonetary();

/** Closed form for the mean-reversion in tickMonetary with a constant target:
 *  x_K = target + (x0 − target)·(1 − REVERT)^K. With default policyRate the
 *  leverage/print terms are 0, so target = BASE_TARGET + severity·gain. */
function revertedInflation(x0: number, target: number, months: number): number {
  return target + (x0 - target) * Math.pow(1 - REVERT, months);
}

// ============================================================
// 1. Healthy play: severity 0 → no cost-push (byte-identical contract)
// ============================================================
describe('cost-push is inert in healthy play', () => {
  it('severity is 0 with no shock, so the inflation target is unchanged', () => {
    const r = withCentralBank(freshSim());
    pinYear(r, 1975); // every good unlocked
    flowAllRaws(r);
    tickIntermediateGoods(r);
    expect(r.supplyShockSeverity()).toBe(0); // the multiplicand — push is exactly 0

    // Starting at the base target, ticking the monetary system many times keeps
    // inflation pinned at the base (target == base == start) — no drift from a push.
    expect(r.inflationRate).toBeCloseTo(BASE_TARGET, 10);
    for (let i = 0; i < 24; i++) tickMonetary(r);
    expect(r.inflationRate).toBeCloseTo(BASE_TARGET, 10);
  });
});

// ============================================================
// 2. A real oil shock pushes inflation above an identical no-shock control
// ============================================================
describe('an oil embargo drives cost-push inflation', () => {
  it('lifts inflation above an otherwise-identical control with no embargo', () => {
    const control = withCentralBank(freshSim());
    const shocked = withCentralBank(freshSim());
    for (const r of [control, shocked]) {
      pinYear(r, 1975);
      flowAllRaws(r);
    }
    embargoOil(shocked, 0.6); // the historical partial cut
    tickIntermediateGoods(control);
    tickIntermediateGoods(shocked);

    expect(control.supplyShockSeverity()).toBe(0);
    expect(shocked.supplyShockSeverity()).toBeGreaterThan(0);

    // Sustain both for the embargo window; only the shocked chain pushes prices.
    for (let i = 0; i < 12; i++) {
      tickMonetary(control);
      tickMonetary(shocked);
    }
    expect(control.inflationRate).toBeCloseTo(BASE_TARGET, 6);
    expect(shocked.inflationRate).toBeGreaterThan(control.inflationRate);
  });

  it('tracks the severity·gain target via the monetary mean-reversion', () => {
    const r = withCentralBank(freshSim());
    pinYear(r, 1975);
    flowAllRaws(r);
    embargoOil(r, 0.6);
    tickIntermediateGoods(r);

    // Severity for the partial cut: 4 oil-burning goods at level 0.4 of 16.
    const severity = 1 - (12 + 4 * 0.4) / 16; // 0.15
    expect(r.supplyShockSeverity()).toBeCloseTo(severity, 10);

    const target = BASE_TARGET + severity * SUPPLY_SHOCK_INFLATION;
    const months = 12;
    for (let i = 0; i < months; i++) tickMonetary(r);
    expect(r.inflationRate).toBeCloseTo(revertedInflation(BASE_TARGET, target, months), 8);
    // A visible few-points bump, not a runaway.
    expect(r.inflationRate).toBeGreaterThan(0.035);
  });
});

// ============================================================
// 3. The push scales with severity and stays bounded
// ============================================================
describe('cost-push scales with severity and is bounded', () => {
  it('a total cut pushes harder than a partial cut', () => {
    const partial = withCentralBank(freshSim());
    const total = withCentralBank(freshSim());
    for (const r of [partial, total]) {
      pinYear(r, 1975);
      flowAllRaws(r);
    }
    embargoOil(partial, 0.6);
    embargoOil(total, 1);
    tickIntermediateGoods(partial);
    tickIntermediateGoods(total);

    expect(total.supplyShockSeverity()).toBeGreaterThan(partial.supplyShockSeverity());
    for (let i = 0; i < 12; i++) {
      tickMonetary(partial);
      tickMonetary(total);
    }
    expect(total.inflationRate).toBeGreaterThan(partial.inflationRate);
  });

  it('never breaches the 0.50 inflation ceiling, even at maximum severity', () => {
    const r = withCentralBank(freshSim());
    pinYear(r, 1975);
    // Force the worst case: zero supply health against a fully-unlocked baseline.
    r.supplyChainHealth = 0;
    expect(r.supplyShockSeverity()).toBeCloseTo(1, 10);

    for (let i = 0; i < 100; i++) {
      tickMonetary(r);
      expect(r.inflationRate).toBeLessThanOrEqual(0.5);
    }
    // The cost-push target alone is BASE + gain (= 0.32), well under the cap.
    expect(r.inflationRate).toBeCloseTo(BASE_TARGET + SUPPLY_SHOCK_INFLATION, 6);
  });
});

// ============================================================
// 4. Healing: the push vanishes when the chain recovers
// ============================================================
describe('cost-push heals with the chain', () => {
  it('inflation falls back toward base once the embargo lifts', () => {
    const r = withCentralBank(freshSim());
    pinYear(r, 1975);
    flowAllRaws(r);
    embargoOil(r, 1); // total cut → strong push
    tickIntermediateGoods(r);
    for (let i = 0; i < 12; i++) tickMonetary(r);
    const shockedInflation = r.inflationRate;
    expect(shockedInflation).toBeGreaterThan(BASE_TARGET + 0.01);

    // Lift the embargo: prune it, re-resolve the chain → full health, severity 0.
    delete r.rawEmbargoes['oil'];
    tickIntermediateGoods(r);
    expect(r.supplyShockSeverity()).toBe(0);

    for (let i = 0; i < 36; i++) tickMonetary(r);
    expect(r.inflationRate).toBeLessThan(shockedInflation);
    expect(r.inflationRate).toBeCloseTo(BASE_TARGET, 3); // back to within ~0.05pp of base
  });
});
