import { Rng } from './rng';
import { World, MAP_W, MAP_H } from './world';
import type { Vec } from './world';
import { RegionMap } from './worldgen';
import type { TownSite } from './worldgen';
import { Weather } from './weather';
import type { DayWeather } from './weather';
import {
  BUILDING_DEFS, buildingDef, traitDef, FIRST_NAMES, LAST_NAMES, TRAIT_DEFS,
  MINUTES_PER_TICK, MINUTES_PER_DAY, DAYS_PER_SEASON, DAYS_PER_YEAR, SEASONS, START_YEAR,
  TUNING, WORK_KINDS,
} from './defs';
import type { ResourceKind, WorkKind } from './defs';

export interface Needs {
  food: number;
  rest: number;
  warmth: number;
  recreation: number;
  social: number;
}

export interface Thought {
  label: string;
  delta: number;
  expiresAt: number; // absolute minute
}

export type SettlerState =
  | 'idle' | 'moving' | 'working' | 'sleeping' | 'eating' | 'warming' | 'recreating' | 'breakdown'
  | 'fighting' | 'fleeing';

export interface Task {
  kind: WorkKind;
  /** tile target for chop/farm; building id for build/cook; item id for haul */
  x: number;
  y: number;
  buildingId?: number;
  itemId?: number;
  patientId?: number;
  roadTile?: boolean;
  wallTile?: boolean;
  gateTile?: boolean;
  /** hunt: the animal being stalked */
  animalId?: number;
  workLeft: number;
  label: string;
}

export interface Wound {
  at: number; // minute inflicted
  untreated: boolean;
  infectionRolled: boolean;
}

export interface Raider {
  id: number;
  pos: Vec;
  path: Vec[];
  health: number;
  combat: number;
  state: 'attack' | 'flee';
  repathAt: number;
}

export type AnimalKind = 'deer' | 'wolf';

export interface Animal {
  id: number;
  kind: AnimalKind;
  pos: Vec;
  path: Vec[];
  health: number;
  /** wolves head home past this minute (deer never leave) */
  leaveAt: number;
  repathAt: number;
}

export interface Settler {
  id: number;
  name: string;
  age: number;
  traits: string[];
  skills: Record<WorkKind, number>;
  priorities: Record<WorkKind, number>; // 0 = off, 3 = highest
  combat: number; // 0–10, separate from work skills
  needs: Needs;
  mood: number;
  health: number;
  wound: Wound | null;
  infection: boolean;
  sickUntil: number; // minute; > now means feverish
  thoughts: Thought[];
  pos: Vec; // tile coords, fractional while moving
  path: Vec[];
  state: SettlerState;
  task: Task | null;
  stateUntil: number; // minute when timed states end
  carrying: { kind: ResourceKind; qty: number } | null;
  bedId: number | null;
  clothedUntil: number; // minute their clothes wear out; 0 = threadbare
  /** carries a spear: hits harder in melee (grabbed from stores when raids land) */
  armed: boolean;
}

export interface Corpse {
  id: number;
  name: string;
  x: number;
  y: number;
  diedAt: number; // minute
}

export interface Grave {
  id: number;
  name: string;
  x: number;
  y: number;
}

export interface Building {
  id: number;
  defId: string;
  x: number;
  y: number;
  built: boolean;
  delivered: number; // wood delivered toward cost
  buildLeft: number; // work minutes remaining
  cookProgress: number;
  hp: number; // only meaningful for defs with maxHp
  level: number; // 1-indexed upgrade level
  rotation: number; // 0-3 clockwise 90° turns
  workerLimit: number | null; // null = auto-assign
}

export interface GroundItem {
  id: number;
  kind: ResourceKind;
  qty: number;
  x: number;
  y: number;
  reservedBy: number | null;
}

export interface LogEntry {
  day: number;
  text: string;
  kind: 'info' | 'good' | 'bad';
}

const SETTLER_SPEED = 0.45; // tiles per game-minute
const INDOOR_BONUS_C = 14;
const SEASON_BASE_C = [10, 22, 8, -8];

export class Simulation {
  rng: Rng;
  world: World;
  regionMap: RegionMap;
  site: TownSite;
  weather: Weather;
  minute = 0;
  settlers: Settler[] = [];
  buildings: Building[] = [];
  items: GroundItem[] = [];
  corpses: Corpse[] = [];
  graves: Grave[] = [];
  stock: Record<ResourceKind, number> = { wood: 80, grain: 60, meal: 160, stone: 0, clothes: 0 };
  /** transits per tile for the traffic overlay; decays daily */
  traffic = new Float32Array(MAP_W * MAP_H);
  log: LogEntry[] = [];
  gameOver = false;
  coldSnapUntil = -1;
  raiders: Raider[] = [];
  raidActive = false;
  animals: Animal[] = [];
  private droughtActive = false;
  private lastFloodDay = -99;
  /** pairwise relationship scores, keyed "lowId:highId" */
  opinions = new Map<string, number>();
  private raidUntil = 0;
  private nextRaidDay: number;
  private nextId = 1;
  private nextEventDay: number;
  private reserved = new Set<string>(); // task target keys

  readonly seed: number;

  constructor(seed: number) {
    this.seed = seed;
    this.rng = new Rng(seed);
    // The world precedes the colony: one seeded region, and the best
    // river-valley cell in it is where the wagon stops (GDD: terrain first).
    this.regionMap = new RegionMap(seed);
    this.site = this.regionMap.startSite();
    this.weather = new Weather(seed);
    this.world = new World(this.rng, this.site);
    this.nextEventDay = 4 + this.rng.int(3);
    this.nextRaidDay = TUNING.firstRaidDay + this.rng.int(5);
    this.foundColony();
    // The woods were never empty: game animals range the map from day one.
    for (let i = 0; i < TUNING.deerStartCount; i++) this.spawnDeer();
  }

  weatherToday(): DayWeather {
    return this.weather.forDay(this.day);
  }

  // ---- time ----
  get day(): number {
    return Math.floor(this.minute / MINUTES_PER_DAY);
  }
  get minuteOfDay(): number {
    return this.minute % MINUTES_PER_DAY;
  }
  get hour(): number {
    return this.minuteOfDay / 60;
  }
  get seasonIndex(): number {
    return Math.floor((this.day % DAYS_PER_YEAR) / DAYS_PER_SEASON);
  }
  get season(): string {
    return SEASONS[this.seasonIndex];
  }
  get year(): number {
    return START_YEAR + Math.floor(this.day / DAYS_PER_YEAR);
  }
  get dateLabel(): string {
    const dayOfSeason = (this.day % DAYS_PER_YEAR) % DAYS_PER_SEASON + 1;
    return `${this.season} ${dayOfSeason}, ${this.year}`;
  }
  get growingSeason(): boolean {
    return this.seasonIndex < 3; // crops die in winter
  }

  /** Outdoor temperature in °C: season base + diurnal swing + weather + cold snaps. */
  temperature(): number {
    const diurnal = -6 * Math.cos(((this.hour - 14) / 24) * Math.PI * 2) - 2;
    const snap = this.minute < this.coldSnapUntil ? -10 : 0;
    return SEASON_BASE_C[this.seasonIndex] + diurnal + snap + this.weatherToday().tempAnomalyC;
  }

  avgMood(): number {
    if (this.settlers.length === 0) return 0;
    return this.settlers.reduce((s, p) => s + p.mood, 0) / this.settlers.length;
  }

  /** Soft-ceiling penalties on town #1 (GDD §2.3). */
  softCapWorkMult(): number {
    const over = Math.max(0, this.settlers.length - TUNING.softCapPop);
    return Math.max(0.4, 1 - over * TUNING.softCapWorkPenaltyPer);
  }
  softCapMoodPenalty(): number {
    const over = Math.max(0, this.settlers.length - TUNING.softCapPop);
    return Math.floor(over / 10) * TUNING.softCapMoodPenaltyPer10;
  }

  // ---- setup ----
  private foundColony(): void {
    const cx = Math.floor(MAP_W / 2);
    const cy = Math.floor(MAP_H / 2);
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 3; dx++) {
        this.planZone('stockpile', cx - 1 + dx, cy - 1 + dy);
      }
    }
    this.placeBuilding('house', cx - 5, cy - 2, 0, true);
    this.placeBuilding('house', cx + 3, cy - 2, 0, true);
    for (let i = 0; i < 12; i++) {
      this.spawnSettler(cx - 3 + (i % 6), cy + 3 + Math.floor(i / 6));
    }
    this.world.revealAround(cx, cy, 10);
    this.addLog('Twelve settlers step off the wagon. Spring, 1900.', 'info');
  }

  spawnSettler(x: number, y: number): Settler {
    const first = FIRST_NAMES[this.rng.int(FIRST_NAMES.length)];
    const last = LAST_NAMES[this.rng.int(LAST_NAMES.length)];
    const traits: string[] = [];
    while (traits.length < 2) {
      const t = this.rng.pick(TRAIT_DEFS).id;
      if (!traits.includes(t)) traits.push(t);
    }
    const skills = {} as Record<WorkKind, number>;
    const priorities = {} as Record<WorkKind, number>;
    for (const k of WORK_KINDS) {
      skills[k] = this.rng.int(8);
      priorities[k] = 1;
    }
    // Everyone leans into their best skill by default.
    const best = WORK_KINDS.reduce((a, b) => (skills[a] >= skills[b] ? a : b));
    priorities[best] = 3;
    const s: Settler = {
      id: this.nextId++,
      name: `${first} ${last}`,
      age: 18 + this.rng.int(30),
      traits,
      skills,
      priorities,
      combat: this.rng.int(7),
      needs: { food: 80, rest: 80, warmth: 80, recreation: 70, social: 70 },
      mood: 60,
      health: 100,
      wound: null,
      infection: false,
      sickUntil: 0,
      thoughts: [],
      pos: { x, y },
      path: [],
      state: 'idle',
      task: null,
      stateUntil: 0,
      carrying: null,
      bedId: null,
      clothedUntil: 0,
      armed: false,
    };
    this.settlers.push(s);
    return s;
  }

  /** A deer appears on open ground away from the camp (or anywhere wild at the edges). */
  spawnDeer(): Animal | null {
    for (let tries = 0; tries < 40; tries++) {
      const x = this.rng.int(MAP_W);
      const y = this.rng.int(MAP_H);
      const farFromCamp = Math.hypot(x - MAP_W / 2, y - MAP_H / 2) > 14;
      if (!farFromCamp || !this.world.passable(x, y, true)) continue;
      const a: Animal = {
        id: this.nextId++, kind: 'deer', pos: { x, y }, path: [],
        health: TUNING.deerHealth, leaveAt: Number.MAX_SAFE_INTEGER, repathAt: 0,
      };
      this.animals.push(a);
      return a;
    }
    return null;
  }

  /** Wolves slip in from a map edge and prowl for a couple of days. */
  spawnWolfPack(n: number): void {
    const side = this.rng.int(4);
    for (let i = 0; i < n; i++) {
      const along = 4 + this.rng.int(MAP_W - 8);
      const edge: Vec =
        side === 0 ? { x: along, y: 0 } : side === 1 ? { x: along, y: MAP_H - 1 } :
        side === 2 ? { x: 0, y: along } : { x: MAP_W - 1, y: along };
      const spot = this.world.passable(edge.x, edge.y, true) ? edge : this.world.nearestPassable(edge, true);
      if (!spot) continue;
      this.animals.push({
        id: this.nextId++, kind: 'wolf', pos: { ...spot }, path: [],
        health: TUNING.wolfHealth, leaveAt: this.minute + TUNING.wolfStayDays * MINUTES_PER_DAY,
        repathAt: 0,
      });
    }
    if (this.animals.some((a) => a.kind === 'wolf')) {
      this.addLog('Wolves have been sighted at the forest edge. Keep your distance — or hunt them.', 'bad');
    }
  }

  // ---- player verbs ----
  /** Effective width after rotation (odd rotations swap w and h). */
  buildingW(b: Building): number {
    const def = buildingDef(b.defId);
    return (b.rotation ?? 0) % 2 === 1 ? def.h : def.w;
  }

  /** Effective height after rotation (odd rotations swap w and h). */
  buildingH(b: Building): number {
    const def = buildingDef(b.defId);
    return (b.rotation ?? 0) % 2 === 1 ? def.w : def.h;
  }

  /** Capacity adjusted by upgrade level. */
  buildingEffectiveCapacity(b: Building): number {
    const def = buildingDef(b.defId);
    let cap = def.capacity ?? 0;
    if (def.upgrades) {
      for (let i = 0; i < (b.level ?? 1) - 1 && i < def.upgrades.length; i++) {
        cap += def.upgrades[i].capacityBonus ?? 0;
      }
    }
    return cap;
  }

  canPlace(defId: string, x: number, y: number, rotation = 0): boolean {
    const def = buildingDef(defId);
    const w = rotation % 2 === 1 ? def.h : def.w;
    const h = rotation % 2 === 1 ? def.w : def.h;
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        if (!this.world.inBounds(x + dx, y + dy)) return false;
        const t = this.world.at(x + dx, y + dy);
        if (t.kind !== 'grass' || t.buildingId !== null || t.wall || t.wallPlan ||
            t.gate || t.gatePlan || t.farmZone || t.stockpileZone) return false;
      }
    }
    return true;
  }

  placeBuilding(defId: string, x: number, y: number, rotationOrPrebuilt: number | boolean = 0, prebuilt = false): Building | null {
    let rotation: number;
    if (typeof rotationOrPrebuilt === 'boolean') {
      prebuilt = rotationOrPrebuilt;
      rotation = 0;
    } else {
      rotation = rotationOrPrebuilt;
    }
    if (!this.canPlace(defId, x, y, rotation)) return null;
    const def = buildingDef(defId);
    const w = rotation % 2 === 1 ? def.h : def.w;
    const h = rotation % 2 === 1 ? def.w : def.h;
    const b: Building = {
      id: this.nextId++,
      defId,
      x,
      y,
      built: prebuilt,
      delivered: prebuilt ? (def.cost.wood ?? 0) : 0,
      buildLeft: prebuilt ? 0 : def.buildWork,
      cookProgress: 0,
      hp: def.maxHp ?? 0,
      level: 1,
      rotation,
      workerLimit: null,
    };
    this.buildings.push(b);
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const t = this.world.at(x + dx, y + dy);
        t.buildingId = b.id;
      }
    }
    return b;
  }

  cancelBuilding(id: number): void {
    const i = this.buildings.findIndex((b) => b.id === id && !b.built);
    if (i < 0) return;
    const b = this.buildings[i];
    this.stock.wood += b.delivered;
    const w = this.buildingW(b);
    const h = this.buildingH(b);
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const t = this.world.at(b.x + dx, b.y + dy);
        t.buildingId = null;
        if (t.kind === 'soil') t.kind = 'grass';
      }
    }
    this.buildings.splice(i, 1);
  }

  destroyBuilding(id: number): void {
    const b = this.buildings.find((x) => x.id === id && x.built);
    if (!b) return;
    const def = buildingDef(b.defId);
    // Refund half the base wood cost
    this.stock.wood += Math.floor((def.cost.wood ?? 0) / 2);
    const w = this.buildingW(b);
    const h = this.buildingH(b);
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        this.world.at(b.x + dx, b.y + dy).buildingId = null;
      }
    }
    for (const s of this.settlers) {
      if (s.bedId === id) s.bedId = null;
    }
    this.buildings = this.buildings.filter((x) => x.id !== id);
    this.addLog(`${def.name} demolished; recovered ${Math.floor((def.cost.wood ?? 0) / 2)} wood.`, 'info');
  }

  upgradeBuilding(id: number): boolean {
    const b = this.buildings.find((x) => x.id === id && x.built);
    if (!b) return false;
    const def = buildingDef(b.defId);
    if (!def.upgrades) return false;
    const lvl = b.level ?? 1;
    const upgrade = def.upgrades[lvl - 1];
    if (!upgrade) return false;
    for (const [res, amt] of Object.entries(upgrade.cost)) {
      if ((this.stock[res as keyof typeof this.stock] ?? 0) < (amt as number)) return false;
    }
    for (const [res, amt] of Object.entries(upgrade.cost)) {
      (this.stock as Record<string, number>)[res] -= amt as number;
    }
    b.level = lvl + 1;
    this.addLog(`${def.name} upgraded to level ${b.level}!`, 'good');
    return true;
  }

  /** Mark trees for felling or rock for quarrying with the same tool. */
  markTree(x: number, y: number): void {
    if (!this.world.inBounds(x, y)) return;
    const t = this.world.at(x, y);
    if (t.kind === 'tree' || t.kind === 'rock') t.marked = !t.marked;
  }

  /** Plan (or unplan) a road tile. Bridges go on water; surfaces on open land. */
  planRoad(kind: import('./world').RoadKind, x: number, y: number): boolean {
    if (!this.world.inBounds(x, y)) return false;
    const t = this.world.at(x, y);
    if (t.roadPlan === kind) {
      t.roadPlan = null; // toggle off
      return true;
    }
    if (t.road === kind || t.wall || t.wallPlan || t.gate || t.gatePlan || t.buildingId !== null) return false;
    if (kind === 'bridge') {
      if (t.kind !== 'water') return false;
    } else if (t.kind !== 'grass' && t.kind !== 'soil') {
      return false;
    }
    t.roadPlan = kind;
    return true;
  }

  /** Paint a zone tile: farm, stockpile, or wall. Toggle on/off by painting the same kind twice. */
  planZone(kind: import('./world').ZoneKind, x: number, y: number): boolean {
    if (!this.world.inBounds(x, y)) return false;
    const t = this.world.at(x, y);
    if (kind === 'farm') {
      if (t.farmZone) {
        t.farmZone = false;
        if (!t.sown && t.growth === 0) t.kind = 'grass';
        return true;
      }
      if (t.kind === 'water' || t.kind === 'rock' || t.kind === 'tree') return false;
      if (t.buildingId !== null || t.wall || t.wallPlan || t.gate || t.gatePlan) return false;
      t.farmZone = true;
      t.kind = 'soil';
      t.stockpileZone = false;
      return true;
    } else if (kind === 'stockpile') {
      if (t.stockpileZone) {
        t.stockpileZone = false;
        return true;
      }
      if (t.kind === 'water' || t.kind === 'rock' || t.kind === 'tree') return false;
      if (t.buildingId !== null || t.wall || t.wallPlan || t.gate || t.gatePlan) return false;
      t.stockpileZone = true;
      t.farmZone = false;
      return true;
    } else if (kind === 'wall') {
      if (t.wallPlan) {
        t.wallPlan = false;
        return true;
      }
      if (t.kind === 'water' || t.buildingId !== null || t.wall || t.gate || t.gatePlan) return false;
      t.wallPlan = true;
      return true;
    } else if (kind === 'gate') {
      if (t.gatePlan) {
        t.gatePlan = false;
        return true;
      }
      if (t.kind === 'water' || t.kind === 'rock' || t.kind === 'tree') return false;
      if (t.buildingId !== null || t.wall || t.wallPlan || t.gate) return false;
      t.gatePlan = true;
      return true;
    }
    return false;
  }

  /** Right-click to cancel zone plans or clear zone designations; demolish walls instantly. */
  bulldozeTile(x: number, y: number): void {
    if (!this.world.inBounds(x, y)) return;
    const t = this.world.at(x, y);
    if (t.roadPlan) {
      t.roadPlan = null;
      return;
    }
    if (t.wallPlan) {
      t.wallPlan = false;
      return;
    }
    if (t.gatePlan) {
      t.gatePlan = false;
      return;
    }
    if (t.sapling) {
      t.sapling = false;
      t.growth = 0;
      return;
    }
    if (t.farmZone && !t.sown && t.growth === 0) {
      t.farmZone = false;
      t.kind = 'grass';
      return;
    }
    if (t.stockpileZone) {
      t.stockpileZone = false;
      return;
    }
    if (t.farmZone) {
      t.farmZone = false;
      return;
    }
    if (t.wall) {
      t.wall = false;
      t.wallHp = 0;
      return;
    }
    if (t.gate) {
      t.gate = false;
      t.wallHp = 0;
      return;
    }
  }

  /** Barter at a built market (HUD panel): fixed rates, lossy round-trip. */
  trade(give: ResourceKind, get: ResourceKind, times = 1): boolean {
    if (this.builtOf('trade').length === 0) return false;
    const rate = TUNING.tradeRates[`${give}->${get}`];
    if (!rate || times < 1) return false;
    if (this.stock[give] < rate.give * times) return false;
    this.stock[give] -= rate.give * times;
    this.stock[get] += rate.get * times;
    return true;
  }

  /** Meals the stores can keep without spoiling (granary level bonuses add capacity). */
  mealCap(): number {
    let cap = TUNING.mealCapBase;
    for (const g of this.builtOf('granary')) {
      cap += TUNING.mealCapPerGranary + this.buildingEffectiveCapacity(g);
    }
    return cap;
  }

  building(id: number | null | undefined): Building | undefined {
    return this.buildings.find((b) => b.id === id);
  }

  builtOf(provides: string): Building[] {
    return this.buildings.filter((b) => b.built && buildingDef(b.defId).provides === provides);
  }

  // ---- the flip trigger (GDD §2.3): outgrow the valley, found town #2 ----
  canFoundSecondTown(): { ok: boolean; reason: string } {
    if (this.settlers.length < 20) return { ok: false, reason: `needs 20 settlers (has ${this.settlers.length})` };
    if (this.stock.wood < 100) return { ok: false, reason: `needs 100 wood (has ${this.stock.wood})` };
    if (this.stock.meal + this.stock.grain < 120) {
      return { ok: false, reason: `needs 120 food (has ${this.stock.meal + this.stock.grain})` };
    }
    if (this.raidActive) return { ok: false, reason: 'not during a raid' };
    return { ok: true, reason: '' };
  }

  /**
   * After the flip the town keeps rendering as a representative diorama
   * (GDD §2.4): sprites wander and animate, but nothing here is
   * authoritative — no needs, no deaths, no stock changes.
   */
  tickDiorama(minute: number): void {
    this.minute = minute;
    for (const s of this.settlers) {
      if (s.path.length > 0) {
        this.step(s);
      } else if (this.rng.chance(0.04)) {
        const tx = Math.round(s.pos.x) + this.rng.int(9) - 4;
        const ty = Math.round(s.pos.y) + this.rng.int(9) - 4;
        if (this.world.passable(tx, ty)) this.setDestination(s, { x: tx, y: ty });
      }
      s.state = this.hour >= 22 || this.hour < 6 ? 'sleeping' : 'idle';
    }
  }

  // ---- main loop ----
  tick(): void {
    if (this.gameOver) return;
    this.minute += MINUTES_PER_TICK;
    const newDay = this.minute % MINUTES_PER_DAY < MINUTES_PER_TICK;
    if (newDay) this.dailyUpdate();
    this.updateFarms();
    this.updateSaplings();
    this.updateRaiders();
    this.updateAnimals();
    for (const s of [...this.settlers]) this.updateSettler(s);
    for (const s of this.settlers) this.world.revealAround(s.pos.x, s.pos.y, 5);
    if (this.settlers.length === 0 && !this.gameOver) {
      this.gameOver = true;
      this.addLog('The colony has perished. (Failure state: depopulation.)', 'bad');
    }
  }

  private dailyUpdate(): void {
    for (let i = 0; i < this.traffic.length; i++) this.traffic[i] *= 0.9; // overlay shows recent flow
    this.updatePopulationFlows();
    // Cooked food keeps only so long; granaries extend the larder. Grain is uncapped.
    const mealCap = this.mealCap();
    if (this.stock.meal > mealCap) {
      const spoiled = this.stock.meal - mealCap;
      this.stock.meal = mealCap;
      this.addLog(`${spoiled} meals spoiled — the stores hold only ${mealCap}. A granary would keep more.`, 'bad');
    }
    if (this.day >= this.nextEventDay) {
      this.fireEvent();
      this.nextEventDay = this.day + 3 + this.rng.int(4);
    }
    if (this.day >= this.nextRaidDay && !this.raidActive) {
      this.startRaid();
      this.nextRaidDay = this.day + TUNING.raidIntervalDays + this.rng.int(5);
    }
    // Wildlife flows: deer drift back into emptied woods; wolf packs pass through.
    const deer = this.animals.filter((a) => a.kind === 'deer').length;
    if (deer < TUNING.deerMaxCount && this.rng.chance(TUNING.deerSpawnChancePerDay)) {
      this.spawnDeer();
    }
    if (this.day >= TUNING.wolfFirstDay && !this.animals.some((a) => a.kind === 'wolf') &&
        this.rng.chance(TUNING.wolfPackChancePerDay)) {
      this.spawnWolfPack(2 + this.rng.int(2));
    }
    // Winter kills the standing crop.
    if (!this.growingSeason) {
      for (const t of this.world.tiles) {
        if (t.kind === 'soil' && (t.sown || t.growth > 0)) {
          t.sown = false;
          t.growth = 0;
        }
      }
    }
    // Weather has consequences (GDD: limitations propagate through the system)
    const drought = this.weather.isDrought(this.day);
    if (drought && !this.droughtActive && this.growingSeason) {
      this.addLog('Drought. The soil cracks and the crops slow to a crawl.', 'bad');
    }
    this.droughtActive = drought;
    if (this.weather.isFloodRisk(this.day) && this.site.river && this.day - this.lastFloodDay > 20) {
      this.lastFloodDay = this.day;
      let drowned = 0;
      for (let y = 0; y < MAP_H; y++) {
        for (let x = 0; x < MAP_W; x++) {
          const t = this.world.at(x, y);
          if (t.kind !== 'soil' || (!t.sown && t.growth === 0)) continue;
          const nearWater = [[-2, 0], [2, 0], [0, -2], [0, 2], [-1, 0], [1, 0], [0, 1], [0, -1]]
            .some(([dx, dy]) => this.world.inBounds(x + dx, y + dy) && this.world.at(x + dx, y + dy).kind === 'water');
          if (nearWater) {
            t.sown = false;
            t.growth = 0;
            drowned++;
          }
        }
      }
      if (drowned > 0) {
        this.addLog(`The river bursts its banks — ${drowned} field tiles drowned.`, 'bad');
      } else {
        this.addLog('The river runs high and brown. Keep the fields back from the banks.', 'info');
      }
    }
  }

  /**
   * Steady immigration plus a slow birth trickle: a colony that can feed
   * people recovers its losses instead of bleeding out (0.1 death-spiral fix).
   */
  private updatePopulationFlows(): void {
    const t = TUNING;
    const pop = this.settlers.length;
    if (pop === 0) return;
    const food = this.stock.meal + this.stock.grain;
    // Immigration: word of a well-fed colony travels; wagons stop when there's no room.
    if (this.day >= t.firstImmigrantDay && pop < t.immigrantStopPop &&
        food >= pop * t.immigrantFoodPerCapita && this.rng.chance(t.immigrantChancePerDay)) {
      const gate = { x: 1, y: Math.floor(MAP_H / 2) };
      const edge = this.world.passable(gate.x, gate.y) ? gate : this.world.nearestPassable(gate);
      if (edge) {
        const s = this.spawnSettler(edge.x, edge.y);
        this.addLog(`${s.name} arrives, drawn by word of a colony that eats well.`, 'good');
      }
    }
    // Births: the colony's youth come of age (children are abstracted at town tier).
    const couples = Math.floor(pop / 2);
    if (pop >= t.birthMinPop && pop < t.hardCapPop && food >= pop * 2 &&
        this.rng.chance(Math.min(0.25, couples * t.birthChancePerCoupleDay))) {
      const home = this.builtOf('sleep')[0];
      const at = home ? this.buildingCenter(home) : { x: Math.floor(MAP_W / 2), y: Math.floor(MAP_H / 2) };
      const s = this.spawnSettler(at.x, at.y);
      s.age = 16;
      for (const k of WORK_KINDS) s.skills[k] = Math.min(s.skills[k], 3); // young and green
      this.addLog(`A child of the colony, ${s.name}, comes of age.`, 'good');
    }
  }

  /** Town-tier incident deck — 12 named events, ~45% bad / 55% good (GDD §3.3). */
  private fireEvent(): void {
    const roll = this.rng.next();
    if      (roll < 0.12) this.evtWanderer();
    else if (roll < 0.21) this.evtColdSnap();
    else if (roll < 0.30) this.evtRats();
    else if (roll < 0.42) this.evtFestival();
    else if (roll < 0.52) this.evtFever();
    else if (roll < 0.62) this.evtBumperHarvest();
    else if (roll < 0.70) this.evtWindfallTimber();
    else if (roll < 0.78) this.evtSkillBreakthrough();
    else if (roll < 0.85) this.evtStormDamage();
    else if (roll < 0.91) this.evtInjuredWorker();
    else if (roll < 0.96) this.evtMerchant();
    else                  this.evtSettlerFeud();
  }

  private evtWanderer(): void {
    if (this.settlers.length >= TUNING.hardCapPop) return;
    if (this.stock.meal + this.stock.grain > this.settlers.length * 2) {
      const s = this.spawnSettler(1, Math.floor(MAP_H / 2));
      this.addLog(`A wanderer, ${s.name}, asks to join the colony. They settle in.`, 'good');
    } else {
      this.addLog('A wanderer eyes the empty stores and moves on.', 'info');
    }
  }

  private evtColdSnap(): void {
    this.coldSnapUntil = this.minute + 3 * MINUTES_PER_DAY;
    this.addLog('A cold snap rolls in from the mountains. Three bitter days.', 'bad');
  }

  private evtRats(): void {
    const lost = Math.ceil(this.stock.grain * 0.1);
    if (lost > 0) {
      this.stock.grain -= lost;
      this.addLog(`Rats in the stores — ${lost} grain lost.`, 'bad');
    }
  }

  private evtFestival(): void {
    for (const s of this.settlers) this.addThought(s, 'Festival night', 8, 2 * MINUTES_PER_DAY);
    this.addLog('The settlers hold an impromptu festival. Spirits lift.', 'good');
  }

  private evtFever(): void {
    const n = 1 + this.rng.int(3);
    const victims = [...this.settlers].sort(() => this.rng.next() - 0.5).slice(0, n);
    for (const v of victims) {
      v.sickUntil = this.minute + (2 + this.rng.int(2)) * MINUTES_PER_DAY;
      this.addThought(v, 'Feverish', -6, v.sickUntil - this.minute);
    }
    this.addLog(`A fever spreads through camp — ${victims.map((v) => v.name.split(' ')[0]).join(', ')} fall ill.`, 'bad');
  }

  /** Extra grain when the colony has been farming. */
  private evtBumperHarvest(): void {
    const farmCount = this.world.tiles.filter((t) => t.farmZone || t.kind === 'soil').length;
    const bonus = 15 + farmCount * 2 + this.rng.int(10);
    this.stock.grain += bonus;
    this.addLog(`The harvest comes in heavy this year — ${bonus} grain added to the stores.`, 'good');
  }

  /** A fallen deadfall near the tree line: free timber. */
  private evtWindfallTimber(): void {
    const logs = 15 + this.rng.int(10);
    this.stock.wood += logs;
    this.addLog(`A deadfall near the tree line yields ${logs} timber — the settlers haul it in.`, 'good');
  }

  /** One settler makes a study breakthrough and improves their best skill. */
  private evtSkillBreakthrough(): void {
    if (this.settlers.length === 0) return;
    const s = this.rng.pick(this.settlers);
    const best = WORK_KINDS.reduce((a, b) => (s.skills[a] >= s.skills[b] ? a : b));
    s.skills[best] = Math.min(10, s.skills[best] + 1 + this.rng.int(2));
    this.addThought(s, 'Breakthrough!', 10, 3 * MINUTES_PER_DAY);
    this.addLog(`${s.name.split(' ')[0]} has been studying hard — their ${best} improves.`, 'good');
  }

  /** Storm batters the camp: food spoils and, if palisade exists, one section takes damage. */
  private evtStormDamage(): void {
    const total = this.stock.meal + this.stock.grain;
    const spoiled = Math.ceil(total * 0.06);
    const fromMeal = Math.min(this.stock.meal, spoiled);
    this.stock.meal -= fromMeal;
    this.stock.grain -= Math.max(0, spoiled - fromMeal);
    // Damage the weakest wall/gate tile if the colony has one.
    let worstIdx = -1;
    let worstHp = Infinity;
    for (let idx = 0; idx < this.world.tiles.length; idx++) {
      const t = this.world.tiles[idx];
      if ((t.wall || t.gate) && t.wallHp > 0 && t.wallHp < worstHp) {
        worstHp = t.wallHp;
        worstIdx = idx;
      }
    }
    if (worstIdx >= 0) {
      this.world.tiles[worstIdx].wallHp = Math.max(0, worstHp - 25);
      this.addLog(`A storm lashes camp — ${spoiled} provisions spoiled and a palisade section took damage.`, 'bad');
    } else {
      this.addLog(`A storm lashes camp overnight — ${spoiled} provisions spoiled in the wet.`, 'bad');
    }
  }

  /** A settler takes a bad fall at work — they need treatment. */
  private evtInjuredWorker(): void {
    const healthy = this.settlers.filter((s) => !s.wound && s.health > 20);
    if (healthy.length === 0) return;
    const s = this.rng.pick(healthy);
    s.wound = { at: this.minute, untreated: true, infectionRolled: false };
    this.addThought(s, 'Hurt at work', -8, 2 * MINUTES_PER_DAY);
    this.addLog(`${s.name.split(' ')[0]} takes a bad fall — they need treatment.`, 'bad');
  }

  /** A merchant passes through: favorable barter at the market, small gift otherwise. */
  private evtMerchant(): void {
    const hasMarket = this.buildings.some((b) => b.built && buildingDef(b.defId).provides === 'trade');
    if (hasMarket) {
      if (this.stock.wood >= 3) {
        this.stock.wood -= 3;
        this.stock.grain += 5;
        this.addLog('A merchant stops at the market — 3 wood trades for 5 grain.', 'good');
      } else if (this.stock.grain >= 5) {
        this.stock.grain -= 5;
        this.stock.meal += 8;
        this.addLog('A merchant mills 5 grain into 8 prepared meals at the market.', 'good');
      } else {
        this.addLog('A merchant calls at the market but the colony has nothing spare to trade.', 'info');
      }
    } else {
      const gift = 3 + this.rng.int(4);
      this.stock.grain += gift;
      this.addLog(`A tinker's cart rolls through at dusk — leaves ${gift} grain for a night's hospitality.`, 'good');
    }
  }

  /** Two settlers feud over a boundary dispute — tempers run hot for a few days. */
  private evtSettlerFeud(): void {
    if (this.settlers.length < 2) return;
    const shuffled = [...this.settlers].sort(() => this.rng.next() - 0.5);
    const a = shuffled[0];
    const b = shuffled[1];
    this.addThought(a, 'Feuding with a neighbour', -5, 4 * MINUTES_PER_DAY);
    this.addThought(b, 'Feuding with a neighbour', -5, 4 * MINUTES_PER_DAY);
    this.addLog(`${a.name.split(' ')[0]} and ${b.name.split(' ')[0]} come to blows over a boundary dispute.`, 'bad');
  }

  /** Colony wealth drives raid size: prosperity attracts trouble (GDD §8.4). */
  wealth(): number {
    const stocks = this.stock.wood * 0.2 + this.stock.grain + this.stock.meal + this.stock.clothes * 2;
    const built = this.buildings.filter((b) => b.built).length;
    return stocks + this.settlers.length * 8 + built * 15;
  }

  /**
   * Raiders mustered today: wealth and time grow the threat, but a dwindling
   * colony is a poor target — raids shrink with the population they prey on.
   */
  raidSize(): number {
    const byWealth = 2 + Math.floor(this.wealth() / TUNING.raidWealthPerRaider);
    const byTime = 2 + Math.floor(Math.max(0, this.day - TUNING.firstRaidDay) / TUNING.raidRampDays);
    const byPop = Math.ceil(this.settlers.length * TUNING.raidPopFactor);
    return Math.max(1, Math.min(TUNING.raidMaxRaiders, byWealth, byTime, byPop));
  }

  /** Public so tests can muster a raid without fast-forwarding to raid day. */
  startRaid(): void {
    const n = this.raidSize();
    const side = this.rng.int(4);
    for (let i = 0; i < n; i++) {
      const along = 4 + this.rng.int(MAP_W - 8);
      const edge: Vec =
        side === 0 ? { x: along, y: 0 } : side === 1 ? { x: along, y: MAP_H - 1 } :
        side === 2 ? { x: 0, y: along } : { x: MAP_W - 1, y: along };
      const spot = this.world.passable(edge.x, edge.y, true) ? edge : this.world.nearestPassable(edge, true);
      if (!spot) continue;
      this.raiders.push({
        id: this.nextId++,
        pos: { ...spot },
        path: [],
        health: TUNING.raiderHealth,
        combat: 1 + this.rng.int(4),
        state: 'attack',
        repathAt: 0,
      });
    }
    this.raidActive = true;
    this.raidUntil = this.minute + TUNING.raidTimeoutHours * 60;
    const dir = ['north', 'south', 'west', 'east'][side];
    this.addLog(`RAID! ${this.raiders.length} raiders approach from the ${dir}!`, 'bad');
  }

  private updateRaiders(): void {
    if (this.raiders.length === 0) {
      if (this.raidActive) {
        this.raidActive = false;
        this.addLog('The raid is over.', 'good');
      }
      return;
    }
    const hours = MINUTES_PER_TICK / 60;
    if (this.minute >= this.raidUntil) {
      for (const r of this.raiders) r.state = 'flee';
    }
    for (const r of [...this.raiders]) {
      if (r.health <= 0) {
        this.raiders = this.raiders.filter((o) => o !== r);
        this.addLog('A raider falls.', 'good');
        continue;
      }
      if (r.state === 'flee') {
        if (r.path.length === 0) {
          const exit = this.world.nearestPassable({ x: r.pos.x < MAP_W / 2 ? 0 : MAP_W - 1, y: Math.round(r.pos.y) }, true);
          const p = exit ? this.world.findPath({ x: Math.round(r.pos.x), y: Math.round(r.pos.y) }, exit, true) : null;
          if (!p || p.length === 0) {
            this.raiders = this.raiders.filter((o) => o !== r);
            continue;
          }
          r.path = p;
        }
        this.stepAgent(r, 0.5);
        if (r.path.length === 0) this.raiders = this.raiders.filter((o) => o !== r);
        continue;
      }
      // Attack: melee any adjacent settler, else advance on the nearest one.
      // Raiders engage whoever stands against them before hunting those who hide.
      const target = this.nearestSettler(r.pos, true) ?? this.nearestSettler(r.pos, false);
      if (!target) {
        r.state = 'flee';
        continue;
      }
      const d = Math.hypot(target.pos.x - r.pos.x, target.pos.y - r.pos.y);
      if (d <= 1.3) {
        this.damageSettler(target, (TUNING.combatDamagePerHour + r.combat * TUNING.combatDamagePerSkill) * hours);
        continue;
      }
      if (r.path.length === 0 || this.minute >= r.repathAt) {
        const p = this.world.findPath(
          { x: Math.round(r.pos.x), y: Math.round(r.pos.y) },
          { x: Math.round(target.pos.x), y: Math.round(target.pos.y) },
          true,
        );
        r.repathAt = this.minute + 60;
        if (p && p.length > 0) {
          r.path = p;
        } else {
          // Walled out: break the nearest palisade or gate.
          const wall = this.nearestBarrier(r.pos);
          if (!wall) {
            r.state = 'flee';
            continue;
          }
          const wd = Math.hypot(wall.x + 0.5 - r.pos.x - 0.5, wall.y + 0.5 - r.pos.y - 0.5);
          if (wd <= 1.4) {
            const wt = this.world.at(wall.x, wall.y);
            wt.wallHp -= TUNING.wallDamagePerHour * hours;
            if (wt.wallHp <= 0) {
              this.addLog(wt.gate ? 'The gate is smashed open by raiders!' : 'Palisade destroyed by raiders!', 'bad');
              wt.wall = false;
              wt.gate = false;
              wt.wallHp = 0;
            }
            continue;
          }
          const wp = this.world.findPath({ x: Math.round(r.pos.x), y: Math.round(r.pos.y) }, { x: wall.x, y: wall.y }, true);
          if (wp) r.path = wp;
          else r.state = 'flee';
          continue;
        }
      }
      this.stepAgent(r, 0.4);
    }
  }

  private nearestSettler(p: Vec, excludeHiding: boolean): Settler | null {
    let best: Settler | null = null;
    let bd = Infinity;
    for (const s of this.settlers) {
      if (excludeHiding && s.state === 'fleeing') continue;
      const d = Math.hypot(s.pos.x - p.x, s.pos.y - p.y);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  /** Nearest standing wall or gate tile — what a walled-out raider bashes. */
  private nearestBarrier(p: Vec): Vec | null {
    let best: Vec | null = null;
    let bd = Infinity;
    for (let idx = 0; idx < this.world.tiles.length; idx++) {
      const t = this.world.tiles[idx];
      if (!t.wall && !t.gate) continue;
      const x = idx % MAP_W;
      const y = Math.floor(idx / MAP_W);
      const d = Math.hypot(x - p.x, y - p.y);
      if (d < bd) { bd = d; best = { x, y }; }
    }
    return best;
  }

  private damageSettler(s: Settler, dmg: number, cause = "a raider's blade"): void {
    s.health -= dmg;
    if (!s.wound) s.wound = { at: this.minute, untreated: true, infectionRolled: false };
    if (s.health <= 0) this.kill(s, cause);
  }

  /** Melee damage a settler deals per hour: base + skill, more with a spear in hand. */
  private settlerDamagePerHour(s: Settler): number {
    return TUNING.combatDamagePerHour + s.combat * TUNING.combatDamagePerSkill +
      (s.armed ? TUNING.spearDamageBonus : 0);
  }

  // ---- wildlife ----
  private updateAnimals(): void {
    const hours = MINUTES_PER_TICK / 60;
    for (const a of [...this.animals]) {
      if (a.health <= 0) {
        this.animals = this.animals.filter((o) => o !== a);
        continue;
      }
      if (a.kind === 'wolf') this.updateWolf(a, hours);
      else this.updateDeer(a);
    }
  }

  private updateWolf(a: Animal, hours: number): void {
    // Mauled or overstayed: head for the treeline and vanish.
    if (a.health < 20 || this.minute >= a.leaveAt) {
      if (a.path.length === 0) {
        const exit = this.world.nearestPassable({ x: a.pos.x < MAP_W / 2 ? 0 : MAP_W - 1, y: Math.round(a.pos.y) }, true);
        const p = exit ? this.world.findPath({ x: Math.round(a.pos.x), y: Math.round(a.pos.y) }, exit, true) : null;
        if (!p || p.length === 0) {
          this.animals = this.animals.filter((o) => o !== a);
          return;
        }
        a.path = p;
      }
      this.stepAgent(a, 0.55);
      if (a.path.length === 0) this.animals = this.animals.filter((o) => o !== a);
      return;
    }
    // Prey: a settler who strayed close, else the nearest deer.
    let prey: { pos: Vec } | null = null;
    let settlerPrey: Settler | null = null;
    let bd = Infinity;
    for (const s of this.settlers) {
      const d = Math.hypot(s.pos.x - a.pos.x, s.pos.y - a.pos.y);
      if (d <= TUNING.wolfAggroRadius && d < bd) { bd = d; settlerPrey = s; prey = s; }
    }
    if (!prey) {
      bd = Infinity;
      for (const o of this.animals) {
        if (o.kind !== 'deer') continue;
        const d = Math.hypot(o.pos.x - a.pos.x, o.pos.y - a.pos.y);
        if (d < bd) { bd = d; prey = o; }
      }
    }
    if (!prey) {
      this.wanderAnimal(a, 0.4);
      return;
    }
    const d = Math.hypot(prey.pos.x - a.pos.x, prey.pos.y - a.pos.y);
    if (d <= 1.3) {
      if (settlerPrey) {
        this.damageSettler(settlerPrey, TUNING.wolfDamagePerHour * hours, 'a wolf attack');
        // The bitten fight back — most wolves regret testing a colonist.
        a.health -= this.settlerDamagePerHour(settlerPrey) * hours;
        if (a.health <= 0) this.addLog(`${settlerPrey.name} fights off a wolf and kills it.`, 'good');
      } else {
        (prey as Animal).health -= TUNING.wolfDamagePerHour * 3 * hours;
      }
      return;
    }
    if (a.path.length === 0 || this.minute >= a.repathAt) {
      a.repathAt = this.minute + 45;
      const p = this.world.findPath(
        { x: Math.round(a.pos.x), y: Math.round(a.pos.y) },
        { x: Math.round(prey.pos.x), y: Math.round(prey.pos.y) },
        true,
      );
      if (p && p.length > 0) a.path = p;
      else { this.wanderAnimal(a, 0.4); return; }
    }
    this.stepAgent(a, 0.55);
  }

  private updateDeer(a: Animal): void {
    // Spooked by anything close — settlers and wolves alike. Hunters work
    // from outside this radius (huntRange > deerFleeRadius by design).
    let threat: Vec | null = null;
    let bd = TUNING.deerFleeRadius;
    for (const s of this.settlers) {
      const d = Math.hypot(s.pos.x - a.pos.x, s.pos.y - a.pos.y);
      if (d < bd) { bd = d; threat = s.pos; }
    }
    for (const o of this.animals) {
      if (o.kind !== 'wolf') continue;
      const d = Math.hypot(o.pos.x - a.pos.x, o.pos.y - a.pos.y);
      if (d < bd) { bd = d; threat = o.pos; }
    }
    if (threat) {
      const dx = a.pos.x - threat.x;
      const dy = a.pos.y - threat.y;
      const len = Math.hypot(dx, dy) || 1;
      const tx = Math.max(0, Math.min(MAP_W - 1, Math.round(a.pos.x + (dx / len) * 6)));
      const ty = Math.max(0, Math.min(MAP_H - 1, Math.round(a.pos.y + (dy / len) * 6)));
      const p = this.world.findPath({ x: Math.round(a.pos.x), y: Math.round(a.pos.y) }, { x: tx, y: ty }, true);
      if (p && p.length > 0) a.path = p;
    }
    if (a.path.length > 0) this.stepAgent(a, 0.45);
    else this.wanderAnimal(a, 0.35);
  }

  private wanderAnimal(a: Animal, speed: number): void {
    if (a.path.length > 0) {
      this.stepAgent(a, speed);
      return;
    }
    if (this.rng.chance(0.03)) {
      const tx = Math.round(a.pos.x) + this.rng.int(9) - 4;
      const ty = Math.round(a.pos.y) + this.rng.int(9) - 4;
      if (this.world.passable(tx, ty, true)) {
        const p = this.world.findPath({ x: Math.round(a.pos.x), y: Math.round(a.pos.y) }, { x: tx, y: ty }, true);
        if (p) a.path = p;
      }
    }
  }

  // ---- settler update ----
  private updateSettler(s: Settler): void {
    const hours = MINUTES_PER_TICK / 60;
    const t = TUNING;
    // Felt temperature: ambient (indoors/hearth aware) plus what you wear.
    const temp = this.effectiveTemp(s) + (s.clothedUntil > this.minute ? t.clothesWarmthC : 0);

    // Anyone threadbare picks up a set from the stores as soon as one exists.
    if (s.clothedUntil <= this.minute && this.stock.clothes > 0) {
      this.stock.clothes--;
      s.clothedUntil = this.minute + t.clothesWearDays * MINUTES_PER_DAY;
      this.addThought(s, 'Warm new clothes', 3, 2 * MINUTES_PER_DAY);
    }

    // Needs decay
    const foodMult = this.traitMult(s, 'foodDecay');
    s.needs.food = Math.max(0, s.needs.food - t.needDecayPerHour.food * foodMult * hours);
    if (s.state !== 'sleeping') {
      s.needs.rest = Math.max(0, s.needs.rest - t.needDecayPerHour.rest * hours);
    }
    if (temp < 12) {
      const sev = Math.min(2, (12 - temp) / 12) * this.traitMult(s, 'warmthDecay');
      s.needs.warmth = Math.max(0, s.needs.warmth - t.needDecayPerHour.warmth * sev * hours);
    } else {
      // Recovery is quick beside a fire or indoors, slow in mild open air.
      const regen = temp >= 16 ? t.warmthRegenWarmPerHour : 5;
      s.needs.warmth = Math.min(100, s.needs.warmth + regen * hours);
    }
    if (s.state !== 'recreating') {
      s.needs.recreation = Math.max(0, s.needs.recreation - t.needDecayPerHour.recreation * hours);
      s.needs.social = Math.max(0, s.needs.social - t.needDecayPerHour.social * hours);
    }

    // Health
    if (s.needs.food <= 0) s.health -= t.starvationHealthPerHour * hours;
    if (s.needs.warmth <= 0) s.health -= t.freezingHealthPerHour * hours;
    if (s.wound?.untreated) {
      s.health -= t.woundBleedPerHour * hours;
      if (this.minute - s.wound.at > t.woundSelfHealHours * 60) {
        s.wound = null; // scarred over on its own
      } else if (!s.wound.infectionRolled && this.minute - s.wound.at > t.infectionWindowHours * 60) {
        s.wound.infectionRolled = true;
        if (this.rng.chance(t.infectionChance)) {
          s.infection = true;
          this.addLog(`${s.name}'s wound has festered — they need treatment.`, 'bad');
        }
      }
    }
    if (s.infection) s.health -= t.infectionHealthPerHour * hours;
    if (s.sickUntil > this.minute) s.health -= t.sickHealthPerHour * hours;
    if (s.needs.food > 30 && s.needs.warmth > 30 && s.health < 100) {
      const cot = this.building(s.bedId);
      const inClinic = s.state === 'sleeping' && cot?.built && buildingDef(cot.defId).provides === 'medical';
      s.health = Math.min(100, s.health + t.healthRegenPerHour * (inClinic ? t.clinicRegenMult : 1) * hours);
    }
    if (s.health <= 0) {
      const cause = s.infection ? 'infection' : s.sickUntil > this.minute ? 'fever'
        : s.wound ? 'their wounds' : s.needs.food <= 0 ? 'starvation' : 'exposure';
      this.kill(s, cause);
      return;
    }

    // Mood
    s.thoughts = s.thoughts.filter((th) => th.expiresAt > this.minute);
    if (this.corpses.length > 0) {
      this.refreshThought(s, 'Unburied dead in the colony', -t.unburiedMoodPenalty, 60);
    }
    const w = t.moodWeights;
    let target =
      s.needs.food * w.food + s.needs.rest * w.rest + s.needs.warmth * w.warmth +
      s.needs.recreation * w.recreation + s.needs.social * w.social;
    for (const id of s.traits) target += traitDef(id).moodBase ?? 0;
    for (const th of s.thoughts) target += th.delta;
    target -= this.softCapMoodPenalty();
    s.mood += (Math.max(0, Math.min(100, target)) - s.mood) * 0.05;

    // Mental break check (GDD §5.1 via brief: (20 − mood) × 1.5% per day)
    if (s.mood < t.mentalBreakMoodThreshold && s.state !== 'breakdown') {
      const pDay = (t.mentalBreakMoodThreshold - s.mood) * t.mentalBreakChancePerPointPerDay;
      if (this.rng.chance(pDay * (MINUTES_PER_TICK / MINUTES_PER_DAY))) {
        this.releaseTask(s);
        s.state = 'breakdown';
        s.stateUntil = this.minute + MINUTES_PER_DAY;
        this.addThought(s, 'Broke down', -6, 2 * MINUTES_PER_DAY);
        this.addLog(`${s.name} has suffered a mental break and wanders the camp.`, 'bad');
      }
    }

    this.act(s, hours);
  }

  private act(s: Settler, hours: number): void {
    const t = TUNING;
    // A raid interrupts everything except an ongoing breakdown.
    if (this.raidActive && !['fighting', 'fleeing', 'breakdown'].includes(s.state)) {
      this.releaseTask(s);
      s.bedId = null;
      if (s.combat >= t.fightMinCombat && s.health > 50) {
        // Fighters grab a spear from the stores on the way out (kept for good).
        if (!s.armed && this.stock.wood >= t.spearWoodCost) {
          this.stock.wood -= t.spearWoodCost;
          s.armed = true;
        }
        s.state = 'fighting';
      } else {
        s.state = 'fleeing';
        const shelter = this.builtOf('sleep')[0] ?? this.builtOf('recreation')[0];
        if (shelter) this.setDestination(s, this.buildingCenter(shelter));
      }
    }
    switch (s.state) {
      case 'fighting': {
        if (!this.raidActive || this.raiders.length === 0) {
          s.state = 'idle';
          return;
        }
        let target: Raider | null = null;
        let bd = Infinity;
        for (const r of this.raiders) {
          const d = Math.hypot(r.pos.x - s.pos.x, r.pos.y - s.pos.y);
          if (d < bd) {
            bd = d;
            target = r;
          }
        }
        if (!target) {
          s.state = 'idle';
          return;
        }
        if (bd <= 1.3) {
          target.health -= this.settlerDamagePerHour(s) * hours;
          s.combat = Math.min(10, s.combat + 0.2 * hours);
          return;
        }
        if (s.path.length === 0) {
          this.setDestination(s, { x: Math.round(target.pos.x), y: Math.round(target.pos.y) });
          if (s.path.length === 0) return; // unreachable (walled apart) — hold position
        }
        this.step(s);
        return;
      }
      case 'fleeing': {
        if (!this.raidActive) {
          s.state = 'idle';
          return;
        }
        if (!this.arrived(s)) this.step(s);
        else if (s.needs.food < 20) this.consumeFood(s); // raids run long; nibble rations while hiding
        return;
      }
      case 'breakdown': {
        if (this.minute >= s.stateUntil) s.state = 'idle';
        else {
          if (s.needs.food < 20) this.consumeFood(s); // even the broken still eat
          this.wander(s);
        }
        return;
      }
      case 'sleeping': {
        if (!this.arrived(s)) return this.step(s); // walk to bed/shelter first
        // Hunger overrides sleep: wake to eat rather than starve in bed.
        if (s.needs.food < 15 && this.stock.meal + this.stock.grain > 0) {
          s.bedId = null;
          s.state = 'idle';
          return;
        }
        const inBed = s.bedId !== null;
        s.needs.rest = Math.min(100, s.needs.rest + (inBed ? t.sleepRestPerHour.bed : t.sleepRestPerHour.ground) * hours);
        // Bed rest: the badly hurt stay down until they're out of danger.
        if (s.health < t.bedRestThreshold) return;
        if (s.needs.rest >= 95 || (this.hour >= 6 && this.hour < 22 && s.needs.rest > 55)) {
          if (!inBed) this.addThought(s, 'Slept on the ground', -6, MINUTES_PER_DAY);
          s.bedId = null;
          s.state = 'idle';
        }
        return;
      }
      case 'eating': {
        if (!this.arrived(s)) return this.step(s);
        this.consumeFood(s);
        s.state = 'idle';
        return;
      }
      case 'warming': {
        if (!this.arrived(s)) return this.step(s);
        // Hunger overrides cold; also bail out if the shelter isn't warming us.
        if (s.needs.warmth >= 60 || s.needs.food < 20 || this.minute >= s.stateUntil) s.state = 'idle';
        return;
      }
      case 'recreating': {
        if (!this.arrived(s)) return this.step(s);
        s.needs.recreation = Math.min(100, s.needs.recreation + t.recreationPerHour * hours);
        s.needs.social = Math.min(100, s.needs.social + t.socialPerHour * hours);
        // Friendships form around the fire (process each pair once, lower id side).
        for (const o of this.settlers) {
          if (o.id <= s.id || o.state !== 'recreating') continue;
          if (Math.hypot(o.pos.x - s.pos.x, o.pos.y - s.pos.y) <= 3) {
            this.bond(s, o, t.bondPerHourTogether * hours);
          }
        }
        if (s.needs.recreation >= 90 || this.minute >= s.stateUntil) s.state = 'idle';
        return;
      }
      case 'moving':
      case 'working': {
        this.runTask(s, hours);
        return;
      }
      case 'idle': {
        this.decide(s);
        return;
      }
    }
  }

  private decide(s: Settler): void {
    const night = this.hour >= 22 || this.hour < 6;
    // Hunger comes before everything — bed rest and sleep used to outrank it,
    // and settlers starved in bed beside a stocked larder (0.1 death-spiral fix).
    if (s.needs.food < 30 && (this.stock.meal > 0 || this.stock.grain > 0)) {
      const spTile = this.nearestStockpileTile(s.pos);
      if (spTile) this.setDestination(s, spTile);
      s.state = 'eating'; // if the walk fails, eat where you stand rather than starve
      return;
    }
    if (s.health < TUNING.bedRestThreshold) return this.goSleep(s); // bed rest
    if (s.needs.rest < 25 || (night && s.needs.rest < 80)) return this.goSleep(s);
    if (s.needs.warmth < 25) {
      const warm = this.nearestWarmSpot(s);
      if (warm) {
        s.state = 'warming';
        s.stateUntil = this.minute + 12 * 60;
        this.setDestination(s, warm);
        return;
      }
    }
    if (!night) {
      const task = this.findTask(s);
      if (task) {
        s.task = task;
        s.state = 'moving';
        this.setDestination(s, { x: task.x, y: task.y });
        return;
      }
    }
    if (s.needs.recreation < 60 || s.needs.social < 50) {
      const hall = this.builtOf('recreation')[0];
      const spTile = this.nearestStockpileTile(s.pos);
      const dest = hall ? this.buildingCenter(hall) : spTile;
      if (dest) {
        s.state = 'recreating';
        s.stateUntil = this.minute + 180;
        this.setDestination(s, dest);
        return;
      }
    }
    this.wander(s);
  }

  // ---- task generation & execution ----
  private findTask(s: Settler): Task | null {
    const candidates: { task: Task; prio: number; dist: number }[] = [];
    const push = (task: Task, kind: WorkKind) => {
      const prio = s.priorities[kind];
      if (prio <= 0 || this.reserved.has(this.taskKey(task))) return;
      const dist = Math.abs(task.x - s.pos.x) + Math.abs(task.y - s.pos.y);
      candidates.push({ task, prio, dist });
    };

    // Haul ground items to the stockpile zone.
    const hasStockpile = this.world.tiles.some((t) => t.stockpileZone);
    if (hasStockpile) {
      for (const it of this.items) {
        if (it.reservedBy === null) {
          push({ kind: 'haul', x: it.x, y: it.y, itemId: it.id, workLeft: 5, label: `haul ${it.kind}` }, 'haul');
        }
      }
    }
    // Deliver wood to blueprints, then build them.
    const spTile = this.nearestStockpileTile({ x: Math.floor(MAP_W / 2), y: Math.floor(MAP_H / 2) });
    for (const b of this.buildings) {
      if (b.built) continue;
      const need = (buildingDef(b.defId).cost.wood ?? 0) - b.delivered;
      if (need > 0 && this.stock.wood > 0 && spTile) {
        push({ kind: 'build', x: spTile.x, y: spTile.y, buildingId: b.id, workLeft: 0, label: `fetch wood for ${buildingDef(b.defId).name}` }, 'build');
      } else if (need <= 0) {
        push({ kind: 'build', x: b.x, y: b.y, buildingId: b.id, workLeft: b.buildLeft, label: `build ${buildingDef(b.defId).name}` }, 'build');
      }
    }
    // Build wall zones.
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const tile = this.world.at(x, y);
        if (tile.wallPlan && !tile.wall) {
          const affordable = (TUNING.wallCost.wood ?? 0) <= this.stock.wood;
          if (affordable) {
            push({ kind: 'build', x, y, workLeft: TUNING.wallWork, label: 'build palisade', wallTile: true }, 'build');
          }
        }
        if (tile.gatePlan && !tile.gate) {
          const affordable = (TUNING.gateCost.wood ?? 0) <= this.stock.wood;
          if (affordable) {
            push({ kind: 'build', x, y, workLeft: TUNING.gateWork, label: 'build gate', gateTile: true }, 'build');
          }
        }
      }
    }
    // Chop marked trees, quarry marked rock, lay planned roads.
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const tile = this.world.at(x, y);
        if (tile.kind === 'tree' && tile.marked) {
          push({ kind: 'chop', x, y, workLeft: TUNING.treeChopWork, label: 'chop tree' }, 'chop');
        } else if (tile.kind === 'rock' && tile.marked) {
          push({ kind: 'chop', x, y, workLeft: TUNING.rockQuarryWork, label: 'quarry stone' }, 'chop');
        }
        if (tile.roadPlan) {
          const cost = TUNING.roadCost[tile.roadPlan];
          const affordable = (cost.wood ?? 0) <= this.stock.wood && (cost.stone ?? 0) <= this.stock.stone;
          if (affordable) {
            push({ kind: 'build', x, y, workLeft: TUNING.roadWork[tile.roadPlan], label: `lay ${tile.roadPlan} road`, roadTile: true }, 'build');
          }
        }
      }
    }
    // Farm: sow bare soil in season, harvest ripe tiles.
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const tile = this.world.at(x, y);
        if (!tile.farmZone) continue;
        if (tile.growth >= 100) {
          push({ kind: 'farm', x, y, workLeft: 10, label: 'harvest grain' }, 'farm');
        } else if (!tile.sown && this.growingSeason) {
          push({ kind: 'farm', x, y, workLeft: 15, label: 'sow grain' }, 'farm');
        }
      }
    }
    // Cook while there is grain and meals are short. A bakery outclasses the
    // cookhouse (faster, bigger batches), so it takes over when built.
    const cookShops = this.builtOf('cook');
    const kitchen = cookShops.find((b) => b.defId === 'bakery') ?? cookShops[0];
    if (kitchen && this.stock.grain > 0 && this.stock.meal < this.settlers.length * 3) {
      const { workPerMeal, batch } = this.cookParams(kitchen);
      push({ kind: 'cook', x: kitchen.x, y: kitchen.y, buildingId: kitchen.id, workLeft: workPerMeal * batch, label: 'cook meals' }, 'cook');
    }
    // Hunting trips: one hunter per lodge (the lodge id reserves the task)
    // heads out while meals run short — food without grain. With game on the
    // map the hunt is real: stalk the nearest animal and bring back the kill.
    // With the woods empty, fall back to an abstract trip from the lodge.
    if (this.stock.meal < this.settlers.length * 3) {
      for (const lodge of this.builtOf('hunt')) {
        const c = this.buildingCenter(lodge);
        let prey: Animal | null = null;
        let bd = Infinity;
        for (const a of this.animals) {
          const d = Math.hypot(a.pos.x - c.x, a.pos.y - c.y);
          if (d < bd) { bd = d; prey = a; }
        }
        if (prey) {
          push({
            kind: 'hunt', x: Math.round(prey.pos.x), y: Math.round(prey.pos.y),
            buildingId: lodge.id, animalId: prey.id,
            workLeft: TUNING.huntTripWork, label: `hunt ${prey.kind}`,
          }, 'hunt');
        } else {
          push({ kind: 'hunt', x: lodge.x, y: lodge.y, buildingId: lodge.id, workLeft: TUNING.huntTripWork, label: 'hunt game' }, 'hunt');
        }
      }
    }
    if (this.stock.meal < this.settlers.length * 3) {
      for (const dock of this.builtOf('fishing')) {
        const c = this.buildingCenter(dock);
        const waterSpot = this.nearestWaterTile(c, TUNING.fishRange);
        if (!waterSpot) continue;
        const fishSpot = this.world.nearestPassable(waterSpot) ?? c;
        push({
          kind: 'fish', x: fishSpot.x, y: fishSpot.y,
          buildingId: dock.id,
          workLeft: TUNING.fishTripWork, label: 'fish',
        }, 'fish');
      }
    }
    // Foresters replant: one sapling order at a time per lodge, on free grass nearby.
    for (const f of this.builtOf('forestry')) {
      const spot = this.saplingSpot(f);
      if (spot) {
        push({ kind: 'plant', x: spot.x, y: spot.y, workLeft: TUNING.plantWork, label: 'plant sapling' }, 'plant');
      }
    }
    // Weave clothes while anyone goes threadbare — but never eat the seed grain.
    const tailorShop = this.builtOf('craft')[0];
    const threadbare = this.settlers.filter((p) => p.clothedUntil <= this.minute).length;
    if (tailorShop && this.stock.clothes < threadbare &&
        this.stock.grain >= TUNING.clothesGrainCost + this.settlers.length) {
      push({ kind: 'craft', x: tailorShop.x, y: tailorShop.y, buildingId: tailorShop.id, workLeft: TUNING.craftWorkPerClothes, label: 'sew clothes' }, 'craft');
    }
    // Lay the dead to rest — needs a burial ground with a free plot; until
    // then the bodies lie in camp and weigh on everyone.
    if (this.graveSite()) {
      for (const c of this.corpses) {
        push({ kind: 'bury', x: c.x, y: c.y, itemId: c.id, workLeft: TUNING.buryWork, label: `bury ${c.name.split(' ')[0]}` }, 'bury');
      }
    }
    // Treat the wounded, infected, and feverish.
    for (const p of this.settlers) {
      if (p.id === s.id) continue;
      if (p.wound?.untreated || p.infection || p.sickUntil > this.minute) {
        push({
          kind: 'medic', x: Math.round(p.pos.x), y: Math.round(p.pos.y), patientId: p.id,
          workLeft: TUNING.treatWork, label: `treat ${p.name.split(' ')[0]}`,
        }, 'medic');
      }
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.prio - a.prio || a.dist - b.dist);
    const chosen = candidates[0].task;
    this.reserved.add(this.taskKey(chosen));
    return chosen;
  }

  private runTask(s: Settler, hours: number): void {
    const task = s.task;
    if (!task) {
      s.state = 'idle';
      return;
    }
    if (s.state === 'moving') {
      // Hunters loose the shot the moment the quarry is in range; walking all
      // the way onto its tile would spook it into an endless chase.
      if (task.kind === 'hunt' && task.animalId !== undefined && !s.carrying) {
        const prey = this.animals.find((a) => a.id === task.animalId);
        if (prey && Math.hypot(prey.pos.x - s.pos.x, prey.pos.y - s.pos.y) <= TUNING.huntRange) {
          s.path = [];
        }
      }
      if (!this.arrived(s)) return this.step(s);
      s.state = 'working';
    }
    const sickMult = s.sickUntil > this.minute ? TUNING.sickWorkMult : 1;
    const sky = this.weatherToday().sky;
    const outdoorWork =
      task.kind === 'farm' || task.kind === 'chop' || task.kind === 'build' || task.kind === 'haul' ||
      task.kind === 'bury' || task.kind === 'hunt' || task.kind === 'plant' || task.kind === 'fish';
    const rainMult = outdoorWork && (sky === 'rain' || sky === 'storm' || sky === 'snow') ? 0.85 : 1;
    const speed =
      (0.5 + s.skills[task.kind] * 0.1) * this.traitMult(s, 'workSpeed') * this.softCapWorkMult() * sickMult * rainMult;
    const work = hours * 60 * speed;
    s.skills[task.kind] = Math.min(10, s.skills[task.kind] + hours * 0.06);

    switch (task.kind) {
      case 'chop': {
        const tile = this.world.at(task.x, task.y);
        if (tile.kind !== 'tree' && tile.kind !== 'rock') return this.finishTask(s);
        task.workLeft -= work;
        if (task.workLeft <= 0) {
          const wasRock = tile.kind === 'rock';
          tile.kind = 'grass';
          tile.marked = false;
          if (wasRock) this.dropItem('stone', TUNING.rockStone, task.x, task.y);
          else this.dropItem('wood', TUNING.treeWood, task.x, task.y);
          this.finishTask(s);
        }
        return;
      }
      case 'farm': {
        const tile = this.world.at(task.x, task.y);
        task.workLeft -= work;
        if (task.workLeft <= 0) {
          if (tile.growth >= 100) {
            tile.growth = 0;
            tile.sown = false;
            this.dropItem('grain', TUNING.farmYieldPerTile, task.x, task.y);
          } else if (this.growingSeason) {
            tile.sown = true;
          }
          this.finishTask(s);
        }
        return;
      }
      case 'haul': {
        const item = this.items.find((i) => i.id === task.itemId);
        if (!s.carrying) {
          if (!item) return this.finishTask(s);
          item.reservedBy = s.id;
          s.carrying = { kind: item.kind, qty: item.qty };
          this.items = this.items.filter((i) => i.id !== item.id);
          const spTile = this.nearestStockpileTile(s.pos);
          if (!spTile) return this.finishTask(s);
          s.state = 'moving';
          this.setDestination(s, spTile);
          return;
        }
        this.stock[s.carrying.kind] += s.carrying.qty;
        s.carrying = null;
        this.finishTask(s);
        return;
      }
      case 'build': {
        // Wall tiles: materials deducted, wall HP set on completion.
        if (task.wallTile) {
          const tile = this.world.at(task.x, task.y);
          if (!tile.wallPlan) return this.finishTask(s);
          task.workLeft -= work;
          if (task.workLeft <= 0) {
            const cost = TUNING.wallCost;
            if ((cost.wood ?? 0) > this.stock.wood) return this.finishTask(s);
            this.stock.wood -= cost.wood ?? 0;
            tile.wall = true;
            tile.wallPlan = false;
            tile.wallHp = TUNING.wallMaxHp;
            this.finishTask(s);
          }
          return;
        }
        // Gate tiles: like walls, but the finished tile stays settler-passable.
        if (task.gateTile) {
          const tile = this.world.at(task.x, task.y);
          if (!tile.gatePlan) return this.finishTask(s);
          task.workLeft -= work;
          if (task.workLeft <= 0) {
            const cost = TUNING.gateCost;
            if ((cost.wood ?? 0) > this.stock.wood) return this.finishTask(s);
            this.stock.wood -= cost.wood ?? 0;
            tile.gate = true;
            tile.gatePlan = false;
            tile.wallHp = TUNING.gateMaxHp;
            this.finishTask(s);
          }
          return;
        }
        // Road tiles: small jobs — materials charged on completion.
        if (task.roadTile) {
          const tile = this.world.at(task.x, task.y);
          const plan = tile.roadPlan;
          if (!plan) return this.finishTask(s);
          task.workLeft -= work;
          if (task.workLeft <= 0) {
            const cost = TUNING.roadCost[plan];
            if ((cost.wood ?? 0) > this.stock.wood || (cost.stone ?? 0) > this.stock.stone) {
              return this.finishTask(s); // materials ran out; replanned later
            }
            this.stock.wood -= cost.wood ?? 0;
            this.stock.stone -= cost.stone ?? 0;
            tile.road = plan;
            tile.roadPlan = null;
            this.finishTask(s);
          }
          return;
        }
        const b = this.building(task.buildingId);
        if (!b || b.built) return this.finishTask(s);
        const def = buildingDef(b.defId);
        const need = (def.cost.wood ?? 0) - b.delivered;
        if (need > 0) {
          if (!s.carrying) {
            // At the stockpile: pick up wood, walk it to the site.
            const take = Math.min(need, 10, this.stock.wood);
            if (take <= 0) return this.finishTask(s);
            this.stock.wood -= take;
            s.carrying = { kind: 'wood', qty: take };
            s.state = 'moving';
            this.setDestination(s, { x: b.x, y: b.y });
            return;
          }
          b.delivered += s.carrying.qty;
          s.carrying = null;
          return this.finishTask(s);
        }
        b.buildLeft -= work;
        if (b.buildLeft <= 0) {
          b.built = true;
          this.addLog(`${def.name} finished.`, 'good');
          this.finishTask(s);
        }
        return;
      }
      case 'medic': {
        const p = this.settlers.find((o) => o.id === task.patientId);
        if (!p || !(p.wound?.untreated || p.infection || p.sickUntil > this.minute)) {
          return this.finishTask(s);
        }
        // Patients move; follow them.
        if (Math.hypot(p.pos.x - s.pos.x, p.pos.y - s.pos.y) > 1.5) {
          s.state = 'moving';
          this.setDestination(s, { x: Math.round(p.pos.x), y: Math.round(p.pos.y) });
          return;
        }
        task.workLeft -= work;
        if (task.workLeft <= 0) {
          if (p.wound) p.wound.untreated = false;
          p.infection = false;
          if (p.sickUntil > this.minute) p.sickUntil = Math.min(p.sickUntil, this.minute + 12 * 60);
          this.addThought(p, 'Tended by a medic', 4, MINUTES_PER_DAY);
          this.finishTask(s);
        }
        return;
      }
      case 'cook': {
        const k = this.building(task.buildingId);
        if (!k?.built || this.stock.grain <= 0) return this.finishTask(s);
        const { workPerMeal } = this.cookParams(k);
        k.cookProgress += work;
        task.workLeft -= work;
        while (k.cookProgress >= workPerMeal && this.stock.grain > 0) {
          k.cookProgress -= workPerMeal;
          this.stock.grain--;
          this.stock.meal++;
        }
        if (task.workLeft <= 0 || this.stock.grain <= 0) this.finishTask(s);
        return;
      }
      case 'hunt': {
        const lodge = this.building(task.buildingId);
        if (!lodge?.built) return this.finishTask(s);
        // Carrying the kill: arrived back at the stockpile, into the larder.
        if (s.carrying) {
          this.stock[s.carrying.kind] += s.carrying.qty;
          s.carrying = null;
          return this.finishTask(s);
        }
        const prey = this.animals.find((a) => a.id === task.animalId);
        if (!prey) {
          // The quarry got away (or was never sighted): an abstract trip
          // from the lodge still feeds the pot.
          task.workLeft -= work;
          if (task.workLeft <= 0) {
            this.stock.meal += TUNING.huntMealYield;
            this.finishTask(s);
          }
          return;
        }
        // Stalk to bow range (outside the flee radius), then work the shot.
        const d = Math.hypot(prey.pos.x - s.pos.x, prey.pos.y - s.pos.y);
        if (d > TUNING.huntRange) {
          s.state = 'moving';
          this.setDestination(s, { x: Math.round(prey.pos.x), y: Math.round(prey.pos.y) });
          return;
        }
        prey.health -= TUNING.huntDamagePerHour * (0.5 + s.skills.hunt * 0.1) * hours;
        if (prey.health <= 0) {
          this.animals = this.animals.filter((a) => a !== prey);
          const qty = prey.kind === 'deer' ? TUNING.huntMealYield : TUNING.wolfMealYield;
          this.addLog(`${s.name} brings down a ${prey.kind}.`, 'good');
          const spTile = this.nearestStockpileTile(s.pos);
          if (!spTile) {
            this.dropItem('meal', qty, Math.round(s.pos.x), Math.round(s.pos.y));
            return this.finishTask(s);
          }
          s.carrying = { kind: 'meal', qty };
          s.state = 'moving';
          this.setDestination(s, spTile);
        }
        return;
      }
      case 'fish': {
        const dock = this.building(task.buildingId);
        if (!dock?.built) return this.finishTask(s);
        if (s.carrying) {
          this.stock[s.carrying.kind] += s.carrying.qty;
          s.carrying = null;
          return this.finishTask(s);
        }
        task.workLeft -= work;
        if (task.workLeft <= 0) {
          const qty = TUNING.fishMealYield;
          const spTile = this.nearestStockpileTile(s.pos);
          if (!spTile) {
            this.stock.meal += qty;
            return this.finishTask(s);
          }
          s.carrying = { kind: 'meal', qty };
          s.state = 'moving';
          this.setDestination(s, spTile);
        }
        return;
      }
      case 'plant': {
        const tile = this.world.at(task.x, task.y);
        if (tile.kind !== 'grass' || tile.sapling || tile.buildingId !== null) return this.finishTask(s);
        task.workLeft -= work;
        if (task.workLeft <= 0) {
          tile.sapling = true;
          tile.growth = 0;
          this.finishTask(s);
        }
        return;
      }
      case 'craft': {
        const shop = this.building(task.buildingId);
        if (!shop?.built || this.stock.grain < TUNING.clothesGrainCost) return this.finishTask(s);
        task.workLeft -= work;
        if (task.workLeft <= 0) {
          this.stock.grain -= TUNING.clothesGrainCost;
          this.stock.clothes++;
          this.finishTask(s);
        }
        return;
      }
      case 'bury': {
        const c = this.corpses.find((o) => o.id === task.itemId);
        if (!c) return this.finishTask(s);
        // Two legs: reach the body where it fell, then dig at the burial ground.
        // The body stays put until the grave is done, so an interrupted burial
        // leaves it (and the grief it causes) in camp.
        if (task.buildingId === undefined) {
          const site = this.graveSite();
          if (!site) return this.finishTask(s); // the yards filled up meanwhile
          task.buildingId = site.yard.id;
          s.state = 'moving';
          this.setDestination(s, site.at);
          return;
        }
        task.workLeft -= work;
        if (task.workLeft <= 0) {
          const site = this.graveSite();
          if (!site) return this.finishTask(s);
          this.corpses = this.corpses.filter((o) => o !== c);
          this.graves.push({ id: this.nextId++, name: c.name, x: site.at.x, y: site.at.y });
          this.addThought(s, `Laid ${c.name.split(' ')[0]} to rest`, 2, MINUTES_PER_DAY);
          this.addLog(`${c.name} was laid to rest in the burial ground.`, 'info');
          this.finishTask(s);
        }
        return;
      }
    }
  }

  /** A bakery cooks faster in bigger batches than the cookhouse. */
  private cookParams(b: Building): { workPerMeal: number; batch: number } {
    return b.defId === 'bakery'
      ? { workPerMeal: TUNING.bakeWorkPerMeal, batch: TUNING.bakeBatch }
      : { workPerMeal: TUNING.cookWorkPerMeal, batch: TUNING.cookBatch };
  }

  /** Nearest free, unreserved grass tile in the forester's range, or null when saturated. */
  private saplingSpot(f: Building): Vec | null {
    const c = this.buildingCenter(f);
    const r = TUNING.foresterRadius;
    let best: Vec | null = null;
    let bd = Infinity;
    for (let y = c.y - r; y <= c.y + r; y++) {
      for (let x = c.x - r; x <= c.x + r; x++) {
        if (!this.world.inBounds(x, y)) continue;
        const t = this.world.at(x, y);
        if (t.kind !== 'grass' || t.sapling || t.buildingId !== null || t.road || t.roadPlan ||
            t.wall || t.wallPlan || t.gate || t.gatePlan || t.farmZone || t.stockpileZone) continue;
        if (this.reserved.has(`plant:${x},${y}`)) continue;
        const d = Math.hypot(x - c.x, y - c.y);
        if (d <= r && d < bd) { bd = d; best = { x, y }; }
      }
    }
    return best;
  }

  private taskKey(t: Task): string {
    return `${t.kind}:${t.buildingId ?? t.itemId ?? t.patientId ?? `${t.x},${t.y}`}`;
  }

  private finishTask(s: Settler): void {
    this.releaseTask(s);
    s.state = 'idle';
  }

  private releaseTask(s: Settler): void {
    if (s.task) this.reserved.delete(this.taskKey(s.task));
    if (s.carrying) {
      this.dropItem(s.carrying.kind, s.carrying.qty, Math.round(s.pos.x), Math.round(s.pos.y));
      s.carrying = null;
    }
    s.task = null;
  }

  // ---- movement ----
  private setDestination(s: Settler, to: Vec): void {
    const from = { x: Math.round(s.pos.x), y: Math.round(s.pos.y) };
    const path = this.world.findPath(from, { x: Math.round(to.x), y: Math.round(to.y) });
    s.path = path ?? [];
    if (path === null) {
      this.releaseTask(s);
      s.state = 'idle';
    }
  }

  private arrived(s: Settler): boolean {
    return s.path.length === 0;
  }

  private step(s: Settler): void {
    this.stepAgent(s, SETTLER_SPEED);
  }

  private stepAgent(a: { pos: Vec; path: Vec[] }, tilesPerMin: number): void {
    const raining = ['rain', 'storm'].includes(this.weatherToday().sky);
    let budget = tilesPerMin * MINUTES_PER_TICK;
    while (budget > 0 && a.path.length > 0) {
      const next = a.path[0];
      // roads speed up the leg toward the next waypoint
      const mult = this.world.speedMult(next.x, next.y, raining);
      const dx = next.x - a.pos.x;
      const dy = next.y - a.pos.y;
      const d = Math.hypot(dx, dy) / mult;
      if (d <= budget) {
        a.pos = { x: next.x, y: next.y };
        a.path.shift();
        budget -= d;
        this.traffic[next.y * MAP_W + next.x] += 1;
      } else {
        const frac = budget / d;
        a.pos = { x: a.pos.x + dx * frac, y: a.pos.y + dy * frac };
        budget = 0;
      }
    }
  }

  private wander(s: Settler): void {
    if (s.path.length > 0) return this.step(s);
    if (this.rng.chance(0.1)) {
      const tx = Math.round(s.pos.x) + this.rng.int(7) - 3;
      const ty = Math.round(s.pos.y) + this.rng.int(7) - 3;
      if (this.world.passable(tx, ty)) this.setDestination(s, { x: tx, y: ty });
    }
  }

  private goSleep(s: Settler): void {
    // The badly hurt take a clinic cot first: supervised rest heals faster.
    if (s.health < TUNING.bedRestThreshold) {
      for (const c of this.builtOf('medical')) {
        const cap = this.buildingEffectiveCapacity(c);
        const used = this.settlers.filter((o) => o.bedId === c.id).length;
        if (used < cap) {
          s.bedId = c.id;
          s.state = 'sleeping';
          this.setDestination(s, this.buildingCenter(c));
          return;
        }
      }
    }
    const houses = this.builtOf('sleep');
    for (const h of houses) {
      const cap = this.buildingEffectiveCapacity(h);
      const used = this.settlers.filter((o) => o.bedId === h.id).length;
      if (used < cap) {
        s.bedId = h.id;
        s.state = 'sleeping';
        this.setDestination(s, this.buildingCenter(h));
        return;
      }
    }
    // No free bed: sleep on the floor of any shelter rather than outdoors.
    s.bedId = null;
    s.state = 'sleeping';
    const shelter = houses[0] ?? this.builtOf('recreation')[0];
    if (shelter) this.setDestination(s, this.buildingCenter(shelter));
  }

  // ---- helpers ----
  private nearestStockpileTile(pos: Vec): Vec | null {
    let best: Vec | null = null;
    let bd = Infinity;
    for (let idx = 0; idx < this.world.tiles.length; idx++) {
      const t = this.world.tiles[idx];
      if (!t.stockpileZone) continue;
      const x = idx % MAP_W;
      const y = Math.floor(idx / MAP_W);
      const d = Math.hypot(x - pos.x, y - pos.y);
      if (d < bd) { bd = d; best = { x, y }; }
    }
    return best;
  }

  private nearestWaterTile(pos: Vec, maxRange: number): Vec | null {
    let best: Vec | null = null;
    let bd = Infinity;
    for (let idx = 0; idx < this.world.tiles.length; idx++) {
      const t = this.world.tiles[idx];
      if (t.kind !== 'water') continue;
      const x = idx % MAP_W;
      const y = Math.floor(idx / MAP_W);
      const d = Math.hypot(x - pos.x, y - pos.y);
      if (d < bd && d <= maxRange) { bd = d; best = { x, y }; }
    }
    return best;
  }

  private effectiveTemp(s: Settler): number {
    const tile = this.world.inBounds(Math.round(s.pos.x), Math.round(s.pos.y))
      ? this.world.at(Math.round(s.pos.x), Math.round(s.pos.y))
      : null;
    const b = this.building(tile?.buildingId);
    const indoors = b?.built && ['sleep', 'cook', 'recreation', 'craft', 'medical', 'trade'].includes(buildingDef(b.defId).provides);
    if (indoors) return Math.max(this.temperature() + INDOOR_BONUS_C, 14);
    // An open hearth warms the tiles around it — winter survivable by design.
    for (const h of this.builtOf('warmth')) {
      if (Math.hypot(h.x - s.pos.x, h.y - s.pos.y) <= TUNING.hearthRadius) {
        return Math.max(this.temperature() + INDOOR_BONUS_C, 16);
      }
    }
    return this.temperature();
  }

  /** Eat one unit from the stores; raw grain costs a little mood. */
  private consumeFood(s: Settler): void {
    if (this.stock.meal > 0) {
      this.stock.meal--;
      s.needs.food = Math.min(100, s.needs.food + TUNING.mealFoodValue);
    } else if (this.stock.grain > 0) {
      this.stock.grain--;
      s.needs.food = Math.min(100, s.needs.food + TUNING.rawGrainFoodValue);
      this.addThought(s, 'Ate raw grain', -4, MINUTES_PER_DAY);
    }
  }

  /** Where to thaw out: the nearest hearth, else any heated shelter. */
  private nearestWarmSpot(s: Settler): Vec | null {
    let best: Vec | null = null;
    let bd = Infinity;
    for (const h of this.builtOf('warmth')) {
      const d = Math.hypot(h.x - s.pos.x, h.y - s.pos.y);
      if (d < bd) {
        bd = d;
        best = { x: h.x, y: h.y };
      }
    }
    if (best) return best;
    const shelter = this.builtOf('sleep')[0] ?? this.builtOf('recreation')[0];
    return shelter ? this.buildingCenter(shelter) : null;
  }

  /** First free plot in any built burial ground, or null when the yards are full. */
  graveSite(): { yard: Building; at: Vec } | null {
    for (const yard of this.builtOf('burial')) {
      for (let dy = 0; dy < this.buildingH(yard); dy++) {
        for (let dx = 0; dx < this.buildingW(yard); dx++) {
          const gx = yard.x + dx;
          const gy = yard.y + dy;
          if (!this.graves.some((gr) => gr.x === gx && gr.y === gy)) return { yard, at: { x: gx, y: gy } };
        }
      }
    }
    return null;
  }

  private traitMult(s: Settler, key: 'workSpeed' | 'warmthDecay' | 'foodDecay'): number {
    let m = 1;
    for (const id of s.traits) m *= traitDef(id)[key] ?? 1;
    return m;
  }

  private buildingCenter(b: Building): Vec {
    return { x: b.x + Math.floor(this.buildingW(b) / 2), y: b.y + Math.floor(this.buildingH(b) / 2) };
  }

  private dropItem(kind: ResourceKind, qty: number, x: number, y: number): void {
    this.items.push({ id: this.nextId++, kind, qty, x, y, reservedBy: null });
  }

  addThought(s: Settler, label: string, delta: number, durationMin: number): void {
    s.thoughts.push({ label, delta, expiresAt: this.minute + durationMin });
  }

  /** Keep an ongoing thought alive without stacking duplicates of it. */
  private refreshThought(s: Settler, label: string, delta: number, durationMin: number): void {
    const th = s.thoughts.find((o) => o.label === label);
    if (th) th.expiresAt = this.minute + durationMin;
    else this.addThought(s, label, delta, durationMin);
  }

  // ---- relationships ----
  private pairKey(a: Settler, b: Settler): string {
    return a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
  }

  bond(a: Settler, b: Settler, amount: number): void {
    const k = this.pairKey(a, b);
    this.opinions.set(k, Math.min(100, (this.opinions.get(k) ?? 0) + amount));
  }

  opinionBetween(a: Settler, b: Settler): number {
    return this.opinions.get(this.pairKey(a, b)) ?? 0;
  }

  friendsOf(s: Settler): Settler[] {
    return this.settlers
      .filter((o) => o.id !== s.id && this.opinionBetween(s, o) >= TUNING.friendThreshold)
      .sort((a, b) => this.opinionBetween(s, b) - this.opinionBetween(s, a));
  }

  private kill(s: Settler, cause: string): void {
    this.settlers = this.settlers.filter((o) => o !== s);
    this.releaseTask(s);
    this.corpses.push({
      id: this.nextId++, name: s.name,
      x: Math.round(s.pos.x), y: Math.round(s.pos.y), diedAt: this.minute,
    });
    this.addLog(`${s.name} has died of ${cause}.`, 'bad');
    for (const o of this.settlers) {
      const friend = this.opinionBetween(s, o) >= TUNING.friendThreshold;
      this.addThought(
        o,
        friend ? `${s.name.split(' ')[0]} — my friend — died` : `${s.name.split(' ')[0]} died`,
        friend ? -18 : -8,
        (friend ? 6 : 4) * MINUTES_PER_DAY,
      );
    }
  }

  private updateFarms(): void {
    if (!this.growingSeason) return;
    // The land and the sky set the pace: tile fertility × the water balance.
    const weatherMult = this.weather.growthMult(this.day);
    const perTick = (100 / (TUNING.farmGrowDays * MINUTES_PER_DAY)) * MINUTES_PER_TICK * weatherMult;
    for (const t of this.world.tiles) {
      if (t.kind === 'soil' && t.farmZone && t.sown && t.growth < 100) {
        t.growth = Math.min(100, t.growth + perTick * t.fertility);
      }
    }
  }

  /** Forester saplings creep toward full trees; anything built over one clears it. */
  private updateSaplings(): void {
    const perTick = (100 / (TUNING.saplingGrowDays * MINUTES_PER_DAY)) * MINUTES_PER_TICK;
    for (const t of this.world.tiles) {
      if (!t.sapling) continue;
      if (t.kind !== 'grass' || t.buildingId !== null || t.road || t.roadPlan ||
          t.wall || t.wallPlan || t.gate || t.gatePlan || t.farmZone || t.stockpileZone) {
        t.sapling = false;
        t.growth = 0;
        continue;
      }
      t.growth = Math.min(100, t.growth + perTick);
      if (t.growth >= 100) {
        t.sapling = false;
        t.growth = 0;
        t.kind = 'tree';
      }
    }
  }

  private addLog(text: string, kind: LogEntry['kind']): void {
    this.log.push({ day: this.day, text, kind });
    if (this.log.length > 200) this.log.shift();
  }

  // ---- save & load ----
  /**
   * Snapshot the whole town sim as JSON. Seed-derived structures (region
   * map, weather, worldgen params) rebuild from the seed; everything mutable
   * — tiles, agents, stocks, schedules, the RNG word — is captured verbatim
   * so a loaded game continues exactly where it left off.
   */
  serialize(): string {
    return JSON.stringify({
      v: 1,
      seed: this.seed,
      rng: this.rng.getState(),
      minute: this.minute,
      tiles: this.world.tiles,
      settlers: this.settlers,
      buildings: this.buildings,
      items: this.items,
      corpses: this.corpses,
      graves: this.graves,
      stock: this.stock,
      traffic: Array.from(this.traffic),
      log: this.log,
      gameOver: this.gameOver,
      coldSnapUntil: this.coldSnapUntil,
      raiders: this.raiders,
      raidActive: this.raidActive,
      animals: this.animals,
      droughtActive: this.droughtActive,
      lastFloodDay: this.lastFloodDay,
      opinions: [...this.opinions.entries()],
      raidUntil: this.raidUntil,
      nextRaidDay: this.nextRaidDay,
      nextId: this.nextId,
      nextEventDay: this.nextEventDay,
    });
  }

  static deserialize(json: string): Simulation {
    const d = JSON.parse(json);
    const sim = new Simulation(d.seed);
    sim.rng.setState(d.rng);
    sim.minute = d.minute;
    sim.world.tiles = d.tiles;
    sim.settlers = d.settlers;
    sim.buildings = d.buildings.map((b: Building) => ({
      ...b,
      level: b.level ?? 1,
      rotation: b.rotation ?? 0,
      workerLimit: b.workerLimit ?? null,
    }));
    sim.items = d.items;
    sim.corpses = d.corpses;
    sim.graves = d.graves;
    sim.stock = d.stock;
    sim.traffic = Float32Array.from(d.traffic);
    sim.log = d.log;
    sim.gameOver = d.gameOver;
    sim.coldSnapUntil = d.coldSnapUntil;
    sim.raiders = d.raiders;
    sim.raidActive = d.raidActive;
    sim.animals = d.animals;
    sim.droughtActive = d.droughtActive;
    sim.lastFloodDay = d.lastFloodDay;
    sim.opinions = new Map(d.opinions);
    sim.raidUntil = d.raidUntil;
    sim.nextRaidDay = d.nextRaidDay;
    sim.nextId = d.nextId;
    sim.nextEventDay = d.nextEventDay;
    // Task reservations aren't saved; rebuild them from in-flight tasks.
    sim.reserved = new Set(sim.settlers.filter((s) => s.task).map((s) => sim.taskKey(s.task!)));
    return sim;
  }
}

export { BUILDING_DEFS };
