/**
 * Sim catch-up budgeting for the main animation loop.
 *
 * The loop accumulates fractional ticks (`acc`) at `TICKS_PER_SECOND × speed`
 * and drains them by calling `region.tick()` once per whole tick. The original
 * loop drained up to a *fixed 64 iterations* per frame — but ticks are not
 * uniformly cheap: the monthly/yearly economy spike is a ~10–14 ms single tick
 * (see `scripts/bench-region.ts`). A cluster of those inside one frame blew the
 * 16.7 ms budget and stuttered, regardless of the iteration count.
 *
 * `runCatchUp` instead budgets the drain by **wall-clock time**: it ticks until
 * the time budget is spent, the backlog is cleared, or a hard iteration ceiling
 * is hit — whichever comes first. A heavy tick can no longer blow the frame; the
 * calendar simply lags (runs at an effective <Nx for a frame and catches up
 * later), which is invisible next to a dropped frame. Backlog carried to the
 * next frame is clamped so a sustained budget-bound stretch can't spiral into an
 * ever-growing catch-up debt.
 *
 * Pure and side-effect-free except through the injected `tick`/`now` callbacks,
 * so it unit-tests with a fake clock — no AudioContext, canvas, or RAF needed.
 */

export interface CatchUpOpts {
  /** Wall-clock ms to spend ticking before yielding the frame. */
  budgetMs: number;
  /** Hard ceiling on ticks per call — backstops a cheap-tick flood so the loop
   *  always terminates even if the clock never advances (e.g. a stubbed timer). */
  maxTicks: number;
  /** Max backlog (in whole ticks) to carry into the next frame. */
  maxBacklog: number;
}

export interface CatchUpResult {
  /** The remaining accumulator after draining — feed back into the loop. */
  acc: number;
  /** How many ticks actually ran this call (for telemetry / tests). */
  ticks: number;
  /** True if the wall-clock budget (not the backlog) ended the drain — i.e. the
   *  sim is falling behind real time and the calendar is lagging. */
  budgetBound: boolean;
}

/**
 * Drain `acc` whole ticks under a wall-clock budget. `tick` runs one sim step;
 * `now` returns a monotonic clock in ms (`performance.now` in the app, a fake in
 * tests). The time check happens *after* each tick, so a single tick that
 * overruns the budget still completes (you can't un-run it) but no further tick
 * starts — bounding the overrun to one tick's worth.
 */
export function runCatchUp(
  acc: number,
  tick: () => void,
  now: () => number,
  opts: CatchUpOpts,
): CatchUpResult {
  const start = now();
  let ticks = 0;
  let budgetBound = false;
  while (acc >= 1 && ticks < opts.maxTicks) {
    tick();
    acc -= 1;
    ticks++;
    if (now() - start >= opts.budgetMs) {
      budgetBound = acc >= 1; // only "bound" if there was still work to do
      break;
    }
  }
  if (acc > opts.maxBacklog) acc = opts.maxBacklog;
  return { acc, ticks, budgetBound };
}
