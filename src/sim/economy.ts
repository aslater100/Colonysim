/**
 * Economic system: markets, prices, inflation, and money supply at each tier.
 * Town tier: local market with dynamic pricing based on supply/demand
 * Region tier: unified regional market + central bank with monetary policy controls
 * Nation tier: interest rates and exchange rates for foreign trade
 */

export interface EconomyData {
  cash: number; // liquid treasury/current account
  savings: number; // reserves (grows slower than cash)
  inflation: number; // current inflation rate (0.0-1.0 = 0%-100% per year)
  marketPrices: Map<string, number>; // dynamic prices per resource kind
}

export interface RegionEconomy extends EconomyData {
  baseMoneySupply: number; // total money in circulation
  inflationTarget: number; // target inflation (default 0.02 = 2%)
  monetaryPolicyRate: number; // 0.0-2.0, controls money supply growth
}

export interface NationEconomy extends RegionEconomy {
  interestRate: number; // base interest rate for loans (0.01-0.10 = 1%-10%)
  exchangeRate: number; // foreign currency conversion rate
}

export interface Lender {
  id: number;
  name: string;
  maxLoan: number; // maximum loan this lender can give
  interestRate: number; // annual interest rate for loans from this lender
  reliability: number; // 0-100, affects willingness to lend
  liquidCash: number; // how much cash the lender currently has available
  headquartersSettlementId?: number; // where this lender is based (region tier)
}

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

/**
 * Base prices for resources in town tier (in currency units).
 * Used as reference; actual prices vary by inflation and supply.
 */
export const BASE_PRICES: Record<string, number> = {
  wood: 10,
  stone: 15,
  grain: 8,
  meal: 12,
  clothes: 20,
  weapons: 50,
};

/**
 * Initialize town-tier economy with seed money.
 */
export function createTownEconomy(startingCash: number = 500): EconomyData {
  return {
    cash: startingCash,
    savings: 0,
    inflation: 0,
    marketPrices: new Map(Object.entries(BASE_PRICES)),
  };
}

/**
 * Initialize region-tier economy from town tier savings.
 * Region starts with higher capital (consolidation of multiple towns).
 */
export function createRegionEconomy(townSavings: number = 0): RegionEconomy {
  const initialCash = 50000 + townSavings; // 50k base + transferred savings
  return {
    cash: initialCash,
    savings: initialCash * 0.2, // 20% in reserves
    inflation: 0,
    marketPrices: new Map(Object.entries(BASE_PRICES)),
    baseMoneySupply: initialCash * 2, // money multiplier effect from banking
    inflationTarget: 0.02, // 2% target inflation
    monetaryPolicyRate: 1.0, // neutral policy rate
  };
}

/**
 * Initialize nation-tier economy from regional treasury.
 */
export function createNationEconomy(regionalCash: number = 0): NationEconomy {
  const regionEcon = createRegionEconomy(regionalCash);
  return {
    ...regionEcon,
    interestRate: 0.05, // 5% default interest rate
    exchangeRate: 1.0, // 1:1 with foreign currencies initially
  };
}

/**
 * Calculate actual market price for a resource, adjusted for inflation.
 */
export function getMarketPrice(economy: EconomyData, resource: string): number {
  const basePrice = BASE_PRICES[resource] ?? 10;
  const inflationMultiplier = 1 + economy.inflation;
  return Math.round(basePrice * inflationMultiplier);
}

/**
 * Update inflation based on monetary policy and money supply.
 * Inflation increases when money supply grows faster than GDP.
 */
export function updateInflation(economy: RegionEconomy, gdp: number): void {
  const moneyToGdpRatio = economy.baseMoneySupply / Math.max(gdp, 1);
  const naturalInflation = moneyToGdpRatio - 1.0; // ratio above 1 creates inflation
  const policyAdjustment = (economy.monetaryPolicyRate - 1.0) * 0.05; // policy affects it
  economy.inflation = Math.max(0, naturalInflation + policyAdjustment);
}

/**
 * Calculate interest accrual on a loan based on elapsed time.
 */
export function calculateInterest(loan: Loan, currentTick: number): number {
  const ticksPerYear = 365 * 24 * 60 / 4; // assuming 4-minute ticks
  const yearsElapsed = (currentTick - loan.borrowedAt) / ticksPerYear;
  return loan.borrowed * loan.interestRate * yearsElapsed;
}
