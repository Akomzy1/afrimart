import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import type { ControlledCategory } from "@prisma/client";
import {
  checkListingStandards,
  CONTROLLED_CATEGORY_LABEL,
  type ListingCandidate,
  type SellerListingContext,
} from "./listingStandards.js";
import { buildHiddenListingFilter, loadSellerListingContext, sellerCategoryNotices } from "./categoryAccess.js";
import { AUDITED_ACTIONS } from "../auth/audit.js";
import { SUPPORT_CONTACT } from "../config.js";

/**
 * QC-1 — home-based and aspiring sellers.
 *
 * What these pin, in the order the rules were given:
 *   1. no same-state or cross-state restriction exists, anywhere
 *   2. chilled and frozen stay blocked unless a licensed kitchen is approved
 *   3. the licensed-kitchen status is applied for and granted by a reviewer
 *   4. meat, poultry, fish and dairy are listable by default
 *   5. operations can switch a category off per seller and platform-wide
 *   6. every switch is audited
 *   7. stores are unaffected by all of it
 *   8. a permit is confirmed once, with a timestamp
 */

const HOME_TIER = ["home_seller", "aspiring_entrepreneur"] as const;
const CATEGORIES: readonly ControlledCategory[] = ["meat", "poultry", "fish", "dairy"];

const seller = (over: Partial<SellerListingContext> = {}): SellerListingContext => ({
  licensedKitchen: false,
  disabledForSeller: [],
  disabledPlatformWide: [],
  permitConfirmed: [],
  ...over,
});

const candidate = (over: Partial<ListingCandidate> = {}): ListingCandidate => ({
  canonicalName: "Stockfish",
  category: "Fish & seafood",
  temperatureClass: "ambient",
  sellerType: "home_seller",
  controlledCategory: "fish",
  seller: seller({ permitConfirmed: ["fish"] }),
  ...over,
});

const codes = (c: ListingCandidate) => checkListingStandards(c).violations.map((v) => v.code);

const src = (rel: string) => readFile(new URL(rel, import.meta.url), "utf8");

/** From `name: staffProcedure` to the next procedure declaration (or the end of the file). */
function procedureBody(source: string, name: string): string {
  const marker = `${name}: staffProcedure`;
  const start = source.indexOf(marker);
  assert.ok(start > -1, `${name} is missing`);
  const next = source.indexOf(": staffProcedure", start + marker.length);
  return source.slice(start, next === -1 ? undefined : next);
}

/** The few lines directly above `index`, where an explicit exemption note must sit. */
function linesAbove(text: string, index: number, count = 8): string {
  return text.slice(0, index).split("\n").slice(-count).join("\n");
}

/** The body of the call that starts at `open`, found by matching parentheses. */
function callBody(source: string, open: number): string {
  let depth = 0;
  for (let i = source.indexOf("(", open); i < source.length; i++) {
    if (source[i] === "(") depth++;
    if (source[i] === ")" && --depth === 0) return source.slice(open, i + 1);
  }
  return source.slice(open);
}

describe("QC-1 no same-state or cross-state shipping restriction", () => {
  test("nothing in the listing rules or the routing pool looks at a seller's or buyer's state", async () => {
    // Home-based and aspiring sellers ship nationwide like any other seller.
    // A state check would have to live in one of these files; none does.
    for (const rel of ["./listingStandards.ts", "./categoryAccess.ts", "../routing/select.ts", "../routing/engine.ts"]) {
      const text = (await src(rel)).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      assert.ok(!/same[-_ ]?state|cross[-_ ]?state|intrastate|interstate|destination\.state|\.state\b/i.test(text), `${rel} mentions state`);
    }
  });

  test("a home seller's listing carries no destination, so it cannot be limited by one", () => {
    assert.ok(!("destinationState" in candidate()));
    for (const sellerType of HOME_TIER) {
      assert.deepEqual(codes(candidate({ sellerType })), []);
    }
  });
});

describe("QC-1 chilled and frozen stay blocked for home and aspiring sellers", () => {
  for (const sellerType of HOME_TIER) {
    for (const temperatureClass of ["refrigerated", "frozen"] as const) {
      test(`${sellerType} cannot list ${temperatureClass} goods`, () => {
        assert.ok(codes(candidate({ sellerType, temperatureClass, controlledCategory: null })).includes("home_seller_perishable"));
      });
    }
  }

  test("a shelf-stable item is unaffected", () => {
    assert.deepEqual(codes(candidate({ controlledCategory: null })), []);
  });

  test("the refusal tells the seller how to get past it", () => {
    const v = checkListingStandards(candidate({ temperatureClass: "frozen", controlledCategory: null })).violations[0]!;
    assert.match(v.message, /commercial kitchen/i);
    assert.match(v.message, /apply/i);
  });
});

describe("QC-1 licensed commercial kitchen lifts the chilled and frozen restriction", () => {
  for (const sellerType of HOME_TIER) {
    for (const temperatureClass of ["refrigerated", "frozen"] as const) {
      test(`an approved ${sellerType} can list ${temperatureClass} goods`, () => {
        const c = candidate({
          sellerType,
          temperatureClass,
          controlledCategory: null,
          seller: seller({ licensedKitchen: true }),
        });
        assert.deepEqual(codes(c), []);
      });
    }
  }

  test("it lifts that one rule and no other", () => {
    const licensed = seller({ licensedKitchen: true });
    // Still prohibited, still expired, still needs its permit confirmation.
    assert.ok(codes(candidate({ category: "alcohol", controlledCategory: null, seller: licensed })).includes("prohibited_category"));
    assert.ok(
      codes(candidate({ expiresOn: new Date(Date.now() - 86_400_000), controlledCategory: null, seller: licensed })).includes("expired"),
    );
    assert.ok(
      codes(candidate({ temperatureClass: "frozen", controlledCategory: "meat", seller: licensed })).includes(
        "permit_confirmation_required",
      ),
    );
  });

  test("it is read from the stored status, and only 'approved' counts", async () => {
    const dbWith = (status: string | null) =>
      ({
        kitchenLicence: { findUnique: async () => (status ? { status } : null) },
        sellerCategoryControl: { findMany: async () => [] },
        platformCategoryControl: { findMany: async () => [] },
        permitConfirmation: { findMany: async () => [] },
      }) as unknown as Parameters<typeof loadSellerListingContext>[0];

    // An application that has merely been made, refused or revoked grants nothing.
    for (const status of [null, "applied", "rejected", "revoked"]) {
      assert.equal((await loadSellerListingContext(dbWith(status), "s")).licensedKitchen, false, `${status} must not count`);
    }
    assert.equal((await loadSellerListingContext(dbWith("approved"), "s")).licensedKitchen, true);
  });

  test("a seller can apply but can never grant it: the merchant surface only writes 'applied'", async () => {
    const merchant = await src("../routers/merchant.ts");
    const writes = [...merchant.matchAll(/kitchenLicence\.(create|update|upsert)\(/g)];
    assert.ok(writes.length > 0, "the application path is missing");
    for (const w of writes) {
      assert.ok(!/approved|rejected|revoked/.test(callBody(merchant, w.index!)), "merchant code sets a reviewed status");
    }
    // The status used on the way in is the unreviewed one.
    assert.match(merchant, /status: "applied" as const/);
  });

  test("only a reviewer holding stores:write can decide it, and approval needs the licence checked", async () => {
    const admin = await src("../routers/admin.ts");
    const start = admin.indexOf("reviewKitchenLicence:");
    const body = admin.slice(start, admin.indexOf("categoryControls:", start));
    assert.match(body, /staffProcedure\("stores:write"\)/);
    assert.match(body, /licenceChecked/);
    assert.match(body, /input\.decision === "approve" && !input\.licenceChecked/);
    // Every other writer of the table is the seller's own application path.
    const outside = admin.slice(0, start) + admin.slice(admin.indexOf("categoryControls:", start));
    assert.ok(!/kitchenLicence\.(update|upsert|create)\(/.test(outside), "another admin route changes licences without review");
  });

  test("the decision is audited, with who and why", async () => {
    assert.ok((AUDITED_ACTIONS as readonly string[]).includes("store.kitchen_licence_change"));
    const admin = await src("../routers/admin.ts");
    const start = admin.indexOf("reviewKitchenLicence:");
    const body = admin.slice(start, admin.indexOf("categoryControls:", start));
    assert.match(body, /writeAudit\(\s*tx/);
    assert.match(body, /note: z\.string\(\)\.min\(1\)/, "a decision without a reason must not parse");
  });
});

describe("QC-1 meat, poultry, fish and dairy are listable by default", () => {
  for (const sellerType of HOME_TIER) {
    for (const group of CATEGORIES) {
      test(`${sellerType} can list shelf-stable ${group} once the permit is confirmed`, () => {
        const c = candidate({ sellerType, controlledCategory: group, seller: seller({ permitConfirmed: [group] }) });
        assert.deepEqual(codes(c), []);
      });
    }
  }

  test("dried fish, crayfish, stockfish and kilishi are not blocked", () => {
    const staples: [string, ControlledCategory][] = [
      ["Dried Fish", "fish"],
      ["Crayfish", "fish"],
      ["Stockfish", "fish"],
      ["Kilishi", "meat"],
    ];
    for (const [canonicalName, group] of staples) {
      const r = checkListingStandards(
        candidate({ canonicalName, controlledCategory: group, seller: seller({ permitConfirmed: [group] }) }),
      );
      assert.equal(r.ok, true, `${canonicalName} must be listable`);
    }
  });

  test("with nothing switched off, no category is refused for being what it is", () => {
    for (const group of CATEGORIES) {
      const c = codes(candidate({ controlledCategory: group, seller: seller({ permitConfirmed: [group] }) }));
      assert.ok(!c.some((x) => x.startsWith("category_disabled")), `${group} is blocked by default`);
    }
  });

  test("the database default is 'nothing disabled': no row means enabled", async () => {
    const schema = await src("../../prisma/schema.prisma");
    assert.match(schema, /model PlatformCategoryControl/);
    // Absence of a row is the enabled state; there is no seeded 'disabled' row.
    const seed = await src("../../prisma/seed.ts");
    assert.ok(!/platformCategoryControl|sellerCategoryControl/i.test(seed));
  });

  test("an unclassified product is simply not one of the four", () => {
    assert.deepEqual(codes(candidate({ controlledCategory: null, seller: seller() })), []);
    assert.deepEqual(codes(candidate({ controlledCategory: undefined, seller: seller() })), []);
  });
});

describe("QC-1 ops can switch a category off for one seller", () => {
  test("new listings in that category are refused, and only that category", () => {
    const s = seller({ disabledForSeller: ["dairy"], permitConfirmed: ["dairy", "fish"] });
    assert.ok(codes(candidate({ controlledCategory: "dairy", seller: s })).includes("category_disabled_for_seller"));
    assert.deepEqual(codes(candidate({ controlledCategory: "fish", seller: s })), []);
  });

  test("several categories can be disabled at once", () => {
    const s = seller({ disabledForSeller: ["meat", "poultry"], permitConfirmed: CATEGORIES });
    assert.ok(codes(candidate({ controlledCategory: "meat", seller: s })).includes("category_disabled_for_seller"));
    assert.ok(codes(candidate({ controlledCategory: "poultry", seller: s })).includes("category_disabled_for_seller"));
    assert.deepEqual(codes(candidate({ controlledCategory: "fish", seller: s })), []);
  });

  test("the message says why, what happens to existing listings, and how to reach support", () => {
    const v = checkListingStandards(
      candidate({ controlledCategory: "poultry", seller: seller({ disabledForSeller: ["poultry"] }) }),
    ).violations.find((x) => x.code === "category_disabled_for_seller")!;
    assert.match(v.message, /switched off on your account/);
    assert.match(v.message, /existing .* listings are hidden/);
    assert.ok(v.message.includes(SUPPORT_CONTACT), "support contact missing");
    assert.ok(!v.message.includes("!"), "no exclamation marks in seller-facing copy");
  });

  test("existing listings in that category are hidden for that seller and no other", () => {
    const filter = buildHiddenListingFilter({
      platformDisabled: [],
      sellerDisabled: new Map([["store-a", ["dairy"]]]),
    });
    const clauses = (filter.OR ?? []) as Record<string, unknown>[];
    const forA = clauses.filter((c) => c.storeId === "store-a");
    assert.equal(forA.length, 1);
    assert.deepEqual((forA[0]!.canonicalProduct as { is: unknown }).is, { controlledCategory: { not: null, in: ["dairy"] } });
    assert.ok(!clauses.some((c) => c.storeId && c.storeId !== "store-a"), "another store is caught");
  });

  test("the seller sees the same explanation for the listings that are hidden", async () => {
    const db = {
      kitchenLicence: { findUnique: async () => null },
      sellerCategoryControl: { findMany: async () => [{ category: "meat" }] },
      platformCategoryControl: { findMany: async () => [] },
      permitConfirmation: { findMany: async () => [] },
    } as unknown as Parameters<typeof sellerCategoryNotices>[0];
    const notices = await sellerCategoryNotices(db, "s", "home_seller");
    assert.equal(notices.length, 1);
    assert.equal(notices[0]!.code, "category_disabled_for_seller");
    assert.ok(notices[0]!.message.includes(SUPPORT_CONTACT));
  });

  test("ops cannot set a per-seller switch on a store", async () => {
    const admin = await src("../routers/admin.ts");
    const start = admin.indexOf("setSellerCategory:");
    const body = admin.slice(start, admin.indexOf("setPlatformCategory:", start));
    assert.match(body, /!isHomeTier\(store\.sellerType\)/);
    assert.match(body, /Stores are not affected/);
  });
});

describe("QC-1 ops can switch a category off platform-wide", () => {
  test("it blocks every home and aspiring seller in that category", () => {
    for (const sellerType of HOME_TIER) {
      const c = candidate({ sellerType, controlledCategory: "meat", seller: seller({ disabledPlatformWide: ["meat"], permitConfirmed: ["meat"] }) });
      assert.ok(codes(c).includes("category_disabled_platform"), sellerType);
    }
  });

  test("it leaves the other three categories alone", () => {
    const s = seller({ disabledPlatformWide: ["meat"], permitConfirmed: CATEGORIES });
    for (const group of ["poultry", "fish", "dairy"] as const) {
      assert.deepEqual(codes(candidate({ controlledCategory: group, seller: s })), [], group);
    }
  });

  test("the message is plain and gives support contact", () => {
    const v = checkListingStandards(
      candidate({ controlledCategory: "dairy", seller: seller({ disabledPlatformWide: ["dairy"] }) }),
    ).violations.find((x) => x.code === "category_disabled_platform")!;
    assert.match(v.message, /paused dairy listings/);
    assert.match(v.message, /existing dairy listings are hidden/);
    assert.ok(v.message.includes(SUPPORT_CONTACT));
  });

  test("existing listings are hidden for home-tier sellers only", () => {
    const filter = buildHiddenListingFilter({ platformDisabled: ["fish"], sellerDisabled: new Map() });
    const platform = (filter.OR as Record<string, unknown>[]).find(
      (c) => (c.canonicalProduct as { is?: { controlledCategory?: unknown } } | undefined)?.is?.controlledCategory,
    )!;
    assert.deepEqual((platform.canonicalProduct as { is: unknown }).is, { controlledCategory: { not: null, in: ["fish"] } });
    assert.deepEqual(platform.store, { is: { sellerType: { not: "store" } } });
  });

  test("a category clause can never match an unclassified product (NULL is not 'in' anything)", () => {
    // `NULL IN ('fish')` is NULL in SQL, and NOT(NULL) is NULL, which would drop
    // every unclassified listing the moment any category was switched off. The
    // explicit not-null guard is what keeps them visible; verify:quality-controls
    // proves the same thing against the database.
    const filter = buildHiddenListingFilter({
      platformDisabled: ["meat"],
      sellerDisabled: new Map([["a-home", ["dairy"]]]),
    });
    const categoryClauses = (filter.OR as { canonicalProduct?: { is: { controlledCategory: { not: unknown } } } }[]).filter(
      (c) => c.canonicalProduct,
    );
    assert.equal(categoryClauses.length, 2);
    for (const c of categoryClauses) assert.equal(c.canonicalProduct!.is.controlledCategory.not, null);
  });

  test("with nothing disabled there is no category clause at all", () => {
    const filter = buildHiddenListingFilter({ platformDisabled: [], sellerDisabled: new Map() });
    for (const clause of filter.OR as Record<string, unknown>[]) {
      assert.ok(!("canonicalProduct" in clause), "a category clause exists with nothing switched off");
    }
  });

  test("it is a stored setting that ops can change, not a constant", async () => {
    const admin = await src("../routers/admin.ts");
    const start = admin.indexOf("setPlatformCategory:");
    const body = admin.slice(start);
    // Admin only: the platform-wide switch reaches every home-tier seller at once.
    assert.match(body, /staffProcedure\("settings:write"\)/);
    assert.match(body, /platformCategoryControl\.upsert/);
  });
});

describe("QC-1 who may use the switches", () => {
  test("only admin holds settings:write; operations keeps the per-seller switch", async () => {
    const { roleHas } = await import("../auth/permissions.js");
    assert.equal(roleHas("admin", "settings:write"), true);
    for (const role of ["operations", "finance", "catalogue_reviewer"] as const) {
      assert.equal(roleHas(role, "settings:write"), false, `${role} must not switch a category for the whole tier`);
    }
    assert.equal(roleHas("operations", "stores:write"), true, "operations keeps per-seller switches");
  });

  test("the per-seller switch is still stores:write, the platform one is not", async () => {
    const admin = await src("../routers/admin.ts");
    assert.match(procedureBody(admin, "setSellerCategory"), /staffProcedure\("stores:write"\)/);
    assert.doesNotMatch(procedureBody(admin, "setPlatformCategory"), /stores:write/);
  });
});

describe("QC-1 every enable and disable is audited", () => {
  test("each control writes who, when, which seller or setting, and a reason — in its own transaction", async () => {
    const admin = await src("../routers/admin.ts");
    const cases = [
      { name: "setSellerCategory", action: "store.category_restriction_change", subject: 'subjectType: "store"' },
      { name: "setPlatformCategory", action: "platform.category_restriction_change", subject: 'subjectType: "platform_setting"' },
      { name: "setControlledCategory", action: "product.reclassify", subject: 'subjectType: "product"' },
      { name: "reviewKitchenLicence", action: "store.kitchen_licence_change", subject: 'subjectType: "store"' },
    ];
    for (const c of cases) {
      const body = procedureBody(admin, c.name);
      assert.match(body, /\$transaction/, `${c.name} audits outside a transaction`);
      assert.match(body, /writeAudit\(\s*tx/, `${c.name} writes no audit entry`);
      assert.ok(body.includes(`"${c.action}"`), `${c.name} audits the wrong action`);
      assert.ok(body.includes(c.subject), `${c.name} does not say what was changed`);
      assert.match(body, /note: (input\.reason|input\.note)/, `${c.name} drops the reason`);
      assert.match(body, /reason: z\.string\(\)\.min\(1\)|note: z\.string\(\)\.min\(1\)/, `${c.name} accepts an empty reason`);
      assert.ok((AUDITED_ACTIONS as readonly string[]).includes(c.action), `${c.action} is not a registered audited action`);
    }
  });

  test("enabling again is audited exactly as disabling is — both go through the same mutation", async () => {
    const admin = await src("../routers/admin.ts");
    for (const name of ["setSellerCategory", "setPlatformCategory"]) {
      const body = procedureBody(admin, name);
      assert.match(body, /disabled: z\.boolean\(\)/, `${name} has no separate enable path to forget`);
    }
  });

  test("the actor is the signed-in staff member, never an input", async () => {
    const admin = await src("../routers/admin.ts");
    const start = admin.indexOf("setSellerCategory:");
    const body = admin.slice(start);
    assert.ok(!/actorEmail: z\./.test(body));
    assert.match(body, /actorEmail: ctx\.staff\.email/);
  });
});

describe("QC-1 stores are unaffected by every one of these rules", () => {
  const everythingAgainstYou = seller({
    licensedKitchen: false,
    disabledForSeller: CATEGORIES,
    disabledPlatformWide: CATEGORIES,
    permitConfirmed: [],
  });

  test("a store lists chilled and frozen meat, poultry, fish and dairy with every switch off, no licence and no permit", () => {
    for (const temperatureClass of ["ambient", "refrigerated", "frozen"] as const) {
      for (const group of CATEGORIES) {
        const r = checkListingStandards(
          candidate({ sellerType: "store", temperatureClass, controlledCategory: group, seller: everythingAgainstYou }),
        );
        assert.equal(r.ok, true, `${group} ${temperatureClass}: ${r.violations.map((v) => v.code)}`);
      }
    }
  });

  test("a store is never asked for a permit confirmation", () => {
    assert.ok(!codes(candidate({ sellerType: "store", controlledCategory: "meat", seller: seller() })).includes("permit_confirmation_required"));
  });

  test("no hidden-listing clause can match a store", () => {
    const filter = buildHiddenListingFilter({
      platformDisabled: [...CATEGORIES],
      sellerDisabled: new Map([["a-store", [...CATEGORIES]]]),
    });
    for (const clause of filter.OR as { store?: { is?: { sellerType?: unknown } } }[]) {
      assert.deepEqual(clause.store?.is?.sellerType, { not: "store" }, "a clause is not scoped to the home tier");
    }
  });

  test("stores get no notices about hidden listings", async () => {
    const db = { kitchenLicence: {}, sellerCategoryControl: {}, platformCategoryControl: {}, permitConfirmation: {} } as never;
    assert.deepEqual(await sellerCategoryNotices(db, "s", "store"), []);
  });

  test("the merchant endpoints for licence and permit refuse a store", async () => {
    const merchant = await src("../routers/merchant.ts");
    assert.equal((merchant.match(/!isHomeTier\(store\.sellerType\)/g) ?? []).length >= 3, true);
  });
});

describe("QC-1 permit confirmation", () => {
  test("a home or aspiring seller listing one of the four for the first time is asked to confirm", () => {
    for (const sellerType of HOME_TIER) {
      for (const group of CATEGORIES) {
        const r = checkListingStandards(candidate({ sellerType, controlledCategory: group, seller: seller() }));
        assert.equal(r.ok, false);
        assert.deepEqual(
          r.violations.map((v) => v.code),
          ["permit_confirmation_required"],
          `${sellerType}/${group}`,
        );
      }
    }
  });

  test("once confirmed they are not asked again", () => {
    const c = candidate({ controlledCategory: "meat", seller: seller({ permitConfirmed: ["meat"] }) });
    assert.deepEqual(codes(c), []);
    assert.deepEqual(codes(c), [], "still clean on the next listing");
  });

  test("it is per category: a meat confirmation says nothing about dairy", () => {
    const s = seller({ permitConfirmed: ["meat"] });
    assert.deepEqual(codes(candidate({ controlledCategory: "meat", seller: s })), []);
    assert.deepEqual(codes(candidate({ controlledCategory: "dairy", seller: s })), ["permit_confirmation_required"]);
  });

  test("anything outside the four never asks for one", () => {
    assert.deepEqual(codes(candidate({ controlledCategory: null, category: "Grains & flours", seller: seller() })), []);
  });

  test("a switched-off category is refused outright rather than asking for a permit that cannot help", () => {
    const c = codes(candidate({ controlledCategory: "fish", seller: seller({ disabledForSeller: ["fish"] }) }));
    assert.ok(c.includes("category_disabled_for_seller"));
    assert.ok(!c.includes("permit_confirmation_required"));
  });

  test("a missing confirmation is something the seller can supply, so it is reported as such", async () => {
    const admin = await src("../routers/admin.ts");
    assert.match(admin, /permitOnly \? "PRECONDITION_FAILED" : "FORBIDDEN"/);
  });

  test("the confirmation is stored with a timestamp and the wording version", async () => {
    const schema = await src("../../prisma/schema.prisma");
    const model = schema.slice(schema.indexOf("model PermitConfirmation"));
    assert.match(model, /confirmedAt\s+DateTime\s+@default\(now\(\)\)/);
    assert.match(model, /statementVersion\s+String/);
    assert.match(model, /@@unique\(\[storeId, category\]\)/, "one confirmation per seller per category");
  });

  test("confirming needs an explicit acknowledgement and keeps the original timestamp when repeated", async () => {
    const merchant = await src("../routers/merchant.ts");
    const start = merchant.indexOf("confirmPermit:");
    const body = merchant.slice(start, merchant.indexOf("categoryNotices:", start));
    assert.match(body, /acknowledged: z\.literal\(true\)/);
    assert.match(body, /update: \{\}/, "a repeat confirmation must not overwrite the first timestamp");
  });

  test("the exact words a seller confirms are shown to them and are the ones recorded", () => {
    for (const group of CATEGORIES) {
      assert.match(
        checkListingStandards(candidate({ controlledCategory: group, seller: seller() })).violations[0]!.message,
        new RegExp(CONTROLLED_CATEGORY_LABEL[group]),
      );
    }
  });
});

describe("QC-1 is enforced where a listing is created, and hiding is applied where listings are read", () => {
  test("approveDraft — the only path that creates a listing — runs the listing standards first", async () => {
    const admin = await src("../routers/admin.ts");
    const create = admin.indexOf("tx.listing.create(");
    assert.ok(create > -1);
    const before = admin.slice(0, create);
    assert.ok(before.lastIndexOf("checkListingForStore(") > before.lastIndexOf("approveDraft:"), "no check precedes the create");
    assert.equal((admin.match(/listing\.create\(/g) ?? []).length, 1, "a second listing path exists and must be checked too");
  });

  test("every public listing read in the catalogue and the routing pool applies the hiding filter", async () => {
    for (const rel of ["../routers/catalogue.ts", "../routers/checkout.ts"]) {
      const text = await src(rel);
      const reads = [...text.matchAll(/prisma\.listing\.find(?:Many|First|FirstOrThrow|Unique|UniqueOrThrow)\(/g)];
      assert.ok(reads.length > 0);
      for (const r of reads) {
        const exempt = linesAbove(text, r.index!).includes("visibility-exempt:");
        assert.ok(
          exempt || callBody(text, r.index!).includes("visibleListings("),
          `${rel}: a listing read can return hidden listings:\n${callBody(text, r.index!).slice(0, 120)}`,
        );
      }
    }
  });

  test("the hiding filter also covers a revoked licence, so revoking takes the chilled listings down", () => {
    const filter = buildHiddenListingFilter({ platformDisabled: [], sellerDisabled: new Map() });
    const clauses = filter.OR as Record<string, unknown>[];
    assert.equal(clauses.length, 1);
    assert.deepEqual(clauses[0], {
      temperatureClass: { not: "ambient" },
      store: {
        is: {
          sellerType: { not: "store" },
          NOT: { kitchenLicence: { is: { status: "approved" } } },
        },
      },
    });
  });
});
