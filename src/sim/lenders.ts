/**
 * NPC Lender system: bankers and merchants who offer loans at varying interest rates.
 * Lender availability is gated by tier and building requirements.
 * Interest is calculated annually; loans default if payments are missed.
 */

import { Lender, Loan } from './economy';

export function createInitialLenders(): Lender[] {
  const lenders: Lender[] = [];
  const lenderNames = [
    'Aldrich the Goldkeeper',
    'Moneylender\'s Guild',
    'The River Merchant',
    'Crown Bank',
    'Blackwell Finance',
  ];

  for (let i = 0; i < 3; i++) {
    lenders.push({
      id: i,
      name: lenderNames[i],
      maxLoan: 5000 + i * 1000, // £5k, £6k, £7k — useful for cash flow, not gate-clearing
      interestRate: 0.05 + i * 0.01, // 5%, 6%, 7% annual interest
      reliability: 80 - i * 5, // 80, 75, 70 reliability scores
      liquidCash: 15000 + i * 3000, // £15k, £18k, £21k available capital
    });
  }

  return lenders;
}

/**
 * Check if a player can borrow from a lender.
 * Availability gates: region tier and building requirements.
 */
export function canBorrowFromLender(
  hasMarketBuilding: boolean,
  hasBankBuilding: boolean,
  tier: 'town' | 'region' | 'nation'
): boolean {
  // Town tier: no lending available
  if (tier === 'town') return false;

  // Region tier: requires Market building at minimum
  if (tier === 'region') {
    return hasMarketBuilding;
  }

  // Nation tier: Bank building unlocks better lenders
  if (tier === 'nation') {
    return hasBankBuilding;
  }

  return false;
}

/**
 * Calculate monthly payment amount for a loan using standard amortization.
 * Formula: P * [r(1+r)^n] / [(1+r)^n - 1]
 * where P = principal, r = monthly rate, n = number of months
 */
export function calculateMonthlyPayment(
  principal: number,
  annualRate: number,
  termMonths: number
): number {
  const monthlyRate = annualRate / 12;
  if (monthlyRate === 0) {
    return principal / termMonths; // no interest: simple division
  }
  const numerator = principal * monthlyRate * Math.pow(1 + monthlyRate, termMonths);
  const denominator = Math.pow(1 + monthlyRate, termMonths) - 1;
  return Math.round(numerator / denominator);
}

/**
 * Create a new loan from a lender to the player.
 */
export function createLoan(
  lender: Lender,
  principal: number,
  termMonths: number,
  currentTick: number
): Loan {
  const ticksPerMonth = 30 * 24 * 60 / 4; // assuming 4-minute ticks, 30-day months
  return {
    // Deterministic unique id from (lender, tick) — never Math.random, so a
    // serialized loan stays reproducible for a fixed seed.
    id: lender.id * 1_000_000 + currentTick,
    lenderId: lender.id,
    principal,
    borrowed: principal,
    interestRate: lender.interestRate,
    termYears: Math.round(termMonths / 12 * 100) / 100,
    borrowedAt: currentTick,
    nextPaymentDue: currentTick + ticksPerMonth, // first payment due 1 month from now
    defaulted: false,
  };
}

/**
 * Calculate total interest owed on a loan.
 * Interest = principal * rate * (time elapsed in years)
 */
export function calculateTotalInterest(loan: Loan, currentTick: number): number {
  const ticksPerYear = 365 * 24 * 60 / 4; // assuming 4-minute ticks
  const yearsElapsed = Math.max(0, (currentTick - loan.borrowedAt) / ticksPerYear);
  return loan.principal * loan.interestRate * yearsElapsed;
}

/**
 * Calculate total amount owed (principal + interest) on a loan.
 */
export function calculateTotalOwed(loan: Loan, currentTick: number): number {
  return loan.borrowed + calculateTotalInterest(loan, currentTick);
}

/**
 * Check if a loan payment is overdue.
 */
export function isPaymentOverdue(loan: Loan, currentTick: number, gracePeriodTicks: number = 0): boolean {
  return !loan.defaulted && currentTick > loan.nextPaymentDue + gracePeriodTicks;
}

/**
 * Process a loan payment by the player.
 * Returns the remaining balance after payment.
 */
export function processLoanPayment(
  loan: Loan,
  paymentAmount: number,
  currentTick: number
): number {
  if (loan.defaulted) {
    return loan.borrowed; // no payment on defaulted loans
  }

  loan.borrowed = Math.max(0, loan.borrowed - paymentAmount);

  // Move next payment due forward by 1 month
  const ticksPerMonth = 30 * 24 * 60 / 4;
  loan.nextPaymentDue = Math.max(loan.nextPaymentDue, currentTick) + ticksPerMonth;

  return loan.borrowed;
}

/**
 * Mark a loan as defaulted when payment is missed beyond grace period.
 */
export function defaultLoan(loan: Loan): void {
  loan.defaulted = true;
}
