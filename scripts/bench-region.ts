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
 * Frame budget: 16.7ms at 60fps. The main loop runs up to 64 `region.tick()`
 * per frame at 8× speed (main.ts), so a full catch-up frame must clear 64 ticks
 * in 16.7ms. We report MEAN ms/tick (→ the 64× verdict) AND the worst single
 * tick — the monthly/yearly spike that actually causes a visible stutter.
 */
import { performance } from 'node:perf_hooks';
import { RegionSim } from '../src/sim/region';

// Fixed timing budget (the sim's calendar acceleration means this spans several
// game-years; we report the actual span per stage).
const TICKS = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 12000;

const SEED = 12345;
const STAGES: { name: string; build: () => RegionSim }[] = [
  { name: 'early colony 1919', build: () => RegionSim.create(SEED) },
  { name: 'mid nation 1950', build: () => RegionSim.fromEraStart('1950', { seed: SEED }) },
  { name: 'late nation 2000', build: () => RegionSim.fromEraStart('2000', { seed: SEED }) },
];

console.log(`frame budget 16.7ms @60fps; main loop runs up to 64 ticks/frame at 8×`);
console.log(`${TICKS} ticks/stage (fixed timing budget)\n`);
console.log('stage              | towns | span(yrs) | mean ms/tick | max ms/tick | 64-tick frame   | heapMB');
console.log('-------------------+-------+-----------+--------------+-------------+-----------------+-------');

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
  const frame64 = meanMs * 64;
  const drops = frame64 >= 16.7;
  anyDrop = anyDrop || drops;
  const heapMB = process.memoryUsage().heapUsed / 1024 / 1024;
  const verdict = drops ? `${frame64.toFixed(0)}ms — DROPS` : `ok (${frame64.toFixed(1)}ms)`;

  console.log(
    `${stage.name.padEnd(18)} | ${String(r.settlements.length).padStart(5)} | ` +
    `${`${y0}-${r.year}`.padStart(9)} | ` +
    `${meanMs.toFixed(4).padStart(12)} | ${maxTick.toFixed(3).padStart(11)} | ` +
    `${verdict.padStart(15)} | ${heapMB.toFixed(0).padStart(6)}`,
  );
}

console.log(`\nperf gate: ${anyDrop ? 'FAIL — a stage drops frames ❌' : 'PASS — every stage holds 60fps ✅'}`);
process.exit(anyDrop ? 1 : 0);
