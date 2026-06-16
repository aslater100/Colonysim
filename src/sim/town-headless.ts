/**
 * Headless balance harness for the DEFAULT engine — the SoA `TownCore`.
 * `npm run sim` exercises the legacy Classic `Simulation`; this one runs the
 * core players actually play, so food/mood/population regressions in the live
 * engine get caught from the command line.
 *
 *   npm run sim:town -- [days] [runs]
 *
 * The colony is the canonical starter town (shared with the GUI via
 * `buildStarterTown`); settlers auto-pull jobs off the board, so no auto-player
 * is needed — the town runs itself and we just read the vitals each run.
 */
import { TownCore } from './towncore';
import { buildStarterTown } from './startertown';

const days = Number(process.argv[2] ?? 120);
const runs = Number(process.argv[3] ?? 10);
const MAP = 96;

interface RunResult {
  seed: number;
  pop: number;
  dead: boolean;
  avgMood: number;
  meal: number;
  grain: number;
  wood: number;
  deaths: number;
}

function avgMood(core: TownCore): number {
  const m = core.agents.mood;
  const n = core.agents.count;
  if (n === 0) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) s += m[i];
  return s / n;
}

function runOne(seed: number): RunResult {
  const core = new TownCore({ width: MAP, height: MAP, seed, terrain: 'heightmap' });
  buildStarterTown(core, MAP);
  for (let d = 0; d < days; d++) {
    const startDay = core.day;
    // Advance until the day rolls over (tick count per day is engine-internal).
    let guard = 0;
    while (core.day === startDay && guard++ < 10000) core.tick();
    if (core.population === 0) break; // colony wiped — stop early
  }
  return {
    seed,
    pop: core.population,
    dead: core.population === 0,
    avgMood: Math.round(avgMood(core)),
    meal: Math.round(core.stock.count('meal')),
    grain: Math.round(core.stock.count('grain')),
    wood: Math.round(core.stock.count('wood')),
    deaths: core.deaths,
  };
}

console.log(`CENTURIA town-core balance harness — ${runs} colonies × ${days} days (SoA TownCore, auto-jobs)`);
const results: RunResult[] = [];
for (let i = 0; i < runs; i++) results.push(runOne(1000 + i));

console.table(results);
const survived = results.filter((r) => !r.dead).length;
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
console.log(
  `survival ${survived}/${runs} · ` +
  `avg pop ${avg(results.map((r) => r.pop)).toFixed(1)} · ` +
  `avg mood ${avg(results.map((r) => r.avgMood)).toFixed(0)} · ` +
  `avg deaths ${avg(results.map((r) => r.deaths)).toFixed(1)} · ` +
  `avg grain ${avg(results.map((r) => r.grain)).toFixed(0)} · ` +
  `avg meal ${avg(results.map((r) => r.meal)).toFixed(0)}`,
);
