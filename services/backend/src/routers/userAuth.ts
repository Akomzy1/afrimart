import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { UserKind } from "@prisma/client";
import { prisma } from "../db.js";
import { buyerProcedure, merchantProcedure, publicProcedure, router, type Context } from "../trpc.js";
import { tooManyFromIp } from "../auth/rateLimit.js";
import { consumeSignInCode, normaliseEmail, normalisePhone, requestSignInCode } from "../auth/signInCodes.js";
import { issueUserSession, revokeAllForUser, revokeSessionById } from "../auth/userSession.js";
import { clearSessionCookie, setSessionCookie } from "../auth/cookies.js";
import { signInVerifiedStore } from "../auth/storeSignIn.js";

/**
 * Sign-in for buyers and for store owners. These are the only buyer-facing and
 * merchant-facing routes that do not need a session, since they are what makes
 * one: ask for a code, then trade the code for a session.
 *
 * The session is handed back as an httpOnly cookie and never in the response
 * body, so no script on the page ever holds it. Signing out removes the cookie
 * and ends the session on the server.
 *
 * Buyers use email. There is no password to forget or leak, and an address that
 * has never signed in becomes an account on its first code. Store owners use
 * the mobile number on file for their shop: no one can create a store by
 * texting a number, so an unknown number is told the same thing as a known one
 * and nothing is sent. Each answer is identical either way, so neither route
 * says who has an account.
 */

const TOO_MANY = "Too many tries. Please wait a little while and try again.";

const throttle = (key: string, ip: string | undefined) => {
  if (tooManyFromIp(`${key}:${ip ?? "unknown"}`)) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: TOO_MANY });
};

const code = z.string().trim().regex(/^\d{6}$/, "Enter the six-digit code.");

/** Put a session cookie on this response. Appends: a response can carry several. */
function sendCookie(ctx: Context, value: string) {
  ctx.res.header("set-cookie", value);
}

async function startSession(
  ctx: Context,
  who: { kind: "buyer"; buyerId: string } | { kind: "store"; storeId: string },
): Promise<{ expiresAt: Date }> {
  const session = await issueUserSession(who, { ip: ctx.ip, userAgent: ctx.userAgent });
  sendCookie(ctx, setSessionCookie(who.kind, session.token, session.expiresAt));
  return { expiresAt: session.expiresAt };
}

/** End this request's session of one kind, if it has one, and remove the cookie either way. */
async function endSession(ctx: Context, kind: UserKind) {
  const session = ctx.sessions[kind];
  if (session) await revokeSessionById(session.sessionId);
  sendCookie(ctx, clearSessionCookie(kind));
}

export const userAuthRouter = router({
  /** Email a sign-in code to a buyer. */
  requestBuyerCode: publicProcedure.input(z.object({ email: z.string() })).mutation(async ({ input, ctx }) => {
    throttle("code", ctx.ip);
    const identifier = normaliseEmail(input.email);
    if (!identifier) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter a valid email address." });
    await requestSignInCode({ kind: "buyer", identifier });
    return { sent: true as const };
  }),

  /** Trade a buyer's code for a session cookie. The first code for an address creates the account. */
  verifyBuyerCode: publicProcedure.input(z.object({ email: z.string(), code })).mutation(async ({ input, ctx }) => {
    throttle("verify", ctx.ip);
    const identifier = normaliseEmail(input.email);
    if (!identifier) throw new TRPCError({ code: "UNAUTHORIZED", message: "That code didn't work. Check it and try again, or ask for a new one." });
    await consumeSignInCode({ kind: "buyer", identifier, code: input.code });
    const buyer = await prisma.buyer.upsert({ where: { email: identifier }, create: { email: identifier }, update: {} });
    return startSession(ctx, { kind: "buyer", buyerId: buyer.id });
  }),

  /** Text a sign-in code to the number on file for a shop. */
  requestStoreCode: publicProcedure.input(z.object({ phone: z.string() })).mutation(async ({ input, ctx }) => {
    throttle("code", ctx.ip);
    const identifier = normalisePhone(input.phone);
    if (!identifier) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter your mobile number, with the area code." });
    await requestSignInCode({ kind: "store", identifier });
    return { sent: true as const };
  }),

  /** Trade a store owner's code for a session cookie. Only a store with that number on file can have one. */
  verifyStoreCode: publicProcedure.input(z.object({ phone: z.string(), code })).mutation(async ({ input, ctx }) => {
    throttle("verify", ctx.ip);
    const identifier = normalisePhone(input.phone);
    const wrong = new TRPCError({ code: "UNAUTHORIZED", message: "That code didn't work. Check it and try again, or ask for a new one." });
    if (!identifier) throw wrong;
    const proof = await consumeSignInCode({ kind: "store", identifier, code: input.code });
    const session = await signInVerifiedStore(identifier, proof, false, { ip: ctx.ip, userAgent: ctx.userAgent });
    sendCookie(ctx, setSessionCookie("store", session.token, session.expiresAt));
    return { expiresAt: session.expiresAt };
  }),

  requestOnboardingCode: publicProcedure.input(z.object({ phone: z.string().max(40) })).mutation(async ({ input, ctx }) => {
    throttle("code", ctx.ip);
    // Apply the tighter ceiling to every onboarding request so its response
    // cannot disclose whether a number already belongs to a store.
    if (tooManyFromIp(`onboarding:${ctx.ip ?? "unknown"}`, 5)) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: TOO_MANY });
    const identifier = normalisePhone(input.phone);
    if (!identifier) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter your mobile number, with the area code." });
    await requestSignInCode({ kind: "store", identifier, purpose: "store_onboarding" });
    return { sent: true as const };
  }),

  verifyOnboardingCode: publicProcedure.input(z.object({ phone: z.string().max(40), code })).mutation(async ({ input, ctx }) => {
    throttle("verify", ctx.ip);
    const identifier = normalisePhone(input.phone);
    if (!identifier) throw new TRPCError({ code: "UNAUTHORIZED", message: "That code didn't work. Check it and try again, or ask for a new one." });
    const proof = await consumeSignInCode({ kind: "store", identifier, code: input.code, purpose: "store_onboarding" });
    const session = await signInVerifiedStore(identifier, proof, true, { ip: ctx.ip, userAgent: ctx.userAgent });
    sendCookie(ctx, setSessionCookie("store", session.token, session.expiresAt));
    return { expiresAt: session.expiresAt };
  }),

  /** Who the signed-in buyer is. UNAUTHORIZED is how the app learns it has to ask them to sign in. */
  buyerMe: buyerProcedure.query(async ({ ctx }) => {
    const buyer = await prisma.buyer.findUniqueOrThrow({ where: { id: ctx.buyerId }, select: { email: true } });
    return { email: buyer.email };
  }),

  /** Sign the buyer out of this browser. Harmless when they are not signed in. */
  signOutBuyer: publicProcedure.mutation(async ({ ctx }) => {
    await endSession(ctx, "buyer");
    return { signedOut: true as const };
  }),

  /** Sign the shop out of this device. Harmless when it is not signed in. */
  signOutStore: publicProcedure.mutation(async ({ ctx }) => {
    await endSession(ctx, "store");
    return { signedOut: true as const };
  }),

  /**
   * Sign the shop out of every device it is signed in on, this one included:
   * for a lost or lent phone. Needs a live session, so it is only ever the
   * shop's own doing, and it ends all of that shop's sessions and no other's.
   */
  signOutStoreEverywhere: merchantProcedure.mutation(async ({ ctx }) => {
    const ended = await revokeAllForUser({ storeId: ctx.storeId });
    sendCookie(ctx, clearSessionCookie("store"));
    return { signedOut: true as const, sessionsEnded: ended };
  }),
});
