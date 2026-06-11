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
  items: Record<'wood' | 'grain' | 'meal' | 'stone' | 'clothes' | 'weapons', HTMLCanvasElement>;
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
  const a = ghost ? 0.5 : 1;
  g.globalAlpha = a;
  // drop shadow to the lower-right
  if (!ghost) {
    g.fillStyle = P.shadow;
    g.fillRect(3, 3, W, H);
  }
  const wall = ghost ? '#7a93ab' : P.wall;
  const wallD = ghost ? '#5d7690' : P.wallDark;
  const roof = ghost ? '#8aa3bb' : P.roofWood;
  const roofL = ghost ? '#9ab3c8' : P.roofLight;

  g.fillStyle = P.outline;
  g.fillRect(0, 0, W, H);
  if (defId === 'palisade') {
    g.fillStyle = wallD;
    g.fillRect(1, 1, W - 2, H - 2);
    g.fillStyle = wall;
    for (let x = 2; x < W - 2; x += 5) {
      g.fillRect(x, 3, 3, H - 4);
      g.fillRect(x + 1, 1, 1, 2);
    }
  } else if (defId === 'stockpile') {
    g.fillStyle = P.floor;
    g.fillRect(1, 1, W - 2, H - 2);
    g.fillStyle = P.woodDark;
    g.fillRect(1, 1, W - 2, 2);
    g.fillRect(1, H - 3, W - 2, 2);
    g.fillStyle = P.wood;
    for (let i = 0; i < 3; i++) g.fillRect(4 + i * 14, 6, 9, 6); // crates
    g.fillStyle = P.grain;
    g.fillRect(8, 14, 7, 5);
  } else if (defId === 'farm') {
    g.fillStyle = P.soil;
    g.fillRect(1, 1, W - 2, H - 2);
    g.fillStyle = P.soilDark;
    for (let y = 3; y < H; y += 5) g.fillRect(1, y, W - 2, 2);
  } else if (defId === 'hearth') {
    // stone fire ring with a live flame
    g.fillStyle = P.grassB;
    g.fillRect(1, 1, W - 2, H - 2);
    g.fillStyle = P.rockDark;
    g.fillRect(3, 3, W - 6, H - 6);
    g.fillStyle = P.rock;
    g.fillRect(3, 3, 3, 3);
    g.fillRect(W - 6, 3, 3, 3);
    g.fillRect(3, H - 6, 3, 3);
    g.fillRect(W - 6, H - 6, 3, 3);
    if (!ghost) {
      g.fillStyle = '#c25b2e';
      g.fillRect(6, 6, 4, 5);
      g.fillStyle = '#e8a44a';
      g.fillRect(7, 5, 2, 4);
      g.fillStyle = '#f0d060';
      g.fillRect(7, 7, 1, 2);
    }
  } else if (defId === 'graveyard') {
    // fenced earth plot
    g.fillStyle = P.grassC;
    g.fillRect(1, 1, W - 2, H - 2);
    g.fillStyle = P.soilDark;
    g.fillRect(3, 3, W - 6, H - 6);
    g.fillStyle = wallD;
    for (let x = 1; x < W - 1; x += 4) {
      g.fillRect(x, 1, 1, 3);
      g.fillRect(x, H - 4, 1, 3);
    }
    for (let y = 1; y < H - 1; y += 4) {
      g.fillRect(1, y, 3, 1);
      g.fillRect(W - 4, y, 3, 1);
    }
  } else if (defId === 'fishing_dock') {
    // wooden planks over teal water — a simple jetty
    g.fillStyle = P.water1;
    g.fillRect(1, H - 6, W - 2, 5);
    g.fillStyle = P.water2;
    g.fillRect(3, H - 5, 4, 2);
    g.fillRect(W - 7, H - 5, 4, 2);
    g.fillStyle = P.plank;
    g.fillRect(1, 1, W - 2, H - 6);
    g.fillStyle = P.plankDark;
    for (let x = 3; x < W - 2; x += 5) g.fillRect(x, 1, 1, H - 6);
    g.fillRect(1, H - 7, W - 2, 1);
    g.fillStyle = P.woodDark;
    g.fillRect(1, 1, W - 2, 1);
    // dock posts at the water edge
    g.fillStyle = P.trunk;
    g.fillRect(2, H - 6, 2, 5);
    g.fillRect(W - 4, H - 6, 2, 5);
  } else {
    // walls visible at the base, roof above — reads as a structure, not a blob
    const roofH = Math.floor(H * 0.55);
    g.fillStyle = wall;
    g.fillRect(1, roofH, W - 2, H - roofH - 1);
    g.fillStyle = wallD;
    g.fillRect(1, roofH, W - 2, 2);
    g.fillStyle = roof;
    g.fillRect(1, 1, W - 2, roofH);
    g.fillStyle = roofL;
    for (let x = 3; x < W - 3; x += 5) g.fillRect(x, 2, 2, roofH - 3); // shingle rows
    g.fillRect(1, 1, W - 2, 1);
    // door
    g.fillStyle = P.outline;
    g.fillRect(Math.floor(W / 2) - 3, H - 9, 7, 8);
    g.fillStyle = wallD;
    g.fillRect(Math.floor(W / 2) - 2, H - 8, 5, 7);
    if (defId === 'kitchen' || defId === 'bakery') {
      g.fillStyle = P.rock;
      g.fillRect(W - 8, 1, 5, 7); // chimney
      g.fillStyle = P.rockLight;
      g.fillRect(W - 7, 1, 3, 2);
    }
    if (defId === 'hall') {
      g.fillStyle = '#d8c478';
      g.fillRect(5, roofH + 4, 4, 4);
      g.fillRect(W - 9, roofH + 4, 4, 4); // lit windows
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
      wood: itemSprite('wood'),
      grain: itemSprite('grain'),
      meal: itemSprite('meal'),
      stone: itemSprite('stone'),
      clothes: itemSprite('clothes'),
      weapons: weaponSprite(),
    },
    grave: graveSprite(),
    corpse: corpseSprite(),
    buildings,
    blueprints,
  };
}
