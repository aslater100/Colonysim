/**
 * Pixel sprites, RimWorld-leaning (per art direction note): soft blended
 * terrain (no glyph-y per-tile flecks), drop shadows under everything that
 * stands, full rounded tree canopies that overlap into woods, capsule-ish
 * pawns, and readable top-down buildings. Still strictly pixel art — drawn
 * once into offscreen canvases at load.
 */
export const TILE = 16;

type Px = string | null;

function sheet(pixels: Px[][]): HTMLCanvasElement {
  const h = pixels.length;
  const w = pixels[0].length;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const col = pixels[y][x];
      if (!col) continue;
      g.fillStyle = col;
      g.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

function grid(rows: string[], pal: Record<string, string>): Px[][] {
  return rows.map((r) => [...r].map((ch) => (ch === '.' ? null : pal[ch] ?? null)));
}

// Muted, naturalistic palette (RimWorld reads earthy, not saturated)
const P = {
  outline: '#26201a',
  shadow: 'rgba(20,16,10,0.35)',
  grassA: '#566445',
  grassB: '#5d6b4a',
  grassC: '#515f42',
  blade: '#6b7a52',
  dirtPatch: '#6b5a40',
  soil: '#6b5138',
  soilDark: '#5a4129',
  crop: '#7e8c4a',
  cropRipe: '#c2a14d',
  water1: '#3d586b',
  water2: '#446076',
  waterGlint: '#5d7d94',
  rock: '#787469',
  rockDark: '#5e5a50',
  rockLight: '#8c887c',
  treeLeafLight: '#55703f',
  treeLeaf: '#466034',
  treeLeafDark: '#364d28',
  trunk: '#4d3a26',
  skin: '#c9a07a',
  skinB: '#a87f5c',
  hairA: '#3a2c1c',
  hairB: '#6b4a2a',
  hairC: '#8c8478',
  cloth1: '#7a6248',
  cloth2: '#5d6b6e',
  cloth3: '#735a66',
  clothRaider: '#8c3a2c',
  wood: '#9c7544',
  woodDark: '#7a5a32',
  grain: '#c2a14d',
  meal: '#a86e3c',
  stone: '#8c887c',
  wall: '#7a6248',
  wallDark: '#5d4936',
  roofWood: '#4a3a2c',
  roofLight: '#5d4a38',
  floor: '#8c7454',
  plank: '#8c6c44',
  plankDark: '#6e5434',
  gravelA: '#8a857a',
  gravelB: '#76716a',
  rutBrown: '#6e5a40',
  rutDark: '#5a4830',
  // building-specific extras
  wallLight: '#a08068',    // lighter warm wall (cabin, hall)
  wallLightDk: '#7a6050',
  wallCream: '#c4c0b0',    // clinic / clean stone
  wallCreamDk: '#a0a098',
  wallBrick: '#a07060',    // bakery stone
  wallBrickDk: '#806050',
  roofRed: '#5a3a28',      // cabin shingles
  roofRedLt: '#7a5040',
  roofSlate: '#4a5060',    // tailor
  roofSlateLt: '#6a7080',
  roofForest: '#3e4c2c',   // forester
  roofForestLt: '#5e6c4c',
  roofThatch: '#7a5820',   // granary
  roofThatchLt: '#9a7830',
  roofTerra: '#7c4a3c',    // market terracotta
  roofTerraLt: '#9c6a58',
  winGold: '#d8c460',      // residential window glow
  winOrange: '#e8a030',    // kitchen/bakery warmth
  winBlue: '#a0c8e8',      // clinic blue
  winGreen: '#a8c888',     // forester green
  winAmber: '#c8a840',     // lodge amber
  awningRed: '#b84040',    // market stripe
  awningCream: '#e8e0c0',
};

export interface SpriteSet {
  grass: HTMLCanvasElement[];
  dirtPatch: HTMLCanvasElement;
  tree: HTMLCanvasElement;
  treeMarked: HTMLCanvasElement;
  water: HTMLCanvasElement[];
  rock: HTMLCanvasElement;
  rockMarked: HTMLCanvasElement;
  soil: HTMLCanvasElement;
  soilSown: HTMLCanvasElement;
  soilGrown: HTMLCanvasElement;
  soilRipe: HTMLCanvasElement;
  roads: Record<string, HTMLCanvasElement>;
  roadPlans: Record<string, HTMLCanvasElement>;
  stockpileZone: HTMLCanvasElement;
  trapZone: HTMLCanvasElement;
  wallPlan: HTMLCanvasElement;
  palisade: HTMLCanvasElement;
  palisadeVariants: HTMLCanvasElement[]; // 16 variants indexed by N=1,E=2,S=4,W=8 bitmask
  gate: HTMLCanvasElement;
  gatePlan: HTMLCanvasElement;
  sapling: HTMLCanvasElement;
  settler: HTMLCanvasElement[][];
  settlerArmed: HTMLCanvasElement[][];
  raider: HTMLCanvasElement[];
  deer: HTMLCanvasElement[];
  wolf: HTMLCanvasElement[];
  items: Record<import('../sim/defs').ResourceKind, HTMLCanvasElement>;
  grave: HTMLCanvasElement;
  corpse: HTMLCanvasElement;
  buildings: Record<string, HTMLCanvasElement>;
  blueprints: Record<string, HTMLCanvasElement>;
}

/** Soft ground: two close tones blended in irregular patches + sparse blades. */
function grassTile(variant: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE;
  c.height = TILE;
  const g = c.getContext('2d')!;
  g.fillStyle = variant % 2 === 0 ? P.grassA : P.grassB;
  g.fillRect(0, 0, TILE, TILE);
  // irregular tone patches (organic, not checkered)
  g.fillStyle = variant % 2 === 0 ? P.grassB : P.grassC;
  const blobs = [[2, 3, 6, 4], [9, 8, 7, 5], [1, 11, 5, 4], [11, 1, 5, 4]];
  for (const [x, y, w, h] of blobs) {
    g.fillRect((x + variant * 3) % 12, (y + variant * 5) % 12, w, h);
  }
  // a few grass blades
  g.fillStyle = P.blade;
  for (let i = 0; i < 4; i++) {
    const bx = (i * 5 + variant * 7) % 14 + 1;
    const by = (i * 9 + variant * 3) % 13 + 1;
    g.fillRect(bx, by, 1, 2);
  }
  return c;
}

function dirtPatchTile(): HTMLCanvasElement {
  const c = grassTile(0);
  const g = c.getContext('2d')!;
  g.fillStyle = P.dirtPatch;
  g.fillRect(3, 4, 10, 8);
  g.fillRect(5, 2, 6, 12);
  g.fillStyle = P.rutBrown;
  g.fillRect(5, 5, 6, 5);
  return c;
}

function waterTile(frame: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE;
  c.height = TILE;
  const g = c.getContext('2d')!;
  g.fillStyle = P.water1;
  g.fillRect(0, 0, TILE, TILE);
  g.fillStyle = P.water2;
  for (let i = 0; i < 3; i++) {
    g.fillRect((i * 6 + frame * 3) % 13, 3 + i * 5, 5, 2);
  }
  g.fillStyle = P.waterGlint;
  g.fillRect((4 + frame * 5) % 12, (7 + frame * 3) % 12, 3, 1);
  return c;
}

/** Big rounded canopy overhanging the tile (20×22, drawn offset by renderer). */
function treeSprite(marked: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 20;
  c.height = 22;
  const g = c.getContext('2d')!;
  // ground shadow
  g.fillStyle = P.shadow;
  g.fillRect(4, 17, 12, 4);
  // trunk
  g.fillStyle = marked ? '#c25b2e' : P.trunk;
  g.fillRect(8, 13, 4, 6);
  // canopy: stacked rounded layers, lit from upper-left
  const layers: [number, number, number, number, string][] = [
    [3, 4, 14, 10, P.treeLeafDark],
    [2, 3, 13, 9, P.treeLeaf],
    [4, 1, 11, 8, P.treeLeaf],
    [4, 2, 8, 5, P.treeLeafLight],
  ];
  for (const [x, y, w, h, col] of layers) {
    g.fillStyle = col;
    g.fillRect(x + 1, y, w - 2, h);
    g.fillRect(x, y + 1, w, h - 2);
  }
  if (marked) {
    g.fillStyle = '#c25b2e';
    g.fillRect(15, 0, 4, 4);
  }
  return c;
}

function rockSprite(marked: boolean): HTMLCanvasElement {
  const c = grassTile(2);
  const g = c.getContext('2d')!;
  g.fillStyle = P.shadow;
  g.fillRect(2, 11, 13, 4);
  g.fillStyle = P.rockDark;
  g.fillRect(2, 5, 12, 9);
  g.fillStyle = P.rock;
  g.fillRect(3, 4, 10, 8);
  g.fillStyle = P.rockLight;
  g.fillRect(4, 4, 5, 3);
  if (marked) {
    g.fillStyle = '#c25b2e';
    g.fillRect(12, 1, 4, 4);
  }
  return c;
}

function soilTile(stage: 'bare' | 'sown' | 'grown' | 'ripe'): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE;
  c.height = TILE;
  const g = c.getContext('2d')!;
  g.fillStyle = P.soil;
  g.fillRect(0, 0, TILE, TILE);
  g.fillStyle = P.soilDark;
  for (let y = 2; y < TILE; y += 4) g.fillRect(0, y, TILE, 2);
  if (stage !== 'bare') {
    const col = stage === 'sown' ? P.treeLeafDark : stage === 'grown' ? P.crop : P.cropRipe;
    g.fillStyle = col;
    for (let y = 3; y < TILE; y += 4) {
      for (let x = 2; x < TILE - 1; x += 4) {
        const hgt = stage === 'sown' ? 2 : stage === 'grown' ? 3 : 4;
        g.fillRect(x, y - hgt + 2, 2, hgt);
        if (stage === 'ripe') {
          g.fillStyle = P.grain;
          g.fillRect(x, y - hgt + 1, 2, 1);
          g.fillStyle = col;
        }
      }
    }
  }
  return c;
}

function roadTile(kind: string, plan: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE;
  c.height = TILE;
  const g = c.getContext('2d')!;
  switch (kind) {
    case 'dirt': {
      g.fillStyle = P.rutBrown;
      g.fillRect(0, 0, TILE, TILE);
      g.fillStyle = P.rutDark;
      g.fillRect(3, 0, 2, TILE);
      g.fillRect(11, 0, 2, TILE);
      break;
    }
    case 'plank': {
      g.fillStyle = P.plank;
      g.fillRect(0, 0, TILE, TILE);
      g.fillStyle = P.plankDark;
      for (let y = 0; y < TILE; y += 4) g.fillRect(0, y, TILE, 1);
      g.fillRect(7, 0, 1, TILE);
      break;
    }
    case 'gravel': {
      g.fillStyle = P.gravelB;
      g.fillRect(0, 0, TILE, TILE);
      g.fillStyle = P.gravelA;
      for (let i = 0; i < 14; i++) {
        g.fillRect((i * 7) % 15, (i * 11) % 15, 2, 1);
      }
      break;
    }
    case 'bridge': {
      g.fillStyle = P.plank;
      g.fillRect(0, 1, TILE, TILE - 2);
      g.fillStyle = P.plankDark;
      for (let x = 0; x < TILE; x += 4) g.fillRect(x, 1, 1, TILE - 2);
      g.fillStyle = P.woodDark;
      g.fillRect(0, 0, TILE, 2);
      g.fillRect(0, TILE - 2, TILE, 2);
      break;
    }
  }
  if (plan) {
    const gg = c.getContext('2d')!;
    gg.globalAlpha = 0.45;
    gg.fillStyle = '#9cc4e4';
    gg.fillRect(0, 0, TILE, TILE);
    gg.globalAlpha = 1;
  }
  return c;
}

/** Capsule pawn, RimWorld-ish: round body, big head, hair, drop shadow. */
function pawnSprite(cloth: string, frame: number, skin: string, hair: string, armed = false): HTMLCanvasElement {
  const legL = frame === 0 ? 'L.' : '.L';
  const legR = frame === 0 ? '.L' : 'L.';
  const arm = armed ? 'W' : '.';
  const rows = [
    '................',
    '.....HHHHH......',
    '....HHHHHHH.....',
    '....FFFFFFF.....',
    '....FFFFFFF.....',
    '.....FFFFF......',
    `....CCCCCCC${arm}....`,
    `...CCCCCCCCC${arm}...`,
    `...CCCCCCCCC${arm}...`,
    '...CCCCCCCCC....',
    '....CCCCCCC.....',
    `....O${legL}.${legR}O.....`,
    `....O${legL}.${legR}O.....`,
    '....SSSSSSS.....',
    '................',
    '................',
  ];
  return sheet(
    grid(rows, {
      O: P.outline,
      F: skin,
      H: hair,
      C: cloth,
      L: P.wallDark,
      W: '#b8b4ac',
      S: 'rgba(20,16,10,0.3)',
    }),
  );
}

function buildingSprite(defId: string, w: number, h: number, ghost: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w * TILE + 3;
  c.height = h * TILE + 3;
  const g = c.getContext('2d')!;
  const W = w * TILE;
  const H = h * TILE;
  g.globalAlpha = ghost ? 0.5 : 1;

  if (!ghost) {
    g.fillStyle = P.shadow;
    g.fillRect(3, 3, W, H);
  }

  // ghost overrides
  const gW = ghost ? '#7a93ab' : null;
  const gWd = ghost ? '#5d7690' : null;
  const gR = ghost ? '#8aa3bb' : null;
  const gRl = ghost ? '#9ab3c8' : null;

  g.fillStyle = P.outline;
  g.fillRect(0, 0, W, H);

  if (defId === 'palisade') {
    // Pointed wooden stakes with horizontal binding rails
    g.fillStyle = gWd ?? P.woodDark;
    g.fillRect(1, 1, W - 2, H - 2);
    g.fillStyle = gW ?? P.wood;
    for (let x = 2; x < W - 2; x += 4) g.fillRect(x, 2, 2, H - 4);
    // sharpen tops
    g.fillStyle = P.outline;
    for (let x = 3; x < W - 2; x += 4) g.fillRect(x, 1, 1, 1);
    // binding rails
    g.fillStyle = gWd ?? P.trunk;
    g.fillRect(1, Math.floor(H * 0.33), W - 2, 2);
    g.fillRect(1, Math.floor(H * 0.66), W - 2, 2);

  } else if (defId === 'stockpile') {
    // Open storage yard with crates and grain sacks
    g.fillStyle = P.floor;
    g.fillRect(1, 1, W - 2, H - 2);
    g.fillStyle = gWd ?? P.woodDark;
    g.fillRect(1, 1, W - 2, 2);
    g.fillRect(1, H - 3, W - 2, 2);
    g.fillRect(1, 1, 2, H - 2);
    g.fillRect(W - 3, 1, 2, H - 2);
    // two crates side by side
    const cw = Math.floor((W - 10) / 2);
    for (let ci = 0; ci < 2; ci++) {
      const cx = 4 + ci * (cw + 2);
      g.fillStyle = gW ?? P.wood;
      g.fillRect(cx, 3, cw, 8);
      g.fillStyle = gWd ?? P.woodDark;
      g.fillRect(cx, 3, cw, 1);
      g.fillRect(cx + Math.floor(cw / 2), 3, 1, 8);
    }
    // grain sack
    g.fillStyle = gRl ?? P.grain;
    g.fillRect(4, 13, W - 8, H - 17);
    g.fillStyle = gR ?? '#c29030';
    g.fillRect(5, 13, W - 10, 1);

  } else if (defId === 'farm') {
    // Plowed soil with crop rows
    g.fillStyle = P.soil;
    g.fillRect(1, 1, W - 2, H - 2);
    g.fillStyle = P.soilDark;
    for (let y = 3; y < H - 1; y += 5) g.fillRect(1, y, W - 2, 2);
    if (!ghost) {
      g.fillStyle = P.crop;
      for (let y = 4; y < H - 2; y += 5)
        for (let x = 3; x < W - 2; x += 5) g.fillRect(x, y - 1, 2, 3);
    }

  } else if (defId === 'hearth') {
    // Stone fire ring with a live flame
    g.fillStyle = P.grassB;
    g.fillRect(1, 1, W - 2, H - 2);
    g.fillStyle = gWd ?? P.rockDark;
    g.fillRect(3, 3, W - 6, H - 6);
    g.fillStyle = gW ?? P.rock;
    g.fillRect(3, 3, 3, 3); g.fillRect(W - 6, 3, 3, 3);
    g.fillRect(3, H - 6, 3, 3); g.fillRect(W - 6, H - 6, 3, 3);
    g.fillStyle = '#1e1810';
    g.fillRect(5, 5, W - 10, H - 10);
    if (!ghost) {
      g.fillStyle = '#c25b2e'; g.fillRect(6, 6, 4, 5);
      g.fillStyle = '#e8a44a'; g.fillRect(7, 5, 2, 4);
      g.fillStyle = '#f0d060'; g.fillRect(7, 7, 1, 2);
    }

  } else if (defId === 'graveyard') {
    // Fenced burial plot with headstones
    g.fillStyle = P.grassC;
    g.fillRect(1, 1, W - 2, H - 2);
    g.fillStyle = P.soilDark;
    g.fillRect(4, 4, W - 8, H - 8);
    // fence rails
    g.fillStyle = gRl ?? '#b0a890';
    g.fillRect(1, 3, W - 2, 1);
    g.fillRect(1, H - 4, W - 2, 1);
    // fence posts
    g.fillStyle = gW ?? '#8a806a';
    for (let x = 1; x < W - 1; x += 4) {
      g.fillRect(x, 1, 2, 4);
      g.fillRect(x, H - 5, 2, 4);
    }
    for (let y = 4; y < H - 4; y += 4) {
      g.fillRect(1, y, 3, 1);
      g.fillRect(W - 4, y, 3, 1);
    }
    // headstones
    if (!ghost) {
      g.fillStyle = P.rock;
      for (let ci = 0; ci < w; ci++) {
        for (let ri = 0; ri < h; ri++) {
          const sx = 6 + ci * Math.floor((W - 12) / Math.max(1, w));
          const sy = 5 + ri * Math.floor((H - 12) / Math.max(1, h));
          if (sx + 4 < W - 4 && sy + 5 < H - 4) {
            g.fillRect(sx, sy, 4, 5);
            g.fillStyle = P.rockLight; g.fillRect(sx, sy, 4, 1);
            g.fillStyle = P.rock;
          }
        }
      }
    }

  } else if (defId === 'fishing_dock') {
    // Wooden jetty planks over water
    g.fillStyle = P.water1;
    g.fillRect(1, H - 6, W - 2, 5);
    g.fillStyle = P.water2;
    g.fillRect(3, H - 5, 4, 2); g.fillRect(W - 7, H - 5, 4, 2);
    g.fillStyle = gW ?? P.plank;
    g.fillRect(1, 1, W - 2, H - 6);
    g.fillStyle = gWd ?? P.plankDark;
    for (let x = 3; x < W - 2; x += 5) g.fillRect(x, 1, 1, H - 6);
    g.fillRect(1, H - 7, W - 2, 1);
    g.fillStyle = gWd ?? P.woodDark;
    g.fillRect(1, 1, W - 2, 1);
    g.fillStyle = gR ?? P.trunk;
    g.fillRect(2, H - 6, 2, 5); g.fillRect(W - 4, H - 6, 2, 5);

  } else if (defId === 'well') {
    // Stone ring with a timber frame, rope and bucket
    g.fillStyle = P.grassB;
    g.fillRect(1, 1, W - 2, H - 2);
    g.fillStyle = P.shadow;
    g.fillRect(3, 12, 11, 3);
    g.fillStyle = gWd ?? P.rockDark;
    g.fillRect(3, 7, 10, 7);
    g.fillStyle = gW ?? P.rock;
    g.fillRect(4, 8, 8, 5);
    g.fillStyle = '#14100c';
    g.fillRect(6, 9, 4, 3);
    g.fillStyle = gWd ?? P.woodDark;
    g.fillRect(3, 2, 2, 6);
    g.fillRect(11, 2, 2, 6);
    g.fillStyle = gW ?? P.wood;
    g.fillRect(2, 1, 12, 2);
    if (!ghost) {
      g.fillStyle = P.grain;
      g.fillRect(7, 3, 1, 5); // rope
      g.fillStyle = P.wood;
      g.fillRect(6, 8, 4, 2); // bucket over the mouth
    }

  } else if (defId === 'watchtower') {
    // Tall timber lookout: braced legs, plank platform, lookout cabin
    g.fillStyle = P.grassB;
    g.fillRect(1, 1, W - 2, H - 2);
    g.fillStyle = P.shadow;
    g.fillRect(4, H - 4, W - 8, 3);
    g.fillStyle = gWd ?? P.woodDark;
    g.fillRect(5, 14, 3, H - 16);
    g.fillRect(W - 8, 14, 3, H - 16);
    if (!ghost) {
      g.fillStyle = P.trunk; // cross-brace between the legs
      for (let i = 0; i < W - 17; i++) {
        const yy = 15 + Math.floor((i * (H - 21)) / (W - 17));
        g.fillRect(8 + i, yy, 1, 2);
        g.fillRect(W - 9 - i, yy, 1, 2);
      }
    }
    g.fillStyle = gW ?? P.plank;
    g.fillRect(2, 11, W - 4, 3);
    g.fillStyle = gWd ?? P.plankDark;
    g.fillRect(2, 13, W - 4, 1);
    g.fillStyle = gW ?? P.wood;
    g.fillRect(6, 3, W - 12, 8);
    g.fillStyle = gWd ?? P.woodDark;
    g.fillRect(6, 3, W - 12, 1);
    g.fillRect(6, 3, 1, 8);
    g.fillStyle = '#1a1208';
    g.fillRect(Math.floor(W / 2) - 3, 5, 6, 4);
    g.fillStyle = gWd ?? P.trunk;
    g.fillRect(4, 1, W - 8, 2);

  } else if (defId === 'mill') {
    // Stone windmill tower with lattice sails
    g.fillStyle = P.grassB;
    g.fillRect(1, 1, W - 2, H - 2);
    g.fillStyle = P.shadow;
    g.fillRect(6, H - 4, W - 10, 3);
    g.fillStyle = gW ?? P.wallCream;
    g.fillRect(9, 16, W - 18, H - 17);
    g.fillRect(10, 13, W - 20, 3);
    g.fillStyle = gWd ?? P.wallCreamDk;
    g.fillRect(9, 16, 2, H - 17);
    if (!ghost) {
      for (let y = 19; y < H - 2; y += 5) g.fillRect(10, y, W - 20, 1);
    }
    g.fillStyle = gWd ?? P.roofWood;
    g.fillRect(8, 9, W - 16, 5);
    g.fillStyle = P.outline;
    g.fillRect(Math.floor(W / 2) - 3, H - 9, 6, 8);
    g.fillStyle = gWd ?? P.wallDark;
    g.fillRect(Math.floor(W / 2) - 2, H - 8, 4, 7);
    if (!ghost) {
      g.fillStyle = P.outline;
      g.fillRect(Math.floor(W / 2) - 2, 22, 4, 4);
      g.fillStyle = P.winGold;
      g.fillRect(Math.floor(W / 2) - 1, 23, 2, 2);
    }
    const hubX = Math.floor(W / 2), hubY = 11;
    g.fillStyle = gRl ?? '#d8d0b8';
    for (let i = 1; i <= 9; i++) {
      g.fillRect(hubX - 1 - i, hubY - 1 - i, 2, 2);
      g.fillRect(hubX + i, hubY - 1 - i, 2, 2);
      g.fillRect(hubX - 1 - i, hubY + i, 2, 2);
      g.fillRect(hubX + i, hubY + i, 2, 2);
    }
    g.fillStyle = gWd ?? P.trunk;
    g.fillRect(hubX - 2, hubY - 2, 4, 4);

  } else if (defId === 'sawmill') {
    // Open-sided cutting shed: shingled roof on posts, saw blade, log pile
    g.fillStyle = P.floor;
    g.fillRect(1, 1, W - 2, H - 2);
    g.fillStyle = gWd ?? P.plankDark;
    for (let y = 14; y < H - 1; y += 6) g.fillRect(1, y, W - 2, 1);
    g.fillStyle = gWd ?? P.woodDark;
    g.fillRect(2, 12, 3, H - 14);
    g.fillRect(W - 5, 12, 3, H - 14);
    g.fillStyle = gR ?? P.roofWood;
    g.fillRect(1, 1, W - 2, 11);
    g.fillStyle = gRl ?? P.roofLight;
    g.fillRect(1, 4, W - 2, 2);
    g.fillRect(1, 8, W - 2, 2);
    if (!ghost) {
      g.fillStyle = P.woodDark; // saw bench
      g.fillRect(8, 24, W - 16, 4);
      const sx = Math.floor(W / 2), sy = 22, r = 5;
      g.fillStyle = P.rockLight; // circular blade
      for (let dy = -r; dy <= r; dy++) {
        const w2 = Math.floor(Math.sqrt(r * r - dy * dy));
        g.fillRect(sx - w2, sy + dy, w2 * 2 + 1, 1);
      }
      g.fillStyle = P.rockDark;
      g.fillRect(sx - 1, sy - 1, 2, 2);
      g.fillStyle = P.trunk; // log pile
      g.fillRect(5, H - 12, W - 10, 4);
      g.fillRect(8, H - 16, W - 16, 4);
      g.fillStyle = P.wood;
      g.fillRect(5, H - 11, 2, 2); g.fillRect(W - 7, H - 11, 2, 2);
      g.fillRect(8, H - 15, 2, 2); g.fillRect(W - 10, H - 15, 2, 2);
    }

  } else if (defId === 'mine') {
    // Rocky spoil mound with a timber-framed shaft portal
    g.fillStyle = P.grassC;
    g.fillRect(1, 1, W - 2, H - 2);
    g.fillStyle = gWd ?? P.rockDark;
    g.fillRect(3, 8, W - 6, H - 10);
    g.fillRect(6, 5, W - 12, 4);
    g.fillStyle = gW ?? P.rock;
    g.fillRect(5, 9, W - 10, H - 13);
    g.fillRect(8, 6, W - 16, 4);
    g.fillStyle = P.rockLight;
    g.fillRect(9, 7, 6, 2);
    g.fillRect(6, 12, 4, 2);
    g.fillStyle = gWd ?? P.woodDark;
    g.fillRect(10, 15, 3, H - 17);
    g.fillRect(W - 13, 15, 3, H - 17);
    g.fillRect(9, 13, W - 18, 3);
    g.fillStyle = '#0e0c08';
    g.fillRect(13, 16, W - 26, H - 18);
    if (!ghost) {
      g.fillStyle = P.grain; // glints of ore in the spoil
      g.fillRect(7, 19, 2, 1);
      g.fillRect(W - 8, 11, 2, 1);
    }

  } else if (defId === 'kiln') {
    // Domed brick kiln with a glowing fire mouth
    g.fillStyle = P.grassC;
    g.fillRect(1, 1, W - 2, H - 2);
    g.fillStyle = P.shadow;
    g.fillRect(4, H - 5, W - 8, 4);
    g.fillStyle = gWd ?? P.wallBrickDk;
    g.fillRect(4, 10, W - 8, H - 12);
    g.fillRect(7, 6, W - 14, 5);
    g.fillRect(11, 4, W - 22, 3);
    g.fillStyle = gW ?? P.wallBrick;
    g.fillRect(5, 11, W - 10, H - 14);
    g.fillRect(8, 7, W - 16, 5);
    if (!ghost) {
      g.fillStyle = P.wallBrickDk;
      for (let y = 13; y < H - 4; y += 4) g.fillRect(6, y, W - 12, 1);
    }
    g.fillStyle = gWd ?? P.rockDark; // vent
    g.fillRect(Math.floor(W / 2) - 2, 2, 4, 3);
    g.fillStyle = '#140e08'; // mouth
    g.fillRect(Math.floor(W / 2) - 4, H - 9, 8, 7);
    if (!ghost) {
      g.fillStyle = P.winOrange;
      g.fillRect(Math.floor(W / 2) - 3, H - 6, 6, 3);
      g.fillStyle = '#f0d060';
      g.fillRect(Math.floor(W / 2) - 1, H - 5, 2, 2);
    }

  } else if (defId === 'animal_pen') {
    // Fenced paddock: rails all round, trough, hay, livestock
    g.fillStyle = P.grassA;
    g.fillRect(1, 1, W - 2, H - 2);
    g.fillStyle = P.grassB;
    g.fillRect(8, 12, 14, 9);
    g.fillRect(W - 22, H - 20, 14, 10);
    g.fillStyle = P.dirtPatch;
    g.fillRect(Math.floor(W / 2) - 5, H - 10, 10, 7);
    g.fillStyle = gRl ?? '#b0a890';
    g.fillRect(1, 3, W - 2, 1);
    g.fillRect(1, 6, W - 2, 1);
    g.fillRect(1, H - 7, W - 2, 1);
    g.fillRect(1, H - 4, W - 2, 1);
    g.fillRect(2, 3, 1, H - 6);
    g.fillRect(W - 3, 3, 1, H - 6);
    g.fillStyle = gW ?? '#8a806a';
    for (let x = 1; x < W - 2; x += 6) {
      g.fillRect(x, 1, 2, 7);
      g.fillRect(x, H - 8, 2, 7);
    }
    for (let y = 7; y < H - 8; y += 6) {
      g.fillRect(1, y, 2, 2);
      g.fillRect(W - 3, y, 2, 2);
    }
    if (!ghost) {
      g.fillStyle = P.woodDark; // water trough
      g.fillRect(6, H - 14, 12, 5);
      g.fillStyle = P.water2;
      g.fillRect(7, H - 13, 10, 3);
      g.fillStyle = P.cropRipe; // hay pile
      g.fillRect(W - 14, 9, 9, 6);
      g.fillStyle = P.grain;
      g.fillRect(W - 12, 8, 5, 2);
      const beast = (sx: number, sy: number, body: string, head: string) => {
        g.fillStyle = P.shadow; g.fillRect(sx, sy + 5, 10, 2);
        g.fillStyle = body; g.fillRect(sx, sy, 8, 5);
        g.fillStyle = head; g.fillRect(sx + 7, sy + 1, 3, 3);
        g.fillStyle = P.outline;
        g.fillRect(sx + 1, sy + 5, 1, 2);
        g.fillRect(sx + 6, sy + 5, 1, 2);
      };
      beast(12, 18, '#ddd6c6', '#8a8074');
      beast(W - 20, H - 18, '#b89868', '#7a6040');
    }

  } else if (defId === 'kitchen_garden') {
    // Raised plank beds with vegetable rows
    g.fillStyle = P.grassB;
    g.fillRect(1, 1, W - 2, H - 2);
    for (const by of [3, 17]) {
      g.fillStyle = gWd ?? P.plankDark;
      g.fillRect(3, by, W - 6, 12);
      g.fillStyle = P.soil;
      g.fillRect(4, by + 1, W - 8, 10);
      g.fillStyle = P.soilDark;
      g.fillRect(4, by + 5, W - 8, 1);
      if (!ghost) {
        for (let x = 6; x < W - 6; x += 4) {
          g.fillStyle = P.crop;
          g.fillRect(x, by + 2, 2, 2);
          g.fillStyle = x % 8 === 6 ? '#c25b2e' : P.crop;
          g.fillRect(x, by + 7, 2, 2);
        }
      }
    }

  } else if (defId === 'herb_garden') {
    // Herb rows split by a gravel path, dotted with flowers
    g.fillStyle = P.grassB;
    g.fillRect(1, 1, W - 2, H - 2);
    g.fillStyle = P.gravelB;
    g.fillRect(Math.floor(W / 2) - 2, 1, 4, H - 2);
    for (const bx of [3, Math.floor(W / 2) + 3]) {
      g.fillStyle = P.soil;
      g.fillRect(bx, 3, Math.floor(W / 2) - 6, H - 6);
      if (!ghost) {
        for (let y = 5; y < H - 4; y += 4) {
          g.fillStyle = '#4a7040';
          g.fillRect(bx + 2, y, 2, 2);
          g.fillRect(bx + 6, y + 1, 2, 2);
          g.fillStyle = y % 8 === 5 ? '#b8a0d0' : '#e8e0c0';
          g.fillRect(bx + 5, y, 1, 1);
        }
      }
    }

  } else {
    // Residential/workshop buildings: roof at top, front wall + door below.
    const roofH = Math.floor(H * 0.55);

    let roofBase = gR ?? P.roofWood;
    let roofHigh = gRl ?? P.roofLight;
    let wallBase = gW ?? P.wall;
    let wallBase2 = gWd ?? P.wallDark;
    let winColor: string | null = null;
    let rightChimney = false;
    let leftChimney = false;
    let special: string | null = null;
    let halfTimbered = false;
    let brickWall = false;

    if (!ghost) {
      switch (defId) {
        case 'house':
          roofBase = P.roofRed; roofHigh = P.roofRedLt;
          wallBase = '#d4c8a8'; wallBase2 = '#2e1e0c';
          winColor = P.winGold; halfTimbered = true; rightChimney = true; break;
        case 'kitchen':
          roofBase = '#4a3a2a'; roofHigh = '#6a5238';
          wallBase = P.wallBrick; wallBase2 = P.wallBrickDk;
          winColor = P.winOrange; brickWall = true; rightChimney = true; break;
        case 'hall':
          roofBase = '#5c3e28'; roofHigh = '#7c5840';
          wallBase = '#d4c8a8'; wallBase2 = '#2e1e0c';
          winColor = P.winGold; halfTimbered = true; break;
        case 'tailor':
          roofBase = P.roofSlate; roofHigh = P.roofSlateLt;
          wallBase = '#8a8878'; wallBase2 = '#6a6858';
          winColor = P.winBlue; break;
        case 'bakery':
          roofBase = '#6a3c2a'; roofHigh = '#8a5840';
          wallBase = P.wallBrick; wallBase2 = P.wallBrickDk;
          winColor = P.winOrange; brickWall = true;
          leftChimney = true; rightChimney = true; break;
        case 'lodge':
          roofBase = '#3c3428'; roofHigh = '#5a4c38';
          wallBase = '#7a6040'; wallBase2 = '#5a4428';
          winColor = P.winAmber; break;
        case 'market':
          roofBase = P.roofTerra; roofHigh = P.roofTerraLt;
          wallBase = '#b8a478'; wallBase2 = '#9a8660';
          special = 'market'; break;
        case 'forester':
          roofBase = P.roofForest; roofHigh = P.roofForestLt;
          wallBase = '#8a7a54'; wallBase2 = '#6a5c3c';
          winColor = P.winGreen; break;
        case 'granary':
          roofBase = P.roofThatch; roofHigh = P.roofThatchLt;
          wallBase = '#c0a870'; wallBase2 = '#a08850';
          special = 'granary'; break;
        case 'clinic':
          roofBase = '#3c4c5e'; roofHigh = '#5c6c7e';
          wallBase = P.wallCream; wallBase2 = P.wallCreamDk;
          winColor = P.winBlue; special = 'clinic'; break;
        case 'cottage':
          roofBase = P.roofThatch; roofHigh = P.roofThatchLt;
          wallBase = '#d4c8a8'; wallBase2 = '#8a7a5c';
          winColor = P.winGold; rightChimney = true; break;
        case 'barracks':
          roofBase = '#4a4438'; roofHigh = '#66604c';
          wallBase = '#6a5236'; wallBase2 = '#4e3a24';
          winColor = P.winAmber; break;
        case 'longhouse':
          roofBase = P.roofThatch; roofHigh = P.roofThatchLt;
          wallBase = '#7a6040'; wallBase2 = '#5a4428';
          winColor = P.winAmber; special = 'longhouse'; break;
        case 'town_hall':
          roofBase = P.roofSlate; roofHigh = P.roofSlateLt;
          wallBase = P.wallCream; wallBase2 = P.wallCreamDk;
          winColor = P.winGold; special = 'townhall'; break;
        case 'armory':
          roofBase = '#3c3c44'; roofHigh = '#5a5a64';
          wallBase = '#8a8878'; wallBase2 = '#6a6858';
          special = 'armory'; break;
        case 'warehouse':
          roofBase = '#5a4a34'; roofHigh = '#7a6648';
          wallBase = P.plank; wallBase2 = P.plankDark;
          special = 'warehouse'; break;
        case 'apothecary':
          roofBase = '#4c5e3c'; roofHigh = '#6c7e58';
          wallBase = P.wallCream; wallBase2 = P.wallCreamDk;
          winColor = P.winGreen; special = 'apothecary'; break;
        case 'blacksmith':
          roofBase = '#33302c'; roofHigh = '#4e4a44';
          wallBase = '#5e5a50'; wallBase2 = '#4a463e';
          special = 'forge'; rightChimney = true; break;
        case 'schoolhouse':
          roofBase = P.roofRed; roofHigh = P.roofRedLt;
          wallBase = '#a85040'; wallBase2 = '#7a3a2e';
          winColor = P.winGold; special = 'school'; break;
        case 'brewery':
          roofBase = '#6a5228'; roofHigh = '#8a7038';
          wallBase = P.wallBrick; wallBase2 = P.wallBrickDk;
          winColor = P.winOrange; brickWall = true; special = 'brewery'; break;
      }
    }

    // Wall fill
    g.fillStyle = wallBase;
    g.fillRect(1, roofH, W - 2, H - roofH - 1);

    // Brick coursing: horizontal mortar lines every 3px
    if (brickWall && !ghost) {
      g.fillStyle = '#5a3a28';
      for (let y = roofH + 3; y < H - 2; y += 3) g.fillRect(2, y, W - 4, 1);
    }

    // Half-timber frame: dark beam posts, plates, rail, and knee braces over cream plaster
    if (halfTimbered && !ghost) {
      const wallH = H - roofH - 1;
      g.fillStyle = wallBase2;
      g.fillRect(1, roofH, 2, wallH);                              // left corner post
      g.fillRect(W - 3, roofH, 2, wallH);                         // right corner post
      g.fillRect(1, roofH, W - 2, 2);                             // top plate
      g.fillRect(1, H - 4, W - 2, 2);                             // sole plate
      if (wallH >= 10) {
        g.fillRect(3, roofH + Math.floor(wallH / 2), W - 6, 1);  // mid horizontal rail
      }
      const braceLen = Math.min(5, Math.floor(wallH / 3));
      for (let i = 0; i < braceLen; i++) {
        g.fillRect(3 + i, roofH + 2 + i, 1, 1);                  // left knee brace
        g.fillRect(W - 4 - i, roofH + 2 + i, 1, 1);              // right knee brace
      }
    } else {
      g.fillStyle = wallBase2;
      g.fillRect(1, roofH, W - 2, 2);
    }

    // Stone foundation strip at wall base
    if (!ghost) {
      g.fillStyle = P.rockDark;
      g.fillRect(1, H - 3, W - 2, 2);
    }

    // Door
    const wideDoor = defId === 'hall' || defId === 'town_hall' || defId === 'longhouse' ||
                     defId === 'warehouse' || defId === 'barracks';
    const dw = wideDoor ? 7 : 5;
    const dh = Math.min(8, H - roofH - 3);
    const dx = Math.floor(W / 2) - Math.floor(dw / 2);
    g.fillStyle = P.outline;
    g.fillRect(dx, H - dh - 1, dw, dh + 1);
    g.fillStyle = wallBase2;
    g.fillRect(dx + 1, H - dh, dw - 2, dh);
    if (!ghost) {
      g.fillStyle = P.grain;
      g.fillRect(dx + dw - 2, H - Math.floor(dh * 0.5) - 1, 1, 1);
    }

    // Windows with cross-mullion
    if (winColor) {
      const wh = Math.min(4, H - roofH - dh - 4);
      const wy = roofH + 3;
      if (wh >= 2) {
        const positions: number[] = [];
        if (dx >= 7) positions.push(3);
        if (W - dx - dw >= 7) positions.push(W - 8);
        if (W >= 44 && dx >= 15) positions.push(dx - 9);
        if (W >= 44 && W - dx - dw >= 15) positions.push(dx + dw + 3);
        for (const wx of positions) {
          if (wx >= 2 && wx + 5 <= W - 2) {
            g.fillStyle = P.outline;
            g.fillRect(wx, wy, 5, wh + 1);
            g.fillStyle = winColor;
            g.fillRect(wx + 1, wy + 1, 3, wh - 1);
            if (!ghost && wh >= 3) {
              g.fillStyle = P.outline;
              g.fillRect(wx + 2, wy + 1, 1, wh - 1);                         // vertical bar
              g.fillRect(wx + 1, wy + 1 + Math.floor((wh - 1) / 2), 3, 1);  // horizontal bar
            }
          }
        }
      }
    }

    // Roof: horizontal shingle courses replacing old vertical stripes
    g.fillStyle = roofBase;
    g.fillRect(1, 1, W - 2, roofH);
    g.fillStyle = '#20180e';
    g.fillRect(1, 1, W - 2, 2);                           // dark ridge cap
    for (let y = 3; y < roofH - 2; y += 3) {
      g.fillStyle = (Math.floor((y - 3) / 3) % 2 === 0) ? roofHigh : roofBase;
      g.fillRect(1, y, W - 2, 2);                         // alternating shingle band
    }
    g.fillStyle = '#20180e';
    g.fillRect(1, roofH - 2, W - 2, 2);                   // eave shadow

    // Chimneys drawn after roof so they appear above it; cap overhangs shaft by 1px each side
    const drawChimney = (cx: number) => {
      g.fillStyle = P.rockDark;
      g.fillRect(cx - 1, 1, 7, 2);                        // wide cap
      g.fillRect(cx, 3, 5, roofH - 4);                    // shaft
      g.fillStyle = P.rock;
      g.fillRect(cx + 1, 3, 3, roofH - 4);
      g.fillStyle = P.rockLight;
      g.fillRect(cx - 1, 1, 7, 1);                        // cap highlight
      g.fillStyle = '#1a1208';
      g.fillRect(cx + 1, 1, 3, 2);                        // smoke-blackened opening
    };
    if (rightChimney) drawChimney(W - 9);
    if (leftChimney) drawChimney(3);

    if (special === 'market' && !ghost) {
      for (let x = 1; x < W - 1; x += 4) {
        g.fillStyle = P.awningRed;   g.fillRect(x, roofH, 2, 3);
        g.fillStyle = P.awningCream; g.fillRect(x + 2, roofH, 2, 3);
      }
    } else if (special === 'granary') {
      g.fillStyle = '#8a6010';
      for (let y = 5; y < roofH - 3; y += 4) g.fillRect(2, y + 1, W - 4, 1);
    } else if (special === 'clinic' && !ghost) {
      const cx = Math.floor(W / 2);
      const cy = roofH + Math.floor((H - roofH) / 2);
      g.fillStyle = '#cc3333';
      g.fillRect(cx - 1, cy - 3, 2, 6);
      g.fillRect(cx - 3, cy - 1, 6, 2);
    } else if (special === 'townhall' && !ghost) {
      // flag above the ridge + gilded door lintel
      const cx = Math.floor(W / 2);
      g.fillStyle = P.rockLight;
      g.fillRect(cx, 1, 1, 5);
      g.fillStyle = P.awningRed;
      g.fillRect(cx + 1, 1, 5, 3);
      g.fillStyle = P.grain;
      g.fillRect(dx - 1, H - dh - 2, dw + 2, 1);
    } else if (special === 'armory' && !ghost) {
      // shield emblem on the wall
      const ax = Math.floor(W / 2) - 3;
      const ay = roofH + 3;
      g.fillStyle = P.rockLight;
      g.fillRect(ax, ay, 6, 5);
      g.fillStyle = P.awningRed;
      g.fillRect(ax + 1, ay + 1, 4, 3);
      g.fillRect(ax + 2, ay + 4, 2, 1);
    } else if (special === 'warehouse' && !ghost) {
      // double-door seam + a crate waiting outside
      g.fillStyle = P.outline;
      g.fillRect(dx + Math.floor(dw / 2), H - dh, 1, dh);
      g.fillStyle = P.rockLight;
      g.fillRect(dx + 1, H - dh + 1, dw - 2, 1);
      g.fillStyle = P.wood;
      g.fillRect(3, H - 7, 6, 6);
      g.fillStyle = P.woodDark;
      g.fillRect(3, H - 7, 6, 1);
      g.fillRect(5, H - 7, 1, 6);
    } else if (special === 'apothecary' && !ghost) {
      // green cross beside the door
      g.fillStyle = '#3c8a4c';
      g.fillRect(4, roofH + 3, 2, 6);
      g.fillRect(2, roofH + 5, 6, 2);
    } else if (special === 'forge' && !ghost) {
      // glowing forge arch and an anvil out front
      g.fillStyle = '#1a1208';
      g.fillRect(3, H - 9, 7, 8);
      g.fillStyle = P.winOrange;
      g.fillRect(4, H - 7, 5, 5);
      g.fillStyle = '#f0d060';
      g.fillRect(5, H - 5, 3, 2);
      g.fillStyle = '#3a3a44';
      g.fillRect(W - 9, H - 5, 6, 2);
      g.fillRect(W - 8, H - 7, 4, 2);
    } else if (special === 'school' && !ghost) {
      // belfry on the ridge
      const cx = Math.floor(W / 2);
      g.fillStyle = P.woodDark;
      g.fillRect(cx - 3, 1, 7, 5);
      g.fillStyle = '#1a1208';
      g.fillRect(cx - 1, 2, 3, 3);
      g.fillStyle = P.grain;
      g.fillRect(cx, 3, 1, 2);
    } else if (special === 'brewery' && !ghost) {
      // barrels stacked by the wall
      for (const bx of [3, W - 9]) {
        g.fillStyle = P.wood;
        g.fillRect(bx, H - 8, 6, 7);
        g.fillStyle = P.woodDark;
        g.fillRect(bx, H - 6, 6, 1);
        g.fillRect(bx, H - 3, 6, 1);
      }
    } else if (special === 'longhouse' && !ghost) {
      // a second doorway toward the gable end
      g.fillStyle = P.outline;
      g.fillRect(6, H - dh - 1, 5, dh + 1);
      g.fillStyle = wallBase2;
      g.fillRect(7, H - dh, 3, dh);
    }
  }

  g.globalAlpha = 1;
  return c;
}

function weaponSprite(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE;
  c.height = TILE;
  const g = c.getContext('2d')!;
  g.fillStyle = P.wood;
  g.fillRect(7, 4, 2, 9); // shaft
  g.fillStyle = P.rockLight;
  g.fillRect(6, 2, 4, 3); // tip body
  g.fillStyle = '#d4c070';
  g.fillRect(7, 1, 2, 2); // tip point
  return c;
}

/** Simple colored pile sprite for resources that don't have custom art yet. */
function genericItemSprite(color: string, color2: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  const g = c.getContext('2d')!;
  g.fillStyle = P.shadow;
  g.fillRect(3, 10, 10, 3);
  g.fillStyle = color2;
  g.fillRect(4, 7, 8, 4);
  g.fillStyle = color;
  g.fillRect(5, 5, 6, 3);
  g.fillRect(3, 8, 10, 2);
  return c;
}

function itemSprite(kind: 'wood' | 'grain' | 'meal' | 'stone' | 'clothes'): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE;
  c.height = TILE;
  const g = c.getContext('2d')!;
  g.fillStyle = P.shadow;
  g.fillRect(3, 10, 10, 3);
  if (kind === 'wood') {
    g.fillStyle = P.woodDark;
    g.fillRect(3, 6, 10, 3);
    g.fillStyle = P.wood;
    g.fillRect(4, 4, 10, 3);
    g.fillRect(2, 8, 10, 3);
  } else if (kind === 'stone') {
    g.fillStyle = P.rockDark;
    g.fillRect(4, 7, 8, 5);
    g.fillStyle = P.rock;
    g.fillRect(5, 5, 6, 5);
    g.fillStyle = P.rockLight;
    g.fillRect(6, 5, 3, 2);
  } else if (kind === 'clothes') {
    // a folded stack of woven cloth
    g.fillStyle = P.cloth2;
    g.fillRect(3, 7, 10, 4);
    g.fillStyle = P.cloth3;
    g.fillRect(4, 5, 8, 3);
    g.fillStyle = P.cloth1;
    g.fillRect(5, 3, 6, 3);
  } else {
    const col = kind === 'grain' ? P.grain : P.meal;
    g.fillStyle = col;
    g.fillRect(4, 6, 8, 5);
    g.fillRect(6, 4, 4, 2);
    g.fillStyle = P.outline;
    g.fillRect(4, 11, 8, 1);
  }
  return c;
}

/** Distinct pixel art for processed goods (replaces the generic piles). */
function craftedItemSprite(kind: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE;
  c.height = TILE;
  const g = c.getContext('2d')!;
  g.fillStyle = P.shadow;
  g.fillRect(3, 11, 10, 3);
  switch (kind) {
    case 'timber': // squared planks, not raw logs
      g.fillStyle = P.plankDark; g.fillRect(2, 8, 12, 3);
      g.fillStyle = P.plank;     g.fillRect(3, 5, 12, 3);
      g.fillStyle = '#a8854e';   g.fillRect(3, 5, 12, 1);
      break;
    case 'brick': // courses of fired brick
      g.fillStyle = P.wallBrickDk; g.fillRect(3, 8, 10, 4);
      g.fillStyle = P.wallBrick;   g.fillRect(4, 5, 4, 3); g.fillRect(9, 5, 4, 3);
      g.fillStyle = '#b88070';     g.fillRect(4, 5, 4, 1); g.fillRect(9, 5, 4, 1);
      break;
    case 'iron': // stacked ingots
      g.fillStyle = '#505060'; g.fillRect(3, 8, 10, 4);
      g.fillStyle = '#707080'; g.fillRect(5, 5, 7, 3);
      g.fillStyle = '#9a9aac'; g.fillRect(5, 5, 7, 1);
      break;
    case 'tools': // hammer over a chisel
      g.fillStyle = P.wood;    g.fillRect(7, 4, 2, 8);
      g.fillStyle = '#8a8a96'; g.fillRect(5, 3, 6, 3);
      g.fillStyle = '#aaaab6'; g.fillRect(5, 3, 6, 1);
      g.fillStyle = '#707080'; g.fillRect(3, 10, 8, 2);
      break;
    case 'rope': // a coiled ring
      g.fillStyle = '#7a6840'; g.fillRect(4, 5, 9, 7);
      g.fillStyle = '#9c8858'; g.fillRect(5, 6, 7, 5);
      g.fillStyle = '#5a4c30'; g.fillRect(7, 8, 3, 2);
      break;
    case 'flour': // tied sack
      g.fillStyle = '#a8a088'; g.fillRect(4, 6, 8, 6);
      g.fillStyle = '#c8c0a8'; g.fillRect(5, 6, 6, 5);
      g.fillStyle = '#7a7460'; g.fillRect(6, 4, 4, 2);
      break;
    case 'ale': // barrel
      g.fillStyle = P.wood;     g.fillRect(4, 4, 8, 8);
      g.fillStyle = '#a8854e';  g.fillRect(5, 4, 2, 8);
      g.fillStyle = P.woodDark; g.fillRect(4, 6, 8, 1); g.fillRect(4, 9, 8, 1);
      break;
    case 'bread': // two loaves
      g.fillStyle = '#a07038'; g.fillRect(3, 8, 7, 4);
      g.fillStyle = '#c09050'; g.fillRect(3, 7, 7, 3);
      g.fillStyle = '#e0b878'; g.fillRect(4, 7, 5, 1);
      g.fillStyle = '#c09050'; g.fillRect(9, 5, 5, 4);
      g.fillStyle = '#e0b878'; g.fillRect(10, 5, 3, 1);
      break;
    case 'medicine': // stoppered bottle
      g.fillStyle = '#406858'; g.fillRect(6, 6, 5, 6);
      g.fillStyle = '#5a8870'; g.fillRect(7, 7, 3, 4);
      g.fillStyle = '#88b8a0'; g.fillRect(7, 7, 1, 3);
      g.fillStyle = P.wood;    g.fillRect(7, 4, 3, 2);
      break;
    case 'herbs': // tied green bundle
      g.fillStyle = '#365830'; g.fillRect(4, 5, 8, 6);
      g.fillStyle = '#4a7040'; g.fillRect(5, 4, 6, 6);
      g.fillStyle = '#6a9050'; g.fillRect(6, 4, 2, 3);
      g.fillStyle = P.grain;   g.fillRect(5, 9, 6, 1);
      break;
    case 'dairy': // cheese wheel with a wedge cut
      g.fillStyle = '#b0a060'; g.fillRect(3, 7, 10, 5);
      g.fillStyle = '#d8c070'; g.fillRect(3, 5, 10, 4);
      g.fillStyle = '#f0e0a0'; g.fillRect(9, 5, 4, 4);
      break;
    case 'fish_meal': // a fish
      g.fillStyle = '#6080a0'; g.fillRect(3, 7, 9, 4);
      g.fillStyle = '#88a8c0'; g.fillRect(4, 7, 7, 1);
      g.fillStyle = '#486080'; g.fillRect(12, 6, 2, 6);
      g.fillStyle = P.outline; g.fillRect(4, 8, 1, 1);
      break;
    case 'produce': // basket of vegetables
      g.fillStyle = P.woodDark; g.fillRect(4, 8, 9, 4);
      g.fillStyle = P.wood;     g.fillRect(4, 8, 9, 1);
      g.fillStyle = '#608040';  g.fillRect(5, 6, 3, 3);
      g.fillStyle = '#c25b2e';  g.fillRect(8, 6, 3, 3);
      g.fillStyle = '#c8a830';  g.fillRect(11, 7, 2, 2);
      break;
  }
  return c;
}

/** A low earth mound with a wooden cross — drawn over burial-ground tiles. */
function graveSprite(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE;
  c.height = TILE;
  const g = c.getContext('2d')!;
  g.fillStyle = P.shadow;
  g.fillRect(3, 12, 11, 3);
  g.fillStyle = P.soilDark;
  g.fillRect(4, 10, 9, 4);
  g.fillStyle = P.soil;
  g.fillRect(5, 9, 7, 3);
  g.fillStyle = P.woodDark;
  g.fillRect(7, 2, 2, 9);
  g.fillRect(4, 4, 8, 2);
  g.fillStyle = P.wood;
  g.fillRect(7, 2, 1, 9);
  g.fillRect(4, 4, 8, 1);
  return c;
}

/** A fallen settler awaiting burial. */
function corpseSprite(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE;
  c.height = TILE;
  const g = c.getContext('2d')!;
  g.fillStyle = P.shadow;
  g.fillRect(1, 10, 14, 4);
  g.fillStyle = P.cloth1;
  g.fillRect(4, 8, 9, 4); // body lying on its side
  g.fillStyle = P.skinB;
  g.fillRect(1, 8, 3, 4); // head
  g.fillStyle = P.hairA;
  g.fillRect(1, 7, 3, 2);
  g.fillStyle = P.wallDark;
  g.fillRect(13, 9, 2, 3); // boots
  return c;
}

/** Stockpile zone: floor pattern with diagonal lines. */
function stockpileZoneTile(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE;
  c.height = TILE;
  const g = c.getContext('2d')!;
  g.fillStyle = P.floor;
  g.fillRect(0, 0, TILE, TILE);
  g.fillStyle = P.plankDark;
  g.globalAlpha = 0.4;
  for (let i = 0; i < 32; i += 4) {
    g.fillRect(i, 0, 1, TILE);
  }
  for (let i = 0; i < 32; i += 4) {
    g.fillRect(0, i, TILE, 1);
  }
  g.globalAlpha = 1;
  return c;
}

/** Spike trap zone: crossed stakes pattern with danger-red tint. */
function trapZoneTile(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE;
  c.height = TILE;
  const g = c.getContext('2d')!;
  g.globalAlpha = 0.55;
  g.fillStyle = '#8b1a1a';
  g.fillRect(0, 0, TILE, TILE);
  g.globalAlpha = 0.9;
  g.fillStyle = '#c0392b';
  // Crossed diagonal spikes
  const pts = [[4, 4], [12, 4], [8, 8], [4, 12], [12, 12]];
  for (const [x, y] of pts) {
    g.fillRect(x - 1, y - 3, 2, 6);
    g.fillRect(x - 3, y - 1, 6, 2);
    g.fillRect(x, y - 3, 1, 1); // spike tip
  }
  g.globalAlpha = 1;
  return c;
}

/** Wall plan: ghost palisade outline. */
function wallPlanTile(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE;
  c.height = TILE;
  const g = c.getContext('2d')!;
  g.globalAlpha = 0.5;
  g.fillStyle = '#c25b2e';
  for (let x = 2; x < 14; x += 3) {
    g.fillRect(x, 8, 2, 5);
  }
  g.globalAlpha = 1;
  return c;
}

/**
 * Palisade tile variant based on 4-bit bitmask of connected neighbors: N=1, E=2, S=4, W=8.
 * Arms extend in each connected direction; the center block is always drawn.
 */
function palisadeVariantTile(mask: number): HTMLCanvasElement {
  const hasN = (mask & 1) !== 0;
  const hasE = (mask & 2) !== 0;
  const hasS = (mask & 4) !== 0;
  const hasW = (mask & 8) !== 0;
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  const g = c.getContext('2d')!;

  // Band geometry: horizontal band at y=[5,12], vertical band at x=[5,11]
  const HY1 = 5, HY2 = 12;
  const VX1 = 5, VX2 = 11;

  // Draw shadows first (below horizontal band and right of vertical band)
  g.fillStyle = P.shadow;
  if (hasE || hasW || (!hasN && !hasS)) {
    const sx1 = hasW ? 0 : VX1, sx2 = hasE ? TILE : VX2;
    g.fillRect(sx1 + 1, HY2, sx2 - sx1, 2);
  }
  if (hasS) g.fillRect(VX1 + 1, HY2, VX2 - VX1, TILE - HY2);

  const drawHPlanks = (x1: number, x2: number, y1: number, y2: number) => {
    const w = x2 - x1, h = y2 - y1;
    if (w <= 0 || h <= 0) return;
    g.fillStyle = P.woodDark;
    g.fillRect(x1, y1, w, h);
    g.fillStyle = P.wood;
    for (let px = x1 + 1; px < x2 - 1; px += 3) g.fillRect(px, y1 + 1, 2, h - 1);
    g.fillStyle = P.rockLight;
    g.fillRect(x1, y1, w, 1);
  };

  const drawVPlanks = (x1: number, x2: number, y1: number, y2: number) => {
    const w = x2 - x1, h = y2 - y1;
    if (w <= 0 || h <= 0) return;
    g.fillStyle = P.woodDark;
    g.fillRect(x1, y1, w, h);
    g.fillStyle = P.wood;
    for (let py = y1 + 1; py < y2 - 1; py += 3) g.fillRect(x1 + 1, py, w - 1, 2);
    g.fillStyle = P.rockLight;
    g.fillRect(x1, y1, 1, h);
  };

  // Arms extending to edges
  if (hasW) drawHPlanks(0, VX1, HY1, HY2);
  if (hasE) drawHPlanks(VX2, TILE, HY1, HY2);
  if (hasN) drawVPlanks(VX1, VX2, 0, HY1);
  if (hasS) drawVPlanks(VX1, VX2, HY2, TILE);

  // Center block — use intersection post when both H and V are present
  const hActive = hasE || hasW || (!hasN && !hasS);
  const vActive = hasN || hasS;
  if (hActive && vActive) {
    g.fillStyle = P.woodDark;
    g.fillRect(VX1, HY1, VX2 - VX1, HY2 - HY1);
    g.fillStyle = P.wood;
    g.fillRect(VX1 + 1, HY1 + 1, VX2 - VX1 - 2, HY2 - HY1 - 2);
    g.fillStyle = P.rockLight;
    g.fillRect(VX1, HY1, VX2 - VX1, 1);
    g.fillRect(VX1, HY1, 1, HY2 - HY1);
  } else if (vActive) {
    drawVPlanks(VX1, VX2, HY1, HY2);
  } else {
    drawHPlanks(VX1, VX2, HY1, HY2);
  }

  return c;
}

/** Built palisade wall: wooden vertical planks. */
function palisadeTile(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE;
  c.height = TILE;
  const g = c.getContext('2d')!;
  g.fillStyle = P.shadow;
  g.fillRect(0, 12, TILE, 3);
  g.fillStyle = P.wood;
  for (let x = 1; x < 14; x += 3) {
    g.fillRect(x, 6, 2, 7);
  }
  g.fillStyle = P.woodDark;
  for (let x = 3; x < 14; x += 3) {
    g.fillRect(x, 6, 1, 7);
  }
  g.fillStyle = P.rockLight;
  for (let x = 2; x < 14; x += 3) {
    g.fillRect(x, 13, 1, 1);
  }
  return c;
}

/** A built gate: palisade posts flanking a barred wooden door. */
function gateTile(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE;
  c.height = TILE;
  const g = c.getContext('2d')!;
  g.fillStyle = P.shadow;
  g.fillRect(0, 12, TILE, 3);
  // flanking posts
  g.fillStyle = P.wood;
  g.fillRect(0, 5, 3, 8);
  g.fillRect(13, 5, 3, 8);
  g.fillStyle = P.woodDark;
  g.fillRect(2, 5, 1, 8);
  g.fillRect(13, 5, 1, 8);
  // the door: horizontal planks with a cross-bar
  g.fillStyle = P.plank;
  g.fillRect(3, 6, 10, 7);
  g.fillStyle = P.plankDark;
  g.fillRect(3, 8, 10, 1);
  g.fillRect(3, 11, 10, 1);
  g.fillStyle = P.woodDark;
  g.fillRect(3, 9, 10, 1);
  return c;
}

/** Gate plan: ghost door outline. */
function gatePlanTile(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE;
  c.height = TILE;
  const g = c.getContext('2d')!;
  g.globalAlpha = 0.5;
  g.fillStyle = '#9cc4e4';
  g.fillRect(2, 7, 2, 6);
  g.fillRect(12, 7, 2, 6);
  g.fillRect(4, 9, 8, 2);
  g.globalAlpha = 1;
  return c;
}

/** A grazing deer: tan body, slender legs, a flick of white tail. */
function deerSprite(frame: number): HTMLCanvasElement {
  const legA = frame === 0 ? 'L..L' : '.LL.';
  const rows = [
    '................',
    '......e.........',
    '.....hh.........',
    '.....hhn........',
    '..bbbbbh........',
    '.bbbbbbb........',
    '.tbbbbbb........',
    `..${legA}...........`,
    `..${legA}...........`,
    '..SSSSSS........',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ];
  return sheet(
    grid(rows, {
      b: '#a87f50', h: '#96714a', n: '#26201a', e: '#6b4a2a',
      t: '#e8e2d4', L: '#7a5a36', S: 'rgba(20,16,10,0.3)',
    }),
  );
}

/** A wolf: grey, low-slung, ears up. */
function wolfSprite(frame: number): HTMLCanvasElement {
  const legA = frame === 0 ? 'L..L' : '.LL.';
  const rows = [
    '................',
    '....e.e.........',
    '....hhh.........',
    '....hhhn........',
    '.bbbbbh.........',
    'tbbbbbb.........',
    '.bbbbbb.........',
    `.${legA}...........`,
    `.${legA}...........`,
    '.SSSSSS.........',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ];
  return sheet(
    grid(rows, {
      b: '#6e6e72', h: '#5d5d62', n: '#26201a', e: '#5d5d62',
      t: '#8c8c90', L: '#4d4d52', S: 'rgba(20,16,10,0.3)',
    }),
  );
}

/** A forester's planting: a thin whip with a tuft of leaves, not yet a tree. */
function saplingSprite(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE;
  c.height = TILE;
  const g = c.getContext('2d')!;
  g.fillStyle = P.shadow;
  g.fillRect(6, 13, 5, 2);
  g.fillStyle = P.trunk;
  g.fillRect(7, 8, 2, 6);
  g.fillStyle = P.treeLeaf;
  g.fillRect(5, 4, 6, 5);
  g.fillStyle = P.treeLeafLight;
  g.fillRect(6, 3, 4, 3);
  return c;
}

export function buildSprites(buildingDefs: { id: string; w: number; h: number }[]): SpriteSet {
  const buildings: Record<string, HTMLCanvasElement> = {};
  const blueprints: Record<string, HTMLCanvasElement> = {};
  for (const d of buildingDefs) {
    buildings[d.id] = buildingSprite(d.id, d.w, d.h, false);
    blueprints[d.id] = buildingSprite(d.id, d.w, d.h, true);
  }
  const roads: Record<string, HTMLCanvasElement> = {};
  const roadPlans: Record<string, HTMLCanvasElement> = {};
  for (const k of ['dirt', 'plank', 'gravel', 'bridge']) {
    roads[k] = roadTile(k, false);
    roadPlans[k] = roadTile(k, true);
  }
  const pawnLooks: [string, string, string][] = [
    [P.cloth1, P.skin, P.hairA],
    [P.cloth2, P.skinB, P.hairB],
    [P.cloth3, P.skin, P.hairC],
  ];
  return {
    grass: [0, 1, 2, 3].map(grassTile),
    dirtPatch: dirtPatchTile(),
    tree: treeSprite(false),
    treeMarked: treeSprite(true),
    water: [waterTile(0), waterTile(1)],
    rock: rockSprite(false),
    rockMarked: rockSprite(true),
    soil: soilTile('bare'),
    soilSown: soilTile('sown'),
    soilGrown: soilTile('grown'),
    soilRipe: soilTile('ripe'),
    roads,
    roadPlans,
    stockpileZone: stockpileZoneTile(),
    trapZone: trapZoneTile(),
    wallPlan: wallPlanTile(),
    palisade: palisadeTile(),
    palisadeVariants: Array.from({ length: 16 }, (_, i) => palisadeVariantTile(i)),
    gate: gateTile(),
    gatePlan: gatePlanTile(),
    sapling: saplingSprite(),
    settler: pawnLooks.map(([c, s, h]) => [pawnSprite(c, 0, s, h), pawnSprite(c, 1, s, h)]),
    settlerArmed: pawnLooks.map(([c, s, h]) => [pawnSprite(c, 0, s, h, true), pawnSprite(c, 1, s, h, true)]),
    raider: [pawnSprite(P.clothRaider, 0, P.skinB, P.hairA, true), pawnSprite(P.clothRaider, 1, P.skinB, P.hairA, true)],
    deer: [deerSprite(0), deerSprite(1)],
    wolf: [wolfSprite(0), wolfSprite(1)],
    items: {
      // Founding resources — custom sprites
      wood: itemSprite('wood'),
      grain: itemSprite('grain'),
      meal: itemSprite('meal'),
      stone: itemSprite('stone'),
      clothes: itemSprite('clothes'),
      weapons: weaponSprite(),
      // Raw era-1 resources — generic colored piles
      clay:     genericItemSprite('#9c6b40', '#7a5030'),
      coal:     genericItemSprite('#3c3830', '#2a2820'),
      iron_ore: genericItemSprite('#786050', '#5e4840'),
      flax:     genericItemSprite('#9cb060', '#7a9040'),
      herbs:    craftedItemSprite('herbs'),
      // Processed resources — custom art
      timber:   craftedItemSprite('timber'),
      brick:    craftedItemSprite('brick'),
      iron:     craftedItemSprite('iron'),
      tools:    craftedItemSprite('tools'),
      rope:     craftedItemSprite('rope'),
      flour:    craftedItemSprite('flour'),
      ale:      craftedItemSprite('ale'),
      medicine: craftedItemSprite('medicine'),
      // Food variety
      bread:    craftedItemSprite('bread'),
      dairy:    craftedItemSprite('dairy'),
      produce:  craftedItemSprite('produce'),
      game_meal:  genericItemSprite('#8c5c3c', '#6a4028'),
      fish_meal:  craftedItemSprite('fish_meal'),
      preserved:  genericItemSprite('#6a4030', '#502820'),
    },
    grave: graveSprite(),
    corpse: corpseSprite(),
    buildings,
    blueprints,
  };
}
