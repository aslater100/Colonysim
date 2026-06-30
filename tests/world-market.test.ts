import { describe, expect, it } from 'vitest';
import { RegionSim, INTERMEDIATE_GOODS, type Settlement } from '../src/sim/region';
import {
  worldGoodSupply,
  worldGoodDemand,
  worldGoodPrice,
  worldMarketTightness,
  localGoodDemand,
} from '../src/sim/systems/goods';

/**
 * LEG 1 of the global-world arc — the WORLD MARKET reference price.
 *
 * Today every price is per-town and the only market that clears is the PLAYER
 * nation's: `tickPriceArbitrage` ships goods only between the player's own
 * settlements, rivals trade in no market at all, and a good's scarcity reaches
 * only the player's macro. The world is REGIONAL. `worldGoodPrice` /
 * `worldMarketTightness` are the first global-market substrate: ONE clearing
 * price per good from TOTAL world supply (every faction's stock) vs. TOTAL world
 * demand (every settlement's appetite). The defining property under test is that
 * they span ALL factions, where the per-nation system spans only the player's.
 *
 * Pure / read-only → byte-identical: they feed telemetry only (no tick math, no
 * serialized field), and in balanced / self-sufficient play world supply ≥ world
 * demand → tightness 0 → price == base (the dormancy the integration test pins).
 *
 * Fixtures mirror goods-prices.test.ts: hand-built towns with pinned sector
 * outputs and an unwarmed norm so the per-good world stock vs. demand is the only
 * thing that can move a price. `worldSim` additionally lets a town be assigned to
 * a NON-player faction, the cross-faction case the whole leg exists for.
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

// ============================================================
// 1. world supply / demand span EVERY faction (the leg-1 essence)
// ============================================================
describe('worldGoodSupply / worldGoodDemand — span all factions', () => {
  it('world supply counts stock in a RIVAL faction town, not just the player', () => {
    const r = worldSim([{ ind: 100, agri: 0, faction: 99 }]);
    const rival = r.settlements[0];
    expect(rival.factionId).not.toBe(r.playerFactionId); // a non-player town
    (rival.goodStocks ??= {})['textiles'] = 50;
    // The world market sees the rival's hoard — a player-only sum would miss it.
    expect(worldGoodSupply(r, 'textiles')).toBe(50);
  });

  it('world supply is the SUM across factions (player + rival both counted)', () => {
    const r = worldSim([
      { ind: 100, agri: 0 }, // player
      { ind: 100, agri: 0, faction: 99 }, // rival
    ]);
    (r.settlements[0].goodStocks ??= {})['steel'] = 30;
    (r.settlements[1].goodStocks ??= {})['steel'] = 12;
    expect(worldGoodSupply(r, 'steel')).toBe(42);
  });

  it('world demand counts a rival faction town that consumes the good', () => {
    // A pure-industry RIVAL town draws textiles as an input → world demand > 0
    // even though the player owns no industry anywhere.
    const r = worldSim([{ ind: 0, agri: 100 }, { ind: 100, agri: 0, faction: 99 }]);
    const rival = r.settlements[1];
    expect(localGoodDemand(r, rival, 'textiles')).toBeGreaterThan(0);
    expect(worldGoodDemand(r, 'textiles')).toBeGreaterThan(0);
    expect(worldGoodDemand(r, 'textiles')).toBeCloseTo(localGoodDemand(r, rival, 'textiles'), 6);
  });

  it('an empty world holds no supply', () => {
    const r = worldSim([{ ind: 100, agri: 100 }]);
    expect(worldGoodSupply(r, 'textiles')).toBe(0);
  });
});

// ============================================================
// 2. worldGoodPrice — the clearing curve, lifted to the whole world
// ============================================================
describe('worldGoodPrice', () => {
  it('a world flush with a good prices it at base; a collectively-empty world prices it dear', () => {
    const r = worldSim([{ ind: 100, agri: 100 }]);
    const t = r.settlements[0];
    const demand = worldGoodDemand(r, 'textiles');
    expect(demand).toBeGreaterThan(0);

    (t.goodStocks ??= {})['textiles'] = demand * 10; // world well-supplied
    const flush = worldGoodPrice(r, 'textiles');
    t.goodStocks['textiles'] = 0; // world demands it but holds none
    const empty = worldGoodPrice(r, 'textiles');

    expect(empty).toBeGreaterThan(flush);
    expect(empty).toBeCloseTo(flush * 2, 6); // GAIN 1.0 → full scarcity doubles price
  });

  it('a single rival surplus relieves the world price for everyone (cross-faction clearing)', () => {
    // Two towns demand textiles; only a RIVAL holds any. The world price reflects
    // the rival's stock — the surplus is a world-market relief, not a player-private one.
    const r = worldSim([{ ind: 100, agri: 0 }, { ind: 100, agri: 0, faction: 99 }]);
    const shortPrice = worldGoodPrice(r, 'textiles'); // nobody holds any → dear
    (r.settlements[1].goodStocks ??= {})['textiles'] = worldGoodDemand(r, 'textiles') * 5;
    const relievedPrice = worldGoodPrice(r, 'textiles');
    expect(relievedPrice).toBeLessThan(shortPrice);
  });

  it('an un-tracked good (a raw) is priced at base regardless of stock', () => {
    const r = worldSim([{ ind: 100, agri: 100 }]);
    const t = r.settlements[0];
    (t.goodStocks ??= {})['coal'] = 0;
    const atZero = worldGoodPrice(r, 'coal');
    t.goodStocks['coal'] = 9999;
    expect(worldGoodPrice(r, 'coal')).toBe(atZero); // raw → no scarcity coupling
  });

  it('price falls monotonically as world supply rises toward world demand', () => {
    const r = worldSim([{ ind: 100, agri: 100 }]);
    const t = r.settlements[0];
    const demand = worldGoodDemand(r, 'textiles');
    let prev = Infinity;
    for (const frac of [0, 0.25, 0.5, 0.75, 1, 2]) {
      (t.goodStocks ??= {})['textiles'] = demand * frac;
      const p = worldGoodPrice(r, 'textiles');
      expect(p, `supply=${frac}×demand`).toBeLessThanOrEqual(prev);
      prev = p;
    }
  });
});

// ============================================================
// 3. worldMarketTightness — the single-number market state
// ============================================================
describe('worldMarketTightness', () => {
  it('is 0 when the world is collectively self-sufficient (the dormancy / byte-identical case)', () => {
    const r = worldSim([{ ind: 100, agri: 100 }]);
    const t = r.settlements[0];
    // Stock every unlocked good well past its world demand → no good is short.
    for (const g of INTERMEDIATE_GOODS) {
      if (r.year < g.eraUnlock) continue;
      (t.goodStocks ??= {})[g.id] = worldGoodDemand(r, g.id) * 5 + 1;
    }
    expect(worldMarketTightness(r)).toBe(0);
  });

  it('rises above 0 when the world runs collectively short, and stays bounded [0,1]', () => {
    const r = worldSim([{ ind: 100, agri: 100 }]); // empty ledger → everything short
    const tight = worldMarketTightness(r);
    expect(tight).toBeGreaterThan(0);
    expect(tight).toBeLessThanOrEqual(1);
    expect(Number.isFinite(tight)).toBe(true);
  });

  it('eases as the world is supplied (more stock → lower tightness)', () => {
    const r = worldSim([{ ind: 100, agri: 100 }]);
    const t = r.settlements[0];
    const empty = worldMarketTightness(r);
    for (const g of INTERMEDIATE_GOODS) {
      if (r.year < g.eraUnlock) continue;
      (t.goodStocks ??= {})[g.id] = worldGoodDemand(r, g.id) * 0.5; // half-supplied
    }
    const half = worldMarketTightness(r);
    expect(half).toBeLessThan(empty);
    expect(half).toBeGreaterThan(0);
  });

  it('is deterministic — identical state yields an identical reading', () => {
    const a = worldSim([{ ind: 70, agri: 40 }, { ind: 0, agri: 120, faction: 99 }]);
    const b = worldSim([{ ind: 70, agri: 40 }, { ind: 0, agri: 120, faction: 99 }]);
    expect(worldMarketTightness(a)).toBe(worldMarketTightness(b));
  });
});

// ============================================================
// 4. integration — dormant & finite in real balanced autoplay
// ============================================================
describe('world market in live autoplay', () => {
  it('stays a finite [0,1] reading and is 0 in self-sufficient play', () => {
    const r = RegionSim.create(1000);
    r.autoDevelopPlayer = true;
    const target = r.year + 30;
    let guard = 0;
    while (r.year < target && !r.gameOver && guard < 2_000_000) {
      r.tick();
      guard++;
    }
    const tight = r.worldMarketTightness();
    expect(Number.isFinite(tight)).toBe(true);
    expect(tight).toBeGreaterThanOrEqual(0);
    expect(tight).toBeLessThanOrEqual(1);
    // Balanced autoplay towns hold what they consume → the world market is slack.
    expect(tight).toBe(0);
  });
});
