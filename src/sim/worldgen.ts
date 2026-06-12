/**
 * Procedural world generation (dependency-free, fully seeded).
 *
 * One generator produces the region-scale truth — elevation, water, climate,
 * biomes — and everything derives from it: the region map the State plays on,
 * the tile map each town stands on, settlement site quality, travel costs,
 * and the weather's local effects. Terrain is not scenery; it is the budget
 * every other system spends against.
 */

export const REGION_N = 64; // region is REGION_N × REGION_N cells over 0..100 coords

export type Biome =
  | 'sea' | 'lake' | 'river' | 'marsh' | 'plains' | 'forest' | 'hills' | 'mountains';

export interface Cell {
  elevation: number; // 0..1
  moisture: number; // 0..1
  temperature: number; // 0..1 (latitude + lapse)
  river: boolean;
  flow: number; // accumulated river flow
  biome: Biome;
  fertility: number; // 0.3..1.4 — farm productivity multiplier
  forest: number; // 0..1 — wood availability
  roughness: number; // 0..1 — travel cost & defensibility
}

export interface TownSite {
  cellX: number;
  cellY: number;
  fertility: number;
  forest: number;
  roughness: number;
  river: boolean;
  coastal: boolean;
}

// ---- deterministic value noise ----
function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(seed, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
}

/** fractal Brownian motion: layered octaves of value noise */
export function fbm(x: number, y: number, seed: number, octaves = 4): number {
  let v = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    v += amp * valueNoise(x * freq, y * freq, seed + i * 101);
    amp *= 0.5;
    freq *= 2;
  }
  return v;
}

/** fbm normalized to the full 0..1 range with mild contrast — octave
 *  averaging otherwise compresses everything toward the middle and the
 *  world comes out as featureless mush (no mountains, no droughts). */
export function fbm01(x: number, y: number, seed: number, octaves = 4): number {
  const maxAmp = 1 - Math.pow(0.5, octaves);
  const n = fbm(x, y, seed, octaves) / maxAmp; // ≈0..1, mean ~0.5
  const c = (n - 0.5) * 1.6 + 0.5; // stretch the middle back out
  return Math.max(0, Math.min(1, c));
}

export class RegionMap {
  cells: Cell[] = [];
  seaLevel = 0.3;

  constructor(public seed: number) {
    this.generate();
  }

  at(x: number, y: number): Cell {
    const cx = Math.max(0, Math.min(REGION_N - 1, x));
    const cy = Math.max(0, Math.min(REGION_N - 1, y));
    return this.cells[cy * REGION_N + cx];
  }

  /** region 0..100 coords → cell */
  atCoord(rx: number, ry: number): Cell {
    return this.at(Math.floor((rx / 100) * REGION_N), Math.floor((ry / 100) * REGION_N));
  }

  private generate(): void {
    const s = this.seed;
    // Elevation: fbm + a west-coast continental gradient (sea to the west,
    // mountains rising eastward) so the region reads as one coherent place.
    for (let y = 0; y < REGION_N; y++) {
      for (let x = 0; x < REGION_N; x++) {
        const nx = x / REGION_N;
        const ny = y / REGION_N;
        let e = fbm01(nx * 4, ny * 4, s) * 0.62 + nx * 0.48 - 0.12;
        e += (fbm01(nx * 9, ny * 9, s + 7) - 0.5) * 0.18;
        const t = 1 - ny * 0.55 - Math.max(0, e - this.seaLevel) * 0.5; // north & heights are cold
        const m = fbm01(nx * 5, ny * 5, s + 31);
        this.cells.push({
          elevation: Math.max(0, Math.min(1, e)),
          moisture: m,
          temperature: Math.max(0, Math.min(1, t)),
          river: false,
          flow: 0,
          biome: 'plains',
          fertility: 1,
          forest: 0,
          roughness: 0,
        });
      }
    }
    this.carveRivers();
    this.classify();
  }

  /** Rivers: descend from high wet cells to the sea, accumulating flow. */
  private carveRivers(): void {
    const sources: { x: number; y: number; score: number }[] = [];
    for (let y = 2; y < REGION_N - 2; y++) {
      for (let x = 2; x < REGION_N - 2; x++) {
        const c = this.at(x, y);
        if (c.elevation > 0.62) sources.push({ x, y, score: c.elevation * c.moisture });
      }
    }
    sources.sort((a, b) => b.score - a.score);
    const n = Math.min(7, sources.length);
    for (let i = 0; i < n; i++) {
      let { x, y } = sources[Math.floor((i * sources.length) / Math.max(1, n))];
      let flow = 1;
      for (let step = 0; step < 200; step++) {
        const c = this.at(x, y);
        if (c.elevation <= this.seaLevel) break; // reached the sea
        c.river = true;
        c.flow += flow;
        flow += 0.15;
        // flow to the lowest neighbor (ties broken deterministically)
        let bx = x;
        let by = y;
        let be = c.elevation;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nb = this.at(x + dx, y + dy);
          const eff = nb.elevation - (nb.river ? 0.03 : 0); // rivers attract rivers → confluences
          if (eff < be) {
            be = eff;
            bx = x + dx;
            by = y + dy;
          }
        }
        if (bx === x && by === y) {
          // a depression: form a lake and stop
          c.biome = 'lake';
          break;
        }
        x = bx;
        y = by;
      }
    }
  }

  private classify(): void {
    for (let y = 0; y < REGION_N; y++) {
      for (let x = 0; x < REGION_N; x++) {
        const c = this.at(x, y);
        const nearRiver = c.river || this.neighbors(x, y).some((n) => n.river);
        if (c.biome === 'lake') {
          // set in carveRivers
        } else if (c.elevation <= this.seaLevel) {
          c.biome = 'sea';
        } else if (c.river) {
          c.biome = 'river';
        } else if (c.elevation > 0.72) {
          c.biome = 'mountains';
        } else if (c.elevation > 0.58) {
          c.biome = 'hills';
        } else if (c.moisture > 0.78 && c.elevation < 0.4) {
          c.biome = 'marsh';
        } else if (c.moisture > 0.55 && c.temperature > 0.25) {
          c.biome = 'forest';
        } else {
          c.biome = 'plains';
        }
        // Derived budgets: what this land can actually support
        const irrigation = nearRiver ? 0.25 : 0;
        const warmth = Math.min(1, c.temperature * 1.4);
        c.fertility = Math.max(
          0.3,
          Math.min(1.4, (0.45 + c.moisture * 0.5 + irrigation) * warmth * (c.biome === 'marsh' ? 0.7 : 1) *
            (c.biome === 'mountains' ? 0.35 : c.biome === 'hills' ? 0.7 : 1)),
        );
        c.forest = c.biome === 'forest' ? 0.7 + c.moisture * 0.3 : c.biome === 'hills' ? 0.45 : c.biome === 'mountains' ? 0.25 : 0.3;
        c.roughness = c.biome === 'mountains' ? 1 : c.biome === 'hills' ? 0.6 : c.biome === 'marsh' ? 0.5 : 0.15;
      }
    }
  }

  private neighbors(x: number, y: number): Cell[] {
    const out: Cell[] = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      if (x + dx >= 0 && x + dx < REGION_N && y + dy >= 0 && y + dy < REGION_N) out.push(this.at(x + dx, y + dy));
    }
    return out;
  }

  isWater(x: number, y: number): boolean {
    const b = this.at(x, y).biome;
    return b === 'sea' || b === 'lake';
  }

  /** How good is this cell to settle? Farms, wood, water, defense — minus swamp and stone. */
  siteScore(x: number, y: number): number {
    const c = this.at(x, y);
    if (this.isWater(x, y) || c.biome === 'mountains') return -1;
    const coastal = this.neighbors(x, y).some((n) => n.biome === 'sea' || n.biome === 'lake');
    const nearRiver = c.river || this.neighbors(x, y).some((n) => n.river);
    return c.fertility * 2 + c.forest * 0.8 + (nearRiver ? 0.8 : 0) + (coastal ? 0.5 : 0) - c.roughness * 0.6;
  }

  siteAt(x: number, y: number): TownSite {
    const c = this.at(x, y);
    return {
      cellX: x,
      cellY: y,
      fertility: c.fertility,
      forest: c.forest,
      roughness: c.roughness,
      river: c.river || this.neighbors(x, y).some((n) => n.river),
      coastal: this.neighbors(x, y).some((n) => n.biome === 'sea' || n.biome === 'lake'),
    };
  }

  /** The founding valley: the best river-blessed plains cell near the map's heart.
   *  An optional preference biases the pick toward coast, highlands, or river. */
  startSite(pref: 'river-valley' | 'coastal' | 'highlands' | 'surprise' = 'river-valley'): TownSite {
    let best = { x: REGION_N / 2, y: REGION_N / 2, score: -Infinity };
    for (let y = 8; y < REGION_N - 8; y++) {
      for (let x = 8; x < REGION_N - 8; x++) {
        const centerBias = 1 - (Math.abs(x - REGION_N / 2) + Math.abs(y - REGION_N / 2)) / REGION_N;
        let score = this.siteScore(x, y) + centerBias * 1.2;
        if (this.siteScore(x, y) < 0) continue; // never settle water or peaks
        const c = this.at(x, y);
        const coastal = this.neighbors(x, y).some((n) => n.biome === 'sea' || n.biome === 'lake');
        const nearRiver = c.river || this.neighbors(x, y).some((n) => n.river);
        if (pref === 'coastal' && coastal) score += 3;
        else if (pref === 'highlands') score += c.roughness * 2.5;
        else if (pref === 'river-valley' && nearRiver) score += 1;
        if (score > best.score) best = { x, y, score };
      }
    }
    return this.siteAt(best.x, best.y);
  }

  /** Best unclaimed site within reach — expeditions read the land, not dice. */
  bestSiteNear(fromX: number, fromY: number, claimed: { x: number; y: number }[], range = 18): TownSite | null {
    let best: { x: number; y: number; score: number } | null = null;
    for (let y = Math.max(2, fromY - range); y < Math.min(REGION_N - 2, fromY + range); y++) {
      for (let x = Math.max(2, fromX - range); x < Math.min(REGION_N - 2, fromX + range); x++) {
        const d = Math.hypot(x - fromX, y - fromY);
        if (d < 6 || d > range) continue; // not on top of us, not beyond reach
        if (claimed.some((c) => Math.hypot(c.x - x, c.y - y) < 7)) continue;
        const score = this.siteScore(x, y);
        if (score > 0 && (!best || score > best.score)) best = { x, y, score };
      }
    }
    return best ? this.siteAt(best.x, best.y) : null;
  }

  /** Per-cell corridor cost for region routes: the terrain writes the
   *  network's shape (plains cheap, mountains dear). River cells carry a
   *  +2 bridge surcharge; open water takes no roads — ferries are a
   *  later era's problem. */
  cellCost(x: number, y: number): number {
    const c = this.at(x, y);
    switch (c.biome) {
      case 'sea':
      case 'lake': return Infinity;
      case 'river': return 3; // 1 + 2: the crossing needs a bridge
      case 'marsh': return 2.2;
      case 'mountains': return 3.5;
      case 'hills': return 1.8;
      case 'forest': return 1.3;
      default: return 1; // plains
    }
  }

  /**
   * A* corridor between two cells — pass-finding through valleys emerges
   * from the cost field rather than from script. Returns the full cell
   * path (both ends included) and its summed terrain cost, or null when
   * open water separates the endpoints.
   */
  corridor(ax: number, ay: number, bx: number, by: number): { path: { x: number; y: number }[]; cost: number } | null {
    const N = REGION_N;
    const key = (x: number, y: number) => y * N + x;
    const prev = new Int32Array(N * N).fill(-1);
    // Float64 on purpose: mixed-precision distance comparisons killed the
    // town-tier A* once already (see world.ts).
    const dist = new Float64Array(N * N).fill(Infinity);
    const startK = key(ax, ay);
    const targetK = key(bx, by);
    dist[startK] = 0;
    prev[startK] = startK;
    // admissible heuristic: manhattan × cheapest possible cell (plains = 1)
    const hCost = (k: number) => Math.abs((k % N) - bx) + Math.abs(Math.floor(k / N) - by);
    const heap: { k: number; d: number; f: number }[] = [{ k: startK, d: 0, f: hCost(startK) }];
    const push = (item: { k: number; d: number; f: number }) => {
      heap.push(item);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p].f <= heap[i].f) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = (): { k: number; d: number; f: number } => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length > 0) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1;
          const r = l + 1;
          let m = i;
          if (l < heap.length && heap[l].f < heap[m].f) m = l;
          if (r < heap.length && heap[r].f < heap[m].f) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    while (heap.length > 0) {
      const cur = pop();
      if (cur.d > dist[cur.k]) continue;
      if (cur.k === targetK) {
        const path: { x: number; y: number }[] = [];
        let k = targetK;
        while (k !== startK) {
          path.push({ x: k % N, y: Math.floor(k / N) });
          k = prev[k];
        }
        path.push({ x: ax, y: ay });
        path.reverse();
        return { path, cost: dist[targetK] };
      }
      const cx = cur.k % N;
      const cy = Math.floor(cur.k / N);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const step = this.cellCost(nx, ny);
        if (!isFinite(step)) continue;
        const nd = cur.d + step;
        const nk = key(nx, ny);
        if (nd < dist[nk]) {
          dist[nk] = nd;
          prev[nk] = cur.k;
          push({ k: nk, d: nd, f: nd + hCost(nk) });
        }
      }
    }
    return null;
  }

  /** Travel cost between two cells: rough country and water crossings are slow. */
  travelDays(ax: number, ay: number, bx: number, by: number): number {
    const dist = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(dist));
    let cost = 0;
    for (let i = 0; i <= steps; i++) {
      const x = Math.round(ax + ((bx - ax) * i) / steps);
      const y = Math.round(ay + ((by - ay) * i) / steps);
      const c = this.at(x, y);
      cost += this.isWater(x, y) ? 2.2 : 1 + c.roughness * 1.6;
    }
    return Math.max(2, Math.round((cost / steps) * (dist / 4)));
  }

  cellToCoord(x: number, y: number): { rx: number; ry: number } {
    return { rx: ((x + 0.5) / REGION_N) * 100, ry: ((y + 0.5) / REGION_N) * 100 };
  }

  coordToCell(rx: number, ry: number): { x: number; y: number } {
    return { x: Math.floor((rx / 100) * REGION_N), y: Math.floor((ry / 100) * REGION_N) };
  }
}
