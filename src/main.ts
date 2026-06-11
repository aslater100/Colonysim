import './style.css';
import { Simulation } from './sim/sim';
import { RegionSim } from './sim/region';
import { TICKS_PER_SECOND } from './sim/defs';
import { MAP_W, MAP_H } from './sim/world';
import { Renderer } from './ui/render';
import type { Camera } from './ui/render';
import { Hud } from './ui/hud';
import { RegionView } from './ui/regionview';
import { TILE } from './ui/sprites';
import { Sfx } from './ui/audio';

const root = document.getElementById('app')!;
const canvas = document.createElement('canvas');
canvas.id = 'game';
root.appendChild(canvas);

const SAVE_KEY = 'centuria-save';

// Booting after "Load Game": the menu sets a one-shot flag and reloads, and
// we resume from the snapshot instead of seeding a fresh colony.
function bootSim(): Simulation {
  try {
    const pending = sessionStorage.getItem('centuria-load-on-boot');
    if (pending) {
      sessionStorage.removeItem('centuria-load-on-boot');
      const data = localStorage.getItem(SAVE_KEY);
      if (data) return Simulation.deserialize(data);
    }
  } catch (err) {
    console.error('load failed, starting fresh:', err);
  }
  return new Simulation(Date.now() % 100000);
}

const sim = bootSim();
// Debug/automation hook (used by headless smoke tests; harmless in play)
(window as unknown as { sim: Simulation }).sim = sim;
const cam: Camera = {
  x: (MAP_W * TILE) / 2 - window.innerWidth / 2,
  y: (MAP_H * TILE) / 2 - window.innerHeight / 2,
  placing: null,
  placingZone: null,
  chopMode: false,
  overlay: 'none',
  mouseTile: { x: 0, y: 0 },
  selectedSettler: null,
  selectedBuilding: null,
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
// Browsers gate audio behind a user gesture; the first input unlocks it.
window.addEventListener('mousedown', () => sfx.unlock(), { once: true });
window.addEventListener('keydown', () => sfx.unlock(), { once: true });

const renderer = new Renderer(canvas, sim, cam);
const hud = new Hud(root, sim, cam, sfx);

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

// Event sounds: watch the colony log and voice the moments that matter.
let sfxLogLen = sim.log.length;
function playLogSounds(): void {
  if (sim.log.length === sfxLogLen) return;
  const fresh = sim.log.slice(sfxLogLen);
  sfxLogLen = sim.log.length;
  if (fresh.some((l) => l.text.startsWith('RAID!') || l.text.startsWith('Wolves'))) return sfx.horn();
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

hud.onFoundTown = () => {
  region = RegionSim.fromTown(sim, 8, 80, 80);
  (window as unknown as { region: RegionSim }).region = region;
  regionView = new RegionView(canvas, region, root);
  mode = 'region';
  dioramaOpen = false;
  hud.closeMenu();
  hud.onSave = null; // the region sim has no snapshots yet — town-tier only
  hud.setRegionMode(true);
};

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
    // First escape clears whatever tool/selection is live; a bare escape
    // with nothing active opens the menu.
    const anythingActive = cam.placing !== null || cam.placingZone !== null || cam.chopMode ||
      cam.selectedSettler !== null || cam.selectedBuilding !== null;
    cam.placing = null;
    cam.placingZone = null;
    cam.chopMode = false;
    cam.selectedSettler = null;
    cam.selectedBuilding = null;
    hud.refreshPaletteState();
    if (!anythingActive && mode === 'town') hud.openMenu();
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
    if (cam.placingZone && !paintedTiles.has(`${t.x},${t.y}`)) {
      paintedTiles.add(`${t.x},${t.y}`);
      const kind = cam.placingZone;
      if (kind === 'dirt' || kind === 'plank' || kind === 'gravel' || kind === 'bridge') {
        sim.planRoad(kind, t.x, t.y);
      } else {
        sim.planZone(kind, t.x, t.y);
      }
    } else if (cam.chopMode && !paintedTiles.has(`${t.x},${t.y}`)) {
      paintedTiles.add(`${t.x},${t.y}`);
      sim.markTree(t.x, t.y);
    }
  }
});

const paintedTiles = new Set<string>();
canvas.addEventListener('mousedown', () => paintedTiles.clear());

canvas.addEventListener('click', (e) => {
  if (mode === 'region' && !dioramaOpen) {
    regionView?.click(e.clientX, e.clientY);
    return;
  }
  if (mode === 'region') return; // diorama is look-only
  const t = renderer.tileAt(e.clientX, e.clientY);
  if (cam.placing) {
    if (sim.placeBuilding(cam.placing, t.x, t.y)) {
      if (!e.shiftKey) {
        cam.placing = null;
        hud.refreshPaletteState();
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
  // Selection: settler first (within half a tile), then building
  cam.selectedSettler = null;
  cam.selectedBuilding = null;
  let best = 0.8;
  for (const s of sim.settlers) {
    const d = Math.hypot(s.pos.x - t.x, s.pos.y - t.y);
    if (d < best) {
      best = d;
      cam.selectedSettler = s.id;
    }
  }
  if (cam.selectedSettler === null && sim.world.inBounds(t.x, t.y)) {
    const id = sim.world.at(t.x, t.y).buildingId;
    if (id !== null) cam.selectedBuilding = id;
  }
});

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
  cam.x = Math.max(-200, Math.min(MAP_W * TILE - canvas.width + 200, cam.x));
  cam.y = Math.max(-200, Math.min(MAP_H * TILE - canvas.height + 200, cam.y));

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
  } else if (region) {
    if (dioramaOpen) {
      sim.tickDiorama(region.minute);
      renderer.draw();
    } else {
      regionView?.draw();
    }
    hud.drawRegionTopBar(region, dioramaOpen);
    hud.regionLog(region);
    const btn = document.getElementById('tb-diorama');
    if (btn) (btn as HTMLButtonElement).onclick = () => {
      dioramaOpen = !dioramaOpen;
    };
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
