import {
  REFUND_WINDOW_DAYS,
  SELLER_ESTABLISHED_AFTER_ORDERS,
  SELLER_TRUSTED_AFTER_ORDERS,
} from "../config.js";

/**
 * PAY-8 — payout hold, and PAY-9 — carrier chargebacks.
 *
 * A new seller's money is held until the goods have actually landed and the
 * buyer's refund window has closed, because until both are true the platform
 * may still owe the buyer a refund it would then have to claw back. The hold
 * shortens as the seller builds a record of delivered orders with no disputes,
 * and disappears once they are established — the point is to cover the risk a
 * seller represents, not to hold working capital longer than that risk lasts.
 */

export type HoldTier = "new" | "trusted" | "established";

export interface PayoutHold {
  tier: HoldTier;
  /** Days after delivery before funds release. Zero for an established seller. */
  holdDays: number;
  heldUntil: Date | null;
  reason: string | null;
}

export interface SellerRecord {
  /** Orders delivered with no dispute raised. */
  cleanDeliveredOrders: number;
  disputedOrders: number;
}

export function holdTierFor(record: SellerRecord): HoldTier {
  // A dispute resets a seller to the longest hold regardless of volume: the
  // record is meant to measure reliability, not merely time served.
  if (record.disputedOrders > 0 && record.cleanDeliveredOrders < SELLER_ESTABLISHED_AFTER_ORDERS) return "new";
  if (record.cleanDeliveredOrders >= SELLER_ESTABLISHED_AFTER_ORDERS) return "established";
  if (record.cleanDeliveredOrders >= SELLER_TRUSTED_AFTER_ORDERS) return "trusted";
  return "new";
}

/**
 * `deliveredAt` null means the parcel has not landed, so the clock has not
 * started and the funds stay held with no release date yet.
 */
export function computeHold(record: SellerRecord, deliveredAt: Date | null): PayoutHold {
  const tier = holdTierFor(record);
  const holdDays =
    tier === "established" ? 0 : tier === "trusted" ? Math.ceil(REFUND_WINDOW_DAYS / 2) : REFUND_WINDOW_DAYS;

  if (tier === "established") {
    return { tier, holdDays: 0, heldUntil: null, reason: null };
  }
  if (!deliveredAt) {
    return {
      tier,
      holdDays,
      heldUntil: null,
      reason: "Held until delivery is confirmed.",
    };
  }
  const heldUntil = new Date(deliveredAt);
  heldUntil.setDate(heldUntil.getDate() + holdDays);
  return {
    tier,
    holdDays,
    heldUntil,
    reason: `Held ${holdDays} days past delivery while the refund window is open.`,
  };
}

/**
 * PAY-9 — net a seller's outstanding carrier adjustments off a payout. A
 * payout never goes negative: any excess carries to the next one, because
 * invoicing a seller for a shortfall is a collections problem the platform
 * does not want and the PRD does not ask for.
 */
export function applyAdjustments(
  netCents: number,
  adjustmentCents: number,
): { payableCents: number; appliedCents: number; carriedCents: number } {
  const appliedCents = Math.min(netCents, adjustmentCents);
  return {
    payableCents: netCents - appliedCents,
    appliedCents,
    carriedCents: adjustmentCents - appliedCents,
  };
}
