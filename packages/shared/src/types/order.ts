import type { ID, Timestamps } from "./common";

export interface CartItem {
  listingId: ID;
  quantity: number;
}

/** A buyer's basket. Items may span multiple stores (CART-1); routing resolves at checkout. */
export interface Cart {
  id: ID;
  buyerId: ID;
  items: CartItem[];
}

/** PRD NTF-1 — the order-state pipeline, driven by carrier tracking webhooks. */
export type OrderStatus =
  | "placed"
  | "accepted"
  | "packed"
  | "shipped"
  | "delivered"
  | "cancelled";

/** A buyer's basket and its resulting order; decomposes into one or more Shipments. PRD 9: Order. */
export interface Order extends Timestamps {
  id: ID;
  buyerId: ID;
  status: OrderStatus;
  /** Single blended total shown to the buyer — never two shipping fees (CART-5). */
  totalCents: number;
  shippingCents: number;
  taxCents: number;
  shipmentIds: ID[];
}
