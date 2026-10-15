import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

/**
 * Who is asking is decided from the signed-in session on the request, and from
 * nothing the caller names. These tests pin the shape of that, since the way it
 * goes wrong is a new endpoint quietly taking "which store am I" as input.
 */

const src = (rel: string) => readFile(new URL(rel, import.meta.url), "utf8");
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("no buyer-facing or merchant-facing endpoint takes an identity as input", () => {
  /** Routers a buyer or a seller can reach. Admin routers act on a named seller by design. */
  const FACING = ["merchant.ts", "checkout.ts", "orders.ts", "claims.ts"];

  test("no input schema in those routers names a buyer or a store", async () => {
    const dir = new URL("./routers/", import.meta.url);
    const present = (await readdir(dir)).filter((f) => FACING.includes(f));
    assert.deepEqual(present.sort(), [...FACING].sort());
    for (const file of present) {
      const text = stripComments(await src(`./routers/${file}`));
      assert.ok(!/\b(buyerId|storeId)\s*:\s*z\./.test(text), `${file} accepts a buyer or store id from the caller`);
      assert.ok(!/\bstoreInput\b/.test(text), `${file} still has the storeId input helper`);
    }
  });

  test("every procedure in those routers is built from the identity-resolving builders", async () => {
    for (const file of FACING) {
      const text = await src(`./routers/${file}`);
      const procedures = [...text.matchAll(/^\s{2}(\w+):\s*(\w+Procedure)\b/gm)];
      assert.ok(procedures.length > 0, file);
      for (const [, name, builder] of procedures) {
        // Checkout's quote and address validation are anonymous by design: they
        // price a basket and name nobody. Everything else must know who is asking.
        const anonymous = file === "checkout.ts" && (name === "quote" || name === "validateAddress");
        if (anonymous) assert.equal(builder, "publicProcedure", `${file}:${name}`);
        else assert.ok(["merchantProcedure", "buyerProcedure"].includes(builder!), `${file}: ${name} uses ${builder}, which does not resolve an identity`);
      }
    }
  });

  test("the identity comes out of the session in the request context and nowhere else", async () => {
    const text = stripComments(await src("./trpc.ts"));
    assert.match(text, /resolveUserSession\(bearer\)/);
    assert.match(text, /resolveUserSession\(sessionCookie\(cookieHeader, "buyer"\)\)/);
    assert.match(text, /resolveUserSession\(sessionCookie\(cookieHeader, "store"\)\)/);
    assert.match(text, /ctx\.sessions\[kind\]/);
    const other = text.replace(/headers\.authorization/g, "").replace(/headers\["user-agent"\]/g, "");
    assert.ok(!/headers\[/.test(other), "trpc.ts reads a request header other than the bearer token and the user agent");
  });

  test("a merchant procedure only reaches a shipment through its own store", async () => {
    const text = await src("./routers/merchant.ts");
    for (const name of ["accept", "markShipped", "packingPhoto"]) {
      const start = text.indexOf(`  ${name}: merchantProcedure`);
      assert.ok(start > -1, `${name} missing`);
      const body = text.slice(start, text.indexOf("\n  }),", start));
      assert.match(body, /storeId: ctx\.storeId/, `${name} can act on another store's shipment`);
    }
  });

  test("a buyer procedure only reaches an order or parcel through its own buyer", async () => {
    const claims = await src("./routers/claims.ts");
    assert.match(claims, /order: \{ buyerId \}/, "ownParcel must scope the parcel to the buyer");
    assert.match(claims, /buyerId: ctx\.buyerId/);
    const orders = await src("./routers/orders.ts");
    assert.match(orders, /where: \{ buyerId/);
  });

  test("checkout.place takes the buyer from the request", async () => {
    const text = await src("./routers/checkout.ts");
    const start = text.indexOf("place: buyerProcedure");
    assert.ok(start > -1);
    const body = text.slice(start, start + 2500);
    assert.match(body, /ctx\.buyerId/);
    assert.ok(!/input\.buyerId/.test(body));
  });

  test("there is no earnings procedure: a seller's earnings live in the AfriMart thread and their payout dashboard", async () => {
    const text = stripComments(await src("./routers/merchant.ts"));
    assert.ok(!/^\s{2}earnings:/m.test(text), "merchant.earnings is back");
    assert.match(text, /^\s{2}payoutDashboardLink:/m);
    assert.match(text, /^\s{2}thread:/m);
  });

  test("the store picker that stood in for sign-in is gone", async () => {
    const text = await src("./routers/merchant.ts");
    assert.ok(!/^\s{2}stores:/m.test(text), "merchant.stores (list every shop to anyone) is back");
    assert.ok(!/devProcedure/.test(text));
  });
});

describe("only the sign-in routes are open to the world", () => {
  test("userAuth has no unauthenticated route besides the code request, the code exchange and sign-out", async () => {
    const text = await src("./routers/userAuth.ts");
    const open = [...text.matchAll(/^\s{2}(\w+):\s*publicProcedure/gm)].map((m) => m[1]).sort();
    assert.deepEqual(open, ["requestBuyerCode", "requestStoreCode", "signOutBuyer", "signOutStore", "verifyBuyerCode", "verifyStoreCode"]);
  });

  test("every public procedure in the buyer-facing and merchant-facing routers is accounted for", async () => {
    const allowed: Record<string, string[]> = {
      "checkout.ts": ["quote", "validateAddress"],
      "catalogue.ts": ["featured", "listingsForProducts", "browse", "facets", "search", "detail"],
      "health.ts": ["ping"],
    };
    for (const [file, names] of Object.entries(allowed)) {
      const text = await src(`./routers/${file}`);
      const open = [...text.matchAll(/^\s{2}(\w+):\s*publicProcedure/gm)].map((m) => m[1]).sort();
      assert.deepEqual(open, [...names].sort(), `${file}: a procedure became public, or one stopped being`);
    }
    for (const file of ["merchant.ts", "orders.ts", "claims.ts"]) {
      assert.ok(!/publicProcedure/.test(stripComments(await src(`./routers/${file}`))), `${file} has a public procedure`);
    }
  });
});
