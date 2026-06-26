/**
 * AudioRegistry — the manifest-driven *audio*-override seam, the exact sibling of
 * AssetRegistry (the art seam, src/ui/assets/registry.ts). Where the game's whole
 * soundtrack is procedural WebAudio today (music.ts, soundscape.ts), this loads
 * recorded stems listed in `public/audio/audio_manifest.json`, decodes them on a
 * live AudioContext, and serves them by slot name — returning null when a stem is
 * absent so the synth keeps playing. The game always sounds correct: with real
 * stems layered on, or entirely without them (the shipped default).
 *
 * This is the audio half of the GDD §3.1 atmosphere budget: the ~1 GB of music /
 * ambience the procedural engine can only gesture at slots in here, per era, with
 * zero changes to the engines that consume it — the same discipline as town
 * sprites and the parallax backdrop.
 *
 * Manifest (all item fields optional except `slot`):
 *   { "schemaVersion": 1,
 *     "items": [ { "slot": "music-future", "file": "music-future.ogg", "era": "future" } ] }
 * Absent or empty `items` → pure procedural, no per-stem fetches (opt-in).
 *
 * DOM/WebAudio-only: `fetch`/`decodeAudioData`/`import.meta.env` are touched only
 * inside `load()`, so the module imports safely in Node (vitest) for the pure
 * slot helpers below.
 */

import { eraForYear } from '../music';

/** Music stem slot for a year — mirrors the music engine's era ids, so the
 *  recorded bed and the procedural soundtrack turn over on the same windows. */
export function musicStemSlot(year: number): string {
  return `music-${eraForYear(year).id}`;
}

/** Ambience-bed slot for a year — same era windows as the music stems. */
export function ambienceStemSlot(year: number): string {
  return `ambience-${eraForYear(year).id}`;
}

export type AudioCategory = 'music' | 'ambience';
export interface AudioItem {
  slot: string;
  file?: string;
  era?: string;
  category?: AudioCategory;
}
export interface AudioManifest {
  schemaVersion?: number;
  items?: AudioItem[];
}

export class AudioRegistry {
  private buffers = new Map<string, AudioBuffer>();
  private loaded = false;

  /** Fetch the manifest and decode every listed stem on `ctx`. Never throws;
   *  idempotent. Buffers are bound to the context they are decoded on, so a
   *  registry is loaded once per AudioContext (music and soundscape each own
   *  their own instance). */
  async load(ctx: BaseAudioContext, dir = 'audio'): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const base = import.meta.env.BASE_URL;
      const res = await fetch(`${base}${dir}/audio_manifest.json`);
      if (!res.ok) return;
      const manifest = (await res.json()) as AudioManifest;
      const items = manifest.items;
      if (!Array.isArray(items) || items.length === 0) return;
      for (const it of items) {
        if (!it || !it.slot) continue;
        const file = it.file ?? `${it.slot}.ogg`;
        // Fire each fetch/decode independently; one bad stem never blocks the
        // rest, and any failure simply leaves that slot procedural.
        void this.fetchDecode(ctx, it.slot, `${base}${dir}/${file}`);
      }
    } catch {
      /* audio is optional — any failure leaves the procedural soundtrack in place */
    }
  }

  private async fetchDecode(ctx: BaseAudioContext, slot: string, url: string): Promise<void> {
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const arr = await res.arrayBuffer();
      const buf = await ctx.decodeAudioData(arr);
      this.buffers.set(slot, buf); // becomes audible at the next era/stem check
    } catch {
      /* leave this slot procedural */
    }
  }

  /** The decoded buffer for a slot, or null → the caller plays procedurally. */
  get(slot: string): AudioBuffer | null {
    return this.buffers.get(slot) ?? null;
  }

  has(slot: string): boolean {
    return this.buffers.has(slot);
  }
}
