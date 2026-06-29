/**
 * Region view (Tier 1.5 → 2): the zoomed-out map that becomes the default
 * operating altitude after the flip (GDD §2.5). Painterly backdrop, town
 * markers, routes, expedition wagons; DOM panel for the selected settlement.
 */
import type { Settlement, Scout, GovLean, GovType, MinisterRoleId, TreatyKind, CasusBelli, Mobilization, PeaceTerm, DealBasket, OccupationPolicy, MonetaryRegime, DepressionMeasure, TownFocus, WagePolicy, Route, SectorId, ArmyUnitType, TechNode, Province, DynastyNode } from '../sim/region';
import { RegionSim, AGE_BANDS, ROLE_BONUS_DESC, GOV_LEANS, GOV_TYPES, MINISTER_ROLES, RAIL_ERA_YEAR, SEA_WALL_YEAR, TECH_TREE, REGION_LAWS, POLICY_CARDS, POLICY_SWAP_COST, TREATY_DEFS, RIVAL_ARCHETYPES, ENVOY_COST, GIFT_COST, ENVOY_COOLDOWN_DAYS, GIFT_COOLDOWN_DAYS, CASUS_BELLI_DEFS, MOBILIZATION_DEFS, PEACE_TERMS, WAR_SUPPORT_FLOOR, OCCUPATION_DEFS, MAX_OCCUPIED_MARCHES, BLOCKADE_UPKEEP_PER_POP, ACCORD_DEFECT_THRESHOLD, GEOENGINEER_COOLING, MIN_POLICY_RATE, MAX_POLICY_RATE, REGION_BUILDINGS, INTERMEDIATE_GOODS, SECTOR_IDS, SECTOR_NAMES, FOCUS_CHANGE_COST, REGION_EVENT_DEFS, TAX_BAND_LABELS, TAX_BAND_RATES, DEFAULT_CITY_POLICIES, ROUTE_SPECS, RIVAL_REGIMES, BRANCH_YEAR, UNIT_TYPES, ESPIONAGE_OPS, BLOC_RELATIONS_FLOOR, DEPRESSION_MEASURES, SUPPLY_SHOCK_INFLATION, SUPPLY_SHOCK_EXPORT_DRAG, AGRI_CLIMATE_THRESHOLD } from '../sim/region';
import type { EspionageOp } from '../sim/region';
import { formatCurrency, getCurrencySymbol, CURRENCY_SYMBOLS } from '../sim/defs';
import type { CurrencySymbol } from '../sim/defs';
import { ANNOUNCE_LEAD_DAYS } from '../sim/currency';
import { REGION_N } from '../sim/worldgen';
import { hexNeighbors, hexNeighborDir, hexCenter, hexCorners, hexLayoutParams, screenToHex } from '../sim/hex';
import { DesignScreen } from './designscreen';
import { Minimap } from './minimap';
import { sparklineGrid } from './sparklines';
import { AssetRegistry, townSpriteTier, TOWN_TIER_PX } from './assets/registry';
import { buildPawnSprites } from './sprites';
import { Backdrop, buildBackdropPalette, type Sky, type Branch } from './backdrop';

/** Fill a hex polygon from precomputed corners (no stroke). */
function fillHexPath(g: CanvasRenderingContext2D, corners: { x: number; y: number }[]): void {
  g.beginPath();
  g.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < 6; i++) g.lineTo(corners[i].x, corners[i].y);
  g.closePath();
  g.fill();
}

function strokeHexPath(g: CanvasRenderingContext2D, corners: { x: number; y: number }[]): void {
  g.beginPath();
  g.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < 6; i++) g.lineTo(corners[i].x, corners[i].y);
  g.closePath();
  g.stroke();
}

/** Parse a #rrggbb (or #rgb) hex string to {r,g,b}; falls back to grey. */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  if (!Number.isFinite(n) || h.length !== 6) return { r: 136, g: 136, b: 136 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Build an HTML dynasty section for the Century Report.
 *  Renders parent → children relationships among Notables. */
function dynastyHtml(r: RegionSim): string {
  const tree: DynastyNode[] = r.buildDynastyTree();
  if (tree.length === 0) return '';

  // Group by parent: roots are nodes without a parentId in the tree set
  const ids = new Set(tree.map((n) => n.id));
  const roots = tree.filter((n) => n.parentId === undefined || !ids.has(n.parentId));
  const childrenOf = (parentId: number) => tree.filter((n) => n.parentId === parentId);

  const renderNode = (n: DynastyNode, depth: number): string => {
    const indent = '&nbsp;'.repeat(depth * 4);
    const lifespan = n.deathYear
      ? `${n.birthYear}–${n.deathYear}`
      : `b. ${n.birthYear}`;
    const roleTag = n.role ? ` <span class="insp-skills">[${n.role}]</span>` : '';
    const line = `<p>${indent}<b>${n.name}</b> ${lifespan}${roleTag}</p>`;
    return line + childrenOf(n.id).map((c) => renderNode(c, depth + 1)).join('');
  };

  return `<p class="insp-skills">DYNASTIES</p>` +
    roots.map((root) => renderNode(root, 0)).join('');
}

export class RegionView {
  selectedId: number | null = null;
  /** Currently highlighted rival faction (null = none). */
  selectedFactionId: number | null = null;
  /** set true by the view while the Incorporation ceremony is on screen */
  ceremonyOpen = false;
  conventionOpen = false;
  /** True when player is in "claim land" mode — clicking map cells triggers claimCell(). */
  claimLandMode = false;
  /** "Found town" placement mode: the source town whose expedition we're siting,
   *  plus the precomputed set of valid target cells (key = col*REGION_N + row) so
   *  the per-frame highlight doesn't re-validate 16k hexes. */
  private foundingFromId: number | null = null;
  private foundingValidCells: Set<number> | null = null;
  /** "Place building" mode (spatial-4X Phase B): the town + building def awaiting a
   *  hex, plus the precomputed legal cells for the highlight overlay. */
  private buildingPlacement: { townId: number; defId: string } | null = null;
  private buildingValidCells: Set<number> | null = null;
  /** Province overlay toggle (P key or State panel button). Shows province labels + stats on map. */
  provinceViewActive = false;
  /** Currently selected province id (= settlement id), null if none. */
  private selectedProvinceId: number | null = null;
  private provincePanel: HTMLElement;
  private lastProvincePanelId: number | null = null;
  private lastProvincePanelBuildFrame = -999;
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
  /** Dedicated Central Bank window (B key); unlocked by the Central Banking civic
   *  or the Central Bank Charter law. */
  private centralBankPanel: HTMLElement;
  centralBankOpen = false;
  private lastCentralBankBuildFrame = -999;
  private economyTab: 'overview' | 'settlements' | 'supply' = 'overview';
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
  /** Post-2100 epilogue scroll: the accumulated legacy beats (GDD §8.5). */
  private epilogueModal: HTMLElement;
  /** Cinematic state machine: a frame-driven canvas sequence under the era/win
   *  modal. While active, the DOM reveal is held back so the animation reads. */
  private cinematic: { kind: 'era' | 'win'; variant: string; startFrame: number } | null = null;
  /** View-only latches so each cinematic plays at most once per session. */
  private playedEraCinematic = false;
  private playedWinCinematic = false;
  /** Unit recruitment modal (GDD §7.1: military depth). */
  private recruitmentModal: HTMLElement;
  private frame = 0;
  /** Pawn sprites (settler/armed/raider) for rendering armies on the map; built
   *  lazily on first army draw so a session with no armies pays nothing. */
  private pawns?: ReturnType<typeof buildPawnSprites>;
  private techLayoutCache = new Map<string, { pos: Map<string, { x: number; y: number }>; width: number; height: number }>();
  // ---- Static-map cache. Terrain + territory fills are O(N²) and barely change,
  //      so render them once into an offscreen canvas (base coords) and blit it
  //      under the camera each frame. Rebuilt only when the signature changes,
  //      which keeps the per-frame cost independent of REGION_N. ----
  private mapCache: HTMLCanvasElement | null = null;
  private mapCacheCtx: CanvasRenderingContext2D | null = null;
  private mapCacheSig = '';
  // Memory-fog cache: explored-but-not-visible tiles. Same idea as mapCache but
  // keyed on exploredCount + visibilityVersion so it rebuilds when scouts move.
  private memFogCanvas: HTMLCanvasElement | null = null;
  private memFogCtx: CanvasRenderingContext2D | null = null;
  private memFogSig = '';
  // Offscreen canvas of water pixels; rebuilt only on canvas resize (biomes are fixed).
  private waterMaskCanvas: HTMLCanvasElement | null = null;
  private waterMaskDims = '';
  // Cached vignette gradient — rebuilt only when canvas dimensions change.
  private vignetteGrad: CanvasGradient | null = null;
  private vignetteDims = '';
  // Cached hex layout params (size/ox/oy) — only depend on canvas dimensions.
  private cachedHexLayout: { size: number; ox: number; oy: number } | null = null;
  // Cached pixel-coord arrays for route paths — stable until canvas resize.
  private routePtsCache = new WeakMap<object, { px: number; py: number }[]>();
  // Last HTML written to each panel, so setInnerHtml can skip no-op reflows.
  private lastPanelHtml = new WeakMap<HTMLElement, string>();
  // Canvas dims from last frame — detects resize so caches above can be cleared.
  private prevCanvasW = 0;
  private prevCanvasH = 0;
  // DOM update throttles — avoid innerHTML reflows every rAF frame.
  private lastTopBarFrame = -999;
  private lastEventLogLen = -1;
  private lastEventLogFrame = -999;
  // Province list cache: computeProvinces() is O(settlements) but called in two hot paths.
  private _provincesCache: Province[] = [];
  private _provincesCacheFrame = -1;
  /** Visible region in base (pre-camera) coords — culls off-screen sprites. */
  private vb = { l: 0, t: 0, r: 0, b: 0 };
  private lastPanelBuildFrame = -999;
  private lastPanelBuildId: number | null = null;
  /** True while the inline town-rename field is open — pauses panel rebuilds so
   *  the once-per-second refresh doesn't destroy the input mid-edit. */
  private editingName = false;
  /** Currently selected player scout id (null = none). Click map to send to target. */
  private selectedScoutId: number | null = null;
  // ---- Map camera (zoom + pan). Default view starts zoomed on the founding
  //      settlement (Civ-style); zoom out to see the whole region. ----
  private camScale = 8;
  private camX = 0; // screen-px offset applied after scaling
  private camY = 0;
  // MIN_SCALE 2 lets the player pull back far enough to take in most of the
  // continent at once (whole-world overview still lives on the minimap);
  // MAX_SCALE 20 zooms in until a single hex fills a good chunk of the screen.
  private static readonly MIN_SCALE = 2;
  private static readonly MAX_SCALE = 20;
  // ---- Minimap (corner navigation aid) ----
  private minimap: Minimap;
  // ---- Tooltips (settlement hover info) ----
  private tooltip: HTMLElement;
  private tooltipSettlementId: number | null = null;

  /** Manifest-driven art overrides for the 4X map; procedural fallback when absent. */
  private readonly assets = new AssetRegistry();

  /** Parallax atmosphere behind the map; era/season/weather/tension-tinted. */
  private readonly backdrop = new Backdrop();

  constructor(private canvas: HTMLCanvasElement, private region: RegionSim, root: HTMLElement) {
    this.g = canvas.getContext('2d')!;
    void this.assets.load();
    // If the era was already decided in a prior session (loaded save), treat the
    // reveal as already dismissed — only fire for a fork that happens live here.
    this.eraDismissed = region.eraBranch !== null;
    // Same for the cinematics: a save loaded mid/late-game skips the animation
    // for moments that already happened, so they only play on a live transition.
    this.playedEraCinematic = region.eraBranch !== null;
    this.playedWinCinematic = region.winCondition !== null;
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
    this.centralBankPanel = document.createElement('div');
    this.centralBankPanel.className = 'palette central-bank-panel hidden';
    root.appendChild(this.centralBankPanel);
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
    this.epilogueModal = document.createElement('div');
    this.epilogueModal.className = 'ceremony hidden';
    root.appendChild(this.epilogueModal);
    this.recruitmentModal = document.createElement('div');
    this.recruitmentModal.className = 'ceremony hidden';
    root.appendChild(this.recruitmentModal);
    this.rivalPanel = document.createElement('div');
    this.rivalPanel.className = 'inspector region-panel hidden';
    root.appendChild(this.rivalPanel);
    this.provincePanel = document.createElement('div');
    this.provincePanel.className = 'inspector region-panel hidden';
    root.appendChild(this.provincePanel);
    this.minimap = new Minimap(region, root, { size: 140, position: 'bottom-right' });
    // Create tooltip element
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'cv-tooltip hidden';
    root.appendChild(this.tooltip);
    // Create top bar for metrics
    const topBar = document.createElement('div');
    topBar.id = 'top-bar';
    topBar.className = 'topbar';
    root.appendChild(topBar);
    this.topBar = topBar;
    // Create event log for last 3 events
    const eventLog = document.createElement('div');
    eventLog.className = 'eventlog';
    root.appendChild(eventLog);
    this.eventLog = eventLog;
    // Start zoomed in on the founding settlement (Civ-style entry view).
    if (region.settlements.length > 0) {
      const home = region.settlements[0];
      this.camScale = 8;
      const { size, ox, oy } = hexLayoutParams(canvas.width, canvas.height, REGION_N, 60);
      const col = Math.max(0, Math.min(REGION_N - 1, Math.floor((home.x / 100) * REGION_N)));
      const row = Math.max(0, Math.min(REGION_N - 1, Math.floor((home.y / 100) * REGION_N)));
      const { x: bx, y: by } = hexCenter(col, row, size, ox, oy);
      this.camX = canvas.width / 2 - bx * this.camScale;
      this.camY = canvas.height / 2 - by * this.camScale;
      this.clampCamera();
    }
  }

  /** Top bar displaying game metrics. */
  private topBar: HTMLElement;
  /** Event log showing last 3 events. */
  private eventLog: HTMLElement;

  /** Draggable panels for the WindowManager (region mode). */
  get draggablePanels(): { id: string; element: HTMLElement; baseZ: number }[] {
    return [
      { id: 'region-selection', element: this.panel, baseZ: 20 },
      { id: 'region-state', element: this.statePanel, baseZ: 12 },
      { id: 'region-research', element: this.researchPanel, baseZ: 12 },
      { id: 'region-routes', element: this.routeNetworkPanel, baseZ: 12 },
      { id: 'region-settlements', element: this.settlementListPanel, baseZ: 12 },
      { id: 'region-economy', element: this.economyPanel, baseZ: 12 },
      { id: 'region-central-bank', element: this.centralBankPanel, baseZ: 12 },
      { id: 'region-rival', element: this.rivalPanel, baseZ: 20 },
      { id: 'region-province', element: this.provincePanel, baseZ: 20 },
    ];
  }

  destroyPanel(): void {
    this.panel.remove();
    this.statePanel.remove();
    this.researchPanel.remove();
    this.routeNetworkPanel.remove();
    this.settlementListPanel.remove();
    this.economyPanel.remove();
    this.centralBankPanel.remove();
    this.ceremony.remove();
    this.convention.remove();
    this.policyModal.remove();
    this.dealModal.remove();
    this.centuryModal.remove();
    this.winModal.remove();
    this.eraModal.remove();
    this.epilogueModal.remove();
    this.rivalPanel.remove();
    this.provincePanel.remove();
  }

  private toPx(rx: number, ry: number): { px: number; py: number } {
    if (!this.cachedHexLayout) {
      this.cachedHexLayout = hexLayoutParams(this.canvas.width, this.canvas.height, REGION_N, 60);
    }
    const { size, ox, oy } = this.cachedHexLayout;
    const col = Math.max(0, Math.min(REGION_N - 1, Math.floor((rx / 100) * REGION_N)));
    const row = Math.max(0, Math.min(REGION_N - 1, Math.floor((ry / 100) * REGION_N)));
    const { x: px, y: py } = hexCenter(col, row, size, ox, oy);
    return { px, py };
  }

  /** Width of one hex in base/map units (constant across zoom). */
  private hexWidth(): number {
    const size = this.cachedHexLayout?.size
      ?? hexLayoutParams(this.canvas.width, this.canvas.height, REGION_N, 60).size;
    return Math.sqrt(3) * size;
  }

  /** Scale factor for per-settlement glyphs (sprites, labels, resource icons) so
   *  the smallest settlement footprint fills roughly one hex and larger tiers
   *  grow to span a few. The sprite art was authored ~16 base units wide for the
   *  shack tier (→ ~1 hex) up to ~36 for the castle (→ a couple of hexes), so a
   *  single factor keyed off hex width gives the "starts in one hex, grows into
   *  more" progression for free. Constant across zoom (hex and glyph share map
   *  space). */
  private glyphScale(): number {
    return this.hexWidth() / 16;
  }

  /** Run `body` with the canvas scaled around (px,py) by the glyph factor, so a
   *  block of fixed-base-unit drawing tracks hex size. */
  private withGlyphScale(px: number, py: number, body: () => void): void {
    const s = this.glyphScale();
    const g = this.g;
    g.save();
    g.translate(px, py);
    g.scale(s, s);
    g.translate(-px, -py);
    body();
    g.restore();
  }

  private getRoutePts(r: { path: { x: number; y: number }[] }): { px: number; py: number }[] {
    let pts = this.routePtsCache.get(r);
    if (!pts) {
      pts = r.path.map((cell) => {
        const c = this.region.map.cellToCoord(cell.x, cell.y);
        return this.toPx(c.rx, c.ry);
      });
      this.routePtsCache.set(r, pts);
    }
    return pts;
  }

  private setInnerHtml(el: HTMLElement, html: string, scrollSelectors: string[] = ['']): void {
    // Skip the rebuild entirely when the markup is byte-for-byte identical to
    // last time: innerHTML assignment forces a layout + paint even for equal
    // content, and panels rebuild on a timer far more often than they change.
    if (this.lastPanelHtml.get(el) === html) return;
    this.lastPanelHtml.set(el, html);
    const saved: { sel: string; top: number; left: number }[] = [];
    for (const sel of scrollSelectors) {
      const target = sel === '' ? el : el.querySelector<HTMLElement>(sel);
      if (target) saved.push({ sel, top: target.scrollTop, left: target.scrollLeft });
    }
    el.innerHTML = html;
    for (const { sel, top, left } of saved) {
      const target = sel === '' ? el : el.querySelector<HTMLElement>(sel);
      if (target) { target.scrollTop = top; target.scrollLeft = left; }
    }
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
    // A click skips a running cinematic and consumes the event.
    if (this.cinematic) { this.skipCinematic(); return; }
    this.selectedId = null;
    this.selectedFactionId = null;
    // Convert the screen click into map-space (undo the camera) so hit-testing
    // matches the transformed sprites. Pick radius tracks hex size so it stays
    // ~one hex around the settlement now that sprites are hex-scaled.
    const mx = (px - this.camX) / this.camScale;
    const my = (py - this.camY) / this.camScale;
    const radius = Math.max(14, this.hexWidth());

    // Province view: clicking a settlement selects its province and opens the panel.
    if (this.provinceViewActive) {
      let hit = false;
      for (const t of this.region.settlements) {
        const p = this.toPx(t.x, t.y);
        if (Math.hypot(p.px - mx, p.py - my) < radius) {
          this.selectedProvinceId = t.id;
          hit = true;
          break;
        }
      }
      if (!hit) this.selectedProvinceId = null;
      return;
    }

    // Scout click — check before settlements so the scout sprite intercepts first.
    const { region } = this;
    const playerScouts = region.scouts.filter((s) => s.factionId === region.playerFactionId);
    for (const scout of playerScouts) {
      const sp = this.toPx(scout.x, scout.y);
      if (Math.hypot(sp.px - mx, sp.py - my) < 12) {
        // Toggle selection
        this.selectedScoutId = scout.id === this.selectedScoutId ? null : scout.id;
        return;
      }
    }
    // Place building: in placement mode, a map click breaks ground on the chosen
    // worked-ring hex (validated by buildCity).
    if (this.buildingPlacement !== null) {
      const W = this.canvas.width;
      const H = this.canvas.height;
      const { size, ox, oy } = hexLayoutParams(W, H, REGION_N, 60);
      const { col, row } = screenToHex(mx, my, size, ox, oy);
      if (col >= 0 && col < REGION_N && row >= 0 && row < REGION_N) {
        this.region.buildCity(this.buildingPlacement.townId, this.buildingPlacement.defId, col * REGION_N + row);
      }
      this.cancelBuildingPlacement();
      this.refreshPanel();
      return;
    }
    // Click-to-found: in placement mode, a map click sites the new town's
    // expedition at the chosen hex (validated by foundTownAt).
    if (this.foundingFromId !== null) {
      const W = this.canvas.width;
      const H = this.canvas.height;
      const { size, ox, oy } = hexLayoutParams(W, H, REGION_N, 60);
      const { col, row } = screenToHex(mx, my, size, ox, oy);
      if (col >= 0 && col < REGION_N && row >= 0 && row < REGION_N) {
        this.region.foundTownAt(this.foundingFromId, (col / REGION_N) * 100, (row / REGION_N) * 100);
      }
      this.cancelFoundingMode();
      this.refreshPanel();
      return;
    }
    // If a scout is selected, clicking the map sends it to that hex.
    if (this.selectedScoutId !== null) {
      const W = this.canvas.width;
      const H = this.canvas.height;
      const { size, ox, oy } = hexLayoutParams(W, H, REGION_N, 60);
      const { col: hc, row: hr } = screenToHex(mx, my, size, ox, oy);
      if (hc >= 0 && hc < REGION_N && hr >= 0 && hr < REGION_N) {
        const rx = (hc / REGION_N) * 100;
        const ry = (hr / REGION_N) * 100;
        this.region.setScoutTarget(this.selectedScoutId, rx, ry);
      }
      this.selectedScoutId = null;
      return;
    }

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

    // If in claim land mode and no settlement was clicked, try to claim the hex
    if (this.claimLandMode) {
      const W = this.canvas.width;
      const H = this.canvas.height;
      const { size, ox, oy } = hexLayoutParams(W, H, REGION_N, 60);
      const { col, row } = screenToHex(mx, my, size, ox, oy);
      if (col >= 0 && col < REGION_N && row >= 0 && row < REGION_N) {
        this.region.claimCell(col, row);
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

  /** Toggle province view on/off (also clears the selected province). */
  toggleProvinceView(): void {
    this.provinceViewActive = !this.provinceViewActive;
    if (!this.provinceViewActive) this.selectedProvinceId = null;
    this.lastStatePanelBuildFrame = -999;
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
    const p = this.toPx(regionX, regionY);
    this.camX = W / 2 - p.px * this.camScale;
    this.camY = H / 2 - p.py * this.camScale;
    this.clampCamera();
  }

  /** Center the viewport on a logical coordinate; optionally set zoom level. */
  centerOn(regionX: number, regionY: number, zoom?: number): void {
    const W = this.canvas.width;
    const H = this.canvas.height;
    if (zoom !== undefined) {
      this.camScale = Math.max(RegionView.MIN_SCALE, Math.min(RegionView.MAX_SCALE, zoom));
    }
    const p = this.toPx(regionX, regionY);
    this.camX = W / 2 - p.px * this.camScale;
    this.camY = H / 2 - p.py * this.camScale;
    this.clampCamera();
  }

  /** Update tooltip position and visibility based on mouse position. */
  updateTooltip(screenX: number, screenY: number): void {
    const mx = (screenX - this.camX) / this.camScale;
    const my = (screenY - this.camY) / this.camScale;
    const radius = Math.max(14, this.hexWidth());
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

    // Detect canvas resize: clear position caches that depend on canvas dimensions.
    if (W !== this.prevCanvasW || H !== this.prevCanvasH) {
      this.prevCanvasW = W;
      this.prevCanvasH = H;
      this.cachedHexLayout = null;
      this.routePtsCache = new WeakMap();
    }

    g.imageSmoothingEnabled = false;
    g.fillStyle = '#10141c';
    g.fillRect(0, 0, W, H);
    // Parallax atmosphere fills the void the terrain cache leaves behind (map
    // margins + the whole frame when zoomed out). Screen-space, behind the map,
    // tinted by era/season/branch/weather/tension — a pure read of sim state.
    this.drawBackdrop(W, H);
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
    // Memory fog (explored-but-not-visible) from its own cache — O(1) per frame.
    this.ensureMemFogCache(W, H);
    if (this.memFogCanvas) g.drawImage(this.memFogCanvas, 0, 0);

    // Placed buildings dot the worked ring; placement highlights when arming a build.
    this.drawPlacedBuildings(W, H);
    this.drawFoundingOverlay(W, H);
    this.drawBuildingPlacementOverlay(W, H);

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
        const pts = this.getRoutePts(r);
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
      if (!this.inView(px, py, 80)) continue; // off-screen: skip sprite + labels + icons
      const pop = Math.round(region.popOf(t));
      const onRail = railSet.has(t.id);
      // The whole settlement glyph — sprite, depot, labels, raid marker — is
      // scaled around its hex centre so it reads as ~1 hex when small and grows
      // into a couple of hexes as the town does (see glyphScale()).
      this.withGlyphScale(px, py, () => {
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
      });
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
        if (!this.region.isVisibleToFaction(Math.round(s.x), Math.round(s.y), region.playerFactionId)) continue;
        const { px, py } = this.toPx(s.x, s.y);
        if (!this.inView(px, py, 40)) continue;
        const selected = this.selectedFactionId === faction.id;
        this.withGlyphScale(px, py, () => {
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
        });
      }
    }

    // Scouts: clickable character sprites — player scouts have name + auto-explore indicator
    for (const scout of region.scouts) {
      const faction = region.faction(scout.factionId);
      if (!faction) continue;
      if (faction.id !== region.playerFactionId && !this.region.isVisibleToFaction(Math.round(scout.x), Math.round(scout.y), region.playerFactionId)) continue;
      const { px, py } = this.toPx(scout.x, scout.y);
      if (!this.inView(px, py, 24)) continue;
      const bob = Math.floor(this.frame / 25) % 2;
      const isPlayer = faction.id === region.playerFactionId;
      const isSelected = isPlayer && scout.id === this.selectedScoutId;
      const color = faction.color ?? (isPlayer ? '#6af' : '#aaa');

      if (isSelected) {
        g.strokeStyle = 'rgba(255,255,255,0.9)';
        g.lineWidth = 1.5;
        g.setLineDash([3, 2]);
        g.beginPath(); g.arc(px, py - bob, 11, 0, Math.PI * 2); g.stroke();
        g.setLineDash([]);
      }
      // Body
      g.globalAlpha = isPlayer ? 0.95 : 0.65;
      g.fillStyle = color;
      g.beginPath(); g.arc(px, py + 2 - bob, 4, 0, Math.PI * 2); g.fill();
      // Head
      g.fillStyle = isPlayer ? '#f5deb3' : color;
      g.beginPath(); g.arc(px, py - 4 - bob, 3, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 1;

      if (isPlayer) {
        const scoutName = (scout as Scout & { name?: string }).name ?? 'Scout';
        g.fillStyle = '#e8f0ff';
        g.font = 'bold 9px monospace';
        g.textAlign = 'center';
        g.fillText(scoutName, px, py - 10 - bob);
        // Auto-explore indicator
        const isAuto = (scout as Scout & { autoExplore?: boolean }).autoExplore !== false;
        if (isAuto) {
          g.fillStyle = '#4af';
          g.font = '9px monospace';
          g.fillText('⟳', px + 9, py - 3 - bob);
        }
        // Target line if manual target set
        const mt = scout as Scout & { manualTargetX?: number; manualTargetY?: number };
        if (mt.manualTargetX !== undefined && mt.manualTargetY !== undefined) {
          const tp = this.toPx(mt.manualTargetX, mt.manualTargetY);
          g.strokeStyle = 'rgba(255,200,100,0.45)';
          g.lineWidth = 1;
          g.setLineDash([4, 3]);
          g.beginPath(); g.moveTo(px, py - bob); g.lineTo(tp.px, tp.py); g.stroke();
          g.setLineDash([]);
          g.fillStyle = 'rgba(255,200,100,0.8)';
          g.beginPath(); g.arc(tp.px, tp.py, 3, 0, Math.PI * 2); g.fill();
        }
      }
    }
    g.textAlign = 'left';

    // Expeditions: a wagon dot crawling to its site
    for (const e of region.expeditions) {
      // Non-player expeditions are hidden in memory fog (same guard as scouts)
      const fromS = region.settlement(e.fromId);
      if (fromS && fromS.factionId !== region.playerFactionId) {
        if (!this.region.isVisibleToFaction(Math.round(e.x), Math.round(e.y), region.playerFactionId)) continue;
      }
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

    // Province overlay: labels + stat bars + selection ring (Province View mode).
    if (this.provinceViewActive) this.drawProvinceOverlay();

    g.restore(); // end map-space; HUD below draws in screen space

    // Draw the minimap in the corner, showing camera frame.
    this.minimap.draw(this.camX, this.camY, this.camScale, W, H);

    // Seasonal wash + vignette (no night tint — day/night cycle disabled).
    this.drawAtmosphere(W, H, lit);

    // Scout info panel — shown in screen-space when a player scout is selected.
    if (this.selectedScoutId !== null) {
      const selScout = region.scouts.find((s) => s.id === this.selectedScoutId);
      if (selScout && selScout.factionId === region.playerFactionId) {
        this.drawScoutPanel(selScout as Scout & { name?: string; autoExplore?: boolean; manualTargetX?: number; manualTargetY?: number }, W, H);
      } else {
        this.selectedScoutId = null;
      }
    }

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
    this.updateTopBar();
    this.updateEventLog();
    this.drawPanel();
    this.drawRivalPanel();
    this.drawProvincePanel();
    this.drawStatePanel();
    this.drawResearchPanel();
    this.drawRouteNetworkPanel();
    this.drawSettlementListPanel();
    this.drawEconomyPanel();
    this.drawCentralBankPanel();
    this.drawCeremony();
    this.drawConvention();
    this.drawCenturyReport();
    this.drawEraModal();
    this.drawWinModal();
    this.drawEpilogueModal();
    // Cinematics paint last, fullscreen, above every panel and modal.
    this.updateCinematicTriggers();
    this.drawCinematic(W, H);
  }

  /** Detect the first frame an era fork or victory lands and queue its
   *  cinematic. Latches are view-only so each plays at most once per session. */
  private updateCinematicTriggers(): void {
    if (this.cinematic) return;
    const branch = this.region.eraBranch;
    if (branch && !this.playedEraCinematic) {
      this.playedEraCinematic = true;
      this.cinematic = { kind: 'era', variant: branch, startFrame: this.frame };
      return;
    }
    const wc = this.region.winCondition;
    if (wc && !this.playedWinCinematic) {
      this.playedWinCinematic = true;
      this.cinematic = { kind: 'win', variant: wc.path, startFrame: this.frame };
    }
  }

  /** True while a cinematic is playing — used to hold back the DOM reveal and
   *  to let a click skip the animation. */
  isCinematicPlaying(): boolean {
    return this.cinematic !== null;
  }

  /** Skip the running cinematic (click / key). */
  skipCinematic(): void {
    this.cinematic = null;
  }

  /** How many frames a cinematic runs before the DOM modal takes over (~4s). */
  private static readonly CINEMATIC_FRAMES = 240;

  /** Cheap fingerprint of everything the cached terrain+territory layer depends
   *  on. Terrain is fixed after worldgen; territory shifts only when a settlement
   *  is founded/taken/relocated — so hash size + each town's id/owner/position. */
  private mapCacheSignature(): string {
    const r = this.region;
    let s = `${this.canvas.width}x${this.canvas.height}|${r.regionalFactions.length}`;
    for (const t of r.settlements) s += `;${t.id},${t.factionId},${Math.round(t.x)},${Math.round(t.y)}`;
    // Fog-of-war frontier: use the pre-tracked counter instead of scanning 10 000 tiles.
    s += `|fog${r.exploredCount}`;
    // Ghost waterline: rebuild cache when sea-rise warning fires (adds blue coastal overlay).
    s += `|rise${r.seaRiseAnnounced ? 1 : 0}`;
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

  /** Cache the memory-fog (explored-but-not-visible) layer into an offscreen canvas.
   *  Rebuilt only when exploredCount or visibilityVersion changes. */
  private ensureMemFogCache(W: number, H: number): void {
    const r = this.region;
    const sig = `${W}x${H}|exp${r.exploredCount}|vis${r.visibilityVersion}`;
    if (this.memFogCanvas && this.memFogSig === sig &&
        this.memFogCanvas.width === W && this.memFogCanvas.height === H) return;
    if (!this.memFogCanvas) this.memFogCanvas = document.createElement('canvas');
    if (this.memFogCanvas.width !== W || this.memFogCanvas.height !== H) {
      this.memFogCanvas.width = W;
      this.memFogCanvas.height = H;
      this.memFogCtx = this.memFogCanvas.getContext('2d');
    }
    const mg = this.memFogCtx!;
    mg.clearRect(0, 0, W, H);
    this.drawMemoryFog(mg, W, H);
    this.memFogSig = sig;
  }

  /** Composite + blit the parallax atmosphere behind the map. Palette is rebuilt
   *  each frame (cheap, pure) but the gradient canvas only re-paints when the
   *  era/season/branch/weather/tension key changes. */
  private drawBackdrop(W: number, H: number): void {
    const r = this.region;
    const pal = buildBackdropPalette({
      year: r.year,
      seasonIndex: r.seasonIndex,
      branch: r.eraBranch as Branch,
      sky: r.weather.forDay(r.day).sky as Sky,
      tension: r.tensionScalar(),
    });
    this.backdrop.draw(this.g, W, H, pal, this.camX, this.camY, this.assets);
  }

  /** Lighting state for atmospheric rendering. Day/night cycle disabled — always daytime. */
  private atmosphere(): { night: number; golden: number; season: number } {
    return { night: 0, golden: 0, season: this.region.seasonIndex };
  }

  /** Return cached province list; recomputed at most once per frame. */
  private getCachedProvinces(): Province[] {
    if (this._provincesCacheFrame !== this.frame) {
      this._provincesCache = this.region.computeProvinces();
      this._provincesCacheFrame = this.frame;
    }
    return this._provincesCache;
  }

  /** Province overlay: rendered on top of city lights (still in map-space).
   *  Draws province name labels, compact stat bars, and a selection ring. */
  private drawProvinceOverlay(): void {
    const { g, region } = this;
    const provinces = this.getCachedProvinces();
    for (const prov of provinces) {
      const faction = region.faction(prov.factionId);
      const color = faction?.color ?? '#aaa';
      const { r: cr, g: cg, b: cb } = hexToRgb(color);
      const { px, py } = this.toPx(prov.centroidX, prov.centroidY);

      // Skip if off-screen
      if (!this.inView(px, py, 80)) continue;

      // Selection ring
      if (this.selectedProvinceId === prov.id) {
        g.strokeStyle = `rgba(${cr},${cg},${cb},0.9)`;
        g.lineWidth = 2.5;
        g.setLineDash([6, 3]);
        g.beginPath();
        g.arc(px, py, 30, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
      }

      // Province name label (shifted above the settlement sprite)
      const labelY = py - 46;
      g.font = 'bold 11px monospace';
      g.textAlign = 'center';
      // Dark shadow for contrast over terrain
      g.fillStyle = 'rgba(0,0,0,0.75)';
      g.fillText(prov.name, px + 1, labelY + 1);
      g.fillStyle = `rgba(${cr},${cg},${cb},1)`;
      g.fillText(prov.name, px, labelY);

      // Compact stat bar: [pop] [gdp] [sat] under the name
      const statY = labelY + 12;
      const barW = 36;
      const barH = 4;
      const gap = 3;
      const startX = px - (barW * 3 + gap * 2) / 2;

      // Population bar (gold) — capped at 2000 for display
      const popFrac = Math.min(1, prov.totalPop / 2000);
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.fillRect(startX, statY, barW, barH);
      g.fillStyle = '#c2a14d';
      g.fillRect(startX, statY, Math.round(barW * popFrac), barH);

      // GDP bar (green) — capped at 500
      const gdpFrac = Math.min(1, prov.gdpContribution / 500);
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.fillRect(startX + barW + gap, statY, barW, barH);
      g.fillStyle = '#6ec26a';
      g.fillRect(startX + barW + gap, statY, Math.round(barW * gdpFrac), barH);

      // Satisfaction bar (blue) — 0..100
      const satFrac = Math.min(1, Math.max(0, prov.satisfaction / 100));
      const satColor = prov.satisfaction >= 70 ? '#7ab4d4' : prov.satisfaction >= 40 ? '#c2a14d' : '#c26a6a';
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.fillRect(startX + (barW + gap) * 2, statY, barW, barH);
      g.fillStyle = satColor;
      g.fillRect(startX + (barW + gap) * 2, statY, Math.round(barW * satFrac), barH);

      // Tiny legend labels below the bars
      g.font = '8px monospace';
      g.fillStyle = 'rgba(200,200,200,0.75)';
      g.fillText(`${prov.totalPop}`, startX + barW / 2, statY + barH + 8);
      g.fillText(`£${prov.gdpContribution}`, startX + barW + gap + barW / 2, statY + barH + 8);
      g.fillText(`${prov.satisfaction}%`, startX + (barW + gap) * 2 + barW / 2, statY + barH + 8);

      // Province policy indicator (player provinces with non-default tax)
      const polObj = region.provincePolicies[prov.id];
      if (polObj && prov.factionId === region.playerFactionId) {
        if (polObj.taxMultiplier !== 1.0) {
          g.font = '8px monospace';
          g.fillStyle = polObj.taxMultiplier > 1 ? '#c2a14d' : '#7ab4d4';
          g.textAlign = 'center';
          g.fillText(`tax×${polObj.taxMultiplier.toFixed(1)}`, px, statY + barH + 18);
        }
      }
    }
    g.textAlign = 'left';

    // Phase 7: draw provincial armies as shields on the map
    this.drawProvincialArmies();
  }

  /** Draw provincial army markers over province centroids. */
  private drawProvincialArmies(): void {
    const { g, region } = this;
    const armyGroups = new Map<number, { player: number; rival: number }>();
    for (const army of region.provincialArmies) {
      const key = army.provinceId;
      const slot = armyGroups.get(key) ?? { player: 0, rival: 0 };
      const count = army.units.reduce((s, u) => s + u.count, 0);
      if (army.ownerId === 0) slot.player += count;
      else slot.rival += count;
      armyGroups.set(key, slot);
    }
    const pawns = (this.pawns ??= buildPawnSprites());
    for (const [provId, counts] of armyGroups) {
      const s = region.settlement(provId);
      if (!s) continue;
      const { px, py } = this.toPx(s.x, s.y);
      if (!this.inView(px, py, 48)) continue;
      // Player armies: a squad of soldiers to the left; rival raiders to the right.
      if (counts.player > 0) {
        const frames = pawns.settlerArmed[provId % pawns.settlerArmed.length];
        this.drawSquad(px - 24, py - 12, counts.player, frames, '#7fb2ff');
      }
      if (counts.rival > 0) {
        this.drawSquad(px + 24, py - 12, counts.rival, pawns.raider, '#ff8a7a');
      }
    }
    g.textAlign = 'left';
  }

  /** Draw an army as a little animated formation of pawn sprites plus a strength
   *  chip, instead of a bare `⚔N` glyph. 1–3 figures scale with the count; the
   *  2-frame walk cycle ties to the global frame counter (so they shuffle in
   *  place). `frames` is a unit's [stand, step] sprite pair. */
  private drawSquad(cx: number, cy: number, count: number, frames: HTMLCanvasElement[], color: string): void {
    if (frames.length === 0) return;
    const g = this.g;
    const n = count >= 6 ? 3 : count >= 3 ? 2 : 1;
    const fi = Math.floor(this.frame / 12) % frames.length;
    const sprite = frames[fi];
    const SP = 24; // on-map size of each 32×32 figure
    const prevSmoothing = g.imageSmoothingEnabled;
    g.imageSmoothingEnabled = false;
    // Back-to-front so nearer figures overlap the farther ones.
    for (let i = n - 1; i >= 0; i--) {
      const dx = (i - (n - 1) / 2) * 8;
      const dy = -(i % 2) * 3; // alternate depth row
      g.drawImage(sprite, Math.round(cx + dx - SP / 2), Math.round(cy + dy - SP), SP, SP);
    }
    g.imageSmoothingEnabled = prevSmoothing;
    // Strength chip below the squad.
    const label = String(count);
    g.font = 'bold 10px ui-monospace, monospace';
    g.textAlign = 'center';
    const w = Math.ceil(g.measureText(label).width) + 8;
    g.fillStyle = 'rgba(18,16,14,0.82)';
    g.fillRect(cx - w / 2, cy + 1, w, 12);
    g.fillStyle = color;
    g.fillRect(cx - w / 2, cy + 1, w, 1); // top accent line
    g.fillText(label, cx, cy + 10);
    g.textAlign = 'left';
  }

  /** Enter (or cancel) click-to-found placement mode for a source town. On enter,
   *  precompute every valid target cell within reach so the highlight overlay is
   *  a cheap set lookup, not 16k validations per frame. */
  private toggleFoundingMode(fromId: number): void {
    if (this.foundingFromId === fromId) { this.cancelFoundingMode(); return; }
    this.foundingFromId = fromId;
    this.claimLandMode = false; // mutually exclusive map modes
    const r = this.region;
    const t = r.settlement(fromId);
    const valid = new Set<number>();
    if (t) {
      const N = REGION_N;
      const fromCell = r.map.coordToCell(t.x, t.y);
      const range = Math.round(N * 0.28);
      const lo = (v: number) => Math.max(0, v - range), hi = (v: number) => Math.min(N - 1, v + range);
      for (let col = lo(fromCell.x); col <= hi(fromCell.x); col++) {
        for (let row = lo(fromCell.y); row <= hi(fromCell.y); row++) {
          const rx = (col / N) * 100, ry = (row / N) * 100;
          if (r.canFoundAt(fromId, rx, ry).ok) valid.add(col * N + row);
        }
      }
    }
    this.foundingValidCells = valid;
  }

  private cancelFoundingMode(): void {
    this.foundingFromId = null;
    this.foundingValidCells = null;
  }

  /** Per-frame highlight of valid founding sites (map-space, under the camera).
   *  A soft pulsing green hex on each reachable, legal site. */
  private drawFoundingOverlay(W: number, H: number): void {
    const cells = this.foundingValidCells;
    if (this.foundingFromId === null || !cells || cells.size === 0) return;
    const g = this.g;
    const N = REGION_N;
    const { size, ox, oy } = hexLayoutParams(W, H, N, 60);
    const pulse = 0.18 + 0.12 * Math.abs(Math.sin(this.frame / 18));
    g.lineWidth = 1.5;
    for (const key of cells) {
      const col = Math.floor(key / N), row = key % N;
      const { x: cx, y: cy } = hexCenter(col, row, size, ox, oy);
      if (cx < this.vb.l - size || cx > this.vb.r + size || cy < this.vb.t - size || cy > this.vb.b + size) continue;
      const corners = hexCorners(cx, cy, size);
      g.fillStyle = `rgba(120,210,110,${pulse.toFixed(3)})`;
      fillHexPath(g, corners);
      g.strokeStyle = 'rgba(150,230,140,0.7)';
      strokeHexPath(g, corners);
    }
  }

  /** Arm (or cancel) building-placement mode for a town + building def. Precomputes
   *  the legal worked-ring cells so the per-frame highlight is a set lookup. */
  private toggleBuildingPlacement(townId: number, defId: string): void {
    if (this.buildingPlacement && this.buildingPlacement.townId === townId && this.buildingPlacement.defId === defId) {
      this.cancelBuildingPlacement(); return;
    }
    this.foundingFromId = null; this.foundingValidCells = null; // mutually exclusive
    this.buildingPlacement = { townId, defId };
    this.buildingValidCells = new Set(this.region.buildablePlacementCells(townId));
  }

  private cancelBuildingPlacement(): void {
    this.buildingPlacement = null;
    this.buildingValidCells = null;
  }

  /** Per-frame highlight of legal building sites. Amber for an ordinary building,
   *  gold for a one-per-empire Wonder (Phase D) — both distinct from the green
   *  town-founding highlight. */
  private drawBuildingPlacementOverlay(W: number, H: number): void {
    const cells = this.buildingValidCells;
    if (!this.buildingPlacement || !cells || cells.size === 0) return;
    const g = this.g;
    const N = REGION_N;
    const { size, ox, oy } = hexLayoutParams(W, H, N, 60);
    const pulse = 0.16 + 0.12 * Math.abs(Math.sin(this.frame / 18));
    const wonder = REGION_BUILDINGS.find((b) => b.id === this.buildingPlacement!.defId)?.unique === true;
    const fill = wonder ? `rgba(245,205,70,${pulse.toFixed(3)})` : `rgba(228,178,90,${pulse.toFixed(3)})`;
    const stroke = wonder ? 'rgba(255,228,130,0.9)' : 'rgba(240,200,120,0.75)';
    g.lineWidth = wonder ? 2 : 1.5;
    for (const key of cells) {
      const col = Math.floor(key / N), row = key % N;
      const { x: cx, y: cy } = hexCenter(col, row, size, ox, oy);
      if (cx < this.vb.l - size || cx > this.vb.r + size || cy < this.vb.t - size || cy > this.vb.b + size) continue;
      const corners = hexCorners(cx, cy, size);
      g.fillStyle = fill;
      fillHexPath(g, corners);
      g.strokeStyle = stroke;
      strokeHexPath(g, corners);
    }
  }

  /** Render each town's placed buildings as small shaded icons on their hexes,
   *  tinted by the building's economic sector (spatial-4X Phase B — render-only). */
  private drawPlacedBuildings(W: number, H: number): void {
    const g = this.g;
    const N = REGION_N;
    const { size, ox, oy } = hexLayoutParams(W, H, N, 60);
    const sectorColor: Record<string, string> = {
      agriculture: '#8a9a4a', industry: '#9a6a3a', services: '#4a7fa4', information: '#7a5a9a', all: '#9a8a5a',
    };
    for (const t of this.region.settlements) {
      if (!t.placedBuildings || t.placedBuildings.length === 0) continue;
      // Spatial-4X Phase D slice 2: draw a faint connector glow between same-sector
      // buildings on adjacent hexes, so a DISTRICT (the clustering synergy) reads at
      // a glance. Render-only — mirrors the sim's districtAdjacencyBonus rule.
      const cellSector = new Map<number, string>();
      for (const p of t.placedBuildings) {
        const def = REGION_BUILDINGS.find((b) => b.id === p.id);
        if (def && def.sector !== 'all') cellSector.set(p.cell, def.sector);
      }
      if (cellSector.size >= 2) {
        g.save();
        g.lineWidth = Math.max(2, size * 0.16);
        g.lineCap = 'round';
        for (const [cell, sec] of cellSector) {
          const col = Math.floor(cell / N), row = cell % N;
          for (const [ax, ay] of hexNeighbors(col, row)) {
            const nCell = ax * N + ay;
            if (nCell <= cell) continue; // draw each pair once
            if (cellSector.get(nCell) !== sec) continue;
            const a = hexCenter(col, row, size, ox, oy);
            const b = hexCenter(ax, ay, size, ox, oy);
            if (Math.max(a.x, b.x) < this.vb.l - size || Math.min(a.x, b.x) > this.vb.r + size) continue;
            if (Math.max(a.y, b.y) < this.vb.t - size || Math.min(a.y, b.y) > this.vb.b + size) continue;
            g.strokeStyle = sectorColor[sec] ?? '#9a8a5a';
            g.globalAlpha = 0.35;
            g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
          }
        }
        g.restore();
      }
      for (const p of t.placedBuildings) {
        const col = Math.floor(p.cell / N), row = p.cell % N;
        const { x: cx, y: cy } = hexCenter(col, row, size, ox, oy);
        if (cx < this.vb.l - size || cx > this.vb.r + size || cy < this.vb.t - size || cy > this.vb.b + size) continue;
        const def = REGION_BUILDINGS.find((b) => b.id === p.id);
        const base = sectorColor[def?.sector ?? 'all'] ?? '#9a8a5a';
        const s = Math.max(6, size * 0.5);
        // little shaded building: body + lit roof + drop shadow
        g.fillStyle = 'rgba(0,0,0,0.25)';
        g.beginPath(); g.ellipse(cx, cy + s * 0.5, s * 0.55, s * 0.2, 0, 0, Math.PI * 2); g.fill();
        this.box(Math.round(cx - s / 2), Math.round(cy - s * 0.35), Math.round(s), Math.round(s * 0.8), base);
        this.roof(Math.round(cx - s / 2 - 1), Math.round(cy - s * 0.7), Math.round(s + 2), Math.round(s * 0.4), this.shade(base, -0.28));
      }
    }
  }

  /** Province inspector panel: shows detailed stats for the selected province. */
  private drawProvincePanel(): void {
    const show = this.provinceViewActive && this.selectedProvinceId !== null;
    if (!show) {
      this.provincePanel.classList.add('hidden');
      return;
    }
    this.provincePanel.classList.remove('hidden');

    const prov = this.getCachedProvinces().find((p) => p.id === this.selectedProvinceId);
    if (!prov) {
      this.provincePanel.classList.add('hidden');
      return;
    }

    // Throttle rebuild: 1 per 60 frames unless selection changed
    if (
      this.lastProvincePanelId === prov.id &&
      this.frame - this.lastProvincePanelBuildFrame < 60
    ) return;
    this.lastProvincePanelId = prov.id;
    this.lastProvincePanelBuildFrame = this.frame;

    const faction = this.region.faction(prov.factionId);
    const factionName = faction?.name ?? 'Unknown';
    const color = faction?.color ?? '#aaa';
    const isPlayer = prov.factionId === this.region.playerFactionId;

    const buildings = prov.keyBuildings.length > 0
      ? prov.keyBuildings.slice(0, 6).join(', ')
      : 'none';
    const satBar = `<div style="background:rgba(255,255,255,0.1);height:6px;border-radius:3px;overflow:hidden;margin:2px 0">` +
      `<div style="width:${Math.max(0, Math.min(100, prov.satisfaction))}%;height:100%;background:${prov.satisfaction >= 70 ? '#7ab4d4' : prov.satisfaction >= 40 ? '#c2a14d' : '#c26a6a'}"></div></div>`;

    // Province policy controls (player provinces only)
    const pol = isPlayer ? this.region.getProvincePolicy(prov.id) : null;
    const TAX_LABELS = ['×0.5 Low', '×1.0 Normal', '×1.5 High', '×2.0 Max'];
    const INV_LABELS = ['Low', 'Medium', 'High'];
    const AUTO_LABELS = ['Administered', 'Semi-auto', 'Self-govern'];
    const policyHtml = pol && this.region.stateProclaimed ? `
      <p class="insp-skills">PROVINCE POLICY</p>
      <p style="font-size:0.82em">Tax:
        <select id="pp-tax" style="background:#1a2030;color:#c0c8d8;border:1px solid #3a4254;border-radius:3px;padding:1px 4px">
          ${[0.5, 1.0, 1.5, 2.0].map((v, i) => `<option value="${v}"${Math.abs(pol.taxMultiplier - v) < 0.01 ? ' selected' : ''}>${TAX_LABELS[i]}</option>`).join('')}
        </select>
      </p>
      <p style="font-size:0.82em">Investment:
        <select id="pp-inv" style="background:#1a2030;color:#c0c8d8;border:1px solid #3a4254;border-radius:3px;padding:1px 4px">
          ${[0, 1, 2].map((v) => `<option value="${v}"${pol.investmentLevel === v ? ' selected' : ''}>${INV_LABELS[v]}</option>`).join('')}
        </select>
      </p>
      <p style="font-size:0.82em">Autonomy:
        <select id="pp-auto" style="background:#1a2030;color:#c0c8d8;border:1px solid #3a4254;border-radius:3px;padding:1px 4px">
          ${[0, 1, 2].map((v) => `<option value="${v}"${pol.autonomyLevel === v ? ' selected' : ''}>${AUTO_LABELS[v]}</option>`).join('')}
        </select>
      </p>` : '';

    // Stationed armies
    const armies = this.region.armiesAt(prov.id);
    const armyHtml = armies.length > 0
      ? `<p class="insp-skills">STATIONED FORCES</p>` +
        armies.map((a) => {
          const total = a.units.reduce((s, u) => s + u.count, 0);
          const morale = Math.round(a.units.reduce((s, u) => s + u.morale * u.count, 0) / Math.max(1, total));
          return `<p style="font-size:0.82em">${total} units · morale ${morale}%
            <button class="mini" data-army="${a.id}" id="cancel-army-${a.id}" style="margin-left:4px">✕</button></p>`;
        }).join('')
      : '';

    this.setInnerHtml(
      this.provincePanel,
      `<p class="insp-name" style="color:${color}">${prov.name}</p>` +
      `<p class="insp-skills">${isPlayer ? 'YOUR PROVINCE' : factionName.toUpperCase()}</p>` +
      `<p>Population: <b>${prov.totalPop.toLocaleString()}</b></p>` +
      `<p>GDP/mo: <b>${formatCurrency(prov.gdpContribution)}</b></p>` +
      `<p>Satisfaction: <b>${prov.satisfaction}%</b>${satBar}</p>` +
      `<p>Garrison: <b>${prov.militaryStrength}</b></p>` +
      `<p class="insp-skills">BUILDINGS</p>` +
      `<p style="font-size:0.85em;color:#a8b4c4">${buildings}</p>` +
      policyHtml +
      armyHtml +
      `<p><button class="mini" id="prov-panel-close">✕ close</button></p>`,
    );

    this.provincePanel.querySelector<HTMLButtonElement>('#prov-panel-close')?.addEventListener('click', () => {
      this.selectedProvinceId = null;
      this.provincePanel.classList.add('hidden');
    });

    // Province policy change handlers
    if (pol) {
      const taxSel = this.provincePanel.querySelector<HTMLSelectElement>('#pp-tax');
      const invSel = this.provincePanel.querySelector<HTMLSelectElement>('#pp-inv');
      const autoSel = this.provincePanel.querySelector<HTMLSelectElement>('#pp-auto');
      taxSel?.addEventListener('change', () => {
        this.region.setProvincePolicy(prov.id, { taxMultiplier: parseFloat(taxSel.value) });
        this.lastProvincePanelBuildFrame = 0; // force rebuild
      });
      invSel?.addEventListener('change', () => {
        this.region.setProvincePolicy(prov.id, { investmentLevel: parseInt(invSel.value) });
        this.lastProvincePanelBuildFrame = 0;
      });
      autoSel?.addEventListener('change', () => {
        this.region.setProvincePolicy(prov.id, { autonomyLevel: parseInt(autoSel.value) });
        this.lastProvincePanelBuildFrame = 0;
      });
    }

    // Army cancel handlers
    for (const a of armies) {
      this.provincePanel.querySelector(`#cancel-army-${a.id}`)?.addEventListener('click', () => {
        this.region.cancelArmyMovement(a.id);
        this.lastProvincePanelBuildFrame = 0;
      });
    }
  }

  /** Build the offscreen water-pixel mask once per canvas-resize; water tiles never change biome. */
  private ensureWaterMask(W: number, H: number): void {
    const dims = `${W}x${H}`;
    if (this.waterMaskCanvas && this.waterMaskDims === dims) return;
    if (!this.waterMaskCanvas) this.waterMaskCanvas = document.createElement('canvas');
    this.waterMaskCanvas.width = W;
    this.waterMaskCanvas.height = H;
    const mc = this.waterMaskCanvas.getContext('2d')!;
    mc.clearRect(0, 0, W, H);
    const map = this.region.map;
    const N = REGION_N;
    const m = 60;
    const { size, ox, oy } = hexLayoutParams(W, H, N, m);
    mc.fillStyle = 'rgb(200,220,240)';
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        if (!RegionView.WATER_BIOMES.has(map.at(x, y).biome)) continue;
        const { x: cx, y: cy } = hexCenter(x, y, size, ox, oy);
        fillHexPath(mc, hexCorners(cx, cy, size));
      }
    }
    this.waterMaskDims = dims;
  }

  /** Subtle per-frame water shimmer — one drawImage instead of 65 536 fillRects. */
  private drawWaterAnimation(): void {
    const W = this.canvas.width;
    const H = this.canvas.height;
    this.ensureWaterMask(W, H);
    const wave = Math.sin(this.frame * 0.05) * 0.5 + 0.5; // 0..1
    this.g.globalAlpha = wave * 0.04; // max 4% opacity — very subtle shimmer
    this.g.drawImage(this.waterMaskCanvas!, 0, 0);
    this.g.globalAlpha = 1;
  }

  /** Full-screen atmospheric pass (screen-space): seasonal wash + vignette. */
  private drawAtmosphere(W: number, H: number, lit: { night: number; golden: number; season: number }): void {
    const { g } = this;
    // Seasonal wash — faint, so it colours the mood without fighting the map.
    const seasonTint = ['rgba(120,180,96,0.07)', 'rgba(255,206,120,0.06)', 'rgba(208,138,60,0.08)', 'rgba(150,182,224,0.09)'][lit.season] ?? '';
    if (seasonTint) { g.fillStyle = seasonTint; g.fillRect(0, 0, W, H); }
    // Vignette: a darkened frame that draws the eye inward. Gradient is cached per canvas size.
    const dims = `${W}x${H}`;
    if (!this.vignetteGrad || this.vignetteDims !== dims) {
      this.vignetteDims = dims;
      this.vignetteGrad = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.36, W / 2, H / 2, Math.max(W, H) * 0.72);
      this.vignetteGrad.addColorStop(0, 'rgba(0,0,0,0)');
      this.vignetteGrad.addColorStop(1, 'rgba(4,6,12,0.5)');
    }
    g.fillStyle = this.vignetteGrad;
    g.fillRect(0, 0, W, H);
  }

  /** HUD panel drawn in screen-space for a selected player scout. */
  private drawScoutPanel(
    scout: Scout & { name?: string; autoExplore?: boolean; manualTargetX?: number; manualTargetY?: number },
    W: number, H: number,
  ): void {
    const { g } = this;
    const pw = 210, ph = 96;
    const spx = W - pw - 14;
    const spy = H - ph - 58;
    g.fillStyle = 'rgba(10,14,24,0.92)';
    g.beginPath(); (g as any).roundRect?.(spx, spy, pw, ph, 8) ?? g.rect(spx, spy, pw, ph); g.fill();
    g.strokeStyle = 'rgba(80,140,220,0.55)';
    g.lineWidth = 1;
    g.beginPath(); (g as any).roundRect?.(spx, spy, pw, ph, 8) ?? g.rect(spx, spy, pw, ph); g.stroke();
    const sname = scout.name ?? 'Scout';
    const days = Math.max(0, scout.expireDay - this.region.day);
    g.fillStyle = '#a8c8ff';
    g.font = 'bold 11px monospace';
    g.textAlign = 'left';
    g.fillText(`SCOUT · ${sname}`, spx + 10, spy + 18);
    g.fillStyle = '#7a9ab8';
    g.font = '10px monospace';
    g.fillText(`${days}d remaining  HP ${scout.health}`, spx + 10, spy + 33);
    const autoOn = scout.autoExplore !== false;
    g.fillStyle = autoOn ? '#4af' : '#888';
    g.fillText(autoOn ? '⟳ Auto-Explore ON' : '○ Parked', spx + 10, spy + 48);
    if (scout.manualTargetX !== undefined) {
      g.fillStyle = '#fca';
      g.fillText('→ Moving to waypoint', spx + 10, spy + 63);
    } else {
      g.fillStyle = '#888';
      g.fillText(autoOn ? 'Click map to send to waypoint' : 'Auto-Explore is OFF', spx + 10, spy + 63);
    }
    g.fillStyle = '#556';
    g.font = '9px monospace';
    g.fillText('Click scout to deselect', spx + 10, spy + 82);
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
    const { size, ox, oy } = hexLayoutParams(W, H, N, m);
    const known = (col: number, row: number): boolean => {
      if (col < 0 || row < 0 || col >= N || row >= N) return false;
      return this.revealedAt((col / N) * 100, (row / N) * 100);
    };
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        if (known(x, y)) continue;
        // Feather toward the frontier: any known hex neighbour thins the veil.
        const frontier = hexNeighbors(x, y).some(([nc, nr]) => known(nc, nr));
        const { x: cx, y: cy } = hexCenter(x, y, size, ox, oy);
        const corners = hexCorners(cx, cy, size);
        // Painterly cloud mottle so the shroud reads as drifting fog, not a slab.
        const hash = (x * 374761393 ^ y * 668265263) >>> 0;
        const mottle = ((hash % 7) - 3) * 0.012;
        const base = frontier ? 0.48 : 0.9;
        g.fillStyle = `rgba(9,13,21,${Math.max(0, Math.min(0.96, base + mottle))})`;
        fillHexPath(g, corners);
        // A cool, sparse cloud highlight catching light over the deep unknown.
        if (!frontier && (hash >> 4) % 6 === 0) {
          g.fillStyle = 'rgba(74,88,116,0.10)';
          fillHexPath(g, corners);
        }
      }
    }
  }

  private drawMemoryFog(g: CanvasRenderingContext2D, W: number, H: number): void {
    const N = REGION_N;
    const m = 60;
    const { size, ox, oy } = hexLayoutParams(W, H, N, m);
    const pid = this.region.playerFactionId;
    for (let row = 0; row < N; row++) {
      for (let col = 0; col < N; col++) {
        const lx = Math.round((col / N) * 100);
        const ly = Math.round((row / N) * 100);
        if (!this.revealedAt(lx, ly)) continue;
        if (this.region.isVisibleToFaction(lx, ly, pid)) continue;
        const frontier = hexNeighbors(col, row).some(([nc, nr]) => {
          const fx = Math.round((nc / N) * 100);
          const fy = Math.round((nr / N) * 100);
          return this.region.isVisibleToFaction(fx, fy, pid);
        });
        const { x: cx, y: cy } = hexCenter(col, row, size, ox, oy);
        g.fillStyle = frontier ? 'rgba(140,150,170,0.32)' : 'rgba(140,150,170,0.58)';
        fillHexPath(g, hexCorners(cx, cy, size));
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
    const { size, ox, oy } = hexLayoutParams(W, H, N, m);
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
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const rgb = rgbOf(grid[x * N + y]);
        if (!rgb) continue;
        const { x: cx, y: cy } = hexCenter(x, y, size, ox, oy);
        g.fillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},0.12)`;
        fillHexPath(g, hexCorners(cx, cy, size));
      }
    }
    // 2) frontier lines: each hex edge where the neighbor belongs to a different faction
    g.lineWidth = 2;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const fid = grid[x * N + y];
        const rgb = rgbOf(fid);
        if (!rgb) continue;
        const { x: cx, y: cy } = hexCenter(x, y, size, ox, oy);
        const corners = hexCorners(cx, cy, size);
        g.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},0.85)`;
        for (let d = 0; d < 6; d++) {
          const [nc, nr] = hexNeighborDir(x, y, d);
          const nb = nc >= 0 && nc < N && nr >= 0 && nr < N ? grid[nc * N + nr] : -9;
          if (nb === fid) continue;
          const a = corners[d];
          const b = corners[(d + 1) % 6];
          g.beginPath();
          g.moveTo(a.x, a.y);
          g.lineTo(b.x, b.y);
          g.stroke();
        }
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
      if (!this.inView(px, py, 80)) continue;
      const rs = region.getSettlementResourceStatus(t);
      const cells: [string, string][] = [['F', rs.food], ['W', rs.wood], ['G', rs.goods]];
      // Scaled with the settlement glyph so the F/W/G chips tuck just beneath the
      // town instead of floating hexes away.
      this.withGlyphScale(px, py, () => {
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
      });
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
  /** Lighten (f>0) / darken (f<0) a #rrggbb colour for cheap edge-lighting. */
  private shade(hex: string, f: number): string {
    const n = parseInt(hex.slice(1), 16);
    const a = (c: number) => Math.max(0, Math.min(255, Math.round(c + 255 * f)));
    return `rgb(${a((n >> 16) & 255)},${a((n >> 8) & 255)},${a(n & 255)})`;
  }

  /** A wall/mass block with top-left highlight + bottom-right shadow — gives the
   *  flat tiers a sense of light and depth without per-pixel art. */
  private box(x: number, y: number, w: number, h: number, base: string): void {
    const g = this.g;
    g.fillStyle = base; g.fillRect(x, y, w, h);
    g.fillStyle = this.shade(base, 0.10); g.fillRect(x, y, w, 1); g.fillRect(x, y, 1, h);
    g.fillStyle = this.shade(base, -0.16); g.fillRect(x, y + h - 1, w, 1); g.fillRect(x + w - 1, y, 1, h);
  }

  /** A roof block — brighter ridge along the top, darker eave at the bottom. */
  private roof(x: number, y: number, w: number, h: number, base: string): void {
    const g = this.g;
    g.fillStyle = base; g.fillRect(x, y, w, h);
    g.fillStyle = this.shade(base, 0.16); g.fillRect(x, y, w, 1);
    g.fillStyle = this.shade(base, -0.22); g.fillRect(x, y + h - 1, w, 1);
  }

  /** A warm lit window: soft amber glow, bright pane, top glint. */
  private litWindow(x: number, y: number, w: number, h: number): void {
    const g = this.g;
    g.fillStyle = 'rgba(240,214,120,0.22)'; g.fillRect(x - 1, y - 1, w + 2, h + 2);
    g.fillStyle = '#e8d27a'; g.fillRect(x, y, w, h);
    g.fillStyle = '#fff3c4'; g.fillRect(x, y, Math.max(1, w - 1), 1);
  }

  private door(x: number, y: number, w: number, h: number, color = '#8a6a3a'): void {
    const g = this.g;
    g.fillStyle = color; g.fillRect(x, y, w, h);
    g.fillStyle = this.shade(color, -0.22); g.fillRect(x, y, w, 1);
  }

  /** Animated chimney smoke — a couple of puffs rising and fading. */
  private smoke(cx: number, top: number): void {
    const g = this.g;
    for (let k = 0; k < 3; k++) {
      const rise = ((this.frame >> 2) + k * 4) % 12; // 0..11
      const a = 0.4 * (1 - rise / 12);
      if (a <= 0.03) continue;
      const sz = 1 + (rise > 6 ? 1 : 0);
      g.fillStyle = `rgba(208,210,214,${a.toFixed(3)})`;
      g.fillRect(Math.round(cx) - sz, top - rise, sz + 1, sz + 1);
    }
  }

  private drawTownTier(px: number, py: number, pop: number, selected: boolean): void {
    const g = this.g;
    const tier = townSpriteTier(pop);
    const sprite = this.assets.get(`town-${tier}`);

    // Soft elliptical ground shadow (replaces the flat plate).
    const sw = tier === 'castle' ? 19 : tier === 'manor' ? 17 : tier === 'town' ? 16 : 14;
    g.fillStyle = 'rgba(0,0,0,0.26)';
    g.beginPath();
    g.ellipse(px, py + 9, sw, 4.5, 0, 0, Math.PI * 2);
    g.fill();

    if (sprite) {
      // Real art override (curated PNG), centred on the ground line.
      const s = TOWN_TIER_PX[tier];
      g.imageSmoothingEnabled = false;
      g.drawImage(sprite, Math.round(px - s / 2), Math.round(py + 8 - s), s, s);
    } else if (pop < 30) {
      // Shack: one tiny rough-timber building
      this.box(px - 6, py - 4, 12, 12, '#5a4329');
      this.roof(px - 7, py - 8, 14, 5, '#33261a');
      this.door(px - 1, py - 2, 2, 4);
    } else if (pop < 80) {
      // Cottage: tidy house with a smoking chimney
      this.box(px - 8, py - 4, 16, 12, '#7a5436');
      this.roof(px - 9, py - 10, 18, 7, '#43342a');
      this.box(px + 3, py - 15, 4, 6, '#5a4030'); // chimney
      this.smoke(px + 5, py - 16);
      this.litWindow(px - 4, py - 1, 3, 3);
      this.litWindow(px + 2, py - 1, 3, 3);
    } else if (pop < 200) {
      // House: proper two-story with detail
      this.box(px - 10, py - 8, 20, 16, '#86603f');
      this.roof(px - 11, py - 14, 22, 7, '#43342a');
      this.box(px + 5, py - 19, 4, 6, '#5a4030'); // chimney
      this.smoke(px + 7, py - 20);
      this.door(px - 3, py - 3, 6, 8, '#241a12'); // arch
      this.litWindow(px - 8, py - 5, 3, 3);
      this.litWindow(px + 5, py - 5, 3, 3);
      this.litWindow(px - 8, py + 2, 3, 3);
      this.litWindow(px + 5, py + 2, 3, 3);
    } else if (pop < 500) {
      // Town: cluster of buildings around a central hall
      this.box(px - 14, py - 6, 28, 14, '#9a7450'); // base block
      this.box(px - 14, py - 4, 6, 10, '#7a5436'); // flanking cottages
      this.box(px + 8, py - 4, 6, 10, '#7a5436');
      this.roof(px - 15, py - 8, 8, 5, '#43342a');
      this.roof(px + 7, py - 8, 8, 5, '#43342a');
      this.box(px - 7, py - 12, 14, 18, '#86603f'); // central hall
      this.roof(px - 15, py - 10, 30, 5, '#33261a'); // wide roof
      this.roof(px - 8, py - 16, 16, 5, '#43342a'); // peak
      this.litWindow(px - 5, py - 9, 3, 4);
      this.litWindow(px + 2, py - 9, 3, 4);
      this.door(px - 1, py - 1, 2, 6, '#c2a14d');
    } else if (pop < 1000) {
      // Manor: grand estate with corner towers
      this.box(px - 16, py - 8, 32, 16, '#a9855f');
      this.box(px - 18, py - 14, 6, 18, '#6a4c38'); // towers
      this.box(px + 12, py - 14, 6, 18, '#6a4c38');
      this.roof(px - 19, py - 18, 8, 5, '#33261a');
      this.roof(px + 11, py - 18, 8, 5, '#33261a');
      this.box(px - 10, py - 14, 20, 22, '#86603f'); // central block
      this.roof(px - 17, py - 12, 34, 5, '#33261a');
      this.roof(px - 11, py - 18, 22, 5, '#43342a');
      this.litWindow(px - 7, py - 10, 3, 4);
      this.litWindow(px + 4, py - 10, 3, 4);
      this.litWindow(px - 7, py - 2, 3, 4);
      this.litWindow(px + 4, py - 2, 3, 4);
      this.door(px - 2, py - 4, 4, 8, '#c2a14d');
    } else {
      // Castle: fortified keep with battlements
      this.box(px - 18, py - 10, 36, 18, '#787064'); // curtain wall
      this.box(px - 12, py - 18, 24, 26, '#88806f'); // keep
      for (let bx = -16; bx <= 12; bx += 4) this.box(px + bx, py - 13, 3, 4, '#5f594c');
      for (let bx = -10; bx <= 8; bx += 4) this.box(px + bx, py - 21, 3, 4, '#5f594c');
      this.litWindow(px - 8, py - 14, 3, 4);
      this.litWindow(px + 5, py - 14, 3, 4);
      this.litWindow(px - 8, py - 5, 3, 4);
      this.litWindow(px + 5, py - 5, 3, 4);
      this.door(px - 2, py - 4, 4, 12, '#c2a14d'); // gate
      g.fillStyle = '#241a12'; g.fillRect(px - 1, py - 6, 2, 3); // portcullis
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

  /** The generated land itself, in hexagonal tiles: this map IS the world. */
  private drawTerrain(g: CanvasRenderingContext2D, W: number, H: number): void {
    const { region } = this;
    const map = region.map;
    const N = REGION_N;
    const m = 60;
    const { size, ox, oy } = hexLayoutParams(W, H, N, m);
    // Hex bounding box half-dimensions (for texture positioning)
    const hw = Math.sqrt(3) * size / 2; // half-width of hex
    const isWater = (x: number, y: number): boolean =>
      x >= 0 && y >= 0 && x < N && y < N && RegionView.WATER_BIOMES.has(map.at(x, y).biome);
    const touchesLand = (x: number, y: number): boolean =>
      hexNeighbors(x, y).some(([nc, nr]) => !isWater(nc, nr));
    const touchesWater = (x: number, y: number): boolean =>
      hexNeighbors(x, y).some(([nc, nr]) => isWater(nc, nr));
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const c = map.at(x, y);
        const { x: cx, y: cy } = hexCenter(x, y, size, ox, oy);
        const corners = hexCorners(cx, cy, size);
        // Bounding box for texture details (stays within the hex)
        const bx = cx - hw;
        const by = cy - size;
        const bw = hw * 2;
        const bh = size * 2;
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
        fillHexPath(g, corners);

        const water = RegionView.WATER_BIOMES.has(c.biome);
        // Coastal shallows: water cells touching land get a turquoise rim — the
        // single biggest readability win, giving the map a real coastline.
        if (water && c.biome !== 'river' && touchesLand(x, y)) {
          g.fillStyle = 'rgba(86,150,160,0.5)';
          fillHexPath(g, corners);
        }
        // Beach: land cells at the water's edge get a sandy lip.
        if (!water && c.biome !== 'mountains' && touchesWater(x, y)) {
          g.fillStyle = 'rgba(196,176,120,0.5)';
          fillHexPath(g, corners);
        }
        // Subtle per-cell dither so flat colour bands read as textured ground.
        if (!water) {
          const hash = (x * 73856093 ^ y * 19349663) >>> 0;
          const n = (hash % 5) - 2; // -2..+2
          if (n !== 0) {
            g.fillStyle = n > 0 ? `rgba(255,250,235,${n * 0.018})` : `rgba(0,0,0,${-n * 0.022})`;
            fillHexPath(g, corners);
          }
        }

        // Elevation-based lighting: NW-lit hillshade using hex-direction neighbors.
        const [nwCol, nwRow] = hexNeighborDir(x, y, 4); // dir 4 = NW
        const [wCol,  wRow]  = hexNeighborDir(x, y, 3); // dir 3 = W
        const north = (nwRow >= 0 && nwCol >= 0 && nwCol < N) ? map.at(nwCol, nwRow).elevation : c.elevation;
        const west  = (wCol  >= 0 && wRow  >= 0 && wCol  < N) ? map.at(wCol,  wRow).elevation  : c.elevation;
        const shade = (c.elevation - north + c.elevation - west) * 1.4;
        if (shade > 0.01) {
          g.fillStyle = `rgba(255,255,240,${Math.min(0.32, shade * 0.6)})`;
          fillHexPath(g, corners);
        } else if (shade < -0.01) {
          g.fillStyle = `rgba(0,0,0,${Math.min(0.30, -shade * 0.5)})`;
          fillHexPath(g, corners);
        }

        // Texture details whose fillRects could bleed past the hex bounding box
        // are drawn inside a hex clip region (save once per biome that needs it).
        const needsClip = c.biome === 'forest' || c.biome === 'plains' || c.biome === 'hills';
        if (needsClip) {
          g.save();
          g.beginPath();
          g.moveTo(corners[0].x, corners[0].y);
          for (let i = 1; i < 6; i++) g.lineTo(corners[i].x, corners[i].y);
          g.closePath();
          g.clip();
        }
        // Forest canopy: layered blobs — dark trunks under lit crowns — so
        // woodland reads as foliage rather than a flat green block.
        if (c.biome === 'forest') {
          const r = Math.max(2, bw * 0.26);
          for (let k = 0; k < 3; k++) {
            const h = (x * 17 + y * 31 + k * 101) >>> 0;
            const tx = bx + (h % Math.max(1, Math.floor(bw - r)));
            const ty = by + ((h >> 4) % Math.max(1, Math.floor(bh - r)));
            g.fillStyle = 'rgba(18,36,14,0.5)';
            g.fillRect(tx, ty + 1, r, r); // shadow
            g.fillStyle = 'rgba(58,96,46,0.55)';
            g.fillRect(tx, ty, r, r); // lit crown
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
        if (needsClip) g.restore();
        // Mountain snow caps on highest peaks
        if (c.biome === 'mountains' && c.elevation > 0.82) {
          g.fillStyle = `rgba(230,230,240,${(c.elevation - 0.82) * 2.5})`;
          fillHexPath(g, corners);
        }
        // River shimmer
        if (c.biome === 'river' && (x + y + Math.floor(this.frame / 12)) % 5 === 0) {
          g.fillStyle = 'rgba(180,220,240,0.22)';
          fillHexPath(g, corners);
        }
        // Marsh reeds texture (clipped separately to allow full-height strips)
        if (c.biome === 'marsh' && (x * 5 + y * 7) % 11 < 3) {
          g.save();
          g.beginPath();
          g.moveTo(corners[0].x, corners[0].y);
          for (let i = 1; i < 6; i++) g.lineTo(corners[i].x, corners[i].y);
          g.closePath();
          g.clip();
          g.fillStyle = 'rgba(60,80,30,0.4)';
          g.fillRect(bx + bw * 0.3, by, Math.max(1, bw * 0.2), bh);
          g.restore();
        }
      }
    }
    // Ghost waterline (GDD §8.2): a faint blue overlay on low-elevation coastal
    // land cells showing the projected 2100 flood zone.  Appears once the
    // sea-rise warning fires (warmingC ≥ 1.2°C) — "quiet dread as persistent UI."
    const showWaterline = this.region.seaRiseAnnounced || this.region.year >= 2030;
    if (showWaterline) {
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const c = map.at(x, y);
          if (RegionView.WATER_BIOMES.has(c.biome)) continue;
          if (c.elevation > 0.18) continue; // only low-lying coastal land
          if (!hexNeighbors(x, y).some(([nc, nr]) => nc >= 0 && nr >= 0 && nc < N && nr < N
              && RegionView.WATER_BIOMES.has(map.at(nc, nr).biome))) continue;
          const { x: cx, y: cy } = hexCenter(x, y, size, ox, oy);
          const corners = hexCorners(cx, cy, size);
          g.fillStyle = 'rgba(30,110,220,0.22)';
          fillHexPath(g, corners);
          // Dashed blue border to mark the flood-zone edge
          g.strokeStyle = 'rgba(60,140,255,0.55)';
          g.lineWidth = 1;
          g.setLineDash([3, 3]);
          g.beginPath();
          g.moveTo(corners[5].x, corners[5].y);
          for (let i = 0; i < 6; i++) g.lineTo(corners[i].x, corners[i].y);
          g.closePath();
          g.stroke();
          g.setLineDash([]);
        }
      }
    }

    // Contour lines: draw shared hex edge when elevation crosses 0.2/0.4/0.6/0.8.
    // Check only directions 0/1/2 (E, SE, SW) so each edge is drawn once.
    g.strokeStyle = 'rgba(0,0,0,0.12)';
    g.lineWidth = 1;
    for (const level of [0.2, 0.4, 0.6, 0.8]) {
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const a = map.at(x, y).elevation;
          const { x: cx, y: cy } = hexCenter(x, y, size, ox, oy);
          const corners = hexCorners(cx, cy, size);
          for (const d of [0, 1, 2] as const) {
            const [nc, nr] = hexNeighborDir(x, y, d);
            if (nc < 0 || nr < 0 || nc >= N || nr >= N) continue;
            const b2 = map.at(nc, nr).elevation;
            if ((a < level) !== (b2 < level)) {
              const p0 = corners[d];
              const p1 = corners[(d + 1) % 6];
              g.beginPath();
              g.moveTo(p0.x, p0.y);
              g.lineTo(p1.x, p1.y);
              g.stroke();
            }
          }
        }
      }
    }
    // border vignette so the map reads as a map
    g.strokeStyle = '#6e4a2f';
    g.lineWidth = 2;
    g.strokeRect(m - 4, m - 4, W - 2 * m + 8, H - 2 * m + 8);
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
      `${Math.round(r.totalPop()).toLocaleString()} citizens · ${r.settlements.length} towns · ${r.researched.size} discoveries</p>` +
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
      dynastyHtml(this.region) +
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
    // Hold the reveal back while the era cinematic is still playing.
    if (this.cinematic?.kind === 'era') { this.eraModal.classList.add('hidden'); return; }
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
    // Hold the reveal back while the victory cinematic is still playing.
    if (this.cinematic?.kind === 'win') { this.winModal.classList.add('hidden'); return; }
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

  /** Per-cinematic palette + title: a painterly sky and a headline that the
   *  animated scene is built around. Keyed by era branch or victory path. */
  private cinematicTheme(kind: 'era' | 'win', variant: string): {
    sky: [string, string]; accent: string; title: string; subtitle: string;
  } {
    const eraThemes: Record<string, { sky: [string, string]; accent: string; title: string; subtitle: string }> = {
      solarpunk: { sky: ['#0b3d2e', '#7fd6a8'], accent: '#ffe08a', title: 'THE GARDEN CENTURY', subtitle: 'The grid hums clean' },
      dystopia:  { sky: ['#1a0e2a', '#5a2a6a'], accent: '#ff3da6', title: 'THE NEON CENTURY',   subtitle: 'Order, bought at a price' },
      drowned:   { sky: ['#0a1c33', '#26618a'], accent: '#7fd3ff', title: 'THE DROWNED CENTURY', subtitle: 'The sea comes for the coast' },
    };
    const winThemes: Record<string, { sky: [string, string]; accent: string; title: string; subtitle: string }> = {
      unification: { sky: ['#241405', '#a9711f'], accent: '#ffd874', title: 'UNIFICATION', subtitle: 'One nation, one flag' },
      legacy:      { sky: ['#1a1733', '#4a3f8a'], accent: '#ffe08a', title: 'LEGACY',      subtitle: 'History speaks your name' },
      domination:  { sky: ['#2a0808', '#7a1f1f'], accent: '#ff6a4a', title: 'DOMINATION',  subtitle: 'Sovereign, unchallenged' },
      solarpunk:   { sky: ['#0b3d2e', '#7fd6a8'], accent: '#ffe08a', title: 'THE GARDEN PATH', subtitle: 'A better century begins' },
    };
    const table = kind === 'era' ? eraThemes : winThemes;
    return table[variant] ?? { sky: ['#10131a', '#2a3550'], accent: '#e8d27a', title: 'A NEW CENTURY', subtitle: '' };
  }

  /** The cinematic: a frame-driven fullscreen canvas sequence that plays once
   *  when the century forks or a victory lands, before the DOM modal reveals.
   *  Tasteful and screen-space; a click (handled in click()) skips it. */
  private drawCinematic(W: number, H: number): void {
    if (!this.cinematic) return;
    const { kind, variant, startFrame } = this.cinematic;
    const elapsed = this.frame - startFrame;
    const dur = RegionView.CINEMATIC_FRAMES;
    if (elapsed >= dur) { this.cinematic = null; return; }
    const t = elapsed / dur; // 0..1 progress
    const g = this.g;
    const theme = this.cinematicTheme(kind, variant);

    g.save();
    // Sky: a vertical gradient that lightens as the scene resolves.
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, theme.sky[0]);
    sky.addColorStop(1, theme.sky[1]);
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);

    const cx = W / 2;
    const horizon = H * 0.62;

    // ---- Per-variant foreground motif ----
    if (variant === 'solarpunk') {
      // A sun rising over the horizon, with drifting pollen motes.
      const sunY = horizon - (H * 0.28) * Math.min(1, t * 1.4);
      const glow = g.createRadialGradient(cx, sunY, 0, cx, sunY, H * 0.4);
      glow.addColorStop(0, 'rgba(255,224,138,0.9)');
      glow.addColorStop(1, 'rgba(255,224,138,0)');
      g.fillStyle = glow;
      g.fillRect(0, 0, W, H);
      g.fillStyle = theme.accent;
      g.beginPath(); g.arc(cx, sunY, H * 0.08, 0, Math.PI * 2); g.fill();
      for (let i = 0; i < 40; i++) {
        const px = (i * 97 + this.frame * 0.6) % W;
        const py = (i * 53 + this.frame * 0.4) % H;
        g.fillStyle = `rgba(180,240,200,${0.2 + 0.2 * Math.sin(this.frame * 0.05 + i)})`;
        g.fillRect(px, py, 2, 2);
      }
    } else if (variant === 'dystopia' || variant === 'domination') {
      // A skyline silhouette with sweeping searchlights.
      g.fillStyle = 'rgba(0,0,0,0.55)';
      for (let i = 0; i < 14; i++) {
        const bw = W / 14;
        const bx = i * bw;
        const bh = (H * 0.18) + ((i * 137) % Math.floor(H * 0.28));
        g.fillRect(bx + 2, horizon - bh, bw - 4, bh + (H - horizon));
        // window glints
        for (let wy = horizon - bh + 6; wy < horizon; wy += 10) {
          if ((i + wy) % 3 === 0) { g.fillStyle = `rgba(255,90,180,0.5)`; g.fillRect(bx + 6, wy, 3, 3); g.fillStyle = 'rgba(0,0,0,0.55)'; }
        }
      }
      const beam = (this.frame * 0.02);
      for (let b = 0; b < 2; b++) {
        const ang = -Math.PI / 2 + Math.sin(beam + b * 2) * 0.6;
        g.strokeStyle = `rgba(255,61,166,${0.18 + 0.1 * Math.sin(beam)})`;
        g.lineWidth = 28;
        g.beginPath(); g.moveTo(cx + (b ? 120 : -120), H); g.lineTo(cx + Math.cos(ang) * H, H + Math.sin(ang) * H); g.stroke();
      }
    } else if (variant === 'drowned') {
      // A rising waterline with rain streaks.
      const waterY = H - (H * 0.5) * Math.min(1, t * 1.2);
      g.fillStyle = 'rgba(20,70,110,0.7)';
      g.fillRect(0, waterY, W, H - waterY);
      for (let i = 0; i < 6; i++) {
        const ry = waterY + Math.sin(this.frame * 0.06 + i) * 4 + i * 3;
        g.strokeStyle = `rgba(180,220,255,${0.15 - i * 0.02})`;
        g.lineWidth = 1; g.beginPath(); g.moveTo(0, ry); g.lineTo(W, ry); g.stroke();
      }
      for (let i = 0; i < 80; i++) {
        const px = (i * 71 + this.frame * 6) % W;
        const py = (i * 113 + this.frame * 14) % H;
        g.strokeStyle = 'rgba(200,225,255,0.25)';
        g.beginPath(); g.moveTo(px, py); g.lineTo(px - 2, py + 8); g.stroke();
      }
    } else {
      // unification / legacy: expanding rings + golden motes around a banner.
      for (let r = 0; r < 4; r++) {
        const rad = ((this.frame * 2 + r * 60) % (H * 0.6));
        g.strokeStyle = `rgba(255,216,116,${0.25 * (1 - rad / (H * 0.6))})`;
        g.lineWidth = 2; g.beginPath(); g.arc(cx, horizon, rad, 0, Math.PI * 2); g.stroke();
      }
      // a simple rising banner
      const bannerY = horizon - (H * 0.2) * Math.min(1, t * 1.5);
      g.fillStyle = theme.accent;
      g.fillRect(cx - 30, bannerY, 60, 80);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(cx - 30, bannerY + 26, 60, 14);
      for (let i = 0; i < 30; i++) {
        const px = cx + Math.cos(i * 1.7 + this.frame * 0.03) * (60 + i * 6);
        const py = horizon - Math.abs(Math.sin(i * 1.1 + this.frame * 0.04)) * (i * 5);
        g.fillStyle = `rgba(255,224,138,${0.4})`;
        g.fillRect(px, py, 2, 2);
      }
    }

    // ---- Title: fade in over the first third, hold, then prompt ----
    const titleAlpha = Math.min(1, Math.max(0, (t - 0.15) / 0.25));
    g.textAlign = 'center';
    g.fillStyle = `rgba(255,255,255,${titleAlpha})`;
    g.font = `bold ${Math.round(H * 0.06)}px serif`;
    g.fillText(theme.title, cx, horizon + H * 0.16);
    g.fillStyle = `rgba(255,255,255,${titleAlpha * 0.75})`;
    g.font = `${Math.round(H * 0.025)}px serif`;
    g.fillText(theme.subtitle, cx, horizon + H * 0.16 + H * 0.05);

    // Letterbox bars for the cinematic feel.
    g.fillStyle = '#000';
    const bar = H * 0.08;
    g.fillRect(0, 0, W, bar);
    g.fillRect(0, H - bar, W, bar);

    // Opening fade-from-black and a closing "click to continue" hint.
    if (t < 0.12) { g.fillStyle = `rgba(0,0,0,${1 - t / 0.12})`; g.fillRect(0, 0, W, H); }
    if (t > 0.75) {
      g.fillStyle = `rgba(255,255,255,${0.4 + 0.3 * Math.sin(this.frame * 0.1)})`;
      g.font = `${Math.round(H * 0.02)}px monospace`;
      g.fillText('click to continue', cx, H - bar - 16);
    }
    g.restore();
    g.textAlign = 'left';
  }

  /** The post-2100 epilogue scroll (GDD §8.5): once a few legacy beats have
   *  accumulated after the Century Report, gather them into one narrative. */
  private drawEpilogueModal(): void {
    const r = this.region;
    const beats = r.year >= 2100 ? r.epilogueBeats() : [];
    if (r.epilogueShown || beats.length < 3) {
      this.epilogueModal.classList.add('hidden');
      return;
    }
    if (!this.epilogueModal.classList.contains('hidden')) return; // already on screen
    this.epilogueModal.classList.remove('hidden');
    const branchTitle =
      r.eraBranch === 'solarpunk' ? 'THE GARDEN ENDURES'
      : r.eraBranch === 'dystopia' ? 'THE NEON ENDURES'
      : r.eraBranch === 'drowned' ? 'THE WATERS RISE' : 'THE YEARS ROLL ON';
    const beatHtml = beats
      .map((b) => `<p style="text-align:left;border-left:3px solid ${b.kind === 'good' ? '#4e9' : b.kind === 'bad' ? '#e55' : '#88a'};padding-left:10px">${b.text}</p>`)
      .join('');
    this.epilogueModal.innerHTML =
      `<div class="ceremony-box">` +
      `<h2>EPILOGUE · ${r.year} — ${branchTitle}</h2>` +
      `<p class="insp-skills">The century closed, but the story did not. What your choices wrote into the decades after:</p>` +
      beatHtml +
      `<p class="insp-skills">The sandbox is yours for as long as you care to play.</p>` +
      `<button id="epilogue-close-btn">Close the chapter</button>` +
      `</div>`;
    this.epilogueModal.querySelector<HTMLButtonElement>('#epilogue-close-btn')!.onclick = () => {
      r.epilogueShown = true;
      this.epilogueModal.classList.add('hidden');
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
      (() => {
        // Advisor forecast: project treasury 12 months out using last-month net cash flow
        const monthlyNet = r.gdpLastMonth * r.taxRate - (r.servicesLevel * 2 + r.militiaLevel * 3);
        const projected12mo = r.treasury + monthlyNet * 12;
        const forecast = r.advisorForecast('Finance', projected12mo);
        const finMin = r.ministerFor('treasury');
        const advisorName = finMin ? finMin.name : 'your advisors';
        const forecastCol = forecast >= 0 ? '#4e9' : '#e55';
        return `<p class="insp-skills" title="Treasury projection 12 months out, based on current tax and spending. Accuracy depends on your Finance minister's skill.">` +
          `${advisorName} forecasts treasury at ` +
          `<span style="color:${forecastCol}">${formatCurrency(Math.round(forecast))}</span> in 12 months</p>`;
      })() +
      `<p title="The global ledger (GDD §8.2): every chimney on earth, projected to 2100. The verdict is read in 2040.">` +
      `CO₂ ${Math.round(r.co2ppm)} ppm · +${r.warmingC.toFixed(1)}°C` +
      `${r.eraBranch ? ` · <b>${r.eraBranch.toUpperCase()}</b>` : ` (→ +${r.projectedWarming().toFixed(1)}°C by 2100)`}` +
      (r.geoDeployed ? ` · <span style="color:#4cf" title="Stratospheric aerosols active — warming suppressed for two years">aerosols active</span>` : '') +
      `</p>` +
      (r.agriClimateMult() < 1
        ? `<p class="insp-skills" title="Heat stress, shifting seasons, and water stress on cash crops erode the farm economy past +${AGRI_CLIMATE_THRESHOLD}°C (GDD §8.2). Cut emissions to ease it.">🌾 farm output −${Math.round((1 - r.agriClimateMult()) * 100)}% to climate</p>`
        : '') +
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
      (r.hasCentralBank()
        ? `<p class="insp-skills">CENTRAL BANK</p><p style="font-size:10px;color:#9be3b6">Monetary policy, bonds, FX and the discount window live in the dedicated <b>Central Bank</b> window — open it with <b>B</b> or the B:bank button above.</p>`
        : '') +
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
    this.setInnerHtml(
      this.statePanel,
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
      (r.hasCentralBank()
        ? ` <button class="mini" id="centralbank-toggle" title="Central Bank — monetary policy, bonds, FX (B)" style="background:#2d4a3a;color:#9be3b6">${this.centralBankOpen ? '▲' : '▼'} B:bank</button>`
        : '') +
      `</p>` +
      tabStrip +
      // Pre-statehood the lone Finance section is always shown (no tabs to hide
      // behind a stale statePanelTab); post-statehood it's a real tab.
      (preState
        ? `<div class="pal-section" data-psection="finance">${financeBody}</div>`
        : sec('finance', financeBody)) +
      // Politics & Diplomacy are nation-tier — only once the State is proclaimed.
      (preState ? '' : sec('politics', politicsBody)) +
      (preState ? '' : sec('diplomacy', this.diplomacyHtml())),
    );

    this.wireTabs(this.statePanel, (t) => { this.statePanelTab = t as 'finance' | 'politics' | 'diplomacy'; });
    this.wireTabs(this.statePanel, (t) => { this.financeSubTab = t as 'treasury' | 'credit'; }, 'pal-subtab', 'pal-subsection');
    this.statePanel.querySelector<HTMLInputElement>('#tax-slider')!.oninput = (e) => {
      r.taxRate = Number((e.target as HTMLInputElement).value) / 100;
      const taxVal = this.statePanel.querySelector<HTMLElement>('#tax-val');
      if (taxVal) taxVal.textContent = `${Math.round(r.taxRate * 100)}%`;
    };
    // Monetary controls (policy rate, regime, bonds, currency, discount window)
    // now live in the dedicated Central Bank window — see wireCentralBankPanel().
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
    this.statePanel.querySelector<HTMLButtonElement>('#centralbank-toggle')?.addEventListener('click', () => {
      this.centralBankOpen = !this.centralBankOpen; forceRebuild();
    });
    this.statePanel.querySelector<HTMLButtonElement>('#convention-btn')?.addEventListener('click', () => {
      this.conventionOpen = true;
    });
    for (const btn of this.statePanel.querySelectorAll<HTMLButtonElement>('.law-btn')) {
      btn.onclick = () => r.enactLaw(btn.dataset.id!);
    }
    // Phase 18: dismiss advisor briefs
    this.statePanel.querySelector<HTMLButtonElement>('#dismiss-briefs-btn')?.addEventListener('click', () => {
      r.dismissAdvisorBriefs();
    });
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
    // Discount-window wiring moved to wireCentralBankPanel().
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
    for (const btn of this.statePanel.querySelectorAll<HTMLButtonElement>('.dip-preset-btn')) {
      btn.onclick = () => this.proposePresetDeal(Number(btn.dataset.rival), btn.dataset.preset!);
    }
    for (const btn of this.statePanel.querySelectorAll<HTMLButtonElement>('.dip-counter-sign-btn')) {
      btn.onclick = () => r.acceptCounter(Number(btn.dataset.rival));
    }
    for (const btn of this.statePanel.querySelectorAll<HTMLButtonElement>('.dip-counter-decline-btn')) {
      btn.onclick = () => r.declineCounter(Number(btn.dataset.rival));
    }
    // Espionage verbs (GDD §5.5)
    for (const btn of this.statePanel.querySelectorAll<HTMLButtonElement>('.dip-spy-btn')) {
      btn.onclick = () => {
        r.runEspionage(Number(btn.dataset.rival), btn.dataset.op as EspionageOp);
        this.lastStatePanelBuildFrame = -999; // refresh intel meter + cooldowns
      };
    }
    // Trade bloc verbs (GDD §6.5)
    this.statePanel.querySelector<HTMLButtonElement>('#bloc-form-btn')?.addEventListener('click', () => {
      r.formTradeBloc();
      this.lastStatePanelBuildFrame = -999;
    });
    this.statePanel.querySelector<HTMLButtonElement>('#bloc-leave-btn')?.addEventListener('click', () => {
      r.leaveTradeBloc();
      this.lastStatePanelBuildFrame = -999;
    });
    for (const btn of this.statePanel.querySelectorAll<HTMLButtonElement>('.bloc-invite-btn')) {
      btn.onclick = () => {
        r.inviteToBloc(Number(btn.dataset.rival));
        this.lastStatePanelBuildFrame = -999;
      };
    }
    this.statePanel.querySelector<HTMLInputElement>('#bloc-tariff')?.addEventListener('input', (e) => {
      r.setBlocTariff(Number((e.target as HTMLInputElement).value) / 100);
    });
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
    this.statePanel.querySelector<HTMLButtonElement>('#war-recruit-btn')?.addEventListener('click', () => {
      this.showRecruitmentModal();
    });
    this.statePanel.querySelector<HTMLButtonElement>('#claim-land-toggle')?.addEventListener('click', () => {
      this.claimLandMode = !this.claimLandMode;
      this.lastStatePanelBuildFrame = -999; // force rebuild
    });
    this.statePanel.querySelector<HTMLButtonElement>('#province-view-toggle')?.addEventListener('click', () => {
      this.toggleProvinceView();
    });
    for (const btn of this.statePanel.querySelectorAll<HTMLButtonElement>('.dip-sanction-btn')) {
      btn.onclick = () => r.sanctionAccordDefector(Number(btn.dataset.rival));
    }
    // Phase 6: economic sanctions
    for (const btn of this.statePanel.querySelectorAll<HTMLButtonElement>('.sanction-impose-btn')) {
      btn.onclick = () => {
        r.imposeSanction(Number(btn.dataset.rival));
        this.lastStatePanelBuildFrame = -999;
      };
    }
    for (const btn of this.statePanel.querySelectorAll<HTMLButtonElement>('.sanction-lift-btn')) {
      btn.onclick = () => {
        r.liftSanction(Number(btn.dataset.rival));
        this.lastStatePanelBuildFrame = -999;
      };
    }
    // Depression recovery crossroads
    for (const btn of this.statePanel.querySelectorAll<HTMLButtonElement>('.recovery-btn')) {
      btn.onclick = () => {
        r.chooseRecoveryPath(btn.dataset.choice as 'stimulus' | 'austerity');
        this.lastStatePanelBuildFrame = -999;
      };
    }
    // Depression emergency measures (QE, leave gold, public works)
    for (const btn of this.statePanel.querySelectorAll<HTMLButtonElement>('.dep-measure-btn')) {
      btn.onclick = () => {
        r.enactDepressionMeasure(btn.dataset.measure as DepressionMeasure);
        this.lastStatePanelBuildFrame = -999;
      };
    }
    // Phase 12: Media & Press actions
    this.statePanel.querySelector<HTMLButtonElement>('#media-censor')?.addEventListener('click', () => {
      r.censorMedia();
      this.lastStatePanelBuildFrame = -999;
    });
    this.statePanel.querySelector<HTMLButtonElement>('#media-liberalise')?.addEventListener('click', () => {
      r.grantPressLicense();
      this.lastStatePanelBuildFrame = -999;
    });
    this.statePanel.querySelector<HTMLButtonElement>('#media-platform-reg')?.addEventListener('click', () => {
      r.enactPlatformRegulation();
      this.lastStatePanelBuildFrame = -999;
    });
    this.statePanel.querySelector<HTMLButtonElement>('#media-public-media')?.addEventListener('click', () => {
      r.fundPublicMedia();
      this.lastStatePanelBuildFrame = -999;
    });
    this.statePanel.querySelector<HTMLButtonElement>('#media-literacy')?.addEventListener('click', () => {
      r.investMediaLiteracy();
      this.lastStatePanelBuildFrame = -999;
    });
    // Phase 13: Protest response buttons
    this.statePanel.querySelector<HTMLButtonElement>('.unrest-crackdown-btn')?.addEventListener('click', () => {
      r.crackdownProtests();
      this.lastStatePanelBuildFrame = -999;
    });
    this.statePanel.querySelector<HTMLButtonElement>('.unrest-concede-btn')?.addEventListener('click', () => {
      r.concedeToProtesters();
      this.lastStatePanelBuildFrame = -999;
    });
  }

  /** Diplomacy section (GDD §5.4): the rival ledger, treaties, and verbs. */
  private diplomacyHtml(): string {
    const r = this.region;
    // Province view toggle (always available when state is proclaimed)
    const provinceToggleHtml = r.stateProclaimed
      ? `<p class="insp-skills">MAP OVERLAYS</p>` +
        `<p><button id="province-view-toggle" class="mini" style="${this.provinceViewActive ? 'background:#7ab4d4;color:#000' : ''}" ` +
        `title="Toggle Province View (P): shows province names, population and GDP on the map">` +
        `${this.provinceViewActive ? '✓ PROVINCE VIEW ON' : 'Province View (P)'}</button></p>`
      : '';
    // Territorial expansion section
    const claimLandHtml = r.stateProclaimed
      ? `<p class="insp-skills">TERRITORIAL EXPANSION</p>` +
        `<p><button id="claim-land-toggle" class="mini" style="${this.claimLandMode ? 'background:#8fc26a;color:#000' : ''}" ` +
        `title="Click to activate land claim mode, then click on unclaimed hexes adjacent to your territory (£25/cell)">` +
        `${this.claimLandMode ? '✓ CLAIM LAND MODE' : 'Claim Unclaimed Land'}</button></p>`
      : '';

    if (r.rivals.length === 0) return provinceToggleHtml + claimLandHtml;
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
          this.quickDealButtons(rv.id) + ` ` +
          proposals + warBtn + `</p>`;
      // Espionage (GDD §5.5): the covert verbs, gated by intel + treasury + cooldown.
      const intel = r.intelOf(rv.id);
      const intelPct = Math.round(intel * 100);
      const espBtns = (Object.keys(ESPIONAGE_OPS) as EspionageOp[]).map((op) => {
        const def = ESPIONAGE_OPS[op];
        const can = r.canRunEspionage(rv.id, op);
        return `<button class="mini dip-spy-btn" data-rival="${rv.id}" data-op="${op}" ${can.ok ? '' : 'disabled'} ` +
          `title="${def.desc}\n\n${can.reason}">${def.short}</button>`;
      }).join(' ');
      const espionage = r.stateProclaimed
        ? `<p class="insp-skills" title="Your intelligence penetration of ${rv.name}. Higher intel raises success and lowers exposure.">` +
          `🕵 intel ${intelPct}% ` +
          `<span class="bar" style="display:inline-block;width:60px;vertical-align:middle"><span class="bar-fill" style="width:${intelPct}%;background:#9a7fd4"></span></span></p>` +
          `<p>${espBtns}</p>`
        : '';
      // Show richer personality information
      const profile = r.rivalProfile(rv.id);
      const personalityInfo = profile
        ? `${profile.traits.join(', ')} — ${profile.approximateStrength} (${profile.comparison})`
        : '';
      const flagHtml = rv.flagData
        ? `<span style="display:inline-block;width:16px;height:12px;background:linear-gradient(90deg, ${rv.flagData.primary} 50%, ${rv.flagData.secondary} 50%);border:1px solid #888;margin-right:6px;vertical-align:middle;border-radius:2px" title="${rv.flagData.symbol}"></span>`
        : '';
      const emblemHtml = rv.flagData ? `${rv.flagData.emblem}&nbsp;` : '';
      const archetypeData = RIVAL_ARCHETYPES[rv.archetype];
      const archetypeTooltip = `${archetypeData.name}: ${archetypeData.desc}`;
      // Their true agenda is only legible once you have penetrated them (intel ≥ 0.5);
      // until then espionage is the way to read what they are really after (GDD §5.5).
      const agendaShown = r.intelOf(rv.id) >= 0.5 ? rv.agenda : 'unknown — gather intelligence to read it';
      // War minister estimates rival military strength (Phase 8 advisor forecast)
      const trueRivalStrength = rv.pop;
      const estStrength = Math.round(r.advisorForecast('War', trueRivalStrength));
      const defMin = r.ministerFor('defence');
      const defAdvisorName = defMin ? defMin.name : 'Defence HQ';
      const rivalIntel = r.nationProclaimed
        ? `<p class="insp-skills" title="Your war minister's estimate of ${rv.name}'s military strength — accuracy depends on their skill.">` +
          `${defAdvisorName} estimates ${rv.name} strength: <b>${estStrength}</b></p>`
        : '';
      return `<div class="bar-row" title="${archetypeTooltip}\n\nAgenda: ${agendaShown}\n\n${personalityInfo}">` +
        `${flagHtml}<span style="width:70px;display:inline-block">${emblemHtml}<b>${rv.name}</b></span>` +
        `<div class="bar" style="flex:1"><div class="bar-fill" style="width:${pct}%;background:${col}"></div></div>` +
        `<span>${rel}</span></div>` +
        `<p class="insp-skills" title="${recentHistory}">${gov}${rv.borderSettled ? ' · border settled' : ''} · ${personalityInfo}${personalityInfo ? ' · ' : ''}${treaties}</p>` +
        offerRow + counterRow +
        verbs + espionage + rivalIntel;
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
    return provinceToggleHtml + claimLandHtml + `<p class="insp-skills">DIPLOMACY (relations −100..+100)</p>` + this.warHtml() + boom + exports + this.tradeBlocHtml() + this.sanctionsHtml() + this.rivalBlocsHtml() + rows + world;
  }

  /** Trade bloc panel (GDD §6.5): found, grow, tune, or dissolve the economic union. */
  private tradeBlocHtml(): string {
    const r = this.region;
    if (!r.stateProclaimed) return '';
    const bloc = r.playerTradeBloc();
    if (!bloc) {
      const can = r.canFormTradeBloc();
      return `<p class="insp-skills">TRADE BLOC</p>` +
        `<p><button class="mini" id="bloc-form-btn" ${can.ok ? '' : 'disabled'} ` +
        `title="A multi-member economic union. Members must hold a trade agreement and relations ≥ ${BLOC_RELATIONS_FLOOR}.\n\n${can.reason}">` +
        `Found Trade Bloc</button></p>`;
    }
    const members = bloc.memberRivalIds.map((id) => r.rival(id)?.name).filter(Boolean).join(', ') || 'none';
    const invitees = r.blocEligibleRivals().filter((rv) => !bloc.memberRivalIds.includes(rv.id));
    const inviteBtns = invitees
      .map((rv) => `<button class="mini bloc-invite-btn" data-rival="${rv.id}" title="Admit ${rv.name} to the bloc">+ ${rv.name}</button>`)
      .join(' ');
    const tariffPct = Math.round(bloc.sharedTariff * 100);
    return `<p class="insp-skills">TRADE BLOC — ${bloc.name}</p>` +
      `<p>members: <b>${members}</b> · est. ${bloc.foundedYear}</p>` +
      `<p>bloc trade bonus <b>${formatCurrency(Math.floor(r.blocTradeBonus()))}/mo</b></p>` +
      `<p>shared tariff ${tariffPct}% ` +
      `<input type="range" id="bloc-tariff" min="0" max="50" value="${tariffPct}" style="width:90px;vertical-align:middle"></p>` +
      (inviteBtns ? `<p>${inviteBtns}</p>` : '') +
      `<p><button class="mini" id="bloc-leave-btn" title="Dissolve the union">Dissolve Bloc</button></p>`;
  }

  /** Phase 6: Sanctions panel — show active sanctions, impose/lift controls. */
  private sanctionsHtml(): string {
    const r = this.region;
    if (!r.stateProclaimed) return '';
    const active = r.activeSanctions();
    if (active.length === 0 && r.rivals.length === 0) return '';
    const onPlayer = active.filter((s) => s.targetId === 0);
    const byPlayer = active.filter((s) => s.imposerId === 0);
    const header = `<p class="insp-skills">ECONOMIC SANCTIONS</p>`;
    const suffering = onPlayer.length > 0
      ? onPlayer.map((s) => {
          const rv = r.rival(s.imposerId);
          const pct = Math.round(s.tradeReduction * 100);
          return `<p style="font-size:0.82em;color:#e05050">⚠ ${rv?.name ?? '?'} sanctions: −${pct}% trade</p>`;
        }).join('')
      : '';
    const imposed = byPlayer.length > 0
      ? byPlayer.map((s) => {
          const rv = r.rival(s.targetId);
          const pct = Math.round(s.tradeReduction * 100);
          return `<p style="font-size:0.82em;color:#c2a14d">↯ ${rv?.name ?? '?'} sanctioned (−${pct}%) ` +
            `<button class="mini sanction-lift-btn" data-rival="${s.targetId}">lift</button></p>`;
        }).join('')
      : '';
    // Impose-sanction buttons for hostile rivals not already sanctioned
    const imposable = r.rivals.filter((rv) =>
      rv.relations < -20 &&
      !byPlayer.some((s) => s.targetId === rv.id),
    );
    const imposeBtns = imposable.length > 0
      ? `<p>${imposable.map((rv) =>
          `<button class="mini sanction-impose-btn" data-rival="${rv.id}" title="Impose trade sanctions on ${rv.name} (−40% bilateral trade, −10 relations)">⛔ sanction ${rv.name}</button>`
        ).join(' ')}</p>`
      : '';
    if (!suffering && !imposed && !imposeBtns) return '';
    return header + suffering + imposed + imposeBtns;
  }

  /** Phase 6: Rival trade blocs panel — show rival blocs and their tariff impact. */
  private rivalBlocsHtml(): string {
    const r = this.region;
    const blocs = r.rivalTradeBlocs.filter((b) => b.memberRivalIds.filter((id) => r.rival(id)).length >= 2);
    if (blocs.length === 0) return '';
    const friction = r.rivalBlocTariffFriction();
    const rows = blocs.map((b) => {
      const members = b.memberRivalIds.map((id) => r.rival(id)?.name).filter(Boolean).join(' · ');
      const tariffPct = Math.round(b.tariff * 100);
      return `<p style="font-size:0.82em;color:#a8b4c4">${members} (${tariffPct}% external tariff, est. ${b.foundedYear})</p>`;
    }).join('');
    return `<p class="insp-skills">RIVAL TRADE BLOCS${friction > 0 ? ` — trade friction −${Math.round(friction * 100)}%` : ''}</p>` + rows;
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
      this.militaryUnitsHtml(w) +
      sides +
      `<p>${mobBtns} ${blockadeBtn}</p>` +
      (callBtns ? `<p>${callBtns}</p>` : '') +
      occ +
      `<p>${termBtns}</p>` +
      `<p>${offerBtn} <button class="mini war-capitulate-btn" title="End the war on their terms — reparations and a stripped treasury">capitulate</button></p>`;
  }

  /** Military units display and recruitment (GDD §7.1). */
  private militaryUnitsHtml(w: any): string {
    const unitLines = w.units.length > 0
      ? `<p class="insp-skills">UNITS: ${w.units.map((u: any) => `${u.count} ${u.type} (morale ${Math.round(u.morale)})`).join(' · ')}</p>`
      : `<p class="insp-skills">no units recruited yet</p>`;
    const supplyStatus = w.supplyReserve > 2 ? `<span style="color:#4e9">✓</span>` : w.supplyReserve > 1 ? `<span style="color:#ca4">⚠</span>` : `<span style="color:#e55">✗</span>`;
    const supplyLine = `<span style="display:inline-block;width:140px">supply ${supplyStatus} ${Math.round(w.supplyReserve * 10) / 10}mo</span>`;
    const recruitBtn = `<button class="mini war-recruit-btn" id="war-recruit-btn">recruit</button>`;
    return unitLines + `<p>${supplyLine} ${recruitBtn}</p>`;
  }

  /** Show recruitment modal for unit types (GDD §7.1). */
  private showRecruitmentModal(): void {
    const r = this.region;
    const w = r.playerWar;
    if (!w) return;
    const types: ArmyUnitType[] = ['militia', 'cavalry', 'artillery'];
    const rows = types.map((t) => {
      const def = UNIT_TYPES[t];
      return `<p><b>${t}</b> — £${def.recruitCost}/unit · power ${def.powerPerUnit} · ${def.trainingDays}d training · ${def.supplyCost}/day supply
        <input type="number" min="1" max="100" value="5" id="recruit-${t}-count" style="width:50px">
        <button class="mini" id="recruit-${t}-btn">recruit</button></p>`;
    }).join('');
    this.recruitmentModal.innerHTML = `<div class="ceremony-content"><h2>Recruit Army Units</h2><p>Treasury: <b>${formatCurrency(r.treasury)}</b></p>${rows}<button id="recruit-close-btn">Done</button></div>`;
    this.recruitmentModal.classList.remove('hidden');
    this.recruitmentModal.querySelector<HTMLButtonElement>('#recruit-close-btn')!.onclick = () => {
      this.recruitmentModal.classList.add('hidden');
    };
    for (const t of types) {
      this.recruitmentModal.querySelector<HTMLButtonElement>(`#recruit-${t}-btn`)!.onclick = () => {
        const count = parseInt(this.recruitmentModal.querySelector<HTMLInputElement>(`#recruit-${t}-count`)!.value) || 0;
        r.recruitUnits(t, count);
        this.showRecruitmentModal(); // refresh modal
      };
    }
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
      (r.passedLaws.size > 0 ? `<p class="insp-skills">all available laws enacted</p>` : '');
    const enacted = r.passedLaws.size > 0
      ? `<p class="insp-skills">enacted: ${Array.from(r.passedLaws).map((id) => REGION_LAWS.find((l) => l.id === id)?.name ?? id).join(', ')}</p>`
      : '';

    // Phase 13: Unrest ladder indicator
    const unrestHtml = r.unrestLadderHtml();

    // Phase 13: Protest action buttons (only at rung 3)
    const protestActions = r.unrestLevel === 3
      ? `<div style="margin:4px 0"><button class="mini unrest-crackdown-btn">Crackdown</button> ` +
        `<button class="mini unrest-concede-btn">Concede (2% GDP)</button></div>`
      : '';

    return `<p class="insp-skills">POLITICS</p>` +
      `<p>political capital: <b>${r.politicalCapital} PC</b></p>` +
      electionLine +
      unrestHtml +
      protestActions +
      `<p class="insp-skills">FACTIONS (support bar)</p>` +
      factionBars +
      lawButtons +
      enacted +
      this.mediaPressSectionHtml();
  }

  /** Media & Press sub-section within the Politics tab (GDD §8.3, Phase 12). */
  mediaPressSectionHtml(): string {
    const r = this.region;
    const reachLabel: Record<string, string> = {
      word_of_mouth: 'Word of Mouth',
      press: 'Press',
      radio: 'Radio',
      television: 'Television',
      internet: 'Internet',
      algorithmic: 'Algorithmic',
    };

    const bar = (val: number, max: number, col: string) => {
      const pct = Math.round((val / max) * 100);
      const filled = Math.round(pct / 10);
      const empty = 10 - filled;
      return `<span style="color:${col}">${'█'.repeat(filled)}${'░'.repeat(empty)}</span> ${Math.round(val)}`;
    };

    const pfPct = Math.round(r.pressFreedom);
    const pfCol = r.pressFreedom >= 65 ? '#4e9' : r.pressFreedom <= 35 ? '#e55' : '#ca4';
    const cgPct = Math.round(r.credibilityGap);
    const cgCol = cgPct >= 60 ? '#e55' : cgPct >= 30 ? '#ca4' : '#4e9';
    const polPct = (r.polarization * 100).toFixed(0);

    const canCensor = r.stateProclaimed && r.politicalCapital >= 15;
    const canLiberalise = r.stateProclaimed && r.politicalCapital >= 15;
    const canPlatformReg = !r.platformRegulationEnacted && r.has('digital_economy') && r.politicalCapital >= 20;
    const canPublicMedia = !r.publicMediaFunded && r.stateProclaimed && r.politicalCapital >= 25;
    const canMediaLiteracy = !r.mediaLiteracyInvested && r.treasury >= r.gdpLastMonth * 0.05;

    const misEraLine = r.misinformationEra
      ? `<p style="color:#e07a30;font-size:10px">Algorithmic misinformation era active</p>`
      : '';
    const criticalGap = r.credibilityGap > 60
      ? `<p style="color:#e55;font-size:10px">&#9888; Credibility gap critical — legitimacy collapse risk</p>`
      : '';

    const countersHtml = r.misinformationEra ? (
      `<p class="insp-skills" style="font-size:10px">COUNTER-MEASURES</p>` +
      `<p>` +
      `<button class="mini" id="media-platform-reg" ${canPlatformReg ? '' : 'disabled'} title="Reduces polarization growth 0.005/month. Requires Digital Economy tech (20 PC).">` +
        `Platform Regulation${r.platformRegulationEnacted ? ' ✓' : ' [20 PC]'}` +
      `</button> ` +
      `<button class="mini" id="media-public-media" ${canPublicMedia ? '' : 'disabled'} title="Credibility gap decays 2x faster. 0.8% GDP/month upkeep (25 PC).">` +
        `Public Media${r.publicMediaFunded ? ' ✓' : ' [25 PC]'}` +
      `</button>` +
      `</p>` +
      `<p>` +
      `<button class="mini" id="media-literacy" ${canMediaLiteracy ? '' : 'disabled'} title="Polarization -0.15 after 15-year lag. Costs 5% GDP upfront.">` +
        `Media Literacy${r.mediaLiteracyInvested ? (r.mediaLiteracyApplied ? ' ✓' : ` (${r.mediaLiteracyYear + 15})`) : ' [5% GDP]'}` +
      `</button>` +
      `</p>`
    ) : '';

    return `<p class="insp-skills">MEDIA &amp; PRESS</p>` +
      `<p style="font-size:10px">Media Reach: <b>${reachLabel[r.mediaReach] ?? r.mediaReach}</b> · Era: ${r.year}</p>` +
      misEraLine +
      `<div class="bar-row" title="Press Freedom: above 65 = free press, below 35 = controlled">` +
        `<span style="width:80px;display:inline-block;font-size:10px">Press Freedom</span>` +
        `<span style="font-size:10px">${bar(pfPct, 100, pfCol)}</span>` +
      `</div>` +
      `<p>` +
        `<button class="mini" id="media-censor" ${canCensor ? '' : 'disabled'} title="−20 press freedom (15 PC). Merchants −10, Landowners +10.">Censor −20</button> ` +
        `<button class="mini" id="media-liberalise" ${canLiberalise ? '' : 'disabled'} title="+20 press freedom (15 PC). Merchants +5.">Liberalise +20</button>` +
      `</p>` +
      `<div class="bar-row" title="Credibility Gap: high values risk a legitimacy collapse when a crisis hits">` +
        `<span style="width:80px;display:inline-block;font-size:10px">Cred. Gap</span>` +
        `<span style="font-size:10px">${bar(cgPct, 100, cgCol)}</span>` +
      `</div>` +
      criticalGap +
      `<p style="font-size:10px">Polarization: <b>${polPct}%</b>${r.misinformationEra ? ` · Opinion vel: ×${r.opinionVelocity().toFixed(1)}` : ''}</p>` +
      countersHtml;
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
      this.depressionResponseHtml() +
      `<div class="bar-row" title="Legitimacy — the regime's right to rule (GDD §5.3)">` +
      `<span style="width:80px;display:inline-block">legitimacy</span>` +
      legBar + `<span>${legPct}</span></div>` +
      `<p class="insp-skills">CABINET</p>` +
      `<p>${ministerLines}</p>` +
      `<p class="insp-skills">POLICY SLOTS</p>` +
      policyRows +
      this.advisorBriefsHtml();
  }

  /** Phase 18: Render the advisor briefs panel (GDD §8.7). */
  advisorBriefsHtml(): string {
    const r = this.region;
    if (!r.nationProclaimed || r.advisorBriefs.length === 0) return '';
    const rows = r.advisorBriefs.map((brief) => {
      const date = `${Math.floor(brief.day / 365) + 1900}`;
      return `<p class="insp-skills" style="margin:2px 0"><b>[${brief.portfolio}]</b> ${brief.message} <span style="opacity:0.6">(${date})</span></p>`;
    }).join('');
    return `<p class="insp-skills">ADVISOR BRIEFS</p>` +
      `<div style="background:#1a1a2e;border:1px solid #444;padding:4px 6px;max-height:120px;overflow-y:auto;font-size:10px">` +
      rows +
      `</div>` +
      `<p><button class="mini" id="dismiss-briefs-btn">Dismiss all</button></p>`;
  }

  /** Depression-response panel: a depth meter, the emergency toolkit (available
   *  from the first month of the slump), and the month-12 recovery crossroads.
   *  Renders only while a depression is active. */
  private depressionResponseHtml(): string {
    const r = this.region;
    if (r.depressionDepth <= 0.01 && r.crashRecoveryChoice !== 'pending') return '';
    const depthPct = Math.round(r.depressionDepth * 100);
    // Depth meter colour: deep red while severe, warming to amber as it lifts.
    const depthCol = depthPct > 60 ? '#e0563b' : depthPct > 30 ? '#e0913b' : '#d4b54a';
    const pathLabel = r.crashRecoveryChoice === 'stimulus' ? 'Stimulus'
      : r.crashRecoveryChoice === 'austerity' ? 'Austerity'
      : r.crashRecoveryChoice === 'pending' ? 'choosing…'
      : 'not yet chosen';

    // The month-12 strategic fork — only while the choice is live.
    const crossroads = r.crashRecoveryChoice === 'pending'
      ? `<p class="cb-subhead">▲ RECOVERY CROSSROADS — choose the road out</p>` +
        `<div class="dep-measures">` +
        `<button class="dep-choice-btn stimulus recovery-btn" data-choice="stimulus" ` +
        `title="Deficit spending and public works restart the engine faster — but cost the treasury £8/month for two years.">` +
        `<b>Stimulus</b><span>spend now · faster recovery · £8/mo × 24</span></button>` +
        `<button class="dep-choice-btn austerity recovery-btn" data-choice="austerity" ` +
        `title="Balance the budget: services are cut and recovery is slower, but the treasury is preserved.">` +
        `<b>Austerity</b><span>balance books · slower · services cut</span></button>` +
        `</div>`
      : '';

    // The emergency toolkit — usable once each, from the first month of the slump.
    const tooDeepDone = r.depressionDepth <= 0.05;
    const measures = DEPRESSION_MEASURES.map((m) => {
      const used = r.depressionMeasuresUsed.includes(m.id);
      let blocked = false;
      let note = m.effect;
      if (used) {
        note = 'enacted ✓';
      } else if (m.id === 'qe' && !r.passedLaws.has('central_bank_charter')) {
        blocked = true;
        note = 'needs Central Bank Charter';
      } else if (m.id === 'publicworks') {
        const cost = Math.round(r.gdpLastMonth * 0.5 + 60);
        if (r.treasury < cost) {
          blocked = true;
          note = `needs ${formatCurrency(cost)} in treasury`;
        }
      }
      const disabled = used || blocked || tooDeepDone;
      return `<button class="dep-measure-btn${used ? ' used' : ''}" data-measure="${m.id}" ` +
        `${disabled ? 'disabled' : ''} title="${m.blurb} (${m.effect})">` +
        `<b>${m.title}</b><span>${note}</span></button>`;
    }).join('');

    return `<div class="crisis-banner">` +
      `<p class="cb-title">⚠ GREAT DEPRESSION</p>` +
      `<div class="depth-meter" title="Depression depth — drives export collapse and caps confidence recovery. It decays ~5%/month; emergency measures cut it faster.">` +
      `<div class="depth-meter-fill" style="width:${Math.max(4, depthPct)}%;background:${depthCol}"></div>` +
      `<span class="depth-meter-label">depth ${depthPct}%</span></div>` +
      `<p class="cb-status">recovery path: <b>${pathLabel}</b></p>` +
      crossroads +
      `<p class="cb-subhead">EMERGENCY MEASURES</p>` +
      `<div class="dep-measures">${measures}</div>` +
      `</div>`;
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
    // §6.3: flag an embattled rival (fighting a foreign war) — keener on protection/trade.
    const embattled = r.rivalSituation(rv) > 0 ? ' ⚔ At war abroad — keener to deal.' : '';
    if (v.accept) return `✓ Their envoy nods — ${ledger}. They would sign.${embattled}`;
    if (v.counter) return `± Close: ${ledger}. They would counter, asking ` + formatCurrency(v.counter.goldToThem - this.dealGoldToThem) + ` more.${embattled}`;
    return `✗ ${ledger}. They would walk — "${v.reason}."${embattled}`;
  }

  /** Forecast relations impact after deal (GDD §6.3 advanced UI). */
  private relationsForecast(): string {
    const r = this.region;
    const rv = r.rival(this.dealRivalId);
    if (!rv) return '';
    // ponytail: rough estimate based on deal value; exact calc happens if they sign
    const v = r.evaluateDeal(rv, this.currentBasket());
    if (!v.accept) return '';
    const relChange = Math.round(Math.min(20, v.get / 5));
    const newRel = Math.min(100, Math.round(rv.relations) + relChange);
    const trend = newRel >= 25 ? '↗ friendly' : newRel >= -25 ? '→ neutral' : '↘ hostile';
    return `<p class="insp-skills">Forecast: relations ${Math.round(rv.relations)} → ${newRel} (${trend})</p>`;
  }

  /** Quick preset deals for faster diplomacy (GDD §6.3 advanced UI). */
  private quickDealButtons(rivalId: number): string {
    const r = this.region;
    const rv = r.rival(rivalId);
    if (!rv) return '';
    // ponytail: preset deals are templates, not game mechanics — just compose the basket faster
    const presets = [
      { name: '🤝 NAP', treaties: ['non_aggression'] as TreatyKind[], gold: 0 },
      { name: '🤝 Trade', treaties: ['trade_agreement'] as TreatyKind[], gold: 0 },
      { name: '🛡️ Pact', treaties: ['defensive_pact'] as TreatyKind[], gold: 0 },
    ];
    return presets.map((p) => {
      const hasAll = p.treaties.every((t) => rv.treaties.includes(t));
      return `<button class="mini dip-preset-btn" data-rival="${rivalId}" data-preset="${p.name}" ${hasAll ? 'disabled' : ''} ` +
        `title="Quick propose: ${p.treaties.map((t) => TREATY_DEFS[t].name).join(' + ')}">${p.name}</button>`;
    }).join(' ');
  }

  /** Propose a preset deal basket (GDD §6.3). */
  private proposePresetDeal(rivalId: number, presetName: string): void {
    const r = this.region;
    const presets: Record<string, { treaties: TreatyKind[]; gold: number }> = {
      '🤝 NAP': { treaties: ['non_aggression'], gold: 0 },
      '🤝 Trade': { treaties: ['trade_agreement'], gold: 0 },
      '🛡️ Pact': { treaties: ['defensive_pact'], gold: 0 },
    };
    const p = presets[presetName];
    if (!p) return;
    const basket: DealBasket = { treaties: p.treaties, goldToThem: p.gold, goldToYou: 0, borderSettlement: false };
    r.proposeDeal(rivalId, basket);
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
      `<div class="deal-forecast">${this.relationsForecast()}</div>` +
      `<p><button id="deal-propose-btn" ${r.treasury >= this.dealGoldToThem ? '' : 'disabled'}>Put it on the table</button> ` +
      `<button id="deal-cancel-btn" class="mini">Withdraw</button></p>` +
      `</div>`;
    this.dealModal.classList.remove('hidden');

    const refreshVerdict = () => {
      this.dealModal.querySelector('#deal-verdict')!.textContent = this.dealVerdictLine();
      const forecastEl = this.dealModal.querySelector('.deal-forecast');
      if (forecastEl) forecastEl.innerHTML = this.relationsForecast();
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
    if (!r.hasCentralBank()) return '';
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
      this.currencyHtml() +
      this.financeAdvisorHtml();
  }

  /** Phase 18: Finance advisor forecast with skill-based noise (GDD §8.7). */
  private financeAdvisorHtml(): string {
    const r = this.region;
    if (!r.nationProclaimed) return '';
    // Project next year's treasury based on current GDP and tax rate
    const annualRevenue = r.gdpLastMonth * r.taxRate * 12;
    const annualSpending = r.totalPop() * 0.05 * r.servicesLevel * 12 +
      r.totalPop() * 0.03 * r.militiaLevel * 12 +
      r.settlements.length * 5 * 12;
    const projectedTreasury = r.treasury + annualRevenue - annualSpending;
    const advisorEst = r.advisorForecast('Finance', projectedTreasury);
    const sym = r.currencySymbol;
    const col = advisorEst > r.treasury ? '#4e9' : '#e55';
    return `<p class="insp-skills" title="Finance advisor estimate for next year's treasury (skill-based noise — higher-skill ministers give more accurate forecasts).">` +
      `Finance advisor: <span style="color:${col}">${sym}${Math.round(advisorEst).toLocaleString()}</span> est. next year</p>`;
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
    if (!r.hasCentralBank()) return '';
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
    const hasCbCharter = r.hasCentralBank();
    if (!hasMarket && !hasBank && !hasCbCharter) return '';

    let html = `<p class="insp-skills">LENDERS</p>`;

    // Show available lenders
    if (r.lenders.length > 0) {
      const rateNote = r.hasCentralBank()
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

  private updateTopBar(): void {
    if (this.frame - this.lastTopBarFrame < 8) return;
    this.lastTopBarFrame = this.frame;
    const r = this.region;
    // Calendar runs on the actual in-game era (1919→…), not a raw offset.
    const year = r.year;
    const month = r.monthName;
    const day = r.monthDay;

    const selected = r.settlements.find((s) => s.id === this.selectedId);
    const selPop = selected ? Math.floor(selected.cohorts.bands.reduce((a, b) => a + b, 0)) : 0;
    const nationPop = r.playerPop();

    const totalFood = r.totalFood;
    const totalWood = r.totalWood;

    // Overall happiness: pop-weighted satisfaction across the player's settlements.
    const happy = Math.round(r.avgSatisfaction());
    const happyCol = happy >= 60 ? '#6ad48a' : happy >= 40 ? '#d4b85a' : '#d46a6a';

    const treasury = formatCurrency(r.treasury);
    const w = window as any;
    const speed = w.gameSpeed || 1;
    const paused = w.gamePaused ? '⏸ PAUSED' : '';
    const speedLabel = speed === 1 ? '1×' : speed === 3 ? '3×' : speed === 8 ? '8×' : `${speed}×`;
    // Population cell shows the whole nation; if a settlement is selected, its
    // share is appended in parentheses so both numbers are visible at a glance.
    const popLabel = selected ? `${nationPop} (${selPop})` : `${nationPop}`;
    this.topBar.innerHTML = `
      <div class="tb-item tb-date">${month} ${day}, ${year}</div>
      <div class="tb-item tb-treasury">${treasury}</div>
      <div class="tb-item tb-resources">🌾 ${Math.floor(totalFood)} | 🪵 ${Math.floor(totalWood)}</div>
      <div class="tb-item tb-population" title="Total population of your settlements${selected ? ' (selected settlement in parentheses)' : ''}">👥 ${popLabel}</div>
      <div class="tb-item tb-happiness" title="Overall happiness — population-weighted satisfaction across your settlements"><span style="color:${happyCol}">☺ ${happy}%</span></div>
      <div class="tb-item tb-speed" style="margin-left: auto;">${paused} ${speedLabel}</div>
    `;
  }

  private updateEventLog(): void {
    const r = this.region;
    const logLen = r.log.length;
    if (logLen === this.lastEventLogLen && this.frame - this.lastEventLogFrame < 30) return;
    this.lastEventLogLen = logLen;
    this.lastEventLogFrame = this.frame;
    const last3 = r.log.slice(-3).reverse();
    const entries = last3.map((entry) => {
      const className = `log-entry log-${entry.kind}`;
      return `<div class="${className}">${entry.text}</div>`;
    }).join('');
    this.eventLog.innerHTML = entries || '<div class="log-entry log-info">No recent events</div>';
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
      // Enter click-to-found placement mode (valid sites highlight; click one to
      // send the expedition there). Re-clicking cancels.
      btn.onclick = () => { this.toggleFoundingMode(t.id); };
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
    const fp = this.panel.querySelector<HTMLButtonElement>('#floodproof-btn');
    if (fp) fp.onclick = () => { this.region.buildFloodProof(t.id); this.refreshPanel(); };
    const mr = this.panel.querySelector<HTMLButtonElement>('#retreat-btn');
    if (mr) mr.onclick = () => { this.region.doManagedRetreat(t.id); this.refreshPanel(); };
    const mil = this.panel.querySelector<HTMLButtonElement>('#militia-btn');
    if (mil) mil.onclick = () => { this.region.recruitMilitia(t.id); this.refreshPanel(); };
    for (const cb of this.panel.querySelectorAll<HTMLButtonElement>('.city-build-btn')) {
      // Spatial-4X: arm placement mode (pick a hex in the worked ring) instead of
      // building abstractly. Re-clicking the same building cancels.
      cb.onclick = () => { this.toggleBuildingPlacement(t.id, cb.dataset.b!); };
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
    const scoutBtn = this.panel.querySelector<HTMLButtonElement>('.scout-btn');
    if (scoutBtn) scoutBtn.onclick = () => { this.region.sendPlayerScout(t.id); this.refreshPanel(); };
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
    const atWar = r.playerRegionalWars.has(fid);

    // While at war, every enemy town is a target: list each with its assault odds.
    const assaultHtml = atWar
      ? `<hr><p class="insp-skills">CAMPAIGN — your field army <b>${Math.round(r.playerFieldArmy())}</b></p>` +
        faction.settlementIds.map((sid) => {
          const s = r.settlement(sid);
          if (!s) return '';
          const od = r.assaultOdds(sid);
          const pct = Math.round(od.odds * 100);
          return `<button class="mini danger assault-btn" data-sid="${sid}" ${od.ok ? '' : 'disabled'} ` +
            `title="${od.ok ? `your ${od.attack} vs garrison ${od.defense}` : od.reason}">` +
            `⚔ Assault ${s.name} (${pct}%)</button><br>`;
        }).join('')
      : '';

    this.setInnerHtml(
      this.rivalPanel,
      `<h3><span style="color:${faction.color}">■</span> ${faction.name}</h3>` +
      `<p class="insp-skills">${regimeName} · ${faction.regime}</p>` +
      (isVassal ? `<p style="color:#8fc26a">★ Vassal of your state</p>` : '') +
      (atWar ? `<p style="color:#e05050">⚔ AT WAR</p>` : '') +
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
      (!isVassal
        ? (atWar
          ? `<button id="rival-war-btn" class="mini">✦ Offer Ceasefire</button><br>`
          : `<button id="rival-war-btn" class="mini danger">⚔ Declare War</button><br>`)
        : '') +
      assaultHtml +
      `<button id="rival-close-btn" class="mini" style="margin-top:6px">Close</button>`,
    );

    this.rivalPanel.querySelector<HTMLButtonElement>('#rival-close-btn')!.onclick = () => {
      this.selectedFactionId = null;
    };
    const vassalBtn = this.rivalPanel.querySelector<HTMLButtonElement>('#rival-vassalize-btn');
    if (vassalBtn) {
      vassalBtn.onclick = () => {
        const result = r.offerVassalage(fid);
        if (result === 'accepted') {
          this.selectedFactionId = null;
        }
        this.lastRivalPanelFactionId = null;
      };
    }
    const buyBtn = this.rivalPanel.querySelector<HTMLButtonElement>('#rival-buy-land-btn');
    if (buyBtn) {
      buyBtn.onclick = () => {
        r.buyLand(fid);
        this.lastRivalPanelFactionId = null;
      };
    }
    const warBtn = this.rivalPanel.querySelector<HTMLButtonElement>('#rival-war-btn');
    if (warBtn) {
      warBtn.onclick = () => {
        if (r.playerRegionalWars.has(fid)) {
          r.makeRegionalPeace(fid);
        } else {
          r.declareWarOnFaction(fid);
        }
        this.lastRivalPanelFactionId = null;
      };
    }
    this.rivalPanel.querySelectorAll<HTMLButtonElement>('.assault-btn').forEach((btn) => {
      btn.onclick = () => {
        const sid = Number(btn.dataset.sid);
        r.assaultSettlement(sid);
        this.lastRivalPanelFactionId = null; // rebuild to refresh odds & ownership
      };
    });
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
      `drill militia (+${RegionSim.MILITIA_ADD}, ${formatCurrency(r.militiaCost())})</button>` +
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
    const manage = r.stateProclaimed ? r.canManageCity(t) : { ok: true, reason: '' };
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
    this.setInnerHtml(this.routeNetworkPanel, this.routeNetworkHtml());
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
    const slider = this.routeNetworkPanel.querySelector<HTMLInputElement>('.rn-budget-slider');
    if (slider) {
      // Update the budget + readout live without forcing a full panel rebuild,
      // so the slider node survives the drag (the rebuild guard would replace it).
      slider.oninput = () => {
        const pct = Number(slider.value);
        r.setRouteBudget(pct / 100);
        const label = pct === 0 ? 'unfunded' : pct < 100 ? 'lean' : pct === 100 ? 'full' : 'priority';
        const readout = this.routeNetworkPanel.querySelector<HTMLElement>('.rn-budget-readout');
        if (readout) readout.textContent = `${pct}% (${label}) · ${formatCurrency(r.routeUpkeepProjected(), 1)}/mo`;
        const note = this.routeNetworkPanel.querySelector<HTMLElement>('.rn-budget-note');
        if (note) note.textContent = pct < 100 ? 'Routes degrade — repairs underfunded.' : pct > 100 ? 'Routes mend quickly.' : 'Routes hold and slowly improve.';
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
    // Maintenance budget slider (Issue #16): one operational knob instead of
    // repairing each route by hand. Shows the projected monthly spend.
    const budgetPct = Math.round(r.routeBudget * 100);
    const projected = r.routeUpkeepProjected();
    const budgetLabel = budgetPct === 0 ? 'unfunded' : budgetPct < 100 ? 'lean' : budgetPct === 100 ? 'full' : 'priority';
    const budgetHtml = built.length > 0
      ? `<div class="rn-budget">` +
        `<p class="insp-skills">MAINTENANCE BUDGET — <b class="rn-budget-readout">${budgetPct}% (${budgetLabel}) · ` + formatCurrency(projected, 1) + `/mo</b></p>` +
        `<input type="range" class="rn-budget-slider" min="0" max="150" step="10" value="${budgetPct}" ` +
        `title="Below 100% lets roads degrade; above 100% funds rapid repairs">` +
        `<p class="insp-skills rn-budget-note">${budgetPct < 100 ? 'Routes degrade — repairs underfunded.' : budgetPct > 100 ? 'Routes mend quickly.' : 'Routes hold and slowly improve.'}</p>` +
        `</div>`
      : '';
    return (
      `<div class="pal-title">ROUTE NETWORK <button class="mini rn-close" title="close (R)">✕</button></div>` +
      `<p class="insp-skills">${r.routes.length} links · ${built.length} built · upkeep ` + formatCurrency(upkeep, 1) + `/mo at full</p>` +
      budgetHtml +
      `<div class="thoughts">${rows || '<p class="insp-skills">no routes yet</p>'}</div>`
    );
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
    this.setInnerHtml(this.settlementListPanel, this.settlementListHtml());
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
    this.setInnerHtml(this.economyPanel, this.economyPanelHtml());
    const refresh = () => { this.lastEconomyBuildFrame = -999; };
    this.wireTabs(this.economyPanel, (t) => { this.economyTab = t as 'overview' | 'settlements' | 'supply'; });
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

  /** Dedicated Central Bank window (B): the monetary controls the player expects
   *  the moment they research Central Banking — policy rate, credit cycle, FX
   *  regime, sovereign bonds, the discount window, and the currency standard. */
  private drawCentralBankPanel(): void {
    const r = this.region;
    if (!this.centralBankOpen || !r.hasCentralBank()) {
      this.centralBankPanel.classList.add('hidden');
      return;
    }
    this.centralBankPanel.classList.remove('hidden');
    if (this.frame - this.lastCentralBankBuildFrame < 60) return;
    this.lastCentralBankBuildFrame = this.frame;
    this.setInnerHtml(this.centralBankPanel, this.centralBankPanelHtml());
    this.wireCentralBankPanel();
  }

  private wireCentralBankPanel(): void {
    const r = this.region;
    const p = this.centralBankPanel;
    const refresh = () => { this.lastCentralBankBuildFrame = -999; };
    for (const b of p.querySelectorAll<HTMLButtonElement>('.cb-close')) {
      b.onclick = () => { this.centralBankOpen = false; };
    }
    const rateSlider = p.querySelector<HTMLInputElement>('#rate-slider');
    if (rateSlider) {
      rateSlider.oninput = (e) => {
        r.policyRate = Number((e.target as HTMLInputElement).value) / 100;
        const rateVal = p.querySelector<HTMLElement>('#rate-val');
        if (rateVal) rateVal.textContent = `${Math.round(r.policyRate * 100)}%`;
      };
    }
    for (const btn of p.querySelectorAll<HTMLButtonElement>('.cb-regime-btn')) {
      btn.onclick = () => { r.setMonetaryRegime(btn.dataset.regime as MonetaryRegime); refresh(); };
    }
    for (const btn of p.querySelectorAll<HTMLButtonElement>('.cb-bond-btn')) {
      btn.onclick = () => { r.issueBonds(Number(btn.dataset.amount)); refresh(); };
    }
    for (const btn of p.querySelectorAll<HTMLButtonElement>('.cb-cur-announce')) {
      btn.onclick = () => { r.announceCurrencyChange(btn.dataset.sym as CurrencySymbol); refresh(); };
    }
    for (const btn of p.querySelectorAll<HTMLButtonElement>('.cb-cur-switch')) {
      btn.onclick = () => {
        const sym = btn.dataset.sym as CurrencySymbol;
        // A switch made under duress reads as necessity; one made in calm waters
        // reads as caprice — and markets price each accordingly.
        const cause = r.confidence < 30 ? 'crisis' : 'strategic';
        const verdict = cause === 'crisis'
          ? 'Markets are already in crisis — they will understand this move.'
          : 'Markets see no reason for this. Expect heavy capital flight and years of friction.';
        if (confirm(`Switch the currency standard to ${sym}?\n\n${verdict}\n\nAnnounced switches (${ANNOUNCE_LEAD_DAYS}+ days notice) and deep treasury reserves soften the blow.`)) {
          r.changeCurrency(sym, cause); refresh();
        }
      };
    }
    for (const btn of p.querySelectorAll<HTMLButtonElement>('.cb-dw-draw')) {
      btn.onclick = () => {
        const result = r.borrowFromCentralBank(Number(btn.dataset.amount));
        if (!result.ok) alert(result.reason); else refresh();
      };
    }
    for (const btn of p.querySelectorAll<HTMLButtonElement>('.cb-dw-repay')) {
      btn.onclick = () => {
        const result = r.repayCentralBank(Number(btn.dataset.amount));
        if (!result.ok) alert(result.reason); else refresh();
      };
    }
  }

  private centralBankPanelHtml(): string {
    const r = this.region;
    const established = r.has('central_banking') ? 'Central Banking civic' : 'Central Bank Charter';
    const bondNote = !r.nationProclaimed
      ? `<p class="insp-skills" style="color:#c9b27a">Sovereign bond issuance unlocks once you proclaim nationhood.</p>`
      : '';
    return (
      `<div class="pal-title">🏛 CENTRAL BANK [B] <button class="mini cb-close" title="close (B)">✕</button></div>` +
      `<p style="font-size:10px;color:#9ab0c4;margin:2px 0 8px">Established via the ${established}. Set the policy rate to steer the credit cycle, manage the currency standard, and lean against boom and bust.</p>` +
      this.monetaryHtml() +
      bondNote
    );
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
      `<button class="pal-tab${etab === 'supply' ? ' active' : ''}" data-ptab="supply">Supply</button>` +
      `</div>` +
      `<div class="pal-section${etab === 'overview' ? '' : ' hidden'}" data-psection="overview">${overviewBody}</div>` +
      `<div class="pal-section${etab === 'settlements' ? '' : ' hidden'}" data-psection="settlements">` +
        `<div class="thoughts">${settRows || '<p class="insp-skills">no towns yet</p>'}</div></div>` +
      `<div class="pal-section${etab === 'supply' ? '' : ' hidden'}" data-psection="supply">${this.supplyPanelHtml()}</div>`
    );
  }

  /** Critical goods the trade screen tracks dependency on (GDD §5.4). */
  private static readonly CRITICAL_GOODS = ['food', 'fuel', 'steel', 'components'];

  /** Transitive primary-raw footprint of a good — the raws that, if cut, take it
   *  down. The "dependency" the GDD §5.4 trade screen surfaces, read off the DAG. */
  private goodRawFootprint(goodId: string): string[] {
    const byId = new Map(INTERMEDIATE_GOODS.map((g) => [g.id, g]));
    const raws = new Set<string>();
    const seen = new Set<string>();
    const visit = (id: string): void => {
      if (seen.has(id)) return;
      seen.add(id);
      const g = byId.get(id);
      if (!g) { raws.add(id); return; } // ground: a primary raw
      for (const inp of g.inputs) visit(inp);
    };
    visit(goodId);
    return [...raws].sort();
  }

  /** The Supply tab: supply-chain health, the live industrial drag, any standing
   *  embargo, the GDD §5.4 critical-goods dependency board, and a per-good status
   *  grid. Pure read off `supplyChainSnapshot()` — no mutation. */
  private supplyPanelHtml(): string {
    const r = this.region;
    const snap = r.supplyChainSnapshot();
    const nameOf = (id: string): string =>
      INTERMEDIATE_GOODS.find((g) => g.id === id)?.name ?? id;

    if (snap.active.length === 0) {
      const firstUnlock = Math.min(...INTERMEDIATE_GOODS.map((g) => g.eraUnlock));
      return `<p class="insp-skills">No supply chain yet — manufacturing begins ${firstUnlock}.</p>`;
    }

    const healthPct = Math.round(snap.health * 100);
    const dragPct = (1 - snap.outputMult) * 100;
    const disruptedCount = snap.disrupted.size;
    const healthy = snap.severity === 0;
    const barCol = healthy ? '#4e9' : snap.severity < 0.3 ? '#ca4' : '#e55';
    // The shock's other halves (GDD §5.2): cost-push inflation and an export
    // drag. Prices: the target lift in percentage points — only realized once a
    // central bank runs the monetary system, so gate that readout on it. Exports:
    // the trade leg, the % a shortage trims off foreign sales (no gate).
    const pricePushPp = snap.severity * SUPPLY_SHOCK_INFLATION * 100;
    const showPush = pricePushPp > 0.05 && r.hasCentralBank();
    const exportDragPct = snap.severity * SUPPLY_SHOCK_EXPORT_DRAG * 100;
    const showExportDrag = exportDragPct > 0.05;

    // Headline: health bar + the output drag, price push, and export drag it costs.
    let html =
      `<div class="bar-row" title="Active goods fully supplied this month">` +
      `<span style="width:54px;display:inline-block">health</span>` +
      `<div class="bar" style="flex:1"><div class="bar-fill" style="width:${healthPct}%;background:${barCol}"></div></div>` +
      `<span class="insp-skills" style="min-width:34px;text-align:right">${healthPct}%</span>` +
      `</div>` +
      `<p class="insp-skills" title="A shortage cuts output, raises prices (stagflation), and chokes exports">` +
      `${snap.supplied.size}/${snap.active.length} goods flowing` +
      (dragPct > 0.05 ? ` · industry −${dragPct.toFixed(1)}%` : ' · no shock') +
      (showPush ? ` · prices +${pricePushPp.toFixed(1)}pp` : '') +
      (showExportDrag ? ` · exports −${exportDragPct.toFixed(1)}%` : '') +
      `</p>`;

    // Standing embargoes — the "this is why" banner (oil shock, future blockades).
    for (const e of snap.embargoes) {
      const months = Math.max(1, Math.round(e.daysLeft / 30));
      const cutPct = Math.round(e.cut * 100);
      const how = e.cut >= 1 ? 'cut off' : `${cutPct}% cut`;
      html +=
        `<p class="insp-cond" style="margin:4px 0">⚠ ${e.raw.toUpperCase()} EMBARGO` +
        ` — ${e.raw} ${how}, cascading downstream · ~${months} mo left</p>`;
    }

    // Critical-goods dependency board (GDD §5.4: food, fuel, steel, components).
    html += `<p class="insp-skills" style="margin-top:6px">CRITICAL GOODS</p>`;
    for (const id of RegionView.CRITICAL_GOODS) {
      if (!snap.active.includes(id)) continue; // not yet unlocked this era
      const ok = snap.supplied.has(id);
      const deps = this.goodRawFootprint(id).join(', ');
      html +=
        `<div style="display:flex;align-items:center;gap:6px;margin:2px 0" title="${nameOf(id)} depends on: ${deps}">` +
        `<span style="color:${ok ? '#4e9' : '#e55'}">${ok ? '●' : '○'}</span>` +
        `<span style="width:82px">${nameOf(id)}</span>` +
        `<span class="insp-skills">← ${deps}</span>` +
        (ok ? '' : `<span class="insp-cond">· cut</span>`) +
        `</div>`;
    }

    // Full per-good status grid, disrupted first so a shock reads at a glance.
    const order = [...snap.active].sort((a, b) => {
      const da = snap.disrupted.has(a) ? 0 : 1;
      const db = snap.disrupted.has(b) ? 0 : 1;
      return da - db;
    });
    html += `<p class="insp-skills" style="margin-top:6px">ALL GOODS (${snap.active.length})</p>`;
    html += `<div style="display:flex;flex-wrap:wrap;gap:2px 8px">`;
    for (const id of order) {
      const ok = snap.supplied.has(id);
      const level = snap.levels.get(id) ?? (ok ? 1 : 0);
      // A partial cut (graded embargo / strained extraction) runs amber, not red,
      // and shows the level it's holding — distinct from a total cut at a glance.
      const partial = !ok && level > 0.001;
      const col = ok ? '#4e9' : partial ? '#ca4' : '#e55';
      const glyph = ok ? '●' : partial ? '◐' : '○';
      const tip = ok ? 'supplied' : partial ? `running at ${Math.round(level * 100)}%` : 'disrupted';
      html +=
        `<span class="insp-skills" style="color:${col};min-width:84px" title="${tip}">` +
        `${glyph} ${nameOf(id)}</span>`;
    }
    html += `</div>`;
    if (disruptedCount > 0 && snap.embargoes.length === 0) {
      html += `<p class="insp-skills" style="margin-top:4px">Open goods are disrupted — an upstream raw or input is short.</p>`;
    }
    return html;
  }

  /** Why a node can't be researched right now — shown on hover for locked nodes. */
  private techLockReason(node: TechNode): string {
    const r = this.region;
    const unmet = node.prereqs.filter((p) => !r.has(p));
    if (unmet.length > 0) {
      const names = unmet.map((p) => TECH_TREE.find((n) => n.id === p)?.name ?? p);
      return `Requires: ${names.join(', ')}`;
    }
    if (node.requiresState && !r.stateProclaimed) return 'Requires statehood';
    if (r.year < node.era) return `Available from ${node.era}`;
    return 'Locked';
  }

  /**
   * DAG layout for one research tree: columns = longest prerequisite chain depth,
   * rows packed within each column with a barycenter sort to reduce edge crossings.
   * Returns pixel positions plus the canvas size needed to hold them.
   */
  private techTreeLayout(nodes: TechNode[]): {
    pos: Map<string, { x: number; y: number }>;
    width: number;
    height: number;
  } {
    const key = nodes.map((n) => n.id).sort().join(',');
    if (this.techLayoutCache.has(key)) return this.techLayoutCache.get(key)!;
    const NODE_W = 124, NODE_H = 42, COL_PITCH = 168, ROW_PITCH = 56, PAD = 14;
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const depthMemo = new Map<string, number>();
    const depth = (id: string): number => {
      if (depthMemo.has(id)) return depthMemo.get(id)!;
      const n = byId.get(id);
      if (!n) return 0;
      depthMemo.set(id, 0); // guard against cycles
      const ps = n.prereqs.filter((p) => byId.has(p));
      const d = ps.length === 0 ? 0 : 1 + Math.max(...ps.map(depth));
      depthMemo.set(id, d);
      return d;
    };
    let maxCol = 0;
    const colOf = new Map<string, number>();
    for (const n of nodes) { const c = depth(n.id); colOf.set(n.id, c); maxCol = Math.max(maxCol, c); }
    const colMembers: TechNode[][] = Array.from({ length: maxCol + 1 }, () => []);
    for (const n of nodes) colMembers[colOf.get(n.id)!].push(n);

    const rowOf = new Map<string, number>();
    let maxRows = 0;
    for (let c = 0; c <= maxCol; c++) {
      const members = colMembers[c];
      const bary = (n: TechNode): number => {
        const ps = n.prereqs.filter((p) => rowOf.has(p));
        if (ps.length === 0) return n.era; // col-0 (and orphans): chronological order
        return ps.reduce((s, p) => s + rowOf.get(p)!, 0) / ps.length;
      };
      members.sort((a, b) => bary(a) - bary(b) || a.name.localeCompare(b.name));
      members.forEach((n, i) => rowOf.set(n.id, i));
      maxRows = Math.max(maxRows, members.length);
    }

    const pos = new Map<string, { x: number; y: number }>();
    for (const n of nodes) {
      pos.set(n.id, {
        x: PAD + colOf.get(n.id)! * COL_PITCH,
        y: PAD + rowOf.get(n.id)! * ROW_PITCH,
      });
    }
    const result = {
      pos,
      width: PAD * 2 + maxCol * COL_PITCH + NODE_W,
      height: PAD * 2 + Math.max(0, maxRows - 1) * ROW_PITCH + NODE_H,
    };
    this.techLayoutCache.set(key, result);
    return result;
  }

  /** Research panel: visual tech/civics tree with prerequisite lines, start/cancel. */
  private drawResearchPanel(): void {
    const r = this.region;
    if (!this.researchOpen) {
      this.researchPanel.classList.add('hidden');
      return;
    }
    this.researchPanel.classList.remove('hidden');
    // DOM-stability guard (see drawStatePanel): rebuild on a ~1s timer, not every
    // frame, or the node/cancel buttons are replaced mid-click and never fire.
    if (this.frame - this.lastResearchBuildFrame < 120) return;
    this.lastResearchBuildFrame = this.frame;
    const forceResearchRebuild = () => { this.lastResearchBuildFrame = -999; };
    const rate = r.researchRate().toFixed(1);
    const active = r.activeResearch ? TECH_TREE.find((n) => n.id === r.activeResearch) : null;
    const progressPct = active ? Math.min(100, Math.round((r.researchProgress / r.techCost(active)) * 100)) : 0;
    const rtab = this.researchTab;

    const NODE_W = 124, NODE_H = 42;
    const availIds = new Set(r.availableToResearch().map((n) => n.id));

    const renderTree = (tree: 'tech' | 'civics'): string => {
      const nodes = TECH_TREE.filter((n) => n.tree === tree);
      const { pos, width, height } = this.techTreeLayout(nodes);

      // Edges first (behind the nodes): a path from each prereq's right edge to
      // the node's left edge, colored by whether the prereq is satisfied.
      let edges = '';
      for (const n of nodes) {
        const np = pos.get(n.id)!;
        for (const p of n.prereqs) {
          const pp = pos.get(p);
          if (!pp) continue;
          const x1 = pp.x + NODE_W, y1 = pp.y + NODE_H / 2;
          const x2 = np.x, y2 = np.y + NODE_H / 2;
          const mx = (x1 + x2) / 2;
          const cls = r.has(p) ? 'tt-edge tt-edge-on' : 'tt-edge';
          edges += `<path class="${cls}" d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" />`;
        }
      }

      // Nodes on top.
      let boxes = '';
      for (const n of nodes) {
        const np = pos.get(n.id)!;
        const done = r.has(n.id);
        const isActive = r.activeResearch === n.id;
        const available = !done && availIds.has(n.id);
        let cls = 'tt-node ';
        cls += done ? 'tt-done' : isActive ? 'tt-active' : available ? 'tt-avail' : 'tt-locked';
        const tip = done ? `${n.name} — researched` :
          available ? `${n.name} (${r.techCost(n)} RP)\n${n.desc}` :
          isActive ? `${n.name} — researching (${progressPct}%)` :
          `${n.name}\n${this.techLockReason(n)}`;
        const cost = done ? '✓' : isActive ? `${progressPct}%` : `${r.techCost(n)}`;
        const fill = isActive ? `<div class="tt-fill" style="width:${progressPct}%"></div>` : '';
        boxes += `<div class="tt-node-wrap" style="left:${np.x}px;top:${np.y}px;width:${NODE_W}px;height:${NODE_H}px">` +
          `<div class="${cls}" data-id="${n.id}" data-state="${done ? 'done' : isActive ? 'active' : available ? 'avail' : 'locked'}" title="${this.escapeAttr(tip)}">` +
          `${fill}<span class="tt-name">${n.name}</span><span class="tt-cost">${cost}</span></div></div>`;
      }

      return `<div class="tt-canvas" style="width:${width}px;height:${height}px">` +
        `<svg class="tt-edges" width="${width}" height="${height}">${edges}</svg>${boxes}</div>`;
    };

    // Phase 13: Projected skilled workforce note (education pipeline lag)
    const targetYear = 2045;
    const yearsAhead = Math.max(0, targetYear - r.year);
    const projSkilled = r.projectedSkilledWorkforce(yearsAhead);
    const projSkilledNote = `<p class="insp-note" style="color:#8bc4e0;font-size:0.82em;margin:2px 0 6px 0">` +
      `Projected skilled workforce in ${targetYear}: <b>${Math.round(projSkilled * 100)}%</b></p>`;

    this.setInnerHtml(
      this.researchPanel,
      `<div class="pal-title">RESEARCH</div>` +
      `<p class="insp-skills">${rate} RP/day${active ? ` → <b>${active.name}</b>` : ' (idle)'}` +
      (active ? ` <button class="mini res-cancel-btn">cancel</button>` : '') + `</p>` +
      (active ? `<div class="res-bar"><div class="res-bar-fill" style="width:${progressPct}%"></div></div>` : '') +
      projSkilledNote +
      `<div class="pal-tabs">` +
      `<button class="pal-tab${rtab === 'tech' ? ' active' : ''}" data-ptab="tech">Technology</button>` +
      `<button class="pal-tab${rtab === 'civics' ? ' active' : ''}" data-ptab="civics">Civics</button>` +
      `</div>` +
      `<div class="pal-section tt-scroll${rtab === 'tech' ? '' : ' hidden'}" data-psection="tech">${renderTree('tech')}</div>` +
      `<div class="pal-section tt-scroll${rtab === 'civics' ? '' : ' hidden'}" data-psection="civics">${renderTree('civics')}</div>`,
      ['.pal-section[data-psection="tech"]', '.pal-section[data-psection="civics"]'],
    );

    this.wireTabs(this.researchPanel, (t) => { this.researchTab = t as 'tech' | 'civics'; });
    for (const node of this.researchPanel.querySelectorAll<HTMLElement>('.tt-node')) {
      if (node.dataset.state !== 'avail') continue;
      node.onclick = () => { r.startResearch(node.dataset.id!); forceResearchRebuild(); };
    }
    const cancelBtn = this.researchPanel.querySelector<HTMLButtonElement>('.res-cancel-btn');
    if (cancelBtn) cancelBtn.onclick = () => { r.cancelResearch(); forceResearchRebuild(); };
  }

  /** Escape a string for safe use inside an HTML attribute (e.g. title tooltips). */
  private escapeAttr(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
      (r.canFloodProof(t.id)
        ? `<p><button class="mini" id="floodproof-btn" ${r.treasury >= r.floodProofCost(t) ? '' : 'disabled'} ` +
          `title="Raised thresholds and emergency pumps — halves tidal damage at lower cost than a full sea wall">` +
          `flood-proof ` + formatCurrency(r.floodProofCost(t)) + `</button></p>`
        : t.floodProofed && !t.seaWall ? `<p class="insp-skills">flood-proofed (partial protection)</p>` : '') +
      (r.canManagedRetreat(t.id)
        ? `<p><button class="mini danger" id="retreat-btn" ${r.treasury >= r.managedRetreatCost(t) ? '' : 'disabled'} ` +
          `title="Relocate this settlement inland permanently — brutal short-term, eliminates all flood risk">` +
          `managed retreat ` + formatCurrency(r.managedRetreatCost(t)) + `</button></p>`
        : '') +
      this.garrisonHtml(t) +
      this.scoutHtml(t) +
      this.crisisActionsHtml(t) +
      recentHtml;

    const economyBody =
      this.sectorsHtml(t) +
      (!r.stateProclaimed ? this.colonyManageHtml(t) : '') +
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

  /** Scout-hire button — available pre-state so the player can explore the fog. */
  private scoutHtml(t: Settlement): string {
    const r = this.region;
    if (t.factionId !== r.playerFactionId) return '';
    const active = r.scouts.filter((s) => s.factionId === r.playerFactionId).length;
    const scoutCost = r.scoutCost();
    const canAfford = r.treasury >= scoutCost;
    const atCap = active >= 2;
    const disabled = !canAfford || atCap;
    const reason = atCap ? '2 scouts already active' : !canAfford ? `need ${formatCurrency(scoutCost)}` : '';
    return (
      `<p class="insp-skills">EXPLORATION · ${active}/2 scouts active</p>` +
      `<p><button class="mini scout-btn" ${disabled ? 'disabled' : ''} ` +
      `title="${disabled ? reason : 'Hire a scout to explore the fog of war — active for 200 days'}">` +
      `Hire Scout (${formatCurrency(scoutCost)})</button></p>`
    );
  }

  /** Pre-state colony management: development focus and basic local policies. */
  private colonyManageHtml(t: Settlement): string {
    const r = this.region;
    if (t.factionId !== r.playerFactionId) return '';
    const focusBtns = (['balanced', ...SECTOR_IDS] as TownFocus[])
      .map((f) => {
        const label = f === 'balanced' ? 'balanced' : SECTOR_NAMES[f].toLowerCase();
        return t.focus === f
          ? `<b>${label}</b>`
          : `<button class="mini focus-btn" data-f="${f}" title="Shift labor toward ${label} (£${FOCUS_CHANGE_COST})">${label}</button>`;
      })
      .join(' ');
    return (
      `<p class="insp-skills">COLONY MANAGEMENT</p>` +
      `<p class="insp-skills">focus: ${focusBtns}</p>` +
      `<p class="insp-skills"><abbr title="Raises town tax revenue but slows population growth">local tax</abbr>: ` +
      TAX_BAND_LABELS.map((label, i) =>
        t.policies.taxBand === i
          ? `<b>${label}</b>`
          : `<button class="mini policy-tax-btn" data-tax="${i}">${label}</button>`
      ).join(' ') + `</p>`
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
