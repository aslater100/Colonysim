import { describe, it, expect } from 'vitest';
import { graphPoints, centuryGraphHtml } from '../src/ui/centuryGraph';
import type { StatSnapshot } from '../src/sim/region';

/** Build a short synthetic annual history for render tests. */
function history(n: number): StatSnapshot[] {
  return Array.from({ length: n }, (_, i) => ({
    year: 1919 + i,
    gdp: 1000 + i * 100,
    pop: 500 + i * 10,
    warmingC: i * 0.02,
    treasury: 200 - i * 5, // trends negative → exercises negative normalization
    satisfaction: 50,
  }));
}

describe('graphPoints — pure SVG geometry', () => {
  it('an empty series renders nothing (no polyline)', () => {
    expect(graphPoints([], 100, 40, 2)).toBe('');
  });

  it('a single point never divides by zero (no NaN)', () => {
    const pts = graphPoints([42], 100, 40, 2);
    expect(pts).not.toContain('NaN');
    expect(pts.split(' ')).toHaveLength(1);
  });

  it('a flat series renders a level line without NaN (zero range guarded)', () => {
    const pts = graphPoints([7, 7, 7, 7], 100, 40, 2);
    expect(pts).not.toContain('NaN');
    const ys = pts.split(' ').map((p) => Number(p.split(',')[1]));
    expect(new Set(ys).size).toBe(1); // all the same height
  });

  it('emits one coordinate per value, inside the padded box', () => {
    const pts = graphPoints([1, 2, 3, 4, 5], 100, 40, 2).split(' ');
    expect(pts).toHaveLength(5);
    for (const p of pts) {
      const [x, y] = p.split(',').map(Number);
      expect(x).toBeGreaterThanOrEqual(2);
      expect(x).toBeLessThanOrEqual(98);
      expect(y).toBeGreaterThanOrEqual(2);
      expect(y).toBeLessThanOrEqual(38);
    }
  });

  it('a rising series climbs on screen (higher value → smaller y)', () => {
    const pts = graphPoints([0, 1, 2, 3], 100, 40, 2).split(' ');
    const firstY = Number(pts[0].split(',')[1]);
    const lastY = Number(pts[pts.length - 1].split(',')[1]);
    expect(lastY).toBeLessThan(firstY);
  });

  it('spans the full width first→last', () => {
    const pts = graphPoints([5, 6, 7], 100, 40, 2).split(' ');
    expect(Number(pts[0].split(',')[0])).toBeCloseTo(2, 5);
    expect(Number(pts[pts.length - 1].split(',')[0])).toBeCloseTo(98, 5);
  });
});

describe('centuryGraphHtml — render block', () => {
  it('empty history omits the panel entirely', () => {
    expect(centuryGraphHtml([])).toBe('');
  });

  it('renders all four metric cells with a year span and no NaN/undefined', () => {
    const html = centuryGraphHtml(history(60));
    for (const label of ['GDP', 'Population', 'Warming', 'Treasury']) {
      expect(html).toContain(label);
    }
    expect(html).toContain('1919–1978'); // first–last year span
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('undefined');
    expect((html.match(/<polyline/g) || []).length).toBe(4);
  });

  it('survives a single-year history (degenerate) without error', () => {
    const html = centuryGraphHtml(history(1));
    expect(html).toContain('1919–1919');
    expect(html).not.toContain('NaN');
  });

  it('formats large GDP compactly and warming with a sign', () => {
    const big: StatSnapshot[] = [
      { year: 2100, gdp: 2.6e9, pop: 75000, warmingC: 3.1, treasury: -4.4e6, satisfaction: 30 },
    ];
    const html = centuryGraphHtml(big);
    expect(html).toContain('£2.6B');
    expect(html).toContain('75.0K');
    expect(html).toContain('+3.1°C');
    expect(html).toContain('-£4.4M');
  });
});
