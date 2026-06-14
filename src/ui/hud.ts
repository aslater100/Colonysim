/**
 * DOM HUD: top bar, bottom build toolbar (Cities-Skylines style with categories),
 * inspector panel, work priorities, event log.
 */
import type { Simulation, Settler, Building } from '../sim/sim';
import { buildingDef, traitDef, WORK_KINDS, TUNING, TOWN_TECH_DEFS, formatCurrency, ROOM_TYPE_ID, STATION_TYPE_ID } from '../sim/defs';
import type { ResourceKind, WorkKind } from '../sim/defs';
import { BASE_PRICES } from '../sim/economy';
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
  kind: 'building' | 'zone' | 'tool' | 'room-tool' | 'blueprint';
  id: string;
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
      { kind: 'building', id: 'coke_furnace', label: 'Coke Furnace', cost: '12s+4b', desc: '3 coal→1 coke. Coke is the smelter\'s fuel — without it, iron halts. Needs Coke Production tech.' },
      { kind: 'building', id: 'blacksmith', label: 'Blacksmith', cost: '25w+10s', desc: '3 iron ore+1 coke→iron, 2 iron→tools. Tools speed construction +20%. Needs Blacksmithing tech.' },
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
    id: 'rooms',
    icon: '⬛',
    label: 'ROOMS',
    items: [
      // Paint tools
      { kind: 'room-tool', id: 'wall', label: 'Wall [V]', hotkey: 'v', desc: 'Paint room walls.' },
      { kind: 'room-tool', id: 'floor', label: 'Floor', desc: 'Paint interior floors.' },
      { kind: 'room-tool', id: 'erase', label: 'Erase', desc: 'Remove walls, floors, and room designations.' },
      // Room designations
      { kind: 'room-tool', id: 'room-home', label: 'Home', desc: 'Sleeping quarters. Place beds/bunks inside.' },
      { kind: 'room-tool', id: 'room-kitchen', label: 'Kitchen', desc: 'Cook grain into meals. Needs ovens.' },
      { kind: 'room-tool', id: 'room-bakery', label: 'Bakery', desc: 'Bake flour into bread. Needs baking ovens.' },
      { kind: 'room-tool', id: 'room-mill', label: 'Mill', desc: 'Grind grain into flour. Needs millstones.' },
      { kind: 'room-tool', id: 'room-smithy', label: 'Smithy', desc: 'Forge iron into tools and weapons.' },
      { kind: 'room-tool', id: 'room-foundry', label: 'Foundry', desc: 'Smelt ore into iron. Needs smelters.' },
      { kind: 'room-tool', id: 'room-sawmill', label: 'Sawmill', desc: 'Cut wood into timber. Needs saw benches.' },
      { kind: 'room-tool', id: 'room-workshop', label: 'Workshop', desc: 'Weave flax into cloth and rope.' },
      { kind: 'room-tool', id: 'room-kilnhouse', label: 'Kilnhouse', desc: 'Fire clay into brick; coal into coke.' },
      { kind: 'room-tool', id: 'room-library', label: 'Library', desc: 'Study and research. Needs desks.' },
      { kind: 'room-tool', id: 'room-infirmary', label: 'Infirmary', desc: 'Treat the sick. Needs sickbeds.' },
      { kind: 'room-tool', id: 'room-apothecary', label: 'Apothecary', desc: 'Brew herbs into medicine.' },
      { kind: 'room-tool', id: 'room-tavern', label: 'Tavern', desc: 'Recreation and ale. Needs tables.' },
      { kind: 'room-tool', id: 'room-storehouse', label: 'Storehouse', desc: 'Bulk storage. Needs shelves.' },
      // Stations
      { kind: 'room-tool', id: 'station-bed', label: 'Bed', desc: 'Sleeping slot (1) in a Home.' },
      { kind: 'room-tool', id: 'station-bunk', label: 'Bunk', desc: 'Sleeping slots (3) in a Home.' },
      { kind: 'room-tool', id: 'station-oven', label: 'Oven', desc: 'Grain→meal in a Kitchen.' },
      { kind: 'room-tool', id: 'station-millstone', label: 'Millstone', desc: 'Grain→flour in a Mill.' },
      { kind: 'room-tool', id: 'station-saw_bench', label: 'Saw Bench', desc: 'Wood→timber in a Sawmill.' },
      { kind: 'room-tool', id: 'station-loom', label: 'Loom', desc: 'Flax→clothes in a Workshop.' },
      { kind: 'room-tool', id: 'station-sickbed', label: 'Sickbed', desc: 'Medical slot in an Infirmary.' },
      { kind: 'room-tool', id: 'station-desk', label: 'Desk', desc: 'Education slot in a Library.' },
      { kind: 'room-tool', id: 'station-table', label: 'Table', desc: 'Recreation slots (2) in a Tavern.' },
      { kind: 'room-tool', id: 'station-shelf', label: 'Shelf', desc: 'Storage (+50) in Storehouse or Library.' },
      // Blueprint stamps
      { kind: 'blueprint', id: 'hut', label: 'Hut (5×5)', desc: 'Small sleeping hut with 2 beds.' },
      { kind: 'blueprint', id: 'kitchen', label: 'Kitchen (5×4)', desc: '2 ovens cook grain into meals.' },
      { kind: 'blueprint', id: 'mill', label: 'Mill (6×6)', desc: '2 millstones grind grain into flour.' },
      { kind: 'blueprint', id: 'sawmill', label: 'Sawmill (7×4)', desc: '2 saw benches cut timber.' },
      { kind: 'blueprint', id: 'workshop', label: 'Workshop (8×4)', desc: 'Loom + rope walk.' },
      { kind: 'blueprint', id: 'tavern', label: 'Tavern (7×6)', desc: 'Tables + brew vat.' },
      { kind: 'blueprint', id: 'infirmary', label: 'Infirmary (6×5)', desc: '3 sickbeds treat the wounded.' },
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
  private menuView: 'main' | 'options' = 'main';
  private pausedBeforeMenu = false;
  private topBar: HTMLElement;
  private buildBar: HTMLElement;
  private buildSubmenu: HTMLElement;
  private buildTabs: HTMLElement;
  private inspector: HTMLElement;
  private logBox: HTMLElement;
  private prioBox: HTMLElement;
  private gameOverBox: HTMLElement;
  private regionBottomBar: HTMLElement;
  private menuBox: HTMLElement;
  private showPriorities = false;
  private showResources = false;
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
    this.regionBottomBar = el('div', 'region-bottombar hidden', root);

    this.buildBuildBar();
    this.techPanel = new TechPanel(root, sim);

    // Delegate clicks on the submenu
    this.buildSubmenu.addEventListener('mousedown', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('.build-item-btn');
      if (!btn) return;
      this.sfx?.click();
      const kind = btn.dataset.kind as 'building' | 'zone' | 'tool' | 'room-tool' | 'blueprint';
      const id = btn.dataset.id!;
      this.handleBuildItemClick(kind, id);
    });

    // Delegate clicks on inspector
    this.inspector.addEventListener('mousedown', (e) => {
      const shift = (e as MouseEvent).shiftKey;
      // Barter: base button trades 1 (Shift = all we can afford); ×N buttons carry their own qty.
      const trade = (e.target as HTMLElement).closest<HTMLElement>('.trade-btn, .trade-bulk');
      if (trade) {
        const give = trade.dataset.give as ResourceKind;
        const get = trade.dataset.get as ResourceKind;
        const rate = TUNING.tradeRates[`${give}->${get}`];
        const max = rate ? Math.floor((this.sim.stock[give] ?? 0) / rate.give) : 1;
        const qty = shift ? max : Number(trade.dataset.qty ?? 1);
        this.sim.trade(give, get, Math.max(1, qty));
        return;
      }
      // Sell for coin: Shift+click (or the ×all button) sells the whole stock.
      const sell = (e.target as HTMLElement).closest<HTMLElement>('.sell-cash-btn, .sell-bulk');
      if (sell) {
        const kind = sell.dataset.kind as ResourceKind;
        const have = this.sim.stock[kind] ?? 0;
        const qty = shift ? have : Math.min(Number(sell.dataset.qty ?? 5), have);
        if (qty > 0) this.sim.sellToMarket(kind, qty);
        return;
      }
      // Buy with coin: Shift+click on the base button buys 25.
      const buy = (e.target as HTMLElement).closest<HTMLElement>('.buy-cash-btn');
      if (buy) {
        const kind = buy.dataset.kind as ResourceKind;
        const qty = shift ? 25 : Number(buy.dataset.qty ?? 5);
        this.sim.buyFromMarket(kind, Math.max(1, qty));
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
        case 'worker-dec':
          this.sim.unassignWorker(bid);
          break;
        case 'worker-inc':
          this.sim.assignWorker(bid);
          break;
        case 'worker-auto':
          this.sim.clearBuildingAssignments(bid);
          break;
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
        case 'menu-options':
          this.menuView = 'options';
          this.renderMenu();
          break;
        case 'menu-opt-back':
          this.menuView = 'main';
          this.renderMenu();
          break;
        case 'menu-opt-sound': this.sfx?.toggleMuted(); this.renderMenu(); break;
        case 'menu-opt-music': this.music?.toggle(); this.music?.unlock(); this.renderMenu(); break;
        case 'menu-opt-ambience': this.soundscape?.toggle(); this.soundscape?.unlock(); this.renderMenu(); break;
        case 'menu-opt-fullscreen':
          if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
          else document.exitFullscreen?.().catch(() => {});
          this.renderMenu();
          break;
        case 'menu-quit-menu':
          if (confirm('Save and return to main menu?')) {
            this.onSave?.();
            this.onRestart?.();
          }
          break;
        case 'menu-quit-desktop':
          if (confirm('Quit to desktop? Unsaved progress will be lost.')) this.onQuit?.(false);
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
      // Tech gating: disable building buttons when their required tech is missing.
      if (item.kind === 'building') {
        try {
          const def = buildingDef(item.id);
          if (def.requiredTech && !this.sim.hasTech(def.requiredTech)) {
            btn.disabled = true;
            btn.classList.add('locked');
            const techDef = TOWN_TECH_DEFS.find((t) => t.id === def.requiredTech);
            btn.title = `Requires: ${techDef?.name ?? def.requiredTech}`;
          } else {
            btn.title = item.desc + (item.hotkey ? ` [${item.hotkey.toUpperCase()}]` : '');
          }
        } catch {
          btn.title = item.desc + (item.hotkey ? ` [${item.hotkey.toUpperCase()}]` : '');
        }
      } else {
        btn.title = item.desc + (item.hotkey ? ` [${item.hotkey.toUpperCase()}]` : '');
      }
      // Mark active
      const active =
        (item.kind === 'building' && this.cam.placing === item.id) ||
        (item.kind === 'zone' && this.cam.placingZone === item.id) ||
        (item.kind === 'tool' && item.id === 'chop' && this.cam.chopMode) ||
        (item.kind === 'room-tool' && (
          ((item.id === 'wall' || item.id === 'floor' || item.id === 'erase') && this.cam.roomPaintMode === item.id) ||
          (item.id.startsWith('room-') && this.cam.roomPaintMode === 'room' && ROOM_TYPE_ID.get(item.id.slice(5)) === this.cam.roomTypeId) ||
          (item.id.startsWith('station-') && this.cam.roomPaintMode === 'station' && STATION_TYPE_ID.get(item.id.slice(8)) === this.cam.stationTypeId)
        )) ||
        (item.kind === 'blueprint' && this.cam.stampBlueprint === item.id);
      btn.classList.toggle('active', active);
      this.buildSubmenu.appendChild(btn);
    }
  }

  private handleBuildItemClick(kind: 'building' | 'zone' | 'tool' | 'room-tool' | 'blueprint', id: string): void {
    if (kind === 'building') {
      this.cam.placing = this.cam.placing === id ? null : id;
      this.cam.placingZone = null;
      this.cam.chopMode = false;
      this.cam.roomPaintMode = null;
      this.cam.stampBlueprint = null;
      if (this.cam.placing === null) this.cam.placingRotation = 0;
    } else if (kind === 'zone') {
      const zoneId = id as PaintKind;
      this.cam.placingZone = this.cam.placingZone === zoneId ? null : zoneId;
      this.cam.placing = null;
      this.cam.chopMode = false;
      this.cam.roomPaintMode = null;
      this.cam.stampBlueprint = null;
    } else if (kind === 'tool' && id === 'chop') {
      this.cam.chopMode = !this.cam.chopMode;
      this.cam.placing = null;
      this.cam.placingZone = null;
      this.cam.roomPaintMode = null;
      this.cam.stampBlueprint = null;
    } else if (kind === 'tool' && id === 'overlay') {
      this.cam.overlay = this.cam.overlay === 'traffic' ? 'none' : 'traffic';
    } else if (kind === 'room-tool') {
      this.cam.placing = null;
      this.cam.placingZone = null;
      this.cam.chopMode = false;
      this.cam.stampBlueprint = null;
      if (id === 'wall' || id === 'floor' || id === 'erase') {
        this.cam.roomPaintMode = this.cam.roomPaintMode === id ? null : id as typeof this.cam.roomPaintMode;
        this.cam.roomTypeId = 0;
        this.cam.stationTypeId = 0;
      } else if (id.startsWith('room-')) {
        const typeId = ROOM_TYPE_ID.get(id.slice(5)) ?? 0;
        const toggle = this.cam.roomPaintMode === 'room' && this.cam.roomTypeId === typeId;
        this.cam.roomPaintMode = toggle ? null : 'room';
        this.cam.roomTypeId = toggle ? 0 : typeId;
        this.cam.stationTypeId = 0;
      } else if (id.startsWith('station-')) {
        const stId = STATION_TYPE_ID.get(id.slice(8)) ?? 0;
        const toggle = this.cam.roomPaintMode === 'station' && this.cam.stationTypeId === stId;
        this.cam.roomPaintMode = toggle ? null : 'station';
        this.cam.stationTypeId = toggle ? 0 : stId;
        this.cam.roomTypeId = 0;
      }
    } else if (kind === 'blueprint') {
      this.cam.placing = null;
      this.cam.placingZone = null;
      this.cam.chopMode = false;
      this.cam.roomPaintMode = null;
      this.cam.stampBlueprint = this.cam.stampBlueprint === id ? null : id;
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
    if (k === 'v') {
      const toggle = this.cam.roomPaintMode === 'wall';
      this.cam.placing = null; this.cam.placingZone = null; this.cam.chopMode = false; this.cam.stampBlueprint = null;
      this.cam.roomPaintMode = toggle ? null : 'wall';
      this.cam.roomTypeId = 0; this.cam.stationTypeId = 0;
      this.refreshBuildBarState();
      if (!toggle && this.activeCat !== 'rooms') this.toggleCategory('rooms');
      return true;
    }
    if (k === 'r') { this.showResources = !this.showResources; return true; }
    if (k === 'k') { this.techPanel.toggle(); return true; }
    if (k === 'o') { this.cam.overlay = this.cam.overlay === 'traffic' ? 'none' : 'traffic'; return true; }
    if (k === 'p') { this.togglePriorities(); return true; }
    if (k === 'm') { this.toggleMenu(); return true; }
    return false;
  }

  toggleMenu(): void { this.menuOpen ? this.closeMenu() : this.openMenu(); }

  openMenu(): void {
    this.menuOpen = true;
    this.menuView = 'main';
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
    const isFullscreen = !!document.fullscreenElement;
    const body = this.menuView === 'options'
      ? `<div class="menu-section">` +
        `<button id="menu-opt-back" class="menu-btn-back">‹  Back</button>` +
        `</div>` +
        `<div class="menu-section">` +
        `<button id="menu-opt-sound" class="menu-toggle">` +
        `<span class="menu-toggle-label">Sound Effects</span>` +
        `<span class="menu-toggle-val ${this.sfx?.muted ? 'menu-off' : 'menu-on'}">${this.sfx?.muted ? 'OFF' : 'ON'}</span>` +
        `</button>` +
        `<button id="menu-opt-music" class="menu-toggle">` +
        `<span class="menu-toggle-label">Music</span>` +
        `<span class="menu-toggle-val ${this.music?.enabled ? 'menu-on' : 'menu-off'}">${this.music?.enabled ? 'ON' : 'OFF'}</span>` +
        `</button>` +
        `<button id="menu-opt-ambience" class="menu-toggle">` +
        `<span class="menu-toggle-label">Ambience</span>` +
        `<span class="menu-toggle-val ${this.soundscape?.enabled ? 'menu-on' : 'menu-off'}">${this.soundscape?.enabled ? 'ON' : 'OFF'}</span>` +
        `</button>` +
        `</div>` +
        `<div class="menu-section menu-section-last">` +
        `<button id="menu-opt-fullscreen" class="menu-toggle">` +
        `<span class="menu-toggle-label">Display Mode</span>` +
        `<span class="menu-toggle-val">${isFullscreen ? 'Fullscreen' : 'Windowed'}</span>` +
        `</button>` +
        `</div>`
      : `<div class="menu-section">` +
        `<button id="menu-resume" class="menu-btn-primary">▶  Resume  <span class="menu-key">[M]</span></button>` +
        `<button id="menu-save"${canSave ? '' : ' disabled'}>  Save</button>` +
        `<button id="menu-load"${canLoad ? '' : ' disabled'}>  Load</button>` +
        `<button id="menu-options">  Options  <span class="menu-key">›</span></button>` +
        `</div>` +
        `<div class="menu-section menu-section-last">` +
        `<button id="menu-quit-menu" class="menu-btn-danger">  Quit to Home</button>` +
        `<button id="menu-quit-desktop" class="menu-btn-danger">  Quit to Desktop</button>` +
        `</div>`;
    this.setHtml(this.menuBox,
      `<div class="menu-box">` +
      `<div class="menu-header">` +
      `<h2>C E N T U R I A</h2>` +
      `<p class="menu-note">${note || 'The colony waits.'}</p>` +
      `</div>` +
      body +
      `</div>`);
  }

  setRegionMode(on: boolean): void {
    this.buildBar.classList.toggle('hidden', on);
    this.inspector.classList.toggle('hidden', on);
    this.regionBottomBar.classList.toggle('hidden', !on);
    this.prioBox.classList.add('hidden');
    if (on) this.showPriorities = false;
  }

  drawRegionBottomBar(r: import('../sim/region').RegionSim): void {
    if (this.regionBottomBar.classList.contains('hidden')) return;
    const alerts: string[] = [];
    if (r.stateProclaimed) {
      const hungry = r.settlements.filter((t) => t.factionId === r.playerFactionId && t.food < r.popOf(t) * 3);
      if (hungry.length) alerts.push(`<span class="rbb-alert">⚠ ${hungry.length} town${hungry.length > 1 ? 's' : ''} hungry</span>`);
      const striking = r.settlements.filter((t) => t.factionId === r.playerFactionId && r.day < t.strikeUntil);
      if (striking.length) alerts.push(`<span class="rbb-alert">⚡ ${striking.length} on strike</span>`);
      const delta = Math.round(r.treasuryDeltaMonth);
      if (delta < -500) alerts.push(`<span class="rbb-alert">📉 treasury declining</span>`);
    }
    this.setHtml(this.regionBottomBar,
      `<div class="rbb-alerts">${alerts.join(' ')}</div>` +
      `<div class="rbb-shortcuts">` +
      `<button class="rbb-btn" id="rbb-towns" title="Settlement list (S)">S: Towns</button>` +
      `<button class="rbb-btn" id="rbb-routes" title="Route network (R)">R: Routes</button>` +
      `<button class="rbb-btn" id="rbb-econ" title="Economy panel (E)">E: Economy</button>` +
      `<button class="rbb-btn" id="rbb-tech" title="Research tree (T)">T: Research</button>` +
      `</div>` +
      `<div class="rbb-speed">` +
      `<button class="rbb-speed-btn" id="rbb-pause" title="Space">${this.paused ? '▶ Play' : '⏸ Pause'}</button>` +
      `<button class="rbb-speed-btn${this.speed === 1 ? ' active' : ''}" id="rbb-s1" title="1">1×</button>` +
      `<button class="rbb-speed-btn${this.speed === 3 ? ' active' : ''}" id="rbb-s2" title="2">2×</button>` +
      `<button class="rbb-speed-btn${this.speed === 8 ? ' active' : ''}" id="rbb-s3" title="3">3×</button>` +
      `</div>`,
    );
    // Use onclick= (not addEventListener) so re-running this every frame doesn't
    // stack duplicate listeners when setHtml returns early from its cache.
    (this.regionBottomBar.querySelector('#rbb-pause') as HTMLElement).onclick = () => { this.paused = !this.paused; };
    (this.regionBottomBar.querySelector('#rbb-s1') as HTMLElement).onclick = () => { this.speed = 1; this.paused = false; };
    (this.regionBottomBar.querySelector('#rbb-s2') as HTMLElement).onclick = () => { this.speed = 3; this.paused = false; };
    (this.regionBottomBar.querySelector('#rbb-s3') as HTMLElement).onclick = () => { this.speed = 8; this.paused = false; };
    const dispatch = (key: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    (this.regionBottomBar.querySelector('#rbb-towns') as HTMLElement).onclick = () => dispatch('s');
    (this.regionBottomBar.querySelector('#rbb-routes') as HTMLElement).onclick = () => dispatch('r');
    (this.regionBottomBar.querySelector('#rbb-econ') as HTMLElement).onclick = () => dispatch('e');
    (this.regionBottomBar.querySelector('#rbb-tech') as HTMLElement).onclick = () => dispatch('t');
  }

  drawRegionTopBar(r: import('../sim/region').RegionSim, dioramaOpen: boolean): void {
    const wx = r.weather.forDay(r.day);
    const skyIcon = { clear: '☀', overcast: '☁', rain: '☔', storm: '⛈', snow: '❄' }[wx.sky];
    const drought = r.weather.isDrought(r.day) && r.seasonIndex < 3 ? ' <span class="tb-over">DROUGHT</span>' : '';
    // Treasury with last month's net swing — a stable monthly figure beats a
    // per-frame arrow that flickers as daily events nudge the books.
    const gold = r.treasury;
    const delta = Math.round(r.treasuryDeltaMonth);
    const trendColor = delta > 0 ? '#7fc26a' : delta < 0 ? '#e0995a' : '#998c6e';
    const trendStr = delta === 0
      ? ''
      : ` <span style="color:${trendColor}" title="net change in the treasury over the last month">` +
        `${delta > 0 ? '▲' : '▼'}${formatCurrency(Math.abs(delta))}/mo</span>`;
    // Player's share of regional territory — the road to nationhood.
    const terr = Math.round(r.playerTerritoryControl() * 100);
    this.setHtml(this.topBar,
      `<span class="tb-date">${r.dateLabel}</span>` +
      `<span>${skyIcon}${drought}</span>` +
      `<span>TOWNS ${r.settlements.length}${r.expeditions.length ? ` (+${r.expeditions.length} en route)` : ''}</span>` +
      `<span>POP ${r.totalPop()}</span>` +
      `<span>💰${formatCurrency(Math.round(gold))}${trendStr}</span>` +
      `<span title="your share of regional territory">⬣ ${terr}%</span>` +
      `<span>NOTABLES ${r.notables.filter((n) => n.alive).length}</span>` +
      (r.stateProclaimed ? `<span class="tb-date">★ STATE</span>` : '') +
      `<button id="tb-diorama" class="tb-btn">${dioramaOpen ? 'Region Map' : "Visit Founder's Rest"}</button>` +
      `<button id="tb-menu" class="tb-btn">Menu [Esc]</button>` +
      `<span class="tb-speed">${this.paused ? '⏸ PAUSED' : '▶'.repeat(this.speed)} <i>(space, 1-3)</i></span>` +
      (r.gameOver ? `<span class="tb-over">THE COLONY HAS PERISHED</span>` : ''));
    const menuBtn = this.topBar.querySelector<HTMLButtonElement>('#tb-menu');
    if (menuBtn) menuBtn.onclick = () => this.toggleMenu();
  }

  resetLogLen(): void { this.lastLogLen = 0; }

  regionLog(r: import('../sim/region').RegionSim): void {
    if (r.log.length === this.lastLogLen) return;
    this.lastLogLen = r.log.length;
    const DAYS_PER_YEAR = 360;
    const START_YEAR = 1900;
    const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];
    const label = (day: number): string => {
      const y = START_YEAR + Math.floor(day / DAYS_PER_YEAR);
      const s = SEASONS[Math.floor((day % DAYS_PER_YEAR) / (DAYS_PER_YEAR / 4)) % 4];
      return `${s} ${y}`;
    };
    this.setHtml(this.logBox, r.log.slice(-8).map((l) => `<div class="log-${l.kind}">${label(l.day)} · ${l.text}</div>`).reverse().join(''));
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

  private activeWarnings(): { level: 'yellow' | 'red'; text: string }[] {
    const s = this.sim;
    const w: { level: 'yellow' | 'red'; text: string }[] = [];
    // Food warnings (GDD thresholds)
    const totalFood = s.totalFood();
    if (totalFood === 0) w.push({ level: 'red', text: 'FAMINE — no food!' });
    else if (totalFood < TUNING.warnFoodYellow) w.push({ level: 'yellow', text: `Food critical (${totalFood} left)` });
    // Coal warnings
    if (s.stock.coal === 0 && s.builtOf('mining').some((b) => b.built)) {
      w.push({ level: 'red', text: 'Coal exhausted — furnaces idle' });
    } else if (s.stock.coal < TUNING.warnCoalYellow && s.stock.coal > 0 && s.hasTech('iron_mining')) {
      w.push({ level: 'yellow', text: `Coal low (${s.stock.coal} left)` });
    }
    // Coke warnings — if smelting chain is active but coke is empty
    if (s.stock.coke === 0 && s.hasTech('coke_production') && s.stock.iron < 5) {
      w.push({ level: 'yellow', text: 'No coke — smelter idle' });
    }
    // Unemployment warnings
    const idle = s.settlers.filter((p) => !p.task && !p.assignedBuildingId).length;
    const idleFrac = s.settlers.length > 0 ? idle / s.settlers.length : 0;
    if (idleFrac > TUNING.warnUnemployRed) w.push({ level: 'red', text: `${Math.round(idleFrac * 100)}% settlers idle` });
    else if (idleFrac > TUNING.warnUnemployYellow) w.push({ level: 'yellow', text: `${Math.round(idleFrac * 100)}% settlers idle` });
    return w;
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
    const eraNames: Record<number, string> = { 1: 'Pre-Industrial', 2: 'Industrial', 3: 'Modern', 4: 'Post-Industrial' };
    const eraLabel = `<span class="tb-era" title="Current game era">Era ${s.era}: ${eraNames[s.era] ?? ''}</span>`;
    const warnings = this.activeWarnings();
    const warnHtml = warnings.map((w) =>
      `<span class="${w.level === 'red' ? 'tb-over' : 'tb-warn'}" title="${w.text}">⚠ ${w.text}</span>`
    ).join('');
    this.setHtml(this.topBar,
      `<span class="tb-date">${s.dateLabel} ${hh}:${mm}</span>` +
      eraLabel +
      `<span>${skyIcon} ${Math.round(s.temperature() * 9 / 5 + 32)}°F${drought}</span>` +
      `<span>${popDisplay}${capWarn}</span>` +
      `<span>💰` + formatCurrency(Math.round(s.economy.cash)) + `</span>` +
      `<span><span class="res-wood">≡</span>${s.stock.wood} ⛏${s.stock.stone} 🌾${s.stock.grain} 🍖${s.totalFood()} 👕${s.stock.clothes}${s.stock.weapons ? ` ⚔${s.stock.weapons}` : ''}${s.stock.coke ? ` 🔥${s.stock.coke}` : ''}</span>` +
      `<span title="average mood">♥${Math.round(s.avgMood())}</span>` +
      warnHtml +
      (s.raidActive ? `<span class="tb-over">⚔ RAID ${s.raiders.length}!</span>` : '') +
      `<button id="tb-res" class="tb-btn${this.showResources ? ' active' : ''}" title="Resources panel">RES</button>` +
      `<span class="tb-speed">${this.paused ? '⏸' : '▶'.repeat(this.speed)} <i>(space 1-3)</i></span>`);
    const resBtn = this.topBar.querySelector<HTMLButtonElement>('#tb-res');
    if (resBtn) resBtn.onclick = () => { this.showResources = !this.showResources; };
    // Close resources when the inspector fires a close-res event
    this.inspector.addEventListener('close-res', () => { this.showResources = false; }, { once: true });
  }

  private drawInspector(): void {
    const s = this.sim;
    const settler = s.settlers.find((p) => p.id === this.cam.selectedSettler);
    const building = s.buildings.find((b) => b.id === this.cam.selectedBuilding);
    if (this.showResources) {
      this.setHtml(this.inspector, this.resourcesCard());
      this.inspector.classList.remove('hidden');
    } else if (settler) {
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
    const cap      = s.stockpileCapacity();
    const raw      = s.totalRawStock();
    const mealCap  = s.mealCap();
    const granaryCount = s.builtOf('granary').length;

    const usePct   = cap > 0 ? Math.min(100, Math.round(raw / cap * 100)) : 0;
    const useColor = usePct >= 90 ? '#e07a5a' : usePct >= 70 ? '#c8a84a' : '#7a8c3a';
    const mealPct  = Math.min(100, Math.round(s.stock.meal / mealCap * 100));

    const GOODS: [string, number][] = [
      ['Wood',    s.stock.wood],
      ['Stone',   s.stock.stone],
      ['Grain',   s.stock.grain],
      ['Clothes', s.stock.clothes],
      ['Weapons', s.stock.weapons],
    ];
    const goodRows = GOODS.map(([label, val]) => {
      const pct = cap > 0 ? Math.min(100, Math.round(val / cap * 100)) : 0;
      return `<div class="bar-row">` +
        `<span class="sp-lbl">${label}</span>` +
        `<div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div>` +
        `<span class="sp-val">${Math.round(val)}</span></div>`;
    }).join('');

    return (
      `<h3>Stockpile</h3>` +
      `<p class="insp-state">${tileCount} tile${tileCount !== 1 ? 's' : ''} · ${cap} cap</p>` +
      `<div class="bar-row">` +
        `<span class="sp-lbl">Total</span>` +
        `<div class="bar"><div class="bar-fill" style="width:${usePct}%;background:${useColor}"></div></div>` +
        `<span class="sp-val">${raw}/${cap}</span></div>` +
      goodRows +
      `<div class="bar-row">` +
        `<span class="sp-lbl">Meals</span>` +
        `<div class="bar"><div class="bar-fill" style="width:${mealPct}%"></div></div>` +
        `<span class="sp-val">${Math.round(s.stock.meal)}/${mealCap}</span></div>` +
      (granaryCount > 0
        ? `<p class="insp-skills">Meal cap: ${TUNING.mealCapBase}+${granaryCount} granary=${mealCap}</p>`
        : `<p class="insp-skills">Build a Granary to extend meal storage.</p>`)
    );
  }

  private resourcesCard(): string {
    const s = this.sim;
    type Group = { label: string; kinds: ResourceKind[] };
    const GROUPS: Group[] = [
      { label: 'Basic', kinds: ['wood', 'grain', 'stone', 'clothes', 'weapons', 'flax', 'clay', 'coal', 'iron_ore', 'herbs'] },
      { label: 'Refined (Era 1)', kinds: ['timber', 'brick', 'coke', 'iron', 'tools', 'rope', 'flour', 'ale', 'medicine'] },
      { label: 'Industrial (Era 2)', kinds: ['petroleum'] },
      { label: 'Food Variety', kinds: ['meal', 'bread', 'dairy', 'produce', 'game_meal', 'fish_meal', 'preserved'] },
    ];
    // A resource is "locked" only until the tech that produces it is researched.
    const techFor: Partial<Record<ResourceKind, string>> = {
      rope: 'textile_farming', preserved: 'food_preservation', ale: 'fermentation',
      produce: 'horticulture', flax: 'textile_farming', timber: 'carpentry',
      brick: 'brickwork', clay: 'prospecting', iron_ore: 'iron_mining',
      coal: 'iron_mining', coke: 'coke_production', iron: 'iron_smelting', tools: 'blacksmithing',
      flour: 'milling', medicine: 'germ_theory', herbs: 'herbalism',
      dairy: 'animal_husbandry', petroleum: 'coal_power',
    };
    let html = `<h3>Resources <button onclick="this.closest('.inspector').dispatchEvent(new CustomEvent('close-res'))" style="float:right;cursor:pointer">✕</button></h3>`;
    for (const g of GROUPS) {
      html += `<div class="insp-section"><b>${g.label}</b></div>`;
      for (const k of g.kinds) {
        const qty = s.stock[k] ?? 0;
        const flow = s.netFlow(k);
        const flowStr = flow > 0.05 ? `<span style="color:#6f6">+${flow.toFixed(1)}</span>`
          : flow < -0.05 ? `<span style="color:#f66">${flow.toFixed(1)}</span>`
          : `<span style="color:#888">~0</span>`;
        const tech = techFor[k];
        const locked = tech && !s.hasTech(tech);
        const tag = locked ? ` <span style="color:#c80" title="Locked — research ${tech.replace('_', ' ')}">🔒</span>` : '';
        // Live market price with supply/demand arrow.
        const spot = s.marketPrice(k);
        const base = BASE_PRICES[k] ?? 10;
        const arrow = spot > base * 1.08 ? `<span style="color:#6f6">▲</span>`
          : spot < base * 0.92 ? `<span style="color:#f66">▼</span>` : '';
        html += `<div class="bar-row"><span style="min-width:74px">${k.replace('_', ' ')}</span>` +
          `<span style="min-width:30px;text-align:right">${qty}</span> ${flowStr} ` +
          `<span style="min-width:42px;text-align:right;color:#caa" title="market price/unit">${formatCurrency(spot)}${arrow}</span>${tag}</div>`;
      }
    }
    return html;
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

    const workerCount = s.settlers.filter((p) => p.assignedBuildingId === b.id).length;
    const activeCount = s.settlers.filter(
      (p) => p.task?.buildingId === b.id || (p.bedId === b.id && p.state === 'sleeping'),
    ).length;
    const wl = b.workerLimit;

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
        ? `<p class="insp-workers">${wl === null ? `Workers: ${activeCount} · Auto` : `Workers: ${activeCount}/${workerCount} assigned`}</p>` +
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
      const giveKind = give as ResourceKind;
      const have = this.sim.stock[giveKind] ?? 0;
      const can = have >= r.give;
      const times = Math.floor(have / r.give);
      return `<div class="trade-row">
        <button class="trade-btn" data-give="${give}" data-get="${get}" data-qty="1"${can ? '' : ' disabled'}>${r.give}${give[0]}→${r.get}${get[0]}</button>
        ${times > 1 ? `<button class="trade-bulk" data-give="${give}" data-get="${get}" data-qty="${Math.min(times, 10)}" title="Shift+click">×${Math.min(times, 10)}</button>` : ''}
        ${times > 10 ? `<button class="trade-bulk" data-give="${give}" data-get="${get}" data-qty="${times}" title="Max">×${times}</button>` : ''}
      </div>`;
    }).join('');
    // Spot-price arrow: how the current market price compares to the resource's
    // natural base — ▲ when scarce/bid-up, ▼ when the player has flooded it.
    const priceTag = (kind: ResourceKind): string => {
      const spot = this.sim.marketPrice(kind);
      const base = BASE_PRICES[kind] ?? 10;
      const ratio = spot / base;
      const arrow = ratio > 1.08 ? `<span style="color:#6f6">▲</span>`
        : ratio < 0.92 ? `<span style="color:#f66">▼</span>` : '';
      return `${formatCurrency(spot)}${arrow}`;
    };
    // Sell stock for coin: any good the colony holds can be sold. Prices are
    // marginal — dumping a big stock floods the market and clears below spot.
    const sellable = (Object.keys(this.sim.stock) as ResourceKind[])
      .filter((kind) => (this.sim.stock[kind] ?? 0) >= 5);
    const sells = sellable.length === 0
      ? `<p class="insp-skills" style="opacity:0.6">Nothing in surplus to sell.</p>`
      : sellable.map((kind) => {
      const have = this.sim.stock[kind] ?? 0;
      return `<div class="trade-row">
        <button class="sell-cash-btn" data-kind="${kind}" data-qty="5" title="Shift+click to sell all">5 ${kind} (${priceTag(kind)}/u)</button>
        ${have > 5 ? `<button class="sell-bulk" data-kind="${kind}" data-qty="${have}" title="Sell all ${have} — marginal price falls as you dump">×all (${have})</button>` : ''}
      </div>`;
    }).join('');
    // Buy essentials with coin — keeps the larder stocked when farms fall short.
    const buyable: ResourceKind[] = ['meal', 'grain', 'wood'];
    const cash = this.sim.economy.cash;
    const buys = buyable.map((kind) => {
      const price = this.sim.marketPrice(kind);
      return `<div class="trade-row">
        <button class="buy-cash-btn" data-kind="${kind}" data-qty="5"${cash >= price * 5 ? '' : ' disabled'} title="Shift+click to buy 25">${formatCurrency(price * 5)} → 5 ${kind}</button>
        <button class="buy-cash-btn" data-kind="${kind}" data-qty="25"${cash >= price * 25 ? '' : ' disabled'}>×25 → ${formatCurrency(price * 25)}</button>
      </div>`;
    }).join('');
    const inflation = this.sim.hasTech('banking')
      ? ` · inflation ${(this.sim.economy.inflation * 100).toFixed(1)}%`
      : '';
    return `<p class="insp-skills">BARTER:</p><div class="trade-panel">${offers}</div>` +
      `<p class="insp-skills">SELL FOR COIN (` + formatCurrency(Math.round(cash)) + inflation + `):</p><div class="trade-panel">${sells}</div>` +
      `<p class="insp-skills">BUY WITH COIN:</p><div class="trade-panel">${buys}</div>`;
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
    this.setHtml(this.logBox, this.sim.log.slice(-8).map((l) => `<div class="log-entry log-${l.kind}">d${l.day} · ${l.text}</div>`).join(''));
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
