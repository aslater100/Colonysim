/**
 * Region (4X) scale benchmark — the perf guard the shipping game lacked.
 *
 * Measures the real `RegionSim.tick()` across game stages so we can defend
 * 60fps from a 1919 colony to a 2000 nation — the "smooth at every stage"
 * guarantee. (Supersedes the removed `bench-scale`/`bench-agents`, which benched
 * the dropped town engine — `Simulation`/`AgentStore` — not the 4X campaign.)
 *
 *   npx tsx scripts/bench-region.ts            # default fixed tick budget
 *   npx tsx scripts/bench-region.ts 6000       # custom ticks per stage
 *
 * Frame model (matches src/main.ts `runCatchUp`): each rendered frame replays
 * accumulated sim time by ticking until either the wall-clock CATCH-UP BUDGET
 * (~8 ms) is spent or a tick cap is hit — whichever first — then renders, letting
 * the calendar lag instead of stalling the frame. So the guard is NOT "mean × 64":
 *  - The hard gate is the WORST SINGLE TICK. A tick longer than a whole 16.7 ms
 *    frame (`FRAME_MS`) is an unconditional stutter the budget cannot hide (the
 *    loop always runs at least one tick), so that FAILS.
 *  - A worst tick over the 8 ms budget (`BUDGET_MS`) but under a frame only means
 *    the calendar advances one tick that frame instead of several — smooth, just
 *    budget-bound — so that WARNs, it does not fail.
 *  - Mean ms/tick is reported as throughput (how many ticks fit in one 8 ms
 *    budget = catch-up headroom), not as a pass/fail verdict.
 */
import { performance } from 'node:perf_hooks';
import { RegionSim } from '../src/sim/region';

/** 60 fps frame. A single tick longer than this always drops a frame. */
const FRAME_MS = 16.7;
/** Wall-clock sim catch-up budget per frame (src/main.ts). */
const BUDGET_MS = 8;

// Fixed timing budget (the sim's calendar acceleration means this spans several
// game-years; we report the actual span per stage).
const TICKS = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 12000;

const SEED = 12345;
const STAGES: { name: string; build: () => RegionSim }[] = [
  { name: 'early colony 1919', build: () => RegionSim.create(SEED) },
  { name: 'mid nation 1950', build: () => RegionSim.fromEraStart('1950', { seed: SEED }) },
  { name: 'late nation 2000', build: () => RegionSim.fromEraStart('2000', { seed: SEED }) },
];

console.log(`frame ${FRAME_MS}ms @60fps; sim catch-up budget ~${BUDGET_MS}ms/frame (main.ts runCatchUp)`);
console.log(`gate = worst single tick < ${FRAME_MS}ms (a longer tick always stutters)`);
console.log(`${TICKS} ticks/stage (fixed timing budget)\n`);
console.log('stage              | towns | span(yrs) | mean ms/tick | ticks/budget | max ms/tick | verdict        | heapMB');
console.log('-------------------+-------+-----------+--------------+--------------+-------------+----------------+-------');

let anyDrop = false;
for (const stage of STAGES) {
  const r = stage.build();
  for (let i = 0; i < 50; i++) r.tick(); // warm up V8 (JIT)

  if (global.gc) global.gc();
  const y0 = r.year;
  let maxTick = 0;
  const t0 = performance.now();
  for (let i = 0; i < TICKS; i++) {
    const s = performance.now();
    r.tick();
    const dt = performance.now() - s;
    if (dt > maxTick) maxTick = dt;
  }
  const elapsed = performance.now() - t0;

  const meanMs = elapsed / TICKS;
  const ticksPerBudget = BUDGET_MS / meanMs; // catch-up headroom: ticks per 8ms frame
  const drops = maxTick > FRAME_MS;          // the hard gate: a frame-busting tick
  const budgetBound = !drops && maxTick > BUDGET_MS;
  anyDrop = anyDrop || drops;
  const heapMB = process.memoryUsage().heapUsed / 1024 / 1024;
  const verdict = drops
    ? `${maxTick.toFixed(0)}ms — DROPS`
    : budgetBound
      ? `ok (budget-bound)`
      : `ok`;

  console.log(
    `${stage.name.padEnd(18)} | ${String(r.settlements.length).padStart(5)} | ` +
    `${`${y0}-${r.year}`.padStart(9)} | ` +
    `${meanMs.toFixed(4).padStart(12)} | ${ticksPerBudget.toFixed(0).padStart(12)} | ` +
    `${maxTick.toFixed(3).padStart(11)} | ${verdict.padStart(14)} | ${heapMB.toFixed(0).padStart(6)}`,
  );
}

console.log(`\nperf gate: ${anyDrop ? 'FAIL — a single tick exceeds one frame ❌' : 'PASS — worst tick fits a frame ✅'}`);
process.exit(anyDrop ? 1 : 0);
