import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { LocalCarrierGateway } from "../shipping/carrier.js";
import { selectCarrier } from "../shipping/select.js";
import { route } from "./engine.js";
import { priceOrder } from "./pricing.js";
import { splitPayment } from "../payments/split.js";
import { blendedShippingCents, FREE_SHIPPING_THRESHOLD_CENTS } from "../config.js";
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

describe("CART-5 one shipping charge, never one per parcel", () => {
  test("a two-parcel order below the threshold is charged one blended fee", async () => {
    const pool = [
      listing({ storeId: "A", canonicalProductId: "egusi", priceCents: 900, temperatureClass: "ambient" }),
      listing({ storeId: "A", canonicalProductId: "fish", priceCents: 1600, temperatureClass: "frozen" }),
    ];
    const plan = await route([line("egusi"), line("fish")], pool, carrier, { toZip: ZIP });
    const pricing = priceOrder(plan, "TX");

    assert.equal(pricing.parcelCount, 2);
    // One figure, scaled to the split — and emphatically not two fees.
    assert.equal(pricing.shippingCents, blendedShippingCents(2));
    assert.notEqual(pricing.shippingCents, blendedShippingCents(1) * 2);
  });

  test("above the threshold the platform absorbs shipping entirely", async () => {
    const pool = [listing({ storeId: "A", canonicalProductId: "bulk", priceCents: FREE_SHIPPING_THRESHOLD_CENTS + 500 })];
    const plan = await route([line("bulk")], pool, carrier, { toZip: ZIP });
    const pricing = priceOrder(plan, "TX");

    assert.equal(pricing.freeShippingApplied, true);
    assert.equal(pricing.shippingCents, 0);
    // The cost does not vanish — it moves onto the platform's margin.
    assert.ok(pricing.shippingMarginCents < 0);
  });

  test("a bigger split costs the buyer more, as one figure not several", async () => {
    const onePool = [listing({ storeId: "A", canonicalProductId: "egusi", priceCents: 900 })];
    const threePool = [
      listing({ storeId: "A", canonicalProductId: "egusi", priceCents: 900 }),
      listing({ storeId: "B", canonicalProductId: "garri", priceCents: 900, metro: "Bronx" }),
      listing({ storeId: "C", canonicalProductId: "fish", priceCents: 900, metro: "Chicago", temperatureClass: "frozen" }),
    ];
    const one = priceOrder(await route([line("egusi")], onePool, carrier, { toZip: ZIP }), "TX");
    const three = priceOrder(
      await route([line("egusi"), line("garri"), line("fish")], threePool, carrier, { toZip: ZIP }),
      "TX",
    );

    assert.equal(three.parcelCount, 3);
    assert.ok(three.shippingCents > one.shippingCents, "a three-way split must not cost the same as one parcel");
    // Still a single charge: sub-linear, so the platform keeps absorbing part.
    assert.ok(three.shippingCents < one.shippingCents * 3);
  });

  test("a three-way split is reported as an exception to look at", async () => {
    const pool = [
      listing({ storeId: "A", canonicalProductId: "egusi", priceCents: 900 }),
      listing({ storeId: "B", canonicalProductId: "garri", priceCents: 900, metro: "Bronx" }),
      listing({ storeId: "C", canonicalProductId: "oil", priceCents: 900, metro: "Chicago" }),
    ];
    const three = priceOrder(
      await route([line("egusi"), line("garri"), line("oil")], pool, carrier, { toZip: ZIP }),
      "TX",
    );
    assert.equal(three.exceptionalSplit, true);

    const onePool = [listing({ storeId: "A", canonicalProductId: "egusi", priceCents: 900 })];
    const one = priceOrder(await route([line("egusi")], onePool, carrier, { toZip: ZIP }), "TX");
    assert.equal(one.exceptionalSplit, false);
  });
});

describe("SEL-2/SEL-4 seller eligibility", () => {
  test("an unverified seller is never assigned an order", async () => {
    const pool = [
      listing({ storeId: "A", canonicalProductId: "egusi", priceCents: 500, verificationStatus: "pending" }),
      listing({ storeId: "B", canonicalProductId: "egusi", priceCents: 900 }),
    ];
    const plan = await route([line("egusi")], pool, carrier, { toZip: ZIP });

    assert.equal(plan.assignment[0].listing.storeId, "B", "cheaper unverified seller must not win");
  });

  test("a line only an unverified seller stocks is reported separately from out-of-stock", async () => {
    const pool = [
      listing({ storeId: "A", canonicalProductId: "egusi", priceCents: 900 }),
      listing({ storeId: "B", canonicalProductId: "rare", priceCents: 700, verificationStatus: "pending" }),
    ];
    const plan = await route([line("egusi"), line("rare")], pool, carrier, { toZip: ZIP });

    assert.equal(plan.blockedByVerification.length, 1);
    assert.equal(plan.blockedByVerification[0].canonicalProductId, "rare");
    assert.equal(plan.unfulfillable.length, 0, "it is not out of stock — the trust gate removed it");
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
        { carrier: "USPS", service: "Ground", costCents: 700, transitDays: 5 },
        { carrier: "UPS", service: "2Day", costCents: 1800, transitDays: 2 },
      ],
      6,
    );
    assert.equal(choice?.quote.carrier, "USPS");
    assert.equal(choice?.missedWindow, false);
  });

  test("ignores a cheaper option that misses the window", () => {
    const choice = selectCarrier(
      [
        { carrier: "USPS", service: "Ground", costCents: 700, transitDays: 5 },
        { carrier: "UPS", service: "2Day", costCents: 1800, transitDays: 2 },
      ],
      2,
    );
    assert.equal(choice?.quote.carrier, "UPS");
  });

  test("falls back to the fastest and flags it when nothing meets the window", () => {
    const choice = selectCarrier([{ carrier: "USPS", service: "Ground", costCents: 700, transitDays: 5 }], 2);
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
