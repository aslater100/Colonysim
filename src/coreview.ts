/**
 * CoreView — a non-destructive GUI play-test harness for the SoA `TownCore`
 * (build-system B-6). The live game (`main.ts`) is untouched; this is a separate
 * entry (`core.html`) so the new core can be watched running in a real browser —
 * the gate that blocks the destructive swap — without ripping anything out.
 *
 * Builds a working starter town, runs the core on a fixed timestep, and draws
 * the BuildGrid + agents + raiders with a stats overlay. Controls:
 *
 *   Simulation:
 *     space pause · 1/2/3 speed · R raid now · N add settler
 *
 *   Paint tools (left-drag paint, right-drag erase):
 *     W  wall blueprint     E  erase tile
 *     G  gate (passable)    D  floor (bare, no designation)
 *     Z  room floor+designation  [ ] cycle room type
 *     A  place station      , . cycle station type
 *     F  field zone    C  woodcutter zone
 *     Q  quarry zone   B  fishery zone
 *
 *   Inspect:  click an agent to open the settler inspector
 *
 * Renders with the game's real procedural sprites so TownCore looks like the
 * live game. Reachable from index.html via the `?core` URL param (main.ts
 * redirects) or the standalone core.html.
 */
import './style.css';
import { TownCore } from './sim/towncore';
import type { SettlerView, PendingEventChoice, YearReport } from './sim/towncore';
import { buildStarterTown } from './sim/startertown';
import { AState, THOUGHT_SLOTS, ThoughtKey } from './sim/agents';
import { TERRAIN, ZONE, ZONE_DEFS } from './sim/build';
import {
  ROOM_TYPE_ID, ROOM_DEF_BY_NUM, ROOM_DEFS,
  STATION_DEF_BY_NUM, STATION_DEFS,
  TICKS_PER_SECOND, SEASONS, START_YEAR, DAYS_PER_SEASON, DAYS_PER_YEAR, MINUTES_PER_TICK, MINUTES_PER_DAY,
  RESOURCE_KINDS, BLUEPRINT_DEFS, TUNING,
} from './sim/defs';
import { RESEARCH_PER_DESK_PER_DAY } from './sim/research';
import { REGION_N, type Biome } from './sim/worldgen';
import { buildSprites } from './ui/sprites';
import { applyOverrides } from './ui/spriteOverrides';

const sprites = buildSprites([]);
void applyOverrides(sprites);

const THOUGHT_LABELS: Partial<Record<ThoughtKey, string>> = {
  [ThoughtKey.Breakdown]: 'Mental breakdown',
  [ThoughtKey.FoodVariety]: 'Food variety',
  [ThoughtKey.Faith]: 'Attended services',
  // Reserved for future keyed thoughts (see ThoughtKey enum in agents.ts)
};

const SOA_SAVE_KEY = 'centuria_save';
const MAP = 96; // room to grow — the colony starts as a cluster in a wider world
let core = new TownCore({ width: MAP, height: MAP, seed: Date.now() % 100000, terrain: 'heightmap' });
(window as unknown as { core: TownCore }).core = core;

// ── Room type colors (semi-transparent tint over floor tiles) ──────────────
const ROOM_COLORS: Record<string, string> = {
  home: '#b87030',
  kitchen: '#e08020',
  bakery: '#c8a030',
  mill: '#b0b030',
  smithy: '#808080',
  foundry: '#d04010',
  sawmill: '#804010',
  workshop: '#408080',
  kilnhouse: '#c05020',
  library: '#4080d0',
  infirmary: '#40c040',
  apothecary: '#80c840',
  tavern: '#8030c0',
  storehouse: '#a08060',
  burial_ground: '#607060',
  outpost: '#705020',
  watchtower: '#506080',
  yard: '#507050',
  market: '#d4a020',
  barracks: '#c05050',
  pasture: '#7ba050',
  temple: '#c8a8e0',
  smokehouse: '#7a4828',
};

// ── Starter town ──────────────────────────────────────────────────────────
buildStarterTown(core, MAP);

// Continue: if the page was opened with ?continue (from the title screen's
// Continue button) or Ctrl+L, restore the last SoA save immediately instead
// of booting a fresh starter town.
{
  const urlContinue = new URLSearchParams(location.search).has('continue');
  if (urlContinue) {
    const raw = localStorage.getItem(SOA_SAVE_KEY);
    if (raw) {
      try {
        const loaded = TownCore.deserialize(JSON.parse(raw));
        core = loaded;
        (window as unknown as { core: TownCore }).core = core;
      } catch (err) {
        console.warn('SoA save restore failed, starting fresh:', err);
      }
    }
    // Strip the ?continue so Ctrl+R starts fresh rather than re-loading again
    history.replaceState(null, '', location.pathname);
  }
}

// ── Canvas ────────────────────────────────────────────────────────────────
const app = document.getElementById('app')!;
const canvas = document.createElement('canvas');
app.appendChild(canvas);
const ctx = canvas.getContext('2d')!;
// CSS (layout) dimensions of the canvas. The backing store is sized at
// cw·DPR × ch·DPR so the scene renders at the display's native resolution
// ("more pixels" on HiDPI screens); every coordinate below stays in CSS px and
// the per-frame base transform (set in draw) scales it up uniformly, so layout,
// input and the world camera are unchanged — only sharper.
let cw = 0, ch = 0, DPR = 1;

// Minimap: off-screen canvas rendered at 2px/tile, overlaid in bottom-right corner.
const MINI_PX = 2; // px per tile in the minimap
const minimapCanvas = document.createElement('canvas');
minimapCanvas.width = minimapCanvas.height = 96 * MINI_PX; // updated if MAP changes
const minimapCtx = minimapCanvas.getContext('2d')!;
const minimapData = minimapCtx.createImageData(96 * MINI_PX, 96 * MINI_PX);

// "← Menu" DOM button — always-visible escape hatch back to the title screen.
const menuBtn = document.createElement('button');
menuBtn.textContent = '← Menu';
menuBtn.style.cssText = 'position:fixed;top:8px;right:8px;padding:4px 10px;background:#111c;color:#90a8c0;border:1px solid #30485a;border-radius:3px;font:12px monospace;cursor:pointer;z-index:999;';
menuBtn.title = 'Return to title screen (Esc)';
menuBtn.addEventListener('mouseenter', () => { menuBtn.style.color = '#c0d8f0'; menuBtn.style.borderColor = '#5080a0'; });
menuBtn.addEventListener('mouseleave', () => { menuBtn.style.color = '#90a8c0'; menuBtn.style.borderColor = '#30485a'; });
const goToMenu = () => {
  localStorage.setItem(SOA_SAVE_KEY, JSON.stringify(core.serialize()));
  location.assign('./');
};
menuBtn.addEventListener('click', goToMenu);
app.appendChild(menuBtn);

// "World" DOM button — toggles the zoomed-out region overview (seamless world M1).
const worldBtn = document.createElement('button');
worldBtn.textContent = '🌐 World';
worldBtn.style.cssText = 'position:fixed;top:8px;right:74px;padding:4px 10px;background:#111c;color:#90a8c0;border:1px solid #30485a;border-radius:3px;font:12px monospace;cursor:pointer;z-index:999;';
worldBtn.title = 'View the wider world your colony sits in';
worldBtn.addEventListener('click', () => { worldView = !worldView; });
app.appendChild(worldBtn);
// ── Camera (pan + zoom) ─────────────────────────────────────────────────────
// World is drawn at `TILE` base px/tile under a translate+scale transform, so
// the SoA play-test pans and zooms like the real game. `view.x/y` are the
// screen-space offset (px); `view.scale` is the zoom.
const TILE = 20; // base px per tile at zoom 1 (sprites render at 32; ~62% scale gives crisp detail)
const view = { x: 0, y: 0, scale: 1 };
// Reused each frame for the agent painter's-algorithm y-sort, so the draw loop
// doesn't allocate a fresh index array (and its closures) every frame.
const agentOrder: number[] = [];
const MIN_SCALE = 0.4, MAX_SCALE = 4;

/** Frame the whole map centered in the viewport (the O / reset view). */
function fitView(): void {
  view.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min(cw, ch) / (MAP * TILE)));
  view.x = (MAP * TILE * view.scale - cw) / 2;
  view.y = (MAP * TILE * view.scale - ch) / 2;
}
/** Center on the colony at a comfortable zoom — the initial view, so the player
 *  starts looking at their town rather than a tiny dot in a wide map. */
function focusTown(span = 36): void {
  view.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min(cw, ch) / (span * TILE)));
  view.x = core.homeX * TILE * view.scale - cw / 2;
  view.y = core.homeY * TILE * view.scale - ch / 2;
}
function resize(): void {
  cw = innerWidth; ch = innerHeight;
  // Cap DPR at 2 — beyond that the extra fill cost outweighs the visible gain.
  DPR = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  canvas.width = Math.round(cw * DPR); canvas.height = Math.round(ch * DPR);
  canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
  ctx.imageSmoothingEnabled = false; // crisp pixel art (setting width resets ctx state)
}
resize();
focusTown();
addEventListener('resize', resize); // preserve the current pan/zoom across resizes

/** Screen (canvas-local) px → tile coords, undoing the camera transform. */
const tileAt = (mx: number, my: number) => ({
  x: Math.floor((mx + view.x) / view.scale / TILE),
  y: Math.floor((my + view.y) / view.scale / TILE),
});

/** Zoom toward a screen point, keeping the world point under it fixed. */
function zoomAt(mx: number, my: number, dir: number): void {
  const factor = dir > 0 ? 1.15 : 1 / 1.15;
  const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, view.scale * factor));
  if (next === view.scale) return;
  const bx = (mx + view.x) / view.scale;
  const by = (my + view.y) / view.scale;
  view.scale = next;
  view.x = bx * next - mx;
  view.y = by * next - my;
}

// ── Tool state ────────────────────────────────────────────────────────────
let paused = false;
let speed = 3;
let showEconomy = false; // toggle the full inventory/economy panel (I)
// Foods are exempt from the storage cap (they ride their own freshness limit).
const FOOD_KINDS_VIEW = new Set(['meal', 'grain', 'bread', 'ale', 'dairy', 'produce', 'game_meal', 'fish_meal', 'preserved', 'flour']);
let painting: 0 | 1 | 2 = 0; // 0=none, 1=apply, 2=erase
let flashMsg = ''; // brief feedback message (e.g. "Saved", "Loaded")
let flashUntil = 0; // timestamp when flash expires

type Tool = 'wall' | 'erase' | 'gate' | 'floor' | 'room' | 'station'
           | 'field' | 'woodcutter' | 'quarry' | 'fishery' | 'flax' | 'forage'
           | 'orchard' | 'veggarden' | 'trap' | 'bridge' | 'blueprint';
let tool: Tool = 'wall';
// Seamless world (M1): the "🌐 World" button opens a zoomed-out overview of the
// wider region this colony sits in; the button or Esc returns. Town keeps ticking.
let worldView = false;

// Room designation sub-tool: cycle through room type names.
const ROOM_TYPE_NAMES = ROOM_DEFS.map(d => d.id);
let roomTypeIdx = 0; // index into ROOM_TYPE_NAMES

// Station placement sub-tool: cycle through station type names.
const STATION_TYPE_NAMES = STATION_DEFS.map(d => d.id);
let stationTypeIdx = 0; // index into STATION_TYPE_NAMES

// Blueprint stamp sub-tool: cycle through pre-defined building templates.
let blueprintIdx = 0; // index into BLUEPRINT_DEFS

// Settler inspector state.
let inspected: SettlerView | null = null;
let inspectedIdx = -1;

// ── Input ─────────────────────────────────────────────────────────────────
addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  // Choice event: 1/2 selects an option while a dialog is pending.
  if (core.pendingChoice) {
    if (e.key === '1') { core.resolveEventChoice(0); e.preventDefault(); return; }
    if (e.key === '2') { core.resolveEventChoice(1); e.preventDefault(); return; }
    e.preventDefault(); // block other keys while dialog is open
    return;
  }
  // World overview (open by clicking the minimap): Esc closes it back to the
  // colony rather than quitting to the menu; it's look-only until the M2 purchase UI.
  if (worldView) {
    if (e.key === 'Escape') { worldView = false; e.preventDefault(); return; }
    e.preventDefault();
    return;
  }
  if (e.key === 'Escape') { goToMenu(); return; }
  if (e.key === ' ') { paused = !paused; e.preventDefault(); return; }
  // Camera: WASD / arrows pan, O frames the whole map. (WASD skipped when a
  // modifier is held so Ctrl+S save etc. still work.)
  const PAN = 60;
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === 'ArrowUp'    || (k === 'w' && !mod)) { view.y -= PAN; e.preventDefault(); return; }
  if (e.key === 'ArrowDown'  || (k === 's' && !mod)) { view.y += PAN; e.preventDefault(); return; }
  if (e.key === 'ArrowLeft'  || (k === 'a' && !mod)) { view.x -= PAN; e.preventDefault(); return; }
  if (e.key === 'ArrowRight' || (k === 'd' && !mod)) { view.x += PAN; e.preventDefault(); return; }
  if (k === 'o') { fitView(); return; }
  if (e.key === '1') { speed = 1; return; }
  if (e.key === '2') { speed = 3; return; }
  if (e.key === '3') { speed = 8; return; }
  if (e.key === '4') { speed = 16; return; }
  if (k === 'r') { core.musterRaid(); return; }
  if (k === 'm') { core.summonWolves(); return; }
  if (k === 'n') { core.seedColony(core.homeX, core.homeY, 1); return; }
  if (k === 'y') {
    const FOCUSES: import('./sim/defs').TownFocus[] = ['balanced', 'agricultural', 'military', 'trade', 'industrial', 'cultural'];
    const idx = FOCUSES.indexOf(core.focus);
    core.focus = FOCUSES[(idx + 1) % FOCUSES.length];
    flashMsg = `Focus: ${core.focus}`; flashUntil = Date.now() + 1500;
    return;
  }
  if (k === 'x') {
    // Cycle research queue: X rotates through available techs; auto-researches when affordable
    const avail = core.researchBook.available();
    if (avail.length > 0) {
      const cur = core.researchBook.queue;
      const idx = cur ? avail.findIndex(t => t.id === cur) : -1;
      core.researchBook.queue = avail[(idx + 1) % avail.length].id;
    }
    return;
  }
  // Tool keys
  if (k === 'h') { tool = 'wall'; return; }    // H/J/K: WASD now pans, so the
  if (k === 'e') { tool = 'erase'; return; }
  if (k === 'g') { tool = 'gate'; return; }
  if (k === 'j') { tool = 'floor'; return; }   // wall/floor/station tools moved
  if (k === 'z') { tool = 'room'; return; }
  if (k === 'k') { tool = 'station'; return; } // off W/D/A onto H/J/K
  if (k === 'f') { tool = 'field'; return; }
  if (k === 'c') { tool = 'woodcutter'; return; }
  if (k === 'q') { tool = 'quarry'; return; }
  if (k === 'b' && e.shiftKey) { tool = 'bridge'; e.preventDefault(); return; }
  if (k === 'b') { tool = 'fishery'; return; }
  if (k === 'l' && !e.ctrlKey) { tool = 'flax'; return; }
  if (k === 'p') { tool = 'forage'; return; } // pick wild forage deposits
  if (k === 'u') { tool = 'orchard'; return; }   // fruit orchard (grass)
  if (k === 'v') { tool = 'veggarden'; return; } // vegetable garden (soil)
  if (k === 'i') { showEconomy = !showEconomy; return; } // inventory / economy panel
  if (k === 't' && !e.ctrlKey) { tool = 'trap'; return; }
  if (k === 'k' && e.shiftKey) { tool = 'blueprint'; e.preventDefault(); return; }
  // Save / Load via localStorage (Ctrl+S / Ctrl+L)
  if (e.ctrlKey && k === 's') {
    localStorage.setItem('centuria_save', JSON.stringify(core.serialize()));
    flashMsg = 'Saved'; flashUntil = Date.now() + 1500;
    e.preventDefault(); return;
  }
  if (e.ctrlKey && k === 'l') {
    const raw = localStorage.getItem('centuria_save');
    if (raw) {
      try { core = TownCore.deserialize(JSON.parse(raw)); (window as unknown as { core: TownCore }).core = core; flashMsg = 'Loaded'; flashUntil = Date.now() + 1500; }
      catch { flashMsg = 'Load failed'; flashUntil = Date.now() + 2000; }
    } else { flashMsg = 'No save found'; flashUntil = Date.now() + 1500; }
    e.preventDefault(); return;
  }
  // Cycle room type
  if (e.key === '[') {
    if (tool === 'blueprint') blueprintIdx = (blueprintIdx - 1 + BLUEPRINT_DEFS.length) % BLUEPRINT_DEFS.length;
    else roomTypeIdx = (roomTypeIdx - 1 + ROOM_TYPE_NAMES.length) % ROOM_TYPE_NAMES.length;
    return;
  }
  if (e.key === ']') {
    if (tool === 'blueprint') blueprintIdx = (blueprintIdx + 1) % BLUEPRINT_DEFS.length;
    else roomTypeIdx = (roomTypeIdx + 1) % ROOM_TYPE_NAMES.length;
    return;
  }
  // Cycle station type
  if (e.key === ',') { stationTypeIdx = (stationTypeIdx - 1 + STATION_TYPE_NAMES.length) % STATION_TYPE_NAMES.length; return; }
  if (e.key === '.') { stationTypeIdx = (stationTypeIdx + 1) % STATION_TYPE_NAMES.length; return; }
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
// Middle-button drag pans the camera (left/right are paint/erase/inspect).
let panning = false;
let panLast = { x: 0, y: 0 };
canvas.addEventListener('mousedown', (e) => {
  if (worldView) return; // overview is look-only
  if (e.button === 1) { panning = true; panLast = { x: e.clientX, y: e.clientY }; e.preventDefault(); return; }
  // Left-click on a settler inspects it (any tool) instead of painting.
  if (e.button === 0 && maybeInspect(e)) return;
  painting = e.button === 2 ? 2 : 1;
  paintAt(e);
});
addEventListener('mouseup', () => {
  panning = false;
  painting = 0;
  if (tool === 'room' || tool === 'wall' || tool === 'floor' || tool === 'station') {
    core.grid.rebuildRooms();
  }
});
let hoverX = -1, hoverY = -1;
canvas.addEventListener('mousemove', (e) => {
  if (panning) { view.x -= e.clientX - panLast.x; view.y -= e.clientY - panLast.y; panLast = { x: e.clientX, y: e.clientY }; return; }
  const r = canvas.getBoundingClientRect();
  const t = tileAt(e.clientX - r.left, e.clientY - r.top);
  hoverX = t.x; hoverY = t.y;
  if (painting) paintAt(e);
});
// Scroll wheel zooms toward the cursor.
canvas.addEventListener('wheel', (e) => {
  if (worldView) return;
  e.preventDefault();
  const r = canvas.getBoundingClientRect();
  zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1 : -1);
}, { passive: false });

// Minimap click → pan main view to that tile.
canvas.addEventListener('click', (e) => {
  if (worldView) return;
  const r = canvas.getBoundingClientRect();
  const cx = e.clientX - r.left, cy = e.clientY - r.top;
  const mmSize = MAP * MINI_PX, mmX = cw - mmSize - 4, mmY = ch - mmSize - 4;
  if (cx >= mmX && cx < mmX + mmSize && cy >= mmY && cy < mmY + mmSize) {
    const tx = Math.floor((cx - mmX) / MINI_PX);
    const ty = Math.floor((cy - mmY) / MINI_PX);
    view.x = tx * TILE * view.scale - cw / 2;
    view.y = ty * TILE * view.scale - ch / 2;
  }
});

/** Click on/near a settler to open the inspector. Returns true if one was hit
 *  (so the caller can skip painting). */
function maybeInspect(e: MouseEvent): boolean {
  const r = canvas.getBoundingClientRect();
  const t = tileAt(e.clientX - r.left, e.clientY - r.top);
  const a = core.agents;
  let bestDist = 1.2; // Manhattan tiles — basically "clicked the settler's tile"
  let bestIdx = -1;
  for (let i = 0; i < a.count; i++) {
    const d = Math.abs(a.posX[i] - t.x) + Math.abs(a.posY[i] - t.y);
    if (d <= bestDist) { bestDist = d; bestIdx = i; }
  }
  if (bestIdx < 0) return false;
  inspected = core.inspect(bestIdx);
  inspectedIdx = bestIdx;
  return true;
}

function paintAt(e: MouseEvent): void {
  const r = canvas.getBoundingClientRect();
  const t = tileAt(e.clientX - r.left, e.clientY - r.top);
  const g = core.grid;
  if (!g.inBounds(t.x, t.y)) return;

  // Right-drag always erases regardless of tool
  if (painting === 2) {
    g.clearWall(t.x, t.y);
    g.clearGate(t.x, t.y);
    g.clearFloor(t.x, t.y);
    g.clearZone(t.x, t.y);
    g.clearDesignation(t.x, t.y);
    core.cancelBlueprint(t.x, t.y);
    core.clearTrap(t.x, t.y);
    return;
  }

  // Left-drag: apply current tool
  switch (tool) {
    case 'wall':    core.blueprintWall(t.x, t.y); break;
    case 'erase':
      g.clearWall(t.x, t.y); g.clearGate(t.x, t.y);
      g.clearFloor(t.x, t.y); g.clearZone(t.x, t.y);
      g.clearDesignation(t.x, t.y); core.cancelBlueprint(t.x, t.y);
      core.clearTrap(t.x, t.y); g.clearRoad(t.x, t.y);
      // Remove any station whose footprint covers this tile.
      { const stn = g.stations.find(s => t.x >= s.x && t.x < s.x + s.w && t.y >= s.y && t.y < s.y + s.h);
        if (stn) { g.removeStation(stn.id); g.rebuildRooms(); } }
      break;
    case 'gate':    g.setGate(t.x, t.y);  break;
    case 'floor':   g.setFloor(t.x, t.y); break;
    case 'room': {
      const rid = ROOM_TYPE_ID.get(ROOM_TYPE_NAMES[roomTypeIdx]) ?? 1;
      g.setFloor(t.x, t.y);
      g.designate(t.x, t.y, rid);
      break;
    }
    case 'station': {
      const sid = STATION_TYPE_NAMES[stationTypeIdx];
      g.placeStation(sid, t.x, t.y);
      break;
    }
    case 'field':      g.setZone(t.x, t.y, ZONE.FIELD);      break;
    case 'woodcutter': g.setZone(t.x, t.y, ZONE.WOODCUTTER);  break;
    case 'quarry':     g.setZone(t.x, t.y, ZONE.QUARRY);      break;
    case 'fishery':    g.setZone(t.x, t.y, ZONE.FISHERY);     break;
    case 'flax':       g.setZone(t.x, t.y, ZONE.FLAX);        break;
    case 'forage':     g.setZone(t.x, t.y, ZONE.FORAGE);      break;
    case 'orchard':    g.setZone(t.x, t.y, ZONE.ORCHARD);     break;
    case 'veggarden':  g.setZone(t.x, t.y, ZONE.VEGGARDEN);   break;
    case 'trap':       core.paintTrap(t.x, t.y);               break;
    case 'bridge':     g.setRoad(t.x, t.y, 4);                break;
    case 'blueprint':  core.stampBlueprint(BLUEPRINT_DEFS[blueprintIdx], t.x, t.y); break;
  }
}

// ── Render ────────────────────────────────────────────────────────────────
const ZONE_OUTLINE = ['', '#d4d46a', '#6ad48a', '#c8c8d8', '#6ad4d4', '#d4a06a', '#c060d0', '#e07090', '#90c050']; // forage=violet, orchard=pink, veg=green
// Wild forage deposit marker colours by FORAGE type (berries/mushrooms/herbs).

// Station ids that produce heat/smoke — rendered with rising smoke puffs while active.
const SMOKE_STATIONS = new Set(['oven', 'baking_oven', 'smelter', 'kiln', 'coke_oven', 'brew_vat']);
const SPARK_STATIONS = new Set(['anvil', 'weapon_bench', 'smelter']);

// ── World overview (seamless world, M1) ─────────────────────────────────────
const BIOME_COLORS: Record<Biome, string> = {
  sea: '#243d52', lake: '#2e4a5c', river: '#36586e', marsh: '#39503e',
  plains: '#46563a', forest: '#33502c', hills: '#5a5742', mountains: '#6a6358',
};
// The region is static per seed, so rasterise it once (1px/cell) and blit it
// scaled with smoothing off — crisp blocks, no 128² fills per frame.
let _regionCanvas: HTMLCanvasElement | null = null;
function regionCanvas(): HTMLCanvasElement {
  if (_regionCanvas) return _regionCanvas;
  const rm = core.regionMap;
  const c = document.createElement('canvas');
  c.width = REGION_N; c.height = REGION_N;
  const rg = c.getContext('2d')!;
  for (let y = 0; y < REGION_N; y++) for (let x = 0; x < REGION_N; x++) {
    const cell = rm.at(x, y);
    rg.fillStyle = cell.biome === 'mountains' && cell.elevation > 0.85 ? '#9a978f' : BIOME_COLORS[cell.biome];
    rg.fillRect(x, y, 1, 1);
  }
  _regionCanvas = c;
  return c;
}

function drawWorld(): void {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#0d1014';
  ctx.fillRect(0, 0, cw, ch);
  const map = regionCanvas();
  const span = Math.min(cw, ch) * 0.9;
  const px = Math.max(1, Math.floor(span / REGION_N));
  const size = px * REGION_N;
  const ox = Math.floor((cw - size) / 2), oy = Math.floor((ch - size) / 2);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(map, ox, oy, size, size);
  // Home colony marker: a pulsing ring on its cell.
  const site = core.site;
  const hx = ox + site.cellX * px + px / 2, hy = oy + site.cellY * px + px / 2;
  const pulse = 4 + Math.sin(performance.now() / 300) * 1.5;
  ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(hx, hy, pulse + 3, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#ffd24a'; ctx.fillRect(hx - 1, hy - 1, 3, 3);
  // Border + labels.
  ctx.strokeStyle = '#3a4654'; ctx.lineWidth = 1;
  ctx.strokeRect(ox + 0.5, oy + 0.5, size - 1, size - 1);
  ctx.fillStyle = '#e8e0c8'; ctx.font = 'bold 18px monospace';
  ctx.fillText('The Wider World', ox, oy - 14);
  ctx.fillStyle = '#90a0b0'; ctx.font = '12px monospace';
  ctx.fillText('Your colony sits where the gold marker pulses.  V or Esc to return.', ox, oy - 1);
}

function draw(): void {
  if (worldView) { drawWorld(); return; }
  const px = TILE; // world is drawn in base px under the camera transform below
  const g = core.grid;
  const blit = (img: CanvasImageSource, x: number, y: number) => ctx.drawImage(img, x * px, y * px, px, px);
  // Ground blit: bleeds opaque base-terrain tiles 1px into their right/bottom
  // neighbour. At a fractional zoom the scaled context lands tile edges on
  // sub-pixels and the dark backdrop shows through as a faint grid; the overlap
  // closes every interior seam. Only for full-tile opaque ground — overlays
  // (roads/walls/gates with transparency) keep the exact `blit` to stay aligned.
  const blitG = (img: CanvasImageSource, x: number, y: number) => ctx.drawImage(img, x * px, y * px, px + 1, px + 1);
  // Base transform maps CSS px → device px at the display's pixel ratio. Set
  // fresh each frame (it also clears any stale transform); every coordinate
  // below is in CSS px, so positions are identical to before — just sharper.
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#15151a';
  ctx.fillRect(0, 0, cw, ch);
  // Enter world space: pan (view.x/y) + zoom (view.scale). Restored before the
  // screen-space HUD overlays below.
  ctx.save();
  ctx.translate(-view.x, -view.y);
  ctx.scale(view.scale, view.scale);

  // Materialize stations once per frame — stationViews() is a generator that
  // yields a fresh object per station, and the draw uses it three times (glow
  // collection, shadow pass, sprite pass). Iterating it once avoids 2× the
  // object churn and progress lookups every frame.
  const stationList = [...core.stationViews()];

  // Collect active station positions for night glow passes
  const fireGlowPositions: { cx: number; cy: number }[] = [];
  const windowGlowPositions: { cx: number; cy: number }[] = [];
  for (const sv of stationList) {
    const def = STATION_DEF_BY_NUM[sv.typeId];
    if (!def) continue;
    const center = { cx: (sv.x + def.w / 2) * px, cy: (sv.y + def.h / 2) * px };
    if (sv.progress > 0 && SMOKE_STATIONS.has(def.id)) fireGlowPositions.push(center);
    else if (sv.progress > 0) windowGlowPositions.push(center);
  }

  // drought/flood zone tint: +1 = flood (blue), -1 = drought (brown), 0 = normal
  const droughtOrFlood = core.weather.isFloodRisk(core.day) ? 1 : core.weather.isDrought(core.day) ? -1 : 0;
  // Season index: 0=spring, 1=summer, 2=autumn, 3=winter — drives crop stage sprites.
  const seasonIdx = Math.floor((core.day % DAYS_PER_YEAR) / DAYS_PER_SEASON);

  const anim = (performance.now() / 500 | 0) % sprites.water.length;

  // Viewport culling — only iterate tiles that can touch the screen. At higher
  // zoom most of the 96×96 grid is off-screen, so clamping the terrain loop (and
  // the full-map shadow/trap/candlelight passes below) to the visible window is
  // the single biggest frame-time win. The 2-tile margin covers sprites that
  // overhang their tile (tree canopies, settler heads drawn 1.35× tall).
  const MARGIN = 2;
  const vx0 = Math.max(0, Math.floor(view.x / view.scale / TILE) - MARGIN);
  const vy0 = Math.max(0, Math.floor(view.y / view.scale / TILE) - MARGIN);
  const vx1 = Math.min(MAP, Math.ceil((view.x + cw) / view.scale / TILE) + MARGIN);
  const vy1 = Math.min(MAP, Math.ceil((view.y + ch) / view.scale / TILE) + MARGIN);
  // Same window in world-pixel space, for culling free-moving entities (agents,
  // animals, stations) by their footprint. A 2-tile slack keeps oversized/y-offset
  // sprites from popping at the edges.
  const wL = view.x / view.scale - MARGIN * TILE, wT = view.y / view.scale - MARGIN * TILE;
  const wR = (view.x + cw) / view.scale + MARGIN * TILE;
  const wB = (view.y + ch) / view.scale + MARGIN * TILE;
  const onScreen = (tileX: number, tileY: number): boolean =>
    tileX * TILE >= wL && tileX * TILE <= wR && tileY * TILE >= wT && tileY * TILE <= wB;

  for (let y = vy0; y < vy1; y++) for (let x = vx0; x < vx1; x++) {
    const i = y * MAP + x;
    const t = g.terrain[i];

    // Ground layer — field zones use a crop-stage soil sprite based on current season.
    if (t === TERRAIN.WATER) blitG(seasonIdx === 3 ? sprites.waterWinter[(x ^ y * 3) % 4] : sprites.water[anim], x, y);
    else if (t === TERRAIN.SOIL) {
      const fz = g.zone[i] === ZONE.FIELD || g.zone[i] === ZONE.VEGGARDEN;
      const fx = g.zone[i] === ZONE.FLAX;
      if (fx && seasonIdx === 0) blitG(sprites.flaxSown, x, y);
      else if (fx && seasonIdx === 1) blitG(sprites.flaxGrown, x, y);
      else if (fx && seasonIdx === 2) blitG(sprites.flaxRipe, x, y);
      else if (fz && seasonIdx === 0) blitG(sprites.soilSown, x, y);        // spring: sown
      else if (fz && seasonIdx === 1) blitG(sprites.soilGrown, x, y); // summer: green
      else if (fz && seasonIdx === 2) blitG(sprites.soilRipe, x, y);  // autumn: ripe
      else if (seasonIdx === 3) blitG(sprites.soilWinter, x, y);      // winter: frozen
      else blitG(sprites.soil, x, y);
      // Veggarden row markers: narrow bed dividers + small plant rounds distinguish from grain fields
      if (g.zone[i] === ZONE.VEGGARDEN && seasonIdx !== 3) {
        ctx.fillStyle = 'rgba(55,35,12,0.25)';
        ctx.fillRect(x*px + Math.round(px*0.33), y*px, 1, px);
        ctx.fillRect(x*px + Math.round(px*0.66), y*px, 1, px);
        if (seasonIdx === 1) { // summer: green cabbage/lettuce heads
          ctx.fillStyle = 'rgba(40,118,35,0.88)';
          ctx.beginPath(); ctx.arc(x*px + Math.round(px*0.17), y*px + Math.round(px*0.5), 3, 0, Math.PI*2); ctx.fill();
          ctx.beginPath(); ctx.arc(x*px + Math.round(px*0.50), y*px + Math.round(px*0.5), 3, 0, Math.PI*2); ctx.fill();
          ctx.beginPath(); ctx.arc(x*px + Math.round(px*0.83), y*px + Math.round(px*0.5), 3, 0, Math.PI*2); ctx.fill();
        } else if (seasonIdx === 2) { // autumn: amber heads + ripe root veg
          ctx.fillStyle = 'rgba(148,88,20,0.85)';
          ctx.beginPath(); ctx.arc(x*px + Math.round(px*0.17), y*px + Math.round(px*0.5), 3, 0, Math.PI*2); ctx.fill();
          ctx.beginPath(); ctx.arc(x*px + Math.round(px*0.50), y*px + Math.round(px*0.5), 3, 0, Math.PI*2); ctx.fill();
          ctx.beginPath(); ctx.arc(x*px + Math.round(px*0.83), y*px + Math.round(px*0.5), 3, 0, Math.PI*2); ctx.fill();
          ctx.fillStyle = 'rgba(188,38,22,0.90)'; // red root vegetables
          ctx.fillRect(x*px + Math.round(px*0.17) - 1, y*px + Math.round(px*0.68), 2, 2);
          ctx.fillRect(x*px + Math.round(px*0.50) - 1, y*px + Math.round(px*0.68), 2, 2);
          ctx.fillRect(x*px + Math.round(px*0.83) - 1, y*px + Math.round(px*0.68), 2, 2);
        }
      }
    }
    else if (t === TERRAIN.ROCK) { const rv = ((x * 1664525 ^ y * 22695477) >>> 29) % 3; blitG((g.ore[i] ? sprites.rockMarked : sprites.rock)[rv], x, y); }
    else if (t === TERRAIN.SAND) blitG(sprites.sand[((x * 1664525 ^ y * 22695477) >>> 29) % 4], x, y);
    else {
      const grassSet = seasonIdx === 3 ? sprites.grassWinter : seasonIdx === 2 ? sprites.grassAutumn : seasonIdx === 0 ? sprites.grassSpring : sprites.grass;
      blitG(grassSet[((x * 1664525 ^ y * 22695477) >>> 30) % 4], x, y);
      // Orchard tile: small fruit-tree overlay that changes by season
      if (g.zone[i] === ZONE.ORCHARD) {
        const ocx = (x + 0.5) * px, ocy = (y + 0.42) * px;
        const or2 = px * 0.32;
        if (seasonIdx === 0) { // spring: pink blossom canopy
          ctx.fillStyle = 'rgba(220,120,160,0.75)';
          ctx.beginPath(); ctx.arc(ocx, ocy, or2, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = 'rgba(255,210,230,0.55)';
          ctx.beginPath(); ctx.arc(ocx - or2*0.3, ocy - or2*0.3, or2*0.55, 0, Math.PI * 2); ctx.fill();
        } else if (seasonIdx === 1) { // summer: dense green canopy + fruit dots
          ctx.fillStyle = 'rgba(40,120,30,0.80)';
          ctx.beginPath(); ctx.arc(ocx, ocy, or2, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = 'rgba(70,160,50,0.60)';
          ctx.beginPath(); ctx.arc(ocx - or2*0.3, ocy - or2*0.3, or2*0.55, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = 'rgba(210,50,30,0.90)'; // small fruit dots
          ctx.fillRect(ocx - 2, ocy + 1, 2, 2); ctx.fillRect(ocx + 2, ocy - 1, 2, 2);
        } else if (seasonIdx === 2) { // autumn: orange-amber, heavy with fruit
          ctx.fillStyle = 'rgba(160,80,20,0.75)';
          ctx.beginPath(); ctx.arc(ocx, ocy, or2, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = 'rgba(210,120,30,0.60)';
          ctx.beginPath(); ctx.arc(ocx - or2*0.3, ocy - or2*0.3, or2*0.55, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = 'rgba(220,60,30,0.95)'; // ripe fruit
          ctx.fillRect(ocx - 3, ocy, 2, 2); ctx.fillRect(ocx + 1, ocy - 2, 2, 2); ctx.fillRect(ocx, ocy + 2, 2, 2);
        } else { // winter: bare mini-trunk + twig lines
          ctx.fillStyle = 'rgba(90,60,30,0.80)';
          ctx.fillRect(Math.round(ocx - 1), Math.round(ocy - or2 * 0.5), 2, Math.round(or2 * 1.5));
          ctx.fillRect(Math.round(ocx - or2), Math.round(ocy - or2 * 0.1), Math.round(or2 * 2), 1);
          ctx.fillRect(Math.round(ocx - or2 * 0.6), Math.round(ocy - or2 * 0.5), Math.round(or2 * 1.2), 1);
        }
        // Trunk stub (all seasons)
        ctx.fillStyle = 'rgba(80,50,20,0.80)';
        ctx.fillRect(Math.round(ocx - 1), Math.round(ocy + or2 * 0.6), 2, Math.round(px * 0.18));
      }
    }
    if (t === TERRAIN.TREE) {
      const treeSpr = seasonIdx === 3 ? sprites.treeWinter : seasonIdx === 2 ? sprites.treeAutumn : seasonIdx === 0 ? sprites.treeSpring : sprites.tree;
      // Render at native sprite scale (40×44 drawn at sprite-TILE=32) so the canopy
      // overhangs the tile boundary — trunk base stays anchored to the tile bottom.
      const tW = Math.round(treeSpr.width * px / 32);
      const tH = Math.round(treeSpr.height * px / 32);
      ctx.drawImage(treeSpr, x * px - (tW - px) / 2, y * px - (tH - px), tW, tH);
    }

    // Shore transitions: foam strip on water tiles touching land; wet-sand darkening on land tiles touching water.
    if (t === TERRAIN.WATER) {
      // In winter: shore ice instead of foam
      if (seasonIdx === 3) {
        ctx.fillStyle = 'rgba(220,235,248,0.65)'; // ice rim
        if (y > 0     && g.terrain[(y-1)*MAP+x] !== TERRAIN.WATER) { ctx.fillRect(x*px, y*px, px, 3); ctx.fillStyle='rgba(240,248,255,0.55)'; ctx.fillRect(x*px, y*px, px, 1); ctx.fillStyle='rgba(220,235,248,0.65)'; }
        if (y < MAP-1 && g.terrain[(y+1)*MAP+x] !== TERRAIN.WATER) { ctx.fillRect(x*px, (y+1)*px-3, px, 3); ctx.fillStyle='rgba(240,248,255,0.55)'; ctx.fillRect(x*px, (y+1)*px-1, px, 1); ctx.fillStyle='rgba(220,235,248,0.65)'; }
        if (x < MAP-1 && g.terrain[y*MAP+(x+1)] !== TERRAIN.WATER) { ctx.fillRect((x+1)*px-3, y*px, 3, px); }
        if (x > 0     && g.terrain[y*MAP+(x-1)] !== TERRAIN.WATER) { ctx.fillRect(x*px, y*px, 3, px); }
      } else {
        ctx.fillStyle = 'rgba(200,225,245,0.40)'; // surf foam
        if (y > 0     && g.terrain[(y-1)*MAP+x] !== TERRAIN.WATER) ctx.fillRect(x*px, y*px, px, 2);
        if (y < MAP-1 && g.terrain[(y+1)*MAP+x] !== TERRAIN.WATER) ctx.fillRect(x*px, (y+1)*px-2, px, 2);
        if (x < MAP-1 && g.terrain[y*MAP+(x+1)] !== TERRAIN.WATER) ctx.fillRect((x+1)*px-2, y*px, 2, px);
        if (x > 0     && g.terrain[y*MAP+(x-1)] !== TERRAIN.WATER) ctx.fillRect(x*px, y*px, 2, px);
        // Reed stalks at shore: 2 thin vertical lines per edge (non-winter)
        { const rh = ((x * 1664525) ^ (y * 22695477) ^ 7654321) >>> 0;
          if (y > 0 && g.terrain[(y-1)*MAP+x] !== TERRAIN.WATER) {
            for (let r = 0; r < 2; r++) { const sx = x*px + 4 + ((rh >>> (r*11)) & 0xf) % (px - 8); const sh = 4 + ((rh >>> (r*7+4)) & 3);
              ctx.fillStyle = '#3a5820'; ctx.fillRect(sx, y*px + 2, 1, sh); ctx.fillStyle = '#5c3018'; ctx.fillRect(sx, y*px + 2, 1, 2); }
          }
          if (y < MAP-1 && g.terrain[(y+1)*MAP+x] !== TERRAIN.WATER) {
            for (let r = 0; r < 2; r++) { const sx = x*px + 4 + ((rh >>> (r*11+3)) & 0xf) % (px - 8); const sh = 4 + ((rh >>> (r*7+8)) & 3);
              ctx.fillStyle = '#3a5820'; ctx.fillRect(sx, (y+1)*px - sh - 2, 1, sh); ctx.fillStyle = '#5c3018'; ctx.fillRect(sx, (y+1)*px - sh - 2, 1, 2); }
          }
          if (x > 0 && g.terrain[y*MAP+(x-1)] !== TERRAIN.WATER) {
            for (let r = 0; r < 2; r++) { const sy = y*px + 4 + ((rh >>> (r*11+6)) & 0xf) % (px - 8); const sh = 4 + ((rh >>> (r*7+12)) & 3);
              ctx.fillStyle = '#3a5820'; ctx.fillRect(x*px + 2, sy, 1, sh); ctx.fillStyle = '#5c3018'; ctx.fillRect(x*px + 2, sy, 1, 2); }
          }
          if (x < MAP-1 && g.terrain[y*MAP+(x+1)] !== TERRAIN.WATER) {
            for (let r = 0; r < 2; r++) { const sy = y*px + 4 + ((rh >>> (r*11+9)) & 0xf) % (px - 8); const sh = 4 + ((rh >>> (r*7+16)) & 3);
              ctx.fillStyle = '#3a5820'; ctx.fillRect((x+1)*px - 4, sy, 1, sh); ctx.fillStyle = '#5c3018'; ctx.fillRect((x+1)*px - 4, sy, 1, 2); }
          }
        }
      }
    } else {
      const wN = y > 0     && g.terrain[(y-1)*MAP+x] === TERRAIN.WATER;
      const wS = y < MAP-1 && g.terrain[(y+1)*MAP+x] === TERRAIN.WATER;
      const wE = x < MAP-1 && g.terrain[y*MAP+(x+1)] === TERRAIN.WATER;
      const wW = x > 0     && g.terrain[y*MAP+(x-1)] === TERRAIN.WATER;
      if (wN || wS || wE || wW) {
        ctx.fillStyle = 'rgba(40,90,150,0.20)'; // wet-shore darkening
        if (wN) ctx.fillRect(x*px, y*px, px, 3);
        if (wS) ctx.fillRect(x*px, (y+1)*px-3, px, 3);
        if (wE) ctx.fillRect((x+1)*px-3, y*px, 3, px);
        if (wW) ctx.fillRect(x*px, y*px, 3, px);
      }
      // Grass↔sand edge blend: warm sandy transition strip
      if (t === TERRAIN.GRASS || t === TERRAIN.SAND) {
        const other = t === TERRAIN.GRASS ? TERRAIN.SAND : TERRAIN.GRASS;
        const col = t === TERRAIN.GRASS ? 'rgba(195,165,60,0.35)' : 'rgba(80,140,50,0.30)';
        ctx.fillStyle = col;
        if (y > 0     && g.terrain[(y-1)*MAP+x] === other) ctx.fillRect(x*px, y*px, px, 3);
        if (y < MAP-1 && g.terrain[(y+1)*MAP+x] === other) ctx.fillRect(x*px, (y+1)*px-3, px, 3);
        if (x < MAP-1 && g.terrain[y*MAP+(x+1)] === other) ctx.fillRect((x+1)*px-3, y*px, 3, px);
        if (x > 0     && g.terrain[y*MAP+(x-1)] === other) ctx.fillRect(x*px, y*px, 3, px);
      }
      // Grass↔soil edge blend: dark earth peek at ploughed field edges
      if (t === TERRAIN.GRASS || t === TERRAIN.SOIL) {
        const other2 = t === TERRAIN.GRASS ? TERRAIN.SOIL : TERRAIN.GRASS;
        const col2 = t === TERRAIN.GRASS ? 'rgba(120,75,30,0.28)' : 'rgba(60,120,40,0.22)';
        ctx.fillStyle = col2;
        if (y > 0     && g.terrain[(y-1)*MAP+x] === other2) ctx.fillRect(x*px, y*px, px, 2);
        if (y < MAP-1 && g.terrain[(y+1)*MAP+x] === other2) ctx.fillRect(x*px, (y+1)*px-2, px, 2);
        if (x < MAP-1 && g.terrain[y*MAP+(x+1)] === other2) ctx.fillRect((x+1)*px-2, y*px, 2, px);
        if (x > 0     && g.terrain[y*MAP+(x-1)] === other2) ctx.fillRect(x*px, y*px, 2, px);
      }
      // Rock↔grass edge: shadow fringe on grass side where rock looms
      if (t === TERRAIN.GRASS && (
        (y > 0     && g.terrain[(y-1)*MAP+x] === TERRAIN.ROCK) ||
        (y < MAP-1 && g.terrain[(y+1)*MAP+x] === TERRAIN.ROCK) ||
        (x > 0     && g.terrain[y*MAP+(x-1)] === TERRAIN.ROCK) ||
        (x < MAP-1 && g.terrain[y*MAP+(x+1)] === TERRAIN.ROCK)
      )) {
        ctx.fillStyle = 'rgba(50,45,40,0.20)';
        if (y > 0     && g.terrain[(y-1)*MAP+x] === TERRAIN.ROCK) ctx.fillRect(x*px, y*px, px, 3);
        if (y < MAP-1 && g.terrain[(y+1)*MAP+x] === TERRAIN.ROCK) ctx.fillRect(x*px, (y+1)*px-3, px, 3);
        if (x > 0     && g.terrain[y*MAP+(x-1)] === TERRAIN.ROCK) ctx.fillRect(x*px, y*px, 3, px);
        if (x < MAP-1 && g.terrain[y*MAP+(x+1)] === TERRAIN.ROCK) ctx.fillRect((x+1)*px-3, y*px, 3, px);
      }
      // Palisade wall shadow on ground tiles to the south/east of a wall
      if (!g.wall[i] && !g.gate[i]) {
        const wallN = y > 0     && (g.wall[(y-1)*MAP+x] || g.gate[(y-1)*MAP+x]);
        const wallW = x > 0     && (g.wall[y*MAP+(x-1)] || g.gate[y*MAP+(x-1)]);
        if (wallN || wallW) {
          ctx.fillStyle = 'rgba(30,25,15,0.22)';
          if (wallN) ctx.fillRect(x*px, y*px, px, 4);
          if (wallW) ctx.fillRect(x*px, y*px, 4, px);
        }
      }
    }

    // Sapling: scale by age so young trees are tiny and nearly mature ones are full-size.
    if (g.saplingAge[i] > 0) {
      const frac = Math.min(1, g.saplingAge[i] / TUNING.saplingGrowDays);
      const sz = Math.max(4, Math.round(px * (0.35 + frac * 0.65)));
      const off = (px - sz) >> 1;
      ctx.drawImage(sprites.sapling, x * px + off, y * px + off, sz, sz);
      // Winter: blue-white frost dusting on the sapling canopy
      if (seasonIdx === 3) {
        ctx.fillStyle = 'rgba(200,225,248,0.42)';
        ctx.fillRect(x * px + off, y * px + off, sz, Math.round(sz * 0.6));
      }
    }

    // Wild forage deposit: berry bush / mushroom cluster / herb patch sprite.
    if (g.forage[i]) {
      const fspr = sprites.forage[g.forage[i]];
      if (fspr) {
        if (seasonIdx === 3) ctx.globalAlpha = 0.62; // winter: dormant, sparse
        ctx.drawImage(fspr, x * px, y * px, px, px);
        ctx.globalAlpha = 1;
        if (seasonIdx === 3) { // frost dusting over dormant forage
          ctx.fillStyle = 'rgba(180,208,238,0.32)';
          ctx.fillRect(x * px, y * px, px, px);
        }
      }
    }

    // Zone outline + drought/flood tint + small resource icon in corner.
    if (g.zone[i]) {
      ctx.strokeStyle = ZONE_OUTLINE[g.zone[i]];
      ctx.strokeRect(x * px + 0.5, y * px + 0.5, px - 1, px - 1);
      // Tiny resource icon: top-right corner at ~30% tile size.
      const zdef = ZONE_DEFS[g.zone[i]];
      const zicon = zdef && (sprites.items as Record<string, CanvasImageSource>)[zdef.resource];
      if (zicon) {
        const isz = Math.max(4, px * 0.3);
        ctx.globalAlpha = 0.7;
        ctx.drawImage(zicon, (x + 1) * px - isz - 1, y * px + 1, isz, isz);
        ctx.globalAlpha = 1;
      }
    }
    if ((g.zone[i] === ZONE.FIELD || g.zone[i] === ZONE.FLAX) && droughtOrFlood !== 0) {
      ctx.fillStyle = droughtOrFlood > 0 ? '#4488bb28' : '#8b451328';
      ctx.fillRect(x * px, y * px, px, px);
    }

    // Floor with room-specific tile + tint
    if (g.floor[i]) {
      const roomDef = ROOM_DEF_BY_NUM[g.roomId[i]];
      const floorSpr = (roomDef && sprites.roomFloors[roomDef.id]) ?? sprites.interiorFloor;
      blit(floorSpr, x, y);
      if (roomDef) {
        const color = ROOM_COLORS[roomDef.id];
        if (color) {
          ctx.fillStyle = color + '33'; // ~20% tint (slightly reduced from 44 since floor is already distinctive)
          ctx.fillRect(x * px, y * px, px, px);
        }
      }
    }

    // Road / bridge overlay — rotate 90° for E-W dominant segments so ruts/planks align
    if (g.road[i]) {
      const rt = g.road[i];
      const roadNames = ['', 'dirt', 'plank', 'gravel', 'bridge'];
      const rImg = sprites.roads[roadNames[rt]];
      if (rImg) {
        const nsConn = ((y > 0     && g.road[(y-1)*MAP+x] === rt) ? 1 : 0)
                     + ((y < MAP-1 && g.road[(y+1)*MAP+x] === rt) ? 1 : 0);
        const ewConn = ((x > 0     && g.road[y*MAP+(x-1)] === rt) ? 1 : 0)
                     + ((x < MAP-1 && g.road[y*MAP+(x+1)] === rt) ? 1 : 0);
        if (ewConn > nsConn) {
          ctx.save();
          ctx.translate(x * px + px / 2, y * px + px / 2);
          ctx.rotate(Math.PI / 2);
          ctx.drawImage(rImg, -px / 2, -px / 2, px, px);
          ctx.restore();
        } else {
          blit(rImg, x, y);
        }
      }
    }

    if (g.gate[i]) {
      // Connected gate: use gateVariants with N/E/S/W wall-or-gate bitmask
      const gm = (g.inBounds(x, y-1) && (g.wall[g.index(x,y-1)] || g.gate[g.index(x,y-1)]) ? 1 : 0)
               | (g.inBounds(x+1,y) && (g.wall[g.index(x+1,y)] || g.gate[g.index(x+1,y)]) ? 2 : 0)
               | (g.inBounds(x, y+1) && (g.wall[g.index(x,y+1)] || g.gate[g.index(x,y+1)]) ? 4 : 0)
               | (g.inBounds(x-1,y) && (g.wall[g.index(x-1,y)] || g.gate[g.index(x-1,y)]) ? 8 : 0);
      blit(sprites.gateVariants[gm] ?? sprites.gate, x, y);
      if (seasonIdx === 3) { ctx.fillStyle = 'rgba(210,230,250,0.72)'; ctx.fillRect(x*px+1, y*px, px-2, 3); ctx.fillStyle = 'rgba(240,248,255,0.50)'; ctx.fillRect(x*px+2, y*px, px-4, 1); }
    } else if (g.wall[i]) {
      // Connected palisade: bitmask encodes which cardinal neighbors are also walls/gates
      const wm = (g.inBounds(x, y-1) && (g.wall[g.index(x,y-1)] || g.gate[g.index(x,y-1)]) ? 1 : 0)
               | (g.inBounds(x+1,y) && (g.wall[g.index(x+1,y)] || g.gate[g.index(x+1,y)]) ? 2 : 0)
               | (g.inBounds(x, y+1) && (g.wall[g.index(x,y+1)] || g.gate[g.index(x,y+1)]) ? 4 : 0)
               | (g.inBounds(x-1,y) && (g.wall[g.index(x-1,y)] || g.gate[g.index(x-1,y)]) ? 8 : 0);
      blit(sprites.palisadeVariants[wm] ?? sprites.palisade, x, y);
      if (seasonIdx === 3) { ctx.fillStyle = 'rgba(210,230,250,0.72)'; ctx.fillRect(x*px+1, y*px, px-2, 3); ctx.fillStyle = 'rgba(240,248,255,0.50)'; ctx.fillRect(x*px+2, y*px, px-4, 1); }
    }
  }

  // Tree cast shadow pass — batched after all terrain tiles so shadows land on top
  { ctx.fillStyle = 'rgba(20,18,12,0.16)';
    ctx.beginPath();
    for (let y = vy0; y < vy1; y++) for (let x = vx0; x < vx1; x++) {
      if (g.terrain[y * MAP + x] === TERRAIN.TREE) {
        ctx.ellipse((x + 0.58) * px, (y + 1) * px + px * 0.07, px * 0.60, px * 0.17, 0, 0, Math.PI * 2);
      }
    }
    ctx.fill();
  }

  // Water shimmer pass — bright pixel flashes on water surface at tick-driven positions
  if (seasonIdx !== 3) {
    const shTick = core.tickNo;
    ctx.beginPath();
    for (let n = 0; n < 48; n++) {
      const nx = ((n * 1013904223 + shTick * 3) ^ (n * 22695477)) >>> 0;
      const ny = ((n * 1664525 + shTick * 7) ^ (n * 1013904223)) >>> 0;
      const tx = nx % MAP, ty = ny % MAP;
      if (g.terrain[ty * MAP + tx] !== TERRAIN.WATER) continue;
      if (((shTick + n * 13) % 9) > 2) continue; // flash 3 of every 9 ticks
      ctx.rect(tx * px + (nx & 0x1f), ty * px + (ny & 0x1f), 2, 1);
    }
    ctx.fillStyle = 'rgba(200,235,255,0.72)';
    ctx.fill();
  }

  // Spike traps (rendered as a red X over the tile)
  ctx.strokeStyle = '#cc2222';
  ctx.lineWidth = 1;
  for (let y = vy0; y < vy1; y++) for (let x = vx0; x < vx1; x++) {
    if (g.trap[y * MAP + x]) {
      ctx.beginPath();
      ctx.moveTo(x * px + 2, y * px + 2); ctx.lineTo((x + 1) * px - 2, (y + 1) * px - 2);
      ctx.moveTo((x + 1) * px - 2, y * px + 2); ctx.lineTo(x * px + 2, (y + 1) * px - 2);
      ctx.stroke();
    }
  }

  // Station cast shadows — ground shadow ellipses pass (drawn before sprites)
  ctx.fillStyle = 'rgba(28,22,15,0.18)';
  for (const sv of stationList) {
    const def = STATION_DEF_BY_NUM[sv.typeId];
    if (!def) continue;
    const scx = (sv.x + def.w / 2 + 0.25) * px;
    const scy = (sv.y + def.h + 0.12) * px;
    ctx.beginPath(); ctx.ellipse(scx, scy, def.w * px * 0.52, def.h * px * 0.16, 0, 0, Math.PI * 2); ctx.fill();
  }

  // Stations — blit at the full tile footprint (multi-tile stations span def.w × def.h tiles).
  for (const sv of stationList) {
    const def = STATION_DEF_BY_NUM[sv.typeId];
    // Footprint-aware cull: keep the station if either corner is on screen, so
    // multi-tile stations straddling the viewport edge don't pop.
    if (!onScreen(sv.x, sv.y) && !onScreen(sv.x + (def?.w ?? 1) - 1, sv.y + (def?.h ?? 1) - 1)) continue;
    const img = def && sprites.stations[def.id];
    if (img) ctx.drawImage(img, sv.x * px, sv.y * px, def!.w * px, def!.h * px);
    else if (def) { // generic marker fallback
      ctx.fillStyle = '#6a5030'; ctx.fillRect(sv.x * px + 1, sv.y * px + 1, def.w * px - 2, def.h * px - 2);
      ctx.fillStyle = '#e8d8b0'; ctx.fillText(def.name[0], sv.x * px + px * 0.35, sv.y * px + px * 0.7);
    }
    // Winter: snow cap on building roof (top edge)
    if (def && seasonIdx === 3) {
      const bw = def.w * px;
      ctx.fillStyle = 'rgba(205,228,250,0.70)';
      ctx.fillRect(sv.x * px + 1, sv.y * px, bw - 2, 3);
      ctx.fillStyle = 'rgba(240,248,255,0.52)';
      ctx.fillRect(sv.x * px + 2, sv.y * px, bw - 4, 1);
    }
    // Production progress bar: tiny green strip at the bottom of the station
    if (sv.workMax > 0 && sv.progress > 0) {
      const frac = Math.min(1, sv.progress / sv.workMax);
      const bw = def ? def.w * px - 4 : px - 4;
      ctx.fillStyle = '#1a1a1a88';
      ctx.fillRect(sv.x * px + 2, (sv.y + (def?.h ?? 1)) * px - 4, bw, 3);
      ctx.fillStyle = frac > 0.8 ? '#ffcc00' : '#44cc44';
      ctx.fillRect(sv.x * px + 2, (sv.y + (def?.h ?? 1)) * px - 4, Math.round(bw * frac), 3);
    }
    // Smoke / steam above fire stations that are actively producing
    if (sv.progress > 0 && def && SMOKE_STATIONS.has(def.id)) {
      const tick = core.tickNo;
      const cx = (sv.x + def.w / 2) * px;
      const top = sv.y * px;
      for (let p = 0; p < 3; p++) {
        const phase = ((tick + p * 7) % 18) / 18;
        const py = top - phase * px * 1.2;
        const ox = Math.sin((tick * 0.18 + p * 2.1)) * px * 0.22;
        const alpha = 0.45 * (1 - phase);
        ctx.fillStyle = `rgba(200,200,200,${alpha.toFixed(2)})`;
        const r = Math.max(1, px * (0.1 + phase * 0.12));
        ctx.beginPath(); ctx.arc(cx + ox, py, r, 0, Math.PI * 2); ctx.fill();
      }
    }
    // Sparks — bright orange/yellow pixels flying up from forge stations
    if (sv.progress > 0 && def && SPARK_STATIONS.has(def.id)) {
      const tick = core.tickNo;
      const cx = (sv.x + def.w / 2) * px;
      const base = (sv.y + def.h) * px;
      for (let p = 0; p < 6; p++) {
        const phase = ((tick * 2 + p * 5) % 14) / 14;
        if (phase > 0.7) continue; // only show early in arc
        const ox = Math.sin((p * 1.7 + tick * 0.3)) * px * 0.55 * phase;
        const oy = -phase * px * 0.9;
        const a = 0.9 * (1 - phase / 0.7);
        const col = phase < 0.3 ? `rgba(255,220,80,${a.toFixed(2)})` : `rgba(255,120,20,${a.toFixed(2)})`;
        ctx.fillStyle = col;
        ctx.fillRect(Math.round(cx + ox), Math.round(base + oy), 2, 2);
      }
    }
  }

  // Agents (animate: alternate walk frames every 6 ticks)
  const settlerFrame = (core.tickNo / 6 | 0) % 2;
  const a = core.agents;
  // Y-sort so units lower on screen draw over those above (painter's algorithm).
  // Rebuild the reused index buffer in place rather than allocating per frame.
  agentOrder.length = a.count;
  for (let i = 0; i < a.count; i++) agentOrder[i] = i;
  agentOrder.sort((ia, ib) => a.posY[ia] - a.posY[ib]);
  for (const i of agentOrder) {
    if (!onScreen(a.posX[i], a.posY[i])) continue;
    const variant = i % sprites.settler.length;
    const frame = a.state[i] === AState.Sleeping ? 0 : settlerFrame;
    // Draw settlers 35% taller than a tile, anchored to the tile bottom (head pokes up).
    const spr = (a.armed[i] ? sprites.settlerArmed : sprites.settler)[variant][frame];
    const sH = Math.round(px * 1.35);
    const sax = a.posX[i] * px, say = a.posY[i] * px - (sH - px);
    // Ground shadow ellipse
    ctx.fillStyle = 'rgba(28,20,12,0.22)';
    ctx.beginPath(); ctx.ellipse(sax + px * 0.5, (a.posY[i] + 1) * px - 1, px * 0.38, px * 0.12, 0, 0, Math.PI * 2); ctx.fill();
    // Flip sprite horizontally when moving left
    if (!isNaN(a.destX[i]) && a.destX[i] < a.posX[i] - 0.1) {
      ctx.save(); ctx.translate(sax + px, say); ctx.scale(-1, 1);
      ctx.drawImage(spr, 0, 0, px, sH); ctx.restore();
    } else {
      ctx.drawImage(spr, sax, say, px, sH);
    }
    // Mood tint: miserable settlers have a subtle red overlay, very happy ones green.
    const mood = a.mood[i];
    if (mood < -10) {
      ctx.fillStyle = `rgba(220,40,40,${Math.min(0.45, (-mood - 10) * 0.008)})`;
      ctx.fillRect(a.posX[i] * px, a.posY[i] * px, px, px);
    } else if (mood > 60) {
      ctx.fillStyle = `rgba(60,220,80,${Math.min(0.25, (mood - 60) * 0.004)})`;
      ctx.fillRect(a.posX[i] * px, a.posY[i] * px, px, px);
    }
    if (a.woundUntreated[i]) {
      ctx.strokeStyle = '#ff4040';
      ctx.strokeRect(a.posX[i] * px, a.posY[i] * px, px, px);
    }
    // Health bar under any settler who's taken damage
    if (a.health[i] < 98) {
      const hpFrac = Math.max(0, a.health[i]) / 100;
      ctx.fillStyle = '#1a1a1a88';
      ctx.fillRect(a.posX[i] * px + 1, (a.posY[i] + 1) * px - 3, px - 2, 2);
      ctx.fillStyle = hpFrac > 0.6 ? '#44cc44' : hpFrac > 0.35 ? '#ccaa22' : '#cc2222';
      ctx.fillRect(a.posX[i] * px + 1, (a.posY[i] + 1) * px - 3, Math.round((px - 2) * hpFrac), 2);
    }
    if (a.sickUntilTick[i] > core.tickNo) {
      ctx.fillStyle = '#ddcc00';
      ctx.fillText('~', a.posX[i] * px + px - 4, a.posY[i] * px + px);
    }
    if (a.state[i] === AState.Sleeping) {
      ctx.fillStyle = '#5aa0ff';
      ctx.fillText('z', a.posX[i] * px + px, a.posY[i] * px);
    }
    // Highlight inspected settler
    if (inspected && a.posX[i] === inspected.x && a.posY[i] === inspected.y) {
      ctx.strokeStyle = '#ffff00';
      ctx.lineWidth = 2;
      ctx.strokeRect(a.posX[i] * px - 1, a.posY[i] * px - 1, px + 2, px + 2);
      ctx.lineWidth = 1;
    }
  }

  // Deer — 1.25× tile, centered horizontally, slightly taller
  const deerFrame = (performance.now() / 400 | 0) % sprites.deer.length;
  { const dW = Math.round(px * 1.25), dH = Math.round(px * 1.15);
    for (const d of core.deerViews()) {
      if (!onScreen(d.x | 0, d.y | 0)) continue;
      const dx = (d.x | 0) * px - (dW - px) / 2, dy = (d.y | 0) * px - (dH - px);
      ctx.fillStyle = 'rgba(28,20,12,0.18)';
      ctx.beginPath(); ctx.ellipse((d.x | 0) * px + px * 0.5, (d.y | 0 + 1) * px - 1, px * 0.44, px * 0.11, 0, 0, Math.PI * 2); ctx.fill();
      ctx.drawImage(sprites.deer[deerFrame], dx, dy, dW, dH);
    }
  }

  // Raiders — same oversized rendering as settlers, y-sorted
  const sortedRaiders = [...core.raids.raiders].sort((a2, b2) => a2.y - b2.y);
  for (const r of sortedRaiders) {
    if (!onScreen(r.x, r.y)) continue;
    const rSpr = sprites.raider[r.fleeing ? 0 : (performance.now() / 200 | 0) % sprites.raider.length];
    const rH = Math.round(px * 1.35);
    const rax = r.x * px, ray = r.y * px - (rH - px);
    ctx.fillStyle = 'rgba(28,20,12,0.22)';
    ctx.beginPath(); ctx.ellipse(rax + px * 0.5, r.y * px + px - 1, px * 0.38, px * 0.12, 0, 0, Math.PI * 2); ctx.fill();
    // Flip when raider is to the right of center (approaching from east, moving west)
    const facingLeft = r.fleeing ? r.x < MAP / 2 : r.x > MAP / 2;
    if (facingLeft) {
      ctx.save(); ctx.translate(rax + px, ray); ctx.scale(-1, 1);
      ctx.drawImage(rSpr, 0, 0, px, rH); ctx.restore();
    } else {
      ctx.drawImage(rSpr, rax, ray, px, rH);
    }
  }

  // Wolves — 1.2× tile, centered, slightly taller
  if (core.wolves.active) {
    const wolfFrame = (performance.now() / 250 | 0) % sprites.wolf.length;
    const wW = Math.round(px * 1.2), wH = Math.round(px * 1.2);
    for (const w of core.wolves.wolves) {
      if (!onScreen(w.x | 0, w.y | 0)) continue;
      const wwx = (w.x | 0) * px - (wW - px) / 2, wwy = (w.y | 0) * px - (wH - px);
      ctx.fillStyle = 'rgba(28,20,12,0.20)';
      ctx.beginPath(); ctx.ellipse((w.x | 0) * px + px * 0.5, (w.y | 0 + 1) * px - 1, px * 0.40, px * 0.11, 0, 0, Math.PI * 2); ctx.fill();
      ctx.drawImage(sprites.wolf[w.leaving ? 0 : wolfFrame], wwx, wwy, wW, wH);
    }
  }

  // Blueprint ghosts — wall plan uses sprite; floors/stations get a dashed blue outline.
  ctx.strokeStyle = '#88aaff'; ctx.setLineDash([2, 2]);
  for (const o of core.builds) {
    if (o.kind === 'wall') blit(sprites.wallPlan, o.x, o.y);
    else if (o.kind === 'floor') {
      ctx.fillStyle = 'rgba(160,200,255,0.15)';
      ctx.fillRect(o.x * px, o.y * px, px, px);
      ctx.strokeRect(o.x * px + 1, o.y * px + 1, px - 2, px - 2);
    } else { // station
      ctx.strokeStyle = '#ffcc44';
      ctx.strokeRect(o.x * px + 1, o.y * px + 1, px - 2, px - 2);
    }
  }
  ctx.setLineDash([]);

  // Blueprint stamp preview: semi-transparent footprint at hover tile.
  if (tool === 'blueprint' && hoverX >= 0 && hoverY >= 0) {
    const bp = BLUEPRINT_DEFS[blueprintIdx];
    ctx.fillStyle = 'rgba(100,160,255,0.18)';
    ctx.strokeStyle = 'rgba(100,160,255,0.7)';
    ctx.lineWidth = 1;
    ctx.fillRect(hoverX * px, hoverY * px, bp.w * px, bp.h * px);
    ctx.strokeRect(hoverX * px + 0.5, hoverY * px + 0.5, bp.w * px - 1, bp.h * px - 1);
    ctx.lineWidth = 1;
  }

  // Day/night cycle: tickNo within the day drives a night darkness overlay.
  // Night = roughly 10pm–5am (day fraction 0.77–1.0 + 0.0–0.21).
  let nightAlpha = 0;
  { const TICKS_PER_DAY = MINUTES_PER_DAY / MINUTES_PER_TICK;
    const frac = (core.tickNo % TICKS_PER_DAY) / TICKS_PER_DAY;
    // Ramp: 0 at 6am (0.25), peak at midnight (0.0/1.0), 0 at 6pm (0.75).
    // Use a cosine to get a smooth bell (peak=1 at frac=0/1, zero at frac=0.5).
    nightAlpha = Math.max(0, Math.cos(frac * 2 * Math.PI)) * 0.35;
    if (nightAlpha > 0.01) {
      ctx.fillStyle = `rgba(10,15,40,${nightAlpha.toFixed(2)})`;
      ctx.fillRect(0, 0, MAP * px, MAP * px);
    }
    // Warm candlelight wash from inhabited enclosed rooms when dark.
    // ponytail: flat rect per tile, no gradient. Good enough at this scale.
    if (nightAlpha > 0.08) {
      ctx.fillStyle = `rgba(255,190,60,${(nightAlpha * 0.28).toFixed(2)})`;
      for (let ty = vy0; ty < vy1; ty++) for (let tx = vx0; tx < vx1; tx++) {
        const i = ty * MAP + tx;
        if (!g.floor[i]) continue;
        const roomDef = ROOM_DEF_BY_NUM[g.roomId[i]];
        if (roomDef?.enclosedRequired) ctx.fillRect(tx * px, ty * px, px, px);
      }
    }
  }

  // Fish jumps — brief silvery arcs above non-winter water tiles
  if (seasonIdx !== 3) {
    const tick3 = core.tickNo;
    const g3 = core.grid;
    ctx.fillStyle = 'rgba(180,210,235,0.85)';
    for (let n = 0; n < 12; n++) {
      const cycle = 60 + (n % 4) * 20; // stagger jump cycles
      const phase = (tick3 + n * 31) % cycle;
      if (phase > 8) continue; // only 8 ticks of the cycle are "jump"
      const fx = ((n * 1664525 + 33333) >>> 0) % MAP;
      const fy = ((n * 1013904223 + 55555) >>> 0) % MAP;
      if (g3.terrain[fy * MAP + fx] !== TERRAIN.WATER) continue;
      const h = Math.sin(phase / 8 * Math.PI) * px * 0.45;
      ctx.fillRect(fx * px + px * 0.45, fy * px + px * 0.5 - h, 2, 3);
    }
  }

  // Seasonal / weather overlays
  { const si = Math.floor((core.day % DAYS_PER_YEAR) / DAYS_PER_SEASON);
    const sky = core.weather.forDay(core.day).sky;
    const worldW = MAP * px, worldH = MAP * px;

    // Winter: cold-blue tint + snow
    if (si === 3) {
      ctx.fillStyle = '#4488bb16'; ctx.fillRect(0, 0, worldW, worldH);
      if (sky === 'snow') {
        const tick = core.tickNo;
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        for (let n = 0; n < 220; n++) {
          // Simple LCG seeded per particle+tick so snowflakes drift downward
          const px2 = (((n * 1664525 + tick * 7) ^ (n * 22695477)) >>> 0) % worldW;
          const py2 = (((n * 1013904223 + tick * 3) ^ (n * 1664525)) >>> 0) % worldH;
          ctx.fillRect(px2, py2, 2, 2);
        }
      }
    }
    // Summer: warm golden tint + drifting dust motes
    else if (si === 1) {
      ctx.fillStyle = '#ffdd0010'; ctx.fillRect(0, 0, worldW, worldH);
      const tick = core.tickNo;
      ctx.fillStyle = 'rgba(200,160,60,0.22)'; // warm amber dust
      for (let n = 0; n < 35; n++) {
        const dx = (((n * 1664525 + tick * 2) ^ (n * 22695477 + n * 3)) >>> 0) % worldW;
        const dy = (((n * 1013904223 + tick * 3) ^ (n * 1664525 + n * 9)) >>> 0) % worldH;
        ctx.fillRect(dx, dy, 1, 1);
      }
    }
    // Spring: fresh green-cool tint + drifting pollen and blossom petals
    else if (si === 0) {
      ctx.fillStyle = '#40c04010'; ctx.fillRect(0, 0, worldW, worldH);
      const tick = core.tickNo;
      // Blossom petals — pale pink/lavender, drift slowly diagonally
      ctx.fillStyle = '#e8d8f4';
      for (let n = 0; n < 25; n++) {
        const fx = (((n * 1013904223 + tick + n * 3) ^ (n * 22695477)) >>> 0) % worldW;
        const fy = (((n * 1664525 + tick * 2 + n * 7) ^ (n * 1013904223)) >>> 0) % worldH;
        ctx.fillRect(fx, fy, 2, 2);
      }
      // Pollen — tiny yellow-white single pixels, more numerous, faster drift
      ctx.fillStyle = '#f8f4c0';
      for (let n = 0; n < 50; n++) {
        const px2 = (((n * 1664525 + tick * 4) ^ (n * 1013904223 + n * 11)) >>> 0) % worldW;
        const py2 = (((n * 22695477 + tick * 6) ^ (n * 1664525 + n * 3)) >>> 0) % worldH;
        ctx.fillRect(px2, py2, 1, 1);
      }
    }
    // Autumn: warm amber haze + falling leaf flecks
    else if (si === 2) {
      ctx.fillStyle = '#c8740010'; ctx.fillRect(0, 0, worldW, worldH);
      const tick = core.tickNo;
      const leafCols = ['#c84820', '#d86020', '#d4a030', '#e09020', '#c83820'];
      for (let n = 0; n < 90; n++) {
        const lx = (((n * 1664525 + tick * 3) ^ (n * 22695477)) >>> 0) % worldW;
        const ly = (((n * 1013904223 + tick * 9) ^ (n * 1664525)) >>> 0) % worldH;
        ctx.fillStyle = leafCols[n % 5];
        ctx.fillRect(lx, ly, 2, 2);
      }
    }

    // Rain or storm: diagonal rain streaks
    if (sky === 'rain' || sky === 'storm') {
      const count = sky === 'storm' ? 300 : 160;
      const alpha = sky === 'storm' ? 0.3 : 0.18;
      if (sky === 'storm') { ctx.fillStyle = `rgba(10,20,40,0.12)`; ctx.fillRect(0, 0, worldW, worldH); }
      ctx.strokeStyle = `rgba(130,180,220,${alpha})`;
      ctx.lineWidth = 1;
      const tick = core.tickNo;
      ctx.beginPath();
      for (let n = 0; n < count; n++) {
        const rx = (((n * 1664525 + tick * 5) ^ (n * 22695477)) >>> 0) % worldW;
        const ry = (((n * 1013904223 + tick * 11) ^ (n * 1664525)) >>> 0) % worldH;
        ctx.moveTo(rx, ry); ctx.lineTo(rx + 3, ry + 8);
      }
      ctx.stroke();
    }

    // Clouds: drifting across the world at varying speeds. Count & colour by sky.
    { const cloudCount = sky === 'clear' ? 3 : sky === 'overcast' ? 9 : sky === 'snow' ? 7 : 6;
      const cloudAlpha = sky === 'storm' ? 0.38 : sky === 'rain' ? 0.30 : sky === 'overcast' ? 0.28 : 0.20;
      const cloudColor = (sky === 'storm' || sky === 'rain') ? '80,85,100' : sky === 'snow' ? '210,218,228' : '240,244,250';
      ctx.save();
      ctx.globalAlpha = cloudAlpha;
      const tick2 = core.tickNo;
      for (let n = 0; n < cloudCount; n++) {
        const seed = n * 1013904223 + 99999;
        const baseX = ((seed >>> 0) % worldW);
        const cy2   = ((n * 1664525 + 5555) >>> 0) % worldH;
        const speed = 0.06 + (n % 3) * 0.04;
        const cx2   = ((baseX + Math.floor(tick2 * speed)) % worldW + worldW) % worldW;
        const rx2 = px * (3 + (n % 3));
        const ry2 = px * (1.4 + (n % 2) * 0.6);
        // Shadow underneath
        ctx.fillStyle = `rgba(40,50,80,0.15)`;
        ctx.beginPath(); ctx.ellipse(cx2 + px * 0.8, cy2 + px * 0.8, rx2 * 0.9, ry2 * 0.7, 0, 0, Math.PI * 2); ctx.fill();
        // Main body
        ctx.fillStyle = `rgba(${cloudColor},1)`;
        ctx.beginPath(); ctx.ellipse(cx2, cy2, rx2, ry2, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(cx2 - rx2 * 0.5, cy2 + ry2 * 0.2, rx2 * 0.65, ry2 * 0.75, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(cx2 + rx2 * 0.45, cy2 + ry2 * 0.3, rx2 * 0.6, ry2 * 0.7, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  }

  // Day/night cycle: 360 ticks per day. Dawn 0-45, day 45-270, dusk 270-315, night 315-360.
  { const TICKS_PER_DAY = MINUTES_PER_DAY / MINUTES_PER_TICK;
    const tod = (core.tickNo % TICKS_PER_DAY) / TICKS_PER_DAY; // 0=midnight, 0.5=noon
    let nightAlpha = 0;
    if (tod < 0.125) nightAlpha = 0.5 - tod * 4;          // midnight→dawn: 0.5→0
    else if (tod > 0.875) nightAlpha = (tod - 0.875) * 4; // dusk→midnight: 0→0.5
    else if (tod < 0.25) nightAlpha = (tod - 0.125) * 2.4 - 0.3; // dawn fade (negative = day)
    nightAlpha = Math.max(0, nightAlpha);
    if (nightAlpha > 0.02) {
      ctx.fillStyle = `rgba(8,12,40,${(nightAlpha * 0.7).toFixed(3)})`;
      ctx.fillRect(0, 0, MAP * px, MAP * px);
      // Stars — fixed positions, visible when night is dark enough
      if (nightAlpha > 0.25) {
        const starA = Math.min(1, (nightAlpha - 0.25) * 4);
        const worldW = MAP * px, worldH = MAP * px;
        for (let n = 0; n < 60; n++) {
          const sx = ((n * 1013904223) >>> 0) % worldW;
          const sy = ((n * 1664525 + 77777) >>> 0) % worldH;
          const twinkle = ((core.tickNo + n * 17) % 14) < 2 ? 0.4 : 1;
          ctx.fillStyle = `rgba(220,230,255,${(starA * twinkle * 0.6).toFixed(3)})`;
          ctx.fillRect(sx, sy, 1, 1);
          if (n % 8 === 0) { ctx.fillStyle = `rgba(255,245,220,${(starA * 0.7).toFixed(3)})`; ctx.fillRect(sx - 1, sy, 1, 1); ctx.fillRect(sx, sy - 1, 1, 1); }
        }
      }
    }
    // Golden dusk/dawn tint when transitioning
    const dawnDusk = tod < 0.25 ? Math.max(0, 0.22 - Math.abs(tod - 0.125) * 3.5)
                    : tod > 0.75 ? Math.max(0, 0.22 - Math.abs(tod - 0.875) * 3.5) : 0;
    if (dawnDusk > 0.01) {
      ctx.fillStyle = `rgba(255,160,40,${(dawnDusk * 0.35).toFixed(3)})`;
      ctx.fillRect(0, 0, MAP * px, MAP * px);
    }
    // Morning mist: ground fog that rises with the sun (spring & autumn strongest)
    const mistPeak = tod > 0.18 && tod < 0.34 ? Math.max(0, 1 - Math.abs(tod - 0.25) / 0.09) : 0;
    if (mistPeak > 0.01) {
      const mistBase = mistPeak * (seasonIdx === 0 || seasonIdx === 2 ? 0.09 : 0.05);
      const tick = core.tickNo;
      const worldW = MAP * px, worldH = MAP * px;
      ctx.fillStyle = `rgba(230,235,240,${(mistBase * 0.6).toFixed(3)})`;
      ctx.fillRect(0, 0, worldW, worldH);
      // Drifting mist wisps
      ctx.fillStyle = `rgba(240,243,248,${(mistBase * 0.8).toFixed(3)})`;
      for (let n = 0; n < 80; n++) {
        const wx = (((n * 1664525 + tick) ^ (n * 22695477)) >>> 0) % worldW;
        const wy = (((n * 1013904223 + tick * 2) ^ (n * 1664525)) >>> 0) % worldH;
        ctx.fillRect(wx, wy, 3, 1);
      }
    }
    // Summer fireflies at dusk and early night
    if (seasonIdx === 1 && (tod > 0.78 || tod < 0.14)) {
      const ffAlpha = Math.min(0.9, Math.min(
        tod > 0.78 ? (tod - 0.78) * 9 : 1,
        tod < 0.10 ? 1 : (0.14 - tod) * 20
      ));
      const tick = core.tickNo;
      const worldW = MAP * px, worldH = MAP * px;
      for (let n = 0; n < 18; n++) {
        const phase = ((tick * 3 + n * 47) % 28);
        if (phase > 10) continue; // off most of the time
        const fx = ((n * 1013904223 + tick % 7 * n) >>> 0) % worldW;
        const fy = ((n * 1664525 + tick % 5 * n * 3) >>> 0) % worldH;
        const fa = ffAlpha * (1 - phase / 10) * 0.85;
        ctx.fillStyle = `rgba(200,255,100,${fa.toFixed(3)})`;
        ctx.fillRect(fx, fy, 2, 2);
        ctx.fillStyle = `rgba(240,255,180,${(fa * 0.6).toFixed(3)})`;
        ctx.fillRect(fx, fy, 1, 1);
      }
    }
    // Fire station glow at night — warm orange halo drawn after the dark overlay
    if (nightAlpha > 0.04 && fireGlowPositions.length > 0) {
      const glowStrength = Math.min(1, nightAlpha * 3);
      ctx.globalCompositeOperation = 'screen';
      for (const { cx, cy } of fireGlowPositions) {
        const r = px * 3.5;
        for (let d = 0; d < 5; d++) {
          const frac = d / 5;
          const a = glowStrength * (0.12 - frac * 0.09);
          ctx.fillStyle = `rgba(255,${140 - d * 15},20,${a.toFixed(3)})`;
          const rr = r * (0.2 + frac * 0.8);
          ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    // Soft amber window glow from active non-fire stations at night
    if (nightAlpha > 0.08 && windowGlowPositions.length > 0) {
      const ws = Math.min(1, nightAlpha * 4);
      ctx.globalCompositeOperation = 'screen';
      for (const { cx, cy } of windowGlowPositions) {
        const r = px * 2.2;
        ctx.fillStyle = `rgba(255,200,80,${(ws * 0.055).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgba(255,220,120,${(ws * 0.03).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(cx, cy, r * 1.6, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  ctx.restore(); // leave world space — HUD overlays below are screen-space

  // Moon — screen-space atmospheric HUD element
  if (nightAlpha > 0.04) {
    const TPDAY = MINUTES_PER_DAY / MINUTES_PER_TICK;
    const frac2 = (core.tickNo % TPDAY) / TPDAY; // 0=midnight, 0.5=noon
    // Moon rises at 6pm (0.75), transits midnight (0/1), sets at 6am (0.25)
    const arc = frac2 > 0.75 ? (frac2 - 0.75) / 0.5 : (frac2 + 0.25) / 0.5;
    const mx = cw * 0.88 - arc * cw * 0.76;
    const my = 48 - Math.sin(arc * Math.PI) * 26;
    const mr = 10;
    const ma = Math.min(1, nightAlpha * 7);
    ctx.save();
    const mg = ctx.createRadialGradient(mx, my, 0, mx, my, mr * 3.5);
    mg.addColorStop(0, `rgba(200,205,170,${(ma * 0.2).toFixed(3)})`);
    mg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = mg; ctx.beginPath(); ctx.arc(mx, my, mr * 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgba(238,234,205,${ma.toFixed(3)})`;
    ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.fill();
    // Mare (grey blotches) for surface detail
    ctx.fillStyle = `rgba(185,182,158,${(ma * 0.38).toFixed(3)})`;
    ctx.beginPath(); ctx.arc(mx - 3, my + 1, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(mx + 3, my - 2, 2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(mx + 2, my + 4, 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // ── Stats overlay (top-left) ────────────────────────────────────────────
  ctx.fillStyle = '#000a'; ctx.fillRect(0, 0, 340, 300);
  ctx.fillStyle = '#ddd'; ctx.font = '13px monospace';
  const line = (n: number, s: string, color = '#ddd') => { ctx.fillStyle = color; ctx.fillText(s, 8, 20 + n * 17); };

  const year = START_YEAR + Math.floor(core.day / DAYS_PER_YEAR);
  const dayOfSzn = (core.day % DAYS_PER_YEAR) % DAYS_PER_SEASON + 1;
  const seasonLabel = `${SEASONS[seasonIdx]} ${dayOfSzn}/${DAYS_PER_SEASON}, ${year}`;
  const SEASON_BASE_C = [10, 22, 8, -8]; // spring/summer/fall/winter base °C
  const tempC = Math.round(SEASON_BASE_C[seasonIdx] + core.weather.forDay(core.day).tempAnomalyC);
  const tempLabel = `${tempC > 0 ? '+' : ''}${tempC}°C`;
  const svc = core.services();
  const houseCap = svc.sleep;
  const popColor = core.population >= houseCap ? '#ff8844' : '#ddd';
  line(0, `${core.townName}  ${seasonLabel}  ${tempLabel}  pop ${core.population}/${houseCap}  mood ${core.averageMood().toFixed(0)}  gold ${core.gold.toFixed(0)}  era ${core.era}  [${core.focus}]`, popColor);
  const flowStr = (kind: Parameters<typeof core.netFlow>[0]) => {
    const f = core.netFlow(kind);
    return f === 0 ? '' : (f > 0 ? `+${f.toFixed(1)}` : f.toFixed(1));
  };
  const meal = core.stock.count('meal'), grain = core.stock.count('grain');
  const mealFlow = core.netFlow('meal');
  const mealTotal = meal + core.stock.count('game_meal') + core.stock.count('fish_meal') + core.stock.count('preserved') + core.stock.count('bread') + core.stock.count('ale');
  const foodDaysStr = mealFlow < -0.5 && mealTotal > 0 ? `  [${Math.floor(mealTotal / -mealFlow)}d left]` : '';
  const foodColor = foodDaysStr && Math.floor(mealTotal / -mealFlow) < 7 ? '#ff6b6b' : '#ddd';
  line(1, `meal ${meal.toFixed(0)}/${core.mealCap()}${flowStr('meal') ? `(${flowStr('meal')})` : ''}  grain ${grain.toFixed(0)}${flowStr('grain') ? `(${flowStr('grain')})` : ''}  bread ${core.stock.count('bread').toFixed(0)}  ale ${core.stock.count('ale').toFixed(0)}${foodDaysStr}`, foodColor);
  const gameMeal = core.stock.count('game_meal'), fishMeal = core.stock.count('fish_meal');
  const preserved = core.stock.count('preserved');
  const deerCount = [...core.deerViews()].length;
  line(2, `game_meal ${gameMeal.toFixed(0)}  fish_meal ${fishMeal.toFixed(0)}  preserved ${preserved.toFixed(0)}  deer ${deerCount}`, gameMeal > 0 || fishMeal > 0 || preserved > 0 ? '#aed6a0' : '#888');
  line(3, `wood ${core.stock.count('wood').toFixed(0)}${flowStr('wood') ? `(${flowStr('wood')})` : ''}  stone ${core.stock.count('stone').toFixed(0)}  iron ${core.stock.count('iron').toFixed(0)}  ore ${core.stock.count('iron_ore').toFixed(0)}  tools ${core.stock.count('tools').toFixed(0)}`);
  line(4, `clothes ${core.stock.count('clothes').toFixed(0)}  weapons ${core.stock.count('weapons').toFixed(0)}  medicine ${core.stock.count('medicine').toFixed(0)}  flax ${core.stock.count('flax').toFixed(0)}  rope ${core.stock.count('rope').toFixed(0)}`);
  { const a = core.agents;
    let wounded = 0, sick = 0;
    for (let i = 0; i < a.count; i++) {
      if (a.woundUntreated[i]) wounded++;
      if (a.sickUntilTick[i] > core.tickNo) sick++;
    }
    const healthWarn = wounded > 0 || sick > 0
      ? `  ⚠ ${[wounded > 0 && `${wounded}W`, sick > 0 && `${sick}S`].filter(Boolean).join('/')}`
      : '';
    const unburied = core.unburiedCount > 0 ? `  ⚠ unburied ${core.unburiedCount}` : '';
    const crisis = healthWarn || unburied;
    line(5, `births ${core.births}  deaths ${core.deaths}  prestige ${core.prestige}  inflation ${(core.inflation * 100).toFixed(1)}%${unburied}${healthWarn}`, crisis ? '#ff8844' : '#ddd');
  }
  const wolfLine = core.wolves.active
    ? `  WOLVES ${core.wolves.wolves.length} prowling` : '';
  const raidLine = core.raidActive
    ? `RAID — ${core.raids.raiders.length} raiders (slain ${core.raids.slain})`
    : `next raid day ${core.nextRaidDay}`;
  const sky = core.weather.forDay(core.day).sky;
  const skyLabel = sky === 'storm' ? '[storm]' : sky === 'snow' ? '[snow]' : sky === 'rain' ? '[rain]' : sky === 'overcast' ? '[overcast]' : '[clear]';
  const skyColor = sky === 'storm' ? '#ff8844' : sky === 'snow' ? '#aaddff' : sky === 'rain' ? '#88bbff' : '#ddd';
  const isDrought = core.weather.isDrought(core.day), isFloodRisk = core.weather.isFloodRisk(core.day);
  const droughtFlood = isDrought ? '  [DROUGHT]' : isFloodRisk ? '  [FLOOD RISK]' : '';
  const weatherLineColor = core.raidActive ? '#ff6b6b' : core.wolves.active ? '#ffcc44' : isDrought ? '#cc8833' : isFloodRisk ? '#44aacc' : skyColor;
  line(6, `${raidLine}${wolfLine}  ${skyLabel}${droughtFlood}`, weatherLineColor);
  { const TICKS_PER_DAY = MINUTES_PER_DAY / MINUTES_PER_TICK;
    const frac = (core.tickNo % TICKS_PER_DAY) / TICKS_PER_DAY;
    // frac: 0=midnight 0.25=dawn 0.5=noon 0.75=dusk
    const phase = frac < 0.21 ? 'Night' : frac < 0.33 ? 'Dawn' : frac < 0.5 ? 'Morning'
      : frac < 0.58 ? 'Midday' : frac < 0.71 ? 'Afternoon' : frac < 0.88 ? 'Dusk' : 'Night';
    const seasonDayOfYear = core.day % DAYS_PER_YEAR;
    const dayOfSeason = (seasonDayOfYear % DAYS_PER_SEASON) + 1;
    const seasonLabel2 = `${SEASONS[Math.floor(seasonDayOfYear / DAYS_PER_SEASON)]} day ${dayOfSeason}/${DAYS_PER_SEASON}`;
    line(7, `${paused ? 'PAUSED' : 'speed ' + speed + '×'}  ${phase}  ${seasonLabel2}${core.builds.length > 0 ? `  blueprints: ${core.builds.length}` : ''}`); }
  { const svc = core.services();
    const parts: string[] = [`sleep ${svc.sleep}`];
    if (svc.watch > 0) parts.push(`watch ${svc.watch}`);
    if (svc.burial > 0) parts.push(`burial ${svc.burial}`);
    if (svc.well > 0) parts.push(`well ${svc.well}`);
    if (svc.storage > 0) parts.push(`storage ${svc.storage}`);
    if (svc.education > 0) parts.push(`edu ${svc.education}`);
    if (svc.medical > 0) parts.push(`med ${svc.medical}`);
    if (svc.trade > 0) parts.push(`trade ${svc.trade} (+${svc.trade * 2}g/day)`);
    if (svc.drill > 0) parts.push(`drill ${svc.drill} (+${Math.min(30, svc.drill * 10)}% militia)`);
    if (svc.faith > 0) parts.push(`faith ${svc.faith} (≈${svc.faith * 12} worshippers)`);
    line(8, parts.join('  '), '#aaa'); }

  // Tool info
  let toolLabel: string = tool;
  if (tool === 'room') toolLabel = `room:${ROOM_TYPE_NAMES[roomTypeIdx]}`;
  if (tool === 'station') toolLabel = `station:${STATION_TYPE_NAMES[stationTypeIdx]}`;
  if (tool === 'blueprint') toolLabel = `blueprint:${BLUEPRINT_DEFS[blueprintIdx].name}`;
  line(9, `tool: ${toolLabel}`);

  // Key hints
  ctx.fillStyle = '#888'; ctx.font = '11px monospace';
  ctx.fillText('H wall  E erase  G gate  J floor  T trap  Z room([ ])  K station(, .)  Shift+B bridge  Shift+K blueprint([ ])', 8, 20 + 10 * 17);
  ctx.fillText('F field  C chop  Q quarry  B fishery  L flax  P forage  U orchard  V veg  R raid  M wolves  N settler  X tech  Y focus  1-4 speed  space pause', 8, 20 + 11 * 17);
  ctx.fillText('camera: WASD / arrows pan · scroll zoom · middle-drag · O overview  ·  click settler to inspect · I economy · Ctrl+S save', 8, 20 + 12 * 17);

  // ── Economy / storage panel (toggle I): every stored resource with its
  //    net flow and market price — the SoS per-resource economy readout. ──
  if (showEconomy) {
    const items = RESOURCE_KINDS.filter((kRes) => core.stock.count(kRes) > 0.05);
    const yr: YearReport | null = core.lastYearReport;
    // Yearly report adds rows: header + 1 pop row + resources with nonzero in OR out.
    const yrResources = yr ? RESOURCE_KINDS.filter((k) => (yr.inflow[k] ?? 0) > 0.5 || (yr.outflow[k] ?? 0) > 0.5) : [];
    const yrRows = yr ? 2 + yrResources.length : 1;
    const rowH = 15, ox = 352, oy = 8, PW = 310;
    const PH = 30 + Math.max(1, items.length) * rowH + yrRows * rowH + (yr ? 8 : 0);
    ctx.fillStyle = '#000c'; ctx.fillRect(ox, oy, PW, PH);
    let stored = 0;
    for (const kRes of RESOURCE_KINDS) if (!FOOD_KINDS_VIEW.has(kRes)) stored += core.stock.count(kRes);
    const cap = core.storageCap();
    ctx.fillStyle = '#ffd700'; ctx.font = 'bold 12px monospace';
    ctx.fillText(`Economy · gold ${core.gold.toFixed(0)} · infl ${(core.inflation * 100).toFixed(1)}% · storage ${stored.toFixed(0)}/${cap}`, ox + 8, oy + 16);
    ctx.font = '11px monospace';
    let row = 0;
    items.forEach((kRes) => {
      const cnt = core.stock.count(kRes), flow = core.netFlow(kRes), price = core.marketPrice(kRes);
      const arrow = flow > 0.05 ? '▲' : flow < -0.05 ? '▼' : ' ';
      ctx.fillStyle = flow < -0.05 ? '#ff9999' : flow > 0.05 ? '#99ff99' : '#cccccc';
      ctx.fillText(
        `${kRes.padEnd(10)}${cnt.toFixed(0).padStart(5)}  ${arrow}${Math.abs(flow).toFixed(1).padStart(4)}/d  ${price.toFixed(1)}g`,
        ox + 8, oy + 30 + row++ * rowH);
    });
    if (items.length === 0) { ctx.fillStyle = '#888'; ctx.fillText('(stores empty)', ox + 8, oy + 30); row++; }
    // ── Yearly ledger ──────────────────────────────────────────────────────
    const yrY = oy + 30 + row * rowH + 6;
    if (yr) {
      ctx.fillStyle = '#88ccff'; ctx.font = 'bold 11px monospace';
      ctx.fillText(`── Year ${yr.year} Report ──  pop ${yr.popStart}→${yr.popEnd}`, ox + 8, yrY + 6);
      ctx.font = '11px monospace';
      yrResources.forEach((k, n) => {
        const inn = yr.inflow[k] ?? 0, out = yr.outflow[k] ?? 0, net = inn - out;
        ctx.fillStyle = net >= 0 ? '#99ff99' : '#ff9999';
        ctx.fillText(
          `${k.padEnd(10)}  +${inn.toFixed(0).padStart(5)} -${out.toFixed(0).padStart(5)}  net ${net > 0 ? '+' : ''}${net.toFixed(0)}`,
          ox + 8, yrY + 6 + (n + 1) * rowH);
      });
      if (yrResources.length === 0) { ctx.fillStyle = '#888'; ctx.fillText('(no activity recorded)', ox + 8, yrY + 6 + rowH); }
    } else {
      ctx.fillStyle = '#666'; ctx.font = '11px monospace';
      ctx.fillText('── Yearly report available after year 1 ──', ox + 8, yrY + 6);
    }
  }

  // ── Settler inspector panel (top-right) ──────────────────────────────────
  if (inspected && inspectedIdx >= 0) {
    const a = core.agents;
    // Refresh the view each frame so it stays live.
    const live = core.inspect(inspectedIdx);
    if (live) {
      // Find current job station name.
      const sid = a.stationId[inspectedIdx];
      let jobLabel: string = live.state;
      if (sid > 0) {
        const sdef = STATION_DEF_BY_NUM[sid];
        if (sdef) jobLabel = `${live.state} @ ${sdef.name}`;
      }
      // Collect active thoughts (non-expired) with human-readable labels.
      const SLOTS = THOUGHT_SLOTS;
      const thoughts: string[] = [];
      for (let s = 0; s < SLOTS; s++) {
        const base = inspectedIdx * SLOTS + s;
        const delta = a.thoughtDelta[base], expiry = a.thoughtExpiry[base], key = a.thoughtKey[base] as ThoughtKey;
        if (expiry > core.tickNo && delta !== 0) {
          const label = THOUGHT_LABELS[key] ?? (delta > 0 ? 'mood boost' : 'mood penalty');
          thoughts.push(`${label} (${delta > 0 ? '+' : ''}${delta})`);
        }
      }
      const flagLines = [live.wounded && 'wounded', live.infected && 'infected', live.sick && 'sick'].filter(Boolean);
      const PW = 300, PH = 188 + flagLines.length * 16 + thoughts.length * 16;
      const px2 = cw - PW - 8;
      ctx.fillStyle = '#000c'; ctx.fillRect(px2, 8, PW, PH);
      ctx.fillStyle = '#ffd700'; ctx.font = 'bold 13px monospace';
      ctx.fillText(live.name, px2 + 8, 28);
      ctx.fillStyle = '#ddd'; ctx.font = '12px monospace';
      const iline = (n: number, s: string, col = '#ddd') => { ctx.fillStyle = col; ctx.fillText(s, px2 + 8, 46 + n * 16); ctx.fillStyle = '#ddd'; };
      iline(0, `mood ${live.mood.toFixed(0)}  skill ${live.skill.toFixed(1)}`);
      iline(1, `food ${live.food.toFixed(0)}  rest ${live.rest.toFixed(0)}  warmth ${live.warmth.toFixed(0)}`);
      iline(2, `rec ${live.recreation.toFixed(0)}  social ${live.social.toFixed(0)}  hp ${live.health.toFixed(0)}`);
      iline(3, jobLabel, '#aaddff');
      iline(4, `traits: ${live.traits.join(', ') || 'none'}  armed: ${live.armed}`, '#aaa');
      let row = 5;
      if (flagLines.length) iline(row++, flagLines.join(' · '), '#ff6b6b');
      for (const th of thoughts) {
        const color = th.startsWith('+') || th.includes('(+') ? '#88dd88' : '#dd8888';
        iline(row++, th, color);
      }
      ctx.fillStyle = '#888'; ctx.font = '11px monospace';
      ctx.fillText('click agent to inspect', px2 + 8, 8 + PH - 10);
    }
  }

  // ── Research panel (bottom-right) ────────────────────────────────────
  const rb = core.researchBook;
  const avail = rb.available();
  const done = rb.all().filter(id => id !== 'crop_rotation');
  const ptsPerDay = core.services().education * RESEARCH_PER_DESK_PER_DAY;
  const RPH = 16;
  const queuedDescExtra = rb.queue && avail.some(t => t.id === rb.queue) ? 1 : 0;
  const RP_ROWS = 2 + Math.min(avail.length, 5) + queuedDescExtra + Math.min(done.length, 3);
  const RPW = 300, RPH_TOTAL = RP_ROWS * RPH + 16;
  const rpx = cw - RPW - 8, rpy = ch - RPH_TOTAL - 8;
  ctx.fillStyle = '#000a'; ctx.fillRect(rpx, rpy, RPW, RPH_TOTAL);
  ctx.fillStyle = '#ffd700'; ctx.font = 'bold 12px monospace';
  ctx.fillText(`Research  ${rb.points.toFixed(0)} pts${ptsPerDay > 0 ? `  (+${ptsPerDay}/day)` : ''}`, rpx + 6, rpy + 14);
  ctx.font = '11px monospace';
  let row = 1;
  if (avail.length === 0) {
    ctx.fillStyle = '#888';
    ctx.fillText('(build a library + desks)', rpx + 6, rpy + 14 + row++ * RPH);
  } else {
    ctx.fillStyle = '#aae';
    ctx.fillText(`Available: (X to queue${rb.queue ? ` — queued: ${rb.queue}` : ''})`, rpx + 6, rpy + 14 + row++ * RPH);
    for (const t of avail.slice(0, 5)) {
      const affordable = rb.points >= t.cost;
      const queued = rb.queue === t.id;
      ctx.fillStyle = queued ? '#ffd700' : affordable ? '#88ff88' : '#aaaaff';
      const prefix = queued ? '> ' : '  ';
      const daysLeft = ptsPerDay > 0 && !affordable ? `~${Math.ceil((t.cost - rb.points) / ptsPerDay)}d` : affordable ? 'ready' : '?';
      ctx.fillText(`${prefix}${t.name} (${t.cost}pt ${daysLeft})`, rpx + 6, rpy + 14 + row++ * RPH);
      if (queued) { // show description only for the queued tech
        ctx.fillStyle = '#888'; ctx.font = '10px monospace';
        ctx.fillText(`    ${t.desc}`, rpx + 6, rpy + 14 + row++ * RPH);
        ctx.font = '11px monospace';
      }
    }
  }
  if (done.length > 0) {
    ctx.fillStyle = '#888'; ctx.font = '11px monospace';
    ctx.fillText(`Unlocked: ${done.slice(0, 3).join(', ')}${done.length > 3 ? '…' : ''}`, rpx + 6, rpy + 14 + row++ * RPH);
  }

  // ── Tile hover tooltip ───────────────────────────────────────────────
  if (hoverX >= 0 && hoverX < MAP && hoverY >= 0 && hoverY < MAP) {
    const g = core.grid;
    const i = hoverY * MAP + hoverX;
    const parts: string[] = [];
    const terrainNames = ['', 'grass', 'tree', 'water', 'rock', 'soil', 'sand'];
    const zoneNames = ['', 'field', 'woodcutter', 'quarry', 'fishery', 'flax', 'forage', 'orchard', 'veg garden'];
    const forageNames = ['', 'berries', 'mushrooms', 'herbs'];
    if (g.forage[i]) parts.push(forageNames[g.forage[i]] ?? 'forage');
    const t = g.terrain[i];
    if (t) parts.push(terrainNames[t] ?? `terrain:${t}`);
    if (g.ore[i]) parts.push('ore');
    if (g.zone[i]) {
      let zl = zoneNames[g.zone[i]] ?? `zone:${g.zone[i]}`;
      if (g.zone[i] === ZONE.FORAGE) {
        if (g.forage[i] === 0 && g.forageRegrow[i] > 0) zl += ` (depleted, regrows in ${g.forageRegrow[i]}d)`;
        else if (g.forage[i] === 0) zl += ' (depleted)';
      }
      parts.push(zl);
    }
    if (g.floor[i]) {
      const rd = ROOM_DEF_BY_NUM[g.roomId[i]];
      parts.push(rd ? rd.id : 'floor');
    }
    const stationsHere = g.stations.filter(s => s.x === hoverX && s.y === hoverY);
    for (const s of stationsHere) {
      const sd = STATION_DEF_BY_NUM[s.typeId];
      parts.push(sd?.id ?? `station:${s.typeId}`);
    }
    if (g.wall[i]) parts.push('wall');
    if (g.gate[i]) parts.push('gate');
    if (g.trap[i]) parts.push('spike trap');
    // Settlers on this tile
    for (let si = 0; si < a.count; si++) {
      if ((a.posX[si] | 0) === hoverX && (a.posY[si] | 0) === hoverY) {
        const stateLabel = a.state[si] === AState.Sleeping ? 'sleeping' : a.state[si] === AState.Working ? 'working' : a.state[si] === AState.Moving ? 'moving' : 'idle';
        parts.push(`${a.name(si)} (${stateLabel})`);
      }
    }
    if (parts.length > 0) {
      const tip = `(${hoverX},${hoverY}) ${parts.join(' · ')}`;
      ctx.font = '11px monospace';
      const tw = ctx.measureText(tip).width;
      // Hover tile → screen px (the tooltip is drawn in screen space).
      const sx = hoverX * TILE * view.scale - view.x;
      const sy = hoverY * TILE * view.scale - view.y;
      const tx = Math.min(sx + TILE * view.scale + 4, cw - tw - 8);
      const ty = Math.max(sy - 4, 20);
      ctx.fillStyle = '#000c'; ctx.fillRect(tx - 2, ty - 13, tw + 4, 16);
      ctx.fillStyle = '#ddd'; ctx.fillText(tip, tx, ty);
    }
  }

  // ── Flash message (center-top) ───────────────────────────────────────
  if (flashMsg && Date.now() < flashUntil) {
    ctx.font = 'bold 18px monospace';
    const fw = ctx.measureText(flashMsg).width;
    const fx = (cw - fw) / 2, fy = 40;
    ctx.fillStyle = '#000b'; ctx.fillRect(fx - 8, fy - 18, fw + 16, 28);
    ctx.fillStyle = '#7fe07f'; ctx.fillText(flashMsg, fx, fy);
  } else { flashMsg = ''; }

  // ── Minimap (bottom-right) ───────────────────────────────────────────
  { const g2 = core.grid;
    const md = minimapData.data;
    for (let my = 0; my < MAP; my++) for (let mx = 0; mx < MAP; mx++) {
      const i = my * MAP + mx;
      // Pick a colour for this tile: zones first, then terrain.
      let r = 0, gr = 0, b = 0;
      const t2 = g2.terrain[i];
      if (t2 === TERRAIN.WATER) {
        if (seasonIdx === 3) { r = 160; gr = 190; b = 210; } // ice
        else { r = 30; gr = 100; b = 180; }
      } else if (t2 === TERRAIN.TREE) {
        if (seasonIdx === 3) { r = 60; gr = 80; b = 90; }       // bare/snow
        else if (seasonIdx === 2) { r = 80; gr = 90; b = 40; }  // autumn rust
        else if (seasonIdx === 0) { r = 40; gr = 120; b = 50; } // spring bright
        else { r = 30; gr = 100; b = 40; }
      } else if (t2 === TERRAIN.ROCK) { r = 110; gr = 100; b = 90; }
      else if (t2 === TERRAIN.SOIL) { r = 140; gr = 100; b = 60; }
      else if (t2 === TERRAIN.SAND) { r = 200; gr = 190; b = 140; }
      else { // grass
        if (seasonIdx === 3) { r = 180; gr = 195; b = 210; }      // snow-covered
        else if (seasonIdx === 2) { r = 110; gr = 120; b = 55; }  // autumn amber
        else if (seasonIdx === 0) { r = 55; gr = 155; b = 50; }   // spring vivid
        else { r = 60; gr = 140; b = 50; }
      }
      // Zone tint brightens the tile
      if (g2.zone[i]) { r = Math.min(255, r + 60); gr = Math.min(255, gr + 60); b = Math.min(255, b + 20); }
      // Floor = warm cream
      if (g2.floor[i]) { r = 210; gr = 190; b = 150; }
      // Wall = dark brown
      if (g2.wall[i]) { r = 70; gr = 50; b = 40; }
      // Write into the 2px-per-tile image data
      for (let py = 0; py < MINI_PX; py++) for (let px2 = 0; px2 < MINI_PX; px2++) {
        const di = ((my * MINI_PX + py) * MAP * MINI_PX + (mx * MINI_PX + px2)) * 4;
        md[di] = r; md[di+1] = gr; md[di+2] = b; md[di+3] = 255;
      }
    }
    // Settlers: white dots; raiders: red; wolves: yellow
    for (let si = 0; si < core.agents.count; si++) {
      const sx = (core.agents.posX[si] | 0) * MINI_PX, sy = (core.agents.posY[si] | 0) * MINI_PX;
      const di = (sy * MAP * MINI_PX + sx) * 4;
      md[di] = 255; md[di+1] = 255; md[di+2] = 255; md[di+3] = 255;
    }
    for (const rd of core.raids.raiders) {
      const sx = (rd.x | 0) * MINI_PX, sy = (rd.y | 0) * MINI_PX;
      const di = (sy * MAP * MINI_PX + sx) * 4;
      md[di] = 255; md[di+1] = 60; md[di+2] = 60; md[di+3] = 255;
    }
    if (core.wolves.active) for (const w of core.wolves.wolves) {
      const sx = (w.x | 0) * MINI_PX, sy = (w.y | 0) * MINI_PX;
      const di = (sy * MAP * MINI_PX + sx) * 4;
      md[di] = 255; md[di+1] = 230; md[di+2] = 0; md[di+3] = 255;
    }
    minimapCtx.putImageData(minimapData, 0, 0);
    const mmSize = MAP * MINI_PX;
    const mmX = cw - mmSize - 4, mmY = ch - mmSize - 4;
    // Border + background
    ctx.fillStyle = '#000a'; ctx.fillRect(mmX - 1, mmY - 1, mmSize + 2, mmSize + 2);
    ctx.drawImage(minimapCanvas, mmX, mmY);
    // Viewport rect overlay
    const vLeft = view.x / view.scale / TILE * MINI_PX;
    const vTop  = view.y / view.scale / TILE * MINI_PX;
    const vW = cw  / view.scale / TILE * MINI_PX;
    const vH = ch / view.scale / TILE * MINI_PX;
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1;
    ctx.strokeRect(mmX + vLeft, mmY + vTop, vW, vH);
    ctx.lineWidth = 1;
  }

  // ── Event log (bottom-left) ───────────────────────────────────────────
  const logColors = { good: '#7fe07f', bad: '#ff6b6b', info: '#d8d8d8' };
  ctx.font = '12px monospace';
  const recent = core.log.slice(-6);
  for (let k = 0; k < recent.length; k++) {
    const entry = recent[recent.length - 1 - k];
    ctx.fillStyle = logColors[entry.kind];
    ctx.fillText(`d${entry.day} ${entry.text}`, 8, ch - 10 - k * 16);
  }

  // ── Pending choice modal (center) ─────────────────────────────────────
  if (core.pendingChoice) {
    const pc: PendingEventChoice = core.pendingChoice;
    const MW = 440, MH = 30 + pc.choices.length * 36 + 32;
    const mx = (cw - MW) / 2;
    const my = (ch - MH) / 2;
    ctx.fillStyle = '#111d'; ctx.fillRect(mx - 4, my - 4, MW + 8, MH + 8);
    ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 2;
    ctx.strokeRect(mx - 4, my - 4, MW + 8, MH + 8);
    ctx.lineWidth = 1;
    ctx.fillStyle = '#ffd700'; ctx.font = 'bold 14px monospace';
    ctx.fillText(pc.title, mx + 8, my + 18);
    ctx.fillStyle = '#ccc'; ctx.font = '12px monospace';
    ctx.fillText(pc.text, mx + 8, my + 36);
    for (let ci = 0; ci < pc.choices.length; ci++) {
      const opt = pc.choices[ci];
      const oy = my + 56 + ci * 36;
      ctx.fillStyle = '#1a2a1a'; ctx.fillRect(mx + 4, oy - 2, MW - 8, 28);
      ctx.strokeStyle = '#88ff88'; ctx.strokeRect(mx + 4, oy - 2, MW - 8, 28);
      ctx.fillStyle = '#88ff88'; ctx.font = 'bold 12px monospace';
      ctx.fillText(`[${ci + 1}]  ${opt.label}`, mx + 12, oy + 12);
      ctx.fillStyle = '#aaa'; ctx.font = '11px monospace';
      ctx.fillText(opt.desc, mx + 12, oy + 26);
    }
    ctx.fillStyle = '#666'; ctx.font = '11px monospace';
    ctx.fillText('Press 1 or 2 to choose', mx + 8, my + MH - 4);
  }

  // ── Colony perished overlay ───────────────────────────────────────────
  if (core.population === 0 && core.day > 0) {
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(0, 0, cw, ch);
    const GW = 420, GH = 160;
    const gx = (cw - GW) / 2, gy = (ch - GH) / 2;
    ctx.fillStyle = '#1a0808'; ctx.fillRect(gx, gy, GW, GH);
    ctx.strokeStyle = '#882222'; ctx.lineWidth = 2; ctx.strokeRect(gx, gy, GW, GH); ctx.lineWidth = 1;
    ctx.fillStyle = '#ff4444'; ctx.font = 'bold 22px monospace';
    ctx.fillText('Colony Perished', gx + 20, gy + 38);
    ctx.fillStyle = '#ccc'; ctx.font = '13px monospace';
    ctx.fillText(`${core.townName} fell on Day ${core.day}.`, gx + 20, gy + 64);
    ctx.fillText(`${core.deaths} souls lost. ${core.births} born.  Prestige: ${core.prestige}`, gx + 20, gy + 82);
    ctx.fillStyle = '#888'; ctx.font = '11px monospace';
    ctx.fillText('Press Ctrl+L to load a save, or Esc to return to menu.', gx + 20, gy + 120);
    ctx.fillText('N adds a new settler if you want to continue.', gx + 20, gy + 138);
  }
}

// ── Loop ──────────────────────────────────────────────────────────────────
let acc = 0, last = performance.now();
let _autoSaveDay = -1;
function loop(now: number): void {
  acc += Math.min(0.25, (now - last) / 1000) * TICKS_PER_SECOND * speed;
  last = now;
  if (!paused && !core.pendingChoice) { let guard = 0; while (acc >= 1 && guard++ < 64) { core.tick(); acc -= 1; } }
  else acc = 0;
  // Auto-save once per game day so progress is never lost.
  if (core.day !== _autoSaveDay) {
    _autoSaveDay = core.day;
    try { localStorage.setItem(SOA_SAVE_KEY, JSON.stringify(core.serialize())); } catch { /* storage full */ }
  }
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
