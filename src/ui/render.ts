/**
 * Renderer: lush layered parallax background behind a crisp 8-bit foreground
 * (GDD §3.1). Background = sky by time-of-day, stars, sun/moon, three
 * mountain/forest bands, haze. Foreground = the tile map and sprites.
 */
import type { Simulation } from '../sim/sim';
import { MAP_W, MAP_H } from '../sim/world';
import { buildingDef, BUILDING_DEFS, TUNING } from '../sim/defs';
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

    // Pass 1: ground (grass clusters via coarse hash so tones form patches),
    // water, soil, roads. Trees draw in pass 2 so canopies overlap properly.
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const t = sim.world.at(x, y);
        const px = ox + x * TILE;
        const py = oy + y * TILE;
        if (px < -TILE * 2 || py < -TILE * 2 || px > this.canvas.width || py > this.canvas.height) continue;
        if (t.kind === 'water') {
          g.drawImage(sprites.water[anim], px, py);
        } else if (t.kind === 'soil') {
          const img = t.growth >= 100 ? sprites.soilRipe : t.growth > 40 ? sprites.soilGrown : t.sown ? sprites.soilSown : sprites.soil;
          g.drawImage(img, px, py);
        } else {
          // patchy grass: coarse 3×3 cluster hash picks the variant; rare worn dirt
          const cl = (Math.floor(x / 3) * 73 + Math.floor(y / 3) * 31) % 5;
          const worn = (x * 53 + y * 97) % 89 === 0;
          g.drawImage(worn ? sprites.dirtPatch : sprites.grass[cl % 4], px, py);
        }
        if (t.road) g.drawImage(sprites.roads[t.road], px, py);
        else if (t.roadPlan) g.drawImage(sprites.roadPlans[t.roadPlan], px, py);
        if (t.stockpileZone && !t.road) g.drawImage(sprites.stockpileZone, px, py);
        if (t.trapZone) g.drawImage(sprites.trapZone, px, py);
        if (t.wallPlan) g.drawImage(sprites.wallPlan, px, py);
        if (t.gatePlan) g.drawImage(sprites.gatePlan, px, py);
      }
    }
    // Pass 2: standing terrain (rocks, palisades, then trees with overhanging canopies)
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const t = sim.world.at(x, y);
        const px = ox + x * TILE;
        const py = oy + y * TILE;
        if (px < -TILE * 2 || py < -TILE * 2 || px > this.canvas.width || py > this.canvas.height) continue;
        if (t.kind === 'rock') g.drawImage(t.marked ? sprites.rockMarked : sprites.rock, px, py);
        else if (t.wall) {
          const mask =
            (sim.world.inBounds(x, y - 1) && (sim.world.at(x, y - 1).wall || sim.world.at(x, y - 1).gate) ? 1 : 0) |
            (sim.world.inBounds(x + 1, y) && (sim.world.at(x + 1, y).wall || sim.world.at(x + 1, y).gate) ? 2 : 0) |
            (sim.world.inBounds(x, y + 1) && (sim.world.at(x, y + 1).wall || sim.world.at(x, y + 1).gate) ? 4 : 0) |
            (sim.world.inBounds(x - 1, y) && (sim.world.at(x - 1, y).wall || sim.world.at(x - 1, y).gate) ? 8 : 0);
          g.drawImage(sprites.palisadeVariants[mask], px, py);
        } else if (t.gate) g.drawImage(sprites.gate, px, py);
        else if (t.kind === 'tree') g.drawImage(t.marked ? sprites.treeMarked : sprites.tree, px - 2, py - 6);
        else if (t.sapling) g.drawImage(sprites.sapling, px, py);
      }
    }
    // Wall & gate HP bars
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const t = sim.world.at(x, y);
        const maxHp = t.wall ? TUNING.wallMaxHp : t.gate ? TUNING.gateMaxHp : 0;
        if (maxHp && t.wallHp < maxHp) {
          const px = ox + x * TILE;
          const py = oy + y * TILE;
          if (px >= -TILE && py >= -TILE && px < this.canvas.width && py < this.canvas.height) {
            this.hpBar(px, py - 3, t.wallHp / maxHp);
          }
        }
      }
    }

    // Traffic overlay: warm heatmap of recent transits
    if (this.cam.overlay === 'traffic') {
      for (let y = 0; y < MAP_H; y++) {
        for (let x = 0; x < MAP_W; x++) {
          const v = sim.traffic[y * MAP_W + x];
          if (v < 0.5) continue;
          g.fillStyle = `rgba(232,150,60,${Math.min(0.65, v / 40)})`;
          g.fillRect(ox + x * TILE, oy + y * TILE, TILE, TILE);
        }
      }
    }

    // Buildings (built solid, blueprints ghosted)
    for (const b of sim.buildings) {
      const def = buildingDef(b.defId);
      const img = b.built ? this.sprites.buildings[b.defId] : this.sprites.blueprints[b.defId];
      const rot = b.rotation ?? 0;
      const rw = rot % 2 === 1 ? def.h : def.w;
      const rh = rot % 2 === 1 ? def.w : def.h;
      const bx = ox + b.x * TILE;
      const by = oy + b.y * TILE;
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

    // Graves (over the burial-ground plot), then ground items, then the unburied
    for (const gr of sim.graves) {
      g.drawImage(this.sprites.grave, ox + gr.x * TILE, oy + gr.y * TILE);
    }
    for (const it of sim.items) {
      g.drawImage(this.sprites.items[it.kind], ox + it.x * TILE, oy + it.y * TILE);
    }
    for (const c of sim.corpses) {
      g.drawImage(this.sprites.corpse, ox + c.x * TILE, oy + c.y * TILE);
    }

    // Wildlife
    for (const a of sim.animals) {
      const fr = Math.floor(this.frame / 14) % 2;
      const px = ox + Math.round(a.pos.x * TILE);
      const py = oy + Math.round(a.pos.y * TILE);
      g.drawImage(a.kind === 'wolf' ? this.sprites.wolf[fr] : this.sprites.deer[fr], px, py);
      const maxHp = a.kind === 'wolf' ? TUNING.wolfHealth : TUNING.deerHealth;
      if (a.health < maxHp) this.hpBar(px, py - 2, a.health / maxHp);
    }

    // Raiders
    for (const r of sim.raiders) {
      const fr = Math.floor(this.frame / 10) % 2;
      const px = ox + Math.round(r.pos.x * TILE);
      const py = oy + Math.round(r.pos.y * TILE) - 4;
      g.drawImage(this.sprites.raider[fr], px, py);
      this.hpBar(px, py + 2, r.health / 70);
    }

    // Settlers with a 2-frame walk bob (spear carriers draw armed)
    for (const s of sim.settlers) {
      const variant = s.id % this.sprites.settler.length;
      const fr = s.state === 'sleeping' ? 0 : Math.floor(this.frame / 12) % 2;
      const px = ox + Math.round(s.pos.x * TILE);
      const py = oy + Math.round(s.pos.y * TILE) - 4;
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
    const zoom = this.cam.zoom;
    const vw = this.canvas.width / zoom;
    const vh = this.canvas.height / zoom;
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

    // Fog of war: hard black over unexplored tiles
    g.fillStyle = '#000';
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        if (sim.world.at(x, y).explored) continue;
        const px = ox + x * TILE;
        const py = oy + y * TILE;
        if (px < -TILE || py < -TILE || px > vw || py > vh) continue;
        g.fillRect(px, py, TILE, TILE);
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
