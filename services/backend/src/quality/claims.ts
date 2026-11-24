import type { ShipmentStatus } from "@prisma/client";

/**
 * QC-3 — what a buyer may report, when, and how a report is shown back to them.
 * Pure rules; the router supplies the facts. The refund decision itself
 * (photo required, review thresholds, who bears the cost) is `assessClaim` in
 * refunds.ts and is not repeated here.
 */

/**
 * Item-level reports concern goods that have arrived, so they need a delivered
 * parcel. Returns the sentence to show when they are not yet possible.
 */
export function itemReportBlock(status: ShipmentStatus): string | null {
  if (status === "declined") return "The seller declined this parcel before packing.";
  return status === "delivered" ? null : "You can report a problem with an item once the parcel has arrived.";
}

/**
 * Parcel-level "it hasn't arrived" is offered only once the expected delivery
 * date has passed or tracking shows delivered — never while the parcel is
 * simply still on its way.
 */
export function parcelReportBlock(
  parcel: { status: ShipmentStatus; estimatedDelivery: Date | null },
  now: Date = new Date(),
): string | null {
  if (parcel.status === "declined") return "The seller declined this parcel before packing.";
  if (parcel.status === "delivered") return null;
  if (parcel.estimatedDelivery && parcel.estimatedDelivery.getTime() < now.getTime()) return null;
  return "It's not late yet. If it hasn't arrived by its expected date, you can report it then.";
}

/**
 * Did the carrier ever scan the parcel? A parcel still waiting for a label, or
 * with a label but never picked up, never left the seller, which is what moves
 * a not-arrived claim onto them rather than the carrier.
 */
export function hadCarrierScan(status: ShipmentStatus): boolean {
  return !["pending", "declined", "label_created"].includes(status);
}

export type ClaimStage = "review" | "refunded" | "declined";

/**
 * Where a report stands, in the buyer's terms. "Refunded" means a refund was
 * actually issued, not merely that a decision was made, so a claim that is
 * approved but not yet paid back does not claim to be.
 */
export function claimStage(claim: { status: string; refundedAt: Date | null }): ClaimStage {
  if (claim.refundedAt) return "refunded";
  if (claim.status === "rejected") return "declined";
  return "review";
}

/** The short reference shown to the buyer and quoted in emails. */
export function claimRef(id: string): string {
  return `R-${id.slice(-4).toUpperCase()}`;
}

/** A claim that still holds its items: anything except a declined one. */
export function isOpenClaim(status: string): boolean {
  return status !== "rejected";
}

/** A claim as the buyer sees it. */
export interface ClaimView {
  id: string;
  ref: string;
  kind: "item" | "parcel";
  reason: string;
  amountCents: number;
  stage: ClaimStage;
  createdAt: Date;
  /** The shipment items this report covers; empty for a parcel-level report. */
  itemIds: string[];
}

export function toClaimView(c: {
  id: string;
  kind: string;
  reason: string;
  amountCents: number;
  status: string;
  refundedAt: Date | null;
  createdAt: Date;
  items: { shipmentItemId: string }[];
}): ClaimView {
  return {
    id: c.id,
    ref: claimRef(c.id),
    kind: c.kind === "parcel" ? "parcel" : "item",
    reason: c.reason,
    amountCents: c.amountCents,
    stage: claimStage(c),
    createdAt: c.createdAt,
    itemIds: c.items.map((i) => i.shipmentItemId),
  };
}
