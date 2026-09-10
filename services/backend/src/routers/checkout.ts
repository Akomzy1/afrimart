import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { prisma } from "../db.js";
import { publicProcedure, router } from "../trpc.js";
import { LocalCarrierGateway } from "../shipping/carrier.js";
import { route } from "../routing/engine.js";
import { priceOrder } from "../routing/pricing.js";
import { splitPayment } from "../payments/split.js";
import type { BasketLine, CandidateListing } from "../routing/types.js";

/**
 * PRD 6.5 / 6.7 / 6.8 — the checkout surface over the routing engine.
 *
 * `quote` is pure: it routes, prices and discloses without writing anything, so
 * the cart and checkout screens can call it on every change. `place` runs the
 * same routing and then persists the result. Both go through the same engine —
 * the quote a buyer approves is the plan that gets shipped.
 */

const carrier = new LocalCarrierGateway();

const basketInput = z.object({
  items: z.array(z.object({ listingId: z.string(), quantity: z.number().int().positive() })).min(1),
  destination: z.object({
    street: z.string(),
    city: z.string(),
    state: z.string(),
    zip: z.string(),
  }),
});
type BasketInput = z.infer<typeof basketInput>;

/**
 * The buyer picked specific listings, but routing works in canonical terms so
 * it is free to move a line to a different store (CART-2). We keep the
 * requested quantity and the canonical identity, and discard the store choice.
 */
async function resolveBasket(input: BasketInput) {
  const requested = await prisma.listing.findMany({
    where: { id: { in: input.items.map((i) => i.listingId) } },
    select: { id: true, canonicalProductId: true },
  });
  if (requested.length !== input.items.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "One or more listings no longer exist." });
  }

  const byListingId = new Map(requested.map((l) => [l.id, l.canonicalProductId]));

  // Merge duplicate lines for the same canonical product.
  const quantities = new Map<string, number>();
  for (const item of input.items) {
    const cp = byListingId.get(item.listingId)!;
    quantities.set(cp, (quantities.get(cp) ?? 0) + item.quantity);
  }
  const lines: BasketLine[] = [...quantities].map(([canonicalProductId, quantity]) => ({
    canonicalProductId,
    quantity,
  }));

  // CART-2 needs every store's offer for these products, not just the chosen ones.
  const rows = await prisma.listing.findMany({
    where: { canonicalProductId: { in: lines.map((l) => l.canonicalProductId) } },
    include: { store: { include: { hubMetro: true } } },
  });

  const pool: CandidateListing[] = rows
    .filter((r) => r.store.onboardingStatus === "live")
    .map((r) => ({
      listingId: r.id,
      storeId: r.storeId,
      storeName: r.store.name,
      metro: r.store.hubMetro.name,
      canonicalProductId: r.canonicalProductId,
      priceCents: r.priceCents,
      stockStatus: r.stockStatus,
      batchQuantityCap: r.batchQuantityCap,
      temperatureClass: r.temperatureClass,
      shippingWeightOz: r.shippingWeightOz,
    }));

  return { lines, pool };
}

export const checkoutRouter = router({
  /** FUL-4 — validate before quoting, so a bad address fails early and cheaply. */
  validateAddress: publicProcedure
    .input(z.object({ street: z.string(), city: z.string(), state: z.string(), zip: z.string() }))
    .mutation(({ input }) => carrier.validateAddress(input)),

  /**
   * CART-2/3/5/6/8 — route the basket and return what the buyer should see:
   * one shipping figure, a parcel count, and a date per parcel.
   */
  quote: publicProcedure.input(basketInput).mutation(async ({ input }: { input: BasketInput }) => {
    const { lines, pool } = await resolveBasket(input);
    const plan = await route(lines, pool, carrier, { toZip: input.destination.zip });
    const pricing = priceOrder(plan, input.destination.state);

    // The cart screen renders items grouped under their parcel, so the quote
    // carries the routed assignment with enough product detail to draw a line
    // item. Names are joined here rather than in the pricing module, which
    // stays pure and display-agnostic.
    const productIds = plan.assignment.map((a) => a.canonicalProductId);
    const products = await prisma.canonicalProduct.findMany({
      where: { id: { in: productIds } },
      select: { id: true, canonicalName: true, shortDescription: true, packSize: true, category: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    const stores = await prisma.store.findMany({
      where: { id: { in: plan.parcels.map((p) => p.storeId) } },
      select: { id: true, verificationStatus: true },
    });
    const verifiedById = new Map(stores.map((s) => [s.id, s.verificationStatus === "verified"]));

    const parcels = plan.parcels.map((p, index) => ({
      ...pricing.parcels[index],
      storeId: p.storeId,
      transitDays: p.transitDays,
      lines: p.lines.map((l) => {
        const product = byId.get(l.canonicalProductId);
        return {
          listingId: l.listing.listingId,
          canonicalProductId: l.canonicalProductId,
          name: product?.canonicalName ?? "",
          altNames: product ? `${product.canonicalName} — ${product.shortDescription}` : "",
          category: product?.category ?? "",
          unitLabel: product?.packSize ?? "",
          sellerName: l.listing.storeName,
          sellerVerified: verifiedById.get(l.listing.storeId) ?? false,
          priceCents: l.listing.priceCents,
          quantity: l.quantity,
          lineTotalCents: l.lineTotalCents,
        };
      }),
    }));

    return {
      pricing,
      parcels,
      singleStore: plan.singleStore,
      storeCount: plan.storeCount,
      unfulfillable: plan.unfulfillable,
      /** Ops-facing, not for display: see RoutingPlan.singleStorePremiumCents. */
      singleStorePremiumCents: plan.singleStorePremiumCents,
    };
  }),

  /**
   * Persists the routed plan: one Order, one Shipment per parcel (CART-3), one
   * Payment for the whole charge (CART-5 — a single collection), and one Payout
   * row per fulfilling store (PAY-2).
   */
  place: publicProcedure
    .input(basketInput.extend({ buyerId: z.string() }))
    .mutation(async ({ input }) => {
      const { lines, pool } = await resolveBasket(input);
      const plan = await route(lines, pool, carrier, { toZip: input.destination.zip });

      if (plan.unfulfillable.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Some items are no longer available from any store.",
        });
      }

      const pricing = priceOrder(plan, input.destination.state);
      const split = splitPayment(plan, pricing.totalCents, pricing.taxCents);

      return prisma.$transaction(async (tx) => {
        const order = await tx.order.create({
          data: {
            buyerId: input.buyerId,
            totalCents: pricing.totalCents,
            shippingCents: pricing.shippingCents,
            taxCents: pricing.taxCents,
          },
        });

        await tx.shipment.createMany({
          data: plan.parcels.map((p) => ({
            orderId: order.id,
            storeId: p.storeId,
            temperatureClass: p.temperatureClass,
            carrier: p.carrier,
            estimatedDelivery: p.estimatedDelivery,
          })),
        });

        // PAY-1 — a real Stripe PaymentIntent replaces this placeholder id once
        // Connect credentials exist; the amount and split are already correct.
        await tx.payment.create({
          data: {
            orderId: order.id,
            buyerChargeCents: pricing.totalCents,
            stripePaymentIntentId: `pi_pending_${order.id}`,
          },
        });

        await tx.payout.createMany({
          data: split.stores.map((s) => ({
            storeId: s.storeId,
            orderId: order.id,
            grossCents: s.grossCents,
            takeRateBps: s.takeRateBps,
            fulfilmentFeeCents: s.fulfilmentFeeCents,
            netCents: s.netCents,
          })),
        });

        return { orderId: order.id, pricing, parcelCount: plan.parcels.length };
      });
    }),
});
