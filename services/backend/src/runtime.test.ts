import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { DevOnlyRefused, assertDevOnlyAllowed, isDevelopment, productionSignals } from "./runtime.js";
import { FileSmsSender, defaultSmsSender } from "./notifications/senders.js";
import { LocalRefundIssuer } from "./payments/refunds.js";
import { LocalPayoutDashboard } from "./payments/dashboard.js";

const dev = { NODE_ENV: "development", DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/afrimart" } as NodeJS.ProcessEnv;
const src = (rel: string) => readFile(new URL(rel, import.meta.url), "utf8");

describe("development-only stand-ins refuse to run against production", () => {
  test("a development machine is allowed", () => {
    assert.deepEqual(productionSignals(dev), []);
    assert.equal(isDevelopment(dev), true);
    assert.doesNotThrow(() => assertDevOnlyAllowed(dev));
  });

  test("NODE_ENV=production is refused", () => {
    assert.throws(() => assertDevOnlyAllowed({ ...dev, NODE_ENV: "production" }), DevOnlyRefused);
  });

  test("a database that is not local is refused", () => {
    const env = { ...dev, DATABASE_URL: "postgresql://u:p@db.example.railway.app:5432/afrimart" };
    assert.ok(productionSignals(env).some((r) => /not local/.test(r)));
    assert.throws(() => assertDevOnlyAllowed(env), DevOnlyRefused);
  });

  test("a database URL that names production is refused even on a local host", () => {
    const env = { ...dev, DATABASE_URL: "postgresql://u:p@localhost:5432/afrimart_production" };
    assert.ok(productionSignals(env).some((r) => /production database/.test(r)));
  });

  test("every reason is reported, not just the first", () => {
    const env = { NODE_ENV: "production", DATABASE_URL: "postgresql://u:p@prod.example.com/live" } as NodeJS.ProcessEnv;
    assert.equal(productionSignals(env).length, 3);
  });

  test("the override has to be typed out in full; a truthy value does not work", () => {
    const prod = { ...dev, NODE_ENV: "production" };
    for (const flag of ["true", "1", "yes", "ALLOW", "yes-run-the-stand-ins"]) {
      assert.throws(() => assertDevOnlyAllowed({ ...prod, ALLOW_DEV_ONLY_STAND_INS: flag }), DevOnlyRefused, flag);
    }
    assert.doesNotThrow(() => assertDevOnlyAllowed({ ...prod, ALLOW_DEV_ONLY_STAND_INS: "yes-run-the-stand-ins-here" }));
  });
});

describe("every stand-in checks the guard itself", () => {
  const prod = { NODE_ENV: "production", DATABASE_URL: "postgresql://u:p@prod.example.com/live" };

  test("the local refund issuer, payout dashboard and SMS file sender all refuse in production", async () => {
    const saved = { ...process.env };
    Object.assign(process.env, prod);
    try {
      await assert.rejects(new LocalRefundIssuer().issue({ claimId: "c", orderId: "o", amountCents: 100 }), DevOnlyRefused);
      await assert.rejects(new LocalPayoutDashboard().loginLink("acct_123"), DevOnlyRefused);
      await assert.rejects(new FileSmsSender().send({ to: "+15555550100", body: "x" }), DevOnlyRefused);
    } finally {
      for (const k of Object.keys(prod)) delete process.env[k];
      Object.assign(process.env, saved);
    }
  });

  test("outside development, with no Twilio configured, SMS is off rather than written to a file", () => {
    const sender = defaultSmsSender(prod as NodeJS.ProcessEnv);
    assert.equal(sender.enabled, false);
    assert.equal(sender.name, "disabled-pending-10dlc");
  });

  test("Twilio is used only when configured and switched on", () => {
    const base = { ...prod, TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t", TWILIO_FROM_NUMBER: "+15555550100" } as NodeJS.ProcessEnv;
    assert.equal(defaultSmsSender(base).name, "disabled-pending-10dlc", "configured but not switched on (10DLC pending)");
    assert.equal(defaultSmsSender({ ...base, SMS_ENABLED: "yes" }).name, "twilio");
    assert.equal(defaultSmsSender({ ...base, SMS_ENABLED: "true" }).name, "disabled-pending-10dlc", "only the exact value counts");
  });

  test("no module still reads the old dev identity header or the removed stub", async () => {
    for (const f of ["./trpc.ts", "./server.ts", "./routers/merchant.ts", "./routers/checkout.ts", "./routers/orders.ts", "./routers/claims.ts"]) {
      const text = await src(f);
      assert.ok(!/x-dev-identity|resolveIdentity|devProcedure|DEV_IDENTITY/i.test(text), `${f} still refers to the dev identity stub`);
    }
  });
});
