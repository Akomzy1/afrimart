"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

/**
 * Client-side-only cart count for this screen set (Prompt 3: catalogue and
 * search, PRD 6.3/6.4). Real persisted Cart/CartItem mutations land with
 * cart and checkout in Prompt 4 — this just drives the header badge and
 * toast so the browse/product screens feel real without getting ahead of
 * the build sequence.
 */
interface CartContextValue {
  count: number;
  add: (quantity?: number) => void;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [count, setCount] = useState(2);
  return <CartContext.Provider value={{ count, add: (q = 1) => setCount((c) => c + q) }}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within a CartProvider");
  return ctx;
}
