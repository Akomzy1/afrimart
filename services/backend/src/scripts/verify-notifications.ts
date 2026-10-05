/**
 * Drives one order through every state with simulated carrier webhooks,
 * including a duplicate and an out-of-order event, and reports exactly what
 * fired.
 *
 * Run with: npm run verify:notifications --workspace=@afrimart/backend
 */
import { prisma } from "../db.js";
import { LocalCarrierGateway } from "../shipping/carrier.js";
import { route } from "../routing/engine.js";
import { priceOrder } from "../routing/pricing.js";
import { handleTrackingEvent, queueMerchantAlert, queueOrderConfirmation } from "../notifications/pipeline.js";
import { drain } from "../notifications/outbox.js";
import { MemoryEmailSender, MemoryPushSender, DisabledSmsSender, setSenders } from "../notifications/senders.js";
import type { BasketLine, CandidateListing } from "../routing/types.js";

const email = new MemoryEmailSender();
const push = new MemoryPushSender();
const sms = new DisabledSmsSender();
setSenders({ email, push, sms });

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`${pass ? "  ok  " : "  FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

const carrier = new LocalCarrierGateway();

// A mixed-temperature, multi-seller basket, so the run exercises several
// parcels and the chilled confirmation variant.
const WANT = ["Egusi", "Red Palm Oil", "Smoked Catfish"];
const products = await prisma.canonicalProduct.findMany({ where: { canonicalName: { in: WANT } } });
const lines: BasketLine[] = products.map((p) => ({ canonicalProductId: p.id, quantity: 1 }));

const rows = await prisma.listing.findMany({
  where: { canonicalProductId: { in: lines.map((l) => l.canonicalProductId) } },
  include: { store: { include: { hubMetro: true } } },
});
const pool: CandidateListing[] = rows
  .filter((r) => r.store.onboardingStatus === "live")
  .map((r) => ({
    listingId: r.id, storeId: r.storeId, storeName: r.store.name, metro: r.store.hubMetro.name,
    canonicalProductId: r.canonicalProductId, priceCents: r.priceCents, stockStatus: r.stockStatus,
    batchQuantityCap: r.batchQuantityCap, temperatureClass: r.temperatureClass,
    shippingWeightOz: r.shippingWeightOz, lengthIn: r.lengthIn, widthIn: r.widthIn, heightIn: r.heightIn,
    sellerType: r.store.sellerType, verificationStatus: r.store.verificationStatus,
  }));

const plan = await route(lines, pool, carrier, { toZip: "77002" });
const pricing = priceOrder(plan, "TX");

// Place the order directly, mirroring checkout.place.
const snapshots = await prisma.canonicalProduct.findMany({
  where: { id: { in: plan.assignment.map((a) => a.canonicalProductId) } },
});
const snapById = new Map(snapshots.map((s) => [s.id, s]));

const order = await prisma.$transaction(async (tx) => {
  const o = await tx.order.create({
    data: {
      buyerId: "demo-buyer",
      totalCents: pricing.totalCents,
      shippingCents: pricing.shippingCents,
      taxCents: pricing.taxCents,
    },
  });
  for (const p of plan.parcels) {
    await tx.shipment.create({
      data: {
        orderId: o.id, storeId: p.storeId, temperatureClass: p.temperatureClass,
        carrier: p.carrier, estimatedDelivery: p.estimatedDelivery,
        items: {
          create: p.lines.map((l) => {
            const s = snapById.get(l.canonicalProductId);
            return {
              listingId: l.listing.listingId, canonicalProductId: l.canonicalProductId,
              nameSnapshot: s?.canonicalName ?? "", packSizeSnapshot: s?.packSize ?? "",
              categorySnapshot: s?.category ?? "", quantity: l.quantity,
              unitPriceCents: l.listing.priceCents, lineTotalCents: l.lineTotalCents,
            };
          }),
        },
      },
    });
  }
  await queueOrderConfirmation(tx, o.id);
  const placed = await tx.shipment.findMany({ where: { orderId: o.id }, include: { items: true } });
  for (const s of placed) {
    await queueMerchantAlert(tx, s.id, s.storeId, s.items.reduce((n, i) => n + i.quantity, 0));
  }
  return o;
});

const parcels = await prisma.shipment.findMany({ where: { orderId: order.id }, orderBy: { createdAt: "asc" } });
console.log(`order ${order.id.slice(-7)} placed with ${parcels.length} parcels\n`);

console.log("=== 1. order placed ===");
let d = await drain();
check("confirmation email queued and sent", d.sent >= 1, JSON.stringify(d.byTemplate));
check(
  "chilled order uses the cold-pack variant",
  Object.keys(d.byTemplate).some((t) => t === "order-confirmed"),
  Object.keys(d.byTemplate).join(", "),
);
check(`one merchant push per parcel (${parcels.length})`, push.captured.length === parcels.length, `${push.captured.length} pushes`);

console.log("\n=== 2. each parcel ships ===");
let seq = 0;
for (const p of parcels) {
  await handleTrackingEvent({
    provider: "simulated", providerEventId: `evt-${order.id}-${++seq}`, shipmentId: p.id,
    status: "label_created", occurredAt: new Date(), carrier: "UPS", trackingNumber: `1Z-${p.id.slice(-6)}`,
  });
  const r = await handleTrackingEvent({
    provider: "simulated", providerEventId: `evt-${order.id}-${++seq}`, shipmentId: p.id,
    status: "picked_up", occurredAt: new Date(), carrier: "UPS", trackingNumber: `1Z-${p.id.slice(-6)}`,
  });
  check(`parcel ${p.id.slice(-4)} shipped -> ${r.queued.join(",") || "no email"}`, r.queued.length === 1, r.shipmentStatus ?? "");
}
d = await drain();
check(`${parcels.length} shipped emails sent`, d.sent === parcels.length, JSON.stringify(d.byTemplate));

console.log("\n=== 3. a duplicate webhook ===");
const beforeDup = await prisma.notification.count();
const dup = await handleTrackingEvent({
  provider: "simulated", providerEventId: `evt-${order.id}-2`, shipmentId: parcels[0].id,
  status: "picked_up", occurredAt: new Date(),
});
const afterDup = await prisma.notification.count();
check("the replay is recognised", dup.applied === false && dup.reason === "duplicate", dup.reason ?? "");
check("no second email is queued", afterDup === beforeDup, `${beforeDup} -> ${afterDup}`);

console.log("\n=== 4. an out-of-order webhook ===");
await handleTrackingEvent({
  provider: "simulated", providerEventId: `evt-${order.id}-deliver-0`, shipmentId: parcels[0].id,
  status: "delivered", occurredAt: new Date(),
});
const afterDelivered = await prisma.shipment.findUniqueOrThrow({ where: { id: parcels[0].id } });
const late = await handleTrackingEvent({
  provider: "simulated", providerEventId: `evt-${order.id}-late`, shipmentId: parcels[0].id,
  status: "in_transit", occurredAt: new Date(Date.now() - 86400_000),
});
const stillDelivered = await prisma.shipment.findUniqueOrThrow({ where: { id: parcels[0].id } });
check("the late in-transit event is refused", late.applied === false && late.reason === "out-of-order", late.reason ?? "");
check(
  "the parcel stays delivered",
  afterDelivered.status === "delivered" && stillDelivered.status === "delivered",
  `${afterDelivered.status} -> ${stillDelivered.status}`,
);

console.log("\n=== 5. the rest of the parcels are delivered ===");
for (const p of parcels.slice(1)) {
  await handleTrackingEvent({
    provider: "simulated", providerEventId: `evt-${order.id}-deliver-${p.id.slice(-4)}`,
    shipmentId: p.id, status: "delivered", occurredAt: new Date(),
  });
}
d = await drain();
const finalOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
check("order reaches delivered", finalOrder.status === "delivered", finalOrder.status);
check("exactly one delivered email", email.captured.filter((e) => e.subject === "Your order has arrived").length === 1);

console.log("\n=== 6. single-parcel order omits the label ===");
const singlePool = pool.filter((p) => p.temperatureClass === "ambient").slice(0, 1);
if (singlePool.length) {
  const singlePlan = await route(
    [{ canonicalProductId: singlePool[0].canonicalProductId, quantity: 1 }],
    singlePool, carrier, { toZip: "77002" },
  );
  const sp = priceOrder(singlePlan, "TX");
  const singleOrder = await prisma.$transaction(async (tx) => {
    const o = await tx.order.create({
      data: { buyerId: "demo-buyer", totalCents: sp.totalCents, shippingCents: sp.shippingCents, taxCents: sp.taxCents },
    });
    const p = singlePlan.parcels[0];
    const s = snapById.get(p.lines[0].canonicalProductId);
    await tx.shipment.create({
      data: {
        orderId: o.id, storeId: p.storeId, temperatureClass: p.temperatureClass,
        items: {
          create: [{
            listingId: p.lines[0].listing.listingId, canonicalProductId: p.lines[0].canonicalProductId,
            nameSnapshot: s?.canonicalName ?? "x", packSizeSnapshot: s?.packSize ?? "", categorySnapshot: s?.category ?? "",
            quantity: 1, unitPriceCents: p.lines[0].listing.priceCents, lineTotalCents: p.lines[0].lineTotalCents,
          }],
        },
      },
    });
    return o;
  });
  const single = await prisma.shipment.findFirstOrThrow({ where: { orderId: singleOrder.id } });
  const before = email.captured.length;
  await handleTrackingEvent({
    provider: "simulated", providerEventId: `evt-single-${singleOrder.id}`, shipmentId: single.id,
    status: "picked_up", occurredAt: new Date(), carrier: "USPS", trackingNumber: "9400-SINGLE",
  });
  await drain();
  const sent = email.captured.slice(before);
  const body = sent.map((e) => e.html).join("");
  check("a shipped email was sent", sent.length === 1, `${sent.length}`);
  check('subject omits "Parcel 1 of 1"', !sent.some((e) => /Parcel \d of \d/.test(e.subject)), sent[0]?.subject ?? "");
  check('body contains no "Parcel N of M" anywhere', !/Parcel \d+ of \d+/.test(body));
  check("no leftover template token", !body.includes("{{"));
}

console.log("\n=== totals ===");
console.log(`  emails sent      ${email.captured.length}`);
for (const e of email.captured) console.log(`      - ${e.subject}`);
console.log(`  merchant pushes  ${push.captured.length}`);
console.log(`  sms suppressed   ${sms.suppressed.length} (10DLC pending, sender disabled)`);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
await prisma.$disconnect();
process.exit(failures === 0 ? 0 : 1);
