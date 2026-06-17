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
import { BuildGrid, ZONE, ZONE_DEFS, FORAGE, TERRAIN, type BuildGridSave } from './build';
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
import { RegionMap, REGION_N, type TownSite } from './worldgen';
import { ResearchBook, type ResearchBookSave } from './research';
import { Rng } from './rng';
import { BASE_PRICES } from './economy';
import { MINUTES_PER_TICK, MINUTES_PER_DAY, NEED_INTERRUPT_THRESHOLD, ROOM_TYPE_ID, ROOM_DEF_BY_NUM, STATION_DEF_BY_NUM, STATION_TYPE_ID, TRAIT_DEFS, TUNING, DAYS_PER_SEASON, DAYS_PER_YEAR, SEASONS, START_YEAR, DIFFICULTY_PRESETS, RESOURCE_KINDS, BLUEPRINT_DEFS, parcelCost, type BlueprintDef, type ResourceKind, type TradeOrder, type TradeRecord, type TownFocus } from './defs';

const TICKS_PER_DAY = MINUTES_PER_DAY / MINUTES_PER_TICK;
// Seamless-world M3: daily tribute from each owned parcel beyond the capital.
const HOLDING_TITHE = 2; // gold per holding per day
const HOLDING_YIELD: Record<string, { res: ResourceKind; amt: number }> = {
  plains: { res: 'grain', amt: 3 },
  forest: { res: 'wood', amt: 3 },
  hills: { res: 'stone', amt: 2 },
  mountains: { res: 'stone', amt: 1.5 },
  marsh: { res: 'herbs', amt: 1 },
  river: { res: 'meal', amt: 2 }, // riverside fishing
};
// Colony storage cap (SoS model): non-food goods the colony can warehouse before
// overflow spoils. Base + per-head scaling + built shelves/crates (storageCap()).
const STORAGE_BASE = 1200, STORAGE_PER_POP = 150;
// Religion: each temple shrine holds services for this many settlers, lifting
// their mood by FAITH_MOOD_BONUS while a shrine is built.
const FAITH_PER_SHRINE = 12, FAITH_MOOD_BONUS = 4;
// Foods are exempt — they ride their own freshness/larder cap, so the storage
// limit can never starve the colony.
const FOOD_KINDS: ReadonlySet<ResourceKind> = new Set<ResourceKind>([
  'meal', 'grain', 'bread', 'ale', 'dairy', 'produce', 'game_meal', 'fish_meal', 'preserved', 'flour',
]);
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
// Random events: fire every 3–7 days starting on day FIRST_EVENT_DAY.
const FIRST_EVENT_DAY = 7;
const EVENT_INTERVAL = [3, 7] as const;

const SAVE_VERSION = 11;

// Behavior thresholds for the integration loop (modest, deterministic — full
// mood/skills/trait fidelity is the remaining parity work, not this stage).
const REST_SLEEP_BELOW = 30;   // rest under this → go to sleep, releasing any job
const REST_WAKE_AT = 95;       // rest at/over this → wake up and look for work
const BIRTH_MOOD_MIN = 50;     // colony must be reasonably content to grow
const STARVED_HEALTH = 0;      // health at/under this → death (swap-removed)
const HARVEST_TILES_PER_WORKER = 4; // zone tiles one settler can work per day (labour cap)
const HARVEST_YIELD = 1;            // raw goods a worked zone tile yields per day
const FORAGE_REGROW_DAYS = 30;      // days before a harvested forage deposit regenerates
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

/** A player-facing choice presented by a random event. Set on `TownCore.pendingChoice`
 *  when an event needs input; cleared by `resolveEventChoice(index)`. */
export interface PendingEventChoice {
  id: string;
  title: string;
  text: string;
  choices: { label: string; desc: string }[];
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
  /** Craft progress [0..recipe.work). 0 for non-craft stations. */
  progress: number;
  /** Max work for one craft cycle (recipe.work). 0 for non-craft stations. */
  workMax: number;
}

/** A displayable snapshot of one active raider — position, health, and flee state. */
export interface RaiderView {
  x: number;
  y: number;
  health: number;
  fleeing: boolean;
}

/** A live deer on the map — position + health tracked for hunting. */
export interface Deer {
  id: number;
  x: number;
  y: number;
  health: number;
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

export interface YearReport {
  year: number;
  popStart: number;
  popEnd: number;
  inflow: Partial<Record<ResourceKind, number>>;
  outflow: Partial<Record<ResourceKind, number>>;
}

export interface TownCoreSave {
  v: number;
  tickNo: number;
  minute: number;
  day: number;
  rngState: number;
  weatherSeed: number;
  gold: number;
  /** Seamless-world parcels held (cell "x,y" keys); absent on pre-M2 saves. */
  owned?: string[];
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
  /** v8+: next scheduled random-event day (old saves restart the timer from scratch). */
  nextEventDay?: number;
  /** v8+: last logged season index — prevents duplicate season-change log lines on load. */
  lastSeasonIdx?: number;
  /** v8+: number of dead settlers not yet interred (defaults to 0 on old saves). */
  unburiedCount?: number;
  /** v8+: any pending player-choice event (null/missing = no pending choice). */
  pendingChoice?: PendingEventChoice | null;
  /** v8+: colony prestige score (0 on old saves). */
  prestige?: number;
  /** v8+: game era 1–4 (defaults to 1 on old saves). */
  era?: 1 | 2 | 3 | 4;
  /** v8+: standing trade orders (empty on old saves). */
  tradeOrders?: TradeOrder[];
  /** v8+: trade execution history (empty on old saves). */
  tradeHistory?: TradeRecord[];
  /** v8+: next auto-increment id for trade orders. */
  nextOrderId?: number;
  /** v8+: colony display name (defaults to 'New Settlement' on old saves). */
  townName?: string;
  /** v8+: strategic focus (defaults to 'balanced' on old saves). */
  focus?: TownFocus;
  /** v8+: selected difficulty (defaults to 'normal' on old saves). */
  difficulty?: 'easy' | 'normal' | 'hard';
  /** v9+: current deer herd (empty on old saves). */
  deer?: Deer[];
  /** v9+: next deer id counter. */
  deerNextId?: number;
  /** v9+: deer-stream rng state (fresh on old saves). */
  deerRngState?: number;
  /** v9+: day the next clothes check falls due (prevents double-consumption on load). */
  clothingDay?: number;
  /** v9+: day festivals can fire again (prevents repeat festivals on load). */
  festivalCooldown?: number;
  /** v9+: last population milestone already logged (prevents milestone spam on load). */
  lastPopMilestone?: number;
  /** v9+: rolling stock-level history for net-flow display (empty on old saves). */
  stockHistory?: Record<string, number[]>;
  /** v9+: drought/flood active state (prevents duplicate transition logs on load). */
  droughtActive?: boolean;
  floodActive?: boolean;
  /** v10+: last prestige tier already logged (prevents duplicate tier logs on load). */
  lastPrestigeMilestone?: number;
  /** v11+: last completed year's resource ledger (null on old saves). */
  lastYearReport?: YearReport | null;
}

export interface TownCoreOpts {
  width?: number;
  height?: number;
  capacity?: number;
  seed?: number;
  /** Generate natural terrain (forests/water/rock/ore) into the grid at construction.
   *  Off by default so the all-grass core stays byte-identical for existing tests;
   *  the live swap (B-6 PART 3) turns this on. `'heightmap'` uses the
   *  Songs-of-Syx-style heightmap generator (coherent seas/continents/ranges). */
  terrain?: boolean | 'heightmap';
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
  /** Deer herd: roam the map, flee settlers, and can be hunted from an outpost. */
  deer: Deer[] = [];
  private _deerNextId = 1;
  /** Separate RNG stream for deer so their wander/spawn calls never disturb the
   *  main rng sequence (raids, births, weather). Serialized independently. */
  private _deerRng: Rng;
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
  /** Station-type speed multiplier from unlocked production techs + focus bonus. */
  private readonly _stationSpeedMult = (stationId: string): number => {
    const rb = this.researchBook;
    // Industrial focus and the Mechanization capstone speed every station; both
    // compose with the per-craft tech bonus below.
    const focusMult = (this.focus === 'industrial' ? 1.20 : 1.0) * (rb.hasTech('mechanization') ? 1.15 : 1);
    switch (stationId) {
      case 'loom': case 'rope_walk': return (rb.hasTech('textile_farming') ? 1.25 : 1) * focusMult;
      case 'herb_table': return (rb.hasTech('herbalism') ? 1.30 : 1) * focusMult;
      case 'saw_bench': case 'carpentry_bench': return (rb.hasTech('carpentry') ? 1.25 : 1) * focusMult;
      case 'anvil': case 'weapon_bench': return (rb.hasTech('blacksmithing') ? 1.25 : 1) * focusMult;
      case 'millstone': return (rb.hasTech('milling') ? 1.30 : 1) * focusMult;
      case 'oven': case 'baking_oven': return (rb.hasTech('baking') ? 1.25 : 1) * focusMult;
      case 'kiln': case 'coke_oven': return (rb.hasTech('ceramics') ? 1.25 : 1) * focusMult;
      case 'brew_vat': return (rb.hasTech('fermentation') ? 1.30 : 1) * focusMult;
      case 'smelter': return (rb.hasTech('iron_smelting') ? 1.30 : 1) * focusMult;
      case 'smoke_rack': return (rb.hasTech('food_preservation') ? 1.40 : 1) * focusMult;
      case 'animal_pen': return (rb.hasTech('animal_husbandry') ? 1.30 : 1) * focusMult;
      default: return focusMult;
    }
  };

  tickNo = 0;
  minute = 0;
  day = 0;
  deaths = 0;
  births = 0;
  /** Number of dead settlers not yet interred; drives a daily mood penalty when positive. */
  unburiedCount = 0;
  gold = 0;
  /** Colony prestige score — increments by 1 each time a tech is researched. */
  prestige = 0;
  /** Current game era (1–4). Era 1→2 unlocks when iron_smelting + blacksmithing are
   *  researched and sufficient tools + iron bars are stockpiled (GDD §3.1). */
  era: 1 | 2 | 3 | 4 = 1;
  /** Display name of the colony (cosmetic, surfaced to the HUD and region map). */
  townName = 'New Settlement';
  /**
   * Colony strategic focus — biases harvests, crafting, trading, or mood.
   *   agricultural: +25% field yield
   *   industrial:   +20% station speed across all crafting
   *   trade:        sell for 10% more, buy for 10% less (price mod on each trade)
   *   military:     raid interval +30% (raids rescheduled later)
   *   cultural:     recreation and mood bonuses regenerate 25% faster
   *   balanced:     no bonus (default)
   */
  focus: TownFocus = 'balanced';
  /** Selected difficulty (easy/normal/hard); scales starting stocks and gold. */
  difficulty: 'easy' | 'normal' | 'hard' = 'normal';
  /** Market price modifiers: track supply/demand shifts (recover daily toward 1.0). */
  priceModifiers = new Map<string, number>();
  /** Standing trade orders: auto-executed daily (sell surplus / buy when low). */
  tradeOrders: TradeOrder[] = [];
  /** Rolling history of completed trades (capped at 100 entries). */
  tradeHistory: TradeRecord[] = [];
  /** Auto-increment counter for trade order IDs. */
  private _nextOrderId = 1;
  /** Rolling 8-snapshot (7-delta) daily stock history for net-flow display. */
  private _stockHistory = new Map<string, number[]>();
  /** Colony anchor — where newcomers appear and the camera first looks. */
  homeX: number;
  homeY: number;
  /** Day the next random event fires. */
  nextEventDay: number = FIRST_EVENT_DAY;
  /** If set, the current event waiting for a player choice. Cleared by resolveEventChoice(). */
  pendingChoice: PendingEventChoice | null = null;
  /** Day the festival can fire again (prevents back-to-back celebrations). */
  private _festivalCooldown = 0;
  /** Tracks current drought state to log transitions (drought start/end). */
  private _droughtActive = false;
  /** Tracks flood-risk state to log transitions. */
  private _floodActive = false;
  /** Last logged season index, to detect season changes. */
  private _lastSeasonIdx = -1;
  /** Last logged population milestone (10, 25, 50, 100…). */
  private _lastPopMilestone = 0;
  /** Last logged prestige tier (25, 50, 100, 200). */
  private _lastPrestigeMilestone = 0;
  /** Rolling 7-day food-type log for variety mood effects. */
  private _foodVarietyLog: string[] = [];
  /** Whether all settlers are currently clothed (set daily by clothing distribution). */
  private _settlersClothed = false;
  /** Game-day the current round of clothes wears out and the next batch is due. */
  private _clothingDay = 0;
  /** True when at least one well station is operational — cached daily to avoid per-tick room scan. */
  private _hasWell = false;

  // Yearly resource ledger: accumulate gross inflow / outflow since year start.
  private _yearIn = new Float32Array(RESOURCE_KINDS.length);
  private _yearOut = new Float32Array(RESOURCE_KINDS.length);
  private _yearStartPop = 0;
  /** End-of-previous-day stock snapshot, for computing daily deltas. */
  private _prevDayStock = new Float32Array(RESOURCE_KINDS.length);
  /** Last completed year's resource + population summary. Shown in the economy panel. */
  lastYearReport: YearReport | null = null;

  private readonly weatherSeed: number;

  // Region context for the seamless world view — the wider map this colony sits
  // in. Lazy + derived from the seed (deterministic), so it costs nothing until
  // the world view is opened and needs no save fields (re-derived on load).
  private _regionMap: RegionMap | null = null;
  private _site: TownSite | null = null;
  /** The 128×128 region this colony occupies one cell of. */
  get regionMap(): RegionMap { return this._regionMap ??= new RegionMap(this.weatherSeed); }
  /** This colony's cell within the region (cellX/cellY + biome/site detail). */
  get site(): TownSite { return this._site ??= this.regionMap.startSite(); }

  // Seamless world (M2) — region cells this colony holds title to. Seeded with
  // the home cell on first access; buying a neighbour adds it. Persisted so a
  // realm's borders survive save/load (re-derived home cell backfills old saves).
  private _owned: Set<string> | null = null;
  get ownedCells(): Set<string> {
    if (!this._owned) this._owned = new Set([`${this.site.cellX},${this.site.cellY}`]);
    return this._owned;
  }
  ownsParcel(cx: number, cy: number): boolean { return this.ownedCells.has(`${cx},${cy}`); }
  /** Gold price to acquire a cell at current holdings (no road discount at town tier). */
  parcelPrice(cx: number, cy: number): number {
    return parcelCost({ cellX: cx, cellY: cy, homeCellX: this.site.cellX, homeCellY: this.site.cellY,
      biome: this.regionMap.at(cx, cy).biome, ownedCount: this.ownedCells.size });
  }
  /** Buyable = in-region, land, unowned, orthogonally adjacent to a holding, affordable. */
  canBuyParcel(cx: number, cy: number): boolean {
    if (cx < 0 || cy < 0 || cx >= REGION_N || cy >= REGION_N) return false;
    if (this.ownsParcel(cx, cy) || this.regionMap.isWater(cx, cy)) return false;
    const adj = this.ownsParcel(cx + 1, cy) || this.ownsParcel(cx - 1, cy)
             || this.ownsParcel(cx, cy + 1) || this.ownsParcel(cx, cy - 1);
    return adj && this.gold >= this.parcelPrice(cx, cy);
  }
  /** Acquire a cell: deduct gold and take title. Returns true on success. */
  buyParcel(cx: number, cy: number): boolean {
    if (!this.canBuyParcel(cx, cy)) return false;
    this.gold -= this.parcelPrice(cx, cy);
    this.ownedCells.add(`${cx},${cy}`);
    return true;
  }
  /** Multiplier on holdings tribute — Provincial Roads tech raises it 50%. */
  private holdingsMult(): number { return this.researchBook.hasTech('provincial_roads') ? 1.5 : 1; }
  /** Gold tribute each owned parcel (beyond the capital) sends per day. */
  holdingsIncome(): number {
    return this._owned ? Math.round(Math.max(0, this._owned.size - 1) * HOLDING_TITHE * this.holdingsMult()) : 0;
  }
  /** Daily tribute from off-screen holdings — biome staple + gold. */
  private tickHoldings(): void {
    if (!this._owned || this._owned.size <= 1) return;
    const mult = this.holdingsMult();
    const homeKey = `${this.site.cellX},${this.site.cellY}`;
    for (const key of this._owned) {
      if (key === homeKey) continue;
      const [cx, cy] = key.split(',').map(Number);
      const y = HOLDING_YIELD[this.regionMap.at(cx, cy).biome];
      if (y) this.stock.add(y.res, y.amt * mult);
      this.gold += HOLDING_TITHE * mult;
    }
  }

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
    // Deer use a dedicated stream (seed derived, never overlapping) so their
    // wander/spawn calls leave the main rng (raids, births, weather) unchanged.
    this._deerRng = new Rng((seed ^ 0xd33f_cafe) >>> 0);
    this.homeX = Math.floor(width / 2);
    this.homeY = Math.floor(height / 2);
    this.nextRaidDay = TUNING.firstRaidDay + this.rng.int(5);
    // Terrain is painted from a dedicated stream so the main rng (weather, raids,
    // births) is byte-for-byte identical whether or not terrain is generated.
    if (opts.terrain === 'heightmap') this.grid.generateTerrainHeightmap(new Rng((seed ^ 0x9e3779b1) >>> 0));
    else if (opts.terrain) this.grid.generateTerrain(new Rng((seed ^ 0x9e3779b1) >>> 0));
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
      const progress = this.grid.progressFor(s.id);
      const workMax = def.recipe?.work ?? 0;
      yield { x: s.x, y: s.y, typeId: s.typeId, stationId: def.id, progress, workMax };
    }
  }

  /** Iterate all active raiders as `RaiderView` objects. */
  *raiders(): Generator<RaiderView, void, unknown> {
    for (const r of this.raids.raiders) {
      yield { x: r.x, y: r.y, health: r.health, fleeing: r.fleeing };
    }
  }

  /** Iterate all live deer on the map (for renderer overlay). */
  *deerViews(): Generator<{ x: number; y: number; health: number }, void, unknown> {
    for (const d of this.deer) yield { x: d.x, y: d.y, health: d.health };
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

  /** Spawn `n` founding settlers clustered around (cx, cy). Returns the count placed.
   *  Also spawns the starting deer herd (deerStartCount deer scattered across the map). */
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
    this._yearStartPop = this.population;
    // Spawn the starting deer herd via the dedicated deer rng stream so the main
    // rng (raids, births, weather) stays byte-for-byte identical regardless of deer count.
    const W = this.grid.width, H = this.grid.height;
    for (let i = 0; i < TUNING.deerStartCount; i++) {
      this.deer.push({
        id: this._deerNextId++,
        x: 2 + this._deerRng.int(W - 4),
        y: 2 + this._deerRng.int(H - 4),
        health: TUNING.deerHealth,
      });
    }
    return placed;
  }

  /**
   * Convenience start-up: apply difficulty scaling to a batch of founding supplies,
   * seed the treasury, and place the colony at (cx, cy). Mirrors fat-sim's
   * `applyTownDesign` + `foundColony`. Call after the grid is set up.
   *
   * Base supplies (scaled by difficulty multiplier):
   *   100 grain, 50 wood, 20 meal — typical starter wagon cargo.
   * Gold comes from the difficulty preset's `startCash`.
   *
   * Returns the number of settlers placed.
   */
  startColony(cx: number, cy: number, pop: number, d: 'easy' | 'normal' | 'hard' = 'normal', foc: TownFocus = 'balanced'): number {
    this.difficulty = d;
    this.focus = foc;
    const preset = DIFFICULTY_PRESETS[d];
    this.stock.add('grain', Math.round(100 * preset.stockMult));
    this.stock.add('wood', Math.round(50 * preset.stockMult));
    this.stock.add('meal', Math.round(20 * preset.stockMult));
    this.gold = preset.startCash;
    return this.seedColony(cx, cy, pop);
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
    this.grid.tickProduction(a, this.stock, MINUTES_PER_TICK, this._stationSpeedMult);

    // 4. Needs from rooms: warmth (enclosure), rest (beds), recreation (tables),
    //    and medical recovery (infirmary sickbeds + apothecary medicine).
    const dayWeather = this.weather.forDay(this.day);
    serveNeeds(this.grid, a, MINUTES_PER_TICK, dayWeather.tempAnomalyC, true /* colony-wide beds/tables */, this._settlersClothed ? 0.5 : 1.0);
    serveMedical(this.grid, a, this.stock, this.researchBook.hasTech('germ_theory') ? 1.5 : 1.0);

    // 4b. Bonding: agents sharing a tavern grow their mutual opinion.
    socialize(this.grid, a, this.relations, MINUTES_PER_TICK);

    // 5. Agent tick: needs decay, mood ease (incl. thoughts), health, movement.
    // infectionChanceMult stacks: first_aid × germ_theory × well (each reduces independently).
    const infectionChanceMult = (this.researchBook.hasTech('first_aid') ? 0.6 : 1.0)
      * (this._hasWell ? (1 - TUNING.wellInfectionReduction) : 1.0);
    a.tick(t, this._rand,
      infectionChanceMult,
      this.researchBook.hasTech('germ_theory') ? 0.5 : 1.0,
      this.grid.road, this.grid.width);

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
    // Barracks training posts add 10% per drill slot (capped at 30% additional bonus).
    const drillBonus = Math.min(0.3, aggregateCapacities(this.grid).drill * 0.1);
    const militiaMult = (this.researchBook.hasTech('militia_training') ? 1.3 : 1.0) * (1 + drillBonus);
    if (this.day >= this.nextRaidDay && !this.raids.active) {
      this.musterRaid();
    }
    if (this.raids.active) {
      // The horn rallies the colony: nobody sleeps through a raid.
      for (let i = 0; i < a.count; i++) if (a.state[i] === AState.Sleeping) a.state[i] = AState.Idle;
      const fortified = this.researchBook.hasTech('fortification');
      this.raids.tick(this.grid, a, t, militiaMult, fortified ? 1.5 : 1.0, fortified ? 0.8 : 1.0);
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

    // 5e. Deer: hunters at a lodge damage nearby deer; all deer roam/flee settlers.
    this._tickHunting();
    this._tickDeer();

    // A repelled raid / a pack that has slunk off: log the all-clear once.
    if (wasRaiding && !this.raids.active) {
      this.addLog('The raiders break and flee. The colony holds.', 'good');
      this.prestige += TUNING.prestigePerRaidSurvived;
    }
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
        this.unburiedCount++;
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
    // Military focus: raids arrive 30% later (stronger deterrent).
    const raidInterval = Math.round(TUNING.raidIntervalDays * (this.focus === 'military' ? 1.30 : 1.0));
    this.nextRaidDay = this.day + raidInterval + this.rng.int(5);
    this.addLog(`Raiders close on the colony — ${n} of them!`, 'bad');
  }

  /** Loose a wolf pack now (the daily scheduler + the play-test's "wolves" key). */
  summonWolves(n = 2 + this.rng.int(2)): void {
    if (this.wolves.active) return;
    this.wolves.start(n, this.grid.width, this.grid.height, this.rng, this.tickNo);
    this.addLog('A wolf pack prowls in from the forest edge.', 'bad');
  }

  /**
   * Advance deer one tick: each deer flees the nearest settler within deerFleeRadius,
   * or wanders slowly at random. Deer health is reduced by hunting_lodge workers in
   * _tickHunting(); health-zero deer are culled here and yield game_meal.
   * Uses the main rng for wander so the rng state survives save/load correctly.
   */
  private _tickDeer(): void {
    if (this.deer.length === 0) return;
    const a = this.agents;
    const W = this.grid.width, H = this.grid.height;
    const FLEE_SPEED = 0.40;
    const WANDER_SPEED = 0.15;
    const surviving: Deer[] = [];
    for (const d of this.deer) {
      if (d.health <= 0) continue; // culled by hunting; game_meal is produced by the lodge recipe
      // Flee the nearest settler inside the radius.
      let fled = false;
      for (let i = 0; i < a.count; i++) {
        const dx = d.x - a.posX[i];
        const dy = d.y - a.posY[i];
        const dist = Math.hypot(dx, dy);
        if (dist < TUNING.deerFleeRadius) {
          const len = Math.max(0.01, dist);
          d.x = Math.max(1, Math.min(W - 2, d.x + (dx / len) * FLEE_SPEED));
          d.y = Math.max(1, Math.min(H - 2, d.y + (dy / len) * FLEE_SPEED));
          fled = true;
          break;
        }
      }
      if (!fled) {
        d.x = Math.max(1, Math.min(W - 2, d.x + (this._deerRng.next() * 2 - 1) * WANDER_SPEED));
        d.y = Math.max(1, Math.min(H - 2, d.y + (this._deerRng.next() * 2 - 1) * WANDER_SPEED));
      }
      surviving.push(d);
    }
    this.deer = surviving;
  }

  /**
   * Per-tick hunting: each working settler at a hunting_lodge damages the nearest
   * deer within huntRange. The deer's health drops across ticks; when it hits 0
   * _tickDeer() removes it and adds game_meal to the stockpile.
   */
  private _tickHunting(): void {
    if (this.deer.length === 0) return;
    const lodgeTypeId = STATION_TYPE_ID.get('hunting_lodge') ?? 0;
    if (!lodgeTypeId) return;
    const a = this.agents;
    const HOURS_PER_TICK = MINUTES_PER_TICK / 60;
    for (const station of this.grid.stations) {
      if (station.typeId !== lodgeTypeId) continue;
      // Find the worker assigned to this station.
      let workerIdx = -1;
      for (let i = 0; i < a.count; i++) {
        if (a.stationId[i] === station.id && a.state[i] === AState.Working) { workerIdx = i; break; }
      }
      if (workerIdx < 0) continue;
      // Find the nearest deer within hunt range.
      let target: Deer | null = null, bestDist = TUNING.huntRange;
      for (const d of this.deer) {
        const dist = Math.hypot(d.x - station.x, d.y - station.y);
        if (dist <= bestDist) { target = d; bestDist = dist; }
      }
      if (!target) continue;
      // Skill scales damage: skill 0 → 0.5×, skill 10 → 1.5×.
      const skillMult = 0.5 + a.skill[workerIdx] * 0.1;
      target.health -= TUNING.huntDamagePerHour * HOURS_PER_TICK * skillMult;
    }
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

    // Yearly ledger: compare today's opening stock to yesterday's closing snapshot.
    // (On day 1 _prevDayStock is all-zero; starting goods count as inflow — acceptable.)
    for (let ri = 0; ri < RESOURCE_KINDS.length; ri++) {
      const delta = this.stock.buf[ri] - this._prevDayStock[ri];
      if (delta > 0.05) this._yearIn[ri] += delta;
      else if (delta < -0.05) this._yearOut[ri] -= delta;
    }

    // Snapshot stock levels for 7-day rolling net-flow display (same pattern as fat sim).
    for (const [key, qty] of Object.entries(this.stock.snapshot())) {
      let hist = this._stockHistory.get(key);
      if (!hist) { hist = []; this._stockHistory.set(key, hist); }
      hist.unshift(qty as number);
      if (hist.length > 8) hist.length = 8; // keep 8 snapshots → 7 deltas
    }

    // Primary production: the colony works its designated harvest zones into raw
    // goods (run before feeding so the day's grain/meals are on hand).
    this.harvestZones();
    // Off-screen holdings: each owned parcel beyond the capital sends a small
    // daily tribute of its biome's staple + a little gold (the seamless-world M3
    // payoff for expanding). ponytail: flat per-biome yield — upgrade to a real
    // dormant per-parcel sim (crops/pop) when a holding can host its own grid.
    this.tickHoldings();
    // Sapling regrowth: woodcutter-felled tiles grow back into forest over days.
    this._tickSaplings();
    // Forage regrowth: harvested deposits regenerate after FORAGE_REGROW_DAYS.
    this._tickForageRegrow();
    // Construction: spend the day's labour on the blueprint queue.
    this.tickConstruction();

    // Market: price modifiers heal a fraction of the way back to 1.0 each day, so
    // a single panic buy/sell doesn't dislocate prices forever (mirrors the fat sim).
    for (const [kind, mod] of this.priceModifiers) {
      const healed = mod + (1.0 - mod) * PRICE_RECOVERY;
      if (Math.abs(healed - 1.0) < 1e-3) this.priceModifiers.delete(kind);
      else this.priceModifiers.set(kind, healed);
    }

    // Feed: priority meal → game_meal → fish_meal → bread → ale → raw grain (fallback).
    // game_meal (hunting) and fish_meal (fishing) are premium food types that boost
    // diet variety; ale fills the stomach AND lifts recreation. Mirrors the fat sim's
    // consumeFood priority order. Count each type for the colony food-variety mood system.
    const MEAL_VAL = TUNING.mealFoodValue;
    const GRAIN_VAL = TUNING.rawGrainFoodValue;
    let eatMeal = 0, eatGameMeal = 0, eatFishMeal = 0, eatProduce = 0, eatDairy = 0, eatBread = 0, eatAle = 0, eatGrain = 0;
    for (let i = 0; i < a.count; i++) {
      if (a.food[i] >= 100) continue;
      if (this.stock.remove('meal', 1)) {
        a.food[i] = Math.min(100, a.food[i] + MEAL_VAL);
        eatMeal++;
      } else if (this.stock.remove('game_meal', 1)) {
        a.food[i] = Math.min(100, a.food[i] + MEAL_VAL);
        a.addThought(i, this.tickNo, 3, TICKS_PER_DAY); // fresh game is a treat
        eatGameMeal++;
      } else if (this.stock.remove('fish_meal', 1)) {
        a.food[i] = Math.min(100, a.food[i] + MEAL_VAL);
        a.addThought(i, this.tickNo, 3, TICKS_PER_DAY); // fresh fish is a treat
        eatFishMeal++;
      } else if (this.stock.remove('produce', 1)) {
        a.food[i] = Math.min(100, a.food[i] + MEAL_VAL);
        a.addThought(i, this.tickNo, 3, TICKS_PER_DAY); // fresh fruit & veg is a treat
        eatProduce++;
      } else if (this.stock.remove('dairy', 1)) {
        a.food[i] = Math.min(100, a.food[i] + MEAL_VAL);
        a.addThought(i, this.tickNo, 3, TICKS_PER_DAY); // dairy is a treat
        eatDairy++;
      } else if (this.stock.remove('bread', 1)) {
        a.food[i] = Math.min(100, a.food[i] + MEAL_VAL);
        a.addThought(i, this.tickNo, 3, TICKS_PER_DAY); // bread is a slight mood boost
        eatBread++;
      } else if (this.stock.remove('ale', 1)) {
        a.food[i] = Math.min(100, a.food[i] + MEAL_VAL); // ale is as filling as a meal
        a.recreation[i] = Math.min(100, a.recreation[i] + 20); // drinking lifts spirits
        a.addThought(i, this.tickNo, 5, TICKS_PER_DAY); // "Had a drink"
        eatAle++;
      } else if (this.stock.remove('preserved', 1)) {
        a.food[i] = Math.min(100, a.food[i] + MEAL_VAL); // preserved rations are as filling as a meal
        // Neutral taste: no thought bonus/penalty — better than grain, not as good as fresh
        eatGrain++; // reuse eatGrain counter for preserved (counted as staple variety)
      } else if (this.stock.remove('grain', 1)) {
        a.food[i] = Math.min(100, a.food[i] + GRAIN_VAL);
        a.addThought(i, this.tickNo, -4, TICKS_PER_DAY, ThoughtKey.Anon); // "ate raw grain"
        eatGrain++;
      }
    }
    // Food variety: rolling 7-day log drives mood bonuses/penalties.
    const dayFood = eatMeal > 0 ? 'meal'
      : eatGameMeal > 0 ? 'game_meal'
      : eatFishMeal > 0 ? 'fish_meal'
      : eatProduce > 0 ? 'produce'
      : eatDairy > 0 ? 'dairy'
      : eatBread > 0 ? 'bread'
      : eatAle > 0 ? 'ale'
      : eatGrain > 0 ? 'grain'
      : null;
    if (dayFood) {
      this._foodVarietyLog.unshift(dayFood);
      if (this._foodVarietyLog.length > 7) this._foodVarietyLog.length = 7;
      const same3 = this._foodVarietyLog.length >= 3 && this._foodVarietyLog.slice(0, 3).every(f => f === dayFood);
      const distinct = new Set(this._foodVarietyLog).size;
      for (let i = 0; i < a.count; i++) {
        if (same3) {
          a.addThought(i, this.tickNo, -TUNING.foodVarietyPenalty, TICKS_PER_DAY, ThoughtKey.FoodVariety);
        } else if (distinct >= 4) {
          a.addThought(i, this.tickNo, TUNING.foodVarietyBonus4, 3 * TICKS_PER_DAY, ThoughtKey.FoodVariety);
        } else if (distinct >= 3) {
          a.addThought(i, this.tickNo, TUNING.foodVarietyBonus3, 2 * TICKS_PER_DAY, ThoughtKey.FoodVariety);
        }
      }
    }

    // Clothing: every clothesWearDays the colony needs a fresh batch of clothes.
    // If stock covers everyone, distribute them and grant a brief mood boost.
    // If not, settlers go threadbare — warmth decay doubles in the open.
    if (this.day >= this._clothingDay) {
      if (this.stock.remove('clothes', a.count)) {
        this._settlersClothed = true;
        for (let i = 0; i < a.count; i++) a.addThought(i, this.tickNo, 3, 2 * TICKS_PER_DAY);
      } else {
        this._settlersClothed = false;
      }
      this._clothingDay = this.day + TUNING.clothesWearDays;
    }

    // Growth: a content, well-housed, well-fed colony attracts a newcomer.
    const services = aggregateCapacities(this.grid);
    const housing = services.sleep;
    this._hasWell = services.well > 0; // cache for per-tick infection calc
    const avgMood = this.averageMood();
    const fed = this.stock.count('meal') >= a.count;
    if (this.day >= TUNING.firstImmigrantDay && a.count < housing && a.count < TUNING.immigrantStopPop && a.count < a.capacity && avgMood >= BIRTH_MOOD_MIN && fed) {
      const newcomer = this.spawnPerson(this.homeX, this.homeY);
      if (newcomer >= 0) {
        this.births++;
        this.addLog(`${a.name(newcomer)} is drawn to the colony.`, 'good');
      }
    }

    // Meal spoilage: prepared food only keeps so long. Without a storehouse the larder
    // holds TUNING.mealCapBase meals; each storehouse room with at least one shelf adds
    // TUNING.mealCapPerGranary. Excess meals spoil daily (mirrors the fat sim's mealCap).
    {
      const cap = this.mealCap();
      const mealStock = this.stock.count('meal');
      if (mealStock > cap) {
        const spoiled = Math.round(mealStock - cap);
        this.stock.remove('meal', spoiled);
        this.addLog(`${spoiled} meals spoiled — the larder holds only ${cap}. A storehouse would keep more.`, 'bad');
      }
    }

    // Storage overflow (SoS colony model): non-food goods beyond the warehouse
    // capacity spoil/are lost. Food is exempt (own freshness cap above), so this
    // never starves the colony — it just punishes hoarding raw materials.
    {
      const cap = this.storageCap();
      let total = 0;
      for (const k of RESOURCE_KINDS) if (!FOOD_KINDS.has(k)) total += this.stock.count(k);
      if (total > cap) {
        const factor = cap / total;
        let spoiled = 0;
        for (const k of RESOURCE_KINDS) {
          if (FOOD_KINDS.has(k)) continue;
          const lose = Math.round(this.stock.count(k) * (1 - factor));
          if (lose > 0) { this.stock.remove(k, lose); spoiled += lose; }
        }
        if (spoiled > 0) this.addLog(`Storehouses overflow — ${spoiled} goods spoil for want of space. Build more storage.`, 'bad');
      }
    }

    // Emigration: an overcrowded colony loses families until the hard cap is broken.
    if (a.count >= TUNING.hardCapPop && this.rng.chance(0.1)) {
      const idx = this.rng.int(a.count);
      const name = a.name(idx);
      this.relations.forget(a.id[idx]);
      a.remove(idx);
      this.deaths++;
      this.addLog(`${name}'s family packs their wagon — too crowded here.`, 'info');
    }

    // Cultural focus: shared arts and festivities lift everyone's spirits daily.
    if (this.focus === 'cultural') {
      for (let i = 0; i < a.count; i++) {
        a.recreation[i] = Math.min(100, a.recreation[i] + 2);
        a.social[i] = Math.min(100, a.social[i] + 2);
      }
    }

    // Housing preference: the colony's home-room style either matches or clashes with
    // a settler's trait-derived preference (private / communal / military=3). Derive the
    // dominant style from the average sleep capacity per home room: ≤1.5 beds/room is a
    // private feel; ≥3 beds/room is communal (bunks). Settlers whose preference matches
    // get a small daily mood lift (mirrors the fat sim's bed-style bonus at town altitude).
    {
      let totalSleepCap = 0, homeRoomCount = 0;
      for (const room of this.grid.rooms) {
        if (ROOM_DEF_BY_NUM[room.typeId]?.id !== 'home') continue;
        homeRoomCount++;
        for (const sid of room.stationIds) {
          const st = this.grid.stations.find((s) => s.id === sid);
          if (!st) continue;
          const sdef = STATION_DEF_BY_NUM[st.typeId];
          if (sdef?.capacity?.kind === 'sleep') totalSleepCap += sdef.capacity.amount;
        }
      }
      const avgPerRoom = homeRoomCount > 0 ? totalSleepCap / homeRoomCount : 0;
      // 1=private feel (≤1.5 avg), 2=communal feel (≥3 avg), 0=neutral / no homes
      const colonyStyle = avgPerRoom <= 0 ? 0 : avgPerRoom <= 1.5 ? 1 : avgPerRoom >= 3 ? 2 : 0;
      if (colonyStyle > 0) {
        for (let i = 0; i < a.count; i++) {
          if (a.housingPref[i] === colonyStyle) {
            a.addThought(i, this.tickNo, 2, 2 * TICKS_PER_DAY);
          }
        }
      }
    }

    // Housing: settlers without a bed slept on the ground — apply a mood penalty
    // to those with low rest (a proxy for not having recovered in a proper bed).
    if (services.sleep < a.count) {
      for (let i = 0; i < a.count; i++) {
        if (a.rest[i] < 60) a.addThought(i, this.tickNo, -6, TICKS_PER_DAY);
      }
    }

    // Religion: shrines hold services that lift worshippers' mood. Each shrine
    // reaches FAITH_PER_SHRINE settlers (capped at the population).
    if (services.faith > 0) {
      const served = Math.min(a.count, services.faith * FAITH_PER_SHRINE);
      for (let i = 0; i < served; i++) a.addThought(i, this.tickNo, FAITH_MOOD_BONUS, TICKS_PER_DAY, ThoughtKey.Faith);
    }

    // Wildlife: past the first prowl day, a wolf pack may slip in from the edge
    // (per-day chance, mirrors the fat sim). Only one pack prowls at a time.
    if (this.day >= TUNING.wolfFirstDay && !this.wolves.active && this.rng.chance(TUNING.wolfPackChancePerDay)) {
      this.summonWolves();
    }
    // Deer: respawn one per day up to deerMaxCount (models natural herd regrowth).
    // Uses the deer stream so the main rng (raids, births, weather) is unaffected.
    if (this.deer.length < TUNING.deerMaxCount && this._deerRng.chance(TUNING.deerSpawnChancePerDay)) {
      const W = this.grid.width, H = this.grid.height;
      this.deer.push({
        id: this._deerNextId++,
        x: 2 + this._deerRng.int(W - 4),
        y: 2 + this._deerRng.int(H - 4),
        health: TUNING.deerHealth,
      });
    }

    // Watchtower: sentinels with watch_post stations give early warning of approaching raids.
    if (services.watch > 0) {
      const daysUntilRaid = this.nextRaidDay - this.day;
      if (daysUntilRaid === TUNING.watchtowerWarningDays) {
        this.addLog('Your sentinels spot enemy forces gathering on the horizon. A raid approaches!', 'bad');
      }
    }

    // Market: each stall generates 2 gold per day from passing trade.
    if (services.trade > 0) {
      const income = services.trade * TUNING.goldPerMarketStallPerDay;
      this.gold += income;
      if (this.day % 7 === 0) // weekly summary to avoid log spam
        this.addLog(`Market earns ${(income * 7).toFixed(0)} gold this week (${services.trade} stall${services.trade > 1 ? 's' : ''}).`, 'good');
    }

    // Research: library desks (education capacity) generate points daily.
    // Auto-research if a queue target is now affordable (player set via core.researchBook.queue).
    this.researchBook.addPoints(services.education);
    const autoResearched = this.researchBook.autoResearch();
    if (autoResearched) {
      this.addLog(`Research complete: ${autoResearched}`, 'good');
      this.prestige++;
    }

    // Era transition: check if the industrial-age threshold has been crossed.
    this.checkEraTransition();

    // Prestige tiers: celebrate notable accomplishments.
    for (const tier of [25, 50, 100, 200] as const) {
      if (this.prestige >= tier && this._lastPrestigeMilestone < tier) {
        this._lastPrestigeMilestone = tier;
        const title = tier >= 200 ? 'legendary' : tier >= 100 ? 'renowned' : tier >= 50 ? 'prosperous' : 'respected';
        this.addLog(`${this.townName} is now ${title} — ${tier} prestige earned.`, 'good');
      }
    }

    // Burial: process one interment per grave marker per day, or penalise morale.
    if (this.unburiedCount > 0) {
      if (services.burial > 0) {
        const buried = Math.min(this.unburiedCount, services.burial);
        this.unburiedCount -= buried;
        if (buried > 0) this.addLog(`${buried === 1 ? 'A settler is' : `${buried} settlers are`} laid to rest.`, 'info');
      } else {
        // No burial ground: each unburied corpse drags on every living settler's mood.
        const penalty = this.unburiedCount * TUNING.unburiedMoodPenalty;
        for (let i = 0; i < a.count; i++) {
          const m = a.mood[i] - penalty;
          a.mood[i] = m < -100 ? -100 : m;
        }
      }
    }

    // Economy: once a month, accrue loan interest, auto-service the debt from the
    // treasury, and re-reckon inflation from the money supply.
    if (this.day > 0 && this.day % ECONOMY_MONTH_DAYS === 0) this.monthlyEconomy();

    // Standing trade orders: auto-execute sell/buy orders that are due today.
    this.processTradeOrders();

    // Random events: merchant visits, weather surprises, wanderers, etc.
    if (this.day >= this.nextEventDay) this.fireRandomEvent();

    // Season change: log the start of each new season.
    const seasonIdx = Math.floor((this.day % DAYS_PER_YEAR) / DAYS_PER_SEASON);
    const growingSeason = seasonIdx < 3;
    if (seasonIdx !== this._lastSeasonIdx) {
      const year = START_YEAR + Math.floor(this.day / DAYS_PER_YEAR);
      this.addLog(`${SEASONS[seasonIdx]} ${year} begins.`, 'info');
      this._lastSeasonIdx = seasonIdx;
      // Year rollover: Spring of a new year → finalize the prior year's ledger.
      if (seasonIdx === 0 && this.day >= DAYS_PER_YEAR) {
        const inflow: Partial<Record<ResourceKind, number>> = {};
        const outflow: Partial<Record<ResourceKind, number>> = {};
        for (let ri = 0; ri < RESOURCE_KINDS.length; ri++) {
          if (this._yearIn[ri] > 0.5) inflow[RESOURCE_KINDS[ri]] = Math.round(this._yearIn[ri]);
          if (this._yearOut[ri] > 0.5) outflow[RESOURCE_KINDS[ri]] = Math.round(this._yearOut[ri]);
        }
        const prevPop = this._yearStartPop;
        this.lastYearReport = { year: year - 1, popStart: prevPop, popEnd: this.population, inflow, outflow };
        this._yearIn.fill(0);
        this._yearOut.fill(0);
        this._yearStartPop = this.population;
      }
    }
    // Drought/flood transitions: log once when conditions change.
    const nowDrought = growingSeason && this.weather.isDrought(this.day);
    if (nowDrought && !this._droughtActive) this.addLog('Drought. The soil cracks and crops slow to a crawl.', 'bad');
    else if (!nowDrought && this._droughtActive) this.addLog('The drought breaks. Rain returns to the fields.', 'good');
    this._droughtActive = nowDrought;

    const nowFlood = growingSeason && this.weather.isFloodRisk(this.day);
    if (nowFlood && !this._floodActive) {
      // Flood: wash out 1-2 random crop tiles
      const cropTiles: number[] = [];
      for (let fi = 0; fi < this.grid.size; fi++) {
        if (this.grid.zone[fi] === ZONE.FIELD || this.grid.zone[fi] === ZONE.FLAX) cropTiles.push(fi);
      }
      const washed = Math.min(cropTiles.length, 1 + this.rng.int(2));
      for (let w = 0; w < washed; w++) {
        const pick = cropTiles.splice(this.rng.int(cropTiles.length), 1)[0];
        this.grid.clearZone(pick % this.grid.width, (pick / this.grid.width) | 0);
      }
      this.addLog(`Heavy rains flood the fields — ${washed} field tile${washed > 1 ? 's' : ''} washed out.`, 'bad');
    }
    else if (!nowFlood && this._floodActive) this.addLog('The rains ease. Flood threat passes.', 'info');
    this._floodActive = nowFlood;

    // Population milestones: prestige awarded at key thresholds.
    const pop = this.agents.count;
    const MILESTONE_PRESTIGE: [number, number][] = [[10, 1], [25, 2], [50, 3], [100, 5], [200, 8], [500, 15]];
    for (const [m, pts] of MILESTONE_PRESTIGE) {
      if (pop >= m && this._lastPopMilestone < m) {
        this._lastPopMilestone = m;
        this.prestige += pts;
        this.addLog(`Colony reaches ${m} settlers — a growing community. (+${pts} prestige)`, 'good');
      }
    }

    // Yearly ledger: snapshot stock at end of day so tomorrow's delta is accurate.
    this._prevDayStock.set(this.stock.buf);
  }

  /**
   * Work the designated harvest zones into raw goods. Labour-capped: the colony can
   * only work so many tiles a day, scaled by headcount, so a vast field still needs
   * hands to reap it. Consuming zones (woodcutter/quarry) strip the tile back to
   * grass once worked; renewable ones (field/fishery/flax) yield again next day. A
   * quarry on an ore-flecked tile pulls iron ore instead of plain stone. Flax is
   * perennial and produces year-round; grain fields lie fallow in winter.
   * ponytail: flat per-worker tile budget + flat yield — the knobs to tune in the
   * GUI; per-tile pathing/regrowth timers can come later if it needs the texture.
   */
  private harvestZones(): void {
    const grid = this.grid;
    let budget = Math.floor(this.agents.count * HARVEST_TILES_PER_WORKER);
    if (budget <= 0) return;
    // Fields are seasonal: no grain in winter (season index 3 = days 45–59 of the year).
    const seasonIdx = Math.floor((this.day % DAYS_PER_YEAR) / DAYS_PER_SEASON);
    const growingSeason = seasonIdx < 3;
    // crop_rotation tech grants a 25% field yield bonus; crop_science stacks another 20%.
    // Agricultural focus stacks another +25%.
    const techMult = 1
      + (this.researchBook.hasTech('crop_rotation') ? 0.25 : 0)
      + (this.researchBook.hasTech('crop_science') ? 0.20 : 0)
      + (this.focus === 'agricultural' ? 0.25 : 0);
    // Drought suppresses field yields; good rain gives a small boost (growthMult: 0.35–1.1).
    const growthMult = this.weather.growthMult(this.day);
    const fieldMult = techMult * growthMult;
    // Extraction-zone yield techs (mirror the field bonus, no weather term).
    const woodMult = this.researchBook.hasTech('forestry') ? 1.25 : 1;
    const stoneMult = this.researchBook.hasTech('mining') ? 1.30 : 1;
    const fishMult = this.researchBook.hasTech('fishing') ? 1.25 : 1;
    for (let i = 0; i < grid.size && budget > 0; i++) {
      const z = grid.zone[i];
      if (z === ZONE.NONE) continue;
      const def = ZONE_DEFS[z];
      if (!def) continue;
      // Seasonal zones (field) lie fallow in winter — labour still counts but no yield.
      if (def.seasonal && !growingSeason) { budget--; continue; }
      const x = i % grid.width, y = (i / grid.width) | 0;
      if (!grid.canZone(x, y, z)) { grid.zone[i] = ZONE.NONE; continue; } // terrain changed under it
      // Forage: skip depleted tiles (deposit cleared, regrow timer running).
      if (z === ZONE.FORAGE && grid.forage[i] === FORAGE.NONE) { budget--; continue; }
      const res = z === ZONE.QUARRY && grid.ore[i] ? 'iron_ore'
        : z === ZONE.FORAGE ? (grid.forage[i] === FORAGE.HERBS ? 'herbs' : 'meal')
        : def.resource;
      const yield_ = HARVEST_YIELD * (
        (z === ZONE.FIELD || z === ZONE.FLAX) ? fieldMult
        : z === ZONE.WOODCUTTER ? woodMult
        : z === ZONE.QUARRY ? stoneMult
        : z === ZONE.FISHERY ? fishMult
        : 1);
      this.stock.add(res, yield_);
      budget--;
      if (!def.renewable) {
        grid.setTerrain(x, y, TERRAIN.GRASS);
        grid.zone[i] = ZONE.NONE;
        // Woodcutter-cleared tiles start regrowing (sapling age 1 = day 1 of growth).
        if (z === ZONE.WOODCUTTER) grid.saplingAge[i] = 1;
      } else if (z === ZONE.FORAGE) {
        // Deplete the deposit; start countdown — zone stays painted so it auto-resumes.
        const kind = grid.forage[i];
        grid.forage[i] = FORAGE.NONE;
        grid.forageRegrow[i] = FORAGE_REGROW_DAYS;
        this.addLog(`Forage deposit (${kind === FORAGE.HERBS ? 'herbs' : kind === FORAGE.MUSHROOMS ? 'mushrooms' : 'berries'}) exhausted — regrowing in ${FORAGE_REGROW_DAYS} days.`, 'info');
      }
    }
  }

  /** Advance sapling growth one day; convert mature saplings to trees. */
  private _tickSaplings(): void {
    const grid = this.grid;
    for (let i = 0; i < grid.size; i++) {
      if (grid.saplingAge[i] === 0) continue;
      if (grid.terrain[i] !== TERRAIN.GRASS) { grid.saplingAge[i] = 0; continue; } // terrain changed
      grid.saplingAge[i]++;
      if (grid.saplingAge[i] > TUNING.saplingGrowDays) {
        grid.setTerrain(i % grid.width, (i / grid.width) | 0, TERRAIN.TREE);
        grid.saplingAge[i] = 0;
      }
    }
  }

  /** Count down forage regrow timers; restore deposits when they expire. */
  private _tickForageRegrow(): void {
    const grid = this.grid;
    for (let i = 0; i < grid.size; i++) {
      if (grid.forageRegrow[i] === 0) continue;
      grid.forageRegrow[i]--;
      if (grid.forageRegrow[i] === 0 && grid.forage[i] === FORAGE.NONE) {
        // Restore a random deposit type on the tile (only if still grass, no other deposit).
        if (grid.terrain[i] === TERRAIN.GRASS) {
          const roll = Math.random();
          grid.forage[i] = roll < 0.5 ? FORAGE.BERRIES : roll < 0.8 ? FORAGE.MUSHROOMS : FORAGE.HERBS;
        }
      }
    }
  }

  // ── construction: painted blueprints → real build over time ──────────────────

  private _pendingAt(x: number, y: number): boolean {
    return this.builds.some((o) => o.x === x && o.y === y);
  }

  /** Arm a spike trap at (x, y), consuming wood immediately. Returns true if placed. */
  paintTrap(x: number, y: number): boolean {
    if (!this.grid.inBounds(x, y) || this.grid.hasTrap(x, y)) return false;
    if (!this.stock.remove('wood', TUNING.trapWoodCost)) return false;
    this.grid.setTrap(x, y);
    return true;
  }

  /** Remove a spike trap, refunding the wood cost. */
  clearTrap(x: number, y: number): void {
    if (this.grid.inBounds(x, y) && this.grid.hasTrap(x, y)) {
      this.grid.clearTrap(x, y);
      this.stock.add('wood', TUNING.trapWoodCost);
    }
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

  /**
   * Queue all walls, floors, and stations for a pre-defined building template.
   * Accepts a BlueprintDef object or a blueprint id string. Returns false if the
   * footprint is out of bounds. Individual tiles already built/queued are silently
   * skipped so overlapping stamps don't hard-fail.
   */
  stampBlueprint(bp: BlueprintDef | string, ox: number, oy: number): boolean {
    if (typeof bp === 'string') {
      const found = BLUEPRINT_DEFS.find((b) => b.id === bp);
      if (!found) return false;
      bp = found;
    }
    if (!this.grid.inBounds(ox, oy) || !this.grid.inBounds(ox + bp.w - 1, oy + bp.h - 1)) return false;
    const [fx0, fy0, fx1, fy1] = bp.floorRect;
    const typeId = ROOM_TYPE_ID.get(bp.roomType) ?? 0;
    for (let y = fy0; y <= fy1; y++)
      for (let x = fx0; x <= fx1; x++)
        this.blueprintFloor(ox + x, oy + y, typeId);
    for (const [wx0, wy0, wx1, wy1] of bp.wallRects)
      for (let y = wy0; y <= wy1; y++)
        for (let x = wx0; x <= wx1; x++)
          this.blueprintWall(ox + x, oy + y);
    for (const st of bp.stations)
      this.blueprintStation(st.type, ox + st.x, oy + st.y);
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
    const toolBonus = this.stock.count('tools') > 0 ? TUNING.toolsBuildSpeedBonus : 0;
    const ropeBonus = this.stock.count('rope') > 0 ? TUNING.ropeBuildSpeedBonus : 0; // scaffolding
    let budget = Math.floor(this.agents.count * BUILD_WORK_PER_WORKER * (1 + toolBonus + ropeBonus));
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

  // ── random events ─────────────────────────────────────────────────────────────

  private fireRandomEvent(): void {
    // Choice events block further auto-events until resolved.
    if (this.pendingChoice) return;
    const [min, max] = EVENT_INTERVAL;
    this.nextEventDay = this.day + min + this.rng.int(max - min + 1);
    const roll = this.rng.next();
    if      (roll < 0.05) this.evtChoiceTrader();
    else if (roll < 0.10) this.evtChoiceBandits();
    else if (roll < 0.15) this.evtChoiceRefugees();
    else if (roll < 0.20) this.evtChoiceFeud();
    else if (roll < 0.24) this.evtChoiceScholar();
    else if (roll < 0.28) this.evtMerchant();
    else if (roll < 0.31) this.evtWanderer();
    else if (roll < 0.38) this.evtColdSnap();
    else if (roll < 0.45) this.evtRats();
    else if (roll < 0.52) { if (this.day >= this._festivalCooldown) this.evtFestival(); else this.evtMerchant(); }
    else if (roll < 0.59) this.evtFeverOutbreak();
    else if (roll < 0.65) this.evtBumperHarvest();
    else if (roll < 0.71) this.evtWindfallTimber();
    else if (roll < 0.77) this.evtSkillBreakthrough();
    else if (roll < 0.83) this.evtStormDamage();
    else if (roll < 0.87) this.evtInjuredWorker();
    else if (roll < 0.88) this.evtPlague();
    else if (roll < 0.91) this.evtChoiceHealer();
    else if (roll < 0.94) this.evtFoundGold();
    else if (roll < 0.97) this.evtMineralStrike();
    else                  this.evtHeatwave();
  }

  private evtMerchant(): void {
    const hasTavern = this.grid.rooms.some((r) => {
      const def = ROOM_DEF_BY_NUM[r.typeId];
      return def?.id === 'tavern' && r.enclosed;
    });
    if (hasTavern && this.stock.count('wood') >= 5) {
      this.stock.remove('wood', 5);
      this.stock.add('grain', 8);
      this.addLog('A merchant caravan stops at the tavern — 5 wood trades for 8 grain.', 'good');
    } else {
      const gift = 3 + this.rng.int(4);
      this.stock.add('grain', gift);
      this.addLog(`A tinker's cart rolls through at dusk — leaves ${gift} grain for a night's hospitality.`, 'good');
    }
  }

  private evtBumperHarvest(): void {
    const bonus = 10 + this.rng.int(11); // 10–20 grain
    this.stock.add('grain', bonus);
    this.addLog(`Bumper harvest: ${bonus} extra grain gathered from the fields.`, 'good');
  }

  private evtWanderer(): void {
    const services = aggregateCapacities(this.grid);
    if (this.agents.count < services.sleep && this.agents.count < this.agents.capacity) {
      const idx = this.spawnPerson(this.homeX, this.homeY);
      if (idx >= 0) {
        this.births++;
        this.addLog(`${this.agents.name(idx)} wanders in and asks to stay.`, 'good');
      }
    } else {
      this.addLog('A wanderer passes through but the colony has no spare beds.', 'info');
    }
  }

  private evtFeverOutbreak(): void {
    if (this.agents.count === 0) return;
    const target = this.rng.int(this.agents.count);
    this.agents.sickUntilTick[target] = this.tickNo + 3 * TICKS_PER_DAY;
    this.addLog(`${this.agents.name(target)} comes down with a fever.`, 'bad');
  }

  private evtFestival(): void {
    const MOOD_BOOST = 5;
    for (let i = 0; i < this.agents.count; i++) {
      this.agents.mood[i] = Math.min(100, this.agents.mood[i] + MOOD_BOOST);
    }
    this.addLog('The colony holds a festival — settlers are in high spirits.', 'good');
    this._festivalCooldown = this.day + TUNING.festivalCooldownDays;
  }

  private evtStormDamage(): void {
    // A storm tears down one random wall tile if any walls exist.
    const walls: number[] = [];
    for (let i = 0; i < this.grid.size; i++) if (this.grid.wall[i]) walls.push(i);
    if (walls.length === 0) {
      this.addLog('A fierce storm rattles the settlement but does no lasting damage.', 'info');
      return;
    }
    const idx = walls[this.rng.int(walls.length)];
    const x = idx % this.grid.width;
    const y = (idx / this.grid.width) | 0;
    this.grid.clearWall(x, y);
    const spoiled = Math.min(Math.ceil(this.stock.count('meal') * 0.1), 10);
    if (spoiled > 0) this.stock.remove('meal', spoiled);
    this.addLog(`A storm collapses part of the colony walls${spoiled > 0 ? ` and spoils ${spoiled} meals` : ''} — brace for the cold.`, 'bad');
  }

  private evtColdSnap(): void {
    // Drop every settler's warmth to simulate three bitter days.
    for (let i = 0; i < this.agents.count; i++) {
      this.agents.warmth[i] = Math.max(0, this.agents.warmth[i] - 30);
    }
    this.addLog('A cold snap rolls in from the mountains. Settlers feel the bitter chill.', 'bad');
  }

  private evtRats(): void {
    const inStores = this.stock.count('grain');
    const lost = Math.ceil(inStores * 0.1);
    if (lost > 0) {
      this.stock.remove('grain', lost);
      this.addLog(`Rats in the stores — ${lost} grain spoiled.`, 'bad');
    }
  }

  private evtWindfallTimber(): void {
    const logs = 10 + this.rng.int(11); // 10–20 wood
    this.stock.add('wood', logs);
    this.addLog(`A deadfall near the tree line yields ${logs} wood — settlers haul it in.`, 'good');
  }

  private evtSkillBreakthrough(): void {
    if (this.agents.count === 0) return;
    const i = this.rng.int(this.agents.count);
    // Boost craft skill (capped at 10), which improves work speed.
    this.agents.skill[i] = Math.min(10, this.agents.skill[i] + 1);
    this.agents.addThought(i, this.tickNo, 10, 3 * TICKS_PER_DAY);
    this.addLog(`${this.agents.name(i)} has a breakthrough — their craft improves.`, 'good');
  }

  private evtInjuredWorker(): void {
    const healthy: number[] = [];
    for (let i = 0; i < this.agents.count; i++) {
      if (this.agents.woundUntreated[i] === 0 && this.agents.health[i] > 20) healthy.push(i);
    }
    if (healthy.length === 0) return;
    const i = healthy[this.rng.int(healthy.length)];
    this.agents.inflictWound(i, this.tickNo);
    this.addLog(`${this.agents.name(i)} takes a bad fall at work — they need treatment.`, 'bad');
  }

  private evtPlague(): void {
    if (this.agents.count === 0) return;
    const n = Math.min(this.agents.count, 2 + this.rng.int(3)); // 2–4 settlers
    const targets = new Set<number>();
    for (let guard = 0; targets.size < n && guard < n * 4; guard++) {
      targets.add(this.rng.int(this.agents.count));
    }
    for (const i of targets) {
      this.agents.sickUntilTick[i] = this.tickNo + 5 * TICKS_PER_DAY;
    }
    this.addLog(`A sickness sweeps the colony — ${n} settlers fall ill at once.`, 'bad');
  }

  private evtFoundGold(): void {
    const nuggets = 3 + this.rng.int(8); // 3–10 gold
    this.gold += nuggets;
    const hasQuarry = this.grid.zone.some((z) => z === 3 /* QUARRY */);
    if (hasQuarry) {
      this.addLog(`A quarry worker unearths gold nuggets — ${nuggets} gold added to the treasury.`, 'good');
    } else {
      this.addLog(`A settler spots glittering flecks in the stream — ${nuggets} gold recovered.`, 'good');
    }
  }

  private evtHeatwave(): void {
    if (this.agents.count === 0) return;
    // Heatwave: warmth spikes for everyone (pleasant in winter, oppressive in summer).
    const seasonIdx = Math.floor((this.day % DAYS_PER_YEAR) / DAYS_PER_SEASON);
    const isSummer = seasonIdx === 1 || seasonIdx === 2;
    if (isSummer) {
      // Spoil some food, raise warmth to uncomfortable highs.
      const spoiled = Math.floor(this.stock.count('meal') * 0.08);
      if (spoiled > 0) this.stock.remove('meal', spoiled);
      for (let i = 0; i < this.agents.count; i++) {
        this.agents.warmth[i] = Math.min(100, this.agents.warmth[i] + 20);
      }
      this.addLog(`A scorching heat wave bakes the colony${spoiled > 0 ? ` — ${spoiled} meals spoil in the heat` : ''}.`, 'bad');
    } else {
      // Off-season heatwave: a brief warm spell, slightly nice.
      for (let i = 0; i < this.agents.count; i++) {
        this.agents.warmth[i] = Math.min(100, this.agents.warmth[i] + 15);
      }
      this.addLog('An unseasonal warm spell — settlers shed their cloaks and enjoy the sunshine.', 'good');
    }
  }

  private evtChoiceTrader(): void {
    this.pendingChoice = {
      id: 'trader',
      title: 'Merchant Caravan',
      text: 'A well-supplied merchant caravan passes through. Trade with them?',
      choices: [
        { label: 'Trade 5 wood', desc: 'Get 8 grain (requires 5 wood in stock).' },
        { label: 'Decline', desc: 'The merchant moves on.' },
      ],
    };
  }

  private evtChoiceBandits(): void {
    this.pendingChoice = {
      id: 'bandits',
      title: 'Bandits at the Gate',
      text: 'A gang of armed outlaws demands tribute or promises violence.',
      choices: [
        { label: 'Pay 10 gold', desc: 'They take the coin and leave (requires 10 gold).' },
        { label: 'Stand your ground', desc: 'They attack. Two settlers fight them off but may be wounded.' },
      ],
    };
  }

  private evtChoiceRefugees(): void {
    const available = Math.max(1, Math.floor(this.agents.count * 0.3));
    this.pendingChoice = {
      id: 'refugees',
      title: 'Refugees Seeking Shelter',
      text: `A group of ${available} refugees asks to join your colony. Accept or turn away?`,
      choices: [
        { label: 'Welcome them', desc: `+${available} settlers, higher food consumption.` },
        { label: 'Turn away', desc: 'Keep resources stable.' },
      ],
    };
  }

  private evtChoiceFeud(): void {
    if (this.agents.count < 2) { this.evtInjuredWorker(); return; }
    this.pendingChoice = {
      id: 'feud',
      title: 'Settlement Conflict',
      text: 'Two families nearly come to blows over land. How to resolve it?',
      choices: [
        { label: 'Mediate fairly', desc: 'Morale improves across the colony.' },
        { label: 'Ignore it', desc: 'Conflict lingers and morale suffers.' },
      ],
    };
  }

  private evtChoiceScholar(): void {
    if (this.agents.count === 0) { this.evtWanderer(); return; }
    const SCHOLAR_COST = 15;
    this.pendingChoice = {
      id: 'scholar',
      title: 'Travelling Scholar',
      text: 'A learned scholar offers to train your most promising settler for 15 gold.',
      choices: [
        { label: `Pay ${SCHOLAR_COST} gold`, desc: `A settler's craft skill jumps by 2 (requires ${SCHOLAR_COST} gold).` },
        { label: 'Decline', desc: 'The scholar moves on to the next town.' },
      ],
    };
  }

  private evtChoiceHealer(): void {
    let sickOrWounded = 0;
    for (let i = 0; i < this.agents.count; i++) {
      if (this.agents.sickUntilTick[i] > this.tickNo || this.agents.woundUntreated[i]) sickOrWounded++;
    }
    if (sickOrWounded === 0) { this.evtWanderer(); return; }
    const HERB_COST = 3;
    this.pendingChoice = {
      id: 'healer',
      title: 'Wandering Healer',
      text: `A healer offers to treat ${sickOrWounded} sick/wounded settler${sickOrWounded > 1 ? 's' : ''} for ${HERB_COST} herbs.`,
      choices: [
        { label: `Pay ${HERB_COST} herbs`, desc: 'All sick and wounded settlers are cured immediately.' },
        { label: 'Decline', desc: 'The healer moves on to the next town.' },
      ],
    };
  }

  private evtMineralStrike(): void {
    const gain = 8 + this.rng.int(8);
    this.stock.add('iron_ore', gain);
    this.addLog(`Settlers strike a rich mineral seam while digging foundations — ${gain} iron ore added.`, 'good');
  }

  /**
   * Resolve a pending player-choice event. Returns true if the choice was valid.
   * Clears `pendingChoice` so the next event can fire.
   */
  resolveEventChoice(choiceIndex: number): boolean {
    const ev = this.pendingChoice;
    if (!ev || choiceIndex < 0 || choiceIndex >= ev.choices.length) return false;
    this.pendingChoice = null;

    switch (ev.id) {
      case 'trader':
        if (choiceIndex === 0 && this.stock.count('wood') >= 5) {
          this.stock.remove('wood', 5);
          this.stock.add('grain', 8);
          this.addLog('Traded 5 wood for 8 grain with the merchant caravan.', 'good');
        } else {
          this.addLog('The merchant caravan moves on without a trade.', 'info');
        }
        break;
      case 'bandits':
        if (choiceIndex === 0 && this.gold >= 10) {
          this.gold -= 10;
          this.addLog('Paid 10 gold tribute — the bandits leave without bloodshed.', 'info');
        } else {
          // Stand and fight: wound up to two settlers, log the skirmish.
          let wounded = 0;
          for (let i = 0; i < this.agents.count && wounded < 2; i++) {
            if (this.agents.health[i] > 20 && this.agents.woundUntreated[i] === 0) {
              this.agents.inflictWound(i, this.tickNo);
              wounded++;
            }
          }
          this.addLog(wounded > 0
            ? `The colony stands firm — ${wounded} settler(s) wounded driving off the bandits.`
            : 'The colony stands firm and drives off the bandits.', wounded > 0 ? 'bad' : 'good');
        }
        break;
      case 'refugees':
        if (choiceIndex === 0) {
          const n = Math.max(1, Math.floor(this.agents.count * 0.3));
          for (let i = 0; i < n; i++) this.spawnPerson(this.homeX, this.homeY);
          this.addLog(`${n} refugee${n === 1 ? '' : 's'} settle in. The colony grows.`, 'good');
        } else {
          this.addLog('Turned away the refugees. A difficult but practical choice.', 'info');
        }
        break;
      case 'feud':
        if (choiceIndex === 0) {
          for (let i = 0; i < Math.min(2, this.agents.count); i++)
            this.agents.addThought(i, this.tickNo, 3, 3 * TICKS_PER_DAY);
          this.addLog('Mediated the dispute fairly. Tensions ease across the colony.', 'good');
        } else {
          for (let i = 0; i < Math.min(2, this.agents.count); i++)
            this.agents.addThought(i, this.tickNo, -3, 5 * TICKS_PER_DAY);
          this.addLog('The feud continues to fester in the colony.', 'bad');
        }
        break;
      case 'scholar': {
        const SCHOLAR_COST = 15;
        if (choiceIndex === 0 && this.gold >= SCHOLAR_COST && this.agents.count > 0) {
          this.gold -= SCHOLAR_COST;
          // Train the settler with the highest existing skill (most benefit from a boost).
          let best = 0;
          for (let i = 1; i < this.agents.count; i++)
            if (this.agents.skill[i] > this.agents.skill[best]) best = i;
          this.agents.skill[best] = Math.min(10, this.agents.skill[best] + 2);
          this.addLog(`${this.agents.name(best)} is tutored by the scholar — skill rises to ${this.agents.skill[best].toFixed(1)}.`, 'good');
        } else {
          this.addLog('The scholar tips their hat and continues down the road.', 'info');
        }
        break;
      }
      case 'healer': {
        const HERB_COST = 3;
        if (choiceIndex === 0 && this.stock.count('herbs') >= HERB_COST) {
          this.stock.remove('herbs', HERB_COST);
          let healed = 0;
          for (let i = 0; i < this.agents.count; i++) {
            if (this.agents.sickUntilTick[i] > this.tickNo || this.agents.woundUntreated[i]) {
              this.agents.treat(i);
              this.agents.sickUntilTick[i] = 0;
              healed++;
            }
          }
          this.addLog(`The healer treats ${healed} settler${healed > 1 ? 's' : ''} — colony health restored.`, 'good');
        } else {
          this.addLog('The healer tips their hat and continues down the road.', 'info');
        }
        break;
      }
    }
    return true;
  }

  // ── research ──────────────────────────────────────────────────────────────────

  /**
   * Spend accumulated research points to unlock a tech.
   * Returns true if the tech was successfully researched, false if prereqs are
   * missing, already researched, or not enough points.  Logs the event.
   */
  research(techId: string): boolean {
    const ok = this.researchBook.research(techId);
    if (ok) {
      this.addLog(`Research complete: ${techId}`, 'good');
      this.prestige++;
    }
    return ok;
  }

  /**
   * Check whether the colony has advanced to a new era (called daily).
   * Era 1→2: iron_smelting + blacksmithing techs + tools/iron stockpile threshold.
   * Future eras (3, 4) will be wired in when the coal/electrification content lands.
   */
  private checkEraTransition(): void {
    if (this.era === 1 &&
      this.researchBook.hasTech('iron_smelting') &&
      this.researchBook.hasTech('blacksmithing') &&
      this.stock.count('tools') >= TUNING.era2ToolsRequired &&
      this.stock.count('iron') >= TUNING.era2IronRequired
    ) {
      this.era = 2;
      this.prestige += 5; // era transitions are a major milestone
      this.addLog('The Industrial Era begins — iron and tools transform the colony. New buildings and techs are now available.', 'good');
    }
  }

  // ── read-only views ──────────────────────────────────────────────────────────

  /**
   * Total non-food goods the colony can warehouse before overflow spoils
   * (Songs-of-Syx colony model). Scales with population (a bigger settlement
   * keeps more under roof) + built storage capacity (shelves/crates). Food has
   * its own freshness cap (mealCap) so the storage limit never starves anyone.
   * (Region/nation tier uses a Victoria-3 flow model — no stockpile caps.)
   */
  storageCap(): number {
    return STORAGE_BASE + this.population * STORAGE_PER_POP + this.services().storage;
  }

  /** Max meals the larder holds before spoilage (base + storehouse rooms). */
  mealCap(): number {
    let cap = TUNING.mealCapBase;
    for (const room of this.grid.rooms) {
      if (ROOM_DEF_BY_NUM[room.typeId]?.id === 'storehouse' && room.stationIds.length > 0)
        cap += TUNING.mealCapPerGranary;
    }
    return cap;
  }

  get population(): number {
    return this.agents.count;
  }

  services(): RoomServices {
    return aggregateCapacities(this.grid);
  }

  /**
   * 7-day average net daily flow of a resource (positive = net production,
   * negative = net consumption). Returns 0 if fewer than 2 snapshots exist.
   * Mirrors `Simulation.netFlow()` for HUD sparkline compatibility.
   */
  netFlow(kind: ResourceKind): number {
    const hist = this._stockHistory.get(kind);
    if (!hist || hist.length < 2) return 0;
    const days = Math.min(7, hist.length - 1);
    return (hist[0] - hist[days]) / days;
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
   *
   * `side` distinguishes sell (+10% revenue when trade-focused) from buy (−10% cost).
   */
  private priceMult(mod: number, side: 'sell' | 'buy' = 'buy'): number {
    const tradeMult = this.focus === 'trade' ? (side === 'sell' ? 1.10 : 0.90) : 1.0;
    return Math.max(0.5, Math.min(2.0, mod)) * (1 + this.inflation) * tradeMult;
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
      revenue += base * this.priceMult(mod, 'sell');
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
      cost += base * this.priceMult(mod, 'buy');
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

  // ── trade orders ──────────────────────────────────────────────────────────────

  /**
   * Register a standing trade order. Returns the assigned id.
   *
   * Periodic orders fire every `periodDays` days — useful for regular supply
   * top-ups or selling surplus on a schedule. Threshold orders fire when the
   * resource stock crosses a boundary: a sell order fires when stock exceeds
   * `thresholdMax`; a buy order fires when stock falls below `thresholdMin`.
   */
  addTradeOrder(order: Omit<TradeOrder, 'id'>): number {
    const id = this._nextOrderId++;
    this.tradeOrders.push({ ...order, id });
    return id;
  }

  /** Remove a standing order by id. Returns true if found and removed. */
  cancelTradeOrder(id: number): boolean {
    const k = this.tradeOrders.findIndex((o) => o.id === id);
    if (k < 0) return false;
    this.tradeOrders.splice(k, 1);
    return true;
  }

  /** Clear the trade history log. */
  clearTradeHistory(): void {
    this.tradeHistory.length = 0;
  }

  /**
   * Execute all standing trade orders that are due today (called from dailyUpdate).
   * Threshold orders run whenever the condition is satisfied; periodic orders respect
   * their `periodDays` cadence. Records each successful execution in `tradeHistory`.
   */
  private processTradeOrders(): void {
    for (const order of this.tradeOrders) {
      if (!order.enabled) continue;
      let shouldFire = false;

      if (order.trigger === 'periodic') {
        const period = order.periodDays ?? 1;
        const lastFired = order.lastFiredDay ?? -Infinity;
        shouldFire = this.day - lastFired >= period;
      } else {
        // threshold
        const stock = this.stock.count(order.resource);
        if (order.kind === 'sell' && order.thresholdMax !== undefined) {
          shouldFire = stock > order.thresholdMax;
        } else if (order.kind === 'buy' && order.thresholdMin !== undefined) {
          shouldFire = stock < order.thresholdMin;
        }
      }

      if (!shouldFire) continue;

      let executed = false;
      if (order.kind === 'sell') {
        const revenue = this.sellToMarket(order.resource, order.quantity);
        executed = revenue > 0;
      } else {
        executed = this.buyFromMarket(order.resource, order.quantity);
      }

      if (executed) {
        order.lastFiredDay = this.day;
        const rec: TradeRecord = { day: this.day, kind: order.kind, resource: order.resource, quantity: order.quantity, auto: true };
        this.tradeHistory.push(rec);
        if (this.tradeHistory.length > 100) this.tradeHistory.shift();
      }
    }
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
      owned: this._owned ? [...this._owned] : undefined,
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
      nextEventDay: this.nextEventDay,
      lastSeasonIdx: this._lastSeasonIdx,
      unburiedCount: this.unburiedCount > 0 ? this.unburiedCount : undefined,
      pendingChoice: this.pendingChoice ?? undefined,
      prestige: this.prestige > 0 ? this.prestige : undefined,
      era: this.era > 1 ? this.era : undefined,
      tradeOrders: this.tradeOrders.length > 0 ? this.tradeOrders : undefined,
      tradeHistory: this.tradeHistory.length > 0 ? this.tradeHistory : undefined,
      nextOrderId: this._nextOrderId > 1 ? this._nextOrderId : undefined,
      townName: this.townName !== 'New Settlement' ? this.townName : undefined,
      focus: this.focus !== 'balanced' ? this.focus : undefined,
      difficulty: this.difficulty !== 'normal' ? this.difficulty : undefined,
      deer: this.deer.length > 0 ? this.deer.map((d) => ({ ...d })) : undefined,
      deerNextId: this._deerNextId > 1 ? this._deerNextId : undefined,
      deerRngState: this._deerRng.getState(),
      clothingDay: this._clothingDay > 0 ? this._clothingDay : undefined,
      festivalCooldown: this._festivalCooldown > 0 ? this._festivalCooldown : undefined,
      lastPopMilestone: this._lastPopMilestone > 0 ? this._lastPopMilestone : undefined,
      stockHistory: this._stockHistory.size > 0 ? Object.fromEntries(this._stockHistory) : undefined,
      droughtActive: this._droughtActive || undefined,
      floodActive: this._floodActive || undefined,
      lastPrestigeMilestone: this._lastPrestigeMilestone > 0 ? this._lastPrestigeMilestone : undefined,
      lastYearReport: this.lastYearReport ?? undefined,
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
    if (data.owned) (core as unknown as { _owned: Set<string> | null })._owned = new Set(data.owned);
    core.rng.setState(data.rngState);
    core.tickNo = data.tickNo;
    core.minute = data.minute;
    core.day = data.day;
    core.gold = data.gold ?? 0;
    core.homeX = data.homeX;
    core.homeY = data.homeY;
    core.deaths = data.deaths ?? 0;
    core.births = data.births ?? 0;
    core.unburiedCount = data.unburiedCount ?? 0;
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
    // v8+: restore the random-event schedule and season tracker (old saves: default values).
    if (data.nextEventDay != null) core.nextEventDay = data.nextEventDay;
    // Restore _lastSeasonIdx to avoid re-logging the current season on load.
    (core as unknown as { _lastSeasonIdx: number })._lastSeasonIdx =
      data.lastSeasonIdx ?? Math.floor((core.day % DAYS_PER_YEAR) / DAYS_PER_SEASON);
    // v8+: restore any pending player-choice (old saves had no pending events).
    core.pendingChoice = data.pendingChoice ?? null;
    core.prestige = data.prestige ?? 0;
    core.era = data.era ?? 1;
    if (data.tradeOrders) core.tradeOrders.push(...data.tradeOrders);
    if (data.tradeHistory) core.tradeHistory.push(...data.tradeHistory);
    (core as unknown as { _nextOrderId: number })._nextOrderId = data.nextOrderId ?? 1;
    core.townName = data.townName ?? 'New Settlement';
    core.focus = data.focus ?? 'balanced';
    core.difficulty = data.difficulty ?? 'normal';
    if (data.deer) { core.deer = data.deer.map((d) => ({ ...d })); }
    (core as unknown as { _deerNextId: number })._deerNextId = data.deerNextId ?? 1;
    if (data.deerRngState != null) (core as unknown as { _deerRng: Rng })._deerRng.setState(data.deerRngState);
    // v9+: restore clothing/festival/milestone state so they don't double-fire on load.
    if (data.clothingDay != null) (core as unknown as { _clothingDay: number })._clothingDay = data.clothingDay;
    if (data.festivalCooldown != null) (core as unknown as { _festivalCooldown: number })._festivalCooldown = data.festivalCooldown;
    if (data.lastPopMilestone != null) (core as unknown as { _lastPopMilestone: number })._lastPopMilestone = data.lastPopMilestone;
    // v9+: restore 7-day stock history so net-flow display is live immediately post-load.
    if (data.stockHistory) {
      const hist = (core as unknown as { _stockHistory: Map<string, number[]> })._stockHistory;
      for (const [k, arr] of Object.entries(data.stockHistory)) hist.set(k, arr);
    }
    // v9+: restore drought/flood active flags so season-transition logs don't re-fire.
    if (data.droughtActive) (core as unknown as { _droughtActive: boolean })._droughtActive = true;
    if (data.floodActive) (core as unknown as { _floodActive: boolean })._floodActive = true;
    if (data.lastPrestigeMilestone != null) (core as unknown as { _lastPrestigeMilestone: number })._lastPrestigeMilestone = data.lastPrestigeMilestone;
    // v11+: restore the last year's ledger summary so the economy panel shows it immediately.
    if (data.lastYearReport != null) core.lastYearReport = data.lastYearReport;
    // Seed the stock snapshot so the first day's delta is relative to the loaded state.
    (core as unknown as { _prevDayStock: Float32Array })._prevDayStock.set(core.stock.buf);
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
