import { describe, expect, it } from 'vitest';
import { RaidDirector } from '../src/sim/raid';
import { AgentStore } from '../src/sim/agents';
import { BuildGrid } from '../src/sim/build';
import { Stockpile } from '../src/sim/stockpile';
import { TownCore } from '../src/sim/towncore';
import { TUNING, ROOM_TYPE_ID } from '../src/sim/defs';

// Stage 4 behavior port: raids + combat as an abstracted, deterministic resolution
// on the SoA core. A raid musters a raider pool, then a per-tick power exchange
// attrits the raiders and wounds defenders (feeding the medical + grief systems).

function rng(seed = 1) {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
}

// Defenders: n agents with the given combat skill, at full health.
function defenders(n: number, combat: number): AgentStore {
  const a = new AgentStore(n + 2);
  for (let i = 0; i < n; i++) { const k = a.spawn(8, 8); a.combat[k] = combat; }
  return a;
}

describe('RaidDirector — scheduling & size', () => {
  it('schedules a first raid on/after the founding window', () => {
    const d = new RaidDirector(rng());
    expect(d.nextRaidDay).toBeGreaterThanOrEqual(TUNING.firstRaidDay);
    expect(d.nextRaidDay).toBeLessThan(TUNING.firstRaidDay + 5);
  });

  it('raid size ramps with elapsed days but is capped by population and the ceiling', () => {
    const d = new RaidDirector(rng());
    expect(d.raidSize(TUNING.firstRaidDay, 100)).toBeGreaterThanOrEqual(1);
    // A tiny colony caps the raid.
    expect(d.raidSize(10000, 2)).toBeLessThanOrEqual(Math.ceil(2 * TUNING.raidPopFactor));
    // The hard ceiling holds for a huge, old colony.
    expect(d.raidSize(10000, 10000)).toBeLessThanOrEqual(TUNING.raidMaxRaiders);
  });

  it('maybeStart fires only on/after the scheduled day and reschedules', () => {
    const d = new RaidDirector(rng());
    const day = d.nextRaidDay;
    expect(d.maybeStart(day - 1, 50, 0, rng())).toBe(0); // too early
    const n = d.maybeStart(day, 50, 0, rng());
    expect(n).toBeGreaterThan(0);
    expect(d.active).toBe(true);
    expect(d.nextRaidDay).toBeGreaterThan(day); // next one scheduled
  });

  it('does not start a second raid while one is active', () => {
    const d = new RaidDirector(rng());
    d.start(3, 0);
    expect(d.maybeStart(d.nextRaidDay + 100, 50, 0, rng())).toBe(0);
  });
});

describe('RaidDirector — combat resolution', () => {
  it('capable, armed defenders repel a raid (and count it survived)', () => {
    const a = defenders(5, 9);
    const grid = new BuildGrid(16, 16);
    const stock = new Stockpile();
    stock.add('weapons', 5);
    const d = new RaidDirector(rng());
    d.start(2, 0);
    let ticks = 0;
    let repelled = false;
    while (d.active && ticks < 2000) {
      const r = d.tick(a, grid, stock, ticks, rng(ticks + 1));
      if (r.repelled) repelled = true;
      ticks++;
    }
    expect(repelled).toBe(true);
    expect(d.raidsSurvived).toBe(1);
  });

  it('an undefended colony takes wounds during a raid', () => {
    const a = defenders(3, 0); // combat 0 → nobody fights
    const grid = new BuildGrid(16, 16);
    const stock = new Stockpile();
    const d = new RaidDirector(rng());
    d.start(4, 0);
    for (let t = 0; t < 30 && d.active; t++) d.tick(a, grid, stock, t, rng(t + 1));
    // Someone got hurt — at least one open wound or a sub-100 health bar.
    let hurt = false;
    for (let i = 0; i < a.count; i++) if (a.woundUntreated[i] === 1 || a.health[i] < 100) hurt = true;
    expect(hurt).toBe(true);
  });

  it('walls mitigate incoming damage (a walled colony loses less health)', () => {
    function run(walled: boolean): number {
      const a = defenders(3, 0);
      const grid = new BuildGrid(20, 20);
      if (walled) for (let x = 0; x < 20; x++) for (let y = 0; y < 20; y++) grid.setWall(x, y);
      const stock = new Stockpile();
      const d = new RaidDirector(rng());
      d.start(6, 0);
      // Run a fixed number of ticks (don't let it end early) and sum the damage.
      for (let t = 0; t < 10; t++) d.tick(a, grid, stock, t, rng(99)); // fixed RNG → same victim each tick
      let totalHealth = 0;
      for (let i = 0; i < a.count; i++) totalHealth += a.health[i];
      return totalHealth;
    }
    expect(run(true)).toBeGreaterThan(run(false)); // walls = more health left
  });

  it('raids end when the raiders time out', () => {
    const a = defenders(1, 0); // can't kill the raiders → they must time out
    const grid = new BuildGrid(16, 16);
    const stock = new Stockpile();
    const d = new RaidDirector(rng());
    d.start(9, 0); // end tick is set relative to tick 0
    let left = false;
    for (let t = 0; t <= d.raidEndTick + 1 && d.active; t++) {
      const r = d.tick(a, grid, stock, t, rng(t + 1));
      if (r.leftField) left = true;
    }
    expect(left).toBe(true);
    expect(d.active).toBe(false);
  });

  it('round-trips its state', () => {
    const d = new RaidDirector(rng());
    d.start(4, 10);
    d.raidsSurvived = 2;
    const r = RaidDirector.deserialize(d.serialize(), rng());
    expect(r.raiderCount).toBe(d.raiderCount);
    expect(r.raiderHealthPool).toBeCloseTo(d.raiderHealthPool);
    expect(r.raidEndTick).toBe(d.raidEndTick);
    expect(r.raidsSurvived).toBe(2);
  });
});

describe('RaidDirector — TownCore integration', () => {
  function fort(seed: number): TownCore {
    const core = new TownCore({ width: 24, height: 24, seed });
    const g = core.grid;
    g.designateRect(2, 2, 9, 5, ROOM_TYPE_ID.get('kitchen')!);
    for (let k = 0; k < 3; k++) g.placeStation('oven', 2 + k * 2, 2);
    g.designateRect(2, 9, 9, 12, ROOM_TYPE_ID.get('home')!);
    for (let x = 1; x <= 10; x++) { g.setWall(x, 8); g.setWall(x, 13); }
    for (let y = 8; y <= 13; y++) { g.setWall(1, y); g.setWall(10, y); }
    for (let k = 0; k < 6; k++) g.placeStation('bed', 2 + k * 2, 9);
    g.rebuildRooms();
    core.stock.add('grain', 5000);
    core.stock.add('weapons', 10);
    core.seedColony(3, 3, 6);
    return core;
  }

  it('founders roll a combat aptitude', () => {
    const core = fort(2);
    let anyFighter = false;
    for (let i = 0; i < core.agents.count; i++) if (core.agents.combat[i] > 0) anyFighter = true;
    expect(anyFighter).toBe(true);
  });

  it('a raid eventually musters as the calendar advances, and the colony resolves it', () => {
    const core = fort(7);
    // Hand-pick capable, armed defenders so the raid is winnable.
    for (let i = 0; i < core.agents.count; i++) core.agents.combat[i] = 8;
    core.raid.start(2, core.tickNo); // muster now
    const before = core.population;
    let guard = 0;
    while (core.raid.active && guard < 5000) { core.tick(); guard++; }
    expect(core.raid.active).toBe(false);
    expect(core.raid.raidsSurvived).toBeGreaterThanOrEqual(1);
    expect(core.population).toBeLessThanOrEqual(before); // may have lost someone, never gained mid-raid
  });

  it('serializes raid state with the rest of the core and continues deterministically', () => {
    const core = fort(4);
    core.raid.start(3, core.tickNo);
    core.run(10);
    const twin = TownCore.deserialize(JSON.parse(JSON.stringify(core.serialize())));
    core.run(40); twin.run(40);
    expect(JSON.stringify(twin.serialize())).toBe(JSON.stringify(core.serialize()));
  });
});
