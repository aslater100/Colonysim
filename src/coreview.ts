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
import type { SettlerView, PendingEventChoice } from './sim/towncore';
import { AState } from './sim/agents';
import { TERRAIN, ZONE } from './sim/build';
import {
  ROOM_TYPE_ID, ROOM_DEF_BY_NUM, ROOM_DEFS,
  STATION_DEF_BY_NUM, STATION_DEFS,
  TICKS_PER_SECOND, SEASONS, START_YEAR, DAYS_PER_SEASON, DAYS_PER_YEAR,
} from './sim/defs';
import { buildSprites } from './ui/sprites';
import { applyOverrides } from './ui/spriteOverrides';

const sprites = buildSprites([]);
void applyOverrides(sprites);

const MAP = 64;
const core = new TownCore({ width: MAP, height: MAP, seed: Date.now() % 100000, terrain: true });
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
};

// ── Starter town ──────────────────────────────────────────────────────────
{
  const g = core.grid;
  const cx = MAP >> 1, cy = MAP >> 1;
  for (let y = cy - 12; y <= cy + 12; y++) for (let x = cx - 12; x <= cx + 16; x++) g.setTerrain(x, y, TERRAIN.GRASS);
  const room = (x0: number, y0: number, x1: number, y1: number, type: string): void => {
    g.designateRect(x0, y0, x1, y1, ROOM_TYPE_ID.get(type)!);
    for (let x = x0 - 1; x <= x1 + 1; x++) { g.setWall(x, y0 - 1); g.setWall(x, y1 + 1); }
    for (let y = y0 - 1; y <= y1 + 1; y++) { g.setWall(x0 - 1, y); g.setWall(x1 + 1, y); }
    g.setGate((x0 + x1) >> 1, y1 + 1);
  };
  const fill = (id: string, x0: number, y0: number, x1: number, y1: number, dx: number, dy: number): void => {
    for (let y = y0; y <= y1; y += dy) for (let x = x0; x <= x1; x += dx) g.placeStation(id, x, y);
  };

  room(cx - 4, cy - 9, cx + 3, cy - 6, 'kitchen');
  fill('oven', cx - 4, cy - 9, cx + 3, cy - 9, 2, 1);

  room(cx - 5, cy + 4, cx + 4, cy + 9, 'home');
  fill('bunk', cx - 5, cy + 4, cx + 4, cy + 8, 2, 3);

  room(cx + 8, cy - 2, cx + 14, cy + 2, 'tavern');
  fill('table', cx + 8, cy - 2, cx + 13, cy + 2, 3, 2);

  g.rebuildRooms();
  core.stock.add('grain', 5000);
  core.stock.add('wood', 200);
  core.seedColony(cx, cy, 8);

  const autoZone = (type: number, cap: number): void => {
    for (let i = 0, n = 0; i < g.size && n < cap; i++) {
      if (g.setZone(i % MAP, (i / MAP) | 0, type)) n++;
    }
  };
  autoZone(ZONE.FIELD, 16);
  autoZone(ZONE.WOODCUTTER, 12);
  autoZone(ZONE.QUARRY, 8);
  autoZone(ZONE.FISHERY, 6);
}

// ── Canvas ────────────────────────────────────────────────────────────────
const app = document.getElementById('app')!;
const canvas = document.createElement('canvas');
app.appendChild(canvas);
const ctx = canvas.getContext('2d')!;
function resize(): void { canvas.width = innerWidth; canvas.height = innerHeight; ctx.imageSmoothingEnabled = false; }
resize();
addEventListener('resize', resize);

const tilePx = () => Math.floor(Math.min(canvas.width, canvas.height) / MAP);
const tileAt = (mx: number, my: number) => ({ x: Math.floor(mx / tilePx()), y: Math.floor(my / tilePx()) });

// ── Tool state ────────────────────────────────────────────────────────────
let paused = false;
let speed = 3;
let painting: 0 | 1 | 2 = 0; // 0=none, 1=apply, 2=erase

type Tool = 'wall' | 'erase' | 'gate' | 'floor' | 'room' | 'station'
           | 'field' | 'woodcutter' | 'quarry' | 'fishery' | 'flax' | 'trap';
let tool: Tool = 'wall';

// Room designation sub-tool: cycle through room type names.
const ROOM_TYPE_NAMES = ROOM_DEFS.map(d => d.id);
let roomTypeIdx = 0; // index into ROOM_TYPE_NAMES

// Station placement sub-tool: cycle through station type names.
const STATION_TYPE_NAMES = STATION_DEFS.map(d => d.id);
let stationTypeIdx = 0; // index into STATION_TYPE_NAMES

// Settler inspector state.
let inspected: SettlerView | null = null;

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
  if (e.key === ' ') { paused = !paused; e.preventDefault(); return; }
  if (e.key === '1') { speed = 1; return; }
  if (e.key === '2') { speed = 3; return; }
  if (e.key === '3') { speed = 8; return; }
  if (k === 'r') { core.musterRaid(); return; }
  if (k === 'n') { core.seedColony(core.homeX, core.homeY, 1); return; }
  if (k === 'x') {
    // Research the first affordable available tech (for play-test convenience)
    const avail = core.researchBook.available();
    const affordable = avail.find(t => core.researchBook.points >= t.cost);
    if (affordable) core.research(affordable.id);
    return;
  }
  // Tool keys
  if (k === 'w') { tool = 'wall'; return; }
  if (k === 'e') { tool = 'erase'; return; }
  if (k === 'g') { tool = 'gate'; return; }
  if (k === 'd') { tool = 'floor'; return; }
  if (k === 'z') { tool = 'room'; return; }
  if (k === 'a') { tool = 'station'; return; }
  if (k === 'f') { tool = 'field'; return; }
  if (k === 'c') { tool = 'woodcutter'; return; }
  if (k === 'q') { tool = 'quarry'; return; }
  if (k === 'b') { tool = 'fishery'; return; }
  if (k === 'l') { tool = 'flax'; return; }
  if (k === 't') { tool = 'trap'; return; }
  // Cycle room type
  if (e.key === '[') { roomTypeIdx = (roomTypeIdx - 1 + ROOM_TYPE_NAMES.length) % ROOM_TYPE_NAMES.length; return; }
  if (e.key === ']') { roomTypeIdx = (roomTypeIdx + 1) % ROOM_TYPE_NAMES.length; return; }
  // Cycle station type
  if (e.key === ',') { stationTypeIdx = (stationTypeIdx - 1 + STATION_TYPE_NAMES.length) % STATION_TYPE_NAMES.length; return; }
  if (e.key === '.') { stationTypeIdx = (stationTypeIdx + 1) % STATION_TYPE_NAMES.length; return; }
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('mousedown', (e) => {
  painting = e.button === 2 ? 2 : 1;
  paintAt(e);
  if (e.button === 0 && tool === 'wall') maybeInspect(e); // click in non-paint = inspect
});
addEventListener('mouseup', () => {
  painting = 0;
  if (tool === 'room' || tool === 'wall' || tool === 'floor' || tool === 'station') {
    core.grid.rebuildRooms();
  }
});
canvas.addEventListener('mousemove', (e) => { if (painting) paintAt(e); });

/** Click near a settler to open the inspector. Used when no paint action fired. */
function maybeInspect(e: MouseEvent): void {
  const r = canvas.getBoundingClientRect();
  const t = tileAt(e.clientX - r.left, e.clientY - r.top);
  const a = core.agents;
  let bestDist = 2; // Manhattan tiles, threshold for "near"
  let bestIdx = -1;
  for (let i = 0; i < a.count; i++) {
    const d = Math.abs(a.posX[i] - t.x) + Math.abs(a.posY[i] - t.y);
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }
  inspected = bestIdx >= 0 ? core.inspect(bestIdx) : null;
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
      core.clearTrap(t.x, t.y);
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
    case 'trap':       core.paintTrap(t.x, t.y);               break;
  }
}

// ── Render ────────────────────────────────────────────────────────────────
const ZONE_OUTLINE = ['', '#d4d46a', '#6ad48a', '#c8c8d8', '#6ad4d4', '#d4a06a']; // flax = warm amber

function draw(): void {
  const px = tilePx();
  const g = core.grid;
  const blit = (img: CanvasImageSource, x: number, y: number) => ctx.drawImage(img, x * px, y * px, px, px);
  ctx.fillStyle = '#15151a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const anim = (performance.now() / 350 | 0) % sprites.water.length;

  for (let y = 0; y < MAP; y++) for (let x = 0; x < MAP; x++) {
    const i = y * MAP + x;
    const t = g.terrain[i];

    // Ground layer
    if (t === TERRAIN.WATER) blit(sprites.water[anim], x, y);
    else if (t === TERRAIN.SOIL) blit(sprites.soil, x, y);
    else if (t === TERRAIN.ROCK) blit(g.ore[i] ? sprites.rockMarked : sprites.rock, x, y);
    else blit(sprites.grass[(x * 3 + y) % 4], x, y);
    if (t === TERRAIN.TREE) blit(sprites.tree, x, y);

    // Sapling: green tint on tiles growing back to forest
    if (g.saplingAge[i] > 0) {
      ctx.fillStyle = '#30a03040';
      ctx.fillRect(x * px, y * px, px, px);
    }

    // Zone outline
    if (g.zone[i]) {
      ctx.strokeStyle = ZONE_OUTLINE[g.zone[i]];
      ctx.strokeRect(x * px + 0.5, y * px + 0.5, px - 1, px - 1);
    }

    // Floor with room tint
    if (g.floor[i]) {
      blit(sprites.interiorFloor, x, y);
      const roomDef = ROOM_DEF_BY_NUM[g.roomId[i]];
      if (roomDef) {
        const color = ROOM_COLORS[roomDef.id];
        if (color) {
          ctx.fillStyle = color + '44'; // ~27% opacity tint
          ctx.fillRect(x * px, y * px, px, px);
        }
      }
    }

    if (g.gate[i]) blit(sprites.gate, x, y);
    else if (g.wall[i]) blit(sprites.interiorWall, x, y);
  }

  // Spike traps (rendered as a red X over the tile)
  ctx.strokeStyle = '#cc2222';
  ctx.lineWidth = 1;
  for (let y = 0; y < MAP; y++) for (let x = 0; x < MAP; x++) {
    if (g.trap[y * MAP + x]) {
      ctx.beginPath();
      ctx.moveTo(x * px + 2, y * px + 2); ctx.lineTo((x + 1) * px - 2, (y + 1) * px - 2);
      ctx.moveTo((x + 1) * px - 2, y * px + 2); ctx.lineTo(x * px + 2, (y + 1) * px - 2);
      ctx.stroke();
    }
  }

  // Stations
  for (const s of g.stations) {
    const def = STATION_DEF_BY_NUM[s.typeId];
    const img = def && sprites.stations[def.id];
    if (img) blit(img, s.x, s.y);
  }

  // Agents
  const a = core.agents;
  for (let i = 0; i < a.count; i++) {
    const variant = i % sprites.settler.length;
    blit(sprites.settler[variant][0], a.posX[i], a.posY[i]);
    if (a.woundUntreated[i]) {
      ctx.strokeStyle = '#ff4040';
      ctx.strokeRect(a.posX[i] * px, a.posY[i] * px, px, px);
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

  // Deer
  const deerFrame = (performance.now() / 400 | 0) % sprites.deer.length;
  for (const d of core.deerViews()) blit(sprites.deer[deerFrame], d.x | 0, d.y | 0);

  // Raiders
  for (const r of core.raids.raiders) {
    blit(sprites.raider[r.fleeing ? 0 : (performance.now() / 200 | 0) % sprites.raider.length], r.x, r.y);
  }

  // Blueprint ghosts
  ctx.strokeStyle = '#88aaff'; ctx.setLineDash([2, 2]);
  for (const o of core.builds) ctx.strokeRect(o.x * px + 1, o.y * px + 1, px - 2, px - 2);
  ctx.setLineDash([]);

  // ── Stats overlay (top-left) ────────────────────────────────────────────
  ctx.fillStyle = '#000a'; ctx.fillRect(0, 0, 340, 280);
  ctx.fillStyle = '#ddd'; ctx.font = '13px monospace';
  const line = (n: number, s: string, color = '#ddd') => { ctx.fillStyle = color; ctx.fillText(s, 8, 20 + n * 17); };

  const seasonIdx = Math.floor((core.day % DAYS_PER_YEAR) / DAYS_PER_SEASON);
  const year = START_YEAR + Math.floor(core.day / DAYS_PER_YEAR);
  const seasonLabel = `${SEASONS[seasonIdx]} ${year}`;
  line(0, `${core.townName}  ${seasonLabel}  day ${core.day}  pop ${core.population}  mood ${core.averageMood().toFixed(0)}  gold ${core.gold.toFixed(0)}  era ${core.era}  [${core.focus}]`);
  const flowStr = (kind: Parameters<typeof core.netFlow>[0]) => {
    const f = core.netFlow(kind);
    return f === 0 ? '' : (f > 0 ? `+${f.toFixed(1)}` : f.toFixed(1));
  };
  const meal = core.stock.count('meal'), grain = core.stock.count('grain');
  line(1, `meal ${meal.toFixed(0)}/${core.mealCap()}${flowStr('meal') ? `(${flowStr('meal')})` : ''}  grain ${grain.toFixed(0)}${flowStr('grain') ? `(${flowStr('grain')})` : ''}  bread ${core.stock.count('bread').toFixed(0)}  ale ${core.stock.count('ale').toFixed(0)}`);
  const gameMeal = core.stock.count('game_meal'), fishMeal = core.stock.count('fish_meal');
  const deerCount = [...core.deerViews()].length;
  line(2, `game_meal ${gameMeal.toFixed(0)}  fish_meal ${fishMeal.toFixed(0)}  deer ${deerCount}`, gameMeal > 0 || fishMeal > 0 ? '#aed6a0' : '#888');
  line(3, `wood ${core.stock.count('wood').toFixed(0)}${flowStr('wood') ? `(${flowStr('wood')})` : ''}  stone ${core.stock.count('stone').toFixed(0)}  iron ${core.stock.count('iron').toFixed(0)}  ore ${core.stock.count('iron_ore').toFixed(0)}  tools ${core.stock.count('tools').toFixed(0)}`);
  line(4, `clothes ${core.stock.count('clothes').toFixed(0)}  weapons ${core.stock.count('weapons').toFixed(0)}  medicine ${core.stock.count('medicine').toFixed(0)}  flax ${core.stock.count('flax').toFixed(0)}  rope ${core.stock.count('rope').toFixed(0)}`);
  const unburied = core.unburiedCount > 0 ? `  ⚠ unburied ${core.unburiedCount}` : '';
  line(5, `births ${core.births}  deaths ${core.deaths}  prestige ${core.prestige}  inflation ${(core.inflation * 100).toFixed(1)}%${unburied}`, core.unburiedCount > 0 ? '#ff8844' : '#ddd');
  const raidLine = core.raidActive
    ? `RAID — ${core.raids.raiders.length} raiders (slain ${core.raids.slain})`
    : `next raid day ${core.nextRaidDay}`;
  line(6, raidLine, core.raidActive ? '#ff6b6b' : '#ddd');
  line(7, `${paused ? 'PAUSED' : 'speed ' + speed + '×'}`);

  // Tool info
  let toolLabel: string = tool;
  if (tool === 'room') toolLabel = `room:${ROOM_TYPE_NAMES[roomTypeIdx]}`;
  if (tool === 'station') toolLabel = `station:${STATION_TYPE_NAMES[stationTypeIdx]}`;
  line(8, `tool: ${toolLabel}`);

  // Key hints
  ctx.fillStyle = '#888'; ctx.font = '11px monospace';
  ctx.fillText('W wall  E erase  G gate  D floor  T trap  Z room([ ])  A station(, .)', 8, 20 + 9 * 17);
  ctx.fillText('F field  C chop  Q quarry  B fishery  L flax  R raid  N settler  X research  space pause', 8, 20 + 10 * 17);

  // ── Settler inspector panel (top-right) ──────────────────────────────────
  if (inspected) {
    const PW = 240, PH = 180;
    const px2 = canvas.width - PW - 8;
    ctx.fillStyle = '#000c'; ctx.fillRect(px2, 8, PW, PH);
    ctx.fillStyle = '#ffd700'; ctx.font = 'bold 13px monospace';
    ctx.fillText(inspected.name, px2 + 8, 28);
    ctx.fillStyle = '#ddd'; ctx.font = '12px monospace';
    const iline = (n: number, s: string) => ctx.fillText(s, px2 + 8, 46 + n * 16);
    iline(0, `mood ${inspected.mood.toFixed(0)}  skill ${inspected.skill.toFixed(1)}  ${inspected.state}`);
    iline(1, `food ${inspected.food.toFixed(0)}  rest ${inspected.rest.toFixed(0)}  warmth ${inspected.warmth.toFixed(0)}`);
    iline(2, `rec ${inspected.recreation.toFixed(0)}  social ${inspected.social.toFixed(0)}  hp ${inspected.health.toFixed(0)}`);
    iline(3, `armed: ${inspected.armed}  traits: ${inspected.traits.join(', ') || 'none'}`);
    const flags = [inspected.wounded && 'wounded', inspected.infected && 'infected', inspected.sick && 'sick'].filter(Boolean);
    if (flags.length) { ctx.fillStyle = '#ff6b6b'; iline(4, flags.join(' · ')); ctx.fillStyle = '#ddd'; }
    ctx.fillStyle = '#888'; ctx.font = '11px monospace';
    ctx.fillText('click agent to inspect', px2 + 8, 8 + PH - 10);
  }

  // ── Research panel (bottom-right) ────────────────────────────────────
  const rb = core.researchBook;
  const avail = rb.available();
  const done = rb.all().filter(id => id !== 'crop_rotation');
  const RPH = 16;
  const RP_ROWS = 2 + Math.min(avail.length, 5) + Math.min(done.length, 3);
  const RPW = 280, RPH_TOTAL = RP_ROWS * RPH + 16;
  const rpx = canvas.width - RPW - 8, rpy = canvas.height - RPH_TOTAL - 8;
  ctx.fillStyle = '#000a'; ctx.fillRect(rpx, rpy, RPW, RPH_TOTAL);
  ctx.fillStyle = '#ffd700'; ctx.font = 'bold 12px monospace';
  ctx.fillText(`Research  ${rb.points.toFixed(0)} pts`, rpx + 6, rpy + 14);
  ctx.font = '11px monospace';
  let row = 1;
  if (avail.length === 0) {
    ctx.fillStyle = '#888';
    ctx.fillText('(build a library + desks)', rpx + 6, rpy + 14 + row++ * RPH);
  } else {
    ctx.fillStyle = '#aae';
    ctx.fillText('Available:', rpx + 6, rpy + 14 + row++ * RPH);
    for (const t of avail.slice(0, 5)) {
      const affordable = rb.points >= t.cost;
      ctx.fillStyle = affordable ? '#88ff88' : '#aaaaff';
      const label = `  ${t.name} (${t.cost}pt) — ${t.desc.slice(0, 28)}`;
      ctx.fillText(label, rpx + 6, rpy + 14 + row++ * RPH);
    }
  }
  if (done.length > 0) {
    ctx.fillStyle = '#888'; ctx.font = '11px monospace';
    ctx.fillText(`Unlocked: ${done.slice(0, 3).join(', ')}${done.length > 3 ? '…' : ''}`, rpx + 6, rpy + 14 + row++ * RPH);
  }

  // ── Event log (bottom-left) ───────────────────────────────────────────
  const logColors = { good: '#7fe07f', bad: '#ff6b6b', info: '#d8d8d8' };
  ctx.font = '12px monospace';
  const recent = core.log.slice(-6);
  for (let k = 0; k < recent.length; k++) {
    const entry = recent[recent.length - 1 - k];
    ctx.fillStyle = logColors[entry.kind];
    ctx.fillText(`d${entry.day} ${entry.text}`, 8, canvas.height - 10 - k * 16);
  }

  // ── Pending choice modal (center) ─────────────────────────────────────
  if (core.pendingChoice) {
    const ch: PendingEventChoice = core.pendingChoice;
    const MW = 440, MH = 30 + ch.choices.length * 36 + 32;
    const mx = (canvas.width - MW) / 2;
    const my = (canvas.height - MH) / 2;
    ctx.fillStyle = '#111d'; ctx.fillRect(mx - 4, my - 4, MW + 8, MH + 8);
    ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 2;
    ctx.strokeRect(mx - 4, my - 4, MW + 8, MH + 8);
    ctx.lineWidth = 1;
    ctx.fillStyle = '#ffd700'; ctx.font = 'bold 14px monospace';
    ctx.fillText(ch.title, mx + 8, my + 18);
    ctx.fillStyle = '#ccc'; ctx.font = '12px monospace';
    ctx.fillText(ch.text, mx + 8, my + 36);
    for (let ci = 0; ci < ch.choices.length; ci++) {
      const opt = ch.choices[ci];
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
}

// ── Loop ──────────────────────────────────────────────────────────────────
let acc = 0, last = performance.now();
function loop(now: number): void {
  acc += Math.min(0.25, (now - last) / 1000) * TICKS_PER_SECOND * speed;
  last = now;
  if (!paused && !core.pendingChoice) { let guard = 0; while (acc >= 1 && guard++ < 64) { core.tick(); acc -= 1; } }
  else acc = 0;
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
