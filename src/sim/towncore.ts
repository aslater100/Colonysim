/**
 * TownCore — the integrated room-based town simulation (build-system B-6).
 *
 * Stages B-1…B-5 each landed one pure, additive scale-engine module:
 *   - `BuildGrid`  (B-1) — painted walls/floors/rooms/stations.
 *   - `Stockpile`  (B-2) — flat resource store + `tickProduction`.
 *   - `JobBoard`   (B-3) — open craft stations as jobs; nearest-match assignment.
 *   - needs/rooms  (B-4) — `serveNeeds` / `aggregateCapacities`.
 *   - paint UI     (B-5) — render + tools (live UI only).
 *   - `AgentStore` / `FlowField` (Track C Stages 1–2) — the SoA agent core + pathing.
 *
 * None of those was wired together: they each had a self-check but no shared clock,
 * no births/deaths, no save format. This class is that composition — the single
 * tickable, serializable town core that the final B-6 swap installs in place of the
 * fat-object `Simulation`. It runs the data-flow the plan calls for:
 *
 *   JobBoard.rebuild → assignIdle → BuildGrid.tickProduction → serveNeeds → agents.tick
 *
 * plus a day rollover that feeds agents from produced meals and grows/loses
 * population. Pure and DOM-free like the modules it composes, so it runs headless,
 * in the bench, and (eventually) in the Phase-7 worker. The live `Simulation` and
 * its discrete `buildings.json` stay the shipped town tier until this core reaches
 * full behavior parity (combat/raids/weather/trading/economy) and is play-verified;
 * this stage makes the swap candidate exist, deterministic, and round-trippable.
 *
 * Run the self-check:  npx tsx src/sim/towncore.ts
 */
import { MAP_W, MAP_H } from './world';
import { BuildGrid, type BuildGridSave } from './build';
import { AgentStore, AState, ThoughtKey, type AgentStoreSave } from './agents';
import { Stockpile } from './stockpile';
import { JobBoard } from './jobs';
import { FlowField } from './flowfield';
import { serveNeeds, serveMedical, aggregateCapacities, type RoomServices } from './needs';
import { Relations, socialize } from './social';
import { Weather } from './weather';
import { RaidForce, raidSize, type RaidForceSave } from './raid';
import { Rng } from './rng';
import { BASE_PRICES } from './economy';
import { MINUTES_PER_TICK, MINUTES_PER_DAY, NEED_INTERRUPT_THRESHOLD, ROOM_TYPE_ID, TUNING, type ResourceKind } from './defs';

const TICKS_PER_DAY = MINUTES_PER_DAY / MINUTES_PER_TICK;
// Grief on a death (mirrors the fat sim): friends mourn harder and longer.
const GRIEF_FRIEND_DELTA = -18, GRIEF_FRIEND_TICKS = 6 * TICKS_PER_DAY;
const GRIEF_DELTA = -8, GRIEF_TICKS = 4 * TICKS_PER_DAY;
// Mental break: a miserable settler may crack (per-point/day chance), souring mood.
const MENTAL_BREAK_THRESHOLD = TUNING.mentalBreakMoodThreshold;
const MENTAL_BREAK_CHANCE = TUNING.mentalBreakChancePerPointPerDay;
const BREAKDOWN_DELTA = -6, BREAKDOWN_TICKS = 2 * TICKS_PER_DAY;
// Being attacked sours the mood for a while (mirrors the fat sim's raid dread).
const RAID_FEAR_DELTA = -10, RAID_FEAR_TICKS = 2 * TICKS_PER_DAY;
// Market price modifiers drift back toward 1.0 each day as supply/demand settles.
const PRICE_RECOVERY = TUNING.marketRecoveryPerDay;

const SAVE_VERSION = 2;

// Behavior thresholds for the integration loop (modest, deterministic — full
// mood/skills/trait fidelity is the remaining parity work, not this stage).
const REST_SLEEP_BELOW = 30;   // rest under this → go to sleep, releasing any job
const REST_WAKE_AT = 95;       // rest at/over this → wake up and look for work
const BIRTH_MOOD_MIN = 50;     // colony must be reasonably content to grow
const STARVED_HEALTH = 0;      // health at/under this → death (swap-removed)

export interface TownCoreSave {
  v: number;
  tickNo: number;
  minute: number;
  day: number;
  rngState: number;
  weatherSeed: number;
  gold: number;
  homeX: number;
  homeY: number;
  deaths: number;
  births: number;
  grid: BuildGridSave;
  agents: AgentStoreSave;
  stock: Partial<Record<string, number>>;
  relations: [number, number][];
  priceModifiers?: Record<string, number>;
  /** v2+: raid schedule + any in-progress incursion. */
  nextRaidDay?: number;
  raids?: RaidForceSave;
}

export interface TownCoreOpts {
  width?: number;
  height?: number;
  capacity?: number;
  seed?: number;
}

export class TownCore {
  readonly grid: BuildGrid;
  readonly agents: AgentStore;
  readonly stock: Stockpile;
  readonly board: JobBoard;
  /** Sparse pairwise opinions — bonds grow co-recreating, friends grieve harder. */
  readonly relations = new Relations();
  /** Daily weather: temperature drives warmth decay, freezing deals death. */
  readonly weather: Weather;
  /** Hostile incursions: raiders converge on the colony; walls + settlers repel them. */
  readonly raids = new RaidForce();
  /** Game-day the next raid musters (rescheduled after each one). */
  nextRaidDay: number;
  private readonly jobField: FlowField;
  private readonly rng: Rng;
  private readonly _rand: () => number;

  tickNo = 0;
  minute = 0;
  day = 0;
  deaths = 0;
  births = 0;
  gold = 0;
  /** Market price modifiers: track supply/demand shifts (recover daily toward 1.0). */
  priceModifiers = new Map<string, number>();
  /** Colony anchor — where newcomers appear and the camera first looks. */
  homeX: number;
  homeY: number;

  private readonly weatherSeed: number;

  constructor(opts: TownCoreOpts = {}) {
    const width = opts.width ?? MAP_W;
    const height = opts.height ?? MAP_H;
    const seed = opts.seed ?? 1;
    this.grid = new BuildGrid(width, height);
    this.agents = new AgentStore(opts.capacity ?? 256);
    this.stock = new Stockpile();
    this.board = new JobBoard();
    this.jobField = new FlowField(width, height);
    this.weatherSeed = seed;
    this.weather = new Weather(seed);
    this.rng = new Rng(seed);
    this._rand = () => this.rng.next();
    this.homeX = Math.floor(width / 2);
    this.homeY = Math.floor(height / 2);
    this.nextRaidDay = TUNING.firstRaidDay + this.rng.int(5);
  }

  /**
   * Colony wealth drives raid size: prosperity attracts trouble (mirrors the fat
   * sim's `wealth()` — stocks + heads + built stations).
   */
  wealth(): number {
    const stocks = this.stock.count('wood') * 0.2 + this.stock.count('grain') +
      this.stock.count('meal') + this.stock.count('clothes') * 2;
    return stocks + this.agents.count * 8 + this.grid.stations.length * 15;
  }

  /** True while raiders are on the map. */
  get raidActive(): boolean {
    return this.raids.active;
  }

  /**
   * Spawn one settler at (x, y) with a rolled persona: two distinct traits and a
   * green-to-competent starting skill (0..7, like the fat sim's birth roll). Uses
   * the core RNG so colonies stay deterministic. Returns the agent index, or -1.
   */
  private spawnPerson(x: number, y: number): number {
    const i = this.agents.spawn(x, y);
    if (i < 0) return -1;
    this.agents.rollTraits(i, this._rand);
    this.agents.skill[i] = this.rng.int(8);
    return i;
  }

  /** Spawn `n` founding settlers clustered around (cx, cy). Returns the count placed. */
  seedColony(cx: number, cy: number, n: number): number {
    this.homeX = cx;
    this.homeY = cy;
    let placed = 0;
    for (let i = 0; i < n; i++) {
      const dx = (i % 3) - 1;
      const dy = (Math.floor(i / 3) % 3) - 1;
      if (this.spawnPerson(cx + dx, cy + dy) >= 0) placed++;
    }
    return placed;
  }

  // ── per-tick orchestration ──────────────────────────────────────────────────

  tick(): void {
    const t = this.tickNo;
    const a = this.agents;

    // 1. State transitions: tired agents sleep (releasing any job); rested ones wake;
    //    workers whose food/rest fell below the interrupt threshold abandon the job.
    for (let i = 0; i < a.count; i++) {
      const st = a.state[i];
      if (st === AState.Sleeping) {
        if (a.rest[i] >= REST_WAKE_AT) a.state[i] = AState.Idle;
        continue;
      }
      if (a.rest[i] < REST_SLEEP_BELOW) {
        a.stationId[i] = 0;
        a.state[i] = AState.Sleeping;
        continue;
      }
      if (st === AState.Working && (a.food[i] < NEED_INTERRUPT_THRESHOLD || a.rest[i] < NEED_INTERRUPT_THRESHOLD)) {
        a.unassignStation(i); // → Idle, free to recover next pass
      }
    }

    // 2. Job board: derive open stations, route idle agents to the nearest one.
    this.board.rebuild(this.grid, a, this.stock);
    if (this.board.jobs.length > 0) {
      this.board.buildField(this.jobField, this.grid);
      a.fields = [this.jobField];
    } else {
      a.fields = [];
    }
    this.board.assignIdle(this.grid, a);

    // 3. Production: manned craft stations consume/produce against the stockpile.
    this.grid.tickProduction(a, this.stock, MINUTES_PER_TICK);

    // 4. Needs from rooms: warmth (enclosure), rest (beds), recreation (tables),
    //    and medical recovery (infirmary sickbeds + apothecary medicine).
    const dayWeather = this.weather.forDay(this.day);
    serveNeeds(this.grid, a, MINUTES_PER_TICK, dayWeather.tempAnomalyC);
    serveMedical(this.grid, a, this.stock);

    // 4b. Bonding: agents sharing a tavern grow their mutual opinion.
    socialize(this.grid, a, this.relations, MINUTES_PER_TICK);

    // 5. Agent tick: needs decay, mood ease (incl. thoughts), health, movement.
    a.tick(t, this._rand);

    // 5b. Mental break: a miserable settler may crack, leaving a sour thought.
    for (let i = 0; i < a.count; i++) {
      if (a.mood[i] >= MENTAL_BREAK_THRESHOLD) continue;
      const pTick = (MENTAL_BREAK_THRESHOLD - a.mood[i]) * MENTAL_BREAK_CHANCE / TICKS_PER_DAY;
      if (this.rng.next() < pTick) {
        a.unassignStation(i);
        a.addThought(i, t, BREAKDOWN_DELTA, BREAKDOWN_TICKS, ThoughtKey.Breakdown);
      }
    }

    // 5c. Raids: muster on schedule, then resolve combat. Raiders converge on the
    //     settlers, walls slow them, and awake settlers fight back. Casualties fall
    //     through the death pass below; the wounded carry a dread thought.
    if (this.day >= this.nextRaidDay && !this.raids.active) {
      this.musterRaid();
    }
    if (this.raids.active) {
      // The horn rallies the colony: nobody sleeps through a raid.
      for (let i = 0; i < a.count; i++) if (a.state[i] === AState.Sleeping) a.state[i] = AState.Idle;
      this.raids.tick(this.grid, a, t);
      for (let i = 0; i < a.count; i++) {
        if (a.woundUntreated[i] === 1 && a.woundAt[i] === t) {
          a.addThought(i, t, RAID_FEAR_DELTA, RAID_FEAR_TICKS);
        }
      }
    }

    // 6. Deaths: swap-remove the starved (iterate backwards — splice-safe). Each
    //    death grieves the survivors — friends mourn harder — and forgets the bond.
    for (let i = a.count - 1; i >= 0; i--) {
      if (a.health[i] <= STARVED_HEALTH) {
        const deadId = a.id[i];
        for (let j = 0; j < a.count; j++) {
          if (j === i) continue;
          const friend = this.relations.areFriends(deadId, a.id[j]);
          a.addThought(j, t, friend ? GRIEF_FRIEND_DELTA : GRIEF_DELTA, friend ? GRIEF_FRIEND_TICKS : GRIEF_TICKS);
        }
        this.relations.forget(deadId);
        a.remove(i);
        this.deaths++;
      }
    }

    // 7. Clock + day rollover.
    this.tickNo++;
    this.minute += MINUTES_PER_TICK;
    while (this.minute >= MINUTES_PER_DAY) {
      this.minute -= MINUTES_PER_DAY;
      this.day++;
      this.dailyUpdate();
    }
  }

  /** Convenience: advance `n` ticks. */
  run(n: number): void {
    for (let i = 0; i < n; i++) this.tick();
  }

  /** Muster a raid now and reschedule the next (the tick scheduler + the UI's "raid" key). */
  musterRaid(): void {
    if (this.raids.active) return;
    const n = raidSize(this.wealth(), this.day, this.agents.count);
    this.raids.start(n, this.grid.width, this.grid.height, this.rng, this.tickNo);
    this.nextRaidDay = this.day + TUNING.raidIntervalDays + this.rng.int(5);
  }

  // ── daily coarse update: feeding + population flows ──────────────────────────

  private dailyUpdate(): void {
    const a = this.agents;

    // Market: price modifiers heal a fraction of the way back to 1.0 each day, so
    // a single panic buy/sell doesn't dislocate prices forever (mirrors the fat sim).
    for (const [kind, mod] of this.priceModifiers) {
      const healed = mod + (1.0 - mod) * PRICE_RECOVERY;
      if (Math.abs(healed - 1.0) < 1e-3) this.priceModifiers.delete(kind);
      else this.priceModifiers.set(kind, healed);
    }

    // Feed: each hungry agent eats one produced meal (restores food fully). Meals
    // are consumed in agent order until the larder runs dry — the rest stay hungry
    // and bleed health via the per-tick starvation path.
    for (let i = 0; i < a.count; i++) {
      if (a.food[i] >= 100) continue;
      if (!this.stock.remove('meal', 1)) break;
      a.food[i] = 100;
    }

    // Growth: a content, well-housed, well-fed colony attracts a newcomer.
    const services = aggregateCapacities(this.grid);
    const housing = services.sleep;
    const avgMood = this.averageMood();
    const fed = this.stock.count('meal') >= a.count;
    if (a.count < housing && a.count < a.capacity && avgMood >= BIRTH_MOOD_MIN && fed) {
      if (this.spawnPerson(this.homeX, this.homeY) >= 0) this.births++;
    }
  }

  // ── read-only views ──────────────────────────────────────────────────────────

  get population(): number {
    return this.agents.count;
  }

  services(): RoomServices {
    return aggregateCapacities(this.grid);
  }

  averageMood(): number {
    const a = this.agents;
    if (a.count === 0) return 0;
    let sum = 0;
    for (let i = 0; i < a.count; i++) sum += a.mood[i];
    return sum / a.count;
  }

  // ── market: buy/sell resources at dynamic prices ─────────────────────────

  /**
   * Market price for one unit of a resource, adjusted for local supply/demand.
   * Low stock → higher price (scarce), high stock → lower price (surplus).
   */
  marketPrice(kind: ResourceKind): number {
    const base = BASE_PRICES[kind] ?? 10;
    const mod = this.priceModifiers.get(kind) ?? 1.0;
    return base * Math.max(0.5, Math.min(2.0, mod)); // clamp 0.5×..2.0×
  }

  /**
   * Sell `qty` units of a resource to the market. Each unit clears at a
   * progressively lower price as supply increases, so dumping large amounts
   * yields less per unit. Returns gold received (0 if insufficient stock).
   */
  sellToMarket(kind: ResourceKind, qty: number): number {
    if (qty <= 0 || !this.stock.remove(kind, qty)) return 0;
    const base = BASE_PRICES[kind] ?? 10;
    const e = TUNING.marketSellElasticity;
    let mod = this.priceModifiers.get(kind) ?? 1.0;
    let revenue = 0;
    for (let i = 0; i < qty; i++) {
      revenue += base * Math.max(0.5, Math.min(2.0, mod));
      mod -= e; // each unit sold depresses the next
    }
    this.priceModifiers.set(kind, mod);
    this.gold += Math.round(revenue);
    return Math.round(revenue);
  }

  /**
   * Buy `qty` units of a resource from the market with gold. Each unit bought
   * bids the price up. Returns true if successful, false if insufficient gold.
   */
  buyFromMarket(kind: ResourceKind, qty: number): boolean {
    if (qty <= 0) return false;
    const base = BASE_PRICES[kind] ?? 10;
    const e = TUNING.marketBuyElasticity;
    let mod = this.priceModifiers.get(kind) ?? 1.0;
    let cost = 0;
    for (let i = 0; i < qty; i++) {
      cost += base * Math.max(0.5, Math.min(2.0, mod));
      mod += e; // each unit bought bids the price up
    }
    cost = Math.round(cost);
    if (cost > this.gold) return false;
    this.gold -= cost;
    this.stock.add(kind, qty);
    this.priceModifiers.set(kind, mod);
    return true;
  }

  // ── serialization ────────────────────────────────────────────────────────────

  serialize(): TownCoreSave {
    return {
      v: SAVE_VERSION,
      tickNo: this.tickNo,
      minute: this.minute,
      day: this.day,
      rngState: this.rng.getState(),
      weatherSeed: this.weatherSeed,
      gold: this.gold,
      homeX: this.homeX,
      homeY: this.homeY,
      deaths: this.deaths,
      births: this.births,
      grid: this.grid.serialize(),
      agents: this.agents.serialize(),
      stock: this.stock.serialize(),
      relations: this.relations.serialize(),
      priceModifiers: this.priceModifiers.size > 0 ? Object.fromEntries(this.priceModifiers) : undefined,
      nextRaidDay: this.nextRaidDay,
      raids: this.raids.serialize(),
    };
  }

  static deserialize(data: TownCoreSave): TownCore {
    const grid = BuildGrid.deserialize(data.grid);
    const weatherSeed = data.weatherSeed ?? 1; // backfill for old saves
    const core = new TownCore({ width: grid.width, height: grid.height, capacity: data.agents.capacity, seed: weatherSeed });
    // Replace the freshly-built sub-systems with the restored ones.
    (core as { grid: BuildGrid }).grid = grid;
    (core as { agents: AgentStore }).agents = AgentStore.deserialize(data.agents);
    (core as { stock: Stockpile }).stock = Stockpile.deserialize(data.stock);
    (core as { relations: Relations }).relations = Relations.deserialize(data.relations);
    core.rng.setState(data.rngState);
    core.tickNo = data.tickNo;
    core.minute = data.minute;
    core.day = data.day;
    core.gold = data.gold ?? 0;
    core.homeX = data.homeX;
    core.homeY = data.homeY;
    core.deaths = data.deaths ?? 0;
    core.births = data.births ?? 0;
    if (data.priceModifiers) {
      core.priceModifiers = new Map(Object.entries(data.priceModifiers));
    }
    // v2+: restore the raid schedule + any in-progress incursion (old saves keep
    // the freshly-rolled schedule and an empty force).
    if (data.nextRaidDay !== undefined) core.nextRaidDay = data.nextRaidDay;
    if (data.raids) (core as { raids: RaidForce }).raids = RaidForce.deserialize(data.raids);
    return core;
  }
}

// --- self-check: npx tsx src/sim/towncore.ts ---
if (typeof process !== 'undefined' && process.argv[1]?.endsWith('/towncore.ts')) {
  // A walled kitchen with two ovens + a walled home with two beds, side by side.
  const core = new TownCore({ width: 32, height: 32, seed: 7 });
  const g = core.grid;
  const KITCHEN = ROOM_TYPE_ID.get('kitchen')!;
  const HOME = ROOM_TYPE_ID.get('home')!;

  g.designateRect(2, 2, 7, 5, KITCHEN);
  for (let x = 1; x <= 8; x++) { g.setWall(x, 1); g.setWall(x, 6); }
  for (let y = 1; y <= 6; y++) { g.setWall(1, y); g.setWall(8, y); }
  g.placeStation('oven', 2, 2);
  g.placeStation('oven', 4, 2);

  g.designateRect(2, 9, 7, 12, HOME);
  for (let x = 1; x <= 8; x++) { g.setWall(x, 8); g.setWall(x, 13); }
  for (let y = 8; y <= 13; y++) { g.setWall(1, y); g.setWall(8, y); }
  g.placeStation('bed', 2, 9);
  g.placeStation('bed', 4, 9);
  g.rebuildRooms();

  core.stock.add('grain', 500);
  core.seedColony(3, 3, 6);

  const services = core.services();
  console.assert(services.sleep === 2, `two beds → sleep cap 2 (got ${services.sleep})`);

  core.run(50);
  console.assert(core.stock.count('meal') > 0, `ovens produced meals (got ${core.stock.count('meal')})`);
  console.assert(core.population > 0, 'colony survived the first 50 ticks');

  // Determinism: a twin built identically and run the same length must match exactly.
  const twin = TownCore.deserialize(core.serialize());
  core.run(80);
  twin.run(80);
  console.assert(
    JSON.stringify(core.serialize()) === JSON.stringify(twin.serialize()),
    'deserialized twin tracks the original tick-for-tick',
  );

  console.log('towncore.ts self-check OK — day', core.day, 'pop', core.population,
    'meals', core.stock.count('meal').toFixed(0), 'births', core.births, 'deaths', core.deaths);
}
