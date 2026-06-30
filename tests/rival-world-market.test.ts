import { describe, expect, it } from 'vitest';
import {
  RegionSim,
  INTERMEDIATE_GOODS,
  type Settlement,
  type RivalNation,
} from '../src/sim/region';
import {
  worldGoodDemand,
  worldGoodScarcity,
  worldGoodPrice,
  worldMarketTightness,
  worldPowerPressure,
  localGoodDemand,
  localGoodPrice,
} from '../src/sim/systems/goods';

/**
 * GLOBAL-WORLD ARC, leg 1 — THE GREAT POWERS JOIN THE WORLD MARKET.
 *
 * Leg 1's world market only ever saw the ON-MAP towns; the off-map `RivalNation`
 * great powers ("rivals trade in no market at all") sat outside it. This slice
 * makes them participants: `worldGoodDemand` now carries a derived tilt from the
 * great powers' war / commerce / climate posture, so a great-power war tightens
 * the world for everyone, a commercial republic relieves it, and a warming world
 * makes every power a net importer of food. Derived purely from already-serialized
 * rival state (`pop`, `weights.commerce`, the `foreignWars` ledger, `warmingC`) —
 * no RNG, no new field. It is 0 when the powers are balanced (or none have emerged)
 * → byte-identical; it bites only when the on-map world is itself short.
 *
 * Fixtures mirror world-market.test.ts / world-anchor.test.ts: hand-built towns
 * with pinned sector outputs and an unwarmed norm. `r.rivals` starts empty at
 * `create()` (rivals spawn during play), and we clear it defensively, then push
 * synthetic great powers so the tilt is the only thing under test.
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
  r.rivals = [];
  r.foreignWars = [];
  r.warmingC = 0;
  Object.defineProperty(r, 'year', { get: () => year, configurable: true });
  return r;
}

/** Push a synthetic off-map great power. `commerce` 4.5 is the archetype mean, so it
 *  isolates the WAR / CLIMATE channels (its commerce tilt is 0). */
function addRival(
  r: RegionSim,
  opts: { id: number; commerce?: number; pop?: number },
): RivalNation {
  const rv = {
    id: opts.id,
    name: `Power ${opts.id}`,
    leader: 'the Directorate',
    archetype: 'opportunist',
    weights: { expansion: 5, commerce: opts.commerce ?? 4.5, ideology: 5, honor: 5, risk: 5, grudge: 5 },
    regime: 'parliamentary',
    agenda: '',
    compass: 'north',
    pop: opts.pop ?? 50000,
    relations: 0,
    treaties: [],
    borderSettled: false,
    emergedYear: 1990,
    history: [],
    lastEnvoyDay: -999,
    lastGiftDay: -999,
  } as RivalNation;
  r.rivals.push(rv);
  return rv;
}

/** Put a rival at war (push a ForeignWar referencing its id). */
function setWar(r: RegionSim, aId: number, bId: number): void {
  r.foreignWars.push({ a: aId, b: bId, startedDay: 0, endsDay: 9_999_999 });
}

// ============================================================
// 1. no great powers → the world market is exactly the on-map one (byte-identical)
// ============================================================
describe('rival world-market tilt — inert without great powers', () => {
  it('worldGoodDemand equals the pure on-map sum when no rival has emerged', () => {
    const r = worldSim([{ ind: 100, agri: 60 }, { ind: 0, agri: 120, faction: 99 }]);
    const onmap = r.settlements.reduce((s, t) => s + localGoodDemand(r, t, 'steel'), 0);
    expect(r.rivals.length).toBe(0);
    expect(worldGoodDemand(r, 'steel')).toBeCloseTo(onmap, 9);
    expect(worldPowerPressure(r)).toBe(0);
  });

  it('an un-demanded good (a raw) stays at 0 demand even with a great power at war', () => {
    const r = worldSim([{ ind: 100, agri: 100 }]);
    addRival(r, { id: 1 });
    setWar(r, 1, 2);
    expect(worldGoodDemand(r, 'coal')).toBe(0); // rivals can't conjure appetite from nothing
  });
});

// ============================================================
// 2. the three tilt channels — war / commerce / climate
// ============================================================
describe('rival world-market tilt — war imports', () => {
  it('a great power at war lifts world demand by WAR_IMPORT × pop-weight', () => {
    const r = worldSim([{ ind: 100, agri: 0 }, { ind: 80, agri: 0 }]);
    const base = worldGoodDemand(r, 'steel'); // no rivals → on-map only
    expect(base).toBeGreaterThan(0);
    addRival(r, { id: 1, commerce: 4.5, pop: 50000 }); // mean commerce → war is the only tilt
    setWar(r, 1, 2);
    // pop 50000 == RIVAL_WORLD_POP_NORM → weight 1; WAR_IMPORT 0.5 → demand ×1.5.
    expect(worldGoodDemand(r, 'steel')).toBeCloseTo(base * 1.5, 6);
  });

  it('a great power at PEACE with mean commerce leaves world demand unchanged', () => {
    const r = worldSim([{ ind: 100, agri: 0 }, { ind: 80, agri: 0 }]);
    const base = worldGoodDemand(r, 'steel');
    addRival(r, { id: 1, commerce: 4.5, pop: 50000 }); // peace, mean commerce, no warming → tilt 0
    expect(worldGoodDemand(r, 'steel')).toBeCloseTo(base, 6);
  });
});

describe('rival world-market tilt — commerce', () => {
  it('a Trading-Republic-scale commerce power EXPORTS, relieving world demand', () => {
    const r = worldSim([{ ind: 100, agri: 0 }, { ind: 80, agri: 0 }]);
    const base = worldGoodDemand(r, 'steel');
    addRival(r, { id: 1, commerce: 9, pop: 50000 }); // commerce 9 → −0.4×(9−4.5)/9 = −0.2
    expect(worldGoodDemand(r, 'steel')).toBeCloseTo(base * 0.8, 6);
    expect(worldGoodDemand(r, 'steel')).toBeLessThan(base);
  });

  it('a Hermit-Kingdom-scale (low commerce) power IMPORTS, tightening world demand', () => {
    const r = worldSim([{ ind: 100, agri: 0 }, { ind: 80, agri: 0 }]);
    const base = worldGoodDemand(r, 'steel');
    addRival(r, { id: 1, commerce: 2, pop: 50000 }); // commerce 2 → −0.4×(2−4.5)/9 = +0.1111
    expect(worldGoodDemand(r, 'steel')).toBeCloseTo(base * (1 + 0.4 * 2.5 / 9), 6);
    expect(worldGoodDemand(r, 'steel')).toBeGreaterThan(base);
  });
});

describe('rival world-market tilt — climate hits the GLOBAL breadbasket', () => {
  it('a warming world makes great powers net importers of AGRI goods, but not industry goods', () => {
    // `textiles` is the agri-attributed good with real intermediate demand (it feeds
    // clothing/consumer_goods/luxury_goods); `food` is terminal (no good consumes it).
    const r = worldSim([{ ind: 100, agri: 100 }, { ind: 100, agri: 100 }]);
    const baseTextiles = worldGoodDemand(r, 'textiles'); // agriculture-attributed
    const baseSteel = worldGoodDemand(r, 'steel'); // industry
    expect(baseTextiles).toBeGreaterThan(0);
    expect(baseSteel).toBeGreaterThan(0);
    addRival(r, { id: 1, commerce: 4.5, pop: 50000 }); // mean commerce, peace → only climate tilts
    r.warmingC = 3.0; // RIVAL_CLIMATE_C → full agri import 0.4
    expect(worldGoodDemand(r, 'textiles')).toBeCloseTo(baseTextiles * 1.4, 6);
    expect(worldGoodDemand(r, 'steel')).toBeCloseTo(baseSteel, 6); // industry untouched by the food channel
  });

  it('the climate import scales with warming and is 0 at 0 °C', () => {
    const r = worldSim([{ ind: 0, agri: 100 }, { ind: 100, agri: 0 }]);
    const baseTextiles = worldGoodDemand(r, 'textiles'); // agri-attributed
    addRival(r, { id: 1, commerce: 4.5, pop: 50000 });
    r.warmingC = 0;
    expect(worldGoodDemand(r, 'textiles')).toBeCloseTo(baseTextiles, 6);
    r.warmingC = 1.5; // half of RIVAL_CLIMATE_C → import 0.2
    expect(worldGoodDemand(r, 'textiles')).toBeCloseTo(baseTextiles * 1.2, 6);
  });
});

// ============================================================
// 3. bounded — the bloc can move the world, never dominate it
// ============================================================
describe('rival world-market tilt — bounded by the cap', () => {
  it('a huge belligerent bloc is clamped to ±RIVAL_WORLD_TILT_CAP (0.6)', () => {
    const r = worldSim([{ ind: 100, agri: 0 }, { ind: 80, agri: 0 }]);
    const base = worldGoodDemand(r, 'steel');
    for (let i = 1; i <= 4; i++) addRival(r, { id: i, commerce: 4.5, pop: 50000 });
    for (let i = 1; i <= 4; i++) setWar(r, i, 100 + i); // raw tilt 4×0.5 = 2.0 → clamps to 0.6
    expect(worldGoodDemand(r, 'steel')).toBeCloseTo(base * 1.6, 6);
  });

  it('a huge commercial bloc relief is clamped to −0.6 (demand never below 0.4× on-map)', () => {
    const r = worldSim([{ ind: 100, agri: 0 }, { ind: 80, agri: 0 }]);
    const base = worldGoodDemand(r, 'steel');
    for (let i = 1; i <= 6; i++) addRival(r, { id: i, commerce: 9, pop: 50000 }); // raw −1.2 → clamp −0.6
    expect(worldGoodDemand(r, 'steel')).toBeCloseTo(base * 0.4, 6);
  });

  it('pop weight scales the tilt — a smaller power moves the world less', () => {
    const big = worldSim([{ ind: 100, agri: 0 }, { ind: 80, agri: 0 }]);
    const small = worldSim([{ ind: 100, agri: 0 }, { ind: 80, agri: 0 }]);
    const base = worldGoodDemand(big, 'steel');
    addRival(big, { id: 1, commerce: 4.5, pop: 50000 });
    setWar(big, 1, 2);
    addRival(small, { id: 1, commerce: 4.5, pop: 10000 }); // 1/5 the weight
    setWar(small, 1, 2);
    const bigLift = worldGoodDemand(big, 'steel') - base;
    const smallLift = worldGoodDemand(small, 'steel') - base;
    expect(smallLift).toBeGreaterThan(0);
    expect(smallLift).toBeCloseTo(bigLift / 5, 6);
  });
});

// ============================================================
// 4. the BITE — a great-power war makes goods dear, even on a full shelf
// ============================================================
describe('rival world-market tilt — the bite under scarcity', () => {
  it('a great-power war RAISES world scarcity and the world clearing price', () => {
    const r = worldSim([{ ind: 100, agri: 0 }, { ind: 80, agri: 0 }]);
    // Half-supply the world for steel so scarcity is mid-range (0 < s < 1).
    const onmap = worldGoodDemand(r, 'steel');
    (r.settlements[0].goodStocks ??= {})['steel'] = onmap * 0.5;
    const calmScar = worldGoodScarcity(r, 'steel');
    const calmPrice = worldGoodPrice(r, 'steel');
    expect(calmScar).toBeGreaterThan(0);
    expect(calmScar).toBeLessThan(1);
    addRival(r, { id: 1, commerce: 4.5, pop: 50000 });
    setWar(r, 1, 2);
    expect(worldGoodScarcity(r, 'steel')).toBeGreaterThan(calmScar);
    expect(worldGoodPrice(r, 'steel')).toBeGreaterThan(calmPrice);
  });

  it("lifts a locally-FLUSH town's price via the world anchor — the headline behaviour", () => {
    // Town A holds exactly its own demand (locally flush, localScar 0); town B holds
    // none. The WORLD is half-short, so A already pays a small world-anchor premium.
    const r = worldSim([{ ind: 100, agri: 0 }, { ind: 100, agri: 0 }]);
    const a = r.settlements[0];
    const demandA = localGoodDemand(r, a, 'steel');
    expect(demandA).toBeGreaterThan(0);
    (a.goodStocks ??= {})['steel'] = demandA; // flush: stock == demand → localScar 0
    const calmPrice = localGoodPrice(r, a, 'steel');
    addRival(r, { id: 1, commerce: 4.5, pop: 50000 });
    setWar(r, 1, 2); // a great-power war tightens the world …
    const warPrice = localGoodPrice(r, a, 'steel');
    expect(warPrice).toBeGreaterThan(calmPrice); // … so even the flush town's price rises
  });

  it('stays byte-identical in BALANCED play: a flush world is slack even with a war rival', () => {
    const r = worldSim([{ ind: 100, agri: 100 }, { ind: 100, agri: 100 }]);
    // Stock every unlocked good far past world demand → no good is short anywhere.
    for (const g of INTERMEDIATE_GOODS) {
      if (r.year < g.eraUnlock) continue;
      (r.settlements[0].goodStocks ??= {})[g.id] = worldGoodDemand(r, g.id) * 10 + 1;
    }
    const calmTight = worldMarketTightness(r);
    const calmPriceTextiles = localGoodPrice(r, r.settlements[1], 'textiles');
    addRival(r, { id: 1, commerce: 2, pop: 50000 }); // a hoarding hermit, and at war
    setWar(r, 1, 2);
    r.warmingC = 3.0;
    // The world is flush → supply ≫ demand even after the tilt → scarcity 0 → no lift.
    expect(worldMarketTightness(r)).toBe(calmTight);
    expect(worldMarketTightness(r)).toBe(0);
    expect(localGoodPrice(r, r.settlements[1], 'textiles')).toBe(calmPriceTextiles);
  });
});

// ============================================================
// 5. worldPowerPressure — the visible "world stage" telemetry
// ============================================================
describe('worldPowerPressure — the great-power posture read', () => {
  it('is positive when the great powers tighten (war) and negative when they relieve (commerce)', () => {
    const war = worldSim([{ ind: 100, agri: 50 }, { ind: 60, agri: 80 }]);
    addRival(war, { id: 1, commerce: 4.5, pop: 50000 });
    setWar(war, 1, 2);
    expect(worldPowerPressure(war)).toBeGreaterThan(0);

    const trade = worldSim([{ ind: 100, agri: 50 }, { ind: 60, agri: 80 }]);
    addRival(trade, { id: 1, commerce: 9, pop: 50000 }); // commercial surplus, peace
    expect(worldPowerPressure(trade)).toBeLessThan(0);
  });

  it('is 0 with no great powers and bounded within [−0.6, 0.6]', () => {
    const none = worldSim([{ ind: 100, agri: 50 }]);
    expect(worldPowerPressure(none)).toBe(0);

    const huge = worldSim([{ ind: 100, agri: 50 }, { ind: 60, agri: 80 }]);
    for (let i = 1; i <= 8; i++) addRival(huge, { id: i, commerce: 4.5, pop: 50000 });
    for (let i = 1; i <= 8; i++) setWar(huge, i, 100 + i);
    const p = worldPowerPressure(huge);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThanOrEqual(0.6);
  });
});

// ============================================================
// 6. determinism — identical state, identical reading
// ============================================================
describe('rival world-market tilt — determinism', () => {
  it('identical worlds (same rivals, same wars, same warming) give identical readings', () => {
    const build = (): RegionSim => {
      const r = worldSim([{ ind: 70, agri: 40 }, { ind: 0, agri: 120, faction: 99 }]);
      addRival(r, { id: 1, commerce: 9, pop: 33000 });
      addRival(r, { id: 2, commerce: 2, pop: 41000 });
      setWar(r, 2, 5);
      r.warmingC = 2.1;
      return r;
    };
    const a = build();
    const b = build();
    for (const g of ['steel', 'food', 'textiles', 'vehicles']) {
      expect(worldGoodDemand(a, g)).toBe(worldGoodDemand(b, g));
      expect(worldGoodScarcity(a, g)).toBe(worldGoodScarcity(b, g));
    }
    expect(worldPowerPressure(a)).toBe(worldPowerPressure(b));
  });
});

// ============================================================
// 7. live autoplay — the great powers are live but the economy is byte-identical
// ============================================================
describe('rival world-market tilt — live autoplay', () => {
  it('great-power pressure is finite & bounded while world tightness stays slack', () => {
    const r = RegionSim.create(1007);
    r.autoDevelopPlayer = true;
    const target = r.year + 60; // long enough for rivals to emerge (>= 1922)
    let guard = 0;
    while (r.year < target && !r.gameOver && guard < 4_000_000) {
      r.tick();
      guard++;
    }
    const pressure = r.worldPowerPressure();
    expect(Number.isFinite(pressure)).toBe(true);
    expect(pressure).toBeGreaterThanOrEqual(-0.6);
    expect(pressure).toBeLessThanOrEqual(0.6);
    // The on-map world stays self-sufficient → the tightness it clears at is slack,
    // so the great-power participation can't perturb the real economy (byte-identical).
    expect(r.worldMarketTightness()).toBe(0);
  });
});
