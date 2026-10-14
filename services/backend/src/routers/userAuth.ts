import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { prisma } from "../db.js";
import { buyerProcedure, publicProcedure, router } from "../trpc.js";
import { tooManyFromIp } from "../auth/rateLimit.js";
import { consumeSignInCode, normaliseEmail, normalisePhone, requestSignInCode } from "../auth/signInCodes.js";
import { issueUserSession, revokeUserSession } from "../auth/userSession.js";

/**
 * Sign-in for buyers and for store owners. These are the only buyer-facing and
 * merchant-facing routes that do not need a session, since they are what makes
 * one: ask for a code, then trade the code for a session token.
 *
 * Buyers use email. There is no password to forget or leak, and an address that
 * has never signed in simply becomes an account on its first code. Store owners
 * use the mobile number on file for their shop: no one can create a store by
 * texting a number, so an unknown number is told the same thing as a known one
 * and nothing is sent. Each answer is identical either way, so neither route
 * says who has an account.
 */

const TOO_MANY = "Too many tries. Please wait a little while and try again.";

const throttle = (key: string, ip: string | undefined) => {
  if (tooManyFromIp(`${key}:${ip ?? "unknown"}`)) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: TOO_MANY });
};

const code = z.string().trim().regex(/^\d{6}$/, "Enter the six-digit code.");

export const userAuthRouter = router({
  /** Email a sign-in code to a buyer. */
  requestBuyerCode: publicProcedure.input(z.object({ email: z.string() })).mutation(async ({ input, ctx }) => {
    throttle("code", ctx.ip);
    const identifier = normaliseEmail(input.email);
    if (!identifier) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter a valid email address." });
    await requestSignInCode({ kind: "buyer", identifier });
    return { sent: true as const };
  }),

  /** Trade a buyer's code for a session. The first code for an address creates the account. */
  verifyBuyerCode: publicProcedure.input(z.object({ email: z.string(), code })).mutation(async ({ input, ctx }) => {
    throttle("verify", ctx.ip);
    const identifier = normaliseEmail(input.email);
    if (!identifier) throw new TRPCError({ code: "UNAUTHORIZED", message: "That code didn't work. Check it and try again, or ask for a new one." });
    await consumeSignInCode({ kind: "buyer", identifier, code: input.code });
    const buyer = await prisma.buyer.upsert({ where: { email: identifier }, create: { email: identifier }, update: {} });
    const session = await issueUserSession({ kind: "buyer", buyerId: buyer.id }, { ip: ctx.ip, userAgent: ctx.userAgent });
    return { token: session.token, expiresAt: session.expiresAt };
  }),

  /** Text a sign-in code to the number on file for a shop. */
  requestStoreCode: publicProcedure.input(z.object({ phone: z.string() })).mutation(async ({ input, ctx }) => {
    throttle("code", ctx.ip);
    const identifier = normalisePhone(input.phone);
    if (!identifier) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter your mobile number, with the area code." });
    await requestSignInCode({ kind: "store", identifier });
    return { sent: true as const };
  }),

  /** Trade a store owner's code for a session. Only a store with that number on file can have one. */
  verifyStoreCode: publicProcedure.input(z.object({ phone: z.string(), code })).mutation(async ({ input, ctx }) => {
    throttle("verify", ctx.ip);
    const identifier = normalisePhone(input.phone);
    const wrong = new TRPCError({ code: "UNAUTHORIZED", message: "That code didn't work. Check it and try again, or ask for a new one." });
    if (!identifier) throw wrong;
    await consumeSignInCode({ kind: "store", identifier, code: input.code });
    const store = await prisma.store.findUnique({ where: { ownerPhone: identifier }, select: { id: true } });
    // A code only exists for a number that had a store when it was texted, but the
    // store could have been removed since; the answer is the same as any wrong code.
    if (!store) throw wrong;
    const session = await issueUserSession({ kind: "store", storeId: store.id }, { ip: ctx.ip, userAgent: ctx.userAgent });
    return { token: session.token, expiresAt: session.expiresAt };
  }),

  /** Who the signed-in buyer is. UNAUTHORIZED is how the app learns it has to ask them to sign in. */
  buyerMe: buyerProcedure.query(async ({ ctx }) => {
    const buyer = await prisma.buyer.findUniqueOrThrow({ where: { id: ctx.buyerId }, select: { email: true } });
    return { email: buyer.email };
  }),

  /** End the session this request is signed in with. Harmless when there is none. */
  signOut: publicProcedure.mutation(async ({ ctx }) => {
    const header = ctx.req.headers.authorization;
    const token = typeof header === "string" && header.toLowerCase().startsWith("bearer ") ? header.slice(7) : null;
    if (ctx.user && token) await revokeUserSession(token);
    return { signedOut: true as const };
  }),
});
