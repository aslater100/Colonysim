/**
 * HF sprite generator — calls the Hugging Face Inference Providers API to
 * produce pixel-art sprites and drops them into public/sprites/, updating
 * index.json.
 *
 * The game's applyOverrides() loader scales any PNG to the slot's canvas size,
 * so the generated image does not need to exactly match slot dimensions.
 *
 * Endpoint: this uses the Inference Providers *router*
 * (https://router.huggingface.co/<provider>/models/<model>), which replaced the
 * old, now-removed api-inference.huggingface.co serverless endpoint. Your token
 * needs the "Inference Providers" permission:
 *   https://huggingface.co/settings/tokens/new?ownUserPermissions=inference.serverless.write&tokenType=fineGrained
 *
 * Discovering models: use the Hugging Face MCP server (declared in this repo's
 * .mcp.json) from a Claude Code session to find/verify text-to-image models and
 * which providers serve them before wiring a new --model/--provider here. See
 * docs/design/hf-mcp-sprites.md for the workflow.
 *
 * Usage:
 *   HF_TOKEN=hf_xxx npx tsx scripts/hf-sprites.ts
 *   HF_TOKEN=hf_xxx npx tsx scripts/hf-sprites.ts --slots=tree,grass-0,rock
 *   HF_TOKEN=hf_xxx npx tsx scripts/hf-sprites.ts --model=nerijs/pixel-art-xl --provider=fal-ai
 *   npx tsx scripts/hf-sprites.ts --dry-run
 *   npx tsx scripts/hf-sprites.ts --dry-run --slots=settler-0-0
 *
 * Options:
 *   --dry-run          Print what would be requested without calling the API.
 *   --slots=a,b,c      Comma-separated subset of slot names to generate.
 *   --model=<id>       Override the HF model (default: black-forest-labs/FLUX.1-schnell).
 *   --provider=<id>    Inference provider to route through (default: hf-inference).
 *                      e.g. hf-inference, fal-ai, replicate, together, nscale.
 *   --steps=N          Denoising steps (default: 4, tuned for the schnell model).
 *   --guidance=N       Send guidance_scale + negative_prompt (skip for schnell/turbo
 *                      models, which ignore guidance). Default: omitted.
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

// nerijs/pixel-art-xl trigger word is "pixel art"; top-down colony sim style
const SUFFIX = 'pixel art, top-down view, warm sunlight from top-left, dark outline, transparent background, game sprite, RimWorld style';
const NEGATIVE = 'realistic, 3d render, photograph, blurry, smooth shading, anti-aliased, watercolor, painting, low contrast';

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

// black-forest-labs/FLUX.1-schnell: a fast distilled model served by six
// providers (hf-inference, fal-ai, replicate, together, nscale, wavespeed), so
// it's far more reliably reachable than a single-provider SDXL LoRA. It honours
// the "pixel art" trigger baked into every prompt's SUFFIX. To use an SDXL pixel
// LoRA instead, pass --model=nerijs/pixel-art-xl --provider=fal-ai --guidance=7.
const DEFAULT_MODEL = 'black-forest-labs/FLUX.1-schnell';
const DEFAULT_PROVIDER = 'hf-inference';
const DEFAULT_STEPS = 4;
// Inference Providers router (replaces the removed api-inference.huggingface.co).
const HF_ROUTER_BASE = 'https://router.huggingface.co';

interface GenOpts {
  token: string;
  model: string;
  provider: string;
  steps: number;
  /** When set, send guidance_scale + negative_prompt (skip for schnell/turbo). */
  guidance: number | null;
  maxRetries: number;
}

function isPNG(buf: Buffer): boolean {
  return buf.length > 4 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}

/**
 * Pull image bytes out of a router response. The hf-inference provider returns
 * raw image bytes; some providers wrap the result in JSON as a base64 blob or a
 * URL we then have to fetch. Handle all three so --provider can vary freely.
 */
async function extractImage(res: Response): Promise<Buffer> {
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) {
    return Buffer.from(await res.arrayBuffer());
  }
  const json: unknown = await res.json();
  // Common shapes: { images: [{ url }] } | { data: [{ b64_json }] } | "<b64>"
  const pick = (o: unknown): string | undefined => {
    if (typeof o === 'string') return o;
    if (!o || typeof o !== 'object') return undefined;
    const r = o as Record<string, unknown>;
    const arr = (r.images ?? r.data ?? r.output) as unknown;
    const first = Array.isArray(arr) ? arr[0] : undefined;
    if (typeof first === 'string') return first;
    if (first && typeof first === 'object') {
      const f = first as Record<string, unknown>;
      return (f.url ?? f.b64_json ?? f.image) as string | undefined;
    }
    return (r.url ?? r.b64_json ?? r.image) as string | undefined;
  };
  const val = pick(json);
  if (!val) throw new Error(`unrecognised JSON response: ${JSON.stringify(json).slice(0, 200)}`);
  if (val.startsWith('http')) {
    const img = await fetch(val);
    if (!img.ok) throw new Error(`image URL fetch failed: HTTP ${img.status}`);
    return Buffer.from(await img.arrayBuffer());
  }
  // base64 (optionally a data: URI)
  return Buffer.from(val.replace(/^data:image\/\w+;base64,/, ''), 'base64');
}

async function generateSprite(slot: SlotDef, opts: GenOpts): Promise<Buffer> {
  const url = `${HF_ROUTER_BASE}/${opts.provider}/models/${opts.model}`;
  // Diffusion models prefer ≥512; scale up to nearest 64 multiple, at least 512.
  const genW = Math.max(Math.ceil((slot.w * 8) / 64) * 64, 512);
  const genH = Math.max(Math.ceil((slot.h * 8) / 64) * 64, 512);

  const parameters: Record<string, unknown> = {
    width: genW,
    height: genH,
    num_inference_steps: opts.steps,
  };
  // schnell/turbo models ignore guidance; only send it when asked (--guidance).
  if (opts.guidance != null) {
    parameters.guidance_scale = opts.guidance;
    parameters.negative_prompt = NEGATIVE;
  }

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.token}`,
        'Content-Type': 'application/json',
        Accept: 'image/png,image/*',
      },
      body: JSON.stringify({ inputs: slot.prompt, parameters }),
    });

    // Model cold-start (503) or rate limit (429): wait and retry with backoff.
    if (res.status === 503 || res.status === 429) {
      const waitMs = (attempt + 1) * 8_000;
      const why = res.status === 429 ? 'rate-limited' : 'loading';
      process.stdout.write(`${why} (${Math.round(waitMs / 1000)}s wait)... `);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }

    if (res.status === 401 || res.status === 403) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `HTTP ${res.status} (auth): token rejected — ensure it has the ` +
        `"Inference Providers" permission. ${body.slice(0, 200)}`,
      );
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
    }

    const buf = await extractImage(res);
    if (!isPNG(buf)) {
      // Provider may return JPEG/WebP — still usable by the loader, but flag it.
      const head = buf.slice(0, 4).toString('hex');
      process.stdout.write(`[non-PNG bytes:${head}] `);
    }
    return buf;
  }
  throw new Error(`Exceeded ${opts.maxRetries} retries (model still loading / rate-limited)`);
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
    provider: kv.provider ?? DEFAULT_PROVIDER,
    steps: kv.steps != null ? parseInt(kv.steps, 10) : DEFAULT_STEPS,
    guidance: kv.guidance != null ? parseFloat(kv.guidance) : null,
    maxRetries: kv.retries != null ? parseInt(kv.retries, 10) : 4,
    token: process.env.HF_TOKEN ?? process.env.HUGGINGFACE_TOKEN ?? '',
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.dryRun && !opts.token) {
    console.error('Error: set HF_TOKEN env var or pass --dry-run');
    console.error('  export HF_TOKEN=hf_...   # needs the "Inference Providers" permission');
    console.error('  npx tsx scripts/hf-sprites.ts');
    console.error('  Create a token: https://huggingface.co/settings/tokens/new?ownUserPermissions=inference.serverless.write&tokenType=fineGrained');
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
  console.log(`  model    : ${opts.model}`);
  console.log(`  provider : ${opts.provider}`);
  console.log(`  steps    : ${opts.steps}${opts.guidance != null ? `  guidance: ${opts.guidance}` : ''}`);
  console.log(`  slots    : ${slots.length}`);
  console.log(`  mode     : ${opts.dryRun ? 'dry-run (no API calls)' : 'live'}`);
  console.log('');

  if (opts.dryRun) {
    for (const s of slots) {
      const gw = Math.max(Math.ceil((s.w * 8) / 64) * 64, 512);
      const gh = Math.max(Math.ceil((s.h * 8) / 64) * 64, 512);
      console.log(`  ${s.name}.png  (${s.w}×${s.h} → generates at ${gw}×${gh})`);
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
      const buf = await generateSprite(s, {
        token: opts.token,
        model: opts.model,
        provider: opts.provider,
        steps: opts.steps,
        guidance: opts.guidance,
        maxRetries: opts.maxRetries,
      });
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
