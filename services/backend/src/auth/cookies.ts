import type { UserKind } from "@prisma/client";
import { isDevelopment } from "../runtime.js";

/**
 * Where a buyer's or a shop's session token lives in the browser: an httpOnly
 * cookie set by this API, and nowhere a page's JavaScript can read it.
 *
 * - HttpOnly: no script on the page can read the token, so a cross-site-
 *   scripting bug cannot steal a session.
 * - Secure: sent only over HTTPS. (On a development machine over plain http it
 *   is left off so Safari and Firefox work; Chrome would accept it on localhost.)
 * - SameSite=Strict by default: the browser sends the cookie only on requests
 *   made by a page on the same site as the API. Pages on app.afrimart.com and
 *   sell.afrimart.com calling api.afrimart.com are the same site, so this holds.
 *   `SESSION_COOKIE_SAMESITE=lax` or `none` exists for a layout where it does
 *   not (see docs/plans/cookie-sessions.md); `none` needs Secure.
 * - Host-only (no Domain), Path=/, and with Secure the `__Host-` prefix, which
 *   makes the browser refuse a cookie of that name set any other way.
 * - One cookie per kind of account. A person can be a buyer and a shop owner in
 *   the same browser; the two sessions must not overwrite each other, and a
 *   buyer's cookie must never be mistaken for a shop's.
 */

export type SameSite = "Strict" | "Lax" | "None";

export function cookieSecure(env: NodeJS.ProcessEnv = process.env): boolean {
  return !isDevelopment(env);
}

export function cookieSameSite(env: NodeJS.ProcessEnv = process.env): SameSite {
  const v = (env.SESSION_COOKIE_SAMESITE ?? "strict").toLowerCase();
  const same: SameSite = v === "lax" ? "Lax" : v === "none" ? "None" : "Strict";
  if (same === "None" && !cookieSecure(env)) throw new Error("SESSION_COOKIE_SAMESITE=none needs a Secure cookie, which needs HTTPS.");
  return same;
}

export function cookieName(kind: UserKind, env: NodeJS.ProcessEnv = process.env): string {
  return `${cookieSecure(env) ? "__Host-" : ""}afrimart_${kind}`;
}

/** Cookie header -> name/value pairs. Values are taken as sent; a token is opaque base64url. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 1) continue;
    const name = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (name && !(name in out)) out[name] = value; // the first one wins, as browsers send the most specific first
  }
  return out;
}

/** The session token a request carries for this kind of account, if any. */
export function sessionCookie(header: string | undefined, kind: UserKind, env: NodeJS.ProcessEnv = process.env): string | null {
  const v = parseCookies(header)[cookieName(kind, env)];
  return v && /^[A-Za-z0-9_-]{20,200}$/.test(v) ? v : null;
}

function attributes(env: NodeJS.ProcessEnv): string[] {
  return ["Path=/", "HttpOnly", `SameSite=${cookieSameSite(env)}`, ...(cookieSecure(env) ? ["Secure"] : [])];
}

/** The Set-Cookie value that signs this kind of account in, ending when the session does. */
export function setSessionCookie(kind: UserKind, token: string, expiresAt: Date, env: NodeJS.ProcessEnv = process.env): string {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  return [`${cookieName(kind, env)}=${token}`, ...attributes(env), `Max-Age=${maxAge}`, `Expires=${expiresAt.toUTCString()}`].join("; ");
}

/** The Set-Cookie value that removes it. */
export function clearSessionCookie(kind: UserKind, env: NodeJS.ProcessEnv = process.env): string {
  return [`${cookieName(kind, env)}=`, ...attributes(env), "Max-Age=0", "Expires=Thu, 01 Jan 1970 00:00:00 GMT"].join("; ");
}
