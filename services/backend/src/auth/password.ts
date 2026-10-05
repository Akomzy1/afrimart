import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

/**
 * Password hashing for staff accounts.
 *
 * Uses Node's built-in scrypt rather than adding bcrypt or argon2. scrypt is
 * memory-hard, is in the standard library, and needs no native build — which
 * matters because a native module that fails to compile is a dependency that
 * gets quietly swapped for something weaker. The cost parameters below are the
 * thing to revisit, not the algorithm choice.
 *
 * Stored as "salt:derivedKey", both hex.
 */

const KEY_LENGTH = 64;
const SALT_BYTES = 16;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES).toString("hex");
  const derived = await scrypt(plain, salt, KEY_LENGTH);
  return `${salt}:${derived.toString("hex")}`;
}

/**
 * Constant-time comparison. A plain `===` here would leak how much of the
 * hash matched through timing, which is the classic way a careful hash choice
 * gets undone by its verifier.
 */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const [salt, keyHex] = stored.split(":");
  if (!salt || !keyHex) return false;
  const expected = Buffer.from(keyHex, "hex");
  const actual = await scrypt(plain, salt, expected.length);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
