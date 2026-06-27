/**
 * Minimal dependency-free PNG codec — just enough for the local asset generator
 * (`scripts/gen-local.ts`) to post-process the bytes a local Stable Diffusion
 * server returns. No `sharp`/native deps, so it runs anywhere Node + zlib do.
 *
 * Scope (deliberately narrow — throws loudly otherwise): 8-bit, non-interlaced,
 * colour type 2 (RGB) or 6 (RGBA). That is exactly what AUTOMATIC1111 / ComfyUID
 * emit for txt2img. Everything is normalised to RGBA in memory.
 */
import { deflateSync, inflateSync } from 'node:zlib';

export interface Raster {
  width: number;
  height: number;
  /** RGBA, 4 bytes/pixel, row-major top-to-bottom. */
  data: Uint8Array;
}

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// ---- CRC32 (PNG polynomial), table-free for simplicity ----------------------
function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const tb = Buffer.from(type, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([tb, data])), 0);
  return Buffer.concat([len, tb, data, crc]);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Decode an 8-bit RGB/RGBA PNG to an RGBA raster. Throws on unsupported forms. */
export function decodePng(buf: Buffer): Raster {
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG (bad signature)');
  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len; // length(4) + type(4) + data + crc(4)
  }
  if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth} (need 8)`);
  if (interlace !== 0) throw new Error('interlaced PNG not supported');
  if (colorType !== 2 && colorType !== 6) {
    throw new Error(`unsupported PNG colour type ${colorType} (need 2=RGB or 6=RGBA)`);
  }
  const srcCh = colorType === 6 ? 4 : 3;
  const stride = width * srcCh;
  const raw = inflateSync(Buffer.concat(idat));
  const out = new Uint8Array(width * height * 4);
  const line = new Uint8Array(stride); // current unfiltered scanline
  const prev = new Uint8Array(stride); // previous unfiltered scanline
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    for (let x = 0; x < stride; x++) {
      const cur = raw[rp++];
      const a = x >= srcCh ? line[x - srcCh] : 0; // left
      const b = prev[x];                          // up
      const c = x >= srcCh ? prev[x - srcCh] : 0; // up-left
      let v: number;
      switch (filter) {
        case 0: v = cur; break;
        case 1: v = cur + a; break;
        case 2: v = cur + b; break;
        case 3: v = cur + ((a + b) >> 1); break;
        case 4: v = cur + paeth(a, b, c); break;
        default: throw new Error(`bad PNG filter ${filter}`);
      }
      line[x] = v & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const s = x * srcCh, d = (y * width + x) * 4;
      out[d] = line[s];
      out[d + 1] = line[s + 1];
      out[d + 2] = line[s + 2];
      out[d + 3] = srcCh === 4 ? line[s + 3] : 255;
    }
    prev.set(line);
  }
  return { width, height, data: out };
}

/** Encode an RGBA raster to a colour-type-6 PNG (filter 0 per row). */
export function encodePng(r: Raster): Buffer {
  const { width, height, data } = r;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0; // filter: None
    data.subarray(y * stride, y * stride + stride).forEach((b) => { raw[p++] = b; });
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type RGBA
  return Buffer.concat([
    SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Knock out a near-uniform background to transparency by flood-filling inward
 * from the four corners. Best-effort matting for sprites generated on a flat
 * backdrop — for hair-fine edges, prefer a real matting model (e.g. `rembg`) via
 * gen-local's `--bg-tool`. `tolerance` is the squared-distance cutoff in RGB
 * (0..~195075); ~1600 ≈ 40/channel.
 */
export function floodFillAlpha(r: Raster, tolerance = 1600): Raster {
  const { width, height, data } = r;
  const n = width * height;
  const bg = new Uint8Array(n); // 1 = background → alpha 0
  const stack: number[] = [];
  const seed = (i: number) => {
    if (i >= 0 && i < n && !bg[i]) { stack.push(i); }
  };
  // Seed from every edge pixel; the corner colours define "background".
  const corners = [0, width - 1, (height - 1) * width, height * width - 1];
  const ref = corners.map((i) => [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]);
  const near = (i: number): boolean => {
    const r0 = data[i * 4], g0 = data[i * 4 + 1], b0 = data[i * 4 + 2];
    for (const [r1, g1, b1] of ref) {
      const dr = r0 - r1, dg = g0 - g1, db = b0 - b1;
      if (dr * dr + dg * dg + db * db <= tolerance) return true;
    }
    return false;
  };
  for (let x = 0; x < width; x++) { seed(x); seed((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { seed(y * width); seed(y * width + width - 1); }
  while (stack.length) {
    const i = stack.pop()!;
    if (bg[i] || !near(i)) continue;
    bg[i] = 1;
    const x = i % width, y = (i / width) | 0;
    if (x > 0) seed(i - 1);
    if (x < width - 1) seed(i + 1);
    if (y > 0) seed(i - width);
    if (y < height - 1) seed(i + width);
  }
  const out = new Uint8Array(data); // copy
  for (let i = 0; i < n; i++) if (bg[i]) out[i * 4 + 3] = 0;
  return { width, height, data: out };
}
