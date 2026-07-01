import { describe, expect, it } from 'vitest';
import { RegionSim, REGION_BUILDINGS } from '../src/sim/region';
import { updateConstruction } from '../src/sim/systems/construction';
import { RegionMap } from '../src/sim/worldgen';
import { Weather } from '../src/sim/weather';
import { Rng } from '../src/sim/rng';

/**
 * Spatial-4X Phase D slice 1 — Wonders. One-per-EMPIRE buildings whose effect
 * applies to EVERY town of the owner (`empireBonus`/`empireSector`), grant
 * prestige on completion, and cannot be raised twice anywhere (`wonderOwner`).
 * Player-buildable; the rival build-race is a later slice. Effect is 0 until a
 * wonder is built, so a game with no wonders is byte-identical to base.
 */

function colony(seed: number): RegionSim {
  const r = RegionSim.foundColony(new Rng(seed), new RegionMap(seed), new Weather(seed), {});
  r.treasury = 1_000_000;
  r.settlements[0].factionId = r.playerFactionId; // founding town is the player's
  return r;
}

// REGION_MINUTES_PER_TICK = 30, MINUTES_PER_DAY = 1440 → 48 ticks/day; a month
// (monthlyUpdate fires every 30 days) is 30 × 48 = 1440 ticks.
function advanceMonth(r: RegionSim): void {
  for (let i = 0; i < 1440; i++) r.tick();
}

// White-box access to the private wonder effect + the construction resolver.
type Priv = {
  wonderBonus: (t: { factionId: number }, sector: string) => number;
};
const priv = (r: RegionSim) => r as unknown as Priv;

/** Break ground on a wonder and fast-forward it to completion (no clock skip:
 *  set the project done, then resolve construction in place). */
function buildAndComplete(r: RegionSim, wonderId: string): boolean {
  const t = r.settlements[0];
  if (!r.buildCity(t.id, wonderId)) return false;
  if (t.construction) t.construction.doneDay = 0; // 0 ≤ day → completes on resolve
  updateConstruction(r);
  return r.wonderOwner[wonderId] !== undefined;
}

const GRANARY = REGION_BUILDINGS.find((b) => b.id === 'great_granary')!;
const LIBRARY = REGION_BUILDINGS.find((b) => b.id === 'great_library')!;
const MONUMENT = REGION_BUILDINGS.find((b) => b.id === 'centuria_monument')!;

// ---- 1. The roster is well-formed (wonders route effect through empireBonus) ----

describe('Wonders — catalog discipline', () => {
  it('every unique wonder has empireBonus/empireSector/prestige and local bonus 0', () => {
    const wonders = REGION_BUILDINGS.filter((b) => b.unique);
    expect(wonders.length).toBeGreaterThanOrEqual(5);
    for (const w of wonders) {
      expect(w.max, `${w.id} max`).toBe(1);
      expect(w.bonus, `${w.id} local bonus must be 0 (effect rides empireBonus)`).toBe(0);
      expect(typeof w.empireBonus, `${w.id} empireBonus`).toBe('number');
      expect(w.empireSector, `${w.id} empireSector`).toBeDefined();
      expect(w.prestige, `${w.id} prestige`).toBeGreaterThan(0);
      expect(w.empireBonus!, `${w.id} empireBonus bounded`).toBeLessThanOrEqual(0.3);
    }
  });
});

// ---- 2. Ownership + empire-wide uniqueness ----

describe('Wonders — one per empire', () => {
  it('completing a wonder records empire ownership', () => {
    const r = colony(42);
    expect(buildAndComplete(r, 'great_granary')).toBe(true);
    expect(r.wonderOwner['great_granary']).toBe(r.playerFactionId);
    expect(r.settlements[0].buildings).toContain('great_granary');
  });

  it('a wonder standing elsewhere in the empire is rejected by the empire cap', () => {
    const r = colony(42);
    // The wonder exists in another town (which this town has NOT built): the
    // per-city cap passes, but the empire-wide cap still rejects it.
    r.wonderOwner['great_granary'] = r.playerFactionId;
    const check = r.cityBuildCheck(r.settlements[0], GRANARY);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/already stands/i);
  });
});

// ---- 3. Prestige ----

describe('Wonders — prestige', () => {
  it('prestige accrues to the player on completion and accumulates', () => {
    const r = colony(7);
    expect(r.prestige).toBe(0);
    buildAndComplete(r, 'great_granary');
    expect(r.prestige).toBe(GRANARY.prestige);
    r.researched.add('public_education');
    buildAndComplete(r, 'great_library');
    expect(r.prestige).toBe(GRANARY.prestige! + LIBRARY.prestige!);
  });
});

// ---- 4. The effect is empire-wide (faction-keyed, not host-keyed) ----

describe('Wonders — empire-wide effect', () => {
  it('wonderBonus applies to any town of the owner and only the wonder’s sector', () => {
    const r = colony(1);
    buildAndComplete(r, 'great_granary');
    const ownTown = { factionId: r.playerFactionId };
    const rivalTown = { factionId: r.playerFactionId + 1 };
    expect(priv(r).wonderBonus(ownTown, 'agriculture')).toBeCloseTo(GRANARY.empireBonus!, 12);
    expect(priv(r).wonderBonus(ownTown, 'industry')).toBe(0); // wrong sector
    expect(priv(r).wonderBonus(rivalTown, 'agriculture')).toBe(0); // wrong faction
  });

  it('the all-sector monument boosts every sector', () => {
    const r = colony(3);
    r.researched.add('statecraft');
    buildAndComplete(r, 'centuria_monument');
    const own = { factionId: r.playerFactionId };
    for (const s of ['agriculture', 'industry', 'services', 'information']) {
      expect(priv(r).wonderBonus(own, s)).toBeCloseTo(MONUMENT.empireBonus!, 12);
    }
  });
});

// ---- 5. Re-express-then-add: no wonders → zero effect (byte-identical base) ----

describe('Wonders — inert until built', () => {
  it('wonderBonus is 0 for every sector when no wonder stands', () => {
    const r = colony(2024);
    const t = { factionId: r.playerFactionId };
    for (const s of ['agriculture', 'industry', 'services', 'information']) {
      expect(priv(r).wonderBonus(t, s)).toBe(0);
    }
    expect(Object.keys(r.wonderOwner).length).toBe(0);
  });

  it('a non-unique building never touches wonderOwner', () => {
    const r = colony(11);
    buildAndComplete(r, 'grain_exchange'); // ordinary building
    expect(Object.keys(r.wonderOwner).length).toBe(0);
  });
});

// ---- 6. Integration: the empire bonus flows into sector output ----

describe('Wonders — integration with the economy', () => {
  it('a granary lifts agriculture output across the run (built > unbuilt)', () => {
    const withW = colony(5);
    const without = colony(5);
    advanceMonth(withW);
    advanceMonth(without);
    expect(buildAndComplete(withW, 'great_granary')).toBe(true);
    advanceMonth(withW);
    advanceMonth(without);
    const a = withW.settlements[0].sectors.agriculture.output;
    const b = without.settlements[0].sectors.agriculture.output;
    expect(a).toBeGreaterThan(b);
    expect(Number.isFinite(a)).toBe(true);
  });
});

// ---- 7. Prerequisite gating ----

describe('Wonders — tech gating', () => {
  it('the Great Library needs public_education', () => {
    const r = colony(8);
    expect(r.cityBuildCheck(r.settlements[0], LIBRARY).ok).toBe(false);
    r.researched.add('public_education');
    expect(r.cityBuildCheck(r.settlements[0], LIBRARY).ok).toBe(true);
  });
});

// ---- 8. Serialization round-trip + discipline ----

describe('Wonders — serialize round-trip', () => {
  it('wonderOwner + prestige survive a save/load and the run keeps ticking', () => {
    const r = colony(1000);
    buildAndComplete(r, 'great_granary');
    const json = r.serialize();
    expect(json).toContain('great_granary');
    expect(json).not.toContain('_tileYieldCache'); // transient cache never serialized
    const back = RegionSim.deserialize(json);
    expect(back.wonderOwner['great_granary']).toBe(r.playerFactionId);
    expect(back.prestige).toBe(r.prestige);
    expect(() => advanceMonth(back)).not.toThrow();
    expect(back.settlements[0].sectors.agriculture.output).toBeGreaterThan(0);
  });

  it('an old save with no wonderOwner/prestige backfills to empty/0', () => {
    const r = colony(1001);
    const raw = JSON.parse(r.serialize());
    delete raw.wonderOwner;
    delete raw.prestige;
    const back = RegionSim.deserialize(JSON.stringify(raw));
    expect(back.wonderOwner).toEqual({});
    expect(back.prestige).toBe(0);
  });
});

// ---- 9. Determinism ----

describe('Wonders — determinism', () => {
  it('two same-seed runs that build the same wonder reach identical state', () => {
    const a = colony(2024);
    const b = colony(2024);
    buildAndComplete(a, 'great_granary');
    buildAndComplete(b, 'great_granary');
    advanceMonth(a);
    advanceMonth(b);
    expect(a.wonderOwner).toEqual(b.wonderOwner);
    expect(a.prestige).toBe(b.prestige);
    expect(a.serialize()).toBe(b.serialize());
  });
});

// ---- 10. Century report telemetry ----

describe('Wonders — century report', () => {
  it('reports player wonder count + prestige', () => {
    const r = colony(77);
    buildAndComplete(r, 'great_granary');
    (r as unknown as { buildCenturyReport: () => void }).buildCenturyReport();
    expect(r.centuryReport).toBeTruthy();
    expect(r.centuryReport!.wonders).toBe(1);
    expect(r.centuryReport!.prestige).toBe(GRANARY.prestige);
  });
});
