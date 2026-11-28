/**
 * Buyer and store sign-in, private evidence photos, and payouts in the seller's
 * thread, end to end against the real database and the real routers.
 *
 * Every request goes through `createContext`, the function the server uses, with
 * a real bearer token, so what is proved is what a browser's request gets. The
 * picture route is exercised through Fastify's `inject`, the real handler.
 * Creates throwaway buyers, stores, orders and photos and removes them after;
 * audit entries are append-only by design and stay.
 *   npm run verify:sign-in --workspace=@afrimart/backend
 */
import Fastify from "fastify";
import { buildServer } from "../app.js";
import sharp from "sharp";
import { TRPCError } from "@trpc/server";
import { prisma } from "../db.js";
import { callerFor, cookieToken } from "./callers.js";
import { issueUserSession, resolveUserSession, revokeAllForUser } from "../auth/userSession.js";
import { resetAllIpLimits } from "../auth/rateLimit.js";
import { FileEmailSender, MemoryEmailSender, setSenders, type SmsMessage, type SmsSender } from "../notifications/senders.js";
import { photoStore } from "../storage/store.js";
import { photoLinkIsValid, signedPhotoUrl } from "../storage/access.js";
import { registerPhotoRoute } from "../storage/route.js";
import { setPayoutDashboard } from "../payments/dashboard.js";
import { REFUND_WINDOW_DAYS, SELLER_TRUSTED_AFTER_ORDERS } from "../config.js";
import { handleTrackingEvent } from "../notifications/pipeline.js";
import type { ResolvedSession } from "../auth/session.js";

const P = "sgn-";
const run = Date.now().toString(36);
const id = (s: string) => `${P}${run}-${s}`;
const emailOf = (s: string) => `${s}-${run}@sgn.test`;
const PHONE = { a: "+15555550101", b: "+15555550102", unknown: "+15555550199" };

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`${pass ? "  ok  " : "  FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};
async function outcome<T>(p: Promise<T>): Promise<{ code: string; message: string; value?: T }> {
  try {
    return { code: "ok", message: "", value: await p };
  } catch (e) {
    if (e instanceof TRPCError) return { code: e.code, message: e.message };
    throw e;
  }
}
async function sessionFor(email: string): Promise<ResolvedSession> {
  const u = await prisma.staffUser.findUniqueOrThrow({ where: { email } });
  return { sessionId: "verify", staffUserId: u.id, email: u.email, name: u.name, role: u.role, mfaVerified: true, mfaEnrolled: true };
}

/* A sender that captures instead of delivering, so the test can read the code. */
const mail = new MemoryEmailSender();
class CapturingSms implements SmsSender {
  readonly name = "capture";
  enabled = true;
  readonly sent: SmsMessage[] = [];
  async send(m: SmsMessage) {
    this.sent.push(m);
  }
}
const sms = new CapturingSms();
setSenders({ email: mail, sms });
const codeFrom = (text: string) => /\b(\d{6})\b/.exec(text.replace(/<[^>]+>/g, " "))![1]!;
const lastEmailCode = () => codeFrom(mail.captured.at(-1)!.html);
const lastSmsCode = () => codeFrom(sms.sent.at(-1)!.body);

/** Pretend the pacing window has passed, so the next request is not "too soon". */
const ageCodes = (where: { identifier: string }, seconds = 7200) =>
  prisma.authCode.updateMany({ where, data: { createdAt: new Date(Date.now() - seconds * 1000) } });

// Each call from its own address, so the per-address limit does not fire in the middle of a test (it has its own check below).
let ipN = 0;
const freshIp = () => `10.1.${Math.floor(++ipN / 250)}.${ipN % 250}`;
const anon = (capture?: string[]) => callerFor({ ip: freshIp(), capture });
const finance = callerFor({ staff: await sessionFor("finance@afrimart.test") });
const ops = callerFor({ staff: await sessionFor("ops@afrimart.test") });
const reviewer = callerFor({ staff: await sessionFor("reviewer@afrimart.test") });

async function sweep() {
  const stores = { storeId: { startsWith: P } };
  await prisma.webhookEvent.deleteMany({ where: { shipmentId: { startsWith: P } } });
  await prisma.notification.deleteMany({ where: { orderId: { startsWith: P } } });
  await prisma.sellerMessage.deleteMany({ where: stores });
  await prisma.carrierAdjustment.deleteMany({ where: stores });
  await prisma.payout.deleteMany({ where: stores });
  await prisma.userSession.deleteMany({ where: { OR: [stores, { buyerId: { startsWith: P } }, { buyer: { email: { endsWith: "@sgn.test" } } }] } });
  await prisma.authCode.deleteMany({ where: { OR: [{ identifier: { endsWith: "@sgn.test" } }, { identifier: { in: Object.values(PHONE) } }] } });
  await prisma.refundClaim.deleteMany({ where: { buyerId: { startsWith: P } } });
  await prisma.shipmentItem.deleteMany({ where: { shipmentId: { startsWith: P } } });
  await prisma.shipment.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.payment.deleteMany({ where: { orderId: { startsWith: P } } });
  await prisma.order.deleteMany({ where: { buyerId: { startsWith: P } } });
  await prisma.kitchenLicence.deleteMany({ where: stores });
  await prisma.sellerBadge.deleteMany({ where: stores });
  await prisma.store.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.buyer.deleteMany({ where: { OR: [{ id: { startsWith: P } }, { email: { endsWith: "@sgn.test" } }] } });
}

await sweep();
resetAllIpLimits();

try {
  const hub = await prisma.hubMetro.findFirstOrThrow();
  const makeStore = (tag: string, phone: string | null, payoutAccountId: string | null = null) =>
    prisma.store.create({
      data: { id: id(tag), name: `SGN ${tag}`, ownerName: tag, ownerPhone: phone, payoutAccountId, sellerType: "store", hubMetroId: hub.id, onboardingStatus: "live", verificationStatus: "verified" },
    });
  const storeA = await makeStore("a", PHONE.a, "acct_SGNA1");
  const storeB = await makeStore("b", PHONE.b, null);

  /* -------------------------------------------------------------- buyers */
  console.log("=== buyer sign-in: a code by email ===");
  const email = emailOf("amara");
  check("an invalid address is refused before anything is sent", (await outcome(anon().userAuth.requestBuyerCode({ email: "not-an-email" }))).code === "BAD_REQUEST" && mail.captured.length === 0);
  const asked = await outcome(anon().userAuth.requestBuyerCode({ email: `  ${email.toUpperCase()} ` }));
  check("asking for a code succeeds and sends one email to the normalised address", asked.code === "ok" && mail.captured.length === 1 && mail.captured[0]!.to === email, mail.captured[0]?.to);
  const code1 = lastEmailCode();
  const row1 = await prisma.authCode.findFirstOrThrow({ where: { identifier: email }, orderBy: { createdAt: "desc" } });
  check("a six-digit code", /^\d{6}$/.test(code1));
  check("only a salted hash is stored, not the code", !JSON.stringify(row1).includes(code1) && row1.codeHash.length === 64 && row1.salt.length > 8);
  check("asking again straight away is turned away (paced)", (await outcome(anon().userAuth.requestBuyerCode({ email }))).code === "TOO_MANY_REQUESTS");

  const wrong = await outcome(anon().userAuth.verifyBuyerCode({ email, code: code1 === "000000" ? "111111" : "000000" }));
  check("a wrong code is refused with one generic message", wrong.code === "UNAUTHORIZED" && /didn't work/i.test(wrong.message), wrong.message);
  check("and creates no account", (await prisma.buyer.count({ where: { email } })) === 0);
  check("a code for one address does not work for another", (await outcome(anon().userAuth.verifyBuyerCode({ email: emailOf("someone-else"), code: code1 }))).code === "UNAUTHORIZED");
  check("a malformed code is refused at the door", (await outcome(anon().userAuth.verifyBuyerCode({ email, code: "12ab56" }))).code === "BAD_REQUEST");

  const buyerCookies: string[] = [];
  const signedIn = await outcome(anon(buyerCookies).userAuth.verifyBuyerCode({ email, code: code1 }));
  check("the right code signs the buyer in, creating the account on first use", signedIn.code === "ok" && (await prisma.buyer.count({ where: { email } })) === 1);
  check("the session is not in the response body: it travels only as a cookie", !JSON.stringify(signedIn.value).includes("token") && Object.keys(signedIn.value as object).join() === "expiresAt");
  const token = cookieToken(buyerCookies, "buyer")!;
  check("the cookie carries it", typeof token === "string" && token.length > 30);
  check("the session token is opaque and only its hash is stored", (await prisma.userSession.count({ where: { tokenHash: token } })) === 0 && (await prisma.userSession.count({ where: { buyer: { email } } })) === 1);
  check("the token identifies this buyer, and nobody else", (await callerFor({ rawToken: token }).userAuth.buyerMe()).email === email);
  check("the same code cannot be used twice", (await outcome(anon().userAuth.verifyBuyerCode({ email, code: code1 }))).code === "UNAUTHORIZED");

  console.log("\n=== buyer sign-in: guessing, replay, expiry, pacing ===");
  await ageCodes({ identifier: email });
  await anon().userAuth.requestBuyerCode({ email });
  const old = lastEmailCode();
  await ageCodes({ identifier: email });
  await anon().userAuth.requestBuyerCode({ email });
  const fresh = lastEmailCode();
  check("asking for a new code replaces the old one", (await outcome(anon().userAuth.verifyBuyerCode({ email, code: old }))).code === "UNAUTHORIZED" || old === fresh);

  const bad = fresh === "123456" ? "654321" : "123456";
  for (let i = 0; i < 5; i++) await outcome(anon().userAuth.verifyBuyerCode({ email, code: bad }));
  const burnt = await outcome(anon().userAuth.verifyBuyerCode({ email, code: fresh }));
  check("after five wrong guesses even the right code no longer works", burnt.code === "UNAUTHORIZED", burnt.code);

  await ageCodes({ identifier: email });
  await anon().userAuth.requestBuyerCode({ email });
  const target = lastEmailCode();
  const volley = await Promise.all(Array.from({ length: 25 }, (_, i) => outcome(anon().userAuth.verifyBuyerCode({ email, code: String(100000 + ((Number(target) + 1 + i) % 900000)) }))));
  check("a parallel volley of guesses gets no more tries than one at a time", volley.every((v) => v.code === "UNAUTHORIZED"));
  const afterVolley = await prisma.authCode.findFirstOrThrow({ where: { identifier: email }, orderBy: { createdAt: "desc" } });
  check("the guesses were all counted", afterVolley.attempts >= 5, String(afterVolley.attempts));
  check("and the real code is now burnt too", (await outcome(anon().userAuth.verifyBuyerCode({ email, code: target }))).code === "UNAUTHORIZED");

  await ageCodes({ identifier: email });
  await anon().userAuth.requestBuyerCode({ email });
  const raceCode = lastEmailCode();
  const both = await Promise.all([outcome(anon().userAuth.verifyBuyerCode({ email, code: raceCode })), outcome(anon().userAuth.verifyBuyerCode({ email, code: raceCode }))]);
  check("two simultaneous correct submissions cannot both succeed", both.filter((b) => b.code === "ok").length === 1, both.map((b) => b.code).join());

  await ageCodes({ identifier: email });
  await anon().userAuth.requestBuyerCode({ email });
  const lateCode = lastEmailCode();
  await prisma.authCode.updateMany({ where: { identifier: email, consumedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
  check("an expired code is refused", (await outcome(anon().userAuth.verifyBuyerCode({ email, code: lateCode }))).code === "UNAUTHORIZED");

  await ageCodes({ identifier: email }); // start from a clean hour
  for (let i = 0; i < 6; i++) {
    await ageCodes({ identifier: email }, 120); // past the resend wait, but still inside the hour
    await outcome(anon().userAuth.requestBuyerCode({ email }));
  }
  await prisma.authCode.updateMany({ where: { identifier: email }, data: { createdAt: new Date(Date.now() - 1_800_000) } });
  check("only a few codes an hour can be asked for", (await outcome(anon().userAuth.requestBuyerCode({ email }))).code === "TOO_MANY_REQUESTS");

  console.log("\n=== buyer sessions: revoke, idle, cap, wrong audience ===");
  const buyerRow = await prisma.buyer.findUniqueOrThrow({ where: { email } });
  const s2 = await issueUserSession({ kind: "buyer", buyerId: buyerRow.id });
  check("a fresh session resolves", (await resolveUserSession(s2.token))?.buyerId === buyerRow.id);
  check("a buyer's token is not a store's", (await outcome(callerFor({ rawToken: s2.token }).merchant.me())).code === "UNAUTHORIZED");
  check("no token, and a made-up token, are both signed out", (await resolveUserSession(null)) === null && (await resolveUserSession("made-up")) === null);
  await callerFor({ rawToken: s2.token }).userAuth.signOutBuyer();
  check("signing out ends the session on the server", (await resolveUserSession(s2.token)) === null);
  const s3 = await issueUserSession({ kind: "buyer", buyerId: buyerRow.id });
  await prisma.userSession.updateMany({ where: { buyerId: buyerRow.id, revokedAt: null }, data: { lastSeenAt: new Date(Date.now() - 40 * 86_400_000) } });
  check("a session idle for too long is gone, and stays gone", (await resolveUserSession(s3.token)) === null && (await resolveUserSession(s3.token)) === null);
  const s4 = await issueUserSession({ kind: "buyer", buyerId: buyerRow.id });
  await prisma.userSession.updateMany({ where: { buyerId: buyerRow.id, revokedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
  check("a session past its absolute limit is gone", (await resolveUserSession(s4.token)) === null);
  const s5 = await issueUserSession({ kind: "buyer", buyerId: buyerRow.id });
  const s6 = await issueUserSession({ kind: "buyer", buyerId: buyerRow.id });
  const revoked = await revokeAllForUser({ buyerId: buyerRow.id });
  check("every session of one buyer can be ended at once", revoked >= 2 && (await resolveUserSession(s5.token)) === null && (await resolveUserSession(s6.token)) === null, String(revoked));

  /* -------------------------------------------------------------- stores */
  console.log("\n=== store sign-in: a code by text to the number on file ===");
  const askedStore = await outcome(anon().userAuth.requestStoreCode({ phone: "(555) 555-0101" }));
  check("a number in any form reaches the shop it belongs to", askedStore.code === "ok" && sms.sent.length === 1 && sms.sent[0]!.to === PHONE.a, sms.sent[0]?.to);
  const sCode = lastSmsCode();
  check("the text says how long it lasts and what to do if unasked, without exclamation marks", /minutes/.test(sms.sent[0]!.body) && /ignore/i.test(sms.sent[0]!.body) && !sms.sent[0]!.body.includes("!"));

  const unknownAsk = await outcome(anon().userAuth.requestStoreCode({ phone: PHONE.unknown }));
  check("a number with no shop gets the same answer, and nothing is sent", unknownAsk.code === "ok" && JSON.stringify(unknownAsk.value) === JSON.stringify(askedStore.value) && sms.sent.length === 1);
  check("and the same pacing, so the pacing does not say who is a seller", (await outcome(anon().userAuth.requestStoreCode({ phone: PHONE.unknown }))).code === (await outcome(anon().userAuth.requestStoreCode({ phone: PHONE.a }))).code);
  check("a number with a code row but no shop cannot sign in with any code", (await outcome(anon().userAuth.verifyStoreCode({ phone: PHONE.unknown, code: "123456" }))).code === "UNAUTHORIZED");

  check("a wrong code is refused", (await outcome(anon().userAuth.verifyStoreCode({ phone: PHONE.a, code: sCode === "000000" ? "111111" : "000000" }))).code === "UNAUTHORIZED");
  check("a buyer's emailed code does not open a shop", (await outcome(anon().userAuth.verifyStoreCode({ phone: PHONE.b, code: lastEmailCode() }))).code === "UNAUTHORIZED");
  const storeCookies: string[] = [];
  const storeIn = await outcome(anon(storeCookies).userAuth.verifyStoreCode({ phone: "555-555-0101", code: sCode }));
  check("the right code signs the owner in to their shop", storeIn.code === "ok");
  const storeToken = cookieToken(storeCookies, "store")!;
  const me = await callerFor({ rawToken: storeToken }).merchant.me();
  check("the session is that shop's, by name", me.name === "SGN a", me.name);
  check("a shop's token is not a buyer's", (await outcome(callerFor({ rawToken: storeToken }).userAuth.buyerMe())).code === "UNAUTHORIZED");
  check("and the shop's token gives it only its own inbox", (await callerFor({ rawToken: storeToken }).merchant.inbox()).every((j) => typeof j.shipmentId === "string"));

  console.log("\n=== sending codes only where they can arrive ===");
  setSenders({ sms: Object.assign(new CapturingSms(), { enabled: false }) });
  check("with texting switched off, a shop is told so rather than that a code is on its way", (await outcome(anon().userAuth.requestStoreCode({ phone: PHONE.b }))).code === "SERVICE_UNAVAILABLE");
  setSenders({ sms });
  const prodEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  setSenders({ email: new FileEmailSender("/tmp/sgn-mail") });
  const noMail = await outcome(anon().userAuth.requestBuyerCode({ email: emailOf("nobody") }));
  if (prodEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = prodEnv;
  setSenders({ email: mail });
  check("in production, a file instead of a real mail sender is refused, not pretended", noMail.code === "SERVICE_UNAVAILABLE", noMail.code);


  console.log("\n=== one address cannot spray requests ===");
  const spray = callerFor({ ip: "203.0.113.9" });
  const results: string[] = [];
  for (let i = 0; i < 25; i++) results.push((await outcome(spray.userAuth.requestBuyerCode({ email: "nope" }))).code);
  check("after a run of requests from one address, it is turned away", results.slice(0, 20).every((c) => c === "BAD_REQUEST") && results.slice(20).every((c) => c === "TOO_MANY_REQUESTS"), [...new Set(results)].join());

  /* ------------------------------------------- the real HTTP path, with cookies */
  console.log("\n=== the session travels only as an httpOnly cookie, through the real server ===");
  const app = await buildServer({ logger: false });
  const ORIGIN = "http://localhost:3000";
  let hip = 0;
  const addr = () => `10.9.${Math.floor(++hip / 250)}.${hip % 250}`;
  const hPost = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    app.inject({ method: "POST", url: `/trpc/${path}`, remoteAddress: addr(), headers: { "content-type": "application/json", ...headers }, payload: JSON.stringify(body) });
  const hGet = (path: string, headers: Record<string, string> = {}) => app.inject({ method: "GET", url: `/trpc/${path}`, remoteAddress: addr(), headers });
  const result = (r: { body: string }) => JSON.parse(r.body).result?.data;
  const errCode = (r: { body: string }) => JSON.parse(r.body).error?.data?.code as string | undefined;
  const setCookies = (r: { headers: Record<string, unknown> }) => ([] as string[]).concat((r.headers["set-cookie"] as string[] | string | undefined) ?? []);
  const pair = (c: string) => c.split(";")[0]!;

  const httpEmail = emailOf("http-buyer");
  const askedHttp = await hPost("userAuth.requestBuyerCode", { email: httpEmail }, { origin: ORIGIN });
  check("asking for a code over HTTP works", askedHttp.statusCode === 200 && result(askedHttp)?.sent === true);
  const verified = await hPost("userAuth.verifyBuyerCode", { email: httpEmail, code: lastEmailCode() }, { origin: ORIGIN });
  const issued = setCookies(verified);
  check("the right code answers 200 and sets one cookie", verified.statusCode === 200 && issued.length === 1, issued.join(" | "));
  const buyerSetCookie = issued[0]!;
  check("it is httpOnly, so no script on the page can read it", /;\s*HttpOnly/i.test(buyerSetCookie));
  check("same-site only", /;\s*SameSite=Strict/i.test(buyerSetCookie));
  check("for the whole API, with no Domain (host-only)", /;\s*Path=\//.test(buyerSetCookie) && !/Domain=/i.test(buyerSetCookie));
  check("ending when the session does", /Max-Age=\d{6,}/.test(buyerSetCookie) && /Expires=/.test(buyerSetCookie));
  check("named for the kind of account", buyerSetCookie.startsWith("afrimart_buyer=") || buyerSetCookie.startsWith("__Host-afrimart_buyer="));
  check("the response body holds no token", !verified.body.includes(pair(buyerSetCookie).split("=")[1]!.slice(0, 20)) && !/token/i.test(verified.body));
  const buyerCookie = pair(buyerSetCookie);

  const me1 = await hGet("userAuth.buyerMe", { cookie: buyerCookie });
  check("the cookie signs the buyer in for a read", me1.statusCode === 200 && result(me1)?.email === httpEmail);
  check("without it, the same read is refused", errCode(await hGet("userAuth.buyerMe")) === "UNAUTHORIZED");

  // A signed-in buyer reporting a parcel that does not exist gets NOT_FOUND; an unknown caller gets UNAUTHORIZED.
  const probe = (headers: Record<string, string>) => hPost("claims.submitParcelReport", { shipmentId: "no-such-parcel" }, headers);
  check("a cookie write from the app's own origin is accepted", errCode(await probe({ cookie: buyerCookie, origin: ORIGIN })) === "NOT_FOUND");
  check("the same write from another site's page is not: the cookie is ignored", errCode(await probe({ cookie: buyerCookie, origin: "https://evil.example" })) === "UNAUTHORIZED");
  check("nor with no Origin at all", errCode(await probe({ cookie: buyerCookie })) === "UNAUTHORIZED");
  check("nor from a look-alike on localhost over https", errCode(await probe({ cookie: buyerCookie, origin: "https://localhost:3000" })) === "UNAUTHORIZED");
  const cors = await hGet("userAuth.buyerMe", { cookie: buyerCookie, origin: ORIGIN });
  const corsEvil = await hGet("userAuth.buyerMe", { cookie: buyerCookie, origin: "https://evil.example" });
  check("CORS lets the app's origin read the answer, with credentials", cors.headers["access-control-allow-origin"] === ORIGIN && cors.headers["access-control-allow-credentials"] === "true");
  check("and gives another site's page nothing to read it with", corsEvil.headers["access-control-allow-origin"] === undefined);

  check("garbage in the cookie is signed out", errCode(await hGet("userAuth.buyerMe", { cookie: "afrimart_buyer=not-a-session-token-at-all-0000000" })) === "UNAUTHORIZED");
  const cookieNamedForStore = buyerCookie.replace(/(__Host-)?afrimart_buyer=/, (m) => m.replace("buyer", "store"));
  check("a buyer's token under a shop's cookie name opens nothing", errCode(await hGet("merchant.me", { cookie: cookieNamedForStore })) === "UNAUTHORIZED");

  // a shop in the same browser: two cookies, each used only for its own kind
  await hPost("userAuth.requestStoreCode", { phone: PHONE.b }, { origin: ORIGIN });
  const storeVerified = await hPost("userAuth.verifyStoreCode", { phone: PHONE.b, code: lastSmsCode() }, { origin: ORIGIN });
  const storeCookie = pair(setCookies(storeVerified)[0]!);
  check("a shop signs in the same way, with its own cookie", storeVerified.statusCode === 200 && /afrimart_store=/.test(storeCookie));
  const bothCookies = `${buyerCookie}; ${storeCookie}`;
  check("with bothCookies in one browser each procedure uses its own", result(await hGet("userAuth.buyerMe", { cookie: bothCookies }))?.email === httpEmail && result(await hGet("merchant.me", { cookie: bothCookies }))?.name === "SGN b");

  // signing out
  const out = await hPost("userAuth.signOutBuyer", {}, { cookie: bothCookies, origin: ORIGIN });
  const cleared = setCookies(out)[0] ?? "";
  check("signing out clears the cookie in the browser", /afrimart_buyer=;/.test(cleared) && /Max-Age=0/.test(cleared));
  check("and ends the session on the server: the same cookie, sent again, is refused", errCode(await hGet("userAuth.buyerMe", { cookie: buyerCookie })) === "UNAUTHORIZED");
  check("it did not touch the shop's session", result(await hGet("merchant.me", { cookie: bothCookies }))?.name === "SGN b");
  check("signing out when not signed in is harmless", (await hPost("userAuth.signOutBuyer", {}, { origin: ORIGIN })).statusCode === 200);
  const forged = await hPost("userAuth.signOutStore", {}, { cookie: storeCookie, origin: "https://evil.example" });
  check("another site cannot sign a shop out by riding its cookie", forged.statusCode === 200 && result(await hGet("merchant.me", { cookie: storeCookie }))?.name === "SGN b");

  console.log("\n=== sign out of all devices ===");
  await ageCodes({ identifier: PHONE.b });
  await hPost("userAuth.requestStoreCode", { phone: PHONE.b }, { origin: ORIGIN });
  const second = await hPost("userAuth.verifyStoreCode", { phone: PHONE.b, code: lastSmsCode() }, { origin: ORIGIN });
  const secondCookie = pair(setCookies(second)[0]!);
  const otherShop = await issueUserSession({ kind: "store", storeId: storeA.id });
  check("the shop is signed in on two devices", result(await hGet("merchant.me", { cookie: storeCookie }))?.name === "SGN b" && result(await hGet("merchant.me", { cookie: secondCookie }))?.name === "SGN b");
  check("signing out everywhere needs a live session", errCode(await hPost("userAuth.signOutStoreEverywhere", {}, { origin: ORIGIN })) === "UNAUTHORIZED");
  check("and an allowed origin", errCode(await hPost("userAuth.signOutStoreEverywhere", {}, { cookie: storeCookie, origin: "https://evil.example" })) === "UNAUTHORIZED");
  const everywhere = await hPost("userAuth.signOutStoreEverywhere", {}, { cookie: storeCookie, origin: ORIGIN });
  check("it ends every session of that shop and says how many", everywhere.statusCode === 200 && result(everywhere)?.sessionsEnded >= 2, JSON.stringify(result(everywhere)));
  check("the other device is signed out too", errCode(await hGet("merchant.me", { cookie: secondCookie })) === "UNAUTHORIZED" && errCode(await hGet("merchant.me", { cookie: storeCookie })) === "UNAUTHORIZED");
  check("and the cookie is cleared here", /Max-Age=0/.test(setCookies(everywhere)[0] ?? ""));
  check("another shop's session is untouched", (await resolveUserSession(otherShop.token))?.storeId === storeA.id);
  await app.close();

  /* ------------------------------------------------------ private photos */
  console.log("\n=== private photos: only a signed, short-lived link opens one ===");
  const jpeg = `data:image/jpeg;base64,${(await sharp({ create: { width: 64, height: 48, channels: 3, background: "#cc9966" } }).jpeg().toBuffer()).toString("base64")}`;
  const { decodeUpload } = await import("../storage/photos.js");
  const packingPath = await photoStore.put("packing", decodeUpload(jpeg));
  const claimPath = await photoStore.put("claim", decodeUpload(jpeg));
  const docPath = await photoStore.put("document", decodeUpload(jpeg));

  const buyerOwner = await prisma.buyer.create({ data: { id: id("buyer"), email: emailOf("owner") } });
  const orderId = id("order");
  await prisma.order.create({ data: { id: orderId, buyerId: buyerOwner.id, status: "placed", totalCents: 5000, shippingCents: 800, taxCents: 100 } });
  const shipmentId = id("ship");
  await prisma.shipment.create({ data: { id: shipmentId, orderId, storeId: storeA.id, temperatureClass: "ambient", status: "in_transit", packingPhotoUrl: packingPath, packingPhotoAt: new Date() } });
  const claim = await prisma.refundClaim.create({
    data: { buyerId: buyerOwner.id, orderId, shipmentId, kind: "item", reason: "missing_items", amountCents: 900, photoUrl: claimPath, status: "manual_review" },
  });
  const lic = await prisma.kitchenLicence.create({ data: { storeId: storeB.id, status: "applied", evidence: docPath } });
  const badge = await prisma.sellerBadge.create({ data: { storeId: storeB.id, kind: "diaspora_owned", status: "applied", evidence: docPath } });

  const route = Fastify();
  registerPhotoRoute(route);
  const get = (url: string) => route.inject({ method: "GET", url });
  const name = (p: string) => p.split("/").pop()!;

  check("a stored path on its own opens nothing", (await get(packingPath)).statusCode === 404 && (await get(claimPath)).statusCode === 404 && (await get(docPath)).statusCode === 404);

  const sellerInbox = await callerFor({ identity: `store:${storeA.id}` }).merchant.inbox();
  const link = sellerInbox.find((j) => j.shipmentId === shipmentId)?.packingPhotoUrl;
  check("the seller who packed it is given a signed link, not the stored path", Boolean(link) && link!.includes("sig=") && link!.includes("exp="), link ?? "");
  const served = await get(link!);
  check("and the link serves the image, as an image, never cached", served.statusCode === 200 && served.headers["content-type"] === "image/jpeg" && String(served.headers["cache-control"]).includes("no-store") && served.headers["x-content-type-options"] === "nosniff");
  check("the other seller's inbox has no such photo", !(await callerFor({ identity: `store:${storeB.id}` }).merchant.inbox()).some((j) => j.shipmentId === shipmentId));

  const u = new URL(link!, "http://x");
  const tampered = `${u.pathname}?exp=${Number(u.searchParams.get("exp")) + 86400}&sig=${u.searchParams.get("sig")}`;
  check("an extended expiry is refused", (await get(tampered)).statusCode === 404);
  const swapped = `/photos/claim/${name(claimPath)}?${u.searchParams.toString()}`;
  check("a link for one photo does not open another", (await get(swapped)).statusCode === 404);
  const expired = signedPhotoUrl(packingPath, { now: Date.now() - 400_000 })!;
  check("an expired link is refused", (await get(expired)).statusCode === 404 && !photoLinkIsValid("packing", name(packingPath), new URL(expired, "http://x").searchParams.get("exp")!, new URL(expired, "http://x").searchParams.get("sig")!));
  check("a request for a file that does not exist is the same 404", (await get("/photos/claim/0123456789abcdef0123456789abcdef.jpg?exp=9999999999&sig=" + "0".repeat(64))).statusCode === 404);

  console.log("\n=== staff: opening a private photo needs a role, and is audited ===");
  const startedAt = new Date();
  const queue = await finance.admin.refundClaims();
  const queued = queue.find((c) => c.id === claim.id);
  check("the reports table carries no photo paths or links", Boolean(queued) && queued!.hasPhoto === true && queued!.hasPackingPhoto === true && !JSON.stringify(queued).includes("/photos/"));
  const licList = await ops.admin.kitchenLicences({ status: "applied" });
  const licRow = licList.find((r) => r.id === lic.id);
  check("the licence table carries no photo path either, only that there is one", licRow?.hasEvidencePhoto === true && licRow?.evidence === null && !JSON.stringify(licList).includes("/photos/"));
  const badgeList = await ops.admin.badgeApplications({ status: "applied" });
  check("nor the badge table", badgeList.find((r) => r.id === badge.id)?.hasEvidencePhoto === true && !JSON.stringify(badgeList).includes("/photos/"));

  const views = () => prisma.auditLogEntry.findMany({ where: { action: "photo.view", createdAt: { gte: startedAt } }, orderBy: { createdAt: "asc" } });
  const noRole = await outcome(reviewer.admin.claimPhotoLinks({ claimId: claim.id }));
  const noRoleDoc = await outcome(reviewer.admin.evidencePhotoLink({ subject: "kitchen_licence", id: lic.id }));
  check("a catalogue reviewer can open neither claim photos nor licences", noRole.code === "FORBIDDEN" && noRoleDoc.code === "FORBIDDEN", `${noRole.code} ${noRoleDoc.code}`);
  check("nobody signed in can either", (await outcome(anon().admin.claimPhotoLinks({ claimId: claim.id }))).code !== "ok" && (await outcome(anon().admin.evidencePhotoLink({ subject: "kitchen_licence", id: lic.id }))).code !== "ok");
  check("and a refused attempt leaves no view on record, because none was granted", (await views()).length === 0);

  const opened = await finance.admin.claimPhotoLinks({ claimId: claim.id });
  check("finance is given links for the buyer's photo and the seller's packing photo", Boolean(opened.photo) && Boolean(opened.packingPhoto) && (await get(opened.photo!)).statusCode === 200 && (await get(opened.packingPhoto!)).statusCode === 200);
  const afterClaim = await views();
  check("each photo opened is in the audit log, by whom", afterClaim.length === 2 && afterClaim.every((v) => v.actorEmail === "finance@afrimart.test" && v.actorRole === "finance"), `${afterClaim.length}`);
  check("one entry names the report, the other the parcel", afterClaim.some((v) => v.subjectType === "claim" && v.subjectId === claim.id) && afterClaim.some((v) => v.subjectType === "shipment" && v.subjectId === shipmentId));

  const lnk = await ops.admin.evidencePhotoLink({ subject: "kitchen_licence", id: lic.id });
  check("operations opens a licence photo through a signed link", (await get(lnk.url)).statusCode === 200);
  const licView = (await views()).filter((v) => v.subjectType === "kitchen_licence");
  check("the licence view is audited with the licence, the store and who", licView.length === 1 && licView[0]!.subjectId === lic.id && licView[0]!.actorEmail === "ops@afrimart.test" && (licView[0]!.after as { storeId?: string })?.storeId === storeB.id);
  await ops.admin.evidencePhotoLink({ subject: "kitchen_licence", id: lic.id });
  check("opening it again is recorded again", (await views()).filter((v) => v.subjectType === "kitchen_licence").length === 2);
  const badgeLnk = await ops.admin.evidencePhotoLink({ subject: "seller_badge", id: badge.id });
  check("a badge document is the same", (await get(badgeLnk.url)).statusCode === 200 && (await views()).some((v) => v.subjectType === "seller_badge"));
  check("an application with no photo has nothing to open", (await outcome(ops.admin.evidencePhotoLink({ subject: "kitchen_licence", id: "no-such" }))).code === "NOT_FOUND");

  /* ------------------------------------------------------------- payouts */
  console.log("\n=== the payout hold preview uses the seller's own fulfilled orders ===");
  const cleanOrderIds = Array.from({ length: SELLER_TRUSTED_AFTER_ORDERS - 1 }, (_, i) => id(`hold-order-${i}`));
  await prisma.order.createMany({ data: cleanOrderIds.map((id) => ({
    id, buyerId: buyerOwner.id, totalCents: 1000, shippingCents: 0, taxCents: 0,
  })) });
  await prisma.shipment.createMany({ data: cleanOrderIds.map((orderId, i) => ({
    id: id(`hold-ship-${i}`), orderId, storeId: storeB.id, temperatureClass: "ambient", status: "delivered",
  } as const)) });
  const sharedParcel = { orderId, storeId: storeB.id, temperatureClass: "ambient" } as const;
  const pendingParcelId = id("hold-pending");
  await prisma.shipment.createMany({ data: [
    { ...sharedParcel, id: id("hold-delivered"), status: "delivered" },
    { ...sharedParcel, id: pendingParcelId, status: "in_transit" },
  ] });
  const previewHold = () => finance.admin.payoutHoldFor({ id: storeB.id });
  check("a partly delivered split order earns no clean-order credit", (await previewHold()).tier === "new");
  await prisma.shipment.update({ where: { id: pendingParcelId }, data: { status: "delivered" } });
  const claimData = { buyerId: buyerOwner.id, orderId, amountCents: 100, reason: "missing_items" };
  await prisma.refundClaim.create({ data: { ...claimData, status: "manual_review" } });
  check("another seller's dispute and an unattributed shared-order claim leave this seller's tier intact", (await previewHold()).tier === "trusted");
  const sellerClaim = await prisma.refundClaim.create({ data: { ...claimData, shipmentId: pendingParcelId, status: "auto_approved" } });
  check("an automatically approved claim on the seller's own parcel counts", (await previewHold()).tier === "new");
  await prisma.refundClaim.update({ where: { id: sellerClaim.id }, data: { status: "rejected" } });
  check("a rejected claim no longer affects the preview", (await previewHold()).tier === "trusted");
  if (cleanOrderIds[0]) {
    await prisma.refundClaim.create({ data: { ...claimData, orderId: cleanOrderIds[0], status: "approved" } });
    check("an older order-only claim counts when one seller fulfilled the order", (await previewHold()).tier === "new");
  }

  console.log("\n=== buyers charged counts collected payments before refunds ===");
  const priorCollections = await finance.admin.reconciliation();
  async function collectionsMatch(charged: number, shipping: number, tax: number) {
    const report = await finance.admin.reconciliation();
    return report.buyerChargedCents === priorCollections.buyerChargedCents + charged &&
      report.shippingCollectedCents === priorCollections.shippingCollectedCents + shipping &&
      report.taxCollectedCents === priorCollections.taxCollectedCents + tax;
  }
  const payment = await prisma.payment.create({
    data: { orderId, stripePaymentIntentId: id("intent"), buyerChargeCents: 5000 },
  });
  const failedOrder = await prisma.order.create({ data: {
    id: id("failed-order"), buyerId: buyerOwner.id, totalCents: 1800, shippingCents: 300, taxCents: 50,
  } });
  check("an order without a payment counts as an order but adds no collections",
    (await finance.admin.reconciliation()).orderCount === priorCollections.orderCount + 1 && await collectionsMatch(0, 0, 0));
  await prisma.payment.create({ data: { orderId: failedOrder.id, stripePaymentIntentId: id("failed-intent"), buyerChargeCents: 1800, status: "failed" } });
  check("pending and failed payments add zero to charges, shipping, and tax", await collectionsMatch(0, 0, 0));
  const setStatus = (status: string) => prisma.payment.update({ where: { id: payment.id }, data: { status } });
  await setStatus("succeeded");
  await setStatus("succeeded");
  check("a repeated success counts the charge, shipping, and tax once", await collectionsMatch(5000, 800, 100));
  await setStatus("partially_refunded");
  check("a partial refund preserves gross collections", await collectionsMatch(5000, 800, 100));
  await setStatus("refunded");
  await prisma.payment.update({ where: { orderId: failedOrder.id }, data: { status: "succeeded" } });
  check("a full refund preserves gross collections and a successful retry adds the second order once",
    await collectionsMatch(6800, 1100, 150));
  await setStatus("succeeded"); // The delivery-window fixture below has no issued refund.

  console.log("\n=== a payout is posted to the seller's thread, once ===");
  const baseline = await finance.admin.reconciliation();
  const payoutOrderId = id("order-x-AB12");
  const payout = await prisma.payout.create({
    data: { storeId: storeA.id, orderId: payoutOrderId, grossCents: 10000, takeRateBps: 1300, fulfilmentFeeCents: 199, netCents: 8501, status: "scheduled" },
  });
  const release = () => outcome(finance.admin.releasePayout({ payoutId: payout.id, note: "weekly run" }));
  check("a payout without a linked seller shipment cannot release", (await release()).code === "BAD_REQUEST");
  const missing = await finance.admin.reconciliation();
  check("a missing shipment is flagged with no release date",
    missing.payouts.find((p) => p.id === payout.id)?.availability.label === "Missing seller shipment" &&
    missing.heldCents === baseline.heldCents + payout.netCents && missing.heldCount === baseline.heldCount + 1);
  await prisma.order.create({ data: { id: payoutOrderId, buyerId: buyerOwner.id, totalCents: 10000, shippingCents: 0, taxCents: 0 } });
  const matureDelivery = new Date(Date.now() - (REFUND_WINDOW_DAYS + 1) * 86400000);
  const splitId = id("payout-split");
  const remainingId = id("payout-shop-b");
  const parcel = { orderId: payoutOrderId, storeId: storeA.id, temperatureClass: "ambient" } as const;
  await prisma.shipment.createMany({ data: [
    { ...parcel, id: id("payout-first"), status: "delivered", deliveredAt: matureDelivery },
    { ...parcel, id: remainingId, storeId: storeB.id, status: "in_transit" },
  ] });
  async function checkAwaitingPayment(label: string) {
    const attempt = await release();
    const report = await finance.admin.reconciliation();
    const availability = report.payouts.find((p) => p.id === payout.id)?.availability;
    check(label, attempt.code === "BAD_REQUEST" && attempt.message === "Awaiting payment" &&
      availability?.blocked === true && availability.label === attempt.message && availability.eligibleAt === null &&
      report.heldCount === baseline.heldCount + 1 && report.heldCents === baseline.heldCents + payout.netCents);
  }
  await checkAwaitingPayment("a delivered order with no payment waits even after the refund window");
  const funding = await prisma.payment.create({ data: {
    orderId: payoutOrderId, stripePaymentIntentId: id("payout-funding"), buyerChargeCents: 10000,
  } });
  await checkAwaitingPayment("a pending payment blocks release in both finance paths");
  await prisma.payment.update({ where: { id: funding.id }, data: { status: "failed" } });
  await checkAwaitingPayment("a failed payment stays blocked on retry");
  const untouched = await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
  check("unfunded release attempts leave the payout, audit trail, and merchant notices untouched",
    untouched.updatedAt.getTime() === payout.updatedAt.getTime() && untouched.paidAt === null &&
    untouched.netCents === payout.netCents && untouched.adjustmentsCents === 0 &&
    await prisma.sellerMessage.count({ where: { payoutId: payout.id } }) === 0 &&
    await prisma.auditLogEntry.count({ where: { subjectId: payout.id, action: "payout.release" } }) === 0);
  await prisma.shipment.create({ data: { ...parcel, id: splitId, status: "in_transit" } });
  await prisma.payment.update({ where: { id: funding.id }, data: { status: "succeeded" } });
  const awaitingDelivery = await release();
  check("successful payment still requires delivery of the seller's last parcel",
    awaitingDelivery.code === "BAD_REQUEST" && awaitingDelivery.message === "Awaiting delivery");
  const recentPayout = await prisma.payout.create({ data: { storeId: storeB.id, orderId, grossCents: 100, netCents: 100, takeRateBps: 0, fulfilmentFeeCents: 0 } });
  const recent = await outcome(finance.admin.releasePayout({ payoutId: recentPayout.id }));
  const confirmed = await ops.admin.interveneShipment({ shipmentId: pendingParcelId, action: "mark_delivered" });
  if (!("deliveredAt" in confirmed) || !confirmed.deliveredAt) throw new Error("Delivery confirmation time is missing");
  const deadline = new Date(confirmed.deliveredAt.getTime() + REFUND_WINDOW_DAYS * 86400000);
  check("reconfirming delivery preserves the refund-window deadline", recent.code === "BAD_REQUEST" && recent.message.includes(deadline.toISOString()));
  const waiting = await finance.admin.reconciliation();
  const undelivered = waiting.payouts.find((p) => p.id === payout.id)?.availability;
  const refundWindow = waiting.payouts.find((p) => p.id === recentPayout.id)?.availability;
  check("reconciliation counts both blocked payouts once, with the enforced refund deadline",
    undelivered?.label === "Awaiting delivery" && undelivered.eligibleAt === null && refundWindow?.label === "Refund window open" &&
    refundWindow.eligibleAt?.getTime() === deadline.getTime() && waiting.heldCount === baseline.heldCount + 2 &&
    waiting.heldCents === baseline.heldCents + payout.netCents + recentPayout.netCents);
  check("a blocked release posts no payout notice or audit entry",
    await prisma.sellerMessage.count({ where: { payoutId: recentPayout.id } }) === 0 &&
    await prisma.auditLogEntry.count({ where: { subjectId: recentPayout.id, action: "payout.release" } }) === 0);
  const scan = { provider: "test", providerEventId: id("payout-scan"), shipmentId: splitId, status: "delivered", occurredAt: matureDelivery };
  await handleTrackingEvent(scan);
  await handleTrackingEvent({ ...scan, providerEventId: id("repeat-scan"), occurredAt: new Date() });
  check("a replay preserves the carrier's original delivery time",
    (await prisma.shipment.findUniqueOrThrow({ where: { id: splitId } })).deliveredAt?.getTime() === matureDelivery.getTime());
  const aThread = () => callerFor({ identity: `store:${storeA.id}` }).merchant.thread();
  check("before it is paid there is nothing in the thread", (await aThread()).messages.length === 0);
  check("only finance can release a payout", (await outcome(ops.admin.releasePayout({ payoutId: payout.id }))).code === "FORBIDDEN");
  const hold = { payoutId: payout.id, until: new Date(Date.now() + 86400000), reason: "Awaiting reconciliation" };
  const held = await finance.admin.holdPayout(hold);
  check("finance can hold an unpaid payout", held.status === "held" && held.paidAt === null);
  await prisma.order.update({ where: { id: payoutOrderId }, data: { status: "cancelled" } });
  const cancelled = await finance.admin.reconciliation();
  check("a cancelled order is blocked in both the report and the release action",
    cancelled.payouts.find((p) => p.id === payout.id)?.availability.label === "Order cancelled" &&
    cancelled.heldCount === waiting.heldCount && (await release()).code === "BAD_REQUEST");
  await prisma.order.update({ where: { id: payoutOrderId }, data: { status: "placed" } });
  const ready = await finance.admin.reconciliation();
  const eligible = ready.payouts.find((p) => p.id === payout.id);
  check("finance can see its manual hold on an eligible payout alongside the remaining blocked total",
    eligible?.holdReason === hold.reason && eligible.availability.label === "Eligible for release" &&
    ready.heldCount === baseline.heldCount + 1 && ready.heldCents === baseline.heldCents + recentPayout.netCents);
  const attempts = await Promise.all([release(), release()]);
  const paidAt = attempts.find((attempt) => attempt.code === "ok")?.value?.paidAt;
  const afterRelease = await finance.admin.reconciliation();
  check("a paid payout is labelled paid and excluded from blocked funds",
    afterRelease.payouts.find((p) => p.id === payout.id)?.availability.label === "Paid" &&
    afterRelease.heldCount === ready.heldCount && afterRelease.heldCents === ready.heldCents);
  check("exactly one concurrent release succeeds", Boolean(paidAt) && attempts.some((attempt) => attempt.code === "BAD_REQUEST"),
    attempts.map(({ code, message }) => `${code} ${message}`).join(" / "));
  const th = await aThread();
  const msg = th.messages[0];
  check("the seller has one new message", th.messages.length === 1 && th.unread === 1);
  check("it carries the amount, the date and the order", msg?.kind === "payout" && msg.amountCents === 8501 && Boolean(msg.paidOn) && msg.orderRefs.length === 1 && msg.orderRefs[0] === `#${payout.orderId.slice(-4).toUpperCase()}`, JSON.stringify(msg));
  check("in plain words", /\$85\.01/.test(msg!.body) && /sent on/.test(msg!.body) && msg!.body.includes(msg!.orderRefs[0]!) && !msg!.body.includes("!"), msg!.body);
  check("another seller's thread has nothing", (await callerFor({ identity: `store:${storeB.id}` }).merchant.thread()).messages.length === 0);
  check("a buyer cannot read a seller's thread", (await outcome(callerFor({ identity: `buyer:${buyerOwner.id}` }).merchant.thread())).code === "UNAUTHORIZED");
  check("paying the same payout again is refused", (await outcome(finance.admin.releasePayout({ payoutId: payout.id }))).code === "BAD_REQUEST");
  check("a paid payout cannot be held again", (await outcome(finance.admin.holdPayout(hold))).code === "BAD_REQUEST");
  const settled = await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
  check("the ledger and notice keep the original payment time", Boolean(paidAt) && settled.status === "released" && settled.heldUntil === null && settled.paidAt?.getTime() === paidAt?.getTime() && msg?.paidOn?.getTime() === paidAt?.getTime());
  const audit = await prisma.auditLogEntry.findMany({ where: { subjectType: "payout", subjectId: payout.id } });
  check("only the successful hold and release are audited", audit.length === 2 && audit.some((entry) => entry.action === "payout.hold") && audit.some((entry) => entry.action === "payout.release" && (entry.before as { status?: string })?.status === "held"));
  check("and does not post a second message", (await prisma.sellerMessage.count({ where: { payoutId: payout.id } })) === 1);
  const merchantThread = callerFor({ identity: `store:${storeA.id}` }).merchant;
  await merchantThread.markThreadRead({ ids: [msg!.id] });
  check("opening the thread marks it read", (await aThread()).unread === 0);

  const createdAt = new Date(msg!.createdAt.getTime() + 1000);
  const notices = Array.from({ length: 201 }, (_, index) => ({
    id: id(`notice-${String(index).padStart(3, "0")}`),
    storeId: storeA.id, kind: "licence_expired", body: `Notice ${index}`, createdAt, orderRefs: [],
  }));
  await prisma.sellerMessage.createMany({ data: notices });
  const latest = await aThread();
  check("a long thread opens on the newest notices and counts all unread messages",
    latest.messages.length === 200 && latest.messages[0]?.id === notices[1]?.id &&
    latest.messages.at(-1)?.id === notices.at(-1)?.id && latest.unread === 201);
  const older = await merchantThread.thread({ before: latest.nextBefore!, limit: 200 });
  check("older messages with the same timestamp are reachable once, in order",
    older.messages.length === 2 && older.messages[0]?.id === msg?.id &&
    older.messages[1]?.id === notices[0]?.id && older.nextBefore === null);
  const other = await prisma.sellerMessage.create({ data: {
    storeId: storeB.id, kind: "licence_expired", body: "Separate shop", orderRefs: [],
  } });
  const arrival = await prisma.sellerMessage.create({ data: {
    storeId: storeA.id, kind: "licence_expired", body: "Just arrived", orderRefs: [], createdAt: new Date(createdAt.getTime() + 1),
  } });
  const pageIds = latest.messages.map((m) => m.id);
  const read = await merchantThread.markThreadRead({ ids: pageIds });
  const retry = await merchantThread.markThreadRead({ ids: [pageIds[0]!, other.id] });
  const preview = await merchantThread.thread({ limit: 1 });
  check("reading a page preserves older unread history and concurrent arrivals",
    read.marked === 200 && preview.unread === 2 && preview.messages[0]?.id === arrival.id && preview.messages[0]?.unread === true);
  check("a repeated acknowledgement cannot read another shop's message",
    retry.marked === 0 && (await prisma.sellerMessage.findUniqueOrThrow({ where: { id: other.id } })).readAt === null);

  console.log("\n=== carrier corrections follow the seller's payouts ===");
  const correction = { storeId: storeB.id, shipmentId: pendingParcelId, carrierReference: id("carrier-b"),
    amountCents: 1300, declaredWeightOz: 16, actualWeightOz: 32, reason: "Carrier reweighed the parcel" };
  check("finance cannot assign a parcel correction to another seller",
    (await outcome(finance.admin.recordChargeback({ ...correction, storeId: storeA.id }))).code === "BAD_REQUEST");
  const charge = await finance.admin.recordChargeback(correction);
  await handleTrackingEvent({ ...scan, providerEventId: id("shop-b-scan"), shipmentId: remainingId });
  const newPayout = (storeId: string, netCents: number) => prisma.payout.create({
    data: { storeId, orderId: payoutOrderId, grossCents: netCents, takeRateBps: 0, fulfilmentFeeCents: 0, netCents },
  });
  const pay = (p: { id: string }) => finance.admin.releasePayout({ payoutId: p.id });
  const unaffected = await pay(await newPayout(storeA.id, 500));
  check("another seller receives their full payout", unaffected.netCents === 500 && unaffected.adjustmentsCents === 0);
  const first = await newPayout(storeB.id, 500);
  const later = await Promise.all([newPayout(storeB.id, 700), newPayout(storeB.id, 700)]);
  const beforeSettlement = await finance.admin.reconciliation();
  const openAdjustment = beforeSettlement.adjustments.find((a) => a.id === charge.id);
  check("finance sees the open carrier reference and full outstanding amount",
    openAdjustment?.carrierReference === correction.carrierReference && openAdjustment.appliedCents === 0 &&
    openAdjustment.remainingCents === 1300 && !openAdjustment.settled);
  const reduced = await pay(first);
  const chargeRow = () => prisma.carrierAdjustment.findUniqueOrThrow({ where: { id: charge.id } });
  const partial = await chargeRow();
  const afterPartial = await finance.admin.reconciliation();
  const partialAdjustment = afterPartial.adjustments.find((a) => a.id === charge.id);
  check("partial recovery lowers unpaid payouts without increasing cash paid",
    afterPartial.sellerUnpaidCents === beforeSettlement.sellerUnpaidCents - 500 && afterPartial.sellerPaidCents === beforeSettlement.sellerPaidCents &&
    partialAdjustment?.appliedCents === 500 && partialAdjustment.remainingCents === 800 && !partialAdjustment.settled);
  const note = await prisma.sellerMessage.findUniqueOrThrow({ where: { payoutId: first.id } });
  check("a small payout covers part of the correction and carries the remainder",
    reduced.netCents === 0 && reduced.adjustmentsCents === 500 && partial.appliedCents === 500 && partial.settledPayoutId === null);
  check("the seller sees the deduction and zero balance", note.amountCents === 0 && note.body.includes("$5.00") && !note.body.includes("was sent"));
  const shopMessages = await callerFor({ identity: `store:${storeB.id}` }).merchant.thread();
  check("the payout card includes the deducted amount", shopMessages.messages.find((m) => m.id === note.id)?.adjustmentsCents === 500);
  check("a release retry cannot deduct twice", (await outcome(pay(first))).code === "BAD_REQUEST" && (await chargeRow()).appliedCents === 500);
  const paid = await Promise.all(later.map(pay));
  const closed = await chargeRow();
  check("concurrent payouts deduct the outstanding 800 cents exactly once",
    paid.reduce((sum, p) => sum + p.adjustmentsCents, 0) === 800 && paid.reduce((sum, p) => sum + p.netCents, 0) === 600 &&
    closed.appliedCents === 1300 && paid.some((p) => p.id === closed.settledPayoutId && p.netCents === 600));
  const releases = await prisma.auditLogEntry.findMany({ where: { action: "payout.release", subjectId: { in: [first.id, ...paid.map((p) => p.id)] } } });
  check("each release audits its share of the correction", releases.length === 3 && releases.every((entry) => {
    const [part] = (entry.after as { deductions: { adjustmentId: string; cents: number }[] }).deductions;
    return part?.adjustmentId === charge.id && part.cents === [reduced, ...paid].find((p) => p.id === entry.subjectId)?.adjustmentsCents;
  }));
  const finalReport = await finance.admin.reconciliation();
  const settledAdjustment = finalReport.adjustments.find((a) => a.id === charge.id);
  check("settled corrections leave zero outstanding and paid totals include only the released net",
    settledAdjustment?.settled === true && settledAdjustment.appliedCents === 1300 && settledAdjustment.remainingCents === 0 &&
    finalReport.sellerUnpaidCents === beforeSettlement.sellerUnpaidCents - 1900 &&
    finalReport.sellerPaidCents === beforeSettlement.sellerPaidCents + 600 &&
    finalReport.sellerNetCents === finalReport.sellerPaidCents + finalReport.sellerUnpaidCents);
  check("deductions reconcile with gross sales", finalReport.reconciliationDriftCents === beforeSettlement.reconciliationDriftCents);

  console.log("\n=== refund responsibility on unpaid seller payouts ===");
  const sellerBalance = await newPayout(storeA.id, 550);
  const otherBalance = await newPayout(storeB.id, 450);
  const refundHold = "Refund needs finance review";
  const refundFunding = (status: string) => prisma.payment.update({ where: { id: funding.id }, data: { status } });
  const refundData = { buyerId: buyerOwner.id, orderId: payoutOrderId, reason: "damaged", status: "auto_approved" };
  async function refundDenied(balance: { id: string }) {
    const result = await outcome(pay(balance));
    const report = await finance.admin.reconciliation();
    const state = report.payouts.find((p) => p.id === balance.id)?.availability;
    return result.code === "BAD_REQUEST" && result.message === refundHold &&
      state?.blocked === true && state.label === refundHold && state.eligibleAt === null;
  }
  await refundFunding("partially_refunded");
  check("a partial refund without an issued claim holds both sellers", await refundDenied(sellerBalance) && await refundDenied(otherBalance));
  await refundFunding("succeeded");
  const splitRefund = await prisma.refundClaim.create({ data: {
    ...refundData, amountCents: 1000, shipmentId: splitId,
  } });
  check("a payout waits while an approved refund is being issued", await refundDenied(sellerBalance));
  await prisma.refundClaim.update({ where: { id: splitRefund.id }, data: { refundedAt: new Date() } });
  check("an issued refund with unresolved responsibility holds its seller even when payment still says succeeded",
    await refundDenied(sellerBalance));
  await refundFunding("partially_refunded");
  const recovered = (cents: number) => finance.admin.resolveRefundClaim({
    claimId: splitRefund.id, decision: "approve", recoveryTarget: "seller", recoveredCents: cents,
  });
  await recovered(400);
  const incomplete = (await finance.admin.refundClaims()).find((c) => c.id === splitRefund.id);
  check("partial seller recovery stays in the finance queue and holds only the affected split-order payout",
    incomplete?.recoveredCents === 400 && await refundDenied(sellerBalance) && (await pay(otherBalance)).netCents === 450);
  check("blocked refund releases leave the payout amount, audit and merchant notice untouched",
    (await prisma.payout.findUniqueOrThrow({ where: { id: sellerBalance.id } })).updatedAt.getTime() === sellerBalance.updatedAt.getTime() &&
    await prisma.sellerMessage.count({ where: { payoutId: sellerBalance.id } }) === 0 &&
    await prisma.auditLogEntry.count({ where: { subjectId: sellerBalance.id, action: "payout.release" } }) === 0);
  check("finance cannot reduce recorded recovery or recover more than the refund",
    (await outcome(recovered(300))).code === "BAD_REQUEST" && (await outcome(recovered(1001))).code === "BAD_REQUEST");
  await recovered(1000);
  check("recording the outstanding recovery audits one approval and two recovery totals",
    await prisma.auditLogEntry.count({ where: { subjectId: splitRefund.id, action: "refund.approve" } }) === 1 &&
    await prisma.auditLogEntry.count({ where: { subjectId: splitRefund.id, action: "refund.recovery_recorded" } }) === 2);
  check("completed seller recovery clears the finance queue and permits ordinary payout release",
    !(await finance.admin.refundClaims()).some((c) => c.id === splitRefund.id) && (await pay(sellerBalance)).netCents === 550);
  const fullA = await newPayout(storeA.id, 300);
  const fullB = await newPayout(storeB.id, 200);
  await refundFunding("refunded");
  check("an incompletely accounted full refund holds both unpaid sellers", await refundDenied(fullA) && await refundDenied(fullB));
  const legacyRefund = await prisma.refundClaim.create({ data: { ...refundData, amountCents: 7000, refundedAt: new Date() } });
  await prisma.refundClaim.create({ data: { ...refundData, amountCents: 2000, shipmentId: remainingId, recoveryTarget: "carrier", refundedAt: new Date() } });
  check("an order-only refund of unknown responsibility holds both sellers even when all amounts match",
    await refundDenied(fullA) && await refundDenied(fullB));
  await finance.admin.resolveRefundClaim({ claimId: legacyRefund.id, decision: "approve", recoveryTarget: "platform" });
  check("carrier and platform liabilities on a fully refunded order leave both seller payouts releasable",
    (await pay(fullA)).netCents === 300 && (await pay(fullB)).netCents === 200);

  console.log("\n=== See all payouts: a fresh link, made on request, never stored ===");
  const asked2: string[] = [];
  let n = 0;
  setPayoutDashboard({ loginLink: async (accountId) => (asked2.push(accountId), { url: `https://dashboard.test/${accountId}/${++n}` }) });
  const sellerA = callerFor({ identity: `store:${storeA.id}` });
  const l1 = await sellerA.merchant.payoutDashboardLink();
  const l2 = await sellerA.merchant.payoutDashboardLink();
  check("the link is made for the signed-in shop's own account", asked2.every((a) => a === "acct_SGNA1") && l1.url.includes("acct_SGNA1"));
  check("each request makes a new link (single-use links are not reused)", l1.url !== l2.url);
  const storeJson = JSON.stringify(await prisma.store.findUniqueOrThrow({ where: { id: storeA.id } })) + JSON.stringify(await prisma.sellerMessage.findMany({ where: { storeId: storeA.id } }));
  check("no link is kept anywhere", !storeJson.includes("dashboard.test"));
  const noAccount = await outcome(callerFor({ identity: `store:${storeB.id}` }).merchant.payoutDashboardLink());
  check("a shop with no payout account is told so, and nothing is requested for it", noAccount.code === "BAD_REQUEST" && asked2.length === 2, noAccount.message);
  check("someone who is not signed in as a shop gets nowhere", (await outcome(anon().merchant.payoutDashboardLink())).code === "UNAUTHORIZED" && (await outcome(callerFor({ identity: `buyer:${buyerOwner.id}` }).merchant.payoutDashboardLink())).code === "UNAUTHORIZED");

  console.log("\n=== the number a shop signs in with: set by staff, audited, ends old sessions ===");
  const phoneStart = new Date();
  const bSession = await issueUserSession({ kind: "store", storeId: storeB.id });
  check("before the change, the shop's session works", (await resolveUserSession(bSession.token))?.storeId === storeB.id);
  const NEW = "+15555550142";
  check("a catalogue reviewer cannot set it", (await outcome(reviewer.admin.setStoreOwnerPhone({ id: storeB.id, phone: NEW, reason: "x" }))).code === "FORBIDDEN");
  check("a seller cannot set it for themselves", (await outcome(callerFor({ identity: `store:${storeB.id}` }).admin.setStoreOwnerPhone({ id: storeB.id, phone: NEW, reason: "x" }))).code !== "ok");
  check("a reason is required", (await outcome(ops.admin.setStoreOwnerPhone({ id: storeB.id, phone: NEW, reason: "  " }))).code === "BAD_REQUEST");
  check("and a real number", (await outcome(ops.admin.setStoreOwnerPhone({ id: storeB.id, phone: "12345", reason: "x" }))).code === "BAD_REQUEST");
  check("another shop's number cannot be taken over", (await outcome(ops.admin.setStoreOwnerPhone({ id: storeB.id, phone: PHONE.a, reason: "x" }))).code === "CONFLICT");
  check("none of that changed anything", (await prisma.store.findUniqueOrThrow({ where: { id: storeB.id } })).ownerPhone === PHONE.b && (await resolveUserSession(bSession.token)) !== null);
  const changed = await outcome(ops.admin.setStoreOwnerPhone({ id: storeB.id, phone: "(555) 555-0142", reason: "Owner replaced their phone; checked ID on a call" }));
  check("operations sets it", changed.code === "ok" && changed.value?.ownerPhoneLast4 === "0142" && changed.value?.sessionsEnded >= 1, JSON.stringify(changed.value));
  check("every session the shop had is ended", (await resolveUserSession(bSession.token)) === null);
  const phoneAudit = await prisma.auditLogEntry.findMany({ where: { action: "store.owner_phone_change", subjectId: storeB.id, createdAt: { gte: phoneStart } } });
  check("it is audited with who, why, and the old and new number", phoneAudit.length === 1 && phoneAudit[0]!.actorEmail === "ops@afrimart.test" && /checked ID/.test(phoneAudit[0]!.note ?? "") && (phoneAudit[0]!.before as { ownerPhone?: string })?.ownerPhone === PHONE.b && (phoneAudit[0]!.after as { ownerPhone?: string })?.ownerPhone === NEW);
  // this number was texted earlier in the run; clear the resend wait so the check is about the number, not the clock
  await prisma.authCode.deleteMany({ where: { identifier: PHONE.b } });
  const smsBeforeOld = sms.sent.length;
  await anon().userAuth.requestStoreCode({ phone: PHONE.b });
  check("the old number no longer reaches the shop: no text is sent to it", sms.sent.slice(smsBeforeOld).every((m) => m.to !== PHONE.b));
  await anon().userAuth.requestStoreCode({ phone: NEW });
  check("the new number does", sms.sent.at(-1)?.to === NEW);
  const newCookies: string[] = [];
  const viaNew = await outcome(anon(newCookies).userAuth.verifyStoreCode({ phone: NEW, code: lastSmsCode() }));
  check("and signs in to that shop", viaNew.code === "ok" && (await callerFor({ rawToken: cookieToken(newCookies, "store")! }).merchant.me()).name === "SGN b");
  check("the store list shows only the last four digits", (await ops.admin.stores()).find((s) => s.id === storeB.id)?.ownerPhoneLast4 === "0142" && !JSON.stringify(await ops.admin.stores()).includes(NEW));
} finally {
  await sweep();
  await prisma.$disconnect();
}

console.log(failures === 0 ? "\nAll sign-in, private-photo and payout checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
