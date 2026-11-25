import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
  await prisma.store.delete({ where: { id: store.id } });
  await prisma.$disconnect();
}
