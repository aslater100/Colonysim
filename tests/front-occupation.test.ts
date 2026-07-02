/**
 * The front decides the ground (GDD §7.4) — occupation reads the FRONT LINE.
 *
 * War arc increment (session 20). The occupation gate keyed off the noisy
 * monthly war SCORE, so a single lucky roll could take a march while the
 * sustained front was still contested — and a momentary dip could cede one in
 * the middle of a winning war. Now marches change hands on the integrated
 * `front.position` (session 17's lagging integrator), and the front's posture
 * moves the odds: a breakthrough overruns ground faster, a collapse cedes it
 * faster. Draw-then-decide: both occupation rolls are drawn every war month so
 * the RNG draw count never depends on the front's state. Gated on `playerWar`,
 * which no autoplay sweep ever holds — byte-identical everywhere in headless.
 */

import { describe, it, expect } from 'vitest';
import {
  RegionSim,
  FRONT_OCCUPY_THRESHOLD,
  MARCH_TAKE_CHANCE,
  MARCH_TAKE_CHANCE_BREAKTHROUGH,
  MARCH_CEDE_CHANCE,
  MARCH_CEDE_CHANCE_COLLAPSE,
  MAX_OCCUPIED_MARCHES,
  frontPhase,
} from '../src/sim/region';
import { tickPlayerWar } from '../src/sim/systems/military';

// ---- helpers (the war-materiel.test.ts inject-rival pattern) ----

function makeRegion(seed = 42): RegionSim {
  return RegionSim.create(seed);
}

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

type WarShape = {
  rivalId: number; cb: string; defensive: boolean; startedDay: number;
  support: number; score: number; mobilization: string; casualties: number;
  blockade: boolean; allies: number[]; enemyAllies: number[]; occupied: number;
  resistance: number; occupationPolicy: string; brutality: boolean;
  units: Array<{ type: string; count: number; morale: number; suppliedDays: number }>;
  supplyReserve: number;
  front?: { position: number; peak: number; phase: string };
};

/** Force a player war with the front pinned at `frontPos` and score at `score`. */
function forceWar(r: RegionSim, rivalId: number, score: number, frontPos: number, occupied = 0): WarShape {
  const w: WarShape = {
    rivalId, cb: 'border_dispute', defensive: false, startedDay: -1,
    support: 60, score, mobilization: 'peacetime', casualties: 0,
    blockade: false, allies: [], enemyAllies: [], occupied,
    resistance: 0, occupationPolicy: 'conciliatory', brutality: false,
    units: [{ type: 'militia', count: 500, morale: 100, suppliedDays: 90 }],
    supplyReserve: 3,
    front: { position: frontPos, peak: Math.max(frontPos, 0), phase: frontPhase(frontPos) },
  };
  (r as unknown as { playerWar: WarShape | null }).playerWar = w;
  (r as unknown as { warSupport: number }).warSupport = 60;
  return w;
}

function war(r: RegionSim): WarShape {
  return (r as unknown as { playerWar: WarShape }).playerWar;
}

/** Run `months` war ticks re-pinning score+front each month (isolates the gate
 *  from the integrator's drift), counting take/cede transitions. */
function runPinned(
  r: RegionSim, score: number, frontPos: number, months: number,
  startOccupied = 0,
): { takes: number; cedes: number } {
  let takes = 0;
  let cedes = 0;
  forceWar(r, 9001, score, frontPos, startOccupied);
  for (let i = 0; i < months; i++) {
    const w = war(r);
    if (!w) break;
    const before = w.occupied;
    w.score = score;
    w.front = { position: frontPos, peak: Math.max(frontPos, 0), phase: frontPhase(frontPos) };
    w.support = 60; // keep the home front from ending the war
    tickPlayerWar(r);
    const after = war(r)?.occupied ?? before;
    if (after > before) takes++;
    if (after < before) cedes++;
    if (war(r)) war(r).occupied = startOccupied; // re-arm the gate each month
  }
  return { takes, cedes };
}

// ---- constants ----

describe('front-occupation constants', () => {
  it('exports the designed values', () => {
    expect(FRONT_OCCUPY_THRESHOLD).toBe(35);
    expect(MARCH_TAKE_CHANCE).toBe(0.3);
    expect(MARCH_TAKE_CHANCE_BREAKTHROUGH).toBe(0.5);
    expect(MARCH_CEDE_CHANCE).toBe(0.25);
    expect(MARCH_CEDE_CHANCE_COLLAPSE).toBe(0.45);
  });

  it('breakthrough takes faster than an ordinary advance; collapse cedes faster than a dip', () => {
    expect(MARCH_TAKE_CHANCE_BREAKTHROUGH).toBeGreaterThan(MARCH_TAKE_CHANCE);
    expect(MARCH_CEDE_CHANCE_COLLAPSE).toBeGreaterThan(MARCH_CEDE_CHANCE);
  });
});

// ---- the gate reads the FRONT, not the score ----

describe('occupation gate reads the front line', () => {
  it('a high SCORE with a contested FRONT never takes a march (the old lucky-roll path is closed)', () => {
    const r = makeRegion(7);
    injectRival(r);
    const { takes } = runPinned(r, 80, 0, 60);
    expect(takes).toBe(0);
  });

  it('a sustained front above the threshold takes marches even while the month score dips', () => {
    const r = makeRegion(7);
    injectRival(r);
    // score pinned low (a bad month), front pinned high (a built advance)
    const { takes } = runPinned(r, 10, 50, 60);
    expect(takes).toBeGreaterThan(0);
  });

  it('a momentary negative SCORE no longer cedes ground while the FRONT holds positive', () => {
    const r = makeRegion(7);
    injectRival(r);
    const { cedes } = runPinned(r, -30, 10, 60, 2);
    expect(cedes).toBe(0);
  });

  it('a front pushed below zero cedes occupied marches', () => {
    const r = makeRegion(7);
    injectRival(r);
    const { cedes } = runPinned(r, -30, -10, 60, 2);
    expect(cedes).toBeGreaterThan(0);
  });

  it('never exceeds MAX_OCCUPIED_MARCHES', () => {
    const r = makeRegion(7);
    injectRival(r);
    forceWar(r, 9001, 90, 90, MAX_OCCUPIED_MARCHES);
    for (let i = 0; i < 24; i++) {
      const w = war(r);
      if (!w) break;
      w.score = 90;
      w.front = { position: 90, peak: 90, phase: 'breakthrough' };
      w.support = 60;
      tickPlayerWar(r);
      expect(war(r)?.occupied ?? MAX_OCCUPIED_MARCHES).toBeLessThanOrEqual(MAX_OCCUPIED_MARCHES);
    }
  });
});

// ---- posture moves the odds ----

describe('front posture scales the occupation odds', () => {
  it('a breakthrough front takes ground measurably faster than a mere advance', () => {
    const months = 400;
    const rA = makeRegion(7);
    injectRival(rA);
    const advance = runPinned(rA, 40, 40, months); // advancing posture, above threshold
    const rB = makeRegion(7);
    injectRival(rB);
    const breakthrough = runPinned(rB, 40, 80, months); // breakthrough posture
    expect(breakthrough.takes).toBeGreaterThan(advance.takes);
  });

  it('a collapsing front cedes ground measurably faster than a shallow retreat', () => {
    const months = 400;
    const rA = makeRegion(7);
    injectRival(rA);
    const shallow = runPinned(rA, -10, -10, months, 2); // falling back a little
    const rB = makeRegion(7);
    injectRival(rB);
    // pinned deep: the tick integrates the front toward the score BEFORE the
    // occupation roll, so −100/−60 keeps the at-roll posture in collapse (≤ −60)
    const rout = runPinned(rB, -60, -100, months, 2);
    expect(rout.cedes).toBeGreaterThan(shallow.cedes);
  });
});
