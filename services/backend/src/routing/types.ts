import type { StockStatus, TemperatureClass } from "@prisma/client";

/** One thing the buyer wants, in canonical terms — not tied to a store yet. */
export interface BasketLine {
  canonicalProductId: string;
  quantity: number;
}

/** A store's offer for a canonical product: the raw material routing chooses from. */
export interface CandidateListing {
  listingId: string;
  storeId: string;
  storeName: string;
  metro: string;
  canonicalProductId: string;
  priceCents: number;
  stockStatus: StockStatus;
  batchQuantityCap: number | null;
  temperatureClass: TemperatureClass;
  shippingWeightOz: number;
}

/** One basket line resolved to a specific store's listing. */
export interface AssignedLine {
  canonicalProductId: string;
  quantity: number;
  listing: CandidateListing;
  lineTotalCents: number;
}

/**
 * CART-3 — a parcel is one store and one temperature class. Ambient and
 * perishable never travel together, so this pairing is the unit of shipping.
 */
export interface Parcel {
  storeId: string;
  storeName: string;
  metro: string;
  temperatureClass: TemperatureClass;
  lines: AssignedLine[];
  weightOz: number;
  /** True carrier cost, which the buyer never sees per-parcel (CART-5). */
  carrierCostCents: number;
  carrier: string;
  service: string;
  transitDays: number;
  estimatedDelivery: Date;
  missedWindow: boolean;
}

export interface RoutingPlan {
  assignment: AssignedLine[];
  parcels: Parcel[];
  itemsSubtotalCents: number;
  /** What the carriers actually charge in total — platform-side, never displayed. */
  trueShippingCostCents: number;
  /** CART-2 — whether one store covered the whole basket. */
  singleStore: boolean;
  storeCount: number;
  /**
   * CART-2's "modest price difference": how much more the chosen single-store
   * basket costs than buying each line at its cheapest across all stores.
   * Surfaced rather than capped — see the note in select.ts.
   */
  singleStorePremiumCents: number;
  /** Lines no store could supply at the requested quantity. */
  unfulfillable: BasketLine[];
}
