import { assertDevOnlyAllowed } from "../runtime.js";

/**
 * The port through which money goes back to a buyer.
 *
 * QC-8 says refund first and recover afterwards, so issuing a refund is its own
 * step, separate from deciding who ends up bearing the cost. Behind an interface
 * for the same reason `CarrierGateway` is: the provider (Stripe, INT-2) is the
 * swappable part and the claim logic should not know it exists.
 *
 * `LocalRefundIssuer` is a stand-in. It records that a refund was issued and
 * returns a receipt; it does not return a cent to anyone's card. Because the
 * buyer is told "refunded", pretending to refund in production would be a lie
 * with money attached, so the stand-in refuses to run anywhere that looks like
 * production. Wiring Stripe is therefore required before deployment, not a
 * cleanup item.
 */

export interface RefundRequest {
  claimId: string;
  orderId: string;
  amountCents: number;
}

export interface RefundReceipt {
  refundId: string;
  amountCents: number;
  issuedAt: Date;
}

export interface RefundIssuer {
  /**
   * Must be idempotent per `claimId`: calling it again for the same claim
   * returns the same refund and pays nothing further (Stripe's idempotency key
   * is the claim id). Callers rely on this to retry safely after a crash.
   */
  issue(request: RefundRequest): Promise<RefundReceipt>;
}

export class LocalRefundIssuer implements RefundIssuer {
  async issue(request: RefundRequest): Promise<RefundReceipt> {
    // Same three production signals as the dev identity stub and the staff seed.
    assertDevOnlyAllowed();
    if (!Number.isInteger(request.amountCents) || request.amountCents <= 0) {
      throw new Error("A refund must be a positive whole number of cents.");
    }
    // Deterministic in the claim, which is what makes it idempotent.
    return { refundId: `re_local_${request.claimId}`, amountCents: request.amountCents, issuedAt: new Date() };
  }
}

export const refundIssuer: RefundIssuer = new LocalRefundIssuer();
