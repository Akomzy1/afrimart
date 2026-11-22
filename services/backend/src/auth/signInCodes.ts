import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { UserKind } from "@prisma/client";
import { prisma } from "../db.js";
import { isDevelopment } from "../runtime.js";
import { getSenders } from "../notifications/senders.js";
import {
  SIGN_IN_CODES_PER_HOUR,
  SIGN_IN_CODE_MAX_GUESSES,
  SIGN_IN_CODE_MINUTES,
  SIGN_IN_CODE_RESEND_SECONDS,
} from "../config.js";

/**
 * One-time sign-in codes for buyers (emailed) and store owners (texted).
 *
 * What this is built to resist:
 *   - Guessing. Six digits, a handful of tries, then the code is burned and a
 *     new one has to be asked for, which is itself paced. Guesses are counted
 *     with an atomic increment, so firing many in parallel does not get more
 *     tries than one at a time.
 *   - Replay. A code is consumed by the single update that accepts it; two
 *     simultaneous correct submissions cannot both succeed.
 *   - Enumeration. Asking for a code answers the same whether or not the buyer
 *     or store exists, and the pacing applies to the address either way, so
 *     neither the reply nor the rate-limit message says who has an account.
 *   - Flooding someone. A code cannot be requested again for a short while, and
 *     only a few an hour per address.
 *   - A database leak. Only a salted hash of the code is stored, and the code
 *     expires in minutes anyway.
 */

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
const hashCode = (salt: string, code: string) => sha256(`${salt}:${code}`);

export function normaliseEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  // Deliberately loose: the only real test of an address is that it receives the code.
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254 ? email : null;
}

/** A US number in any common form, or an international one with its +, as E.164. */
export function normalisePhone(raw: string): string | null {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

const WRONG = "That code didn't work. Check it and try again, or ask for a new one.";

/**
 * Can a code actually be delivered from here? A development machine writes it
 * to a file; anywhere else it needs a real provider, and saying so up front is
 * better than telling someone a code is on its way when nothing will arrive.
 */
function canDeliver(kind: UserKind): boolean {
  const { email, sms } = getSenders();
  return kind === "buyer" ? email.name !== "file" || isDevelopment() : sms.enabled;
}

export type CodePurpose = "sign_in" | "store_onboarding";

export async function requestSignInCode(input: { kind: UserKind; identifier: string; purpose?: CodePurpose }): Promise<void> {
  const { kind, identifier, purpose = "sign_in" } = input;
  if (purpose === "store_onboarding" && kind !== "store") throw new Error("Onboarding codes are for stores only.");

  if (!canDeliver(kind)) {
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "We can't send sign-in codes right now. Please try again later.",
    });
  }

  const delivery = await prisma.$transaction(async (tx) => {
    // Serialize requests across both purposes and all backend instances. Otherwise
    // parallel requests could each pass the resend check and send multiple codes.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`auth-code:${kind}:${identifier}`}))`;
    const now = Date.now();
    const recent = await tx.authCode.findMany({
      where: { kind, identifier, createdAt: { gte: new Date(now - 3600_000) } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (recent.length >= SIGN_IN_CODES_PER_HOUR) {
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many codes asked for. Please try again in a little while." });
    }
    if (recent[0] && now - recent[0].createdAt.getTime() < SIGN_IN_CODE_RESEND_SECONDS * 1000) {
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "A code was just sent. Please wait a moment before asking for another." });
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const salt = randomBytes(12).toString("hex");
    const store = kind === "store"
      ? await tx.store.findUnique({ where: { ownerPhone: identifier }, select: { id: true, ownerPhoneVersion: true } })
      : null;

    // Asking again replaces the earlier code rather than leaving two live.
    await tx.authCode.updateMany({ where: { kind, identifier, consumedAt: null }, data: { consumedAt: new Date() } });
    await tx.authCode.create({
      data: { kind, identifier, purpose, storeIdAtIssue: store?.id, storePhoneVersion: store?.ownerPhoneVersion,
        salt, codeHash: hashCode(salt, code), expiresAt: new Date(now + SIGN_IN_CODE_MINUTES * 60_000) },
    });
    return { code, deliver: kind === "buyer" || Boolean(store) || purpose === "store_onboarding" };
  });
  const { code } = delivery;
  if (!delivery.deliver) return;

  // Only deliver to someone who can use it. A buyer address is always fine (the
  // account is made on first sign-in). Ordinary store sign-in needs a phone on
  // file; onboarding also accepts new numbers. Both share the same pacing.
  if (kind === "store") {
    await getSenders().sms.send({
      to: identifier,
      body: `Your AfriMart code is ${code}. It works for ${SIGN_IN_CODE_MINUTES} minutes. If you didn't ask for it, ignore this message.`,
    });
  } else {
    await getSenders().email.send({
      to: identifier,
      subject: "Your AfriMart sign-in code",
      html: signInEmail(code),
    });
  }
}

/**
 * Checks and consumes a code, returning its store/phone binding so the caller
 * can safely resolve the owner. Every failure uses the same message.
 */
export async function consumeSignInCode(input: { kind: UserKind; identifier: string; code: string; purpose?: CodePurpose }) {
  const { kind, identifier, purpose = "sign_in" } = input;
  const live = await prisma.authCode.findFirst({
    where: { kind, identifier, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!live) throw new TRPCError({ code: "UNAUTHORIZED", message: WRONG });

  // Count the guess first, and atomically: parallel guesses each take a number.
  const counted = await prisma.authCode.update({ where: { id: live.id }, data: { attempts: { increment: 1 } } });
  if (counted.attempts > SIGN_IN_CODE_MAX_GUESSES) {
    await prisma.authCode.updateMany({ where: { id: live.id, consumedAt: null }, data: { consumedAt: new Date() } });
    throw new TRPCError({ code: "UNAUTHORIZED", message: WRONG });
  }

  const given = Buffer.from(hashCode(live.salt, input.code), "hex");
  const stored = Buffer.from(live.codeHash, "hex");
  if (given.length !== stored.length || !timingSafeEqual(given, stored)) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: WRONG });
  }

  // The update that accepts the code is the one that spends it.
  const spent = await prisma.authCode.updateMany({ where: { id: live.id, consumedAt: null }, data: { consumedAt: new Date() } });
  if (spent.count !== 1) throw new TRPCError({ code: "UNAUTHORIZED", message: WRONG });
  return { storeIdAtIssue: live.storeIdAtIssue, storePhoneVersion: live.storePhoneVersion };
}

function signInEmail(code: string): string {
  return `<!doctype html><html><body style="margin:0;background:#FAF5EE;font-family:Georgia,serif;color:#222222">
<div style="max-width:480px;margin:0 auto;padding:32px 24px">
<p style="font-size:22px;color:#1F3D2B;margin:0 0 24px"><strong>AfriMart</strong></p>
<p style="font-size:16px;line-height:1.5;margin:0 0 16px">Your sign-in code is</p>
<p style="font-size:36px;letter-spacing:8px;color:#1F3D2B;margin:0 0 16px"><strong>${code}</strong></p>
<p style="font-size:14px;line-height:1.5;color:#555555;margin:0">It works for ${SIGN_IN_CODE_MINUTES} minutes. If you didn't ask for it, you can ignore this email.</p>
</div></body></html>`;
}
