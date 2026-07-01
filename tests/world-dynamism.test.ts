import { describe, expect, it } from 'vitest';
import { RegionSim } from '../src/sim/region';

/**
 * WORLD DYNAMISM campaign options.
 *
 * `consumerDemand` ('Living World Market') and `rivalClimateResponse`
 * ('A World That Fights Back') used to be run-mode toggles set only by the
 * headless harness. They are now campaign options chosen on the new-game
 * scenario screen, so they must (a) default OFF on a fresh sim, (b) round-trip
 * through serialize/deserialize, and (c) default OFF when loading an old save
 * that predates the keys.
 */
describe('World Dynamism flags — campaign options persisted in saves', () => {
  it('both flags default false on create', () => {
    const r = RegionSim.create(1000);
    expect(r.consumerDemand).toBe(false);
    expect(r.rivalClimateResponse).toBe(false);
  });

  it('set true → serialize → deserialize → still true', () => {
    const r = RegionSim.create(1000);
    r.consumerDemand = true;
    r.rivalClimateResponse = true;
    const loaded = RegionSim.deserialize(r.serialize());
    expect(loaded.consumerDemand).toBe(true);
    expect(loaded.rivalClimateResponse).toBe(true);
  });

  it('flags round-trip independently', () => {
    const r = RegionSim.create(1000);
    r.consumerDemand = true;
    const loaded = RegionSim.deserialize(r.serialize());
    expect(loaded.consumerDemand).toBe(true);
    expect(loaded.rivalClimateResponse).toBe(false);
  });

  it('an old save without the keys loads with both flags false', () => {
    const r = RegionSim.create(1000);
    r.consumerDemand = true;
    r.rivalClimateResponse = true;
    const old = JSON.parse(r.serialize());
    delete old.consumerDemand;
    delete old.rivalClimateResponse;
    const loaded = RegionSim.deserialize(JSON.stringify(old));
    expect(loaded.consumerDemand).toBe(false);
    expect(loaded.rivalClimateResponse).toBe(false);
  });
});
