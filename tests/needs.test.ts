import { describe, expect, it } from 'vitest';
import {
  aggregateCapacities, serveNeeds, roomAt,
  WARMTH_AMBIENT_FLOOR,
} from '../src/sim/needs';
import { BuildGrid } from '../src/sim/build';
import { AgentStore, AState } from '../src/sim/agents';
import { ROOM_TYPE_ID, MINUTES_PER_TICK } from '../src/sim/defs';

// Build-system B-4 / scale-engine Stage 4 slice: rooms drive agent needs.
// Beds → rest, enclosure → warmth, tavern tables → recreation. Pure + additive.

const HOME = ROOM_TYPE_ID.get('home')!;
const TAVERN = ROOM_TYPE_ID.get('tavern')!;
const LIBRARY = ROOM_TYPE_ID.get('library')!;
const INFIRMARY = ROOM_TYPE_ID.get('infirmary')!;

/** Build an enclosed room of `type` spanning (x0,y0)-(x1,y1) with a 1-tile wall ring. */
function enclosedRoom(type: number, x0: number, y0: number, x1: number, y1: number): BuildGrid {
  const g = new BuildGrid(24, 24);
  g.designateRect(x0, y0, x1, y1, type);
  for (let x = x0 - 1; x <= x1 + 1; x++) { g.setWall(x, y0 - 1); g.setWall(x, y1 + 1); }
  for (let y = y0 - 1; y <= y1 + 1; y++) { g.setWall(x0 - 1, y); g.setWall(x1 + 1, y); }
  return g;
}

describe('aggregateCapacities', () => {
  it('sums sleep capacity over beds in an enclosed home', () => {
    const g = enclosedRoom(HOME, 2, 2, 6, 6);
    g.placeStation('bed', 2, 2);   // sleep 1
    g.placeStation('bunk', 4, 2);  // sleep 3
    g.rebuildRooms();
    expect(aggregateCapacities(g).sleep).toBe(4);
  });

  it('an enclosure-required room that is not walled contributes nothing', () => {
    const g = new BuildGrid(16, 16);
    g.designateRect(2, 2, 6, 6, HOME); // no walls
    g.placeStation('bed', 2, 2);
    g.rebuildRooms();
    expect(g.rooms[0].enclosed).toBe(false);
    expect(aggregateCapacities(g).sleep).toBe(0);
  });

  it('open-yard room types still count (no enclosure required)', () => {
    // Storehouse is enclosedRequired:false — a shelf counts even unwalled.
    const STORE = ROOM_TYPE_ID.get('storehouse')!;
    const g = new BuildGrid(16, 16);
    g.designateRect(2, 2, 6, 6, STORE);
    g.placeStation('shelf', 2, 2); // storage 50
    g.rebuildRooms();
    expect(aggregateCapacities(g).storage).toBe(50);
  });

  it('rolls up recreation, education and medical across rooms', () => {
    const tav = enclosedRoom(TAVERN, 2, 2, 6, 6);
    tav.placeStation('table', 2, 2); // recreation 2
    tav.rebuildRooms();
    expect(aggregateCapacities(tav).recreation).toBe(2);

    const lib = enclosedRoom(LIBRARY, 2, 2, 6, 6);
    lib.placeStation('desk', 2, 2); // education 1
    lib.rebuildRooms();
    expect(aggregateCapacities(lib).education).toBe(1);

    const inf = enclosedRoom(INFIRMARY, 2, 2, 6, 6);
    inf.placeStation('sickbed', 2, 2); // medical 1
    inf.rebuildRooms();
    expect(aggregateCapacities(inf).medical).toBe(1);
  });
});

describe('roomAt', () => {
  it('returns the room under a tile, null outside any room', () => {
    const g = enclosedRoom(HOME, 3, 3, 6, 6);
    g.rebuildRooms();
    expect(roomAt(g, 4, 4)?.typeId).toBe(HOME);
    expect(roomAt(g, 20, 20)).toBeNull();
    expect(roomAt(g, -1, 4)).toBeNull(); // out of bounds
  });
});

describe('serveNeeds — warmth', () => {
  it('an enclosed agent warms up; an exposed one cools to the ambient floor', () => {
    const g = enclosedRoom(HOME, 3, 3, 8, 8);
    g.placeStation('bed', 3, 3);
    g.rebuildRooms();
    const agents = new AgentStore(4);
    const inside = agents.spawn(5, 5);
    const outside = agents.spawn(20, 20);
    agents.warmth[inside] = 60;
    agents.warmth[outside] = 80;
    serveNeeds(g, agents, MINUTES_PER_TICK);
    expect(agents.warmth[inside]).toBeGreaterThan(60);
    expect(agents.warmth[outside]).toBeLessThan(80);
  });

  it('warmth never drops below the ambient floor for the exposed', () => {
    const g = new BuildGrid(8, 8);
    g.rebuildRooms();
    const agents = new AgentStore(2);
    const a = agents.spawn(4, 4);
    agents.warmth[a] = WARMTH_AMBIENT_FLOOR + 1;
    for (let t = 0; t < 100; t++) serveNeeds(g, agents, MINUTES_PER_TICK);
    expect(agents.warmth[a]).toBe(WARMTH_AMBIENT_FLOOR);
  });

  it('warmth never exceeds 100 for the sheltered', () => {
    const g = enclosedRoom(HOME, 3, 3, 6, 6);
    g.rebuildRooms();
    const agents = new AgentStore(2);
    const a = agents.spawn(4, 4);
    agents.warmth[a] = 99;
    for (let t = 0; t < 100; t++) serveNeeds(g, agents, MINUTES_PER_TICK);
    expect(agents.warmth[a]).toBe(100);
  });
});

describe('serveNeeds — rest from beds', () => {
  it('a sleeping agent in a bedded room recovers rest', () => {
    const g = enclosedRoom(HOME, 3, 3, 8, 8);
    g.placeStation('bed', 3, 3);
    g.rebuildRooms();
    const agents = new AgentStore(4);
    const a = agents.spawn(5, 5);
    agents.state[a] = AState.Sleeping;
    agents.rest[a] = 30;
    serveNeeds(g, agents, MINUTES_PER_TICK);
    expect(agents.rest[a]).toBeGreaterThan(30);
  });

  it('a non-sleeping agent in the same room gets no rest benefit', () => {
    const g = enclosedRoom(HOME, 3, 3, 8, 8);
    g.placeStation('bed', 3, 3);
    g.rebuildRooms();
    const agents = new AgentStore(4);
    const a = agents.spawn(5, 5);
    agents.state[a] = AState.Idle;
    agents.rest[a] = 30;
    serveNeeds(g, agents, MINUTES_PER_TICK);
    expect(agents.rest[a]).toBe(30);
  });

  it('bed capacity caps how many sleepers recover at once', () => {
    const g = enclosedRoom(HOME, 3, 3, 8, 8);
    g.placeStation('bed', 3, 3); // exactly one bed → sleep capacity 1
    g.rebuildRooms();
    const agents = new AgentStore(4);
    const a = agents.spawn(5, 5);
    const b = agents.spawn(6, 6);
    agents.state[a] = AState.Sleeping;
    agents.state[b] = AState.Sleeping;
    agents.rest[a] = 30;
    agents.rest[b] = 30;
    serveNeeds(g, agents, MINUTES_PER_TICK);
    // One bed → exactly one of the two sleepers recovers this tick.
    const recovered = [a, b].filter((i) => agents.rest[i] > 30).length;
    expect(recovered).toBe(1);
  });
});

describe('serveNeeds — recreation from tables', () => {
  it('an agent in a tavern with a free table recovers recreation', () => {
    const g = enclosedRoom(TAVERN, 3, 3, 8, 8);
    g.placeStation('table', 3, 3); // recreation capacity 2
    g.rebuildRooms();
    const agents = new AgentStore(4);
    const a = agents.spawn(5, 5);
    agents.recreation[a] = 20;
    serveNeeds(g, agents, MINUTES_PER_TICK);
    expect(agents.recreation[a]).toBeGreaterThan(20);
  });

  it('recreation slots cap how many agents unwind at once', () => {
    const g = enclosedRoom(TAVERN, 3, 3, 10, 10);
    g.placeStation('table', 3, 3); // capacity 2
    g.rebuildRooms();
    const agents = new AgentStore(8);
    const ids = [agents.spawn(5, 5), agents.spawn(6, 6), agents.spawn(7, 7)];
    for (const i of ids) agents.recreation[i] = 20;
    serveNeeds(g, agents, MINUTES_PER_TICK);
    const recovered = ids.filter((i) => agents.recreation[i] > 20).length;
    expect(recovered).toBe(2); // one table seats two
  });
});
