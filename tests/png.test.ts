import { describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import { decodePng, encodePng, floodFillAlpha, type Raster } from '../scripts/png';

/**
 * The local asset generator (scripts/gen-local.ts) has no `sharp`; it relies on
 * scripts/png.ts to decode what a local Stable Diffusion server returns, knock
 * out the background for town sprites, and re-encode. These tests pin the parts a
 * round-trip alone can't: the adaptive filter math (real SD PNGs mix filter types
 * 1–4, but encodePng only ever writes filter 0) and the flood-fill matting.
 */

function solid(width: number, height: number, rgba: [number, number, number, number]): Raster {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(rgba, i * 4);
  return { width, height, data };
}

// Hand-build a colour-type-2 (RGB) PNG with a chosen filter byte per row, so the
// decoder's Sub/Up/Average/Paeth reconstruction is actually exercised.
function rgbPngWithFilters(
  width: number,
  height: number,
  pixels: number[][], // height×(width*3) RGB rows, raw (unfiltered) values
  filters: number[],  // one filter type per row
): Buffer {
  const stride = width * 3;
  const raw: number[] = [];
  const prev = new Array(stride).fill(0);
  for (let y = 0; y < height; y++) {
    const row = pixels[y];
    const filtered = new Array(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= 3 ? row[x - 3] : 0;
      const b = prev[x];
      const c = x >= 3 ? prev[x - 3] : 0;
      const f = filters[y];
      let fv: number;
      if (f === 0) fv = row[x];
      else if (f === 1) fv = row[x] - a;
      else if (f === 2) fv = row[x] - b;
      else if (f === 3) fv = row[x] - ((a + b) >> 1);
      else { // Paeth
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        fv = row[x] - pred;
      }
      filtered[x] = fv & 0xff;
    }
    raw.push(filters[y], ...filtered);
    for (let x = 0; x < stride; x++) prev[x] = row[x];
  }
  const idat = deflateSync(Buffer.from(raw));
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const crc32 = (b: Buffer): number => {
    let c = ~0;
    for (const byte of b) { c ^= byte; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
    return (~c) >>> 0;
  };
  const chunk = (t: string, d: Buffer): Buffer => {
    const len = Buffer.alloc(4); len.writeUInt32BE(d.length, 0);
    const tb = Buffer.from(t, 'latin1');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([tb, d])), 0);
    return Buffer.concat([len, tb, d, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

describe('png codec', () => {
  it('round-trips an RGBA raster (encode → decode)', () => {
    const src = solid(5, 4, [200, 100, 50, 255]);
    src.data[0] = 1; src.data[1] = 2; src.data[2] = 3; src.data[3] = 128; // one distinct pixel
    const back = decodePng(encodePng(src));
    expect(back.width).toBe(5);
    expect(back.height).toBe(4);
    expect([...back.data]).toEqual([...src.data]);
  });

  it('reconstructs every adaptive filter type (Sub/Up/Average/Paeth) on decode', () => {
    const W = 3, H = 5;
    // Distinct, non-trivial RGB rows so a wrong predictor would diverge.
    const rows = [
      [10, 20, 30, 40, 50, 60, 70, 80, 90],
      [15, 25, 35, 45, 55, 65, 75, 85, 95],
      [200, 10, 250, 5, 240, 15, 230, 20, 220],
      [12, 240, 33, 9, 250, 44, 8, 230, 55],
      [128, 128, 128, 64, 192, 32, 255, 0, 127],
    ];
    const png = rgbPngWithFilters(W, H, rows, [1, 2, 3, 4, 0]); // Sub, Up, Avg, Paeth, None
    const r = decodePng(png);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const d = (y * W + x) * 4, s = x * 3;
        expect([r.data[d], r.data[d + 1], r.data[d + 2], r.data[d + 3]])
          .toEqual([rows[y][s], rows[y][s + 1], rows[y][s + 2], 255]); // RGB→opaque alpha
      }
    }
  });

  it('flood-fills a uniform border to transparency, leaving the subject opaque', () => {
    const r = solid(9, 9, [255, 255, 255, 255]); // white field
    // Opaque subject: a 3×3 black block in the centre, NOT touching any edge.
    for (let y = 3; y <= 5; y++) for (let x = 3; x <= 5; x++) {
      const d = (y * 9 + x) * 4; r.data[d] = 0; r.data[d + 1] = 0; r.data[d + 2] = 0;
    }
    const cut = floodFillAlpha(r, 100);
    const alpha = (x: number, y: number) => cut.data[(y * 9 + x) * 4 + 3];
    expect(alpha(0, 0)).toBe(0);   // corner background → transparent
    expect(alpha(0, 4)).toBe(0);   // edge background → transparent
    expect(alpha(4, 4)).toBe(255); // subject centre → opaque
    expect(alpha(3, 3)).toBe(255); // subject corner → opaque
  });
});
