"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { trpc } from "@afrimart/api-client";
import type { ProductGlyphKind } from "@afrimart/ui";

/**
 * The cart's basket is local state; its *routing and pricing are not*.
 *
 * This used to group parcels and apply the free-shipping threshold itself,
 * which duplicated the routing engine in the client — the one thing CLAUDE.md's
 * repository rules forbid ("do not duplicate order/catalogue/routing logic
 * between the two apps"). Two implementations of CART-2/3/5 drift, and the
 * client's was the naive one: it grouped by origin metro, so it could never
 * have produced the store-level parcels the engine actually returns.
 *
 * Now the basket holds listing ids and quantities, and every derived number —
 * parcels, subtotal, shipping, total — comes from `checkout.quote`. The
 * backend is the only place those rules exist.
 */

export interface CartLine {
  listingId: string;
  canonicalProductId: string;
  name: string;
  altNames: string;
  sellerName: string;
  sellerVerified: boolean;
  unitLabel: string;
  priceCents: number;
  qty: number;
  glyph: ProductGlyphKind;
}

export interface Parcel {
  key: string;
  originMetro: string;
  storeName: string;
  temperature: string;
  arrivesInDays: number;
  estimatedDelivery: string;
  reason: string;
  lines: CartLine[];
}

/** Mirrors the backend's CART-5 threshold, for the progress bar only. */
export const FREE_SHIPPING_THRESHOLD_CENTS = 10000;

/** Seeded in prisma/seed.ts. Replace with the signed-in buyer when auth lands. */
export const DEMO_BUYER_ID = "demo-buyer";

/** The demo basket, by canonical name — resolved to real listings on mount. */
const DEMO_BASKET: { name: string; qty: number }[] = [
  { name: "Egusi", qty: 2 },
  { name: "Ata Rodo", qty: 2 },
  { name: "Red Palm Oil", qty: 2 },
  { name: "Plantain Flour", qty: 3 },
];

/** Ships to the prototype's address, so quotes are stable across reloads. */
const DESTINATION = { street: "1200 Heritage Lane", city: "Houston", state: "TX", zip: "77002" };

const GLYPH_BY_CATEGORY: Record<string, ProductGlyphKind> = {
  "Legumes & seeds": "leaf",
  "Spices & seasonings": "pepper",
  Oils: "jar",
  "Flours & grains": "wheat",
};

function glyphFor(category: string): ProductGlyphKind {
  return GLYPH_BY_CATEGORY[category] ?? "leaf";
}

interface BasketItem {
  listingId: string;
  qty: number;
}

interface CartContextValue {
  lines: CartLine[];
  parcels: Parcel[];
  count: number;
  sellerCount: number;
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
  taxCents: number;
  /** True while a quote is in flight — totals shown are the previous ones. */
  pricing: boolean;
  /** Set when the backend could not be reached; screens show it rather than wrong numbers. */
  error: string | null;
  add: (listingId: string, quantity?: number) => void;
  /**
   * Add by canonical product name, for surfaces that know what they want but
   * not which listing — Cook's recipe lines and the account "usuals". Anything
   * the catalogue doesn't carry is skipped and reported back, so callers can
   * tell the buyer honestly rather than silently dropping it.
   */
  addByNames: (names: string[], qtyByName?: Record<string, number>) => Promise<{ added: number; missing: string[] }>;
  setQty: (listingId: string, qty: number) => void;
  remove: (listingId: string) => void;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<BasketItem[]>([]);
  const [seeded, setSeeded] = useState(false);

  const demo = trpc.catalogue.listingsForProducts.useQuery(
    { names: DEMO_BASKET.map((d) => d.name) },
    { enabled: !seeded, retry: false, refetchOnWindowFocus: false },
  );

  useEffect(() => {
    if (seeded || !demo.data) return;
    const qtyByName = new Map(DEMO_BASKET.map((d) => [d.name, d.qty]));
    setItems(demo.data.map((card) => ({ listingId: card.listingId, qty: qtyByName.get(card.name) ?? 1 })));
    setSeeded(true);
  }, [demo.data, seeded]);

  const quote = trpc.checkout.quote.useMutation();
  const { mutate: requestQuote } = quote;
  const utils = trpc.useUtils();

  // Re-quote whenever the basket changes. The engine is the only thing that
  // decides how this basket splits and what it costs.
  const basketKey = items.map((i) => `${i.listingId}:${i.qty}`).join(",");
  useEffect(() => {
    if (!items.length) return;
    requestQuote({ items: items.map((i) => ({ listingId: i.listingId, quantity: i.qty })), destination: DESTINATION });
  }, [basketKey, requestQuote]); // eslint-disable-line react-hooks/exhaustive-deps

  const value = useMemo<CartContextValue>(() => {
    const data = quote.data;

    const parcels: Parcel[] = (data?.parcels ?? []).map((p, index) => ({
      key: `${p.storeId}|${p.temperatureClass}`,
      originMetro: p.metro,
      storeName: p.storeName,
      temperature: p.temperatureClass,
      arrivesInDays: p.transitDays,
      estimatedDelivery: String(p.estimatedDelivery),
      reason: p.reason,
      lines: p.lines.map((l) => ({
        listingId: l.listingId,
        canonicalProductId: l.canonicalProductId,
        name: l.name,
        altNames: l.altNames,
        sellerName: l.sellerName,
        sellerVerified: l.sellerVerified,
        unitLabel: l.unitLabel,
        priceCents: l.priceCents,
        qty: l.quantity,
        glyph: glyphFor(l.category),
      })),
    }));

    const lines = parcels.flatMap((p) => p.lines);
    const pricing = data?.pricing;

    const demoFailed = demo.isError;
    const quoteFailed = quote.isError;

    return {
      lines,
      parcels,
      count: lines.reduce((n, l) => n + l.qty, 0),
      sellerCount: new Set(lines.map((l) => l.sellerName)).size,
      subtotalCents: pricing?.itemsSubtotalCents ?? 0,
      shippingCents: pricing?.shippingCents ?? 0,
      totalCents: pricing?.totalCents ?? 0,
      taxCents: pricing?.taxCents ?? 0,
      pricing: quote.isPending || demo.isLoading,
      error:
        demoFailed || quoteFailed
          ? "We couldn't reach the market just now. Your basket is safe — try again in a moment."
          : null,
      add: (listingId, quantity = 1) =>
        setItems((prev) =>
          prev.some((i) => i.listingId === listingId)
            ? prev.map((i) => (i.listingId === listingId ? { ...i, qty: i.qty + quantity } : i))
            : [...prev, { listingId, qty: quantity }],
        ),
      addByNames: async (names, qtyByName) => {
        const found = await utils.catalogue.listingsForProducts.fetch({ names });
        const foundNames = new Set(found.map((f) => f.name));
        setItems((prev) => {
          const next = [...prev];
          for (const card of found) {
            const qty = qtyByName?.[card.name] ?? 1;
            const existing = next.findIndex((i) => i.listingId === card.listingId);
            if (existing >= 0) next[existing] = { ...next[existing], qty: next[existing].qty + qty };
            else next.push({ listingId: card.listingId, qty });
          }
          return next;
        });
        return { added: found.length, missing: names.filter((n) => !foundNames.has(n)) };
      },
      setQty: (listingId, qty) =>
        setItems((prev) => prev.map((i) => (i.listingId === listingId ? { ...i, qty: Math.max(1, qty) } : i))),
      remove: (listingId) => setItems((prev) => prev.filter((i) => i.listingId !== listingId)),
    };
  }, [quote.data, quote.isPending, quote.isError, demo.isError, demo.isLoading, utils]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within a CartProvider");
  return ctx;
}
