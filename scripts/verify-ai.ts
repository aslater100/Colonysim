// Headless verification: play ~5 game-years and confirm regional AI competitors
// are actually acting (goals, settlements, scouts, tech, military, conflicts).
import { Simulation } from '../src/sim/sim';
import { RegionSim, REGION_MINUTES_PER_TICK } from '../src/sim/region';
import { MINUTES_PER_DAY } from '../src/sim/defs';

const ticksPerDay = MINUTES_PER_DAY / REGION_MINUTES_PER_TICK;

function grow(sim: Simulation): void {
  while (sim.settlers.length < 22) sim.spawnSettler(48, 50);
  sim.stock.wood = 200;
  sim.stock.meal = 200;
}

function runDays(r: RegionSim, days: number): void {
  for (let i = 0; i < days * ticksPerDay; i++) r.tick();
}

const seed = Number(process.argv[2] ?? 42);
const difficulty = (process.argv[3] ?? 'normal') as 'easy' | 'normal' | 'hard';
const sim = new Simulation(seed, {
  currencySymbol: '$', difficulty, location: 'river-valley', startingPop: 12,
});
grow(sim);
const r = RegionSim.fromTown(sim, 8, 80, 80);
runDays(r, 5);
r.stateProclaimed = true;
r.stateName = 'Verification State';
r.govLean = 'council';
r.treasury = 500;

const rivals = r.regionalFactions.filter((f) => f.id !== r.playerFactionId);
console.log(`seed=${seed}  difficulty=${r.aiDifficulty}  rivals=${rivals.length}  starting day=${r.day}`);
console.log(`rival regimes: ${rivals.map((f) => `${f.name}=${f.regime}`).join(', ')}`);

const YEARS = 5;
for (let y = 1; y <= YEARS; y++) {
  runDays(r, 365);
  console.log(`\n=== After year ${y} (day ${r.day}) ===`);
  for (const f of rivals) {
    const goal = f.currentGoal ? f.currentGoal.objective : '(none)';
    console.log(
      `  ${f.name} (${f.regime}): settlements=${f.settlementIds.length} ` +
      `treasury=${Math.round(f.treasury)} mil=${f.militaryStrength} ` +
      `tech=${f.techProgress.toFixed(2)} focus=${f.techFocus} goal="${goal}"`,
    );
  }
  console.log(`  scouts on map: ${r.scouts.length}`);
}

// Summary verdict
const totalSettlements = rivals.reduce((n, f) => n + f.settlementIds.length, 0);
const withGoals = rivals.filter((f) => f.currentGoal).length;
const factionLog = r.log.filter((e) =>
  /proclaims new goal|founds settlement|achieves ambition|TENSION|RAID|RETALIATION|FACTION ALLIANCE/i.test(e.text),
);

console.log('\n=== VERDICT ===');
console.log(`rivals founded ${totalSettlements} settlement(s) total`);
console.log(`${withGoals}/${rivals.length} rivals have an active goal`);
console.log(`scouts currently on map: ${r.scouts.length}`);
console.log(`faction-activity log lines: ${factionLog.length}`);
console.log('\n--- sample faction log ---');
for (const e of factionLog.slice(0, 20)) console.log(`  [${e.kind}] ${e.text}`);

const ok = totalSettlements > 0 && withGoals > 0;
console.log(`\nAI competitors active: ${ok ? 'YES ✅' : 'NO ❌'}`);
process.exit(ok ? 0 : 1);
