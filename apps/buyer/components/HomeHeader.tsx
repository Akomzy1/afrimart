"use client";

import { Logo, CartButton, LocationIcon } from "@afrimart/ui";
import { useCart } from "../app/cart-context";

/** AfriMart Buyer App.html's home header — wordmark + delivery location + cart. */
export function HomeHeader() {
  const { count } = useCart();
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px 4px" }}>
      <div>
        <Logo tone="on-light" size={24} />
        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "11.5px", color: "var(--ink-3)", marginTop: 3 }}>
          <LocationIcon style={{ width: 12, height: 12, color: "var(--amber-ink)" }} />
          Deliver to · Houston, TX
        </div>
      </div>
      <CartButton count={count} />
    </div>
  );
}
