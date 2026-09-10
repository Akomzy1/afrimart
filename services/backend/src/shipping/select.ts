import type { RateQuote } from "./carrier.js";

/**
 * FUL-2 — least-cost carrier selection that meets the promised arrival window.
 *
 * The window is the binding constraint, not a preference: the cheapest quote
 * that misses it is not a candidate at all. Only when nothing meets the window
 * do we fall back, and then to the fastest available rather than the cheapest,
 * because at that point arrival is what is at risk.
 */
export interface CarrierChoice {
  quote: RateQuote;
  /** True when no quote met the window and we fell back to the fastest. */
  missedWindow: boolean;
}

export function selectCarrier(quotes: RateQuote[], maxTransitDays: number): CarrierChoice | null {
  if (!quotes.length) return null;

  const withinWindow = quotes.filter((q) => q.transitDays <= maxTransitDays);
  if (withinWindow.length) {
    const best = withinWindow.reduce((a, b) =>
      b.costCents < a.costCents || (b.costCents === a.costCents && b.transitDays < a.transitDays) ? b : a,
    );
    return { quote: best, missedWindow: false };
  }

  const fastest = quotes.reduce((a, b) =>
    b.transitDays < a.transitDays || (b.transitDays === a.transitDays && b.costCents < a.costCents) ? b : a,
  );
  return { quote: fastest, missedWindow: true };
}

/**
 * CART-3 drives this: a perishable parcel has a much tighter safe window than
 * an ambient one. CART-4 (blocking infeasible perishables on a live carrier
 * query) is Phase 2, so this only shapes carrier choice today.
 */
export function windowForTemperature(temperatureClass: string): number {
  return temperatureClass === "ambient" ? 6 : 2;
}
