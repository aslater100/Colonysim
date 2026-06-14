import { describe, expect, it } from 'vitest';
import {
  CELL_PX,
  TILES_PER_CELL,
  WORLD_PX,
  MIN_ZOOM,
  MAX_ZOOM,
  CHUNK_ZOOM,
  TILE_ZOOM,
  createWorldCamera,
  renderModeFor,
  cellOf,
  tileOf,
  worldToCoord,
  cellOrigin,
  cellCenter,
  cellInRegion,
  worldToScreen,
  screenToWorld,
  panByScreen,
  zoomAt,
  clampCamera,
  visibleCellRange,
  type Viewport,
} from '../src/ui/worldcam';
import { TILE } from '../src/ui/sprites';
import { MAP_W } from '../src/sim/world';
import { REGION_N } from '../src/sim/worldgen';

const VP: Viewport = { width: 800, height: 600 };

describe('worldcam — constants', () => {
  it('derives cell/world dimensions from the canonical source constants', () => {
    expect(TILES_PER_CELL).toBe(MAP_W);
    expect(CELL_PX).toBe(MAP_W * TILE);
    expect(WORLD_PX).toBe(REGION_N * CELL_PX);
  });
});

describe('worldcam — render mode dispatch', () => {
  it('selects tile/chunk/biome by zoom thresholds', () => {
    expect(renderModeFor(MAX_ZOOM)).toBe('tile');
    expect(renderModeFor(TILE_ZOOM)).toBe('tile');
    expect(renderModeFor(TILE_ZOOM - 0.001)).toBe('chunk');
    expect(renderModeFor(CHUNK_ZOOM)).toBe('chunk');
    expect(renderModeFor(CHUNK_ZOOM - 0.001)).toBe('biome');
    expect(renderModeFor(MIN_ZOOM)).toBe('biome');
  });
});

describe('worldcam — coordinate decomposition', () => {
  it('cellOf / tileOf round-trip through a cell', () => {
    // 3 cells in, 7 tiles in.
    const wx = 3 * CELL_PX + 7 * TILE + 5;
    expect(cellOf(wx)).toBe(3);
    expect(tileOf(wx)).toBe(7);
  });

  it('tileOf handles cell boundaries and stays in [0, TILES_PER_CELL)', () => {
    expect(tileOf(0)).toBe(0);
    expect(tileOf(CELL_PX - 1)).toBe(TILES_PER_CELL - 1);
    expect(tileOf(CELL_PX)).toBe(0); // first tile of next cell
  });

  it('worldToCoord decomposes a point into cell + in-cell tile', () => {
    const c = worldToCoord(2 * CELL_PX + 10 * TILE, 5 * CELL_PX + 0);
    expect(c).toEqual({ cellX: 2, cellY: 5, tileX: 10, tileY: 0 });
  });

  it('cellOrigin / cellCenter are consistent', () => {
    expect(cellOrigin(4, 6)).toEqual({ x: 4 * CELL_PX, y: 6 * CELL_PX });
    expect(cellCenter(4, 6)).toEqual({ x: 4.5 * CELL_PX, y: 6.5 * CELL_PX });
  });

  it('cellInRegion guards the region bounds', () => {
    expect(cellInRegion(0, 0)).toBe(true);
    expect(cellInRegion(REGION_N - 1, REGION_N - 1)).toBe(true);
    expect(cellInRegion(-1, 0)).toBe(false);
    expect(cellInRegion(0, REGION_N)).toBe(false);
  });
});

describe('worldcam — screen ↔ world', () => {
  it('camera centre maps to the viewport centre', () => {
    const cam = createWorldCamera(10, 10, 1);
    const s = worldToScreen(cam, VP, cam.x, cam.y);
    expect(s).toEqual({ x: VP.width / 2, y: VP.height / 2 });
  });

  it('screenToWorld inverts worldToScreen at any zoom', () => {
    for (const zoom of [0.1, 0.5, 1, 2.5]) {
      const cam = clampCamera({ x: 50000, y: 70000, zoom });
      const s = worldToScreen(cam, VP, 50123, 70456);
      const round = screenToWorld(cam, VP, s.x, s.y);
      expect(round.x).toBeCloseTo(50123, 6);
      expect(round.y).toBeCloseTo(70456, 6);
    }
  });
});

describe('worldcam — controls', () => {
  it('panByScreen moves the world opposite to a drag, scaled by zoom', () => {
    const cam = createWorldCamera(10, 10, 2);
    const p = panByScreen(cam, 100, -40);
    expect(p.x).toBeCloseTo(cam.x - 100 / 2, 6);
    expect(p.y).toBeCloseTo(cam.y + 40 / 2, 6);
  });

  it('zoomAt keeps the world point under the anchor fixed', () => {
    const cam = createWorldCamera(20, 20, 1);
    const anchor = { x: 650, y: 120 };
    const worldBefore = screenToWorld(cam, VP, anchor.x, anchor.y);
    const zoomed = zoomAt(cam, VP, 1.8, anchor.x, anchor.y);
    expect(zoomed.zoom).toBeCloseTo(1.8, 6);
    const screenAfter = worldToScreen(zoomed, VP, worldBefore.x, worldBefore.y);
    expect(screenAfter.x).toBeCloseTo(anchor.x, 4);
    expect(screenAfter.y).toBeCloseTo(anchor.y, 4);
  });

  it('zoomAt respects MIN/MAX bounds and is a no-op at the limit', () => {
    const camMax = createWorldCamera(20, 20, MAX_ZOOM);
    expect(zoomAt(camMax, VP, 2, 400, 300)).toBe(camMax);
    const camMin = createWorldCamera(20, 20, MIN_ZOOM);
    expect(zoomAt(camMin, VP, 0.5, 400, 300)).toBe(camMin);
  });

  it('clampCamera keeps the centre inside the region and zoom in range', () => {
    const c = clampCamera({ x: -1000, y: WORLD_PX + 1000, zoom: 99 });
    expect(c.x).toBeGreaterThanOrEqual(0);
    expect(c.x).toBeLessThanOrEqual(WORLD_PX);
    expect(c.y).toBeGreaterThanOrEqual(0);
    expect(c.y).toBeLessThanOrEqual(WORLD_PX);
    expect(c.zoom).toBe(MAX_ZOOM);
  });
});

describe('worldcam — visible cell range', () => {
  it('zoomed out covers more cells than zoomed in', () => {
    const center = createWorldCamera(REGION_N / 2, REGION_N / 2, 1);
    const wide = visibleCellRange({ ...center, zoom: 0.05 }, VP);
    const narrow = visibleCellRange({ ...center, zoom: 4 }, VP);
    const wideCells = (wide.x1 - wide.x0 + 1) * (wide.y1 - wide.y0 + 1);
    const narrowCells = (narrow.x1 - narrow.x0 + 1) * (narrow.y1 - narrow.y0 + 1);
    expect(wideCells).toBeGreaterThan(narrowCells);
  });

  it('range stays within region bounds', () => {
    const cam = createWorldCamera(0, 0, 0.05);
    const r = visibleCellRange(cam, VP);
    expect(r.x0).toBeGreaterThanOrEqual(0);
    expect(r.y0).toBeGreaterThanOrEqual(0);
    expect(r.x1).toBeLessThanOrEqual(REGION_N - 1);
    expect(r.y1).toBeLessThanOrEqual(REGION_N - 1);
  });
});
