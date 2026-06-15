/**
 * Macro credit-cycle tuning harness (GDD §13.3, balance risk #3):
 * "Emergent business cycles either don't emerge or never stop. Credit-cycle
 *  parameters are the single most sensitive dial in the design; budget a
 *  dedicated tuning harness (headless multi-decade sims, many runs,
 *  distribution targets: 2–4 major busts per century, depression-scale ≤1)."
 *
 * This is the macro counterpart to `headless.ts` (which only stress-tests the
 * town tier's survival). It flips a colony to the nation tier, runs the
 * monetary/credit-cycle engine for ~110 game-years (1900→2010, the MVP span)
 * across many seeds under a chosen central-bank policy, then reports the
 * realized business-cycle distribution against the GDD targets.
 *
 *   npm run sim:macro -- [years] [runs] [policy]
 *     years   game-years to simulate per run   (default 110)
 *     runs    independent seeds                (default 12)
 *     policy  central-bank reaction function   (default taylor; or "passive")
 *
 * The credit cycle (`RegionSim.tickMonetary`) only produces busts when leverage
 * is allowed to build at a low rate and is *then* tightened — i.e. emergent
 * cycles require an *active* policy. "passive" (rate pinned at neutral) is the
 * control: it should show cycles failing to emerge. "taylor" leans on inflation
 * the way a real central bank does, which is what makes the Minsky loop turn.
 */
import { Simulation } from './sim';
import { RegionSim, REGION_MINUTES_PER_TICK } from './region';
import { MINUTES_PER_DAY, DAYS_PER_YEAR, START_YEAR } from './defs';

const ticksPerDay = MINUTES_PER_DAY / REGION_MINUTES_PER_TICK;

// ── CLI args ────────────────────────────────────────────────────────────────
const years = Number(process.argv[2] ?? 110);
const runs = Number(process.argv[3] ?? 12);
const policy = (process.argv[4] ?? 'taylor') as PolicyMode;

const NEUTRAL_RATE = 0.05; // mirrors region.ts (not exported); the credit-neutral rate

export type PolicyMode = 'passive' | 'taylor';

/** A monthly snapshot of the macro economy. */
export interface MacroSample {
  /** Game-years elapsed since START_YEAR (fractional). */
  t: number;
  gdp: number;
  confidence: number;
  leverage: number;
  inflation: number;
  rate: number;
}

/** Business-cycle distribution stats for one run. */
export interface CycleStats {
  years: number;
  /** Confidence-collapse episodes (a fall through the deleveraging threshold). */
  busts: number;
  /** GDP peak-to-trough contractions of ≥10%. */
  recessions: number;
  /** Recessions whose drawdown reached ≥25% (depression-scale). */
  depressions: number;
  maxDrawdownPct: number;
  minConfidence: number;
  maxLeverage: number;
  avgInflation: number;
  bustsPerCentury: number;
  recessionsPerCentury: number;
  depressionsPerCentury: number;
}

/** Dovish base: how far below neutral a growth-mandate banker sits in calm times. */
const DOVISH_BIAS = 0.025;
/** How hard the banker leans against inflation above the 2% target. */
const TAYLOR_GAIN = 2.0;

/**
 * The central bank's monthly rate decision. Pure: state in, rate out.
 *  - passive: pin the policy rate at neutral. This is the control — at neutral
 *    `dLeverage` is exactly 0, so leverage never leaves its starting point and
 *    no cycle can begin. Demonstrates that the engine needs *active* policy.
 *  - taylor: a realistic growth-mandate banker — accommodative below neutral in
 *    calm times (which is what builds leverage, the seed of a Minsky cycle) and
 *    leaning against inflation as credit expansion heats it up. If the credit
 *    cycle is tuned to emerge, *this* is the stance that should turn the loop.
 */
export function policyRateFor(mode: PolicyMode, inflation: number): number {
  if (mode === 'passive') return NEUTRAL_RATE;
  const rate = NEUTRAL_RATE - DOVISH_BIAS + TAYLOR_GAIN * (inflation - 0.02);
  return Math.max(0.01, Math.min(0.15, rate));
}

/**
 * Scan a monthly sample series for business cycles. Pure — unit-tested
 * independently of the sim so the detection logic can't silently drift.
 *
 * A "bust" is a distinct fall of confidence through 30 (the level at which
 * `tickMonetary` forces deleveraging). A "recession" is a GDP peak-to-trough
 * drawdown of ≥10%, counted once per episode and closed on full recovery to the
 * prior peak; a recession that reaches ≥25% drawdown is also a "depression".
 */
export function analyzeCycles(samples: MacroSample[], years: number): CycleStats {
  let busts = 0;
  let recessions = 0;
  let depressions = 0;
  let maxDrawdownPct = 0;
  let minConfidence = Infinity;
  let maxLeverage = 0;
  let inflSum = 0;

  let prevBelow = false; // confidence was under threshold last sample
  let peak = -Infinity;
  let trough = Infinity;
  let inRecession = false;
  let episodeCounted = false;
  let episodeDepression = false;

  for (const s of samples) {
    minConfidence = Math.min(minConfidence, s.confidence);
    maxLeverage = Math.max(maxLeverage, s.leverage);
    inflSum += s.inflation;

    // Bust episodes: count each downward crossing of the deleveraging threshold.
    const below = s.confidence < 30;
    if (below && !prevBelow) busts++;
    prevBelow = below;

    // Recession episodes via GDP drawdown from a running peak.
    if (s.gdp > peak) {
      peak = s.gdp;
      // A new high ends any open episode.
      inRecession = false;
      episodeCounted = false;
      episodeDepression = false;
      trough = s.gdp;
    } else {
      trough = Math.min(trough, s.gdp);
      const drawdown = peak > 0 ? (peak - trough) / peak : 0;
      maxDrawdownPct = Math.max(maxDrawdownPct, drawdown * 100);
      if (drawdown >= 0.1 && !episodeCounted) {
        recessions++;
        episodeCounted = true;
        inRecession = true;
      }
      if (inRecession && drawdown >= 0.25 && !episodeDepression) {
        depressions++;
        episodeDepression = true;
      }
    }
  }

  const perCentury = (n: number) => (years > 0 ? (n * 100) / years : 0);
  return {
    years,
    busts,
    recessions,
    depressions,
    maxDrawdownPct: round1(maxDrawdownPct),
    minConfidence: minConfidence === Infinity ? 0 : round1(minConfidence),
    maxLeverage: round2(maxLeverage),
    avgInflation: samples.length ? round1((inflSum / samples.length) * 100) : 0,
    bustsPerCentury: round1(perCentury(busts)),
    recessionsPerCentury: round1(perCentury(recessions)),
    depressionsPerCentury: round1(perCentury(depressions)),
  };
}

function round1(n: number): number { return Math.round(n * 10) / 10; }
function round2(n: number): number { return Math.round(n * 100) / 100; }

/** Flip a fresh colony to a nation-tier RegionSim wired for the macro engine. */
function setupNation(seed: number): RegionSim {
  const sim = new Simulation(seed);
  while (sim.settlers.length < 22) sim.spawnSettler(32, 34);
  sim.stock.wood = 200;
  sim.stock.meal = 200;
  const r = RegionSim.fromTown(sim, 8, 80, 80);
  r.stateProclaimed = true;
  r.stateName = 'Tuningland';
  r.nationProclaimed = true;
  r.nationName = 'Tuningland';
  r.govType = 'republic';
  r.legitimacy = 60;
  r.activePolicies = [];
  r.treasury = 1000;
  r.passedLaws.push('central_bank_charter');
  r.passedLaws.push('income_tax');
  return r;
}

/** Years skipped before cycle analysis, so the founding GDP ramp isn't miscounted. */
const WARMUP_YEARS = 5;

/** Run one seed for `years` game-years under `mode`, sampling each month. */
function runOne(seed: number, mode: PolicyMode): { stats: CycleStats; samples: MacroSample[] } {
  const r = setupNation(seed);
  const samples: MacroSample[] = [];
  const totalDays = Math.round(years * DAYS_PER_YEAR);
  const warmupDays = WARMUP_YEARS * DAYS_PER_YEAR;

  // Step in 30-day "months" (the monetary update fires on day % 30).
  for (let day = 0; day < totalDays; day += 30) {
    r.policyRate = policyRateFor(mode, r.inflationRate);
    for (let d = 0; d < 30; d++) {
      for (let t = 0; t < ticksPerDay; t++) r.tick();
    }
    if (day >= warmupDays) {
      samples.push({
        t: (day + 30) / DAYS_PER_YEAR,
        gdp: r.gdpLastMonth,
        confidence: r.confidence,
        leverage: r.privateLeverage,
        inflation: r.inflationRate,
        rate: r.policyRate,
      });
    }
  }
  const analyzedYears = Math.max(1, years - WARMUP_YEARS);
  return { stats: analyzeCycles(samples, analyzedYears), samples };
}

// ── main ────────────────────────────────────────────────────────────────────
function main(): void {
  console.log(
    `CENTURIA macro credit-cycle harness — ${runs} nations × ${years} yrs ` +
    `(${START_YEAR}→${START_YEAR + years}) · policy=${policy}`,
  );
  console.log('GDD §13.3 targets: 2–4 busts/century, ≤1 depression/century\n');

  const all: CycleStats[] = [];
  for (let i = 0; i < runs; i++) {
    const seed = 1000 + i;
    const { stats } = runOne(seed, policy);
    all.push(stats);
    console.log(
      `seed ${seed}: creditBusts ${stats.busts} (${stats.bustsPerCentury}/cy) · ` +
      `gdpDrawdowns≥10% ${stats.recessions} (${stats.recessionsPerCentury}/cy) · ` +
      `≥25% ${stats.depressions} · maxDD ${stats.maxDrawdownPct}% · ` +
      `minConf ${stats.minConfidence} · maxLev ${stats.maxLeverage} · avgInfl ${stats.avgInflation}%`,
    );
  }

  const avg = (f: (s: CycleStats) => number) =>
    round1(all.reduce((s, x) => s + f(x), 0) / all.length);
  const bpc = avg((s) => s.bustsPerCentury);
  const dpc = avg((s) => s.depressionsPerCentury);
  console.log(
    `\nAVG: creditBusts ${bpc}/century · gdpDrawdowns≥10% ${avg((s) => s.recessionsPerCentury)}/century · ` +
    `≥25% ${dpc}/century · maxDD ${avg((s) => s.maxDrawdownPct)}% · ` +
    `minConf ${avg((s) => s.minConfidence)} · maxLev ${avg((s) => s.maxLeverage)} · avgInfl ${avg((s) => s.avgInflation)}%`,
  );
  // The GDD target is on credit busts — the confidence-collapse deleveraging the
  // monetary engine models. GDP drawdowns are reported as context only (they
  // also fire from population/trade/war noise unrelated to the credit cycle).
  const bustVerdict = bpc >= 2 && bpc <= 4 ? 'ON TARGET' : bpc < 2 ? 'TOO FEW — credit cycle under-emerges' : 'TOO MANY — credit cycle runs away';
  const depVerdict = dpc <= 1 ? 'ON TARGET' : 'TOO MANY depressions';
  console.log(`VERDICT (vs GDD §13.3): credit busts ${bustVerdict} · depressions ${depVerdict}`);
  if (bpc < 2) {
    console.log(
      'DIAGNOSIS: confidence never approaches the 30-pt deleveraging trigger ' +
      '(minConf above), so neither organic busts nor the scripted 1929 crash ' +
      '(needs confidence < 55) fire. Leverage-driven inflation is too weak to ' +
      'lift the policy rate enough for debt service to break confidence. The ' +
      'credit cycle is effectively dormant — the single most sensitive dial ' +
      'needs tuning (e.g. stronger leverage→inflation pass-through, or a ' +
      'leverage term directly in the confidence equation). See PR notes.',
    );
  }
}

// Only run when invoked directly (so the pure helpers can be imported by tests).
const invokedDirectly = process.argv[1]?.endsWith('macro-headless.ts') ||
  process.argv[1]?.endsWith('macro-headless.js');
if (invokedDirectly) main();
