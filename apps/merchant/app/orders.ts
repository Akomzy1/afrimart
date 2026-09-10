import type { ProductGlyphKind } from "@afrimart/ui";

export type OrderStatus = "new" | "packing" | "ready";

export interface MerchantOrderItem {
  name: string;
  qty: number;
  glyph: ProductGlyphKind;
}

export interface MerchantOrder {
  id: string;
  buyer: string;
  ago: string;
  status: OrderStatus;
  /** 0 = print the label, 1 = pack every item. */
  step: number;
  packed: number[];
  items: MerchantOrderItem[];
  valueCents: number;
}

/**
 * The prototype's order set. There is no order router on the backend yet
 * (catalogue and health only), so fulfilment state lives in the client for now
 * — MCH-2/MCH-4 wiring is a backend task, not a layout one.
 */
export const SEED_ORDERS: MerchantOrder[] = [
  {
    id: "#1042", buyer: "Amara O.", ago: "2 min ago", status: "new", step: 0, packed: [], valueCents: 4820,
    items: [
      { name: "Egusi", qty: 2, glyph: "leaf" },
      { name: "Ata Rodo", qty: 1, glyph: "pepper" },
      { name: "Red Palm Oil", qty: 1, glyph: "jar" },
      { name: "Garri", qty: 2, glyph: "wheat" },
    ],
  },
  {
    id: "#1041", buyer: "Kofi B.", ago: "18 min ago", status: "new", step: 0, packed: [], valueCents: 2750,
    items: [
      { name: "Suya Spice", qty: 1, glyph: "seed" },
      { name: "Plantain Flour", qty: 1, glyph: "leaf" },
      { name: "Crayfish", qty: 1, glyph: "seed" },
    ],
  },
  {
    id: "#1039", buyer: "Ngozi A.", ago: "1 hr ago", status: "packing", step: 0, packed: [], valueCents: 6300,
    items: [
      { name: "Garri", qty: 3, glyph: "wheat" },
      { name: "Egusi", qty: 1, glyph: "leaf" },
      { name: "Berbere", qty: 1, glyph: "seed" },
      { name: "Ata Rodo", qty: 2, glyph: "pepper" },
      { name: "Palm Oil", qty: 1, glyph: "jar" },
    ],
  },
];

export const MESSAGES = [
  { id: "m1", from: "Amara O.", initial: "A", snippet: "Is the egusi coarse or fine ground?", when: "5 min", unread: true },
  { id: "m2", from: "AfriMart Support", initial: "AM", snippet: "Your payout for last week has been sent.", when: "Yesterday", unread: false },
  { id: "m3", from: "Kofi B.", initial: "K", snippet: "Thank you — the suya spice was perfect.", when: "2 days", unread: false },
];
