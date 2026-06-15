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
import { BuildGrid, ZONE, ZONE_DEFS, TERRAIN, type BuildGridSave } from './build';
import { AgentStore, AState, ThoughtKey, type AgentStoreSave } from './agents';
import { Stockpile } from './stockpile';
import { JobBoard } from './jobs';
import { FlowField } from './flowfield';
import { serveNeeds, serveMedical, aggregateCapacities, type RoomServices } from './needs';
import { Relations, socialize } from './social';
import { Weather } from './weather';
import { RaidForce, raidSize, type RaidForceSave } from './raid';
import { WolfPack, type WolfPackSave } from './wolves';
import { Ledger, type LedgerSave, type BorrowResult, type RepayResult } from './ledger';
import { ResearchBook, type ResearchBookSave } from './research';
import { Rng } from './rng';
import { BASE_PRICES } from './economy';
import { MINUTES_PER_TICK, MINUTES_PER_DAY, NEED_INTERRUPT_THRESHOLD, ROOM_TYPE_ID, STATION_DEF_BY_NUM, STATION_TYPE_ID, TRAIT_DEFS, TUNING, type ResourceKind } from './defs';

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

// Town-tier inflation (economy parity port): credit + hoarded coin chase too few
// goods, so prices drift up. Eases monthly toward a target set by the money supply
// (gold + outstanding debt) over a GDP proxy (colony wealth). A debt-free,
// coin-poor colony sits at ~0 — heavy borrowing or a gold glut nudges prices up.
const INFLATION_GDP_FACTOR = 4;      // money-supply ÷ (wealth × this) that reads as balanced
const INFLATION_SENSITIVITY = 0.5;   // how hard the imbalance pushes inflation
const INFLATION_EASE = 0.25;         // fraction of the gap closed each month
const INFLATION_MAX = 0.5;           // hard cap (50%) so it can't run away
// The economy settles on a 30-day month, matching the ledger's payment cadence.
const ECONOMY_MONTH_DAYS = 30;

const SAVE_VERSION = 7;

// Behavior thresholds for the integration loop (modest, deterministic — full
// mood/skills/trait fidelity is the remaining parity work, not this stage).
const REST_SLEEP_BELOW = 30;   // rest under this → go to sleep, releasing any job
const REST_WAKE_AT = 95;       // rest at/over this → wake up and look for work
const BIRTH_MOOD_MIN = 50;     // colony must be reasonably content to grow
const STARVED_HEALTH = 0;      // health at/under this → death (swap-removed)
const HARVEST_TILES_PER_WORKER = 4; // zone tiles one settler can work per day (labour cap)
const HARVEST_YIELD = 1;            // raw goods a worked zone tile yields per day
const BUILD_WORK_PER_WORKER = 30;   // construction work one settler delivers per day
const WALL_WORK = 20, FLOOR_WORK = 10;
const WALL_COST: Partial<Record<ResourceKind, number>> = { wood: 1 };
const FLOOR_COST: Partial<Record<ResourceKind, number>> = { wood: 1 };

/** A dated event line for the HUD feed + audio cues. Shape mirrors the fat sim's
 *  `LogEntry` ({ day, text, kind }) so the existing HUD log box can consume a
 *  TownCore's log unchanged when the swap wires it in. */
export interface LogEntry {
  day: number;
  text: string;
  kind: 'info' | 'good' | 'bad';
}

/** A displayable snapshot of one settler, reconstructed from the SoA columns —
 *  what a HUD inspector panel needs without reaching into the typed arrays. */
export interface SettlerView {
  id: number;
  name: string;
  x: number;
  y: number;
  state: 'idle' | 'moving' | 'sleeping' | 'working';
  mood: number;
  health: number;
  food: number;
  rest: number;
  warmth: number;
  recreation: number;
  social: number;
  skill: number;
  traits: string[];
  armed: 'unarmed' | 'spear' | 'weapon';
  wounded: boolean;
  infected: boolean;
  sick: boolean;
}

/** A displayable snapshot of one craft station — what a renderer needs without
 *  reaching into the BuildGrid arrays. */
export interface StationView {
  x: number;
  y: number;
  /** Numeric station-type id (1-based, matches BuildGrid.stations[].typeId). */
  typeId: number;
  /** String id from stations.json (e.g. 'oven', 'bed'). */
  stationId: string;
}

/** A displayable snapshot of one active raider — position, health, and flee state. */
export interface RaiderView {
  x: number;
  y: number;
  health: number;
  fleeing: boolean;
}

/** A pending construction: a painted blueprint awaiting materials + labour before
 *  it becomes a real wall / floor / station (Songs-of-Syx build flow). */
export interface BuildOrder {
  kind: 'wall' | 'floor' | 'station';
  x: number;
  y: number;
  stationId: number; // station-type id for 'station'; 0 otherwise
  roomType: number;  // designation applied with a 'floor'; 0 otherwise
  workLeft: number;
  cost: Partial<Record<ResourceKind, number>>;
}

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
  /** v3+: any in-progress wolf pack (schedule is a per-day roll, nothing to persist). */
  wolves?: WolfPackSave;
  /** v4+: the credit book (lenders + loans) and the current inflation rate. */
  ledger?: LedgerSave;
  inflation?: number;
  /** v5+: the event log feed (old saves restore an empty log). */
  log?: LogEntry[];
  /** v6+: the pending blueprint queue (old saves restore none). */
  builds?: BuildOrder[];
  /** v7+: the research book (points + unlocked techs; old saves restore defaults). */
  researchBook?: ResearchBookSave;
}

export interface TownCoreOpts {
  width?: number;
  height?: number;
  capacity?: number;
  seed?: number;
  /** Generate natural terrain (forests/water/rock/ore) into the grid at construction.
   *  Off by default so the all-grass core stays byte-identical for existing tests;
   *  the live swap (B-6 PART 3) turns this on. */
  terrain?: boolean;
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
  /** Predator packs: wolves prowl in from the edge and pick off strays. */
  readonly wolves = new WolfPack();
  /** Credit book: NPC lenders the colony can borrow gold from, serviced monthly. */
  readonly ledger = new Ledger();
  /** Town-tier inflation rate (0 = none); applied on top of market prices. */
  inflation = 0;
  /** Append-only event feed (raids, deaths, births, milestones) for the HUD + audio. */
  readonly log: LogEntry[] = [];
  /** Painted blueprints awaiting materials + labour (Songs-of-Syx construction). */
  readonly builds: BuildOrder[] = [];
  /** Tech research: library desks accumulate points; the player spends them to
   *  unlock techs that boost yields, combat, and medicine. */
  readonly researchBook = new ResearchBook();
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
    // Terrain is painted from a dedicated stream so the main rng (weather, raids,
    // births) is byte-for-byte identical whether or not terrain is generated.
    if (opts.terrain) this.grid.generateTerrain(new Rng((seed ^ 0x9e3779b1) >>> 0));
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

  /** Append a dated line to the event feed (used by the HUD + audio cues). */
  private addLog(text: string, kind: LogEntry['kind'] = 'info'): void {
    this.log.push({ day: this.day, text, kind });
  }

  /** A displayable snapshot of settler `i` (SoA columns → a plain record for the
   *  HUD inspector). Returns null for an out-of-range index. */
  inspect(i: number): SettlerView | null {
    const a = this.agents;
    if (i < 0 || i >= a.count) return null;
    const stateName = (['idle', 'moving', 'sleeping', 'working'] as const)[a.state[i]] ?? 'idle';
    const traits: string[] = [];
    for (const ti of [a.trait0[i], a.trait1[i]]) if (ti >= 0 && TRAIT_DEFS[ti]) traits.push(TRAIT_DEFS[ti].name);
    return {
      id: a.id[i],
      name: a.name(i),
      x: a.posX[i],
      y: a.posY[i],
      state: stateName,
      mood: a.mood[i],
      health: a.health[i],
      food: a.food[i],
      rest: a.rest[i],
      warmth: a.warmth[i],
      recreation: a.recreation[i],
      social: a.social[i],
      skill: a.skill[i],
      traits,
      armed: a.armed[i] === 2 ? 'weapon' : a.armed[i] === 1 ? 'spear' : 'unarmed',
      wounded: a.woundUntreated[i] === 1,
      infected: a.infection[i] === 1,
      sick: a.sick[i] === 1,
    };
  }

  /** Iterate all live settlers as `SettlerView` objects.
   *  Preferred over reading SoA columns directly in renderers and HUD code. */
  *settlers(): Generator<SettlerView, void, unknown> {
    for (let i = 0; i < this.agents.count; i++) {
      const v = this.inspect(i);
      if (v) yield v;
    }
  }

  /** Iterate all craft stations placed on the build grid.
   *  Yields one `StationView` per station (same order as `BuildGrid.stations`). */
  *stationViews(): Generator<StationView, void, unknown> {
    for (const s of this.grid.stations) {
      const def = STATION_DEF_BY_NUM[s.typeId];
      if (!def) continue;
      yield { x: s.x, y: s.y, typeId: s.typeId, stationId: def.id };
    }
  }

  /** Iterate all active raiders as `RaiderView` objects. */
  *raiders(): Generator<RaiderView, void, unknown> {
    for (const r of this.raids.raiders) {
      yield { x: r.x, y: r.y, health: r.health, fleeing: r.fleeing };
    }
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
    if (placed > 0) this.addLog(`${placed} settlers step off the wagon and make camp.`, 'good');
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
    serveNeeds(this.grid, a, MINUTES_PER_TICK, dayWeather.tempAnomalyC, true /* colony-wide beds/tables */);
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
    const wasRaiding = this.raids.active;
    const wasWolves = this.wolves.active;
    // militia_training tech grants a 30% defender damage bonus in raids and wolf attacks.
    const militiaMult = this.researchBook.hasTech('militia_training') ? 1.3 : 1.0;
    if (this.day >= this.nextRaidDay && !this.raids.active) {
      this.musterRaid();
    }
    if (this.raids.active) {
      // The horn rallies the colony: nobody sleeps through a raid.
      for (let i = 0; i < a.count; i++) if (a.state[i] === AState.Sleeping) a.state[i] = AState.Idle;
      this.raids.tick(this.grid, a, t, militiaMult);
      for (let i = 0; i < a.count; i++) {
        if (a.woundUntreated[i] === 1 && a.woundAt[i] === t) {
          a.addThought(i, t, RAID_FEAR_DELTA, RAID_FEAR_TICKS);
        }
      }
    }

    // 5d. Wolves: a prowling pack stalks strays and mauls whoever it catches.
    //     Casualties fall through the death pass below; the bitten carry the dread.
    if (this.wolves.active) {
      this.wolves.tick(this.grid, a, t, this.rng, militiaMult);
      for (let i = 0; i < a.count; i++) {
        if (a.woundUntreated[i] === 1 && a.woundAt[i] === t) {
          a.addThought(i, t, RAID_FEAR_DELTA, RAID_FEAR_TICKS);
        }
      }
    }

    // A repelled raid / a pack that has slunk off: log the all-clear once.
    if (wasRaiding && !this.raids.active) this.addLog('The raiders break and flee. The colony holds.', 'good');
    if (wasWolves && !this.wolves.active) this.addLog('The wolves slink back into the wilds.', 'info');

    // 6. Deaths: swap-remove the starved (iterate backwards — splice-safe). Each
    //    death grieves the survivors — friends mourn harder — and forgets the bond.
    let died = 0;
    let lastDeadName = '';
    for (let i = a.count - 1; i >= 0; i--) {
      if (a.health[i] <= STARVED_HEALTH) {
        const deadId = a.id[i];
        lastDeadName = a.name(i);
        for (let j = 0; j < a.count; j++) {
          if (j === i) continue;
          const friend = this.relations.areFriends(deadId, a.id[j]);
          a.addThought(j, t, friend ? GRIEF_FRIEND_DELTA : GRIEF_DELTA, friend ? GRIEF_FRIEND_TICKS : GRIEF_TICKS);
        }
        this.relations.forget(deadId);
        a.remove(i);
        this.deaths++;
        died++;
      }
    }
    if (died > 0) {
      this.addLog(died === 1 ? `${lastDeadName} has died.` : `${died} settlers have died.`, 'bad');
      if (a.count === 0) this.addLog('The colony has perished.', 'bad');
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
    this.armColony();
    const n = raidSize(this.wealth(), this.day, this.agents.count);
    this.raids.start(n, this.grid.width, this.grid.height, this.rng, this.tickNo);
    this.nextRaidDay = this.day + TUNING.raidIntervalDays + this.rng.int(5);
    this.addLog(`Raiders close on the colony — ${n} of them!`, 'bad');
  }

  /** Loose a wolf pack now (the daily scheduler + the play-test's "wolves" key). */
  summonWolves(n = 2 + this.rng.int(2)): void {
    if (this.wolves.active) return;
    this.wolves.start(n, this.grid.width, this.grid.height, this.rng, this.tickNo);
    this.addLog('A wolf pack prowls in from the forest edge.', 'bad');
  }

  /**
   * Arm whoever is still bare-handed from the stores when the horn sounds: a
   * forged weapon first (sharper edge), else an improvised spear whittled from
   * wood. Mirrors the fat sim's militia grabbing arms as they rally; once armed a
   * settler keeps the weapon. Stops when the materials run out — the rest fight
   * bare-handed.
   */
  private armColony(): void {
    const a = this.agents;
    for (let i = 0; i < a.count; i++) {
      if (a.armed[i] !== 0) continue;
      if (this.stock.remove('weapons', 1)) a.armed[i] = 2;
      else if (this.stock.remove('wood', TUNING.spearWoodCost)) a.armed[i] = 1;
      else break;
    }
  }

  // ── daily coarse update: feeding + population flows ──────────────────────────

  private dailyUpdate(): void {
    const a = this.agents;

    // Primary production: the colony works its designated harvest zones into raw
    // goods (run before feeding so the day's grain/meals are on hand).
    this.harvestZones();
    // Construction: spend the day's labour on the blueprint queue.
    this.tickConstruction();

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
      const newcomer = this.spawnPerson(this.homeX, this.homeY);
      if (newcomer >= 0) {
        this.births++;
        this.addLog(`${a.name(newcomer)} is drawn to the colony.`, 'good');
      }
    }

    // Wildlife: past the first prowl day, a wolf pack may slip in from the edge
    // (per-day chance, mirrors the fat sim). Only one pack prowls at a time.
    if (this.day >= TUNING.wolfFirstDay && !this.wolves.active && this.rng.chance(TUNING.wolfPackChancePerDay)) {
      this.summonWolves();
    }

    // Research: library desks (education capacity) generate points daily.
    // Auto-research if a queue target is now affordable (player set via core.researchBook.queue).
    this.researchBook.addPoints(services.education);
    const autoResearched = this.researchBook.autoResearch();
    if (autoResearched) this.addLog(`Research complete: ${autoResearched}`, 'good');

    // Economy: once a month, accrue loan interest, auto-service the debt from the
    // treasury, and re-reckon inflation from the money supply.
    if (this.day > 0 && this.day % ECONOMY_MONTH_DAYS === 0) this.monthlyEconomy();
  }

  /**
   * Work the designated harvest zones into raw goods. Labour-capped: the colony can
   * only work so many tiles a day, scaled by headcount, so a vast field still needs
   * hands to reap it. Consuming zones (woodcutter/quarry) strip the tile back to
   * grass once worked; renewable ones (field/fishery) yield again next day. A
   * quarry on an ore-flecked tile pulls iron ore instead of plain stone.
   * ponytail: flat per-worker tile budget + flat yield — the knobs to tune in the
   * GUI; per-tile pathing/regrowth timers can come later if it needs the texture.
   */
  private harvestZones(): void {
    const grid = this.grid;
    let budget = Math.floor(this.agents.count * HARVEST_TILES_PER_WORKER);
    if (budget <= 0) return;
    // crop_rotation tech grants a 25% field yield bonus; crop_science stacks another 20%.
    const fieldMult = 1
      + (this.researchBook.hasTech('crop_rotation') ? 0.25 : 0)
      + (this.researchBook.hasTech('crop_science') ? 0.20 : 0);
    for (let i = 0; i < grid.size && budget > 0; i++) {
      const z = grid.zone[i];
      if (z === ZONE.NONE) continue;
      const def = ZONE_DEFS[z];
      if (!def) continue;
      const x = i % grid.width, y = (i / grid.width) | 0;
      if (!grid.canZone(x, y, z)) { grid.zone[i] = ZONE.NONE; continue; } // terrain changed under it
      const res = z === ZONE.QUARRY && grid.ore[i] ? 'iron_ore' : def.resource;
      const yield_ = z === ZONE.FIELD ? HARVEST_YIELD * fieldMult : HARVEST_YIELD;
      this.stock.add(res, yield_);
      budget--;
      if (!def.renewable) { grid.setTerrain(x, y, TERRAIN.GRASS); grid.zone[i] = ZONE.NONE; }
    }
  }

  // ── construction: painted blueprints → real build over time ──────────────────

  private _pendingAt(x: number, y: number): boolean {
    return this.builds.some((o) => o.x === x && o.y === y);
  }

  /** Queue a wall blueprint (no-op if off-grid, already walled, or already queued). */
  blueprintWall(x: number, y: number): boolean {
    if (!this.grid.inBounds(x, y) || this.grid.wall[this.grid.index(x, y)] || this._pendingAt(x, y)) return false;
    this.builds.push({ kind: 'wall', x, y, stationId: 0, roomType: 0, workLeft: WALL_WORK, cost: { ...WALL_COST } });
    return true;
  }

  /** Queue a floor blueprint, optionally designating it a room type once built. */
  blueprintFloor(x: number, y: number, roomType = 0): boolean {
    if (!this.grid.inBounds(x, y) || this.grid.floor[this.grid.index(x, y)] || this._pendingAt(x, y)) return false;
    this.builds.push({ kind: 'floor', x, y, stationId: 0, roomType, workLeft: FLOOR_WORK, cost: { ...FLOOR_COST } });
    return true;
  }

  /** Queue a station blueprint (id or numeric type). Cost + work come from its def. */
  blueprintStation(station: string | number, x: number, y: number): boolean {
    const typeId = typeof station === 'number' ? station : (STATION_TYPE_ID.get(station) ?? 0);
    const def = STATION_DEF_BY_NUM[typeId];
    if (!def || !this.grid.inBounds(x, y) || this._pendingAt(x, y)) return false;
    this.builds.push({ kind: 'station', x, y, stationId: typeId, roomType: 0, workLeft: def.buildWork, cost: { ...def.cost } });
    return true;
  }

  /** Cancel any pending blueprint on a tile (player erase). Returns true if removed. */
  cancelBlueprint(x: number, y: number): boolean {
    const k = this.builds.findIndex((o) => o.x === x && o.y === y);
    if (k < 0) return false;
    this.builds.splice(k, 1);
    return true;
  }

  private _canAfford(cost: Partial<Record<ResourceKind, number>>): boolean {
    for (const k in cost) if (this.stock.count(k as ResourceKind) < (cost[k as ResourceKind] ?? 0)) return false;
    return true;
  }

  private _materialize(o: BuildOrder): boolean {
    if (o.kind === 'wall') return this.grid.setWall(o.x, o.y);
    if (o.kind === 'floor') {
      this.grid.setFloor(o.x, o.y);
      if (o.roomType) this.grid.designate(o.x, o.y, o.roomType);
      return true;
    }
    return this.grid.placeStation(o.stationId, o.x, o.y) !== null; // may fail if the tile's unfit
  }

  /**
   * Spend the day's construction labour on the blueprint queue. Each order needs
   * its materials in stock to make progress (no materials → it waits); once the
   * work is done the goods are consumed and the wall/floor/station becomes real.
   * Labour-capped by headcount like harvesting. ponytail: flat per-worker budget,
   * materials charged on completion — fine until the GUI says otherwise.
   */
  private tickConstruction(): void {
    let budget = Math.floor(this.agents.count * BUILD_WORK_PER_WORKER);
    if (budget <= 0 || this.builds.length === 0) return;
    let built = false;
    for (let k = 0; k < this.builds.length && budget > 0;) {
      const o = this.builds[k];
      if (!this._canAfford(o.cost)) { k++; continue; } // stalled on materials
      const spend = Math.min(budget, o.workLeft);
      o.workLeft -= spend;
      budget -= spend;
      if (o.workLeft > 0) { k++; continue; }
      // Finished: place it, then pay for it (only if placement stuck).
      if (this._materialize(o)) { this.stock.removeAll(o.cost); built = true; }
      this.builds.splice(k, 1); // drop whether placed or rejected (bad tile)
    }
    if (built) this.grid.rebuildRooms();
  }

  /** Monthly credit + inflation update (loans accrue, get serviced, prices reckon). */
  private monthlyEconomy(): void {
    this.ledger.accrueInterest(this.day);
    this.gold -= this.ledger.autoService(this.day, this.gold);
    this.updateInflation();
  }

  /**
   * Re-reckon town-tier inflation from the money supply (gold + outstanding debt)
   * relative to a GDP proxy (colony wealth). Eases toward the target each month and
   * decays back to 0 once the money/goods balance is restored. Mirrors the spirit
   * of `economy.ts.updateInflation` at town altitude.
   */
  private updateInflation(): void {
    const moneySupply = this.gold + this.ledger.totalDebt();
    const gdp = Math.max(1, this.wealth());
    const imbalance = moneySupply / (gdp * INFLATION_GDP_FACTOR) - 1;
    const target = Math.min(INFLATION_MAX, Math.max(0, imbalance) * INFLATION_SENSITIVITY);
    this.inflation += (target - this.inflation) * INFLATION_EASE;
    if (this.inflation < 1e-4) this.inflation = 0;
  }

  // ── research ──────────────────────────────────────────────────────────────────

  /**
   * Spend accumulated research points to unlock a tech.
   * Returns true if the tech was successfully researched, false if prereqs are
   * missing, already researched, or not enough points.  Logs the event.
   */
  research(techId: string): boolean {
    const ok = this.researchBook.research(techId);
    if (ok) this.addLog(`Research complete: ${techId}`, 'good');
    return ok;
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
    return base * this.priceMult(mod);
  }

  /**
   * The live multiplier on a resource's base price: the supply/demand modifier
   * clamped to 0.5×–2.0×, times the inflation factor (1 + inflation). Inflation is
   * 0 for a debt-free, coin-poor colony, so this is exactly the supply/demand clamp
   * until the colony starts printing money via credit.
   */
  private priceMult(mod: number): number {
    return Math.max(0.5, Math.min(2.0, mod)) * (1 + this.inflation);
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
      revenue += base * this.priceMult(mod);
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
      cost += base * this.priceMult(mod);
      mod += e; // each unit bought bids the price up
    }
    cost = Math.round(cost);
    if (cost > this.gold) return false;
    this.gold -= cost;
    this.stock.add(kind, qty);
    this.priceModifiers.set(kind, mod);
    return true;
  }

  // ── credit: borrow / repay against the ledger ────────────────────────────

  /**
   * Borrow `amount` gold from lender `lenderId` over `termMonths`. On success the
   * proceeds land in the treasury and the colony owes monthly installments (auto-
   * serviced from gold; default if the coffers stay empty past the grace period).
   */
  takeLoan(lenderId: number, amount: number, termMonths: number): BorrowResult {
    const res = this.ledger.borrow(lenderId, amount, termMonths, this.day);
    if (res.ok) this.gold += amount;
    return res;
  }

  /** Pay `amount` toward a loan from the treasury (manual paydown; UI/AI call). */
  repayLoan(loanId: number, amount: number): RepayResult {
    if (amount > this.gold) return { ok: false, reason: 'Insufficient gold' };
    const res = this.ledger.repay(loanId, amount, this.day);
    if (res.ok) this.gold -= amount;
    return res;
  }

  /** Outstanding (non-defaulted) loan balance. */
  totalDebt(): number {
    return this.ledger.totalDebt();
  }

  /** Treasury net of outstanding debt — what the colony is really worth in coin. */
  netWorth(): number {
    return this.gold - this.totalDebt();
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
      wolves: this.wolves.serialize(),
      ledger: this.ledger.serialize(),
      inflation: this.inflation,
      log: this.log.length > 0 ? this.log : undefined,
      builds: this.builds.length > 0 ? this.builds : undefined,
      researchBook: this.researchBook.serialize(),
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
    // v3+: restore any in-progress wolf pack (old saves keep the empty pack).
    if (data.wolves) (core as { wolves: WolfPack }).wolves = WolfPack.deserialize(data.wolves);
    // v4+: restore the credit book + inflation (old saves keep fresh lenders, 0%).
    if (data.ledger) (core as { ledger: Ledger }).ledger = Ledger.deserialize(data.ledger);
    core.inflation = data.inflation ?? 0;
    // v5+: restore the event feed (old saves restore an empty log).
    if (data.log) core.log.push(...data.log);
    // v6+: restore the blueprint queue.
    if (data.builds) core.builds.push(...data.builds);
    // v7+: restore the research book (old saves keep the default: crop_rotation free, 0 pts).
    if (data.researchBook) (core as { researchBook: ResearchBook }).researchBook = ResearchBook.deserialize(data.researchBook);
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
