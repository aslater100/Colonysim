/**
 * Intermediate-goods production & the supply-chain cascade (Phase 15 / GDD §5.2) —
 * the fourth `region.ts` tick subsystem extracted to the roadmap's free-function
 * form `fn(r: RegionSim)` (Track C), after systems/pollution.ts, systems/services.ts
 * and systems/arbitrage.ts. The body runs against the same RegionSim so the
 * RNG-consumption order is untouched (the pharma plague-roll and the electronics
 * research-slow log are the draws), tick() dispatches, and all state + serialize()
 * stay on RegionSim.
 *
 * PR-3 slice 2 — the per-town supply solve — lives HERE (this is the home the C1
 * extraction cleared for it). The nation-wide cascade still resolves once and still
 * drives every MACRO signal (`supplyChainHealth`, the output drag, the pharma/
 * electronics secondary effects) byte-identically — a raw shortage cascades exactly
 * as before. What changed is the STOCK LEDGER: production and consumption are now
 * resolved PER TOWN against each town's own `goodStocks` (see
 * `distributeGoodProduction`). A single-town nation — and any nation whose goods are
 * co-located with their inputs — stays byte-identical (every local gate is 1); a
 * cross-sector good in a MULTI-town nation diverges by design, so the determinism
 * harness pins determinism + load-stability (not equivalence-to-base) and the
 * headless sweep pins macro stability (not a byte-for-byte base diff).
 *
 * The graded ledger accessors (`addGoodStock`/`shipGoodFrom`/`seedGoodStock`/
 * `capitalSettlement`) and the raw-availability proxy (`rawSupplyLevel`/
 * `advanceSectorOutputNorms`) stay on RegionSim beside the per-town `goodStocks`
 * store. Like systems/arbitrage.ts this imports `INTERMEDIATE_GOODS` +
 * `goodProducingSector` (values) from region.ts while region.ts imports this back —
 * a runtime import cycle that is safe because they are read only inside the function
 * bodies (call-time), so ESM live-bindings have them initialized by the time a tick
 * runs.
 */
import type { RegionSim, IntermediateGood, Settlement } from '../region';
import { INTERMEDIATE_GOODS, goodProducingSector } from '../region';
import { resolveSupplyChainGraded, SUPPLY_FULL_EPS } from '../supply';

/** The ids of every good the chain produces (vs. a primary raw). A good's input
 *  is gated by LOCAL stock only when it is one of these; raw inputs are folded
 *  into the good's nation-wide `level` by the cascade and never gate per-town.
 *  Built lazily (memoised on first tick) — NOT at module top level: `INTERMEDIATE_GOODS`
 *  comes across the region.ts↔goods.ts import cycle and is only initialised by
 *  call-time, so reading it at load would see `undefined` (the same call-time-only
 *  discipline the catalog itself follows). */
let _intermediateIds: ReadonlySet<string> | null = null;
function intermediateIds(): ReadonlySet<string> {
  return (_intermediateIds ??= new Set(INTERMEDIATE_GOODS.map((g) => g.id)));
}

/**
 * PR-3 slice 2 — distribute one good's monthly output across the towns that make
 * it, gated by each town's LOCAL holdings of the good's INTERMEDIATE inputs.
 *
 * Where slice 1's `produceGood`/`drawGood` solved the chain once on the nation
 * aggregate (deposit `baseOutput × level` split by sector weight, drain `level` of
 * each input from a single nation-wide pool), this resolves supply PER TOWN: a town
 * makes its sector-weighted share of `baseOutput × level` only to the extent it
 * physically holds (or has been shipped) the intermediate inputs that share needs,
 * and it consumes those inputs from its OWN ledger.
 *
 * Raw inputs (coal/iron/grain/…) are already folded into `level` by the nation-wide
 * cascade (`rawSupplyLevel` → the sector proxy / embargoes), so they never gate
 * here. Consequently a *single-town* nation — and any nation whose every good is
 * co-located with its inputs in the same producing sector (the bulk of the chain) —
 * is byte-identical to the old nation-wide produce/draw: the lone town holds every
 * input it produces (stocks grow unbounded), so every gate is 1 and the share is the
 * whole output. Only a CROSS-SECTOR good in a MULTI-town nation diverges
 * (`consumer_goods`/`luxury_goods` are industry-attributed yet need agri `textiles`):
 * a town with industry output but no textiles in stock underproduces them — the
 * intended new behaviour, relieved when textiles are shipped in (the gate reads the
 * town's current stock, which includes arrived cargo).
 */
function distributeGoodProduction(r: RegionSim, good: IntermediateGood, level: number): void {
  const sector = goodProducingSector(good.id);
  const ts = r.settlements;
  const weightOf = (t: Settlement): number => Math.max(0, t.sectors?.[sector]?.output ?? 0);
  // Inputs that gate per-town are the good's INTERMEDIATE inputs; raws are in `level`.
  const intermediate = intermediateIds();
  const interInputs = good.inputs.filter((i) => intermediate.has(i));

  let totalW = 0;
  for (const t of ts) totalW += weightOf(t);

  // Producing towns and their output share. With no producing-sector output
  // anywhere (a bare fixture / pre-industrial edge) the units bank in the capital,
  // gated by the capital's own holdings — the local form of `produceGood`'s
  // single-pool fallback, so that path stays consistent too.
  const producers: Array<{ t: Settlement; share: number }> = [];
  if (totalW > 0) {
    for (const t of ts) {
      const w = weightOf(t);
      if (w > 0) producers.push({ t, share: w / totalW });
    }
  } else {
    const cap = r.capitalSettlement() ?? ts[0];
    if (cap !== undefined) producers.push({ t: cap, share: 1 });
  }

  for (const { t, share } of producers) {
    const need = level * share; // units of EACH intermediate input this town's share needs
    // Liebig's law, local: the share runs only as far as its scarcest held input.
    let gate = 1;
    for (const i of interInputs) {
      const have = t.goodStocks?.[i] ?? 0;
      const frac = need > 0 ? have / need : 1;
      if (frac < gate) gate = frac;
      if (gate <= 0) break;
    }
    if (gate <= 0) continue; // town lacks an input entirely — makes none of this good
    const produced = good.baseOutput * need * gate; // = baseOutput × level × share × gate
    if (produced > 0) r.addGoodStock(t, good.id, produced);
    // Consume locally: `need × gate` ≤ each input's holding (gate ≤ have/need for
    // every input), so this debits the exact amount with nothing stranded.
    const drawn = need * gate;
    for (const i of interInputs) r.shipGoodFrom(t, i, drawn);
  }
}

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

  // The cascade still resolves ONCE on the nation aggregate — it drives the macro
  // signals (supplyChainHealth, the output drag, the secondary effects below), all
  // byte-identical to before, because a raw shortage still cascades through the
  // graph the same way. What changed (PR-3 slice 2) is the STOCK LEDGER: production
  // and consumption are now resolved PER TOWN against each town's own holdings.
  const result = resolveSupplyChainGraded(INTERMEDIATE_GOODS, currentYear, (id) => r.rawSupplyLevel(id));

  // Per-town stock ledger (catalog order is topological — a good's inputs precede
  // it — so a town's own upstream output this tick is in stock before its
  // downstream goods read it, keeping single-town/co-located play byte-identical at
  // unlock boundaries). Each active good is distributed by `distributeGoodProduction`
  // (sector-weighted share × local-input gate); a good no town could make still gets
  // a 0 entry so it stays present in the ledger (the no-op `seedGoodStock` once any
  // town tracks it — i.e. always, in healthy play).
  for (const good of availableGoods) {
    const level = result.levels.get(good.id) ?? 0;
    if (level >= SUPPLY_FULL_EPS) distributeGoodProduction(r, good, level);
    r.seedGoodStock(good.id);
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
