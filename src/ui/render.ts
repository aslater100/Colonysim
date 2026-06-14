/**
 * Renderer: lush layered parallax background behind a crisp 8-bit foreground
 * (GDD §3.1). Background = sky by time-of-day, stars, sun/moon, three
 * mountain/forest bands, haze. Foreground = the tile map and sprites.
 */
import type { Simulation } from '../sim/sim';
import { MAP_W, MAP_H } from '../sim/world';
import { buildingDef, BUILDING_DEFS, TUNING, STATION_DEF_BY_NUM, ROOM_TYPE_ID, BLUEPRINT_DEFS } from '../sim/defs';
import { buildSprites, TILE } from './sprites';
import type { SpriteSet } from './sprites';
import type { RegionMap } from '../sim/worldgen';
import type { TownSite } from '../sim/worldgen';

export interface Camera {
  x: number; // pixels (world-space, unzoomed)
  y: number;
  zoom: number; // display scale factor (0.5–4.0)
  placing: string | null; // building def id when in placement mode
  placingRotation: number; // 0-3 clockwise 90° turns for placement ghost
  placingZone: import('../sim/world').PaintKind | null;
  chopMode: boolean;
  overlay: 'none' | 'traffic';
  mouseTile: { x: number; y: number };
  selectedSettler: number | null;
  selectedBuilding: number | null;
  selectedStockpile: { x: number; y: number } | null;
  // B-5 room paint layer (BuildGrid tool — not wired to live sim until B-6)
  buildGrid: import('../sim/build').BuildGrid | null;
  roomPaintMode: 'wall' | 'floor' | 'room' | 'station' | 'erase' | null;
  roomTypeId: number;     // numeric ROOM_TYPE_ID; 0 = none
  stationTypeId: number;  // numeric STATION_TYPE_ID; 0 = none
  stampBlueprint: string | null;
}

const SKY_DAY = [104, 144, 170];
const SKY_DUSK = [168, 110, 86];
const SKY_NIGHT = [18, 22, 38];

// Room type overlay colours — index = numeric typeId (1-based from ROOM_DEFS order).
const ROOM_TYPE_COLORS = [
  '',                          // 0 = none
  'rgba(200,170,120,0.38)',   // 1  home       — warm tan
  'rgba(220,140,60,0.42)',    // 2  kitchen    — orange
  'rgba(220,190,80,0.42)',    // 3  bakery     — golden
  'rgba(200,190,140,0.38)',   // 4  mill       — wheat
  'rgba(220,90,50,0.42)',     // 5  smithy     — red-orange
  'rgba(180,60,40,0.48)',     // 6  foundry    — dark red
  'rgba(160,130,80,0.38)',    // 7  sawmill    — brown
  'rgba(100,130,180,0.42)',   // 8  workshop   — blue-grey
  'rgba(180,90,60,0.42)',     // 9  kilnhouse  — brick red
  'rgba(80,110,200,0.42)',    // 10 library    — blue
  'rgba(160,210,180,0.42)',   // 11 infirmary  — pale green
  'rgba(80,190,100,0.42)',    // 12 apothecary — green
  'rgba(160,100,200,0.42)',   // 13 tavern     — purple
  'rgba(150,150,130,0.38)',   // 14 storehouse — grey
];

// Buildings that vent chimney smoke while built
const SMOKE_BUILDINGS = new Set([
  'house', 'cottage', 'kitchen', 'bakery', 'blacksmith', 'kiln', 'brewery', 'hearth',
]);
// Buildings whose windows (or fires) spill warm light after dark
const GLOW_BUILDINGS = new Set([
  'hearth', 'house', 'cottage', 'barracks', 'longhouse', 'hall', 'town_hall',
  'kitchen', 'bakery', 'lodge', 'clinic', 'apothecary', 'schoolhouse', 'brewery',
  'tailor', 'forester', 'blacksmith',
]);

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mix(a: number[], b: number[], t: number): string {
  return `rgb(${Math.round(lerp(a[0], b[0], t))},${Math.round(lerp(a[1], b[1], t))},${Math.round(lerp(a[2], b[2], t))})`;
}

/** 0 at midnight, 1 at noon. */
function daylight(hour: number): number {
  return Math.max(0, Math.min(1, (Math.cos(((hour - 12) / 24) * Math.PI * 2) + 0.4) / 1.2));
}

export class Renderer {
  private g: CanvasRenderingContext2D;
  private sprites: SpriteSet;
  private frame = 0;

  constructor(private canvas: HTMLCanvasElement, private sim: Simulation, private cam: Camera) {
    this.g = canvas.getContext('2d')!;
    this.g.imageSmoothingEnabled = false;
    this.sprites = buildSprites(BUILDING_DEFS);
  }

  draw(): void {
    this.frame++;
    const W = this.canvas.width;
    const H = this.canvas.height;
    this.drawBackdrop(W, H);
    const zoom = this.cam.zoom;
    this.g.save();
    this.g.scale(zoom, zoom);
    this.drawMap();
    this.drawPlacementGhost();
    this.g.restore();
  }

  private drawBackdrop(W: number, H: number): void {
    const { g } = this;
    const hour = this.sim.hour;
    const d = daylight(hour);
    const duskiness = Math.max(0, 1 - Math.abs(d - 0.35) * 5);

    // Sky gradient: night→day at the top; the horizon warms toward dusk orange
    const top = mix(SKY_NIGHT, SKY_DAY, d);
    const horizonRgb = SKY_NIGHT.map((v, i) => lerp(v, SKY_DAY[i], Math.min(1, d * 1.3)))
      .map((v, i) => lerp(v, SKY_DUSK[i], duskiness));
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, top);
    grad.addColorStop(1, `rgb(${horizonRgb.map(Math.round).join(',')})`);
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);

    // Stars at night (stable pseudo-random field)
    if (d < 0.3) {
      g.fillStyle = `rgba(220,225,255,${(0.3 - d) * 2.5})`;
      for (let i = 0; i < 80; i++) {
        const sx = (i * 97) % W;
        const sy = ((i * 61) % Math.floor(H * 0.5));
        g.fillRect(sx, sy, 1 + (i % 7 === 0 ? 1 : 0), 1);
      }
    }

    // Sun / moon arc
    const bodyT = ((hour - 6 + 24) % 24) / 24;
    const bx = bodyT * W;
    const by = H * 0.55 - Math.sin(bodyT * Math.PI) * H * 0.45;
    g.fillStyle = hour > 5.5 && hour < 18.5 ? '#e8d27a' : '#cfd4e0';
    g.fillRect(Math.round(bx) - 5, Math.round(by) - 5, 10, 10);
    g.fillRect(Math.round(bx) - 7, Math.round(by) - 3, 14, 6);

    // Drifting clouds during daylight
    if (d > 0.15) {
      g.fillStyle = `rgba(236,238,242,${0.08 + d * 0.14})`;
      for (let i = 0; i < 6; i++) {
        const speed = 0.06 + (i % 3) * 0.05;
        const cx = Math.round(((i * 211 + this.frame * speed) % (W + 90)) - 45);
        const cy = 14 + ((i * 67) % Math.max(1, Math.floor(H * 0.28)));
        const cw = 30 + (i % 3) * 16;
        g.fillRect(cx, cy, cw, 5);
        g.fillRect(cx + 6, cy - 3, cw - 14, 3);
        g.fillRect(cx + 9, cy + 5, cw - 18, 3);
      }
    }

    // Parallax bands: far ridge, near ridge, treeline — offset slightly by camera
    const bands = [
      { yBase: 0.42, amp: 26, col: mix(SKY_NIGHT, [70, 84, 100], Math.max(0.25, d)), px: 0.05, step: 53 },
      { yBase: 0.52, amp: 34, col: mix(SKY_NIGHT, [56, 70, 64], Math.max(0.2, d)), px: 0.12, step: 37 },
      { yBase: 0.6, amp: 18, col: mix(SKY_NIGHT, [38, 52, 40], Math.max(0.15, d)), px: 0.22, step: 23 },
    ];
    for (const b of bands) {
      g.fillStyle = b.col;
      const off = this.cam.x * b.px;
      for (let x = 0; x < W; x += 4) {
        const k = Math.floor((x + off) / b.step);
        const hgt = b.amp * (0.5 + 0.5 * Math.abs(Math.sin(k * 12.9898) * 43758.5453 % 1));
        g.fillRect(x, Math.round(H * b.yBase - hgt), 4, Math.round(hgt + H * (1 - b.yBase)));
      }
    }

    // Smog/haze band rises with built industry (kitchen smoke for now)
    const smoke = this.sim.builtOf('cook').length * 0.06 + 0.05;
    g.fillStyle = `rgba(120,110,96,${Math.min(0.35, smoke)})`;
    g.fillRect(0, Math.round(H * 0.55), W, Math.round(H * 0.1));

    // Night dimming overlay for the whole scene happens after map draw — see drawMap
  }

  private mapOrigin(): { ox: number; oy: number } {
    return { ox: Math.round(-this.cam.x), oy: Math.round(-this.cam.y) };
  }

  private isInViewport(px: number, py: number, buffer: number = TILE * 2): boolean {
    // Coordinates are in the zoom-scaled context: the visible area spans canvas/zoom world-pixels.
    const zoom = this.cam.zoom;
    return px >= -buffer && py >= -buffer && px < this.canvas.width / zoom + buffer && py < this.canvas.height / zoom + buffer;
  }

  tileAt(px: number, py: number): { x: number; y: number } {
    const zoom = this.cam.zoom;
    return {
      x: Math.floor((px / zoom + this.cam.x) / TILE),
      y: Math.floor((py / zoom + this.cam.y) / TILE),
    };
  }

  private drawMap(): void {
    const { g, sim, sprites } = this;
    const { ox, oy } = this.mapOrigin();
    const anim = Math.floor(this.frame / 30) % 2;

    // Visible tile bounds: the context is zoom-scaled, so the viewport spans
    // canvas/zoom world-pixels. Iterating only these tiles (instead of the
    // full map with per-tile checks) keeps the frame cheap at high population.
    const vw = this.canvas.width / this.cam.zoom;
    const vh = this.canvas.height / this.cam.zoom;
    const tx0 = Math.max(0, Math.floor((-ox - TILE * 2) / TILE));
    const ty0 = Math.max(0, Math.floor((-oy - TILE * 2) / TILE));
    const tx1 = Math.min(MAP_W, Math.ceil((vw - ox + TILE * 2) / TILE));
    const ty1 = Math.min(MAP_H, Math.ceil((vh - oy + TILE * 2) / TILE));

    // Stockpile fill metrics — computed once per frame, shared across all zone tiles.
    const stockCap = sim.stockpileCapacity();
    const stockFill = stockCap > 0 ? Math.min(1, sim.totalRawStock() / stockCap) : 0;
    const stockDom = sim.stock.grain >= sim.stock.wood && sim.stock.grain >= sim.stock.stone ? '#e8b84b'
      : sim.stock.wood >= sim.stock.stone ? '#8b5e3c' : '#9e9e9e';

    // Pass 1: ground (grass clusters via coarse hash so tones form patches),
    // water, soil, roads. Trees draw in pass 2 so canopies overlap properly.
    for (let y = ty0; y < ty1; y++) {
      for (let x = tx0; x < tx1; x++) {
        const t = sim.world.at(x, y);
        const px = ox + x * TILE;
        const py = oy + y * TILE;
        // Bleed each ground tile 1px into its right/bottom neighbour. At a
        // fractional zoom the scaled context lands tile edges on sub-pixels and
        // the backdrop shows through the gaps as a thin grid; the overlap from
        // one side closes every interior seam.
        const bw = TILE + 1;
        if (t.kind === 'water') {
          g.drawImage(sprites.water[anim], px, py, bw, bw);
        } else if (t.kind === 'soil') {
          const img = t.growth >= 100 ? sprites.soilRipe : t.growth > 40 ? sprites.soilGrown : t.sown ? sprites.soilSown : sprites.soil;
          g.drawImage(img, px, py, bw, bw);
        } else {
          // patchy grass: coarse 3×3 cluster hash picks the variant; rare worn dirt
          const cl = (Math.floor(x / 3) * 73 + Math.floor(y / 3) * 31) % 5;
          const worn = (x * 53 + y * 97) % 89 === 0;
          g.drawImage(worn ? sprites.dirtPatch : sprites.grass[cl % 4], px, py, bw, bw);
        }
        if (t.road) g.drawImage(sprites.roads[t.road], px, py, bw, bw);
        else if (t.roadPlan) g.drawImage(sprites.roadPlans[t.roadPlan], px, py);
        if (t.stockpileZone && !t.road) {
          g.drawImage(sprites.stockpileZone, px, py);
          if (stockFill > 0.05) {
            g.globalAlpha = stockFill * 0.35;
            g.fillStyle = stockDom;
            g.fillRect(px + 1, py + 1, TILE - 2, Math.round((TILE - 2) * stockFill));
            g.globalAlpha = 1;
          }
        }
        if (t.trapZone) g.drawImage(sprites.trapZone, px, py);
        if (t.wallPlan) g.drawImage(sprites.wallPlan, px, py);
        if (t.gatePlan) g.drawImage(sprites.gatePlan, px, py);
      }
    }
    // Pass 2: standing terrain (rocks, palisades, then trees with overhanging canopies)
    for (let y = ty0; y < ty1; y++) {
      for (let x = tx0; x < tx1; x++) {
        const t = sim.world.at(x, y);
        const px = ox + x * TILE;
        const py = oy + y * TILE;
        if (t.kind === 'rock') {
          g.drawImage(t.marked ? sprites.rockMarked : sprites.rock, px, py);
          if (t.oreDeposit) {
            // Ore vein flecks: small amber/orange dots scattered across the rock face.
            g.fillStyle = 'rgba(210,140,40,0.72)';
            g.fillRect(px + 4,  py + 5,  3, 2);
            g.fillRect(px + 10, py + 3,  2, 2);
            g.fillRect(px + 7,  py + 10, 2, 3);
            g.fillRect(px + 2,  py + 12, 3, 2);
            g.fillRect(px + 14, py + 9,  2, 2);
            g.fillStyle = 'rgba(255,200,60,0.55)';
            g.fillRect(px + 5,  py + 6,  2, 1);
            g.fillRect(px + 11, py + 11, 2, 1);
          }
        }
        else if (t.wall) {
          const mask =
            (sim.world.inBounds(x, y - 1) && (sim.world.at(x, y - 1).wall || sim.world.at(x, y - 1).gate) ? 1 : 0) |
            (sim.world.inBounds(x + 1, y) && (sim.world.at(x + 1, y).wall || sim.world.at(x + 1, y).gate) ? 2 : 0) |
            (sim.world.inBounds(x, y + 1) && (sim.world.at(x, y + 1).wall || sim.world.at(x, y + 1).gate) ? 4 : 0) |
            (sim.world.inBounds(x - 1, y) && (sim.world.at(x - 1, y).wall || sim.world.at(x - 1, y).gate) ? 8 : 0);
          g.drawImage(sprites.palisadeVariants[mask], px, py);
        } else if (t.gate) {
          const gmask =
            (sim.world.inBounds(x, y - 1) && (sim.world.at(x, y - 1).wall || sim.world.at(x, y - 1).gate) ? 1 : 0) |
            (sim.world.inBounds(x + 1, y) && (sim.world.at(x + 1, y).wall || sim.world.at(x + 1, y).gate) ? 2 : 0) |
            (sim.world.inBounds(x, y + 1) && (sim.world.at(x, y + 1).wall || sim.world.at(x, y + 1).gate) ? 4 : 0) |
            (sim.world.inBounds(x - 1, y) && (sim.world.at(x - 1, y).wall || sim.world.at(x - 1, y).gate) ? 8 : 0);
          g.drawImage(sprites.gateVariants[gmask], px, py);
        }
        else if (t.kind === 'tree') g.drawImage(t.marked ? sprites.treeMarked : sprites.tree, px - 4, py - 12);
        else if (t.sapling) g.drawImage(sprites.sapling, px, py);
      }
    }
    // Wall & gate HP bars
    for (let y = ty0; y < ty1; y++) {
      for (let x = tx0; x < tx1; x++) {
        const t = sim.world.at(x, y);
        const maxHp = t.wall ? TUNING.wallMaxHp : t.gate ? TUNING.gateMaxHp : 0;
        if (maxHp && t.wallHp < maxHp) {
          this.hpBar(ox + x * TILE, oy + y * TILE - 3, t.wallHp / maxHp);
        }
      }
    }

    // Traffic overlay: warm heatmap of recent transits
    if (this.cam.overlay === 'traffic') {
      for (let y = ty0; y < ty1; y++) {
        for (let x = tx0; x < tx1; x++) {
          const v = sim.traffic[y * MAP_W + x];
          if (v < 0.5) continue;
          g.fillStyle = `rgba(232,150,60,${Math.min(0.65, v / 40)})`;
          g.fillRect(ox + x * TILE, oy + y * TILE, TILE, TILE);
        }
      }
    }

    // BuildGrid overlay: floor tint, room colour, walls, station labels (B-5)
    if (this.cam.buildGrid) {
      const grid = this.cam.buildGrid;
      for (let y = ty0; y < ty1; y++) {
        for (let x = tx0; x < tx1; x++) {
          const i = grid.index(x, y);
          if (grid.floor[i] === 0 && grid.wall[i] === 0) continue;
          const px = ox + x * TILE;
          const py = oy + y * TILE;
          if (grid.wall[i] > 0) {
            g.fillStyle = 'rgba(48,38,26,0.9)';
            g.fillRect(px, py, TILE, TILE);
            g.fillStyle = 'rgba(88,74,52,0.45)';
            g.fillRect(px, py, TILE, 1);
            g.fillRect(px, py, 1, TILE);
          } else {
            g.fillStyle = 'rgba(210,195,160,0.28)';
            g.fillRect(px, py, TILE, TILE);
            const rid = grid.roomId[i];
            if (rid >= 0) {
              const col = ROOM_TYPE_COLORS[grid.rooms[rid]?.typeId ?? 0];
              if (col) { g.fillStyle = col; g.fillRect(px, py, TILE, TILE); }
            }
          }
        }
      }
      for (const s of grid.stations) {
        const spx = ox + s.x * TILE;
        const spy = oy + s.y * TILE;
        if (!this.isInViewport(spx, spy, s.w * TILE + TILE)) continue;
        g.fillStyle = 'rgba(28,20,12,0.72)';
        g.fillRect(spx + 2, spy + 2, s.w * TILE - 4, s.h * TILE - 4);
        const def = STATION_DEF_BY_NUM[s.typeId];
        if (def) {
          g.fillStyle = '#d8c89a';
          g.font = '7px monospace';
          g.fillText(def.name.slice(0, 6), spx + 3, spy + 9);
        }
      }
    }

    // Buildings (built solid, blueprints ghosted)
    for (const b of sim.buildings) {
      const def = buildingDef(b.defId);
      const levelKey = `${b.defId}:${b.level ?? 1}`;
      const img = b.built
        ? (this.sprites.buildings[levelKey] ?? this.sprites.buildings[b.defId])
        : this.sprites.blueprints[b.defId];
      const rot = b.rotation ?? 0;
      const rw = rot % 2 === 1 ? def.h : def.w;
      const rh = rot % 2 === 1 ? def.w : def.h;
      const bx = ox + b.x * TILE;
      const by = oy + b.y * TILE;
      if (!this.isInViewport(bx, by, TILE * (Math.max(rw, rh) + 1))) continue;
      if (rot !== 0) {
        g.save();
        g.translate(bx + rw * TILE / 2, by + rh * TILE / 2);
        g.rotate(rot * Math.PI / 2);
        g.drawImage(img, -def.w * TILE / 2, -def.h * TILE / 2);
        g.restore();
      } else {
        g.drawImage(img, bx, by);
      }
      if (!b.built) {
        const need = (def.cost.wood ?? 0);
        g.fillStyle = '#dfe6ee';
        g.font = '8px monospace';
        g.fillText(`${b.delivered}/${need}`, bx + 2, by + 8);
      }
      if (b.built && def.maxHp && b.hp < def.maxHp) {
        this.hpBar(bx, by - 3, b.hp / def.maxHp);
      }
      if (this.cam.selectedBuilding === b.id) this.outline(bx, by, rw * TILE, rh * TILE);
    }

    // Chimney smoke drifting up from working buildings
    for (const b of sim.buildings) {
      if (!b.built || !SMOKE_BUILDINGS.has(b.defId)) continue;
      const def = buildingDef(b.defId);
      const rot = b.rotation ?? 0;
      const rw = rot % 2 === 1 ? def.h : def.w;
      const bx = ox + b.x * TILE;
      const by = oy + b.y * TILE;
      if (!this.isInViewport(bx, by, TILE * 4)) continue;
      const cx = b.defId === 'hearth' ? bx + TILE / 2 - 1 : bx + rw * TILE - 7;
      for (let p = 0; p < 3; p++) {
        const t = ((this.frame + b.id * 41 + p * 40) % 120) / 120;
        const sx = Math.round(cx + Math.sin((t * 4 + p) * Math.PI) * 2);
        const sy = Math.round(by + 1 - t * 13);
        const size = 1 + Math.round(t * 2);
        g.fillStyle = `rgba(208,204,196,${0.42 * (1 - t)})`;
        g.fillRect(sx, sy, size, size);
      }
    }

    // Graves (over the burial-ground plot), then ground items, then the unburied
    for (const gr of sim.graves) {
      const px = ox + gr.x * TILE, py = oy + gr.y * TILE;
      if (!this.isInViewport(px, py)) continue;
      g.drawImage(this.sprites.grave, px, py);
    }
    for (const it of sim.items) {
      const px = ox + it.x * TILE, py = oy + it.y * TILE;
      if (!this.isInViewport(px, py)) continue;
      g.drawImage(this.sprites.items[it.kind], px, py);
    }
    for (const c of sim.corpses) {
      const px = ox + c.x * TILE, py = oy + c.y * TILE;
      if (!this.isInViewport(px, py)) continue;
      g.drawImage(this.sprites.corpse, px, py);
    }

    // Wildlife
    for (const a of sim.animals) {
      const px = ox + Math.round(a.pos.x * TILE);
      const py = oy + Math.round(a.pos.y * TILE);
      if (!this.isInViewport(px, py)) continue;
      const fr = Math.floor(this.frame / 14) % 2;
      g.drawImage(a.kind === 'wolf' ? this.sprites.wolf[fr] : this.sprites.deer[fr], px, py);
      const maxHp = a.kind === 'wolf' ? TUNING.wolfHealth : TUNING.deerHealth;
      if (a.health < maxHp) this.hpBar(px, py - 2, a.health / maxHp);
    }

    // Raiders
    for (const r of sim.raiders) {
      const px = ox + Math.round(r.pos.x * TILE);
      const py = oy + Math.round(r.pos.y * TILE) - 4;
      if (!this.isInViewport(px, py)) continue;
      const fr = Math.floor(this.frame / 10) % 2;
      g.drawImage(this.sprites.raider[fr], px, py);
      this.hpBar(px, py + 2, r.health / 70);
    }

    // Settlers with a 2-frame walk bob (spear carriers draw armed)
    for (const s of sim.settlers) {
      const px = ox + Math.round(s.pos.x * TILE);
      const py = oy + Math.round(s.pos.y * TILE) - 4;
      if (!this.isInViewport(px, py)) continue;
      const variant = s.id % this.sprites.settler.length;
      const fr = s.state === 'sleeping' ? 0 : Math.floor(this.frame / 12) % 2;
      g.drawImage((s.armed ? this.sprites.settlerArmed : this.sprites.settler)[variant][fr], px, py);
      if (s.state === 'sleeping') {
        g.fillStyle = '#cfd4e0';
        g.font = '8px monospace';
        g.fillText('z', px + 12, py + 2);
      }
      if (s.carrying) g.drawImage(this.sprites.items[s.carrying.kind], px - 2, py - 4);
      if (s.health < 100) this.hpBar(px, py + 2, s.health / 100);
      if (s.wound?.untreated || s.infection || s.sickUntil > sim.minute) {
        g.fillStyle = '#e04444';
        g.fillRect(px + 12, py + 2, 3, 1);
        g.fillRect(px + 13, py + 1, 1, 3); // tiny red cross
      }
      if (this.cam.selectedSettler === s.id) this.outline(px, py + 4, TILE, TILE - 2);
    }

    // Weather: precipitation streaks and storm gloom over the whole scene
    // (canvas dimensions divided by zoom since we're inside the scaled context)
    const wx = sim.weatherToday();
    if (wx.sky === 'overcast' || wx.sky === 'rain' || wx.sky === 'storm') {
      g.fillStyle = `rgba(40,48,60,${wx.sky === 'storm' ? 0.28 : wx.sky === 'rain' ? 0.18 : 0.1})`;
      g.fillRect(0, 0, vw, vh);
    }
    if (wx.sky === 'rain' || wx.sky === 'storm' || wx.sky === 'snow') {
      const snow = wx.sky === 'snow';
      g.fillStyle = snow ? 'rgba(235,240,250,0.7)' : 'rgba(170,200,230,0.45)';
      const n = wx.sky === 'storm' ? 260 : 140;
      for (let i = 0; i < n; i++) {
        const x = (i * 97 + this.frame * (snow ? 1 : 9)) % vw;
        const y = (i * 61 + this.frame * (snow ? 2 : 13)) % vh;
        if (snow) g.fillRect(x, y, 2, 2);
        else g.fillRect(x, y, 1, 6);
      }
    }

    // Night darkening over the play field only (backdrop handles its own light)
    const d = daylight(sim.hour);
    if (d < 0.45) {
      g.fillStyle = `rgba(10,12,30,${(0.45 - d) * 0.9})`;
      g.fillRect(0, 0, vw, vh);
    }

    // Warm light spills from windows and the hearth after dark
    if (d < 0.4) {
      const na = Math.min(1, (0.4 - d) * 3);
      g.save();
      g.globalCompositeOperation = 'lighter';
      for (const b of sim.buildings) {
        if (!b.built || !GLOW_BUILDINGS.has(b.defId)) continue;
        const def = buildingDef(b.defId);
        const rot = b.rotation ?? 0;
        const rw = rot % 2 === 1 ? def.h : def.w;
        const rh = rot % 2 === 1 ? def.w : def.h;
        const cx = ox + (b.x + rw / 2) * TILE;
        const cy = oy + (b.y + rh / 2) * TILE;
        if (cx < -48 || cy < -48 || cx > vw + 48 || cy > vh + 48) continue;
        const hearth = b.defId === 'hearth';
        const flick = hearth ? Math.sin(this.frame * 0.22 + b.id) * 2 : 0;
        const r = (hearth ? 26 : Math.max(rw, rh) * TILE * 0.85) + flick;
        const grad = g.createRadialGradient(cx, cy, 1, cx, cy, r);
        grad.addColorStop(0, `rgba(255,180,80,${(hearth ? 0.3 : 0.16) * na})`);
        grad.addColorStop(1, 'rgba(255,180,80,0)');
        g.fillStyle = grad;
        g.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
      g.restore();
    }

    // Fog of war: hard black over unexplored tiles
    g.fillStyle = '#000';
    for (let y = ty0; y < ty1; y++) {
      for (let x = tx0; x < tx1; x++) {
        if (sim.world.at(x, y).explored) continue;
        g.fillRect(ox + x * TILE, oy + y * TILE, TILE + 1, TILE + 1);
      }
    }
  }

  private hpBar(x: number, y: number, frac: number): void {
    const { g } = this;
    g.fillStyle = '#1a1410';
    g.fillRect(x + 2, y, 12, 2);
    g.fillStyle = frac > 0.5 ? '#7ac26a' : '#e04444';
    g.fillRect(x + 2, y, Math.max(1, Math.round(12 * frac)), 2);
  }

  private outline(x: number, y: number, w: number, h: number): void {
    this.g.strokeStyle = '#e8d27a';
    this.g.lineWidth = 1;
    this.g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }

  /** Expose the tile-at-pixel calc so main.ts can forward clicks correctly. */
  hitTest(px: number, py: number): { x: number; y: number } {
    return this.tileAt(px, py);
  }

  private drawPlacementGhost(): void {
    const { cam, g, sim } = this;
    const { ox, oy } = this.mapOrigin();
    if (cam.placing) {
      const rot = cam.placingRotation ?? 0;
      const def = buildingDef(cam.placing);
      const rw = rot % 2 === 1 ? def.h : def.w;
      const rh = rot % 2 === 1 ? def.w : def.h;
      const ok = sim.canPlace(cam.placing, cam.mouseTile.x, cam.mouseTile.y, rot);
      const bx = ox + cam.mouseTile.x * TILE;
      const by = oy + cam.mouseTile.y * TILE;
      g.globalAlpha = 0.8;
      if (rot !== 0) {
        g.save();
        g.translate(bx + rw * TILE / 2, by + rh * TILE / 2);
        g.rotate(rot * Math.PI / 2);
        g.drawImage(this.sprites.blueprints[cam.placing], -def.w * TILE / 2, -def.h * TILE / 2);
        g.restore();
      } else {
        g.drawImage(this.sprites.blueprints[cam.placing], bx, by);
      }
      g.globalAlpha = 1;
      g.strokeStyle = ok ? '#7ac26a' : '#c25b2e';
      g.strokeRect(bx + 0.5, by + 0.5, rw * TILE - 1, rh * TILE - 1);
      if (rot !== 0) {
        g.fillStyle = '#e8d27a';
        g.font = '8px monospace';
        g.fillText(`↻${rot * 90}°`, bx + 2, by + rh * TILE - 2);
      }
    } else if (cam.placingZone) {
      const isRoad = cam.placingZone === 'dirt' || cam.placingZone === 'plank' ||
                     cam.placingZone === 'gravel' || cam.placingZone === 'bridge';
      if (isRoad) {
        g.drawImage(this.sprites.roadPlans[cam.placingZone as any], ox + cam.mouseTile.x * TILE, oy + cam.mouseTile.y * TILE);
        g.strokeStyle = '#9cc4e4';
      } else {
        g.globalAlpha = 0.6;
        const zoneColors: Record<string, string> = { farm: '#7ac26a', stockpile: '#e8d27a', wall: '#c25b2e', gate: '#9c7544', trap: '#8b1a1a' };
        g.fillStyle = zoneColors[cam.placingZone] || '#999';
        g.fillRect(ox + cam.mouseTile.x * TILE, oy + cam.mouseTile.y * TILE, TILE, TILE);
        g.globalAlpha = 1;
        g.strokeStyle = '#9cc4e4';
      }
      g.strokeRect(ox + cam.mouseTile.x * TILE + 0.5, oy + cam.mouseTile.y * TILE + 0.5, TILE - 1, TILE - 1);
    } else if (cam.chopMode) {
      g.strokeStyle = '#c25b2e';
      g.strokeRect(ox + cam.mouseTile.x * TILE + 0.5, oy + cam.mouseTile.y * TILE + 0.5, TILE - 1, TILE - 1);
    } else if (cam.stampBlueprint) {
      const bp = BLUEPRINT_DEFS.find((b) => b.id === cam.stampBlueprint);
      if (bp) {
        const bx = ox + (cam.mouseTile.x - Math.floor(bp.w / 2)) * TILE;
        const by = oy + (cam.mouseTile.y - Math.floor(bp.h / 2)) * TILE;
        const roomCol = ROOM_TYPE_COLORS[ROOM_TYPE_ID.get(bp.roomType) ?? 0] || 'rgba(200,190,160,0.38)';
        for (const [wx0, wy0, wx1, wy1] of bp.wallRects)
          for (let wy = wy0; wy <= wy1; wy++)
            for (let wx = wx0; wx <= wx1; wx++) {
              g.fillStyle = 'rgba(48,38,26,0.55)';
              g.fillRect(bx + wx * TILE, by + wy * TILE, TILE, TILE);
            }
        const [fx0, fy0, fx1, fy1] = bp.floorRect;
        for (let fy = fy0; fy <= fy1; fy++)
          for (let fx = fx0; fx <= fx1; fx++) {
            g.fillStyle = roomCol;
            g.fillRect(bx + fx * TILE, by + fy * TILE, TILE, TILE);
          }
        g.strokeStyle = '#e8d27a';
        g.lineWidth = 1;
        g.strokeRect(bx + 0.5, by + 0.5, bp.w * TILE - 1, bp.h * TILE - 1);
      }
    } else if (cam.roomPaintMode) {
      const mpx = ox + cam.mouseTile.x * TILE;
      const mpy = oy + cam.mouseTile.y * TILE;
      if (cam.roomPaintMode === 'wall') {
        g.fillStyle = 'rgba(48,38,26,0.6)';
        g.fillRect(mpx, mpy, TILE, TILE);
      } else if (cam.roomPaintMode === 'floor') {
        g.fillStyle = 'rgba(210,195,160,0.55)';
        g.fillRect(mpx, mpy, TILE, TILE);
      } else if (cam.roomPaintMode === 'room') {
        const col = ROOM_TYPE_COLORS[cam.roomTypeId] || 'rgba(200,200,200,0.45)';
        g.fillStyle = col;
        g.fillRect(mpx, mpy, TILE, TILE);
      } else if (cam.roomPaintMode === 'station' && cam.stationTypeId) {
        const def = STATION_DEF_BY_NUM[cam.stationTypeId];
        if (def) {
          g.fillStyle = 'rgba(28,20,12,0.52)';
          g.fillRect(mpx, mpy, def.w * TILE, def.h * TILE);
          g.strokeStyle = '#e8d27a';
          g.lineWidth = 1;
          g.strokeRect(mpx + 0.5, mpy + 0.5, def.w * TILE - 1, def.h * TILE - 1);
        }
      } else if (cam.roomPaintMode === 'erase') {
        g.strokeStyle = '#c25b2e';
        g.lineWidth = 2;
        g.strokeRect(mpx + 0.5, mpy + 0.5, TILE - 1, TILE - 1);
        g.beginPath();
        g.moveTo(mpx + 4, mpy + 4);
        g.lineTo(mpx + TILE - 4, mpy + TILE - 4);
        g.moveTo(mpx + TILE - 4, mpy + 4);
        g.lineTo(mpx + 4, mpy + TILE - 4);
        g.stroke();
        g.lineWidth = 1;
      }
      if (cam.roomPaintMode !== 'station' && cam.roomPaintMode !== 'erase') {
        g.strokeStyle = '#9cc4e4';
        g.lineWidth = 1;
        g.strokeRect(mpx + 0.5, mpy + 0.5, TILE - 1, TILE - 1);
      }
    }
  }
}

/**
 * Draw the 64×64 region map into `ctx` at size W×H — used for the
 * bottom-right minimap (Civ 6 style). Same colour palette as RegionView.
 */
export function drawMinimap(
  ctx: CanvasRenderingContext2D,
  regionMap: RegionMap,
  site: TownSite,
  W: number,
  H: number,
): void {
  const N = 64;
  const cw = W / N;
  const ch = H / N;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const c = regionMap.at(x, y);
      let col: string;
      switch (c.biome) {
        case 'sea': col = '#243d52'; break;
        case 'lake': col = '#2e4a5c'; break;
        case 'river': col = '#36586e'; break;
        case 'marsh': col = '#39503e'; break;
        case 'plains': col = '#46563a'; break;
        case 'forest': col = '#33502c'; break;
        case 'hills': col = '#5a5742'; break;
        case 'mountains': col = c.elevation > 0.85 ? '#9a978f' : '#6a6358'; break;
        default: col = '#333'; break;
      }
      ctx.fillStyle = col;
      ctx.fillRect(Math.floor(x * cw), Math.floor(y * ch), Math.ceil(cw), Math.ceil(ch));
    }
  }
  // Town marker
  const tx = (site.cellX / N) * W;
  const ty = (site.cellY / N) * H;
  ctx.fillStyle = '#e8d27a';
  ctx.fillRect(Math.round(tx) - 2, Math.round(ty) - 2, 5, 5);
  // Border
  ctx.strokeStyle = '#6e4a2f';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, W - 2, H - 2);
}
