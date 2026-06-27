/**
 * Pollution diffusion (Phase 14 / GDD §11) — the first `region.ts` tick
 * subsystem extracted to the free-function form the roadmap's Track C
 * modularization calls for: `fn(r: RegionSim, …)`, NOT a subclass.
 *
 * Why free functions: they preserve the exact RNG-consumption order (the
 * determinism constraint), since the body runs verbatim against the same
 * `RegionSim` — extraction moves the code without moving a single draw. `tick()`
 * becomes the dispatcher; all state and `serialize()` stay on `RegionSim`. The
 * byte-identical `serialize()` diff is guarded by `tests/serialize-determinism`.
 *
 * `tickPollution` is the cleanest leaf to start with: zero RNG, and every
 * `RegionSim`/`Settlement` member it touches is already public.
 */
import type { RegionSim } from '../region';

/**
 * Advance each player settlement's pollution one month: heavy industry and coal
 * power raise it, a clean-industry policy and 5%/month natural decay lower it,
 * and any standing pollution shaves a little satisfaction. Pure (no RNG, no I/O);
 * mutates only `pollutionLevel` and `satisfaction` on player-owned settlements.
 */
export function tickPollution(r: RegionSim): void {
  for (const t of r.settlements) {
    if (t.factionId !== r.playerFactionId) continue;
    let base = 0;
    // +30 if has iron_works (ironworks) or factory building
    if (t.buildings.includes('ironworks') || t.buildings.includes('factory')) base += 30;
    // +20 if has coal_plant (power_station) building
    if (t.buildings.includes('power_station')) base += 20;
    // -10 if has clean_industry_act researched (activePolicies)
    if (r.policyActive('clean_industry_act')) base -= 10;
    // Decay 5% per month (natural)
    const current = t.pollutionLevel ?? 0;
    const decayed = current * 0.95;
    // Blend: move toward base level
    t.pollutionLevel = Math.max(0, Math.min(100, decayed + base * 0.1));
    // Side effects: pollution shaves satisfaction monthly
    if (t.pollutionLevel > 0) {
      t.satisfaction = Math.max(0, t.satisfaction - (t.pollutionLevel / 10) * 0.1);
    }
  }
}
