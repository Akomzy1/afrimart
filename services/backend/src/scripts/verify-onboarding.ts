/** Database-backed onboarding regression checks. Uses disposable stores, captures
 * all messages, and leaves only the append-only staff audit entries. */
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { prisma } from "../db.js";
import { assertDevOnlyAllowed } from "../runtime.js";
import { setSenders, type SmsMessage } from "../notifications/senders.js";
import { callerFor, cookieToken } from "./callers.js";
import { visibleListings } from "../quality/categoryAccess.js";
import { resetAllIpLimits } from "../auth/rateLimit.js";
import type { ResolvedSession } from "../auth/session.js";

assertDevOnlyAllowed();
const prefix = `onb-${Date.now()}`;
const base = randomInt(1_000_000, 8_000_000);
const phones = Array.from({ length: 20 }, (_, i) => `+1555${base + i}`);
assert.equal(await prisma.store.count({ where: { ownerPhone: { in: phones } } }), 0);
const messages: SmsMessage[] = [];
setSenders({ sms: { name: "onboarding-test", enabled: true, async send(message) { messages.push(message); } } });
const lastCode = () => /\b(\d{6})\b/.exec(messages.at(-1)!.body)![1]!;
let sequence = 0;
const anon = (capture?: string[]) => callerFor({ ip: `onboarding-test-${prefix}-${++sequence}`, capture });
const member = (capture: string[]) => callerFor({ cookie: `afrimart_store=${cookieToken(capture, "store")}`, origin: "http://localhost:3001" });
const denied = (p: Promise<unknown>, code: string) => assert.rejects(p, (e: unknown) => Boolean(e && typeof e === "object" && "code" in e && e.code === code));
const age = (phone: string) => prisma.authCode.updateMany({ where: { identifier: phone }, data: { createdAt: new Date(Date.now() - 7200_000) } });
const staffRow = await prisma.staffUser.findFirstOrThrow({ where: { role: "admin" } });
const staff: ResolvedSession = { sessionId: "onboarding-test", staffUserId: staffRow.id, email: staffRow.email,
  name: staffRow.name, role: "admin", mfaVerified: true, mfaEnrolled: true };
const ops = callerFor({ staff });
const reviewer = callerFor({ staff: { ...staff, role: "catalogue_reviewer" } });
const hub = await prisma.hubMetro.findFirstOrThrow({ where: { active: true } });
let groups = 0;
const passed = (label: string) => { groups++; console.log(`PASS ${label}`); };

try {
  const details = { name: `${prefix} assisted`, ownerName: "Onboarding tester", phone: phones[0]!, sellerType: "store" as const, hubMetroId: hub.id };
  await denied(anon().onboarding.state(), "UNAUTHORIZED");
  await denied(reviewer.admin.createStore(details), "FORBIDDEN");
  const assisted = await ops.admin.createStore(details);
  await denied(ops.admin.createStore(details), "CONFLICT");
  let store = await prisma.store.findUniqueOrThrow({ where: { id: assisted.id } });
  assert.equal(store.ownerPhoneVerifiedAt, null);
  assert.equal(store.onboardingStatus, "pending");
  assert.equal(store.verificationStatus, "unverified");
  await denied(ops.admin.updateStore({ id: store.id, verificationStatus: "verified" }), "BAD_REQUEST");
  await denied(ops.admin.updateStore({ id: store.id, onboardingStatus: "live" }), "BAD_REQUEST");
  passed("staff creation is permission-gated; an unverified owner cannot be approved or made live");

  const invitation = await ops.admin.issueOnboardingInvite({ id: store.id });
  const token = invitation.path.split("invite=")[1]!;
  const storedInvite = await prisma.onboardingInvite.findFirstOrThrow({ where: { storeId: store.id, consumedAt: null } });
  assert.notEqual(storedInvite.tokenHash, token);
  assert.equal(storedInvite.tokenHash.length, 64);
  await denied(reviewer.admin.issueOnboardingInvite({ id: store.id }), "FORBIDDEN");
  await denied(anon().onboarding.acceptInvite({ token }), "UNAUTHORIZED");
  passed("invitations are stored hashed and cannot grant anonymous access");

  const aCookies: string[] = [];
  await anon().userAuth.requestStoreCode({ phone: phones[0]! });
  const aCode = lastCode();
  await denied(anon().userAuth.verifyStoreCode({ phone: phones[0]!, code: aCode === "000000" ? "111111" : "000000" }), "UNAUTHORIZED");
  await anon(aCookies).userAuth.verifyStoreCode({ phone: phones[0]!, code: aCode });
  await denied(anon().userAuth.verifyStoreCode({ phone: phones[0]!, code: aCode }), "UNAUTHORIZED");
  const a = member(aCookies);
  assert.ok((await a.onboarding.state()).ownerPhoneVerifiedAt);
  await a.onboarding.acceptInvite({ token });
  await denied(a.onboarding.acceptInvite({ token }), "BAD_REQUEST");
  const expired = await ops.admin.issueOnboardingInvite({ id: store.id });
  await prisma.onboardingInvite.updateMany({ where: { storeId: store.id, consumedAt: null }, data: { expiresAt: new Date(0) } });
  await denied(a.onboarding.acceptInvite({ token: expired.path.split("invite=")[1]! }), "BAD_REQUEST");
  passed("valid code verifies the owner; wrong/replayed codes and reused/expired invites are rejected");

  await anon().userAuth.requestOnboardingCode({ phone: phones[1]! });
  const bCode = lastCode();
  await denied(anon().userAuth.verifyStoreCode({ phone: phones[1]!, code: bCode }), "UNAUTHORIZED");
  const bCookies: string[] = [];
  await anon(bCookies).userAuth.verifyOnboardingCode({ phone: phones[1]!, code: bCode });
  const b = member(bCookies);
  const bStore = await b.onboarding.state();
  assert.equal(bStore.onboardingStatus, "pending");
  assert.equal(bStore.verificationStatus, "unverified");
  assert.ok(bStore.ownerPhoneVerifiedAt);
  const otherInvite = await ops.admin.issueOnboardingInvite({ id: assisted.id });
  await denied(b.onboarding.acceptInvite({ token: otherInvite.path.split("invite=")[1]! }), "BAD_REQUEST");
  passed("self-service requires its own code purpose and creates a private pending store; other stores' invites stay private");

  await denied(b.onboarding.chooseRail({ rail: "film" }), "FORBIDDEN");
  await b.onboarding.saveProfile({ name: `${prefix} home`, ownerName: "Home seller", sellerType: "home_seller", foodSafetyAttested: true });
  // Early business approval must not strand the seller before rail selection.
  await ops.admin.updateStore({ id: bStore.id, verificationStatus: "verified" });
  await denied(b.onboarding.chooseRail({ rail: "web", website: "javascript:alert(1)" }), "BAD_REQUEST");
  await b.onboarding.chooseRail({ rail: "web", website: "https://example.test/products" });
  assert.equal((await b.onboarding.state()).onboardingWebsite, "https://example.test/products");
  await b.onboarding.chooseRail({ rail: "film" });
  const saved = await b.onboarding.state();
  assert.equal(saved.name, `${prefix} home`);
  assert.equal(saved.sellerType, "home_seller");
  assert.equal(saved.onboardingStatus, "filming");
  assert.equal(saved.onboardingWebsite, null);
  await ops.admin.updateStore({ id: bStore.id, verificationStatus: "unverified" });
  passed("profile, attestation and rail persist; incomplete profiles and invalid websites are refused");

  const product = await prisma.canonicalProduct.create({ data: { id: prefix, canonicalName: "Onboarding test rice", shortDescription: "test", usedDescription: "test", category: "Grains", cuisine: "Nigerian", packSize: "500g", images: [], temperatureClass: "ambient", shippingWeightOz: 18 } });
  const listing = await prisma.listing.create({ data: { storeId: bStore.id, canonicalProductId: product.id, priceCents: 500, temperatureClass: "ambient", shippingWeightOz: 18 } });
  const publicCount = async () => prisma.listing.count({ where: await visibleListings(prisma, { storeId: bStore.id }) });
  assert.equal(await publicCount(), 0);
  // Simulate a live seller whose business verification was revoked. It is
  // hidden publicly, but a stale basket must report the correct block reason.
  await prisma.store.update({ where: { id: bStore.id }, data: { onboardingStatus: "live" } });
  assert.equal(await publicCount(), 0);
  const quote = await anon().checkout.quote({ items: [{ listingId: listing.id, quantity: 1 }], destination: { street: "1 Test Road", city: "Houston", state: "TX", zip: "77002" } });
  assert.equal(quote.blockedByVerification.length, 1);
  assert.equal(quote.unfulfillable.length, 0);
  await prisma.store.update({ where: { id: bStore.id }, data: { onboardingStatus: "filming" } });
  passed("unverified listings stay hidden while a stale basket reports blocked verification rather than missing stock");
  await denied(ops.admin.updateStore({ id: bStore.id, onboardingStatus: "kit_issued" }), "BAD_REQUEST");
  await ops.admin.updateStore({ id: bStore.id, verificationStatus: "verified" });
  assert.equal(await publicCount(), 0);
  await denied(b.onboarding.saveProfile({ name: "Changed", ownerName: "Changed", sellerType: "store", foodSafetyAttested: true }), "FORBIDDEN");
  await denied(ops.admin.updateStore({ id: bStore.id, onboardingStatus: "live" }), "BAD_REQUEST");
  await ops.admin.recordOnboardingKit({ id: bStore.id, packaging: "10 boxes and tape", labelPrinterSerial: `${prefix}-printer`, issuedAt: new Date() });
  await ops.admin.updateStore({ id: bStore.id, onboardingStatus: "kit_issued" });
  await ops.admin.updateStore({ id: bStore.id, onboardingStatus: "live" });
  assert.equal(await publicCount(), 1);
  assert.equal((await b.onboarding.state()).onboardingKits.length, 1);
  passed("listings remain hidden until staff approval and go-live; kit records persist; approved seller details cannot be switched");

  await age(phones[1]!);
  await anon().userAuth.requestOnboardingCode({ phone: phones[1]! });
  const repeatCookies: string[] = [];
  await anon(repeatCookies).userAuth.verifyOnboardingCode({ phone: phones[1]!, code: lastCode() });
  assert.equal((await member(repeatCookies).onboarding.state()).id, bStore.id);
  assert.equal(await prisma.store.count({ where: { ownerPhone: phones[1]! } }), 1);
  passed("returning sellers keep the same store when they use the signup entry point");

  await age(phones[0]!);
  await anon().userAuth.requestStoreCode({ phone: phones[0]! });
  const staleCode = lastCode();
  await ops.admin.setStoreOwnerPhone({ id: assisted.id, phone: phones[2]!, reason: "Onboarding regression test" });
  await denied(a.onboarding.state(), "UNAUTHORIZED");
  store = await prisma.store.findUniqueOrThrow({ where: { id: assisted.id } });
  assert.equal(store.ownerPhoneVerifiedAt, null);
  await ops.admin.setStoreOwnerPhone({ id: assisted.id, phone: phones[0]!, reason: "Restore test number" });
  await denied(anon().userAuth.verifyStoreCode({ phone: phones[0]!, code: staleCode }), "UNAUTHORIZED");
  passed("phone reassignment revokes sessions and verification; assigning the old number back cannot revive an old code");

  await anon().userAuth.requestOnboardingCode({ phone: phones[3]! });
  const unbound = lastCode();
  await ops.admin.setStoreOwnerPhone({ id: assisted.id, phone: phones[3]!, reason: "Concurrent assignment test" });
  await denied(anon().userAuth.verifyOnboardingCode({ phone: phones[3]!, code: unbound }), "UNAUTHORIZED");
  passed("a signup code issued before a number is assigned cannot take over the newly assigned store");

  const both = await Promise.allSettled([anon().userAuth.requestOnboardingCode({ phone: phones[4]! }), anon().userAuth.requestOnboardingCode({ phone: phones[4]! })]);
  assert.equal(both.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(messages.filter((m) => m.to === phones[4]).length, 1);
  const racingCode = lastCode();
  const exchanges = await Promise.allSettled([anon().userAuth.verifyOnboardingCode({ phone: phones[4]!, code: racingCode }), anon().userAuth.verifyOnboardingCode({ phone: phones[4]!, code: racingCode })]);
  assert.equal(exchanges.filter((r) => r.status === "fulfilled").length, 1);
  passed("concurrent code requests send once, and concurrent exchanges create only one session/store");

  const sentBefore = messages.length;
  await anon().userAuth.requestStoreCode({ phone: phones[5]! });
  assert.equal(messages.length, sentBefore);
  await anon().userAuth.requestOnboardingCode({ phone: phones[6]! });
  const expiring = lastCode();
  await prisma.authCode.updateMany({ where: { identifier: phones[6]! }, data: { expiresAt: new Date(0) } });
  await denied(anon().userAuth.verifyOnboardingCode({ phone: phones[6]!, code: expiring }), "UNAUTHORIZED");
  await anon().userAuth.requestOnboardingCode({ phone: phones[7]! });
  const guessed = lastCode();
  for (let i = 0; i < 5; i++) await denied(anon().userAuth.verifyOnboardingCode({ phone: phones[7]!, code: guessed === "000000" ? "111111" : "000000" }), "UNAUTHORIZED");
  await denied(anon().userAuth.verifyOnboardingCode({ phone: phones[7]!, code: guessed }), "UNAUTHORIZED");
  passed("unknown ordinary sign-ins do not send; expired and exhausted codes cannot create stores");

  const burst = callerFor({ ip: `${prefix}-burst` });
  for (let i = 10; i < 15; i++) await burst.userAuth.requestOnboardingCode({ phone: phones[i]! });
  await denied(burst.userAuth.requestOnboardingCode({ phone: phones[15]! }), "TOO_MANY_REQUESTS");
  assert.equal(await prisma.store.count({ where: { ownerPhone: { in: phones.slice(10) } } }), 0);
  assert.ok(await prisma.auditLogEntry.count({ where: { subjectId: bStore.id, action: "store.kit_issued" } }));
  passed("bulk signup requests are limited and do not create stores before verification; kit issuance is audited");
  console.log(`${groups} onboarding regression groups passed.`);
} finally {
  const stores = await prisma.store.findMany({ where: { ownerPhone: { in: phones } }, select: { id: true } });
  const ids = stores.map((s) => s.id);
  await prisma.userSession.deleteMany({ where: { storeId: { in: ids } } });
  await prisma.listing.deleteMany({ where: { storeId: { in: ids } } });
  await prisma.store.deleteMany({ where: { id: { in: ids } } });
  await prisma.canonicalProduct.deleteMany({ where: { id: prefix } });
  await prisma.authCode.deleteMany({ where: { identifier: { in: phones } } });
  resetAllIpLimits();
  await prisma.$disconnect();
}
