// Track B Phase 6 — Fog-of-war foundation.
//
// The region tier currently stores fog as `explorationMap: TileVisibility[][]`
// — a 100×100 array of `'fogged' | 'explored' | 'scouted'` strings, serialized
// as 100 rows of `'0'`/`'1'` characters (see `region.ts`). That representation
// is fine for the hard town/region split, but the seamless world needs fog it
// can blit at every zoom level (a 100×100 `ImageData` at the far end, a per-cell
// overlay up close), which means a flat typed array, not a string-of-strings.
//
// This module is that typed-array fog, with three-state semantics identical to
// the existing `TileVisibility` and a migration path off the legacy save
// format. Like Phase 1's `WorldCamera` and Phase 2's `ParcelManager`, it ships
// as an additive, fully-tested foundation; `region.ts` adopts it during the
// Phase 4/6 renderer wiring, so the live serializer is untouched here.

/** Region fog grid is 100×100 (matches `RegionSim.explorationMap`, not the 64×64 cell grid). */
export const FOG_N = 100;

/** Three-state visibility, byte-valued. Mirrors `TileVisibility` semantics. */
export const FOG = { fogged: 0, explored: 1, scouted: 2 } as const;
export type FogState = (typeof FOG)[keyof typeof FOG];

export class FogMap {
  readonly n: number;
  /** Row-major `[x * n + y]`, one byte per tile. */
  readonly cells: Uint8Array;

  constructor(n: number = FOG_N) {
    this.n = n;
    this.cells = new Uint8Array(n * n);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.n && y < this.n;
  }

  get(x: number, y: number): FogState {
    return this.inBounds(x, y) ? (this.cells[x * this.n + y] as FogState) : FOG.fogged;
  }

  set(x: number, y: number, v: FogState): void {
    if (this.inBounds(x, y)) this.cells[x * this.n + y] = v;
  }

  /**
   * Circular reveal, matching `RegionSim.revealTiles`: `scouted` always wins
   * (line-of-sight this turn), while `explored` only ever lifts fog — it never
   * downgrades a tile already explored or scouted.
   */
  reveal(centerX: number, centerY: number, radius: number, type: FogState = FOG.explored): void {
    const r2 = radius * radius;
    const x0 = Math.max(0, Math.floor(centerX - radius));
    const x1 = Math.min(this.n - 1, Math.ceil(centerX + radius));
    const y0 = Math.max(0, Math.floor(centerY - radius));
    const y1 = Math.min(this.n - 1, Math.ceil(centerY + radius));
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const dx = x - centerX;
        const dy = y - centerY;
        if (dx * dx + dy * dy > r2) continue;
        const i = x * this.n + y;
        if (type === FOG.scouted || this.cells[i] === FOG.fogged) this.cells[i] = type;
      }
    }
  }

  /** Demote this turn's `scouted` tiles back to `explored` (call between turns). */
  clearScouted(): void {
    const c = this.cells;
    for (let i = 0; i < c.length; i++) if (c[i] === FOG.scouted) c[i] = FOG.explored;
  }

  /** Fraction of the map that is no longer fogged — handy for the zoom-out gate. */
  exploredFraction(): number {
    const c = this.cells;
    let seen = 0;
    for (let i = 0; i < c.length; i++) if (c[i] !== FOG.fogged) seen++;
    return seen / c.length;
  }

  // ── Serialization ───────────────────────────────────────────────────────────
  // `scouted` is ephemeral (re-derived from line-of-sight on load), so it
  // persists as `explored` — exactly what the legacy `'0'`/`'1'` format did.

  serialize(): string {
    const bytes = new Uint8Array(this.cells.length);
    for (let i = 0; i < bytes.length; i++) bytes[i] = this.cells[i] === FOG.fogged ? 0 : 1;
    return base64Encode(bytes);
  }

  static deserialize(b64: string, n: number = FOG_N): FogMap {
    const map = new FogMap(n);
    const bytes = base64Decode(b64);
    const len = Math.min(bytes.length, map.cells.length);
    for (let i = 0; i < len; i++) map.cells[i] = bytes[i] ? FOG.explored : FOG.fogged;
    return map;
  }

  /** Migrate the legacy `explorationMap` save shape: 100 rows of `'0'`/`'1'`,
   *  indexed `rows[x][y]` (the same order `region.ts` writes). */
  static fromLegacyRows(rows: string[], n: number = FOG_N): FogMap {
    const map = new FogMap(n);
    for (let x = 0; x < Math.min(rows.length, n); x++) {
      const row = rows[x] ?? '';
      for (let y = 0; y < Math.min(row.length, n); y++) {
        if (row[y] === '1') map.cells[x * n + y] = FOG.explored;
      }
    }
    return map;
  }

  /** Round-trip back to the legacy shape (persists `scouted` as `explored`). */
  toLegacyRows(): string[] {
    const rows: string[] = [];
    for (let x = 0; x < this.n; x++) {
      let row = '';
      for (let y = 0; y < this.n; y++) row += this.cells[x * this.n + y] === FOG.fogged ? '0' : '1';
      rows.push(row);
    }
    return rows;
  }
}

// ── Portable base64 (no Buffer/btoa dependency, so it runs in Node, browser,
//    and the eventual Web Worker alike) ───────────────────────────────────────
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64Encode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[b2 & 63] : '=';
  }
  return out;
}

function base64Decode(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const len = Math.floor((clean.length * 3) / 4);
  const out = new Uint8Array(len);
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = B64.indexOf(clean[i]);
    const c1 = B64.indexOf(clean[i + 1]);
    const c2 = i + 2 < clean.length ? B64.indexOf(clean[i + 2]) : -1;
    const c3 = i + 3 < clean.length ? B64.indexOf(clean[i + 3]) : -1;
    if (p < len) out[p++] = (c0 << 2) | (c1 >> 4);
    if (c2 >= 0 && p < len) out[p++] = ((c1 & 15) << 4) | (c2 >> 2);
    if (c3 >= 0 && p < len) out[p++] = ((c2 & 3) << 6) | c3;
  }
  return out;
}
