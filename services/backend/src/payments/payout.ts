import { Prisma, type CarrierAdjustment } from "@prisma/client";
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

export function sellerPayoutRecords(db: Prisma.TransactionClient, storeId?: string) {
  return db.$queryRaw<(SellerRecord & { storeId: string })[]>`
    WITH seller_orders AS (
      SELECT s."storeId", s."orderId", bool_and(s.status = 'delivered') AS delivered,
             bool_or(c.id IS NOT NULL) AS disputed
      FROM "Shipment" s
      LEFT JOIN "RefundClaim" c ON c."orderId" = s."orderId"
        AND c.status IN ('manual_review', 'approved', 'auto_approved')
        AND (c."shipmentId" = s.id OR (c."shipmentId" IS NULL AND (
          -- Older claims can identify a parcel by an item, or just an order
          -- when that order has a single seller.
          EXISTS (SELECT 1 FROM "RefundClaimItem" ci
                  JOIN "ShipmentItem" si ON si.id = ci."shipmentItemId"
                  WHERE ci."claimId" = c.id AND si."shipmentId" = s.id)
          OR NOT EXISTS (SELECT 1 FROM "Shipment" other
                         WHERE other."orderId" = s."orderId" AND other."storeId" <> s."storeId")
        )))
      WHERE ${storeId !== undefined ? Prisma.sql`s."storeId" = ${storeId}` : Prisma.sql`EXISTS (
        SELECT 1 FROM "Payout" p WHERE p."storeId" = s."storeId" AND p."paidAt" IS NULL
      )`}
      GROUP BY s."storeId", s."orderId"
    )
    SELECT "storeId", count(*) FILTER (WHERE delivered AND NOT disputed)::int AS "cleanDeliveredOrders",
           count(*) FILTER (WHERE disputed)::int AS "disputedOrders"
    FROM seller_orders GROUP BY "storeId"
  `;
}

const emptyRecord: SellerRecord = { cleanDeliveredOrders: 0, disputedOrders: 0 };

export async function sellerPayoutRecord(db: Prisma.TransactionClient, storeId: string) {
  const [record] = await sellerPayoutRecords(db, storeId);
  return record ?? emptyRecord;
}

export const collectedPaymentStatuses = ["succeeded", "partially_refunded", "refunded"];

type PayoutParcel = { payoutId: string; orderStatus: string; paymentStatus: string | null; deliveredAt: Date | null };

// A release locks its payment, order, and parcels until settlement commits. The finance
// report reads the same rows for all unpaid payouts from a repeatable snapshot.
export function unpaidPayoutParcels(db: Prisma.TransactionClient, lockPayoutId?: string) {
  return db.$queryRaw<PayoutParcel[]>`
    SELECT p.id AS "payoutId", s."deliveredAt", o.status AS "orderStatus",
           (SELECT pay.status FROM "Payment" pay WHERE pay."orderId" = p."orderId"
            ${lockPayoutId === undefined ? Prisma.empty : Prisma.sql`FOR SHARE`}) AS "paymentStatus"
    FROM "Payout" p JOIN "Shipment" s ON s."orderId" = p."orderId" AND s."storeId" = p."storeId"
    JOIN "Order" o ON o.id = s."orderId"
    WHERE p."paidAt" IS NULL
    ${lockPayoutId === undefined ? Prisma.empty : Prisma.sql`AND p.id = ${lockPayoutId} ORDER BY s.id FOR SHARE OF o, s`}
  `;
}

export function payoutAvailability(paidAt: Date | null, record: SellerRecord | undefined, parcels: PayoutParcel[], now: Date) {
  if (paidAt) return { blocked: false, label: "Paid", eligibleAt: null };
  if (!parcels.length) return { blocked: true, label: "Missing seller shipment", eligibleAt: null };
  if (parcels[0]!.orderStatus === "cancelled") return { blocked: true, label: "Order cancelled", eligibleAt: null };
  const paymentStatus = parcels[0]!.paymentStatus;
  if (!paymentStatus || !collectedPaymentStatuses.includes(paymentStatus)) {
    return { blocked: true, label: "Awaiting payment", eligibleAt: null };
  }
  const deliveredAt = parcels.every((p) => p.deliveredAt)
    ? new Date(Math.max(...parcels.map((p) => p.deliveredAt!.getTime())))
    : null;
  const hold = computeHold(record ?? emptyRecord, deliveredAt);
  if (hold.tier !== "established") {
    if (!hold.heldUntil) return { blocked: true, label: "Awaiting delivery", eligibleAt: null };
    if (hold.heldUntil > now) return { blocked: true, label: "Refund window open", eligibleAt: hold.heldUntil };
  }
  return { blocked: false, label: "Eligible for release", eligibleAt: null };
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
  heldUntil.setUTCDate(heldUntil.getUTCDate() + holdDays);
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

export async function deductCarrierAdjustments(tx: Prisma.TransactionClient, storeId: string, payoutId: string, netCents: number) {
  const deductions: { adjustmentId: string; cents: number }[] = [];
  let payableCents = netCents;
  if (payableCents > 0) {
    // Concurrent payouts acquire the same seller's outstanding corrections in
    // the same order. A waiting release sees the balance left by the first.
    const rows = await tx.$queryRaw<Pick<CarrierAdjustment, "id" | "amountCents" | "appliedCents">[]>`
      SELECT a.id, a."amountCents", a."appliedCents" FROM "CarrierAdjustment" a
      WHERE a."storeId" = ${storeId} AND a."settledPayoutId" IS NULL
        AND (a."shipmentId" IS NULL OR EXISTS (
          SELECT 1 FROM "Shipment" s WHERE s.id = a."shipmentId" AND s."storeId" = a."storeId"
        ))
      ORDER BY a."createdAt", a.id FOR UPDATE OF a
    `;
    for (const row of rows) {
      const part = applyAdjustments(payableCents, row.amountCents - row.appliedCents);
      await tx.carrierAdjustment.update({
        where: { id: row.id },
        data: { appliedCents: { increment: part.appliedCents }, settledPayoutId: part.carriedCents === 0 ? payoutId : null },
      });
      deductions.push({ adjustmentId: row.id, cents: part.appliedCents });
      payableCents = part.payableCents;
      if (payableCents === 0) break;
    }
  }
  return { payableCents, deductedCents: netCents - payableCents, deductions };
}
