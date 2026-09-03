import type { ID, TemperatureClass, Timestamps } from "./common";

/** PRD SEL-1 — availability states for made-to-order and batch sellers. */
export type StockStatus = "in-stock" | "made-to-order" | "out-of-stock";

/** A Store's offer of a CanonicalProduct. PRD 9: Listing / CAT-4. */
export interface Listing extends Timestamps {
  id: ID;
  storeId: ID;
  canonicalProductId: ID;
  priceCents: number;
  currency: "USD";
  stockStatus: StockStatus;
  /** PRD SEL-1 — required when stockStatus is "made-to-order". */
  leadTimeDays?: number;
  /** PRD SEL-1 — per-batch quantity cap so a buyer cannot order beyond what a seller can fulfil. */
  batchQuantityCap?: number;
  /** Overrides the canonical product's default, if this store's fulfilment differs. */
  temperatureClass: TemperatureClass;
  shippingWeightOz: number;
}
