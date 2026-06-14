/**
 * Layered build grid — the Songs-of-Syx build model for the scale engine.
 *
 * Instead of dropping pre-made building objects, the player paints four layers
 * over the tile grid and the useful spaces emerge from their combination:
 *
 *   1. WALLS  — block movement and enclose space.
 *   2. FLOORS — mark a tile as usable interior; a room can only form on floor.
 *   3. ROOMS  — a designation (home / kitchen / mill / library …) painted over
 *               floored tiles. Connected same-designation floor tiles form one Room.
 *   4. STATIONS — workstations (oven, loom, bed, desk …) placed inside a room.
 *               A station is one work slot or one capacity unit, so a room's whole
 *               output is just the SUM of the stations inside it. Want more bread?
 *               Fit another oven; the bakery scales with the floor you give it.
 *
 * Rooms are DERIVED, never stored: `rebuildRooms()` flood-fills the designation
 * layer into `rooms`, assigns each tile a `roomId`, attaches the stations that sit
 * on it, and aggregates capacity/production from the station defs.
 *
 * Same data-oriented ethos as the rest of the scale engine (`agents.ts`,
 * `flowfield.ts`): the per-tile layers are flat typed arrays, the module is pure
 * and DOM-free, and `passable()` is exposed so a `FlowField` (Stage 2) can route
 * through the walls directly. It is additive — nothing here is wired into the live
 * `Simulation` yet (that swap is the final stage).
 *
 * Run the self-check:  npx tsx src/sim/build.ts
 */
import { MAP_W, MAP_H } from './world';
import type { ResourceKind, CapacityKind, BlueprintDef } from './defs';
import {
  ROOM_TYPE_ID, STATION_TYPE_ID, STATION_DEF_BY_NUM, ROOM_DEF_BY_NUM,
} from './defs';
import type { Stockpile } from './stockpile';

/** Narrow slice of AgentStore used by tickProduction — avoids a circular import. */
interface WorkerSource {
  count: number;
  stationId: Int32Array;
  state: Uint8Array;
}

/** A placed workstation instance. Few and rarely mutated, so plain objects are fine. */
export interface Station {
  id: number;
  /** numeric station-type id (index into STATION_DEF_BY_NUM) */
  typeId: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** room this station resolves to after rebuildRooms(); -1 = not in a valid room */
  roomId: number;
}

/** A connected, designated, floored region. Rebuilt from the layers each change. */
export interface Room {
  id: number;
  /** numeric room-type id (index into ROOM_DEF_BY_NUM) */
  typeId: number;
  area: number;
  /** walled all round (no leak to open ground / map edge) */
  enclosed: boolean;
  /** station ids whose origin tile lies in this room AND whose type fits it */
  stationIds: number[];
}

/** Aggregate of what a room delivers, summed over its valid stations. */
export interface RoomOutput {
  sleep: number;
  recreation: number;
  education: number;
  medical: number;
  storage: number;
  /** net resource flow per full work cycle of every craft station (inputs negative) */
  flow: Partial<Record<ResourceKind, number>>;
}

const NX4 = [1, -1, 0, 0];
const NY4 = [0, 0, 1, -1];

export class BuildGrid {
  readonly width: number;
  readonly height: number;
  readonly size: number;

  /** 0 = none, else wall material id (1+). Blocks movement. */
  readonly wall: Uint8Array;
  /** 0 = none, else floor material id (1+). Required for a room to form. */
  readonly floor: Uint8Array;
  /** 0 = undesignated, else room-type id (see ROOM_TYPE_ID). */
  readonly roomType: Uint8Array;
  /** -1 = no room, else the id of the Room covering this tile (set by rebuildRooms). */
  readonly roomId: Int32Array;
  /** -1 = no station, else the station id occupying this tile. */
  readonly station: Int32Array;

  /** Placed stations, indexed by id. Compacted on remove (swap-remove). */
  readonly stations: Station[] = [];
  /** Derived rooms (valid only after the latest rebuildRooms()). */
  rooms: Room[] = [];

  private nextStationId = 1;
  private _visited: Uint8Array; // scratch for flood fills
  /** Accumulated settler-minutes toward the current recipe cycle, keyed by station id. */
  private readonly _progress: Map<number, number> = new Map();

  constructor(width = MAP_W, height = MAP_H) {
    this.width = width;
    this.height = height;
    this.size = width * height;
    this.wall = new Uint8Array(this.size);
    this.floor = new Uint8Array(this.size);
    this.roomType = new Uint8Array(this.size);
    this.roomId = new Int32Array(this.size).fill(-1);
    this.station = new Int32Array(this.size).fill(-1);
    this._visited = new Uint8Array(this.size);
  }

  index(x: number, y: number): number {
    return y * this.width + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /** Movement blocked iff a wall stands here. Feeds FlowField/world passability. */
  passable(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.wall[this.index(x, y)] === 0;
  }

  // --- layer paint ops (each returns success; callers debit cost / mark dirty) ---

  setWall(x: number, y: number, material = 1): boolean {
    if (!this.inBounds(x, y)) return false;
    this.wall[this.index(x, y)] = material;
    return true;
  }

  clearWall(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    this.wall[this.index(x, y)] = 0;
    return true;
  }

  setFloor(x: number, y: number, material = 1): boolean {
    if (!this.inBounds(x, y)) return false;
    this.floor[this.index(x, y)] = material;
    return true;
  }

  clearFloor(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    const i = this.index(x, y);
    this.floor[i] = 0;
    this.roomType[i] = 0; // a tile with no floor can't be a designated room
    return true;
  }

  /** Designate a single tile as part of room type `typeId` (must be floored). */
  designate(x: number, y: number, typeId: number): boolean {
    if (!this.inBounds(x, y)) return false;
    const i = this.index(x, y);
    if (this.floor[i] === 0) return false;
    this.roomType[i] = typeId;
    return true;
  }

  clearDesignation(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    this.roomType[this.index(x, y)] = 0;
    return true;
  }

  /** Designate a filled rectangle; floors every tile first. Returns tiles painted. */
  designateRect(x0: number, y0: number, x1: number, y1: number, typeId: number): number {
    let n = 0;
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
        if (!this.inBounds(x, y) || this.wall[this.index(x, y)] !== 0) continue;
        this.setFloor(x, y);
        this.roomType[this.index(x, y)] = typeId;
        n++;
      }
    }
    return n;
  }

  // --- stations ---

  /**
   * Place a station of `typeId` (string or numeric) with its top-left at (x, y).
   * Every footprint tile must be in-bounds, floored, wall-free and station-free.
   * Returns the new Station, or null if it doesn't fit. Caller runs rebuildRooms().
   */
  placeStation(typeId: number | string, x: number, y: number): Station | null {
    const numId = typeof typeId === 'string' ? (STATION_TYPE_ID.get(typeId) ?? 0) : typeId;
    const def = STATION_DEF_BY_NUM[numId];
    if (!def) return null;
    for (let dy = 0; dy < def.h; dy++) {
      for (let dx = 0; dx < def.w; dx++) {
        const tx = x + dx;
        const ty = y + dy;
        if (!this.inBounds(tx, ty)) return null;
        const i = this.index(tx, ty);
        if (this.floor[i] === 0 || this.wall[i] !== 0 || this.station[i] !== -1) return null;
      }
    }
    const s: Station = { id: this.nextStationId++, typeId: numId, x, y, w: def.w, h: def.h, roomId: -1 };
    this.stations.push(s);
    for (let dy = 0; dy < def.h; dy++) {
      for (let dx = 0; dx < def.w; dx++) this.station[this.index(x + dx, y + dy)] = s.id;
    }
    this._progress.set(s.id, 0);
    return s;
  }

  removeStation(id: number): boolean {
    const idx = this.stations.findIndex((s) => s.id === id);
    if (idx === -1) return false;
    const s = this.stations[idx];
    for (let dy = 0; dy < s.h; dy++) {
      for (let dx = 0; dx < s.w; dx++) {
        const i = this.index(s.x + dx, s.y + dy);
        if (this.station[i] === id) this.station[i] = -1;
      }
    }
    this.stations.splice(idx, 1);
    this._progress.delete(id);
    return true;
  }

  stationById(id: number): Station | undefined {
    return this.stations.find((s) => s.id === id);
  }

  // --- room derivation ---

  /**
   * Flood-fill the designation layer into `rooms`. Connected (4-way) floored tiles
   * sharing a room-type become one Room; walls and type changes are boundaries.
   * Each tile's `roomId` is set; each station resolves to the room under its origin
   * (only if its type is allowed there). O(map).
   */
  rebuildRooms(): Room[] {
    const { size, width, floor, wall, roomType, roomId } = this;
    const visited = this._visited;
    visited.fill(0);
    roomId.fill(-1);
    this.rooms = [];
    const queue = new Int32Array(size); // reused BFS ring buffer

    let nextRoomId = 0;
    for (let start = 0; start < size; start++) {
      if (visited[start] || floor[start] === 0 || wall[start] !== 0) continue;
      const type = roomType[start];
      if (type === 0) { visited[start] = 1; continue; } // floored but undesignated

      const id = nextRoomId++;
      let area = 0;
      let enclosed = true;
      let qHead = 0;
      let qTail = 0;
      queue[qTail++] = start;
      visited[start] = 1;
      while (qHead < qTail) {
        const cur = queue[qHead++];
        roomId[cur] = id;
        area++;
        const cx = cur % width;
        const cy = (cur / width) | 0;
        for (let d = 0; d < 4; d++) {
          const nx = cx + NX4[d];
          const ny = cy + NY4[d];
          if (nx < 0 || ny < 0 || nx >= width || ny >= this.height) { enclosed = false; continue; }
          const ni = ny * width + nx;
          if (wall[ni] !== 0) continue; // a wall is a hard boundary (and a roof edge)
          if (floor[ni] === 0) { enclosed = false; continue; } // leaks onto open ground
          if (roomType[ni] !== type) continue; // a different designation is a boundary
          if (!visited[ni]) { visited[ni] = 1; queue[qTail++] = ni; }
        }
      }
      this.rooms.push({ id, typeId: type, area, enclosed, stationIds: [] });
    }

    // Attach stations: a station belongs to the room under its top-left tile, but
    // only if that room type actually accepts the station (else it's inert).
    for (const s of this.stations) {
      s.roomId = -1;
      const i = this.index(s.x, s.y);
      const rid = roomId[i];
      if (rid < 0) continue;
      const room = this.rooms[rid];
      const def = STATION_DEF_BY_NUM[s.typeId];
      const roomTypeName = ROOM_DEF_BY_NUM[room.typeId]?.id;
      if (def && roomTypeName && def.roomTypes.includes(roomTypeName)) {
        s.roomId = rid;
        room.stationIds.push(s.id);
      }
    }
    return this.rooms;
  }

  /**
   * Drive craft-station production for one simulation tick.
   *
   * For each craft station with at least one assigned worker, this advances the
   * recipe progress by `minutesPerTick × workerCount` settler-minutes. When
   * progress reaches the recipe's `work` threshold:
   *   - `stockpile.removeAll(inputs)` is called atomically; if any input is
   *     missing the station stalls (progress clamped at threshold, no output).
   *   - On success: outputs are added to the stockpile and excess progress
   *     carries forward into the next cycle.
   *
   * Capacity stations (beds, desks, …) are skipped entirely — their effect is
   * a static bonus on the room, not a per-tick flow.
   *
   * The `agents` parameter is a duck-typed slice of `AgentStore` (count +
   * stationId + state columns) so `build.ts` stays free of a direct import
   * of `agents.ts`, preventing a future circular dependency when B-3 wires the
   * job board back into both.
   *
   * `AState.Working = 3`; agents in any other state are not counted as workers.
   */
  tickProduction(agents: WorkerSource, stockpile: Stockpile, minutesPerTick: number): void {
    // Count workers per station in one O(agents) pass.
    const workerCount = new Map<number, number>();
    for (let i = 0; i < agents.count; i++) {
      if (agents.state[i] !== 3 /* AState.Working */) continue;
      const sid = agents.stationId[i];
      if (sid > 0) workerCount.set(sid, (workerCount.get(sid) ?? 0) + 1);
    }

    for (const s of this.stations) {
      const def = STATION_DEF_BY_NUM[s.typeId];
      if (!def || def.kind !== 'craft' || !def.recipe) continue;

      const workers = workerCount.get(s.id) ?? 0;
      if (workers === 0) continue;

      const recipe = def.recipe;
      let progress = (this._progress.get(s.id) ?? 0) + minutesPerTick * workers;

      if (progress >= recipe.work) {
        if (stockpile.removeAll(recipe.inputs)) {
          for (const [res, qty] of Object.entries(recipe.outputs)) {
            stockpile.add(res as ResourceKind, qty as number);
          }
          progress -= recipe.work; // carry excess into next cycle
        } else {
          progress = recipe.work; // stall: clamp so workers don't over-credit
        }
      }

      this._progress.set(s.id, progress);
    }
  }

  /**
   * Stamp a blueprint at world origin (ox, oy). Paints floors first, then
   * walls over them, designates the interior, and places stations. Returns
   * false if the footprint is out of bounds. Station placement silently skips
   * occupied tiles so partially-overlapping stamps stay valid.
   */
  stampBlueprint(bp: BlueprintDef, ox: number, oy: number): boolean {
    if (!this.inBounds(ox, oy) || !this.inBounds(ox + bp.w - 1, oy + bp.h - 1)) return false;
    const [fx0, fy0, fx1, fy1] = bp.floorRect;
    for (let y = fy0; y <= fy1; y++)
      for (let x = fx0; x <= fx1; x++)
        this.setFloor(ox + x, oy + y);
    for (const [wx0, wy0, wx1, wy1] of bp.wallRects)
      for (let y = wy0; y <= wy1; y++)
        for (let x = wx0; x <= wx1; x++)
          this.setWall(ox + x, oy + y);
    const typeId = ROOM_TYPE_ID.get(bp.roomType) ?? 0;
    if (typeId > 0)
      for (let y = fy0; y <= fy1; y++)
        for (let x = fx0; x <= fx1; x++)
          this.designate(ox + x, oy + y, typeId);
    for (const st of bp.stations)
      this.placeStation(st.type, ox + st.x, oy + st.y);
    this.rebuildRooms();
    return true;
  }

  /** Aggregate everything a room delivers, summed over its valid stations. */
  roomOutput(room: Room): RoomOutput {
    const out: RoomOutput = { sleep: 0, recreation: 0, education: 0, medical: 0, storage: 0, flow: {} };
    for (const sid of room.stationIds) {
      const s = this.stationById(sid);
      if (!s) continue;
      const def = STATION_DEF_BY_NUM[s.typeId];
      if (!def) continue;
      if (def.kind === 'capacity' && def.capacity) {
        const k: CapacityKind = def.capacity.kind;
        out[k] += def.capacity.amount;
      } else if (def.kind === 'craft' && def.recipe) {
        for (const [res, q] of Object.entries(def.recipe.inputs)) {
          out.flow[res as ResourceKind] = (out.flow[res as ResourceKind] ?? 0) - (q as number);
        }
        for (const [res, q] of Object.entries(def.recipe.outputs)) {
          out.flow[res as ResourceKind] = (out.flow[res as ResourceKind] ?? 0) + (q as number);
        }
      }
    }
    return out;
  }
}

// --- self-check: npx tsx src/sim/build.ts ---
if (process.argv[1]?.endsWith('/build.ts')) {
  const g = new BuildGrid(20, 20);
  const mill = ROOM_TYPE_ID.get('mill')!;

  // Floor + designate a 4×3 mill, drop two millstones inside.
  g.designateRect(2, 2, 5, 4, mill);
  const a = g.placeStation('millstone', 2, 2);
  const b = g.placeStation('millstone', 4, 2);
  console.assert(a !== null && b !== null, 'two millstones placed');
  // A third can't fit on the remaining floor (millstone is 2×2; row would overlap).
  console.assert(g.placeStation('millstone', 2, 2) === null, 'overlap rejected');

  g.rebuildRooms();
  console.assert(g.rooms.length === 1, 'one room formed');
  const room = g.rooms[0];
  console.assert(room.area === 12, `area 12 (got ${room.area})`);
  console.assert(room.stationIds.length === 2, 'both millstones attached');

  const out = g.roomOutput(room);
  console.assert((out.flow.flour ?? 0) === 6 && (out.flow.grain ?? 0) === -6,
    `2 millstones net +6 flour / -6 grain (got ${out.flow.flour}/${out.flow.grain})`);

  // A station of the wrong type sitting in the mill is inert (not attached).
  const bedId = STATION_TYPE_ID.get('bed')!;
  const bed = g.placeStation(bedId, 2, 2 + 0); // overlaps millstone -> rejected anyway
  console.assert(bed === null, 'cannot place onto an occupied tile');

  // Enclosure: open mill (no walls) is not enclosed; wall it and it is.
  console.assert(!room.enclosed, 'open yard is not enclosed');
  for (let x = 1; x <= 6; x++) { g.setWall(x, 1); g.setWall(x, 5); }
  for (let y = 1; y <= 5; y++) { g.setWall(1, y); g.setWall(6, y); }
  g.rebuildRooms();
  console.assert(g.rooms[0].enclosed, 'walled mill is enclosed');

  // Removing a station drops it from the room aggregate.
  g.removeStation(a!.id);
  g.rebuildRooms();
  console.assert((g.roomOutput(g.rooms[0]).flow.flour ?? 0) === 3, 'one millstone left → +3 flour');

  console.log('build.ts self-check OK — room area', g.rooms[0].area,
    'stations', g.rooms[0].stationIds.length, 'enclosed', g.rooms[0].enclosed);
}
