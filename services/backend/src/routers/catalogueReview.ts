import { TRPCError } from "@trpc/server";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db.js";
import { merchantProcedure, router } from "../trpc.js";
import { CATALOGUE_AUTO_APPROVE_CONFIDENCE } from "../config.js";
import { publishDraft, releaseReviewedFrames } from "../catalogue/publication.js";
import { checkListingForStore } from "../quality/categoryAccess.js";
import { permitStatement, requiresManualReview } from "../quality/listingStandards.js";
import { randomBytes } from "node:crypto";
import { cleanShelfUploads, reviewPhotos, availableFrame } from "../catalogue/photoRetention.js";
import { photoStore } from "../storage/store.js";
import { decodeUpload } from "../storage/photos.js";

const selection = { id: true, canonicalName: true, packSize: true, category: true, controlledCategory: true, temperatureClass: true } as const;
const eligible: Prisma.StoreWhereInput = { ownerPhoneVerifiedAt: { not: null }, onboardingRail: "film",
  onboardingStatus: { notIn: ["suspended","delisted"] } };
const revision = z.number().int().nonnegative();
const bad = (message: string) => new TRPCError({ code: "BAD_REQUEST", message });
async function lockedJob(tx: Prisma.TransactionClient, storeId: string, version: number, allowSubmitted = false) {
  await tx.$queryRaw`SELECT "id" FROM "Store" WHERE "id"=${storeId} FOR UPDATE`;
  const job = await tx.extractionJob.findFirst({ where: { session: { storeId, store: eligible } } });
  if (!job) throw bad("Open a completed shelf capture first.");
  if (allowSubmitted && job.submittedAt) return job;
  if (job.state !== "ready" || job.submittedAt || job.revision !== version)
    throw new TRPCError({ code: "CONFLICT", message: "Your catalogue has changed. Reload the review before saving." });
  return job;
}

export const catalogueReviewRouter = router({
  state: merchantProcedure.query(async ({ ctx }) => {
    const job = await prisma.extractionJob.findFirst({ where: { session: { storeId: ctx.storeId, store: eligible } },
      include: { drafts: { orderBy: [{ confidence: "asc" }, { id: "asc" }] } } });
    if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "Finish filming your shelves first." });
    const ids = [...new Set(job.drafts.flatMap(d => [...d.candidateIds, ...(d.matchedProductId ? [d.matchedProductId] : [])]))];
    const products = await prisma.canonicalProduct.findMany({ where: { id: { in: ids } }, select: selection });
    const byId = new Map(products.map(p => [p.id,p]));
    const photos = await reviewPhotos(job.drafts);
    const items = job.drafts.filter(d => d.decision !== "removed").map(d => ({
      id: d.id, name: d.suggestedName, rawText: d.rawText, brand: d.brand, packSize: d.packSize, priceCents: d.suggestedPriceCents,
      needsCheck: d.confidence < CATALOGUE_AUTO_APPROVE_CONFIDENCE, selected: d.matchedProductId, decision: d.decision,
      status: d.status, note: d.reviewNote,
      preview: !job.submittedAt ? photos(d.frameNames).shelfPhoto : null,
      photoRequestId: d.status === "pending_review" ? d.photoRequestId : null,
      candidates: [...new Set([...d.candidateIds, ...(d.matchedProductId ? [d.matchedProductId] : [])])].flatMap(id => byId.get(id) ?? []),
    }));
    const captureExpired = ["failed", "queued"].includes(job.state) && !await prisma.shelfFrame.count({ where: { ...availableFrame(), sessionId: job.sessionId } });
    return { captureExpired, state: job.state, revision: job.revision, submitted: !!job.submittedAt, message: job.message, items,
      paused: process.env.SHELF_EXTRACTION_ENABLED !== "yes" && job.state === "queued" };
  }),

  supplyPhoto: merchantProcedure.input(z.object({ id: z.string(), requestId: z.string().length(32), image: z.string().min(1).max(10_000_000) }))
    .mutation(async ({ ctx, input }) => {
      const where = { id: input.id, storeId: ctx.storeId, store: eligible, decision: "staff", status: "pending_review" as const,
        photoRequestId: input.requestId, job: { submittedAt: { not: null } } };
      const pending = await prisma.catalogueDraft.findFirst({ where, select: { jobId: true } });
      if (!pending?.jobId) throw bad("This photo request is no longer open.");
      const bytes = decodeUpload(input.image);
      const name = randomBytes(16).toString("hex") + ".jpg";
      await prisma.shelfFrame.create({ data: { name, shelf: 0, position: 0, passId: input.requestId,
        deleteAfter: new Date(Date.now() + 3_600_000) } });
      try {
        await photoStore.put("shelf", bytes, name);
        await prisma.$transaction(async tx => {
          await tx.$queryRaw`SELECT "id" FROM "Store" WHERE "id"=${ctx.storeId} FOR UPDATE`;
          const draft = await tx.catalogueDraft.findFirst({ where });
          if (!draft?.jobId) throw bad("This photo request is no longer open.");
          const sessionId = draft.jobId;
          const last = await tx.shelfFrame.aggregate({ where: { sessionId, shelf: 0 }, _max: { position: true } });
          const attached = await tx.shelfFrame.updateMany({ where: { name, sessionId: null, deleteAfter: { gt: new Date() } },
            data: { sessionId, position: (last._max.position ?? -1) + 1, deleteAfter: null } });
          if (!attached.count) throw bad("The upload timed out. Please send the photo again.");
          const previous = await tx.shelfFrame.findMany({ where: { ...availableFrame(), sessionId, name: { in: draft.frameNames } }, select: { name: true } });
          await tx.catalogueDraft.update({ where: { id: draft.id }, data: { frameNames: [name, ...previous.map(f => f.name)], photoRequestId: null } });
        });
      } finally {
        await prisma.shelfFrame.updateMany({ where: { name, sessionId: null }, data: { deleteAfter: new Date() } });
        await cleanShelfUploads().catch(() => console.warn("Shelf cleanup will retry."));
      }
      return { saved: true };
    }),

  search: merchantProcedure.input(z.object({ text: z.string().trim().min(2).max(120) })).query(({ input }) =>
    prisma.canonicalProduct.findMany({ where: { OR: [{ canonicalName: { contains: input.text, mode: "insensitive" } },
      { aliases: { some: { alias: { contains: input.text, mode: "insensitive" } } } }] }, select: selection, orderBy: { canonicalName: "asc" }, take: 20 })),

  standards: merchantProcedure.input(z.object({ productId: z.string() })).query(async ({ ctx, input }) => {
    const p = await prisma.canonicalProduct.findUniqueOrThrow({ where: { id: input.productId }, select: selection });
    const check = await checkListingForStore(prisma, ctx.storeId, p);
    return { violations: check.violations, manual: requiresManualReview(p.category), permit: p.controlledCategory &&
      check.violations.some(v => v.code === "permit_confirmation_required") ? { category: p.controlledCategory, statement: permitStatement(p.controlledCategory) } : null };
  }),

  retry: merchantProcedure.mutation(async ({ ctx }) => {
    const updated = await prisma.extractionJob.updateMany({ where: { state: "failed", session: { storeId: ctx.storeId, store: eligible } },
      data: { state: "queued", message: null } });
    return { queued: !!updated.count };
  }),

  edit: merchantProcedure.input(z.object({ id: z.string(), revision, name: z.string().trim().min(1).max(300),
    priceCents: z.number().int().positive().max(10_000_000).nullable(), productId: z.string().nullable(),
    action: z.enum(["confirm","staff","remove","merge"]), target: z.string().optional() })).mutation(async ({ ctx, input }) => {
    const result = await prisma.$transaction(async tx => {
      const job = await lockedJob(tx, ctx.storeId, input.revision);
      const where = { jobId: job.sessionId, storeId: ctx.storeId, status: "pending_review" as const };
      const draft = await tx.catalogueDraft.findFirst({ where: { ...where, id: input.id } });
      if (!draft) throw bad("This item is no longer available.");
      if (input.action === "remove" || input.action === "merge") {
        if (input.action === "merge") {
          if (!input.target || input.target === draft.id) throw bad("Choose another item to merge into.");
          const target = await tx.catalogueDraft.findFirst({ where: { ...where, id: input.target } });
          if (!target) throw bad("Choose an available item.");
          await tx.catalogueDraft.update({ where: { id: target.id }, data: { decision: "open",
            frameNames: [...new Set([...target.frameNames, ...draft.frameNames])] } });
        }
        await tx.catalogueDraft.update({ where: { id: draft.id }, data: { decision: "removed", status: "rejected" } });
      } else {
        const product = input.productId ? await tx.canonicalProduct.findUnique({ where: { id: input.productId }, select: selection }) : null;
        if (input.action === "confirm") {
          if (!product || !input.priceCents) throw bad("Choose the product and enter its shelf price.");
          const check = await checkListingForStore(tx, ctx.storeId, product);
          if (!check.ok) throw bad(check.violations.map(v => v.message).join(" "));
          if (requiresManualReview(product.category)) throw bad("Send this restricted item to staff for review.");
        }
        await tx.catalogueDraft.update({ where: { id: draft.id }, data: { suggestedName: input.name, suggestedPriceCents: input.priceCents,
          matchedProductId: product?.id ?? null, decision: input.action, temperatureClass: product?.temperatureClass ?? draft.temperatureClass } });
      }
      await tx.extractionJob.update({ where: { sessionId: job.sessionId }, data: { revision: { increment: 1 } } });
      if (input.action === "remove" || input.action === "merge") await releaseReviewedFrames(tx, job.sessionId);
      return { saved: true };
    });
    if (input.action === "remove" || input.action === "merge") await cleanShelfUploads().catch(() => console.warn("Shelf cleanup will retry."));
    return result;
  }),

  publish: merchantProcedure.input(z.object({ revision })).mutation(async ({ ctx, input }) => {
    const result = await prisma.$transaction(async tx => {
      const job = await lockedJob(tx, ctx.storeId, input.revision, true);
      if (job.submittedAt) return { submitted: true };
      const drafts = await tx.catalogueDraft.findMany({ where: { jobId: job.sessionId, status: "pending_review" } });
      if (!drafts.length) throw bad("Film a shelf with at least one product before submitting.");
      if (drafts.some(d => !["confirm","staff"].includes(d.decision))) throw bad("Review every item before submitting.");
      for (const d of drafts) {
        if (d.decision === "staff") continue;
        if (!d.matchedProductId || !d.suggestedPriceCents) throw bad("Confirm a match and price for " + d.suggestedName + ".");
        const p = await tx.canonicalProduct.findUniqueOrThrow({ where: { id: d.matchedProductId }, select: { category: true } });
        if (requiresManualReview(p.category)) throw bad("Send " + d.suggestedName + " to staff for review.");
        await publishDraft(tx, d, d.matchedProductId, d.suggestedPriceCents);
      }
      await tx.extractionJob.update({ where: { sessionId: job.sessionId }, data: { submittedAt: new Date(), revision: { increment: 1 } } });
      await tx.store.updateMany({ where: { id: ctx.storeId, onboardingStatus: "filming" }, data: { onboardingStatus: "reviewing" } });
      await releaseReviewedFrames(tx, job.sessionId);
      return { submitted: true };
    }, { timeout: 30_000 });
    await cleanShelfUploads().catch(() => console.warn("Shelf cleanup will retry."));
    return result;
  }),

  refilm: merchantProcedure.input(z.object({ revision })).mutation(async ({ ctx, input }) =>
    prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "Store" WHERE "id"=${ctx.storeId} FOR UPDATE`;
      const job = await tx.extractionJob.findFirst({ where: { session: { storeId: ctx.storeId, store: eligible }, revision: input.revision, submittedAt: null } });
      if (!job) throw bad("Reload the catalogue before re-filming.");
      if (job.state !== "ready" && (!["failed", "queued"].includes(job.state) || await tx.shelfFrame.count({ where: { ...availableFrame(), sessionId: job.sessionId } })))
        throw bad("This capture is still in use.");
      if (await tx.catalogueDraft.count({ where: { jobId: job.sessionId, decision: { not: "removed" } } }))
        throw bad("Remove remaining drafts before starting another pass.");
      if (!(await tx.extractionJob.deleteMany({ where: { sessionId: job.sessionId, state: job.state } })).count) throw bad("Reload the catalogue before re-filming.");
      await tx.filmSession.update({ where: { id: job.sessionId }, data: { finishedAt: null, revision: { increment: 1 } } });
      return { ready: true };
    })),
});
