import type { ControlledCategory, SellerType, TemperatureClass } from "@prisma/client";
import { SHORT_DATED_DAYS, SUPPORT_CONTACT } from "../config.js";

/**
 * QC-1 — what may be listed, enforced at listing rather than described in a
 * policy page.
 *
 * The constraint that actually matters here is legal, not editorial:
 * US cottage-food rules let a home-based producer sell shelf-stable goods
 * only. Anything requiring refrigeration needs a commercial kitchen and an
 * inspection a home seller does not have. A policy document does not stop
 * anyone listing frozen goat meat from a domestic freezer; a check at the
 * point of listing does.
 *
 * Meat, poultry, fish and dairy are a different kind of rule. They are open to
 * home-based and aspiring sellers by default — dried fish, crayfish, stockfish
 * and kilishi are staples of exactly this tier — and are governed by operations
 * switches and a one-time permit confirmation rather than by a ban. Stores are
 * outside every one of these rules.
 */

/** Plain-English names, used in every message a seller reads. */
export const CONTROLLED_CATEGORY_LABEL: Record<ControlledCategory, string> = {
  meat: "meat",
  poultry: "poultry",
  fish: "fish and seafood",
  dairy: "dairy",
};

/**
 * Everything about a seller, other than their type, that the QC-1 rules need.
 * Required on a candidate rather than optional: a caller that forgot to load it
 * would otherwise skip the licence, switch and permit rules without any error.
 */
export interface SellerListingContext {
  /** An ops-approved licensed commercial kitchen. Never self-declared. */
  licensedKitchen: boolean;
  /** Switched off for this seller by operations. */
  disabledForSeller: readonly ControlledCategory[];
  /** Switched off for every home-based and aspiring seller by operations. */
  disabledPlatformWide: readonly ControlledCategory[];
  /** Categories this seller has made their one-time permit confirmation for. */
  permitConfirmed: readonly ControlledCategory[];
}

export const PROHIBITED_CATEGORIES = [
  "alcohol",
  "raw milk",
  "raw-milk cheese",
  "bushmeat",
  "wild game",
  "supplements",
  "medicines",
] as const;

/** Allowed, but only with the extra disclosure each one requires. */
export const RESTRICTED_CATEGORIES = ["fresh meat", "fresh seafood", "prepared meals"] as const;

export interface ListingCandidate {
  canonicalName: string;
  category: string;
  temperatureClass: TemperatureClass;
  sellerType: SellerType;
  /** Meat, poultry, fish or dairy, however it is preserved; null or absent for anything else. */
  controlledCategory?: ControlledCategory | null;
  seller: SellerListingContext;
  expiresOn?: Date | null;
  shortDatedDisclosed?: boolean;
  /** QC-1 — labelling: what the pack actually states. */
  hasIngredientList?: boolean;
  hasAllergenInfo?: boolean;
  netWeightStated?: boolean;
}

export interface StandardsResult {
  ok: boolean;
  violations: { code: string; message: string }[];
}

/** Home-based and aspiring sellers: the tier the QC-1 seller rules apply to. Stores are not in it. */
export function isHomeTier(sellerType: SellerType): boolean {
  return sellerType !== "store";
}

/** The exact words a seller confirms. Versioned by PERMIT_STATEMENT_VERSION. */
export function permitStatement(group: ControlledCategory): string {
  return `I confirm that I hold any permit my state requires for me to sell ${CONTROLLED_CATEGORY_LABEL[group]}.`;
}

export function sellerDisabledMessage(group: ControlledCategory): string {
  const label = CONTROLLED_CATEGORY_LABEL[group];
  return (
    `Listing ${label} is switched off on your account, so your existing ${label} listings are hidden ` +
    `and new ones can't be added. To find out why, or to ask for a review, contact ${SUPPORT_CONTACT}.`
  );
}

export function platformDisabledMessage(group: ControlledCategory): string {
  const label = CONTROLLED_CATEGORY_LABEL[group];
  return (
    `AfriMart has paused ${label} listings from home-based and aspiring sellers for now, so your existing ` +
    `${label} listings are hidden and new ones can't be added. If you have questions, contact ${SUPPORT_CONTACT}.`
  );
}

export function checkListingStandards(c: ListingCandidate, now = new Date()): StandardsResult {
  const violations: { code: string; message: string }[] = [];
  const category = c.category.trim().toLowerCase();

  if ((PROHIBITED_CATEGORIES as readonly string[]).includes(category)) {
    violations.push({
      code: "prohibited_category",
      message: `${c.category} cannot be sold on AfriMart.`,
    });
  }

  /**
   * The cottage-food rule. Not a preference: a home-based seller may list
   * shelf-stable goods only, because anything needing refrigeration requires a
   * licensed kitchen. The one way past it is an ops-approved licensed
   * commercial kitchen (`seller.licensedKitchen`), which a seller applies for
   * and a reviewer grants after checking the licence. SEL-5 (fresh and
   * prepared home food) stays Phase 2; this is the narrower route for sellers
   * who already hold the licence.
   */
  if (isHomeTier(c.sellerType)) {
    if (c.temperatureClass !== "ambient" && !c.seller.licensedKitchen) {
      violations.push({
        code: "home_seller_perishable",
        message:
          "Home-based sellers can list shelf-stable items only. Chilled and frozen goods need a commercial kitchen. " +
          "If you produce in a licensed commercial kitchen, apply to have it approved.",
      });
    }

    const group = c.controlledCategory;
    if (group) {
      const label = CONTROLLED_CATEGORY_LABEL[group];
      let blocked = false;

      if (c.seller.disabledPlatformWide.includes(group)) {
        blocked = true;
        violations.push({ code: "category_disabled_platform", message: platformDisabledMessage(group) });
      }
      if (c.seller.disabledForSeller.includes(group)) {
        blocked = true;
        violations.push({ code: "category_disabled_for_seller", message: sellerDisabledMessage(group) });
      }

      // Asking for a permit confirmation on something that cannot be listed
      // anyway would send the seller round a loop that ends in a refusal.
      if (!blocked && !c.seller.permitConfirmed.includes(group)) {
        violations.push({
          code: "permit_confirmation_required",
          message:
            `Before you list ${label}, please confirm that you hold any permit your state requires to sell it. ` +
            "You only need to do this once.",
        });
      }
    }
  }

  if (c.expiresOn) {
    const daysLeft = Math.floor((c.expiresOn.getTime() - now.getTime()) / 86_400_000);
    if (daysLeft < 0) {
      violations.push({ code: "expired", message: "This item is past its expiry date." });
    } else if (daysLeft < SHORT_DATED_DAYS && !c.shortDatedDisclosed) {
      // QC-1 — short-dated stock is sellable, but only said out loud.
      violations.push({
        code: "short_dated_undisclosed",
        message: `Expires in ${daysLeft} days. Short-dated items must be disclosed to the buyer.`,
      });
    }
  }

  // Labelling. Required on everything edible, which here is everything.
  if (c.hasIngredientList === false) {
    violations.push({ code: "no_ingredients", message: "An ingredient list is required." });
  }
  if (c.hasAllergenInfo === false) {
    violations.push({ code: "no_allergens", message: "Allergen information is required." });
  }
  if (c.netWeightStated === false) {
    violations.push({ code: "no_net_weight", message: "Net weight or volume must be stated." });
  }

  return { ok: violations.length === 0, violations };
}

/** Restricted categories are listable, but never auto-approved from a draft. */
export function requiresManualReview(category: string): boolean {
  return (RESTRICTED_CATEGORIES as readonly string[]).includes(category.trim().toLowerCase());
}
