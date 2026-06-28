/**
 * NPC Lender system: bankers and merchants who offer loans.
 * Lenders and the loans they issue are the only economy types shared across
 * tiers; the active monetary model (inflation, rates, FX, loan servicing)
 * lives in RegionSim.tickMonetary / requestLoan, not here.
 */

/** A banker/merchant who can offer loans (region/nation tier). */
export interface Lender {
  id: number;
  name: string;
  maxLoan: number; // maximum loan this lender can give
  interestRate: number; // annual interest rate for loans from this lender
  reliability: number; // 0-100, affects willingness to lend
  liquidCash: number; // how much cash the lender currently has available
  headquartersSettlementId?: number; // where this lender is based (region tier)
}

/** An outstanding loan taken from a Lender (serialized on RegionSim). */
export interface Loan {
  id: number;
  lenderId: number;
  principal: number; // initial loan amount
  borrowed: number; // amount still owed
  interestRate: number; // annual interest rate
  termYears: number; // loan duration in years
  borrowedAt: number; // tick when loan was taken
  nextPaymentDue: number; // next tick when payment is due
  defaulted: boolean;
}

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
