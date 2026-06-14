/**
 * Needs from rooms — B-4 of the build-system rewrite (part of scale-engine Stage 4).
 *
 * In the Songs-of-Syx model a room's capacity stations are need-satisfiers: beds
 * are rest slots, tavern tables are recreation slots, an enclosed (walled) room is
 * shelter that keeps warmth up. This module reads those capacities off the
 * `BuildGrid` and applies them to the SoA agent need columns:
 *
 *   - WARMTH — an agent standing in an enclosed room warms toward 100; exposed, it
 *     cools toward an ambient floor. Enclosure shelters everyone inside (no slot
 *     limit), mirroring the live sim's hearth/indoor warmth.
 *   - REST — a Sleeping agent in a room with free bed capacity (`sleep`) recovers
 *     rest; the number of beds caps simultaneous sleepers.
 *   - RECREATION — an agent in a room with free recreation capacity (tavern tables)
 *     recovers recreation, capacity-gated the same way.
 *
 * `aggregateCapacities()` also rolls the whole town's room capacities into one
 * services total (sleep / recreation / education / medical / storage) — the hook
 * the housing cap, schooling, infirmary and stockpile-limit systems read later.
 * Rooms whose type `enclosedRequired` but that aren't walled yet contribute
 * nothing (an unroofed home houses no one).
 *
 * Pure, DOM-free, additive — same ethos as `agents.ts` / `build.ts` / `jobs.ts`.
 * Kept out of `AgentStore.tick` so the bench still reads the movement cost floor;
 * the caller sequences `serveNeeds()` as its own pass.
 *
 * Run the self-check:  npx tsx src/sim/needs.ts
 */
import type { BuildGrid, Room, RoomOutput } from './build';
import type { AgentStore } from './agents';
import { AState } from './agents';
import { ROOM_DEF_BY_NUM } from './defs';
// Runtime imports used only by the self-check (guarded self-checks won't fire on import).
import { BuildGrid as BuildGridImpl } from './build';
import { AgentStore as AgentStoreImpl } from './agents';
import { ROOM_TYPE_ID, MINUTES_PER_TICK } from './defs';

/** Town-wide sum of every usable room's capacities. */
export interface RoomServices {
  sleep: number;
  recreation: number;
  education: number;
  medical: number;
  storage: number;
}

// Per-hour need rates (aligned with TUNING.sleepRestPerHour.bed / recreationPerHour
// and the warmth model). Scaled by minutesPerTick/60 each tick.
export const WARMTH_REGEN_ENCLOSED = 12;
export const WARMTH_DECAY_EXPOSED = 3;
export const WARMTH_AMBIENT_FLOOR = 50;
export const REST_REGEN_BED = 9;
export const RECREATION_REGEN = 12;

const EMPTY_OUTPUT: RoomOutput = { sleep: 0, recreation: 0, education: 0, medical: 0, storage: 0, flow: {} };

/** Is this room currently usable (an enclosure-required type must be walled in)? */
function roomUsable(room: Room): boolean {
  const def = ROOM_DEF_BY_NUM[room.typeId];
  return !(def?.enclosedRequired && !room.enclosed);
}

/** The room under tile (x, y), or null. */
export function roomAt(grid: BuildGrid, x: number, y: number): Room | null {
  if (!grid.inBounds(x, y)) return null;
  const rid = grid.roomId[grid.index(x, y)];
  return rid >= 0 ? grid.rooms[rid] : null;
}

/** Town-wide service capacities, summing only usable rooms. Call after rebuildRooms(). */
export function aggregateCapacities(grid: BuildGrid): RoomServices {
  const out: RoomServices = { sleep: 0, recreation: 0, education: 0, medical: 0, storage: 0 };
  for (const room of grid.rooms) {
    if (!roomUsable(room)) continue;
    const o = grid.roomOutput(room);
    out.sleep += o.sleep;
    out.recreation += o.recreation;
    out.education += o.education;
    out.medical += o.medical;
    out.storage += o.storage;
  }
  return out;
}

/**
 * Apply one tick of room-driven need recovery to every agent. Allocation is one
 * small Map per call (room count, not agent count); the per-agent body is O(1).
 */
export function serveNeeds(grid: BuildGrid, agents: AgentStore, minutesPerTick: number): void {
  const hours = minutesPerTick / 60;
  // Cache each room's usable output once (rooms ≪ agents).
  const outputs = new Map<number, RoomOutput>();
  for (const room of grid.rooms) {
    outputs.set(room.id, roomUsable(room) ? grid.roomOutput(room) : EMPTY_OUTPUT);
  }
  const restUsed = new Map<number, number>();
  const recUsed = new Map<number, number>();

  for (let i = 0; i < agents.count; i++) {
    const x = Math.floor(agents.posX[i]);
    const y = Math.floor(agents.posY[i]);
    const rid = grid.inBounds(x, y) ? grid.roomId[grid.index(x, y)] : -1;
    const room = rid >= 0 ? grid.rooms[rid] : null;

    // Warmth: enclosure shelters all occupants; otherwise drift to the ambient floor.
    if (room && room.enclosed) {
      const w = agents.warmth[i] + WARMTH_REGEN_ENCLOSED * hours;
      agents.warmth[i] = w < 100 ? w : 100;
    } else {
      // Hardy settlers (warmthDecayMult < 1) shrug off the cold; the floor is unchanged.
      const w = agents.warmth[i] - WARMTH_DECAY_EXPOSED * hours * agents.warmthDecayMult[i];
      agents.warmth[i] = w > WARMTH_AMBIENT_FLOOR ? w : WARMTH_AMBIENT_FLOOR;
    }

    if (!room) continue;
    const out = outputs.get(rid)!;

    // Rest: a sleeping agent recovers if a bed slot is free.
    if (agents.state[i] === AState.Sleeping && out.sleep > 0) {
      const used = restUsed.get(rid) ?? 0;
      if (used < out.sleep) {
        const r = agents.rest[i] + REST_REGEN_BED * hours;
        agents.rest[i] = r < 100 ? r : 100;
        restUsed.set(rid, used + 1);
      }
    }

    // Recreation: an agent in a room with a free recreation slot unwinds.
    if (out.recreation > 0) {
      const used = recUsed.get(rid) ?? 0;
      if (used < out.recreation) {
        const rc = agents.recreation[i] + RECREATION_REGEN * hours;
        agents.recreation[i] = rc < 100 ? rc : 100;
        recUsed.set(rid, used + 1);
      }
    }
  }
}

// --- self-check: npx tsx src/sim/needs.ts ---
if (typeof process !== 'undefined' && process.argv[1]?.endsWith('/needs.ts')) {
  const HOME = ROOM_TYPE_ID.get('home')!;
  const TAVERN = ROOM_TYPE_ID.get('tavern')!;

  // An enclosed home with two beds.
  const g = new BuildGridImpl(16, 16);
  g.designateRect(2, 2, 6, 6, HOME);
  for (let x = 1; x <= 7; x++) { g.setWall(x, 1); g.setWall(x, 7); }
  for (let y = 1; y <= 7; y++) { g.setWall(1, y); g.setWall(7, y); }
  g.placeStation('bed', 2, 2);
  g.placeStation('bed', 4, 2);
  g.rebuildRooms();

  const caps = aggregateCapacities(g);
  console.assert(caps.sleep === 2, `two beds → sleep 2 (got ${caps.sleep})`);

  const agents = new AgentStoreImpl(8);
  const a = agents.spawn(3, 3); // inside the home
  agents.state[a] = AState.Sleeping;
  agents.rest[a] = 40;
  agents.warmth[a] = 60;
  serveNeeds(g, agents, MINUTES_PER_TICK);
  console.assert(agents.rest[a] > 40, 'slept in a bed → rest recovered');
  console.assert(agents.warmth[a] > 60, 'enclosed → warmth recovered');

  // An exposed agent (no room) cools toward the ambient floor.
  const b = agents.spawn(12, 12);
  agents.warmth[b] = 80;
  serveNeeds(g, agents, MINUTES_PER_TICK);
  console.assert(agents.warmth[b] < 80, 'exposed → warmth decayed');

  // Unwalled home contributes no capacity.
  const open = new BuildGridImpl(16, 16);
  open.designateRect(2, 2, 6, 6, HOME);
  open.placeStation('bed', 2, 2);
  open.rebuildRooms();
  console.assert(aggregateCapacities(open).sleep === 0, 'unenclosed home houses no one');

  // Tavern tables give recreation capacity.
  const t = new BuildGridImpl(16, 16);
  t.designateRect(2, 2, 6, 6, TAVERN);
  for (let x = 1; x <= 7; x++) { t.setWall(x, 1); t.setWall(x, 7); }
  for (let y = 1; y <= 7; y++) { t.setWall(1, y); t.setWall(7, y); }
  t.placeStation('table', 2, 2); // recreation amount 2
  t.rebuildRooms();
  console.assert(aggregateCapacities(t).recreation === 2, 'one table → recreation 2');

  console.log('needs.ts self-check OK — town sleep', caps.sleep, 'rec', aggregateCapacities(t).recreation);
}
