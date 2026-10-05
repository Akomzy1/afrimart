import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { hashPassword, verifyPassword } from "./password.js";
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
