import { blendedShippingCents, EXCEPTIONAL_SPLIT_PARCELS, FREE_SHIPPING_THRESHOLD_CENTS } from "../config.js";
import { estimateTaxCents } from "../tax.js";
import type { Parcel, RoutingPlan } from "./types.js";

/**
 * CART-5 and CART-6 — what the buyer is actually shown.
 *
 * The invariant this file exists to protect: the buyer sees exactly one
 * shipping number for the whole order, whatever the routing engine did behind
 * it. Two parcels from two metros still produce one charge. Anything that
 * divides shipping by parcel or by seller is a bug, not a refinement.
 */

export interface ParcelDisclosure {
  storeName: string;
  metro: string;
  temperatureClass: string;
  itemCount: number;
  estimatedDelivery: Date;
  /** Buyer-facing reason this is its own parcel, per CART-3/CART-6. */
  reason: string;
}

export interface OrderPricing {
  itemsSubtotalCents: number;
  /** The single blended figure. Never per-parcel, never per-seller. */
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  freeShippingApplied: boolean;
  centsToFreeShipping: number;
  /** Platform-side only: what we pay carriers versus what we charged. */
  shippingMarginCents: number;
  parcelCount: number;
  /**
   * True when the engine could only satisfy this basket with three or more
   * parcels. Reported, never blocked — we want the frequency before deciding
   * whether to cap it.
   */
  exceptionalSplit: boolean;
  parcels: ParcelDisclosure[];
}

function reasonFor(parcel: Parcel, allParcels: Parcel[]): string {
  const sameStoreOtherTemp = allParcels.some(
    (p) => p !== parcel && p.storeId === parcel.storeId && p.temperatureClass !== parcel.temperatureClass,
  );
  if (sameStoreOtherTemp) {
    return parcel.temperatureClass === "ambient"
      ? "Ships separately from the chilled items — they travel differently."
      : "Ships cold and separately, to arrive in good condition.";
  }
  return `Ships from ${parcel.storeName} in ${parcel.metro}.`;
}

export function priceOrder(plan: RoutingPlan, destinationState: string): OrderPricing {
  const itemsSubtotalCents = plan.itemsSubtotalCents;

  // CART-5: above the threshold the platform absorbs the true multi-parcel
  // cost entirely; below it the buyer sees ONE blended charge — a single
  // figure, but one that reflects how many parcels this basket actually needs.
  const freeShippingApplied = itemsSubtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS;
  const shippingCents = freeShippingApplied ? 0 : blendedShippingCents(plan.parcels.length);

  const taxCents = estimateTaxCents(itemsSubtotalCents + shippingCents, destinationState);

  return {
    itemsSubtotalCents,
    shippingCents,
    taxCents,
    totalCents: itemsSubtotalCents + shippingCents + taxCents,
    freeShippingApplied,
    centsToFreeShipping: Math.max(0, FREE_SHIPPING_THRESHOLD_CENTS - itemsSubtotalCents),
    shippingMarginCents: shippingCents - plan.trueShippingCostCents,
    parcelCount: plan.parcels.length,
    exceptionalSplit: plan.parcels.length >= EXCEPTIONAL_SPLIT_PARCELS,
    // CART-6: disclose parcel count and estimated dates, never hide the split.
    parcels: plan.parcels.map((p) => ({
      storeName: p.storeName,
      metro: p.metro,
      temperatureClass: p.temperatureClass,
      itemCount: p.lines.reduce((sum, l) => sum + l.quantity, 0),
      estimatedDelivery: p.estimatedDelivery,
      reason: reasonFor(p, plan.parcels),
    })),
  };
}
