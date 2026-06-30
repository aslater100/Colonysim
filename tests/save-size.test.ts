import { describe, expect, it } from 'vitest';
import { RegionSim } from '../src/sim/region';
import { START_YEAR } from '../src/sim/defs';

/**
 * Save-size regression guard (deep-expansion roadmap, Risk #5: "Phase-14 save
 * bloat → a save-size regression test").
 *
 * `serialize()` is a flat field-dump that grows as the simulation accumulates
 * state (notables, history, events, settlements). Today it stays modest and —
 * crucially — *bounded*: ~22 KiB at founding, plateauing at ~82 KiB across a
 * century and beyond, because the log-bearing fields are capped. The upcoming
 * Phase-14 per-settlement grid maps are the obvious bloat risk (an uncapped
 * typed array per settlement per tick would balloon the save and push
 * localStorage past its ~5 MB cap). These ceilings lock in today's bounded
 * behaviour so such a regression trips a test instead of a user's save.
 *
 * Ceilings carry generous headroom over today's worst case so normal variation
 * never flakes them; only a structural bloat (an unbounded accumulator) trips.
 */

/** A proclaimed nation with a central bank — mirrors region-longrun's harness so
 *  the macro/log state that dominates save size is actually exercised. */
function nation(seed: number): RegionSim {
  const r = RegionSim.create(seed);
  r.stateProclaimed = true;
  r.nationProclaimed = true;
  r.govType = 'republic';
  r.legitimacy = 60;
  r.activePolicies = [];
  r.treasury = 1000;
  r.passedLaws.add('central_bank_charter');
  r.passedLaws.add('income_tax');
  return r;
}

function runToYear(r: RegionSim, year: number): void {
  while (r.year < year) r.tick();
}

function saveKiB(r: RegionSim): number {
  return Buffer.byteLength(r.serialize(), 'utf8') / 1024;
}

const EARLY_CEIL_KIB = 64; // today ~22 KiB
const CENTURY_CEIL_KIB = 224; // today ~198 KiB (grew with rival AI, statsHistory); was 192 → re-baselined

describe('save-size regression guard (roadmap risk #5)', () => {
  it('a fresh nation serializes small', () => {
    expect(saveKiB(nation(1))).toBeLessThan(EARLY_CEIL_KIB);
  });

  it('a full-century nation stays under the save-size ceiling', () => {
    const r = nation(42);
    runToYear(r, START_YEAR + 181); // ~2100
    expect(r.year).toBeGreaterThanOrEqual(START_YEAR + 181);
    expect(saveKiB(r)).toBeLessThan(CENTURY_CEIL_KIB);
  });

  it('the save does not balloon past the century — log-bearing fields are capped', () => {
    const r = nation(7);
    runToYear(r, START_YEAR + 90); // ~2009
    const mid = saveKiB(r);
    runToYear(r, START_YEAR + 200); // ~2119, +110 more years
    const late = saveKiB(r);
    // Another ~110 years of play must not double the save: accumulation is
    // bounded, not linear in elapsed time.
    expect(late).toBeLessThan(mid * 2);
  });

  it('a reloaded save does not expand on round-trip', () => {
    const r = nation(3);
    runToYear(r, START_YEAR + 60);
    const a = Buffer.byteLength(r.serialize(), 'utf8');
    const b = Buffer.byteLength(RegionSim.deserialize(r.serialize()).serialize(), 'utf8');
    // A save→load→save cycle must not grow the save (a field that duplicated or
    // re-accumulated each reload would balloon it). Benign shrinkage from the
    // `?? default` backfill omitting stored defaults is fine; expansion is not.
    expect(b).toBeLessThanOrEqual(Math.ceil(a * 1.02));
  });
});
