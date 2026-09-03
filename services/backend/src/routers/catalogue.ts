import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { publicProcedure, router } from "../trpc.js";
import type { AlsoAvailableData, LangAliasData, ProductCardData, ProductDetailData, ReviewData } from "@afrimart/shared";

/**
 * PRD 6.3/6.4: CAT-1 (registry), CAT-2/CAT-3 (name resolution — a plain
 * contains-match here, not the real knowledge-graph ranking, which lands
 * with the full catalogue build in Prompt 8), SRCH-1..5.
 */

const listingWithRelations = {
  canonicalProduct: { include: { aliases: true } },
  store: { include: { hubMetro: true } },
} satisfies Prisma.ListingInclude;

type ListingWithRelations = Prisma.ListingGetPayload<{ include: typeof listingWithRelations }>;

/** PRD FUL-3 — ambient nationwide shipping. Real carrier rate-shopping (CART-8) is Prompt 8; this is a placeholder. */
function shippingDaysFor(listing: ListingWithRelations): string {
  return listing.stockStatus === "made_to_order" ? "3-4 days" : "1-2 days";
}

function toCardData(listing: ListingWithRelations): ProductCardData {
  const p = listing.canonicalProduct;
  return {
    listingId: listing.id,
    canonicalProductId: p.id,
    name: p.canonicalName,
    altNames: `${p.shortDescription} · ${p.packSize}`,
    category: p.category,
    cuisine: p.cuisine,
    priceCents: listing.priceCents,
    unitLabel: `/ ${p.packSize}`,
    sellerName: listing.store.name,
    sellerVerified: listing.store.verificationStatus === "verified",
    shippingDays: shippingDaysFor(listing),
    freshnessGuarantee: listing.freshnessGuarantee,
    madeToOrder: listing.stockStatus === "made_to_order",
  };
}

const browseInput = z.object({
  categories: z.array(z.string()).optional(),
  cuisines: z.array(z.string()).optional(),
  verifiedOnly: z.boolean().optional(),
});
type BrowseInput = z.infer<typeof browseInput>;

const searchInput = z.object({ query: z.string() });
type SearchInput = z.infer<typeof searchInput>;

const listingIdInput = z.object({ listingId: z.string() });
type ListingIdInput = z.infer<typeof listingIdInput>;

export const catalogueRouter = router({
  /** Home page "Featured staples" — a small curated slice, quick-add cards. */
  featured: publicProcedure.query(async () => {
    const listings = await prisma.listing.findMany({
      take: 4,
      include: listingWithRelations,
      orderBy: { createdAt: "asc" },
    });
    return listings.map(toCardData);
  }),

  /** SRCH-2 — browse by category/cuisine, with the shop screen's filter set. */
  browse: publicProcedure.input(browseInput).query(async ({ input }: { input: BrowseInput }) => {
    const where: Prisma.ListingWhereInput = {};
    const productFilters: Prisma.CanonicalProductWhereInput = {};
    if (input.categories?.length) productFilters.category = { in: input.categories };
    if (input.cuisines?.length) productFilters.cuisine = { in: input.cuisines };
    if (Object.keys(productFilters).length) where.canonicalProduct = { is: productFilters };
    if (input.verifiedOnly) where.store = { is: { verificationStatus: "verified" } };

    const listings = await prisma.listing.findMany({ where, include: listingWithRelations });
    return listings.map(toCardData);
  }),

  /** Categories/cuisines with listing counts, for the shop chips and filters slide-over. */
  facets: publicProcedure.query(async () => {
    const listings = await prisma.listing.findMany({ include: { canonicalProduct: { select: { category: true, cuisine: true } } } });
    const categoryCounts = new Map<string, number>();
    const cuisineCounts = new Map<string, number>();
    for (const l of listings) {
      categoryCounts.set(l.canonicalProduct.category, (categoryCounts.get(l.canonicalProduct.category) ?? 0) + 1);
      cuisineCounts.set(l.canonicalProduct.cuisine, (cuisineCounts.get(l.canonicalProduct.cuisine) ?? 0) + 1);
    }
    return {
      categories: Array.from(categoryCounts, ([name, count]) => ({ name, count })),
      cuisines: Array.from(cuisineCounts, ([name, count]) => ({ name, count })),
    };
  }),

  /**
   * SRCH-1 — resolve a query (any name/spelling/language) to a canonical
   * product's best listing, or return no hit so the UI can show the
   * zero-state and its closest-match/Cook-agent fallbacks (AGT-3).
   */
  search: publicProcedure.input(searchInput).query(async ({ input }: { input: SearchInput }) => {
    const term = input.query.trim();
    if (!term) return { hit: null, related: [] as ProductCardData[] };

    const hit = await prisma.listing.findFirst({
      where: {
        canonicalProduct: {
          is: {
            OR: [
              { canonicalName: { contains: term, mode: "insensitive" } },
              { aliases: { some: { alias: { contains: term, mode: "insensitive" } } } },
            ],
          },
        },
      },
      include: listingWithRelations,
    });

    if (!hit) return { hit: null, related: [] as ProductCardData[] };

    const related = await prisma.listing.findMany({
      where: { canonicalProduct: { is: { cuisine: hit.canonicalProduct.cuisine } } },
      include: listingWithRelations,
      take: 6,
    });

    return {
      hit: toCardData(hit),
      matchedAliases: hit.canonicalProduct.aliases.map((a: { alias: string }) => a.alias).slice(0, 3),
      related: related.map(toCardData),
    };
  }),

  /** SRCH-3 — full product detail: cross-store availability, language names, reviews. */
  detail: publicProcedure.input(listingIdInput).query(async ({ input }: { input: ListingIdInput }) => {
    const listing = await prisma.listing.findUniqueOrThrow({
      where: { id: input.listingId },
      include: { ...listingWithRelations, reviews: true },
    });

    const others = await prisma.listing.findMany({
      where: { canonicalProductId: listing.canonicalProductId, id: { not: listing.id } },
      include: listingWithRelations,
    });

    const langs: LangAliasData[] = listing.canonicalProduct.aliases
      .filter((a: { language: string }) => !["phonetic-english", "other"].includes(a.language))
      .map((a: { language: string; alias: string }) => ({ language: a.language, name: a.alias }));

    const alsoAvailable: AlsoAvailableData[] = others.map((o: ListingWithRelations) => ({
      listingId: o.id,
      sellerName: o.store.name,
      sellerVerified: o.store.verificationStatus === "verified",
      metro: `${o.store.hubMetro.name}, ${o.store.hubMetro.state}`,
      priceCents: o.priceCents,
    }));

    const reviews: ReviewData[] = listing.reviews.map((r: { buyerName: string; rating: number; comment: string }) => ({
      buyerName: r.buyerName,
      rating: r.rating,
      comment: r.comment,
    }));
    const reviewCount = reviews.length;
    const rating = reviewCount ? reviews.reduce((sum: number, r: ReviewData) => sum + r.rating, 0) / reviewCount : 0;

    const detail: ProductDetailData = {
      ...toCardData(listing),
      metro: `${listing.store.hubMetro.name}, ${listing.store.hubMetro.state}`,
      leadTimeDays: listing.leadTimeDays ?? undefined,
      langs,
      alsoAvailable,
      rating,
      reviewCount,
      reviews,
      usedDescription: listing.canonicalProduct.usedDescription,
    };
    return detail;
  }),
});
