/**
 * The Armaments Chain — military strength is forged from industry (GDD §7.2)
 *
 * Economy-realism arc, increment 2. A nation fields, equips, and sustains a
 * military only as far as its steel and chemicals let it: `armamentsCapacity()`
 * reads that industrial base (the Liebig minimum of the resolved steel/chemicals
 * supply levels), and three player-war-gated couplings make an embargoed or
 * deindustrialised belligerent fight weaker, recruit dearer, and pay more to
 * keep a war going. Every effect is reached only through the war paths, which the
 * autoplay sweep never walks — so the whole chain is byte-identical to every
 * headless sweep (proven separately by the determinism gate + a re-run capture).
 */

import { describe, it, expect } from 'vitest';
import {
  RegionSim,
  UNIT_TYPES,
  ARMAMENTS_WARPOWER_FLOOR,
  ARMAMENTS_STRAIN_PREMIUM,
} from '../src/sim/region';

// ---- helpers (mirroring tests/phase16.test.ts conventions) ----

function makeRegion(seed = 42): RegionSim {
  return RegionSim.create(seed);
}

/** Inject a hostile rival + proclaim the nation so war/recruit paths are reachable. */
function injectRival(r: RegionSim, id = 9001): number {
  const sim = r as unknown as {
    rivals: Array<Record<string, unknown>>;
    nationProclaimed: boolean;
    stateProclaimed: boolean;
  };
  sim.rivals.push({
    id, name: 'Testania', leader: 'Commander Test', archetype: 'hegemon',
    weights: { expansion: 7, commerce: 3, honor: 5, risk: 6, grudge: 3 },
    regime: 'junta', agenda: 'dominate', compass: 'east',
    pop: 80, relations: -70, treaties: [],
    borderSettled: false, emergedYear: 1920, history: [],
    lastEnvoyDay: -999, lastGiftDay: -999,
  });
  sim.nationProclaimed = true;
  sim.stateProclaimed = true;
  return id;
}

/** Force a player war against the injected rival (peacetime mobilization, no units). */
function forceWar(r: RegionSim, rivalId: number): void {
  (r as unknown as { playerWar: Record<string, unknown> | null }).playerWar = {
    rivalId, cb: 'border_dispute', defensive: false, startedDay: -1,
    support: 60, score: 30, mobilization: 'peacetime', casualties: 0,
    blockade: false, allies: [], enemyAllies: [], occupied: 0,
    resistance: 0, occupationPolicy: 'conciliatory', brutality: false,
    units: [], supplyReserve: 3,
  };
  (r as unknown as { warSupport: number }).warSupport = 60;
}

/** Pin the resolved steel & chemicals supply levels the arms base reads. */
function setArmsBase(r: RegionSim, level: number): void {
  r.goodLevels = new Map([['steel', level], ['chemicals', level]]);
}

// ---- armamentsCapacity() ----

describe('armamentsCapacity()', () => {
  it('is 1 before the goods chain has resolved steel/chemicals (no invented penalty)', () => {
    const r = makeRegion();
    expect(r.goodLevels.get('steel')).toBeUndefined();
    expect(r.armamentsCapacity()).toBe(1);
  });

  it('is the Liebig minimum of the steel and chemicals levels', () => {
    const r = makeRegion();
    r.goodLevels = new Map([['steel', 0.3], ['chemicals', 0.8]]);
    expect(r.armamentsCapacity()).toBeCloseTo(0.3, 10);
    r.goodLevels = new Map([['steel', 0.9], ['chemicals', 0.2]]);
    expect(r.armamentsCapacity()).toBeCloseTo(0.2, 10);
  });

  it('clamps to [0,1]', () => {
    const r = makeRegion();
    r.goodLevels = new Map([['steel', 1.5], ['chemicals', 1.2]]);
    expect(r.armamentsCapacity()).toBe(1);
    r.goodLevels = new Map([['steel', -0.4], ['chemicals', 0.5]]);
    expect(r.armamentsCapacity()).toBe(0);
  });

  it('is 1 if either input is missing (a raw not yet in the ledger)', () => {
    const r = makeRegion();
    r.goodLevels = new Map([['steel', 0.2]]); // chemicals absent
    expect(r.armamentsCapacity()).toBe(1);
  });
});

// ---- warPower(): the arms base equips the force ----

describe('warPower() arms-base equipment factor', () => {
  it('a strained arms base fields weaker forces than a full one', () => {
    const full = makeRegion();
    injectRival(full); forceWar(full, 9001); setArmsBase(full, 1.0);
    const strained = makeRegion();
    injectRival(strained); forceWar(strained, 9001); setArmsBase(strained, 0.2);
    expect(strained.warPower()).toBeLessThan(full.warPower());
  });

  it('a fully-collapsed arms base still fights at the floor, never zero', () => {
    const full = makeRegion();
    injectRival(full); forceWar(full, 9001); setArmsBase(full, 1.0);
    const collapsed = makeRegion();
    injectRival(collapsed); forceWar(collapsed, 9001); setArmsBase(collapsed, 0.0);
    // No units and no allies in either fixture, so warPower is our-power-only:
    // the collapsed nation's power is exactly the floor fraction of the full one's.
    expect(collapsed.warPower()).toBeGreaterThan(0);
    expect(collapsed.warPower()).toBeCloseTo(full.warPower() * ARMAMENTS_WARPOWER_FLOOR, 6);
  });

  it('outside a war the arms base does not touch power (byte-identical guarantee)', () => {
    const flush = makeRegion();
    setArmsBase(flush, 1.0);
    const embargoed = makeRegion();
    setArmsBase(embargoed, 0.1);
    // No playerWar on either → the equip factor is 1 → identical fallback power.
    expect(embargoed.warPower()).toBeCloseTo(flush.warPower(), 10);
  });
});

// ---- recruitUnits(): the arms base prices recruitment ----

describe('recruitUnits() arms-base premium', () => {
  function recruitCost(armsLevel: number): number {
    const r = makeRegion();
    const id = injectRival(r); forceWar(r, id);
    (r as unknown as { treasury: number }).treasury = 100000;
    setArmsBase(r, armsLevel);
    return r.recruitUnits('militia', 10)!;
  }

  it('at a full arms base costs exactly count × recruitCost (healthy war unchanged)', () => {
    expect(recruitCost(1.0)).toBe(10 * UNIT_TYPES.militia.recruitCost);
  });

  it('grows dearer as the arms base is strained, up to ×(1+PREMIUM) at collapse', () => {
    const base = 10 * UNIT_TYPES.militia.recruitCost;
    expect(recruitCost(0.5)).toBeGreaterThan(base);
    expect(recruitCost(0.0)).toBe(Math.round(base * (1 + ARMAMENTS_STRAIN_PREMIUM)));
    expect(recruitCost(0.5)).toBe(Math.round(base * (1 + 0.5 * ARMAMENTS_STRAIN_PREMIUM)));
  });
});
