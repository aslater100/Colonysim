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
 * PR-3 slice 3 — per-good local PRICES & the local-goods scarcity macro signal.
 *
 * Slice 2 made each town produce a good only up to a LOCAL input gate, so a
 * specialised town strands cross-sector goods — but nothing read that into the
 * economy (macro-neutral). Slice 3 closes the loop two ways:
 *
 *  - a per-town per-good PRICE (`localGoodPrice`) that rises as a town's stock of a
 *    good falls below its local demand, so ARBITRAGE (systems/arbitrage.ts) ships
 *    each good from where it's cheap (abundant) to where it's dear (short) — a
 *    deprived town pulls the shipment it needs, where slice 1's wage-gap proxy
 *    shipped a fixed good in the wrong-priced direction;
 *  - a nation-wide LOCAL-GOODS SCARCITY index (`r.localGoodsScarcity`, cached each
 *    month from the per-town production GATES) that feeds the cost-push inflation +
 *    industry-output drag in region.ts. Driving the macro index off the GATE (not
 *    off stock magnitudes) keeps it the PURE slice-2-divergence signal: it is
 *    exactly 0 whenever every gate is 1 (single-town / self-sufficient play, in a
 *    boom OR a raw shock alike), so that play stays byte-identical and the index
 *    never double-counts the raw cascade (which already drives `supplyShockSeverity`
 *    through `level`); it is positive only when specialisation strands a good.
 *
 * Only TRACKED goods are priced — a raw is never in `goodStocks`, so no raw
 * magnitude can couple into the economy here (the load-bearing invariant slice 2's
 * review flagged for this slice). */

/** Price elevation at full local scarcity: an empty-but-demanded good costs
 *  (1 + GAIN)× its base, a well-stocked good its base. 1.0 → the price doubles when
 *  a town is fully starved. (Lives here, not region.ts — only the goods system
 *  shapes prices; the MACRO dials `LOCAL_GOODS_INFLATION`/`LOCAL_GOODS_OUTPUT_DRAG`
 *  live in region.ts beside the other goods→economy coupling constants.) */
const LOCAL_GOODS_PRICE_GAIN = 1.0;

/** Base £-value of one unit of a good, by refinement depth: 1 + the count of its
 *  INTERMEDIATE inputs (raw-fed goods like lumber/steel are cheap, deeply-processed
 *  finals like vehicles/luxury_goods dear). Catalog-derived + memoised, so it needs
 *  no serialized state; it weights a good's local price so arbitrage prefers the
 *  dearer good when two goods have a similar scarcity gap. */
let _basePrice: Map<string, number> | null = null;
function goodBasePrice(goodId: string): number {
  if (_basePrice === null) {
    const inter = intermediateIds();
    _basePrice = new Map(
      INTERMEDIATE_GOODS.map((g) => [g.id, 1 + g.inputs.filter((i) => inter.has(i)).length]),
    );
  }
  return _basePrice.get(goodId) ?? 1;
}

/** Town t's share (0..1) of a producing sector's nation-wide output — the same
 *  weight `distributeGoodProduction` splits a good's output by. 0 when the sector
 *  makes nothing anywhere. */
function sectorShare(r: RegionSim, t: Settlement, sector: 'industry' | 'agriculture'): number {
  let total = 0;
  for (const s of r.settlements) total += Math.max(0, s.sectors?.[sector]?.output ?? 0);
  if (total <= 0) return 0;
  return Math.max(0, t.sectors?.[sector]?.output ?? 0) / total;
}

/** Local monthly DEMAND for an intermediate good g in town t: the units of g drawn
 *  as an INPUT by the goods t produces — its full-supply consumption appetite (what
 *  the town WANTS, independent of whether it's met). For each unlocked good c that
 *  lists g among its inputs, t's share of c's output draws ~`share(t, sectorOf(c))`
 *  units of g (slice 2's per-input `need` at level 1). Raws are never demanded here
 *  (only tracked goods are priced); a good no local town consumes has demand 0. */
export function localGoodDemand(r: RegionSim, t: Settlement, goodId: string): number {
  if (!intermediateIds().has(goodId)) return 0;
  const year = r.year;
  let demand = 0;
  for (const c of INTERMEDIATE_GOODS) {
    if (year < c.eraUnlock) continue;
    if (!c.inputs.includes(goodId)) continue;
    demand += sectorShare(r, t, goodProducingSector(c.id));
  }
  return demand;
}

/** Local scarcity of a good in a town, 0..1: how far its stock falls short of its
 *  local demand. 0 when the town holds at least its demand (a producer, or shipped
 *  in); 1 when it consumes the good but holds none. 0 for an un-demanded good. */
function stockScarcity(stock: number, demand: number): number {
  if (demand <= 0) return 0;
  const s = 1 - stock / demand;
  return s <= 0 ? 0 : s >= 1 ? 1 : s;
}

/** Per-town local PRICE of an intermediate good (£/unit): basePrice × (1 + scarcity
 *  × GAIN). A town flush with the good (a producer, or one shipped a surplus) prices
 *  it at base; a town that consumes it but holds none prices it at base × (1 + GAIN).
 *  Pure read off `goodStocks` (never a raw), so it can't couple a raw magnitude into
 *  the economy. Used by arbitrage to ship goods from cheap (abundant) to dear
 *  (short) towns. */
export function localGoodPrice(r: RegionSim, t: Settlement, goodId: string): number {
  const demand = localGoodDemand(r, t, goodId);
  const stock = t.goodStocks?.[goodId] ?? 0;
  return goodBasePrice(goodId) * (1 + stockScarcity(stock, demand) * LOCAL_GOODS_PRICE_GAIN);
}

/**
 * LEG 1 of the global-world arc — the WORLD MARKET reference price.
 *
 * Until now every price was per-town and the only market that ever cleared was
 * the PLAYER nation's: `tickPriceArbitrage` ships goods only between the player's
 * own settlements (arbitrage.ts), rivals trade in no market at all, and a good's
 * scarcity is read only into the player's macro. The world is REGIONAL — the
 * headline structural weak area.
 *
 * This is the first global-market substrate: a single CLEARING price per good,
 * formed from TOTAL world supply (every faction's held stock of the good) vs.
 * TOTAL world demand (every settlement's local appetite for it). It is the same
 * scarcity→price curve `localGoodPrice` uses, lifted from one town to the whole
 * world, so a good the world is collectively short of prices dear and a glut
 * prices at base.
 *
 * Pure / read-only — it reads the existing `goodStocks` + the demand the towns
 * already imply, mutates nothing, and is consumed by telemetry only (no tick math,
 * no serialized field) → BYTE-IDENTICAL. In balanced / self-sufficient play every
 * town holds its own demand, so world supply ≥ world demand → tightness 0 → price
 * == base, exactly mirroring `localGoodPrice`'s dormancy. The ACTIVATION (cross-
 * faction trade clearing at this price; anchoring `localGoodPrice` to it) is a
 * deliberate later re-baseline, sequenced in the handoff.
 */

/** Total units of a good held across EVERY settlement in the world (all factions). */
export function worldGoodSupply(r: RegionSim, goodId: string): number {
  let supply = 0;
  for (const t of r.settlements) supply += t.goodStocks?.[goodId] ?? 0;
  return supply;
}

/** Total monthly DEMAND for a good across EVERY settlement in the world. */
export function worldGoodDemand(r: RegionSim, goodId: string): number {
  let demand = 0;
  for (const t of r.settlements) demand += localGoodDemand(r, t, goodId);
  return demand;
}

/** World market CLEARING price (£/unit): basePrice × (1 + worldScarcity × GAIN) —
 *  the `localGoodPrice` curve lifted from one town to the whole world. base when
 *  world supply meets world demand, up to (1+GAIN)× when the world holds none of a
 *  demanded good. A 0-demand (or un-tracked) good prices at base. */
export function worldGoodPrice(r: RegionSim, goodId: string): number {
  if (!intermediateIds().has(goodId)) return goodBasePrice(goodId);
  const demand = worldGoodDemand(r, goodId);
  const supply = worldGoodSupply(r, goodId);
  return goodBasePrice(goodId) * (1 + stockScarcity(supply, demand) * LOCAL_GOODS_PRICE_GAIN);
}

/** World market TIGHTNESS ∈ [0,1]: the demand-weighted mean world scarcity across
 *  every unlocked good — 0 when the world is collectively self-sufficient (balanced
 *  play, every good), rising toward 1 as the world runs collectively short. The
 *  single-number read of the world market's state (telemetry / a future coupling). */
export function worldMarketTightness(r: RegionSim): number {
  let weighted = 0;
  let totalDemand = 0;
  for (const g of INTERMEDIATE_GOODS) {
    if (r.year < g.eraUnlock) continue;
    const demand = worldGoodDemand(r, g.id);
    if (demand <= 0) continue;
    const supply = worldGoodSupply(r, g.id);
    weighted += stockScarcity(supply, demand) * demand;
    totalDemand += demand;
  }
  return totalDemand > 0 ? weighted / totalDemand : 0;
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
function distributeGoodProduction(
  r: RegionSim,
  good: IntermediateGood,
  level: number,
): { potential: number; lost: number } {
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

  // Track the output a local input shortage cost the nation this month — the pure
  // slice-2-divergence signal the macro index (`r.localGoodsScarcity`) reads. A
  // town's full-supply output is `baseOutput × need`; the gate trims it, and the
  // shortfall (1 − gate) is what specialisation stranded (single-town / self-
  // sufficient nations keep every gate at 1, so `lost` is 0 → the index is 0).
  let potential = 0;
  let lost = 0;
  for (const { t, share } of producers) {
    const need = level * share; // units of EACH intermediate input this town's share needs
    const full = good.baseOutput * need; // output at gate 1 (the full sector-weighted share)
    potential += full;
    // Liebig's law, local: the share runs only as far as its scarcest held input.
    let gate = 1;
    for (const i of interInputs) {
      const have = t.goodStocks?.[i] ?? 0;
      const frac = need > 0 ? have / need : 1;
      if (frac < gate) gate = frac;
      if (gate <= 0) break;
    }
    lost += full * (1 - gate);
    if (gate <= 0) continue; // town lacks an input entirely — makes none of this good
    const produced = good.baseOutput * need * gate; // = baseOutput × level × share × gate
    if (produced > 0) r.addGoodStock(t, good.id, produced);
    // Consume locally: `need × gate` ≤ each input's holding (gate ≤ have/need for
    // every input), so this debits the exact amount with nothing stranded.
    const drawn = need * gate;
    for (const i of interInputs) r.shipGoodFrom(t, i, drawn);
  }
  return { potential, lost };
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
    r.localGoodsScarcity = 0; // no goods, no local shortage
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
  let lostTotal = 0;
  let potentialTotal = 0;
  for (const good of availableGoods) {
    const level = result.levels.get(good.id) ?? 0;
    if (level >= SUPPLY_FULL_EPS) {
      const acc = distributeGoodProduction(r, good, level);
      potentialTotal += acc.potential;
      lostTotal += acc.lost;
    }
    r.seedGoodStock(good.id);
  }
  // PR-3 slice 3 — the nation-wide local-goods scarcity index: the fraction of this
  // month's intended manufactured output that a LOCAL input shortage cost (the
  // per-town gates above). 0 when every town made its full share (single-town /
  // self-sufficient play — byte-identical), positive only where specialisation
  // stranded a cross-sector good. Read next month by the cost-push + industry drag
  // (region.ts). Bounded [0,1]; a pure gate ratio, so it never reads a stock
  // magnitude or a raw level (no double-count with the raw cascade's severity).
  r.localGoodsScarcity = potentialTotal > 0 ? lostTotal / potentialTotal : 0;

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
