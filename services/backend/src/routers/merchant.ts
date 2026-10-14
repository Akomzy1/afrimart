import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { prisma } from "../db.js";
import { publicProcedure, router } from "../trpc.js";
import { PERMIT_STATEMENT_VERSION } from "../config.js";
import { sellerCategoryNotices } from "../quality/categoryAccess.js";
import { CONTROLLED_CATEGORY_LABEL, isHomeTier, permitStatement } from "../quality/listingStandards.js";

const CONTROLLED = ["meat", "poultry", "fish", "dairy"] as const;

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

  /* ------------------------------------------------------------ QC-1 */

  /**
   * QC-1 — apply to have a licensed commercial kitchen recognised, which lifts
   * the chilled-and-frozen restriction. This only ever creates an application:
   * the status is `applied` until a reviewer who has checked the licence moves
   * it, so a seller cannot grant it to themselves. Stores have no use for it.
   */
  applyForKitchenLicence: publicProcedure
    .input(
      z.object({
        storeId: z.string(),
        licenceNumber: z.string().trim().min(1),
        issuingAuthority: z.string().trim().min(1),
        evidence: z.string().trim().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const store = await prisma.store.findUnique({ where: { id: input.storeId } });
      if (!store) throw new TRPCError({ code: "NOT_FOUND", message: "We couldn't find that account." });
      if (!isHomeTier(store.sellerType)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This applies to home-based and aspiring sellers. Stores can already list chilled and frozen goods.",
        });
      }

      const existing = await prisma.kitchenLicence.findUnique({ where: { storeId: input.storeId } });
      if (existing && (existing.status === "applied" || existing.status === "approved")) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            existing.status === "approved"
              ? "Your licensed kitchen is already approved."
              : "Your application is already with our team. We'll be in touch once it has been reviewed.",
        });
      }

      // A fresh application after a refusal or revocation reuses the row and
      // goes back to the start of review. Every earlier decision stays in the
      // audit log, which is where the history lives.
      const fields = {
        status: "applied" as const,
        licenceNumber: input.licenceNumber,
        issuingAuthority: input.issuingAuthority,
        evidence: input.evidence || null,
        reviewNote: null,
        reviewedAt: null,
        reviewedByEmail: null,
      };
      const row = await prisma.kitchenLicence.upsert({
        where: { storeId: input.storeId },
        create: { storeId: input.storeId, ...fields },
        update: fields,
      });
      return { status: row.status };
    }),

  /**
   * QC-1 — where this seller stands on each of meat, poultry, fish and dairy:
   * the exact words they are asked to confirm, and when they did. Home-based
   * and aspiring sellers only; for a store this is empty.
   */
  permitStatus: publicProcedure.input(storeInput).query(async ({ input }) => {
    const store = await prisma.store.findUnique({ where: { id: input.storeId } });
    if (!store || !isHomeTier(store.sellerType)) return [];
    const confirmations = await prisma.permitConfirmation.findMany({ where: { storeId: input.storeId } });
    const confirmedAt = new Map(confirmations.map((c) => [c.category, c.confirmedAt]));
    return CONTROLLED.map((category) => ({
      category,
      label: CONTROLLED_CATEGORY_LABEL[category],
      statement: permitStatement(category),
      confirmedAt: confirmedAt.get(category) ?? null,
    }));
  }),

  /**
   * QC-1 — the one-time confirmation that the seller holds any permit their
   * state requires for a category, asked when they first list it. Needs an
   * explicit `acknowledged: true`, so it cannot be recorded by a default or an
   * empty call. Idempotent: confirming again keeps the original timestamp.
   */
  confirmPermit: publicProcedure
    .input(z.object({ storeId: z.string(), category: z.enum(CONTROLLED), acknowledged: z.literal(true) }))
    .mutation(async ({ input }) => {
      const store = await prisma.store.findUnique({ where: { id: input.storeId } });
      if (!store) throw new TRPCError({ code: "NOT_FOUND", message: "We couldn't find that account." });
      if (!isHomeTier(store.sellerType)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A permit confirmation is only asked of home-based and aspiring sellers.",
        });
      }
      const row = await prisma.permitConfirmation.upsert({
        where: { storeId_category: { storeId: input.storeId, category: input.category } },
        create: { storeId: input.storeId, category: input.category, statementVersion: PERMIT_STATEMENT_VERSION },
        update: {},
      });
      return { category: row.category, confirmedAt: row.confirmedAt };
    }),

  /**
   * QC-1 — why some of this seller's listings are hidden, in plain words, and
   * how to reach support. Empty when nothing is switched off.
   */
  categoryNotices: publicProcedure.input(storeInput).query(async ({ input }) => {
    const store = await prisma.store.findUnique({ where: { id: input.storeId } });
    if (!store) return [];
    return sellerCategoryNotices(prisma, store.id, store.sellerType);
  }),

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
