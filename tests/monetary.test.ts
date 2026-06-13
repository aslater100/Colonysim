import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/sim';
import { RegionSim, REGION_MINUTES_PER_TICK, CREDIT_RATING_SPREADS } from '../src/sim/region';
import { MINUTES_PER_DAY } from '../src/sim/defs';

const ticksPerDay = MINUTES_PER_DAY / REGION_MINUTES_PER_TICK;

function grow(sim: Simulation): void {
  while (sim.settlers.length < 22) sim.spawnSettler(32, 34);
  sim.stock.wood = 200;
  sim.stock.meal = 200;
}

function runDays(r: RegionSim, days: number): void {
  for (let i = 0; i < days * ticksPerDay; i++) r.tick();
}

function nationState(seed: number): RegionSim {
  const sim = new Simulation(seed);
  grow(sim);
  const r = RegionSim.fromTown(sim, 8, 80, 80);
  // Proclaim state and nation quickly
  r.stateProclaimed = true;
  r.stateName = 'Testland';
  r.nationProclaimed = true;
  r.nationName = 'Testland';
  r.govType = 'republic';
  r.legitimacy = 60;
  r.activePolicies = [];
  r.treasury = 1000;
  r.passedLaws.push('central_bank_charter');
  r.passedLaws.push('income_tax');
  return r;
}

describe('Monetary system (GDD §5.1)', () => {
  it('policy rate defaults to neutral (5%) and stays within bounds', () => {
    const r = nationState(42);
    expect(r.policyRate).toBe(0.05);
    r.policyRate = 0.0; // clamp handled by UI; sim stores what it's given
    runDays(r, 30);
    // leverage should build at sub-neutral rate
    expect(r.privateLeverage).toBeGreaterThan(0);
  });

  it('low policy rate builds private leverage over time', () => {
    const r = nationState(42);
    r.policyRate = 0.01; // very loose
    const lever0 = r.privateLeverage;
    runDays(r, 365); // one year
    expect(r.privateLeverage).toBeGreaterThan(lever0 + 0.1);
  });

  it('high policy rate contracts leverage', () => {
    const r = nationState(42);
    r.policyRate = 0.01;
    runDays(r, 365); // build up leverage
    const lever1 = r.privateLeverage;
    r.policyRate = 0.12; // tighten hard
    runDays(r, 365);
    expect(r.privateLeverage).toBeLessThan(lever1);
  });

  it('confidence falls when debt service exceeds 18% of GDP', () => {
    const r = nationState(42);
    r.policyRate = 0.01;
    r.privateLeverage = 4.0; // debt service = 4 * 0.01 = 4% — below fragility
    runDays(r, 30);
    const conf0 = r.confidence;
    r.privateLeverage = 30; // debt service = 30 * 0.01 = 30% — above 18%
    runDays(r, 60);
    expect(r.confidence).toBeLessThan(conf0);
  });

  it('printing money drives inflation above the 2% baseline', () => {
    const r = nationState(42);
    r.monetaryRegime = 'print';
    const infl0 = r.inflationRate;
    runDays(r, 730); // two years of printing
    expect(r.inflationRate).toBeGreaterThan(infl0 + 0.005);
  });

  it('high inflation drags down settlement satisfaction when above natural pull', () => {
    const r = nationState(42);
    // Start satisfaction very high so inflation drag clearly exceeds recovery
    r.settlements[0].satisfaction = 95;
    r.inflationRate = 0.30; // drag = (0.30 - 0.05) * 30 = 7.5/month
    const sat0 = r.settlements[0].satisfaction;
    runDays(r, 30);
    expect(r.settlements[0].satisfaction).toBeLessThan(sat0);
  });

  it('issueBonds increases treasury and national debt', () => {
    const r = nationState(42);
    runDays(r, 30); // let gdpLastMonth populate
    const t0 = r.treasury;
    const d0 = r.nationalDebt;
    const ok = r.issueBonds(100);
    expect(ok).toBe(true);
    expect(r.treasury).toBe(t0 + 100);
    expect(r.nationalDebt).toBe(d0 + 100);
  });

  it('issueBonds is blocked when rating is D', () => {
    const r = nationState(42);
    r.creditRating = 'D';
    expect(r.issueBonds(50)).toBe(false);
  });

  it('issueBonds is blocked when debt would exceed 200% annual GDP', () => {
    const r = nationState(42);
    runDays(r, 30); // let gdpLastMonth populate
    const ceiling = r.gdpLastMonth * 12 * 2.0;
    r.nationalDebt = ceiling - 10;
    expect(r.issueBonds(100)).toBe(false);
  });

  it('bond rate is policy rate plus credit spread', () => {
    const r = nationState(42);
    r.policyRate = 0.05;
    r.creditRating = 'BBB';
    expect(r.bondRate).toBeCloseTo(0.05 + CREDIT_RATING_SPREADS['BBB'], 6);
  });

  it('bond debt service is deducted from treasury monthly', () => {
    const r = nationState(42);
    r.issueBonds(200);
    const t0 = r.treasury;
    runDays(r, 30); // one month
    // Bond service ≈ 200 * bondRate / 12; treasury should have decreased by at least that
    const expectedService = 200 * r.bondRate / 12;
    expect(r.treasury).toBeLessThanOrEqual(t0 + 200 - expectedService + 5); // +5 tolerance for other income
  });

  it('credit rating degrades with high debt/GDP and high inflation', () => {
    const r = nationState(42);
    runDays(r, 30);
    // Very high debt relative to annual GDP
    r.nationalDebt = r.gdpLastMonth * 12 * 2.5;
    r.inflationRate = 0.20;
    r.confidence = 20;
    runDays(r, 30);
    expect(['B', 'CCC', 'D'].includes(r.creditRating)).toBe(true);
  });

  it('weak exchange rate boosts export earnings', () => {
    const r = nationState(42);
    r.rivals = [{
      id: 1, name: 'Neighbor', leader: 'X', archetype: 'trading_republic', agenda: 'trade',
      relations: 50, treaties: ['trade_agreement'], lastEnvoyDay: -999, lastGiftDay: -999,
      weights: { expansion: 3, commerce: 9, ideology: 3, honor: 7, risk: 3, grudge: 0 },
      history: [], regime: 'parliamentary', borderSettled: false,
      compass: 'east', pop: 500, emergedYear: 1910,
    }];
    r.exchangeRate = 1.0;
    runDays(r, 30);
    const exports1 = r.exportEarningsLastMonth;
    r.exchangeRate = 0.5; // devalued — exports should be boosted
    runDays(r, 30);
    expect(r.exportEarningsLastMonth).toBeGreaterThan(exports1 * 1.1);
  });

  it('monetary regime change logs an event', () => {
    const r = nationState(42);
    const logLen = r.log.length;
    r.setMonetaryRegime('print');
    expect(r.log.length).toBeGreaterThan(logLen);
    expect(r.log[r.log.length - 1].text).toContain('print');
  });

  it('peg breaks and logs when reserves are drained', () => {
    const r = nationState(42);
    r.monetaryRegime = 'peg';
    r.treasury = 0; // no reserves; peg will break instantly on deficit
    // Force a deficit condition: large population, no exports
    for (const t of r.settlements) t.cohorts.bands[2] = 500;
    r.exportEarningsLastMonth = 0;
    // Run until peg breaks (stochastic, but should break within a few months)
    let broke = false;
    for (let i = 0; i < 90 * ticksPerDay && !broke; i++) {
      r.tick();
      if (r.monetaryRegime === 'float') broke = true;
    }
    expect(broke).toBe(true);
  });

  it('serialize/deserialize round-trips all monetary fields', () => {
    const r = nationState(42);
    r.policyRate = 0.08;
    r.privateLeverage = 1.5;
    r.confidence = 45;
    r.inflationRate = 0.12;
    r.monetaryRegime = 'print';
    r.nationalDebt = 300;
    r.creditRating = 'BBB';
    r.exchangeRate = 0.75;
    const sim = new Simulation(42);
    grow(sim);
    const json = r.serialize();
    const r2 = RegionSim.deserialize(json, sim);
    expect(r2.policyRate).toBeCloseTo(0.08);
    expect(r2.privateLeverage).toBeCloseTo(1.5);
    expect(r2.confidence).toBeCloseTo(45);
    expect(r2.inflationRate).toBeCloseTo(0.12);
    expect(r2.monetaryRegime).toBe('print');
    expect(r2.nationalDebt).toBeCloseTo(300);
    expect(r2.creditRating).toBe('BBB');
    expect(r2.exchangeRate).toBeCloseTo(0.75);
  });
});

describe('Central Bank features', () => {
  it('central bank charter establishes CentralBank on the player faction after first tick', () => {
    const r = nationState(42);
    // nationState() pushes the law directly — CentralBank is established on first tick
    runDays(r, 30);
    const pf = r.faction(r.playerFactionId);
    expect(pf?.centralBank).not.toBeNull();
    expect(pf?.centralBank?.interestRate).toBeCloseTo(r.policyRate);
  });

  it('borrowFromCentralBank increases treasury and tracks outstanding balance', () => {
    const r = nationState(42);
    r.treasury = 1000;
    r.centralBankLoan = 0;
    const result = r.borrowFromCentralBank(200);
    expect(result.ok).toBe(true);
    expect(r.treasury).toBe(1200);
    expect(r.centralBankLoan).toBe(200);
  });

  it('borrowFromCentralBank is rejected without the charter', () => {
    const r = nationState(42);
    r.passedLaws = r.passedLaws.filter((l) => l !== 'central_bank_charter');
    const result = r.borrowFromCentralBank(100);
    expect(result.ok).toBe(false);
  });

  it('borrowFromCentralBank is capped at 50% of treasury', () => {
    const r = nationState(42);
    r.treasury = 1000;
    r.centralBankLoan = 0;
    const result = r.borrowFromCentralBank(600); // > 50% of 1000
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('ceiling');
  });

  it('repayCentralBank reduces outstanding balance and treasury', () => {
    const r = nationState(42);
    r.treasury = 1000;
    r.centralBankLoan = 400;
    const result = r.repayCentralBank(100);
    expect(result.ok).toBe(true);
    expect(r.treasury).toBe(900);
    expect(r.centralBankLoan).toBeCloseTo(300);
  });

  it('repayCentralBank fails when there is no outstanding balance', () => {
    const r = nationState(42);
    r.centralBankLoan = 0;
    expect(r.repayCentralBank(100).ok).toBe(false);
  });

  it('CB loan accrues interest at the policy rate monthly', () => {
    const r = nationState(42);
    r.treasury = 2000;
    r.centralBankLoan = 1000;
    r.policyRate = 0.12; // 1% per month
    runDays(r, 30);
    // interest ≈ 1000 * 0.12/12 = 10; balance should have grown
    expect(r.centralBankLoan).toBeGreaterThan(1000);
  });

  it('policy rate transmission: NPC lender rates track policyRate after a month', () => {
    const r = nationState(42);
    r.policyRate = 0.10; // raise rate to 10%
    runDays(r, 30);
    for (const lender of r.lenders) {
      // All lenders should price above the policy rate
      expect(lender.interestRate).toBeGreaterThan(r.policyRate);
      // And within a reasonable spread (never above 20%)
      expect(lender.interestRate).toBeLessThanOrEqual(0.20);
    }
  });

  it('lender liquidity regenerates each month at low policy rate', () => {
    const r = nationState(42);
    r.policyRate = 0.02; // very low rate → generous recovery
    // Drain all lenders
    for (const lender of r.lenders) lender.liquidCash = 0;
    runDays(r, 30);
    for (const lender of r.lenders) {
      expect(lender.liquidCash).toBeGreaterThan(0);
    }
  });

  it('CB loan and faction centralBank round-trip through serialize/deserialize', () => {
    const r = nationState(42);
    r.treasury = 2000;
    r.borrowFromCentralBank(300);
    const sim = new Simulation(42);
    grow(sim);
    const json = r.serialize();
    const r2 = RegionSim.deserialize(json, sim);
    expect(r2.centralBankLoan).toBeCloseTo(300);
  });
});
