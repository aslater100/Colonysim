/**
 * Region view (Tier 1.5 → 2): the zoomed-out map that becomes the default
 * operating altitude after the flip (GDD §2.5). Painterly backdrop, town
 * markers, routes, expedition wagons; DOM panel for the selected settlement.
 */
import type { RegionSim, Settlement, GovLean, GovType, MinisterRoleId, TreatyKind, CasusBelli, Mobilization, PeaceTerm, DealBasket, OccupationPolicy } from '../sim/region';
import { AGE_BANDS, ROLE_BONUS_DESC, GOV_LEANS, GOV_TYPES, MINISTER_ROLES, RAIL_ERA_YEAR, TECH_TREE, REGION_LAWS, POLICY_CARDS, POLICY_SWAP_COST, TREATY_DEFS, RIVAL_ARCHETYPES, ENVOY_COST, GIFT_COST, ENVOY_COOLDOWN_DAYS, GIFT_COOLDOWN_DAYS, CASUS_BELLI_DEFS, MOBILIZATION_DEFS, PEACE_TERMS, WAR_SUPPORT_FLOOR, OCCUPATION_DEFS, MAX_OCCUPIED_MARCHES, BLOCKADE_UPKEEP_PER_POP } from '../sim/region';

export class RegionView {
  selectedId: number | null = null;
  /** set true by the view while the Incorporation ceremony is on screen */
  ceremonyOpen = false;
  conventionOpen = false;
  private g: CanvasRenderingContext2D;
  private panel: HTMLElement;
  private statePanel: HTMLElement;
  private researchPanel: HTMLElement;
  researchOpen = false;
  private ceremony: HTMLElement;
  private convention: HTMLElement;
  private policyModal: HTMLElement;
  private policySlotIndex = -1;
  // the bargaining table (GDD §6.3): basket state lives here while composing
  private dealModal: HTMLElement;
  private dealRivalId = -1;
  private dealTreaties = new Set<TreatyKind>();
  private dealGoldToThem = 0;
  private dealGoldToYou = 0;
  private dealBorder = false;
  /** Peace terms ticked at the war room's table (GDD §7.4). */
  private peacePicks = new Set<PeaceTerm>();
  private frame = 0;

  constructor(private canvas: HTMLCanvasElement, private region: RegionSim, root: HTMLElement) {
    this.g = canvas.getContext('2d')!;
    this.panel = document.createElement('div');
    this.panel.className = 'inspector region-panel hidden';
    root.appendChild(this.panel);
    this.statePanel = document.createElement('div');
    this.statePanel.className = 'palette state-panel hidden';
    root.appendChild(this.statePanel);
    this.researchPanel = document.createElement('div');
    this.researchPanel.className = 'palette research-panel hidden';
    root.appendChild(this.researchPanel);
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
  }

  destroyPanel(): void {
    this.panel.remove();
    this.statePanel.remove();
    this.researchPanel.remove();
    this.ceremony.remove();
    this.convention.remove();
    this.policyModal.remove();
    this.dealModal.remove();
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

    this.drawRivalBanners(W, H);
    this.drawWeather(W, H);
    this.drawPanel();
    this.drawStatePanel();
    this.drawResearchPanel();
    this.drawCeremony();
    this.drawConvention();
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
    this.convention.innerHTML =
      `<div class="ceremony-box">` +
      `<h2>★ THE CONSTITUTIONAL CONVENTION ★</h2>` +
      `<p>${Math.round(r.totalPop())} citizens, ${r.settlements.length} towns, ${r.researched.length} research nodes complete.<br>` +
      `The time has come to proclaim the Nation.</p>` +
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
    };
    this.convention.querySelector<HTMLButtonElement>('#convention-cancel-btn')!.onclick = () => {
      this.conventionOpen = false;
      this.convention.classList.add('hidden');
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
    const researchLabel = r.activeResearch
      ? TECH_TREE.find((n) => n.id === r.activeResearch)?.name ?? r.activeResearch
      : `${r.researched.length}/${TECH_TREE.length} nodes`;
    this.statePanel.innerHTML =
      `<div class="pal-title">${r.nationProclaimed ? r.nationName.toUpperCase() : r.stateName.toUpperCase()}</div>` +
      `<p class="insp-skills">${r.nationProclaimed && r.govType
        ? GOV_TYPES.find((g) => g.id === r.govType)!.name
        : r.govLean ? GOV_LEANS[r.govLean].name : ''}</p>` +
      (r.nationProclaimed ? this.nationHtml() : '') +
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
      `<p><button class="mini" id="research-toggle">${this.researchOpen ? '▲ research' : '▼ research'}</button> <span class="insp-skills">${researchLabel}</span></p>` +
      (r.canCallConvention() ? `<p><button id="convention-btn" style="font-size:10px;background:#8b5cf6;color:#fff;border:none;padding:4px 8px;cursor:pointer">★ CONVENE CONSTITUTIONAL CONVENTION</button></p>` : '') +
      this.politicsHtml() +
      this.diplomacyHtml() +
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
    this.statePanel.querySelector<HTMLButtonElement>('#research-toggle')!.onclick = () => {
      this.researchOpen = !this.researchOpen;
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
  }

  /** Diplomacy section (GDD §5.4): the rival ledger, treaties, and verbs. */
  private diplomacyHtml(): string {
    const r = this.region;
    if (r.rivals.length === 0) return '';
    const short: Record<TreatyKind, string> = {
      non_aggression: 'pact: NAP', trade_agreement: 'pact: trade', defensive_pact: 'pact: defense',
    };
    const rows = r.rivals.map((rv) => {
      const rel = Math.round(rv.relations);
      const col = rel >= 25 ? '#4e9' : rel >= -25 ? '#ca4' : '#e55';
      const pct = Math.round((rel + 100) / 2);
      const gov = r.regimeOf(rv).name;
      const recentHistory = rv.history.slice(-4).join(' ');
      const treaties = rv.treaties.length > 0
        ? rv.treaties.map((k) =>
            `${TREATY_DEFS[k].name} <button class="mini dip-break-btn" data-rival="${rv.id}" data-kind="${k}" ` +
            `title="Tearing up a treaty is remembered by every chancery">✕</button>`).join(' · ')
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
        .filter((k) => !rv.treaties.includes(k))
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
          `title="A paid mission to warm relations (${ENVOY_COOLDOWN_DAYS}-day turnaround)">envoy £${ENVOY_COST}</button> ` +
          `<button class="mini dip-gift-btn" data-rival="${rv.id}" ${canGift ? '' : 'disabled'} ` +
          `title="A state gift — dearer, faster">gift £${GIFT_COST}</button> ` +
          `<button class="mini dip-deal-btn" data-rival="${rv.id}" ` +
          `title="Open the bargaining table: compose a multi-item basket (GDD §6.3)">negotiate</button> ` +
          proposals + warBtn + `</p>`;
      return `<div class="bar-row" title="${RIVAL_ARCHETYPES[rv.archetype].name} — agenda: ${rv.agenda}. ${recentHistory}">` +
        `<span style="width:80px;display:inline-block"><b>${rv.name}</b></span>` +
        `<div class="bar" style="flex:1"><div class="bar-fill" style="width:${pct}%;background:${col}"></div></div>` +
        `<span>${rel}</span></div>` +
        `<p class="insp-skills" title="${recentHistory}">${gov}${rv.borderSettled ? ' · border settled' : ''} · ${treaties}</p>` +
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
    const exports = r.exportEarningsLastMonth > 0 ? `<p>exports £${Math.floor(r.exportEarningsLastMonth)}/mo</p>` : '';
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
        : `Close their lanes: their power −15%, score climbs — costs £${BLOCKADE_UPKEEP_PER_POP}/pop/mo and your own exports (needs funded militia or a standing army)`}">` +
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
        `yield £${w.occupied * (OCCUPATION_DEFS[w.occupationPolicy].yield - OCCUPATION_DEFS[w.occupationPolicy].garrison)}/mo net</p>` +
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
      const upkeepNote = card && card.upkeep > 0 ? ` (£${card.upkeep}/mo)` : '';
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
        `<b>${c.name}</b>${c.upkeep > 0 ? ` £${c.upkeep}/mo` : ''}` +
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
    if (v.counter) return `± Close: ${ledger}. They would counter, asking £${v.counter.goldToThem - this.dealGoldToThem} more.`;
    return `✗ ${ledger}. They would walk — "${v.reason}."`;
  }

  private renderDealModal(): void {
    const r = this.region;
    const rv = r.rival(this.dealRivalId);
    if (!rv) return;
    const treatyRows = (Object.keys(TREATY_DEFS) as TreatyKind[]).map((k) => {
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
      `<p><label>£ to them <input type="number" id="deal-gold-them" min="0" step="5" value="${this.dealGoldToThem}" style="width:70px"></label> ` +
      `<label>£ asked of them <input type="number" id="deal-gold-you" min="0" step="5" value="${this.dealGoldToYou}" style="width:70px"></label> ` +
      `<span class="insp-skills">(treasury £${Math.floor(r.treasury)})</span></p>` +
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

  /** Research panel: tech + civics tree progress, node browser, start/cancel. */
  private drawResearchPanel(): void {
    const r = this.region;
    if (!this.researchOpen) {
      this.researchPanel.classList.add('hidden');
      return;
    }
    this.researchPanel.classList.remove('hidden');
    const rate = r.researchRate().toFixed(1);
    const active = r.activeResearch ? TECH_TREE.find((n) => n.id === r.activeResearch) : null;
    const progressPct = active ? Math.min(100, Math.round((r.researchProgress / active.cost) * 100)) : 0;

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
      return `<div class="res-row ${cls}" title="${node.desc}">[${label}] ${node.name} (${node.cost || '✓'} RP)${pctStr}${btn}</div>`;
    };

    const techNodes = TECH_TREE.filter((n) => n.tree === 'tech').map((n) => nodeRow(n.id)).join('');
    const civicNodes = TECH_TREE.filter((n) => n.tree === 'civics').map((n) => nodeRow(n.id)).join('');

    this.researchPanel.innerHTML =
      `<div class="pal-title">RESEARCH</div>` +
      `<p class="insp-skills">${rate} RP/day${active ? ` → <b>${active.name}</b>` : ' (idle)'}</p>` +
      (active ? `<div class="res-bar"><div class="res-bar-fill" style="width:${progressPct}%"></div></div>` : '') +
      `<p class="insp-skills" style="margin-top:6px">TECHNOLOGY</p>` +
      techNodes +
      `<p class="insp-skills" style="margin-top:6px">CIVICS</p>` +
      civicNodes;

    for (const btn of this.researchPanel.querySelectorAll<HTMLButtonElement>('.res-start-btn')) {
      btn.onclick = () => r.startResearch(btn.dataset.id!);
    }
    const cancelBtn = this.researchPanel.querySelector<HTMLButtonElement>('.res-cancel-btn');
    if (cancelBtn) cancelBtn.onclick = () => r.cancelResearch();
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
