import type { ID, Timestamps } from "./common";

/** PRD QC-3 — item-level quality flagging by buyers, feeding refunds and the seller's quality record. */
export type QualityFlagReason = "damaged" | "expired" | "not-as-described" | "suspected-inauthentic";

export interface QualityFlag extends Timestamps {
  id: ID;
  orderId: ID;
  shipmentId: ID;
  listingId: ID;
  reason: QualityFlagReason;
  note?: string;
  photoUrl?: string;
  /** PRD QC-6 — enforcement ladder outcome, if any, triggered by this flag. */
  enforcementAction?: "none" | "warning" | "listing-suspended" | "delisted";
}
