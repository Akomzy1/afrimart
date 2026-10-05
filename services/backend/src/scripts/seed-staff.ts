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
