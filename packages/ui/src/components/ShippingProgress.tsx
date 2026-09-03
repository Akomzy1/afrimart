export interface ShippingProgressProps {
  /** Current subtotal, in cents. */
  subtotalCents: number;
  /** PRD CART-5 — the free-shipping threshold, in cents. */
  thresholdCents: number;
}

const fmt = (cents: number) => `$${(cents / 100).toFixed(0)}`;

/** "You're $14 away from free shipping" — CART-5's single blended-fee promise, made visible. */
export function ShippingProgress({ subtotalCents, thresholdCents }: ShippingProgressProps) {
  const remaining = Math.max(0, thresholdCents - subtotalCents);
  const pct = Math.min(100, Math.round((subtotalCents / thresholdCents) * 100));
  return (
    <div className="ship">
      <div className="top">
        <div className="a">
          {remaining > 0 ? (
            <>
              You&apos;re <b>{fmt(remaining)}</b> away from free shipping
            </>
          ) : (
            <b>Free shipping unlocked</b>
          )}
        </div>
        <div className="b">
          {fmt(subtotalCents)} / {fmt(thresholdCents)}
        </div>
      </div>
      <div className="track">
        <div className="fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
