/**
 * Region view (Tier 1.5 → 2): the zoomed-out map that becomes the default
 * operating altitude after the flip (GDD §2.5). Painterly backdrop, town
 * markers, routes, expedition wagons; DOM panel for the selected settlement.
 */
import type { RegionSim, Settlement } from '../sim/region';
import { AGE_BANDS, ROLE_BONUS_DESC } from '../sim/region';

export class RegionView {
  selectedId: number | null = null;
  private g: CanvasRenderingContext2D;
  private panel: HTMLElement;
  private frame = 0;

  constructor(private canvas: HTMLCanvasElement, private region: RegionSim, root: HTMLElement) {
    this.g = canvas.getContext('2d')!;
    this.panel = document.createElement('div');
    this.panel.className = 'inspector region-panel hidden';
    root.appendChild(this.panel);
  }

  destroyPanel(): void {
    this.panel.remove();
  }

  private toPx(x: number, y: number): { px: number; py: number } {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const m = 60; // margin
    return { px: m + (x / 100) * (W - 2 * m), py: m + (y / 100) * (H - 2 * m) };
  }

  click(px: number, py: number): void {
    this.selectedId = null;
    for (const t of this.region.settlements) {
      const p = this.toPx(t.x, t.y);
      if (Math.hypot(p.px - px, p.py - py) < 26) {
        this.selectedId = t.id;
        break;
      }
    }
  }

  draw(): void {
    this.frame++;
    const { g, canvas, region } = this;
    const W = canvas.width;
    const H = canvas.height;

    // Terrain: layered dusk-toned region map
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#2c3a2a');
    grad.addColorStop(1, '#1f2a20');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    // dithered texture + ridge bands for the painterly feel
    g.fillStyle = 'rgba(255,255,255,0.025)';
    for (let i = 0; i < 400; i++) {
      const x = (i * 131) % W;
      const y = (i * 197) % H;
      g.fillRect(x, y, 2, 2);
    }
    g.fillStyle = 'rgba(40,60,80,0.5)';
    for (let x = 0; x < W; x += 6) {
      const h = 24 + 16 * Math.abs(Math.sin(x * 0.021));
      g.fillRect(x, 0, 6, h); // northern mountains
    }
    g.fillStyle = 'rgba(46,74,92,0.7)';
    for (let x = 0; x < W; x += 4) {
      const h = 14 + 9 * Math.abs(Math.sin(x * 0.013 + 2));
      g.fillRect(x, H - h, 4, h); // southern river
    }

    // Routes between settlements (dotted)
    g.fillStyle = 'rgba(220,210,170,0.35)';
    const ss = region.settlements;
    for (let i = 1; i < ss.length; i++) {
      const a = this.toPx(ss[0].x, ss[0].y);
      const b = this.toPx(ss[i].x, ss[i].y);
      const steps = Math.floor(Math.hypot(b.px - a.px, b.py - a.py) / 10);
      for (let k = 0; k <= steps; k++) {
        g.fillRect(Math.round(a.px + ((b.px - a.px) * k) / steps), Math.round(a.py + ((b.py - a.py) * k) / steps), 2, 2);
      }
    }

    // Settlements
    for (const t of ss) {
      const { px, py } = this.toPx(t.x, t.y);
      const pop = Math.round(region.popOf(t));
      const houses = Math.min(7, 2 + Math.floor(pop / 25));
      g.fillStyle = '#1a1410';
      g.fillRect(px - houses * 4 - 1, py - 9, houses * 8 + 2, 18);
      for (let i = 0; i < houses; i++) {
        const hx = px - houses * 4 + i * 8;
        g.fillStyle = '#6e4a2f';
        g.fillRect(hx + 1, py - 2, 6, 8);
        g.fillStyle = '#3a2e26';
        g.fillRect(hx, py - 7, 8, 5);
      }
      if (this.selectedId === t.id) {
        g.strokeStyle = '#e8d27a';
        g.strokeRect(px - houses * 4 - 3.5, py - 11.5, houses * 8 + 7, 23);
      }
      g.fillStyle = '#e8d27a';
      g.font = '12px monospace';
      g.textAlign = 'center';
      g.fillText(t.name, px, py + 24);
      g.fillStyle = '#dfe6ee';
      g.fillText(`${pop}`, px, py + 38);
      if (region.day - t.lastRaidDay < 5) {
        g.fillStyle = '#e04444';
        g.fillText('⚔', px + houses * 4 + 12, py);
      }
    }

    // Expeditions: a wagon dot crawling to its site
    for (const e of region.expeditions) {
      const { px, py } = this.toPx(e.x, e.y);
      const target = this.toPx(e.targetX, e.targetY);
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

    // Charter banner
    if (!region.stateProclaimed) {
      g.fillStyle = 'rgba(16,14,10,0.85)';
      g.fillRect(W / 2 - 230, H - 40, 460, 26);
      g.fillStyle = region.charterEligible() ? '#8fc26a' : '#998c6e';
      g.font = '12px monospace';
      const need = region.charterEligible()
        ? `Regional Charter being drafted… ${Math.floor(region.charterProgress)}%`
        : `Toward Statehood: ${region.settlements.length}/3 towns · ${region.totalPop()}/500 citizens`;
      g.fillText(need, W / 2 - 220, H - 23);
    } else {
      g.fillStyle = 'rgba(110,74,47,0.92)';
      g.fillRect(W / 2 - 200, H - 44, 400, 30);
      g.fillStyle = '#e8d27a';
      g.font = 'bold 14px monospace';
      g.textAlign = 'center';
      g.fillText('★ THE STATE IS PROCLAIMED ★', W / 2, H - 24);
      g.textAlign = 'left';
    }

    this.drawPanel();
  }

  private drawPanel(): void {
    const t = this.region.settlements.find((s) => s.id === this.selectedId);
    if (!t) {
      this.panel.classList.add('hidden');
      return;
    }
    this.panel.classList.remove('hidden');
    this.panel.innerHTML = this.panelHtml(t);
    const btn = this.panel.querySelector<HTMLButtonElement>('#found-btn');
    if (btn) {
      btn.onclick = () => {
        this.region.foundTown(t.id);
      };
    }
  }

  private panelHtml(t: Settlement): string {
    const r = this.region;
    const bands = t.cohorts.bands
      .map((v, i) => `<div class="bar-row"><span>${AGE_BANDS[i]}</span><div class="bar"><div class="bar-fill" style="width:${Math.min(100, (v / Math.max(1, r.popOf(t))) * 100 * 2.5)}%"></div></div><span>${Math.round(v)}</span></div>`)
      .join('');
    const notables = r.notablesAt(t.id)
      .map((n) => `<li><b>${n.name}</b>, ${Math.floor(n.age)} — <abbr title="${ROLE_BONUS_DESC[n.role]}">${n.role}</abbr><br><span class="insp-skills">${n.bio[n.bio.length - 1]}</span></li>`)
      .join('');
    const can = r.canFoundTown(t.id);
    return (
      `<h3>${t.name}</h3>` +
      `<p class="insp-state">pop ${Math.round(r.popOf(t))} · housing ${Math.floor(t.housing)} · satisfaction ${Math.round(t.satisfaction)}</p>` +
      `<p>food ${Math.floor(t.food)} · wood ${Math.floor(t.wood)} · land ${t.landQuality.toFixed(2)}</p>` +
      `<p class="insp-skills">COHORTS</p>` + bands +
      (notables ? `<p class="insp-skills">NOTABLES</p><ul class="thoughts">${notables}</ul>` : '') +
      `<button id="found-btn" ${can.ok ? '' : 'disabled'} title="${can.reason}">Found new town (8 pop, 80 food, 80 wood)</button>` +
      (can.ok ? '' : `<p class="insp-skills">${can.reason}</p>`)
    );
  }
}
