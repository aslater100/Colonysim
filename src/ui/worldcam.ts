// Track B Phase 1 — Unified Camera + World Coordinate System.
//
// A single continuous camera over the whole region replaces the hard
// `mode: 'town' | 'region'` switch. Zoom alone decides how the world is
// drawn (see `renderModeFor`):
//   zoom >= 1.0   → full per-tile rendering (existing render.ts)
//   0.3 <= zoom<1 → pre-rendered chunk canvases (building icons)
//   zoom < 0.3    → biome pixel blocks
//
// World-space is measured in tile-pixels: 1 world-px == 1 on-screen px at
// zoom 1.0. The region is REGION_N×REGION_N cells; each cell (a town parcel)
// is MAP_W×MAP_H tiles; each tile is TILE px. All three constants are
// imported so this module never drifts from the rest of the codebase.

import { TILE } from './sprites';
import { MAP_W, MAP_H } from '../sim/world';
import { REGION_N } from '../sim/worldgen';

/** Tiles along one axis of a single parcel/cell (square: MAP_W === MAP_H). */
export const TILES_PER_CELL = MAP_W;
/** World-pixels along one axis of a single cell at zoom 1.0 (96 × 32 = 3072). */
export const CELL_PX = TILES_PER_CELL * TILE;
/** World-pixels along one axis of the whole region (64 × 3072 = 196,608). */
export const WORLD_PX = REGION_N * CELL_PX;

/** Zoom bounds. Min is low enough to frame the whole region; max gives tile detail. */
export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 4.0;

/** Zoom thresholds for the three render tiers (Track B Phase 4). */
export const CHUNK_ZOOM = 0.3; // below this → biome blocks; at/above → chunk canvases
export const TILE_ZOOM = 1.0; // at/above this → full per-tile rendering

export type RenderMode = 'tile' | 'chunk' | 'biome';

export interface WorldCamera {
  /** Camera centre in world-pixels (tile-px at zoom 1.0). */
  x: number;
  y: number;
  /** Scale: on-screen px per world-px. */
  zoom: number;
}

/** A cell (parcel) coordinate plus the tile within it. */
export interface WorldCoord {
  cellX: number;
  cellY: number;
  tileX: number;
  tileY: number;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Create a camera centred on a cell's centre, or the region's centre by default. */
export function createWorldCamera(
  cellX = REGION_N / 2,
  cellY = REGION_N / 2,
  zoom = TILE_ZOOM,
): WorldCamera {
  return {
    x: (cellX + 0.5) * CELL_PX,
    y: (cellY + 0.5) * CELL_PX,
    zoom: clamp(zoom, MIN_ZOOM, MAX_ZOOM),
  };
}

/** Which render tier a given zoom selects. */
export function renderModeFor(zoom: number): RenderMode {
  if (zoom >= TILE_ZOOM) return 'tile';
  if (zoom >= CHUNK_ZOOM) return 'chunk';
  return 'biome';
}

// ── World-pixel ↔ cell/tile ────────────────────────────────────────────────
// `Math.floor` throughout so adjacent cells share an exact integer border and
// never leave a sub-pixel seam (Track B Phase 4 seam-prevention rule).

/** World-pixel → cell index along one axis. */
export function cellOf(worldPx: number): number {
  return Math.floor(worldPx / CELL_PX);
}

/** World-pixel → tile index within its cell along one axis (0..TILES_PER_CELL-1). */
export function tileOf(worldPx: number): number {
  return Math.floor((((worldPx % CELL_PX) + CELL_PX) % CELL_PX) / TILE);
}

/** Decompose a world-pixel point into cell + in-cell tile. */
export function worldToCoord(wx: number, wy: number): WorldCoord {
  return { cellX: cellOf(wx), cellY: cellOf(wy), tileX: tileOf(wx), tileY: tileOf(wy) };
}

/** Top-left world-pixel of a cell. */
export function cellOrigin(cellX: number, cellY: number): { x: number; y: number } {
  return { x: cellX * CELL_PX, y: cellY * CELL_PX };
}

/** World-pixel centre of a cell. */
export function cellCenter(cellX: number, cellY: number): { x: number; y: number } {
  return { x: (cellX + 0.5) * CELL_PX, y: (cellY + 0.5) * CELL_PX };
}

/** Is a cell index pair inside the region? */
export function cellInRegion(cellX: number, cellY: number): boolean {
  return cellX >= 0 && cellY >= 0 && cellX < REGION_N && cellY < REGION_N;
}

// ── Screen ↔ world ──────────────────────────────────────────────────────────
// Screen-space origin is the top-left of the viewport. The camera's (x,y) is
// the world point shown at the viewport centre.

export interface Viewport {
  width: number;
  height: number;
}

/** World-pixel → screen-pixel for the given camera + viewport. */
export function worldToScreen(
  cam: WorldCamera,
  vp: Viewport,
  wx: number,
  wy: number,
): { x: number; y: number } {
  return {
    x: (wx - cam.x) * cam.zoom + vp.width / 2,
    y: (wy - cam.y) * cam.zoom + vp.height / 2,
  };
}

/** Screen-pixel → world-pixel for the given camera + viewport. */
export function screenToWorld(
  cam: WorldCamera,
  vp: Viewport,
  sx: number,
  sy: number,
): { x: number; y: number } {
  return {
    x: (sx - vp.width / 2) / cam.zoom + cam.x,
    y: (sy - vp.height / 2) / cam.zoom + cam.y,
  };
}

// ── Camera controls (pure: return a new camera, never mutate) ───────────────

/** Pan by a screen-pixel delta (e.g. a mouse drag), respecting current zoom. */
export function panByScreen(cam: WorldCamera, dxScreen: number, dyScreen: number): WorldCamera {
  return clampCamera({ ...cam, x: cam.x - dxScreen / cam.zoom, y: cam.y - dyScreen / cam.zoom });
}

/**
 * Zoom by a multiplicative factor while keeping the world point under the
 * given screen anchor fixed (classic scroll-wheel-toward-cursor behaviour).
 */
export function zoomAt(
  cam: WorldCamera,
  vp: Viewport,
  factor: number,
  anchorScreenX: number,
  anchorScreenY: number,
): WorldCamera {
  const nz = clamp(cam.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  if (nz === cam.zoom) return cam;
  // The world point under the anchor must map to the same screen point after zoom.
  const before = screenToWorld(cam, vp, anchorScreenX, anchorScreenY);
  const after = screenToWorld({ ...cam, zoom: nz }, vp, anchorScreenX, anchorScreenY);
  return clampCamera({ x: cam.x + (before.x - after.x), y: cam.y + (before.y - after.y), zoom: nz });
}

/**
 * Keep the camera centre within the region bounds (a half-tile margin so the
 * very edge stays reachable) and the zoom within limits.
 */
export function clampCamera(cam: WorldCamera): WorldCamera {
  const margin = TILE / 2;
  return {
    x: clamp(cam.x, margin, WORLD_PX - margin),
    y: clamp(cam.y, margin, WORLD_PX - margin),
    zoom: clamp(cam.zoom, MIN_ZOOM, MAX_ZOOM),
  };
}

/** The range of cells currently touching the viewport (inclusive), clamped to the region. */
export function visibleCellRange(
  cam: WorldCamera,
  vp: Viewport,
): { x0: number; y0: number; x1: number; y1: number } {
  const tl = screenToWorld(cam, vp, 0, 0);
  const br = screenToWorld(cam, vp, vp.width, vp.height);
  return {
    x0: clamp(cellOf(tl.x), 0, REGION_N - 1),
    y0: clamp(cellOf(tl.y), 0, REGION_N - 1),
    x1: clamp(cellOf(br.x), 0, REGION_N - 1),
    y1: clamp(cellOf(br.y), 0, REGION_N - 1),
  };
}

// MAP_H is imported to assert the square-cell assumption at module load:
// the coordinate math above treats a cell as CELL_PX on both axes.
if (MAP_W !== MAP_H) {
  throw new Error(`worldcam: non-square parcels unsupported (MAP_W=${MAP_W}, MAP_H=${MAP_H})`);
}
