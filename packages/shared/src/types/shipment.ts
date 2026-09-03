import type { ID, TemperatureClass, Timestamps } from "./common";

export type ShipmentStatus =
  | "pending"
  | "label-created"
  | "picked-up"
  | "in-transit"
  | "delivered"
  | "exception";

/**
 * A single dispatched package from one Store in one temperature stream. PRD 9: Shipment/Parcel.
 * CART-3 makes the temperature split mandatory: ambient and perishable items are always
 * separate Shipments, even within the same Order and the same Store.
 */
export interface Shipment extends Timestamps {
  id: ID;
  orderId: ID;
  storeId: ID;
  temperatureClass: TemperatureClass;
  carrier?: string;
  trackingNumber?: string;
  labelUrl?: string;
  status: ShipmentStatus;
  estimatedDelivery?: string;
  /** PRD QC-2 — packing photo confirmation, the evidence trail for every shipment. */
  packingPhotoUrl?: string;
}
