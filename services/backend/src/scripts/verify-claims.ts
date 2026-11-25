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
import { randomUUID } from "node:crypto";
import { matchDelivery } from "../catalogue/delivery.js";
import { readDelivery } from "../catalogue/providers.js";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { prisma } from "../db.js";
import { callerFor } from "./callers.js";
import { parsePhotoPath } from "../storage/access.js";
import type { ResolvedSession } from "../auth/session.js";

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
const as = (staff: ResolvedSession | null, identity?: string) => callerFor({ staff, identity });

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

/** A signed link (`/photos/kind/name?exp=..&sig=..`) back to the stored path (`/photos/kind/name`). */
function stripLink<T extends string | null | undefined>(link: T): T extends string ? string : null {
  return (link ? link.split("?")[0]! : null) as never;
}

/** Fetch a stored photo back over the same path the server serves it from. */
async function storedBytes(url: string): Promise<Buffer> {
  const { photoStore } = await import("../storage/store.js");
  const photo = parsePhotoPath(stripLink(url));
  if (!photo) throw new Error("Unexpected stored photo path");
  const bytes = await photoStore.read(photo.kind, photo.name);
  if (!bytes) throw new Error(`photo not found: ${url}`);
  return bytes;
}

async function sweep() {
  const b = { buyerId: { startsWith: P } };
  await prisma.userSession.deleteMany({ where: { OR: [{ buyerId: { startsWith: P } }, { storeId: { startsWith: P } }] } });
  await prisma.refundClaim.deleteMany({ where: b });
  const orders = await prisma.order.findMany({ where: b, select: { id: true } });
  const orderIds = { in: orders.map(o => o.id) };
  await prisma.notification.deleteMany({ where: { orderId: orderIds } });
  await prisma.payout.deleteMany({ where: { orderId: orderIds } });
  await prisma.payment.deleteMany({ where: { orderId: orderIds } });
  await prisma.shipmentItem.deleteMany({ where: { shipmentId: { startsWith: P } } });
  await prisma.shipment.deleteMany({ where: { orderId: orderIds } });
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
  for (const [sid, ownerPhone] of [[storeId, "+12025550171"], [otherStoreId, "+12025550172"]] as const) {
    await prisma.store.create({
      data: { id: sid, name: `QC3 ${sid.slice(-6)}`, ownerName: "x", ownerPhone, ownerPhoneVerifiedAt: new Date(), sellerType: "store", hubMetroId: hub.id, onboardingStatus: "live", verificationStatus: "verified" },
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

  console.log("=== Timed listing availability ===");
  const listingRef = { listingId: listing.id };
  const future = new Date(Date.now() + 86400_000).toISOString();
  const pause = { ...listingRef, expectedUpdatedAt: listing.updatedAt.toISOString(), until: future };
  const basket = { items: [{ ...listingRef, quantity: 1 }], destination: { street: "123 Main St", city: "Dallas", state: "TX", zip: "75201" } };
  check("another seller cannot pause a listing", (await outcome(otherStore.merchant.pauseListing(pause))).code === "NOT_FOUND");
  await Promise.all([store.merchant.pauseListing(pause), store.merchant.pauseListing(pause)]);
  await store.merchant.updateListing({ ...listingRef, priceCents: listing.priceCents });
  const during = (await store.merchant.listings()).find(l => l.id === listing.id);
  check("a price edit preserves the confirmed pause and the seller can still edit it", during?.pausedUntil?.toISOString() === future && !during.inStock && !during.hidden);
  check("a paused listing is absent from buyer detail and routing", (await outcome(a.catalogue.detail(listingRef))).code === "NOT_FOUND" && (await a.checkout.quote(basket)).unfulfillable.length === 1);
  check("a stale basket cannot buy a paused listing", (await outcome(a.checkout.place(basket))).code === "BAD_REQUEST");
  await store.merchant.updateListing({ ...listingRef, priceCents: listing.priceCents, inStock: false });
  check("a manual out-of-stock decision supersedes the timer", (await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } })).pausedUntil === null &&
    (await a.checkout.quote(basket)).unfulfillable.length === 1 && (await outcome(store.merchant.pauseListing(pause))).code === "CONFLICT");
  // Move the stored deadline behind the clock to exercise the production reads without waiting a day.
  await prisma.listing.update({ where: { id: listing.id }, data: { stockStatus: "made_to_order", pausedUntil: new Date(Date.now() - 1000) } });
  check("an elapsed deadline restores the original listing on browse and checkout", (await a.catalogue.detail(listingRef)).madeToOrder && (await a.checkout.quote(basket)).unfulfillable.length === 0);

  console.log("=== Delivery stock counts ===");
  const envKeys = ["DELIVERY_EXTRACTION_ENABLED", "SHELF_VISION_MODEL", "ANTHROPIC_API_KEY", "SHELF_DAILY_BUDGET_CENTS", "SHELF_VISION_INPUT_RATE", "SHELF_VISION_OUTPUT_RATE"];
  const previous = envKeys.map(key => process.env[key]);
  try {
    process.env.DELIVERY_EXTRACTION_ENABLED = "no";
    const preview = await store.merchant.previewDelivery({ image: await photoWithLocation() });
    check("an unavailable reader leaves the delivery for manual review", !preview.available && !preview.rows.length);
    Object.assign(process.env, { DELIVERY_EXTRACTION_ENABLED: "yes", SHELF_VISION_MODEL: "fixture", ANTHROPIC_API_KEY: "fixture",
      SHELF_DAILY_BUDGET_CENTS: "10", SHELF_VISION_INPUT_RATE: "1", SHELF_VISION_OUTPUT_RATE: "1" });
    const sample = { name: "Melon seeds", packSize: "0.5 kg", units: 3 };
    const reading = await readDelivery(storeId, Buffer.from("fixture"), async (url, options) => {
      const request = JSON.parse(String(options?.body));
      if (request.tool_choice.name !== "record_delivery") throw Error("Unexpected vision tool");
      return Response.json(String(url).endsWith("/count_tokens") ? { input_tokens: 20 } :
        { stop_reason: "tool_use", usage: { input_tokens: 20, output_tokens: 12 }, content: [{ type: "tool_use", name: "record_delivery", input: { products: [sample] } }] });
    });
    const item = { id: listing.id, canonicalProduct: { ...product, aliases: [{ alias: "Melon seeds" }] } };
    check("photo counts match an alias and equivalent pack size, leaving ambiguous packs for the seller",
      matchDelivery(reading.products, [item])[0]?.listingId === listing.id &&
      matchDelivery(reading.products, [item, { ...item, id: "second" }])[0]?.listingId === null);
  } finally {
    envKeys.forEach((key, i) => { if (previous[i] == null) delete process.env[key]; else process.env[key] = previous[i]; });
    await prisma.extractionUsage.deleteMany({ where: { storeId, model: "fixture" } });
  }
  const balance = async () => (await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } })).unitsAvailable;
  check("preview leaves the listing unchanged", await balance() === null);
  const delivery = { requestId: randomUUID(), lines: [{ ...listingRef, opening: 1, units: 3 }] };
  check("other stores cannot receive this listing", (await outcome(otherStore.merchant.receiveDelivery(delivery))).code === "CONFLICT");
  await Promise.all([store.merchant.receiveDelivery(delivery), store.merchant.receiveDelivery(delivery)]);
  check("a concurrent retry records four available units once", await balance() === 4);
  check("a changed replay is refused", (await outcome(store.merchant.receiveDelivery({ ...delivery, lines: [{ ...listingRef, opening: 1, units: 8 }] }))).code === "CONFLICT");
  const addition = { requestId: randomUUID(), lines: [{ ...listingRef, opening: null, units: 1 }] };
  check("an invalid line rolls the entire delivery back",
    (await outcome(store.merchant.receiveDelivery({ ...addition, lines: [...addition.lines, { listingId: "zz-missing", opening: 0, units: 2 }] }))).code === "CONFLICT" && await balance() === 4);
  await store.merchant.receiveDelivery(addition);
  const fullBasket = { ...basket, items: [{ ...listingRef, quantity: 5 }] };
  check("checkout respects the recorded balance", (await a.checkout.quote({ ...basket, items: [{ ...listingRef, quantity: 6 }] })).unfulfillable.length === 1);
  const orders = await Promise.all([outcome(a.checkout.place(fullBasket)), outcome(a.checkout.place(fullBasket))]);
  const placed = orders.find(o => o.value)?.value;
  check("concurrent orders cannot sell the same units twice", orders.filter(o => o.code === "ok").length === 1 && await balance() === 0);
  if (placed) {
    const parcel = await prisma.shipment.findFirstOrThrow({ where: { orderId: placed.orderId } });
    await ops.admin.interveneShipment({ shipmentId: parcel.id, action: "cancel_order" });
    await ops.admin.interveneShipment({ shipmentId: parcel.id, action: "cancel_order" });
    check("cancelling an unshipped order releases its units once", await balance() === 5);
  }
  const nextOrder = await a.checkout.place(fullBasket);
  const nextParcel = await prisma.shipment.findFirstOrThrow({ where: { orderId: nextOrder.orderId } });
  const decline = { shipmentId: nextParcel.id, reason: "Cannot fulfil" };
  await Promise.all([store.merchant.decline(decline), store.merchant.decline(decline)]);
  await ops.admin.interveneShipment({ shipmentId: nextParcel.id, action: "cancel_order" });
  check("a repeated decline followed by cancellation credits a reservation once", await balance() === 5);

  const shippedOrder = await a.checkout.place(fullBasket);
  const shippedParcel = await prisma.shipment.findFirstOrThrow({ where: { orderId: shippedOrder.orderId } });
  await ops.admin.interveneShipment({ shipmentId: shippedParcel.id, action: "mark_shipped" });
  await ops.admin.interveneShipment({ shipmentId: shippedParcel.id, action: "cancel_order" });
  check("cancelling after dispatch does not return shipped units", await balance() === 0);
  const current = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
  await store.merchant.pauseListing({ ...pause, expectedUpdatedAt: current.updatedAt.toISOString() });
  await store.merchant.receiveDelivery({ ...addition, requestId: randomUUID() });
  check("restocking preserves the seller's pause", await balance() === 1 && (await a.checkout.quote(basket)).unfulfillable.length === 1);
  console.log("=== Merchant declines ===");
  const refusal = await makeOrder("decline", buyerA, { status: "pending", items: [] });
  const sibling = await prisma.shipment.create({ data: { id: id("sibling"), orderId: refusal.orderId, storeId: otherStoreId, temperatureClass: "ambient" } });
  const shipmentId = refusal.shipmentId;
  const reason = "Out of stock";
  check("a different store cannot decline the parcel", (await outcome(otherStore.merchant.decline({ shipmentId, reason }))).code === "NOT_FOUND");
  check("an empty reason is refused", (await outcome(store.merchant.decline({ shipmentId, reason: "   " }))).code === "BAD_REQUEST");
  check("an overlong reason is refused", (await outcome(store.merchant.decline({ shipmentId, reason: "a".repeat(501) }))).code === "BAD_REQUEST");
  const decisions = await Promise.all([reason, `  ${reason}  `].map(r => store.merchant.decline({ shipmentId, reason: r })));
  check("declining does not request a carrier pickup", await prisma.shipmentPickup.count({ where: { shipmentId } }) === 0);
  check("repeating the decline returns the saved reason", decisions.every(d => d.status === "declined" && d.declineReason === reason));
  check("a retry cannot overwrite the reason", (await outcome(store.merchant.decline({ shipmentId, reason: "Changed" }))).code === "CONFLICT");
  check("a declined parcel cannot be accepted or shipped", (await outcome(store.merchant.accept({ shipmentId }))).code === "CONFLICT" && (await outcome(store.merchant.markShipped({ shipmentId }))).code === "CONFLICT");
  const declinedRow = (await store.merchant.inbox()).find(s => s.shipmentId === shipmentId);
  check("the merchant inbox shows the saved reason", declinedRow?.status === "declined" && declinedRow.declineReason === reason);
  const staffRow = (await ops.admin.fulfilment()).find(s => s.shipmentId === shipmentId);
  check("operations can see the reason", staffRow?.declineReason === reason);
  const orderView = await a.orders.detail({ orderId: refusal.orderId });
  check("only the declining store's parcel changes", orderView.parcels.find(s => s.shipmentId === shipmentId)?.status === "declined" && orderView.parcels.find(s => s.shipmentId === sibling.id)?.status === "pending");

  const race = await makeOrder("decision", buyerA, { status: "pending", items: [] });
  const [acceptResult, declineResult] = await Promise.all([
    outcome(store.merchant.accept({ shipmentId: race.shipmentId })),
    outcome(store.merchant.decline({ shipmentId: race.shipmentId, reason })),
  ]);
  const winner = await prisma.shipment.findUniqueOrThrow({ where: { id: race.shipmentId } });
  check("competing decisions commit exactly one outcome", winner.status === "declined"
    ? declineResult.code === "ok" && acceptResult.code === "CONFLICT" && winner.trackingNumber === null && winner.declineReason === reason
    : winner.status === "label_created" && acceptResult.code === "ok" && declineResult.code === "CONFLICT" && winner.declineReason === null);

  console.log("=== QC-2 packing photo ===");
  const packing = await makeOrder("pack", buyerA, { status: "pending", items: [{ name: "Egusi", qty: 2, unitCents: 850 }] });
  const withLocation = await photoWithLocation();

  const packingItem = async () => (await store.merchant.inbox()).find(s => s.shipmentId === packing.shipmentId)?.items[0];
  check("a listing starts without a packing-list photo", (await packingItem())?.productPhoto === null);
  const foreignListing = await prisma.listing.create({ data: { storeId: otherStoreId, canonicalProductId: product.id, priceCents: 900, temperatureClass: "ambient", shippingWeightOz: 8 } });
  await otherStore.merchant.saveProductPhoto({ listingId: foreignListing.id, image: withLocation });
  check("another shop's photo of the same product stays out of the packing list", (await packingItem())?.productPhoto === null);
  check("another shop cannot replace the seller's listing photo", (await outcome(otherStore.merchant.saveProductPhoto({ listingId: listing.id, image: withLocation }))).code === "NOT_FOUND");
  await store.merchant.saveProductPhoto({ listingId: listing.id, image: withLocation });
  const productPath = stripLink((await packingItem())?.productPhoto);
  check("the existing order shows its own listing photo", !!productPath?.startsWith("/photos/product/") && productPath === stripLink((await store.merchant.listings()).find(l => l.id === listing.id)?.productPhoto));
  const replacement = await sharp({ create: { width: 900, height: 600, channels: 3, background: "blue" } }).jpeg().toBuffer();
  await store.merchant.saveProductPhoto({ listingId: listing.id, image: replacement.toString("base64") });
  const replaced = await storedBytes((await packingItem())!.productPhoto!);
  check("a retake replaces the listing thumbnail", stripLink((await packingItem())?.productPhoto) === productPath && (await sharp(replaced).metadata()).width === 640);

  const early = await outcome(store.merchant.packingPhoto({ shipmentId: packing.shipmentId, image: withLocation }));
  check("a photo before the order is accepted is refused", early.code === "BAD_REQUEST", early.message);
  const acceptPacking = () => store.merchant.accept({ shipmentId: packing.shipmentId });
  const labelInput = { shipmentId: packing.shipmentId, paper: "4x6" as const };
  check("a pending parcel has no printable label", (await outcome(store.merchant.shippingLabel(labelInput))).code === "PRECONDITION_FAILED");
  check("a declined parcel has no printable label", (await outcome(store.merchant.shippingLabel({ ...labelInput, shipmentId: refusal.shipmentId }))).code === "PRECONDITION_FAILED");
  const accepted = await Promise.all([acceptPacking(), acceptPacking()]);
  const pickupWhere = { shipmentId: packing.shipmentId };
  const pickup = await prisma.shipmentPickup.findUniqueOrThrow({ where: pickupWhere });
  check("simultaneous accepts reserve one test pickup window", pickup.state === "test_scheduled" &&
    !!pickup.windowStart && !!pickup.windowEnd && pickup.windowStart > pickup.requestedAt &&
    pickup.windowEnd.getTime() - pickup.windowStart.getTime() === 2 * 3600_000);
  await acceptPacking();
  const repeatedPickup = await prisma.shipmentPickup.findUniqueOrThrow({ where: pickupWhere });
  check("a later accept preserves the original request and window", repeatedPickup.requestedAt.getTime() === pickup.requestedAt.getTime() &&
    repeatedPickup.windowStart?.getTime() === pickup.windowStart?.getTime() && repeatedPickup.windowEnd?.getTime() === pickup.windowEnd?.getTime());
  check("the shop can reopen its test pickup", (await store.merchant.inbox()).find(s => s.shipmentId === packing.shipmentId)?.pickup?.state === "test_scheduled");
  check("another shop cannot see this pickup", !(await otherStore.merchant.inbox()).some(s => s.shipmentId === packing.shipmentId));
  const cancel = await makeOrder("cancelPickup", buyerA, { status: "pending", items: [] });
  await Promise.all([outcome(store.merchant.accept({ shipmentId: cancel.shipmentId })),
    ops.admin.interveneShipment({ shipmentId: cancel.shipmentId, action: "cancel_order" })]);
  check("cancellation racing acceptance leaves no active pickup", await prisma.shipmentPickup.count({
    where: { shipmentId: cancel.shipmentId, state: { not: "cancelled" } },
  }) === 0 && (await outcome(store.merchant.accept({ shipmentId: cancel.shipmentId }))).code === "CONFLICT");
  const expectedTracking = `TRK${packing.shipmentId.slice(-8).toUpperCase()}`;
  const thermal = await store.merchant.shippingLabel(labelInput);
  const repeat = await store.merchant.shippingLabel(labelInput);
  const letter = await store.merchant.shippingLabel({ ...labelInput, paper: "letter" });
  check("reprinting returns the same test PDF", thermal.kind === "test" && repeat.kind === "test" && thermal.pdf === repeat.pdf);
  for (const [label, width, height] of [[thermal, 288, 432], [letter, 612, 792]] as const) {
    const doc = label.kind === "test" ? await PDFDocument.load(Buffer.from(label.pdf, "base64")) : null;
    check(`label renders one ${width} by ${height} point page`, doc?.getPageCount() === 1 && doc.getPage(0).getWidth() === width && doc.getPage(0).getHeight() === height);
  }
  check("another seller cannot retrieve the label", (await outcome(otherStore.merchant.shippingLabel(labelInput))).code === "NOT_FOUND");
  check("a buyer cannot retrieve the merchant label", (await outcome(a.merchant.shippingLabel(labelInput))).code === "UNAUTHORIZED");
  const afterPrint = await prisma.shipment.findUniqueOrThrow({ where: { id: packing.shipmentId } });
  check("printing preserves the accepted shipment", afterPrint.updatedAt.getTime() === accepted[0]!.updatedAt.getTime() && afterPrint.trackingNumber === expectedTracking);
  check("simultaneous accepts return the same label", accepted.every(s => s.status === "label_created" && s.trackingNumber === expectedTracking));

  const tracked = await makeOrder("tracked", buyerA, { status: "pending", items: [] });
  const trackedWhere = { id: tracked.shipmentId };
  const carrierTracking = "carrier-issued-tracking";
  const issuedUrl = "https://carrier.example/issued.pdf";
  await prisma.shipment.update({ where: trackedWhere, data: { trackingNumber: carrierTracking, labelUrl: issuedUrl } });
  const acceptedTracked = await store.merchant.accept({ shipmentId: tracked.shipmentId });
  const pendingPickup = await prisma.shipmentPickup.findUniqueOrThrow({ where: { shipmentId: tracked.shipmentId } });
  check("a carrier-labelled parcel awaits a real booking", pendingPickup.state === "awaiting_carrier" && pendingPickup.windowStart === null);
  const issued = await store.merchant.shippingLabel({ shipmentId: tracked.shipmentId, paper: "4x6" });
  check("an issued carrier label takes precedence over a test PDF", issued.kind === "issued" && issued.url === issuedUrl);
  check("accepting preserves a preassigned tracking number", acceptedTracked.status === "label_created" && acceptedTracked.trackingNumber === carrierTracking);
  for (const status of ["label_created", "picked_up", "in_transit", "delivered", "exception"] as const) {
    const before = await prisma.shipment.update({ where: trackedWhere, data: { status, updatedAt: new Date("2024-01-01T00:00:00Z") } });
    const retry = await store.merchant.accept({ shipmentId: tracked.shipmentId });
    const saved = await prisma.shipment.findUniqueOrThrow({ where: trackedWhere });
    check(`an accept retry leaves a ${status} shipment untouched`, [retry, saved].every(s =>
      s.status === status && s.trackingNumber === carrierTracking && s.updatedAt.getTime() === before.updatedAt.getTime()));
  }

  await ops.admin.interveneShipment({ shipmentId: tracked.shipmentId, action: "cancel_order" });
  check("cancelling an accepted order cancels its pickup request", (await prisma.shipmentPickup.findUniqueOrThrow({
    where: { shipmentId: tracked.shipmentId },
  })).state === "cancelled");

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
  check("the photo and when it was taken are on the shipment", row.packingPhotoUrl === stripLink(saved.value!.photoUrl) && row.packingPhotoAt !== null);
  const inbox = await store.merchant.inbox();
  check("the merchant's inbox reports it", stripLink(inbox.find((j) => j.shipmentId === packing.shipmentId)?.packingPhotoUrl) === stripLink(saved.value!.photoUrl));
  const retake = await outcome(store.merchant.packingPhoto({ shipmentId: packing.shipmentId, image: withLocation }));
  check("a retake replaces the photo", retake.code === "ok" && stripLink(retake.value!.photoUrl) !== stripLink(saved.value!.photoUrl));
  const shipped = await outcome(store.merchant.markShipped({ shipmentId: packing.shipmentId }));
  check("with the photo on record it ships", shipped.code === "ok");
  const afterShip = await outcome(store.merchant.packingPhoto({ shipmentId: packing.shipmentId, image: withLocation }));
  check("a shipped parcel's photo can no longer be changed", afterShip.code === "BAD_REQUEST", afterShip.message);

  console.log("\n=== QC-3 item reports ===");
  const del = await makeOrder("del", buyerA, {
    status: "delivered",
    items: [{ name: "Egusi", qty: 1, unitCents: 900 }, { name: "Garri", qty: 2, unitCents: 700 }, { name: "Palm oil", qty: 1, unitCents: 1500 }, { name: "Berbere", qty: 1, unitCents: 800 }],
  });
  await prisma.shipment.update({ where: { id: del.shipmentId }, data: { packingPhotoUrl: stripLink(saved.value!.photoUrl), packingPhotoAt: new Date() } });
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
  check("the report is in the finance queue with the buyer's photo and the seller's packing photo", queued?.hasPhoto === true && queued?.hasPackingPhoto === true);
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
  console.log("\n=== identity: nobody can act as, or on behalf of, another account ===");
  const photoForClaim = await photoWithLocation();
  const aDelivered = await makeOrder("idA", buyerA, { status: "delivered", items: [{ name: "Egusi", qty: 1, unitCents: 900 }] });
  const aLate = await makeOrder("idLate", buyerA, { status: "in_transit", eta: new Date(Date.now() - 86_400_000), items: [{ name: "Egusi", qty: 1, unitCents: 900 }] });
  const claimRows = (shipmentId: string) => prisma.refundClaim.count({ where: { shipmentId } });

  const stealItem = await outcome(b.claims.submitItemReport({ shipmentId: aDelivered.shipmentId, itemIds: aDelivered.itemIds, reason: "damaged", photo: photoForClaim }));
  check("another buyer cannot file an item report on this order's parcel", stealItem.code === "NOT_FOUND", stealItem.code);
  const smuggleOwner = await outcome(
    (b.claims.submitItemReport as unknown as (i: unknown) => Promise<unknown>)({ shipmentId: aDelivered.shipmentId, itemIds: aDelivered.itemIds, reason: "damaged", photo: photoForClaim, buyerId: buyerA }),
  );
  check("naming the owner in the input does not help", smuggleOwner.code === "NOT_FOUND", smuggleOwner.code);
  const stealParcel = await outcome(b.claims.submitParcelReport({ shipmentId: aLate.shipmentId }));
  check("nor a parcel report on it", stealParcel.code === "NOT_FOUND", stealParcel.code);
  check("no report was created against either parcel, and no photo kept for the attempt", (await claimRows(aDelivered.shipmentId)) === 0 && (await claimRows(aLate.shipmentId)) === 0);
  check("it does not even confirm the order exists: same answer as an order that is not there", (await outcome(b.orders.detail({ orderId: aDelivered.orderId }))).message === (await outcome(b.orders.detail({ orderId: "no-such-order" }))).message);

  const ownClaim = await outcome(
    (a.claims.submitItemReport as unknown as (i: unknown) => Promise<{ claimId: string }>)({ shipmentId: aDelivered.shipmentId, itemIds: aDelivered.itemIds, reason: "damaged", photo: photoForClaim, buyerId: buyerB }),
  );
  const ownRow = ownClaim.value ? await prisma.refundClaim.findUnique({ where: { id: ownClaim.value.claimId } }) : null;
  check("naming someone else as the buyer is ignored: the report is the caller's", ownClaim.code === "ok" && ownRow?.buyerId === buyerA, `${ownClaim.code} ${ownRow?.buyerId}`);

  const aPacking = await makeOrder("idPack", buyerA, { status: "label_created", items: [{ name: "Egusi", qty: 1, unitCents: 900 }] });
  const steal = await outcome(otherStore.merchant.packingPhoto({ shipmentId: aPacking.shipmentId, image: withLocation }));
  const stealSmuggled = await outcome(
    (otherStore.merchant.packingPhoto as unknown as (i: unknown) => Promise<unknown>)({ shipmentId: aPacking.shipmentId, image: withLocation, storeId }),
  );
  check("another seller cannot upload a packing photo for this seller's parcel", steal.code === "NOT_FOUND", steal.code);
  check("naming the owning store in the input does not help", stealSmuggled.code === "NOT_FOUND", stealSmuggled.code);
  const untouched = await prisma.shipment.findUniqueOrThrow({ where: { id: aPacking.shipmentId } });
  check("the parcel has no photo and no change after the attempts", untouched.packingPhotoUrl === null && untouched.packingPhotoAt === null && untouched.status === "label_created");
  check("another seller cannot accept or ship it either", (await outcome(otherStore.merchant.accept({ shipmentId: aPacking.shipmentId }))).code === "NOT_FOUND" && (await outcome(otherStore.merchant.markShipped({ shipmentId: aPacking.shipmentId }))).code === "NOT_FOUND");
  check("its inbox does not list it", !(await otherStore.merchant.inbox()).some((j) => j.shipmentId === aPacking.shipmentId));
  check("a buyer's session is not a seller's", (await outcome(a.merchant.packingPhoto({ shipmentId: aPacking.shipmentId, image: withLocation }))).code === "UNAUTHORIZED");
  check("and a seller's session is not a buyer's", (await outcome(store.claims.submitParcelReport({ shipmentId: aLate.shipmentId }))).code === "UNAUTHORIZED");
} finally {
  await sweep();
  await prisma.$disconnect();
}

console.log(failures === 0 ? "\nAll QC-2 / QC-3 checks passed." : `\n${failures} QC-2 / QC-3 check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
