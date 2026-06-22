import { SCENARIOS } from '../sim/region';

interface AudioHandles {
  sfx: { muted: boolean; toggleMuted(): void } | null;
  music: { enabled: boolean; toggle(): void; unlock(): void } | null;
  soundscape: { enabled: boolean; toggle(): void; unlock(): void } | null;
}

interface Cloud { x: number; y: number; r: number; speed: number; }

/** Selection returned when the player begins a campaign from the scenario screen. */
export interface ScenarioSelection {
  scenarioId: string | null; // null = sandbox
  eraStart: '1919' | '1950' | '2000';
  difficulty: 'standard' | 'hard' | 'brutal';
}

/** Pure HTML renderer for the scenario selection panel (can also be used headlessly). */
export function scenarioSelectHtml(selectedId: string | null): string {
  const entries = [
    { id: null, name: 'Sandbox', desc: '1919 — free play, no goals', era: '1919' as const, diff: 'standard' as const },
    ...SCENARIOS.map((s) => ({ id: s.id, name: s.name, desc: `${s.eraStart} — ${s.description.slice(0, 60)}...`, era: s.eraStart, diff: s.difficulty })),
  ];
  const rows = entries.map((e) => {
    const isSelected = selectedId === e.id;
    const diffBadge = e.diff === 'brutal' ? '&#9760;&#9760;' : e.diff === 'hard' ? '&#9760;' : '';
    return `<label class="ts-scenario-row ${isSelected ? 'ts-scenario-selected' : ''}">
      <input type="radio" name="scenario" value="${e.id ?? '__sandbox__'}" ${isSelected ? 'checked' : ''}>
      <span class="ts-scenario-name">${e.name}</span>
      <span class="ts-scenario-era">${e.era}</span>
      ${diffBadge ? `<span class="ts-scenario-diff">${diffBadge}</span>` : ''}
      <span class="ts-scenario-desc">${e.desc}</span>
    </label>`;
  }).join('');
  return `<div class="ts-scenario-list">${rows}</div>`;
}

export class TitleScreen {
  private el: HTMLElement;
  private view: 'main' | 'options' | 'scenario' = 'main';
  private hasSave = false;
  private canvas: HTMLCanvasElement | null = null;
  private animFrame = 0;
  private clouds: Cloud[] = [];
  private selectedScenario: string | null = null; // null = sandbox

  onNewColony: (() => void) | null = null;
  /** Called when the player begins a scenario campaign. */
  onBeginScenario: ((sel: ScenarioSelection) => void) | null = null;
  onContinue: (() => void) | null = null;
  onQuit: (() => void) | null = null;

  constructor(root: HTMLElement, private audio: AudioHandles) {
    this.el = document.createElement('div');
    this.el.className = 'title-screen hidden';
    root.appendChild(this.el);
    this.el.addEventListener('mousedown', (e) => this.handleClick(e));
  }

  show(hasSave: boolean): void {
    this.hasSave = hasSave;
    this.view = 'main';
    this.render();
    this.el.classList.remove('hidden');
    this.startCanvas();
  }

  hide(): void {
    this.el.classList.add('hidden');
    if (this.animFrame) { cancelAnimationFrame(this.animFrame); this.animFrame = 0; }
  }

  // ---- Background canvas ----

  private startCanvas(): void {
    if (!this.canvas) {
      const c = document.createElement('canvas');
      c.className = 'ts-bg-canvas';
      this.el.prepend(c);
      this.canvas = c;
      this.clouds = Array.from({ length: 7 }, () => ({
        x: Math.random() * 1300,
        y: 30 + Math.random() * 150,
        r: 28 + Math.random() * 52,
        speed: 0.05 + Math.random() * 0.12,
      }));
    }
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
    const loop = () => {
      const w = this.el.clientWidth || 1280;
      const h = this.el.clientHeight || 720;
      if (this.canvas!.width !== w || this.canvas!.height !== h) {
        this.canvas!.width = w; this.canvas!.height = h;
      }
      const ctx = this.canvas!.getContext('2d')!;
      this.drawScene(ctx, w, h);
      this.animFrame = requestAnimationFrame(loop);
    };
    this.animFrame = requestAnimationFrame(loop);
  }

  private drawScene(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const hz = Math.floor(h * 0.53); // horizon y
    const s  = w / 1280;             // scale factor

    // --- SKY ---
    const sky = ctx.createLinearGradient(0, 0, 0, hz);
    sky.addColorStop(0,    '#3a90c8');
    sky.addColorStop(0.45, '#68bce4');
    sky.addColorStop(0.82, '#a0d8f0');
    sky.addColorStop(1,    '#c8e8f8');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, hz);

    // Sun glow (upper-right, above the city skyline)
    const sx = w * 0.74, sy = h * 0.13;
    const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, h * 0.52);
    glow.addColorStop(0,    'rgba(255,245,170,0.70)');
    glow.addColorStop(0.14, 'rgba(255,220,100,0.38)');
    glow.addColorStop(0.38, 'rgba(255,195, 70,0.14)');
    glow.addColorStop(1,    'rgba(255,175, 50,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, w, hz);
    ctx.fillStyle = '#fff8d0';
    ctx.beginPath(); ctx.arc(sx, sy, 26*s, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#ffe858';
    ctx.beginPath(); ctx.arc(sx, sy, 17*s, 0, Math.PI*2); ctx.fill();

    // --- CLOUDS ---
    ctx.save();
    ctx.shadowColor = 'rgba(100,160,210,0.28)';
    ctx.shadowBlur  = 10;
    for (const c of this.clouds) {
      c.x -= c.speed;
      if (c.x + c.r * 3 < 0) c.x = w + c.r * 2;
      ctx.fillStyle = 'rgba(255,255,255,0.93)';
      ctx.beginPath(); ctx.arc(c.x,             c.y,            c.r,       0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(c.x + c.r*0.85,  c.y + c.r*0.08, c.r*0.72,  0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(c.x - c.r*0.78,  c.y + c.r*0.12, c.r*0.62,  0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(c.x + c.r*0.32,  c.y - c.r*0.42, c.r*0.56,  0, Math.PI*2); ctx.fill();
    }
    ctx.restore();

    // --- GROUND ---
    const ground = ctx.createLinearGradient(0, hz, 0, h);
    ground.addColorStop(0,   '#72bc48');
    ground.addColorStop(0.2, '#5aaa34');
    ground.addColorStop(0.6, '#489828');
    ground.addColorStop(1,   '#387820');
    ctx.fillStyle = ground; ctx.fillRect(0, hz, w, h - hz);

    // Far hill ridge
    ctx.fillStyle = '#9cce68';
    ctx.beginPath();
    ctx.moveTo(0, hz+1);
    ctx.bezierCurveTo(w*0.07, hz-58, w*0.20, hz-78, w*0.32, hz-50);
    ctx.bezierCurveTo(w*0.43, hz-28, w*0.55, hz-68, w*0.68, hz-54);
    ctx.bezierCurveTo(w*0.79, hz-40, w*0.91, hz-30, w, hz-15);
    ctx.lineTo(w, hz+1); ctx.closePath(); ctx.fill();

    // Near meadow swell
    ctx.fillStyle = '#84c250';
    ctx.beginPath();
    ctx.moveTo(0, hz+1);
    ctx.bezierCurveTo(w*0.06, hz-24, w*0.15, hz-38, w*0.26, hz-24);
    ctx.bezierCurveTo(w*0.36, hz-14, w*0.45, hz-32, w*0.58, hz-20);
    ctx.bezierCurveTo(w*0.68, hz-10, w*0.80, hz-18, w, hz-6);
    ctx.lineTo(w, hz+1); ctx.closePath(); ctx.fill();

    // Field stripes (countryside left section)
    const strips = ['#64ba3c','#74ca4c','#5aaa34','#6aba42'];
    for (let i = 0; i < 5; i++) {
      const y1 = hz + (h-hz)*(0.09 + i*0.16);
      const y2 = hz + (h-hz)*(0.21 + i*0.16);
      ctx.fillStyle = strips[i % 4];
      ctx.fillRect(0, y1, w*0.38, y2 - y1);
    }

    // Dirt road (converges to horizon, continues right)
    ctx.fillStyle = '#c8a060';
    ctx.beginPath();
    ctx.moveTo(w*0.06, h); ctx.lineTo(w*0.28, hz+5);
    ctx.lineTo(w*0.34, hz+5); ctx.lineTo(w*0.21, h);
    ctx.fill();
    ctx.fillRect(w*0.28, hz+4, w*0.68, 7*s);

    // ---- SMALL HAMLET ----
    this.drawHamlet(ctx, w, hz, s);

    // ---- TOWN ----
    this.drawTown(ctx, w, hz, s);

    // ---- CITY ----
    this.drawCity(ctx, w, hz, s);

    // Scattered trees
    this.drawTrees(ctx, w, hz, s);

    // Horizon atmosphere haze
    const haze = ctx.createLinearGradient(0, hz-18, 0, hz+12);
    haze.addColorStop(0, 'rgba(175,220,255,0)');
    haze.addColorStop(0.5,'rgba(175,220,255,0.20)');
    haze.addColorStop(1, 'rgba(175,220,255,0)');
    ctx.fillStyle = haze; ctx.fillRect(0, hz-18, w, 30);
  }

  private drawHamlet(ctx: CanvasRenderingContext2D, w: number, hz: number, s: number): void {
    const bx = w * 0.08;

    const cottage = (x: number, bw: number, bh: number, rh: number, wall: string, roof: string) => {
      ctx.fillStyle = wall;
      ctx.fillRect(x, hz - bh, bw, bh);
      // Door
      ctx.fillStyle = '#6b3a18';
      ctx.fillRect(x + bw/2 - 5*s, hz - 14*s, 10*s, 14*s);
      // Window
      ctx.fillStyle = '#f0e880';
      ctx.fillRect(x + 7*s, hz - bh + 10*s, 9*s, 8*s);
      // Pitched roof
      ctx.fillStyle = roof;
      ctx.beginPath();
      ctx.moveTo(x - 3*s, hz - bh);
      ctx.lineTo(x + bw/2, hz - bh - rh);
      ctx.lineTo(x + bw + 3*s, hz - bh);
      ctx.closePath(); ctx.fill();
    };

    cottage(bx,         44*s, 40*s, 25*s, '#d4b878', '#5a3818');
    cottage(bx+52*s,    52*s, 46*s, 28*s, '#cca870', '#6b4420');
    cottage(bx+116*s,   38*s, 36*s, 22*s, '#d8bc80', '#523010');
    cottage(bx+164*s,   46*s, 42*s, 26*s, '#c8a468', '#604018');

    // Palisade fence
    ctx.fillStyle = '#7a5830';
    for (let i = 0; i < 6; i++) {
      const fx = bx - 55*s + i*10*s;
      ctx.fillRect(fx, hz - 24*s, 6*s, 24*s);
      ctx.beginPath();
      ctx.moveTo(fx, hz - 24*s); ctx.lineTo(fx + 3*s, hz - 30*s); ctx.lineTo(fx + 6*s, hz - 24*s);
      ctx.closePath(); ctx.fill();
    }
  }

  private drawTown(ctx: CanvasRenderingContext2D, w: number, hz: number, s: number): void {
    const bx = w * 0.36;

    const building = (x: number, bw: number, bh: number, rh: number, wall: string, roof: string) => {
      ctx.fillStyle = wall; ctx.fillRect(x, hz - bh, bw, bh);
      ctx.fillStyle = '#f0e870';
      for (let r = 0; r < Math.floor(bh/(20*s)); r++)
        for (let c = 0; c < Math.floor(bw/(20*s)); c++)
          ctx.fillRect(x + 6*s + c*18*s, hz - bh + 9*s + r*20*s, 8*s, 7*s);
      ctx.fillStyle = roof;
      ctx.beginPath();
      ctx.moveTo(x - 2*s, hz - bh); ctx.lineTo(x + bw/2, hz - bh - rh); ctx.lineTo(x + bw + 2*s, hz - bh);
      ctx.closePath(); ctx.fill();
    };

    building(bx,        78*s, 50*s, 22*s, '#c8b890', '#7a5228');
    building(bx+88*s,   55*s, 62*s, 30*s, '#b8a878', '#6a4820');
    building(bx+152*s,  48*s, 55*s, 26*s, '#c0b080', '#704820');

    // Chapel
    const cx = bx + 212*s, cw = 42*s, ch = 76*s, sh = 52*s;
    ctx.fillStyle = '#c0b498'; ctx.fillRect(cx, hz - ch, cw, ch);
    ctx.fillStyle = '#f0e870';
    ctx.fillRect(cx + cw/2 - 5*s, hz - ch + 14*s, 10*s, 14*s);
    ctx.fillRect(cx + 8*s, hz - ch + 36*s, 9*s, 12*s);
    ctx.fillRect(cx + cw - 17*s, hz - ch + 36*s, 9*s, 12*s);
    // Belfry
    ctx.fillStyle = '#a09078'; ctx.fillRect(cx + cw/2 - 8*s, hz - ch - 20*s, 16*s, 20*s);
    // Spire
    ctx.fillStyle = '#7a5c38';
    ctx.beginPath();
    ctx.moveTo(cx + cw/2 - 9*s, hz - ch - 20*s);
    ctx.lineTo(cx + cw/2, hz - ch - 20*s - sh);
    ctx.lineTo(cx + cw/2 + 9*s, hz - ch - 20*s);
    ctx.closePath(); ctx.fill();
    // Cross
    ctx.fillStyle = '#f8f0b8';
    ctx.fillRect(cx + cw/2 - 1.5*s, hz - ch - 20*s - sh + 4*s, 3*s, 10*s);
    ctx.fillRect(cx + cw/2 - 6*s,   hz - ch - 20*s - sh + 7*s, 12*s, 3*s);
  }

  private drawCity(ctx: CanvasRenderingContext2D, w: number, hz: number, s: number): void {
    const cx = w * 0.57;

    // City wall
    const wh = 28*s;
    ctx.fillStyle = '#907868'; ctx.fillRect(cx, hz - wh, w - cx, wh);
    // Battlements
    ctx.fillStyle = '#7a6858';
    for (let mx = cx + 6*s; mx < w; mx += 20*s)
      ctx.fillRect(mx, hz - wh - 10*s, 12*s, 10*s);

    // Gate
    const gx = cx + 28*s;
    ctx.fillStyle = '#5a4838'; ctx.fillRect(gx, hz - wh, 30*s, wh);
    ctx.fillStyle = '#38281a'; ctx.fillRect(gx + 5*s, hz - wh + 5*s, 20*s, wh - 5*s);

    // Wall flanking towers
    const tower = (tx: number, tw: number, th: number) => {
      ctx.fillStyle = '#806858'; ctx.fillRect(tx, hz - th, tw, th);
      ctx.fillStyle = '#6a5848';
      for (let i = 0; i < Math.floor(tw/(13*s)); i++)
        ctx.fillRect(tx + i*13*s, hz - th - 9*s, 9*s, 9*s);
    };
    tower(cx - 18*s, 32*s, 55*s);
    tower(cx + 128*s, 30*s, 62*s);
    tower(cx + 295*s, 32*s, 58*s);

    // Inner city buildings
    const innerB = (x: number, bw: number, bh: number, color: string) => {
      if (x > w - 10*s) return;
      ctx.fillStyle = color; ctx.fillRect(x, hz - wh - bh, bw, bh);
      ctx.fillStyle = '#584838';
      for (let i = 0; i < Math.floor(bw/(15*s)); i++)
        ctx.fillRect(x + i*15*s, hz - wh - bh - 7*s, 10*s, 7*s);
      ctx.fillStyle = '#e8c840';
      const rows = Math.floor(bh/(22*s)), cols = Math.max(1, Math.floor(bw/(18*s)));
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++)
          ctx.fillRect(x + 5*s + c*18*s, hz - wh - bh + 9*s + r*22*s, 8*s, 7*s);
    };
    innerB(cx+65*s,  55*s,  80*s, '#908070');
    innerB(cx+170*s, 48*s,  72*s, '#887868');
    innerB(cx+228*s, 62*s,  92*s, '#98887a');

    // Keep / castle
    const kx = cx + 98*s, kw = 88*s, kh = 142*s;
    ctx.fillStyle = '#6a5a48'; ctx.fillRect(kx, hz - wh - kh, kw, kh);
    ctx.fillStyle = '#e8c848';
    for (let r = 0; r < 5; r++) {
      ctx.fillRect(kx + kw*0.22 - 5*s, hz - wh - kh + 14*s + r*24*s, 10*s, 9*s);
      ctx.fillRect(kx + kw*0.68 - 5*s, hz - wh - kh + 14*s + r*24*s, 10*s, 9*s);
    }
    ctx.fillStyle = '#584838';
    for (let i = 0; i < 7; i++) ctx.fillRect(kx + i*13*s, hz - wh - kh - 10*s, 9*s, 10*s);
    // Keep flanking turrets
    ctx.fillStyle = '#5a4838';
    ctx.fillRect(kx - 20*s, hz - wh - kh + 22*s, 24*s, kh - 22*s);
    ctx.fillRect(kx + kw - 4*s, hz - wh - kh + 22*s, 24*s, kh - 22*s);
    const cone = (tx: number, tw: number, ty: number, th: number) => {
      ctx.fillStyle = '#8a3020';
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx+tw/2, ty-th); ctx.lineTo(tx+tw, ty); ctx.closePath(); ctx.fill();
    };
    cone(kx - 20*s,         24*s, hz - wh - kh + 22*s, 38*s);
    cone(kx + kw - 4*s,     24*s, hz - wh - kh + 22*s, 38*s);

    // Cathedral (tallest element, far right of city)
    const catX = cx + 335*s;
    if (catX < w - 15*s) {
      const catW = 58*s, catH = 125*s, spH = 165*s;
      // Nave
      ctx.fillStyle = '#6a5848'; ctx.fillRect(catX - 14*s, hz - wh - catH + 28*s, catW + 28*s, catH - 28*s);
      // Tower
      ctx.fillStyle = '#7a6858'; ctx.fillRect(catX, hz - wh - catH, catW, catH);
      ctx.fillStyle = '#e8c838';
      ctx.fillRect(catX + catW/2 - 7*s, hz - wh - catH + 12*s, 14*s, 18*s);
      for (let i = 0; i < 3; i++)
        ctx.fillRect(catX + 7*s + i*20*s, hz - wh - catH + 44*s, 9*s, 13*s);
      // Spire base
      ctx.fillStyle = '#5a4838'; ctx.fillRect(catX + catW/2 - 11*s, hz - wh - catH - 28*s, 22*s, 28*s);
      // Spire
      ctx.fillStyle = '#7a3828';
      ctx.beginPath();
      ctx.moveTo(catX + catW/2 - 13*s, hz - wh - catH - 28*s);
      ctx.lineTo(catX + catW/2,         hz - wh - catH - 28*s - spH);
      ctx.lineTo(catX + catW/2 + 13*s,  hz - wh - catH - 28*s);
      ctx.closePath(); ctx.fill();
      // Cross atop spire
      ctx.fillStyle = '#f8f0b8';
      const cy2 = hz - wh - catH - 28*s - spH + 8*s;
      ctx.fillRect(catX + catW/2 - 1.5*s, cy2,        3*s, 14*s);
      ctx.fillRect(catX + catW/2 - 7*s,   cy2 + 4*s,  14*s, 3*s);
    }
  }

  private drawTrees(ctx: CanvasRenderingContext2D, w: number, hz: number, s: number): void {
    const tree = (x: number, th: number, tw: number, col: string) => {
      ctx.fillStyle = '#5a3a18';
      ctx.fillRect(x - 3*s, hz - th*0.35, 6*s, th*0.35);
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.ellipse(x, hz - th*0.35 - tw*0.48, tw*0.5, tw*0.42, 0, 0, Math.PI*2); ctx.fill();
    };
    tree(w*0.04,  44*s, 35*s, '#268020');
    tree(w*0.065, 54*s, 44*s, '#388028');
    tree(w*0.31,  50*s, 38*s, '#2a8028');
    tree(w*0.345, 46*s, 36*s, '#307828');
    tree(w*0.42,  52*s, 40*s, '#2a8830');
    tree(w*0.455, 44*s, 34*s, '#347830');
  }

  // ---- HTML rendering ----

  private render(): void {
    if (this.view === 'main') this.el.innerHTML = this.mainHtml();
    else if (this.view === 'scenario') this.el.innerHTML = this.scenarioHtml();
    else this.el.innerHTML = this.optionsHtml();
    // innerHTML wiped the prepended background canvas — re-attach it so the
    // animated scene survives navigation between the main, scenario, and options views.
    if (this.canvas) this.el.prepend(this.canvas);
  }

  private mainHtml(): string {
    return `
      <div class="ts-layout">
        <div class="ts-left">
          <div class="ts-brand">
            <h1 class="ts-title">CENTURIA</h1>
            <p class="ts-tagline">Build &nbsp;·&nbsp; Endure &nbsp;·&nbsp; Govern</p>
          </div>
          <blockquote class="ts-quote">
            "A colony is only as strong as the hands willing to work it —<br>
            and the mind willing to lead them."
          </blockquote>
          <p class="ts-version">v${__APP_VERSION__} &nbsp;·&nbsp; Early Access</p>
        </div>
        <div class="ts-panel">
          <nav class="ts-nav">
            <button class="ts-btn ts-btn-primary" id="ts-new" title="The scale-engine colony sim on procedural terrain — paint walls, rooms, zones, and farms">New Colony</button>
            <button class="ts-btn" id="ts-scenarios">Historical Scenarios &nbsp;<span class="ts-arrow">›</span></button>
            <button class="ts-btn" id="ts-continue" ${this.hasSave ? '' : 'disabled'}>Continue</button>
            <div class="ts-sep"></div>
            <button class="ts-btn" id="ts-options">Options &nbsp;<span class="ts-arrow">›</span></button>
            <div class="ts-sep"></div>
            <button class="ts-btn ts-btn-quit" id="ts-quit">Quit to Desktop</button>
          </nav>
        </div>
      </div>`;
  }

  private scenarioHtml(): string {
    const sel = this.selectedScenario;
    const scenario = sel ? SCENARIOS.find((s) => s.id === sel) : null;
    const eraLabel = scenario ? scenario.eraStart : '1919';
    const diffLabel = scenario ? scenario.difficulty : 'standard';
    return `
      <div class="ts-layout">
        <div class="ts-left">
          <div class="ts-brand">
            <h1 class="ts-title">CENTURIA</h1>
            <p class="ts-tagline">Choose Your Start</p>
          </div>
          <blockquote class="ts-quote">
            ${scenario ? `"${scenario.openingEvent}"` : '"Begin your story on your own terms."'}
          </blockquote>
          <p class="ts-version">Era: ${eraLabel} &nbsp;·&nbsp; Difficulty: ${diffLabel}</p>
        </div>
        <div class="ts-panel ts-panel-wide">
          <nav class="ts-nav">
            <button class="ts-btn ts-btn-back" id="ts-back">‹ &nbsp;Back</button>
            <div class="ts-sep"></div>
            ${scenarioSelectHtml(sel)}
            <div class="ts-sep"></div>
            <button class="ts-btn ts-btn-primary" id="ts-begin-scenario">&#9654; Begin Campaign</button>
          </nav>
        </div>
      </div>`;
  }

  private optionsHtml(): string {
    const { sfx, music, soundscape } = this.audio;
    const isFullscreen = !!document.fullscreenElement;
    return `
      <div class="ts-layout">
        <div class="ts-left">
          <div class="ts-brand">
            <h1 class="ts-title">CENTURIA</h1>
            <p class="ts-tagline">Options</p>
          </div>
        </div>
        <div class="ts-panel">
          <nav class="ts-nav">
            <button class="ts-btn ts-btn-back" id="ts-back">‹ &nbsp;Back</button>
            <div class="ts-sep"></div>
            <button class="ts-btn ts-toggle" id="ts-sound">
              <span>Sound Effects</span>
              <span class="ts-val ${sfx?.muted ? 'ts-off' : 'ts-on'}">${sfx?.muted ? 'OFF' : 'ON'}</span>
            </button>
            <button class="ts-btn ts-toggle" id="ts-music">
              <span>Music</span>
              <span class="ts-val ${music?.enabled ? 'ts-on' : 'ts-off'}">${music?.enabled ? 'ON' : 'OFF'}</span>
            </button>
            <button class="ts-btn ts-toggle" id="ts-ambience">
              <span>Ambience</span>
              <span class="ts-val ${soundscape?.enabled ? 'ts-on' : 'ts-off'}">${soundscape?.enabled ? 'ON' : 'OFF'}</span>
            </button>
            <div class="ts-sep"></div>
            <button class="ts-btn ts-toggle" id="ts-fullscreen">
              <span>Display Mode</span>
              <span class="ts-val">${isFullscreen ? 'Fullscreen' : 'Windowed'}</span>
            </button>
          </nav>
        </div>
      </div>`;
  }

  private handleClick(e: MouseEvent): void {
    // Handle scenario radio button changes
    const radio = (e.target as HTMLElement).closest<HTMLInputElement>('input[type="radio"]');
    if (radio) {
      const val = radio.value;
      this.selectedScenario = val === '__sandbox__' ? null : val;
      this.render();
      return;
    }

    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!btn || btn.disabled) return;
    switch (btn.id) {
      case 'ts-new':      this.onNewColony?.(); break;
      case 'ts-continue': this.onContinue?.();  break;
      case 'ts-quit':     this.onQuit?.();       break;
      case 'ts-scenarios': this.view = 'scenario'; this.render(); break;
      case 'ts-options':  this.view = 'options'; this.render(); break;
      case 'ts-back':     this.view = 'main';    this.render(); break;
      case 'ts-begin-scenario': {
        const scenario = this.selectedScenario ? SCENARIOS.find((s) => s.id === this.selectedScenario) : null;
        const sel: ScenarioSelection = {
          scenarioId: this.selectedScenario,
          eraStart: scenario ? scenario.eraStart : '1919',
          difficulty: scenario ? scenario.difficulty : 'standard',
        };
        this.onBeginScenario?.(sel);
        break;
      }
      case 'ts-sound':
        this.audio.sfx?.toggleMuted(); this.render(); break;
      case 'ts-music':
        this.audio.music?.toggle(); this.audio.music?.unlock(); this.render(); break;
      case 'ts-ambience':
        this.audio.soundscape?.toggle(); this.audio.soundscape?.unlock(); this.render(); break;
      case 'ts-fullscreen':
        if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
        else document.exitFullscreen?.().catch(() => {});
        this.render();
        break;
    }
  }
}
