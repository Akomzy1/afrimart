import type { ProductGlyphKind } from "@afrimart/ui";

export type OrderStatus = "new" | "packing" | "ready";

export interface MerchantOrderItem {
  name: string;
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
  /** 0 = print the label, 1 = pack every item. */
  step: number;
  packed: number[];
  items: MerchantOrderItem[];
  valueCents: number;
  /** QC-2 — where the box photo is served from, or null until one is saved. */
  photoUrl: string | null;
}


export const MESSAGES: { id: string; from: string; initial: string; snippet: string; when: string; unread: boolean; support?: boolean }[] = [
  { id: "m1", from: "Amara O.", initial: "A", snippet: "Is the egusi coarse or fine ground?", when: "5 min", unread: true },
  { id: "m2", from: "AfriMart", initial: "AM", snippet: "Chilled food or a badge? Apply here.", when: "", unread: false, support: true },
  { id: "m3", from: "Kofi B.", initial: "K", snippet: "Thank you — the suya spice was perfect.", when: "2 days", unread: false },
];

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
