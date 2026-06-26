/**
 * HF asset generator for the **live 4X override slots** — the sibling of
 * scripts/hf-sprites.ts, but targeting the slots the shipping game actually
 * overrides via AssetRegistry (`town-<tier>`, `backdrop-<era>`) and writing into
 * `public/assets/` + `asset_manifest.json`, the manifest the runtime reads.
 *
 * The slot list + prompts live in `src/data/assetCatalog.ts` (type-checked,
 * unit-tested); this file is just the CLI + HF I/O. HF returns PNG bytes the
 * registry loads directly, so no encoder is needed for these image assets.
 *
 * Usage:
 *   HF_TOKEN=hf_xxx npx tsx scripts/hf-assets.ts
 *   HF_TOKEN=hf_xxx npx tsx scripts/hf-assets.ts --slots=town-castle,backdrop-dawn
 *   HF_TOKEN=hf_xxx npx tsx scripts/hf-assets.ts --category=backdrop
 *   HF_TOKEN=hf_xxx npx tsx scripts/hf-assets.ts --era=dawn
 *   npx tsx scripts/hf-assets.ts --dry-run
 *
 * Options:
 *   --dry-run        Print what would be requested without calling the API.
 *   --slots=a,b      Comma-separated subset of slot names.
 *   --category=town|backdrop   Filter by category.
 *   --era=dawn       Filter backdrop slots by era id.
 *   --model=<id>     Override the HF model (default below).
 *   --retries=N      Max retries on a model-loading 503 (default: 4).
 *
 * NOTE: from a sandboxed web session the HF Inference API may be blocked by the
 * egress policy (a 403 from the agent proxy). Run this locally, or from an
 * environment whose network policy allows huggingface.co.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LIVE_ASSET_CATALOG,
  NEGATIVE,
  mergeManifestItems,
  type AssetSlotDef,
  type GeneratedAssetItem,
} from '../src/data/assetCatalog';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = join(__dirname, '../public/assets');
const MANIFEST_PATH = join(ASSETS_DIR, 'asset_manifest.json');

const DEFAULT_MODEL = 'black-forest-labs/FLUX.1-schnell';
const HF_API_BASE = 'https://api-inference.huggingface.co/models';

function isPNG(buf: Buffer): boolean {
  return buf.length > 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}

/** Round up to the nearest multiple of 64, with a floor — most diffusion
 *  models require dimensions that are multiples of 8/64. */
function snap64(n: number, floor = 512): number {
  return Math.max(Math.ceil(n / 64) * 64, floor);
}

async function generateImage(
  slot: AssetSlotDef,
  token: string,
  model: string,
  maxRetries: number,
): Promise<Buffer> {
  const url = `${HF_API_BASE}/${model}`;
  const width = snap64(slot.w);
  const height = snap64(slot.h);

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
        parameters: { width, height, negative_prompt: NEGATIVE },
      }),
    });

    if (res.status === 503) {
      const waitMs = (attempt + 1) * 8_000;
      process.stdout.write(`loading (${Math.round(waitMs / 1000)}s)... `);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (!isPNG(buf)) process.stdout.write(`[non-PNG bytes:${buf.subarray(0, 4).toString('hex')}] `);
    return buf;
  }
  throw new Error(`Exceeded ${maxRetries} retries (model still loading)`);
}

function parseArgs(argv: string[]) {
  const flags = new Set(argv.filter((a) => !a.includes('=')));
  const kv = Object.fromEntries(
    argv.filter((a) => a.includes('=')).map((a) => a.replace(/^--/, '').split('=') as [string, string]),
  );
  return {
    dryRun: flags.has('--dry-run'),
    slotFilter: kv.slots ? new Set(kv.slots.split(',')) : null,
    category: kv.category ?? null,
    era: kv.era ?? null,
    model: kv.model ?? DEFAULT_MODEL,
    maxRetries: kv.retries != null ? parseInt(kv.retries, 10) : 4,
    token: process.env.HF_TOKEN ?? '',
  };
}

function selectSlots(opts: ReturnType<typeof parseArgs>): AssetSlotDef[] {
  return LIVE_ASSET_CATALOG.filter((s) => {
    if (opts.slotFilter && !opts.slotFilter.has(s.slot)) return false;
    if (opts.category && s.category !== opts.category) return false;
    if (opts.era && s.era !== opts.era) return false;
    return true;
  });
}

function readManifest(): { schemaVersion?: number; items?: GeneratedAssetItem[]; [k: string]: unknown } {
  if (!existsSync(MANIFEST_PATH)) return { schemaVersion: 1, items: [] };
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  } catch {
    return { schemaVersion: 1, items: [] };
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.dryRun && !opts.token) {
    console.error('Error: set HF_TOKEN env var or pass --dry-run');
    process.exit(1);
  }

  const slots = selectSlots(opts);
  if (slots.length === 0) {
    console.error('No matching slots. Available:');
    console.error(' ', LIVE_ASSET_CATALOG.map((s) => s.slot).join(', '));
    process.exit(1);
  }

  console.log('Centuria HF Asset Generator (live 4X slots)');
  console.log(`  model : ${opts.model}`);
  console.log(`  slots : ${slots.length}`);
  console.log(`  mode  : ${opts.dryRun ? 'dry-run (no API calls)' : 'live'}\n`);

  if (opts.dryRun) {
    for (const s of slots) {
      console.log(`  ${s.slot.padEnd(16)} [${s.category}] ${snap64(s.w)}×${snap64(s.h)}`);
      console.log(`    "${s.prompt}"`);
    }
    console.log(`\n${slots.length} slot(s) would be generated → public/assets/, manifest updated.`);
    return;
  }

  mkdirSync(ASSETS_DIR, { recursive: true });
  const manifest = readManifest();
  const generated: GeneratedAssetItem[] = [];
  let ok = 0;
  let fail = 0;

  for (const s of slots) {
    process.stdout.write(`  ${s.slot.padEnd(16)} ... `);
    try {
      const buf = await generateImage(s, opts.token, opts.model, opts.maxRetries);
      const file = `${s.slot}.png`;
      writeFileSync(join(ASSETS_DIR, file), buf);
      const sha256 = createHash('sha256').update(buf).digest('hex');
      generated.push({ slot: s.slot, file, category: s.category, era: s.era, sha256 });
      console.log(`ok (${buf.length} bytes, sha ${sha256.slice(0, 12)})`);
      ok++;
    } catch (e) {
      console.log(`FAILED — ${(e as Error).message}`);
      fail++;
    }
  }

  manifest.items = mergeManifestItems(manifest.items ?? [], generated);
  manifest.schemaVersion ??= 1;
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\n${ok} generated, ${fail} failed. Manifest now lists ${manifest.items.length} override(s).`);
  if (fail > 0) process.exit(1);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
