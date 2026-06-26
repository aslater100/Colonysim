import { describe, it, expect } from 'vitest';
import { townSpriteTier, TOWN_TIER_PX, type TownTier } from '../src/ui/assets/registry';

describe('townSpriteTier', () => {
  it('maps population to the right sprite tier at each band edge', () => {
    expect(townSpriteTier(0)).toBe('shack');
    expect(townSpriteTier(29)).toBe('shack');
    expect(townSpriteTier(30)).toBe('cottage');
    expect(townSpriteTier(79)).toBe('cottage');
    expect(townSpriteTier(80)).toBe('house');
    expect(townSpriteTier(199)).toBe('house');
    expect(townSpriteTier(200)).toBe('town');
    expect(townSpriteTier(499)).toBe('town');
    expect(townSpriteTier(500)).toBe('manor');
    expect(townSpriteTier(999)).toBe('manor');
    expect(townSpriteTier(1000)).toBe('castle');
    expect(townSpriteTier(50000)).toBe('castle');
  });

  it('has a positive draw size for every tier', () => {
    const tiers: TownTier[] = ['shack', 'cottage', 'house', 'town', 'manor', 'castle'];
    for (const tier of tiers) expect(TOWN_TIER_PX[tier]).toBeGreaterThan(0);
  });
});
