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
import {
  resolveSupplyChain,
  resolveSupplyChainGraded,
  rawMaterialsOf,
  type SupplyGood,
} from '../src/sim/supply';
import { RegionSim, INTERMEDIATE_GOODS } from '../src/sim/region';

/** A predicate that reports the given raw ids as available, all others not. */
const rawsAvailable = (...available: string[]) => (id: string) => available.includes(id);
/** Every raw material of the shipping catalog. */
const ALL_RAWS = rawMaterialsOf(INTERMEDIATE_GOODS);
/** Predicate with every catalog raw available *except* the named ones — an
 *  outage of exactly those raws, robust to however large the raw set grows. */
const allRawsExcept = (...cut: string[]) => (id: string) =>
  ALL_RAWS.includes(id) && !cut.includes(id);

// ============================================================
// 1. rawMaterialsOf — graph shape
// ============================================================
describe('rawMaterialsOf()', () => {
  it('identifies the GDD §5.2 primary raws of the catalog', () => {
    // First-appearance order across the catalog's input lists.
    expect(new Set(ALL_RAWS)).toEqual(
      new Set(['wood', 'iron', 'coal', 'livestock', 'oil', 'grain', 'copper']),
    );
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
    // 1925: the 1920-era goods and vehicles (1925) are live; components (1930) is
    // not — so vehicles, which needs components, cannot be made yet, while every
    // other unlocked good runs on raws/intermediates already available.
    const r = resolveSupplyChain(INTERMEDIATE_GOODS, 1925, () => true);
    expect(r.active).toContain('vehicles');
    expect(r.active).not.toContain('components'); // unlocks 1930
    expect(r.disrupted.has('vehicles')).toBe(true);
    expect(r.supplied.has('chemicals')).toBe(true);
    expect([...r.disrupted]).toEqual(['vehicles']); // the *only* structural dip
    expect(r.health).toBeCloseTo(9 / 10, 10);
  });

  it('supplies the whole pre-electronics chain by 1940 when raws flow', () => {
    const r = resolveSupplyChain(INTERMEDIATE_GOODS, 1940, () => true);
    expect(r.active).not.toContain('electronics'); // unlocks 1950
    expect(r.active).not.toContain('luxury_goods'); // unlocks 1955
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
    expect(r.supplied.size).toBe(INTERMEDIATE_GOODS.length);
  });

  it('cascades a coal outage through every coal-derived branch', () => {
    // coal feeds steel, chemicals, electricity → and everything downstream of
    // them (components → vehicles/electronics/machinery/consumer_goods, etc.).
    const r = resolveSupplyChain(INTERMEDIATE_GOODS, 2000, allRawsExcept('coal'));
    for (const id of ['steel', 'chemicals', 'electricity', 'components',
      'pharmaceuticals', 'electronics', 'vehicles', 'machinery', 'tools']) {
      expect(r.disrupted.has(id), `${id} should cascade from coal`).toBe(true);
    }
    // The coal-independent branch survives.
    for (const id of ['lumber', 'textiles', 'fuel', 'food', 'clothing']) {
      expect(r.supplied.has(id), `${id} should survive a coal outage`).toBe(true);
    }
    expect(r.health).toBeCloseTo(5 / 16, 10);
  });

  it('isolates an iron outage to the iron-bearing branch', () => {
    // iron feeds steel and components (→ vehicles/electronics/machinery); the
    // coal-only chemicals→pharmaceuticals chain survives.
    const r = resolveSupplyChain(INTERMEDIATE_GOODS, 2000, allRawsExcept('iron'));
    expect(r.supplied.has('chemicals')).toBe(true);
    expect(r.supplied.has('pharmaceuticals')).toBe(true);
    expect(r.supplied.has('electricity')).toBe(true);
    for (const id of ['steel', 'components', 'electronics', 'vehicles', 'tools', 'machinery']) {
      expect(r.disrupted.has(id), `${id} should fail without iron`).toBe(true);
    }
    expect(r.health).toBeCloseTo(8 / 16, 10);
  });

  it('confines a copper outage to electronics and its sole dependent', () => {
    // copper feeds only electronics; luxury_goods needs electronics, so it falls
    // too — but nothing else does.
    const r = resolveSupplyChain(INTERMEDIATE_GOODS, 2000, allRawsExcept('copper'));
    expect(new Set(r.disrupted)).toEqual(new Set(['electronics', 'luxury_goods']));
    expect(r.health).toBeCloseTo(14 / 16, 10);
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
// 4b. resolveSupplyChainGraded — fractional availability
// ============================================================
describe('resolveSupplyChainGraded()', () => {
  const linear: SupplyGood[] = [
    { id: 'a', eraUnlock: 0, inputs: ['raw'], baseOutput: 1 },
    { id: 'b', eraUnlock: 0, inputs: ['a'], baseOutput: 1 },
    { id: 'c', eraUnlock: 0, inputs: ['b', 'raw2'], baseOutput: 1 },
  ];

  it('generalises the boolean solver exactly when every raw is 0 or 1', () => {
    // For any all-or-nothing predicate, graded (mean level, level≥1 ⇒ supplied)
    // must match resolveSupplyChain bit for bit — this is what guarantees healthy
    // play stays byte-identical when the sim is wired to the graded solver.
    for (const cut of [[], ['coal'], ['iron'], ['copper'], ['oil'], ['coal', 'oil']]) {
      const pred = (id: string) => ALL_RAWS.includes(id) && !cut.includes(id);
      const bool = resolveSupplyChain(INTERMEDIATE_GOODS, 2000, pred);
      const graded = resolveSupplyChainGraded(INTERMEDIATE_GOODS, 2000, (id) => (pred(id) ? 1 : 0));
      expect(graded.health).toBeCloseTo(bool.health, 12);
      expect([...graded.supplied].sort()).toEqual([...bool.supplied].sort());
      expect([...graded.disrupted].sort()).toEqual([...bool.disrupted].sort());
    }
  });

  it('carries a fractional raw level downstream as the min over inputs (Liebig)', () => {
    const res = resolveSupplyChainGraded(linear, 0, (id) => (id === 'raw' ? 0.4 : 1));
    expect(res.levels.get('a')).toBeCloseTo(0.4, 10); // a ← raw(0.4)
    expect(res.levels.get('b')).toBeCloseTo(0.4, 10); // b ← a(0.4)
    expect(res.levels.get('c')).toBeCloseTo(0.4, 10); // c ← min(b 0.4, raw2 1)
    // mean of (0.4, 0.4, 0.4)
    expect(res.health).toBeCloseTo(0.4, 10);
    // all three run below full → all disrupted, none "supplied"
    expect(res.supplied.size).toBe(0);
    expect(res.disrupted.size).toBe(3);
  });

  it('takes the scarcest input when two inputs differ', () => {
    const res = resolveSupplyChainGraded(linear, 0, (id) => (id === 'raw' ? 0.9 : 0.3));
    // c ← min(b, raw2) = min(0.9, 0.3)
    expect(res.levels.get('c')).toBeCloseTo(0.3, 10);
  });

  it('clamps out-of-range and non-finite raw levels to [0,1]', () => {
    const hi = resolveSupplyChainGraded(linear, 0, () => 5);
    expect(hi.levels.get('a')).toBe(1);
    const lo = resolveSupplyChainGraded(linear, 0, (id) => (id === 'raw' ? -2 : 1));
    expect(lo.levels.get('a')).toBe(0);
    const nan = resolveSupplyChainGraded(linear, 0, (id) => (id === 'raw' ? NaN : 1));
    expect(nan.levels.get('a')).toBe(0);
  });

  it('treats a dependency cycle as level 0, like the boolean solver', () => {
    const cyclic: SupplyGood[] = [
      { id: 'a', eraUnlock: 0, inputs: ['b'], baseOutput: 1 },
      { id: 'b', eraUnlock: 0, inputs: ['a'], baseOutput: 1 },
    ];
    const res = resolveSupplyChainGraded(cyclic, 0, () => 1);
    expect(res.health).toBe(0);
    expect(res.levels.get('a')).toBe(0);
  });

  it('reports perfect health and no active goods before any unlock', () => {
    const res = resolveSupplyChainGraded(INTERMEDIATE_GOODS, 1900, () => 1);
    expect(res.active).toEqual([]);
    expect(res.health).toBe(1);
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

/** Make every primary raw flow by giving both extracting sectors output. */
function flowAllRaws(r: RegionSim): void {
  for (const s of r.settlements) {
    s.sectors.industry.output = 100; // extractive raws (coal/iron/wood/oil/…)
    s.sectors.agriculture.output = 100; // agricultural raws (grain/livestock)
  }
}

describe('tickIntermediateGoods() cascade integration', () => {
  it('runs the full chain and reports perfect health when both sectors supply raws', () => {
    const r = freshSim();
    pinYear(r, 2000);
    flowAllRaws(r);
    r.tickIntermediateGoods();
    expect(r.getSupplyChainHealth()).toBe(1);
    expect(r.intermediateGoodStocks['electronics']).toBeGreaterThan(0);
    expect(r.intermediateGoodStocks['food']).toBeGreaterThan(0);
  });

  it('does NOT let pharmaceuticals free-ride on buffered chemicals when coal is cut', () => {
    // The crux of the fix: pharmaceuticals holds no input of its own — it needs
    // chemicals, which needs coal. With every raw gone, the old buffer check would
    // have produced pharmaceuticals off the 100-unit chemicals stock; the cascade
    // solver correctly fails it.
    const r = freshSim();
    pinYear(r, 2000);
    for (const s of r.settlements) {
      s.sectors.industry.output = 0;
      s.sectors.agriculture.output = 0;
    }
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
    for (const s of r.settlements) {
      s.sectors.industry.output = 0; // cut every extractive raw
      s.sectors.agriculture.output = 0;
    }
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
