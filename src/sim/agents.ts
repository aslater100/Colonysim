/**
 * Data-oriented town agent store (Structure-of-Arrays) — the scale-engine core.
 *
 * The current `Simulation` keeps each settler as a fat object (~28 fields, 8–10
 * sub-allocations). At thousands of agents that means ~100k live objects and
 * heavy GC. This store keeps every agent field in a flat typed array instead:
 * cache-friendly, zero per-tick allocation, and trivially portable to a Web
 * Worker via transferable buffers later.
 *
 * Scope of THIS file (Stage 1 of the rewrite): the SoA layout, an allocation-free
 * per-tick update of the costly parts (needs decay, health, mood, time-sliced
 * decisions, movement), and swap-remove for deaths. It deliberately does NOT do
 * job assignment or pathfinding yet:
 *   ponytail: movement is straight-line here; flow-field pathing is Stage 2.
 * Straight-line movement lets the bench show the cost FLOOR of everything except
 * pathing — i.e. how much headroom we get back once flow fields replace per-agent A*.
 *
 * Run the self-check:  npx tsx src/sim/agents.ts
 */

export const enum AState {
  Idle = 0,
  Moving = 1,
  Sleeping = 2,
  Working = 3,
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
    }
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
        // Wander a short hop (placeholder for "pick a job and head to it").
        this.destX[i] = this.posX[i] + (rand() * 8 - 4);
        this.destY[i] = this.posY[i] + (rand() * 8 - 4);
        this.state[i] = AState.Moving;
        this.nextThink[i] = tickNo + THINK_INTERVAL;
      }

      // --- movement: step toward dest (straight line; flow fields come Stage 2) ---
      if (this.state[i] === AState.Moving) {
        const dx = this.destX[i] - this.posX[i];
        const dy = this.destY[i] - this.posY[i];
        const dist = Math.sqrt(dx * dx + dy * dy);
        const step = SPEED * MINUTES_PER_TICK;
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

// --- self-check: npx tsx src/sim/agents.ts ---
if (process.argv[1]?.endsWith('/agents.ts')) {
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
  console.log('agents.ts self-check OK — count', s.count, 'food', s.food[0].toFixed(1));
}
