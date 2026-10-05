import { prisma } from "../db.js";
import { canAdvanceOrder, canAdvanceShipment, deriveOrderStatus, mapCarrierStatus } from "./state.js";
import { enqueue } from "./outbox.js";
import { renderEmail, shippedTemplateFor, subjectFor, type EmailItem } from "./render.js";

/**
 * NTF-1/NTF-2/NTF-3 — carrier events in, order state and notifications out.
 *
 * Everything here runs inside one transaction per event: the event record,
 * the state change and the queued emails commit together or not at all. The
 * send happens afterwards, from the outbox.
 */

export interface TrackingEvent {
  provider: string;
  /** The carrier's own id for this event — the deduplication key. */
  providerEventId: string;
  shipmentId: string;
  status: string;
  occurredAt: Date;
  carrier?: string;
  trackingNumber?: string;
  payload?: unknown;
}

export interface HandleResult {
  applied: boolean;
  reason?: string;
  shipmentStatus?: string;
  orderStatus?: string;
  queued: string[];
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function itemsFor(items: { nameSnapshot: string; packSizeSnapshot: string; quantity: number; unitPriceCents: number; lineTotalCents: number }[], sellerName: string): EmailItem[] {
  return items.map((i) => ({
    name: i.nameSnapshot,
    subtitle: `${i.packSizeSnapshot} · ${sellerName}`,
    lineTotal: money(i.lineTotalCents),
    quantityLine: `${i.quantity} × ${money(i.unitPriceCents)}`,
  }));
}

/**
 * Applies one carrier event.
 *
 * Three ways an event is accepted but not applied, each returned rather than
 * thrown because none of them is an error:
 *   - already seen (a retry)
 *   - a status we do not model
 *   - a backwards move (an out-of-order delivery scan)
 */
export async function handleTrackingEvent(event: TrackingEvent): Promise<HandleResult> {
  const mapped = mapCarrierStatus(event.status);

  // Deduplicate first, outside the work: a replayed webhook should cost a
  // single unique-constraint failure, not a re-render of every email.
  try {
    await prisma.webhookEvent.create({
      data: {
        provider: event.provider,
        providerEventId: event.providerEventId,
        shipmentId: event.shipmentId,
        rawStatus: event.status,
        occurredAt: event.occurredAt,
        payload: (event.payload ?? {}) as object,
      },
    });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") {
      return { applied: false, reason: "duplicate", queued: [] };
    }
    throw e;
  }

  if (!mapped) {
    await prisma.webhookEvent.update({
      where: { providerEventId: event.providerEventId },
      data: { processedAt: new Date(), ignoredReason: `unmapped carrier status "${event.status}"` },
    });
    return { applied: false, reason: "unmapped", queued: [] };
  }

  const shipment = await prisma.shipment.findUnique({
    where: { id: event.shipmentId },
    include: {
      items: true,
      store: { include: { hubMetro: true } },
      order: { include: { buyer: true, shipments: { orderBy: { createdAt: "asc" } } } },
    },
  });
  if (!shipment) return { applied: false, reason: "unknown shipment", queued: [] };

  if (!canAdvanceShipment(shipment.status, mapped)) {
    // The out-of-order case: a delivered parcel must not revert to in-transit.
    await prisma.webhookEvent.update({
      where: { providerEventId: event.providerEventId },
      data: {
        processedAt: new Date(),
        ignoredReason: `would move ${shipment.status} -> ${mapped}, which is not forward`,
      },
    });
    return { applied: false, reason: "out-of-order", shipmentStatus: shipment.status, queued: [] };
  }

  const parcels = shipment.order.shipments;
  const total = parcels.length;
  const index = parcels.findIndex((p) => p.id === shipment.id) + 1;
  // CART-6 / the email spec: no enumeration when there is only one parcel.
  const parcelLabel = total > 1 ? `Parcel ${index} of ${total}` : null;
  const orderRef = `AM-${shipment.orderId.slice(-7).toUpperCase()}`;
  const queued: string[] = [];

  await prisma.$transaction(async (tx) => {
    await tx.shipment.update({
      where: { id: shipment.id },
      data: {
        status: mapped,
        ...(event.carrier ? { carrier: event.carrier } : {}),
        ...(event.trackingNumber ? { trackingNumber: event.trackingNumber } : {}),
      },
    });

    const statuses = parcels.map((p) => (p.id === shipment.id ? mapped : p.status));
    const nextOrder = deriveOrderStatus(statuses, shipment.order.status);
    if (canAdvanceOrder(shipment.order.status, nextOrder)) {
      await tx.order.update({ where: { id: shipment.orderId }, data: { status: nextOrder } });
    }

    // NTF-2 — one email per parcel per state, enforced by the dedupe key.
    if (mapped === "picked_up") {
      const template = shippedTemplateFor(index, total);
      const ctx = {
        orderRef,
        parcelLabel,
        carrier: event.carrier ?? shipment.carrier ?? "",
        trackingNumber: event.trackingNumber ?? shipment.trackingNumber ?? "",
        items: itemsFor(shipment.items, shipment.store.name),
      };
      if (
        await enqueue(tx, {
          channel: "email",
          template,
          recipient: shipment.order.buyer.email,
          subject: subjectFor(template, ctx),
          body: await renderEmail(template, ctx),
          dedupeKey: `email:shipped:${shipment.id}`,
          orderId: shipment.orderId,
          shipmentId: shipment.id,
        })
      ) {
        queued.push(template);
      }
    }

    // Delivered is an order-level email: it fires once, when the last parcel
    // lands, not once per parcel.
    if (mapped === "delivered" && statuses.every((s) => s === "delivered")) {
      const ctx = {
        orderRef,
        items: shipment.order.shipments.flatMap(() => []) as EmailItem[],
      };
      const all = await tx.shipmentItem.findMany({ where: { shipment: { orderId: shipment.orderId } } });
      ctx.items = all.map((i) => ({
        name: i.nameSnapshot,
        subtitle: i.packSizeSnapshot,
        lineTotal: money(i.lineTotalCents),
        quantityLine: `${i.quantity} × ${money(i.unitPriceCents)}`,
      }));
      if (
        await enqueue(tx, {
          channel: "email",
          template: "delivered",
          recipient: shipment.order.buyer.email,
          subject: subjectFor("delivered", ctx),
          body: await renderEmail("delivered", ctx),
          dedupeKey: `email:delivered:${shipment.orderId}`,
          orderId: shipment.orderId,
        })
      ) {
        queued.push("delivered");
      }
    }

    await tx.webhookEvent.update({
      where: { providerEventId: event.providerEventId },
      data: { processedAt: new Date() },
    });
  });

  const after = await prisma.order.findUnique({ where: { id: shipment.orderId } });
  return { applied: true, shipmentStatus: mapped, orderStatus: after?.status, queued };
}

/**
 * NTF-2 — order confirmation, queued when the order is placed rather than by
 * a webhook. Chilled orders get the variant that explains the cold-pack line.
 */
export async function queueOrderConfirmation(
  tx: Parameters<typeof enqueue>[0],
  orderId: string,
): Promise<string | null> {
  // Read through `tx`, not the global client. The order was created inside
  // this same uncommitted transaction, so a global read cannot see it yet and
  // would silently queue nothing — which is exactly how the confirmation
  // email went missing the first time this ran.
  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: { buyer: true, shipments: { include: { items: true, store: true } } },
  });
  if (!order) return null;

  const hasChilled = order.shipments.some((s) => s.temperatureClass !== "ambient");
  const template = hasChilled ? "order-confirmed" : "order-confirmed-no-chilled";
  const orderRef = `AM-${order.id.slice(-7).toUpperCase()}`;
  const ctx = {
    orderRef,
    parcelLabel: order.shipments.length > 1 ? `Parcel 1 of ${order.shipments.length}` : null,
    paymentMethod: "card on file",
    items: order.shipments.flatMap((s) => itemsFor(s.items, s.store.name)),
  };

  const ok = await enqueue(tx, {
    channel: "email",
    template,
    recipient: order.buyer.email,
    subject: subjectFor(template, ctx),
    body: await renderEmail(template, ctx),
    dedupeKey: `email:confirmed:${order.id}`,
    orderId: order.id,
  });
  return ok ? template : null;
}

/** Merchant web push for a new order. One per shipment, deduped the same way. */
export async function queueMerchantAlert(
  tx: Parameters<typeof enqueue>[0],
  shipmentId: string,
  storeId: string,
  itemCount: number,
): Promise<boolean> {
  return enqueue(tx, {
    channel: "push",
    template: "merchant-new-order",
    recipient: storeId,
    subject: "New order",
    body: `${itemCount} ${itemCount === 1 ? "item" : "items"} to pack.`,
    dedupeKey: `push:new-order:${shipmentId}`,
    shipmentId,
  });
}
