import { describe, expect, it } from 'vitest';
import { RegionSim, INTERMEDIATE_GOODS, type Settlement } from '../src/sim/region';
import { tickIntermediateGoods } from '../src/sim/systems/goods';

/**
 * PR-3 slice 2 — per-town consume + LOCAL supply level (the intended balance
 * change). Slice 1 solved the goods chain once on the nation aggregate; this
 * resolves the STOCK LEDGER per town: a town makes its sector-weighted share of a
 * good only to the extent it physically holds (or has been shipped) that good's
 * INTERMEDIATE inputs, and it consumes them from its own ledger. Raws still proxy
 * off the (nation-wide) sector, so the macro cascade — `supplyChainHealth`,
 * severity, the output drag, the secondary effects — is unchanged.
 *
 * The load-bearing properties:
 *  - a SINGLE-town nation (and any nation whose goods are co-located with their
 *    inputs) is byte-identical to the old nation-wide produce/draw — every local
 *    gate is 1, so each good still makes its full `baseOutput × level`;
 *  - a CROSS-SECTOR good in a MULTI-town nation diverges: `clothing` /
 *    `consumer_goods` / `luxury_goods` are industry-attributed yet need agri
 *    `textiles`, so a pure-industry town that holds no textiles makes none of them
 *    — until textiles are shipped in;
 *  - the divergence is confined to the ledger: the macro signals never move.
 *
 * These run `tickIntermediateGoods` in isolation on a hand-built fixture (the same
 * pattern as supply-shock.test.ts), with fully-controlled town outputs and an
 * unwarmed sector norm so every raw flows at level 1 — leaving the per-town input
 * gate as the only thing that can reduce production.
 */

/** Build a sim with exactly `layout.length` player towns and nothing else (no
 *  ticking → no AI-founded towns to contaminate the ledger or the raw proxy).
 *  Each town's industry/agriculture output is pinned; the sector norm is left
 *  unwarmed (0) so it re-seeds to the current total on the tick's first
 *  `advanceSectorOutputNorms`, giving an output/norm ratio of exactly 1 → every
 *  raw flows at full level, so only the LOCAL input gate can dent production. */
function townsSim(layout: Array<{ ind: number; agri: number }>, year = 2000): RegionSim {
  const r = RegionSim.create(7);
  const base = r.settlements[0];
  while (r.settlements.length < layout.length) {
    const clone = structuredClone(base) as Settlement;
    clone.id = base.id + r.settlements.length;
    clone.name = `Town ${r.settlements.length}`;
    r.settlements.push(clone);
  }
  layout.forEach((l, i) => {
    const s = r.settlements[i];
    s.sectors.industry.output = l.ind;
    s.sectors.agriculture.output = l.agri;
    s.goodStocks = undefined; // start from an empty ledger
  });
  r.sectorOutputNorm = { industry: 0, agriculture: 0 };
  Object.defineProperty(r, 'year', { get: () => year, configurable: true });
  return r;
}

/** A good's full monthly output (units made when fully supplied) — the value a
 *  town produces when the gate is 1, so the tests read off the catalog rather
 *  than hard-coding magnitudes that would drift if a recipe is retuned. */
function baseOutput(id: string): number {
  const g = INTERMEDIATE_GOODS.find((x) => x.id === id);
  if (!g) throw new Error(`no such good: ${id}`);
  return g.baseOutput;
}

// Goods that are industry-attributed yet depend on agricultural `textiles` — the
// cross-sector finals where the per-town divergence shows. (All three are terminal
// — nothing downstream draws them — so a fully-supplied town banks exactly
// `baseOutput` and the assertions stay clean.)
const TEXTILE_FINALS = ['clothing', 'consumer_goods', 'luxury_goods'];

describe('PR-3 slice 2 — per-town supply solve', () => {
  // --- single town: the gate never bites (byte-identical to the old aggregate) ---
  it('a single all-rounder town makes every good at its full baseOutput (gate is always 1)', () => {
    const r = townsSim([{ ind: 100, agri: 100 }]);
    tickIntermediateGoods(r);
    // The lone town produces every input it consumes, so each terminal good banks
    // exactly its baseOutput — the same total the old nation-wide pool produced.
    for (const id of TEXTILE_FINALS) {
      expect(r.goodStock(id), id).toBeCloseTo(baseOutput(id), 6);
    }
    // …and no shock: the macro cascade is intact (raws flowing).
    expect(r.supplyChainHealth).toBe(1);
    expect(r.supplyShockSeverity()).toBe(0);
  });

  // --- multi-town divergence: a cross-sector good strands its input ---
  it('a cross-sector good is NOT made in a town that lacks its (agri) input', () => {
    // Town A: pure industry. Town B: pure agriculture. Textiles (agri) bank in B;
    // the textile-finals (industry) can only be attempted in A, which holds none.
    const r = townsSim([
      { ind: 100, agri: 0 },
      { ind: 0, agri: 100 },
    ]);
    tickIntermediateGoods(r);

    for (const id of TEXTILE_FINALS) {
      expect(r.goodStock(id), id).toBe(0); // industry town has no textiles → makes none
    }
    // The textiles WERE produced — they're just stranded in the agri town, unused,
    // because the consumers sit in the industry town and can't reach them.
    expect(r.goodStock('textiles')).toBeCloseTo(baseOutput('textiles'), 6);
    expect(r.settlements[1].goodStocks?.textiles ?? 0).toBeCloseTo(baseOutput('textiles'), 6);
    expect(r.settlements[0].goodStocks?.textiles ?? 0).toBe(0);

    // A co-located industry good (tools ← steel, both industry) is unaffected.
    expect(r.goodStock('tools')).toBeCloseTo(baseOutput('tools'), 6);

    // Crucially the MACRO cascade is untouched — the divergence lives only in the
    // ledger. Raws flow, so health is full and there is no fabricated shock.
    expect(r.supplyChainHealth).toBe(1);
    expect(r.supplyShockSeverity()).toBe(0);
  });

  it('shipping the input into the deprived town restores its production', () => {
    const r = townsSim([
      { ind: 100, agri: 0 },
      { ind: 0, agri: 100 },
    ]);
    // Simulate cargo that has arrived in the industry town's warehouse.
    (r.settlements[0].goodStocks ??= {})['textiles'] = 50;
    tickIntermediateGoods(r);
    // With textiles now in local stock, the industry town makes the finals again.
    for (const id of TEXTILE_FINALS) {
      expect(r.goodStock(id), id).toBeGreaterThan(0);
    }
    expect(r.goodStock('consumer_goods')).toBeCloseTo(baseOutput('consumer_goods'), 6);
  });

  it('mixed towns (each self-sufficient) do NOT diverge — divergence needs specialization', () => {
    // Two all-rounder towns: each makes its own textiles, so each can make its
    // share of the cross-sector finals. The nation total is the full baseOutput.
    const r = townsSim([
      { ind: 50, agri: 50 },
      { ind: 50, agri: 50 },
    ]);
    tickIntermediateGoods(r);
    expect(r.goodStock('consumer_goods')).toBeCloseTo(baseOutput('consumer_goods'), 6);
    expect(r.goodStock('tools')).toBeCloseTo(baseOutput('tools'), 6);
    expect(r.supplyChainHealth).toBe(1);
  });

  // --- invariants: bounded, deterministic ---
  it('never drives any stock negative, even with a town gated to zero', () => {
    const r = townsSim([
      { ind: 100, agri: 0 },
      { ind: 0, agri: 100 },
    ]);
    for (let i = 0; i < 5; i++) tickIntermediateGoods(r);
    for (const s of r.settlements) {
      for (const [id, qty] of Object.entries(s.goodStocks ?? {})) {
        expect(qty, `${s.name}/${id}`).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(qty), `${s.name}/${id} finite`).toBe(true);
      }
    }
  });

  it('INTERMEDIATE_GOODS is topologically ordered (the invariant single-town parity rests on)', () => {
    // The per-town loop processes goods in catalog order and relies on a good's
    // intermediate inputs being PRODUCED (into local stock) earlier in the same
    // tick, so a single town's gate is always 1 even at an unlock boundary
    // (clothing+textiles both 1920, machinery+components both 1930). A reorder that
    // placed a consumer before its input would silently break that parity — guard it.
    const idx = new Map(INTERMEDIATE_GOODS.map((g, i) => [g.id, i]));
    for (const g of INTERMEDIATE_GOODS) {
      for (const input of g.inputs) {
        if (idx.has(input)) {
          expect(idx.get(input)!, `${input} must precede ${g.id}`).toBeLessThan(idx.get(g.id)!);
        }
      }
    }
  });

  it('each input is made fast enough to feed its consumers in one tick (the other parity invariant)', () => {
    // Single-town parity also needs every consumer of an input to find that input
    // still in stock when its turn comes — even on the FIRST tick, before any
    // buffer accumulates. On that tick an input i holds `baseOutput(i) × level` and
    // each of its consumers draws `level`, so the last consumer keeps a full gate
    // iff `baseOutput(i) ≥ (#consumers of i)`. (In steady state stocks grow
    // unbounded, so this only bites at unlock; guard it against a recipe retune.)
    const consumerCount = new Map<string, number>();
    for (const g of INTERMEDIATE_GOODS) {
      for (const input of g.inputs) {
        consumerCount.set(input, (consumerCount.get(input) ?? 0) + 1);
      }
    }
    for (const g of INTERMEDIATE_GOODS) {
      const consumers = consumerCount.get(g.id) ?? 0;
      expect(g.baseOutput, `${g.id} feeds ${consumers} consumers`).toBeGreaterThanOrEqual(consumers);
    }
  });

  it('is deterministic — two identical fixtures tick to identical per-town ledgers', () => {
    const build = () =>
      townsSim([
        { ind: 80, agri: 20 },
        { ind: 20, agri: 80 },
      ]);
    const a = build();
    const b = build();
    for (let i = 0; i < 3; i++) {
      tickIntermediateGoods(a);
      tickIntermediateGoods(b);
    }
    const ledger = (r: RegionSim) => r.settlements.map((s) => s.goodStocks ?? {});
    expect(ledger(a)).toEqual(ledger(b));
  });
});
