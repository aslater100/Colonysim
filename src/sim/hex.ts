/**
 * Pointy-top hexagonal grid utilities using odd-r offset coordinates.
 *
 * Storage stays flat: cells[row * REGION_N + col]. Odd rows are shifted
 * right by half a hex width in screen space only.
 *
 * Direction order (0-5, clockwise from E):
 *   0=E, 1=SE, 2=SW, 3=W, 4=NW, 5=NE
 *
 * Edge d of a hex is the segment between hexCorners()[d] and hexCorners()[(d+1)%6],
 * so checking neighbor d and drawing edge d are always consistent.
 */

// [dcol, drow] offsets for each of the 6 directions, even and odd rows.
export const HEX_DIRS_EVEN: readonly [number, number][] = [
  [+1,  0], // 0: E
  [ 0, +1], // 1: SE
  [-1, +1], // 2: SW
  [-1,  0], // 3: W
  [-1, -1], // 4: NW
  [ 0, -1], // 5: NE
] as const;

export const HEX_DIRS_ODD: readonly [number, number][] = [
  [+1,  0], // 0: E
  [+1, +1], // 1: SE
  [ 0, +1], // 2: SW
  [-1,  0], // 3: W
  [ 0, -1], // 4: NW
  [+1, -1], // 5: NE
] as const;

/** Returns 6 absolute [col, row] neighbors in direction order 0..5. */
export function hexNeighbors(col: number, row: number): [number, number][] {
  const dirs = row & 1 ? HEX_DIRS_ODD : HEX_DIRS_EVEN;
  return dirs.map(([dc, dr]) => [col + dc, row + dr] as [number, number]);
}

/** Returns [col, row] of the neighbor in direction d (0..5). */
export function hexNeighborDir(col: number, row: number, d: number): [number, number] {
  const [dc, dr] = (row & 1 ? HEX_DIRS_ODD : HEX_DIRS_EVEN)[d];
  return [col + dc, row + dr];
}

/**
 * Screen-space center of hex (col, row).
 * ox/oy is the origin where the (0,0) hex center sits (not a margin — callers
 * add the margin themselves via the hexLayoutParams helper).
 */
export function hexCenter(
  col: number, row: number, size: number, ox: number, oy: number,
): { x: number; y: number } {
  const w = Math.sqrt(3) * size;
  return {
    x: ox + col * w + (row & 1) * (w / 2),
    y: oy + row * 1.5 * size,
  };
}

/**
 * Six corner vertices of a pointy-top hex centred at (cx, cy).
 * Corners are in direction order: corner[d] and corner[(d+1)%6] bound edge d.
 */
export function hexCorners(cx: number, cy: number, size: number): { x: number; y: number }[] {
  const corners: { x: number; y: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    corners.push({ x: cx + size * Math.cos(angle), y: cy + size * Math.sin(angle) });
  }
  return corners;
}

/** Convert odd-r offset (col, row) → cube coordinates. */
export function offsetToCube(col: number, row: number): { q: number; r: number; s: number } {
  const q = col - (row - (row & 1)) / 2;
  const r = row;
  return { q, r, s: -q - r };
}

/** Minimum number of hex steps between two offset-coordinate cells. */
export function hexDistance(col1: number, row1: number, col2: number, row2: number): number {
  const a = offsetToCube(col1, row1);
  const b = offsetToCube(col2, row2);
  return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.s - b.s));
}

/**
 * Layout parameters for fitting a REGION_N × REGION_N hex grid inside a
 * canvas area of (W × H) with margin m on all sides.
 *
 * Returns the hex size (circumradius) and the origin (ox, oy) to pass to
 * hexCenter / screenToHex — (ox, oy) is the pixel position of the (0,0) hex center.
 */
export function hexLayoutParams(
  W: number, H: number, N: number, m: number,
): { size: number; ox: number; oy: number } {
  const size = Math.min(
    (H - 2 * m) / (1.5 * N + 0.5),
    (W - 2 * m) / (Math.sqrt(3) * (N + 0.5)),
  );
  const w = Math.sqrt(3) * size;
  return {
    size,
    ox: m + w / 2,  // left edge of leftmost hex sits at x=m
    oy: m + size,   // top vertex of top row sits at y=m
  };
}

/**
 * Map a canvas pixel (px, py) back to the nearest hex (col, row).
 * Use the same size/ox/oy from hexLayoutParams.
 */
export function screenToHex(
  px: number, py: number, size: number, ox: number, oy: number,
): { col: number; row: number } {
  // Fractional axial coordinates (pointy-top)
  const fq = (Math.sqrt(3) / 3 * (px - ox) - 1 / 3 * (py - oy)) / size;
  const fr = 2 / 3 * (py - oy) / size;
  const fs = -fq - fr;

  // Cube rounding
  let rq = Math.round(fq);
  let rr = Math.round(fr);
  const rs = Math.round(fs);

  const dq = Math.abs(rq - fq);
  const dr = Math.abs(rr - fr);
  const ds = Math.abs(rs - fs);

  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;

  // Cube → odd-r offset
  const col = rq + (rr - (rr & 1)) / 2;
  return { col, row: rr };
}
