/**
 * DOM HUD: top bar, bottom build toolbar (Cities-Skylines style with categories),
 * inspector panel, work priorities, event log.
 */
import type { Simulation, Settler, Building } from '../sim/sim';
import { buildingDef, traitDef, WORK_KINDS, TUNING, TOWN_TECH_DEFS, formatCurrency } from '../sim/defs';
import type { ResourceKind, WorkKind } from '../sim/defs';
import { getMarketPrice } from '../sim/economy';
import type { Camera } from './render';
import type { PaintKind } from '../sim/world';
import type { Sfx } from './audio';
import type { Music } from './music';
import type { Soundscape } from './soundscape';
import { TechPanel } from './TechPanel';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  parent.appendChild(e);
  return e;
}

// Build menu categories
interface BuildCategory {
  id: string;
  icon: string;
  label: string;
  items: BuildItem[];
}

interface BuildItem {
  kind: 'building' | 'zone' | 'tool';
  id: string; // defId for buildings, PaintKind for zones, 'chop'/'overlay'/'priorities' for tools
  label: string;
  cost?: string;
  hotkey?: string;
  desc: string;
}

const BUILD_CATEGORIES: BuildCategory[] = [
  {
    id: 'shelter',
    icon: '⌂',
    label: 'SHELTER',
    items: [
      { kind: 'building', id: 'house', label: 'Cabin', cost: '20w', desc: 'Sleeping quarters for 3 settlers.' },
      { kind: 'building', id: 'clinic', label: 'Clinic', cost: '40w', desc: 'Two cots — the badly hurt heal here.' },
      { kind: 'building', id: 'longhouse', label: 'Longhouse', cost: '40w+25s', desc: 'Houses 12 settlers. Communal types thrive here. Needs Stone Masonry tech.' },
      { kind: 'building', id: 'schoolhouse', label: 'Schoolhouse', cost: '30w+10s', desc: '+25% research speed per building. Needs Schooling tech.' },
    ],
  },
  {
    id: 'food',
    icon: '◈',
    label: 'FOOD',
    items: [
      { kind: 'building', id: 'kitchen', label: 'Cookhouse', cost: '30w', desc: 'Turns grain into meals.' },
      { kind: 'building', id: 'bakery', label: 'Bakery', cost: '45w', desc: 'Faster batch cooking.' },
      { kind: 'building', id: 'granary', label: 'Granary', cost: '35w', desc: '+150 meal storage cap.' },
      { kind: 'building', id: 'lodge', label: 'Hunt Lodge', cost: '30w', desc: 'Hunters bring back game_meal.' },
      { kind: 'building', id: 'fishing_dock', label: 'Fish Dock', cost: '15w', desc: 'Fish for fish_meal near water.' },
      { kind: 'building', id: 'mill', label: 'Mill', cost: '40w+5s', desc: 'Grain→produce (variety food). Needs Milling tech.' },
      { kind: 'building', id: 'brewery', label: 'Brewery', cost: '30w', desc: 'Grain→ale for morale. Needs Fermentation tech.' },
      { kind: 'building', id: 'kitchen_garden', label: 'Kitchen Garden', cost: '15w', desc: 'Free produce over time. Needs Horticulture tech.' },
      { kind: 'building', id: 'animal_pen', label: 'Animal Pen', cost: '35w', desc: 'Livestock on pasture zones → dairy daily. Needs Animal Husbandry tech.' },
      { kind: 'building', id: 'herb_garden', label: 'Herb Garden', cost: '20w', desc: 'Tended herb garden yields herbs periodically. Needs Herbalism tech.' },
      { kind: 'building', id: 'apothecary', label: 'Apothecary', cost: '35w+5s', desc: 'Herbs→medicine. Medicine speeds clinic healing. Needs Germ Theory tech.' },
    ],
  },
  {
    id: 'craft',
    icon: '⚙',
    label: 'CRAFT',
    items: [
      { kind: 'building', id: 'tailor', label: 'Tailor', cost: '25w', desc: 'Weaves clothing (2g/set).' },
      { kind: 'building', id: 'forester', label: 'Forester', cost: '25w', desc: 'Plants and harvests trees.' },
    ],
  },
  {
    id: 'industry',
    icon: '⚒',
    label: 'INDUSTRY',
    items: [
      { kind: 'building', id: 'sawmill', label: 'Sawmill', cost: '35w', desc: 'Wood→timber (2:1). Enables advanced buildings. Needs Carpentry tech.' },
      { kind: 'building', id: 'kiln', label: 'Kiln', cost: '20w+5s', desc: 'Clay→brick (2:1). Masonry-grade construction. Needs Brickwork tech.' },
      { kind: 'building', id: 'mine', label: 'Mine', cost: '30w', desc: 'Paint mine zones on rock tiles to extract clay and ore. Needs Prospecting tech.' },
      { kind: 'building', id: 'blacksmith', label: 'Blacksmith', cost: '25w+10s', desc: 'Iron ore+coal→iron→tools. Tools speed construction +20%. Needs Blacksmithing tech.' },
      { kind: 'building', id: 'warehouse', label: 'Warehouse', cost: '50w+10s', desc: '+500 raw goods storage. Needs Commerce tech.' },
    ],
  },
  {
    id: 'civil',
    icon: '⚑',
    label: 'CIVIL',
    items: [
      { kind: 'building', id: 'town_hall', label: 'Town Hall', cost: '60w+20s', desc: 'Enables town research tree [K]. Assign researcher.' },
      { kind: 'building', id: 'hall', label: 'Meeting Hall', cost: '40w', desc: 'Recreation and society.' },
      { kind: 'building', id: 'hearth', label: 'Hearth', cost: '10w', desc: 'Keeps settlers warm in winter.' },
      { kind: 'building', id: 'market', label: 'Market', cost: '50w', desc: 'Trade with passing merchants.' },
      { kind: 'building', id: 'graveyard', label: 'Burial Ground', cost: '5w', desc: 'The dead rest here.' },
    ],
  },
  {
    id: 'defense',
    icon: '▮',
    label: 'WALLS',
    items: [
      { kind: 'zone', id: 'wall', label: 'Palisade [L]', cost: '3w/tile', hotkey: 'l', desc: 'Wooden wall — blocks raiders.' },
      { kind: 'zone', id: 'gate', label: 'Gate [G]', cost: '5w/tile', hotkey: 'g', desc: 'Settlers pass; raiders must break it.' },
      { kind: 'zone', id: 'trap', label: 'Spike Trap [X]', cost: '2w/tile', hotkey: 'x', desc: 'One-shot spike trap. Damages raiders on contact.' },
      { kind: 'building', id: 'armory', label: 'Armoury', cost: '30w', desc: 'Forges weapons from wood. Armed settlers deal more damage.' },
      { kind: 'building', id: 'watchtower', label: 'Watchtower', cost: '25w', desc: 'Warns of raids 1 day early. Needs Fortification tech.' },
      { kind: 'building', id: 'well', label: 'Well', cost: '10w+5s', desc: 'Reduces infection risk colony-wide. Needs First Aid tech.' },
    ],
  },
  {
    id: 'roads',
    icon: '═',
    label: 'ROADS',
    items: [
      { kind: 'zone', id: 'dirt', label: 'Dirt [4]', cost: 'free', hotkey: '4', desc: '×1.3 speed, muddy in rain.' },
      { kind: 'zone', id: 'plank', label: 'Plank [5]', cost: '1w/tile', hotkey: '5', desc: '×1.6 speed, all-weather.' },
      { kind: 'zone', id: 'gravel', label: 'Gravel [6]', cost: '1s/tile', hotkey: '6', desc: '×1.8 speed, best surface.' },
      { kind: 'zone', id: 'bridge', label: 'Bridge [7]', cost: '4w/tile', hotkey: '7', desc: 'Cross water.' },
    ],
  },
  {
    id: 'zones',
    icon: '⬡',
    label: 'ZONES',
    items: [
      { kind: 'zone', id: 'farm', label: 'Farm [F]', cost: 'free', hotkey: 'f', desc: 'Paint farmable soil tiles.' },
      { kind: 'zone', id: 'stockpile', label: 'Stockpile [T]', cost: 'free', hotkey: 't', desc: 'Settlers haul resources here.' },
      { kind: 'zone', id: 'flax', label: 'Flax [Z]', cost: 'free', hotkey: 'z', desc: 'Paint flax tiles — harvest yields 3 flax. Replaces grain for clothes. Needs Textile Farming tech.' },
      { kind: 'zone', id: 'pasture', label: 'Pasture [B]', cost: 'free', hotkey: 'b', desc: 'Grazing land for livestock near an Animal Pen. Needs Animal Husbandry tech.' },
      { kind: 'zone', id: 'mine', label: 'Mine Zone [N]', cost: 'free', hotkey: 'n', desc: 'Paint on rock tiles — settlers extract clay and ore. Needs Prospecting tech.' },
      { kind: 'tool', id: 'chop', label: 'Chop [C]', hotkey: 'c', desc: 'Mark trees and rock for harvesting.' },
    ],
  },
];

export class Hud {
  speed = 1;
  paused = false;
  onFoundTown: (() => void) | null = null;
  onRestart: (() => void) | null = null;
  onSave: (() => boolean) | null = null;
  onLoad: (() => void) | null = null;
  onQuit: ((save: boolean) => void) | null = null;
  hasSave: (() => boolean) | null = null;
  menuOpen = false;
  private pausedBeforeMenu = false;
  private topBar: HTMLElement;
  private buildBar: HTMLElement;
  private buildSubmenu: HTMLElement;
  private buildTabs: HTMLElement;
  private inspector: HTMLElement;
  private logBox: HTMLElement;
  private prioBox: HTMLElement;
  private gameOverBox: HTMLElement;
  private menuBox: HTMLElement;
  private showPriorities = false;
  private activeCat: string | null = null;
  private lastLogLen = 0;
  private foundBtn: HTMLButtonElement | null = null;
  private htmlCache = new Map<HTMLElement, string>();
  private techPanel!: TechPanel;

  constructor(
    root: HTMLElement,
    private sim: Simulation,
    private cam: Camera,
    private sfx?: Sfx,
    private music?: Music,
    private soundscape?: Soundscape,
  ) {
    this.topBar = el('div', 'topbar', root);
    // Build bar (bottom-center)
    this.buildBar = el('div', 'buildbar', root);
    this.buildSubmenu = el('div', 'buildbar-submenu hidden', this.buildBar);
    this.buildTabs = el('div', 'buildbar-tabs', this.buildBar);
    this.inspector = el('div', 'inspector hidden', root);
    this.logBox = el('div', 'eventlog', root);
    this.prioBox = el('div', 'priorities hidden', root);
    this.gameOverBox = el('div', 'gameover hidden', root);
    this.menuBox = el('div', 'menu hidden', root);

    this.buildBuildBar();
    this.techPanel = new TechPanel(root, sim);

    // Delegate clicks on the submenu
    this.buildSubmenu.addEventListener('mousedown', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('.build-item-btn');
      if (!btn) return;
      this.sfx?.click();
      const kind = btn.dataset.kind as 'building' | 'zone' | 'tool';
      const id = btn.dataset.id!;
      this.handleBuildItemClick(kind, id);
    });

    // Delegate clicks on inspector
    this.inspector.addEventListener('mousedown', (e) => {
      const trade = (e.target as HTMLElement).closest<HTMLElement>('.trade-btn');
      if (trade) {
        this.sim.trade(trade.dataset.give as ResourceKind, trade.dataset.get as ResourceKind);
        return;
      }
      const sell = (e.target as HTMLElement).closest<HTMLElement>('.sell-cash-btn');
      if (sell) {
        this.sim.sellToMarket(sell.dataset.kind as ResourceKind, 5);
        return;
      }
      const btn = (e.target as HTMLElement).closest<HTMLElement>('button[data-action]');
      if (!btn) return;
      this.sfx?.click();
      const action = btn.dataset.action!;
      const bid = Number(btn.dataset.bid);
      switch (action) {
        case 'cancel':
          this.sim.cancelBuilding(bid);
          this.cam.selectedBuilding = null;
          break;
        case 'destroy':
          if (confirm('Demolish this building? You will recover half the wood.')) {
            this.sim.destroyBuilding(bid);
            this.cam.selectedBuilding = null;
          }
          break;
        case 'sell':
          if (confirm('Sell this building to passing merchants?')) {
            this.sim.destroyBuilding(bid); // use destroy for now (sell = better refund TODO)
            this.cam.selectedBuilding = null;
          }
          break;
        case 'upgrade':
          this.sim.upgradeBuilding(bid);
          break;
        case 'worker-dec': {
          const b = this.sim.buildings.find((x) => x.id === bid);
          if (b) b.workerLimit = b.workerLimit === null ? 4 : Math.max(0, b.workerLimit - 1);
          break;
        }
        case 'worker-inc': {
          const b = this.sim.buildings.find((x) => x.id === bid);
          if (b) b.workerLimit = b.workerLimit === null ? 4 : b.workerLimit + 1;
          break;
        }
        case 'worker-auto': {
          const b = this.sim.buildings.find((x) => x.id === bid);
          if (b) b.workerLimit = null;
          break;
        }
        case 'open-tech':
          this.techPanel.show();
          break;
      }
    });

    this.prioBox.addEventListener('mousedown', (e) => {
      const td = (e.target as HTMLElement).closest<HTMLElement>('.prio');
      if (!td) return;
      const p = this.sim.settlers.find((x) => x.id === Number(td.dataset.sid));
      if (!p) return;
      const k = td.dataset.work as WorkKind;
      p.priorities[k] = (p.priorities[k] + 1) % 4;
    });

    this.menuBox.addEventListener('mousedown', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('button');
      if (!btn) return;
      this.sfx?.click();
      switch (btn.id) {
        case 'menu-resume': this.closeMenu(); break;
        case 'menu-save':
          if (this.onSave?.()) this.renderMenu('Saved.');
          else this.renderMenu('Save failed.');
          break;
        case 'menu-load': this.onLoad?.(); break;
        case 'menu-mute': this.sfx?.toggleMuted(); this.renderMenu(); break;
        case 'menu-music': this.music?.toggle(); this.music?.unlock(); this.renderMenu(); break;
        case 'menu-soundscape': this.soundscape?.toggle(); this.soundscape?.unlock(); this.renderMenu(); break;
        case 'menu-save-quit':
          if (this.onSave?.()) this.onQuit?.(true);
          else this.renderMenu('Save failed — check storage.');
          break;
        case 'menu-quit':
          if (confirm('Quit without saving? Unsaved progress will be lost.')) this.onQuit?.(false);
          break;
        case 'menu-restart':
          if (confirm('Abandon this colony and start over?')) this.onRestart?.();
          break;
      }
    });
  }

  private setHtml(box: HTMLElement, html: string): void {
    if (this.htmlCache.get(box) === html) return;
    this.htmlCache.set(box, html);
    box.innerHTML = html;
  }

  private buildBuildBar(): void {
    // Category tabs
    for (const cat of BUILD_CATEGORIES) {
      const btn = document.createElement('button');
      btn.className = 'build-cat-btn';
      btn.dataset.cat = cat.id;
      btn.innerHTML = `<span class="cat-icon">${cat.icon}</span><span>${cat.label}</span>`;
      btn.title = cat.items.map((i) => i.label).join(', ');
      btn.addEventListener('mousedown', () => {
        this.sfx?.click();
        this.toggleCategory(cat.id);
      });
      this.buildTabs.appendChild(btn);
    }

    // Extra: work priorities and overlay
    const prioBtn = document.createElement('button');
    prioBtn.className = 'build-cat-btn';
    prioBtn.innerHTML = `<span class="cat-icon">☰</span><span>WORK</span>`;
    prioBtn.title = 'Work Priorities [P]';
    prioBtn.addEventListener('mousedown', () => { this.sfx?.click(); this.togglePriorities(); });
    this.buildTabs.appendChild(prioBtn);

    const menuBtn = document.createElement('button');
    menuBtn.className = 'build-cat-btn';
    menuBtn.innerHTML = `<span class="cat-icon">≡</span><span>MENU</span>`;
    menuBtn.title = 'Menu [M]';
    menuBtn.addEventListener('mousedown', () => { this.sfx?.click(); this.toggleMenu(); });
    this.buildTabs.appendChild(menuBtn);

    // Found Town button (hidden by default)
    this.foundBtn = document.createElement('button');
    this.foundBtn.className = 'build-cat-btn pal-found-tab';
    this.foundBtn.innerHTML = `<span class="cat-icon">★</span><span>FOUND</span>`;
    this.foundBtn.title = 'Found Town #2';
    this.foundBtn.addEventListener('mousedown', () => {
      if (this.sim.canFoundSecondTown().ok && this.onFoundTown) this.onFoundTown();
    });
    this.buildTabs.appendChild(this.foundBtn);
  }

  private toggleCategory(catId: string): void {
    if (this.activeCat === catId) {
      this.activeCat = null;
      this.buildSubmenu.classList.add('hidden');
    } else {
      this.activeCat = catId;
      this.buildSubmenu.classList.remove('hidden');
      this.renderSubmenu();
    }
    this.refreshBuildBarState();
  }

  private renderSubmenu(): void {
    if (!this.activeCat) return;
    const cat = BUILD_CATEGORIES.find((c) => c.id === this.activeCat);
    if (!cat) return;
    this.buildSubmenu.innerHTML = '';
    for (const item of cat.items) {
      const btn = document.createElement('button');
      btn.className = 'build-item-btn';
      btn.dataset.kind = item.kind;
      btn.dataset.id = item.id;
      let label = item.label;
      if (item.cost) label += ` (${item.cost})`;
      btn.textContent = label;
      btn.title = item.desc + (item.hotkey ? ` [${item.hotkey.toUpperCase()}]` : '');
      // Mark active
      const active =
        (item.kind === 'building' && this.cam.placing === item.id) ||
        (item.kind === 'zone' && this.cam.placingZone === item.id) ||
        (item.kind === 'tool' && item.id === 'chop' && this.cam.chopMode);
      btn.classList.toggle('active', active);
      this.buildSubmenu.appendChild(btn);
    }
  }

  private handleBuildItemClick(kind: 'building' | 'zone' | 'tool', id: string): void {
    if (kind === 'building') {
      this.cam.placing = this.cam.placing === id ? null : id;
      this.cam.placingZone = null;
      this.cam.chopMode = false;
      if (this.cam.placing === null) this.cam.placingRotation = 0;
    } else if (kind === 'zone') {
      const zoneId = id as PaintKind;
      this.cam.placingZone = this.cam.placingZone === zoneId ? null : zoneId;
      this.cam.placing = null;
      this.cam.chopMode = false;
    } else if (kind === 'tool' && id === 'chop') {
      this.cam.chopMode = !this.cam.chopMode;
      this.cam.placing = null;
      this.cam.placingZone = null;
    } else if (kind === 'tool' && id === 'overlay') {
      this.cam.overlay = this.cam.overlay === 'traffic' ? 'none' : 'traffic';
    }
    this.refreshBuildBarState();
    if (this.activeCat) this.renderSubmenu();
  }

  refreshBuildBarState(): void {
    for (const btn of this.buildTabs.querySelectorAll<HTMLButtonElement>('.build-cat-btn')) {
      const id = btn.dataset.cat;
      btn.classList.toggle('active', id === this.activeCat);
    }
    if (this.activeCat) this.renderSubmenu();
  }

  // Palette hotkey support (letters on zone/tool items)
  handleKey(key: string): boolean {
    const k = key.toLowerCase();
    if (this.menuOpen) {
      if (k === 'm' || k === 'escape') { this.closeMenu(); return true; }
      return k.length === 1;
    }
    const zoneMap: Record<string, PaintKind> = {
      f: 'farm', t: 'stockpile', l: 'wall', g: 'gate', x: 'trap',
      '4': 'dirt', '5': 'plank', '6': 'gravel', '7': 'bridge',
      z: 'flax', b: 'pasture', n: 'mine',
    };
    if (zoneMap[k]) {
      this.cam.placingZone = this.cam.placingZone === zoneMap[k] ? null : zoneMap[k];
      this.cam.placing = null;
      this.cam.chopMode = false;
      this.refreshBuildBarState();
      // Auto-open defense/roads/zones category
      const catForZone: Record<string, string> = {
        wall: 'defense', gate: 'defense', trap: 'defense',
        dirt: 'roads', plank: 'roads', gravel: 'roads', bridge: 'roads',
        farm: 'zones', stockpile: 'zones', flax: 'zones', pasture: 'zones', mine: 'zones',
      };
      const cat = catForZone[k] ?? catForZone[zoneMap[k]];
      if (cat && this.activeCat !== cat) this.toggleCategory(cat);
      return true;
    }
    if (k === 'c') {
      this.cam.chopMode = !this.cam.chopMode;
      this.cam.placing = null;
      this.cam.placingZone = null;
      this.refreshBuildBarState();
      return true;
    }
    if (k === 'k') { this.techPanel.toggle(); return true; }
    if (k === 'o') { this.cam.overlay = this.cam.overlay === 'traffic' ? 'none' : 'traffic'; return true; }
    if (k === 'p') { this.togglePriorities(); return true; }
    if (k === 'm') { this.toggleMenu(); return true; }
    return false;
  }

  toggleMenu(): void { this.menuOpen ? this.closeMenu() : this.openMenu(); }

  openMenu(): void {
    this.menuOpen = true;
    this.pausedBeforeMenu = this.paused;
    this.paused = true;
    this.renderMenu();
    this.menuBox.classList.remove('hidden');
  }

  closeMenu(): void {
    this.menuOpen = false;
    this.paused = this.pausedBeforeMenu;
    this.menuBox.classList.add('hidden');
  }

  private togglePriorities(): void {
    this.showPriorities = !this.showPriorities;
    this.prioBox.classList.toggle('hidden', !this.showPriorities);
  }

  private renderMenu(note = ''): void {
    const canSave = this.onSave !== null;
    const canLoad = (this.hasSave?.() ?? false) && this.onLoad !== null;
    this.setHtml(this.menuBox,
      `<div class="menu-box">` +
      `<h2>CENTURIA</h2>` +
      `<p class="menu-note">${note || 'The colony waits.'}</p>` +
      `<button id="menu-resume">Resume [M]</button>` +
      `<button id="menu-save"${canSave ? '' : ' disabled'}>Save Game</button>` +
      `<button id="menu-load"${canLoad ? '' : ' disabled'}>Load Game</button>` +
      `<button id="menu-mute">${this.sfx?.muted ? 'Sound: OFF' : 'Sound: ON'}</button>` +
      `<button id="menu-music">${this.music?.enabled ? 'Music: ON' : 'Music: OFF'}</button>` +
      `<button id="menu-soundscape">${this.soundscape?.enabled ? 'Ambience: ON' : 'Ambience: OFF'}</button>` +
      `<button id="menu-save-quit"${canSave ? '' : ' disabled'}>Save &amp; Quit</button>` +
      `<button id="menu-quit">Quit without Saving</button>` +
      `<button id="menu-restart">Restart Colony</button>` +
      `</div>`);
  }

  setRegionMode(on: boolean): void {
    this.buildBar.classList.toggle('hidden', on);
    this.inspector.classList.toggle('hidden', on);
    this.prioBox.classList.add('hidden');
    if (on) this.showPriorities = false;
  }

  drawRegionTopBar(r: import('../sim/region').RegionSim, dioramaOpen: boolean): void {
    const wx = r.weather.forDay(r.day);
    const skyIcon = { clear: '☀', overcast: '☁', rain: '☔', storm: '⛈', snow: '❄' }[wx.sky];
    const drought = r.weather.isDrought(r.day) && r.seasonIndex < 3 ? ' <span class="tb-over">DROUGHT</span>' : '';
    this.setHtml(this.topBar,
      `<span class="tb-date">${r.dateLabel}</span>` +
      `<span>${skyIcon}${drought}</span>` +
      `<span>TOWNS ${r.settlements.length}${r.expeditions.length ? ` (+${r.expeditions.length} en route)` : ''}</span>` +
      `<span>POP ${r.totalPop()}</span>` +
      `<span>NOTABLES ${r.notables.filter((n) => n.alive).length}</span>` +
      (r.stateProclaimed ? `<span class="tb-date">★ STATE</span>` : '') +
      `<button id="tb-diorama" class="tb-btn">${dioramaOpen ? 'Region Map' : "Visit Founder's Rest"}</button>` +
      `<button id="tb-menu" class="tb-btn">Menu [Esc]</button>` +
      `<span class="tb-speed">${this.paused ? '⏸ PAUSED' : '▶'.repeat(this.speed)} <i>(space, 1-3)</i></span>` +
      (r.gameOver ? `<span class="tb-over">THE COLONY HAS PERISHED</span>` : ''));
    const menuBtn = this.topBar.querySelector<HTMLButtonElement>('#tb-menu');
    if (menuBtn) menuBtn.onclick = () => this.toggleMenu();
  }

  regionLog(r: import('../sim/region').RegionSim): void {
    if (r.log.length === this.lastLogLen) return;
    this.lastLogLen = r.log.length;
    this.setHtml(this.logBox, r.log.slice(-6).map((l) => `<div class="log-${l.kind}">d${l.day} · ${l.text}</div>`).reverse().join(''));
  }

  update(): void {
    this.drawTopBar();
    this.drawInspector();
    this.drawLog();
    this.drawGameOver();
    if (this.showPriorities) this.drawPriorities();
    this.techPanel.update();
    if (this.foundBtn) {
      const can = this.sim.canFoundSecondTown();
      this.foundBtn.disabled = !can.ok;
      this.foundBtn.title = can.ok ? 'Send an expedition — step up to the region map' : can.reason;
    }
  }

  private drawTopBar(): void {
    const s = this.sim;
    const hh = String(Math.floor(s.hour)).padStart(2, '0');
    const mm = String(Math.floor((s.hour % 1) * 60)).padStart(2, '0');
    const pop = s.settlers.length;
    const hardCap = TUNING.hardCapPop;
    const softCap = TUNING.softCapPop;
    const over = pop - softCap;
    const popDisplay = pop >= hardCap ? `<span class="tb-over">POP ${pop}/${hardCap}</span>` : `POP ${pop}/${hardCap}`;
    const capWarn = over > 0 && pop < hardCap ? ` ⚠ −${Math.round((1 - s.softCapWorkMult()) * 100)}%` : '';
    const skyIcon = { clear: '☀', overcast: '☁', rain: '☔', storm: '⛈', snow: '❄' }[s.weatherToday().sky];
    const drought = s.weather.isDrought(s.day) && s.growingSeason ? ' <span class="tb-over">DROUGHT</span>' : '';
    this.setHtml(this.topBar,
      `<span class="tb-date">${s.dateLabel} ${hh}:${mm}</span>` +
      `<span>${skyIcon} ${Math.round(s.temperature())}°C${drought}</span>` +
      `<span>${popDisplay}${capWarn}</span>` +
      `<span>💰` + formatCurrency(Math.round(s.economy.cash)) + `</span>` +
      `<span>🪵${s.stock.wood} ⛏${s.stock.stone} 🌾${s.stock.grain} 🍖${s.stock.meal} 👕${s.stock.clothes}${s.stock.weapons ? ` ⚔${s.stock.weapons}` : ''}</span>` +
      `<span title="average mood">♥${Math.round(s.avgMood())}</span>` +
      (s.raidActive ? `<span class="tb-over">⚔ RAID ${s.raiders.length}!</span>` : '') +
      `<span class="tb-speed">${this.paused ? '⏸' : '▶'.repeat(this.speed)} <i>(space 1-3)</i></span>`);
  }

  private drawInspector(): void {
    const s = this.sim;
    const settler = s.settlers.find((p) => p.id === this.cam.selectedSettler);
    const building = s.buildings.find((b) => b.id === this.cam.selectedBuilding);
    if (settler) {
      this.setHtml(this.inspector, this.settlerCard(settler));
      this.inspector.classList.remove('hidden');
    } else if (building) {
      this.setHtml(this.inspector, this.buildingCard(building));
      this.inspector.classList.remove('hidden');
    } else if (this.cam.selectedStockpile) {
      this.setHtml(this.inspector, this.stockpileCard());
      this.inspector.classList.remove('hidden');
    } else {
      this.inspector.classList.add('hidden');
    }
  }

  private stockpileCard(): string {
    const s = this.sim;
    const tileCount = s.world.tiles.filter((t) => t.stockpileZone).length;
    const mealCap = s.mealCap();
    const granaryCount = s.builtOf('granary').length;
    const rows = [
      ['Wood', s.stock.wood, '∞'],
      ['Stone', s.stock.stone, '∞'],
      ['Grain', s.stock.grain, '∞'],
      ['Meals', s.stock.meal, mealCap],
      ['Clothes', s.stock.clothes, '∞'],
      ['Weapons', s.stock.weapons, '∞'],
    ].map(([label, val, cap]) =>
      `<div class="bar-row"><span>${label}</span><div class="bar"><div class="bar-fill" style="width:${cap === '∞' ? 50 : Math.min(100, Math.round(Number(val) / Number(cap) * 100))}%"></div></div><span>${val}/${cap}</span></div>`
    ).join('');
    return (
      `<h3>Stockpile</h3>` +
      `<p class="insp-state">${tileCount} tile${tileCount !== 1 ? 's' : ''} designated</p>` +
      rows +
      (granaryCount > 0 ? `<p class="insp-skills">Meal cap: ${TUNING.mealCapBase} base + ${granaryCount} granary = ${mealCap}</p>` : `<p class="insp-skills">Build a Granary to extend meal storage.</p>`)
    );
  }

  private buildingCard(b: Building): string {
    const s = this.sim;
    const def = buildingDef(b.defId);
    const hasMarket = s.builtOf('trade').length > 0;
    const lvl = b.level ?? 1;
    const maxLvl = (def.upgrades?.length ?? 0) + 1;
    const nextUpgrade = def.upgrades?.[lvl - 1];
    const canUpgrade = nextUpgrade && Object.entries(nextUpgrade.cost).every(
      ([res, amt]) => (s.stock[res as ResourceKind] ?? 0) >= (amt as number),
    );
    const upgradeCostStr = nextUpgrade
      ? Object.entries(nextUpgrade.cost).map(([r, a]) => `${a}${r[0]}`).join(' ')
      : '';

    const workerCount = s.settlers.filter((p) => {
      const task = p.task;
      return task?.buildingId === b.id || (p.bedId === b.id && p.state === 'sleeping');
    }).length;
    const wl = b.workerLimit;
    const wlStr = wl === null ? 'Auto' : String(wl);

    let details = '';
    if (b.built) {
      const cap = s.buildingEffectiveCapacity(b);
      if (cap > 0) {
        const used = s.settlers.filter((p) => p.bedId === b.id).length;
        details += `<p class="insp-state">Occupancy: ${used}/${cap}</p>`;
      }
      if (def.provides === 'civic') details += this.civicPanel(b.id);
      if (def.provides === 'trade') details += this.tradePanel();
      if (def.provides === 'granary') {
        details += `<p class="insp-state">Adds ${TUNING.mealCapPerGranary + s.buildingEffectiveCapacity(b)} meal capacity</p>`;
      }
      if (def.provides === 'warmth') {
        const radius = TUNING.hearthRadius + (lvl >= 2 ? 2 : 0) + (lvl >= 3 ? 2 : 0);
        details += `<p class="insp-state">Warmth radius: ${radius} tiles</p>`;
      }
    }

    return (
      `<h3>${def.name}${b.built ? '' : ' <i>(building)</i>'}</h3>` +
      (b.built ? `<p class="insp-lvl">Level ${lvl}/${maxLvl}</p>` : '') +
      `<p>${def.desc}</p>` +
      (b.built ? details : `<p class="insp-state">wood ${b.delivered}/${def.cost.wood ?? 0} · work ${Math.max(0, Math.round(b.buildLeft))} min left</p>`) +
      (b.built
        ? `<p class="insp-workers">Workers: ${workerCount} active · Limit: ${wlStr}</p>` +
          `<button data-action="worker-dec" data-bid="${b.id}">−</button>` +
          `<button data-action="worker-auto" data-bid="${b.id}">Auto</button>` +
          `<button data-action="worker-inc" data-bid="${b.id}">+</button><br>`
        : '') +
      (nextUpgrade && b.built
        ? `<button class="upgrade" data-action="upgrade" data-bid="${b.id}"${canUpgrade ? '' : ' disabled'}>Upgrade (${upgradeCostStr}) → ${nextUpgrade.desc}</button>`
        : '') +
      (b.built
        ? `<button class="danger" data-action="destroy" data-bid="${b.id}">Demolish</button>` +
          (hasMarket ? `<button data-action="sell" data-bid="${b.id}">Sell</button>` : '')
        : `<button data-action="cancel" data-bid="${b.id}">Cancel</button>`)
    );
  }

  private tradePanel(): string {
    const offers = Object.entries(TUNING.tradeRates).map(([key, r]) => {
      const [give, get] = key.split('->');
      const can = this.sim.stock[give as ResourceKind] >= r.give;
      return `<button class="trade-btn" data-give="${give}" data-get="${get}"${can ? '' : ' disabled'}>${r.give}${give[0]}→${r.get}${get[0]}</button>`;
    }).join(' ');
    // Sell stock for coin: how the colony banks the cash that founding a town requires
    const sellable: ResourceKind[] = ['wood', 'stone', 'grain', 'meal', 'clothes'];
    const sells = sellable.map((kind) => {
      const price = getMarketPrice(this.sim.economy, kind);
      const can = this.sim.stock[kind] >= 5;
      return `<button class="sell-cash-btn" data-kind="${kind}"${can ? '' : ' disabled'}>5 ${kind} → ` + formatCurrency(price * 5) + `</button>`;
    }).join(' ');
    return `<p class="insp-skills">BARTER:</p><p>${offers}</p>` +
      `<p class="insp-skills">SELL FOR COIN (` + formatCurrency(Math.round(this.sim.economy.cash)) + `):</p><p>${sells}</p>`;
  }

  private civicPanel(bid: number): string {
    const s = this.sim;
    const done = s.townTechsResearched.length;
    let researchLine = '';
    if (s.activeResearch) {
      const def = TOWN_TECH_DEFS.find((d) => d.id === s.activeResearch!.techId);
      const pct = def
        ? Math.round((1 - s.activeResearch.workLeft / (def.days * 1440)) * 100)
        : 0;
      researchLine = `<p class="insp-state">Researching: ${def?.name ?? s.activeResearch.techId} (${pct}%)</p>`;
    } else if (s.researchQueue.length > 0) {
      researchLine = `<p class="insp-state">Queued: ${s.researchQueue.length} tech(s)</p>`;
    } else {
      researchLine = `<p class="insp-state" style="color:#554e44">No active research</p>`;
    }
    return researchLine +
      `<p class="insp-skills">Techs researched: ${done}</p>` +
      `<button data-action="open-tech" data-bid="${bid}">Tech Tree [K]</button>`;
  }

  private drawGameOver(): void {
    if (!this.sim.gameOver) { this.gameOverBox.classList.add('hidden'); return; }
    if (this.gameOverBox.classList.contains('hidden')) {
      this.setHtml(this.gameOverBox,
        `<div class="gameover-box">` +
        `<h1>YOU LOSE</h1>` +
        `<p>The colony has perished. ${this.sim.dateLabel} — ${this.sim.graves.length} graves.</p>` +
        `<button id="go-restart">RESTART</button>` +
        `</div>`);
      this.gameOverBox.classList.remove('hidden');
      const btn = this.gameOverBox.querySelector<HTMLButtonElement>('#go-restart');
      if (btn) btn.onclick = () => this.onRestart?.();
    }
  }

  private moodBreakdown(p: Settler): string {
    const w = TUNING.moodWeights;
    const parts: [string, number][] = [
      ['food', p.needs.food * w.food],
      ['rest', p.needs.rest * w.rest],
      ['warmth', p.needs.warmth * w.warmth],
      ['recreation', p.needs.recreation * w.recreation],
      ['social', p.needs.social * w.social],
    ];
    for (const id of p.traits) { const mb = traitDef(id).moodBase ?? 0; if (mb !== 0) parts.push([traitDef(id).name, mb]); }
    for (const th of p.thoughts) parts.push([th.label, th.delta]);
    const cap = this.sim.softCapMoodPenalty();
    if (cap > 0) parts.push(['crowding', -cap]);
    const total = Math.max(0, Math.min(100, parts.reduce((s, [, v]) => s + v, 0)));
    return 'MOOD:\n' + parts.map(([l, v]) => `${v >= 0 ? '+' : ''}${Math.round(v)}  ${l}`).join('\n') + `\n= ${Math.round(total)}`;
  }

  private settlerCard(p: Settler): string {
    const bar = (label: string, v: number, tip = '') =>
      `<div class="bar-row"${tip ? ` title="${tip.replace(/"/g, '&quot;')}"` : ''}><span>${label}${tip ? ' ⓘ' : ''}</span><div class="bar"><div class="bar-fill" style="width:${Math.round(v)}%"></div></div><span>${Math.round(v)}</span></div>`;
    const thoughts = p.thoughts.map((t) => `<li>${t.label} (${t.delta > 0 ? '+' : ''}${t.delta})</li>`).join('');
    const traits = p.traits.map((t) => `<abbr title="${traitDef(t).desc}">${traitDef(t).name}</abbr>`).join(', ');
    const skills = WORK_KINDS.map((k) => `${k} ${p.skills[k].toFixed(1)}`).join(' · ');
    const conditions = [
      p.wound?.untreated ? 'wounded' : p.wound ? 'wound (treated)' : '',
      p.infection ? 'INFECTED' : '',
      p.sickUntil > this.sim.minute ? 'fever' : '',
      p.clothedUntil > this.sim.minute ? '' : 'threadbare',
    ].filter(Boolean).join(' · ');
    const friends = this.sim.friendsOf(p).slice(0, 3)
      .map((f) => `${f.name.split(' ')[0]} (${Math.round(this.sim.opinionBetween(p, f))})`)
      .join(', ');
    return (
      `<h3>${p.name}, ${p.age}</h3>` +
      `<p class="insp-state">${p.state}${p.task ? ` — ${p.task.label}` : ''} · hp ${Math.round(p.health)}</p>` +
      (conditions ? `<p class="insp-cond">${conditions}</p>` : '') +
      `<p>${traits}</p>` +
      bar('mood', p.mood, this.moodBreakdown(p)) + bar('food', p.needs.food) + bar('rest', p.needs.rest) +
      bar('warmth', p.needs.warmth) + bar('rec', p.needs.recreation) + bar('social', p.needs.social) +
      `<p class="insp-skills">${skills}</p>` +
      (friends ? `<p class="insp-skills">friends: ${friends}</p>` : '') +
      (thoughts ? `<ul class="thoughts">${thoughts}</ul>` : '')
    );
  }

  private drawLog(): void {
    if (this.sim.log.length === this.lastLogLen) return;
    this.lastLogLen = this.sim.log.length;
    this.setHtml(this.logBox, this.sim.log.slice(-6).map((l) => `<div class="log-${l.kind}">d${l.day} · ${l.text}</div>`).reverse().join(''));
  }

  private drawPriorities(): void {
    const rows = this.sim.settlers.map((p) => {
      const cells = WORK_KINDS.map(
        (k) => `<td class="prio prio-${p.priorities[k]}" data-sid="${p.id}" data-work="${k}">${p.priorities[k] || '·'}</td>`,
      ).join('');
      return `<tr><td class="prio-name">${p.name.split(' ')[0]}</td>${cells}</tr>`;
    }).join('');
    this.setHtml(this.prioBox,
      `<table><tr><th>Work (click=cycle)</th>${WORK_KINDS.map((k) => `<th>${k}</th>`).join('')}</tr>${rows}</table>`);
  }
}
