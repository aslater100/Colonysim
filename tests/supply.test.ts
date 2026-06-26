/**
 * Supply-chain cascade solver (GDD §5.2, roadmap "D1-econ").
 *
 * Covers the pure `resolveSupplyChain` / `rawMaterialsOf` solver and its
 * integration through `RegionSim.tickIntermediateGoods` — in particular the
 * cascade the previous inline logic could not express: a downstream good must
 * fail when its *upstream* is cut, even if it still holds buffer stock of that
 * upstream.
 */
import { describe, expect, it } from 'vitest';
import { resolveSupplyChain, rawMaterialsOf, type SupplyGood } from '../src/sim/supply';
import { RegionSim, INTERMEDIATE_GOODS } from '../src/sim/region';

/** A predicate that reports the given raw ids as available, all others not. */
const rawsAvailable = (...available: string[]) => (id: string) => available.includes(id);
/** Every raw material of the shipping catalog. */
const ALL_RAWS = rawMaterialsOf(INTERMEDIATE_GOODS);

// ============================================================
// 1. rawMaterialsOf — graph shape
// ============================================================
describe('rawMaterialsOf()', () => {
  it('identifies coal, iron and copper as the shipping catalog raws', () => {
    expect(ALL_RAWS).toEqual(['coal', 'iron', 'copper']);
  });

  it('excludes every id that some good produces', () => {
    const produced = new Set(INTERMEDIATE_GOODS.map((g) => g.id));
    for (const raw of ALL_RAWS) expect(produced.has(raw)).toBe(false);
  });

  it('is de-duplicated and order-stable (first appearance wins)', () => {
    const goods: SupplyGood[] = [
      { id: 'a', eraUnlock: 0, inputs: ['ore', 'flux'], baseOutput: 1 },
      { id: 'b', eraUnlock: 0, inputs: ['flux', 'ore', 'a'], baseOutput: 1 },
    ];
    expect(rawMaterialsOf(goods)).toEqual(['ore', 'flux']);
  });
});

// ============================================================
// 2. resolveSupplyChain — era gating
// ============================================================
describe('resolveSupplyChain() era gating', () => {
  it('reports full health and empty sets when nothing is unlocked', () => {
    const r = resolveSupplyChain(INTERMEDIATE_GOODS, 1900, () => true);
    expect(r.active).toEqual([]);
    expect(r.health).toBe(1);
    expect(r.disrupted.size).toBe(0);
    expect(r.supplied.size).toBe(0);
  });

  it('disrupts a good whose upstream good is not yet unlocked', () => {
    // 1925: chemicals (1920) and vehicles (1925) are live; components (1930) is
    // not — so vehicles, which needs components, cannot be made yet.
    const r = resolveSupplyChain(INTERMEDIATE_GOODS, 1925, () => true);
    expect(r.active).toEqual(['chemicals', 'vehicles']);
    expect(r.supplied.has('chemicals')).toBe(true);
    expect(r.disrupted.has('vehicles')).toBe(true);
    expect(r.health).toBeCloseTo(0.5, 10);
  });

  it('supplies the whole pre-electronics chain by 1940 when raws flow', () => {
    const r = resolveSupplyChain(INTERMEDIATE_GOODS, 1940, () => true);
    expect(r.active).not.toContain('electronics'); // unlocks 1950
    expect(r.disrupted.size).toBe(0);
    expect(r.health).toBe(1);
  });
});

// ============================================================
// 3. resolveSupplyChain — cascade propagation (the core behavior)
// ============================================================
describe('resolveSupplyChain() cascade', () => {
  it('supplies the entire chain when every raw is available', () => {
    const r = resolveSupplyChain(INTERMEDIATE_GOODS, 2000, rawsAvailable(...ALL_RAWS));
    expect(r.health).toBe(1);
    expect(r.disrupted.size).toBe(0);
    expect(r.supplied.size).toBe(5);
  });

  it('cascades a coal outage through the whole graph', () => {
    // coal → chemicals → (components, pharmaceuticals) → (electronics, vehicles)
    const r = resolveSupplyChain(INTERMEDIATE_GOODS, 2000, rawsAvailable('iron', 'copper'));
    for (const id of ['chemicals', 'components', 'pharmaceuticals', 'electronics', 'vehicles']) {
      expect(r.disrupted.has(id)).toBe(true);
    }
    expect(r.health).toBe(0);
  });

  it('isolates an iron outage to the iron-bearing branch', () => {
    // iron feeds components (→ electronics) and vehicles; chemicals →
    // pharmaceuticals run on coal alone and survive.
    const r = resolveSupplyChain(INTERMEDIATE_GOODS, 2000, rawsAvailable('coal', 'copper'));
    expect(r.supplied.has('chemicals')).toBe(true);
    expect(r.supplied.has('pharmaceuticals')).toBe(true);
    expect(r.disrupted.has('components')).toBe(true);
    expect(r.disrupted.has('electronics')).toBe(true); // needs components
    expect(r.disrupted.has('vehicles')).toBe(true);
    expect(r.health).toBeCloseTo(2 / 5, 10);
  });

  it('confines a copper outage to electronics alone', () => {
    const r = resolveSupplyChain(INTERMEDIATE_GOODS, 2000, rawsAvailable('coal', 'iron'));
    expect(r.disrupted.has('electronics')).toBe(true);
    expect([...r.disrupted]).toEqual(['electronics']);
    expect(r.health).toBeCloseTo(4 / 5, 10);
  });

  it('propagates through a deep linear chain', () => {
    const chain: SupplyGood[] = [
      { id: 'a', eraUnlock: 0, inputs: ['raw'], baseOutput: 1 },
      { id: 'b', eraUnlock: 0, inputs: ['a'], baseOutput: 1 },
      { id: 'c', eraUnlock: 0, inputs: ['b'], baseOutput: 1 },
      { id: 'd', eraUnlock: 0, inputs: ['c'], baseOutput: 1 },
    ];
    expect(resolveSupplyChain(chain, 0, rawsAvailable('raw')).health).toBe(1);
    const cut = resolveSupplyChain(chain, 0, rawsAvailable());
    expect(cut.disrupted.size).toBe(4);
    expect(cut.health).toBe(0);
  });
});

// ============================================================
// 4. resolveSupplyChain — robustness
// ============================================================
describe('resolveSupplyChain() robustness', () => {
  it('treats a dependency cycle as unmet without looping forever', () => {
    const cyclic: SupplyGood[] = [
      { id: 'a', eraUnlock: 0, inputs: ['b'], baseOutput: 1 },
      { id: 'b', eraUnlock: 0, inputs: ['a'], baseOutput: 1 },
    ];
    const r = resolveSupplyChain(cyclic, 0, () => true);
    expect(r.disrupted.size).toBe(2);
    expect(r.health).toBe(0);
  });

  it('treats a self-referential good as unmet', () => {
    const selfLoop: SupplyGood[] = [{ id: 'a', eraUnlock: 0, inputs: ['a'], baseOutput: 1 }];
    expect(resolveSupplyChain(selfLoop, 0, () => true).disrupted.has('a')).toBe(true);
  });

  it('queries the availability predicate only for raw materials', () => {
    const queried: string[] = [];
    resolveSupplyChain(INTERMEDIATE_GOODS, 2000, (id) => {
      queried.push(id);
      return true;
    });
    expect(new Set(queried)).toEqual(new Set(ALL_RAWS)); // never chemicals/components/…
  });
});

// ============================================================
// 5. Integration through RegionSim.tickIntermediateGoods
// ============================================================
/** Pin the sim's reported year so era-gated goods unlock for the test. */
function pinYear(r: RegionSim, year: number): void {
  Object.defineProperty(r, 'year', { get: () => year, configurable: true });
}

function freshSim(seed = 7): RegionSim {
  return RegionSim.create(seed, { aiDifficulty: 'normal', currencySymbol: '$' });
}

describe('tickIntermediateGoods() cascade integration', () => {
  it('runs the full chain and reports perfect health when industry supplies raws', () => {
    const r = freshSim();
    pinYear(r, 2000);
    for (const s of r.settlements) s.sectors.industry.output = 100; // raws proxied available
    r.tickIntermediateGoods();
    expect(r.getSupplyChainHealth()).toBe(1);
    expect(r.intermediateGoodStocks['electronics']).toBeGreaterThan(0);
  });

  it('does NOT let pharmaceuticals free-ride on buffered chemicals when coal is cut', () => {
    // The crux of the fix: pharmaceuticals holds no input of its own — it needs
    // chemicals, which needs coal. With coal gone, the old buffer check would
    // have produced pharmaceuticals off the 100-unit chemicals stock; the
    // cascade solver correctly fails it.
    const r = freshSim();
    pinYear(r, 2000);
    for (const s of r.settlements) s.sectors.industry.output = 0; // no raw proxy
    delete r.intermediateGoodStocks['coal'];
    delete r.intermediateGoodStocks['iron'];
    delete r.intermediateGoodStocks['copper'];
    r.intermediateGoodStocks['chemicals'] = 100; // a fat upstream buffer …
    r.intermediateGoodStocks['pharmaceuticals'] = 0;

    r.tickIntermediateGoods();

    // … that no longer rescues the downstream good.
    expect(r.intermediateGoodStocks['pharmaceuticals']).toBe(0);
    expect(r.getSupplyChainHealth()).toBe(0);
    expect(r.intermediateGoodStocks['chemicals']).toBe(100); // unconsumed: nobody could run
  });

  it('slows research when an electronics outage cascades from a raw shortage', () => {
    const r = freshSim();
    pinYear(r, 2000);
    for (const s of r.settlements) s.sectors.industry.output = 0; // cut every raw
    const before = r.researchRate();
    r.tickIntermediateGoods();
    // electronics disrupted (its components/copper chain is dead) → −10% research.
    expect(r.researchRate()).toBeCloseTo(before * 0.9, 6);
  });

  it('leaves health and the electronics flag untouched before any good unlocks', () => {
    const r = freshSim();
    pinYear(r, 1900);
    r.tickIntermediateGoods();
    expect(r.getSupplyChainHealth()).toBe(1);
    expect(r.researchRate()).toBeGreaterThan(0);
  });
});
