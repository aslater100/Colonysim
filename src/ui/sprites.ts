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


// ---------------------------------------------------------------------------
// COHESIVE, HUE-SHIFTED PALETTE
// Single light direction: top-left, warm. Shadows shift cool (toward blue/
// violet) and desaturate; highlights shift warm (toward yellow) and saturate.
// Outline is a shared near-black warm-brown so every sprite belongs to one set.
// ---------------------------------------------------------------------------
const P = {
  outline: '#231c16',         // shared warm near-black outline
  outlineSoft: '#352a20',     // softer interior outline / occlusion
  shadow: 'rgba(28,22,40,0.34)', // cast shadow, faintly cool/violet
  shadowSoft: 'rgba(28,22,40,0.22)',
  // Grass ramp — warm-lit green, shadow side cools toward blue-green
  grassA: '#586848',
  grassB: '#60704e',
  grassC: '#506044',
  grassD: '#4a5c42',
  grassShadow: '#42543e',     // cool, slightly blue shadow patch
  blade: '#74855a',
  bladeLight: '#8a9c66',       // warm highlight on blade tips
  dirtPatch: '#6e5a3e',
  dirtMid: '#5c4a32',
  dirtLight: '#806a48',
  soil: '#6b5138',
  soilDark: '#523c28',         // cooler/deeper furrow shadow
  soilMid: '#7a5c3e',          // warm furrow crest
  crop: '#7e8c4a',
  cropDark: '#5e6c38',
  cropRipe: '#c8a850',
  // Water ramp — cool, desaturated depths, warm-cool glints
  water1: '#3a5468',           // deep
  water2: '#446076',           // mid
  water3: '#33485a',           // deepest trough
  waterGlint: '#6688a0',
  waterGlint2: '#8aacc0',      // brightest sky reflection
  // Rock ramp — neutral stone, cool shadow, warm top highlight
  rock: '#7c776a',
  rockDark: '#565249',         // cool shadow
  rockDarker: '#403d36',
  rockLight: '#969182',
  rockHighlight: '#b0ab98',    // warm lit crest
  // Foliage ramp — deep cool shadow up to warm-yellow lit top
  treeLeafLight: '#6c8a48',
  treeLeafTop: '#88a458',      // warm sunlit highlight
  treeLeaf: '#4c6838',
  treeLeafDark: '#37502a',
  treeLeafDeep: '#2a3e22',     // cool deep shadow
  trunk: '#503c28',
  trunkDark: '#392a1b',
  trunkLight: '#6a5036',       // warm lit side of trunk
  // Skin ramp — warm midtone, cool-violet shadow, warm highlight
  skin: '#cda383',
  skinShad: '#a67c5e',         // cooler, desaturated shadow
  skinLight: '#e0bc98',        // warm cheek/forehead highlight
  skinB: '#b08866',            // darker complexion midtone
  skinBShad: '#8a6448',
  skinBLight: '#c8a07c',
  hairA: '#3a2c1c',
  hairB: '#6b4a2a',
  hairC: '#9a9286',
  // Clothing ramps (mid / shadow / highlight) — each a distinct hue family
  cloth1: '#8a6a44',           // ochre tunic
  clothDark1: '#5e4830',
  clothLight1: '#a8855a',
  cloth2: '#566a72',           // teal-blue tunic
  clothDark2: '#3c4e56',
  clothLight2: '#789098',
  cloth3: '#7a5868',           // mauve tunic
  clothDark3: '#56384a',
  clothLight3: '#9a7488',
  cloth4: '#3c6a3a',           // forest-green tunic (4th settler variant)
  clothDark4: '#2a4c2a',
  clothLight4: '#568a52',
  clothRaider: '#9a3a2a',      // blood-red raider
  clothRaiderDk: '#6a2018',
  clothRaiderLt: '#c25240',
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
  grassSpring: HTMLCanvasElement[];
  grassAutumn: HTMLCanvasElement[];
  grassWinter: HTMLCanvasElement[];
  dirtPatch: HTMLCanvasElement;
  tree: HTMLCanvasElement;
  treeMarked: HTMLCanvasElement;
  treeSpring: HTMLCanvasElement;
  treeAutumn: HTMLCanvasElement;
  treeWinter: HTMLCanvasElement;
  water: HTMLCanvasElement[];
  waterWinter: HTMLCanvasElement[];
  rock: HTMLCanvasElement[];
  rockMarked: HTMLCanvasElement[];
  sand: HTMLCanvasElement[];
  soil: HTMLCanvasElement;
  soilSown: HTMLCanvasElement;
  soilGrown: HTMLCanvasElement;
  soilRipe: HTMLCanvasElement;
  soilWinter: HTMLCanvasElement;
  flaxSown: HTMLCanvasElement;
  flaxGrown: HTMLCanvasElement;
  flaxRipe: HTMLCanvasElement;
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
  /** Index matches FORAGE type: 0=none(unused), 1=berries, 2=mushrooms, 3=herbs */
  forage: HTMLCanvasElement[];
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
  /** Per-room-type floor sprites. Keys match room ids; falls back to interiorFloor if absent. */
  roomFloors: Record<string, HTMLCanvasElement>;
  stations: Record<string, HTMLCanvasElement>;
}

// Tiny deterministic PRNG so grass/texture is stable across builds.
function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Soft ground at 32×32. A cohesive green base with gently mottled clumps
 * (cool-shadow patches + warm-lit patches) and a scatter of upright blades
 * whose tips catch warm light. Variants rotate the base tone and the seed so
 * adjacent tiles don't tile-repeat obviously.
 */
function grassTile(variant: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  const g = c.getContext('2d')!;
  const rnd = mulberry(1000 + variant * 97);
  const base = [P.grassA, P.grassB, P.grassC, P.grassD][variant % 4];
  g.fillStyle = base;
  g.fillRect(0, 0, TILE, TILE);
  // soft mottling: scattered 2-3px clumps, cool shadow + warm light
  for (let i = 0; i < 26; i++) {
    const x = Math.floor(rnd() * TILE);
    const y = Math.floor(rnd() * TILE);
    const s = 1 + Math.floor(rnd() * 2);
    const roll = rnd();
    g.fillStyle = roll < 0.45 ? P.grassShadow : roll < 0.8 ? P.grassC : P.grassB;
    g.fillRect(x, y, s + 1, s);
  }
  // grass blades — short verticals, warm-lit tip on some
  for (let i = 0; i < 10; i++) {
    const bx = Math.floor(rnd() * (TILE - 1));
    const by = Math.floor(rnd() * (TILE - 4));
    const h = 2 + Math.floor(rnd() * 2);
    g.fillStyle = P.blade;
    g.fillRect(bx, by, 1, h);
    if (rnd() < 0.5) { g.fillStyle = P.bladeLight; g.fillRect(bx, by, 1, 1); }
  }
  return c;
}

/** Spring grass — bright fresh green with occasional tiny wildflower specks. */
function grassSpringTile(variant: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  const g = c.getContext('2d')!;
  const rnd = mulberry(4000 + variant * 89);
  const base = ['#4ea040', '#56ac48', '#48983c', '#4ea844'][variant % 4];
  g.fillStyle = base;
  g.fillRect(0, 0, TILE, TILE);
  // vivid mottling — lighter bright patches + deeper shadow pockets
  for (let i = 0; i < 28; i++) {
    const x = Math.floor(rnd() * TILE);
    const y = Math.floor(rnd() * TILE);
    const s = 1 + Math.floor(rnd() * 2);
    const roll = rnd();
    g.fillStyle = roll < 0.40 ? '#38742e' : roll < 0.75 ? '#68c05a' : '#50b044';
    g.fillRect(x, y, s + 1, s);
  }
  // fresh blades — brighter green, taller than summer
  for (let i = 0; i < 12; i++) {
    const bx = Math.floor(rnd() * (TILE - 1));
    const by = Math.floor(rnd() * (TILE - 5));
    g.fillStyle = '#5cc450';
    g.fillRect(bx, by, 1, 2 + Math.floor(rnd() * 3));
    if (rnd() < 0.6) { g.fillStyle = '#84e870'; g.fillRect(bx, by, 1, 1); }
  }
  // wildflower specks — tiny white, yellow, violet dots
  const flowerColors = ['#f4f0e0', '#f0e040', '#d080e0', '#f08060', '#60c8f0'];
  for (let i = 0; i < 4; i++) {
    if (rnd() < 0.5) {
      const fx = 2 + Math.floor(rnd() * (TILE - 4));
      const fy = 2 + Math.floor(rnd() * (TILE - 4));
      g.fillStyle = flowerColors[Math.floor(rnd() * flowerColors.length)];
      g.fillRect(fx, fy, 2, 2);
      g.fillStyle = '#f0f8e0';
      g.fillRect(fx, fy, 1, 1);
    }
  }
  return c;
}

/** Autumn grass — warm amber/brown with scattered orange and red leaf flecks. */
function grassAutumnTile(variant: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  const g = c.getContext('2d')!;
  const rnd = mulberry(2000 + variant * 113);
  const base = ['#6e5c30', '#7a6438', '#625430', '#685e38'][variant % 4];
  g.fillStyle = base;
  g.fillRect(0, 0, TILE, TILE);
  // mottling — ochre light patches and dark-brown shadow clumps
  for (let i = 0; i < 26; i++) {
    const x = Math.floor(rnd() * TILE);
    const y = Math.floor(rnd() * TILE);
    const s = 1 + Math.floor(rnd() * 2);
    const roll = rnd();
    g.fillStyle = roll < 0.45 ? '#4e3c20' : roll < 0.8 ? '#8a7040' : '#7a6030';
    g.fillRect(x, y, s + 1, s);
  }
  // dried blades — ochre with warm-gold tips
  for (let i = 0; i < 10; i++) {
    const bx = Math.floor(rnd() * (TILE - 1));
    const by = Math.floor(rnd() * (TILE - 4));
    g.fillStyle = '#8a6c38';
    g.fillRect(bx, by, 1, 2 + Math.floor(rnd() * 2));
    if (rnd() < 0.6) { g.fillStyle = '#b89050'; g.fillRect(bx, by, 1, 1); }
  }
  // fallen leaf flecks — orange, red, yellow
  const leafColors = ['#c84820', '#d86020', '#d4a030', '#c83c18', '#e09020'];
  for (let i = 0; i < 7; i++) {
    const lx = Math.floor(rnd() * (TILE - 2));
    const ly = Math.floor(rnd() * (TILE - 2));
    g.fillStyle = leafColors[Math.floor(rnd() * leafColors.length)];
    g.fillRect(lx, ly, 2, 1);
    if (rnd() < 0.5) g.fillRect(lx + 1, ly + 1, 1, 1);
  }
  return c;
}

/** Winter grass — frost-muted, desaturated, with snow patches and white-tipped blades. */
function grassWinterTile(variant: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  const g = c.getContext('2d')!;
  const rnd = mulberry(3000 + variant * 131);
  const base = ['#4e5850', '#505c52', '#4a5450', '#485052'][variant % 4];
  g.fillStyle = base;
  g.fillRect(0, 0, TILE, TILE);
  // frost mottling — cool blue-white patches
  for (let i = 0; i < 18; i++) {
    const x = Math.floor(rnd() * TILE);
    const y = Math.floor(rnd() * TILE);
    const s = 1 + Math.floor(rnd() * 3);
    g.fillStyle = rnd() < 0.5 ? '#c8d8e4' : '#3c4a40';
    g.fillRect(x, y, s + 1, s);
  }
  // snow patches (larger blobs)
  for (let i = 0; i < 4; i++) {
    const sx = Math.floor(rnd() * (TILE - 5));
    const sy = Math.floor(rnd() * (TILE - 5));
    g.fillStyle = '#dce8f4';
    g.fillRect(sx, sy, 3 + Math.floor(rnd() * 3), 2);
    g.fillStyle = '#eef4fc';
    g.fillRect(sx + 1, sy, 1 + Math.floor(rnd() * 2), 1);
  }
  // frost-tipped blades
  for (let i = 0; i < 8; i++) {
    const bx = Math.floor(rnd() * (TILE - 1));
    const by = Math.floor(rnd() * (TILE - 4));
    g.fillStyle = '#5e6e60';
    g.fillRect(bx, by, 1, 2 + Math.floor(rnd() * 2));
    g.fillStyle = '#d0e0ec'; g.fillRect(bx, by, 1, 1); // frost tip
  }
  return c;
}

/** Spring blossom tree — pink/white cherry-blossom canopy with the same silhouette. */
function treeSpringSprite(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 40; c.height = 44;
  const g = c.getContext('2d')!;
  fillDisc(g, 22, 38, 13, 5, P.shadow);
  g.fillStyle = P.trunkDark; g.fillRect(17, 28, 6, 14);
  g.fillStyle = P.trunk;     g.fillRect(18, 28, 4, 13);
  g.fillStyle = P.trunkLight; g.fillRect(18, 28, 2, 11);
  const cx = 19, cy = 16;
  // deep blossom shadow (cool pink-grey)
  fillDisc(g, cx + 1, cy + 3, 17, 14, '#7a4058');
  fillDisc(g, cx + 2, cy + 4, 14, 11, '#9a5a70');
  // main blossom body (soft pink)
  fillDisc(g, cx, cy + 1, 16, 13, '#d880a0');
  fillDisc(g, cx - 6, cy - 2, 8, 7, '#cc7898');
  fillDisc(g, cx + 7, cy + 1, 8, 7, '#b06880');
  fillDisc(g, cx - 1, cy - 6, 9, 7, '#d880a0');
  // lit upper-left — bright pink and white
  fillDisc(g, cx - 5, cy - 4, 7, 6, '#f0a0c0');
  fillDisc(g, cx - 3, cy - 5, 5, 4, '#fce0ec');
  // white blossom cluster specks
  g.fillStyle = '#fce8f0'; g.fillRect(cx - 8, cy + 2, 2, 2); g.fillRect(cx + 2, cy - 7, 2, 2);
  g.fillStyle = '#ffffff';  g.fillRect(cx - 7, cy + 2, 1, 1); g.fillRect(cx + 2, cy - 7, 1, 1);
  g.fillStyle = '#e87090'; g.fillRect(cx - 1, cy + 1, 2, 2); g.fillRect(cx + 4, cy + 9, 2, 2);
  g.fillStyle = '#fce8f0'; g.fillRect(cx + 9, cy + 5, 2, 2);
  // fallen petal drifts — tiny pink dots near bottom of canopy
  g.fillStyle = '#f4b8cc';
  g.fillRect(cx - 9, cy + 10, 1, 1); g.fillRect(cx + 11, cy + 8, 1, 1);
  g.fillRect(cx + 3, cy + 11, 2, 1); g.fillRect(cx - 4, cy + 9, 1, 1);
  return c;
}

/** Autumn tree — orange/red/gold canopy, more clump variety than summer. */
function treeAutumnSprite(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 40; c.height = 44;
  const g = c.getContext('2d')!;
  // shadow
  fillDisc(g, 22, 38, 13, 5, P.shadow);
  // trunk
  g.fillStyle = P.trunkDark; g.fillRect(17, 28, 6, 14);
  g.fillStyle = P.trunk;     g.fillRect(18, 28, 4, 13);
  g.fillStyle = P.trunkLight; g.fillRect(18, 28, 2, 11);
  const cx = 19, cy = 16;
  // deep shadow base (dark maroon)
  fillDisc(g, cx + 1, cy + 3, 17, 14, '#4a200c');
  fillDisc(g, cx + 2, cy + 4, 14, 11, '#7a2e18');
  // main canopy (mixed orange/crimson clumps — more fragmented than summer)
  fillDisc(g, cx, cy + 1,    15, 12, '#b84c28');
  fillDisc(g, cx - 7, cy,     9,  7, '#c85c1c');
  fillDisc(g, cx + 8, cy + 2, 8,  7, '#9c3818');
  fillDisc(g, cx - 2, cy - 7, 9,  7, '#c04c20');
  fillDisc(g, cx + 4, cy - 4, 7,  6, '#b83c10');
  // gold/yellow clumps (patches of still-holding leaves)
  fillDisc(g, cx - 5, cy - 3, 7, 6, '#d47818');
  fillDisc(g, cx + 6, cy - 5, 5, 4, '#d89020');
  // sun-lit highlights
  fillDisc(g, cx - 4, cy - 5, 5, 4, '#f0a028');
  fillDisc(g, cx - 2, cy - 7, 3, 3, '#f8c830');
  // scattered leaf flecks — scarlet, crimson, gold
  g.fillStyle = '#f0c820'; g.fillRect(cx - 9, cy + 1, 2, 2); g.fillRect(cx + 3, cy - 8, 2, 2);
  g.fillStyle = '#d02818'; g.fillRect(cx - 1, cy + 2, 2, 2); g.fillRect(cx + 5, cy + 8, 2, 2);
  g.fillStyle = '#e87020'; g.fillRect(cx + 10, cy + 5, 2, 2); g.fillRect(cx - 8, cy + 6, 2, 2);
  g.fillStyle = '#a81808'; g.fillRect(cx + 2, cy + 10, 2, 2);
  return c;
}

/** Winter tree — bare trunk with detailed branching and snow clumps. */
function treeWinterSprite(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 40; c.height = 44;
  const g = c.getContext('2d')!;
  // shadow (smaller than leafy tree)
  fillDisc(g, 22, 38, 9, 4, P.shadow);
  // trunk
  g.fillStyle = P.trunkDark; g.fillRect(17, 20, 6, 22);
  g.fillStyle = P.trunk;     g.fillRect(18, 20, 4, 21);
  g.fillStyle = P.trunkLight; g.fillRect(18, 20, 2, 18);
  // bark texture lines
  g.fillStyle = P.trunkDark;
  g.fillRect(19, 26, 1, 4); g.fillRect(20, 32, 1, 5);
  // main branches (radiating from trunk top)
  g.fillStyle = P.trunkDark;
  // left main branch
  g.fillRect(9, 17, 9, 2); g.fillRect(6, 13, 5, 2);
  // left sub-branches
  g.fillRect(8, 11, 2, 3); g.fillRect(10, 12, 2, 1);
  // right main branch
  g.fillRect(22, 16, 10, 2); g.fillRect(30, 13, 5, 2);
  // right sub-branches
  g.fillRect(32, 11, 2, 3); g.fillRect(28, 12, 2, 1);
  // upper central branches
  g.fillRect(18, 8, 4, 12);
  g.fillRect(14, 8, 4, 2); g.fillRect(12, 5, 3, 3);
  g.fillRect(23, 10, 4, 2); g.fillRect(25, 7, 3, 3);
  // fine twigs (1px)
  g.fillStyle = '#6a5a48';
  g.fillRect(5, 12, 2, 1); g.fillRect(33, 12, 2, 1);
  g.fillRect(11, 4, 2, 2); g.fillRect(26, 6, 2, 2);
  g.fillRect(18, 5, 1, 3); g.fillRect(21, 5, 1, 3);
  // snow accumulation on branches (thick where branch is wide)
  g.fillStyle = '#d0e4f2';
  g.fillRect(5, 11, 6, 2); g.fillRect(29, 11, 6, 2);
  g.fillRect(13, 7, 4, 2); g.fillRect(22, 7, 4, 2);
  g.fillRect(17, 4, 5, 2);
  // snow highlight
  g.fillStyle = '#eaf4fc';
  g.fillRect(6, 11, 4, 1); g.fillRect(30, 11, 4, 1);
  g.fillRect(14, 7, 2, 1); g.fillRect(23, 7, 2, 1);
  g.fillRect(18, 4, 3, 1);
  return c;
}

/** Worn bare-earth patch fading into grass at the edges. */
function dirtPatchTile(): HTMLCanvasElement {
  const c = grassTile(0);
  const g = c.getContext('2d')!;
  const rnd = mulberry(404);
  // ragged dirt blob (lighter mid centre, darker rim)
  fillDisc(g, 16, 16, 14, 13, P.dirtMid);
  fillDisc(g, 15, 15, 11, 10, P.dirtPatch);
  fillDisc(g, 13, 13, 6, 5, P.dirtLight); // warm-lit centre
  // scattered pebbles + scuff specks for texture
  for (let i = 0; i < 16; i++) {
    const x = 5 + Math.floor(rnd() * 22);
    const y = 5 + Math.floor(rnd() * 22);
    g.fillStyle = rnd() < 0.5 ? P.dirtMid : P.gravelC;
    g.fillRect(x, y, 1 + (rnd() < 0.3 ? 1 : 0), 1);
  }
  // ragged grass tufts intruding at the edges
  g.fillStyle = P.blade;
  for (let i = 0; i < 5; i++) {
    const ang = rnd() * Math.PI * 2;
    const x = Math.round(16 + Math.cos(ang) * 13);
    const y = Math.round(16 + Math.sin(ang) * 12);
    g.fillRect(x, y, 1, 2);
  }
  return c;
}

/**
 * Animated water. Cool desaturated body with gentle horizontal wave bands
 * (deep troughs + lighter crests) that drift, plus a few bright sky glints.
 * Two frames offset so the surface shimmers; tiles seamlessly horizontally.
 */
function waterTile(frame: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  const g = c.getContext('2d')!;
  g.fillStyle = P.water1;
  g.fillRect(0, 0, TILE, TILE);
  const off = frame * 4;
  // wave crests (lighter mid) and troughs (deepest), sinusoidal drift
  for (let y = 0; y < TILE; y += 4) {
    const phase = Math.sin((y + off) * 0.6);
    const sx = Math.floor(phase * 3);
    g.fillStyle = P.water2;
    for (let x = -8; x < TILE; x += 8) g.fillRect(((x + sx + off) % TILE + TILE) % TILE, y, 5, 1);
    g.fillStyle = P.water3;
    for (let x = -8; x < TILE; x += 8) g.fillRect(((x + sx + off + 4) % TILE + TILE) % TILE, y + 2, 4, 1);
  }
  // sky glints — brightest, drift faster
  const rnd = mulberry(7 + frame);
  g.fillStyle = P.waterGlint;
  for (let i = 0; i < 4; i++) {
    const gx = (Math.floor(rnd() * TILE) + off * 2) % TILE;
    const gy = Math.floor(rnd() * TILE);
    g.fillRect(gx, gy, 3, 1);
  }
  g.fillStyle = P.waterGlint2;
  g.fillRect((10 + off * 2) % TILE, 6, 2, 1);
  g.fillRect((22 + off) % TILE, 18, 2, 1);
  return c;
}

/** Winter frozen water — pale blue-white ice with crack lines and snow patches. */
function waterWinterTile(variant: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  const g = c.getContext('2d')!;
  const rnd = mulberry(8800 + variant * 61);
  // ice base — pale desaturated blue
  g.fillStyle = '#b8d4e8';
  g.fillRect(0, 0, TILE, TILE);
  // subtle surface variation (lighter patches = compressed ice, darker = deep)
  for (let i = 0; i < 12; i++) {
    const x = Math.floor(rnd() * TILE);
    const y = Math.floor(rnd() * TILE);
    const s = 2 + Math.floor(rnd() * 3);
    g.fillStyle = rnd() < 0.5 ? '#cce0f0' : '#a0c0d8';
    g.fillRect(x, y, s, s);
  }
  // crack lines (thin dark blue-grey)
  g.fillStyle = '#708898';
  const crackX = 4 + Math.floor(rnd() * (TILE - 8));
  const crackY = 4 + Math.floor(rnd() * (TILE - 8));
  g.fillRect(crackX, crackY, 1, 6 + Math.floor(rnd() * 6));
  g.fillRect(crackX, crackY, 8 + Math.floor(rnd() * 6), 1);
  if (rnd() < 0.5) {
    g.fillRect(crackX + 5, crackY + 3, 1, 5);
    g.fillRect(crackX + 5, crackY + 3, 5, 1);
  }
  // snow patches on ice
  g.fillStyle = '#e8f0f8';
  for (let i = 0; i < 3; i++) {
    if (rnd() < 0.6) {
      const sx = Math.floor(rnd() * (TILE - 5));
      const sy = Math.floor(rnd() * (TILE - 5));
      g.fillRect(sx, sy, 3 + Math.floor(rnd() * 3), 2);
      g.fillStyle = '#f4f8fc'; g.fillRect(sx + 1, sy, 1 + Math.floor(rnd() * 2), 1);
      g.fillStyle = '#e8f0f8';
    }
  }
  // sky glint on flat ice
  g.fillStyle = '#eef8ff';
  g.fillRect(Math.floor(rnd() * (TILE - 4)), Math.floor(rnd() * (TILE - 2)), 4, 1);
  return c;
}

/** Filled-disc helper used by several round sprites (no antialias, pixel-crisp). */
function fillDisc(g: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, col: string) {
  g.fillStyle = col;
  for (let dy = -ry; dy <= ry; dy++) {
    const t = dy / ry;
    const w = Math.floor(rx * Math.sqrt(Math.max(0, 1 - t * t)) + 0.5);
    if (w <= 0) continue;
    g.fillRect(Math.round(cx - w), Math.round(cy + dy), w * 2, 1);
  }
}

/**
 * Big rounded canopy overhanging the tile (40×44, drawn offset by renderer).
 * Hue-shifted foliage: cool deep shadow at the lower-right rim climbing to a
 * warm sunlit highlight on the upper-left crown. Clumped, not a flat blob.
 */
function treeSprite(marked: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 40; c.height = 44;
  const g = c.getContext('2d')!;
  // soft cool ground shadow, offset to the lower-right (top-left light)
  g.fillStyle = P.shadow;
  fillDisc(g, 22, 38, 13, 5, P.shadow);
  // trunk — lit left edge, cool right shadow
  g.fillStyle = marked ? '#c25b2e' : P.trunkDark;
  g.fillRect(17, 28, 6, 14);
  g.fillStyle = marked ? '#d06a3a' : P.trunk;
  g.fillRect(18, 28, 4, 13);
  g.fillStyle = marked ? '#e07848' : P.trunkLight;
  g.fillRect(18, 28, 2, 11);
  // bark texture lines
  g.fillStyle = marked ? '#a04020' : P.trunkDark;
  g.fillRect(19, 33, 1, 4);
  g.fillRect(20, 38, 1, 4);

  const cx = 19, cy = 16;
  // base/deep canopy (cool, occluded underside)
  fillDisc(g, cx + 1, cy + 3, 17, 14, P.treeLeafDeep);
  fillDisc(g, cx + 2, cy + 4, 14, 11, P.treeLeafDark);
  // main body
  fillDisc(g, cx, cy + 1, 16, 13, P.treeLeaf);
  // a few overlapping clumps to break the silhouette
  fillDisc(g, cx - 6, cy - 2, 8, 7, P.treeLeaf);
  fillDisc(g, cx + 7, cy + 1, 8, 7, P.treeLeafDark);
  fillDisc(g, cx - 1, cy - 6, 9, 7, P.treeLeaf);
  // warm-lit upper-left highlights (sun)
  fillDisc(g, cx - 5, cy - 4, 7, 6, P.treeLeafLight);
  fillDisc(g, cx - 3, cy - 5, 5, 4, P.treeLeafTop);
  // dappled flecks of warm light
  g.fillStyle = P.treeLeafTop;
  g.fillRect(cx - 8, cy + 2, 2, 2);
  g.fillRect(cx + 2, cy - 7, 2, 2);
  g.fillRect(cx - 1, cy + 1, 2, 2);
  // a couple of cool shadow dapples lower-right
  g.fillStyle = P.treeLeafDeep;
  g.fillRect(cx + 9, cy + 6, 2, 2);
  g.fillRect(cx + 4, cy + 9, 2, 2);

  if (marked) {
    g.fillStyle = '#c25b2e';
    g.fillRect(31, 0, 8, 8);
    g.fillStyle = '#f08040';
    g.fillRect(33, 1, 4, 4);
  }
  return c;
}

/**
 * A clustered boulder on grass. Three visual variants for field variety.
 */
function rockSprite(marked: boolean, variant = 0): HTMLCanvasElement {
  const c = grassTile(variant % 4);
  const g = c.getContext('2d')!;

  if (variant === 1) {
    // Two medium boulders side-by-side, centre-left bias
    fillDisc(g, 14, 23, 10, 4, P.shadow);
    fillDisc(g, 13, 16, 10, 9, P.rockDarker);
    fillDisc(g, 12, 15, 9, 8, P.rockDark);
    fillDisc(g, 11, 14, 7, 6, P.rock);
    g.fillStyle = P.rockLight; g.fillRect(7, 8, 9, 6); g.fillRect(6, 11, 6, 4);
    g.fillStyle = P.rockHighlight; g.fillRect(8, 8, 5, 3);
    fillDisc(g, 22, 18, 7, 6, P.rockDarker);
    fillDisc(g, 21, 17, 6, 5, P.rockDark);
    fillDisc(g, 20, 16, 5, 4, P.rock);
    g.fillStyle = P.rockLight; g.fillRect(17, 12, 7, 4);
    g.fillStyle = P.rockDarker; g.fillRect(13, 13, 1, 6); g.fillRect(13, 18, 5, 1);
  } else if (variant === 2) {
    // Single large flat-topped slab, tilted — more angular look
    fillDisc(g, 18, 26, 12, 4, P.shadow);
    g.fillStyle = P.rockDarker; g.fillRect(7, 14, 20, 12); // flat base
    g.fillStyle = P.rockDark;   g.fillRect(8, 12, 18, 12);
    g.fillStyle = P.rock;       g.fillRect(9, 11, 16, 11);
    g.fillStyle = P.rockLight;  g.fillRect(9, 11, 16, 4);  // top face
    g.fillStyle = P.rockHighlight; g.fillRect(9, 11, 8, 2);
    // left angled face
    g.fillStyle = P.rockDark;
    for (let i = 0; i < 5; i++) g.fillRect(7 + i, 14 + i, 1, 9 - i);
    // crack
    g.fillStyle = P.rockDarker;
    g.fillRect(18, 11, 1, 7); g.fillRect(18, 17, 5, 1);
  } else {
    // Original variant 0: classic one large + one small boulder
    fillDisc(g, 17, 25, 13, 4, P.shadow);
    fillDisc(g, 16, 17, 13, 11, P.rockDarker);
    fillDisc(g, 15, 16, 12, 10, P.rockDark);
    fillDisc(g, 14, 15, 10, 8, P.rock);
    g.fillStyle = P.rockLight; g.fillRect(8, 9, 11, 7); g.fillRect(7, 12, 8, 5);
    g.fillStyle = P.rockHighlight; g.fillRect(9, 9, 7, 3); g.fillRect(8, 11, 4, 2);
    fillDisc(g, 23, 22, 6, 4, P.rockDark);
    fillDisc(g, 22, 21, 5, 3, P.rock);
    g.fillStyle = P.rockLight; g.fillRect(20, 19, 4, 2);
    g.fillStyle = P.rockDarker; g.fillRect(15, 12, 1, 9); g.fillRect(15, 18, 6, 1); g.fillRect(11, 16, 4, 1);
  }

  if (marked) {
    g.fillStyle = '#7a3018';
    g.fillRect(8, 13, 7, 2); g.fillRect(10, 15, 5, 1);
    g.fillRect(17, 9, 2, 5); g.fillRect(19, 11, 3, 2);
    g.fillStyle = '#b84828';
    g.fillRect(9, 13, 5, 1); g.fillRect(10, 14, 4, 1); g.fillRect(17, 9, 1, 4);
    g.fillStyle = '#e06030';
    g.fillRect(12, 13, 2, 1); g.fillRect(18, 10, 1, 1);
    g.fillStyle = '#e86028'; g.fillRect(26, 3, 4, 4);
    g.fillStyle = '#f09050'; g.fillRect(27, 4, 2, 2);
  }
  return c;
}

/**
 * Sandy beach tile — warm gold with subtle ripple texture and the occasional
 * pebble, distinct from dark-brown soil (farmable earth).
 */
function sandTile(variant = 0): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  const g = c.getContext('2d')!;
  const rnd = mulberry(99 + variant * 173);
  // Base sandy gold — slight hue shift per variant
  const bases = ['#c8a84c', '#caa84e', '#c4a448', '#ccb050'];
  g.fillStyle = bases[variant % 4];
  g.fillRect(0, 0, TILE, TILE);
  if (variant === 2) {
    // Coarser ripple — more compressed waves, rougher beach
    g.fillStyle = '#b89640';
    for (let y = 2; y < TILE; y += 5) g.fillRect(0, y, TILE, 1);
    g.fillStyle = '#d4b048';
    for (let y = 0; y < TILE; y += 5) g.fillRect(0, y, TILE, 1);
    // More pebbles
    g.fillStyle = '#9a7828';
    for (let i = 0; i < 8; i++) {
      const px2 = Math.floor(rnd() * (TILE - 3)) + 1;
      const py2 = Math.floor(rnd() * (TILE - 3)) + 1;
      g.fillRect(px2, py2, 2 + (rnd() < 0.3 ? 1 : 0), 1);
      g.fillRect(px2, py2 + 1, 1, 1);
    }
  } else if (variant === 3) {
    // Dry fine sand — less visible ripple, more uniform shimmer
    g.fillStyle = '#d8bc5c';
    for (let i = 0; i < 16; i++) {
      const fx = Math.floor(rnd() * (TILE - 2));
      const fy = Math.floor(rnd() * (TILE - 2));
      g.fillRect(fx, fy, 1 + (rnd() < 0.3 ? 1 : 0), 1);
    }
    g.fillStyle = '#a89038';
    for (let i = 0; i < 5; i++) {
      g.fillRect(Math.floor(rnd() * (TILE - 3)), Math.floor(rnd() * (TILE - 3)), 2, 1);
    }
  } else {
    // Original pattern (variants 0 and 1 with slight variation)
    g.fillStyle = variant === 1 ? '#d0b452' : '#d4b45a';
    for (let y = 3; y < TILE; y += 7) g.fillRect(0, y, TILE, 2);
    g.fillStyle = '#b89640';
    for (let y = 5; y < TILE; y += 7) g.fillRect(0, y, TILE, 1);
    g.fillStyle = '#dfc070';
    for (let i = 0; i < 8; i++) {
      const fx = Math.floor(rnd() * (TILE - 2));
      const fy = Math.floor(rnd() * (TILE - 2));
      g.fillRect(fx, fy, 2, 1);
    }
    g.fillStyle = '#a08030';
    for (let i = 0; i < 3 + variant; i++) {
      const px2 = Math.floor(rnd() * (TILE - 3)) + 1;
      const py2 = Math.floor(rnd() * (TILE - 3)) + 1;
      g.fillRect(px2, py2, 2, 1);
      g.fillRect(px2 + 1, py2 + 1, 1, 1);
    }
  }
  return c;
}

/**
 * Plowed field. Furrows run horizontally: each ridge has a warm-lit crest
 * (top edge, facing the light) and a cool shadow in the trough below. Crops
 * grow in rows along the ridges, advancing through the four stages.
 */
function soilTile(stage: 'bare' | 'sown' | 'grown' | 'ripe'): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  const g = c.getContext('2d')!;
  g.fillStyle = P.soil;
  g.fillRect(0, 0, TILE, TILE);
  // furrow ridges every 6px: lit crest on top, cool trough below
  for (let y = 0; y < TILE; y += 6) {
    g.fillStyle = P.soilDark;            // trough shadow
    g.fillRect(0, y + 4, TILE, 2);
    g.fillStyle = P.soilMid;             // warm ridge crest
    g.fillRect(0, y, TILE, 2);
    g.fillStyle = P.dirtLight;           // crest highlight fleck
    for (let x = 2; x < TILE; x += 9) g.fillRect(x, y, 2, 1);
  }
  if (stage !== 'bare') {
    const rnd = mulberry(stage === 'sown' ? 11 : stage === 'grown' ? 22 : 33);
    for (let y = 3; y < TILE; y += 6) {
      for (let x = 3; x < TILE - 2; x += 6) {
        const jx = x + (rnd() < 0.5 ? 0 : 1);
        if (stage === 'sown') {
          // small sprouts
          g.fillStyle = P.cropDark; g.fillRect(jx + 1, y, 1, 2);
          g.fillStyle = P.crop; g.fillRect(jx + 1, y, 1, 1);
        } else if (stage === 'grown') {
          // leafy clumps, lit left
          g.fillStyle = P.cropDark; g.fillRect(jx, y - 3, 4, 5);
          g.fillStyle = P.crop;     g.fillRect(jx, y - 3, 3, 4);
          g.fillStyle = P.bladeLight; g.fillRect(jx, y - 3, 1, 2);
        } else {
          // ripe: golden ears on green stalks
          g.fillStyle = P.cropDark; g.fillRect(jx + 1, y - 1, 1, 4);
          g.fillStyle = P.cropRipe; g.fillRect(jx, y - 5, 3, 4);
          g.fillStyle = P.grain;    g.fillRect(jx, y - 5, 2, 2);
        }
      }
    }
  }
  return c;
}

/** Frozen winter farmland — frost-grey furrows with ice-blue sheen and snow streaks. */
function soilWinterTile(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  const g = c.getContext('2d')!;
  // desaturated grey-brown base
  g.fillStyle = '#5a5450'; g.fillRect(0, 0, TILE, TILE);
  for (let y = 0; y < TILE; y += 6) {
    g.fillStyle = '#484440'; g.fillRect(0, y + 4, TILE, 2); // frozen trough
    g.fillStyle = '#6e6a64'; g.fillRect(0, y, TILE, 2);     // ridge
    g.fillStyle = '#c8d0d8'; // ice sheen on crest
    for (let x = 2; x < TILE; x += 9) g.fillRect(x, y, 2, 1);
  }
  // snow streaks across the top of ridges
  g.fillStyle = '#d8e0e8';
  for (let y = 0; y < TILE; y += 6) g.fillRect(0, y, TILE, 1);
  g.fillStyle = '#eef2f8';
  for (let x = 1; x < TILE; x += 14) g.fillRect(x, 0, 4, TILE);
  return c;
}

/** Flax field — thin stalks with blue-violet flowers; golden seedpods when ripe. */
function flaxSoilTile(stage: 'sown' | 'grown' | 'ripe'): HTMLCanvasElement {
  const base = document.createElement('canvas');
  base.width = TILE; base.height = TILE;
  const g = base.getContext('2d')!;
  g.fillStyle = P.soil; g.fillRect(0, 0, TILE, TILE);
  for (let y = 0; y < TILE; y += 6) {
    g.fillStyle = P.soilDark; g.fillRect(0, y + 4, TILE, 2);
    g.fillStyle = P.soilMid;  g.fillRect(0, y, TILE, 2);
  }
  const rnd = mulberry(stage === 'sown' ? 501 : stage === 'grown' ? 502 : 503);
  for (let y = 3; y < TILE; y += 6) {
    for (let x = 2; x < TILE - 2; x += 5) {
      const jx = x + (rnd() < 0.4 ? 0 : 1);
      if (stage === 'sown') {
        // tiny seedlings — pale green spikes
        g.fillStyle = '#6aaa50'; g.fillRect(jx, y, 1, 2);
        g.fillStyle = '#8acc70'; g.fillRect(jx, y, 1, 1);
      } else if (stage === 'grown') {
        // tall thin stalks with blue flowers on top
        g.fillStyle = '#509050'; g.fillRect(jx, y - 4, 1, 6);
        g.fillStyle = '#7098c0'; // blue flower
        g.fillRect(jx - 1, y - 5, 3, 2);
        g.fillStyle = '#a0c8f0'; g.fillRect(jx, y - 5, 1, 1);
      } else {
        // ripe: golden-brown seedpods, pale stalks
        g.fillStyle = '#8a7840'; g.fillRect(jx, y - 2, 1, 5);
        g.fillStyle = '#c0a050'; // pod
        g.fillRect(jx - 1, y - 4, 3, 3);
        g.fillStyle = '#d8b860'; g.fillRect(jx, y - 4, 1, 2);
      }
    }
  }
  return base;
}

function roadTile(kind: string, plan: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  const g = c.getContext('2d')!;
  switch (kind) {
    case 'dirt': {
      g.fillStyle = P.rutBrown;
      g.fillRect(0, 0, TILE, TILE);
      // Soft grass shoulders with slight bleed
      g.fillStyle = P.rutLight;
      g.fillRect(0, 0, 3, TILE);
      g.fillRect(TILE - 3, 0, 3, TILE);
      g.fillStyle = P.grassC;
      g.fillRect(0, 0, 1, TILE); g.fillRect(TILE - 1, 0, 1, TILE); // grass edge strip
      // Wheel ruts — slightly uneven width to look worn
      g.fillStyle = P.rutDark;
      g.fillRect(5, 0, 4, TILE); g.fillRect(23, 0, 4, TILE);
      g.fillStyle = P.rutBrown;
      g.fillRect(6, 0, 2, TILE); g.fillRect(24, 0, 2, TILE);
      // Rut depth variation: occasional deeper patch
      g.fillStyle = P.rutDark;
      for (let i = 0; i < 3; i++) {
        const ry = (i * 11 + 5) % (TILE - 4);
        g.fillRect(5, ry, 3, 2); g.fillRect(23, ry + 6, 3, 2);
      }
      // Center grass strip (barely used center of road)
      g.fillStyle = P.grassD;
      for (let y = 2; y < TILE - 2; y += 7) g.fillRect(14, y, 4, 3);
      // Stone pebbles scattered across road
      g.fillStyle = P.gravelC;
      for (let i = 0; i < 10; i++) {
        g.fillRect((i * 7 + 2) % 26, (i * 11 + 3) % 28, 2, 1);
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
      // Shoulders slightly lighter (tamped edge)
      g.fillStyle = P.gravelA;
      g.fillRect(0, 0, 2, TILE); g.fillRect(TILE - 2, 0, 2, TILE);
      // Dense pebble bed — 3 shades for depth
      g.fillStyle = P.gravelA;
      for (let i = 0; i < 28; i++) g.fillRect((i * 7) % 30, (i * 11) % 30, 2 + (i % 3 === 0 ? 1 : 0), 1);
      g.fillStyle = P.gravelC;
      for (let i = 0; i < 16; i++) g.fillRect((i * 13 + 3) % 30, (i * 7 + 5) % 30, 1, 2);
      // Occasional larger stone
      g.fillStyle = P.rock;
      for (let i = 0; i < 4; i++) g.fillRect((i * 19 + 4) % 26, (i * 17 + 7) % 26, 3, 2);
      g.fillStyle = P.rockLight;
      for (let i = 0; i < 4; i++) g.fillRect((i * 19 + 4) % 26, (i * 17 + 7) % 26, 3, 1);
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
 * Top-down pawn at 32×32. Read as a figure seen from above-front: a hair-capped
 * head (hair frames the crown and back, face/shoulders catch the warm top-left
 * light), a tunic torso with shaded sides, two arms, and feet that swing for the
 * 2-frame walk. Light is top-left: left side highlighted, right side shadowed.
 * Drop shadow sits under the feet. `armed` adds a slung spear on the right.
 */
interface PawnLook {
  skin: string; skinShad: string; skinLight: string;
  hair: string; hairDk: string;
  cloth: string; clothDk: string; clothLt: string;
}
function pawnSprite(look: PawnLook, frame: number, armed = false): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  const g = c.getContext('2d')!;
  const px = (x: number, y: number, w: number, h: number, col: string) => {
    g.fillStyle = col; g.fillRect(x, y, w, h);
  };
  const f0 = frame === 0;
  // Centre column ~ 15.5. Light from top-left.

  // --- ground shadow (under feet), faintly cool ---
  px(9, 27, 14, 3, 'rgba(28,22,40,0.30)');
  px(11, 26, 10, 1, 'rgba(28,22,40,0.18)');

  // --- slung spear (drawn behind body so it reads as carried over shoulder) ---
  if (armed) {
    px(21, 4, 2, 22, P.trunk);          // shaft
    px(21, 4, 1, 22, P.trunkLight);     // lit edge
    px(20, 1, 4, 5, P.rockDark);        // spearhead base
    px(21, 0, 2, 5, P.rockLight);       // spearhead
    px(21, 0, 1, 3, P.rockHighlight);   // glint
  }

  // --- legs / feet (under torso). Trousers darker than tunic. ---
  const trouser = look.clothDk, trouserDk = P.trunkDark;
  // left leg lane cols 11-14, right leg lane cols 17-20
  const lLeg = f0 ? 0 : 2;   // forward foot reaches +rows
  const rLeg = f0 ? 2 : 0;
  px(11, 22, 4, 4 + lLeg, trouser);
  px(17, 22, 4, 4 + rLeg, trouser);
  px(11, 22, 1, 4 + lLeg, look.clothLt); // lit edge on left leg
  // boots
  px(11, 26 + lLeg, 4, 2, trouserDk);
  px(17, 26 + rLeg, 4, 2, trouserDk);

  // --- torso / tunic ---
  // outline silhouette
  px(8, 12, 16, 12, P.outline);
  // shoulders slightly wider at top
  px(7, 13, 18, 9, P.outline);
  // tunic fill (inset)
  px(9, 13, 14, 10, look.cloth);
  // left highlight rim (warm, lit)
  px(9, 13, 2, 10, look.clothLt);
  // right shadow side (cool)
  px(21, 13, 2, 10, look.clothDk);
  px(20, 13, 1, 10, look.clothDk);
  // shoulder tops catch light
  px(9, 13, 14, 1, look.clothLt);
  // centre chest fold highlight
  px(15, 14, 2, 6, look.clothLt);
  // belt
  px(9, 21, 14, 2, P.trunkDark);
  px(15, 21, 2, 2, P.grain);

  // --- arms (sit at sides, slight swing opposite to legs) ---
  const armSwing = f0 ? 1 : -1;
  // left arm
  px(7, 14 + (armSwing > 0 ? 1 : 0), 3, 6, look.cloth);
  px(7, 14 + (armSwing > 0 ? 1 : 0), 1, 6, look.clothLt);
  // right arm
  px(22, 14 + (armSwing < 0 ? 1 : 0), 3, 6, look.clothDk);
  // hands (skin)
  px(7, 20 + (armSwing > 0 ? 1 : 0), 3, 2, look.skinShad);
  px(22, 20 + (armSwing < 0 ? 1 : 0), 3, 2, look.skinShad);

  // --- head ---
  // hair/skull outline
  px(9, 3, 14, 11, P.outline);
  // hair (back/crown), shadow-shifted
  px(10, 4, 12, 9, look.hairDk);
  px(10, 4, 12, 5, look.hair);        // lit upper hair
  px(10, 4, 6, 4, look.hair);
  // warm top-left hair highlight
  px(11, 4, 4, 2, look.hair);
  // face oval (skin), inset, leaving hair fringe on sides + top
  px(11, 7, 10, 6, look.skin);
  // warm forehead/cheek highlight (top-left)
  px(11, 7, 5, 2, look.skinLight);
  px(11, 9, 3, 2, look.skinLight);
  // right-side cheek shadow (cool)
  px(19, 8, 2, 5, look.skinShad);
  px(11, 12, 10, 1, look.skinShad);   // jaw/chin shade
  // eyes (small, hint of facing forward)
  px(13, 10, 1, 1, P.outline);
  px(18, 10, 1, 1, P.outline);

  return c;
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
  g.fillRect(7, 19, 18, 2);     // underside shadow
  g.fillStyle = P.clothLight1;
  g.fillRect(7, 13, 18, 1);     // lit top edge
  g.fillStyle = P.skinBShad;
  g.fillRect(1, 14, 7, 7);
  g.fillStyle = P.skinB;
  g.fillRect(1, 14, 7, 2);
  g.fillStyle = P.hairA;
  g.fillRect(1, 12, 7, 4);
  g.fillStyle = P.clothDark1;
  g.fillRect(25, 16, 5, 5);     // boots
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

/**
 * Deer: top-down perspective, warm tan body, antlers rising from head.
 * Fills most of the 32×32 tile so it reads clearly when blitted at 20px.
 */
function deerSprite(frame: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  const g = c.getContext('2d')!;
  const f0 = frame === 0;

  const bod = '#b87848', bodDk = '#8a5a2c', bodLt = '#d09c60';
  const legC = '#7a5028', ant = '#9c7238';

  // Shadow
  g.fillStyle = P.shadow; g.fillRect(6, 27, 20, 4);

  // Legs — 2px wide stubs, front pair and back pair swap forward each frame
  g.fillStyle = legC;
  if (f0) {
    g.fillRect(10, 22, 2, 6); g.fillRect(15, 21, 2, 5); // front: left fwd, right back
    g.fillRect(20, 21, 2, 5); g.fillRect(25, 22, 2, 6); // rear: left back, right fwd
  } else {
    g.fillRect(10, 21, 2, 5); g.fillRect(15, 22, 2, 6); // alternate
    g.fillRect(20, 22, 2, 6); g.fillRect(25, 21, 2, 5);
  }

  // Body — tapered oval, shadow right/lower, lit upper-left
  fillDisc(g, 18, 17, 12, 7, bodDk);
  fillDisc(g, 17, 16, 12, 7, bod);
  fillDisc(g, 12, 13, 8,  5, bodLt);

  // White rump patch
  g.fillStyle = '#ece4cc'; g.fillRect(26, 12, 4, 6);
  g.fillStyle = '#f4ede0'; g.fillRect(27, 12, 3, 5);

  // Neck (connects body to head)
  g.fillStyle = bod;    g.fillRect(7, 10, 8, 8);
  g.fillStyle = bodLt;  g.fillRect(7, 10, 4, 6);  // lit side
  g.fillStyle = bodDk;  g.fillRect(13, 10, 2, 8); // shadow side

  // Head
  fillDisc(g, 7, 7, 6, 5, bodDk);
  fillDisc(g, 6, 6, 6, 5, bod);
  fillDisc(g, 3, 4, 4, 3, bodLt);

  // Snout / nose
  g.fillStyle = '#5a2e10'; g.fillRect(1, 8, 5, 3);
  g.fillStyle = '#3a1a08'; g.fillRect(1, 9, 2, 1); // nostril

  // Eye
  g.fillStyle = P.outline; g.fillRect(8, 5, 2, 1);
  g.fillStyle = '#e0c890'; g.fillRect(8, 5, 1, 1); // glint

  // Ear (visible from above)
  g.fillStyle = bodDk; g.fillRect(9, 2, 4, 4);
  g.fillStyle = '#c07050'; g.fillRect(10, 3, 2, 2); // inner pink

  // Antlers
  g.fillStyle = ant;
  g.fillRect(5, 0, 2, 5); g.fillRect(3, 0, 3, 1); g.fillRect(4, 1, 1, 1); // left + tine
  g.fillRect(9, 0, 2, 4); g.fillRect(9, 0, 5, 1); g.fillRect(11, 1, 1, 1); // right + tine

  return c;
}

/**
 * Wolf: stockier dark-grey body, prominent fanged snout, pointed ears, bushy tail.
 * Differentiated from deer by color and silhouette at small display sizes.
 */
function wolfSprite(frame: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  const g = c.getContext('2d')!;
  const f0 = frame === 0;

  const bod = '#727280', bodDk = '#4a4a58', bodLt = '#9090a0';
  const legC = '#38384a';

  // Shadow
  g.fillStyle = P.shadow; g.fillRect(5, 27, 22, 4);

  // Bushy tail (curls up on the right side)
  g.fillStyle = bodDk;  g.fillRect(26,  8, 4, 10);
  g.fillStyle = bod;    g.fillRect(27,  8, 2,  9);
  g.fillStyle = '#ccccd8'; g.fillRect(26, 7, 4, 3); // white tip

  // Legs — slightly heavier than deer
  g.fillStyle = legC;
  if (f0) {
    g.fillRect(9,  23, 2, 5); g.fillRect(14, 22, 2, 4);
    g.fillRect(20, 22, 2, 4); g.fillRect(25, 23, 2, 5);
  } else {
    g.fillRect(9,  22, 2, 4); g.fillRect(14, 23, 2, 5);
    g.fillRect(20, 23, 2, 5); g.fillRect(25, 22, 2, 4);
  }

  // Body — heavier/broader than deer
  fillDisc(g, 18, 18, 12, 8, bodDk);
  fillDisc(g, 17, 17, 12, 8, bod);
  fillDisc(g, 11, 13,  8, 6, bodLt);

  // Neck
  g.fillStyle = bod;   g.fillRect(6, 11, 9, 8);
  g.fillStyle = bodLt; g.fillRect(6, 11, 5, 6);
  g.fillStyle = bodDk; g.fillRect(13, 11, 2, 8);

  // Head (broader, lower-set)
  fillDisc(g, 7, 8, 7, 5, bodDk);
  fillDisc(g, 6, 7, 7, 5, bod);
  fillDisc(g, 2, 5, 4, 3, bodLt);

  // Pointed ears
  g.fillStyle = bodDk;
  g.fillRect(5, 2, 3, 5);  // left ear
  g.fillRect(11, 3, 3, 4); // right ear (partially hidden)
  g.fillStyle = '#c05858'; g.fillRect(6, 3, 1, 3); // inner ear flush
  g.fillStyle = '#c05858'; g.fillRect(12, 4, 1, 2);

  // Snout (longer and broader than deer)
  g.fillStyle = bodDk; g.fillRect(0, 10, 6, 4);
  g.fillStyle = bod;   g.fillRect(0, 10, 4, 3);
  g.fillStyle = '#141010'; g.fillRect(0, 11, 2, 1); // nostril
  // Teeth hint
  g.fillStyle = '#e0dcd0'; g.fillRect(1, 13, 4, 1);

  // Eye — intense yellow glint
  g.fillStyle = '#141010'; g.fillRect(7, 6, 2, 2);
  g.fillStyle = '#c8c040'; g.fillRect(8, 6, 1, 1);

  return c;
}

/** Berry bush — dark green leaves, red/purple berry clusters. */
function berryBushSprite(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  const g = c.getContext('2d')!;
  // shadow
  fillDisc(g, 16, 27, 8, 3, P.shadow);
  // bush body (two overlapping leaf clumps)
  fillDisc(g, 13, 19, 9, 8, P.treeLeafDark);
  fillDisc(g, 20, 20, 8, 7, P.treeLeafDark);
  fillDisc(g, 13, 18, 8, 7, P.treeLeaf);
  fillDisc(g, 19, 19, 7, 6, P.treeLeaf);
  // warm lit highlight
  fillDisc(g, 11, 16, 5, 4, P.treeLeafLight);
  g.fillStyle = P.treeLeafTop; g.fillRect(10, 14, 3, 2);
  // berry clusters — 2×2 round dots with highlight + blossom-end pip
  const berries: [number, number][] = [[12,20],[15,22],[18,19],[21,21],[14,18],[20,23]];
  for (const [bx, by] of berries) {
    g.fillStyle = '#7a1e2c'; g.fillRect(bx, by, 2, 2);
    g.fillStyle = '#c04050'; g.fillRect(bx, by, 2, 1);
    g.fillStyle = '#e87080'; g.fillRect(bx, by, 1, 1);
    g.fillStyle = '#280810'; g.fillRect(bx + 1, by + 1, 1, 1); // blossom end
  }
  return c;
}

/** Mushroom cluster — pale tan caps with buff stems. */
function mushroomClusterSprite(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  const g = c.getContext('2d')!;
  fillDisc(g, 16, 28, 8, 2, P.shadow);
  // stems
  g.fillStyle = '#c8b890'; g.fillRect(10, 22, 3, 5); g.fillRect(17, 23, 3, 4); g.fillRect(22, 21, 3, 6);
  g.fillStyle = '#a89870'; g.fillRect(11, 23, 1, 4); g.fillRect(18, 24, 1, 3); g.fillRect(23, 22, 1, 5);
  // caps (rounded top, darker underside)
  const drawCap = (cx: number, cy: number, rw: number, rh: number) => {
    fillDisc(g, cx, cy, rw, rh, '#7a5030');        // shadow underside
    fillDisc(g, cx, cy - 1, rw - 1, rh - 1, '#b88060'); // mid cap
    g.fillStyle = '#c89870'; g.fillRect(cx - rw + 3, cy - rh + 1, rw * 2 - 5, 2); // warm lit top
    g.fillStyle = '#d8a880'; g.fillRect(cx - rw + 4, cy - rh + 1, 3, 1);
  };
  drawCap(11, 21, 6, 4);
  drawCap(18, 22, 5, 3);
  drawCap(23, 20, 5, 4);
  return c;
}

/** Herb patch — soft leafy clumps in sage and muted green. */
function herbPatchSprite(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  const g = c.getContext('2d')!;
  fillDisc(g, 16, 27, 9, 3, P.shadow);
  // several leaf rosettes at different heights
  const clumps: [number, number, string, string][] = [
    [10, 22, '#7a9040', '#a0b858'],
    [17, 20, '#5e7830', '#849848'],
    [22, 23, '#7a9040', '#98b050'],
    [14, 18, '#5e7830', '#7a9040'],
    [20, 17, '#6a8838', '#90aa50'],
  ];
  for (const [cx, cy, dark, light] of clumps) {
    // small leaf splays (3-4 pixel leaf shapes)
    g.fillStyle = dark;
    g.fillRect(cx - 2, cy, 5, 2); g.fillRect(cx, cy - 2, 2, 5);
    g.fillStyle = light;
    g.fillRect(cx - 1, cy, 3, 1); g.fillRect(cx, cy - 1, 1, 3);
    g.fillStyle = '#b8cc68'; g.fillRect(cx, cy - 2, 1, 1); // bright tip
  }
  return c;
}

function saplingSprite(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  const g = c.getContext('2d')!;
  fillDisc(g, 16, 27, 7, 2, P.shadow);
  g.fillStyle = P.trunkDark;
  g.fillRect(15, 16, 3, 12);
  g.fillStyle = P.trunk;
  g.fillRect(15, 16, 1, 11);
  // small round canopy, hue-shifted
  fillDisc(g, 16, 12, 7, 8, P.treeLeafDeep);
  fillDisc(g, 16, 11, 6, 7, P.treeLeaf);
  fillDisc(g, 14, 9, 4, 4, P.treeLeafLight);
  g.fillStyle = P.treeLeafTop;
  g.fillRect(13, 7, 3, 2);
  g.fillStyle = P.treeLeafDeep;
  g.fillRect(19, 14, 2, 2);
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
  // Staggered planks with grain variation and knots.
  const rnd = mulberry(7711);
  for (let row = 0; row < TILE; row += 8) {
    // Slight hue shift per plank row for wood grain variety
    const rowLight = (row / 8) % 2 === 0 ? P.plank : P.woodLight;
    g.fillStyle = rowLight === P.woodLight ? '#a07040' : P.plank;
    g.fillRect(0, row + 1, TILE, 6);
    g.fillStyle = P.plankLight;
    g.fillRect(0, row + 1, TILE, 1);
    // Board seams, offset every other row
    const off = (row / 8) % 2 === 0 ? 0 : 16;
    g.fillStyle = P.plankDark;
    g.fillRect((off) % TILE, row + 1, 1, 6);
    g.fillRect((off + 16) % TILE, row + 1, 1, 6);
    // Grain lines (subtle dark streaks along plank length)
    g.fillStyle = P.woodDark;
    const gx = 3 + Math.floor(rnd() * (TILE - 6));
    g.fillRect(gx, row + 2, 1, 4);
    // Occasional knot
    if (rnd() < 0.4) {
      const kx = 5 + Math.floor(rnd() * (TILE - 10));
      g.fillStyle = P.woodDark; g.fillRect(kx, row + 3, 2, 2);
      g.fillStyle = P.plankDark; g.fillRect(kx + 1, row + 3, 1, 1);
    }
  }
  return c;
}

/** Stone tile floor — grey flagstone with mortar seams. Used in kitchens, smithies, temples, etc. */
function floorStoneTile(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  const g = c.getContext('2d')!;
  g.fillStyle = P.rockDark; g.fillRect(0, 0, TILE, TILE); // mortar
  const stones: [number, number, number, number][] = [
    [1, 1, 14, 7], [16, 1, 14, 7],
    [1, 9, 8, 7],  [10, 9, 20, 7],
    [1, 17, 20, 7],[22, 17, 8, 7],
    [1, 25, 14, 6],[16, 25, 14, 6],
  ];
  // Varied stone shades: 3 alternating hues for natural flagstone look
  const stoneShades = [P.rock, P.gravelA, '#6e6a60', P.rock, P.gravelA, P.rock, '#6e6a60', P.gravelA];
  for (let si = 0; si < stones.length; si++) {
    const [x, y, w, h] = stones[si];
    g.fillStyle = stoneShades[si]; g.fillRect(x, y, w, h);
    g.fillStyle = P.rockLight; g.fillRect(x, y, w, 1);
    g.fillStyle = P.rockDarker; g.fillRect(x, y + h - 1, w, 1);
  }
  return c;
}

/** Packed earth / dirt floor — for pastures, outposts, burial grounds. */
function floorDirtTile(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  const g = c.getContext('2d')!;
  const rnd = mulberry(9991);
  g.fillStyle = P.dirtMid; g.fillRect(0, 0, TILE, TILE);
  for (let i = 0; i < 22; i++) {
    const x = Math.floor(rnd() * TILE), y = Math.floor(rnd() * TILE);
    g.fillStyle = rnd() < 0.5 ? P.dirtPatch : P.soilDark;
    g.fillRect(x, y, 1 + Math.floor(rnd() * 2), 1);
  }
  return c;
}

/** Fine herringbone plank floor — for libraries, taverns, temples. */
function floorFineTile(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  const g = c.getContext('2d')!;
  g.fillStyle = P.plankDark; g.fillRect(0, 0, TILE, TILE);
  // Herringbone: alternating horizontal and vertical plank pairs
  const planks: [number, number, number, number][] = [];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const x = i * 8, y = j * 8;
      if ((i + j) % 2 === 0) planks.push([x, y, 8, 3], [x, y + 4, 8, 3]); // horizontal
      else                   planks.push([x, y, 3, 8], [x + 4, y, 3, 8]);  // vertical
    }
  }
  for (const [x, y, w, h] of planks) {
    g.fillStyle = P.plank; g.fillRect(x + 1, y + 1, w - 1, h - 1);
    g.fillStyle = P.plankLight; g.fillRect(x + 1, y + 1, w - 1, 1);
  }
  return c;
}

/** Irregular flagstone — for storehourses, markets, apothecaries. */
function floorFlagTile(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  const g = c.getContext('2d')!;
  g.fillStyle = P.rockDarker; g.fillRect(0, 0, TILE, TILE);
  const flags: [number, number, number, number][] = [
    [1, 1, 9, 6], [11, 1, 5, 6], [17, 1, 13, 6],
    [1, 8, 7, 7],  [9, 8, 12, 7], [22, 8, 8, 7],
    [1, 16, 14, 7],[16, 16, 9, 7], [26, 16, 4, 7],
    [1, 24, 5, 7],  [7, 24, 14, 7],[22, 24, 8, 7],
  ];
  for (const [x, y, w, h] of flags) {
    g.fillStyle = P.gravelA; g.fillRect(x, y, w, h);
    g.fillStyle = P.gravelC; g.fillRect(x, y + h - 1, w, 1);
    g.fillStyle = '#b0aba0'; g.fillRect(x, y, w, 1); // lit top
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
  // Brick/stone courses with subtle row-to-row color variation.
  const rowShades = [P.rock, '#70686c', '#888278', P.rock];
  for (let row = 0; row < TILE; row += 8) {
    const off = (row / 8) % 2 === 0 ? 0 : 8;
    const brickCol = rowShades[(row / 8) % rowShades.length];
    for (let x = -off; x < TILE; x += 16) {
      g.fillStyle = brickCol;
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
    case 'crate': {
      shadow();
      // Outer box
      g.fillStyle = P.trunkDark; g.fillRect(m, m, W - 2 * m, H - 2 * m);
      g.fillStyle = P.trunk; g.fillRect(m + 1, m + 1, W - 2 * m - 2, H - 2 * m - 2);
      g.fillStyle = P.wood; g.fillRect(m + 2, m + 2, W - 2 * m - 4, H - 2 * m - 4);
      // Cross braces
      g.fillStyle = P.woodDark;
      g.fillRect(m, Math.floor(H / 2) - 1, W - 2 * m, 2); // horizontal band
      g.fillRect(Math.floor(W / 2) - 1, m, 2, H - 2 * m); // vertical band
      // Top highlight
      g.fillStyle = P.woodLight; g.fillRect(m + 2, m + 2, W - 2 * m - 4, 2);
      break;
    }
    case 'shrine': {
      // Stepped plinth base (wider lower step for grandeur)
      g.fillStyle = P.rockDarker; g.fillRect(m, H - 7, W - 2 * m, 5); // lower step shadow
      g.fillStyle = P.rockDark; g.fillRect(m, H - 8, W - 2 * m, 2);
      g.fillStyle = P.rockLight; g.fillRect(m, H - 8, W - 2 * m, 1); // top bevel
      // Upper plinth
      g.fillStyle = P.rock; g.fillRect(m + 2, H - 13, W - 2 * m - 4, 6);
      g.fillStyle = P.rockDark; g.fillRect(m + 2, H - 14, W - 2 * m - 4, 2);
      g.fillStyle = P.rockLight; g.fillRect(m + 3, H - 12, 4, 2);
      // Candle offerings on plinth
      g.fillStyle = '#e8d898'; g.fillRect(5, H - 14, 2, 4); g.fillRect(W - 7, H - 14, 2, 4);
      g.fillStyle = '#f8c030'; g.fillRect(5, H - 15, 1, 1); g.fillRect(W - 7, H - 15, 1, 1);
      // Column (fluted: left shadow, center groove, right lit edge)
      g.fillStyle = P.wallCream; g.fillRect(W / 2 - 3, 14, 6, H - 27);
      g.fillStyle = P.wallCreamDk; g.fillRect(W / 2 - 3, 14, 1, H - 27); // left shadow
      g.fillStyle = P.wallCreamDk; g.fillRect(W / 2, 14, 1, H - 27);     // center groove
      // Capital
      g.fillStyle = P.wallCreamDk; g.fillRect(W / 2 - 6, 10, 12, 5);
      g.fillStyle = P.wallCream; g.fillRect(W / 2 - 5, 11, 10, 3);
      g.fillStyle = P.rockHighlight; g.fillRect(W / 2 - 5, 11, 10, 1); // bright capital top
      // Flame (tapered: wide base, narrow tip)
      g.fillStyle = '#c86020'; g.fillRect(W / 2 - 2, 7, 4, 2); // ember base
      g.fillStyle = '#f0a030'; g.fillRect(W / 2 - 2, 4, 4, 4); // main flame
      g.fillStyle = '#f8d060'; g.fillRect(W / 2 - 1, 2, 2, 3); // bright core
      g.fillStyle = '#fffff0'; g.fillRect(W / 2, 1, 1, 2);     // hot tip
      break;
    }
    case 'well': {
      shadow();
      // Stone surround
      g.fillStyle = P.rockDark; g.fillRect(m + 2, m + 2, W - 2 * m - 4, H - 2 * m - 4);
      g.fillStyle = P.rock; g.fillRect(m + 4, m + 4, W - 2 * m - 8, H - 2 * m - 8);
      // Individual stone highlights on top edge (top-left lit)
      g.fillStyle = P.rockLight; g.fillRect(m + 4, m + 4, 6, 2); g.fillRect(m + 12, m + 4, 5, 2);
      g.fillStyle = P.rockHighlight; g.fillRect(m + 4, m + 4, 2, 1);
      // Dark interior shaft
      g.fillStyle = '#0e1820'; g.fillRect(W / 2 - 5, m + 5, 10, H / 2 - 4);
      g.fillStyle = P.water2; g.fillRect(W / 2 - 4, H / 2 - 2, 8, 4);
      g.fillStyle = P.waterGlint; g.fillRect(W / 2 - 2, H / 2 - 1, 3, 1);
      // Crossbeam
      g.fillStyle = P.woodDark; g.fillRect(m, m + 2, W - 2 * m, 3);
      g.fillStyle = P.wood; g.fillRect(m + 1, m + 3, W - 2 * m - 2, 1);
      // Windlass axle (right side of crossbeam)
      g.fillStyle = P.woodDark; g.fillRect(W - m - 6, m - 1, 3, 4);
      g.fillStyle = P.wood; g.fillRect(W - m - 5, m - 1, 1, 3);
      // Rope with twist marks
      g.fillStyle = '#8a7050'; g.fillRect(W / 2 - 1, m + 5, 2, H / 2 - 8);
      g.fillStyle = '#6a5030';
      for (let ry = m + 7; ry < H / 2 - 2; ry += 3) g.fillRect(W / 2, ry, 1, 1);
      // Bucket with rim and barrel hoop
      g.fillStyle = '#7a5030'; g.fillRect(W / 2 - 3, H / 2 - 8, 6, 1); // rim
      g.fillStyle = P.woodDark; g.fillRect(W / 2 - 3, H / 2 - 7, 6, 4);
      g.fillStyle = P.wood; g.fillRect(W / 2 - 2, H / 2 - 6, 4, 3);
      g.fillStyle = P.trunkDark; g.fillRect(W / 2 - 3, H / 2 - 5, 6, 1); // hoop
      break;
    }
    case 'watch_post': {
      shadow();
      // Platform floor
      g.fillStyle = P.woodDark; g.fillRect(m, H - 10, W - 2 * m, 3);
      g.fillStyle = P.wood; g.fillRect(m + 1, H - 9, W - 2 * m - 2, 2);
      // Support legs
      g.fillStyle = P.trunkDark;
      g.fillRect(m + 2, H - 7, 3, 6); g.fillRect(W - m - 5, H - 7, 3, 6);
      // Ladder rungs
      g.fillStyle = P.trunk;
      g.fillRect(W / 2 - 3, m + 4, 2, H - 14); g.fillRect(W / 2 + 1, m + 4, 2, H - 14);
      for (let ry = m + 8; ry < H - 11; ry += 5) g.fillRect(W / 2 - 3, ry, 6, 1);
      // Watchtower roof
      g.fillStyle = P.roofWood; g.fillRect(m, m, W - 2 * m, 5);
      g.fillStyle = P.roofLight; g.fillRect(m, m + 1, W - 2 * m, 2);
      // Arrow slit
      g.fillStyle = '#0e0c08'; g.fillRect(W / 2 - 1, m + 5, 2, 4);
      break;
    }
    case 'grave_marker': {
      // Dirt mound
      g.fillStyle = P.soilDark; g.fillRect(m + 2, H - 9, W - 2 * m - 4, 7);
      g.fillStyle = P.soil; g.fillRect(m + 3, H - 9, W - 2 * m - 6, 5);
      // Stone marker
      g.fillStyle = P.rockDark; g.fillRect(W / 2 - 4, m + 2, 8, H - 14);
      g.fillStyle = P.rock; g.fillRect(W / 2 - 3, m + 3, 6, H - 16);
      g.fillStyle = P.rockLight; g.fillRect(W / 2 - 2, m + 3, 2, 3);
      // Cross notch
      g.fillStyle = P.rockDark; g.fillRect(W / 2 - 3, m + 6, 6, 1); // crossbar
      break;
    }
    case 'training_post': {
      shadow();
      // Central post
      g.fillStyle = P.trunkDark; g.fillRect(W / 2 - 3, m + 2, 6, H - 2 * m - 4);
      g.fillStyle = P.trunk; g.fillRect(W / 2 - 2, m + 3, 4, H - 2 * m - 6);
      // Cross arm
      g.fillStyle = P.trunkDark; g.fillRect(m + 2, H / 2 - 2, W - 2 * m - 4, 4);
      g.fillStyle = P.trunk; g.fillRect(m + 3, H / 2 - 1, W - 2 * m - 6, 2);
      // Rope circles
      g.fillStyle = '#8a7050';
      disc(m + 6, H / 2, 4, '#8a7050'); g.fillStyle = '#b89a6a'; disc(m + 6, H / 2, 2, '#b89a6a');
      disc(W - m - 6, H / 2, 4, '#8a7050'); g.fillStyle = '#b89a6a'; disc(W - m - 6, H / 2, 2, '#b89a6a');
      break;
    }
    case 'hunting_lodge': {
      // Floor/ground
      g.fillStyle = P.grassB; g.fillRect(1, 1, W - 2, H - 2);
      g.fillStyle = P.dirtPatch; g.fillRect(m + 2, H - 14, W - 2 * m - 4, 12);
      // Small log cabin
      const lx = Math.floor(W / 2) - 10, lw = 20;
      g.fillStyle = P.trunkDark; g.fillRect(lx, 12, lw, H - 26);
      g.fillStyle = P.trunk; g.fillRect(lx + 1, 13, lw - 2, H - 28);
      // Log lines
      g.fillStyle = P.trunkDark;
      for (let ly = 18; ly < H - 16; ly += 5) g.fillRect(lx + 1, ly, lw - 2, 1);
      // Roof
      g.fillStyle = P.roofWood; g.fillRect(lx - 3, 6, lw + 6, 8);
      g.fillStyle = P.roofLight; g.fillRect(lx - 2, 7, lw + 4, 3);
      // Door
      g.fillStyle = '#1e1408'; g.fillRect(Math.floor(W / 2) - 3, H - 24, 6, 10);
      // Antlers
      g.fillStyle = '#c0a86a';
      g.fillRect(lx - 4, 8, 2, 8); g.fillRect(lx - 6, 6, 2, 4); g.fillRect(lx - 2, 6, 2, 3);
      g.fillRect(lx + lw + 2, 8, 2, 8); g.fillRect(lx + lw, 6, 2, 4); g.fillRect(lx + lw + 4, 6, 2, 3);
      break;
    }
    case 'market_stall': {
      // Ground
      g.fillStyle = P.gravelB; g.fillRect(1, H - 10, W - 2, 9);
      // Awning posts
      g.fillStyle = P.woodDark;
      g.fillRect(m + 2, 16, 3, H - 26); g.fillRect(W - m - 5, 16, 3, H - 26);
      g.fillStyle = P.wood;
      g.fillRect(m + 3, 17, 2, H - 28); g.fillRect(W - m - 4, 17, 2, H - 28);
      // Awning
      g.fillStyle = '#b83828'; // red cloth
      g.fillRect(m, 8, W - 2 * m, 10);
      g.fillStyle = '#cc5040';
      g.fillRect(m, 8, W - 2 * m, 3); // lighter top stripe
      // Scalloped edge
      for (let ex = m; ex < W - m - 6; ex += 6) {
        g.fillStyle = '#b83828';
        g.fillRect(ex + 1, 18, 4, 4);
        g.fillStyle = P.shadow;
        g.fillRect(ex, 18, 1, 3); g.fillRect(ex + 5, 18, 1, 3);
      }
      // Counter table
      g.fillStyle = P.woodDark; g.fillRect(m + 4, H - 17, W - 2 * m - 8, 6);
      g.fillStyle = P.wood; g.fillRect(m + 5, H - 16, W - 2 * m - 10, 4);
      // Goods
      g.fillStyle = '#b84020'; g.fillRect(m + 6, H - 22, 6, 5); // pottery
      g.fillStyle = '#a8b040'; g.fillRect(m + 14, H - 21, 5, 4); // greens
      g.fillStyle = P.grain; g.fillRect(W - m - 14, H - 20, 6, 3); // grain sack
      break;
    }
    case 'carpentry_bench': {
      shadow(); woodTop(m, 11, W - 2 * m, H - 13);
      // Wood shavings
      g.fillStyle = P.woodLight;
      g.fillRect(m + 4, 14, 6, 2); g.fillRect(m + 12, 16, 5, 1); g.fillRect(W - m - 10, 13, 7, 2);
      // Chisel and mallet
      g.fillStyle = P.rockLight; // chisel blade
      g.fillRect(W / 2 + 2, 12, 2, 6);
      g.fillStyle = P.woodDark; // mallet handle
      g.fillRect(W / 2 + 2, 18, 2, 8);
      g.fillStyle = P.trunk; // mallet head
      g.fillRect(W / 2 - 1, 14, 8, 5);
      // Wood block being worked
      g.fillStyle = P.trunkDark;
      g.fillRect(m + 3, 14, 10, 12);
      g.fillStyle = P.trunk;
      g.fillRect(m + 4, 15, 8, 10);
      break;
    }
    case 'smoke_rack': {
      // Smokehouse rack: heavy horizontal beams with hanging smoked cuts.
      shadow();
      // Frame posts
      g.fillStyle = P.trunkDark;
      g.fillRect(m, m + 6, 3, H - m - 8);
      g.fillRect(W - m - 3, m + 6, 3, H - m - 8);
      // Horizontal beam
      g.fillStyle = P.trunk;
      g.fillRect(m, m + 6, W - 2 * m, 4);
      g.fillStyle = P.woodLight;
      g.fillRect(m, m + 6, W - 2 * m, 1);
      // Smoke + ash floor
      g.fillStyle = P.soilDark; g.fillRect(m + 3, H - m - 5, W - 2 * m - 6, 4);
      g.fillStyle = '#5a4a3a';  g.fillRect(m + 4, H - m - 4, W - 2 * m - 8, 2);
      // Hanging smoked cuts (dark red strips on string)
      for (let hx = m + 4; hx < W - m - 4; hx += 6) {
        g.fillStyle = '#44261a'; g.fillRect(hx, m + 10, 1, 8 + (hx % 3));
        g.fillStyle = '#6a3820'; g.fillRect(hx, m + 10, 1, 2);
      }
      break;
    }
    case 'animal_pen': {
      // Pen: fenced enclosure with dirt floor and a couple of cows.
      shadow();
      // Dirt floor
      g.fillStyle = P.soilDark; g.fillRect(m, m + 4, W - 2 * m, H - m - 6);
      g.fillStyle = P.soil; g.fillRect(m + 1, m + 5, W - 2 * m - 2, H - m - 8);
      // Fence rails (top, bottom, left, right)
      g.fillStyle = P.woodDark;
      g.fillRect(m, m + 4, W - 2 * m, 2);
      g.fillRect(m, H - m - 4, W - 2 * m, 2);
      g.fillRect(m, m + 4, 2, H - 2 * m - 4);
      g.fillRect(W - m - 2, m + 4, 2, H - 2 * m - 4);
      // Mid-rail
      g.fillStyle = P.wood;
      g.fillRect(m, m + 8, W - 2 * m, 1);
      // Two simple cows (blobs)
      g.fillStyle = P.trunk; // brown
      g.fillRect(m + 4, m + 10, 5, 4); // cow 1
      g.fillRect(m + 3, m + 10, 1, 3); g.fillRect(m + 8, m + 10, 1, 3); // legs 1
      g.fillRect(m + 12, m + 11, 5, 4); // cow 2
      g.fillRect(m + 11, m + 11, 1, 3); g.fillRect(m + 16, m + 11, 1, 3); // legs 2
      g.fillStyle = P.woodLight; // highlight
      g.fillRect(m + 4, m + 10, 5, 1);
      g.fillRect(m + 12, m + 11, 5, 1);
      break;
    }
    case 'game_meal': {
      // Cooked game meat — bone-in leg piece.
      // (default shadow at y=21 acts as underlay)
      // Bone handle
      g.fillStyle = '#c0b890'; g.fillRect(21, 17, 4, 12);
      g.fillStyle = '#d8d0a8'; g.fillRect(22, 17, 2, 11);
      fillDisc(g, 23, 29, 4, 2, '#c0b890'); // knob end
      g.fillStyle = '#d8d0a8'; g.fillRect(21, 28, 3, 1);
      // Meat mass — charred outside, warmer inside
      fillDisc(g, 13, 14, 10, 8, '#4e2010'); // dark char rim
      fillDisc(g, 12, 13, 10, 8, '#8a3c22'); // charred surface
      fillDisc(g, 10, 11,  8, 6, '#ae5830'); // main meat
      fillDisc(g,  7,  9,  5, 4, '#c87040'); // warm lit highlight
      g.fillStyle = '#d8904c'; g.fillRect(6, 8, 4, 2); // bright spot
      break;
    }
    case 'preserved': {
      // Preserved / smoked meat — dark tied bundle.
      g.fillStyle = P.shadow; g.fillRect(4, 23, 24, 6);
      // Main bundle
      g.fillStyle = '#4a2418'; g.fillRect(5, 11, 22, 13);
      g.fillStyle = '#6a3828'; g.fillRect(5, 11, 22, 4); // slightly lighter top
      g.fillStyle = '#3a1c10'; g.fillRect(5, 22, 22, 2); // dark bottom
      // Smoke grain lines
      g.fillStyle = '#38200e';
      for (let lx = 6; lx < 26; lx += 5) g.fillRect(lx, 12, 1, 11);
      // Binding twine
      g.fillStyle = '#c8a858'; g.fillRect(4, 14, 24, 2); g.fillRect(4, 20, 24, 2);
      // Vertical cord + knot
      g.fillStyle = '#b09040'; g.fillRect(14, 10, 4, 13);
      g.fillStyle = '#d4b860'; g.fillRect(15, 10, 2, 12);
      // Lit surface hint
      g.fillStyle = '#7a4434'; g.fillRect(6, 12, 8, 2);
      break;
    }
    case 'clay': {
      // Clay — smooth wet lump, grey-tan
      g.fillStyle = P.shadow; g.fillRect(4, 23, 22, 6);
      fillDisc(g, 15, 15, 11, 8, '#706050'); // dark rim
      fillDisc(g, 14, 14, 11, 8, '#9a7858'); // mid clay
      fillDisc(g, 10, 11,  7, 5, '#b89070'); // lit surface
      g.fillStyle = '#c8a888'; g.fillRect(8, 10, 5, 2); // wet sheen
      break;
    }
    case 'coal': {
      // Coal — rough black chunks with subtle sheen
      g.fillStyle = P.shadow; g.fillRect(4, 22, 24, 7);
      g.fillStyle = '#2a2820'; g.fillRect(5, 12, 12, 10); g.fillRect(15, 14, 12, 10);
      g.fillStyle = '#3c3a30'; g.fillRect(5, 12, 10, 8); g.fillRect(15, 14, 10, 8);
      g.fillStyle = '#545248'; g.fillRect(5, 12, 10, 1); g.fillRect(15, 14, 10, 1); // edge sheen
      g.fillStyle = '#403e36'; g.fillRect(5, 12, 1, 9); g.fillRect(15, 14, 1, 9);
      break;
    }
    case 'iron_ore': {
      // Iron ore — reddish-brown heavy chunk with metallic gleam
      g.fillStyle = P.shadow; g.fillRect(4, 22, 24, 7);
      fillDisc(g, 16, 15, 12, 8, '#543828'); // dark rim
      fillDisc(g, 15, 14, 12, 8, '#7a5040'); // main ore (reddish-brown)
      fillDisc(g, 11, 11,  7, 5, '#966454'); // lit surface
      g.fillStyle = '#b08070'; g.fillRect(9, 10, 5, 2); // metallic highlight
      // Companion chunk (lower right)
      g.fillStyle = '#6a4030'; g.fillRect(21, 17, 7, 5);
      g.fillStyle = '#9a6050'; g.fillRect(22, 17, 5, 4);
      g.fillStyle = '#b08070'; g.fillRect(22, 17, 3, 1);
      break;
    }
    case 'coke': {
      // Processed coke — grey-black angular chunks with a slight metallic sheen
      g.fillStyle = P.shadow; g.fillRect(4, 22, 24, 7);
      // Two main chunks, irregular shapes
      g.fillStyle = '#1e1c18'; g.fillRect(5, 11, 14, 11); g.fillRect(18, 14, 11, 9);
      g.fillStyle = '#2c2820'; g.fillRect(5, 11, 12, 9); g.fillRect(18, 14, 9, 7);
      // Grey metallic surface highlights (coke is partially graphitised)
      g.fillStyle = '#504c44'; g.fillRect(5, 11, 12, 1); g.fillRect(18, 14, 9, 1);
      g.fillStyle = '#3c3830'; g.fillRect(5, 11, 1, 10); g.fillRect(18, 14, 1, 8);
      g.fillStyle = '#686460'; g.fillRect(6, 12, 4, 1); g.fillRect(19, 15, 3, 1); // sheen
      break;
    }
    case 'flax': {
      // Flax — tied bundle of pale yellow-green fibers with blue flowers
      g.fillStyle = P.shadow; g.fillRect(5, 23, 20, 5);
      const fc = '#9cb860', fd = '#7a9040';
      // Fiber stalks
      for (let i = 0; i < 5; i++) {
        const fx = 8 + i * 4;
        g.fillStyle = (i % 2 === 0) ? fc : fd;
        g.fillRect(fx, 6, 2, 16);
      }
      // Binding twine at center
      g.fillStyle = '#c8a840'; g.fillRect(5, 12, 20, 3);
      g.fillStyle = '#e0c050'; g.fillRect(5, 12, 20, 1);
      // Tufted fiber tips (top)
      g.fillStyle = '#c0d880';
      for (let i = 0; i < 5; i++) { g.fillRect(8 + i * 4, 5, 2, 2); }
      // Blue flower buds on some stalks
      g.fillStyle = '#7878d0'; g.fillRect(10, 4, 2, 2); g.fillRect(18, 3, 2, 2);
      g.fillStyle = '#a0a0f0'; g.fillRect(10, 4, 1, 1); g.fillRect(18, 3, 1, 1);
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

// Six distinct settler looks for population variety, plus the raider look. Lifted
// to module scope so the live map renderer can build just the pawns (via
// `buildPawnSprites`) without paying for the whole terrain/building set.
const PAWN_LOOKS: PawnLook[] = [
  { cloth: P.cloth1, clothDk: P.clothDark1, clothLt: P.clothLight1,
    skin: P.skin,  skinShad: P.skinShad,  skinLight: P.skinLight,
    hair: P.hairB, hairDk: P.hairA },
  { cloth: P.cloth2, clothDk: P.clothDark2, clothLt: P.clothLight2,
    skin: P.skinB, skinShad: P.skinBShad, skinLight: P.skinBLight,
    hair: '#8a5e34', hairDk: '#5a3a1e' },
  { cloth: P.cloth3, clothDk: P.clothDark3, clothLt: P.clothLight3,
    skin: P.skin,  skinShad: P.skinShad,  skinLight: P.skinLight,
    hair: P.hairC, hairDk: '#6e665a' },
  { cloth: P.cloth4, clothDk: P.clothDark4, clothLt: P.clothLight4,
    skin: P.skinB, skinShad: P.skinBShad, skinLight: P.skinBLight,
    hair: '#1c1a18', hairDk: '#0e0c0a' },
  // Russet-red tunic, silver-grey hair — elder look
  { cloth: '#7a3c2c', clothDk: '#522818', clothLt: '#9a5040',
    skin: P.skin,  skinShad: P.skinShad,  skinLight: P.skinLight,
    hair: '#b0aca0', hairDk: P.hairC },
  // Deep slate-blue tunic, warm sandy hair, dark skin
  { cloth: '#405068', clothDk: '#2c3848', clothLt: '#5a6e88',
    skin: P.skinB, skinShad: P.skinBShad, skinLight: P.skinBLight,
    hair: '#c8a860', hairDk: '#9a7840' },
];
const RAIDER_LOOK: PawnLook = {
  cloth: P.clothRaider, clothDk: P.clothRaiderDk, clothLt: P.clothRaiderLt,
  skin: P.skinB, skinShad: P.skinBShad, skinLight: P.skinBLight,
  hair: P.hairA, hairDk: '#241a12',
};

/** Build just the pawn sprites (settler / armed settler / raider), each a 2-frame
 *  walk cycle, without the rest of the SpriteSet. Cheap enough to call once on the
 *  region map so armies can render as actual figures instead of a `⚔N` glyph. */
export function buildPawnSprites(): {
  settler: HTMLCanvasElement[][];
  settlerArmed: HTMLCanvasElement[][];
  raider: HTMLCanvasElement[];
} {
  return {
    settler: PAWN_LOOKS.map((lk) => [pawnSprite(lk, 0), pawnSprite(lk, 1)]),
    settlerArmed: PAWN_LOOKS.map((lk) => [pawnSprite(lk, 0, true), pawnSprite(lk, 1, true)]),
    raider: [pawnSprite(RAIDER_LOOK, 0, true), pawnSprite(RAIDER_LOOK, 1, true)],
  };
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
  return {
    grass: [0, 1, 2, 3].map(grassTile),
    grassSpring: [0, 1, 2, 3].map(grassSpringTile),
    grassAutumn: [0, 1, 2, 3].map(grassAutumnTile),
    grassWinter: [0, 1, 2, 3].map(grassWinterTile),
    dirtPatch: dirtPatchTile(),
    tree: treeSprite(false),
    treeMarked: treeSprite(true),
    treeSpring: treeSpringSprite(),
    treeAutumn: treeAutumnSprite(),
    treeWinter: treeWinterSprite(),
    water: [waterTile(0), waterTile(1), waterTile(2), waterTile(3)],
    waterWinter: [0, 1, 2, 3].map(waterWinterTile),
    rock: [0, 1, 2].map(v => rockSprite(false, v)),
    rockMarked: [0, 1, 2].map(v => rockSprite(true, v)),
    sand: [0, 1, 2, 3].map(sandTile),
    soil: soilTile('bare'),
    soilSown: soilTile('sown'),
    soilGrown: soilTile('grown'),
    soilRipe: soilTile('ripe'),
    soilWinter: soilWinterTile(),
    flaxSown: flaxSoilTile('sown'),
    flaxGrown: flaxSoilTile('grown'),
    flaxRipe: flaxSoilTile('ripe'),
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
    forage: [saplingSprite() /* unused slot 0 */, berryBushSprite(), mushroomClusterSprite(), herbPatchSprite()],
    ...buildPawnSprites(),
    deer: [deerSprite(0), deerSprite(1)],
    wolf: [wolfSprite(0), wolfSprite(1)],
    items: {
      wood:       itemSprite('wood'),
      grain:      itemSprite('grain'),
      meal:       itemSprite('meal'),
      stone:      itemSprite('stone'),
      clothes:    itemSprite('clothes'),
      weapons:    weaponSprite(),
      clay:       craftedItemSprite('clay'),
      coal:       craftedItemSprite('coal'),
      iron_ore:   craftedItemSprite('iron_ore'),
      flax:       craftedItemSprite('flax'),
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
      game_meal:  craftedItemSprite('game_meal'),
      fish_meal:  craftedItemSprite('fish_meal'),
      preserved:  craftedItemSprite('preserved'),
      coke:       craftedItemSprite('coke'),
      petroleum:  genericItemSprite('#1c1e28', '#14161e'),
    },
    grave:  graveSprite(),
    corpse: corpseSprite(),
    buildings,
    blueprints,
    interiorFloor: interiorFloorTile(),
    interiorWall: interiorWallTile(),
    roomFloors: (() => {
      const stone = floorStoneTile(), dirt = floorDirtTile(), fine = floorFineTile(), flag = floorFlagTile();
      return {
        kitchen: stone, bakery: stone, smithy: stone, foundry: stone, kilnhouse: stone,
        mill: stone, sawmill: dirt, workshop: flag, smokehouse: dirt,
        yard: stone, watchtower: stone, infirmary: stone,
        home: fine, library: fine, tavern: fine, barracks: fine, temple: fine,
        pasture: dirt, burial_ground: dirt, outpost: dirt,
        storehouse: flag, market: flag, apothecary: flag,
      };
    })(),
    stations,
  };
}
