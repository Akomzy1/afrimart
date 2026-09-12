import type { CarrierGateway } from "../shipping/carrier.js";
import { selectCarrier, windowForTemperature } from "../shipping/select.js";
import { selectStores } from "./select.js";
import type { AssignedLine, BasketLine, CandidateListing, Parcel, RoutingPlan } from "./types.js";

/**
 * The routing engine. Order of operations matters and is not arbitrary:
 *
 *   1. CART-2 picks *which store* fulfils each line, preferring one store.
 *   2. CART-3 then splits that assignment by temperature — a mandatory split
 *      that no cost consideration may override.
 *   3. CART-8 rate-shops each resulting parcel, FUL-2 picks the carrier.
 *
 * Doing (2) before (1) would be wrong: it would let a temperature split decide
 * the store, when the PRD makes store concentration the first-order goal and
 * temperature separation a constraint applied to whatever store wins.
 */

function addDays(from: Date, days: number): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return d;
}

function groupIntoParcelGroups(assignment: AssignedLine[]): Map<string, AssignedLine[]> {
  const groups = new Map<string, AssignedLine[]>();
  for (const line of assignment) {
    // CART-3: store AND temperature together form the parcel key.
    const key = `${line.listing.storeId}|${line.listing.temperatureClass}`;
    const existing = groups.get(key);
    if (existing) existing.push(line);
    else groups.set(key, [line]);
  }
  return groups;
}

export interface RouteOptions {
  toZip: string;
  now?: Date;
}

export async function route(
  lines: BasketLine[],
  pool: CandidateListing[],
  carrier: CarrierGateway,
  options: RouteOptions,
): Promise<RoutingPlan> {
  const now = options.now ?? new Date();
  const selection = selectStores(lines, pool);

  const itemsSubtotalCents = selection.assignment.reduce((sum, l) => sum + l.lineTotalCents, 0);
  const groups = groupIntoParcelGroups(selection.assignment);

  const parcels: Parcel[] = [];
  for (const group of groups.values()) {
    const head = group[0].listing;
    const weightOz = group.reduce((sum, l) => sum + l.listing.shippingWeightOz * l.quantity, 0);

    const quotes = await carrier.rates({
      fromMetro: head.metro,
      toZip: options.toZip,
      weightOz,
      temperatureClass: head.temperatureClass,
    });
    const choice = selectCarrier(quotes, windowForTemperature(head.temperatureClass));
    if (!choice) throw new Error(`No carrier rates available from ${head.metro} to ${options.toZip}.`);

    parcels.push({
      storeId: head.storeId,
      storeName: head.storeName,
      metro: head.metro,
      temperatureClass: head.temperatureClass,
      lines: group,
      weightOz,
      carrierCostCents: choice.quote.costCents,
      carrier: choice.quote.carrier,
      service: choice.quote.service,
      transitDays: choice.quote.transitDays,
      estimatedDelivery: addDays(now, choice.quote.transitDays),
      missedWindow: choice.missedWindow,
    });
  }

  // Earliest-arriving parcel first, so disclosure reads in the order things land.
  parcels.sort((a, b) => a.estimatedDelivery.getTime() - b.estimatedDelivery.getTime());

  const storeCount = new Set(selection.assignment.map((l) => l.listing.storeId)).size;

  return {
    assignment: selection.assignment,
    parcels,
    itemsSubtotalCents,
    trueShippingCostCents: parcels.reduce((sum, p) => sum + p.carrierCostCents, 0),
    singleStore: selection.singleStore,
    storeCount,
    singleStorePremiumCents: Math.max(0, itemsSubtotalCents - selection.cheapestPossibleCents),
    unfulfillable: selection.unfulfillable,
    blockedByVerification: selection.blockedByVerification,
  };
}
