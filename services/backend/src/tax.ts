/**
 * PAY-5 / INT-6 — sales tax by jurisdiction.
 *
 * The stack commits to Stripe Tax as the calculating authority, and this is not
 * a substitute for it: real rates are destination-sourced down to the locality,
 * and grocery items carry per-state exemptions that a state-level table cannot
 * express. This exists so checkout returns a plausible number before Stripe
 * credentials are wired, and is deliberately conservative and obvious.
 *
 * Replace with a Stripe Tax calculation before charging anyone.
 */

/** Rates in basis points. Groceries are exempt or reduced in many states. */
const STATE_RATE_BPS: Record<string, number> = {
  AK: 0, DE: 0, MT: 0, NH: 0, OR: 0,
  CA: 725, NY: 400, TX: 625, GA: 400, IL: 625,
  MN: 688, WA: 650, FL: 600, NJ: 663, MA: 625,
};

const DEFAULT_RATE_BPS = 550;

export function estimateTaxCents(taxableCents: number, state: string): number {
  const bps = STATE_RATE_BPS[state.trim().toUpperCase()] ?? DEFAULT_RATE_BPS;
  return Math.round((taxableCents * bps) / 10000);
}
