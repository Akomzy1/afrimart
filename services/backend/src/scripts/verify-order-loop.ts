/**
 * Drives the whole order loop through the live HTTP API, the way the apps do:
 * quote -> place -> each seller's merchant inbox -> accept -> ship.
 *
 * Uses a multi-seller basket on purpose. Run with: npx tsx src/loop.ts
 *
 * Buyers and stores are identified the way the apps are: a real session token
 * in the Authorization header. `identity` ("buyer:<id>" or "store:<id>") says
 * whose session to issue for the call; the server never sees it as a name.
 */
import { prisma } from "../db.js";
import { bearerFor } from "./callers.js";

const API = "http://localhost:4000/trpc";
const money = (c: number) => `$${(c / 100).toFixed(2)}`;

async function authHeader(identity?: string): Promise<Record<string, string>> {
  return identity ? { authorization: `Bearer ${await bearerFor(identity)}` } : {};
}

async function query(path: string, input: unknown, identity?: string) {
  const res = await fetch(`${API}/${path}?input=${encodeURIComponent(JSON.stringify(input))}`, {
    headers: await authHeader(identity),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${path}: ${body.error.message}`);
  return body.result.data;
}
async function mutate(path: string, input: unknown, identity?: string) {
  const res = await fetch(`${API}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(await authHeader(identity)) },
    body: JSON.stringify(input),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${path}: ${body.error.message}`);
  return body.result.data;
}

const NAMES = ["Egusi", "Red Palm Oil", "Plantain Flour", "Berbere"];
const cards = await query("catalogue.listingsForProducts", { names: NAMES });
console.log(`resolved ${cards.length} listings`);

const items = cards.map((c: { listingId: string }, i: number) => ({ listingId: c.listingId, quantity: i === 0 ? 2 : 1 }));
const destination = { street: "1200 Heritage Lane", city: "Houston", state: "TX", zip: "77002" };

const quote = await mutate("checkout.quote", { items, destination });
console.log(`\nQUOTE: ${quote.storeCount} stores, ${quote.pricing.parcelCount} parcels, ` +
  `items ${money(quote.pricing.itemsSubtotalCents)}, shipping ${money(quote.pricing.shippingCents)}, total ${money(quote.pricing.totalCents)}`);
for (const p of quote.parcels) console.log(`   ${p.storeName} (${p.metro}) — ${p.lines.length} lines`);

const placed = await mutate("checkout.place", { items, destination }, "buyer:demo-buyer");
console.log(`\nPLACED: order ${placed.orderId}, ${placed.parcelCount} parcels, total ${money(placed.pricing.totalCents)}`);

// Every seller that should now see work.
const stores = await prisma.store.findMany({ where: { onboardingStatus: "live" }, select: { id: true, name: true } });
const sellerNames = [...new Set(quote.parcels.map((p: { storeName: string }) => p.storeName))] as string[];
console.log(`\nMERCHANT INBOXES (${sellerNames.length} sellers expected to have work):`);

let totalItemsSeen = 0;
for (const name of sellerNames) {
  const store = stores.find((s: { name: string }) => s.name === name);
  if (!store) { console.log(`  !! no store record for ${name}`); continue; }
  const inbox = await query("merchant.inbox", undefined, `store:${store.id}`);
  const mine = inbox.filter((j: { orderRef: string }) => j.orderRef === `#${placed.orderId.slice(-4).toUpperCase()}`);
  for (const job of mine) {
    totalItemsSeen += job.items.length;
    console.log(`  ${name.padEnd(18)} ${job.orderRef}  ${job.status.padEnd(8)} ${money(job.valueCents).padStart(8)}  ` +
      `items: ${job.items.map((i: { name: string; qty: number }) => `${i.name}x${i.qty}`).join(", ")}`);
  }
  if (!mine.length) console.log(`  !! ${name} sees nothing for this order`);
}
console.log(`  -> ${totalItemsSeen} lines visible to sellers vs ${items.length} ordered`);

// Cross-store leakage check: no seller may see another seller's lines.
const first = stores.find((s: { name: string }) => s.name === sellerNames[0]);
if (!first) throw new Error(`no store record for ${sellerNames[0]}`);
const firstInbox = await query("merchant.inbox", undefined, `store:${first.id}`);
const firstJob = firstInbox.find((j: { orderRef: string }) => j.orderRef === `#${placed.orderId.slice(-4).toUpperCase()}`);
const othersLines = quote.parcels
  .filter((p: { storeName: string }) => p.storeName !== sellerNames[0])
  .flatMap((p: { lines: { name: string }[] }) => p.lines.map((l) => l.name));
const leaked = firstJob ? firstJob.items.filter((i: { name: string }) => othersLines.includes(i.name)) : [];
console.log(`\nISOLATION: ${sellerNames[0]} sees ${leaked.length} line(s) belonging to other stores -> ${leaked.length === 0 ? "OK" : "LEAK"}`);

// Fulfil one shipment end to end.
if (firstJob) {
  await mutate("merchant.accept", { shipmentId: firstJob.shipmentId }, `store:${first.id}`);
  const afterAccept = await query("merchant.inbox", undefined, `store:${first.id}`);
  const acc = afterAccept.find((j: { shipmentId: string }) => j.shipmentId === firstJob.shipmentId);
  console.log(`FULFIL: after accept status=${acc?.status} carrier=${acc?.carrier}`);
  // QC-2 — the parcel cannot leave without its box photo, so the loop takes one.
  try {
    await mutate("merchant.markShipped", { shipmentId: firstJob.shipmentId }, `store:${first.id}`);
    console.log("FULFIL: !! shipped with no packing photo");
  } catch (e) {
    console.log(`FULFIL: shipping without a box photo is refused -> OK (${(e as Error).message.split(": ").pop()})`);
  }
  const { default: sharp } = await import("sharp");
  const jpeg = await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 180, g: 140, b: 90 } } }).jpeg().toBuffer();
  await mutate("merchant.packingPhoto", { shipmentId: firstJob.shipmentId, image: jpeg.toString("base64") }, `store:${first.id}`);
  await mutate("merchant.markShipped", { shipmentId: firstJob.shipmentId }, `store:${first.id}`);
  const afterShip = await query("merchant.inbox", undefined, `store:${first.id}`);
  const shp = afterShip.find((j: { shipmentId: string }) => j.shipmentId === firstJob.shipmentId);
  console.log(`FULFIL: after ship   status=${shp?.status}`);

  const earn = await query("merchant.earnings", undefined, `store:${first.id}`);
  console.log(`EARNINGS for ${sellerNames[0]}: ${earn.orderCount} orders, gross ${money(earn.grossCents)}, net ${money(earn.netCents)}`);
}

await prisma.$disconnect();
