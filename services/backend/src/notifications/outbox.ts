import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../db.js";
import { getSenders } from "./senders.js";

/**
 * The transactional outbox.
 *
 * Notifications are written in the same transaction as the state change that
 * causes them, and sent only once that transaction has committed. That gives
 * two properties neither a direct send nor a post-hoc send can offer:
 *
 *   - A rolled-back change cannot notify anyone. Sending inline would email a
 *     buyer about an order that then failed to save.
 *   - A crash between commit and send loses nothing. The row is still
 *     `pending` and the next drain picks it up.
 *
 * Duplicate suppression is the unique constraint on `dedupeKey`, not a check
 * in application code: "one email per parcel per state" survives concurrent
 * callers and retries only if the database enforces it.
 */

type Tx = Prisma.TransactionClient | PrismaClient;

export interface OutboxEntry {
  channel: "email" | "push" | "sms";
  template: string;
  recipient: string;
  subject: string;
  body: string;
  /** Stable across retries: channel + subject of the event, never a timestamp. */
  dedupeKey: string;
  orderId?: string;
  shipmentId?: string;
}

/**
 * Queues a notification inside the caller's transaction. Returns false when
 * one already exists for this dedupe key, which is the normal outcome for a
 * replayed webhook and not an error.
 */
export async function enqueue(tx: Tx, entry: OutboxEntry): Promise<boolean> {
  try {
    await tx.notification.create({
      data: {
        channel: entry.channel,
        template: entry.template,
        recipient: entry.recipient,
        subject: entry.subject,
        body: entry.body,
        dedupeKey: entry.dedupeKey,
        orderId: entry.orderId,
        shipmentId: entry.shipmentId,
      },
    });
    return true;
  } catch (e) {
    // P2002 is the unique violation: this notification already exists.
    if ((e as { code?: string }).code === "P2002") return false;
    throw e;
  }
}

export interface DrainResult {
  sent: number;
  failed: number;
  suppressed: number;
  byTemplate: Record<string, number>;
}

/**
 * Sends everything pending. Called after a transaction commits, and safe to
 * call repeatedly — a failed send stays pending and is retried next time.
 */
export async function drain(limit = 100): Promise<DrainResult> {
  const senders = getSenders();
  const pending = await prisma.notification.findMany({
    where: { status: "pending" },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  const result: DrainResult = { sent: 0, failed: 0, suppressed: 0, byTemplate: {} };

  for (const n of pending) {
    try {
      if (n.channel === "email") {
        await senders.email.send({ to: n.recipient, subject: n.subject, html: n.body });
      } else if (n.channel === "push") {
        await senders.push.send({ storeId: n.recipient, title: n.subject, body: n.body });
      } else {
        // NTF-4 — SMS stays off until 10DLC clears. Recorded as suppressed
        // rather than sent, so the counts never overstate what reached anyone.
        await senders.sms.send({ to: n.recipient, body: n.body });
        if (!senders.sms.enabled) {
          await prisma.notification.update({
            where: { id: n.id },
            data: { status: "suppressed", sentAt: new Date() },
          });
          result.suppressed++;
          result.byTemplate[n.template] = (result.byTemplate[n.template] ?? 0) + 1;
          continue;
        }
      }

      await prisma.notification.update({
        where: { id: n.id },
        data: { status: "sent", sentAt: new Date(), attempts: { increment: 1 } },
      });
      result.sent++;
      result.byTemplate[n.template] = (result.byTemplate[n.template] ?? 0) + 1;
    } catch (e) {
      await prisma.notification.update({
        where: { id: n.id },
        data: { attempts: { increment: 1 }, lastError: String((e as Error).message).slice(0, 500) },
      });
      result.failed++;
    }
  }

  return result;
}
