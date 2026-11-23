import type { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { prisma } from "../db.js";
import { resolveProducts } from "./extraction.js";
import { readStorefront } from "./storefront.js";
import { shopifyVariantPrefix } from "./shopify.js";
import type { PageReader } from "./storefrontHttp.js";

const eligible = { onboardingRail: "web", ownerPhoneVerifiedAt: { not: null }, onboardingProfileAt: { not: null },
  onboardingStatus: { in: ["filming", "reviewing", "kit_issued", "live"] } } satisfies Prisma.StoreWhereInput;
const conflict = () => new TRPCError({ code: "CONFLICT", message: "Your catalogue setup changed. Reload before importing." });

export async function importWebsite(storeId: string, read: PageReader) {
  const where = { id: storeId, ...eligible };
  const store = await prisma.store.findFirst({ where, select: { onboardingWebsite: true, onboardingStatus: true,
    filmSession: { select: { extraction: { select: { websiteUrl: true, submittedAt: true,
      drafts: { take: 1, select: { sourceKey: true } } } } } } } });
  const website = store?.onboardingWebsite;
  if (!website) throw new TRPCError({ code: "FORBIDDEN", message: "Save your website in store setup before importing." });
  const previous = store.filmSession?.extraction;
  if (previous && previous.websiteUrl !== website) throw conflict();
  if (previous?.submittedAt) return { added: 0 };
  if (store.onboardingStatus !== "filming") throw conflict();

  let rows: Awaited<ReturnType<typeof readStorefront>>;
  try { rows = await readStorefront(website, read, previous?.drafts[0]?.sourceKey); }
  catch (error) {
    const message = error instanceof Error && !(error instanceof SyntaxError) && !("code" in error) ? error.message : "The storefront could not be read. Check the URL and try again.";
    throw new TRPCError({ code: "BAD_REQUEST", message });
  }
  const products = await prisma.canonicalProduct.findMany({ select: { id: true, canonicalName: true, packSize: true, aliases: { select: { alias: true } } } });
  const drafts = await resolveProducts(rows.map(p => p.reading), products, null);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Store" WHERE "id"=${storeId} FOR UPDATE`;
    const current = await tx.store.findFirst({ where: { ...where, onboardingWebsite: website },
      select: { onboardingStatus: true, filmSession: { include: { extraction: true, _count: { select: { frames: true } } } } } });
    if (!current) throw conflict();
    const session = current.filmSession;
    if (session?.extraction && session.extraction.websiteUrl !== website) throw conflict();
    if (session?.extraction?.submittedAt) return { added: 0 };
    if (current.onboardingStatus !== "filming" || session?._count.frames) throw conflict();
    // Concurrent first imports must agree on identity if one fell back to page markup.
    if (!previous && session?.extraction) {
      const saved = await tx.catalogueDraft.findFirst({ where: { jobId: session.id }, select: { sourceKey: true } });
      if (saved?.sourceKey && saved.sourceKey.startsWith(shopifyVariantPrefix) !== rows[0]!.sourceKey.startsWith(shopifyVariantPrefix)) throw conflict();
    }
    const film = await tx.filmSession.upsert({ where: { storeId }, create: { storeId, finishedAt: new Date() }, update: {} });
    await tx.extractionJob.upsert({ where: { sessionId: film.id }, create: { sessionId: film.id, websiteUrl: website, state: "ready" }, update: {} });
    const added = await tx.catalogueDraft.createMany({ data: drafts.map((d, i) => ({ ...d, storeId, jobId: film.id, sourceKey: rows[i]!.sourceKey })), skipDuplicates: true });
    if (added.count) await tx.extractionJob.update({ where: { sessionId: film.id }, data: { revision: { increment: 1 } } });
    return { added: added.count };
  });
}
