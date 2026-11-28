import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { prisma } from "../db.js";
import { buyerProcedure, router } from "../trpc.js";
import { REFUND_CLAIM_WINDOW_DAYS } from "../config.js";
import { BUYER_ITEM_REASONS, assessClaim } from "../quality/refunds.js";
import { claimRef, hadCarrierScan, itemReportBlock, parcelReportBlock } from "../quality/claims.js";
import { refundClaim } from "../quality/claimService.js";
import { PhotoRejected, decodeUpload } from "../storage/photos.js";
import { photoStore } from "../storage/store.js";
import { queueReportReceived } from "../notifications/pipeline.js";
import { drain } from "../notifications/outbox.js";

/**
 * QC-3 — a buyer reporting a problem, at two levels.
 *
 *   Item level   goods that arrived wrong. A photo is required, one reason covers
 *                the items chosen, and a small clean report is refunded at once.
 *   Parcel level it never arrived. No photo, offered only once the expected date
 *                has passed or tracking says delivered, and always reviewed by a
 *                person, never auto-approved.
 *
 * Which buyer is reporting comes from the request, never from input, and a
 * parcel that is not theirs is not found. The decision rules are `assessClaim`
 * (refunds.ts) and the eligibility rules are in claims.ts; this file gathers
 * the facts, records the report and queues the email in one transaction.
 */

const NOTE = z.string().trim().max(500).optional();

/** Claims this buyer has made inside the abuse window (QC-9). */
async function priorClaims(buyerId: string): Promise<number> {
  const since = new Date(Date.now() - REFUND_CLAIM_WINDOW_DAYS * 86_400_000);
  return prisma.refundClaim.count({ where: { buyerId, createdAt: { gte: since } } });
}

async function ownParcel(buyerId: string, shipmentId: string) {
  const shipment = await prisma.shipment.findFirst({
    where: { id: shipmentId, order: { buyerId } },
    include: { items: true, order: { include: { buyer: true } } },
  });
  if (!shipment) throw new TRPCError({ code: "NOT_FOUND", message: "We couldn't find that parcel." });
  return shipment;
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export const claimsRouter = router({
  /**
   * Report items that arrived wrong. `photo` is the buyer's picture of the
   * problem, as base64; the photo store strips its metadata before keeping it.
   */
  submitItemReport: buyerProcedure
    .input(
      z.object({
        shipmentId: z.string(),
        itemIds: z.array(z.string()).min(1).max(50),
        reason: z.enum(BUYER_ITEM_REASONS),
        photo: z.string().min(1).max(12_000_000),
        note: NOTE,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const shipment = await ownParcel(ctx.buyerId, input.shipmentId);

      const block = itemReportBlock(shipment.status);
      if (block) throw new TRPCError({ code: "BAD_REQUEST", message: block });

      const ids = [...new Set(input.itemIds)];
      const chosen = shipment.items.filter((i) => ids.includes(i.id));
      if (chosen.length !== ids.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Choose items from this parcel." });
      }

      // The same goods cannot be refunded twice: an item already in a report
      // that has not been declined is spoken for.
      const held = await prisma.refundClaimItem.findFirst({
        where: { shipmentItemId: { in: ids }, claim: { status: { not: "rejected" } } },
        include: { shipmentItem: { select: { nameSnapshot: true } } },
      });
      if (held) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `You've already reported ${held.shipmentItem.nameSnapshot}. We'll update you as soon as we have looked at it.`,
        });
      }

      let photoUrl: string;
      try {
        photoUrl = await photoStore.put("claim", decodeUpload(input.photo));
      } catch (e) {
        if (e instanceof PhotoRejected) throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
        throw e;
      }

      const amountCents = chosen.reduce((n, i) => n + i.lineTotalCents, 0);
      const decision = assessClaim({
        reason: input.reason,
        amountCents,
        photoUrl,
        priorClaims: await priorClaims(ctx.buyerId),
        trackingShowsFailure: false,
        hadCarrierScan: true,
      });
      // A photo is always present here, so the only way to be rejected is a bug.
      if (decision.status === "rejected") throw new TRPCError({ code: "BAD_REQUEST", message: decision.reasonGiven });

      const claim = await prisma.$transaction(async (tx) => {
        if (decision.status === "auto_approved") {
          await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${shipment.orderId} FOR UPDATE`;
        }
        const created = await tx.refundClaim.create({
          data: {
            buyerId: ctx.buyerId,
            orderId: shipment.orderId,
            shipmentId: shipment.id,
            kind: "item",
            reason: input.reason,
            amountCents,
            photoUrl,
            note: input.note || null,
            status: decision.status,
            recoveryTarget: decision.recoveryTarget,
            items: { create: chosen.map((i) => ({ shipmentItemId: i.id, lineTotalCents: i.lineTotalCents })) },
          },
        });
        await queueReportReceived(tx, {
          claimId: created.id,
          kind: "item",
          orderId: shipment.orderId,
          shipmentId: shipment.id,
          buyerEmail: shipment.order.buyer.email,
          reportRef: claimRef(created.id),
          items: chosen.map((i) => ({
            name: i.nameSnapshot,
            subtitle: i.packSizeSnapshot,
            lineTotal: money(i.lineTotalCents),
            quantityLine: `${i.quantity} × ${money(i.unitPriceCents)}`,
          })),
        });
        return created;
      });
      await drain().catch(() => undefined);

      // QC-8 — refund first, recover afterwards. Only a small clean report gets
      // here without a person; if the issuer fails the report stays open and
      // visible to operations, and the buyer is told nothing false.
      let refunded = false;
      if (decision.status === "auto_approved") {
        try {
          await refundClaim(claim.id);
          refunded = true;
        } catch {
          refunded = false;
        }
      }

      return {
        claimId: claim.id,
        ref: claimRef(claim.id),
        amountCents,
        refunded,
        message: refunded ? decision.reasonGiven : "We have your report and we're looking into it.",
      };
    }),

  /** Report a parcel that has not arrived. No photo; always reviewed by a person. */
  submitParcelReport: buyerProcedure
    .input(z.object({ shipmentId: z.string(), note: NOTE }))
    .mutation(async ({ ctx, input }) => {
      const shipment = await ownParcel(ctx.buyerId, input.shipmentId);

      const block = parcelReportBlock(shipment);
      if (block) throw new TRPCError({ code: "BAD_REQUEST", message: block });

      const existing = await prisma.refundClaim.findFirst({
        where: { shipmentId: shipment.id, kind: "parcel", status: { not: "rejected" } },
      });
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "You've already reported this parcel. We'll update you as soon as we have news.",
        });
      }

      const amountCents = shipment.items.reduce((n, i) => n + i.lineTotalCents, 0);
      const decision = assessClaim({
        reason: "not_delivered",
        amountCents,
        priorClaims: await priorClaims(ctx.buyerId),
        trackingShowsFailure: shipment.status === "exception",
        // A parcel the carrier never scanned never left the seller, which moves
        // the claim onto them rather than the carrier (QC-3).
        hadCarrierScan: hadCarrierScan(shipment.status),
      });

      const claim = await prisma.$transaction(async (tx) => {
        const created = await tx.refundClaim.create({
          data: {
            buyerId: ctx.buyerId,
            orderId: shipment.orderId,
            shipmentId: shipment.id,
            kind: "parcel",
            reason: "not_delivered",
            amountCents,
            note: input.note || null,
            status: decision.status,
            recoveryTarget: decision.recoveryTarget,
          },
        });
        await queueReportReceived(tx, {
          claimId: created.id,
          kind: "parcel",
          orderId: shipment.orderId,
          shipmentId: shipment.id,
          buyerEmail: shipment.order.buyer.email,
          reportRef: claimRef(created.id),
        });
        return created;
      });
      await drain().catch(() => undefined);

      return {
        claimId: claim.id,
        ref: claimRef(claim.id),
        amountCents,
        refunded: false,
        message: decision.reasonGiven,
      };
    }),
});
