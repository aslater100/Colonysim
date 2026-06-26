# Hugging Face MCP + sprite generation

Centuria's terrain, creature, and item art is procedural (`src/ui/sprites.ts`),
but any slot can be replaced by a PNG override loaded from `public/sprites/`
(see `src/ui/spriteOverrides.ts`). The override PNGs are produced by
`scripts/hf-sprites.ts`, which calls the Hugging Face **Inference Providers**
API. This doc covers both halves: discovering models with the MCP server, and
generating sprites with the script.

## 1. The Hugging Face MCP server

The repo ships a project-scoped MCP config at [`.mcp.json`](../../.mcp.json)
that wires up the [Hugging Face MCP server](https://huggingface.co/docs/hub/agents-mcp)
over StreamableHTTP:

```json
{
  "mcpServers": {
    "huggingface": {
      "type": "http",
      "url": "https://huggingface.co/mcp",
      "headers": { "Authorization": "Bearer ${HF_TOKEN}" }
    }
  }
}
```

Any Claude Code session opened in this repo picks it up automatically (approve
it once when prompted). `${HF_TOKEN}` is read from the environment, so export a
token before launching:

```bash
export HF_TOKEN=hf_...   # needs the "Inference Providers" permission
```

Create a scoped token here:
<https://huggingface.co/settings/tokens/new?ownUserPermissions=inference.serverless.write&tokenType=fineGrained>

To connect other clients (Cursor, VS Code, Zed, Claude Desktop), use the
generated snippets at <https://huggingface.co/settings/mcp>.

### What the MCP server is for

Use it to **discover and verify** models *before* hard-coding a new
`--model` / `--provider` into the generator — the generator itself is a plain
standalone script and does not call MCP at runtime. Handy tool calls:

- `hub_repo_search` / `hub_repo_details` — find text-to-image models and see
  **which providers serve them** (the `Inference Providers` section). A model
  with one flaky provider is a bad default; prefer one served by several.
- `hf_doc_search` / `hf_doc_fetch` — confirm the current API shape (the legacy
  `api-inference.huggingface.co` endpoint was removed in favour of the
  `router.huggingface.co` provider router).
- `model_search` with `pipeline_tag=text-to-image` — browse pixel-art LoRAs.

Example finding that shaped the current defaults: `nerijs/pixel-art-xl` is a
nice SDXL pixel LoRA but is served by **only** `fal-ai`, whereas
`black-forest-labs/FLUX.1-schnell` is served by six providers — so schnell is a
far more reliable default endpoint.

## 2. Generating sprites

```bash
# Preview prompts without hitting the API
npx tsx scripts/hf-sprites.ts --dry-run
npx tsx scripts/hf-sprites.ts --dry-run --slots=tree,grass-0

# Generate (default model FLUX.1-schnell via hf-inference)
HF_TOKEN=hf_... npx tsx scripts/hf-sprites.ts --slots=tree,rock,items-wood

# Use an SDXL pixel-art LoRA through fal-ai (needs guidance + more steps)
HF_TOKEN=hf_... npx tsx scripts/hf-sprites.ts \
  --model=nerijs/pixel-art-xl --provider=fal-ai --steps=25 --guidance=7
```

Generated PNGs land in `public/sprites/<slot>.png` and the script appends each
slot name to `public/sprites/index.json` so the loader knows to overlay it. Slot
names mirror the `SpriteSet` shape — run the script with `--dry-run` (no filter)
or open `sprites-preview.html` for the full catalog with dimensions.

### Flags

| Flag | Default | Notes |
|------|---------|-------|
| `--dry-run` | off | Print requests, call nothing. |
| `--slots=a,b,c` | all | Subset of slot names. |
| `--model=<id>` | `black-forest-labs/FLUX.1-schnell` | Any text-to-image model. |
| `--provider=<id>` | `hf-inference` | `hf-inference`, `fal-ai`, `replicate`, `together`, `nscale`, … |
| `--steps=N` | `4` | Denoising steps; raise for non-distilled models. |
| `--guidance=N` | omitted | Sends `guidance_scale` + `negative_prompt`. Skip for schnell/turbo (they ignore it). |
| `--retries=N` | `4` | Backoff retries on 503 (cold start) / 429 (rate limit). |

The script handles both raw-image-byte responses (hf-inference) and JSON
responses that wrap a base64 blob or URL (some other providers), so switching
`--provider` generally just works.
