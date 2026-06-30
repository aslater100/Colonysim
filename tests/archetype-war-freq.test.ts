import { describe, it, expect } from 'vitest';
import { ARCHETYPE_WAR_FREQ_MULT, ARCHETYPE_GREEN_PROPENSITY } from '../src/sim/region';
import type { RivalArchetype } from '../src/sim/region';

/**
 * ARCHETYPE_WAR_FREQ_MULT tuning tests.
 *
 * Hegemons are warmongers; hermits and traders avoid war;
 * crusaders and opportunists fall in between.
 */

const ARCHETYPES: RivalArchetype[] = [
  'hegemon', 'trading_republic', 'hermit_kingdom', 'crusader_state', 'opportunist',
];

describe('ARCHETYPE_WAR_FREQ_MULT', () => {
  it('has an entry for every RivalArchetype', () => {
    for (const a of ARCHETYPES) {
      expect(ARCHETYPE_WAR_FREQ_MULT[a]).toBeDefined();
    }
  });

  it('all values are positive and finite', () => {
    for (const a of ARCHETYPES) {
      expect(ARCHETYPE_WAR_FREQ_MULT[a]).toBeGreaterThan(0);
      expect(isFinite(ARCHETYPE_WAR_FREQ_MULT[a])).toBe(true);
    }
  });

  it('hegemon is the most war-prone (highest mult)', () => {
    const hegeMonMult = ARCHETYPE_WAR_FREQ_MULT.hegemon;
    for (const a of ARCHETYPES) {
      if (a === 'hegemon') continue;
      expect(hegeMonMult).toBeGreaterThanOrEqual(ARCHETYPE_WAR_FREQ_MULT[a]);
    }
  });

  it('hermit_kingdom is the least war-prone (lowest mult)', () => {
    const hermitMult = ARCHETYPE_WAR_FREQ_MULT.hermit_kingdom;
    for (const a of ARCHETYPES) {
      if (a === 'hermit_kingdom') continue;
      expect(hermitMult).toBeLessThanOrEqual(ARCHETYPE_WAR_FREQ_MULT[a]);
    }
  });

  it('personality ordering: hegemon > crusader_state > opportunist > trading_republic ≥ hermit', () => {
    expect(ARCHETYPE_WAR_FREQ_MULT.hegemon).toBeGreaterThan(ARCHETYPE_WAR_FREQ_MULT.crusader_state);
    expect(ARCHETYPE_WAR_FREQ_MULT.crusader_state).toBeGreaterThan(ARCHETYPE_WAR_FREQ_MULT.opportunist);
    expect(ARCHETYPE_WAR_FREQ_MULT.opportunist).toBeGreaterThan(ARCHETYPE_WAR_FREQ_MULT.trading_republic);
    expect(ARCHETYPE_WAR_FREQ_MULT.trading_republic).toBeGreaterThanOrEqual(ARCHETYPE_WAR_FREQ_MULT.hermit_kingdom);
  });

  it('has same key set as ARCHETYPE_GREEN_PROPENSITY', () => {
    expect(Object.keys(ARCHETYPE_WAR_FREQ_MULT).sort())
      .toEqual(Object.keys(ARCHETYPE_GREEN_PROPENSITY).sort());
  });

  it('hegemon mult > 1 (bellicose) and hermit mult < 0.5 (very reluctant)', () => {
    expect(ARCHETYPE_WAR_FREQ_MULT.hegemon).toBeGreaterThan(1.0);
    expect(ARCHETYPE_WAR_FREQ_MULT.hermit_kingdom).toBeLessThan(0.5);
  });

  it('trading_republic has low war frequency consistent with peace-preferring role', () => {
    expect(ARCHETYPE_WAR_FREQ_MULT.trading_republic).toBeLessThan(0.6);
  });
});
