/**
 * Supply-chain cascade solver (GDD §5.2, roadmap "D1-econ").
 *
 * The intermediate-goods graph is a DAG: raw materials (coal, iron, copper)
 * feed `chemicals`, which feed `components`/`pharmaceuticals`, which feed
 * `electronics`/`vehicles`. The GDD promises that a shortage *propagates* —
 * "no chemicals → no pharmaceuticals → health crisis." Lose coal and you lose
 * chemicals, and with it everything downstream.
 *
 * This module computes that propagation as a pure, deterministic topological
 * pass: a good is **supplied** iff every one of its inputs is supplied, ground
 * out at the raw materials (`rawAvailable`). No RNG, no I/O, no `RegionSim`
 * coupling — so it unit-tests in plain Node, and the caller keeps full control
 * of the stock ledger and any random secondary effects.
 *
 * Why a solver and not the old inline check: the previous logic treated an
 * intermediate input as available whenever its *buffer stock* was positive.
 * Because each good produces far more than it consumes, those buffers grew
 * without bound and a shortage could never reach downstream — the cascade the
 * GDD describes was dead. Resolving availability through the graph (a good can
 * only feed its consumers if it is itself producing this period) restores it.
 */

/** The shape this solver needs from an intermediate good. `RegionSim`'s
 *  `IntermediateGood` is structurally compatible (it has these and a `name`). */
export interface SupplyGood {
  /** Stable identifier, also used as an input reference by downstream goods. */
  id: string;
  /** Calendar year this good becomes producible. */
  eraUnlock: number;
  /** Input ids: either a raw material or another good's id. */
  inputs: string[];
  /** Units produced per period when fully supplied (carried for callers). */
  baseOutput: number;
}

export interface SupplyResolution {
  /** Ids of goods unlocked this period (year ≥ eraUnlock), in catalog order. */
  active: string[];
  /** Active goods that could NOT be fully supplied — cascade-aware. */
  disrupted: Set<string>;
  /** Active goods that produced this period (active minus disrupted). */
  supplied: Set<string>;
  /** Fraction of active goods fully supplied, 0..1 (1.0 when none are active). */
  health: number;
}

export interface SupplyResolutionGraded extends SupplyResolution {
  /** good id → supply *level* in [0,1] this period: how fully it could run given
   *  its scarcest input. The boolean `disrupted`/`supplied` sets above are derived
   *  by thresholding this at 1 (a good at level < 1 is `disrupted`). */
  levels: Map<string, number>;
}

/** Levels within this of 1.0 count as "fully supplied" — guards float drift so a
 *  raw nominally at 1.0 doesn't read as a phantom shortage. */
export const SUPPLY_FULL_EPS = 1e-9;

/**
 * Identify the raw materials of a goods graph: every input id that is not
 * itself produced by some good in the catalog. (coal, iron, copper for the
 * shipping set.) Order-stable and de-duplicated. Useful to callers wiring up a
 * `rawAvailable` predicate and to tests asserting graph shape.
 */
export function rawMaterialsOf(goods: SupplyGood[]): string[] {
  const produced = new Set(goods.map((g) => g.id));
  const raws: string[] = [];
  const seen = new Set<string>();
  for (const g of goods) {
    for (const input of g.inputs) {
      if (!produced.has(input) && !seen.has(input)) {
        seen.add(input);
        raws.push(input);
      }
    }
  }
  return raws;
}

/**
 * Resolve the supply chain for one period.
 *
 * @param goods       full goods catalog (any era).
 * @param year        current sim year; goods with `eraUnlock > year` are inert.
 * @param rawAvailable predicate over RAW input ids (coal/iron/copper, …). Only
 *        ever queried for raw materials — intermediate inputs resolve through
 *        the graph, never through this callback.
 *
 * Determinism: pure function of its arguments. Iteration follows catalog order;
 * the result Sets are only ever queried by membership/size, never iterated for
 * side effects, so callers stay deterministic too. Pathological input cycles
 * are treated as unmet (a good that (transitively) depends on itself cannot
 * bootstrap) rather than looping forever.
 */
export function resolveSupplyChain(
  goods: SupplyGood[],
  year: number,
  rawAvailable: (id: string) => boolean,
): SupplyResolution {
  const active = goods.filter((g) => year >= g.eraUnlock);
  if (active.length === 0) {
    return { active: [], disrupted: new Set(), supplied: new Set(), health: 1 };
  }

  // Goods producible this period, by id. A good in the catalog but not here is
  // either locked (era not reached) or simply absent — either way it cannot
  // supply a consumer this period.
  const activeById = new Map<string, SupplyGood>();
  for (const g of active) activeById.set(g.id, g);
  const known = new Set(goods.map((g) => g.id));

  const status = new Map<string, boolean>(); // good id → fully supplied this period
  const visiting = new Set<string>(); // recursion guard for cycle safety

  const inputSupplied = (inputId: string): boolean => {
    const producer = activeById.get(inputId);
    if (producer) return goodSupplied(producer);
    // Not producible here. A *known* good that is merely locked this era can't
    // supply; a genuinely raw input falls back to the availability predicate.
    return known.has(inputId) ? false : rawAvailable(inputId);
  };

  function goodSupplied(g: SupplyGood): boolean {
    const cached = status.get(g.id);
    if (cached !== undefined) return cached;
    if (visiting.has(g.id)) return false; // cycle → cannot bootstrap → unmet
    visiting.add(g.id);
    const ok = g.inputs.every(inputSupplied);
    visiting.delete(g.id);
    status.set(g.id, ok);
    return ok;
  }

  const disrupted = new Set<string>();
  const supplied = new Set<string>();
  for (const g of active) {
    if (goodSupplied(g)) supplied.add(g.id);
    else disrupted.add(g.id);
  }

  return {
    active: active.map((g) => g.id),
    disrupted,
    supplied,
    health: supplied.size / active.length,
  };
}

/**
 * Graded variant of {@link resolveSupplyChain}: instead of a binary
 * available/cut predicate, each raw reports an availability *level* in [0,1]
 * (1 = flowing freely, 0.4 = a 60%-cut embargo, 0 = total cut). A good's supply
 * level is the **minimum** of its input levels — Liebig's law of the minimum:
 * a fixed-recipe line runs only as fast as its scarcest input, so a half-cut on
 * any one input halves the good (and that scarcity cascades to its consumers).
 *
 * Health is the **mean** supply level over active goods. This is a strict
 * generalisation of the boolean solver: when every raw level is exactly 0 or 1,
 * each good's level is 0 or 1, the mean equals `supplied/active`, and the
 * `supplied`/`disrupted` sets are identical — so wiring this in is byte-identical
 * in any all-or-nothing scenario (i.e. all current play, where raws either flow
 * or don't). Only a genuinely *partial* raw level (graded embargo, strained
 * extraction) produces a fractional level the old solver couldn't express.
 *
 * Determinism, cycle-safety and iteration order match `resolveSupplyChain`.
 */
export function resolveSupplyChainGraded(
  goods: SupplyGood[],
  year: number,
  rawLevel: (id: string) => number,
): SupplyResolutionGraded {
  const active = goods.filter((g) => year >= g.eraUnlock);
  if (active.length === 0) {
    return { active: [], disrupted: new Set(), supplied: new Set(), levels: new Map(), health: 1 };
  }

  const activeById = new Map<string, SupplyGood>();
  for (const g of active) activeById.set(g.id, g);
  const known = new Set(goods.map((g) => g.id));

  const levels = new Map<string, number>(); // good id → supply level this period
  const visiting = new Set<string>();
  const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

  const inputLevel = (inputId: string): number => {
    const producer = activeById.get(inputId);
    if (producer) return goodLevel(producer);
    // A known-but-locked good can't supply this era; a true raw falls back to the
    // (clamped) availability level. NaN guards to 0 so a bad predicate can't poison.
    if (known.has(inputId)) return 0;
    const lvl = rawLevel(inputId);
    return Number.isFinite(lvl) ? clamp01(lvl) : 0;
  };

  function goodLevel(g: SupplyGood): number {
    const cached = levels.get(g.id);
    if (cached !== undefined) return cached;
    if (visiting.has(g.id)) return 0; // cycle → cannot bootstrap → unmet
    visiting.add(g.id);
    let lvl = 1;
    for (const input of g.inputs) {
      lvl = Math.min(lvl, inputLevel(input));
      if (lvl <= 0) break; // a fully-cut input zeroes the good; nothing recovers it
    }
    visiting.delete(g.id);
    levels.set(g.id, lvl);
    return lvl;
  }

  const disrupted = new Set<string>();
  const supplied = new Set<string>();
  let sum = 0;
  for (const g of active) {
    const lvl = goodLevel(g);
    sum += lvl;
    if (lvl >= 1 - SUPPLY_FULL_EPS) supplied.add(g.id);
    else disrupted.add(g.id);
  }

  return {
    active: active.map((g) => g.id),
    disrupted,
    supplied,
    levels,
    health: sum / active.length,
  };
}
