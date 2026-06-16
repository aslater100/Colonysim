/**
 * The canonical starting colony for the SoA `TownCore` — the layout a player
 * gets on "New Colony". Extracted so the GUI harness (`coreview.ts`) and the
 * headless balance harness (`town-headless.ts`) build the exact same town,
 * i.e. the harness validates the configuration players actually start from.
 */
import { TERRAIN, ZONE } from './build';
import { ROOM_TYPE_ID } from './defs';
import type { TownCore } from './towncore';

/** Paint the kitchen/home/tavern/library/infirmary starter town, seed 8
 *  founders, stock starting goods, and lay the work zones. `map` is the grid
 *  width (square map), used to centre the town. */
export function buildStarterTown(core: TownCore, map: number): void {
  const g = core.grid;
  const cx = map >> 1, cy = map >> 1;
  for (let y = cy - 12; y <= cy + 12; y++) for (let x = cx - 12; x <= cx + 16; x++) g.setTerrain(x, y, TERRAIN.GRASS);
  const room = (x0: number, y0: number, x1: number, y1: number, type: string): void => {
    g.designateRect(x0, y0, x1, y1, ROOM_TYPE_ID.get(type)!);
    for (let x = x0 - 1; x <= x1 + 1; x++) { g.setWall(x, y0 - 1); g.setWall(x, y1 + 1); }
    for (let y = y0 - 1; y <= y1 + 1; y++) { g.setWall(x0 - 1, y); g.setWall(x1 + 1, y); }
    g.setGate((x0 + x1) >> 1, y1 + 1);
  };
  const fill = (id: string, x0: number, y0: number, x1: number, y1: number, dx: number, dy: number): void => {
    for (let y = y0; y <= y1; y += dy) for (let x = x0; x <= x1; x += dx) g.placeStation(id, x, y);
  };

  room(cx - 4, cy - 9, cx + 3, cy - 6, 'kitchen');
  fill('oven', cx - 4, cy - 9, cx + 3, cy - 9, 2, 1);

  room(cx - 5, cy + 4, cx + 4, cy + 9, 'home');
  fill('bunk', cx - 5, cy + 4, cx + 4, cy + 8, 2, 3);

  room(cx + 8, cy - 2, cx + 14, cy + 2, 'tavern');
  fill('table', cx + 8, cy - 2, cx + 13, cy + 2, 3, 2);

  room(cx - 14, cy - 4, cx - 10, cy - 1, 'library');
  fill('desk', cx - 13, cy - 3, cx - 11, cy - 2, 2, 1);

  room(cx - 14, cy + 2, cx - 10, cy + 6, 'infirmary');
  fill('sickbed', cx - 13, cy + 3, cx - 11, cy + 5, 2, 2);

  g.rebuildRooms();
  core.stock.add('grain', 5000);
  core.stock.add('wood', 200);
  core.stock.add('herbs', 4); // starter herbs for apothecary craft
  core.seedColony(cx, cy, 8);

  const autoZone = (type: number, cap: number): void => {
    for (let i = 0, n = 0; i < g.size && n < cap; i++) {
      if (g.setZone(i % map, (i / map) | 0, type)) n++;
    }
  };
  autoZone(ZONE.FIELD, 16);
  autoZone(ZONE.WOODCUTTER, 12);
  autoZone(ZONE.QUARRY, 8);
  autoZone(ZONE.FISHERY, 6);
  autoZone(ZONE.FORAGE, 8);
  autoZone(ZONE.ORCHARD, 10);
  autoZone(ZONE.VEGGARDEN, 8);
}
