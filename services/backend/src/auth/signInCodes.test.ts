import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { normaliseEmail, normalisePhone } from "./signInCodes.js";
import { SIGN_IN_CODE_MAX_GUESSES, SIGN_IN_CODE_MINUTES, SIGN_IN_CODES_PER_HOUR, USER_SESSION_ABSOLUTE_DAYS, USER_SESSION_IDLE_DAYS } from "../config.js";

const src = (rel: string) => readFile(new URL(rel, import.meta.url), "utf8");

describe("who a code is for", () => {
  test("emails are trimmed and lower-cased, so one address is one account", () => {
    assert.equal(normaliseEmail("  Amara@Example.COM "), "amara@example.com");
    for (const bad of ["", "amara", "amara@", "@example.com", "a b@example.com", "amara@example", `${"a".repeat(250)}@example.com`]) {
      assert.equal(normaliseEmail(bad), null, JSON.stringify(bad));
    }
  });

  test("a US number in any common form becomes one E.164 number, so one phone is one shop", () => {
    for (const form of ["(555) 123-4567", "555 123 4567", "555.123.4567", "5551234567", "1 555 123 4567", "+1 (555) 123-4567", "+15551234567"]) {
      assert.equal(normalisePhone(form), "+15551234567", form);
    }
    assert.equal(normalisePhone("+44 20 7946 0958"), "+442079460958");
    for (const bad of ["", "12345", "555123", "abcdefghij", "+1", "(555) 123-45678901234"]) {
      assert.equal(normalisePhone(bad), null, JSON.stringify(bad));
    }
  });
});

describe("the limits are tight enough to matter", () => {
  test("a code is short-lived, few guesses are allowed, and requests are paced", () => {
    assert.ok(SIGN_IN_CODE_MINUTES <= 15, "a code should not live longer than a quarter of an hour");
    assert.ok(SIGN_IN_CODE_MAX_GUESSES <= 5, "five wrong guesses at six digits is already one in two hundred thousand");
    assert.ok(SIGN_IN_CODES_PER_HOUR <= 10);
  });

  test("a signed-in buyer or store is not signed in for ever", () => {
    assert.ok(USER_SESSION_IDLE_DAYS <= 60);
    assert.ok(USER_SESSION_ABSOLUTE_DAYS <= 180);
    assert.ok(USER_SESSION_IDLE_DAYS <= USER_SESSION_ABSOLUTE_DAYS);
  });
});

describe("how a code is kept and checked", () => {
  test("codes are six digits from a cryptographic source", async () => {
    const text = await src("./signInCodes.ts");
    assert.match(text, /randomInt\(0, 1_000_000\)/);
    assert.ok(!/Math\.random/.test(text), "a sign-in code must not come from Math.random");
  });

  test("only a salted hash is stored, and it is compared in constant time", async () => {
    const text = await src("./signInCodes.ts");
    assert.match(text, /codeHash: hashCode\(salt, code\)/);
    assert.match(text, /timingSafeEqual/);
    assert.ok(!/codeHash:\s*code\b/.test(text), "the plain code is being stored");
  });

  test("guesses are counted atomically before the comparison, and a code is spent by one conditional update", async () => {
    const text = await src("./signInCodes.ts");
    assert.match(text, /attempts: \{ increment: 1 \}/);
    assert.ok(text.indexOf("attempts: { increment: 1 }") < text.indexOf("timingSafeEqual("), "count the guess before checking it");
    assert.match(text, /updateMany\(\{ where: \{ id: live\.id, consumedAt: null \}/);
  });

  test("an unknown shop gets the same answer as a known one: the code row is written either way", async () => {
    const text = await src("./signInCodes.ts");
    const create = text.indexOf("tx.authCode.create");
    const suppress = text.indexOf("if (!delivery.deliver) return");
    assert.ok(create > -1 && suppress > create, "the pacing row must exist even when no message is delivered");
    assert.match(text, /pg_advisory_xact_lock/, "concurrent sends must share the same pacing lock");
  });

  test("the code is never logged or returned to the client", async () => {
    for (const f of ["./signInCodes.ts", "../routers/userAuth.ts"]) {
      const text = await src(f);
      assert.ok(!/console\.|log\.(info|debug|warn)\(/.test(text), `${f} logs`);
    }
    const router = await src("../routers/userAuth.ts");
    assert.ok(!/return \{[^}]*\bcode\b[^}]*\}/.test(router.replace(/input\.code/g, "")), "a code is returned to the caller");
  });
});
