/**
 * Backdrop — the parallax atmosphere layer behind the 4X map (GDD §3.1: the
 * byte/beauty budget lives in the atmosphere, the crisp foreground stays cheap).
 *
 * The terrain cache is drawn with a margin and is transparent beyond the hex
 * grid, so wherever land does not cover a pixel — the map's edges, and the whole
 * frame when zoomed out — the viewer currently sees a flat `#10141c` void. This
 * module replaces that void with a 5-band atmospheric gradient that drifts behind
 * the map (parallax) and is tinted by the live game state: **era × season ×
 * era-branch × weather × tension**. It is procedural by default; when the
 * AssetRegistry holds a `backdrop-<era>` image it is composited on top, so a real
 * painted sky slots in with zero renderer changes (the same override discipline
 * as town sprites).
 *
 * Split, like AssetRegistry, into pure helpers (palette + key, unit-tested in
 * Node) and a DOM `Backdrop` class whose `draw()` is the only code that touches a
 * canvas. Every value here is a pure read of sim state — no RNG, no save state.
 */

import type { AssetRegistry } from './assets/registry';

export type Sky = 'clear' | 'overcast' | 'rain' | 'storm' | 'snow';
export type Branch = 'solarpunk' | 'dystopia' | 'drowned' | null;

/** Coarse era id from a year — mirrors the music engine's era windows so the
 *  sky and the soundtrack turn over together. Kept local to avoid a render→audio
 *  import edge. */
export type EraId = 'dawn' | 'modern' | 'analog' | 'digital' | 'future';
export function eraIdForYear(year: number): EraId {
  if (year < 1945) return 'dawn';
  if (year < 1970) return 'modern';
  if (year < 2000) return 'analog';
  if (year < 2040) return 'digital';
  return 'future';
}

/** Tension collapsed to three bands — the sky's mood gate. */
export type StatBand = 'calm' | 'tense' | 'crisis';
export function statBand(tension: number): StatBand {
  if (tension >= 0.7) return 'crisis';
  if (tension >= 0.4) return 'tense';
  return 'calm';
}

export type RGB = [number, number, number];

export interface BackdropBand {
  /** Vertical extent as a fraction of viewport height; bands overlap so their
   *  gradients blend into one another. */
  y0: number;
  y1: number;
  top: RGB;
  bottom: RGB;
  /** 0 = pinned to the viewport (infinitely distant), 1 = tracks the map 1:1.
   *  Distant bands drift least, which reads as depth. */
  parallax: number;
}

/** A single additive bloom of light at the horizon line — the sky's mood made
 *  bright. Calm dusk warmth, a crisis ember, or a branch's signature future
 *  glow. Drawn per-frame (not baked into the gradient cache) so it can pulse. */
export interface BackdropGlow {
  /** Horizon centre as a fraction of viewport height. */
  y: number;
  color: RGB;
  /** 0 = invisible … 1 = full ember. */
  intensity: number;
}

export interface BackdropPalette {
  bands: BackdropBand[];
  /** Stat-driven horizon glow composited over the bands (additive). */
  glow: BackdropGlow;
  /** Cache signature — identical inputs → identical key → no recompose. */
  key: string;
  /** Asset slot to look for an override image (e.g. `backdrop-future`). */
  slot: string;
}

export interface BackdropInputs {
  year: number;
  seasonIndex: number; // 0 Spring … 3 Winter
  branch: Branch;
  sky: Sky;
  tension: number; // 0..1
}

// ---- pure colour maths -----------------------------------------------------

const clamp8 = (n: number): number => (n < 0 ? 0 : n > 255 ? 255 : Math.round(n));
function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function add(c: RGB, d: RGB): RGB {
  return [clamp8(c[0] + d[0]), clamp8(c[1] + d[1]), clamp8(c[2] + d[2])];
}
/** Pull a colour toward its own grey (luma) — `t` = how washed out. */
function desaturate(c: RGB, t: number): RGB {
  const l = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  return [c[0] + (l - c[0]) * t, c[1] + (l - c[1]) * t, c[2] + (l - c[2]) * t];
}
export function rgbCss(c: RGB): string {
  return `rgb(${clamp8(c[0])},${clamp8(c[1])},${clamp8(c[2])})`;
}

/** Era base sky: [zenith, horizon] before season/weather/branch shifts. */
const ERA_SKY: Record<EraId, { zenith: RGB; horizon: RGB }> = {
  dawn:    { zenith: [78, 96, 120],  horizon: [150, 140, 120] }, // warm sepia frontier
  modern:  { zenith: [70, 104, 150], horizon: [150, 168, 178] }, // optimistic clear blue
  analog:  { zenith: [82, 100, 128], horizon: [170, 150, 120] }, // hazier, smog-warm
  digital: { zenith: [56, 80, 116],  horizon: [120, 138, 158] }, // cooler, denser haze
  future:  { zenith: [60, 92, 120],  horizon: [130, 160, 170] }, // neutral, branch decides
};

/** Branch overrides the future sky's whole character. */
const BRANCH_SKY: Record<NonNullable<Branch>, { zenith: RGB; horizon: RGB }> = {
  solarpunk: { zenith: [70, 130, 150], horizon: [150, 200, 170] }, // clean cyan-green
  dystopia:  { zenith: [86, 70, 58],   horizon: [180, 120, 70] },  // smog amber-brown
  drowned:   { zenith: [62, 78, 92],   horizon: [110, 128, 140] }, // heavy grey-blue
};

/** Season tint added to both ends (warm/cool/wash). */
const SEASON_SHIFT: RGB[] = [
  [6, 12, 4],    // spring — fresh green lift
  [16, 10, -6],  // summer — warm, brighter
  [22, 6, -16],  // autumn — golden amber
  [-6, -2, 10],  // winter — cold blue, paler handled via desat below
];
const SEASON_DESAT = [0.05, 0, 0.08, 0.28];

/** Weather drives toward overcast greys; snow lifts the lower sky bright. */
function weatherAdjust(c: RGB, sky: Sky, lower: boolean): RGB {
  switch (sky) {
    case 'overcast': return add(desaturate(c, 0.45), [10, 10, 12]);
    case 'rain':     return add(desaturate(c, 0.55), [-22, -18, -10]);
    case 'storm':    return add(desaturate(c, 0.4), [-44, -38, -30]);
    case 'snow':     return add(desaturate(c, 0.6), lower ? [60, 64, 72] : [24, 28, 34]);
    default:         return c;
  }
}

/** Tension reddens and dims the sky; crisis is an ember-lit horizon. */
function tensionAdjust(c: RGB, band: StatBand, lower: boolean): RGB {
  if (band === 'crisis') return add(c, lower ? [44, -10, -24] : [22, -8, -18]);
  if (band === 'tense')  return add(c, lower ? [18, -2, -10] : [8, -2, -8]);
  return c;
}

/** Tension band → base horizon bloom: a faint dusk warmth at calm, an amber
 *  unease when tense, a red ember at crisis. */
const GLOW_BY_BAND: Record<StatBand, { color: RGB; intensity: number }> = {
  calm:   { color: [255, 206, 150], intensity: 0.05 },
  tense:  { color: [242, 150, 72],  intensity: 0.30 },
  crisis: { color: [255, 92, 50],   intensity: 0.66 },
};

/** Each future branch repaints its own horizon light (matches BRANCH_SKY). */
const BRANCH_GLOW: Record<NonNullable<Branch>, RGB> = {
  solarpunk: [130, 235, 185], // clean cyan-green dawn
  dystopia:  [250, 150, 60],  // sodium smog
  drowned:   [120, 165, 205], // cold drowned light
};

/**
 * The horizon glow for the current state. Pure read of the same inputs as the
 * palette, so it carries no extra cache keys. Crisis always wins as a red ember
 * (it overrides any branch tint); otherwise a future sky keeps its branch's
 * signature light, and heavy weather smothers the bloom.
 */
export function buildHorizonGlow(inp: BackdropInputs): BackdropGlow {
  const band = statBand(inp.tension);
  const base = GLOW_BY_BAND[band];
  let color = base.color;
  let intensity = base.intensity;

  if (eraIdForYear(inp.year) === 'future' && inp.branch && band !== 'crisis') {
    color = BRANCH_GLOW[inp.branch];
    intensity = Math.max(intensity, band === 'calm' ? 0.14 : 0.32);
  }

  if (inp.sky === 'storm') intensity *= 0.35;
  else if (inp.sky === 'rain' || inp.sky === 'overcast') intensity *= 0.6;
  else if (inp.sky === 'snow') intensity *= 0.5;

  return { y: 0.74, color: color.map(clamp8) as RGB, intensity };
}

/**
 * Build the full 5-band palette for the current sim state. Pure: same inputs →
 * same bands and the same cache key.
 */
export function buildBackdropPalette(inp: BackdropInputs): BackdropPalette {
  const era = eraIdForYear(inp.year);
  const base = era === 'future' && inp.branch ? BRANCH_SKY[inp.branch] : ERA_SKY[era];
  const band = statBand(inp.tension);
  const seasonIdx = ((inp.seasonIndex % 4) + 4) % 4;
  const seasonShift = SEASON_SHIFT[seasonIdx];
  const seasonDesat = SEASON_DESAT[seasonIdx];

  const shape = (c: RGB, lower: boolean): RGB => {
    let out = add(c, seasonShift);
    out = desaturate(out, seasonDesat);
    out = weatherAdjust(out, inp.sky, lower);
    out = tensionAdjust(out, band, lower);
    return out as RGB;
  };
  const zenith = shape(base.zenith, false);
  const horizon = shape(base.horizon, true);

  // Five overlapping bands from zenith (distant, near-still) to ground fog
  // (close, nearly tracks the map). Aerial perspective: lower bands sit closer
  // to the horizon colour and drift more.
  const stops: Array<{ y0: number; y1: number; parallax: number; t0: number; t1: number }> = [
    { y0: 0.0,  y1: 0.36, parallax: 0.02, t0: 0.0,  t1: 0.28 },
    { y0: 0.22, y1: 0.58, parallax: 0.06, t0: 0.22, t1: 0.52 },
    { y0: 0.46, y1: 0.76, parallax: 0.15, t0: 0.5,  t1: 0.74 },
    { y0: 0.64, y1: 0.9,  parallax: 0.3,  t0: 0.72, t1: 0.92 },
    { y0: 0.8,  y1: 1.0,  parallax: 0.5,  t0: 0.9,  t1: 1.0 },
  ];
  const bands: BackdropBand[] = stops.map((s) => ({
    y0: s.y0,
    y1: s.y1,
    top: mix(zenith, horizon, s.t0).map(clamp8) as RGB,
    bottom: mix(zenith, horizon, s.t1).map(clamp8) as RGB,
    parallax: s.parallax,
  }));

  const key = [era, inp.branch ?? '-', seasonIdx, inp.sky, band].join('|');
  return { bands, glow: buildHorizonGlow(inp), key, slot: `backdrop-${era}` };
}

// ---- DOM compositor --------------------------------------------------------

/** Oversize the cached gradient by this margin on every side so a parallax
 *  offset never exposes a gap at the viewport edge. */
const MARGIN = 96;

/** Representative parallax for the horizon glow / override image — the lower
 *  sky drifts roughly with the near bands. */
const GLOW_PARALLAX = 0.4;

/** One painted strip per band. The strip canvas is the band's pixel height plus
 *  a MARGIN bleed on every side; the gradient's end colours extend into the
 *  bleed so a parallax offset never exposes a gap. */
interface BandStrip {
  canvas: HTMLCanvasElement;
  /** Top of the band in viewport pixels (before parallax), i.e. `y0 * H`. */
  top: number;
  parallax: number;
}

export class Backdrop {
  private strips: BandStrip[] = [];
  private sig = '';

  /** Re-paint the per-band strips only when the palette key or size changes. */
  private ensure(W: number, H: number, pal: BackdropPalette): void {
    const sig = `${W}x${H}|${pal.key}`;
    if (this.sig === sig && this.strips.length === pal.bands.length) return;
    const cw = W + MARGIN * 2;
    this.strips = pal.bands.map((b) => {
      const top = b.y0 * H;
      const span = (b.y1 - b.y0) * H;
      const canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = Math.max(1, Math.ceil(span + MARGIN * 2));
      const c = canvas.getContext('2d');
      if (c) {
        // Gradient runs across the band proper (MARGIN .. MARGIN+span); filling
        // the whole strip lets the clamped end colours flood the top/bottom
        // bleed, so vertical parallax slides into matching colour, not a void.
        const grad = c.createLinearGradient(0, MARGIN, 0, MARGIN + span);
        grad.addColorStop(0, rgbCss(b.top));
        grad.addColorStop(1, rgbCss(b.bottom));
        c.fillStyle = grad;
        c.fillRect(0, 0, cw, canvas.height);
      }
      return { canvas, top, parallax: b.parallax };
    });
    this.sig = sig;
  }

  /**
   * Draw the backdrop in screen space behind the map. `camX/camY` are the live
   * camera pan (RegionView.camX/Y); each band is offset by the fraction of that
   * pan it does *not* follow — so distant bands lag the terrain and near bands
   * track it, true per-layer parallax rather than one shared drift. Back-to-
   * front: distant bands first, nearer bands paint over their seams. The horizon
   * glow blooms additively on top, then an override image (if any).
   *
   * Must be called before the camera transform is applied (i.e. before the
   * terrain blit), in raw screen coordinates.
   */
  draw(
    g: CanvasRenderingContext2D,
    W: number,
    H: number,
    pal: BackdropPalette,
    camX: number,
    camY: number,
    registry?: AssetRegistry,
  ): void {
    this.ensure(W, H, pal);
    for (const s of this.strips) {
      const ox = clampMargin(-camX * (1 - s.parallax));
      const oy = clampMargin(-camY * (1 - s.parallax));
      g.drawImage(s.canvas, -MARGIN + ox, s.top - MARGIN + oy);
    }

    this.drawGlow(g, W, H, pal.glow, camX, camY);

    const img = registry?.get(pal.slot);
    if (img && img.width > 0) {
      // A painted sky overrides the procedural one; same gentle parallax.
      const ox = clampMargin(-camX * (1 - GLOW_PARALLAX));
      const oy = clampMargin(-camY * (1 - GLOW_PARALLAX));
      g.globalAlpha = 1;
      g.drawImage(img, ox * 0.6, oy * 0.6, W, H);
    }
  }

  /** Additive ember bloom centred on the horizon — the stat band made bright. */
  private drawGlow(
    g: CanvasRenderingContext2D,
    W: number,
    H: number,
    glow: BackdropGlow,
    camX: number,
    camY: number,
  ): void {
    if (glow.intensity <= 0.002) return;
    const ox = clampMargin(-camX * (1 - GLOW_PARALLAX));
    const oy = clampMargin(-camY * (1 - GLOW_PARALLAX));
    const cx = W / 2 + ox * 0.5;
    const cy = glow.y * H + oy;
    const radius = Math.max(W, H) * 0.72;
    const [r, gg, bb] = glow.color;
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0, `rgba(${clamp8(r)},${clamp8(gg)},${clamp8(bb)},${glow.intensity})`);
    grad.addColorStop(1, `rgba(${clamp8(r)},${clamp8(gg)},${clamp8(bb)},0)`);
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    g.restore();
  }
}

function clampMargin(n: number): number {
  return n < -MARGIN ? -MARGIN : n > MARGIN ? MARGIN : n;
}
