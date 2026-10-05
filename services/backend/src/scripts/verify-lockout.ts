/**
 * Live check that lockout and the append-only trail hold over HTTP.
 * Run with the backend up: npm run verify:lockout --workspace=@afrimart/backend
 */
import { generateSync } from "otplib";
import { prisma } from "../db.js";
import { MAX_LOGIN_ATTEMPTS, MAX_MFA_ATTEMPTS } from "../config.js";

const API = "http://localhost:4000/trpc";
const EMAIL = "reviewer@afrimart.test";
const PASSWORD = process.env.STAFF_SEED_PASSWORD ?? "ops-demo-password";

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`${pass ? "  ok  " : "  FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

async function post(path: string, body: unknown) {
  const res = await fetch(`${API}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { error?: { message?: string; data?: { code?: string } }; result?: { data?: unknown } };
  return { code: json.error?.data?.code, message: json.error?.message, data: json.result?.data as never };
}

const unlock = () =>
  prisma.staffUser.update({
    where: { email: EMAIL },
    data: { failedLoginAttempts: 0, failedMfaAttempts: 0, lockedUntil: null },
  });

console.log("=== password attempts lock the account ===");
await unlock();
let lockedAt = -1;
for (let i = 1; i <= MAX_LOGIN_ATTEMPTS + 2; i++) {
  const r = await post("staffAuth.signIn", { email: EMAIL, password: "wrong-password" });
  if (r.code === "TOO_MANY_REQUESTS" && lockedAt === -1) lockedAt = i;
}
check(`locks out by attempt ${MAX_LOGIN_ATTEMPTS + 1}`, lockedAt > 0 && lockedAt <= MAX_LOGIN_ATTEMPTS + 1, `locked at ${lockedAt}`);

const afterLock = await post("staffAuth.signIn", { email: EMAIL, password: PASSWORD });
check("the correct password is refused while locked", afterLock.code === "TOO_MANY_REQUESTS", afterLock.code);

const row = await prisma.staffUser.findUniqueOrThrow({ where: { email: EMAIL } });
check("lockedUntil is set and in the future", Boolean(row.lockedUntil && row.lockedUntil > new Date()));
check("lockout is temporary", Boolean(row.lockedUntil && row.lockedUntil.getTime() - Date.now() < 2 * 3600_000));

console.log("\n=== clearing the lock restores access ===");
await unlock();
const ok = await post("staffAuth.signIn", { email: EMAIL, password: PASSWORD });
check("correct password works once unlocked", Boolean(ok.data), ok.code ?? "ok");
const token = (ok.data as { token?: string } | undefined)?.token;

console.log("\n=== TOTP attempts lock too ===");
await unlock();
let mfaLocked = -1;
for (let i = 1; i <= MAX_MFA_ATTEMPTS + 2; i++) {
  const r = await post("staffAuth.verifyMfa", { token, code: "000000" });
  if (r.code === "TOO_MANY_REQUESTS" && mfaLocked === -1) mfaLocked = i;
}
check(`a 6-digit code cannot be brute-forced`, mfaLocked > 0, `locked at attempt ${mfaLocked}`);

console.log("\n=== a wrong password does not reveal whether the account exists ===");
await unlock();
const unknown = await post("staffAuth.signIn", { email: "nobody@afrimart.test", password: "wrong-password" });
const known = await post("staffAuth.signIn", { email: EMAIL, password: "wrong-password" });
check("same error for unknown and known addresses", unknown.message === known.message, `${unknown.message} / ${known.message}`);

console.log("\n=== the audit trail cannot be edited, even by the app ===");
const entry = await prisma.auditLogEntry.findFirst();
if (entry) {
  let blockedUpdate = false;
  let blockedDelete = false;
  try {
    await prisma.$executeRawUnsafe(`UPDATE "AuditLogEntry" SET note='tampered' WHERE id=$1`, entry.id);
  } catch {
    blockedUpdate = true;
  }
  try {
    await prisma.$executeRawUnsafe(`DELETE FROM "AuditLogEntry" WHERE id=$1`, entry.id);
  } catch {
    blockedDelete = true;
  }
  check("UPDATE is refused by the database", blockedUpdate);
  check("DELETE is refused by the database", blockedDelete);
  const after = await prisma.auditLogEntry.findUnique({ where: { id: entry.id } });
  check("the entry is untouched", after?.note === entry.note);
} else {
  console.log("  --    no audit rows yet; run verify:auth first");
}

await unlock();
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
await prisma.$disconnect();
process.exit(failures === 0 ? 0 : 1);
