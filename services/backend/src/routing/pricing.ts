import {
  blendedShippingCents,
  coldPackCents,
  EXCEPTIONAL_SPLIT_PARCELS,
  FREE_SHIPPING_THRESHOLD_CENTS,
} from "../config.js";
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
  /**
   * The single blended figure for the ambient side. Never per-parcel, never
   * per-seller. Cold parcels are not in here — see coldPackCents.
   */
  shippingCents: number;
  /**
   * One cold-chain line for the whole order, charged whatever the basket is
   * worth. Covers the cold parcels' transport, packaging and refrigerant.
   */
  coldPackCents: number;
  taxCents: number;
  totalCents: number;
  /** The ambient subtotal only — cold goods never count toward the threshold. */
  ambientSubtotalCents: number;
  chilledSubtotalCents: number;
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

  // Two cost categories, not five sellers. Shipping covers the ambient side and
  // can be absorbed above the threshold; cold chain is its own line and never
  // is, because a perishable box costs more than any sane threshold can hide.
  const ambientParcels = plan.parcels.filter((p) => p.temperatureClass === "ambient");
  const coldParcels = plan.parcels.filter((p) => p.temperatureClass !== "ambient");

  const subtotalOf = (parcels: Parcel[]) =>
    parcels.reduce((sum, p) => sum + p.lines.reduce((s, l) => s + l.lineTotalCents, 0), 0);
  const ambientSubtotalCents = subtotalOf(ambientParcels);
  const chilledSubtotalCents = subtotalOf(coldParcels);

  // CART-5: the threshold reads the ambient subtotal alone. Cold goods must not
  // buy their way past it — that was the hole that made a $105 basket with a
  // chilled parcel ship for nothing against $64 of carrier cost.
  const freeShippingApplied = ambientSubtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS;
  const shippingCents =
    ambientParcels.length === 0 || freeShippingApplied ? 0 : blendedShippingCents(ambientParcels.length);
  const coldPack = coldPackCents(coldParcels.length);

  const taxCents = estimateTaxCents(itemsSubtotalCents + shippingCents + coldPack, destinationState);

  return {
    itemsSubtotalCents,
    shippingCents,
    coldPackCents: coldPack,
    taxCents,
    totalCents: itemsSubtotalCents + shippingCents + coldPack + taxCents,
    ambientSubtotalCents,
    chilledSubtotalCents,
    freeShippingApplied,
    centsToFreeShipping: Math.max(0, FREE_SHIPPING_THRESHOLD_CENTS - ambientSubtotalCents),
    shippingMarginCents: shippingCents + coldPack - plan.trueShippingCostCents,
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
