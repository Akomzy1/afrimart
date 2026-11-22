import type { ControlledCategory, Prisma, PrismaClient, SellerType, TemperatureClass } from "@prisma/client";
import {
  checkListingStandards,
  isHomeTier,
  platformDisabledMessage,
  sellerDisabledMessage,
  type SellerListingContext,
  type StandardsResult,
} from "./listingStandards.js";
import { currentLicenceWhere, licenceCounts } from "./licence.js";

/**
 * QC-1 — everything that needs the database: loading a seller's context for the
 * listing check, and deciding which existing listings are hidden.
 *
 * The rules themselves are pure and live in listingStandards.ts. This file only
 * fetches the state they read, so that "hidden" and "refused" are decided by
 * the same facts in both directions: what a seller cannot list is exactly what
 * a buyer cannot see.
 */

type Db = Prisma.TransactionClient | PrismaClient;

export async function loadSellerListingContext(db: Db, storeId: string): Promise<SellerListingContext> {
  const [licence, sellerControls, platformControls, permits] = await Promise.all([
    db.kitchenLicence.findUnique({ where: { storeId }, select: { status: true, licenceExpiresOn: true } }),
    db.sellerCategoryControl.findMany({ where: { storeId, disabled: true }, select: { category: true } }),
    db.platformCategoryControl.findMany({ where: { disabled: true }, select: { category: true } }),
    db.permitConfirmation.findMany({ where: { storeId }, select: { category: true } }),
  ]);
  return {
    // Approved and not past its expiry date, decided now, at read time.
    licensedKitchen: licenceCounts(licence),
    disabledForSeller: sellerControls.map((c) => c.category),
    disabledPlatformWide: platformControls.map((c) => c.category),
    permitConfirmed: permits.map((p) => p.category),
  };
}

/**
 * The QC-1 check for a product about to be listed by a given store. The one
 * entry point a listing path should use, so no caller assembles the seller's
 * context by hand and gets part of it wrong.
 */
export async function checkListingForStore(
  db: Db,
  storeId: string,
  product: {
    canonicalName: string;
    category: string;
    temperatureClass: TemperatureClass;
    controlledCategory: ControlledCategory | null;
  },
  extras: { expiresOn?: Date | null; shortDatedDisclosed?: boolean } = {},
): Promise<StandardsResult> {
  const store = await db.store.findUniqueOrThrow({ where: { id: storeId }, select: { sellerType: true } });
  const seller = await loadSellerListingContext(db, storeId);
  return checkListingStandards({
    canonicalName: product.canonicalName,
    category: product.category,
    temperatureClass: product.temperatureClass,
    controlledCategory: product.controlledCategory,
    sellerType: store.sellerType,
    seller,
    ...extras,
  });
}

/* --------------------------------------------------------------- hiding */

export interface HiddenListingInputs {
  /** Categories switched off for every home-based and aspiring seller. */
  platformDisabled: readonly ControlledCategory[];
  /** Per-seller switches: store id -> categories switched off for that store. */
  sellerDisabled: ReadonlyMap<string, readonly ControlledCategory[]>;
  /** The day a licence's expiry is compared with (midnight UTC). Defaults to today; a parameter so the rule can be pinned. */
  today?: Date;
}

/**
 * "Product is in one of these categories", written so it can never evaluate to
 * NULL. A product with no controlled category has a NULL column, and in SQL
 * `NULL IN ('fish')` is NULL rather than false; wrapped in the NOT that turns
 * "hidden" into "visible", NULL stays NULL and the row is dropped. Without the
 * explicit `not: null`, switching off any one category would have hidden every
 * unclassified listing the affected sellers have.
 */
function inCategories(categories: readonly ControlledCategory[]): Prisma.CanonicalProductWhereInput {
  return { controlledCategory: { not: null, in: [...categories] } };
}

/**
 * Which listings are hidden from buyers and from routing. Pure, so the shape of
 * the rule can be pinned without a database.
 *
 * A listing is hidden when its seller is in the home tier and any of these holds:
 *   - its product is in a category switched off platform-wide;
 *   - its product is in a category switched off for that seller;
 *   - it is chilled or frozen and the seller has no approved licensed kitchen —
 *     which is what makes revoking a licence take the listings down with it,
 *     rather than leaving them live against the rule that refused them.
 * Stores never match: every clause is scoped to a non-store seller or to one
 * named store, and a per-seller switch cannot be created on a store at all.
 */
export function buildHiddenListingFilter(input: HiddenListingInputs): Prisma.ListingWhereInput {
  const clauses: Prisma.ListingWhereInput[] = [
    {
      temperatureClass: { not: "ambient" },
      store: {
        is: {
          sellerType: { not: "store" },
          // A licence counts only while it is approved and not past its date.
          NOT: { kitchenLicence: { is: currentLicenceWhere(input.today) } },
        },
      },
    },
  ];

  if (input.platformDisabled.length) {
    clauses.push({
      canonicalProduct: { is: inCategories(input.platformDisabled) },
      store: { is: { sellerType: { not: "store" } } },
    });
  }

  for (const [storeId, categories] of input.sellerDisabled) {
    if (!categories.length) continue;
    clauses.push({
      storeId,
      canonicalProduct: { is: inCategories(categories) },
      store: { is: { sellerType: { not: "store" } } },
    });
  }

  return { OR: clauses };
}

/**
 * Narrow a listing query to what buyers may see. Every read of the public
 * catalogue and every routing pool goes through this, so that hiding is applied
 * where listings are read rather than depending on a flag that something has to
 * remember to keep in sync.
 */
export async function visibleListings(db: Db, where: Prisma.ListingWhereInput = {}, mode: "public" | "routing" = "public"): Promise<Prisma.ListingWhereInput> {
  const [platform, sellers] = await Promise.all([
    db.platformCategoryControl.findMany({ where: { disabled: true }, select: { category: true } }),
    db.sellerCategoryControl.findMany({ where: { disabled: true }, select: { storeId: true, category: true } }),
  ]);
  const sellerDisabled = new Map<string, ControlledCategory[]>();
  for (const row of sellers) {
    sellerDisabled.set(row.storeId, [...(sellerDisabled.get(row.storeId) ?? []), row.category]);
  }
  const hidden = buildHiddenListingFilter({
    platformDisabled: platform.map((p) => p.category),
    sellerDisabled,
  });
  // Routing must see an unverified live seller as a blocked candidate, so it
  // can distinguish a verification block from stock running out (SEL-2).
  // The engine rejects those candidates; public catalogue reads never see them.
  const store = { onboardingStatus: "live" as const, ...(mode === "public" ? { verificationStatus: "verified" } : {}) };
  return { AND: [where, { store: { is: store } }, { NOT: hidden }] };
}

/* -------------------------------------------------------------- notices */

export interface CategoryNotice {
  code: "category_disabled_platform" | "category_disabled_for_seller";
  category: ControlledCategory;
  message: string;
}

/**
 * What a seller should be told about listings that are currently hidden. The
 * same words the listing check uses, so a seller who is refused and a seller who
 * looks at their hidden listings read the same explanation. Ops' internal
 * reason is deliberately not included: it is a note for staff, not a message.
 */
export async function sellerCategoryNotices(db: Db, storeId: string, sellerType: SellerType): Promise<CategoryNotice[]> {
  if (!isHomeTier(sellerType)) return [];
  const ctx = await loadSellerListingContext(db, storeId);
  return [
    ...ctx.disabledPlatformWide.map((category) => ({
      code: "category_disabled_platform" as const,
      category,
      message: platformDisabledMessage(category),
    })),
    ...ctx.disabledForSeller.map((category) => ({
      code: "category_disabled_for_seller" as const,
      category,
      message: sellerDisabledMessage(category),
    })),
  ];
}
