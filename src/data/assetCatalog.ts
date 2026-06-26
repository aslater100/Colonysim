/**
 * Asset catalog — the prompt manifest for the **live 4X** override slots, the
 * generation-side companion to `src/ui/assets/registry.ts` (`AssetRegistry`,
 * which consumes `public/assets/asset_manifest.json` at runtime with procedural
 * fallback).
 *
 * The legacy `scripts/hf-sprites.ts` catalog targets the *dropped* town engine's
 * `public/sprites/` slots — it never produced art for the slots the shipping
 * RegionView actually overrides (`town-<tier>`, `backdrop-<era>`). This module
 * is that missing catalog, plus the pure manifest-merge used by the generator
 * (`scripts/hf-assets.ts`). Kept under `src/` (not `scripts/`) so it is
 * type-checked by the build and unit-tested in Node — no network, no fs.
 *
 * Image-only: HF returns PNG/WebP bytes the registry loads directly, so no
 * encoder is needed for sprites/backdrops. Audio stems (`audioRegistry.ts`) do
 * need an OGG encoder and stay out of this catalog.
 */

/** Town-tier slots, mirroring `townSpriteTier` / `TOWN_TIER_PX` in registry.ts. */
export const TOWN_TIERS = ['shack', 'cottage', 'house', 'town', 'manor', 'castle'] as const;
/** Backdrop-era slots, mirroring `eraIdForYear` in backdrop.ts. */
export const BACKDROP_ERAS = ['dawn', 'modern', 'analog', 'digital', 'future'] as const;

export type AssetCategory = 'town' | 'backdrop';

export interface AssetSlotDef {
  /** Registry slot name, e.g. `town-castle` or `backdrop-dawn`. */
  slot: string;
  category: AssetCategory;
  /** Era id for backdrop slots (drives streaming/packs later); absent for town. */
  era?: string;
  /** Nominal on-map size hint (px); the registry scales freely, so it is only a
   *  generation aspect-ratio hint, not a hard constraint. */
  w: number;
  h: number;
  prompt: string;
}

/** A manifest item as written by the generator. The runtime registry reads only
 *  `slot`/`file`; `category`/`era`/`sha256` are pipeline metadata it ignores. */
export interface GeneratedAssetItem {
  slot: string;
  file: string;
  category: AssetCategory;
  era?: string;
  sha256: string;
}

// Shared style tails. Town icons sit on the map (transparent), backdrops fill
// the void behind it (opaque, no foreground — the terrain cache covers that).
const TOWN_SUFFIX =
  'top-down view, centered, transparent background, soft warm sunlight from upper-left, ' +
  'painterly game asset, crisp silhouette, no text, no UI, no border';
const BACKDROP_SUFFIX =
  'wide atmospheric sky matte painting, no foreground, no buildings, no people, no text, ' +
  'soft diffuse light, gallery-quality, gentle gradient from horizon to zenith';
export const NEGATIVE =
  'realistic photo, 3d render, blurry, watermark, signature, text, ui, frame, harsh contrast';

const TOWN_PROMPT: Record<(typeof TOWN_TIERS)[number], string> = {
  shack: `a tiny frontier settlement of two or three rough timber shacks and a campfire, sparse dirt clearing, ${TOWN_SUFFIX}`,
  cottage: `a small hamlet of a few thatched-roof cottages and a vegetable plot, dirt paths, ${TOWN_SUFFIX}`,
  house: `a modest village of timber-and-plaster houses around a well, low fences, ${TOWN_SUFFIX}`,
  town: `a busy market town of tiled-roof houses, a central square and a stone chapel, cobbled streets, ${TOWN_SUFFIX}`,
  manor: `a prosperous town with a walled manor house, terracotta roofs, gardens and outbuildings, ${TOWN_SUFFIX}`,
  castle: `a great fortified city with a central castle keep, ringed stone walls and towers, dense rooftops, ${TOWN_SUFFIX}`,
};

const BACKDROP_PROMPT: Record<(typeof BACKDROP_ERAS)[number], string> = {
  // Palettes echo ERA_SKY in backdrop.ts so generated art and the procedural
  // fallback read as the same era.
  dawn: `early 1900s frontier dawn sky, warm sepia and dusty-gold horizon rising to soft slate-blue zenith, hazy low hills silhouette, high cirrus, ${BACKDROP_SUFFIX}`,
  modern: `optimistic mid-century clear blue sky, bright pale horizon, a few clean cumulus clouds, crisp open air, ${BACKDROP_SUFFIX}`,
  analog: `1970s-1990s hazier sky, warm smog-tinted amber horizon under a muted blue zenith, soft industrial haze, ${BACKDROP_SUFFIX}`,
  digital: `turn-of-millennium cooler sky, denser blue-grey haze, flat overcast light with a thin bright horizon band, ${BACKDROP_SUFFIX}`,
  future: `near-future neutral sky, clean teal-grey gradient horizon to deep zenith, faint high-altitude contrails, calm speculative atmosphere, ${BACKDROP_SUFFIX}`,
};

/** The full catalog of live override slots the generator can target. */
export const LIVE_ASSET_CATALOG: AssetSlotDef[] = [
  ...TOWN_TIERS.map((tier): AssetSlotDef => ({
    slot: `town-${tier}`,
    category: 'town',
    w: 256,
    h: 256,
    prompt: TOWN_PROMPT[tier],
  })),
  ...BACKDROP_ERAS.map((era): AssetSlotDef => ({
    slot: `backdrop-${era}`,
    category: 'backdrop',
    era,
    w: 1216,
    h: 704,
    prompt: BACKDROP_PROMPT[era],
  })),
];

/**
 * Merge freshly-generated items into the existing manifest list: an incoming
 * item replaces any existing one with the same slot (re-generation), all other
 * existing items are preserved, and the result is sorted by slot for a stable,
 * diff-friendly manifest. Pure — no fs, no clock.
 */
export function mergeManifestItems(
  existing: readonly GeneratedAssetItem[],
  incoming: readonly GeneratedAssetItem[],
): GeneratedAssetItem[] {
  const bySlot = new Map<string, GeneratedAssetItem>();
  for (const it of existing) bySlot.set(it.slot, it);
  for (const it of incoming) bySlot.set(it.slot, it); // incoming wins
  return [...bySlot.values()].sort((a, b) => a.slot.localeCompare(b.slot));
}
