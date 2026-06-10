/**
 * Procedural 8-bit sprites (GDD §3.1): every gameplay object is drawn on a
 * 16×16 grid, max 4 colors, 1px outlines, no anti-aliasing. Drawn once into
 * offscreen canvases at load.
 */
export const TILE = 16;

type Px = string | null;

function sheet(pixels: Px[][], scale = 1): HTMLCanvasElement {
  const h = pixels.length;
  const w = pixels[0].length;
  const c = document.createElement('canvas');
  c.width = w * scale;
  c.height = h * scale;
  const g = c.getContext('2d')!;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const col = pixels[y][x];
      if (!col) continue;
      g.fillStyle = col;
      g.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  return c;
}

/** Build a pixel grid from an ASCII template and a palette map. */
function grid(rows: string[], pal: Record<string, string>): Px[][] {
  return rows.map((r) => [...r].map((ch) => (ch === '.' ? null : pal[ch] ?? null)));
}

function rect(w: number, h: number, fill: (x: number, y: number) => Px): Px[][] {
  const out: Px[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Px[] = [];
    for (let x = 0; x < w; x++) row.push(fill(x, y));
    out.push(row);
  }
  return out;
}

// 1900s era palette: soot, timber, sepia (GDD §3.2).
const P = {
  outline: '#1a1410',
  timber: '#6e4a2f',
  timberDark: '#4d3320',
  roof: '#3a2e26',
  roofLight: '#564439',
  grass1: '#4a5d33',
  grass2: '#52682f',
  soil: '#5c4126',
  soilWet: '#4a3017',
  crop: '#7a8c3a',
  cropRipe: '#b89b3e',
  water1: '#2e4a5c',
  water2: '#3a5a70',
  rock: '#5b5852',
  rockDark: '#403e3a',
  treeLeaf: '#33502c',
  treeLeafDark: '#243c20',
  trunk: '#4d3320',
  skin: '#c9a07a',
  cloth1: '#7a5c44',
  cloth2: '#5d6b6e',
  cloth3: '#735a66',
  wood: '#9c7544',
  grain: '#c2a14d',
  meal: '#a86e3c',
};

export interface SpriteSet {
  grass: HTMLCanvasElement[];
  tree: HTMLCanvasElement;
  treeMarked: HTMLCanvasElement;
  water: HTMLCanvasElement[];
  rock: HTMLCanvasElement;
  soil: HTMLCanvasElement;
  soilSown: HTMLCanvasElement;
  soilGrown: HTMLCanvasElement;
  soilRipe: HTMLCanvasElement;
  settler: HTMLCanvasElement[][]; // [variant][frame]
  items: Record<'wood' | 'grain' | 'meal', HTMLCanvasElement>;
  buildings: Record<string, HTMLCanvasElement>;
  blueprints: Record<string, HTMLCanvasElement>;
}

function tileNoise(base: string, fleck: string, seedMod: number): HTMLCanvasElement {
  return sheet(
    rect(TILE, TILE, (x, y) => ((x * 7 + y * 13 + seedMod) % 11 === 0 ? fleck : base)),
  );
}

function treeSprite(marked: boolean): HTMLCanvasElement {
  const rows = [
    '......OOOO......',
    '....OOLLLLOO....',
    '...OLLDLLLLLO...',
    '..OLLLLLDLLLLO..',
    '..OLDLLLLLLDLO..',
    '..OLLLLDLLLLLO..',
    '...OLLLLLLDLO...',
    '....OLLDLLLO....',
    '.....OOLLOO.....',
    '.......TT.......',
    '.......TT.......',
    '.......TT.......',
    '......TTTT......',
    '................',
    '................',
    '................',
  ];
  const pal: Record<string, string> = {
    O: P.outline, L: P.treeLeaf, D: P.treeLeafDark, T: marked ? '#c25b2e' : P.trunk,
  };
  const c = tileNoise(P.grass1, P.grass2, 3);
  const g = c.getContext('2d')!;
  g.drawImage(sheet(grid(rows, pal)), 0, 0);
  return c;
}

function settlerSprite(cloth: string, frame: number): HTMLCanvasElement {
  const legL = frame === 0 ? 'L.' : '.L';
  const legR = frame === 0 ? '.L' : 'L.';
  const rows = [
    '................',
    '......OOO.......',
    '.....OHHHO......',
    '.....OHHHO......',
    '......OOO.......',
    '.....OCCCO......',
    '....OCCCCCO.....',
    '....OCCCCCO.....',
    '.....OCCCO......',
    `.....O${legL}${legR}O......`,
    `.....O${legL}${legR}O......`,
    '................',
    '................',
    '................',
    '................',
    '................',
  ];
  return sheet(grid(rows, { O: P.outline, H: P.skin, C: cloth, L: P.timberDark }));
}

function buildingSprite(defId: string, w: number, h: number, ghost: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w * TILE;
  c.height = h * TILE;
  const g = c.getContext('2d')!;
  const W = c.width;
  const H = c.height;
  const wall = ghost ? 'rgba(140,180,220,0.45)' : P.timber;
  const wallD = ghost ? 'rgba(110,150,190,0.45)' : P.timberDark;
  const roof = ghost ? 'rgba(160,200,240,0.45)' : P.roof;
  const roofL = ghost ? 'rgba(180,210,245,0.45)' : P.roofLight;
  const ol = ghost ? 'rgba(60,90,130,0.6)' : P.outline;

  g.fillStyle = ol;
  g.fillRect(0, 0, W, H);
  if (defId === 'stockpile') {
    g.fillStyle = wallD;
    g.fillRect(1, 1, W - 2, H - 2);
    g.fillStyle = wall;
    for (let i = 0; i < W / 8; i++) g.fillRect(2 + i * 8, 2, 5, H - 4); // pallet slats
  } else if (defId === 'farm') {
    g.fillStyle = P.soil;
    g.fillRect(1, 1, W - 2, H - 2);
    g.fillStyle = P.soilWet;
    for (let y = 3; y < H; y += 5) g.fillRect(1, y, W - 2, 2); // furrows
  } else {
    // roofed structures: house / kitchen / hall
    const roofH = Math.floor(H * 0.45);
    g.fillStyle = roof;
    g.fillRect(1, 1, W - 2, roofH);
    g.fillStyle = roofL;
    for (let x = 2; x < W - 2; x += 4) g.fillRect(x, 2, 2, roofH - 2); // shingles
    g.fillStyle = wall;
    g.fillRect(1, roofH + 1, W - 2, H - roofH - 2);
    g.fillStyle = wallD;
    g.fillRect(Math.floor(W / 2) - 3, H - 9, 6, 8); // door
    if (defId === 'kitchen') {
      g.fillStyle = '#888078';
      g.fillRect(W - 7, 1, 4, 6); // chimney
    }
    if (defId === 'hall') {
      g.fillStyle = wallD;
      g.fillRect(4, roofH + 3, 4, 4);
      g.fillRect(W - 8, roofH + 3, 4, 4); // windows
    }
  }
  return c;
}

function itemSprite(kind: 'wood' | 'grain' | 'meal'): HTMLCanvasElement {
  const col = kind === 'wood' ? P.wood : kind === 'grain' ? P.grain : P.meal;
  const rows = [
    '................',
    '................',
    '................',
    '................',
    '................',
    '....OOOOOO......',
    '...OXXXXXXO.....',
    '...OXXXXXXO.....',
    '...OXXXXXXO.....',
    '....OOOOOO......',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ];
  return sheet(grid(rows, { O: P.outline, X: col }));
}

function soilTile(stage: 'bare' | 'sown' | 'grown' | 'ripe'): HTMLCanvasElement {
  const c = tileNoise(P.soil, P.soilWet, 5);
  const g = c.getContext('2d')!;
  if (stage !== 'bare') {
    const col = stage === 'sown' ? P.treeLeafDark : stage === 'grown' ? P.crop : P.cropRipe;
    g.fillStyle = col;
    for (let y = 2; y < TILE; y += 5) {
      for (let x = 2; x < TILE; x += 4) {
        const hgt = stage === 'sown' ? 2 : stage === 'grown' ? 4 : 6;
        g.fillRect(x, y - (hgt - 2), 2, hgt);
      }
    }
  }
  return c;
}

export function buildSprites(buildingDefs: { id: string; w: number; h: number }[]): SpriteSet {
  const buildings: Record<string, HTMLCanvasElement> = {};
  const blueprints: Record<string, HTMLCanvasElement> = {};
  for (const d of buildingDefs) {
    buildings[d.id] = buildingSprite(d.id, d.w, d.h, false);
    blueprints[d.id] = buildingSprite(d.id, d.w, d.h, true);
  }
  return {
    grass: [tileNoise(P.grass1, P.grass2, 0), tileNoise(P.grass1, P.grass2, 4)],
    tree: treeSprite(false),
    treeMarked: treeSprite(true),
    water: [tileNoise(P.water1, P.water2, 0), tileNoise(P.water1, P.water2, 6)],
    rock: tileNoise(P.rock, P.rockDark, 2),
    soil: soilTile('bare'),
    soilSown: soilTile('sown'),
    soilGrown: soilTile('grown'),
    soilRipe: soilTile('ripe'),
    settler: [P.cloth1, P.cloth2, P.cloth3].map((c) => [settlerSprite(c, 0), settlerSprite(c, 1)]),
    items: { wood: itemSprite('wood'), grain: itemSprite('grain'), meal: itemSprite('meal') },
    buildings,
    blueprints,
  };
}
