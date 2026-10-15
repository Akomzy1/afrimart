/**
 * The operations console in a real browser, signed in as the dev-only staff
 * accounts (services/backend/src/auth/devStaff.ts), with real TOTP codes.
 *
 * Needs the backend (:4000) and the ops app (:3002) running, a local database,
 * and the accounts seeded:
 *   npm run seed:dev-staff --workspace=@afrimart/backend
 *   npm run e2e:ops
 *
 * It makes its own throwaway shop, licence application, badge application and
 * buyer report (every id starts "e2eops-"), drives the console through them, and
 * removes them afterwards. Audit entries are append-only by design and stay.
 *
 * What it proves in the browser, which the in-process tests cannot: that the
 * tables never carry a photo link, that opening a photo is a click that yields a
 * signed short-lived link the API really serves (and the bare path does not),
 * that every opening is written to the audit log, that a licence approval needs
 * the three things a reviewer reads off it, that a shop's sign-in phone can be
 * set from the console, and that a role without a permission does not get the tab.
 */
import sharp from "sharp";
import { generateSync } from "otplib";
import { prisma } from "../../services/backend/src/db.js";
import { photoStore } from "../../services/backend/src/storage/store.js";
import { decodeUpload } from "../../services/backend/src/storage/photos.js";
import { DEV_STAFF_PASSWORD, DEV_STAFF_TOTP_SECRET, DEV_STAFF_DOMAIN } from "../../services/backend/src/auth/devStaff.js";
import { Browser, checker } from "./cdp.js";

const OPS = process.env.OPS_URL ?? "http://localhost:3002";
const SHOTS = process.env.SHOTS_DIR ?? "";
const P = "e2eops-";
const c = checker();
const ok = c.check;

async function seed() {
  const hub = await prisma.hubMetro.findFirstOrThrow();
  const jpeg = await sharp({ create: { width: 90, height: 70, channels: 3, background: "#8a6f4d" } }).jpeg().toBuffer();
  const asUpload = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  const photo = async (kind: "document" | "claim" | "packing") => photoStore.put(kind, decodeUpload(asUpload));

  const home = await prisma.store.create({
    data: { id: `${P}home`, name: "E2E Ops Home Kitchen", ownerName: "Tester", sellerType: "home_seller", hubMetroId: hub.id, onboardingStatus: "live", verificationStatus: "verified" },
  });
  const other = await prisma.store.create({
    data: { id: `${P}other`, name: "E2E Ops Other Shop", ownerName: "Tester", sellerType: "store", ownerPhone: "+15555550166", hubMetroId: hub.id, onboardingStatus: "live", verificationStatus: "verified" },
  });
  await prisma.kitchenLicence.create({ data: { storeId: home.id, status: "applied", evidence: await photo("document") } });
  await prisma.sellerBadge.create({ data: { storeId: home.id, kind: "diaspora_owned", status: "applied", evidence: await photo("document") } });

  const buyer = await prisma.buyer.create({ data: { id: `${P}buyer`, email: "e2eops-buyer@e2eops.test" } });
  const orderId = `${P}order`;
  await prisma.order.create({ data: { id: orderId, buyerId: buyer.id, status: "placed", totalCents: 5000, shippingCents: 800, taxCents: 100 } });
  const shipmentId = `${P}ship`;
  await prisma.shipment.create({
    data: { id: shipmentId, orderId, storeId: other.id, temperatureClass: "ambient", status: "delivered", packingPhotoUrl: await photo("packing"), packingPhotoAt: new Date() },
  });
  const claim = await prisma.refundClaim.create({
    data: { buyerId: buyer.id, orderId, shipmentId, kind: "item", reason: "missing_items", amountCents: 900, photoUrl: await photo("claim"), status: "manual_review" },
  });
  return { home, other, claim, shipmentId };
}

async function cleanup() {
  await prisma.refundClaim.deleteMany({ where: { buyerId: { startsWith: P } } });
  await prisma.shipment.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.order.deleteMany({ where: { buyerId: { startsWith: P } } });
  await prisma.sellerBadge.deleteMany({ where: { storeId: { startsWith: P } } });
  await prisma.kitchenLicence.deleteMany({ where: { storeId: { startsWith: P } } });
  await prisma.userSession.deleteMany({ where: { storeId: { startsWith: P } } });
  await prisma.store.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.buyer.deleteMany({ where: { id: { startsWith: P } } });
}

async function signIn(b: Browser, who: "admin" | "reviewer") {
  await b.goto(OPS);
  await b.waitFor(`document.querySelector("#em")`, "the sign-in form", 300_000);
  await b.type("#em", `${who}@${DEV_STAFF_DOMAIN}`);
  await b.type("#pw", DEV_STAFF_PASSWORD);
  await b.click("Continue", "button");
  await b.waitFor(`document.querySelector("#cd")`, "the authenticator step", 30_000);
  // a code is valid for 30 seconds; wait for a fresh one if this one is about to turn over
  const left = 30 - (Math.floor(Date.now() / 1000) % 30);
  if (left < 4) await new Promise((r) => setTimeout(r, (left + 1) * 1000));
  await b.type("#cd", generateSync({ secret: DEV_STAFF_TOTP_SECRET }));
  await b.click("Sign in", "button");
  // the strip is drawn before the signed-in profile arrives; wait for the tabs themselves
  await b.waitFor(`document.querySelector(".op-tabs button")`, "the console", 60_000);
}

const tabLabels = (b: Browser) => b.eval<string[]>(`[...document.querySelectorAll(".op-tabs button")].map((t) => t.innerText.replace(/\\s+/g, " ").trim())`);
const rowAction = (b: Browser, rowText: string, needle: string) =>
  b.eval<boolean>(`(() => {
    const row = [...document.querySelectorAll("tr")].find((r) => r.innerText.includes(${JSON.stringify(rowText)}));
    if (!row) return false;
    const el = [...row.querySelectorAll("button")].find((e) => e.innerText.replace(/\\s+/g, " ").includes(${JSON.stringify(needle)}));
    if (!el || el.disabled) return false; el.click(); return true; })()`);
const rowType = (b: Browser, rowText: string, selector: string, value: string) =>
  b.eval<boolean>(`(() => {
    const row = [...document.querySelectorAll("tr")].find((r) => r.innerText.includes(${JSON.stringify(rowText)}));
    const el = row && row.querySelector(${JSON.stringify(selector)}); if (!el) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
const rowText = (b: Browser, rowKey: string) => b.eval<string>(`(() => { const r = [...document.querySelectorAll("tr")].find((x) => x.innerText.includes(${JSON.stringify(rowKey)})); return r ? r.innerText.replace(/\\s+/g, " ") : ""; })()`);
const shot = (b: Browser, name: string) => (SHOTS ? b.screenshot(`${SHOTS}/ops-${name}.png`) : Promise.resolve());

await cleanup();
const { home, other, claim, shipmentId } = await seed();
const started = new Date();
const b = await Browser.launch({ width: 1280, height: 900 });
try {
  console.log("=== signing in as the dev admin, with a real authenticator code ===");
  await signIn(b, "admin");
  const tabs = await tabLabels(b);
  ok("the admin lands in the console with every tab", ["Catalogue review", "Onboarding", "Seller rules", "Buyer reports", "Reconciliation"].every((t) => tabs.some((x) => x.startsWith(t))), tabs.join(" | "));
  await shot(b, "01-console");

  console.log("\n=== Seller rules: a photo is a click, not a link ===");
  await b.click("Seller rules", ".op-tabs button");
  await b.waitFor(`document.body.innerText.includes("Licensed kitchen applications")`, "the licence table");
  await b.waitFor(`[...document.querySelectorAll("tr")].some((r) => r.innerText.includes("E2E Ops Home Kitchen"))`, "the seeded application");
  ok("no picture and no link to a photo is anywhere in the licence or badge tables", await b.eval<boolean>(`document.querySelectorAll("img").length === 0 && ![...document.querySelectorAll("a")].some((a) => (a.href || "").includes("/photos/")) && !document.documentElement.innerHTML.includes("/photos/document/")`));
  ok("each row says opening the photo is recorded", (await rowText(b, "E2E Ops Home Kitchen")).includes("Opening it is recorded"));
  await b.eval(`window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; }`);
  await b.click("Open the photo", "button");
  await b.waitFor(`window.__opened.length === 1`, "the photo link");
  const link = await b.eval<string>(`window.__opened[0]`);
  ok("it opens a signed link, valid for minutes", /\/photos\/document\/[a-f0-9]{32}\.jpg\?exp=\d+&sig=[a-f0-9]{64}$/.test(link), link.replace(/sig=.*/, "sig=…"));
  const served = await b.eval<{ status: number; type: string | null; cache: string | null }>(`fetch(${JSON.stringify(link)}).then((r) => ({ status: r.status, type: r.headers.get("content-type"), cache: r.headers.get("cache-control") }))`);
  ok("the API serves it as an image that is never cached", served.status === 200 && served.type === "image/jpeg" && /no-store/.test(served.cache ?? ""), JSON.stringify(served));
  const bare = await b.eval<number>(`fetch(${JSON.stringify(link.split("?")[0])}).then((r) => r.status)`);
  ok("the same path without its signature is 404", bare === 404, String(bare));
  const views = await prisma.auditLogEntry.findMany({ where: { action: "photo.view", subjectType: "kitchen_licence", createdAt: { gte: started } } });
  ok("the opening is in the audit log, by this staff member", views.length === 1 && views[0]!.actorEmail === `admin@${DEV_STAFF_DOMAIN}` && views[0]!.actorRole === "admin", `${views.length} entries`);

  console.log("\n=== Seller rules: approving takes what the reviewer read ===");
  ok("Approve is off until everything is filled in", !(await rowAction(b, "E2E Ops Home Kitchen", "Approve")));
  await rowType(b, "E2E Ops Home Kitchen", 'input[type="checkbox"]', "");
  await b.eval(`(() => { const row = [...document.querySelectorAll("tr")].find((r) => r.innerText.includes("E2E Ops Home Kitchen") && r.querySelector('input[type="checkbox"]')); row.querySelector('input[type="checkbox"]').click(); })()`);
  await rowType(b, "E2E Ops Home Kitchen", 'input[aria-label^="Licence number"]', "E2E-77");
  await rowType(b, "E2E Ops Home Kitchen", 'input[aria-label="Who issued the licence"]', "County Health Dept");
  await rowType(b, "E2E Ops Home Kitchen", 'input[placeholder^="Reason"]', "Checked against the county register");
  ok("still off without an expiry date", !(await rowAction(b, "E2E Ops Home Kitchen", "Approve")));
  await rowType(b, "E2E Ops Home Kitchen", 'input[type="date"]', "2020-01-01");
  await rowAction(b, "E2E Ops Home Kitchen", "Approve");
  await b.waitFor(`document.querySelector(".op-err")`, "the refusal of an expired licence");
  ok("a licence that has already expired is refused, in words", (await b.text()).includes("already expired"));
  ok("and nothing changed", (await prisma.kitchenLicence.findUniqueOrThrow({ where: { storeId: home.id } })).status === "applied");
  await rowType(b, "E2E Ops Home Kitchen", 'input[type="date"]', "2031-06-30");
  await rowAction(b, "E2E Ops Home Kitchen", "Approve");
  await b.waitFor(`![...document.querySelectorAll("tr")].some((r) => r.innerText.includes("E2E Ops Home Kitchen") && r.innerText.includes("Applied"))`, "the application leaving the waiting list", 20_000);
  let approved = await prisma.kitchenLicence.findUniqueOrThrow({ where: { storeId: home.id } });
  for (let i = 0; i < 20 && approved.status !== "approved"; i++) {
    await new Promise((res) => setTimeout(res, 500));
    approved = await prisma.kitchenLicence.findUniqueOrThrow({ where: { storeId: home.id } });
  }
  ok("approved, with the number, the authority and the date on the record", approved.status === "approved" && approved.verifiedLicenceNumber === "E2E-77" && approved.verifiedIssuingAuthority === "County Health Dept" && approved.licenceExpiresOn?.toISOString().slice(0, 10) === "2031-06-30", JSON.stringify({ s: approved.status, n: approved.verifiedLicenceNumber, a: approved.verifiedIssuingAuthority, e: approved.licenceExpiresOn }));
  const licenceAudit = await prisma.auditLogEntry.findFirst({ where: { action: "store.kitchen_licence_change", subjectId: home.id, createdAt: { gte: started } }, orderBy: { createdAt: "desc" } });
  ok("and the audit entry carries what was checked", (licenceAudit?.after as { licenceNumber?: string; expiresOn?: string } | null)?.licenceNumber === "E2E-77" && String((licenceAudit?.after as { expiresOn?: string } | null)?.expiresOn).startsWith("2031-06-30"));
  await b.eval(`(() => { const s = document.querySelector("#licstatus"); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, "approved"); s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  await b.waitFor(`[...document.querySelectorAll("tr")].some((r) => r.innerText.includes("E2E Ops Home Kitchen") && r.innerText.includes("Expires 2031-06-30"))`, "the approved row with its expiry");
  ok("the approved row shows the number, who issued it and when it lapses", (await rowText(b, "E2E Ops Home Kitchen")).includes("E2E-77") && (await rowText(b, "E2E Ops Home Kitchen")).includes("Expires 2031-06-30"));
  await shot(b, "02-approved");
  await b.waitFor(`document.body.innerText.includes("Photo opened")`, "the recent-changes table showing the photo opening");
  ok("Recent changes lists the photo opening and the licence decision", (await b.text()).includes("Photo opened") && (await b.text()).includes("Kitchen licence"));

  console.log("\n=== Buyer reports: the photos are opened on purpose ===");
  await b.click("Buyer reports", ".op-tabs button");
  await b.waitFor(`document.body.innerText.includes("Buyer reports") && [...document.querySelectorAll("tr")].some((r) => r.innerText.includes("e2eops-buyer@e2eops.test"))`, "the seeded report");
  ok("the report's row has no pictures until asked", await b.eval<boolean>(`![...document.querySelectorAll("tr")].find((r) => r.innerText.includes("e2eops-buyer@")).querySelector("img")`));
  ok("and says opening is recorded", (await rowText(b, "e2eops-buyer@")).includes("Opening a photo is recorded"));
  await rowAction(b, "e2eops-buyer@", "Show photos");
  await b.waitFor(`[...document.querySelectorAll("tr")].find((r) => r.innerText.includes("e2eops-buyer@")).querySelectorAll("img").length === 2`, "both photos");
  await b.waitFor(`[...[...document.querySelectorAll("tr")].find((r) => r.innerText.includes("e2eops-buyer@")).querySelectorAll("img")].every((i) => i.complete && i.naturalWidth > 0)`, "both photos to load", 20_000);
  ok("the buyer's photo and the seller's packing photo load from signed links", true);
  const claimViews = await prisma.auditLogEntry.findMany({ where: { action: "photo.view", createdAt: { gte: started }, OR: [{ subjectId: claim.id }, { subjectId: shipmentId }] } });
  ok("each photo opened is its own audit entry", claimViews.length === 2 && claimViews.every((v) => v.actorEmail === `admin@${DEV_STAFF_DOMAIN}`), String(claimViews.length));
  await shot(b, "03-claim-photos");

  console.log("\n=== Onboarding: setting the number a shop signs in with ===");
  await b.click("Onboarding", ".op-tabs button");
  await b.waitFor(`[...document.querySelectorAll("tr")].some((r) => r.innerText.includes("E2E Ops Home Kitchen"))`, "the store table");
  ok("a shop with no number says so; one with a number shows only the last four digits", (await rowText(b, "E2E Ops Home Kitchen")).includes("Sign-in phone: none") && (await rowText(b, "E2E Ops Other Shop")).includes("••• 0166") && !(await rowText(b, "E2E Ops Other Shop")).includes("5555550166"));
  await rowAction(b, "E2E Ops Home Kitchen", "Set");
  await rowType(b, "E2E Ops Home Kitchen", 'input[aria-label="Owner mobile number"]', "(555) 555-0142");
  ok("Save is off without a reason", !(await rowAction(b, "E2E Ops Home Kitchen", "Save")));
  await rowType(b, "E2E Ops Home Kitchen", 'input[aria-label="Reason"]', "Owner confirmed this number on a call");
  await rowAction(b, "E2E Ops Home Kitchen", "Save");
  await b.waitFor(`[...document.querySelectorAll("tr")].some((r) => r.innerText.includes("E2E Ops Home Kitchen") && r.innerText.includes("••• 0142"))`, "the new number");
  ok("the number is saved", (await prisma.store.findUniqueOrThrow({ where: { id: home.id } })).ownerPhone === "+15555550142");
  const phoneAudit = await prisma.auditLogEntry.findFirst({ where: { action: "store.owner_phone_change", subjectId: home.id, createdAt: { gte: started } } });
  ok("and audited with the reason and who", phoneAudit?.actorEmail === `admin@${DEV_STAFF_DOMAIN}` && /confirmed this number/.test(phoneAudit?.note ?? ""));
  await rowAction(b, "E2E Ops Home Kitchen", "Change");
  await rowType(b, "E2E Ops Home Kitchen", 'input[aria-label="Owner mobile number"]', "555-555-0166");
  await rowType(b, "E2E Ops Home Kitchen", 'input[aria-label="Reason"]', "Trying a number that is another shop's");
  await rowAction(b, "E2E Ops Home Kitchen", "Save");
  await b.waitFor(`document.body.innerText.includes("already signs in with that number")`, "the refusal");
  ok("a number that belongs to another shop is refused", (await prisma.store.findUniqueOrThrow({ where: { id: home.id } })).ownerPhone === "+15555550142");
  await shot(b, "04-onboarding");
  ok("no console errors on any of those screens", b.consoleErrors.length === 0, b.consoleErrors.slice(0, 3).join(" | "));
} catch (e) {
  ok(`the run completed (${(e as Error).message.slice(0, 300)})`, false);
  if (SHOTS) await b.screenshot(`${SHOTS}/ops-99-error.png`).catch(() => undefined);
} finally {
  await b.close();
}

console.log("\n=== a role without the permission does not get the tab ===");
const b2 = await Browser.launch({ width: 1280, height: 900 });
try {
  await signIn(b2, "reviewer");
  const tabs = await tabLabels(b2);
  ok("the catalogue reviewer sees the catalogue queue and the graph", tabs.some((t) => t.startsWith("Catalogue review")) && tabs.some((t) => t.startsWith("Knowledge graph")), tabs.join(" | "));
  ok("but not Seller rules, Buyer reports, Onboarding or Reconciliation", !tabs.some((t) => /^(Seller rules|Buyer reports|Onboarding|Reconciliation)/.test(t)), tabs.join(" | "));
  await shot(b2, "05-reviewer");
  ok("no console errors", b2.consoleErrors.length === 0, b2.consoleErrors.slice(0, 3).join(" | "));
} catch (e) {
  ok(`the reviewer run completed (${(e as Error).message.slice(0, 300)})`, false);
} finally {
  await b2.close();
  await cleanup();
  await prisma.$disconnect();
}

console.log(c.failures === 0 ? "\nAll operations-console browser checks passed." : `\n${c.failures} operations-console check(s) FAILED.`);
process.exit(c.failures === 0 ? 0 : 1);
