/**
 * QC-1 end-to-end check: home-based and aspiring seller rules, against the real
 * database and the real routers.
 *
 * The unit tests pin the rules and the shape of the code. This proves the
 * behaviour a seller and a buyer actually meet: a listing is refused or
 * accepted, hidden or visible, and the audit log says who did what and why.
 *
 * Calls the routers in-process (no server needed), signed in as the seeded
 * staff accounts so the real permission gates apply. Creates throwaway stores
 * and products and removes them afterwards; audit entries are append-only by
 * design and stay.
 *   npm run verify:quality-controls --workspace=@afrimart/backend
 */
import { TRPCError } from "@trpc/server";
import sharp from "sharp";
import { prisma } from "../db.js";
import { callerFor } from "./callers.js";
import type { ResolvedSession } from "../auth/session.js";
import { SUPPORT_CONTACT } from "../config.js";

const run = Date.now().toString(36);
const id = (s: string) => `qc1v-${run}-${s}`;

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`${pass ? "  ok  " : "  FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

async function sessionFor(email: string): Promise<ResolvedSession> {
  const u = await prisma.staffUser.findUniqueOrThrow({ where: { email } });
  return {
    sessionId: "verify",
    staffUserId: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    mfaVerified: true,
    mfaEnrolled: true,
  };
}
/**
 * A caller as the server builds one: staff from a session, buyer or store from
 * a real session token on the request (see callers.ts), never a client-chosen id.
 */
const as = (staff: ResolvedSession | null, identity?: string) => callerFor({ staff, identity });
const asStore = (storeId: string) => as(null, `store:${storeId}`);

/** Run a call and report the tRPC error code, or "ok". */
async function outcome<T>(p: Promise<T>): Promise<{ code: string; message: string; value?: T }> {
  try {
    return { code: "ok", message: "", value: await p };
  } catch (e) {
    if (e instanceof TRPCError) return { code: e.code, message: e.message };
    throw e;
  }
}

const ops = as(await sessionFor("ops@afrimart.test"));
const reviewer = as(await sessionFor("reviewer@afrimart.test"));
const finance = as(await sessionFor("finance@afrimart.test"));
const admin = as(await sessionFor("admin@afrimart.test"));
const buyer = as(null);
const merchant = as(null);

const liveSwitches = await prisma.platformCategoryControl.count({ where: { disabled: true } });
if (liveSwitches > 0) {
  console.error(
    `${liveSwitches} platform-wide category switch(es) are currently on. This script toggles them to test them, ` +
      "so it will not run over a real one. Switch them off (or run against a scratch database) and retry.",
  );
  process.exit(2);
}

const hub = await prisma.hubMetro.findFirstOrThrow();

/**
 * Remove every throwaway row this script (or an earlier, interrupted run of it)
 * created, found by id prefix. Audit entries are append-only and stay.
 */
async function sweep() {
  const stores = { storeId: { startsWith: "qc1v-" } };
  await prisma.listing.deleteMany({ where: stores });
  await prisma.catalogueDraft.deleteMany({ where: stores });
  await prisma.permitConfirmation.deleteMany({ where: stores });
  await prisma.sellerCategoryControl.deleteMany({ where: stores });
  await prisma.kitchenLicence.deleteMany({ where: stores });
  await prisma.sellerBadge.deleteMany({ where: stores });
  await prisma.userSession.deleteMany({ where: { OR: [stores, { buyerId: { startsWith: "qc1v-" } }] } });
  await prisma.buyer.deleteMany({ where: { id: { startsWith: "qc1v-" } } });
  await prisma.store.deleteMany({ where: { id: { startsWith: "qc1v-" } } });
  await prisma.listing.deleteMany({ where: { canonicalProductId: { startsWith: "qc1v-" } } });
  await prisma.canonicalProduct.deleteMany({ where: { id: { startsWith: "qc1v-" } } });
}
await sweep();


async function makeStore(tag: string, sellerType: "store" | "home_seller" | "aspiring_entrepreneur") {
  const s = await prisma.store.create({
    data: {
      id: id(tag),
      name: `QC1 ${tag}`,
      ownerName: tag,
      sellerType,
      hubMetroId: hub.id,
      onboardingStatus: "live",
      verificationStatus: "verified",
    },
  });
  return s.id;
}
async function makeProduct(
  tag: string,
  over: { temperatureClass?: "ambient" | "refrigerated" | "frozen"; controlledCategory?: "meat" | "poultry" | "fish" | "dairy" | null; category?: string },
) {
  const p = await prisma.canonicalProduct.create({
    data: {
      id: id(tag),
      canonicalName: `QC1 ${tag}`,
      shortDescription: tag,
      usedDescription: tag,
      category: over.category ?? "Verification",
      cuisine: "Nigerian",
      packSize: "1 unit",
      images: [],
      temperatureClass: over.temperatureClass ?? "ambient",
      controlledCategory: over.controlledCategory ?? null,
      shippingWeightOz: 8,
    },
  });
  return p.id;
}
async function draftFor(storeId: string, productId: string) {
  const d = await prisma.catalogueDraft.create({
    data: { storeId, rawText: "verify", suggestedName: "verify", confidence: 0.99, matchedProductId: productId },
  });
  return d.id;
}
/** The real listing path. */
const list = async (storeId: string, productId: string) => {
  const draftId = await draftFor(storeId, productId);
  return outcome(reviewer.admin.approveDraft({ id: draftId, canonicalProductId: productId, priceCents: 1000 }));
};
const visibleIds = async () => new Set((await buyer.catalogue.browse({})).map((c) => c.listingId));
const startedAt = new Date();
const auditFor = (subjectId: string, action: string) =>
  prisma.auditLogEntry.findMany({
    // This run only: the log is append-only, and "category:meat" is not unique per run.
    where: { subjectId, action, createdAt: { gte: startedAt } },
    orderBy: { createdAt: "asc" },
  });

try {
  const home = await makeStore("home", "home_seller");
  const aspiring = await makeStore("aspiring", "aspiring_entrepreneur");
  const store = await makeStore("store", "store");

  const plain = await makeProduct("plain", {});
  const dried = await makeProduct("dried-fish", { controlledCategory: "fish", category: "Fish & seafood" });
  const kilishi = await makeProduct("kilishi", { controlledCategory: "meat", category: "Meat" });
  const frozenMeat = await makeProduct("frozen-goat", { controlledCategory: "meat", temperatureClass: "frozen", category: "Meat" });
  const chilledDairy = await makeProduct("chilled-dairy", { controlledCategory: "dairy", temperatureClass: "refrigerated", category: "Dairy" });

  console.log("=== 1. no same-state / cross-state restriction ===");
  const ordinary = await list(home, plain);
  check("a home seller lists an ordinary shelf-stable item", ordinary.code === "ok", ordinary.message);

  console.log("\n=== 2. chilled and frozen stay blocked ===");
  for (const [who, sid] of [["home", home], ["aspiring", aspiring]] as const) {
    const frozen = await list(sid, frozenMeat);
    check(`${who} seller cannot list frozen meat`, frozen.code === "FORBIDDEN" && /commercial kitchen/i.test(frozen.message), frozen.code);
    const chilled = await list(sid, chilledDairy);
    check(`${who} seller cannot list chilled dairy`, chilled.code === "FORBIDDEN", chilled.code);
  }

  console.log("\n=== 2b. identity comes from the request, never from input ===");
  const anonymous = await outcome(as(null).merchant.permitStatus());
  check("an unidentified caller is refused", anonymous.code === "UNAUTHORIZED", anonymous.code);
  const aBuyer = await prisma.buyer.create({ data: { id: id("buyer"), email: `${run}@qc1.test` } });
  const wrongKind = await outcome(as(null, `buyer:${aBuyer.id}`).merchant.permitStatus());
  check("a buyer's session cannot act as a store", wrongKind.code === "UNAUTHORIZED", wrongKind.code);
  const unknown = await outcome(callerFor({ rawToken: "not-a-real-session-token" }).merchant.permitStatus());
  check("a token that is not a session gets nowhere", unknown.code === "UNAUTHORIZED", unknown.code);
  const smuggled = await outcome((asStore(home).merchant.confirmPermit as unknown as (i: unknown) => Promise<unknown>)({ storeId: aspiring, category: "fish", acknowledged: true }));
  check("a store id smuggled into the input is ignored: the confirmation lands on the caller", smuggled.code === "ok" &&
    (await prisma.permitConfirmation.count({ where: { storeId: aspiring, category: "fish" } })) === 0 &&
    (await prisma.permitConfirmation.count({ where: { storeId: home, category: "fish" } })) === 1);
  await prisma.permitConfirmation.deleteMany({ where: { storeId: home, category: "fish" } });

  console.log("\n=== 3. licensed commercial kitchen: applied for, reviewed, audited ===");
  const apply = await outcome(asStore(home).merchant.applyForKitchenLicence({ licenceNumber: "CK-1234", issuingAuthority: "County Health Dept" }));
  check("a home seller can apply", apply.code === "ok" && apply.value?.status === "applied");
  const again = await outcome(asStore(home).merchant.applyForKitchenLicence({ licenceNumber: "CK-1234", issuingAuthority: "County Health Dept" }));
  check("applying twice is refused", again.code === "CONFLICT", again.code);
  const storeApply = await outcome(asStore(store).merchant.applyForKitchenLicence({ licenceNumber: "x", issuingAuthority: "y" }));
  check("a store cannot apply (it has no use for it)", storeApply.code === "BAD_REQUEST", storeApply.code);

  const stillBlocked = await list(home, frozenMeat);
  check("an application alone grants nothing", stillBlocked.code === "FORBIDDEN", stillBlocked.code);

  const appRow = await prisma.kitchenLicence.findUniqueOrThrow({ where: { storeId: home } });
  const asReviewer = await outcome(reviewer.admin.reviewKitchenLicence({ id: appRow.id, decision: "approve", licenceChecked: true, note: "ok" }));
  check("a catalogue reviewer cannot approve a licence", asReviewer.code === "FORBIDDEN", asReviewer.code);
  const asFinance = await outcome(finance.admin.reviewKitchenLicence({ id: appRow.id, decision: "approve", licenceChecked: true, note: "ok" }));
  check("finance cannot approve a licence", asFinance.code === "FORBIDDEN", asFinance.code);

  const unchecked = await outcome(ops.admin.reviewKitchenLicence({ id: appRow.id, decision: "approve", note: "looks fine" }));
  check("approval without confirming the licence was checked is refused", unchecked.code === "BAD_REQUEST", unchecked.code);
  const noNote = await outcome(ops.admin.reviewKitchenLicence({ id: appRow.id, decision: "approve", licenceChecked: true, note: "" }));
  check("approval without a note is refused", noNote.code === "BAD_REQUEST", noNote.code);

  // Approval records what the reviewer read, and refuses without all three.
  const base = { id: appRow.id, decision: "approve", licenceChecked: true, note: "Checked against county register" } as const;
  const noNumber = await outcome(ops.admin.reviewKitchenLicence({ ...base, issuingAuthority: "County Health Dept", expiresOn: "2030-06-30" as never }));
  check("approval without the licence number is refused, and says so", noNumber.code === "BAD_REQUEST" && /licence number/i.test(noNumber.message), noNumber.message);
  const noAuthority = await outcome(ops.admin.reviewKitchenLicence({ ...base, licenceNumber: "CK-1234", expiresOn: "2030-06-30" as never }));
  check("approval without the issuing authority is refused", noAuthority.code === "BAD_REQUEST" && /who issued/i.test(noAuthority.message), noAuthority.message);
  const noExpiry = await outcome(ops.admin.reviewKitchenLicence({ ...base, licenceNumber: "CK-1234", issuingAuthority: "County Health Dept" }));
  check("approval without the expiry date is refused", noExpiry.code === "BAD_REQUEST" && /expiry/i.test(noExpiry.message), noExpiry.message);
  const blankNumber = await outcome(ops.admin.reviewKitchenLicence({ ...base, licenceNumber: "   ", issuingAuthority: "County Health Dept", expiresOn: "2030-06-30" as never }));
  check("a blank number counts as missing", blankNumber.code === "BAD_REQUEST", blankNumber.code);
  const lapsed = await outcome(ops.admin.reviewKitchenLicence({ ...base, licenceNumber: "CK-1234", issuingAuthority: "County Health Dept", expiresOn: "2020-01-01" as never }));
  check("a licence that has already expired cannot be approved", lapsed.code === "BAD_REQUEST" && /expired/i.test(lapsed.message), lapsed.message);
  check("none of those refusals changed the application", (await prisma.kitchenLicence.findUniqueOrThrow({ where: { id: appRow.id } })).status === "applied");

  const approved = await outcome(
    ops.admin.reviewKitchenLicence({ ...base, licenceNumber: "CK-1234", issuingAuthority: "County Health Dept", expiresOn: "2030-06-30" as never, note: "Licence CK-1234 checked against county register" }),
  );
  check("operations approves after checking", approved.code === "ok" && approved.value?.status === "approved");
  const storedLicence = await prisma.kitchenLicence.findUniqueOrThrow({ where: { id: appRow.id } });
  check(
    "the approval record holds the number, the authority and the expiry date",
    storedLicence.verifiedLicenceNumber === "CK-1234" && storedLicence.verifiedIssuingAuthority === "County Health Dept" && storedLicence.licenceExpiresOn?.toISOString().slice(0, 10) === "2030-06-30",
    `${storedLicence.verifiedLicenceNumber} / ${storedLicence.verifiedIssuingAuthority} / ${storedLicence.licenceExpiresOn?.toISOString()}`,
  );
  const licenceAudit = await auditFor(home, "store.kitchen_licence_change");
  const auditAfter = licenceAudit[0]?.after as { licenceNumber?: string; issuingAuthority?: string; expiresOn?: string } | undefined;
  check(
    "the approval is audited with who and why",
    licenceAudit.length === 1 && licenceAudit[0]!.actorEmail === "ops@afrimart.test" && /CK-1234/.test(licenceAudit[0]!.note ?? ""),
    JSON.stringify(licenceAudit.map((a) => [a.actorEmail, a.note])),
  );
  check(
    "and the audit entry carries what was checked",
    auditAfter?.licenceNumber === "CK-1234" && auditAfter?.issuingAuthority === "County Health Dept" && String(auditAfter?.expiresOn).startsWith("2030-06-30"),
    JSON.stringify(auditAfter),
  );

  // The licensed seller can now list chilled and frozen, but still must confirm the permit for meat.
  const needsPermit = await list(home, frozenMeat);
  check("approved kitchen lifts the chilled/frozen block but the meat permit is still asked for", needsPermit.code === "PRECONDITION_FAILED", `${needsPermit.code} ${needsPermit.message.slice(0, 60)}`);
  const stillBlockedAspiring = await list(aspiring, frozenMeat);
  check("approval is per seller: another seller stays blocked", stillBlockedAspiring.code === "FORBIDDEN", stillBlockedAspiring.code);

  console.log("\n=== 4. meat, poultry, fish and dairy listable by default; permit confirmed once ===");
  const needsPermit2 = await list(home, dried);
  check("first fish listing asks for a permit confirmation", needsPermit2.code === "PRECONDITION_FAILED" && /permit/i.test(needsPermit2.message), needsPermit2.code);
  const noAck = await outcome(asStore(home).merchant.confirmPermit({ category: "fish", acknowledged: false as never }));
  check("a confirmation needs an explicit acknowledgement", noAck.code === "BAD_REQUEST", noAck.code);
  const storeConfirm = await outcome(asStore(store).merchant.confirmPermit({ category: "fish", acknowledged: true }));
  check("a store is never asked to confirm a permit", storeConfirm.code === "BAD_REQUEST", storeConfirm.code);

  const confirm1 = await outcome(asStore(home).merchant.confirmPermit({ category: "fish", acknowledged: true }));
  check("the seller confirms", confirm1.code === "ok" && Boolean(confirm1.value?.confirmedAt));
  await new Promise((r) => setTimeout(r, 25));
  const confirm2 = await outcome(asStore(home).merchant.confirmPermit({ category: "fish", acknowledged: true }));
  check("confirming again keeps the original timestamp", confirm1.value?.confirmedAt.getTime() === confirm2.value?.confirmedAt.getTime());
  const stored = await prisma.permitConfirmation.findUniqueOrThrow({ where: { storeId_category: { storeId: home, category: "fish" } } });
  check("the confirmation is stored with a timestamp and wording version", stored.confirmedAt instanceof Date && stored.statementVersion.length > 0, stored.statementVersion);

  const driedFish = await list(home, dried);
  check("dried fish now lists (shelf-stable fish is not blocked)", driedFish.code === "ok", driedFish.message);
  const secondFish = await list(aspiring, dried);
  check("another seller still has to confirm for themselves", secondFish.code === "PRECONDITION_FAILED", secondFish.code);
  await asStore(aspiring).merchant.confirmPermit({ category: "fish", acknowledged: true });
  await asStore(home).merchant.confirmPermit({ category: "meat", acknowledged: true });
  await asStore(aspiring).merchant.confirmPermit({ category: "meat", acknowledged: true });
  check("an aspiring seller lists dried fish after confirming", (await list(aspiring, dried)).code === "ok");
  check("a licensed home seller lists frozen meat after confirming", (await list(home, frozenMeat)).code === "ok");
  check("kilishi lists (shelf-stable meat is not blocked)", (await list(aspiring, kilishi)).code === "ok");
  check("a store lists frozen meat with no licence and no permit", (await list(store, frozenMeat)).code === "ok");
  check("a store lists dried fish with no permit", (await list(store, dried)).code === "ok");

  const listingOf = async (storeId: string, productId: string) =>
    (await prisma.listing.findFirstOrThrow({ where: { storeId, canonicalProductId: productId } })).id;
  const homeFish = await listingOf(home, dried);
  const aspiringFish = await listingOf(aspiring, dried);
  const storeFish = await listingOf(store, dried);
  const homeMeat = await listingOf(home, frozenMeat);
  const storeMeat = await listingOf(store, frozenMeat);
  const aspiringMeat = await listingOf(aspiring, kilishi);
  const homePlain = await listingOf(home, plain);

  let seen = await visibleIds();
  check("with nothing switched off, all of those listings are visible", [homeFish, aspiringFish, storeFish, homeMeat, storeMeat, aspiringMeat, homePlain].every((l) => seen.has(l)));

  console.log("\n=== 5. ops switches a category off for one seller ===");
  const noReason = await outcome(ops.admin.setSellerCategory({ storeId: home, category: "fish", disabled: true, reason: "" }));
  check("a switch without a reason is refused", noReason.code === "BAD_REQUEST", noReason.code);
  const byReviewer = await outcome(reviewer.admin.setSellerCategory({ storeId: home, category: "fish", disabled: true, reason: "x" }));
  check("a catalogue reviewer cannot switch a category", byReviewer.code === "FORBIDDEN", byReviewer.code);
  const onStore = await outcome(ops.admin.setSellerCategory({ storeId: store, category: "fish", disabled: true, reason: "x" }));
  check("ops cannot set a per-seller switch on a store", onStore.code === "BAD_REQUEST", onStore.code);

  const off = await outcome(ops.admin.setSellerCategory({ storeId: home, category: "fish", disabled: true, reason: "Complaint on file, pending inspection" }));
  check("ops switches fish off for one home seller", off.code === "ok");
  seen = await visibleIds();
  check("that seller's existing fish listing is hidden", !seen.has(homeFish));
  check("their other listings are still visible", seen.has(homeMeat) && seen.has(homePlain));
  check("another home-tier seller's fish is still visible", seen.has(aspiringFish));
  check("a store's fish is still visible", seen.has(storeFish));
  const detail = await outcome(buyer.catalogue.detail({ listingId: homeFish }));
  check("the hidden listing's page is not found", detail.code === "NOT_FOUND", detail.code);
  const blockedNew = await list(home, dried);
  check("a new fish listing is refused", blockedNew.code === "FORBIDDEN");
  check("the refusal explains why and gives the support contact", /switched off on your account/.test(blockedNew.message) && blockedNew.message.includes(SUPPORT_CONTACT), blockedNew.message.slice(0, 90));
  const notices = await asStore(home).merchant.categoryNotices();
  check("the seller can read the same explanation for the hidden listing", notices.length === 1 && notices[0]!.message.includes(SUPPORT_CONTACT));
  check("ops' internal reason is not shown to the seller", !notices.some((n) => /inspection/.test(n.message)));
  const controls = await ops.admin.categoryControls();
  check("the console lists the switch with its reason", controls.sellers.some((s) => s.storeId === home && s.category === "fish" && /inspection/.test(s.reason)));

  // The switch is on while this runs: it must hide fish and nothing else, in particular not
  // products that belong to none of the four categories (NULL in the database).
  check("an unclassified product of the same seller stays visible while a category is switched off", seen.has(homePlain));

  const sellerAudit = await auditFor(home, "store.category_restriction_change");
  check(
    "the switch is audited: who, which seller, and why",
    sellerAudit.length === 1 && sellerAudit[0]!.actorEmail === "ops@afrimart.test" && sellerAudit[0]!.subjectId === home && /inspection/.test(sellerAudit[0]!.note ?? ""),
  );

  const on = await outcome(ops.admin.setSellerCategory({ storeId: home, category: "fish", disabled: false, reason: "Inspection passed" }));
  check("ops switches it back on", on.code === "ok");
  seen = await visibleIds();
  check("the listing comes back — nothing was deleted", seen.has(homeFish));
  const sellerAudit2 = await auditFor(home, "store.category_restriction_change");
  check("enabling is audited too", sellerAudit2.length === 2 && /passed/.test(sellerAudit2[1]!.note ?? ""));

  console.log("\n=== 6. ops switches a category off platform-wide ===");
  const byOps = await outcome(ops.admin.setPlatformCategory({ category: "meat", disabled: true, reason: "Legal advice, 14 Oct" }));
  check("operations cannot switch a category off for the whole tier", byOps.code === "FORBIDDEN", byOps.code);
  const byReviewer2 = await outcome(reviewer.admin.setPlatformCategory({ category: "meat", disabled: true, reason: "x" }));
  check("a catalogue reviewer cannot either", byReviewer2.code === "FORBIDDEN", byReviewer2.code);
  const byFinance = await outcome(finance.admin.setPlatformCategory({ category: "meat", disabled: true, reason: "x" }));
  check("finance cannot either", byFinance.code === "FORBIDDEN", byFinance.code);
  const platformOff = await outcome(admin.admin.setPlatformCategory({ category: "meat", disabled: true, reason: "Legal advice, 14 Oct" }));
  check("an administrator switches meat off for all home and aspiring sellers", platformOff.code === "ok");
  seen = await visibleIds();
  check("a home seller's meat is hidden", !seen.has(homeMeat));
  check("an aspiring seller's meat is hidden", !seen.has(aspiringMeat));
  check("a store's meat is not", seen.has(storeMeat));
  check("fish is untouched", seen.has(homeFish) && seen.has(aspiringFish));
  check("unclassified products stay visible while a platform category is off", seen.has(homePlain));
  const blockedPlatform = await list(aspiring, kilishi);
  check("new meat listings are refused for the home tier", blockedPlatform.code === "FORBIDDEN" && /paused meat listings/.test(blockedPlatform.message) && blockedPlatform.message.includes(SUPPORT_CONTACT));
  check("a store can still list meat", (await list(store, kilishi)).code === "ok");
  const platformAudit = await auditFor("category:meat", "platform.category_restriction_change");
  check("audited with who, the setting, and why", platformAudit.length === 1 && platformAudit[0]!.actorEmail === "admin@afrimart.test" && /Legal advice/.test(platformAudit[0]!.note ?? "") && platformAudit[0]!.subjectType === "platform_setting");
  await admin.admin.setPlatformCategory({ category: "meat", disabled: false, reason: "Advice clarified" });
  seen = await visibleIds();
  check("switching it back on restores the listings", seen.has(homeMeat) && seen.has(aspiringMeat));
  check("re-enabling is audited", (await auditFor("category:meat", "platform.category_restriction_change")).length === 2);

  console.log("\n=== 7. hidden listings cannot be bought ===");
  await admin.admin.setPlatformCategory({ category: "meat", disabled: true, reason: "Re-test routing" });
  const sole = await prisma.listing.findUniqueOrThrow({ where: { id: aspiringMeat } });
  // Remove the store's alternative so this product has no visible offer anywhere.
  await prisma.listing.deleteMany({ where: { canonicalProductId: sole.canonicalProductId, storeId: store } });
  const quote = await buyer.checkout.quote({
    items: [{ listingId: aspiringMeat, quantity: 1 }],
    destination: { street: "1 Main St", city: "Austin", state: "TX", zip: "78701" },
  });
  check("routing reports the hidden item as unfulfillable", quote.unfulfillable.length === 1 && quote.parcels.length === 0, `parcels=${quote.parcels.length}`);
  await admin.admin.setPlatformCategory({ category: "meat", disabled: false, reason: "Done" });

  console.log("\n=== 8. revoking a licence takes the chilled and frozen listings down ===");
  seen = await visibleIds();
  check("while licensed, the home seller's frozen meat is visible", seen.has(homeMeat));
  const revoke = await outcome(ops.admin.reviewKitchenLicence({ id: appRow.id, decision: "revoke", note: "Licence lapsed" }));
  check("ops revokes the licence", revoke.code === "ok" && revoke.value?.status === "revoked");
  seen = await visibleIds();
  check("the frozen listing is hidden again", !seen.has(homeMeat));
  check("their shelf-stable listings are unaffected", seen.has(homeFish) && seen.has(homePlain));
  const afterRevoke = await list(home, frozenMeat);
  check("new chilled/frozen listings are blocked again", afterRevoke.code === "FORBIDDEN", afterRevoke.code);
  check("the revocation is audited", (await auditFor(home, "store.kitchen_licence_change")).length === 2);
  const revokeAgain = await outcome(ops.admin.reviewKitchenLicence({ id: appRow.id, decision: "revoke", note: "again" }));
  check("a revoked licence cannot be revoked twice", revokeAgain.code === "BAD_REQUEST", revokeAgain.code);
  const reapply = await outcome(asStore(home).merchant.applyForKitchenLicence({ licenceNumber: "CK-9999", issuingAuthority: "State Dept" }));
  check("a seller can apply again after revocation", reapply.code === "ok" && reapply.value?.status === "applied");
  check("and the fresh application is unreviewed", (await prisma.kitchenLicence.findUniqueOrThrow({ where: { storeId: home } })).reviewedAt === null);

  console.log("\n=== 8b. a chilled listing from a seller who was never licensed is hidden ===");
  // Created straight in the database, bypassing the listing path, as a legacy row would be.
  const legacy = await prisma.listing.create({
    data: { storeId: aspiring, canonicalProductId: chilledDairy, priceCents: 900, temperatureClass: "refrigerated", shippingWeightOz: 8 },
  });
  seen = await visibleIds();
  check("an unlicensed home-tier seller's chilled listing is not visible, even one that skipped the listing path", !seen.has(legacy.id));
  const storeChilled = await prisma.listing.create({
    data: { storeId: store, canonicalProductId: chilledDairy, priceCents: 900, temperatureClass: "refrigerated", shippingWeightOz: 8 },
  });
  seen = await visibleIds();
  check("a store's chilled listing, with no licence row at all, is visible", seen.has(storeChilled.id));

  console.log("\n=== 8c. the seller's own screens: What's listed, and applying with a photo ===");
  const mine = await asStore(aspiring).merchant.listings();
  const mineLegacy = mine.find((l) => l.id === legacy.id);
  check("a hidden listing is marked hidden on the seller's own list", mineLegacy?.hidden === true, String(mineLegacy?.hidden));
  check("and the reason is the licence, not a paused category", mineLegacy?.hiddenReason === "needs_kitchen_licence", String(mineLegacy?.hiddenReason));
  const storeMine = await asStore(store).merchant.listings();
  check("a store's chilled listing is not hidden", storeMine.find((l) => l.id === storeChilled.id)?.hidden === false);
  const standingHome = await asStore(aspiring).merchant.standing();
  check("standing: a home-tier seller with no application", standingHome.homeTier === true && standingHome.kitchen === null);
  check("standing: a store is not home tier", (await asStore(store).merchant.standing()).homeTier === false);

  const foreign = await outcome(asStore(store).merchant.updateListing({ listingId: legacy.id, priceCents: 1000, inStock: true }));
  check("a store cannot change another store's listing", foreign.code === "NOT_FOUND", foreign.code);
  const tooLow = await outcome(asStore(store).merchant.updateListing({ listingId: storeChilled.id, priceCents: 10, inStock: true }));
  check("a price below 50 cents is refused", tooLow.code === "BAD_REQUEST", tooLow.code);
  const fix = await outcome(asStore(store).merchant.updateListing({ listingId: storeChilled.id, priceCents: 1250, inStock: false }));
  const fixed = await prisma.listing.findUniqueOrThrow({ where: { id: storeChilled.id } });
  check("a seller fixes a price and marks a product out", fix.code === "ok" && fixed.priceCents === 1250 && fixed.stockStatus === "out_of_stock");
  await asStore(store).merchant.updateListing({ listingId: storeChilled.id, priceCents: 1250, inStock: true });
  check("and marks it back in stock", (await prisma.listing.findUniqueOrThrow({ where: { id: storeChilled.id } })).stockStatus === "in_stock");

  const none = await outcome(asStore(aspiring).merchant.applyForKitchenLicence({}));
  check("an application with neither a photo nor a number is refused", none.code === "BAD_REQUEST", none.code);
  const jpeg = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#ffffff" } }).jpeg().toBuffer();
  const photo = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  const notAPhoto = await outcome(asStore(aspiring).merchant.applyForKitchenLicence({ document: Buffer.from("not an image").toString("base64") }));
  check("a document that is not an image is refused", notAPhoto.code === "BAD_REQUEST", notAPhoto.code);
  const byPhoto = await outcome(asStore(aspiring).merchant.applyForKitchenLicence({ document: photo }));
  const photoRow = await prisma.kitchenLicence.findUniqueOrThrow({ where: { storeId: aspiring } });
  check("a photo of the licence alone makes an application", byPhoto.code === "ok" && photoRow.status === "applied", byPhoto.code);
  check("the photo is kept as the evidence", photoRow.evidence?.startsWith("/photos/document/") === true && photoRow.licenceNumber === null, String(photoRow.evidence));
  const badge = await outcome(asStore(aspiring).merchant.applyForBadge({ kind: "diaspora_owned", document: photo }));
  const badgeRow = await prisma.sellerBadge.findUniqueOrThrow({ where: { storeId_kind: { storeId: aspiring, kind: "diaspora_owned" } } });
  check("a badge application with a photo is kept for review, never granted", badge.code === "ok" && badgeRow.status === "applied" && badgeRow.evidence?.startsWith("/photos/document/") === true);
  const standingAfter = await asStore(aspiring).merchant.standing();
  check("standing reports both as applied", standingAfter.kitchen === "applied" && standingAfter.badges.some((b) => b.kind === "diaspora_owned" && b.status === "applied"));
  await prisma.kitchenLicence.deleteMany({ where: { storeId: aspiring } });

  console.log("\n=== 9. reclassifying a product is audited ===");
  const reclass = await outcome(ops.admin.setControlledCategory({ productId: plain, controlledCategory: "poultry", reason: "Chicken seasoning blend with dried chicken" }));
  check("a product can be reclassified", reclass.code === "ok");
  check("and it is audited", (await auditFor(plain, "product.reclassify")).length === 1);
  const reclassByReviewer = await outcome(reviewer.admin.setControlledCategory({ productId: plain, controlledCategory: null, reason: "undo" }));
  check("a catalogue reviewer cannot reclassify (graph:write is operations')", reclassByReviewer.code === "FORBIDDEN", reclassByReviewer.code);
  const reclassByFinance = await outcome(finance.admin.setControlledCategory({ productId: plain, controlledCategory: null, reason: "x" }));
  check("finance cannot either", reclassByFinance.code === "FORBIDDEN", reclassByFinance.code);

  console.log("\n=== 10. the seeded catalogue is unaffected ===");
  const seededFish = await prisma.canonicalProduct.findFirst({ where: { category: "Fish & seafood", NOT: { id: { startsWith: "qc1v-" } } } });
  check("existing fish products were classified by the migration", !seededFish || seededFish.controlledCategory === "fish", seededFish?.canonicalName);
  const seededHidden = await prisma.listing.count({
    where: { NOT: { storeId: { startsWith: "qc1v-" } }, store: { is: { sellerType: { not: "store" } } } },
  });
  check("no seeded listing belongs to a home-tier seller, so none can have been hidden", seededHidden === 0, String(seededHidden));
} finally {
  await sweep();
  // Only the switch this run toggled, and only after the preflight showed none were on.
  await prisma.platformCategoryControl.deleteMany({ where: { category: "meat" } });
  await prisma.$disconnect();
}

console.log(failures === 0 ? "\nAll QC-1 checks passed." : `\n${failures} QC-1 check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
