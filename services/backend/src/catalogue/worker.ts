import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { prisma } from "../db.js";
import { photoStore } from "../storage/store.js";
import { mergeReadings, readingSchema, resolveProducts, type Seen, type Reader } from "./extraction.js";
import { cleanShelfUploads, cutoff, releaseReviewedFrames } from "./photoRetention.js";
import { liveReader } from "./providers.js";

export async function processNextCapture(readerFor: (storeId: string) => Reader = liveReader, onlySession?: string) {
  const lease = randomUUID();
  const claimed = await prisma.$queryRaw<{ sessionId: string }[]>`
    UPDATE "ExtractionJob" SET "state"='running', "lease"=${lease}, "leaseUntil"=now()+interval '10 minutes',
      "attempts"="attempts"+1, "message"=NULL
    WHERE "sessionId"=(SELECT j."sessionId" FROM "ExtractionJob" j
      JOIN "FilmSession" f ON f.id=j."sessionId" JOIN "Store" s ON s.id=f."storeId"
      WHERE (j."state"='queued' OR (j."state"='running' AND j."leaseUntil"<now()))
      AND (${onlySession ?? null}::text IS NULL OR j."sessionId"=${onlySession ?? null})
      AND s."onboardingRail"='film' AND s."ownerPhoneVerifiedAt" IS NOT NULL
      AND s."onboardingStatus" NOT IN ('suspended','delisted')
      ORDER BY j."createdAt" LIMIT 1 FOR UPDATE OF j SKIP LOCKED)
    RETURNING "sessionId"`;
  if (!claimed[0]) return false;
  const sessionId = claimed[0].sessionId;
  const claim = { sessionId, lease, state: "running" };
  try {
    const session = await prisma.filmSession.findUniqueOrThrow({ where: { id: sessionId },
      include: { frames: { where: { uploadedAt: { gt: cutoff() } }, orderBy: [{ shelf: "asc" }, { position: "asc" }] } } });
    if (!session.frames.length) throw new Error("No available shelf photos.");
    const provider = readerFor(session.storeId);
    async function renew() {
      const result = await prisma.extractionJob.updateMany({ where: { ...claim, session: { store: {
        ownerPhoneVerifiedAt: { not: null }, onboardingRail: "film", onboardingStatus: { notIn: ["suspended","delisted"] },
      } } }, data: { leaseUntil: new Date(Date.now()+600_000) } });
      if (!result.count) throw new Error("Capture is unavailable.");
    }
    const rows: Seen[] = [];
    for (let i=0; i<session.frames.length; i+=4) {
      await renew();
      const batch = session.frames.slice(i,i+4);
      const images = await Promise.all(batch.map(async f => {
        const image = await photoStore.read("shelf", f.name);
        if (!image || f.uploadedAt <= cutoff()) throw new Error("A saved frame is unavailable.");
        return image;
      }));
      for (const raw of await provider.read(images, i/4)) {
        const item = readingSchema.parse(raw);
        if (item.frames.some(index => index >= batch.length)) throw new Error("Reading references an unknown frame.");
        rows.push({ ...item, frameNames: item.frames.map(index => batch[index]!.name) });
      }
    }
    const products = await prisma.canonicalProduct.findMany({ select: { id: true, canonicalName: true, packSize: true,
      aliases: { select: { alias: true } } } });
    const drafts = await resolveProducts(mergeReadings(rows), products, {
      read: provider.read, embed: async (texts, type) => { await renew(); return provider.embed(texts, type); },
    });
    await prisma.$transaction(async tx => {
      const won = await tx.extractionJob.updateMany({ where: claim, data: { state: "ready", lease: null, leaseUntil: null } });
      if (!won.count) throw new Error("Extraction lease expired.");
      if (drafts.length) await tx.catalogueDraft.createMany({ data: drafts.map(d => ({ ...d, storeId: session.storeId, jobId: sessionId })) });
      await releaseReviewedFrames(tx, sessionId);
    });
    await cleanShelfUploads().catch(() => console.warn("Shelf cleanup will retry."));
  } catch (error) {
    const budget = error instanceof Error && error.message === "Daily shelf reading budget reached.";
    const message = budget ? "Today's reading budget has been reached. Try again tomorrow." : "We couldn't finish reading these shelves. Check your saved photos before retrying.";
    await prisma.extractionJob.updateMany({ where: claim, data: { state: "failed", message, lease: null, leaseUntil: null } });
    console.warn("Shelf extraction failed", { sessionId, reason: error instanceof Error ? error.name : "Error", budget });
  }
  return true;
}

export async function runExtractionWorker(signal: AbortSignal) {
  while (!signal.aborted) {
    try {
      if (process.env.SHELF_EXTRACTION_ENABLED === "yes" && await processNextCapture()) continue;
    } catch { console.warn("Shelf extraction queue is temporarily unavailable."); }
    await delay(5000, undefined, { signal, ref: false }).catch(() => undefined);
  }
}
