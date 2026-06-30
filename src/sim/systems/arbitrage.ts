/**
 * Price arbitrage & physical trade-route shipments (Phase 15 / GDD §5.2) — the
 * third `region.ts` tick subsystem extracted to the roadmap's free-function form
 * `fn(r: RegionSim, …)` (Track C). See systems/pollution.ts for the rationale:
 * the body runs verbatim against the same RegionSim so the RNG-consumption order
 * is untouched, tick() dispatches, all state + serialize() stay on RegionSim, and
 * the byte-identical serialize() diff is guarded by tests/serialize-determinism.
 *
 * This is the first extracted subsystem that DOES consume RNG (the delivery /
 * stranding log lines) and mutates the per-town goods ledger (`addGoodStock`/
 * `shipGoodFrom`, now public for this seam) — moving it without moving a single
 * draw is exactly what the free-function form preserves. It's the natural leaf to
 * lift now that it has grown a physical-cargo leg (PR-3 slice 1): the trade-route
 * shipment pipeline is self-contained, and pulling it out of the 14k-line monolith
 * clears the way for the per-town supply solve (PR-3 slice 2) that builds on it.
 */
import type { RegionSim, Settlement } from '../region';
import { INTERMEDIATE_GOODS } from '../region';
import { localGoodPrice } from './goods';
import { DAYS_PER_MONTH, formatCurrency } from '../defs';

/** PR-3 slice 3 — profit scale for a price-driven shipment: pendingIncome =
 *  cargo × priceGap × (1 − tariff) × this. Keeps arbitrage a minor treasury trickle
 *  (the gap is O(£1/unit), cargo ≤ the volume cap), in the spirit of the old
 *  wage-gap proxy's `volume × tariff × 5`. */
const ARBITRAGE_PROFIT_SCALE = 5;

/** Compute a congestion tariff for a goods route between two settlements.
 *  tariff = routeDistance × (1 + (1 − routeCondition/100) × 0.5), clamped 0.05–0.3. */
export function computeCongestionTariff(r: RegionSim, fromId: number, toId: number): number {
  const route = r.routes.find(
    (rt) => (rt.a === fromId && rt.b === toId) || (rt.a === toId && rt.b === fromId)
  );
  if (!route) return 0.3; // no route = maximum friction

  const routeDistance = route.path.length;
  const routeCondition = route.condition;
  const tariff = (routeDistance / 100) * (1 + (1 - routeCondition / 100) * 0.5);
  return Math.max(0.05, Math.min(0.3, tariff));
}

/** Tick price arbitrage between all settlements across every faction (GDD §5.2:
 *  physical goods on routes, transit × congestion). Goods physically travel: a
 *  flow's arbitrage profit is paid out only when the shipment ARRIVES (after
 *  `transitDays` of travel, which congestion lengthens), and a flow whose route
 *  is severed mid-transit is lost. Where a price differential exceeds congestion
 *  costs and no shipment is already en route, a new flow is dispatched. Profit
 *  is credited to the SOURCE faction's treasury (player national treasury or the
 *  rival's own faction treasury) so cross-faction trade enriches the seller. */
export function tickPriceArbitrage(r: RegionSim): void {
  // 1. Advance in-transit shipments. Deliver those that arrive (pay out their
  //    pending income to the SOURCE faction); strand those whose route is severed.
  const stillMoving: typeof r.tradeFlows = [];
  let totalDelivered = 0;
  let playerDelivered = 0;
  let stranded = 0;
  for (const flow of r.tradeFlows) {
    // A flow needs a live route the whole way; a SEVERED lane loses its cargo.
    // (A merely-congested route still delivers — only a missing one strands, so
    // test for the route's existence, not the clamped-max congestion tariff.)
    const hasRoute = r.routes.some(
      (rt) =>
        (rt.a === flow.fromSettlementId && rt.b === flow.toSettlementId) ||
        (rt.a === flow.toSettlementId && rt.b === flow.fromSettlementId),
    );
    if (!hasRoute) {
      stranded++;
      continue;
    }
    flow.transitDays -= DAYS_PER_MONTH;
    if (flow.transitDays <= 0) {
      // Credit the SOURCE faction's treasury (the seller of the surplus good).
      const srcFactionId = r.settlement(flow.fromSettlementId)?.factionId ?? r.playerFactionId;
      r.addFactionTreasury(srcFactionId, flow.pendingIncome);
      totalDelivered += flow.pendingIncome;
      if (srcFactionId === r.playerFactionId) playerDelivered += flow.pendingIncome;
      // Land the physical cargo in the destination town's ledger (the source was
      // debited on dispatch). A vanished destination simply drops the cargo.
      if (flow.cargo > 0) {
        const dest = r.settlement(flow.toSettlementId);
        if (dest !== undefined) r.addGoodStock(dest, flow.goodId, flow.cargo);
      }
    } else {
      stillMoving.push(flow);
    }
  }
  r.tradeFlows = stillMoving;
  // Gate the RNG call on any delivery (same pattern as before) so the random
  // stream is minimally perturbed in self-sufficient autoplay (no deliveries →
  // no call). Log only shows player-visible income.
  if (totalDelivered > 0) {
    if (r.rng.chance(0.1) && playerDelivered > 0) {
      r.addLog(`Goods arrive: shipments deliver ${formatCurrency(Math.round(playerDelivered))} in arbitrage profit.`, 'good');
    }
  }
  if (stranded > 0 && r.rng.chance(0.15)) {
    r.addLog(`Goods stranded: a severed route loses ${stranded} shipment${stranded > 1 ? 's' : ''} in transit.`, 'bad');
  }

  // 2. Dispatch new shipments — DEMAND-AWARE, GLOBAL. PR-3 slice 3 dropped the
  //    wage-gap proxy: each good is priced per town from its local stock vs. demand
  //    (`localGoodPrice`, in systems/goods.ts), so a town short on a good prices it
  //    dear and a flush town prices it cheap. The earlier matcher walked each town
  //    PAIR in isolation and shipped that pair's single biggest local gap — which
  //    split a scarce surplus by loop order and ignored where in the network the need
  //    was most acute. This gathers EVERY profitable (good, cheap source → dear
  //    market) opportunity across the whole network, then dispatches them
  //    largest-gap-first: the most acute shortage anywhere pulls from its cheapest
  //    reachable supplier first, and a surplus town's stock is committed to its
  //    neediest customer before any lesser one (the running `shipGoodFrom` debit means
  //    a later, smaller-gap draw on the same town sees the depleted stock). In
  //    balanced / self-sufficient play every town holds what it consumes → every price
  //    is base → no gap → no opportunity → no shipment, so this idles exactly as the
  //    per-pair form did (byte-identical until a real shortage opens a spread). Step 2
  //    consumes no RNG, so the global ordering cannot move the RNG stream — only WHICH
  //    lanes ship under a genuine shortage.
  // All settlements across every faction participate in arbitrage. A rival's towns
  // trade with each other (intra-faction) AND with the player's towns IF a route
  // connects them. `computeCongestionTariff` returns 0.3 (max) when no route exists,
  // so the tariff ≥ 0.3 guard below ensures only routed pairs ever dispatch.
  const allSettlements = r.settlements;
  if (allSettlements.length < 2) return;

  const goodIds = INTERMEDIATE_GOODS
    .filter(g => r.year >= g.eraUnlock)
    .map(g => g.id);
  if (goodIds.length === 0) return; // no goods unlocked yet → nothing to price/ship

  // Gather all profitable shipping opportunities network-wide. For each unordered town
  // pair on a live route and each unlocked good, an opportunity is the directed ship
  // cheap→dear whose per-unit price gap clears the per-unit congestion friction.
  type Opp = { goodId: string; source: Settlement; market: Settlement; gap: number; tariff: number };
  const opps: Opp[] = [];
  for (let i = 0; i < allSettlements.length; i++) {
    for (let j = i + 1; j < allSettlements.length; j++) {
      const a = allSettlements[i];
      const b = allSettlements[j];
      const tariff = computeCongestionTariff(r, a.id, b.id);
      if (tariff >= 0.3) continue; // no route
      for (const goodId of goodIds) {
        const priceA = localGoodPrice(r, a, goodId);
        const priceB = localGoodPrice(r, b, goodId);
        if (priceA === priceB) continue;
        const source = priceA < priceB ? a : b; // lower price — abundant
        const market = priceA < priceB ? b : a; // higher price — short
        const gap = Math.abs(priceA - priceB);
        // The per-unit gap must clear the per-unit congestion friction, or the trip
        // doesn't pay. (tariff ∈ [0.05, 0.3]; a cross-sector shortage opens a gap of
        // ~£1/unit, so a real shortage clears this and balanced play does not.)
        if (gap <= tariff) continue;
        opps.push({ goodId, source, market, gap, tariff });
      }
    }
  }
  if (opps.length === 0) return;

  // Largest gap first = relieve the most acute shortage first. Deterministic tie-break
  // (good id, then source/market id) so the dispatch order — and thus the serialized
  // tradeFlows — is identical run-to-run, the Track-C determinism contract.
  opps.sort((x, y) =>
    y.gap - x.gap ||
    (x.goodId < y.goodId ? -1 : x.goodId > y.goodId ? 1 : 0) ||
    x.source.id - y.source.id ||
    x.market.id - y.market.id,
  );

  // Greedily dispatch in priority order. A directed lane already carrying a shipment
  // waits for it to arrive (one in-flight shipment — one good — per DIRECTED lane, by
  // design: the existing tradeFlows model is one good per flow and one flow per lane,
  // so a lane ships only its single largest-gap good per tick; a pair can still carry a
  // DIFFERENT good in each direction). `shipGoodFrom` debits the source as we go, so once
  // a surplus town's stock is committed to its neediest market the next opportunity from
  // it sees the lower stock (and may move nothing).
  const busyLanes = new Set<string>();
  for (const f of r.tradeFlows) busyLanes.add(`${f.fromSettlementId}>${f.toSettlementId}`);
  for (const opp of opps) {
    const lane = `${opp.source.id}>${opp.market.id}`;
    if (busyLanes.has(lane)) continue;
    if ((opp.source.goodStocks?.[opp.goodId] ?? 0) <= 0) continue; // nothing left to ship
    const volume = Math.min(10, opp.gap * 5); // gap O(£1) → up to ~5–10 units
    // Move the real units the source town can spare (≤ volume) out of its ledger; they
    // ride to the dear market and relieve its shortage on arrival (its local price
    // falls as stock lands → the gate that gated its production reopens).
    const cargo = r.shipGoodFrom(opp.source, opp.goodId, volume);
    if (cargo <= 0) continue; // nothing actually moved (defensive)
    busyLanes.add(lane);
    r.tradeFlows.push({
      goodId: opp.goodId,
      fromSettlementId: opp.source.id,
      toSettlementId: opp.market.id,
      volume,
      // Congestion sets the travel time (≥1 day so a shipment always spends a tick in
      // transit); the profit lands when it arrives, not now.
      transitDays: Math.max(1, Math.round(opp.tariff * 100)),
      congestionTariff: opp.tariff,
      // Profit is the realised spread on the units shipped, eroded by congestion.
      pendingIncome: cargo * opp.gap * (1 - opp.tariff) * ARBITRAGE_PROFIT_SCALE,
      cargo,
    });
  }
}
