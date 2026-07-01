/**
 * Century Graph (GDD §8.4) — the long-horizon trend panel for the Century Report.
 *
 * Render-only: it draws the ALREADY-recorded annual `statsHistory` ring buffer
 * (one snapshot/year, 1919→2100) as four independent mini line-charts, so the
 * century of economic simulation the player just lived through finally becomes
 * legible at a glance. Touches no sim state and reads nothing that isn't already
 * serialized — byte-identical to the simulation.
 */
import type { StatSnapshot } from '../sim/region';

/**
 * Pure geometry: map a value series onto an SVG polyline `points` string within
 * a `w`×`h` box inset by `pad`. Each series is normalized to its own min/max
 * (so the chart shows trend SHAPE, not absolute scale), and higher values sit
 * higher on screen (smaller y). Robust to the degenerate cases the report can
 * hand it: an empty series renders nothing; a flat or single-point series draws
 * a level mid-line rather than dividing by zero.
 */
export function graphPoints(values: number[], w: number, h: number, pad: number): string {
  if (values.length === 0) return '';
  const px = w - 2 * pad;
  const py = h - 2 * pad;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1; // flat series → level line, never /0
  const span = Math.max(1, values.length - 1); // single point → level line, never /0
  return values
    .map((v, i) => {
      const x = pad + (i / span) * px;
      const y = pad + py - ((v - min) / range) * py;
      return `${round2(x)},${round2(y)}`;
    })
    .join(' ');
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Compact human number: 1.2K / 3.4M / 5.6B, with an optional currency prefix. */
function compact(n: number, prefix = ''): string {
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a >= 1e9) return `${sign}${prefix}${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${sign}${prefix}${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${sign}${prefix}${(a / 1e3).toFixed(1)}K`;
  return `${sign}${prefix}${Math.round(a)}`;
}

interface Series {
  label: string;
  color: string;
  values: number[];
  /** Format the final (latest) value for the readout. */
  fmt: (v: number) => string;
}

/** Render one labelled mini line-chart cell. */
function cell(s: Series): string {
  const w = 150;
  const h = 44;
  const pad = 3;
  const pts = graphPoints(s.values, w, h, pad);
  const last = s.values.length > 0 ? s.values[s.values.length - 1] : 0;
  return (
    `<div class="cv-century-cell">` +
    `<span class="cv-century-label">${s.label}</span>` +
    `<svg class="cv-century-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">` +
    `<polyline points="${pts}" stroke="${s.color}" stroke-width="1.5" fill="none" vector-effect="non-scaling-stroke"/>` +
    `</svg>` +
    `<span class="cv-century-value" style="color:${s.color}">${s.fmt(last)}</span>` +
    `</div>`
  );
}

/**
 * Build the Century Graph HTML block from the annual snapshot history. Returns
 * an empty string when there is no history (nothing to plot → the report simply
 * omits the panel), so the caller can concatenate it unconditionally.
 */
export function centuryGraphHtml(history: StatSnapshot[]): string {
  if (!history || history.length === 0) return '';
  const first = history[0].year;
  const last = history[history.length - 1].year;
  const series: Series[] = [
    { label: 'GDP', color: '#44ee99', values: history.map((s) => s.gdp), fmt: (v) => compact(v, '£') },
    { label: 'Population', color: '#5aa9d8', values: history.map((s) => s.pop), fmt: (v) => compact(v) },
    { label: 'Warming', color: '#ee5555', values: history.map((s) => s.warmingC), fmt: (v) => `+${v.toFixed(1)}°C` },
    { label: 'Treasury', color: '#ccaa44', values: history.map((s) => s.treasury), fmt: (v) => compact(v, '£') },
  ];
  return (
    `<div class="cv-century-graph">` +
    `<div class="cv-century-span">THE LONG VIEW · ${first}–${last}</div>` +
    `<div class="cv-century-grid">` +
    series.map(cell).join('') +
    `</div>` +
    `</div>`
  );
}
