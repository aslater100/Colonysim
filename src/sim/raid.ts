/**
 * Raids & combat — Stage 4 behavior port for the scale engine.
 *
 * The fat sim spawns raiders as pathing entities that march in, trade melee with
 * settlers and walls, and are driven off or time out. Simulating a second pathing
 * population per raid is exactly the per-agent A* cost the scale engine exists to
 * avoid, so the SoA port keeps raids **abstracted but faithful**: a raid musters a
 * pool of raiders (the same time/pop size curve as the fat sim), then each tick a
 * power exchange attrits the raider pool against the colony's fighters and, in
 * return, wounds random defenders. Wounds flow through the medical columns
 * (`inflictWound`, slice 2) and any deaths through `TownCore`'s grief path
 * (slice 3) — the systems compose.
 *
 * Defenders fight if `combat ≥ fightMinCombat` and `health > 50` (matches the fat
 * sim's muster check); the rest cower and are only hurt if the colony is overrun.
 * Walls mitigate incoming damage. Pure, DOM-free, additive, deterministic (RNG
 * injected). Run the self-check:  npx tsx src/sim/raid.ts
 */
import type { AgentStore } from './agents';
import type { BuildGrid } from './build';
import type { Stockpile } from './stockpile';
import { TUNING, MINUTES_PER_TICK } from './defs';
// Runtime imports used only by the self-check (guarded — won't fire on import).
import { AgentStore as AgentStoreImpl } from './agents';
import { BuildGrid as BuildGridImpl } from './build';
import { Stockpile as StockpileImpl } from './stockpile';

const HOURS_PER_TICK = MINUTES_PER_TICK / 60;
const FIGHT_HEALTH_MIN = 50;        // below this a settler won't stand the line
const WALL_MITIGATION_CAP = 0.5;    // most a fully-walled colony shrugs off
const WALL_TILES_FOR_CAP = 200;     // wall tiles for the full mitigation

export interface RaidSave {
  raiderCount: number;
  raiderHealthPool: number;
  raidEndTick: number;
  nextRaidDay: number;
  raidsSurvived: number;
}

/** Outcome of one raid tick, for logging/UI by the caller. */
export interface RaidTickResult {
  ongoing: boolean;
  /** true on the tick the raid ends because the raiders were wiped out. */
  repelled: boolean;
  /** true on the tick the raid ends because the raiders gave up / timed out. */
  leftField: boolean;
  casualtiesWounded: number;
}

/** Drives raid scheduling and the per-tick combat exchange for a TownCore. */
export class RaidDirector {
  raiderCount = 0;        // 0 = no active raid
  raiderHealthPool = 0;   // total raider HP remaining (raiderCount derived from it)
  raidEndTick = 0;
  nextRaidDay: number;
  raidsSurvived = 0;

  constructor(rand: () => number) {
    this.nextRaidDay = TUNING.firstRaidDay + Math.floor(rand() * 5);
  }

  get active(): boolean {
    return this.raiderCount > 0;
  }

  /** Raid size: ramps with elapsed days, capped by population and the hard ceiling. */
  raidSize(day: number, pop: number): number {
    const byTime = 2 + Math.floor(Math.max(0, day - TUNING.firstRaidDay) / TUNING.raidRampDays);
    const byPop = Math.ceil(pop * TUNING.raidPopFactor);
    return Math.max(1, Math.min(TUNING.raidMaxRaiders, byTime, byPop));
  }

  /**
   * If a raid is due (called once per day), muster one and schedule the next.
   * Returns the raider count if a raid started, else 0.
   */
  maybeStart(day: number, pop: number, tickNo: number, rand: () => number): number {
    if (this.active || day < this.nextRaidDay || pop <= 0) return 0;
    const n = this.raidSize(day, pop);
    this.raiderCount = n;
    this.raiderHealthPool = n * TUNING.raiderHealth;
    this.raidEndTick = tickNo + Math.ceil((TUNING.raidTimeoutHours * 60) / MINUTES_PER_TICK);
    this.nextRaidDay = day + TUNING.raidIntervalDays + Math.floor(rand() * 5);
    return n;
  }

  /** Force a raid of `n` raiders right now (tests / scripted events). */
  start(n: number, tickNo: number): void {
    this.raiderCount = Math.max(1, n);
    this.raiderHealthPool = this.raiderCount * TUNING.raiderHealth;
    this.raidEndTick = tickNo + Math.ceil((TUNING.raidTimeoutHours * 60) / MINUTES_PER_TICK);
  }

  /**
   * Resolve one tick of an active raid. Defenders attrit the raider pool; the
   * raiders wound random defenders (or anyone, if the colony has no fighters).
   * Walls mitigate incoming damage. Death is left to the caller's health<=0 sweep
   * (so grief/relations fire there). No-op when no raid is active.
   */
  tick(agents: AgentStore, grid: BuildGrid, stock: Stockpile, tickNo: number, rand: () => number): RaidTickResult {
    if (!this.active) return { ongoing: false, repelled: false, leftField: false, casualtiesWounded: 0 };

    // Muster fighters; arm as many as the armoury (weapons stock) allows.
    const fighters: number[] = [];
    for (let i = 0; i < agents.count; i++) {
      if (agents.combat[i] >= TUNING.fightMinCombat && agents.health[i] > FIGHT_HEALTH_MIN) fighters.push(i);
    }
    let armed = Math.min(fighters.length, Math.floor(stock.count('weapons')));

    // Colony damage to the raider pool this tick.
    let colonyDmg = 0;
    for (let k = 0; k < fighters.length; k++) {
      const i = fighters[k];
      const weaponBonus = k < armed ? TUNING.forgedWeaponBonus : 0;
      colonyDmg += (TUNING.combatDamagePerHour + agents.combat[i] * TUNING.combatDamagePerSkill + weaponBonus) * HOURS_PER_TICK;
    }
    if (armed > 0) stock.remove('weapons', armed); // spent in the melee

    this.raiderHealthPool -= colonyDmg;
    if (this.raiderHealthPool <= 0) {
      this.raiderHealthPool = 0;
      this.raiderCount = 0;
      this.raidsSurvived++;
      return { ongoing: false, repelled: true, leftField: false, casualtiesWounded: 0 };
    }
    this.raiderCount = Math.ceil(this.raiderHealthPool / TUNING.raiderHealth);

    // Raider damage to the colony, mitigated by walls.
    const wallTiles = countWalls(grid);
    const mitigation = Math.min(WALL_MITIGATION_CAP, wallTiles / WALL_TILES_FOR_CAP);
    const incoming = this.raiderCount * TUNING.combatDamagePerHour * HOURS_PER_TICK * (1 - mitigation);

    // Spread the hurt over the defenders (or the whole colony if undefended).
    const targets = fighters.length > 0 ? fighters : range(agents.count);
    let wounded = 0;
    if (targets.length > 0) {
      // One settler eats the blow each tick (the unlucky one at the front).
      const victim = targets[Math.floor(rand() * targets.length)];
      agents.health[victim] -= incoming;
      if (agents.woundUntreated[victim] === 0) { agents.inflictWound(victim, tickNo); wounded = 1; }
    }

    // Raiders give up when their window closes.
    if (tickNo >= this.raidEndTick) {
      this.raiderCount = 0;
      this.raiderHealthPool = 0;
      this.raidsSurvived++;
      return { ongoing: false, repelled: false, leftField: true, casualtiesWounded: wounded };
    }
    return { ongoing: true, repelled: false, leftField: false, casualtiesWounded: wounded };
  }

  serialize(): RaidSave {
    return {
      raiderCount: this.raiderCount,
      raiderHealthPool: this.raiderHealthPool,
      raidEndTick: this.raidEndTick,
      nextRaidDay: this.nextRaidDay,
      raidsSurvived: this.raidsSurvived,
    };
  }

  static deserialize(data: RaidSave | undefined, rand: () => number): RaidDirector {
    const d = new RaidDirector(rand);
    if (!data) return d;
    d.raiderCount = data.raiderCount ?? 0;
    d.raiderHealthPool = data.raiderHealthPool ?? 0;
    d.raidEndTick = data.raidEndTick ?? 0;
    d.nextRaidDay = data.nextRaidDay ?? d.nextRaidDay;
    d.raidsSurvived = data.raidsSurvived ?? 0;
    return d;
  }
}

function countWalls(grid: BuildGrid): number {
  let n = 0;
  const w = grid.wall;
  for (let i = 0; i < w.length; i++) if (w[i] !== 0) n++;
  return n;
}

function range(n: number): number[] {
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = i;
  return out;
}

// --- self-check: npx tsx src/sim/raid.ts ---
if (typeof process !== 'undefined' && process.argv[1]?.endsWith('/raid.ts')) {
  let rng = 7;
  const rand = () => (rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

  // Size ramps with days, capped by pop.
  const d = new RaidDirector(rand);
  console.assert(d.raidSize(TUNING.firstRaidDay, 100) >= 1, 'raid size ≥ 1');
  console.assert(d.raidSize(1000, 2) <= Math.ceil(2 * TUNING.raidPopFactor), 'pop caps raid size');

  // A handful of capable, armed defenders repel a small raid.
  const grid = new BuildGridImpl(16, 16);
  const stock = new StockpileImpl();
  stock.add('weapons', 5);
  const agents = new AgentStoreImpl(8);
  for (let i = 0; i < 5; i++) { const a = agents.spawn(8, 8); agents.combat[a] = 8; }
  const dir = new RaidDirector(rand);
  dir.start(2, 0);
  let ticks = 0;
  while (dir.active && ticks < 1000) { dir.tick(agents, grid, stock, ticks, rand); ticks++; }
  console.assert(dir.raidsSurvived === 1, 'colony survived the raid');

  // Round-trip.
  dir.start(3, 100);
  const r2 = RaidDirector.deserialize(dir.serialize(), rand);
  console.assert(r2.raiderCount === dir.raiderCount && r2.raidsSurvived === dir.raidsSurvived, 'raid round-trip');

  console.log('raid.ts self-check OK — survived', dir.raidsSurvived, 'in', ticks, 'ticks');
}
