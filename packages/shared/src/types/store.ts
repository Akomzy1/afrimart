import type { ID, Timestamps } from "./common";

/** PRD 6.12 SEL-* — the ladder from aspiring entrepreneur to established store. */
export type SellerType = "store" | "home-seller" | "aspiring-entrepreneur";

/** PRD ONB-1 — which onboarding rail a store was routed to. */
export type OnboardingRail = "filming" | "structured-import" | "sync";

export type OnboardingStatus =
  | "pending"
  | "filming"
  | "reviewing"
  | "kit-issued"
  | "live"
  | "suspended"
  | "delisted";

/** PRD SEL-2 — required before a non-store seller can list publicly. */
export interface SellerVerification {
  status: "unverified" | "pending" | "verified" | "rejected";
  foodSafetyAttestedAt?: string;
  verifiedAt?: string;
}

/** A merchant. PRD 9: Store. */
export interface Store extends Timestamps {
  id: ID;
  name: string;
  ownerName: string;
  sellerType: SellerType;
  hubMetroId: ID;
  onboardingRail?: OnboardingRail;
  onboardingStatus: OnboardingStatus;
  verification: SellerVerification;
  /** PRD SEL-4 / QC-4 — earned visibility, not a fixed attribute. */
  qualityScore?: number;
  payoutAccountId?: string;
}
