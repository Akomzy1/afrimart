import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

import { currentLicenceWhere, licenceCounts, licenceState, startOfTodayUtc } from "./licence.js";
import { buildHiddenListingFilter } from "./categoryAccess.js";

const src = (rel: string) => readFile(new URL(rel, import.meta.url), "utf8");
const at = (iso: string) => new Date(iso);
const approved = (expires: string | null) => ({ status: "approved" as const, licenceExpiresOn: expires ? at(`${expires}T00:00:00Z`) : null });

describe("when a licensed-kitchen approval stops counting", () => {
  const now = at("2026-10-15T15:30:00Z");

  test("valid through its expiry date, and not the day after", () => {
    assert.equal(licenceState(approved("2026-10-16"), now), "approved");
    assert.equal(licenceState(approved("2026-10-15"), now), "approved", "on the day itself it still counts");
    assert.equal(licenceState(approved("2026-10-14"), now), "expired", "the day after it does not");
  });

  test("the day turns over at midnight UTC, whatever time it is", () => {
    assert.equal(licenceCounts(approved("2026-10-15"), at("2026-10-15T23:59:59Z")), true);
    assert.equal(licenceCounts(approved("2026-10-15"), at("2026-10-16T00:00:00Z")), false);
    assert.equal(startOfTodayUtc(at("2026-10-15T23:59:59Z")).toISOString(), "2026-10-15T00:00:00.000Z");
  });

  test("an approval recorded before expiry dates were required keeps counting", () => {
    assert.equal(licenceCounts(approved(null), now), true);
  });

  test("only an approval can expire; every other status is left as it is", () => {
    for (const status of ["applied", "rejected", "revoked"] as const) {
      assert.equal(licenceState({ status, licenceExpiresOn: at("2020-01-01T00:00:00Z") }, now), status);
      assert.equal(licenceCounts({ status, licenceExpiresOn: at("2099-01-01T00:00:00Z") }, now), false);
    }
    assert.equal(licenceState(null, now), null);
    assert.equal(licenceCounts(null, now), false);
  });

  test("the database filter says the same thing as the function", () => {
    const today = at("2026-10-15T00:00:00Z");
    assert.deepEqual(currentLicenceWhere(today), {
      status: "approved",
      OR: [{ licenceExpiresOn: null }, { licenceExpiresOn: { gte: today } }],
    });
  });

  test("the rule that hides a seller's cold listings uses it, so expiry hides them exactly as revocation does", () => {
    const today = at("2026-10-15T00:00:00Z");
    const filter = buildHiddenListingFilter({ platformDisabled: [], sellerDisabled: new Map(), today });
    const cold = (filter.OR as { temperatureClass?: unknown; store?: { is: { NOT?: { kitchenLicence?: { is: unknown } } } } }[])[0]!;
    assert.deepEqual(cold.store?.is.NOT?.kitchenLicence?.is, currentLicenceWhere(today));
  });
});

describe("it is decided where the licence is read, and nowhere is it a job", () => {
  test("nothing in the backend schedules work, so there is nothing to be late", async () => {
    const found: string[] = [];
    async function walk(dir: URL) {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        const child = new URL(`${e.name}${e.isDirectory() ? "/" : ""}`, dir);
        if (e.isDirectory()) await walk(child);
        else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) {
          const text = (await readFile(child, "utf8")).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
          if (/\bsetInterval\(|node-cron|\bcron\b|agenda|bullmq/i.test(text)) found.push(child.pathname.split("/src/")[1]!);
        }
      }
    }
    await walk(new URL("../", import.meta.url));
    assert.deepEqual(found, []);
  });

  test("no code reads a kitchen licence's stored status as the answer to 'is it licensed'", async () => {
    for (const f of ["./categoryAccess.ts", "../routers/merchant.ts"]) {
      const text = (await src(f)).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      assert.ok(!/kitchenLicence\??\.status\s*===\s*"approved"/.test(text), `${f} treats a stored approval as current`);
      assert.ok(!/licence\??\.status\s*===\s*"approved"/.test(text), `${f} treats a stored approval as current`);
    }
  });

  test("a lapsed licence is announced once, from the reads the seller's app makes", async () => {
    const licence = await src("./licence.ts");
    assert.match(licence, /dedupeKey = `licence-expired:\$\{licence\.id\}:\$\{expired\.toISOString\(\)\.slice\(0, 10\)\}`/);
    const merchant = await src("../routers/merchant.ts");
    for (const name of ["thread", "standing"]) {
      const start = merchant.indexOf(`  ${name}: merchantProcedure`);
      const body = merchant.slice(start, merchant.indexOf("\n  }),", start));
      assert.match(body, /ensureLicenceExpiryNotice\(prisma, ctx\.storeId\)/, `${name} does not announce a lapse`);
    }
  });

  test("an expired approval does not block applying again", async () => {
    const merchant = await src("../routers/merchant.ts");
    const start = merchant.indexOf("applyForKitchenLicence: merchantProcedure");
    const body = merchant.slice(start, merchant.indexOf("applyForBadge:", start));
    assert.match(body, /const state = licenceState\(existing\)/);
    assert.ok(!/existing\.status === "approved"/.test(body));
  });
});
