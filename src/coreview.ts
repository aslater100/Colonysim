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
document.body.classList.add('cv-app'); // scopes the 4X modern-UI theme
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
// Game state — continue a saved campaign if one exists, else found a fresh
// colony on a freshly generated region. The save stores the world seed so the
// procedural map/weather rebuild deterministically on load.
// ─────────────────────────────────────────────────────────────────────────────
const SAVE_KEY = 'centuria-4x-save';
type DeserializeSim = Parameters<typeof RegionSim.deserialize>[1];

function loadSaved(): { region: RegionSim; seed: number } | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const save = JSON.parse(raw) as { seed: number; data: string };
    if (typeof save.seed !== 'number' || typeof save.data !== 'string') return null;
    const stub = { rng: new Rng(save.seed), regionMap: new RegionMap(save.seed), weather: new Weather(save.seed) } as unknown as DeserializeSim;
    return { region: RegionSim.deserialize(save.data, stub), seed: save.seed };
  } catch { return null; }
}

let gameSeed: number;
let region: RegionSim;
const loaded = loadSaved();
if (loaded) {
  region = loaded.region;
  gameSeed = loaded.seed;
} else {
  gameSeed = Date.now() % 100000;
  region = RegionSim.foundColony(new Rng(gameSeed), new RegionMap(gameSeed), new Weather(gameSeed));
}

function saveGame(): void {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, seed: gameSeed, data: region.serialize() })); } catch { /* quota/full — ignore */ }
}
function newGame(): void {
  if (!confirm('Abandon this campaign and start a new colony? Your saved game will be overwritten.')) return;
  localStorage.removeItem(SAVE_KEY);
  location.reload();
}

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

// ── "Path to Nationhood" objectives panel ──────────────────────────────────
// Surfaces the model's own gate logic (canFoundTown / charterGates /
// canCallConventionGates) as a live checklist, so the deep colony→nation arc is
// legible: the player always sees the next milestone and exactly what blocks it.
const objBox = document.createElement('div');
objBox.className = 'cv-objectives';
objBox.id = 'cv-objectives';
document.body.appendChild(objBox);
windows.register({ id: 'cv-objectives', element: objBox, baseZ: 14 });

let lastObjFrame = -999;
function updateObjectives(frameNo: number): void {
  if (frameNo - lastObjFrame < 30) return; // ~twice a second
  lastObjFrame = frameNo;
  const r = region;
  const row = (g: { label: string; met: boolean; detail: string }) =>
    `<div class="cv-obj-row ${g.met ? 'cv-obj-done' : ''}">` +
    `<span class="cv-obj-mark">${g.met ? '✓' : '○'}</span>` +
    `<span class="cv-obj-label">${g.label}</span>` +
    (g.detail ? `<span class="cv-obj-detail">${g.detail}</span>` : '') +
    `</div>`;

  let stage: string, goal: string, gates: { label: string; met: boolean; detail: string }[];
  if (!r.stateProclaimed) {
    stage = 'Colony';
    goal = 'Charter a State';
    gates = r.charterGates();
    // Until there's a second town, the first concrete step is expansion.
    if (r.settlements.length < 2) {
      const cap = r.settlements[0];
      if (cap) {
        const ft = r.canFoundTown(cap.id);
        gates = [{ label: 'Found your first daughter town', met: false, detail: ft.ok ? 'ready — open the town panel' : ft.reason }, ...gates];
      }
    }
  } else if (!r.nationProclaimed) {
    stage = 'State';
    goal = 'Proclaim a Nation';
    gates = r.canCallConventionGates();
  } else {
    stage = 'Nation';
    goal = 'Lead the century to 2100';
    const terr = Math.round(r.playerTerritoryControl() * 100);
    gates = [
      { label: 'Unification', met: terr >= 75, detail: `${terr}% territory (75%+ by 2070)` },
      { label: 'Endure to 2100', met: false, detail: `year ${r.year}` },
    ];
  }
  const done = gates.filter((g) => g.met).length;
  objBox.innerHTML =
    `<div class="cv-obj-head"><span class="cv-obj-stage">${stage}</span>` +
    `<span class="cv-obj-goal">▸ ${goal}</span>` +
    `<span class="cv-obj-prog">${done}/${gates.length}</span></div>` +
    gates.map(row).join('');
}

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
    `<button class="tb-btn" data-cv="sound" title="toggle audio (M)">${soundOn ? '🔊' : '🔈'}</button>` +
    `<button class="tb-btn" data-cv="save" title="save campaign">💾 Save</button>` +
    `<button class="tb-btn" data-cv="new" title="start a new colony">New</button>` +
    `<button class="tb-btn" data-cv="help" title="how to play (H)">?</button>` +
    `<span class="tb-speed">${paused ? '⏸ PAUSED' : '▶'.repeat(speed)} <i>(space · 1-4)</i></span>` +
    (r.gameOver ? `<span class="tb-over">THE COLONY HAS PERISHED</span>` : '');
  const soundBtn = topBar.querySelector<HTMLButtonElement>('[data-cv="sound"]');
  if (soundBtn) soundBtn.onclick = toggleSound;
  const saveBtn = topBar.querySelector<HTMLButtonElement>('[data-cv="save"]');
  if (saveBtn) saveBtn.onclick = () => { saveGame(); saveBtn.textContent = '✓ Saved'; setTimeout(() => { saveBtn.textContent = '💾 Save'; }, 1200); };
  const newBtn = topBar.querySelector<HTMLButtonElement>('[data-cv="new"]');
  if (newBtn) newBtn.onclick = newGame;
  const helpBtn = topBar.querySelector<HTMLButtonElement>('[data-cv="help"]');
  if (helpBtn) helpBtn.onclick = showHelp;
}

// ── Event toasts ────────────────────────────────────────────────────────────
// Notable events (good/bad log entries — raids, treaty offers, breakthroughs,
// disasters, milestones) pop as transient top-centre cards so they aren't lost
// in the rolling log. Primed on first poll so the founding history is silent.
const toastBox = document.createElement('div');
toastBox.className = 'cv-toasts';
document.body.appendChild(toastBox);

// ── Welcome / help overlay ──────────────────────────────────────────────────
// A first-run guide to the colony→nation arc + controls, reopenable via the
// HUD "?" button or the H/? keys. Additive overlay — never blocks the sim.
const helpOverlay = document.createElement('div');
helpOverlay.className = 'cv-help hidden';
helpOverlay.innerHTML =
  `<div class="cv-help-box">` +
  `<h1>CENTURIA</h1>` +
  `<p class="cv-help-tag">Build · Endure · Govern — one valley to a nation, 1900–2100.</p>` +
  `<div class="cv-help-cols">` +
  `<div><h3>The arc</h3><ul>` +
  `<li>Grow your colony, then <b>found daughter towns</b>.</li>` +
  `<li>Charter a <b>State</b>, then proclaim a <b>Nation</b>.</li>` +
  `<li>Steer economy, diplomacy, war &amp; climate to 2100.</li>` +
  `<li>Watch the <b>Path to Nationhood</b> panel for your next step.</li>` +
  `</ul></div>` +
  `<div><h3>Controls</h3><ul>` +
  `<li><b>Pan</b> WASD / arrows / drag · <b>Zoom</b> wheel / +− · <b>0</b> reset</li>` +
  `<li><b>Click</b> a town to manage it · <b>Esc</b> deselect</li>` +
  `<li>Panels: <b>T</b> research · <b>R</b> routes · <b>L</b> towns · <b>E</b> economy</li>` +
  `<li><b>Space</b> pause · <b>1–4</b> speed · <b>Ctrl/⌘-S</b> save · <b>M</b> sound</li>` +
  `</ul></div>` +
  `</div>` +
  `<button class="cv-help-start">Begin ▸</button>` +
  `</div>`;
document.body.appendChild(helpOverlay);
const showHelp = () => helpOverlay.classList.remove('hidden');
const hideHelp = () => helpOverlay.classList.add('hidden');
helpOverlay.addEventListener('mousedown', (e) => { if (e.target === helpOverlay || (e.target as HTMLElement).classList.contains('cv-help-start')) hideHelp(); });
// Show once for a brand-new campaign (not when continuing a save).
if (!loaded && !localStorage.getItem('centuria-4x-seen')) {
  localStorage.setItem('centuria-4x-seen', '1');
  showHelp();
}

let lastToastLen = region.log.length; // prime: skip boot history
function pollToasts(): void {
  const log = region.log;
  if (log.length <= lastToastLen) { lastToastLen = log.length; return; }
  for (let i = Math.max(lastToastLen, log.length - 4); i < log.length; i++) {
    const e = log[i];
    if (e.kind === 'info') continue; // only surface the notable ones
    const t = document.createElement('div');
    t.className = `cv-toast cv-toast-${e.kind}`;
    t.textContent = e.text;
    toastBox.appendChild(t);
    while (toastBox.childElementCount > 4) toastBox.firstElementChild!.remove();
    setTimeout(() => { t.classList.add('cv-toast-out'); }, 3800);
    setTimeout(() => { t.remove(); }, 4400);
  }
  lastToastLen = log.length;
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
    case 'h': case '?': if (helpOverlay.classList.contains('hidden')) showHelp(); else hideHelp(); break;
    case 'escape':
      if (!helpOverlay.classList.contains('hidden')) { hideHelp(); break; }
      regionView.selectedId = null; regionView.selectedFactionId = null; break;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Main loop — fixed-timestep accumulator (parity with the classic region tick).
// ─────────────────────────────────────────────────────────────────────────────
let lastTime = performance.now();
let acc = 0;
let uiFrame = 0;

function frame(): void {
  uiFrame++;
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
  pollToasts();
  updateObjectives(uiFrame);

  // Diegetic audio: era soundtrack + ambience that swells with unrest.
  const maxGrievance = region.settlements.reduce((m, s) => Math.max(m, s.grievance || 0), 0);
  const tension = Math.min(1, maxGrievance / 100);
  music.update({ year: region.year, paused, tension });
  soundscape.update({ mode: 'region', paused, year: region.year, activeBuildWorkers: 0, activeRailRoutes: 0, maxGrievance, tension });

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// Autosave: every 45s of real time, and whenever the tab is hidden or closed,
// so a campaign survives a refresh or crash without manual saving.
setInterval(saveGame, 45000);
addEventListener('beforeunload', saveGame);
addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveGame(); });
addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveGame(); }
});
