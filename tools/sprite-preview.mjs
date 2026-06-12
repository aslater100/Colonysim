// Renders the game's procedural sprites to a PNG contact sheet without a browser.
// The sprite code only uses fillRect/fillStyle/globalAlpha, so a tiny software
// canvas shim is enough. Run: npx tsx tools/sprite-preview.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, readFileSync } from 'node:fs';

function parseColor(s) {
  if (s.startsWith('#')) {
    const hex = s.slice(1);
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), 255];
  }
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const p = m[1].split(',').map(Number);
    return [p[0], p[1], p[2], p.length > 3 ? Math.round(p[3] * 255) : 255];
  }
  return [255, 0, 255, 255];
}

class Ctx {
  constructor(canvas) {
    this.canvas = canvas;
    this.fillStyle = '#000';
    this.globalAlpha = 1;
  }
  fillRect(x, y, w, h) {
    const [r, g, b, a0] = parseColor(String(this.fillStyle));
    const a = (a0 / 255) * this.globalAlpha;
    const buf = this.canvas.px;
    const W = this.canvas.width, H = this.canvas.height;
    const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(W, Math.round(x + w)), y1 = Math.min(H, Math.round(y + h));
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        const i = (yy * W + xx) * 4;
        const da = buf[i + 3] / 255;
        const oa = a + da * (1 - a);
        if (oa <= 0) continue;
        buf[i] = Math.round((r * a + buf[i] * da * (1 - a)) / oa);
        buf[i + 1] = Math.round((g * a + buf[i + 1] * da * (1 - a)) / oa);
        buf[i + 2] = Math.round((b * a + buf[i + 2] * da * (1 - a)) / oa);
        buf[i + 3] = Math.round(oa * 255);
      }
    }
  }
  drawImage(img, dx, dy) {
    const buf = this.canvas.px, W = this.canvas.width, H = this.canvas.height;
    for (let yy = 0; yy < img.height; yy++) {
      for (let xx = 0; xx < img.width; xx++) {
        const si = (yy * img.width + xx) * 4;
        const sa = (img.px[si + 3] / 255) * this.globalAlpha;
        if (sa <= 0) continue;
        const tx = Math.round(dx) + xx, ty = Math.round(dy) + yy;
        if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
        const di = (ty * W + tx) * 4;
        const da = buf[di + 3] / 255;
        const oa = sa + da * (1 - sa);
        for (let k = 0; k < 3; k++) {
          buf[di + k] = Math.round((img.px[si + k] * sa + buf[di + k] * da * (1 - sa)) / oa);
        }
        buf[di + 3] = Math.round(oa * 255);
      }
    }
  }
}

class Canvas {
  constructor() { this._w = 0; this._h = 0; this.px = new Uint8Array(0); }
  get width() { return this._w; }
  set width(v) { this._w = v; this.px = new Uint8Array(this._w * this._h * 4); }
  get height() { return this._h; }
  set height(v) { this._h = v; this.px = new Uint8Array(this._w * this._h * 4); }
  getContext() { this.ctx ??= new Ctx(this); return this.ctx; }
}

globalThis.document = { createElement: () => new Canvas() };

const { buildSprites, TILE } = await import('../src/ui/sprites.ts');
const defs = JSON.parse(readFileSync(new URL('../src/data/buildings.json', import.meta.url), 'utf8')).buildings;
const sprites = buildSprites(defs);

function png(canvas) {
  const { width: W, height: H, px } = canvas;
  const raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 4 + 1)] = 0;
    Buffer.from(px.buffer, y * W * 4, W * 4).copy(raw, y * (W * 4 + 1) + 1);
  }
  const chunks = [Buffer.from('\x89PNG\r\n\x1a\n', 'binary')];
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crcTable = chunk.t ??= (() => {
      const t = new Int32Array(256);
      for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
      return t;
    })();
    let crc = -1;
    for (const b of body) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
    const crcBuf = Buffer.alloc(4); crcBuf.writeInt32BE(~crc);
    chunks.push(len, body, crcBuf);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  chunk('IHDR', ihdr);
  chunk('IDAT', deflateSync(raw));
  chunk('IEND', Buffer.alloc(0));
  return Buffer.concat(chunks);
}

// Contact sheet: all buildings in rows, then items, scaled 3x
const cell = 70;
const cols = 8;
const ids = defs.map((d) => d.id);
const rows = Math.ceil(ids.length / cols) + 2;
const sheet = new Canvas();
sheet.width = cols * cell;
sheet.height = rows * cell;
const g = sheet.getContext();
g.fillStyle = '#566445';
g.fillRect(0, 0, sheet.width, sheet.height);
ids.forEach((id, i) => {
  g.drawImage(sprites.buildings[id], (i % cols) * cell + 4, Math.floor(i / cols) * cell + 4);
});
const itemKeys = Object.keys(sprites.items);
itemKeys.forEach((k, i) => {
  g.drawImage(sprites.items[k], (i % 24) * 20 + 4, (rows - 2) * cell + Math.floor(i / 24) * 20 + 4);
});

// 3x upscale
const big = new Canvas();
big.width = sheet.width * 3;
big.height = sheet.height * 3;
const bg = big.getContext();
for (let y = 0; y < sheet.height; y++) {
  for (let x = 0; x < sheet.width; x++) {
    const i = (y * sheet.width + x) * 4;
    bg.fillStyle = `rgba(${sheet.px[i]},${sheet.px[i + 1]},${sheet.px[i + 2]},${sheet.px[i + 3] / 255})`;
    bg.fillRect(x * 3, y * 3, 3, 3);
  }
}
writeFileSync('/tmp/sprite-sheet.png', png(big));
console.log('wrote /tmp/sprite-sheet.png', ids.length, 'buildings,', itemKeys.length, 'items');
console.log('order:', ids.join(' '));
