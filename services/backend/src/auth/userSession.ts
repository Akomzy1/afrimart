import { createHash, randomBytes } from "node:crypto";
import type { UserKind, Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { USER_SESSION_ABSOLUTE_DAYS, USER_SESSION_IDLE_DAYS } from "../config.js";

/**
 * Buyer and store sessions.
 *
 * The same design as a staff session: an opaque random token, only its SHA-256
 * stored, revocable, with an idle clock that slides and an absolute cap that
 * does not. What differs is the length of the clocks (see config.ts) and that
 * there is no second factor: the texted or emailed code was the proof.
 *
 * `resolveUserSession` is the only way a request becomes "this buyer" or "this
 * store". Nothing the client sends other than the token is believed.
 */

export interface IssuedUserSession {
  token: string;
  expiresAt: Date;
}

export interface ResolvedUser {
  sessionId: string;
  kind: UserKind;
  buyerId: string | null;
  storeId: string | null;
}

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

export async function issueUserSession(
  who: { kind: "buyer"; buyerId: string } | { kind: "store"; storeId: string },
  meta: { ip?: string; userAgent?: string } = {},
  db: Prisma.TransactionClient = prisma,
): Promise<IssuedUserSession> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + USER_SESSION_ABSOLUTE_DAYS * 86_400_000);
  await db.userSession.create({
    data: {
      kind: who.kind,
      buyerId: who.kind === "buyer" ? who.buyerId : null,
      storeId: who.kind === "store" ? who.storeId : null,
      tokenHash: sha256(token),
      expiresAt,
      ip: meta.ip,
      userAgent: meta.userAgent?.slice(0, 300),
    },
  });
  return { token, expiresAt };
}

/**
 * Null for anything not currently usable: unknown, revoked, past its absolute
 * cap, or idle too long. Callers treat null as "not signed in", never as
 * "signed in with no permissions".
 */
export async function resolveUserSession(token: string | null): Promise<ResolvedUser | null> {
  if (!token) return null;
  const session = await prisma.userSession.findUnique({ where: { tokenHash: sha256(token) }, include: { store: { select: { ownerPhoneVerifiedAt: true } } } });
  if (!session || session.revokedAt) return null;
  if (session.kind === "store" && !session.store?.ownerPhoneVerifiedAt) return null;

  const now = Date.now();
  if (session.expiresAt.getTime() <= now) return null;
  if (now - session.lastSeenAt.getTime() > USER_SESSION_IDLE_DAYS * 86_400_000) {
    await prisma.userSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    return null;
  }

  // Sliding the idle clock on every request would be a write per call; once a
  // minute is as good for a clock measured in days.
  if (now - session.lastSeenAt.getTime() > 60_000) {
    await prisma.userSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  }
  return { sessionId: session.id, kind: session.kind, buyerId: session.buyerId, storeId: session.storeId };
}

export async function revokeUserSession(token: string): Promise<void> {
  await prisma.userSession
    .update({ where: { tokenHash: sha256(token) }, data: { revokedAt: new Date() } })
    .catch(() => undefined);
}

/** Every live session of one buyer or store: lost phone, shared computer, closed account. */
export async function revokeAllForUser(who: { buyerId: string } | { storeId: string }): Promise<number> {
  const result = await prisma.userSession.updateMany({
    where: { ...who, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

/** End one session by its id, for a request that knows its session but not its token (it came in a cookie). */
export async function revokeSessionById(sessionId: string): Promise<void> {
  await prisma.userSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
}
