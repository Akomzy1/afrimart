/**
 * FUL-1 — the multi-carrier shipping port.
 *
 * The PRD names EasyPost as the provider (INT-1) and treats it as the entire
 * logistics layer: rates, labels, address validation, tracking. That makes it
 * the one integration most likely to be swapped or mocked, so routing talks to
 * this interface and never to a vendor SDK. `LocalCarrierGateway` below is a
 * deterministic stand-in used until credentials exist; the real adapter
 * implements the same three methods and nothing upstream changes.
 */

import type { TemperatureClass } from "@prisma/client";

export interface ParcelSpec {
  /** Origin hub metro, e.g. "Houston". FUL-3 — ambient ships nationwide from hubs. */
  fromMetro: string;
  toZip: string;
  weightOz: number;
  temperatureClass: TemperatureClass;
}

export interface RateQuote {
  carrier: string;
  service: string;
  costCents: number;
  transitDays: number;
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

export interface CarrierGateway {
  /** CART-8 — real-time rate shopping across carriers. */
  rates(spec: ParcelSpec): Promise<RateQuote[]>;
  validateAddress(address: AddressInput): Promise<AddressValidation>;
}

/** Rough zone model: hub metro to destination region. Stands in for real distance. */
const METRO_REGION: Record<string, string> = {
  Houston: "south",
  Dallas: "south",
  Atlanta: "south",
  Bronx: "northeast",
  Brooklyn: "northeast",
  "New York": "northeast",
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
 * Deterministic local gateway. Prices rise with weight and zone distance, and
 * perishables cost more and move faster, which is enough to exercise least-cost
 * selection (FUL-2) and the arrival-window constraint honestly in tests.
 */
export class LocalCarrierGateway implements CarrierGateway {
  async rates(spec: ParcelSpec): Promise<RateQuote[]> {
    const from = METRO_REGION[spec.fromMetro] ?? "midwest";
    const to = regionForZip(spec.toZip);
    const zoneHops = from === to ? 0 : 2;
    const pounds = Math.max(1, Math.ceil(spec.weightOz / 16));
    const perishable = spec.temperatureClass !== "ambient";

    const base = 600 + pounds * 95 + zoneHops * 240;
    const quotes: RateQuote[] = [
      { carrier: "USPS", service: "Ground Advantage", costCents: base, transitDays: 3 + zoneHops },
      { carrier: "UPS", service: "Ground", costCents: Math.round(base * 1.12), transitDays: 2 + zoneHops },
      { carrier: "FedEx", service: "2Day", costCents: Math.round(base * 1.85), transitDays: 2 },
      { carrier: "UPS", service: "Next Day Air", costCents: Math.round(base * 3.1), transitDays: 1 },
    ];

    // Perishables carry the insulated-packaging surcharge and cannot go ground.
    if (perishable) {
      return quotes
        .filter((q) => q.transitDays <= 2)
        .map((q) => ({ ...q, costCents: q.costCents + 850 }));
    }
    return quotes;
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
}
