import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { prisma } from "../db.js";
import { merchantProcedure, router } from "../trpc.js";
import { PERMIT_STATEMENT_VERSION } from "../config.js";
import { sellerCategoryNotices, visibleListings } from "../quality/categoryAccess.js";
import { PhotoRejected, decodeUpload } from "../storage/photos.js";
import { assertCanKeepDocuments, photoStore } from "../storage/store.js";
import { signedPhotoUrl } from "../storage/access.js";
import { DashboardUnavailable, payoutDashboard } from "../payments/dashboard.js";
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
 * Which store is asking comes from the signed-in session on the request
 * (`ctx.storeId`, resolved in trpc.ts from the texted-code sign-in), never from
 * input: no procedure here accepts a store id.
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

/**
 * A document photo the seller sent in support of an application (a kitchen
 * licence, a business registration). It is what the reviewer reads, so it is
 * kept as the application's evidence; the same metadata-stripping store as the
 * packing and claim photos holds it.
 */
async function storeDocument(photo: string): Promise<string> {
  try {
    // Not from real sellers until documents have durable, private storage.
    assertCanKeepDocuments();
    return await photoStore.put("document", decodeUpload(photo));
  } catch (e) {
    if (e instanceof PhotoRejected) throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
    throw e;
  }
}

export const merchantRouter = router({
  /** The signed-in shop, for the app's header. UNAUTHORIZED is how the app learns it has to ask for a code. */
  me: merchantProcedure.query(async ({ ctx }) => {
    const store = await prisma.store.findUniqueOrThrow({ where: { id: ctx.storeId }, include: { hubMetro: true } });
    return { name: store.name, ownerName: store.ownerName, metro: `${store.hubMetro.name}, ${store.hubMetro.state}` };
  }),

  /** MCH-2 — this store's inbox: one card per shipment it has to fulfil. */
  inbox: merchantProcedure.query(async ({ ctx }) => {
    const shipments = await prisma.shipment.findMany({
      where: { storeId: ctx.storeId, status: { not: "delivered" } },
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
      /** QC-2 — null until the box has been photographed. A short-lived signed link: this store packed it. */
      packingPhotoUrl: signedPhotoUrl(s.packingPhotoUrl),
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
  accept: merchantProcedure
    .input(z.object({ shipmentId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      // Scoped to the caller's own store: another store's shipment is "no longer
      // available", not "forbidden", so its existence is not confirmed either.
      const shipment = await prisma.shipment.findFirst({ where: { id: input.shipmentId, storeId: ctx.storeId } });
      if (!shipment) throw new TRPCError({ code: "NOT_FOUND", message: "That order is no longer available." });
      return prisma.shipment.update({
        where: { id: shipment.id },
        data: {
          status: "label_created",
          // A real EasyPost label replaces this once credentials exist.
          trackingNumber: shipment.trackingNumber ?? `TRK${shipment.id.slice(-8).toUpperCase()}`,
        },
      });
    }),

  /**
   * QC-2 — photograph the open box before sealing it. The photo is the evidence
   * for every later dispute about what was in the parcel, including a "missing
   * from the box" claim (QC-3), so it is taken after the last item is in and
   * before the box is closed, and the shipment cannot be handed over without it.
   *
   * The image arrives as base64, is re-encoded and stripped of all metadata
   * (the GPS position of the shop included) by the photo store, and only then
   * written. Retaking replaces the saved photo.
   */
  packingPhoto: merchantProcedure
    .input(z.object({ shipmentId: z.string(), image: z.string().min(1).max(12_000_000) }))
    .mutation(async ({ input, ctx }) => {
      const shipment = await prisma.shipment.findFirst({ where: { id: input.shipmentId, storeId: ctx.storeId } });
      if (!shipment) throw new TRPCError({ code: "NOT_FOUND", message: "That order is no longer available." });
      if (shipment.status === "pending") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Accept the order before photographing the box." });
      }
      if (shipment.status !== "label_created") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This order has already been handed over." });
      }

      let url: string;
      try {
        url = await photoStore.put("packing", decodeUpload(input.image));
      } catch (e) {
        if (e instanceof PhotoRejected) throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
        throw e;
      }
      await prisma.shipment.update({
        where: { id: shipment.id },
        data: { packingPhotoUrl: url, packingPhotoAt: new Date() },
      });
      return { photoUrl: signedPhotoUrl(url)! };
    }),

  /** MCH-4 — everything is packed, photographed and handed to the carrier. */
  markShipped: merchantProcedure
    .input(z.object({ shipmentId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const shipment = await prisma.shipment.findFirst({ where: { id: input.shipmentId, storeId: ctx.storeId } });
      if (!shipment) throw new TRPCError({ code: "NOT_FOUND", message: "That order is no longer available." });
      // QC-2 — enforced here, not only by a disabled button: every shipment has
      // a packing photo on record before it leaves the seller's hands.
      if (!shipment.packingPhotoUrl) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Photograph the open box before you hand it over." });
      }
      return prisma.shipment.update({ where: { id: shipment.id }, data: { status: "picked_up" } });
    }),

  /* ------------------------------------------------------------ QC-1 */

  /**
   * QC-1 — apply to have a licensed commercial kitchen recognised, which lifts
   * the chilled-and-frozen restriction. This only ever creates an application:
   * the status is `applied` until a reviewer who has checked the licence moves
   * it, so a seller cannot grant it to themselves. Stores have no use for it.
   */
  applyForKitchenLicence: merchantProcedure
    .input(
      z.object({
        licenceNumber: z.string().trim().min(1).optional(),
        issuingAuthority: z.string().trim().min(1).optional(),
        evidence: z.string().trim().optional(),
        /** A photo of the licence, as base64. Enough on its own: a reviewer reads it. */
        document: z.string().min(1).max(12_000_000).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const store = await prisma.store.findUniqueOrThrow({ where: { id: ctx.storeId } });
      if (!isHomeTier(store.sellerType)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This applies to home-based and aspiring sellers. Stores can already list chilled and frozen goods.",
        });
      }
      if (!input.document && !(input.licenceNumber && input.issuingAuthority)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Send a photo of your kitchen licence, or its number and who issued it.",
        });
      }

      const existing = await prisma.kitchenLicence.findUnique({ where: { storeId: ctx.storeId } });
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
      const documentUrl = input.document ? await storeDocument(input.document) : null;
      const fields = {
        status: "applied" as const,
        licenceNumber: input.licenceNumber ?? null,
        issuingAuthority: input.issuingAuthority ?? null,
        evidence: documentUrl ?? (input.evidence || null),
        reviewNote: null,
        reviewedAt: null,
        reviewedByEmail: null,
        // A fresh application is a fresh review: nothing a reviewer recorded
        // against the last one carries over (it stays in the audit log).
        verifiedLicenceNumber: null,
        verifiedIssuingAuthority: null,
        licenceExpiresOn: null,
      };
      const row = await prisma.kitchenLicence.upsert({
        where: { storeId: ctx.storeId },
        create: { storeId: ctx.storeId, ...fields },
        update: fields,
      });
      return { status: row.status };
    }),

  /**
   * CAT-8 — apply for an authenticity badge. Like the kitchen licence, this only
   * ever creates an application: the badge is `applied` until a reviewer
   * approves it, so a seller cannot award themselves one. A fresh application
   * after a refusal or revocation goes back to the start of review.
   */
  applyForBadge: merchantProcedure
    .input(
      z.object({
        kind: z.enum(["diaspora_owned", "imported_direct", "made_in_usa_african_brand"]),
        evidence: z.string().trim().optional(),
        /** A photo of the supporting document, as base64. */
        document: z.string().min(1).max(12_000_000).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const key = { storeId_kind: { storeId: ctx.storeId, kind: input.kind } };
      const existing = await prisma.sellerBadge.findUnique({ where: key });
      if (existing && (existing.status === "applied" || existing.status === "approved")) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            existing.status === "approved"
              ? "You already have this badge."
              : "Your application is already with our team. We'll be in touch once it has been reviewed.",
        });
      }
      const documentUrl = input.document ? await storeDocument(input.document) : null;
      const fields = {
        status: "applied" as const,
        evidence: documentUrl ?? (input.evidence || null),
        reviewNote: null,
        reviewedAt: null,
      };
      const row = await prisma.sellerBadge.upsert({
        where: key,
        create: { storeId: ctx.storeId, kind: input.kind, ...fields },
        update: fields,
      });
      return { status: row.status };
    }),

  /**
   * QC-1 — where this seller stands on each of meat, poultry, fish and dairy:
   * the exact words they are asked to confirm, and when they did. Home-based
   * and aspiring sellers only; for a store this is empty.
   */
  permitStatus: merchantProcedure.query(async ({ ctx }) => {
    const store = await prisma.store.findUniqueOrThrow({ where: { id: ctx.storeId } });
    if (!isHomeTier(store.sellerType)) return [];
    const confirmations = await prisma.permitConfirmation.findMany({ where: { storeId: ctx.storeId } });
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
  confirmPermit: merchantProcedure
    .input(z.object({ category: z.enum(CONTROLLED), acknowledged: z.literal(true) }))
    .mutation(async ({ input, ctx }) => {
      const store = await prisma.store.findUniqueOrThrow({ where: { id: ctx.storeId } });
      if (!isHomeTier(store.sellerType)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A permit confirmation is only asked of home-based and aspiring sellers.",
        });
      }
      const row = await prisma.permitConfirmation.upsert({
        where: { storeId_category: { storeId: ctx.storeId, category: input.category } },
        create: { storeId: ctx.storeId, category: input.category, statementVersion: PERMIT_STATEMENT_VERSION },
        update: {},
      });
      return { category: row.category, confirmedAt: row.confirmedAt };
    }),

  /**
   * QC-1 — why some of this seller's listings are hidden, in plain words, and
   * how to reach support. Empty when nothing is switched off.
   */
  categoryNotices: merchantProcedure.query(async ({ ctx }) => {
    const store = await prisma.store.findUniqueOrThrow({ where: { id: ctx.storeId } });
    return sellerCategoryNotices(prisma, store.id, store.sellerType);
  }),

  /**
   * Where this seller stands on everything the QC-1 screens need in one read:
   * whether the home-tier rules apply to them, their licensed-kitchen and badge
   * applications, and the one-time permit confirmations already given.
   */
  standing: merchantProcedure.query(async ({ ctx }) => {
    const store = await prisma.store.findUniqueOrThrow({
      where: { id: ctx.storeId },
      include: { kitchenLicence: true, badges: true, permitConfirmations: true },
    });
    return {
      homeTier: isHomeTier(store.sellerType),
      kitchen: store.kitchenLicence?.status ?? null,
      badges: store.badges.map((b) => ({ kind: b.kind, status: b.status })),
      permitsConfirmed: store.permitConfirmations.map((p) => p.category),
    };
  }),

  /**
   * "What's listed" — this store's products, each marked hidden when the QC-1
   * rules keep it from buyers. Hidden is decided by the same filter buyers'
   * reads go through, so the seller is never shown a different answer.
   */
  listings: merchantProcedure.query(async ({ ctx }) => {
    const [all, visible, store] = await Promise.all([
      prisma.listing.findMany({
        where: { storeId: ctx.storeId },
        include: { canonicalProduct: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.listing.findMany({
        where: await visibleListings(prisma, { storeId: ctx.storeId }),
        select: { id: true },
      }),
      prisma.store.findUniqueOrThrow({ where: { id: ctx.storeId }, include: { kitchenLicence: true } }),
    ]);
    const visibleIds = new Set(visible.map((l) => l.id));
    const licensed = store.kitchenLicence?.status === "approved";
    return all.map((l) => {
      const hidden = !visibleIds.has(l.id);
      return {
        id: l.id,
        name: l.canonicalProduct.canonicalName,
        category: l.canonicalProduct.category,
        controlledCategory: l.canonicalProduct.controlledCategory,
        priceCents: l.priceCents,
        inStock: l.stockStatus !== "out_of_stock",
        hidden,
        // Cold food without a licensed kitchen is hidden for a different reason
        // than a category being switched off, and the way out is different too.
        hiddenReason: !hidden
          ? null
          : isHomeTier(store.sellerType) && l.temperatureClass !== "ambient" && !licensed
            ? ("needs_kitchen_licence" as const)
            : ("category_paused" as const),
      };
    });
  }),

  /** Fix a price or mark a product in or out of stock. Scoped to this store. */
  updateListing: merchantProcedure
    .input(
      z.object({
        listingId: z.string(),
        priceCents: z.number().int().min(50).max(1_000_000),
        inStock: z.boolean(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const listing = await prisma.listing.findFirst({ where: { id: input.listingId, storeId: ctx.storeId } });
      if (!listing) throw new TRPCError({ code: "NOT_FOUND", message: "That product is no longer listed." });
      // A made-to-order product stays so unless it is being marked out.
      const stockStatus = !input.inStock
        ? "out_of_stock"
        : listing.stockStatus === "out_of_stock"
          ? "in_stock"
          : listing.stockStatus;
      await prisma.listing.update({
        where: { id: listing.id },
        data: { priceCents: input.priceCents, stockStatus },
      });
      return { id: listing.id };
    }),

  /* ------------------------------------------------ the AfriMart thread */

  /**
   * Messages AfriMart has posted to this store's thread, oldest first, and how
   * many are unread. Payouts are posted here when they are made (the amount,
   * the date, the order), which is where a seller sees what they have earned.
   */
  thread: merchantProcedure.query(async ({ ctx }) => {
    const rows = await prisma.sellerMessage.findMany({
      where: { storeId: ctx.storeId },
      orderBy: { createdAt: "asc" },
      take: 200,
    });
    return {
      unread: rows.filter((m) => m.readAt === null).length,
      messages: rows.map((m) => ({
        id: m.id,
        kind: m.kind,
        body: m.body,
        amountCents: m.amountCents,
        paidOn: m.paidOn,
        orderRefs: m.orderRefs,
        createdAt: m.createdAt,
        unread: m.readAt === null,
      })),
    };
  }),

  /** Mark everything in the thread as read, which is what opening it does. */
  markThreadRead: merchantProcedure.mutation(async ({ ctx }) => {
    const result = await prisma.sellerMessage.updateMany({
      where: { storeId: ctx.storeId, readAt: null },
      data: { readAt: new Date() },
    });
    return { marked: result.count };
  }),

  /**
   * A fresh link into this store's Stripe Express dashboard, where the full
   * payout history lives ("See all payouts"). Made on request for the signed-in
   * store's own connected account and returned; it is never stored, since a
   * login link is single-use and expires within minutes.
   */
  payoutDashboardLink: merchantProcedure.mutation(async ({ ctx }) => {
    const store = await prisma.store.findUniqueOrThrow({ where: { id: ctx.storeId }, select: { payoutAccountId: true } });
    if (!store.payoutAccountId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Your payout account isn't set up yet. We'll message you here when it is." });
    }
    try {
      return await payoutDashboard.loginLink(store.payoutAccountId);
    } catch (e) {
      if (e instanceof DashboardUnavailable) throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
      throw e;
    }
  }),

  /** What this store has earned, per PAY-6 payout statements. */
  earnings: merchantProcedure.query(async ({ ctx }) => {
    const payouts = await prisma.payout.findMany({ where: { storeId: ctx.storeId } });
    return {
      orderCount: payouts.length,
      grossCents: payouts.reduce((s, p) => s + p.grossCents, 0),
      netCents: payouts.reduce((s, p) => s + p.netCents, 0),
    };
  }),
});
