/**
 * Creates the dev-only staff accounts the operations console's browser test
 * signs in with (see auth/devStaff.ts): an admin, a catalogue reviewer and a
 * finance user, all with one known password and one known authenticator secret.
 *
 *   npm run seed:dev-staff --workspace=@afrimart/backend
 *
 * Refuses to run outside development, with no override. Safe to run again: it
 * resets the password, the secret and any lockout on these accounts, so a test
 * that locked one out can be recovered by running this.
 */
import { prisma } from "../db.js";
import { hashPassword } from "../auth/password.js";
import { DEV_STAFF, DEV_STAFF_PASSWORD, DEV_STAFF_TOTP_SECRET, assertCanSeedDevStaff } from "../auth/devStaff.js";

try {
  assertCanSeedDevStaff();
} catch (e) {
  console.error("Refusing to create dev-only staff accounts:");
  for (const r of (e as { reasons?: string[] }).reasons ?? [String(e)]) console.error(`  - ${r}`);
  console.error("These accounts have a password and authenticator secret that are public. There is no override.");
  process.exit(1);
}

const passwordHash = await hashPassword(DEV_STAFF_PASSWORD);
for (const p of DEV_STAFF) {
  const data = {
    name: p.name,
    role: p.role,
    passwordHash,
    mfaSecret: DEV_STAFF_TOTP_SECRET,
    mfaEnrolledAt: new Date(),
    failedLoginAttempts: 0,
    failedMfaAttempts: 0,
    lockedUntil: null,
    disabledAt: null,
  };
  await prisma.staffUser.upsert({ where: { email: p.email }, update: data, create: { email: p.email, ...data } });
  console.log(`${p.role.padEnd(20)} ${p.email}`);
}
console.log(`\npassword for all: ${DEV_STAFF_PASSWORD}\nauthenticator secret (base32): ${DEV_STAFF_TOTP_SECRET}`);
await prisma.$disconnect();
