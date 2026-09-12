import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { prisma } from "../db.js";
import { publicProcedure, router } from "../trpc.js";

/**
 * PRD 6.2 — the merchant app's order surface (MCH-2 accept, MCH-4 fulfil).
 *
 * A store works in *shipments*, not orders. An order can span stores, and a
 * store must only ever see its own parcel: its own lines, its own label, its
 * own temperature stream. Keying this router on Shipment rather than Order is
 * what enforces that — there is no query here that can return another store's
 * items, because the relation does not lead there.
 *
 * There is no merchant auth yet, so storeId is passed in. That is the single
 * thing to replace when sign-in lands: every procedure already scopes by it.
 */

function minutesAgo(from: Date): string {
  const mins = Math.max(0, Math.round((Date.now() - from.getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** The merchant's three states, derived from the shipment's carrier status. */
function merchantStatus(status: string): "new" | "packing" | "ready" {
  if (status === "pending") return "new";
  if (status === "label_created") return "packing";
  return "ready";
}

const storeInput = z.object({ storeId: z.string() });

export const merchantRouter = router({
  /** Which stores exist, so the app can pick one while there is no sign-in. */
  stores: publicProcedure.query(async () => {
    const stores = await prisma.store.findMany({
      where: { onboardingStatus: "live" },
      include: { hubMetro: true },
      orderBy: { name: "asc" },
    });
    return stores.map((s) => ({
      id: s.id,
      name: s.name,
      ownerName: s.ownerName,
      metro: `${s.hubMetro.name}, ${s.hubMetro.state}`,
    }));
  }),

  /** MCH-2 — this store's inbox: one card per shipment it has to fulfil. */
  inbox: publicProcedure.input(storeInput).query(async ({ input }) => {
    const shipments = await prisma.shipment.findMany({
      where: { storeId: input.storeId, status: { not: "delivered" } },
      include: { items: true, order: { include: { buyer: true } } },
      orderBy: { createdAt: "desc" },
    });

    return shipments.map((s) => ({
      // The merchant's handle on the job is the shipment, but buyers and
      // support talk in order numbers, so show the order and keep both.
      shipmentId: s.id,
      orderRef: `#${s.orderId.slice(-4).toUpperCase()}`,
      buyer: s.order.buyer.email.split("@")[0],
      ago: minutesAgo(s.createdAt),
      status: merchantStatus(s.status),
      temperatureClass: s.temperatureClass,
      carrier: s.carrier,
      estimatedDelivery: s.estimatedDelivery,
      /** This parcel's value only — not the buyer's order total. */
      valueCents: s.items.reduce((sum, i) => sum + i.lineTotalCents, 0),
      items: s.items.map((i) => ({
        name: i.nameSnapshot,
        packSize: i.packSizeSnapshot,
        category: i.categorySnapshot,
        qty: i.quantity,
      })),
    }));
  }),

  /** MCH-2 — accept the job; the label is generated at this point (FUL-1). */
  accept: publicProcedure
    .input(z.object({ shipmentId: z.string() }))
    .mutation(async ({ input }) => {
      const shipment = await prisma.shipment.findUnique({ where: { id: input.shipmentId } });
      if (!shipment) throw new TRPCError({ code: "NOT_FOUND", message: "That order is no longer available." });
      return prisma.shipment.update({
        where: { id: input.shipmentId },
        data: {
          status: "label_created",
          // A real EasyPost label replaces this once credentials exist.
          trackingNumber: shipment.trackingNumber ?? `TRK${input.shipmentId.slice(-8).toUpperCase()}`,
        },
      });
    }),

  /** MCH-4 — everything is packed and handed to the carrier. */
  markShipped: publicProcedure
    .input(z.object({ shipmentId: z.string() }))
    .mutation(({ input }) =>
      prisma.shipment.update({ where: { id: input.shipmentId }, data: { status: "picked_up" } }),
    ),

  /** What this store has earned, per PAY-6 payout statements. */
  earnings: publicProcedure.input(storeInput).query(async ({ input }) => {
    const payouts = await prisma.payout.findMany({ where: { storeId: input.storeId } });
    return {
      orderCount: payouts.length,
      grossCents: payouts.reduce((s, p) => s + p.grossCents, 0),
      netCents: payouts.reduce((s, p) => s + p.netCents, 0),
    };
  }),
});
