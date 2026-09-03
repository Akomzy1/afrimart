import type { ID, Timestamps } from "./common";

/** Buyer charge for an Order. PRD 9: Payment. */
export interface Payment extends Timestamps {
  id: ID;
  orderId: ID;
  buyerChargeCents: number;
  currency: "USD";
  stripePaymentIntentId: string;
  status: "requires_payment" | "succeeded" | "refunded" | "partially_refunded" | "failed";
}

/** Per-store remittance net of take rate and fees. PRD 9: Payout / PAY-2, PAY-3. */
export interface Payout extends Timestamps {
  id: ID;
  storeId: ID;
  orderId: ID;
  grossCents: number;
  /** PRD PAY-3 — configurable take rate, 12-15%, expressed in basis points. */
  takeRateBps: number;
  fulfilmentFeeCents: number;
  netCents: number;
  status: "scheduled" | "paid" | "failed";
  scheduledFor?: string;
  paidAt?: string;
}
