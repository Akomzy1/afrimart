import { setTimeout as delay } from "node:timers/promises";
import { prisma } from "../db.js";
import { orderRefFor } from "./render.js";
import { getSenders } from "./senders.js";

export const merchantAlertTemplates = ["merchant-new-order", "merchant-new-order-sms"];

/** Checkout and the background retry may see the same row. Hold its lock until the outcome is saved. */
export async function deliverMerchantAlert(id: string) {
  return prisma.$transaction(async tx => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Notification" WHERE "id" = ${id} AND "status" = 'pending'
      AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
      FOR UPDATE SKIP LOCKED`;
    if (!locked.length) return null;
    const alert = await tx.notification.findUniqueOrThrow({ where: { id } });
    const storeId = alert.recipient;
    const orderId = alert.orderId;
    const senders = getSenders();
    async function finish(status: "sent" | "suppressed" | "failed", reason: string | null) {
      await tx.notification.update({ where: { id }, data: { status, attempts: { increment: 1 },
        lastError: reason, sentAt: status === "sent" ? new Date() : null, nextAttemptAt: null } });
      return status;
    }
    if (!orderId || !await tx.shipment.count({ where: { storeId, orderId, status: "pending", order: { status: { not: "cancelled" } } } })) {
      return finish("suppressed", "This store has no parcels awaiting acceptance for the order.");
    }
    if (alert.channel === "push") {
      let failed = false;
      let accepted = false;
      try { accepted = await senders.push.send({ storeId, title: alert.subject, body: alert.body }); }
      catch { failed = true; }
      if (accepted) return finish("sent", null);
      await tx.notification.createMany({ skipDuplicates: true, data: {
        channel: "sms", template: "merchant-new-order-sms", recipient: storeId, orderId,
        dedupeKey: `sms:new-order:${orderId}:${storeId}`, subject: "New order",
        body: `AfriMart: New order ${orderRefFor(orderId)}. Open Orders in the merchant app to accept or decline.`,
      } });
      return finish(failed ? "failed" : "suppressed", failed ? "Push failed. SMS fallback queued." : "Push unavailable. SMS fallback queued.");
    }
    const store = await tx.store.findUnique({ where: { id: storeId }, select: { ownerPhone: true, ownerPhoneVerifiedAt: true } });
    if (!store?.ownerPhoneVerifiedAt || !store.ownerPhone) return finish("suppressed", "No verified merchant phone.");
    if (!senders.sms.enabled) return finish("suppressed", "SMS delivery is disabled.");
    try {
      await senders.sms.send({ to: store.ownerPhone, body: alert.body });
    } catch {
      const waitSeconds = Math.min(900, 30 * 2 ** Math.min(alert.attempts, 5));
      await tx.notification.update({ where: { id }, data: { attempts: { increment: 1 }, lastError: "SMS send failed.",
        nextAttemptAt: new Date(Date.now() + waitSeconds * 1000) } });
      return "failed" as const;
    }
    if (senders.sms.name === "file") return finish("suppressed", "SMS captured in a local development file.");
    return finish("sent", null);
  }, { timeout: 20000 });
}

export async function runMerchantAlertWorker(signal: AbortSignal) {
  while (!signal.aborted) {
    try {
      const pending = await prisma.notification.findMany({
        where: { template: { in: merchantAlertTemplates }, status: "pending", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }] },
        select: { id: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 100,
      });
      let processed = 0;
      for (const row of pending) {
        if (signal.aborted) return;
        if (await deliverMerchantAlert(row.id)) processed++;
      }
      if (processed) continue;
    } catch { console.warn("Merchant order alerts will retry."); }
    await delay(5000, undefined, { signal, ref: false }).catch(() => undefined);
  }
}
