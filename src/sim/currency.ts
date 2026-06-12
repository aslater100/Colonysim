/**
 * Currency regime changes with cause-based penalties (GDD §5.1 extension).
 *
 * Switching currency is always possible but never free. How much it hurts
 * depends on WHY you switched, whether you telegraphed it, and how deep your
 * reserves run. Prepared, justified switches read as policy; surprise switches
 * read as caprice — and markets price caprice harshly.
 */
import type { CurrencySymbol } from './defs';

/** Why the currency is changing — determines how markets react. */
export type CurrencyChangeCause =
  /** Forced by recession/crash: markets expected it, penalties are light. */
  | 'crisis'
  /** New government, new doctrine: markets are nervous but understanding. */
  | 'political'
  /** No external reason: markets punish the whim. */
  | 'strategic';

export interface CurrencyChangePenalty {
  /** Output multiplier applied while the disruption runs (0.70–0.95). */
  efficiencyMult: number;
  /** Fraction of treasury lost immediately to capital flight (0.01–0.15). */
  capitalFlightFrac: number;
  /** Days until markets fully stabilize. */
  recoveryDays: number;
  /** Human-readable framing for the log. */
  narrative: string;
}

export interface CurrencyTransition {
  newSymbol: CurrencySymbol;
  cause: CurrencyChangeCause;
  /** Day the disruption ends; efficiency recovers linearly until then. */
  endDay: number;
  /** Efficiency multiplier at the start of the disruption. */
  startEfficiencyMult: number;
  /** Day the transition began. */
  startDay: number;
}

/** A telegraphed future switch: announcing 6+ months out softens the shock. */
export interface CurrencyAnnouncement {
  newSymbol: CurrencySymbol;
  announcedDay: number;
}

/** Announcing the switch at least this many days ahead earns the discount. */
export const ANNOUNCE_LEAD_DAYS = 180;
/** Penalty reduction for a telegraphed switch. */
export const ANNOUNCE_DISCOUNT = 0.25;

const CAUSE_PENALTIES: Record<CurrencyChangeCause, CurrencyChangePenalty> = {
  crisis: {
    efficiencyMult: 0.93, // 5–8% efficiency hit
    capitalFlightFrac: 0.015, // 1–2% capital flight
    recoveryDays: 450, // 12–18 months
    narrative: 'We had to do this — markets understand.',
  },
  political: {
    efficiencyMult: 0.875, // 10–15% efficiency hit
    capitalFlightFrac: 0.065, // 5–8% capital flight
    recoveryDays: 720, // 18–30 months
    narrative: 'Markets are nervous: will the new regime stay committed?',
  },
  strategic: {
    efficiencyMult: 0.75, // 20–30% efficiency hit
    capitalFlightFrac: 0.125, // 10–15% capital flight
    recoveryDays: 900, // 2–3 years
    narrative: 'Markets punish the whim: why would you do this?',
  },
};

/**
 * Compute the penalty for a currency switch.
 *
 * @param cause why the switch is happening
 * @param announced true if the switch was telegraphed ANNOUNCE_LEAD_DAYS ahead
 * @param reserveRatio treasury ÷ monthly GDP — each full month of reserves
 *        shaves capital flight by ~2.5%, capped at half the flight.
 */
export function computePenalty(
  cause: CurrencyChangeCause,
  announced: boolean,
  reserveRatio: number,
): CurrencyChangePenalty {
  const base = CAUSE_PENALTIES[cause];
  const announceFactor = announced ? 1 - ANNOUNCE_DISCOUNT : 1;
  // Reserves shelter capital: 2.5% less flight per month of GDP held, max −50%.
  const reserveFactor = Math.max(0.5, 1 - 0.025 * Math.max(0, reserveRatio));
  return {
    efficiencyMult: 1 - (1 - base.efficiencyMult) * announceFactor,
    capitalFlightFrac: base.capitalFlightFrac * announceFactor * reserveFactor,
    recoveryDays: Math.round(base.recoveryDays * announceFactor),
    narrative: base.narrative,
  };
}

/**
 * The economy-wide output multiplier for an in-progress transition.
 * Recovers linearly from the initial hit back to 1.0 at endDay.
 */
export function transitionEfficiency(t: CurrencyTransition | null, day: number): number {
  if (!t || day >= t.endDay) return 1;
  const total = t.endDay - t.startDay;
  if (total <= 0) return 1;
  const progress = Math.min(1, Math.max(0, (day - t.startDay) / total));
  return t.startEfficiencyMult + (1 - t.startEfficiencyMult) * progress;
}

/** Price volatility during a transition: ±15% at the start, fading to 0. */
export function transitionVolatility(t: CurrencyTransition | null, day: number, rand: number): number {
  if (!t || day >= t.endDay) return 1;
  const total = t.endDay - t.startDay;
  if (total <= 0) return 1;
  const remaining = 1 - Math.min(1, Math.max(0, (day - t.startDay) / total));
  return 1 + (rand * 2 - 1) * 0.15 * remaining;
}
