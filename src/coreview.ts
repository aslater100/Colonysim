/**
 * CENTURIA — the 4X campaign shell (core.html).
 *
 * A standalone strategic game over `RegionSim`: found a single colony in 1900,
 * grow it, found daughter towns, charter a state, and proclaim a nation before
 * the century turns in 2100. There is no town-detail / per-settler layer here —
 * the deep simulation (sectoral economy, monetary policy, diplomacy, war,
 * climate, tech & civics) is surfaced through `RegionView`'s panels.
 *
 * This module owns only the shell: boot, canvas, input, the persistent HUD,
 * the event log, and the game loop. All map + panel rendering belongs to
 * `RegionView`.
 *
 * Controls:
 *   Pan ........ WASD / arrow keys · middle-drag · left-drag empty map
 *   Zoom ....... scroll wheel · +/- · 0 resets
 *   Select ..... left-click a settlement (rivals open the diplomacy panel)
 *   Panels ..... T research · R routes · L settlements · E economy
 *   Speed ...... 1–4 · Space pauses
 */

import './style.css';
import { RegionSim } from './sim/region';
import { RegionView } from './ui/regionview';
import { RegionMap } from './sim/worldgen';
import { Weather } from './sim/weather';
import { Rng } from './sim/rng';
import { formatCurrency, TICKS_PER_SECOND } from './sim/defs';
import { buildSprites } from './ui/sprites';
import { applyOverrides } from './ui/spriteOverrides';
import { WindowManager } from './ui/WindowManager';
import { Sfx } from './ui/audio';
import { Music } from './ui/music';
import { Soundscape } from './ui/soundscape';

// ─────────────────────────────────────────────────────────────────────────────
// Audio — unlocked on the first user gesture (browser autoplay policy).
// ─────────────────────────────────────────────────────────────────────────────
const sfx = new Sfx();
const music = new Music();
const soundscape = new Soundscape();
let soundOn = true;
const unlockAudio = () => { sfx.unlock(); music.unlock(); soundscape.unlock(); };
addEventListener('mousedown', unlockAudio, { once: true });
addEventListener('keydown', unlockAudio, { once: true });

// Sprites (region tier uses the town-tier sprite atlas for tier markers etc.).
const sprites = buildSprites([]);
void applyOverrides(sprites);

// ─────────────────────────────────────────────────────────────────────────────
// Canvas — core.html ships only <div id="app">, so we mint the canvas here.
// The backing store is sized at DPR for crisp HiDPI; RegionView draws in
// device pixels and the screen→device ratio (canvas.width / rect.width) keeps
// pointer input aligned.
// ─────────────────────────────────────────────────────────────────────────────
const app = document.getElementById('app') ?? document.body;
const canvas = document.createElement('canvas');
canvas.className = 'cv-canvas';
app.appendChild(canvas);

let DPR = 1;
function resizeCanvas(): void {
  DPR = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  canvas.width = Math.round(innerWidth * DPR);
  canvas.height = Math.round(innerHeight * DPR);
  canvas.style.width = innerWidth + 'px';
  canvas.style.height = innerHeight + 'px';
}
resizeCanvas();
addEventListener('resize', resizeCanvas);

/** Pointer position in canvas backing-store (device) pixels. */
function devicePos(e: { clientX: number; clientY: number }): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  const sx = r.width > 0 ? canvas.width / r.width : 1;
  const sy = r.height > 0 ? canvas.height / r.height : 1;
  return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
}

// ─────────────────────────────────────────────────────────────────────────────
// Game state — a fresh colony on a freshly generated region.
// ─────────────────────────────────────────────────────────────────────────────
const seed = Date.now() % 100000;
const map = new RegionMap(seed);
const weather = new Weather(seed);
const region = RegionSim.foundColony(new Rng(seed), map, weather);

const regionView = new RegionView(canvas, region, document.body);
// Centre the camera on the founding valley once the layout is known.
regionView.selectedId = region.settlements[0]?.id ?? null;

// Make the region panels draggable + persistent, like the classic game.
const windows = new WindowManager();
for (const p of regionView.draggablePanels) windows.register(p);

(window as unknown as { region: RegionSim; regionView: RegionView }).region = region;
(window as unknown as { region: RegionSim; regionView: RegionView }).regionView = regionView;

let paused = false;
let speed = 1;

// ─────────────────────────────────────────────────────────────────────────────
// Persistent HUD — a thin DOM top bar (date / weather / towns / pop / treasury
// / territory) plus a bottom-left event log. Map + panels are RegionView's job.
// ─────────────────────────────────────────────────────────────────────────────
const topBar = document.createElement('div');
topBar.className = 'topbar cv-topbar';
document.body.appendChild(topBar);

const logBox = document.createElement('div');
logBox.className = 'cv-log';
document.body.appendChild(logBox);

function updateTopBar(): void {
  const r = region;
  const wx = r.weather.forDay(r.day);
  const skyIcon = { clear: '☀', overcast: '☁', rain: '☔', storm: '⛈', snow: '❄' }[wx.sky] ?? '';
  const drought = r.weather.isDrought(r.day) && r.seasonIndex < 3 ? ' <span class="tb-over">DROUGHT</span>' : '';
  const delta = Math.round(r.treasuryDeltaMonth);
  const trendColor = delta > 0 ? '#7fc26a' : delta < 0 ? '#e0995a' : '#998c6e';
  const trendStr = delta === 0 ? '' :
    ` <span style="color:${trendColor}" title="net treasury change last month">${delta > 0 ? '▲' : '▼'}${formatCurrency(Math.abs(delta))}/mo</span>`;
  const terr = Math.round(r.playerTerritoryControl() * 100);
  const tierLabel = r.nationProclaimed ? '★ NATION' : r.stateProclaimed ? '★ STATE' : 'COLONY';
  topBar.innerHTML =
    `<span class="tb-date">${r.dateLabel}</span>` +
    `<span title="weather">${skyIcon}${drought}</span>` +
    `<span title="settlements">TOWNS ${r.settlements.length}${r.expeditions.length ? ` (+${r.expeditions.length})` : ''}</span>` +
    `<span title="population">POP ${r.totalPop()}</span>` +
    `<span title="treasury">💰${formatCurrency(Math.round(r.treasury))}${trendStr}</span>` +
    `<span title="your share of regional territory">⬣ ${terr}%</span>` +
    `<span title="living notables">NOTABLES ${r.notables.filter((n) => n.alive).length}</span>` +
    `<span class="tb-date">${tierLabel}</span>` +
    `<button class="tb-btn" data-cv="sound" title="toggle audio">${soundOn ? '🔊' : '🔈'}</button>` +
    `<span class="tb-speed">${paused ? '⏸ PAUSED' : '▶'.repeat(speed)} <i>(space · 1-4)</i></span>` +
    (r.gameOver ? `<span class="tb-over">THE COLONY HAS PERISHED</span>` : '');
  const soundBtn = topBar.querySelector<HTMLButtonElement>('[data-cv="sound"]');
  if (soundBtn) soundBtn.onclick = toggleSound;
}

let lastLogLen = -1;
function updateLog(): void {
  if (region.log.length === lastLogLen) return;
  lastLogLen = region.log.length;
  logBox.innerHTML = region.log.slice(-6).reverse()
    .map((l) => `<div class="log-${l.kind}">${region.dateLabel} · ${l.text}</div>`)
    .join('');
}

function toggleSound(): void {
  soundOn = !soundOn;
  if (sfx.muted !== !soundOn) sfx.toggleMuted();
  if (music.enabled === !soundOn) music.toggle();
  if (soundscape.enabled === !soundOn) soundscape.toggle();
}

// ─────────────────────────────────────────────────────────────────────────────
// Input
// ─────────────────────────────────────────────────────────────────────────────
let panning = false;
let panLast = { x: 0, y: 0 };
let dragMoved = 0;

canvas.addEventListener('mousedown', (e) => {
  if (e.button === 1 || e.button === 0) {
    panning = true;
    dragMoved = 0;
    panLast = { x: e.clientX, y: e.clientY };
    if (e.button === 1) e.preventDefault();
  }
});
canvas.addEventListener('mousemove', (e) => {
  if (!panning) return;
  const dx = e.clientX - panLast.x;
  const dy = e.clientY - panLast.y;
  dragMoved += Math.abs(dx) + Math.abs(dy);
  // Drag the map in device px so it tracks the cursor exactly at any DPR.
  regionView.panBy(dx * DPR, dy * DPR);
  panLast = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('mouseup', (e) => {
  if (panning && e.button === 0 && dragMoved < 5) {
    const p = devicePos(e);
    regionView.click(p.x, p.y);
  }
  panning = false;
});
canvas.addEventListener('mouseleave', () => { panning = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => {
  const p = devicePos(e);
  regionView.zoomAt(p.x, p.y, e.deltaY < 0 ? 1 : -1);
  e.preventDefault();
}, { passive: false });

addEventListener('keydown', (e) => {
  // Don't steal keys while typing into a panel field.
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  const PAN = 60 * DPR;
  switch (e.key.toLowerCase()) {
    case ' ': paused = !paused; e.preventDefault(); break;
    case '1': speed = 1; break;
    case '2': speed = 2; break;
    case '3': speed = 3; break;
    case '4': speed = 4; break;
    case 'w': case 'arrowup': regionView.panBy(0, PAN); break;
    case 's': case 'arrowdown': regionView.panBy(0, -PAN); break;
    case 'a': case 'arrowleft': regionView.panBy(PAN, 0); break;
    case 'd': case 'arrowright': regionView.panBy(-PAN, 0); break;
    case '=': case '+': regionView.zoomAt(canvas.width / 2, canvas.height / 2, 1); break;
    case '-': case '_': regionView.zoomAt(canvas.width / 2, canvas.height / 2, -1); break;
    case '0': regionView.resetView(); break;
    case 't': regionView.researchOpen = !regionView.researchOpen; break;
    case 'r': regionView.routeNetworkOpen = !regionView.routeNetworkOpen; break;
    case 'l': regionView.settlementListOpen = !regionView.settlementListOpen; break;
    case 'e': regionView.economyOpen = !regionView.economyOpen; break;
    case 'm': toggleSound(); break;
    case 'escape': regionView.selectedId = null; regionView.selectedFactionId = null; break;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Main loop — fixed-timestep accumulator (parity with the classic region tick).
// ─────────────────────────────────────────────────────────────────────────────
let lastTime = performance.now();
let acc = 0;

function frame(): void {
  const now = performance.now();
  const dt = Math.min(0.1, (now - lastTime) / 1000); // clamp after tab-out
  lastTime = now;

  if (!paused && !regionView.ceremonyOpen && !region.gameOver) {
    acc += dt * TICKS_PER_SECOND * speed;
    let guard = 0;
    while (acc >= 1 && guard++ < 256) {
      region.tick();
      acc -= 1;
    }
  }

  regionView.draw();
  updateTopBar();
  updateLog();

  // Diegetic audio: era soundtrack + ambience that swells with unrest.
  const maxGrievance = region.settlements.reduce((m, s) => Math.max(m, s.grievance || 0), 0);
  const tension = Math.min(1, maxGrievance / 100);
  music.update({ year: region.year, paused, tension });
  soundscape.update({ mode: 'region', paused, year: region.year, activeBuildWorkers: 0, activeRailRoutes: 0, maxGrievance, tension });

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
