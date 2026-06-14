/**
 * Data-oriented town agent store (Structure-of-Arrays) — the scale-engine core.
 *
 * The current `Simulation` keeps each settler as a fat object (~28 fields, 8–10
 * sub-allocations). At thousands of agents that means ~100k live objects and
 * heavy GC. This store keeps every agent field in a flat typed array instead:
 * cache-friendly, zero per-tick allocation, and trivially portable to a Web
 * Worker via transferable buffers later.
 *
 * Scope (Stages 1–2 of the rewrite): the SoA layout, an allocation-free per-tick
 * update of the costly parts (needs decay, health, mood, time-sliced decisions,
 * movement), and swap-remove for deaths.
 *
 * Stage 2 adds flow-field pathing. If the store is given one or more `FlowField`s
 * (one per hot destination — stockpile, hearth, job cluster), a moving agent reads
 * its current tile's precomputed step direction instead of running its own A*:
 * O(1) per agent, with the search paid once per field over the whole map. With no
 * fields registered the store falls back to the Stage-1 straight-line wander, so
 * the bench can still read the pure cost FLOOR (everything except pathing).
 *
 * Run the self-check:  npx tsx src/sim/agents.ts
 */
import { FlowField } from './flowfield';

export const enum AState {
  Idle = 0,
  Moving = 1,
  Sleeping = 2,
  Working = 3,
}

/** JSON round-trip shape for an AgentStore (every SoA column sliced to `count`). */
export interface AgentStoreSave {
  capacity: number;
  count: number;
  nextId: number;
  id: number[];
  posX: number[]; posY: number[];
  destX: (number | null)[]; destY: (number | null)[];
  health: number[]; mood: number[];
  food: number[]; rest: number[]; warmth: number[];
  recreation: number[]; social: number[];
  state: number[]; nextThink: number[];
  field: number[]; stationId: number[];
}

const SPEED = 0.45;              // tiles per game-minute (matches SETTLER_SPEED)
const MINUTES_PER_TICK = 4;      // matches defs.ts
const HOURS_PER_TICK = MINUTES_PER_TICK / 60;
const THINK_INTERVAL = 30;       // ticks between idle re-decisions (~½ game-day)

// Need decay per hour (mirrors TUNING.needDecayPerHour order of magnitude).
const DECAY_FOOD = 2.2;
const DECAY_REST = 2.0;
const DECAY_REC = 1.4;
const DECAY_SOCIAL = 1.2;

export class AgentStore {
  readonly capacity: number;
  count = 0;

  // --- SoA columns (one entry per live agent, indices 0..count-1) ---
  readonly id: Int32Array;
  readonly posX: Float32Array;
  readonly posY: Float32Array;
  readonly destX: Float32Array;   // movement target; NaN = none
  readonly destY: Float32Array;
  readonly health: Float32Array;
  readonly mood: Float32Array;
  readonly food: Float32Array;
  readonly rest: Float32Array;
  readonly warmth: Float32Array;
  readonly recreation: Float32Array;
  readonly social: Float32Array;
  readonly state: Uint8Array;
  readonly nextThink: Int32Array; // tick index at which an idle agent re-decides
  readonly field: Int8Array;      // index into `fields` the agent is navigating, -1 = straight-line
  /** Station id the agent is currently working at (0 = none; ids are 1+). Set by assignStation(). */
  readonly stationId: Int32Array;

  /** Registered flow fields (one per hot destination). Empty = Stage-1 wander. */
  fields: FlowField[] = [];
  // Scratch reused by movement so the tick stays allocation-free.
  private readonly _dir = { x: 0, y: 0 };

  private nextId = 1;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.id = new Int32Array(capacity);
    this.posX = new Float32Array(capacity);
    this.posY = new Float32Array(capacity);
    this.destX = new Float32Array(capacity);
    this.destY = new Float32Array(capacity);
    this.health = new Float32Array(capacity);
    this.mood = new Float32Array(capacity);
    this.food = new Float32Array(capacity);
    this.rest = new Float32Array(capacity);
    this.warmth = new Float32Array(capacity);
    this.recreation = new Float32Array(capacity);
    this.social = new Float32Array(capacity);
    this.state = new Uint8Array(capacity);
    this.nextThink = new Int32Array(capacity);
    this.field = new Int8Array(capacity);
    this.stationId = new Int32Array(capacity);
  }

  /** Add an agent; returns its index, or -1 if full. */
  spawn(x: number, y: number): number {
    if (this.count >= this.capacity) return -1;
    const i = this.count++;
    this.id[i] = this.nextId++;
    this.posX[i] = x;
    this.posY[i] = y;
    this.destX[i] = NaN;
    this.destY[i] = NaN;
    this.health[i] = 100;
    this.mood[i] = 60;
    this.food[i] = this.rest[i] = this.warmth[i] = this.recreation[i] = this.social[i] = 80;
    this.state[i] = AState.Idle;
    this.field[i] = -1;
    this.stationId[i] = 0;
    // Stagger first decision so a cohort spawned together doesn't think in lockstep.
    this.nextThink[i] = i % THINK_INTERVAL;
    return i;
  }

  /** Swap-remove: O(1) by moving the last agent into the gap. Invalidates index `i`. */
  remove(i: number): void {
    const last = --this.count;
    if (i !== last) {
      this.id[i] = this.id[last];
      this.posX[i] = this.posX[last]; this.posY[i] = this.posY[last];
      this.destX[i] = this.destX[last]; this.destY[i] = this.destY[last];
      this.health[i] = this.health[last]; this.mood[i] = this.mood[last];
      this.food[i] = this.food[last]; this.rest[i] = this.rest[last];
      this.warmth[i] = this.warmth[last]; this.recreation[i] = this.recreation[last];
      this.social[i] = this.social[last]; this.state[i] = this.state[last];
      this.nextThink[i] = this.nextThink[last];
      this.field[i] = this.field[last];
      this.stationId[i] = this.stationId[last];
    }
  }

  /**
   * Send agent `i` toward flow field `fieldIdx` (an index into `fields`). The agent
   * follows the field until it reaches the goal (or hits an unreachable tile), then
   * goes Idle. Out-of-range ids are ignored.
   */
  assignField(i: number, fieldIdx: number): void {
    if (fieldIdx < 0 || fieldIdx >= this.fields.length) return;
    this.field[i] = fieldIdx;
    this.state[i] = AState.Moving;
  }

  /**
   * Assign agent `i` to work at a station (by id). Sets state to Working and
   * stops any flow-field navigation. The station's `tickProduction` will advance
   * the recipe while the agent is assigned.
   */
  assignStation(i: number, stationId: number): void {
    this.stationId[i] = stationId;
    this.state[i] = AState.Working;
    this.field[i] = -1;
  }

  /** Release agent `i` from its station and return it to Idle. */
  unassignStation(i: number): void {
    this.stationId[i] = 0;
    this.state[i] = AState.Idle;
  }

  // --- serialization (round-trips the SoA columns; flow fields are re-registered
  //     by the caller, never persisted) ---

  serialize(): AgentStoreSave {
    const n = this.count;
    const slice = (a: ArrayLike<number>) => Array.from({ length: n }, (_, i) => a[i]);
    // destX/destY use NaN as the "no destination" sentinel; NaN is not JSON-safe
    // (it stringifies to null and reloads as 0), so persist it explicitly as null.
    const sliceDest = (a: ArrayLike<number>) =>
      Array.from({ length: n }, (_, i) => (Number.isNaN(a[i]) ? null : a[i]));
    return {
      capacity: this.capacity,
      count: n,
      nextId: this.nextId,
      id: slice(this.id),
      posX: slice(this.posX), posY: slice(this.posY),
      destX: sliceDest(this.destX), destY: sliceDest(this.destY),
      health: slice(this.health), mood: slice(this.mood),
      food: slice(this.food), rest: slice(this.rest), warmth: slice(this.warmth),
      recreation: slice(this.recreation), social: slice(this.social),
      state: slice(this.state), nextThink: slice(this.nextThink),
      field: slice(this.field), stationId: slice(this.stationId),
    };
  }

  static deserialize(data: AgentStoreSave): AgentStore {
    const store = new AgentStore(data.capacity);
    const n = data.count;
    store.count = n;
    store.nextId = data.nextId;
    for (let i = 0; i < n; i++) {
      store.id[i] = data.id[i];
      store.posX[i] = data.posX[i]; store.posY[i] = data.posY[i];
      store.destX[i] = data.destX[i] ?? NaN; store.destY[i] = data.destY[i] ?? NaN;
      store.health[i] = data.health[i]; store.mood[i] = data.mood[i];
      store.food[i] = data.food[i]; store.rest[i] = data.rest[i]; store.warmth[i] = data.warmth[i];
      store.recreation[i] = data.recreation[i]; store.social[i] = data.social[i];
      store.state[i] = data.state[i]; store.nextThink[i] = data.nextThink[i];
      store.field[i] = data.field[i]; store.stationId[i] = data.stationId[i];
    }
    return store;
  }

  /**
   * One simulation tick. Allocation-free: every write is into a preallocated
   * column. `rand` is the sim RNG (kept external so the store stays deterministic
   * and side-effect-free). Returns nothing — death handling is the caller's job
   * via a post-pass over `health` (kept simple for the proof).
   */
  tick(tickNo: number, rand: () => number): void {
    const n = this.count;
    for (let i = 0; i < n; i++) {
      // --- needs decay (tight, branch-light: the part that vectorizes) ---
      const f = this.food[i] - DECAY_FOOD * HOURS_PER_TICK;
      this.food[i] = f > 0 ? f : 0;
      if (this.state[i] !== AState.Sleeping) {
        const r = this.rest[i] - DECAY_REST * HOURS_PER_TICK;
        this.rest[i] = r > 0 ? r : 0;
      }
      const rc = this.recreation[i] - DECAY_REC * HOURS_PER_TICK;
      this.recreation[i] = rc > 0 ? rc : 0;
      const so = this.social[i] - DECAY_SOCIAL * HOURS_PER_TICK;
      this.social[i] = so > 0 ? so : 0;

      // --- health: starvation bleeds, otherwise slow regen ---
      if (this.food[i] <= 0) {
        this.health[i] -= 1.5 * HOURS_PER_TICK;
      } else if (this.health[i] < 100) {
        const h = this.health[i] + 0.5 * HOURS_PER_TICK;
        this.health[i] = h < 100 ? h : 100;
      }

      // --- mood: ease toward the weighted-need target (matches sim's 0.05 lerp) ---
      const target = this.food[i] * 0.3 + this.rest[i] * 0.25 + this.warmth[i] * 0.2
        + this.recreation[i] * 0.15 + this.social[i] * 0.1;
      this.mood[i] += (target - this.mood[i]) * 0.05;

      // --- time-sliced decision: only idle agents that are due re-pick a goal ---
      if (this.state[i] === AState.Idle && tickNo >= this.nextThink[i]) {
        if (this.fields.length > 0) {
          // Pick a hot destination and follow its flow field there (Stage 2).
          // Spread agents across fields by id so traffic isn't all one route.
          this.assignField(i, this.id[i] % this.fields.length);
        } else {
          // Stage-1 fallback: wander a short hop (no field registered).
          this.destX[i] = this.posX[i] + (rand() * 8 - 4);
          this.destY[i] = this.posY[i] + (rand() * 8 - 4);
          this.state[i] = AState.Moving;
        }
        this.nextThink[i] = tickNo + THINK_INTERVAL;
      }

      // --- movement ---
      if (this.state[i] === AState.Moving) {
        const step = SPEED * MINUTES_PER_TICK;
        const fi = this.field[i];
        if (fi >= 0) {
          // Flow-field follow: read this tile's precomputed step direction (O(1)).
          const field = this.fields[fi];
          const tx = Math.floor(this.posX[i]);
          const ty = Math.floor(this.posY[i]);
          if (field.dirAt(tx, ty, this._dir)) {
            const len = Math.sqrt(this._dir.x * this._dir.x + this._dir.y * this._dir.y) || 1;
            this.posX[i] += (this._dir.x / len) * step;
            this.posY[i] += (this._dir.y / len) * step;
          } else {
            // No onward step: arrived at the goal (or stuck on an unreachable tile).
            this.state[i] = AState.Idle;
            this.field[i] = -1;
          }
        } else {
          // Stage-1 straight-line move toward dest.
          const dx = this.destX[i] - this.posX[i];
          const dy = this.destY[i] - this.posY[i];
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist <= step || dist === 0) {
            this.posX[i] = this.destX[i];
            this.posY[i] = this.destY[i];
            this.state[i] = AState.Idle;
          } else {
            this.posX[i] += (dx / dist) * step;
            this.posY[i] += (dy / dist) * step;
          }
        }
      }
    }
  }
}

// --- self-check: npx tsx src/sim/agents.ts ---
if (typeof process !== 'undefined' && process.argv[1]?.endsWith('/agents.ts')) {
  const s = new AgentStore(10);
  for (let i = 0; i < 5; i++) s.spawn(10 + i, 10);
  console.assert(s.count === 5, 'spawned 5');
  const removedId = s.id[1];
  s.remove(1);
  console.assert(s.count === 4, 'count after remove');
  console.assert(![s.id[0], s.id[1], s.id[2], s.id[3]].includes(removedId), 'removed id gone');
  let rng = 1; const rand = () => (rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let t = 0; t < 100; t++) s.tick(t, rand);
  console.assert(s.food[0] < 80, 'food decayed');
  console.assert(s.posX[0] !== 10, 'agent moved');

  // Stage 2: with a flow field registered, a moving agent walks to the goal tile.
  const W = 32;
  const field = new FlowField(W, W);
  field.build([field.index(16, 16)], () => true, () => 1);
  const s2 = new AgentStore(4);
  const a = s2.spawn(2, 2);
  s2.fields = [field];
  s2.assignField(a, 0);
  for (let t = 0; t < 400 && s2.state[a] === AState.Moving; t++) s2.tick(t, rand);
  console.assert(Math.abs(s2.posX[a] - 16) <= 1.5 && Math.abs(s2.posY[a] - 16) <= 1.5,
    'agent followed the flow field to the goal');

  console.log('agents.ts self-check OK — count', s.count, 'food', s.food[0].toFixed(1),
    '— flow-field arrival', `(${s2.posX[a].toFixed(1)},${s2.posY[a].toFixed(1)})`);
}
