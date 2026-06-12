/**
 * Colony Sim Sprite Generator v2
 * Professional procedural pixel art — RimWorld-inspired.
 *
 * Techniques:
 * - True pixel-grid rendering (integer coords, no anti-aliasing)
 * - 3–4 step color ramps (shadow / base / light) with top-left light source
 * - Automatic 1px dark outlines around entity silhouettes
 * - Transparent backgrounds for entities; opaque tiles for terrain
 * - Seeded RNG for deterministic variation
 * - Soft ground shadows under creatures & plants
 */

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Px {
  constructor(w, h, bg = null) {
    this.w = w; this.h = h;
    this.canvas = document.createElement('canvas');
    this.canvas.width = w; this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    if (bg) { this.ctx.fillStyle = bg; this.ctx.fillRect(0, 0, w, h); }
  }
  p(x, y, c) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.ctx.fillStyle = c;
    this.ctx.fillRect(x, y, 1, 1);
  }
  rect(x, y, w, h, c) {
    this.ctx.fillStyle = c;
    this.ctx.fillRect(x | 0, y | 0, w | 0, h | 0);
  }
  hline(x1, x2, y, c) { this.rect(Math.min(x1, x2), y, Math.abs(x2 - x1) + 1, 1, c); }
  vline(x, y1, y2, c) { this.rect(x, Math.min(y1, y2), 1, Math.abs(y2 - y1) + 1, c); }
  line(x1, y1, x2, y2, c, thick = 1) {
    x1 |= 0; y1 |= 0; x2 |= 0; y2 |= 0;
    let dx = Math.abs(x2 - x1), dy = Math.abs(y2 - y1);
    const sx = x1 < x2 ? 1 : -1, sy = y1 < y2 ? 1 : -1;
    let err = dx - dy;
    while (true) {
      if (thick > 1) this.rect(x1, y1, thick, thick, c);
      else this.p(x1, y1, c);
      if (x1 === x2 && y1 === y2) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x1 += sx; }
      if (e2 < dx) { err += dx; y1 += sy; }
    }
  }
  blob(cx, cy, rx, ry, c) {
    for (let y = Math.floor(cy - ry); y <= cy + ry; y++)
      for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
        const dx = (x - cx) / rx, dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1.05) this.p(x, y, c);
      }
  }
  disc(cx, cy, r, c) { this.blob(cx, cy, r, r, c); }
  // Shaded ellipse: light from top-left, shadow bottom-right crescent
  shadedBlob(cx, cy, rx, ry, ramp) {
    for (let y = Math.floor(cy - ry); y <= cy + ry; y++)
      for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
        const dx = (x - cx) / rx, dy = (y - cy) / ry;
        const d = dx * dx + dy * dy;
        if (d > 1.05) continue;
        const lx = (x - cx + rx * 0.45) / rx, ly = (y - cy + ry * 0.45) / ry;
        const ld = lx * lx + ly * ly;
        let c = ramp[1];
        if (ld < 0.34) c = ramp[2];
        else if (d > 0.55 && dx + dy > 0.2) c = ramp[0];
        this.p(x, y, c);
      }
  }
  shadow(cx, cy, rx, ry) { this.blob(cx, cy, rx, ry, 'rgba(10,8,4,0.28)'); }
  dither(x, y, w, h, c, density, rng) {
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++)
        if (rng() < density) this.p(xx, yy, c);
  }
  // 1px outline drawn just outside any opaque pixels
  outline(color) {
    const img = this.ctx.getImageData(0, 0, this.w, this.h);
    const d = img.data, w = this.w, h = this.h;
    const solid = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) solid[i] = d[i * 4 + 3] > 100 ? 1 : 0;
    this.ctx.fillStyle = color;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (solid[i]) continue;
        if ((x > 0 && solid[i - 1]) || (x < w - 1 && solid[i + 1]) ||
            (y > 0 && solid[i - w]) || (y < h - 1 && solid[i + w]))
          this.ctx.fillRect(x, y, 1, 1);
      }
  }
}

class SpriteGenerator {
  constructor() {
    // [shadow, base, light, (brightest)]
    this.ramps = {
      outline: '#181410',
      grass:  ['#3a4a2c', '#4e6135', '#62753c', '#79894a'],
      soil:   ['#3c2e20', '#52402b', '#675138', '#7a6346'],
      sand:   ['#8a7547', '#a8925c', '#bfa96e', '#d4c084'],
      water:  ['#1f3347', '#2b4760', '#3c5f7c', '#5d8aa3', '#9cc3d4'],
      stone:  ['#403c34', '#585349', '#6f6a5e', '#878173'],
      bark:   ['#352718', '#4d3a24', '#654e30', '#7b6240'],
      leaf:   ['#22351c', '#33492a', '#455e34', '#587341'],
      leafY:  ['#4d4220', '#6e5e2a', '#8a7836', '#a39144'],
      pine:   ['#1b2e22', '#28402f', '#37533c', '#48664a'],
      grain:  ['#79602e', '#9c7e3b', '#bb9c4a', '#d6b964'],
      sprout: ['#2e4423', '#41592e', '#557039', '#6b8746'],
      roof:   ['#5c3325', '#7a4632', '#94583e'],
      roofG:  ['#33402a', '#465738', '#586c45'],
      wood:   ['#4d3a24', '#6b5138', '#84653f', '#9c7a4e'],
      // creatures
      cowB:   ['#3a2a1b', '#553e27', '#6f5334'],
      cowW:   ['#9a917c', '#c2b89f', '#ded4b8'],
      pig:    ['#8e5547', '#b3725f', '#cf8f77'],
      wool:   ['#948b76', '#bbb198', '#d8cfb3'],
      hide:   ['#2e2a26', '#403a34', '#534c44'],
      deer:   ['#5f4a2e', '#80633d', '#9d7d4e'],
      wolf:   ['#3b3b3f', '#56565c', '#74737a', '#94939b'],
      boar:   ['#2c2117', '#3f3022', '#54402d'],
      fox:    ['#6e3a1d', '#94512a', '#b56838'],
      cream:  ['#9c8e72', '#c4b491', '#e0d2ac'],
      skins: [
        ['#8a5a36', '#a9744a', '#c08a5c'],
        ['#9c6b42', '#c08a5c', '#d4a374'],
        ['#6e4a30', '#8a6240', '#a47a50'],
        ['#b08054', '#d4a574', '#e8c294'],
      ],
      hairs: [
        ['#1c150e', '#332617'],
        ['#3e2c19', '#5c452a'],
        ['#56504a', '#7b746c'],
        ['#5e2716', '#86412a'],
      ],
      tunics: [
        ['#4a3a28', '#665139'],
        ['#33414f', '#475a6c'],
        ['#4f342e', '#6b4a42'],
        ['#3d4530', '#545f42'],
      ],
      pants: [
        ['#2e2a22', '#43three'], // fixed below
      ],
    };
    // pants ramps (shadow, base)
    this.ramps.pants = [
      ['#2e2a22', '#433d31'],
      ['#27313b', '#39444f'],
      ['#332622', '#473833'],
      ['#2c3326', '#404936'],
    ];
  }

  /* ============ TERRAIN (opaque 32x32) ============ */

  grassTile(variant = 0) {
    const R = this.ramps.grass;
    const px = new Px(32, 32, R[1]);
    const rng = mulberry32(1000 + variant);
    px.dither(0, 0, 32, 32, R[0], 0.16, rng);
    px.dither(0, 0, 32, 32, R[2], 0.14, rng);
    px.dither(0, 0, 32, 32, R[3], 0.05, rng);
    // grass tufts: little 'v' blades
    for (let i = 0; i < 7; i++) {
      const x = (rng() * 30) | 0, y = 4 + ((rng() * 26) | 0);
      px.p(x, y, R[3]); px.p(x, y - 1, R[2]);
      px.p(x + 2, y, R[2]); px.p(x + 2, y - 1, R[3]);
      px.p(x + 1, y + 1, R[0]);
    }
    // occasional flowers
    if (variant % 3 === 2) {
      for (let i = 0; i < 3; i++) {
        const x = 3 + ((rng() * 26) | 0), y = 3 + ((rng() * 26) | 0);
        px.p(x, y, '#d8c878'); px.p(x + 1, y, '#b8a058');
      }
    }
    return px.canvas;
  }

  soilTile(variant = 0) {
    const R = this.ramps.soil;
    const px = new Px(32, 32, R[1]);
    const rng = mulberry32(2000 + variant);
    px.dither(0, 0, 32, 32, R[0], 0.12, rng);
    px.dither(0, 0, 32, 32, R[2], 0.12, rng);
    // tilled furrows: dark groove + light ridge below = depth
    for (let y = 4; y < 32; y += 7) {
      px.hline(0, 31, y, R[0]);
      px.hline(0, 31, y + 1, R[3]);
    }
    // scattered pebbles
    for (let i = 0; i < 4; i++) {
      const x = (rng() * 29) | 0, y = (rng() * 29) | 0;
      px.p(x, y, this.ramps.stone[2]); px.p(x + 1, y, this.ramps.stone[0]);
    }
    if (variant % 2 === 1) {
      // moist patch
      px.dither(6, 8, 18, 14, R[0], 0.3, rng);
    }
    return px.canvas;
  }

  sandTile(variant = 0) {
    const R = this.ramps.sand;
    const px = new Px(32, 32, R[1]);
    const rng = mulberry32(2500 + variant);
    px.dither(0, 0, 32, 32, R[0], 0.10, rng);
    px.dither(0, 0, 32, 32, R[2], 0.16, rng);
    px.dither(0, 0, 32, 32, R[3], 0.05, rng);
    // wind ripples
    for (let i = 0; i < 3; i++) {
      const y = 5 + i * 9 + ((variant * 3) % 5);
      for (let x = 0; x < 32; x++) {
        const yy = y + Math.round(Math.sin((x / 32) * Math.PI * 2 + i) * 1.5);
        px.p(x, yy, R[0]);
        if (x % 2 === 0) px.p(x, yy - 1, R[3]);
      }
    }
    return px.canvas;
  }

  waterTile(variant = 0) {
    const R = this.ramps.water;
    const px = new Px(32, 32, R[1]);
    const rng = mulberry32(3000 + (variant % 4));
    const phase = (variant % 4) * (Math.PI / 2);
    px.dither(0, 0, 32, 32, R[0], 0.15, rng);
    px.dither(0, 0, 32, 32, R[2], 0.10, rng);
    // two sine wave crests
    for (let band = 0; band < 2; band++) {
      const baseY = 9 + band * 14;
      for (let x = 0; x < 32; x++) {
        const y = baseY + Math.round(Math.sin((x / 32) * Math.PI * 4 + phase + band * 1.7) * 2);
        px.p(x, y, R[3]);
        if ((x + band) % 3 === 0) px.p(x, y - 1, R[4]);
      }
    }
    // sparkles
    for (let i = 0; i < 3; i++) {
      const x = (rng() * 30) | 0, y = (rng() * 30) | 0;
      px.p(x, y, R[4]);
    }
    return px.canvas;
  }

  stoneTile(variant = 0) {
    const R = this.ramps.stone;
    const px = new Px(32, 32, R[0]);
    const rng = mulberry32(4000 + variant);
    // flagstone slabs with 1px dark gaps and lit top edges
    const slabs = [
      [[0, 0, 15, 11], [17, 0, 15, 15], [0, 13, 10, 12], [12, 17, 14, 10], [0, 27, 26, 5], [28, 17, 4, 15]],
      [[0, 0, 10, 16], [12, 0, 20, 9], [12, 11, 9, 14], [23, 11, 9, 10], [0, 18, 10, 14], [12, 27, 20, 5]],
      [[0, 0, 20, 8], [22, 0, 10, 12], [0, 10, 13, 11], [15, 10, 17, 11], [0, 23, 18, 9], [20, 23, 12, 9]],
    ][variant % 3];
    for (const [x, y, w, h] of slabs) {
      px.rect(x, y, w, h, R[1]);
      px.hline(x, x + w - 1, y, R[3]);          // lit top
      px.vline(x, y, y + h - 1, R[2]);          // lit left
      px.hline(x, x + w - 1, y + h - 1, R[0]);  // dark bottom
      px.dither(x + 1, y + 1, w - 2, h - 2, R[2], 0.08, rng);
      px.dither(x + 1, y + 1, w - 2, h - 2, R[0], 0.08, rng);
    }
    return px.canvas;
  }

  /* ============ PLANTS (transparent) ============ */

  grainPlant(stage = 1) {
    const px = new Px(32, 32);
    const G = this.ramps.grain, S = this.ramps.sprout;
    px.shadow(16, 29, 9, 2);
    const stalks = [[8, 0], [13, 1], [18, 0], [23, 1], [11, 2], [21, 2]];
    for (const [x, jig] of stalks) {
      if (stage === 1) {
        // young green shoots
        px.vline(x, 24 - jig, 28, S[1]);
        px.p(x, 23 - jig, S[3]);
        px.p(x - 1, 25 - jig, S[2]);
      } else if (stage === 2) {
        px.vline(x, 16 - jig, 28, S[1]);
        px.p(x - 1, 19 - jig, S[2]); px.p(x + 1, 22 - jig, S[2]);
        // pale immature head
        px.rect(x - 1, 13 - jig, 3, 4, S[3]);
        px.p(x, 12 - jig, S[2]);
      } else {
        // mature golden wheat, heads nodding
        const bend = jig - 1;
        px.vline(x, 14 - jig, 28, G[1]);
        px.p(x + bend, 13 - jig, G[1]);
        // grain head: chevron kernels
        for (let k = 0; k < 4; k++) {
          px.p(x + bend - 1, 11 - jig - k * 2, G[2]);
          px.p(x + bend + 1, 11 - jig - k * 2, G[2]);
          px.p(x + bend, 10 - jig - k * 2, G[3]);
        }
        px.p(x + bend, 3 - jig, G[3]); // awn tip
        px.p(x - 1, 20 - jig, G[0]);
      }
    }
    px.outline(this.ramps.outline);
    return px.canvas;
  }

  tree(stage = 1, variant = 0) {
    if (variant % 2 === 1) return this.pine(stage);
    const px = new Px(48, 48);
    const B = this.ramps.bark, L = (variant % 4 === 2) ? this.ramps.leafY : this.ramps.leaf;
    const rng = mulberry32(5000 + stage * 7 + variant);
    px.shadow(24, 45, 7 + stage * 3, 2);

    const layouts = {
      1: { trunk: [23, 36, 2, 9], discs: [[24, 30, 6]] },
      2: { trunk: [22, 30, 4, 15], discs: [[24, 21, 9], [17, 26, 6], [31, 26, 6]] },
      3: { trunk: [21, 28, 6, 18], discs: [[24, 15, 10], [14, 21, 7], [34, 21, 7], [24, 25, 9]] },
    };
    const lay = layouts[stage] || layouts[3];

    // trunk with bark texture + root flare
    const [tx, ty, tw, th] = lay.trunk;
    px.rect(tx, ty, tw, th, B[1]);
    px.vline(tx, ty, ty + th - 1, B[2]);
    px.vline(tx + tw - 1, ty, ty + th - 1, B[0]);
    if (tw >= 4) {
      px.vline(tx + ((tw / 2) | 0), ty + 3, ty + th - 2, B[0]);
      px.p(tx - 1, ty + th - 1, B[1]); px.p(tx - 1, ty + th - 2, B[1]);
      px.p(tx + tw, ty + th - 1, B[0]); px.p(tx + tw, ty + th - 2, B[0]);
    }
    // canopy: shadow silhouette offset down-right, then base, then highlights
    for (const [cx, cy, r] of lay.discs) px.disc(cx + 1, cy + 2, r, L[0]);
    for (const [cx, cy, r] of lay.discs) px.disc(cx, cy, r, L[1]);
    for (const [cx, cy, r] of lay.discs) px.disc(cx - r * 0.3, cy - r * 0.35, r * 0.45, L[2]);
    // leaf cluster noise
    const top = lay.discs[0];
    for (let i = 0; i < 14 + stage * 6; i++) {
      const a = rng() * Math.PI * 2, rr = rng() * top[2] * 1.4;
      const x = (top[0] + Math.cos(a) * rr) | 0, y = (top[1] + Math.sin(a) * rr * 0.9) | 0;
      px.p(x, y, rng() < 0.5 ? L[3] : L[0]);
    }
    px.outline(this.ramps.outline);
    return px.canvas;
  }

  pine(stage = 3) {
    const px = new Px(48, 48);
    const P = this.ramps.pine, B = this.ramps.bark;
    px.shadow(24, 45, 5 + stage * 2, 2);
    const tiers = { 1: 1, 2: 2, 3: 3 }[stage] || 3;
    const baseY = 42, tierH = 10, maxW = 9 + tiers * 2;
    px.rect(23, baseY - 4, 2 + (stage > 1 ? 1 : 0), 6, B[1]);
    let topY = baseY - 4 - tiers * tierH + 2;
    for (let t = tiers - 1; t >= 0; t--) {
      const tierTop = topY + t * tierH;
      const halfW = Math.round(maxW * ((t + 1.4) / (tiers + 1)));
      for (let row = 0; row <= tierH; row++) {
        const w = Math.max(1, Math.round((row / tierH) * halfW));
        const y = tierTop + row;
        px.hline(24 - w, 24 + w, y, P[1]);
        px.hline(24 + Math.max(0, w - 2), 24 + w, y, P[0]); // right shade
        if (row % 3 === 0) px.p(24 - w + 1, y, P[3]);       // left lit edge
        else px.p(24 - w, y, P[2]);
      }
    }
    px.p(24, topY - 1, P[2]);
    px.outline(this.ramps.outline);
    return px.canvas;
  }

  shrub(variant = 0) {
    const px = new Px(32, 32);
    const L = this.ramps.leaf;
    const rng = mulberry32(6000 + variant);
    px.shadow(16, 27, 8, 2);
    const discs = [[16, 20, 6], [11, 23, 4], [21, 23, 4]];
    for (const [cx, cy, r] of discs) px.disc(cx + 1, cy + 1, r, L[0]);
    for (const [cx, cy, r] of discs) px.disc(cx, cy, r, L[1]);
    px.disc(14, 18, 3, L[2]);
    for (let i = 0; i < 8; i++) px.p(8 + ((rng() * 16) | 0), 16 + ((rng() * 9) | 0), rng() < 0.5 ? L[3] : L[0]);
    if (variant % 2 === 1) {
      // berries
      px.p(13, 21, '#a8392b'); px.p(19, 19, '#a8392b'); px.p(16, 24, '#c14a36'); px.p(21, 24, '#a8392b');
    }
    px.outline(this.ramps.outline);
    return px.canvas;
  }

  /* ============ ANIMALS (transparent 48x32) ============ */

  livestock(type = 'cow', variant = 0, frame = 0) {
    const px = new Px(48, 32);
    const O = this.ramps.outline;
    const legUp = frame % 2;       // alternating leg lift
    const bob = frame === 2 ? 1 : 0; // head bob frame

    if (type === 'chicken') {
      px.shadow(24, 28, 6, 1.5);
      px.shadedBlob(24, 21, 5, 4, this.ramps.cream);
      // tail feathers
      px.p(18, 17, this.ramps.cream[0]); px.p(17, 16, this.ramps.cream[1]); px.p(18, 18, this.ramps.cream[0]);
      // neck + head (pecks down on frame 2)
      const hy = 14 + bob * 3, hx = 29 + bob;
      px.rect(27, hy + 2, 2, 6 - bob * 2, this.ramps.cream[1]);
      px.disc(hx, hy, 2.5, this.ramps.cream[2]);
      px.p(hx + 1, hy - 3, '#b03a2a'); px.p(hx, hy - 3, '#b03a2a'); // comb
      px.p(hx + 3, hy, '#c98a30'); px.p(hx + 4, hy, '#c98a30');     // beak
      px.p(hx + 1, hy - 1, O);                                       // eye
      // legs
      px.vline(22, 25, 28 - legUp, '#c98a30');
      px.vline(26, 25, 28 - (1 - legUp), '#c98a30');
      px.outline(O);
      return px.canvas;
    }

    px.shadow(24, 29, 14, 2);
    let ramp, headRamp;
    if (type === 'pig') { ramp = this.ramps.pig; headRamp = ramp; }
    else if (type === 'sheep') { ramp = this.ramps.wool; headRamp = this.ramps.hide; }
    else { ramp = (variant % 2 === 0) ? this.ramps.cowW : this.ramps.cowB; headRamp = ramp; }

    // legs (behind body) — alternating 1px lift for idle/walk life
    const legRamp = type === 'sheep' ? this.ramps.hide : ramp;
    const legXs = type === 'pig' ? [17, 22, 27, 32] : [16, 21, 28, 33];
    legXs.forEach((lx, i) => {
      const lift = (i % 2 === legUp) ? 1 : 0;
      px.rect(lx, 20, 2, 8 - lift, legRamp[1]);
      px.rect(lx, 26 - lift, 2, 2, this.ramps.outline === O ? '#241c12' : '#241c12'); // hooves
    });

    // body
    if (type === 'sheep') {
      // bumpy wool: overlapping discs
      px.disc(25, 16, 8, ramp[0]);
      const bumps = [[19, 13, 4], [25, 11, 5], [31, 13, 4], [17, 17, 4], [33, 17, 4], [25, 18, 6], [21, 15, 5], [29, 16, 5]];
      for (const [bx, by, br] of bumps) px.disc(bx, by, br, ramp[1]);
      px.disc(22, 12, 3, ramp[2]); px.disc(27, 11, 2.5, ramp[2]);
    } else if (type === 'pig') {
      px.shadedBlob(25, 17, 10, 6, ramp);
      // curly tail
      px.p(35, 13, ramp[1]); px.p(36, 12, ramp[2]); px.p(37, 13, ramp[1]); px.p(36, 14, ramp[0]);
    } else {
      px.shadedBlob(25, 15, 12, 7, ramp);
      // patches
      const patch = (variant % 2 === 0) ? this.ramps.cowB : this.ramps.cowW;
      const rng = mulberry32(7000 + variant);
      for (let i = 0; i < 3; i++) {
        px.blob(18 + ((rng() * 14) | 0), 12 + ((rng() * 6) | 0), 2 + rng() * 2, 2 + rng() * 1.5, patch[1]);
      }
      // udder
      px.blob(29, 21, 3, 2, '#c98a77');
      // tail
      px.line(37, 11, 40, 19, ramp[0]);
      px.p(40, 20, '#241c12'); px.p(41, 20, '#241c12');
    }

    // head
    const hy = 11 + bob;
    if (type === 'sheep') {
      px.shadedBlob(11, hy + 2, 4, 3.5, headRamp);
      px.disc(13, hy - 1, 3, ramp[1]); // wool cap
      px.p(8, hy + 1, '#0c0a08');      // eye
      px.p(7, hy + 4, headRamp[0]);    // nose
      px.p(14, hy + 3, headRamp[0]);   // ear
    } else if (type === 'pig') {
      px.shadedBlob(13, hy + 4, 4.5, 4, ramp);
      px.rect(8, hy + 4, 3, 3, ramp[2]);   // snout
      px.p(9, hy + 5, '#5e352c'); px.p(10, hy + 5, '#5e352c'); // nostrils
      px.p(12, hy + 1, ramp[0]); px.p(13, hy, ramp[1]);        // ear
      px.p(11, hy + 3, '#0c0a08');
    } else {
      px.shadedBlob(10, hy + 1, 4.5, 4, headRamp);
      px.rect(5, hy + 2, 4, 3, headRamp[2]);  // muzzle
      px.p(6, hy + 3, '#241c12'); px.p(8, hy + 3, '#241c12'); // nostrils
      px.p(10, hy - 1, '#0c0a08');            // eye
      // horns
      px.p(8, hy - 4, '#d8cdb2'); px.p(7, hy - 5, '#d8cdb2');
      px.p(13, hy - 4, '#d8cdb2'); px.p(14, hy - 5, '#d8cdb2');
      // ear
      px.rect(13, hy - 2, 3, 2, headRamp[0]);
    }
    px.outline(O);
    return px.canvas;
  }

  wildAnimal(type = 'deer', variant = 0, frame = 0) {
    const px = new Px(48, 32);
    const O = this.ramps.outline;
    const legUp = frame % 2;
    const bob = frame === 2 ? 1 : 0;
    px.shadow(26, 29, 13, 2);

    if (type === 'wolf') {
      const R = this.ramps.wolf;
      [[17, 1], [22, 0], [29, 1], [34, 0]].forEach(([lx, grp], i) => {
        const lift = (i % 2 === legUp) ? 1 : 0;
        px.rect(lx, 19, 2, 9 - lift, R[grp]);
      });
      px.shadedBlob(26, 15, 11, 5.5, [R[0], R[1], R[2]]);
      px.blob(18, 17, 5, 4.5, R[1]);                  // chest
      px.hline(20, 32, 19, R[3]);                      // light belly
      px.blob(39, 13 - bob, 5, 2.5, R[1]);             // bushy tail
      px.disc(41, 12 - bob, 2, R[0]);
      // head
      const hy = 10 + bob;
      px.shadedBlob(13, hy, 4, 3.5, [R[0], R[1], R[2]]);
      px.rect(7, hy, 4, 2, R[2]);                      // snout
      px.p(7, hy, '#16120e');                          // nose
      px.p(12, hy - 4, R[0]); px.p(12, hy - 5, R[1]);  // ears
      px.p(15, hy - 4, R[0]); px.p(15, hy - 5, R[1]);
      px.p(12, hy - 1, '#c9a23a');                     // amber eye
    } else if (type === 'boar') {
      const R = this.ramps.boar;
      [[16], [21], [28], [33]].forEach(([lx], i) => {
        const lift = (i % 2 === legUp) ? 1 : 0;
        px.rect(lx, 21, 2, 7 - lift, R[1]);
      });
      px.shadedBlob(25, 17, 11, 6, R);
      // bristle ridge
      for (let x = 16; x <= 33; x += 2) px.p(x, 10 + ((x / 2) % 2), R[0]);
      // head merged into shoulders
      px.shadedBlob(12, 17 + bob, 5.5, 4.5, R);
      px.rect(5, 18 + bob, 3, 3, this.ramps.deer[1]);  // snout
      px.p(5, 19 + bob, '#1a1410');
      px.p(7, 21 + bob, '#e8e0cc'); px.p(6, 22 + bob, '#e8e0cc'); // tusk
      px.p(10, 15 + bob, '#0c0a08');
      px.p(11, 12 + bob, R[0]);                        // ear
      px.line(36, 13, 38, 18, R[0]);                   // tail
    } else if (type === 'fox') {
      const R = this.ramps.fox;
      [[19], [23], [28], [31]].forEach(([lx], i) => {
        const lift = (i % 2 === legUp) ? 1 : 0;
        px.rect(lx, 21, 1, 7 - lift, '#2c2017');
      });
      px.shadedBlob(25, 18, 8, 4, R);
      // big bushy tail with white tip
      px.blob(36, 17, 6, 3, R[1]);
      px.blob(34, 16, 4, 2, R[2]);
      px.disc(41, 18, 2, '#e0d6c0');
      // head
      const hy = 13 + bob;
      px.shadedBlob(15, hy, 3.5, 3, R);
      px.rect(10, hy + 1, 3, 2, R[2]);                 // snout
      px.p(10, hy + 1, '#16120e');
      px.p(13, hy - 4, '#2c2017'); px.p(13, hy - 3, R[1]); // ears
      px.p(17, hy - 4, '#2c2017'); px.p(17, hy - 3, R[1]);
      px.p(14, hy, '#0c0a08');
      px.rect(13, hy + 3, 4, 2, '#e0d6c0');            // white chest
    } else {
      // deer
      const R = this.ramps.deer;
      [[20], [25], [31], [35]].forEach(([lx], i) => {
        const lift = (i % 2 === legUp) ? 1 : 0;
        px.rect(lx, 19, 1, 9 - lift, R[1]);
        px.p(lx, 27 - lift, R[0]);
      });
      px.shadedBlob(28, 15, 10, 5, R);
      px.p(38, 13, '#e8e0cc'); px.p(38, 14, '#e8e0cc'); // white tail
      // neck rising to head
      px.line(20, 13, 16, 7 + bob, R[1], 2);
      px.shadedBlob(14, 6 + bob, 3, 2.5, R);
      px.p(10, 6 + bob, '#16120e');                    // nose
      px.p(13, 5 + bob, '#0c0a08');                    // eye
      px.p(17, 3 + bob, R[0]); px.p(18, 4 + bob, R[1]); // ear
      // antlers (bucks only — even variants)
      if (variant % 2 === 0) {
        const B = this.ramps.bark;
        px.line(13, 3 + bob, 10, -1 + bob, B[2]);
        px.p(9, 0 + bob, B[2]); px.p(11, 0 + bob, B[2]);
        px.line(16, 3 + bob, 19, -1 + bob, B[2]);
        px.p(20, 0 + bob, B[2]); px.p(18, 0 + bob, B[2]);
      }
      // lighter belly
      px.hline(22, 34, 19, R[2]);
    }
    px.outline(O);
    return px.canvas;
  }

  /* ============ SETTLERS (transparent 32x48) ============ */

  settler(gender = 'male', skinTone = 0, hairStyle = 0, opts = {}) {
    const { pose = 'idle', frame = 0 } = opts;
    const outfit = (opts.outfit !== undefined) ? opts.outfit : (skinTone + hairStyle) % 4;
    const px = new Px(32, 48);
    const O = this.ramps.outline;
    const skin = this.ramps.skins[skinTone & 3];
    const hair = this.ramps.hairs[hairStyle & 3];
    const tunic = this.ramps.tunics[outfit & 3];
    const pants = this.ramps.pants[outfit & 3];
    const boots = '#241c12';

    let bob = 0;
    if (pose === 'idle') bob = frame % 2;
    if (pose === 'walk') bob = (frame % 2 === 1) ? 1 : 0;
    if (pose === 'farm' || pose === 'mine') bob = (frame % 3 === 2) ? 1 : 0;

    px.shadow(16, 45, 8, 2);

    // ---- legs ----
    const legTop = 28 + bob;
    let lLift = 0, rLift = 0;
    if (pose === 'walk') {
      const offs = [0, 3, 0, 3][frame % 4];
      if (frame % 4 === 1) lLift = offs;
      if (frame % 4 === 3) rLift = offs;
    }
    // left leg
    px.rect(12, legTop, 3, 43 - lLift - legTop, pants[1]);
    px.vline(14, legTop, 42 - lLift, pants[0]);
    px.rect(11, 41 - lLift, 4, 3, boots);
    // right leg
    px.rect(17, legTop, 3, 43 - rLift - legTop, pants[1]);
    px.vline(19, legTop, 42 - rLift, pants[0]);
    px.rect(17, 41 - rLift, 4, 3, boots);

    // ---- torso ----
    const ty = 14 + bob;
    px.rect(11, ty, 10, 14, tunic[1]);
    px.vline(11, ty, ty + 13, tunic[1]);
    px.vline(12, ty + 1, ty + 12, tunic[1]);
    px.vline(19, ty + 1, ty + 13, tunic[0]);
    px.vline(20, ty, ty + 13, tunic[0]);
    px.hline(11, 20, ty + 12, '#1f1a12');     // belt
    px.p(15, ty + 12, '#9c7a3a'); px.p(16, ty + 12, '#9c7a3a'); // buckle
    px.p(15, ty, skin[1]); px.p(16, ty, skin[1]); // collar / neck

    // ---- arms ----
    const shY = ty + 2;
    if (pose === 'farm' || pose === 'mine') {
      // left arm rests
      px.rect(9, shY, 2, 8, tunic[0]);
      px.rect(9, shY + 8, 2, 2, skin[1]);
      // right arm swings tool
      const total = pose === 'farm' ? 6 : 4;
      const t = frame / Math.max(1, total - 1);
      const a0 = -2.1, a1 = 0.9; // radians: raised back -> swung down
      const ang = a0 + (a1 - a0) * (pose === 'farm' ? t * t : t); // ease-in chop
      const sx = 21, sy = shY + 1;
      const hx = Math.round(sx + Math.cos(ang) * 7);
      const hy = Math.round(sy + Math.sin(ang) * 7);
      px.line(sx, sy, hx, hy, tunic[0], 2);
      px.rect(hx, hy, 2, 2, skin[1]);
      // tool shaft
      const tx2 = Math.round(hx + Math.cos(ang) * 9);
      const ty2 = Math.round(hy + Math.sin(ang) * 9);
      px.line(hx + 1, hy + 1, tx2, ty2, this.ramps.bark[2]);
      if (pose === 'farm') {
        // hoe blade: perpendicular nub
        px.rect(tx2 - 1, ty2, 3, 2, '#6f6a5e');
        px.p(tx2, ty2 + 2, '#878173');
      } else {
        // pickaxe head: crossbar
        const pa = ang + Math.PI / 2;
        px.line(Math.round(tx2 - Math.cos(pa) * 3), Math.round(ty2 - Math.sin(pa) * 3),
                Math.round(tx2 + Math.cos(pa) * 3), Math.round(ty2 + Math.sin(pa) * 3), '#878173');
      }
    } else {
      const swing = pose === 'walk' ? [0, 1, 0, -1][frame % 4] : 0;
      px.rect(9, shY + Math.max(0, swing), 2, 8, tunic[0]);
      px.rect(9, shY + 8 + Math.max(0, swing), 2, 2, skin[1]);
      px.rect(21, shY + Math.max(0, -swing), 2, 8, tunic[0]);
      px.rect(21, shY + 8 + Math.max(0, -swing), 2, 2, skin[1]);
    }

    // ---- head ----
    const hy0 = 5 + bob;
    px.rect(12, hy0, 8, 8, skin[1]);
    px.ctx.clearRect(12, hy0, 1, 1); px.ctx.clearRect(19, hy0, 1, 1);
    px.ctx.clearRect(12, hy0 + 7, 1, 1); px.ctx.clearRect(19, hy0 + 7, 1, 1);
    px.vline(19, hy0 + 1, hy0 + 6, skin[0]);          // right cheek shade
    px.vline(13, hy0 + 2, hy0 + 5, skin[2]);          // left highlight
    px.p(14, hy0 + 4, '#1a130c'); px.p(17, hy0 + 4, '#1a130c'); // eyes
    px.p(15, hy0 + 6, skin[0]); px.p(16, hy0 + 6, skin[0]);     // mouth shade

    // hair
    const style = (gender === 'female' && hairStyle === 0) ? 1 : hairStyle & 3;
    if (style === 0) {
      px.rect(12, hy0 - 1, 8, 3, hair[1]);
      px.hline(13, 18, hy0 - 2, hair[1]);
      px.p(12, hy0 + 2, hair[0]); px.p(19, hy0 + 2, hair[0]);
    } else if (style === 1) {
      px.rect(12, hy0 - 1, 8, 3, hair[1]);
      px.hline(13, 18, hy0 - 2, hair[1]);
      px.vline(11, hy0, hy0 + 9, hair[1]);
      px.vline(20, hy0, hy0 + 9, hair[0]);
      px.p(11, hy0 + 10, hair[0]); px.p(20, hy0 + 10, hair[0]);
    } else if (style === 2) {
      // balding + beard
      px.hline(12, 19, hy0 - 1, hair[0]);
      px.rect(12, hy0 + 6, 8, 3, hair[1]);
      px.rect(14, hy0 + 6, 4, 1, skin[1]); // keep mouth area
      px.p(15, hy0 + 6, skin[0]); px.p(16, hy0 + 6, skin[0]);
    } else {
      px.rect(12, hy0 - 1, 8, 3, hair[1]);
      px.hline(13, 18, hy0 - 2, hair[1]);
      px.disc(16, hy0 - 3, 2, hair[1]);    // bun
      px.p(15, hy0 - 4, hair[0]);
    }

    px.outline(O);
    return px.canvas;
  }

  /* ============ STRUCTURES ============ */

  house(roofColor) {
    const px = new Px(48, 48);
    const W = this.ramps.wood, S = this.ramps.stone, O = this.ramps.outline;
    const R = (roofColor === '#4a5a3a' || roofColor === 'green') ? this.ramps.roofG : this.ramps.roof;
    px.shadow(24, 45, 19, 2);

    // walls: planked timber
    px.rect(8, 22, 32, 19, W[1]);
    for (let y = 25; y < 41; y += 4) px.hline(8, 39, y, W[0]);
    px.vline(8, 22, 40, W[2]);
    px.vline(39, 22, 40, W[0]);
    // foundation
    px.rect(7, 40, 34, 3, S[1]);
    px.hline(7, 40, 40, S[2]);
    px.p(12, 41, S[0]); px.p(22, 42, S[0]); px.p(33, 41, S[0]);

    // roof: shingle courses
    for (let row = 0; row < 16; row++) {
      const y = 7 + row;
      const half = Math.round((row / 15) * 20) + 2;
      px.hline(24 - half, 24 + half, y, row % 3 === 0 ? R[0] : R[1]);
      if (row % 3 === 1) {
        for (let x = 24 - half + 2; x < 24 + half; x += 4) px.p(x, y, R[2]);
      }
    }
    // eaves
    px.hline(2, 46, 22, R[0]);
    px.hline(2, 46, 23, '#241a12');

    // chimney
    px.rect(31, 6, 5, 9, S[1]);
    px.vline(31, 6, 14, S[2]);
    px.hline(31, 35, 6, S[3]);
    px.p(32, 3, 'rgba(180,175,165,0.6)'); px.p(34, 1, 'rgba(180,175,165,0.4)');

    // door
    px.rect(21, 30, 7, 11, '#3a2b18');
    px.vline(22, 31, 40, W[0]);
    px.vline(24, 31, 40, W[0]);
    px.vline(26, 31, 40, W[0]);
    px.hline(21, 27, 30, W[2]);
    px.p(26, 35, '#b89548'); // handle

    // windows with warm glow
    for (const wx of [11, 31]) {
      px.rect(wx, 26, 6, 6, '#2a1f14');
      px.rect(wx + 1, 27, 4, 4, '#caa84e');
      px.p(wx + 1, 27, '#e8d27a');
      px.p(wx + 3, 27, '#a8852e'); px.p(wx + 1, 29, '#a8852e');
      px.vline(wx + 2, 27, 30, '#2a1f14');
      px.hline(wx + 1, wx + 4, 28, '#2a1f14');
    }

    px.outline(O);
    return px.canvas;
  }

  /* ============ ITEMS (transparent 24x24) ============ */

  resource(type = 'grain', variant = 0) {
    const px = new Px(24, 24);
    const O = this.ramps.outline;
    px.shadow(12, 21, 7, 1.5);

    if (type === 'grain') {
      // tied wheat sheaf
      const G = this.ramps.grain;
      for (let i = -3; i <= 3; i++) {
        px.line(12 + i, 6 + Math.abs(i), 12 + i * 1.4, 19, i < 0 ? G[1] : G[2]);
      }
      px.rect(9, 13, 7, 2, this.ramps.bark[1]); // twine
      px.hline(9, 15, 13, this.ramps.bark[2]);
      for (let i = -2; i <= 2; i++) px.p(12 + i * 2, 4 + Math.abs(i), G[3]); // awns
    } else if (type === 'wood') {
      const B = this.ramps.bark;
      // two logs + one stacked, end-rings visible
      px.rect(4, 14, 16, 5, B[1]); px.hline(4, 19, 14, B[3]); px.hline(4, 19, 18, B[0]);
      px.disc(21, 16, 2.5, B[2]); px.p(21, 16, B[0]);
      px.rect(6, 8, 14, 5, B[1]); px.hline(6, 19, 8, B[3]); px.hline(6, 19, 12, B[0]);
      px.disc(5, 10, 2.5, B[2]); px.p(5, 10, B[0]);
    } else if (type === 'stone') {
      const S = this.ramps.stone;
      px.shadedBlob(9, 15, 5, 4, S);
      px.shadedBlob(16, 16, 4, 3, S);
      px.shadedBlob(13, 10, 4, 3.5, S);
      px.p(12, 8, S[3]); px.p(8, 13, S[3]);
    } else if (type === 'tool') {
      // hatchet
      const B = this.ramps.bark;
      px.line(7, 19, 16, 8, B[2], 2);
      px.rect(14, 5, 5, 6, '#6f6a5e');
      px.vline(18, 5, 10, '#878173');
      px.p(19, 6, '#9b968a'); px.p(19, 8, '#9b968a');
    } else if (type === 'food') {
      // bread loaf
      px.shadedBlob(12, 14, 7, 4.5, ['#7d5a30', '#a87f43', '#c89c58']);
      px.hline(8, 11, 11, '#7d5a30');
      px.hline(12, 15, 12, '#7d5a30');
      px.p(9, 10, '#e0c280'); px.p(13, 11, '#e0c280');
    } else if (type === 'weapon') {
      // sword
      px.line(8, 19, 16, 7, '#9b968a', 2);
      px.line(9, 18, 16, 8, '#c9c4b8');
      px.p(17, 6, '#e8e4da');
      px.line(6, 15, 11, 20, '#9c7a3a', 2); // guard
      px.line(5, 21, 7, 19, this.ramps.bark[1], 2); // grip
      px.p(4, 22, '#b89548'); // pommel
    }
    px.outline(O);
    return px.canvas;
  }

  /* ============ WEATHER (transparent overlays) ============ */

  rainEffect(intensity = 1, variant = 0) {
    const px = new Px(32, 32);
    const rng = mulberry32(8000 + variant);
    const n = Math.round(8 * intensity);
    for (let i = 0; i < n; i++) {
      const x = (rng() * 32) | 0, y = (rng() * 28) | 0;
      const a = 0.25 + rng() * 0.35;
      px.line(x, y, x - 1, y + 4, `rgba(160,190,220,${a.toFixed(2)})`);
    }
    // splash pips at bottom
    for (let i = 0; i < 3; i++) {
      const x = (rng() * 30) | 0;
      px.p(x, 30, 'rgba(180,205,230,0.4)'); px.p(x + 2, 30, 'rgba(180,205,230,0.3)');
    }
    return px.canvas;
  }

  snowEffect(intensity = 1, variant = 0) {
    const px = new Px(32, 32);
    const rng = mulberry32(8500 + variant);
    const n = Math.round(7 * intensity);
    for (let i = 0; i < n; i++) {
      const x = (rng() * 31) | 0, y = (rng() * 31) | 0;
      const a = 0.5 + rng() * 0.4;
      px.p(x, y, `rgba(240,244,250,${a.toFixed(2)})`);
      if (rng() < 0.4) { // larger flake: tiny cross
        px.p(x - 1, y, 'rgba(240,244,250,0.35)');
        px.p(x + 1, y, 'rgba(240,244,250,0.35)');
        px.p(x, y - 1, 'rgba(240,244,250,0.35)');
      }
    }
    return px.canvas;
  }

  dustEffect(intensity = 1, variant = 0) {
    const px = new Px(32, 32);
    const rng = mulberry32(9000 + variant);
    for (let i = 0; i < 4 * intensity; i++) {
      const x = rng() * 32, y = 10 + rng() * 20, r = 2 + rng() * 3;
      px.blob(x, y, r, r * 0.6, `rgba(190,170,135,${(0.10 + rng() * 0.12).toFixed(2)})`);
    }
    for (let i = 0; i < 5 * intensity; i++) {
      px.p((rng() * 32) | 0, (rng() * 32) | 0, 'rgba(205,185,150,0.35)');
    }
    return px.canvas;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SpriteGenerator;
}
