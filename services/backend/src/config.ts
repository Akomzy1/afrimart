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
 * CART-5's blended charge. The requirement is about *presentation* — one
 * shipping figure, never a per-seller breakdown — not about that figure being
 * the same for every basket. A flat constant made multi-parcel orders
 * structurally loss-making: a four-way split cost $46.90 to ship and recovered
 * $7.50.
 *
 * So the figure scales with parcel count while staying a single number. The
 * buyer still sees one order, one total, and cannot infer a per-seller fee from
 * it: the increment is not any parcel's real cost, and the schedule is
 * deliberately sub-linear so the platform keeps absorbing part of a split
 * rather than passing it through.
 */
export const BLENDED_SHIPPING_BASE_CENTS = Number(process.env.BLENDED_SHIPPING_BASE_CENTS ?? 750);
export const BLENDED_SHIPPING_PER_EXTRA_PARCEL_CENTS = Number(
  process.env.BLENDED_SHIPPING_PER_EXTRA_PARCEL_CENTS ?? 450,
);

/**
 * Cold chain is not shipping, and must never be absorbed by a basket-size
 * threshold. A perishable box runs $37-67 all-in, so no threshold we would
 * realistically set can swallow one — raising the threshold only moves the
 * cliff. Chilled and frozen parcels therefore always carry this fee, whatever
 * the basket is worth, and it covers their transport as well as the insulated
 * packaging and refrigerant. The ambient side keeps the free-shipping mechanic,
 * which is where absorption is affordable.
 *
 * PROVISIONAL NUMBERS. These are placed to sit inside the quoted $37-67 all-in
 * band once carrier and packaging quotes exist; they are not derived from real
 * ones yet and should be replaced when EasyPost cold-chain pricing lands.
 */
export const COLD_PACK_BASE_CENTS = Number(process.env.COLD_PACK_BASE_CENTS ?? 1900);
export const COLD_PACK_PER_EXTRA_PARCEL_CENTS = Number(process.env.COLD_PACK_PER_EXTRA_PARCEL_CENTS ?? 1400);

export function coldPackCents(coldParcelCount: number): number {
  if (coldParcelCount <= 0) return 0;
  return COLD_PACK_BASE_CENTS + (coldParcelCount - 1) * COLD_PACK_PER_EXTRA_PARCEL_CENTS;
}

/**
 * Parcel count at or above which an order is reported as an exceptional split.
 * Not a cap — nothing is blocked. We want to see how often the engine can only
 * satisfy an order this way before deciding whether to cap it.
 */
export const EXCEPTIONAL_SPLIT_PARCELS = Number(process.env.EXCEPTIONAL_SPLIT_PARCELS ?? 3);

/**
 * SEL-2/SEL-4 seller eligibility for routing.
 *
 * SEL-2 as written gates *non-store* sellers: verification is "required before
 * a non-store seller can list to the public", which leaves an unverified
 * `store` free to sell. `REQUIRE_VERIFIED_ALL` is the stricter stance — no
 * unverified seller of any type may receive a routed order. It is the default
 * because an order landing with an unverified seller is where SEL-2 and SEL-4
 * are supposed to bite; set it false to fall back to SEL-2's literal reading.
 */
export const REQUIRE_VERIFIED_ALL = process.env.REQUIRE_VERIFIED_ALL !== "false";

export function blendedShippingCents(parcelCount: number): number {
  if (parcelCount <= 0) return 0;
  return BLENDED_SHIPPING_BASE_CENTS + (parcelCount - 1) * BLENDED_SHIPPING_PER_EXTRA_PARCEL_CENTS;
}

if (TAKE_RATE_BPS < TAKE_RATE_MIN_BPS || TAKE_RATE_BPS > TAKE_RATE_MAX_BPS) {
  throw new Error(
    `TAKE_RATE_BPS ${TAKE_RATE_BPS} is outside the PAY-3 band of ` +
      `${TAKE_RATE_MIN_BPS}-${TAKE_RATE_MAX_BPS} bps (12-15%).`,
  );
}
