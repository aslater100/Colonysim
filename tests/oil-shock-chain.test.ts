import { describe, expect, it } from 'vitest';
import {
  RegionSim,
  INTERMEDIATE_GOODS,
  OIL_EMBARGO_DAYS,
  OIL_EMBARGO_CUT,
  SUPPLY_SHOCK_MAX_DRAG,
} from '../src/sim/region';
import { MINUTES_PER_DAY, DAYS_PER_YEAR, START_YEAR } from '../src/sim/defs';

/**
 * The 1970s oil-shock anchor, routed through the supply chain (GDD §5.4: "the
 * oil shock isn't a popup, it's a fuel price your trucking, plastics, and heating
 * all pay"). The anchor embargoes the `oil` raw for ~6 months — but as a *partial*
 * cut (the 1973 embargo trimmed supply and quadrupled prices, it didn't zero the
 * taps). The graded supply solver carries the fraction through: oil → fuel → the
 * fuel-burning finals all run at `1 − OIL_EMBARGO_CUT`, health dips below the era
 * baseline in proportion, and the bounded industry drag bites — until it lifts.
 */

function freshSim(seed = 7): RegionSim {
  return RegionSim.create(seed, { aiDifficulty: 'normal', currencySymbol: '$' });
}

/** Pin the reported year so era-gated goods unlock, without touching `day`. */
function pinYear(r: RegionSim, year: number): void {
  Object.defineProperty(r, 'year', { get: () => year, configurable: true });
}

/** Both extracting sectors produce, so every raw flows on the proxy — the only
 *  thing that can cut a raw in these tests is an explicit embargo. */
function flowAllRaws(r: RegionSim): void {
  for (const s of r.settlements) {
    s.sectors.industry.output = 100;
    s.sectors.agriculture.output = 100;
  }
}

/** Force the oil-shock anchor to fire by locking the clock into its window and
 *  rolling the probabilistic check many times (mirrors historical-anchors.test). */
function fireOilShock(r: RegionSim, year = 1975, times = 400): void {
  r.minute = (year - START_YEAR) * DAYS_PER_YEAR * MINUTES_PER_DAY;
  r.researched.add('combustion_engine');
  r.researched.delete('renewables');
  r.researched.delete('fusion_power');
  const priv = r as unknown as { tickHistoricalAnchors(): void };
  for (let i = 0; i < times; i++) priv.tickHistoricalAnchors();
}

/** A standing oil embargo `OIL_EMBARGO_DAYS` out at the given cut depth. */
function embargoOil(r: RegionSim, cut: number): void {
  r.rawEmbargoes['oil'] = { until: r.day + OIL_EMBARGO_DAYS, cut };
}

const N = INTERMEDIATE_GOODS.length; // 16
/** fuel + the three fuel-burning finals. */
const OIL_DEPENDENT = ['fuel', 'vehicles', 'machinery', 'consumer_goods'];

// ============================================================
// 1. The graph: fuel feeds the downstream finals (so a cut can cascade)
// ============================================================
describe('oil → fuel → downstream graph', () => {
  it('fuel is consumed by vehicles, machinery, and consumer_goods', () => {
    for (const id of ['vehicles', 'machinery', 'consumer_goods']) {
      const good = INTERMEDIATE_GOODS.find((g) => g.id === id)!;
      expect(good.inputs, `${id} should burn fuel`).toContain('fuel');
    }
  });

  it('fuel still grounds out in oil', () => {
    const fuel = INTERMEDIATE_GOODS.find((g) => g.id === 'fuel')!;
    expect(fuel.inputs).toEqual(['oil']);
  });
});

// ============================================================
// 2. A total oil embargo cascades and drags — but only oil's branch
// ============================================================
describe('total oil embargo cascade', () => {
  it('cuts fuel and the fuel-burning finals, leaving the rest supplied', () => {
    const r = freshSim();
    pinYear(r, 1975); // every good unlocked
    flowAllRaws(r);
    embargoOil(r, 1); // total cut
    r.tickIntermediateGoods();

    const snap = r.supplyChainSnapshot();
    for (const id of OIL_DEPENDENT) {
      expect(snap.disrupted.has(id), `${id} should be cut by the oil embargo`).toBe(true);
    }
    // Everything off the oil branch keeps producing.
    for (const id of ['steel', 'chemicals', 'electricity', 'components', 'electronics', 'food', 'clothing', 'tools', 'pharmaceuticals']) {
      expect(snap.supplied.has(id), `${id} should survive an oil-only cut`).toBe(true);
    }
    expect(r.getSupplyChainHealth()).toBeCloseTo((N - OIL_DEPENDENT.length) / N, 10);
  });

  it('drags industry by the bounded shortfall (severity = 4/16)', () => {
    const r = freshSim();
    pinYear(r, 1975);
    flowAllRaws(r);
    embargoOil(r, 1);
    r.tickIntermediateGoods();

    const severity = OIL_DEPENDENT.length / N; // baseline 1.0 → shortfall = actual gap
    expect(r.supplyShockSeverity()).toBeCloseTo(severity, 10);
    expect(r.supplyShockOutputMult()).toBeCloseTo(1 - severity * SUPPLY_SHOCK_MAX_DRAG, 10);
    expect(r.supplyShockOutputMult()).toBeLessThan(1); // a genuine bite …
    expect(r.supplyShockOutputMult()).toBeGreaterThan(1 - SUPPLY_SHOCK_MAX_DRAG); // … but bounded
  });

  it('heals byte-clean once the window lifts (no lingering drag)', () => {
    const r = freshSim();
    pinYear(r, 1975);
    flowAllRaws(r);
    // An embargo already past its lift day is pruned and never bites.
    r.rawEmbargoes['oil'] = { until: r.day - 1, cut: 1 };
    r.tickIntermediateGoods();

    expect(r.rawEmbargoes['oil']).toBeUndefined(); // pruned
    expect(r.getSupplyChainHealth()).toBe(1);
    expect(r.supplyShockSeverity()).toBe(0);
    expect(r.supplyShockOutputMult()).toBe(1);
  });

  it('no embargo means no shock — healthy play is untouched', () => {
    const r = freshSim();
    pinYear(r, 1975);
    flowAllRaws(r);
    r.tickIntermediateGoods();
    expect(r.getSupplyChainHealth()).toBe(1);
    expect(r.supplyShockSeverity()).toBe(0);
    expect(r.supplyShockOutputMult()).toBe(1);
  });
});

// ============================================================
// 3. A *partial* oil embargo cuts proportionally (graded availability)
// ============================================================
describe('partial oil embargo (graded cut)', () => {
  it('runs the oil branch at 1 − cut instead of zeroing it', () => {
    const r = freshSim();
    pinYear(r, 1975);
    flowAllRaws(r);
    embargoOil(r, 0.6); // oil at 40%
    r.tickIntermediateGoods();

    const snap = r.supplyChainSnapshot();
    // The oil branch is partially supplied: present in `disrupted` (level < 1) but
    // running at level 0.4, not 0.
    for (const id of OIL_DEPENDENT) {
      expect(snap.disrupted.has(id), `${id} should read disrupted`).toBe(true);
      expect(snap.levels.get(id)).toBeCloseTo(0.4, 10);
    }
    // Off-branch goods are untouched at full level.
    expect(snap.levels.get('steel')).toBe(1);
    expect(snap.levels.get('electronics')).toBe(1);
  });

  it('health and drag scale with the cut depth (shallower than a total cut)', () => {
    const r = freshSim();
    pinYear(r, 1975);
    flowAllRaws(r);
    embargoOil(r, 0.6);
    r.tickIntermediateGoods();

    // mean level = (12 full + 4 at 0.4) / 16
    const health = (12 + 4 * 0.4) / N;
    expect(r.getSupplyChainHealth()).toBeCloseTo(health, 10);
    const severity = 1 - health; // baseline 1.0
    expect(r.supplyShockSeverity()).toBeCloseTo(severity, 10);
    expect(r.supplyShockOutputMult()).toBeCloseTo(1 - severity * SUPPLY_SHOCK_MAX_DRAG, 10);

    // A partial cut is strictly milder than a total one.
    const totalSeverity = OIL_DEPENDENT.length / N;
    expect(r.supplyShockSeverity()).toBeLessThan(totalSeverity);
    expect(r.supplyShockOutputMult()).toBeGreaterThan(1 - totalSeverity * SUPPLY_SHOCK_MAX_DRAG);
  });
});

// ============================================================
// 4. The anchor wires a partial embargo when it fires
// ============================================================
describe('oil-shock anchor sets the embargo', () => {
  it('fires and stamps a partial oil embargo OIL_EMBARGO_DAYS out', () => {
    const r = freshSim();
    fireOilShock(r, 1975);
    expect((r as unknown as { oilShockFired: boolean }).oilShockFired).toBe(true);
    expect(r.rawEmbargoes['oil']).toEqual({ until: r.day + OIL_EMBARGO_DAYS, cut: OIL_EMBARGO_CUT });
    expect(r.log.some((l) => l.text.includes('OIL EMBARGO'))).toBe(true);
  });

  it('a fresh sim carries no embargoes', () => {
    const r = freshSim();
    expect(r.rawEmbargoes).toEqual({});
    expect(r.supplyChainSnapshot().embargoes).toEqual([]);
  });
});

// ============================================================
// 5. Save/load round-trips the embargo ledger (and migrates old saves)
// ============================================================
describe('oil embargo persistence', () => {
  it('serialize/deserialize preserves an active partial embargo', () => {
    const r = freshSim();
    embargoOil(r, 0.6);
    const r2 = RegionSim.deserialize(r.serialize());
    expect(r2.rawEmbargoes['oil']).toEqual({ until: r.day + OIL_EMBARGO_DAYS, cut: 0.6 });
  });

  it('a pre-embargo save backfills to an empty ledger', () => {
    const r = freshSim();
    const raw = JSON.parse(r.serialize());
    delete raw.rawEmbargoes;
    const r2 = RegionSim.deserialize(JSON.stringify(raw));
    expect(r2.rawEmbargoes).toEqual({});
  });

  it('a pre-graded save (bare until-day number) migrates to a total cut', () => {
    const r = freshSim();
    const raw = JSON.parse(r.serialize());
    raw.rawEmbargoes = { oil: r.day + OIL_EMBARGO_DAYS }; // old numeric shape
    const r2 = RegionSim.deserialize(JSON.stringify(raw));
    expect(r2.rawEmbargoes['oil']).toEqual({ until: r.day + OIL_EMBARGO_DAYS, cut: 1 });
  });
});

// ============================================================
// 6. The UI snapshot surfaces the shock
// ============================================================
describe('supplyChainSnapshot()', () => {
  it('reports the live disruption, drag, and embargo countdown with cut depth', () => {
    const r = freshSim();
    pinYear(r, 1975);
    flowAllRaws(r);
    embargoOil(r, 1);
    r.tickIntermediateGoods();

    const snap = r.supplyChainSnapshot();
    expect(snap.health).toBeCloseTo((N - OIL_DEPENDENT.length) / N, 10);
    expect(snap.outputMult).toBeLessThan(1);
    expect(snap.active.length).toBe(N);
    expect(snap.embargoes).toEqual([{ raw: 'oil', daysLeft: OIL_EMBARGO_DAYS, cut: 1 }]);
  });

  it('is a pure read — calling it does not mutate the chain', () => {
    const r = freshSim();
    pinYear(r, 2000);
    flowAllRaws(r);
    r.tickIntermediateGoods();
    const stocksBefore = JSON.stringify(r.intermediateGoodStocks);
    const healthBefore = r.getSupplyChainHealth();
    r.supplyChainSnapshot();
    r.supplyChainSnapshot();
    expect(JSON.stringify(r.intermediateGoodStocks)).toBe(stocksBefore);
    expect(r.getSupplyChainHealth()).toBe(healthBefore);
  });
});
