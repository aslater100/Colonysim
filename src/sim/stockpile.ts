/**
 * Flat typed-array resource store for the scale engine.
 *
 * Backed by a Float32Array indexed by RESOURCE_KINDS order — allocation-free
 * reads, zero per-tick GC, and transferable to a Web Worker via SharedArrayBuffer
 * when Phase 7 lands. API mirrors the live Simulation's `stock` Record but the
 * internals are SoA rather than a plain object.
 *
 * Run the self-check:  npx tsx src/sim/stockpile.ts
 */
import type { ResourceKind } from './defs';
import { RESOURCE_KINDS } from './defs';

const _idx: Readonly<Record<ResourceKind, number>> = Object.fromEntries(
  RESOURCE_KINDS.map((k, i) => [k, i]),
) as Record<ResourceKind, number>;

export class Stockpile {
  readonly buf: Float32Array;

  constructor() {
    this.buf = new Float32Array(RESOURCE_KINDS.length);
  }

  count(kind: ResourceKind): number {
    return this.buf[_idx[kind]] ?? 0;
  }

  add(kind: ResourceKind, qty: number): void {
    this.buf[_idx[kind]] += qty;
  }

  /** Deduct `qty`; returns false (no change) if stock is insufficient. */
  remove(kind: ResourceKind, qty: number): boolean {
    const i = _idx[kind];
    if (this.buf[i] < qty) return false;
    this.buf[i] -= qty;
    return true;
  }

  /**
   * Atomically deduct all `inputs`. Returns false without any change if any
   * resource is insufficient — partial consumption never happens.
   */
  removeAll(inputs: Partial<Record<ResourceKind, number>>): boolean {
    for (const [k, q] of Object.entries(inputs)) {
      if (this.buf[_idx[k as ResourceKind]] < (q as number)) return false;
    }
    for (const [k, q] of Object.entries(inputs)) {
      this.buf[_idx[k as ResourceKind]] -= (q as number);
    }
    return true;
  }

  /** Non-zero resource quantities as a plain snapshot (not a live view). */
  snapshot(): Partial<Record<ResourceKind, number>> {
    const out: Partial<Record<ResourceKind, number>> = {};
    for (let i = 0; i < RESOURCE_KINDS.length; i++) {
      if (this.buf[i] > 0) out[RESOURCE_KINDS[i]] = this.buf[i];
    }
    return out;
  }

  /** JSON-friendly round-trip: the snapshot is already a stable, sparse map. */
  serialize(): Partial<Record<ResourceKind, number>> {
    return this.snapshot();
  }

  static deserialize(data: Partial<Record<ResourceKind, number>>): Stockpile {
    const s = new Stockpile();
    for (const [k, q] of Object.entries(data ?? {})) {
      const i = _idx[k as ResourceKind];
      if (i !== undefined) s.buf[i] = q as number;
    }
    return s;
  }
}

// --- self-check: npx tsx src/sim/stockpile.ts ---
if (process.argv[1]?.endsWith('/stockpile.ts')) {
  const s = new Stockpile();
  s.add('grain', 10);
  console.assert(s.count('grain') === 10, 'add grain');
  console.assert(s.remove('grain', 5), 'remove 5');
  console.assert(s.count('grain') === 5, 'five remaining');
  console.assert(!s.remove('grain', 10), 'insufficient remove returns false');
  console.assert(s.count('grain') === 5, 'stock unchanged after failed remove');

  const s2 = new Stockpile();
  s2.add('grain', 3); s2.add('iron_ore', 2);
  console.assert(s2.removeAll({ grain: 3, iron_ore: 2 }), 'atomic remove succeeds');
  console.assert(s2.count('grain') === 0 && s2.count('iron_ore') === 0, 'both zero');

  const s3 = new Stockpile();
  s3.add('grain', 3);
  console.assert(!s3.removeAll({ grain: 3, iron_ore: 2 }), 'partial inputs: returns false');
  console.assert(s3.count('grain') === 3, 'grain untouched on failed removeAll');

  const snap = (() => { const t = new Stockpile(); t.add('wood', 7); return t.snapshot(); })();
  console.assert(snap.wood === 7 && !('grain' in snap), 'snapshot is sparse');

  console.log('stockpile.ts self-check OK');
}
