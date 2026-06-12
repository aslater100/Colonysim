/**
 * TechPanel — floating overlay showing the Tier-1 town tech tree.
 * Toggled by hotkey K or the Town Hall inspector button.
 * Uses existing .research-panel / .res-row CSS classes plus a thin wrapper.
 */
import type { Simulation } from '../sim/sim';
import { TOWN_TECH_DEFS } from '../sim/defs';
import type { TownTechDef } from '../sim/defs';

const BRANCH_ORDER = ['agriculture', 'industry', 'construction', 'medicine', 'commerce', 'military', 'society'];
const BRANCH_LABEL: Record<string, string> = {
  agriculture: 'Agriculture',
  industry: 'Industry',
  construction: 'Construction',
  medicine: 'Medicine',
  commerce: 'Commerce',
  military: 'Military',
  society: 'Society',
};

export class TechPanel {
  private box: HTMLElement;
  private visible = false;
  private lastHtml = '';

  constructor(
    root: HTMLElement,
    private sim: Simulation,
  ) {
    this.box = document.createElement('div');
    this.box.className = 'tech-panel-overlay hidden';
    Object.assign(this.box.style, {
      position: 'fixed',
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)',
      width: '740px',
      maxHeight: '80vh',
      overflowY: 'auto',
      background: 'rgba(16, 14, 10, 0.97)',
      border: '2px solid #6e4a2f',
      padding: '12px',
      zIndex: '25',
      fontFamily: "'Courier New', monospace",
      fontSize: '11px',
      color: '#dfe6ee',
    });
    root.appendChild(this.box);

    this.box.addEventListener('mousedown', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('button[data-tech]');
      if (!btn) return;
      const techId = btn.dataset.tech!;
      const action = btn.dataset.action!;
      if (action === 'queue') this.sim.queueResearch(techId);
      else if (action === 'dequeue') this.sim.dequeueResearch(techId);
      this.refresh();
    });
  }

  toggle(): void {
    this.visible = !this.visible;
    if (this.visible) {
      this.refresh();
      this.box.classList.remove('hidden');
    } else {
      this.box.classList.add('hidden');
    }
  }

  show(): void {
    if (!this.visible) {
      this.visible = true;
      this.refresh();
      this.box.classList.remove('hidden');
    }
  }

  hide(): void {
    this.visible = false;
    this.box.classList.add('hidden');
  }

  isVisible(): boolean { return this.visible; }

  update(): void {
    if (this.visible) this.refresh();
  }

  private refresh(): void {
    const s = this.sim;
    const year = s.year;

    // Active research progress bar
    let activeHtml = '';
    if (s.activeResearch) {
      const def = TOWN_TECH_DEFS.find((d) => d.id === s.activeResearch!.techId);
      const total = (def?.days ?? 1) * 1440;
      const pct = Math.round((1 - s.activeResearch.workLeft / total) * 100);
      activeHtml = `
        <div style="margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #4d3320;">
          <span style="color:#e8d27a">Researching: ${def?.name ?? s.activeResearch.techId}</span>
          <div class="res-bar" style="margin-top:4px"><div class="res-bar-fill" style="width:${pct}%"></div></div>
          <span style="color:#998c6e;font-size:10px">${pct}% complete</span>
        </div>`;
    } else if (s.researchQueue.length > 0) {
      activeHtml = `<div style="margin-bottom:8px;color:#998c6e">Queue: ${s.researchQueue.map(id => TOWN_TECH_DEFS.find(d => d.id === id)?.name ?? id).join(' → ')} <i>(waiting for Town Hall)</i></div>`;
    } else {
      activeHtml = `<div style="margin-bottom:8px;color:#554e44">No active research. Click a tech below to queue it (up to 3).</div>`;
    }

    // Queue display (if active research + queued)
    let queueHtml = '';
    if (s.activeResearch && s.researchQueue.length > 0) {
      queueHtml = `<div style="margin-bottom:8px;color:#998c6e;font-size:10px">Queued: ${s.researchQueue.map(id => TOWN_TECH_DEFS.find(d => d.id === id)?.name ?? id).join(' → ')}</div>`;
    }

    // Tech grid by branch
    const branches = BRANCH_ORDER.filter((b) => TOWN_TECH_DEFS.some((t) => t.branch === b));
    let branchHtml = '';
    for (const branch of branches) {
      const techs = TOWN_TECH_DEFS.filter((t) => t.branch === branch);
      branchHtml += `<div style="margin-bottom:8px"><div style="color:#c2a14d;font-size:10px;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">${BRANCH_LABEL[branch] ?? branch}</div>`;
      branchHtml += `<div style="display:flex;flex-wrap:wrap;gap:4px">`;
      for (const tech of techs) {
        branchHtml += this.techCard(tech, year);
      }
      branchHtml += `</div></div>`;
    }

    const html =
      `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;border-bottom:1px solid #4d3320;padding-bottom:6px">` +
      `<span style="color:#e8d27a;font-size:13px">Town Research Tree</span>` +
      `<button style="background:#2a2620;color:#998c6e;border:1px solid #4d3320;font-family:inherit;font-size:11px;padding:1px 8px;cursor:pointer" onclick="this.closest('.tech-panel-overlay').dispatchEvent(new Event('close-tech'))">✕ Close [K]</button>` +
      `</div>` +
      activeHtml + queueHtml + branchHtml;

    if (html !== this.lastHtml) {
      this.box.innerHTML = html;
      this.lastHtml = html;
      // Wire close button
      this.box.querySelector('button[onclick]')?.addEventListener('click', () => this.hide());
    }
  }

  private techCard(tech: TownTechDef, year: number): string {
    const s = this.sim;
    const done = s.hasTech(tech.id);
    const active = s.activeResearch?.techId === tech.id;
    const queued = s.researchQueue.includes(tech.id);
    const yearLocked = tech.minYear && year < tech.minYear;
    const prereqsMet = tech.prereqs.every((p) => s.hasTech(p));
    const available = !done && !active && !queued && !yearLocked && prereqsMet;
    const canQueue = available && s.researchQueue.length < 3;

    let cls = 'res-row';
    let statusIcon = '';
    if (done) { cls += ' res-done'; statusIcon = '✓ '; }
    else if (active) { cls += ' res-active'; statusIcon = '▶ '; }
    else if (queued) { cls += ' res-active'; statusIcon = '⋯ '; }
    else if (!prereqsMet || yearLocked) { cls += ' res-locked'; statusIcon = '🔒 '; }
    else { cls += ' res-avail'; }

    const costStr = Object.entries(tech.cost).length > 0
      ? Object.entries(tech.cost).map(([r, q]) => `${q}${r[0]}`).join('+')
      : 'free';

    const prereqStr = tech.prereqs.length > 0
      ? `<div style="font-size:9px;color:#554e44">Needs: ${tech.prereqs.map(p => TOWN_TECH_DEFS.find(d => d.id === p)?.name ?? p).join(', ')}</div>`
      : '';

    const yearStr = tech.minYear ? `<span style="color:#554e44"> (from ${tech.minYear})</span>` : '';

    let actionBtn = '';
    if (queued || active) {
      actionBtn = `<button data-tech="${tech.id}" data-action="dequeue" style="font-size:10px;padding:1px 5px;background:#3d1a14;border:1px solid #c25b2e;color:#e07a5a;font-family:inherit;cursor:pointer">✕</button>`;
    } else if (canQueue) {
      actionBtn = `<button data-tech="${tech.id}" data-action="queue" style="font-size:10px;padding:1px 5px;background:#1a3020;border:1px solid #6a9c40;color:#8fc26a;font-family:inherit;cursor:pointer">+</button>`;
    }

    return `<div class="${cls}" style="width:220px;padding:5px 6px;border:1px solid #2a2620">` +
      `<div style="display:flex;justify-content:space-between;align-items:flex-start">` +
      `<span><b>${statusIcon}${tech.name}</b>${yearStr}</span>${actionBtn}` +
      `</div>` +
      `<div style="color:#998c6e;font-size:9px;margin:2px 0">${tech.days}d · ${costStr}</div>` +
      `<div style="font-size:10px;margin:2px 0">${tech.desc}</div>` +
      prereqStr +
      `</div>`;
  }
}
