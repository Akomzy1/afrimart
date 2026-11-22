import type { Prisma, PrismaClient } from "@prisma/client";
import type { ResolvedSession } from "./session.js";

/**
 * The audit trail for anything that moves money or changes a seller's
 * standing: refunds, payout holds and releases, PAY-9 chargebacks, QC-8
 * recoveries, suspensions and delisting.
 *
 * Written inside the same transaction as the change it records, so an audited
 * action cannot commit without its entry. A log written afterwards, outside
 * the transaction, is the version that quietly loses records exactly when
 * something has gone wrong and you most need them.
 */

/** Actions that must be audited. Naming them here keeps the list reviewable. */
export const AUDITED_ACTIONS = [
  "store.create",
  "store.invite",
  "store.kit_issued",
  "store.onboarding_change",
  "store.suspend",
  "store.delist",
  "store.reinstate",
  "store.verification_change",
  "store.kitchen_licence_change",
  /**
   * The mobile number a shop signs in with. Whoever controls that number
   * controls the shop's orders and payouts, so changing it is audited with a
   * reason and ends every session the shop has.
   */
  "store.owner_phone_change",
  "store.category_restriction_change",
  "platform.category_restriction_change",
  "product.reclassify",
  "payout.hold",
  "payout.release",
  "payout.adjustment_applied",
  "refund.approve",
  "refund.reject",
  "refund.recovery_recorded",
  "chargeback.record",
  /**
   * A staff member opened a private photo: a licence or badge document, a
   * buyer's claim photo (which can show their address), or a packing photo.
   * Recorded when the link is issued, which is the moment access is granted.
   */
  "photo.view",
] as const;

export type AuditedAction = (typeof AUDITED_ACTIONS)[number];

export interface AuditInput {
  action: AuditedAction;
  subjectType:
    | "store"
    | "payout"
    | "refund"
    | "shipment"
    | "adjustment"
    | "platform_setting"
    | "product"
    | "kitchen_licence"
    | "seller_badge"
    | "claim";
  subjectId: string;
  before?: unknown;
  after?: unknown;
  note?: string;
}

type Tx = Prisma.TransactionClient | PrismaClient;

export async function writeAudit(tx: Tx, actor: ResolvedSession, input: AuditInput) {
  return tx.auditLogEntry.create({
    data: {
      actorId: actor.staffUserId,
      // Snapshotted so the trail stays readable if the account is renamed,
      // changes role, or is deleted outright.
      actorEmail: actor.email,
      actorRole: actor.role,
      action: input.action,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      before: (input.before ?? undefined) as Prisma.InputJsonValue | undefined,
      after: (input.after ?? undefined) as Prisma.InputJsonValue | undefined,
      note: input.note,
    },
  });
}
