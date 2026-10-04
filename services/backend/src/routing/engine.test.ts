import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { LocalCarrierGateway } from "../shipping/carrier.js";
import { selectCarrier } from "../shipping/select.js";
import { route } from "./engine.js";
import { priceOrder } from "./pricing.js";
import { splitPayment } from "../payments/split.js";
import {
  TAKE_RATE_BPS,
  REFUND_WINDOW_DAYS,
  SELLER_TRUSTED_AFTER_ORDERS,
  SELLER_ESTABLISHED_AFTER_ORDERS,
  REFUND_AUTO_APPROVE_CENTS,
  REFUND_CLAIMS_BEFORE_REVIEW,
} from "../config.js";
import { computeHold, applyAdjustments } from "../payments/payout.js";
import { assessClaim } from "../quality/refunds.js";
import type { BasketLine, CandidateListing } from "./types.js";

const carrier = new LocalCarrierGateway();
const ZIP = "77002"; // Houston

function listing(over: Partial<CandidateListing> & { storeId: string; canonicalProductId: string; priceCents: number }): CandidateListing {
  return {
    listingId: `${over.storeId}-${over.canonicalProductId}`,
    storeName: `Store ${over.storeId}`,
    metro: "Houston",
    stockStatus: "in_stock",
    sellerType: "store",
    verificationStatus: "verified",
    batchQuantityCap: null,
    temperatureClass: "ambient",
    shippingWeightOz: 16,
    lengthIn: 8,
    widthIn: 6,
    heightIn: 4,
    ...over,
  } as CandidateListing;
}

const line = (canonicalProductId: string, quantity = 1): BasketLine => ({ canonicalProductId, quantity });

describe("CART-2 single-store-preferring routing", () => {
  test("uses one store when one store can complete the basket", async () => {
    const pool = [
      listing({ storeId: "A", canonicalProductId: "egusi", priceCents: 900 }),
      listing({ storeId: "A", canonicalProductId: "garri", priceCents: 1300 }),
      listing({ storeId: "B", canonicalProductId: "egusi", priceCents: 800 }),
    ];
    const plan = await route([line("egusi"), line("garri")], pool, carrier, { toZip: ZIP });

    assert.equal(plan.singleStore, true);
    assert.equal(plan.storeCount, 1);
    assert.ok(plan.assignment.every((a) => a.listing.storeId === "A"));
  });

  test("prefers the single store even when splitting would be cheaper", async () => {
    // B is cheaper on egusi but cannot supply garri. CART-2 says spread only
    // when no single store can complete it — so A wins despite the premium.
    const pool = [
      listing({ storeId: "A", canonicalProductId: "egusi", priceCents: 900 }),
      listing({ storeId: "A", canonicalProductId: "garri", priceCents: 1300 }),
      listing({ storeId: "B", canonicalProductId: "egusi", priceCents: 500 }),
    ];
    const plan = await route([line("egusi"), line("garri")], pool, carrier, { toZip: ZIP });

    assert.equal(plan.singleStore, true);
    assert.equal(plan.itemsSubtotalCents, 2200);
    // The premium is measured and surfaced rather than silently absorbed.
    assert.equal(plan.singleStorePremiumCents, 400);
  });

  test("splits only when no single store can complete the basket", async () => {
    const pool = [
      listing({ storeId: "A", canonicalProductId: "egusi", priceCents: 900 }),
      listing({ storeId: "B", canonicalProductId: "garri", priceCents: 1300 }),
    ];
    const plan = await route([line("egusi"), line("garri")], pool, carrier, { toZip: ZIP });

    assert.equal(plan.singleStore, false);
    assert.equal(plan.storeCount, 2);
  });

  test("splitting uses as few stores as possible", async () => {
    // C covers two of the three lines; a naive cheapest-per-line pass would
    // use three stores.
    const pool = [
      listing({ storeId: "A", canonicalProductId: "egusi", priceCents: 800 }),
      listing({ storeId: "B", canonicalProductId: "garri", priceCents: 1200 }),
      listing({ storeId: "C", canonicalProductId: "egusi", priceCents: 900 }),
      listing({ storeId: "C", canonicalProductId: "garri", priceCents: 1300 }),
      listing({ storeId: "D", canonicalProductId: "palm-oil", priceCents: 1500 }),
    ];
    const plan = await route([line("egusi"), line("garri"), line("palm-oil")], pool, carrier, { toZip: ZIP });

    assert.equal(plan.storeCount, 2, "should use C for two lines plus D, not three separate stores");
  });

  test("a batch cap below the requested quantity disqualifies the listing", async () => {
    const pool = [
      listing({ storeId: "A", canonicalProductId: "egusi", priceCents: 900, stockStatus: "made_to_order", batchQuantityCap: 2 }),
      listing({ storeId: "B", canonicalProductId: "egusi", priceCents: 1100 }),
    ];
    const plan = await route([line("egusi", 5)], pool, carrier, { toZip: ZIP });

    assert.equal(plan.assignment[0].listing.storeId, "B");
  });

  test("reports lines no store can supply rather than dropping them", async () => {
    const pool = [listing({ storeId: "A", canonicalProductId: "egusi", priceCents: 900 })];
    const plan = await route([line("egusi"), line("unobtainium")], pool, carrier, { toZip: ZIP });

    assert.equal(plan.unfulfillable.length, 1);
    assert.equal(plan.unfulfillable[0].canonicalProductId, "unobtainium");
    assert.equal(plan.assignment.length, 1);
  });
});

describe("CART-3 mandatory temperature split", () => {
  test("one store with mixed temperatures still ships as two parcels", async () => {
    const pool = [
      listing({ storeId: "A", canonicalProductId: "egusi", priceCents: 900, temperatureClass: "ambient" }),
      listing({ storeId: "A", canonicalProductId: "fish", priceCents: 1600, temperatureClass: "frozen" }),
    ];
    const plan = await route([line("egusi"), line("fish")], pool, carrier, { toZip: ZIP });

    assert.equal(plan.singleStore, true, "still one store");
    assert.equal(plan.parcels.length, 2, "but temperature forces two parcels");
    const temps = plan.parcels.map((p) => p.temperatureClass).sort();
    assert.deepEqual(temps, ["ambient", "frozen"]);
  });

  test("same temperature at one store stays a single parcel", async () => {
    const pool = [
      listing({ storeId: "A", canonicalProductId: "egusi", priceCents: 900 }),
      listing({ storeId: "A", canonicalProductId: "garri", priceCents: 1300 }),
    ];
    const plan = await route([line("egusi"), line("garri")], pool, carrier, { toZip: ZIP });

    assert.equal(plan.parcels.length, 1);
  });

  test("a perishable parcel never ships on a slow ground service", async () => {
    const pool = [listing({ storeId: "A", canonicalProductId: "fish", priceCents: 1600, temperatureClass: "frozen" })];
    const plan = await route([line("fish")], pool, carrier, { toZip: "98101" }); // cross-country

    assert.ok(plan.parcels[0].transitDays <= 2, `perishable took ${plan.parcels[0].transitDays} days`);
  });
});

describe("CART-6 multi-parcel disclosure", () => {
  test("every parcel is disclosed with a date and a reason", async () => {
    const pool = [
      listing({ storeId: "A", canonicalProductId: "egusi", priceCents: 900, temperatureClass: "ambient" }),
      listing({ storeId: "A", canonicalProductId: "fish", priceCents: 1600, temperatureClass: "frozen" }),
    ];
    const plan = await route([line("egusi"), line("fish")], pool, carrier, { toZip: ZIP });
    const pricing = priceOrder(plan, "TX");

    assert.equal(pricing.parcels.length, 2);
    for (const p of pricing.parcels) {
      assert.ok(p.estimatedDelivery instanceof Date);
      assert.ok(p.reason.length > 0);
      assert.ok(p.itemCount > 0);
    }
    // A temperature split explains itself as such, not as a second seller.
    assert.ok(pricing.parcels.some((p) => /separately/i.test(p.reason)));
  });

  test("a single-parcel order discloses exactly one entry", async () => {
    const pool = [listing({ storeId: "A", canonicalProductId: "egusi", priceCents: 900 })];
    const pricing = priceOrder(await route([line("egusi")], pool, carrier, { toZip: ZIP }), "TX");

    assert.equal(pricing.parcelCount, 1);
    assert.equal(pricing.parcels.length, 1);
  });
});

describe("FUL-2 least-cost carrier meeting the window", () => {
  test("picks the cheapest option inside the window, not the fastest", () => {
    const choice = selectCarrier(
      [
        { carrier: "USPS", service: "Ground", costCents: 700, transitDays: 5, billableWeightOz: 16 },
        { carrier: "UPS", service: "2Day", costCents: 1800, transitDays: 2, billableWeightOz: 16 },
      ],
      6,
    );
    assert.equal(choice?.quote.carrier, "USPS");
    assert.equal(choice?.missedWindow, false);
  });

  test("ignores a cheaper option that misses the window", () => {
    const choice = selectCarrier(
      [
        { carrier: "USPS", service: "Ground", costCents: 700, transitDays: 5, billableWeightOz: 16 },
        { carrier: "UPS", service: "2Day", costCents: 1800, transitDays: 2, billableWeightOz: 16 },
      ],
      2,
    );
    assert.equal(choice?.quote.carrier, "UPS");
  });

  test("falls back to the fastest and flags it when nothing meets the window", () => {
    const choice = selectCarrier([{ carrier: "USPS", service: "Ground", costCents: 700, transitDays: 5, billableWeightOz: 16 }], 2);
    assert.equal(choice?.missedWindow, true);
  });
});

describe("PAY-2/PAY-3 marketplace splitting", () => {
  test("each store is paid its own gross net of take rate", async () => {
    const pool = [
      listing({ storeId: "A", canonicalProductId: "egusi", priceCents: 1000 }),
      listing({ storeId: "B", canonicalProductId: "garri", priceCents: 3000, metro: "Bronx" }),
    ];
    const plan = await route([line("egusi"), line("garri")], pool, carrier, { toZip: ZIP });
    const pricing = priceOrder(plan, "TX");
    const split = splitPayment(plan, pricing.totalCents, pricing.taxCents);

    assert.equal(split.stores.length, 2);
    for (const s of split.stores) {
      assert.equal(s.netCents, s.grossCents - s.platformFeeCents - s.fulfilmentFeeCents);
      assert.ok(s.netCents < s.grossCents);
    }
    const gross = split.stores.reduce((sum, s) => sum + s.grossCents, 0);
    assert.equal(gross, plan.itemsSubtotalCents, "store gross must reconcile to the basket");
  });

  test("the per-order fulfilment fee is charged once across a split order", async () => {
    const pool = [
      listing({ storeId: "A", canonicalProductId: "egusi", priceCents: 1000 }),
      listing({ storeId: "B", canonicalProductId: "garri", priceCents: 3000, metro: "Bronx" }),
    ];
    const plan = await route([line("egusi"), line("garri")], pool, carrier, { toZip: ZIP });
    const pricing = priceOrder(plan, "TX");
    const split = splitPayment(plan, pricing.totalCents, pricing.taxCents);

    const totalFee = split.stores.reduce((sum, s) => sum + s.fulfilmentFeeCents, 0);
    const { FULFILMENT_FEE_CENTS } = await import("../config.js");
    assert.equal(totalFee, FULFILMENT_FEE_CENTS, "a split order must not multiply the order fee");
  });

  test("tax is never part of a store's gross", async () => {
    const pool = [listing({ storeId: "A", canonicalProductId: "egusi", priceCents: 5000 })];
    const plan = await route([line("egusi")], pool, carrier, { toZip: ZIP });
    const pricing = priceOrder(plan, "CA");
    const split = splitPayment(plan, pricing.totalCents, pricing.taxCents);

    assert.ok(pricing.taxCents > 0);
    assert.equal(split.stores[0].grossCents, 5000);
    assert.equal(split.taxCollectedCents, pricing.taxCents);
  });
});

describe("FUL-4 address validation", () => {
  test("rejects a malformed zip and accepts a good address", async () => {
    const bad = await carrier.validateAddress({ street: "1 Main", city: "Houston", state: "TX", zip: "77" });
    assert.equal(bad.valid, false);
    assert.ok(bad.issues.length > 0);

    const good = await carrier.validateAddress({ street: "1200 Heritage Lane", city: "Houston", state: "tx", zip: "77002" });
    assert.equal(good.valid, true);
    assert.equal(good.normalized?.state, "TX");
  });
});

describe("CART-5 shipping is passed through at cost", () => {
  test("the buyer's shipping line equals the sum of the parcel quotes", async () => {
    const pool = [
      listing({ storeId: "A", canonicalProductId: "egusi", priceCents: 900 }),
      listing({ storeId: "B", canonicalProductId: "garri", priceCents: 900, metro: "Bronx" }),
      listing({ storeId: "C", canonicalProductId: "oil", priceCents: 900, metro: "Chicago" }),
    ];
    const plan = await route([line("egusi"), line("garri"), line("oil")], pool, carrier, { toZip: ZIP });
    const pricing = priceOrder(plan, "TX");

    const sumOfQuotes = plan.parcels.reduce((s, p) => s + p.carrierCostCents, 0);
    assert.equal(pricing.shippingCents, sumOfQuotes);
    assert.ok(sumOfQuotes > 0);
  });

  test("the platform neither absorbs nor marks up shipping", async () => {
    const pool = [
      listing({ storeId: "A", canonicalProductId: "egusi", priceCents: 900 }),
      listing({ storeId: "B", canonicalProductId: "fish", priceCents: 1600, metro: "Bronx", temperatureClass: "frozen" }),
    ];
    const pricing = priceOrder(await route([line("egusi"), line("fish")], pool, carrier, { toZip: ZIP }), "TX");

    assert.equal(pricing.shippingMarginCents, 0);
  });

  test("a large basket still pays shipping — there is no threshold left", async () => {
    const pool = [listing({ storeId: "A", canonicalProductId: "bulk", priceCents: 50000 })];
    const pricing = priceOrder(await route([line("bulk")], pool, carrier, { toZip: ZIP }), "TX");

    assert.ok(pricing.shippingCents > 0, "a $500 basket must still be charged carriage");
  });

  test("the cold-pack line is the actual packaging cost, charged on any basket", async () => {
    const pool = [listing({ storeId: "A", canonicalProductId: "fish", priceCents: 1600, temperatureClass: "frozen" })];
    const plan = await route([line("fish")], pool, carrier, { toZip: ZIP });
    const pricing = priceOrder(plan, "TX");

    assert.equal(pricing.coldPackCents, plan.trueColdPackCostCents);
    assert.ok(pricing.coldPackCents > 0);
  });

  test("an all-ambient order has no cold-pack line at all", async () => {
    const pool = [listing({ storeId: "A", canonicalProductId: "egusi", priceCents: 900 })];
    const pricing = priceOrder(await route([line("egusi")], pool, carrier, { toZip: ZIP }), "TX");

    assert.equal(pricing.coldPackCents, 0);
    assert.equal(pricing.coldParcelCount, 0);
  });

  test("a multi-seller mixed-temperature basket shows one shipping and one cold-pack line", async () => {
    const pool = [
      listing({ storeId: "A", canonicalProductId: "egusi", priceCents: 900 }),
      listing({ storeId: "B", canonicalProductId: "garri", priceCents: 900, metro: "Bronx" }),
      listing({ storeId: "C", canonicalProductId: "oil", priceCents: 900, metro: "Atlanta" }),
      listing({ storeId: "C", canonicalProductId: "fish", priceCents: 1600, metro: "Atlanta", temperatureClass: "frozen" }),
    ];
    const plan = await route([line("egusi"), line("garri"), line("oil"), line("fish")], pool, carrier, { toZip: ZIP });
    const pricing = priceOrder(plan, "TX");

    assert.equal(plan.parcels.length, 4, "four parcels behind the scenes");
    assert.equal(pricing.coldParcelCount, 1, "but only one of them is chilled");
    assert.equal(
      pricing.totalCents,
      pricing.itemsSubtotalCents + pricing.shippingCents + pricing.coldPackCents + pricing.taxCents,
      "and the total is built from exactly two cost categories",
    );
  });

  test("platform net per order does not vary with shipping cost", async () => {
    // Same items and sellers; only the destination changes, which changes every
    // carrier quote. Commission and the order fee must not move with it.
    const pool = [
      listing({ storeId: "A", canonicalProductId: "egusi", priceCents: 900 }),
      listing({ storeId: "B", canonicalProductId: "garri", priceCents: 1600, metro: "Bronx" }),
    ];
    const basket = [line("egusi"), line("garri")];

    const near = await route(basket, pool, carrier, { toZip: "77002" });
    const far = await route(basket, pool, carrier, { toZip: "98101" });
    const pNear = priceOrder(near, "TX");
    const pFar = priceOrder(far, "WA");
    const sNear = splitPayment(near, pNear.totalCents, pNear.taxCents, pNear.shippingCents + pNear.coldPackCents);
    const sFar = splitPayment(far, pFar.totalCents, pFar.taxCents, pFar.shippingCents + pFar.coldPackCents);

    assert.notEqual(pNear.shippingCents, pFar.shippingCents, "the destinations must differ in carriage");
    assert.equal(sNear.platformNetCents, sFar.platformNetCents, "platform net must be shipping-independent");
    assert.equal(sNear.platformNetCents, sNear.platformGrossCents, "and equal commission plus the order fee");
  });
});

describe("CAT-5 dimensional weight", () => {
  test("a bulky light parcel is rated on dimensional weight, not actual", async () => {
    const small = listing({ storeId: "A", canonicalProductId: "puffs", priceCents: 900 });
    const bulky = { ...small, lengthIn: 24, widthIn: 20, heightIn: 18 };
    const planSmall = await route([line("puffs")], [small], carrier, { toZip: ZIP });
    const planBulky = await route([line("puffs")], [bulky], carrier, { toZip: ZIP });

    assert.ok(
      planBulky.parcels[0].billableWeightOz > planSmall.parcels[0].billableWeightOz,
      "the bulky box must bill heavier despite identical actual weight",
    );
    assert.ok(planBulky.trueShippingCostCents > planSmall.trueShippingCostCents);
  });

  test("billable weight is never below actual weight", async () => {
    const heavy = listing({ storeId: "A", canonicalProductId: "yam", priceCents: 900, shippingWeightOz: 400 });
    const plan = await route([line("yam")], [heavy], carrier, { toZip: ZIP });
    assert.ok(plan.parcels[0].billableWeightOz >= 400);
  });
});

describe("PAY-3 commission base", () => {
  test("shipping and cold pack are never in the commission base", async () => {
    const pool = [
      listing({ storeId: "A", canonicalProductId: "egusi", priceCents: 1000 }),
      listing({ storeId: "B", canonicalProductId: "fish", priceCents: 3000, metro: "Bronx", temperatureClass: "frozen" }),
    ];
    const plan = await route([line("egusi"), line("fish")], pool, carrier, { toZip: ZIP });
    const pricing = priceOrder(plan, "TX");
    const split = splitPayment(plan, pricing.totalCents, pricing.taxCents, pricing.shippingCents + pricing.coldPackCents);

    assert.ok(pricing.shippingCents > 0 && pricing.coldPackCents > 0, "there is carriage here to accidentally tax");
    for (const s of split.stores) {
      assert.equal(s.platformFeeCents, Math.round((s.grossCents * TAKE_RATE_BPS) / 10000));
    }
    const commission = split.stores.reduce((n, s) => n + s.platformFeeCents, 0);
    const onItemsOnly = Math.round((plan.itemsSubtotalCents * TAKE_RATE_BPS) / 10000);
    // A cent of per-store rounding is fine; anything resembling carriage is not.
    assert.ok(Math.abs(commission - onItemsOnly) <= split.stores.length);
  });
});

describe("PAY-8 payout hold", () => {
  test("a brand-new seller is held for the full refund window past delivery", () => {
    const delivered = new Date("2026-01-01T00:00:00Z");
    const hold = computeHold({ cleanDeliveredOrders: 0, disputedOrders: 0 }, delivered);

    assert.equal(hold.tier, "new");
    assert.equal(hold.holdDays, REFUND_WINDOW_DAYS);
    assert.equal(hold.heldUntil?.toISOString().slice(0, 10), "2026-01-15");
  });

  test("the hold shortens with a clean record and disappears once established", () => {
    const delivered = new Date("2026-01-01T00:00:00Z");
    const trusted = computeHold({ cleanDeliveredOrders: SELLER_TRUSTED_AFTER_ORDERS, disputedOrders: 0 }, delivered);
    const established = computeHold({ cleanDeliveredOrders: SELLER_ESTABLISHED_AFTER_ORDERS, disputedOrders: 0 }, delivered);

    assert.equal(trusted.tier, "trusted");
    assert.ok(trusted.holdDays < REFUND_WINDOW_DAYS && trusted.holdDays > 0);
    assert.equal(established.tier, "established");
    assert.equal(established.holdDays, 0);
    assert.equal(established.heldUntil, null);
  });

  test("funds are not released before delivery is confirmed", () => {
    const hold = computeHold({ cleanDeliveredOrders: 1, disputedOrders: 0 }, null);
    assert.equal(hold.heldUntil, null);
    assert.match(hold.reason ?? "", /delivery/i);
  });

  test("a dispute pulls a seller back to the longest hold", () => {
    const hold = computeHold({ cleanDeliveredOrders: SELLER_TRUSTED_AFTER_ORDERS, disputedOrders: 1 }, new Date());
    assert.equal(hold.tier, "new");
  });
});

describe("PAY-9 carrier adjustments", () => {
  test("an adjustment is deducted from the seller's next payout", () => {
    const r = applyAdjustments(5000, 1200);
    assert.equal(r.payableCents, 3800);
    assert.equal(r.appliedCents, 1200);
    assert.equal(r.carriedCents, 0);
  });

  test("a payout never goes negative; the excess carries forward", () => {
    const r = applyAdjustments(1000, 2500);
    assert.equal(r.payableCents, 0);
    assert.equal(r.appliedCents, 1000);
    assert.equal(r.carriedCents, 1500);
  });

  test("the adjustment feed is stubbed behind the gateway, not absent", async () => {
    const adjustments = await carrier.adjustmentsSince(new Date(0));
    assert.ok(Array.isArray(adjustments), "the port exists so the real feed drops in unchanged");
  });
});

describe("QC-8/QC-9 refunds and recovery", () => {
  test("a spoilage claim without a photo is rejected", () => {
    const d = assessClaim({ reason: "spoiled", amountCents: 1200, priorClaims: 0, trackingShowsFailure: false });
    assert.equal(d.status, "rejected");
    assert.match(d.reasonGiven, /photo/i);
  });

  test("a small first claim with evidence is refunded straight away", () => {
    const d = assessClaim({
      reason: "damaged", amountCents: 1200, photoUrl: "https://x/p.jpg", priorClaims: 0, trackingShowsFailure: false,
    });
    assert.equal(d.status, "auto_approved");
  });

  test("packaging and product failures are recovered from the seller", () => {
    const d = assessClaim({
      reason: "damaged", amountCents: 1200, photoUrl: "https://x/p.jpg", priorClaims: 0, trackingShowsFailure: false,
    });
    assert.equal(d.recoveryTarget, "seller");
  });

  test("loss evidenced by tracking is a carrier claim, not the seller's fault", () => {
    const d = assessClaim({ reason: "not_delivered", amountCents: 1200, priorClaims: 0, trackingShowsFailure: true });
    assert.equal(d.recoveryTarget, "carrier");
  });

  test("a repeat claimant is routed to review rather than auto-approved", () => {
    const d = assessClaim({
      reason: "missing_items", amountCents: 500, priorClaims: REFUND_CLAIMS_BEFORE_REVIEW, trackingShowsFailure: false,
    });
    assert.equal(d.status, "manual_review");
  });

  test("auto-approval is capped by amount", () => {
    const d = assessClaim({
      reason: "missing_items", amountCents: REFUND_AUTO_APPROVE_CENTS + 1, priorClaims: 0, trackingShowsFailure: false,
    });
    assert.equal(d.status, "manual_review");
  });
});

describe("FUL-9 platform-issued labels only", () => {
  test("no seller-facing surface buys a label or holds carrier credentials", async () => {
    const fsp = await import("node:fs/promises");
    const path = await import("node:path");
    const offenders: string[] = [];

    async function walk(dir: string): Promise<string[]> {
      let out: string[] = [];
      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return out;
      }
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) out = out.concat(await walk(p));
        else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
      }
      return out;
    }

    for (const root of ["src/routers", "../../apps/merchant/app"]) {
      for (const file of await walk(root)) {
        const text = await fsp.readFile(file, "utf8");
        if (/buyLabel|purchaseLabel|createLabel|EASYPOST_API_KEY|carrierAccountId/i.test(text)) offenders.push(file);
      }
    }

    assert.deepEqual(offenders, [], "a seller-side label purchase path was introduced");
  });
});
