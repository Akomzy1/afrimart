import type { SellerType, TemperatureClass } from "@prisma/client";
import { SHORT_DATED_DAYS } from "../config.js";

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
 */

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
   * The cottage-food rule. Not a preference and not configurable: a
   * home-based seller may list shelf-stable goods only, because anything
   * needing refrigeration requires a licensed kitchen they do not have.
   * SEL-5 (fresh and prepared home food) is Phase 2 and gated on a defined
   * food-safety posture — until then this is a hard stop.
   */
  if (c.sellerType !== "store" && c.temperatureClass !== "ambient") {
    violations.push({
      code: "home_seller_perishable",
      message:
        "Home-based sellers can list shelf-stable items only. Chilled and frozen goods need a commercial kitchen.",
    });
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
