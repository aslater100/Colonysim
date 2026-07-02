import { describe, expect, it } from 'vitest';
import { RegionSim, MIN_SETTLEMENT_SPACING } from '../src/sim/region';
import { RegionMap, REGION_N } from '../src/sim/worldgen';
import { Weather } from '../src/sim/weather';
import { Rng } from '../src/sim/rng';

/**
 * Click-to-found (spatial-4X Phase A): the player picks WHERE a new town's
 * expedition is sent, instead of the engine auto-siting it. `canFoundAt` gates a
 * chosen coordinate (settleable land, ≥ MIN_SETTLEMENT_SPACING from any town,
 * within reach), and `foundTownAt` launches the expedition there.
 */
function readyColony(seed: number): { r: RegionSim; homeId: number } {
  const r = RegionSim.foundColony(new Rng(seed), new RegionMap(seed), new Weather(seed), {});
  const home = r.settlements[0];
  // Provision past the resource/treasury gates so the SITE checks are what's tested.
  r.treasury = 1_000_000;
  home.food = 100_000;
  home.wood = 100_000;
  home.cohorts = { bands: [200, 200, 200, 200, 200] };
  return { r, homeId: home.id };
}

function firstValidSite(r: RegionSim, fromId: number): { rx: number; ry: number } | null {
  const N = REGION_N;
  for (let col = 0; col < N; col++) {
    for (let row = 0; row < N; row++) {
      const rx = (col / N) * 100, ry = (row / N) * 100;
      if (r.canFoundAt(fromId, rx, ry).ok) return { rx, ry };
    }
  }
  return null;
}

describe('canFoundAt — site validation', () => {
  it('rejects a site too close to an existing town', () => {
    const { r, homeId } = readyColony(42);
    const home = r.settlement(homeId)!;
    // The home's own coordinates: guaranteed settleable land (it's a town) and
    // distance 0 — well inside MIN_SETTLEMENT_SPACING (8), so the spacing gate is
    // what fires. (home.x±1 can be sea on a coastal start, tripping the water gate.)
    const res = r.canFoundAt(homeId, home.x, home.y);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/too close/);
  });

  it('rejects water / mountain cells', () => {
    const { r, homeId } = readyColony(42);
    const N = REGION_N;
    let waterCoord: { rx: number; ry: number } | null = null;
    for (let col = 0; col < N && !waterCoord; col++) {
      for (let row = 0; row < N; row++) {
        if (r.map.siteScore(col, row) < 0) { waterCoord = { rx: (col / N) * 100, ry: (row / N) * 100 }; break; }
      }
    }
    expect(waterCoord).not.toBeNull();
    const res = r.canFoundAt(homeId, waterCoord!.rx, waterCoord!.ry);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/water or mountains/);
  });

  it('rejects a site beyond expedition reach', () => {
    const { r, homeId } = readyColony(42);
    const home = r.settlement(homeId)!;
    // Opposite corner is far past the ~28-unit reach.
    const far = { rx: home.x > 50 ? 2 : 98, ry: home.y > 50 ? 2 : 98 };
    const res = r.canFoundAt(homeId, far.rx, far.ry);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/too far|water or mountains/); // far, or far-and-unsettleable
  });

  it('accepts at least one reachable, legal land site', () => {
    const { r, homeId } = readyColony(42);
    const site = firstValidSite(r, homeId);
    expect(site).not.toBeNull();
    const home = r.settlement(homeId)!;
    // A valid site is genuinely ≥ the spacing from home.
    expect(Math.hypot(home.x - site!.rx, home.y - site!.ry)).toBeGreaterThanOrEqual(MIN_SETTLEMENT_SPACING - 1e-9);
  });
});

describe('foundTownAt — launches the expedition to the chosen spot', () => {
  it('founds at a valid site and sends the expedition there', () => {
    const { r, homeId } = readyColony(7);
    const site = firstValidSite(r, homeId)!;
    const expeditionsBefore = r.expeditions.length;
    const treasuryBefore = r.treasury;
    const ok = r.foundTownAt(homeId, site.rx, site.ry);
    expect(ok).toBe(true);
    expect(r.expeditions.length).toBe(expeditionsBefore + 1);
    const e = r.expeditions[r.expeditions.length - 1];
    // The expedition heads for (near) the chosen cell — not an engine-picked one.
    expect(Math.hypot(e.targetX - site.rx, e.targetY - site.ry)).toBeLessThan(100 / REGION_N + 1e-6);
    expect(r.treasury).toBeLessThan(treasuryBefore); // charter fee paid
  });

  it('is a no-op at an invalid (too-close) site', () => {
    const { r, homeId } = readyColony(7);
    const home = r.settlement(homeId)!;
    const before = r.expeditions.length;
    expect(r.foundTownAt(homeId, home.x + 1, home.y)).toBe(false);
    expect(r.expeditions.length).toBe(before);
  });
});
