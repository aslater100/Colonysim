/**
 * Pixel sprites, RimWorld-leaning: soft blended terrain, drop shadows under
 * everything that stands, full rounded tree canopies, capsule-ish pawns, and
 * readable top-down buildings. Drawn once into offscreen canvases at load.
 *
 * TILE = 32: doubled from the original 16 to match RimWorld's detail density.
 * Every sprite function has been redrawn at the new resolution.
 */
import { STATION_DEFS } from '../sim/defs';

export const TILE = 32;

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

// Muted, naturalistic palette — earthy, not saturated
const P = {
  outline: '#26201a',
  shadow: 'rgba(20,16,10,0.35)',
  grassA: '#566445',
  grassB: '#5d6b4a',
  grassC: '#515f42',
  grassD: '#4e5c40',
  blade: '#6b7a52',
  bladeLight: '#7a8a5e',
  dirtPatch: '#6b5a40',
  dirtMid: '#5e4e36',
  soil: '#6b5138',
  soilDark: '#5a4129',
  soilMid: '#614830',
  crop: '#7e8c4a',
  cropRipe: '#c2a14d',
  water1: '#3d586b',
  water2: '#446076',
  water3: '#3a5464',
  waterGlint: '#5d7d94',
  waterGlint2: '#6d8fa6',
  rock: '#787469',
  rockDark: '#5e5a50',
  rockLight: '#8c887c',
  rockHighlight: '#9e9a8e',
  treeLeafLight: '#55703f',
  treeLeaf: '#466034',
  treeLeafDark: '#364d28',
  treeLeafDeep: '#2c3f20',
  trunk: '#4d3a26',
  trunkDark: '#3a2a1a',
  skin: '#c9a07a',
  skinB: '#a87f5c',
  skinShad: '#b8906a',
  hairA: '#3a2c1c',
  hairB: '#6b4a2a',
  hairC: '#8c8478',
  cloth1: '#7a6248',
  cloth2: '#5d6b6e',
  cloth3: '#735a66',
  clothRaider: '#8c3a2c',
  clothDark1: '#5e4c38',
  clothDark2: '#445052',
  wood: '#9c7544',
  woodDark: '#7a5a32',
  woodLight: '#b08858',
  grain: '#c2a14d',
  meal: '#a86e3c',
  stone: '#8c887c',
  wall: '#7a6248',
  wallDark: '#5d4936',
  roofWood: '#4a3a2c',
  roofLight: '#5d4a38',
  floor: '#8c7454',
  floorDark: '#7a6040',
  plank: '#8c6c44',
  plankDark: '#6e5434',
  plankLight: '#a07c52',
  gravelA: '#8a857a',
  gravelB: '#76716a',
  gravelC: '#6e6960',
  rutBrown: '#6e5a40',
  rutDark: '#5a4830',
  rutLight: '#7a6a50',
  wallLight: '#a08068',
  wallLightDk: '#7a6050',
  wallCream: '#c4c0b0',
  wallCreamDk: '#a0a098',
  wallBrick: '#a07060',
  wallBrickDk: '#806050',
  wallBrickMid: '#906860',
  roofRed: '#5a3a28',
  roofRedLt: '#7a5040',
  roofSlate: '#4a5060',
  roofSlateLt: '#6a7080',
  roofForest: '#3e4c2c',
  roofForestLt: '#5e6c4c',
  roofThatch: '#7a5820',
  roofThatchLt: '#9a7830',
  roofTerra: '#7c4a3c',
  roofTerraLt: '#9c6a58',
  winGold: '#d8c460',
  winOrange: '#e8a030',
  winBlue: '#a0c8e8',
  winGreen: '#a8c888',
  winAmber: '#c8a840',
  awningRed: '#b84040',
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
  palisadeVariants: HTMLCanvasElement[];
  gate: HTMLCanvasElement;
  gateVariants: HTMLCanvasElement[];
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
  /** Room build-system art: plank floor, stone wall, and per-station furniture. */
  interiorFloor: HTMLCanvasElement;
  interiorWall: HTMLCanvasElement;
  stations: Record<string, HTMLCanvasElement>;
}

/** Soft ground: organic tone patches + sparse grass blades at 32×32. */
function grassTile(variant: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  const g = c.getContext('2d')!;
  const base = [P.grassA, P.grassB, P.grassC, P.grassD][variant % 4];
  const mid  = [P.grassB, P.grassC, P.grassA, P.grassB][variant % 4];
  g.fillStyle = base;
  g.fillRect(0, 0, TILE, TILE);
  // irregular tone blobs — organic patches, not checkerboard
  g.fillStyle = mid;
  const blobs = [
    [2, 4, 10, 7], [14, 2, 11, 8], [4, 16, 8, 9],
    [20, 18, 10, 8], [0, 26, 7, 6], [24, 8, 8, 6],
  ];
  for (const [x, y, w, h] of blobs) {
    g.fillRect((x + variant * 5) % 26, (y + variant * 7) % 26, w, h);
  }
  // subtle darker edge detail
  g.fillStyle = P.grassC;
  for (let i = 0; i < 3; i++) {
    g.fillRect((i * 11 + variant * 9) % 28, (i * 13 + variant * 3) % 28, 3, 2);
  }
  // grass blades
  g.fillStyle = P.blade;
  for (let i = 0; i < 7; i++) {
    const bx = (i * 7 + variant * 11) % 29 + 1;
    const by = (i * 11 + variant * 5) % 29 + 1;
    g.fillRect(bx, by, 1, 3);
    if (i % 3 === 0) { g.fillStyle = P.bladeLight; g.fillRect(bx, by, 1, 1); g.fillStyle = P.blade; }
  }
  return c;
}

function dirtPatchTile(): HTMLCanvasElement {
  const c = grassTile(0);
  const g = c.getContext('2d')!;
  g.fillStyle = P.dirtPatch;
  g.fillRect(6, 8, 20, 16);
  g.fillRect(10, 4, 12, 24);
  g.fillStyle = P.dirtMid;
  g.fillRect(10, 10, 12, 10);
  // wheel ruts
  g.fillStyle = P.rutDark;
  g.fillRect(10, 9, 3, 14);
  g.fillRect(19, 9, 3, 14);
  g.fillStyle = P.rutLight;
  g.fillRect(11, 9, 1, 14);
  return c;
}

function waterTile(frame: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  const g = c.getContext('2d')!;
  g.fillStyle = P.water1;
  g.fillRect(0, 0, TILE, TILE);
  // ripple bands
  g.fillStyle = P.water2;
  for (let i = 0; i < 4; i++) {
    const rx = (i * 9 + frame * 5) % 28;
    const ry = 4 + i * 7;
    g.fillRect(rx, ry, 9, 2);
  }
  g.fillStyle = P.water3;
  for (let i = 0; i < 3; i++) {
    const rx = (i * 13 + frame * 3 + 5) % 26;
    const ry = 8 + i * 9;
    g.fillRect(rx, ry, 5, 1);
  }
  // glints
  g.fillStyle = P.waterGlint;
  g.fillRect((6 + frame * 7) % 26, (10 + frame * 5) % 24, 4, 2);
  g.fillStyle = P.waterGlint2;
  g.fillRect((18 + frame * 4) % 28, (3 + frame * 6) % 26, 2, 1);
  return c;
}

/** Big rounded canopy overhanging the tile (40×44, drawn offset by renderer). */
function treeSprite(marked: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 40; c.height = 44;
  const g = c.getContext('2d')!;
  // ground shadow
  g.fillStyle = P.shadow;
  g.fillRect(8, 34, 24, 8);
  // trunk
  g.fillStyle = marked ? '#c25b2e' : P.trunkDark;
  g.fillRect(17, 28, 6, 14);
  g.fillStyle = marked ? '#d06a3a' : P.trunk;
  g.fillRect(18, 28, 4, 14);
  g.fillStyle = marked ? '#e07848' : P.woodLight;
  g.fillRect(19, 28, 2, 10);
  // canopy: deep layered ovals lit from upper-left
  const layers: [number, number, number, number, string][] = [
    [4, 8, 30, 22, P.treeLeafDeep],
    [3, 6, 28, 20, P.treeLeafDark],
    [4, 4, 26, 18, P.treeLeaf],
    [6, 2, 22, 16, P.treeLeaf],
    [8, 1, 18, 13, P.treeLeafLight],
    [10, 1, 10, 7, P.treeLeafLight],
  ];
  for (const [x, y, w, h, col] of layers) {
    g.fillStyle = col;
    g.fillRect(x + 2, y, w - 4, h);
    g.fillRect(x, y + 2, w, h - 4);
    g.fillRect(x + 1, y + 1, w - 2, h - 2);
  }
  // highlight fleck top-left
  g.fillStyle = '#70904a';
  g.fillRect(10, 2, 5, 3);
  g.fillRect(8, 4, 3, 4);
  if (marked) {
    g.fillStyle = '#c25b2e';
    g.fillRect(30, 0, 8, 8);
    g.fillStyle = '#f08040';
    g.fillRect(32, 1, 4, 4);
  }
  return c;
}

function rockSprite(marked: boolean): HTMLCanvasElement {
  const c = grassTile(2);
  const g = c.getContext('2d')!;
  // shadow
  g.fillStyle = P.shadow;
  g.fillRect(4, 22, 26, 8);
  // body layers — rounded boulder shape
  g.fillStyle = P.rockDark;
  g.fillRect(4, 10, 24, 18);
  g.fillRect(7, 7, 18, 22);
  g.fillStyle = P.rock;
  g.fillRect(6, 11, 20, 15);
  g.fillRect(9, 8, 14, 20);
  // light face (upper-left)
  g.fillStyle = P.rockLight;
  g.fillRect(9, 9, 10, 7);
  g.fillRect(7, 13, 6, 6);
  g.fillStyle = P.rockHighlight;
  g.fillRect(10, 9, 5, 3);
  // crack detail
  g.fillStyle = P.rockDark;
  g.fillRect(16, 12, 1, 8);
  g.fillRect(17, 16, 3, 1);
  if (marked) {
    g.fillStyle = '#c25b2e';
    g.fillRect(24, 2, 6, 6);
    g.fillStyle = '#f08040';
    g.fillRect(25, 3, 4, 4);
  }
  return c;
}

function soilTile(stage: 'bare' | 'sown' | 'grown' | 'ripe'): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  const g = c.getContext('2d')!;
  g.fillStyle = P.soil;
  g.fillRect(0, 0, TILE, TILE);
  // plowed furrow rows every 6px, alternating tones
  for (let y = 0; y < TILE; y += 6) {
    g.fillStyle = P.soilDark;
    g.fillRect(0, y, TILE, 3);
    g.fillStyle = P.soilMid;
    g.fillRect(0, y + 1, TILE, 1);
  }
  if (stage !== 'bare') {
    const col = stage === 'sown' ? P.treeLeafDark : stage === 'grown' ? P.crop : P.cropRipe;
    const hgt = stage === 'sown' ? 3 : stage === 'grown' ? 6 : 9;
    g.fillStyle = col;
    for (let y = 4; y < TILE; y += 6) {
      for (let x = 3; x < TILE - 2; x += 7) {
        g.fillRect(x, y - hgt + 3, 3, hgt);
        if (stage === 'ripe') {
          g.fillStyle = P.grain;
          g.fillRect(x, y - hgt + 2, 3, 2);
          g.fillRect(x - 1, y - hgt + 3, 1, 1);
          g.fillRect(x + 3, y - hgt + 3, 1, 1);
          g.fillStyle = col;
        }
      }
    }
  }
  return c;
}

function roadTile(kind: string, plan: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  const g = c.getContext('2d')!;
  switch (kind) {
    case 'dirt': {
      g.fillStyle = P.rutBrown;
      g.fillRect(0, 0, TILE, TILE);
      // soft shoulder shading
      g.fillStyle = P.rutLight;
      g.fillRect(0, 0, 3, TILE);
      g.fillRect(TILE - 3, 0, 3, TILE);
      // ruts
      g.fillStyle = P.rutDark;
      g.fillRect(5, 0, 4, TILE);
      g.fillRect(23, 0, 4, TILE);
      g.fillStyle = P.rutBrown;
      g.fillRect(6, 0, 2, TILE);
      g.fillRect(24, 0, 2, TILE);
      // stone pebbles
      g.fillStyle = P.gravelC;
      for (let i = 0; i < 5; i++) {
        g.fillRect((i * 7) % 28, (i * 11 + 3) % 28, 2, 1);
      }
      break;
    }
    case 'plank': {
      g.fillStyle = P.plank;
      g.fillRect(0, 0, TILE, TILE);
      // plank boards — horizontal seams every 8px
      g.fillStyle = P.plankDark;
      for (let y = 0; y < TILE; y += 8) g.fillRect(0, y, TILE, 1);
      // center gap between left/right boards
      g.fillRect(15, 0, 2, TILE);
      // grain lines
      g.fillStyle = P.plankLight;
      for (let y = 2; y < TILE; y += 8) g.fillRect(1, y, TILE - 2, 1);
      break;
    }
    case 'gravel': {
      g.fillStyle = P.gravelB;
      g.fillRect(0, 0, TILE, TILE);
      // dense random pebble pattern
      g.fillStyle = P.gravelA;
      for (let i = 0; i < 28; i++) {
        g.fillRect((i * 7) % 30, (i * 11) % 30, 2 + (i % 3 === 0 ? 1 : 0), 1);
      }
      g.fillStyle = P.gravelC;
      for (let i = 0; i < 14; i++) {
        g.fillRect((i * 13 + 3) % 30, (i * 7 + 5) % 30, 1, 2);
      }
      break;
    }
    case 'bridge': {
      g.fillStyle = P.plank;
      g.fillRect(0, 2, TILE, TILE - 4);
      // vertical plank boards
      g.fillStyle = P.plankDark;
      for (let x = 0; x < TILE; x += 6) g.fillRect(x, 2, 1, TILE - 4);
      // grain highlights
      g.fillStyle = P.plankLight;
      for (let x = 2; x < TILE; x += 6) g.fillRect(x, 3, 1, TILE - 6);
      // side rails
      g.fillStyle = P.woodDark;
      g.fillRect(0, 0, TILE, 3);
      g.fillRect(0, TILE - 3, TILE, 3);
      g.fillStyle = P.wood;
      g.fillRect(0, 0, TILE, 1);
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

/**
 * Capsule pawn at 32×32, RimWorld-ish: large round head, stubby torso,
 * 2-frame walk bob, drop shadow below feet.
 */
function pawnSprite(cloth: string, clothDk: string, frame: number, skin: string, skinShad: string, hair: string, armed = false): HTMLCanvasElement {
  // 32-row grid, each char = 1px
  const lL = frame === 0 ? 'LL..' : '..LL';
  const lR = frame === 0 ? '..RR' : 'RR..';
  const a1 = armed ? 'W' : '.';
  const a2 = armed ? 'W' : '.';
  const rows = [
    '................................',
    '................................',
    '..........OOOOOOOO..............',
    '.........OOOOOOOOOO.............',
    '.........OHHHHHHHHO.............',
    '.........OHHHHHHHHO.............',
    '.........OFFFFFFF HO............',
    '.........OFFFFFFF HO............',
    '.........OFFFFFFF HO............',
    '..........OFFFFFFO..............',
    '..........OFFFFFFO..............',
    `........${a1}OOCCCCCCOO${a2}..........`,
    `........${a1}OCCCCCCCCO${a2}..........`,
    `........${a1}OCCCCCCCCO${a2}..........`,
    `........${a1}OCCCCCCCCO${a2}..........`,
    `........${a1}OOCCCCCCOO${a2}..........`,
    `..........OOCCCCOO..............`,
    `..........O${lL}${lR}O..............`,
    `..........O${lL}${lR}O..............`,
    `..........O${lL}${lR}O..............`,
    '..........SSSSSSSS..............',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
  ];
  return sheet(grid(rows, {
    O: P.outline,
    F: skin,
    H: hair,
    ' ': skinShad,
    C: cloth,
    L: clothDk,
    R: clothDk,
    W: '#b8b4ac',
    S: 'rgba(20,16,10,0.3)',
  }));
}

function buildingSprite(defId: string, w: number, h: number, ghost: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w * TILE + 4;
  c.height = h * TILE + 4;
  const g = c.getContext('2d')!;
  const W = w * TILE;
  const H = h * TILE;
  g.globalAlpha = ghost ? 0.5 : 1;

  if (!ghost) {
    g.fillStyle = P.shadow;
    g.fillRect(4, 4, W, H);
  }

  const gW  = ghost ? '#7a93ab' : null;
  const gWd = ghost ? '#5d7690' : null;
  const gR  = ghost ? '#8aa3bb' : null;
  const gRl = ghost ? '#9ab3c8' : null;

  g.fillStyle = P.outline;
  g.fillRect(0, 0, W, H);

  if (defId === 'palisade') {
    g.fillStyle = gWd ?? P.woodDark;
    g.fillRect(1, 1, W - 2, H - 2);
    g.fillStyle = gW ?? P.wood;
    for (let x = 2; x < W - 2; x += 6) g.fillRect(x, 2, 4, H - 4);
    // pointed tops
    g.fillStyle = P.outline;
    for (let x = 3; x < W - 2; x += 6) g.fillRect(x + 1, 1, 1, 1);
    // binding rails
    g.fillStyle = gWd ?? P.trunk;
    g.fillRect(1, Math.floor(H * 0.30), W - 2, 3);
    g.fillRect(1, Math.floor(H * 0.62), W - 2, 3);
    // grain on stakes
    if (!ghost) {
      g.fillStyle = P.woodLight;
      for (let x = 3; x < W - 2; x += 6) g.fillRect(x, 3, 1, H - 6);
    }

  } else if (defId === 'stockpile') {
    g.fillStyle = P.floor;
    g.fillRect(1, 1, W - 2, H - 2);
    g.fillStyle = gWd ?? P.woodDark;
    g.fillRect(1, 1, W - 2, 3); g.fillRect(1, H - 4, W - 2, 3);
    g.fillRect(1, 1, 3, H - 2); g.fillRect(W - 4, 1, 3, H - 2);
    // floor planks
    if (!ghost) {
      g.fillStyle = P.plankDark;
      for (let y = 8; y < H - 4; y += 8) g.fillRect(4, y, W - 8, 1);
    }
    // crates
    const cw2 = Math.floor((W - 12) / 2);
    for (let ci = 0; ci < 2; ci++) {
      const cx = 5 + ci * (cw2 + 2);
      g.fillStyle = gW ?? P.wood;
      g.fillRect(cx, 4, cw2, 12);
      g.fillStyle = gWd ?? P.woodDark;
      g.fillRect(cx, 4, cw2, 2);
      g.fillRect(cx + Math.floor(cw2 / 2), 4, 2, 12);
      if (!ghost) {
        g.fillStyle = P.woodLight;
        g.fillRect(cx + 1, 5, 2, 2);
      }
    }
    // grain sack
    g.fillStyle = gRl ?? P.grain;
    g.fillRect(5, 18, W - 10, H - 22);
    g.fillStyle = gR ?? '#b89030';
    g.fillRect(6, 18, W - 12, 2);

  } else if (defId === 'farm') {
    g.fillStyle = P.soil;
    g.fillRect(1, 1, W - 2, H - 2);
    for (let y = 3; y < H - 1; y += 7) {
      g.fillStyle = P.soilDark;
      g.fillRect(1, y, W - 2, 3);
      g.fillStyle = P.soilMid;
      g.fillRect(1, y + 1, W - 2, 1);
    }
    if (!ghost) {
      g.fillStyle = P.crop;
      for (let y = 6; y < H - 2; y += 7)
        for (let x = 4; x < W - 3; x += 7) g.fillRect(x, y - 2, 4, 5);
    }

  } else if (defId === 'hearth') {
    g.fillStyle = P.grassB;
    g.fillRect(1, 1, W - 2, H - 2);
    g.fillStyle = P.shadow;
    g.fillRect(5, 22, W - 10, 6);
    g.fillStyle = gWd ?? P.rockDark;
    g.fillRect(5, 5, W - 10, H - 10);
    g.fillStyle = gW ?? P.rock;
    for (const [rx, ry, rw, rh] of [[5,5,5,5],[W-10,5,5,5],[5,H-10,5,5],[W-10,H-10,5,5]] as number[][]) {
      g.fillRect(rx, ry, rw, rh);
    }
    g.fillStyle = P.rockLight;
    for (const [rx, ry] of [[5,5],[W-10,5]] as number[][]) g.fillRect(rx, ry, 5, 2);
    g.fillStyle = '#1e1810';
    g.fillRect(10, 10, W - 20, H - 20);
    if (!ghost) {
      g.fillStyle = '#c25b2e'; g.fillRect(12, 12, 7, 9);
      g.fillStyle = '#e8a44a'; g.fillRect(13, 11, 5, 7);
      g.fillStyle = '#f0d060'; g.fillRect(14, 13, 3, 4);
    }

  } else if (defId === 'graveyard') {
    g.fillStyle = P.grassC;
    g.fillRect(1, 1, W - 2, H - 2);
    g.fillStyle = P.soilDark;
    g.fillRect(6, 6, W - 12, H - 12);
    // fence rails
    g.fillStyle = gRl ?? '#b0a890';
    g.fillRect(1, 4, W - 2, 2);
    g.fillRect(1, H - 6, W - 2, 2);
    g.fillRect(1, 4, 2, H - 8);
    g.fillRect(W - 3, 4, 2, H - 8);
    // posts
    g.fillStyle = gW ?? '#8a806a';
    for (let x = 1; x < W - 1; x += 7) {
      g.fillRect(x, 1, 3, 6);
      g.fillRect(x, H - 7, 3, 6);
    }
    for (let y = 6; y < H - 6; y += 7) {
      g.fillRect(1, y, 4, 2);
      g.fillRect(W - 5, y, 4, 2);
    }
    if (!ghost) {
      g.fillStyle = P.rock;
      for (let ci = 0; ci < w; ci++) {
        for (let ri = 0; ri < h; ri++) {
          const sx = 9 + ci * Math.floor((W - 18) / Math.max(1, w));
          const sy = 9 + ri * Math.floor((H - 18) / Math.max(1, h));
          if (sx + 7 < W - 6 && sy + 9 < H - 6) {
            g.fillRect(sx, sy, 7, 9);
            g.fillStyle = P.rockLight; g.fillRect(sx, sy, 7, 2);
            g.fillStyle = P.rockDark; g.fillRect(sx, sy + 7, 7, 2);
            g.fillStyle = P.rock;
          }
        }
      }
    }

  } else if (defId === 'fishing_dock') {
    g.fillStyle = P.water1;
    g.fillRect(1, H - 10, W - 2, 9);
    g.fillStyle = P.water2;
    g.fillRect(4, H - 8, 6, 4); g.fillRect(W - 10, H - 8, 6, 4);
    g.fillStyle = gW ?? P.plank;
    g.fillRect(1, 1, W - 2, H - 10);
    g.fillStyle = gWd ?? P.plankDark;
    for (let x = 4; x < W - 2; x += 8) g.fillRect(x, 1, 1, H - 10);
    g.fillRect(1, H - 11, W - 2, 2);
    if (!ghost) {
      g.fillStyle = P.plankLight;
      for (let x = 5; x < W - 2; x += 8) g.fillRect(x, 2, 1, H - 12);
    }
    g.fillStyle = gWd ?? P.woodDark;
    g.fillRect(1, 1, W - 2, 2);
    g.fillStyle = gR ?? P.trunk;
    g.fillRect(2, H - 10, 4, 9); g.fillRect(W - 6, H - 10, 4, 9);

  } else if (defId === 'well') {
    g.fillStyle = P.grassB;
    g.fillRect(1, 1, W - 2, H - 2);
    g.fillStyle = P.shadow;
    g.fillRect(5, 20, 18, 6);
    g.fillStyle = gWd ?? P.rockDark;
    g.fillRect(5, 12, 18, 12);
    g.fillStyle = gW ?? P.rock;
    g.fillRect(7, 13, 14, 9);
    g.fillStyle = P.rockLight;
    g.fillRect(8, 13, 8, 4);
    g.fillStyle = '#14100c';
    g.fillRect(11, 15, 6, 6);
    g.fillStyle = gWd ?? P.woodDark;
    g.fillRect(5, 3, 4, 10); g.fillRect(19, 3, 4, 10);
    g.fillStyle = gW ?? P.wood;
    g.fillRect(3, 1, 22, 4);
    g.fillStyle = P.woodLight;
    g.fillRect(4, 1, 20, 2);
    if (!ghost) {
      g.fillStyle = P.grain;
      g.fillRect(13, 4, 2, 10); // rope
      g.fillStyle = P.woodDark;
      g.fillRect(11, 14, 6, 3); // bucket
      g.fillStyle = P.water2;
      g.fillRect(12, 15, 4, 1);
    }

  } else if (defId === 'watchtower') {
    g.fillStyle = P.grassB;
    g.fillRect(1, 1, W - 2, H - 2);
    g.fillStyle = P.shadow;
    g.fillRect(6, H - 6, W - 12, 5);
    // legs
    g.fillStyle = gWd ?? P.woodDark;
    g.fillRect(8, 22, 5, H - 24);
    g.fillRect(W - 13, 22, 5, H - 24);
    // cross-brace
    if (!ghost) {
      g.fillStyle = P.trunk;
      for (let i = 0; i < W - 22; i++) {
        const yy = 23 + Math.floor((i * (H - 32)) / (W - 22));
        g.fillRect(13 + i, yy, 1, 2);
        g.fillRect(W - 14 - i, yy, 1, 2);
      }
    }
    // platform
    g.fillStyle = gW ?? P.plank;
    g.fillRect(3, 18, W - 6, 5);
    g.fillStyle = gWd ?? P.plankDark;
    g.fillRect(3, 21, W - 6, 2);
    // cabin
    g.fillStyle = gW ?? P.wood;
    g.fillRect(8, 5, W - 16, 13);
    g.fillStyle = gWd ?? P.woodDark;
    g.fillRect(8, 5, W - 16, 2);
    g.fillRect(8, 5, 2, 13);
    // window slit
    g.fillStyle = '#1a1208';
    g.fillRect(Math.floor(W / 2) - 5, 8, 10, 6);
    if (!ghost) {
      g.fillStyle = P.winAmber;
      g.fillRect(Math.floor(W / 2) - 4, 9, 8, 4);
    }
    g.fillStyle = gWd ?? P.trunk;
    g.fillRect(5, 1, W - 10, 4);

  } else if (defId === 'mill') {
    g.fillStyle = P.grassB;
    g.fillRect(1, 1, W - 2, H - 2);
    g.fillStyle = P.shadow;
    g.fillRect(8, H - 6, W - 14, 5);
    // tower body
    g.fillStyle = gW ?? P.wallCream;
    g.fillRect(13, 22, W - 26, H - 23);
    g.fillRect(14, 18, W - 28, 5);
    g.fillStyle = gWd ?? P.wallCreamDk;
    g.fillRect(13, 22, 3, H - 23);
    if (!ghost) {
      for (let y = 26; y < H - 2; y += 7) g.fillRect(14, y, W - 28, 2);
    }
    // roof cap
    g.fillStyle = gWd ?? P.roofWood;
    g.fillRect(11, 12, W - 22, 7);
    g.fillStyle = P.outline;
    g.fillRect(Math.floor(W / 2) - 4, H - 14, 8, 13);
    g.fillStyle = gWd ?? P.wallDark;
    g.fillRect(Math.floor(W / 2) - 3, H - 12, 6, 11);
    if (!ghost) {
      g.fillStyle = P.winGold;
      g.fillRect(Math.floor(W / 2) - 2, H - 10, 4, 4);
    }
    // sails — X-shaped arms from hub
    const hubX = Math.floor(W / 2), hubY = 16;
    g.fillStyle = gRl ?? '#d8d0b8';
    for (let i = 2; i <= 14; i++) {
      g.fillRect(hubX - 1 - i, hubY - 1 - i, 3, 3);
      g.fillRect(hubX + i - 1, hubY - 1 - i, 3, 3);
      g.fillRect(hubX - 1 - i, hubY + i - 1, 3, 3);
      g.fillRect(hubX + i - 1, hubY + i - 1, 3, 3);
    }
    g.fillStyle = gWd ?? P.trunk;
    g.fillRect(hubX - 3, hubY - 3, 6, 6);

  } else if (defId === 'sawmill') {
    g.fillStyle = P.floor;
    g.fillRect(1, 1, W - 2, H - 2);
    g.fillStyle = gWd ?? P.plankDark;
    for (let y = 18; y < H - 1; y += 8) g.fillRect(1, y, W - 2, 2);
    g.fillStyle = gWd ?? P.woodDark;
    g.fillRect(2, 16, 5, H - 18); g.fillRect(W - 7, 16, 5, H - 18);
    g.fillStyle = gR ?? P.roofWood;
    g.fillRect(1, 1, W - 2, 15);
    g.fillStyle = gRl ?? P.roofLight;
    g.fillRect(1, 5, W - 2, 3); g.fillRect(1, 11, W - 2, 3);
    if (!ghost) {
      g.fillStyle = P.woodDark;
      g.fillRect(10, 32, W - 20, 6);
      const sx = Math.floor(W / 2), sy = 28, r = 7;
      g.fillStyle = P.rockLight;
      for (let dy = -r; dy <= r; dy++) {
        const w2 = Math.floor(Math.sqrt(r * r - dy * dy));
        g.fillRect(sx - w2, sy + dy, w2 * 2 + 1, 1);
      }
      g.fillStyle = P.rockDark;
      g.fillRect(sx - 2, sy - 2, 4, 4);
      // teeth
      g.fillStyle = P.rockLight;
      for (let a = 0; a < 8; a++) {
        const ax = Math.round(sx + Math.cos(a * Math.PI / 4) * r);
        const ay = Math.round(sy + Math.sin(a * Math.PI / 4) * r);
        g.fillRect(ax - 1, ay - 1, 2, 2);
      }
      g.fillStyle = P.trunk;
      g.fillRect(7, H - 18, W - 14, 6);
      g.fillRect(10, H - 24, W - 20, 6);
      g.fillStyle = P.wood;
      g.fillRect(7, H - 17, 3, 3); g.fillRect(W - 10, H - 17, 3, 3);
      g.fillRect(10, H - 23, 3, 3); g.fillRect(W - 13, H - 23, 3, 3);
    }

  } else if (defId === 'mine') {
    g.fillStyle = P.grassC;
    g.fillRect(1, 1, W - 2, H - 2);
    g.fillStyle = gWd ?? P.rockDark;
    g.fillRect(4, 12, W - 8, H - 14);
    g.fillRect(9, 7, W - 18, 6);
    g.fillStyle = gW ?? P.rock;
    g.fillRect(6, 13, W - 12, H - 18);
    g.fillRect(11, 8, W - 22, 6);
    g.fillStyle = P.rockLight;
    g.fillRect(12, 9, 9, 3);
    g.fillRect(9, 16, 6, 3);
    // timber frame
    g.fillStyle = gWd ?? P.woodDark;
    g.fillRect(14, 22, 5, H - 24);
    g.fillRect(W - 19, 22, 5, H - 24);
    g.fillRect(12, 18, W - 24, 5);
    // dark shaft
    g.fillStyle = '#0e0c08';
    g.fillRect(19, 23, W - 38, H - 25);
    if (!ghost) {
      g.fillStyle = P.grain;
      g.fillRect(9, 28, 3, 2);
      g.fillRect(W - 11, 14, 3, 2);
    }

  } else if (defId === 'kiln') {
    g.fillStyle = P.grassC;
    g.fillRect(1, 1, W - 2, H - 2);
    g.fillStyle = P.shadow;
    g.fillRect(6, H - 8, W - 12, 7);
    g.fillStyle = gWd ?? P.wallBrickDk;
    g.fillRect(5, 14, W - 10, H - 16);
    g.fillRect(10, 8, W - 20, 7);
    g.fillRect(15, 4, W - 30, 5);
    g.fillStyle = gW ?? P.wallBrick;
    g.fillRect(7, 15, W - 14, H - 20);
    g.fillRect(12, 9, W - 24, 6);
    g.fillStyle = P.wallBrickMid;
    if (!ghost) {
      for (let y = 17; y < H - 5; y += 5) g.fillRect(8, y, W - 16, 2);
    }
    // vent
    g.fillStyle = gWd ?? P.rockDark;
    g.fillRect(Math.floor(W / 2) - 3, 2, 6, 3);
    // mouth
    g.fillStyle = '#140e08';
    g.fillRect(Math.floor(W / 2) - 6, H - 14, 12, 12);
    if (!ghost) {
      g.fillStyle = P.winOrange;
      g.fillRect(Math.floor(W / 2) - 5, H - 10, 10, 6);
      g.fillStyle = '#f0d060';
      g.fillRect(Math.floor(W / 2) - 2, H - 7, 4, 4);
    }

  } else if (defId === 'animal_pen') {
    g.fillStyle = P.grassA;
    g.fillRect(1, 1, W - 2, H - 2);
    g.fillStyle = P.grassB;
    g.fillRect(12, 18, 20, 14); g.fillRect(W - 32, H - 30, 20, 15);
    g.fillStyle = P.dirtPatch;
    g.fillRect(Math.floor(W / 2) - 7, H - 16, 14, 12);
    // fence rails
    g.fillStyle = gRl ?? '#b0a890';
    g.fillRect(1, 4, W - 2, 2); g.fillRect(1, 8, W - 2, 2);
    g.fillRect(1, H - 11, W - 2, 2); g.fillRect(1, H - 6, W - 2, 2);
    g.fillRect(2, 4, 2, H - 8); g.fillRect(W - 4, 4, 2, H - 8);
    // posts
    g.fillStyle = gW ?? '#8a806a';
    for (let x = 1; x < W - 2; x += 9) {
      g.fillRect(x, 1, 3, 11);
      g.fillRect(x, H - 12, 3, 11);
    }
    for (let y = 10; y < H - 12; y += 9) {
      g.fillRect(1, y, 3, 3); g.fillRect(W - 4, y, 3, 3);
    }
    if (!ghost) {
      // trough
      g.fillStyle = P.woodDark; g.fillRect(9, H - 22, 18, 8);
      g.fillStyle = P.water2;   g.fillRect(10, H - 21, 16, 5);
      g.fillStyle = P.waterGlint; g.fillRect(11, H - 20, 6, 2);
      // hay
      g.fillStyle = P.cropRipe; g.fillRect(W - 22, 12, 13, 9);
      g.fillStyle = P.grain;    g.fillRect(W - 20, 11, 9, 3);
      // beasts
      const beast2 = (sx: number, sy: number, body: string, head: string) => {
        g.fillStyle = P.shadow;  g.fillRect(sx, sy + 8, 14, 3);
        g.fillStyle = body;      g.fillRect(sx, sy, 12, 7);
        g.fillStyle = head;      g.fillRect(sx + 10, sy + 1, 4, 5);
        g.fillStyle = P.outline;
        g.fillRect(sx + 2, sy + 7, 2, 3);
        g.fillRect(sx + 9, sy + 7, 2, 3);
      };
      beast2(16, 26, '#ddd6c6', '#8a8074');
      beast2(W - 28, H - 28, '#b89868', '#7a6040');
    }

  } else if (defId === 'kitchen_garden') {
    g.fillStyle = P.grassB;
    g.fillRect(1, 1, W - 2, H - 2);
    for (const by of [3, Math.floor(H / 2) + 2]) {
      g.fillStyle = gWd ?? P.plankDark;
      g.fillRect(4, by, W - 8, Math.floor(H / 2) - 4);
      g.fillStyle = P.soil;
      g.fillRect(5, by + 2, W - 10, Math.floor(H / 2) - 7);
      g.fillStyle = P.soilDark;
      g.fillRect(5, by + Math.floor((Math.floor(H / 2) - 7) / 2) + 1, W - 10, 2);
      if (!ghost) {
        for (let x = 7; x < W - 7; x += 6) {
          g.fillStyle = P.crop;
          g.fillRect(x, by + 3, 3, 4);
          g.fillStyle = x % 12 === 7 ? '#c25b2e' : P.crop;
          g.fillRect(x, by + Math.floor((Math.floor(H / 2) - 7) / 2) + 3, 3, 4);
        }
      }
    }

  } else if (defId === 'herb_garden') {
    g.fillStyle = P.grassB;
    g.fillRect(1, 1, W - 2, H - 2);
    g.fillStyle = P.gravelB;
    g.fillRect(Math.floor(W / 2) - 3, 1, 6, H - 2);
    for (const bx of [3, Math.floor(W / 2) + 4]) {
      g.fillStyle = P.soil;
      g.fillRect(bx, 4, Math.floor(W / 2) - 8, H - 8);
      if (!ghost) {
        for (let y = 7; y < H - 6; y += 6) {
          g.fillStyle = '#4a7040';
          g.fillRect(bx + 3, y, 3, 3);
          g.fillRect(bx + 9, y + 2, 3, 3);
          g.fillStyle = y % 12 === 7 ? '#b8a0d0' : '#e8e0c0';
          g.fillRect(bx + 8, y, 2, 2);
        }
      }
    }

  } else {
    // Residential/workshop buildings: roof at top, wall+door below.
    const roofH = Math.floor(H * 0.55);

    let roofBase = gR  ?? P.roofWood;
    let roofHigh = gRl ?? P.roofLight;
    let wallBase  = gW  ?? P.wall;
    let wallDk    = gWd ?? P.wallDark;
    let winColor: string | null = null;
    let rightChimney = false;
    let leftChimney  = false;
    let special: string | null = null;
    let halfTimbered = false;
    let brickWall = false;

    if (!ghost) {
      switch (defId) {
        case 'house':
          roofBase = P.roofRed; roofHigh = P.roofRedLt;
          wallBase = '#d4c8a8'; wallDk = '#2e1e0c';
          winColor = P.winGold; halfTimbered = true; rightChimney = true; break;
        case 'kitchen':
          roofBase = '#4a3a2a'; roofHigh = '#6a5238';
          wallBase = P.wallBrick; wallDk = P.wallBrickDk;
          winColor = P.winOrange; brickWall = true; rightChimney = true; break;
        case 'hall':
          roofBase = '#5c3e28'; roofHigh = '#7c5840';
          wallBase = '#d4c8a8'; wallDk = '#2e1e0c';
          winColor = P.winGold; halfTimbered = true; break;
        case 'tailor':
          roofBase = P.roofSlate; roofHigh = P.roofSlateLt;
          wallBase = '#8a8878'; wallDk = '#6a6858';
          winColor = P.winBlue; break;
        case 'bakery':
          roofBase = '#6a3c2a'; roofHigh = '#8a5840';
          wallBase = P.wallBrick; wallDk = P.wallBrickDk;
          winColor = P.winOrange; brickWall = true;
          leftChimney = true; rightChimney = true; break;
        case 'lodge':
          roofBase = '#3c3428'; roofHigh = '#5a4c38';
          wallBase = '#7a6040'; wallDk = '#5a4428';
          winColor = P.winAmber; break;
        case 'market':
          roofBase = P.roofTerra; roofHigh = P.roofTerraLt;
          wallBase = '#b8a478'; wallDk = '#9a8660';
          special = 'market'; break;
        case 'forester':
          roofBase = P.roofForest; roofHigh = P.roofForestLt;
          wallBase = '#8a7a54'; wallDk = '#6a5c3c';
          winColor = P.winGreen; break;
        case 'granary':
          roofBase = P.roofThatch; roofHigh = P.roofThatchLt;
          wallBase = '#c0a870'; wallDk = '#a08850';
          special = 'granary'; break;
        case 'clinic':
          roofBase = '#3c4c5e'; roofHigh = '#5c6c7e';
          wallBase = P.wallCream; wallDk = P.wallCreamDk;
          winColor = P.winBlue; special = 'clinic'; break;
        case 'cottage':
          roofBase = P.roofThatch; roofHigh = P.roofThatchLt;
          wallBase = '#d4c8a8'; wallDk = '#8a7a5c';
          winColor = P.winGold; rightChimney = true; break;
        case 'barracks':
          roofBase = '#4a4438'; roofHigh = '#66604c';
          wallBase = '#6a5236'; wallDk = '#4e3a24';
          winColor = P.winAmber; break;
        case 'longhouse':
          roofBase = P.roofThatch; roofHigh = P.roofThatchLt;
          wallBase = '#7a6040'; wallDk = '#5a4428';
          winColor = P.winAmber; special = 'longhouse'; break;
        case 'town_hall':
          roofBase = P.roofSlate; roofHigh = P.roofSlateLt;
          wallBase = P.wallCream; wallDk = P.wallCreamDk;
          winColor = P.winGold; special = 'townhall'; break;
        case 'armory':
          roofBase = '#3c3c44'; roofHigh = '#5a5a64';
          wallBase = '#8a8878'; wallDk = '#6a6858';
          special = 'armory'; break;
        case 'warehouse':
          roofBase = '#5a4a34'; roofHigh = '#7a6648';
          wallBase = P.plank; wallDk = P.plankDark;
          special = 'warehouse'; break;
        case 'apothecary':
          roofBase = '#4c5e3c'; roofHigh = '#6c7e58';
          wallBase = P.wallCream; wallDk = P.wallCreamDk;
          winColor = P.winGreen; special = 'apothecary'; break;
        case 'blacksmith':
          roofBase = '#33302c'; roofHigh = '#4e4a44';
          wallBase = '#5e5a50'; wallDk = '#4a463e';
          special = 'forge'; rightChimney = true; break;
        case 'schoolhouse':
          roofBase = P.roofRed; roofHigh = P.roofRedLt;
          wallBase = '#a85040'; wallDk = '#7a3a2e';
          winColor = P.winGold; special = 'school'; break;
        case 'brewery':
          roofBase = '#6a5228'; roofHigh = '#8a7038';
          wallBase = P.wallBrick; wallDk = P.wallBrickDk;
          winColor = P.winOrange; brickWall = true; special = 'brewery'; break;
      }
    }

    // Wall
    g.fillStyle = wallBase;
    g.fillRect(1, roofH, W - 2, H - roofH - 1);

    // Brick coursing every 4px
    if (brickWall && !ghost) {
      g.fillStyle = '#5a3a28';
      for (let y = roofH + 4; y < H - 2; y += 4) g.fillRect(2, y, W - 4, 1);
    }

    // Half-timber frame
    if (halfTimbered && !ghost) {
      const wallH2 = H - roofH - 1;
      g.fillStyle = wallDk;
      g.fillRect(1, roofH, 3, wallH2);
      g.fillRect(W - 4, roofH, 3, wallH2);
      g.fillRect(1, roofH, W - 2, 3);
      g.fillRect(1, H - 5, W - 2, 3);
      if (wallH2 >= 14) g.fillRect(3, roofH + Math.floor(wallH2 / 2), W - 6, 2);
      const bLen = Math.min(8, Math.floor(wallH2 / 3));
      for (let i = 0; i < bLen; i++) {
        g.fillRect(4 + i, roofH + 3 + i, 1, 1);
        g.fillRect(W - 5 - i, roofH + 3 + i, 1, 1);
      }
    } else {
      g.fillStyle = wallDk;
      g.fillRect(1, roofH, W - 2, 3);
    }

    // Stone foundation strip
    if (!ghost) {
      g.fillStyle = P.rockDark;
      g.fillRect(1, H - 4, W - 2, 3);
    }

    // Door
    const wideDoor = ['hall','town_hall','longhouse','warehouse','barracks'].includes(defId);
    const dw2 = wideDoor ? 12 : 8;
    const dh2 = Math.min(14, H - roofH - 5);
    const dx2 = Math.floor(W / 2) - Math.floor(dw2 / 2);
    g.fillStyle = P.outline;
    g.fillRect(dx2, H - dh2 - 2, dw2, dh2 + 2);
    g.fillStyle = wallDk;
    g.fillRect(dx2 + 1, H - dh2 - 1, dw2 - 2, dh2 + 1);
    if (!ghost) {
      // door grain
      g.fillStyle = P.plank;
      g.fillRect(dx2 + 1, H - dh2, dw2 - 2, dh2);
      g.fillStyle = P.plankDark;
      for (let y = H - dh2 + 2; y < H - 2; y += 4) g.fillRect(dx2 + 1, y, dw2 - 2, 1);
      g.fillStyle = P.grain;
      g.fillRect(dx2 + dw2 - 3, H - Math.floor(dh2 * 0.5) - 1, 2, 2);
    }

    // Windows with cross-mullion
    if (winColor) {
      const wh2 = Math.min(7, H - roofH - dh2 - 6);
      const wy2 = roofH + 4;
      if (wh2 >= 4) {
        const positions: number[] = [];
        if (dx2 >= 12) positions.push(4);
        if (W - dx2 - dw2 >= 12) positions.push(W - 12);
        if (W >= 70 && dx2 >= 22) positions.push(dx2 - 14);
        if (W >= 70 && W - dx2 - dw2 >= 22) positions.push(dx2 + dw2 + 4);
        for (const wx2 of positions) {
          if (wx2 >= 2 && wx2 + 8 <= W - 2) {
            g.fillStyle = P.outline;
            g.fillRect(wx2, wy2, 8, wh2 + 2);
            g.fillStyle = winColor;
            g.fillRect(wx2 + 1, wy2 + 1, 6, wh2);
            if (!ghost && wh2 >= 5) {
              g.fillStyle = P.outline;
              g.fillRect(wx2 + 3, wy2 + 1, 2, wh2);
              g.fillRect(wx2 + 1, wy2 + 1 + Math.floor(wh2 / 2), 6, 1);
              // pane highlights
              g.fillStyle = '#ffffff18';
              g.fillRect(wx2 + 1, wy2 + 1, 2, 2);
              g.fillRect(wx2 + 5, wy2 + 1, 1, 2);
            }
          }
        }
      }
    }

    // Roof: shingle courses
    g.fillStyle = roofBase;
    g.fillRect(1, 1, W - 2, roofH);
    g.fillStyle = '#20180e';
    g.fillRect(1, 1, W - 2, 3); // dark ridge cap
    for (let y = 4; y < roofH - 3; y += 4) {
      g.fillStyle = (Math.floor((y - 4) / 4) % 2 === 0) ? roofHigh : roofBase;
      g.fillRect(1, y, W - 2, 3);
    }
    // subtle perspective: left edge slightly darker
    if (!ghost) {
      g.fillStyle = 'rgba(0,0,0,0.1)';
      g.fillRect(1, 1, 3, roofH);
    }
    g.fillStyle = '#20180e';
    g.fillRect(1, roofH - 3, W - 2, 3); // eave shadow

    // Chimneys
    const drawChimney = (cx: number) => {
      g.fillStyle = P.rockDark;
      g.fillRect(cx - 2, 1, 10, 3); // wide cap
      g.fillRect(cx, 4, 6, roofH - 6); // shaft
      g.fillStyle = P.rock;
      g.fillRect(cx + 1, 4, 4, roofH - 6);
      g.fillStyle = P.rockLight;
      g.fillRect(cx - 2, 1, 10, 2); // cap highlight
      g.fillStyle = '#1a1208';
      g.fillRect(cx + 1, 1, 4, 3); // blackened opening
    };
    if (rightChimney) drawChimney(W - 14);
    if (leftChimney)  drawChimney(4);

    // Specials
    if (special === 'market' && !ghost) {
      for (let x = 1; x < W - 1; x += 6) {
        g.fillStyle = P.awningRed;   g.fillRect(x, roofH, 3, 5);
        g.fillStyle = P.awningCream; g.fillRect(x + 3, roofH, 3, 5);
      }
    } else if (special === 'granary') {
      g.fillStyle = '#8a6010';
      for (let y = 6; y < roofH - 4; y += 6) g.fillRect(2, y + 2, W - 4, 2);
    } else if (special === 'clinic' && !ghost) {
      const cx2 = Math.floor(W / 2);
      const cy2 = roofH + Math.floor((H - roofH) / 2);
      g.fillStyle = '#cc3333';
      g.fillRect(cx2 - 2, cy2 - 5, 4, 10);
      g.fillRect(cx2 - 5, cy2 - 2, 10, 4);
    } else if (special === 'townhall' && !ghost) {
      const cx2 = Math.floor(W / 2);
      g.fillStyle = P.rockLight;
      g.fillRect(cx2, 1, 2, 8);
      g.fillStyle = P.awningRed;
      g.fillRect(cx2 + 2, 1, 8, 5);
      g.fillStyle = P.grain;
      g.fillRect(dx2 - 2, H - dh2 - 4, dw2 + 4, 2);
    } else if (special === 'armory' && !ghost) {
      const ax2 = Math.floor(W / 2) - 5;
      const ay2 = roofH + 4;
      g.fillStyle = P.rockLight;
      g.fillRect(ax2, ay2, 10, 8);
      g.fillStyle = P.awningRed;
      g.fillRect(ax2 + 1, ay2 + 1, 8, 5);
      g.fillRect(ax2 + 3, ay2 + 6, 4, 2);
    } else if (special === 'warehouse' && !ghost) {
      g.fillStyle = P.outline;
      g.fillRect(dx2 + Math.floor(dw2 / 2), H - dh2 - 1, 2, dh2 + 1);
      g.fillStyle = P.rockLight;
      g.fillRect(dx2 + 1, H - dh2 + 2, dw2 - 2, 2);
      g.fillStyle = P.wood;
      g.fillRect(4, H - 11, 10, 10);
      g.fillStyle = P.woodDark;
      g.fillRect(4, H - 11, 10, 2); g.fillRect(8, H - 11, 2, 10);
    } else if (special === 'apothecary' && !ghost) {
      g.fillStyle = '#3c8a4c';
      g.fillRect(5, roofH + 4, 4, 10);
      g.fillRect(2, roofH + 7, 10, 4);
    } else if (special === 'forge' && !ghost) {
      g.fillStyle = '#1a1208';
      g.fillRect(4, H - 14, 11, 13);
      g.fillStyle = P.winOrange;
      g.fillRect(5, H - 11, 9, 8);
      g.fillStyle = '#f0d060';
      g.fillRect(7, H - 8, 5, 4);
      // anvil
      g.fillStyle = '#3a3a44';
      g.fillRect(W - 14, H - 8, 10, 3);
      g.fillRect(W - 13, H - 11, 8, 3);
      g.fillStyle = '#5a5a66';
      g.fillRect(W - 13, H - 10, 6, 1);
    } else if (special === 'school' && !ghost) {
      const cx2 = Math.floor(W / 2);
      g.fillStyle = P.woodDark;
      g.fillRect(cx2 - 5, 1, 10, 8);
      g.fillStyle = '#1a1208';
      g.fillRect(cx2 - 2, 2, 4, 5);
      g.fillStyle = P.grain;
      g.fillRect(cx2 - 1, 3, 2, 4);
    } else if (special === 'brewery' && !ghost) {
      for (const bx2 of [4, W - 14]) {
        g.fillStyle = P.wood;
        g.fillRect(bx2, H - 12, 10, 11);
        g.fillStyle = P.woodDark;
        g.fillRect(bx2, H - 9, 10, 2);
        g.fillRect(bx2, H - 4, 10, 2);
        g.fillStyle = P.woodLight;
        g.fillRect(bx2 + 1, H - 11, 2, 9);
      }
    } else if (special === 'longhouse' && !ghost) {
      g.fillStyle = P.outline;
      g.fillRect(8, H - dh2 - 2, 9, dh2 + 2);
      g.fillStyle = wallDk;
      g.fillRect(9, H - dh2 - 1, 7, dh2 + 1);
    }
  }

  g.globalAlpha = 1;
  return c;
}

function weaponSprite(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  const g = c.getContext('2d')!;
  g.fillStyle = P.wood;
  g.fillRect(14, 8, 4, 18); // shaft
  g.fillStyle = P.woodLight;
  g.fillRect(15, 9, 2, 16);
  g.fillStyle = P.rockLight;
  g.fillRect(12, 4, 8, 6); // spearhead body
  g.fillStyle = '#d4c070';
  g.fillRect(14, 1, 4, 5); // tip point
  g.fillStyle = P.rockDark;
  g.fillRect(13, 4, 1, 5);
  g.fillRect(19, 4, 1, 5);
  return c;
}

function genericItemSprite(color: string, color2: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  const g = c.getContext('2d')!;
  g.fillStyle = P.shadow;
  g.fillRect(5, 18, 18, 6);
  g.fillStyle = color2;
  g.fillRect(7, 13, 16, 7);
  g.fillStyle = color;
  g.fillRect(9, 9, 12, 6);
  g.fillRect(5, 14, 20, 4);
  return c;
}

function itemSprite(kind: 'wood' | 'grain' | 'meal' | 'stone' | 'clothes'): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  const g = c.getContext('2d')!;
  g.fillStyle = P.shadow;
  g.fillRect(5, 20, 20, 6);
  if (kind === 'wood') {
    // log pile with end rings
    g.fillStyle = P.trunkDark;
    g.fillRect(4, 14, 20, 6);
    g.fillStyle = P.trunk;
    g.fillRect(6, 10, 20, 6);
    g.fillRect(3, 16, 20, 6);
    g.fillStyle = P.wood;
    g.fillRect(7, 10, 18, 5);
    g.fillStyle = P.woodLight;
    g.fillRect(8, 10, 4, 4);
    // end grain circles
    g.fillStyle = P.trunkDark;
    g.fillRect(4, 11, 3, 4);
    g.fillRect(25, 11, 3, 4);
    g.fillStyle = P.wood;
    g.fillRect(4, 17, 3, 4);
    g.fillRect(24, 17, 3, 4);
  } else if (kind === 'stone') {
    g.fillStyle = P.rockDark;
    g.fillRect(6, 14, 16, 9);
    g.fillStyle = P.rock;
    g.fillRect(8, 10, 14, 9);
    g.fillStyle = P.rockLight;
    g.fillRect(10, 10, 7, 5);
    g.fillStyle = P.rockHighlight;
    g.fillRect(11, 10, 3, 2);
  } else if (kind === 'clothes') {
    g.fillStyle = P.cloth2;
    g.fillRect(5, 14, 20, 7);
    g.fillStyle = P.cloth3;
    g.fillRect(7, 10, 16, 6);
    g.fillStyle = P.cloth1;
    g.fillRect(9, 7, 12, 5);
    g.fillStyle = P.wallLight;
    g.fillRect(10, 7, 5, 2);
  } else {
    const col = kind === 'grain' ? P.grain : P.meal;
    const dark = kind === 'grain' ? '#9a7830' : '#885830';
    g.fillStyle = dark;
    g.fillRect(6, 14, 18, 8);
    g.fillStyle = col;
    g.fillRect(8, 10, 14, 8);
    g.fillRect(5, 15, 20, 4);
    g.fillStyle = P.outline;
    g.fillRect(6, 22, 18, 1);
  }
  return c;
}

function craftedItemSprite(kind: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  const g = c.getContext('2d')!;
  g.fillStyle = P.shadow;
  g.fillRect(5, 21, 20, 6);
  switch (kind) {
    case 'timber':
      g.fillStyle = P.plankDark; g.fillRect(3, 16, 24, 6);
      g.fillStyle = P.plank;     g.fillRect(5, 10, 24, 7);
      g.fillStyle = P.plankLight; g.fillRect(6, 11, 22, 2);
      g.fillStyle = P.plankDark; g.fillRect(4, 10, 1, 6); g.fillRect(27, 10, 1, 6);
      break;
    case 'brick':
      g.fillStyle = P.wallBrickDk; g.fillRect(5, 16, 20, 7);
      g.fillStyle = P.wallBrick;   g.fillRect(6, 10, 8, 7); g.fillRect(17, 10, 8, 7);
      g.fillStyle = '#b88070';     g.fillRect(6, 10, 8, 2); g.fillRect(17, 10, 8, 2);
      g.fillStyle = P.wallBrickDk; g.fillRect(14, 10, 3, 7);
      break;
    case 'iron':
      g.fillStyle = '#505060'; g.fillRect(5, 16, 20, 7);
      g.fillStyle = '#707080'; g.fillRect(8, 10, 15, 7);
      g.fillStyle = '#9a9aac'; g.fillRect(9, 10, 13, 3);
      g.fillStyle = '#3a3a4a'; g.fillRect(6, 16, 1, 6); g.fillRect(24, 16, 1, 6);
      break;
    case 'tools':
      g.fillStyle = P.wood;     g.fillRect(13, 7, 4, 16);
      g.fillStyle = P.woodLight; g.fillRect(14, 8, 2, 14);
      g.fillStyle = '#8a8a96'; g.fillRect(9, 5, 12, 6);
      g.fillStyle = '#aaaab6'; g.fillRect(10, 5, 10, 3);
      g.fillStyle = '#707080'; g.fillRect(5, 18, 15, 4);
      g.fillStyle = '#5a5a6a'; g.fillRect(5, 20, 15, 2);
      break;
    case 'rope':
      g.fillStyle = '#7a6840'; g.fillRect(7, 8, 16, 14);
      g.fillStyle = '#9c8858'; g.fillRect(8, 9, 14, 12);
      g.fillStyle = '#5a4c30'; g.fillRect(12, 14, 6, 4);
      g.fillStyle = '#c8a870'; g.fillRect(8, 9, 2, 2);
      break;
    case 'flour':
      g.fillStyle = '#a8a088'; g.fillRect(7, 10, 16, 12);
      g.fillStyle = '#c8c0a8'; g.fillRect(8, 10, 14, 10);
      g.fillStyle = '#d8d0b8'; g.fillRect(9, 10, 8, 5);
      g.fillStyle = '#7a7460'; g.fillRect(10, 7, 8, 4);
      g.fillStyle = '#5a544a'; g.fillRect(12, 6, 4, 2);
      break;
    case 'ale':
      g.fillStyle = P.woodDark;  g.fillRect(7, 7, 16, 16);
      g.fillStyle = P.wood;      g.fillRect(8, 7, 4, 16);
      g.fillStyle = P.woodLight; g.fillRect(9, 8, 2, 14);
      g.fillStyle = P.woodDark;  g.fillRect(7, 11, 16, 2); g.fillRect(7, 17, 16, 2);
      g.fillStyle = '#c8a030';   g.fillRect(9, 7, 12, 2);
      break;
    case 'bread':
      g.fillStyle = '#a07038'; g.fillRect(4, 14, 14, 7);
      g.fillStyle = '#c09050'; g.fillRect(4, 12, 14, 6);
      g.fillStyle = '#e0b878'; g.fillRect(6, 12, 10, 2);
      g.fillStyle = '#b08040'; g.fillRect(17, 9, 10, 8);
      g.fillStyle = '#d8a860'; g.fillRect(18, 9, 8, 5);
      g.fillStyle = '#e8c880'; g.fillRect(19, 9, 5, 2);
      break;
    case 'medicine':
      g.fillStyle = '#406858'; g.fillRect(11, 10, 9, 13);
      g.fillStyle = '#5a8870'; g.fillRect(12, 11, 7, 11);
      g.fillStyle = '#88b8a0'; g.fillRect(13, 11, 2, 8);
      g.fillStyle = P.wood;    g.fillRect(12, 6, 6, 5);
      g.fillStyle = P.woodDark; g.fillRect(13, 5, 4, 2);
      break;
    case 'herbs':
      g.fillStyle = '#365830'; g.fillRect(7, 9, 16, 11);
      g.fillStyle = '#4a7040'; g.fillRect(8, 7, 14, 12);
      g.fillStyle = '#6a9050'; g.fillRect(10, 7, 5, 6);
      g.fillStyle = '#88b060'; g.fillRect(11, 6, 3, 4);
      g.fillStyle = P.grain;   g.fillRect(9, 17, 12, 2);
      break;
    case 'dairy':
      g.fillStyle = '#b0a060'; g.fillRect(5, 13, 18, 9);
      g.fillStyle = '#d8c070'; g.fillRect(5, 9, 18, 7);
      g.fillStyle = '#f0e0a0'; g.fillRect(16, 9, 7, 7);
      g.fillStyle = '#e8d090'; g.fillRect(17, 9, 5, 3);
      break;
    case 'fish_meal':
      g.fillStyle = '#6080a0'; g.fillRect(4, 12, 18, 8);
      g.fillStyle = '#88a8c0'; g.fillRect(5, 12, 16, 3);
      g.fillStyle = '#486080'; g.fillRect(22, 10, 4, 12);
      g.fillStyle = P.outline; g.fillRect(7, 14, 2, 2);
      g.fillStyle = '#c0d8e8'; g.fillRect(8, 12, 4, 2);
      break;
    case 'produce':
      g.fillStyle = P.woodDark; g.fillRect(7, 14, 16, 7);
      g.fillStyle = P.wood;     g.fillRect(7, 14, 16, 2);
      g.fillStyle = '#608040';  g.fillRect(9, 9, 6, 6);
      g.fillStyle = '#c25b2e';  g.fillRect(15, 9, 5, 5);
      g.fillStyle = '#c8a830';  g.fillRect(20, 11, 4, 4);
      g.fillStyle = '#88b050';  g.fillRect(10, 9, 3, 2);
      break;
  }
  return c;
}

function graveSprite(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  const g = c.getContext('2d')!;
  g.fillStyle = P.shadow;
  g.fillRect(5, 22, 22, 7);
  g.fillStyle = P.soilDark;
  g.fillRect(7, 18, 18, 8);
  g.fillStyle = P.soil;
  g.fillRect(9, 16, 14, 7);
  g.fillStyle = P.soilMid;
  g.fillRect(10, 16, 10, 3);
  g.fillStyle = P.woodDark;
  g.fillRect(14, 3, 4, 18);
  g.fillRect(7, 7, 18, 4);
  g.fillStyle = P.wood;
  g.fillRect(15, 3, 2, 18);
  g.fillRect(8, 7, 16, 2);
  g.fillStyle = P.woodLight;
  g.fillRect(15, 3, 1, 15);
  return c;
}

function corpseSprite(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  const g = c.getContext('2d')!;
  g.fillStyle = P.shadow;
  g.fillRect(2, 18, 26, 8);
  g.fillStyle = P.cloth1;
  g.fillRect(7, 13, 18, 8);
  g.fillStyle = P.clothDark1;
  g.fillRect(7, 13, 18, 2);
  g.fillStyle = P.skinB;
  g.fillRect(1, 14, 7, 7);
  g.fillStyle = P.hairA;
  g.fillRect(1, 12, 7, 4);
  g.fillStyle = P.wallDark;
  g.fillRect(25, 16, 5, 5);
  return c;
}

function stockpileZoneTile(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  const g = c.getContext('2d')!;
  g.fillStyle = P.floor;
  g.fillRect(0, 0, TILE, TILE);
  g.fillStyle = P.floorDark;
  g.globalAlpha = 0.25;
  for (let i = 0; i < 64; i += 8) g.fillRect(i, 0, 1, TILE);
  for (let i = 0; i < 64; i += 8) g.fillRect(0, i, TILE, 1);
  g.globalAlpha = 1;
  return c;
}

function trapZoneTile(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  const g = c.getContext('2d')!;
  g.globalAlpha = 0.55;
  g.fillStyle = '#8b1a1a';
  g.fillRect(0, 0, TILE, TILE);
  g.globalAlpha = 0.9;
  g.fillStyle = '#c0392b';
  const pts = [[8, 8], [24, 8], [16, 16], [8, 24], [24, 24]];
  for (const [x, y] of pts) {
    g.fillRect(x - 2, y - 5, 4, 10);
    g.fillRect(x - 5, y - 2, 10, 4);
    g.fillRect(x - 1, y - 5, 2, 2);
  }
  g.globalAlpha = 1;
  return c;
}

function wallPlanTile(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  const g = c.getContext('2d')!;
  g.globalAlpha = 0.5;
  g.fillStyle = '#c25b2e';
  for (let x = 3; x < 28; x += 5) g.fillRect(x, 14, 4, 10);
  g.globalAlpha = 1;
  return c;
}

function palisadeVariantTile(mask: number): HTMLCanvasElement {
  const hasN = (mask & 1) !== 0;
  const hasE = (mask & 2) !== 0;
  const hasS = (mask & 4) !== 0;
  const hasW = (mask & 8) !== 0;
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  const g = c.getContext('2d')!;

  const HY1 = 10, HY2 = 22;
  const VX1 = 10, VX2 = 22;

  // Shadows
  g.fillStyle = P.shadow;
  if (hasE || hasW || (!hasN && !hasS)) {
    const sx1 = hasW ? 0 : VX1, sx2 = hasE ? TILE : VX2;
    g.fillRect(sx1 + 2, HY2, sx2 - sx1, 4);
  }
  if (hasS) g.fillRect(VX1 + 2, HY2, VX2 - VX1, TILE - HY2);

  const drawHPlanks2 = (x1: number, x2: number, y1: number, y2: number) => {
    const w = x2 - x1, h = y2 - y1;
    if (w <= 0 || h <= 0) return;
    g.fillStyle = P.woodDark; g.fillRect(x1, y1, w, h);
    g.fillStyle = P.wood;
    for (let px = x1 + 1; px < x2 - 1; px += 5) g.fillRect(px, y1 + 1, 3, h - 1);
    g.fillStyle = P.woodLight;
    for (let px = x1 + 1; px < x2 - 1; px += 5) g.fillRect(px, y1 + 1, 1, h - 2);
    g.fillStyle = P.rockLight;
    g.fillRect(x1, y1, w, 1);
  };

  const drawVPlanks2 = (x1: number, x2: number, y1: number, y2: number) => {
    const w = x2 - x1, h = y2 - y1;
    if (w <= 0 || h <= 0) return;
    g.fillStyle = P.woodDark; g.fillRect(x1, y1, w, h);
    g.fillStyle = P.wood;
    for (let py = y1 + 1; py < y2 - 1; py += 5) g.fillRect(x1 + 1, py, w - 1, 3);
    g.fillStyle = P.woodLight;
    for (let py = y1 + 1; py < y2 - 1; py += 5) g.fillRect(x1 + 1, py, w - 2, 1);
    g.fillStyle = P.rockLight;
    g.fillRect(x1, y1, 1, h);
  };

  if (hasW) drawHPlanks2(0, VX1, HY1, HY2);
  if (hasE) drawHPlanks2(VX2, TILE, HY1, HY2);
  if (hasN) drawVPlanks2(VX1, VX2, 0, HY1);
  if (hasS) drawVPlanks2(VX1, VX2, HY2, TILE);

  const hActive = hasE || hasW || (!hasN && !hasS);
  const vActive = hasN || hasS;
  if (hActive && vActive) {
    g.fillStyle = P.woodDark;
    g.fillRect(VX1, HY1, VX2 - VX1, HY2 - HY1);
    g.fillStyle = P.wood;
    g.fillRect(VX1 + 1, HY1 + 1, VX2 - VX1 - 2, HY2 - HY1 - 2);
    g.fillStyle = P.woodLight;
    g.fillRect(VX1 + 1, HY1 + 1, VX2 - VX1 - 3, 2);
    g.fillStyle = P.rockLight;
    g.fillRect(VX1, HY1, VX2 - VX1, 1);
    g.fillRect(VX1, HY1, 1, HY2 - HY1);
  } else if (vActive) {
    drawVPlanks2(VX1, VX2, HY1, HY2);
  } else {
    drawHPlanks2(VX1, VX2, HY1, HY2);
  }

  return c;
}

function palisadeTile(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  const g = c.getContext('2d')!;
  g.fillStyle = P.shadow;
  g.fillRect(0, 24, TILE, 7);
  g.fillStyle = P.woodDark;
  for (let x = 1; x < 30; x += 5) g.fillRect(x, 10, 4, 15);
  g.fillStyle = P.wood;
  for (let x = 2; x < 30; x += 5) g.fillRect(x, 11, 2, 13);
  g.fillStyle = P.woodLight;
  for (let x = 2; x < 30; x += 5) g.fillRect(x, 11, 1, 11);
  // binding rails
  g.fillStyle = P.trunk;
  g.fillRect(1, 13, TILE - 2, 3);
  g.fillRect(1, 20, TILE - 2, 3);
  return c;
}

function gateTile(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  const g = c.getContext('2d')!;
  g.fillStyle = P.shadow;
  g.fillRect(0, 24, TILE, 7);
  // posts
  g.fillStyle = P.woodDark;
  g.fillRect(0, 8, 5, 16); g.fillRect(27, 8, 5, 16);
  g.fillStyle = P.wood;
  g.fillRect(1, 9, 3, 14); g.fillRect(28, 9, 3, 14);
  g.fillStyle = P.woodLight;
  g.fillRect(2, 9, 1, 14);
  // door planks
  g.fillStyle = P.plank;
  g.fillRect(5, 10, 22, 14);
  g.fillStyle = P.plankDark;
  g.fillRect(5, 14, 22, 2); g.fillRect(5, 20, 22, 2);
  // cross bar
  g.fillStyle = P.woodDark;
  g.fillRect(5, 16, 22, 2);
  // hinge nails
  if (true) {
    g.fillStyle = P.rockDark;
    g.fillRect(6, 11, 2, 2); g.fillRect(6, 22, 2, 2);
    g.fillRect(24, 11, 2, 2); g.fillRect(24, 22, 2, 2);
  }
  return c;
}

function gateVerticalTile(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  const g = c.getContext('2d')!;
  g.fillStyle = P.shadow;
  g.fillRect(24, 0, 7, TILE);
  // posts top and bottom
  g.fillStyle = P.woodDark;
  g.fillRect(8, 0, 16, 5); g.fillRect(8, 27, 16, 5);
  g.fillStyle = P.wood;
  g.fillRect(9, 1, 14, 3); g.fillRect(9, 28, 14, 3);
  g.fillStyle = P.woodLight;
  g.fillRect(9, 1, 14, 1);
  // door planks (vertical span)
  g.fillStyle = P.plank;
  g.fillRect(10, 5, 14, 22);
  g.fillStyle = P.plankDark;
  g.fillRect(14, 5, 2, 22); g.fillRect(20, 5, 2, 22);
  // cross bar
  g.fillStyle = P.woodDark;
  g.fillRect(16, 5, 2, 22);
  // hinge nails
  g.fillStyle = P.rockDark;
  g.fillRect(11, 6, 2, 2); g.fillRect(11, 24, 2, 2);
  g.fillRect(22, 6, 2, 2); g.fillRect(22, 24, 2, 2);
  return c;
}

function gateVariantTile(mask: number): HTMLCanvasElement {
  const hasN = (mask & 1) !== 0;
  const hasS = (mask & 4) !== 0;
  const hasE = (mask & 2) !== 0;
  const hasW = (mask & 8) !== 0;
  // NS-running wall → vertical gate; EW-running or isolated → horizontal gate
  const useVertical = (hasN || hasS) && !hasE && !hasW;
  return useVertical ? gateVerticalTile() : gateTile();
}

function gatePlanTile(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  const g = c.getContext('2d')!;
  g.globalAlpha = 0.5;
  g.fillStyle = '#9cc4e4';
  g.fillRect(3, 12, 4, 12);
  g.fillRect(25, 12, 4, 12);
  g.fillRect(7, 16, 18, 4);
  g.globalAlpha = 1;
  return c;
}

function deerSprite(frame: number): HTMLCanvasElement {
  const legA = frame === 0 ? 'LL..' : '..LL';
  const legB = frame === 0 ? '..LL' : 'LL..';
  const rows = [
    '................................',
    '................................',
    '............e...................',
    '...........hh...................',
    '...........hhn..................',
    '.......bbbbbh...................',
    '......bbbbbbb...................',
    '......tbbbbbbb..................',
    `........${legA}${legB}..................`,
    `........${legA}${legB}..................`,
    `........${legA}${legB}..................`,
    '.......SSSSSSSSSS...............',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
  ];
  return sheet(grid(rows, {
    b: '#a87f50', h: '#96714a', n: '#26201a', e: '#6b4a2a',
    t: '#e8e2d4', L: '#7a5a36', S: 'rgba(20,16,10,0.3)',
  }));
}

function wolfSprite(frame: number): HTMLCanvasElement {
  const legA = frame === 0 ? 'LL..' : '..LL';
  const legB = frame === 0 ? '..LL' : 'LL..';
  const rows = [
    '................................',
    '................................',
    '.........e.e....................',
    '.........hhh....................',
    '.........hhhn...................',
    '......bbbbbh....................',
    '.....tbbbbbb....................',
    '......bbbbbb....................',
    `......${legA}${legB}..................`,
    `......${legA}${legB}..................`,
    `......${legA}${legB}..................`,
    '......SSSSSSSSSS................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
  ];
  return sheet(grid(rows, {
    b: '#6e6e72', h: '#5d5d62', n: '#26201a', e: '#5d5d62',
    t: '#8c8c90', L: '#4d4d52', S: 'rgba(20,16,10,0.3)',
  }));
}

function saplingSprite(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  const g = c.getContext('2d')!;
  g.fillStyle = P.shadow;
  g.fillRect(12, 26, 10, 4);
  g.fillStyle = P.trunkDark;
  g.fillRect(15, 16, 3, 12);
  g.fillStyle = P.trunk;
  g.fillRect(15, 16, 2, 10);
  // leaf cluster
  g.fillStyle = P.treeLeafDark;
  g.fillRect(10, 8, 12, 10);
  g.fillRect(12, 5, 8, 12);
  g.fillStyle = P.treeLeaf;
  g.fillRect(11, 7, 10, 8);
  g.fillRect(13, 4, 6, 12);
  g.fillStyle = P.treeLeafLight;
  g.fillRect(13, 5, 6, 6);
  g.fillRect(12, 7, 3, 4);
  return c;
}

/** Draw upgrade tier pips at the top-right corner of a built building sprite. */
function applyLevelPips(base: HTMLCanvasElement, level: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = base.width; c.height = base.height;
  const g = c.getContext('2d')!;
  g.drawImage(base, 0, 0);
  // Draw one 2×5px pip per upgrade tier (level-1 pips), right-aligned from top-right
  const pips = level - 1;
  for (let i = 0; i < pips; i++) {
    const rx = base.width - 4 - i * 4; // right edge offset
    g.fillStyle = '#2a2a2a';
    g.fillRect(rx - 1, 0, 4, 6);
    g.fillStyle = '#f5c842'; // gold tier pip
    g.fillRect(rx, 1, 2, 5);
  }
  return c;
}

// ---------------------------------------------------------------------------
// Room build-system art: a plank floor, a stone wall block, and a recognizable
// furniture sprite for every workstation. Replaces the old flat dark squares so
// a designated room reads as a real room (Songs-of-Syx: the room IS its stations).
// ---------------------------------------------------------------------------

/** Warm plank floor laid inside a designated room. */
function interiorFloorTile(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  const g = c.getContext('2d')!;
  g.fillStyle = P.plankDark;
  g.fillRect(0, 0, TILE, TILE);
  // Two courses of staggered planks.
  for (let row = 0; row < TILE; row += 8) {
    g.fillStyle = P.plank;
    g.fillRect(0, row + 1, TILE, 6);
    g.fillStyle = P.plankLight;
    g.fillRect(0, row + 1, TILE, 1);
    // board seams, offset every other row
    const off = (row / 8) % 2 === 0 ? 0 : 16;
    g.fillStyle = P.plankDark;
    g.fillRect((off) % TILE, row + 1, 1, 6);
    g.fillRect((off + 16) % TILE, row + 1, 1, 6);
  }
  return c;
}

/** Mortared stone wall block (with a top bevel for a hint of height). */
function interiorWallTile(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  const g = c.getContext('2d')!;
  g.fillStyle = P.rockDark;
  g.fillRect(0, 0, TILE, TILE);
  // Brick/stone courses.
  for (let row = 0; row < TILE; row += 8) {
    const off = (row / 8) % 2 === 0 ? 0 : 8;
    for (let x = -off; x < TILE; x += 16) {
      g.fillStyle = P.rock;
      g.fillRect(x + 1, row + 1, 14, 6);
      g.fillStyle = P.rockLight;
      g.fillRect(x + 1, row + 1, 14, 1);
    }
  }
  // Lit top edge so walls feel slightly raised.
  g.fillStyle = P.rockHighlight;
  g.fillRect(0, 0, TILE, 1);
  g.fillStyle = P.shadow;
  g.fillRect(0, TILE - 2, TILE, 2);
  return c;
}

/** A furniture sprite for one workstation, sized to its w×h tile footprint. */
function stationSprite(id: string, w: number, h: number): HTMLCanvasElement {
  const W = w * TILE, H = h * TILE;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const m = 2;
  const shadow = () => { g.fillStyle = P.shadow; g.fillRect(m + 1, H - 4, W - 2 * m - 2, 3); };
  const disc = (cx: number, cy: number, r: number, col: string) => {
    g.fillStyle = col; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  };
  const woodTop = (x: number, y: number, bw: number, bh: number) => {
    g.fillStyle = P.woodDark; g.fillRect(x, y, bw, bh);
    g.fillStyle = P.wood; g.fillRect(x + 1, y + 1, bw - 2, bh - 2);
    g.fillStyle = P.woodLight; g.fillRect(x + 1, y + 1, bw - 2, 2);
    g.fillStyle = P.woodDark; g.fillRect(x + 2, y + bh - 2, 2, 2); // leg shadow
    g.fillRect(x + bw - 4, y + bh - 2, 2, 2);
  };
  const stoneBody = (dark: boolean) => {
    g.fillStyle = dark ? '#34302b' : P.rockDark; g.fillRect(m, m + 2, W - 2 * m, H - 2 * m - 2);
    g.fillStyle = dark ? '#4c483f' : P.rock; g.fillRect(m + 1, m + 3, W - 2 * m - 2, H - 2 * m - 4);
    g.fillStyle = dark ? '#5e594e' : P.rockLight; g.fillRect(m + 1, m + 3, W - 2 * m - 2, 2);
  };
  const furnace = (dark: boolean, lit = true) => {
    shadow(); stoneBody(dark);
    const mw = Math.min(W - 10, 16), mx = (W - mw) / 2, my = H - 17;
    g.fillStyle = '#140d06'; g.fillRect(mx, my, mw, 12);
    if (lit) {
      g.fillStyle = P.winOrange; g.fillRect(mx + 2, my + 3, mw - 4, 8);
      g.fillStyle = '#f4d65e'; g.fillRect(mx + 4, my + 5, mw - 8, 4);
    }
    g.fillStyle = P.rockLight; g.fillRect(W / 2 - 3, m, 6, 4); // flue
  };
  const bed = (variant: 'bed' | 'bunk' | 'sick') => {
    shadow();
    g.fillStyle = P.woodDark; g.fillRect(m, m, W - 2 * m, H - 2 * m);
    g.fillStyle = '#b8a888'; g.fillRect(m + 2, m + 2, W - 2 * m - 4, H - 2 * m - 4);
    const by = m + 2 + Math.round((H - 2 * m - 4) * 0.4);
    g.fillStyle = variant === 'sick' ? '#cdd6d0' : '#6f7d6a';
    g.fillRect(m + 2, by, W - 2 * m - 4, H - by - m - 2);
    g.fillStyle = variant === 'sick' ? '#e0e7e1' : '#7e8c78';
    g.fillRect(m + 2, by, W - 2 * m - 4, 2);
    g.fillStyle = '#e6ddc8'; g.fillRect(m + 4, m + 4, W - 2 * m - 8, 9);
    g.fillStyle = '#f1ead8'; g.fillRect(m + 4, m + 4, W - 2 * m - 8, 3);
    if (variant === 'bunk') {
      g.fillStyle = P.woodDark; g.fillRect(m + 2, Math.floor(H / 2) - 1, W - 2 * m - 4, 2);
      g.fillStyle = '#e6ddc8'; g.fillRect(m + 4, Math.floor(H / 2) + 3, W - 2 * m - 8, 8);
    }
    if (variant === 'sick') {
      g.fillStyle = '#cc3a3a';
      g.fillRect(Math.floor(W / 2) - 1, by + 5, 3, 9);
      g.fillRect(Math.floor(W / 2) - 4, by + 8, 9, 3);
    }
  };

  switch (id) {
    case 'bed': bed('bed'); break;
    case 'bunk': bed('bunk'); break;
    case 'sickbed': bed('sick'); break;
    case 'oven': case 'baking_oven': furnace(false); break;
    case 'smelter': case 'coke_oven': furnace(true); break;
    case 'kiln': {
      shadow(); stoneBody(false);
      g.fillStyle = P.wallBrick; g.fillRect(m + 3, m + 4, W - 2 * m - 6, H - 2 * m - 8);
      g.fillStyle = P.wallBrickDk;
      for (let y = m + 4; y < H - m - 6; y += 5) g.fillRect(m + 3, y, W - 2 * m - 6, 1);
      g.fillStyle = '#140d06'; g.fillRect(W / 2 - 7, H - 18, 14, 12);
      g.fillStyle = P.winOrange; g.fillRect(W / 2 - 5, H - 15, 10, 8);
      break;
    }
    case 'millstone': {
      shadow();
      const cx = W / 2, cy = H / 2;
      disc(cx, cy, 24, P.rockDark);
      disc(cx, cy, 22, P.rock);
      g.fillStyle = P.rockLight; g.beginPath(); g.arc(cx, cy, 22, Math.PI, Math.PI * 1.5); g.lineTo(cx, cy); g.fill();
      disc(cx, cy, 6, P.rockDark);
      g.fillStyle = P.wood; g.fillRect(cx - 2, cy - 2, 4, 4);
      break;
    }
    case 'anvil': {
      shadow();
      woodTop(m + 1, H - 11, W - 2 * m - 2, 9);
      g.fillStyle = '#3a3a44'; g.fillRect(5, 11, W - 10, 6);
      g.fillStyle = '#52525e'; g.fillRect(5, 11, W - 10, 2);
      g.fillStyle = '#3a3a44'; g.fillRect(W / 2 - 3, 17, 6, 5);
      g.fillStyle = '#2c2c34'; g.fillRect(3, 13, 4, 3); // horn
      break;
    }
    case 'weapon_bench': {
      shadow(); woodTop(m, 11, W - 2 * m, H - 13);
      g.fillStyle = P.wood; g.fillRect(10, 16, W - 26, 3);
      g.fillStyle = P.rockLight; g.fillRect(W - 16, 13, 9, 7); // spearhead
      g.fillStyle = P.rockHighlight; g.fillRect(W - 15, 14, 4, 2);
      break;
    }
    case 'saw_bench': {
      shadow(); woodTop(m, 12, W - 2 * m, H - 14);
      disc(W - 16, H / 2, 8, '#8b8b95'); // circular blade
      disc(W - 16, H / 2, 3, P.woodDark);
      g.fillStyle = '#b8b8c0';
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) g.fillRect(W - 16 + Math.cos(a) * 8 - 1, H / 2 + Math.sin(a) * 8 - 1, 2, 2);
      break;
    }
    case 'loom': {
      shadow();
      g.fillStyle = P.woodDark; g.fillRect(m + 2, m + 2, 3, H - 2 * m - 4); g.fillRect(W - m - 5, m + 2, 3, H - 2 * m - 4);
      g.fillStyle = P.wood; g.fillRect(m + 2, m + 3, W - 2 * m - 4, 3); g.fillRect(m + 2, H - m - 6, W - 2 * m - 4, 3);
      g.fillStyle = '#d8cdb2';
      for (let x = m + 8; x < W - m - 6; x += 4) g.fillRect(x, m + 6, 1, H - 2 * m - 12); // warp threads
      break;
    }
    case 'rope_walk': {
      shadow();
      g.fillStyle = P.woodDark; g.fillRect(m + 1, m + 4, 4, H - 2 * m - 8); g.fillRect(W - m - 5, m + 4, 4, H - 2 * m - 8);
      for (let i = 0; i < 3; i++) {
        const y = H / 2 - 6 + i * 6;
        g.fillStyle = i % 2 ? '#b89a5e' : '#a88a50';
        g.fillRect(m + 5, y, W - 2 * m - 10, 3);
        g.fillStyle = '#c9ab6e';
        for (let x = m + 6; x < W - m - 6; x += 4) g.fillRect(x, y, 2, 1); // twist
      }
      break;
    }
    case 'herb_table': {
      shadow(); woodTop(m, 11, W - 2 * m, H - 13);
      g.fillStyle = '#3c8a4c';
      for (let i = 0; i < 4; i++) { const x = 8 + i * ((W - 16) / 4); g.fillRect(x, 13, 3, 6); g.fillRect(x - 2, 13, 7, 2); }
      break;
    }
    case 'brew_vat': {
      shadow();
      g.fillStyle = P.woodDark; g.fillRect(m + 4, m + 3, W - 2 * m - 8, H - 2 * m - 4);
      g.fillStyle = P.wood; g.fillRect(m + 6, m + 4, W - 2 * m - 12, H - 2 * m - 6);
      g.fillStyle = P.woodLight; g.fillRect(m + 6, m + 4, 3, H - 2 * m - 6);
      g.fillStyle = P.trunkDark; g.fillRect(m + 4, m + 8, W - 2 * m - 8, 3); g.fillRect(m + 4, H - m - 10, W - 2 * m - 8, 3); // hoops
      disc(W / 2, m + 6, 5, '#5a4a36'); // open top
      disc(W / 2, m + 6, 3, '#7a6a30');
      break;
    }
    case 'desk': {
      shadow(); woodTop(m, 12, W - 2 * m, H - 14);
      g.fillStyle = '#e6ddc8'; g.fillRect(7, 14, 11, 8); // open book
      g.fillStyle = P.woodDark; g.fillRect(W / 2 - 1, 14, 1, 8);
      g.fillStyle = '#a89878'; g.fillRect(8, 16, 4, 1); g.fillRect(8, 18, 4, 1);
      break;
    }
    case 'table': {
      shadow(); woodTop(m, 11, W - 2 * m, H - 13);
      disc(W * 0.32, H / 2, 4, '#cfd4dc'); disc(W * 0.68, H / 2, 4, '#cfd4dc'); // plates
      break;
    }
    case 'shelf': {
      shadow();
      g.fillStyle = P.woodDark; g.fillRect(m + 1, m + 1, W - 2 * m - 2, H - 2 * m - 2);
      g.fillStyle = P.wood; g.fillRect(m + 2, m + 2, W - 2 * m - 4, H - 2 * m - 4);
      for (let row = 0; row < 2; row++) {
        const y = m + 5 + row * ((H - 2 * m - 8) / 2);
        g.fillStyle = P.woodDark; g.fillRect(m + 2, y + 7, W - 2 * m - 4, 2); // shelf board
        g.fillStyle = ['#9c6b40', '#7a9040', '#a88a50'][row % 3];
        for (let x = m + 4; x < W - m - 5; x += 5) g.fillRect(x, y + 1, 3, 6); // goods
      }
      break;
    }
    default: { // generic crate
      shadow();
      woodTop(m + 2, m + 3, W - 2 * m - 4, H - 2 * m - 5);
      g.fillStyle = P.woodDark;
      g.fillRect(m + 2, Math.floor(H / 2), W - 2 * m - 4, 1);
    }
  }
  return c;
}

export function buildSprites(buildingDefs: { id: string; w: number; h: number; upgrades?: unknown[] }[]): SpriteSet {
  const buildings: Record<string, HTMLCanvasElement> = {};
  const blueprints: Record<string, HTMLCanvasElement> = {};
  for (const d of buildingDefs) {
    const base = buildingSprite(d.id, d.w, d.h, false);
    buildings[d.id]     = base;
    buildings[`${d.id}:1`] = base;
    blueprints[d.id]    = buildingSprite(d.id, d.w, d.h, true);
    // Pre-render levelled variants for buildings that have upgrades.
    if (d.upgrades && d.upgrades.length > 0) {
      for (let lvl = 2; lvl <= d.upgrades.length + 1; lvl++) {
        buildings[`${d.id}:${lvl}`] = applyLevelPips(base, lvl);
      }
    }
  }
  const stations: Record<string, HTMLCanvasElement> = {};
  for (const sd of STATION_DEFS) stations[sd.id] = stationSprite(sd.id, sd.w, sd.h);
  const roads: Record<string, HTMLCanvasElement> = {};
  const roadPlans: Record<string, HTMLCanvasElement> = {};
  for (const k of ['dirt', 'plank', 'gravel', 'bridge']) {
    roads[k]     = roadTile(k, false);
    roadPlans[k] = roadTile(k, true);
  }
  const pawnLooks: [string, string, string, string, string][] = [
    [P.cloth1,      P.clothDark1, P.skin,  P.skinShad, P.hairA],
    [P.cloth2,      P.clothDark2, P.skinB, P.skin,     P.hairB],
    [P.cloth3,      P.wallDark,   P.skin,  P.skinShad, P.hairC],
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
    gateVariants: Array.from({ length: 16 }, (_, i) => gateVariantTile(i)),
    gatePlan: gatePlanTile(),
    sapling: saplingSprite(),
    settler: pawnLooks.map(([c, cd, s, ss, h]) => [
      pawnSprite(c, cd, 0, s, ss, h),
      pawnSprite(c, cd, 1, s, ss, h),
    ]),
    settlerArmed: pawnLooks.map(([c, cd, s, ss, h]) => [
      pawnSprite(c, cd, 0, s, ss, h, true),
      pawnSprite(c, cd, 1, s, ss, h, true),
    ]),
    raider: [
      pawnSprite(P.clothRaider, '#6a2018', 0, P.skinB, P.skin, P.hairA, true),
      pawnSprite(P.clothRaider, '#6a2018', 1, P.skinB, P.skin, P.hairA, true),
    ],
    deer: [deerSprite(0), deerSprite(1)],
    wolf: [wolfSprite(0), wolfSprite(1)],
    items: {
      wood:       itemSprite('wood'),
      grain:      itemSprite('grain'),
      meal:       itemSprite('meal'),
      stone:      itemSprite('stone'),
      clothes:    itemSprite('clothes'),
      weapons:    weaponSprite(),
      clay:       genericItemSprite('#9c6b40', '#7a5030'),
      coal:       genericItemSprite('#3c3830', '#2a2820'),
      iron_ore:   genericItemSprite('#786050', '#5e4840'),
      flax:       genericItemSprite('#9cb060', '#7a9040'),
      herbs:      craftedItemSprite('herbs'),
      timber:     craftedItemSprite('timber'),
      brick:      craftedItemSprite('brick'),
      iron:       craftedItemSprite('iron'),
      tools:      craftedItemSprite('tools'),
      rope:       craftedItemSprite('rope'),
      flour:      craftedItemSprite('flour'),
      ale:        craftedItemSprite('ale'),
      medicine:   craftedItemSprite('medicine'),
      bread:      craftedItemSprite('bread'),
      dairy:      craftedItemSprite('dairy'),
      produce:    craftedItemSprite('produce'),
      game_meal:  genericItemSprite('#8c5c3c', '#6a4028'),
      fish_meal:  craftedItemSprite('fish_meal'),
      preserved:  genericItemSprite('#6a4030', '#502820'),
      coke:       genericItemSprite('#2a2010', '#1a1408'),
      petroleum:  genericItemSprite('#1c1e28', '#14161e'),
    },
    grave:  graveSprite(),
    corpse: corpseSprite(),
    buildings,
    blueprints,
    interiorFloor: interiorFloorTile(),
    interiorWall: interiorWallTile(),
    stations,
  };
}
