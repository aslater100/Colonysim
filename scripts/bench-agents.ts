/**
 * Bench the SoA AgentStore tick against the same ladder as bench-scale.ts,
 * so we can read the new engine's cost FLOOR (everything except pathing) next
 * to the fat-object sim's full cost.
 *
 *   npx tsx scripts/bench-agents.ts
 *   npx tsx scripts/bench-agents.ts 200 1000 5000 20000
 */
import { performance } from 'node:perf_hooks';
import { AgentStore } from '../src/sim/agents';

const counts = process.argv.slice(2).map(Number).filter((n) => n > 0);
const AGENT_COUNTS = counts.length ? counts : [200, 500, 1000, 2000, 5000, 10000];
const TICKS = 200;

// Deterministic LCG so the bench is repeatable and matches the self-check style.
let rng = 99; const rand = () => (rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

console.log(`tick budget at 60fps = 16.7ms; bench runs ${TICKS} ticks/case`);
console.log('(SoA cost floor — straight-line movement, pathing is Stage 2)\n');
console.log('agents |  ms/tick | µs/agent | heapMB | full-frame? (64 ticks)');
console.log('-------+----------+----------+--------+-----------------------');

for (const n of AGENT_COUNTS) {
  const store = new AgentStore(n);
  for (let i = 0; i < n; i++) store.spawn(48 + (i % 40), 48 + ((i / 40) | 0) % 40);

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
