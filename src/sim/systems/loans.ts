/**
 * Loan servicing (GDD §5.2) — Track-C tick subsystem lifted to fn(r: RegionSim).
 * Body VERBATIM (this.→r.); tick() dispatches; state + serialize() stay on
 * RegionSim. Monthly interest accrual, 90-day-grace default, and repaid-loan sweep.
 */
import type { RegionSim } from '../region';

  /**
   * Called monthly to process loan interest accrual and check for defaults.
   */
export function updateLoans(r: RegionSim): void {
    for (const loan of r.loans) {
      if (loan.defaulted) continue;

      // Calculate interest accrued this month
      const monthlyRate = loan.interestRate / 12;
      const interestThisMonth = loan.borrowed * monthlyRate;
      loan.borrowed += interestThisMonth;

      // Check for default: payment overdue by 90+ days (3 months grace)
      if (r.day > loan.nextPaymentDue + 90 && !loan.defaulted) {
        loan.defaulted = true;
        const lender = r.lenders.find((l) => l.id === loan.lenderId);
        if (lender) {
          lender.reliability = Math.max(0, lender.reliability - 10); // lender loses confidence in player
          lender.liquidCash = 0; // lender becomes cautious
        }
        r.addLog(
          `Loan from ${lender?.name ?? 'lender'} has defaulted. Credit damaged.`,
          'bad',
        );
      }
    }

    // Remove fully repaid loans
    r.loans = r.loans.filter((l) => l.borrowed > 0.01 || l.defaulted);
  }
