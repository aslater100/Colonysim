import { describe, it, expect } from 'vitest';
import {
  RegionSim,
  FRONT_PEAK_LEVERAGE_SCALE,
  OCCUPATION_SCORE_DISCOUNT,
  PEACE_TERMS,
  type RivalNation,
  type PlayerWar,
} from '../src/sim/region';

/**
 * Front peak → peace leverage (GDD §7.4).
 *
 * A deep advance earns diplomatic leverage even after the line retreats:
 * peakLeverage = floor(max(0, front.peak) × FRONT_PEAK_LEVERAGE_SCALE).
 * This is folded into peaceBasketAsk alongside the occupation discount.
 *
 * Pure query, player-initiated only → byte-identical in headless (no player wars).
 */

function makeRegion(seed = 42): RegionSim {
  return RegionSim.create(seed);
}

function ensureRival(r: RegionSim): RivalNation {
  if (r.rivals.length === 0) {
    (r as unknown as { spawnRival: () => void }).spawnRival();
  }
  return r.rivals[0];
}

function setWar(r: RegionSim, rv: RivalNation, peak: number, occupied = 0): void {
  (r as unknown as { playerWar: PlayerWar }).playerWar = {
    rivalId: rv.id, cb: 'fabricated', defensive: false, startedDay: r.day,
    support: 70, score: 20, mobilization: 'limited', casualties: 0,
    blockade: false, allies: [], enemyAllies: [],
    occupied, resistance: 0, occupationPolicy: 'conciliatory', brutality: false,
    units: [], supplyReserve: 3,
    front: { position: 20, peak, phase: 'advancing' },
  };
}

// ---- constant ----

describe('FRONT_PEAK_LEVERAGE_SCALE', () => {
  it('is exported and positive', () => {
    expect(typeof FRONT_PEAK_LEVERAGE_SCALE).toBe('number');
    expect(FRONT_PEAK_LEVERAGE_SCALE).toBeGreaterThan(0);
  });

  it('a peak of 100 gives a meaningful discount (≥10 points)', () => {
    expect(Math.floor(100 * FRONT_PEAK_LEVERAGE_SCALE)).toBeGreaterThanOrEqual(10);
  });
});

// ---- peaceBasketAsk with front peak ----

describe('peaceBasketAsk — front-peak leverage', () => {
  it('deep peak discounts the ask relative to no peak', () => {
    const r = makeRegion();
    const rv = ensureRival(r);
    rv.weights.grudge = 0; // neutralise grudge for clarity

    setWar(r, rv, 0, 0); // no peak, no occupation
    const baseAsk = r.peaceBasketAsk(rv, ['reparations']);

    setWar(r, rv, 80, 0); // breakthrough peak, no occupation
    const leveragedAsk = r.peaceBasketAsk(rv, ['reparations']);

    expect(leveragedAsk).toBeLessThan(baseAsk);
  });

  it('leverage equals floor(peak × FRONT_PEAK_LEVERAGE_SCALE)', () => {
    const r = makeRegion();
    const rv = ensureRival(r);
    rv.weights.grudge = 0;

    const peak = 80;
    setWar(r, rv, peak, 0);
    const ask = r.peaceBasketAsk(rv, ['reparations']);

    const reparationsScore = PEACE_TERMS['reparations'].score; // 30
    const expectedLeverage = Math.floor(peak * FRONT_PEAK_LEVERAGE_SCALE);
    expect(ask).toBe(Math.max(0, reparationsScore - expectedLeverage));
  });

  it('negative peak yields zero leverage (defensive war — no discount for being pushed back)', () => {
    const r = makeRegion();
    const rv = ensureRival(r);
    rv.weights.grudge = 0;

    setWar(r, rv, 0, 0); // zero peak
    const baseAsk = r.peaceBasketAsk(rv, ['reparations']);

    setWar(r, rv, -60, 0); // negative peak (we were pushed back hard)
    const defensiveAsk = r.peaceBasketAsk(rv, ['reparations']);

    expect(defensiveAsk).toBe(baseAsk); // no extra penalty, no extra discount
  });

  it('peak and occupation discounts stack', () => {
    const r = makeRegion();
    const rv = ensureRival(r);
    rv.weights.grudge = 0;

    setWar(r, rv, 0, 0);
    const baseAsk = r.peaceBasketAsk(rv, ['reparations']);

    setWar(r, rv, 0, 2); // 2 marches held
    const occupiedAsk = r.peaceBasketAsk(rv, ['reparations']);

    setWar(r, rv, 60, 2); // 2 marches + deep peak
    const bothAsk = r.peaceBasketAsk(rv, ['reparations']);

    const occDiscount = 2 * OCCUPATION_SCORE_DISCOUNT;
    const peakDiscount = Math.floor(60 * FRONT_PEAK_LEVERAGE_SCALE);

    expect(occupiedAsk).toBe(Math.max(0, baseAsk - occDiscount));
    expect(bothAsk).toBe(Math.max(0, baseAsk - occDiscount - peakDiscount));
    expect(bothAsk).toBeLessThan(occupiedAsk);
  });

  it('ask floors at 0 even with an extreme peak', () => {
    const r = makeRegion();
    const rv = ensureRival(r);
    rv.weights.grudge = 0;

    setWar(r, rv, 100, 3); // max peak + max marches
    const ask = r.peaceBasketAsk(rv, ['reparations']); // reparations=30, max discount > 30

    expect(ask).toBeGreaterThanOrEqual(0);
  });

  it('grudge premium still applies on top of peak leverage', () => {
    const r = makeRegion();
    const rv = ensureRival(r);

    rv.weights.grudge = 5;
    setWar(r, rv, 0, 0);
    const grudgeAsk = r.peaceBasketAsk(rv, ['reparations']); // 30 + 5×2 = 40

    rv.weights.grudge = 5;
    setWar(r, rv, 80, 0);
    const leveragedGrudgeAsk = r.peaceBasketAsk(rv, ['reparations']); // 40 − floor(80×0.15)

    const expectedLeverage = Math.floor(80 * FRONT_PEAK_LEVERAGE_SCALE);
    expect(leveragedGrudgeAsk).toBe(Math.max(0, grudgeAsk - expectedLeverage));
  });
});
