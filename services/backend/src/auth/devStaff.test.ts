import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { generateSync } from "otplib";

import {
  DEV_STAFF,
  DEV_STAFF_DOMAIN,
  DEV_STAFF_PASSWORD,
  DEV_STAFF_TOTP_SECRET,
  assertCanSeedDevStaff,
  devStaffRefusedHere,
  isDevOnlyStaffEmail,
} from "./devStaff.js";
import { DevOnlyRefused } from "../runtime.js";

const src = (rel: string) => readFile(new URL(rel, import.meta.url), "utf8");
const dev = { NODE_ENV: "development", DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/afrimart" } as NodeJS.ProcessEnv;
const prod = { NODE_ENV: "production", DATABASE_URL: "postgresql://u:p@db.example.com:5432/afrimart" } as NodeJS.ProcessEnv;
const OVERRIDE = "yes-run-the-stand-ins-here";

describe("dev-only staff accounts exist only on a development machine", () => {
  test("seeding is allowed locally", () => {
    assert.doesNotThrow(() => assertCanSeedDevStaff(dev));
  });

  test("seeding is refused for production signals, each on its own", () => {
    assert.throws(() => assertCanSeedDevStaff({ ...dev, NODE_ENV: "production" }), DevOnlyRefused);
    assert.throws(() => assertCanSeedDevStaff({ ...dev, DATABASE_URL: "postgresql://u:p@db.railway.app:5432/afrimart" }), DevOnlyRefused);
    assert.throws(() => assertCanSeedDevStaff({ ...dev, DATABASE_URL: "postgresql://u:p@localhost:5432/afrimart_production" }), DevOnlyRefused);
  });

  test("and no override, in any form, makes it acceptable", () => {
    for (const env of [prod, { ...prod, ALLOW_DEV_ONLY_STAND_INS: OVERRIDE }, { ...prod, ALLOW_STAFF_SEED: "yes-create-real-credentials" }]) {
      assert.throws(() => assertCanSeedDevStaff(env as NodeJS.ProcessEnv), DevOnlyRefused);
    }
  });

  test("a dev-only account is refused wherever production signals are present, override or not", () => {
    const email = `admin@${DEV_STAFF_DOMAIN}`;
    assert.equal(devStaffRefusedHere(email, dev), false);
    assert.equal(devStaffRefusedHere(email, prod), true);
    assert.equal(devStaffRefusedHere(email, { ...prod, ALLOW_DEV_ONLY_STAND_INS: OVERRIDE } as NodeJS.ProcessEnv), true);
    assert.equal(devStaffRefusedHere("ops@afrimart.test", prod), false, "a real account is not touched by this rule");
    assert.equal(devStaffRefusedHere("someone@example.com", prod), false);
  });

  test("the domain test cannot be dodged by case or by a look-alike", () => {
    assert.equal(isDevOnlyStaffEmail(`ADMIN@${DEV_STAFF_DOMAIN.toUpperCase()}`), true);
    assert.equal(isDevOnlyStaffEmail(`admin@${DEV_STAFF_DOMAIN}.evil.example`), false);
    assert.equal(isDevOnlyStaffEmail(`admin@x${DEV_STAFF_DOMAIN}`), false, "only the exact domain, not a suffix of another");
  });
});

describe("what a test can rely on", () => {
  test("the secret is valid base32 and a current code can be computed from it", () => {
    assert.match(DEV_STAFF_TOTP_SECRET, /^[A-Z2-7]{32}$/);
    assert.match(generateSync({ secret: DEV_STAFF_TOTP_SECRET }), /^\d{6}$/);
  });

  test("there is one account per role the console's views need, all in the dev domain", () => {
    assert.deepEqual(DEV_STAFF.map((s) => s.role).sort(), ["admin", "catalogue_reviewer", "finance"]);
    assert.ok(DEV_STAFF.every((s) => isDevOnlyStaffEmail(s.email)));
    assert.ok(DEV_STAFF_PASSWORD.length >= 12);
  });
});

describe("the refusal is applied where staff get in, and the seed script cannot skip it", () => {
  test("sign-in and session lookup both refuse a dev-only account", async () => {
    assert.match(await src("../routers/staffAuth.ts"), /devStaffRefusedHere\(user\.email\)/);
    assert.match(await src("./session.ts"), /devStaffRefusedHere\(session\.staffUser\.email\)/);
  });

  test("the seed script checks first, before it touches the database, and offers no override", async () => {
    const text = await src("../scripts/seed-dev-staff.ts");
    assert.ok(text.indexOf("assertCanSeedDevStaff()") > -1 && text.indexOf("assertCanSeedDevStaff()") < text.indexOf("prisma.staffUser.upsert"));
    assert.ok(!/ALLOW_/.test(text.replace(/\/\*[\s\S]*?\*\//g, "")), "a seed script that reads an override variable has an override");
  });
});
