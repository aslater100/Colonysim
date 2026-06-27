import { describe, it, expect } from 'vitest';
import { RegionSim } from '../src/sim/region';

/**
 * Tier-asymmetry guardrail (GDD §6.4): rival belligerence — hostile mischief and
 * tribute ultimatums — now scales with the `aiAggression` difficulty knob via
 * `aggroChance`. It scales the probability THRESHOLD, not the RNG draw, so at the
 * 1.0 default (normal — what every test and the headless sim run at) the chance is
 * unchanged and play is byte-identical; only easy/hard tiers shift rival nastiness.
 */

function regionAt(aggression: number): RegionSim {
  const r = RegionSim.create(42);
  r.difficultySettings = { ...r.difficultySettings, aiAggression: aggression };
  return r;
}

describe('aggroChance (difficulty-scaled rival belligerence)', () => {
  it('is the identity at the 1.0 normal default (byte-identical play)', () => {
    const r = RegionSim.create(42);
    expect(r.difficultySettings.aiAggression).toBe(1.0);
    for (const p of [0, 0.012, 0.1, 0.5, 1]) {
      expect(r.aggroChance(p)).toBe(p);
    }
  });

  it('scales the threshold up on harder tiers and down on easier ones', () => {
    expect(regionAt(2.0).aggroChance(0.1)).toBeCloseTo(0.2, 12);
    expect(regionAt(1.5).aggroChance(0.012)).toBeCloseTo(0.018, 12);
    expect(regionAt(0.5).aggroChance(0.1)).toBeCloseTo(0.05, 12);
  });

  it('clamps to a valid probability [0,1]', () => {
    expect(regionAt(2.0).aggroChance(0.8)).toBe(1); // 1.6 → clamped
    expect(regionAt(2.0).aggroChance(-0.1)).toBe(0);
    expect(regionAt(0.5).aggroChance(0)).toBe(0);
  });
});
