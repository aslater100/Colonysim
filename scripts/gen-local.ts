/**
 * Local AI asset generator — a FREE, fully-local image-generation tool for
 * Centuria's override slots, driven from Claude Code (or by hand). It talks to a
 * Stable Diffusion server you run on your own machine (no Hugging Face, no token,
 * no per-image cost, no cloud egress), post-processes the result, and wires it
 * through the manifest-driven override seam.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ONE-TIME SETUP (local, free) — pick ONE backend:
 *   • AUTOMATIC1111 WebUI (default): launch `./webui.sh --api`. API at
 *     http://127.0.0.1:7860. Any A1111-compatible server (SD.Next, Forge) works.
 *   • ComfyUI: launch normally (default http://127.0.0.1:8188); pass
 *     `--backend=comfy --model=<checkpoint.safetensors>`.
 *   (Optional, sharper town cut-outs) `pip install rembg`, then `--bg-tool=rembg`.
 *
 * USAGE (from this repo)
 *   npm run gen:local -- --init                     # check server + list checkpoints
 *   npm run gen:local -- --dry-run                  # plan only, no server needed
 *   npm run gen:local -- --slots=backdrop-dawn      # one slot
 *   npm run gen:local -- --category=backdrop        # all 5 backdrops
 *   npm run gen:local                                # all 11 slots
 *   npm run gen:local -- --backend=comfy --model=sd_xl_base_1.0.safetensors
 *   npm run gen:local -- --slots=town-castle --bg-tool=rembg
 *   npm run gen:local -- --max-dim=768           # low-VRAM (e.g. 4 GB): cap gen size
 *
 * It writes public/assets/<slot>.png and updates public/assets/asset_manifest.json
 * (town sprites get a transparent background; backdrops stay opaque). The COMMITTED
 * manifest must stay empty + the PNGs are gitignored — restore with
 * `git checkout -- public/assets/asset_manifest.json` before committing; ship the
 * binaries as a GitHub Release pack. A missing/failed slot is harmless: the game
 * falls back to its procedural art (the AssetRegistry composites overrides on top).
 * ──────────────────────────────────────────────────────────────────────────
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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

const DEFAULT_A1111 = 'http://127.0.0.1:7860';
const DEFAULT_COMFY = 'http://127.0.0.1:8188';

export type BackendKind = 'a1111' | 'comfy';

export interface Opts {
  dryRun: boolean;
  init: boolean;
  slotFilter: Set<string> | null;
  category: string | null;
  era: string | null;
  backend: BackendKind;
  apiUrl: string;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string; // comfy only
  seed: number;
  model: string | null;
  bg: boolean;
  bgTool: 'builtin' | 'rembg';
  bgTol: number;
  maxDim: number; // cap the larger generated side (0 = uncapped); for low-VRAM GPUs
  retries: number;
}

// ── Pure helpers (exported for unit tests; no network, no fs) ────────────────

/** Round up to a 64-multiple (diffusion-friendly), with a floor so town icons —
 *  nominally 256 — generate big enough before the registry rescales them down. */
export function snap64(n: number, floor = 0): number {
  return Math.max(Math.ceil(n / 64) * 64, floor);
}

/** Generation dims for a slot: towns floored to 512, backdrops keep their aspect.
 *  `maxDim` (0 = uncapped) caps the larger side for low-VRAM GPUs — e.g. a 4 GB
 *  card can't render a 1216×704 backdrop, but `--max-dim=768` scales it to
 *  768×448 (aspect preserved, snapped to 64-multiples). Backdrops fill the canvas
 *  on screen regardless of source size, so the detail cost is negligible. */
export function genSize(s: AssetSlotDef, maxDim = 0): { width: number; height: number } {
  const floor = s.category === 'town' ? 512 : 0;
  let width = snap64(s.w, floor);
  let height = snap64(s.h, floor);
  if (maxDim > 0 && Math.max(width, height) > maxDim) {
    const k = maxDim / Math.max(width, height);
    const snapNear = (n: number) => Math.max(64, Math.round((n * k) / 64) * 64);
    width = snapNear(width);
    height = snapNear(height);
  }
  return { width, height };
}

/** AUTOMATIC1111 /sdapi/v1/txt2img request body. */
export function a1111Body(s: AssetSlotDef, opts: Opts): Record<string, unknown> {
  const { width, height } = genSize(s, opts.maxDim);
  const body: Record<string, unknown> = {
    prompt: s.prompt,
    negative_prompt: NEGATIVE,
    width, height,
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
  return body;
}

/** A minimal ComfyUI txt2img workflow graph (API prompt format). `seed` must be a
 *  concrete number for ComfyUI (callers resolve -1 to a random seed first). */
export function comfyGraph(s: AssetSlotDef, opts: Opts, seed: number): Record<string, unknown> {
  const { width, height } = genSize(s, opts.maxDim);
  const ckpt = opts.model ?? 'sd_xl_base_1.0.safetensors';
  const sampler = opts.sampler && /_/.test(opts.sampler) ? opts.sampler : 'dpmpp_2m';
  return {
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckpt } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: s.prompt, clip: ['4', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: NEGATIVE, clip: ['4', 1] } },
    '3': { class_type: 'KSampler', inputs: {
      seed, steps: opts.steps, cfg: opts.cfg, sampler_name: sampler,
      scheduler: opts.scheduler, denoise: 1,
      model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0],
    } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'centuria', images: ['8', 0] } },
  };
}

export interface ComfyImageRef { filename: string; subfolder: string; type: string; }

/** Pull the produced image refs out of a ComfyUI /history/{id} payload. */
export function parseComfyHistory(history: unknown, promptId: string): ComfyImageRef[] {
  const entry = (history as Record<string, { outputs?: Record<string, { images?: ComfyImageRef[] }> }>)?.[promptId];
  if (!entry?.outputs) return [];
  const refs: ComfyImageRef[] = [];
  for (const node of Object.values(entry.outputs)) {
    for (const img of node.images ?? []) refs.push(img);
  }
  return refs;
}

// ── Backends (network) ───────────────────────────────────────────────────────

interface Backend {
  preflight(): Promise<void>;
  listModels(): Promise<string[]>;
  generate(s: AssetSlotDef): Promise<Buffer>;
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

class A1111Backend implements Backend {
  constructor(private opts: Opts) {}
  async preflight(): Promise<void> { await getJson(`${this.opts.apiUrl}/sdapi/v1/options`); }
  async listModels(): Promise<string[]> {
    const m = (await getJson(`${this.opts.apiUrl}/sdapi/v1/sd-models`)) as Array<{ title?: string; model_name?: string }>;
    return m.map((x) => x.title ?? x.model_name ?? '?');
  }
  async generate(s: AssetSlotDef): Promise<Buffer> {
    const res = await fetch(`${this.opts.apiUrl}/sdapi/v1/txt2img`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(a1111Body(s, this.opts)),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { images?: string[] };
    const b64 = json.images?.[0];
    if (!b64) throw new Error('response had no images[]');
    return Buffer.from(b64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
  }
}

class ComfyBackend implements Backend {
  constructor(private opts: Opts) {}
  async preflight(): Promise<void> { await getJson(`${this.opts.apiUrl}/system_stats`); }
  async listModels(): Promise<string[]> {
    const info = (await getJson(`${this.opts.apiUrl}/object_info/CheckpointLoaderSimple`)) as
      Record<string, { input?: { required?: { ckpt_name?: unknown[] } } }>;
    const names = info?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0];
    return Array.isArray(names) ? (names as string[]) : [];
  }
  async generate(s: AssetSlotDef): Promise<Buffer> {
    const seed = this.opts.seed >= 0 ? this.opts.seed : Math.floor(Math.random() * 2 ** 31);
    const graph = comfyGraph(s, this.opts, seed);
    const post = await fetch(`${this.opts.apiUrl}/prompt`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: graph }),
    });
    if (!post.ok) throw new Error(`/prompt HTTP ${post.status} — ${(await post.text()).slice(0, 200)}`);
    const { prompt_id } = (await post.json()) as { prompt_id: string };
    // Poll history until the prompt's outputs appear (or time out ~180s).
    for (let i = 0; i < 180; i++) {
      const hist = await getJson(`${this.opts.apiUrl}/history/${prompt_id}`);
      const refs = parseComfyHistory(hist, prompt_id);
      if (refs.length) {
        const r = refs[0];
        const q = new URLSearchParams({ filename: r.filename, subfolder: r.subfolder, type: r.type });
        const img = await fetch(`${this.opts.apiUrl}/view?${q}`);
        if (!img.ok) throw new Error(`/view HTTP ${img.status}`);
        return Buffer.from(await img.arrayBuffer());
      }
      await new Promise((res) => setTimeout(res, 1000));
    }
    throw new Error('timed out waiting for ComfyUI to render');
  }
}

function makeBackend(opts: Opts): Backend {
  return opts.backend === 'comfy' ? new ComfyBackend(opts) : new A1111Backend(opts);
}

// ── CLI ──────────────────────────────────────────────────────────────────────

export function parseArgs(argv: string[]): Opts {
  const flags = new Set(argv.filter((a) => !a.includes('=')));
  const kv = Object.fromEntries(
    argv.filter((a) => a.includes('=')).map((a) => a.replace(/^--/, '').split('=') as [string, string]),
  );
  const backend: BackendKind = kv.backend === 'comfy' ? 'comfy' : 'a1111';
  return {
    dryRun: flags.has('--dry-run'),
    init: flags.has('--init'),
    slotFilter: kv.slots ? new Set(kv.slots.split(',')) : null,
    category: kv.category ?? null,
    era: kv.era ?? null,
    backend,
    apiUrl: (kv['api-url'] ?? process.env.SD_API_URL ?? (backend === 'comfy' ? DEFAULT_COMFY : DEFAULT_A1111)).replace(/\/$/, ''),
    steps: kv.steps != null ? parseInt(kv.steps, 10) : 28,
    cfg: kv.cfg != null ? parseFloat(kv.cfg) : 7,
    sampler: kv.sampler ?? (backend === 'comfy' ? 'dpmpp_2m' : 'DPM++ 2M Karras'),
    scheduler: kv.scheduler ?? 'karras',
    seed: kv.seed != null ? parseInt(kv.seed, 10) : -1,
    model: kv.model ?? null,
    bg: !flags.has('--no-bg'),
    bgTool: kv['bg-tool'] === 'rembg' ? 'rembg' : 'builtin',
    bgTol: kv['bg-tol'] != null ? parseInt(kv['bg-tol'], 10) : 1600,
    maxDim: kv['max-dim'] != null ? parseInt(kv['max-dim'], 10) : 0,
    retries: kv.retries != null ? parseInt(kv.retries, 10) : 2,
  };
}

export function selectSlots(opts: Opts): AssetSlotDef[] {
  return LIVE_ASSET_CATALOG.filter((s) => {
    if (opts.slotFilter && !opts.slotFilter.has(s.slot)) return false;
    if (opts.category && s.category !== opts.category) return false;
    if (opts.era && s.era !== opts.era) return false;
    return true;
  });
}

function readManifest(): { schemaVersion?: number; items?: GeneratedAssetItem[]; [k: string]: unknown } {
  if (!existsSync(MANIFEST_PATH)) return { schemaVersion: 1, items: [] };
  try { return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')); } catch { return { schemaVersion: 1, items: [] }; }
}

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

async function runInit(backend: Backend, opts: Opts): Promise<void> {
  console.log(`Checking ${opts.backend} backend at ${opts.apiUrl} …`);
  try {
    await backend.preflight();
    console.log('  reachable ✓');
  } catch (e) {
    console.error(`  UNREACHABLE — ${(e as Error).message}`);
    console.error(opts.backend === 'comfy'
      ? '  Start ComfyUI (default port 8188), or pass --api-url=http://HOST:PORT.'
      : '  Start AUTOMATIC1111 with `./webui.sh --api`, or pass --api-url=http://HOST:PORT.');
    process.exit(1);
  }
  try {
    const models = await backend.listModels();
    console.log(`  checkpoints (${models.length}):`);
    for (const m of models) console.log(`    • ${m}`);
    if (opts.backend === 'comfy' && models.length) {
      console.log(`  → run with: npm run gen:local -- --backend=comfy --model=${models[0]}`);
    }
  } catch (e) {
    console.log(`  (could not list checkpoints: ${(e as Error).message})`);
  }
}

export async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const backend = makeBackend(opts);

  if (opts.init) { await runInit(backend, opts); return; }

  const slots = selectSlots(opts);
  if (slots.length === 0) {
    console.error('No matching slots. Available:');
    console.error(' ', LIVE_ASSET_CATALOG.map((s) => s.slot).join(', '));
    process.exit(1);
  }

  console.log('Centuria local AI asset generator');
  console.log(`  backend : ${opts.backend} @ ${opts.apiUrl}${opts.model ? ` (checkpoint ${opts.model})` : ''}`);
  console.log(`  sampler : ${opts.sampler}${opts.backend === 'comfy' ? `/${opts.scheduler}` : ''}  steps ${opts.steps}  cfg ${opts.cfg}  seed ${opts.seed}${opts.maxDim ? `  max-dim ${opts.maxDim}` : ''}`);
  console.log(`  slots   : ${slots.length}`);
  console.log(`  mode    : ${opts.dryRun ? 'dry-run (no server calls)' : 'live'}\n`);

  if (opts.dryRun) {
    for (const s of slots) {
      const { width, height } = genSize(s, opts.maxDim);
      const bg = s.category === 'town' && opts.bg ? ` +bg-cut(${opts.bgTool})` : '';
      console.log(`  ${s.slot.padEnd(16)} [${s.category}] ${width}×${height}${bg}`);
    }
    console.log(`\n${slots.length} slot(s) would be generated → public/assets/, manifest updated.`);
    return;
  }

  await backend.preflight().catch((e: unknown) => {
    console.error(`\nCannot reach the ${opts.backend} server at ${opts.apiUrl} (${(e as Error).message}).`);
    console.error('  Run `npm run gen:local -- --init` to diagnose, or start your local SD server.');
    process.exit(1);
  });

  mkdirSync(ASSETS_DIR, { recursive: true });
  const manifest = readManifest();
  const generated: GeneratedAssetItem[] = [];
  let ok = 0, fail = 0;

  for (const s of slots) {
    process.stdout.write(`  ${s.slot.padEnd(16)} ... `);
    try {
      let buf: Buffer | null = null;
      for (let attempt = 0; attempt <= opts.retries; attempt++) {
        try { buf = await backend.generate(s); break; }
        catch (e) {
          if (attempt === opts.retries) throw e;
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        }
      }
      if (!buf) throw new Error('no image');
      if (s.category === 'town' && opts.bg) { process.stdout.write('cut-bg '); buf = removeBackground(buf, opts); }
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

// Run only when invoked as a script (so tests can import the pure helpers).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e: unknown) => { console.error(e); process.exit(1); });
}
