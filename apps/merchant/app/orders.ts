import type { ProductGlyphKind } from "@afrimart/ui";
import type { RouterOutputs } from "@afrimart/api-client";

export type OrderStatus = "new" | "packing" | "ready" | "declined";

export interface MerchantOrderItem {
  id: string;
  name: string;
  packSize: string;
  productPhoto: string | null;
  qty: number;
  glyph: ProductGlyphKind;
}

export interface MerchantOrder {
  /** The shipment id — a store fulfils parcels, not whole orders. */
  id: string;
  /** The buyer-facing order number this parcel belongs to. */
  ref: string;
  temperatureClass: string;
  buyer: string;
  ago: string;
  status: OrderStatus;
  declineReason: string | null;
  pickup: RouterOutputs["merchant"]["inbox"][number]["pickup"];
  /** 0 = print the label, 1 = pack every item. */
  step: number;
  packed: string[];
  items: MerchantOrderItem[];
  valueCents: number;
  /** QC-2 — where the box photo is served from, or null until one is saved. */
  photoUrl: string | null;
}



/** Category to glyph, so a real catalogue item still draws the right icon. */
export function glyphForCategory(category: string): ProductGlyphKind {
  const map: Record<string, ProductGlyphKind> = {
    "Legumes & seeds": "leaf",
    "Spices & seasonings": "pepper",
    Oils: "jar",
    "Flours & grains": "wheat",
    "Rice & grains": "wheat",
  };
  return map[category] ?? "leaf";
}
