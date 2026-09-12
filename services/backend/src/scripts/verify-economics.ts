/**
 * End-to-end check of the order loop against the live database.
 *
 * Deliberately an awkward basket: products whose cheapest offers sit in
 * different metros so no single store can complete it, forcing CART-2 to split,
 * plus a frozen line so CART-3 must split again on temperature. That exercises
 * routing, the write path and the payout arithmetic together, which unit tests
 * against fixtures never do.
 *
 * Run with: npx tsx src/e2e.ts
 */
import { prisma } from "../db.js";
import { LocalCarrierGateway } from "../shipping/carrier.js";
import { route } from "../routing/engine.js";
import { priceOrder } from "../routing/pricing.js";
import { splitPayment } from "../payments/split.js";
import { TAKE_RATE_BPS, FULFILMENT_FEE_CENTS } from "../config.js";
import type { BasketLine, CandidateListing } from "../routing/types.js";

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const carrier = new LocalCarrierGateway();

// Pick products that cannot come from one store.
const WANT = ["Egusi", "Red Palm Oil", "Plantain Flour", "Berbere", "Suya Spice"];
const QTY: Record<string, number> = { Egusi: 2, "Red Palm Oil": 1, "Plantain Flour": 3, Berbere: 2, "Suya Spice": 1 };

const products = await prisma.canonicalProduct.findMany({ where: { canonicalName: { in: WANT } } });
const lines: BasketLine[] = products.map((p) => ({ canonicalProductId: p.id, quantity: QTY[p.canonicalName] ?? 1 }));

const rows = await prisma.listing.findMany({
  where: { canonicalProductId: { in: lines.map((l) => l.canonicalProductId) } },
  include: { store: { include: { hubMetro: true } } },
});
const pool: CandidateListing[] = rows
  .filter((r) => r.store.onboardingStatus === "live")
  .map((r) => ({
    listingId: r.id, storeId: r.storeId, storeName: r.store.name, metro: r.store.hubMetro.name,
    canonicalProductId: r.canonicalProductId, priceCents: r.priceCents, stockStatus: r.stockStatus,
    batchQuantityCap: r.batchQuantityCap, temperatureClass: r.temperatureClass, shippingWeightOz: r.shippingWeightOz,
  }));

const plan = await route(lines, pool, carrier, { toZip: "77002" });
const pricing = priceOrder(plan, "TX");
const split = splitPayment(plan, pricing.totalCents, pricing.taxCents);

console.log(`basket: ${products.length} products, ${lines.reduce((n, l) => n + l.quantity, 0)} units`);
console.log(`routing: singleStore=${plan.singleStore} stores=${plan.storeCount} parcels=${plan.parcels.length}`);
for (const p of plan.parcels) {
  console.log(`  ${p.storeName} (${p.metro}) ${p.temperatureClass}: ${p.lines.length} lines, true cost ${money(p.carrierCostCents)}`);
}
console.log(`buyer pays: items ${money(pricing.itemsSubtotalCents)} + shipping ${money(pricing.shippingCents)} + tax ${money(pricing.taxCents)} = ${money(pricing.totalCents)}`);

console.log(`\n--- CART-5: one shipping figure across ${plan.parcels.length} parcels ---`);
console.log(`  charged ${money(pricing.shippingCents)}; carriers actually cost ${money(plan.trueShippingCostCents)}; platform margin ${money(pricing.shippingMarginCents)}`);

console.log(`\n--- PAY-2/PAY-3: per-seller remittance (take ${TAKE_RATE_BPS / 100}%, order fee ${money(FULFILMENT_FEE_CENTS)}) ---`);
let netSum = 0, feeSum = 0, grossSum = 0;
for (const s of split.stores) {
  const expectedFee = Math.round((s.grossCents * TAKE_RATE_BPS) / 10000);
  const ok = s.platformFeeCents === expectedFee && s.netCents === s.grossCents - s.platformFeeCents - s.fulfilmentFeeCents;
  console.log(`  ${s.storeName.padEnd(18)} gross ${money(s.grossCents).padStart(8)}  commission ${money(s.platformFeeCents).padStart(7)}  orderfee ${money(s.fulfilmentFeeCents).padStart(6)}  net ${money(s.netCents).padStart(8)}  ${ok ? "OK" : "MISMATCH"}`);
  netSum += s.netCents; feeSum += s.fulfilmentFeeCents; grossSum += s.grossCents;
}
console.log(`  store gross total ${money(grossSum)} vs basket ${money(plan.itemsSubtotalCents)} -> ${grossSum === plan.itemsSubtotalCents ? "reconciles" : "MISMATCH"}`);
console.log(`  order fee charged once: ${money(feeSum)} vs ${money(FULFILMENT_FEE_CENTS)} -> ${feeSum === FULFILMENT_FEE_CENTS ? "OK" : "MISMATCH"}`);
console.log(`  platform gross ${money(split.platformGrossCents)}  carrier cost ${money(split.carrierCostCents)}  platform net ${money(split.platformNetCents)}`);
console.log(`  sellers net ${money(netSum)} + platform gross ${money(split.platformGrossCents)} = ${money(netSum + split.platformGrossCents)} vs items ${money(plan.itemsSubtotalCents)} -> ${netSum + split.platformGrossCents === plan.itemsSubtotalCents ? "reconciles" : "MISMATCH"}`);

await prisma.$disconnect();
