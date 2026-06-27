import { describe, expect, it } from 'vitest';
import { RegionSim } from '../src/sim/region';

/**
 * Full-state determinism harness (roadmap Track C guard). The long-run guard
 * compares only eight compounding scalars; this compares the ENTIRE serialized
 * state, byte for byte, across two independent same-seed runs at several
 * century checkpoints. That is the gate the `region.ts` modularization leans on:
 * extracting a tick subsystem to a free function must not move a single
 * serialized byte, and this test proves it (a free-function extraction that
 * shifted an RNG draw or reordered state would diverge here long before the
 * coarse scalar snapshot noticed).
 *
 * In-process by design — both runs share one V8, so the non-correctly-rounded
 * transcendentals (Math.pow/sin/cos used in worldgen/combat) agree, and the
 * test is robust across Node versions. It does NOT pin a cross-environment
 * golden hash (which those transcendentals would make flaky); it pins
 * determinism and load-stability, which is what the extractions need.
 */

/** A proclaimed nation with the monetary machinery on — the same fixture the
 *  long-run guard uses, so the two guards exercise an identical configuration. */
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

/** Spread across eras: pre-WWII, post-war, information age, near the era fork. */
const CHECKPOINTS = [1925, 1955, 1995, 2035];

describe('serialize() determinism harness (Track C guard)', () => {
  for (const seed of [1000, 2024, 7]) {
    it(`is byte-identical across two same-seed runs at every checkpoint (seed ${seed})`, () => {
      const a = nation(seed);
      const b = nation(seed);
      for (const yr of CHECKPOINTS) {
        runToYear(a, yr);
        runToYear(b, yr);
        // Full serialized state, not a scalar digest — any RNG-order or state
        // divergence anywhere in the save surfaces here.
        expect(a.serialize(), `divergence at ${yr} (seed ${seed})`).toBe(b.serialize());
      }
    });
  }

  it('a reloaded save is a fixed point (load → save → load → save is stable)', () => {
    const r = nation(1000);
    runToYear(r, 1980);
    // The canonical (post-load) form must round-trip losslessly: a player who
    // loads and re-saves never sees the save drift. (A raw in-play serialize can
    // legitimately omit never-set optional fields that load back-fills, so the
    // fixed point is the post-load form, not the in-play one.)
    const once = RegionSim.deserialize(r.serialize()).serialize();
    const twice = RegionSim.deserialize(once).serialize();
    expect(twice).toBe(once);
  });

  it('a reloaded save keeps ticking identically to the original (load preserves ALL tick state)', () => {
    const a = nation(2024);
    runToYear(a, 1960);
    const reload = RegionSim.deserialize(a.serialize());
    runToYear(a, 1990);
    runToYear(reload, 1990);
    // Compare CANONICAL (post-load) forms so benign format differences (key order,
    // never-set optional fields) can't mask the real question: did the reload carry
    // every byte of tick-affecting state forward? This is the test that caught the
    // unserialized one-month-lagged supply-shock caches (supplyShockMult /
    // _electronicsDisrupted) — without them a mid-shock reload diverged here.
    const canonical = (r: RegionSim): string => RegionSim.deserialize(r.serialize()).serialize();
    expect(canonical(reload)).toBe(canonical(a));
  });

  it('distinct seeds produce distinct serialized state (the run is seed-driven)', () => {
    const a = nation(7);
    const b = nation(99);
    runToYear(a, 1980);
    runToYear(b, 1980);
    expect(a.serialize()).not.toBe(b.serialize());
  });
});
