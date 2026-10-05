import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { ScryptOptions } from "node:crypto";

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/**
 * Password hashing for staff accounts.
 *
 * scrypt from the standard library rather than bcrypt or argon2: memory-hard,
 * no native build, and a native module that fails to compile is a dependency
 * that quietly gets swapped for something weaker.
 *
 * COST. N = 2^17, r = 8, p = 1. Node's *defaults* are N = 2^14, which is what
 * this file used before and was too low. At 2^17 a single hash costs roughly
 * 1.5s and 128 MB on this hardware, so `maxmem` has to be raised above its
 * 32 MB default or scrypt refuses outright.
 *
 * That cost cuts both ways: it is the point against offline cracking, but it
 * also makes the sign-in endpoint a resource amplifier — one request holding
 * 128 MB for 1.5s. The rate limiting in staffAuth.ts is therefore a capacity
 * control as much as an auth control, not an optional extra.
 *
 * Parameters are stored in the hash, so raising the cost later re-hashes
 * on next sign-in instead of invalidating every existing password.
 * Format: scrypt$N$r$p$salt$key — all but the tag in hex.
 */

export const SCRYPT_N = Number(process.env.SCRYPT_N ?? 1 << 17);
export const SCRYPT_R = Number(process.env.SCRYPT_R ?? 8);
export const SCRYPT_P = Number(process.env.SCRYPT_P ?? 1);

const KEY_LENGTH = 64;
const SALT_BYTES = 16;

/** 128 * N * r, plus headroom. Below this, scrypt throws rather than degrades. */
function maxmemFor(n: number, r: number): number {
  return 128 * n * r * 2;
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES).toString("hex");
  const derived = await scrypt(plain, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: maxmemFor(SCRYPT_N, SCRYPT_R),
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${derived.toString("hex")}`;
}

/**
 * Constant-time comparison. A plain `===` would leak how much of the hash
 * matched through timing — the classic way a careful hash choice is undone by
 * its verifier.
 */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  // Legacy "salt:key" hashes, written before the cost was versioned, with
  // Node's default parameters. Still accepted so that raising the cost does
  // not lock out every existing account — `needsRehash` flags them and
  // `verifyAndMaybeRehash` upgrades them on the next successful sign-in. A
  // password-format change that logs everyone out is a bad migration.
  if (!stored.startsWith("scrypt$") && stored.includes(":")) {
    const [salt, keyHex] = stored.split(":");
    if (!salt || !keyHex) return false;
    const expected = Buffer.from(keyHex, "hex");
    if (expected.length === 0) return false;
    try {
      const actual = await scrypt(plain, salt, expected.length, { N: 1 << 14, r: 8, p: 1, maxmem: maxmemFor(1 << 14, 8) });
      return expected.length === actual.length && timingSafeEqual(expected, actual);
    } catch {
      return false;
    }
  }

  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, nRaw, rRaw, pRaw, salt, keyHex] = parts;
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p) || !salt || !keyHex) return false;

  const expected = Buffer.from(keyHex, "hex");
  if (expected.length === 0) return false;

  try {
    const actual = await scrypt(plain, salt, expected.length, { N, r, p, maxmem: maxmemFor(N, r) });
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
  } catch {
    // Unreadable parameters in a stored hash fail closed rather than throwing
    // a 500 that distinguishes a corrupt record from a wrong password.
    return false;
  }
}

/** True when a stored hash predates the current cost and should be upgraded. */
export function needsRehash(stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return true;
  return Number(parts[1]) < SCRYPT_N || Number(parts[2]) < SCRYPT_R;
}
