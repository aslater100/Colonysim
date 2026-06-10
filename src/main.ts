import './style.css';
import { Simulation } from './sim/sim';
import { TICKS_PER_SECOND } from './sim/defs';
import { MAP_W, MAP_H } from './sim/world';
import { Renderer } from './ui/render';
import type { Camera } from './ui/render';
import { Hud } from './ui/hud';
import { TILE } from './ui/sprites';

const root = document.getElementById('app')!;
const canvas = document.createElement('canvas');
canvas.id = 'game';
root.appendChild(canvas);

const sim = new Simulation(Date.now() % 100000);
const cam: Camera = {
  x: (MAP_W * TILE) / 2 - window.innerWidth / 2,
  y: (MAP_H * TILE) / 2 - window.innerHeight / 2,
  placing: null,
  chopMode: false,
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

const renderer = new Renderer(canvas, sim, cam);
const hud = new Hud(root, sim, cam);

// ---- input ----
const keys = new Set<string>();
window.addEventListener('keydown', (e) => {
  keys.add(e.key);
  if (e.key === ' ') {
    hud.paused = !hud.paused;
    e.preventDefault();
  }
  if (e.key === '1') hud.speed = 1;
  if (e.key === '2') hud.speed = 3;
  if (e.key === '3') hud.speed = 8;
  if (e.key === 'Escape') {
    cam.placing = null;
    cam.chopMode = false;
    cam.selectedSettler = null;
    cam.selectedBuilding = null;
    hud.refreshPaletteState();
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.key));

canvas.addEventListener('mousemove', (e) => {
  cam.mouseTile = renderer.tileAt(e.clientX, e.clientY);
});

canvas.addEventListener('click', (e) => {
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
  if (cam.chopMode) {
    sim.markTree(t.x, t.y);
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
      sim.tick();
      acc -= 1;
    }
  }
  renderer.draw();
  hud.update();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
