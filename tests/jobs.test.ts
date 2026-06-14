import { describe, expect, it } from 'vitest';
import { JobBoard } from '../src/sim/jobs';
import { BuildGrid } from '../src/sim/build';
import { AgentStore, AState } from '../src/sim/agents';
import { Stockpile } from '../src/sim/stockpile';
import { FlowField } from '../src/sim/flowfield';
import { ROOM_TYPE_ID, MINUTES_PER_TICK } from '../src/sim/defs';

// Build-system B-3 / scale-engine Stage 3: a central open-job board. An open job
// is an unmanned craft station; idle agents pull the nearest. Pure + additive.

const KITCHEN = ROOM_TYPE_ID.get('kitchen')!;
const HOME = ROOM_TYPE_ID.get('home')!;
const FOUNDRY = ROOM_TYPE_ID.get('foundry')!;

function kitchenWith(ovens: Array<[number, number]>): { grid: BuildGrid; ids: number[] } {
  const grid = new BuildGrid(16, 16);
  grid.designateRect(1, 1, 10, 4, KITCHEN);
  const ids = ovens.map(([x, y]) => grid.placeStation('oven', x, y)!.id);
  grid.rebuildRooms();
  return { grid, ids };
}

describe('JobBoard.rebuild', () => {
  it('lists each unmanned craft station as an open job', () => {
    const { grid, ids } = kitchenWith([[1, 1], [3, 1]]);
    const agents = new AgentStore(4);
    const board = new JobBoard();
    board.rebuild(grid, agents);
    expect(board.jobs.map((j) => j.stationId).sort()).toEqual([...ids].sort());
  });

  it('excludes stations that already have a worker', () => {
    const { grid, ids } = kitchenWith([[1, 1], [3, 1]]);
    const agents = new AgentStore(4);
    const i = agents.spawn(0, 0);
    agents.assignStation(i, ids[0]); // man the first oven
    const board = new JobBoard();
    board.rebuild(grid, agents);
    expect(board.jobs).toHaveLength(1);
    expect(board.jobs[0].stationId).toBe(ids[1]);
  });

  it('excludes capacity stations (beds are not jobs)', () => {
    const grid = new BuildGrid(12, 12);
    grid.designateRect(1, 1, 5, 5, HOME);
    for (let x = 0; x <= 6; x++) { grid.setWall(x, 0); grid.setWall(x, 6); }
    for (let y = 0; y <= 6; y++) { grid.setWall(0, y); grid.setWall(6, y); }
    grid.placeStation('bed', 1, 1);
    grid.rebuildRooms();
    const board = new JobBoard();
    board.rebuild(grid, new AgentStore(4));
    expect(board.jobs).toHaveLength(0);
  });

  it('excludes a craft station sitting in the wrong room type (inert, no roomId)', () => {
    const grid = new BuildGrid(12, 12);
    grid.designateRect(1, 1, 5, 4, HOME); // a home...
    const ms = grid.placeStation('millstone', 1, 1)!; // ...with a millstone (mill-only)
    grid.rebuildRooms();
    expect(ms.roomId).toBe(-1); // not accepted by 'home'
    const board = new JobBoard();
    board.rebuild(grid, new AgentStore(4));
    expect(board.jobs).toHaveLength(0);
  });

  it('with a stockpile, excludes stations whose inputs are out of stock', () => {
    const { grid } = kitchenWith([[1, 1]]);
    const agents = new AgentStore(4);
    const stock = new Stockpile();
    const board = new JobBoard();

    board.rebuild(grid, agents, stock); // no grain
    expect(board.jobs).toHaveLength(0);

    stock.add('grain', 2); // enough for one oven cycle
    board.rebuild(grid, agents, stock);
    expect(board.jobs).toHaveLength(1);
  });
});

describe('JobBoard.assignIdle', () => {
  it('assigns the nearest open job to an idle agent', () => {
    const { grid, ids } = kitchenWith([[1, 1], [8, 1]]);
    const agents = new AgentStore(4);
    const a = agents.spawn(8, 1); // right next to the far oven
    const board = new JobBoard();
    board.rebuild(grid, agents);
    const n = board.assignIdle(grid, agents);
    expect(n).toBe(1);
    expect(agents.stationId[a]).toBe(ids[1]); // nearest = the oven at (8,1)
    expect(agents.state[a]).toBe(AState.Working);
  });

  it('two agents claim distinct nearest jobs (greedy, one worker per job)', () => {
    const { grid, ids } = kitchenWith([[1, 1], [8, 1]]);
    const agents = new AgentStore(4);
    const a = agents.spawn(1, 1); // near oven @ (1,1)
    const b = agents.spawn(8, 1); // near oven @ (8,1)
    const board = new JobBoard();
    board.rebuild(grid, agents);
    const n = board.assignIdle(grid, agents);
    expect(n).toBe(2);
    expect(agents.stationId[a]).toBe(ids[0]);
    expect(agents.stationId[b]).toBe(ids[1]);
  });

  it('does not reassign agents already working, and stops when jobs run out', () => {
    const { grid, ids } = kitchenWith([[1, 1]]); // one job
    const agents = new AgentStore(4);
    const a = agents.spawn(1, 1);
    const b = agents.spawn(2, 1);
    const board = new JobBoard();
    board.rebuild(grid, agents);
    expect(board.assignIdle(grid, agents)).toBe(1); // only one job
    const claimer = agents.stationId[a] === ids[0] ? a : b;
    const other = claimer === a ? b : a;
    expect(agents.stationId[claimer]).toBe(ids[0]);
    expect(agents.state[other]).toBe(AState.Idle);

    // Rebuilding now finds nothing open; a second pass assigns no one.
    board.rebuild(grid, agents);
    expect(board.jobs).toHaveLength(0);
    expect(board.assignIdle(grid, agents)).toBe(0);
  });

  it('honours an injected flow-field cost so walls reroute the choice', () => {
    // Two ovens equidistant by Manhattan, but a wall makes one far costlier to reach.
    const grid = new BuildGrid(12, 12);
    grid.designateRect(1, 1, 10, 6, KITCHEN);
    const near = grid.placeStation('oven', 1, 5)!;
    const far = grid.placeStation('oven', 9, 1)!;
    // Wall off the direct route to the far oven so flow cost favours the near one.
    for (let y = 0; y <= 4; y++) grid.setWall(6, y);
    grid.rebuildRooms();

    const agents = new AgentStore(4);
    const a = agents.spawn(5, 5);
    const board = new JobBoard();
    board.rebuild(grid, agents);

    const field = new FlowField(grid.width, grid.height);
    // Build a per-job cost function via a flow field solved from each job tile lazily.
    const cost = (ax: number, ay: number, jx: number, jy: number): number => {
      field.build([field.index(jx, jy)], (i) => grid.wall[i] === 0, () => 1);
      return field.cost[field.index(ax, ay)];
    };
    board.assignIdle(grid, agents, { cost });
    expect(agents.stationId[a]).toBe(near.id);
    expect(near.id).not.toBe(far.id);
  });

  it('maxAssign caps the number of claims in a pass', () => {
    const { grid } = kitchenWith([[1, 1], [3, 1], [5, 1]]);
    const agents = new AgentStore(4);
    agents.spawn(1, 1); agents.spawn(3, 1); agents.spawn(5, 1);
    const board = new JobBoard();
    board.rebuild(grid, agents);
    expect(board.assignIdle(grid, agents, { maxAssign: 2 })).toBe(2);
  });
});

describe('JobBoard.buildField', () => {
  it('produces a finite cost-to-nearest-job surface that agents can follow', () => {
    const { grid } = kitchenWith([[2, 2]]);
    const board = new JobBoard();
    board.rebuild(grid, new AgentStore(1));
    const field = new FlowField(grid.width, grid.height);
    board.buildField(field, grid);
    expect(field.reachable(10, 10)).toBe(true);
    const out = { x: 0, y: 0 };
    expect(field.dirAt(10, 10, out)).toBe(true); // a step exists toward the job
    expect(field.cost[field.index(2, 2)]).toBe(0); // the job tile is the goal
  });
});

describe('JobBoard end-to-end', () => {
  it('rebuild → assignIdle → tickProduction yields output', () => {
    const { grid } = kitchenWith([[1, 1], [3, 1]]);
    const agents = new AgentStore(4);
    agents.spawn(1, 1);
    agents.spawn(3, 1);
    const stock = new Stockpile();
    stock.add('grain', 40);

    const board = new JobBoard();
    board.rebuild(grid, agents, stock);
    expect(board.assignIdle(grid, agents)).toBe(2);

    for (let t = 0; t < 15; t++) grid.tickProduction(agents, stock, MINUTES_PER_TICK);
    expect(stock.count('meal')).toBe(4); // both ovens fired one batch
  });

  it('multi-input foundry: board only opens the smelter when ore AND coke are stocked', () => {
    const grid = new BuildGrid(16, 16);
    grid.designateRect(1, 1, 6, 6, FOUNDRY);
    grid.placeStation('smelter', 1, 1);
    grid.rebuildRooms();
    const agents = new AgentStore(4);
    const stock = new Stockpile();
    const board = new JobBoard();

    stock.add('iron_ore', 10); // ore only
    board.rebuild(grid, agents, stock);
    expect(board.jobs).toHaveLength(0); // still stalled — needs coke too

    stock.add('coke', 4);
    board.rebuild(grid, agents, stock);
    expect(board.jobs).toHaveLength(1);
  });
});
