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
  stock: Record<ResourceKind, number> = { wood: 80, grain: 60, meal: 160, stone: 0 };
  /** transits per tile for the traffic overlay; decays daily */
  traffic = new Float32Array(MAP_W * MAP_H);
  log: LogEntry[] = [];
  gameOver = false;
  coldSnapUntil = -1;
  raiders: Raider[] = [];
  raidActive = false;
  private droughtActive = false;
  private lastFloodDay = -99;
  /** pairwise relationship scores, keyed "lowId:highId" */
  opinions = new Map<string, number>();
  private raidUntil = 0;
  private nextRaidDay: number;
  private nextId = 1;
  private nextEventDay: number;
  private reserved = new Set<string>(); // task target keys

  constructor(seed: number) {
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
    this.placeBuilding('stockpile', cx - 1, cy - 1, true);
    this.placeBuilding('house', cx - 5, cy - 2, true);
    this.placeBuilding('house', cx + 3, cy - 2, true);
    for (let i = 0; i < 12; i++) {
      this.spawnSettler(cx - 3 + (i % 6), cy + 3 + Math.floor(i / 6));
    }
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
    };
    this.settlers.push(s);
    return s;
  }

  // ---- player verbs ----
  canPlace(defId: string, x: number, y: number): boolean {
    const def = buildingDef(defId);
    for (let dy = 0; dy < def.h; dy++) {
      for (let dx = 0; dx < def.w; dx++) {
        if (!this.world.inBounds(x + dx, y + dy)) return false;
        const t = this.world.at(x + dx, y + dy);
        if (t.kind !== 'grass' || t.buildingId !== null) return false;
      }
    }
    return true;
  }

  placeBuilding(defId: string, x: number, y: number, prebuilt = false): Building | null {
    if (!this.canPlace(defId, x, y)) return null;
    const def = buildingDef(defId);
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
    };
    this.buildings.push(b);
    for (let dy = 0; dy < def.h; dy++) {
      for (let dx = 0; dx < def.w; dx++) {
        const t = this.world.at(x + dx, y + dy);
        t.buildingId = b.id;
        if (def.provides === 'farm') t.kind = 'soil';
      }
    }
    return b;
  }

  cancelBuilding(id: number): void {
    const i = this.buildings.findIndex((b) => b.id === id && !b.built);
    if (i < 0) return;
    const b = this.buildings[i];
    const def = buildingDef(b.defId);
    this.stock.wood += b.delivered;
    for (let dy = 0; dy < def.h; dy++) {
      for (let dx = 0; dx < def.w; dx++) {
        const t = this.world.at(b.x + dx, b.y + dy);
        t.buildingId = null;
        if (t.kind === 'soil') t.kind = 'grass';
      }
    }
    this.buildings.splice(i, 1);
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
    if (t.road === kind || t.wall || t.buildingId !== null) return false;
    if (kind === 'bridge') {
      if (t.kind !== 'water') return false;
    } else if (t.kind !== 'grass' && t.kind !== 'soil') {
      return false;
    }
    t.roadPlan = kind;
    return true;
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
    this.updateRaiders();
    for (const s of [...this.settlers]) this.updateSettler(s);
    if (this.settlers.length === 0 && !this.gameOver) {
      this.gameOver = true;
      this.addLog('The colony has perished. (Failure state: depopulation.)', 'bad');
    }
  }

  private dailyUpdate(): void {
    for (let i = 0; i < this.traffic.length; i++) this.traffic[i] *= 0.9; // overlay shows recent flow
    if (this.day >= this.nextEventDay) {
      this.fireEvent();
      this.nextEventDay = this.day + 3 + this.rng.int(4);
    }
    if (this.day >= this.nextRaidDay && !this.raidActive) {
      this.startRaid();
      this.nextRaidDay = this.day + TUNING.raidIntervalDays + this.rng.int(5);
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

  private fireEvent(): void {
    const roll = this.rng.next();
    if (roll < 0.3 && this.settlers.length < TUNING.hardCapPop) {
      // Word travels: nobody joins a colony that can't feed itself.
      if (this.stock.meal + this.stock.grain > this.settlers.length * 2) {
        const s = this.spawnSettler(1, Math.floor(MAP_H / 2));
        this.addLog(`A wanderer, ${s.name}, asks to join the colony. They settle in.`, 'good');
      } else {
        this.addLog('A wanderer eyes the empty stores and moves on.', 'info');
      }
    } else if (roll < 0.5) {
      this.coldSnapUntil = this.minute + 3 * MINUTES_PER_DAY;
      this.addLog('A cold snap rolls in from the mountains. Three bitter days.', 'bad');
    } else if (roll < 0.7) {
      const lost = Math.ceil(this.stock.grain * 0.1);
      if (lost > 0) {
        this.stock.grain -= lost;
        this.addLog(`Rats in the stores — ${lost} grain lost.`, 'bad');
      }
    } else if (roll < 0.85) {
      for (const s of this.settlers) this.addThought(s, 'Festival night', 8, 2 * MINUTES_PER_DAY);
      this.addLog('The settlers hold an impromptu festival. Spirits lift.', 'good');
    } else {
      const n = 1 + this.rng.int(3);
      const victims = [...this.settlers].sort(() => this.rng.next() - 0.5).slice(0, n);
      for (const v of victims) {
        v.sickUntil = this.minute + (2 + this.rng.int(2)) * MINUTES_PER_DAY;
        this.addThought(v, 'Feverish', -6, v.sickUntil - this.minute);
      }
      this.addLog(`A fever spreads through camp — ${victims.map((v) => v.name.split(' ')[0]).join(', ')} fall ill.`, 'bad');
    }
  }

  /** Colony wealth drives raid size: prosperity attracts trouble (GDD §8.4). */
  wealth(): number {
    const stocks = this.stock.wood * 0.2 + this.stock.grain + this.stock.meal;
    const built = this.buildings.filter((b) => b.built).length;
    return stocks + this.settlers.length * 8 + built * 15;
  }

  private startRaid(): void {
    const byWealth = 2 + Math.floor(this.wealth() / TUNING.raidWealthPerRaider);
    const byTime = 2 + Math.floor(Math.max(0, this.day - TUNING.firstRaidDay) / TUNING.raidRampDays);
    const n = Math.max(2, Math.min(TUNING.raidMaxRaiders, byWealth, byTime));
    const side = this.rng.int(4);
    for (let i = 0; i < n; i++) {
      const along = 4 + this.rng.int(MAP_W - 8);
      const edge: Vec =
        side === 0 ? { x: along, y: 0 } : side === 1 ? { x: along, y: MAP_H - 1 } :
        side === 2 ? { x: 0, y: along } : { x: MAP_W - 1, y: along };
      const spot = this.world.passable(edge.x, edge.y) ? edge : this.world.nearestPassable(edge);
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
          const exit = this.world.nearestPassable({ x: r.pos.x < MAP_W / 2 ? 0 : MAP_W - 1, y: Math.round(r.pos.y) });
          const p = exit ? this.world.findPath({ x: Math.round(r.pos.x), y: Math.round(r.pos.y) }, exit) : null;
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
        );
        r.repathAt = this.minute + 60;
        if (p && p.length > 0) {
          r.path = p;
        } else {
          // Walled out: break the nearest palisade.
          const wall = this.nearestWall(r.pos);
          if (!wall) {
            r.state = 'flee';
            continue;
          }
          const wd = Math.hypot(wall.x + 0.5 - r.pos.x - 0.5, wall.y + 0.5 - r.pos.y - 0.5);
          if (wd <= 1.4) {
            wall.hp -= TUNING.wallDamagePerHour * hours;
            if (wall.hp <= 0) this.destroyBuilding(wall);
            continue;
          }
          const wp = this.world.findPath({ x: Math.round(r.pos.x), y: Math.round(r.pos.y) }, { x: wall.x, y: wall.y });
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

  private nearestWall(p: Vec): Building | null {
    let best: Building | null = null;
    let bd = Infinity;
    for (const b of this.buildings) {
      if (!b.built || buildingDef(b.defId).provides !== 'wall') continue;
      const d = Math.hypot(b.x - p.x, b.y - p.y);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }

  private destroyBuilding(b: Building): void {
    const def = buildingDef(b.defId);
    for (let dy = 0; dy < def.h; dy++) {
      for (let dx = 0; dx < def.w; dx++) {
        const t = this.world.at(b.x + dx, b.y + dy);
        t.buildingId = null;
        t.wall = false;
        if (t.kind === 'soil') t.kind = 'grass';
      }
    }
    this.buildings = this.buildings.filter((o) => o !== b);
    this.addLog(`${def.name} destroyed by raiders!`, 'bad');
  }

  private damageSettler(s: Settler, dmg: number): void {
    s.health -= dmg;
    if (!s.wound) s.wound = { at: this.minute, untreated: true, infectionRolled: false };
    if (s.health <= 0) this.kill(s, "a raider's blade");
  }

  // ---- settler update ----
  private updateSettler(s: Settler): void {
    const hours = MINUTES_PER_TICK / 60;
    const t = TUNING;
    const temp = this.effectiveTemp(s);

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
      s.needs.warmth = Math.min(100, s.needs.warmth + 5 * hours);
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
      s.health = Math.min(100, s.health + t.healthRegenPerHour * hours);
    }
    if (s.health <= 0) {
      const cause = s.infection ? 'infection' : s.sickUntil > this.minute ? 'fever'
        : s.wound ? 'their wounds' : s.needs.food <= 0 ? 'starvation' : 'exposure';
      this.kill(s, cause);
      return;
    }

    // Mood
    s.thoughts = s.thoughts.filter((th) => th.expiresAt > this.minute);
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
          target.health -= (t.combatDamagePerHour + s.combat * t.combatDamagePerSkill) * hours;
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
        return;
      }
      case 'breakdown': {
        if (this.minute >= s.stateUntil) s.state = 'idle';
        else this.wander(s);
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
        if (this.stock.meal > 0) {
          this.stock.meal--;
          s.needs.food = Math.min(100, s.needs.food + t.mealFoodValue);
        } else if (this.stock.grain > 0) {
          this.stock.grain--;
          s.needs.food = Math.min(100, s.needs.food + t.rawGrainFoodValue);
          this.addThought(s, 'Ate raw grain', -4, MINUTES_PER_DAY);
        }
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
    if (s.health < TUNING.bedRestThreshold) return this.goSleep(s); // bed rest
    if (s.needs.rest < 25 || (night && s.needs.rest < 80)) return this.goSleep(s);
    if (s.needs.food < 30 && (this.stock.meal > 0 || this.stock.grain > 0)) {
      const sp = this.builtOf('storage')[0];
      if (sp) {
        s.state = 'eating';
        this.setDestination(s, this.buildingCenter(sp));
        return;
      }
    }
    if (s.needs.warmth < 25) {
      const shelter = this.builtOf('sleep')[0] ?? this.builtOf('recreation')[0];
      if (shelter) {
        s.state = 'warming';
        s.stateUntil = this.minute + 12 * 60;
        this.setDestination(s, this.buildingCenter(shelter));
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
      const hall = this.builtOf('recreation')[0] ?? this.builtOf('storage')[0];
      if (hall) {
        s.state = 'recreating';
        s.stateUntil = this.minute + 180;
        this.setDestination(s, this.buildingCenter(hall));
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

    // Haul ground items to the stockpile.
    const sp = this.builtOf('storage')[0];
    if (sp) {
      for (const it of this.items) {
        if (it.reservedBy === null) {
          push({ kind: 'haul', x: it.x, y: it.y, itemId: it.id, workLeft: 5, label: `haul ${it.kind}` }, 'haul');
        }
      }
    }
    // Deliver wood to blueprints, then build them.
    for (const b of this.buildings) {
      if (b.built) continue;
      const need = (buildingDef(b.defId).cost.wood ?? 0) - b.delivered;
      if (need > 0 && this.stock.wood > 0 && sp) {
        push({ kind: 'build', x: sp.x + 1, y: sp.y, buildingId: b.id, workLeft: 0, label: `fetch wood for ${buildingDef(b.defId).name}` }, 'build');
      } else if (need <= 0) {
        push({ kind: 'build', x: b.x, y: b.y, buildingId: b.id, workLeft: b.buildLeft, label: `build ${buildingDef(b.defId).name}` }, 'build');
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
        if (tile.kind !== 'soil' || tile.buildingId === null) continue;
        const plot = this.building(tile.buildingId);
        if (!plot?.built) continue;
        if (tile.growth >= 100) {
          push({ kind: 'farm', x, y, workLeft: 10, label: 'harvest grain' }, 'farm');
        } else if (!tile.sown && this.growingSeason) {
          push({ kind: 'farm', x, y, workLeft: 15, label: 'sow grain' }, 'farm');
        }
      }
    }
    // Cook while there is grain and meals are short.
    const kitchen = this.builtOf('cook')[0];
    if (kitchen && this.stock.grain > 0 && this.stock.meal < this.settlers.length * 3) {
      push({ kind: 'cook', x: kitchen.x, y: kitchen.y, buildingId: kitchen.id, workLeft: TUNING.cookWorkPerMeal * TUNING.cookBatch, label: 'cook meals' }, 'cook');
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
      if (!this.arrived(s)) return this.step(s);
      s.state = 'working';
    }
    const sickMult = s.sickUntil > this.minute ? TUNING.sickWorkMult : 1;
    const sky = this.weatherToday().sky;
    const outdoorWork = task.kind === 'farm' || task.kind === 'chop' || task.kind === 'build' || task.kind === 'haul';
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
          const sp = this.builtOf('storage')[0];
          if (!sp) return this.finishTask(s);
          s.state = 'moving';
          this.setDestination(s, this.buildingCenter(sp));
          return;
        }
        this.stock[s.carrying.kind] += s.carrying.qty;
        s.carrying = null;
        this.finishTask(s);
        return;
      }
      case 'build': {
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
          if (def.provides === 'wall') {
            for (let dy = 0; dy < def.h; dy++) {
              for (let dx = 0; dx < def.w; dx++) this.world.at(b.x + dx, b.y + dy).wall = true;
            }
          } else {
            this.addLog(`${def.name} finished.`, 'good');
          }
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
        k.cookProgress += work;
        task.workLeft -= work;
        while (k.cookProgress >= TUNING.cookWorkPerMeal && this.stock.grain > 0) {
          k.cookProgress -= TUNING.cookWorkPerMeal;
          this.stock.grain--;
          this.stock.meal++;
        }
        if (task.workLeft <= 0 || this.stock.grain <= 0) this.finishTask(s);
        return;
      }
    }
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
    const houses = this.builtOf('sleep');
    for (const h of houses) {
      const cap = buildingDef(h.defId).capacity ?? 0;
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
  private effectiveTemp(s: Settler): number {
    const tile = this.world.inBounds(Math.round(s.pos.x), Math.round(s.pos.y))
      ? this.world.at(Math.round(s.pos.x), Math.round(s.pos.y))
      : null;
    const b = this.building(tile?.buildingId);
    const indoors = b?.built && ['sleep', 'cook', 'recreation'].includes(buildingDef(b.defId).provides);
    // Hearths keep interiors livable even in deep winter.
    return indoors ? Math.max(this.temperature() + INDOOR_BONUS_C, 14) : this.temperature();
  }

  private traitMult(s: Settler, key: 'workSpeed' | 'warmthDecay' | 'foodDecay'): number {
    let m = 1;
    for (const id of s.traits) m *= traitDef(id)[key] ?? 1;
    return m;
  }

  private buildingCenter(b: Building): Vec {
    const def = buildingDef(b.defId);
    return { x: b.x + Math.floor(def.w / 2), y: b.y + Math.floor(def.h / 2) };
  }

  private dropItem(kind: ResourceKind, qty: number, x: number, y: number): void {
    this.items.push({ id: this.nextId++, kind, qty, x, y, reservedBy: null });
  }

  addThought(s: Settler, label: string, delta: number, durationMin: number): void {
    s.thoughts.push({ label, delta, expiresAt: this.minute + durationMin });
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
      if (t.kind === 'soil' && t.sown && t.growth < 100) {
        t.growth = Math.min(100, t.growth + perTick * t.fertility);
      }
    }
  }

  private addLog(text: string, kind: LogEntry['kind']): void {
    this.log.push({ day: this.day, text, kind });
    if (this.log.length > 200) this.log.shift();
  }
}

export { BUILDING_DEFS };
