import { FULFILMENT_FEE_CENTS, TAKE_RATE_BPS } from "../config.js";
import type { RoutingPlan } from "../routing/types.js";

/**
 * PAY-2 / PAY-3 — marketplace splitting.
 *
 * Collect once from the buyer, remit to each fulfilling store net of the take
 * rate. Two things this deliberately does NOT do:
 *
 *   - Charge the store for shipping. The platform buys the labels and absorbs
 *     the multi-parcel cost (CART-5); pushing that onto stores would recreate
 *     per-seller shipping economics the buyer-facing rule exists to prevent.
 *   - Charge the fulfilment fee more than once. It is per *order*, not per
 *     store, so a split order does not quietly cost the platform's sellers
 *     extra because routing failed to concentrate the basket.
 *
 * Tax is collected on the platform's behalf and remitted separately — it is
 * never part of a store's gross.
 */

export interface StoreSplit {
  storeId: string;
  storeName: string;
  grossCents: number;
  takeRateBps: number;
  platformFeeCents: number;
  fulfilmentFeeCents: number;
  netCents: number;
}

export interface PaymentSplit {
  /** What the buyer is charged in total, including shipping and tax. */
  buyerChargeCents: number;
  stores: StoreSplit[];
  /** Commission plus the order fee, before carrier costs. */
  platformGrossCents: number;
  /** Shipping and cold-pack the buyer paid; the platform's, not a store's. */
  logisticsRevenueCents: number;
  carrierCostCents: number;
  /** What the platform keeps once it has paid the carriers. */
  platformNetCents: number;
  taxCollectedCents: number;
}

export function splitPayment(
  plan: RoutingPlan,
  buyerChargeCents: number,
  taxCents: number,
  /**
   * Shipping plus cold pack. Counted here because the platform buys the labels
   * and the refrigerant — leaving it out made every multi-parcel order look far
   * more loss-making than it is, by charging the carrier cost against
   * commission alone while the buyer's contribution went unrecorded.
   */
  logisticsRevenueCents = 0,
): PaymentSplit {
  const grossByStore = new Map<string, { name: string; gross: number }>();
  for (const line of plan.assignment) {
    const entry = grossByStore.get(line.listing.storeId);
    if (entry) entry.gross += line.lineTotalCents;
    else grossByStore.set(line.listing.storeId, { name: line.listing.storeName, gross: line.lineTotalCents });
  }

  // The per-order fulfilment fee is split across stores by revenue share so it
  // is charged exactly once no matter how many parcels routing produced.
  const totalGross = [...grossByStore.values()].reduce((sum, s) => sum + s.gross, 0);

  const stores: StoreSplit[] = [];
  let feeAllocated = 0;
  const entries = [...grossByStore.entries()];

  entries.forEach(([storeId, { name, gross }], index) => {
    const platformFeeCents = Math.round((gross * TAKE_RATE_BPS) / 10000);
    // Last store takes the rounding remainder so the fee sums exactly.
    const fulfilmentFeeCents =
      index === entries.length - 1
        ? FULFILMENT_FEE_CENTS - feeAllocated
        : Math.round(totalGross ? (FULFILMENT_FEE_CENTS * gross) / totalGross : 0);
    feeAllocated += fulfilmentFeeCents;

    stores.push({
      storeId,
      storeName: name,
      grossCents: gross,
      takeRateBps: TAKE_RATE_BPS,
      platformFeeCents,
      fulfilmentFeeCents,
      netCents: gross - platformFeeCents - fulfilmentFeeCents,
    });
  });

  const platformGrossCents = stores.reduce((sum, s) => sum + s.platformFeeCents + s.fulfilmentFeeCents, 0);

  return {
    buyerChargeCents,
    stores,
    platformGrossCents,
    logisticsRevenueCents,
    carrierCostCents: plan.trueShippingCostCents,
    platformNetCents: platformGrossCents + logisticsRevenueCents - plan.trueShippingCostCents,
    taxCollectedCents: taxCents,
  };
}
