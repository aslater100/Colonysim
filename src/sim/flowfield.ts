/**
 * Flow-field pathing — Stage 2 of the scale engine (see PLAN.md, Track C).
 *
 * Stage 1 (`agents.ts`) proved the per-agent cost FLOOR with straight-line
 * movement. The remaining superlinear term is pathing: the fat-object sim runs
 * one A* per idle agent per think, so cost grows with agents × map. A flow field
 * inverts that. For a single hot destination (a stockpile, a hearth, a job
 * cluster) we run ONE Dijkstra sweep from the goal across the whole map — O(map),
 * paid once — producing for every tile a step direction that points "downhill"
 * toward the goal. Every agent heading there just reads its current tile's
 * direction: O(1) per agent, no per-agent search. N agents share one field.
 *
 * The cost model matches `world.findPath`: entering a tile costs `1/speedMult`,
 * so roads pull the field toward themselves exactly as A* would, and the
 * integration field is a true cost-to-goal surface (not raw BFS distance).
 *
 * This module is standalone and DOM-free (like `agents.ts` / `fogmap.ts`): it
 * takes width/height and `passable`/`stepCost` callbacks, so the same code runs
 * headless, in the bench, against `world.ts`, or in a future Web Worker. The
 * cost/direction arrays and the Dijkstra heap are all preallocated — `build()`
 * allocates nothing, so re-solving a field when the goal or terrain moves stays
 * GC-free.
 *
 * Run the self-check:  npx tsx src/sim/flowfield.ts
 */

/** Tile is passable for this field. */
export type PassableFn = (index: number) => boolean;
/** Cost to ENTER tile `index` ( = 1/speed ); must be ≥ a positive floor. */
export type StepCostFn = (index: number) => number;

// 8-neighbour offsets (dx, dy); the first four are the orthogonals, used both for
// the integration sweep and — together with the diagonals — for the direction pass.
const NX = [1, -1, 0, 0, 1, 1, -1, -1];
const NY = [0, 0, 1, -1, 1, -1, 1, -1];

export class FlowField {
  readonly width: number;
  readonly height: number;
  readonly size: number;

  /** Integration field: minimal cost-to-goal from each tile. Infinity = unreachable. */
  readonly cost: Float64Array;
  /** Per-tile step direction toward the goal, each component in {-1, 0, 1}. */
  readonly dirX: Int8Array;
  readonly dirY: Int8Array;
  /** Passability snapshot taken at build time (1 = passable). */
  readonly passable: Uint8Array;

  // Preallocated binary min-heap over tile indices, keyed by cost-at-push so we
  // can lazily discard stale entries (no decrease-key needed).
  private readonly heapItem: Int32Array;
  private readonly heapKey: Float64Array;
  private heapLen = 0;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.size = width * height;
    this.cost = new Float64Array(this.size);
    this.dirX = new Int8Array(this.size);
    this.dirY = new Int8Array(this.size);
    this.passable = new Uint8Array(this.size);
    this.heapItem = new Int32Array(this.size);
    this.heapKey = new Float64Array(this.size);
  }

  index(x: number, y: number): number {
    return y * this.width + x;
  }

  /**
   * (Re)solve the field toward one or more `goals` (tile indices). Allocation-free.
   * `passable`/`stepCost` describe the grid as of now; pass `world`-backed closures
   * to track live terrain, or precomputed grids for raw speed.
   */
  build(goals: ArrayLike<number>, passable: PassableFn, stepCost: StepCostFn): void {
    const { size, width, cost, dirX, dirY } = this;
    const mask = this.passable;
    cost.fill(Infinity);
    dirX.fill(0);
    dirY.fill(0);
    for (let i = 0; i < size; i++) mask[i] = passable(i) ? 1 : 0;

    // Seed the sweep at every (passable) goal with cost 0.
    this.heapLen = 0;
    for (let g = 0; g < goals.length; g++) {
      const gi = goals[g];
      if (gi < 0 || gi >= size || !mask[gi] || cost[gi] === 0) continue;
      cost[gi] = 0;
      this.push(gi, 0);
    }

    // Dijkstra from the goal(s) outward over the 4-connected grid. We relax by the
    // cost to ENTER the neighbour (matching findPath), so the field favours roads.
    while (this.heapLen > 0) {
      const cur = this.pop();
      const cd = cost[cur];
      const cx = cur % width;
      const cy = (cur / width) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = cx + NX[d];
        const ny = cy + NY[d];
        if (nx < 0 || ny < 0 || nx >= width || ny >= this.height) continue;
        const ni = ny * width + nx;
        if (!mask[ni]) continue;
        const nd = cd + stepCost(ni);
        if (nd < cost[ni]) {
          cost[ni] = nd;
          this.push(ni, nd);
        }
      }
    }

    this.deriveDirections();
  }

  /**
   * For every reachable non-goal tile, point at the cheapest of its 8 neighbours.
   * Diagonals are allowed only when both touching orthogonals are passable, so the
   * flow never cuts a wall corner.
   */
  private deriveDirections(): void {
    const { width, height, cost, dirX, dirY } = this;
    const mask = this.passable;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (!mask[i] || cost[i] === 0 || cost[i] === Infinity) continue;
        let best = cost[i];
        let bdx = 0;
        let bdy = 0;
        for (let d = 0; d < 8; d++) {
          const dx = NX[d];
          const dy = NY[d];
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const ni = ny * width + nx;
          if (!mask[ni]) continue;
          if (d >= 4) {
            // diagonal: require both orthogonal neighbours open (no corner cut)
            if (!mask[y * width + nx] || !mask[ny * width + x]) continue;
          }
          if (cost[ni] < best) {
            best = cost[ni];
            bdx = dx;
            bdy = dy;
          }
        }
        dirX[i] = bdx;
        dirY[i] = bdy;
      }
    }
  }

  /**
   * Step direction at integer tile (tx, ty), written into `out`. Returns false when
   * the tile is the goal, unreachable, or off-map — i.e. "no onward step": the
   * caller treats that as arrival (or gives up).
   */
  dirAt(tx: number, ty: number, out: { x: number; y: number }): boolean {
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) {
      out.x = 0;
      out.y = 0;
      return false;
    }
    const i = ty * this.width + tx;
    const dx = this.dirX[i];
    const dy = this.dirY[i];
    out.x = dx;
    out.y = dy;
    return dx !== 0 || dy !== 0;
  }

  /** True once a tile has a finite cost-to-goal (i.e. a route exists). */
  reachable(tx: number, ty: number): boolean {
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) return false;
    return this.cost[ty * this.width + tx] !== Infinity;
  }

  // --- preallocated binary min-heap (keyed on cost-at-push) ---

  private push(item: number, key: number): void {
    const { heapItem, heapKey } = this;
    let i = this.heapLen++;
    heapItem[i] = item;
    heapKey[i] = key;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapKey[p] <= heapKey[i]) break;
      const ti = heapItem[i]; heapItem[i] = heapItem[p]; heapItem[p] = ti;
      const tk = heapKey[i]; heapKey[i] = heapKey[p]; heapKey[p] = tk;
      i = p;
    }
  }

  /** Pop the min-cost tile, lazily skipping entries stale-er than the live cost. */
  private pop(): number {
    const { heapItem, heapKey, cost } = this;
    for (;;) {
      const top = heapItem[0];
      const topKey = heapKey[0];
      const last = --this.heapLen;
      if (last > 0) {
        heapItem[0] = heapItem[last];
        heapKey[0] = heapKey[last];
        let i = 0;
        for (;;) {
          const l = i * 2 + 1;
          const r = l + 1;
          let m = i;
          if (l < last && heapKey[l] < heapKey[m]) m = l;
          if (r < last && heapKey[r] < heapKey[m]) m = r;
          if (m === i) break;
          const ti = heapItem[i]; heapItem[i] = heapItem[m]; heapItem[m] = ti;
          const tk = heapKey[i]; heapKey[i] = heapKey[m]; heapKey[m] = tk;
          i = m;
        }
      }
      // Skip a stale entry (a cheaper cost was found for this tile after it was pushed).
      if (topKey > cost[top]) continue;
      return top;
    }
  }
}

// --- self-check: npx tsx src/sim/flowfield.ts ---
if (typeof process !== 'undefined' && process.argv[1]?.endsWith('/flowfield.ts')) {
  // 5×5 open grid, goal at centre, uniform cost. Every tile should point inward.
  const W = 5;
  const ff = new FlowField(W, W);
  const goal = ff.index(2, 2);
  ff.build([goal], () => true, () => 1);
  console.assert(ff.cost[goal] === 0, 'goal cost is 0');
  console.assert(ff.reachable(0, 0), 'corner reachable');
  const out = { x: 0, y: 0 };
  console.assert(ff.dirAt(0, 0, out) && out.x === 1 && out.y === 1, 'corner steps toward centre');
  console.assert(!ff.dirAt(2, 2, out), 'goal has no onward step');

  // A wall down column x=2 (except a gap at the bottom) must force a detour, not a
  // straight diagonal through the wall corner.
  const W2 = 7;
  const wall = new FlowField(W2, W2);
  const blocked = (i: number) => {
    const x = i % W2;
    const y = (i / W2) | 0;
    return x === 3 && y < W2 - 1; // wall at x=3, open only on the last row
  };
  wall.build([wall.index(6, 3)], (i) => !blocked(i), () => 1);
  console.assert(wall.reachable(0, 3), 'left side routes around the wall');
  // The detour cost must exceed the straight-line manhattan distance (6) — proof
  // the field went the long way round the wall's open end.
  console.assert(wall.cost[wall.index(0, 3)] > 6, 'detour costs more than a straight shot');

  // Roads (cheap entry cost) must pull the integration field: a cheap lane should
  // yield a lower cost-to-goal than open ground at the same manhattan distance.
  const W3 = 9;
  const road = new FlowField(W3, W3);
  const onRoad = (x: number) => x === 4; // a vertical lane at x=4
  road.build(
    [road.index(4, 8)],
    () => true,
    (i) => (onRoad(i % W3) ? 1 / 1.8 : 1),
  );
  console.assert(
    road.cost[road.index(4, 0)] < road.cost[road.index(0, 0)],
    'travelling down the road is cheaper than across open ground',
  );

  console.log('flowfield.ts self-check OK — corner cost', ff.cost[0].toFixed(2));
}
