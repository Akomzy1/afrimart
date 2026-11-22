import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { prisma } from "../db.js";
import { merchantProcedure, router } from "../trpc.js";
import { decodeUpload, PhotoRejected } from "../storage/photos.js";
import { photoStore } from "../storage/store.js";
import { signedPhotoUrl } from "../storage/access.js";

const eligible = {
  ownerPhoneVerifiedAt: { not: null }, onboardingProfileAt: { not: null },
  onboardingRail: "film", onboardingStatus: "filming",
} as const;
const forbidden = () => new TRPCError({ code: "FORBIDDEN", message: "Choose shelf filming in store setup to use the camera." });
const conflict = () => new TRPCError({ code: "CONFLICT", message: "This capture changed on another screen. Open your saved shelves again." });
const maxFrames = 60;

async function lockStore(tx: Prisma.TransactionClient, storeId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Store" WHERE "id" = ${storeId} FOR UPDATE`;
  if (!await tx.store.count({ where: { id: storeId, ...eligible } })) throw forbidden();
}

/** Detached rows cover interrupted uploads, replaced frames and deleted stores.
 * The upload lease prevents cleanup during an active save. A live frame never expires here. */
export async function cleanShelfUploads() {
  const orphaned = await prisma.shelfFrame.findMany({ where: { sessionId: null,
    OR: [{ deleteAfter: null }, { deleteAfter: { lte: new Date() } }] }, take: 120, select: { name: true } });
  for (const { name } of orphaned) {
    await photoStore.removeShelfFrame(name);
    await prisma.shelfFrame.deleteMany({ where: { name, sessionId: null } });
  }
}

export const shelfCaptureRouter = router({
  session: merchantProcedure.query(async ({ ctx }) => {
    const store = await prisma.store.findFirst({ where: { id: ctx.storeId, ...eligible }, select: { filmSession: {
      select: { revision: true, finishedAt: true, frames: { orderBy: [{ shelf: "asc" }, { position: "asc" }],
        select: { shelf: true, name: true } } }
    } } });
    if (!store) throw forbidden();
    const session = store.filmSession;
    const shelves: { number: number; count: number; preview: string | null }[] = [];
    for (const frame of session?.frames ?? []) {
      const last = shelves.at(-1);
      if (last?.number === frame.shelf) last.count++;
      else shelves.push({ number: frame.shelf, count: 1, preview: signedPhotoUrl(`/photos/shelf/${frame.name}`) });
    }
    return { revision: session?.revision ?? 0, finished: Boolean(session?.finishedAt), shelves };
  }),

  saveShelf: merchantProcedure.input(z.object({
    revision: z.number().int().nonnegative(), shelf: z.number().int().min(1).max(maxFrames),
    passId: z.string().uuid(), frames: z.array(z.string().min(1).max(10_000_000)).min(1).max(maxFrames),
  })).mutation(async ({ ctx, input }) => {
    const where = { id: ctx.storeId, ...eligible };
    const store = await prisma.store.findFirst({ where, select: { filmSession: { select: { revision: true, finishedAt: true,
      frames: { select: { shelf: true, passId: true } } } } } });
    if (!store) throw forbidden();
    const session = store.filmSession;
    if (session?.frames.some(f => f.shelf === input.shelf && f.passId === input.passId)) return { saved: true };
    if (session?.finishedAt || (session?.revision ?? 0) !== input.revision) throw conflict();
    const frames = session?.frames ?? [];
    const nextShelf = Math.max(0, ...frames.map(f => f.shelf)) + 1;
    if (input.shelf > nextShelf || frames.filter(f => f.shelf !== input.shelf).length + input.frames.length > maxFrames)
      throw new TRPCError({ code: "BAD_REQUEST", message: "A capture can hold up to 60 frames across consecutive shelves." });
    if (input.frames.reduce((size, frame) => size + frame.length, 0) > 10_000_000)
      throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "Film a shorter section of the shelf." });

    // Allocate independent object names before touching storage. Only a fully
    // written pass can replace the current shelf, even after a lost response.
    const names = input.frames.map(() => randomBytes(16).toString("hex") + ".jpg");
    const deleteAfter = new Date(Date.now() + 3_600_000);
    await prisma.shelfFrame.createMany({ data: names.map((name, position) => ({
      name, position, shelf: input.shelf, passId: input.passId, deleteAfter,
    })) });
    try {
      for (const [i, frame] of input.frames.entries()) {
        await photoStore.put("shelf", decodeUpload(frame), names[i]);
      }
      await prisma.$transaction(async tx => {
        await lockStore(tx, ctx.storeId);
        const film = await tx.filmSession.upsert({ where: { storeId: ctx.storeId }, create: { storeId: ctx.storeId }, update: {} });
        if (film.finishedAt || film.revision !== input.revision) {
          if (await tx.shelfFrame.count({ where: { sessionId: film.id, shelf: input.shelf, passId: input.passId } })) return;
          throw conflict();
        }
        await tx.shelfFrame.updateMany({ where: { sessionId: film.id, shelf: input.shelf }, data: { sessionId: null, deleteAfter: new Date() } });
        const added = await tx.shelfFrame.updateMany({ where: { name: { in: names }, sessionId: null, deleteAfter: { gt: new Date() } },
          data: { sessionId: film.id, deleteAfter: null } });
        if (added.count !== names.length) throw conflict();
        await tx.filmSession.update({ where: { id: film.id }, data: { revision: { increment: 1 } } });
      });
    } catch (error) {
      if (error instanceof PhotoRejected) throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
      throw error;
    } finally {
      // Never remove an attached frame if the commit succeeded but its acknowledgement was lost.
      await prisma.shelfFrame.updateMany({ where: { name: { in: names }, sessionId: null }, data: { deleteAfter: new Date() } });
      await cleanShelfUploads().catch(() => console.warn("Shelf photo cleanup will retry."));
    }
    return { saved: true };
  }),

  finish: merchantProcedure.input(z.object({ revision: z.number().int().nonnegative() })).mutation(async ({ ctx, input }) =>
    prisma.$transaction(async tx => {
      await lockStore(tx, ctx.storeId);
      const session = await tx.filmSession.findUnique({ where: { storeId: ctx.storeId } });
      if (!session) throw new TRPCError({ code: "BAD_REQUEST", message: "Save at least one shelf first." });
      if (!session.finishedAt) {
        if (session.revision !== input.revision) throw conflict();
        await tx.filmSession.update({ where: { id: session.id }, data: { finishedAt: new Date(), revision: { increment: 1 } } });
      }
      await tx.extractionJob.upsert({ where: { sessionId: session.id }, create: { sessionId: session.id }, update: {} });
      return { finished: true };
    })),
});
