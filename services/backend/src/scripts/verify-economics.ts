/**
 * End-to-end economics check against the live database.
 *
 * Deliberately an awkward basket: products whose cheapest offers sit in
 * different metros so no single store can complete it, forcing CART-2 to
 * split, plus a perishable so CART-3 splits again on temperature. That
 * exercises routing, pass-through pricing and the payout arithmetic together,
 * which unit tests against fixtures never do.
 *
 * Run with: npm run verify:economics --workspace=@afrimart/backend
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

// The same basket used before the pass-through rebuild, so the figures compare.
const WANT = ["Egusi", "Red Palm Oil", "Plantain Flour", "Berbere", "Suya Spice", "Smoked Catfish"];
const QTY: Record<string, number> = {
  Egusi: 2,
  "Red Palm Oil": 1,
  "Plantain Flour": 3,
  Berbere: 2,
  "Suya Spice": 1,
  "Smoked Catfish": 1,
};

const products = await prisma.canonicalProduct.findMany({ where: { canonicalName: { in: WANT } } });
const lines: BasketLine[] = products.map((p) => ({ canonicalProductId: p.id, quantity: QTY[p.canonicalName] ?? 1 }));

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
    lengthIn: r.lengthIn,
    widthIn: r.widthIn,
    heightIn: r.heightIn,
    sellerType: r.store.sellerType,
    verificationStatus: r.store.verificationStatus,
  }));

const plan = await route(lines, pool, carrier, { toZip: "77002" });
const pricing = priceOrder(plan, "TX");
const logistics = pricing.shippingCents + pricing.coldPackCents;
const split = splitPayment(plan, pricing.totalCents, pricing.taxCents, logistics);

console.log(`basket: ${products.length} products, ${lines.reduce((n, l) => n + l.quantity, 0)} units`);
console.log(
  `routing: singleStore=${plan.singleStore} stores=${plan.storeCount} ` +
    `parcels=${plan.parcels.length} exceptional=${pricing.exceptionalSplit}`,
);
console.log(
  `  premium paid to stay together: ${money(plan.singleStorePremiumCents)}; ` +
    `blocked by verification: ${plan.blockedByVerification.length}`,
);
for (const p of plan.parcels) {
  console.log(
    `  ${p.storeName} (${p.metro}) ${p.temperatureClass}: ${p.lines.length} lines, ` +
      `billable ${(p.billableWeightOz / 16).toFixed(1)}lb, carriage ${money(p.carrierCostCents)}` +
      (p.coldPackCostCents ? `, cold pack ${money(p.coldPackCostCents)}` : ""),
  );
}

console.log(`\n--- BUYER PAYS ---`);
console.log(`  items      ${money(pricing.itemsSubtotalCents)}`);
console.log(`  shipping   ${money(pricing.shippingCents)}   (one line, ${plan.parcels.length} parcels)`);
console.log(`  cold pack  ${money(pricing.coldPackCents)}   (one line, ${pricing.coldParcelCount} chilled parcel(s))`);
console.log(`  tax        ${money(pricing.taxCents)}`);
console.log(`  TOTAL      ${money(pricing.totalCents)}`);

console.log(`\n--- CART-5: pass-through ---`);
console.log(
  `  charged ${money(logistics)} against true cost ` +
    `${money(plan.trueShippingCostCents + plan.trueColdPackCostCents)} -> margin ${money(pricing.shippingMarginCents)}`,
);

console.log(`\n--- PAY-2/PAY-3: per-seller remittance (take ${TAKE_RATE_BPS / 100}%, order fee ${money(FULFILMENT_FEE_CENTS)}) ---`);
let netSum = 0;
let feeSum = 0;
let grossSum = 0;
for (const s of split.stores) {
  const expectedFee = Math.round((s.grossCents * TAKE_RATE_BPS) / 10000);
  const ok = s.platformFeeCents === expectedFee && s.netCents === s.grossCents - s.platformFeeCents - s.fulfilmentFeeCents;
  console.log(
    `  ${s.storeName.padEnd(18)} gross ${money(s.grossCents).padStart(8)}  commission ${money(s.platformFeeCents).padStart(7)}` +
      `  orderfee ${money(s.fulfilmentFeeCents).padStart(6)}  net ${money(s.netCents).padStart(8)}  ${ok ? "OK" : "MISMATCH"}`,
  );
  netSum += s.netCents;
  feeSum += s.fulfilmentFeeCents;
  grossSum += s.grossCents;
}
console.log(`  store gross total ${money(grossSum)} vs basket ${money(plan.itemsSubtotalCents)} -> ${grossSum === plan.itemsSubtotalCents ? "reconciles" : "MISMATCH"}`);
console.log(`  order fee charged once: ${money(feeSum)} vs ${money(FULFILMENT_FEE_CENTS)} -> ${feeSum === FULFILMENT_FEE_CENTS ? "OK" : "MISMATCH"}`);
console.log(
  `  platform: commission+fee ${money(split.platformGrossCents)} + logistics ${money(split.logisticsRevenueCents)} ` +
    `- carrier+materials ${money(plan.trueShippingCostCents + plan.trueColdPackCostCents)} = net ${money(split.platformNetCents)}`,
);
console.log(
  `  sellers net ${money(netSum)} + platform gross ${money(split.platformGrossCents)} = ` +
    `${money(netSum + split.platformGrossCents)} vs items ${money(plan.itemsSubtotalCents)} -> ` +
    `${netSum + split.platformGrossCents === plan.itemsSubtotalCents ? "reconciles" : "MISMATCH"}`,
);

await prisma.$disconnect();
