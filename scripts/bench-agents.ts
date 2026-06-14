/**
 * Bench the SoA AgentStore tick against the same ladder as bench-scale.ts, so we
 * can read the new engine's cost next to the fat-object sim's full cost.
 *
 * Two passes:
 *   1. cost FLOOR — straight-line wander, no pathing (Stage 1).
 *   2. flow-field pathing — agents follow shared FlowFields (Stage 2). This is the
 *      apples-to-apples number, because the fat-object sim ran one A* per idle
 *      agent per think; here the search is paid once per field over the whole map
 *      and every agent reads its tile direction in O(1).
 *
 *   npx tsx scripts/bench-agents.ts
 *   npx tsx scripts/bench-agents.ts 200 1000 5000 20000
 */
import { performance } from 'node:perf_hooks';
import { AgentStore } from '../src/sim/agents';
import { FlowField } from '../src/sim/flowfield';

const counts = process.argv.slice(2).map(Number).filter((n) => n > 0);
const AGENT_COUNTS = counts.length ? counts : [200, 500, 1000, 2000, 5000, 10000];
const TICKS = 200;
const MAP = 96; // matches MAP_W/MAP_H

// Deterministic LCG so the bench is repeatable and matches the self-check style.
let rng = 99; const rand = () => (rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

// Synthetic town map: open ground with a few rock blobs, three hot destinations
// (stockpile, hearth, a job cluster). One flow field per destination, all reusable.
const rocks = new Uint8Array(MAP * MAP);
let blobRng = 7; const brand = () => (blobRng = (blobRng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
for (let b = 0; b < 30; b++) {
  const cx = (brand() * MAP) | 0, cy = (brand() * MAP) | 0, r = 1 + ((brand() * 3) | 0);
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const x = cx + dx, y = cy + dy;
    if (x >= 0 && y >= 0 && x < MAP && y < MAP && dx * dx + dy * dy <= r * r) rocks[y * MAP + x] = 1;
  }
}
const passable = (i: number) => rocks[i] === 0;
const stepCost = () => 1;
const GOALS = [[48, 48], [20, 70], [72, 24]];
const fields = GOALS.map(([gx, gy]) => {
  const f = new FlowField(MAP, MAP);
  // Nudge the goal off any rock so the field always has a seed.
  let gi = f.index(gx, gy);
  while (!passable(gi)) gi++;
  f.build([gi], passable, stepCost);
  return f;
});
// Time the field build itself — the once-per-destination cost flow fields amortise.
const fb0 = performance.now();
for (const f of fields) f.build([f.index(48, 48)], passable, stepCost);
const buildMs = (performance.now() - fb0) / fields.length;

function spawnCohort(n: number): AgentStore {
  const store = new AgentStore(n);
  for (let i = 0; i < n; i++) {
    // Scatter on passable tiles across the map (not just one corner).
    let x = 4 + (i % 88), y = 4 + (((i / 88) | 0) * 7) % 88;
    while (!passable(y * MAP + x)) { x = (x + 1) % MAP; if (x === 0) y = (y + 1) % MAP; }
    store.spawn(x + 0.5, y + 0.5);
  }
  return store;
}

function benchPass(withFields: boolean): void {
  console.log('agents |  ms/tick | µs/agent | heapMB | full-frame? (64 ticks)');
  console.log('-------+----------+----------+--------+-----------------------');
  for (const n of AGENT_COUNTS) {
    const store = spawnCohort(n);
    if (withFields) store.fields = fields;

    for (let i = 0; i < 20; i++) store.tick(i, rand); // warm up JIT

    if (global.gc) global.gc();
    const t0 = performance.now();
    for (let i = 0; i < TICKS; i++) store.tick(i + 20, rand);
    const elapsed = performance.now() - t0;

    const msPerTick = elapsed / TICKS;
    const usPerAgent = (msPerTick * 1000) / n;
    const heapMB = process.memoryUsage().heapUsed / 1024 / 1024;
    const fullFrame = msPerTick * 64;
    const verdict = fullFrame < 16.7 ? 'ok' : `${fullFrame.toFixed(0)}ms — DROPS`;

    console.log(
      `${String(n).padStart(6)} | ${msPerTick.toFixed(3).padStart(8)} | ` +
      `${usPerAgent.toFixed(2).padStart(8)} | ${heapMB.toFixed(0).padStart(6)} | ${verdict}`,
    );
  }
}

console.log(`tick budget at 60fps = 16.7ms; bench runs ${TICKS} ticks/case`);
console.log(`flow-field build: ${buildMs.toFixed(3)} ms per ${MAP}×${MAP} field (paid once per hot destination)\n`);

console.log('--- Pass 1: cost FLOOR (straight-line wander, no pathing) ---');
benchPass(false);

console.log('\n--- Pass 2: flow-field pathing (agents follow shared fields, Stage 2) ---');
benchPass(true);
