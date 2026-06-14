import { describe, expect, it } from 'vitest';
import { Stockpile } from '../src/sim/stockpile';
import { BuildGrid } from '../src/sim/build';
import { AgentStore, AState } from '../src/sim/agents';
import { ROOM_TYPE_ID, MINUTES_PER_TICK } from '../src/sim/defs';

// Build-system B-2: craft-station recipes consume/produce against the Stockpile
// on the SoA core. Pure and additive — not wired into the live Simulation yet.

const KITCHEN = ROOM_TYPE_ID.get('kitchen')!;
const MILL = ROOM_TYPE_ID.get('mill')!;
const FOUNDRY = ROOM_TYPE_ID.get('foundry')!;
const HOME = ROOM_TYPE_ID.get('home')!;

// --- Stockpile ---

describe('Stockpile', () => {
  it('add increases count; count of unknown resource is 0', () => {
    const s = new Stockpile();
    expect(s.count('grain')).toBe(0);
    s.add('grain', 10);
    expect(s.count('grain')).toBe(10);
    s.add('grain', 5);
    expect(s.count('grain')).toBe(15);
  });

  it('remove deducts and returns true; insufficient remove returns false without change', () => {
    const s = new Stockpile();
    s.add('wood', 8);
    expect(s.remove('wood', 3)).toBe(true);
    expect(s.count('wood')).toBe(5);
    expect(s.remove('wood', 10)).toBe(false); // only 5 remain
    expect(s.count('wood')).toBe(5);          // unchanged
  });

  it('removeAll is atomic: succeeds when all inputs available', () => {
    const s = new Stockpile();
    s.add('iron_ore', 4);
    s.add('coke', 2);
    expect(s.removeAll({ iron_ore: 2, coke: 1 })).toBe(true);
    expect(s.count('iron_ore')).toBe(2);
    expect(s.count('coke')).toBe(1);
  });

  it('removeAll is atomic: fails without any change when any input is insufficient', () => {
    const s = new Stockpile();
    s.add('grain', 3); // have grain
    // no iron_ore at all
    expect(s.removeAll({ grain: 3, iron_ore: 2 })).toBe(false);
    expect(s.count('grain')).toBe(3); // untouched
  });

  it('snapshot returns only non-zero resources', () => {
    const s = new Stockpile();
    s.add('meal', 5);
    s.add('stone', 0); // effectively nothing
    const snap = s.snapshot();
    expect(snap.meal).toBe(5);
    expect('stone' in snap).toBe(false);
    expect('grain' in snap).toBe(false);
  });
});

// --- BuildGrid.tickProduction ---

// Helper: spawn an agent assigned to a given station.
function assignWorker(agents: AgentStore, stationId: number): number {
  const i = agents.spawn(0, 0);
  agents.assignStation(i, stationId);
  return i;
}

describe('BuildGrid.tickProduction — basic recipe', () => {
  it('craft station fires and produces output once recipe work threshold is reached', () => {
    const g = new BuildGrid(10, 10);
    const stock = new Stockpile();
    const agents = new AgentStore(4);

    g.designateRect(1, 1, 3, 3, KITCHEN); // 3×3 kitchen
    const oven = g.placeStation('oven', 1, 1)!; // oven recipe: 2 grain → 2 meal, work=60
    g.rebuildRooms();
    stock.add('grain', 20);
    assignWorker(agents, oven.id);

    // oven recipe.work = 60 minutes; MINUTES_PER_TICK = 4 → fire after ceil(60/4)=15 ticks
    for (let t = 0; t < 14; t++) g.tickProduction(agents, stock, MINUTES_PER_TICK);
    expect(stock.count('meal')).toBe(0); // not yet fired (14×4=56 < 60)

    g.tickProduction(agents, stock, MINUTES_PER_TICK); // tick 15: 60 min reached
    expect(stock.count('meal')).toBe(2);
    expect(stock.count('grain')).toBe(18); // 2 consumed
  });

  it('recipe stalls when inputs are exhausted: no output, no negative stock', () => {
    const g = new BuildGrid(10, 10);
    const stock = new Stockpile();
    const agents = new AgentStore(4);

    g.designateRect(1, 1, 3, 3, KITCHEN);
    const oven = g.placeStation('oven', 1, 1)!;
    g.rebuildRooms();
    // no grain in stockpile
    assignWorker(agents, oven.id);

    for (let t = 0; t < 20; t++) g.tickProduction(agents, stock, MINUTES_PER_TICK);
    expect(stock.count('meal')).toBe(0);
    expect(stock.count('grain')).toBe(0); // never went negative
  });

  it('stall then supply: recipe fires on the first tick inputs arrive', () => {
    const g = new BuildGrid(10, 10);
    const stock = new Stockpile();
    const agents = new AgentStore(4);

    g.designateRect(1, 1, 3, 3, KITCHEN);
    const oven = g.placeStation('oven', 1, 1)!;
    g.rebuildRooms();
    assignWorker(agents, oven.id);

    // Run 30 ticks with no grain — progress clamps at recipe.work (60)
    for (let t = 0; t < 30; t++) g.tickProduction(agents, stock, MINUTES_PER_TICK);
    expect(stock.count('meal')).toBe(0);

    // Supply grain and run one more tick → recipe fires immediately
    stock.add('grain', 10);
    g.tickProduction(agents, stock, MINUTES_PER_TICK);
    expect(stock.count('meal')).toBe(2);
    expect(stock.count('grain')).toBe(8);
  });
});

describe('BuildGrid.tickProduction — worker mechanics', () => {
  it('no worker → no progress, recipe never fires', () => {
    const g = new BuildGrid(10, 10);
    const stock = new Stockpile();
    const agents = new AgentStore(4);

    g.designateRect(1, 1, 3, 3, KITCHEN);
    g.placeStation('oven', 1, 1);
    g.rebuildRooms();
    stock.add('grain', 20);
    // no agents assigned

    for (let t = 0; t < 30; t++) g.tickProduction(agents, stock, MINUTES_PER_TICK);
    expect(stock.count('meal')).toBe(0);
    expect(stock.count('grain')).toBe(20);
  });

  it('two workers at one station halve the time to first output', () => {
    const g = new BuildGrid(10, 10);
    const stock = new Stockpile();
    const agents = new AgentStore(4);

    g.designateRect(1, 1, 4, 3, KITCHEN);
    const oven = g.placeStation('oven', 1, 1)!; // work=60
    g.rebuildRooms();
    stock.add('grain', 20);
    assignWorker(agents, oven.id);
    assignWorker(agents, oven.id); // second worker

    // 2 workers × 4 min/tick = 8 min/tick → fires after ceil(60/8) = 8 ticks (at tick 8: 64 ≥ 60)
    for (let t = 0; t < 7; t++) g.tickProduction(agents, stock, MINUTES_PER_TICK);
    expect(stock.count('meal')).toBe(0);

    g.tickProduction(agents, stock, MINUTES_PER_TICK); // tick 8: 32 min carried → 64 ≥ 60
    expect(stock.count('meal')).toBe(2);
  });

  it('unassigning a worker stops production', () => {
    const g = new BuildGrid(10, 10);
    const stock = new Stockpile();
    const agents = new AgentStore(4);

    g.designateRect(1, 1, 3, 3, KITCHEN);
    const oven = g.placeStation('oven', 1, 1)!;
    g.rebuildRooms();
    stock.add('grain', 20);
    const workerIdx = assignWorker(agents, oven.id);

    // Advance partway through the recipe
    for (let t = 0; t < 7; t++) g.tickProduction(agents, stock, MINUTES_PER_TICK);

    // Unassign and verify no further output
    agents.unassignStation(workerIdx);
    expect(agents.state[workerIdx]).toBe(AState.Idle);
    expect(agents.stationId[workerIdx]).toBe(0);

    for (let t = 0; t < 20; t++) g.tickProduction(agents, stock, MINUTES_PER_TICK);
    expect(stock.count('meal')).toBe(0);
  });
});

describe('BuildGrid.tickProduction — multi-station & multi-input', () => {
  it('two stations in one room run independently', () => {
    const g = new BuildGrid(16, 16);
    const stock = new Stockpile();
    const agents = new AgentStore(8);

    g.designateRect(1, 1, 8, 4, KITCHEN);
    const oven1 = g.placeStation('oven', 1, 1)!; // work=60
    const oven2 = g.placeStation('oven', 3, 1)!;
    g.rebuildRooms();
    stock.add('grain', 20);
    assignWorker(agents, oven1.id);
    assignWorker(agents, oven2.id);

    // After 15 ticks both overens have fired once each → 4 meals total
    for (let t = 0; t < 15; t++) g.tickProduction(agents, stock, MINUTES_PER_TICK);
    expect(stock.count('meal')).toBe(4);
    expect(stock.count('grain')).toBe(16); // 4 consumed (2×2)
  });

  it('multi-input recipe (smelter: iron_ore + coke → iron) fires when both present', () => {
    const g = new BuildGrid(16, 16);
    const stock = new Stockpile();
    const agents = new AgentStore(4);

    g.designateRect(1, 1, 6, 6, FOUNDRY);
    const smelter = g.placeStation('smelter', 1, 1)!; // inputs: iron_ore×2 + coke×1, work=120
    g.rebuildRooms();
    stock.add('iron_ore', 10);
    stock.add('coke', 5);
    assignWorker(agents, smelter.id);

    // work=120, 4 min/tick → fires after 30 ticks
    for (let t = 0; t < 29; t++) g.tickProduction(agents, stock, MINUTES_PER_TICK);
    expect(stock.count('iron')).toBe(0);

    g.tickProduction(agents, stock, MINUTES_PER_TICK); // tick 30
    expect(stock.count('iron')).toBe(2);
    expect(stock.count('iron_ore')).toBe(8); // 2 consumed
    expect(stock.count('coke')).toBe(4);     // 1 consumed
  });

  it('multi-input stall: smelter has ore but no coke → never fires', () => {
    const g = new BuildGrid(16, 16);
    const stock = new Stockpile();
    const agents = new AgentStore(4);

    g.designateRect(1, 1, 6, 6, FOUNDRY);
    const smelter = g.placeStation('smelter', 1, 1)!;
    g.rebuildRooms();
    stock.add('iron_ore', 20); // plenty of ore
    // no coke
    assignWorker(agents, smelter.id);

    for (let t = 0; t < 40; t++) g.tickProduction(agents, stock, MINUTES_PER_TICK);
    expect(stock.count('iron')).toBe(0);
    expect(stock.count('iron_ore')).toBe(20); // untouched
  });
});

describe('BuildGrid.tickProduction — capacity stations skipped', () => {
  it('a bed in a home room is silently skipped; no errors, no phantom output', () => {
    const g = new BuildGrid(10, 10);
    const stock = new Stockpile();
    const agents = new AgentStore(4);

    g.designateRect(1, 1, 5, 5, HOME);
    for (let x = 0; x <= 6; x++) { g.setWall(x, 0); g.setWall(x, 6); }
    for (let y = 0; y <= 6; y++) { g.setWall(0, y); g.setWall(6, y); }
    const bed = g.placeStation('bed', 1, 1)!;
    g.rebuildRooms();

    assignWorker(agents, bed.id);
    for (let t = 0; t < 30; t++) g.tickProduction(agents, stock, MINUTES_PER_TICK);
    // No outputs — capacity stations are skipped by tickProduction
    expect(Object.keys(stock.snapshot())).toHaveLength(0);
  });
});

describe('BuildGrid.tickProduction — progress carry-over', () => {
  it('excess progress from one cycle rolls into the next', () => {
    // Use a millstone (work=80). At MINUTES_PER_TICK=4, a single worker fires after
    // 20 ticks (20×4=80). If we load grain for two full cycles before starting,
    // both cycles complete back-to-back as progress carries over.
    const g = new BuildGrid(16, 16);
    const stock = new Stockpile();
    const agents = new AgentStore(4);

    g.designateRect(1, 1, 7, 5, MILL);
    const ms = g.placeStation('millstone', 1, 1)!; // grain×3→flour×3, work=80
    g.rebuildRooms();
    stock.add('grain', 6); // exactly two batches
    assignWorker(agents, ms.id);

    // First batch fires at tick 20 (80 min); progress resets with carry-over=0 (exact threshold).
    for (let t = 0; t < 20; t++) g.tickProduction(agents, stock, MINUTES_PER_TICK);
    expect(stock.count('flour')).toBe(3);

    // Second batch fires at tick 40.
    for (let t = 0; t < 20; t++) g.tickProduction(agents, stock, MINUTES_PER_TICK);
    expect(stock.count('flour')).toBe(6);
    expect(stock.count('grain')).toBe(0);
  });
});
