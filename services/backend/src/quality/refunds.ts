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
  | "missing_items"
  | "not_delivered"
  | "late_delivery"
  | "wrong_item";

/** QC-8 — spoilage and damage claims require photo evidence. */
const PHOTO_REQUIRED: RefundReason[] = ["damaged", "spoiled"];

export type RecoveryTarget = "seller" | "carrier" | "platform";

export interface ClaimContext {
  reason: RefundReason;
  amountCents: number;
  photoUrl?: string | null;
  /** QC-9 — this buyer's prior claims inside the tracking window. */
  priorClaims: number;
  /** Whether carrier tracking evidences loss or a delivery failure. */
  trackingShowsFailure: boolean;
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
    return ctx.trackingShowsFailure ? "carrier" : "platform";
  }
  // damaged, spoiled, missing_items, wrong_item — packed by the seller.
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
