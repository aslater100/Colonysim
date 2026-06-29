import { describe, it, expect } from 'vitest';
import { RegionSim, REGION_MINUTES_PER_TICK } from '../src/sim/region';
import { RegionMap } from '../src/sim/worldgen';
import { Weather } from '../src/sim/weather';
import { Rng } from '../src/sim/rng';
import { MINUTES_PER_DAY } from '../src/sim/defs';

/**
 * Wagner-style rival treasury sink. Rivals run the player's real economy (6% tax
 * on their towns' sector output) but lack the player's policy/services/welfare/
 * central-bank spending, so without a recurring drain they bank nearly the whole
 * take and balloon to ~2 months of (enormous) late-game output. The sink spends
 * down only the SURPLUS above a prudent reserve that scales with the economy, and
 * STANDS DOWN below that reserve — because the rival treasury is also the famine
 * shock-absorber (emergency grain is paid from the faction purse, and late-game
 * climate warming drives widespread starvation). A flat output-share charge that
 * fired during a crisis drained the purse to 0 and collapsed the population; the
 * reserve-skim never touches the buffer the rival needs to feed its people.
 *
 * Tuning constants mirrored from region.ts (not exported):
 *   RIVAL_RESERVE_MONTHS = 1.5, RIVAL_SURPLUS_SKIM = 0.25, RIVAL_ADMIN_PER_TOWN = 5
 */
const RESERVE_MONTHS = 1.5;
const SKIM = 0.25;
const ADMIN = 5;

type Faction = { settlementIds: number[]; treasury: number };
type Priv = {
  rivalStateCost: (f: Faction, output: number, periodMonths: number) => number;
};
const priv = (r: RegionSim) => r as unknown as Priv;

/** Reference implementation of the formula under test (for explicit expectations). */
function expectedCost(towns: number, treasury: number, output: number, period: number): number {
  const surplus = Math.max(0, treasury - output * RESERVE_MONTHS);
  const monthly = surplus * SKIM + towns * ADMIN;
  return Math.max(0, Math.min(treasury, Math.round(monthly * period)));
}

function sim(seed = 7): RegionSim {
  return RegionSim.foundColony(new Rng(seed), new RegionMap(seed), new Weather(seed), {});
}
/** A bare faction shape — rivalStateCost only reads `settlementIds.length` + `treasury`. */
const fac = (towns: number, treasury: number): Faction => ({
  settlementIds: Array.from({ length: towns }, (_, i) => i),
  treasury,
});

const ticksPerDay = MINUTES_PER_DAY / REGION_MINUTES_PER_TICK;
function runDays(r: RegionSim, days: number): void {
  for (let i = 0; i < days * ticksPerDay; i++) r.tick();
}

describe('rivalStateCost — Wagner reserve-skim sink', () => {
  it('is finite, non-negative, and matches the reference formula across a grid', () => {
    const r = sim();
    for (const out of [0, 100, 2_500, 50_000, 1_000_000]) {
      for (const treas of [0, 50, 100_000, 5_000_000]) {
        for (const towns of [0, 1, 5, 30]) {
          for (const period of [1, 2.7]) {
            const c = priv(r).rivalStateCost(fac(towns, treas), out, period);
            expect(Number.isFinite(c)).toBe(true);
            expect(c).toBeGreaterThanOrEqual(0);
            expect(c).toBe(expectedCost(towns, treas, out, period));
          }
        }
      }
    }
  });

  it('stands down to ADMIN-only when the treasury is below the output-scaled reserve (a crisis)', () => {
    const r = sim();
    const out = 100_000; // reserve = 150_000
    // A famine-strapped rival sitting below its reserve: no surplus → skim off.
    const c = priv(r).rivalStateCost(fac(8, 90_000), out, 1);
    expect(c).toBe(8 * ADMIN); // only flat admin — the famine buffer is untouched
  });

  it('skims the surplus ABOVE the reserve (plus admin) when flush', () => {
    const r = sim();
    const out = 100_000; // reserve = 150_000
    const treasury = 400_000; // surplus = 250_000
    const c = priv(r).rivalStateCost(fac(4, treasury), out, 1);
    expect(c).toBe(Math.round(250_000 * SKIM + 4 * ADMIN));
  });

  it('the reserve scales with output, so a bigger economy keeps a bigger buffer', () => {
    const r = sim();
    const treasury = 200_000;
    // Same treasury: a small economy sees it as surplus (skims), a large one as reserve (stands down).
    const small = priv(r).rivalStateCost(fac(3, treasury), 50_000, 1); // reserve 75k → surplus 125k
    const large = priv(r).rivalStateCost(fac(3, treasury), 300_000, 1); // reserve 450k → no surplus
    expect(small).toBeGreaterThan(large);
    expect(large).toBe(3 * ADMIN);
  });

  it('never charges more than the treasury (cannot drive it negative)', () => {
    const r = sim();
    // Tiny treasury, many towns: flat admin alone would exceed it → clamped to treasury.
    const c = priv(r).rivalStateCost(fac(50, 30), 0, 1);
    expect(c).toBeLessThanOrEqual(30);
    expect(c).toBeGreaterThanOrEqual(0);
  });

  it('scales linearly with the update period (cadence-independent)', () => {
    const r = sim();
    const f = fac(4, 400_000);
    const one = priv(r).rivalStateCost(f, 100_000, 1);
    const three = priv(r).rivalStateCost(f, 100_000, 3);
    expect(three).toBe(one * 3);
  });

  it('admin scales with the number of settlements', () => {
    const r = sim();
    const out = 100_000;
    const treas = 90_000; // below reserve → admin-only, isolating the admin term
    expect(priv(r).rivalStateCost(fac(2, treas), out, 1)).toBe(2 * ADMIN);
    expect(priv(r).rivalStateCost(fac(10, treas), out, 1)).toBe(10 * ADMIN);
  });

  it('caps a ballooned hoard near the reserve (surplus decays under repeated skims, never starved below it)', () => {
    const r = sim();
    const out = 100_000;
    const reserve = out * RESERVE_MONTHS;
    let treasury = 2_000_000; // a ballooned hoard, income held flat at 0 to isolate the skim
    for (let i = 0; i < 80; i++) {
      treasury -= priv(r).rivalStateCost(fac(5, treasury), out, 1);
    }
    expect(treasury).toBeLessThan(reserve * 1.1); // pulled down to the reserve…
    expect(treasury).toBeGreaterThan(reserve * 0.5); // …but the skim stood down, never starving it
  });
});

describe('rival economy stays a going concern under the sink', () => {
  it('rivals remain populous and solvent through mid-century (no death-spiral)', () => {
    const r = sim(1);
    runDays(r, 81 * 365); // to ~year 2000
    const rivals = r.regionalFactions.filter((f) => f.id !== r.playerFactionId);
    let pop = 0, treas = 0, out = 0, towns = 0;
    for (const f of rivals) {
      treas += f.treasury;
      towns += f.settlementIds.length;
      for (const id of f.settlementIds) {
        const t = r.settlement(id);
        if (t) { pop += r.popOf(t); out += r.sectorOutputOf(t); }
      }
    }
    // Going concern: rivals still hold territory and people (the bad sink collapsed pop to ~300).
    expect(towns).toBeGreaterThan(3);
    expect(pop).toBeGreaterThan(5_000);
    // Bounded: the treasury no longer balloons unboundedly relative to its economy.
    expect(treas).toBeLessThan(out * RESERVE_MONTHS * 2);
  });
});
