/**
 * CoreView — a non-destructive GUI play-test harness for the SoA `TownCore`
 * (build-system B-6). The live game (`main.ts`) is untouched; this is a separate
 * entry (`core.html`) so the new core can be watched running in a real browser —
 * the gate that blocks the destructive swap — without ripping anything out.
 *
 * Builds a working starter town, runs the core on a fixed timestep, and draws
 * the BuildGrid + agents + raiders with a stats overlay. Controls:
 *   space pause · 1/2/3 speed · R raid now · N add settler ·
 *   left-drag paint wall · right-drag erase
 *
 * ponytail: deliberately minimal — direct canvas rects/dots, no shared Renderer
 * (that one is welded to the fat Simulation). It exists to validate behavior, not
 * to be pretty; the real renderer lands with PART 2.
 */
import './style.css';
import { TownCore } from './sim/towncore';
import { AState } from './sim/agents';
import { TERRAIN } from './sim/build';
import { ROOM_TYPE_ID, TICKS_PER_SECOND } from './sim/defs';

const MAP = 64;
// B-6 PART 3: boot WITH terrain so the play-test shows the Songs-of-Syx world
// (forests/water/rock/ore) the colony is painted onto, not a featureless plane.
const core = new TownCore({ width: MAP, height: MAP, seed: Date.now() % 100000, terrain: true });
(window as unknown as { core: TownCore }).core = core; // debug/automation hook

// ── starter town: doored kitchen + home + tavern, sized so a real colony lives ──
// Each room is fully walled with a single gate cut into the south side: a gate is
// passable (settlers path through) yet still seals the room for the enclosure
// (warmth) bonus, so the colony stays both reachable and warm.
{
  const g = core.grid;
  const cx = MAP >> 1, cy = MAP >> 1;
  // Clear the starter-town footprint back to grass so generated water/rock can't
  // land under the demo rooms (the heart clearing already handles trees/rock, but
  // not water). The wider world keeps its forests/lakes/outcrops.
  for (let y = cy - 12; y <= cy + 12; y++) for (let x = cx - 12; x <= cx + 16; x++) g.setTerrain(x, y, TERRAIN.GRASS);
  // Floor [x0..x1, y0..y1], wall the perimeter just outside it, then cut a south door.
  const room = (x0: number, y0: number, x1: number, y1: number, type: string): void => {
    g.designateRect(x0, y0, x1, y1, ROOM_TYPE_ID.get(type)!);
    for (let x = x0 - 1; x <= x1 + 1; x++) { g.setWall(x, y0 - 1); g.setWall(x, y1 + 1); }
    for (let y = y0 - 1; y <= y1 + 1; y++) { g.setWall(x0 - 1, y); g.setWall(x1 + 1, y); }
    g.setGate((x0 + x1) >> 1, y1 + 1); // gate: passable, but keeps the room enclosed (warmth + services)
  };
  const fill = (id: string, x0: number, y0: number, x1: number, y1: number, dx: number, dy: number): void => {
    for (let y = y0; y <= y1; y += dy) for (let x = x0; x <= x1; x += dx) g.placeStation(id, x, y);
  };

  room(cx - 4, cy - 9, cx + 3, cy - 6, 'kitchen');   // 8×4 kitchen
  fill('oven', cx - 4, cy - 9, cx + 3, cy - 9, 2, 1); // 4 ovens

  room(cx - 5, cy + 4, cx + 4, cy + 9, 'home');       // 10×6 home
  fill('bunk', cx - 5, cy + 4, cx + 4, cy + 8, 2, 3); // bunks (sleep 3 each) → ~36 beds

  room(cx + 8, cy - 2, cx + 14, cy + 2, 'tavern');    // 7×5 tavern
  fill('table', cx + 8, cy - 2, cx + 13, cy + 2, 3, 2); // tables (recreation 2 each)

  g.rebuildRooms();
  core.stock.add('grain', 5000);
  core.seedColony(cx, cy, 8); // spawn on open ground at the centre — reachable via the doors
}

// ── canvas ──
const app = document.getElementById('app')!;
const canvas = document.createElement('canvas');
app.appendChild(canvas);
const ctx = canvas.getContext('2d')!;
function resize(): void { canvas.width = innerWidth; canvas.height = innerHeight; ctx.imageSmoothingEnabled = false; }
resize();
addEventListener('resize', resize);

const tilePx = () => Math.floor(Math.min(canvas.width, canvas.height) / MAP);
const tileAt = (mx: number, my: number) => ({ x: Math.floor(mx / tilePx()), y: Math.floor(my / tilePx()) });

// ── input ──
let paused = false;
let speed = 3;
let paint: 0 | 1 | 2 = 0; // 0 none, 1 wall, 2 erase
addEventListener('keydown', (e) => {
  if (e.key === ' ') { paused = !paused; e.preventDefault(); }
  else if (e.key === '1') speed = 1;
  else if (e.key === '2') speed = 3;
  else if (e.key === '3') speed = 8;
  else if (e.key === 'r' || e.key === 'R') core.musterRaid();
  else if (e.key === 'n' || e.key === 'N') core.seedColony(core.homeX, core.homeY, 1);
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('mousedown', (e) => { paint = e.button === 2 ? 2 : 1; paintAt(e); });
addEventListener('mouseup', () => { paint = 0; core.grid.rebuildRooms(); });
canvas.addEventListener('mousemove', (e) => { if (paint) paintAt(e); });
function paintAt(e: MouseEvent): void {
  const r = canvas.getBoundingClientRect();
  const t = tileAt(e.clientX - r.left, e.clientY - r.top);
  if (!core.grid.inBounds(t.x, t.y)) return;
  if (paint === 1) core.grid.setWall(t.x, t.y); else core.grid.clearWall(t.x, t.y);
}

// ── render ──
function draw(): void {
  const px = tilePx();
  const g = core.grid;
  ctx.fillStyle = '#15151a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Terrain underlay (grass / tree / water / soil / rock), index-aligned with TERRAIN.
  const TERRAIN_COLORS = ['#243a22', '#1c3a1c', '#1d3a5c', '#3a3320', '#4a4a52'];
  for (let y = 0; y < MAP; y++) for (let x = 0; x < MAP; x++) {
    const i = y * MAP + x;
    const t = g.terrain[i];
    if (t !== TERRAIN.GRASS || !g.floor[i]) { // grass under a floor is hidden anyway
      ctx.fillStyle = TERRAIN_COLORS[t];
      ctx.fillRect(x * px, y * px, px, px);
    }
    if (g.ore[i]) { ctx.fillStyle = '#b8924a'; ctx.fillRect(x * px + px / 3, y * px + px / 3, px / 3, px / 3); }
    if (g.floor[i]) { ctx.fillStyle = '#2a2a32'; ctx.fillRect(x * px, y * px, px, px); }
    if (g.wall[i]) { ctx.fillStyle = '#6b5b4b'; ctx.fillRect(x * px, y * px, px, px); }
    if (g.gate[i]) { ctx.fillStyle = '#9a7b3b'; ctx.fillRect(x * px + px / 4, y * px + px / 4, px / 2, px / 2); }
  }
  for (const s of g.stations) { ctx.fillStyle = '#3a8f5a'; ctx.fillRect(s.x * px + 1, s.y * px + 1, s.w * px - 2, s.h * px - 2); }

  const a = core.agents;
  for (let i = 0; i < a.count; i++) {
    const st = a.state[i];
    ctx.fillStyle = st === AState.Sleeping ? '#5aa0ff' : st === AState.Working ? '#7fe07f' : '#e8e8e8';
    const cxp = a.posX[i] * px + px / 2, cyp = a.posY[i] * px + px / 2;
    ctx.fillRect(cxp - 2, cyp - 2, 4, 4);
    if (a.woundUntreated[i]) { ctx.strokeStyle = '#ff4040'; ctx.strokeRect(cxp - 3, cyp - 3, 6, 6); }
  }
  for (const r of core.raids.raiders) {
    ctx.fillStyle = r.fleeing ? '#aa6600' : '#ff3030';
    ctx.fillRect(r.x * px + px / 2 - 3, r.y * px + px / 2 - 3, 6, 6);
  }

  ctx.fillStyle = '#000a'; ctx.fillRect(0, 0, 290, 150);
  ctx.fillStyle = '#fff'; ctx.font = '13px monospace';
  const line = (n: number, s: string) => ctx.fillText(s, 8, 20 + n * 18);
  line(0, `day ${core.day}  pop ${core.population}  mood ${core.averageMood().toFixed(0)}`);
  line(1, `meals ${core.stock.count('meal')}  grain ${core.stock.count('grain')}  gold ${core.gold}`);
  line(2, `births ${core.births}  deaths ${core.deaths}`);
  line(3, core.raidActive ? `RAID — ${core.raids.raiders.length} raiders (slain ${core.raids.slain})` : `next raid day ${core.nextRaidDay}`);
  line(4, `${paused ? 'PAUSED' : 'speed ' + speed + '×'}`);
  line(5, `space pause · 1/2/3 speed · R raid · N settler`);
  line(6, `left-drag wall · right-drag erase`);

  // Event log: last few entries, bottom-left, colour-coded like the live HUD.
  const recent = core.log.slice(-6);
  const logColor = { good: '#7fe07f', bad: '#ff6b6b', info: '#d8d8d8' };
  ctx.font = '12px monospace';
  for (let k = 0; k < recent.length; k++) {
    const e = recent[recent.length - 1 - k];
    ctx.fillStyle = logColor[e.kind];
    ctx.fillText(`d${e.day} ${e.text}`, 8, canvas.height - 10 - k * 16);
  }
}

// ── loop: fixed-timestep sim, rAF render ──
let acc = 0, last = performance.now();
function loop(now: number): void {
  acc += Math.min(0.25, (now - last) / 1000) * TICKS_PER_SECOND * speed;
  last = now;
  if (!paused) { let guard = 0; while (acc >= 1 && guard++ < 64) { core.tick(); acc -= 1; } }
  else acc = 0;
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
