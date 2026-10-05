import { TRPCError } from "@trpc/server";
import type { StaffUser } from "@prisma/client";
import { prisma } from "../db.js";
import { hashPassword, verifyPassword } from "./password.js";
import { LOCKOUT_MINUTES, MAX_LOGIN_ATTEMPTS, MAX_MFA_ATTEMPTS } from "../config.js";

/**
 * Per-account attempt counting and temporary lockout.
 *
 * Durable, unlike the per-IP limiter: an attacker rotating addresses still
 * runs into the account's own counter. Lockout is temporary rather than
 * permanent on purpose — a locked-out operator mid-shift is an outage, and
 * permanent locks get disabled by whoever is on call at 2am.
 */

export const LOCKED_OUT = "Too many attempts. Try again shortly.";

/**
 * A correctly-formed hash of a random value, verified against when the
 * account does not exist so the reply takes the same time either way.
 *
 * It must be in the *current* format: a malformed one short-circuits before
 * scrypt runs, which turns the endpoint back into the enumeration oracle this
 * exists to close. Built once, lazily, at the cost of one real hash.
 */
let dummyHash: Promise<string> | null = null;
export function decoyHash(): Promise<string> {
  dummyHash ??= hashPassword(`decoy:${Math.random()}`);
  return dummyHash;
}

export function isLockedOut(user: Pick<StaffUser, "lockedUntil">): boolean {
  return Boolean(user.lockedUntil && user.lockedUntil.getTime() > Date.now());
}

/** Counts a failure and locks the account once the ceiling is reached. */
export async function recordFailure(
  userId: string,
  kind: "password" | "mfa",
  current: { failedLoginAttempts: number; failedMfaAttempts: number },
): Promise<void> {
  const next =
    kind === "password" ? current.failedLoginAttempts + 1 : current.failedMfaAttempts + 1;
  const ceiling = kind === "password" ? MAX_LOGIN_ATTEMPTS : MAX_MFA_ATTEMPTS;

  await prisma.staffUser.update({
    where: { id: userId },
    data: {
      ...(kind === "password" ? { failedLoginAttempts: next } : { failedMfaAttempts: next }),
      ...(next >= ceiling ? { lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60_000) } : {}),
    },
  });
}

/** Clears both counters and any lock. Called only on a fully successful step. */
export async function recordSuccess(userId: string): Promise<void> {
  await prisma.staffUser.update({
    where: { id: userId },
    data: { failedLoginAttempts: 0, failedMfaAttempts: 0, lockedUntil: null },
  });
}

/**
 * Verifies a password and, if the stored hash predates the current cost,
 * transparently upgrades it. Raising SCRYPT_N therefore strengthens accounts
 * as people sign in, rather than requiring a reset for everyone.
 */
export async function verifyAndMaybeRehash(plain: string, user: StaffUser): Promise<boolean> {
  const ok = await verifyPassword(plain, user.passwordHash);
  if (!ok) return false;
  const { needsRehash } = await import("./password.js");
  if (needsRehash(user.passwordHash)) {
    await prisma.staffUser.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(plain) } });
  }
  return true;
}

export function lockedOutError(): TRPCError {
  return new TRPCError({ code: "TOO_MANY_REQUESTS", message: LOCKED_OUT });
}
