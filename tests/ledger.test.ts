import { describe, expect, it } from 'vitest';
import { Ledger } from '../src/sim/ledger';
import { TownCore } from '../src/sim/towncore';
import { BASE_PRICES } from '../src/sim/economy';
import { MINUTES_PER_DAY, MINUTES_PER_TICK } from '../src/sim/defs';

// Economy parity port: lenders/loans + money-supply-driven inflation on the SoA core.

const ticksPerDay = MINUTES_PER_DAY / MINUTES_PER_TICK;
const days = (n: number) => n * ticksPerDay;

describe('Ledger — lenders & loans', () => {
  it('starts with three NPC lenders', () => {
    expect(new Ledger().lenders.length).toBe(3);
  });

  it('grants a sound loan and ties up the lender cash', () => {
    const led = new Ledger();
    const lender = led.lenders[0];
    const cash0 = lender.liquidCash;
    const r = led.borrow(lender.id, 1000, 12, 0);
    expect(r.ok).toBe(true);
    expect(r.loanId).toBeDefined();
    expect(lender.liquidCash).toBe(cash0 - 1000);
    expect(led.totalDebt()).toBeCloseTo(1000);
  });

  it('refuses over-cap, over-liquidity, and non-positive loans', () => {
    const led = new Ledger();
    const id = led.lenders[0].id;
    expect(led.borrow(id, 1e9, 12, 0).ok).toBe(false);   // over maxLoan
    expect(led.borrow(id, 0, 12, 0).ok).toBe(false);      // non-positive
    expect(led.borrow(999, 100, 12, 0).ok).toBe(false);   // unknown lender
  });

  it('accrues a month of interest on the balance', () => {
    const led = new Ledger();
    led.borrow(led.lenders[0].id, 1000, 12, 0);
    led.accrueInterest(0);
    expect(led.totalDebt()).toBeGreaterThan(1000);
  });

  it('auto-services the due installment from available gold', () => {
    const led = new Ledger();
    led.borrow(led.lenders[0].id, 1200, 12, 0);
    led.accrueInterest(30);
    const debt0 = led.totalDebt();
    const spent = led.autoService(30, 1e6);
    expect(spent).toBeGreaterThan(0);
    expect(led.totalDebt()).toBeLessThan(debt0);
  });

  it('defaults a never-serviced loan past the grace period', () => {
    const led = new Ledger();
    const lender = led.lenders[0];
    const rel0 = lender.reliability;
    led.borrow(lender.id, 500, 12, 0);
    for (let m = 1; m <= 12; m++) led.accrueInterest(m * 30); // never paid
    expect(led.loans[0].defaulted).toBe(true);
    expect(led.totalDebt()).toBe(0);                 // defaulted debt drops from the live total
    expect(lender.reliability).toBeLessThan(rel0);   // the lender sours on the colony
  });

  it('a manual repayment pays down the balance and returns cash to the lender', () => {
    const led = new Ledger();
    const lender = led.lenders[0];
    const { loanId } = led.borrow(lender.id, 1000, 12, 0);
    const cashAfterLoan = lender.liquidCash;
    const r = led.repay(loanId!, 400, 5);
    expect(r.ok).toBe(true);
    expect(r.remaining).toBeCloseTo(600);
    expect(lender.liquidCash).toBe(cashAfterLoan + 400);
  });

  it('round-trips through a save', () => {
    const led = new Ledger();
    led.borrow(led.lenders[1].id, 800, 24, 3);
    led.accrueInterest(33);
    const twin = Ledger.deserialize(JSON.parse(JSON.stringify(led.serialize())));
    expect(twin.totalDebt().toFixed(4)).toBe(led.totalDebt().toFixed(4));
    expect(twin.lenders.map((l) => l.liquidCash)).toEqual(led.lenders.map((l) => l.liquidCash));
  });
});

describe('TownCore — credit integration', () => {
  it('takeLoan credits the treasury and records the debt', () => {
    const core = new TownCore({ seed: 1 });
    core.gold = 5000;
    const r = core.takeLoan(core.ledger.lenders[0].id, 1000, 12);
    expect(r.ok).toBe(true);
    expect(core.gold).toBe(6000);
    expect(core.totalDebt()).toBeCloseTo(1000);
    expect(core.netWorth()).toBeCloseTo(5000); // gold 6000 − debt 1000
  });

  it('repayLoan debits the treasury and is refused without the gold', () => {
    const core = new TownCore({ seed: 2 });
    core.gold = 1500;
    const { loanId } = core.takeLoan(core.ledger.lenders[0].id, 1000, 12);
    expect(core.gold).toBe(2500);
    expect(core.repayLoan(loanId!, 5000).ok).toBe(false); // more than the treasury holds
    const r = core.repayLoan(loanId!, 400);
    expect(r.ok).toBe(true);
    expect(core.gold).toBe(2100);
    expect(core.totalDebt()).toBeCloseTo(600);
  });

  it('auto-services the debt monthly from the treasury as the colony ticks', () => {
    const core = new TownCore({ seed: 3 });
    core.gold = 200; // thin treasury, but the loan proceeds top it up
    core.takeLoan(core.ledger.lenders[0].id, 1000, 12);
    const debt0 = core.totalDebt();
    const gold0 = core.gold;
    core.run(days(65)); // cross two monthly boundaries (day 30 + 60)
    expect(core.totalDebt()).toBeLessThan(debt0); // installments paid down the principal
    expect(core.gold).toBeLessThan(gold0);        // and drew on the treasury
  });

  it('a loan the colony cannot service defaults', () => {
    const core = new TownCore({ seed: 4 });
    core.takeLoan(core.ledger.lenders[0].id, 1000, 12);
    core.gold = 0; // the proceeds were spent — nothing left to service the debt
    core.run(days(150)); // well past the 90-day grace
    expect(core.ledger.loans.some((l) => l.defaulted)).toBe(true);
  });

  it('inflation off by default: a debt-free colony prices at base', () => {
    const core = new TownCore({ seed: 5 });
    core.run(days(65)); // months pass, but no money is printed
    expect(core.inflation).toBe(0);
    expect(core.marketPrice('grain')).toBe(BASE_PRICES['grain']);
  });

  it('heavy borrowing prints money and lifts prices (inflation)', () => {
    const core = new TownCore({ seed: 6 });
    core.takeLoan(core.ledger.lenders[2].id, 5000, 24); // a big loan, treasury swells
    core.run(days(35)); // one monthly reckoning with the money supply elevated
    expect(core.inflation).toBeGreaterThan(0);
    expect(core.marketPrice('grain')).toBeGreaterThan(BASE_PRICES['grain']);
  });

  it('credit + inflation round-trip through a TownCore save', () => {
    const core = new TownCore({ seed: 7 });
    core.gold = 3000;
    core.takeLoan(core.ledger.lenders[0].id, 800, 12);
    core.run(days(40));
    const twin = TownCore.deserialize(JSON.parse(JSON.stringify(core.serialize())));
    expect(twin.totalDebt()).toBeCloseTo(core.totalDebt());
    expect(twin.inflation).toBe(core.inflation);
    expect(twin.gold).toBe(core.gold);
    // The restored colony stays in lockstep.
    core.run(days(40));
    twin.run(days(40));
    expect(JSON.stringify(twin.serialize())).toBe(JSON.stringify(core.serialize()));
  });
});
