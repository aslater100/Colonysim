/**
 * Intermediate-goods production & the supply-chain cascade (Phase 15 / GDD §5.2) —
 * the fourth `region.ts` tick subsystem extracted to the roadmap's free-function
 * form `fn(r: RegionSim)` (Track C), after systems/pollution.ts, systems/services.ts
 * and systems/arbitrage.ts. See systems/arbitrage.ts for the rationale: the body runs
 * verbatim against the same RegionSim so the RNG-consumption order is untouched (the
 * pharma plague-roll and the electronics research-slow log are the draws), tick()
 * dispatches, all state + serialize() stay on RegionSim, and the byte-identical
 * serialize() diff is guarded by tests/serialize-determinism (plus an 8-seed × 181y
 * headless sweep that is byte-for-byte identical to base).
 *
 * This is the method PR-3 slice 2 (the per-town supply solve) rewrites, so lifting it
 * out of the 14k-line monolith now — before that growth lands — keeps the goods system
 * in `systems/`. The graded ledger accessors (`produceGood`/`drawGood`/`seedGoodStock`)
 * and the raw-availability proxy (`rawSupplyLevel`/`advanceSectorOutputNorms`, now
 * public for this seam) stay on RegionSim beside the per-town `goodStocks` store.
 *
 * Like systems/arbitrage.ts this imports the `INTERMEDIATE_GOODS` catalog (a *value*)
 * from region.ts while region.ts imports this back — a runtime import cycle that is
 * safe because the catalog is read only *inside the function body* (call-time), so
 * ESM live-bindings have it initialized by the time a tick runs.
 */
import type { RegionSim } from '../region';
import { INTERMEDIATE_GOODS } from '../region';
import { resolveSupplyChainGraded, SUPPLY_FULL_EPS } from '../supply';

/** Process all intermediate goods that are unlocked in the current year.
 *  A good produces its baseOutput only when its whole upstream chain is intact:
 *  a raw-material outage cascades downstream (lose coal → lose chemicals → lose
 *  pharmaceuticals/components → lose electronics/vehicles), per GDD §5.2. The
 *  cascade itself is the pure `resolveSupplyChain` solver; this owns the stock
 *  ledger and the random secondary effects (disease risk, research penalty). */
export function tickIntermediateGoods(r: RegionSim): void {
  const currentYear = r.year;
  // Advance the per-sector output norms first so the graded raw proxy measures
  // this month against an up-to-date trailing average — and so the norm warms
  // through the pre-1920 years before any good unlocks.
  r.advanceSectorOutputNorms();
  // Drop embargoes whose window has elapsed, so the chain heals on its own and
  // the save ledger stays tidy (a stale entry would still read available, but
  // pruning keeps `rawEmbargoes` to what's actually live).
  for (const raw of Object.keys(r.rawEmbargoes)) {
    if (r.day >= r.rawEmbargoes[raw].until) delete r.rawEmbargoes[raw];
  }
  const availableGoods = INTERMEDIATE_GOODS.filter(g => currentYear >= g.eraUnlock);
  if (availableGoods.length === 0) {
    r.supplyChainHealth = 1.0;
    r._electronicsDisrupted = false;
    r.supplyShockMult = 1; // no goods, no shock (defensive — already 1.0 here)
    return;
  }

  const result = resolveSupplyChainGraded(INTERMEDIATE_GOODS, currentYear, (id) => r.rawSupplyLevel(id));

  // Stock ledger: each good produces baseOutput × its supply level and draws
  // that fraction of each held input. At level 1 (healthy play) this is
  // +baseOutput and −1 per input — byte-identical to the old binary ledger; a
  // partial level (graded embargo) accrues and consumes proportionally; level 0
  // produces nothing (key seeded to 0, as before).
  for (const good of availableGoods) {
    const level = result.levels.get(good.id) ?? 0;
    if (level >= SUPPLY_FULL_EPS) {
      r.produceGood(good.id, good.baseOutput * level);
      for (const inputId of good.inputs) {
        r.drawGood(inputId, level);
      }
    } else {
      r.seedGoodStock(good.id);
    }
  }

  // Shortfalls (1 − level) drive the random secondary effects, scaled by how
  // deep the cut is. A full cut → shortfall 1 → the exact pre-graded draw
  // (chance 0.15 / 0.3); healthy play → shortfall 0 → no draw at all, so the RNG
  // stream is byte-identical in every all-or-nothing scenario.
  const pharmaShortfall = 1 - (result.levels.get('pharmaceuticals') ?? 1);
  const electronicsShortfall = 1 - (result.levels.get('electronics') ?? 1);
  r._electronicsDisrupted = electronicsShortfall > SUPPLY_FULL_EPS;
  r.supplyChainHealth = result.health;
  // Cache the industry-output drag now, while health and `year` are the same
  // month (updateSectors reads it next month). Computing it later — at the next
  // updateSectors, after a possible Jan year-roll — would compare this health
  // against next year's structural baseline and fabricate a shock at era
  // boundaries. Pure read; the order vs. the RNG effects below is irrelevant.
  r.supplyShockMult = r.supplyShockOutputMult();

  // Secondary effects
  if (pharmaShortfall > SUPPLY_FULL_EPS && r.settlements.length > 0) {
    // Health risk: increased disease probability (push a plague event to a random settlement)
    if (r.rng.chance(0.15 * pharmaShortfall)) {
      const target = r.settlements[r.rng.int(r.settlements.length)];
      if (target && !target.activeEvents.some(e => e.kind === 'plague')) {
        target.activeEvents.push({ kind: 'plague', untilDay: r.day + 30, severity: 0.5 });
        r.addLog(`Pharmaceutical supply chain disruption — disease risk rising in ${target.name}.`, 'bad');
      }
    }
  }

  if (electronicsShortfall > SUPPLY_FULL_EPS && r.rng.chance(0.3 * electronicsShortfall)) {
    r.addLog('Electronics supply chain disrupted — research slows.', 'bad');
  }
}
