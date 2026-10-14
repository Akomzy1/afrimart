import { prisma } from "../db.js";
import { refundIssuer } from "../payments/refunds.js";
import { queueRefundIssued } from "../notifications/pipeline.js";
import { drain } from "../notifications/outbox.js";
import { claimRef } from "./claims.js";

/**
 * Issue the refund for a claim, once.
 *
 * Called from two places: straight after a small clean item claim is
 * auto-approved (QC-8: refund first, recover afterwards), and when a person
 * approves a claim that went to review. Both converge here so there is one
 * place where money goes back to a buyer.
 *
 * Safe to call twice. The issuer is idempotent per claim (a retried call
 * returns the same refund rather than paying again), the claim is only marked
 * refunded if it is not already, and the buyer's email is deduplicated on the
 * claim. A crash between the provider call and the update therefore costs a
 * retry, never a second payment.
 *
 * "Refunded" is recorded only after the issuer has succeeded. If it throws,
 * nothing says the buyer has been paid, and the claim stays in the queue
 * where operations can see it.
 */
export async function refundClaim(claimId: string): Promise<{ refundedAt: Date; alreadyRefunded: boolean }> {
  const claim = await prisma.refundClaim.findUniqueOrThrow({
    where: { id: claimId },
    include: { buyer: true, items: { include: { shipmentItem: true } } },
  });
  if (claim.refundedAt) return { refundedAt: claim.refundedAt, alreadyRefunded: true };
  if (claim.status === "rejected") throw new Error("A rejected claim cannot be refunded.");

  const receipt = await refundIssuer.issue({ claimId: claim.id, orderId: claim.orderId, amountCents: claim.amountCents });

  await prisma.$transaction(async (tx) => {
    // Guarded so two concurrent callers cannot both record (and email) a refund.
    const marked = await tx.refundClaim.updateMany({
      where: { id: claim.id, refundedAt: null },
      data: { refundedAt: receipt.issuedAt, refundId: receipt.refundId },
    });
    if (marked.count === 0) return;
    await queueRefundIssued(tx, {
      claimId: claim.id,
      orderId: claim.orderId,
      shipmentId: claim.shipmentId,
      buyerEmail: claim.buyer.email,
      reportRef: claimRef(claim.id),
      amountCents: claim.amountCents,
      items: claim.items.map((i) => ({
        name: i.shipmentItem.nameSnapshot,
        subtitle: i.shipmentItem.packSizeSnapshot,
        lineTotal: `$${(i.lineTotalCents / 100).toFixed(2)}`,
        quantityLine: `${i.shipmentItem.quantity} × $${(i.shipmentItem.unitPriceCents / 100).toFixed(2)}`,
      })),
    });
  });

  // Sent after the commit, like every other notification.
  await drain().catch(() => undefined);

  const after = await prisma.refundClaim.findUniqueOrThrow({ where: { id: claim.id }, select: { refundedAt: true } });
  return { refundedAt: after.refundedAt!, alreadyRefunded: false };
}
