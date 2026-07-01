/**
 * Historical-scenario goal checks (Phase 17, GDD §8.8) — Track-C tick subsystem
 * lifted to fn(r: RegionSim). Body VERBATIM (this.→r.); checked monthly; the
 * per-goal predicate methods (goalSurviveTo2000, …) stay on RegionSim and are
 * invoked by name through the same dynamic lookup, now bound to r.
 */
import type { RegionSim } from '../region';
import { SCENARIOS } from '../region';

/** Mark any active-scenario goal complete the first month its predicate holds. */
export function checkScenarioGoals(r: RegionSim): void {
    if (!r.activeScenario) return;
    const scenario = SCENARIOS.find((s) => s.id === r.activeScenario);
    if (!scenario) return;

    for (const goal of scenario.startingGoals) {
      if (r.scenarioGoalsCompleted.includes(goal.id)) continue;
      const checkFn = (r as unknown as Record<string, () => boolean>)[goal.checkFn];
      if (typeof checkFn === 'function' && checkFn.call(r)) {
        r.scenarioGoalsCompleted.push(goal.id);
        r.addLog(
          `SCENARIO GOAL ACHIEVED: ${goal.description}`,
          'good',
        );
      }
    }
  }
