import { describe, expect, it } from 'vitest';
import { RegionSim, INTERMEDIATE_GOODS, type Settlement } from '../src/sim/region';
import {
  worldGoodDemand,
  worldGoodScarcity,
  worldGoodPrice,
  localGoodPrice,
  localGoodDemand,
} from '../src/sim/systems/goods';

/**
 * GLOBAL-WORLD LEG 1 (cont.) — the WORLD-PRICE ANCHOR on `localGoodPrice`.
 *
 * Leg 1's first slice added a read-only world clearing price (`worldGoodPrice` /
 * `worldMarketTightness`). This slice makes a town's LOCAL price reflect WORLD
 * scarcity: `localGoodPrice` lifts a town's local scarcity a `WORLD_PRICE_ANCHOR`
 * (0.5) fraction of the way toward the (higher) world scarcity. The lift is
 * ONE-SIDED — `max(0, world − local)` — so it:
 *   - NEVER lowers a locally-short town's price below its local-only value (the
 *     local relief signal arbitrage already ships on is preserved verbatim);
 *   - ADDS a global-scarcity premium to a locally-stocked town that the old
 *     purely-local price missed (a good the WHOLE world is short of is now dear
 *     even on a full local shelf — the "one global economy" the arc is building);
 *   - is +0 for every good whenever the world is collectively self-sufficient, so
 *     balanced / self-sufficient play (every town holds its own demand → world
 *     supply ≥ world demand → world scarcity 0) is BYTE-IDENTICAL to the pre-anchor
 *     curve. Confirmed live below (autoplay world scarcity 0 for every good) and by
 *     the headless byte-identical sweep + determinism harness in the handoff.
 *
 * Fixtures mirror world-market.test.ts: hand-built towns with pinned sector outputs,
 * an unwarmed norm (raws flow at level 1) and an optional non-player faction, so the
 * per-good world stock vs. demand is the only thing that can move a price.
 */
function worldSim(
  layout: Array<{ ind: number; agri: number; faction?: number }>,
  year = 2000,
): RegionSim {
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
    s.factionId = l.faction ?? r.playerFactionId;
    s.goodStocks = undefined;
  });
  r.sectorOutputNorm = { industry: 0, agriculture: 0 };
  Object.defineProperty(r, 'year', { get: () => year, configurable: true });
  return r;
}

/** The base £-value of a good = its price when the world is fully self-sufficient in
 *  it (world scarcity 0 → no anchor lift, no local lift). Derived, not hard-coded, so
 *  it tracks the catalog's refinement-depth pricing. */
function basePriceOf(goodId: string): number {
  const r = worldSim([{ ind: 100, agri: 100 }]);
  const t = r.settlements[0];
  (t.goodStocks ??= {})[goodId] = worldGoodDemand(r, goodId) * 10 + 100; // world flush
  expect(worldGoodScarcity(r, goodId)).toBe(0);
  return worldGoodPrice(r, goodId);
}

// ============================================================
// 1. byte-identical when the world is slack — the anchor adds nothing
// ============================================================
describe('world-price anchor — dormant when the world is self-sufficient', () => {
  it('a locally-short town prices a good purely locally when the world is flush', () => {
    // Player industry town demands textiles, holds none → fully LOCAL-scarce. A rival
    // hoards a huge textiles surplus → world supply ≫ world demand → world scarcity 0.
    const r = worldSim([
      { ind: 100, agri: 0 }, // player — demands textiles, holds none
      { ind: 0, agri: 100, faction: 99 }, // rival hoarder
    ]);
    const [player, rival] = r.settlements;
    (rival.goodStocks ??= {})['textiles'] = worldGoodDemand(r, 'textiles') * 50 + 1000;
    expect(worldGoodScarcity(r, 'textiles')).toBe(0); // world slack
    expect(localGoodDemand(r, player, 'textiles')).toBeGreaterThan(0); // player is short

    const base = basePriceOf('textiles');
    // Pure local doubling (GAIN 1.0, full local scarcity) — the world adds nothing.
    expect(localGoodPrice(r, player, 'textiles')).toBeCloseTo(base * 2, 6);
  });

  it('is 0 for every unlocked good in live balanced autoplay (the byte-identical case)', () => {
    const r = RegionSim.create(1000);
    r.autoDevelopPlayer = true;
    const target = r.year + 30;
    let guard = 0;
    while (r.year < target && !r.gameOver && guard < 2_000_000) {
      r.tick();
      guard++;
    }
    // Balanced autoplay towns hold what they consume → world scarcity 0 for every good
    // → the anchor lift is +0 everywhere → localGoodPrice is byte-identical to the
    // pre-anchor curve (the mechanism behind the headless byte-identical sweep).
    for (const g of INTERMEDIATE_GOODS) {
      if (r.year < g.eraUnlock) continue;
      expect(r.worldGoodScarcity(g.id), g.id).toBe(0);
    }
  });
});

// ============================================================
// 2. the lift — a globally-scarce good is dear even on a full local shelf
// ============================================================
describe('world-price anchor — global scarcity reaches a locally-stocked town', () => {
  it('lifts a locally-FLUSH town\'s price above base toward (but not past) the world price', () => {
    // Two industry towns both demand textiles; the player holds exactly its OWN demand
    // (local scarcity 0) but nobody supplies the rival → the WORLD is short.
    const r = worldSim([
      { ind: 100, agri: 0 }, // player
      { ind: 100, agri: 0, faction: 99 }, // rival — demands textiles, holds none
    ]);
    const player = r.settlements[0];
    (player.goodStocks ??= {})['textiles'] = localGoodDemand(r, player, 'textiles'); // local scarcity 0

    const worldScar = worldGoodScarcity(r, 'textiles');
    expect(worldScar).toBeGreaterThan(0); // world short despite the player being stocked

    const base = basePriceOf('textiles');
    const local = localGoodPrice(r, player, 'textiles');
    const world = worldGoodPrice(r, 'textiles');

    expect(local).toBeGreaterThan(base); // the global-scarcity premium reaches it
    expect(local).toBeLessThan(world); // …but only part of the way (anchor < 1)
    // The premium is exactly the anchor fraction of the world's: (local−base)/(world−base)
    // == WORLD_PRICE_ANCHOR (0.5). Strictly between 0 and 1 is retune-robust; the
    // half-split pins the current dial.
    const ratio = (local - base) / (world - base);
    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThan(1);
    expect(ratio).toBeCloseTo(0.5, 6); // WORLD_PRICE_ANCHOR
  });
});

// ============================================================
// 3. one-sided — local relief is never eroded
// ============================================================
describe('world-price anchor — never lowers a locally-short price (relief preserved)', () => {
  it('a fully locally-scarce town stays at the price ceiling whatever the world does', () => {
    // local scarcity 1 → eff = 1 + 0.5·max(0, world−1) = 1 (world ≤ 1) → price = base×2,
    // the ceiling, regardless of world scarcity. The anchor can only RAISE toward the
    // world; a town already at full local scarcity has nothing above it to reach.
    const base = basePriceOf('textiles');
    for (const worldShort of [false, true]) {
      const r = worldSim([
        { ind: 100, agri: 0 }, // player — demands textiles, holds none → local scarcity 1
        { ind: 100, agri: 0, faction: 99 }, // rival — also short when worldShort
      ]);
      if (!worldShort) {
        // Flush the rival so the world is self-sufficient.
        (r.settlements[1].goodStocks ??= {})['textiles'] = worldGoodDemand(r, 'textiles') * 50 + 1000;
      }
      expect(worldGoodScarcity(r, 'textiles') > 0).toBe(worldShort);
      expect(localGoodPrice(r, r.settlements[0], 'textiles')).toBeCloseTo(base * 2, 6);
    }
  });

  it('a partially-short town is lifted toward the world but never below its local-only price', () => {
    const r = worldSim([
      { ind: 100, agri: 0 }, // player
      { ind: 100, agri: 0, faction: 99 }, // rival — demands textiles, holds none
    ]);
    const player = r.settlements[0];
    const demand = localGoodDemand(r, player, 'textiles');
    (player.goodStocks ??= {})['textiles'] = demand * 0.5; // local scarcity 0.5

    const base = basePriceOf('textiles');
    const localOnly = base * (1 + 0.5); // pre-anchor: 1 + localScarcity·GAIN
    const price = localGoodPrice(r, player, 'textiles');

    expect(worldGoodScarcity(r, 'textiles')).toBeGreaterThan(0.5); // world scarcer than local
    expect(price).toBeGreaterThan(localOnly); // lifted by the anchor
    expect(price).toBeLessThanOrEqual(worldGoodPrice(r, 'textiles')); // but not past world
  });
});

// ============================================================
// 4. bounded & deterministic
// ============================================================
describe('world-price anchor — bounded & deterministic', () => {
  it('localGoodPrice stays within [base, 2×base] across every local/world combination', () => {
    const base = basePriceOf('textiles');
    for (const localFrac of [0, 0.5, 1, 2]) {
      for (const worldShort of [false, true]) {
        const r = worldSim([
          { ind: 100, agri: 0 },
          { ind: 100, agri: 0, faction: 99 },
        ]);
        const player = r.settlements[0];
        (player.goodStocks ??= {})['textiles'] = localGoodDemand(r, player, 'textiles') * localFrac;
        if (!worldShort) {
          (r.settlements[1].goodStocks ??= {})['textiles'] = worldGoodDemand(r, 'textiles') * 50 + 1000;
        }
        const p = localGoodPrice(r, player, 'textiles');
        expect(Number.isFinite(p)).toBe(true);
        expect(p).toBeGreaterThanOrEqual(base - 1e-9);
        expect(p).toBeLessThanOrEqual(base * 2 + 1e-9);
      }
    }
  });

  it('is deterministic — identical state yields an identical price', () => {
    const build = (): RegionSim => {
      const r = worldSim([
        { ind: 70, agri: 40 },
        { ind: 0, agri: 120, faction: 99 },
      ]);
      (r.settlements[0].goodStocks ??= {})['textiles'] = 1;
      return r;
    };
    expect(localGoodPrice(build(), build().settlements[0], 'textiles')).toBe(
      localGoodPrice(build(), build().settlements[0], 'textiles'),
    );
  });

  it('the public r.worldGoodScarcity wrapper matches the free function', () => {
    const r = worldSim([
      { ind: 100, agri: 0 },
      { ind: 100, agri: 0, faction: 99 },
    ]);
    expect(r.worldGoodScarcity('textiles')).toBe(worldGoodScarcity(r, 'textiles'));
    expect(r.worldGoodScarcity('coal')).toBe(0); // raw → no scarcity
  });
});
