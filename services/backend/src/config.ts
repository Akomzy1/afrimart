/**
 * Marketplace economics. Every number the routing, pricing and payout code
 * depends on lives here rather than inline, because these are business policy
 * and get tuned without touching logic.
 */

/**
 * PAY-3 — configurable take rate in the 12-15% band, charged on item value
 * only. Shipping is pass-through: the seller neither sets it nor receives it,
 * so it must never enter the commission base.
 */
export const TAKE_RATE_BPS = Number(process.env.TAKE_RATE_BPS ?? 1300);
export const TAKE_RATE_MIN_BPS = 1200;
export const TAKE_RATE_MAX_BPS = 1500;

/** PAY-3 — flat per-order fulfilment/packaging fee retained by the platform. */
export const FULFILMENT_FEE_CENTS = Number(process.env.FULFILMENT_FEE_CENTS ?? 199);

/**
 * CART-5 — shipping is charged at actual cost and absorbed on no category.
 *
 * There is deliberately no free-shipping threshold and no blended fee schedule
 * here any more. Both existed to decide how much of a split the platform ate;
 * under pass-through it eats none, so the buyer's shipping line is simply the
 * sum of the live carrier quotes for their parcels. The only two exceptions in
 * the PRD are seller-funded free shipping (PAY-10, Phase 2) and the paid
 * membership tier (SUB-3, Phase 3) — neither is built.
 *
 * Keeping a constant here would invite a future session to reintroduce
 * absorption by editing a number. There is nothing to edit.
 */

/**
 * CAT-5 — carriers bill on the greater of actual weight and dimensional
 * weight, so a bulky light parcel cannot be rated on weight alone. Divisor 166
 * is the common US domestic retail figure (cubic inches per pound); negotiated
 * contracts often use 139. Revisit when real carrier terms land.
 */
export const DIM_DIVISOR = Number(process.env.DIM_DIVISOR ?? 166);

/**
 * PAY-8 — payout hold for sellers without a track record.
 *
 * Funds are held until delivery is confirmed and the refund window has closed.
 * The hold shortens as a seller accumulates delivered orders with no disputes,
 * and disappears once they are established. Defaults are provisional and
 * should be set from real dispute rates once there are any.
 */
export const REFUND_WINDOW_DAYS = Number(process.env.REFUND_WINDOW_DAYS ?? 14);
/** Clean delivered orders needed before a seller is paid without a hold. */
export const SELLER_ESTABLISHED_AFTER_ORDERS = Number(process.env.SELLER_ESTABLISHED_AFTER_ORDERS ?? 20);
/** Clean delivered orders after which the window is halved. */
export const SELLER_TRUSTED_AFTER_ORDERS = Number(process.env.SELLER_TRUSTED_AFTER_ORDERS ?? 5);

/**
 * QC-9 — refund-abuse controls. Claims are tracked per buyer; past the cap,
 * a claim goes to manual review instead of being auto-approved.
 */
export const REFUND_AUTO_APPROVE_CENTS = Number(process.env.REFUND_AUTO_APPROVE_CENTS ?? 5000);
export const REFUND_CLAIMS_BEFORE_REVIEW = Number(process.env.REFUND_CLAIMS_BEFORE_REVIEW ?? 2);
export const REFUND_CLAIM_WINDOW_DAYS = Number(process.env.REFUND_CLAIM_WINDOW_DAYS ?? 90);

/**
 * Parcel count at or above which an order is reported as an exceptional split.
 * Not a cap — nothing is blocked. Under pass-through the buyer sees the cost of
 * a split directly, so this is now a product signal rather than a loss signal.
 */
export const EXCEPTIONAL_SPLIT_PARCELS = Number(process.env.EXCEPTIONAL_SPLIT_PARCELS ?? 3);

/**
 * SEL-2/SEL-4 seller eligibility for routing. The PRD now requires
 * verification before a seller of any type can list publicly or be assigned an
 * order, so this defaults on; false falls back to gating non-store sellers only.
 */
export const REQUIRE_VERIFIED_ALL = process.env.REQUIRE_VERIFIED_ALL !== "false";

if (TAKE_RATE_BPS < TAKE_RATE_MIN_BPS || TAKE_RATE_BPS > TAKE_RATE_MAX_BPS) {
  throw new Error(
    `TAKE_RATE_BPS ${TAKE_RATE_BPS} is outside the PAY-3 band of ` +
      `${TAKE_RATE_MIN_BPS}-${TAKE_RATE_MAX_BPS} bps (12-15%).`,
  );
}

/**
 * CAT-6 / ADM-1 — vision- or import-derived items at or above this confidence
 * may be auto-approved; below it a human must confirm before publishing.
 * Provisional: set from real extraction accuracy once there is any.
 */
export const CATALOGUE_AUTO_APPROVE_CONFIDENCE = Number(process.env.CATALOGUE_AUTO_APPROVE_CONFIDENCE ?? 0.92);

/**
 * ADM-3 — hours a shipment may sit unaccepted or unposted before the console
 * flags it as stuck. Short enough to beat a buyer noticing.
 */
export const STUCK_ORDER_HOURS = Number(process.env.STUCK_ORDER_HOURS ?? 24);

/**
 * Staff session lifetime. Two clocks: the idle timeout slides with use so an
 * abandoned console locks itself, and the absolute cap does not, so no session
 * outlives a shift however busy it is.
 */
export const SESSION_IDLE_MINUTES = Number(process.env.SESSION_IDLE_MINUTES ?? 30);
export const SESSION_ABSOLUTE_HOURS = Number(process.env.SESSION_ABSOLUTE_HOURS ?? 12);

/**
 * Sign-in rate limiting. Password hashing at N=2^17 costs ~1.5s and ~128MB
 * per attempt, so these bounds protect capacity as much as they protect the
 * account — an unbounded login endpoint here is a denial-of-service lever.
 */
export const MAX_LOGIN_ATTEMPTS = Number(process.env.MAX_LOGIN_ATTEMPTS ?? 5);
export const MAX_MFA_ATTEMPTS = Number(process.env.MAX_MFA_ATTEMPTS ?? 5);
export const LOCKOUT_MINUTES = Number(process.env.LOCKOUT_MINUTES ?? 15);
/** Per-IP ceiling across all accounts, to blunt spraying one password widely. */
export const MAX_ATTEMPTS_PER_IP = Number(process.env.MAX_ATTEMPTS_PER_IP ?? 20);
export const IP_WINDOW_MINUTES = Number(process.env.IP_WINDOW_MINUTES ?? 15);

/**
 * QC-4/QC-6 — the minimum sample before a defect *rate* may drive automatic
 * enforcement.
 *
 * One upheld complaint across three orders is a 33% defect rate and means
 * almost nothing. Twenty delivered orders is the point at which a rate
 * starts to separate a bad seller from an unlucky one, and it matches the
 * PAY-8 threshold at which a seller is considered established, so a seller
 * stops being treated as new in both senses at once. Below it the score is
 * still calculated and visible to operations — it just cannot act on its own.
 */
export const QUALITY_MIN_ORDERS_FOR_ENFORCEMENT = Number(process.env.QUALITY_MIN_ORDERS_FOR_ENFORCEMENT ?? 20);

/** Confirmed-defect rates at each rung. Provisional until there is real data. */
export const QUALITY_WARNING_DEFECT_RATE = Number(process.env.QUALITY_WARNING_DEFECT_RATE ?? 0.05);
export const QUALITY_REDUCED_VISIBILITY_DEFECT_RATE = Number(process.env.QUALITY_REDUCED_VISIBILITY_DEFECT_RATE ?? 0.1);
/** At or above this the case goes to a person — never to automatic delisting. */
export const QUALITY_REVIEW_DEFECT_RATE = Number(process.env.QUALITY_REVIEW_DEFECT_RATE ?? 0.2);

/** QC-1 — below this many days to expiry, a listing must disclose it. */
export const SHORT_DATED_DAYS = Number(process.env.SHORT_DATED_DAYS ?? 30);
