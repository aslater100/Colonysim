import { Rng } from './rng';
import { World, MAP_W, MAP_H } from './world';
import type { Vec } from './world';
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
  | 'idle' | 'moving' | 'working' | 'sleeping' | 'eating' | 'warming' | 'recreating' | 'breakdown';

export interface Task {
  kind: WorkKind;
  /** tile target for chop/farm; building id for build/cook; item id for haul */
  x: number;
  y: number;
  buildingId?: number;
  itemId?: number;
  workLeft: number;
  label: string;
}

export interface Settler {
  id: number;
  name: string;
  age: number;
  traits: string[];
  skills: Record<WorkKind, number>;
  priorities: Record<WorkKind, number>; // 0 = off, 3 = highest
  needs: Needs;
  mood: number;
  health: number;
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
  minute = 0;
  settlers: Settler[] = [];
  buildings: Building[] = [];
  items: GroundItem[] = [];
  stock: Record<ResourceKind, number> = { wood: 80, grain: 40, meal: 160 };
  log: LogEntry[] = [];
  gameOver = false;
  coldSnapUntil = -1;
  private nextId = 1;
  private nextEventDay: number;
  private reserved = new Set<string>(); // task target keys

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.world = new World(this.rng);
    this.nextEventDay = 4 + this.rng.int(3);
    this.foundColony();
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

  /** Outdoor temperature in °C: season base + diurnal swing + cold snaps. */
  temperature(): number {
    const diurnal = -6 * Math.cos(((this.hour - 14) / 24) * Math.PI * 2) - 2;
    const snap = this.minute < this.coldSnapUntil ? -10 : 0;
    return SEASON_BASE_C[this.seasonIndex] + diurnal + snap;
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
      needs: { food: 80, rest: 80, warmth: 80, recreation: 70, social: 70 },
      mood: 60,
      health: 100,
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

  markTree(x: number, y: number): void {
    if (this.world.inBounds(x, y) && this.world.at(x, y).kind === 'tree') {
      this.world.at(x, y).marked = !this.world.at(x, y).marked;
    }
  }

  building(id: number | null | undefined): Building | undefined {
    return this.buildings.find((b) => b.id === id);
  }

  builtOf(provides: string): Building[] {
    return this.buildings.filter((b) => b.built && buildingDef(b.defId).provides === provides);
  }

  // ---- main loop ----
  tick(): void {
    if (this.gameOver) return;
    this.minute += MINUTES_PER_TICK;
    const newDay = this.minute % MINUTES_PER_DAY < MINUTES_PER_TICK;
    if (newDay) this.dailyUpdate();
    this.updateFarms();
    for (const s of [...this.settlers]) this.updateSettler(s);
    if (this.settlers.length === 0 && !this.gameOver) {
      this.gameOver = true;
      this.addLog('The colony has perished. (Failure state: depopulation.)', 'bad');
    }
  }

  private dailyUpdate(): void {
    if (this.day >= this.nextEventDay) {
      this.fireEvent();
      this.nextEventDay = this.day + 3 + this.rng.int(4);
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
    } else {
      for (const s of this.settlers) this.addThought(s, 'Festival night', 8, 2 * MINUTES_PER_DAY);
      this.addLog('The settlers hold an impromptu festival. Spirits lift.', 'good');
    }
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
    if (s.needs.food > 30 && s.needs.warmth > 30 && s.health < 100) {
      s.health = Math.min(100, s.health + t.healthRegenPerHour * hours);
    }
    if (s.health <= 0) {
      this.kill(s, s.needs.food <= 0 ? 'starvation' : 'exposure');
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
    switch (s.state) {
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
    // Chop marked trees.
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const tile = this.world.at(x, y);
        if (tile.kind === 'tree' && tile.marked) {
          push({ kind: 'chop', x, y, workLeft: TUNING.treeChopWork, label: 'chop tree' }, 'chop');
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
    const speed =
      (0.5 + s.skills[task.kind] * 0.1) * this.traitMult(s, 'workSpeed') * this.softCapWorkMult();
    const work = hours * 60 * speed;
    s.skills[task.kind] = Math.min(10, s.skills[task.kind] + hours * 0.06);

    switch (task.kind) {
      case 'chop': {
        const tile = this.world.at(task.x, task.y);
        if (tile.kind !== 'tree') return this.finishTask(s);
        task.workLeft -= work;
        if (task.workLeft <= 0) {
          tile.kind = 'grass';
          tile.marked = false;
          this.dropItem('wood', TUNING.treeWood, task.x, task.y);
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
    return `${t.kind}:${t.buildingId ?? t.itemId ?? `${t.x},${t.y}`}`;
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
    let budget = SETTLER_SPEED * MINUTES_PER_TICK;
    while (budget > 0 && s.path.length > 0) {
      const next = s.path[0];
      const dx = next.x - s.pos.x;
      const dy = next.y - s.pos.y;
      const d = Math.hypot(dx, dy);
      if (d <= budget) {
        s.pos = { x: next.x, y: next.y };
        s.path.shift();
        budget -= d;
      } else {
        s.pos = { x: s.pos.x + (dx / d) * budget, y: s.pos.y + (dy / d) * budget };
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

  private kill(s: Settler, cause: string): void {
    this.settlers = this.settlers.filter((o) => o !== s);
    this.releaseTask(s);
    this.addLog(`${s.name} has died of ${cause}.`, 'bad');
    for (const o of this.settlers) this.addThought(o, `${s.name.split(' ')[0]} died`, -10, 4 * MINUTES_PER_DAY);
  }

  private updateFarms(): void {
    if (!this.growingSeason) return;
    const perTick = (100 / (TUNING.farmGrowDays * MINUTES_PER_DAY)) * MINUTES_PER_TICK;
    for (const t of this.world.tiles) {
      if (t.kind === 'soil' && t.sown && t.growth < 100) {
        t.growth = Math.min(100, t.growth + perTick);
      }
    }
  }

  private addLog(text: string, kind: LogEntry['kind']): void {
    this.log.push({ day: this.day, text, kind });
    if (this.log.length > 200) this.log.shift();
  }
}

export { BUILDING_DEFS };
