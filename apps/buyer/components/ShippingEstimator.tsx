"use client";

import { useState } from "react";
import { LocationIcon, ShippingProgress } from "@afrimart/ui";

export interface ShippingEstimatorProps {
  shippingDays: string;
  metro: string;
}

/**
 * "Delivery to you" block on product detail. Arrival-date math and the
 * free-shipping progress bar are placeholders — real carrier rate-shopping
 * (CART-4, CART-8) and an itemized cart subtotal land with checkout in
 * Prompt 4/8, not here.
 */
export function ShippingEstimator({ shippingDays, metro }: ShippingEstimatorProps) {
  const [zip, setZip] = useState("77002");
  const [arrival, setArrival] = useState(() => estimate(shippingDays));

  function estimate(days: string) {
    const extra = days.startsWith("3") ? 5 : 2;
    const d = new Date();
    d.setDate(d.getDate() + extra);
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }

  return (
    <div className="block est">
      <div className="bt">Delivery to you</div>
      <div className="field">
        <div className="box">
          <LocationIcon />
          <input value={zip} onChange={(e) => setZip(e.target.value)} placeholder="Enter ZIP code" inputMode="numeric" maxLength={5} />
        </div>
        <button type="button" className="go" onClick={() => setArrival(estimate(shippingDays))}>
          Check
        </button>
      </div>
      <div className="result">
        <div className="arr">
          Arrives <b>{arrival}</b>
        </div>
        <div style={{ marginTop: 4 }}>
          Ships in {shippingDays} from {metro}
        </div>
      </div>
      <div style={{ marginTop: 14 }}>
        <ShippingProgress subtotalCents={8600} thresholdCents={10000} />
      </div>
    </div>
  );
}
