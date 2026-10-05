/**
 * Live access-control check against the running API.
 *
 * The unit tests prove the *shape* of the rules; this proves the server
 * actually enforces them over HTTP, which is the only thing an attacker
 * interacts with. Run with the backend up:
 *   npm run verify:auth --workspace=@afrimart/backend
 */
import { generateSync } from "otplib";
import { prisma } from "../db.js";

const API = "http://localhost:4000/trpc";

type Result = { ok: boolean; status: number; code?: string; message?: string };

async function call(path: string, opts: { token?: string; input?: unknown; mutation?: boolean }): Promise<Result> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const url = opts.mutation
    ? `${API}/${path}`
    : `${API}/${path}${opts.input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify(opts.input))}`}`;
  const res = await fetch(url, {
    method: opts.mutation ? "POST" : "GET",
    headers,
    body: opts.mutation ? JSON.stringify(opts.input ?? {}) : undefined,
  });
  const body = (await res.json()) as { error?: { message?: string; data?: { code?: string } } };
  return { ok: !body.error, status: res.status, code: body.error?.data?.code, message: body.error?.message };
}

async function signIn(email: string): Promise<string> {
  const user = await prisma.staffUser.findUniqueOrThrow({ where: { email } });
  const first = await fetch(`${API}/staffAuth.signIn`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: process.env.STAFF_SEED_PASSWORD ?? "ops-demo-password" }),
  });
  const token = (await first.json()).result.data.token as string;
  const code = generateSync({ secret: user.mfaSecret! });
  const second = await fetch(`${API}/staffAuth.verifyMfa`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, code }),
  });
  const verified = await second.json();
  if (verified.error) throw new Error(`MFA failed for ${email}: ${verified.error.message}`);
  return token;
}

const OPS_ROUTES: { path: string; mutation?: boolean; input?: unknown }[] = [
  { path: "admin.reviewQueue", input: { includeResolved: false } },
  { path: "admin.stores" },
  { path: "admin.fulfilment" },
  { path: "admin.graph", input: {} },
  { path: "admin.reconciliation" },
  { path: "admin.refundClaims" },
  { path: "admin.auditLog", input: {} },
];

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`${pass ? "  ok  " : "  FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

console.log("=== 1. every ops route rejects an unauthenticated request ===");
for (const r of OPS_ROUTES) {
  const res = await call(r.path, { input: r.input, mutation: r.mutation });
  check(r.path, !res.ok && res.code === "UNAUTHORIZED", res.ok ? "ANSWERED WITHOUT A TOKEN" : res.code);
}

console.log("\n=== 2. a password-only session (no MFA) reaches nothing ===");
const halfRes = await fetch(`${API}/staffAuth.signIn`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "admin@afrimart.test", password: process.env.STAFF_SEED_PASSWORD ?? "ops-demo-password" }),
});
const halfToken = (await halfRes.json()).result.data.token as string;
for (const r of OPS_ROUTES.slice(0, 3)) {
  const res = await call(r.path, { token: halfToken, input: r.input });
  check(`${r.path} with un-verified session`, !res.ok && res.code === "UNAUTHORIZED", res.code);
}

console.log("\n=== 3. a bad token is rejected ===");
const bogus = await call("admin.stores", { token: "not-a-real-token" });
check("admin.stores with a forged token", !bogus.ok && bogus.code === "UNAUTHORIZED", bogus.code);

console.log("\n=== 4. roles are denied what they shouldn't reach ===");
const reviewer = await signIn("reviewer@afrimart.test");
const finance = await signIn("finance@afrimart.test");
const ops = await signIn("ops@afrimart.test");

const matrix: { who: string; token: string; path: string; input?: unknown; mutation?: boolean; allowed: boolean }[] = [
  { who: "reviewer", token: reviewer, path: "admin.reviewQueue", input: { includeResolved: false }, allowed: true },
  { who: "reviewer", token: reviewer, path: "admin.reconciliation", allowed: false },
  { who: "reviewer", token: reviewer, path: "admin.refundClaims", allowed: false },
  { who: "reviewer", token: reviewer, path: "admin.stores", allowed: false },
  {
    who: "reviewer",
    token: reviewer,
    path: "admin.releasePayout",
    input: { payoutId: "whatever" },
    mutation: true,
    allowed: false,
  },
  { who: "finance", token: finance, path: "admin.reconciliation", allowed: true },
  { who: "finance", token: finance, path: "admin.reviewQueue", input: { includeResolved: false }, allowed: false },
  {
    who: "finance",
    token: finance,
    path: "admin.approveDraft",
    input: { id: "x", canonicalProductId: "y", priceCents: 100 },
    mutation: true,
    allowed: false,
  },
  { who: "operations", token: ops, path: "admin.stores", allowed: true },
  { who: "operations", token: ops, path: "admin.reconciliation", allowed: true },
  {
    who: "operations",
    token: ops,
    path: "admin.holdPayout",
    input: { payoutId: "x", until: new Date().toISOString(), reason: "test" },
    mutation: true,
    allowed: false,
  },
];

for (const m of matrix) {
  const res = await call(m.path, { token: m.token, input: m.input, mutation: m.mutation });
  // An allowed route may still fail on its own input validation; what matters
  // is that it is not refused for lack of permission.
  const denied = res.code === "FORBIDDEN" || res.code === "UNAUTHORIZED";
  check(`${m.who} -> ${m.path} (${m.allowed ? "allowed" : "denied"})`, m.allowed ? !denied : denied, res.code ?? "ok");
}

console.log("\n=== 5. an audited action writes a log entry ===");
const store = await prisma.store.findFirstOrThrow({ where: { onboardingStatus: "live" } });
const before = await prisma.auditLogEntry.count();
const suspend = await call("admin.updateStore", {
  token: ops,
  mutation: true,
  input: { id: store.id, onboardingStatus: "suspended" },
});
check("operations can suspend a store", suspend.ok, suspend.message ?? "");
const after = await prisma.auditLogEntry.count();
check("suspension wrote exactly one audit entry", after === before + 1, `${before} -> ${after}`);

const entry = await prisma.auditLogEntry.findFirst({ orderBy: { createdAt: "desc" } });
check("entry records who", entry?.actorEmail === "ops@afrimart.test", entry?.actorEmail ?? "none");
check("entry records what", entry?.action === "store.suspend", entry?.action ?? "none");
check(
  "entry records before and after state",
  Boolean(entry?.before) && Boolean(entry?.after),
  JSON.stringify({ before: entry?.before, after: entry?.after }),
);

// Put it back so repeat runs start clean.
await call("admin.updateStore", { token: ops, mutation: true, input: { id: store.id, onboardingStatus: "live" } });

console.log("\n=== 6. a routine change is not audited ===");
const routineBefore = await prisma.auditLogEntry.count();
await call("admin.updateStore", { token: ops, mutation: true, input: { id: store.id, onboardingStatus: "kit_issued" } });
await call("admin.updateStore", { token: ops, mutation: true, input: { id: store.id, onboardingStatus: "live" } });
const routineAfter = await prisma.auditLogEntry.count();
check("onboarding steps do not flood the trail", routineAfter === routineBefore, `${routineBefore} -> ${routineAfter}`);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
await prisma.$disconnect();
process.exit(failures === 0 ? 0 : 1);
