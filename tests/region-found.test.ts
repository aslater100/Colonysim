import { describe, expect, it } from 'vitest';
import { RegionSim, REGION_MINUTES_PER_TICK } from '../src/sim/region';
import { RegionMap } from '../src/sim/worldgen';
import { Weather } from '../src/sim/weather';
import { Rng } from '../src/sim/rng';
import { MINUTES_PER_DAY } from '../src/sim/defs';

/**
 * The standalone 4X campaign boots with `RegionSim.foundColony` — a single
 * founding settlement with no TownCore flip behind it. These guard the day-zero
 * shape (one loyal player town, fog around it, lenders + faction wired) and that
 * the colony→nation arc is actually reachable from that start.
 */
const ticksPerDay = MINUTES_PER_DAY / REGION_MINUTES_PER_TICK;

function colony(seed: number): RegionSim {
  return RegionSim.foundColony(new Rng(seed), new RegionMap(seed), new Weather(seed), {});
}

describe('RegionSim.foundColony — the 4X day zero', () => {
  it('seeds exactly one loyal player settlement with a treasury and lenders', () => {
    const r = colony(123);
    expect(r.settlements.length).toBe(1);
    const home = r.settlements[0];
    expect(home.factionId).toBe(r.playerFactionId);
    expect(r.popOf(home)).toBeGreaterThan(8);
    expect(home.loyaltyToFaction).toBe(100);
    expect(r.treasury).toBeGreaterThan(0);
    expect(r.lenders.length).toBeGreaterThan(0);
    expect(r.year).toBe(1900);
    expect(r.stateProclaimed).toBe(false);
    expect(r.nationProclaimed).toBe(false);
  });

  it('reveals the founding valley but leaves the rest of the region fogged', () => {
    const r = colony(123);
    let explored = 0, fogged = 0;
    for (const col of r.explorationMap) for (const v of col) {
      if (v === 'explored' || v === 'scouted') explored++;
      else fogged++;
    }
    expect(explored).toBeGreaterThan(0);
    expect(fogged).toBeGreaterThan(explored); // most of the map is still unknown
  });

  it('is deterministic for a fixed seed', () => {
    const a = colony(777);
    const b = colony(777);
    expect(a.settlements[0].x).toBeCloseTo(b.settlements[0].x);
    expect(a.settlements[0].y).toBeCloseTo(b.settlements[0].y);
    expect(a.treasury).toBe(b.treasury);
  });

  it('runs a year without the books drifting to NaN/Infinity', () => {
    const r = colony(42);
    for (let i = 0; i < ticksPerDay * 360; i++) r.tick();
    expect(Number.isFinite(r.treasury)).toBe(true);
    expect(Number.isFinite(r.totalPop())).toBe(true);
    expect(r.totalPop()).toBeGreaterThan(0);
    expect(r.settlements.length).toBeGreaterThanOrEqual(1);
  });

  it('survives a save/load round-trip and continues deterministically', () => {
    // The 4X shell saves region.serialize() + the world seed, and reloads via
    // RegionSim.deserialize with a {rng, regionMap, weather} stub. This guards
    // that the round-trip restores state AND the rng so play continues identically.
    const seed = 31337;
    const r = colony(seed);
    for (let i = 0; i < ticksPerDay * 200; i++) r.tick();
    const json = r.serialize();
    const stub = { rng: new Rng(seed), regionMap: new RegionMap(seed), weather: new Weather(seed) } as never;
    const r2 = RegionSim.deserialize(json, stub);

    // Restored state matches.
    expect(r2.day).toBe(r.day);
    expect(r2.treasury).toBeCloseTo(r.treasury, 5);
    expect(r2.settlements.length).toBe(r.settlements.length);
    expect(r2.totalPop()).toBeCloseTo(r.totalPop(), 5);
    const explored = (rr: RegionSim) => rr.explorationMap.reduce((a, col) => a + col.filter((v) => v !== 'fogged').length, 0);
    expect(explored(r2)).toBe(explored(r));

    // Continued play is identical (rng state was restored).
    for (let i = 0; i < ticksPerDay * 120; i++) { r.tick(); r2.tick(); }
    expect(r2.treasury).toBeCloseTo(r.treasury, 5);
    expect(r2.totalPop()).toBeCloseTo(r.totalPop(), 5);
    expect(r2.settlements.length).toBe(r.settlements.length);
  });

  it('lets the founding town reach the expansion gate within a few years', () => {
    // Grow unmanaged; the colony should accumulate the pop/food/wood to found a
    // daughter town at some point in the early century — the arc is reachable.
    const r = colony(7);
    let everOk = false;
    for (let y = 0; y < 12 && !everOk; y++) {
      for (let i = 0; i < ticksPerDay * 360; i++) r.tick();
      if (r.canFoundTown(r.settlements[0].id).ok) everOk = true;
    }
    expect(everOk).toBe(true);
  });
});
