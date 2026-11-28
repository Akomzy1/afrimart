import { releaseReservations } from "../catalogue/delivery.js";
import { z } from "zod";
import { createHash, randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { Payout, Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { router, staffProcedure } from "../trpc.js";
import { writeAudit, type AuditedAction } from "../auth/audit.js";
import { CATALOGUE_AUTO_APPROVE_CONFIDENCE, STUCK_ORDER_HOURS } from "../config.js";
import { computeHold, deductCarrierAdjustments, payoutAvailability, sellerPayoutRecord, sellerPayoutRecords, unpaidPayoutParcels } from "../payments/payout.js";
import { computeScore, ladderFor, visibilityMultiplierFor } from "../quality/score.js";
import { publishDraft, releaseReviewedFrames, staffDraft, staffDrafts } from "../catalogue/publication.js";
import { availableFrame, cleanShelfUploads, reviewPhotos } from "../catalogue/photoRetention.js";
import { refundClaim } from "../quality/claimService.js";
import { claimRef } from "../quality/claims.js";
import { CONTROLLED_CATEGORY_LABEL, isHomeTier } from "../quality/listingStandards.js";
import { parsePhotoPath, signedPhotoUrl } from "../storage/access.js";
import { postPayoutMessage } from "../payments/payoutMessage.js";
import { licenceState } from "../quality/licence.js";
import { normalisePhone } from "../auth/signInCodes.js";

const isPhotoPath = (v: string | null): v is string => v !== null && parsePhotoPath(v) !== null;

/**
 * PRD 6.11 â€” the internal operations console's API (ADM-1 to ADM-5).
 *
 * Every route requires an authenticated staff session, MFA and a named
 * permission. Changes to seller standing and onboarding are audited.
 */

const idInput = z.object({ id: z.string() });

async function lockUnpaidPayout(tx: Prisma.TransactionClient, id: string) {
  const [payout] = await tx.$queryRaw<Pick<Payout, "storeId" | "orderId" | "status" | "heldUntil" | "netCents" | "paidAt">[]>`
    SELECT "storeId", "orderId", "status", "heldUntil", "netCents", "paidAt" FROM "Payout" WHERE "id" = ${id} FOR UPDATE
  `;
  if (!payout) throw new TRPCError({ code: "NOT_FOUND", message: "No such payout." });
  if (payout.paidAt) throw new TRPCError({ code: "BAD_REQUEST", message: "That payout has already been paid." });
  return payout;
}

const controlledCategoryInput = z.enum(["meat", "poultry", "fish", "dairy"]);

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
   * are the ones CAT-6 is actually protecting the catalogue from â€” a reviewer
   * working top-down should meet the riskiest items while fresh.
   */
  reviewQueue: staffProcedure("catalogue:read")
    .input(z.object({ includeResolved: z.boolean().default(false) }).optional())
    .query(async ({ input }) => {
      const drafts = await prisma.catalogueDraft.findMany({
        where: { ...staffDrafts, ...(input?.includeResolved ? {} : { status: "pending_review" as const }) },
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

      const photos = await reviewPhotos(drafts);
      return drafts.map((d) => ({
        id: d.id,
        storeName: d.store.name,
        sellerType: d.store.sellerType,
        metro: d.store.hubMetro.name,
        rawText: d.rawText,
        ...(d.jobId && d.status === "pending_review" ? photos(d.frameNames) : { shelfPhoto: null, photoExpired: false }),
        photoRequested: d.status === "pending_review" && !!d.photoRequestId,
        suggestedName: d.suggestedName,
        suggestedPriceCents: d.suggestedPriceCents,
        packSize: d.packSize,
        temperatureClass: d.temperatureClass,
        confidence: d.confidence,
        /** CAT-6 â€” below this a human must confirm before it can be published. */
        belowThreshold: d.confidence < CATALOGUE_AUTO_APPROVE_CONFIDENCE,
        matchedProduct: d.matchedProductId ? (matchById.get(d.matchedProductId) ?? null) : null,
        status: d.status,
        createdAt: d.createdAt,
      }));
    }),

  /**
   * Approving a draft is what creates the public listing. The reviewer must
   * name the canonical product it resolves to â€” an approval cannot invent one
   * implicitly, or the knowledge graph fills with near-duplicates (CAT-3).
   */
  approveDraft: staffProcedure("catalogue:write")
    .input(
      z.object({
        id: z.string(),
        canonicalProductId: z.string(),
        priceCents: z.number().int().positive(),
        learnAlias: z.boolean().optional(),
        note: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const result = await prisma.$transaction(async tx => {
        const draft = await staffDraft(tx, input.id);
        const listing = await publishDraft(tx, draft, input.canonicalProductId, input.priceCents, input.note);
        if (draft.jobId && input.learnAlias) {
          // Only a staff-confirmed correction enters the shared multilingual catalogue.
          await tx.$queryRaw`SELECT "id" FROM "CanonicalProduct" WHERE "id"=${input.canonicalProductId} FOR UPDATE`;
          const alias = draft.suggestedName.trim();
          const existing = await tx.nameAlias.findFirst({ where: { canonicalProductId: input.canonicalProductId, alias: { equals: alias, mode: "insensitive" } } });
          if (!existing && alias) await tx.nameAlias.create({ data: { canonicalProductId: input.canonicalProductId, alias, language: "und", confidence: 1 } });
        }
        if (draft.jobId) await releaseReviewedFrames(tx, draft.jobId);
        return listing;
      });
      await cleanShelfUploads().catch(() => console.warn("Shelf cleanup will retry."));
      return result;
    }),

  requestShelfPhoto: staffProcedure("catalogue:write").input(idInput).mutation(({ input }) =>
    prisma.$transaction(async tx => {
      const draft = await staffDraft(tx, input.id);
      if (!draft.jobId) throw new TRPCError({ code: "BAD_REQUEST", message: "This item has no shelf capture." });
      if (draft.photoRequestId) return { requested: true };
      const names = [...new Set(draft.frameNames)];
      const available = await tx.shelfFrame.count({ where: { ...availableFrame(), name: { in: names } } });
      if (available === names.length) return { requested: false };
      await tx.catalogueDraft.update({ where: { id: draft.id }, data: { photoRequestId: randomBytes(16).toString("hex") } });
      await tx.sellerMessage.create({ data: { storeId: draft.storeId, kind: "notice", orderRefs: [],
        body: "Please upload a fresh shelf photo for " + draft.suggestedName + " in your catalogue review." } });
      return { requested: true };
    })),

  rejectDraft: staffProcedure("catalogue:write")
    .input(z.object({ id: z.string(), note: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const result = await prisma.$transaction(async tx => {
        const draft = await staffDraft(tx, input.id);
        const rejected = await tx.catalogueDraft.update({ where: { id: draft.id },
          data: { status: "rejected", reviewNote: input.note, reviewedAt: new Date() } });
        if (draft.jobId) await releaseReviewedFrames(tx, draft.jobId);
        return rejected;
      });
      await cleanShelfUploads().catch(() => console.warn("Shelf cleanup will retry."));
      return result;
    }),

  /* ---------------------------------------------------------------- ADM-2 */

  /** Store onboarding: where every seller is, and what is blocking them. */
  stores: staffProcedure("stores:read").query(async () => {
    const stores = await prisma.store.findMany({
      include: {
        hubMetro: true,
        onboardingKits: { orderBy: { issuedAt: "desc" } },
        kitchenLicence: { select: { status: true, licenceExpiresOn: true } },
        categoryControls: { where: { disabled: true }, select: { category: true } },
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
      /** The number the shop signs in with, shown as its last four digits only. */
      ownerPhoneLast4: s.ownerPhone ? s.ownerPhone.slice(-4) : null,
      ownerPhoneVerifiedAt: s.ownerPhoneVerifiedAt,
      onboardingRail: s.onboardingRail,
      onboardingWebsite: s.onboardingWebsite,
      onboardingProfileAt: s.onboardingProfileAt,
      foodSafetyAttestedAt: s.foodSafetyAttestedAt,
      onboardingKits: s.onboardingKits,
      listingCount: s._count.listings,
      pendingDrafts: s._count.catalogueDrafts,
      /** QC-1 â€” null for a seller who has never applied. */
      kitchenLicence: licenceState(s.kitchenLicence),
      /** QC-1 â€” controlled categories switched off for this seller. */
      disabledCategories: s.categoryControls.map((c) => c.category),
      /** SEL-2 â€” a store cannot be routed orders until this is true. */
      canReceiveOrders: s.verificationStatus === "verified" && s.onboardingStatus === "live",
    }));
  }),

  hubs: staffProcedure("stores:read").query(() =>
    prisma.hubMetro.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, state: true } }),
  ),

  createStore: staffProcedure("stores:write").input(z.object({
    name: z.string().trim().min(2).max(120), ownerName: z.string().trim().min(2).max(120),
    sellerType: z.enum(["store", "home_seller", "aspiring_entrepreneur"]),
    hubMetroId: z.string(), phone: z.string().max(40),
  })).mutation(async ({ input, ctx }) => {
    const phone = normalisePhone(input.phone);
    if (!phone) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter the owner's mobile number with its area code." });
    return prisma.$transaction(async (tx) => {
      if (!await tx.hubMetro.findFirst({ where: { id: input.hubMetroId, active: true } })) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose an active supply hub." });
      if (await tx.store.findUnique({ where: { ownerPhone: phone } })) throw new TRPCError({ code: "CONFLICT", message: "Another store already signs in with that number." });
      const store = await tx.store.create({ data: { name: input.name, ownerName: input.ownerName, sellerType: input.sellerType,
        hubMetroId: input.hubMetroId, ownerPhone: phone, onboardingStartedAt: new Date() } });
      await writeAudit(tx, ctx.staff, { action: "store.create", subjectType: "store", subjectId: store.id,
        after: { name: store.name, sellerType: store.sellerType, hubMetroId: store.hubMetroId, ownerPhoneLast4: phone.slice(-4) } });
      return { id: store.id };
    });
  }),

  issueOnboardingInvite: staffProcedure("stores:write").input(idInput).mutation(async ({ input, ctx }) => {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 7 * 86_400_000);
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Store" WHERE "id" = ${input.id} FOR UPDATE`;
      const store = await tx.store.findUnique({ where: { id: input.id } });
      if (!store?.ownerPhone) throw new TRPCError({ code: "BAD_REQUEST", message: "Set the owner's phone number first." });
      await tx.onboardingInvite.updateMany({ where: { storeId: input.id, consumedAt: null }, data: { consumedAt: new Date() } });
      await tx.onboardingInvite.create({ data: { storeId: input.id, tokenHash: createHash("sha256").update(token).digest("hex"), createdById: ctx.staff.staffUserId, expiresAt } });
      await writeAudit(tx, ctx.staff, { action: "store.invite", subjectType: "store", subjectId: input.id, after: { expiresAt } });
    });
    return { path: `/onboarding#invite=${token}`, expiresAt };
  }),

  recordOnboardingKit: staffProcedure("stores:write").input(z.object({
    id: z.string(), packaging: z.string().trim().min(1).max(500),
    labelPrinterSerial: z.string().trim().min(1).max(120), issuedAt: z.coerce.date().max(new Date("2100-01-01")),
  })).mutation(async ({ input, ctx }) => {
    if (input.issuedAt > new Date()) throw new TRPCError({ code: "BAD_REQUEST", message: "The issue date cannot be in the future." });
    return prisma.$transaction(async (tx) => {
      const store = await tx.store.findUnique({ where: { id: input.id } });
      if (!store) throw new TRPCError({ code: "NOT_FOUND", message: "No such store." });
      const kit = await tx.onboardingKit.create({ data: { storeId: input.id, packaging: input.packaging,
        labelPrinterSerial: input.labelPrinterSerial, issuedAt: input.issuedAt, recordedById: ctx.staff.staffUserId } });
      await writeAudit(tx, ctx.staff, { action: "store.kit_issued", subjectType: "store", subjectId: input.id,
        after: { kitId: kit.id, packaging: kit.packaging, labelPrinterSerial: kit.labelPrinterSerial, issuedAt: kit.issuedAt } });
      return { id: kit.id };
    });
  }),

  /**
   * Set the mobile number a shop signs in to the merchant app with. This is how
   * an owner gets in, so it is not a routine edit: whoever can receive a text at
   * that number can reach the shop's orders and payouts. It needs the
   * permission to write stores, a reason, and it is audited. Changing it ends
   * every session the shop already has, so the previous holder of the old
   * number (or of a stolen session) is signed out at once.
   */
  setStoreOwnerPhone: staffProcedure("stores:write")
    .input(z.object({ id: z.string(), phone: z.string(), reason: z.string().trim().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const phone = normalisePhone(input.phone);
      if (!phone) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter the owner's mobile number with its area code." });
      const before = await prisma.store.findUnique({ where: { id: input.id }, select: { ownerPhone: true } });
      if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "No such store." });
      const taken = await prisma.store.findUnique({ where: { ownerPhone: phone }, select: { id: true } });
      if (taken && taken.id !== input.id) {
        throw new TRPCError({ code: "CONFLICT", message: "Another store already signs in with that number." });
      }
      return prisma.$transaction(async (tx) => {
        await tx.store.update({ where: { id: input.id }, data: { ownerPhone: phone, ownerPhoneVerifiedAt: null, ownerPhoneVersion: { increment: 1 } } });
        await tx.onboardingInvite.updateMany({ where: { storeId: input.id, consumedAt: null }, data: { consumedAt: new Date() } });
        const ended = await tx.userSession.updateMany({ where: { storeId: input.id, revokedAt: null }, data: { revokedAt: new Date() } });
        await writeAudit(tx, ctx.staff, {
          action: "store.owner_phone_change",
          subjectType: "store",
          subjectId: input.id,
          before: { ownerPhone: before.ownerPhone },
          after: { ownerPhone: phone, sessionsEnded: ended.count },
          note: input.reason,
        });
        return { ownerPhoneLast4: phone.slice(-4), sessionsEnded: ended.count };
      });
    }),

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
        // Lock the store before checking activation, serializing against owner
        // edits and phone reassignment. Approval applies to the details reviewed.
        await tx.$queryRaw`SELECT "id" FROM "Store" WHERE "id" = ${id} FOR UPDATE`;
        const current = await tx.store.findUniqueOrThrow({ where: { id }, include: { _count: { select: { listings: true, onboardingKits: true } } } });
        if (patch.hubMetroId && !await tx.hubMetro.findFirst({ where: { id: patch.hubMetroId, active: true } })) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose an active supply hub." });
        const verifies = patch.verificationStatus === "verified";
        const activates = patch.onboardingStatus === "live";
        if (activates && !await tx.hubMetro.findFirst({ where: { id: patch.hubMetroId ?? current.hubMetroId, active: true } })) throw new TRPCError({ code: "BAD_REQUEST", message: "Assign an active supply hub before making the store live." });
        if ((verifies || activates) && (!current.ownerPhoneVerifiedAt || !current.onboardingProfileAt || !current.foodSafetyAttestedAt)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "The owner must verify their phone, complete their details and attest to food safety before approval." });
        }
        if (activates && ((patch.verificationStatus ?? current.verificationStatus) !== "verified" || !current._count.listings || !current._count.onboardingKits)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Verify the seller, approve their catalogue and record their kit before making the store live." });
        }
        if (patch.onboardingStatus === "kit_issued" && !current._count.onboardingKits) throw new TRPCError({ code: "BAD_REQUEST", message: "Record the issued kit first." });
        if (["filming", "reviewing"].includes(patch.onboardingStatus ?? "") && (!current.ownerPhoneVerifiedAt || !current.onboardingProfileAt || !current.onboardingRail)) throw new TRPCError({ code: "BAD_REQUEST", message: "The owner must complete their details and choose a catalogue setup method first." });
        const after = await tx.store.update({
          where: { id },
          data: {
            ...patch,
            // SEL-2 â€” stamp the moment verification was granted, for the record.
            ...(patch.verificationStatus === "verified" ? { verifiedAt: new Date() } : {}),
          },
        });

        // Record routine onboarding changes as well as changes in standing.
        const action = auditActionForStoreChange(current, after) ?? "store.onboarding_change";
        if (action) {
          await writeAudit(tx, ctx.staff, {
            action,
            subjectType: "store",
            subjectId: id,
            before: { onboardingStatus: current.onboardingStatus, verificationStatus: current.verificationStatus },
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
      declineReason: s.declineReason,
      temperatureClass: s.temperatureClass,
      carrier: s.carrier,
      trackingNumber: s.trackingNumber,
      estimatedDelivery: s.estimatedDelivery,
      createdAt: s.createdAt,
      itemCount: s.items.reduce((n, i) => n + i.quantity, 0),
      valueCents: s.items.reduce((n, i) => n + i.lineTotalCents, 0),
      /** Not accepted or not moved inside the window â€” needs a human. */
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
        return prisma.$transaction(async (tx) => {
          const order = await tx.order.update({ where: { id: shipment.orderId }, data: { status: "cancelled" } });
          await releaseReservations(tx, { orderId: order.id, status: { in: ["pending", "label_created", "declined"] } });
          await tx.shipmentPickup.updateMany({ where: { shipment: { orderId: order.id } }, data: { state: "cancelled" } });
          return order;
        });
      }
      const status =
        input.action === "mark_shipped" ? "picked_up" : input.action === "mark_delivered" ? "delivered" : "exception";
      return prisma.$transaction(async (tx) => {
        const [order] = await tx.$queryRaw<{ status: string }[]>`
          SELECT o."status" FROM "Order" o JOIN "Shipment" s ON s."orderId" = o."id"
          WHERE s."id" = ${input.shipmentId} FOR SHARE OF o`;
        if (order?.status === "cancelled") throw new TRPCError({ code: "CONFLICT", message: "This order has been cancelled." });
        const where = { id: input.shipmentId };
        await tx.shipment.updateMany({ where: { ...where, status: { not: "declined" } }, data: { status } });
        const shipment = await tx.shipment.findUnique({ where });
        if (!shipment) throw new TRPCError({ code: "NOT_FOUND", message: "No such shipment." });
        if (shipment.status === "declined") throw new TRPCError({ code: "CONFLICT", message: "The seller declined this parcel before packing." });
        return shipment;
      });
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
      controlledCategory: p.controlledCategory,
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
        /** QC-1 â€” set for meat, poultry, fish and dairy, including dried and smoked. */
        controlledCategory: controlledCategoryInput.nullish(),
        shippingWeightOz: z.number().positive(),
        lengthIn: z.number().positive(),
        widthIn: z.number().positive(),
        heightIn: z.number().positive(),
      }),
    )
    .mutation(({ input }) => prisma.canonicalProduct.create({ data: { ...input, images: [] } })),

  /**
   * QC-1 â€” reclassify a product as meat, poultry, fish or dairy (or none).
   * Audited because it moves listings in and out of the category controls: a
   * product reclassified into a switched-off category disappears for the
   * sellers it applies to.
   */
  setControlledCategory: staffProcedure("graph:write")
    .input(
      z.object({
        productId: z.string(),
        controlledCategory: controlledCategoryInput.nullable(),
        reason: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const before = await prisma.canonicalProduct.findUnique({ where: { id: input.productId } });
      if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "No such product." });
      return prisma.$transaction(async (tx) => {
        const after = await tx.canonicalProduct.update({
          where: { id: input.productId },
          data: { controlledCategory: input.controlledCategory },
        });
        await writeAudit(tx, ctx.staff, {
          action: "product.reclassify",
          subjectType: "product",
          subjectId: input.productId,
          before: { controlledCategory: before.controlledCategory },
          after: { controlledCategory: after.controlledCategory },
          note: input.reason,
        });
        return after;
      });
    }),

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
    const [orders, payouts, adjustments, charges, records, parcels] = await prisma.$transaction([
      prisma.order.findMany({ select: { totalCents: true, shippingCents: true, taxCents: true, status: true } }),
      prisma.payout.findMany({ include: { store: { select: { name: true } } } }),
      prisma.carrierAdjustment.findMany({ include: { store: { select: { name: true } } } }),
      prisma.payment.aggregate({
        where: { status: { in: ["succeeded", "partially_refunded", "refunded"] } },
        _sum: { buyerChargeCents: true },
      }),
      sellerPayoutRecords(prisma),
      unpaidPayoutParcels(prisma),
    ], { isolationLevel: "RepeatableRead" });

    const buyerChargedCents = charges._sum.buyerChargeCents ?? 0;
    const taxCollectedCents = orders.reduce((n, o) => n + o.taxCents, 0);
    const shippingCollectedCents = orders.reduce((n, o) => n + o.shippingCents, 0);
    const sellerGrossCents = payouts.reduce((n, p) => n + p.grossCents, 0);
    const sellerNetCents = payouts.reduce((n, p) => n + p.netCents, 0);
    const sellerPaidCents = payouts.reduce((n, p) => n + (p.paidAt ? p.netCents : 0), 0);
    const commissionCents = payouts.reduce((n, p) => n + Math.round((p.grossCents * p.takeRateBps) / 10000), 0);
    const fulfilmentFeeCents = payouts.reduce((n, p) => n + p.fulfilmentFeeCents, 0);
    const adjustmentsCents = adjustments.reduce((n, a) => n + a.amountCents, 0);
    const deductedCents = payouts.reduce((n, p) => n + p.adjustmentsCents, 0);

    // PAY-8 â€” what is owed but not yet releasable, and why.
    const history = new Map(records.map((record) => [record.storeId, record]));
    const byPayout = new Map<string, typeof parcels>();
    for (const parcel of parcels) {
      const group = byPayout.get(parcel.payoutId);
      if (group) group.push(parcel);
      else byPayout.set(parcel.payoutId, [parcel]);
    }
    const now = new Date();
    const payoutRows = payouts.map((p) => ({
      id: p.id,
      storeName: p.store.name,
      grossCents: p.grossCents,
      netCents: p.netCents,
      status: p.status,
      heldUntil: p.heldUntil,
      holdReason: p.holdReason,
      availability: payoutAvailability(p.paidAt, history.get(p.storeId), byPayout.get(p.id) ?? [], now),
    }));
    const heldPayouts = payoutRows.filter((p) => p.availability.blocked);

    return {
      orderCount: orders.length,
      buyerChargedCents,
      taxCollectedCents,
      shippingCollectedCents,
      sellerGrossCents,
      sellerNetCents,
      sellerPaidCents,
      sellerUnpaidCents: sellerNetCents - sellerPaidCents,
      commissionCents,
      fulfilmentFeeCents,
      adjustmentsCents,
      /** PAY-3 â€” commission plus the order fee. Never includes shipping. */
      platformRevenueCents: commissionCents + fulfilmentFeeCents,
      heldCents: heldPayouts.reduce((n, p) => n + p.netCents, 0),
      heldCount: heldPayouts.length,
      /**
       * Seller gross and the platform's cut must together equal the item value
       * sellers sold. A non-zero figure here means a payout and its order have
       * drifted apart, which is the one thing this screen must never hide.
       */
      reconciliationDriftCents: sellerGrossCents - (sellerNetCents + commissionCents + fulfilmentFeeCents + deductedCents),
      adjustments: adjustments.map((a) => ({
        id: a.id,
        carrierReference: a.carrierReference,
        storeName: a.store.name,
        amountCents: a.amountCents,
        reason: a.reason,
        declaredWeightOz: a.declaredWeightOz,
        actualWeightOz: a.actualWeightOz,
        settled: Boolean(a.settledPayoutId),
        appliedCents: a.appliedCents,
        remainingCents: a.amountCents - a.appliedCents,
      })),
      payouts: payoutRows,
    };
  }),

  /** PAY-8 â€” what hold a seller would get today, for the console to explain. */
  payoutHoldFor: staffProcedure("finance:read").input(idInput).query(async ({ input }) =>
    computeHold(await sellerPayoutRecord(prisma, input.id), new Date())),

  /* ------------------------------------------- ADM-5 money, all audited */

  /**
   * PAY-8 â€” put a payout on hold, or release one. Finance only: `operations`
   * can read the reconciliation screen to chase a problem but cannot move the
   * money, which is the separation the roles exist for.
   */
  holdPayout: staffProcedure("finance:write")
    .input(z.object({ payoutId: z.string(), until: z.coerce.date(), reason: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      return prisma.$transaction(async (tx) => {
        const before = await lockUnpaidPayout(tx, input.payoutId);
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
      return prisma.$transaction(async (tx) => {
        const before = await lockUnpaidPayout(tx, input.payoutId);
        const parcels = await unpaidPayoutParcels(tx, input.payoutId);
        const availability = payoutAvailability(before.paidAt, await sellerPayoutRecord(tx, before.storeId), parcels, new Date());
        if (availability.blocked) {
          const message = availability.eligibleAt ? `This payout is held until ${availability.eligibleAt.toISOString()}.` : availability.label;
          throw new TRPCError({ code: "BAD_REQUEST", message });
        }
        const settlement = await deductCarrierAdjustments(tx, before.storeId, input.payoutId, before.netCents);
        const after = await tx.payout.update({
          where: { id: input.payoutId },
          data: {
            heldUntil: null, holdReason: null, status: "released", paidAt: new Date(),
            netCents: settlement.payableCents, adjustmentsCents: { increment: settlement.deductedCents },
          },
        });
        // The seller learns of it in their AfriMart thread, in the same
        // transaction: a payout cannot be marked paid without the note.
        await postPayoutMessage(tx, after, after.paidAt!);
        await writeAudit(tx, ctx.staff, {
          action: "payout.release",
          subjectType: "payout",
          subjectId: input.payoutId,
          before: { status: before.status, heldUntil: before.heldUntil, paidAt: before.paidAt, netCents: before.netCents },
          after: { status: after.status, heldUntil: null, paidAt: after.paidAt, netCents: after.netCents, deductions: settlement.deductions },
          note: input.note,
        });
        return after;
      });
    }),

  /**
   * PAY-9 â€” record a carrier billing correction against the seller that
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
        if (input.shipmentId !== undefined) {
          const shipment = await tx.shipment.findFirst({ where: { id: input.shipmentId, storeId: input.storeId }, select: { id: true } });
          if (!shipment) throw new TRPCError({ code: "BAD_REQUEST", message: "That shipment does not belong to this seller." });
        }
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

  /** QC-9 â€” refund claims waiting on a human. */
  refundClaims: staffProcedure("finance:read").query(async () => {
    const claims = await prisma.refundClaim.findMany({
      where: { status: { in: ["manual_review", "auto_approved"] } },
      include: { buyer: { select: { email: true } }, items: { include: { shipmentItem: true } } },
      orderBy: { createdAt: "asc" },
      take: 200,
    });

    // QC-3 â€” a reviewer judging a "missing from the box" report needs the seller's
    // packing photo beside the buyer's, so both come back with the claim.
    const shipments = await prisma.shipment.findMany({
      where: { id: { in: claims.map((c) => c.shipmentId).filter((v): v is string => Boolean(v)) } },
      include: { store: { select: { name: true } } },
    });
    const shipmentById = new Map(shipments.map((s) => [s.id, s]));

    return claims.map((c) => {
      const shipment = c.shipmentId ? shipmentById.get(c.shipmentId) : undefined;
      return {
        id: c.id,
        ref: claimRef(c.id),
        kind: c.kind,
        buyerEmail: c.buyer.email,
        orderId: c.orderId,
        reason: c.reason,
        note: c.note,
        amountCents: c.amountCents,
        /**
         * Whether there are photos, not the photos: they are private, and opening
         * them is its own audited step (`claimPhotoLinks`).
         */
        hasPhoto: c.photoUrl !== null,
        storeName: shipment?.store.name ?? null,
        /** The seller packed it and photographed the open box before sealing (QC-2). */
        hasPackingPhoto: (shipment?.packingPhotoUrl ?? null) !== null,
        packingPhotoAt: shipment?.packingPhotoAt ?? null,
        parcelStatus: shipment?.status ?? null,
        items: c.items.map((i) => ({ name: i.shipmentItem.nameSnapshot, quantity: i.shipmentItem.quantity, lineTotalCents: i.lineTotalCents })),
        status: c.status,
        recoveryTarget: c.recoveryTarget,
        refundedAt: c.refundedAt,
        createdAt: c.createdAt,
      };
    });
  }),

  /**
   * Open the photos on a claim: the buyer's photo of the problem and, beside it,
   * the seller's packing photo. Both are private (the buyer's can show their
   * address), so this is the only way staff get a link, and every photo opened
   * is written to the audit log with who opened it, in the same transaction as
   * the link being issued. A mutation, not a query, because it records something.
   */
  claimPhotoLinks: staffProcedure("finance:read")
    .input(z.object({ claimId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const claim = await prisma.refundClaim.findUnique({ where: { id: input.claimId } });
      if (!claim) throw new TRPCError({ code: "NOT_FOUND", message: "No such report." });
      const shipment = claim.shipmentId ? await prisma.shipment.findUnique({ where: { id: claim.shipmentId } }) : null;

      const viewed: { key: "photo" | "packingPhoto"; path: string; subjectType: "claim" | "shipment"; subjectId: string }[] = [];
      if (claim.photoUrl) viewed.push({ key: "photo", path: claim.photoUrl, subjectType: "claim", subjectId: claim.id });
      if (shipment?.packingPhotoUrl) {
        viewed.push({ key: "packingPhoto", path: shipment.packingPhotoUrl, subjectType: "shipment", subjectId: shipment.id });
      }

      await prisma.$transaction(async (tx) => {
        for (const v of viewed) {
          await writeAudit(tx, ctx.staff, {
            action: "photo.view",
            subjectType: v.subjectType,
            subjectId: v.subjectId,
            after: { photo: v.key, claimId: claim.id },
            note: v.key === "photo" ? "Opened the buyer's photo on a report" : "Opened the seller's packing photo",
          });
        }
      });
      return {
        photo: signedPhotoUrl(viewed.find((v) => v.key === "photo")?.path),
        packingPhoto: signedPhotoUrl(viewed.find((v) => v.key === "packingPhoto")?.path),
      };
    }),

  /**
   * Open the document a seller sent with a licence or badge application. Needs
   * the permission to read stores; the view is audited; the link is signed and
   * short-lived. This is the only way staff see a licence photo.
   */
  evidencePhotoLink: staffProcedure("stores:read")
    .input(z.object({ subject: z.enum(["kitchen_licence", "seller_badge"]), id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const row =
        input.subject === "kitchen_licence"
          ? await prisma.kitchenLicence.findUnique({ where: { id: input.id }, select: { evidence: true, storeId: true } })
          : await prisma.sellerBadge.findUnique({ where: { id: input.id }, select: { evidence: true, storeId: true } });
      if (!row || !isPhotoPath(row.evidence)) throw new TRPCError({ code: "NOT_FOUND", message: "There is no photo on that application." });

      await prisma.$transaction((tx) =>
        writeAudit(tx, ctx.staff, {
          action: "photo.view",
          subjectType: input.subject,
          subjectId: input.id,
          after: { storeId: row.storeId },
          note: input.subject === "kitchen_licence" ? "Opened a kitchen licence photo" : "Opened a badge document",
        }),
      );
      return { url: signedPhotoUrl(row.evidence)! };
    }),

  /**
   * QC-8 â€” resolve a claim and say where the cost lands.
   *
   * For a claim that was auto-approved the buyer was already refunded and this
   * records the recovery, the part that affects a seller's money. For one that
   * went to review, approving it is what refunds the buyer: the refund is issued
   * after the decision is recorded and audited, and approving again retries it
   * if the issuer failed. A claim is "refunded" only once the money has gone.
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
      // Closed once it is declined, or approved and paid. An auto-approved claim is
      // refunded but not yet resolved: approving it records the recovery. One that
      // is approved but not yet refunded may be approved again, which retries the refund.
      if (before.status === "rejected" || (before.status === "approved" && before.refundedAt)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "That claim has already been resolved." });
      }
      if (input.decision === "reject" && before.refundedAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The buyer has already been refunded, so this can't be rejected. Approve it to record where the cost is recovered from.",
        });
      }

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
      }).then(async (after) => {
        if (input.decision !== "approve") return after;
        try {
          const { refundedAt } = await refundClaim(after.id);
          return { ...after, refundedAt };
        } catch (e) {
          // The decision stands, audited. The refund did not go, and nothing
          // may say it did: tell the operator so they can approve again.
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Approved, but the refund could not be issued (${e instanceof Error ? e.message : "unknown error"}). Approve again to retry.`,
          });
        }
      });
    }),

  /** The trail itself. Read-only everywhere â€” nothing edits or deletes it. */
  auditLog: staffProcedure("audit:read")
    .input(
      z
        .object({
          subjectType: z.string().optional(),
          subjectId: z.string().optional(),
          /** Only these actions, e.g. the QC-1 seller-rule changes. */
          actions: z.array(z.string()).optional(),
          limit: z.number().max(500).default(100),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const entries = await prisma.auditLogEntry.findMany({
        where: {
          ...(input?.subjectType ? { subjectType: input.subjectType } : {}),
          ...(input?.subjectId ? { subjectId: input.subjectId } : {}),
          ...(input?.actions?.length ? { action: { in: input.actions } } : {}),
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
        // Arbitrary snapshots. Typed unknown on purpose: Prisma's recursive
        // JsonValue makes tRPC's inferred client type blow the compiler's depth limit.
        before: e.before as unknown,
        after: e.after as unknown,
        note: e.note,
        createdAt: e.createdAt,
      }));
    }),

  /* ------------------------------------------- QC-4 / QC-6 / CAT-8 */

  /** QC-4 â€” every seller's score, with whether it is actionable yet. */
  sellerQuality: staffProcedure("stores:read").query(async () => {
    const stores = await prisma.store.findMany({
      include: {
        enforcements: { orderBy: { createdAt: "desc" }, take: 1 },
        badges: true,
        shipments: { select: { status: true } },
      },
      orderBy: { name: "asc" },
    });

    const claims = await prisma.refundClaim.findMany({
      where: { status: "approved", recoveryTarget: "seller" },
      select: { shipmentId: true },
    });
    const claimedShipments = new Set(claims.map((c) => c.shipmentId).filter(Boolean) as string[]);
    const shipmentOwners = await prisma.shipment.findMany({
      where: { id: { in: [...claimedShipments] } },
      select: { id: true, storeId: true },
    });
    const confirmedByStore = new Map<string, number>();
    for (const s of shipmentOwners) {
      confirmedByStore.set(s.storeId, (confirmedByStore.get(s.storeId) ?? 0) + 1);
    }

    return stores.map((s) => {
      const delivered = s.shipments.filter((sh) => sh.status === "delivered").length;
      const quality = computeScore({
        deliveredOrders: delivered,
        // QC-4 â€” confirmed only. A submitted claim moves nothing until a
        // reviewer upholds it, and carrier-recovered claims never count.
        confirmedSellerClaims: confirmedByStore.get(s.id) ?? 0,
        averageRating: s.qualityScore,
        ratingCount: 0,
        onTimeAcceptanceRate: null,
      });
      const ladder = ladderFor(quality);
      return {
        storeId: s.id,
        storeName: s.name,
        score: quality.score,
        defectRate: quality.defectRate,
        sampleSize: quality.sampleSize,
        enforceable: quality.enforceable,
        currentLevel: s.enforcements[0]?.level ?? null,
        suggestedAction: ladder.action,
        suggestedReason: ladder.reason,
        requiresHumanDecision: ladder.requiresHumanDecision,
        visibilityMultiplier: visibilityMultiplierFor(quality, s.enforcements[0]?.level ?? null),
        badges: s.badges.map((b) => ({ kind: b.kind, status: b.status })),
      };
    });
  }),

  /**
   * QC-6 â€” record an enforcement step.
   *
   * Suspension and delisting are refused here unless a human is driving:
   * they end a seller's income, and the ladder deliberately stops short of
   * taking them automatically. Both are audited alongside the money actions.
   */
  enforce: staffProcedure("stores:write")
    .input(
      z.object({
        storeId: z.string(),
        level: z.enum(["warning", "reduced_visibility", "suspended", "delisted", "cleared"]),
        reason: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const store = await prisma.store.findUnique({ where: { id: input.storeId } });
      if (!store) throw new TRPCError({ code: "NOT_FOUND", message: "No such store." });

      return prisma.$transaction(async (tx) => {
        const record = await tx.sellerEnforcement.create({
          data: {
            storeId: input.storeId,
            level: input.level,
            reason: input.reason,
            // Set precisely because a person took this step. Automatic
            // actions leave it null, which is what makes the two
            // distinguishable in the record rather than merely intended.
            actorEmail: ctx.staff.email,
          },
        });

        // Suspension and delisting also change whether the seller can trade,
        // so they move onboarding state too â€” and are audited as standing
        // changes, like every other suspension.
        if (input.level === "suspended" || input.level === "delisted") {
          const before = { onboardingStatus: store.onboardingStatus };
          const after = await tx.store.update({
            where: { id: input.storeId },
            data: { onboardingStatus: input.level === "suspended" ? "suspended" : "delisted" },
          });
          await writeAudit(tx, ctx.staff, {
            action: input.level === "suspended" ? "store.suspend" : "store.delist",
            subjectType: "store",
            subjectId: input.storeId,
            before,
            after: { onboardingStatus: after.onboardingStatus },
            note: input.reason,
          });
        }
        return record;
      });
    }),

  /** CAT-8 â€” badge applications waiting on a reviewer. */
  badgeApplications: staffProcedure("stores:read")
    .input(z.object({ status: z.enum(["applied", "approved", "rejected", "revoked"]).default("applied") }).optional())
    .query(async ({ input }) => {
    const badges = await prisma.sellerBadge.findMany({
      where: { status: input?.status ?? "applied" },
      include: { store: { select: { name: true, sellerType: true } } },
      orderBy: { createdAt: "asc" },
    });
    return badges.map((b) => ({
      id: b.id,
      storeName: b.store.name,
      sellerType: b.store.sellerType,
      kind: b.kind,
      status: b.status,
      // Text the seller wrote is shown; a photo is not, it is opened (audited) with `evidencePhotoLink`.
      evidence: isPhotoPath(b.evidence) ? null : b.evidence,
      hasEvidencePhoto: isPhotoPath(b.evidence),
      reviewNote: b.reviewNote,
      createdAt: b.createdAt,
    }));
  }),

  /**
   * CAT-8 â€” approve or refuse a badge.
   *
   * A seller applies; a reviewer decides. A badge a seller could switch on
   * themselves would carry no information for the buyer it is meant to
   * reassure, so the grant is the whole control and is audited as a change
   * to the seller's standing.
   */
  reviewBadge: staffProcedure("stores:write")
    .input(
      z.object({
        badgeId: z.string(),
        decision: z.enum(["approve", "reject", "revoke"]),
        note: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const badge = await prisma.sellerBadge.findUnique({ where: { id: input.badgeId } });
      if (!badge) throw new TRPCError({ code: "NOT_FOUND", message: "No such application." });

      const status =
        input.decision === "approve" ? "approved" : input.decision === "reject" ? "rejected" : "revoked";

      return prisma.$transaction(async (tx) => {
        const after = await tx.sellerBadge.update({
          where: { id: input.badgeId },
          data: { status, reviewNote: input.note, reviewedAt: new Date() },
        });
        await writeAudit(tx, ctx.staff, {
          action: "store.verification_change",
          subjectType: "store",
          subjectId: badge.storeId,
          before: { badge: badge.kind, status: badge.status },
          after: { badge: after.kind, status: after.status },
          note: input.note ?? `CAT-8 badge ${input.decision}`,
        });
        return after;
      });
    }),

  /* ------------------------------------------------------------ QC-1 */

  /**
   * QC-1 â€” kitchen licence applications. Defaults to what is waiting on a
   * reviewer; pass a status to see approvals (to revoke one) or refusals.
   */
  kitchenLicences: staffProcedure("stores:read")
    .input(z.object({ status: z.enum(["applied", "approved", "rejected", "revoked"]).default("applied") }).optional())
    .query(async ({ input }) => {
      const rows = await prisma.kitchenLicence.findMany({
        where: { status: input?.status ?? "applied" },
        include: { store: { select: { name: true, sellerType: true } } },
        orderBy: { createdAt: "asc" },
      });
      return rows.map((r) => ({
        id: r.id,
        storeId: r.storeId,
        storeName: r.store.name,
        sellerType: r.store.sellerType,
        status: r.status,
        licenceNumber: r.licenceNumber,
        issuingAuthority: r.issuingAuthority,
        evidence: isPhotoPath(r.evidence) ? null : r.evidence,
        hasEvidencePhoto: isPhotoPath(r.evidence),
        verifiedLicenceNumber: r.verifiedLicenceNumber,
        verifiedIssuingAuthority: r.verifiedIssuingAuthority,
        licenceExpiresOn: r.licenceExpiresOn,
        /** An approval past its expiry date: it no longer counts, though its stored status is still approved. */
        expired: licenceState(r) === "expired",
        reviewNote: r.reviewNote,
        reviewedByEmail: r.reviewedByEmail,
        reviewedAt: r.reviewedAt,
        createdAt: r.createdAt,
      }));
    }),

  /**
   * QC-1 â€” approve, refuse or revoke a licensed-kitchen status. Approval lifts
   * the chilled-and-frozen restriction for that seller, so it is granted only
   * by a reviewer, only after they say they have checked the licence, and is
   * audited in the same transaction. Revoking restores the restriction and
   * hides the seller's chilled and frozen listings again.
   */
  reviewKitchenLicence: staffProcedure("stores:write")
    .input(
      z.object({
        id: z.string(),
        decision: z.enum(["approve", "reject", "revoke"]),
        /** The reviewer's attestation that they have checked the licence itself. */
        licenceChecked: z.boolean().default(false),
        /**
         * What the reviewer read on the licence. Applications can be a photo and
         * nothing else, so an approval is where the facts are recorded, by the
         * person who checked them. Required to approve, and checked below rather
         * than in the schema so the message says which one is missing.
         */
        licenceNumber: z.string().trim().optional(),
        issuingAuthority: z.string().trim().optional(),
        expiresOn: z.coerce.date().optional(),
        note: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const licence = await prisma.kitchenLicence.findUnique({ where: { id: input.id } });
      if (!licence) throw new TRPCError({ code: "NOT_FOUND", message: "No such application." });

      if (input.decision === "approve" && !input.licenceChecked) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Check the licence before approving, then confirm that you have.",
        });
      }
      if (input.decision === "approve") {
        const missing = [
          !input.licenceNumber && "the licence number",
          !input.issuingAuthority && "who issued it",
          !input.expiresOn && "its expiry date",
        ].filter(Boolean);
        if (missing.length) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Record ${missing.join(", ")} from the licence before approving.` });
        }
        // A licence that has already lapsed is not one to approve. Compared by
        // calendar day: it is valid through its expiry date.
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        if (input.expiresOn!.getTime() < today.getTime()) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "That licence has already expired, so it cannot be approved." });
        }
      }
      // Approve and refuse decide an open application; revoke ends an approval.
      const allowedFrom = input.decision === "revoke" ? "approved" : "applied";
      if (licence.status !== allowedFrom) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `That application is ${licence.status}, so it cannot be ${
            { approve: "approved", reject: "refused", revoke: "revoked" }[input.decision]
          }.`,
        });
      }

      const status = input.decision === "approve" ? "approved" : input.decision === "reject" ? "rejected" : "revoked";
      const approving = input.decision === "approve";
      return prisma.$transaction(async (tx) => {
        const after = await tx.kitchenLicence.update({
          where: { id: input.id },
          data: {
            status,
            reviewNote: input.note,
            reviewedAt: new Date(),
            reviewedByEmail: ctx.staff.email,
            // Only an approval records what was checked. A refusal or a revocation
            // leaves the earlier record as it was, so what was approved stays known.
            ...(approving
              ? {
                  verifiedLicenceNumber: input.licenceNumber,
                  verifiedIssuingAuthority: input.issuingAuthority,
                  licenceExpiresOn: input.expiresOn,
                }
              : {}),
          },
        });
        await writeAudit(tx, ctx.staff, {
          action: "store.kitchen_licence_change",
          subjectType: "store",
          subjectId: licence.storeId,
          before: {
            kitchenLicence: licence.status,
            licenceNumber: licence.verifiedLicenceNumber,
            issuingAuthority: licence.verifiedIssuingAuthority,
            expiresOn: licence.licenceExpiresOn,
          },
          after: {
            kitchenLicence: after.status,
            licenceNumber: after.verifiedLicenceNumber,
            issuingAuthority: after.verifiedIssuingAuthority,
            expiresOn: after.licenceExpiresOn,
          },
          note: input.note,
        });
        return after;
      });
    }),

  /** QC-1 â€” the current state of every category switch, platform-wide and per seller. */
  categoryControls: staffProcedure("stores:read").query(async () => {
    const [platform, sellers] = await Promise.all([
      prisma.platformCategoryControl.findMany(),
      prisma.sellerCategoryControl.findMany({
        where: { disabled: true },
        include: { store: { select: { name: true, sellerType: true } } },
        orderBy: { updatedAt: "desc" },
      }),
    ]);
    const platformByCategory = new Map(platform.map((p) => [p.category, p]));
    return {
      platform: (["meat", "poultry", "fish", "dairy"] as const).map((category) => {
        const row = platformByCategory.get(category);
        return {
          category,
          label: CONTROLLED_CATEGORY_LABEL[category],
          disabled: row?.disabled ?? false,
          reason: row?.disabled ? row.reason : null,
          changedBy: row?.actorEmail ?? null,
          changedAt: row?.updatedAt ?? null,
        };
      }),
      sellers: sellers.map((r) => ({
        storeId: r.storeId,
        storeName: r.store.name,
        category: r.category,
        reason: r.reason,
        changedBy: r.actorEmail,
        changedAt: r.updatedAt,
      })),
    };
  }),

  /**
   * QC-1 â€” switch one controlled category off (or back on) for one home-based
   * or aspiring seller. Their existing listings in it are hidden and new ones
   * refused, with a plain message to the seller. Refused outright for a store:
   * stores are outside these rules, and a switch that silently did nothing
   * would let ops believe it had acted.
   */
  setSellerCategory: staffProcedure("stores:write")
    .input(
      z.object({
        storeId: z.string(),
        category: controlledCategoryInput,
        disabled: z.boolean(),
        reason: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const store = await prisma.store.findUnique({ where: { id: input.storeId } });
      if (!store) throw new TRPCError({ code: "NOT_FOUND", message: "No such store." });
      if (!isHomeTier(store.sellerType)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Category controls apply to home-based and aspiring sellers only. Stores are not affected by them.",
        });
      }

      return prisma.$transaction(async (tx) => {
        const key = { storeId_category: { storeId: input.storeId, category: input.category } };
        const before = await tx.sellerCategoryControl.findUnique({ where: key });
        const after = await tx.sellerCategoryControl.upsert({
          where: key,
          create: {
            storeId: input.storeId,
            category: input.category,
            disabled: input.disabled,
            reason: input.reason,
            actorEmail: ctx.staff.email,
          },
          update: { disabled: input.disabled, reason: input.reason, actorEmail: ctx.staff.email },
        });
        await writeAudit(tx, ctx.staff, {
          action: "store.category_restriction_change",
          subjectType: "store",
          subjectId: input.storeId,
          before: { category: input.category, disabled: before?.disabled ?? false },
          after: { category: input.category, disabled: after.disabled },
          note: input.reason,
        });
        return after;
      });
    }),

  /**
   * QC-1 â€” switch one controlled category off (or back on) for every
   * home-based and aspiring seller at once. A setting, not a deploy, so it can
   * move the day legal advice changes. Hidden listings return the moment it is
   * switched back on; nothing is deleted. Admin only (`settings:write`): it
   * reaches every seller in the tier at once. Per-seller switches stay with
   * operations.
   */
  setPlatformCategory: staffProcedure("settings:write")
    .input(z.object({ category: controlledCategoryInput, disabled: z.boolean(), reason: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      return prisma.$transaction(async (tx) => {
        const before = await tx.platformCategoryControl.findUnique({ where: { category: input.category } });
        const after = await tx.platformCategoryControl.upsert({
          where: { category: input.category },
          create: {
            category: input.category,
            disabled: input.disabled,
            reason: input.reason,
            actorEmail: ctx.staff.email,
          },
          update: { disabled: input.disabled, reason: input.reason, actorEmail: ctx.staff.email },
        });
        await writeAudit(tx, ctx.staff, {
          action: "platform.category_restriction_change",
          subjectType: "platform_setting",
          subjectId: `category:${input.category}`,
          before: { disabled: before?.disabled ?? false },
          after: { disabled: after.disabled },
          note: input.reason,
        });
        return after;
      });
    }),
});
