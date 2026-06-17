/**
 * Sparklines — compact trend visualization for economy metrics.
 * Renders small SVG line charts for GDP, treasury, inflation, and employment.
 */

export interface SparklineData {
  label: string;
  value: number; // current value
  unit: string; // 'K', '%', etc.
  data: number[]; // history (12-month circular buffer)
  color: string; // accent color for the line
}

/**
 * Render a single sparkline SVG with trend line and current value label.
 */
export function sparkline(spec: SparklineData): string {
  const { label, value, unit, data, color } = spec;

  if (data.length === 0) {
    return `<div class="cv-sparkline"><span class="cv-sparkline-label">${label}</span><span class="cv-sparkline-value">—</span></div>`;
  }

  const w = 140;
  const h = 40;
  const pad = 2;
  const px = w - 2 * pad;
  const py = h - 2 * pad;

  // Find min/max for scaling
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1; // avoid division by zero

  // Build SVG path
  const points = data
    .map((v, i) => {
      const x = pad + (i / (data.length - 1)) * px;
      const y = pad + py - ((v - min) / range) * py;
      return `${x},${y}`;
    })
    .join(' ');

  const formatted = value >= 1000
    ? (value / 1000).toFixed(1) + 'K'
    : Math.round(value).toString();

  return (
    `<div class="cv-sparkline">` +
    `<span class="cv-sparkline-label">${label}</span>` +
    `<svg class="cv-sparkline-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">` +
    `<polyline points="${points}" stroke="${color}" stroke-width="1.5" fill="none" vector-effect="non-scaling-stroke"/>` +
    `</svg>` +
    `<span class="cv-sparkline-value">${formatted}${unit}</span>` +
    `</div>`
  );
}

/**
 * Render a grid of sparklines for economy overview.
 */
export function sparklineGrid(
  gdp: number,
  treasury: number,
  inflation: number,
  gdpHistory: number[],
  treasuryHistory: number[],
  inflationHistory: number[],
): string {
  return (
    `<div class="cv-sparklines-grid">` +
    sparkline({
      label: 'GDP',
      value: gdp,
      unit: '/mo',
      data: gdpHistory,
      color: '#4e9',
    }) +
    sparkline({
      label: 'Treasury',
      value: treasury,
      unit: '',
      data: treasuryHistory,
      color: '#ca4',
    }) +
    sparkline({
      label: 'Inflation',
      value: inflation,
      unit: '%',
      data: inflationHistory,
      color: '#e55',
    }) +
    `</div>`
  );
}
