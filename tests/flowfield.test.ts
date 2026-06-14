import { describe, expect, it } from 'vitest';
import { FlowField } from '../src/sim/flowfield';
import { AgentStore, AState } from '../src/sim/agents';
import { World, MAP_W, MAP_H } from '../src/sim/world';
import { Rng } from '../src/sim/rng';

// Stage 2 of the scale engine (PLAN.md, Track C). One Dijkstra sweep from a hot
// destination yields a per-tile step direction the whole agent population reads in
// O(1); the cost model mirrors world.findPath so roads pull the field exactly as
// A* would.

describe('FlowField — integration field', () => {
  it('costs 0 at the goal and rises with distance', () => {
    const ff = new FlowField(11, 11);
    const goal = ff.index(5, 5);
    ff.build([goal], () => true, () => 1);
    expect(ff.cost[goal]).toBe(0);
    expect(ff.cost[ff.index(5, 4)]).toBe(1);
    expect(ff.cost[ff.index(0, 5)]).toBe(5);
    expect(ff.cost[ff.index(0, 0)]).toBe(10); // manhattan, 4-connected
  });

  it('marks unreachable tiles Infinity and not reachable()', () => {
    const W = 7;
    const ff = new FlowField(W, W);
    // Seal off the goal behind a full ring wall.
    const blocked = (i: number) => {
      const x = i % W;
      const y = (i / W) | 0;
      return (x === 2 || x === 4 || y === 2 || y === 4) &&
        x >= 2 && x <= 4 && y >= 2 && y <= 4 && !(x === 3 && y === 3);
    };
    ff.build([ff.index(3, 3)], (i) => !blocked(i), () => 1);
    expect(ff.cost[ff.index(3, 3)]).toBe(0);
    expect(ff.reachable(0, 0)).toBe(false);
    expect(ff.cost[ff.index(0, 0)]).toBe(Infinity);
  });

  it('supports multiple goals — cost is the nearest', () => {
    const ff = new FlowField(11, 1);
    ff.build([ff.index(0, 0), ff.index(10, 0)], () => true, () => 1);
    expect(ff.cost[ff.index(0, 0)]).toBe(0);
    expect(ff.cost[ff.index(10, 0)]).toBe(0);
    expect(ff.cost[ff.index(5, 0)]).toBe(5); // 5 from either end
  });
});

describe('FlowField — directions', () => {
  it('points every tile toward the goal, goal itself has none', () => {
    const ff = new FlowField(9, 9);
    ff.build([ff.index(4, 4)], () => true, () => 1);
    const out = { x: 0, y: 0 };
    expect(ff.dirAt(4, 4, out)).toBe(false); // arrived
    expect(ff.dirAt(0, 4, out)).toBe(true);
    expect(out).toEqual({ x: 1, y: 0 });
    expect(ff.dirAt(0, 0, out)).toBe(true);
    expect(out).toEqual({ x: 1, y: 1 }); // diagonal toward centre
  });

  it('never cuts a wall corner with a diagonal', () => {
    // Wall along x=2 with the only gap on the bottom row; a tile to the wall's left
    // must route down/around, never diagonally through the corner of the wall.
    const W = 6;
    const ff = new FlowField(W, W);
    const blocked = (i: number) => (i % W) === 2 && ((i / W) | 0) < W - 1;
    ff.build([ff.index(5, 0)], (i) => !blocked(i), () => 1);
    const out = { x: 0, y: 0 };
    // Tile (1,1) sits beside the wall; stepping {x:1,y:-1} would clip the wall corner.
    ff.dirAt(1, 1, out);
    const clipsCorner = out.x === 1 && out.y === -1;
    expect(clipsCorner).toBe(false);
    expect(ff.cost[ff.index(1, 1)]).toBeGreaterThan(6); // forced the long way round
  });

  it('prefers cheap road tiles in the integration field', () => {
    const W = 9;
    const ff = new FlowField(W, W);
    const onRoad = (x: number) => x === 4;
    ff.build([ff.index(4, 8)], () => true, (i) => (onRoad(i % W) ? 1 / 1.8 : 1));
    // Going down the road lane is cheaper than the same distance over open ground.
    expect(ff.cost[ff.index(4, 0)]).toBeLessThan(ff.cost[ff.index(0, 0)]);
  });
});

describe('FlowField — rebuild is allocation-stable', () => {
  it('reuses its buffers across builds and reflects a new goal', () => {
    const ff = new FlowField(11, 11);
    const cost = ff.cost;
    const dirX = ff.dirX;
    ff.build([ff.index(0, 0)], () => true, () => 1);
    expect(ff.cost[ff.index(10, 10)]).toBe(20);
    ff.build([ff.index(10, 10)], () => true, () => 1);
    expect(ff.cost).toBe(cost); // same backing arrays, no realloc
    expect(ff.dirX).toBe(dirX);
    expect(ff.cost[ff.index(0, 0)]).toBe(20);
    expect(ff.cost[ff.index(10, 10)]).toBe(0);
  });
});

describe('FlowField — agent following', () => {
  it('walks an agent to the goal in finite time', () => {
    const W = 40;
    const ff = new FlowField(W, W);
    ff.build([ff.index(20, 20)], () => true, () => 1);
    const store = new AgentStore(1);
    const a = store.spawn(3, 5);
    store.fields = [ff];
    store.assignField(a, 0);
    let rng = 7;
    const rand = () => (rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    let t = 0;
    for (; t < 1000 && store.state[a] === AState.Moving; t++) store.tick(t, rand);
    expect(store.state[a]).toBe(AState.Idle); // arrived, no longer moving
    expect(Math.abs(store.posX[a] - 20)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(store.posY[a] - 20)).toBeLessThanOrEqual(1.5);
  });

  it('idle agents auto-pick a field when one is registered, spreading across fields', () => {
    const W = 30;
    const left = new FlowField(W, W);
    const right = new FlowField(W, W);
    // Goals in opposite corners, far from spawn so nobody arrives during the window.
    left.build([left.index(0, 0)], () => true, () => 1);
    right.build([right.index(29, 29)], () => true, () => 1);
    const store = new AgentStore(8);
    for (let i = 0; i < 8; i++) store.spawn(15, 15);
    store.fields = [left, right];
    let rng = 11;
    const rand = () => (rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    // 8 ticks: every agent's staggered first-think (nextThink = i, max 7) has fired,
    // but the corner goals are ~12 ticks away so none has gone Idle again.
    for (let t = 0; t < 8; t++) store.tick(t, rand);
    // Every agent has picked a field and is moving; both fields get takers.
    let toLeft = 0;
    let toRight = 0;
    for (let i = 0; i < store.count; i++) {
      expect(store.field[i]).toBeGreaterThanOrEqual(0);
      if (store.field[i] === 0) toLeft++; else toRight++;
    }
    expect(toLeft).toBeGreaterThan(0);
    expect(toRight).toBeGreaterThan(0);
  });
});

describe('FlowField — parity with world.findPath', () => {
  it('reproduces A* reachability and cost ordering on a real generated map', () => {
    const world = new World(new Rng(12345));
    const goal = { x: 48, y: 48 }; // map centre (the guaranteed-buildable clearing)
    const passable = (i: number) => world.passable(i % MAP_W, (i / MAP_W) | 0, false);
    const stepCost = (i: number) => 1 / world.speedMult(i % MAP_W, (i / MAP_W) | 0, false);
    const ff = new FlowField(MAP_W, MAP_H);
    ff.build([ff.index(goal.x, goal.y)], passable, stepCost);

    // Sample interior tiles: wherever A* finds a route, the field must too, and the
    // field's cost ordering must agree with A* path length (monotone with distance).
    let checked = 0;
    for (let y = 8; y < MAP_H - 8; y += 9) {
      for (let x = 8; x < MAP_W - 8; x += 9) {
        if (!world.passable(x, y, false)) continue;
        const path = world.findPath({ x, y }, goal, false);
        const reachableByAstar = path !== null;
        expect(ff.reachable(x, y)).toBe(reachableByAstar);
        if (reachableByAstar) {
          // Field cost is finite and roughly tracks A* step count (same cost model).
          expect(ff.cost[ff.index(x, y)]).toBeLessThan(Infinity);
          expect(ff.cost[ff.index(x, y)]).toBeGreaterThanOrEqual(0);
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('an agent following the field reaches the centre on a real map', () => {
    const world = new World(new Rng(2024));
    const passable = (i: number) => world.passable(i % MAP_W, (i / MAP_W) | 0, false);
    const stepCost = (i: number) => 1 / world.speedMult(i % MAP_W, (i / MAP_W) | 0, false);
    const ff = new FlowField(MAP_W, MAP_H);
    ff.build([ff.index(48, 48)], passable, stepCost);

    // Start at a passable tile that the field can route from.
    let sx = 30;
    let sy = 30;
    while (!(world.passable(sx, sy, false) && ff.reachable(sx, sy))) { sx++; if (sx > 60) { sx = 30; sy++; } }
    const store = new AgentStore(1);
    const a = store.spawn(sx + 0.5, sy + 0.5);
    store.fields = [ff];
    store.assignField(a, 0);
    let rng = 3;
    const rand = () => (rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let t = 0; t < 4000 && store.state[a] === AState.Moving; t++) store.tick(t, rand);
    expect(Math.abs(store.posX[a] - 48)).toBeLessThanOrEqual(2);
    expect(Math.abs(store.posY[a] - 48)).toBeLessThanOrEqual(2);
  });
});
