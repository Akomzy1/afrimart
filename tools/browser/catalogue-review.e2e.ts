/** Offline provider playback, real local storage and database, and the seller review screen in Chrome. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import { Browser } from "./cdp.js";
import { prisma } from "../../services/backend/src/db.js";
import { assertDevOnlyAllowed } from "../../services/backend/src/runtime.js";
import { issueUserSession } from "../../services/backend/src/auth/userSession.js";
import { callerFor } from "../../services/backend/src/scripts/callers.js";
import { processNextCapture } from "../../services/backend/src/catalogue/worker.js";
import { liveReader } from "../../services/backend/src/catalogue/providers.js";
import { cleanShelfUploads } from "../../services/backend/src/routers/shelfCapture.js";
import { visibleListings } from "../../services/backend/src/quality/categoryAccess.js";

assertDevOnlyAllowed();
const recorded = JSON.parse(await readFile(new URL("./fixtures/shelf-reading.json", import.meta.url), "utf8"));
const calls: string[] = [];
const playback: typeof fetch = async (url, init) => {
  const request = JSON.parse(String(init?.body));
  calls.push(String(url));
  if (String(url).endsWith("/count_tokens")) return Response.json({ input_tokens: 1150 });
  if (String(url) === "https://api.anthropic.com/v1/messages") {
    assert.equal(request.tools[0].name, "record_shelf");
    assert.equal(request.messages[0].content.length, 2);
    assert.equal(request.messages[0].content[0].source.media_type, "image/jpeg");
    return Response.json(recorded);
  }
  assert.equal(String(url), "https://api.voyageai.com/v1/embeddings");
  return Response.json({ data: request.input.map((s: string, index: number) => ({ index,
    embedding: s.includes("yam") || s.includes("Yam") ? [1,0] : [0,1] })), usage: { total_tokens: request.input.length * 10 } });
};
Object.assign(process.env, { SHELF_EXTRACTION_ENABLED: "yes", ANTHROPIC_API_KEY: "playback", VOYAGE_API_KEY: "playback",
  SHELF_VISION_MODEL: "fixture-vision", SHELF_EMBEDDING_MODEL: "fixture-embedding", SHELF_VISION_INPUT_RATE: "3",
  SHELF_VISION_OUTPUT_RATE: "15", SHELF_EMBEDDING_RATE: "0.1", SHELF_DAILY_BUDGET_CENTS: "1" });
const reader = (storeId: string) => liveReader(storeId, playback);
const run = randomUUID();
const hub = await prisma.hubMetro.findFirstOrThrow({ where: { active: true } });
const store = await prisma.store.create({ data: { name: "Catalogue walkthrough", ownerName: "Walkthrough", sellerType: "home_seller",
  hubMetroId: hub.id, ownerPhoneVerifiedAt: new Date(), onboardingProfileAt: new Date(), foodSafetyAttestedAt: new Date(),
  onboardingRail: "film", onboardingStatus: "filming" } });
const seller = callerFor({ identity: "store:" + store.id });
const ids = { yam: run + "-yam", fish: run + "-fish", spice: run + "-spice" };
let browser: Browser | undefined;
try {
  for (const [id, canonicalName, packSize] of [[ids.yam,"Walkthrough yam flour","731 g"],[ids.fish,"Dried fish","419 g"],[ids.spice,"Walkthrough spice","37 g"]]) {
    await prisma.canonicalProduct.create({ data: { id: id!, canonicalName: canonicalName!, packSize: packSize!,
      shortDescription: "Fixture", usedDescription: "Fixture", cuisine: "Nigerian", category: "Grocery", shippingWeightOz: 12,
      temperatureClass: "ambient", controlledCategory: id === ids.fish ? "fish" : null, images: [],
      aliases: id === ids.yam ? { create: { alias: "àmàlà", language: "yo", confidence: 1 } } : undefined } });
  }
  const image = await sharp(Buffer.from('<svg width="400" height="220"><rect width="400" height="220" fill="#f7f0dc"/><text x="24" y="94" font-size="38">Yam flour</text><text x="24" y="156" font-size="30">731 g · $5.25</text></svg>')).jpeg().toBuffer();
  await seller.shelfCapture.saveShelf({ revision: 0, shelf: 1, passId: randomUUID(), frames: [image.toString("base64"),image.toString("base64")] });
  await seller.shelfCapture.finish({ revision: 1 });
  const film = await prisma.filmSession.findUniqueOrThrow({ where: { storeId: store.id } });
  await processNextCapture(reader, film.id);
  assert.match((await seller.catalogueReview.state()).message ?? "", /budget/);
  assert.equal(calls.filter(s => s.endsWith("/messages")).length, 0);
  process.env.SHELF_DAILY_BUDGET_CENTS = "200";
  await seller.catalogueReview.retry();
  const workers = await Promise.all([processNextCapture(reader, film.id), processNextCapture(reader, film.id)]);
  assert.equal(workers.filter(Boolean).length, 1);
  let state = await seller.catalogueReview.state();
  assert.equal(state.state, "ready");
  assert.equal(state.items.length, 5);
  const byName = (name: string) => state.items.find(i => i.name === name)!;
  const flour = byName("Àmàlà");
  assert.equal(flour.selected, ids.yam);
  assert.equal((await prisma.catalogueDraft.findUniqueOrThrow({ where: { id: flour.id } })).frameNames.length, 2);
  assert.ok(byName("Yam meal").candidates.some(p => p.id === ids.yam));
  assert.ok(calls.some(u => u.endsWith("/embeddings")));
  assert.equal(byName("Dried fish").priceCents, null);
  assert.ok(await prisma.extractionUsage.count({ where: { storeId: store.id, latencyMs: { not: null } } }));
  const staff = await prisma.staffUser.findFirstOrThrow({ where: { role: "admin" } });
  const ops = callerFor({ staff: { sessionId: run, staffUserId: staff.id, role: "admin", name: staff.name, email: staff.email, mfaEnrolled: true, mfaVerified: true } }).admin;
  assert.ok(!(await ops.reviewQueue()).some(d => d.id === flour.id));
  await assert.rejects(seller.catalogueReview.publish({ revision: 0 }));
  async function edit(name: string, action: "remove"|"merge"|"confirm"|"staff", productId: string|null, priceCents: number|null, target?: string) {
    const draft = byName(name);
    await seller.catalogueReview.edit({ id: draft.id, revision: state.revision, name, productId, priceCents, action, target });
    state = await seller.catalogueReview.state();
  }
  await edit("Display sample", "remove", null, null);
  await edit("Yam meal", "merge", ids.yam, 525, flour.id);
  await assert.rejects(edit("Dried fish", "confirm", ids.fish, 799), /permit/i);
  await seller.merchant.confirmPermit({ category: "fish", acknowledged: true });
  await edit("Dried fish", "confirm", ids.fish, 799);
  await edit("Unlabelled spice", "staff", null, null);
  const origin = process.env.MERCHANT_URL ?? "http://localhost:3001";
  const token = await issueUserSession({ kind: "store", storeId: store.id }, {});
  const b = browser = await Browser.launch({ width: 390, height: 844, mobile: true });
  await b.send("Network.setCookie", { name: "afrimart_store", value: token.token, url: origin, httpOnly: true });
  await b.goto(origin + "/onboarding");
  await b.waitFor("document.body.innerText.includes('Review catalogue')", "onboarding review entry", 120_000);
  await b.click("Review catalogue");
  await b.waitFor("document.querySelector('.mr-rtile')", "product review tiles", 120_000);
  const tile = `[...document.querySelectorAll('.mr-rtile')].find(t => t.textContent.includes("Àmàlà"))`;
  await b.click("Review item","button",tile);
  await b.waitFor("document.querySelector('.mr-review-source')?.naturalWidth > 0", "private source photo");
  await b.click("Increase price by 25 cents");
  await b.click("Confirm item");
  await b.waitFor(`(${tile})?.innerText.includes("Confirmed")`, "seller confirmation");
  assert.ok((await b.text()).includes("$5.50"));
  // A standing change after a seller confirms must still block the whole submission.
  await prisma.permitConfirmation.deleteMany({ where: { storeId: store.id, category: "fish" } });
  const reviewed = await seller.catalogueReview.state();
  await assert.rejects(seller.catalogueReview.publish({ revision: reviewed.revision }), { code: "PRECONDITION_FAILED" });
  assert.equal(await prisma.listing.count({ where: { storeId: store.id } }), 0);
  await seller.merchant.confirmPermit({ category: "fish", acknowledged: true });
  assert.equal(await b.overflow(),0);
  await b.screenshot(path.resolve("tmp/onboarding-qa/09-catalogue-review.png"));
  await b.goto(origin + "/onboarding/review");
  await b.waitFor("document.querySelector('.mr-actionbar button:not(:disabled)')", "review after reload");
  await b.send("Emulation.setDeviceMetricsOverride", { width: 320, height: 740, deviceScaleFactor: 2, mobile: true });
  assert.equal(await b.overflow(),0);
  await b.click("Submit catalogue");
  await b.waitFor("document.body.innerText.includes('Catalogue submitted.')", "catalogue submission");
  await seller.catalogueReview.publish({ revision: reviewed.revision });
  assert.equal(await prisma.listing.count({ where: { storeId: store.id } }),2);
  assert.equal(await prisma.listing.count({ where: await visibleListings(prisma,{ storeId: store.id }) }),0);
  const remaining = (await ops.reviewQueue()).filter(d => state.items.some(i => i.id === d.id));
  assert.equal(remaining.length,1);
  assert.ok(remaining[0]!.shelfPhoto);
  await ops.approveDraft({ id: remaining[0]!.id, canonicalProductId: ids.spice, priceCents: 400, learnAlias: true });
  assert.equal(await prisma.nameAlias.count({ where: { canonicalProductId: ids.spice, alias: "Unlabelled spice" } }),1);
  assert.equal(await prisma.listing.count({ where: { storeId: store.id } }),3);
  assert.equal(await prisma.shelfFrame.count({ where: { sessionId: film.id } }),0);
  assert.equal(b.consoleErrors.filter(e => e.startsWith("EXC ")).length,0);
  console.log("PASS budget, worker claim, recorded vision and embeddings, aliases, evidence merging, unknown price, QC-1, seller corrections, staff escalation, publication, privacy and mobile review.");
} finally {
  await browser?.close();
  await prisma.listing.deleteMany({ where: { storeId: store.id } });
  await prisma.catalogueDraft.deleteMany({ where: { storeId: store.id } });
  await prisma.userSession.deleteMany({ where: { storeId: store.id } });
  await prisma.permitConfirmation.deleteMany({ where: { storeId: store.id } });
  await prisma.store.delete({ where: { id: store.id } });
  await prisma.extractionUsage.deleteMany({ where: { storeId: store.id } });
  await prisma.nameAlias.deleteMany({ where: { canonicalProductId: { in: Object.values(ids) } } });
  await prisma.canonicalProduct.deleteMany({ where: { id: { in: Object.values(ids) } } });
  await cleanShelfUploads();
  await prisma.$disconnect();
}
