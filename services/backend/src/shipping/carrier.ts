/**
 * FUL-1 / FUL-9 — the multi-carrier shipping port.
 *
 * The PRD names EasyPost as the provider (INT-1) and treats it as the entire
 * logistics layer: rates, labels, address validation, tracking. Two rules make
 * this an interface rather than a direct SDK call:
 *
 *   - It is the single most swappable integration, so routing talks to the
 *     port and never to a vendor.
 *   - FUL-9 requires that every label is platform-issued. Keeping label
 *     creation behind this interface is what makes that enforceable: there is
 *     no seller-facing path to a carrier account anywhere in the codebase.
 *
 * `LocalCarrierGateway` is a deterministic stand-in until credentials exist.
 */

import type { TemperatureClass } from "@prisma/client";
import { DIM_DIVISOR } from "../config.js";

/** CAT-5 — physical dimensions in inches, needed for dimensional weight. */
export interface Dimensions {
  lengthIn: number;
  widthIn: number;
  heightIn: number;
}

export interface ParcelSpec {
  /** Origin hub metro, e.g. "Houston". FUL-3 — ambient ships nationwide from hubs. */
  fromMetro: string;
  toZip: string;
  weightOz: number;
  dimensions: Dimensions;
  temperatureClass: TemperatureClass;
}

export interface RateQuote {
  carrier: string;
  service: string;
  /** Transport only. Cold-pack materials are quoted separately. */
  costCents: number;
  transitDays: number;
  /** What the carrier actually billed on: max(actual, dimensional). */
  billableWeightOz: number;
}

export interface AddressInput {
  street: string;
  city: string;
  state: string;
  zip: string;
}

/** FUL-4 — address validation, to reduce failed deliveries. */
export interface AddressValidation {
  valid: boolean;
  normalized?: AddressInput;
  issues: string[];
}

/**
 * PAY-9 — a post-delivery billing correction from the carrier, typically
 * because declared weight or dimensions were wrong. Charged back to the seller
 * who declared them.
 */
export interface CarrierAdjustment {
  carrierReference: string;
  shipmentTrackingNumber: string;
  amountCents: number;
  reason: string;
  declaredWeightOz: number;
  actualWeightOz: number;
}

export interface CarrierGateway {
  /** CART-8 — real-time rate shopping across carriers. */
  rates(spec: ParcelSpec): Promise<RateQuote[]>;
  /**
   * CART-5 — insulated packaging and coolant for one chilled parcel, at cost.
   * Separate from the carrier rate because the buyer is shown it as its own
   * line, and because the platform buys these materials, not the carrier.
   */
  coldPackCostCents(spec: ParcelSpec): Promise<number>;
  validateAddress(address: AddressInput): Promise<AddressValidation>;
  /** PAY-9 — adjustments the carrier has raised since the given time. */
  adjustmentsSince(since: Date): Promise<CarrierAdjustment[]>;
}

/** CAT-5 — cubic inches over the divisor, converted to ounces. */
export function dimensionalWeightOz(d: Dimensions): number {
  const cubicInches = d.lengthIn * d.widthIn * d.heightIn;
  return (cubicInches / DIM_DIVISOR) * 16;
}

/** Carriers bill the greater of the two. */
export function billableWeightOz(actualOz: number, d: Dimensions): number {
  return Math.max(actualOz, dimensionalWeightOz(d));
}

/** Rough zone model: hub metro to destination region. Stands in for real distance. */
const METRO_REGION: Record<string, string> = {
  Houston: "south",
  Dallas: "south",
  Atlanta: "south",
  Bronx: "northeast",
  Brooklyn: "northeast",
  "New York": "northeast",
  Newark: "northeast",
  Washington: "northeast",
  Chicago: "midwest",
  Minneapolis: "midwest",
  "Los Angeles": "west",
  Oakland: "west",
  Seattle: "west",
};

/** First digit of a US zip maps roughly east-to-west. */
function regionForZip(zip: string): string {
  const lead = zip.trim()[0];
  if (["0", "1"].includes(lead)) return "northeast";
  if (["2", "3"].includes(lead)) return "south";
  if (["4", "5", "6"].includes(lead)) return "midwest";
  if (["7"].includes(lead)) return "south";
  return "west";
}

/**
 * Deterministic local gateway. Prices rise with billable weight and zone
 * distance, and perishables move faster, which is enough to exercise least-cost
 * selection (FUL-2) and pass-through pricing honestly in tests.
 *
 * PROVISIONAL NUMBERS throughout — replace with real EasyPost quotes and real
 * packaging costs before charging anyone.
 */
export class LocalCarrierGateway implements CarrierGateway {
  async rates(spec: ParcelSpec): Promise<RateQuote[]> {
    const from = METRO_REGION[spec.fromMetro] ?? "midwest";
    const to = regionForZip(spec.toZip);
    const zoneHops = from === to ? 0 : 2;
    const billableOz = billableWeightOz(spec.weightOz, spec.dimensions);
    const pounds = Math.max(1, Math.ceil(billableOz / 16));

    const base = 600 + pounds * 95 + zoneHops * 240;
    const quotes: RateQuote[] = [
      { carrier: "USPS", service: "Ground Advantage", costCents: base, transitDays: 3 + zoneHops, billableWeightOz: billableOz },
      { carrier: "UPS", service: "Ground", costCents: Math.round(base * 1.12), transitDays: 2 + zoneHops, billableWeightOz: billableOz },
      { carrier: "FedEx", service: "2Day", costCents: Math.round(base * 1.85), transitDays: 2, billableWeightOz: billableOz },
      { carrier: "UPS", service: "Next Day Air", costCents: Math.round(base * 3.1), transitDays: 1, billableWeightOz: billableOz },
    ];

    // A perishable cannot go ground; the cold-pack materials are priced
    // separately via coldPackCostCents, not folded into the carrier rate.
    if (spec.temperatureClass !== "ambient") return quotes.filter((q) => q.transitDays <= 2);
    return quotes;
  }

  async coldPackCostCents(spec: ParcelSpec): Promise<number> {
    if (spec.temperatureClass === "ambient") return 0;
    // Insulated liner priced on box volume, plus coolant on weight. Frozen
    // needs dry ice rather than gel packs, which costs more.
    const cubicInches = spec.dimensions.lengthIn * spec.dimensions.widthIn * spec.dimensions.heightIn;
    const liner = 450 + Math.round(cubicInches * 0.9);
    const coolantPerLb = spec.temperatureClass === "frozen" ? 180 : 110;
    const coolant = Math.round((spec.weightOz / 16) * coolantPerLb);
    return liner + coolant;
  }

  async validateAddress(address: AddressInput): Promise<AddressValidation> {
    const issues: string[] = [];
    if (!/^\d{5}(-\d{4})?$/.test(address.zip.trim())) issues.push("ZIP code must be 5 digits.");
    if (!address.street.trim()) issues.push("Street address is required.");
    if (!address.city.trim()) issues.push("City is required.");
    if (!/^[A-Za-z]{2}$/.test(address.state.trim())) issues.push("State must be a 2-letter code.");

    if (issues.length) return { valid: false, issues };
    return {
      valid: true,
      issues: [],
      normalized: {
        street: address.street.trim(),
        city: address.city.trim(),
        state: address.state.trim().toUpperCase(),
        zip: address.zip.trim(),
      },
    };
  }

  /**
   * PAY-9 — stubbed. The real feed is EasyPost's billing-adjustment webhook or
   * a periodic reconciliation pull; the shape above is what the chargeback
   * logic consumes, so wiring the real source changes nothing downstream.
   */
  async adjustmentsSince(_since: Date): Promise<CarrierAdjustment[]> {
    return [];
  }
}
