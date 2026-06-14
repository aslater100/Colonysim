import { describe, expect, it } from 'vitest';
import { FogMap, FOG, FOG_N } from '../src/sim/fogmap';

// Track B Phase 6 — typed-array fog of war. Three-state semantics must match
// the legacy RegionSim.explorationMap, with a clean migration off the old
// string-of-rows save format and a compact base64 round-trip.

describe('FogMap — basics', () => {
  it('starts fully fogged at 100×100', () => {
    const fog = new FogMap();
    expect(fog.n).toBe(FOG_N);
    expect(fog.cells.length).toBe(FOG_N * FOG_N);
    expect(fog.get(50, 50)).toBe(FOG.fogged);
    expect(fog.exploredFraction()).toBe(0);
  });

  it('reads out of bounds as fogged and ignores out-of-bounds writes', () => {
    const fog = new FogMap();
    expect(fog.get(-1, 0)).toBe(FOG.fogged);
    expect(fog.get(FOG_N, 0)).toBe(FOG.fogged);
    fog.set(-5, -5, FOG.explored); // no throw, no effect
    expect(fog.exploredFraction()).toBe(0);
  });
});

describe('FogMap — reveal semantics (match revealTiles)', () => {
  it('reveals a filled circle of the given radius', () => {
    const fog = new FogMap();
    fog.reveal(50, 50, 3, FOG.explored);
    expect(fog.get(50, 50)).toBe(FOG.explored);
    expect(fog.get(53, 50)).toBe(FOG.explored); // dx²=9 ≤ 9
    expect(fog.get(50, 47)).toBe(FOG.explored);
    expect(fog.get(54, 50)).toBe(FOG.fogged); // dx²=16 > 9, outside
  });

  it('explored only lifts fog; scouted always wins; neither downgrades', () => {
    const fog = new FogMap();
    fog.set(50, 50, FOG.scouted);
    fog.reveal(50, 50, 1, FOG.explored); // must NOT downgrade scouted → explored
    expect(fog.get(50, 50)).toBe(FOG.scouted);

    fog.set(40, 40, FOG.explored);
    fog.reveal(40, 40, 1, FOG.scouted); // scouted overwrites explored
    expect(fog.get(40, 40)).toBe(FOG.scouted);
  });

  it('clearScouted demotes this turn’s line-of-sight back to explored', () => {
    const fog = new FogMap();
    fog.reveal(10, 10, 2, FOG.scouted);
    fog.reveal(80, 80, 2, FOG.explored);
    fog.clearScouted();
    expect(fog.get(10, 10)).toBe(FOG.explored);
    expect(fog.get(80, 80)).toBe(FOG.explored);
    expect(fog.get(0, 0)).toBe(FOG.fogged);
  });
});

describe('FogMap — serialization', () => {
  it('base64 round-trips, persisting scouted as explored', () => {
    const fog = new FogMap();
    fog.reveal(25, 25, 4, FOG.explored);
    fog.reveal(70, 30, 3, FOG.scouted);
    const restored = FogMap.deserialize(fog.serialize());

    expect(restored.get(25, 25)).toBe(FOG.explored);
    expect(restored.get(70, 30)).toBe(FOG.explored); // scouted is ephemeral
    expect(restored.get(0, 0)).toBe(FOG.fogged);
    // Every non-fogged tile survives the round-trip.
    for (let x = 0; x < FOG_N; x++) {
      for (let y = 0; y < FOG_N; y++) {
        const orig = fog.get(x, y) === FOG.fogged ? FOG.fogged : FOG.explored;
        expect(restored.get(x, y)).toBe(orig);
      }
    }
  });

  it('migrates the legacy explorationMap rows (rows[x][y] of 0/1)', () => {
    const fog = new FogMap();
    fog.reveal(33, 44, 5, FOG.explored);
    const rows = fog.toLegacyRows();
    expect(rows.length).toBe(FOG_N);
    expect(rows[0].length).toBe(FOG_N);

    const migrated = FogMap.fromLegacyRows(rows);
    expect(migrated.get(33, 44)).toBe(FOG.explored);
    expect(migrated.exploredFraction()).toBeCloseTo(fog.exploredFraction(), 10);
  });

  it('tolerates short/empty legacy rows without throwing', () => {
    const migrated = FogMap.fromLegacyRows(['', '1', '01']);
    expect(migrated.get(1, 0)).toBe(FOG.explored);
    expect(migrated.get(2, 1)).toBe(FOG.explored);
    expect(migrated.get(99, 99)).toBe(FOG.fogged);
  });
});
