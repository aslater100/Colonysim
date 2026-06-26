import { describe, it, expect } from 'vitest';
import {
  eraIdForYear,
  statBand,
  buildBackdropPalette,
  rgbCss,
  type BackdropInputs,
} from '../src/ui/backdrop';

const base: BackdropInputs = {
  year: 1925,
  seasonIndex: 0,
  branch: null,
  sky: 'clear',
  tension: 0,
};

describe('eraIdForYear', () => {
  it('maps each year window to its era at the band edges', () => {
    expect(eraIdForYear(1900)).toBe('dawn');
    expect(eraIdForYear(1944)).toBe('dawn');
    expect(eraIdForYear(1945)).toBe('modern');
    expect(eraIdForYear(1969)).toBe('modern');
    expect(eraIdForYear(1970)).toBe('analog');
    expect(eraIdForYear(1999)).toBe('analog');
    expect(eraIdForYear(2000)).toBe('digital');
    expect(eraIdForYear(2039)).toBe('digital');
    expect(eraIdForYear(2040)).toBe('future');
    expect(eraIdForYear(2100)).toBe('future');
  });
});

describe('statBand', () => {
  it('gates tension into calm / tense / crisis', () => {
    expect(statBand(0)).toBe('calm');
    expect(statBand(0.39)).toBe('calm');
    expect(statBand(0.4)).toBe('tense');
    expect(statBand(0.69)).toBe('tense');
    expect(statBand(0.7)).toBe('crisis');
    expect(statBand(1)).toBe('crisis');
  });
});

describe('buildBackdropPalette', () => {
  it('always produces five depth-ordered bands within the viewport', () => {
    const pal = buildBackdropPalette(base);
    expect(pal.bands).toHaveLength(5);
    for (const b of pal.bands) {
      expect(b.y0).toBeGreaterThanOrEqual(0);
      expect(b.y1).toBeLessThanOrEqual(1);
      expect(b.y1).toBeGreaterThan(b.y0);
      for (const ch of [...b.top, ...b.bottom]) {
        expect(ch).toBeGreaterThanOrEqual(0);
        expect(ch).toBeLessThanOrEqual(255);
      }
    }
    // Distant (sky) bands drift less than near (ground) bands → strictly rising.
    const px = pal.bands.map((b) => b.parallax);
    for (let i = 1; i < px.length; i++) expect(px[i]).toBeGreaterThan(px[i - 1]);
  });

  it('is a pure function — identical inputs give an identical key', () => {
    expect(buildBackdropPalette(base).key).toBe(buildBackdropPalette({ ...base }).key);
  });

  it('targets a per-era override slot', () => {
    expect(buildBackdropPalette({ ...base, year: 1910 }).slot).toBe('backdrop-dawn');
    expect(buildBackdropPalette({ ...base, year: 2080 }).slot).toBe('backdrop-future');
  });

  it('changes the cache key when any keyed input changes', () => {
    const k = buildBackdropPalette(base).key;
    expect(buildBackdropPalette({ ...base, year: 2080 }).key).not.toBe(k);
    expect(buildBackdropPalette({ ...base, seasonIndex: 3 }).key).not.toBe(k);
    expect(buildBackdropPalette({ ...base, sky: 'storm' }).key).not.toBe(k);
    expect(buildBackdropPalette({ ...base, tension: 0.9 }).key).not.toBe(k);
  });

  it('lets the era-branch repaint the future sky', () => {
    const future = { ...base, year: 2080 };
    const sun = buildBackdropPalette({ ...future, branch: 'solarpunk' });
    const smog = buildBackdropPalette({ ...future, branch: 'dystopia' });
    expect(sun.key).not.toBe(smog.key);
    expect(sun.bands[0].top).not.toEqual(smog.bands[0].top);
  });

  it('darkens the sky under a storm versus clear skies', () => {
    const clear = buildBackdropPalette({ ...base, sky: 'clear' });
    const storm = buildBackdropPalette({ ...base, sky: 'storm' });
    const luma = (c: number[]) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
    expect(luma(storm.bands[0].top)).toBeLessThan(luma(clear.bands[0].top));
  });

  it('reddens the horizon as a crisis takes hold', () => {
    const calm = buildBackdropPalette({ ...base, tension: 0 });
    const crisis = buildBackdropPalette({ ...base, tension: 0.95 });
    const ground = (p: ReturnType<typeof buildBackdropPalette>) => p.bands[4].bottom;
    expect(ground(crisis)[0]).toBeGreaterThan(ground(calm)[0]); // more red
  });
});

describe('rgbCss', () => {
  it('rounds and clamps channels into a CSS rgb() string', () => {
    expect(rgbCss([10.4, 20.6, 30])).toBe('rgb(10,21,30)');
    expect(rgbCss([-5, 300, 128])).toBe('rgb(0,255,128)');
  });
});
