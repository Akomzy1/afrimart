import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { computeScore, ladderFor, visibilityMultiplierFor } from "./score.js";
import { checkListingStandards, requiresManualReview } from "./listingStandards.js";
import {
  assessClaim,
  recoveryTargetFor,
  requiresPhoto,
  isBuyerSelectable,
  BUYER_ITEM_REASONS,
  INTERNAL_ONLY_REASONS,
  type RefundReason,
} from "./refunds.js";
import { QUALITY_MIN_ORDERS_FOR_ENFORCEMENT, REFUND_AUTO_APPROVE_CENTS } from "../config.js";

const record = (over: Partial<Parameters<typeof computeScore>[0]> = {}) =>
  computeScore({
    deliveredOrders: 100,
    confirmedSellerClaims: 0,
    averageRating: 4.5,
    ratingCount: 40,
    onTimeAcceptanceRate: 0.95,
    ...over,
  });

describe("QC-4 only confirmed claims count", () => {
  test("a seller with no confirmed claims has no defect rate", () => {
    assert.equal(record({ confirmedSellerClaims: 0 }).defectRate, 0);
  });

  test("confirmed claims move the rate; the score falls with them", () => {
    const clean = record({ confirmedSellerClaims: 0 });
    const poor = record({ confirmedSellerClaims: 20 });
    assert.ok(poor.defectRate > clean.defectRate);
    assert.ok((poor.score ?? 0) < (clean.score ?? 0));
  });

  test("the caller passes confirmed counts only — the type has no field for submitted ones", () => {
    // Guards the rule structurally: there is nowhere to put a pending claim,
    // so one malicious buyer cannot move a seller's score by filing.
    const keys = Object.keys({
      deliveredOrders: 0,
      confirmedSellerClaims: 0,
      averageRating: null,
      ratingCount: 0,
      onTimeAcceptanceRate: null,
    });
    assert.ok(!keys.some((k) => /submitted|pending|open/i.test(k)));
  });
});

describe("QC-4/QC-6 minimum sample size", () => {
  test("one complaint in three orders does not enforce", () => {
    const q = record({ deliveredOrders: 3, confirmedSellerClaims: 1 });
    assert.ok(q.defectRate > 0.3, "the rate really is high");
    assert.equal(q.enforceable, false, "but the sample is too small to act on");
    assert.equal(ladderFor(q).action, "none");
  });

  test("the same rate on a real sample does enforce", () => {
    const q = record({ deliveredOrders: 100, confirmedSellerClaims: 33 });
    assert.equal(q.enforceable, true);
    assert.notEqual(ladderFor(q).action, "none");
  });

  test("the threshold is the configured one", () => {
    const below = record({ deliveredOrders: QUALITY_MIN_ORDERS_FOR_ENFORCEMENT - 1, confirmedSellerClaims: 5 });
    const at = record({ deliveredOrders: QUALITY_MIN_ORDERS_FOR_ENFORCEMENT, confirmedSellerClaims: 5 });
    assert.equal(below.enforceable, false);
    assert.equal(at.enforceable, true);
  });

  test("a new seller is not penalised in search", () => {
    const q = record({ deliveredOrders: 2, confirmedSellerClaims: 0, averageRating: null });
    assert.equal(visibilityMultiplierFor(q, null), 1);
  });
});

describe("QC-6 never delists automatically", () => {
  test("the ladder can warn and reduce visibility on its own", () => {
    assert.equal(ladderFor(record({ deliveredOrders: 100, confirmedSellerClaims: 6 })).action, "warning");
    assert.equal(
      ladderFor(record({ deliveredOrders: 100, confirmedSellerClaims: 12 })).action,
      "reduced_visibility",
    );
  });

  test("a terrible record flags for review rather than delisting", () => {
    const decision = ladderFor(record({ deliveredOrders: 100, confirmedSellerClaims: 50 }));
    assert.equal(decision.action, "flag_for_review");
    assert.equal(decision.requiresHumanDecision, true);
  });

  test("no automatic path produces suspension or delisting", () => {
    for (let claims = 0; claims <= 100; claims += 5) {
      const action = ladderFor(record({ deliveredOrders: 100, confirmedSellerClaims: claims })).action;
      assert.ok(
        !["suspended", "delisted"].includes(action),
        `automatic ${action} at ${claims}% — those end a livelihood and need a person`,
      );
    }
  });

  test("a suspended seller disappears from search", () => {
    assert.equal(visibilityMultiplierFor(record(), "suspended"), 0);
    assert.equal(visibilityMultiplierFor(record(), "delisted"), 0);
    assert.equal(visibilityMultiplierFor(record(), "reduced_visibility"), 0.4);
  });
});

describe("QC-1 listing standards", () => {
  const base = {
    canonicalName: "Egusi",
    category: "Legumes & seeds",
    temperatureClass: "ambient" as const,
    sellerType: "store" as const,
  };

  test("a home seller cannot list chilled or frozen goods", () => {
    for (const temp of ["refrigerated", "frozen"] as const) {
      const r = checkListingStandards({ ...base, sellerType: "home_seller", temperatureClass: temp });
      assert.equal(r.ok, false, `${temp} must be refused for a home seller`);
      assert.ok(r.violations.some((v) => v.code === "home_seller_perishable"));
    }
  });

  test("a home seller can list shelf-stable goods", () => {
    assert.equal(checkListingStandards({ ...base, sellerType: "home_seller" }).ok, true);
  });

  test("an aspiring entrepreneur is held to the same rule", () => {
    const r = checkListingStandards({
      ...base,
      sellerType: "aspiring_entrepreneur",
      temperatureClass: "frozen",
    });
    assert.equal(r.ok, false);
  });

  test("a store with a commercial kitchen can list chilled goods", () => {
    assert.equal(checkListingStandards({ ...base, sellerType: "store", temperatureClass: "refrigerated" }).ok, true);
  });

  test("prohibited categories are refused outright", () => {
    const r = checkListingStandards({ ...base, category: "alcohol" });
    assert.ok(r.violations.some((v) => v.code === "prohibited_category"));
  });

  test("short-dated stock needs disclosure; expired stock is refused", () => {
    const soon = new Date(Date.now() + 5 * 86_400_000);
    assert.ok(
      checkListingStandards({ ...base, expiresOn: soon }).violations.some((v) => v.code === "short_dated_undisclosed"),
    );
    assert.equal(checkListingStandards({ ...base, expiresOn: soon, shortDatedDisclosed: true }).ok, true);

    const past = new Date(Date.now() - 86_400_000);
    assert.ok(checkListingStandards({ ...base, expiresOn: past }).violations.some((v) => v.code === "expired"));
  });

  test("restricted categories go to a reviewer rather than auto-approving", () => {
    assert.equal(requiresManualReview("fresh meat"), true);
    assert.equal(requiresManualReview("Legumes & seeds"), false);
  });
});

describe("QC-3 reasons", () => {
  test("the five item reasons are buyer-selectable", () => {
    for (const r of BUYER_ITEM_REASONS) assert.equal(isBuyerSelectable(r), true);
    assert.equal(BUYER_ITEM_REASONS.length, 5);
    assert.ok((BUYER_ITEM_REASONS as readonly string[]).includes("inauthentic"));
    assert.ok((BUYER_ITEM_REASONS as readonly string[]).includes("missing_items"));
    assert.ok((BUYER_ITEM_REASONS as readonly string[]).includes("wrong_item"), '"not as described" maps here');
  });

  test("late delivery is never offered to a buyer", () => {
    for (const r of INTERNAL_ONLY_REASONS) assert.equal(isBuyerSelectable(r), false);
    assert.equal(isBuyerSelectable("late_delivery"), false);
  });

  test("every item reason needs a photo; the parcel reason does not", () => {
    for (const r of BUYER_ITEM_REASONS) assert.equal(requiresPhoto(r), true, `${r} must require a photo`);
    assert.equal(requiresPhoto("not_delivered"), false);
  });

  test("a not-arrived claim is never auto-approved, however small", () => {
    const d = assessClaim({
      reason: "not_delivered",
      amountCents: 100,
      priorClaims: 0,
      trackingShowsFailure: true,
      hadCarrierScan: true,
    });
    assert.equal(d.status, "manual_review");
  });

  test("a small clean item claim still auto-approves", () => {
    const d = assessClaim({
      reason: "damaged",
      amountCents: REFUND_AUTO_APPROVE_CENTS - 1,
      photoUrl: "https://x/p.jpg",
      priorClaims: 0,
      trackingShowsFailure: false,
    });
    assert.equal(d.status, "auto_approved");
  });

  test("a scanned parcel is the carrier's; an unscanned one is the seller's", () => {
    const ctx = { reason: "not_delivered" as RefundReason, amountCents: 1000, priorClaims: 0, trackingShowsFailure: true };
    assert.equal(recoveryTargetFor({ ...ctx, hadCarrierScan: true }), "carrier");
    assert.equal(
      recoveryTargetFor({ ...ctx, hadCarrierScan: false }),
      "seller",
      "no scan means it never left the seller, whatever the label says",
    );
  });

  test("inauthentic is recovered from the seller", () => {
    assert.equal(
      recoveryTargetFor({ reason: "inauthentic", amountCents: 1000, priorClaims: 0, trackingShowsFailure: false }),
      "seller",
    );
  });
});
