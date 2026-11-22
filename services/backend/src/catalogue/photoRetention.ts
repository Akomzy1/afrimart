import type { Prisma } from "@prisma/client";
import { setTimeout as sleep } from "node:timers/promises";
import { prisma } from "../db.js";
import { photoStore } from "../storage/store.js";
import { signedPhotoUrl } from "../storage/access.js";

const lifetime = 30 * 24 * 60 * 60 * 1000;
export const cutoff = () => new Date(Date.now() - lifetime);
export const availableFrame = () => ({ sessionId: { not: null }, uploadedAt: { gt: cutoff() } });

export async function reviewPhotos(drafts: { frameNames: string[] }[]) {
  const rows = await prisma.shelfFrame.findMany({ where: { ...availableFrame(),
    name: { in: [...new Set(drafts.flatMap(d => d.frameNames))] } }, select: { name: true } });
  const live = new Set(rows.map(f => f.name));
  return (names: string[]) => {
    const name = names.find(n => live.has(n));
    return { shelfPhoto: name ? signedPhotoUrl("/photos/shelf/" + name) : null,
      photoExpired: names.some(n => !live.has(n)) };
  };
}

// Run only after extraction has committed draft links, or inside a review transaction.
// A merged draft transfers its links to the surviving draft before this check.
export async function releaseReviewedFrames(tx: Prisma.TransactionClient, jobId: string) {
  await tx.$executeRaw`UPDATE "ShelfFrame" f SET "sessionId"=NULL, "deleteAfter"=CURRENT_TIMESTAMP
    WHERE f."sessionId"=${jobId} AND NOT EXISTS
    (SELECT FROM "CatalogueDraft" d WHERE d."jobId"=${jobId} AND d.status='pending_review' AND f.name=ANY(d."frameNames"))`;
}

export async function cleanShelfUploads(store = photoStore) {
  await prisma.shelfFrame.updateMany({ where: { sessionId: { not: null }, uploadedAt: { lte: cutoff() } },
    data: { sessionId: null, deleteAfter: new Date() } });
  const due = await prisma.shelfFrame.findMany({ where: { sessionId: null,
    OR: [{ deleteAfter: null }, { deleteAfter: { lte: new Date() } }] },
    orderBy: [{ deleteAfter: { sort: "asc", nulls: "first" } }, { name: "asc" }], take: 120, select: { name: true } });
  for (const { name } of due) {
    try {
      await store.removeShelfFrame(name);
      if (await store.read("shelf", name) !== null) throw new Error("Shelf photo still present.");
      await prisma.shelfFrame.deleteMany({ where: { name, sessionId: null } });
    } catch {
      // Preserve the deletion record and let other due objects make progress.
      await prisma.shelfFrame.updateMany({ where: { name, sessionId: null }, data: { deleteAfter: new Date(Date.now() + 5000) } });
      console.warn("Shelf photo deletion needs a retry.");
    }
  }
  return due.length;
}

export async function runShelfRetention(signal: AbortSignal) {
  while (!signal.aborted) {
    let wait = 1000;
    try {
      if (await cleanShelfUploads() === 120) continue;
      const oldest = await prisma.shelfFrame.findFirst({ where: { sessionId: { not: null } },
        orderBy: { uploadedAt: "asc" }, select: { uploadedAt: true } });
      if (oldest) wait = Math.max(0, Math.min(wait, oldest.uploadedAt.getTime() + lifetime - Date.now()));
    } catch { console.warn("Shelf retention will retry."); }
    await sleep(wait, undefined, { signal, ref: false }).catch(() => undefined);
  }
}
