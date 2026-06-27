import { describe, expect, it } from 'vitest';
import {
  parseArgs, selectSlots, genSize, snap64, a1111Body, comfyGraph, parseComfyHistory,
  type Opts,
} from '../scripts/gen-local';
import { LIVE_ASSET_CATALOG, NEGATIVE } from '../src/data/assetCatalog';

const town = LIVE_ASSET_CATALOG.find((s) => s.slot === 'town-castle')!;
const back = LIVE_ASSET_CATALOG.find((s) => s.slot === 'backdrop-dawn')!;

describe('gen-local arg parsing & selection', () => {
  it('defaults to the a1111 backend on 127.0.0.1:7860', () => {
    const o = parseArgs([]);
    expect(o.backend).toBe('a1111');
    expect(o.apiUrl).toBe('http://127.0.0.1:7860');
    expect(o.bg).toBe(true);
  });

  it('switches to comfy (port 8188, comfy sampler) on --backend=comfy', () => {
    const o = parseArgs(['--backend=comfy']);
    expect(o.backend).toBe('comfy');
    expect(o.apiUrl).toBe('http://127.0.0.1:8188');
    expect(o.sampler).toBe('dpmpp_2m');
  });

  it('honours --api-url, --slots, --no-bg, --bg-tool, --steps', () => {
    const o = parseArgs(['--api-url=http://x:1/', '--slots=town-shack,backdrop-dawn', '--no-bg', '--bg-tool=rembg', '--steps=12']);
    expect(o.apiUrl).toBe('http://x:1'); // trailing slash trimmed
    expect([...o.slotFilter!]).toEqual(['town-shack', 'backdrop-dawn']);
    expect(o.bg).toBe(false);
    expect(o.bgTool).toBe('rembg');
    expect(o.steps).toBe(12);
  });

  it('selectSlots filters by slot / category / era', () => {
    expect(selectSlots(parseArgs([])).length).toBe(11);
    expect(selectSlots(parseArgs(['--category=backdrop'])).length).toBe(5);
    expect(selectSlots(parseArgs(['--category=town'])).every((s) => s.category === 'town')).toBe(true);
    expect(selectSlots(parseArgs(['--era=dawn'])).map((s) => s.slot)).toEqual(['backdrop-dawn']);
  });
});

describe('gen-local sizing', () => {
  it('floors town gen to 512 and snaps to 64-multiples; keeps backdrop aspect', () => {
    expect(snap64(256, 512)).toBe(512);
    expect(snap64(1216)).toBe(1216);
    expect(genSize(town)).toEqual({ width: 512, height: 512 });
    expect(genSize(back)).toEqual({ width: 1216, height: 704 });
  });

  it('--max-dim caps the larger side, preserves aspect, snaps to 64 (low-VRAM)', () => {
    // backdrop 1216×704 capped to 768 → 768×448 (≈ same 1.72 aspect, 64-multiples)
    const b = genSize(back, 768);
    expect(b.width).toBe(768);
    expect(b.height).toBe(448);
    expect(Math.max(b.width, b.height)).toBeLessThanOrEqual(768);
    // town 512² is already within 768 → unchanged
    expect(genSize(town, 768)).toEqual({ width: 512, height: 512 });
    // a tighter cap also shrinks the town
    expect(genSize(town, 384)).toEqual({ width: 384, height: 384 });
  });

  it('parses --max-dim (default 0 = uncapped)', () => {
    expect(parseArgs([]).maxDim).toBe(0);
    expect(parseArgs(['--max-dim=768']).maxDim).toBe(768);
  });

  it('the a1111 body and comfy graph honour --max-dim', () => {
    const o = parseArgs(['--max-dim=768']);
    expect(a1111Body(back, o)).toMatchObject({ width: 768, height: 448 });
    const g = comfyGraph(back, parseArgs(['--backend=comfy', '--max-dim=768']), 1) as Record<string, { inputs: Record<string, unknown> }>;
    expect(g['5'].inputs).toMatchObject({ width: 768, height: 448 });
  });
});

describe('a1111 request body', () => {
  it('carries the slot prompt, the shared negative, sizes and sampler', () => {
    const body = a1111Body(town, parseArgs(['--steps=20', '--cfg=6.5']));
    expect(body.prompt).toBe(town.prompt);
    expect(body.negative_prompt).toBe(NEGATIVE);
    expect(body.width).toBe(512);
    expect(body.steps).toBe(20);
    expect(body.cfg_scale).toBe(6.5);
    expect(body.override_settings).toBeUndefined(); // no --model
  });

  it('adds an override checkpoint when --model is given', () => {
    const body = a1111Body(back, parseArgs(['--model=foo.safetensors']));
    expect(body.override_settings).toEqual({ sd_model_checkpoint: 'foo.safetensors' });
  });
});

describe('comfy workflow graph', () => {
  it('builds a wired txt2img graph with the resolved seed and inputs', () => {
    const g = comfyGraph(back, parseArgs(['--backend=comfy', '--model=sdxl.safetensors', '--steps=25']), 42) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;
    expect(g['4'].inputs.ckpt_name).toBe('sdxl.safetensors');
    expect(g['6'].inputs.text).toBe(back.prompt);
    expect(g['7'].inputs.text).toBe(NEGATIVE);
    expect(g['5'].inputs).toMatchObject({ width: 1216, height: 704 });
    expect(g['3'].inputs).toMatchObject({ seed: 42, steps: 25, sampler_name: 'dpmpp_2m', scheduler: 'karras' });
    // node graph is correctly cross-referenced
    expect(g['3'].inputs.latent_image).toEqual(['5', 0]);
    expect(g['8'].inputs.samples).toEqual(['3', 0]);
    expect(g['9'].class_type).toBe('SaveImage');
  });

  it('falls back to a default checkpoint when --model is absent', () => {
    const g = comfyGraph(town, parseArgs(['--backend=comfy']), 1) as Record<string, { inputs: Record<string, unknown> }>;
    expect(typeof g['4'].inputs.ckpt_name).toBe('string');
    expect((g['4'].inputs.ckpt_name as string).length).toBeGreaterThan(0);
  });
});

describe('comfy history parsing', () => {
  it('extracts image refs from a SaveImage output node', () => {
    const hist = { abc: { outputs: { '9': { images: [{ filename: 'centuria_001.png', subfolder: '', type: 'output' }] } } } };
    expect(parseComfyHistory(hist, 'abc')).toEqual([{ filename: 'centuria_001.png', subfolder: '', type: 'output' }]);
  });

  it('returns [] for a pending / unknown prompt id', () => {
    expect(parseComfyHistory({}, 'abc')).toEqual([]);
    expect(parseComfyHistory({ abc: {} }, 'abc')).toEqual([]);
  });
});

// Type-only touch so unused-import lint stays quiet across configs.
const _typecheck: Opts = parseArgs([]);
void _typecheck;
