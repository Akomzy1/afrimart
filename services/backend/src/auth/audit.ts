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
  "store.suspend",
  "store.delist",
  "store.reinstate",
  "store.verification_change",
  "payout.hold",
  "payout.release",
  "payout.adjustment_applied",
  "refund.approve",
  "refund.reject",
  "refund.recovery_recorded",
  "chargeback.record",
] as const;

export type AuditedAction = (typeof AUDITED_ACTIONS)[number];

export interface AuditInput {
  action: AuditedAction;
  subjectType: "store" | "payout" | "refund" | "shipment" | "adjustment";
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
