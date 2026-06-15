/**
 * Ledger — the colony's credit book (build-system B-6 economy parity port).
 *
 * The fat-object region tier (`region.ts`) carries a full monetary stack: NPC
 * lenders, amortizing loans, monthly interest, defaults, plus GDP-driven
 * inflation and a central bank. Most of that machinery is region/nation tier and
 * rides on `region.ts`'s tax/credit-cycle engine — out of scope for the town-tier
 * SoA core. This module ports the slice that makes sense for a single town: a
 * handful of NPC lenders the colony can borrow gold from, loans that accrue
 * interest each month, an auto-servicer that pays scheduled installments out of
 * the colony's coin, and defaults when the coffers stay empty past the grace
 * period. It mirrors `region.ts`'s `requestLoan`/`repayLoan`/`updateLoans` so the
 * two tiers price credit the same way.
 *
 * Pure and DOM-free like the modules beside it (`raid.ts`, `wolves.ts`): it owns
 * only its lenders + loans, draws no randomness (loan ids are a deterministic
 * counter, not `Math.random` as the fat sim used), and round-trips through a
 * plain save shape. `TownCore` owns the gold; this returns the deltas to apply.
 *
 * Run the self-check:  npx tsx src/sim/ledger.ts
 */
import type { Lender, Loan } from './economy';
import { createInitialLenders, calculateMonthlyPayment } from './lenders';

/** Days the colony may miss a payment before a loan defaults (mirrors region.ts). */
const GRACE_DAYS = 90;
/** A payment cadence of 30-day months (mirrors region.ts's day-based clock). */
const MONTH_DAYS = 30;

export interface LedgerSave {
  lenders: Lender[];
  loans: Loan[];
  nextLoanId: number;
}

export interface BorrowResult {
  ok: boolean;
  loanId?: number;
  reason?: string;
}

export interface RepayResult {
  ok: boolean;
  remaining?: number;
  reason?: string;
}

/** The colony's lenders + outstanding loans. Gold lives on `TownCore`. */
export class Ledger {
  lenders: Lender[];
  loans: Loan[] = [];
  private nextLoanId = 1;

  constructor() {
    this.lenders = createInitialLenders();
  }

  /** A lender by id, or undefined. */
  lender(id: number): Lender | undefined {
    return this.lenders.find((l) => l.id === id);
  }

  /**
   * Borrow `amount` from a lender over `termMonths`, as of game-day `day`. Mirrors
   * `region.ts.requestLoan`: bounded by the lender's `maxLoan` and `liquidCash`.
   * Records the loan and ties up the lender's cash; the caller credits the gold.
   */
  borrow(lenderId: number, amount: number, termMonths: number, day: number): BorrowResult {
    const lender = this.lender(lenderId);
    if (!lender) return { ok: false, reason: 'Lender not found' };
    if (amount <= 0) return { ok: false, reason: 'Amount must be positive' };
    if (termMonths <= 0) return { ok: false, reason: 'Term must be positive' };
    if (amount > lender.maxLoan) return { ok: false, reason: `Lender offers at most ${lender.maxLoan}` };
    if (amount > lender.liquidCash) return { ok: false, reason: `Lender has only ${lender.liquidCash} available` };

    const loan: Loan = {
      id: this.nextLoanId++,
      lenderId,
      principal: amount,
      borrowed: amount,
      interestRate: lender.interestRate,
      termYears: Math.round((termMonths / 12) * 100) / 100,
      borrowedAt: day,
      nextPaymentDue: day + MONTH_DAYS,
      defaulted: false,
    };
    this.loans.push(loan);
    lender.liquidCash -= amount;
    return { ok: true, loanId: loan.id };
  }

  /**
   * Pay `amount` toward a loan as of `day`. Mirrors `region.ts.repayLoan` (minus
   * the gold check, which the caller does): reduces the balance, advances the due
   * date, and returns the cash to the lender. The caller debits the gold.
   */
  repay(loanId: number, amount: number, day: number): RepayResult {
    const loan = this.loans.find((l) => l.id === loanId);
    if (!loan) return { ok: false, reason: 'Loan not found' };
    if (loan.defaulted) return { ok: false, reason: 'Loan has defaulted' };
    if (amount <= 0) return { ok: false, reason: 'Payment must be positive' };

    loan.borrowed = Math.max(0, loan.borrowed - amount);
    // On-time payment rolls the schedule forward; a late one resets from today.
    loan.nextPaymentDue = (day <= loan.nextPaymentDue ? loan.nextPaymentDue : day) + MONTH_DAYS;
    const lender = this.lender(loan.lenderId);
    if (lender) lender.liquidCash += amount;
    this.cleanup();
    return { ok: true, remaining: loan.borrowed };
  }

  /** The fixed amortizing installment for a loan (interest + principal). */
  scheduledPayment(loan: Loan): number {
    const termMonths = Math.max(1, Math.round(loan.termYears * 12));
    return calculateMonthlyPayment(loan.principal, loan.interestRate, termMonths);
  }

  /**
   * Monthly: accrue a month's interest on every live loan and default any whose
   * payment has been overdue past the grace period. Mirrors `region.ts.updateLoans`.
   * Returns the total interest accrued (for logs / parity assertions).
   */
  accrueInterest(day: number): number {
    let accrued = 0;
    for (const loan of this.loans) {
      if (loan.defaulted) continue;
      const interest = loan.borrowed * (loan.interestRate / 12);
      loan.borrowed += interest;
      accrued += interest;
      if (day > loan.nextPaymentDue + GRACE_DAYS) {
        loan.defaulted = true;
        const lender = this.lender(loan.lenderId);
        if (lender) {
          lender.reliability = Math.max(0, lender.reliability - 10); // confidence lost
          lender.liquidCash = 0; // the lender turns cautious
        }
      }
    }
    return accrued;
  }

  /**
   * Auto-service due installments from `availableGold` (the colony pays its debts
   * before they fester). Pays each due, non-defaulted loan its scheduled installment
   * (or the remaining balance, whichever is smaller) while the coin lasts; loans it
   * can't cover fall behind and may default at the next accrual. Returns the gold
   * spent — the caller debits it.
   */
  autoService(day: number, availableGold: number): number {
    let spent = 0;
    for (const loan of this.loans) {
      if (loan.defaulted || loan.borrowed <= 0) continue;
      if (day < loan.nextPaymentDue) continue; // not due yet
      const due = Math.min(this.scheduledPayment(loan), loan.borrowed);
      if (availableGold - spent < due) continue; // can't cover it this month
      loan.borrowed = Math.max(0, loan.borrowed - due);
      loan.nextPaymentDue += MONTH_DAYS;
      const lender = this.lender(loan.lenderId);
      if (lender) lender.liquidCash += due;
      spent += due;
    }
    this.cleanup();
    return spent;
  }

  /** Outstanding balance across all live (non-defaulted) loans. */
  totalDebt(): number {
    return this.loans.reduce((sum, l) => sum + (l.defaulted ? 0 : l.borrowed), 0);
  }

  /** Drop fully-repaid loans; keep defaulted ones on the books as a black mark. */
  private cleanup(): void {
    this.loans = this.loans.filter((l) => l.borrowed > 0.01 || l.defaulted);
  }

  serialize(): LedgerSave {
    return {
      lenders: this.lenders.map((l) => ({ ...l })),
      loans: this.loans.map((l) => ({ ...l })),
      nextLoanId: this.nextLoanId,
    };
  }

  static deserialize(data: LedgerSave): Ledger {
    const led = new Ledger();
    led.lenders = data.lenders.map((l) => ({ ...l }));
    led.loans = data.loans.map((l) => ({ ...l }));
    led.nextLoanId = data.nextLoanId ?? led.loans.length + 1;
    return led;
  }
}

// --- self-check: npx tsx src/sim/ledger.ts ---
if (typeof process !== 'undefined' && process.argv[1]?.endsWith('/ledger.ts')) {
  const led = new Ledger();
  console.assert(led.lenders.length === 3, 'three NPC lenders to start');

  // Borrow within bounds; the lender's cash is tied up and the debt is on the books.
  const id0 = led.lenders[0].id;
  const cash0 = led.lenders[0].liquidCash;
  const r = led.borrow(id0, 1000, 12, 0);
  console.assert(r.ok && r.loanId !== undefined, 'a sound loan is granted');
  console.assert(led.lenders[0].liquidCash === cash0 - 1000, 'lender cash tied up');
  console.assert(Math.abs(led.totalDebt() - 1000) < 1e-9, 'debt recorded');

  // Over the cap / over available cash is refused.
  console.assert(!led.borrow(id0, 1e9, 12, 0).ok, 'over-cap loan refused');

  // Interest accrues monthly; a serviced colony pays it down.
  led.accrueInterest(0);
  console.assert(led.totalDebt() > 1000, 'a month of interest grows the balance');
  const spent = led.autoService(MONTH_DAYS, 1e6);
  console.assert(spent > 0, 'auto-service pays the due installment');

  // A starved colony that never pays defaults after the grace period.
  const led2 = new Ledger();
  led2.borrow(led2.lenders[0].id, 500, 12, 0);
  for (let m = 1; m <= 12; m++) led2.accrueInterest(m * MONTH_DAYS); // never serviced
  console.assert(led2.loans[0].defaulted, 'an unpaid loan defaults past grace');
  console.assert(led2.totalDebt() === 0, 'defaulted debt drops out of the live total');

  // Round-trip.
  const twin = Ledger.deserialize(led.serialize());
  console.assert(twin.totalDebt().toFixed(4) === led.totalDebt().toFixed(4), 'ledger round-trips');

  console.log('ledger.ts self-check OK — debt', led.totalDebt().toFixed(2),
    'serviced', spent.toFixed(2), 'lenders', led.lenders.length);
}
