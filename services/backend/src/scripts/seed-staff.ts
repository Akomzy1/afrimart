/**
 * Creates the four demo staff accounts, one per role, so the console and its
 * tests have something to sign in as. Separate from the catalogue seed on
 * purpose: credentials are not demo data and should never be created by a
 * routine `prisma db seed` on an environment that matters.
 *
 * Run with: npm run seed:staff --workspace=@afrimart/backend
 */
import { generateSecret } from "otplib";
import { prisma } from "../db.js";
import { hashPassword } from "../auth/password.js";
import type { StaffRole } from "@prisma/client";


/**
 * Refuse to run anywhere that looks like production.
 *
 * This script mints working credentials with a known password. The failure
 * mode is not subtle: pointed at production it creates four accounts an
 * attacker can read off a public repository. Three independent checks, and
 * an explicit override that has to be typed out in full, because a guard
 * that is easy to switch off is a comment.
 */
function refuseIfProduction() {
  if (process.env.ALLOW_STAFF_SEED === "yes-create-real-credentials") return;

  const url = process.env.DATABASE_URL ?? "";
  const host = (() => { try { return new URL(url).hostname; } catch { return ""; } })();
  const localHosts = ["localhost", "127.0.0.1", "::1", "host.docker.internal", "postgres", "db"];

  const reasons: string[] = [];
  if (process.env.NODE_ENV === "production") reasons.push("NODE_ENV is production");
  if (host && !localHosts.includes(host)) reasons.push(`database host "${host}" is not local`);
  if (/\b(prod|production|live)\b/i.test(url)) reasons.push("DATABASE_URL names a production database");

  if (reasons.length) {
    console.error("Refusing to seed staff accounts:");
    for (const r of reasons) console.error("  - " + r);
    console.error("These are real credentials with a known password.");
    console.error("Override only if you are certain: ALLOW_STAFF_SEED=yes-create-real-credentials");
    process.exit(1);
  }
}

refuseIfProduction();
const PASSWORD = process.env.STAFF_SEED_PASSWORD ?? "ops-demo-password";

const PEOPLE: { email: string; name: string; role: StaffRole }[] = [
  { email: "reviewer@afrimart.test", name: "Catalogue Reviewer", role: "catalogue_reviewer" },
  { email: "ops@afrimart.test", name: "Operations", role: "operations" },
  { email: "finance@afrimart.test", name: "Finance", role: "finance" },
  { email: "admin@afrimart.test", name: "Admin", role: "admin" },
];

const passwordHash = await hashPassword(PASSWORD);

for (const p of PEOPLE) {
  const secret = generateSecret();
  const user = await prisma.staffUser.upsert({
    where: { email: p.email },
    update: {},
    create: { ...p, passwordHash, mfaSecret: secret, mfaEnrolledAt: new Date() },
  });
  console.log(`${p.role.padEnd(20)} ${p.email}  mfaSecret=${user.mfaSecret}`);
}
console.log(`\npassword for all four: ${PASSWORD}`);
await prisma.$disconnect();
