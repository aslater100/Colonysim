/**
 * HF sprite generator — calls the Hugging Face Inference API to produce
 * pixel-art sprites and drops them into public/sprites/, updating index.json.
 *
 * The game's applyOverrides() loader scales any PNG to the slot's canvas size,
 * so the generated image does not need to exactly match slot dimensions.
 *
 * Usage:
 *   HF_TOKEN=hf_xxx npx tsx scripts/hf-sprites.ts
 *   HF_TOKEN=hf_xxx npx tsx scripts/hf-sprites.ts --slots=tree,grass-0,rock
 *   npx tsx scripts/hf-sprites.ts --dry-run
 *   npx tsx scripts/hf-sprites.ts --dry-run --slots=settler-0-0
 *
 * Options:
 *   --dry-run          Print what would be requested without calling the API.
 *   --slots=a,b,c      Comma-separated subset of slot names to generate.
 *   --model=<id>       Override the HF model (default: FLUX.1-schnell).
 *   --retries=N        Max retries per slot on model-loading 503 (default: 4).
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPRITES_DIR = join(__dirname, '../public/sprites');
const INDEX_PATH = join(SPRITES_DIR, 'index.json');

// ---------------------------------------------------------------------------
// Slot catalog — name matches spriteOverrides naming convention, prompt is
// tuned for the game's top-down pixel-art aesthetic (warm light, dark outlines,
// transparent background where applicable).
// ---------------------------------------------------------------------------

interface SlotDef {
  name: string;
  /** Slot canvas size in the game — used for proportional generation hints. */
  w: number;
  h: number;
  prompt: string;
}

const SUFFIX = 'pixel art, 32x32, top-down view, warm sunlight from top-left, dark warm outline, clean transparent background, game sprite';

const CATALOG: SlotDef[] = [
  // Terrain
  {
    name: 'grass-0',
    w: 32, h: 32,
    prompt: `lush green grass ground tile, short blades, slight texture variation, seamless, ${SUFFIX}`,
  },
  {
    name: 'grass-1',
    w: 32, h: 32,
    prompt: `medium green grass ground tile, slightly darker hue, mottled clumps, seamless, ${SUFFIX}`,
  },
  {
    name: 'grass-2',
    w: 32, h: 32,
    prompt: `green grass tile with scattered small stones, seamless ground texture, ${SUFFIX}`,
  },
  {
    name: 'grass-3',
    w: 32, h: 32,
    prompt: `green grass tile with patchy dry spots and blade highlights, seamless, ${SUFFIX}`,
  },
  {
    name: 'dirtPatch',
    w: 32, h: 32,
    prompt: `bare brown dirt patch, earthy brown, irregular oval shape, seamless blend to grass edges, ${SUFFIX}`,
  },
  {
    name: 'tree',
    w: 32, h: 32,
    prompt: `deciduous tree top-down canopy, round green crown with warm highlight on top, dark trunk visible at centre, ${SUFFIX}`,
  },
  {
    name: 'treeMarked',
    w: 32, h: 32,
    prompt: `deciduous tree top-down canopy with an orange X marking for felling, green crown, ${SUFFIX}`,
  },
  {
    name: 'sapling',
    w: 32, h: 32,
    prompt: `tiny young tree sapling top-down view, small round light-green leaf cluster, thin brown twig, ${SUFFIX}`,
  },
  {
    name: 'rock',
    w: 32, h: 32,
    prompt: `grey stone boulder top-down view, rounded irregular shape, warm lit top face, cool blue shadow on lower edge, ${SUFFIX}`,
  },
  {
    name: 'rockMarked',
    w: 32, h: 32,
    prompt: `grey stone boulder top-down view with orange X marking for quarrying, ${SUFFIX}`,
  },
  {
    name: 'soil',
    w: 32, h: 32,
    prompt: `tilled farm soil bare, brown furrow rows, dark earth, agricultural field tile, ${SUFFIX}`,
  },
  {
    name: 'soilSown',
    w: 32, h: 32,
    prompt: `freshly sown farm field, brown soil with tiny green seedling sprouts in rows, ${SUFFIX}`,
  },
  {
    name: 'soilGrown',
    w: 32, h: 32,
    prompt: `growing crop field, medium-height green plants in rows, lush, ${SUFFIX}`,
  },
  {
    name: 'soilRipe',
    w: 32, h: 32,
    prompt: `ripe golden wheat grain crop field ready to harvest, tall yellow-gold stalks, ${SUFFIX}`,
  },
  {
    name: 'water-0',
    w: 32, h: 32,
    prompt: `water tile, blue-teal ripple animation frame 1, subtle glint highlights, seamless, ${SUFFIX}`,
  },
  {
    name: 'water-1',
    w: 32, h: 32,
    prompt: `water tile, blue-teal ripple animation frame 2, shifted glint position, seamless, ${SUFFIX}`,
  },
  {
    name: 'water-2',
    w: 32, h: 32,
    prompt: `water tile, blue-teal ripple animation frame 3, different wave crest, seamless, ${SUFFIX}`,
  },
  // Build system
  {
    name: 'palisade',
    w: 32, h: 32,
    prompt: `wooden palisade wall segment top-down view, vertical log stakes, brown wood, ${SUFFIX}`,
  },
  {
    name: 'gate',
    w: 32, h: 32,
    prompt: `wooden palisade gate top-down view, two log panels with a gap, brown wood, ${SUFFIX}`,
  },
  {
    name: 'interiorFloor',
    w: 32, h: 32,
    prompt: `wooden plank floor interior tile, warm brown planks, seamless, top-down, ${SUFFIX}`,
  },
  {
    name: 'interiorWall',
    w: 32, h: 32,
    prompt: `stone interior room wall segment top-down view, grey stone blocks, ${SUFFIX}`,
  },
  {
    name: 'wallPlan',
    w: 32, h: 32,
    prompt: `blueprint ghost wall plan marker, light blue transparent outline, construction marker, top-down, ${SUFFIX}`,
  },
  {
    name: 'gatePlan',
    w: 32, h: 32,
    prompt: `blueprint ghost gate plan marker, light blue transparent outline, construction marker, top-down, ${SUFFIX}`,
  },
  {
    name: 'stockpileZone',
    w: 32, h: 32,
    prompt: `stockpile storage zone tile marker, subtle golden grid or dotted outline on ground, top-down, ${SUFFIX}`,
  },
  {
    name: 'trapZone',
    w: 32, h: 32,
    prompt: `spike trap floor tile top-down view, wooden board with protruding metal spikes, ${SUFFIX}`,
  },
  // Creatures
  {
    name: 'settler-0-0',
    w: 32, h: 32,
    prompt: `medieval colonist villager pawn top-down view, walking frame 1, ochre tunic, brown hair, small figure, ${SUFFIX}`,
  },
  {
    name: 'settler-0-1',
    w: 32, h: 32,
    prompt: `medieval colonist villager pawn top-down view, walking frame 2 mid-stride, ochre tunic, small figure, ${SUFFIX}`,
  },
  {
    name: 'settler-0-2',
    w: 32, h: 32,
    prompt: `medieval colonist villager pawn top-down view, working pose frame 3, ochre tunic, small figure, ${SUFFIX}`,
  },
  {
    name: 'settler-0-3',
    w: 32, h: 32,
    prompt: `medieval colonist villager pawn top-down view, standing idle frame 4, ochre tunic, small figure, ${SUFFIX}`,
  },
  {
    name: 'settler-1-0',
    w: 32, h: 32,
    prompt: `medieval colonist villager pawn top-down view, walking frame 1, teal-blue tunic, different hair, small figure, ${SUFFIX}`,
  },
  {
    name: 'settler-1-1',
    w: 32, h: 32,
    prompt: `medieval colonist villager pawn top-down view, walking frame 2, teal-blue tunic, small figure, ${SUFFIX}`,
  },
  {
    name: 'settler-1-2',
    w: 32, h: 32,
    prompt: `medieval colonist villager pawn top-down view, working pose frame 3, teal-blue tunic, small figure, ${SUFFIX}`,
  },
  {
    name: 'settler-1-3',
    w: 32, h: 32,
    prompt: `medieval colonist villager pawn top-down view, idle frame 4, teal-blue tunic, small figure, ${SUFFIX}`,
  },
  {
    name: 'settler-2-0',
    w: 32, h: 32,
    prompt: `medieval colonist villager pawn top-down view, walking frame 1, dark red tunic, grey hair, small figure, ${SUFFIX}`,
  },
  {
    name: 'settler-2-1',
    w: 32, h: 32,
    prompt: `medieval colonist villager pawn top-down view, walking frame 2, dark red tunic, small figure, ${SUFFIX}`,
  },
  {
    name: 'settler-2-2',
    w: 32, h: 32,
    prompt: `medieval colonist villager pawn top-down view, working pose, dark red tunic, small figure, ${SUFFIX}`,
  },
  {
    name: 'settler-2-3',
    w: 32, h: 32,
    prompt: `medieval colonist villager pawn top-down view, idle, dark red tunic, small figure, ${SUFFIX}`,
  },
  {
    name: 'raider-0',
    w: 32, h: 32,
    prompt: `enemy raider warrior pawn top-down view, frame 1, dark leather armour, weapon raised, menacing, small figure, ${SUFFIX}`,
  },
  {
    name: 'raider-1',
    w: 32, h: 32,
    prompt: `enemy raider warrior pawn top-down view, frame 2 charging, dark leather armour, small figure, ${SUFFIX}`,
  },
  {
    name: 'raider-2',
    w: 32, h: 32,
    prompt: `enemy raider warrior pawn top-down view, frame 3 striking, dark armour, small figure, ${SUFFIX}`,
  },
  {
    name: 'wolf-0',
    w: 32, h: 32,
    prompt: `grey wolf top-down view, prowling frame 1, four-legged predator, fur texture, small sprite, ${SUFFIX}`,
  },
  {
    name: 'wolf-1',
    w: 32, h: 32,
    prompt: `grey wolf top-down view, walking frame 2, four-legged predator, small sprite, ${SUFFIX}`,
  },
  {
    name: 'wolf-2',
    w: 32, h: 32,
    prompt: `grey wolf top-down view, lunging frame 3, four-legged predator, small sprite, ${SUFFIX}`,
  },
  {
    name: 'deer-0',
    w: 32, h: 32,
    prompt: `brown deer top-down view, grazing frame 1, four-legged animal, gentle, small sprite, ${SUFFIX}`,
  },
  {
    name: 'deer-1',
    w: 32, h: 32,
    prompt: `brown deer top-down view, walking frame 2, four-legged animal, small sprite, ${SUFFIX}`,
  },
  {
    name: 'deer-2',
    w: 32, h: 32,
    prompt: `brown deer top-down view, alert frame 3, head raised, four-legged animal, small sprite, ${SUFFIX}`,
  },
  {
    name: 'grave',
    w: 32, h: 32,
    prompt: `small gravestone and burial mound top-down view, grey stone marker, brown mounded earth, ${SUFFIX}`,
  },
  {
    name: 'corpse',
    w: 32, h: 32,
    prompt: `fallen body corpse top-down view, still figure on ground, dark silhouette, ${SUFFIX}`,
  },
  // Items
  {
    name: 'items-wood',
    w: 16, h: 16,
    prompt: `small wood log pile item icon, brown timber logs, stacked, pixel art, 16x16, transparent background`,
  },
  {
    name: 'items-stone',
    w: 16, h: 16,
    prompt: `small grey stone pile item icon, rough rocks, stacked, pixel art, 16x16, transparent background`,
  },
  {
    name: 'items-grain',
    w: 16, h: 16,
    prompt: `small golden grain wheat bundle item icon, tied sheaf, pixel art, 16x16, transparent background`,
  },
  {
    name: 'items-meal',
    w: 16, h: 16,
    prompt: `small cooked meal item icon, bowl of stew, warm brown, pixel art, 16x16, transparent background`,
  },
  {
    name: 'items-tools',
    w: 16, h: 16,
    prompt: `small tools item icon, hammer and chisel crossed, pixel art, 16x16, transparent background`,
  },
  {
    name: 'items-weapons',
    w: 16, h: 16,
    prompt: `small weapons item icon, crossed sword and spear, pixel art, 16x16, transparent background`,
  },
  {
    name: 'items-clothes',
    w: 16, h: 16,
    prompt: `small clothes item icon, folded tunic garment, pixel art, 16x16, transparent background`,
  },
  {
    name: 'items-iron',
    w: 16, h: 16,
    prompt: `small iron ingot item icon, grey metallic bar, pixel art, 16x16, transparent background`,
  },
  {
    name: 'items-timber',
    w: 16, h: 16,
    prompt: `small sawn timber plank item icon, smooth wooden board, pixel art, 16x16, transparent background`,
  },
  {
    name: 'items-brick',
    w: 16, h: 16,
    prompt: `small red clay brick item icon, rectangular fired brick, pixel art, 16x16, transparent background`,
  },
  {
    name: 'items-bread',
    w: 16, h: 16,
    prompt: `small bread loaf item icon, golden-brown baked loaf, pixel art, 16x16, transparent background`,
  },
  {
    name: 'items-ale',
    w: 16, h: 16,
    prompt: `small ale mug item icon, frothy amber drink in wooden mug, pixel art, 16x16, transparent background`,
  },
  {
    name: 'items-medicine',
    w: 16, h: 16,
    prompt: `small medicine vial item icon, green liquid in glass bottle, pixel art, 16x16, transparent background`,
  },
];

// ---------------------------------------------------------------------------
// HF Inference API
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = 'black-forest-labs/FLUX.1-schnell';
const HF_API_BASE = 'https://api-inference.huggingface.co/models';

function isPNG(buf: Buffer): boolean {
  return buf.length > 4 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}

async function generateSprite(
  slot: SlotDef,
  token: string,
  model: string,
  maxRetries: number,
): Promise<Buffer> {
  const url = `${HF_API_BASE}/${model}`;
  const genW = Math.max(slot.w * 8, 256);
  const genH = Math.max(slot.h * 8, 256);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'image/png,image/*',
      },
      body: JSON.stringify({
        inputs: slot.prompt,
        parameters: { width: genW, height: genH, num_inference_steps: 4 },
      }),
    });

    if (res.status === 503) {
      // Model loading — wait and retry
      const waitMs = (attempt + 1) * 8_000;
      process.stdout.write(`loading (${Math.round(waitMs / 1000)}s wait)... `);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (!isPNG(buf)) {
      // HF may return JPEG or other format — still usable, but flag it
      const head = buf.slice(0, 4).toString('hex');
      process.stdout.write(`[non-PNG bytes:${head}] `);
    }
    return buf;
  }
  throw new Error(`Exceeded ${maxRetries} retries (model still loading)`);
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]) {
  const flags = new Set(argv.filter((a) => !a.includes('=')));
  const kv = Object.fromEntries(
    argv.filter((a) => a.includes('=')).map((a) => a.replace(/^--/, '').split('=') as [string, string]),
  );
  return {
    dryRun: flags.has('--dry-run'),
    slotFilter: kv.slots ? new Set(kv.slots.split(',')) : null,
    model: kv.model ?? DEFAULT_MODEL,
    maxRetries: kv.retries != null ? parseInt(kv.retries, 10) : 4,
    token: process.env.HF_TOKEN ?? '',
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.dryRun && !opts.token) {
    console.error('Error: set HF_TOKEN env var or pass --dry-run');
    console.error('  export HF_TOKEN=hf_...');
    console.error('  npx tsx scripts/hf-sprites.ts');
    process.exit(1);
  }

  const slots = opts.slotFilter
    ? CATALOG.filter((s) => opts.slotFilter!.has(s.name))
    : CATALOG;

  if (slots.length === 0) {
    console.error('No matching slots. Available names:');
    console.error(' ', CATALOG.map((s) => s.name).join(', '));
    process.exit(1);
  }

  console.log(`Centuria HF Sprite Generator`);
  console.log(`  model  : ${opts.model}`);
  console.log(`  slots  : ${slots.length}`);
  console.log(`  mode   : ${opts.dryRun ? 'dry-run (no API calls)' : 'live'}`);
  console.log('');

  if (opts.dryRun) {
    for (const s of slots) {
      console.log(`  ${s.name}.png  (${s.w}×${s.h} → generates at ${Math.max(s.w * 8, 256)}×${Math.max(s.h * 8, 256)})`);
      console.log(`    "${s.prompt}"`);
    }
    console.log(`\n${slots.length} slot(s) would be generated.`);
    return;
  }

  mkdirSync(SPRITES_DIR, { recursive: true });

  let index: string[] = [];
  if (existsSync(INDEX_PATH)) {
    try { index = JSON.parse(readFileSync(INDEX_PATH, 'utf8')); } catch { /* start fresh */ }
  }

  let ok = 0;
  let fail = 0;

  for (const s of slots) {
    process.stdout.write(`  ${s.name.padEnd(18)} ... `);
    try {
      const buf = await generateSprite(s, opts.token, opts.model, opts.maxRetries);
      const outPath = join(SPRITES_DIR, `${s.name}.png`);
      writeFileSync(outPath, buf);
      if (!index.includes(s.name)) index.push(s.name);
      console.log(`ok  (${buf.length} bytes)`);
      ok++;
    } catch (e) {
      console.log(`FAILED — ${(e as Error).message}`);
      fail++;
    }
  }

  writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2) + '\n');
  console.log(`\n${ok} generated, ${fail} failed.`);
  console.log(`public/sprites/index.json updated (${index.length} total override(s)).`);
  if (fail > 0) process.exit(1);
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
