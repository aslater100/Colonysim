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
import { AgentStore, AState, type AgentStoreSave } from './agents';
import { Stockpile } from './stockpile';
import { JobBoard } from './jobs';
import { FlowField } from './flowfield';
import { serveNeeds, aggregateCapacities, type RoomServices } from './needs';
import { Rng } from './rng';
import { MINUTES_PER_TICK, MINUTES_PER_DAY, NEED_INTERRUPT_THRESHOLD, ROOM_TYPE_ID } from './defs';

const SAVE_VERSION = 1;

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
  homeX: number;
  homeY: number;
  deaths: number;
  births: number;
  grid: BuildGridSave;
  agents: AgentStoreSave;
  stock: Partial<Record<string, number>>;
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
  private readonly jobField: FlowField;
  private readonly rng: Rng;
  private readonly _rand: () => number;

  tickNo = 0;
  minute = 0;
  day = 0;
  deaths = 0;
  births = 0;
  /** Colony anchor — where newcomers appear and the camera first looks. */
  homeX: number;
  homeY: number;

  constructor(opts: TownCoreOpts = {}) {
    const width = opts.width ?? MAP_W;
    const height = opts.height ?? MAP_H;
    this.grid = new BuildGrid(width, height);
    this.agents = new AgentStore(opts.capacity ?? 256);
    this.stock = new Stockpile();
    this.board = new JobBoard();
    this.jobField = new FlowField(width, height);
    this.rng = new Rng(opts.seed ?? 1);
    this._rand = () => this.rng.next();
    this.homeX = Math.floor(width / 2);
    this.homeY = Math.floor(height / 2);
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

    // 4. Needs from rooms: warmth (enclosure), rest (beds), recreation (tables).
    serveNeeds(this.grid, a, MINUTES_PER_TICK);

    // 5. Agent tick: needs decay, mood ease, health, movement.
    a.tick(t, this._rand);

    // 6. Deaths: swap-remove the starved (iterate backwards — splice-safe).
    for (let i = a.count - 1; i >= 0; i--) {
      if (a.health[i] <= STARVED_HEALTH) {
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

  // ── daily coarse update: feeding + population flows ──────────────────────────

  private dailyUpdate(): void {
    const a = this.agents;

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

  // ── serialization ────────────────────────────────────────────────────────────

  serialize(): TownCoreSave {
    return {
      v: SAVE_VERSION,
      tickNo: this.tickNo,
      minute: this.minute,
      day: this.day,
      rngState: this.rng.getState(),
      homeX: this.homeX,
      homeY: this.homeY,
      deaths: this.deaths,
      births: this.births,
      grid: this.grid.serialize(),
      agents: this.agents.serialize(),
      stock: this.stock.serialize(),
    };
  }

  static deserialize(data: TownCoreSave): TownCore {
    const grid = BuildGrid.deserialize(data.grid);
    const core = new TownCore({ width: grid.width, height: grid.height, capacity: data.agents.capacity });
    // Replace the freshly-built sub-systems with the restored ones.
    (core as { grid: BuildGrid }).grid = grid;
    (core as { agents: AgentStore }).agents = AgentStore.deserialize(data.agents);
    (core as { stock: Stockpile }).stock = Stockpile.deserialize(data.stock);
    core.rng.setState(data.rngState);
    core.tickNo = data.tickNo;
    core.minute = data.minute;
    core.day = data.day;
    core.homeX = data.homeX;
    core.homeY = data.homeY;
    core.deaths = data.deaths ?? 0;
    core.births = data.births ?? 0;
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
