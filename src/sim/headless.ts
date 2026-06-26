/**
 * Headless long-run tuning harness — restores `npm run sim`.
 *
 *   npm run sim                 # default: run to the 2100 Century Report, 1 seed
 *   npm run sim -- 90 5         # 90 game-years from the 1919 start, 5 seeds
 *
 * Boots `RegionSim.create()` at 1919 and ticks until the target year (robust to
 * the sim's tier-based calendar acceleration), printing end-state balance
 * markers — the key one being treasury ÷ GDP (the `economy-balance` regression
 * target: "within a few months of GDP across a century"). Use it to spot
 * runaway treasuries / death spirals across seeds while tuning.
 */
import { RegionSim } from './region';

const years = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 181; // 1919 → 2100
const runs = Number(process.argv[3]) > 0 ? Number(process.argv[3]) : 1;
const TICK_CAP = 20_000_000; // safety stop in case the calendar stalls

console.log(`headless sim: ${years} game-year(s) × ${runs} run(s)\n`);
console.log('seed |  year | towns |    treasury |        GDP | treas/GDP(mo) | infl% |  pop   | sat | ticks | outcome');
console.log('-----+-------+-------+-------------+------------+---------------+-------+--------+-----+-------+--------');

for (let run = 0; run < runs; run++) {
  const seed = 1000 + run * 7;
  const r = RegionSim.create(seed);
  const target = r.year + years;
  let ticks = 0;
  while (r.year < target && !r.gameOver && ticks < TICK_CAP) { r.tick(); ticks++; }

  const last = r.monthlyHistory[r.monthlyHistory.length - 1];
  const gdp = last ? last.gdp : 0;
  const treasOverGdpMonths = gdp > 0 ? r.treasury / (gdp / 12) : 0; // treasury in "months of GDP"
  const outcome = r.winCondition ? `WIN:${r.winCondition.path}` : (r.eraBranch ?? (r.nationProclaimed ? 'nation' : 'colony'));

  console.log(
    `${String(seed).padStart(4)} | ` +
    `${String(r.year).padStart(5)} | ` +
    `${String(r.settlements.length).padStart(5)} | ` +
    `${r.treasury.toFixed(0).padStart(11)} | ` +
    `${gdp.toFixed(0).padStart(10)} | ` +
    `${treasOverGdpMonths.toFixed(1).padStart(13)} | ` +
    `${(r.inflationRate * 100).toFixed(1).padStart(5)} | ` +
    `${r.playerPop().toFixed(0).padStart(6)} | ` +
    `${r.avgSatisfaction().toFixed(0).padStart(3)} | ` +
    `${String(ticks).padStart(5)} | ` +
    `${outcome}`,
  );
}
