import { describe, it, expect } from 'vitest';
import {
  RegionSim,
  ARCHETYPE_GREEN_PROPENSITY,
  WORLD_GREEN_START_YEAR,
  WORLD_GREEN_RAMP_YEARS,
  WORLD_GREEN_MAX_CUT,
  WORLD_GREEN_URGENCY_C,
  WORLD_GREEN_BASE,
  PLAYER_GREEN_DIFFUSION,
} from '../src/sim/region';
import { RegionMap } from '../src/sim/worldgen';
import { Weather } from '../src/sim/weather';
import { Rng } from '../src/sim/rng';
import { START_YEAR, DAYS_PER_YEAR, MINUTES_PER_DAY } from '../src/sim/defs';

/**
 * Emergent world green transition — different timelines to 2100. Before this,
 * EVERY autoplay seed funnelled to the 'drowned' branch: the forces that bend the
 * warming curve (green tech, carbon laws, climate accords) are all player-driven,
 * and the autoplay player never even becomes a nation, so the world ran a
 * pure-fossil rail to ~5 °C every run. Now the rival WORLD decarbonizes on its own
 * at a rate set by its archetype mix (deterministic, seed-varying), the verdict
 * credits a transitioning world's mitigation, and the era branch diverges across
 * seeds. No new RNG, no new serialized field → determinism/save-size stay green.
 */

type Rival = { id: number; archetype: string; pop: number; treaties: string[] };
type Priv = {
  archetypeGreenShare: () => number;
  worldGreenShare: () => number;
  worldEmissions: () => number;
  playerEmissions: () => number;
  rivals: Rival[];
  warmingC: number;
  minute: number;
};
const priv = (r: RegionSim) => r as unknown as Priv;

function colony(seed: number): RegionSim {
  return RegionSim.foundColony(new Rng(seed), new RegionMap(seed), new Weather(seed), {});
}
/** Force the sim clock to a given world-year (year derives from `minute`). */
function setYear(r: RegionSim, year: number): void {
  priv(r).minute = (year - START_YEAR) * DAYS_PER_YEAR * MINUTES_PER_DAY;
}
function setRivals(r: RegionSim, archetypes: string[], pop = 1000): void {
  priv(r).rivals = archetypes.map((a, i) => ({ id: i, archetype: a, pop, treaties: [] }));
}

/** Reference for worldGreenShare (mirrors the private method). */
function refShare(ceiling: number, year: number, warmingC: number): number {
  const ramp = Math.max(0, Math.min(1, (year - WORLD_GREEN_START_YEAR) / WORLD_GREEN_RAMP_YEARS));
  const urgency = Math.max(0, Math.min(1, warmingC / WORLD_GREEN_URGENCY_C));
  return ceiling * ramp * (WORLD_GREEN_BASE + (1 - WORLD_GREEN_BASE) * urgency);
}

// ---- 1. archetypeGreenShare — the deterministic, seed-varying dial ----

describe('archetypeGreenShare — the rival mix sets the ceiling', () => {
  it('is the mean per-archetype propensity', () => {
    const r = colony(7);
    setRivals(r, ['trading_republic', 'hegemon']);
    expect(priv(r).archetypeGreenShare()).toBeCloseTo(
      (ARCHETYPE_GREEN_PROPENSITY.trading_republic + ARCHETYPE_GREEN_PROPENSITY.hegemon) / 2, 9,
    );
  });

  it('a greener rival world has a higher ceiling than a dirtier one', () => {
    const green = colony(7); setRivals(green, ['trading_republic', 'crusader_state']);
    const dirty = colony(7); setRivals(dirty, ['hegemon', 'hermit_kingdom']);
    expect(priv(green).archetypeGreenShare()).toBeGreaterThan(priv(dirty).archetypeGreenShare());
  });

  it('defaults to a middling 0.4 when no rivals exist', () => {
    const r = colony(7); setRivals(r, []);
    expect(priv(r).archetypeGreenShare()).toBe(0.4);
  });
});

// ---- 2. worldGreenShare — ramps from the start year, urged by warming ----

describe('worldGreenShare — emergent transition curve', () => {
  it('is zero before the transition start year', () => {
    const r = colony(7); setRivals(r, ['trading_republic']);
    setYear(r, WORLD_GREEN_START_YEAR - 5); priv(r).warmingC = 1.0;
    expect(priv(r).worldGreenShare()).toBe(0);
  });

  it('matches the reference curve and is bounded by the ceiling', () => {
    const r = colony(7); setRivals(r, ['trading_republic', 'opportunist']); // ceiling 0.75
    const ceiling = priv(r).archetypeGreenShare();
    setYear(r, 2040); priv(r).warmingC = 1.2;
    expect(priv(r).worldGreenShare()).toBeCloseTo(refShare(ceiling, 2040, 1.2), 9);
    expect(priv(r).worldGreenShare()).toBeLessThanOrEqual(ceiling);
  });

  it('rises with both the calendar and the climate crisis (warming urgency)', () => {
    const r = colony(7); setRivals(r, ['crusader_state']);
    setYear(r, 2000); priv(r).warmingC = 0.5; const early = priv(r).worldGreenShare();
    setYear(r, 2030); const later = priv(r).worldGreenShare();
    expect(later).toBeGreaterThan(early); // calendar ramp
    priv(r).warmingC = 2.5; const urged = priv(r).worldGreenShare();
    expect(urged).toBeGreaterThan(later); // warming urgency
  });
});

// ---- 3. worldEmissions / playerEmissions — the transition cuts the chimneys ----

describe('emissions fall as the world greens', () => {
  it('a greener rival world emits less than a dirtier one, all else equal', () => {
    const green = colony(7); setRivals(green, ['trading_republic', 'crusader_state']);
    const dirty = colony(7); setRivals(dirty, ['hegemon', 'hermit_kingdom']);
    for (const r of [green, dirty]) { setYear(r, 2040); priv(r).warmingC = 2.0; }
    expect(priv(green).worldEmissions()).toBeLessThan(priv(dirty).worldEmissions());
  });

  it('proven clean tech diffuses into a passive player (player emissions fall as the world greens)', () => {
    const r = colony(7); setRivals(r, ['trading_republic', 'crusader_state']);
    setYear(r, WORLD_GREEN_START_YEAR - 5); priv(r).warmingC = 0; // share 0
    const noTransition = priv(r).playerEmissions();
    setYear(r, 2040); priv(r).warmingC = 2.0; // share high
    const withTransition = priv(r).playerEmissions();
    expect(withTransition).toBeLessThan(noTransition);
    // bounded by the diffusion cap (the world can't zero a passive player's chimneys)
    expect(withTransition).toBeGreaterThan(noTransition * (1 - PLAYER_GREEN_DIFFUSION - 1e-9));
    expect(WORLD_GREEN_MAX_CUT).toBeGreaterThan(0); // sanity: the world cut is engaged
  });
});

// ---- 4. The payoff: different timelines to 2100, deterministically ----

describe('era branch — divergent timelines', () => {
  const SEEDS = [1000, 1007, 1014, 1021, 1028, 1035, 1042, 1049];

  function branchOf(seed: number): string {
    const r = RegionSim.create(seed);
    let t = 0;
    while (r.year < 2100 && !r.gameOver && t < 20_000_000) { r.tick(); t++; }
    return r.eraBranch ?? 'none';
  }

  it('produces at least two distinct branches across seeds (no longer always drowned)', () => {
    const branches = SEEDS.map(branchOf);
    const distinct = new Set(branches);
    expect(distinct.size, `branches=${JSON.stringify(branches)}`).toBeGreaterThanOrEqual(2);
  });

  it('is deterministic — the same seed always reaches the same branch', () => {
    expect(branchOf(1021)).toBe(branchOf(1021));
  });
});
