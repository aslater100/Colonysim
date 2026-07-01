/**
 * Monetary & FX (GDD §5.2) — the ninth `region.ts` tick subsystem lifted to the
 * Track-C free-function form `fn(r: RegionSim, …)`. See systems/pollution.ts for the
 * rationale: each body runs VERBATIM against the same RegionSim so the
 * RNG-consumption order is byte-identical, `tick()` dispatches, and all state +
 * serialize() stay on RegionSim. The byte-identical serialize() diff is guarded by
 * tests/serialize-determinism.
 *
 * `tickMonetary` (the monthly credit-cycle / inflation / bond-service tick, gated on
 * `hasCentralBank()`) and `tickFX` (the monthly exchange-rate / regime-crisis tick)
 * are independent — no sibling calls between them. The credit-rating query
 * `computeCreditRating` (also read by `issueBonds`) and the FX queries/actions
 * `computeExchangeRate` / `devalue` / `switchCurrencyRegime` stay on RegionSim; the
 * moved bodies reach them through `r`.
 */
import type { RegionSim } from '../region';
import {
  NEUTRAL_RATE,
  SUPPLY_SHOCK_INFLATION,
  LOCAL_GOODS_INFLATION,
  FINAL_SHORTFALL_INFLATION,
  LEVERAGE_FRAGILITY,
  LEVERAGE_FRAGILE,
  FRAGILITY_GAIN,
} from '../region';

/** Monthly tick of the credit cycle, inflation, FX, and bond service. */
export function tickMonetary(r: RegionSim): void {
  const gdp = Math.max(1, r.gdpLastMonth);

  // 1. Credit cycle: leverage grows below neutral rate, shrinks above it
  const dLeverage = (NEUTRAL_RATE - r.policyRate) * 0.5 * (1 - r.privateLeverage / 5.0);
  r.privateLeverage = Math.max(0, r.privateLeverage + dLeverage);

  // 2. Inflation: credit expansion + money printing + supply-chain cost-push
  const leverageInflation = Math.max(0, dLeverage) * 0.08;
  const printInflation = r.monetaryRegime === 'print' ? 0.010 : 0;
  // Cost-push (GDD §5.2): a real supply-chain shock makes goods dearer, not just
  // scarcer — the stagflation half of the 1973 oil embargo (output already drags
  // via supplyShockMult). `supplyShockSeverity()` reads last month's cached
  // supplyChainHealth (tickIntermediateGoods runs later in the tick), a natural
  // one-month price lag, and is a pure no-RNG read. It is exactly 0 whenever raws
  // flow, so in all healthy play this term is +0 and the monetary stream is
  // byte-identical; only a genuine cascade below the era baseline lifts the target.
  const supplyPush = r.supplyShockSeverity() * SUPPLY_SHOCK_INFLATION;
  // PR-3 slice 3 — the LOCAL-goods cost-push: when specialisation strands a
  // cross-sector good (slice 2's per-town gate), the goods that can't reach the
  // towns that need them are dearer there. `localGoodsScarcity` (cached last month
  // from the production gates) is 0 in single-town / self-sufficient play — and 0
  // under a *raw* shock too, since it's a pure gate ratio, never a stock or raw
  // magnitude — so this term is +0 there (byte-identical, no double-count with
  // `supplyPush`); it lifts the target only when local distribution actually fails.
  const localGoodsPush = r.localGoodsScarcity * LOCAL_GOODS_INFLATION;
  // Increment 3 — the consumer-goods cost-push: a sustained household final-goods
  // shortage (`finalConsumptionShortfall`, the demand-side sink) makes finished goods
  // dearer, the price half of the same stagflation coupling the output drag rides.
  // Exactly 0 when `consumerDemand` is off → byte-identical (no double-count with the
  // supply/local pushes, which read raw-cascade and input-stranding, not final demand).
  const finalShortfallPush = r.finalConsumptionShortfall * FINAL_SHORTFALL_INFLATION;
  const inflTarget = 0.02 + leverageInflation + printInflation + supplyPush + localGoodsPush + finalShortfallPush;
  r.inflationRate += (inflTarget - r.inflationRate) * 0.15;
  r.inflationRate = Math.max(0, Math.min(0.50, r.inflationRate));

  // 3. Confidence: mean-reverts to 70, falls when debt service, inflation, or the
  //    leverage *level* (Minsky fragility) is high
  const debtService = r.privateLeverage * r.policyRate; // annual fraction
  const leveragePressure = Math.max(0, debtService - LEVERAGE_FRAGILITY) * 80;
  const inflPressure = Math.max(0, r.inflationRate - 0.08) * 40;
  const fragilityPressure = Math.max(0, r.privateLeverage - LEVERAGE_FRAGILE) * FRAGILITY_GAIN;
  // Depression ceiling: while depressionDepth > 0.05 confidence can't freely recover.
  // At depth=1.0 ceiling is ~35; it lifts linearly as depth fades.
  // Stimulus choice grants +10 to the ceiling; austerity +5.
  const recoveryBonus = r.crashRecoveryChoice === 'stimulus' ? 10
    : r.crashRecoveryChoice === 'austerity' ? 5 : 0;
  const depressionCeiling = r.depressionDepth > 0.05
    ? Math.round(35 + 65 * (1 - r.depressionDepth)) + recoveryBonus + r.depressionCeilingBonus
    : 100;
  const confTarget = Math.min(depressionCeiling, Math.max(5, 70 - leveragePressure - inflPressure - fragilityPressure));
  r.confidence += (confTarget - r.confidence) * 0.12;
  r.confidence = Math.max(0, Math.min(100, r.confidence));

  // 4. Deleveraging bust: confidence crash forces rapid credit contraction
  if (r.confidence < 30 && r.privateLeverage > 0.5) {
    r.privateLeverage *= (1 - (0.05 + (30 - r.confidence) * 0.002));
    if (r.rng.chance(0.2)) {
      r.addLog('Credit markets freeze — banks call in loans as confidence breaks.', 'bad');
    }
  }

  // 5. FX dynamics
  if (r.monetaryRegime === 'peg') {
    // Peg: hold exchange rate; drain reserves if trade is unfavorable
    const deficit = Math.max(0, r.totalPop() * 0.025 - r.exportEarningsLastMonth);
    r.treasury -= deficit * 0.12;
    // An exhausted treasury cannot defend a peg at all; a thin one gambles.
    if (r.treasury < gdp * 0.1 || (r.treasury < gdp * 0.25 && r.rng.chance(0.25))) {
      r.monetaryRegime = 'float';
      r.confidence = Math.max(5, r.confidence - 25);
      r.exchangeRate = Math.max(r.exchangeRate * 0.82, 0.30);
      r.addLog('The currency peg breaks — reserves exhausted. The exchange rate is in freefall.', 'bad');
    }
  } else {
    // Float/print: market-driven exchange rate
    const tradeUp = r.exportEarningsLastMonth > r.totalPop() * 0.025;
    const rateDiff = (r.policyRate - NEUTRAL_RATE) * 0.04;
    const confFlow = (r.confidence - 50) * 0.0003;
    const printDrag = r.monetaryRegime === 'print' ? -0.012 : 0;
    r.exchangeRate += (tradeUp ? 0.003 : -0.003) + rateDiff + confFlow + printDrag;
    r.exchangeRate = Math.max(0.30, Math.min(2.0, r.exchangeRate));
  }

  // 7. Print regime: money creation boosts treasury
  if (r.monetaryRegime === 'print') {
    r.treasury += gdp * 0.018;
  }

  // 8. Bond debt service
  if (r.nationalDebt > 0) {
    const service = r.nationalDebt * r.bondRate / 12;
    r.treasury -= service;
    if (r.treasury < 0) {
      r.nationalDebt -= r.treasury; // unpaid interest compounds into debt
      r.treasury = 0;
    }
  }

  // 9. Update credit rating
  r.creditRating = r.computeCreditRating();

  // 10. Inflation erodes satisfaction
  if (r.inflationRate > 0.05) {
    const drag = (r.inflationRate - 0.05) * 30;
    for (const t of r.settlements) {
      t.satisfaction = Math.max(0, t.satisfaction - drag);
    }
  }

  // 11. Transmit policy rate to private lenders — banks price above the base rate
  for (const lender of r.lenders) {
    const spread = 0.02 + lender.id * 0.005; // 2–3.5% spread; riskier lenders charge more
    lender.interestRate = Math.max(0.01, Math.min(0.20, r.policyRate + spread));
  }

  // 12. Lender liquidity regeneration — low rates encourage banks to lend freely
  for (const lender of r.lenders) {
    const recoveryRate = Math.max(0.04, 0.12 - r.policyRate); // 4–12% of max loan recovered per month
    lender.liquidCash = Math.min(lender.maxLoan * 4, lender.liquidCash + lender.maxLoan * recoveryRate);
  }

  // 13. Accrue interest on outstanding Central Bank discount window loan
  if (r.centralBankLoan > 0) {
    r.centralBankLoan += r.centralBankLoan * (r.policyRate / 12);
  }

  // 14. Keep player faction's CentralBank metadata in sync (create lazily if missing)
  const pf = r.faction(r.playerFactionId);
  if (pf) {
    if (!pf.centralBank) {
      pf.centralBank = {
        factionId: r.playerFactionId,
        foundedDay: r.day,
        reserves: {},
        interestRate: r.policyRate,
        inflationRate: r.inflationRate,
      };
    } else {
      pf.centralBank.interestRate = r.policyRate;
      pf.centralBank.inflationRate = r.inflationRate;
    }
  }
}

/** Monthly FX tick: recompute exchange rate, decay fxBoost, handle regime crises. */
export function tickFX(r: RegionSim): void {
  // Recompute exchange rate based on current conditions
  const newRate = r.computeExchangeRate();

  if (r.currencyRegime === 'gold_standard') {
    // Gold standard: rate fixed at 1.0
    r.exchangeRate = 1.0;
    // Policy rate constrained to 3–8%
    r.policyRate = Math.max(0.03, Math.min(0.08, r.policyRate));
    // Deflation pressure
    r.inflationRate = Math.max(-0.05, r.inflationRate - 0.002);
    // Crisis: if confidence drops below 40, gold standard collapses
    if (r.confidence < 40) {
      r.currencyRegime = 'fiat';
      r.exchangeRate = Math.max(0.5, r.exchangeRate - 0.2);
      r.addLog(
        'GOLD STANDARD CRISIS: Market confidence collapses. The gold peg is abandoned. ' +
        'Exchange rate falls sharply.',
        'bad'
      );
    }
  } else if (r.currencyRegime === 'fiat') {
    r.exchangeRate = newRate;
    // Fiat at very low rates: inflation creep
    if (r.policyRate < 0.02) {
      r.inflationRate = Math.min(0.50, r.inflationRate + 0.003);
    }
  } else if (r.currencyRegime === 'currency_union') {
    // Auto-exit if partner is at war with us
    const partnerAtWar = r.currencyUnionPartnerId !== undefined &&
      (r.playerWar?.rivalId === r.currencyUnionPartnerId ||
       r.foreignWars.some(w =>
         (w.a === r.currencyUnionPartnerId || w.b === r.currencyUnionPartnerId)
       ));
    if (partnerAtWar) {
      r.currencyRegime = 'fiat';
      r.currencyUnionPartnerId = undefined;
      r.addLog('Currency union dissolved — partner nation at war. Currency floats independently.', 'bad');
    } else {
      // Lock rate to partner
      const partnerRate = r.currencyUnionPartnerId !== undefined
        ? (r.exchangeRates[`0:${r.currencyUnionPartnerId}`] ?? 1.0)
        : 1.0;
      r.exchangeRate = partnerRate;
    }
  }

  // Decay fxBoost toward 1.0 by 10%/month
  if (r.fxBoost > 1.0) {
    r.fxBoost = Math.max(1.0, 1.0 + (r.fxBoost - 1.0) * 0.9);
  }
}
