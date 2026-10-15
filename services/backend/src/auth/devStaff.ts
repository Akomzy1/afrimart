import type { StaffRole } from "@prisma/client";
import { DevOnlyRefused, productionSignals } from "../runtime.js";

/**
 * Staff accounts that exist only so a browser test can sign in to the
 * operations console: a known password and a known authenticator secret.
 *
 * Both are written here, in a public repository, so anyone can sign in as these
 * accounts anywhere they exist. That is why three things hold:
 *
 *   1. They cannot be created outside development. `assertCanSeedDevStaff`
 *      checks the same signals as every other development stand-in and, unlike
 *      them, ignores the override that exists for staging: there is no
 *      environment where a known-secret staff account is acceptable except a
 *      developer's machine.
 *   2. They cannot be used outside development. Sign-in and session lookup both
 *      refuse an address in this domain unless the environment looks local, so
 *      a copy of one that reached a real database is still no way in.
 *   3. Their address is in a domain no real person has (`dev.afrimart.test`),
 *      so they are obvious in any list of staff.
 */

export const DEV_STAFF_DOMAIN = "dev.afrimart.test";
export const DEV_STAFF_PASSWORD = "dev-only-staff-password";
/** Base32, 160 bits, fixed so a test can compute the current code. */
export const DEV_STAFF_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

export const DEV_STAFF: { email: string; name: string; role: StaffRole }[] = [
  { email: `admin@${DEV_STAFF_DOMAIN}`, name: "Dev Admin", role: "admin" },
  { email: `reviewer@${DEV_STAFF_DOMAIN}`, name: "Dev Reviewer", role: "catalogue_reviewer" },
  { email: `finance@${DEV_STAFF_DOMAIN}`, name: "Dev Finance", role: "finance" },
];

export function isDevOnlyStaffEmail(email: string): boolean {
  return email.toLowerCase().endsWith(`@${DEV_STAFF_DOMAIN}`);
}

/** Throws unless this looks like a development machine. No override is honoured. */
export function assertCanSeedDevStaff(env: NodeJS.ProcessEnv = process.env): void {
  const reasons = productionSignals({ ...env, ALLOW_DEV_ONLY_STAND_INS: undefined });
  if (reasons.length) throw new DevOnlyRefused(reasons);
}

/** True when a dev-only account must be refused here: it is one, and this is not a development machine. */
export function devStaffRefusedHere(email: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return isDevOnlyStaffEmail(email) && productionSignals({ ...env, ALLOW_DEV_ONLY_STAND_INS: undefined }).length > 0;
}
