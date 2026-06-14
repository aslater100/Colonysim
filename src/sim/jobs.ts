/**
 * Job board — Stage 3 of the scale engine, and B-3 of the build-system rewrite.
 *
 * The fat-object sim runs `findTask` per idle settler: each one scans the whole
 * map (O(agents × map)) every think. The job board inverts that. A single open-job
 * list is rebuilt once per pass; every idle agent then pulls the nearest matching
 * job (O(idle_agents × open_jobs)). In the Songs-of-Syx build model an open job is
 * simply an **unmanned craft station** — a station with a recipe and no worker —
 * so the board is derived straight from the BuildGrid, no separate task graph.
 *
 * `buildField()` additionally collapses the open jobs into a single multi-source
 * `FlowField` (Dijkstra from every open-job tile at once): each idle agent reads
 * its tile's cost-to-nearest-job and walks down the gradient — the "pull nearest
 * by flow-field cost" movement that pairs with the greedy matching here.
 *
 * Same scale-engine ethos as `agents.ts` / `build.ts`: pure, DOM-free, additive,
 * with a `npx tsx` self-check. Haul jobs (moving goods to storehouses) wait on a
 * spatial stockpile — the current `Stockpile` is town-global, so there is nothing
 * to haul between yet; this stage covers craft jobs.
 *
 * Run the self-check:  npx tsx src/sim/jobs.ts
 */
import type { BuildGrid } from './build';
import type { Stockpile } from './stockpile';
import type { AgentStore } from './agents';
import { AState } from './agents';
import type { FlowField } from './flowfield';
import { STATION_DEF_BY_NUM } from './defs';
// Runtime imports used only by the self-check (guarded module self-checks won't
// fire on import — each guards on its own filename).
import { BuildGrid as BuildGridImpl } from './build';
import { AgentStore as AgentStoreImpl } from './agents';
import { Stockpile as StockpileImpl } from './stockpile';
import { ROOM_TYPE_ID, MINUTES_PER_TICK } from './defs';

/** One open job: an unmanned craft station and its work (origin) tile. */
export interface Job {
  stationId: number;
  x: number;
  y: number;
}

/** Cost from an agent tile to a job tile; default is Manhattan. Inject flow-field cost to honour walls/roads. */
export type JobCostFn = (ax: number, ay: number, jx: number, jy: number) => number;

const manhattan: JobCostFn = (ax, ay, jx, jy) => Math.abs(ax - jx) + Math.abs(ay - jy);

export class JobBoard {
  /** Open jobs as of the last rebuild(). */
  jobs: Job[] = [];

  /**
   * Rebuild the open-job list from the grid. A craft station is an open job when:
   *   - it has a recipe (kind === 'craft'),
   *   - it resolves to a valid room (roomId ≥ 0, set by rebuildRooms),
   *   - no agent is currently assigned to it, and
   *   - (if `stockpile` is given) its recipe inputs are in stock — so we never
   *     dispatch a worker to a station that would only stall.
   * Returns the list (also stored on `this.jobs`).
   */
  rebuild(grid: BuildGrid, agents: AgentStore, stockpile?: Stockpile): Job[] {
    // Which stations already have a worker?
    const manned = new Set<number>();
    for (let i = 0; i < agents.count; i++) {
      const sid = agents.stationId[i];
      if (sid > 0) manned.add(sid);
    }

    this.jobs.length = 0;
    for (const s of grid.stations) {
      if (s.roomId < 0) continue; // station not in a room that accepts it → inert
      if (manned.has(s.id)) continue;
      const def = STATION_DEF_BY_NUM[s.typeId];
      if (!def || def.kind !== 'craft' || !def.recipe) continue;
      if (stockpile && !hasInputs(stockpile, def.recipe.inputs)) continue;
      this.jobs.push({ stationId: s.id, x: s.x, y: s.y });
    }
    return this.jobs;
  }

  /**
   * Match idle agents to open jobs, greedily nearest-first per agent. Each job is
   * claimed by at most one agent (and removed from the pool for this pass), and
   * `agents.assignStation` flips the worker to Working. Returns the number of
   * assignments made. O(idle_agents × open_jobs).
   */
  assignIdle(
    grid: BuildGrid,
    agents: AgentStore,
    opts: { cost?: JobCostFn; maxAssign?: number } = {},
  ): number {
    void grid; // reserved for future spatial filters; keeps the call-site symmetric
    const cost = opts.cost ?? manhattan;
    const max = opts.maxAssign ?? Infinity;
    // Work over a mutable copy of indices so claimed jobs drop out cheaply.
    const pool = this.jobs.slice();
    let assigned = 0;

    for (let i = 0; i < agents.count && assigned < max; i++) {
      if (agents.state[i] !== AState.Idle || agents.stationId[i] !== 0) continue;
      if (pool.length === 0) break;
      const ax = Math.floor(agents.posX[i]);
      const ay = Math.floor(agents.posY[i]);
      let bestK = -1;
      let bestC = Infinity;
      for (let k = 0; k < pool.length; k++) {
        const c = cost(ax, ay, pool[k].x, pool[k].y);
        if (c < bestC) { bestC = c; bestK = k; }
      }
      if (bestK < 0) break;
      agents.assignStation(i, pool[bestK].stationId);
      pool.splice(bestK, 1);
      assigned++;
    }
    return assigned;
  }

  /**
   * Solve a multi-source flow field over the current open-job tiles. Every idle
   * agent can then follow its tile's step direction to the nearest reachable job.
   * `field` must share the grid's dimensions. Walls block; entry cost is uniform.
   */
  buildField(field: FlowField, grid: BuildGrid): void {
    const goals = new Int32Array(this.jobs.length);
    for (let k = 0; k < this.jobs.length; k++) {
      goals[k] = field.index(this.jobs[k].x, this.jobs[k].y);
    }
    const wall = grid.wall;
    field.build(goals, (i) => wall[i] === 0, () => 1);
  }
}

/** True iff every recipe input is in stock (peek only — never mutates). */
function hasInputs(stockpile: Stockpile, inputs: Record<string, number>): boolean {
  for (const [k, q] of Object.entries(inputs)) {
    if (stockpile.count(k as never) < q) return false;
  }
  return true;
}

// --- self-check: npx tsx src/sim/jobs.ts ---
if (typeof process !== 'undefined' && process.argv[1]?.endsWith('/jobs.ts')) {
  const KITCHEN = ROOM_TYPE_ID.get('kitchen')!;
  const g = new BuildGridImpl(16, 16);
  g.designateRect(1, 1, 6, 3, KITCHEN);
  const oven1 = g.placeStation('oven', 1, 1)!;
  const oven2 = g.placeStation('oven', 3, 1)!;
  g.rebuildRooms();

  const agents = new AgentStoreImpl(8);
  const a = agents.spawn(1, 1); // next to oven1
  const b = agents.spawn(3, 1); // next to oven2
  const stock = new StockpileImpl();
  stock.add('grain', 40);

  const board = new JobBoard();
  board.rebuild(g, agents, stock);
  console.assert(board.jobs.length === 2, `two open jobs (got ${board.jobs.length})`);

  const n = board.assignIdle(g, agents);
  console.assert(n === 2, `assigned both agents (got ${n})`);
  console.assert(agents.stationId[a] === oven1.id, 'agent a took the nearer oven1');
  console.assert(agents.stationId[b] === oven2.id, 'agent b took the nearer oven2');

  // After everyone's manned, the board is empty.
  board.rebuild(g, agents, stock);
  console.assert(board.jobs.length === 0, 'no open jobs once manned');

  // End-to-end: production fires for both manned stations.
  for (let t = 0; t < 15; t++) g.tickProduction(agents, stock, MINUTES_PER_TICK);
  console.assert(stock.count('meal') === 4, `both ovens produced (got ${stock.count('meal')})`);

  console.log('jobs.ts self-check OK — meals', stock.count('meal'));
}
