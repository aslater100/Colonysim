/**
 * Region view (Tier 1.5 → 2): the zoomed-out map that becomes the default
 * operating altitude after the flip (GDD §2.5). Painterly backdrop, town
 * markers, routes, expedition wagons; DOM panel for the selected settlement.
 */
import type { RegionSim, Settlement, GovLean } from '../sim/region';
import { AGE_BANDS, ROLE_BONUS_DESC, GOV_LEANS, RAIL_ERA_YEAR } from '../sim/region';

export class RegionView {
  selectedId: number | null = null;
  /** set true by the view while the Incorporation ceremony is on screen */
  ceremonyOpen = false;
  private g: CanvasRenderingContext2D;
  private panel: HTMLElement;
  private statePanel: HTMLElement;
  private ceremony: HTMLElement;
  private frame = 0;

  constructor(private canvas: HTMLCanvasElement, private region: RegionSim, root: HTMLElement) {
    this.g = canvas.getContext('2d')!;
    this.panel = document.createElement('div');
    this.panel.className = 'inspector region-panel hidden';
    root.appendChild(this.panel);
    this.statePanel = document.createElement('div');
    this.statePanel.className = 'palette state-panel hidden';
    root.appendChild(this.statePanel);
    this.ceremony = document.createElement('div');
    this.ceremony.className = 'ceremony hidden';
    root.appendChild(this.ceremony);
  }

  destroyPanel(): void {
    this.panel.remove();
    this.statePanel.remove();
    this.ceremony.remove();
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

    g.fillStyle = '#10141c';
    g.fillRect(0, 0, W, H);
    this.drawTerrain(W, H);

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
          : `rgba(216,180,106,${alpha})`;
        g.lineWidth = r.kind === 'rail' ? 3 : r.kind === 'highway' ? 4 : 2;
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
      }
    }

    // Settlements
    for (const t of ss) {
      const { px, py } = this.toPx(t.x, t.y);
      const pop = Math.round(region.popOf(t));
      const houses = Math.min(7, 2 + Math.floor(pop / 25));
      // Station (M6c): towns on the rail network get a depot by the tracks
      if (region.routes.some((r) => r.kind === 'rail' && (r.a === t.id || r.b === t.id))) {
        const sx = px + houses * 4 + 4;
        g.fillStyle = '#7a3b2e'; // brick depot
        g.fillRect(sx, py - 4, 10, 10);
        g.fillStyle = '#3a2e26';
        g.fillRect(sx - 1, py - 7, 12, 4); // roof
        g.fillStyle = '#969ca8';
        g.fillRect(sx - 2, py + 7, 14, 2); // platform
        g.fillStyle = '#e8d27a';
        g.fillRect(sx + 4, py - 1, 2, 2); // lamplit window
      }
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
      g.fillStyle = region.charterEligible() || region.ceremonyPending ? '#8fc26a' : '#998c6e';
      g.font = '12px monospace';
      const need = region.ceremonyPending
        ? 'The Charter is drafted — the towns await your proclamation.'
        : region.charterEligible()
          ? `Regional Charter being drafted… ${Math.floor(region.charterProgress)}%`
          : `Toward Statehood: ${region.settlements.length}/3 towns · ${region.totalPop()}/500 citizens` +
            (region.connectedToAll() ? '' : ' · towns unconnected!');
      g.fillText(need, W / 2 - 220, H - 23);
    } else {
      g.fillStyle = 'rgba(110,74,47,0.92)';
      g.fillRect(W / 2 - 200, H - 44, 400, 30);
      g.fillStyle = '#e8d27a';
      g.font = 'bold 14px monospace';
      g.textAlign = 'center';
      g.fillText(`★ ${region.stateName.toUpperCase()} ★`, W / 2, H - 24);
      g.textAlign = 'left';
    }

    this.drawWeather(W, H);
    this.drawPanel();
    this.drawStatePanel();
    this.drawCeremony();
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

  /** The generated land itself, in 8-bit blocks: this map IS the world. */
  private drawTerrain(W: number, H: number): void {
    const { g, region } = this;
    const map = region.map;
    const N = 64; // REGION_N
    const m = 60;
    const cw = (W - 2 * m) / N;
    const ch = (H - 2 * m) / N;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const c = map.at(x, y);
        let col: string;
        switch (c.biome) {
          case 'sea': col = '#243d52'; break;
          case 'lake': col = '#2e4a5c'; break;
          case 'river': col = '#36586e'; break;
          case 'marsh': col = '#39503e'; break;
          case 'plains': col = '#46563a'; break;
          case 'forest': col = '#33502c'; break;
          case 'hills': col = '#5a5742'; break;
          case 'mountains': col = c.elevation > 0.85 ? '#9a978f' : '#6a6358'; break;
        }
        g.fillStyle = col;
        g.fillRect(Math.floor(m + x * cw), Math.floor(m + y * ch), Math.ceil(cw), Math.ceil(ch));
        // elevation shading + a pixel of texture
        if ((x * 7 + y * 13) % 9 === 0 && c.biome !== 'sea') {
          g.fillStyle = 'rgba(0,0,0,0.15)';
          g.fillRect(Math.floor(m + x * cw), Math.floor(m + y * ch), 2, 2);
        }
        if (c.elevation > 0.5 && c.biome !== 'mountains') {
          g.fillStyle = `rgba(255,255,240,${(c.elevation - 0.5) * 0.12})`;
          g.fillRect(Math.floor(m + x * cw), Math.floor(m + y * ch), Math.ceil(cw), Math.ceil(ch));
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

  /** Tier-2 dashboard: treasury, taxes, funded services — visible once proclaimed. */
  private drawStatePanel(): void {
    const r = this.region;
    if (!r.stateProclaimed) {
      this.statePanel.classList.add('hidden');
      return;
    }
    this.statePanel.classList.remove('hidden');
    const lvl = (v: number) => ['none', 'basic', 'funded'][v];
    this.statePanel.innerHTML =
      `<div class="pal-title">${r.stateName.toUpperCase()}</div>` +
      `<p class="insp-skills">${r.govLean ? GOV_LEANS[r.govLean].name : ''}</p>` +
      `<p>treasury £${Math.floor(r.treasury)}</p>` +
      `<p>GDP £${Math.floor(r.gdpLastMonth)}/mo</p>` +
      `<p>trade £${Math.floor(r.tradeValueLastMonth)}/mo turnover</p>` +
      `<p>tax <span id="tax-val">${Math.round(r.taxRate * 100)}%</span></p>` +
      `<input id="tax-slider" type="range" min="0" max="30" value="${Math.round(r.taxRate * 100)}">` +
      `<p>services: <b>${lvl(r.servicesLevel)}</b> <button class="mini" id="svc-up">+</button><button class="mini" id="svc-dn">−</button></p>` +
      `<p>militia: <b>${lvl(r.militiaLevel)}</b> <button class="mini" id="mil-up">+</button><button class="mini" id="mil-dn">−</button></p>` +
      `<p class="insp-skills">high taxes breed strikes; services cost £ but save lives</p>` +
      `<p class="insp-skills">${r.highwayUnlocked()
        ? 'THE ASPHALT AGE — highways from any town panel'
        : r.railUnlocked()
          ? 'RAILWORKS chartered — lay rail from any town panel'
          : `railworks expected ~${RAIL_ERA_YEAR}`}</p>` +
      this.freightHtml();
    this.statePanel.querySelector<HTMLInputElement>('#tax-slider')!.oninput = (e) => {
      r.taxRate = Number((e.target as HTMLInputElement).value) / 100;
    };
    this.statePanel.querySelector<HTMLButtonElement>('#svc-up')!.onclick = () => {
      r.servicesLevel = Math.min(2, r.servicesLevel + 1);
    };
    this.statePanel.querySelector<HTMLButtonElement>('#svc-dn')!.onclick = () => {
      r.servicesLevel = Math.max(0, r.servicesLevel - 1);
    };
    this.statePanel.querySelector<HTMLButtonElement>('#mil-up')!.onclick = () => {
      r.militiaLevel = Math.min(2, r.militiaLevel + 1);
    };
    this.statePanel.querySelector<HTMLButtonElement>('#mil-dn')!.onclick = () => {
      r.militiaLevel = Math.max(0, r.militiaLevel - 1);
    };
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
    for (const rb of this.panel.querySelectorAll<HTMLButtonElement>('.road-btn')) {
      rb.onclick = () => {
        this.region.buildRoad(t.id, Number(rb.dataset.to));
      };
    }
    for (const rb of this.panel.querySelectorAll<HTMLButtonElement>('.rail-btn')) {
      rb.onclick = () => {
        this.region.buildRail(t.id, Number(rb.dataset.to));
      };
    }
    for (const rb of this.panel.querySelectorAll<HTMLButtonElement>('.hwy-btn')) {
      rb.onclick = () => {
        this.region.buildHighway(t.id, Number(rb.dataset.to));
      };
    }
    for (const rb of this.panel.querySelectorAll<HTMLButtonElement>('.repair-btn')) {
      rb.onclick = () => {
        this.region.repairRoute(t.id, Number(rb.dataset.to));
      };
    }
  }

  /** Route list to every other town, with terrain-priced build/repair buttons. */
  private routesHtml(t: Settlement): string {
    const r = this.region;
    const rows = r.settlements
      .filter((o) => o.id !== t.id)
      .map((o) => {
        const route = r.routeBetween(t.id, o.id);
        const status = route ? `${route.kind} · ${Math.round(route.condition)}%` : 'no route';
        let btn = '';
        if (r.stateProclaimed && (!route || route.kind === 'trail')) {
          const cost = r.roadCost(t.id, o.id);
          if (cost) {
            const afford = r.treasury >= cost.total;
            btn += ` <button class="mini road-btn" data-to="${o.id}" ${afford ? '' : 'disabled'} ` +
              `title="£${cost.total}: ${cost.breakdown}">road £${cost.total}</button>`;
          }
        }
        if (r.railUnlocked() && (!route || (route.kind !== 'rail' && route.kind !== 'highway'))) {
          const cost = r.railCost(t.id, o.id);
          if (cost) {
            const afford = r.treasury >= cost.total;
            btn += ` <button class="mini rail-btn" data-to="${o.id}" ${afford ? '' : 'disabled'} ` +
              `title="£${cost.total}: ${cost.breakdown}">rail £${cost.total}</button>`;
          }
        }
        if (r.highwayUnlocked() && (!route || route.kind !== 'highway')) {
          const cost = r.highwayCost(t.id, o.id);
          if (cost) {
            const afford = r.treasury >= cost.total;
            btn += ` <button class="mini hwy-btn" data-to="${o.id}" ${afford ? '' : 'disabled'} ` +
              `title="£${cost.total}: ${cost.breakdown}${route?.kind === 'rail' ? ' — replaces the rail line' : ''}">highway £${cost.total}</button>`;
          }
        }
        if (r.stateProclaimed && route && route.kind !== 'trail' && route.condition < 85) {
          const cost = r.repairCost(route);
          const afford = r.treasury >= cost;
          btn += ` <button class="mini repair-btn" data-to="${o.id}" ${afford ? '' : 'disabled'} ` +
            `title="restore to 100%">repair £${cost}</button>`;
        }
        return `<li>${o.name} — <span class="insp-skills">${status}</span>${btn}</li>`;
      })
      .join('');
    if (!rows) return '';
    return `<p class="insp-skills">ROUTES</p><ul class="thoughts">${rows}</ul>`;
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
      (r.stateProclaimed
        ? `<p class="${t.grievance > 50 ? 'insp-cond' : 'insp-skills'}">grievance ${Math.round(t.grievance)}${this.region.day < t.strikeUntil ? ' · ON STRIKE' : ''}</p>`
        : '') +
      `<p>food ${Math.floor(t.food)} · wood ${Math.floor(t.wood)} · land ${t.landQuality.toFixed(2)}</p>` +
      `<p class="insp-skills">market: grain £${t.prices.food.toFixed(2)} · timber £${t.prices.wood.toFixed(2)} /unit</p>` +
      `<p class="insp-skills">${[
        t.site.river ? 'river (fishery, flood risk)' : '',
        t.site.coastal ? 'coastal (fishery)' : '',
        t.site.forest > 0.5 ? 'forested (good timber)' : '',
        t.site.roughness > 0.5 ? 'rough country' : '',
        t.site.fertility > 1.05 ? 'rich soil' : t.site.fertility < 0.7 ? 'poor soil' : '',
      ].filter(Boolean).join(' · ') || 'open plains'}</p>` +
      this.routesHtml(t) +
      `<p class="insp-skills">COHORTS</p>` + bands +
      (notables ? `<p class="insp-skills">NOTABLES</p><ul class="thoughts">${notables}</ul>` : '') +
      `<button id="found-btn" ${can.ok ? '' : 'disabled'} title="${can.reason}">Found new town (8 pop, 80 food, 80 wood)</button>` +
      (can.ok ? '' : `<p class="insp-skills">${can.reason}</p>`)
    );
  }
}
