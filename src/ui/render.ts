/**
 * Renderer: lush layered parallax background behind a crisp 8-bit foreground
 * (GDD §3.1). Background = sky by time-of-day, stars, sun/moon, three
 * mountain/forest bands, haze. Foreground = the tile map and sprites.
 */
import type { Simulation } from '../sim/sim';
import { MAP_W, MAP_H } from '../sim/world';
import { buildingDef, BUILDING_DEFS } from '../sim/defs';
import { buildSprites, TILE } from './sprites';
import type { SpriteSet } from './sprites';

export interface Camera {
  x: number; // pixels
  y: number;
  placing: string | null; // building def id when in placement mode
  chopMode: boolean;
  mouseTile: { x: number; y: number };
  selectedSettler: number | null;
  selectedBuilding: number | null;
}

const SKY_DAY = [104, 144, 170];
const SKY_DUSK = [168, 110, 86];
const SKY_NIGHT = [18, 22, 38];

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
    this.drawMap();
    this.drawPlacementGhost();
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

  tileAt(px: number, py: number): { x: number; y: number } {
    const { ox, oy } = this.mapOrigin();
    return { x: Math.floor((px - ox) / TILE), y: Math.floor((py - oy) / TILE) };
  }

  private drawMap(): void {
    const { g, sim, sprites } = this;
    const { ox, oy } = this.mapOrigin();
    const anim = Math.floor(this.frame / 30) % 2;

    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const t = sim.world.at(x, y);
        const px = ox + x * TILE;
        const py = oy + y * TILE;
        if (px < -TILE || py < -TILE || px > this.canvas.width || py > this.canvas.height) continue;
        let img: HTMLCanvasElement;
        switch (t.kind) {
          case 'grass': img = sprites.grass[(x * 31 + y * 17) % 2]; break;
          case 'tree': img = t.marked ? sprites.treeMarked : sprites.tree; break;
          case 'water': img = sprites.water[anim]; break;
          case 'rock': img = sprites.rock; break;
          case 'soil':
            img = t.growth >= 100 ? sprites.soilRipe : t.growth > 40 ? sprites.soilGrown : t.sown ? sprites.soilSown : sprites.soil;
            break;
        }
        g.drawImage(img, px, py);
      }
    }

    // Buildings (built solid, blueprints ghosted)
    for (const b of sim.buildings) {
      const def = buildingDef(b.defId);
      if (def.provides === 'farm') continue; // farms render as soil tiles
      const img = b.built ? this.sprites.buildings[b.defId] : this.sprites.blueprints[b.defId];
      g.drawImage(img, ox + b.x * TILE, oy + b.y * TILE);
      if (!b.built) {
        const need = (def.cost.wood ?? 0);
        g.fillStyle = '#dfe6ee';
        g.font = '8px monospace';
        g.fillText(`${b.delivered}/${need}`, ox + b.x * TILE + 2, oy + b.y * TILE + 8);
      }
      if (this.cam.selectedBuilding === b.id) this.outline(ox + b.x * TILE, oy + b.y * TILE, def.w * TILE, def.h * TILE);
    }

    // Ground items
    for (const it of sim.items) {
      g.drawImage(this.sprites.items[it.kind], ox + it.x * TILE, oy + it.y * TILE);
    }

    // Settlers with a 2-frame walk bob
    for (const s of sim.settlers) {
      const variant = s.id % this.sprites.settler.length;
      const fr = s.state === 'sleeping' ? 0 : Math.floor(this.frame / 12) % 2;
      const px = ox + Math.round(s.pos.x * TILE);
      const py = oy + Math.round(s.pos.y * TILE) - 4;
      g.drawImage(this.sprites.settler[variant][fr], px, py);
      if (s.state === 'sleeping') {
        g.fillStyle = '#cfd4e0';
        g.font = '8px monospace';
        g.fillText('z', px + 12, py + 2);
      }
      if (s.carrying) g.drawImage(this.sprites.items[s.carrying.kind], px - 2, py - 4);
      if (this.cam.selectedSettler === s.id) this.outline(px, py + 4, TILE, TILE - 2);
    }

    // Night darkening over the play field only (backdrop handles its own light)
    const d = daylight(sim.hour);
    if (d < 0.45) {
      g.fillStyle = `rgba(10,12,30,${(0.45 - d) * 0.9})`;
      g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  private outline(x: number, y: number, w: number, h: number): void {
    this.g.strokeStyle = '#e8d27a';
    this.g.lineWidth = 1;
    this.g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }

  private drawPlacementGhost(): void {
    const { cam, g, sim } = this;
    const { ox, oy } = this.mapOrigin();
    if (cam.placing) {
      const ok = sim.canPlace(cam.placing, cam.mouseTile.x, cam.mouseTile.y);
      g.globalAlpha = 0.8;
      g.drawImage(this.sprites.blueprints[cam.placing], ox + cam.mouseTile.x * TILE, oy + cam.mouseTile.y * TILE);
      g.globalAlpha = 1;
      const def = buildingDef(cam.placing);
      g.strokeStyle = ok ? '#7ac26a' : '#c25b2e';
      g.strokeRect(ox + cam.mouseTile.x * TILE + 0.5, oy + cam.mouseTile.y * TILE + 0.5, def.w * TILE - 1, def.h * TILE - 1);
    } else if (cam.chopMode) {
      g.strokeStyle = '#c25b2e';
      g.strokeRect(ox + cam.mouseTile.x * TILE + 0.5, oy + cam.mouseTile.y * TILE + 0.5, TILE - 1, TILE - 1);
    }
  }
}
