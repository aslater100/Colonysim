import { describe, expect, it } from 'vitest';
import { BuildGrid } from '../src/sim/build';
import { ROOM_TYPE_ID, STATION_TYPE_ID, ROOM_DEFS, STATION_DEFS } from '../src/sim/defs';

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
