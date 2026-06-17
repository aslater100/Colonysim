/**
 * CoreView 4X — A seamless open-world 4X interface for RegionSim.
 *
 * Drop TownCore entirely. This is a pure strategic-level game:
 * - Manage abstract settlements (economy, policy, politics)
 * - Expand by buying parcels of land (wealth = scale)
 * - Trade, diplomacy, military through regional mechanics
 * - No individual settler AI, no detailed building placement
 *
 * Controls:
 *   Pan: WASD / arrow keys, middle-click drag
 *   Zoom: scroll wheel
 *   Select settlement: left-click
 *   Policy menu: click settlement → sidebar panel
 *   Speed: 1-4, Space to pause
 */

import './style.css';
import { RegionSim } from './sim/region';
import { RegionView } from './ui/regionview';
import { RegionMap } from './sim/worldgen';
import { Weather } from './sim/weather';
import { Rng } from './sim/rng';
import { TAX_BAND_LABELS, SECTOR_NAMES } from './sim/region';
import { formatCurrency } from './sim/defs';
import { buildSprites } from './ui/sprites';
import { applyOverrides } from './ui/spriteOverrides';
import { Sfx } from './ui/audio';
import { Music } from './ui/music';
import { Soundscape } from './ui/soundscape';

// Audio
const sfx = new Sfx();
const music = new Music();
const soundscape = new Soundscape();
const unlockAudio = () => { sfx.unlock(); music.unlock(); soundscape.unlock(); };
addEventListener('mousedown', unlockAudio, { once: true });
addEventListener('keydown', unlockAudio, { once: true });

// Sprites
const sprites = buildSprites([]);
void applyOverrides(sprites);

// ─────────────────────────────────────────────────────────────────────────────
// Canvas & rendering
// ─────────────────────────────────────────────────────────────────────────────

const canvas = document.querySelector('canvas')!;
const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true })!;
let cw = 0, ch = 0, DPR = 1;

function resizeCanvas() {
  DPR = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  cw = innerWidth; ch = innerHeight;
  canvas.width = Math.round(cw * DPR);
  canvas.height = Math.round(ch * DPR);
  canvas.style.width = cw + 'px';
  canvas.style.height = ch + 'px';
}
resizeCanvas();
addEventListener('resize', resizeCanvas);

// ─────────────────────────────────────────────────────────────────────────────
// Game state
// ─────────────────────────────────────────────────────────────────────────────

const seed = Date.now() % 100000;
const rng = new Rng(seed);
const map = new RegionMap(seed);
const weather = new Weather(seed);
let region = new RegionSim(rng, 0, map, weather);

let regionView: RegionView | null = null;
let paused = false;
let speed = 1;

(window as unknown as { region: RegionSim }).region = region;

// Initialize RegionView once sprites are ready
Promise.resolve().then(() => {
  regionView = new RegionView(canvas, region, document.body);
});

// ─────────────────────────────────────────────────────────────────────────────
// Input handling
// ─────────────────────────────────────────────────────────────────────────────

let panning = false;
let panLast = { x: 0, y: 0 };

// Policy button click tracking
interface PolicyButton {
  x: number; y: number; w: number; h: number;
  action: () => void;
}
let policyButtons: PolicyButton[] = [];

canvas.addEventListener('mousedown', (e) => {
  if (e.button === 1) { // middle click to pan
    panning = true;
    panLast = { x: e.clientX, y: e.clientY };
    e.preventDefault();
    return;
  }
  if (e.button === 0) { // left click
    // Check policy buttons first
    for (const btn of policyButtons) {
      if (e.clientX >= btn.x && e.clientX < btn.x + btn.w &&
          e.clientY >= btn.y && e.clientY < btn.y + btn.h) {
        btn.action();
        return;
      }
    }
    // Otherwise select settlement
    if (regionView) {
      const r = canvas.getBoundingClientRect();
      regionView.click(e.clientX - r.left, e.clientY - r.top);
    }
  }
});

canvas.addEventListener('mousemove', (e) => {
  if (panning && regionView) {
    const dx = e.clientX - panLast.x;
    const dy = e.clientY - panLast.y;
    regionView.panBy(dx, dy);
    panLast = { x: e.clientX, y: e.clientY };
  }
});

canvas.addEventListener('mouseup', () => {
  panning = false;
});

canvas.addEventListener('wheel', (e) => {
  if (regionView) {
    const dir = e.deltaY > 0 ? -1 : 1;
    regionView.zoomAt(e.clientX, e.clientY, dir);
  }
  e.preventDefault();
});

addEventListener('keydown', (e) => {
  switch (e.key.toLowerCase()) {
    case ' ': paused = !paused; break;
    case '1': speed = 1; break;
    case '2': speed = 2; break;
    case '3': speed = 3; break;
    case '4': speed = 4; break;
    case 'w': case 'arrowup': if (regionView) regionView.panBy(0, 20); break;
    case 's': case 'arrowdown': if (regionView) regionView.panBy(0, -20); break;
    case 'a': case 'arrowleft': if (regionView) regionView.panBy(20, 0); break;
    case 'd': case 'arrowright': if (regionView) regionView.panBy(-20, 0); break;
    case 'escape': if (regionView) regionView.selectedId = null; break;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Left sidebar (regional overview)
// ─────────────────────────────────────────────────────────────────────────────

function drawLeftSidebar(): void {
  const panelW = 280, pad = 8, lineH = 14;
  ctx.fillStyle = '#0b1118dd';
  ctx.fillRect(0, 0, panelW, ch);
  ctx.strokeStyle = '#33424f';
  ctx.strokeRect(0.5, 0.5, panelW - 1, ch - 1);

  ctx.font = '11px monospace';
  ctx.textAlign = 'left';

  let y = pad + 12;
  const line = (label: string, val: string | number) => {
    ctx.fillStyle = '#aab8c4';
    ctx.fillText(label, pad, y);
    ctx.fillStyle = '#dff1ff';
    ctx.textAlign = 'right';
    ctx.fillText(String(val), panelW - pad - 2, y);
    ctx.textAlign = 'left';
    y += lineH;
  };

  // Title
  ctx.fillStyle = '#7fd0f0';
  ctx.font = 'bold 13px monospace';
  ctx.fillText('Overview', pad, y);
  y += 18;

  // Regional stats
  const totalPop = region.settlements.reduce((a, s) => a + s.cohorts.bands.reduce((x, z) => x + z, 0), 0);
  const totalSats = region.settlements.reduce((a, s) => a + s.satisfaction, 0) / Math.max(1, region.settlements.length);

  line('Day', region.day);
  line('Settlements', region.settlements.length);
  line('Population', Math.round(totalPop));
  line('Avg Satisfaction', Math.round(totalSats) + '%');

  y += 4;
  ctx.fillStyle = '#666';
  ctx.fillRect(pad, y, panelW - pad * 2, 1);
  y += 12;

  // Treasury and military
  ctx.fillStyle = '#7fd0f0';
  ctx.font = 'bold 11px monospace';
  ctx.fillText('State', pad, y);
  y += 14;

  ctx.font = '10px monospace';
  line('Treasury', formatCurrency(region.treasury));
  const totalGarrison = region.settlements.reduce((a, s) => a + s.garrisonStrength, 0);
  line('Military', Math.round(totalGarrison));

  y += 4;
  ctx.fillStyle = '#666';
  ctx.fillRect(pad, y, panelW - pad * 2, 1);
  y += 12;

  // Faction info
  if (region.settlements.length > 0) {
    const faction = region.settlements[0].factionId;
    ctx.fillStyle = '#7fd0f0';
    ctx.font = 'bold 11px monospace';
    ctx.fillText('Faction', pad, y);
    y += 14;

    ctx.font = '9px monospace';
    ctx.fillStyle = '#aab8c4';
    ctx.fillText(`Faction ID: ${faction}`, pad, y);
    y += lineH;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Settlement UI panel
// ─────────────────────────────────────────────────────────────────────────────

function drawSettlementPanel(): void {
  if (!regionView || !regionView.selectedId) return;
  const s = region.settlements.find(t => t.id === regionView!.selectedId);
  if (!s) return;

  policyButtons = [];

  const panelW = 320, pad = 8, lineH = 16, btnH = 18;
  ctx.fillStyle = '#0b1118dd';
  ctx.fillRect(cw - panelW, 0, panelW, ch);
  ctx.strokeStyle = '#33424f';
  ctx.strokeRect(cw - panelW + 0.5, 0.5, panelW - 1, ch - 1);

  ctx.font = '11px monospace';
  ctx.textAlign = 'left';

  let y = pad + 12;
  const sep = () => { ctx.fillStyle = '#666'; ctx.fillRect(cw - panelW + pad, y, panelW - pad * 2, 1); y += 12; };
  const title = (t: string) => { ctx.fillStyle = '#7fd0f0'; ctx.font = 'bold 12px monospace'; ctx.fillText(t, cw - panelW + pad, y); y += 18; };
  const line = (label: string, val: string | number) => {
    ctx.font = '11px monospace'; ctx.fillStyle = '#aab8c4';
    ctx.fillText(label, cw - panelW + pad, y);
    ctx.fillStyle = '#dff1ff';
    ctx.textAlign = 'right';
    ctx.fillText(String(val), cw - panelW + panelW - pad - 2, y);
    ctx.textAlign = 'left';
    y += lineH;
  };
  const drawBtn = (x: number, w: number, label: string, onClick: () => void) => {
    const bx = cw - panelW + x, by = y;
    ctx.fillStyle = '#1a3a4a';
    ctx.fillRect(bx, by, w, btnH);
    ctx.strokeStyle = '#4a8aaa';
    ctx.strokeRect(bx + 0.5, by + 0.5, w - 1, btnH - 1);
    ctx.font = '9px monospace';
    ctx.fillStyle = '#7fd0f0';
    ctx.textAlign = 'center';
    ctx.fillText(label, bx + w / 2, by + 12);
    ctx.textAlign = 'left';
    policyButtons.push({ x: bx, y: by, w, h: btnH, action: onClick });
  };

  // Settlement header
  title(s.name);

  // Status
  const pop = s.cohorts.bands.reduce((a, b) => a + b, 0);
  line('Population', Math.round(pop));
  line('Satisfaction', Math.round(s.satisfaction) + '%');

  sep();

  // Resources
  line('Food', Math.round(s.food));
  line('Wood', Math.round(s.wood));
  line('Military', Math.round(s.garrisonStrength));

  sep();

  // Policies
  ctx.fillStyle = '#7fd0f0';
  ctx.font = 'bold 11px monospace';
  ctx.fillText('Policies', cw - panelW + pad, y);
  y += lineH + 4;

  // Tax band buttons
  ctx.font = '10px monospace';
  ctx.fillStyle = '#aab8c4';
  ctx.fillText('Tax:', cw - panelW + pad, y);
  const taxBtnW = 65;
  drawBtn(pad + 30, taxBtnW, TAX_BAND_LABELS[s.policies.taxBand], () => {
    region.setCityPolicy(s.id, 'taxBand', (s.policies.taxBand + 1) % 4);
  });
  y += btnH + 4;

  // Wage policy buttons
  ctx.fillStyle = '#aab8c4';
  ctx.fillText('Wages:', cw - panelW + pad, y);
  const wages = ['low', 'market', 'high'] as const;
  const wageLbl = wages[(wages.indexOf(s.policies.wagePolicy) + 1) % 3];
  drawBtn(pad + 40, taxBtnW, wageLbl, () => {
    const idx = wages.indexOf(s.policies.wagePolicy);
    region.setCityPolicy(s.id, 'wagePolicy', wages[(idx + 1) % 3]);
  });
  y += btnH + 4;

  // Service level buttons
  ctx.fillStyle = '#aab8c4';
  ctx.fillText('Services:', cw - panelW + pad, y);
  const svc = ['Minimal', 'Standard', 'Generous'];
  drawBtn(pad + 50, taxBtnW, svc[s.policies.serviceLevel], () => {
    region.setCityPolicy(s.id, 'serviceLevel', (s.policies.serviceLevel + 1) % 3);
  });
  y += btnH + 8;

  // Sectors
  sep();
  ctx.fillStyle = '#7fd0f0';
  ctx.font = 'bold 11px monospace';
  ctx.fillText('Employment', cw - panelW + pad, y);
  y += lineH + 4;

  ctx.font = '9px monospace';
  for (const [sid, sector] of Object.entries(s.sectors)) {
    ctx.fillStyle = '#aab8c4';
    const pct = Math.round(sector.share * 100);
    ctx.fillText(`${SECTOR_NAMES[sid as keyof typeof SECTOR_NAMES]} ${pct}%`, cw - panelW + pad, y);
    y += 12;
  }

  sep();

  // Expansion
  ctx.fillStyle = '#7fd0f0';
  ctx.font = 'bold 11px monospace';
  ctx.fillText('Development', cw - panelW + pad, y);
  y += lineH + 4;

  ctx.font = '9px monospace';
  ctx.fillStyle = '#aab8c4';
  ctx.fillText(`Housing: ${Math.round(s.housing)}`, cw - panelW + pad, y);
  y += lineH;

  const expandCost = Math.max(100, Math.round(s.housing * 25));
  const expandLabel = `Expand Parcel (£${expandCost})`;
  const canExpand = region.treasury >= expandCost;
  drawBtn(pad + 10, panelW - pad * 3, expandLabel, () => {
    if (canExpand) {
      region.treasury -= expandCost;
      s.housing += 20;
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Main loop
// ─────────────────────────────────────────────────────────────────────────────

function draw(): void {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#15151a';
  ctx.fillRect(0, 0, cw, ch);

  // Draw regional map
  if (regionView) {
    regionView.draw();
  }

  // Draw left sidebar
  drawLeftSidebar();

  // Draw settlement panel if one is selected
  drawSettlementPanel();

  // Status line
  ctx.font = '11px monospace';
  ctx.fillStyle = '#aab8c4';
  ctx.textAlign = 'left';
  ctx.fillText(`Day ${region.day} | Settlements: ${region.settlements.length} | Speed: ${speed}${paused ? ' [PAUSED]' : ''}`, 8, ch - 8);
}

// ─────────────────────────────────────────────────────────────────────────────
// Simulation tick
// ─────────────────────────────────────────────────────────────────────────────

let lastTime = performance.now();
function tick() {
  const now = performance.now();
  const dt = (now - lastTime) / 1000;
  lastTime = now;

  if (!paused) {
    // Advance simulation
    const daysToSimulate = dt * 20 * speed; // 20 days per real second at 1x
    for (let i = 0; i < Math.floor(daysToSimulate); i++) {
      region.tick();
    }
  }

  draw();
  requestAnimationFrame(tick);
}

requestAnimationFrame(tick);
