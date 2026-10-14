import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

import {
  DEV_IDENTITY_HEADER,
  DevIdentityRefused,
  assertDevIdentityAllowed,
  parseDevIdentity,
  productionSignals,
  resolveIdentity,
} from "./identity.js";

const src = (rel: string) => readFile(new URL(rel, import.meta.url), "utf8");

const dev = { NODE_ENV: "development", DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/afrimart" } as NodeJS.ProcessEnv;

/** A stand-in database that knows exactly one buyer and one store. */
const db = {
  buyer: { findUnique: async ({ where }: { where: { id: string } }) => (where.id === "b1" ? { id: "b1" } : null) },
  store: { findUnique: async ({ where }: { where: { id: string } }) => (where.id === "s1" ? { id: "s1" } : null) },
};

describe("the dev identity stub refuses to run against production", () => {
  test("a development machine is allowed", () => {
    assert.deepEqual(productionSignals(dev), []);
    assert.doesNotThrow(() => assertDevIdentityAllowed(dev));
  });

  test("NODE_ENV=production is refused", () => {
    assert.throws(() => assertDevIdentityAllowed({ ...dev, NODE_ENV: "production" }), DevIdentityRefused);
  });

  test("a database that is not local is refused", () => {
    const env = { ...dev, DATABASE_URL: "postgresql://u:p@db.example.railway.app:5432/afrimart" };
    assert.ok(productionSignals(env).some((r) => /not local/.test(r)));
    assert.throws(() => assertDevIdentityAllowed(env), DevIdentityRefused);
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
    for (const flag of ["true", "1", "yes", "ALLOW", "yes-trust-the-client"]) {
      assert.throws(() => assertDevIdentityAllowed({ ...prod, ALLOW_DEV_IDENTITY: flag }), DevIdentityRefused, flag);
    }
    assert.doesNotThrow(() => assertDevIdentityAllowed({ ...prod, ALLOW_DEV_IDENTITY: "yes-trust-the-client-header" }));
  });

  test("the resolver itself refuses, so no caller can skip the check", async () => {
    await assert.rejects(
      resolveIdentity({ [DEV_IDENTITY_HEADER]: "buyer:b1" }, "buyer", { db, env: { ...dev, NODE_ENV: "production" } }),
      DevIdentityRefused,
    );
  });
});

describe("the single resolver", () => {
  const env = dev;

  test("a known buyer resolves from the header", async () => {
    assert.equal(await resolveIdentity({ [DEV_IDENTITY_HEADER]: "buyer:b1" }, "buyer", { db, env }), "b1");
  });

  test("a known store resolves from the header", async () => {
    assert.equal(await resolveIdentity({ [DEV_IDENTITY_HEADER]: "store:s1" }, "store", { db, env }), "s1");
  });

  test("no header means not signed in", async () => {
    assert.equal(await resolveIdentity({}, "buyer", { db, env }), null);
  });

  test("an id that does not exist gets nowhere", async () => {
    assert.equal(await resolveIdentity({ [DEV_IDENTITY_HEADER]: "buyer:made-up" }, "buyer", { db, env }), null);
    assert.equal(await resolveIdentity({ [DEV_IDENTITY_HEADER]: "store:made-up" }, "store", { db, env }), null);
  });

  test("a buyer identity cannot act as a store, or the reverse", async () => {
    assert.equal(await resolveIdentity({ [DEV_IDENTITY_HEADER]: "buyer:b1" }, "store", { db, env }), null);
    assert.equal(await resolveIdentity({ [DEV_IDENTITY_HEADER]: "store:s1" }, "buyer", { db, env }), null);
  });

  test("malformed values are rejected", () => {
    for (const bad of ["", "buyer", "buyer:", ":b1", "admin:b1", "buyer:b1;DROP", "buyer: b1 x", "buyer:" + "a".repeat(65)]) {
      assert.equal(parseDevIdentity(bad, "buyer"), null, JSON.stringify(bad));
    }
    assert.equal(parseDevIdentity(["buyer:b1"], "buyer"), null, "repeated headers are not accepted");
    assert.equal(parseDevIdentity(undefined, "buyer"), null);
  });
});

describe("no buyer-facing or merchant-facing endpoint takes an identity as input", () => {
  /** Routers a buyer or a seller can reach. Admin routers act on a named seller by design. */
  const FACING = ["merchant.ts", "checkout.ts", "orders.ts", "claims.ts"];

  test("no input schema in those routers names a buyer or a store", async () => {
    const dir = new URL("./routers/", import.meta.url);
    const present = (await readdir(dir)).filter((f) => FACING.includes(f));
    assert.ok(present.includes("merchant.ts") && present.includes("checkout.ts"));
    for (const file of present) {
      const text = (await src(`./routers/${file}`)).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      assert.ok(!/\b(buyerId|storeId)\s*:\s*z\./.test(text), `${file} accepts a buyer or store id from the caller`);
      assert.ok(!/\bstoreInput\b/.test(text), `${file} still has the storeId input helper`);
    }
  });

  test("every procedure in those routers is built from the identity-resolving builders", async () => {
    for (const file of ["merchant.ts", "checkout.ts"]) {
      const text = await src(`./routers/${file}`);
      const procedures = [...text.matchAll(/^\s{2}(\w+):\s*(\w+Procedure)\b/gm)];
      assert.ok(procedures.length > 0);
      for (const [, name, builder] of procedures) {
        // Checkout's quote and address validation are anonymous by design: they
        // price a basket and name nobody. Everything else must know who is asking.
        const anonymous = file === "checkout.ts" && (name === "quote" || name === "validateAddress");
        if (anonymous) {
          assert.equal(builder, "publicProcedure", `${file}:${name}`);
        } else {
          assert.ok(
            ["merchantProcedure", "buyerProcedure", "devProcedure"].includes(builder!),
            `${file}: ${name} uses ${builder}, which does not resolve an identity`,
          );
        }
      }
    }
  });

  test("a merchant procedure only reaches a shipment through its own store", async () => {
    const text = await src("./routers/merchant.ts");
    for (const name of ["accept", "markShipped"]) {
      const start = text.indexOf(`  ${name}: merchantProcedure`);
      assert.ok(start > -1, `${name} missing`);
      const body = text.slice(start, text.indexOf("\n  }),", start));
      assert.match(body, /storeId: ctx\.storeId/, `${name} can act on another store's shipment`);
    }
  });

  test("checkout.place takes the buyer from the request", async () => {
    const text = await src("./routers/checkout.ts");
    const start = text.indexOf("place: buyerProcedure");
    assert.ok(start > -1);
    const body = text.slice(start, start + 2500);
    assert.match(body, /ctx\.buyerId/);
    assert.ok(!/input\.buyerId/.test(body));
  });

  test("the store picker, a stand-in for sign-in, is development-only", async () => {
    const text = await src("./routers/merchant.ts");
    assert.match(text, /stores: devProcedure/);
  });
});
