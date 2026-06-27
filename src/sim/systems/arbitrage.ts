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
import type { RegionSim } from '../region';
import { INTERMEDIATE_GOODS } from '../region';
import { DAYS_PER_MONTH, formatCurrency } from '../defs';

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

/** Tick price arbitrage between player settlements (GDD §5.2: physical goods on
 *  routes, transit × congestion). Goods physically travel: a flow's arbitrage
 *  profit is paid out only when the shipment ARRIVES (after `transitDays` of
 *  travel, which congestion lengthens), and a flow whose route is severed
 *  mid-transit is lost. Where a price differential exceeds congestion costs and
 *  no shipment is already en route, a new flow is dispatched. */
export function tickPriceArbitrage(r: RegionSim): void {
  // 1. Advance in-transit shipments. Deliver those that arrive (pay out their
  //    pending income); strand those whose route has been severed.
  const stillMoving: typeof r.tradeFlows = [];
  let delivered = 0;
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
      delivered += flow.pendingIncome;
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
  if (delivered > 0) {
    r.treasury += delivered;
    if (r.rng.chance(0.1)) {
      r.addLog(`Goods arrive: shipments deliver ${formatCurrency(Math.round(delivered))} in arbitrage profit.`, 'good');
    }
  }
  if (stranded > 0 && r.rng.chance(0.15)) {
    r.addLog(`Goods stranded: a severed route loses ${stranded} shipment${stranded > 1 ? 's' : ''} in transit.`, 'bad');
  }

  // 2. Dispatch new shipments where a differential beats the congestion cost.
  const playerSettlements = r.settlements.filter(s => s.factionId === r.playerFactionId);
  if (playerSettlements.length < 2) return;

  const goodIds = INTERMEDIATE_GOODS
    .filter(g => r.year >= g.eraUnlock)
    .map(g => g.id);

  for (let i = 0; i < playerSettlements.length; i++) {
    for (let j = i + 1; j < playerSettlements.length; j++) {
      const from = playerSettlements[i];
      const to = playerSettlements[j];
      const tariff = computeCongestionTariff(r, from.id, to.id);
      if (tariff >= 0.3) continue; // no route

      // Proxy price differential from wage gap (per-good prices are a follow-on).
      const fromWage = r.avgWageOf(from);
      const toWage = r.avgWageOf(to);
      const priceDiff = Math.abs(fromWage - toWage);
      const threshold = tariff * 10;
      if (priceDiff <= threshold) continue;

      // Goods flow from the cheaper market to the dearer one (buy low, sell high).
      const buySide = fromWage > toWage ? to : from;   // lower wage/price — source
      const sellSide = fromWage > toWage ? from : to;  // higher wage/price — market

      // Only one shipment per lane at a time — wait for it to arrive before the next.
      const existing = r.tradeFlows.find(
        f => f.fromSettlementId === buySide.id && f.toSettlementId === sellSide.id
      );
      if (existing) continue;

      const volume = Math.min(10, priceDiff * 2);
      const goodId = goodIds.length > 0 ? goodIds[0] : 'components';
      // Move the real units the source town can spare (≤ volume) out of its ledger
      // now; they ride with the shipment and land at the destination on arrival.
      // The dispatch decision, transit time and pendingIncome are unchanged — the
      // cargo is purely additive bookkeeping, so the macro economy stays neutral
      // (nothing reads intermediate-stock magnitudes; the solver proxies raws off
      // sector output) while goods physically relocate between town warehouses —
      // the substrate the later per-town supply solve consumes.
      const cargo = r.shipGoodFrom(buySide, goodId, volume);
      r.tradeFlows.push({
        goodId,
        fromSettlementId: buySide.id,
        toSettlementId: sellSide.id,
        volume,
        // Congestion sets the travel time (≥1 day so a shipment always spends a
        // tick in transit); the profit lands when it arrives, not now.
        transitDays: Math.max(1, Math.round(tariff * 100)),
        congestionTariff: tariff,
        pendingIncome: volume * tariff * 5,
        cargo,
      });
    }
  }
}
