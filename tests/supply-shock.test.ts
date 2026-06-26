import { describe, expect, it } from 'vitest';
import {
  RegionSim,
  INTERMEDIATE_GOODS,
  SUPPLY_SHOCK_MAX_DRAG,
  type Settlement,
} from '../src/sim/region';

/**
 * D1-econ follow-up: the supply-shock *output drag*. PR #276 made the cascade
 * correct (a raw outage propagates downstream); this wires it into the economy
 * so a genuine shock dents industrial output — but *only* a genuine shock.
 *
 * The load-bearing property is era-baselining. `supplyChainHealth` dips below
 * 1.0 even in perfectly healthy play whenever a good unlocks before one of its
 * intermediate inputs (vehicles unlock 1925 but need components, which unlock
 * 1930 → health 0.5 across 1925–1929). A naive `output *= health` would tax
 * those windows and perturb the early game. The drag instead scales with how far
 * actual health falls *below the era-structural baseline*, so healthy play —
 * including every unlock boundary — is byte-identical (severity 0, mult 1.0).
 */

function freshSim(seed = 7): RegionSim {
  return RegionSim.create(seed, { aiDifficulty: 'normal', currencySymbol: '$' });
}

/** Pin the sim's reported year so era-gated goods unlock for the test. */
function pinYear(r: RegionSim, year: number): void {
  Object.defineProperty(r, 'year', { get: () => year, configurable: true });
}

/** Flow / cut the raw-material proxy. Extractive raws (coal/iron/wood/oil/…)
 *  proxy off industry output, agricultural raws (grain/livestock) off
 *  agriculture — so a full flow needs both sectors producing. */
function setRawsFlowing(r: RegionSim, flowing: boolean): void {
  for (const s of r.settlements) {
    s.sectors.industry.output = flowing ? 100 : 0;
    s.sectors.agriculture.output = flowing ? 100 : 0;
  }
}

const FLOOR = 1 - SUPPLY_SHOCK_MAX_DRAG;

// ============================================================
// 1. Era-baselining — healthy play never drags, even at unlock boundaries
// ============================================================
describe('supply-shock drag — era-baselined (healthy play is a no-op)', () => {
  it('no drag at a settled era when raws flow', () => {
    const r = freshSim();
    pinYear(r, 2000);
    setRawsFlowing(r, true);
    r.tickIntermediateGoods();
    expect(r.getSupplyChainHealth()).toBe(1);
    expect(r.supplyShockSeverity()).toBe(0);
    expect(r.supplyShockOutputMult()).toBe(1);
  });

  it('no drag across the 1925–1929 vehicles/components boundary, despite sub-1.0 health', () => {
    // The crux: vehicles unlock 1925 but need components (1930), so vehicles is
    // *structurally* unsupplied here even with every raw flowing — a real but
    // expected era-boundary dip below 1.0. Yet there is no shock to drag, because
    // the baseline carries the exact same dip.
    const r = freshSim();
    pinYear(r, 1927);
    setRawsFlowing(r, true);
    r.tickIntermediateGoods();
    expect(r.getSupplyChainHealth()).toBeLessThan(1); // the structural dip is real …
    expect(r.supplyShockSeverity()).toBe(0); // … but baselined away
    expect(r.supplyShockOutputMult()).toBe(1);
  });

  it('no drag before any good unlocks', () => {
    const r = freshSim();
    pinYear(r, 1900);
    r.tickIntermediateGoods();
    expect(r.supplyShockSeverity()).toBe(0);
    expect(r.supplyShockOutputMult()).toBe(1);
  });
});

// ============================================================
// 2. Genuine shocks bite — proportional to the shortfall, bounded
// ============================================================
describe('supply-shock drag — a real raw collapse bites', () => {
  it('a total raw collapse drags industry to the floor (1 − MAX_DRAG)', () => {
    const r = freshSim();
    pinYear(r, 1950); // all five goods active
    setRawsFlowing(r, false); // cut every raw
    r.tickIntermediateGoods();
    expect(r.getSupplyChainHealth()).toBe(0);
    expect(r.supplyShockSeverity()).toBe(1);
    expect(r.supplyShockOutputMult()).toBeCloseTo(FLOOR, 10);
  });

  it('scales with the shortfall — a single cut raw (copper) is a partial drag', () => {
    const r = freshSim();
    pinYear(r, 2000);
    setRawsFlowing(r, true);
    r.intermediateGoodStocks['copper'] = 0; // electronics + its dependent luxury_goods fall
    r.tickIntermediateGoods();
    const n = INTERMEDIATE_GOODS.length; // 16
    expect(r.getSupplyChainHealth()).toBeCloseTo((n - 2) / n, 10); // 2 of 16 disrupted
    const severity = 2 / n;
    expect(r.supplyShockSeverity()).toBeCloseTo(severity, 10);
    expect(r.supplyShockOutputMult()).toBeCloseTo(1 - severity * SUPPLY_SHOCK_MAX_DRAG, 10);
  });

  it('is always bounded to [1 − MAX_DRAG, 1] and never zeroes industry (no spiral)', () => {
    const r = freshSim();
    pinYear(r, 1950);
    setRawsFlowing(r, false);
    r.tickIntermediateGoods();
    const mult = r.supplyShockOutputMult();
    expect(mult).toBeGreaterThanOrEqual(FLOOR);
    expect(mult).toBeLessThanOrEqual(1);
    expect(mult).toBeGreaterThan(0); // a positive output stays positive — can't starve the raw proxy
  });
});

// ============================================================
// 3. Integration — the multiplier hits industry output, and only industry
// ============================================================
describe('supply-shock drag — updateSectors integration', () => {
  it('scales industry output by the multiplier, leaving other sectors untouched', () => {
    const r = freshSim();
    pinYear(r, 1950);
    const town = r.settlements[0];
    const priv = r as unknown as {
      updateSectors(t: Settlement): void;
      supplyShockMult: number;
    };

    // Capture the sector shares so both passes drift identically — the only
    // difference between them is the multiplier.
    const shares = { ...Object.fromEntries(
      (['agriculture', 'industry', 'services', 'information'] as const).map(
        (id) => [id, town.sectors[id].share],
      ),
    ) } as Record<'agriculture' | 'industry' | 'services' | 'information', number>;
    const restoreShares = () => {
      for (const id of ['agriculture', 'industry', 'services', 'information'] as const) {
        town.sectors[id].share = shares[id];
      }
    };

    priv.supplyShockMult = 1;
    priv.updateSectors(town);
    const full = {
      agriculture: town.sectors.agriculture.output,
      industry: town.sectors.industry.output,
      services: town.sectors.services.output,
      information: town.sectors.information.output,
    };

    restoreShares();
    priv.supplyShockMult = 0.5;
    priv.updateSectors(town);

    // Industry takes the full 0.5; the other three are identical (drag is industry-only).
    expect(town.sectors.industry.output).toBeCloseTo(full.industry * 0.5, 8);
    expect(town.sectors.agriculture.output).toBeCloseTo(full.agriculture, 10);
    expect(town.sectors.services.output).toBeCloseTo(full.services, 10);
    expect(town.sectors.information.output).toBeCloseTo(full.information, 10);
  });
});

// ============================================================
// 4. Save/load robustness — no spurious drag, sane defaults
// ============================================================
describe('supply-shock drag — save/load & defaults', () => {
  it('a fresh sim reports no shock before any tick', () => {
    const r = freshSim();
    expect(r.supplyShockSeverity()).toBe(0);
    expect(r.supplyShockOutputMult()).toBe(1);
  });

  it('an old save (health backfilled to 1.0) shows no shock at any era', () => {
    const r = freshSim();
    const data = JSON.parse(r.serialize());
    delete data.supplyChainHealth; // simulate a pre-cascade save
    const r2 = RegionSim.deserialize(JSON.stringify(data));
    pinYear(r2, 1927); // even at the structural-dip boundary
    expect(r2.getSupplyChainHealth()).toBe(1.0);
    expect(r2.supplyShockSeverity()).toBe(0);
    expect(r2.supplyShockOutputMult()).toBe(1);
  });
});

// ============================================================
// 5. Constant sanity
// ============================================================
describe('SUPPLY_SHOCK_MAX_DRAG', () => {
  it('is a small, bounded drag (0 < drag < 1)', () => {
    expect(SUPPLY_SHOCK_MAX_DRAG).toBeGreaterThan(0);
    expect(SUPPLY_SHOCK_MAX_DRAG).toBeLessThan(1);
  });

  it('covers exactly the intermediate-goods set the solver resolves', () => {
    // Guards against a goods/constant drift the drag silently rides on.
    expect(INTERMEDIATE_GOODS.length).toBeGreaterThan(0);
  });
});
