import type { ID } from "./common";

/**
 * The read-model the buyer app actually renders — one row per Listing (a
 * specific store's offer), not per CanonicalProduct, since SRCH-3 shows
 * cross-store price/availability as separate cards/rows. Assembled by
 * services/backend from CanonicalProduct + Listing + Store + HubMetro.
 */
export interface ProductCardData {
  listingId: ID;
  canonicalProductId: ID;
  name: string;
  /** Alternate names/spellings joined for display, e.g. "Gari · cassava flakes · èbà" (SRCH-1). */
  altNames: string;
  category: string;
  cuisine: string;
  priceCents: number;
  unitLabel: string;
  sellerName: string;
  sellerVerified: boolean;
  /** e.g. "1-2 days" — PRD SRCH-5 shipping-availability awareness. */
  shippingDays: string;
  freshnessGuarantee: boolean;
  madeToOrder: boolean;
}

export interface LangAliasData {
  language: string;
  name: string;
}

export interface AlsoAvailableData {
  listingId: ID;
  sellerName: string;
  sellerVerified: boolean;
  metro: string;
  priceCents: number;
}

export interface ReviewData {
  buyerName: string;
  rating: number;
  comment: string;
}

/** SRCH-3 — full product detail, resolved to one specific listing. */
export interface ProductDetailData extends ProductCardData {
  metro: string;
  leadTimeDays?: number;
  langs: LangAliasData[];
  alsoAvailable: AlsoAvailableData[];
  rating: number;
  reviewCount: number;
  reviews: ReviewData[];
  usedDescription: string;
}
