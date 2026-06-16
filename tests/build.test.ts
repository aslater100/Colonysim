import { describe, expect, it } from 'vitest';
import { BuildGrid, TERRAIN, ZONE } from '../src/sim/build';
import { ROOM_TYPE_ID, STATION_TYPE_ID, ROOM_DEFS, STATION_DEFS } from '../src/sim/defs';
import { Rng } from '../src/sim/rng';

// Songs-of-Syx build model on the scale engine: walls + floors + a designated room
// whose output is the SUM of the workstations placed inside it. Rooms are derived
// by flood-fill, never placed.

const MILL = ROOM_TYPE_ID.get('mill')!;
const HOME = ROOM_TYPE_ID.get('home')!;
const KITCHEN = ROOM_TYPE_ID.get('kitchen')!;

describe('data: room & station defs', () => {
  it('assigns 1-based numeric ids and never 0', () => {
    expect(ROOM_TYPE_ID.get(ROOM_DEFS[0].id)).toBe(1);
    expect(STATION_TYPE_ID.get(STATION_DEFS[0].id)).toBe(1);
    for (const v of ROOM_TYPE_ID.values()) expect(v).toBeGreaterThan(0);
  });

  it('every station targets a real room type', () => {
    for (const s of STATION_DEFS) {
      for (const rt of s.roomTypes) expect(ROOM_TYPE_ID.has(rt)).toBe(true);
    }
  });
});

describe('BuildGrid — layers', () => {
  it('walls block passability, floors do not', () => {
    const g = new BuildGrid(10, 10);
    expect(g.passable(5, 5)).toBe(true);
    g.setFloor(5, 5);
    expect(g.passable(5, 5)).toBe(true); // floor is walkable
    g.setWall(5, 5);
    expect(g.passable(5, 5)).toBe(false);
    g.clearWall(5, 5);
    expect(g.passable(5, 5)).toBe(true);
    expect(g.passable(-1, 5)).toBe(false); // out of bounds
  });

  it('cannot designate a tile without floor; clearing floor clears designation', () => {
    const g = new BuildGrid(10, 10);
    expect(g.designate(3, 3, MILL)).toBe(false); // no floor yet
    g.setFloor(3, 3);
    expect(g.designate(3, 3, MILL)).toBe(true);
    g.clearFloor(3, 3);
    expect(g.roomType[g.index(3, 3)]).toBe(0);
  });
});

describe('BuildGrid — room derivation', () => {
  it('flood-fills connected same-type floor into one room', () => {
    const g = new BuildGrid(16, 16);
    const n = g.designateRect(2, 2, 5, 4, MILL); // 4×3
    expect(n).toBe(12);
    g.rebuildRooms();
    expect(g.rooms).toHaveLength(1);
    expect(g.rooms[0].area).toBe(12);
    expect(g.rooms[0].typeId).toBe(MILL);
  });

  it('splits different designations into separate rooms', () => {
    const g = new BuildGrid(16, 16);
    g.designateRect(2, 2, 4, 4, MILL);
    g.designateRect(5, 2, 7, 4, KITCHEN); // adjacent but different type
    g.rebuildRooms();
    expect(g.rooms).toHaveLength(2);
    const types = g.rooms.map((r) => r.typeId).sort();
    expect(types).toEqual([MILL, KITCHEN].sort());
  });

  it('a wall splits one designation into two rooms', () => {
    const g = new BuildGrid(16, 16);
    g.designateRect(2, 2, 7, 4, MILL); // 6×3 contiguous
    g.rebuildRooms();
    expect(g.rooms).toHaveLength(1);
    // Drop a full-height wall down the middle (x=4) — note designateRect skips wall
    // tiles, so re-designate after walling.
    for (let y = 2; y <= 4; y++) g.setWall(4, y);
    g.rebuildRooms();
    expect(g.rooms).toHaveLength(2);
  });

  it('marks a walled-in room enclosed and an open yard not', () => {
    const g = new BuildGrid(16, 16);
    g.designateRect(3, 3, 6, 6, HOME);
    g.rebuildRooms();
    expect(g.rooms[0].enclosed).toBe(false); // open ground all round
    for (let x = 2; x <= 7; x++) { g.setWall(x, 2); g.setWall(x, 7); }
    for (let y = 2; y <= 7; y++) { g.setWall(2, y); g.setWall(7, y); }
    g.rebuildRooms();
    expect(g.rooms[0].enclosed).toBe(true);
  });
});

describe('BuildGrid — stations & output', () => {
  it('rejects stations off-floor, on walls, or overlapping', () => {
    const g = new BuildGrid(16, 16);
    expect(g.placeStation('millstone', 2, 2)).toBeNull(); // no floor
    g.designateRect(2, 2, 6, 5, MILL);
    expect(g.placeStation('millstone', 2, 2)).not.toBeNull();
    expect(g.placeStation('millstone', 2, 2)).toBeNull(); // overlaps the first
    g.setWall(5, 2);
    expect(g.placeStation('millstone', 4, 2)).toBeNull(); // footprint hits the wall
  });

  it("output is the sum of a room's valid stations", () => {
    const g = new BuildGrid(20, 20);
    g.designateRect(2, 2, 9, 5, MILL);
    g.placeStation('millstone', 2, 2);
    g.placeStation('millstone', 4, 2);
    g.placeStation('millstone', 6, 2);
    g.rebuildRooms();
    expect(g.rooms[0].stationIds).toHaveLength(3);
    const out = g.roomOutput(g.rooms[0]);
    expect(out.flow.flour).toBe(9); // 3 millstones × +3
    expect(out.flow.grain).toBe(-9); // 3 × -3
  });

  it('beds in a home add sleep capacity', () => {
    const g = new BuildGrid(16, 16);
    g.designateRect(3, 3, 8, 6, HOME);
    g.placeStation('bed', 3, 3);
    g.placeStation('bunk', 5, 3);
    g.rebuildRooms();
    const out = g.roomOutput(g.rooms[0]);
    expect(out.sleep).toBe(1 + 3); // bed (1) + bunk (3)
  });

  it('a station of the wrong type for its room is inert', () => {
    const g = new BuildGrid(16, 16);
    g.designateRect(2, 2, 6, 5, MILL); // a mill...
    const bed = g.placeStation('bed', 2, 2); // ...with a bed dropped in
    expect(bed).not.toBeNull();
    g.rebuildRooms();
    expect(g.rooms[0].stationIds).toHaveLength(0); // bed not accepted by 'mill'
    expect(bed!.roomId).toBe(-1);
  });

  it('removing a station updates the room aggregate', () => {
    const g = new BuildGrid(20, 20);
    g.designateRect(2, 2, 9, 5, MILL);
    const a = g.placeStation('millstone', 2, 2)!;
    g.placeStation('millstone', 4, 2);
    g.rebuildRooms();
    expect(g.roomOutput(g.rooms[0]).flow.flour).toBe(6);
    g.removeStation(a.id);
    g.rebuildRooms();
    expect(g.roomOutput(g.rooms[0]).flow.flour).toBe(3);
    expect(g.station[g.index(2, 2)]).toBe(-1); // tiles freed
  });

  // Gates: a passable opening that still seals a room (vs a bare gap, which leaks).
  function walledHome(): BuildGrid {
    const g = new BuildGrid(12, 12);
    g.designateRect(2, 2, 5, 5, HOME);
    for (let x = 1; x <= 6; x++) { g.setWall(x, 1); g.setWall(x, 6); }
    for (let y = 1; y <= 6; y++) { g.setWall(1, y); g.setWall(6, y); }
    return g;
  }

  it('a gate keeps a room enclosed while staying passable; a bare gap leaks', () => {
    const g = walledHome();
    g.setGate(3, 6);
    g.rebuildRooms();
    expect(g.passable(3, 6)).toBe(true);     // settlers can walk through
    expect(g.rooms[0].enclosed).toBe(true);  // …but the room is still sealed

    g.clearGate(3, 6); g.clearWall(3, 6);    // turn the gate into a bare hole
    g.rebuildRooms();
    expect(g.rooms[0].enclosed).toBe(false); // now it leaks
  });

  it('round-trips the gate layer', () => {
    const g = walledHome();
    g.setGate(3, 6);
    g.rebuildRooms();
    const r = BuildGrid.deserialize(g.serialize());
    expect(r.gate[r.index(3, 6)]).toBe(1);
    expect(r.rooms[0].enclosed).toBe(true);
  });
});

// --- B-6 PART 3: terrain layer (forests/water/rock/ore under the build layers) ---
describe('terrain layer', () => {
  it('a fresh grid is all grass and fully passable', () => {
    const g = new BuildGrid(16, 16);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        expect(g.terrainAt(x, y)).toBe(TERRAIN.GRASS);
        expect(g.passable(x, y)).toBe(true);
        expect(g.terrainBlocks(x, y)).toBe(false);
      }
    }
  });

  it('forest, water and rock block movement; grass and soil do not', () => {
    const g = new BuildGrid(8, 8);
    g.setTerrain(1, 1, TERRAIN.TREE);
    g.setTerrain(2, 2, TERRAIN.WATER);
    g.setTerrain(3, 3, TERRAIN.ROCK);
    g.setTerrain(4, 4, TERRAIN.SOIL);
    expect(g.passable(1, 1)).toBe(false);
    expect(g.passable(2, 2)).toBe(false);
    expect(g.passable(3, 3)).toBe(false);
    expect(g.passable(4, 4)).toBe(true); // soil is walkable farmland
    expect(g.passable(5, 5)).toBe(true); // untouched grass
  });

  it('out-of-bounds reads as impassable water', () => {
    const g = new BuildGrid(8, 8);
    expect(g.terrainAt(-1, 0)).toBe(TERRAIN.WATER);
    expect(g.terrainBlocks(99, 99)).toBe(false); // OOB is not "a blocking tile", just absent
    expect(g.passable(-1, 0)).toBe(false);
  });

  it('ore only persists on rock; changing terrain clears it', () => {
    const g = new BuildGrid(8, 8);
    g.setTerrain(2, 2, TERRAIN.ROCK);
    g.ore[g.index(2, 2)] = 1;
    expect(g.hasOre(2, 2)).toBe(true);
    g.setTerrain(2, 2, TERRAIN.GRASS); // dug out / cleared
    expect(g.hasOre(2, 2)).toBe(false);
  });

  it('generateTerrain is deterministic for a seed and varies across seeds', () => {
    const a = new BuildGrid(96, 96); a.generateTerrain(new Rng(42));
    const b = new BuildGrid(96, 96); b.generateTerrain(new Rng(42));
    const c = new BuildGrid(96, 96); c.generateTerrain(new Rng(7));
    expect(Array.from(a.terrain)).toEqual(Array.from(b.terrain));
    expect(Array.from(a.ore)).toEqual(Array.from(b.ore));
    expect(Array.from(a.terrain)).not.toEqual(Array.from(c.terrain));
  });

  it('generateTerrainHeightmap: deterministic, SoS-style bands, buildable heart', () => {
    const a = new BuildGrid(96, 96); a.generateTerrainHeightmap(new Rng(42));
    const b = new BuildGrid(96, 96); b.generateTerrainHeightmap(new Rng(42));
    const c = new BuildGrid(96, 96); c.generateTerrainHeightmap(new Rng(7));
    expect(Array.from(a.terrain)).toEqual(Array.from(b.terrain)); // deterministic
    expect(Array.from(a.terrain)).not.toEqual(Array.from(c.terrain)); // seed varies
    const kinds = new Set(a.terrain);
    expect(kinds.has(TERRAIN.WATER)).toBe(true);  // seas
    expect(kinds.has(TERRAIN.GRASS)).toBe(true);  // land
    expect(kinds.has(TERRAIN.ROCK)).toBe(true);   // mountains
    expect(a.terrainAt(48, 48)).toBe(TERRAIN.GRASS); // buildable heart for the colony
    for (let i = 0; i < a.size; i++) if (a.ore[i]) expect(a.terrain[i]).toBe(TERRAIN.ROCK);
  });

  it('scatters wild forage deposits on grass; FORAGE zone only works a deposit', () => {
    const g = new BuildGrid(96, 96); g.generateTerrainHeightmap(new Rng(42));
    let deposits = 0, offGrass = 0;
    for (let i = 0; i < g.size; i++) {
      if (!g.forage[i]) continue;
      deposits++;
      if (g.terrain[i] !== TERRAIN.GRASS) offGrass++;
    }
    expect(deposits).toBeGreaterThan(0);   // deposits exist
    expect(offGrass).toBe(0);              // …only on grass
    // FORAGE zone requires an actual deposit, not just any grass.
    const dep = g.forage.findIndex((v, i) => v && g.terrain[i] === TERRAIN.GRASS);
    const bare = g.terrain.findIndex((t, i) => t === TERRAIN.GRASS && !g.forage[i]);
    expect(g.setZone(dep % 96, (dep / 96) | 0, ZONE.FORAGE)).toBe(true);
    expect(g.setZone(bare % 96, (bare / 96) | 0, ZONE.FORAGE)).toBe(false);
  });

  it('generates a mixed landscape with a buildable grass heart and ore only on rock', () => {
    const g = new BuildGrid(96, 96); g.generateTerrain(new Rng(123));
    const counts = [0, 0, 0, 0, 0];
    for (let i = 0; i < g.size; i++) counts[g.terrain[i]]++;
    expect(counts[TERRAIN.GRASS]).toBeGreaterThan(0);
    expect(counts[TERRAIN.TREE]).toBeGreaterThan(0);
    expect(counts[TERRAIN.WATER]).toBeGreaterThan(0);
    expect(counts[TERRAIN.ROCK]).toBeGreaterThan(0);
    // every ore tile sits on rock
    for (let i = 0; i < g.size; i++) {
      if (g.ore[i] === 1) expect(g.terrain[i]).toBe(TERRAIN.ROCK);
    }
    // the heart clearing is walkable grass
    const cx = 48, cy = 48;
    for (let y = cy - 8; y <= cy + 8; y++) {
      for (let x = cx - 12; x <= cx + 12; x++) {
        expect(g.terrainBlocks(x, y)).toBe(false);
      }
    }
  });

  it('round-trips terrain and ore through serialize/deserialize', () => {
    const g = new BuildGrid(96, 96); g.generateTerrain(new Rng(99));
    const r = BuildGrid.deserialize(g.serialize());
    expect(Array.from(r.terrain)).toEqual(Array.from(g.terrain));
    expect(Array.from(r.ore)).toEqual(Array.from(g.ore));
  });

  it('a pre-terrain save (no terrain field) loads as all grass', () => {
    const g = new BuildGrid(8, 8);
    const save = g.serialize();
    delete save.terrain; delete save.ore; // simulate an old save
    const r = BuildGrid.deserialize(save);
    for (let i = 0; i < r.size; i++) expect(r.terrain[i]).toBe(TERRAIN.GRASS);
  });
});

// --- B-6 PART 3: harvest zones (Songs-of-Syx primary production) ---
describe('harvest zones', () => {
  it('only designates a zone on matching terrain', () => {
    const g = new BuildGrid(8, 8);
    g.setTerrain(1, 1, TERRAIN.SOIL);
    g.setTerrain(2, 2, TERRAIN.TREE);
    expect(g.setZone(1, 1, ZONE.FIELD)).toBe(true);       // soil → field ok
    expect(g.setZone(1, 1, ZONE.WOODCUTTER)).toBe(false); // soil ≠ tree
    expect(g.setZone(2, 2, ZONE.WOODCUTTER)).toBe(true);  // tree → woodcutter ok
    expect(g.zoneAt(1, 1)).toBe(ZONE.FIELD);
    expect(g.zoneAt(2, 2)).toBe(ZONE.WOODCUTTER);
  });

  it('a fishery needs a dry tile next to water', () => {
    const g = new BuildGrid(8, 8);
    g.setTerrain(3, 3, TERRAIN.WATER);
    expect(g.setZone(3, 4, ZONE.FISHERY)).toBe(true);  // grass beside water
    expect(g.setZone(3, 3, ZONE.FISHERY)).toBe(false); // on the water itself
    expect(g.setZone(6, 6, ZONE.FISHERY)).toBe(false); // far from water
  });

  it('round-trips the zone layer', () => {
    const g = new BuildGrid(8, 8);
    g.setTerrain(1, 1, TERRAIN.SOIL); g.setZone(1, 1, ZONE.FIELD);
    const r = BuildGrid.deserialize(g.serialize());
    expect(r.zoneAt(1, 1)).toBe(ZONE.FIELD);
  });
});
