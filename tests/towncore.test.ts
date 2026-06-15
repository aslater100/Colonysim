import { describe, expect, it } from 'vitest';
import { TownCore } from '../src/sim/towncore';
import { BuildGrid } from '../src/sim/build';
import { AgentStore, AState } from '../src/sim/agents';
import { Stockpile } from '../src/sim/stockpile';
import { ROOM_TYPE_ID } from '../src/sim/defs';

// Build-system B-6: the integrated room-based town core that composes every
// scale-engine module (BuildGrid + AgentStore + Stockpile + JobBoard + needs +
// FlowField) into one deterministic, serializable simulation — the swap candidate
// for the live fat-object `Simulation`.

const KITCHEN = ROOM_TYPE_ID.get('kitchen')!;
const HOME = ROOM_TYPE_ID.get('home')!;

/** A core seeded with a walled kitchen (n ovens) + a walled home (n beds). */
function colony(opts: { ovens?: number; beds?: number; grain?: number; pop?: number; seed?: number } = {}): TownCore {
  const core = new TownCore({ width: 32, height: 32, seed: opts.seed ?? 11 });
  const g = core.grid;

  g.designateRect(2, 2, 9, 5, KITCHEN);
  for (let x = 1; x <= 10; x++) { g.setWall(x, 1); g.setWall(x, 6); }
  for (let y = 1; y <= 6; y++) { g.setWall(1, y); g.setWall(10, y); }
  for (let k = 0; k < (opts.ovens ?? 2); k++) g.placeStation('oven', 2 + k * 2, 2);

  g.designateRect(2, 9, 9, 12, HOME);
  for (let x = 1; x <= 10; x++) { g.setWall(x, 8); g.setWall(x, 13); }
  for (let y = 8; y <= 13; y++) { g.setWall(1, y); g.setWall(10, y); }
  for (let k = 0; k < (opts.beds ?? 2); k++) g.placeStation('bed', 2 + k * 2, 9);

  g.rebuildRooms();
  core.stock.add('grain', opts.grain ?? 500);
  core.seedColony(3, 3, opts.pop ?? 4);
  return core;
}

describe('TownCore production loop', () => {
  it('routes idle agents to open ovens and produces meals', () => {
    const core = colony({ ovens: 2, pop: 2 });
    core.run(40);
    expect(core.stock.count('meal')).toBeGreaterThan(0);
    // At least one agent ended up working a station during the run.
    const working = Array.from({ length: core.agents.count }, (_, i) => core.agents.stationId[i]).some((s) => s > 0);
    expect(working).toBe(true);
  });

  it('stalls production when inputs run dry (no negative stock)', () => {
    const core = colony({ ovens: 1, grain: 2, pop: 1 }); // one oven cycle worth of grain
    core.run(120);
    expect(core.stock.count('grain')).toBeGreaterThanOrEqual(0);
    expect(core.stock.count('meal')).toBeGreaterThanOrEqual(0);
  });
});

describe('TownCore room services', () => {
  it('sums bed capacity from the walled home', () => {
    const core = colony({ beds: 3 });
    expect(core.services().sleep).toBe(3);
  });

  it('an unwalled home contributes no housing', () => {
    const core = new TownCore({ width: 16, height: 16 });
    core.grid.designateRect(2, 2, 6, 6, HOME);
    core.grid.placeStation('bed', 2, 2);
    core.grid.rebuildRooms();
    expect(core.services().sleep).toBe(0);
  });
});

describe('TownCore population dynamics', () => {
  it('keeps a well-fed colony alive across multiple days', () => {
    const core = colony({ ovens: 3, beds: 6, grain: 5000, pop: 4 });
    core.run(360 * 4); // four game-days
    expect(core.population).toBeGreaterThan(0);
    expect(core.day).toBe(4);
  });

  it('swap-removes a starved agent and counts the death', () => {
    const core = colony({ pop: 3 });
    core.agents.health[0] = 0;
    core.agents.food[0] = 0; // starving → health bleeds below 0, swap-removed this tick
    const before = core.population;
    core.tick();
    expect(core.population).toBe(before - 1);
    expect(core.deaths).toBe(1);
  });
});

describe('TownCore serialization', () => {
  it('round-trips to an identical snapshot', () => {
    const core = colony({ ovens: 2, beds: 2, pop: 4 });
    core.run(75);
    const snap = JSON.stringify(core.serialize());
    const restored = TownCore.deserialize(JSON.parse(snap));
    expect(JSON.stringify(restored.serialize())).toBe(snap);
  });

  it('a restored core continues deterministically tick-for-tick', () => {
    const core = colony({ ovens: 2, beds: 2, pop: 4, seed: 99 });
    core.run(50);
    const twin = TownCore.deserialize(JSON.parse(JSON.stringify(core.serialize())));
    core.run(120);
    twin.run(120);
    expect(JSON.stringify(twin.serialize())).toBe(JSON.stringify(core.serialize()));
  });

  it('preserves build grid, stations and recipe progress', () => {
    const core = colony({ ovens: 2 });
    core.run(30);
    const restored = TownCore.deserialize(JSON.parse(JSON.stringify(core.serialize())));
    expect(restored.grid.stations.length).toBe(core.grid.stations.length);
    expect(restored.grid.rooms.length).toBe(core.grid.rooms.length);
    expect(restored.stock.count('meal')).toBe(core.stock.count('meal'));
  });

  it('musterRaid starts a raid now and reschedules the next', () => {
    const core = colony({ pop: 6 });
    core.musterRaid();
    expect(core.raidActive).toBe(true);
    expect(core.raids.raiders.length).toBeGreaterThan(0);
    expect(core.nextRaidDay).toBeGreaterThan(core.day); // pushed to a future day
    const scheduled = core.nextRaidDay;
    core.musterRaid(); // no-op while one is already running
    expect(core.nextRaidDay).toBe(scheduled);
  });
});

describe('scale-engine module serialization', () => {
  it('Stockpile round-trips its sparse contents', () => {
    const s = new Stockpile();
    s.add('grain', 12); s.add('meal', 4);
    const r = Stockpile.deserialize(s.serialize());
    expect(r.count('grain')).toBe(12);
    expect(r.count('meal')).toBe(4);
  });

  it('AgentStore round-trips every live column', () => {
    const a = new AgentStore(8);
    const i = a.spawn(5, 6);
    a.food[i] = 42; a.state[i] = AState.Working; a.stationId[i] = 3;
    const r = AgentStore.deserialize(a.serialize());
    expect(r.count).toBe(1);
    expect(r.food[0]).toBeCloseTo(42);
    expect(r.state[0]).toBe(AState.Working);
    expect(r.stationId[0]).toBe(3);
  });

  it('BuildGrid round-trips painted layers and stations', () => {
    const g = new BuildGrid(16, 16);
    g.designateRect(2, 2, 6, 4, KITCHEN);
    g.placeStation('oven', 2, 2);
    g.rebuildRooms();
    const r = BuildGrid.deserialize(g.serialize());
    expect(r.rooms.length).toBe(1);
    expect(r.stations.length).toBe(1);
    expect(r.roomOutput(r.rooms[0]).flow.meal).toBe(g.roomOutput(g.rooms[0]).flow.meal);
  });
});
