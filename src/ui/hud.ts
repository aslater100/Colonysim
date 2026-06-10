/**
 * DOM HUD: top bar, build palette, inspector, work priorities, event log.
 * Pixel-crisp data presentation (GDD §8.5): every number explains itself.
 */
import type { Simulation, Settler } from '../sim/sim';
import { BUILDING_DEFS, buildingDef, traitDef, WORK_KINDS, TUNING } from '../sim/defs';
import type { Camera } from './render';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  parent.appendChild(e);
  return e;
}

export class Hud {
  speed = 1;
  paused = false;
  private topBar: HTMLElement;
  private palette: HTMLElement;
  private inspector: HTMLElement;
  private logBox: HTMLElement;
  private prioBox: HTMLElement;
  private showPriorities = false;
  private lastLogLen = 0;

  constructor(root: HTMLElement, private sim: Simulation, private cam: Camera) {
    this.topBar = el('div', 'topbar', root);
    this.palette = el('div', 'palette', root);
    this.inspector = el('div', 'inspector', root);
    this.logBox = el('div', 'eventlog', root);
    this.prioBox = el('div', 'priorities hidden', root);
    this.buildPalette();
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
    chop.textContent = 'Chop Trees';
    chop.title = 'Mark trees for felling';
    chop.dataset.def = 'chop';
    chop.onclick = () => {
      this.cam.chopMode = !this.cam.chopMode;
      this.cam.placing = null;
      this.refreshPaletteState();
    };
    const prio = el('button', 'pal-btn', this.palette);
    prio.textContent = 'Work Priorities';
    prio.onclick = () => {
      this.showPriorities = !this.showPriorities;
      this.prioBox.classList.toggle('hidden', !this.showPriorities);
    };
  }

  refreshPaletteState(): void {
    for (const b of this.palette.querySelectorAll<HTMLButtonElement>('.pal-btn')) {
      const active = b.dataset.def === this.cam.placing || (b.dataset.def === 'chop' && this.cam.chopMode);
      b.classList.toggle('active', active);
    }
  }

  update(): void {
    this.drawTopBar();
    this.drawInspector();
    this.drawLog();
    if (this.showPriorities) this.drawPriorities();
  }

  private drawTopBar(): void {
    const s = this.sim;
    const hh = String(Math.floor(s.hour)).padStart(2, '0');
    const mm = String(Math.floor((s.hour % 1) * 60)).padStart(2, '0');
    const over = s.settlers.length - TUNING.softCapPop;
    const capWarn = over > 0 ? ` ⚠ growing pains −${Math.round((1 - s.softCapWorkMult()) * 100)}% work` : '';
    this.topBar.innerHTML =
      `<span class="tb-date">${s.dateLabel} ${hh}:${mm}</span>` +
      `<span>${Math.round(s.temperature())}°C</span>` +
      `<span>POP ${s.settlers.length}${capWarn}</span>` +
      `<span>wood ${s.stock.wood} · grain ${s.stock.grain} · meals ${s.stock.meal}</span>` +
      `<span title="average of all settler moods">MOOD ${Math.round(s.avgMood())}</span>` +
      `<span class="tb-speed">${this.paused ? '⏸ PAUSED' : '▶'.repeat(this.speed)} <i>(space, 1-3)</i></span>` +
      (s.gameOver ? `<span class="tb-over">THE COLONY HAS PERISHED</span>` : '');
  }

  private drawInspector(): void {
    const s = this.sim;
    const settler = s.settlers.find((p) => p.id === this.cam.selectedSettler);
    const building = s.buildings.find((b) => b.id === this.cam.selectedBuilding);
    if (settler) {
      this.inspector.innerHTML = this.settlerCard(settler);
      this.inspector.classList.remove('hidden');
    } else if (building) {
      const def = buildingDef(building.defId);
      this.inspector.innerHTML =
        `<h3>${def.name}${building.built ? '' : ' (blueprint)'}</h3>` +
        `<p>${def.desc}</p>` +
        (building.built
          ? ''
          : `<p>wood ${building.delivered}/${def.cost.wood ?? 0} · work left ${Math.max(0, Math.round(building.buildLeft))}</p>` +
            `<button id="insp-cancel">Cancel</button>`);
      this.inspector.classList.remove('hidden');
      const cancel = this.inspector.querySelector<HTMLButtonElement>('#insp-cancel');
      if (cancel) cancel.onclick = () => {
        this.sim.cancelBuilding(building.id);
        this.cam.selectedBuilding = null;
      };
    } else {
      this.inspector.classList.add('hidden');
    }
  }

  private settlerCard(p: Settler): string {
    const bar = (label: string, v: number) =>
      `<div class="bar-row"><span>${label}</span><div class="bar"><div class="bar-fill" style="width:${Math.round(v)}%"></div></div><span>${Math.round(v)}</span></div>`;
    const thoughts = p.thoughts.map((t) => `<li>${t.label} (${t.delta > 0 ? '+' : ''}${t.delta})</li>`).join('');
    const traits = p.traits.map((t) => `<abbr title="${traitDef(t).desc}">${traitDef(t).name}</abbr>`).join(', ');
    const skills = WORK_KINDS.map((k) => `${k} ${p.skills[k].toFixed(1)}`).join(' · ');
    return (
      `<h3>${p.name}, ${p.age}</h3>` +
      `<p class="insp-state">${p.state}${p.task ? ` — ${p.task.label}` : ''} · hp ${Math.round(p.health)}</p>` +
      `<p>${traits}</p>` +
      bar('mood', p.mood) + bar('food', p.needs.food) + bar('rest', p.needs.rest) +
      bar('warmth', p.needs.warmth) + bar('rec', p.needs.recreation) + bar('social', p.needs.social) +
      `<p class="insp-skills">${skills}</p>` +
      (thoughts ? `<ul class="thoughts">${thoughts}</ul>` : '')
    );
  }

  private drawLog(): void {
    if (this.sim.log.length === this.lastLogLen) return;
    this.lastLogLen = this.sim.log.length;
    this.logBox.innerHTML = this.sim.log
      .slice(-8)
      .map((l) => `<div class="log-${l.kind}">d${l.day} · ${l.text}</div>`)
      .reverse()
      .join('');
  }

  private drawPriorities(): void {
    const rows = this.sim.settlers
      .map((p) => {
        const cells = WORK_KINDS.map(
          (k) =>
            `<td class="prio prio-${p.priorities[k]}" data-sid="${p.id}" data-work="${k}">${p.priorities[k] || '·'}</td>`,
        ).join('');
        return `<tr><td class="prio-name">${p.name.split(' ')[0]}</td>${cells}</tr>`;
      })
      .join('');
    this.prioBox.innerHTML =
      `<table><tr><th>WORK (click to cycle 0–3)</th>${WORK_KINDS.map((k) => `<th>${k}</th>`).join('')}</tr>${rows}</table>`;
    for (const td of this.prioBox.querySelectorAll<HTMLTableCellElement>('.prio')) {
      td.onclick = () => {
        const p = this.sim.settlers.find((x) => x.id === Number(td.dataset.sid));
        if (!p) return;
        const k = td.dataset.work as (typeof WORK_KINDS)[number];
        p.priorities[k] = (p.priorities[k] + 1) % 4;
      };
    }
  }
}
