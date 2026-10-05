import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { prisma } from "../db.js";
import { router, staffProcedure } from "../trpc.js";
import { writeAudit, type AuditedAction } from "../auth/audit.js";
import { CATALOGUE_AUTO_APPROVE_CONFIDENCE, STUCK_ORDER_HOURS } from "../config.js";
import { computeHold } from "../payments/payout.js";

/**
 * PRD 6.11 — the internal operations console's API (ADM-1 to ADM-5).
 *
 * No auth yet, in common with the rest of the build. That matters more here
 * than elsewhere: every procedure in this file is an internal surface that
 * mutates catalogue, onboarding or money. Nothing is exposed to the buyer or
 * merchant apps, and the whole router should sit behind staff authentication
 * before it is deployed anywhere reachable.
 */

const idInput = z.object({ id: z.string() });

/**
 * Which store changes count as a change of standing. A hub reassignment or a
 * normal step through onboarding is routine; suspension, delisting,
 * reinstatement and any verification change are not, because each one changes
 * whether a seller can trade and who is accountable for that decision.
 */
function auditActionForStoreChange(
  before: { onboardingStatus: string; verificationStatus: string },
  after: { onboardingStatus: string; verificationStatus: string },
): AuditedAction | null {
  if (before.onboardingStatus !== after.onboardingStatus) {
    if (after.onboardingStatus === "suspended") return "store.suspend";
    if (after.onboardingStatus === "delisted") return "store.delist";
    if (["suspended", "delisted"].includes(before.onboardingStatus) && after.onboardingStatus === "live") {
      return "store.reinstate";
    }
  }
  if (before.verificationStatus !== after.verificationStatus) return "store.verification_change";
  return null;
}


export const adminRouter = router({
  /* ---------------------------------------------------------------- ADM-1 */

  /**
   * The catalogue review queue. Low-confidence entries first, because those
   * are the ones CAT-6 is actually protecting the catalogue from — a reviewer
   * working top-down should meet the riskiest items while fresh.
   */
  reviewQueue: staffProcedure("catalogue:read")
    .input(z.object({ includeResolved: z.boolean().default(false) }).optional())
    .query(async ({ input }) => {
      const drafts = await prisma.catalogueDraft.findMany({
        where: input?.includeResolved ? {} : { status: "pending_review" },
        include: { store: { include: { hubMetro: true } } },
        orderBy: [{ confidence: "asc" }, { createdAt: "asc" }],
        take: 200,
      });

      const matchedIds = drafts.map((d) => d.matchedProductId).filter((v): v is string => Boolean(v));
      const matches = matchedIds.length
        ? await prisma.canonicalProduct.findMany({
            where: { id: { in: matchedIds } },
            select: { id: true, canonicalName: true, packSize: true },
          })
        : [];
      const matchById = new Map(matches.map((m) => [m.id, m]));

      return drafts.map((d) => ({
        id: d.id,
        storeName: d.store.name,
        metro: d.store.hubMetro.name,
        rawText: d.rawText,
        suggestedName: d.suggestedName,
        suggestedPriceCents: d.suggestedPriceCents,
        packSize: d.packSize,
        temperatureClass: d.temperatureClass,
        confidence: d.confidence,
        /** CAT-6 — below this a human must confirm before it can be published. */
        belowThreshold: d.confidence < CATALOGUE_AUTO_APPROVE_CONFIDENCE,
        matchedProduct: d.matchedProductId ? (matchById.get(d.matchedProductId) ?? null) : null,
        status: d.status,
        createdAt: d.createdAt,
      }));
    }),

  /**
   * Approving a draft is what creates the public listing. The reviewer must
   * name the canonical product it resolves to — an approval cannot invent one
   * implicitly, or the knowledge graph fills with near-duplicates (CAT-3).
   */
  approveDraft: staffProcedure("catalogue:write")
    .input(
      z.object({
        id: z.string(),
        canonicalProductId: z.string(),
        priceCents: z.number().int().positive(),
        note: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const draft = await prisma.catalogueDraft.findUnique({ where: { id: input.id } });
      if (!draft) throw new TRPCError({ code: "NOT_FOUND", message: "That draft no longer exists." });
      if (draft.status !== "pending_review") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "That draft has already been resolved." });
      }
      const product = await prisma.canonicalProduct.findUnique({ where: { id: input.canonicalProductId } });
      if (!product) throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown canonical product." });

      return prisma.$transaction(async (tx) => {
        const listing = await tx.listing.create({
          data: {
            storeId: draft.storeId,
            canonicalProductId: product.id,
            priceCents: input.priceCents,
            temperatureClass: product.temperatureClass,
            shippingWeightOz: product.shippingWeightOz,
            lengthIn: product.lengthIn,
            widthIn: product.widthIn,
            heightIn: product.heightIn,
          },
        });
        await tx.catalogueDraft.update({
          where: { id: draft.id },
          data: { status: "approved", reviewNote: input.note, reviewedAt: new Date() },
        });
        return { listingId: listing.id };
      });
    }),

  rejectDraft: staffProcedure("catalogue:write")
    .input(z.object({ id: z.string(), note: z.string().min(1) }))
    .mutation(({ input }) =>
      prisma.catalogueDraft.update({
        where: { id: input.id },
        data: { status: "rejected", reviewNote: input.note, reviewedAt: new Date() },
      }),
    ),

  /* ---------------------------------------------------------------- ADM-2 */

  /** Store onboarding: where every seller is, and what is blocking them. */
  stores: staffProcedure("stores:read").query(async () => {
    const stores = await prisma.store.findMany({
      include: {
        hubMetro: true,
        _count: { select: { listings: true, catalogueDrafts: true } },
      },
      orderBy: [{ onboardingStatus: "asc" }, { name: "asc" }],
    });
    return stores.map((s) => ({
      id: s.id,
      name: s.name,
      ownerName: s.ownerName,
      sellerType: s.sellerType,
      onboardingStatus: s.onboardingStatus,
      verificationStatus: s.verificationStatus,
      metro: `${s.hubMetro.name}, ${s.hubMetro.state}`,
      hubMetroId: s.hubMetroId,
      listingCount: s._count.listings,
      pendingDrafts: s._count.catalogueDrafts,
      /** SEL-2 — a store cannot be routed orders until this is true. */
      canReceiveOrders: s.verificationStatus === "verified" && s.onboardingStatus === "live",
    }));
  }),

  hubs: staffProcedure("stores:read").query(() =>
    prisma.hubMetro.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, state: true } }),
  ),

  updateStore: staffProcedure("stores:write")
    .input(
      z.object({
        id: z.string(),
        onboardingStatus: z
          .enum(["pending", "filming", "reviewing", "kit_issued", "live", "suspended", "delisted"])
          .optional(),
        verificationStatus: z.enum(["unverified", "pending", "verified"]).optional(),
        hubMetroId: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { id, ...patch } = input;
      const before = await prisma.store.findUnique({ where: { id } });
      if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "No such store." });

      return prisma.$transaction(async (tx) => {
        const after = await tx.store.update({
          where: { id },
          data: {
            ...patch,
            // SEL-2 — stamp the moment verification was granted, for the record.
            ...(patch.verificationStatus === "verified" ? { verifiedAt: new Date() } : {}),
          },
        });

        // Anything that changes a seller's standing is audited; a hub move or
        // a step through onboarding is routine and is not.
        const action = auditActionForStoreChange(before, after);
        if (action) {
          await writeAudit(tx, ctx.staff, {
            action,
            subjectType: "store",
            subjectId: id,
            before: { onboardingStatus: before.onboardingStatus, verificationStatus: before.verificationStatus },
            after: { onboardingStatus: after.onboardingStatus, verificationStatus: after.verificationStatus },
          });
        }
        return after;
      });
    }),

  /* ---------------------------------------------------------------- ADM-3 */

  /**
   * Fulfilment monitoring. "Stuck" is deliberately defined here rather than
   * left to a reviewer's eye: a shipment a seller has not moved within the
   * window is the thing operations exists to catch before the buyer notices.
   */
  fulfilment: staffProcedure("fulfilment:read").query(async () => {
    const cutoff = new Date(Date.now() - STUCK_ORDER_HOURS * 3600_000);
    const shipments = await prisma.shipment.findMany({
      where: { status: { notIn: ["delivered"] } },
      include: {
        store: true,
        items: true,
        order: { include: { buyer: true } },
      },
      orderBy: { createdAt: "asc" },
      take: 200,
    });

    return shipments.map((s) => ({
      shipmentId: s.id,
      orderId: s.orderId,
      orderRef: `#${s.orderId.slice(-4).toUpperCase()}`,
      buyer: s.order.buyer.email,
      storeName: s.store.name,
      status: s.status,
      temperatureClass: s.temperatureClass,
      carrier: s.carrier,
      trackingNumber: s.trackingNumber,
      estimatedDelivery: s.estimatedDelivery,
      createdAt: s.createdAt,
      itemCount: s.items.reduce((n, i) => n + i.quantity, 0),
      valueCents: s.items.reduce((n, i) => n + i.lineTotalCents, 0),
      /** Not accepted or not moved inside the window — needs a human. */
      stuck: s.createdAt < cutoff && ["pending", "label_created"].includes(s.status),
      hoursWaiting: Math.floor((Date.now() - s.createdAt.getTime()) / 3600_000),
    }));
  }),

  /** Intervene on a stuck shipment: nudge it along or cancel the order. */
  interveneShipment: staffProcedure("fulfilment:write")
    .input(
      z.object({
        shipmentId: z.string(),
        action: z.enum(["mark_shipped", "mark_delivered", "flag_exception", "cancel_order"]),
        note: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      if (input.action === "cancel_order") {
        const shipment = await prisma.shipment.findUnique({ where: { id: input.shipmentId } });
        if (!shipment) throw new TRPCError({ code: "NOT_FOUND", message: "No such shipment." });
        return prisma.order.update({ where: { id: shipment.orderId }, data: { status: "cancelled" } });
      }
      const status =
        input.action === "mark_shipped" ? "picked_up" : input.action === "mark_delivered" ? "delivered" : "exception";
      return prisma.shipment.update({ where: { id: input.shipmentId }, data: { status } });
    }),

  /* ---------------------------------------------------------------- ADM-4 */

  /** The knowledge graph: canonical products and the names that resolve to them. */
  graph: staffProcedure("graph:read").input(z.object({ search: z.string().optional() }).optional()).query(async ({ input }) => {
    const term = input?.search?.trim();
    const products = await prisma.canonicalProduct.findMany({
      where: term
        ? {
            OR: [
              { canonicalName: { contains: term, mode: "insensitive" } },
              { aliases: { some: { alias: { contains: term, mode: "insensitive" } } } },
            ],
          }
        : {},
      include: { aliases: true, _count: { select: { listings: true } } },
      orderBy: { canonicalName: "asc" },
      take: 100,
    });
    return products.map((p) => ({
      id: p.id,
      canonicalName: p.canonicalName,
      category: p.category,
      cuisine: p.cuisine,
      packSize: p.packSize,
      temperatureClass: p.temperatureClass,
      listingCount: p._count.listings,
      aliases: p.aliases.map((a) => ({ id: a.id, alias: a.alias, language: a.language, confidence: a.confidence })),
    }));
  }),

  addCanonicalProduct: staffProcedure("graph:write")
    .input(
      z.object({
        canonicalName: z.string().min(1),
        shortDescription: z.string().min(1),
        usedDescription: z.string().min(1),
        category: z.string().min(1),
        cuisine: z.string().min(1),
        packSize: z.string().min(1),
        temperatureClass: z.enum(["ambient", "refrigerated", "frozen"]),
        shippingWeightOz: z.number().positive(),
        lengthIn: z.number().positive(),
        widthIn: z.number().positive(),
        heightIn: z.number().positive(),
      }),
    )
    .mutation(({ input }) => prisma.canonicalProduct.create({ data: { ...input, images: [] } })),

  addAlias: staffProcedure("graph:write")
    .input(
      z.object({
        canonicalProductId: z.string(),
        alias: z.string().min(1),
        language: z.string().min(1),
        confidence: z.number().min(0).max(1).default(1),
      }),
    )
    .mutation(({ input }) => prisma.nameAlias.create({ data: input })),

  removeAlias: staffProcedure("graph:write").input(idInput).mutation(({ input }) =>
    prisma.nameAlias.delete({ where: { id: input.id } }),
  ),

  /* ---------------------------------------------------------------- ADM-5 */

  /**
   * Financial reconciliation. The question this answers is "does the money
   * add up", so it reports the identity rather than a pile of figures: what
   * buyers were charged should equal what sellers are owed, plus the
   * platform's commission and fees, plus tax, plus what the carriers cost.
   */
  reconciliation: staffProcedure("finance:read").query(async () => {
    const [orders, payouts, adjustments, payments] = await Promise.all([
      prisma.order.findMany({ select: { totalCents: true, shippingCents: true, taxCents: true, status: true } }),
      prisma.payout.findMany({ include: { store: { select: { name: true } } } }),
      prisma.carrierAdjustment.findMany({ include: { store: { select: { name: true } } } }),
      prisma.payment.findMany({ select: { buyerChargeCents: true, status: true } }),
    ]);

    const buyerChargedCents = payments.reduce((n, p) => n + p.buyerChargeCents, 0);
    const taxCollectedCents = orders.reduce((n, o) => n + o.taxCents, 0);
    const shippingCollectedCents = orders.reduce((n, o) => n + o.shippingCents, 0);
    const sellerGrossCents = payouts.reduce((n, p) => n + p.grossCents, 0);
    const sellerNetCents = payouts.reduce((n, p) => n + p.netCents, 0);
    const commissionCents = payouts.reduce((n, p) => n + Math.round((p.grossCents * p.takeRateBps) / 10000), 0);
    const fulfilmentFeeCents = payouts.reduce((n, p) => n + p.fulfilmentFeeCents, 0);
    const adjustmentsCents = adjustments.reduce((n, a) => n + a.amountCents, 0);

    // PAY-8 — what is owed but not yet releasable, and why.
    const heldPayouts = payouts.filter((p) => p.heldUntil && p.heldUntil > new Date());

    return {
      orderCount: orders.length,
      buyerChargedCents,
      taxCollectedCents,
      shippingCollectedCents,
      sellerGrossCents,
      sellerNetCents,
      commissionCents,
      fulfilmentFeeCents,
      adjustmentsCents,
      /** PAY-3 — commission plus the order fee. Never includes shipping. */
      platformRevenueCents: commissionCents + fulfilmentFeeCents,
      heldCents: heldPayouts.reduce((n, p) => n + p.netCents, 0),
      heldCount: heldPayouts.length,
      /**
       * Seller gross and the platform's cut must together equal the item value
       * sellers sold. A non-zero figure here means a payout and its order have
       * drifted apart, which is the one thing this screen must never hide.
       */
      reconciliationDriftCents: sellerGrossCents - (sellerNetCents + commissionCents + fulfilmentFeeCents),
      adjustments: adjustments.map((a) => ({
        id: a.id,
        storeName: a.store.name,
        amountCents: a.amountCents,
        reason: a.reason,
        declaredWeightOz: a.declaredWeightOz,
        actualWeightOz: a.actualWeightOz,
        settled: Boolean(a.settledPayoutId),
      })),
      payouts: payouts.map((p) => ({
        id: p.id,
        storeName: p.store.name,
        grossCents: p.grossCents,
        netCents: p.netCents,
        status: p.status,
        heldUntil: p.heldUntil,
        holdReason: p.holdReason,
      })),
    };
  }),

  /** PAY-8 — what hold a seller would get today, for the console to explain. */
  payoutHoldFor: staffProcedure("finance:read").input(idInput).query(async ({ input }) => {
    const [clean, disputed] = await Promise.all([
      prisma.shipment.count({ where: { storeId: input.id, status: "delivered" } }),
      prisma.refundClaim.count({ where: { status: { in: ["approved", "manual_review"] } } }),
    ]);
    return computeHold({ cleanDeliveredOrders: clean, disputedOrders: disputed }, new Date());
  }),

  /* ------------------------------------------- ADM-5 money, all audited */

  /**
   * PAY-8 — put a payout on hold, or release one. Finance only: `operations`
   * can read the reconciliation screen to chase a problem but cannot move the
   * money, which is the separation the roles exist for.
   */
  holdPayout: staffProcedure("finance:write")
    .input(z.object({ payoutId: z.string(), until: z.coerce.date(), reason: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const before = await prisma.payout.findUnique({ where: { id: input.payoutId } });
      if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "No such payout." });

      return prisma.$transaction(async (tx) => {
        const after = await tx.payout.update({
          where: { id: input.payoutId },
          data: { heldUntil: input.until, holdReason: input.reason, status: "held" },
        });
        await writeAudit(tx, ctx.staff, {
          action: "payout.hold",
          subjectType: "payout",
          subjectId: input.payoutId,
          before: { status: before.status, heldUntil: before.heldUntil, netCents: before.netCents },
          after: { status: after.status, heldUntil: after.heldUntil, netCents: after.netCents },
          note: input.reason,
        });
        return after;
      });
    }),

  releasePayout: staffProcedure("finance:write")
    .input(z.object({ payoutId: z.string(), note: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const before = await prisma.payout.findUnique({ where: { id: input.payoutId } });
      if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "No such payout." });
      if (before.paidAt) throw new TRPCError({ code: "BAD_REQUEST", message: "That payout has already been paid." });

      return prisma.$transaction(async (tx) => {
        const after = await tx.payout.update({
          where: { id: input.payoutId },
          data: { heldUntil: null, holdReason: null, status: "released", paidAt: new Date() },
        });
        await writeAudit(tx, ctx.staff, {
          action: "payout.release",
          subjectType: "payout",
          subjectId: input.payoutId,
          before: { status: before.status, heldUntil: before.heldUntil, paidAt: before.paidAt },
          after: { status: after.status, heldUntil: null, paidAt: after.paidAt },
          note: input.note,
        });
        return after;
      });
    }),

  /**
   * PAY-9 — record a carrier billing correction against the seller that
   * declared the wrong weight or dimensions. Recording it is the audited act;
   * `applyAdjustments` nets it off the next payout.
   */
  recordChargeback: staffProcedure("finance:write")
    .input(
      z.object({
        storeId: z.string(),
        carrierReference: z.string().min(1),
        amountCents: z.number().int().positive(),
        reason: z.string().min(1),
        declaredWeightOz: z.number().positive(),
        actualWeightOz: z.number().positive(),
        shipmentId: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) =>
      prisma.$transaction(async (tx) => {
        const adjustment = await tx.carrierAdjustment.create({ data: input });
        await writeAudit(tx, ctx.staff, {
          action: "chargeback.record",
          subjectType: "adjustment",
          subjectId: adjustment.id,
          before: null,
          after: {
            storeId: input.storeId,
            amountCents: input.amountCents,
            declaredWeightOz: input.declaredWeightOz,
            actualWeightOz: input.actualWeightOz,
          },
          note: input.reason,
        });
        return adjustment;
      }),
    ),

  /** QC-9 — refund claims waiting on a human. */
  refundClaims: staffProcedure("finance:read").query(async () => {
    const claims = await prisma.refundClaim.findMany({
      where: { status: { in: ["manual_review", "auto_approved"] } },
      include: { buyer: { select: { email: true } } },
      orderBy: { createdAt: "asc" },
      take: 200,
    });
    return claims.map((c) => ({
      id: c.id,
      buyerEmail: c.buyer.email,
      orderId: c.orderId,
      reason: c.reason,
      amountCents: c.amountCents,
      photoUrl: c.photoUrl,
      status: c.status,
      recoveryTarget: c.recoveryTarget,
      createdAt: c.createdAt,
    }));
  }),

  /**
   * QC-8 — resolve a claim and say where the cost lands. The refund to the
   * buyer is not what is being decided here; that already happened. This
   * records the recovery, which is the part that affects a seller's money.
   */
  resolveRefundClaim: staffProcedure("finance:write")
    .input(
      z.object({
        claimId: z.string(),
        decision: z.enum(["approve", "reject"]),
        recoveryTarget: z.enum(["seller", "carrier", "platform"]).optional(),
        recoveredCents: z.number().int().min(0).default(0),
        note: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const before = await prisma.refundClaim.findUnique({ where: { id: input.claimId } });
      if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "No such claim." });

      return prisma.$transaction(async (tx) => {
        const after = await tx.refundClaim.update({
          where: { id: input.claimId },
          data: {
            status: input.decision === "approve" ? "approved" : "rejected",
            recoveryTarget: input.recoveryTarget,
            recoveredCents: input.recoveredCents,
            resolvedAt: new Date(),
          },
        });
        await writeAudit(tx, ctx.staff, {
          action: input.decision === "approve" ? "refund.approve" : "refund.reject",
          subjectType: "refund",
          subjectId: input.claimId,
          before: { status: before.status, recoveryTarget: before.recoveryTarget, recoveredCents: before.recoveredCents },
          after: { status: after.status, recoveryTarget: after.recoveryTarget, recoveredCents: after.recoveredCents },
          note: input.note,
        });
        if (input.decision === "approve" && input.recoveryTarget && input.recoveredCents > 0) {
          await writeAudit(tx, ctx.staff, {
            action: "refund.recovery_recorded",
            subjectType: "refund",
            subjectId: input.claimId,
            after: { recoveryTarget: input.recoveryTarget, recoveredCents: input.recoveredCents },
          });
        }
        return after;
      });
    }),

  /** The trail itself. Read-only everywhere — nothing edits or deletes it. */
  auditLog: staffProcedure("audit:read")
    .input(
      z
        .object({ subjectType: z.string().optional(), subjectId: z.string().optional(), limit: z.number().max(500).default(100) })
        .optional(),
    )
    .query(async ({ input }) => {
      const entries = await prisma.auditLogEntry.findMany({
        where: {
          ...(input?.subjectType ? { subjectType: input.subjectType } : {}),
          ...(input?.subjectId ? { subjectId: input.subjectId } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: input?.limit ?? 100,
      });
      return entries.map((e) => ({
        id: e.id,
        actorEmail: e.actorEmail,
        actorRole: e.actorRole,
        action: e.action,
        subjectType: e.subjectType,
        subjectId: e.subjectId,
        before: e.before,
        after: e.after,
        note: e.note,
        createdAt: e.createdAt,
      }));
    }),
});
