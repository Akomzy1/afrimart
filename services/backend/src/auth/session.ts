import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../db.js";
import { SESSION_ABSOLUTE_HOURS, SESSION_IDLE_MINUTES } from "../config.js";

/**
 * Staff sessions.
 *
 * Opaque random tokens held server-side rather than signed stateless ones, so
 * a session can actually be revoked — an operator losing a laptop mid-shift
 * needs their access gone now, not at the next expiry. Only the SHA-256 of the
 * token is stored, so a database leak does not hand over live sessions.
 *
 * Two clocks, both enforced on every request: an idle timeout that slides with
 * use, and an absolute cap that does not.
 */

export interface IssuedSession {
  token: string;
  expiresAt: Date;
}

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

export async function issueSession(
  staffUserId: string,
  meta: { ip?: string; userAgent?: string } = {},
): Promise<IssuedSession> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_ABSOLUTE_HOURS * 3600_000);
  await prisma.staffSession.create({
    data: { staffUserId, tokenHash: sha256(token), expiresAt, ip: meta.ip, userAgent: meta.userAgent },
  });
  return { token, expiresAt };
}

/** Marks the second factor satisfied for this session only. */
export async function markMfaVerified(token: string): Promise<void> {
  await prisma.staffSession.update({
    where: { tokenHash: sha256(token) },
    data: { mfaVerifiedAt: new Date() },
  });
}

export interface ResolvedSession {
  sessionId: string;
  staffUserId: string;
  email: string;
  name: string;
  role: import("@prisma/client").StaffRole;
  mfaVerified: boolean;
  mfaEnrolled: boolean;
}

/**
 * Returns null for anything not currently usable — unknown, revoked, expired,
 * idle too long, or belonging to a disabled account. Callers treat null as
 * "not signed in" and never as "signed in with no permissions".
 */
export async function resolveSession(token: string | null): Promise<ResolvedSession | null> {
  if (!token) return null;

  const session = await prisma.staffSession.findUnique({
    where: { tokenHash: sha256(token) },
    include: { staffUser: true },
  });
  if (!session || session.revokedAt) return null;

  const now = Date.now();
  if (session.expiresAt.getTime() <= now) return null;
  if (now - session.lastSeenAt.getTime() > SESSION_IDLE_MINUTES * 60_000) {
    // Idle out rather than silently extending: an abandoned console should
    // stop working on its own.
    await prisma.staffSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    return null;
  }
  if (session.staffUser.disabledAt) return null;

  await prisma.staffSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });

  return {
    sessionId: session.id,
    staffUserId: session.staffUserId,
    email: session.staffUser.email,
    name: session.staffUser.name,
    role: session.staffUser.role,
    mfaVerified: Boolean(session.mfaVerifiedAt),
    mfaEnrolled: Boolean(session.staffUser.mfaSecret),
  };
}

export async function revokeSession(token: string): Promise<void> {
  await prisma.staffSession
    .update({ where: { tokenHash: sha256(token) }, data: { revokedAt: new Date() } })
    .catch(() => undefined);
}

/** Used when an account is disabled or its password changes. */
export async function revokeAllForUser(staffUserId: string): Promise<void> {
  await prisma.staffSession.updateMany({
    where: { staffUserId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
