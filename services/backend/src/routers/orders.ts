import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { prisma } from "../db.js";
import { buyerProcedure, router } from "../trpc.js";
import { itemReportBlock, parcelReportBlock, toClaimView, type ClaimView } from "../quality/claims.js";
import { orderRefFor } from "../notifications/render.js";

/**
 * What a buyer sees of their own orders: parcels, items, where each parcel is,
 * and any reports they have made (QC-3).
 *
 * Which buyer is asking comes from the request (`ctx.buyerId`), never from
 * input, and every query here is keyed on it: there is no way to name an order
 * that is not theirs, because an order that is not theirs is simply not found.
 *
 * Deliberately absent from what is returned: the seller's packing photo. It is
 * evidence for staff to weigh a "missing from the box" report against, not
 * something shown to the buyer.
 */

const include = {
  shipments: {
    orderBy: { createdAt: "asc" },
    include: { store: { select: { name: true } }, items: { orderBy: { id: "asc" } } },
  },
} as const;

type OrderRow = Awaited<ReturnType<typeof loadOrders>>[number];

async function loadOrders(buyerId: string, orderId?: string) {
  return prisma.order.findMany({
    where: { buyerId, ...(orderId ? { id: orderId } : {}) },
    include,
    orderBy: { createdAt: "desc" },
    take: orderId ? 1 : 50,
  });
}

/** A claim as the buyer sees it, plus what is needed to attach it to its parcel. */
type OwnClaim = ClaimView & { orderId: string; shipmentId: string | null; status: string };

async function claimsFor(buyerId: string, orderIds: string[]): Promise<OwnClaim[]> {
  if (!orderIds.length) return [];
  const claims = await prisma.refundClaim.findMany({
    where: { buyerId, orderId: { in: orderIds } },
    include: { items: { select: { shipmentItemId: true } } },
    orderBy: { createdAt: "desc" },
  });
  return claims.map((c) => ({ ...toClaimView(c), orderId: c.orderId, shipmentId: c.shipmentId, status: c.status }));
}

export function toOrderView(order: OrderRow, claims: OwnClaim[]) {
  const now = new Date();
  return {
    orderId: order.id,
    ref: orderRefFor(order.id),
    placedAt: order.createdAt,
    status: order.status,
    totalCents: order.totalCents,
    shippingCents: order.shippingCents,
    taxCents: order.taxCents,
    parcels: order.shipments.map((s) => {
      const mine = claims.filter((c) => c.shipmentId === s.id);
      // A declined report no longer holds its items, so they can be reported again.
      const itemClaim = (itemId: string) => mine.find((c) => c.kind === "item" && c.status !== "rejected" && c.itemIds.includes(itemId)) ?? null;
      const parcelClaim = mine.find((c) => c.kind === "parcel" && c.status !== "rejected") ?? null;

      const itemBlock = itemReportBlock(s.status);
      const parcelBlock = parcelReportBlock(s, now);
      return {
        shipmentId: s.id,
        storeName: s.store.name,
        status: s.status,
        temperatureClass: s.temperatureClass,
        carrier: s.carrier,
        trackingNumber: s.trackingNumber,
        estimatedDelivery: s.estimatedDelivery,
        /** The seller has photographed and sealed the box. */
        packed: s.packingPhotoUrl !== null,
        items: s.items.map((i) => ({
          id: i.id,
          name: i.nameSnapshot,
          packSize: i.packSizeSnapshot,
          category: i.categorySnapshot,
          quantity: i.quantity,
          unitPriceCents: i.unitPriceCents,
          lineTotalCents: i.lineTotalCents,
          claim: itemClaim(i.id),
        })),
        /** null when item reports are open; otherwise the sentence to show. */
        itemReportBlock: itemBlock,
        parcelReportBlock: parcelBlock,
        parcelClaim,
        claims: mine.map(({ orderId: _o, shipmentId: _s, status: _st, ...view }) => view),
      };
    }),
  };
}

export const ordersRouter = router({
  /** The signed-in buyer's orders, newest first. */
  list: buyerProcedure.query(async ({ ctx }) => {
    const orders = await loadOrders(ctx.buyerId);
    const claims = await claimsFor(ctx.buyerId, orders.map((o) => o.id));
    return orders.map((o) => toOrderView(o, claims));
  }),

  detail: buyerProcedure.input(z.object({ orderId: z.string() })).query(async ({ ctx, input }) => {
    const [order] = await loadOrders(ctx.buyerId, input.orderId);
    // Someone else's order is indistinguishable from one that does not exist.
    if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "We couldn't find that order." });
    return toOrderView(order, await claimsFor(ctx.buyerId, [order.id]));
  }),
});
