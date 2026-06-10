import { Rng } from './rng';

export type TileKind = 'grass' | 'tree' | 'water' | 'soil' | 'rock';

export interface Tile {
  kind: TileKind;
  /** farm soil growth 0..100; for trees, regrowth marker (unused in slice) */
  growth: number;
  /** soil tiles: sown this season */
  sown: boolean;
  /** tree marked for chopping by the player */
  marked: boolean;
  buildingId: number | null;
}

export interface Vec {
  x: number;
  y: number;
}

export const MAP_W = 64;
export const MAP_H = 64;

export class World {
  tiles: Tile[] = [];

  constructor(rng: Rng) {
    for (let i = 0; i < MAP_W * MAP_H; i++) {
      this.tiles.push({ kind: 'grass', growth: 0, sown: false, marked: false, buildingId: null });
    }
    this.generate(rng);
  }

  at(x: number, y: number): Tile {
    return this.tiles[y * MAP_W + x];
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;
  }

  passable(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    const k = this.at(x, y).kind;
    return k !== 'water' && k !== 'rock' && k !== 'tree';
  }

  private generate(rng: Rng): void {
    // A pond and a stream edge; tree stands; rocky outcrops. Center clearing for the wagon start.
    const pondX = 8 + rng.int(10);
    const pondY = 40 + rng.int(12);
    this.blob(pondX, pondY, 5 + rng.int(3), 'water', rng);
    for (let i = 0; i < 14; i++) {
      const cx = rng.int(MAP_W);
      const cy = rng.int(MAP_H);
      if (Math.abs(cx - MAP_W / 2) < 10 && Math.abs(cy - MAP_H / 2) < 10) continue;
      this.blob(cx, cy, 2 + rng.int(4), 'tree', rng);
    }
    for (let i = 0; i < 4; i++) {
      this.blob(rng.int(MAP_W), rng.int(MAP_H), 1 + rng.int(2), 'rock', rng);
    }
  }

  private blob(cx: number, cy: number, r: number, kind: TileKind, rng: Rng): void {
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (!this.inBounds(x, y)) continue;
        const d = Math.hypot(x - cx, y - cy);
        if (d <= r * (0.7 + rng.next() * 0.5) && this.at(x, y).kind === 'grass') {
          this.at(x, y).kind = kind;
        }
      }
    }
  }

  /** BFS path on the tile grid (water/rock/trees block). Returns waypoints excluding start. */
  findPath(from: Vec, to: Vec): Vec[] | null {
    const key = (x: number, y: number) => y * MAP_W + x;
    if (from.x === to.x && from.y === to.y) return [];
    const target = this.passable(to.x, to.y) ? to : this.nearestPassable(to);
    if (!target) return null;
    const prev = new Int32Array(MAP_W * MAP_H).fill(-1);
    const queue: Vec[] = [from];
    prev[key(from.x, from.y)] = key(from.x, from.y);
    const dirs = [
      [1, 0], [-1, 0], [0, 1], [0, -1],
    ];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur.x === target.x && cur.y === target.y) {
        const path: Vec[] = [];
        let k = key(cur.x, cur.y);
        const startK = key(from.x, from.y);
        while (k !== startK) {
          path.push({ x: k % MAP_W, y: Math.floor(k / MAP_W) });
          k = prev[k];
        }
        return path.reverse();
      }
      for (const [dx, dy] of dirs) {
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        if (!this.passable(nx, ny) || prev[key(nx, ny)] !== -1) continue;
        prev[key(nx, ny)] = key(cur.x, cur.y);
        queue.push({ x: nx, y: ny });
      }
    }
    return null;
  }

  nearestPassable(p: Vec): Vec | null {
    for (let r = 1; r < 8; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (this.passable(p.x + dx, p.y + dy)) return { x: p.x + dx, y: p.y + dy };
        }
      }
    }
    return null;
  }
}
