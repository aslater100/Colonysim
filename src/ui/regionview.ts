/**
 * Region view (Tier 1.5 → 2): the zoomed-out map that becomes the default
 * operating altitude after the flip (GDD §2.5). Painterly backdrop, town
 * markers, routes, expedition wagons; DOM panel for the selected settlement.
 */
import type { Settlement, GovLean, GovType, MinisterRoleId, TreatyKind, CasusBelli, Mobilization, PeaceTerm, DealBasket, OccupationPolicy, MonetaryRegime, TownFocus, WagePolicy, Route, SectorId } from '../sim/region';
import { RegionSim, AGE_BANDS, ROLE_BONUS_DESC, GOV_LEANS, GOV_TYPES, MINISTER_ROLES, RAIL_ERA_YEAR, SEA_WALL_YEAR, TECH_TREE, REGION_LAWS, POLICY_CARDS, POLICY_SWAP_COST, TREATY_DEFS, RIVAL_ARCHETYPES, ENVOY_COST, GIFT_COST, ENVOY_COOLDOWN_DAYS, GIFT_COOLDOWN_DAYS, CASUS_BELLI_DEFS, MOBILIZATION_DEFS, PEACE_TERMS, WAR_SUPPORT_FLOOR, OCCUPATION_DEFS, MAX_OCCUPIED_MARCHES, BLOCKADE_UPKEEP_PER_POP, ACCORD_DEFECT_THRESHOLD, GEOENGINEER_COOLING, MIN_POLICY_RATE, MAX_POLICY_RATE, REGION_BUILDINGS, SECTOR_IDS, SECTOR_NAMES, FOCUS_CHANGE_COST, REGION_EVENT_DEFS, TAX_BAND_LABELS, TAX_BAND_RATES, DEFAULT_CITY_POLICIES, ROUTE_SPECS, RIVAL_REGIMES, BRANCH_YEAR } from '../sim/region';
import { formatCurrency, getCurrencySymbol, CURRENCY_SYMBOLS, MINUTES_PER_DAY } from '../sim/defs';
import type { CurrencySymbol } from '../sim/defs';
import { ANNOUNCE_LEAD_DAYS } from '../sim/currency';
import { REGION_N } from '../sim/worldgen';
import { DesignScreen } from './designscreen';
import { Minimap } from './minimap';
import { sparklineGrid } from './sparklines';

/** Parse a #rrggbb (or #rgb) hex string to {r,g,b}; falls back to grey. */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  if (!Number.isFinite(n) || h.length !== 6) return { r: 136, g: 136, b: 136 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export class RegionView {
  selectedId: number | null = null;
  /** Currently highlighted rival faction (null = none). */
  selectedFactionId: number | null = null;
  /** set true by the view while the Incorporation ceremony is on screen */
  ceremonyOpen = false;
  conventionOpen = false;
  private g: CanvasRenderingContext2D;
  private panel: HTMLElement;
  private panelTab: 'overview' | 'economy' | 'people' = 'overview';
  private statePanel: HTMLElement;
  private lastStatePanelBuildFrame = -999;
  /** Active tab in the (dense) state panel — split into Finance/Politics/Diplomacy. */
  private statePanelTab: 'finance' | 'politics' | 'diplomacy' = 'finance';
  /** Sub-tab within Finance: Treasury (dashboard + controls) vs Credit (lenders/monetary/freight). */
  private financeSubTab: 'treasury' | 'credit' = 'treasury';
  private researchPanel: HTMLElement;
  researchOpen = false;
  private lastResearchBuildFrame = -999;
  private researchTab: 'tech' | 'civics' = 'tech';
  /** Phase A: the region-wide Route Network panel (toggle with the R key). */
  private routeNetworkPanel: HTMLElement;
  routeNetworkOpen = false;
  private lastNetworkBuildFrame = -999;
  /** Phase A: settlements list panel (S key). */
  private settlementListPanel: HTMLElement;
  settlementListOpen = false;
  private lastSettlementListBuildFrame = -999;
  /** Phase A/B: economy panel (E key). */
  private economyPanel: HTMLElement;
  economyOpen = false;
  private lastEconomyBuildFrame = -999;
  private economyTab: 'overview' | 'settlements' = 'overview';
  private ceremony: HTMLElement;
  private convention: HTMLElement;
  private policyModal: HTMLElement;
  private policySlotIndex = -1;
  // the bargaining table (GDD §6.3): basket state lives here while composing
  private dealModal: HTMLElement;
  private rivalPanel: HTMLElement;
  private lastRivalPanelFactionId: number | null = null;
  private dealRivalId = -1;
  private dealTreaties = new Set<TreatyKind>();
  private dealGoldToThem = 0;
  private dealGoldToYou = 0;
  private dealBorder = false;
  /** Peace terms ticked at the war room's table (GDD §7.4). */
  private peacePicks = new Set<PeaceTerm>();
  /** The Century Report (GDD §8.4): shown once at 2100, dismissible. */
  private centuryModal: HTMLElement;
  private centuryDismissed = false;
  /** Win condition modal: shown once when any path is achieved. */
  private winModal: HTMLElement;
  private winDismissed = false;
  /** Era-branch reveal modal: shown once when the century forks (GDD §3.2). */
  private eraModal: HTMLElement;
  private eraDismissed = false;
  private frame = 0;
  // ---- Static-map cache. Terrain + territory fills are O(N²) and barely change,
  //      so render them once into an offscreen canvas (base coords) and blit it
  //      under the camera each frame. Rebuilt only when the signature changes,
  //      which keeps the per-frame cost independent of REGION_N. ----
  private mapCache: HTMLCanvasElement | null = null;
  private mapCacheCtx: CanvasRenderingContext2D | null = null;
  private mapCacheSig = '';
  /** Visible region in base (pre-camera) coords — culls off-screen sprites. */
  private vb = { l: 0, t: 0, r: 0, b: 0 };
  private lastPanelBuildFrame = -999;
  private lastPanelBuildId: number | null = null;
  /** True while the inline town-rename field is open — pauses panel rebuilds so
   *  the once-per-second refresh doesn't destroy the input mid-edit. */
  private editingName = false;
  // ---- Map camera (zoom + pan). Base view (scale 1, no offset) fits the whole
  //      region; zoom in to read crowded clusters, drag/keys to roam. ----
  private camScale = 1;
  private camX = 0; // screen-px offset applied after scaling
  private camY = 0;
  private static readonly MIN_SCALE = 1;
  private static readonly MAX_SCALE = 6;
  // ---- Minimap (corner navigation aid) ----
  private minimap: Minimap;
  // ---- Tooltips (settlement hover info) ----
  private tooltip: HTMLElement;
  private tooltipSettlementId: number | null = null;

  constructor(private canvas: HTMLCanvasElement, private region: RegionSim, root: HTMLElement) {
    this.g = canvas.getContext('2d')!;
    // If the era was already decided in a prior session (loaded save), treat the
    // reveal as already dismissed — only fire for a fork that happens live here.
    this.eraDismissed = region.eraBranch !== null;
    this.panel = document.createElement('div');
    this.panel.className = 'inspector region-panel hidden';
    root.appendChild(this.panel);
    this.statePanel = document.createElement('div');
    this.statePanel.className = 'palette state-panel hidden';
    root.appendChild(this.statePanel);
    this.researchPanel = document.createElement('div');
    this.researchPanel.className = 'palette research-panel hidden';
    root.appendChild(this.researchPanel);
    this.routeNetworkPanel = document.createElement('div');
    this.routeNetworkPanel.className = 'palette route-network-panel hidden';
    root.appendChild(this.routeNetworkPanel);
    this.settlementListPanel = document.createElement('div');
    this.settlementListPanel.className = 'palette settlement-list-panel hidden';
    root.appendChild(this.settlementListPanel);
    this.economyPanel = document.createElement('div');
    this.economyPanel.className = 'palette economy-panel hidden';
    root.appendChild(this.economyPanel);
    this.ceremony = document.createElement('div');
    this.ceremony.className = 'ceremony hidden';
    root.appendChild(this.ceremony);
    this.convention = document.createElement('div');
    this.convention.className = 'ceremony hidden';
    root.appendChild(this.convention);
    this.policyModal = document.createElement('div');
    this.policyModal.className = 'ceremony hidden';
    root.appendChild(this.policyModal);
    this.dealModal = document.createElement('div');
    this.dealModal.className = 'ceremony hidden';
    root.appendChild(this.dealModal);
    this.centuryModal = document.createElement('div');
    this.centuryModal.className = 'ceremony hidden';
    root.appendChild(this.centuryModal);
    this.winModal = document.createElement('div');
    this.winModal.className = 'win-modal hidden';
    root.appendChild(this.winModal);
    this.eraModal = document.createElement('div');
    this.eraModal.className = 'win-modal hidden';
    root.appendChild(this.eraModal);
    this.rivalPanel = document.createElement('div');
    this.rivalPanel.className = 'inspector region-panel hidden';
    root.appendChild(this.rivalPanel);
    this.minimap = new Minimap(region, root, { size: 140, position: 'bottom-right' });
    // Create tooltip element
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'cv-tooltip hidden';
    root.appendChild(this.tooltip);
  }

  /** Draggable panels for the WindowManager (region mode). */
  get draggablePanels(): { id: string; element: HTMLElement; baseZ: number }[] {
    return [
      { id: 'region-selection', element: this.panel, baseZ: 20 },
      { id: 'region-state', element: this.statePanel, baseZ: 12 },
      { id: 'region-research', element: this.researchPanel, baseZ: 12 },
      { id: 'region-routes', element: this.routeNetworkPanel, baseZ: 12 },
      { id: 'region-settlements', element: this.settlementListPanel, baseZ: 12 },
      { id: 'region-economy', element: this.economyPanel, baseZ: 12 },
      { id: 'region-rival', element: this.rivalPanel, baseZ: 20 },
    ];
  }

  destroyPanel(): void {
    this.panel.remove();
    this.statePanel.remove();
    this.researchPanel.remove();
    this.routeNetworkPanel.remove();
    this.settlementListPanel.remove();
    this.economyPanel.remove();
    this.ceremony.remove();
    this.convention.remove();
    this.policyModal.remove();
    this.dealModal.remove();
    this.centuryModal.remove();
    this.winModal.remove();
    this.eraModal.remove();
    this.rivalPanel.remove();
  }

  private toPx(x: number, y: number): { px: number; py: number } {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const m = 60; // margin
    return { px: m + (x / 100) * (W - 2 * m), py: m + (y / 100) * (H - 2 * m) };
  }

  /** Has the player explored or scouted the tile under this region coord
   *  (0..100)? Used to keep undiscovered rivals hidden under the fog. */
  private revealedAt(rx: number, ry: number): boolean {
    const emap = this.region.explorationMap;
    const E = emap.length;
    const ex = Math.min(E - 1, Math.max(0, Math.floor((rx / 100) * E)));
    const ey = Math.min(E - 1, Math.max(0, Math.floor((ry / 100) * E)));
    return emap[ex][ey] !== 'fogged';
  }

  click(px: number, py: number): void {
    this.selectedId = null;
    this.selectedFactionId = null;
    // Convert the screen click into map-space (undo the camera) so hit-testing
    // matches the transformed sprites. The 26px pick radius scales with zoom.
    const mx = (px - this.camX) / this.camScale;
    const my = (py - this.camY) / this.camScale;
    const radius = 26;
    for (const t of this.region.settlements) {
      const p = this.toPx(t.x, t.y);
      if (Math.hypot(p.px - mx, p.py - my) < radius) {
        if (t.factionId === this.region.playerFactionId) {
          this.selectedId = t.id;
        } else {
          // Clicking a rival settlement opens the rival faction panel
          this.selectedFactionId = t.factionId;
        }
        return;
      }
    }
  }

  // ---- Camera controls (wired from main.ts) ----
  /** Zoom toward a screen point (wheel or +/-). dir>0 zooms in. */
  zoomAt(screenX: number, screenY: number, dir: number): void {
    const factor = dir > 0 ? 1.15 : 1 / 1.15;
    const next = Math.max(RegionView.MIN_SCALE, Math.min(RegionView.MAX_SCALE, this.camScale * factor));
    if (next === this.camScale) return;
    // Keep the map point under the cursor fixed: solve for the new offset.
    const baseX = (screenX - this.camX) / this.camScale;
    const baseY = (screenY - this.camY) / this.camScale;
    this.camScale = next;
    this.camX = screenX - baseX * next;
    this.camY = screenY - baseY * next;
    this.clampCamera();
  }

  /** Pan by a screen-space delta (drag or arrow/WASD keys). */
  panBy(dx: number, dy: number): void {
    this.camX += dx;
    this.camY += dy;
    this.clampCamera();
  }

  /** Snap back to the full-region view. */
  resetView(): void {
    this.camScale = 1;
    this.camX = 0;
    this.camY = 0;
  }

  /** Pan to a logical coordinate (0..100), centering the viewport on it. */
  panTo(regionX: number, regionY: number): void {
    const W = this.canvas.width;
    const H = this.canvas.height;
    // Convert logical coords to screen center
    const p = this.toPx(regionX, regionY);
    // Pan so that (p.px, p.py) appears at the screen center
    this.camX = W / 2 - p.px;
    this.camY = H / 2 - p.py;
    this.clampCamera();
  }

  /** Update tooltip position and visibility based on mouse position. */
  updateTooltip(screenX: number, screenY: number): void {
    const mx = (screenX - this.camX) / this.camScale;
    const my = (screenY - this.camY) / this.camScale;
    const radius = 26;
    let hoveredId: number | null = null;

    for (const t of this.region.settlements) {
      const p = this.toPx(t.x, t.y);
      if (Math.hypot(p.px - mx, p.py - my) < radius) {
        hoveredId = t.id;
        break;
      }
    }

    if (hoveredId !== this.tooltipSettlementId) {
      this.tooltipSettlementId = hoveredId;
      if (hoveredId !== null) {
        const settlement = this.region.settlement(hoveredId);
        if (settlement) {
          const pop = Math.round(this.region.popOf(settlement));
          const happy = Math.round(settlement.satisfaction || 0);
          const food = settlement.food || 0;
          const foodStatus = food < pop * 5 ? '⚠ low' : 'ok';
          this.tooltip.innerHTML = `<b>${settlement.name}</b><br>` +
            `pop ${pop} · happy ${happy}% · food ${foodStatus}`;
          this.tooltip.classList.remove('hidden');
        }
      } else {
        this.tooltip.classList.add('hidden');
      }
    }

    if (hoveredId !== null) {
      // Position tooltip near cursor, avoiding edges
      let tx = screenX + 12;
      let ty = screenY + 12;
      const rect = this.tooltip.getBoundingClientRect();
      if (tx + rect.width > window.innerWidth) tx = screenX - rect.width - 12;
      if (ty + rect.height > window.innerHeight) ty = screenY - rect.height - 12;
      this.tooltip.style.left = tx + 'px';
      this.tooltip.style.top = ty + 'px';
    }
  }

  /** Keep the scaled map from drifting off-screen; at scale 1 it stays pinned. */
  private clampCamera(): void {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const minX = W - W * this.camScale; // most-negative offset (right edge held)
    const minY = H - H * this.camScale;
    this.camX = Math.min(0, Math.max(minX, this.camX));
    this.camY = Math.min(0, Math.max(minY, this.camY));
  }

  draw(): void {
    this.frame++;
    const { g, canvas, region } = this;
    const W = canvas.width;
    const H = canvas.height;

    g.fillStyle = '#10141c';
    g.fillRect(0, 0, W, H);
    // Everything from the terrain to the expedition wagons is map-space: apply
    // the camera (zoom + pan) once here so individual draws stay in base coords.
    g.save();
    g.translate(this.camX, this.camY);
    g.scale(this.camScale, this.camScale);
    // Visible base-coord rect, for culling off-screen sprites this frame.
    this.vb = {
      l: -this.camX / this.camScale,
      t: -this.camY / this.camScale,
      r: (W - this.camX) / this.camScale,
      b: (H - this.camY) / this.camScale,
    };
    // Terrain + territory (the O(N²) layers) come from the static cache as one blit.
    this.ensureMapCache(W, H);
    g.drawImage(this.mapCache!, 0, 0);

    // Routes along their actual corridors (M6b/6c): dotted trails, solid
    // roads, cross-tied rail; line brightness is the route's condition.
    const ss = region.settlements;
    for (const r of region.routes) {
      const alpha = 0.2 + 0.6 * (r.condition / 100);
      if (r.kind === 'trail') {
        g.fillStyle = `rgba(220,210,170,${alpha})`;
        for (let i = 0; i < r.path.length; i += 2) {
          const c = region.map.cellToCoord(r.path[i].x, r.path[i].y);
          const p = this.toPx(c.rx, c.ry);
          g.fillRect(Math.round(p.px) - 1, Math.round(p.py) - 1, 2, 2);
        }
      } else {
        const pts = r.path.map((cell) => {
          const c = region.map.cellToCoord(cell.x, cell.y);
          return this.toPx(c.rx, c.ry);
        });
        g.strokeStyle = r.kind === 'rail' ? `rgba(150,156,168,${alpha})`
          : r.kind === 'highway' ? `rgba(62,66,74,${Math.min(1, alpha + 0.2)})`
          : r.kind === 'maglev' ? `rgba(110,200,214,${alpha})`
          : `rgba(216,180,106,${alpha})`;
        g.lineWidth = r.kind === 'rail' || r.kind === 'maglev' ? 3 : r.kind === 'highway' ? 4 : 2;
        g.beginPath();
        for (let i = 0; i < pts.length; i++) {
          if (i === 0) g.moveTo(pts[i].px, pts[i].py);
          else g.lineTo(pts[i].px, pts[i].py);
        }
        g.stroke();
        if (r.kind === 'highway') {
          // the dashed centerline is what makes asphalt read as asphalt
          g.fillStyle = `rgba(232,226,200,${alpha})`;
          for (let i = 0; i < pts.length; i += 2) {
            g.fillRect(Math.round(pts[i].px) - 1, Math.round(pts[i].py), 2, 1);
          }
          this.drawTruck(pts, r.condition);
        }
        if (r.kind === 'rail') {
          // cross-ties: short perpendicular ticks so steel reads as track
          g.strokeStyle = `rgba(40,36,32,${alpha})`;
          g.lineWidth = 1;
          for (let i = 1; i < pts.length - 1; i += 2) {
            const dx = pts[i + 1].px - pts[i - 1].px;
            const dy = pts[i + 1].py - pts[i - 1].py;
            const len = Math.hypot(dx, dy) || 1;
            const nx = (-dy / len) * 3;
            const ny = (dx / len) * 3;
            g.beginPath();
            g.moveTo(pts[i].px - nx, pts[i].py - ny);
            g.lineTo(pts[i].px + nx, pts[i].py + ny);
            g.stroke();
          }
          this.drawTrain(pts, r.condition);
        }
        if (r.kind === 'maglev') {
          // pylon dots beneath the line: the guideway floats above the land
          g.fillStyle = `rgba(70,120,130,${alpha})`;
          for (let i = 0; i < pts.length; i += 3) {
            g.fillRect(Math.round(pts[i].px) - 1, Math.round(pts[i].py) + 2, 2, 3);
          }
          this.drawPod(pts, r.condition);
        }
      }
    }

    // Phase 6: Cargo flow indicators — a small colored dot at each route midpoint
    const cargoRgb: Record<string, string> = {
      agriculture: '194,161,77', industry: '140,104,72', services: '74,127,164', information: '122,90,154',
    };
    for (const r of region.routes) {
      if (!r.cargoType || r.kind === 'trail' || r.path.length < 2) continue;
      const mid = r.path[Math.floor(r.path.length / 2)];
      const mc = region.map.cellToCoord(mid.x, mid.y);
      const mp = this.toPx(mc.rx, mc.ry);
      const rgb = cargoRgb[r.cargoType];
      if (!rgb) continue;
      g.fillStyle = `rgba(${rgb},0.85)`;
      g.fillRect(Math.round(mp.px) - 3, Math.round(mp.py) - 3, 6, 6);
      g.fillStyle = `rgba(10,10,10,0.7)`;
      g.fillRect(Math.round(mp.px) - 2, Math.round(mp.py) - 2, 4, 4);
      g.fillStyle = `rgba(${rgb},1)`;
      g.fillRect(Math.round(mp.px) - 1, Math.round(mp.py) - 1, 2, 2);
    }

    // Phase 0: trade-flow direction arrows along busy corridors.
    this.drawTradeFlows();

    // Towns on the rail network get a depot by the tracks — precompute the set
    // once (was an O(routes) scan per settlement → O(towns×routes)).
    const railSet = new Set<number>();
    for (const r of region.routes) if (r.kind === 'rail') { railSet.add(r.a); railSet.add(r.b); }
    // Settlements — tiered sprites: shack → cottage → house → town → manor → castle
    for (const t of ss) {
      const { px, py } = this.toPx(t.x, t.y);
      if (!this.inView(px, py, 56)) continue; // off-screen: skip sprite + labels + icons
      const pop = Math.round(region.popOf(t));
      const onRail = railSet.has(t.id);
      if (onRail) {
        const sx = px + 22;
        g.fillStyle = '#7a3b2e';
        g.fillRect(sx, py - 4, 10, 10);
        g.fillStyle = '#3a2e26';
        g.fillRect(sx - 1, py - 7, 12, 4);
        g.fillStyle = '#969ca8';
        g.fillRect(sx - 2, py + 7, 14, 2);
        g.fillStyle = '#e8d27a';
        g.fillRect(sx + 4, py - 1, 2, 2);
      }
      this.drawTownTier(px, py, pop, this.selectedId === t.id);
      g.fillStyle = '#e8d27a';
      g.font = '12px monospace';
      g.textAlign = 'center';
      g.fillText(t.name, px, py + 28);
      g.fillStyle = '#9ab0c4';
      g.font = '10px monospace';
      g.fillText(`${pop}`, px, py + 40);
      if (region.day - t.lastRaidDay < 5) {
        g.fillStyle = '#e04444';
        g.fillText('⚔', px + 22, py - 6);
      }
    }

    // Phase 0: per-settlement food/wood/goods status icons.
    this.drawResourceIndicators();

    // AI faction settlements: diamond markers with vassal badge and selection ring.
    for (const faction of region.regionalFactions) {
      if (faction.id === region.playerFactionId) continue;
      const color = faction.color ?? '#aaa';
      const isVassal = faction.overlordId === region.playerFactionId;
      for (const settlementId of faction.settlementIds) {
        const s = region.settlement(settlementId);
        if (!s) continue;
        if (!this.revealedAt(s.x, s.y)) continue; // hidden until discovered
        const { px, py } = this.toPx(s.x, s.y);
        if (!this.inView(px, py, 24)) continue;
        const selected = this.selectedFactionId === faction.id;
        // Selection halo
        if (selected) {
          g.strokeStyle = '#fff';
          g.lineWidth = 2;
          g.beginPath();
          g.arc(px, py, 14, 0, Math.PI * 2);
          g.stroke();
        }
        // Diamond marker (slightly larger: 9px for clickability)
        g.fillStyle = isVassal ? '#8fc26a' : color;
        g.beginPath();
        g.moveTo(px, py - 9);
        g.lineTo(px + 7, py);
        g.lineTo(px, py + 9);
        g.lineTo(px - 7, py);
        g.closePath();
        g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.6)';
        g.lineWidth = 1;
        g.stroke();
        if (isVassal) {
          g.fillStyle = '#fff';
          g.font = 'bold 8px monospace';
          g.textAlign = 'center';
          g.fillText('V', px, py + 3);
        }
        g.fillStyle = '#ddd';
        g.font = '9px monospace';
        g.textAlign = 'center';
        g.fillText(faction.name.slice(0, 3), px, py + 21);
      }
    }

    // AI scouts: tiny moving dots (faction-colored)
    for (const scout of region.scouts) {
      const faction = region.faction(scout.factionId);
      if (!faction || faction.id === region.playerFactionId) continue;
      if (!this.revealedAt(scout.x, scout.y)) continue; // unseen beyond the frontier
      const { px, py } = this.toPx(scout.x, scout.y);
      if (!this.inView(px, py, 16)) continue;
      const bob = Math.floor(this.frame / 20) % 2;
      g.fillStyle = faction.color ?? '#aaa';
      g.globalAlpha = 0.75;
      g.fillRect(px - 2, py - 2 - bob, 4, 4);
      g.globalAlpha = 1;
    }

    // Expeditions: a wagon dot crawling to its site
    for (const e of region.expeditions) {
      const { px, py } = this.toPx(e.x, e.y);
      const target = this.toPx(e.targetX, e.targetY);
      if (!this.inView(px, py, 48) && !this.inView(target.px, target.py, 48)) continue;
      g.fillStyle = 'rgba(220,210,170,0.25)';
      g.fillRect(target.px - 4, target.py - 4, 8, 8);
      const bob = Math.floor(this.frame / 15) % 2;
      g.fillStyle = '#c2a14d';
      g.fillRect(px - 4, py - 3 - bob, 8, 6);
      g.fillStyle = '#1a1410';
      g.fillRect(px - 4, py + 3 - bob, 2, 2);
      g.fillRect(px + 2, py + 3 - bob, 2, 2);
      g.fillStyle = '#dfe6ee';
      g.font = '11px monospace';
      g.textAlign = 'center';
      g.fillText(`→ ${e.name}`, px, py - 8);
    }
    g.textAlign = 'left';

    // Animated water shimmer (per-frame overlay, static map cache can't animate)
    this.drawWaterAnimation();

    // City lights pop on the map as dusk falls (still in map-space).
    const lit = this.atmosphere();
    this.drawCityLights(lit);

    g.restore(); // end map-space; HUD below draws in screen space

    // Draw the minimap in the corner, showing camera frame.
    this.minimap.draw(this.camX, this.camY, this.camScale, W, H);

    // Time-of-day + seasonal tint and a soft vignette frame the whole scene.
    this.drawAtmosphere(W, H, lit);

    // Charter banner — the path to the State. Each requirement reads as a
    // ✓/✗ chip so the player can see exactly what still blocks Incorporation.
    // Drawn above the 44px DOM bottombar (which always renders over the canvas),
    // so the banner clears it instead of hiding behind the S/R/E/T buttons.
    const barTop = H - 52; // top of the banner's reserved strip (above bottombar)
    if (!region.stateProclaimed) {
      if (region.ceremonyPending || region.charterEligible()) {
        g.font = 'bold 13px monospace';
        const need = region.ceremonyPending
          ? 'The Charter is drafted — the towns await your proclamation.'
          : `Regional Charter being drafted… ${Math.floor(region.charterProgress)}%`;
        const bw = Math.max(460, g.measureText(need).width + 28);
        g.fillStyle = 'rgba(12,10,7,0.94)';
        g.fillRect(W / 2 - bw / 2, barTop - 32, bw, 32);
        g.strokeStyle = 'rgba(143,194,106,0.5)';
        g.strokeRect(W / 2 - bw / 2 + 0.5, barTop - 32 + 0.5, bw - 1, 31);
        g.fillStyle = '#a8e06a';
        g.textAlign = 'center';
        g.fillText(need, W / 2, barTop - 11);
        g.textAlign = 'left';
      } else {
        // Not yet eligible: draw the gate chips, color-coded, centered.
        const gates = region.charterGates();
        g.font = 'bold 13px monospace';
        const head = 'Toward Statehood — ';
        const segs = gates.map((gt) => ({
          text: `${gt.met ? '✓' : '✗'} ${gt.label} ${gt.detail}`,
          color: gt.met ? '#a8e06a' : '#f0a868',
        }));
        const sep = '   ';
        const totalW = g.measureText(head).width +
          segs.reduce((w, s, i) => w + g.measureText(s.text).width + (i ? g.measureText(sep).width : 0), 0);
        const bw = Math.max(460, totalW + 28);
        g.fillStyle = 'rgba(12,10,7,0.94)';
        g.fillRect(W / 2 - bw / 2, barTop - 32, bw, 32);
        g.strokeStyle = 'rgba(143,194,106,0.45)';
        g.strokeRect(W / 2 - bw / 2 + 0.5, barTop - 32 + 0.5, bw - 1, 31);
        let x = W / 2 - totalW / 2;
        const y = barTop - 11;
        g.textAlign = 'left';
        g.fillStyle = '#fffcf0';
        g.fillText(head, x, y);
        x += g.measureText(head).width;
        for (let i = 0; i < segs.length; i++) {
          if (i) { g.fillStyle = '#7a7060'; g.fillText(sep, x, y); x += g.measureText(sep).width; }
          g.fillStyle = segs[i].color;
          g.fillText(segs[i].text, x, y);
          x += g.measureText(segs[i].text).width;
        }
      }
    } else if (!region.nationProclaimed) {
      // State proclaimed but nation not yet: show convention gate chips
      const gates = region.canCallConventionGates();
      const allMet = gates.every(gt => gt.met);
      if (allMet) {
        g.fillStyle = 'rgba(110,74,47,0.94)';
        g.fillRect(W / 2 - 260, barTop - 30, 520, 30);
        g.fillStyle = '#e8d27a';
        g.font = 'bold 13px monospace';
        g.textAlign = 'center';
        g.fillText(`★ ${region.stateName.toUpperCase()} — Convention ready. Open the State panel. ★`, W / 2, barTop - 10);
        g.textAlign = 'left';
      } else {
        g.font = 'bold 13px monospace';
        const head = `${region.stateName} — Toward Nationhood: `;
        const segs = gates.filter(gt => !gt.met).map((gt) => ({
          text: `✗ ${gt.label}${gt.detail ? ' ' + gt.detail : ''}`,
          color: '#f0a868',
        }));
        const sep = '   ';
        const totalW = g.measureText(head).width +
          segs.reduce((w, s, i) => w + g.measureText(s.text).width + (i ? g.measureText(sep).width : 0), 0);
        const bw = Math.max(460, totalW + 28);
        g.fillStyle = 'rgba(12,10,7,0.94)';
        g.fillRect(W / 2 - bw / 2, barTop - 32, bw, 32);
        g.strokeStyle = 'rgba(232,210,122,0.35)';
        g.strokeRect(W / 2 - bw / 2 + 0.5, barTop - 32 + 0.5, bw - 1, 31);
        let x = W / 2 - totalW / 2;
        const y = barTop - 11;
        g.textAlign = 'left';
        g.fillStyle = '#e8d27a';
        g.fillText(head, x, y);
        x += g.measureText(head).width;
        for (let i = 0; i < segs.length; i++) {
          if (i) { g.fillStyle = '#7a7060'; g.fillText(sep, x, y); x += g.measureText(sep).width; }
          g.fillStyle = segs[i].color;
          g.fillText(segs[i].text, x, y);
          x += g.measureText(segs[i].text).width;
        }
      }
    } else {
      // Nation proclaimed: show nation name banner
      g.fillStyle = 'rgba(110,74,47,0.92)';
      g.fillRect(W / 2 - 200, barTop - 30, 400, 30);
      g.fillStyle = '#e8d27a';
      g.font = 'bold 14px monospace';
      g.textAlign = 'center';
      g.fillText(`★ ${region.nationName.toUpperCase()} ★`, W / 2, barTop - 10);
      g.textAlign = 'left';
    }

    this.drawRivalBanners(W, H);
    this.drawWeather(W, H);
    this.drawPanel();
    this.drawRivalPanel();
    this.drawStatePanel();
    this.drawResearchPanel();
    this.drawRouteNetworkPanel();
    this.drawSettlementListPanel();
    this.drawEconomyPanel();
    this.drawCeremony();
    this.drawConvention();
    this.drawCenturyReport();
    this.drawEraModal();
    this.drawWinModal();
  }

  /** Cheap fingerprint of everything the cached terrain+territory layer depends
   *  on. Terrain is fixed after worldgen; territory shifts only when a settlement
   *  is founded/taken/relocated — so hash size + each town's id/owner/position. */
  private mapCacheSignature(): string {
    const r = this.region;
    let s = `${this.canvas.width}x${this.canvas.height}|${r.regionalFactions.length}`;
    for (const t of r.settlements) s += `;${t.id},${t.factionId},${Math.round(t.x)},${Math.round(t.y)}`;
    // Fog-of-war frontier: rebuild the cache as the explored count advances
    // (reveals are monotonic, so a running count is a sufficient change key).
    let explored = 0;
    for (const col of r.explorationMap) for (const v of col) if (v !== 'fogged') explored++;
    s += `|fog${explored}`;
    return s;
  }

  /** Rebuild the offscreen terrain+territory canvas only when its signature
   *  changes; otherwise the per-frame map cost is a single drawImage. */
  private ensureMapCache(W: number, H: number): void {
    const sig = this.mapCacheSignature();
    if (this.mapCache && this.mapCacheSig === sig && this.mapCache.width === W && this.mapCache.height === H) return;
    if (!this.mapCache) this.mapCache = document.createElement('canvas');
    if (this.mapCache.width !== W || this.mapCache.height !== H) {
      this.mapCache.width = W;
      this.mapCache.height = H;
      this.mapCacheCtx = this.mapCache.getContext('2d');
    }
    const cg = this.mapCacheCtx!;
    cg.clearRect(0, 0, W, H);
    this.drawTerrain(cg, W, H);
    this.drawTerritories(cg, W, H);
    this.drawFog(cg, W, H);
    this.mapCacheSig = sig;
  }

  /** Compute the current lighting state from the in-game clock + season: a
   *  night factor (0 day … 1 deep night), a warm golden-hour amount at dawn/
   *  dusk, and the season index. Drives both the city-light glows and the
   *  full-screen tint so they stay in sync. */
  private atmosphere(): { night: number; golden: number; season: number } {
    const dayFrac = (this.region.minute % MINUTES_PER_DAY) / MINUTES_PER_DAY; // 0 = midnight
    const sun = Math.sin(dayFrac * Math.PI); // 0 at midnight, 1 at noon
    const night = Math.pow(Math.max(0, 1 - sun), 1.5);
    // Golden hour peaks mid-morning (~05:00) and mid-evening (~19:00).
    const bump = (c: number) => Math.max(0, 1 - Math.abs(dayFrac - c) / 0.09);
    const golden = Math.min(1, bump(0.22) + bump(0.78));
    return { night, golden, season: this.region.seasonIndex };
  }

  /** Warm hearth-glow under each known settlement once dusk sets in — scaled by
   *  population so cities blaze and hamlets flicker. Drawn in map-space. */
  private drawCityLights(lit: { night: number }): void {
    if (lit.night < 0.15) return;
    const { g, region } = this;
    g.globalCompositeOperation = 'lighter';
    for (const t of region.settlements) {
      if (!this.revealedAt(t.x, t.y)) continue;
      const { px, py } = this.toPx(t.x, t.y);
      if (!this.inView(px, py, 40)) continue;
      const pop = region.popOf(t);
      const radius = 10 + Math.min(26, Math.sqrt(pop) * 1.6);
      const a = lit.night * Math.min(0.7, 0.28 + pop / 4000);
      const grad = g.createRadialGradient(px, py, 0, px, py, radius);
      grad.addColorStop(0, `rgba(255,214,140,${a})`);
      grad.addColorStop(0.5, `rgba(240,170,90,${a * 0.45})`);
      grad.addColorStop(1, 'rgba(240,170,90,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(px, py, radius, 0, Math.PI * 2);
      g.fill();
    }
    g.globalCompositeOperation = 'source-over';
  }

  /** Subtle per-frame water shimmer to suggest flow and life (map-space overlay). */
  private drawWaterAnimation(): void {
    const { g, region } = this;
    const map = region.map;
    const N = REGION_N;
    const wave = Math.sin(this.frame * 0.05) * 0.5 + 0.5; // 0..1, cycles every ~126 frames
    const m = 60;
    const cw = (this.canvas.width - 2 * m) / N;
    const ch = (this.canvas.height - 2 * m) / N;
    const isWater = (x: number, y: number): boolean =>
      x >= 0 && y >= 0 && x < N && y < N && RegionView.WATER_BIOMES.has(map.at(x, y).biome);

    g.globalCompositeOperation = 'overlay';
    g.fillStyle = `rgba(200, 220, 240, ${wave * 0.04})`; // very subtle shimmer
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        if (!isWater(x, y)) continue;
        const bx = Math.floor(m + x * cw);
        const by = Math.floor(m + y * ch);
        const bw = Math.ceil(cw);
        const bh = Math.ceil(ch);
        g.fillRect(bx, by, bw, bh);
      }
    }
    g.globalCompositeOperation = 'source-over';
  }

  /** Full-screen atmospheric pass (screen-space): a night/golden-hour tint, a
   *  subtle seasonal wash, and a vignette. Cheap — a few rects + one gradient. */
  private drawAtmosphere(W: number, H: number, lit: { night: number; golden: number; season: number }): void {
    const { g } = this;
    // Deep-night cool overlay.
    if (lit.night > 0.01) {
      g.fillStyle = `rgba(12,20,46,${(0.5 * lit.night).toFixed(3)})`;
      g.fillRect(0, 0, W, H);
    }
    // Golden hour warmth at dawn/dusk.
    if (lit.golden > 0.01) {
      g.fillStyle = `rgba(232,150,72,${(0.20 * lit.golden).toFixed(3)})`;
      g.fillRect(0, 0, W, H);
    }
    // Seasonal wash — faint, so it colours the mood without fighting the map.
    const seasonTint = ['rgba(120,180,96,0.07)', 'rgba(255,206,120,0.06)', 'rgba(208,138,60,0.08)', 'rgba(150,182,224,0.09)'][lit.season] ?? '';
    if (seasonTint) { g.fillStyle = seasonTint; g.fillRect(0, 0, W, H); }
    // Vignette: a darkened frame that draws the eye inward.
    const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.36, W / 2, H / 2, Math.max(W, H) * 0.72);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(4,6,12,0.5)');
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H);
  }

  /** Fog of war: the world beyond the explored frontier lies under a soft,
   *  cloud-mottled shroud. Cells you have never seen ('fogged') sink under a
   *  near-opaque veil; the frontier feathers (lighter where it abuts known
   *  ground) so the discovered map melts into the unknown rather than ending at
   *  a hard rectangle. Baked into the map cache (over terrain + territory, so
   *  undiscovered rivals stay hidden) and rebuilt when the frontier advances. */
  private drawFog(g: CanvasRenderingContext2D, W: number, H: number): void {
    const N = REGION_N;
    const m = 60;
    const cw = (W - 2 * m) / N;
    const ch = (H - 2 * m) / N;
    const known = (cx: number, cy: number): boolean => {
      if (cx < 0 || cy < 0 || cx >= N || cy >= N) return false;
      return this.revealedAt((cx / N) * 100, (cy / N) * 100);
    };
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        if (known(x, y)) continue;
        // Feather toward the frontier: any known neighbour thins the veil.
        const frontier =
          known(x - 1, y) || known(x + 1, y) || known(x, y - 1) || known(x, y + 1) ||
          known(x - 1, y - 1) || known(x + 1, y - 1) || known(x - 1, y + 1) || known(x + 1, y + 1);
        const bx = Math.floor(m + x * cw);
        const by = Math.floor(m + y * ch);
        const bw = Math.ceil(cw);
        const bh = Math.ceil(ch);
        // Painterly cloud mottle so the shroud reads as drifting fog, not a slab.
        const hash = (x * 374761393 ^ y * 668265263) >>> 0;
        const mottle = ((hash % 7) - 3) * 0.012;
        const base = frontier ? 0.48 : 0.9;
        g.fillStyle = `rgba(9,13,21,${Math.max(0, Math.min(0.96, base + mottle))})`;
        g.fillRect(bx, by, bw, bh);
        // A cool, sparse cloud highlight catching light over the deep unknown.
        if (!frontier && (hash >> 4) % 6 === 0) {
          g.fillStyle = 'rgba(74,88,116,0.10)';
          g.fillRect(bx, by, bw, bh);
        }
      }
    }
  }

  /** Is a base-coord point within the current viewport (plus margin)? */
  private inView(px: number, py: number, margin: number): boolean {
    const vb = this.vb;
    return px >= vb.l - margin && px <= vb.r + margin && py >= vb.t - margin && py <= vb.b + margin;
  }

  /** Phase 0: territory borders — translucent control zones plus thick frontier
   *  lines, so the map reads as contested ground at a glance. Drawn under routes
   *  and settlements; faction-coloured (player blue, rivals their own hues). */
  private drawTerritories(g: CanvasRenderingContext2D, W: number, H: number): void {
    const { region } = this;
    const N = REGION_N;
    const { grid } = region.computeTerritoryGrid();
    const m = 60;
    const cw = (W - 2 * m) / N; // cell footprint in px
    const ch = (H - 2 * m) / N;
    const colorCache = new Map<number, { r: number; g: number; b: number } | null>();
    const rgbOf = (fid: number): { r: number; g: number; b: number } | null => {
      if (fid < 0) return null;
      if (colorCache.has(fid)) return colorCache.get(fid)!;
      const col = region.faction(fid)?.color ?? '#888888';
      const rgb = hexToRgb(col);
      colorCache.set(fid, rgb);
      return rgb;
    };
    // 1) translucent interior fills
    for (let x = 0; x < N; x++) {
      for (let y = 0; y < N; y++) {
        const rgb = rgbOf(grid[x * N + y]);
        if (!rgb) continue;
        const p = this.toPx((x / N) * 100, (y / N) * 100);
        g.fillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},0.12)`;
        g.fillRect(p.px, p.py, Math.ceil(cw) + 1, Math.ceil(ch) + 1);
      }
    }
    // 2) frontier lines: any edge where a claimed cell meets a different owner
    g.lineWidth = 2;
    for (let x = 0; x < N; x++) {
      for (let y = 0; y < N; y++) {
        const fid = grid[x * N + y];
        const rgb = rgbOf(fid);
        if (!rgb) continue;
        const p = this.toPx((x / N) * 100, (y / N) * 100);
        g.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},0.85)`;
        const edge = (nx: number, ny: number, x0: number, y0: number, x1: number, y1: number): void => {
          const nb = nx >= 0 && nx < N && ny >= 0 && ny < N ? grid[nx * N + ny] : -9;
          if (nb === fid) return;
          g.beginPath();
          g.moveTo(p.px + x0, p.py + y0);
          g.lineTo(p.px + x1, p.py + y1);
          g.stroke();
        };
        edge(x + 1, y, cw, 0, cw, ch); // right
        edge(x - 1, y, 0, 0, 0, ch); // left
        edge(x, y + 1, 0, ch, cw, ch); // bottom
        edge(x, y - 1, 0, 0, cw, 0); // top
      }
    }
  }

  /** Phase 0: at-a-glance resource health under each settlement — three small
   *  squares (Food, Wood, Goods) coloured green/yellow/red. */
  private drawResourceIndicators(): void {
    const { g, region } = this;
    const statusColor: Record<string, string> = {
      surplus: '#4caf50', balanced: '#c2a14d', deficit: '#e04444',
    };
    for (const t of region.settlements) {
      const { px, py } = this.toPx(t.x, t.y);
      if (!this.inView(px, py, 56)) continue;
      const rs = region.getSettlementResourceStatus(t);
      const cells: [string, string][] = [['F', rs.food], ['W', rs.wood], ['G', rs.goods]];
      const bw = 7;
      const gap = 3;
      const total = cells.length * bw + (cells.length - 1) * gap;
      let bx = Math.round(px - total / 2);
      const by = Math.round(py + 46);
      for (const [label, st] of cells) {
        g.fillStyle = 'rgba(10,12,18,0.75)';
        g.fillRect(bx - 1, by - 1, bw + 2, bw + 2);
        g.fillStyle = statusColor[st] ?? '#888';
        g.fillRect(bx, by, bw, bw);
        g.fillStyle = '#0a0c12';
        g.font = '7px monospace';
        g.textAlign = 'center';
        g.fillText(label, bx + bw / 2, by + bw - 1);
        bx += bw + gap;
      }
    }
    g.textAlign = 'left';
  }

  /** Phase 0: direction arrows on busy trade corridors, coloured by cargo and
   *  scaled by freight, so flow and its bearing read from the map. */
  private drawTradeFlows(): void {
    const { region } = this;
    const cargoRgb: Record<string, string> = {
      agriculture: '194,161,77', industry: '140,104,72', services: '74,127,164', information: '122,90,154',
    };
    for (const r of region.routes) {
      if (r.path.length < 3 || r.freight <= 0) continue;
      const rgb = (r.cargoType && cargoRgb[r.cargoType]) || '200,200,200';
      const size = 4 + Math.min(4, Math.log10(1 + r.freight));
      for (const f of [0.4, 0.7]) {
        const i = Math.max(1, Math.min(r.path.length - 1, Math.floor(r.path.length * f)));
        const c0 = region.map.cellToCoord(r.path[i - 1].x, r.path[i - 1].y);
        const c1 = region.map.cellToCoord(r.path[i].x, r.path[i].y);
        const p0 = this.toPx(c0.rx, c0.ry);
        const p1 = this.toPx(c1.rx, c1.ry);
        const ang = Math.atan2(p1.py - p0.py, p1.px - p0.px);
        this.drawArrowHead(p1.px, p1.py, ang, size, `rgba(${rgb},0.9)`);
      }
    }
  }

  private drawArrowHead(x: number, y: number, ang: number, size: number, color: string): void {
    const { g } = this;
    g.save();
    g.translate(x, y);
    g.rotate(ang);
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(size, 0);
    g.lineTo(-size, -size * 0.7);
    g.lineTo(-size, size * 0.7);
    g.closePath();
    g.fill();
    g.restore();
  }

  /** Rival nations loom at the map's edge (GDD §6.4): a flag, a name, and
   *  the relations number — the world beyond the valley, read at a glance. */
  private drawRivalBanners(W: number, H: number): void {
    const { g, region } = this;
    const edgeIdx = { north: 0, east: 0, south: 0, west: 0 };
    for (const rv of region.rivals) {
      const rel = Math.round(rv.relations);
      const col = rel >= 25 ? '#8fc26a' : rel >= -25 ? '#c2a14d' : '#e04444';
      const i = edgeIdx[rv.compass]++;
      let x: number, y: number;
      switch (rv.compass) {
        case 'north': x = W / 2 + (i - 0.5) * 220; y = 18; break;
        case 'south': x = 150 + i * 220; y = H - 18; break;
        case 'east': x = W - 110; y = H / 2 + (i - 0.5) * 56; break;
        default: x = 110; y = H / 2 + (i - 0.5) * 56; break; // west
      }
      // a power at war flies a battle streamer
      const atWar = region.foreignWars.some((w) => w.a === rv.id || w.b === rv.id);
      const label = `${atWar ? '⚔ ' : ''}${rv.name} ${rel >= 0 ? '+' : ''}${rel}`;
      g.font = '11px monospace';
      const tw = g.measureText(label).width;
      g.fillStyle = 'rgba(16,14,10,0.8)';
      g.fillRect(x - tw / 2 - 16, y - 10, tw + 32, 20);
      // the flag: a chip of bunting in the relation's color
      g.fillStyle = col;
      g.fillRect(x - tw / 2 - 12, y - 6, 8, 6);
      g.fillStyle = '#5a4a36';
      g.fillRect(x - tw / 2 - 13, y - 6, 1, 12);
      g.fillStyle = '#dfe6ee';
      g.textAlign = 'left';
      g.fillText(label, x - tw / 2, y + 4);
    }
  }

  /** Rendering flavor only (transportation.md §7: links-not-vehicles) —
   *  a little engine shuttles each rail line, smoke trailing. */
  private drawTrain(pts: { px: number; py: number }[], condition: number): void {
    if (pts.length < 2 || condition <= 20) return; // a washed-out line falls silent
    const { g } = this;
    const span = (pts.length - 1) * 2;
    const t = Math.floor(this.frame / 4) % span;
    const i = t < pts.length - 1 ? t : span - t; // out and back
    const p = pts[Math.max(0, Math.min(pts.length - 1, i))];
    g.fillStyle = '#23262c';
    g.fillRect(Math.round(p.px) - 3, Math.round(p.py) - 3, 7, 5); // the engine
    g.fillStyle = '#c2a14d';
    g.fillRect(Math.round(p.px) - 2, Math.round(p.py) - 2, 2, 2); // brass boiler glint
    const puff = Math.floor(this.frame / 8) % 3;
    g.fillStyle = 'rgba(220,224,230,0.5)';
    g.fillRect(Math.round(p.px) + 1, Math.round(p.py) - 6 - puff, 2 + puff, 2); // smoke
  }

  /** Freight trucks shuttle the highways — same flavor-only rule as trains. */
  private drawTruck(pts: { px: number; py: number }[], condition: number): void {
    if (pts.length < 2 || condition <= 20) return;
    const { g } = this;
    const span = (pts.length - 1) * 2;
    const t = Math.floor(this.frame / 3) % span; // asphalt is quick
    const i = t < pts.length - 1 ? t : span - t;
    const p = pts[Math.max(0, Math.min(pts.length - 1, i))];
    g.fillStyle = '#8c2f24'; // a red hauler
    g.fillRect(Math.round(p.px) - 2, Math.round(p.py) - 3, 5, 4);
    g.fillStyle = '#dfe6ee';
    g.fillRect(Math.round(p.px) + 1, Math.round(p.py) - 2, 1, 1); // windscreen glint
  }

  /** A maglev pod glides the guideway — fastest of the flavor fleet. */
  private drawPod(pts: { px: number; py: number }[], condition: number): void {
    if (pts.length < 2 || condition <= 20) return; // a downed pylon stops the line
    const { g } = this;
    const span = (pts.length - 1) * 2;
    const t = Math.floor(this.frame / 2) % span; // nothing on the map moves quicker
    const i = t < pts.length - 1 ? t : span - t;
    const p = pts[Math.max(0, Math.min(pts.length - 1, i))];
    g.fillStyle = '#dfe9ee'; // a white bullet
    g.fillRect(Math.round(p.px) - 3, Math.round(p.py) - 3, 7, 3);
    g.fillStyle = '#6ec8d6';
    g.fillRect(Math.round(p.px) - 3, Math.round(p.py) - 1, 7, 1); // the field glow beneath
  }

  /** Pixel-art town sprite scaled by population tier:
   *  <30 shack, 30-80 cottage, 80-200 house, 200-500 town, 500-1k manor, 1k+ castle */
  private drawTownTier(px: number, py: number, pop: number, selected: boolean): void {
    const g = this.g;
    // shadow / ground plate
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(px - 16, py + 8, 32, 4);

    if (pop < 30) {
      // Shack: one tiny building, rough timber
      g.fillStyle = '#4a3822';
      g.fillRect(px - 6, py - 4, 12, 12);
      g.fillStyle = '#2e2018';
      g.fillRect(px - 7, py - 8, 14, 5); // lean-to roof
      g.fillStyle = '#c2a14d';
      g.fillRect(px - 1, py - 2, 2, 4); // door
    } else if (pop < 80) {
      // Cottage: tidy house with chimney
      g.fillStyle = '#6e4a2f';
      g.fillRect(px - 8, py - 4, 16, 12);
      g.fillStyle = '#3a2e26';
      g.fillRect(px - 9, py - 10, 18, 7); // gable roof
      g.fillStyle = '#554030';
      g.fillRect(px + 3, py - 15, 4, 6); // chimney
      g.fillStyle = '#e8d27a';
      g.fillRect(px - 4, py - 1, 3, 3); // window
      g.fillRect(px + 2, py - 1, 3, 3);
    } else if (pop < 200) {
      // House: proper two-story with detail
      g.fillStyle = '#7a5840';
      g.fillRect(px - 10, py - 8, 20, 16);
      g.fillStyle = '#3a2e26';
      g.fillRect(px - 11, py - 14, 22, 7);
      g.fillStyle = '#554030';
      g.fillRect(px + 5, py - 19, 4, 6);
      g.fillStyle = '#1a1410';
      g.fillRect(px - 3, py - 3, 6, 8); // door arch
      g.fillStyle = '#e8d27a';
      g.fillRect(px - 8, py - 5, 3, 3);
      g.fillRect(px + 5, py - 5, 3, 3);
      g.fillRect(px - 8, py + 2, 3, 3);
      g.fillRect(px + 5, py + 2, 3, 3);
    } else if (pop < 500) {
      // Town: cluster of buildings with a central hall
      g.fillStyle = '#8c6848';
      g.fillRect(px - 14, py - 6, 28, 14); // base block
      g.fillStyle = '#6e4a2f';
      g.fillRect(px - 7, py - 12, 14, 18); // central hall taller
      g.fillStyle = '#2e2018';
      g.fillRect(px - 15, py - 10, 30, 5); // wide roof
      g.fillStyle = '#3a2e26';
      g.fillRect(px - 8, py - 16, 16, 5); // peaked center
      g.fillStyle = '#e8d27a';
      g.fillRect(px - 5, py - 9, 3, 4);
      g.fillRect(px + 2, py - 9, 3, 4);
      g.fillStyle = '#c2a14d';
      g.fillRect(px - 1, py - 1, 2, 6); // central door
      // flanking cottages
      g.fillStyle = '#6e4a2f';
      g.fillRect(px - 14, py - 4, 6, 10);
      g.fillRect(px + 8, py - 4, 6, 10);
      g.fillStyle = '#3a2e26';
      g.fillRect(px - 15, py - 8, 8, 5);
      g.fillRect(px + 7, py - 8, 8, 5);
    } else if (pop < 1000) {
      // Manor: grand estate with towers
      g.fillStyle = '#9a7858';
      g.fillRect(px - 16, py - 8, 32, 16);
      g.fillStyle = '#7a5840';
      g.fillRect(px - 10, py - 14, 20, 22);
      g.fillStyle = '#2e2018';
      g.fillRect(px - 17, py - 12, 34, 5);
      g.fillStyle = '#3a2e26';
      g.fillRect(px - 11, py - 18, 22, 5);
      // corner towers
      g.fillStyle = '#5a4030';
      g.fillRect(px - 18, py - 14, 6, 18);
      g.fillRect(px + 12, py - 14, 6, 18);
      g.fillStyle = '#2e2018';
      g.fillRect(px - 19, py - 18, 8, 5);
      g.fillRect(px + 11, py - 18, 8, 5);
      g.fillStyle = '#e8d27a';
      g.fillRect(px - 7, py - 10, 3, 4);
      g.fillRect(px + 4, py - 10, 3, 4);
      g.fillRect(px - 7, py - 2, 3, 4);
      g.fillRect(px + 4, py - 2, 3, 4);
      g.fillStyle = '#c2a14d';
      g.fillRect(px - 2, py - 4, 4, 8);
    } else {
      // Castle: fortified keep with battlements
      g.fillStyle = '#6a6358';
      g.fillRect(px - 18, py - 10, 36, 18); // curtain wall
      g.fillStyle = '#7a7060';
      g.fillRect(px - 12, py - 18, 24, 26); // keep
      // battlements
      g.fillStyle = '#5a5448';
      for (let bx = -16; bx <= 12; bx += 4) {
        g.fillRect(px + bx, py - 13, 3, 4);
      }
      for (let bx = -10; bx <= 8; bx += 4) {
        g.fillRect(px + bx, py - 21, 3, 4);
      }
      // windows
      g.fillStyle = '#e8d27a';
      g.fillRect(px - 8, py - 14, 3, 4);
      g.fillRect(px + 5, py - 14, 3, 4);
      g.fillRect(px - 8, py - 5, 3, 4);
      g.fillRect(px + 5, py - 5, 3, 4);
      g.fillStyle = '#c2a14d';
      g.fillRect(px - 2, py - 4, 4, 12); // gate
      g.fillStyle = '#3a2e26';
      g.fillRect(px - 1, py - 6, 2, 3); // portcullis
    }
    // selection glow
    if (selected) {
      g.strokeStyle = '#e8d27a';
      g.lineWidth = 2;
      g.strokeRect(px - 20, py - 24, 40, 36);
      g.lineWidth = 1;
    }
  }

  private static readonly WATER_BIOMES = new Set(['sea', 'lake', 'river']);

  /** The generated land itself, in 8-bit blocks: this map IS the world. */
  private drawTerrain(g: CanvasRenderingContext2D, W: number, H: number): void {
    const { region } = this;
    const map = region.map;
    const N = REGION_N;
    const m = 60;
    const cw = (W - 2 * m) / N;
    const ch = (H - 2 * m) / N;
    const isWater = (x: number, y: number): boolean =>
      x >= 0 && y >= 0 && x < N && y < N && RegionView.WATER_BIOMES.has(map.at(x, y).biome);
    const touchesLand = (x: number, y: number): boolean =>
      !isWater(x - 1, y) || !isWater(x + 1, y) || !isWater(x, y - 1) || !isWater(x, y + 1);
    const touchesWater = (x: number, y: number): boolean =>
      isWater(x - 1, y) || isWater(x + 1, y) || isWater(x, y - 1) || isWater(x, y + 1);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const c = map.at(x, y);
        const bx = Math.floor(m + x * cw);
        const by = Math.floor(m + y * ch);
        const bw = Math.ceil(cw);
        const bh = Math.ceil(ch);
        // Base biome colour
        let col: string;
        switch (c.biome) {
          case 'sea': {
            // Continuous depth ramp: open ocean sinks toward near-black blue,
            // shelf water lifts toward a teal shore — the map reads as bathymetry.
            const d = Math.max(0, Math.min(1, -c.elevation / 0.6));
            col = `rgb(${Math.round(40 - 22 * d)},${Math.round(64 - 30 * d)},${Math.round(86 - 36 * d)})`;
            break;
          }
          case 'lake':      col = '#2e4a5c'; break;
          case 'river':     col = '#36586e'; break;
          case 'marsh':     col = '#39503e'; break;
          case 'plains':    col = c.elevation > 0.35 ? '#4e5e40' : '#46563a'; break;
          case 'forest':    col = c.elevation > 0.4 ? '#2e4826' : '#33502c'; break;
          case 'hills':     col = c.elevation > 0.6 ? '#6a6450' : '#5a5742'; break;
          case 'mountains': col = c.elevation > 0.88 ? '#d0cec8' : c.elevation > 0.78 ? '#a8a49c' : '#7a7060'; break;
          default:          col = '#46563a';
        }
        g.fillStyle = col;
        g.fillRect(bx, by, bw, bh);

        const water = RegionView.WATER_BIOMES.has(c.biome);
        // Coastal shallows: water cells touching land get a turquoise rim — the
        // single biggest readability win, giving the map a real coastline.
        if (water && c.biome !== 'river' && touchesLand(x, y)) {
          g.fillStyle = 'rgba(86,150,160,0.5)';
          g.fillRect(bx, by, bw, bh);
        }
        // Beach: land cells at the water's edge get a sandy lip.
        if (!water && c.biome !== 'mountains' && touchesWater(x, y)) {
          g.fillStyle = 'rgba(196,176,120,0.5)';
          g.fillRect(bx, by, bw, Math.max(1, Math.ceil(bh * 0.55)));
        }
        // Subtle per-cell dither so flat colour bands read as textured ground.
        if (!water) {
          const hash = (x * 73856093 ^ y * 19349663) >>> 0;
          const n = (hash % 5) - 2; // -2..+2
          if (n !== 0) {
            g.fillStyle = n > 0 ? `rgba(255,250,235,${n * 0.018})` : `rgba(0,0,0,${-n * 0.022})`;
            g.fillRect(bx, by, bw, bh);
          }
        }

        // Elevation-based lighting: NW-lit hillshade
        const north = y > 0 ? map.at(x, y - 1).elevation : c.elevation;
        const west  = x > 0 ? map.at(x - 1, y).elevation : c.elevation;
        const shade = (c.elevation - north + c.elevation - west) * 1.4;
        if (shade > 0.01) {
          g.fillStyle = `rgba(255,255,240,${Math.min(0.32, shade * 0.6)})`;
          g.fillRect(bx, by, bw, bh);
        } else if (shade < -0.01) {
          g.fillStyle = `rgba(0,0,0,${Math.min(0.30, -shade * 0.5)})`;
          g.fillRect(bx, by, bw, bh);
        }

        // Forest canopy: layered blobs — dark trunks under lit crowns — so
        // woodland reads as foliage rather than a flat green block.
        if (c.biome === 'forest') {
          const r = Math.max(2, bw * 0.26);
          for (let k = 0; k < 3; k++) {
            const h = (x * 17 + y * 31 + k * 101) >>> 0;
            const ox = bx + (h % Math.max(1, Math.floor(bw - r)));
            const oy = by + ((h >> 4) % Math.max(1, Math.floor(bh - r)));
            g.fillStyle = 'rgba(18,36,14,0.5)';
            g.fillRect(ox, oy + 1, r, r); // shadow
            g.fillStyle = 'rgba(58,96,46,0.55)';
            g.fillRect(ox, oy, r, r); // lit crown
          }
        }
        // Plains: sparse grass tufts for a meadow texture.
        if (c.biome === 'plains' && (x * 13 + y * 7) % 6 < 2) {
          g.fillStyle = 'rgba(120,134,78,0.4)';
          g.fillRect(bx + (x % 3) + 1, by + bh * 0.4, Math.max(1, bw * 0.18), Math.max(1, bh * 0.4));
        }
        // Hills: a few scattered rocks/scrub dots.
        if (c.biome === 'hills' && (x * 11 + y * 5) % 5 < 2) {
          g.fillStyle = 'rgba(40,36,28,0.32)';
          g.fillRect(bx + bw * 0.5, by + bh * 0.45, Math.max(1, bw * 0.22), Math.max(1, bh * 0.22));
        }
        // Mountain snow caps on highest peaks
        if (c.biome === 'mountains' && c.elevation > 0.82) {
          g.fillStyle = `rgba(230,230,240,${(c.elevation - 0.82) * 2.5})`;
          g.fillRect(bx, by, bw, Math.max(1, bh * 0.5));
        }
        // River shimmer
        if (c.biome === 'river' && (x + y + Math.floor(this.frame / 12)) % 5 === 0) {
          g.fillStyle = 'rgba(180,220,240,0.22)';
          g.fillRect(bx, by, bw, bh);
        }
        // Marsh reeds texture
        if (c.biome === 'marsh' && (x * 5 + y * 7) % 11 < 3) {
          g.fillStyle = 'rgba(60,80,30,0.4)';
          g.fillRect(bx + bw * 0.3, by, Math.max(1, bw * 0.2), bh);
        }
      }
    }
    // Contour lines: thin strokes where elevation crosses 0.2/0.4/0.6/0.8
    g.strokeStyle = 'rgba(0,0,0,0.12)';
    g.lineWidth = 1;
    for (const level of [0.2, 0.4, 0.6, 0.8]) {
      for (let y = 0; y < N - 1; y++) {
        for (let x = 0; x < N - 1; x++) {
          const a = map.at(x, y).elevation;
          const b2 = map.at(x + 1, y).elevation;
          const c2 = map.at(x, y + 1).elevation;
          if ((a < level) !== (b2 < level) || (a < level) !== (c2 < level)) {
            const bx = Math.floor(m + x * cw);
            const by2 = Math.floor(m + y * ch);
            g.beginPath();
            g.moveTo(bx, by2);
            g.lineTo(bx + Math.ceil(cw), by2 + Math.ceil(ch));
            g.stroke();
          }
        }
      }
    }
    // border vignette so the map reads as a map
    g.strokeStyle = '#6e4a2f';
    g.lineWidth = 2;
    g.strokeRect(m - 4, m - 4, W - 2 * m + 8, H - 2 * m + 8);
  }

  /** Cloud cover and rain streaks driven by today's actual weather. */
  private drawWeather(W: number, H: number): void {
    const { g, region } = this;
    const w = region.weather.forDay(region.day);
    if (w.rainfall < 0.25) return;
    // drifting cloud shadows
    g.fillStyle = `rgba(14,16,24,${Math.min(0.35, w.rainfall * 0.4)})`;
    const drift = this.frame * 0.3;
    for (let i = 0; i < 6; i++) {
      const cx = ((i * 977 + drift) % (W + 400)) - 200;
      const cy = 80 + ((i * 613) % (H - 160));
      for (let k = 0; k < 5; k++) {
        g.fillRect(cx + k * 38 - 76, cy + (k % 2) * 14 - 7, 80, 26);
      }
    }
    if (w.sky === 'rain' || w.sky === 'storm' || w.sky === 'snow') {
      g.fillStyle = w.sky === 'snow' ? 'rgba(230,235,245,0.5)' : 'rgba(160,190,220,0.4)';
      const n = w.sky === 'storm' ? 220 : 120;
      for (let i = 0; i < n; i++) {
        const x = (i * 89 + this.frame * (w.sky === 'snow' ? 1 : 7)) % W;
        const y = (i * 53 + this.frame * (w.sky === 'snow' ? 2 : 11)) % H;
        if (w.sky === 'snow') g.fillRect(x, y, 2, 2);
        else g.fillRect(x, y, 1, 5);
      }
    }
  }

  /** The promotion-as-moment (GDD §2.2): name the State, choose its lean. */
  private drawCeremony(): void {
    const r = this.region;
    if (!r.ceremonyPending) {
      if (this.ceremonyOpen) {
        this.ceremonyOpen = false;
        this.ceremony.classList.add('hidden');
      }
      return;
    }
    if (this.ceremonyOpen) return; // already on screen
    this.ceremonyOpen = true;
    this.ceremony.classList.remove('hidden');
    const leans = (Object.keys(GOV_LEANS) as GovLean[])
      .map(
        (k) =>
          `<label class="lean-card"><input type="radio" name="lean" value="${k}" ${k === 'council' ? 'checked' : ''}>` +
          `<b>${GOV_LEANS[k].name}</b><br><span>${GOV_LEANS[k].desc}</span></label>`,
      )
      .join('');
    this.ceremony.innerHTML =
      `<div class="ceremony-box">` +
      `<h2>★ THE INCORPORATION ★</h2>` +
      `<p>${r.settlements.length} towns. ${r.totalPop()} citizens. The Regional Charter is drafted —<br>` +
      `all that remains is a name, and a way of ruling.</p>` +
      `<input id="state-name" type="text" maxlength="28" placeholder="Name your State…" value="The Valley State">` +
      `<div class="lean-row">${leans}</div>` +
      `<button id="proclaim-btn">Proclaim the State</button>` +
      `</div>`;
    this.ceremony.querySelector<HTMLButtonElement>('#proclaim-btn')!.onclick = () => {
      const name = this.ceremony.querySelector<HTMLInputElement>('#state-name')!.value;
      const lean = (this.ceremony.querySelector<HTMLInputElement>('input[name=lean]:checked')?.value ?? 'council') as GovLean;
      r.completeIncorporation(name, lean);
      this.ceremonyOpen = false;
      this.ceremony.classList.add('hidden');
    };
  }

  private drawConvention(): void {
    if (!this.conventionOpen) return;
    const r = this.region;
    const notables = r.notables.filter((n) => n.alive);
    const notableOptions = (selected: number | null) =>
      `<option value="">— vacant —</option>` +
      notables.map((n) =>
        `<option value="${n.id}" ${n.id === selected ? 'selected' : ''}>${n.name} (${n.role})</option>`,
      ).join('');

    const govCards = GOV_TYPES.map((g) =>
      `<label class="lean-card"><input type="radio" name="gov-type" value="${g.id}" ${g.id === 'democracy' ? 'checked' : ''}>` +
      `<b>${g.name}</b><br><span>${g.legitimacySource}. Tax cap ${g.taxCap}%.` +
      (g.militiaBonus > 0 ? ` Militia +${g.militiaBonus}.` : '') + `</span></label>`,
    ).join('');

    const ministerRows = MINISTER_ROLES.map((mr) =>
      `<p><b>${mr.title}:</b> (${mr.bonus})<br>` +
      `<select class="minister-sel" data-role="${mr.id}">${notableOptions(r.ministers.find((m) => m.role === mr.id)?.notableId ?? null)}</select></p>`,
    ).join('');

    const suggestedName = r.stateName ? `Republic of ${r.stateName}` : 'New Republic';
    this.convention.classList.remove('hidden');
    const govFlavour: Record<string, string> = {
      democracy:  'The people\'s delegates take their seats. The ayes have it — sovereignty rests in the assembly.',
      republic:   'The republic assembles its citizens. Rome did not fall in a day; neither is it built in one.',
      junta:      'The generals enter the hall. Order before liberty — for now.',
      monarchy:   'The heir is presented to the gathered lords. Long may they reign.',
    };
    const chosenGov = (this.convention.querySelector<HTMLInputElement>('input[name=gov-type]:checked')?.value) ?? 'democracy';
    const flavourLine = govFlavour[chosenGov] ?? 'The convention convenes.';
    this.convention.innerHTML =
      `<div class="ceremony-box">` +
      `<h2>★ THE CONSTITUTIONAL CONVENTION ★</h2>` +
      `<p style="font-size:11px;color:#9ab0c4;letter-spacing:2px;text-transform:uppercase">` +
      `${Math.round(r.totalPop()).toLocaleString()} citizens · ${r.settlements.length} towns · ${r.researched.length} discoveries</p>` +
      `<p>${flavourLine}</p>` +
      `<p><b>Nation name:</b></p>` +
      `<input id="nation-name" type="text" maxlength="36" placeholder="Name the nation…" value="${suggestedName}">` +
      `<p><b>Form of government:</b></p>` +
      `<div class="lean-row">${govCards}</div>` +
      `<p><b>Appoint ministers:</b></p>` +
      ministerRows +
      `<button id="convention-proclaim-btn">Proclaim the Nation</button>` +
      `<button id="convention-cancel-btn" class="mini" style="margin-left:8px">Cancel</button>` +
      `</div>`;
    this.convention.querySelector<HTMLButtonElement>('#convention-proclaim-btn')!.onclick = () => {
      const name = (this.convention.querySelector<HTMLInputElement>('#nation-name')!.value || suggestedName).trim();
      const gov = (this.convention.querySelector<HTMLInputElement>('input[name=gov-type]:checked')?.value ?? 'democracy') as GovType;
      const assignments: Partial<Record<MinisterRoleId, number | null>> = {};
      for (const sel of this.convention.querySelectorAll<HTMLSelectElement>('.minister-sel')) {
        const role = sel.dataset.role as MinisterRoleId;
        assignments[role] = sel.value ? Number(sel.value) : null;
      }
      r.proclaimNation(name, gov, assignments);
      this.conventionOpen = false;
      this.convention.classList.add('hidden');
      // The nation design screen follows the proclamation: economic system,
      // military doctrine, alliances — and the one sanctioned currency re-pick.
      if (r.nationProclaimed) {
        new DesignScreen().showNationDesign(r.currencySymbol, (design) => r.applyNationDesign(design));
      }
    };
    this.convention.querySelector<HTMLButtonElement>('#convention-cancel-btn')!.onclick = () => {
      this.conventionOpen = false;
      this.convention.classList.add('hidden');
    };
  }

  /** 1 Jan 2100: the verdict on the modal, once (GDD §8.4). Dismissing it
   *  hands the country back — the sandbox runs on. */
  private drawCenturyReport(): void {
    const rep = this.region.centuryReport;
    if (!rep || this.centuryDismissed) {
      this.centuryModal.classList.add('hidden');
      return;
    }
    if (!this.centuryModal.classList.contains('hidden')) return; // already on screen
    this.centuryModal.classList.remove('hidden');
    const branchTitle =
      rep.branch === 'solarpunk' ? 'THE GARDEN CENTURY'
      : rep.branch === 'dystopia' ? 'THE NEON CENTURY'
      : rep.branch === 'drowned' ? 'THE DROWNED CENTURY' : 'THE CENTURY';
    const g = rep.grades;
    this.centuryModal.innerHTML =
      `<div class="ceremony-box">` +
      `<h2>1 JANUARY 2100 — THE CENTURY REPORT</h2>` +
      `<p class="insp-skills">${branchTitle}</p>` +
      `<p>${rep.verdict}</p>` +
      `<p>population <b>${rep.pop.toLocaleString()}</b> across <b>${rep.towns}</b> towns · ` +
      `GDP ` + formatCurrency(rep.gdp) + `/mo · treasury ` + formatCurrency(rep.treasury) + `</p>` +
      `<p>CO₂ <b>${rep.co2ppm} ppm</b> · warming <b>+${rep.warmingC}°C</b> · ` +
      `${rep.techs} discoveries · ${rep.laws} statutes · legitimacy ${rep.legitimacy}</p>` +
      `<p>stewardship <b>${g.stewardship}</b> · prosperity <b>${g.prosperity}</b> · ` +
      `liberty <b>${g.liberty}</b> · standing <b>${g.standing}</b></p>` +
      `<p class="insp-skills">Endings are graded, not won. The country is still yours.</p>` +
      `<button id="century-close-btn">Carry on</button>` +
      `</div>`;
    this.centuryModal.querySelector<HTMLButtonElement>('#century-close-btn')!.onclick = () => {
      this.centuryDismissed = true;
      this.centuryModal.classList.add('hidden');
    };
  }

  /** Win condition achieved: show once, "Play On" closes it (sandbox continues). */
  /** The century forks (GDD §3.2): when the era branch is first decided, give
   *  that pivotal moment a modal — the same weight as Incorporation, the
   *  Convention, and the win paths, instead of a single log line. */
  private drawEraModal(): void {
    const branch = this.region.eraBranch;
    if (!branch || this.eraDismissed) { this.eraModal.classList.add('hidden'); return; }
    if (!this.eraModal.classList.contains('hidden')) return; // already showing — leave it until dismissed
    this.eraModal.classList.remove('hidden');
    const titles: Record<string, string> = {
      solarpunk: '☀ THE GARDEN CENTURY',
      dystopia:  '▮ THE NEON CENTURY',
      drowned:   '≈ THE DROWNED CENTURY',
    };
    const descs: Record<string, string> = {
      solarpunk: 'The grid hums clean, the squares are planted, and the waterline stays on the chart, not in the streets. Your people built a century worth living in.',
      dystopia:  'The economy roars behind checkpoints and billboards. The people queue in its light and grumble in its shadow — order bought at a price.',
      drowned:   'The projection is now a tide table. The sea is coming for the coastal streets — wall them, move them, or mourn them. The reckoning of a warmer world.',
    };
    const subtitle: Record<string, string> = {
      solarpunk: 'Democratic · content · the sky held clean',
      dystopia:  'Prosperous · unfree or unhappy · the lights never dim',
      drowned:   `Projected warming ≥ 2.3°C · the coast pays the bill`,
    };
    this.eraModal.innerHTML =
      `<div class="win-modal-box">` +
      `<h1>${titles[branch] ?? 'A NEW CENTURY'}</h1>` +
      `<p class="win-path">${BRANCH_YEAR} · ${subtitle[branch] ?? ''}</p>` +
      `<p class="win-details">${descs[branch] ?? ''}</p>` +
      `<button class="win-modal-btn" id="era-face-on">Face the Century</button>` +
      `</div>`;
    this.eraModal.querySelector<HTMLButtonElement>('#era-face-on')!.onclick = () => {
      this.eraDismissed = true;
      this.eraModal.classList.add('hidden');
    };
  }

  private drawWinModal(): void {
    const wc = this.region.winCondition;
    if (!wc || this.winDismissed) {
      this.winModal.classList.add('hidden');
      return;
    }
    if (!this.winModal.classList.contains('hidden')) return;
    this.winModal.classList.remove('hidden');
    const pathLabels: Record<string, string> = {
      unification: '★ UNIFICATION ★',
      legacy:      '★ LEGACY ★',
      domination:  '★ DOMINATION ★',
      solarpunk:   '★ THE GARDEN PATH ★',
    };
    const pathDescs: Record<string, string> = {
      unification: 'One nation, one flag, one future. The region bends to your will.',
      legacy:      'History will speak your name. Three of four century grades are A — a dynasty built to last.',
      domination:  'The century closes and only your nation stands sovereign, unchallenged.',
      solarpunk:   'The grid hums clean. The gardens hold. A better century begins here.',
    };
    this.winModal.innerHTML =
      `<div class="win-modal-box">` +
      `<h1>${pathLabels[wc.path] ?? '★ VICTORY ★'}</h1>` +
      `<p class="win-path">${wc.path} · ${wc.year}</p>` +
      `<p class="win-details">${pathDescs[wc.path] ?? ''}<br><em>${wc.details}</em></p>` +
      `<button class="win-modal-btn" id="win-play-on">Play On</button>` +
      `</div>`;
    this.winModal.querySelector<HTMLButtonElement>('#win-play-on')!.onclick = () => {
      this.winDismissed = true;
      this.winModal.classList.add('hidden');
    };
  }

  /** Wire a panel's tab buttons to show the matching section. Sections all stay
   *  in the DOM (so ID-bound handlers survive); switching is pure CSS, no
   *  rebuild. `set` records the choice so the next rebuild matches. The class
   *  pair is parameterised so a panel can nest a second (sub-tab) level. */
  private wireTabs(
    panel: HTMLElement,
    set: (tab: string) => void,
    tabClass = 'pal-tab',
    sectionClass = 'pal-section',
  ): void {
    for (const btn of panel.querySelectorAll<HTMLButtonElement>(`.${tabClass}`)) {
      btn.onclick = () => {
        const tab = btn.dataset.ptab!;
        set(tab);
        for (const t of panel.querySelectorAll<HTMLElement>(`.${tabClass}`)) {
          t.classList.toggle('active', t.dataset.ptab === tab);
        }
        for (const s of panel.querySelectorAll<HTMLElement>(`.${sectionClass}`)) {
          s.classList.toggle('hidden', s.dataset.psection !== tab);
        }
      };
    }
  }

  private drawStatePanel(): void {
    const r = this.region;
    // Pre-statehood the panel still shows — but trimmed to the core governance
    // levers (tax / services / militia). The nation-tier machinery (Credit
    // sub-tab, Politics, Diplomacy) only appears once the State is proclaimed.
    const preState = !r.stateProclaimed;
    this.statePanel.classList.remove('hidden');
    // Same DOM-stability guard as the other panels: rebuild on a ~1s timer, not
    // every frame, so a button node survives between mousedown and click.
    // Without this the panel's buttons (borrow, services, diplomacy, …) never
    // fire because the element is replaced mid-click.
    if (this.frame - this.lastStatePanelBuildFrame < 60) return;
    this.lastStatePanelBuildFrame = this.frame;
    const forceRebuild = () => { this.lastStatePanelBuildFrame = -999; };
    const lvl = (v: number) => ['none', 'basic', 'funded'][v];
    const tab = this.statePanelTab;
    // Tab strip: Finance / Politics / Diplomacy. Sections always render (so the
    // ~25 ID-bound handlers below still find their nodes) but only the active one
    // is shown — switching just toggles CSS, no rebuild.
    const tabStrip = preState
      ? '' // pre-statehood there is only the (trimmed) Finance section — no tabs needed
      : `<div class="pal-tabs">` +
      `<button class="pal-tab${tab === 'finance' ? ' active' : ''}" data-ptab="finance">Finance</button>` +
      `<button class="pal-tab${tab === 'politics' ? ' active' : ''}" data-ptab="politics">Politics</button>` +
      `<button class="pal-tab${tab === 'diplomacy' ? ' active' : ''}" data-ptab="diplomacy">Diplomacy</button>` +
      `</div>`;
    const sec = (id: string, body: string) =>
      `<div class="pal-section${tab === id ? '' : ' hidden'}" data-psection="${id}">${body}</div>`;

    const ftab = this.financeSubTab;
    // Treasury sub-tab: the at-a-glance dashboard + the tax/services/militia dials.
    const treasuryBody =
      `<p>treasury ` + formatCurrency(Math.floor(r.treasury)) + ` · coin ${r.currencySymbol}</p>` +
      (r.currencyTransition && r.day < r.currencyTransition.endDay
        ? `<p style="color:#e0a040" title="The currency switch is still settling: output runs at ${Math.round(r.currencyEfficiency() * 100)}% and prices swing until markets stabilize.">` +
          `⚠ currency transition — output ${Math.round(r.currencyEfficiency() * 100)}%, ` +
          `${Math.max(1, Math.round((r.currencyTransition.endDay - r.day) / 30))}mo to stabilize</p>`
        : '') +
      `<p>GDP ` + formatCurrency(Math.floor(r.gdpLastMonth)) + `/mo · avg wage ${formatCurrency(r.avgDailyWage())}/d</p>` +
      `<p title="The global ledger (GDD §8.2): every chimney on earth, projected to 2100. The verdict is read in 2040.">` +
      `CO₂ ${Math.round(r.co2ppm)} ppm · +${r.warmingC.toFixed(1)}°C` +
      `${r.eraBranch ? ` · <b>${r.eraBranch.toUpperCase()}</b>` : ` (→ +${r.projectedWarming().toFixed(1)}°C by 2100)`}` +
      (r.geoDeployed ? ` · <span style="color:#4cf" title="Stratospheric aerosols active — warming suppressed for two years">aerosols active</span>` : '') +
      `</p>` +
      (r.has('geoengineering') && !r.geoDeployed && r.nationProclaimed
        ? `<p><button class="mini" id="geo-deploy-btn" title="Deploy stratospheric aerosols: −${GEOENGINEER_COOLING}°C over 2 years, but all rivals lose 15 relations (one-time)">⚗ deploy geoengineering</button></p>`
        : '') +
      `<p>trade ` + formatCurrency(Math.floor(r.tradeValueLastMonth)) + `/mo turnover</p>` +
      `<p>tax <span id="tax-val">${Math.round(r.taxRate * 100)}%</span></p>` +
      `<input id="tax-slider" type="range" min="0" max="30" value="${Math.round(r.taxRate * 100)}">` +
      `<p>services: <b>${lvl(r.servicesLevel)}</b> <button class="mini" id="svc-up">+</button><button class="mini" id="svc-dn">−</button></p>` +
      `<p>militia: <b>${lvl(r.militiaLevel)}</b> <button class="mini" id="mil-up">+</button><button class="mini" id="mil-dn">−</button></p>` +
      `<p class="insp-skills">high taxes breed strikes; services cost coin but save lives</p>`;
    // Credit sub-tab: the lengthy monetary / lenders / freight machinery.
    // Only built post-statehood — these read nation-tier state the pre-State
    // region doesn't have, and the sub-tab isn't shown until then anyway.
    const creditBody = preState ? '' :
      this.monetaryHtml() +
      this.lendersHtml() +
      `<p class="insp-skills">${r.maglevUnlocked()
        ? 'THE FLOATING FREIGHT — maglev guideways from any town panel'
        : r.highwayUnlocked()
          ? 'THE ASPHALT AGE — highways from any town panel'
          : r.railUnlocked()
            ? 'RAILWORKS chartered — lay rail from any town panel'
            : `railworks expected ~${RAIL_ERA_YEAR}`}</p>` +
      this.freightHtml();
    const financeBody = preState
      ? treasuryBody // no Credit sub-tab before the central bank exists
      : `<div class="pal-subtabs">` +
      `<button class="pal-subtab${ftab === 'treasury' ? ' active' : ''}" data-ptab="treasury">Treasury</button>` +
      `<button class="pal-subtab${ftab === 'credit' ? ' active' : ''}" data-ptab="credit">Credit</button>` +
      `</div>` +
      `<div class="pal-subsection${ftab === 'treasury' ? '' : ' hidden'}" data-psection="treasury">${treasuryBody}</div>` +
      `<div class="pal-subsection${ftab === 'credit' ? '' : ' hidden'}" data-psection="credit">${creditBody}</div>`;

    const politicsBody = preState ? '' :
      (!r.nationProclaimed && r.stateProclaimed && !r.proclamationReady
        ? `<p style="color:#bfae86;font-size:10px">territory ${(r.playerTerritoryControl() * 100).toFixed(0)}% / 50% needed for nation gate</p>`
        : '') +
      (r.proclamationReady && !r.nationProclaimed && !r.canCallConvention()
        ? `<p style="color:#8fc26a;font-size:10px">★ REGIONAL HEGEMON — nation gate unlocked (meet Convention requirements to proceed)</p>`
        : '') +
      (r.canCallConvention() ? `<p><button id="convention-btn" style="font-size:10px;background:#8b5cf6;color:#fff;border:none;padding:4px 8px;cursor:pointer">★ CONVENE CONSTITUTIONAL CONVENTION</button></p>` : '') +
      this.politicsHtml() +
      this.factionIntelHtml();

    const panelTitle = r.nationProclaimed
      ? r.nationName.toUpperCase()
      : r.stateProclaimed
        ? r.stateName.toUpperCase()
        : (r.stateName || 'REGION').toUpperCase();
    this.statePanel.innerHTML =
      `<div class="pal-title">${panelTitle}</div>` +
      `<p class="insp-skills">${r.nationProclaimed && r.govType
        ? GOV_TYPES.find((g) => g.id === r.govType)!.name
        : r.govLean ? GOV_LEANS[r.govLean].name : ''}</p>` +
      (r.nationProclaimed ? this.nationHtml() : '') +
      // Navigation to the other windows stays always-visible.
      `<p>` +
      `<button class="mini" id="research-toggle" title="Research tree (T)">${this.researchOpen ? '▲' : '▼'} T:research</button> ` +
      `<button class="mini" id="routenet-toggle" title="Route network (R)">${this.routeNetworkOpen ? '▲' : '▼'} R:routes</button> ` +
      `<button class="mini" id="settlements-toggle" title="Settlement list (S)">${this.settlementListOpen ? '▲' : '▼'} S:towns</button> ` +
      `<button class="mini" id="economy-toggle" title="Economy panel (E)">${this.economyOpen ? '▲' : '▼'} E:econ</button>` +
      `</p>` +
      tabStrip +
      // Pre-statehood the lone Finance section is always shown (no tabs to hide
      // behind a stale statePanelTab); post-statehood it's a real tab.
      (preState
        ? `<div class="pal-section" data-psection="finance">${financeBody}</div>`
        : sec('finance', financeBody)) +
      // Politics & Diplomacy are nation-tier — only once the State is proclaimed.
      (preState ? '' : sec('politics', politicsBody)) +
      (preState ? '' : sec('diplomacy', this.diplomacyHtml()));

    this.wireTabs(this.statePanel, (t) => { this.statePanelTab = t as 'finance' | 'politics' | 'diplomacy'; });
    this.wireTabs(this.statePanel, (t) => { this.financeSubTab = t as 'treasury' | 'credit'; }, 'pal-subtab', 'pal-subsection');
    this.statePanel.querySelector<HTMLInputElement>('#tax-slider')!.oninput = (e) => {
      r.taxRate = Number((e.target as HTMLInputElement).value) / 100;
      const taxVal = this.statePanel.querySelector<HTMLElement>('#tax-val');
      if (taxVal) taxVal.textContent = `${Math.round(r.taxRate * 100)}%`;
    };
    const rateSlider = this.statePanel.querySelector<HTMLInputElement>('#rate-slider');
    if (rateSlider) {
      rateSlider.oninput = (e) => {
        r.policyRate = Number((e.target as HTMLInputElement).value) / 100;
        const rateVal = this.statePanel.querySelector<HTMLElement>('#rate-val');
        if (rateVal) rateVal.textContent = `${Math.round(r.policyRate * 100)}%`;
      };
    }
    for (const btn of this.statePanel.querySelectorAll<HTMLButtonElement>('.cb-regime-btn')) {
      btn.onclick = () => r.setMonetaryRegime(btn.dataset.regime as MonetaryRegime);
    }
    for (const btn of this.statePanel.querySelectorAll<HTMLButtonElement>('.cb-bond-btn')) {
      btn.onclick = () => r.issueBonds(Number(btn.dataset.amount));
    }
    for (const btn of this.statePanel.querySelectorAll<HTMLButtonElement>('.cb-cur-announce')) {
      btn.onclick = () => r.announceCurrencyChange(btn.dataset.sym as CurrencySymbol);
    }
    for (const btn of this.statePanel.querySelectorAll<HTMLButtonElement>('.cb-cur-switch')) {
      btn.onclick = () => {
        const sym = btn.dataset.sym as CurrencySymbol;
        // A switch made under duress reads as necessity; one made in calm
        // waters reads as caprice — and markets price each accordingly.
        const cause = r.confidence < 30 ? 'crisis' : 'strategic';
        const verdict = cause === 'crisis'
          ? 'Markets are already in crisis — they will understand this move.'
          : 'Markets see no reason for this. Expect heavy capital flight and years of friction.';
        if (confirm(`Switch the currency standard to ${sym}?\n\n${verdict}\n\nAnnounced switches (${ANNOUNCE_LEAD_DAYS}+ days notice) and deep treasury reserves soften the blow.`)) {
          r.changeCurrency(sym, cause);
        }
      };
    }
    this.statePanel.querySelector<HTMLButtonElement>('#svc-up')!.onclick = () => {
      r.servicesLevel = Math.min(2, r.servicesLevel + 1); forceRebuild();
    };
    this.statePanel.querySelector<HTMLButtonElement>('#svc-dn')!.onclick = () => {
      r.servicesLevel = Math.max(0, r.servicesLevel - 1); forceRebuild();
    };
    this.statePanel.querySelector<HTMLButtonElement>('#mil-up')!.onclick = () => {
      r.militiaLevel = Math.min(2, r.militiaLevel + 1); forceRebuild();
    };
    this.statePanel.querySelector<HTMLButtonElement>('#mil-dn')!.onclick = () => {
      r.militiaLevel = Math.max(0, r.militiaLevel - 1); forceRebuild();
    };
    this.statePanel.querySelector<HTMLButtonElement>('#research-toggle')!.onclick = () => {
      this.researchOpen = !this.researchOpen; forceRebuild();
    };
    this.statePanel.querySelector<HTMLButtonElement>('#routenet-toggle')!.onclick = () => {
      this.routeNetworkOpen = !this.routeNetworkOpen; forceRebuild();
    };
    this.statePanel.querySelector<HTMLButtonElement>('#settlements-toggle')!.onclick = () => {
      this.settlementListOpen = !this.settlementListOpen; forceRebuild();
    };
    this.statePanel.querySelector<HTMLButtonElement>('#economy-toggle')!.onclick = () => {
      this.economyOpen = !this.economyOpen; forceRebuild();
    };
    this.statePanel.querySelector<HTMLButtonElement>('#convention-btn')?.addEventListener('click', () => {
      this.conventionOpen = true;
    });
    for (const btn of this.statePanel.querySelectorAll<HTMLButtonElement>('.law-btn')) {
      btn.onclick = () => r.enactLaw(btn.dataset.id!);
    }
    for (const btn of this.statePanel.querySelectorAll<HTMLButtonElement>('.policy-slot-btn')) {
      btn.onclick = () => {
        this.policySlotIndex = Number(btn.dataset.slot);
        this.renderPolicyModal();
      };
    }
    for (const btn of this.statePanel.querySelectorAll<HTMLButtonElement>('.dip-envoy-btn')) {
      btn.onclick = () => r.sendEnvoy(Number(btn.dataset.rival));
    }
    for (const btn of this.statePanel.querySelectorAll<HTMLButtonElement>('.dip-gift-btn')) {
      btn.onclick = () => r.sendGift(Number(btn.dataset.rival));
    }
    for (const btn of this.statePanel.querySelectorAll<HTMLButtonElement>('.dip-prop-btn')) {
      btn.onclick = () => r.proposeTreaty(Number(btn.dataset.rival), btn.dataset.kind as TreatyKind);
    }
    for (const btn of this.statePanel.querySelectorAll<HTMLButtonElement>('.lender-btn')) {
      btn.onclick = () => this.showLoanDialog(Number(btn.dataset.lender));
    }
    for (const btn of this.statePanel.querySelectorAll<HTMLButtonElement>('.loan-repay-btn')) {
      btn.onclick = () => this.showRepayDialog(Number(btn.dataset.loan));
    }
    for (const btn of this.statePanel.querySelectorAll<HTMLButtonElement>('.cb-dw-draw')) {
      btn.onclick = () => {
        const amt = Number(btn.dataset.amount);
        const result = r.borrowFromCentralBank(amt);
        if (!result.ok) alert(result.reason);
        else this.refreshPanel();
      };
    }
    for (const btn of this.statePanel.querySelectorAll<HTMLButtonElement>('.cb-dw-repay')) {
      btn.onclick = () => {
        const amt = Number(btn.dataset.amount);
        const result = r.repayCentralBank(amt);
        if (!result.ok) alert(result.reason);
        else this.refreshPanel();
      };
    }
    for (const btn of this.statePanel.querySelectorAll<HTMLButtonElement>('.dip-break-btn')) {
      btn.onclick = () => r.breakTreaty(Number(btn.dataset.rival), btn.dataset.kind as TreatyKind);
    }
    for (const btn of this.statePanel.querySelectorAll<HTMLButtonElement>('.dip-accept-btn')) {
      btn.onclick = () => r.acceptOffer(Number(btn.dataset.rival));
    }
    for (const btn of this.statePanel.querySelectorAll<HTMLButtonElement>('.dip-decline-btn')) {
      btn.onclick = () => r.declineOffer(Number(btn.dataset.rival));
    }
    for (const btn of this.statePanel.querySelectorAll<HTMLButtonElement>('.dip-war-btn')) {
      btn.onclick = () => r.declareWar(Number(btn.dataset.rival), btn.dataset.cb as CasusBelli);
    }
    for (const btn of this.statePanel.querySelectorAll<HTMLButtonElement>('.war-mob-btn')) {
      btn.onclick = () => r.setMobilization(btn.dataset.mob as Mobilization);
    }
    for (const btn of this.statePanel.querySelectorAll<HTMLButtonElement>('.dip-deal-btn')) {
      btn.onclick = () => this.openDealModal(Number(btn.dataset.rival));
    }
    for (const btn of this.statePanel.querySelectorAll<HTMLButtonElement>('.dip-counter-sign-btn')) {
      btn.onclick = () => r.acceptCounter(Number(btn.dataset.rival));
    }
    for (const btn of this.statePanel.querySelectorAll<HTMLButtonElement>('.dip-counter-decline-btn')) {
      btn.onclick = () => r.declineCounter(Number(btn.dataset.rival));
    }
    this.statePanel.querySelector<HTMLButtonElement>('.war-blockade-btn')?.addEventListener('click', () => {
      r.setBlockade(!r.playerWar?.blockade);
    });
    for (const btn of this.statePanel.querySelectorAll<HTMLButtonElement>('.war-ally-btn')) {
      btn.onclick = () => r.callAlly(Number(btn.dataset.rival));
    }
    for (const btn of this.statePanel.querySelectorAll<HTMLButtonElement>('.war-occ-btn')) {
      btn.onclick = () => r.setOccupationPolicy(btn.dataset.pol as OccupationPolicy);
    }
    for (const btn of this.statePanel.querySelectorAll<HTMLButtonElement>('.war-term-btn')) {
      btn.onclick = () => {
        const t = btn.dataset.term as PeaceTerm;
        if (this.peacePicks.has(t)) this.peacePicks.delete(t);
        else this.peacePicks.add(t);
      };
    }
    this.statePanel.querySelector<HTMLButtonElement>('.war-offer-btn')?.addEventListener('click', () => {
      if (r.offerPeaceBasket([...this.peacePicks])) this.peacePicks.clear();
    });
    this.statePanel.querySelector<HTMLButtonElement>('.war-capitulate-btn')?.addEventListener('click', () => {
      r.capitulate();
      this.peacePicks.clear();
    });
    this.statePanel.querySelector<HTMLButtonElement>('#geo-deploy-btn')?.addEventListener('click', () => {
      r.deployGeoengineering();
    });
    for (const btn of this.statePanel.querySelectorAll<HTMLButtonElement>('.dip-sanction-btn')) {
      btn.onclick = () => r.sanctionAccordDefector(Number(btn.dataset.rival));
    }
  }

  /** Diplomacy section (GDD §5.4): the rival ledger, treaties, and verbs. */
  private diplomacyHtml(): string {
    const r = this.region;
    if (r.rivals.length === 0) return '';
    const short: Record<TreatyKind, string> = {
      non_aggression: 'pact: NAP', trade_agreement: 'pact: trade', defensive_pact: 'pact: defense',
      climate_accord: 'pact: climate',
    };
    const rows = r.rivals.map((rv) => {
      const rel = Math.round(rv.relations);
      const col = rel >= 25 ? '#4e9' : rel >= -25 ? '#ca4' : '#e55';
      const pct = Math.round((rel + 100) / 2);
      const gov = r.regimeOf(rv).name;
      const recentHistory = rv.history.slice(-4).join(' ');
      const treaties = rv.treaties.length > 0
        ? rv.treaties.map((k) => {
            const compLabel = k === 'climate_accord'
              ? (() => {
                  const comp = r.accordCompliance[rv.id] ?? 1;
                  const pct = Math.round(comp * 100);
                  const defecting = comp < ACCORD_DEFECT_THRESHOLD;
                  return ` <span class="insp-skills" style="color:${defecting ? '#e55' : '#4e9'}">${pct}% compliant${defecting ? ' ⚠' : ''}</span>` +
                    (defecting ? ` <button class="mini dip-sanction-btn" data-rival="${rv.id}" title="Sanction the defector: accord torn, −20 relations">sanction</button>` : '');
                })()
              : '';
            return `${TREATY_DEFS[k].name}${compLabel} ` +
              `<button class="mini dip-break-btn" data-rival="${rv.id}" data-kind="${k}" ` +
              `title="Tearing up a treaty is remembered by every chancery">✕</button>`;
          }).join(' · ')
        : 'no treaties';
      const offer = r.offerFor(rv.id);
      const offerRow = offer
        ? `<p>offers <b>${TREATY_DEFS[offer.kind].name}</b> ` +
          `<button class="mini dip-accept-btn" data-rival="${rv.id}">sign</button>` +
          `<button class="mini dip-decline-btn" data-rival="${rv.id}">decline</button></p>`
        : '';
      // their counter from the bargaining table, if one is on offer (§6.3)
      const counter = r.counterFor(rv.id);
      const counterRow = counter
        ? `<p>counters <b>${r.basketLabel(counter.basket)}</b> ` +
          `<button class="mini dip-counter-sign-btn" data-rival="${rv.id}" ` +
          `${r.treasury >= counter.basket.goldToThem ? '' : 'disabled'}>sign</button>` +
          `<button class="mini dip-counter-decline-btn" data-rival="${rv.id}">decline</button></p>`
        : '';
      const canEnvoy = r.treasury >= ENVOY_COST && r.day - rv.lastEnvoyDay >= ENVOY_COOLDOWN_DAYS;
      const canGift = r.treasury >= GIFT_COST && r.day - rv.lastGiftDay >= GIFT_COOLDOWN_DAYS;
      const proposals = (Object.keys(TREATY_DEFS) as TreatyKind[])
        .filter((k) => !rv.treaties.includes(k) && (k !== 'climate_accord' || r.accordUnlocked()))
        .map((k) =>
          `<button class="mini dip-prop-btn" data-rival="${rv.id}" data-kind="${k}" ` +
          `title="${TREATY_DEFS[k].desc} (their ask: relations ≥ ${r.treatyAsk(rv, k)})">${short[k]}</button>`)
        .join(' ');
      // War is the diplomacy verb of last resort (GDD §7.1)
      const cbs = r.nationProclaimed && !r.playerWar ? r.availableCasusBelli(rv) : [];
      const warBtn = cbs.length > 0
        ? ` <button class="mini dip-war-btn" data-rival="${rv.id}" data-cb="${cbs[0]}" ` +
          `title="${CASUS_BELLI_DEFS[cbs[0]].name}: ${CASUS_BELLI_DEFS[cbs[0]].desc} ` +
          `(war support starts at ${CASUS_BELLI_DEFS[cbs[0]].support})">⚔ war</button>`
        : '';
      const verbs = r.playerWar?.rivalId === rv.id
        ? `<p class="insp-skills">⚔ AT WAR — terms are set at the peace table above</p>`
        : `<p><button class="mini dip-envoy-btn" data-rival="${rv.id}" ${canEnvoy ? '' : 'disabled'} ` +
          `title="A paid mission to warm relations (${ENVOY_COOLDOWN_DAYS}-day turnaround)">envoy ` + formatCurrency(ENVOY_COST) + `</button> ` +
          `<button class="mini dip-gift-btn" data-rival="${rv.id}" ${canGift ? '' : 'disabled'} ` +
          `title="A state gift — dearer, faster">gift ` + formatCurrency(GIFT_COST) + `</button> ` +
          `<button class="mini dip-deal-btn" data-rival="${rv.id}" ` +
          `title="Open the bargaining table: compose a multi-item basket (GDD §6.3)">negotiate</button> ` +
          proposals + warBtn + `</p>`;
      // Show richer personality information
      const profile = r.rivalProfile(rv.id);
      const personalityInfo = profile
        ? `${profile.traits.join(', ')} — ${profile.approximateStrength}`
        : '';
      return `<div class="bar-row" title="${RIVAL_ARCHETYPES[rv.archetype].name} — ${personalityInfo}. Agenda: ${rv.agenda}.">` +
        `<span style="width:80px;display:inline-block"><b>${rv.name}</b></span>` +
        `<div class="bar" style="flex:1"><div class="bar-fill" style="width:${pct}%;background:${col}"></div></div>` +
        `<span>${rel}</span></div>` +
        `<p class="insp-skills" title="${recentHistory}">${gov}${rv.borderSettled ? ' · border settled' : ''} · ${personalityInfo}${personalityInfo ? ' · ' : ''}${treaties}</p>` +
        offerRow + counterRow +
        verbs;
    }).join('');
    // World affairs: what the powers are doing to each other (GDD §6.4)
    const name = (id: number) => r.rival(id)?.name ?? '?';
    const wars = r.foreignWars
      .map((w) => `<p class="insp-skills">⚔ ${name(w.a)} vs ${name(w.b)}</p>`)
      .join('');
    const pacts = r.alliances
      .map((k) => {
        const [a, b] = k.split(':').map(Number);
        return r.rival(a) && r.rival(b) ? `<p class="insp-skills">🤝 ${name(a)} – ${name(b)} allied</p>` : '';
      })
      .join('');
    const world = wars || pacts ? `<p class="insp-skills">WORLD AFFAIRS</p>` + wars + pacts : '';
    const boom = r.day < r.warBoomUntil ? `<p class="insp-skills">WAR ABROAD — export prices booming</p>` : '';
    const exports = r.exportEarningsLastMonth > 0 ? `<p>exports ` + formatCurrency(Math.floor(r.exportEarningsLastMonth)) + `/mo</p>` : '';
    return `<p class="insp-skills">DIPLOMACY (relations −100..+100)</p>` + this.warHtml() + boom + exports + rows + world;
  }

  /** The war room (GDD §7): score, support, mobilization, and the peace table. */
  private warHtml(): string {
    const r = this.region;
    const w = r.playerWar;
    const rv = w ? r.rival(w.rivalId) : undefined;
    if (!w || !rv) return '';
    const scorePct = Math.round((w.score + 100) / 2);
    const scoreCol = w.score >= 15 ? '#4e9' : w.score >= -15 ? '#ca4' : '#e55';
    const floor = WAR_SUPPORT_FLOOR[r.govType ?? 'democracy'];
    const supCol = w.support >= floor + 15 ? '#4e9' : w.support >= floor ? '#ca4' : '#e55';
    const mobBtns = (Object.keys(MOBILIZATION_DEFS) as Mobilization[])
      .map((m) =>
        `<button class="mini war-mob-btn" data-mob="${m}" ${m === w.mobilization ? 'disabled' : ''} ` +
        `title="${MOBILIZATION_DEFS[m].desc}">${MOBILIZATION_DEFS[m].name}</button>`)
      .join(' ');
    // Blockade: trade interdiction made of warships (GDD §7.3)
    const canBlockade = r.militiaLevel >= 2 || r.policyActive('standing_army');
    const blockadeBtn =
      `<button class="mini war-blockade-btn" ${w.blockade || canBlockade ? '' : 'disabled'} ` +
      `title="${w.blockade
        ? 'Lift the blockade: lanes reopen for both sides'
        : `Close their lanes: their power −15%, score climbs — costs ` + formatCurrency(BLOCKADE_UPKEEP_PER_POP) + `/pop/mo and your own exports (needs funded militia or a standing army)`}">` +
      `${w.blockade ? '⚓ lift blockade' : '⚓ blockade'}</button>`;
    // Co-belligerence (GDD §7.3): the pacts you can call to the colors
    const name = (id: number) => r.rival(id)?.name ?? '?';
    const allies = w.allies.length > 0 ? `with: ${w.allies.map(name).join(', ')}` : '';
    const enemies = w.enemyAllies.length > 0 ? `against: ${rv.name} + ${w.enemyAllies.map(name).join(', ')}` : '';
    const sides = allies || enemies ? `<p class="insp-skills">${[allies, enemies].filter(Boolean).join(' · ')}</p>` : '';
    const callBtns = r.rivals
      .filter((x) => x.id !== w.rivalId && x.treaties.includes('defensive_pact') && !w.allies.includes(x.id))
      .map((x) =>
        `<button class="mini war-ally-btn" data-rival="${x.id}" ` +
        `title="Call ${x.name} to the colors — honor decides whether the ink holds">call ${x.name}</button>`)
      .join(' ');
    // Occupation (GDD §7.4): the marches the army administers
    const occ = w.occupied > 0
      ? `<p class="insp-skills">occupied marches ${w.occupied}/${MAX_OCCUPIED_MARCHES} · ` +
        `yield ` + formatCurrency(w.occupied * (OCCUPATION_DEFS[w.occupationPolicy].yield - OCCUPATION_DEFS[w.occupationPolicy].garrison)) + `/mo net</p>` +
        `<div class="bar-row" title="Resistance in the occupied marches: past 50, partisans bleed the garrisons">` +
        `<span style="width:70px;display:inline-block">resistance</span>` +
        `<div class="bar" style="flex:1"><div class="bar-fill" style="width:${Math.round(w.resistance)}%;background:${w.resistance > 50 ? '#e55' : '#ca4'}"></div></div>` +
        `<span>${Math.round(w.resistance)}</span></div>` +
        `<p>${(Object.keys(OCCUPATION_DEFS) as OccupationPolicy[])
          .map((p) =>
            `<button class="mini war-occ-btn" data-pol="${p}" ${p === w.occupationPolicy ? 'disabled' : ''} ` +
            `title="${OCCUPATION_DEFS[p].desc}">${OCCUPATION_DEFS[p].name}</button>`)
          .join(' ')}</p>`
      : w.score >= 35
        ? `<p class="insp-skills">the front is deep enough to take ground — the columns probe their marches</p>`
        : '';
    // The peace table (GDD §7.4 priced with §6.3): tick terms into a basket
    for (const t of [...this.peacePicks]) {
      if (t === 'border_province' && w.occupied === 0) this.peacePicks.delete(t);
    }
    const termBtns = (Object.keys(PEACE_TERMS) as PeaceTerm[])
      .map((t) => {
        const picked = this.peacePicks.has(t);
        const blocked = t === 'border_province' && w.occupied === 0;
        return `<button class="mini war-term-btn" data-term="${t}" ${blocked ? 'disabled' : ''} ` +
          `style="${picked ? 'background:#4e9;color:#10141c' : ''}" ` +
          `title="${PEACE_TERMS[t].desc}${blocked ? ' (you must hold a march to claim it)' : ''} (worth ${PEACE_TERMS[t].score})">` +
          `${picked ? '☑ ' : ''}${PEACE_TERMS[t].name}</button>`;
      })
      .join(' ');
    const picks = [...this.peacePicks];
    const ask = picks.length > 0 ? r.peaceBasketAsk(rv, picks) : null;
    const offerBtn = picks.length > 0
      ? `<button class="mini war-offer-btn" ${w.score >= (ask ?? 0) ? '' : 'disabled'} ` +
        `title="Put the basket on the table — each occupied march discounts their ask">offer terms (ask ${ask})</button>`
      : `<span class="insp-skills">tick terms to compose the instrument</span>`;
    return `<p class="insp-skills">⚔ WAR — vs ${rv.name} (${CASUS_BELLI_DEFS[w.cb].name.toLowerCase()}${w.defensive ? ', defensive' : ''})</p>` +
      `<div class="bar-row" title="War score −100..+100: the front line, in one number">` +
      `<span style="width:70px;display:inline-block">war score</span>` +
      `<div class="bar" style="flex:1"><div class="bar-fill" style="width:${scorePct}%;background:${scoreCol}"></div></div>` +
      `<span>${Math.round(w.score)}</span></div>` +
      `<div class="bar-row" title="Home-front consent. Below ${floor} (your regime's floor) the war eats the government">` +
      `<span style="width:70px;display:inline-block">support</span>` +
      `<div class="bar" style="flex:1"><div class="bar-fill" style="width:${Math.round(w.support)}%;background:${supCol}"></div></div>` +
      `<span>${Math.round(w.support)}</span></div>` +
      `<p class="insp-skills">casualties ${Math.round(w.casualties)} · combat power ${Math.round(r.warPower())} vs ${Math.round(r.rivalWarPower(rv))}</p>` +
      sides +
      `<p>${mobBtns} ${blockadeBtn}</p>` +
      (callBtns ? `<p>${callBtns}</p>` : '') +
      occ +
      `<p>${termBtns}</p>` +
      `<p>${offerBtn} <button class="mini war-capitulate-btn" title="End the war on their terms — reparations and a stripped treasury">capitulate</button></p>`;
  }

  /** Politics section: political capital, elections, faction bars, law cards. */
  private politicsHtml(): string {
    const r = this.region;
    if (!r.has('universal_suffrage')) {
      return `<p class="insp-skills">POLITICS — universal suffrage not yet achieved</p>`;
    }
    const electionLine = r.nextElectionDay < 0
      ? `<p class="insp-skills">first election: ~4 years after suffrage is enacted</p>`
      : `<p class="insp-skills">next election in <b>${Math.max(0, r.nextElectionDay - r.day)}</b> days` +
        (r.lastElectionYear > 0 ? ` · last: ${r.lastElectionYear}` : '') + `</p>`;

    const factionBars = r.factions.length > 0
      ? r.factions.map((f) => {
          const suppPct = Math.round(f.support);
          const pwrPct = Math.round(f.power);
          const col = f.support >= 60 ? '#4e9' : f.support >= 40 ? '#ca4' : '#e55';
          return `<div class="bar-row" title="${f.name}: power ${pwrPct}%, support ${suppPct}% — ${f.demand}">` +
            `<span style="width:70px;display:inline-block">${f.name}</span>` +
            `<div class="bar" style="flex:1"><div class="bar-fill" style="width:${suppPct}%;background:${col}"></div></div>` +
            `<span>${suppPct}%</span></div>`;
        }).join('')
      : `<p class="insp-skills">factions form next month</p>`;

    const laws = r.availableLaws();
    const stateLaws = laws.filter((l) => !l.requiresNation);
    const nationLaws = laws.filter((l) => l.requiresNation);
    const renderLawButtons = (list: typeof laws, header: string) =>
      list.length > 0
        ? `<p class="insp-skills">${header}</p>` +
          list.map((l) =>
            `<p><button class="mini law-btn" data-id="${l.id}" ${l.canAfford ? '' : 'disabled'} ` +
            `title="${l.desc}">${l.name} (${l.cost} PC)</button></p>`,
          ).join('')
        : '';
    const lawButtons =
      renderLawButtons(stateLaws, 'STATE LAWS') +
      (r.nationProclaimed ? renderLawButtons(nationLaws, 'NATION LAWS') : '') ||
      (r.passedLaws.length > 0 ? `<p class="insp-skills">all available laws enacted</p>` : '');
    const enacted = r.passedLaws.length > 0
      ? `<p class="insp-skills">enacted: ${r.passedLaws.map((id) => REGION_LAWS.find((l) => l.id === id)?.name ?? id).join(', ')}</p>`
      : '';

    return `<p class="insp-skills">POLITICS</p>` +
      `<p>political capital: <b>${r.politicalCapital} PC</b></p>` +
      electionLine +
      `<p class="insp-skills">FACTIONS (support bar)</p>` +
      factionBars +
      lawButtons +
      enacted;
  }

  /** Nation-tier header: legitimacy bar + minister roster + policy slots (GDD §2.2). */
  private nationHtml(): string {
    const r = this.region;
    const legPct = Math.round(r.legitimacy);
    const legCol = legPct >= 60 ? '#4e9' : legPct >= 35 ? '#ca4' : '#e55';
    const legBar =
      `<div class="bar" style="flex:1"><div class="bar-fill" style="width:${legPct}%;background:${legCol}"></div></div>`;
    const ministerLines = MINISTER_ROLES.map((mr) => {
      const n = r.ministerFor(mr.id);
      return `<span class="insp-skills">${mr.title}: <b>${n ? n.name : '—'}</b></span>`;
    }).join('<br>');

    const govDef = GOV_TYPES.find((g) => g.id === r.govType);
    const policyRows = govDef ? govDef.policySlots.map((domain, i) => {
      const activeId = r.activePolicies[i] ?? null;
      const card = activeId ? POLICY_CARDS.find((c) => c.id === activeId) : null;
      const label = card ? card.name : `— empty —`;
      const upkeepNote = card && card.upkeep > 0 ? ` (` + formatCurrency(card.upkeep) + `/mo)` : '';
      const canSwap = !card || r.politicalCapital >= POLICY_SWAP_COST;
      return `<p><span class="insp-skills">${domain}: </span>` +
        `<button class="mini policy-slot-btn" data-slot="${i}" ${canSwap ? '' : 'disabled'} ` +
        `title="${card ? card.desc : 'Choose a policy card for this slot'}">${label}${upkeepNote}</button></p>`;
    }).join('') : '';

    return `<p class="insp-skills">NATION</p>` +
      `<div class="bar-row" title="Legitimacy — the regime's right to rule (GDD §5.3)">` +
      `<span style="width:80px;display:inline-block">legitimacy</span>` +
      legBar + `<span>${legPct}</span></div>` +
      `<p class="insp-skills">CABINET</p>` +
      `<p>${ministerLines}</p>` +
      `<p class="insp-skills">POLICY SLOTS</p>` +
      policyRows;
  }

  private renderPolicyModal(): void {
    const r = this.region;
    const i = this.policySlotIndex;
    if (i < 0 || !r.govType) return;
    const govDef = GOV_TYPES.find((g) => g.id === r.govType)!;
    const domain = govDef.policySlots[i];
    const cards = r.availablePoliciesFor(domain);
    const activeId = r.activePolicies[i] ?? null;
    const cardRows = cards.map((c) => {
      const isActive = c.id === activeId;
      const canAfford = !activeId || r.politicalCapital >= POLICY_SWAP_COST;
      return `<p><button class="policy-pick-btn${isActive ? ' active' : ''}" data-card="${c.id}" ` +
        `${canAfford ? '' : 'disabled'} title="${c.desc}">` +
        `<b>${c.name}</b>${c.upkeep > 0 ? ` ` + formatCurrency(c.upkeep) + `/mo` : ''}` +
        (isActive ? ' ✓' : '') + `</button>` +
        `<span class="insp-skills"> — ${c.desc}</span></p>`;
    }).join('');
    const noCards = cards.length === 0 ? `<p class="insp-skills">No eligible cards yet — research the prerequisite civics.</p>` : '';
    const swapNote = activeId ? `<p class="insp-skills">Changing an active policy costs ${POLICY_SWAP_COST} PC (you have ${r.politicalCapital}).</p>` : '';

    this.policyModal.innerHTML =
      `<div class="ceremony-box">` +
      `<h2>POLICY — ${domain.toUpperCase()} SLOT</h2>` +
      swapNote +
      cardRows + noCards +
      (activeId ? `<p><button id="policy-clear-btn">Clear slot</button></p>` : '') +
      `<button id="policy-cancel-btn" class="mini">Cancel</button>` +
      `</div>`;
    this.policyModal.classList.remove('hidden');

    for (const btn of this.policyModal.querySelectorAll<HTMLButtonElement>('.policy-pick-btn')) {
      btn.onclick = () => {
        r.setPolicy(i, btn.dataset.card!);
        this.policyModal.classList.add('hidden');
        this.policySlotIndex = -1;
      };
    }
    this.policyModal.querySelector<HTMLButtonElement>('#policy-clear-btn')?.addEventListener('click', () => {
      r.setPolicy(i, null);
      this.policyModal.classList.add('hidden');
      this.policySlotIndex = -1;
    });
    this.policyModal.querySelector<HTMLButtonElement>('#policy-cancel-btn')!.onclick = () => {
      this.policyModal.classList.add('hidden');
      this.policySlotIndex = -1;
    };
  }

  // ---- the bargaining table (GDD §6.3): compose a basket, read their face ----

  private openDealModal(rivalId: number): void {
    this.dealRivalId = rivalId;
    this.dealTreaties.clear();
    this.dealGoldToThem = 0;
    this.dealGoldToYou = 0;
    this.dealBorder = false;
    this.renderDealModal();
  }

  private closeDealModal(): void {
    this.dealRivalId = -1;
    this.dealModal.classList.add('hidden');
  }

  private currentBasket(): DealBasket {
    return {
      treaties: [...this.dealTreaties],
      goldToThem: this.dealGoldToThem,
      goldToYou: this.dealGoldToYou,
      borderSettlement: this.dealBorder,
    };
  }

  /** Live verdict in their envoy's voice — the §6.3 read of the basket. */
  private dealVerdictLine(): string {
    const r = this.region;
    const rv = r.rival(this.dealRivalId);
    if (!rv) return '';
    const v = r.evaluateDeal(rv, this.currentBasket());
    const ledger = `they value it ${v.get.toFixed(1)} pts against ${v.cost.toFixed(1)} asked`;
    if (v.accept) return `✓ Their envoy nods — ${ledger}. They would sign.`;
    if (v.counter) return `± Close: ${ledger}. They would counter, asking ` + formatCurrency(v.counter.goldToThem - this.dealGoldToThem) + ` more.`;
    return `✗ ${ledger}. They would walk — "${v.reason}."`;
  }

  private renderDealModal(): void {
    const r = this.region;
    const rv = r.rival(this.dealRivalId);
    if (!rv) return;
    const treatyRows = (Object.keys(TREATY_DEFS) as TreatyKind[])
      .filter((k) => k !== 'climate_accord' || r.accordUnlocked())
      .map((k) => {
        const signed = rv.treaties.includes(k);
        const appetite = r.treatyAppetite(rv, k);
        const hint = signed ? 'already in force' : appetite >= 0 ? 'they want this' : 'a concession — they want paying';
        return `<p><label title="${TREATY_DEFS[k].desc}">` +
          `<input type="checkbox" class="deal-treaty" data-kind="${k}" ${this.dealTreaties.has(k) ? 'checked' : ''} ${signed ? 'disabled' : ''}> ` +
          `${TREATY_DEFS[k].name} <span class="insp-skills">— ${hint}</span></label></p>`;
      }).join('');
    const borderHint = rv.borderSettled
      ? 'already settled'
      : r.borderAppetite(rv) >= 0 ? 'they would welcome a fixed frontier' : 'they will not pin a border they mean to move';
    const borderRow = `<p><label title="Survey and sign the frontier: no more border friction, and no border casus belli — for either side">` +
      `<input type="checkbox" id="deal-border" ${this.dealBorder ? 'checked' : ''} ${rv.borderSettled ? 'disabled' : ''}> ` +
      `Border Settlement <span class="insp-skills">— ${borderHint}</span></label></p>`;
    this.dealModal.innerHTML =
      `<div class="ceremony-box">` +
      `<h2>THE BARGAINING TABLE — ${rv.name.toUpperCase()}</h2>` +
      `<p class="insp-skills">${RIVAL_ARCHETYPES[rv.archetype].name} · relations ${Math.round(rv.relations)} · ` +
      `every item is priced from their situation and personality (GDD §6.3)</p>` +
      treatyRows + borderRow +
      `<p><label>${getCurrencySymbol()} to them <input type="number" id="deal-gold-them" min="0" step="5" value="${this.dealGoldToThem}" style="width:70px"></label> ` +
      `<label>${getCurrencySymbol()} asked of them <input type="number" id="deal-gold-you" min="0" step="5" value="${this.dealGoldToYou}" style="width:70px"></label> ` +
      `<span class="insp-skills">(treasury ` + formatCurrency(Math.floor(r.treasury)) + `)</span></p>` +
      `<p id="deal-verdict" class="insp-skills">${this.dealVerdictLine()}</p>` +
      `<p><button id="deal-propose-btn" ${r.treasury >= this.dealGoldToThem ? '' : 'disabled'}>Put it on the table</button> ` +
      `<button id="deal-cancel-btn" class="mini">Withdraw</button></p>` +
      `</div>`;
    this.dealModal.classList.remove('hidden');

    const refreshVerdict = () => {
      this.dealModal.querySelector('#deal-verdict')!.textContent = this.dealVerdictLine();
    };
    for (const box of this.dealModal.querySelectorAll<HTMLInputElement>('.deal-treaty')) {
      box.onchange = () => {
        const k = box.dataset.kind as TreatyKind;
        if (box.checked) this.dealTreaties.add(k);
        else this.dealTreaties.delete(k);
        refreshVerdict();
      };
    }
    this.dealModal.querySelector<HTMLInputElement>('#deal-border')!.onchange = (e) => {
      this.dealBorder = (e.target as HTMLInputElement).checked;
      refreshVerdict();
    };
    this.dealModal.querySelector<HTMLInputElement>('#deal-gold-them')!.oninput = (e) => {
      this.dealGoldToThem = Math.max(0, Number((e.target as HTMLInputElement).value) || 0);
      refreshVerdict();
    };
    this.dealModal.querySelector<HTMLInputElement>('#deal-gold-you')!.oninput = (e) => {
      this.dealGoldToYou = Math.max(0, Number((e.target as HTMLInputElement).value) || 0);
      refreshVerdict();
    };
    this.dealModal.querySelector<HTMLButtonElement>('#deal-propose-btn')!.onclick = () => {
      r.proposeDeal(this.dealRivalId, this.currentBasket());
      this.closeDealModal(); // accepted, countered, or refused — the log has the answer
    };
    this.dealModal.querySelector<HTMLButtonElement>('#deal-cancel-btn')!.onclick = () => this.closeDealModal();
  }

  /** Regional faction intelligence panel (Phase 4): shows AI rival goals, alliances, and status. */
  private factionIntelHtml(): string {
    const r = this.region;
    const aiFactions = r.regionalFactions.filter((f) => f.id !== r.playerFactionId);
    if (aiFactions.length === 0) return '';

    const rows = aiFactions.map((faction) => {
      const stats = r.getFactionStats(faction.id);
      if (!stats) return '';

      const goalColor = faction.currentGoal ? '#c2a14d' : '#888';
      const goalText = faction.currentGoal
        ? `<span style="color:${goalColor}" title="${faction.currentGoal.description ?? ''}">${faction.currentGoal.objective}</span>` +
          (stats.goalProgress > 0 ? ` <span class="insp-skills">(${stats.goalProgress}%)</span>` : '')
        : `<span class="insp-skills">no active goal</span>`;

      const allyNames = stats.allies
        .map((id) => r.faction(id)?.name ?? '?')
        .join(', ');
      const rivalNames = stats.rivals
        .map((id) => r.faction(id)?.name ?? '?')
        .join(', ');

      const relRow = (allyNames || rivalNames)
        ? `<p class="insp-skills" style="margin-left:8px">` +
          (allyNames ? `<span style="color:#4e9">allies: ${allyNames}</span>` : '') +
          (allyNames && rivalNames ? ' · ' : '') +
          (rivalNames ? `<span style="color:#e55">rivals: ${rivalNames}</span>` : '') +
          `</p>`
        : '';

      const regimeName = RIVAL_REGIMES.find((g) => g.id === faction.regime)?.name ?? 'Unknown';
      return `<p style="margin:2px 0">` +
        `<b style="color:${faction.color ?? '#aaa'}">${faction.name}</b>` +
        ` <span class="insp-skills">${regimeName} · pop ${stats.population} · ${formatCurrency(Math.round(stats.treasury))}</span>` +
        `</p>` +
        `<p style="margin:2px 0 2px 8px">${goalText}</p>` +
        relRow;
    }).join('');

    // Recent AI activity from the global log (last 6 entries with TENSION, RAID, ALLIANCE, FACTION keywords)
    const factionLogEntries = r.log
      .filter((e) => /TENSION|RAID|RETALIATION|FACTION ALLIANCE|FACTION|proclaims new goal|achieves ambition|abandons goal/i.test(e.text))
      .slice(-6)
      .reverse();

    const logHtml = factionLogEntries.length > 0
      ? `<p class="insp-skills">RECENT FACTION ACTIVITY</p>` +
        `<ul class="thoughts">${factionLogEntries.map((e) =>
          `<li class="log-${e.kind}">${e.text}</li>`
        ).join('')}</ul>`
      : '';

    return `<p class="insp-skills">REGIONAL FACTIONS</p>` +
      rows +
      logHtml;
  }

  /** Freight overlay (M6b): what the caravans actually moved, per route. */
  private freightHtml(): string {
    const r = this.region;
    const name = (id: number) => r.settlement(id)?.name ?? '?';
    const lines = r.routes
      .filter((rt) => rt.freight > 0.5)
      .sort((a, b) => b.freight - a.freight)
      .slice(0, 5)
      .map((rt) => `<p class="insp-skills">${name(rt.a)} ↔ ${name(rt.b)}: ${Math.round(rt.freight)} food</p>`)
      .join('');
    return `<p class="insp-skills">FREIGHT (last caravans)</p>` + (lines || `<p class="insp-skills">no caravan traffic</p>`);
  }

  /** Central bank dashboard (GDD §5.1): policy rate, credit cycle, FX, bonds. */
  private monetaryHtml(): string {
    const r = this.region;
    if (!r.passedLaws.includes('central_bank_charter')) return '';
    const annualGDP = Math.max(1, r.gdpLastMonth * 12);
    const debtPct = Math.round(r.nationalDebt / annualGDP * 100);
    const leverPct = (r.privateLeverage * r.policyRate * 100).toFixed(0); // debt service %
    const confCol = r.confidence >= 60 ? '#4e9' : r.confidence >= 30 ? '#ca4' : '#e55';
    const ratingCol = ['AAA', 'AA', 'A'].includes(r.creditRating) ? '#4e9' : ['BBB', 'BB'].includes(r.creditRating) ? '#ca4' : '#e55';
    const regime = (id: MonetaryRegime, label: string) =>
      `<button class="mini cb-regime-btn" data-regime="${id}" ` +
      `${r.monetaryRegime === id ? 'style="background:#4e9;color:#000"' : ''} ` +
      `title="${id === 'float' ? 'Market-driven rate: adjusts with trade balance and confidence' : id === 'peg' ? 'Fix the rate — drains reserves if trade is unfavorable; can break spectacularly' : 'Print money: boosts treasury but drives inflation'}">` +
      `${label}</button>`;
    const canBond = (amt: number) => r.creditRating !== 'D' && r.nationalDebt + amt <= annualGDP * 2.0;
    return `<p class="insp-skills">CENTRAL BANK</p>` +
      `<div class="bar-row" title="Market confidence (0–100). Below 30 → deleveraging: credit contracts and GDP falls.">` +
      `<span style="width:80px;display:inline-block">confidence</span>` +
      `<div class="bar" style="flex:1"><div class="bar-fill" style="width:${r.confidence}%;background:${confCol}"></div></div>` +
      `<span>${Math.round(r.confidence)}</span></div>` +
      `<p class="insp-skills" title="Leverage: private debt service as % of GDP. Above 18% the cycle is fragile.">` +
      `leverage ${leverPct}% debt svc · inflation ${(r.inflationRate * 100).toFixed(1)}% · FX ${r.exchangeRate.toFixed(2)}</p>` +
      `<p>policy rate: <span id="rate-val">${(r.policyRate * 100).toFixed(0)}%</span></p>` +
      `<input id="rate-slider" type="range" min="${Math.round(MIN_POLICY_RATE * 100)}" max="${Math.round(MAX_POLICY_RATE * 100)}" ` +
      `value="${Math.round(r.policyRate * 100)}" ` +
      `title="Low rates: credit boom, GDP boost, then bust. High rates: credit contraction, inflation down.">` +
      `<p class="insp-skills">regime: ${regime('float', 'float')} ${regime('peg', 'peg')} ${regime('print', 'print')}</p>` +
      `<p class="insp-skills" title="Sovereign bonds: borrow against future tax receipts at the bond rate">` +
      `debt ` + formatCurrency(Math.floor(r.nationalDebt)) + ` (${debtPct}% GDP) · ` +
      `<span style="color:${ratingCol}">${r.creditRating}</span> · ` +
      `${(r.bondRate * 100).toFixed(1)}% coupon</p>` +
      (r.nationProclaimed
        ? `<p>` +
          `<button class="mini cb-bond-btn" data-amount="50" ${canBond(50) ? '' : 'disabled'}>bonds +${formatCurrency(50)}</button> ` +
          `<button class="mini cb-bond-btn" data-amount="100" ${canBond(100) ? '' : 'disabled'}>+${formatCurrency(100)}</button> ` +
          `<button class="mini cb-bond-btn" data-amount="250" ${canBond(250) ? '' : 'disabled'}>+${formatCurrency(250)}</button>` +
          `</p>`
        : '') +
      this.discountWindowHtml() +
      this.currencyHtml();
  }

  /** Currency standard controls: announce ahead to soften the eventual switch,
   *  or switch cold and let the markets say what they think of caprice. */
  private currencyHtml(): string {
    const r = this.region;
    const others = CURRENCY_SYMBOLS.filter((s) => s !== r.currencySymbol);
    const announced = r.currencyAnnouncement;
    const announceRow = announced
      ? `<p class="insp-skills">announced ${announced.newSymbol} ` +
        `(${r.day - announced.announcedDay >= ANNOUNCE_LEAD_DAYS
          ? 'markets are ready — switch is cushioned'
          : `${ANNOUNCE_LEAD_DAYS - (r.day - announced.announcedDay)}d until markets price it in`})</p>`
      : `<p class="insp-skills" title="Telegraphing a switch ${ANNOUNCE_LEAD_DAYS}+ days ahead softens the penalties by 25%.">` +
        `announce: ${others.map((s) => `<button class="mini cb-cur-announce" data-sym="${s}">${s}</button>`).join(' ')}</p>`;
    return `<p class="insp-skills" title="Switching the currency standard costs capital flight and an efficiency dip. Crisis-driven switches are forgiven faster; whims are punished. Reserves and advance notice both soften it.">` +
      `CURRENCY STANDARD: ${r.currencySymbol}</p>` +
      announceRow +
      `<p class="insp-skills">switch: ${others.map((s) => `<button class="mini cb-cur-switch" data-sym="${s}">${s}</button>`).join(' ')}</p>`;
  }

  /** Central Bank discount window: short-term borrowing at the policy rate. */
  private discountWindowHtml(): string {
    const r = this.region;
    if (!r.passedLaws.includes('central_bank_charter')) return '';
    const maxDraw = Math.max(0, r.treasury * 0.5 - r.centralBankLoan);
    const cbCol = r.centralBankLoan > r.treasury * 0.3 ? '#e55' : '#4e9';
    return `<p class="insp-skills" title="The discount window lets you borrow short-term from your own central bank at the policy rate. Interest compounds monthly. Outstanding balance is capped at 50% of current treasury.">` +
      `DISCOUNT WINDOW</p>` +
      (r.centralBankLoan > 0
        ? `<p class="insp-skills">outstanding: <span style="color:${cbCol}">` + formatCurrency(Math.round(r.centralBankLoan)) + `</span> @ ${(r.policyRate * 100).toFixed(1)}%</p>` +
          `<p><button class="mini cb-dw-repay" data-amount="${Math.ceil(r.centralBankLoan * 0.5)}">repay ½</button> ` +
          `<button class="mini cb-dw-repay" data-amount="${Math.ceil(r.centralBankLoan)}">repay all</button></p>`
        : `<p class="insp-skills">no outstanding balance</p>`) +
      (maxDraw > 0
        ? `<p><button class="mini cb-dw-draw" data-amount="${Math.floor(maxDraw * 0.25)}">draw ${formatCurrency(Math.floor(maxDraw * 0.25))}</button> ` +
          `<button class="mini cb-dw-draw" data-amount="${Math.floor(maxDraw * 0.5)}">draw ${formatCurrency(Math.floor(maxDraw * 0.5))}</button> ` +
          `<button class="mini cb-dw-draw" data-amount="${Math.floor(maxDraw)}">draw ${formatCurrency(Math.floor(maxDraw))}</button></p>`
        : `<p class="insp-skills" style="color:#ca4">ceiling reached (50% of treasury)</p>`);
  }

  private lendersHtml(): string {
    const r = this.region;
    // Lenders only available at region tier with Market building, or nation tier
    if (!r.stateProclaimed) return '';
    const hasMarket = r.settlements.some((s) => s.buildings.some((b) => b.includes('market')));
    const hasBank = r.settlements.some((s) => s.buildings.some((b) => b.includes('bank')));
    const hasCbCharter = r.passedLaws.includes('central_bank_charter');
    if (!hasMarket && !hasBank && !hasCbCharter) return '';

    let html = `<p class="insp-skills">LENDERS</p>`;

    // Show available lenders
    if (r.lenders.length > 0) {
      const rateNote = r.passedLaws.includes('central_bank_charter')
        ? ` <span style="color:#888;font-size:9px">(policy ${(r.policyRate * 100).toFixed(0)}% + spread)</span>`
        : '';
      html += `<div style="font-size:11px;margin:4px 0">Available lenders:${rateNote}</div>`;
      for (const lender of r.lenders) {
        const canBorrow = r.treasury > 0 && lender.liquidCash > 0;
        const avail = lender.liquidCash > 0
          ? `avail ` + formatCurrency(Math.floor(lender.liquidCash))
          : `<span style="color:#e55">no liquidity</span>`;
        html += `<p style="margin:2px 0;font-size:10px">` +
          `${lender.name} — max ` + formatCurrency(lender.maxLoan) + ` @ ${(lender.interestRate * 100).toFixed(1)}% · ${avail} ` +
          (canBorrow ? `<button class="mini lender-btn" data-lender="${lender.id}">borrow</button>` : '') +
          `</p>`;
      }
    }

    // Show active loans
    const activeLoans = r.getActiveLoans();
    if (activeLoans.length > 0) {
      html += `<div style="font-size:11px;margin:8px 0 4px 0">Active loans:</div>`;
      for (const loan of activeLoans) {
        const lender = r.lenders.find((l) => l.id === loan.lenderId);
        const owing = Math.round(loan.borrowed);
        const canRepay = r.treasury >= owing * 0.1; // can repay at least 10%
        html += `<p style="margin:2px 0;font-size:10px">` +
          `${lender?.name ?? 'lender'} — ` + formatCurrency(owing) + ` owing ` +
          (canRepay ? `<button class="mini loan-repay-btn" data-loan="${loan.id}" data-lender="${loan.lenderId}">repay</button>` : '') +
          `</p>`;
      }
    }

    return html;
  }

  /** Force the panel to rebuild its HTML on the next frame (called after game actions). */
  private refreshPanel(): void {
    this.lastPanelBuildFrame = -999;
  }

  private drawPanel(): void {
    const t = this.region.settlements.find((s) => s.id === this.selectedId);
    if (!t) {
      this.panel.classList.add('hidden');
      this.lastPanelBuildId = null;
      return;
    }
    this.panel.classList.remove('hidden');

    // Only rebuild innerHTML when selection changes or once per second (~60 frames).
    // Rebuilding every frame destroys the button DOM node between mousedown and click,
    // so the click event fires on the panel div instead of the button.
    if (this.editingName) return; // don't clobber the open rename field
    const needsRebuild = this.lastPanelBuildId !== t.id || this.frame - this.lastPanelBuildFrame >= 60;
    if (!needsRebuild) return;

    this.lastPanelBuildId = t.id;
    this.lastPanelBuildFrame = this.frame;

    this.panel.innerHTML = this.panelHtml(t);
    this.wireTabs(this.panel, (tab) => { this.panelTab = tab as 'overview' | 'economy' | 'people'; });
    const btn = this.panel.querySelector<HTMLButtonElement>('#found-btn');
    if (btn) {
      btn.onclick = () => { this.region.foundTown(t.id); this.refreshPanel(); };
    }
    // Inline rename: Electron has no window.prompt(), so swap the heading for an
    // editable field on click. Enter/blur commits, Escape cancels.
    const renameBtn = this.panel.querySelector<HTMLButtonElement>('#rename-btn');
    if (renameBtn) {
      renameBtn.onclick = () => {
        const heading = renameBtn.closest('h3');
        if (!heading) return;
        const input = document.createElement('input');
        input.type = 'text';
        input.maxLength = 28;
        input.value = t.name;
        input.className = 'rename-input';
        heading.replaceWith(input);
        this.editingName = true;
        input.focus();
        input.select();
        let done = false;
        const commit = (save: boolean): void => {
          if (done) return;
          done = true;
          this.editingName = false;
          if (save && input.value.trim()) t.name = input.value.trim();
          this.refreshPanel();
        };
        input.onkeydown = (ev) => {
          if (ev.key === 'Enter') { ev.preventDefault(); commit(true); }
          else if (ev.key === 'Escape') { ev.preventDefault(); commit(false); }
          ev.stopPropagation(); // don't let the game eat the keystrokes
        };
        input.onblur = () => commit(true);
      };
    }
    for (const rb of this.panel.querySelectorAll<HTMLButtonElement>('.road-btn')) {
      rb.onclick = () => { this.region.buildRoad(t.id, Number(rb.dataset.to)); this.refreshPanel(); };
    }
    for (const rb of this.panel.querySelectorAll<HTMLButtonElement>('.rail-btn')) {
      rb.onclick = () => { this.region.buildRail(t.id, Number(rb.dataset.to)); this.refreshPanel(); };
    }
    for (const rb of this.panel.querySelectorAll<HTMLButtonElement>('.hwy-btn')) {
      rb.onclick = () => { this.region.buildHighway(t.id, Number(rb.dataset.to)); this.refreshPanel(); };
    }
    for (const rb of this.panel.querySelectorAll<HTMLButtonElement>('.mag-btn')) {
      rb.onclick = () => { this.region.buildMaglev(t.id, Number(rb.dataset.to)); this.refreshPanel(); };
    }
    for (const rb of this.panel.querySelectorAll<HTMLButtonElement>('.repair-btn')) {
      rb.onclick = () => { this.region.repairRoute(t.id, Number(rb.dataset.to)); this.refreshPanel(); };
    }
    const sw = this.panel.querySelector<HTMLButtonElement>('#seawall-btn');
    if (sw) sw.onclick = () => { this.region.buildSeaWall(t.id); this.refreshPanel(); };
    const mil = this.panel.querySelector<HTMLButtonElement>('#militia-btn');
    if (mil) mil.onclick = () => { this.region.recruitMilitia(t.id); this.refreshPanel(); };
    for (const cb of this.panel.querySelectorAll<HTMLButtonElement>('.city-build-btn')) {
      cb.onclick = () => { this.region.buildCity(t.id, cb.dataset.b!); this.refreshPanel(); };
    }
    for (const fb of this.panel.querySelectorAll<HTMLButtonElement>('.focus-btn')) {
      fb.onclick = () => { this.region.setTownFocus(t.id, fb.dataset.f as TownFocus); this.refreshPanel(); };
    }
    for (const tb of this.panel.querySelectorAll<HTMLButtonElement>('.policy-tax-btn')) {
      tb.onclick = () => { this.region.setCityPolicy(t.id, 'taxBand', Number(tb.dataset.tax)); this.refreshPanel(); };
    }
    for (const wb of this.panel.querySelectorAll<HTMLButtonElement>('.policy-wage-btn')) {
      wb.onclick = () => { this.region.setCityPolicy(t.id, 'wagePolicy', wb.dataset.wage as WagePolicy); this.refreshPanel(); };
    }
    for (const sb of this.panel.querySelectorAll<HTMLButtonElement>('.policy-svc-btn')) {
      sb.onclick = () => { this.region.setCityPolicy(t.id, 'serviceLevel', Number(sb.dataset.svc)); this.refreshPanel(); };
    }
    const aidBtn = this.panel.querySelector<HTMLButtonElement>('.crisis-aid-btn');
    if (aidBtn) aidBtn.onclick = () => { this.region.sendFoodAid(t.id); this.refreshPanel(); };
    const svcBtn = this.panel.querySelector<HTMLButtonElement>('.crisis-svc-btn');
    if (svcBtn) svcBtn.onclick = () => { this.region.servicesLevel = Math.min(2, this.region.servicesLevel + 1); this.refreshPanel(); };
    const taxBtn = this.panel.querySelector<HTMLButtonElement>('.crisis-tax-btn');
    if (taxBtn) taxBtn.onclick = () => { this.region.taxRate = Math.max(0, this.region.taxRate - 0.02); this.refreshPanel(); };
  }

  /** Phase C: rival faction detail panel — shown when the player clicks a rival
   *  settlement. Displays faction stats and conquest/diplomacy action buttons. */
  private drawRivalPanel(): void {
    const r = this.region;
    if (this.selectedFactionId === null) {
      this.rivalPanel.classList.add('hidden');
      this.lastRivalPanelFactionId = null;
      return;
    }
    this.rivalPanel.classList.remove('hidden');
    const fid = this.selectedFactionId;
    if (this.lastRivalPanelFactionId === fid && this.frame - this.lastPanelBuildFrame < 60) return;
    this.lastRivalPanelFactionId = fid;

    const faction = r.faction(fid);
    if (!faction) { this.rivalPanel.classList.add('hidden'); return; }
    const stats = r.getFactionStats(fid);
    if (!stats) { this.rivalPanel.classList.add('hidden'); return; }

    const playerFaction = r.faction(r.playerFactionId);
    const isVassal = faction.overlordId === r.playerFactionId;
    const territory = (r.territoryControlOf(fid) * 100).toFixed(1);
    const regimeDef = RIVAL_REGIMES.find((x) => x.id === faction.regime);
    const regimeName = regimeDef?.name ?? faction.regime;

    const canVassalize = !isVassal && faction.settlementIds.length > 0 && r.stateProclaimed;
    const canBuyLand = faction.treasury < 150 && faction.settlementIds.length > 1 && (playerFaction?.treasury ?? 0) >= 500;

    this.rivalPanel.innerHTML =
      `<h3><span style="color:${faction.color}">■</span> ${faction.name}</h3>` +
      `<p class="insp-skills">${regimeName} · ${faction.regime}</p>` +
      (isVassal ? `<p style="color:#8fc26a">★ Vassal of your state</p>` : '') +
      `<p>settlements <b>${stats.settlements}</b> · pop <b>${stats.population}</b></p>` +
      `<p>treasury <b>${formatCurrency(stats.treasury)}</b> · military <b>${stats.militaryStrength}</b></p>` +
      `<p>territory <b>${territory}%</b> of region</p>` +
      (stats.currentGoal ? `<p>goal <i>${stats.currentGoal}</i></p>` : '') +
      `<hr>` +
      (canVassalize
        ? `<button id="rival-vassalize-btn">Propose Vassalization</button><br>`
        : isVassal ? '' : `<button disabled title="Need 2× military edge or rival treasury &lt;100">Propose Vassalization</button><br>`) +
      (canBuyLand
        ? `<button id="rival-buy-land-btn">Buy Land (£500)</button><br>`
        : `<button disabled title="Rival treasury must be &lt;£150 and you need £500">Buy Land</button><br>`) +
      `<button id="rival-close-btn" class="mini" style="margin-top:6px">Close</button>`;

    this.rivalPanel.querySelector<HTMLButtonElement>('#rival-close-btn')!.onclick = () => {
      this.selectedFactionId = null;
    };
    const vassalBtn = this.rivalPanel.querySelector<HTMLButtonElement>('#rival-vassalize-btn');
    if (vassalBtn) {
      vassalBtn.onclick = () => {
        const result = r.offerVassalage(fid);
        if (result === 'accepted') {
          this.selectedFactionId = null; // panel will rebuild next frame
        }
        this.lastRivalPanelFactionId = null; // force rebuild
      };
    }
    const buyBtn = this.rivalPanel.querySelector<HTMLButtonElement>('#rival-buy-land-btn');
    if (buyBtn) {
      buyBtn.onclick = () => {
        r.buyLand(fid);
        this.lastRivalPanelFactionId = null; // force rebuild
      };
    }
  }

  /** Defence row: this town's garrison plus a button to drill more militia —
   *  a clear treasury sink that satisfies the Charter's military gate. */
  private garrisonHtml(t: Settlement): string {
    const r = this.region;
    const g = Math.round(t.garrisonStrength || 0);
    const cap = r.garrisonCap(t);
    const can = r.canRecruitMilitia(t.id);
    return (
      `<p class="insp-skills">DEFENCE</p>` +
      `<p>garrison <b>${g}</b>/${cap} militia</p>` +
      `<button class="mini" id="militia-btn" ${can.ok ? '' : 'disabled'} ` +
      `title="${can.ok ? `Arm and drill ${RegionSim.MILITIA_ADD} more militia` : can.reason}">` +
      `drill militia (+${RegionSim.MILITIA_ADD}, ${formatCurrency(RegionSim.MILITIA_COST)})</button>` +
      (can.ok ? '' : ` <span class="insp-skills">${can.reason}</span>`)
    );
  }

  /** Route list to every other town, with terrain-priced build/repair buttons. */
  private routesHtml(t: Settlement): string {
    const r = this.region;
    const rows = r.settlements
      .filter((o) => o.id !== t.id)
      .map((o) => {
        const route = r.routeBetween(t.id, o.id);
        const cargoColors: Record<string, string> = { agriculture: '#c2a14d', industry: '#8c6848', services: '#4a7fa4', information: '#7a5a9a' };
        const cargoBadge = route?.cargoType
          ? ` <span style="color:${cargoColors[route.cargoType]}">[${route.cargoType.slice(0, 3)}]</span>`
          : '';
        const days = Math.max(1, Math.round(r.map.travelDays(t.x, t.y, o.x, o.y) / (route ? ROUTE_SPECS[route.kind].speed : 1)));
        const freightNote = route && route.freight > 0 ? ` · freight ${Math.round(route.freight)}` : '';
        const status = route
          ? `${route.kind} · ${Math.round(route.condition)}% · ~${days}d${freightNote}${cargoBadge}`
          : `no route · ~${days}d walk`;
        let btn = '';
        if (r.stateProclaimed && (!route || route.kind === 'trail')) {
          const cost = r.roadCost(t.id, o.id);
          if (cost) {
            const afford = r.treasury >= cost.total;
            btn += ` <button class="mini road-btn" data-to="${o.id}" ${afford ? '' : 'disabled'} ` +
              `title="` + formatCurrency(cost.total) + `: ${cost.breakdown}">road ` + formatCurrency(cost.total) + `</button>`;
          }
        }
        if (r.railUnlocked() && (!route || (route.kind !== 'rail' && route.kind !== 'highway' && route.kind !== 'maglev'))) {
          const cost = r.railCost(t.id, o.id);
          if (cost) {
            const afford = r.treasury >= cost.total;
            btn += ` <button class="mini rail-btn" data-to="${o.id}" ${afford ? '' : 'disabled'} ` +
              `title="` + formatCurrency(cost.total) + `: ${cost.breakdown}">rail ` + formatCurrency(cost.total) + `</button>`;
          }
        }
        if (r.highwayUnlocked() && (!route || (route.kind !== 'highway' && route.kind !== 'maglev'))) {
          const cost = r.highwayCost(t.id, o.id);
          if (cost) {
            const afford = r.treasury >= cost.total;
            btn += ` <button class="mini hwy-btn" data-to="${o.id}" ${afford ? '' : 'disabled'} ` +
              `title="` + formatCurrency(cost.total) + `: ${cost.breakdown}${route?.kind === 'rail' ? ' — replaces the rail line' : ''}">highway ` + formatCurrency(cost.total) + `</button>`;
          }
        }
        if (r.maglevUnlocked() && (!route || route.kind !== 'maglev')) {
          const cost = r.maglevCost(t.id, o.id);
          if (cost) {
            const afford = r.treasury >= cost.total;
            const replaces = route && route.kind !== 'trail' ? ` — replaces the ${route.kind}` : '';
            btn += ` <button class="mini mag-btn" data-to="${o.id}" ${afford ? '' : 'disabled'} ` +
              `title="` + formatCurrency(cost.total) + `: ${cost.breakdown}${replaces}">maglev ` + formatCurrency(cost.total) + `</button>`;
          }
        }
        if (r.stateProclaimed && route && route.kind !== 'trail' && route.condition < 85) {
          const cost = r.repairCost(route);
          const afford = r.treasury >= cost;
          btn += ` <button class="mini repair-btn" data-to="${o.id}" ${afford ? '' : 'disabled'} ` +
            `title="restore to 100%">repair ` + formatCurrency(cost) + `</button>`;
        }
        return `<li>${o.name} — <span class="insp-skills">${status}</span>${btn}</li>`;
      })
      .join('');
    if (!rows) return '';
    return `<p class="insp-skills">ROUTES</p><ul class="thoughts">${rows}</ul>`;
  }

  /** Phase 2: the drafting table — civic works and zoning for managed cities. */
  private cityHtml(t: Settlement): string {
    const r = this.region;
    if (!r.stateProclaimed) return '';
    const manage = r.canManageCity(t);
    if (!manage.ok) {
      // the player's own towns advertise the gate; the hamlets run themselves
      return t.factionId === r.playerFactionId
        ? `<p class="insp-skills">CITY WORKS · ${manage.reason}</p>`
        : '';
    }
    const built = t.buildings
      .map((id) => REGION_BUILDINGS.find((b) => b.id === id))
      .filter((d) => d)
      .map((d) => `<abbr title="${d!.desc}">${d!.name}</abbr>`);
    const builtHtml = built.length ? `<p>${built.join(' · ')}</p>` : '';
    const consDef = t.construction ? REGION_BUILDINGS.find((b) => b.id === t.construction!.id) : null;
    const consHtml = consDef && t.construction
      ? `<p class="insp-skills">⚒ building ${consDef.name} — ${Math.max(0, t.construction.doneDay - r.day)} days</p>`
      : '';
    const rows = REGION_BUILDINGS
      .filter((def) => (!def.prereq || r.has(def.prereq)) && r.buildingCount(t, def.id) < def.max)
      .map((def) => {
        const check = r.cityBuildCheck(t, def);
        return `<li>${def.name} <button class="mini city-build-btn" data-b="${def.id}" ${check.ok ? '' : 'disabled'} ` +
          `title="${def.desc}${check.ok ? '' : ' — ' + check.reason}">` + formatCurrency(r.cityBuildCost(def)) + ` · ${def.days}d</button></li>`;
      })
      .join('');
    const focusBtns = (['balanced', ...SECTOR_IDS] as TownFocus[])
      .map((f) => {
        const label = f === 'balanced' ? 'balanced' : SECTOR_NAMES[f].toLowerCase();
        return t.focus === f
          ? `<b>${label}</b>`
          : `<button class="mini focus-btn" data-f="${f}" title="Repaint the designation (` + formatCurrency(FOCUS_CHANGE_COST) + `) — labor drifts toward it over the months">${label}</button>`;
      })
      .join(' ');
    return (
      `<p class="insp-skills">CITY WORKS</p>` +
      builtHtml + consHtml +
      (rows ? `<ul class="thoughts">${rows}</ul>` : '') +
      `<p class="insp-skills">zoning: ${focusBtns}</p>`
    );
  }

  /** Phase 3: Sector bars — four colored bands showing where labor sits and
   *  what it earns, with a growth arrow so the player can read the trend. */
  private sectorsHtml(t: Settlement): string {
    const r = this.region;
    const SECTOR_COLORS: Record<string, string> = {
      agriculture: '#c2a14d', industry: '#8c6848', services: '#4a7fa4', information: '#7a5a9a',
    };
    const CARGO_ICONS: Record<string, string> = {
      agriculture: 'agri', industry: 'ind', services: 'svc', information: 'info',
    };
    // Compute GDP contribution of this town for context
    const totalOutput = SECTOR_IDS.reduce((s, id) => s + t.sectors[id].output, 0);
    const rows = SECTOR_IDS.map((id) => {
      const s = t.sectors[id];
      const pct = Math.round(s.share * 100);
      const arrow = s.growth > 0.001 ? '+' : s.growth < -0.001 ? '-' : '=';
      const arrowClass = s.growth > 0.001 ? 'insp-state' : s.growth < -0.001 ? 'insp-cond' : 'insp-skills';
      const color = SECTOR_COLORS[id];
      void CARGO_ICONS[id];
      // Active events affecting this sector
      const activeEvt = t.activeEvents.find((ev) => {
        const def = REGION_EVENT_DEFS.find((d) => d.kind === ev.kind);
        return def && (def.sector === id || def.sector === 'all') && ev.untilDay > r.day;
      });
      const evtBadge = activeEvt ? ` <span class="insp-cond">[${REGION_EVENT_DEFS.find((d) => d.kind === activeEvt.kind)?.name ?? '!'}]</span>` : '';
      return (
        `<div class="bar-row">` +
        `<span style="color:${color};min-width:70px">${SECTOR_NAMES[id]}</span>` +
        `<div class="bar" style="flex:1">` +
        `<div class="bar-fill" style="width:${pct}%;background:${color}"></div>` +
        `</div>` +
        `<span style="min-width:28px;text-align:right">${pct}%</span>` +
        `<span class="${arrowClass}" style="min-width:12px;text-align:center">${arrow}</span>` +
        `<span class="insp-skills" style="min-width:52px;text-align:right">${s.output.toFixed(1)}/m</span>` +
        `<span class="insp-skills" style="min-width:52px;text-align:right">` + formatCurrency(s.wage / 30, 2) + `/d</span>` +
        evtBadge +
        `</div>`
      );
    }).join('');
    const gdpNote = totalOutput > 0 ? `<span class="insp-skills">GDP contribution ` + formatCurrency(totalOutput * 1.08, 1) + `/month</span>` : '';
    return `<p class="insp-skills">SECTORS${gdpNote ? ' · ' : ''}${gdpNote}</p>${rows}`;
  }

  /** Phase 5: local governance policies panel — tax band, wage policy, service
   *  level — shown only in managed cities. */
  private policiesHtml(t: Settlement): string {
    const r = this.region;
    if (!r.canManageCity(t).ok) return '';
    const p = t.policies;

    const taxBtns = TAX_BAND_LABELS.map((label, i) =>
      p.taxBand === i
        ? `<b>${label}</b>`
        : `<button class="mini policy-tax-btn" data-tax="${i}" title="Set settlement tax to ${label}">${label}</button>`
    ).join(' ');

    const wagePolicies: WagePolicy[] = ['low', 'market', 'high'];
    const wageBtns = wagePolicies.map((wp) =>
      p.wagePolicy === wp
        ? `<b>${wp}</b>`
        : `<button class="mini policy-wage-btn" data-wage="${wp}" title="Set wage policy to ${wp}">${wp}</button>`
    ).join(' ');

    const svcLevels = ['minimal', 'standard', 'generous'];
    const svcBtns = svcLevels.map((label, i) =>
      p.serviceLevel === i
        ? `<b>${label}</b>`
        : `<button class="mini policy-svc-btn" data-svc="${i}" title="Set service level to ${label}">${label}</button>`
    ).join(' ');

    const taxRevNote = p.taxBand > 0
      ? ` <span class="insp-skills">(+${(DEFAULT_CITY_POLICIES.taxBand !== p.taxBand ? p.taxBand * 5 : 0)}% local tax)</span>`
      : '';

    return (
      `<p class="insp-skills">LOCAL POLICIES</p>` +
      `<p class="insp-skills">tax: ${taxBtns}${taxRevNote}</p>` +
      `<p class="insp-skills">wages: ${wageBtns}</p>` +
      `<p class="insp-skills">services: ${svcBtns}` +
      (p.serviceLevel >= 2 ? ` <span class="insp-cond">(+` + formatCurrency(r.popOf(t) * 0.002, 1) + `/month)</span>` : '') +
      `</p>`
    );
  }

  /** Phase A: the region-wide Route Network panel — every link laid out with
   *  its condition, effective capacity, cargo, and travel time, plus
   *  repair / upgrade / tear-up / cargo-priority controls in one place. */
  private drawRouteNetworkPanel(): void {
    const r = this.region;
    if (!this.routeNetworkOpen) {
      this.routeNetworkPanel.classList.add('hidden');
      return;
    }
    this.routeNetworkPanel.classList.remove('hidden');
    // Same DOM-stability guard as the other panels: rebuild on a timer, not
    // every frame, so a button node survives between mousedown and click.
    if (this.frame - this.lastNetworkBuildFrame < 60) return;
    this.lastNetworkBuildFrame = this.frame;
    this.routeNetworkPanel.innerHTML = this.routeNetworkHtml();
    const refresh = () => { this.lastNetworkBuildFrame = -999; };
    for (const b of this.routeNetworkPanel.querySelectorAll<HTMLButtonElement>('.rn-close')) {
      b.onclick = () => { this.routeNetworkOpen = false; };
    }
    for (const b of this.routeNetworkPanel.querySelectorAll<HTMLButtonElement>('.rn-upgrade-btn')) {
      b.onclick = () => {
        const a = Number(b.dataset.a), to = Number(b.dataset.b), kind = b.dataset.kind;
        if (kind === 'road') r.buildRoad(a, to);
        else if (kind === 'rail') r.buildRail(a, to);
        else if (kind === 'highway') r.buildHighway(a, to);
        else if (kind === 'maglev') r.buildMaglev(a, to);
        refresh();
      };
    }
    for (const b of this.routeNetworkPanel.querySelectorAll<HTMLButtonElement>('.rn-repair-btn')) {
      b.onclick = () => { r.repairRoute(Number(b.dataset.a), Number(b.dataset.b)); refresh(); };
    }
    for (const b of this.routeNetworkPanel.querySelectorAll<HTMLButtonElement>('.rn-delete-btn')) {
      b.onclick = () => { r.deleteRoute(Number(b.dataset.a), Number(b.dataset.b)); refresh(); };
    }
    for (const b of this.routeNetworkPanel.querySelectorAll<HTMLButtonElement>('.rn-cargo-btn')) {
      b.onclick = () => {
        const s = b.dataset.sector === 'auto' ? null : (b.dataset.sector as SectorId);
        r.setRouteCargoPriority(Number(b.dataset.a), Number(b.dataset.b), s);
        refresh();
      };
    }
  }

  private routeNetworkHtml(): string {
    const r = this.region;
    type Up = 'road' | 'rail' | 'highway' | 'maglev';
    const RANK: Route['kind'][] = ['trail', 'road', 'rail', 'highway', 'maglev'];
    const unlocked = (k: Up): boolean =>
      k === 'rail' ? r.railUnlocked() : k === 'highway' ? r.highwayUnlocked() : k === 'maglev' ? r.maglevUnlocked() : r.stateProclaimed;
    // Best link the era allows that's strictly above the current kind.
    const bestUpgrade = (cur: Route['kind']): Up | null => {
      for (let i = RANK.length - 1; i > RANK.indexOf(cur); i--) {
        if (unlocked(RANK[i] as Up)) return RANK[i] as Up;
      }
      return null;
    };
    const cargoColors: Record<string, string> = { agriculture: '#c2a14d', industry: '#8c6848', services: '#4a7fa4', information: '#7a5a9a' };
    const built = r.routes.filter((rt) => rt.kind !== 'trail');
    const upkeep = built.reduce((s, rt) => s + r.maintBill(rt), 0);
    const rows = [...r.routes]
      .sort((a, b) => b.freight - a.freight)
      .map((rt) => {
        const a = r.settlement(rt.a);
        const b = r.settlement(rt.b);
        if (!a || !b) return '';
        const cap = Math.round(r.effectiveCapacity(rt));
        const days = Math.max(1, Math.round(r.map.travelDays(a.x, a.y, b.x, b.y) / ROUTE_SPECS[rt.kind].speed));
        const condClass = rt.condition < 50 ? 'insp-cond' : 'insp-skills';
        const cargoBadge = rt.cargoType
          ? ` <span style="color:${cargoColors[rt.cargoType]}">[${rt.cargoType.slice(0, 3)}${rt.cargoPriority ? '📌' : ''}]</span>`
          : '';
        let acts = '';
        const up = bestUpgrade(rt.kind);
        if (up) {
          const cost = r.linkCost(rt.a, rt.b, up);
          if (cost) {
            const afford = r.treasury >= cost.total;
            acts += ` <button class="mini rn-upgrade-btn" data-a="${rt.a}" data-b="${rt.b}" data-kind="${up}" ${afford ? '' : 'disabled'} ` +
              `title="${cost.breakdown}${rt.kind !== 'trail' ? ` — replaces the ${rt.kind}` : ''}">▲${up} ` + formatCurrency(cost.total) + `</button>`;
          }
        }
        if (rt.kind !== 'trail' && rt.condition < 99) {
          const cost = r.repairCost(rt);
          acts += ` <button class="mini rn-repair-btn" data-a="${rt.a}" data-b="${rt.b}" ${r.treasury >= cost ? '' : 'disabled'} title="restore to 100%">repair ` + formatCurrency(cost) + `</button>`;
        }
        if (rt.kind !== 'trail') {
          acts += ` <button class="mini rn-delete-btn" data-a="${rt.a}" data-b="${rt.b}" title="tear up the ${rt.kind} — falls back to a trail">tear up</button>`;
        }
        let pins = '';
        if (rt.kind !== 'trail') {
          pins = SECTOR_IDS.map((id) =>
            rt.cargoPriority === id
              ? `<b style="color:${cargoColors[id]}">${id.slice(0, 3)}</b>`
              : `<button class="mini rn-cargo-btn" data-a="${rt.a}" data-b="${rt.b}" data-sector="${id}" title="Pin ${SECTOR_NAMES[id]} as this route's priority cargo">${id.slice(0, 3)}</button>`,
          ).join(' ');
          pins += rt.cargoPriority
            ? ` <button class="mini rn-cargo-btn" data-a="${rt.a}" data-b="${rt.b}" data-sector="auto" title="Hand the route back to automatic cargo selection">auto</button>`
            : ` <b>auto</b>`;
        }
        return `<div style="margin:4px 0">${a.name} ↔ ${b.name} — <span class="${condClass}">${rt.kind} ${Math.round(rt.condition)}%</span> ` +
          `<span class="insp-skills">· cap ${cap}/mo · ${rt.freight > 0 ? `freight ${Math.round(rt.freight)}` : 'idle'} · ~${days}d</span>${cargoBadge}` +
          (acts ? `<br>${acts}` : '') +
          (pins ? `<br><span class="insp-skills">cargo:</span> ${pins}` : '') +
          `</div>`;
      })
      .join('');
    return (
      `<div class="pal-title">ROUTE NETWORK <button class="mini rn-close" title="close (R)">✕</button></div>` +
      `<p class="insp-skills">${r.routes.length} links · ${built.length} built · upkeep ` + formatCurrency(upkeep, 1) + `/mo</p>` +
      `<div class="thoughts">${rows || '<p class="insp-skills">no routes yet</p>'}</div>`
    );
  }

  /** Pan the map so the given region-coordinate (0–100) is at screen centre. */
  centerOn(x: number, y: number): void {
    const { px, py } = this.toPx(x, y);
    this.camX = this.canvas.width / 2 - px * this.camScale;
    this.camY = this.canvas.height / 2 - py * this.camScale;
    this.clampCamera();
  }

  /** Phase A: Settlements list panel — all player towns with at-a-glance health
   *  and a one-click pan/select shortcut. Toggle with the S key. */
  private drawSettlementListPanel(): void {
    const r = this.region;
    if (!this.settlementListOpen) {
      this.settlementListPanel.classList.add('hidden');
      return;
    }
    this.settlementListPanel.classList.remove('hidden');
    if (this.frame - this.lastSettlementListBuildFrame < 60) return;
    this.lastSettlementListBuildFrame = this.frame;
    this.settlementListPanel.innerHTML = this.settlementListHtml();
    for (const b of this.settlementListPanel.querySelectorAll<HTMLButtonElement>('.sl-close')) {
      b.onclick = () => { this.settlementListOpen = false; };
    }
    for (const b of this.settlementListPanel.querySelectorAll<HTMLButtonElement>('.sl-select-btn')) {
      b.onclick = () => {
        const sid = Number(b.dataset.sid);
        this.selectedId = sid;
        const t = r.settlement(sid);
        if (t) this.centerOn(t.x, t.y);
        this.lastSettlementListBuildFrame = -999;
      };
    }
    for (const b of this.settlementListPanel.querySelectorAll<HTMLButtonElement>('.sl-aid-btn')) {
      b.onclick = () => { r.sendFoodAid(Number(b.dataset.sid)); this.lastSettlementListBuildFrame = -999; };
    }
  }

  private settlementListHtml(): string {
    const r = this.region;
    const towns = r.settlements
      .filter((t) => t.factionId === r.playerFactionId)
      .sort((a, b) => r.popOf(b) - r.popOf(a));
    const sColor = (s: string) => s === 'surplus' ? '#4e9' : s === 'deficit' ? '#e55' : '#998c6e';
    const alerts = towns.filter((t) => t.food < r.popOf(t) * 5 || t.grievance > 60 || r.day < t.strikeUntil);
    const alertHtml = alerts.length
      ? `<p class="insp-cond">⚠ ${alerts.length} town${alerts.length > 1 ? 's' : ''} need attention</p>`
      : `<p class="insp-skills">all towns stable</p>`;
    const rows = towns.map((t) => {
      const pop = Math.round(r.popOf(t));
      const status = r.getSettlementResourceStatus(t);
      const satColor = t.satisfaction >= 60 ? '#4e9' : t.satisfaction >= 40 ? '#ca4' : '#e55';
      const griCol = t.grievance > 60 ? 'insp-cond' : 'insp-skills';
      const strike = r.day < t.strikeUntil ? ' <span class="insp-cond">STRIKE</span>' : '';
      const hungry = t.food < r.popOf(t) * 5;
      return (
        `<div style="margin:4px 0;padding:4px 0;border-bottom:1px solid #3a2e20">` +
        `<div><b>${t.name}</b> <button class="mini sl-select-btn" data-sid="${t.id}" title="Pan to this settlement">→</button>` +
        (hungry ? ` <button class="mini sl-aid-btn" data-sid="${t.id}" title="Send emergency grain convoy (£10)">🌾 aid</button>` : '') +
        `</div>` +
        `<div class="insp-skills">pop ${pop} · <span style="color:${satColor}">sat ${Math.round(t.satisfaction)}</span> · <span class="${griCol}">grv ${Math.round(t.grievance)}</span>${strike}</div>` +
        `<div class="insp-skills">` +
        `<span style="color:${sColor(status.food)}" title="food">food ${status.food[0]}</span> ` +
        `<span style="color:${sColor(status.wood)}" title="timber">wood ${status.wood[0]}</span> ` +
        `<span style="color:${sColor(status.goods)}" title="goods">goods ${status.goods[0]}</span>` +
        `</div></div>`
      );
    }).join('');
    return (
      `<div class="pal-title">SETTLEMENTS [S] <button class="mini sl-close" title="close (S)">✕</button></div>` +
      alertHtml +
      `<div class="thoughts">${rows || '<p class="insp-skills">no towns yet</p>'}</div>`
    );
  }

  /** Phase A/B: Economy panel — global finances, faction mood with action
   *  buttons, per-settlement tax controls. Toggle with the E key. */
  private drawEconomyPanel(): void {
    const r = this.region;
    if (!this.economyOpen) {
      this.economyPanel.classList.add('hidden');
      return;
    }
    this.economyPanel.classList.remove('hidden');
    if (this.frame - this.lastEconomyBuildFrame < 60) return;
    this.lastEconomyBuildFrame = this.frame;
    this.economyPanel.innerHTML = this.economyPanelHtml();
    const refresh = () => { this.lastEconomyBuildFrame = -999; };
    this.wireTabs(this.economyPanel, (t) => { this.economyTab = t as 'overview' | 'settlements'; });
    for (const b of this.economyPanel.querySelectorAll<HTMLButtonElement>('.ep-close')) {
      b.onclick = () => { this.economyOpen = false; };
    }
    for (const b of this.economyPanel.querySelectorAll<HTMLButtonElement>('.ep-tax-up')) {
      b.onclick = () => {
        const t = r.settlement(Number(b.dataset.sid));
        if (t) r.setCityPolicy(t.id, 'taxBand', Math.min(3, t.policies.taxBand + 1));
        refresh();
      };
    }
    for (const b of this.economyPanel.querySelectorAll<HTMLButtonElement>('.ep-tax-dn')) {
      b.onclick = () => {
        const t = r.settlement(Number(b.dataset.sid));
        if (t) r.setCityPolicy(t.id, 'taxBand', Math.max(0, t.policies.taxBand - 1));
        refresh();
      };
    }
    const svcUp = this.economyPanel.querySelector<HTMLButtonElement>('#ep-svc-up');
    if (svcUp) svcUp.onclick = () => { r.servicesLevel = Math.min(2, r.servicesLevel + 1); refresh(); };
    const taxDown = this.economyPanel.querySelector<HTMLButtonElement>('#ep-tax-gdown');
    if (taxDown) taxDown.onclick = () => { r.taxRate = Math.max(0, r.taxRate - 0.02); refresh(); };
  }

  private economyPanelHtml(): string {
    const r = this.region;
    const towns = r.settlements
      .filter((t) => t.factionId === r.playerFactionId)
      .sort((a, b) => r.popOf(b) - r.popOf(a));
    // Faction demands — consolidate into unique actions
    let wantSvc = false, wantTax = false;
    const factionHtml = r.factions.length > 0
      ? r.factions.map((f) => {
          const col = f.support >= 60 ? '#4e9' : f.support >= 40 ? '#ca4' : '#e55';
          if (f.support < 40) {
            if (f.id === 'workers') { wantSvc = true; wantTax = true; }
            if (f.id === 'landowners') wantTax = true;
          }
          return (
            `<div class="bar-row" title="${f.name}: ${f.demand}">` +
            `<span style="width:76px;display:inline-block">${f.name}</span>` +
            `<div class="bar" style="flex:1"><div class="bar-fill" style="width:${Math.round(f.support)}%;background:${col}"></div></div>` +
            `<span class="insp-skills" style="min-width:32px;text-align:right">${Math.round(f.support)}%</span>` +
            (f.support < 40 ? `<span class="insp-cond"> ⚠</span>` : '') +
            `</div>` +
            (f.support < 40 ? `<p class="insp-skills" style="margin:1px 0 4px 76px">↳ ${f.demand}</p>` : '')
          );
        }).join('')
      : '';
    const actionsHtml = (wantSvc || wantTax)
      ? `<p class="insp-skills">SUGGESTED ACTIONS</p>` +
        (wantSvc ? `<p><button class="mini" id="ep-svc-up" ${r.servicesLevel >= 2 ? 'disabled' : ''} title="Raise national services level">raise services</button></p>` : '') +
        (wantTax ? `<p><button class="mini" id="ep-tax-gdown" title="Lower global tax rate by 2%">lower tax −2%</button></p>` : '')
      : '';
    const settRows = towns.map((t) => {
      const totalOutput = SECTOR_IDS.reduce((s, id) => s + t.sectors[id].output, 0);
      const taxRate = TAX_BAND_RATES[Math.min(3, Math.max(0, t.policies.taxBand))];
      const rev = totalOutput * taxRate;
      const hungry = t.food < r.popOf(t) * 5;
      return (
        `<div style="margin:3px 0">` +
        `<b>${t.name}</b> <span class="insp-skills">pop ${Math.round(r.popOf(t))}</span>` +
        (hungry ? ` <span class="insp-cond">⚠ hungry</span>` : '') +
        `<br><span class="insp-skills">GDP ` + formatCurrency(totalOutput, 1) + `/mo · tax ` + formatCurrency(rev, 1) + `/mo</span>` +
        ` <button class="mini ep-tax-up" data-sid="${t.id}" ${t.policies.taxBand >= 3 ? 'disabled' : ''} title="Raise local tax band">+tax</button>` +
        ` <button class="mini ep-tax-dn" data-sid="${t.id}" ${t.policies.taxBand <= 0 ? 'disabled' : ''} title="Lower local tax band">−tax</button>` +
        `</div>`
      );
    }).join('');
    const etab = this.economyTab;
    const gdpHist = r.monthlyHistory.map((h) => h.gdp);
    const treasuryHist = r.monthlyHistory.map((h) => h.treasury);
    const inflationHist = r.monthlyHistory.map((h) => h.inflation);
    const overviewBody =
      `<p>treasury ` + formatCurrency(Math.floor(r.treasury)) + ` · GDP ` + formatCurrency(Math.floor(r.gdpLastMonth)) + `/mo</p>` +
      `<p>global tax ${Math.round(r.taxRate * 100)}% · trade ` + formatCurrency(Math.floor(r.tradeValueLastMonth)) + `/mo</p>` +
      sparklineGrid(r.gdpLastMonth, r.treasury, r.inflationRate * 100, gdpHist, treasuryHist, inflationHist) +
      (factionHtml ? `<p class="insp-skills">FACTION MOOD</p>${factionHtml}` : '') +
      actionsHtml;
    return (
      `<div class="pal-title">ECONOMY [E] <button class="mini ep-close" title="close (E)">✕</button></div>` +
      `<div class="pal-tabs">` +
      `<button class="pal-tab${etab === 'overview' ? ' active' : ''}" data-ptab="overview">Overview</button>` +
      `<button class="pal-tab${etab === 'settlements' ? ' active' : ''}" data-ptab="settlements">Settlements</button>` +
      `</div>` +
      `<div class="pal-section${etab === 'overview' ? '' : ' hidden'}" data-psection="overview">${overviewBody}</div>` +
      `<div class="pal-section${etab === 'settlements' ? '' : ' hidden'}" data-psection="settlements">` +
        `<div class="thoughts">${settRows || '<p class="insp-skills">no towns yet</p>'}</div></div>`
    );
  }

  /** Research panel: tech + civics tree progress, node browser, start/cancel. */
  private drawResearchPanel(): void {
    const r = this.region;
    if (!this.researchOpen) {
      this.researchPanel.classList.add('hidden');
      return;
    }
    this.researchPanel.classList.remove('hidden');
    // DOM-stability guard (see drawStatePanel): rebuild on a ~1s timer, not every
    // frame, or the "research"/"cancel" buttons are replaced mid-click and never fire.
    if (this.frame - this.lastResearchBuildFrame < 60) return;
    this.lastResearchBuildFrame = this.frame;
    const forceResearchRebuild = () => { this.lastResearchBuildFrame = -999; };
    const rate = r.researchRate().toFixed(1);
    const active = r.activeResearch ? TECH_TREE.find((n) => n.id === r.activeResearch) : null;
    const progressPct = active ? Math.min(100, Math.round((r.researchProgress / r.techCost(active)) * 100)) : 0;

    const nodeRow = (id: string): string => {
      const node = TECH_TREE.find((n) => n.id === id)!;
      const done = r.has(id);
      const available = !done && r.availableToResearch().find((n) => n.id === id);
      const isActive = r.activeResearch === id;
      const label = node.tree === 'tech' ? 'T' : 'C';
      let cls = done ? 'res-done' : available ? 'res-avail' : 'res-locked';
      if (isActive) cls = 'res-active';
      let btn = '';
      if (available && !isActive) {
        btn = `<button class="mini res-start-btn" data-id="${id}">research</button>`;
      } else if (isActive) {
        btn = `<button class="mini res-cancel-btn">cancel</button>`;
      }
      const pctStr = isActive ? ` ${progressPct}%` : '';
      return `<div class="res-row ${cls}" title="${node.desc}">[${label}] ${node.name} (${r.techCost(node) || '✓'} RP)${pctStr}${btn}</div>`;
    };

    const techNodes = TECH_TREE.filter((n) => n.tree === 'tech').map((n) => nodeRow(n.id)).join('');
    const civicNodes = TECH_TREE.filter((n) => n.tree === 'civics').map((n) => nodeRow(n.id)).join('');
    const rtab = this.researchTab;

    this.researchPanel.innerHTML =
      `<div class="pal-title">RESEARCH</div>` +
      `<p class="insp-skills">${rate} RP/day${active ? ` → <b>${active.name}</b>` : ' (idle)'}</p>` +
      (active ? `<div class="res-bar"><div class="res-bar-fill" style="width:${progressPct}%"></div></div>` : '') +
      `<div class="pal-tabs">` +
      `<button class="pal-tab${rtab === 'tech' ? ' active' : ''}" data-ptab="tech">Technology</button>` +
      `<button class="pal-tab${rtab === 'civics' ? ' active' : ''}" data-ptab="civics">Civics</button>` +
      `</div>` +
      `<div class="pal-section${rtab === 'tech' ? '' : ' hidden'}" data-psection="tech">${techNodes}</div>` +
      `<div class="pal-section${rtab === 'civics' ? '' : ' hidden'}" data-psection="civics">${civicNodes}</div>`;

    this.wireTabs(this.researchPanel, (t) => { this.researchTab = t as 'tech' | 'civics'; });
    for (const btn of this.researchPanel.querySelectorAll<HTMLButtonElement>('.res-start-btn')) {
      btn.onclick = () => { r.startResearch(btn.dataset.id!); forceResearchRebuild(); };
    }
    const cancelBtn = this.researchPanel.querySelector<HTMLButtonElement>('.res-cancel-btn');
    if (cancelBtn) cancelBtn.onclick = () => { r.cancelResearch(); forceResearchRebuild(); };
  }

  private panelHtml(t: Settlement): string {
    const r = this.region;
    const pop = Math.round(r.popOf(t));
    const bands = t.cohorts.bands
      .map((v, i) => `<div class="bar-row"><span>${AGE_BANDS[i]}</span><div class="bar"><div class="bar-fill" style="width:${Math.min(100, (v / Math.max(1, r.popOf(t))) * 100 * 2.5)}%"></div></div><span>${Math.round(v)}</span></div>`)
      .join('');
    const notables = r.notablesAt(t.id)
      .map((n) => `<li><b>${n.name}</b>, ${Math.floor(n.age)} — <abbr title="${ROLE_BONUS_DESC[n.role]}">${n.role}</abbr><br><span class="insp-skills">${n.bio[n.bio.length - 1]}</span></li>`)
      .join('');
    const can = r.canFoundTown(t.id);
    const tier = pop < 30 ? 'Shack' : pop < 80 ? 'Cottage' : pop < 200 ? 'House' : pop < 500 ? 'Town' : pop < 1000 ? 'Manor' : 'Castle';
    const recentHtml = t.recentEvents.length
      ? `<p class="insp-skills">RECENT EVENTS</p><ul class="thoughts">${
          t.recentEvents.slice(0, 6).map((ev) =>
            `<li class="log-${ev.kind}">d${ev.day} · ${ev.text}</li>`
          ).join('')
        }</ul>`
      : '';
    const ptab = this.panelTab;
    // Identity header stays visible; the dense sub-panels split into tabs so no
    // single view needs scrolling.
    const header =
      `<h3>${t.name} <button id="rename-btn" class="mini" title="Rename this town">✎</button></h3>` +
      `<p class="insp-lvl">${tier} · day ${r.day - t.foundedDay} old</p>` +
      `<p class="insp-state">pop ${Math.round(r.popOf(t))} · housing ${Math.floor(t.housing)} · satisfaction ${Math.round(t.satisfaction)}</p>` +
      (r.stateProclaimed
        ? `<p class="${t.grievance > 50 ? 'insp-cond' : 'insp-skills'}">grievance ${Math.round(t.grievance)}${this.region.day < t.strikeUntil ? ' · ON STRIKE' : ''}</p>`
        : '') +
      `<p>food ${Math.floor(t.food)} · wood ${Math.floor(t.wood)} · land ${t.landQuality.toFixed(2)}</p>` +
      `<p class="insp-skills">market: grain ` + formatCurrency(t.prices.food, 2) + ` · timber ` + formatCurrency(t.prices.wood, 2) + ` /unit</p>`;

    const overviewBody =
      `<p class="insp-skills">${[
        t.site.river ? 'river (fishery, flood risk)' : '',
        t.site.coastal ? (t.seaWall ? 'coastal (sea wall raised)' : 'coastal (fishery)') : '',
        t.site.forest > 0.5 ? 'forested (good timber)' : '',
        t.site.roughness > 0.5 ? 'rough country' : '',
        t.site.fertility > 1.05 ? 'rich soil' : t.site.fertility < 0.7 ? 'poor soil' : '',
      ].filter(Boolean).join(' · ') || 'open plains'}</p>` +
      (t.site.coastal && !t.seaWall && r.stateProclaimed && r.year >= SEA_WALL_YEAR
        ? `<p><button class="mini" id="seawall-btn" ${r.treasury >= r.seaWallCost(t) ? '' : 'disabled'} ` +
          `title="Granite and pumps against the rising sea (GDD §8.2) — tidal flooding never touches a walled town">` +
          `sea wall ` + formatCurrency(r.seaWallCost(t)) + `</button></p>`
        : '') +
      this.garrisonHtml(t) +
      this.crisisActionsHtml(t) +
      recentHtml;

    const economyBody =
      this.sectorsHtml(t) +
      this.policiesHtml(t) +
      this.cityHtml(t) +
      this.routesHtml(t);

    const peopleBody =
      `<p class="insp-skills">COHORTS</p>` + bands +
      (notables ? `<p class="insp-skills">NOTABLES</p><ul class="thoughts">${notables}</ul>` : '') +
      `<button id="found-btn" ${can.ok ? '' : 'disabled'} title="${can.reason}">Found new town (8 pop, 80 food, 80 wood)</button>` +
      (can.ok ? '' : `<p class="insp-skills">${can.reason}</p>`);

    return (
      header +
      `<div class="pal-tabs">` +
      `<button class="pal-tab${ptab === 'overview' ? ' active' : ''}" data-ptab="overview">Overview</button>` +
      `<button class="pal-tab${ptab === 'economy' ? ' active' : ''}" data-ptab="economy">Economy</button>` +
      `<button class="pal-tab${ptab === 'people' ? ' active' : ''}" data-ptab="people">People</button>` +
      `</div>` +
      `<div class="pal-section${ptab === 'overview' ? '' : ' hidden'}" data-psection="overview">${overviewBody}</div>` +
      `<div class="pal-section${ptab === 'economy' ? '' : ' hidden'}" data-psection="economy">${economyBody}</div>` +
      `<div class="pal-section${ptab === 'people' ? '' : ' hidden'}" data-psection="people">${peopleBody}</div>`
    );
  }

  /** Contextual action buttons surfaced when a settlement is in trouble — so
   *  the player always has a direct response available. */
  private crisisActionsHtml(t: Settlement): string {
    const r = this.region;
    if (t.factionId !== r.playerFactionId || !r.stateProclaimed) return '';
    const actions: string[] = [];
    const hungry = t.food < r.popOf(t) * 5;
    const onStrike = r.day < t.strikeUntil;
    const highGrievance = t.grievance > 60;
    if (!hungry && !onStrike && !highGrievance) return '';
    if (hungry) {
      const aidOk = r.treasury >= 10;
      actions.push(
        `<button class="mini crisis-aid-btn" ${aidOk ? '' : 'disabled'} ` +
        `title="${aidOk ? 'Send emergency grain (£10) — buys ~one month of food' : 'Treasury too low for aid'}">` +
        `🌾 send grain (£10)</button>`,
      );
    }
    if (onStrike || highGrievance) {
      const svcOk = r.servicesLevel < 2;
      actions.push(
        `<button class="mini crisis-svc-btn" ${svcOk ? '' : 'disabled'} ` +
        `title="Raise national services level — reduces grievance in all towns">raise services</button>`,
      );
      if (r.taxRate > 0) {
        actions.push(
          `<button class="mini crisis-tax-btn" title="Lower global tax rate by 2% — eases strike pressure">lower tax</button>`,
        );
      }
    }
    return actions.length
      ? `<p class="insp-skills">CRISIS ACTIONS</p><p>${actions.join(' ')}</p>`
      : '';
  }

  private showLoanDialog(lenderId: number): void {
    const r = this.region;
    const lender = r.lenders.find((l) => l.id === lenderId);
    if (!lender) return;

    const maxBorrow = Math.min(lender.maxLoan, lender.liquidCash);
    const amountStr = prompt(
      `${lender.name}\nMax loan: ` + formatCurrency(maxBorrow) + `\nInterest rate: ${(lender.interestRate * 100).toFixed(1)}% annual\n\nBorrow amount (${getCurrencySymbol()}):`,
      String(Math.min(1000, maxBorrow / 2)),
    );
    if (!amountStr) return;

    const amount = Number(amountStr);
    if (isNaN(amount) || amount <= 0) {
      alert('Invalid amount');
      return;
    }
    if (amount > maxBorrow) {
      alert(`Cannot borrow more than ` + formatCurrency(maxBorrow) + ``);
      return;
    }

    const termStr = prompt(`Loan term (months, 1-120):`, '12');
    if (!termStr) return;

    const term = Number(termStr);
    if (isNaN(term) || term < 1 || term > 120) {
      alert('Invalid term (must be 1-120 months)');
      return;
    }

    const result = r.requestLoan(lenderId, amount, term);
    if (result.ok) {
      this.refreshPanel();
    } else {
      alert(`Loan rejected: ${result.reason}`);
    }
  }

  private showRepayDialog(loanId: number): void {
    const r = this.region;
    const loan = r.loans.find((l) => l.id === loanId);
    if (!loan) return;

    const owing = Math.round(loan.borrowed);
    const minPayment = Math.max(1, Math.round(owing * 0.1)); // 10% minimum
    const suggested = Math.min(r.treasury, owing);

    const amountStr = prompt(
      `Repay loan\nOwing: ` + formatCurrency(owing) + `\nMax can pay: ` + formatCurrency(suggested) + `\nMin payment: ` + formatCurrency(minPayment) + `\n\nRepay amount (${getCurrencySymbol()}):`,
      String(minPayment),
    );
    if (!amountStr) return;

    const amount = Number(amountStr);
    if (isNaN(amount) || amount <= 0) {
      alert('Invalid amount');
      return;
    }
    if (amount > r.treasury) {
      alert('Insufficient treasury funds');
      return;
    }
    if (amount < minPayment) {
      alert(`Minimum payment is ` + formatCurrency(minPayment) + ``);
      return;
    }

    const result = r.repayLoan(loanId, amount);
    if (result.ok) {
      this.refreshPanel();
    } else {
      alert(`Repayment failed: ${result.reason}`);
    }
  }
}
