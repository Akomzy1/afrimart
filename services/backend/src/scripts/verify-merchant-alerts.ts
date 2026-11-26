import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { generateVAPIDKeys } from "web-push";
import { BrowserPushSender } from "../notifications/webPush.js";
import { issueUserSession } from "../auth/userSession.js";
import { callerFor } from "./callers.js";
import { prisma } from "../db.js";
import { deliverMerchantAlert } from "../notifications/merchantAlerts.js";
import { queueMerchantAlerts } from "../notifications/pipeline.js";
import { DisabledSmsSender, MemoryPushSender, setSenders, type SmsMessage } from "../notifications/senders.js";
import { assertDevOnlyAllowed } from "../runtime.js";

assertDevOnlyAllowed();
const hub = await prisma.hubMetro.findFirstOrThrow();
const store = await prisma.store.create({ data: { name: "Order alert fixture", ownerName: "Fixture", hubMetroId: hub.id, sellerType: "store" } });
const buyer = await prisma.buyer.create({ data: { email: randomUUID() + "@fixture.test" } });
const number = "+12025550186";
const captured: SmsMessage[] = [];
const recordSms = { name: "fixture", enabled: true, async send(msg: SmsMessage) { captured.push(msg); } };
const pushOff = { name: "unavailable", async send() { return false; } };
const orderIds: string[] = [];

async function pendingOrder() {
  const order = await prisma.order.create({ data: { buyerId: buyer.id, totalCents: 1500, shippingCents: 500, taxCents: 0 } });
  orderIds.push(order.id);
  for (let i = 0; i < 2; i++) await prisma.shipment.create({ data: { orderId: order.id, storeId: store.id, temperatureClass: "ambient" } });
  await prisma.$transaction(async tx => {
    assert.deepEqual(await queueMerchantAlerts(tx, order.id), [store.id]);
    assert.deepEqual(await queueMerchantAlerts(tx, order.id), []);
  });
  const push = await prisma.notification.findFirstOrThrow({ where: { orderId: order.id, channel: "push" } });
  return { orderId: order.id, pushId: push.id };
}
async function fallback() {
  const order = await pendingOrder();
  await Promise.all([deliverMerchantAlert(order.pushId), deliverMerchantAlert(order.pushId)]);
  const rows = await prisma.notification.findMany({ where: { orderId: order.orderId, channel: "sms" } });
  assert.equal(rows.length, 1);
  return { ...order, smsId: rows[0]!.id };
}
try {
  setSenders({ push: new MemoryPushSender(), sms: recordSms });
  const first = await pendingOrder();
  assert.equal(await deliverMerchantAlert(first.pushId), "sent");
  assert.equal(await prisma.notification.count({ where: { orderId: first.orderId, channel: "sms" } }), 0);

  setSenders({ push: pushOff });
  const unverified = await fallback();
  assert.equal(await deliverMerchantAlert(unverified.smsId), "suppressed");
  assert.equal(captured.length, 0);
  await prisma.store.update({ where: { id: store.id }, data: { ownerPhone: number, ownerPhoneVerifiedAt: new Date() } });

  const vapid = generateVAPIDKeys();
  Object.assign(process.env, { VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: "mailto:test@fixture.test" });
  const phone = callerFor({ identity: "store:" + store.id });
  const tablet = callerFor({ rawToken: (await issueUserSession({ kind: "store", storeId: store.id }, {})).token });
  const device = { endpoint: "https://fcm.googleapis.com/fcm/send/" + randomUUID(), applicationKey: vapid.publicKey,
    p256dh: generateVAPIDKeys().publicKey, auth: randomBytes(16).toString("base64url") };
  const second = { ...device, endpoint: "https://updates.push.services.mozilla.com/wpush/v2/" + randomUUID() };
  await assert.rejects(callerFor({}).merchant.registerPush(device));
  await assert.rejects(phone.merchant.registerPush({ ...device, endpoint: "https://example.com" }));
  await phone.merchant.registerPush(device);
  await phone.merchant.registerPush(device);
  await assert.rejects(tablet.merchant.registerPush(device));
  await tablet.merchant.registerPush(second);
  const sends: string[] = [];
  setSenders({ push: new BrowserPushSender(async (url, init) => {
    const headers = new Headers(init?.headers);
    assert.match(headers.get("authorization") ?? "", /^vapid /i);
    assert.equal(headers.get("content-encoding"), "aes128gcm");
    assert.ok(init?.body instanceof Uint8Array && !Buffer.from(init.body).includes("New order"));
    sends.push(String(url));
    return new Response(null, { status: String(url) === second.endpoint ? 410 : 201 });
  }) });
  const multi = await pendingOrder();
  assert.equal(await deliverMerchantAlert(multi.pushId), "sent");
  assert.deepEqual(new Set(sends), new Set([device.endpoint, second.endpoint]));
  assert.equal(await prisma.notification.count({ where: { orderId: multi.orderId, channel: "sms" } }), 0);
  assert.equal((await tablet.merchant.pushSettings()).deviceHash, null);
  assert.ok((await phone.merchant.pushSettings()).deviceHash);
  setSenders({ push: new BrowserPushSender(async () => new Response(null, { status: 503 })) });
  const unavailable = await fallback();
  assert.equal((await prisma.notification.findUniqueOrThrow({ where: { id: unavailable.pushId } })).status, "failed");
  assert.ok((await phone.merchant.pushSettings()).deviceHash);
  await tablet.merchant.disablePush();
  assert.ok((await phone.merchant.pushSettings()).deviceHash);
  await phone.merchant.disablePush();
  assert.equal((await phone.merchant.pushSettings()).deviceHash, null);
  await phone.merchant.registerPush(device);
  await phone.userAuth.signOutStore();
  let signedOutSends = 0;
  setSenders({ push: new BrowserPushSender(async () => { signedOutSends++; return new Response(null, {status: 201}); }) });
  await fallback();
  assert.equal(signedOutSends, 0);
  console.log("Verified authenticated registration, encrypted fan-out, expired endpoint removal, device opt-out and sign-out fallback.");

  setSenders({ push: { name: "refused", async send() { throw Error("unavailable"); } } });
  const retry = await fallback();
  assert.equal((await prisma.notification.findUniqueOrThrow({ where: { id: retry.pushId } })).status, "failed");
  setSenders({ sms: { ...recordSms, async send() { throw Error("transient"); } } });
  assert.equal(await deliverMerchantAlert(retry.smsId), "failed");
  const due = await prisma.notification.findUniqueOrThrow({ where: { id: retry.smsId } });
  assert.equal(due.status, "pending");
  assert.ok(due.nextAttemptAt && due.nextAttemptAt > new Date());
  setSenders({ sms: recordSms });
  assert.equal(await deliverMerchantAlert(retry.smsId), null);
  await prisma.notification.update({ where: { id: retry.smsId }, data: { nextAttemptAt: new Date(0) } });
  await Promise.all([deliverMerchantAlert(retry.smsId), deliverMerchantAlert(retry.smsId)]);
  assert.equal(captured.length, 1);
  assert.equal(captured[0]!.to, number);
  assert.match(captured[0]!.body, /Open Orders/);

  setSenders({ push: pushOff, sms: new DisabledSmsSender() });
  const disabled = await fallback();
  assert.equal(await deliverMerchantAlert(disabled.smsId), "suppressed");
  setSenders({ sms: recordSms });
  for (const state of ["accepted", "cancelled"]) {
    const stale = await fallback();
    if (state === "cancelled") await prisma.order.update({ where: { id: stale.orderId }, data: { status: "cancelled" } });
    else await prisma.shipment.updateMany({ where: { orderId: stale.orderId }, data: { status: "label_created" } });
    assert.equal(await deliverMerchantAlert(stale.smsId), "suppressed");
  }
  assert.equal(captured.length, 1);
  console.log("Passed merchant push, verified-phone fallback, duplicate drains, SMS retry, disabled SMS and stale-order checks.");
} finally {
  await prisma.notification.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.shipment.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.buyer.delete({ where: { id: buyer.id } });
  await prisma.userSession.deleteMany({ where: { storeId: store.id } });
  await prisma.store.delete({ where: { id: store.id } });
  await prisma.$disconnect();
}
