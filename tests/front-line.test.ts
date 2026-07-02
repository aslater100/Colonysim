import { describe, it, expect } from 'vitest';
import {
  RegionSim,
  FRONT_LAG,
  frontPhase,
  advanceFront,
  FRONT_PHASE_LABEL,
  type FrontPhase,
} from '../src/sim/region';
import { tickPlayerWar } from '../src/sim/systems/military';

/**
 * The front line (GDD §7.4) — activating the D2-mil `front` scaffold.
 *
 * Before this, `w.front` merely mirrored `w.score` and nothing read it. Now the
 * front is a lagging integrator of the war score: it eases toward the score by
 * FRONT_LAG each month, tracks the deepest advance (`peak`), and derives a posture
 * the UI and the war log read. It draws no RNG, so activating it moves no draw and
 * every autoplay run (which never holds a `playerWar`) stays byte-identical.
 */

const PHASES: FrontPhase[] = ['breakthrough', 'advancing', 'contested', 'falling_back', 'collapse'];

// ---- pure classification ----

describe('frontPhase thresholds', () => {
  it('classifies each band at its boundaries', () => {
    expect(frontPhase(100)).toBe('breakthrough');
    expect(frontPhase(60)).toBe('breakthrough');
    expect(frontPhase(59.9)).toBe('advancing');
    expect(frontPhase(20)).toBe('advancing');
    expect(frontPhase(19.9)).toBe('contested');
    expect(frontPhase(0)).toBe('contested');
    expect(frontPhase(-19.9)).toBe('contested');
    expect(frontPhase(-20)).toBe('falling_back');
    expect(frontPhase(-59.9)).toBe('falling_back');
    expect(frontPhase(-60)).toBe('collapse');
    expect(frontPhase(-100)).toBe('collapse');
  });

  it('is monotonic in position (never improves as the line is pushed back)', () => {
    const order = PHASES; // breakthrough (best) → collapse (worst)
    let prevIdx = -1;
    for (let p = 100; p >= -100; p -= 5) {
      const idx = order.indexOf(frontPhase(p));
      expect(idx).toBeGreaterThanOrEqual(prevIdx);
      prevIdx = Math.max(prevIdx, idx);
    }
  });
});

describe('FRONT_PHASE_LABEL', () => {
  it('covers every phase with a named enemy in the narration', () => {
    for (const p of PHASES) {
      const meta = FRONT_PHASE_LABEL[p];
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.line).toContain('{0}');
      expect(['good', 'info', 'bad']).toContain(meta.log);
      expect(['good', 'warn', 'bad']).toContain(meta.bar);
    }
  });
});

// ---- the integrator ----

describe('advanceFront integrator', () => {
  it('starts the line on the score when there is no prior front', () => {
    const f = advanceFront(undefined, 40);
    expect(f.position).toBe(40);
    expect(f.peak).toBe(40);
    expect(f.phase).toBe('advancing');
  });

  it('eases toward the score by exactly FRONT_LAG of the gap', () => {
    const f = advanceFront({ position: 0, peak: 0 }, 100);
    expect(f.position).toBeCloseTo(100 * FRONT_LAG, 9);
  });

  it('never overshoots — position stays between the prior line and the score', () => {
    for (const [prev, score] of [[0, 100], [80, -100], [-30, 50], [10, 10]] as const) {
      const { position } = advanceFront({ position: prev, peak: prev }, score);
      const lo = Math.min(prev, score);
      const hi = Math.max(prev, score);
      expect(position).toBeGreaterThanOrEqual(lo - 1e-9);
      expect(position).toBeLessThanOrEqual(hi + 1e-9);
    }
  });

  it('carries the high-water peak even as the line falls back', () => {
    const f = advanceFront({ position: 50, peak: 80 }, -100);
    expect(f.position).toBeLessThan(0);       // routed this month
    expect(f.peak).toBe(80);                  // but the deepest advance is remembered
    expect(f.phase).toBe(frontPhase(f.position));
  });

  it('converges geometrically toward a held score', () => {
    let f = advanceFront(undefined, 0);
    for (let i = 0; i < 40; i++) f = advanceFront(f, 90);
    expect(f.position).toBeCloseTo(90, 3);
    expect(f.peak).toBeCloseTo(90, 3);
  });
});

// ---- wired into the war tick ----

/** Mirror tests/war-materiel.test.ts: a synthetic rival + a forced player war. */
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

function forceWar(r: RegionSim, rivalId: number, score: number): void {
  (r as unknown as { playerWar: Record<string, unknown> | null }).playerWar = {
    rivalId, cb: 'border_dispute', defensive: false, startedDay: -1,
    support: 60, score, mobilization: 'peacetime', casualties: 0,
    blockade: false, allies: [], enemyAllies: [], occupied: 0,
    resistance: 0, occupationPolicy: 'conciliatory', brutality: false,
    units: [{ type: 'militia', count: 10, morale: 100, suppliedDays: 90 }],
    supplyReserve: 3,
  };
  (r as unknown as { warSupport: number }).warSupport = 60;
}

describe('front wired into tickPlayerWar', () => {
  it('populates a coherent, bounded, peak-monotone front across a war', () => {
    const r = RegionSim.create(42);
    const id = injectRival(r);
    forceWar(r, id, 30);
    const w = () => (r as unknown as { playerWar: { front?: { position: number; peak: number; phase: FrontPhase } } | null }).playerWar;

    let peak = -Infinity;
    let resolved = 0;
    for (let month = 0; month < 24; month++) {
      tickPlayerWar(r);
      const war = w();
      if (!war) break; // war ended
      const f = war.front!;
      resolved++;
      expect(typeof f.position).toBe('number');
      expect(Number.isFinite(f.position)).toBe(true);
      expect(f.position).toBeGreaterThanOrEqual(-100);
      expect(f.position).toBeLessThanOrEqual(100);
      expect(f.phase).toBe(frontPhase(f.position));     // stored phase matches position
      expect(f.peak).toBeGreaterThanOrEqual(f.position - 1e-9);
      expect(f.peak).toBeGreaterThanOrEqual(peak - 1e-9); // high-water never regresses
      peak = f.peak;
    }
    expect(resolved).toBeGreaterThan(0); // the path was genuinely exercised
  });

  it('records the front high-water mark into the WarScar at war-end', () => {
    const r = RegionSim.create(11);
    const id = injectRival(r);
    forceWar(r, id, 50);
    tickPlayerWar(r); // establishes the front while the rival exists
    // The rival vanishes → tickPlayerWar takes the status_quo end path and records a scar.
    (r as unknown as { rivals: unknown[] }).rivals = [];
    tickPlayerWar(r);
    expect((r as unknown as { playerWar: unknown }).playerWar).toBeNull();
    const scar = (r as unknown as { warScars: Array<{ outcome: string; frontPeak?: number }> }).warScars.at(-1)!;
    expect(scar.outcome).toBe('status_quo');
    expect(typeof scar.frontPeak).toBe('number');
    expect(Number.isFinite(scar.frontPeak)).toBe(true);
  });

  it('survives a serialize round-trip (front persists in the save)', () => {
    const r = RegionSim.create(7);
    const id = injectRival(r);
    forceWar(r, id, 45);
    tickPlayerWar(r);
    const saved = JSON.parse(r.serialize());
    expect(saved.playerWar.front).toBeDefined();
    expect(typeof saved.playerWar.front.position).toBe('number');
    expect(PHASES).toContain(saved.playerWar.front.phase);

    const reloaded = RegionSim.deserialize(r.serialize());
    const rf = (reloaded as unknown as { playerWar: { front: { position: number; phase: FrontPhase } } | null }).playerWar;
    expect(rf?.front.position).toBe(saved.playerWar.front.position);
    expect(rf?.front.phase).toBe(saved.playerWar.front.phase);
  });
});
