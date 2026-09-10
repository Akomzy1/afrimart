"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { ProductGlyphKind } from "@afrimart/ui";

/**
 * Client-side cart for the cart/checkout screens. There is no cart or order
 * router on the backend yet (only catalogue and health), so nothing here is
 * persisted — the prototype models the same way. Swapping this for real
 * Cart/CartItem mutations is a backend task, not a layout one.
 *
 * Routing rules this encodes, per PRD:
 * - CART-2 single-store-preferring: lines already sourced from one seller stay
 *   together; parcels are grouped by origin metro, so one origin means one parcel.
 * - CART-3 temperature is a *mandatory* split: `temperature` is carried on every
 *   line and grouped on before origin. Every seeded line is currently `ambient`,
 *   so it does not visibly split — see the note in the cart screen.
 * - CART-5/CART-6 one total: shipping is charged once for the whole order, never
 *   per parcel or per seller.
 */
export type Temperature = "ambient" | "perishable";

export interface CartLine {
  id: string;
  name: string;
  altNames: string;
  sellerName: string;
  sellerVerified: boolean;
  originMetro: string;
  /** Days until this parcel arrives. */
  arrivesInDays: number;
  temperature: Temperature;
  unitLabel: string;
  priceCents: number;
  qty: number;
  glyph: ProductGlyphKind;
}

export interface Parcel {
  key: string;
  originMetro: string;
  temperature: Temperature;
  arrivesInDays: number;
  lines: CartLine[];
}

export const FREE_SHIPPING_THRESHOLD_CENTS = 10000;
export const FLAT_SHIPPING_CENTS = 750;

const SEED: CartLine[] = [
  { id: "egusi", name: "Egusi", altNames: "Egusi — melon seeds", sellerName: "Adunni Foods", sellerVerified: true,
    originMetro: "Houston, TX", arrivesInDays: 2, temperature: "ambient", unitLabel: "500g bag", priceCents: 850, qty: 2, glyph: "leaf" },
  { id: "ata", name: "Ata Rodo", altNames: "Ata rodo — scotch bonnet", sellerName: "Lagos Fresh", sellerVerified: true,
    originMetro: "Houston, TX", arrivesInDays: 2, temperature: "ambient", unitLabel: "250g pack", priceCents: 675, qty: 2, glyph: "pepper" },
  { id: "palm", name: "Red Palm Oil", altNames: "Palm oil — cold-pressed", sellerName: "Mama Ngozi", sellerVerified: true,
    originMetro: "Bronx, NY", arrivesInDays: 3, temperature: "ambient", unitLabel: "1L", priceCents: 1530, qty: 2, glyph: "jar" },
  { id: "plantain", name: "Plantain Flour", altNames: "Plantain — unripe flour", sellerName: "Mama Ngozi", sellerVerified: true,
    originMetro: "Bronx, NY", arrivesInDays: 3, temperature: "ambient", unitLabel: "1kg", priceCents: 1020, qty: 3, glyph: "leaf" },
];

/** CART-3 before CART-2: temperature splits first, then origin. */
function groupIntoParcels(lines: CartLine[]): Parcel[] {
  const byKey = new Map<string, Parcel>();
  for (const line of lines) {
    const key = `${line.temperature}|${line.originMetro}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.lines.push(line);
      existing.arrivesInDays = Math.max(existing.arrivesInDays, line.arrivesInDays);
    } else {
      byKey.set(key, {
        key,
        originMetro: line.originMetro,
        temperature: line.temperature,
        arrivesInDays: line.arrivesInDays,
        lines: [line],
      });
    }
  }
  return [...byKey.values()];
}

interface CartContextValue {
  lines: CartLine[];
  parcels: Parcel[];
  count: number;
  sellerCount: number;
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
  add: (quantity?: number) => void;
  setQty: (id: string, qty: number) => void;
  remove: (id: string) => void;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(SEED);

  const value = useMemo<CartContextValue>(() => {
    const subtotalCents = lines.reduce((sum, l) => sum + l.priceCents * l.qty, 0);
    // CART-5: one shipping fee for the order, never one per parcel or seller.
    const shippingCents = subtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS ? 0 : FLAT_SHIPPING_CENTS;
    return {
      lines,
      parcels: groupIntoParcels(lines),
      count: lines.reduce((n, l) => n + l.qty, 0),
      sellerCount: new Set(lines.map((l) => l.sellerName)).size,
      subtotalCents,
      shippingCents,
      totalCents: subtotalCents + shippingCents,
      add: (quantity = 1) =>
        setLines((prev) =>
          prev.length
            ? prev.map((l, i) => (i === 0 ? { ...l, qty: l.qty + quantity } : l))
            : prev,
        ),
      setQty: (id, qty) => setLines((prev) => prev.map((l) => (l.id === id ? { ...l, qty: Math.max(1, qty) } : l))),
      remove: (id) => setLines((prev) => prev.filter((l) => l.id !== id)),
    };
  }, [lines]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within a CartProvider");
  return ctx;
}
