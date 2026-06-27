/**
 * Local AI asset generator — a FREE, fully-local image-generation tool for
 * Centuria's override slots, driven from Claude Code (or by hand). It talks to a
 * Stable Diffusion server you run on your own machine (no Hugging Face, no token,
 * no per-image cost, no cloud egress), post-processes the result, and wires it
 * through the manifest-driven override seam.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ONE-TIME SETUP (local, free)
 *   1. Install a local Stable Diffusion server with an HTTP API. Either:
 *        • AUTOMATIC1111 WebUI — launch with `./webui.sh --api` (or --nowebui
 *          --api). Default API at http://127.0.0.1:7860. (Default backend here.)
 *        • Any A1111-API-compatible server (SD.Next, Forge) at the same routes.
 *      Pick an SDXL or SD1.5 checkpoint you like; quality is your model's job.
 *   2. (Optional, sharper town cut-outs) `pip install rembg` for model matting;
 *      otherwise the built-in flood-fill (scripts/png.ts) handles backgrounds.
 *
 * USAGE (from this repo)
 *   npm run gen:local -- --dry-run                 # plan only, no server needed
 *   npm run gen:local -- --slots=backdrop-dawn     # one slot
 *   npm run gen:local -- --category=backdrop       # all 5 backdrops
 *   npm run gen:local                               # all 11 slots
 *   npm run gen:local -- --api-url=http://127.0.0.1:7860 --steps=30 --cfg=6.5
 *   npm run gen:local -- --slots=town-castle --bg-tool=rembg
 *
 * It writes public/assets/<slot>.png and updates public/assets/asset_manifest.json
 * (town sprites get a transparent background; backdrops stay opaque). The COMMITTED
 * manifest must stay empty + the PNGs are gitignored — restore with
 * `git checkout -- public/assets/asset_manifest.json` before committing; ship the
 * binaries as a GitHub Release pack. A missing/failed slot is harmless: the game
 * falls back to its procedural art.
 * ──────────────────────────────────────────────────────────────────────────
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import {
  LIVE_ASSET_CATALOG,
  NEGATIVE,
  mergeManifestItems,
  type AssetSlotDef,
  type GeneratedAssetItem,
} from '../src/data/assetCatalog';
import { decodePng, encodePng, floodFillAlpha } from './png';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = join(__dirname, '../public/assets');
const MANIFEST_PATH = join(ASSETS_DIR, 'asset_manifest.json');

const DEFAULT_API = 'http://127.0.0.1:7860';

/** Round up to a 64-multiple (diffusion-friendly), with a floor so town icons —
 *  nominally 256 — generate big enough to look good before the registry rescales
 *  them down to TOWN_TIER_PX. Backdrops (1216×704) already clear any floor. */
function snap64(n: number, floor = 0): number {
  return Math.max(Math.ceil(n / 64) * 64, floor);
}

interface Opts {
  dryRun: boolean;
  slotFilter: Set<string> | null;
  category: string | null;
  era: string | null;
  apiUrl: string;
  steps: number;
  cfg: number;
  sampler: string;
  seed: number;
  model: string | null;
  bg: boolean;       // remove background on town slots
  bgTool: 'builtin' | 'rembg';
  bgTol: number;
  retries: number;
}

function parseArgs(argv: string[]): Opts {
  const flags = new Set(argv.filter((a) => !a.includes('=')));
  const kv = Object.fromEntries(
    argv.filter((a) => a.includes('=')).map((a) => a.replace(/^--/, '').split('=') as [string, string]),
  );
  return {
    dryRun: flags.has('--dry-run'),
    slotFilter: kv.slots ? new Set(kv.slots.split(',')) : null,
    category: kv.category ?? null,
    era: kv.era ?? null,
    apiUrl: (kv['api-url'] ?? process.env.SD_API_URL ?? DEFAULT_API).replace(/\/$/, ''),
    steps: kv.steps != null ? parseInt(kv.steps, 10) : 28,
    cfg: kv.cfg != null ? parseFloat(kv.cfg) : 7,
    sampler: kv.sampler ?? 'DPM++ 2M Karras',
    seed: kv.seed != null ? parseInt(kv.seed, 10) : -1,
    model: kv.model ?? null,
    bg: !flags.has('--no-bg'),
    bgTool: kv['bg-tool'] === 'rembg' ? 'rembg' : 'builtin',
    bgTol: kv['bg-tol'] != null ? parseInt(kv['bg-tol'], 10) : 1600,
    retries: kv.retries != null ? parseInt(kv.retries, 10) : 2,
  };
}

function selectSlots(opts: Opts): AssetSlotDef[] {
  return LIVE_ASSET_CATALOG.filter((s) => {
    if (opts.slotFilter && !opts.slotFilter.has(s.slot)) return false;
    if (opts.category && s.category !== opts.category) return false;
    if (opts.era && s.era !== opts.era) return false;
    return true;
  });
}

function genSize(s: AssetSlotDef): { width: number; height: number } {
  // Towns get a 512 floor (then downscaled by the registry); backdrops keep their
  // wide aspect. Both snapped to 64-multiples for the sampler.
  const floor = s.category === 'town' ? 512 : 0;
  return { width: snap64(s.w, floor), height: snap64(s.h, floor) };
}

function readManifest(): { schemaVersion?: number; items?: GeneratedAssetItem[]; [k: string]: unknown } {
  if (!existsSync(MANIFEST_PATH)) return { schemaVersion: 1, items: [] };
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  } catch {
    return { schemaVersion: 1, items: [] };
  }
}

/** POST to the local A1111-compatible txt2img endpoint; return the PNG bytes. */
async function txt2img(s: AssetSlotDef, opts: Opts): Promise<Buffer> {
  const { width, height } = genSize(s);
  const body: Record<string, unknown> = {
    prompt: s.prompt,
    negative_prompt: NEGATIVE,
    width,
    height,
    steps: opts.steps,
    cfg_scale: opts.cfg,
    sampler_name: opts.sampler,
    seed: opts.seed,
    batch_size: 1,
    n_iter: 1,
  };
  if (opts.model) {
    body.override_settings = { sd_model_checkpoint: opts.model };
    body.override_settings_restore_afterwards = true;
  }
  let lastErr: unknown;
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      const res = await fetch(`${opts.apiUrl}/sdapi/v1/txt2img`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} — ${(await res.text()).slice(0, 200)}`);
      const json = (await res.json()) as { images?: string[] };
      const b64 = json.images?.[0];
      if (!b64) throw new Error('response had no images[]');
      return Buffer.from(b64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
    } catch (e) {
      lastErr = e;
      if (attempt < opts.retries) await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Cut the background of a town sprite to transparency (built-in flood-fill, or
 *  rembg if requested + installed). Returns RGBA PNG bytes. */
function removeBackground(png: Buffer, opts: Opts): Buffer {
  if (opts.bgTool === 'rembg') {
    try {
      const inP = join(tmpdir(), `cen-bg-in-${process.pid}.png`);
      const outP = join(tmpdir(), `cen-bg-out-${process.pid}.png`);
      writeFileSync(inP, png);
      execFileSync('rembg', ['i', inP, outP], { stdio: 'pipe' });
      return readFileSync(outP);
    } catch (e) {
      process.stdout.write(`(rembg failed: ${(e as Error).message.slice(0, 60)} → flood-fill) `);
    }
  }
  return encodePng(floodFillAlpha(decodePng(png), opts.bgTol));
}

/** Fail fast with a helpful message if the local server isn't reachable. */
async function preflight(apiUrl: string): Promise<void> {
  try {
    const res = await fetch(`${apiUrl}/sdapi/v1/options`, { method: 'GET' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    console.error(`\nCannot reach a local Stable Diffusion API at ${apiUrl}`);
    console.error(`  (${(e as Error).message})`);
    console.error('  Start one first, e.g. AUTOMATIC1111:  ./webui.sh --api');
    console.error('  or point at yours:  npm run gen:local -- --api-url=http://HOST:PORT');
    console.error('  (no server needed for --dry-run)');
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const slots = selectSlots(opts);
  if (slots.length === 0) {
    console.error('No matching slots. Available:');
    console.error(' ', LIVE_ASSET_CATALOG.map((s) => s.slot).join(', '));
    process.exit(1);
  }

  console.log('Centuria local AI asset generator');
  console.log(`  backend : ${opts.apiUrl}${opts.model ? ` (checkpoint ${opts.model})` : ''}`);
  console.log(`  sampler : ${opts.sampler}  steps ${opts.steps}  cfg ${opts.cfg}  seed ${opts.seed}`);
  console.log(`  slots   : ${slots.length}`);
  console.log(`  mode    : ${opts.dryRun ? 'dry-run (no server calls)' : 'live'}\n`);

  if (opts.dryRun) {
    for (const s of slots) {
      const { width, height } = genSize(s);
      const bg = s.category === 'town' && opts.bg ? ` +bg-cut(${opts.bgTool})` : '';
      console.log(`  ${s.slot.padEnd(16)} [${s.category}] ${width}×${height}${bg}`);
      console.log(`    "${s.prompt.slice(0, 100)}${s.prompt.length > 100 ? '…' : ''}"`);
    }
    console.log(`\n${slots.length} slot(s) would be generated → public/assets/, manifest updated.`);
    return;
  }

  await preflight(opts.apiUrl);
  mkdirSync(ASSETS_DIR, { recursive: true });
  const manifest = readManifest();
  const generated: GeneratedAssetItem[] = [];
  let ok = 0, fail = 0;

  for (const s of slots) {
    process.stdout.write(`  ${s.slot.padEnd(16)} ... `);
    try {
      let buf = await txt2img(s, opts);
      if (s.category === 'town' && opts.bg) {
        process.stdout.write('cut-bg ');
        buf = removeBackground(buf, opts);
      }
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
  console.log('Reminder: `git checkout -- public/assets/asset_manifest.json` before committing (ship PNGs as a Release pack).');
  if (fail > 0) process.exitCode = 1;
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
