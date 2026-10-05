import { REFUND_AUTO_APPROVE_CENTS, REFUND_CLAIMS_BEFORE_REVIEW } from "../config.js";

/**
 * QC-8 (loss allocation) and QC-9 (refund-abuse controls).
 *
 * The order of operations is the point: refund the buyer promptly, then
 * recover the cost separately. The buyer is never made to wait on the outcome
 * of a dispute between the platform, a seller and a carrier — but the cost
 * still lands on whoever caused it rather than on the platform by default.
 */

export type RefundReason =
  | "damaged"
  | "spoiled"
  | "wrong_item"
  | "inauthentic"
  | "missing_items"
  | "not_delivered"
  | "late_delivery";

/**
 * QC-3 — the five item-level reasons a buyer may choose, in the order the
 * prototype offers them. Everything else in RefundReason is internal.
 */
export const BUYER_ITEM_REASONS = [
  "damaged",
  "spoiled",
  "wrong_item",
  "inauthentic",
  "missing_items",
] as const satisfies readonly RefundReason[];

/** QC-3 — the single parcel-level reason. No photo, always reviewed. */
export const BUYER_PARCEL_REASON = "not_delivered" as const;

/**
 * QC-3 — never offered to a buyer. For dry goods lateness is not grounds for
 * a refund, and for chilled goods a late arrival is reported as spoiled, so
 * exposing it would only invite the wrong claim.
 */
export const INTERNAL_ONLY_REASONS = ["late_delivery"] as const satisfies readonly RefundReason[];

export function isBuyerSelectable(reason: RefundReason): boolean {
  return (BUYER_ITEM_REASONS as readonly string[]).includes(reason) || reason === BUYER_PARCEL_REASON;
}

/** QC-8 — spoilage and damage claims require photo evidence. */
/**
 * QC-3/QC-8 — every item-level reason needs a photo. A parcel that never
 * arrived cannot be photographed, so that one requires none and is reviewed
 * by a person instead.
 */
const PHOTO_REQUIRED: readonly RefundReason[] = BUYER_ITEM_REASONS;

export type RecoveryTarget = "seller" | "carrier" | "platform";

export interface ClaimContext {
  reason: RefundReason;
  amountCents: number;
  photoUrl?: string | null;
  /** QC-9 — this buyer's prior claims inside the tracking window. */
  priorClaims: number;
  /** Whether carrier tracking evidences loss or a delivery failure. */
  trackingShowsFailure: boolean;
  /**
   * QC-3 — did the parcel ever get a carrier scan? False means it never left
   * the seller, which moves a not-arrived claim onto them.
   */
  hadCarrierScan?: boolean;
}

export interface ClaimDecision {
  status: "auto_approved" | "manual_review" | "rejected";
  recoveryTarget: RecoveryTarget | null;
  reasonGiven: string;
}

export function requiresPhoto(reason: RefundReason): boolean {
  return PHOTO_REQUIRED.includes(reason);
}

/**
 * QC-8 — where the money is recovered from. Packaging and product failures are
 * the seller's; loss and delay evidenced by tracking are a carrier claim. The
 * platform absorbs only what neither party can be shown to have caused.
 */
export function recoveryTargetFor(ctx: ClaimContext): RecoveryTarget {
  if (ctx.reason === "not_delivered" || ctx.reason === "late_delivery") {
    // QC-3 — a parcel that was scanned and then vanished is the carrier's.
    // One that never received a scan never left the seller, whatever the
    // label says, so it counts against them instead.
    return ctx.hadCarrierScan === false ? "seller" : "carrier";
  }
  // damaged, spoiled, wrong_item, inauthentic, missing_items — the seller
  // chose, packed and sealed the box.
  return "seller";
}

export function assessClaim(ctx: ClaimContext): ClaimDecision {
  if (requiresPhoto(ctx.reason) && !ctx.photoUrl) {
    return {
      status: "rejected",
      recoveryTarget: null,
      reasonGiven: "A photo of the item as it arrived is needed before we can review this.",
    };
  }

  const target = recoveryTargetFor(ctx);

  // QC-3 — a not-arrived claim is always reviewed. There is no photo to judge
  // it on and it becomes a carrier claim, so it never auto-approves however
  // small or however clean the buyer's record.
  if (ctx.reason === "not_delivered") {
    return {
      status: "manual_review",
      recoveryTarget: target,
      reasonGiven: "We'll check this with the carrier and come back to you.",
    };
  }

  // QC-9 — a buyer past the claim cap goes to a human, regardless of amount.
  if (ctx.priorClaims >= REFUND_CLAIMS_BEFORE_REVIEW) {
    return {
      status: "manual_review",
      recoveryTarget: target,
      reasonGiven: "Sent for review — this account has several recent claims.",
    };
  }

  // QC-9 — and so does anything above the auto-approval cap.
  if (ctx.amountCents > REFUND_AUTO_APPROVE_CENTS) {
    return {
      status: "manual_review",
      recoveryTarget: target,
      reasonGiven: "Sent for review — above the automatic refund limit.",
    };
  }

  return {
    status: "auto_approved",
    recoveryTarget: target,
    reasonGiven: "Refunded straight away.",
  };
}
