/**
 * QC-2 / QC-3 end to end: the packing photo, the buyer's reports, the refund,
 * and the identity and photo guarantees underneath them, against the real
 * database and the real routers.
 *
 * Creates throwaway buyers, a store, listings and orders, drives them through
 * the routers as the people who would, and removes them afterwards. Audit
 * entries are append-only by design and stay.
 *   npm run verify:claims --workspace=@afrimart/backend
 */
import { TRPCError } from "@trpc/server";
import sharp from "sharp";
import { prisma } from "../db.js";
import { appRouter } from "../router.js";
import { createCallerFactory } from "../trpc.js";
import type { ResolvedSession } from "../auth/session.js";

const createCaller = createCallerFactory(appRouter);
const P = "qc3v-";
const run = Date.now().toString(36);
const id = (s: string) => `${P}${run}-${s}`;

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`${pass ? "  ok  " : "  FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

async function sessionFor(email: string): Promise<ResolvedSession> {
  const u = await prisma.staffUser.findUniqueOrThrow({ where: { email } });
  return { sessionId: "verify", staffUserId: u.id, email: u.email, name: u.name, role: u.role, mfaVerified: true, mfaEnrolled: true };
}
const as = (staff: ResolvedSession | null, identity?: string) =>
  createCaller({ req: { headers: identity ? { "x-dev-identity": identity } : {} } as never, staff, ip: "127.0.0.1", userAgent: "verify" });

async function outcome<T>(p: Promise<T>): Promise<{ code: string; message: string; value?: T }> {
  try {
    return { code: "ok", message: "", value: await p };
  } catch (e) {
    if (e instanceof TRPCError) return { code: e.code, message: e.message };
    throw e;
  }
}

/** A JPEG that really carries a camera make, a description and a GPS position. */
async function photoWithLocation(): Promise<string> {
  const buf = await sharp({ create: { width: 320, height: 240, channels: 3, background: { r: 190, g: 150, b: 100 } } })
    .jpeg()
    .withExif({
      IFD0: { Make: "ZZVERIFYMAKE", ImageDescription: "ZZVERIFYHOME" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 30/1 26/1", GPSLongitudeRef: "W", GPSLongitude: "0/1 7/1 39/1" },
    })
    .toBuffer();
  if (!buf.includes(Buffer.from("ZZVERIFYMAKE"))) throw new Error("fixture photo carries no EXIF; the check would prove nothing");
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}

/** Fetch a stored photo back over the same path the server serves it from. */
async function storedBytes(url: string): Promise<Buffer> {
  const { photoStore } = await import("../storage/photos.js");
  const [, , kind, name] = url.split("/");
  const bytes = await photoStore.read(kind as "packing" | "claim", name!);
  if (!bytes) throw new Error(`photo not found: ${url}`);
  return bytes;
}

async function sweep() {
  const b = { buyerId: { startsWith: P } };
  await prisma.refundClaim.deleteMany({ where: b });
  await prisma.notification.deleteMany({ where: { orderId: { startsWith: P } } });
  await prisma.shipmentItem.deleteMany({ where: { shipmentId: { startsWith: P } } });
  await prisma.shipment.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.order.deleteMany({ where: b });
  await prisma.listing.deleteMany({ where: { storeId: { startsWith: P } } });
  await prisma.canonicalProduct.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.store.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.buyer.deleteMany({ where: { id: { startsWith: P } } });
}

const ops = as(await sessionFor("ops@afrimart.test"));
const finance = as(await sessionFor("finance@afrimart.test"));
await sweep();

try {
  const hub = await prisma.hubMetro.findFirstOrThrow();
  const storeId = id("store");
  const otherStoreId = id("store2");
  for (const sid of [storeId, otherStoreId]) {
    await prisma.store.create({
      data: { id: sid, name: `QC3 ${sid.slice(-6)}`, ownerName: "x", sellerType: "store", hubMetroId: hub.id, onboardingStatus: "live", verificationStatus: "verified" },
    });
  }
  const buyerA = id("buyerA");
  const buyerB = id("buyerB");
  for (const [bid, email] of [[buyerA, `a-${run}@qc3.test`], [buyerB, `b-${run}@qc3.test`]]) {
    await prisma.buyer.create({ data: { id: bid!, email: email! } });
  }
  const product = await prisma.canonicalProduct.create({
    data: { id: id("prod"), canonicalName: "QC3 Egusi", shortDescription: "x", usedDescription: "x", category: "Legumes & seeds", cuisine: "Nigerian", packSize: "500g", images: [], temperatureClass: "ambient", shippingWeightOz: 8 },
  });
  const listing = await prisma.listing.create({ data: { storeId, canonicalProductId: product.id, priceCents: 1000, temperatureClass: "ambient", shippingWeightOz: 8 } });

  async function makeOrder(tag: string, buyerId: string, shipment: { status: "pending" | "label_created" | "picked_up" | "in_transit" | "delivered"; eta?: Date; items: { name: string; qty: number; unitCents: number }[] }) {
    const orderId = id(`order-${tag}`);
    await prisma.order.create({ data: { id: orderId, buyerId, status: "placed", totalCents: 5000, shippingCents: 800, taxCents: 100 } });
    const shipmentId = id(`ship-${tag}`);
    await prisma.shipment.create({
      data: { id: shipmentId, orderId, storeId, temperatureClass: "ambient", status: shipment.status, estimatedDelivery: shipment.eta ?? null },
    });
    const itemIds: string[] = [];
    for (const [i, it] of shipment.items.entries()) {
      const row = await prisma.shipmentItem.create({
        data: {
          id: id(`item-${tag}-${i}`), shipmentId, listingId: listing.id, canonicalProductId: product.id, nameSnapshot: it.name,
          packSizeSnapshot: "500g", categorySnapshot: "Legumes & seeds", quantity: it.qty, unitPriceCents: it.unitCents, lineTotalCents: it.qty * it.unitCents,
        },
      });
      itemIds.push(row.id);
    }
    return { orderId, shipmentId, itemIds };
  }

  const store = as(null, `store:${storeId}`);
  const otherStore = as(null, `store:${otherStoreId}`);
  const a = as(null, `buyer:${buyerA}`);
  const b = as(null, `buyer:${buyerB}`);
  const nobody = as(null);

  console.log("=== QC-2 packing photo ===");
  const packing = await makeOrder("pack", buyerA, { status: "pending", items: [{ name: "Egusi", qty: 2, unitCents: 850 }] });
  const withLocation = await photoWithLocation();

  const early = await outcome(store.merchant.packingPhoto({ shipmentId: packing.shipmentId, image: withLocation }));
  check("a photo before the order is accepted is refused", early.code === "BAD_REQUEST", early.message);
  await store.merchant.accept({ shipmentId: packing.shipmentId });

  const unseen = await outcome(otherStore.merchant.packingPhoto({ shipmentId: packing.shipmentId, image: withLocation }));
  check("another store cannot photograph this store's parcel", unseen.code === "NOT_FOUND", unseen.code);
  const anon = await outcome(nobody.merchant.packingPhoto({ shipmentId: packing.shipmentId, image: withLocation }));
  check("an unidentified caller is refused", anon.code === "UNAUTHORIZED", anon.code);
  const junk = await outcome(store.merchant.packingPhoto({ shipmentId: packing.shipmentId, image: Buffer.from("<script>alert(1)</script>").toString("base64") }));
  check("something that is not a photo is refused", junk.code === "BAD_REQUEST", junk.message);

  const shipEarly = await outcome(store.merchant.markShipped({ shipmentId: packing.shipmentId }));
  check("the parcel cannot be handed over without its box photo", shipEarly.code === "BAD_REQUEST", shipEarly.message);
  const shipOther = await outcome(otherStore.merchant.markShipped({ shipmentId: packing.shipmentId }));
  check("another store cannot ship it either", shipOther.code === "NOT_FOUND", shipOther.code);

  const saved = await outcome(store.merchant.packingPhoto({ shipmentId: packing.shipmentId, image: withLocation }));
  check("the box photo is saved", saved.code === "ok" && saved.value!.photoUrl.startsWith("/photos/packing/"));
  const bytes = await storedBytes(saved.value!.photoUrl);
  check("the stored packing photo carries no camera, no description and no GPS", !bytes.includes(Buffer.from("ZZVERIFYMAKE")) && !bytes.includes(Buffer.from("ZZVERIFYHOME")) && !bytes.includes(Buffer.from("GPS")) && (await sharp(bytes).metadata()).exif === undefined);
  const row = await prisma.shipment.findUniqueOrThrow({ where: { id: packing.shipmentId } });
  check("the photo and when it was taken are on the shipment", row.packingPhotoUrl === saved.value!.photoUrl && row.packingPhotoAt !== null);
  const inbox = await store.merchant.inbox();
  check("the merchant's inbox reports it", inbox.find((j) => j.shipmentId === packing.shipmentId)?.packingPhotoUrl === saved.value!.photoUrl);
  const retake = await outcome(store.merchant.packingPhoto({ shipmentId: packing.shipmentId, image: withLocation }));
  check("a retake replaces the photo", retake.code === "ok" && retake.value!.photoUrl !== saved.value!.photoUrl);
  const shipped = await outcome(store.merchant.markShipped({ shipmentId: packing.shipmentId }));
  check("with the photo on record it ships", shipped.code === "ok");
  const afterShip = await outcome(store.merchant.packingPhoto({ shipmentId: packing.shipmentId, image: withLocation }));
  check("a shipped parcel's photo can no longer be changed", afterShip.code === "BAD_REQUEST", afterShip.message);

  console.log("\n=== QC-3 item reports ===");
  const del = await makeOrder("del", buyerA, {
    status: "delivered",
    items: [{ name: "Egusi", qty: 1, unitCents: 900 }, { name: "Garri", qty: 2, unitCents: 700 }, { name: "Palm oil", qty: 1, unitCents: 1500 }, { name: "Berbere", qty: 1, unitCents: 800 }],
  });
  await prisma.shipment.update({ where: { id: del.shipmentId }, data: { packingPhotoUrl: saved.value!.photoUrl, packingPhotoAt: new Date() } });
  const [egusi, garri, oil, berbere] = del.itemIds as [string, string, string, string];

  const view = await a.orders.detail({ orderId: del.orderId });
  check("the buyer sees their order with the reports open", view.parcels[0]!.itemReportBlock === null && view.parcels[0]!.items.length === 4);
  check("the packing photo is not shown to the buyer", !JSON.stringify(view).includes("/photos/packing"));
  check("another buyer cannot see this order", (await outcome(b.orders.detail({ orderId: del.orderId }))).code === "NOT_FOUND");
  check("nor report on its parcel", (await outcome(b.claims.submitParcelReport({ shipmentId: del.shipmentId }))).code === "NOT_FOUND");
  check("an unidentified caller sees no orders", (await outcome(nobody.orders.list())).code === "UNAUTHORIZED");

  const noPhoto = await outcome((a.claims.submitItemReport as unknown as (i: unknown) => Promise<unknown>)({ shipmentId: del.shipmentId, itemIds: [egusi], reason: "damaged" }));
  check("an item report without a photo is refused", noPhoto.code === "BAD_REQUEST", noPhoto.code);
  const badPhoto = await outcome(a.claims.submitItemReport({ shipmentId: del.shipmentId, itemIds: [egusi], reason: "damaged", photo: Buffer.from("not a photo").toString("base64") }));
  check("so is something that is not a photo", badPhoto.code === "BAD_REQUEST", badPhoto.message);
  const lateReason = await outcome((a.claims.submitItemReport as unknown as (i: unknown) => Promise<unknown>)({ shipmentId: del.shipmentId, itemIds: [egusi], reason: "late_delivery", photo: withLocation }));
  check("late delivery is not a reason a buyer can give", lateReason.code === "BAD_REQUEST", lateReason.code);
  const foreignItem = await outcome(a.claims.submitItemReport({ shipmentId: del.shipmentId, itemIds: [packing.itemIds[0]!], reason: "damaged", photo: withLocation }));
  check("items from another parcel cannot be named", foreignItem.code === "BAD_REQUEST", foreignItem.message);

  const small = await outcome(a.claims.submitItemReport({ shipmentId: del.shipmentId, itemIds: [egusi], reason: "damaged", photo: withLocation }));
  check("a small clean report is refunded straight away", small.code === "ok" && small.value!.refunded === true, small.message);
  const smallClaim = await prisma.refundClaim.findUniqueOrThrow({ where: { id: small.value!.claimId }, include: { items: true } });
  check("the refund is recorded once, for the right amount", smallClaim.refundedAt !== null && smallClaim.refundId !== null && smallClaim.amountCents === 900 && smallClaim.items.length === 1);
  check("the cost is assigned to the seller who packed it", smallClaim.recoveryTarget === "seller");
  const claimBytes = await storedBytes(smallClaim.photoUrl!);
  check("the buyer's claim photo is stripped of camera, description and GPS too", !claimBytes.includes(Buffer.from("ZZVERIFYMAKE")) && !claimBytes.includes(Buffer.from("GPS")) && (await sharp(claimBytes).metadata()).exif === undefined);

  const mail = await prisma.notification.findMany({ where: { orderId: del.orderId }, orderBy: { createdAt: "asc" } });
  const received = mail.find((m) => m.template === "report-received-item");
  const refunded = mail.find((m) => m.template === "refund-issued");
  check("the buyer is emailed that the report was received", Boolean(received) && received!.body.includes(small.value!.ref) && received!.recipient === `a-${run}@qc3.test`);
  check("and that $9.00 was refunded, not a sample amount", Boolean(refunded) && refunded!.body.includes("$9.00") && !refunded!.body.includes("13.50") && refunded!.subject.includes("$9.00"));
  check("each goes out once", mail.filter((m) => m.template === "refund-issued").length === 1 && mail.filter((m) => m.template === "report-received-item").length === 1);

  const again = await outcome(a.claims.submitItemReport({ shipmentId: del.shipmentId, itemIds: [egusi], reason: "spoiled", photo: withLocation }));
  check("the same item cannot be refunded twice", again.code === "CONFLICT", again.message);

  const missing = await outcome(a.claims.submitItemReport({ shipmentId: del.shipmentId, itemIds: [garri], reason: "missing_items", photo: withLocation }));
  check("'missing from the box' is not refunded on the spot", missing.code === "ok" && missing.value!.refunded === false);
  const missingClaim = await prisma.refundClaim.findUniqueOrThrow({ where: { id: missing.value!.claimId } });
  check("it waits for a person, with no refund recorded", missingClaim.status === "manual_review" && missingClaim.refundedAt === null);

  const big = await outcome(a.claims.submitItemReport({ shipmentId: del.shipmentId, itemIds: [oil, berbere], reason: "spoiled", photo: withLocation }));
  check("two items under one reason become one report", big.code === "ok" && big.value!.amountCents === 2300);
  const orderAfter = await a.orders.detail({ orderId: del.orderId });
  const stages = orderAfter.parcels[0]!.items.map((i) => i.claim?.stage ?? null);
  check("the buyer's order shows each item's report and its real state", stages[0] === "refunded" && stages[1] === "review");

  console.log("\n=== QC-3 reviewing and refunding ===");
  const queue = await finance.admin.refundClaims();
  const queued = queue.find((c) => c.id === missing.value!.claimId);
  check("the report is in the finance queue with the buyer's photo and the seller's packing photo", Boolean(queued?.photoUrl) && queued?.packingPhotoUrl === saved.value!.photoUrl);
  const byOps = await outcome(ops.admin.resolveRefundClaim({ claimId: missing.value!.claimId, decision: "approve", recoveryTarget: "seller" }));
  check("operations cannot decide a claim: that is finance's", byOps.code === "FORBIDDEN", byOps.code);
  const rejectRefunded = await outcome(finance.admin.resolveRefundClaim({ claimId: small.value!.claimId, decision: "reject" }));
  check("an already-refunded claim cannot be rejected", rejectRefunded.code === "BAD_REQUEST", rejectRefunded.message);

  const approve = await outcome(finance.admin.resolveRefundClaim({ claimId: missing.value!.claimId, decision: "approve", recoveryTarget: "seller", recoveredCents: 1400, note: "Not in the packing photo" }));
  check("approving a reviewed claim refunds the buyer", approve.code === "ok" && approve.value!.refundedAt !== null, approve.message);
  const refundedRows = await prisma.notification.count({ where: { orderId: del.orderId, template: "refund-issued" } });
  check("and emails them", refundedRows === 2);
  const reApprove = await outcome(finance.admin.resolveRefundClaim({ claimId: missing.value!.claimId, decision: "approve", recoveryTarget: "seller" }));
  check("approving again does nothing more", reApprove.code === "BAD_REQUEST", reApprove.message);
  const recovery = await outcome(finance.admin.resolveRefundClaim({ claimId: small.value!.claimId, decision: "approve", recoveryTarget: "seller", recoveredCents: 900 }));
  check("an auto-refunded claim can still be approved to record the recovery", recovery.code === "ok");
  const audit = await prisma.auditLogEntry.count({ where: { subjectId: missing.value!.claimId, action: "refund.approve" } });
  check("the decision is audited", audit === 1);

  const reject = await outcome(finance.admin.resolveRefundClaim({ claimId: big.value!.claimId, decision: "reject", note: "Photo shows undamaged goods" }));
  check("a reviewer can decline a report", reject.code === "ok" && reject.value!.status === "rejected");
  const freed = await a.orders.detail({ orderId: del.orderId });
  check("a declined report shows as declined and frees its items to be reported again", freed.parcels[0]!.items[2]!.claim === null && freed.parcels[0]!.claims.some((c) => c.stage === "declined"));

  console.log("\n=== QC-3 parcel reports ===");
  const transit = await makeOrder("transit", buyerA, { status: "in_transit", eta: new Date(Date.now() + 3 * 86_400_000), items: [{ name: "Egusi", qty: 1, unitCents: 900 }] });
  const tooSoon = await outcome(a.claims.submitParcelReport({ shipmentId: transit.shipmentId }));
  check("a parcel inside its expected date cannot be reported yet", tooSoon.code === "BAD_REQUEST", tooSoon.message);
  const itemOnTransit = await outcome(a.claims.submitItemReport({ shipmentId: transit.shipmentId, itemIds: [transit.itemIds[0]!], reason: "damaged", photo: withLocation }));
  check("nor can its items be reported as damaged", itemOnTransit.code === "BAD_REQUEST", itemOnTransit.message);

  const late = await makeOrder("late", buyerA, { status: "in_transit", eta: new Date(Date.now() - 2 * 86_400_000), items: [{ name: "Egusi", qty: 1, unitCents: 900 }, { name: "Garri", qty: 1, unitCents: 700 }] });
  const lateView = await a.orders.detail({ orderId: late.orderId });
  check("once the expected date has passed the order offers it", lateView.parcels[0]!.parcelReportBlock === null);
  const reported = await outcome(a.claims.submitParcelReport({ shipmentId: late.shipmentId, note: "Checked: Neighbours." }));
  check("the report is accepted with no photo", reported.code === "ok" && reported.value!.refunded === false, reported.message);
  const parcelClaim = await prisma.refundClaim.findUniqueOrThrow({ where: { id: reported.value!.claimId } });
  check("it always goes to a person and is never refunded automatically", parcelClaim.status === "manual_review" && parcelClaim.refundedAt === null && parcelClaim.photoUrl === null);
  check("a scanned parcel is the carrier's cost", parcelClaim.recoveryTarget === "carrier");
  check("the parcel report email names the report", (await prisma.notification.findMany({ where: { orderId: late.orderId, template: "report-received-parcel" } })).some((m) => m.body.includes(reported.value!.ref)));
  check("it cannot be reported twice", (await outcome(a.claims.submitParcelReport({ shipmentId: late.shipmentId }))).code === "CONFLICT");

  const unscanned = await makeOrder("unscanned", buyerA, { status: "label_created", eta: new Date(Date.now() - 86_400_000), items: [{ name: "Egusi", qty: 1, unitCents: 900 }] });
  const unscannedReport = await outcome(a.claims.submitParcelReport({ shipmentId: unscanned.shipmentId }));
  const unscannedClaim = await prisma.refundClaim.findUniqueOrThrow({ where: { id: unscannedReport.value!.claimId } });
  check("a parcel the carrier never scanned counts against the seller", unscannedClaim.recoveryTarget === "seller");

  const list = await a.orders.list();
  check("the buyer's list carries all of it, newest first", list.length >= 4 && list.every((o, i, arr) => i === 0 || new Date(arr[i - 1]!.placedAt) >= new Date(o.placedAt)));
} finally {
  await sweep();
  await prisma.$disconnect();
}

console.log(failures === 0 ? "\nAll QC-2 / QC-3 checks passed." : `\n${failures} QC-2 / QC-3 check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
