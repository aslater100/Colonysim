/**
 * DOM HUD: top bar, build palette, inspector, work priorities, event log.
 * Pixel-crisp data presentation (GDD §8.5): every number explains itself.
 */
import type { Simulation, Settler } from '../sim/sim';
import { BUILDING_DEFS, buildingDef, traitDef, WORK_KINDS, TUNING } from '../sim/defs';
import type { ResourceKind, WorkKind } from '../sim/defs';
import type { Camera } from './render';
import type { PaintKind } from '../sim/world';
import type { Sfx } from './audio';
import type { Music } from './music';
import type { Soundscape } from './soundscape';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  parent.appendChild(e);
  return e;
}

export class Hud {
  speed = 1;
  paused = false;
  /** set by main when the flip is available/used */
  onFoundTown: (() => void) | null = null;
  /** set by main: restart after a colony loss */
  onRestart: (() => void) | null = null;
  /** set by main: persist / restore the sim (in-game menu) */
  onSave: (() => boolean) | null = null;
  onLoad: (() => void) | null = null;
  hasSave: (() => boolean) | null = null;
  menuOpen = false;
  private pausedBeforeMenu = false;
  private topBar: HTMLElement;
  private palette: HTMLElement;
  private inspector: HTMLElement;
  private logBox: HTMLElement;
  private prioBox: HTMLElement;
  private gameOverBox: HTMLElement;
  private menuBox: HTMLElement;
  private showPriorities = false;
  private lastLogLen = 0;
  private foundBtn: HTMLButtonElement | null = null;
  /** last innerHTML per panel — skip DOM writes when nothing changed */
  private htmlCache = new Map<HTMLElement, string>();

  constructor(root: HTMLElement, private sim: Simulation, private cam: Camera, private sfx?: Sfx, private music?: Music, private soundscape?: Soundscape) {
    this.topBar = el('div', 'topbar', root);
    this.palette = el('div', 'palette', root);
    this.inspector = el('div', 'inspector', root);
    this.logBox = el('div', 'eventlog', root);
    this.prioBox = el('div', 'priorities hidden', root);
    this.gameOverBox = el('div', 'gameover hidden', root);
    this.menuBox = el('div', 'menu hidden', root);
    this.buildPalette();
    this.palette.addEventListener('mousedown', () => this.sfx?.click());
    // Menu contents are rebuilt on every open, so delegate like the panels.
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
        case 'menu-mute':
          this.sfx?.toggleMuted();
          this.renderMenu();
          break;
        case 'menu-music':
          this.music?.toggle();
          this.music?.unlock();
          this.renderMenu();
          break;
        case 'menu-soundscape':
          this.soundscape?.toggle();
          this.soundscape?.unlock();
          this.renderMenu();
          break;
        case 'menu-restart':
          if (confirm('Abandon this colony and start over?')) this.onRestart?.();
          break;
      }
    });
    // Panels whose innerHTML is rebuilt while open handle clicks by
    // delegation on mousedown: a per-frame rebuild destroys child elements
    // between mousedown and mouseup, so plain onclick handlers never fire
    // (this is what broke the cancel button and the priorities table).
    this.inspector.addEventListener('mousedown', (e) => {
      const trade = (e.target as HTMLElement).closest<HTMLElement>('.trade-btn');
      if (trade) {
        this.sim.trade(trade.dataset.give as ResourceKind, trade.dataset.get as ResourceKind);
        return;
      }
      const btn = (e.target as HTMLElement).closest<HTMLElement>('#insp-cancel');
      if (!btn) return;
      this.sim.cancelBuilding(Number(btn.dataset.bid));
      this.cam.selectedBuilding = null;
    });
    this.prioBox.addEventListener('mousedown', (e) => {
      const td = (e.target as HTMLElement).closest<HTMLElement>('.prio');
      if (!td) return;
      const p = this.sim.settlers.find((x) => x.id === Number(td.dataset.sid));
      if (!p) return;
      const k = td.dataset.work as WorkKind;
      p.priorities[k] = (p.priorities[k] + 1) % 4;
    });
  }

  private setHtml(box: HTMLElement, html: string): void {
    if (this.htmlCache.get(box) === html) return;
    this.htmlCache.set(box, html);
    box.innerHTML = html;
  }

  private buildPalette(): void {
    const title = el('div', 'pal-title', this.palette);
    title.textContent = 'BUILD';
    for (const def of BUILDING_DEFS) {
      const b = el('button', 'pal-btn', this.palette);
      b.textContent = `${def.name} (${def.cost.wood ?? 0}w)`;
      b.title = def.desc;
      b.onclick = () => {
        this.cam.placing = this.cam.placing === def.id ? null : def.id;
        this.cam.chopMode = false;
        this.refreshPaletteState();
      };
      b.dataset.def = def.id;
    }
    const chop = el('button', 'pal-btn', this.palette);
    chop.textContent = 'Chop / Quarry [C]';
    chop.title = 'Mark trees for felling and rock for quarrying (stone)';
    chop.dataset.def = 'chop';
    chop.onclick = () => this.toggleChop();
    // Zones and roads (drag to paint); the bracketed letter is the hotkey
    const zoneDefs: [PaintKind, string, string][] = [
      ['farm', 'Farm Zone [F]', 'Paint farmable soil tiles; settlers sow and harvest automatically'],
      ['stockpile', 'Stockpile Zone [T]', 'Designate tiles as storage; settlers haul here'],
      ['wall', 'Palisade Wall [L]', 'Paint wall tiles; workers build them with wood'],
      ['gate', 'Gate (5w) [G]', 'A door in the palisade: settlers walk through, raiders and wolves must break it'],
      ['dirt', 'Dirt Path (free) [4]', 'Quick ruts: ×1.3 speed, mud in rain'],
      ['plank', 'Plank Road (1w) [5]', 'All-weather timber: ×1.6 speed'],
      ['gravel', 'Gravel Road (1s) [6]', 'Best surface: ×1.8 speed (needs quarried stone)'],
      ['bridge', 'Bridge (4w) [7]', 'The only way across water'],
    ];
    for (const [kind, label, desc] of zoneDefs) {
      const b = el('button', 'pal-btn', this.palette);
      b.textContent = label;
      b.title = desc;
      b.dataset.def = `zone-${kind}`;
      b.onclick = () => this.toggleZone(kind);
    }
    const overlay = el('button', 'pal-btn', this.palette);
    overlay.textContent = 'Traffic Overlay [O]';
    overlay.title = 'Heatmap of where settlers actually walk';
    overlay.dataset.def = 'overlay-traffic';
    overlay.onclick = () => this.toggleOverlay();
    const prio = el('button', 'pal-btn', this.palette);
    prio.textContent = 'Work Priorities [P]';
    prio.onclick = () => this.togglePriorities();
    const menu = el('button', 'pal-btn', this.palette);
    menu.textContent = 'Menu [M]';
    menu.title = 'Pause, save, load, restart, sound';
    menu.onclick = () => this.toggleMenu();
    // The flip: available once the town has outgrown the valley (GDD §2.3)
    this.foundBtn = el('button', 'pal-btn pal-found', this.palette);
    this.foundBtn.textContent = 'Found Town #2';
    this.foundBtn.onclick = () => {
      if (this.sim.canFoundSecondTown().ok && this.onFoundTown) this.onFoundTown();
    };
  }

  private toggleChop(): void {
    this.cam.chopMode = !this.cam.chopMode;
    this.cam.placing = null;
    this.cam.placingZone = null;
    this.refreshPaletteState();
  }

  private toggleZone(kind: PaintKind): void {
    this.cam.placingZone = this.cam.placingZone === kind ? null : kind;
    this.cam.placing = null;
    this.cam.chopMode = false;
    this.refreshPaletteState();
  }

  private toggleOverlay(): void {
    this.cam.overlay = this.cam.overlay === 'traffic' ? 'none' : 'traffic';
    this.refreshPaletteState();
  }

  private togglePriorities(): void {
    this.showPriorities = !this.showPriorities;
    this.prioBox.classList.toggle('hidden', !this.showPriorities);
  }

  /** Palette hotkeys (the bracketed letters on the buttons). True if handled. */
  handleKey(key: string): boolean {
    const k = key.toLowerCase();
    if (this.menuOpen) {
      if (k === 'm' || k === 'escape') {
        this.closeMenu();
        return true;
      }
      return k.length === 1; // swallow stray keys while the menu is up
    }
    switch (k) {
      case 'c': this.toggleChop(); return true;
      case 'f': this.toggleZone('farm'); return true;
      case 't': this.toggleZone('stockpile'); return true;
      case 'l': this.toggleZone('wall'); return true;
      case 'g': this.toggleZone('gate'); return true;
      case '4': this.toggleZone('dirt'); return true;
      case '5': this.toggleZone('plank'); return true;
      case '6': this.toggleZone('gravel'); return true;
      case '7': this.toggleZone('bridge'); return true;
      case 'o': this.toggleOverlay(); return true;
      case 'p': this.togglePriorities(); return true;
      case 'm': this.toggleMenu(); return true;
      default: return false;
    }
  }

  // ---- in-game menu ----
  toggleMenu(): void {
    if (this.menuOpen) this.closeMenu();
    else this.openMenu();
  }

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

  private renderMenu(note = ''): void {
    const canSave = this.onSave !== null;
    const canLoad = (this.hasSave?.() ?? false) && this.onLoad !== null;
    this.setHtml(this.menuBox,
      `<div class="menu-box">` +
      `<h2>CENTURIA</h2>` +
      `<p class="menu-note">${note || 'The colony waits.'}</p>` +
      `<button id="menu-resume">Resume [M]</button>` +
      `<button id="menu-save"${canSave ? '' : ' disabled title="Saving works on the town map"'}>Save Game</button>` +
      `<button id="menu-load"${canLoad ? '' : ' disabled title="No saved game yet"'}>Load Game</button>` +
      `<button id="menu-mute">${this.sfx?.muted ? 'Sound: OFF' : 'Sound: ON'}</button>` +
      `<button id="menu-music">${this.music?.enabled ? 'Music: ON' : 'Music: OFF'}</button>` +
      `<button id="menu-soundscape">${this.soundscape?.enabled ? 'Ambience: ON' : 'Ambience: OFF'}</button>` +
      `<button id="menu-restart">Restart Colony</button>` +
      `</div>`);
  }

  /** Region mode hides the town chrome; the region view brings its own panel. */
  setRegionMode(on: boolean): void {
    this.palette.classList.toggle('hidden', on);
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
    this.setHtml(this.logBox, r.log
      .slice(-8)
      .map((l) => `<div class="log-${l.kind}">d${l.day} · ${l.text}</div>`)
      .reverse()
      .join(''));
  }

  refreshPaletteState(): void {
    for (const b of this.palette.querySelectorAll<HTMLButtonElement>('.pal-btn')) {
      const active =
        b.dataset.def === this.cam.placing ||
        (b.dataset.def === 'chop' && this.cam.chopMode) ||
        b.dataset.def === `zone-${this.cam.placingZone}` ||
        (b.dataset.def === 'overlay-traffic' && this.cam.overlay === 'traffic');
      b.classList.toggle('active', active);
    }
  }

  update(): void {
    this.drawTopBar();
    this.drawInspector();
    this.drawLog();
    this.drawGameOver();
    if (this.showPriorities) this.drawPriorities();
    if (this.foundBtn) {
      const can = this.sim.canFoundSecondTown();
      this.foundBtn.disabled = !can.ok;
      this.foundBtn.title = can.ok ? 'Send an expedition — and step up to the region map' : can.reason;
    }
  }

  private drawTopBar(): void {
    const s = this.sim;
    const hh = String(Math.floor(s.hour)).padStart(2, '0');
    const mm = String(Math.floor((s.hour % 1) * 60)).padStart(2, '0');
    const over = s.settlers.length - TUNING.softCapPop;
    const capWarn = over > 0 ? ` ⚠ growing pains −${Math.round((1 - s.softCapWorkMult()) * 100)}% work` : '';
    const skyIcon = { clear: '☀', overcast: '☁', rain: '☔', storm: '⛈', snow: '❄' }[s.weatherToday().sky];
    const drought = s.weather.isDrought(s.day) && s.growingSeason ? ' <span class="tb-over">DROUGHT</span>' : '';
    this.setHtml(this.topBar,
      `<span class="tb-date">${s.dateLabel} ${hh}:${mm}</span>` +
      `<span>${skyIcon} ${Math.round(s.temperature())}°C${drought}</span>` +
      `<span>POP ${s.settlers.length}${capWarn}</span>` +
      `<span>wood ${s.stock.wood} · stone ${s.stock.stone} · grain ${s.stock.grain} · meals ${s.stock.meal} · clothes ${s.stock.clothes}</span>` +
      `<span title="average of all settler moods">MOOD ${Math.round(s.avgMood())}</span>` +
      (s.raidActive ? `<span class="tb-over">⚔ RAID — ${s.raiders.length} raiders!</span>` : '') +
      `<span class="tb-speed">${this.paused ? '⏸ PAUSED' : '▶'.repeat(this.speed)} <i>(space, 1-3)</i></span>` +
      (s.gameOver ? `<span class="tb-over">THE COLONY HAS PERISHED</span>` : ''));
  }

  private drawInspector(): void {
    const s = this.sim;
    const settler = s.settlers.find((p) => p.id === this.cam.selectedSettler);
    const building = s.buildings.find((b) => b.id === this.cam.selectedBuilding);
    if (settler) {
      this.setHtml(this.inspector, this.settlerCard(settler));
      this.inspector.classList.remove('hidden');
    } else if (building) {
      const def = buildingDef(building.defId);
      this.setHtml(this.inspector,
        `<h3>${def.name}${building.built ? '' : ' (blueprint)'}</h3>` +
        `<p>${def.desc}</p>` +
        (building.built
          ? (def.provides === 'trade' ? this.tradePanel() : '')
          : `<p>wood ${building.delivered}/${def.cost.wood ?? 0} · work left ${Math.max(0, Math.round(building.buildLeft))}</p>` +
            `<button id="insp-cancel" data-bid="${building.id}">Cancel</button>`));
      this.inspector.classList.remove('hidden');
    } else {
      this.inspector.classList.add('hidden');
    }
  }

  /** Barter buttons for a selected market; clicks land on the mousedown delegate. */
  private tradePanel(): string {
    const offers = Object.entries(TUNING.tradeRates).map(([key, r]) => {
      const [give, get] = key.split('->');
      const can = this.sim.stock[give as ResourceKind] >= r.give;
      return `<button class="trade-btn" data-give="${give}" data-get="${get}"${can ? '' : ' disabled'}>` +
        `${r.give} ${give} → ${r.get} ${get}</button>`;
    }).join(' ');
    return `<p class="insp-skills">BARTER — fixed rates:</p><p>${offers}</p>`;
  }

  /** The end of the line: a big retro banner and a way back in (F18). */
  private drawGameOver(): void {
    if (!this.sim.gameOver) {
      this.gameOverBox.classList.add('hidden');
      return;
    }
    if (this.gameOverBox.classList.contains('hidden')) {
      this.setHtml(this.gameOverBox,
        `<div class="gameover-box">` +
        `<h1>YOU LOSE</h1>` +
        `<p>The colony has perished. ${this.sim.dateLabel} — ${this.sim.graves.length} graves, none left to dig more.</p>` +
        `<button id="go-restart">RESTART</button>` +
        `</div>`);
      this.gameOverBox.classList.remove('hidden');
      const btn = this.gameOverBox.querySelector<HTMLButtonElement>('#go-restart');
      if (btn) btn.onclick = () => this.onRestart?.();
    }
  }

  /**
   * Mood, itemized (GDD §8.5: every number explains itself): each weighted
   * need, trait, thought and penalty that the mood is drifting toward.
   */
  private moodBreakdown(p: Settler): string {
    const w = TUNING.moodWeights;
    const parts: [string, number][] = [
      ['food', p.needs.food * w.food],
      ['rest', p.needs.rest * w.rest],
      ['warmth', p.needs.warmth * w.warmth],
      ['recreation', p.needs.recreation * w.recreation],
      ['social', p.needs.social * w.social],
    ];
    for (const id of p.traits) {
      const mb = traitDef(id).moodBase ?? 0;
      if (mb !== 0) parts.push([traitDef(id).name, mb]);
    }
    for (const th of p.thoughts) parts.push([th.label, th.delta]);
    const cap = this.sim.softCapMoodPenalty();
    if (cap > 0) parts.push(['crowding (soft cap)', -cap]);
    const total = Math.max(0, Math.min(100, parts.reduce((s, [, v]) => s + v, 0)));
    return (
      'MOOD — what feeds it:\n' +
      parts.map(([l, v]) => `${v >= 0 ? '+' : ''}${Math.round(v)}  ${l}`).join('\n') +
      `\n= drifting toward ${Math.round(total)}`
    );
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
      p.clothedUntil > this.sim.minute ? '' : 'threadbare (+cold)',
    ].filter(Boolean).join(' · ');
    const friends = this.sim.friendsOf(p).slice(0, 3)
      .map((f) => `${f.name.split(' ')[0]} (${Math.round(this.sim.opinionBetween(p, f))})`)
      .join(', ');
    return (
      `<h3>${p.name}, ${p.age}</h3>` +
      `<p class="insp-state">${p.state}${p.task ? ` — ${p.task.label}` : ''} · hp ${Math.round(p.health)} · combat ${p.combat.toFixed(1)}</p>` +
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
    this.setHtml(this.logBox, this.sim.log
      .slice(-8)
      .map((l) => `<div class="log-${l.kind}">d${l.day} · ${l.text}</div>`)
      .reverse()
      .join(''));
  }

  private drawPriorities(): void {
    // Clicks are handled by the mousedown delegate in the constructor.
    const rows = this.sim.settlers
      .map((p) => {
        const cells = WORK_KINDS.map(
          (k) =>
            `<td class="prio prio-${p.priorities[k]}" data-sid="${p.id}" data-work="${k}">${p.priorities[k] || '·'}</td>`,
        ).join('');
        return `<tr><td class="prio-name">${p.name.split(' ')[0]}</td>${cells}</tr>`;
      })
      .join('');
    this.setHtml(this.prioBox,
      `<table><tr><th>WORK (click to cycle 0–3)</th>${WORK_KINDS.map((k) => `<th>${k}</th>`).join('')}</tr>${rows}</table>`);
  }
}
