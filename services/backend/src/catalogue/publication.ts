import type { CatalogueDraft, Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { checkListingForStore } from "../quality/categoryAccess.js";

export const staffDrafts: Prisma.CatalogueDraftWhereInput = { OR: [{ jobId: null }, {
  decision: "staff", job: { submittedAt: { not: null } },
}] };

export { releaseReviewedFrames } from "./photoRetention.js";

export async function publishDraft(tx: Prisma.TransactionClient, draft: CatalogueDraft, productId: string, priceCents: number, note?: string) {
  const product = await tx.canonicalProduct.findUnique({ where: { id: productId } });
  if (!product) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose an existing catalogue product." });
  const standards = await checkListingForStore(tx, draft.storeId, product);
  if (!standards.ok) throw new TRPCError({
    code: standards.violations.every(v => v.code === "permit_confirmation_required") ? "PRECONDITION_FAILED" : "FORBIDDEN",
    message: draft.suggestedName + " — " + standards.violations.map(v => v.message).join(" "),
  });
  const claimed = await tx.catalogueDraft.updateMany({ where: { id: draft.id, status: "pending_review" },
    data: { status: "approved", matchedProductId: productId, suggestedPriceCents: priceCents, reviewNote: note, reviewedAt: new Date() } });
  if (!claimed.count) throw new TRPCError({ code: "CONFLICT", message: "This draft has already been resolved." });
  if (draft.jobId && await tx.listing.count({ where: { storeId: draft.storeId, canonicalProductId: productId } }))
    throw new TRPCError({ code: "CONFLICT", message: product.canonicalName + " already has a listing in this store. Remove the duplicate." });
  const listing = await tx.listing.create({ data: { storeId: draft.storeId, canonicalProductId: product.id, priceCents,
    temperatureClass: product.temperatureClass, shippingWeightOz: product.shippingWeightOz, lengthIn: product.lengthIn,
    widthIn: product.widthIn, heightIn: product.heightIn } });
  return { listingId: listing.id };
}

export async function staffDraft(tx: Prisma.TransactionClient, id: string) {
  const ref = await tx.catalogueDraft.findUnique({ where: { id }, select: { storeId: true } });
  if (!ref) throw new TRPCError({ code: "NOT_FOUND", message: "That draft no longer exists." });
  await tx.$queryRaw`SELECT "id" FROM "Store" WHERE "id"=${ref.storeId} FOR UPDATE`;
  const draft = await tx.catalogueDraft.findFirst({ where: { id, status: "pending_review", ...staffDrafts } });
  if (!draft) throw new TRPCError({ code: "BAD_REQUEST", message: "That draft is not waiting for staff review." });
  return draft;
}
