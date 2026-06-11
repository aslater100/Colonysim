import './style.css';
import { Simulation } from './sim/sim';
import { RegionSim } from './sim/region';
import { TICKS_PER_SECOND } from './sim/defs';
import { MAP_W, MAP_H } from './sim/world';
import { Renderer, drawMinimap } from './ui/render';
import type { Camera } from './ui/render';
import { Hud } from './ui/hud';
import { RegionView } from './ui/regionview';
import { TILE } from './ui/sprites';
import { Sfx } from './ui/audio';
import { Music } from './ui/music';
import { Soundscape } from './ui/soundscape';

const root = document.getElementById('app')!;
const canvas = document.createElement('canvas');
canvas.id = 'game';
root.appendChild(canvas);

// Minimap: a small region-map preview in the bottom-right corner (Civ 6 style).
const MINIMAP_W = 160;
const MINIMAP_H = 120;
const minimapCanvas = document.createElement('canvas');
minimapCanvas.id = 'minimap';
minimapCanvas.width = MINIMAP_W;
minimapCanvas.height = MINIMAP_H;
root.appendChild(minimapCanvas);
const minimapCtx = minimapCanvas.getContext('2d')!;
minimapCtx.imageSmoothingEnabled = false;

const SAVE_KEY = 'centuria-save';

// Booting after "Load Game": the menu sets a one-shot flag and reloads, and
// we resume from the snapshot instead of seeding a fresh colony. Saves are
// either a bare town snapshot (v1) or a combined town+region one (v2).
function bootSim(): { sim: Simulation; region: RegionSim | null } {
  try {
    const pending = sessionStorage.getItem('centuria-load-on-boot');
    if (pending) {
      sessionStorage.removeItem('centuria-load-on-boot');
      const data = localStorage.getItem(SAVE_KEY);
      if (data) {
        const d = JSON.parse(data);
        if (d.v === 2 && d.mode === 'region') {
          const town = Simulation.deserialize(d.town);
          return { sim: town, region: RegionSim.deserialize(d.region, town) };
        }
        return { sim: Simulation.deserialize(data), region: null };
      }
    }
  } catch (err) {
    console.error('load failed, starting fresh:', err);
  }
  return { sim: new Simulation(Date.now() % 100000), region: null };
}

const boot = bootSim();
const sim = boot.sim;
// Debug/automation hook (used by headless smoke tests; harmless in play)
(window as unknown as { sim: Simulation }).sim = sim;
const cam: Camera = {
  x: (MAP_W * TILE) / 2 - window.innerWidth / 2,
  y: (MAP_H * TILE) / 2 - window.innerHeight / 2,
  zoom: 1,
  placing: null,
  placingRotation: 0,
  placingZone: null,
  chopMode: false,
  overlay: 'none',
  mouseTile: { x: 0, y: 0 },
  selectedSettler: null,
  selectedBuilding: null,
  selectedStockpile: null,
};

function resize(): void {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const g = canvas.getContext('2d')!;
  g.imageSmoothingEnabled = false;
}
resize();
window.addEventListener('resize', resize);

const sfx = new Sfx();
const music = new Music();
const soundscape = new Soundscape();
// Browsers gate audio behind a user gesture; the first input unlocks it.
window.addEventListener('mousedown', () => { sfx.unlock(); music.unlock(); soundscape.unlock(); }, { once: true });
window.addEventListener('keydown', () => { sfx.unlock(); music.unlock(); soundscape.unlock(); }, { once: true });

const renderer = new Renderer(canvas, sim, cam);
const hud = new Hud(root, sim, cam, sfx, music, soundscape);

hud.onSave = () => {
  try {
    localStorage.setItem(SAVE_KEY, sim.serialize());
    return true;
  } catch (err) {
    console.error('save failed:', err);
    return false;
  }
};
hud.onLoad = () => {
  sessionStorage.setItem('centuria-load-on-boot', '1');
  location.reload();
};
hud.hasSave = () => {
  try {
    return localStorage.getItem(SAVE_KEY) !== null;
  } catch {
    return false;
  }
};

// The soundtrack's tension scalar: bumped by alarming log lines, decaying each
// frame, so the music swells into a crisis and settles once it passes.
let tension = 0;

// Event sounds: watch the colony log and voice the moments that matter.
let sfxLogLen = sim.log.length;
function playLogSounds(): void {
  if (sim.log.length === sfxLogLen) return;
  const fresh = sim.log.slice(sfxLogLen);
  sfxLogLen = sim.log.length;
  const danger = fresh.some((l) => l.text.startsWith('RAID!') || l.text.startsWith('Wolves'));
  if (danger) tension = 1;
  else if (fresh.some((l) => l.kind === 'bad')) tension = Math.max(tension, 0.5);
  if (danger) return sfx.horn();
  if (fresh.some((l) => l.text.includes('has died'))) return sfx.knell();
  if (fresh.some((l) => l.kind === 'bad')) return sfx.thud();
  if (fresh.some((l) => l.kind === 'good')) return sfx.chime();
}

// ---- the flip: town → region (GDD §2.4) ----
let mode: 'town' | 'region' = 'town';
let dioramaOpen = false;
let region: RegionSim | null = null;
let regionView: RegionView | null = null;

// A lost colony offers a clean slate: reload re-seeds from the clock.
hud.onRestart = () => location.reload();

/** Shared by the flip and the load path: hand the screen to the region. */
function enterRegionMode(r: RegionSim): void {
  region = r;
  (window as unknown as { region: RegionSim }).region = r;
  regionView = new RegionView(canvas, r, root);
  mode = 'region';
  dioramaOpen = false;
  hud.closeMenu();
  // Region saves bundle the town snapshot too — the diorama keeps it alive.
  hud.onSave = () => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        v: 2, mode: 'region', town: sim.serialize(), region: r.serialize(),
      }));
      return true;
    } catch (err) {
      console.error('save failed:', err);
      return false;
    }
  };
  hud.setRegionMode(true);
}

hud.onFoundTown = () => enterRegionMode(RegionSim.fromTown(sim, 8, 80, 80));
if (boot.region) enterRegionMode(boot.region);

// ---- input ----
const keys = new Set<string>();
window.addEventListener('keydown', (e) => {
  keys.add(e.key);
  if (e.key === ' ') {
    if (!hud.menuOpen) hud.paused = !hud.paused;
    e.preventDefault();
    return;
  }
  if (e.key === '1') hud.speed = 1;
  if (e.key === '2') hud.speed = 3;
  if (e.key === '3') hud.speed = 8;
  if (e.key === 'Escape') {
    if (hud.menuOpen) {
      hud.closeMenu();
      return;
    }
    if (mode === 'region') {
      if (!regionView?.ceremonyOpen) hud.openMenu();
      return;
    }
    // First escape clears whatever tool/selection is live; a bare escape
    // with nothing active opens the menu.
    const anythingActive = cam.placing !== null || cam.placingZone !== null || cam.chopMode ||
      cam.selectedSettler !== null || cam.selectedBuilding !== null || cam.selectedStockpile !== null;
    cam.placing = null;
    cam.placingRotation = 0;
    cam.placingZone = null;
    cam.chopMode = false;
    cam.selectedSettler = null;
    cam.selectedBuilding = null;
    cam.selectedStockpile = null;
    hud.refreshBuildBarState();
    if (!anythingActive && mode === 'town') hud.openMenu();
    return;
  }
  // R rotates placement ghost
  if (mode === 'town' && (e.key === 'r' || e.key === 'R') && cam.placing) {
    cam.placingRotation = ((cam.placingRotation ?? 0) + 1) % 4;
    e.preventDefault();
    return;
  }
  // Palette hotkeys (the bracketed letters on the buttons)
  if (mode === 'town' && hud.handleKey(e.key)) {
    e.preventDefault();
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.key));

canvas.addEventListener('mousemove', (e) => {
  cam.mouseTile = renderer.tileAt(e.clientX, e.clientY);
  // drag-paint zones/roads and chop/quarry marks
  if (e.buttons === 1 && mode === 'town') {
    const t = cam.mouseTile;
    const prev = prevDragTile ?? t;
    // Bresenham fill: paint every tile along the line from prev to current so
    // fast mouse sweeps don't leave gaps in roads or zone designations.
    const line = bresenhamLine(prev.x, prev.y, t.x, t.y);
    prevDragTile = t;
    for (const pt of line) {
      const key = `${pt.x},${pt.y}`;
      if (cam.placingZone && !paintedTiles.has(key)) {
        paintedTiles.add(key);
        const kind = cam.placingZone;
        if (kind === 'dirt' || kind === 'plank' || kind === 'gravel' || kind === 'bridge') {
          sim.planRoad(kind, pt.x, pt.y);
        } else {
          sim.planZone(kind, pt.x, pt.y);
        }
      } else if (cam.chopMode && !paintedTiles.has(key)) {
        paintedTiles.add(key);
        sim.markTree(pt.x, pt.y);
      }
    }
  } else {
    prevDragTile = null;
  }
});

/** Bresenham line: all tiles from (x0,y0) to (x1,y1) inclusive. */
function bresenhamLine(x0: number, y0: number, x1: number, y1: number): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  while (true) {
    pts.push({ x: x0, y: y0 });
    if (x0 === x1 && y0 === y1) break;
    const e2 = err * 2;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
  return pts;
}

const paintedTiles = new Set<string>();
let prevDragTile: { x: number; y: number } | null = null;

canvas.addEventListener('mousedown', () => {
  paintedTiles.clear();
  prevDragTile = null;
});

canvas.addEventListener('click', (e) => {
  if (mode === 'region' && !dioramaOpen) {
    regionView?.click(e.clientX, e.clientY);
    return;
  }
  if (mode === 'region') return; // diorama is look-only
  const t = renderer.tileAt(e.clientX, e.clientY);
  if (cam.placing) {
    if (sim.placeBuilding(cam.placing, t.x, t.y, cam.placingRotation ?? 0)) {
      if (!e.shiftKey) {
        cam.placing = null;
        cam.placingRotation = 0;
        hud.refreshBuildBarState();
      }
    }
    return;
  }
  if (cam.placingZone) {
    const kind = cam.placingZone;
    if (kind === 'dirt' || kind === 'plank' || kind === 'gravel' || kind === 'bridge') {
      if (!paintedTiles.has(`${t.x},${t.y}`)) sim.planRoad(kind, t.x, t.y);
    } else {
      if (!paintedTiles.has(`${t.x},${t.y}`)) sim.planZone(kind, t.x, t.y);
    }
    return;
  }
  if (cam.chopMode) {
    if (!paintedTiles.has(`${t.x},${t.y}`)) sim.markTree(t.x, t.y);
    return;
  }
  // Selection: settler first (within half a tile), then building, then stockpile zone
  cam.selectedSettler = null;
  cam.selectedBuilding = null;
  cam.selectedStockpile = null;
  let best = 0.8;
  for (const s of sim.settlers) {
    const d = Math.hypot(s.pos.x - t.x, s.pos.y - t.y);
    if (d < best) {
      best = d;
      cam.selectedSettler = s.id;
    }
  }
  if (cam.selectedSettler === null && sim.world.inBounds(t.x, t.y)) {
    const tile = sim.world.at(t.x, t.y);
    if (tile.buildingId !== null) {
      cam.selectedBuilding = tile.buildingId;
    } else if (tile.stockpileZone) {
      cam.selectedStockpile = { x: t.x, y: t.y };
    }
  }
});

// Minimap click: switch to region view (or back to town if already in region)
minimapCanvas.addEventListener('click', () => {
  if (mode === 'town' && region) {
    // Flip has happened: switch to region
    dioramaOpen = false;
    mode = 'region';
    hud.setRegionMode(true);
  } else if (mode === 'region' && dioramaOpen) {
    dioramaOpen = false;
  }
});

// Scroll wheel: zoom in/out around mouse cursor
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  const newZoom = Math.max(0.4, Math.min(4.0, cam.zoom * factor));
  // Zoom toward/away from mouse position
  cam.x = e.clientX / cam.zoom + cam.x - e.clientX / newZoom;
  cam.y = e.clientY / cam.zoom + cam.y - e.clientY / newZoom;
  cam.zoom = newZoom;
}, { passive: false });

// Right-click to bulldoze/cancel zones
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (mode !== 'town') return;
  const t = renderer.tileAt(e.clientX, e.clientY);
  sim.bulldozeTile(t.x, t.y);
});

// ---- main loop: fixed-timestep sim, rAF render ----
let acc = 0;
let last = performance.now();
function loop(now: number): void {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  const panSpeed = 420 * dt;
  if (keys.has('ArrowLeft') || keys.has('a')) cam.x -= panSpeed;
  if (keys.has('ArrowRight') || keys.has('d')) cam.x += panSpeed;
  if (keys.has('ArrowUp') || keys.has('w')) cam.y -= panSpeed;
  if (keys.has('ArrowDown') || keys.has('s')) cam.y += panSpeed;
  cam.x = Math.max(-200, Math.min(MAP_W * TILE - canvas.width / cam.zoom + 200, cam.x));
  cam.y = Math.max(-200, Math.min(MAP_H * TILE - canvas.height / cam.zoom + 200, cam.y));

  if (!hud.paused) {
    acc += dt * TICKS_PER_SECOND * hud.speed;
    let guard = 0;
    while (acc >= 1 && guard++ < 64) {
      if (mode === 'town') sim.tick();
      else if (!regionView?.ceremonyOpen) region?.tick(); // history pauses for the ceremony
      acc -= 1;
    }
  }
  if (mode === 'town') {
    renderer.draw();
    hud.update();
    playLogSounds();
    // Minimap: always draw region preview during town play
    minimapCanvas.classList.remove('hidden');
    drawMinimap(minimapCtx, sim.regionMap, sim.site, MINIMAP_W, MINIMAP_H);
  } else if (region) {
    if (dioramaOpen) {
      sim.tickDiorama(region.minute);
      renderer.draw();
      minimapCanvas.classList.remove('hidden');
      drawMinimap(minimapCtx, sim.regionMap, sim.site, MINIMAP_W, MINIMAP_H);
    } else {
      regionView?.draw();
      minimapCanvas.classList.add('hidden');
    }
    hud.drawRegionTopBar(region, dioramaOpen);
    hud.regionLog(region);
    const btn = document.getElementById('tb-diorama');
    if (btn) (btn as HTMLButtonElement).onclick = () => {
      dioramaOpen = !dioramaOpen;
    };
  }

  // Soundtrack: era by year, ambient-only when paused, swelling with tension.
  if (mode === 'town' && sim.raidActive) tension = 1;
  else tension = Math.max(0, tension - dt * 0.12); // ~8s to settle from a peak
  const year = mode === 'region' && region ? region.year : sim.year;
  music.update({ year, paused: hud.paused, tension });

  // Diegetic soundscape: ambient layers driven by live game signals (GDD §3.3).
  soundscape.update({
    mode,
    paused: hud.paused,
    year,
    activeBuildWorkers: mode === 'town'
      ? sim.settlers.filter((s) => s.task?.kind === 'build').length
      : 0,
    activeRailRoutes: mode === 'region' && region
      ? region.routes.filter((r) => r.kind === 'rail' && r.condition > 50).length
      : 0,
    maxGrievance: mode === 'region' && region
      ? Math.max(0, ...region.settlements.map((s) => s.grievance))
      : 0,
    tension,
  });

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
