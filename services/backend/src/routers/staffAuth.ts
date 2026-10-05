import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { generateSecret, generateURI, verifySync } from "otplib";
import { prisma } from "../db.js";
import { router, staffAuthProcedure, staffProcedure } from "../trpc.js";
import { verifyPassword } from "../auth/password.js";
import { issueSession, markMfaVerified, revokeSession, resolveSession } from "../auth/session.js";
import { permissionsFor } from "../auth/permissions.js";

/**
 * The staff sign-in handshake. These are the only ops endpoints that do not
 * require a session, because they are what creates one.
 *
 * Two steps on purpose: password establishes a session, TOTP unlocks it. A
 * session that has not cleared its second factor can reach nothing — every
 * other ops route checks `mfaVerified` — so a stolen password alone buys an
 * attacker a token that does nothing.
 */

/** Same message either way: never reveal whether an address has an account. */

/**
 * TOTP check with a one-step tolerance either side. Authenticator apps and
 * servers drift by a few seconds, and an operator retyping a code because the
 * clock disagreed is how MFA gets disabled "temporarily".
 */
function totpValid(code: string, secret: string): boolean {
  return verifySync({ token: code.trim(), secret, epochTolerance: 30 }).valid;
}
const BAD_CREDENTIALS = "Those details don't match an account.";

export const staffAuthRouter = router({
  signIn: staffAuthProcedure
    .input(z.object({ email: z.string().email(), password: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const user = await prisma.staffUser.findUnique({ where: { email: input.email.toLowerCase() } });

      // Verify against a dummy hash when the account is unknown so the reply
      // takes the same time either way; skipping the work on a miss turns the
      // endpoint into an account-enumeration oracle.
      const stored = user?.passwordHash ?? "00:" + "0".repeat(128);
      const ok = await verifyPassword(input.password, stored);

      if (!user || !ok || user.disabledAt) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: BAD_CREDENTIALS });
      }

      const session = await issueSession(user.id, { ip: ctx.ip, userAgent: ctx.userAgent });
      await prisma.staffUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

      return {
        token: session.token,
        expiresAt: session.expiresAt,
        mfaEnrolled: Boolean(user.mfaSecret),
        /** Nothing is reachable until this is true. */
        mfaVerified: false,
        name: user.name,
        role: user.role,
      };
    }),

  /** Second factor. Required before any ops route will answer. */
  verifyMfa: staffAuthProcedure
    .input(z.object({ token: z.string().min(1), code: z.string().min(6).max(8) }))
    .mutation(async ({ input }) => {
      const session = await resolveSession(input.token);
      if (!session) throw new TRPCError({ code: "UNAUTHORIZED", message: "That session has expired." });

      const user = await prisma.staffUser.findUnique({ where: { id: session.staffUserId } });
      if (!user?.mfaSecret) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No authenticator is enrolled for this account." });
      }
      if (!totpValid(input.code, user.mfaSecret)) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "That code isn't right. Try the next one." });
      }

      await markMfaVerified(input.token);
      return { role: user.role, name: user.name, permissions: permissionsFor(user.role) };
    }),

  /**
   * Enrolment. Returns the secret once so it can be shown as a QR code; it is
   * never readable again through the API.
   */
  beginMfaEnrolment: staffAuthProcedure
    .input(z.object({ token: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const session = await resolveSession(input.token);
      if (!session) throw new TRPCError({ code: "UNAUTHORIZED", message: "That session has expired." });
      if (session.mfaEnrolled) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "An authenticator is already enrolled." });
      }
      const secret = generateSecret();
      await prisma.staffUser.update({ where: { id: session.staffUserId }, data: { mfaSecret: secret } });
      return {
        secret,
        otpauthUrl: generateURI({ issuer: "AfriMart Operations", label: session.email, secret }),
      };
    }),

  confirmMfaEnrolment: staffAuthProcedure
    .input(z.object({ token: z.string().min(1), code: z.string().min(6).max(8) }))
    .mutation(async ({ input }) => {
      const session = await resolveSession(input.token);
      if (!session) throw new TRPCError({ code: "UNAUTHORIZED", message: "That session has expired." });
      const user = await prisma.staffUser.findUnique({ where: { id: session.staffUserId } });
      if (!user?.mfaSecret) throw new TRPCError({ code: "BAD_REQUEST", message: "Start enrolment first." });
      if (!totpValid(input.code, user.mfaSecret)) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "That code isn't right." });
      }
      await prisma.staffUser.update({ where: { id: user.id }, data: { mfaEnrolledAt: new Date() } });
      await markMfaVerified(input.token);
      return { enrolled: true };
    }),

  signOut: staffAuthProcedure.input(z.object({ token: z.string() })).mutation(async ({ input }) => {
    await revokeSession(input.token);
    return { signedOut: true };
  }),

  /** Who the console is talking to, and what its tabs should offer. */
  me: staffProcedure("console:access").query(({ ctx }) => ({
    email: ctx.staff.email,
    name: ctx.staff.name,
    role: ctx.staff.role,
    permissions: permissionsFor(ctx.staff.role),
  })),
});
