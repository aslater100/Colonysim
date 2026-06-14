import { describe, expect, it } from 'vitest';
import { Weather } from '../src/sim/weather';
import { TownCore } from '../src/sim/towncore';
import { AgentStore, AState } from '../src/sim/agents';
import { BuildGrid } from '../src/sim/build';
import { serveNeeds } from '../src/sim/needs';
import { ROOM_TYPE_ID, MINUTES_PER_TICK } from '../src/sim/defs';

// Stage 5 behavior port: temperature drives warmth decay (ambient floor), freezing deals death.

describe('Weather — temperature & determinism', () => {
  it('returns a deterministic sequence for the same seed', () => {
    const w1 = new Weather(42);
    const w2 = new Weather(42);
    for (let d = 0; d < 100; d++) {
      const dw1 = w1.forDay(d);
      const dw2 = w2.forDay(d);
      expect(dw1.tempAnomalyC).toBe(dw2.tempAnomalyC);
      expect(dw1.sky).toBe(dw2.sky);
    }
  });

  it('varies temperature with seasons', () => {
    const w = new Weather(99);
    const temps: number[] = [];
    for (let d = 0; d < 365; d++) temps.push(w.forDay(d).tempAnomalyC);
    // Should have variation
    expect(Math.max(...temps)).toBeGreaterThan(Math.min(...temps));
  });
});

describe('Warmth — temperature-driven ambient floor', () => {
  it('cold weather lowers the ambient floor', () => {
    const a = new AgentStore(8);
    const i = a.spawn(8, 8);
    const grid = new BuildGrid(16, 16);

    // Exposed agent in cold (temp = −4°C).
    a.warmth[i] = 60;
    serveNeeds(grid, a, MINUTES_PER_TICK, -4);
    const coldWarmth = a.warmth[i];

    // Exposed agent in warm (temp = +4°C).
    a.warmth[i] = 60;
    serveNeeds(grid, a, MINUTES_PER_TICK, 4);
    const warmWarmth = a.warmth[i];

    expect(warmWarmth).toBeGreaterThan(coldWarmth); // warm weather preserves more warmth
  });

  it('extreme cold approaches a low floor', () => {
    const a = new AgentStore(8);
    const i = a.spawn(8, 8);
    const grid = new BuildGrid(16, 16);

    // Agent in extreme cold, exposed.
    a.warmth[i] = 50;
    for (let t = 0; t < 100; t++) serveNeeds(grid, a, MINUTES_PER_TICK, -4);
    // Should approach floor ~30 (50 − 4*2.5)
    expect(a.warmth[i]).toBeLessThan(50);
    expect(a.warmth[i]).toBeGreaterThan(20); // floor is clamped ≥20
  });

  it('extreme heat prevents further warm loss', () => {
    const a = new AgentStore(8);
    const i = a.spawn(8, 8);
    const grid = new BuildGrid(16, 16);

    // Agent in extreme heat, exposed.
    a.warmth[i] = 30;
    for (let t = 0; t < 100; t++) serveNeeds(grid, a, MINUTES_PER_TICK, 4);
    // Should approach floor ~60 (50 + 4*2.5)
    expect(a.warmth[i]).toBeGreaterThan(30);
    expect(a.warmth[i]).toBeLessThan(80); // floor is clamped ≤80
  });
});

describe('Freezing — warmth ≤ 0 deals death', () => {
  it('an agent with multiple bleeds (starvation + wounds + cold) dies faster', () => {
    const core = new TownCore({ width: 16, height: 16, seed: 5 });
    const i = core.agents.spawn(8, 8);
    core.agents.warmth[i] = 30;
    core.agents.food[i] = 0; // starving
    core.agents.inflictWound(i, 0); // wounded

    const initialHealth = core.agents.health[i];

    // Run a few ticks with starvation + wound + cold (exposed).
    for (let t = 0; t < 10 && core.agents.health[i] > 0; t++) {
      core.tick();
    }

    // Should take cumulative bleed damage (starvation + wound + fever bleed + freeze bleed).
    expect(core.agents.health[i]).toBeLessThan(initialHealth);
  });

  it('enclosed agents preserve warmth better than exposed in cold', () => {
    const a = new AgentStore(8);
    const grid = new BuildGrid(16, 16);
    const HOME = ROOM_TYPE_ID.get('home')!;

    // Build an enclosed home.
    grid.designateRect(2, 2, 6, 6, HOME);
    for (let x = 1; x <= 7; x++) { grid.setWall(x, 1); grid.setWall(x, 7); }
    for (let y = 1; y <= 7; y++) { grid.setWall(1, y); grid.setWall(7, y); }
    grid.rebuildRooms();

    // Agent inside the enclosed room.
    const enclosed = a.spawn(3, 3);
    a.warmth[enclosed] = 50;

    // Agent outside (exposed).
    const exposed = a.spawn(12, 12);
    a.warmth[exposed] = 50;

    // Run multiple ticks with extreme cold (−4°C).
    for (let t = 0; t < 100; t++) {
      serveNeeds(grid, a, MINUTES_PER_TICK, -4);
    }

    // Enclosed agent should warm up, exposed should cool down.
    expect(a.warmth[enclosed]).toBeGreaterThan(50);
    expect(a.warmth[exposed]).toBeLessThan(50);
  });

  it('cold weather lowers the warmth ambient floor for exposed settlers', () => {
    const a = new AgentStore(8);
    const i = a.spawn(8, 8);
    const grid = new BuildGrid(16, 16);

    // Run many ticks in extreme cold, allowing convergence to floor.
    a.warmth[i] = 60;
    for (let t = 0; t < 200; t++) serveNeeds(grid, a, MINUTES_PER_TICK, -4);
    const coldFloor = a.warmth[i];

    // Run many ticks in neutral weather.
    a.warmth[i] = 60;
    for (let t = 0; t < 200; t++) serveNeeds(grid, a, MINUTES_PER_TICK, 0);
    const neutralFloor = a.warmth[i];

    // Cold weather lowers the floor (agent ends up colder).
    expect(coldFloor).toBeLessThan(neutralFloor);
  });

  it('warm traits reduce freezing damage (slowens warmth decay)', () => {
    const core = new TownCore({ width: 16, height: 16, seed: 8 });
    const i = core.agents.spawn(8, 8);
    core.agents.warmth[i] = 80;

    // Manually set warmthDecayMult to 0.5 (hardy settler).
    core.agents.warmthDecayMult[i] = 0.5;

    const warmthBefore = core.agents.warmth[i];
    core.tick();
    const warmthAfter1 = core.agents.warmth[i];

    // Reset and try with normal mult.
    core.agents.warmth[i] = 80;
    core.agents.warmthDecayMult[i] = 1.0;
    core.tick();
    const warmthAfter2 = core.agents.warmth[i];

    // Hardy settler loses less warmth.
    expect(warmthAfter1).toBeGreaterThan(warmthAfter2);
  });
});

describe('TownCore — weather integration', () => {
  it('serializes and deserializes weather seed', () => {
    const core = new TownCore({ width: 16, height: 16, seed: 23 });
    const i = core.agents.spawn(8, 8);
    core.agents.warmth[i] = 50;
    core.run(100);

    const twin = TownCore.deserialize(JSON.parse(JSON.stringify(core.serialize())));
    core.run(100);
    twin.run(100);

    // Both should have the same temperature sequence (deterministic).
    expect(JSON.stringify(twin.serialize())).toBe(JSON.stringify(core.serialize()));
  });

  it('old saves without weather seed backfill to seed 1', () => {
    const core = new TownCore({ width: 16, height: 16, seed: 99 });
    const data = core.serialize();
    const oldData = { ...data, weatherSeed: undefined };
    const restored = TownCore.deserialize(oldData as any);
    expect(restored.weather.forDay(0).tempAnomalyC).toBe(new Weather(1).forDay(0).tempAnomalyC);
  });

  it('deterministic warmth evolution with temperature changes', () => {
    const core = new TownCore({ width: 16, height: 16, seed: 11 });
    const grid = core.grid;
    const HOME = ROOM_TYPE_ID.get('home')!;

    // Build a home.
    grid.designateRect(2, 2, 6, 6, HOME);
    for (let x = 1; x <= 7; x++) { grid.setWall(x, 1); grid.setWall(x, 7); }
    for (let y = 1; y <= 7; y++) { grid.setWall(1, y); grid.setWall(7, y); }
    grid.placeStation('bed', 2, 2);
    grid.rebuildRooms();

    const i = core.agents.spawn(3, 3); // inside the home
    core.agents.warmth[i] = 50;

    // Run through multiple days with varying temperature (weather determines it).
    for (let t = 0; t < 1000; t++) {
      core.tick();
    }

    // Agent inside the home should maintain comfortable warmth despite weather.
    expect(core.agents.warmth[i]).toBeGreaterThan(40);
    expect(core.agents.health[i]).toBeGreaterThan(0); // alive
  });
});
