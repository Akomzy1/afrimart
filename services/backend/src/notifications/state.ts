import type { OrderStatus, ShipmentStatus } from "@prisma/client";

/**
 * NTF-1 — the order-state pipeline, and the rule that keeps it honest.
 *
 * Carrier webhooks are retried and can arrive out of order: a "delivered"
 * scan can land before the "in transit" event that logically precedes it.
 * Applying events in arrival order would then show a delivered parcel
 * reverting to in-transit, which is both wrong and alarming to a buyer
 * watching the page.
 *
 * So shipment state is a ratchet. Each status has a rank, and an event may
 * only raise it. `exception` is the one exit from that ordering — it can be
 * set from anywhere, because a problem is news whenever it arrives — but it
 * cannot overwrite `delivered`, since a parcel that has landed has landed.
 */

const SHIPMENT_RANK: Record<ShipmentStatus, number> = {
  pending: 0,
  label_created: 1,
  picked_up: 2,
  in_transit: 3,
  exception: 4,
  delivered: 5,
};

export function shipmentRank(status: ShipmentStatus): number {
  return SHIPMENT_RANK[status];
}

/** True when `next` is a forward move from `current`. */
export function canAdvanceShipment(current: ShipmentStatus, next: ShipmentStatus): boolean {
  if (current === next) return false;
  if (current === "delivered") return false; // terminal: nothing follows arrival
  if (next === "exception") return true; // a problem is always worth recording
  return SHIPMENT_RANK[next] > SHIPMENT_RANK[current];
}

/** Carrier vocabulary varies; map it once, here, rather than at each call site. */
export function mapCarrierStatus(raw: string): ShipmentStatus | null {
  const s = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const map: Record<string, ShipmentStatus> = {
    pre_transit: "label_created",
    label_created: "label_created",
    label_printed: "label_created",
    accepted: "picked_up",
    picked_up: "picked_up",
    collected: "picked_up",
    in_transit: "in_transit",
    out_for_delivery: "in_transit",
    delivered: "delivered",
    available_for_pickup: "in_transit",
    return_to_sender: "exception",
    failure: "exception",
    exception: "exception",
    damaged: "exception",
  };
  return map[s] ?? null;
}

/**
 * An order's status is derived from its parcels rather than stored
 * independently, so the two can never disagree. The weakest parcel decides:
 * an order is only "shipped" once every parcel has moved, and only
 * "delivered" once every parcel has landed.
 */
export function deriveOrderStatus(
  shipmentStatuses: ShipmentStatus[],
  current: OrderStatus,
): OrderStatus {
  if (current === "cancelled") return "cancelled";
  if (!shipmentStatuses.length) return current;

  if (shipmentStatuses.every((s) => s === "delivered")) return "delivered";
  if (shipmentStatuses.every((s) => shipmentRank(s) >= shipmentRank("picked_up"))) return "shipped";
  if (shipmentStatuses.some((s) => shipmentRank(s) >= shipmentRank("picked_up"))) return "shipped";
  if (shipmentStatuses.every((s) => shipmentRank(s) >= shipmentRank("label_created"))) return "packed";
  if (shipmentStatuses.some((s) => shipmentRank(s) >= shipmentRank("label_created"))) return "accepted";
  return current;
}

const ORDER_RANK: Record<OrderStatus, number> = {
  placed: 0,
  accepted: 1,
  packed: 2,
  shipped: 3,
  delivered: 4,
  cancelled: 99,
};

/** The same ratchet at order level. */
export function canAdvanceOrder(current: OrderStatus, next: OrderStatus): boolean {
  if (current === next) return false;
  if (current === "cancelled") return false;
  if (next === "cancelled") return true;
  return ORDER_RANK[next] > ORDER_RANK[current];
}
