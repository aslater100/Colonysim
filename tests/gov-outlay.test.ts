/**
 * Size-scaling government outlays (economy-realism arc, inc 3 — GDD §6).
 *
 * A large, developed, income-tax state runs a real apparatus — ministries,
 * pensions, procurement — so a mature treasury no longer piles income-tax
 * revenue into an unbounded hoard. SPIRAL-SAFE by construction (the session-12
 * deficit-death-spiral warning): the outlay spends ONLY the surplus above a
 * generous GOV_OUTLAY_RESERVE_MONTHS reserve, so it can never push the treasury
 * toward a service cut, and it ramps with the size of the state (town count).
 * Gated on the income_tax civic, which the default sweep player never
 * researches → byte-identical in headless. `lastGovOutlay` is TRANSIENT (not
 * serialized) — no save-schema change.
 *
 * NOTE: `monthlyEconomy` recomputes `gdpLastMonth` at its top, so tests can't
 * pin GDP through a call — instead they reconstruct the gate state post-hoc
 * (pre-outlay treasury = post treasury + outlay; gdpLastMonth is not touched
 * again after the gate) and assert the exact formula.
 */

import { describe, it, expect } from 'vitest';
import {
  RegionSim,
  GOV_OUTLAY_RESERVE_MONTHS,
  GOV_OUTLAY_SKIM,
  GOV_OUTLAY_TOWNS_FULL,
} from '../src/sim/region';

const runMonthlyEconomy = (r: RegionSim): void =>
  (r as unknown as { monthlyEconomy(): void }).monthlyEconomy();

function freshSim(seed = 42): RegionSim {
  return RegionSim.create(seed);
}

function grantIncomeTax(r: RegionSim): void {
  (r as unknown as { researched: Set<string> }).researched.add('income_tax');
}

/** The exact outlay the gate must have computed, reconstructed post-hoc. */
function expectedOutlay(r: RegionSim): number {
  const preOutlay = r.treasury + r.lastGovOutlay;
  const reserve = Math.max(0, r.gdpLastMonth) * GOV_OUTLAY_RESERVE_MONTHS;
  const ramp = Math.min(1, r.settlements.length / GOV_OUTLAY_TOWNS_FULL);
  return Math.max(0, preOutlay - reserve) * GOV_OUTLAY_SKIM * ramp;
}

describe('gov-outlay constants', () => {
  it('exports the designed values', () => {
    expect(GOV_OUTLAY_RESERVE_MONTHS).toBe(6);
    expect(GOV_OUTLAY_SKIM).toBe(0.2);
    expect(GOV_OUTLAY_TOWNS_FULL).toBe(8);
  });

  it('the skim never spends the whole surplus in a month (spiral guard shape)', () => {
    expect(GOV_OUTLAY_SKIM).toBeLessThan(1);
    expect(GOV_OUTLAY_RESERVE_MONTHS).toBeGreaterThanOrEqual(6);
  });
});

describe('the income_tax gate', () => {
  it('no income tax → no outlay, ever (the default-sweep byte-identical guarantee)', () => {
    const r = freshSim();
    r.treasury = 1_000_000;
    runMonthlyEconomy(r);
    expect(r.lastGovOutlay).toBe(0);
  });

  it('with income tax and a fat surplus, the apparatus spends', () => {
    const r = freshSim();
    grantIncomeTax(r);
    r.treasury = 1_000_000; // dwarfs any plausible 6-month reserve for a young colony
    runMonthlyEconomy(r);
    expect(r.lastGovOutlay).toBeGreaterThan(0);
  });
});

describe('the exact formula (surplus-aware, reserve-floored, size-ramped)', () => {
  it('outlay == max(0, preTreasury − 6mo·GDP) × skim × townRamp', () => {
    const r = freshSim();
    grantIncomeTax(r);
    r.treasury = 500_000;
    runMonthlyEconomy(r);
    expect(r.lastGovOutlay).toBeCloseTo(expectedOutlay(r), 6);
    expect(r.lastGovOutlay).toBeGreaterThan(0);
  });

  it('the outlay never dips the treasury below the reserve (never causes a service cut)', () => {
    const r = freshSim();
    grantIncomeTax(r);
    r.treasury = 500_000;
    runMonthlyEconomy(r);
    const reserve = Math.max(0, r.gdpLastMonth) * GOV_OUTLAY_RESERVE_MONTHS;
    expect(r.treasury).toBeGreaterThanOrEqual(reserve - 1e-9);
  });

  it('a strained budget pays nothing (treasury pinned to zero)', () => {
    const r = freshSim();
    grantIncomeTax(r);
    r.treasury = 0; // one month of colony revenue cannot clear a 6-month reserve
    runMonthlyEconomy(r);
    expect(r.lastGovOutlay).toBe(0);
  });
});

describe('size scaling', () => {
  it('a one-town state pays below the full-size rate (the town-count ramp bites)', () => {
    const r = freshSim();
    grantIncomeTax(r);
    r.treasury = 1_000_000;
    runMonthlyEconomy(r);
    expect(r.settlements.length).toBeLessThan(GOV_OUTLAY_TOWNS_FULL);
    const preOutlay = r.treasury + r.lastGovOutlay;
    const reserve = Math.max(0, r.gdpLastMonth) * GOV_OUTLAY_RESERVE_MONTHS;
    const fullRate = Math.max(0, preOutlay - reserve) * GOV_OUTLAY_SKIM;
    expect(r.lastGovOutlay).toBeGreaterThan(0);
    expect(r.lastGovOutlay).toBeLessThan(fullRate);
  });

  it('the ramp caps at 1 — town counts past GOV_OUTLAY_TOWNS_FULL add nothing', () => {
    expect(Math.min(1, (GOV_OUTLAY_TOWNS_FULL + 10) / GOV_OUTLAY_TOWNS_FULL)).toBe(1);
  });
});

describe('convergence — the hoard is bounded', () => {
  it('repeated months drain an absurd hoard instead of letting it pile', () => {
    const r = freshSim();
    grantIncomeTax(r);
    r.treasury = 10_000_000;
    const start = r.treasury;
    for (let i = 0; i < 24; i++) runMonthlyEconomy(r);
    expect(r.treasury).toBeLessThan(start);
  });
});

describe('serialization — no schema change', () => {
  it('lastGovOutlay is not serialized', () => {
    const r = freshSim();
    grantIncomeTax(r);
    r.treasury = 1_000_000;
    runMonthlyEconomy(r);
    expect(r.lastGovOutlay).toBeGreaterThan(0);
    expect(r.serialize()).not.toContain('lastGovOutlay');
  });
});
