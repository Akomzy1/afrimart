import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { PHOTO_URL_TTL_SECONDS } from "../config.js";
import { isDevelopment } from "../runtime.js";
import { PHOTO_KINDS, type PhotoKind } from "./photos.js";

/**
 * Who may see an evidence photo, and how a browser is allowed to fetch it.
 *
 * Photos are private: licence documents, and claim photos that can show a
 * buyer's address, sit behind two checks. First a procedure decides the caller
 * is allowed to see this particular photo (the store that packed it, the buyer
 * who filed it, a staff member whose role permits and whose view is audited).
 * Only then does it hand back a link signed for that one file and good for a few
 * minutes. The picture route (server.ts) serves nothing without a valid
 * signature, so a link that leaks, or is pasted into a chat, stops working on
 * its own and the stored path in the database is useless without one.
 *
 * The signing secret has to be set outside development. On a development
 * machine one is made up per process, so links die on restart, which is fine.
 */

let devSecret: string | null = null;

function secret(): string {
  const configured = process.env.PHOTO_URL_SECRET;
  if (configured && configured.length >= 32) return configured;
  if (!isDevelopment()) {
    throw new Error("PHOTO_URL_SECRET (32 or more characters) must be set before photos can be served here.");
  }
  devSecret ??= randomBytes(32).toString("hex");
  return devSecret;
}

/** Called at start-up so a missing secret stops the server there, not on the first photo. */
export function assertPhotoSigningConfigured(): void {
  secret();
}

const mac = (kind: string, name: string, exp: number) =>
  createHmac("sha256", secret()).update(`${kind}/${name}.${exp}`).digest("hex");

const PATH = /^\/photos\/([a-z]+)\/([a-f0-9]{32}\.jpg)$/;

/** Split a stored path (`/photos/<kind>/<name>`) into its parts, or null if it is not one. */
export function parsePhotoPath(path: string): { kind: PhotoKind; name: string } | null {
  const m = PATH.exec(path);
  return m && (PHOTO_KINDS as readonly string[]).includes(m[1]!) ? { kind: m[1] as PhotoKind, name: m[2]! } : null;
}

/**
 * A stored photo path as a link to fetch it now: `/photos/<kind>/<name>?exp=…&sig=…`.
 * Null in, null out, so a row with no photo needs no special case. Call this
 * only after deciding the caller may see the photo.
 */
export function signedPhotoUrl(path: string | null | undefined, opts: { ttlSeconds?: number; now?: number } = {}): string | null {
  if (!path) return null;
  const parts = parsePhotoPath(path);
  if (!parts) return null;
  const exp = Math.floor((opts.now ?? Date.now()) / 1000) + (opts.ttlSeconds ?? PHOTO_URL_TTL_SECONDS);
  return `/photos/${parts.kind}/${parts.name}?exp=${exp}&sig=${mac(parts.kind, parts.name, exp)}`;
}

/** True only for an unexpired signature made for exactly this file. */
export function photoLinkIsValid(kind: string, name: string, exp: string | undefined, sig: string | undefined, now = Date.now()): boolean {
  if (!exp || !sig || !/^\d{1,12}$/.test(exp) || !/^[a-f0-9]{64}$/.test(sig)) return false;
  if (!(PHOTO_KINDS as readonly string[]).includes(kind) || !/^[a-f0-9]{32}\.jpg$/.test(name)) return false;
  const expires = Number(exp);
  if (expires * 1000 <= now) return false;
  const given = Buffer.from(sig, "hex");
  const expected = Buffer.from(mac(kind, name, expires), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
