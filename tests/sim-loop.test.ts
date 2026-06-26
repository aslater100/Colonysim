import { describe, it, expect } from 'vitest';
import { runCatchUp, type CatchUpOpts } from '../src/ui/simLoop';

const OPTS: CatchUpOpts = { budgetMs: 8, maxTicks: 240, maxBacklog: 240 };

/** A fake monotonic clock that advances `ms` per read — models tick cost. */
function fakeClock(msPerRead: number): () => number {
  let t = 0;
  return () => {
    const v = t;
    t += msPerRead;
    return v;
  };
}

describe('runCatchUp', () => {
  it('drains the whole backlog when ticks are cheap and within budget', () => {
    let ticks = 0;
    const res = runCatchUp(10, () => ticks++, fakeClock(0), OPTS);
    expect(ticks).toBe(10);
    expect(res.ticks).toBe(10);
    expect(res.acc).toBeCloseTo(0);
    expect(res.budgetBound).toBe(false);
  });

  it('leaves the fractional remainder below one tick', () => {
    const res = runCatchUp(3.7, () => {}, fakeClock(0), OPTS);
    expect(res.ticks).toBe(3);
    expect(res.acc).toBeCloseTo(0.7);
  });

  it('does nothing when less than a whole tick is queued', () => {
    let ticks = 0;
    const res = runCatchUp(0.5, () => ticks++, fakeClock(0), OPTS);
    expect(ticks).toBe(0);
    expect(res.acc).toBeCloseTo(0.5);
  });

  it('stops on the wall-clock budget rather than running the full backlog', () => {
    // Clock advances 3 ms per read; after ~3 reads it crosses the 8 ms budget.
    let ticks = 0;
    const res = runCatchUp(100, () => ticks++, fakeClock(3), OPTS);
    expect(ticks).toBeLessThan(100);
    expect(ticks).toBeGreaterThanOrEqual(3); // a few ticks land before the budget
    expect(res.budgetBound).toBe(true);
    expect(res.acc).toBeGreaterThan(1); // backlog remains, carried to next frame
  });

  it('lets a single over-budget tick complete but starts no further tick', () => {
    // One read already exceeds the whole budget: exactly one tick runs.
    let ticks = 0;
    const res = runCatchUp(50, () => ticks++, fakeClock(20), OPTS);
    expect(ticks).toBe(1);
    expect(res.budgetBound).toBe(true);
  });

  it('honours the hard tick ceiling even if the clock never advances', () => {
    let ticks = 0;
    const res = runCatchUp(10_000, () => ticks++, fakeClock(0), OPTS);
    expect(ticks).toBe(OPTS.maxTicks);
  });

  it('clamps the carried backlog so catch-up debt cannot spiral', () => {
    const res = runCatchUp(10_000, () => {}, fakeClock(20), OPTS);
    expect(res.acc).toBeLessThanOrEqual(OPTS.maxBacklog);
  });

  it('is not budget-bound when the backlog is fully cleared at the buzzer', () => {
    // Exactly 4 ticks of work; the 4th read crosses the budget but nothing is
    // left to do, so it should not report as falling behind.
    const res = runCatchUp(4, () => {}, fakeClock(2), { ...OPTS, budgetMs: 8 });
    expect(res.ticks).toBe(4);
    expect(res.budgetBound).toBe(false);
  });
});
