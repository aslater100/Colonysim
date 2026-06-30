import { describe, it, expect } from 'vitest';
import { RegionSim, REGION_MINUTES_PER_TICK } from '../src/sim/region';
import { RegionMap } from '../src/sim/worldgen';
import { Weather } from '../src/sim/weather';
import { Rng } from '../src/sim/rng';
import { MINUTES_PER_DAY } from '../src/sim/defs';

/**
 * Spatial-4X — the PLAYER faction plays spatially in autoplay too (flag-gated).
 *
 * Rivals develop their towns each AI update, but the player faction is skipped by
 * updateRivalAI (a human drives its building), so in autoplay the player held one
 * BARE town — zero placed buildings, zero districts — and its whole economy ran on
 * raw terrain yields. The headless balance signal therefore measured the spatial
 * economy only via rival competition, never the player's own spatial path.
 *
 * `autoDevelopPlayer` closes that gap: when set, the player faction reuses the SAME
 * develop logic as a rival (terrain-fit building on the best hex, district zoning on
 * a cluster) — but funded from the NATIONAL treasury (what a human spends) and
 * reserve-gated against its own town output, so it can never drain the famine buffer.
 * Default OFF → live human play stays manual and byte-identical; the headless tuning
 * harness turns it on. NOT serialized (a run-mode toggle, not game state).
 */

const ticksPerDay = MINUTES_PER_DAY / REGION_MINUTES_PER_TICK;
function runDays(r: RegionSim, days: number): void {
  for (let i = 0; i < days * ticksPerDay; i++) r.tick();
}
function colony(seed: number): RegionSim {
  return RegionSim.foundColony(new Rng(seed), new RegionMap(seed), new Weather(seed), {});
}

type AnyFaction = { id: number; treasury: number };
type AnySettle = { construction: unknown; placedBuildings: unknown[]; placedDistricts: unknown[] };
type Priv = {
  factionDevPurse: (f: AnyFaction) => number;
  spendFactionDev: (f: AnyFaction, cost: number) => void;
  tryBuildRivalBuilding: (f: AnyFaction, t: AnySettle, reserve: number) => boolean;
};
const priv = (r: RegionSim) => r as unknown as Priv;

const playerFaction = (r: RegionSim) => r.regionalFactions.find((f) => f.id === r.playerFactionId)!;
const aRival = (r: RegionSim) => r.regionalFactions.find((f) => f.id !== r.playerFactionId)!;
const playerTown = (r: RegionSim) =>
  r.settlements.find((t) => t.factionId === r.playerFactionId)! as unknown as AnySettle;
function playerPlaced(r: RegionSim): number {
  return r.settlements
    .filter((t) => t.factionId === r.playerFactionId)
    .reduce((s, t) => s + t.placedBuildings.length + t.placedDistricts.length, 0);
}

// ---- 1. The purse seam: who pays for development ----
//
// factionDevPurse / spendFactionDev are the single seam that lets one develop path
// serve both factions. For a rival they read/write exactly `faction.treasury` (so the
// rival path stays byte-identical); for the player they read/write the NATIONAL
// treasury (what a human spends building via the UI), leaving the player faction's own
// vestigial `treasury` field untouched.

describe('faction development purse — player draws the national treasury, rivals their own', () => {
  it('reads the national treasury for the player faction (not its faction.treasury field)', () => {
    const r = colony(7);
    r.treasury = 4242;
    const pf = playerFaction(r);
    pf.treasury = 11; // the player faction's own treasury field is NOT the dev purse
    expect(priv(r).factionDevPurse(pf)).toBe(4242);
  });

  it('reads the faction treasury for a rival (national treasury irrelevant)', () => {
    const r = colony(7);
    r.treasury = 4242;
    const rival = aRival(r);
    rival.treasury = 777;
    expect(priv(r).factionDevPurse(rival)).toBe(777);
  });

  it('spends from the national treasury for the player, the faction purse for a rival', () => {
    const r = colony(7);
    r.treasury = 1000;
    const pf = playerFaction(r);
    pf.treasury = 50;
    priv(r).spendFactionDev(pf, 30);
    expect(r.treasury).toBe(970); // national paid
    expect(pf.treasury).toBe(50); // faction field untouched

    const rival = aRival(r);
    rival.treasury = 200;
    const nat = r.treasury;
    priv(r).spendFactionDev(rival, 40);
    expect(rival.treasury).toBe(160); // faction purse paid
    expect(r.treasury).toBe(nat); // national untouched for a rival
  });
});

// ---- 2. The famine floor is enforced through the player's purse ----

describe('player development is reserve-gated against the national treasury', () => {
  it('never spends below the reserve — a reserve at the whole purse blocks the build', () => {
    const r = colony(7);
    const pf = playerFaction(r);
    const t = playerTown(r);
    r.treasury = 500;
    const before = r.treasury;
    // A reserve above the entire national purse leaves no affordable building.
    expect(priv(r).tryBuildRivalBuilding(pf, t, r.treasury + 1)).toBe(false);
    expect(r.treasury).toBe(before); // nothing spent
    expect(t.construction).toBeNull();
  });

  it('builds from the surplus above the reserve, debiting the national treasury only', () => {
    const r = colony(7);
    const pf = playerFaction(r);
    const t = playerTown(r);
    r.treasury = 100000; // ample surplus
    const pfPurse = pf.treasury; // the faction field must not move
    const before = r.treasury;
    expect(priv(r).tryBuildRivalBuilding(pf, t, 0)).toBe(true);
    expect(t.construction).not.toBeNull(); // ground broken
    expect(r.treasury).toBeLessThan(before); // national treasury paid the bill
    expect(pf.treasury).toBe(pfPurse); // player faction's own purse untouched
  });
});

// ---- 3. The flag toggles the player's spatial path in autoplay ----

describe('autoDevelopPlayer — exercises the player spatial path only when on', () => {
  it('defaults OFF, and the player never auto-develops in autoplay', () => {
    const r = colony(1000);
    expect(r.autoDevelopPlayer).toBe(false);
    runDays(r, 60 * 50); // ~mid-century of compressed autoplay
    expect(playerPlaced(r)).toBe(0); // one bare town, the old baseline
  });

  it('ON: the player builds out its own town(s) over autoplay', () => {
    const r = colony(1000);
    r.autoDevelopPlayer = true;
    runDays(r, 60 * 50);
    expect(playerPlaced(r), 'the player should raise buildings / zone districts').toBeGreaterThan(0);
  });

  it('ON: development is funded from the national treasury (the player faction purse stays put)', () => {
    const r = colony(1000);
    r.autoDevelopPlayer = true;
    const pf = playerFaction(r);
    const purseBefore = pf.treasury;
    runDays(r, 60 * 50);
    expect(playerPlaced(r)).toBeGreaterThan(0);
    // The player faction's vestigial treasury field is never the dev purse, so the
    // buildout cannot have moved it (the national treasury paid every bill).
    expect(pf.treasury).toBe(purseBefore);
  });
});

// ---- 4. Determinism with the flag on ----

describe('autoDevelopPlayer — deterministic re-baseline', () => {
  it('two same-seed runs reach identical player markers and placement counts', () => {
    const a = colony(1007);
    a.autoDevelopPlayer = true;
    runDays(a, 60 * 50);
    const b = colony(1007);
    b.autoDevelopPlayer = true;
    runDays(b, 60 * 50);
    expect(playerPlaced(a)).toBe(playerPlaced(b));
    expect(a.treasury).toBe(b.treasury);
    expect(a.playerPop()).toBe(b.playerPop());
  });
});
