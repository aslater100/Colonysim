import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/sim';
import { MINUTES_PER_DAY, MINUTES_PER_TICK } from '../src/sim/defs';
import { MAP_W, MAP_H } from '../src/sim/world';

const ticksPerDay = MINUTES_PER_DAY / MINUTES_PER_TICK;

/** Raw-good storage must never read over its capacity (the 342/300 bug). */
describe('stockpile capacity is a hard ceiling for raw goods', () => {
  it('hauled + produced raw goods never exceed the stockpile cap; surplus lands on the ground', () => {
    const sim = new Simulation(42);
    const cx = Math.floor(MAP_W / 2);
    const cy = Math.floor(MAP_H / 2);

    // A single stockpile tile — a deliberately tiny cap so it fills fast.
    sim.planZone('stockpile', cx, cy);
    const cap = sim.stockpileCapacity();
    expect(cap).toBeGreaterThan(0);

    // Start from a clean slate so the only raw goods are the ones produced here.
    for (const k of Object.keys(sim.stock) as (keyof typeof sim.stock)[]) {
      if (k !== 'meal' && k !== 'grain') sim.stock[k] = 0;
    }

    // Mark a generous stand of trees so haulers keep feeding the stores past cap.
    let marked = 0;
    for (let r = 1; r < 20 && marked < 80; r++) {
      for (let y = cy - r; y <= cy + r && marked < 80; y++) {
        for (let x = cx - r; x <= cx + r && marked < 80; x++) {
          if (sim.world.inBounds(x, y) && sim.world.at(x, y).kind === 'tree' && !sim.world.at(x, y).marked) {
            sim.markTree(x, y);
            marked++;
          }
        }
      }
    }
    expect(marked).toBeGreaterThan(10);

    let peakRaw = 0;
    for (let i = 0; i < ticksPerDay * 8; i++) {
      sim.tick();
      const raw = sim.totalRawStock();
      peakRaw = Math.max(peakRaw, raw);
      // The invariant the player cares about: the bar can never read over cap.
      expect(raw).toBeLessThanOrEqual(cap + 1e-6);
    }

    // The cap should actually have been reached (otherwise the test proves nothing).
    expect(peakRaw).toBeGreaterThanOrEqual(cap * 0.5);
    // And the surplus wood the haulers couldn't store is preserved on the ground.
    expect(sim.items.some((it) => it.kind === 'wood')).toBe(true);
  });
});
