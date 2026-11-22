import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import { Browser } from "../browser/cdp.js";

const url = new URL(process.env.DATABASE_URL!);
assert.ok(["127.0.0.1","localhost","[::1]"].includes(url.hostname));
assert.ok(!process.env.S3_BUCKET, "This test requires local photo storage.");
const schema = "retention_test_" + randomUUID().replaceAll("-", "");
const root = await mkdtemp(path.join(tmpdir(), "afrimart-retention-"));
const adminDb = new PrismaClient();
const schemaName = '"' + schema + '"';
await adminDb.$executeRawUnsafe("CREATE SCHEMA " + schemaName);
url.searchParams.set("schema", schema);
process.env.DATABASE_URL = url.href;
process.env.UPLOAD_DIR = root;
try {
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", "services/backend/prisma/schema.prisma"], { stdio: "pipe" });
  const { prisma } = await import("../../services/backend/src/db.js");
  const { photoStore } = await import("../../services/backend/src/storage/store.js");
  const { cleanShelfUploads, runShelfRetention } = await import("../../services/backend/src/catalogue/photoRetention.js");
  const { callerFor } = await import("../../services/backend/src/scripts/callers.js");
  const { buildServer } = await import("../../services/backend/src/app.js");
  const app = await buildServer({ logger: false });
  const day = 86400000;
  const jpg = await sharp({ create: { width: 20, height: 20, channels: 3, background: "green" } }).jpeg().toBuffer();
  const abort = new AbortController();
  let worker: Promise<void> | undefined;
  let browser: Browser | undefined;
  try {
    const hub = await prisma.hubMetro.create({ data: { name: "Test", state: "TX" } });
    async function session(state?: string) {
      const store = await prisma.store.create({ data: { name: "Test", ownerName: "Test", sellerType: "store", hubMetroId: hub.id,
        ownerPhoneVerifiedAt: new Date(), onboardingProfileAt: new Date(), onboardingRail: "film" } });
      return prisma.filmSession.create({ data: { storeId: store.id, ...(state ? { finishedAt: new Date(),
        extraction: { create: { state, submittedAt: state === "ready" ? new Date() : null } } } : {}) } });
    }
    let position = 0;
    async function frame(sessionId: string, age: number) {
      const name = randomBytes(16).toString("hex") + ".jpg";
      await prisma.shelfFrame.create({ data: { sessionId, name, position: position++, shelf: 1, passId: randomUUID(), uploadedAt: new Date(Date.now()-age) } });
      await photoStore.put("shelf", jpg, name);
      assert.ok((await readFile(path.join(root, "shelf", name))).length);
      return name;
    }
    async function gone(name: string) {
      await assert.rejects(stat(path.join(root, "shelf", name)), { code: "ENOENT" });
      assert.equal(await prisma.shelfFrame.count({ where: { name } }), 0);
    }
    const film = await session("ready"), abandoned = await session(), failed = await session("failed");
    const first = await frame(film.id, day), shared = await frame(film.id, day);
    const retryFilm = await session("failed");
    const retryPhoto = await frame(retryFilm.id, 29*day);
    const original = await prisma.shelfFrame.findUniqueOrThrow({ where: { name: retryPhoto } });
    const retried = await callerFor({ identity: "store:" + retryFilm.storeId }).catalogueReview.retry();
    assert.equal(retried.queued, true);
    assert.equal((await prisma.shelfFrame.findUniqueOrThrow({ where: { name: retryPhoto } })).uploadedAt.getTime(), original.uploadedAt.getTime());
    const abandonedPhoto = await frame(abandoned.id, 31*day), failedPhoto = await frame(failed.id, 31*day);
    async function draft(name: string, frameNames: string[]) {
      return prisma.catalogueDraft.create({ data: { jobId: film.id, storeId: film.storeId, suggestedName: name, rawText: name, confidence: .8, decision: "staff", frameNames } });
    }
    const a = await draft("A", [first, shared]), b = await draft("B", [shared]);
    const staff = callerFor({ staff: { sessionId: randomUUID(), staffUserId: "tester", name: "Tester", email: "tester@example.test", role: "admin", mfaEnrolled: true, mfaVerified: true } }).admin;
    const seller = callerFor({ identity: "store:" + film.storeId }).catalogueReview;
    const before = await prisma.shelfFrame.findUniqueOrThrow({ where: { name: shared } });
    const queue = async (id: string) => (await staff.reviewQueue()).find(row => row.id === id)!;
    await staff.rejectDraft({ id: a.id, note: "Test" });
    await cleanShelfUploads();
    await gone(first);
    assert.ok(await photoStore.read("shelf", shared));
    assert.equal((await prisma.shelfFrame.findUniqueOrThrow({ where: { name: shared } })).uploadedAt.getTime(), before.uploadedAt.getTime());
    await assert.rejects(prisma.shelfFrame.update({ where: { name: shared }, data: { uploadedAt: new Date() } }));
    await staff.rejectDraft({ id: b.id, note: "Test" });
    await cleanShelfUploads();
    await gone(shared);
    await gone(abandonedPhoto);
    await gone(failedPhoto);
    console.log("PASS per-photo final link, immutable deadline, abandoned and failed captures");

    const old = await frame(film.id, 30*day - 2500);
    const c = await draft("C", [old]);
    const oldLink = (await queue(c.id)).shelfPhoto!;
    assert.ok(oldLink);
    assert.equal((await app.inject({ method: "GET", url: oldLink })).statusCode, 200);
    await delay(Math.max(0, (await prisma.shelfFrame.findUniqueOrThrow({ where: { name: old } })).uploadedAt.getTime() + 30*day - Date.now() + 10));
    assert.equal((await app.inject({ method: "GET", url: oldLink })).statusCode, 404);
    let attempts = 0;
    const flaky = { durable: false, read: photoStore.read.bind(photoStore), put: photoStore.put.bind(photoStore),
      async removeShelfFrame(name: string) { if (name === old && attempts++ === 0) throw Error("Injected storage failure"); await photoStore.removeShelfFrame(name); } };
    await cleanShelfUploads(flaky);
    assert.equal(attempts, 1);
    assert.ok((await stat(path.join(root, "shelf", old))).size);
    const pending = await queue(c.id);
    assert.equal(pending.status, "pending_review");
    assert.equal(pending.photoExpired, true);
    assert.equal(pending.shelfPhoto, null);
    const idle = await frame(abandoned.id, 30*day - 1500);
    worker = runShelfRetention(abort.signal);
    for (let i = 0; i < 120 && await prisma.shelfFrame.count({ where: { name: old } }); i++) await delay(100);
    await gone(old);
    await gone(idle);
    console.log("PASS old signed URL blocked at deadline, bytes survive injected failure, background retry unlinks file");

    if (process.argv.includes("--browser")) {
      await app.listen({ host: "127.0.0.1", port: 4000 });
      const { issueSession, markMfaVerified } = await import("../../services/backend/src/auth/session.js");
      const { issueUserSession } = await import("../../services/backend/src/auth/userSession.js");
      const account = await prisma.staffUser.create({ data: { email: "staff@example.test", name: "Test reviewer", role: "admin",
        passwordHash: "unused", mfaSecret: "TEST", mfaEnrolledAt: new Date() } });
      const token = await issueSession(account.id);
      await markMfaVerified(token.token);
      browser = await Browser.launch({ width: 1280, height: 840 });
      await browser.send("Page.addScriptToEvaluateOnNewDocument", { source:
        "if (location.origin === 'http://localhost:3002') sessionStorage.setItem('afrimart.ops.token'," + JSON.stringify(token.token) + ")" });
      await browser.goto("http://localhost:3002");
      await browser.waitFor("document.body.innerText.includes('A shelf photo expired')", "staff expiry notice", 120000);
      await browser.click("Request fresh photo");
      await browser.waitFor("document.body.innerText.includes('Fresh photo requested from seller')", "seller notified");
      const session = await issueUserSession({ kind: "store", storeId: film.storeId }, {});
      await browser.send("Network.setCookie", { name: "afrimart_store", value: session.token, url: "http://localhost:3001", httpOnly: true });
    }
    await Promise.all([staff.requestShelfPhoto({ id: c.id }), staff.requestShelfPhoto({ id: c.id })]);
    assert.equal(await prisma.sellerMessage.count({ where: { storeId: film.storeId } }), 1);
    const request = (await seller.state()).items.find(i => i.id === c.id)!.photoRequestId!;
    const input = { id: c.id, requestId: request, image: jpg.toString("base64") };
    await assert.rejects(callerFor({ identity: "store:" + failed.storeId }).catalogueReview.supplyPhoto(input));
    if (browser) {
      await browser.goto("http://localhost:3001/onboarding/review");
      await browser.waitFor("document.querySelector('input[type=file]')", "seller upload request", 120000);
      await browser.eval(`(async () => {
        const blob = await (await fetch('data:image/jpeg;base64,' + ${JSON.stringify(input.image)})).blob();
        const transfer = new DataTransfer();
        transfer.items.add(new File([blob], 'fresh.jpg', {type:'image/jpeg'}));
        const input = document.querySelector('input[type=file]');
        input.files = transfer.files;
        input.dispatchEvent(new Event('change',{bubbles:true}));
      })()`);
      await browser.waitFor("!document.querySelector('input[type=file]') && document.body.innerText.includes('Catalogue submitted')", "replacement received");
      await browser.goto("http://localhost:3002");
      await browser.waitFor("document.body.innerText.includes('View shelf photo') && !document.body.innerText.includes('A shelf photo expired')", "staff sees fresh evidence");
      console.log("PASS Chrome verified staff expiry notice, request, seller upload and fresh staff photo link");
    } else {
      await seller.supplyPhoto(input);
    }
    await assert.rejects(seller.supplyPhoto(input));
    const fresh = (await queue(c.id)).shelfPhoto!;
    assert.equal((await app.inject({ method: "GET", url: fresh })).statusCode, 200);
    const replacement = await prisma.shelfFrame.findFirstOrThrow({ where: { sessionId: film.id } });
    assert.ok(replacement.uploadedAt.getTime() > Date.now()-60000);
    assert.equal((await queue(c.id)).photoExpired, false);
    await staff.rejectDraft({ id: c.id, note: "Reviewed fresh photo" });
    await cleanShelfUploads();
    await gone(replacement.name);
    console.log("PASS staff request, seller-only replacement, replay protection, fresh deadline and final physical deletion");
  } finally { abort.abort(); await browser?.close(); await worker; await app.close(); await prisma.$disconnect(); }
} finally {
  await adminDb.$executeRawUnsafe("DROP SCHEMA " + schemaName + " CASCADE");
  await adminDb.$disconnect();
  await rm(root, { recursive: true, force: true });
}
