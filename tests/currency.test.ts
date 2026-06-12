import { describe, it, expect } from 'vitest';
import {
  computePenalty, transitionEfficiency, transitionVolatility,
  ANNOUNCE_DISCOUNT, ANNOUNCE_LEAD_DAYS,
} from '../src/sim/currency';
import type { CurrencyTransition } from '../src/sim/currency';

describe('cause-based currency penalties', () => {
  it('crisis switches are lighter than political, political lighter than strategic', () => {
    const crisis = computePenalty('crisis', false, 0);
    const political = computePenalty('political', false, 0);
    const strategic = computePenalty('strategic', false, 0);
    expect(crisis.efficiencyMult).toBeGreaterThan(political.efficiencyMult);
    expect(political.efficiencyMult).toBeGreaterThan(strategic.efficiencyMult);
    expect(crisis.capitalFlightFrac).toBeLessThan(political.capitalFlightFrac);
    expect(political.capitalFlightFrac).toBeLessThan(strategic.capitalFlightFrac);
    expect(crisis.recoveryDays).toBeLessThan(political.recoveryDays);
    expect(political.recoveryDays).toBeLessThan(strategic.recoveryDays);
  });

  it('strategic penalties land in the design band (20–30% hit, 10–15% flight, 2–3y)', () => {
    const p = computePenalty('strategic', false, 0);
    expect(1 - p.efficiencyMult).toBeGreaterThanOrEqual(0.20);
    expect(1 - p.efficiencyMult).toBeLessThanOrEqual(0.30);
    expect(p.capitalFlightFrac).toBeGreaterThanOrEqual(0.10);
    expect(p.capitalFlightFrac).toBeLessThanOrEqual(0.15);
    expect(p.recoveryDays).toBeGreaterThanOrEqual(720);
    expect(p.recoveryDays).toBeLessThanOrEqual(1095);
  });

  it('announcing ahead softens every dimension by the discount', () => {
    const cold = computePenalty('strategic', false, 0);
    const announced = computePenalty('strategic', true, 0);
    expect(1 - announced.efficiencyMult).toBeCloseTo((1 - cold.efficiencyMult) * (1 - ANNOUNCE_DISCOUNT), 5);
    expect(announced.capitalFlightFrac).toBeCloseTo(cold.capitalFlightFrac * (1 - ANNOUNCE_DISCOUNT), 5);
    expect(announced.recoveryDays).toBeLessThan(cold.recoveryDays);
  });

  it('reserves shelter capital, capped at half the flight', () => {
    const broke = computePenalty('strategic', false, 0);
    const cushioned = computePenalty('strategic', false, 10);
    const fortress = computePenalty('strategic', false, 100);
    expect(cushioned.capitalFlightFrac).toBeLessThan(broke.capitalFlightFrac);
    expect(fortress.capitalFlightFrac).toBeCloseTo(broke.capitalFlightFrac * 0.5, 5);
    // reserves do not change efficiency or recovery — only flight
    expect(cushioned.efficiencyMult).toBe(broke.efficiencyMult);
  });

  it('announce lead constant matches the 6-month design', () => {
    expect(ANNOUNCE_LEAD_DAYS).toBe(180);
  });
});

describe('transition recovery', () => {
  const t: CurrencyTransition = {
    newSymbol: '€', cause: 'strategic',
    startDay: 100, endDay: 200, startEfficiencyMult: 0.75,
  };

  it('efficiency starts at the hit and recovers linearly to 1', () => {
    expect(transitionEfficiency(t, 100)).toBeCloseTo(0.75, 5);
    expect(transitionEfficiency(t, 150)).toBeCloseTo(0.875, 5);
    expect(transitionEfficiency(t, 200)).toBe(1);
    expect(transitionEfficiency(t, 999)).toBe(1);
    expect(transitionEfficiency(null, 50)).toBe(1);
  });

  it('volatility is bounded at ±15% and fades to nothing', () => {
    expect(transitionVolatility(t, 100, 1)).toBeCloseTo(1.15, 5);
    expect(transitionVolatility(t, 100, 0)).toBeCloseTo(0.85, 5);
    expect(transitionVolatility(t, 150, 1)).toBeCloseTo(1.075, 5);
    expect(transitionVolatility(t, 200, 1)).toBe(1);
    expect(transitionVolatility(null, 100, 1)).toBe(1);
  });
});
