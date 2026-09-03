import type { ID, Timestamps } from "./common";

/** PRD 6.10 — later-phase (SUB-1 Phase 2, SUB-3 membership Phase 3). Modeled now, not built until phase. */
export type SubscriptionType = "taste-of-home-box" | "membership";

/** A recurring box or membership. PRD 9: Subscription. */
export interface Subscription extends Timestamps {
  id: ID;
  buyerId: ID;
  type: SubscriptionType;
  status: "active" | "paused" | "cancelled";
  cadence?: "monthly" | "bimonthly" | "quarterly";
  nextRenewalAt?: string;
}
