import { EXCEPTIONAL_SPLIT_PARCELS } from "../config.js";
import { estimateTaxCents } from "../tax.js";
import type { Parcel, RoutingPlan } from "./types.js";

/**
 * CART-5 and CART-6 — what the buyer is actually shown.
 *
 * Shipping is pass-through. The buyer pays the sum of the live carrier quotes
 * for their parcels, and the cold-pack line is the actual cost of insulated
 * packaging and coolant. The platform absorbs nothing and marks up nothing;
 * there is no threshold and no blended schedule to tune.
 *
 * The presentation invariant survives unchanged, and is the thing to protect:
 * at most ONE shipping line and ONE cold-pack line, whatever the routing did
 * behind them. Two cost categories — never a line per seller or per parcel.
 * Anything that divides either figure for display is a bug.
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
  /** One line: the sum of every parcel's carrier quote. */
  shippingCents: number;
  /** One line: insulated packaging and coolant across chilled parcels, at cost. */
  coldPackCents: number;
  taxCents: number;
  totalCents: number;
  /**
   * Zero by construction under pass-through, and asserted in tests. If this is
   * ever non-zero the platform has started absorbing or marking up shipping,
   * which CART-5 forbids.
   */
  shippingMarginCents: number;
  parcelCount: number;
  coldParcelCount: number;
  /** Three or more parcels — reported so the frequency can be seen, never blocked. */
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

  // Pass-through: exactly what the carriers quoted, and exactly what the
  // packaging costs. No threshold, no blending, no markup.
  const shippingCents = plan.trueShippingCostCents;
  const coldPackCents = plan.trueColdPackCostCents;
  const coldParcelCount = plan.parcels.filter((p) => p.temperatureClass !== "ambient").length;

  const taxCents = estimateTaxCents(itemsSubtotalCents + shippingCents + coldPackCents, destinationState);

  return {
    itemsSubtotalCents,
    shippingCents,
    coldPackCents,
    taxCents,
    totalCents: itemsSubtotalCents + shippingCents + coldPackCents + taxCents,
    shippingMarginCents: shippingCents + coldPackCents - (plan.trueShippingCostCents + plan.trueColdPackCostCents),
    parcelCount: plan.parcels.length,
    coldParcelCount,
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
