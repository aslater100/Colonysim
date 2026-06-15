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
 * Stage 4 (behavior port) adds per-agent **traits + skills** as SoA columns. The
 * fat-object sim stores `traits: string[]` and `skills: Record<WorkKind, number>`
 * and re-walks them every tick (a per-agent allocation + branch storm). Here each
 * trait's effects are collapsed once, at spawn, into flat multiplier columns
 * (`workSpeedMult`, `foodDecayMult`, …) the hot tick reads branch-free, and the
 * 21-way WorkKind skill split — a discrete-building artifact — becomes a single
 * `skill` column that accelerates whichever craft station the agent mans (the
 * room/station model has no per-kind work). Skill grows while Working, capped, and
 * feeds production through `tickProduction`'s effort sum.
 *
 * Run the self-check:  npx tsx src/sim/agents.ts
 */
import { FlowField } from './flowfield';
import { TRAIT_DEFS, TUNING, FIRST_NAMES, LAST_NAMES } from './defs';

/** Deterministic name from a stable agent id — no RNG, so naming never perturbs
 *  the sim's random streams and a reloaded agent keeps the same name. */
function nameForId(id: number): string {
  const first = FIRST_NAMES[id % FIRST_NAMES.length];
  const last = LAST_NAMES[Math.floor(id / FIRST_NAMES.length) % LAST_NAMES.length];
  return `${first} ${last}`;
}

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
  /** Display names (optional: pre-name saves derive them from id on load). */
  names?: string[];
  posX: number[]; posY: number[];
  destX: (number | null)[]; destY: (number | null)[];
  health: number[]; mood: number[];
  food: number[]; rest: number[]; warmth: number[];
  recreation: number[]; social: number[];
  state: number[]; nextThink: number[];
  field: number[]; stationId: number[];
  skill: number[]; trait0: number[]; trait1: number[];
  armed: number[];
  woundUntreated: number[]; woundAt: number[]; infectionRolled: number[];
  infection: number[]; sickUntilTick: number[];
  thoughtDelta: number[]; thoughtExpiry: number[]; thoughtKey: number[];
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

// Skill model (mirrors the fat sim): work speed = 0.5 + skill×0.1 (skill 5 → 1.0×),
// skill grows 0.06/hr while working and is capped (literacy/academy bonuses are
// tech/building features not yet ported, so the cap is the bare base here).
export const STARTING_SKILL = 5;             // competent default → work-speed mult 1.0
const SKILL_GROWTH_PER_HOUR = 0.06;
const SKILL_CAP = 10;

/** Trait housing preference → compact enum (0 = none). */
const HOUSING_PREF: Readonly<Record<string, number>> = { private: 1, communal: 2, military: 3 };
export const enum Housing { None = 0, Private = 1, Communal = 2, Military = 3 }

// Medical model (Stage 4 behavior port) — mirrors the fat sim's wound→infection→
// scar chain (GDD §2.2). Values are pulled from TUNING so the two cores can't drift.
const WOUND_BLEED = TUNING.woundBleedPerHour;            // health/hr from an open wound
const WOUND_SELF_HEAL_HR = TUNING.woundSelfHealHours;    // an untended wound scars over after this
const INFECTION_WINDOW_HR = TUNING.infectionWindowHours; // when a wound may fester
const INFECTION_CHANCE = TUNING.infectionChance;         // probability it does
const INFECTION_BLEED = TUNING.infectionHealthPerHour;   // health/hr while infected
const SICK_BLEED = TUNING.sickHealthPerHour;             // health/hr while feverish
export const SICK_WORK_MULT = TUNING.sickWorkMult;       // work-speed factor while feverish
const HEALTH_REGEN = TUNING.healthRegenPerHour;          // baseline recovery
const STARVE_BLEED = 1.5;                                 // health/hr at 0 food (SoA baseline)
const FREEZE_BLEED = 1.0;                                 // health/hr at warmth ≤ 0 (prolonged exposure)

// Thoughts (Stage 4 behavior port) — transient mood modifiers with an expiry.
// The fat sim keeps a per-settler `Thought[]`; here each agent gets a fixed ring
// of slots (flat typed arrays, allocation-free) summed into the mood target. A
// non-zero `key` dedups/refreshes an ongoing thought; key 0 is a one-off that
// always takes a fresh slot (e.g. grief for a specific death).
export const THOUGHT_SLOTS = 6;
/** Stable keys for refreshable thoughts (0 = anonymous one-off). */
export const enum ThoughtKey { Anon = 0, Breakdown = 1 }

export class AgentStore {
  readonly capacity: number;
  count = 0;

  // --- SoA columns (one entry per live agent, indices 0..count-1) ---
  readonly id: Int32Array;
  /** Display name per agent, index-aligned (a string can't live in a typed array).
   *  Maintained through swap-remove exactly like the numeric columns. */
  readonly names: string[] = [];
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

  // --- traits + skills (Stage 4 behavior port) ---
  /** Craft skill 0..SKILL_CAP. Work speed = 0.5 + skill×0.1; grows while Working. */
  readonly skill: Float32Array;
  /** Two trait def indices (into TRAIT_DEFS), -1 = none. Identity + serialization only. */
  readonly trait0: Int8Array;
  readonly trait1: Int8Array;
  /** Weapon in hand for melee: 0 = bare, 1 = improvised spear, 2 = forged weapon.
   *  Drawn from the stores when a raid musters; adds a flat combat bonus (see raid.ts). */
  readonly armed: Uint8Array;
  // Collapsed trait effects — derived from trait0/trait1 once at spawn/load so the
  // hot tick reads a single multiplier instead of re-walking the trait list.
  readonly workSpeedMult: Float32Array;   // ∏ trait.workSpeed   (production speed)
  readonly moodBaseBonus: Float32Array;   // Σ trait.moodBase     (additive mood target)
  readonly warmthDecayMult: Float32Array; // ∏ trait.warmthDecay  (exposed cooling)
  readonly foodDecayMult: Float32Array;   // ∏ trait.foodDecay    (hunger rate)
  readonly housingPref: Int8Array;        // Housing enum (first trait pref wins)

  // --- medical (Stage 4 behavior port): wound → infection → scar + fever ---
  /** 1 = an open (bleeding) wound; cleared by treatment or by scarring over. */
  readonly woundUntreated: Uint8Array;
  /** tick the current wound was inflicted (drives self-heal + infection timing). */
  readonly woundAt: Float32Array;
  /** 1 once the wound's one-shot infection roll has happened (so it rolls once). */
  readonly infectionRolled: Uint8Array;
  /** 1 = a festering infection bleeding health until treated. */
  readonly infection: Uint8Array;
  /** tick until which the agent is feverish (sick); ≤ current tick = well. */
  readonly sickUntilTick: Float32Array;
  /** 1 while feverish — derived each tick, read by tickProduction for the work penalty. */
  readonly sick: Uint8Array;
  /** Health-regen multiplier for this tick — set by serveMedical (infirmary/medicine), else 1. */
  readonly healMult: Float32Array;

  // --- thoughts (Stage 4): bounded per-agent mood modifiers, THOUGHT_SLOTS each ---
  /** Mood delta of each thought slot (small ±). Slot is live iff expiry > current tick. */
  readonly thoughtDelta: Int8Array;
  /** Expiry tick of each slot (0 or ≤ now = free). */
  readonly thoughtExpiry: Float32Array;
  /** Dedup key of each slot (ThoughtKey; 0 = anonymous one-off). */
  readonly thoughtKey: Int16Array;

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
    this.skill = new Float32Array(capacity);
    this.trait0 = new Int8Array(capacity);
    this.trait1 = new Int8Array(capacity);
    this.armed = new Uint8Array(capacity);
    this.workSpeedMult = new Float32Array(capacity);
    this.moodBaseBonus = new Float32Array(capacity);
    this.warmthDecayMult = new Float32Array(capacity);
    this.foodDecayMult = new Float32Array(capacity);
    this.housingPref = new Int8Array(capacity);
    this.woundUntreated = new Uint8Array(capacity);
    this.woundAt = new Float32Array(capacity);
    this.infectionRolled = new Uint8Array(capacity);
    this.infection = new Uint8Array(capacity);
    this.sickUntilTick = new Float32Array(capacity);
    this.sick = new Uint8Array(capacity);
    this.healMult = new Float32Array(capacity).fill(1);
    this.thoughtDelta = new Int8Array(capacity * THOUGHT_SLOTS);
    this.thoughtExpiry = new Float32Array(capacity * THOUGHT_SLOTS);
    this.thoughtKey = new Int16Array(capacity * THOUGHT_SLOTS);
  }

  /**
   * Add a thought to agent `i`: a `delta` mood modifier living `durationTicks`
   * from `nowTick`. A non-zero `key` refreshes an existing thought of that key
   * (no stacking); key 0 always takes a free slot. When every slot is live, the
   * soonest-to-expire is evicted.
   */
  addThought(i: number, nowTick: number, delta: number, durationTicks: number, key = ThoughtKey.Anon): void {
    const base = i * THOUGHT_SLOTS;
    const expiry = nowTick + durationTicks;
    let free = -1;
    let soonest = -1;
    let soonestExp = Infinity;
    for (let j = 0; j < THOUGHT_SLOTS; j++) {
      const s = base + j;
      const exp = this.thoughtExpiry[s];
      if (key !== ThoughtKey.Anon && this.thoughtKey[s] === key && exp > nowTick) {
        this.thoughtDelta[s] = delta; this.thoughtExpiry[s] = expiry; // refresh in place
        return;
      }
      if (exp <= nowTick) { if (free < 0) free = s; }
      else if (exp < soonestExp) { soonestExp = exp; soonest = s; }
    }
    const slot = free >= 0 ? free : soonest;
    this.thoughtDelta[slot] = delta;
    this.thoughtExpiry[slot] = expiry;
    this.thoughtKey[slot] = key;
  }

  /** Sum of this agent's live thought deltas; clears expired slots in passing. */
  private sumThoughts(i: number, nowTick: number): number {
    const base = i * THOUGHT_SLOTS;
    let total = 0;
    for (let j = 0; j < THOUGHT_SLOTS; j++) {
      const s = base + j;
      if (this.thoughtExpiry[s] > nowTick) total += this.thoughtDelta[s];
      else if (this.thoughtExpiry[s] !== 0) { this.thoughtExpiry[s] = 0; this.thoughtKey[s] = 0; this.thoughtDelta[s] = 0; }
    }
    return total;
  }

  /** Inflict an open wound on agent `i` as of `tickNo` (combat/raids/wildlife/events). */
  inflictWound(i: number, tickNo: number): void {
    this.woundUntreated[i] = 1;
    this.woundAt[i] = tickNo;
    this.infectionRolled[i] = 0;
  }

  /** Make agent `i` feverish until `untilTick` (plague/sickness events). */
  makeSick(i: number, untilTick: number): void {
    if (untilTick > this.sickUntilTick[i]) this.sickUntilTick[i] = untilTick;
  }

  /** Clear an agent's wound + infection (what a medic / apothecary treatment delivers). */
  treat(i: number): void {
    this.woundUntreated[i] = 0;
    this.infection[i] = 0;
  }

  /** Recompute the collapsed trait-effect columns for agent `i` from trait0/trait1. */
  private applyTraits(i: number): void {
    let ws = 1, md = 0, wd = 1, fd = 1, hp = 0;
    const t0 = this.trait0[i], t1 = this.trait1[i];
    for (const t of [t0, t1]) {
      if (t < 0) continue;
      const def = TRAIT_DEFS[t];
      if (!def) continue;
      ws *= def.workSpeed ?? 1;
      md += def.moodBase ?? 0;
      wd *= def.warmthDecay ?? 1;
      fd *= def.foodDecay ?? 1;
      if (hp === 0 && def.housingPreference) hp = HOUSING_PREF[def.housingPreference] ?? 0;
    }
    this.workSpeedMult[i] = ws;
    this.moodBaseBonus[i] = md;
    this.warmthDecayMult[i] = wd;
    this.foodDecayMult[i] = fd;
    this.housingPref[i] = hp;
  }

  /**
   * Roll two distinct traits onto agent `i` (mirrors the fat sim's birth roll) and
   * collapse their effects. `rand` is the external sim RNG so the store stays
   * deterministic and side-effect-free.
   */
  rollTraits(i: number, rand: () => number): void {
    const n = TRAIT_DEFS.length;
    const a = Math.floor(rand() * n);
    let b = Math.floor(rand() * n);
    // Reroll to a distinct trait. Bounded so a degenerate rand (e.g. constant
    // 0.5) can't spin forever; the real mulberry32 stream resolves in one or two
    // tries, so this leaves normal-seed behaviour (and draw count) unchanged.
    for (let guard = 0; b === a && guard < 8; guard++) b = Math.floor(rand() * n);
    if (b === a) b = (a + 1) % n; // degenerate-rand fallback
    this.trait0[i] = a;
    this.trait1[i] = b;
    this.applyTraits(i);
  }

  /** Add an agent; returns its index, or -1 if full. */
  spawn(x: number, y: number): number {
    if (this.count >= this.capacity) return -1;
    const i = this.count++;
    this.id[i] = this.nextId++;
    this.names[i] = nameForId(this.id[i]);
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
    // Default persona: competent (skill 5 → work-speed mult 1.0) and untraited.
    // Callers roll real traits/skill via rollTraits()/skill[i] = …; the neutral
    // default keeps spawn deterministic and leaves production identical to a plain
    // worker count until a persona is assigned.
    this.skill[i] = STARTING_SKILL;
    this.trait0[i] = -1;
    this.trait1[i] = -1;
    this.armed[i] = 0; // unarmed until a raid muster hands out spears/weapons
    this.workSpeedMult[i] = 1;
    this.moodBaseBonus[i] = 0;
    this.warmthDecayMult[i] = 1;
    this.foodDecayMult[i] = 1;
    this.housingPref[i] = 0;
    // Healthy and unhurt on arrival.
    this.woundUntreated[i] = 0;
    this.woundAt[i] = 0;
    this.infectionRolled[i] = 0;
    this.infection[i] = 0;
    this.sickUntilTick[i] = 0;
    this.sick[i] = 0;
    this.healMult[i] = 1;
    // No thoughts on arrival.
    const tb = i * THOUGHT_SLOTS;
    for (let j = 0; j < THOUGHT_SLOTS; j++) { this.thoughtDelta[tb + j] = 0; this.thoughtExpiry[tb + j] = 0; this.thoughtKey[tb + j] = 0; }
    // Stagger first decision so a cohort spawned together doesn't think in lockstep.
    this.nextThink[i] = i % THINK_INTERVAL;
    return i;
  }

  /** Swap-remove: O(1) by moving the last agent into the gap. Invalidates index `i`. */
  remove(i: number): void {
    const last = --this.count;
    if (i !== last) {
      this.id[i] = this.id[last];
      this.names[i] = this.names[last];
      this.posX[i] = this.posX[last]; this.posY[i] = this.posY[last];
      this.destX[i] = this.destX[last]; this.destY[i] = this.destY[last];
      this.health[i] = this.health[last]; this.mood[i] = this.mood[last];
      this.food[i] = this.food[last]; this.rest[i] = this.rest[last];
      this.warmth[i] = this.warmth[last]; this.recreation[i] = this.recreation[last];
      this.social[i] = this.social[last]; this.state[i] = this.state[last];
      this.nextThink[i] = this.nextThink[last];
      this.field[i] = this.field[last];
      this.stationId[i] = this.stationId[last];
      this.skill[i] = this.skill[last];
      this.trait0[i] = this.trait0[last]; this.trait1[i] = this.trait1[last];
      this.armed[i] = this.armed[last];
      this.workSpeedMult[i] = this.workSpeedMult[last];
      this.moodBaseBonus[i] = this.moodBaseBonus[last];
      this.warmthDecayMult[i] = this.warmthDecayMult[last];
      this.foodDecayMult[i] = this.foodDecayMult[last];
      this.housingPref[i] = this.housingPref[last];
      this.woundUntreated[i] = this.woundUntreated[last];
      this.woundAt[i] = this.woundAt[last];
      this.infectionRolled[i] = this.infectionRolled[last];
      this.infection[i] = this.infection[last];
      this.sickUntilTick[i] = this.sickUntilTick[last];
      this.sick[i] = this.sick[last];
      this.healMult[i] = this.healMult[last];
      const db = i * THOUGHT_SLOTS, sb = last * THOUGHT_SLOTS;
      for (let j = 0; j < THOUGHT_SLOTS; j++) {
        this.thoughtDelta[db + j] = this.thoughtDelta[sb + j];
        this.thoughtExpiry[db + j] = this.thoughtExpiry[sb + j];
        this.thoughtKey[db + j] = this.thoughtKey[sb + j];
      }
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

  /** Display name of agent `i` (empty string if out of range). */
  name(i: number): string {
    return i >= 0 && i < this.count ? this.names[i] : '';
  }

  // --- serialization (round-trips the SoA columns; flow fields are re-registered
  //     by the caller, never persisted) ---

  serialize(): AgentStoreSave {
    const n = this.count;
    const slice = (a: ArrayLike<number>) => Array.from({ length: n }, (_, i) => a[i]);
    const sliceN = (a: ArrayLike<number>, len: number) => Array.from({ length: len }, (_, i) => a[i]);
    // destX/destY use NaN as the "no destination" sentinel; NaN is not JSON-safe
    // (it stringifies to null and reloads as 0), so persist it explicitly as null.
    const sliceDest = (a: ArrayLike<number>) =>
      Array.from({ length: n }, (_, i) => (Number.isNaN(a[i]) ? null : a[i]));
    return {
      capacity: this.capacity,
      count: n,
      nextId: this.nextId,
      id: slice(this.id),
      names: this.names.slice(0, n),
      posX: slice(this.posX), posY: slice(this.posY),
      destX: sliceDest(this.destX), destY: sliceDest(this.destY),
      health: slice(this.health), mood: slice(this.mood),
      food: slice(this.food), rest: slice(this.rest), warmth: slice(this.warmth),
      recreation: slice(this.recreation), social: slice(this.social),
      state: slice(this.state), nextThink: slice(this.nextThink),
      field: slice(this.field), stationId: slice(this.stationId),
      // Persist skill + the two trait indices; the collapsed multiplier columns are
      // a pure function of the traits, so they're re-derived on load (smaller save,
      // and no chance of mults drifting out of sync with the traits).
      skill: slice(this.skill), trait0: slice(this.trait0), trait1: slice(this.trait1),
      armed: slice(this.armed),
      // Medical state (sick/healMult are transient — recomputed every tick).
      woundUntreated: slice(this.woundUntreated), woundAt: slice(this.woundAt),
      infectionRolled: slice(this.infectionRolled), infection: slice(this.infection),
      sickUntilTick: slice(this.sickUntilTick),
      // Thought slots (count × THOUGHT_SLOTS, row-major) — drive the mood target.
      thoughtDelta: sliceN(this.thoughtDelta, n * THOUGHT_SLOTS),
      thoughtExpiry: sliceN(this.thoughtExpiry, n * THOUGHT_SLOTS),
      thoughtKey: sliceN(this.thoughtKey, n * THOUGHT_SLOTS),
    };
  }

  static deserialize(data: AgentStoreSave): AgentStore {
    const store = new AgentStore(data.capacity);
    const n = data.count;
    store.count = n;
    store.nextId = data.nextId;
    for (let i = 0; i < n; i++) {
      store.id[i] = data.id[i];
      store.names[i] = data.names?.[i] ?? nameForId(data.id[i]); // pre-name saves derive from id
      store.posX[i] = data.posX[i]; store.posY[i] = data.posY[i];
      store.destX[i] = data.destX[i] ?? NaN; store.destY[i] = data.destY[i] ?? NaN;
      store.health[i] = data.health[i]; store.mood[i] = data.mood[i];
      store.food[i] = data.food[i]; store.rest[i] = data.rest[i]; store.warmth[i] = data.warmth[i];
      store.recreation[i] = data.recreation[i]; store.social[i] = data.social[i];
      store.state[i] = data.state[i]; store.nextThink[i] = data.nextThink[i];
      store.field[i] = data.field[i]; store.stationId[i] = data.stationId[i];
      // Backfill persona for pre-Stage-4 saves: competent + untraited.
      store.skill[i] = data.skill?.[i] ?? STARTING_SKILL;
      store.trait0[i] = data.trait0?.[i] ?? -1;
      store.trait1[i] = data.trait1?.[i] ?? -1;
      store.armed[i] = data.armed?.[i] ?? 0; // pre-armament saves → bare-handed
      store.applyTraits(i); // re-derive the collapsed multiplier columns
      // Medical state — pre-medical saves backfill to healthy/unhurt.
      store.woundUntreated[i] = data.woundUntreated?.[i] ?? 0;
      store.woundAt[i] = data.woundAt?.[i] ?? 0;
      store.infectionRolled[i] = data.infectionRolled?.[i] ?? 0;
      store.infection[i] = data.infection?.[i] ?? 0;
      store.sickUntilTick[i] = data.sickUntilTick?.[i] ?? 0;
      store.sick[i] = 0;
      store.healMult[i] = 1;
      // Thought slots (row-major, THOUGHT_SLOTS per agent). Absent in old saves → empty.
      const tb = i * THOUGHT_SLOTS;
      for (let j = 0; j < THOUGHT_SLOTS; j++) {
        store.thoughtDelta[tb + j] = data.thoughtDelta?.[tb + j] ?? 0;
        store.thoughtExpiry[tb + j] = data.thoughtExpiry?.[tb + j] ?? 0;
        store.thoughtKey[tb + j] = data.thoughtKey?.[tb + j] ?? 0;
      }
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
      const f = this.food[i] - DECAY_FOOD * HOURS_PER_TICK * this.foodDecayMult[i];
      this.food[i] = f > 0 ? f : 0;
      if (this.state[i] !== AState.Sleeping) {
        const r = this.rest[i] - DECAY_REST * HOURS_PER_TICK;
        this.rest[i] = r > 0 ? r : 0;
      }
      const rc = this.recreation[i] - DECAY_REC * HOURS_PER_TICK;
      this.recreation[i] = rc > 0 ? rc : 0;
      const so = this.social[i] - DECAY_SOCIAL * HOURS_PER_TICK;
      this.social[i] = so > 0 ? so : 0;

      // --- health: wounds → infection → scar, fever, starvation, then gated regen ---
      let bleed = 0;
      if (this.woundUntreated[i] === 1) {
        bleed += WOUND_BLEED;
        const elapsedHr = (tickNo - this.woundAt[i]) * HOURS_PER_TICK;
        if (elapsedHr > WOUND_SELF_HEAL_HR) {
          this.woundUntreated[i] = 0; // scarred over on its own
        } else if (this.infectionRolled[i] === 0 && elapsedHr > INFECTION_WINDOW_HR) {
          this.infectionRolled[i] = 1; // one-shot fester roll
          if (rand() < INFECTION_CHANCE) this.infection[i] = 1;
        }
      }
      if (this.infection[i] === 1) bleed += INFECTION_BLEED;
      const feverish = this.sickUntilTick[i] > tickNo;
      this.sick[i] = feverish ? 1 : 0; // tickProduction reads this for the work penalty
      if (feverish) bleed += SICK_BLEED;
      if (this.food[i] <= 0) bleed += STARVE_BLEED;
      if (this.warmth[i] <= 0) bleed += FREEZE_BLEED;

      if (bleed > 0) {
        this.health[i] -= bleed * HOURS_PER_TICK;
      } else if (this.food[i] > 30 && this.health[i] < 100) {
        // Recover — faster in an infirmary / with medicine (healMult set by serveMedical).
        const h = this.health[i] + HEALTH_REGEN * this.healMult[i] * HOURS_PER_TICK;
        this.health[i] = h < 100 ? h : 100;
      }

      // --- mood: ease toward the weighted-need target + trait base, clamped 0..100
      //     (matches the fat sim's clamped 0.05 lerp). ---
      let target = this.food[i] * 0.3 + this.rest[i] * 0.25 + this.warmth[i] * 0.2
        + this.recreation[i] * 0.15 + this.social[i] * 0.1 + this.moodBaseBonus[i]
        + this.sumThoughts(i, tickNo);
      target = target < 0 ? 0 : target > 100 ? 100 : target;
      this.mood[i] += (target - this.mood[i]) * 0.05;

      // --- skill: a Working agent gets better at the craft, capped. ---
      if (this.state[i] === AState.Working && this.skill[i] < SKILL_CAP) {
        const sk = this.skill[i] + SKILL_GROWTH_PER_HOUR * HOURS_PER_TICK;
        this.skill[i] = sk < SKILL_CAP ? sk : SKILL_CAP;
      }

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
          // The field index can dangle if the owner cleared `fields` (e.g. no open
          // jobs this tick) while we were mid-move — treat a missing field as "arrived".
          const field = this.fields[fi];
          const tx = Math.floor(this.posX[i]);
          const ty = Math.floor(this.posY[i]);
          if (field && field.dirAt(tx, ty, this._dir)) {
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

  // Stage 4: traits collapse into multiplier columns; skill grows while Working.
  const s3 = new AgentStore(4);
  const p = s3.spawn(0, 0);
  console.assert(s3.skill[p] === 10 - 5 && s3.workSpeedMult[p] === 1, 'neutral default persona');
  s3.rollTraits(p, rand);
  console.assert(s3.trait0[p] >= 0 && s3.trait1[p] >= 0 && s3.trait0[p] !== s3.trait1[p],
    'two distinct traits rolled');
  s3.state[p] = AState.Working;
  const skill0 = s3.skill[p];
  for (let t = 0; t < 50; t++) s3.tick(t, rand);
  console.assert(s3.skill[p] > skill0, 'skill grew while working');

  // Stage 4 medical: an open wound bleeds health and may fester past the window.
  const s4 = new AgentStore(4);
  const w = s4.spawn(0, 0);
  s4.inflictWound(w, 0);
  const h0 = s4.health[w];
  for (let t = 0; t < 250; t++) s4.tick(t, rand); // ~16h of game time
  console.assert(s4.health[w] < h0, 'an untreated wound bled health');
  s4.treat(w);
  console.assert(s4.woundUntreated[w] === 0 && s4.infection[w] === 0, 'treatment cleared wound + infection');
  // Persona survives a serialize round-trip (mults re-derived from trait indices).
  const s3r = AgentStore.deserialize(s3.serialize());
  console.assert(s3r.trait0[0] === s3.trait0[p] && s3r.workSpeedMult[0] === s3.workSpeedMult[p],
    'traits + derived mults round-trip');

  console.log('agents.ts self-check OK — count', s.count, 'food', s.food[0].toFixed(1),
    '— flow-field arrival', `(${s2.posX[a].toFixed(1)},${s2.posY[a].toFixed(1)})`,
    '— skill', s3.skill[p].toFixed(2));
}
