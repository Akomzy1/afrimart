/**
 * Marketplace economics. Every number the routing, pricing and payout code
 * depends on lives here rather than inline, because these are business policy
 * and get tuned without touching logic.
 */

/** PAY-3 — the PRD specifies a configurable take rate in the 12-15% band. */
export const TAKE_RATE_BPS = Number(process.env.TAKE_RATE_BPS ?? 1300);
export const TAKE_RATE_MIN_BPS = 1200;
export const TAKE_RATE_MAX_BPS = 1500;

/** PAY-3 — flat per-order fulfilment/packaging fee retained by the platform. */
export const FULFILMENT_FEE_CENTS = Number(process.env.FULFILMENT_FEE_CENTS ?? 199);

/**
 * CART-5 — at or above this subtotal the platform absorbs shipping entirely.
 * Below it the buyer sees ONE blended charge, never one fee per parcel.
 */
export const FREE_SHIPPING_THRESHOLD_CENTS = Number(process.env.FREE_SHIPPING_THRESHOLD_CENTS ?? 10000);

/**
 * The single blended shipping charge shown below the threshold. Deliberately a
 * flat buyer-facing price rather than a pass-through of true carrier cost: the
 * buyer must never be able to infer a per-parcel fee from the number, which is
 * exactly what CART-5 forbids.
 */
export const BLENDED_SHIPPING_CENTS = Number(process.env.BLENDED_SHIPPING_CENTS ?? 750);

if (TAKE_RATE_BPS < TAKE_RATE_MIN_BPS || TAKE_RATE_BPS > TAKE_RATE_MAX_BPS) {
  throw new Error(
    `TAKE_RATE_BPS ${TAKE_RATE_BPS} is outside the PAY-3 band of ` +
      `${TAKE_RATE_MIN_BPS}-${TAKE_RATE_MAX_BPS} bps (12-15%).`,
  );
}
