import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { hashPassword, verifyPassword, needsRehash, SCRYPT_N, SCRYPT_R, SCRYPT_P } from "./password.js";
import { tooManyFromIp, clearIp, resetAllIpLimits } from "./rateLimit.js";
import { decoyHash, isLockedOut } from "./lockout.js";
import { MAX_ATTEMPTS_PER_IP, LOCKOUT_MINUTES } from "../config.js";
import { roleHas, permissionsFor, PERMISSIONS, type Permission } from "./permissions.js";
import { AUDITED_ACTIONS } from "./audit.js";

/**
 * Access-control tests. These are deliberately about the *shape* of the
 * system rather than one route's behaviour: the failure mode for auth is a
 * new route quietly skipping the check, which no per-route test catches.
 */

describe("deny by default", () => {
  test("every admin route requires a named permission", async () => {
    const src = await readFile(new URL("../routers/admin.ts", import.meta.url), "utf8");

    // publicProcedure on an ops route would be unauthenticated access.
    assert.equal(
      (src.match(/publicProcedure/g) ?? []).length,
      0,
      "admin.ts must not use publicProcedure — every route needs staffProcedure(permission)",
    );

    // Every exported procedure must name a permission.
    const procedures = src.match(/^\s{2}[a-zA-Z]+:\s*(staffProcedure\([^)]*\)|publicProcedure)/gm) ?? [];
    assert.ok(procedures.length >= 15, `expected the full admin surface, found ${procedures.length}`);
    for (const p of procedures) {
      assert.match(p, /staffProcedure\("/, `route without a permission: ${p.trim()}`);
    }
  });

  test("the only unauthenticated staff routes are the sign-in handshake", async () => {
    const src = await readFile(new URL("../routers/staffAuth.ts", import.meta.url), "utf8");
    const open = [...src.matchAll(/^\s{2}([a-zA-Z]+):\s*staffAuthProcedure/gm)].map((m) => m[1]).sort();
    assert.deepEqual(
      open,
      ["beginMfaEnrolment", "confirmMfaEnrolment", "signIn", "signOut", "verifyMfa"],
      "an unauthenticated staff route was added outside the sign-in handshake",
    );
  });

  test("no ops route is reachable from the buyer or merchant routers", async () => {
    for (const name of ["catalogue.ts", "checkout.ts", "merchant.ts"]) {
      const src = await readFile(new URL(`../routers/${name}`, import.meta.url), "utf8");
      assert.ok(!src.includes("staffProcedure"), `${name} must not expose staff-gated routes`);
      assert.ok(!/auditLogEntry|staffUser|staffSession/i.test(src), `${name} must not touch staff tables`);
    }
  });
});

describe("role separation", () => {
  test("a catalogue reviewer cannot touch money", () => {
    for (const p of ["finance:read", "finance:write"] as Permission[]) {
      assert.equal(roleHas("catalogue_reviewer", p), false, `reviewer must not hold ${p}`);
    }
  });

  test("a catalogue reviewer cannot change a seller's standing", () => {
    assert.equal(roleHas("catalogue_reviewer", "stores:write"), false);
  });

  test("finance cannot approve catalogue or change onboarding", () => {
    assert.equal(roleHas("finance", "catalogue:write"), false);
    assert.equal(roleHas("finance", "stores:write"), false);
  });

  test("operations can suspend a seller but cannot move money", () => {
    assert.equal(roleHas("operations", "stores:write"), true);
    assert.equal(roleHas("operations", "finance:read"), true, "may look, to chase a problem");
    assert.equal(roleHas("operations", "finance:write"), false, "but may not pay");
  });

  test("admin holds everything, and every permission belongs to some role", () => {
    for (const p of PERMISSIONS) assert.equal(roleHas("admin", p), true, `admin missing ${p}`);
    const held = new Set([
      ...permissionsFor("catalogue_reviewer"),
      ...permissionsFor("operations"),
      ...permissionsFor("finance"),
    ]);
    const orphaned = PERMISSIONS.filter((p) => !held.has(p) && p !== "staff:manage");
    assert.deepEqual(orphaned, [], "a permission no non-admin role can hold is probably a mistake");
  });

  test("every role can identify itself", () => {
    for (const role of ["catalogue_reviewer", "operations", "finance", "admin"] as const) {
      assert.equal(roleHas(role, "console:access"), true, `${role} cannot call me()`);
    }
  });
});

describe("audited actions", () => {
  test("every money or standing change in admin.ts writes an audit entry", async () => {
    const src = await readFile(new URL("../routers/admin.ts", import.meta.url), "utf8");

    // Each of these routes mutates money or a seller's standing.
    const mustAudit = [
      "updateStore",
      "holdPayout",
      "releasePayout",
      "recordChargeback",
      "resolveRefundClaim",
    ];

    for (const name of mustAudit) {
      const start = src.indexOf(`${name}: staffProcedure`);
      assert.ok(start > -1, `${name} is missing from admin.ts`);
      const next = mustAudit
        .map((n) => src.indexOf(`${n}: staffProcedure`))
        .filter((i) => i > start)
        .sort((a, b) => a - b)[0];
      const body = src.slice(start, next === undefined ? undefined : next);
      assert.ok(body.includes("writeAudit("), `${name} changes money or standing without an audit entry`);
    }
  });

  test("audited writes happen inside the same transaction as the change", async () => {
    const src = await readFile(new URL("../routers/admin.ts", import.meta.url), "utf8");
    // Every writeAudit call takes a transaction client as its first argument.
    for (const call of src.match(/writeAudit\(\s*([a-zA-Z]+)/g) ?? []) {
      assert.match(call, /writeAudit\(\s*tx/, `audit written outside a transaction: ${call}`);
    }
  });

  test("the audited action list covers what the brief names", () => {
    for (const needed of [
      "refund.approve",
      "payout.hold",
      "payout.release",
      "chargeback.record",
      "refund.recovery_recorded",
      "store.suspend",
      "store.delist",
    ]) {
      assert.ok((AUDITED_ACTIONS as readonly string[]).includes(needed), `missing audited action: ${needed}`);
    }
  });

  test("nothing edits or deletes the audit log", async () => {
    const dir = new URL("../", import.meta.url);
    const offenders: string[] = [];
    async function walk(d: URL) {
      for (const e of await readdir(d, { withFileTypes: true })) {
        const child = new URL(`${e.name}${e.isDirectory() ? "/" : ""}`, d);
        if (e.isDirectory()) await walk(child);
        else if (e.name.endsWith(".ts")) {
          const text = await readFile(child, "utf8");
          if (/auditLogEntry\.(update|delete|upsert|deleteMany|updateMany)/.test(text)) {
            offenders.push(path.basename(e.name));
          }
        }
      }
    }
    await walk(dir);
    assert.deepEqual(offenders, [], "the audit trail must be append-only");
  });
});

describe("password hashing", () => {
  test("a correct password verifies and a wrong one does not", async () => {
    const hash = await hashPassword("correct horse battery staple");
    assert.equal(await verifyPassword("correct horse battery staple", hash), true);
    assert.equal(await verifyPassword("Correct horse battery staple", hash), false);
  });

  test("the same password hashes differently each time", async () => {
    const a = await hashPassword("same");
    const b = await hashPassword("same");
    assert.notEqual(a, b, "a missing salt would make these identical");
  });

  test("a malformed stored hash fails closed", async () => {
    assert.equal(await verifyPassword("anything", "not-a-hash"), false);
    assert.equal(await verifyPassword("anything", ""), false);
  });
});

describe("scrypt cost", () => {
  test("parameters meet the required floor", () => {
    assert.ok(SCRYPT_N >= 1 << 17, `N must be at least 2^17, got ${SCRYPT_N}`);
    assert.ok(SCRYPT_R >= 8, `r must be at least 8, got ${SCRYPT_R}`);
    assert.ok(SCRYPT_P >= 1, `p must be at least 1, got ${SCRYPT_P}`);
  });

  test("the cost is recorded in the hash so it can be raised later", async () => {
    const hash = await hashPassword("whatever");
    const [tag, n, r, p] = hash.split("$");
    assert.equal(tag, "scrypt");
    assert.equal(Number(n), SCRYPT_N);
    assert.equal(Number(r), SCRYPT_R);
    assert.equal(Number(p), SCRYPT_P);
  });

  test("a hash at a lower cost still verifies, and is flagged for upgrade", async () => {
    // Simulates a password stored before the cost was raised.
    const weak = await (async () => {
      const { scrypt } = await import("node:crypto");
      const { promisify } = await import("node:util");
      const run = promisify(scrypt) as (pw: string, salt: string, len: number, o: object) => Promise<Buffer>;
      const salt = "a".repeat(32);
      const key = await run("legacy", salt, 64, { N: 1 << 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
      return `scrypt$${1 << 14}$8$1$${salt}$${key.toString("hex")}`;
    })();

    assert.equal(await verifyPassword("legacy", weak), true, "old hashes must keep working");
    assert.equal(needsRehash(weak), true, "but must be marked for upgrade");
    assert.equal(needsRehash(await hashPassword("current")), false);
  });

  test("a legacy hash still verifies, so the cost change locks nobody out", async () => {
    const { scrypt } = await import("node:crypto");
    const { promisify } = await import("node:util");
    const run = promisify(scrypt) as (pw: string, salt: string, len: number, o: object) => Promise<Buffer>;
    const salt = "b".repeat(32);
    const key = await run("ancient", salt, 64, { N: 1 << 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    const legacy = salt + ":" + key.toString("hex");

    assert.equal(await verifyPassword("ancient", legacy), true, "must still work");
    assert.equal(await verifyPassword("wrong", legacy), false);
    assert.equal(needsRehash(legacy), true, "and must be upgraded on next sign-in");
  });

  test("garbage in the hash column fails closed", async () => {
    assert.equal(await verifyPassword("x", "not-a-hash"), false);
    assert.equal(await verifyPassword("x", ""), false);
  });
});

describe("rate limiting and lockout", () => {
  test("the per-IP ceiling trips and is cleared on success", () => {
    resetAllIpLimits();
    const ip = "198.51.100.7";
    let tripped = -1;
    for (let i = 0; i < MAX_ATTEMPTS_PER_IP + 5; i++) {
      if (tooManyFromIp(ip) && tripped === -1) tripped = i;
    }
    assert.ok(tripped > 0, "the limiter must trip");
    assert.equal(tripped, MAX_ATTEMPTS_PER_IP, `expected to trip on attempt ${MAX_ATTEMPTS_PER_IP}`);
    clearIp(ip);
    assert.equal(tooManyFromIp(ip), false, "a successful sign-in clears the address");
    resetAllIpLimits();
  });

  test("addresses are counted separately", () => {
    resetAllIpLimits();
    for (let i = 0; i < MAX_ATTEMPTS_PER_IP + 2; i++) tooManyFromIp("203.0.113.1");
    assert.equal(tooManyFromIp("203.0.113.2"), false, "one attacker must not lock everyone out");
    resetAllIpLimits();
  });

  test("lockout is temporary, not permanent", () => {
    assert.ok(LOCKOUT_MINUTES > 0 && LOCKOUT_MINUTES <= 120, "a permanent lock becomes an outage someone disables");
  });

  test("a lock in the past is no longer a lock", () => {
    assert.equal(isLockedOut({ lockedUntil: new Date(Date.now() - 1000) }), false);
    assert.equal(isLockedOut({ lockedUntil: new Date(Date.now() + 60_000) }), true);
    assert.equal(isLockedOut({ lockedUntil: null }), false);
  });

  test("the decoy hash is in the current format, so a miss still costs real work", async () => {
    const decoy = await decoyHash();
    assert.match(decoy, /^scrypt\$/, "a malformed decoy short-circuits and reopens the timing oracle");
    assert.equal(Number(decoy.split("$")[1]), SCRYPT_N);
    assert.equal(await verifyPassword("anything", decoy), false);
  });

  test("both the password and the TOTP step are rate limited", async () => {
    const src = await readFile(new URL("../routers/staffAuth.ts", import.meta.url), "utf8");
    for (const step of ["signIn", "verifyMfa"]) {
      const start = src.indexOf(`${step}: staffAuthProcedure`);
      assert.ok(start > -1, `${step} missing`);
      const body = src.slice(start, start + 2200);
      assert.ok(body.includes("tooManyFromIp"), `${step} has no per-IP ceiling`);
      assert.ok(
        body.includes("recordFailure") || body.includes("isLockedOut"),
        `${step} has no per-account counter — a 6-digit code is brute-forceable without one`,
      );
    }
  });
});

describe("staff seed safety", () => {
  test("the seed refuses production and says why", async () => {
    const src = await readFile(new URL("../scripts/seed-staff.ts", import.meta.url), "utf8");
    assert.ok(src.includes("refuseIfProduction()"), "the guard must actually be called");
    assert.ok(src.includes("NODE_ENV"), "checks the environment");
    assert.ok(src.includes("localHosts"), "checks the database host");
    assert.ok(src.includes("ALLOW_STAFF_SEED"), "has an explicit override");
    // The override must be awkward enough that nobody sets it by reflex.
    assert.ok(src.includes("yes-create-real-credentials"));
  });
});

describe("audit trail is append-only in the database", () => {
  test("the migration installs a trigger, not only a revoke", async () => {
    const dir = new URL("../../prisma/migrations/", import.meta.url);
    const names = await readdir(dir);
    let sql = "";
    for (const n of names) {
      try {
        sql += await readFile(new URL(`${n}/migration.sql`, dir), "utf8");
      } catch {
        /* not a migration directory */
      }
    }
    assert.match(sql, /CREATE TRIGGER audit_log_append_only/i, "no append-only trigger found");
    assert.match(sql, /BEFORE UPDATE OR DELETE ON "AuditLogEntry"/i);
    // A revoke alone would not stop the superuser this app connects as.
    assert.match(sql, /RAISE EXCEPTION/i, "the trigger must refuse, not merely log");
  });
});
