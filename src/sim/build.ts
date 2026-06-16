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
import type { Rng } from './rng';
import type { ResourceKind, CapacityKind, BlueprintDef } from './defs';
import {
  ROOM_TYPE_ID, STATION_TYPE_ID, STATION_DEF_BY_NUM, ROOM_DEF_BY_NUM,
} from './defs';
import type { Stockpile } from './stockpile';

/** Narrow slice of AgentStore used by tickProduction — avoids a circular import.
 *  `skill`/`workSpeedMult` are optional: when present, a worker contributes its
 *  skill+trait effort (0.5 + skill×0.1) × workSpeedMult instead of a flat 1.0.
 *  `sick` (optional) applies the fever work penalty. */
interface WorkerSource {
  count: number;
  stationId: Int32Array;
  state: Uint8Array;
  skill?: Float32Array;
  workSpeedMult?: Float32Array;
  sick?: Uint8Array;
}

/** Fever work-speed factor (mirrors TUNING.sickWorkMult); kept local to avoid a defs import here. */
const SICK_WORK_MULT = 0.6;

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
  burial: number;
  watch: number;
  well: number;
  trade: number;
  drill: number;
  faith: number;
  /** net resource flow per full work cycle of every craft station (inputs negative) */
  flow: Partial<Record<ResourceKind, number>>;
}

/** JSON round-trip shape for a BuildGrid (painted layers + station list). */
export interface BuildGridSave {
  width: number;
  height: number;
  /** base64 of the wall / floor / roomType Uint8 layers. */
  wall: string;
  /** base64 of the gate layer (optional: absent in pre-gate saves). */
  gate?: string;
  /** base64 of the spike-trap layer (optional: absent in pre-trap saves). */
  trap?: string;
  /** base64 of the terrain layer (optional: absent in pre-terrain saves → all grass). */
  terrain?: string;
  /** base64 of the ore-deposit layer (optional: absent in pre-terrain saves). */
  ore?: string;
  /** base64 of the harvest-zone layer (optional: absent in pre-zone saves). */
  zone?: string;
  /** base64 of the wild-forage-deposit layer (optional: absent in pre-forage saves). */
  forage?: string;
  /** base64 of the sapling-age layer (optional: absent in pre-forester saves). Days growing; 0 = no sapling. */
  saplingAge?: string;
  floor: string;
  roomType: string;
  stations: Array<{ id: number; typeId: number; x: number; y: number; w: number; h: number }>;
  nextStationId: number;
  progress: Array<[number, number]>;
}

const NX4 = [1, -1, 0, 0];
const NY4 = [0, 0, 1, -1];

/**
 * Terrain codes for the BuildGrid's base layer (B-6 PART 3, the Songs-of-Syx
 * swap). The painted build layers (walls/floors/rooms) sit ON TOP of terrain,
 * so the world the player paints over is no longer a featureless plane: forests
 * give timber, rock gives stone (and ore where it's flecked), water blocks and
 * irrigates. Order mirrors `world.ts`'s `TileKind` so a renderer can share a
 * colour table. GRASS (0) is the default — an all-grass grid behaves exactly as
 * a terrain-free one did, which keeps every pre-terrain test and save valid. */
export const TERRAIN = { GRASS: 0, TREE: 1, WATER: 2, SOIL: 3, ROCK: 4 } as const;
export type TerrainCode = (typeof TERRAIN)[keyof typeof TERRAIN];
/** Index-aligned with TERRAIN values — for renderers/inspectors. */
export const TERRAIN_NAMES = ['grass', 'tree', 'water', 'soil', 'rock'] as const;

/**
 * Harvest zones (B-6 PART 3, Songs-of-Syx primary production). The player paints a
 * zone over matching terrain and the colony works it into raw goods: a FIELD on
 * soil grows grain, a WOODCUTTER fells forest for wood, a QUARRY cuts rock for
 * stone (or iron ore where it's flecked), a FISHERY by water lands meals.
 * FLAX is a perennial fibre crop on soil — produces flax year-round for the loom.
 * WOODCUTTER/QUARRY are consuming — the tile reverts to grass once worked out —
 * while FIELD/FISHERY/FLAX renew. Each id's `terrain` is the tile it may sit on
 * (FISHERY is special-cased: any passable tile next to water).
 */
export const ZONE = { NONE: 0, FIELD: 1, WOODCUTTER: 2, QUARRY: 3, FISHERY: 4, FLAX: 5, FORAGE: 6, ORCHARD: 7, VEGGARDEN: 8 } as const;
/** Wild forage deposits scattered on grass (the `forage` layer). */
export const FORAGE = { NONE: 0, BERRIES: 1, MUSHROOMS: 2, HERBS: 3 } as const;
export type ZoneCode = (typeof ZONE)[keyof typeof ZONE];
export interface ZoneDef {
  id: string;
  terrain: number;        // required terrain under the zone (FISHERY ignores this)
  resource: ResourceKind; // what a worked tile yields
  renewable: boolean;     // false → the tile is consumed (terrain → grass) when worked
  seasonal?: boolean;     // true → zone lies fallow in winter (default true for FIELD, false otherwise)
}
/** 1-based; index 0 = ZONE.NONE. */
export const ZONE_DEFS: (ZoneDef | null)[] = [
  null,
  { id: 'field', terrain: TERRAIN.SOIL, resource: 'grain', renewable: true, seasonal: true },
  { id: 'woodcutter', terrain: TERRAIN.TREE, resource: 'wood', renewable: false },
  { id: 'quarry', terrain: TERRAIN.ROCK, resource: 'stone', renewable: false },
  { id: 'fishery', terrain: TERRAIN.WATER, resource: 'fish_meal', renewable: true },
  { id: 'flax', terrain: TERRAIN.SOIL, resource: 'flax', renewable: true },
  // Forage: gathered from wild deposits on grass. `resource` is overridden per
  // deposit in harvestZones (berries/mushrooms → meal, herbs → herbs).
  { id: 'forage', terrain: TERRAIN.GRASS, resource: 'meal', renewable: true },
  // Farms: fruit orchards (grass) and vegetable gardens (soil) → produce, a fresh
  // food that lifts diet variety. Seasonal like fields.
  { id: 'orchard', terrain: TERRAIN.GRASS, resource: 'produce', renewable: true, seasonal: true },
  { id: 'veggarden', terrain: TERRAIN.SOIL, resource: 'produce', renewable: true, seasonal: true },
];

// Portable base64 for the byte layers (no Buffer/btoa — runs in Node, browser, worker).
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function bytesToB64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[b2 & 63] : '=';
  }
  return out;
}

function b64ToBytes(b64: string, size: number): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(size);
  let p = 0;
  for (let i = 0; i < clean.length && p < size; i += 4) {
    const c0 = B64.indexOf(clean[i]);
    const c1 = B64.indexOf(clean[i + 1]);
    const c2 = i + 2 < clean.length ? B64.indexOf(clean[i + 2]) : -1;
    const c3 = i + 3 < clean.length ? B64.indexOf(clean[i + 3]) : -1;
    if (p < size) out[p++] = (c0 << 2) | (c1 >> 4);
    if (c2 >= 0 && p < size) out[p++] = ((c1 & 15) << 4) | (c2 >> 2);
    if (c3 >= 0 && p < size) out[p++] = ((c2 & 3) << 6) | c3;
  }
  return out;
}

export class BuildGrid {
  readonly width: number;
  readonly height: number;
  readonly size: number;

  /** 0 = none, else wall material id (1+). Blocks movement. */
  readonly wall: Uint8Array;
  /** 1 = a gate: passable like a gap, but counts as a wall for room enclosure. */
  readonly gate: Uint8Array;
  /** 1 = a player-placed spike trap: damages the first raider to step on it, then
   *  is consumed (one-shot). Passable; does not affect rooms or pathing. */
  readonly trap: Uint8Array;
  /** 0 = none, else floor material id (1+). Required for a room to form. */
  readonly floor: Uint8Array;
  /** 0 = undesignated, else room-type id (see ROOM_TYPE_ID). */
  readonly roomType: Uint8Array;
  /** -1 = no room, else the id of the Room covering this tile (set by rebuildRooms). */
  readonly roomId: Int32Array;
  /** -1 = no station, else the station id occupying this tile. */
  readonly station: Int32Array;
  /** Base terrain layer (see TERRAIN). 0 = grass everywhere until generateTerrain(). */
  readonly terrain: Uint8Array;
  /** 1 = this rock tile carries an ore deposit (mineable for metal). Only on ROCK. */
  readonly ore: Uint8Array;
  /** Harvest-zone designation (see ZONE). 0 = none. Painted over matching terrain. */
  readonly zone: Uint8Array;
  /** Wild forage deposit on this tile (see FORAGE). 0 = none. Only on GRASS. */
  readonly forage: Uint8Array;
  /** Days since the tile's tree was felled; 0 = no sapling. Advances in TownCore dailyUpdate. */
  readonly saplingAge: Uint8Array;

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
    this.gate = new Uint8Array(this.size);
    this.trap = new Uint8Array(this.size);
    this.floor = new Uint8Array(this.size);
    this.roomType = new Uint8Array(this.size);
    this.roomId = new Int32Array(this.size).fill(-1);
    this.station = new Int32Array(this.size).fill(-1);
    this.terrain = new Uint8Array(this.size); // all GRASS (0)
    this.ore = new Uint8Array(this.size);
    this.zone = new Uint8Array(this.size);
    this.forage = new Uint8Array(this.size);
    this.saplingAge = new Uint8Array(this.size);
    this._visited = new Uint8Array(this.size);
  }

  index(x: number, y: number): number {
    return y * this.width + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /** Movement blocked by a wall OR by impassable terrain (forest/water/rock).
   *  Feeds FlowField/world passability. An all-grass grid (the default, and every
   *  pre-terrain save) blocks on walls alone, exactly as before. */
  passable(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    const i = this.index(x, y);
    return this.wall[i] === 0 && !this._terrainBlocks(this.terrain[i]);
  }

  private _terrainBlocks(code: number): boolean {
    return code === TERRAIN.TREE || code === TERRAIN.WATER || code === TERRAIN.ROCK;
  }

  // --- terrain layer (B-6 PART 3) ---

  terrainAt(x: number, y: number): number {
    return this.inBounds(x, y) ? this.terrain[this.index(x, y)] : TERRAIN.WATER;
  }

  setTerrain(x: number, y: number, code: number): boolean {
    if (!this.inBounds(x, y)) return false;
    const i = this.index(x, y);
    this.terrain[i] = code;
    if (code !== TERRAIN.ROCK) this.ore[i] = 0; // ore only sits on rock
    return true;
  }

  /** True where terrain (not a wall) stops movement: forest, water, or rock. */
  terrainBlocks(x: number, y: number): boolean {
    return this.inBounds(x, y) && this._terrainBlocks(this.terrain[this.index(x, y)]);
  }

  hasOre(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.ore[this.index(x, y)] === 1;
  }

  // --- harvest zones (B-6 PART 3) ---

  /** Can zone type `type` be designated on (x, y)? Terrain must match the zone def
   *  (FISHERY: a passable tile next to water). */
  canZone(x: number, y: number, type: number): boolean {
    const def = ZONE_DEFS[type];
    if (!def || !this.inBounds(x, y)) return false;
    if (type === ZONE.FISHERY) return this.terrainAt(x, y) !== TERRAIN.WATER && this._nextToWater(x, y);
    // Forage only works an actual wild deposit (grass with a berry/mushroom/herb).
    if (type === ZONE.FORAGE) return this.terrainAt(x, y) === TERRAIN.GRASS && this.forage[this.index(x, y)] !== FORAGE.NONE;
    return this.terrainAt(x, y) === def.terrain;
  }

  /** Designate a harvest zone if the terrain suits it; returns success. */
  setZone(x: number, y: number, type: number): boolean {
    if (!this.canZone(x, y, type)) return false;
    this.zone[this.index(x, y)] = type;
    return true;
  }

  clearZone(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    this.zone[this.index(x, y)] = ZONE.NONE;
    return true;
  }

  zoneAt(x: number, y: number): number {
    return this.inBounds(x, y) ? this.zone[this.index(x, y)] : ZONE.NONE;
  }

  private _nextToWater(x: number, y: number): boolean {
    for (let d = 0; d < 4; d++) {
      if (this.terrainAt(x + NX4[d], y + NY4[d]) === TERRAIN.WATER) return true;
    }
    return false;
  }

  /**
   * Paint a natural landscape into the terrain layer: a body of water, scattered
   * forests, rocky outcrops (some ore-bearing), fertile soil by the water, and a
   * guaranteed grass clearing at the heart so the start is always buildable.
   * Deterministic for a given Rng — ported from `world.ts`'s blob generator but
   * writing flat terrain codes instead of fat Tile objects. Idempotent over the
   * default all-grass grid; call once at construction.
   */
  generateTerrain(rng: Rng): void {
    const blobMult = (this.width / 64) ** 1.5; // proportionally more features on bigger maps

    // A lake, roughly south-west of centre, with a fertile soil rim.
    const pondX = Math.round(this.width * 0.16) + rng.int(Math.max(1, Math.round(this.width * 0.16)));
    const pondY = Math.round(this.height * 0.6) + rng.int(Math.max(1, Math.round(this.height * 0.18)));
    this._terrainBlob(pondX, pondY, 5 + rng.int(3), TERRAIN.WATER, rng, TERRAIN.GRASS);
    for (let i = 0; i < Math.round(4 * blobMult); i++) {
      const sx = pondX + rng.int(14) - 7;
      const sy = pondY + rng.int(14) - 7;
      this._terrainBlob(sx, sy, 2 + rng.int(2), TERRAIN.SOIL, rng, TERRAIN.GRASS);
    }

    // Timber: scattered forests.
    for (let i = 0; i < Math.round(14 * blobMult); i++) {
      this._terrainBlob(rng.int(this.width), rng.int(this.height), 2 + rng.int(4), TERRAIN.TREE, rng, TERRAIN.GRASS);
    }

    // Stone: rocky outcrops; every third one bears ore (max 4 deposits).
    let deposits = 0;
    const rockBlobs = Math.round(4 * blobMult);
    for (let i = 0; i < rockBlobs; i++) {
      const bx = rng.int(this.width), by = rng.int(this.height), br = 1 + rng.int(2);
      this._terrainBlob(bx, by, br, TERRAIN.ROCK, rng, TERRAIN.GRASS);
      if (i % 3 === 1 && deposits < 4) {
        deposits++;
        for (let dy = -br - 1; dy <= br + 1; dy++) {
          for (let dx = -br - 1; dx <= br + 1; dx++) {
            const tx = bx + dx, ty = by + dy;
            if (this.inBounds(tx, ty) && this.terrain[this.index(tx, ty)] === TERRAIN.ROCK) {
              this.ore[this.index(tx, ty)] = 1;
            }
          }
        }
      }
    }

    // The heart clearing: a guaranteed buildable, walkable grass patch.
    const cx0 = Math.floor(this.width / 2), cy0 = Math.floor(this.height / 2);
    for (let y = cy0 - 10; y <= cy0 + 10; y++) {
      for (let x = cx0 - 14; x <= cx0 + 14; x++) {
        const t = this.terrainAt(x, y);
        if (t === TERRAIN.TREE || t === TERRAIN.ROCK) this.setTerrain(x, y, TERRAIN.GRASS);
      }
    }
  }

  /**
   * Songs-of-Syx-style terrain from a procedural heightmap: low = sea,
   * mid = land (with forests), high = mountains (with ore). A smooth
   * value-noise field gives coherent continents/seas/ranges instead of the
   * scattered blobs of generateTerrain(). Opt-in (TownCore `terrain:'heightmap'`).
   */
  generateTerrainHeightmap(rng: Rng): void {
    const W = this.width, H = this.height;
    // One value-noise octave: a coarse random lattice, smoothstep-interpolated.
    const octave = (cellSize: number): Float32Array => {
      const gw = Math.ceil(W / cellSize) + 2;
      const lat = new Float32Array(gw * (Math.ceil(H / cellSize) + 2));
      for (let i = 0; i < lat.length; i++) lat[i] = rng.next();
      const field = new Float32Array(W * H);
      const s = (t: number) => t * t * (3 - 2 * t);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const fx = x / cellSize, fy = y / cellSize;
        const ix = Math.floor(fx), iy = Math.floor(fy);
        const tx = s(fx - ix), ty = s(fy - iy);
        const a = lat[iy * gw + ix], b = lat[iy * gw + ix + 1];
        const c = lat[(iy + 1) * gw + ix], d = lat[(iy + 1) * gw + ix + 1];
        field[y * W + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
      }
      return field;
    };
    const big = octave(Math.max(8, Math.round(W / 4)));
    const mid = octave(Math.max(4, Math.round(W / 10)));
    const fine = octave(Math.max(3, Math.round(W / 22)));
    const forest = octave(Math.max(3, Math.round(W / 14)));

    const height = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) {
      const h = 0.55 * big[i] + 0.3 * mid[i] + 0.15 * fine[i]; // 0..1 elevation
      height[i] = h;
      this.terrain[i] =
        h < 0.32 ? TERRAIN.WATER :
        h < 0.37 ? TERRAIN.SOIL :                         // fertile shoreline flats
        h > 0.72 ? TERRAIN.ROCK :                         // mountains
        (forest[i] > 0.62 && h < 0.66) ? TERRAIN.TREE :   // lowland forests
        TERRAIN.GRASS;
    }
    // Ore seams in the high rock (deterministic, capped).
    for (let i = 0, deposits = 0; i < W * H && deposits < 6; i++) {
      if (this.terrain[i] === TERRAIN.ROCK && fine[i] > 0.8) { this.ore[i] = 1; deposits++; }
    }
    // Rivers: from a few high points, follow steepest descent down the heightmap
    // to the sea (or a local-minimum lake), carving a 1-tile water channel.
    const DX8 = [1, -1, 0, 0, 1, 1, -1, -1], DY8 = [0, 0, 1, -1, 1, -1, 1, -1];
    for (let r = 0, rivers = Math.max(2, Math.round(W / 28)); r < rivers; r++) {
      let sx = -1, sy = -1, sh = 0.6; // pick a high-ish source
      for (let tries = 0; tries < 40; tries++) {
        const x = rng.int(W), y = rng.int(H);
        if (height[y * W + x] > sh) { sx = x; sy = y; sh = height[y * W + x]; }
      }
      if (sx < 0) continue;
      let x = sx, y = sy;
      for (let step = 0; step < W * 2; step++) {
        const i = y * W + x;
        if (this.terrain[i] === TERRAIN.WATER) break; // reached the sea / a lake
        this.terrain[i] = TERRAIN.WATER; this.ore[i] = 0;
        let nx = x, ny = y, nh = height[i];
        for (let d = 0; d < 8; d++) {
          const ax = x + DX8[d], ay = y + DY8[d];
          if (ax < 0 || ay < 0 || ax >= W || ay >= H) continue;
          if (height[ay * W + ax] < nh) { nh = height[ay * W + ax]; nx = ax; ny = ay; }
        }
        if (nx === x && ny === y) break; // local minimum — river ends here
        x = nx; y = ny;
      }
    }
    // Beaches: a sandy (soil) shore wherever grass/forest meets water. One pass
    // over a snapshot so the ring doesn't grow into itself.
    const land = this.terrain.slice();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (land[i] !== TERRAIN.GRASS && land[i] !== TERRAIN.TREE) continue;
      for (let d = 0; d < 4; d++) {
        const ax = x + NX4[d], ay = y + NY4[d];
        if (ax >= 0 && ay >= 0 && ax < W && ay < H && land[ay * W + ax] === TERRAIN.WATER) { this.terrain[i] = TERRAIN.SOIL; break; }
      }
    }
    // Wild forage deposits scattered on grassland — berries/mushrooms/herbs you
    // can designate a FORAGE zone over (SoS-style scattered resources).
    for (let i = 0; i < W * H; i++) {
      if (this.terrain[i] !== TERRAIN.GRASS) continue;
      const r = rng.next();
      if (r < 0.03) this.forage[i] = r < 0.012 ? FORAGE.BERRIES : r < 0.022 ? FORAGE.MUSHROOMS : FORAGE.HERBS;
    }
    // Heart clearing: a guaranteed buildable, walkable grass patch for the colony.
    const cx0 = Math.floor(W / 2), cy0 = Math.floor(H / 2);
    for (let y = cy0 - 10; y <= cy0 + 10; y++) for (let x = cx0 - 14; x <= cx0 + 14; x++) {
      if (this.inBounds(x, y) && this.terrain[this.index(x, y)] !== TERRAIN.GRASS) this.setTerrain(x, y, TERRAIN.GRASS);
    }
  }

  /** Stamp a rough disc of `code`, only overwriting tiles currently `over`. */
  private _terrainBlob(cx: number, cy: number, r: number, code: number, rng: Rng, over: number): void {
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (!this.inBounds(x, y)) continue;
        const d = Math.hypot(x - cx, y - cy);
        if (d <= r * (0.7 + rng.next() * 0.5) && this.terrain[this.index(x, y)] === over) {
          this.terrain[this.index(x, y)] = code;
        }
      }
    }
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

  /** Place a gate: a passable opening that still seals a room for enclosure. */
  setGate(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    const i = this.index(x, y);
    this.wall[i] = 0; // a gate is an opening in the wall line
    this.gate[i] = 1;
    return true;
  }

  clearGate(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    this.gate[this.index(x, y)] = 0;
    return true;
  }

  /** Arm a spike trap on a tile (one-shot; consumed when a raider trips it). */
  setTrap(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    this.trap[this.index(x, y)] = 1;
    return true;
  }

  /** Disarm a spike trap (e.g. the player recovers the wood). */
  clearTrap(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    this.trap[this.index(x, y)] = 0;
    return true;
  }

  hasTrap(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.trap[this.index(x, y)] === 1;
  }

  /** If a spike trap is armed here, consume it and return true (it fired). */
  tripTrap(x: number, y: number): boolean {
    if (!this.hasTrap(x, y)) return false;
    this.trap[this.index(x, y)] = 0;
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
    const { size, width, floor, wall, gate, roomType, roomId } = this;
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
          if (wall[ni] !== 0 || gate[ni] !== 0) continue; // wall or gate: a hard boundary (roof edge)
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
  tickProduction(agents: WorkerSource, stockpile: Stockpile, minutesPerTick: number, stationSpeedMult?: (stationId: string) => number): void {
    // Sum worker *effort* per station in one O(agents) pass. With no skill/trait
    // columns each worker is 1.0 effort (so progress = minutes × headcount, exactly
    // as before); with them, a skilled or industrious settler advances the recipe
    // faster (0.5 + skill×0.1) × workSpeedMult — skill 5 + neutral traits = 1.0.
    const { skill, workSpeedMult, sick } = agents;
    const workerEffort = new Map<number, number>();
    for (let i = 0; i < agents.count; i++) {
      if (agents.state[i] !== 3 /* AState.Working */) continue;
      const sid = agents.stationId[i];
      if (sid <= 0) continue;
      let effort = skill && workSpeedMult ? (0.5 + skill[i] * 0.1) * workSpeedMult[i] : 1;
      if (sick && sick[i] === 1) effort *= SICK_WORK_MULT;
      workerEffort.set(sid, (workerEffort.get(sid) ?? 0) + effort);
    }

    for (const s of this.stations) {
      const def = STATION_DEF_BY_NUM[s.typeId];
      if (!def || def.kind !== 'craft' || !def.recipe) continue;

      const workers = workerEffort.get(s.id) ?? 0;
      if (workers <= 0) continue;

      const recipe = def.recipe;
      const speedMult = stationSpeedMult ? stationSpeedMult(def.id) : 1;
      let progress = (this._progress.get(s.id) ?? 0) + minutesPerTick * workers * speedMult;

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

  // --- serialization ---
  // Only the three painted layers (wall/floor/roomType) plus the station list,
  // next-id and per-station progress are authoritative; the `station`/`roomId`
  // layers and `rooms` are re-derived on load (footprint re-stamp + rebuildRooms).

  serialize(): BuildGridSave {
    return {
      width: this.width,
      height: this.height,
      wall: bytesToB64(this.wall),
      gate: bytesToB64(this.gate),
      trap: bytesToB64(this.trap),
      terrain: bytesToB64(this.terrain),
      ore: bytesToB64(this.ore),
      zone: bytesToB64(this.zone),
      forage: bytesToB64(this.forage),
      saplingAge: bytesToB64(this.saplingAge),
      floor: bytesToB64(this.floor),
      roomType: bytesToB64(this.roomType),
      stations: this.stations.map((s) => ({ id: s.id, typeId: s.typeId, x: s.x, y: s.y, w: s.w, h: s.h })),
      nextStationId: this.nextStationId,
      progress: [...this._progress.entries()],
    };
  }

  static deserialize(data: BuildGridSave): BuildGrid {
    const g = new BuildGrid(data.width, data.height);
    g.wall.set(b64ToBytes(data.wall, g.size));
    if (data.gate) g.gate.set(b64ToBytes(data.gate, g.size)); // backfill: old saves have no gates
    if (data.trap) g.trap.set(b64ToBytes(data.trap, g.size)); // backfill: old saves have no traps
    if (data.terrain) g.terrain.set(b64ToBytes(data.terrain, g.size)); // backfill: old saves are all grass
    if (data.ore) g.ore.set(b64ToBytes(data.ore, g.size));
    if (data.zone) g.zone.set(b64ToBytes(data.zone, g.size)); // backfill: old saves have no zones
    if (data.forage) g.forage.set(b64ToBytes(data.forage, g.size)); // backfill: old saves have no deposits
    if (data.saplingAge) g.saplingAge.set(b64ToBytes(data.saplingAge, g.size));
    g.floor.set(b64ToBytes(data.floor, g.size));
    g.roomType.set(b64ToBytes(data.roomType, g.size));
    for (const s of data.stations) {
      g.stations.push({ ...s, roomId: -1 });
      for (let dy = 0; dy < s.h; dy++) {
        for (let dx = 0; dx < s.w; dx++) {
          if (g.inBounds(s.x + dx, s.y + dy)) g.station[g.index(s.x + dx, s.y + dy)] = s.id;
        }
      }
    }
    g.nextStationId = data.nextStationId;
    for (const [id, p] of data.progress) g._progress.set(id, p);
    g.rebuildRooms();
    return g;
  }

  /** Aggregate everything a room delivers, summed over its valid stations. */
  roomOutput(room: Room): RoomOutput {
    const out: RoomOutput = { sleep: 0, recreation: 0, education: 0, medical: 0, storage: 0, burial: 0, watch: 0, well: 0, trade: 0, drill: 0, faith: 0, flow: {} };
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
if (typeof process !== 'undefined' && process.argv[1]?.endsWith('/build.ts')) {
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
